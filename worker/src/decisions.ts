import type { ApiCheck, CiState, Decision, DecisionBlock, DecisionLink, DecisionsResponse } from '../../src/data/api';
import { parseDecisionBlocks, toDecision, type ParseResult } from '../../src/data/decision';
import { looksLikeSecret } from '../../src/data/secrets';
import type { SessionSnapshot, SnapshotSession } from '../../src/data/snapshot';
import type { GithubClient } from './github';
import { checkState, overallCi, type ProjetConfig } from './projets';

/**
 * Décisions en attente de ta réponse (docs/specs/en-attente-de-reponse.md § 5.2, 5.3, 5.5).
 * Lecture seule : issues ouvertes étiquetées `decision`, descriptions des PR ouvertes, PR Dependabot
 * qui changent de version majeure, puis questions de l'instantané ; dédupliquées sur `(projectId, id)`.
 * Le journal ne reçoit jamais le contenu d'un bloc : seulement le projet, l'endroit, l'id validé et la raison.
 */

export type Log = (line: string) => void;

interface GhIssue {
  number: number;
  author_association?: string;
  body?: string | null;
  created_at: string;
  pull_request?: unknown;
}
interface GhPull {
  number: number;
  author_association?: string;
  title: string;
  body?: string | null;
  created_at: string;
  user?: { login: string } | null;
  head: { sha: string };
}
interface GhCheckRuns {
  check_runs: { name: string; status: string; conclusion: string | null }[];
}

const DEPENDABOT = 'dependabot[bot]';

/**
 * Seuls les blocs écrits par un auteur de confiance deviennent des décisions : sur un dépôt public,
 * n'importe qui peut ouvrir une PR ou une issue. `author_association` est déjà dans les listes REST.
 * Les PR Dependabot n'en font pas partie : leur description recopie des notes de version écrites par des tiers.
 */
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const ID_FORMAT = /^[a-z0-9-]{3,60}$/;

const cut = (s: string, max: number) => ([...s].length <= max ? s : `${[...s].slice(0, max - 1).join('')}…`);

/** Id qu'on peut écrire dans le journal : bien formé et sans air de secret. */
const safeId = (id: unknown): string | undefined =>
  typeof id === 'string' && ID_FORMAT.test(id) && !looksLikeSecret(id) ? id : undefined;

/** Au plus 10 lignes de journal par texte lu, de 160 caractères au plus chacune (les noms de clés inconnues viennent du bloc). */
const MAX_LOG_LINES = 10;
const MAX_LOG_LENGTH = 160;

function logParse(log: Log, where: string, result: Pick<ParseResult, 'errors' | 'warnings'>) {
  const lines = [
    ...result.errors.map((e) => `decisions: ${where} : bloc illisible${e.id ? ` « ${e.id} »` : ''} : ${e.reason}`),
    ...result.warnings.map((w) => `decisions: ${where} : ${w}`),
  ];
  for (const line of lines.slice(0, MAX_LOG_LINES)) log(cut(line, MAX_LOG_LENGTH));
  if (lines.length > MAX_LOG_LINES) log(`decisions: ${where} : ${lines.length - MAX_LOG_LINES} autres lignes non écrites`);
}

/* --- Dependabot (§ 5.5, D14) --- */

/** « Bump x from 4.2.1 to 5.0.0 » (avec ou sans préfixe `chore(deps):`) : paquet et chiffres majeurs, si le premier change. */
export function dependabotMajor(title: string): { name: string; from: number; to: number } | null {
  const m = /(?:^|\s)bump (\S+) from v?(\d+)\S* to v?(\d+)\S*/i.exec(title);
  if (!m) return null;
  const from = Number(m[2]);
  const to = Number(m[3]);
  return from === to ? null : { name: m[1], from, to };
}

const CI_LABEL: Record<CiState, string> = { success: 'réussie', failure: 'en échec', pending: 'en cours', none: 'aucun check' };


async function dependabotDecision(
  gh: GithubClient,
  p: ProjetConfig,
  pr: GhPull,
  bump: { name: string; from: number; to: number },
  log: Log,
): Promise<Decision | null> {
  const runs = await gh.get<GhCheckRuns>(p.owner, `/repos/${p.owner}/${p.repo}/commits/${pr.head.sha}/check-runs?per_page=50`);
  const checks: ApiCheck[] = runs.check_runs.map((r) => ({ name: r.name, state: checkState(r) }));
  const block: DecisionBlock = {
    id: `dependabot-${pr.number}`,
    kind: 'choix',
    question: `Passer ${bump.name} de la version ${bump.from} à ${bump.to} ?`,
    context: [cut(pr.title, 160), `CI : ${CI_LABEL[overallCi(checks)]}`],
    options: [
      { id: 'migrer', label: 'Confier la migration à une session Dev' },
      { id: 'attendre', label: 'Pas maintenant' },
      { id: 'ignorer', label: 'Ignorer cette version majeure' },
    ],
    // Pas de `recommended` : seul un agent recommande (bloc de même id dans la PR).
    reversible: true,
    topic: 'technique',
    freeText: 'facultatif',
    blocking: false,
    links: [{ kind: 'pr', number: pr.number }],
  };
  if ([...block.question].length > 140 || looksLikeSecret(`${block.question}\n${block.context.join('\n')}`)) {
    log(`decisions: ${p.id} PR #${pr.number} : titre Dependabot inattendu, ignoré`);
    return null;
  }
  return toDecision(block, { projectId: p.id, askedAt: pr.created_at, askedBy: { kind: 'pr', number: pr.number }, source: 'dependabot' });
}

/* --- Issues et PR (§ 5.2) --- */

async function readProjectDecisions(gh: GithubClient, p: ProjetConfig, log: Log): Promise<Decision[]> {
  const base = `/repos/${p.owner}/${p.repo}`;
  const [issues, pulls] = await Promise.all([
    gh.get<GhIssue[]>(p.owner, `${base}/issues?state=open&labels=decision&per_page=50`),
    gh.get<GhPull[]>(p.owner, `${base}/pulls?state=open&per_page=30`),
  ]);
  const out: Decision[] = [];
  const fromText = (
    item: { body?: string | null; author_association?: string },
    where: string,
    origin: Omit<Parameters<typeof toDecision>[1], 'projectId'>,
  ) => {
    if (!item.body) return;
    const result = parseDecisionBlocks(item.body);
    if (!TRUSTED.has(item.author_association ?? '')) {
      // Rien n'est repris, pas même les erreurs : seulement le fait qu'un bloc a été écarté.
      if (result.decisions.length + result.errors.length > 0) log(`decisions: ${p.id} ${where} : auteur non autorisé, ignoré`);
      return;
    }
    logParse(log, `${p.id} ${where}`, result);
    for (const block of result.decisions) out.push(toDecision(block, { projectId: p.id, ...origin }));
  };

  for (const i of issues) {
    if (i.pull_request) continue; // Les PR sont lues par la liste des PR.
    fromText(i, `issue #${i.number}`, { askedAt: i.created_at, askedBy: { kind: 'issue', number: i.number }, source: 'issue' });
  }
  for (const pr of pulls) {
    if (pr.user?.login === DEPENDABOT) continue; // Décision générée plus bas ; la description n'est pas lue.
    fromText(pr, `PR #${pr.number}`, { askedAt: pr.created_at, askedBy: { kind: 'pr', number: pr.number }, source: 'pr' });
  }
  const majors = pulls.flatMap((pr) => {
    const bump = pr.user?.login === DEPENDABOT ? dependabotMajor(pr.title) : null;
    return bump ? [{ pr, bump }] : [];
  });
  const generated = await Promise.all(majors.map(({ pr, bump }) => dependabotDecision(gh, p, pr, bump, log)));
  for (const d of generated) if (d) out.push(d);
  return out;
}

/* --- Instantané (§ 2.3, 5.1) --- */

class BadField extends Error {}

const text = (v: unknown): string => {
  if (typeof v !== 'string') throw new BadField('champ de type inattendu');
  if (/[\r\n]/.test(v)) throw new BadField('retour à la ligne dans un champ');
  return v;
};
const optional = <T>(v: unknown, read: (v: unknown) => T): T | undefined => (v === undefined || v === null ? undefined : read(v));
const list = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new BadField('champ de type inattendu');
  return v;
};
const bool = (v: unknown): boolean => {
  if (typeof v !== 'boolean') throw new BadField('champ de type inattendu');
  return v;
};
const yesNo = (v: boolean) => (v ? 'oui' : 'non');

/**
 * Réécrit une question de l'instantané en bloc `decision` pour lui appliquer exactement les règles
 * du § 2.2 (longueurs, options, secrets). Champs absents d'une question v1 : contexte tiré de `detail`,
 * oui/non, `reversible: non` (en cas de doute), `topic: technique`.
 */
function questionToBlock(q: Record<string, unknown>): string {
  const lines = [`id: ${text(q.id)}`, `question: ${text(q.title)}`];
  const context = optional(q.context, list)?.map(text) ?? [text(q.detail)];
  for (const c of context) lines.push(`context: ${c}`);
  const kind = optional(q.kind, text);
  if (kind !== undefined) lines.push(`kind: ${kind}`);
  for (const o of optional(q.options, list) ?? []) {
    const opt = (o ?? {}) as Record<string, unknown>;
    const detail = optional(opt.detail, text);
    const parts = [text(opt.id), text(opt.label), ...(detail !== undefined ? [detail] : [])];
    if (parts.some((part) => part.includes('|'))) throw new BadField('« option » : caractère | interdit');
    lines.push(`option: ${parts.join(' | ')}`);
  }
  const recommended = optional(q.recommended, text);
  if (recommended !== undefined) lines.push(`recommended: ${recommended}`);
  lines.push(`reversible: ${yesNo(optional(q.reversible, bool) ?? false)}`);
  lines.push(`topic: ${optional(q.topic, text) ?? 'technique'}`);
  const freeText = optional(q.freeText, text);
  if (freeText !== undefined) lines.push(`freeText: ${freeText}`);
  lines.push(`blocking: ${yesNo(optional(q.blocking, bool) ?? false)}`);
  for (const l of optional(q.links, list) ?? []) {
    const link = (l ?? {}) as Record<string, unknown>;
    if ((link.kind !== 'pr' && link.kind !== 'issue') || typeof link.number !== 'number') throw new BadField('« links » : forme inattendue');
    lines.push(`link: ${link.kind === 'pr' ? 'PR' : 'issue'} #${link.number}`);
  }
  return ['```decision', ...lines, '```'].join('\n');
}

const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function sessionDecisions(snapshot: SessionSnapshot, log: Log): Decision[] {
  const out: Decision[] = [];
  for (const s of snapshot.sessions as Partial<SnapshotSession>[]) {
    if (!s || typeof s.projectId !== 'string' || typeof s.id !== 'string' || !Array.isArray(s.questions)) continue;
    const where = `${/^[\w-]{1,40}$/.test(s.projectId) ? s.projectId : '?'} session ${/^[\w-]{1,80}$/.test(s.id) ? s.id : '?'}`;
    for (const raw of s.questions as unknown[]) {
      const q = (raw ?? {}) as Record<string, unknown>;
      let result: ParseResult;
      try {
        result = parseDecisionBlocks(questionToBlock(q));
      } catch (e) {
        if (!(e instanceof BadField)) throw e;
        const id = safeId(q.id);
        log(`decisions: ${where} : bloc illisible${id ? ` « ${id} »` : ''} : ${e.message}`);
        continue;
      }
      logParse(log, where, result);
      for (const block of result.decisions) {
        out.push(
          toDecision(block, {
            projectId: s.projectId,
            askedAt: isIso(q.askedAt) ? q.askedAt : snapshot.generatedAt,
            askedBy: { kind: 'session', id: s.id },
            source: 'session',
          }),
        );
      }
    }
  }
  return out;
}

/* --- Déduplication (§ 5.3) --- */

/**
 * L'issue ou la PR gagne (durable, lisible sur GitHub), puis la décision générée pour Dependabot, puis la session.
 * Seuls les auteurs de confiance arrivent jusqu'ici (`TRUSTED`) : un tiers ne peut pas remplacer une question.
 */
const RANK: Record<Decision['source'], number> = { pr: 3, issue: 3, dependabot: 2, session: 1 };

const content = (d: Decision) => {
  const { links: _links, projectId: _p, askedAt: _a, askedBy: _b, source: _s, answer: _r, ...rest } = d;
  return JSON.stringify(rest);
};

const describe = (d: Decision) =>
  d.askedBy.kind === 'session' ? 'session' : `${d.askedBy.kind === 'pr' ? 'PR' : 'issue'} #${d.askedBy.number}`;

export function mergeDecisions(all: Decision[], log: Log): Decision[] {
  const byKey = new Map<string, Decision>();
  for (const d of all) {
    const key = `${d.projectId}\u0000${d.id}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, d);
      continue;
    }
    // À rang égal (deux issues, deux sessions), la première lue reste.
    const [winner, loser] = RANK[d.source] > RANK[prev.source] ? [d, prev] : [prev, d];
    if (content(winner) !== content(loser) && loser.source !== 'dependabot') {
      log(`decisions: ${d.projectId} « ${d.id} » : contenus différents selon la source, ${describe(winner)} retenue`);
    }
    const links: DecisionLink[] = [...winner.links];
    for (const l of loser.links) if (!links.some((k) => k.kind === l.kind && k.number === l.number)) links.push(l);
    const askedAt = Date.parse(loser.askedAt) < Date.parse(winner.askedAt) ? loser.askedAt : winner.askedAt;
    byKey.set(key, { ...winner, links, askedAt });
  }
  return [...byKey.values()].sort(
    (a, b) =>
      Number(b.blocking) - Number(a.blocking) ||
      Date.parse(a.askedAt) - Date.parse(b.askedAt) ||
      a.projectId.localeCompare(b.projectId) ||
      a.id.localeCompare(b.id),
  );
}

/** Un dépôt en échec n'empêche pas les autres : il est listé dans `errors`. */
export async function readDecisions(
  gh: GithubClient,
  config: ProjetConfig[],
  snapshot: SessionSnapshot | null,
  now: Date,
  log: Log,
): Promise<DecisionsResponse> {
  const errors: DecisionsResponse['errors'] = [];
  const perProject = await Promise.all(
    config.map((p) =>
      readProjectDecisions(gh, p, log).catch((error: unknown) => {
        errors.push({ projectId: p.id, error: error instanceof Error ? error.message : 'erreur inconnue' });
        return [] as Decision[];
      }),
    ),
  );
  const all = [...perProject.flat(), ...(snapshot ? sessionDecisions(snapshot, log) : [])];
  errors.sort((a, b) => a.projectId.localeCompare(b.projectId));
  return { generatedAt: now.toISOString(), snapshotAt: snapshot?.generatedAt ?? null, decisions: mergeDecisions(all, log), errors };
}
