import { formatCap, formatCost, gauge, plural } from './format';

describe('format', () => {
  it('écrit les coûts à la française', () => {
    expect(formatCost(6.35)).toBe('6,35 $');
    expect(formatCap(12)).toBe('12 $');
  });

  it('classe la jauge selon le seuil et le plafond', () => {
    expect(gauge(2.4, 6, 80)).toEqual({ pct: 40, level: 'normal' });
    expect(gauge(5, 6, 80)).toEqual({ pct: 83, level: 'alerte' });
    expect(gauge(7, 6, 80)).toEqual({ pct: 100, level: 'plafond' });
  });

  it('accorde le pluriel', () => {
    expect(plural(1, 'élément')).toBe('1 élément');
    expect(plural(4, 'élément')).toBe('4 éléments');
  });
});
