import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DecisionsResponse, Ordre, OrdreResponse, OrdresResponse } from '../../src/data/api';
import { SECRET_WARNING, orderExpiresAt } from '../../src/data/ordre';
import { resetAccessCache, teamIssuer, verifyAccess } from './access';
import { handle, type Deps, type Env } from './index';
import { newOrdreId } from './ordres';
import { AUD, CERTS_URL, TEAM, claims, makeTeam, type TestTeam } from './test/access';
import { fakeD1 } from './test/d1';

/** 14 h 05 à Paris. */
const NOW = new Date('2026-11-26T13:05:00Z');
const GABIN = { email: 'gabin@example.org' };
const PILOTE = { common_name: 'client-id-test.access' };
/** Jeton factice, généré pour les tests. */
const PILOT_TOKEN = `test-${crypto.randomUUID()}`;

let team: TestTeam;
let other: TestTeam;
let pem = '';

beforeAll(async () => {
  team = await makeTeam();
  other = await makeTeam('kid-test-1'); // Même kid, autre clé : signature fausse.
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`;
});

beforeEach(() => resetAccessCache());

const snapshot = {
  version: 1,
  generatedAt: '2026-11-26T12:00:00Z',
  sessions: [
    {
      id: 'session_01ABC',
      projectId: 'vigie',
      role: 'Développeur',
      ref: '#1039',
      title: 'Critère de reprise',
      status: 'attention',
      statusLabel: 'Attend toi',
      line: 'Attend ta réponse',
      summary: '',
      events: [],
      questions: [
        {
          id: '1039-critere-reprise',
          title: 'Quel critère pour reprendre les mises en production sur staging ?',
          detail: 'Les tests échouent 1 fois sur 10.',
          prRef: '#1039',
          options: [
            { id: 'trois-verts', label: "3 passages verts d'affilée" },
            { id: 'taux', label: "Moins de 2 % d'échecs" },
          ],
          recommended: 'trois-verts',
          reversible: true,
          topic: 'technique',
          freeText: 'facultatif',
          links: [{ kind: 'pr', number: 1039 }, { kind: 'issue', number: 1020 }],
          blocking: true,
        },
        {
          id: 'nom-depot',
          title: 'Quel nom pour le dépôt ?',
          detail: 'Le dépôt finaliste reste à créer.',
          prRef: '',
          options: [
            { id: 'finaliste', label: 'finaliste' },
            { id: 'autre', label: 'Un autre nom' },
          ],
          reversible: false,
          freeText: 'obligatoire',
        },
        { id: 'oui-non-simple', title: 'On garde le thème sombre ?', detail: 'Question simple.', prRef: '', reversible: true, freeText: 'non' },
        {
          id: 'test-android',
          title: 'As-tu fait le test Android ?',
          detail: 'Il faut le téléphone.',
          prRef: '',
          kind: 'action',
          options: [
            { id: 'fait', label: 'Fait, ça marche' },
            { id: 'pas-encore', label: 'Pas encore' },
          ],
          reversible: true,
        },
      ],
      deliverables: [{ id: 'livrable-ecran', title: "L'écran des décisions" }],
    },
  ],
};

const projets = [{ id: 'vigie', owner: 'GabinSMD', repo: 'Vigie', nom: 'Vigie' }];

const kv = (value: string | null) => ({ get: async () => value }) as unknown as KVNamespace;

/** GitHub (aucune issue ni PR) et certificats Access simulés : jamais de réseau. */
function fakeFetch(calls: string[] = []): Deps['fetch'] {
  return async (input) => {
    calls.push(input);
    if (input === CERTS_URL) return new Response(JSON.stringify(team.certs), { status: 200 });
    if (input.includes('/app/installations/')) return new Response(JSON.stringify({ token: 'ghs_FAKE', expires_at: '2026-11-26T15:00:00Z' }), { status: 200 });
    if (input.includes('/issues?') || input.includes('/pulls?')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 404 });
  };
}

function setup(overrides: Partial<Env> = {}) {
  const { d1, sqlite } = fakeD1();
  const logs: string[] = [];
  let now = NOW;
  const env: Env = {
    GITHUB_APP_ID: '1',
    GITHUB_APP_PRIVATE_KEY: pem,
    GITHUB_INSTALLATIONS: JSON.stringify({ GabinSMD: 1 }),
    VIGIE_SNAPSHOT: kv(JSON.stringify(snapshot)),
    VIGIE_DB: d1,
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    PILOT_TOKEN,
    ...overrides,
  };
  const deps: Deps = { fetch: fakeFetch(), projets, now: () => now, log: (l) => logs.push(l) };
  const count = (table: 'ordres' | 'journal') => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const dump = () => JSON.stringify([sqlite.prepare('SELECT * FROM ordres').all(), sqlite.prepare('SELECT * FROM journal').all()]);
  const journal = () => sqlite.prepare('SELECT * FROM journal ORDER BY seq').all() as Record<string, unknown>[];
  return { env, deps, sqlite, logs, count, dump, journal, setNow: (d: Date) => (now = d) };
}

type Ctx = ReturnType<typeof setup>;

const url = (path: string) => `https://vigie.example.org${path}`;

async function asUser(ctx: Ctx, body: unknown, who: { email: string } | { common_name: string } = GABIN) {
  const jwt = await team.sign(claims(ctx.deps.now().getTime(), who));
  return handle(
    new Request(url('/api/ordres'), { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': jwt, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    ctx.env,
    ctx.deps,
  );
}

async function asPilot(ctx: Ctx, method: 'GET' | 'PATCH', path: string, body?: unknown, token: string | null = PILOT_TOKEN) {
  const jwt = await team.sign(claims(ctx.deps.now().getTime(), PILOTE));
  const headers: Record<string, string> = { 'Cf-Access-Jwt-Assertion': jwt };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return handle(new Request(url(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), ctx.env, ctx.deps);
}

const answer = (decisionId: string, optionId: string, text?: string) => ({ type: 'repondre', projectId: 'vigie', decisionId, optionId, ...(text !== undefined ? { text } : {}) });

async function created(response: Response): Promise<Ordre> {
  expect(response.status).toBe(201);
  return ((await response.json()) as OrdreResponse).ordre;
}

describe('POST /api/ordres : contrôle 1, identité Access', () => {
  it('refuse sans en-tête, avec une signature fausse, une autre audience, un autre émetteur ou un jeton expiré (401)', async () => {
    const ctx = setup();
    const t = NOW.getTime();
    const bad = [
      undefined,
      'pas.un.jwt',
      await other.sign(claims(t, GABIN)),
      await team.sign(claims(t, GABIN, { aud: ['autre-application'] })),
      await team.sign(claims(t, GABIN, { iss: 'https://autre.cloudflareaccess.com' })),
      await team.sign(claims(t, GABIN, { exp: Math.floor(t / 1000) - 120 })),
      await team.sign(claims(t, GABIN, { nbf: Math.floor(t / 1000) + 600 })),
      await team.sign(claims(t, GABIN), { alg: 'HS256' }),
      await team.sign(claims(t, GABIN), { kid: 'kid-inconnu' }),
      await team.sign(claims(t, { email: '' })),
    ];
    for (const jwt of bad) {
      const headers: Record<string, string> = jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {};
      const response = await handle(new Request(url('/api/ordres'), { method: 'POST', headers, body: JSON.stringify(answer('1039-critere-reprise', 'trois-verts')) }), ctx.env, ctx.deps);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: 'unauthorized' });
    }
    expect(ctx.count('ordres')).toBe(0);
    // Le journal du Worker dit pourquoi, jamais le jeton.
    expect(ctx.logs.join('\n')).not.toMatch(/eyJ/);
  });

  it("refuse tant qu'Access n'est pas configuré (valeurs factices ou absentes)", async () => {
    for (const env of [{ ACCESS_TEAM_DOMAIN: undefined }, { ACCESS_AUD: '' }, { ACCESS_TEAM_DOMAIN: 'exemple.org' }]) {
      const ctx = setup(env);
      expect((await asUser(ctx, answer('1039-critere-reprise', 'trois-verts'))).status).toBe(401);
    }
  });

  it('le pilote (jeton de service) ne peut pas créer d\'ordre (403)', async () => {
    const ctx = setup();
    const response = await asUser(ctx, answer('1039-critere-reprise', 'trois-verts'), PILOTE);
    expect(response.status).toBe(403);
    expect(ctx.count('ordres')).toBe(0);
  });
});

describe('POST /api/ordres : contrôles 2 et 3', () => {
  it('404 pour une décision ou un projet inconnus', async () => {
    const ctx = setup();
    expect((await asUser(ctx, answer('inconnue', 'oui'))).status).toBe(404);
    expect((await asUser(ctx, { ...answer('1039-critere-reprise', 'trois-verts'), projectId: 'autre' })).status).toBe(404);
    expect(ctx.count('ordres')).toBe(0);
  });

  it('422 pour un type hors de la liste fermée', async () => {
    const ctx = setup();
    const response = await asUser(ctx, { ...answer('1039-critere-reprise', 'trois-verts'), type: 'fusionner' });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'type_inconnu' });
  });

  it('400 pour un corps illisible', async () => {
    const ctx = setup();
    const jwt = await team.sign(claims(NOW.getTime(), GABIN));
    const response = await handle(new Request(url('/api/ordres'), { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': jwt }, body: '{pas du json' }), ctx.env, ctx.deps);
    expect(response.status).toBe(400);
  });

  it.each([
    ['option inconnue', answer('1039-critere-reprise', 'manuel'), 'option_inconnue'],
    ['texte obligatoire manquant', answer('nom-depot', 'autre', '   '), 'texte_manquant'],
    ['texte alors que freeText vaut non', answer('oui-non-simple', 'oui', 'précision'), 'texte_interdit'],
    ['texte trop long', answer('1039-critere-reprise', 'taux', 'é'.repeat(2001)), 'texte_trop_long'],
  ])('422 : %s', async (_name, body, error) => {
    const ctx = setup();
    const response = await asUser(ctx, body);
    expect(response.status).toBe(422);
    const json = (await response.json()) as { error: string; message: string };
    expect(json.error).toBe(error);
    expect(json.message).toBeTruthy();
    expect(ctx.count('ordres')).toBe(0);
    expect(ctx.count('journal')).toBe(0);
  });

  it("422 avec le message de l'écran pour un texte qui ressemble à un secret, et rien n'est stocké ni journalisé", async () => {
    const ctx = setup();
    const secret = `ghp_${'A1b2C3d4'.repeat(5)}`;
    const response = await asUser(ctx, answer('1039-critere-reprise', 'taux', `voici la clé ${secret}`));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'secret', message: SECRET_WARNING });
    expect(ctx.count('ordres')).toBe(0);
    expect(ctx.count('journal')).toBe(0);
    expect(ctx.dump()).not.toContain(secret);
    expect(ctx.logs.join('\n')).not.toContain(secret);
  });
});

describe('POST /api/ordres : écriture', () => {
  it("crée l'ordre : id, target, question et option recopiés depuis la décision, expiration D10, journal", async () => {
    const ctx = setup();
    const ordre = await created(
      await asUser(ctx, { ...answer('1039-critere-reprise', 'trois-verts', "  D'accord, mais on repasse au taux.  "), target: { kind: 'issue', number: 1 }, id: 'ord_FAUX', by: 'pirate' }),
    );
    expect(ordre).toMatchObject({
      type: 'repondre',
      createdAt: '2026-11-26T13:05:00.000Z',
      expiresAt: '2026-11-26T16:05:00.000Z',
      by: 'gabin@example.org',
      projectId: 'vigie',
      decisionId: '1039-critere-reprise',
      question: 'Quel critère pour reprendre les mises en production sur staging ?',
      target: { kind: 'session', id: 'session_01ABC', fallbackIssue: 1020 },
      optionId: 'trois-verts',
      optionLabel: "3 passages verts d'affilée",
      text: "D'accord, mais on repasse au taux.",
      status: 'en_attente',
    });
    expect(ordre.id).toMatch(/^ord_[0-9A-Z]{22}$/);
    expect(ctx.journal()).toEqual([
      expect.objectContaining({ who: 'gabin@example.org', action: 'creer', ordre_id: ordre.id, decision_id: '1039-critere-reprise', option_id: 'trois-verts', result: 'en_attente' }),
    ]);
    // Le journal ne recopie jamais le texte.
    expect(JSON.stringify(ctx.journal())).not.toContain('repasse');
  });

  it('accepte un oui/non sans texte, et la réponse à un livrable', async () => {
    const ctx = setup();
    expect((await created(await asUser(ctx, answer('oui-non-simple', 'non')))).text).toBeUndefined();
    expect((await created(await asUser(ctx, answer('livrable-ecran', 'oui')))).target).toEqual({ kind: 'session', id: 'session_01ABC' });
  });

  it('remplace la réponse encore en attente (« Modifier »), une seule réponse active', async () => {
    const ctx = setup();
    const first = await created(await asUser(ctx, answer('1039-critere-reprise', 'trois-verts')));
    ctx.setNow(new Date(NOW.getTime() + 60_000));
    const second = await created(await asUser(ctx, answer('1039-critere-reprise', 'taux', 'Finalement le taux.')));
    const rows = ctx.sqlite.prepare('SELECT id, status, reason FROM ordres ORDER BY created_at').all();
    expect(rows).toEqual([
      { id: first.id, status: 'refuse', reason: 'Remplacée par une nouvelle réponse.' },
      { id: second.id, status: 'en_attente', reason: null },
    ]);
    expect(ctx.journal().map((j) => [j.action, j.result])).toEqual([
      ['creer', 'en_attente'],
      ['remplacer', `remplace ${first.id}`],
    ]);
  });

  it('409 « Déjà transmise » une fois l\'ordre pris par le pilote', async () => {
    const ctx = setup();
    const ordre = await created(await asUser(ctx, answer('1039-critere-reprise', 'trois-verts')));
    expect((await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'pris' })).status).toBe(200);
    const response = await asUser(ctx, answer('1039-critere-reprise', 'taux'));
    expect(response.status).toBe(409);
    // La réponse prise est renvoyée : la carte l'affiche « Envoyée », non modifiable, au lieu de « Refusée ».
    expect(await response.json()).toMatchObject({
      error: 'deja_transmise',
      message: expect.stringContaining('Déjà transmise'),
      answer: { id: ordre.id, status: 'pris', optionId: 'trois-verts', expiresAt: ordre.expiresAt },
    });
    expect(ctx.count('ordres')).toBe(1);
  });

  it('409 avec la réponse prise si le pilote la prend entre la lecture et l\'écriture', async () => {
    const ctx = setup();
    const ordre = await created(await asUser(ctx, answer('1039-critere-reprise', 'trois-verts')));
    const db = ctx.env.VIGIE_DB!;
    ctx.env.VIGIE_DB = {
      prepare: (sql: string) => db.prepare(sql),
      batch: async (statements: D1PreparedStatement[]) => {
        ctx.sqlite.exec(`UPDATE ordres SET status = 'pris', taken_at = '${NOW.toISOString()}' WHERE status = 'en_attente'`);
        return db.batch(statements);
      },
    } as unknown as D1Database;
    const response = await asUser(ctx, answer('1039-critere-reprise', 'taux'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'deja_transmise', answer: { id: ordre.id, status: 'pris', optionId: 'trois-verts' } });
    expect(ctx.count('ordres')).toBe(1);
    expect(ctx.count('journal')).toBe(1);
  });

  it('409 « Déjà répondue » après `fait`, sauf pour une action (« Pas encore » ne clôt pas)', async () => {
    const ctx = setup();
    for (const [decision, option] of [['1039-critere-reprise', 'trois-verts'], ['test-android', 'pas-encore']]) {
      const ordre = await created(await asUser(ctx, answer(decision, option)));
      await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'pris' });
      await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'fait', result: 'Transmis à la session' });
    }
    const response = await asUser(ctx, answer('1039-critere-reprise', 'taux'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'deja_repondue',
      answer: { status: 'fait', optionId: 'trois-verts', result: 'Transmis à la session' },
    });
    await created(await asUser(ctx, answer('test-android', 'fait')));
  });

  it('un ordre expiré se renvoie (« Renvoyer ») : il passe à `expire`, le nouveau part', async () => {
    const ctx = setup();
    const first = await created(await asUser(ctx, answer('1039-critere-reprise', 'trois-verts')));
    ctx.setNow(new Date(first.expiresAt));
    const again = await created(await asUser(ctx, answer('1039-critere-reprise', 'trois-verts')));
    expect(ctx.sqlite.prepare('SELECT id, status FROM ordres ORDER BY created_at').all()).toEqual([
      { id: first.id, status: 'expire' },
      { id: again.id, status: 'en_attente' },
    ]);
  });
});

describe('expiration (D10, heure de Paris)', () => {
  it.each([
    ['jour : 14 h 05 → 17 h 05', '2026-11-26T13:05:00Z', '2026-11-26T16:05:00.000Z'],
    ['soir : 20 h 30 → 23 h 30 (le passage de 21 h la prend)', '2026-11-26T19:30:00Z', '2026-11-26T22:30:00.000Z'],
    ['nuit : 23 h → le lendemain 9 h', '2026-11-26T22:00:00Z', '2026-11-27T08:00:00.000Z'],
    ['nuit : 21 h 30 → le lendemain 9 h', '2026-11-26T20:30:00Z', '2026-11-27T08:00:00.000Z'],
    ['petit matin : 5 h → 9 h', '2026-11-26T04:00:00Z', '2026-11-26T08:00:00.000Z'],
    ['matin : 7 h → 10 h', '2026-11-26T06:00:00Z', '2026-11-26T09:00:00.000Z'],
    ["heure d'été : 23 h → 9 h (UTC+2)", '2026-07-01T21:00:00Z', '2026-07-02T07:00:00.000Z'],
  ])('%s', (_name, created, expected) => {
    expect(orderExpiresAt(new Date(created)).toISOString()).toBe(expected);
  });
});

describe('ordres côté pilote', () => {
  it('jeton du pilote absent ou faux : 401 ; bon : 200', async () => {
    const ctx = setup();
    await created(await asUser(ctx, answer('1039-critere-reprise', 'trois-verts')));
    expect((await asPilot(ctx, 'GET', '/api/ordres?status=en_attente', undefined, null)).status).toBe(401);
    expect((await asPilot(ctx, 'GET', '/api/ordres?status=en_attente', undefined, 'faux')).status).toBe(401);
    expect((await asPilot(ctx, 'GET', '/api/ordres?status=en_attente', undefined, `${PILOT_TOKEN}x`)).status).toBe(401);
    const ok = await asPilot(ctx, 'GET', '/api/ordres?status=en_attente');
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as OrdresResponse;
    expect(body.ordres.map((o) => [o.decisionId, o.status, o.text])).toEqual([['1039-critere-reprise', 'en_attente', undefined]]);
    expect(ctx.logs.join('\n')).not.toContain(PILOT_TOKEN);
  });

  it('sans PILOT_TOKEN posé, ou sans Access, tout est refusé', async () => {
    const ctx = setup({ PILOT_TOKEN: undefined });
    expect((await asPilot(ctx, 'GET', '/api/ordres')).status).toBe(401);
    const ctx2 = setup();
    const response = await handle(new Request(url('/api/ordres'), { headers: { Authorization: `Bearer ${PILOT_TOKEN}` } }), ctx2.env, ctx2.deps);
    expect(response.status).toBe(401);
  });

  it("ne liste pas les ordres expirés parmi ceux en attente ; refuse de prendre un ordre expiré", async () => {
    const ctx = setup();
    const ordre = await created(await asUser(ctx, answer('1039-critere-reprise', 'trois-verts')));
    ctx.setNow(new Date(ordre.expiresAt));
    expect(((await (await asPilot(ctx, 'GET', '/api/ordres')).json()) as OrdresResponse).ordres).toEqual([]);
    expect(((await (await asPilot(ctx, 'GET', '/api/ordres?status=expire')).json()) as OrdresResponse).ordres.map((o) => o.id)).toEqual([ordre.id]);
    const response = await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'pris' });
    expect(response.status).toBe(409);
  });

  it('en_attente → pris → fait, avec doneAt et result, et le journal', async () => {
    const ctx = setup();
    const ordre = await created(await asUser(ctx, answer('1039-critere-reprise', 'trois-verts', 'Le texte')));
    ctx.setNow(new Date('2026-11-26T14:00:30Z'));
    const taken = (await (await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'pris' })).json()) as OrdreResponse;
    expect(taken.ordre).toMatchObject({ status: 'pris', takenAt: '2026-11-26T14:00:30.000Z', text: 'Le texte' });
    ctx.setNow(new Date('2026-11-26T14:01:00Z'));
    const done = (await (await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'fait', result: 'Transmis à la session' })).json()) as OrdreResponse;
    expect(done.ordre).toMatchObject({ status: 'fait', doneAt: '2026-11-26T14:01:00.000Z', result: 'Transmis à la session' });
    expect(ctx.journal().map((j) => [j.who, j.action, j.result])).toEqual([
      ['gabin@example.org', 'creer', 'en_attente'],
      ['pilote', 'prendre', 'pris'],
      ['pilote', 'fait', 'Transmis à la session'],
    ]);
  });

  it('pris → refuse avec la raison ; transitions interdites : 409, ordre inconnu : 404', async () => {
    const ctx = setup();
    const ordre = await created(await asUser(ctx, answer('1039-critere-reprise', 'trois-verts')));
    expect((await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'fait', result: 'x' })).status).toBe(409);
    await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'pris' });
    expect((await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'pris' })).status).toBe(409);
    const refused = await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'refuse', reason: 'Session fermée, aucune issue liée' });
    expect(((await refused.json()) as OrdreResponse).ordre).toMatchObject({ status: 'refuse', reason: 'Session fermée, aucune issue liée' });
    expect((await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'fait', result: 'x' })).status).toBe(409);
    expect((await asPilot(ctx, 'PATCH', `/api/ordres/${newOrdreId(NOW)}`, { status: 'pris' })).status).toBe(404);
    expect((await asPilot(ctx, 'PATCH', '/api/ordres/pas-un-id', { status: 'pris' })).status).toBe(404);
    expect(ctx.journal().filter((j) => j.who === 'pilote').map((j) => j.action)).toEqual(['prendre', 'refuse']);
  });

  it('refuse un result ou une reason qui ressemble à un secret, ou un statut inconnu', async () => {
    const ctx = setup();
    const ordre = await created(await asUser(ctx, answer('1039-critere-reprise', 'trois-verts')));
    await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'pris' });
    expect((await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'fait', result: 'token=abc' })).status).toBe(422);
    expect((await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'expire' })).status).toBe(400);
    expect((await asPilot(ctx, 'GET', '/api/ordres?status=nimporte')).status).toBe(400);
  });

  it('les routes d\'ordres répondent 503 tant que la base D1 n\'existe pas', async () => {
    const ctx = setup({ VIGIE_DB: undefined });
    expect((await asUser(ctx, answer('1039-critere-reprise', 'trois-verts'))).status).toBe(503);
    expect((await asPilot(ctx, 'GET', '/api/ordres')).status).toBe(503);
  });

  it('405 pour une autre méthode', async () => {
    const ctx = setup();
    expect((await handle(new Request(url('/api/ordres'), { method: 'DELETE' }), ctx.env, ctx.deps)).status).toBe(405);
  });
});

describe('ordre pris puis abandonné par le pilote (plus de 2 h)', () => {
  const HOUR = 3_600_000;
  const at = (ms: number) => new Date(NOW.getTime() + ms);
  const read = async (ctx: Ctx) =>
    ((await (await handle(new Request(url('/api/decisions')), ctx.env, ctx.deps)).json()) as DecisionsResponse).decisions.find(
      (d) => d.id === '1039-critere-reprise',
    )!.answer;

  async function taken(ctx: Ctx) {
    const ordre = await created(await asUser(ctx, answer('1039-critere-reprise', 'trois-verts')));
    expect((await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'pris' })).status).toBe(200);
    return ordre;
  }

  it('bloque encore à 1 h 59, puis est rendu « Refusée » avec une raison, sans écriture', async () => {
    const ctx = setup();
    const ordre = await taken(ctx);
    ctx.setNow(at(2 * HOUR - 60_000));
    expect((await asUser(ctx, answer('1039-critere-reprise', 'taux'))).status).toBe(409);
    expect(await read(ctx)).toMatchObject({ id: ordre.id, status: 'pris' });

    ctx.setNow(at(2 * HOUR));
    expect(await read(ctx)).toMatchObject({ id: ordre.id, status: 'refuse', reason: expect.stringContaining('ne l\'a pas terminée') });
    const list = async (status: string) =>
      ((await (await asPilot(ctx, 'GET', `/api/ordres?status=${status}`)).json()) as OrdresResponse).ordres.map((o) => o.id);
    expect(await list('pris')).toEqual([]);
    expect(await list('refuse')).toEqual([ordre.id]);
    expect(ctx.sqlite.prepare('SELECT status FROM ordres').all()).toEqual([{ status: 'pris' }]);
  });

  it('une nouvelle réponse libère la décision : l’ancien ordre passe à `refuse`, journalisé', async () => {
    const ctx = setup();
    const ordre = await taken(ctx);
    ctx.setNow(at(3 * HOUR));
    const next = await created(await asUser(ctx, answer('1039-critere-reprise', 'taux')));
    expect(ctx.sqlite.prepare('SELECT id, status, reason FROM ordres ORDER BY created_at').all()).toEqual([
      { id: ordre.id, status: 'refuse', reason: expect.stringContaining('ne l\'a pas terminée') },
      { id: next.id, status: 'en_attente', reason: null },
    ]);
    expect(ctx.journal().map((j) => [j.who, j.action, j.ordre_id])).toEqual([
      [GABIN.email, 'creer', ordre.id],
      ['pilote', 'prendre', ordre.id],
      ['vigie', 'refuse', ordre.id],
      [GABIN.email, 'creer', next.id],
    ]);
    expect(await read(ctx)).toMatchObject({ id: next.id, status: 'en_attente' });
    // Le pilote qui reviendrait finir l'ancien ordre est refusé : il l'ignore.
    expect((await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'fait', result: 'Transmis à la session' })).status).toBe(409);
  });

  it('le pilote peut encore le terminer tant que rien ne l’a remplacé', async () => {
    const ctx = setup();
    const ordre = await taken(ctx);
    ctx.setNow(at(5 * HOUR));
    const done = await asPilot(ctx, 'PATCH', `/api/ordres/${ordre.id}`, { status: 'fait', result: 'Transmis à la session' });
    expect(done.status).toBe(200);
    expect(await read(ctx)).toMatchObject({ id: ordre.id, status: 'fait', result: 'Transmis à la session' });
  });
});

describe('GET /api/decisions avec les ordres', () => {
  it("joint l'ordre le plus récent à chaque décision ; un ordre en attente expiré est rendu `expire`", async () => {
    const ctx = setup();
    await created(await asUser(ctx, answer('1039-critere-reprise', 'trois-verts')));
    const latest = await created(await asUser(ctx, answer('1039-critere-reprise', 'taux', 'Le taux.')));
    const nom = await created(await asUser(ctx, answer('nom-depot', 'finaliste', 'finaliste')));
    await asPilot(ctx, 'PATCH', `/api/ordres/${nom.id}`, { status: 'pris' });
    await asPilot(ctx, 'PATCH', `/api/ordres/${nom.id}`, { status: 'fait', result: "Posé sur l'issue #1020" });

    const read = async () =>
      ((await (await handle(new Request(url('/api/decisions')), ctx.env, ctx.deps)).json()) as DecisionsResponse).decisions;
    let decisions = await read();
    expect(decisions.find((d) => d.id === '1039-critere-reprise')!.answer).toEqual({
      id: latest.id,
      status: 'en_attente',
      optionId: 'taux',
      text: 'Le taux.',
      createdAt: latest.createdAt,
      expiresAt: latest.expiresAt,
    });
    expect(decisions.find((d) => d.id === 'nom-depot')!.answer).toMatchObject({ status: 'fait', result: "Posé sur l'issue #1020" });
    expect(decisions.find((d) => d.id === 'oui-non-simple')!.answer).toBeUndefined();
    expect(decisions.find((d) => d.id === 'livrable-ecran')).toMatchObject({ kind: 'validation', freeText: 'non', reversible: true });

    ctx.setNow(new Date(latest.expiresAt));
    decisions = await read();
    expect(decisions.find((d) => d.id === '1039-critere-reprise')!.answer).toMatchObject({ status: 'expire', reason: expect.any(String) });
  });

  it('sans base, ou si la lecture des ordres échoue, les décisions restent lisibles sans réponse', async () => {
    const ctx = setup({ VIGIE_DB: undefined });
    const response = await handle(new Request(url('/api/decisions')), ctx.env, ctx.deps);
    expect(response.status).toBe(200);
    const broken = { prepare: () => { throw new Error('panne'); } } as unknown as D1Database;
    const ctx2 = setup({ VIGIE_DB: broken });
    const body = (await (await handle(new Request(url('/api/decisions')), ctx2.env, ctx2.deps)).json()) as DecisionsResponse;
    expect(body.decisions.length).toBeGreaterThan(0);
    expect(body.decisions.every((d) => !d.answer)).toBe(true);
  });
});

describe('vérification Access', () => {
  it("relit les certificats une fois si la clé a tourné, et les garde en mémoire sinon", async () => {
    const calls: string[] = [];
    const fetchFn = fakeFetch(calls);
    const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
    const t = NOW.getTime();
    const req = async () => new Request(url('/api/ordres'), { headers: { 'Cf-Access-Jwt-Assertion': await team.sign(claims(t, GABIN)) } });
    expect(await verifyAccess(await req(), env, fetchFn, t)).toEqual({ ok: true, identity: { kind: 'user', email: 'gabin@example.org' } });
    expect(await verifyAccess(await req(), env, fetchFn, t)).toMatchObject({ ok: true });
    expect(calls.filter((c) => c === CERTS_URL)).toHaveLength(1);
    const unknown = new Request(url('/'), { headers: { 'Cf-Access-Jwt-Assertion': await team.sign(claims(t, GABIN), { kid: 'autre' }) } });
    expect(await verifyAccess(unknown, env, fetchFn, t)).toEqual({ ok: false, reason: 'unknown_key' });
    expect(calls.filter((c) => c === CERTS_URL)).toHaveLength(2);
  });

  it("reconnaît un jeton de service et refuse si les certificats sont injoignables", async () => {
    const t = NOW.getTime();
    const env = { ACCESS_TEAM_DOMAIN: `https://${TEAM}/`, ACCESS_AUD: AUD };
    const req = new Request(url('/'), { headers: { 'Cf-Access-Jwt-Assertion': await team.sign(claims(t, PILOTE)) } });
    expect(await verifyAccess(req, env, fakeFetch(), t)).toEqual({ ok: true, identity: { kind: 'service', clientId: PILOTE.common_name } });
    resetAccessCache();
    const down = async () => new Response('', { status: 500 });
    expect(await verifyAccess(req, env, down, t)).toEqual({ ok: false, reason: 'certs_unavailable' });
  });

  it("n'accepte que les domaines d'équipe Access", () => {
    expect(teamIssuer('Equipe.cloudflareaccess.com')).toBe('https://equipe.cloudflareaccess.com');
    expect(teamIssuer('https://equipe.cloudflareaccess.com/')).toBe('https://equipe.cloudflareaccess.com');
    expect(teamIssuer('evil.example.org')).toBeNull();
    expect(teamIssuer('equipe.cloudflareaccess.com.evil.org')).toBeNull();
  });
});
