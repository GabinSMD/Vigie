import { beforeAll, describe, expect, it } from 'vitest';
import type { Decision, DecisionsResponse } from '../../src/data/api';
import { handle, type Deps, type Env } from './index';
import { dependabotMajor } from './decisions';

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

const NOW = new Date('2026-11-26T10:00:00Z');

const makeEnv = (snapshot: unknown = null): Env => ({
  GITHUB_APP_ID: '123',
  GITHUB_APP_PRIVATE_KEY: pem,
  GITHUB_INSTALLATIONS: JSON.stringify({ GabinSMD: 1, 'SIMOND-ANCE-BROS': 2 }),
  VIGIE_SNAPSHOT: {
    get: async () => (snapshot === null ? null : typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot)),
  } as unknown as KVNamespace,
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** Entoure des lignes d'un bloc de code `decision`. */
const block = (...lines: string[]) => ['```decision', ...lines, '```'].join('\n');

const minimal = (id: string, ...extra: string[]) =>
  block(`id: ${id}`, 'question: On y va ?', 'context: Une ligne de contexte.', 'reversible: oui', 'topic: technique', ...extra);

interface FakeRepo {
  issues?: unknown[];
  pulls?: unknown[];
  checks?: Record<string, unknown[]>;
  fail?: boolean;
}

/** GitHub simulé : jamais de réseau. Garde la liste des appels pour vérifier la lecture seule. */
function fakeGithub(repos: Record<string, FakeRepo>) {
  const calls: { url: string; method: string }[] = [];
  const fetch: Deps['fetch'] = async (input, init) => {
    calls.push({ url: input, method: init?.method ?? 'GET' });
    const path = input.replace('https://api.github.com', '');
    if (path.startsWith('/app/installations/')) return ok({ token: 'ghs_FAKE', expires_at: '2026-11-26T11:00:00Z' });
    const m = /^\/repos\/([^/]+\/[^/?]+)(.*)$/.exec(path);
    const repo = m ? repos[m[1]] : undefined;
    if (!m || !repo) return new Response('{}', { status: 404 });
    if (repo.fail) return new Response('{}', { status: 500 });
    const rest = m[2];
    if (rest.startsWith('/issues?')) return ok(repo.issues ?? []);
    if (rest.startsWith('/pulls?')) return ok(repo.pulls ?? []);
    const sha = /^\/commits\/([^/]+)\/check-runs/.exec(rest)?.[1];
    if (sha) return ok({ check_runs: repo.checks?.[sha] ?? [] });
    return new Response('{}', { status: 404 });
  };
  return { fetch, calls };
}

const projets = [
  { id: 'vigie', owner: 'GabinSMD', repo: 'Vigie', nom: 'Vigie' },
  { id: 'ecole-saas', owner: 'SIMOND-ANCE-BROS', repo: 'ecole-saas', nom: 'ecole-saas' },
];

const issue = (number: number, body: string | null, extra: Record<string, unknown> = {}) => ({
  number,
  title: `Issue ${number}`,
  html_url: `https://github.com/GabinSMD/Vigie/issues/${number}`,
  body,
  created_at: '2026-11-20T08:00:00Z',
  labels: [{ name: 'decision' }],
  author_association: 'OWNER',
  ...extra,
});

const pull = (number: number, body: string | null, extra: Record<string, unknown> = {}) => ({
  number,
  title: `PR ${number}`,
  draft: false,
  html_url: `https://github.com/GabinSMD/Vigie/pull/${number}`,
  base: { ref: 'main' },
  head: { sha: `sha${number}` },
  user: { login: 'GabinSMD' },
  author_association: 'OWNER',
  body,
  created_at: '2026-11-21T08:00:00Z',
  ...extra,
});

const dependabot = (number: number, title: string) =>
  pull(number, 'Bumps x. Release notes…', {
    title,
    user: { login: 'dependabot[bot]' },
    author_association: 'NONE',
    created_at: '2026-11-22T08:00:00Z',
  });

async function call(repos: Record<string, FakeRepo>, snapshot: unknown = null) {
  const gh = fakeGithub(repos);
  const logs: string[] = [];
  const response = await handle(new Request('https://vigie.example.org/api/decisions'), makeEnv(snapshot), {
    fetch: gh.fetch,
    projets,
    now: () => NOW,
    log: (line) => logs.push(line),
  });
  const text = await response.text();
  return { response, text, body: JSON.parse(text) as DecisionsResponse, logs, calls: gh.calls };
}

const find = (body: DecisionsResponse, projectId: string, id: string): Decision | undefined =>
  body.decisions.find((d) => d.projectId === projectId && d.id === id);

describe('GET /api/decisions : issues étiquetées `decision`', () => {
  it("lit les blocs du corps des issues ouvertes étiquetées, avec l'issue comme provenance", async () => {
    const { response, body, calls } = await call({
      'GabinSMD/Vigie': {
        issues: [
          issue(5, `Contexte libre.\n\n${minimal('5-choix-nom', 'option: a | Nom A', 'option: b | Nom B', 'recommended: a')}`),
          issue(12, minimal('12-vue-comme-issue'), { pull_request: {} }),
          issue(6, null),
        ],
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body.generatedAt).toBe(NOW.toISOString());
    expect(find(body, 'vigie', '5-choix-nom')).toEqual({
      id: '5-choix-nom',
      kind: 'choix',
      question: 'On y va ?',
      context: ['Une ligne de contexte.'],
      options: [
        { id: 'a', label: 'Nom A' },
        { id: 'b', label: 'Nom B' },
      ],
      recommended: 'a',
      reversible: true,
      topic: 'technique',
      freeText: 'facultatif',
      blocking: false,
      links: [],
      projectId: 'vigie',
      askedAt: '2026-11-20T08:00:00Z',
      askedBy: { kind: 'issue', number: 5 },
      source: 'issue',
    });
    // Une PR renvoyée par la liste des issues n'est pas lue deux fois.
    expect(find(body, 'vigie', '12-vue-comme-issue')).toBeUndefined();
    const issuesCall = calls.find((c) => c.url.includes('/repos/GabinSMD/Vigie/issues'))!;
    expect(new URL(issuesCall.url).searchParams.get('labels')).toBe('decision');
    expect(new URL(issuesCall.url).searchParams.get('state')).toBe('open');
  });

  it('déplie les options implicites oui/non', async () => {
    const { body } = await call({ 'GabinSMD/Vigie': { issues: [issue(5, minimal('5-oui-non'))] } });
    expect(find(body, 'vigie', '5-oui-non')!.options).toEqual([
      { id: 'oui', label: 'Oui' },
      { id: 'non', label: 'Non' },
    ]);
  });

  it('ignore un bloc cité dans un bloc ````markdown (exemple)', async () => {
    const text = `Forme à suivre :\n\n\`\`\`\`markdown\n${minimal('5-exemple')}\n\`\`\`\``;
    const { body, logs } = await call({ 'GabinSMD/Vigie': { issues: [issue(5, text)] } });
    expect(body.decisions).toEqual([]);
    expect(logs).toEqual([]);
  });
});

describe('GET /api/decisions : descriptions des PR', () => {
  it("lit la description des PR ouvertes sans appel en plus de la liste", async () => {
    const { body, calls } = await call({
      'GabinSMD/Vigie': { pulls: [pull(12, `## Résumé\n\n${minimal('12-migration', 'blocking: oui', 'link: issue #5')}`), pull(13, null)] },
    });
    expect(find(body, 'vigie', '12-migration')).toMatchObject({
      source: 'pr',
      askedBy: { kind: 'pr', number: 12 },
      askedAt: '2026-11-21T08:00:00Z',
      blocking: true,
      links: [{ kind: 'issue', number: 5 }],
    });
    const vigieCalls = calls.filter((c) => c.url.includes('/repos/GabinSMD/Vigie')).map((c) => new URL(c.url).pathname);
    expect(vigieCalls.sort()).toEqual(['/repos/GabinSMD/Vigie/issues', '/repos/GabinSMD/Vigie/pulls']);
  });

  it('ne fait que des lectures et ne renvoie jamais le jeton', async () => {
    const { text, calls } = await call({ 'GabinSMD/Vigie': { pulls: [pull(12, minimal('12-x'))] } });
    expect(text).not.toContain('ghs_FAKE');
    expect(calls.filter((c) => c.method !== 'GET' && !c.url.includes('/access_tokens'))).toEqual([]);
  });
});

describe('GET /api/decisions : Dependabot majeures (§ 5.5, D14)', () => {
  it('crée une décision migrer / attendre / ignorer, sans recommandation', async () => {
    const { body } = await call({
      'GabinSMD/Vigie': {
        pulls: [dependabot(40, 'Bump vite from 6.3.5 to 7.0.0')],
        checks: { sha40: [{ name: 'Tests', status: 'completed', conclusion: 'failure' }] },
      },
    });
    const d = find(body, 'vigie', 'dependabot-40')!;
    expect(d).toEqual({
      id: 'dependabot-40',
      kind: 'choix',
      question: 'Passer vite de la version 6 à 7 ?',
      context: ['Bump vite from 6.3.5 to 7.0.0', 'CI : en échec'],
      options: [
        { id: 'migrer', label: 'Confier la migration à une session Dev' },
        { id: 'attendre', label: 'Pas maintenant' },
        { id: 'ignorer', label: 'Ignorer cette version majeure' },
      ],
      reversible: true,
      topic: 'technique',
      freeText: 'facultatif',
      blocking: false,
      links: [{ kind: 'pr', number: 40 }],
      projectId: 'vigie',
      askedAt: '2026-11-22T08:00:00Z',
      askedBy: { kind: 'pr', number: 40 },
      source: 'dependabot',
    });
    expect(d).not.toHaveProperty('recommended');
  });

  it("ignore les montées mineures, les PR d'autres auteurs, et ne lit la CI que des majeures", async () => {
    const { body, calls } = await call({
      'GabinSMD/Vigie': {
        pulls: [
          dependabot(41, 'Bump vitest from 3.2.4 to 3.3.0'),
          pull(42, null, { title: 'Bump react from 18.3.1 to 19.0.0' }),
          dependabot(43, 'Bump the npm_and_yarn group across 1 directory with 3 updates'),
          dependabot(44, 'chore(deps-dev): bump @types/node from 22.15.30 to 24.0.1 in /worker'),
        ],
      },
    });
    expect(body.decisions.map((d) => d.id)).toEqual(['dependabot-44']);
    expect(find(body, 'vigie', 'dependabot-44')!.question).toBe('Passer @types/node de la version 22 à 24 ?');
    expect(find(body, 'vigie', 'dependabot-44')!.context[1]).toBe('CI : aucun check');
    const checkCalls = calls.filter((c) => c.url.includes('/check-runs')).map((c) => new URL(c.url).pathname);
    expect(checkCalls).toEqual(['/repos/GabinSMD/Vigie/commits/sha44/check-runs']);
  });

  it("un bloc de même id dans une issue `decision` de confiance l'emporte (pour ajouter une recommandation), liens fusionnés", async () => {
    const text = block(
      'id: dependabot-40',
      'question: Passer vite de la version 6 à 7 ?',
      'context: La migration touche vite.config.ts.',
      'option: migrer | Confier la migration à une session Dev',
      'option: attendre | Pas maintenant',
      'option: ignorer | Ignorer cette version majeure',
      'recommended: migrer',
      'reversible: oui',
      'topic: technique',
      'link: issue #7',
    );
    const { body } = await call({ 'GabinSMD/Vigie': { issues: [issue(7, text)], pulls: [dependabot(40, 'Bump vite from 6.3.5 to 7.0.0')] } });
    expect(body.decisions).toHaveLength(1);
    expect(body.decisions[0]).toMatchObject({
      id: 'dependabot-40',
      source: 'issue',
      recommended: 'migrer',
      context: ['La migration touche vite.config.ts.'],
      links: [
        { kind: 'issue', number: 7 },
        { kind: 'pr', number: 40 },
      ],
    });
  });

  it('ne lit jamais les blocs de la description d\'une PR Dependabot (notes de version écrites par des tiers)', async () => {
    const pr = dependabot(40, 'Bump vite from 6.3.5 to 7.0.0');
    pr.body = `Release notes\n\n${minimal('dependabot-40', 'recommended: oui', 'blocking: oui')}\n${minimal('40-piege')}`;
    const { body } = await call({ 'GabinSMD/Vigie': { pulls: [pr] } });
    expect(body.decisions.map((d) => [d.id, d.source])).toEqual([['dependabot-40', 'dependabot']]);
    expect(body.decisions[0]).not.toHaveProperty('recommended');
  });

  it.each([
    ['Bump vite from 6.3.5 to 7.0.0', { name: 'vite', from: 6, to: 7 }],
    ['Bump actions/checkout from v4 to v5', { name: 'actions/checkout', from: 4, to: 5 }],
    ['build(deps): bump @types/node from 22.15.30 to 24.0.1 in /worker', { name: '@types/node', from: 22, to: 24 }],
    ['Bump vitest from 3.2.4 to 3.3.0', null],
    ['Bump the npm_and_yarn group with 3 updates', null],
    ['Update README', null],
  ])('dependabotMajor(« %s »)', (title, expected) => {
    expect(dependabotMajor(title)).toEqual(expected);
  });
});

describe("GET /api/decisions : questions de l'instantané et déduplication (§ 5.3)", () => {
  const question = {
    id: '5-choix-nom',
    title: 'Quel nom ?',
    detail: 'Contexte de la session.',
    prRef: '#12',
    context: ['Contexte de la session.'],
    options: [
      { id: 'a', label: 'Nom A' },
      { id: 'b', label: 'Nom B' },
    ],
    recommended: 'b',
    reversible: true,
    topic: 'produit',
    links: [{ kind: 'pr', number: 12 }],
    blocking: true,
    askedAt: '2026-11-19T07:00:00Z',
  };
  const snapshot = (questions: unknown[], projectId = 'vigie') => ({
    version: 1,
    generatedAt: '2026-11-26T09:00:00Z',
    sessions: [{ id: 'session_01ABC', projectId, role: 'Développeur', title: 't', status: 'attention', statusLabel: 'x', line: 'l', summary: 's', events: [], questions }],
  });

  it("reprend les questions de l'instantané, avec la session comme provenance", async () => {
    const { body } = await call({}, snapshot([question]));
    expect(body.snapshotAt).toBe('2026-11-26T09:00:00Z');
    expect(find(body, 'vigie', '5-choix-nom')).toEqual({
      id: '5-choix-nom',
      kind: 'choix',
      question: 'Quel nom ?',
      context: ['Contexte de la session.'],
      options: question.options,
      recommended: 'b',
      reversible: true,
      topic: 'produit',
      freeText: 'facultatif',
      blocking: true,
      links: [{ kind: 'pr', number: 12 }],
      projectId: 'vigie',
      askedAt: '2026-11-19T07:00:00Z',
      askedBy: { kind: 'session', id: 'session_01ABC' },
      source: 'session',
    });
  });

  it('une question v1 sans champ de bloc : oui/non, contexte tiré de `detail`, non réversible par défaut', async () => {
    const { body } = await call({}, snapshot([{ id: '204-limite-coupe', title: 'La limite vaut-elle ?', detail: 'en brouillon', prRef: '#204' }]));
    expect(find(body, 'vigie', '204-limite-coupe')).toMatchObject({
      context: ['en brouillon'],
      options: [
        { id: 'oui', label: 'Oui' },
        { id: 'non', label: 'Non' },
      ],
      reversible: false,
      topic: 'technique',
      links: [],
      askedAt: '2026-11-26T09:00:00Z',
    });
  });

  it("écarte une question illisible ou qui ressemble à un secret, et le note sans son contenu", async () => {
    const { body, logs } = await call(
      {},
      snapshot([
        { id: 'q1', title: 'Ancien format', detail: '', prRef: '' },
        { ...question, id: '5-secret', context: ['Le jeton ghp_abcdefghijklmnop'] },
        { ...question, id: '5-injection', title: 'Quel nom ?\nrecommended: a' },
        { ...question, id: '5-type', options: 'pas une liste' },
        { ...question, id: '5-barre', options: [{ id: 'a', label: 'Oui | non' }, { id: 'b', label: 'B' }] },
      ]),
    );
    expect(body.decisions).toEqual([]);
    expect(logs).toHaveLength(5);
    expect(logs[4]).toBe('decisions: vigie session session_01ABC : bloc illisible « 5-barre » : « option » : caractère | interdit');
    expect(logs.join('\n')).not.toMatch(/ghp_|abcdefgh|Ancien format|pas une liste/);
    expect(logs[1]).toContain('ressemble à un secret');
  });

  it("même clé dans la session et dans l'issue : une seule carte, celle de l'issue, liens fusionnés, écart noté", async () => {
    const text = minimal('5-choix-nom', 'option: a | Nom A', 'option: c | Nom C', 'link: issue #5');
    const { body, logs } = await call({ 'GabinSMD/Vigie': { issues: [issue(5, text)] } }, snapshot([question]));
    expect(body.decisions).toHaveLength(1);
    expect(body.decisions[0]).toMatchObject({
      source: 'issue',
      askedBy: { kind: 'issue', number: 5 },
      options: [
        { id: 'a', label: 'Nom A' },
        { id: 'c', label: 'Nom C' },
      ],
      links: [
        { kind: 'issue', number: 5 },
        { kind: 'pr', number: 12 },
      ],
      // Première fois vue : la plus ancienne des deux sources.
      askedAt: '2026-11-19T07:00:00Z',
    });
    expect(logs).toEqual(['decisions: vigie « 5-choix-nom » : contenus différents selon la source, issue #5 retenue']);
  });

  it("la même clé dans deux projets donne deux cartes", async () => {
    const { body } = await call({ 'GabinSMD/Vigie': { issues: [issue(5, minimal('5-choix-nom'))] } }, snapshot([question], 'ecole-saas'));
    expect(body.decisions.map((d) => `${d.projectId}/${d.id}`).sort()).toEqual(['ecole-saas/5-choix-nom', 'vigie/5-choix-nom']);
  });

  it('les décisions bloquantes passent en tête, puis les plus anciennes', async () => {
    const { body } = await call(
      {
        'GabinSMD/Vigie': {
          issues: [issue(5, minimal('5-ancienne'), { created_at: '2026-11-01T00:00:00Z' }), issue(6, minimal('6-recente'))],
          pulls: [pull(12, minimal('12-bloquante', 'blocking: oui'))],
        },
      },
    );
    expect(body.decisions.map((d) => d.id)).toEqual(['12-bloquante', '5-ancienne', '6-recente']);
  });

  it("un instantané illisible n'empêche pas les décisions GitHub", async () => {
    const { response, body, logs } = await call({ 'GabinSMD/Vigie': { issues: [issue(5, minimal('5-x'))] } }, '{pas du json');
    expect(response.status).toBe(200);
    expect(body.snapshotAt).toBeNull();
    expect(body.decisions.map((d) => d.id)).toEqual(['5-x']);
    expect(logs).toEqual(['decisions: instantané illisible, questions des sessions ignorées']);
  });
});

describe('GET /api/decisions : auteurs de confiance seulement', () => {
  const sessionQuestion = {
    version: 1,
    generatedAt: '2026-11-26T09:00:00Z',
    sessions: [
      {
        id: 'session_01ABC',
        projectId: 'vigie',
        role: 'Développeur',
        title: 't',
        status: 'attention',
        statusLabel: 'x',
        line: 'l',
        summary: 's',
        events: [],
        questions: [{ id: '12-migration', title: 'On migre ?', detail: 'Contexte légitime.', prRef: '#12', reversible: true }],
      },
    ],
  };

  it.each(['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'NONE', 'MANNEQUIN', undefined])(
    'une PR ou une issue d\'un auteur %s ne donne aucune décision et ne masque pas la session',
    async (association) => {
      const piege = minimal('12-migration', 'topic: securite', 'blocking: oui', 'recommended: oui').replace('topic: technique\n', '');
      const { body, logs } = await call(
        {
          'GabinSMD/Vigie': {
            pulls: [pull(12, piege, { author_association: association, user: { login: 'inconnu' } })],
            issues: [issue(13, minimal('13-piege'), { author_association: association })],
          },
        },
        sessionQuestion,
      );
      expect(body.decisions.map((d) => [d.id, d.source, d.question])).toEqual([['12-migration', 'session', 'On migre ?']]);
      expect(logs).toEqual(['decisions: vigie issue #13 : auteur non autorisé, ignoré', 'decisions: vigie PR #12 : auteur non autorisé, ignoré']);
    },
  );

  it('accepte les auteurs OWNER, MEMBER et COLLABORATOR', async () => {
    const { body } = await call({
      'GabinSMD/Vigie': {
        pulls: [
          pull(12, minimal('12-owner')),
          pull(13, minimal('13-member'), { author_association: 'MEMBER' }),
          pull(14, minimal('14-collaborator'), { author_association: 'COLLABORATOR' }),
        ],
      },
    });
    expect(body.decisions.map((d) => d.id).sort()).toEqual(['12-owner', '13-member', '14-collaborator']);
  });

  it("ne note rien pour une PR tierce sans bloc decision", async () => {
    const { logs } = await call({ 'GabinSMD/Vigie': { pulls: [pull(12, 'Une PR ordinaire.', { author_association: 'NONE' })] } });
    expect(logs).toEqual([]);
  });
});

describe('GET /api/decisions : journal et erreurs', () => {
  it('note les blocs illisibles et les clés inconnues, jamais avec leur contenu', async () => {
    const secret = minimal('5-secret', 'context: password=hunter2');
    const unknown = minimal('5-inconnue', 'note: texte libre très personnel');
    const missing = block('id: 12-sans-topic', 'question: Une question confidentielle ?', 'context: c', 'reversible: oui');
    const { body, logs, text } = await call({
      'GabinSMD/Vigie': { issues: [issue(5, `${secret}\n${unknown}`)], pulls: [pull(12, missing)] },
    });
    expect(body.decisions.map((d) => d.id)).toEqual(['5-inconnue']);
    expect(logs).toEqual([
      'decisions: vigie issue #5 : bloc illisible « 5-secret » : ressemble à un secret',
      'decisions: vigie issue #5 : 5-inconnue : clé inconnue « note » ignorée',
      'decisions: vigie PR #12 : bloc illisible « 12-sans-topic » : champ « topic » absent',
    ]);
    expect(`${logs.join('\n')}\n${text}`).not.toMatch(/hunter|texte libre|confidentielle/);
  });

  it('borne le journal : 10 lignes au plus par texte, chacune de 160 caractères au plus', async () => {
    const keys = Array.from({ length: 30 }, (_, i) => `${'k'.repeat(200)}${String.fromCharCode(97 + (i % 26))}${i >= 26 ? 'z' : ''}: x`);
    const { logs } = await call({ 'GabinSMD/Vigie': { issues: [issue(5, minimal('5-bavard', ...keys))] } });
    expect(logs).toHaveLength(11);
    expect(logs[10]).toBe('decisions: vigie issue #5 : 20 autres lignes non écrites');
    expect(logs.every((l) => [...l].length <= 160)).toBe(true);
  });

  it("un dépôt en échec n'empêche pas les autres et ne renvoie aucun détail sensible", async () => {
    const { response, body } = await call({
      'GabinSMD/Vigie': { issues: [issue(5, minimal('5-x'))] },
      'SIMOND-ANCE-BROS/ecole-saas': { fail: true },
    });
    expect(response.status).toBe(200);
    expect(body.decisions.map((d) => d.id)).toEqual(['5-x']);
    expect(body.errors).toEqual([{ projectId: 'ecole-saas', error: 'github_500' }]);
  });
});
