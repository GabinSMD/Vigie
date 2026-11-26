import type {
  Decision,
  DecisionAskedBy,
  DecisionBlock,
  DecisionFreeText,
  DecisionKind,
  DecisionLink,
  DecisionOption,
  DecisionSource,
  DecisionTopic,
} from './api';
import type { SnapshotQuestion } from './snapshot';
import { looksLikeSecret } from './secrets';

/**
 * Analyseur du bloc `decision` (docs/specs/en-attente-de-reponse.md § 2.2).
 * Fonction pure, sans navigateur ni réseau : le Worker l'appelle sur les descriptions d'issues et de PR,
 * le pilote applique les mêmes règles aux Passations. Aucun secret n'est jamais recopié dans le résultat.
 */

export { looksLikeSecret } from './secrets';

export interface DecisionError {
  /** Absent si l'id manque, est mal formé ou ressemble lui-même à un secret. */
  id?: string;
  /** Raison lisible, à afficher après « Bloc de décision illisible : ». Ne recopie aucune valeur du bloc. */
  reason: string;
}

export interface ParseResult {
  /** Décisions valides, dans l'ordre du texte. Pour un même id, le dernier bloc gagne, même invalide (il n'y a alors que l'erreur). */
  decisions: DecisionBlock[];
  /** Blocs invalides : jamais transformés en décision. */
  errors: DecisionError[];
  /** Clés inconnues, ignorées : à écrire dans le journal du pilote ou du Worker. */
  warnings: string[];
}

const KINDS: readonly DecisionKind[] = ['choix', 'action', 'validation'];
const TOPICS: readonly DecisionTopic[] = ['securite', 'argent', 'donnees', 'legal', 'produit', 'technique'];
const FREE_TEXTS: readonly DecisionFreeText[] = ['non', 'facultatif', 'obligatoire'];

const SINGLE_KEYS = ['id', 'kind', 'question', 'recommended', 'reversible', 'topic', 'freeText', 'blocking'] as const;
const LIST_KEYS = ['context', 'option', 'link'] as const;
const REQUIRED_KEYS = ['id', 'question', 'context', 'reversible', 'topic'] as const;

type SingleKey = (typeof SINGLE_KEYS)[number];
type ListKey = (typeof LIST_KEYS)[number];

const ID_FORMAT = /^[a-z0-9-]{3,60}$/;
const OPTION_ID_FORMAT = /^[a-z0-9-]{1,20}$/;
const LINE_FORMAT = /^([a-zA-Z]+): (.*)$/;
const LINK_FORMAT = /^(PR|issue) #([1-9][0-9]*)$/;
const SESSION_LINK = /claude\.ai\/code\/session_/;

/** Options implicites d'une décision sans options : un oui/non. */
export const IMPLICIT_OPTIONS: readonly DecisionOption[] = [
  { id: 'oui', label: 'Oui' },
  { id: 'non', label: 'Non' },
];

/** Longueur en caractères affichés (un « é » compte pour un). */
const length = (s: string) => [...s].length;

class Invalid extends Error {}

export interface FencedBlock {
  /** Texte après l'ouverture (la langue), sans les espaces autour ; vide s'il n'y en a pas. */
  info: string;
  lines: string[];
  /** Jamais fermé : le bloc court jusqu'à la fin du texte. */
  unclosed: boolean;
}

/** Ouverture de bloc (CommonMark) : 3 ` ou ~ au moins ; après des `, la langue ne contient pas de `. */
const FENCE_OPEN = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})(.*)$/;

/**
 * Blocs de code de premier niveau (``` ou ~~~). Le contenu d'un bloc n'est pas relu : un bloc
 * ```decision cité dans un bloc ````markdown (exemple dans une issue ou une PR) reste une citation.
 */
export function extractFencedBlocks(text: string): FencedBlock[] {
  const all = text.split(/\r?\n/);
  const blocks: FencedBlock[] = [];
  let i = 0;
  while (i < all.length) {
    const open = FENCE_OPEN.exec(all[i]);
    if (!open) {
      i++;
      continue;
    }
    const fence = open[1];
    const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
    const lines: string[] = [];
    i++;
    while (i < all.length && !close.test(all[i])) lines.push(all[i++]);
    blocks.push({ info: open[2].trim(), lines, unclosed: i >= all.length });
    i++;
  }
  return blocks;
}

/** Blocs ```decision (ou ~~~decision) de premier niveau. Un bloc jamais fermé est rendu avec `unclosed`. */
function extractBlocks(text: string): { lines: string[]; unclosed: boolean }[] {
  return extractFencedBlocks(text).filter((b) => b.info === 'decision');
}

function parseOption(value: string): DecisionOption {
  const parts = value.split('|').map((p) => p.trim());
  const [id, label, detail] = parts;
  if (parts.length < 2 || parts.length > 3 || !id || !label) {
    throw new Invalid('« option » : écrire « id | libellé | détail »');
  }
  if (!OPTION_ID_FORMAT.test(id)) throw new Invalid('« option » : identifiant hors du format [a-z0-9-]{1,20}');
  if (length(label) > 60) throw new Invalid('« option » : libellé de plus de 60 caractères');
  if (detail && length(detail) > 100) throw new Invalid('« option » : détail de plus de 100 caractères');
  return detail ? { id, label, detail } : { id, label };
}

function parseLink(value: string): DecisionLink {
  const m = LINK_FORMAT.exec(value);
  if (!m) throw new Invalid('« link » : écrire « PR #n » ou « issue #n »');
  return { kind: m[1] === 'PR' ? 'pr' : 'issue', number: Number(m[2]) };
}

function yesNo(key: string, value: string | undefined, fallback?: boolean): boolean {
  if (value === undefined && fallback !== undefined) return fallback;
  if (value === 'oui') return true;
  if (value === 'non') return false;
  throw new Invalid(`« ${key} » : oui ou non`);
}

function oneOf<T extends string>(key: string, value: string | undefined, allowed: readonly T[], fallback: T, message: string): T {
  if (value === undefined) return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Invalid(`« ${key} » : ${message}`);
}

/** Lit un bloc. Renvoie la décision, ou lève `Invalid` avec la raison. */
function parseBlock(lines: string[], unclosed: boolean, warnings: string[], setId: (id: string) => void): DecisionBlock {
  const single = new Map<SingleKey, string>();
  const lists: Record<ListKey, string[]> = { context: [], option: [], link: [] };
  const unknown: string[] = [];
  let repeated: string | undefined;

  for (const line of lines) {
    const m = LINE_FORMAT.exec(line); // Règle 1.
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = rawValue.trim();
    if ((LIST_KEYS as readonly string[]).includes(key)) {
      if (value) lists[key as ListKey].push(value);
    } else if ((SINGLE_KEYS as readonly string[]).includes(key)) {
      if (single.has(key as SingleKey)) repeated ??= key; // Règle 3.
      else single.set(key as SingleKey, value);
    } else {
      unknown.push(key); // Règle 2.
    }
  }

  const id = single.get('id');
  const validId = id !== undefined && ID_FORMAT.test(id) && !looksLikeSecret(id) ? id : undefined;
  if (validId) setId(validId);

  // Règle 6, avant tout le reste : un secret rend le bloc invalide, sans rien recopier (pas même un avertissement).
  const raw = lines.join('\n');
  if (looksLikeSecret(raw)) throw new Invalid('ressemble à un secret');
  for (const key of unknown) warnings.push(`${validId ?? 'bloc sans id valide'} : clé inconnue « ${key} » ignorée`);

  if (SESSION_LINK.test(raw)) throw new Invalid('contient un lien de session claude.ai');
  if (unclosed) throw new Invalid('bloc jamais fermé (```)');
  if (repeated) throw new Invalid(`clé « ${repeated} » répétée`);

  // Règle 4 : champs obligatoires (une valeur vide compte comme absente).
  for (const key of REQUIRED_KEYS) {
    const present = key === 'context' ? lists.context.length > 0 : Boolean(single.get(key));
    if (!present) throw new Invalid(`champ « ${key} » absent`);
  }
  if (!validId) throw new Invalid('« id » doit faire 3 à 60 caractères parmi a-z, 0-9 et -');

  const question = single.get('question')!;
  if (length(question) > 140) throw new Invalid('« question » dépasse 140 caractères');

  const context = lists.context;
  if (context.length > 2) throw new Invalid('« context » : 2 lignes au plus');
  if (context.some((c) => length(c) > 160)) throw new Invalid('« context » : une ligne dépasse 160 caractères');

  const options = lists.option.map(parseOption);
  if (options.length === 1 || options.length > 5) throw new Invalid('« option » : 2 à 5 options');
  const seen = new Set<string>();
  for (const o of options) {
    if (seen.has(o.id)) throw new Invalid('« option » : identifiant en double');
    seen.add(o.id);
  }

  const kind = oneOf('kind', single.get('kind') || undefined, KINDS, 'choix', 'choix, action ou validation');
  const reversible = yesNo('reversible', single.get('reversible'));
  const topic = oneOf('topic', single.get('topic'), TOPICS, 'technique', 'securite, argent, donnees, legal, produit ou technique');
  const freeText = oneOf('freeText', single.get('freeText') || undefined, FREE_TEXTS, 'facultatif', 'non, facultatif ou obligatoire');
  const blocking = yesNo('blocking', single.get('blocking') || undefined, false);
  const links = lists.link.map(parseLink);

  const recommended = single.get('recommended') || undefined;
  const effective = options.length > 0 ? options : IMPLICIT_OPTIONS;
  if (recommended !== undefined && !effective.some((o) => o.id === recommended)) {
    throw new Invalid('« recommended » ne fait pas partie des options');
  }

  return {
    id: validId,
    kind,
    question,
    context,
    options,
    ...(recommended !== undefined ? { recommended } : {}),
    reversible,
    topic,
    freeText,
    blocking,
    links,
  };
}

/**
 * Cherche les blocs ```decision d'un texte (Passation, description d'issue ou de PR)
 * et applique les règles du § 2.2. Ne crée jamais de décision à partir du texte libre autour.
 */
export function parseDecisionBlocks(text: string): ParseResult {
  const byId = new Map<string, DecisionBlock>();
  const errors: DecisionError[] = [];
  const warnings: string[] = [];

  for (const { lines, unclosed } of extractBlocks(text)) {
    let id: string | undefined;
    const blockWarnings: string[] = [];
    try {
      const decision = parseBlock(lines, unclosed, blockWarnings, (v) => (id = v));
      byId.delete(decision.id); // Règle 5 : le dernier gagne, à sa place dans l'ordre du texte.
      byId.set(decision.id, decision);
    } catch (e) {
      if (!(e instanceof Invalid)) throw e;
      // Règle 5, lecture stricte : un dernier bloc invalide remplace aussi la version précédente,
      // pour que Gabin ne réponde pas à des options que l'agent a déjà changées.
      if (id !== undefined) byId.delete(id);
      errors.push(id !== undefined ? { id, reason: e.message } : { reason: e.message });
    }
    warnings.push(...blockWarnings);
  }
  return { decisions: [...byId.values()], errors, warnings };
}

/**
 * Forme JSON de l'instantané (§ 2.3), écrite par le pilote dans `questions[]`.
 * Sans options, le champ `options` est omis : la question reste un oui/non pour l'app actuelle.
 */
export function toSnapshotQuestion(d: DecisionBlock, askedAt?: string): SnapshotQuestion {
  const ref = d.links.find((l) => l.kind === 'pr') ?? d.links.find((l) => l.kind === 'issue');
  return {
    id: d.id,
    title: d.question,
    detail: d.context[0],
    prRef: ref ? `#${ref.number}` : '',
    kind: d.kind,
    context: d.context,
    ...(d.options.length > 0 ? { options: d.options } : {}),
    ...(d.recommended !== undefined ? { recommended: d.recommended } : {}),
    reversible: d.reversible,
    topic: d.topic,
    freeText: d.freeText,
    links: d.links,
    blocking: d.blocking,
    ...(askedAt !== undefined ? { askedAt } : {}),
  };
}

/** Forme normalisée partagée (§ 2.4) : provenance ajoutée, options implicites oui/non dépliées. */
export function toDecision(
  d: DecisionBlock,
  origin: { projectId: string; askedAt: string; askedBy: DecisionAskedBy; source: DecisionSource },
): Decision {
  return {
    ...d,
    options: d.options.length > 0 ? d.options : IMPLICIT_OPTIONS.map((o) => ({ ...o })),
    ...origin,
  };
}
