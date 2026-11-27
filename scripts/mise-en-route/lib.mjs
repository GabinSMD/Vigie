// Parties pures du script de mise en route : aucune entrée/sortie, aucun réseau.
// Testées par scripts/mise-en-route/lib.test.mjs.

import { createPrivateKey, randomBytes, sign, timingSafeEqual } from 'node:crypto';

/** Étapes, dans l'ordre d'exécution. `--from <nom|numéro>` reprend à l'une d'elles. */
export const STEPS = [
  { id: 'questions', titre: 'Questions de départ' },
  { id: 'github-app', titre: 'Création de la GitHub App (manifeste)' },
  { id: 'cle', titre: 'Conversion de la clé privée en PKCS#8' },
  { id: 'installations', titre: 'Installations de l\'App et dépôts suivis' },
  { id: 'cloudflare', titre: 'Cloudflare : connexion, KV, wrangler.toml' },
  { id: 'access', titre: 'Cloudflare Access (avant toute exposition publique)' },
  { id: 'ordres', titre: 'File des ordres : base D1, migrations, accès du pilote' },
  { id: 'deploiement', titre: 'Build de l\'app et déploiement du Worker' },
  { id: 'secrets', titre: 'Secrets du Worker' },
  { id: 'verification', titre: 'Vérification : Access bloque bien' },
  { id: 'nettoyage', titre: 'Nettoyage' },
];

/** Analyse les options de la ligne de commande. */
export function parseArgs(argv) {
  const options = { dryRun: false, from: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--from' || arg.startsWith('--from=')) {
      const value = arg === '--from' ? argv[++i] : arg.slice('--from='.length);
      if (!value) throw new Error('--from attend un nom ou un numéro d\'étape.');
      options.from = resolveStep(value);
    } else throw new Error(`Option inconnue : ${arg}`);
  }
  return options;
}

/** Accepte un nom (`access`) ou un numéro (1 à 10). Renvoie l'identifiant de l'étape. */
export function resolveStep(value) {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= STEPS.length) return STEPS[n - 1].id;
  const step = STEPS.find((s) => s.id === value);
  if (!step) throw new Error(`Étape inconnue : ${value}. Étapes : ${STEPS.map((s, i) => `${i + 1}=${s.id}`).join(', ')}`);
  return step.id;
}

// ---------------------------------------------------------------------------
// Questions de départ

const HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Vérifie le nom d'hôte et la zone. Renvoie un message d'erreur, ou null si tout va bien. */
export function checkDomain(host, zone) {
  if (!HOST.test(host)) return `« ${host} » n'est pas un nom d'hôte valide (ex. vigie.mondomaine.fr).`;
  if (!HOST.test(zone)) return `« ${zone} » n'est pas une zone valide (ex. mondomaine.fr).`;
  if (host === zone) return 'Vigie a besoin d\'un sous-domaine (ex. vigie.mondomaine.fr), pas de la zone elle-même.';
  if (!host.endsWith(`.${zone}`)) return `${host} n'appartient pas à la zone ${zone}.`;
  return null;
}

/** Zone proposée par défaut : le nom d'hôte sans son premier libellé. */
export const defaultZone = (host) => host.split('.').slice(1).join('.');

export const isEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// ---------------------------------------------------------------------------
// GitHub App par manifeste

/** Permissions de l'App : toutes en lecture seule, rien d'autre. */
export const APP_PERMISSIONS = Object.freeze({
  contents: 'read',
  pull_requests: 'read',
  issues: 'read',
  checks: 'read',
  metadata: 'read',
});

/** Manifeste de la GitHub App (https://docs.github.com/apps/sharing-github-apps/registering-a-github-app-from-a-manifest). */
export function buildManifest({ name = 'Vigie', homepage, redirectUrl }) {
  return {
    name,
    url: homepage,
    description: 'Vigie : lecture seule des PR, de la CI et des issues des dépôts suivis.',
    hook_attributes: { url: homepage, active: false },
    redirect_url: redirectUrl,
    public: true,
    default_permissions: { ...APP_PERMISSIONS },
    default_events: [],
  };
}

export const newState = () => randomBytes(24).toString('hex');

/** Compare deux `state` en temps constant. */
export function sameState(expected, received) {
  if (typeof received !== 'string' || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Page locale qui poste le manifeste à GitHub (formulaire envoyé automatiquement). */
export function manifestPage(manifest, state) {
  const action = `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`;
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Vigie : création de la GitHub App</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 36rem; margin: 3rem auto; line-height: 1.5">
<h1>Création de la GitHub App « ${escapeHtml(manifest.name)} »</h1>
<p>Tu vas être envoyé sur GitHub. Vérifie le nom, puis clique sur <strong>Create GitHub App</strong>.</p>
<form id="f" method="post" action="${escapeHtml(action)}">
<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
<button type="submit">Continuer vers GitHub</button>
</form>
<script>document.getElementById('f').submit();</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Clé privée et JWT

/** Convertit une clé PEM (PKCS#1 ou PKCS#8) en PKCS#8, sans openssl. */
export function toPkcs8(pem) {
  return createPrivateKey({ key: pem, format: 'pem' }).export({ type: 'pkcs8', format: 'pem' }).toString();
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** JWT d'App GitHub (RS256), valable 9 minutes. */
export function appJwt(appId, pem, nowSeconds) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 9 * 60, iss: String(appId) }));
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPrivateKey(pem));
  return `${header}.${payload}.${b64url(signature)}`;
}

// ---------------------------------------------------------------------------
// Installations et dépôts suivis

/** Dépôts attendus par compte, d'après config/projets.json. */
export function expectedRepos(config) {
  const byAccount = new Map(config.comptes.map((c) => [c, []]));
  for (const p of config.projets) {
    if (!byAccount.has(p.owner)) byAccount.set(p.owner, []);
    byAccount.get(p.owner).push(p.repo);
  }
  return byAccount;
}

/**
 * Associe chaque compte de la config à son installation (comparaison sans casse).
 * `installations` : réponse de GET /app/installations.
 */
export function matchInstallations(config, installations) {
  const found = {};
  const missing = [];
  for (const compte of config.comptes) {
    const inst = installations.find((i) => i.account?.login?.toLowerCase() === compte.toLowerCase());
    if (inst) found[compte] = inst;
    else missing.push(compte);
  }
  return { found, missing };
}

/**
 * Compare les dépôts accessibles à chaque installation avec la config.
 * `reposByAccount` : { compte: ["owner/repo", …] } (full_name renvoyé par GitHub).
 */
export function compareRepos(config, reposByAccount) {
  const problems = [];
  for (const [compte, attendus] of expectedRepos(config)) {
    const actuels = (reposByAccount[compte] ?? []).map((full) => full.split('/').pop());
    const lower = new Set(actuels.map((r) => r.toLowerCase()));
    const want = new Set(attendus.map((r) => r.toLowerCase()));
    const manquants = attendus.filter((r) => !lower.has(r.toLowerCase()));
    const enTrop = actuels.filter((r) => !want.has(r.toLowerCase()));
    if (manquants.length || enTrop.length) problems.push({ compte, manquants, enTrop });
  }
  return problems;
}

/** Valeur du secret GITHUB_INSTALLATIONS, avec les noms de compte tels qu'écrits dans la config. */
export function installationsSecret(config, found) {
  const map = {};
  for (const compte of config.comptes) map[compte] = found[compte].id;
  return JSON.stringify(map);
}

/** Lien vers la page de réglage d'une installation (choix des dépôts). */
export function installationSettingsUrl(inst) {
  if (inst.html_url) return inst.html_url;
  const login = inst.account?.login;
  return inst.account?.type === 'Organization'
    ? `https://github.com/organizations/${login}/settings/installations/${inst.id}`
    : `https://github.com/settings/installations/${inst.id}`;
}

// ---------------------------------------------------------------------------
// wrangler.toml : modifications ciblées, le reste du fichier est conservé tel quel

export const PLACEHOLDER_KV_ID = '00000000000000000000000000000000';

function kvSection(lines, binding) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '[[kv_namespaces]]') continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*\[/.test(lines[j])) {
        end = j;
        break;
      }
    }
    const body = lines.slice(i + 1, end);
    if (body.some((l) => new RegExp(`^\\s*binding\\s*=\\s*"${binding}"`).test(l))) return { start: i + 1, end };
  }
  return null;
}

/** Lit l'identifiant du KV `binding` (ou null). */
export function readKvId(toml, binding = 'VIGIE_SNAPSHOT') {
  const lines = toml.split('\n');
  const section = kvSection(lines, binding);
  if (!section) return null;
  for (let i = section.start; i < section.end; i++) {
    const m = lines[i].match(/^\s*id\s*=\s*"([^"]*)"/);
    if (m) return m[1];
  }
  return null;
}

/** Remplace l'identifiant du KV `binding`. Lève une erreur si la section est introuvable. */
export function setKvId(toml, id, binding = 'VIGIE_SNAPSHOT') {
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error(`Identifiant de KV invalide : ${id}`);
  const lines = toml.split('\n');
  const section = kvSection(lines, binding);
  if (!section) throw new Error(`Section [[kv_namespaces]] avec binding = "${binding}" introuvable dans wrangler.toml.`);
  for (let i = section.start; i < section.end; i++) {
    if (/^\s*id\s*=\s*"[^"]*"/.test(lines[i])) {
      lines[i] = lines[i].replace(/"[^"]*"/, `"${id}"`);
      return lines.join('\n');
    }
  }
  throw new Error(`Ligne id = "…" introuvable sous le binding ${binding}.`);
}

const ROUTE = /^(\s*\{\s*pattern\s*=\s*)"([^"]*)"(\s*,\s*zone_name\s*=\s*)"([^"]*)"(\s*,\s*custom_domain\s*=\s*true\s*\}.*)$/;

/** Lit le domaine personnalisé de wrangler.toml : { host, zone } ou null. */
export function readDomain(toml) {
  for (const line of toml.split('\n')) {
    const m = line.match(ROUTE);
    if (m) return { host: m[2], zone: m[4] };
  }
  return null;
}

/** Remplace le nom d'hôte et la zone du domaine personnalisé. */
export function setDomain(toml, host, zone) {
  const lines = toml.split('\n');
  const i = lines.findIndex((l) => ROUTE.test(l));
  if (i < 0) throw new Error('Route custom_domain introuvable dans wrangler.toml.');
  lines[i] = lines[i].replace(ROUTE, (_, a, _h, b, _z, c) => `${a}"${host}"${b}"${zone}"${c}`);
  return lines.join('\n');
}

export const PLACEHOLDER_D1_ID = '00000000-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Bornes de la section `[[header]]` (ou `[header]`) qui contient `binding = "<binding>"` (ou de la première, sans binding). */
function sectionOf(lines, header, binding) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== header) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*\[/.test(lines[j])) {
        end = j;
        break;
      }
    }
    const body = lines.slice(i + 1, end);
    if (!binding || body.some((l) => new RegExp(`^\\s*binding\\s*=\\s*"${binding}"`).test(l))) return { start: i + 1, end };
  }
  return null;
}

/** Lit l'identifiant de la base D1 `binding` (ou null). */
export function readD1Id(toml, binding = 'VIGIE_DB') {
  const lines = toml.split('\n');
  const section = sectionOf(lines, '[[d1_databases]]', binding);
  if (!section) return null;
  for (let i = section.start; i < section.end; i++) {
    const m = lines[i].match(/^\s*database_id\s*=\s*"([^"]*)"/);
    if (m) return m[1];
  }
  return null;
}

/** Remplace l'identifiant de la base D1 `binding`. */
export function setD1Id(toml, id, binding = 'VIGIE_DB') {
  if (!UUID.test(id)) throw new Error(`Identifiant de base D1 invalide : ${id}`);
  const lines = toml.split('\n');
  const section = sectionOf(lines, '[[d1_databases]]', binding);
  if (!section) throw new Error(`Section [[d1_databases]] avec binding = "${binding}" introuvable dans wrangler.toml.`);
  for (let i = section.start; i < section.end; i++) {
    if (/^\s*database_id\s*=\s*"[^"]*"/.test(lines[i])) {
      lines[i] = lines[i].replace(/"[^"]*"/, `"${id}"`);
      return lines.join('\n');
    }
  }
  throw new Error(`Ligne database_id = "…" introuvable sous le binding ${binding}.`);
}

/** Lit une variable de `[vars]` (ou null). */
export function readVar(toml, key) {
  const lines = toml.split('\n');
  const section = sectionOf(lines, '[vars]');
  if (!section) return null;
  for (let i = section.start; i < section.end; i++) {
    const m = lines[i].match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`));
    if (m) return m[1];
  }
  return null;
}

/** Remplace une variable existante de `[vars]` (valeur sans guillemet ni retour à la ligne). */
export function setVar(toml, key, value) {
  if (!/^[\w.:/@+-]{1,200}$/.test(value)) throw new Error(`Valeur inattendue pour ${key}.`);
  const lines = toml.split('\n');
  const section = sectionOf(lines, '[vars]');
  if (!section) throw new Error('Section [vars] introuvable dans wrangler.toml.');
  for (let i = section.start; i < section.end; i++) {
    if (new RegExp(`^\\s*${key}\\s*=\\s*"[^"]*"`).test(lines[i])) {
      lines[i] = lines[i].replace(/"[^"]*"/, `"${value}"`);
      return lines.join('\n');
    }
  }
  throw new Error(`Variable ${key} introuvable dans [vars].`);
}

/** Trouve la base D1 de Vigie dans `wrangler d1 list --json`. */
export const findD1Database = (list, name = 'vigie') => list.find((db) => db.name === name) ?? null;

/** Jeton porteur du pilote : 32 octets aléatoires, en base64url. Jamais écrit dans le dépôt. */
export const newPilotToken = () => randomBytes(32).toString('base64url');

// ---------------------------------------------------------------------------
// Sorties de wrangler

// eslint-disable-next-line no-control-regex
export const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');

/** Comptes listés par `wrangler whoami` : [{ name, id }]. */
export function parseWhoamiAccounts(output) {
  const accounts = [];
  for (const line of stripAnsi(output).split('\n')) {
    const m = line.match(/^\s*│\s*(.+?)\s*│\s*([0-9a-f]{32})\s*│\s*$/);
    if (m) accounts.push({ name: m[1], id: m[2] });
  }
  return accounts;
}

export const isLoggedOut = (output) => /not authenticated/i.test(stripAnsi(output));

/** Extrait le tableau JSON d'une sortie de wrangler (qui peut contenir une bannière). */
export function parseJsonArray(output) {
  const text = stripAnsi(output);
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('Sortie de wrangler inattendue (pas de JSON).');
  return JSON.parse(text.slice(start, end + 1));
}

/** Trouve l'espace KV de Vigie dans `wrangler kv namespace list`. */
export function findKvNamespace(list, title = 'VIGIE_SNAPSHOT', workerName = 'vigie-api') {
  return list.find((ns) => ns.title === title) ?? list.find((ns) => ns.title === `${workerName}-${title}`) ?? null;
}

// ---------------------------------------------------------------------------
// Cloudflare Access

export const PILOT_SERVICE_TOKEN = 'Vigie pilote';

/**
 * Corps de création (ou de mise à jour) de l'application Access : tout le nom d'hôte, une seule adresse,
 * et, si `serviceTokenId` est donné, le jeton de service du pilote (règle « Service Auth », sans identité).
 */
export function accessAppBody({ host, email, serviceTokenId }) {
  const policies = [
    {
      name: 'Vigie : une seule adresse',
      decision: 'allow',
      include: [{ email: { email } }],
      precedence: 1,
    },
  ];
  if (serviceTokenId) {
    policies.push({
      name: 'Vigie : pilote (jeton de service)',
      decision: 'non_identity',
      include: [{ service_token: { token_id: serviceTokenId } }],
      precedence: 2,
    });
  }
  return {
    name: 'Vigie',
    type: 'self_hosted',
    domain: host,
    session_duration: '24h',
    // Le cookie d'Access n'accompagne pas les requêtes venues d'un autre site (défense contre le CSRF, avec le Worker).
    same_site_cookie_attribute: 'lax',
    app_launcher_visible: false,
    auto_redirect_to_identity: false,
    policies,
  };
}

/** Jeton de service autorisé par l'application existante (règle « Service Auth »), ou null. */
export function appServiceTokenId(app) {
  for (const p of app?.policies ?? []) {
    if (p.decision !== 'non_identity') continue;
    const rule = (p.include ?? []).find((r) => r.service_token?.token_id);
    if (rule) return rule.service_token.token_id;
  }
  return null;
}

/** Adresse autorisée par l'application existante (règle « allow » à une seule adresse), ou null. */
export function appEmail(app) {
  const allow = (app?.policies ?? []).find((p) => p.decision === 'allow');
  return allow?.include?.length === 1 ? (allow.include[0].email?.email ?? null) : null;
}

/** Application Access déjà posée sur ce nom d'hôte (ou null). */
export const findAccessApp = (apps, host) =>
  apps.find((a) => a.domain === host || a.domain === `${host}/` || a.domain === `${host}/*`) ?? null;

/**
 * Vrai si l'application existante a déjà le bon réglage : une règle « allow » pour la seule bonne adresse,
 * et, si `serviceTokenId` est donné, une seule règle « Service Auth » pour ce jeton. Rien d'autre.
 */
export function accessAppUpToDate(app, { host, email, serviceTokenId }) {
  if (!app || app.domain !== host || app.type !== 'self_hosted') return false;
  if (app.same_site_cookie_attribute !== 'lax' && app.same_site_cookie_attribute !== 'strict') return false;
  const policies = app.policies ?? [];
  if (policies.length !== (serviceTokenId ? 2 : 1)) return false;
  const allow = policies.find((p) => p.decision === 'allow');
  const allowOk =
    allow &&
    (allow.include ?? []).length === 1 &&
    allow.include[0].email?.email?.toLowerCase() === email.toLowerCase() &&
    (allow.exclude ?? []).length === 0 &&
    (allow.require ?? []).length === 0;
  if (!allowOk) return false;
  if (!serviceTokenId) return true;
  const service = policies.find((p) => p.decision === 'non_identity');
  return Boolean(
    service &&
      (service.include ?? []).length === 1 &&
      service.include[0].service_token?.token_id === serviceTokenId &&
      (service.exclude ?? []).length === 0 &&
      (service.require ?? []).length === 0,
  );
}

/**
 * Lit la réponse de https://<hôte>/api/projets appelée sans authentification.
 * 'protege' : Access bloque (401/403, ou redirection vers la page de connexion Access).
 * 'ouvert' : l'API répond sans authentification. 'inconnu' : autre réponse.
 */
export function accessVerdict(status, location) {
  if (status === 401 || status === 403) return 'protege';
  if (status >= 300 && status < 400) {
    try {
      const target = new URL(location ?? '');
      if (target.hostname.endsWith('.cloudflareaccess.com') || target.pathname.startsWith('/cdn-cgi/access/')) return 'protege';
    } catch {
      return 'inconnu';
    }
    return 'inconnu';
  }
  if (status >= 200 && status < 300) return 'ouvert';
  return 'inconnu';
}
