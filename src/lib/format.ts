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
