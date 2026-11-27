import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DecisionsResponse, ProjetsResponse, SessionsResponse } from './api';
import { buildLiveData, type DataSet } from './live';
import { actionItems, projects, pullRequests, sessions } from './mock';

/** Données fictives : comportement par défaut, sans `VITE_API_URL`. */
export const mockData: DataSet = {
  mode: 'mock',
  projects,
  sessions,
  pullRequests,
  actionItems,
  snapshotAt: null,
  loading: false,
  error: null,
};

const emptyLive: DataSet = { ...mockData, mode: 'live', projects: [], sessions: [], pullRequests: [], actionItems: [] };

const DataContext = createContext<DataSet>(mockData);

async function getJson<T>(base: string, path: string): Promise<T> {
  const response = await fetch(`${base.replace(/\/$/, '')}${path}`, { credentials: 'include' });
  if (!response.ok) throw new Error(`${path} : erreur ${response.status}`);
  return (await response.json()) as T;
}

/**
 * Lit l'API si `apiUrl` est défini ; sinon ne fait rien et les données fictives restent.
 * `apiUrl` peut être une adresse complète ou `/` (même origine : le Worker sert l'app et l'API).
 */
export function DataProvider({ children, apiUrl = import.meta.env.VITE_API_URL as string | undefined }: { children: ReactNode; apiUrl?: string }) {
  const [live, setLive] = useState<DataSet>({ ...emptyLive, loading: true });

  useEffect(() => {
    if (!apiUrl) return;
    let cancelled = false;
    Promise.all([
      getJson<ProjetsResponse>(apiUrl, '/api/projets'),
      getJson<SessionsResponse>(apiUrl, '/api/sessions'),
      /* Sans les décisions, le reste s'affiche : les questions sont alors lues dans l'instantané. */
      getJson<DecisionsResponse>(apiUrl, '/api/decisions').catch(() => null),
    ])
      .then(([projets, sess, decisions]) => !cancelled && setLive({ ...buildLiveData(projets, sess, new Date(), decisions), apiUrl }))
      .catch((error: unknown) =>
        !cancelled && setLive({ ...emptyLive, error: error instanceof Error ? error.message : 'Lecture impossible' }),
      );
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  if (!apiUrl) return <>{children}</>;
  return <DataContext.Provider value={live}>{children}</DataContext.Provider>;
}

/** Fournit un jeu de données précis (tests, démos). */
export const DataSetProvider = DataContext.Provider;

export function useData() {
  const data = useContext(DataContext);
  return useMemo(
    () => ({
      ...data,
      /** Vrai en données réelles : actions désactivées (sauf les réponses aux décisions), coûts masqués. */
      live: data.mode === 'live',
      findProject: (id: string | undefined) => data.projects.find((p) => p.id === id),
      findSession: (id: string | undefined) => data.sessions.find((s) => s.id === id),
      /** Les numéros de PR sont stockés avec « # » ; l'URL porte le nombre seul. */
      findPullRequest: (projectId: string | undefined, num: string | undefined) =>
        data.pullRequests.find((pr) => pr.projectId === projectId && pr.number === `#${num}`),
      totalCostToday: () => data.projects.reduce((sum, p) => sum + p.costToday, 0),
    }),
    [data],
  );
}
