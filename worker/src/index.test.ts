import { beforeAll, describe, expect, it } from 'vitest';
import { handle, route, type Deps, type Env } from './index';
import { createAppJwt } from './github';

let pem = '';

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  const b64 = btoa(String.fromCharCode(...der));
  pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`;
});

const NOW = new Date('2026-11-24T14:02:00Z');

function kv(value: string | null) {
  return { get: async () => value } as unknown as KVNamespace;
}

const makeEnv = (snapshot: string | null = null): Env => ({
  GITHUB_APP_ID: '123',
  GITHUB_APP_PRIVATE_KEY: pem,
  GITHUB_INSTALLATIONS: JSON.stringify({ GabinSMD: 1, 'SIMOND-ANCE-BROS': 2 }),
  VIGIE_SNAPSHOT: kv(snapshot),
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** GitHub simulé : jamais de réseau. Garde la liste des appels pour vérifier la lecture seule. */
function fakeGithub() {
  const calls: { url: string; method: string; auth: string | null }[] = [];
  const fetch: Deps['fetch'] = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: input, method: init?.method ?? 'GET', auth: headers.get('Authorization') });
    const path = input.replace('https://api.github.com', '');
    if (path.startsWith('/app/installations/')) {
      return ok({ token: 'ghs_FAKE', expires_at: '2026-11-24T15:00:00Z' });
    }
    if (path === '/repos/GabinSMD/Vigie') return ok({ default_branch: 'main', html_url: 'https://github.com/GabinSMD/Vigie' });
    if (path.startsWith('/repos/GabinSMD/Vigie/pulls')) {
      return ok([
        { number: 12, title: 'Prête', draft: false, html_url: 'https://github.com/GabinSMD/Vigie/pull/12', base: { ref: 'main' }, head: { sha: 'aaa' } },
        { number: 13, title: 'Brouillon', draft: true, html_url: 'https://github.com/GabinSMD/Vigie/pull/13', base: { ref: 'main' }, head: { sha: 'bbb' } },
        { number: 14, title: 'Casse', draft: false, html_url: 'https://github.com/GabinSMD/Vigie/pull/14', base: { ref: 'main' }, head: { sha: 'ccc' } },
      ]);
    }
    if (path.includes('/commits/aaa/check-runs')) return ok({ check_runs: [{ name: 'Tests', status: 'completed', conclusion: 'success' }] });
    if (path.includes('/commits/bbb/check-runs')) return ok({ check_runs: [{ name: 'Tests', status: 'in_progress', conclusion: null }] });
    if (path.includes('/commits/ccc/check-runs'))
      return ok({
        check_runs: [
          { name: 'Tests', status: 'completed', conclusion: 'success' },
          { name: 'Build', status: 'completed', conclusion: 'failure' },
        ],
      });
    if (path.startsWith('/repos/GabinSMD/Vigie/issues'))
      return ok([
        { number: 5, title: 'Une issue', html_url: 'https://github.com/GabinSMD/Vigie/issues/5' },
        { number: 12, title: 'La PR vue comme issue', html_url: 'x', pull_request: {} },
      ]);
    return new Response('{}', { status: 404 });
  };
  return { fetch, calls };
}

const projets = [
  { id: 'vigie', owner: 'GabinSMD', repo: 'Vigie', nom: 'Vigie' },
  { id: 'ecole-saas', owner: 'SIMOND-ANCE-BROS', repo: 'ecole-saas', nom: 'ecole-saas' },
];

const get = (path: string) => new Request(`https://vigie.example.org${path}`);

describe('GET /api/projets', () => {
  it('lit PR, CI et issues ; un dépôt en échec ne casse pas les autres', async () => {
    const gh = fakeGithub();
    const response = await handle(get('/api/projets'), makeEnv(), { fetch: gh.fetch, projets, now: () => NOW });
    expect(response.status).toBe(200);
    const body = (await response.json()) as import('../../src/data/api').ProjetsResponse;
    expect(body.generatedAt).toBe(NOW.toISOString());

    const vigie = body.projects.find((p) => p.id === 'vigie')!;
    expect(vigie.defaultBranch).toBe('main');
    expect(vigie.pullRequests.map((p) => [p.number, p.draft, p.ci])).toEqual([
      [12, false, 'success'],
      [13, true, 'pending'],
      [14, false, 'failure'],
    ]);
    expect(vigie.pullRequests[2]!.checks).toEqual([
      { name: 'Tests', state: 'success' },
      { name: 'Build', state: 'failure' },
    ]);
    expect(vigie.issues).toEqual([{ number: 5, title: 'Une issue', url: 'https://github.com/GabinSMD/Vigie/issues/5' }]);

    const ecole = body.projects.find((p) => p.id === 'ecole-saas')!;
    expect(ecole.error).toBeDefined();
    expect(ecole.pullRequests).toEqual([]);
  });

  it('ne fait que des lectures, avec un jeton d\'installation par compte, et ne le renvoie jamais', async () => {
    const gh = fakeGithub();
    const response = await handle(get('/api/projets'), makeEnv(), { fetch: gh.fetch, projets, now: () => NOW });
    const text = await response.text();
    expect(text).not.toContain('ghs_FAKE');
    expect(text).not.toContain('PRIVATE KEY');
    const writes = gh.calls.filter((c) => c.method !== 'GET' && !c.url.includes('/access_tokens'));
    expect(writes).toEqual([]);
    const tokenCalls = gh.calls.filter((c) => c.url.includes('/access_tokens'));
    // Les projets sont lus en parallèle : l'ordre des demandes de jeton n'est pas garanti.
    expect(tokenCalls.map((c) => c.url).sort()).toEqual([
      'https://api.github.com/app/installations/1/access_tokens',
      'https://api.github.com/app/installations/2/access_tokens',
    ]);
    for (const call of tokenCalls) expect(call.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('répond 502 sans détail si l\'App est mal configurée', async () => {
    const env = { ...makeEnv(), GITHUB_APP_PRIVATE_KEY: 'pas-une-clé' };
    const gh = fakeGithub();
    const response = await handle(get('/api/projets'), env, { fetch: gh.fetch, projets, now: () => NOW });
    // Chaque dépôt échoue séparément : la réponse reste 200, avec une erreur par projet et aucun secret.
    const text = await response.text();
    expect(text).not.toContain('pas-une-clé');
    expect(JSON.parse(text).projects.every((p: { error?: string }) => p.error)).toBe(true);
  });
});

describe('GET /api/sessions', () => {
  const snapshot = { version: 1, generatedAt: '2026-11-24T14:02:00Z', sessions: [] };

  it('renvoie l\'instantané et sa date', async () => {
    const response = await handle(get('/api/sessions'), makeEnv(JSON.stringify(snapshot)), { fetch: fakeGithub().fetch, projets, now: () => NOW });
    expect(await response.json()).toEqual({ snapshotAt: '2026-11-24T14:02:00Z', snapshot });
  });

  it('renvoie une réponse vide tant que le pilote n\'a rien écrit', async () => {
    const response = await handle(get('/api/sessions'), makeEnv(null), { fetch: fakeGithub().fetch, projets, now: () => NOW });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ snapshotAt: null, snapshot: null });
  });

  it('refuse un instantané illisible', async () => {
    for (const bad of ['{pas du json', JSON.stringify({ version: 2, sessions: [] })]) {
      const response = await handle(get('/api/sessions'), makeEnv(bad), { fetch: fakeGithub().fetch, projets, now: () => NOW });
      expect(response.status).toBe(502);
    }
  });
});

describe('routage', () => {
  it('refuse toute écriture et toute route inconnue', async () => {
    const deps = { fetch: fakeGithub().fetch, projets, now: () => NOW };
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await handle(new Request('https://vigie.example.org/api/sessions', { method }), makeEnv(), deps);
      expect(response.status).toBe(405);
    }
    expect((await handle(get('/api/autre'), makeEnv(), deps)).status).toBe(404);
  });
});

describe('static assets', () => {
  it('sert l\'app depuis ASSETS et garde /api/* pour l\'API', async () => {
    const seen: string[] = [];
    const ASSETS = { fetch: async (req: Request) => (seen.push(new URL(req.url).pathname), new Response('<html>', { status: 200 })) } as unknown as Fetcher;
    const env = { ...makeEnv(), ASSETS };
    const page = await route(new Request('https://vigie.example.org/'), env);
    expect(await page.text()).toBe('<html>');
    const asset = await route(new Request('https://vigie.example.org/assets/index.js'), env);
    expect(asset.status).toBe(200);
    const api = await route(new Request('https://vigie.example.org/api/sessions'), env);
    expect(await api.json()).toEqual({ snapshotAt: null, snapshot: null });
    expect((await route(new Request('https://vigie.example.org/api/autre'), env)).status).toBe(404);
    expect(seen).toEqual(['/', '/assets/index.js']);
  });

  it('répond 404 hors /api/* quand ASSETS est absent', async () => {
    expect((await route(new Request('https://vigie.example.org/'), makeEnv())).status).toBe(404);
  });
});

describe('JWT d\'App', () => {
  it('a la forme RS256 attendue par GitHub', async () => {
    const jwt = await createAppJwt('123', pem, 1_800_000_000);
    const [h, p] = jwt.split('.').slice(0, 2).map((part) => JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))));
    expect(h).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(p).toEqual({ iat: 1_800_000_000 - 60, exp: 1_800_000_000 + 540, iss: '123' });
  });

  it('refuse une clé PKCS#1 avec un message qui dit quoi faire', async () => {
    await expect(createAppJwt('1', '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----', 0)).rejects.toThrow(/PKCS#8/);
  });
});
