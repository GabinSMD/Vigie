import type { Decision, DecisionAnswer, DecisionOption, DecisionTopic } from './api';
import type { ActionItem } from './types';

/**
 * État affiché d'une décision (docs/specs/en-attente-de-reponse.md § 3.3), à partir de l'ordre
 * connu du Worker (`decision.answer`) et de la réponse donnée dans cette visite (store local).
 * Tant que le lot 4 n'est pas livré, une réponse donnée dans Vigie reste locale.
 */

export type DecisionItem = Extract<ActionItem, { kind: 'decision' }>;

export const isDecision = (item: ActionItem): item is DecisionItem => item.kind === 'decision';

/** Réponse donnée dans Vigie pendant la visite. */
export interface LocalAnswer {
  optionId: string;
  text?: string;
  /** ISO 8601 UTC. */
  at: string;
}

export type DecisionPhase = 'attente' | 'envoyee' | 'repondu' | 'expiree' | 'refusee';

export interface DecisionView {
  phase: DecisionPhase;
  /** Réponse affichée (choix, texte, dates) ; absente en attente. */
  answer?: Pick<DecisionAnswer, 'optionId' | 'text' | 'createdAt' | 'doneAt' | 'result' | 'reason'>;
  /** Envoyée et pas encore prise par le pilote : « Modifier » est possible. */
  editable: boolean;
}

export const decisionItemId = (d: Pick<Decision, 'projectId' | 'id'>) => `dec-${d.projectId}-${d.id}`;

export const toDecisionItem = (decision: Decision): DecisionItem => ({
  kind: 'decision',
  id: decisionItemId(decision),
  projectId: decision.projectId,
  decision,
});

export function decisionView(decision: Decision, local?: LocalAnswer): DecisionView {
  if (local) {
    return { phase: 'envoyee', answer: { optionId: local.optionId, text: local.text, createdAt: local.at }, editable: true };
  }
  const a = decision.answer;
  if (!a) return { phase: 'attente', editable: false };
  switch (a.status) {
    case 'en_attente':
      return { phase: 'envoyee', answer: a, editable: true };
    case 'pris':
      return { phase: 'envoyee', answer: a, editable: false };
    case 'fait':
      return { phase: 'repondu', answer: a, editable: false };
    case 'expire':
      return { phase: 'expiree', answer: a, editable: false };
    case 'refuse':
      return { phase: 'refusee', answer: a, editable: false };
  }
}

/** Attend encore quelque chose de toi : pas de réponse, ou une réponse expirée ou refusée. */
export const needsYou = (phase: DecisionPhase) => phase === 'attente' || phase === 'expiree' || phase === 'refusee';

/** Domaines sensibles, triés avant les autres (§ 3.1). */
const SENSITIVE: readonly DecisionTopic[] = ['securite', 'argent', 'donnees', 'legal'];

/** Tri du § 3.1 : bloquantes d'abord, puis domaine sensible, puis la plus ancienne. */
export function compareDecisions(a: Decision, b: Decision): number {
  if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
  const sa = SENSITIVE.includes(a.topic);
  const sb = SENSITIVE.includes(b.topic);
  if (sa !== sb) return sa ? -1 : 1;
  return a.askedAt.localeCompare(b.askedAt);
}

export const sortDecisionItems = (items: DecisionItem[]) => [...items].sort((a, b) => compareDecisions(a.decision, b.decision));

/** Les options implicites d'une décision sans options (§ 2.1). */
export const isImplicitYesNo = (options: DecisionOption[]) =>
  options.length === 2 && options[0]?.id === 'oui' && options[1]?.id === 'non';

/** Un tap suffit (D13) : oui/non sans texte et réversible. Jamais pour une décision irréversible. */
export const isOneTap = (d: Decision) => d.freeText === 'non' && d.reversible && isImplicitYesNo(d.options);

/** Option recommandée en premier (§ 3.2), les autres dans l'ordre de l'agent. */
export function orderedOptions(d: Decision): DecisionOption[] {
  const rec = d.options.find((o) => o.id === d.recommended);
  return rec ? [rec, ...d.options.filter((o) => o !== rec)] : d.options;
}

/** Libellés du oui/non en un tap : un livrable se valide ou se fait reprendre. */
export function oneTapLabels(d: Decision): { yes: string; no: string } {
  return d.kind === 'validation' ? { yes: 'Valider', no: 'Faire reprendre' } : { yes: 'Oui', no: 'Non' };
}

export const optionLabel = (d: Decision, optionId: string) => {
  if (isOneTap(d)) {
    const labels = oneTapLabels(d);
    if (optionId === 'oui') return labels.yes;
    if (optionId === 'non') return labels.no;
  }
  return d.options.find((o) => o.id === optionId)?.label ?? optionId;
};

const HOUR = 3_600_000;

/** Répondue depuis moins de `hours` heures (date de transmission, sinon date d'envoi). */
export function answeredWithin(view: DecisionView, hours: number, now: Date = new Date()): boolean {
  if (view.phase !== 'repondu' || !view.answer) return false;
  const at = new Date(view.answer.doneAt ?? view.answer.createdAt).getTime();
  return now.getTime() - at <= hours * HOUR;
}
