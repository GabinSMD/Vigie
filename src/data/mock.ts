import { toDecisionItem } from './decisionState';
import { mockDecisions } from './mockDecisions';
import type { ActionItem, Project, PullRequest, Session } from './types';

/*
 * Données fictives tirées des maquettes validées.
 * Aucune donnée réelle, aucun secret, aucun jeton : un blocage « clé API »
 * dit seulement où poser la clé.
 */

export const DAILY_SESSION_CAP = 3;
export const SESSIONS_TODAY = 2;
export const GLOBAL_COST_CAP = 12;
/** Seuil d'alerte des jauges de coût, en pourcentage du plafond. */
export const COST_ALERT_THRESHOLD = 80;

export const sessions: Session[] = [
  {
    id: 'eco-450',
    projectId: 'ecole-saas',
    role: 'Développeur',
    ref: '#450',
    title: "Session de l'issue #450",
    status: 'attention',
    statusLabel: 'Attend ton avis',
    line: 'Le code est prêt, la branche reste à pousser.',
    summary:
      'Le code est prêt en local. La session attend que la branche soit poussée sur GitHub pour ouvrir la PR.',
    waitingFor: 'Pousser la branche, ou dire à la session quoi faire.',
    events: [
      { kind: 'attente', title: 'En attente de la branche', when: 'il y a 12 min' },
      { kind: 'reussi', title: 'Tests locaux réussis', when: 'il y a 40 min' },
      { kind: 'fait', title: 'Modifications écrites', when: 'il y a 1 h 05' },
      { kind: 'fait', title: "Session lancée depuis l'issue #450", when: 'il y a 1 h 30' },
    ],
  },
  {
    id: 'eco-452',
    projectId: 'ecole-saas',
    role: 'Développeur',
    ref: '#452',
    title: '#452 Node 24',
    status: 'ok',
    statusLabel: 'Terminée',
    line: 'Passage à Node 24 fait, CI verte.',
    summary: 'Passage de l’application à Node 24. Les tests passent sur la CI.',
    linkedPr: '#466',
    events: [
      { kind: 'reussi', title: 'CI verte sur la PR #466', when: 'il y a 2 h' },
      { kind: 'fait', title: 'PR #466 ouverte', when: 'il y a 2 h 20' },
    ],
  },
  {
    id: 'eco-review',
    projectId: 'ecole-saas',
    role: 'Relecteur',
    title: 'Relecture de #466',
    status: 'neutre',
    statusLabel: 'En cours',
    line: 'Vérifie les changements de dépendances.',
    summary: 'Relit les changements de dépendances de la PR #466.',
    events: [{ kind: 'fait', title: 'Relecture commencée', when: 'il y a 30 min' }],
  },
  {
    id: 'eco-pm',
    projectId: 'ecole-saas',
    role: 'Chef de projet',
    title: 'Suivi des issues',
    status: 'neutre',
    statusLabel: 'En veille',
    line: '2 issues en file, aucune urgence.',
    summary: 'Suit les issues en file du projet.',
    events: [{ kind: 'fait', title: 'Issues triées', when: 'il y a 3 h' }],
  },
  {
    id: 'stream-lastfm',
    projectId: 'streambox',
    role: 'Développeur',
    title: 'Session StreamBox',
    status: 'bloque',
    statusLabel: 'Déconnectée',
    line: 'Attend une clé API Last.fm.',
    summary: 'En attente d’une clé API Last.fm, à poser dans un fichier sur le serveur.',
    disconnected: { lastSeen: 'il y a 18 min' },
    events: [
      { kind: 'perdu', title: 'Connexion perdue', when: 'il y a 18 min' },
      { kind: 'attente', title: 'En attente de la clé API', when: 'il y a 35 min' },
    ],
  },
  {
    id: 'tre-204',
    projectId: 'treizero',
    role: 'Développeur',
    ref: '#204',
    title: 'Limite de joueurs par équipe',
    status: 'attention',
    statusLabel: 'Attend ton avis',
    line: 'Question ouverte sur la Coupe de France.',
    summary: 'La PR #204 est en brouillon le temps que tu répondes à la question sur la limite de 8 joueurs.',
    waitingFor: 'Répondre à la question sur la Coupe de France.',
    events: [{ kind: 'attente', title: 'Question posée', when: 'il y a 25 min' }],
  },
];

export const pullRequests: PullRequest[] = [
  {
    number: '#466',
    projectId: 'ecole-saas',
    title: 'Passer à Node 24',
    status: 'ok',
    statusLabel: 'Prête',
    line: 'CI verte · pas en brouillon',
    summary: "Passage de l'application à Node 24. Les tests passent sur la CI.",
    sessionRef: 'eco-452',
    checks: [
      { label: 'Tests', status: 'ok', statusLabel: 'Réussis' },
      { label: 'Construction', status: 'ok', statusLabel: 'Réussie' },
    ],
    guards: ['CI verte', 'Pas en brouillon', 'Branche principale'],
    draft: false,
  },
  {
    number: '#204',
    projectId: 'treizero',
    title: 'Limite de joueurs par équipe',
    status: 'neutre',
    statusLabel: 'Brouillon',
    line: 'En brouillon · attend ta réponse',
    summary: 'Applique la limite de 8 joueurs. Reste en brouillon tant que la question n’est pas tranchée.',
    sessionRef: 'tre-204',
    checks: [{ label: 'Tests', status: 'ok', statusLabel: 'Réussis' }],
    guards: ['CI verte'],
    draft: true,
  },
];

export const projects: Project[] = [
  {
    id: 'streambox',
    url: 'https://github.com/exemple/streambox',
    name: 'StreamBox',
    status: 'bloque',
    line: '1 session active · 0 PR prête · 2 issues en file',
    costToday: 1.1,
    costCap: 4,
    sessionIds: ['stream-lastfm'],
    prNumbers: [],
    closedPrs: [],
    issues: [],
    costs: [{ title: 'Session StreamBox', detail: 'Développeur', amount: 1.1 }],
  },
  {
    id: 'ecole-saas',
    url: 'https://github.com/exemple/ecole-saas',
    name: 'ecole-saas',
    status: 'attention',
    line: '1 PR prête · 2 issues en file, 1 en cours · 1 attend ton avis',
    costToday: 2.4,
    costCap: 6,
    sessionIds: ['eco-450', 'eco-452', 'eco-review', 'eco-pm'],
    prNumbers: ['#466'],
    closedPrs: [
      { number: '#463', title: "Correctif d'accessibilité", when: 'Fusionnée hier', merged: true },
      { number: '#459', title: 'Essai de nouveau thème', when: 'Fermée il y a 3 jours', merged: false },
    ],
    issues: [
      { number: '#450', title: 'Mise à jour des dépendances' },
      { number: '#458', title: 'Page de connexion lente' },
      { number: '#461', title: "Textes de l'aide à relire" },
    ],
    costs: [
      { title: '#452 Node 24', detail: 'Développeur · terminée', amount: 1.45 },
      { title: "Session de l'issue #450", detail: 'Développeur', amount: 0.6 },
      { title: 'Relecture de #466', detail: 'Relecteur', amount: 0.25 },
      { title: 'Suivi des issues', detail: 'Chef de projet', amount: 0.1 },
    ],
  },
  {
    id: 'treizero',
    url: 'https://github.com/exemple/treizero',
    name: 'treizero',
    status: 'attention',
    line: '1 session active · 1 PR en brouillon · 4 issues en file',
    costToday: 0.85,
    costCap: 4,
    sessionIds: ['tre-204'],
    prNumbers: ['#204'],
    closedPrs: [],
    issues: [],
    costs: [{ title: 'Limite de joueurs par équipe', detail: 'Développeur', amount: 0.85 }],
  },
  {
    id: 'waterline',
    url: 'https://github.com/exemple/waterline',
    name: 'Waterline',
    status: 'attention',
    statusLabel: 'À valider',
    line: 'Maquette « Amirauté » livrée, validation attendue.',
    costToday: 0.3,
    costCap: 3,
    sessionIds: [],
    prNumbers: [],
    closedPrs: [],
    issues: [],
    costs: [{ title: 'Maquette « Amirauté »', detail: 'Designer · terminée', amount: 0.3 }],
  },
];

export const actionItems: ActionItem[] = [
  {
    kind: 'blocage',
    id: 'blk-lastfm',
    projectId: 'streambox',
    sessionId: 'stream-lastfm',
    title: 'Attend une clé API Last.fm',
    detail: 'À poser dans un fichier sur le serveur, jamais dans le chat.',
  },
  { kind: 'session', id: 'ses-450', projectId: 'ecole-saas', sessionId: 'eco-450', title: 'Attend la branche à pousser' },
  {
    kind: 'pr',
    id: 'pr-466',
    projectId: 'ecole-saas',
    prNumber: '#466',
    title: 'Passer à Node 24',
    detail: 'Prête à fusionner · pas en brouillon',
  },
  ...mockDecisions().map(toDecisionItem),
];

export const findProject = (id: string | undefined) => projects.find((p) => p.id === id);
export const findSession = (id: string | undefined) => sessions.find((s) => s.id === id);
/** Les numéros de PR sont stockés avec « # » ; l'URL porte le nombre seul. */
export const findPullRequest = (projectId: string | undefined, num: string | undefined) =>
  pullRequests.find((pr) => pr.projectId === projectId && pr.number === `#${num}`);

export const totalCostToday = () => projects.reduce((sum, p) => sum + p.costToday, 0);
