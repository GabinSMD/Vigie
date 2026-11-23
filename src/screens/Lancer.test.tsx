import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { initialState } from '../data/store';

const go = (hash: string) => {
  window.location.hash = hash;
};

describe('Lancer du travail', () => {
  it('remplace « Bientôt » : titre, projet, issue et rôle préchoisis', () => {
    go('#/lancer');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Lancer du travail' })).toBeInTheDocument();
    expect(screen.queryByText('Cet écran arrive bientôt')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Depuis une issue' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'ecole-saas' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /#450/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Développeur' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Plafond du jour : 1 session restante')).toBeInTheDocument();
  });

  it('un seul bouton plein', () => {
    go('#/lancer');
    const { container } = render(<App />);
    const primaries = container.querySelectorAll('main .btn.pri');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent('Lancer la session');
  });

  it('lance une session depuis une issue, compte la session et revient à « À faire »', async () => {
    const user = userEvent.setup();
    go('#/lancer');
    render(<App />);
    await user.click(screen.getByRole('button', { name: /#458/ }));
    expect(screen.getByRole('button', { name: /#458/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Relecteur' }));
    await user.click(screen.getByRole('button', { name: 'Lancer la session' }));
    expect(screen.getByRole('heading', { level: 1, name: 'À faire par toi' })).toBeInTheDocument();
    expect(screen.getByText('Session lancée : Relecteur sur ecole-saas.')).toBeInTheDocument();

    await user.click(within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: 'Lancer' }));
    expect(screen.getByText('Plafond atteint : 3 sur 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lancer la session' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Augmente le plafond dans les réglages' })).toHaveAttribute('href', '#/reglages');
  });

  it('texte libre : refuse une consigne vide, rappelle de ne jamais coller de jeton', async () => {
    const user = userEvent.setup();
    go('#/lancer');
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Texte libre' }));
    expect(screen.getByText('Ne colle jamais de clé ni de jeton dans la consigne.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lancer la session' }));
    expect(screen.getByText('Écris une consigne ou dicte-la avant de lancer.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Lancer du travail' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'treizero' }));
    await user.type(screen.getByLabelText('Consigne pour la session'), 'Vérifie la limite de 8 joueurs.');
    await user.click(screen.getByRole('button', { name: 'Lancer la session' }));
    expect(screen.getByText('Session lancée : Développeur sur treizero.')).toBeInTheDocument();
  });

  it('projet sans issue en file : invite à passer en texte libre', async () => {
    const user = userEvent.setup();
    go('#/lancer');
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'StreamBox' }));
    expect(screen.getByText(/Pas d'issue en file pour StreamBox/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lancer la session' }));
    expect(screen.getByText('Choisis une issue, ou passe en texte libre.')).toBeInTheDocument();
  });

  it('depuis l’onglet Issues d’un projet, l’issue est présélectionnée', async () => {
    const user = userEvent.setup();
    go('#/projets/ecole-saas/issues');
    render(<App />);
    await user.click(screen.getAllByRole('link', { name: 'Lancer une session' })[2]);
    expect(screen.getByRole('heading', { level: 1, name: 'Lancer du travail' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /#461/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('plafond déjà atteint au départ', () => {
    go('#/lancer');
    render(<App initialState={{ ...initialState, sessionsToday: 3 }} />);
    expect(screen.getByRole('button', { name: 'Lancer la session' })).toBeDisabled();
  });
});
