/**
 * Filtre « ressemble à un secret » (docs/specs/en-attente-de-reponse.md § 7).
 * Fonction pure, sans navigateur : utilisée par l'analyseur des blocs `decision`,
 * puis par le Worker et le pilote pour le texte des réponses (lot 4).
 *
 * C'est un garde-fou, pas une garantie : la règle (« un secret se pose dans un fichier
 * sur penny, la réponse dit seulement où ») reste la vraie protection.
 */

/** Préfixes connus, en début de mot pour ne pas prendre « risk-free » pour une clé `sk-`. */
const KNOWN_PREFIX = /(?<![A-Za-z0-9])(?:ghp_|github_pat_|gho_|sk-|sk_live_|xox|AKIA)/;

const PRIVATE_KEY = /-----BEGIN/;

/** `password=`, `motdepasse=`, `token=`, avec ou sans espaces autour du `=`. */
const ASSIGNMENT = /(?:password|motdepasse|token)\s*=/i;

/**
 * Chaîne de 32 caractères ou plus mêlant lettres et chiffres. Les tirets, points, barres obliques
 * et deux-points coupent la chaîne : un identifiant `1039-critere-reprise-…` ou une adresse GitHub
 * n'est pas pris pour une clé.
 */
const LONG_TOKEN = /[A-Za-z0-9_+=]{32,}/g;

export function looksLikeSecret(text: string): boolean {
  if (KNOWN_PREFIX.test(text) || PRIVATE_KEY.test(text) || ASSIGNMENT.test(text)) return true;
  for (const [token] of text.matchAll(LONG_TOKEN)) {
    if (/[A-Za-z]/.test(token) && /[0-9]/.test(token)) return true;
  }
  return false;
}
