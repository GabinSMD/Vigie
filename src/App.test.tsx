import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

const go = (hash: string) => {
  window.location.hash = hash;
};

describe('À faire par toi', () => {
  it('liste les décisions en attente, un seul bouton principal', () => {
    const { container } = render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'À faire par toi' })).toBeInTheDocument();
    expect(screen.getByText('5 éléments · 1 bloque un agent')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bloque un agent (1)' })).toBeInTheDocument();
    expect(container.querySelectorAll('main .btn.pri')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Voir où poser la clé' })).toHaveClass('pri');
  });

  it('fusionner passe par une feuille de confirmation, puis retire la PR', async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = screen.getByRole('button', { name: 'Fusionner' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Fusionner #466 ?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'Fusionner #466' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Passer à Node 24')).not.toBeInTheDocument();
    expect(screen.getByText('4 éléments · 1 bloque un agent')).toBeInTheDocument();
    expect(screen.getByText('#466 fusionnée.')).toBeInTheDocument();
  });

  it('Échap ferme la feuille et rend le focus au déclencheur', async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = screen.getByRole('button', { name: 'Voir où poser la clé' });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Poser la clé API Last.fm' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('n’affiche jamais de valeur de clé, seulement où la poser', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Voir où poser la clé' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Ne la colle jamais dans le chat');
  });

  it.each([
    ['chargement', 'Chargement en cours…'],
    ['vide', "Rien n'attend ta décision"],
    ['horsligne', 'Pas de réseau. Les actions sont désactivées.'],
    ['erreur', 'treizero : accès GitHub refusé'],
  ])('état %s', (etat, text) => {
    go(`#/?etat=${etat}`);
    render(<App />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('hors ligne : les actions sont désactivées', () => {
    go('#/?etat=horsligne');
    render(<App />);
    expect(screen.getByRole('button', { name: 'Fusionner' })).toBeDisabled();
    expect(screen.getByText('Non envoyée')).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('quatre onglets, l’actif porte aria-current', () => {
    go('#/projets');
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
    expect(within(nav).getByRole('link', { name: 'Projets' })).toHaveAttribute('aria-current', 'page');
  });

  it('projet : onglets Sessions, PR, Issues, Coût', async () => {
    const user = userEvent.setup();
    go('#/projets/ecole-saas');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'ecole-saas' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Coût' }));
    expect(screen.getByText('Reste 3,60 $ avant le plafond du projet.')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'PR' }));
    expect(screen.getByText("Correctif d'accessibilité")).toBeInTheDocument();
  });

  it('session : envoyer une consigne la fait repartir', async () => {
    const user = userEvent.setup();
    go('#/projets/ecole-saas/sessions/eco-450');
    render(<App />);
    expect(screen.getByText('Attendu de toi')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Envoyer une consigne' }));
    await user.click(screen.getByRole('button', { name: 'Envoyer la consigne' }));
    expect(screen.queryByText('Attendu de toi')).not.toBeInTheDocument();
    expect(screen.getByText('Consigne envoyée : Pousse la branche.')).toBeInTheDocument();
    expect(screen.getByText("Envoyé, à l'instant")).toBeInTheDocument();
  });

  it('session déconnectée', () => {
    go('#/projets/streambox/sessions/stream-lastfm');
    render(<App />);
    expect(screen.getByText('La session ne répond plus')).toBeInTheDocument();
    expect(screen.getByText('Déconnectée')).toBeInTheDocument();
  });

  it('lien inconnu : page introuvable', () => {
    go('#/projets/inconnu');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Page introuvable' })).toBeInTheDocument();
  });
});
