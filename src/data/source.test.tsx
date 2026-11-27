import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { DataProvider, useData } from './source';

function Mode() {
  const data = useData();
  return <p>{data.loading ? 'chargement' : `${data.mode} ${data.projects.length}`}</p>;
}

const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('DataProvider', () => {
  it('reste sur les données fictives sans URL d\'API, sans appel réseau', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<DataProvider apiUrl={undefined}><Mode /></DataProvider>);
    expect(screen.getByText(/^mock/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepte « / » : l\'API est lue sur la même origine', async () => {
    const fetch = vi.fn(async (url: string) =>
      url === '/api/projets'
        ? respond({ generatedAt: '2026-11-24T14:00:00Z', projects: [] })
        : url === '/api/decisions'
          ? respond({ generatedAt: '2026-11-24T14:00:00Z', snapshotAt: null, decisions: [], errors: [] })
          : respond({ snapshotAt: null, snapshot: null }),
    );
    vi.stubGlobal('fetch', fetch);
    render(<DataProvider apiUrl="/"><Mode /></DataProvider>);
    await waitFor(() => expect(screen.getByText('live 0')).toBeInTheDocument());
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/projets', '/api/sessions', '/api/decisions']);
  });

  it('sans /api/decisions, le reste s\'affiche quand même', async () => {
    const fetch = vi.fn(async (url: string) =>
      url === '/api/projets'
        ? respond({ generatedAt: '2026-11-24T14:00:00Z', projects: [] })
        : url === '/api/decisions'
          ? new Response('{}', { status: 502 })
          : respond({ snapshotAt: null, snapshot: null }),
    );
    vi.stubGlobal('fetch', fetch);
    render(<DataProvider apiUrl="/"><Mode /></DataProvider>);
    await waitFor(() => expect(screen.getByText('live 0')).toBeInTheDocument());
  });
});
