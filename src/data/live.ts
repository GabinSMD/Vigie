import { relativeFr } from '../lib/format';
import type { ApiProject, ApiPullRequest, ProjetsResponse, SessionsResponse } from './api';
import type { ActionItem, Project, PullRequest, Session, Status } from './types';

/** Ensemble de données que lit l'app, venu de `mock.ts` ou de l'API. */
export interface DataSet {
  mode: 'mock' | 'live';
  projects: Project[];
  sessions: Session[];
  pullRequests: PullRequest[];
  actionItems: ActionItem[];
  /** Date ISO de l'instantané des sessions ; null en données fictives ou si le pilote n'a rien écrit. */
  snapshotAt: string | null;
  loading: boolean;
  error: string | null;
}

const prStatus = (pr: ApiPullRequest): { status: Status; label: string; line: string } => {
  if (pr.draft) return { status: 'neutre', label: 'Brouillon', line: 'En brouillon' };
  if (pr.ci === 'failure') return { status: 'bloque', label: 'CI en échec', line: 'CI en échec · pas en brouillon' };
  if (pr.ci === 'pending') return { status: 'attention', label: 'CI en cours', line: 'CI en cours · pas en brouillon' };
  if (pr.ci === 'success') return { status: 'ok', label: 'Prête', line: 'CI verte · pas en brouillon' };
  return { status: 'neutre', label: 'Sans CI', line: 'Aucune vérification · pas en brouillon' };
};

const checkLabel = { success: 'Réussie', failure: 'En échec', pending: 'En cours', none: 'Aucune' } as const;
const checkStatus = { success: 'ok', failure: 'bloque', pending: 'attention', none: 'neutre' } as const;

function mapPr(project: ApiProject, pr: ApiPullRequest, sessions: Session[]): PullRequest {
  const number = `#${pr.number}`;
  const { status, label, line } = prStatus(pr);
  const guards: string[] = [];
  if (pr.ci === 'success') guards.push('CI verte');
  if (!pr.draft) guards.push('Pas en brouillon');
  if (project.defaultBranch && pr.baseRef === project.defaultBranch) guards.push('Branche principale');
  return {
    number,
    projectId: project.id,
    title: pr.title,
    status,
    statusLabel: label,
    line,
    summary: pr.draft ? 'PR en brouillon.' : 'PR ouverte sur GitHub. Ouvre-la pour lire le détail.',
    sessionRef: sessions.find((s) => s.linkedPr === number && s.projectId === project.id)?.id,
    checks: pr.checks.map((c) => ({ label: c.name, status: checkStatus[c.state], statusLabel: checkLabel[c.state] })),
    guards,
    draft: pr.draft,
    url: pr.url,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function projectLine(sessions: Session[], prs: PullRequest[], issues: number, error?: string): string {
  if (error) return `Lecture GitHub impossible : ${error}`;
  const waiting = sessions.filter((s) => s.waitingFor).length;
  const parts = [
    plural(sessions.length, 'session', 'sessions'),
    plural(prs.length, 'PR ouverte', 'PR ouvertes'),
    plural(issues, 'issue ouverte', 'issues ouvertes'),
  ];
  if (waiting) parts.push(`${waiting} attend ton avis`);
  return parts.join(' · ');
}

/** Transforme les réponses du Worker en données d'écran. Fonction pure : `now` sert aux « il y a … ». */
export function buildLiveData(
  projets: ProjetsResponse,
  sessionsResponse: SessionsResponse,
  now: Date = new Date(),
): DataSet {
  const snap = sessionsResponse.snapshot;
  const sessions: Session[] = (snap?.sessions ?? []).map((s) => ({
    id: s.id,
    projectId: s.projectId,
    role: s.role,
    ref: s.ref,
    title: s.title,
    status: s.status,
    statusLabel: s.statusLabel,
    line: s.line,
    summary: s.summary,
    waitingFor: s.waitingFor,
    events: s.events.map((e) => ({ kind: e.kind, title: e.title, when: relativeFr(e.at, now) })),
    linkedPr: s.linkedPr,
    disconnected: s.disconnected ? { lastSeen: relativeFr(s.disconnected.lastSeen, now) } : undefined,
  }));

  const pullRequests: PullRequest[] = [];
  const projects: Project[] = projets.projects.map((p) => {
    const own = sessions.filter((s) => s.projectId === p.id);
    const prs = p.pullRequests.map((pr) => mapPr(p, pr, sessions));
    pullRequests.push(...prs);
    const blocked = p.error || own.some((s) => s.disconnected || s.status === 'bloque') || prs.some((pr) => pr.status === 'bloque');
    const attention = own.some((s) => s.waitingFor) || prs.some((pr) => pr.status === 'ok' || pr.status === 'attention');
    return {
      id: p.id,
      name: p.name,
      status: blocked ? 'bloque' : attention ? 'attention' : 'neutre',
      statusLabel: p.error ? 'Illisible' : undefined,
      line: projectLine(own, prs, p.issues.length, p.error),
      costToday: 0,
      costCap: 0,
      sessionIds: own.map((s) => s.id),
      prNumbers: prs.map((pr) => pr.number),
      closedPrs: [],
      issues: p.issues.map((i) => ({ number: `#${i.number}`, title: i.title, url: i.url })),
      costs: [],
      url: p.url,
    };
  });

  const actionItems: ActionItem[] = [];
  for (const s of snap?.sessions ?? []) {
    if (s.disconnected || s.status === 'bloque') {
      actionItems.push({ kind: 'blocage', id: `blk-${s.id}`, projectId: s.projectId, sessionId: s.id, title: s.line, detail: s.summary });
    } else if (s.waitingFor) {
      actionItems.push({ kind: 'session', id: `ses-${s.id}`, projectId: s.projectId, sessionId: s.id, title: s.waitingFor });
    }
    for (const q of s.questions ?? []) {
      actionItems.push({ kind: 'question', id: `q-${q.id}`, projectId: s.projectId, title: q.title, detail: q.detail, prRef: q.prRef });
    }
    for (const d of s.deliverables ?? []) {
      actionItems.push({ kind: 'livrable', id: `liv-${d.id}`, projectId: s.projectId, title: d.title });
    }
  }
  for (const pr of pullRequests) {
    if (pr.status === 'ok') {
      actionItems.push({ kind: 'pr', id: `pr-${pr.projectId}-${pr.number}`, projectId: pr.projectId, prNumber: pr.number, title: pr.title, detail: 'Prête à fusionner · pas en brouillon' });
    }
  }

  return { mode: 'live', projects, sessions, pullRequests, actionItems, snapshotAt: sessionsResponse.snapshotAt, loading: false, error: null };
}
