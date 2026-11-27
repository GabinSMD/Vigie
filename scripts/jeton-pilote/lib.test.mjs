// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readKvId } from '../mise-en-route/lib.mjs';
import {
  ACCOUNT_FILE,
  BW_ITEM_NAME,
  PILOTE_DIR,
  SCRIPT_BW_CREATE,
  SCRIPT_BW_STATUS,
  SCRIPT_CF_GET,
  SCRIPT_EXISTING,
  SCRIPT_KV_TEST,
  SCRIPT_PUBLIC_IP,
  SCRIPT_WRITE,
  SNAPSHOT_KEY,
  TEST_KEY,
  TOKEN_FILE,
  assertNoSecret,
  bwItem,
  checkTokenShape,
  classifyCfError,
  explainFailure,
  interpretAccounts,
  interpretNamespace,
  interpretVerify,
  kvTestParams,
  parseArgs,
  parseBwStatus,
  parseCurlOutput,
  parseExisting,
  parseKvTest,
  parsePublicIp,
  shellQuote,
  shouldFallBack,
  sshArgs,
  verificationPlan,
} from './lib.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
// Jeton factice : 40 caractères, forme d'un jeton Cloudflare, aucune valeur réelle.
const FAKE_TOKEN = 'FAKE_tokenForTests_0123456789abcdefABCDE';
const ACCOUNT = 'a'.repeat(32);
const KV = 'b81d07e1897b44df8ae8d12cd6ce9ba2';
const ALL_SCRIPTS = [SCRIPT_PUBLIC_IP, SCRIPT_EXISTING, SCRIPT_WRITE, SCRIPT_CF_GET, SCRIPT_KV_TEST, SCRIPT_BW_STATUS, SCRIPT_BW_CREATE];

describe('parseArgs', () => {
  it('a des valeurs par défaut sûres', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, hote: 'penny', verif: 'auto', help: false });
  });

  it('lit --dry-run, --hote et --verif', () => {
    expect(parseArgs(['--dry-run', '--hote', 'penny-lan', '--verif=penny'])).toMatchObject({ dryRun: true, hote: 'penny-lan', verif: 'penny' });
    expect(parseArgs(['--hote=gabin@penny'])).toMatchObject({ hote: 'gabin@penny' });
  });

  it('refuse les valeurs dangereuses ou inconnues', () => {
    expect(() => parseArgs(['--hote', '-oProxyCommand=x'])).toThrow(/invalide/);
    expect(() => parseArgs(['--hote', 'penny;rm'])).toThrow(/invalide/);
    expect(() => parseArgs(['--verif', 'partout'])).toThrow(/--verif/);
    expect(() => parseArgs(['--hote'])).toThrow(/valeur/);
    expect(() => parseArgs(['--jeton', 'x'])).toThrow(/inconnue/);
  });
});

describe('commandes ssh', () => {
  it('quote correctement pour un shell POSIX', () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
    expect(execFileSync('sh', ['-c', `printf %s ${shellQuote("l'a $HOME `x`")}`]).toString()).toBe("l'a $HOME `x`");
  });

  it('construit une commande distante sh -c avec paramètres positionnels', () => {
    const args = sshArgs('penny', 'echo "$1"', ['/mnt/x y']);
    expect(args.slice(0, 4)).toEqual(['-T', '-o', 'ConnectTimeout=15', 'penny']);
    expect(args).toHaveLength(5);
    // Ce que ferait le shell de connexion distant avec la chaîne reçue :
    expect(execFileSync('sh', ['-c', args[4]]).toString()).toBe('/mnt/x y\n');
  });

  it("aucun script distant ni aucun argument ne contient le jeton : il n'arrive que par l'entrée standard ou le fichier", () => {
    for (const script of ALL_SCRIPTS) {
      expect(script).not.toContain(FAKE_TOKEN);
      for (const params of [[], [PILOTE_DIR], kvTestParams(PILOTE_DIR, KV, 'vigie-test-1')]) {
        expect(() => assertNoSecret(sshArgs('penny', script, params), [FAKE_TOKEN])).not.toThrow();
      }
    }
    // curl lit l'en-tête d'autorisation sur son entrée standard, jamais en argument.
    expect(SCRIPT_CF_GET).toContain('-H @-');
    expect(SCRIPT_KV_TEST).not.toMatch(/-H ["']Authorization/);
  });

  it('assertNoSecret refuse une commande qui contiendrait le jeton', () => {
    expect(() => assertNoSecret(sshArgs('penny', 'true', [`Bearer ${FAKE_TOKEN}`]), [FAKE_TOKEN])).toThrow(/secrète/);
    expect(() => assertNoSecret(['a'], [null])).not.toThrow();
  });

  it('le test bout en bout ne vise que la clé de test, jamais snapshot', () => {
    expect(kvTestParams(PILOTE_DIR, KV, 'vigie-test-1')).toEqual([PILOTE_DIR, KV, TEST_KEY, 'vigie-test-1']);
    expect(() => kvTestParams(PILOTE_DIR, KV, 'v', SNAPSHOT_KEY)).toThrow(/jamais/);
    expect(() => kvTestParams(PILOTE_DIR, KV, 'v', 'autre')).toThrow();
    expect(() => kvTestParams(PILOTE_DIR, 'pas-un-id', 'v')).toThrow(/KV/);
    expect(() => kvTestParams(PILOTE_DIR, KV, 'a b')).toThrow();
    expect(SCRIPT_KV_TEST).not.toMatch(/\bsnapshot\b/);
  });
});

describe('scripts distants, exécutés en local avec un curl factice', () => {
  let dir;
  let bin;
  let log;
  const env = () => ({ ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_LOG: log });
  const runRemote = (script, params, input) => {
    const args = sshArgs('penny', script, params);
    assertNoSecret(args, [FAKE_TOKEN]);
    return spawnSync('sh', ['-c', args[4]], { input, env: env() });
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vigie-jeton-'));
    bin = join(dir, 'bin');
    log = join(dir, 'curl.log');
    execFileSync('mkdir', ['-p', bin]);
    // curl factice : note ses arguments et son entrée standard, puis répond comme Cloudflare.
    writeFileSync(
      join(bin, 'curl'),
      `#!/bin/sh
printf 'ARGS %s\\n' "$*" >> "$FAKE_LOG"
in=$(cat); printf 'STDIN %s\\n' "$in" >> "$FAKE_LOG"
case "$*" in
  *"-X PUT"*) printf 200 ;;
  *"-X DELETE"*) printf 200 ;;
  *values*) printf 'vigie-test-42\\n200' ;;
  *) printf '{"success":true,"result":{"status":"active"}}\\n200' ;;
esac
`,
    );
    chmodSync(join(bin, 'curl'), 0o755);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('SCRIPT_WRITE pose le jeton en 0600 et l\'identifiant du compte', () => {
    const target = join(dir, 'pilote-cloud');
    const r = runRemote(SCRIPT_WRITE, [target], `${FAKE_TOKEN}\n${ACCOUNT}\n`);
    expect(r.status).toBe(0);
    expect(r.stdout.toString().trim()).toBe('-rw-------');
    expect(readFileSync(join(target, TOKEN_FILE), 'utf8')).toBe(`${FAKE_TOKEN}\n`);
    expect(statSync(join(target, TOKEN_FILE)).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(target, ACCOUNT_FILE), 'utf8')).toBe(`${ACCOUNT}\n`);
    // Idempotent : une seconde écriture remplace sans erreur.
    expect(runRemote(SCRIPT_WRITE, [target], `${FAKE_TOKEN}\n${ACCOUNT}\n`).status).toBe(0);
    expect(parseExisting(runRemote(SCRIPT_EXISTING, [target]).stdout.toString())).toEqual([TOKEN_FILE, ACCOUNT_FILE]);
  });

  it('SCRIPT_WRITE refuse une entrée vide', () => {
    expect(runRemote(SCRIPT_WRITE, [join(dir, 'p')], '\n\n').status).not.toBe(0);
  });

  it('SCRIPT_CF_GET passe le jeton à curl par l\'entrée standard, pas en argument', () => {
    const r = runRemote(SCRIPT_CF_GET, ['https://api.cloudflare.com/client/v4/user/tokens/verify'], `${FAKE_TOKEN}\n`);
    expect(r.status).toBe(0);
    expect(parseCurlOutput(r.stdout.toString())).toEqual({ status: 200, data: { success: true, result: { status: 'active' } } });
    const lines = readFileSync(log, 'utf8').split('\n');
    expect(lines.find((l) => l.startsWith('ARGS'))).not.toContain(FAKE_TOKEN);
    expect(lines).toContain(`STDIN Authorization: Bearer ${FAKE_TOKEN}`);
  });

  it('SCRIPT_KV_TEST lit le jeton dans le fichier, écrit, relit et supprime la clé de test', () => {
    const target = join(dir, 'pilote-cloud');
    runRemote(SCRIPT_WRITE, [target], `${FAKE_TOKEN}\n${ACCOUNT}\n`);
    const r = runRemote(SCRIPT_KV_TEST, kvTestParams(target, KV, 'vigie-test-42'));
    expect(parseKvTest(r.stdout.toString())).toEqual({ put: 200, get: 200, identique: true, delete: 200, ok: true });
    const args = readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith('ARGS'));
    expect(args).toHaveLength(3);
    for (const a of args) {
      expect(a).not.toContain(FAKE_TOKEN);
      expect(a).toContain(`/accounts/${ACCOUNT}/storage/kv/namespaces/${KV}/values/${TEST_KEY}`);
      expect(a).not.toMatch(/values\/snapshot/);
    }
  });
});

describe('lecture des sorties', () => {
  it('lit l\'id du KV dans le vrai wrangler.toml (readKvId)', () => {
    expect(readKvId(readFileSync(join(ROOT, 'worker', 'wrangler.toml'), 'utf8'))).toMatch(/^[0-9a-f]{32}$/);
  });

  it('parsePublicIp', () => {
    expect(parsePublicIp('v4 203.0.113.7\nv6 2001:db8::1\n')).toEqual({ v4: '203.0.113.7', v6: '2001:db8::1' });
    expect(parsePublicIp('v4 \nv6 \n')).toEqual({ v4: null, v6: null });
    expect(parsePublicIp('v4 <html>\nv6 999.1.1.1')).toEqual({ v4: null, v6: null });
  });

  it('parseCurlOutput', () => {
    expect(parseCurlOutput('{"success":false}\n403')).toEqual({ status: 403, data: { success: false } });
    expect(parseCurlOutput('pas du json\n502\n')).toEqual({ status: 502, data: {} });
    expect(parseCurlOutput('')).toEqual({ status: 0, data: {} });
  });

  it('parseKvTest', () => {
    expect(parseKvTest('put 403\nget 404 different\ndelete 403\n')).toMatchObject({ put: 403, get: 404, ok: false });
    expect(parseKvTest('put 200\nget 200 different\ndelete 200\n').ok).toBe(false);
  });

  it('parseBwStatus', () => {
    expect(parseBwStatus('absent\n')).toBe('absent');
    expect(parseBwStatus('{"serverUrl":"https://vw","status":"unlocked"}')).toBe('unlocked');
    expect(parseBwStatus('? warning\n{"status":"locked"}')).toBe('locked');
    expect(parseBwStatus('{}')).toBe('inconnu');
    expect(parseBwStatus('')).toBe('inconnu');
  });

  it('checkTokenShape', () => {
    expect(checkTokenShape(FAKE_TOKEN)).toBeNull();
    expect(checkTokenShape('')).toMatch(/vide/);
    expect(checkTokenShape(`${FAKE_TOKEN} x`)).toMatch(/espace/);
    expect(checkTokenShape('abc')).toMatch(/court/);
    expect(checkTokenShape(`${FAKE_TOKEN}é`)).toMatch(/inattendus/);
  });

  it('bwItem ne met le jeton que dans login.password', () => {
    const item = bwItem(FAKE_TOKEN, ACCOUNT, new Date('2026-11-27T10:00:00Z'));
    expect(item.name).toBe(BW_ITEM_NAME);
    expect(item.login.password).toBe(FAKE_TOKEN);
    expect(JSON.stringify({ ...item, login: { ...item.login, password: null } })).not.toContain(FAKE_TOKEN);
    expect(item.notes).toContain('2026-11-27');
    expect(item.notes).toContain(ACCOUNT);
    expect(SCRIPT_BW_CREATE).toContain('bw encode | bw create item');
  });
});

describe('réponses de Cloudflare', () => {
  const ipBlocked = {
    success: false,
    errors: [{ code: 9109, message: 'Cannot use the access token from location: 198.51.100.4' }],
  };

  it('verify : jeton actif', () => {
    expect(interpretVerify(200, { success: true, result: { id: 'x', status: 'active', expires_on: '2027-01-01T00:00:00Z' } })).toEqual({
      ok: true,
      id: 'x',
      expiresOn: '2027-01-01T00:00:00Z',
      notBefore: null,
    });
  });

  it('verify : jeton désactivé ou expiré', () => {
    expect(interpretVerify(200, { success: true, result: { status: 'disabled' } })).toMatchObject({ ok: false, kind: 'jeton' });
    expect(interpretVerify(401, { success: false, errors: [{ code: 1000, message: 'Invalid API Token' }] })).toMatchObject({ ok: false, kind: 'jeton' });
  });

  it('verify : 403 dû au filtrage IP', () => {
    const r = interpretVerify(403, ipBlocked);
    expect(r).toMatchObject({ ok: false, kind: 'ip' });
    expect(explainFailure(r, 'le Mac')).toMatch(/filtrage IP/);
  });

  it('distingue le filtrage IP du manque de permission', () => {
    expect(classifyCfError(403, { errors: [{ code: 10000, message: 'Authentication error' }] }).kind).toBe('permission');
    expect(classifyCfError(403, { errors: [{ code: 1234, message: 'Request not allowed from this IP address' }] }).kind).toBe('ip');
    expect(classifyCfError(404, {}).kind).toBe('introuvable');
    expect(classifyCfError(500, {}).kind).toBe('autre');
  });

  it('accounts : un, plusieurs, aucun, erreur', () => {
    expect(interpretAccounts(200, { success: true, result: [{ id: ACCOUNT, name: 'Gabin' }] })).toEqual({ ok: true, accounts: [{ id: ACCOUNT, name: 'Gabin' }] });
    expect(interpretAccounts(200, { success: true, result: [{ id: ACCOUNT, name: 'A' }, { id: 'c'.repeat(32), name: 'B' }] }).accounts).toHaveLength(2);
    expect(interpretAccounts(200, { success: true, result: [{ id: 'pas-un-id' }] })).toEqual({ ok: true, accounts: [] });
    expect(interpretAccounts(403, ipBlocked)).toMatchObject({ ok: false, kind: 'ip' });
  });

  it('namespace : accessible, autre id, introuvable', () => {
    expect(interpretNamespace(200, { success: true, result: { id: KV, title: 'VIGIE_SNAPSHOT' } }, KV)).toEqual({ ok: true, title: 'VIGIE_SNAPSHOT' });
    expect(interpretNamespace(200, { success: true, result: { id: 'x' } }, KV)).toMatchObject({ ok: false });
    expect(interpretNamespace(404, { success: false, errors: [{ code: 10013, message: 'namespace not found' }] }, KV)).toMatchObject({ kind: 'introuvable' });
  });
});

describe('choix du mode de vérification', () => {
  it('auto : Mac, puis penny ; mac et penny : un seul essai', () => {
    expect(verificationPlan('auto')).toEqual(['mac', 'penny']);
    expect(verificationPlan('mac')).toEqual(['mac']);
    expect(verificationPlan('penny')).toEqual(['penny']);
  });

  it('ne bascule sur penny que si le filtrage IP refuse le Mac', () => {
    expect(shouldFallBack({ ok: false, kind: 'ip' })).toBe(true);
    expect(shouldFallBack({ ok: false, kind: 'jeton' })).toBe(false);
    expect(shouldFallBack({ ok: false, kind: 'permission' })).toBe(false);
    expect(shouldFallBack({ ok: true })).toBe(false);
  });
});
