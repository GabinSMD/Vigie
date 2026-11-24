import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';

const go = (hash: string) => {
  window.location.hash = hash;
};
const todoCount = () => screen.getByRole('navigation', { name: 'Navigation principale' }).querySelector('.cnt')?.textContent ?? '';
const todoNumber = () => Number.parseInt(todoCount(), 10);

describe('Décisions sur la page d’un projet', () => {
  it('la question apparaît sur treizero avec ses actions', () => {
    go('#/projets/treizero');
    render(<App />);
    const card = screen.getByText("La limite de 8 joueurs s'applique-t-elle à la Coupe de France ?", { exact: false }).closest('article') as HTMLElement;
    expect(card).toHaveTextContent('Question');
    expect(within(card).getByRole('button', { name: 'Répondre : oui' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Non' })).toBeInTheDocument();
  });

  it('le livrable apparaît sur Waterline, sans le message « Aucune session »', () => {
    go('#/projets/waterline');
    render(<App />);
    expect(screen.getByRole("heading", { level: 3, name: /Maquette « Amirauté »/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Valider' })).toBeInTheDocument();
    expect(screen.queryByText("Aucune session pour ce projet aujourd'hui.")).not.toBeInTheDocument();
  });

  it('valider depuis le projet retire le livrable du projet et de « À faire »', async () => {
    const user = userEvent.setup();
    go('#/projets/waterline');
    render(<App />);
    const before = todoNumber();
    await user.click(screen.getByRole('button', { name: 'Valider' }));
    expect(screen.queryByRole("heading", { level: 3, name: /Maquette « Amirauté »/ })).not.toBeInTheDocument();
    expect(screen.getByText("Aucune session pour ce projet aujourd'hui.")).toBeInTheDocument();
    expect(todoNumber()).toBe(before - 1);
  });

  it('répondre depuis le projet retire la question, et inversement depuis « À faire »', async () => {
    const user = userEvent.setup();
    go('#/projets/treizero');
    render(<App />);
    const before = todoNumber();
    await user.click(screen.getByRole('button', { name: 'Répondre : oui' }));
    expect(screen.queryByRole('button', { name: 'Répondre : oui' })).not.toBeInTheDocument();
    expect(todoNumber()).toBe(before - 1);
    await user.click(within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: /À faire/ }));
    expect(screen.queryByRole('button', { name: 'Répondre : oui' })).not.toBeInTheDocument();
  });

  it('une décision prise dans « À faire » disparaît du projet', async () => {
    const user = userEvent.setup();
    go('#/');
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Valider' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: 'Projets' }));
    await user.click(screen.getByRole('link', { name: /Waterline/ }));
    expect(screen.queryByRole('button', { name: 'Valider' })).not.toBeInTheDocument();
  });

  it('un projet sans décision (StreamBox) n’affiche aucune carte de décision', () => {
    go('#/projets/streambox');
    render(<App />);
    expect(screen.queryByText('Question')).not.toBeInTheDocument();
    expect(screen.queryByText('Livrable')).not.toBeInTheDocument();
  });

  it('un seul bouton plein dans main, et c’est celui de la décision', () => {
    go('#/projets/treizero');
    render(<App />);
    const main = screen.getByRole('main');
    const pri = main.querySelectorAll('.btn.pri');
    expect(pri).toHaveLength(1);
    expect(pri[0]).toHaveTextContent('Répondre : oui');
  });
});
