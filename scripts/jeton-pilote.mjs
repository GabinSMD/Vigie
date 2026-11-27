#!/usr/bin/env node
// Pose sur penny le jeton Cloudflare dont le pilote a besoin pour écrire l'instantané des sessions dans KV.
// Lance-le depuis ton Mac, à la racine du dépôt : `npm run jeton-pilote`.
// Options : --dry-run (rien n'est modifié, aucun appel réseau ni ssh), --hote <alias ssh> (défaut : penny),
//           --verif auto|mac|penny (où vérifier le jeton ; auto : Mac, puis penny si le filtrage IP refuse le Mac).
// Le jeton est saisi sans écho, gardé en mémoire, et ne passe que par l'entrée standard de ssh :
// jamais sur le disque du Mac, jamais à l'écran, jamais en argument d'une commande.
// Guide : docs/mise-en-route.md, § 5.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { readDomain, readKvId, PLACEHOLDER_KV_ID } from './mise-en-route/lib.mjs';
import {
  ACCOUNT_FILE,
  BW_ITEM_NAME,
  CF_API,
  PILOTE_DIR,
  SCRIPT_BW_CREATE,
  SCRIPT_BW_STATUS,
  SCRIPT_CF_GET,
  SCRIPT_EXISTING,
  SCRIPT_KV_TEST,
  SCRIPT_PUBLIC_IP,
  SCRIPT_WRITE,
  TEST_KEY,
  TOKEN_FILE,
  TOKENS_PAGE,
  assertNoSecret,
  bwItem,
  checkTokenShape,
  explainFailure,
  interpretAccounts,
  interpretNamespace,
  interpretVerify,
  isAccountId,
  kvTestParams,
  parseArgs,
  parseBwStatus,
  parseCurlOutput,
  parseExisting,
  parseKvTest,
  parsePublicIp,
  revokeHelp,
  shouldFallBack,
  sshArgs,
  verificationPlan,
} from './jeton-pilote/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOML = join(ROOT, 'worker', 'wrangler.toml');

// ---------------------------------------------------------------------------
// Affichage

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const bold = paint('1');
const dim = paint('2');

const say = (s = '') => console.log(s);
const ok = (s) => say(`${green('✓')} ${s}`);
const warn = (s) => say(`${yellow('!')} ${s}`);
const fail = (s) => say(red(`✗ ${s}`));
const title = (n, s) => {
  say();
  say(bold(`${n}/7. ${s}`));
};

class Stop extends Error {}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  fail(error.message);
  process.exit(2);
}

if (options.help) {
  say(`Usage : npm run jeton-pilote -- [--dry-run] [--hote <alias ssh>] [--verif auto|mac|penny]

Pose sur penny le jeton Cloudflare du pilote (écriture de l'instantané dans KV) :
guide de création, saisie masquée, vérifications, écriture sur penny, test bout en bout, Vaultwarden.

--dry-run        n'exécute rien : ni réseau, ni ssh, ni écriture ; affiche chaque action prévue.
--hote <alias>   alias ssh de la machine du pilote (défaut : penny).
--verif <mode>   où vérifier le jeton avec l'API Cloudflare :
                   auto  (défaut) depuis le Mac, puis depuis penny si le filtrage IP refuse le Mac ;
                   mac   depuis le Mac seulement ; penny  depuis penny seulement.`);
  process.exit(0);
}

const DRY = options.dryRun;
const HOTE = options.hote;

// ---------------------------------------------------------------------------
// Saisie

const interactive = Boolean(process.stdin.isTTY);
let rl = null;
const readline = () => (rl ??= createInterface({ input: process.stdin, output: process.stdout }));

async function ask(question, fallback = '') {
  if (DRY && !interactive) return fallback;
  const suffix = fallback ? ` ${dim(`[${fallback}]`)}` : '';
  const answer = (await readline().question(`${question}${suffix} `)).trim();
  return answer || fallback;
}

const yes = async (question, fallback = 'o') => /^(o|oui|y|yes)$/i.test(await ask(`${question} (o/n)`, fallback));

/** Lit une valeur sans l'afficher (rien n'est écrit à l'écran, pas même des étoiles). */
async function askHidden(question) {
  if (!process.stdin.isTTY) throw new Stop('Saisie masquée impossible sans terminal interactif.');
  rl?.close();
  rl = null;
  process.stdout.write(`${question} `);
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish();
          resolve(value.trim());
          return;
        }
        if (ch === '\u0003') {
          finish();
          reject(new Stop('Interrompu.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
    };
    stdin.on('data', onData);
  });
}

// ---------------------------------------------------------------------------
// ssh et Cloudflare

let token = null; // en mémoire seulement : jamais écrit sur le disque du Mac, jamais affiché, jamais en argument

/**
 * Lance `script` sur penny. `input` passe par l'entrée standard du ssh (jamais en argument).
 * Le texte de la commande est vérifié : il ne doit contenir aucune valeur secrète.
 * La sortie est capturée et n'est jamais affichée telle quelle.
 */
function ssh(script, params = [], { input, allowFail = false } = {}) {
  const args = sshArgs(HOTE, script, params);
  assertNoSecret(args, [token]);
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => reject(new Stop(`ssh introuvable ou impossible à lancer : ${e.message}`)));
    child.on('close', (code) => {
      if (code !== 0 && !allowFail) {
        const hint = code === 255 ? ` Vérifie que « ssh ${HOTE} » marche depuis ce terminal.` : '';
        reject(new Stop(`ssh ${HOTE} a échoué (code ${code}).${hint}${err.trim() ? `\n  ${err.trim().split('\n').slice(-3).join('\n  ')}` : ''}`));
      } else resolve({ code, out, err });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

/** Simule (en --dry-run) ou lance une commande sur penny. */
function sshAction(description, script, params, opts) {
  if (DRY) {
    say(`  ${dim('[simulation]')} ${description}`);
    say(`  ${dim(`  ssh ${sshArgs(HOTE, '<script>', params).join(' ')}${opts?.input !== undefined ? '   (entrée standard : ' + opts.stdinLabel + ')' : ''}`)}`);
    return Promise.resolve(null);
  }
  say(`  → ${description}`);
  return ssh(script, params, opts);
}

/** GET à l'API Cloudflare, depuis le Mac (fetch) ou depuis penny (curl, jeton par l'entrée standard). */
async function cfGet(path, mode) {
  if (mode === 'mac') {
    try {
      const response = await fetch(`${CF_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json().catch(() => ({}));
      return { status: response.status, data };
    } catch (error) {
      throw new Stop(`Impossible de joindre l'API Cloudflare depuis le Mac : ${error.message}`);
    }
  }
  const { out } = await ssh(SCRIPT_CF_GET, [`${CF_API}${path}`], { input: `${token}\n` });
  return parseCurlOutput(out);
}

const asArgs = ({ status, data }) => [status, data];

function openBrowser(url) {
  say(`  Ouvre : ${bold(url)}`);
  if (DRY) return;
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => warn('Impossible d\'ouvrir le navigateur : copie l\'adresse ci-dessus.'));
  child.unref();
}

// ---------------------------------------------------------------------------
// Étapes

async function stepGuide() {
  title(1, 'Création du jeton dans Cloudflare (à la main)');
  let ip = { v4: null, v6: null };
  const res = await sshAction(`adresse publique de ${HOTE} (curl https://api.ipify.org)`, SCRIPT_PUBLIC_IP, []);
  if (res) ip = parsePublicIp(res.out);
  if (DRY) ip = { v4: '<adresse IPv4 de penny>', v6: null };
  if (ip.v4 || ip.v6) {
    ok(`Adresse publique de ${HOTE} : ${[ip.v4, ip.v6].filter(Boolean).map(bold).join(' et ')}`);
  } else warn(`Adresse publique de ${HOTE} introuvable : lance « curl https://api.ipify.org » sur ${HOTE} et note-la.`);

  say(`
  Dans Cloudflare : ${bold('Mon profil → Jetons d\'API → Créer un jeton → Jeton personnalisé (« Commencer »)')}.
    • Nom : « Vigie – pilote (KV) ».
    • Autorisations : ${bold('Compte → Workers KV Storage → Modifier')}. Rien d'autre.
    • Ressources du compte : ${bold('Inclure → le compte de Vigie')} (pas « Tous les comptes »).
    • Filtrage des adresses IP clientes : ${bold('Est dans')} → ${[ip.v4, ip.v6].filter(Boolean).join(', ') || 'l\'adresse publique de penny'}.
    • Durée de vie : à ton choix (sans date de fin, ou une date de fin : il faudra alors relancer ce script).
    • « Continuer vers le résumé » → « Créer le jeton » → copie la valeur (Cloudflare ne l'affiche qu'une fois).

  ${yellow('À savoir')} : Cloudflare ne permet pas de limiter ce jeton à un seul espace KV ; il peut lire et écrire
  dans tous les KV du compte. Le filtrage IP limite les dégâts s'il fuit. Si l'adresse publique de penny change
  (box qui redémarre), le pilote ne pourra plus écrire : mets à jour le filtrage dans Cloudflare.`);
  openBrowser(TOKENS_PAGE);
}

async function stepToken() {
  title(2, 'Saisie du jeton');
  if (DRY) {
    say(`  ${dim('[simulation]')} saisie masquée du jeton (gardé en mémoire, jamais écrit sur le Mac ni affiché).`);
    return;
  }
  for (;;) {
    const value = await askHidden('Colle le jeton (rien ne s\'affiche), puis Entrée :');
    const error = checkTokenShape(value);
    if (!error) {
      token = value;
      ok('Jeton reçu.');
      return;
    }
    fail(error);
  }
}

async function stepVerify(kvId) {
  title(3, 'Vérifications avec l\'API Cloudflare');
  const plan = verificationPlan(options.verif);
  if (DRY) {
    say(`  ${dim('[simulation]')} essais dans l'ordre : ${plan.join(' puis ')} (GET seulement, rien n'est modifié) :`);
    say(`  ${dim('[simulation]')}   GET /user/tokens/verify → statut « active »`);
    say(`  ${dim('[simulation]')}   GET /accounts → choix du compte s'il y en a plusieurs`);
    say(`  ${dim('[simulation]')}   GET /accounts/<compte>/storage/kv/namespaces/${kvId}`);
    say(`  ${dim('[simulation]')}   depuis penny : ssh ${HOTE} + curl -H @- (en-tête d'autorisation lu sur l'entrée standard).`);
    return '<compte>';
  }

  let mode = null;
  for (const [i, candidate] of plan.entries()) {
    const where = candidate === 'mac' ? 'le Mac' : HOTE;
    say(`  → GET /user/tokens/verify depuis ${where}`);
    const result = interpretVerify(...asArgs(await cfGet('/user/tokens/verify', candidate)));
    if (result.ok) {
      mode = candidate;
      ok(`Jeton actif${result.expiresOn ? `, expire le ${result.expiresOn}` : ', sans date d\'expiration'} (vérifié depuis ${where}).`);
      break;
    }
    if (shouldFallBack(result) && i < plan.length - 1) {
      warn(`${explainFailure(result, where)} C'est attendu avec le filtrage IP : je vérifie depuis ${HOTE}.`);
      continue;
    }
    throw new Stop(explainFailure(result, where));
  }
  const where = mode === 'mac' ? 'le Mac' : HOTE;

  say(`  → GET /accounts depuis ${where}`);
  const accounts = interpretAccounts(...asArgs(await cfGet('/accounts', mode)));
  if (!accounts.ok) throw new Stop(explainFailure(accounts, where));
  let accountId;
  if (accounts.accounts.length === 1) {
    accountId = accounts.accounts[0].id;
    ok(`Compte : ${accounts.accounts[0].name} (${accountId}).`);
  } else if (accounts.accounts.length > 1) {
    accounts.accounts.forEach((a, i) => say(`    ${i + 1}. ${a.name} (${a.id})`));
    for (;;) {
      const n = Number(await ask('Numéro du compte de Vigie :', '1'));
      if (Number.isInteger(n) && n >= 1 && n <= accounts.accounts.length) {
        accountId = accounts.accounts[n - 1].id;
        break;
      }
      fail('Numéro invalide.');
    }
  } else {
    warn('Le jeton ne liste aucun compte. Copie l\'identifiant du compte depuis le tableau de bord (colonne de droite de la page d\'accueil d\'un domaine, « ID de compte »).');
    for (;;) {
      accountId = (await ask('Identifiant du compte (32 caractères) :')).toLowerCase();
      if (isAccountId(accountId)) break;
      fail('Identifiant invalide : 32 caractères hexadécimaux attendus.');
    }
  }

  say(`  → GET /accounts/${accountId}/storage/kv/namespaces/${kvId} depuis ${where}`);
  const ns = interpretNamespace(...asArgs(await cfGet(`/accounts/${accountId}/storage/kv/namespaces/${kvId}`, mode)), kvId);
  if (!ns.ok) throw new Stop(explainFailure(ns, where));
  ok(`Espace KV accessible : ${ns.title} (${kvId}).`);
  return accountId;
}

async function stepWrite(accountId) {
  title(4, `Écriture sur ${HOTE}`);
  const existing = await sshAction(`fichiers déjà présents dans ${PILOTE_DIR}`, SCRIPT_EXISTING, [PILOTE_DIR]);
  const found = existing ? parseExisting(existing.out) : [];
  if (found.length) {
    warn(`Déjà présents sur ${HOTE} : ${found.join(', ')}.`);
    if (!(await yes('Les remplacer ?', 'n'))) throw new Stop('Arrêté : fichiers existants conservés, rien n\'a été modifié sur penny.');
  }
  const res = await sshAction(
    `écriture de ${PILOTE_DIR}/${TOKEN_FILE} (0600, umask 077) et ${ACCOUNT_FILE}`,
    SCRIPT_WRITE,
    [PILOTE_DIR],
    { input: DRY ? '' : `${token}\n${accountId}\n`, stdinLabel: 'jeton puis identifiant du compte' },
  );
  if (res) {
    const mode = res.out.trim().split('\n').pop();
    if (mode !== '-rw-------') throw new Stop(`Droits inattendus sur ${TOKEN_FILE} : ${mode} (attendu -rw-------).`);
    ok(`Fichiers posés (${TOKEN_FILE} en ${mode}).`);
  }
}

async function stepTest(kvId) {
  title(5, `Test bout en bout depuis ${HOTE}`);
  const value = `vigie-test-${Date.now()}`;
  const params = kvTestParams(PILOTE_DIR, kvId, value);
  const res = await sshAction(
    `écrit, relit puis supprime la clé « ${TEST_KEY} » (jamais « snapshot »), avec le jeton lu dans le fichier posé`,
    SCRIPT_KV_TEST,
    params,
  );
  if (!res) return;
  const t = parseKvTest(res.out);
  if (t.ok) {
    ok('Écriture, relecture et suppression réussies : le pilote pourra écrire l\'instantané.');
    return;
  }
  fail(`Test raté : écriture ${t.put}, relecture ${t.get}${t.get === 200 && !t.identique ? ' (valeur différente)' : ''}, suppression ${t.delete}.`);
  if (t.put === 200 && t.delete !== 200) warn(`La clé « ${TEST_KEY} » est peut-être restée dans le KV : supprime-la (cd worker && npx wrangler kv key delete --binding VIGIE_SNAPSHOT --remote ${TEST_KEY}).`);
  throw new Stop('Le jeton posé sur penny ne permet pas d\'écrire dans le KV : vérifie la permission, le compte et le filtrage IP.');
}

async function stepVault(accountId) {
  title(6, `Vaultwarden (depuis ${HOTE})`);
  const res = await sshAction('état du coffre (bw status)', SCRIPT_BW_STATUS, []);
  if (DRY) {
    say(`  ${dim('[simulation]')} si le coffre est déverrouillé et que tu acceptes : élément « ${BW_ITEM_NAME} » créé par`);
    say(`  ${dim('[simulation]')}   ssh ${HOTE} "bw encode | bw create item", le JSON de l'élément passé par l'entrée standard.`);
    return;
  }
  const status = parseBwStatus(res.out);
  const manual = () =>
    say(`  À la main, dans Vaultwarden : nouvel élément « ${BW_ITEM_NAME} », mot de passe = le jeton.`);
  if (status === 'absent') {
    warn(`La CLI bw n'est pas installée sur ${HOTE}.`);
    manual();
    return;
  }
  if (status !== 'unlocked') {
    warn(`Coffre ${status === 'locked' ? 'verrouillé' : status === 'unauthenticated' ? 'non connecté' : 'dans un état inconnu'} pour une session ssh non interactive.`);
    say(`  Le déverrouillage donne une clé de session (BW_SESSION) que ce script ne manipule pas, et une session ssh`);
    say(`  non interactive ne voit que celle de ton environnement de connexion. Range le jeton toi-même :`);
    manual();
    say('  Je continue sans le coffre.');
    return;
  }
  if (!(await yes(`Ranger le jeton dans le coffre (élément « ${BW_ITEM_NAME} ») ?`, 'o'))) {
    manual();
    return;
  }
  const r = await ssh(SCRIPT_BW_CREATE, [], { input: JSON.stringify(bwItem(token, accountId)), allowFail: true });
  if (r.code === 0 && r.out.trim().endsWith('cree')) {
    ok('Élément créé. Pense à lancer « bw sync » ailleurs si besoin.');
  } else {
    warn(`La création a échoué (code ${r.code}).`);
    manual();
  }
}

async function stepEnd() {
  title(7, 'Et ensuite');
  const domain = readDomain(await readFile(TOML, 'utf8'));
  const host = domain?.host ?? 'vigie.<ton-domaine>';
  say(`  • Le pilote passe ${bold('toutes les heures, de 8 h 13 à 21 h 13 (heure de Paris)')} et écrira l'instantané à son prochain passage.`);
  say(`  • Vérifie ensuite ${bold(`https://${host}/api/sessions`)} (dans le navigateur, derrière Access) : « snapshotAt » doit être récent.`);
  say('  • Révoquer le jeton :');
  for (const line of revokeHelp(HOTE)) say(`      ${line}`);
}

// ---------------------------------------------------------------------------

async function main() {
  const kvId = readKvId(await readFile(TOML, 'utf8'));
  if (!kvId || kvId === PLACEHOLDER_KV_ID) throw new Stop('worker/wrangler.toml n\'a pas encore l\'identifiant du KV VIGIE_SNAPSHOT : lance d\'abord `npm run mise-en-route`.');

  say(bold(`Jeton Cloudflare du pilote, sur ${HOTE}${DRY ? ' — simulation (--dry-run) : rien n\'est modifié, ni réseau ni ssh' : ''}`));
  say(dim(`Espace KV : ${kvId} (worker/wrangler.toml). Vérification : --verif ${options.verif}.`));

  await stepGuide();
  await stepToken();
  const accountId = await stepVerify(kvId);
  await stepWrite(accountId);
  await stepTest(kvId);
  await stepVault(accountId);
  await stepEnd();
}

try {
  await main();
} catch (error) {
  say();
  if (error instanceof Stop) fail(error.message);
  else fail(`Erreur inattendue : ${error?.message ?? error}`);
  process.exitCode = 1;
} finally {
  token = null;
  rl?.close();
}
