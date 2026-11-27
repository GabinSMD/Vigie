import { dateTimeFr, formatCap, formatCost, gauge, nextPilotPassFr, plural } from './format';

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

describe('dates des décisions (heure de Paris)', () => {
  it('« 24/11 à 15 h 05 »', () => {
    expect(dateTimeFr('2026-11-24T14:05:00Z')).toBe('24/11 à 15 h 05');
  });

  it('prochain passage du pilote, de 8 h à 21 h (D6)', () => {
    expect(nextPilotPassFr('2026-11-24T13:20:00Z')).toBe('vers 15 h');
    expect(nextPilotPassFr('2026-11-24T05:00:00Z')).toBe('vers 8 h');
    expect(nextPilotPassFr('2026-11-24T21:30:00Z')).toBe('demain vers 8 h');
  });
});
