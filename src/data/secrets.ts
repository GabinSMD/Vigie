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
 * `password=`, `password: x`, `"password" : "x"`, `mot de passe =`, `api_key=`, et les noms composés
 * (`accessToken=`, `dbPassword=`, `"clientSecret":`). Sans guillemet, le `:` doit suivre le mot
 * directement : « le secret : sur penny » (typographie française) passe.
 */
const ASSIGNMENT =
  /(?:password|passwd|pwd|mot\s*de\s*passe|motdepasse|secret|token|api[_-]?key)(?:["']?\s*=|:|["']\s*:)/i;

/**
 * Identifiants dans une adresse : `postgres://user:motdepasse@hôte`. Le schéma est ancré en début
 * de mot : sans cet ancrage, une longue suite de lettres serait relue depuis chaque position (temps quadratique).
 */
const URL_CREDENTIALS = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i;

/** Adresses de webhook qui portent leur jeton en clair. */
const WEBHOOK = /hooks\.slack\.com\/services\/|discord(?:app)?\.com\/api\/webhooks\//i;

/** Chaîne de 32 caractères ou plus mêlant lettres et chiffres (le `-`, le `/` et le `.` la coupent). */
const LONG_TOKEN = /[A-Za-z0-9_+=]{32,}/g;

/**
 * SHA de commit complet : exactement 40 caractères hexadécimaux en minuscules. C'est aussi la forme des
 * anciens jetons GitHub (avant 2021) : un SHA nu reste refusé. Il ne passe que juste après « commit » ou
 * « SHA » (`commit 6298…`, `SHA: 6298…`, `(sha:6298…)`) ou dans une adresse `https://github.com/<owner>/<repo>/commit/`.
 */
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const SHA_CONTEXT = /(?:(?<![A-Za-z0-9_])(?:commit|sha)(?: +|: *)|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/commit\/)$/i;

/** Un SHA de commit annoncé comme tel. Seuls les 200 caractères qui précèdent sont relus (temps linéaire). */
const isAnnouncedSha = (text: string, token: string, index: number) =>
  COMMIT_SHA.test(token) && SHA_CONTEXT.test(text.slice(Math.max(0, index - 200), index));

/**
 * Base64 et base64url : 32 caractères ou plus dans `[A-Za-z0-9+/=_-]`, avec majuscules, minuscules
 * et chiffres. Les identifiants `1039-critere-reprise-…` et les chemins `docs/specs/…` n'ont pas
 * de majuscules ; les adresses GitHub de forme attendue sont allégées avant ce test (`githubShapes`).
 */
const BASE64 = /[A-Za-z0-9+/=_-]{32,}/g;

const GITHUB_URL = /https:\/\/github\.com\/[^\s<>()"'\]]*/g;
/**
 * `owner/repo`, suivi au plus de `/pull/<n>`, `/issues/<n>`, `/commit/<SHA>` (7 à 40 caractères
 * hexadécimaux en minuscules) ou `/blob|tree/<branche>/<chemin>`.
 */
const GITHUB_SHAPE =
  /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\/(?:pull|issues)\/\d+|\/commit\/[0-9a-f]{7,40}|\/(?:blob|tree)\/[\w.-]+(\/.*)?)?\/?$/;

/**
 * Retire d'une adresse GitHub ce qui est sûr (le dépôt, le numéro, la branche) et garde le chemin
 * d'un fichier, qui reste testé. Une adresse d'une autre forme est laissée telle quelle.
 */
function githubShapes(text: string): string {
  return text.replace(GITHUB_URL, (url) => {
    let end = url.length;
    while (end > 0 && '.,;:!?'.includes(url[end - 1])) end--; // Ponctuation de fin de phrase.
    const trimmed = url.slice(0, end);
    const m = GITHUB_SHAPE.exec(trimmed);
    return m ? ` ${m[1] ?? ''} ` : url;
  });
}

const mixes = (token: string, ...classes: RegExp[]) => classes.every((c) => c.test(token));

export function looksLikeSecret(input: string): boolean {
  // NFKC : les lettres pleine chasse (« ｇｈｐ＿ ») redeviennent des lettres ordinaires.
  const text = input.normalize('NFKC');
  if ([KNOWN_PREFIX, PRIVATE_KEY, ASSIGNMENT, URL_CREDENTIALS, WEBHOOK].some((r) => r.test(text))) return true;
  for (const { 0: token, index } of text.matchAll(LONG_TOKEN)) {
    if (mixes(token, /[A-Za-z]/, /[0-9]/) && !isAnnouncedSha(text, token, index)) return true;
  }
  for (const [token] of githubShapes(text).matchAll(BASE64)) {
    if (mixes(token, /[A-Z]/, /[a-z]/, /[0-9]/)) return true;
  }
  return false;
}
