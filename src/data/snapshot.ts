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

export interface SnapshotQuestion {
  id: string;
  title: string;
  /** Complément affiché sous la question, ex. « en brouillon ». */
  detail: string;
  /** PR concernée, ex. « #204 ». */
  prRef: string;
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
