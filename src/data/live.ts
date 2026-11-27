import { relativeFr } from '../lib/format';
import type { ApiProject, ApiPullRequest, Decision, DecisionsResponse, ProjetsResponse, SessionsResponse } from './api';
import { IMPLICIT_OPTIONS } from './decision';
import { toDecisionItem } from './decisionState';
import type { SnapshotDeliverable, SnapshotQuestion, SnapshotSession } from './snapshot';
import type { ActionItem, Project, PullRequest, Session, Status } from './types';

/** Ensemble de données que lit l'app, venu de `mock.ts` ou de l'API. */
export interface DataSet {
  mode: 'mock' | 'live';
  projects: Project[];
  sessions: Session[];
  pullRequests: PullRequest[];
  actionItems: ActionItem[];
  /** Date ISO de l'instantané des sessions ; null en données fictives ou si le pilote n'a rien écrit. */
  snapshotAt: string | null;
  loading: boolean;
  error: string | null;
  /** Adresse de l'API en données réelles (`/` : même origine) : les réponses partent vers `POST /api/ordres`. */
  apiUrl?: string;
}

const prStatus = (pr: ApiPullRequest): { status: Status; label: string; line: string } => {
  if (pr.draft) return { status: 'neutre', label: 'Brouillon', line: 'En brouillon' };
  if (pr.ci === 'failure') return { status: 'bloque', label: 'CI en échec', line: 'CI en échec · pas en brouillon' };
  if (pr.ci === 'pending') return { status: 'attention', label: 'CI en cours', line: 'CI en cours · pas en brouillon' };
  if (pr.ci === 'success') return { status: 'ok', label: 'Prête', line: 'CI verte · pas en brouillon' };
  return { status: 'neutre', label: 'Sans CI', line: 'Aucune vérification · pas en brouillon' };
};

const checkLabel = { success: 'Réussie', failure: 'En échec', pending: 'En cours', none: 'Aucune' } as const;
const checkStatus = { success: 'ok', failure: 'bloque', pending: 'attention', none: 'neutre' } as const;

function mapPr(project: ApiProject, pr: ApiPullRequest, sessions: Session[]): PullRequest {
  const number = `#${pr.number}`;
  const { status, label, line } = prStatus(pr);
  const guards: string[] = [];
  if (pr.ci === 'success') guards.push('CI verte');
  if (!pr.draft) guards.push('Pas en brouillon');
  if (project.defaultBranch && pr.baseRef === project.defaultBranch) guards.push('Branche principale');
  return {
    number,
    projectId: project.id,
    title: pr.title,
    status,
    statusLabel: label,
    line,
    summary: pr.draft ? 'PR en brouillon.' : 'PR ouverte sur GitHub. Ouvre-la pour lire le détail.',
    sessionRef: sessions.find((s) => s.linkedPr === number && s.projectId === project.id)?.id,
    checks: pr.checks.map((c) => ({ label: c.name, status: checkStatus[c.state], statusLabel: checkLabel[c.state] })),
    guards,
    draft: pr.draft,
    url: pr.url,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function projectLine(sessions: Session[], prs: PullRequest[], issues: number, error?: string): string {
  if (error) return `Lecture GitHub impossible : ${error}`;
  const waiting = sessions.filter((s) => s.waitingFor).length;
  const parts = [
    plural(sessions.length, 'session', 'sessions'),
    plural(prs.length, 'PR ouverte', 'PR ouvertes'),
    plural(issues, 'issue ouverte', 'issues ouvertes'),
  ];
  if (waiting) parts.push(`${waiting} attend ton avis`);
  return parts.join(' · ');
}

const PR_REF = /^#([1-9][0-9]*)$/;

/**
 * Question de l'instantané lue directement, si `GET /api/decisions` n'a pas répondu.
 * Les valeurs manquantes suivent le § 2.1 ; en cas de doute, `reversible` vaut non.
 */
function fromSnapshotQuestion(q: SnapshotQuestion, s: SnapshotSession, askedAt: string): Decision {
  const pr = PR_REF.exec(q.prRef ?? '');
  return {
    id: q.id,
    projectId: s.projectId,
    kind: q.kind ?? 'choix',
    question: q.title,
    context: q.context ?? (q.detail ? [q.detail] : []),
    options: q.options?.length ? q.options : IMPLICIT_OPTIONS.map((o) => ({ ...o })),
    ...(q.recommended !== undefined ? { recommended: q.recommended } : {}),
    reversible: q.reversible ?? false,
    topic: q.topic ?? 'technique',
    freeText: q.freeText ?? 'facultatif',
    blocking: q.blocking ?? false,
    links: q.links ?? (pr ? [{ kind: 'pr', number: Number(pr[1]) }] : []),
    askedAt: q.askedAt ?? askedAt,
    askedBy: { kind: 'session', id: s.id },
    source: 'session',
  };
}

/** Livrable de l'instantané : une décision `validation` (« Valider » ou « Faire reprendre »). */
function fromDeliverable(d: SnapshotDeliverable, s: SnapshotSession, askedAt: string): Decision {
  return {
    id: d.id,
    projectId: s.projectId,
    kind: 'validation',
    question: d.title,
    context: [],
    options: IMPLICIT_OPTIONS.map((o) => ({ ...o })),
    reversible: true,
    topic: 'produit',
    freeText: 'non',
    blocking: false,
    links: [],
    askedAt,
    askedBy: { kind: 'session', id: s.id },
    source: 'session',
  };
}

/**
 * Transforme les réponses du Worker en données d'écran. Fonction pure : `now` sert aux « il y a … ».
 * `decisions` vient de `GET /api/decisions`, qui contient déjà les questions de l'instantané ;
 * s'il manque (`null`), les questions sont lues dans l'instantané.
 */
export function buildLiveData(
  projets: ProjetsResponse,
  sessionsResponse: SessionsResponse,
  now: Date = new Date(),
  decisions: DecisionsResponse | null = null,
): DataSet {
  const snap = sessionsResponse.snapshot;
  const sessions: Session[] = (snap?.sessions ?? []).map((s) => ({
    id: s.id,
    projectId: s.projectId,
    role: s.role,
    ref: s.ref,
    title: s.title,
    status: s.status,
    statusLabel: s.statusLabel,
    line: s.line,
    summary: s.summary,
    waitingFor: s.waitingFor,
    events: s.events.map((e) => ({ kind: e.kind, title: e.title, when: relativeFr(e.at, now) })),
    linkedPr: s.linkedPr,
    disconnected: s.disconnected ? { lastSeen: relativeFr(s.disconnected.lastSeen, now) } : undefined,
  }));

  const pullRequests: PullRequest[] = [];
  const projects: Project[] = projets.projects.map((p) => {
    const own = sessions.filter((s) => s.projectId === p.id);
    const prs = p.pullRequests.map((pr) => mapPr(p, pr, sessions));
    pullRequests.push(...prs);
    const blocked = p.error || own.some((s) => s.disconnected || s.status === 'bloque') || prs.some((pr) => pr.status === 'bloque');
    const attention = own.some((s) => s.waitingFor) || prs.some((pr) => pr.status === 'ok' || pr.status === 'attention');
    return {
      id: p.id,
      name: p.name,
      status: blocked ? 'bloque' : attention ? 'attention' : 'neutre',
      statusLabel: p.error ? 'Illisible' : undefined,
      line: projectLine(own, prs, p.issues.length, p.error),
      costToday: 0,
      costCap: 0,
      sessionIds: own.map((s) => s.id),
      prNumbers: prs.map((pr) => pr.number),
      closedPrs: [],
      issues: p.issues.map((i) => ({ number: `#${i.number}`, title: i.title, url: i.url })),
      costs: [],
      url: p.url,
    };
  });

  const actionItems: ActionItem[] = [];
  for (const s of snap?.sessions ?? []) {
    if (s.disconnected || s.status === 'bloque') {
      actionItems.push({ kind: 'blocage', id: `blk-${s.id}`, projectId: s.projectId, sessionId: s.id, title: s.line, detail: s.summary });
    } else if (s.waitingFor) {
      actionItems.push({ kind: 'session', id: `ses-${s.id}`, projectId: s.projectId, sessionId: s.id, title: s.waitingFor });
    }
    const askedAt = snap?.generatedAt ?? now.toISOString();
    if (!decisions) {
      for (const q of s.questions ?? []) actionItems.push(toDecisionItem(fromSnapshotQuestion(q, s, askedAt)));
    }
    /* /api/decisions contient aussi les livrables : le Worker peut alors recevoir leur réponse. */
    if (!decisions) {
      for (const d of s.deliverables ?? []) actionItems.push(toDecisionItem(fromDeliverable(d, s, askedAt)));
    }
  }
  for (const d of decisions?.decisions ?? []) {
    const item = toDecisionItem(d);
    if (!actionItems.some((i) => i.id === item.id)) actionItems.push(item);
  }
  for (const pr of pullRequests) {
    if (pr.status === 'ok') {
      actionItems.push({ kind: 'pr', id: `pr-${pr.projectId}-${pr.number}`, projectId: pr.projectId, prNumber: pr.number, title: pr.title, detail: 'Prête à fusionner · pas en brouillon' });
    }
  }

  return { mode: 'live', projects, sessions, pullRequests, actionItems, snapshotAt: sessionsResponse.snapshotAt, loading: false, error: null };
}
