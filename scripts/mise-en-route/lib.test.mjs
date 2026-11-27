// @vitest-environment node
import { createPrivateKey, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_PERMISSIONS,
  PLACEHOLDER_D1_ID,
  PLACEHOLDER_KV_ID,
  STEPS,
  accessAppBody,
  accessAppUpToDate,
  accessVerdict,
  appEmail,
  appJwt,
  appServiceTokenId,
  buildManifest,
  checkDomain,
  compareRepos,
  defaultZone,
  findAccessApp,
  findD1Database,
  findKvNamespace,
  installationSettingsUrl,
  installationsSecret,
  isLoggedOut,
  manifestPage,
  matchInstallations,
  newPilotToken,
  newState,
  parseArgs,
  parseJsonArray,
  parseWhoamiAccounts,
  readD1Id,
  readDomain,
  readKvId,
  readVar,
  sameState,
  setD1Id,
  setDomain,
  setKvId,
  setVar,
  toPkcs8,
} from './lib.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const config = JSON.parse(readFileSync(join(ROOT, 'config', 'projets.json'), 'utf8'));
// Le fichier du dépôt porte la configuration de production après la mise en route :
// les tests repartent de sa structure réelle, avec les valeurs factices remises.
const repoToml = readFileSync(join(ROOT, 'worker', 'wrangler.toml'), 'utf8');
const toml = setDomain(setKvId(setD1Id(repoToml, PLACEHOLDER_D1_ID), PLACEHOLDER_KV_ID), 'vigie.example.org', 'example.org');

describe('options', () => {
  it('lit --dry-run et --from (nom ou numéro)', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, from: null, help: false });
    expect(parseArgs(['--dry-run', '--from', 'access'])).toMatchObject({ dryRun: true, from: 'access' });
    expect(parseArgs(['--from=7']).from).toBe(STEPS[6].id);
  });

  it('refuse une étape ou une option inconnue', () => {
    expect(() => parseArgs(['--from', 'nimporte'])).toThrow(/Étape inconnue/);
    expect(() => parseArgs(['--from'])).toThrow();
    expect(() => parseArgs(['--force'])).toThrow(/Option inconnue/);
  });

  it('met Access avant le déploiement', () => {
    const ids = STEPS.map((s) => s.id);
    expect(ids.indexOf('access')).toBeLessThan(ids.indexOf('ordres'));
    // La base D1 doit exister avant le déploiement : wrangler refuse un database_id factice.
    expect(ids.indexOf('ordres')).toBeLessThan(ids.indexOf('deploiement'));
    expect(ids.indexOf('deploiement')).toBeLessThan(ids.indexOf('verification'));
    expect(ids.at(-1)).toBe('nettoyage');
  });
});

describe('questions', () => {
  it('vérifie le nom d\'hôte et la zone', () => {
    expect(checkDomain('vigie.mondomaine.fr', 'mondomaine.fr')).toBeNull();
    expect(checkDomain('mondomaine.fr', 'mondomaine.fr')).toMatch(/sous-domaine/);
    expect(checkDomain('vigie.autre.fr', 'mondomaine.fr')).toMatch(/n'appartient pas/);
    expect(checkDomain('https://vigie.mondomaine.fr', 'mondomaine.fr')).toMatch(/pas un nom d'hôte/);
    expect(defaultZone('vigie.mondomaine.fr')).toBe('mondomaine.fr');
  });
});

describe('manifeste de la GitHub App', () => {
  const manifest = buildManifest({ homepage: 'https://github.com/GabinSMD/Vigie', redirectUrl: 'http://127.0.0.1:4567/callback' });

  it('ne demande que de la lecture', () => {
    expect(manifest.default_permissions).toEqual({ contents: 'read', pull_requests: 'read', issues: 'read', checks: 'read', metadata: 'read' });
    expect(Object.values(manifest.default_permissions).every((v) => v === 'read')).toBe(true);
    expect(JSON.stringify(manifest)).not.toMatch(/write|admin/);
    expect(Object.isFrozen(APP_PERMISSIONS)).toBe(true);
  });

  it('n\'a pas de webhook actif, est installable partout et revient sur 127.0.0.1', () => {
    expect(manifest.name).toBe('Vigie');
    expect(manifest.hook_attributes.active).toBe(false);
    expect(manifest.default_events).toEqual([]);
    expect(manifest.public).toBe(true);
    expect(manifest.redirect_url).toBe('http://127.0.0.1:4567/callback');
  });

  it('poste le manifeste à GitHub avec le state, échappé', () => {
    const state = newState();
    const html = manifestPage(manifest, state);
    expect(html).toContain(`action="https://github.com/settings/apps/new?state=${state}"`);
    expect(html).toContain('name="manifest"');
    expect(html).toContain('&quot;contents&quot;:&quot;read&quot;');
    expect(html).not.toContain('"contents":"read"');
  });

  it('compare le state en temps constant et refuse un state falsifié', () => {
    const state = newState();
    expect(state).toMatch(/^[0-9a-f]{48}$/);
    expect(sameState(state, state)).toBe(true);
    expect(sameState(state, newState())).toBe(false);
    expect(sameState(state, null)).toBe(false);
    expect(sameState(state, `${state}0`)).toBe(false);
  });
});

describe('clé privée', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pkcs1 = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

  it('convertit PKCS#1 en PKCS#8 sans changer la clé', () => {
    expect(pkcs1).toContain('BEGIN RSA PRIVATE KEY');
    const pkcs8 = toPkcs8(pkcs1);
    expect(pkcs8).toContain('-----BEGIN PRIVATE KEY-----');
    expect(pkcs8).not.toContain('RSA PRIVATE KEY');
    const der = (pem) => createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'der' });
    expect(der(pkcs8).equals(der(pkcs1))).toBe(true);
    expect(toPkcs8(pkcs8)).toBe(pkcs8);
  });

  it('signe un JWT d\'App vérifiable avec la clé publique', () => {
    const jwt = appJwt(42, pkcs1, 1_800_000_000);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({ iat: 1_800_000_000 - 60, exp: 1_800_000_000 + 540, iss: '42' });
    expect(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'))).toBe(true);
  });
});

describe('installations et config/projets.json', () => {
  const installations = [
    { id: 11, account: { login: 'GabinSMD', type: 'User' }, html_url: 'https://github.com/settings/installations/11' },
    { id: 22, account: { login: 'simond-ance-bros', type: 'Organization' } },
    { id: 33, account: { login: 'DentiSync', type: 'Organization' } },
  ];
  const conformes = {
    GabinSMD: ['GabinSMD/treizero', 'GabinSMD/StreamBox', 'GabinSMD/Vigie', 'GabinSMD/souhaits', 'GabinSMD/waterline'],
    'SIMOND-ANCE-BROS': ['SIMOND-ANCE-BROS/ecole-saas', 'SIMOND-ANCE-BROS/FFD-Connect'],
    DentiSync: ['DentiSync/dentisync'],
  };

  it('retrouve les trois comptes, sans tenir compte de la casse', () => {
    const { found, missing } = matchInstallations(config, installations);
    expect(missing).toEqual([]);
    expect(found['SIMOND-ANCE-BROS'].id).toBe(22);
    expect(installationsSecret(config, found)).toBe('{"GabinSMD":11,"SIMOND-ANCE-BROS":22,"DentiSync":33}');
  });

  it('signale un compte où l\'App n\'est pas encore installée', () => {
    expect(matchInstallations(config, installations.slice(0, 2)).missing).toEqual(['DentiSync']);
  });

  it('accepte exactement les dépôts de la config', () => {
    expect(compareRepos(config, conformes)).toEqual([]);
  });

  it('signale les dépôts manquants et en trop', () => {
    const problems = compareRepos(config, {
      ...conformes,
      GabinSMD: ['GabinSMD/treizero', 'GabinSMD/Vigie', 'GabinSMD/souhaits', 'GabinSMD/waterline', 'GabinSMD/perso'],
      DentiSync: [],
    });
    expect(problems).toEqual([
      { compte: 'GabinSMD', manquants: ['StreamBox'], enTrop: ['perso'] },
      { compte: 'DentiSync', manquants: ['dentisync'], enTrop: [] },
    ]);
  });

  it('donne le lien de réglage de l\'installation', () => {
    expect(installationSettingsUrl(installations[0])).toBe('https://github.com/settings/installations/11');
    expect(installationSettingsUrl(installations[1])).toBe('https://github.com/organizations/simond-ance-bros/settings/installations/22');
  });
});

describe('wrangler.toml', () => {
  it('lit une configuration valide dans le fichier du dépôt', () => {
    expect(readKvId(repoToml)).toMatch(/^[0-9a-f]{32}$/);
    const { host, zone } = readDomain(repoToml);
    expect(host.endsWith(`.${zone}`)).toBe(true);
  });

  it('remet les valeurs factices', () => {
    expect(readKvId(toml)).toBe(PLACEHOLDER_KV_ID);
    expect(readDomain(toml)).toEqual({ host: 'vigie.example.org', zone: 'example.org' });
  });

  it('remplace l\'id du KV et le domaine sans toucher au reste', () => {
    const id = 'abcdef0123456789abcdef0123456789';
    const next = setDomain(setKvId(toml, id), 'vigie.mondomaine.fr', 'mondomaine.fr');
    expect(readKvId(next)).toBe(id);
    expect(readDomain(next)).toEqual({ host: 'vigie.mondomaine.fr', zone: 'mondomaine.fr' });
    expect(next).toContain('{ pattern = "vigie.mondomaine.fr", zone_name = "mondomaine.fr", custom_domain = true }');
    const before = toml.split('\n');
    const after = next.split('\n');
    expect(after).toHaveLength(before.length);
    expect(after.filter((line, i) => line !== before[i])).toHaveLength(2);
    expect(setDomain(setKvId(next, id), 'vigie.mondomaine.fr', 'mondomaine.fr')).toBe(next);
  });

  it('ne touche qu\'au KV visé', () => {
    const two = `[[kv_namespaces]]\nbinding = "AUTRE"\nid = "11111111111111111111111111111111"\n\n${toml}`;
    const next = setKvId(two, 'abcdef0123456789abcdef0123456789');
    expect(readKvId(next, 'AUTRE')).toBe('11111111111111111111111111111111');
    expect(readKvId(next)).toBe('abcdef0123456789abcdef0123456789');
  });

  it('base D1 et variables Access : valeurs factices dans le dépôt, remplacées sans toucher au reste', () => {
    expect(readD1Id(repoToml)).toBe(PLACEHOLDER_D1_ID);
    expect(readVar(repoToml, 'ACCESS_TEAM_DOMAIN')).toBe('a-remplacer.cloudflareaccess.com');
    expect(readVar(repoToml, 'ACCESS_AUD')).toBe('a-remplacer');
    const id = '12345678-90ab-cdef-1234-567890abcdef';
    const next = setVar(setVar(setD1Id(toml, id), 'ACCESS_TEAM_DOMAIN', 'equipe.cloudflareaccess.com'), 'ACCESS_AUD', 'abc123def');
    expect(readD1Id(next)).toBe(id);
    expect(readVar(next, 'ACCESS_TEAM_DOMAIN')).toBe('equipe.cloudflareaccess.com');
    expect(readVar(next, 'ACCESS_AUD')).toBe('abc123def');
    expect(readKvId(next)).toBe(PLACEHOLDER_KV_ID);
    const before = toml.split('\n');
    expect(next.split('\n').filter((line, i) => line !== before[i])).toHaveLength(3);
    expect(() => setD1Id(toml, 'pas-un-uuid')).toThrow(/invalide/);
    expect(() => setVar(toml, 'ACCESS_AUD', 'a"b')).toThrow(/inattendue/);
    expect(() => setVar(toml, 'INCONNUE', 'x')).toThrow(/introuvable/);
  });

  it('refuse un id invalide ou une section absente', () => {
    expect(() => setKvId(toml, 'pas-un-id')).toThrow(/invalide/);
    expect(() => setKvId('name = "x"', 'abcdef0123456789abcdef0123456789')).toThrow(/introuvable/);
    expect(() => setDomain('name = "x"', 'vigie.a.fr', 'a.fr')).toThrow(/introuvable/);
  });
});

describe('sorties de wrangler (simulées)', () => {
  it('lit les comptes de `wrangler whoami`', () => {
    const out = `\u001b[2m⛅️ wrangler 4.19.1\u001b[22m
Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email toi@example.org.
┌──────────────┬──────────────────────────────────┐
│ Account Name │ Account ID                       │
├──────────────┼──────────────────────────────────┤
│ Perso        │ 0123456789abcdef0123456789abcdef │
├──────────────┼──────────────────────────────────┤
│ Asso │ Bis   │ fedcba9876543210fedcba9876543210 │
└──────────────┴──────────────────────────────────┘`;
    expect(parseWhoamiAccounts(out)).toEqual([
      { name: 'Perso', id: '0123456789abcdef0123456789abcdef' },
      { name: 'Asso │ Bis', id: 'fedcba9876543210fedcba9876543210' },
    ]);
    expect(isLoggedOut(out)).toBe(false);
    expect(isLoggedOut('You are not authenticated. Please run `wrangler login`.')).toBe(true);
  });

  it('trouve l\'espace KV de Vigie dans la liste', () => {
    const list = parseJsonArray('⛅️ wrangler 4.19.1\n-----\n[{"id":"aaa","title":"autre"},{"id":"bbb","title":"VIGIE_SNAPSHOT"}]\n');
    expect(findKvNamespace(list)?.id).toBe('bbb');
    expect(findKvNamespace([{ id: 'ccc', title: 'vigie-api-VIGIE_SNAPSHOT' }])?.id).toBe('ccc');
    expect(findKvNamespace([{ id: 'aaa', title: 'autre' }])).toBeNull();
    expect(() => parseJsonArray('rien')).toThrow();
  });

  it('trouve la base D1 de Vigie dans la liste', () => {
    const list = parseJsonArray('[{"uuid":"aaa","name":"autre"},{"uuid":"bbb","name":"vigie"}]');
    expect(findD1Database(list)?.uuid).toBe('bbb');
    expect(findD1Database([{ uuid: 'aaa', name: 'autre' }])).toBeNull();
  });

  it('génère un PILOT_TOKEN aléatoire de 32 octets', () => {
    const a = newPilotToken();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(newPilotToken()).not.toBe(a);
  });
});

describe('Cloudflare Access', () => {
  const input = { host: 'vigie.mondomaine.fr', email: 'toi@mondomaine.fr' };

  it('protège tout le nom d\'hôte avec une seule adresse autorisée', () => {
    const body = accessAppBody(input);
    expect(body).toMatchObject({ type: 'self_hosted', domain: 'vigie.mondomaine.fr', name: 'Vigie' });
    expect(body.policies).toEqual([
      { name: 'Vigie : une seule adresse', decision: 'allow', include: [{ email: { email: 'toi@mondomaine.fr' } }], precedence: 1 },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/everyone|bypass|non_identity/);
  });

  it('retrouve l\'application existante et voit si elle est à jour', () => {
    const apps = [{ id: 'x', domain: 'autre.mondomaine.fr' }, { id: 'y', ...accessAppBody(input) }];
    const found = findAccessApp(apps, input.host);
    expect(found?.id).toBe('y');
    expect(accessAppUpToDate(found, input)).toBe(true);
    expect(accessAppUpToDate(found, { ...input, email: 'autre@example.org' })).toBe(false);
    const ouverte = { ...found, policies: [{ decision: 'allow', include: [{ everyone: {} }] }] };
    expect(accessAppUpToDate(ouverte, input)).toBe(false);
    expect(findAccessApp(apps, 'vigie.ailleurs.fr')).toBeNull();
  });

  it('ajoute le jeton de service du pilote sans ouvrir l\'application à d\'autres', () => {
    const body = accessAppBody({ ...input, serviceTokenId: 'tok-1' });
    expect(body.policies).toHaveLength(2);
    expect(body.policies[1]).toEqual({
      name: 'Vigie : pilote (jeton de service)',
      decision: 'non_identity',
      include: [{ service_token: { token_id: 'tok-1' } }],
      precedence: 2,
    });
    expect(JSON.stringify(body)).not.toMatch(/everyone|bypass/);
    const app = { id: 'y', ...body };
    expect(appServiceTokenId(app)).toBe('tok-1');
    expect(appEmail(app)).toBe('toi@mondomaine.fr');
    expect(accessAppUpToDate(app, { ...input, serviceTokenId: 'tok-1' })).toBe(true);
    expect(accessAppUpToDate(app, { ...input, serviceTokenId: 'tok-2' })).toBe(false);
    // Sans jeton demandé, une règle en trop n'est pas « à jour » : la relance la remet d'aplomb.
    expect(accessAppUpToDate(app, input)).toBe(false);
    const ouverte = { ...app, policies: [...app.policies, { decision: 'non_identity', include: [{ everyone: {} }] }] };
    expect(accessAppUpToDate(ouverte, { ...input, serviceTokenId: 'tok-1' })).toBe(false);
    expect(appServiceTokenId({ id: 'z', ...accessAppBody(input) })).toBeNull();
  });

  it('juge la réponse de /api/projets sans authentification', () => {
    expect(accessVerdict(302, 'https://equipe.cloudflareaccess.com/cdn-cgi/access/login/vigie.mondomaine.fr')).toBe('protege');
    expect(accessVerdict(403, null)).toBe('protege');
    expect(accessVerdict(401, null)).toBe('protege');
    expect(accessVerdict(200, null)).toBe('ouvert');
    expect(accessVerdict(302, 'https://ailleurs.example.org/')).toBe('inconnu');
    expect(accessVerdict(502, null)).toBe('inconnu');
  });
});
