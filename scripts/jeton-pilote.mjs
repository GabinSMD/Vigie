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
  VAULT_ITEM_NAME,
  CF_API,
  PILOTE_DIR,
  SCRIPT_BW_CREATE,
  SCRIPT_VAULT_TOOL,
  SCRIPT_VW_EXISTS,
  SCRIPT_VW_WRITE,
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
  clipboardCommand,
  ipFilterEntries,
  isAccountId,
  kvTestParams,
  parseArgs,
  parseBwStatus,
  parseCurlOutput,
  parseExisting,
  parseKvTest,
  parsePublicIp,
  revokeHelp,
  runVerifications,
  sshArgs,
  verificationPlan,
  vwWriteParams,
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

let ipFilter = []; // entrées du filtrage IP proposées à l'étape 1 (notées dans le coffre)
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
  const filter = DRY ? [ip.v4, '<préfixe IPv6 /64 s\'il y en a un>'] : ipFilterEntries(ip);
  ipFilter = DRY ? [] : filter;
  if (ip.v4 || ip.v6) {
    ok(`Adresse publique de ${HOTE} : ${[ip.v4, ip.v6].filter(Boolean).map(bold).join(' et ')}`);
  } else warn(`Adresse publique de ${HOTE} introuvable : lance « curl https://api.ipify.org » sur ${HOTE} et note-la.`);

  say(`
  Dans Cloudflare : ${bold('Jetons API → Créer un jeton → Commencer de zéro → « Commencer avec une politique de compte »')}.
    • Nom du jeton : « Vigie – pilote (KV) ».
    • Politique : ${bold('Inclure → le compte de Vigie')} (choisi dans la liste, pas « Tous les comptes »),
      puis cherche ${bold('Workers KV Storage')} et coche ${bold('Modifier')} (« Stockage KV de Workers »). Rien d'autre.
    • Expiration du jeton : à ton choix (« Pas d'expiration », ou une date : il faudra alors relancer ce script).
    • Filtrage des adresses IP client : ${bold('Autoriser')} → ${filter.length ? filter.map(bold).join(' et ') : 'l\'adresse publique de penny'}
      (une entrée par ligne, « Ajouter plus »). Jamais l'adresse Tailscale (100.x.x.x) : Cloudflare ne la voit pas.
    • « Continuer vers le résumé » → « Créer le jeton » → copie la valeur (Cloudflare ne l'affiche qu'une fois).

  ${yellow('À savoir')} : Cloudflare ne permet pas de limiter ce jeton à un seul espace KV ; il peut lire et écrire
  dans tous les KV du compte. Le filtrage IP limite les dégâts s'il fuit. Si ton réseau a de l'IPv6, mets aussi
  le préfixe /64 : sinon les appels qui partent en IPv6 (le pilote compris) sont refusés. Si l'adresse publique
  change (box qui redémarre, autre fournisseur), modifie le filtrage du jeton : sa valeur ne change pas.`);
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

  try {
    const { accountId } = await runVerifications({
      plan,
      kvId,
      request: cfGet,
      chooseAccount,
      where: (mode) => (mode === 'mac' ? 'le Mac' : HOTE),
      log: (type, message) => (type === 'ok' ? ok(message) : type === 'bascule' ? warn(message) : say(`  → ${message}`)),
    });
    return accountId;
  } catch (error) {
    if (error instanceof Stop) throw error;
    throw new Stop(error.message);
  }
}

async function chooseAccount(accounts) {
  if (accounts.length === 1) {
    ok(`Compte : ${accounts[0].name} (${accounts[0].id}).`);
    return accounts[0].id;
  }
  if (accounts.length > 1) {
    accounts.forEach((a, i) => say(`    ${i + 1}. ${a.name} (${a.id})`));
    for (;;) {
      const n = Number(await ask('Numéro du compte de Vigie :', '1'));
      if (Number.isInteger(n) && n >= 1 && n <= accounts.length) return accounts[n - 1].id;
      fail('Numéro invalide.');
    }
  }
  warn('Le jeton ne liste aucun compte. Copie l\'identifiant du compte depuis le tableau de bord (colonne de droite de la page d\'accueil d\'un domaine, « ID de compte »).');
  for (;;) {
    const id = (await ask('Identifiant du compte (32 caractères) :')).toLowerCase();
    if (isAccountId(id)) return id;
    fail('Identifiant invalide : 32 caractères hexadécimaux attendus.');
  }
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
  const res = await sshAction('outil de coffre disponible (vw.sh, sinon bw)', SCRIPT_VAULT_TOOL, []);
  const manual = () => {
    say(`  À la main, dans Vaultwarden : nouvel élément « ${VAULT_ITEM_NAME} », mot de passe = le jeton.`);
    say(`  Pour copier le jeton sans l'afficher (depuis ton Mac) : ${bold(clipboardCommand(HOTE))}`);
    say('  Puis vide le presse-papiers en copiant autre chose.');
  };
  if (DRY) {
    const params = vwWriteParams({ accountId, filter: ipFilter });
    say(`  ${dim('[simulation]')} avec vw.sh (si l'élément existe déjà, je demande avant de le mettre à jour) :`);
    say(`  ${dim(`    ssh ${sshArgs(HOTE, '<script : copie sans retour à la ligne, puis vw.sh ecrire>', params).join(' ')}`)}`);
    say(`  ${dim('[simulation]')} sans vw.sh mais avec bw déverrouillé : ssh ${HOTE} "bw encode | bw create item", JSON par l'entrée standard.`);
    return;
  }
  const tool = parseBwStatus(res.out);

  if (tool === 'vw') {
    const exists = (await ssh(SCRIPT_VW_EXISTS, [VAULT_ITEM_NAME], { allowFail: true })).out.trim();
    const question = exists === 'present' ? `« ${VAULT_ITEM_NAME} » existe déjà : mettre à jour son mot de passe avec ce jeton ?` : `Ranger le jeton dans le coffre (élément « ${VAULT_ITEM_NAME} », collection du compte machine) ?`;
    if (!(await yes(question, exists === 'present' ? 'n' : 'o'))) {
      manual();
      return;
    }
    say(`  → vw.sh ecrire (le jeton est lu dans le fichier posé, jamais en argument)`);
    const r = await ssh(SCRIPT_VW_WRITE, vwWriteParams({ accountId, filter: ipFilter }), { allowFail: true });
    if (r.code === 0) {
      ok(`Coffre : ${r.out.trim().split('\n').pop() || 'élément enregistré'}.`);
      return;
    }
    warn(`vw.sh a échoué (code ${r.code}).${r.err.trim() ? `\n  ${r.err.trim().split('\n').slice(-3).join('\n  ')}` : ''}`);
    say('  Une erreur « EEXIST » de bunx est passagère : relance ce script, ou range le jeton à la main.');
    manual();
    return;
  }
  if (tool === 'absent') {
    warn(`Ni vw.sh ni bw sur ${HOTE}.`);
    manual();
    return;
  }
  if (tool !== 'unlocked') {
    warn(`Coffre bw ${tool === 'locked' ? 'verrouillé' : tool === 'unauthenticated' ? 'non connecté' : 'dans un état inconnu'} pour une session ssh non interactive.`);
    say('  Le déverrouillage donne une clé de session (BW_SESSION) que ce script ne manipule pas. Range le jeton toi-même :');
    manual();
    return;
  }
  if (!(await yes(`Ranger le jeton dans le coffre (élément « ${VAULT_ITEM_NAME} ») ?`, 'o'))) {
    manual();
    return;
  }
  const r = await ssh(SCRIPT_BW_CREATE, [], { input: JSON.stringify(bwItem(token, accountId)), allowFail: true });
  if (r.code === 0 && r.out.trim().endsWith('cree')) ok('Élément créé.');
  else {
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
  say(`  • ${bold('Révoquer le jeton')} :`);
  for (const line of revokeHelp(HOTE)) say(`    ${line}`);
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
