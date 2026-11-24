import type { SessionSnapshot } from './snapshot';

/** Réponses du Worker. Types partagés entre `worker/` et l'app. */

export type CiState = 'success' | 'failure' | 'pending' | 'none';

export interface ApiCheck {
  name: string;
  state: CiState;
}

export interface ApiPullRequest {
  number: number;
  title: string;
  draft: boolean;
  url: string;
  baseRef: string;
  ci: CiState;
  checks: ApiCheck[];
}

export interface ApiIssue {
  number: number;
  title: string;
  url: string;
}

export interface ApiProject {
  id: string;
  owner: string;
  repo: string;
  name: string;
  url: string;
  defaultBranch: string | null;
  pullRequests: ApiPullRequest[];
  issues: ApiIssue[];
  /** Présent si la lecture GitHub de ce dépôt a échoué ; les listes sont alors vides. */
  error?: string;
}

export interface ProjetsResponse {
  generatedAt: string;
  projects: ApiProject[];
}

export interface SessionsResponse {
  /** Date de l'instantané, ou null si le pilote n'a encore rien écrit. */
  snapshotAt: string | null;
  snapshot: SessionSnapshot | null;
}
