import type { DecisionsResponse, OrdreResponse, OrdresResponse, OrdreStatus, ProjetsResponse, SessionsResponse } from '../../src/data/api';
import type { SessionSnapshot } from '../../src/data/snapshot';
import config from '../../config/projets.json';
import { sameSecret, verifyAccess, type AccessEnv, type AccessIdentity } from './access';
import { readDecisions, type Log } from './decisions';
import { GithubClient, type FetchFn, type GithubEnv } from './github';
import {
  MESSAGES,
  OrdreError,
  STATUSES,
  attachAnswers,
  checkAnswer,
  createOrdre,
  listOrdres,
  parseOrdreRequest,
  parseUpdate,
  readJson,
  updateOrdre,
} from './ordres';
import { readProjects, type ProjetConfig } from './projets';

export interface Env extends GithubEnv, AccessEnv {
  VIGIE_SNAPSHOT: KVNamespace;
  /** File des ordres et journal (D1). Absente tant que la base n'est pas créée : les routes d'ordres répondent 503. */
  VIGIE_DB?: D1Database;
  /** Jeton porteur du pilote (secret Wrangler), exigé en plus d'Access sur GET et PATCH /api/ordres. */
  PILOT_TOKEN?: string;
  /** Fichiers de l'app (`dist/`), servis par le même Worker (static assets). Absent en test. */
  ASSETS?: Fetcher;
}

export interface Deps {
  fetch: FetchFn;
  projets: ProjetConfig[];
  now: () => Date;
  /** Journal du Worker (`wrangler tail`). Jamais le contenu d'un bloc ni un secret. */
  log?: Log;
}

export const SNAPSHOT_KEY = 'snapshot';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const defaults = (): Deps => ({
  fetch: (input, init) => fetch(input, init),
  projets: (config.projets as { id: string; owner: string; repo: string; nom: string }[]),
  now: () => new Date(),
  log: (line) => console.warn(line),
});

/** Instantané écrit par le pilote : null s'il n'existe pas encore, `invalid` s'il est illisible. */
async function readSnapshot(env: Env): Promise<SessionSnapshot | null | 'invalid'> {
  const raw = await env.VIGIE_SNAPSHOT.get(SNAPSHOT_KEY);
  if (raw === null) return null;
  let snapshot: SessionSnapshot;
  try {
    snapshot = JSON.parse(raw) as SessionSnapshot;
  } catch {
    return 'invalid';
  }
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.sessions) || typeof snapshot.generatedAt !== 'string') return 'invalid';
  return snapshot;
}

async function loadDecisions(env: Env, deps: Deps, projets: ProjetConfig[]): Promise<DecisionsResponse> {
  const log = deps.log ?? (() => {});
  let snapshot = await readSnapshot(env);
  if (snapshot === 'invalid') {
    log('decisions: instantané illisible, questions des sessions ignorées');
    snapshot = null;
  }
  const gh = new GithubClient(env, deps.fetch, () => deps.now().getTime());
  return readDecisions(gh, projets, snapshot, deps.now(), log);
}

const ORDRE_PATH = /^\/api\/ordres\/(ord_[0-9A-Z]{22})$/;

type Auth = { ok: true; identity: AccessIdentity } | { ok: false; response: Response };

/** Contrôle 1 du § 4.2 : identité Access valide, sinon 401. La raison va au journal, jamais le jeton. */
async function access(request: Request, env: Env, deps: Deps): Promise<Auth> {
  const result = await verifyAccess(request, env, deps.fetch, deps.now().getTime());
  if (result.ok) return result;
  (deps.log ?? (() => {}))(`ordres: identité Access refusée (${result.reason})`);
  return { ok: false, response: json({ error: 'unauthorized', message: MESSAGES.unauthorized }, 401) };
}

/** Le pilote : Access (jeton de service) puis `Authorization: Bearer <PILOT_TOKEN>`. */
async function pilot(request: Request, env: Env, deps: Deps): Promise<Auth> {
  const auth = await access(request, env, deps);
  if (!auth.ok) return auth;
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!env.PILOT_TOKEN || !token || !(await sameSecret(token, env.PILOT_TOKEN))) {
    (deps.log ?? (() => {}))('ordres: jeton du pilote absent ou faux');
    return { ok: false, response: json({ error: 'unauthorized', message: 'Jeton du pilote absent ou faux.' }, 401) };
  }
  return auth;
}

async function ordres(request: Request, env: Env, deps: Deps, pathname: string): Promise<Response> {
  const db = env.VIGIE_DB;
  if (pathname === '/api/ordres' && request.method === 'POST') {
    const auth = await access(request, env, deps);
    if (!auth.ok) return auth.response;
    // Le pilote (jeton de service) ne crée jamais d'ordre : seule ta connexion le peut.
    if (auth.identity.kind !== 'user') return json({ error: 'forbidden', message: MESSAGES.forbidden }, 403);
    if (!db) return json({ error: 'db_unavailable' }, 503);
    const req = parseOrdreRequest(await readJson(request));
    const projet = deps.projets.find((p) => p.id === req.projectId);
    if (!projet) return json({ error: 'decision_inconnue', message: MESSAGES.decision_inconnue }, 404);
    let known: DecisionsResponse;
    try {
      known = await loadDecisions(env, deps, [projet]);
    } catch {
      return json({ error: 'decisions_unavailable' }, 502);
    }
    const decision = known.decisions.find((d) => d.id === req.decisionId);
    if (!decision) return json({ error: 'decision_inconnue', message: MESSAGES.decision_inconnue }, 404);
    const text = checkAnswer(decision, req);
    const ordre = await createOrdre(db, decision, req, text, auth.identity.email, deps.now());
    const body: OrdreResponse = { ordre };
    return json(body, 201);
  }
  if (pathname === '/api/ordres' && request.method === 'GET') {
    const auth = await pilot(request, env, deps);
    if (!auth.ok) return auth.response;
    if (!db) return json({ error: 'db_unavailable' }, 503);
    const status = (new URL(request.url).searchParams.get('status') ?? 'en_attente') as OrdreStatus;
    if (!STATUSES.includes(status)) return json({ error: 'bad_request', message: `status : ${STATUSES.join(', ')}.` }, 400);
    const body: OrdresResponse = { generatedAt: deps.now().toISOString(), ordres: await listOrdres(db, status, deps.now()) };
    return json(body);
  }
  const match = ORDRE_PATH.exec(pathname);
  if (match && request.method === 'PATCH') {
    const auth = await pilot(request, env, deps);
    if (!auth.ok) return auth.response;
    if (!db) return json({ error: 'db_unavailable' }, 503);
    const ordre = await updateOrdre(db, match[1], parseUpdate(await readJson(request)), deps.now());
    const body: OrdreResponse = { ordre };
    return json(body);
  }
  if (pathname === '/api/ordres' || match) return json({ error: 'method_not_allowed' }, 405);
  return json({ error: 'not_found' }, 404);
}

/**
 * Routes : GET /api/projets, /api/sessions et /api/decisions (lecture) ; /api/ordres (file des ordres,
 * identité Access vérifiée). Tout le reste est refusé.
 */
export async function handle(request: Request, env: Env, deps: Deps = defaults()): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/ordres' || pathname.startsWith('/api/ordres/')) {
    try {
      return await ordres(request, env, deps, pathname);
    } catch (error) {
      if (error instanceof OrdreError) return json(error.body, error.status);
      (deps.log ?? (() => {}))('ordres: erreur interne');
      return json({ error: 'internal' }, 500);
    }
  }
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  if (pathname === '/api/projets') {
    try {
      const gh = new GithubClient(env, deps.fetch, () => deps.now().getTime());
      const body: ProjetsResponse = await readProjects(gh, deps.projets, deps.now());
      return json(body);
    } catch {
      return json({ error: 'github_unavailable' }, 502);
    }
  }

  if (pathname === '/api/sessions') {
    const snapshot = await readSnapshot(env);
    if (snapshot === 'invalid') return json({ error: 'snapshot_invalid' }, 502);
    const body: SessionsResponse = { snapshotAt: snapshot?.generatedAt ?? null, snapshot };
    return json(body);
  }

  if (pathname === '/api/decisions') {
    const log = deps.log ?? (() => {});
    let body: DecisionsResponse;
    try {
      body = await loadDecisions(env, deps, deps.projets);
    } catch {
      return json({ error: 'decisions_unavailable' }, 502);
    }
    // Sans la base (pas encore créée, ou en panne), les décisions s'affichent quand même, sans leur ordre.
    if (env.VIGIE_DB) {
      try {
        body = { ...body, decisions: await attachAnswers(env.VIGIE_DB, body.decisions, deps.now()) };
      } catch {
        log('decisions: lecture des ordres impossible, décisions sans réponse');
      }
    }
    return json(body);
  }

  return json({ error: 'not_found' }, 404);
}

const isApi = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/');

/** Point d'entrée : `/api/*` passe par l'API, tout le reste est servi depuis les fichiers de l'app. */
export async function route(request: Request, env: Env, deps?: Deps): Promise<Response> {
  if (isApi(new URL(request.url).pathname)) return handle(request, env, deps);
  if (!env.ASSETS) return json({ error: 'not_found' }, 404);
  return env.ASSETS.fetch(request);
}

export default {
  fetch: (request: Request, env: Env) => route(request, env),
};
