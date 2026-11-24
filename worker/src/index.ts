import type { ProjetsResponse, SessionsResponse } from '../../src/data/api';
import type { SessionSnapshot } from '../../src/data/snapshot';
import config from '../../config/projets.json';
import { GithubClient, type FetchFn, type GithubEnv } from './github';
import { readProjects, type ProjetConfig } from './projets';

export interface Env extends GithubEnv {
  VIGIE_SNAPSHOT: KVNamespace;
}

export interface Deps {
  fetch: FetchFn;
  projets: ProjetConfig[];
  now: () => Date;
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
});

/** Routes en lecture seule : GET /api/projets et GET /api/sessions. Tout le reste est refusé. */
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
    const raw = await env.VIGIE_SNAPSHOT.get(SNAPSHOT_KEY);
    if (raw === null) {
      const empty: SessionsResponse = { snapshotAt: null, snapshot: null };
      return json(empty);
    }
    let snapshot: SessionSnapshot;
    try {
      snapshot = JSON.parse(raw) as SessionSnapshot;
    } catch {
      return json({ error: 'snapshot_invalid' }, 502);
    }
    if (snapshot.version !== 1 || !Array.isArray(snapshot.sessions) || typeof snapshot.generatedAt !== 'string') {
      return json({ error: 'snapshot_invalid' }, 502);
    }
    const body: SessionsResponse = { snapshotAt: snapshot.generatedAt, snapshot };
    return json(body);
  }

  return json({ error: 'not_found' }, 404);
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
};
