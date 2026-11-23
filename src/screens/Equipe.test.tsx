import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { initialState, type DemoState } from '../data/store';

const go = (hash: string) => {
  window.location.hash = hash;
};

/** Nœud de l'organigramme : l'élément de liste dont le premier libellé est le rôle. */
const node = (role: string) => {
  const label = within(screen.getByRole('region', { name: 'Organigramme' })).getByText(role, { selector: '.k' });
  return label.closest('.node') as HTMLElement;
};

describe('Équipe', () => {
  it('s’ouvre depuis l’en-tête du projet, garde l’état visible et revient au projet', async () => {
    const user = userEvent.setup();
    go('#/projets/ecole-saas');
    render(<App />);
    const header = screen.getByRole('heading', { level: 1, name: 'ecole-saas' }).closest('header') as HTMLElement;
    expect(within(header).getByText('Attention')).toBeInTheDocument();

    await user.click(within(header).getByRole('link', { name: 'Équipe' }));
    expect(window.location.hash).toBe('#/projets/ecole-saas/equipe');
    expect(screen.getByRole('heading', { level: 1, name: 'Équipe' })).toBeInTheDocument();
    expect(screen.getByText('Qui délègue à qui')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'ecole-saas' }));
    expect(screen.getByRole('heading', { level: 1, name: 'ecole-saas' })).toBeInTheDocument();
  });

  it('organigramme en listes imbriquées : Toi → Chef de projet → Développeur et Relecteur', () => {
    go('#/projets/ecole-saas/equipe');
    const { container } = render(<App />);
    const org = within(screen.getByRole('region', { name: 'Organigramme' }));
    const [top] = org.getAllByRole('list');
    const toi = within(top).getAllByRole('listitem')[0];
    expect(toi).toHaveTextContent(/^Toi/);
    const chef = within(toi).getAllByRole('listitem')[0];
    expect(chef).toHaveTextContent(/^Chef de projet/);
    const roles = within(chef).getAllByRole('listitem').map((li) => li.querySelector('.k')?.textContent);
    expect(roles).toEqual(['Développeur', 'Relecteur']);

    expect(node('Toi')).toHaveTextContent('Tu décides, tu valides, tu fusionnes');
    expect(node('Chef de projet')).toHaveTextContent('Suivi des issues');
    expect(node('Développeur')).toHaveTextContent('#450 · #452');
    expect(node('Relecteur')).toHaveTextContent('Relecture de #466');
    /* Pas de prénom en dur, aucun bouton plein. */
    expect(screen.queryByText('Gabin')).not.toBeInTheDocument();
    expect(container.querySelectorAll('main .btn.pri')).toHaveLength(0);
  });

  it('un rôle sans session dans le projet s’affiche quand même', () => {
    go('#/projets/treizero/equipe');
    render(<App />);
    expect(node('Développeur')).toHaveTextContent('#204');
    expect(node('Chef de projet')).toHaveTextContent('Aucune session');
    expect(node('Relecteur')).toHaveTextContent('Aucune session');
  });

  it('les sessions lancées rejoignent leur rôle', () => {
    const state: DemoState = {
      ...initialState,
      launched: [{ projectId: 'treizero', role: 'Relecteur', what: 'Vérifie la limite de 8 joueurs.' }],
    };
    go('#/projets/treizero/equipe');
    render(<App initialState={state} />);
    expect(node('Relecteur')).toHaveTextContent('Vérifie la limite de 8 joueurs.');
  });

  it('les règles d’autonomie suivent les réglages', async () => {
    const user = userEvent.setup();
    go('#/projets/ecole-saas/equipe');
    render(<App />);
    let rules = within(screen.getByRole('region', { name: "Règles d'autonomie" }));
    expect(rules.getByText('Manuelle')).toBeInTheDocument();
    expect(rules.getByText('3 max')).toBeInTheDocument();
    expect(rules.getByText('6 $ max')).toBeInTheDocument();

    await user.click(rules.getByRole('link', { name: 'Modifier les règles' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Réglages' })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: /^ecole-saas/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Autoriser' }));
    await user.click(screen.getByRole('button', { name: 'Augmenter le plafond de sessions' }));

    go('#/projets/ecole-saas/equipe');
    rules = within(await screen.findByRole('region', { name: "Règles d'autonomie" }));
    expect(rules.getByText('Auto')).toBeInTheDocument();
    expect(rules.getByText('4 max')).toBeInTheDocument();
  });

  it('projet inconnu → page introuvable', () => {
    go('#/projets/inconnu/equipe');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Page introuvable' })).toBeInTheDocument();
  });
});
