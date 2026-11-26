import type { DecisionFreeText, DecisionKind, DecisionLink, DecisionOption, DecisionTopic } from './api';
import type { EventKind, Status } from './types';

/**
 * Instantané des sessions, écrit par le pilote dans KV (clé `snapshot`, voir docs/instantane-sessions.md).
 * Les dates sont en ISO 8601 UTC : c'est l'app qui les transforme en « il y a 40 min ».
 * Aucun coût affiché en V1 (D7) ; `costUsd` est facultatif et ignoré par l'écran.
 */
export const SNAPSHOT_VERSION = 1;

export interface SnapshotEvent {
  kind: EventKind;
  title: string;
  /** ISO 8601 UTC. */
  at: string;
}

/**
 * Question posée par une session. Les trois premiers champs sont ceux de la v1 ; les suivants,
 * tous facultatifs, viennent d'un bloc `decision` (docs/specs/en-attente-de-reponse.md § 2.3).
 * Une question sans `options` reste une question oui/non.
 */
export interface SnapshotQuestion {
  id: string;
  /** La question (champ `question` du bloc). */
  title: string;
  /** Complément affiché sous la question : première ligne du contexte, ou « en brouillon ». */
  detail: string;
  /** PR concernée, ex. « #204 » ; sinon la première issue liée ; vide si aucun lien. */
  prRef: string;
  // --- Champs ajoutés, tous facultatifs ---
  kind?: DecisionKind;
  /** 1 ou 2 lignes. */
  context?: string[];
  /** 2 à 5 options. Absent : oui/non. */
  options?: DecisionOption[];
  /** Id d'une option (ou `oui`/`non` sans options). */
  recommended?: string;
  reversible?: boolean;
  topic?: DecisionTopic;
  freeText?: DecisionFreeText;
  links?: DecisionLink[];
  blocking?: boolean;
  /** ISO 8601 UTC. */
  askedAt?: string;
}

export interface SnapshotDeliverable {
  id: string;
  title: string;
}

export interface SnapshotSession {
  id: string;
  /** Identifiant de projet de config/projets.json. */
  projectId: string;
  role: string;
  /** Issue liée, ex. « #450 ». */
  ref?: string;
  title: string;
  status: Status;
  statusLabel: string;
  line: string;
  summary: string;
  /** Ce que la session attend de toi ; présent seulement si elle attend. */
  waitingFor?: string;
  /** Du plus récent au plus ancien. */
  events: SnapshotEvent[];
  /** PR liée, ex. « #466 ». */
  linkedPr?: string;
  /** Présent si la session ne répond plus. */
  disconnected?: { lastSeen: string };
  /** Facultatif : coût en dollars lu par le pilote. Non affiché en V1. */
  costUsd?: number;
  questions?: SnapshotQuestion[];
  deliverables?: SnapshotDeliverable[];
}

export interface SessionSnapshot {
  version: typeof SNAPSHOT_VERSION;
  /** ISO 8601 UTC : moment où le pilote a écrit l'instantané. */
  generatedAt: string;
  sessions: SnapshotSession[];
}
