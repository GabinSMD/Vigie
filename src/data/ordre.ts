/**
 * Règles de l'ordre `repondre` partagées par le Worker et l'app (docs/specs/en-attente-de-reponse.md § 4).
 * Fonctions pures, sans navigateur.
 */

/** Longueur maximale du texte libre d'une réponse (§ 4.2). */
export const TEXT_MAX = 2000;

/** Avertissement permanent sous chaque champ texte, et message du refus 422 du Worker (§ 7). */
export const SECRET_WARNING = 'Ne colle jamais de clé, de jeton ni de mot de passe ici : pose-le dans un fichier sur penny et écris seulement où.';

const HOUR = 3_600_000;

/** D6 : le pilote passe toutes les heures, de 8 h à 21 h, heure de Paris. */
const FIRST_PASS = 8;
const LAST_PASS = 21;

const PARIS_HOUR = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' });
const parisHour = (date: Date) => Number(PARIS_HOUR.formatToParts(date).find((p) => p.type === 'hour')?.value);

/**
 * Prochain passage du pilote strictement après `from` : une heure pile entre 8 h et 21 h, heure de Paris.
 * Le décalage de Paris est toujours d'un nombre entier d'heures : une heure pile UTC est une heure pile à Paris.
 */
export function nextPilotPass(from: Date): Date {
  let t = Math.floor(from.getTime() / HOUR) * HOUR + HOUR;
  for (let i = 0; i < 48; i++, t += HOUR) {
    const h = parisHour(new Date(t));
    if (h >= FIRST_PASS && h <= LAST_PASS) return new Date(t);
  }
  /* Inatteignable : il y a au moins un passage par jour. */
  return new Date(from.getTime() + 24 * HOUR);
}

/**
 * Expiration d'un ordre `repondre` (D10) : `max(createdAt + 3 h, prochain passage + 1 h)`.
 * Le jour, c'est 3 h ; la nuit, l'ordre attend le passage de 8 h et expire à 9 h.
 */
export function orderExpiresAt(createdAt: Date): Date {
  const threeHours = createdAt.getTime() + 3 * HOUR;
  const afterNextPass = nextPilotPass(createdAt).getTime() + HOUR;
  return new Date(Math.max(threeHours, afterNextPass));
}
