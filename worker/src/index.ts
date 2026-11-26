import type { DecisionsResponse, ProjetsResponse, SessionsResponse } from '../../src/data/api';
import type { SessionSnapshot } from '../../src/data/snapshot';
import config from '../../config/projets.json';
import { readDecisions, type Log } from './decisions';
import { GithubClient, type FetchFn, type GithubEnv } from './github';
import { readProjects, type ProjetConfig } from './projets';

export interface Env extends GithubEnv {
  VIGIE_SNAPSHOT: KVNamespace;
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

/** Routes en lecture seule : GET /api/projets, /api/sessions et /api/decisions. Tout le reste est refusé. */
export async function handle(request: Request, env: Env, deps: Deps = defaults()): Promise<Response> {
  const { pathname } = new URL(request.url);
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
    try {
      let snapshot = await readSnapshot(env);
      if (snapshot === 'invalid') {
        log('decisions: instantané illisible, questions des sessions ignorées');
        snapshot = null;
      }
      const gh = new GithubClient(env, deps.fetch, () => deps.now().getTime());
      const body: DecisionsResponse = await readDecisions(gh, deps.projets, snapshot, deps.now(), log);
      return json(body);
    } catch {
      return json({ error: 'decisions_unavailable' }, 502);
    }
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
