#!/usr/bin/env node
// Mise en route de Vigie : GitHub App, Cloudflare (KV, secrets, Access) et déploiement.
// Lance-le depuis ton Mac, à la racine du dépôt : `npm run mise-en-route`.
// Options : --dry-run (n'exécute rien qui modifie, affiche les actions prévues), --from <étape>.
// Guide : docs/mise-en-route.md

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  STEPS,
  PLACEHOLDER_KV_ID,
  accessAppBody,
  accessAppUpToDate,
  accessVerdict,
  appJwt,
  buildManifest,
  checkDomain,
  compareRepos,
  defaultZone,
  findAccessApp,
  findKvNamespace,
  installationSettingsUrl,
  installationsSecret,
  isEmail,
  isLoggedOut,
  manifestPage,
  matchInstallations,
  newState,
  parseArgs,
  parseJsonArray,
  parseWhoamiAccounts,
  readDomain,
  readKvId,
  sameState,
  setDomain,
  setKvId,
  toPkcs8,
} from './mise-en-route/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'worker');
const TOML = join(WORKER, 'wrangler.toml');
const SETUP = join(ROOT, '.vigie-setup');
const STATE_FILE = join(SETUP, 'etat.json');
const PEM_PKCS1 = join(SETUP, 'github-app.pem');
const PEM_PKCS8 = join(SETUP, 'github-app-pkcs8.pem');
const WORKER_NAME = 'vigie-api';
const GH = 'https://api.github.com';
const CF = 'https://api.cloudflare.com/client/v4';

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

class Stop extends Error {}

// ---------------------------------------------------------------------------
// Options et état local

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  fail(error.message);
  process.exit(2);
}

if (options.help) {
  say(`Usage : npm run mise-en-route -- [--dry-run] [--from <étape>]

Étapes :
${STEPS.map((s, i) => `  ${String(i + 1).padStart(2)}. ${s.id.padEnd(14)} ${s.titre}`).join('\n')}

--dry-run       n'exécute rien qui modifie quoi que ce soit (ni réseau, ni fichier) ; affiche chaque action prévue.
--from <étape>  reprend à cette étape (nom ou numéro), même si elle est notée comme faite.`);
  process.exit(0);
}

const DRY = options.dryRun;

/** Action qui modifie quelque chose : en --dry-run, elle est seulement affichée. */
async function act(description, fn) {
  if (DRY) {
    say(`  ${dim('[simulation]')} ${description}`);
    return undefined;
  }
  say(`  → ${description}`);
  return fn();
}

async function loadState() {
  if (!existsSync(STATE_FILE)) return { done: [] };
  return JSON.parse(await readFile(STATE_FILE, 'utf8'));
}

/** Écrit un fichier de .vigie-setup/ avec les droits 0600 (dossier en 0700). */
async function writePrivate(path, content) {
  await mkdir(SETUP, { recursive: true, mode: 0o700 });
  await chmod(SETUP, 0o700);
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function saveState(state) {
  if (DRY) return;
  await writePrivate(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Saisie

const interactive = Boolean(process.stdin.isTTY);
let rl = null;
const readline = () => (rl ??= createInterface({ input: process.stdin, output: process.stdout }));

async function ask(question, fallback = '') {
  if (!interactive && DRY) return fallback;
  const suffix = fallback ? ` ${dim(`[${fallback}]`)}` : '';
  const answer = (await readline().question(`${question}${suffix} `)).trim();
  return answer || fallback;
}

const pause = (message = 'Appuie sur Entrée pour continuer.') => (DRY ? Promise.resolve() : ask(message));

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
// Commandes externes

/**
 * Lance une commande. `input` est passé par l'entrée standard (jamais en argument).
 * `capture` : renvoie la sortie au lieu de l'afficher.
 */
function run(cmd, args, { cwd = ROOT, input, capture = false, env = {}, allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', ...env },
      stdio: [input === undefined ? (capture ? 'ignore' : 'inherit') : 'pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
    });
    let out = '';
    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (out += d));
    if (input !== undefined) child.stdin.end(input);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !allowFail) reject(new Stop(`${cmd} ${args.slice(0, 3).join(' ')} a échoué (code ${code}).${capture ? `\n${out}` : ''}`));
      else resolve({ code, out });
    });
  });
}

const wrangler = (args, opts = {}) => run('npx', ['--no-install', 'wrangler', ...args], { cwd: WORKER, ...opts });

function openBrowser(url) {
  say(`  Ouvre : ${bold(url)}`);
  if (DRY) return;
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => warn('Impossible d\'ouvrir le navigateur : copie l\'adresse ci-dessus.'));
  child.unref();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// GitHub

async function github(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${GH}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'vigie-mise-en-route',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const shown = path.split('?')[0].replace(/app-manifests\/[^/]+/, 'app-manifests/<code>');
    throw new Stop(`GitHub ${method} ${shown} : erreur ${response.status}.`);
  }
  return response.json();
}

async function githubPages(path, key, token) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await github(`${path}${sep}per_page=100&page=${page}`, { token });
    const items = key ? data[key] : data;
    all.push(...items);
    if (items.length < 100) break;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Cloudflare (API, jeton Access)

let cfToken = null; // en mémoire seulement : jamais écrit sur disque, jamais affiché

async function cloudflare(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${CF}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const detail = (data.errors ?? []).map((e) => `${e.code} ${e.message}`).join(' ; ');
    throw new Stop(`Cloudflare ${method} ${path} : erreur ${response.status}${detail ? ` (${detail})` : ''}.`);
  }
  return data.result;
}

// ---------------------------------------------------------------------------
// Étapes

const config = JSON.parse(await readFile(join(ROOT, 'config', 'projets.json'), 'utf8'));

async function stepQuestions(state) {
  if (state.host && state.zone && state.email && !options.from) {
    ok(`Déjà renseigné : ${state.host} (zone ${state.zone}), accès réservé à ${state.email}.`);
    return;
  }
  const fromToml = readDomain(await readFile(TOML, 'utf8'));
  const known = fromToml && fromToml.host !== 'vigie.example.org' ? fromToml : null;
  for (;;) {
    const host = (await ask('Adresse de Vigie (ex. vigie.mondomaine.fr) :', state.host ?? known?.host ?? (DRY ? 'vigie.example.org' : ''))).toLowerCase();
    const zone = (await ask('Zone Cloudflare (ton domaine) :', state.zone ?? known?.zone ?? defaultZone(host))).toLowerCase();
    const error = checkDomain(host, zone);
    if (error) {
      fail(error);
      if (DRY && !interactive) throw new Stop(error);
      continue;
    }
    state.host = host;
    state.zone = zone;
    break;
  }
  for (;;) {
    const email = await ask('Seule adresse e-mail autorisée par Cloudflare Access :', state.email ?? (DRY ? 'toi@example.org' : ''));
    if (isEmail(email)) {
      state.email = email;
      break;
    }
    fail(`« ${email} » n'est pas une adresse e-mail.`);
    if (DRY && !interactive) throw new Stop('Adresse e-mail invalide.');
  }
  ok(`Vigie sera sur https://${state.host}, accessible à ${state.email} seulement.`);
}

/** Flux « App manifest » : serveur local, page qui poste le manifeste, récupération du code. */
async function stepGithubApp(state) {
  if (state.appId && existsSync(PEM_PKCS1) && !options.from) {
    ok(`GitHub App déjà créée : ${state.appSlug} (id ${state.appId}).`);
    return;
  }
  if (state.appId && !existsSync(PEM_PKCS1) && !existsSync(PEM_PKCS8)) {
    warn(`L'App ${state.appSlug} existe déjà, mais sa clé privée n'est plus sur le disque.`);
    say(`  Génère une nouvelle clé : https://github.com/settings/apps/${state.appSlug} → Private keys → Generate a private key.`);
    say(`  Puis copie le fichier téléchargé ici : ${PEM_PKCS1}`);
    if (DRY) return;
    await pause('Appuie sur Entrée quand le fichier est en place.');
    if (!existsSync(PEM_PKCS1)) throw new Stop(`Fichier introuvable : ${PEM_PKCS1}`);
    await chmod(PEM_PKCS1, 0o600);
    return;
  }

  const homepage = 'https://github.com/GabinSMD/Vigie';
  if (DRY) {
    const manifest = buildManifest({ homepage, redirectUrl: 'http://127.0.0.1:<port>/callback' });
    say(`  ${dim('[simulation]')} serveur local sur 127.0.0.1, page qui poste ce manifeste à https://github.com/settings/apps/new :`);
    say(dim(JSON.stringify(manifest, null, 2).replace(/^/gm, '    ')));
    say(`  ${dim('[simulation]')} attente de la redirection (?code=…&state=…), vérification du state`);
    say(`  ${dim('[simulation]')} POST ${GH}/app-manifests/<code>/conversions → id, slug, clé privée (${PEM_PKCS1}, droits 0600)`);
    return;
  }

  const expected = newState();
  let resolveCode;
  let rejectCode;
  const codePromise = new Promise((res, rej) => ((resolveCode = res), (rejectCode = rej)));
  let manifest;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(manifestPage(manifest, expected));
      return;
    }
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      if (!sameState(expected, url.searchParams.get('state')) || !code || !/^[\w-]+$/.test(code)) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Requête refusée : state invalide.');
        rejectCode(new Stop('Redirection GitHub refusée : le paramètre state ne correspond pas (tentative de falsification ?).'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><p style="font-family:system-ui">C\'est bon : la GitHub App est créée. Retourne dans le terminal.</p>');
      resolveCode(code);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();
  manifest = buildManifest({ homepage, redirectUrl: `http://127.0.0.1:${port}/callback` });

  say('  Ton navigateur va s\'ouvrir sur GitHub. Vérifie le nom (« Vigie », ou un autre s\'il est pris), puis clique sur « Create GitHub App ».');
  openBrowser(`http://127.0.0.1:${port}/`);
  let code;
  try {
    code = await codePromise;
  } finally {
    server.close();
  }
  const app = await github(`/app-manifests/${code}/conversions`, { method: 'POST' });
  await writePrivate(PEM_PKCS1, app.pem);
  state.appId = app.id;
  state.appSlug = app.slug;
  // client_secret et webhook_secret ne servent pas : ils ne sont gardés nulle part.
  ok(`GitHub App créée : ${app.slug} (id ${app.id}). Clé privée dans ${PEM_PKCS1} (droits 0600).`);
}

async function stepKey(state) {
  if (existsSync(PEM_PKCS8) && !options.from) {
    ok('Clé PKCS#8 déjà prête.');
    return;
  }
  if (DRY) {
    say(`  ${dim('[simulation]')} conversion PKCS#1 → PKCS#8 avec node:crypto → ${PEM_PKCS8} (droits 0600)`);
    return;
  }
  if (!existsSync(PEM_PKCS1)) throw new Stop(`Clé introuvable : ${PEM_PKCS1}. Reprends avec --from github-app.`);
  await writePrivate(PEM_PKCS8, toPkcs8(await readFile(PEM_PKCS1, 'utf8')));
  ok(`Clé convertie en PKCS#8 (app ${state.appSlug}).`);
}

async function appToken(state) {
  const pem = await readFile(existsSync(PEM_PKCS8) ? PEM_PKCS8 : PEM_PKCS1, 'utf8');
  return appJwt(state.appId, pem, Math.floor(Date.now() / 1000));
}

async function stepInstallations(state) {
  if (state.installations && !options.from) {
    ok(`Installations déjà vérifiées : ${state.installations}`);
    return;
  }
  if (DRY) {
    say(`  ${dim('[simulation]')} ouvrir https://github.com/apps/<slug>/installations/new`);
    say(`  ${dim('[simulation]')} attendre les installations sur ${config.comptes.join(', ')} (GET ${GH}/app/installations, JWT de l'App)`);
    say(`  ${dim('[simulation]')} pour chaque installation : GET ${GH}/installation/repositories et comparaison avec config/projets.json`);
    return;
  }
  say('  Installe l\'App sur chacun des trois comptes, avec « Only select repositories » et seulement ces dépôts :');
  for (const compte of config.comptes) {
    const repos = config.projets.filter((p) => p.owner === compte).map((p) => p.repo);
    say(`    ${bold(compte)} : ${repos.join(', ')}`);
  }
  say('  Pour une organisation, un propriétaire doit approuver l\'installation.');
  openBrowser(`https://github.com/apps/${state.appSlug}/installations/new`);

  let found;
  for (let attempt = 0; ; attempt++) {
    const installations = await githubPages('/app/installations', null, await appToken(state));
    const match = matchInstallations(config, installations);
    if (match.missing.length === 0) {
      found = match.found;
      break;
    }
    if (attempt % 6 === 0) say(`  En attente de : ${match.missing.join(', ')}… ${dim('(vérification toutes les 5 s, Ctrl+C pour arrêter)')}`);
    await sleep(5000);
  }
  ok(`App installée sur ${config.comptes.join(', ')}.`);

  for (;;) {
    const reposByAccount = {};
    const jwt = await appToken(state);
    for (const compte of config.comptes) {
      const { token } = await github(`/app/installations/${found[compte].id}/access_tokens`, { method: 'POST', token: jwt });
      const repos = await githubPages('/installation/repositories', 'repositories', token);
      reposByAccount[compte] = repos.map((r) => r.full_name);
    }
    const problems = compareRepos(config, reposByAccount);
    if (problems.length === 0) break;
    for (const p of problems) {
      fail(`${p.compte} : les dépôts accessibles ne correspondent pas à config/projets.json.`);
      if (p.manquants.length) say(`    à ajouter : ${p.manquants.join(', ')}`);
      if (p.enTrop.length) say(`    à retirer : ${p.enTrop.join(', ')}`);
      say(`    Réglage : ${installationSettingsUrl(found[p.compte])} (« Only select repositories »)`);
    }
    await pause('Corrige, puis appuie sur Entrée pour vérifier de nouveau.');
  }
  state.installations = installationsSecret(config, found);
  ok(`Dépôts conformes à config/projets.json. GITHUB_INSTALLATIONS = ${state.installations}`);
}

async function stepCloudflare(state) {
  if (!existsSync(join(WORKER, 'node_modules', 'wrangler'))) {
    await act('npm ci dans worker/ (installe wrangler)', () => run('npm', ['ci'], { cwd: WORKER }));
  }
  if (DRY) {
    say(`  ${dim('[simulation]')} npx wrangler whoami (sinon npx wrangler login)`);
    say(`  ${dim('[simulation]')} npx wrangler kv namespace list, puis kv namespace create VIGIE_SNAPSHOT s'il n'existe pas`);
  } else {
    let who = await wrangler(['whoami'], { capture: true, allowFail: true });
    if (who.code !== 0 || isLoggedOut(who.out)) {
      say('  Connexion à Cloudflare : ton navigateur va s\'ouvrir.');
      await wrangler(['login']);
      who = await wrangler(['whoami'], { capture: true });
    }
    const accounts = parseWhoamiAccounts(who.out);
    if (process.env.CLOUDFLARE_ACCOUNT_ID) state.accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    else if (!state.accountId || !accounts.some((a) => a.id === state.accountId)) {
      if (accounts.length === 1) state.accountId = accounts[0].id;
      else if (accounts.length > 1) {
        accounts.forEach((a, i) => say(`    ${i + 1}. ${a.name}`));
        const n = Number(await ask('Quel compte Cloudflare porte ta zone ? (numéro)'));
        if (!accounts[n - 1]) throw new Stop('Choix invalide.');
        state.accountId = accounts[n - 1].id;
      } else throw new Stop('Aucun compte Cloudflare trouvé dans `wrangler whoami`.');
    }
    ok(`Connecté à Cloudflare (compte ${accounts.find((a) => a.id === state.accountId)?.name ?? state.accountId}).`);
  }

  const env = state.accountId ? { CLOUDFLARE_ACCOUNT_ID: state.accountId } : {};
  let kvId = state.kvId;
  if (!DRY) {
    const list = parseJsonArray((await wrangler(['kv', 'namespace', 'list'], { capture: true, env })).out);
    kvId = findKvNamespace(list, 'VIGIE_SNAPSHOT', WORKER_NAME)?.id;
    if (kvId) ok(`Espace KV VIGIE_SNAPSHOT déjà là (${kvId}).`);
    else {
      await act('npx wrangler kv namespace create VIGIE_SNAPSHOT', () => wrangler(['kv', 'namespace', 'create', 'VIGIE_SNAPSHOT'], { env }));
      const again = parseJsonArray((await wrangler(['kv', 'namespace', 'list'], { capture: true, env })).out);
      kvId = findKvNamespace(again, 'VIGIE_SNAPSHOT', WORKER_NAME)?.id;
      if (!kvId) throw new Stop('Espace KV créé mais introuvable dans la liste.');
      ok(`Espace KV VIGIE_SNAPSHOT créé (${kvId}).`);
    }
    state.kvId = kvId;
  }

  const toml = await readFile(TOML, 'utf8');
  let next = toml;
  if (kvId && readKvId(next) !== kvId) next = setKvId(next, kvId);
  const domain = readDomain(next);
  if (!domain || domain.host !== state.host || domain.zone !== state.zone) next = setDomain(next, state.host, state.zone);
  if (DRY) say(`  ${dim('[simulation]')} worker/wrangler.toml : id du KV (trouvé ou créé) et domaine ${state.host} (zone ${state.zone}), modification ciblée`);
  else if (next === toml) ok('worker/wrangler.toml déjà à jour.');
  else await act(`worker/wrangler.toml : id du KV et domaine ${state.host} (zone ${state.zone})`, () => writeFile(TOML, next));
}

async function stepAccess(state) {
  if (state.accessDone && !options.from) {
    ok(`Cloudflare Access déjà en place sur ${state.host}.`);
    return;
  }
  const body = accessAppBody({ host: state.host, email: state.email });
  if (DRY) {
    say(`  ${dim('[simulation]')} demander un jeton API Cloudflare (saisie masquée, gardé en mémoire seulement)`);
    say(`  ${dim('[simulation]')} GET ${CF}/accounts/<compte>/access/apps, puis POST (création) ou PUT (mise à jour) avec :`);
    say(dim(JSON.stringify(body, null, 2).replace(/^/gm, '    ')));
    return;
  }
  say('  Il faut un jeton API Cloudflare avec le droit « Access: Apps and Policies : Edit » sur ton compte');
  say('  (Mon profil → Jetons API → Créer un jeton → Personnalisé ; durée courte ; à révoquer après). Voir docs/mise-en-route.md.');
  openBrowser('https://dash.cloudflare.com/profile/api-tokens');
  cfToken = await askHidden('Colle le jeton (il ne s\'affiche pas) :');
  if (!cfToken) throw new Stop('Aucun jeton saisi.');

  const apps = await cloudflare(`/accounts/${state.accountId}/access/apps`);
  const existing = findAccessApp(apps ?? [], state.host);
  if (existing && accessAppUpToDate(existing, state)) ok(`Application Access « ${existing.name} » déjà conforme.`);
  else if (existing)
    await act(`mise à jour de l'application Access « ${existing.name} » sur ${state.host}`, () =>
      cloudflare(`/accounts/${state.accountId}/access/apps/${existing.id}`, { method: 'PUT', body }),
    );
  else await act(`création de l'application Access sur ${state.host}`, () => cloudflare(`/accounts/${state.accountId}/access/apps`, { method: 'POST', body }));
  cfToken = null;
  state.accessDone = true;
  ok(`Access protège tout ${state.host} : seule ${state.email} peut entrer.`);
}

async function stepDeploy(state) {
  if (!state.accessDone && !DRY) throw new Stop('Access n\'est pas en place : déploiement refusé. Reprends avec --from access.');
  if (state.deployed && !options.from) {
    ok('Worker déjà déployé.');
    return;
  }
  if (!existsSync(join(ROOT, 'node_modules'))) await act('npm ci à la racine', () => run('npm', ['ci']));
  await act('npm run build avec VITE_API_URL=/ (API sur la même origine)', () => run('npm', ['run', 'build'], { env: { VITE_API_URL: '/' } }));
  const env = state.accountId ? { CLOUDFLARE_ACCOUNT_ID: state.accountId } : {};
  await act(`npx wrangler deploy (app + API sur https://${state.host})`, () => wrangler(['deploy'], { env }));
  if (!DRY) state.deployed = true;
}

async function stepSecrets(state) {
  const env = state.accountId ? { CLOUDFLARE_ACCOUNT_ID: state.accountId } : {};
  let present = [];
  if (!DRY) {
    const list = await wrangler(['secret', 'list', '--format', 'json'], { capture: true, env, allowFail: true });
    if (list.code === 0) present = parseJsonArray(list.out).map((s) => s.name);
  }
  const values = {
    GITHUB_APP_ID: async () => String(state.appId),
    GITHUB_APP_PRIVATE_KEY: async () => readFile(PEM_PKCS8, 'utf8'),
    GITHUB_INSTALLATIONS: async () => state.installations,
  };
  for (const [name, value] of Object.entries(values)) {
    if (present.includes(name) && options.from !== 'secrets') {
      ok(`Secret ${name} déjà posé (reprends avec --from secrets pour le remplacer).`);
      continue;
    }
    await act(`npx wrangler secret put ${name} (valeur passée par l'entrée standard)`, async () => {
      const v = await value();
      if (!v || v === 'undefined') throw new Stop(`Valeur manquante pour ${name} : reprends l'étape qui la produit.`);
      await wrangler(['secret', 'put', name], { input: v, env });
    });
  }
}

async function stepVerify(state) {
  const url = `https://${state.host}/api/projets`;
  if (DRY) {
    say(`  ${dim('[simulation]')} GET ${url} sans authentification : attendu 401/403 ou redirection vers *.cloudflareaccess.com`);
    return;
  }
  let response;
  for (let attempt = 1; ; attempt++) {
    try {
      response = await fetch(url, { redirect: 'manual' });
      break;
    } catch {
      if (attempt >= 12) throw new Stop(`${url} injoignable. Le domaine met parfois quelques minutes à répondre : relance avec --from verification.`);
      if (attempt === 1) say('  Le domaine n\'est pas encore joignable, nouvel essai toutes les 10 s…');
      await sleep(10_000);
    }
  }
  const verdict = accessVerdict(response.status, response.headers.get('location'));
  if (verdict !== 'protege') {
    fail(`DANGER : ${url} répond ${response.status} sans authentification. Cloudflare Access ne protège pas Vigie.`);
    fail(`Coupe l'accès tout de suite : cd worker && npx wrangler delete (ou retire le domaine du Worker dans Cloudflare),`);
    fail('vérifie l\'application Access (Zero Trust → Access → Applications), puis relance avec --from access.');
    throw new Stop('Vérification échouée.');
  }
  ok(`Access bloque bien les visiteurs non connectés (${response.status}).`);
}

async function stepCleanup(state) {
  if (existsSync(PEM_PKCS8) && interactive && !DRY) {
    say('  Si tu veux garder la clé privée, range-la dans ton gestionnaire de mots de passe.');
    say('  (Sinon, tu pourras en générer une nouvelle sur la page de l\'App, à tout moment.)');
    const answer = await ask('Tape « afficher » pour l\'afficher une seule fois, ou Entrée pour passer :');
    if (answer === 'afficher') {
      say(await readFile(PEM_PKCS8, 'utf8'));
      await pause('Appuie sur Entrée une fois la clé rangée : l\'écran sera effacé.');
      process.stdout.write('\u001b[2J\u001b[3J\u001b[H');
    }
  }
  await act(`suppression de ${SETUP} (clés .pem et état local)`, () => rm(SETUP, { recursive: true, force: true }));
  say();
  say(bold(DRY ? 'Fin de la simulation. Voici ce qui s\'affichera à la fin de la vraie mise en route :' : 'C\'est en place.'));
  say(`  • Ouvre https://${state.host ?? 'vigie.<domaine>'} : Access te demande ton adresse, puis Vigie affiche tes 8 projets.`);
  say('  • Révoque le jeton API Cloudflare créé pour Access (Mon profil → Jetons API).');
  say('  • Reste à faire : le pilote doit écrire l\'instantané des sessions dans la clé KV « snapshot »');
  say('    (format : docs/instantane-sessions.md). En attendant, l\'app dit « Le pilote n\'a pas encore écrit d\'instantané ».');
}

const RUNNERS = {
  questions: stepQuestions,
  'github-app': stepGithubApp,
  cle: stepKey,
  installations: stepInstallations,
  cloudflare: stepCloudflare,
  access: stepAccess,
  deploiement: stepDeploy,
  secrets: stepSecrets,
  verification: stepVerify,
  nettoyage: stepCleanup,
};

// ---------------------------------------------------------------------------

async function main() {
  const fresh = !existsSync(STATE_FILE);
  const state = await loadState();
  state.done ??= [];
  if (fresh && !options.from && readKvId(await readFile(TOML, 'utf8')) !== PLACEHOLDER_KV_ID) {
    warn('worker/wrangler.toml est déjà configuré : Vigie semble déjà en place, et l\'état local a été supprimé.');
    warn('Tout reprendre créerait une deuxième GitHub App. Pour refaire une seule étape, utilise --from <étape> (voir --help).');
    if (!DRY && (await ask('Tape « continuer » pour tout reprendre quand même :')) !== 'continuer') throw new Stop('Arrêté, rien n\'a été modifié.');
  }
  const fromIndex = options.from ? STEPS.findIndex((s) => s.id === options.from) : 0;
  if (options.from) state.done = state.done.filter((id) => STEPS.findIndex((s) => s.id === id) < fromIndex);

  say(bold(`Mise en route de Vigie${DRY ? ' — simulation (--dry-run) : rien n\'est modifié' : ''}`));
  if (!DRY) say(dim(`État local : ${SETUP} (droits 0600, supprimé à la fin).`));

  for (const [i, step] of STEPS.entries()) {
    if (i < fromIndex) continue;
    say();
    say(bold(`${i + 1}/${STEPS.length}. ${step.titre}`));
    if (state.done.includes(step.id) && step.id !== 'verification' && step.id !== 'nettoyage') {
      ok('Déjà fait.');
      continue;
    }
    await RUNNERS[step.id](state);
    if (step.id === 'nettoyage') break;
    if (!state.done.includes(step.id)) state.done.push(step.id);
    await saveState(state);
  }
}

try {
  await main();
} catch (error) {
  say();
  if (error instanceof Stop) fail(error.message);
  else fail(`Erreur inattendue : ${error?.message ?? error}`);
  say(dim('Corrige, puis relance `npm run mise-en-route` : les étapes déjà faites sont sautées (ou --from <étape>).'));
  process.exitCode = 1;
} finally {
  rl?.close();
}
