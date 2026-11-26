/**
 * Filtre « ressemble à un secret » (docs/specs/en-attente-de-reponse.md § 7).
 * Fonction pure, sans navigateur : utilisée par l'analyseur des blocs `decision`,
 * puis par le Worker et le pilote pour le texte des réponses (lot 4).
 * Toutes les expressions sont sans quantificateurs imbriqués (temps linéaire).
 *
 * C'est un garde-fou, pas une garantie : la règle (« un secret se pose dans un fichier
 * sur penny, la réponse dit seulement où ») reste la vraie protection.
 */

/** Préfixes connus, en début de mot pour ne pas prendre « risk-free » pour une clé `sk-`. */
const KNOWN_PREFIX =
  /(?<![A-Za-z0-9])(?:gh[pousr]_|github_pat_|glpat-|sk-|sk_live_|xox|AIza|(?:AKIA|ASIA)[0-9A-Z]{16})/;

const PRIVATE_KEY = /-----BEGIN/;

/**
 * `password=`, `password: x`, `"password": "x"`, `mot de passe =`, `api_key=`…
 * Le `:` doit suivre le mot directement : « le secret : sur penny » (typographie française) passe.
 */
const ASSIGNMENT =
  /(?<![A-Za-z])(?:password|passwd|pwd|mot\s*de\s*passe|motdepasse|secret|token|api[_-]?key)(?:["']?\s*=|["']?:)/i;

/** Identifiants dans une adresse : `postgres://user:motdepasse@hôte`. */
const URL_CREDENTIALS = /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i;

/** Adresses de webhook qui portent leur jeton en clair. */
const WEBHOOK = /hooks\.slack\.com\/services\/|discord(?:app)?\.com\/api\/webhooks\//i;

/** Chaîne de 32 caractères ou plus mêlant lettres et chiffres (le `-`, le `/` et le `.` la coupent). */
const LONG_TOKEN = /[A-Za-z0-9_+=]{32,}/g;

/**
 * Base64 et base64url : 32 caractères ou plus dans `[A-Za-z0-9+/=_-]`, avec majuscules, minuscules
 * et chiffres. Les identifiants `1039-critere-reprise-…` et les chemins `docs/specs/…` n'ont pas
 * de majuscules ; les adresses GitHub sont retirées avant ce test.
 */
const BASE64 = /[A-Za-z0-9+/=_-]{32,}/g;
const GITHUB_URL = /https:\/\/github\.com\/[A-Za-z0-9_./-]*/g;

const mixes = (token: string, ...classes: RegExp[]) => classes.every((c) => c.test(token));

export function looksLikeSecret(input: string): boolean {
  // NFKC : les lettres pleine chasse (« ｇｈｐ＿ ») redeviennent des lettres ordinaires.
  const text = input.normalize('NFKC');
  if ([KNOWN_PREFIX, PRIVATE_KEY, ASSIGNMENT, URL_CREDENTIALS, WEBHOOK].some((r) => r.test(text))) return true;
  for (const [token] of text.matchAll(LONG_TOKEN)) {
    if (mixes(token, /[A-Za-z]/, /[0-9]/)) return true;
  }
  for (const [token] of text.replace(GITHUB_URL, ' ').matchAll(BASE64)) {
    if (mixes(token, /[A-Z]/, /[a-z]/, /[0-9]/)) return true;
  }
  return false;
}
