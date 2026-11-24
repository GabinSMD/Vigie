import type { ApiCheck, ApiIssue, ApiProject, ApiPullRequest, CiState, ProjetsResponse } from '../../src/data/api';
import type { GithubClient } from './github';

export interface ProjetConfig {
  id: string;
  owner: string;
  repo: string;
  nom: string;
}

interface GhRepo {
  default_branch: string;
  html_url: string;
}
interface GhPull {
  number: number;
  title: string;
  draft: boolean;
  html_url: string;
  base: { ref: string };
  head: { sha: string };
}
interface GhCheckRuns {
  check_runs: { name: string; status: string; conclusion: string | null }[];
}
interface GhIssue {
  number: number;
  title: string;
  html_url: string;
  pull_request?: unknown;
}

const OK = new Set(['success', 'neutral', 'skipped']);

/** État d'un check-run : réussi, en échec, ou en cours (pas fini). */
export function checkState(run: { status: string; conclusion: string | null }): CiState {
  if (run.status !== 'completed') return 'pending';
  return run.conclusion && OK.has(run.conclusion) ? 'success' : 'failure';
}

/** CI globale : un échec l'emporte, puis un check en cours ; sans check, « none ». */
export function overallCi(checks: ApiCheck[]): CiState {
  if (checks.length === 0) return 'none';
  if (checks.some((c) => c.state === 'failure')) return 'failure';
  if (checks.some((c) => c.state === 'pending')) return 'pending';
  return 'success';
}

async function readProject(gh: GithubClient, p: ProjetConfig): Promise<ApiProject> {
  const base = `/repos/${p.owner}/${p.repo}`;
  const [repo, pulls, issues] = await Promise.all([
    gh.get<GhRepo>(p.owner, base),
    gh.get<GhPull[]>(p.owner, `${base}/pulls?state=open&per_page=30`),
    gh.get<GhIssue[]>(p.owner, `${base}/issues?state=open&per_page=50`),
  ]);
  const pullRequests: ApiPullRequest[] = await Promise.all(
    pulls.map(async (pr) => {
      const runs = await gh.get<GhCheckRuns>(p.owner, `${base}/commits/${pr.head.sha}/check-runs?per_page=50`);
      const checks: ApiCheck[] = runs.check_runs.map((r) => ({ name: r.name, state: checkState(r) }));
      return { number: pr.number, title: pr.title, draft: pr.draft, url: pr.html_url, baseRef: pr.base.ref, ci: overallCi(checks), checks };
    }),
  );
  const apiIssues: ApiIssue[] = issues
    .filter((i) => !i.pull_request)
    .map((i) => ({ number: i.number, title: i.title, url: i.html_url }));
  return {
    id: p.id,
    owner: p.owner,
    repo: p.repo,
    name: p.nom,
    url: repo.html_url,
    defaultBranch: repo.default_branch,
    pullRequests,
    issues: apiIssues,
  };
}

/** Un dépôt en échec n'empêche pas les autres : il revient avec `error` et des listes vides. */
export async function readProjects(gh: GithubClient, config: ProjetConfig[], now: Date): Promise<ProjetsResponse> {
  const projects = await Promise.all(
    config.map((p) =>
      readProject(gh, p).catch(
        (error: unknown): ApiProject => ({
          id: p.id,
          owner: p.owner,
          repo: p.repo,
          name: p.nom,
          url: `https://github.com/${p.owner}/${p.repo}`,
          defaultBranch: null,
          pullRequests: [],
          issues: [],
          error: error instanceof Error ? error.message : 'erreur inconnue',
        }),
      ),
    ),
  );
  return { generatedAt: now.toISOString(), projects };
}
