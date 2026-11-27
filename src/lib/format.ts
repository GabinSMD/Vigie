const dollars = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 6.35 → « 6,35 $ » (espace insécable avant le symbole). */
export const formatCost = (amount: number) => `${dollars.format(amount)} $`;

/** Plafond sans décimales inutiles : 12 → « 12 $ », 4.5 → « 4,50 $ ». */
export const formatCap = (amount: number) =>
  Number.isInteger(amount) ? `${amount} $` : formatCost(amount);

export type GaugeLevel = 'normal' | 'alerte' | 'plafond';

export function gauge(cost: number, cap: number, threshold: number) {
  const pct = cap > 0 ? Math.min(100, Math.round((100 * cost) / cap)) : 100;
  const level: GaugeLevel = pct >= 100 ? 'plafond' : pct >= threshold ? 'alerte' : 'normal';
  return { pct, level };
}

/** « 1 élément », « 3 éléments ». */
export const plural = (n: number, singular: string, pluralForm = `${singular}s`) =>
  `${n} ${n > 1 ? pluralForm : singular}`;

/** « il y a 12 min », « il y a 1 h 05 », « il y a 3 jours » à partir d'une date ISO. */
export function relativeFr(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `il y a ${hours} h` : `il y a ${hours} h ${String(rest).padStart(2, '0')}`;
  }
  const days = Math.floor(hours / 24);
  return `il y a ${plural(days, 'jour')}`;
}

/** « 14 h 02 », heure de Paris, pour l'état « Données de 14 h 02 ». */
export function clockFr(iso: string): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('hour')} h ${get('minute')}`;
}

function parisParts(iso: string) {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: get('day'), month: get('month'), hour: Number(get('hour')), minute: get('minute') };
}

/** « 26/11 à 14 h 05 », heure de Paris. */
export function dateTimeFr(iso: string): string {
  const { day, month } = parisParts(iso);
  return `${day}/${month} à ${clockFr(iso)}`;
}

/**
 * Prochain passage du pilote après `iso` (D6 : toutes les heures, de 8 h à 21 h, heure de Paris) :
 * « vers 15 h », « demain vers 8 h » ou « vers 8 h » avant l'ouverture.
 */
export function nextPilotPassFr(iso: string): string {
  const { hour } = parisParts(iso);
  if (hour < 8) return 'vers 8 h';
  if (hour >= 21) return 'demain vers 8 h';
  return `vers ${hour + 1} h`;
}
