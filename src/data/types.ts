import type { Decision } from './api';

/** État affiché : toujours rendu avec une couleur ET une icône ET un mot. */
export type Status = 'ok' | 'attention' | 'bloque' | 'neutre';

export type EventKind = 'fait' | 'reussi' | 'attente' | 'perdu' | 'envoye';

export interface SessionEvent {
  kind: EventKind;
  title: string;
  /** Moment relatif, déjà formulé (« il y a 40 min »). */
  when: string;
}

export interface Session {
  id: string;
  projectId: string;
  role: string;
  /** Numéro d'issue lié, ex. « #450 ». */
  ref?: string;
  title: string;
  status: Status;
  statusLabel: string;
  line: string;
  summary: string;
  /** Ce que la session attend de toi, si elle attend. */
  waitingFor?: string;
  events: SessionEvent[];
  linkedPr?: string;
  disconnected?: { lastSeen: string };
}

export interface PullRequest {
  number: string;
  projectId: string;
  title: string;
  status: Status;
  statusLabel: string;
  line: string;
  summary: string;
  sessionRef?: string;
  checks: { label: string; status: Status; statusLabel: string }[];
  guards: string[];
  draft: boolean;
  /** Adresse GitHub de la PR (données réelles). */
  url?: string;
}

export interface ClosedPullRequest {
  number: string;
  title: string;
  when: string;
  merged: boolean;
}

export interface Issue {
  number: string;
  title: string;
  url?: string;
}

export interface CostLine {
  title: string;
  detail: string;
  amount: number;
}

export interface Project {
  id: string;
  name: string;
  status: Status;
  statusLabel?: string;
  line: string;
  costToday: number;
  costCap: number;
  sessionIds: string[];
  prNumbers: string[];
  closedPrs: ClosedPullRequest[];
  issues: Issue[];
  costs: CostLine[];
  /** Adresse GitHub du dépôt (données réelles). */
  url?: string;
}

/** Une ligne de la file « À faire par toi ». */
export type ActionItem =
  | { kind: 'blocage'; id: string; projectId: string; sessionId: string; title: string; detail: string }
  | { kind: 'session'; id: string; projectId: string; sessionId: string; title: string }
  | { kind: 'pr'; id: string; projectId: string; prNumber: string; title: string; detail: string }
  /** Décision « En attente de ta réponse » (docs/specs/en-attente-de-reponse.md § 2.4), y compris les livrables (`kind: validation`). */
  | { kind: 'decision'; id: string; projectId: string; decision: Decision };
