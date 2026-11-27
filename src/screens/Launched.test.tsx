import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { initialState, type DemoState } from '../data/store';

const go = (hash: string) => {
  window.location.hash = hash;
};

const withLaunched: DemoState = {
  ...initialState,
  launched: [
    { projectId: 'treizero', role: 'Relecteur', what: 'Vérifie la limite de 8 joueurs.' },
    { projectId: 'ecole-saas', role: 'Développeur', what: 'Issue #450 : Mise à jour des dépendances' },
  ],
};

describe('Sessions lancées', () => {
  it('« À faire par toi » montre chaque session lancée, en pastille neutre « En cours »', () => {
    go('#/');
    const { container } = render(<App initialState={withLaunched} />);
    const list = screen.getByRole('region', { name: 'Sessions lancées' });
    const cards = within(list).getAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('treizero · Relecteur');
    expect(cards[0]).toHaveTextContent('Vérifie la limite de 8 joueurs.');
    expect(cards[1]).toHaveTextContent('ecole-saas · Développeur');
    expect(cards[1]).toHaveTextContent('Issue #450 : Mise à jour des dépendances');
    for (const card of cards) {
      const pill = card.querySelector('.pill');
      expect(pill).toHaveAttribute('data-status', 'neutre');
      expect(pill).toHaveTextContent('En cours');
      expect(within(card).queryByRole('button')).not.toBeInTheDocument();
      expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    }
    /* Pas une décision : le compteur et le bouton plein ne bougent pas. */
    expect(screen.getByText('12 éléments · 1 bloque un agent')).toBeInTheDocument();
    expect(container.querySelectorAll('main .btn.pri')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Voir où poser la clé' })).toHaveClass('pri');
  });

  it('reste visible quand rien n’attend ta décision', () => {
    go('#/?etat=vide');
    const { container } = render(<App initialState={withLaunched} />);
    expect(screen.getByText('0 élément')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Sessions lancées' })).getAllByRole('article')).toHaveLength(2);
    expect(container.querySelectorAll('main .btn.pri')).toHaveLength(1);
  });

  it('l’onglet Sessions du projet ne montre que ses sessions lancées, sans répéter le projet', () => {
    go('#/projets/ecole-saas/sessions');
    const { container } = render(<App initialState={withLaunched} />);
    const cards = within(screen.getByRole('region', { name: 'Sessions lancées' })).getAllByRole('article');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent('Développeur');
    expect(cards[0]).not.toHaveTextContent('ecole-saas ·');
    expect(cards[0]).toHaveTextContent('Issue #450 : Mise à jour des dépendances');
    expect(cards[0].querySelector('.pill')).toHaveTextContent('En cours');
    expect(container.querySelectorAll('main .btn.pri').length).toBeLessThanOrEqual(1);
  });

  it('un projet sans session existante affiche quand même la session lancée', () => {
    go('#/projets/treizero/sessions');
    render(<App initialState={withLaunched} />);
    expect(screen.queryByText("Aucune session pour ce projet aujourd'hui.")).not.toBeInTheDocument();
    expect(screen.getByText('Vérifie la limite de 8 joueurs.')).toBeInTheDocument();
  });

  it('sans session lancée, rien de plus n’apparaît', () => {
    go('#/');
    render(<App />);
    expect(screen.queryByRole('region', { name: 'Sessions lancées' })).not.toBeInTheDocument();
  });

  it('de bout en bout : lancer depuis une issue l’affiche sur l’accueil et dans le projet', async () => {
    const user = userEvent.setup();
    go('#/lancer');
    render(<App />);
    await user.click(screen.getByRole('button', { name: /#458/ }));
    await user.click(screen.getByRole('button', { name: 'Lancer la session' }));
    const card = within(screen.getByRole('region', { name: 'Sessions lancées' })).getByRole('article');
    expect(card).toHaveTextContent('ecole-saas · Développeur');
    expect(card).toHaveTextContent('Issue #458 : Page de connexion lente');
    expect(screen.getByText('12 éléments · 1 bloque un agent')).toBeInTheDocument();
  });
});
