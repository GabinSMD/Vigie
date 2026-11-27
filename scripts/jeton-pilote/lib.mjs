// Parties pures du script jeton-pilote : aucune entrée/sortie, aucun réseau, aucun ssh.
// Testées par scripts/jeton-pilote/lib.test.mjs.
//
// Règle de sécurité : le jeton ne figure JAMAIS dans les arguments d'une commande (ni sur le Mac, ni
// sur penny). Les scripts distants ci-dessous sont fixes ; le jeton leur arrive par l'entrée standard
// du ssh (lu avec `read`, une commande interne du shell) ou par le fichier posé sur penny, et `curl`
// lit l'en-tête d'autorisation sur son entrée standard (`-H @-`), envoyé par `printf` (interne lui aussi).

export const CF_API = 'https://api.cloudflare.com/client/v4';
export const TOKENS_PAGE = 'https://dash.cloudflare.com/profile/api-tokens';
export const PILOTE_DIR = '/mnt/ssd/claude-work/pilote-cloud';
export const TOKEN_FILE = 'cloudflare-kv.token';
export const ACCOUNT_FILE = 'cloudflare-account.id';
/** Clé lue par l'app : le script n'y touche jamais. */
export const SNAPSHOT_KEY = 'snapshot';
/** Clé du test bout en bout (écrite, relue, puis supprimée). */
export const TEST_KEY = 'vigie-test-jeton';
export const BW_ITEM_NAME = 'Cloudflare – jeton KV du pilote Vigie';
export const VERIF_MODES = ['auto', 'mac', 'penny'];

/** Analyse les options de la ligne de commande. */
export function parseArgs(argv) {
  const options = { dryRun: false, hote: 'penny', verif: 'auto', help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (name) => {
      const v = arg === name ? argv[++i] : arg.slice(name.length + 1);
      if (!v) throw new Error(`${name} attend une valeur.`);
      return v;
    };
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--hote' || arg.startsWith('--hote=')) {
      const v = value('--hote');
      if (!/^[A-Za-z0-9._@-]+$/.test(v) || v.startsWith('-')) throw new Error(`Alias ssh invalide : ${v}`);
      options.hote = v;
    } else if (arg === '--verif' || arg.startsWith('--verif=')) {
      const v = value('--verif');
      if (!VERIF_MODES.includes(v)) throw new Error(`--verif attend ${VERIF_MODES.join(', ')} (reçu : ${v}).`);
      options.verif = v;
    } else throw new Error(`Option inconnue : ${arg}`);
  }
  return options;
}

// ---------------------------------------------------------------------------
// Commandes ssh

/** Met une chaîne entre apostrophes pour un shell POSIX. */
export const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * Arguments de `ssh` pour lancer `script` (shell POSIX) sur `host`, avec des paramètres positionnels.
 * Le shell de connexion distant reçoit une seule chaîne : `sh -c '<script>' sh '<arg1>' …`.
 */
export function sshArgs(host, script, params = []) {
  return ['-T', '-o', 'ConnectTimeout=15', host, ['sh', '-c', shellQuote(script), 'sh', ...params.map(shellQuote)].join(' ')];
}

/** Lève une erreur si une valeur secrète apparaît dans une liste d'arguments. */
export function assertNoSecret(args, secrets) {
  for (const secret of secrets) {
    if (secret && args.some((a) => String(a).includes(secret))) {
      throw new Error('Refusé : une valeur secrète se retrouverait dans les arguments d\'une commande.');
    }
  }
}

/** Adresses publiques de penny (IPv4 et, s'il y en a une, IPv6). Sortie : lignes « v4 x » / « v6 y ». */
export const SCRIPT_PUBLIC_IP = [
  'v4=$(curl -4 -s --max-time 10 https://api.ipify.org || true)',
  'v6=$(curl -6 -s --max-time 10 https://api64.ipify.org || true)',
  'echo "v4 $v4"',
  'echo "v6 $v6"',
].join('\n');

/** Fichiers déjà présents. Paramètres : dossier. Sortie : un nom de fichier par ligne. */
export const SCRIPT_EXISTING = [
  'd=$1',
  `for f in ${TOKEN_FILE} ${ACCOUNT_FILE}; do`,
  '  if [ -e "$d/$f" ]; then echo "$f"; fi',
  'done',
].join('\n');

/**
 * Écrit le jeton (0600) et l'identifiant du compte. Paramètres : dossier.
 * Entrée standard : jeton, puis identifiant du compte, une ligne chacun.
 * `umask 077` avant toute création : aucun instant où le fichier serait lisible par d'autres ;
 * fichier temporaire puis `mv` : le pilote ne lit jamais un fichier à moitié écrit.
 */
export const SCRIPT_WRITE = [
  'set -eu',
  'umask 077',
  'd=$1',
  'mkdir -p "$d"',
  'IFS= read -r t',
  'IFS= read -r a',
  '[ -n "$t" ] && [ -n "$a" ] || { echo "entrée vide" >&2; exit 3; }',
  `tmp=$(mktemp "$d/.${TOKEN_FILE}.XXXXXX")`,
  'printf \'%s\\n\' "$t" > "$tmp"',
  'chmod 600 "$tmp"',
  `mv -f "$tmp" "$d/${TOKEN_FILE}"`,
  `tmp=$(mktemp "$d/.${ACCOUNT_FILE}.XXXXXX")`,
  'printf \'%s\\n\' "$a" > "$tmp"',
  'chmod 600 "$tmp"',
  `mv -f "$tmp" "$d/${ACCOUNT_FILE}"`,
  `ls -l "$d/${TOKEN_FILE}" | cut -c1-10`,
].join('\n');

/**
 * Requête GET à l'API Cloudflare depuis penny. Paramètres : URL. Entrée standard : le jeton.
 * Sortie : corps de la réponse, puis une dernière ligne avec le code HTTP.
 */
export const SCRIPT_CF_GET = [
  'set -eu',
  'IFS= read -r t',
  'printf \'Authorization: Bearer %s\\n\' "$t" | curl -sS --max-time 20 -H @- -w \'\\n%{http_code}\' "$1"',
].join('\n');

/**
 * Test bout en bout depuis penny, avec le jeton et le compte lus dans les fichiers posés.
 * Paramètres : dossier, id du KV, clé, valeur. Sortie : « put <code> », « get <code> identique|different »,
 * « delete <code> ». La suppression est tentée même si l'écriture a échoué.
 */
export const SCRIPT_KV_TEST = [
  'set -u',
  'd=$1; ns=$2; key=$3; val=$4',
  `IFS= read -r t < "$d/${TOKEN_FILE}"`,
  `IFS= read -r a < "$d/${ACCOUNT_FILE}"`,
  `u="${CF_API}/accounts/$a/storage/kv/namespaces/$ns/values/$key"`,
  'h() { printf \'Authorization: Bearer %s\\n\' "$t"; }',
  'p=$(h | curl -sS --max-time 20 -o /dev/null -w \'%{http_code}\' -X PUT -H @- --data-binary "$val" "$u") || p=000',
  'echo "put $p"',
  'g=$(h | curl -sS --max-time 20 -w \'\\n%{http_code}\' -H @- "$u") || g="',
  '000"',
  'gc=$(printf \'%s\\n\' "$g" | tail -n 1)',
  'gb=$(printf \'%s\\n\' "$g" | sed \'$d\')',
  'if [ "$gb" = "$val" ]; then same=identique; else same=different; fi',
  'echo "get $gc $same"',
  'x=$(h | curl -sS --max-time 20 -o /dev/null -w \'%{http_code}\' -X DELETE -H @- "$u") || x=000',
  'echo "delete $x"',
].join('\n');

/** État du coffre sur penny : la sortie JSON de `bw status`, ou « absent » si la CLI manque. */
export const SCRIPT_BW_STATUS = 'if command -v bw >/dev/null 2>&1; then bw status 2>/dev/null || echo "{}"; else echo absent; fi';

/** Crée l'élément du coffre. Entrée standard : le JSON de l'élément (`bw encode` puis `bw create item` le lisent sur stdin). */
export const SCRIPT_BW_CREATE = 'set -eu\nbw encode | bw create item >/dev/null\necho cree';

/** Arguments du test bout en bout. Refuse toute clé autre que la clé de test (jamais `snapshot`). */
export function kvTestParams(dir, namespaceId, value, key = TEST_KEY) {
  if (key === SNAPSHOT_KEY || key !== TEST_KEY) throw new Error(`Le test n'écrit que dans la clé ${TEST_KEY}, jamais dans ${SNAPSHOT_KEY}.`);
  if (!isKvId(namespaceId)) throw new Error(`Identifiant de KV invalide : ${namespaceId}`);
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) throw new Error('Valeur de test invalide.');
  return [dir, namespaceId, key, value];
}

// ---------------------------------------------------------------------------
// Validation et lecture des sorties

export const isKvId = (s) => /^[0-9a-f]{32}$/.test(s ?? '');
export const isAccountId = isKvId;

/** Forme d'un jeton d'API Cloudflare : pas d'espace, assez long. Renvoie un message d'erreur ou null. */
export function checkTokenShape(token) {
  if (!token) return 'Jeton vide.';
  if (/\s/.test(token)) return 'Le jeton contient un espace ou un retour à la ligne : recopie-le.';
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return 'Le jeton contient des caractères inattendus : recopie-le.';
  if (token.length < 30) return 'Le jeton est trop court : as-tu copié le jeton (affiché une seule fois), pas son identifiant ?';
  return null;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;

/** Lit la sortie de SCRIPT_PUBLIC_IP : { v4, v6 } (null si absente ou invalide). */
export function parsePublicIp(output) {
  const res = { v4: null, v6: null };
  for (const line of output.split('\n')) {
    const [kind, value = ''] = line.trim().split(/\s+/);
    if (kind === 'v4' && IPV4.test(value)) res.v4 = value;
    if (kind === 'v6' && IPV6.test(value) && value.includes(':')) res.v6 = value;
  }
  return res;
}

/** Lit la sortie de SCRIPT_EXISTING : noms des fichiers déjà présents. */
export const parseExisting = (output) =>
  output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l === TOKEN_FILE || l === ACCOUNT_FILE);

/** Sépare la sortie de SCRIPT_CF_GET : { status, data }. */
export function parseCurlOutput(output) {
  const text = output.replace(/\n+$/, '');
  const i = text.lastIndexOf('\n');
  const status = Number(text.slice(i + 1).trim());
  const body = i < 0 ? '' : text.slice(0, i);
  let data = {};
  try {
    data = JSON.parse(body);
  } catch {
    data = {};
  }
  return { status: Number.isInteger(status) ? status : 0, data };
}

/** Lit la sortie de SCRIPT_KV_TEST. */
export function parseKvTest(output) {
  const res = { put: 0, get: 0, identique: false, delete: 0 };
  for (const line of output.split('\n')) {
    const [step, code, extra] = line.trim().split(/\s+/);
    if (step === 'put') res.put = Number(code);
    if (step === 'get') {
      res.get = Number(code);
      res.identique = extra === 'identique';
    }
    if (step === 'delete') res.delete = Number(code);
  }
  res.ok = res.put === 200 && res.get === 200 && res.identique && res.delete === 200;
  return res;
}

/** Lit la sortie de SCRIPT_BW_STATUS : 'absent', 'unlocked', 'locked', 'unauthenticated' ou 'inconnu'. */
export function parseBwStatus(output) {
  const text = output.trim();
  if (text === 'absent') return 'absent';
  try {
    const status = JSON.parse(text.slice(text.indexOf('{'))).status;
    return ['unlocked', 'locked', 'unauthenticated'].includes(status) ? status : 'inconnu';
  } catch {
    return 'inconnu';
  }
}

/** Élément du coffre (type « identifiant »). Le jeton n'est que dans `login.password`. */
export function bwItem(token, accountId, now = new Date()) {
  return {
    organizationId: null,
    collectionIds: null,
    folderId: null,
    type: 1,
    name: BW_ITEM_NAME,
    notes:
      `Jeton d'API Cloudflare du pilote des sessions cloud (Vigie), posé le ${now.toISOString().slice(0, 10)}.\n` +
      `Permission : Compte → Workers KV Storage → Modifier. Filtrage IP : penny.\n` +
      `Compte Cloudflare : ${accountId}. Fichier sur penny : ${PILOTE_DIR}/${TOKEN_FILE}.`,
    favorite: false,
    fields: [],
    login: { uris: [{ match: null, uri: TOKENS_PAGE }], username: null, password: token, totp: null },
    reprompt: 0,
  };
}

// ---------------------------------------------------------------------------
// Réponses de l'API Cloudflare

const errorsOf = (data) => (Array.isArray(data?.errors) ? data.errors : []);

/**
 * Classe une erreur de l'API Cloudflare :
 * 'ip' : le filtrage IP du jeton refuse l'appel (code 9109, « Cannot use the access token from location »),
 * 'jeton' : jeton invalide, expiré ou révoqué, 'permission' : jeton valide mais sans le droit demandé,
 * 'introuvable', 'autre'.
 */
export function classifyCfError(status, data) {
  const errors = errorsOf(data);
  const text = errors.map((e) => `${e.code} ${e.message}`).join(' ; ');
  if (errors.some((e) => e.code === 9109) || /from location|ip address|not allowed from/i.test(text)) return { kind: 'ip', detail: text };
  if (status === 401 || errors.some((e) => [1000, 1001, 6003, 6111, 9106].includes(e.code)) || /invalid (api )?token|invalid request headers/i.test(text))
    return { kind: 'jeton', detail: text };
  if (status === 403 || errors.some((e) => e.code === 10000)) return { kind: 'permission', detail: text };
  if (status === 404) return { kind: 'introuvable', detail: text };
  return { kind: 'autre', detail: text || `réponse ${status}` };
}

const failed = (status, data) => !(status >= 200 && status < 300) || data?.success === false;

/** Réponse de GET /user/tokens/verify. */
export function interpretVerify(status, data) {
  if (failed(status, data)) return { ok: false, ...classifyCfError(status, data) };
  const r = data?.result ?? {};
  if (r.status !== 'active') return { ok: false, kind: 'jeton', detail: `statut du jeton : ${r.status ?? 'inconnu'} (attendu : active)` };
  return { ok: true, id: r.id ?? null, expiresOn: r.expires_on ?? null, notBefore: r.not_before ?? null };
}

/** Réponse de GET /accounts : [{ id, name }]. */
export function interpretAccounts(status, data) {
  if (failed(status, data)) return { ok: false, ...classifyCfError(status, data) };
  const accounts = (Array.isArray(data?.result) ? data.result : [])
    .filter((a) => isAccountId(a?.id))
    .map((a) => ({ id: a.id, name: a.name ?? a.id }));
  return { ok: true, accounts };
}

/** Réponse de GET /accounts/:compte/storage/kv/namespaces/:id. */
export function interpretNamespace(status, data, namespaceId) {
  if (failed(status, data)) return { ok: false, ...classifyCfError(status, data) };
  if (data?.result?.id !== namespaceId) return { ok: false, kind: 'autre', detail: 'réponse sans l\'espace KV attendu' };
  return { ok: true, title: data.result.title ?? namespaceId };
}

// ---------------------------------------------------------------------------
// Choix du mode de vérification

/**
 * Ordre des essais : `auto` vérifie depuis le Mac, puis depuis penny si le filtrage IP refuse le Mac ;
 * `mac` et `penny` n'essaient qu'un seul endroit.
 */
export function verificationPlan(option) {
  if (option === 'mac') return ['mac'];
  if (option === 'penny') return ['penny'];
  return ['mac', 'penny'];
}

/** Après un échec, passe-t-on au mode suivant ? Seulement si c'est le filtrage IP qui a refusé. */
export const shouldFallBack = (result) => !result.ok && result.kind === 'ip';

/** Explication d'un échec, à afficher (ne contient jamais le jeton : seulement codes et messages de Cloudflare). */
export function explainFailure(result, where) {
  const detail = result.detail ? ` (${result.detail})` : '';
  switch (result.kind) {
    case 'ip':
      return `Cloudflare refuse l'appel depuis ${where} : le filtrage IP du jeton ne l'autorise pas${detail}.`;
    case 'jeton':
      return `Jeton refusé : invalide, expiré, pas encore actif ou révoqué${detail}.`;
    case 'permission':
      return `Le jeton est valide mais n'a pas le droit demandé : vérifie « Compte → Workers KV Storage → Modifier » et le compte choisi${detail}.`;
    case 'introuvable':
      return `Introuvable : vérifie le compte choisi et l'identifiant du KV dans worker/wrangler.toml${detail}.`;
    default:
      return `Réponse inattendue de Cloudflare${detail}.`;
  }
}

/** Page du tableau de bord : jetons (révocation). */
export const revokeHelp = (hote) => [
  `Cloudflare : ${TOKENS_PAGE} → le jeton → « … » → Supprimer (ou « Renouveler » pour en changer la valeur).`,
  `Puis, sur ${hote} : rm ${PILOTE_DIR}/${TOKEN_FILE} (le pilote saute alors l'instantané sans rien casser).`,
];
