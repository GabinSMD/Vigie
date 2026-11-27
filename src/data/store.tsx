import { createContext, useCallback, useContext, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { COST_ALERT_THRESHOLD, DAILY_SESSION_CAP, GLOBAL_COST_CAP, SESSIONS_TODAY, actionItems, projects } from './mock';
import type { DecisionAnswer } from './api';
import { decisionView, needsYou, type DecisionItem, type DecisionView, type LocalAnswer } from './decisionState';
import { looksLikeSecret } from './secrets';
import type { ActionItem } from './types';

/** Réglages d'autonomie, de budget et d'alerte. */
export interface Settings {
  /** Plafond de sessions lancées par jour, tous projets. */
  sessionCap: number;
  /** Plafond de coût par jour, tous projets, en dollars. */
  costCap: number;
  /** Plafond de coût par jour et par projet, en dollars. */
  projectCaps: Record<string, number>;
  /** Projets dont les agents peuvent fusionner seuls les PR qui passent les garde-fous. */
  autoMerge: string[];
  push: boolean;
  /** Seuil d'alerte des jauges, en pourcentage du plafond. */
  threshold: number;
}

/** Bornes des réglages : un plafond ne descend jamais à zéro. */
export const LIMITS = {
  sessionCap: { min: 1, max: 10, step: 1 },
  costCap: { min: 1, max: 100, step: 1 },
  projectCap: { min: 1, max: 50, step: 1 },
  threshold: { min: 50, max: 100, step: 5 },
} as const;

/** Réglages globaux modifiables d'un coup ; plafonds par projet et fusion automatique ont leurs actions. */
export type SettingsPatch = Partial<Omit<Settings, 'projectCaps' | 'autoMerge'>>;

export const ROLES = ['Développeur', 'Relecteur', 'Chef de projet'] as const;
export type Role = (typeof ROLES)[number];

/** Session lancée depuis l'écran « Lancer du travail ». */
export interface Launched {
  projectId: string;
  role: Role;
  /** Issue de départ (« #450 ») ou début de la consigne libre. */
  what: string;
}

/*
 * État local de la démo : ce que tu as décidé pendant la visite.
 * Rien ne part vers GitHub ni vers un agent ; le branchement réel viendra plus tard.
 */
export interface DemoState {
  merged: string[];
  consignes: Record<string, string[]>;
  /**
   * Réponses aux décisions, par id de ligne, pas encore confirmées par le Worker : toutes en données fictives ;
   * en données réelles, seulement le oui/non en un tap pendant ses 5 s d'annulation (D13).
   */
  answers: Record<string, LocalAnswer>;
  /** Ordres `repondre` renvoyés par le Worker pendant cette visite (créés ou refusés), par id de ligne. */
  ordres: Record<string, DecisionAnswer>;
  toast: string | null;
  /** Ligne dont la réponse peut encore être annulée depuis le toast (oui/non en un tap, D13). */
  undo: string | null;
  settings: Settings;
  sessionsToday: number;
  launched: Launched[];
}

export type DemoAction =
  | { type: 'merge'; prNumber: string }
  | { type: 'consigne'; sessionId: string; text: string }
  | { type: 'answer'; itemId: string; optionId: string; text?: string; at?: string; message?: string; undoable?: boolean }
  | { type: 'undoAnswer'; itemId: string }
  /** Réponse du Worker à `POST /api/ordres` : remplace la réponse locale. */
  | { type: 'ordre'; itemId: string; answer: DecisionAnswer; message?: string }
  /** L'envoi n'a pas abouti (réseau, connexion) : la réponse locale est retirée, rien n'est parti. */
  | { type: 'answerFailed'; itemId: string; message: string }
  | { type: 'notify'; message: string }
  | { type: 'settings'; patch: SettingsPatch }
  | { type: 'projectCap'; projectId: string; cap: number }
  | { type: 'autoMerge'; projectId: string; on: boolean }
  | { type: 'launch'; session: Launched }
  | { type: 'dismissToast' };

export const initialSettings: Settings = {
  sessionCap: DAILY_SESSION_CAP,
  costCap: GLOBAL_COST_CAP,
  projectCaps: Object.fromEntries(projects.map((p) => [p.id, p.costCap])),
  autoMerge: [],
  push: true,
  threshold: COST_ALERT_THRESHOLD,
};

export const initialState: DemoState = {
  merged: [],
  consignes: {},
  answers: {},
  ordres: {},
  toast: null,
  undo: null,
  settings: initialSettings,
  sessionsToday: SESSIONS_TODAY,
  launched: [],
};

const clamp = (value: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, value));

const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;

/** Sessions encore permises aujourd'hui. */
export const remainingSessions = (state: DemoState) => Math.max(0, state.settings.sessionCap - state.sessionsToday);

export function reducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case 'merge':
      return { ...state, merged: [...state.merged, action.prNumber], toast: `${action.prNumber} fusionnée.`, undo: null };
    case 'consigne': {
      const previous = state.consignes[action.sessionId] ?? [];
      return {
        ...state,
        consignes: { ...state.consignes, [action.sessionId]: [...previous, action.text] },
        toast: 'Consigne envoyée.',
        undo: null,
      };
    }
    case 'answer': {
      const text = action.text?.trim() || undefined;
      /* Garde-fou (§ 7) : un texte qui ressemble à un secret n'est ni gardé ni envoyé. */
      if (text && looksLikeSecret(text)) return { ...state, toast: "Ressemble à un secret : rien n'est parti.", undo: null };
      const answer: LocalAnswer = { optionId: action.optionId, at: action.at ?? new Date().toISOString(), ...(text ? { text } : {}) };
      return {
        ...state,
        answers: { ...state.answers, [action.itemId]: answer },
        toast: action.message ?? 'Réponse envoyée.',
        undo: action.undoable ? action.itemId : null,
      };
    }
    case 'undoAnswer': {
      const { [action.itemId]: _removed, ...rest } = state.answers;
      return { ...state, answers: rest, toast: 'Réponse annulée.', undo: null };
    }
    case 'ordre': {
      const { [action.itemId]: _local, ...answers } = state.answers;
      return {
        ...state,
        answers,
        ordres: { ...state.ordres, [action.itemId]: action.answer },
        ...(action.message ? { toast: action.message, undo: null } : {}),
      };
    }
    case 'answerFailed': {
      const { [action.itemId]: _local, ...answers } = state.answers;
      return { ...state, answers, toast: action.message, undo: null };
    }
    case 'notify':
      return { ...state, toast: action.message, undo: null };
    case 'dismissToast':
      return { ...state, toast: null, undo: null };
    case 'settings': {
      const next = { ...state.settings, ...action.patch };
      next.sessionCap = clamp(next.sessionCap, LIMITS.sessionCap);
      next.costCap = clamp(next.costCap, LIMITS.costCap);
      next.threshold = clamp(next.threshold, LIMITS.threshold);
      return { ...state, settings: next };
    }
    case 'projectCap':
      return {
        ...state,
        settings: {
          ...state.settings,
          projectCaps: { ...state.settings.projectCaps, [action.projectId]: clamp(action.cap, LIMITS.projectCap) },
        },
      };
    case 'autoMerge': {
      const others = state.settings.autoMerge.filter((id) => id !== action.projectId);
      const name = projectName(action.projectId);
      return {
        ...state,
        settings: { ...state.settings, autoMerge: action.on ? [...others, action.projectId] : others },
        toast: action.on ? `Fusion automatique activée pour ${name}.` : `Fusion automatique désactivée pour ${name}.`,
        undo: null,
      };
    }
    case 'launch':
      /* Garde-fou : le plafond du jour bloque le lancement, même si l'écran a laissé passer. */
      if (remainingSessions(state) === 0) return { ...state, toast: 'Plafond du jour atteint : session non lancée.', undo: null };
      return {
        ...state,
        sessionsToday: state.sessionsToday + 1,
        launched: [action.session, ...state.launched],
        toast: `Session lancée : ${action.session.role} sur ${projectName(action.session.projectId)}.`,
        undo: null,
      };
  }
}

/** État affiché d'une décision, d'après tout ce que l'app sait pendant cette visite. */
export const viewOf = (state: Pick<DemoState, 'answers' | 'ordres'>, item: DecisionItem): DecisionView =>
  decisionView(item.decision, state.answers[item.id], state.ordres[item.id]);

/** Une ligne reste dans « À faire par toi » tant que tu n'as pas tranché. */
export function pendingItems(state: DemoState, items: ActionItem[] = actionItems): ActionItem[] {
  return items.filter((item) => {
    switch (item.kind) {
      case 'pr':
        return !state.merged.includes(item.prNumber);
      case 'session':
        return !state.consignes[item.sessionId]?.length;
      case 'decision':
        return needsYou(viewOf(state, item).phase);
      case 'blocage':
        return true;
    }
  });
}

interface StoreValue {
  state: DemoState;
  dispatch: (action: DemoAction) => void;
  /** État le plus récent, pour un envoi différé (le toast « Annuler » a pu passer entre-temps). */
  getState: () => DemoState;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children, initial = initialState }: { children: ReactNode; initial?: DemoState }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const ref = useRef(state);
  ref.current = state;
  const getState = useCallback(() => ref.current, []);
  const value = useMemo(() => ({ state, dispatch, getState }), [state, getState]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore doit être utilisé dans <StoreProvider>.');
  return value;
}
