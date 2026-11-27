import type { Decision, DecisionAnswer } from './api';
import { IMPLICIT_OPTIONS } from './decision';

/*
 * Décisions fictives de « En attente de ta réponse » (docs/specs/en-attente-de-reponse.md § 3).
 * Elles couvrent tous les cas de la carte (oui/non, options, recommandée, texte obligatoire,
 * irréversible, bloquante, `kind: action`, plus de 3 options, livrable) et chaque état (§ 3.3).
 * Aucune donnée réelle, aucun secret : les numéros de PR et d'issue sont inventés.
 * Les dates sont relatives au chargement de la page, pour que « 24 h » et « 7 jours » aient un sens.
 */

const MIN = 60_000;
const ago = (minutes: number, now = Date.now()) => new Date(now - minutes * MIN).toISOString();
const yesNo = () => IMPLICIT_OPTIONS.map((o) => ({ ...o }));

type Base = Omit<Decision, 'askedAt' | 'answer'> & { askedMinutesAgo: number; answer?: Omit<DecisionAnswer, 'createdAt' | 'doneAt'> & { createdMinutesAgo: number; doneMinutesAgo?: number } };

const base: Base[] = [
  {
    id: '204-limite-coupe',
    projectId: 'treizero',
    kind: 'choix',
    question: "La limite de 8 joueurs s'applique-t-elle à la Coupe de France ?",
    context: ['La PR #204 reste en brouillon tant que tu ne réponds pas.'],
    options: yesNo(),
    reversible: true,
    topic: 'produit',
    freeText: 'non',
    blocking: false,
    links: [{ kind: 'pr', number: 204 }],
    askedBy: { kind: 'session', id: 'tre-204' },
    source: 'session',
    askedMinutesAgo: 95,
  },
  {
    id: 'liv-amiraute',
    projectId: 'waterline',
    kind: 'validation',
    question: 'Maquette « Amirauté » livrée',
    context: ['Valide-la pour lancer l’intégration, ou demande une reprise.'],
    options: yesNo(),
    reversible: true,
    topic: 'produit',
    freeText: 'non',
    blocking: false,
    links: [],
    askedBy: { kind: 'session', id: 'water-design' },
    source: 'session',
    askedMinutesAgo: 240,
  },
  {
    id: '470-critere-reprise',
    projectId: 'ecole-saas',
    kind: 'choix',
    question: 'Quel critère pour reprendre les mises en production sur la préproduction ?',
    context: [
      'Les tests de bout en bout échouent environ 1 fois sur 10 depuis le 20/11.',
      'La PR #470 reste en brouillon tant que tu n’as pas tranché.',
    ],
    options: [
      { id: 'trois-verts', label: "3 passages verts d'affilée", detail: 'Simple, déjà outillé, prêt aujourd’hui' },
      { id: 'taux', label: "Moins de 2 % d'échecs sur 50", detail: 'Plus sûr, environ une journée de plus' },
      { id: 'manuel', label: 'Tu décides à chaque fois' },
    ],
    recommended: 'trois-verts',
    reversible: true,
    topic: 'technique',
    freeText: 'facultatif',
    blocking: false,
    links: [
      { kind: 'pr', number: 470 },
      { kind: 'issue', number: 468 },
    ],
    askedBy: { kind: 'pr', number: 470 },
    source: 'pr',
    askedMinutesAgo: 180,
  },
  {
    id: '471-nom-depot',
    projectId: 'ecole-saas',
    kind: 'choix',
    question: 'Quel nom pour le dépôt de l’application mobile ?',
    context: ['La session prépare le dépôt et attend le nom avant de le créer.'],
    options: [
      { id: 'propose', label: 'ecole-mobile', detail: 'Le nom proposé par la session' },
      { id: 'autre', label: 'Un autre nom', detail: 'Écris-le ci-dessous' },
    ],
    reversible: true,
    topic: 'produit',
    freeText: 'obligatoire',
    blocking: false,
    links: [{ kind: 'issue', number: 471 }],
    askedBy: { kind: 'issue', number: 471 },
    source: 'issue',
    askedMinutesAgo: 60,
  },
  {
    id: '88-purge-historique',
    projectId: 'streambox',
    kind: 'choix',
    question: "Supprimer l'historique d'écoute de plus de 2 ans ?",
    context: ['La migration vers la nouvelle base est arrêtée en attendant ta réponse.'],
    options: [
      { id: 'supprimer', label: 'Supprimer', detail: 'Définitif : 1,2 million de lignes' },
      { id: 'archiver', label: 'Archiver à part', detail: 'Garde tout, environ 2 h de plus' },
    ],
    recommended: 'archiver',
    reversible: false,
    topic: 'donnees',
    freeText: 'facultatif',
    blocking: true,
    links: [{ kind: 'issue', number: 88 }],
    askedBy: { kind: 'session', id: 'stream-lastfm' },
    source: 'session',
    askedMinutesAgo: 30,
  },
  {
    id: '210-test-iphone',
    projectId: 'treizero',
    kind: 'action',
    question: 'Teste la feuille de match sur ton iPhone',
    context: ['Ouvre la version de test et saisis une feuille de match complète.'],
    options: [
      { id: 'fait', label: "Fait, tout marche" },
      { id: 'souci', label: 'Fait, avec un souci', detail: 'Décris-le ci-dessous' },
      { id: 'pas-encore', label: 'Pas encore' },
    ],
    recommended: 'fait',
    reversible: true,
    topic: 'technique',
    freeText: 'facultatif',
    blocking: false,
    links: [{ kind: 'pr', number: 210 }],
    askedBy: { kind: 'pr', number: 210 },
    source: 'pr',
    askedMinutesAgo: 50,
  },
  {
    id: '95-hebergement',
    projectId: 'waterline',
    kind: 'choix',
    question: 'Où héberger le site vitrine ?',
    context: ['Le site est prêt ; il reste à choisir l’hébergement avant la mise en ligne.'],
    options: [
      { id: 'statique', label: 'Hébergement statique gratuit', detail: '0 € par mois, sans serveur' },
      { id: 'vps', label: 'Petit serveur loué', detail: 'Environ 5 € par mois' },
      { id: 'mutualise', label: 'Hébergement mutualisé', detail: 'Environ 3 € par mois' },
      { id: 'attendre', label: 'Attendre la fin de la maquette' },
    ],
    recommended: 'statique',
    reversible: true,
    topic: 'argent',
    freeText: 'facultatif',
    blocking: false,
    links: [{ kind: 'issue', number: 95 }],
    askedBy: { kind: 'issue', number: 95 },
    source: 'issue',
    askedMinutesAgo: 300,
  },
  /* --- États de l'ordre (§ 3.3) --- */
  {
    id: '476-jour-relance',
    projectId: 'ecole-saas',
    kind: 'choix',
    question: 'Quel jour envoyer la relance des inscriptions ?',
    context: ['Le courriel est prêt ; seul le jour d’envoi manque.'],
    options: [
      { id: 'lundi', label: 'Lundi matin' },
      { id: 'jeudi', label: 'Jeudi soir' },
    ],
    reversible: true,
    topic: 'produit',
    freeText: 'facultatif',
    blocking: false,
    links: [{ kind: 'issue', number: 476 }],
    askedBy: { kind: 'issue', number: 476 },
    source: 'issue',
    askedMinutesAgo: 200,
    answer: { status: 'en_attente', optionId: 'lundi', text: 'Avant 9 h si possible.', createdMinutesAgo: 20 },
  },
  {
    id: '97-police-titres',
    projectId: 'waterline',
    kind: 'choix',
    question: 'Quelle police pour les titres ?',
    context: ['Deux essais sont dans la maquette.'],
    options: [
      { id: 'serif', label: 'Avec empattements' },
      { id: 'sans', label: 'Sans empattements' },
    ],
    reversible: true,
    topic: 'produit',
    freeText: 'facultatif',
    blocking: false,
    links: [{ kind: 'issue', number: 97 }],
    askedBy: { kind: 'issue', number: 97 },
    source: 'issue',
    askedMinutesAgo: 600,
    answer: { status: 'expire', optionId: 'sans', createdMinutesAgo: 400 },
  },
  {
    id: '474-langue-defaut',
    projectId: 'ecole-saas',
    kind: 'choix',
    question: 'Quelle langue par défaut pour les nouveaux comptes ?',
    context: ['Les comptes créés depuis lundi sont en anglais par erreur.'],
    options: [
      { id: 'fr', label: 'Français' },
      { id: 'navigateur', label: 'Celle du navigateur' },
    ],
    reversible: true,
    topic: 'produit',
    freeText: 'facultatif',
    blocking: false,
    links: [{ kind: 'issue', number: 474 }],
    askedBy: { kind: 'issue', number: 474 },
    source: 'issue',
    askedMinutesAgo: 500,
    answer: { status: 'refuse', optionId: 'fr', createdMinutesAgo: 90, reason: 'Option inconnue : l’agent a changé les options entre-temps.' },
  },
  {
    id: '200-ordre-matchs',
    projectId: 'treizero',
    kind: 'choix',
    question: 'Trier les matchs par date ou par terrain ?',
    context: ['La liste des matchs du week-end devient longue.'],
    options: [
      { id: 'date', label: 'Par date' },
      { id: 'terrain', label: 'Par terrain' },
    ],
    recommended: 'date',
    reversible: true,
    topic: 'produit',
    freeText: 'facultatif',
    blocking: false,
    links: [{ kind: 'issue', number: 200 }],
    askedBy: { kind: 'session', id: 'tre-204' },
    source: 'session',
    askedMinutesAgo: 400,
    answer: {
      status: 'fait',
      optionId: 'date',
      text: 'Par date, et regroupe par jour avec un intertitre.',
      createdMinutesAgo: 300,
      doneMinutesAgo: 240,
      result: 'Transmis à la session',
    },
  },
  {
    id: '196-couleur-equipes',
    projectId: 'treizero',
    kind: 'choix',
    question: 'Garder une couleur par équipe sur le tableau ?',
    context: ['Les couleurs actuelles se confondent pour certaines personnes.'],
    options: yesNo(),
    reversible: true,
    topic: 'produit',
    freeText: 'facultatif',
    blocking: false,
    links: [{ kind: 'issue', number: 196 }],
    askedBy: { kind: 'issue', number: 196 },
    source: 'issue',
    askedMinutesAgo: 5000,
    answer: {
      status: 'fait',
      optionId: 'non',
      text: 'Non : un motif et le nom de l’équipe suffisent.',
      createdMinutesAgo: 4400,
      doneMinutesAgo: 4300,
      result: "Posé sur l'issue #196",
    },
  },
];

/** Décisions fictives, dates calculées à partir de `now`. */
export function mockDecisions(now = Date.now()): Decision[] {
  return base.map(({ askedMinutesAgo, answer, ...d }) => {
    const decision: Decision = { ...d, askedAt: ago(askedMinutesAgo, now) };
    if (answer) {
      const { createdMinutesAgo, doneMinutesAgo, ...rest } = answer;
      decision.answer = {
        ...rest,
        createdAt: ago(createdMinutesAgo, now),
        ...(doneMinutesAgo !== undefined ? { doneAt: ago(doneMinutesAgo, now) } : {}),
      };
    }
    return decision;
  });
}
