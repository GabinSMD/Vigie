import { render, screen } from '@testing-library/react';
import { StatusPill } from './StatusPill';

describe('StatusPill', () => {
  it.each([
    ['ok', 'OK'],
    ['attention', 'Attention'],
    ['bloque', 'Bloqué'],
  ] as const)('état %s : mot écrit et icône présente', (status, word) => {
    const { container } = render(<StatusPill status={status} />);
    expect(screen.getByText(word)).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('accepte un libellé propre à l’état', () => {
    render(<StatusPill status="attention" label="À valider" />);
    expect(screen.getByText('À valider')).toBeInTheDocument();
  });

  it('pastille neutre : un mot, sans icône d’état', () => {
    const { container } = render(<StatusPill status="neutre" label="En cours" />);
    expect(screen.getByText('En cours')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('refuse une pastille neutre sans mot', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<StatusPill status="neutre" />)).toThrow();
  });
});
