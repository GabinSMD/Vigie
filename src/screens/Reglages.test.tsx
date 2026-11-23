import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';

const go = (hash: string) => {
  window.location.hash = hash;
};

describe('Réglages', () => {
  it('remplace « Bientôt » et n’a aucun bouton plein', () => {
    go('#/reglages');
    const { container } = render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Réglages' })).toBeInTheDocument();
    expect(screen.queryByText('Cet écran arrive bientôt')).not.toBeInTheDocument();
    expect(container.querySelectorAll('main .btn.pri')).toHaveLength(0);
  });

  it('interrupteurs : role="switch", aria-checked, mot écrit, toute la ligne cliquable', async () => {
    const user = userEvent.setup();
    go('#/reglages');
    render(<App />);
    const push = screen.getByRole('switch', { name: /Notification push/ });
    expect(push).toHaveAttribute('aria-checked', 'true');
    expect(push).toHaveTextContent('Oui');
    await user.click(within(push).getByText('Blocage, PR prête, plafond'));
    expect(push).toHaveAttribute('aria-checked', 'false');
    expect(push).toHaveTextContent('Non');
  });

  it('activer la fusion automatique passe par une confirmation ; la retirer, non', async () => {
    const user = userEvent.setup();
    go('#/reglages');
    render(<App />);
    const eco = screen.getByRole('switch', { name: /^ecole-saas/ });
    expect(eco).toHaveAttribute('aria-checked', 'false');
    expect(eco).toHaveTextContent('Manuelle');

    await user.click(eco);
    const dialog = screen.getByRole('dialog', { name: 'Autoriser la fusion automatique sur ecole-saas ?' });
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(eco).toHaveAttribute('aria-checked', 'false');

    await user.click(eco);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Autoriser' }));
    expect(eco).toHaveAttribute('aria-checked', 'true');
    expect(eco).toHaveTextContent('Auto');
    expect(screen.getByText('Fusion automatique activée pour ecole-saas.')).toBeInTheDocument();

    await user.click(eco);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(eco).toHaveAttribute('aria-checked', 'false');
  });

  it('pas à pas : bornes respectées, boutons nommés', async () => {
    const user = userEvent.setup();
    go('#/reglages');
    render(<App />);
    const minus = screen.getByRole('button', { name: 'Diminuer le plafond de sessions' });
    const group = screen.getByRole('group', { name: 'Sessions lancées' });
    expect(within(group).getByRole('status')).toHaveTextContent('3');
    await user.click(minus);
    await user.click(minus);
    expect(within(group).getByRole('status')).toHaveTextContent('1');
    expect(minus).toBeDisabled();

    const seuilPlus = screen.getByRole('button', { name: "Augmenter le seuil d'alerte" });
    for (let i = 0; i < 4; i++) await user.click(seuilPlus);
    expect(screen.getByText('100 %')).toBeInTheDocument();
    expect(seuilPlus).toBeDisabled();
  });

  it('plafond global rapide et seuil : la ligne de calcul suit', async () => {
    const user = userEvent.setup();
    go('#/reglages');
    render(<App />);
    expect(screen.getByText('80 % = 9,60 $ sur 12 $ (tous projets)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Plafond global 20 dollars' }));
    expect(screen.getByRole('button', { name: 'Plafond global 20 dollars' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('80 % = 16,00 $ sur 20 $ (tous projets)')).toBeInTheDocument();
  });

  it('le plafond d’un projet se reporte sur le projet', async () => {
    const user = userEvent.setup();
    go('#/reglages');
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Augmenter le plafond de ecole-saas' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: 'Projets' }));
    await user.click(screen.getByRole('link', { name: /ecole-saas/ }));
    await user.click(screen.getByRole('link', { name: 'Coût' }));
    expect(screen.getByText('Reste 4,60 $ avant le plafond du projet.')).toBeInTheDocument();
  });

  it('augmenter le plafond de sessions rouvre le lancement', async () => {
    const user = userEvent.setup();
    go('#/reglages');
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Diminuer le plafond de sessions' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: 'Lancer' }));
    expect(screen.getByRole('button', { name: 'Lancer la session' })).toBeDisabled();
  });
});
