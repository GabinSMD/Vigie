import { useCallback } from 'react';
import type { ApiError, DecisionAnswer, Ordre, OrdreRequest, OrdreResponse } from './api';
import type { DecisionItem } from './decisionState';
import { useData } from './source';
import { useStore } from './store';

/**
 * Envoi des réponses aux décisions en données réelles : `POST /api/ordres` (docs/api-ordres.md).
 * En données fictives, rien ne part : la carte garde la réponse dans le store, comme avant.
 */

/** Délai pendant lequel le oui/non en un tap peut être annulé avant le dépôt de l'ordre (D13). */
export const UNDO_DELAY = 5000;

export const NETWORK_ERROR = "Réseau indisponible : ta réponse n'est pas partie. Réessaie.";
export const SESSION_EXPIRED = 'Ta connexion a expiré : recharge la page pour te reconnecter.';

export type SendResult =
  /** L'ordre est déposé : « Envoyée ». */
  | { kind: 'ok'; answer: DecisionAnswer }
  /** Le Worker refuse la réponse (404, 409, 422) : « Refusée », avec sa raison. */
  | { kind: 'refused'; answer: DecisionAnswer; message: string }
  /** Rien n'est parti (réseau, connexion expirée, panne) : la réponse reste à envoyer. */
  | { kind: 'error'; message: string };

export const ordreToAnswer = (o: Ordre): DecisionAnswer => ({
  id: o.id,
  status: o.status,
  optionId: o.optionId,
  ...(o.text ? { text: o.text } : {}),
  createdAt: o.createdAt,
  expiresAt: o.expiresAt,
  ...(o.doneAt ? { doneAt: o.doneAt } : {}),
  ...(o.result ? { result: o.result } : {}),
  ...(o.reason ? { reason: o.reason } : {}),
});

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Dépose l'ordre. Ne lève jamais : le résultat dit quoi afficher. */
export async function postOrdre(apiUrl: string, req: OrdreRequest, fetchFn: FetchFn = (i, init) => fetch(i, init)): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetchFn(`${apiUrl.replace(/\/$/, '')}/api/ordres`, {
      method: 'POST',
      credentials: 'include',
      // Connexion Access expirée : Access redirige vers sa page de connexion, on le dit au lieu de suivre.
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch {
    return { kind: 'error', message: NETWORK_ERROR };
  }
  if (response.type === 'opaqueredirect' || response.status === 401 || response.status === 403) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    return { kind: 'error', message: response.status === 403 && body?.message ? body.message : SESSION_EXPIRED };
  }
  if (response.status === 201) {
    const body = (await response.json().catch(() => null)) as OrdreResponse | null;
    return body?.ordre ? { kind: 'ok', answer: ordreToAnswer(body.ordre) } : { kind: 'error', message: NETWORK_ERROR };
  }
  if (response.status === 404 || response.status === 409 || response.status === 422) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    const message = body?.message ?? 'Réponse refusée.';
    const now = new Date().toISOString();
    // Le texte refusé n'est pas gardé : il ressemble peut-être à un secret.
    return { kind: 'refused', message, answer: { status: 'refuse', optionId: req.optionId, createdAt: now, expiresAt: now, reason: message } };
  }
  return { kind: 'error', message: NETWORK_ERROR };
}

const request = (item: DecisionItem, optionId: string, text?: string): OrdreRequest => ({
  type: 'repondre',
  projectId: item.decision.projectId,
  decisionId: item.decision.id,
  optionId,
  ...(text ? { text } : {}),
});

/**
 * `now` : envoi immédiat (bouton « Envoyer », « Renvoyer », « Modifier »).
 * `later` : oui/non en un tap ; la réponse s'affiche tout de suite, l'ordre ne part qu'au bout de 5 s
 * si « Annuler » n'a pas été touché. Le minuteur ne dépend pas de la carte, qui quitte la liste aussitôt.
 */
export function useAnswerSender() {
  const { dispatch, getState } = useStore();
  const { apiUrl } = useData();

  const settle = useCallback(
    (item: DecisionItem, result: SendResult, okMessage?: string) => {
      if (result.kind === 'ok') dispatch({ type: 'ordre', itemId: item.id, answer: result.answer, message: okMessage });
      else if (result.kind === 'refused') dispatch({ type: 'ordre', itemId: item.id, answer: result.answer, message: `Réponse refusée : ${result.message}` });
      else dispatch({ type: 'answerFailed', itemId: item.id, message: result.message });
    },
    [dispatch],
  );

  const now = useCallback(
    async (item: DecisionItem, optionId: string, text?: string, okMessage = 'Réponse envoyée.'): Promise<SendResult> => {
      const result = apiUrl ? await postOrdre(apiUrl, request(item, optionId, text)) : ({ kind: 'error', message: NETWORK_ERROR } as const);
      if (result.kind !== 'error') settle(item, result, okMessage);
      return result;
    },
    [apiUrl, settle],
  );

  const later = useCallback(
    (item: DecisionItem, optionId: string, message: string) => {
      const at = new Date().toISOString();
      dispatch({ type: 'answer', itemId: item.id, optionId, at, message, undoable: true });
      window.setTimeout(() => {
        // Annulée (ou remplacée) pendant les 5 s : rien ne part.
        if (getState().answers[item.id]?.at !== at) return;
        if (!apiUrl) return settle(item, { kind: 'error', message: NETWORK_ERROR });
        void postOrdre(apiUrl, request(item, optionId)).then((result) => settle(item, result));
      }, UNDO_DELAY);
    },
    [apiUrl, dispatch, getState, settle],
  );

  return { now, later };
}
