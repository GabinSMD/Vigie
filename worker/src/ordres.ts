import type {
  ApiError,
  Decision,
  DecisionAnswer,
  Ordre,
  OrdreRequest,
  OrdreStatus,
  OrdreTarget,
  OrdreUpdate,
} from '../../src/data/api';
import { ORDRE_TYPES } from '../../src/data/api';
import { SECRET_WARNING, TEXT_MAX, orderExpiresAt } from '../../src/data/ordre';
import { looksLikeSecret } from '../../src/data/secrets';

/**
 * File des ordres dans D1 (docs/specs/en-attente-de-reponse.md § 4, docs/api-ordres.md).
 * L'app dépose des ordres `repondre` ; le pilote les lit et les fait avancer. Chaque changement
 * est recopié dans le journal (qui, quoi, quand, résultat), jamais le texte de la réponse.
 */

export const STATUSES: readonly OrdreStatus[] = ['en_attente', 'pris', 'fait', 'refuse', 'expire'];

/** Longueur maximale de `result` et `reason` écrits par le pilote. */
const NOTE_MAX = 200;
/** Taille maximale d'un corps de requête, largement au-dessus de 2000 caractères de texte. */
export const BODY_MAX = 16_384;

export class OrdreError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.error);
  }
}

const fail = (status: number, error: string, message?: string): never => {
  throw new OrdreError(status, { error, ...(message ? { message } : {}) });
};

/** Messages affichés sur la carte (§ 3.3), en tutoiement. */
export const MESSAGES = {
  unauthorized: 'Ta connexion a expiré : recharge la page pour te reconnecter.',
  forbidden: 'Seule ta connexion personnelle peut répondre à une décision.',
  bad_request: 'Requête illisible : recharge la page et réessaie.',
  type_inconnu: "Type d'ordre inconnu.",
  decision_inconnue: 'Décision introuvable : elle a peut-être été retirée ou close entre-temps.',
  option_inconnue: 'Option inconnue : la question a changé, réponds à nouveau.',
  texte_manquant: 'Ta réponse écrite est obligatoire pour cette décision.',
  texte_interdit: "Cette décision n'attend pas de texte : envoie seulement ton choix.",
  texte_trop_long: `Ton texte dépasse ${TEXT_MAX} caractères.`,
  secret: SECRET_WARNING,
  deja_transmise: 'Déjà transmise : le pilote a pris ta réponse.',
  deja_repondue: 'Déjà répondue : le pilote a transmis une réponse.',
} as const;

/* --- Lignes D1 --- */

interface OrdreRow {
  id: string;
  type: string;
  created_at: string;
  expires_at: string;
  by: string;
  project_id: string;
  decision_id: string;
  question: string;
  target: string;
  option_id: string;
  option_label: string;
  text: string | null;
  status: OrdreStatus;
  taken_at: string | null;
  done_at: string | null;
  result: string | null;
  reason: string | null;
}

const COLUMNS =
  'id, type, created_at, expires_at, by, project_id, decision_id, question, target, option_id, option_label, text, status, taken_at, done_at, result, reason';

const opt = <K extends string, V>(key: K, value: V | null | undefined): Partial<Record<K, V>> =>
  value === null || value === undefined ? {} : ({ [key]: value } as Record<K, V>);

/** Un ordre `en_attente` dont l'heure est passée est rendu `expire`, sans attendre qu'on l'écrive. */
const effectiveStatus = (row: Pick<OrdreRow, 'status' | 'expires_at'>, nowIso: string): OrdreStatus =>
  row.status === 'en_attente' && row.expires_at <= nowIso ? 'expire' : row.status;

function toOrdre(row: OrdreRow, nowIso: string): Ordre {
  return {
    id: row.id,
    type: row.type as Ordre['type'],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    by: row.by,
    projectId: row.project_id,
    decisionId: row.decision_id,
    question: row.question,
    target: JSON.parse(row.target) as OrdreTarget,
    optionId: row.option_id,
    optionLabel: row.option_label,
    ...opt('text', row.text),
    status: effectiveStatus(row, nowIso),
    ...opt('takenAt', row.taken_at),
    ...opt('doneAt', row.done_at),
    ...opt('result', row.result),
    ...opt('reason', row.reason),
  };
}

const EXPIRED_REASON = "Le pilote ne l'a pas prise à temps.";

function toAnswer(row: OrdreRow, nowIso: string): DecisionAnswer {
  const status = effectiveStatus(row, nowIso);
  return {
    id: row.id,
    status,
    optionId: row.option_id,
    ...opt('text', row.text),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    ...opt('doneAt', row.done_at),
    ...opt('result', row.result),
    ...opt('reason', row.reason ?? (status === 'expire' ? EXPIRED_REASON : null)),
  };
}

/* --- Identifiants --- */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `ord_` + 10 caractères d'horodatage + 12 aléatoires (base 32 de Crockford) : unique et trié dans le temps. */
export function newOrdreId(now: Date): string {
  let time = '';
  let t = now.getTime();
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const random = crypto.getRandomValues(new Uint8Array(12));
  return `ord_${time}${Array.from(random, (b) => CROCKFORD[b % 32]).join('')}`;
}

/* --- Lecture de la requête --- */

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > BODY_MAX) fail(413, 'too_large', MESSAGES.bad_request);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'bad_request', MESSAGES.bad_request);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'bad_request', MESSAGES.bad_request);
  return body as Record<string, unknown>;
}

/** Vérifie la forme de `POST /api/ordres` sans rien croire d'autre que le type, la clé de la décision, l'option et le texte. */
export function parseOrdreRequest(body: Record<string, unknown>): OrdreRequest {
  const { type, projectId, decisionId, optionId, text } = body;
  if (typeof projectId !== 'string' || typeof decisionId !== 'string' || typeof optionId !== 'string') {
    return fail(400, 'bad_request', MESSAGES.bad_request);
  }
  if (text !== undefined && text !== null && typeof text !== 'string') fail(400, 'bad_request', MESSAGES.bad_request);
  if (!(ORDRE_TYPES as readonly unknown[]).includes(type)) fail(422, 'type_inconnu', MESSAGES.type_inconnu);
  return { type: type as OrdreRequest['type'], projectId, decisionId, optionId, ...(typeof text === 'string' ? { text } : {}) };
}

/** Où le pilote transmet la réponse, d'après la décision connue du Worker (§ 4.1, § 4.4). */
export function targetOf(d: Decision): OrdreTarget {
  if (d.source === 'dependabot' && d.askedBy.kind === 'pr') return { kind: 'dependabot', number: d.askedBy.number };
  switch (d.askedBy.kind) {
    case 'session': {
      const issue = d.links.find((l) => l.kind === 'issue');
      return { kind: 'session', id: d.askedBy.id, ...(issue ? { fallbackIssue: issue.number } : {}) };
    }
    case 'issue':
      return { kind: 'issue', number: d.askedBy.number };
    case 'pr':
      return { kind: 'pr', number: d.askedBy.number };
  }
}

/**
 * Contrôles 2 et 3 du § 4.2, dans l'ordre : option connue, texte présent ou absent selon `freeText`,
 * 2000 caractères au plus, filtre de secrets. Renvoie le texte nettoyé (sans espaces autour).
 */
export function checkAnswer(decision: Decision, req: OrdreRequest): string | undefined {
  const option = decision.options.find((o) => o.id === req.optionId);
  if (!option) fail(422, 'option_inconnue', MESSAGES.option_inconnue);
  const text = req.text?.trim() || undefined;
  if (decision.freeText === 'obligatoire' && !text) fail(422, 'texte_manquant', MESSAGES.texte_manquant);
  if (decision.freeText === 'non' && text) fail(422, 'texte_interdit', MESSAGES.texte_interdit);
  if (text && [...text].length > TEXT_MAX) fail(422, 'texte_trop_long', MESSAGES.texte_trop_long);
  if (text && looksLikeSecret(text)) fail(422, 'secret', MESSAGES.secret);
  return text;
}

/* --- Écriture --- */

/**
 * Contrôles 4 et 5 du § 4.2. Un ordre `en_attente` de la même décision est remplacé (« Modifier ») ;
 * après `pris` : 409 « Déjà transmise » ; après `fait` : 409 « Déjà répondue », sauf pour une `action`
 * (« Pas encore » ne clôt pas la décision, § 5.4). Tout est écrit dans un seul lot (transaction D1).
 */
export async function createOrdre(db: D1Database, decision: Decision, req: OrdreRequest, text: string | undefined, by: string, now: Date): Promise<Ordre> {
  const nowIso = now.toISOString();
  const key = [decision.projectId, decision.id] as const;

  const blocking: OrdreStatus[] = decision.kind === 'action' ? ['pris'] : ['pris', 'fait'];
  const holder = await db
    .prepare(`SELECT status FROM ordres WHERE project_id = ?1 AND decision_id = ?2 AND status IN ('pris', 'fait') ORDER BY created_at DESC LIMIT 1`)
    .bind(...key)
    .first<{ status: OrdreStatus }>();
  if (holder && blocking.includes(holder.status)) {
    fail(409, holder.status === 'pris' ? 'deja_transmise' : 'deja_repondue', holder.status === 'pris' ? MESSAGES.deja_transmise : MESSAGES.deja_repondue);
  }
  const replaced = await db
    .prepare(`SELECT id FROM ordres WHERE project_id = ?1 AND decision_id = ?2 AND status = 'en_attente' AND expires_at > ?3`)
    .bind(...key, nowIso)
    .first<{ id: string }>();

  const option = decision.options.find((o) => o.id === req.optionId)!;
  const ordre: Ordre = {
    id: newOrdreId(now),
    type: 'repondre',
    createdAt: nowIso,
    expiresAt: orderExpiresAt(now).toISOString(),
    by,
    projectId: decision.projectId,
    decisionId: decision.id,
    question: decision.question,
    target: targetOf(decision),
    optionId: option.id,
    optionLabel: option.label,
    ...(text ? { text } : {}),
    status: 'en_attente',
  };
  const blockingSql = blocking.map((s) => `'${s}'`).join(', ');
  const results = await db.batch([
    db
      .prepare(`UPDATE ordres SET status = 'expire', reason = ?3 WHERE project_id = ?1 AND decision_id = ?2 AND status = 'en_attente' AND expires_at <= ?4`)
      .bind(...key, EXPIRED_REASON, nowIso),
    db
      .prepare(`UPDATE ordres SET status = 'refuse', done_at = ?3, reason = 'Remplacée par une nouvelle réponse.' WHERE project_id = ?1 AND decision_id = ?2 AND status = 'en_attente'`)
      .bind(...key, nowIso),
    db
      .prepare(
        `INSERT INTO ordres (${COLUMNS}) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'en_attente', NULL, NULL, NULL, NULL
         WHERE NOT EXISTS (SELECT 1 FROM ordres WHERE project_id = ?6 AND decision_id = ?7 AND status IN (${blockingSql}))`,
      )
      .bind(
        ordre.id,
        ordre.type,
        ordre.createdAt,
        ordre.expiresAt,
        ordre.by,
        ordre.projectId,
        ordre.decisionId,
        ordre.question,
        JSON.stringify(ordre.target),
        ordre.optionId,
        ordre.optionLabel,
        ordre.text ?? null,
      ),
    db
      .prepare(
        `INSERT INTO journal (at, who, action, ordre_id, project_id, decision_id, option_id, result)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE EXISTS (SELECT 1 FROM ordres WHERE id = ?4)`,
      )
      .bind(nowIso, by, replaced ? 'remplacer' : 'creer', ordre.id, ordre.projectId, ordre.decisionId, ordre.optionId, replaced ? `remplace ${replaced.id}` : 'en_attente'),
  ]);
  // Le pilote a pris l'ordre précédent entre la lecture et l'écriture.
  if (!results[2]?.meta.changes) fail(409, 'deja_transmise', MESSAGES.deja_transmise);
  return ordre;
}

/** Ordres d'un statut, pour le pilote. `en_attente` : seulement ceux qui ne sont pas expirés (§ 4.3). */
export async function listOrdres(db: D1Database, status: OrdreStatus, now: Date): Promise<Ordre[]> {
  const nowIso = now.toISOString();
  const sql =
    status === 'en_attente'
      ? `SELECT ${COLUMNS} FROM ordres WHERE status = 'en_attente' AND expires_at > ?2 ORDER BY created_at LIMIT 100`
      : status === 'expire'
        ? `SELECT ${COLUMNS} FROM ordres WHERE status = 'expire' OR (status = 'en_attente' AND expires_at <= ?2) ORDER BY created_at DESC LIMIT 100`
        : `SELECT ${COLUMNS} FROM ordres WHERE status = ?1 ORDER BY created_at DESC LIMIT 100`;
  const { results } = await db.prepare(sql).bind(status, nowIso).all<OrdreRow>();
  return results.map((r) => toOrdre(r, nowIso));
}

/** Lit `PATCH /api/ordres/:id`. `result` et `reason` : texte court, sans secret. */
export function parseUpdate(body: Record<string, unknown>): OrdreUpdate {
  const note = (v: unknown): string => {
    if (typeof v !== 'string' || !v.trim()) return fail(400, 'bad_request', 'result ou reason manquant.');
    const s = v.trim();
    if ([...s].length > NOTE_MAX) fail(422, 'note_trop_longue', `${NOTE_MAX} caractères au plus.`);
    if (looksLikeSecret(s)) fail(422, 'secret', MESSAGES.secret);
    return s;
  };
  switch (body.status) {
    case 'pris':
      return { status: 'pris' };
    case 'fait':
      return { status: 'fait', result: note(body.result) };
    case 'refuse':
      return { status: 'refuse', reason: note(body.reason) };
    default:
      return fail(400, 'bad_request', 'status : pris, fait ou refuse.');
  }
}

/**
 * Fait avancer un ordre : `en_attente` (non expiré) → `pris` → `fait` | `refuse`. Toute autre transition
 * est refusée (409) : le pilote ignore un ordre expiré, inconnu ou déjà traité.
 */
export async function updateOrdre(db: D1Database, id: string, update: OrdreUpdate, now: Date): Promise<Ordre> {
  const nowIso = now.toISOString();
  const row = await db.prepare(`SELECT ${COLUMNS} FROM ordres WHERE id = ?1`).bind(id).first<OrdreRow>();
  if (!row) return fail(404, 'ordre_inconnu', 'Ordre inconnu.');

  const statement =
    update.status === 'pris'
      ? db.prepare(`UPDATE ordres SET status = 'pris', taken_at = ?2 WHERE id = ?1 AND status = 'en_attente' AND expires_at > ?2`).bind(id, nowIso)
      : db
          .prepare(`UPDATE ordres SET status = ?3, done_at = ?2, result = ?4, reason = ?5 WHERE id = ?1 AND status = 'pris'`)
          .bind(id, nowIso, update.status, update.status === 'fait' ? update.result : null, update.status === 'refuse' ? update.reason : null);
  const changed = await statement.run();
  if (!changed.meta.changes) {
    fail(409, 'transition_interdite', `Ordre ${effectiveStatus(row, nowIso)} : passage à « ${update.status} » refusé.`);
  }
  const note = update.status === 'fait' ? update.result : update.status === 'refuse' ? update.reason : 'pris';
  await db
    .prepare(`INSERT INTO journal (at, who, action, ordre_id, project_id, decision_id, option_id, result) VALUES (?1, 'pilote', ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(nowIso, update.status === 'pris' ? 'prendre' : update.status, id, row.project_id, row.decision_id, row.option_id, note)
    .run();
  const after = await db.prepare(`SELECT ${COLUMNS} FROM ordres WHERE id = ?1`).bind(id).first<OrdreRow>();
  return toOrdre(after!, nowIso);
}

/** Joint à chaque décision l'ordre le plus récent qui lui répond (`answer`). */
export async function attachAnswers(db: D1Database, decisions: Decision[], now: Date): Promise<Decision[]> {
  if (decisions.length === 0) return decisions;
  const nowIso = now.toISOString();
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM ordres ORDER BY created_at DESC, rowid DESC`).all<OrdreRow>();
  const latest = new Map<string, OrdreRow>();
  for (const r of results) {
    const key = `${r.project_id}\u0000${r.decision_id}`;
    if (!latest.has(key)) latest.set(key, r);
  }
  return decisions.map((d) => {
    const row = latest.get(`${d.projectId}\u0000${d.id}`);
    return row ? { ...d, answer: toAnswer(row, nowIso) } : d;
  });
}
