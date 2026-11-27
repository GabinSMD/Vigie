import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HashRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App, Shell } from '../App';
import type { Decision, DecisionsResponse, ProjetsResponse, SessionsResponse } from '../data/api';
import { buildLiveData } from '../data/live';
import { DataSetProvider } from '../data/source';
import { StoreProvider } from '../data/store';

const go = (hash: string) => {
  window.location.hash = hash;
};
const nav = () => screen.getByRole('navigation', { name: 'Navigation principale' });
const todoNumber = () => Number.parseInt(nav().querySelector('.cnt')?.textContent ?? '', 10);
/** Carte d'une décision, retrouvée par sa question (titre h3). */
const card = (question: string | RegExp) => screen.getByRole('article', { name: question });

describe('Décisions sur la page d’un projet', () => {
  it('la question oui/non apparaît sur treizero avec ses deux boutons', () => {
    go('#/projets/treizero');
    render(<App />);
    const c = card(/La limite de 8 joueurs/);
    expect(c).toHaveTextContent('Décision');
    expect(c).not.toHaveTextContent('treizero ·');
    expect(within(c).getByRole('button', { name: 'Oui' })).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Non' })).toBeInTheDocument();
    expect(within(c).queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('le livrable apparaît sur Waterline, sans le message « Aucune session »', () => {
    go('#/projets/waterline');
    render(<App />);
    const c = card(/Maquette « Amirauté »/);
    expect(c).toHaveTextContent('Livrable');
    expect(within(c).getByRole('button', { name: 'Valider' })).toBeInTheDocument();
    expect(screen.queryByText("Aucune session pour ce projet aujourd'hui.")).not.toBeInTheDocument();
  });

  it('valider depuis le projet passe le livrable en « Envoyée » et le retire du compte de « À faire »', async () => {
    const user = userEvent.setup();
    go('#/projets/waterline');
    render(<App />);
    const before = todoNumber();
    await user.click(within(card(/Maquette « Amirauté »/)).getByRole('button', { name: 'Valider' }));
    const c = card(/Maquette « Amirauté »/);
    expect(within(c).getByText('Envoyée')).toBeInTheDocument();
    expect(c).toHaveTextContent('Ton choix : Valider');
    expect(within(c).queryByRole('button', { name: 'Valider' })).not.toBeInTheDocument();
    expect(todoNumber()).toBe(before - 1);
    expect(screen.getByText('Livrable validé.')).toBeInTheDocument();
  });

  it('une réponse donnée dans le projet se retrouve dans « À faire », et inversement', async () => {
    const user = userEvent.setup();
    go('#/projets/treizero');
    render(<App />);
    await user.click(within(card(/La limite de 8 joueurs/)).getByRole('button', { name: 'Oui' }));
    await user.click(within(nav()).getByRole('link', { name: /À faire/ }));
    const c = card(/La limite de 8 joueurs/);
    expect(within(c).getByText('Envoyée')).toBeInTheDocument();
    expect(within(c).queryByRole('button', { name: 'Oui' })).not.toBeInTheDocument();
  });

  it('un projet sans décision (StreamBox hors sa décision) n’affiche aucune carte en trop', () => {
    go('#/projets/streambox');
    render(<App />);
    expect(screen.getAllByRole('article', { name: /historique/ })).toHaveLength(1);
    expect(screen.queryByText('Livrable')).not.toBeInTheDocument();
  });

  it('un seul bouton plein dans main, et c’est celui de la décision la plus urgente', () => {
    go('#/projets/treizero');
    render(<App />);
    const pri = screen.getByRole('main').querySelectorAll('.btn.pri');
    expect(pri).toHaveLength(1);
    expect(pri[0]).toHaveTextContent('Oui');
  });

  it('la page Projet montre toutes les options, sans « Voir les n options »', () => {
    go('#/projets/waterline');
    render(<App />);
    const c = card('Où héberger le site vitrine ?');
    expect(within(c).getAllByRole('radio')).toHaveLength(4);
    expect(within(c).queryByRole('button', { name: /Voir les/ })).not.toBeInTheDocument();
  });

  it('« Répondues récemment » : 7 jours dans le projet', () => {
    go('#/projets/treizero');
    render(<App />);
    const section = screen.getByRole('region', { name: 'Répondues récemment' });
    expect(within(section).getByRole('article', { name: /Trier les matchs/ })).toBeInTheDocument();
    expect(within(section).getByRole('article', { name: /couleur par équipe/ })).toBeInTheDocument();
  });
});

describe('« En attente de ta réponse » dans « À faire par toi »', () => {
  it('section entre « Bloque un agent » et « À valider », triée (§ 3.1)', () => {
    go('#/');
    render(<App />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Bloque un agent (1)', 'En attente de ta réponse (9)', 'À valider (2)']);
    const section = screen.getByRole('region', { name: /En attente de ta réponse/ });
    const titles = within(section)
      .getAllByRole('article')
      .filter((a) => !a.closest('details'))
      .map((a) => within(a).getByRole('heading', { level: 3 }).textContent);
    /* Bloquante, puis sensibles (argent, données) de la plus ancienne à la plus récente, puis les autres. */
    expect(titles.slice(0, 2)).toEqual(["Supprimer l'historique d'écoute de plus de 2 ans ?", 'Où héberger le site vitrine ?']);
    expect(titles.indexOf('Quelle police pour les titres ?')).toBeLessThan(titles.indexOf("La limite de 8 joueurs s'applique-t-elle à la Coupe de France ?"));
    /* Les envoyées viennent après celles qui t'attendent. */
    expect(titles.at(-1)).toBe('Quel jour envoyer la relance des inscriptions ?');
  });

  it('la décision bloquante est cerclée et dit « Bloque l’agent »', () => {
    go('#/');
    render(<App />);
    const c = card(/historique d'écoute/);
    expect(c).toHaveClass('urgent');
    expect(within(c).getByText("Bloque l'agent")).toBeInTheDocument();
  });

  it('les répondues depuis 24 h sont repliées en fin de section', () => {
    go('#/');
    render(<App />);
    const details = screen.getByText('Répondues depuis 24 h (1)').closest('details') as HTMLElement;
    expect(details).not.toHaveAttribute('open');
    expect(within(details).getByRole('article', { name: /Trier les matchs/ })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: /couleur par équipe/ })).not.toBeInTheDocument();
  });

  it('au-delà de 3 options, seule la recommandée est montrée, puis « Voir les 4 options »', async () => {
    const user = userEvent.setup();
    go('#/');
    render(<App />);
    const c = card('Où héberger le site vitrine ?');
    expect(within(c).getAllByRole('radio')).toHaveLength(1);
    expect(within(c).getByRole('radio')).toHaveTextContent('Recommandé');
    await user.click(within(c).getByRole('button', { name: 'Voir les 4 options' }));
    expect(within(c).getAllByRole('radio')).toHaveLength(4);
  });

  it('un seul bouton plein dans main, celui du blocage', () => {
    go('#/');
    const { container } = render(<App />);
    const pri = container.querySelectorAll('main .btn.pri');
    expect(pri).toHaveLength(1);
    expect(pri[0]).toHaveTextContent('Voir où poser la clé');
  });

  it('hors ligne : les réponses sont désactivées', () => {
    go('#/?etat=horsligne');
    render(<App />);
    expect(within(card(/La limite de 8 joueurs/)).getByRole('button', { name: 'Oui' })).toBeDisabled();
    expect(within(card(/Quel critère/)).getByRole('button', { name: 'Envoyer' })).toBeDisabled();
    expect(within(card(/Quelle police/)).getByRole('button', { name: 'Renvoyer' })).toBeDisabled();
  });
});

describe('La carte de décision', () => {
  beforeEach(() => go('#/projets/ecole-saas'));

  it('options en radiogroup, aucune présélection, recommandée en premier avec mot et étoile', () => {
    render(<App />);
    const c = card(/Quel critère/);
    const group = within(c).getByRole('radiogroup', { name: /Quel critère/ });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    radios.forEach((r) => expect(r).toHaveAttribute('aria-checked', 'false'));
    expect(radios[0]).toHaveTextContent("3 passages verts d'affiléeRecommandé");
    expect(radios[0]!.querySelector('.rec svg')).not.toBeNull();
    expect(radios.filter((r) => r.textContent?.includes('Recommandé'))).toHaveLength(1);
  });

  it('radiogroup au clavier : une seule tabulation, les flèches choisissent', async () => {
    const user = userEvent.setup();
    render(<App />);
    const radios = within(card(/Quel critère/)).getAllByRole('radio');
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    radios[0]!.focus();
    await user.keyboard('{ArrowDown}');
    expect(radios[1]).toHaveFocus();
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(radios[2]).toHaveFocus();
    expect(radios[2]).toHaveAttribute('aria-checked', 'true');
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
    await user.keyboard('{Home}');
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('« Envoyer » désactivé avec la raison écrite, puis envoi : état « Envoyée » et « Modifier »', async () => {
    const user = userEvent.setup();
    render(<App />);
    const c = card(/Quel critère/);
    const send = within(c).getByRole('button', { name: 'Envoyer' });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription('Choisis une option.');
    await user.click(within(c).getAllByRole('radio')[0]!);
    expect(send).toBeEnabled();
    await user.type(within(c).getByLabelText('Précision (facultatif)'), 'Et préviens-moi au premier échec.');
    await user.click(send);
    const after = card(/Quel critère/);
    expect(within(after).getByText('Envoyée')).toBeInTheDocument();
    expect(after).toHaveTextContent("Ton choix : 3 passages verts d'affilée");
    expect(after).toHaveTextContent('Et préviens-moi au premier échec.');
    expect(after).toHaveTextContent(/Le pilote la transmettra à son prochain passage \((demain )?vers \d+ h\)/);
    await user.click(within(after).getByRole('button', { name: 'Modifier' }));
    expect(within(card(/Quel critère/)).getAllByRole('radio')[0]).toHaveAttribute('aria-checked', 'true');
    await user.click(within(card(/Quel critère/)).getByRole('button', { name: 'Garder la réponse envoyée' }));
    expect(within(card(/Quel critère/)).getByText('Envoyée')).toBeInTheDocument();
  });

  it('texte obligatoire : « Envoyer » attend le choix et le texte', async () => {
    const user = userEvent.setup();
    render(<App />);
    const c = card(/Quel nom pour le dépôt/);
    const send = within(c).getByRole('button', { name: 'Envoyer' });
    expect(send).toHaveAccessibleDescription('Choisis une option et écris ta réponse.');
    await user.click(within(c).getByRole('radio', { name: /Un autre nom/ }));
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription('Écris ta réponse : elle est obligatoire.');
    await user.type(within(c).getByLabelText('Ta réponse (obligatoire)'), 'ecole-app');
    expect(send).toBeEnabled();
  });

  it('avertissement permanent sous le champ texte, et un secret n’est jamais envoyé', async () => {
    const user = userEvent.setup();
    render(<App />);
    const c = card(/Quel nom pour le dépôt/);
    const field = within(c).getByLabelText('Ta réponse (obligatoire)');
    expect(field).toHaveAccessibleDescription(/Ne colle jamais de clé, de jeton ni de mot de passe ici/);
    await user.click(within(c).getAllByRole('radio')[0]!);
    await user.type(field, 'token=abc');
    const send = within(c).getByRole('button', { name: 'Envoyer' });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription(/Ressemble à un secret/);
  });

  it('pas de champ texte quand freeText vaut non', () => {
    go('#/projets/treizero');
    render(<App />);
    expect(within(card(/La limite de 8 joueurs/)).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('étiquettes « Réversible » et liens PR / issue en nouvel onglet', () => {
    render(<App />);
    const c = card(/Quel critère/);
    expect(c).toHaveTextContent('↺ Réversible');
    const pr = within(c).getByRole('link', { name: 'PR #470 (nouvel onglet)' });
    expect(pr).toHaveAttribute('href', 'https://github.com/exemple/ecole-saas/pull/470');
    expect(pr).toHaveAttribute('target', '_blank');
    expect(pr).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(within(c).getByRole('link', { name: 'issue #468 (nouvel onglet)' })).toHaveAttribute('href', 'https://github.com/exemple/ecole-saas/issues/468');
  });

  it('kind action : pas de « Recommandé », l’option est seulement en premier', () => {
    go('#/projets/treizero');
    render(<App />);
    const c = card(/Teste la feuille de match/);
    expect(c).toHaveTextContent('Action');
    const radios = within(c).getAllByRole('radio');
    expect(radios[0]).toHaveTextContent('Fait, tout marche');
    expect(c).not.toHaveTextContent('Recommandé');
  });

  it('irréversible : « Envoyer » ouvre une confirmation qui rappelle le choix et le texte', async () => {
    const user = userEvent.setup();
    go('#/projets/streambox');
    render(<App />);
    const c = card(/historique d'écoute/);
    expect(c).toHaveTextContent('⚠ Irréversible');
    await user.click(within(c).getByRole('radio', { name: /Supprimer/ }));
    await user.type(within(c).getByLabelText('Précision (facultatif)'), 'Après la sauvegarde de lundi.');
    await user.click(within(c).getByRole('button', { name: 'Envoyer' }));
    const dialog = screen.getByRole('dialog', { name: 'Envoyer cette réponse ?' });
    expect(dialog).toHaveTextContent('Ton choix : Supprimer');
    expect(dialog).toHaveTextContent('Après la sauvegarde de lundi.');
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(within(card(/historique d'écoute/)).getByText("Bloque l'agent")).toBeInTheDocument();
    await user.click(within(card(/historique d'écoute/)).getByRole('button', { name: 'Envoyer' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Envoyer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(card(/historique d'écoute/)).getByText('Envoyée')).toBeInTheDocument();
  });
});

describe('Oui/non en un tap (D13)', () => {
  afterEach(() => vi.useRealTimers());

  it('un tap envoie, le toast « Annuler » rétablit la question', async () => {
    const user = userEvent.setup();
    go('#/projets/treizero');
    render(<App />);
    const before = todoNumber();
    await user.click(within(card(/La limite de 8 joueurs/)).getByRole('button', { name: 'Oui' }));
    expect(todoNumber()).toBe(before - 1);
    const status = screen.getByText('Réponse envoyée.').closest('[role="status"]') as HTMLElement;
    await user.click(within(status).getByRole('button', { name: 'Annuler' }));
    expect(within(card(/La limite de 8 joueurs/)).getByRole('button', { name: 'Oui' })).toBeInTheDocument();
    expect(todoNumber()).toBe(before);
    expect(screen.getByText('Réponse annulée.')).toBeInTheDocument();
  });

  it('le toast d’annulation reste 5 s, puis disparaît', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    go('#/projets/treizero');
    render(<App />);
    await user.click(within(card(/La limite de 8 joueurs/)).getByRole('button', { name: 'Non' }));
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1100));
    expect(screen.queryByRole('button', { name: 'Annuler' })).not.toBeInTheDocument();
    expect(within(card(/La limite de 8 joueurs/)).getByText('Envoyée')).toBeInTheDocument();
  });
});

describe('États de la carte (§ 3.3)', () => {
  it('En attente : pastille attention « Attend toi »', () => {
    go('#/projets/ecole-saas');
    render(<App />);
    const pill = within(card(/Quel critère/)).getByText('Attend toi');
    expect(pill).toHaveAttribute('data-status', 'attention');
    expect(pill.querySelector('svg')).not.toBeNull();
  });

  it('Envoyée : pastille neutre avec icône, choix et texte en lecture seule, « Modifier »', () => {
    go('#/projets/ecole-saas');
    render(<App />);
    const c = card(/jour envoyer la relance/);
    const pill = within(c).getByText('Envoyée');
    expect(pill).toHaveAttribute('data-status', 'neutre');
    expect(pill.querySelector('svg')).not.toBeNull();
    expect(c).toHaveTextContent('Ton choix : Lundi matin');
    expect(c).toHaveTextContent('Avant 9 h si possible.');
    expect(within(c).queryByRole('radio')).not.toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
  });

  it('Répondu : pastille ok, date, choix, texte et résultat', () => {
    go('#/projets/treizero');
    render(<App />);
    const c = card(/Trier les matchs/);
    expect(within(c).getByText('Répondu')).toHaveAttribute('data-status', 'ok');
    expect(c).toHaveTextContent(/Répondu le \d\d\/\d\d à \d\d h \d\d : Par date/);
    expect(c).toHaveTextContent('regroupe par jour');
    expect(c).toHaveTextContent('Transmis à la session');
    expect(within(c).queryByRole('button')).not.toBeInTheDocument();
  });

  it('Expirée : « Pas partie », heure limite et « Renvoyer »', async () => {
    const user = userEvent.setup();
    go('#/projets/waterline');
    render(<App />);
    const c = card(/Quelle police/);
    expect(within(c).getByText('Pas partie')).toHaveAttribute('data-status', 'bloque');
    expect(c).toHaveTextContent(/Le pilote ne l'a pas prise avant \d\d h \d\d\./);
    await user.click(within(c).getByRole('button', { name: 'Renvoyer' }));
    expect(within(card(/Quelle police/)).getByText('Envoyée')).toBeInTheDocument();
    expect(card(/Quelle police/)).toHaveTextContent('Ton choix : Sans empattements');
  });

  it('Refusée : la raison, puis « Répondre à nouveau » rouvre les options', async () => {
    const user = userEvent.setup();
    go('#/projets/ecole-saas');
    render(<App />);
    const c = card(/langue par défaut/);
    expect(within(c).getByText('Refusée')).toHaveAttribute('data-status', 'bloque');
    expect(c).toHaveTextContent('Option inconnue');
    await user.click(within(c).getByRole('button', { name: 'Répondre à nouveau' }));
    expect(within(card(/langue par défaut/)).getAllByRole('radio')).toHaveLength(2);
  });
});

/* --- Données réelles : GET /api/decisions simulé --- */

const NOW = new Date('2026-11-24T14:10:00Z');
const projets: ProjetsResponse = {
  generatedAt: NOW.toISOString(),
  projects: [
    { id: 'vigie', owner: 'GabinSMD', repo: 'Vigie', name: 'Vigie', url: 'https://github.com/GabinSMD/Vigie', defaultBranch: 'main', pullRequests: [], issues: [] },
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
        title: 'Session',
        status: 'attention',
        statusLabel: 'Attend ton avis',
        line: 'Question ouverte',
        summary: 'Résumé',
        events: [],
        questions: [{ id: '9-question-instantane', title: 'Question lue dans l’instantané', detail: 'en brouillon', prRef: '#9' }],
      },
    ],
  },
};
const decision: Decision = {
  id: '5-choix-nom',
  projectId: 'vigie',
  kind: 'choix',
  question: 'Quel nom pour la page ?',
  context: ['La PR #6 attend le nom.'],
  options: [
    { id: 'a', label: 'Tableau' },
    { id: 'b', label: 'Tour de contrôle' },
  ],
  recommended: 'b',
  reversible: true,
  topic: 'produit',
  freeText: 'facultatif',
  blocking: false,
  links: [{ kind: 'issue', number: 5 }],
  askedAt: '2026-11-24T12:00:00Z',
  askedBy: { kind: 'issue', number: 5 },
  source: 'issue',
};
const decisions: DecisionsResponse = { generatedAt: NOW.toISOString(), snapshotAt: sessions.snapshotAt, decisions: [decision], errors: [] };

function renderLive(decisionsResponse: DecisionsResponse | null) {
  go('#/');
  return render(
    <DataSetProvider value={buildLiveData(projets, sessions, NOW, decisionsResponse)}>
      <StoreProvider>
        <HashRouter>
          <Shell />
        </HashRouter>
      </StoreProvider>
    </DataSetProvider>,
  );
}

describe('Décisions en données réelles', () => {
  it('lit /api/decisions : carte complète, envoi encore indisponible et expliqué', () => {
    renderLive(decisions);
    const c = card('Quel nom pour la page ?');
    expect(c).toHaveTextContent('Vigie · Décision');
    expect(within(c).getAllByRole('radio')[0]).toHaveTextContent('Tour de contrôleRecommandé');
    const send = within(c).getByRole('button', { name: /Envoyer/ });
    expect(send).toBeDisabled();
    expect(send).toHaveTextContent('Bientôt');
    expect(send).toHaveAccessibleDescription(/réponds sur GitHub/);
    expect(within(c).getByRole('link', { name: 'issue #5 (nouvel onglet)' })).toHaveAttribute('href', 'https://github.com/GabinSMD/Vigie/issues/5');
    /* /api/decisions contient déjà les questions de l'instantané : pas de doublon lu à part. */
    expect(screen.queryByText('Question lue dans l’instantané')).not.toBeInTheDocument();
  });

  it('sans /api/decisions, les questions de l’instantané restent visibles', () => {
    renderLive(null);
    expect(card('Question lue dans l’instantané')).toHaveTextContent('en brouillon');
    expect(screen.queryByText('Quel nom pour la page ?')).not.toBeInTheDocument();
  });
});
