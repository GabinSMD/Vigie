import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';
import { actionItems } from './mock';
import type { ActionItem } from './types';

/*
 * État local de la démo : ce que tu as décidé pendant la visite.
 * Rien ne part vers GitHub ni vers un agent ; le branchement réel viendra plus tard.
 */
export interface DemoState {
  merged: string[];
  consignes: Record<string, string[]>;
  answers: Record<string, 'oui' | 'non'>;
  validated: string[];
  toast: string | null;
}

export type DemoAction =
  | { type: 'merge'; prNumber: string }
  | { type: 'consigne'; sessionId: string; text: string }
  | { type: 'answer'; itemId: string; answer: 'oui' | 'non' }
  | { type: 'validate'; itemId: string }
  | { type: 'notify'; message: string }
  | { type: 'dismissToast' };

export const initialState: DemoState = { merged: [], consignes: {}, answers: {}, validated: [], toast: null };

export function reducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case 'merge':
      return { ...state, merged: [...state.merged, action.prNumber], toast: `${action.prNumber} fusionnée.` };
    case 'consigne': {
      const previous = state.consignes[action.sessionId] ?? [];
      return {
        ...state,
        consignes: { ...state.consignes, [action.sessionId]: [...previous, action.text] },
        toast: 'Consigne envoyée.',
      };
    }
    case 'answer':
      return { ...state, answers: { ...state.answers, [action.itemId]: action.answer }, toast: 'Réponse envoyée.' };
    case 'validate':
      return { ...state, validated: [...state.validated, action.itemId], toast: 'Livrable validé.' };
    case 'notify':
      return { ...state, toast: action.message };
    case 'dismissToast':
      return { ...state, toast: null };
  }
}

/** Une ligne reste dans « À faire par toi » tant que tu n'as pas tranché. */
export function pendingItems(state: DemoState): ActionItem[] {
  return actionItems.filter((item) => {
    switch (item.kind) {
      case 'pr':
        return !state.merged.includes(item.prNumber);
      case 'session':
        return !state.consignes[item.sessionId]?.length;
      case 'question':
        return !state.answers[item.id];
      case 'livrable':
        return !state.validated.includes(item.id);
      case 'blocage':
        return true;
    }
  });
}

interface StoreValue {
  state: DemoState;
  dispatch: (action: DemoAction) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children, initial = initialState }: { children: ReactNode; initial?: DemoState }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore doit être utilisé dans <StoreProvider>.');
  return value;
}
