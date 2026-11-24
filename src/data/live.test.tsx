import { render, screen, within } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import { Shell } from '../App';
import type { ProjetsResponse, SessionsResponse } from './api';
import { buildLiveData } from './live';
import { DataSetProvider } from './source';
import { StoreProvider } from './store';

const NOW = new Date('2026-11-24T14:10:00Z');

const projets: ProjetsResponse = {
  generatedAt: NOW.toISOString(),
  projects: [
    {
      id: 'vigie',
      owner: 'GabinSMD',
      repo: 'Vigie',
      name: 'Vigie',
      url: 'https://github.com/GabinSMD/Vigie',
      defaultBranch: 'main',
      pullRequests: [
        { number: 12, title: 'Ajouter le Worker', draft: false, url: 'https://github.com/GabinSMD/Vigie/pull/12', baseRef: 'main', ci: 'success', checks: [{ name: 'Tests', state: 'success' }] },
        { number: 13, title: 'Brouillon', draft: true, url: 'https://github.com/GabinSMD/Vigie/pull/13', baseRef: 'main', ci: 'pending', checks: [] },
      ],
      issues: [{ number: 5, title: 'Une issue', url: 'https://github.com/GabinSMD/Vigie/issues/5' }],
    },
    {
      id: 'treizero',
      owner: 'GabinSMD',
      repo: 'treizero',
      name: 'treizero',
      url: 'https://github.com/GabinSMD/treizero',
      defaultBranch: null,
      pullRequests: [],
      issues: [],
      error: 'github_403',
    },
  ],
};

const sessions: SessionsResponse = {
  snapshotAt: '2026-11-24T14:02:00Z',
  snapshot: {
    version: 1,
    generatedAt: '2026-11-24T14:02:00Z',
    sessions: [
      {
        id: 's1',
        projectId: 'vigie',
        role: 'Développeur',
        ref: '#10',
        title: 'Lecture seule',
        status: 'attention',
        statusLabel: 'Attend ton avis',
        line: 'Question ouverte',
        summary: 'Résumé',
        waitingFor: 'Choisir le domaine',
        events: [{ kind: 'attente', title: 'Question posée', at: '2026-11-24T13:50:00Z' }],
        costUsd: 1.5,
      },
    ],
  },
};

function renderLive(hash: string) {
  window.location.hash = hash;
  return render(
    <DataSetProvider value={buildLiveData(projets, sessions, NOW)}>
      <StoreProvider>
        <HashRouter>
          <Shell />
        </HashRouter>
      </StoreProvider>
    </DataSetProvider>,
  );
}

describe('buildLiveData', () => {
  it('convertit les dates en « il y a … » et ne garde aucun coût', () => {
    const data = buildLiveData(projets, sessions, NOW);
    expect(data.mode).toBe('live');
    expect(data.sessions[0]!.events[0]!.when).toBe('il y a 20 min');
    expect(JSON.stringify(data)).not.toContain('1.5');
    expect(data.projects.every((p) => p.costToday === 0 && p.costs.length === 0)).toBe(true);
  });

  it('déduit l\'état de la PR et les garde-fous', () => {
    const { pullRequests } = buildLiveData(projets, sessions, NOW);
    expect(pullRequests[0]).toMatchObject({ number: '#12', status: 'ok', statusLabel: 'Prête', guards: ['CI verte', 'Pas en brouillon', 'Branche principale'] });
    expect(pullRequests[1]).toMatchObject({ number: '#13', status: 'neutre', draft: true });
  });
});

describe('données réelles dans l\'app', () => {
  it('À faire : date de l\'instantané, actions désactivées « Bientôt », fusion = lien GitHub', () => {
    renderLive('#/');
    expect(screen.getByText(/Données de 15 h 02/)).toBeInTheDocument();
    const consigne = screen.getByRole('button', { name: /Envoyer une consigne/ });
    expect(consigne).toBeDisabled();
    expect(consigne).toHaveTextContent('Bientôt');
    const link = screen.getByRole('link', { name: /Ouvrir sur GitHub/ });
    expect(link).toHaveAttribute('href', 'https://github.com/GabinSMD/Vigie/pull/12');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('Projets : pas de jauge de coût ; un dépôt illisible est signalé', () => {
    renderLive('#/projets');
    expect(screen.queryByText(/Coût du jour/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ sur \d+ \$/)).not.toBeInTheDocument();
    expect(screen.getByText(/Lecture GitHub impossible : github_403/)).toBeInTheDocument();
  });

  it('Projet : pas d\'onglet Coût', () => {
    renderLive('#/projets/vigie');
    const nav = screen.getByRole('navigation', { name: 'Sections de Vigie' });
    expect(within(nav).queryByText('Coût')).not.toBeInTheDocument();
    expect(within(nav).getByText('Issues')).toBeInTheDocument();
  });

  it('Réglages : lecture seule, aucun montant', () => {
    renderLive('#/reglages');
    expect(screen.getByText('Lecture seule')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Modifier les réglages/ })).toBeDisabled();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});
