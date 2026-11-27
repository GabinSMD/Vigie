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

/* --- Décisions en attente de ta réponse (docs/specs/en-attente-de-reponse.md § 2) --- */

/** `choix` : trancher entre des options ; `action` : faire quelque chose hors de Vigie ; `validation` : accepter un livrable. */
export type DecisionKind = 'choix' | 'action' | 'validation';

/** Domaine de la décision. Plusieurs domaines : le plus sensible, dans cet ordre. */
export type DecisionTopic = 'securite' | 'argent' | 'donnees' | 'legal' | 'produit' | 'technique';

/** Champ texte libre de la réponse. */
export type DecisionFreeText = 'non' | 'facultatif' | 'obligatoire';

export interface DecisionOption {
  /** `[a-z0-9-]{1,20}`. */
  id: string;
  /** 60 caractères au plus. */
  label: string;
  /** 100 caractères au plus (coût, délai, risque). */
  detail?: string;
}

/** `PR #n` ou `issue #n`, dans le dépôt du projet. */
export interface DecisionLink {
  kind: 'pr' | 'issue';
  number: number;
}

/** Qui demande, donc où va la réponse. */
export type DecisionAskedBy =
  | { kind: 'session'; id: string }
  | { kind: 'issue'; number: number }
  | { kind: 'pr'; number: number };

/** Où la décision a été lue. */
export type DecisionSource = 'session' | 'issue' | 'pr' | 'dependabot';

/**
 * Ce qu'écrit l'agent dans un bloc `decision`, une fois lu et vérifié
 * (`parseDecisionBlocks` dans `src/data/decision.ts`). Valeurs par défaut appliquées ;
 * `options` est vide quand le bloc n'en donne pas (oui/non implicite).
 */
export interface DecisionBlock {
  /** `[a-z0-9-]{3,60}`, unique dans le projet, ex. `1039-critere-reprise`. */
  id: string;
  kind: DecisionKind;
  /** 140 caractères au plus. */
  question: string;
  /** 1 ou 2 lignes de 160 caractères au plus. */
  context: string[];
  /** 0 (oui/non implicite) ou 2 à 5 options. */
  options: DecisionOption[];
  /** Option recommandée par l'agent, jamais calculée par Vigie ni par le pilote. */
  recommended?: string;
  reversible: boolean;
  topic: DecisionTopic;
  freeText: DecisionFreeText;
  blocking: boolean;
  links: DecisionLink[];
}

/** Cycle de vie d'un ordre (§ 4.1) : `en_attente` → `pris` → `fait` | `refuse`, ou `expire` s'il n'est pas pris à temps. */
export type OrdreStatus = 'en_attente' | 'pris' | 'fait' | 'refuse' | 'expire';

/** État de l'ordre `repondre` le plus récent qui répond à la décision (§ 4.1), joint par `GET /api/decisions`. */
export interface DecisionAnswer {
  /** Identifiant de l'ordre, généré par le Worker. */
  id?: string;
  status: OrdreStatus;
  optionId: string;
  text?: string;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** ISO 8601 UTC : au-delà, le pilote ne prend plus l'ordre (D10). */
  expiresAt: string;
  /** ISO 8601 UTC : moment où le pilote a transmis la réponse. */
  doneAt?: string;
  /** « Transmis à la session », « Posé sur l'issue #1020 ». */
  result?: string;
  /** Raison d'un refus ou d'une expiration. */
  reason?: string;
}

/**
 * Forme normalisée d'une décision, quelle que soit sa source (§ 2.4), partagée par le Worker et l'app.
 * `options` est toujours rempli : les options implicites `oui`/`non` sont dépliées.
 */
export interface Decision extends DecisionBlock {
  projectId: string;
  /** ISO 8601 UTC : première fois que la décision a été vue. */
  askedAt: string;
  askedBy: DecisionAskedBy;
  source: DecisionSource;
  answer?: DecisionAnswer;
}

/** Réponse de `GET /api/decisions` (§ 5.2) : décisions des issues, des PR, de Dependabot et de l'instantané, dédupliquées. */
export interface DecisionsResponse {
  generatedAt: string;
  /** Date de l'instantané dont viennent les questions des sessions ; null s'il manque ou est illisible. */
  snapshotAt: string | null;
  /** Bloquantes d'abord, puis de la plus ancienne à la plus récente. Clé unique : `(projectId, id)`. */
  decisions: Decision[];
  /** Projets dont la lecture GitHub a échoué : leurs décisions d'issues et de PR manquent. */
  errors: { projectId: string; error: string }[];
}

/* --- Ordres (docs/specs/en-attente-de-reponse.md § 4, docs/api-ordres.md) --- */

/** Liste fermée des types d'ordres : `repondre` seulement en V1. */
export const ORDRE_TYPES = ['repondre'] as const;
export type OrdreType = (typeof ORDRE_TYPES)[number];

/** Où le pilote transmet la réponse : recopié par le Worker depuis la décision, jamais pris dans la requête. */
export type OrdreTarget =
  | { kind: 'session'; id: string; fallbackIssue?: number }
  | { kind: 'issue'; number: number }
  | { kind: 'pr'; number: number }
  | { kind: 'dependabot'; number: number };

/** Ordre tel que le Worker le stocke dans D1 et le donne au pilote. */
export interface Ordre {
  id: string;
  type: OrdreType;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** ISO 8601 UTC (D10). */
  expiresAt: string;
  /** Identité vérifiée par Cloudflare Access (adresse e-mail). */
  by: string;
  projectId: string;
  decisionId: string;
  /** Question de la décision au moment de la réponse, pour le gabarit du pilote. */
  question: string;
  target: OrdreTarget;
  optionId: string;
  /** Libellé de l'option au moment de la réponse. */
  optionLabel: string;
  /** Texte brut de Gabin : une donnée, jamais une commande. */
  text?: string;
  status: OrdreStatus;
  /** ISO 8601 UTC : moment où le pilote l'a pris. */
  takenAt?: string;
  doneAt?: string;
  result?: string;
  reason?: string;
}

/** Corps de `POST /api/ordres`. `target`, la question et les options sont relus par le Worker. */
export interface OrdreRequest {
  type: OrdreType;
  projectId: string;
  decisionId: string;
  optionId: string;
  text?: string;
}

/** Réponse de `POST /api/ordres` (201) et de `PATCH /api/ordres/:id` (200). */
export interface OrdreResponse {
  ordre: Ordre;
}

/** Réponse de `GET /api/ordres` (pilote). */
export interface OrdresResponse {
  generatedAt: string;
  ordres: Ordre[];
}

/** Corps de `PATCH /api/ordres/:id` (pilote). */
export type OrdreUpdate = { status: 'pris' } | { status: 'fait'; result: string } | { status: 'refuse'; reason: string };

/** Erreur de l'API : `error` est un code stable, `message` est à afficher tel quel (tutoiement). */
export interface ApiError {
  error: string;
  message?: string;
  /** 409 de `POST /api/ordres` : la réponse déjà prise (`pris`) ou transmise (`fait`) qui bloque le nouvel envoi. */
  answer?: DecisionAnswer;
}
