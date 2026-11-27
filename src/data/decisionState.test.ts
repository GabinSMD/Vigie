import type { Decision } from './api';
import { compareDecisions, decisionView, isOneTap, needsYou, orderedOptions } from './decisionState';
import { mockDecisions } from './mockDecisions';
import { initialState, reducer } from './store';

const base: Decision = {
  id: '1-base',
  projectId: 'p',
  kind: 'choix',
  question: 'Q ?',
  context: ['C'],
  options: [
    { id: 'oui', label: 'Oui' },
    { id: 'non', label: 'Non' },
  ],
  reversible: true,
  topic: 'technique',
  freeText: 'non',
  blocking: false,
  links: [],
  askedAt: '2026-11-24T10:00:00Z',
  askedBy: { kind: 'issue', number: 1 },
  source: 'issue',
};

describe('tri (§ 3.1)', () => {
  it('bloquante, puis domaine sensible, puis la plus ancienne', () => {
    const recent = { ...base, id: 'recent', askedAt: '2026-11-24T12:00:00Z' };
    const old = { ...base, id: 'old', askedAt: '2026-11-24T08:00:00Z' };
    const money = { ...base, id: 'money', topic: 'argent' as const, askedAt: '2026-11-24T13:00:00Z' };
    const blocking = { ...base, id: 'blocking', blocking: true, askedAt: '2026-11-24T14:00:00Z' };
    expect([recent, money, old, blocking].sort(compareDecisions).map((d) => d.id)).toEqual(['blocking', 'money', 'old', 'recent']);
  });
});

describe('forme de la carte', () => {
  it('un tap seulement pour un oui/non sans texte et réversible (D13)', () => {
    expect(isOneTap(base)).toBe(true);
    expect(isOneTap({ ...base, reversible: false })).toBe(false);
    expect(isOneTap({ ...base, freeText: 'facultatif' })).toBe(false);
    expect(isOneTap({ ...base, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] })).toBe(false);
  });

  it('la recommandée passe en premier', () => {
    const d = { ...base, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], recommended: 'c' };
    expect(orderedOptions(d).map((o) => o.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('état (§ 3.3)', () => {
  it.each([
    [undefined, 'attente', false],
    ['en_attente', 'envoyee', true],
    ['pris', 'envoyee', false],
    ['fait', 'repondu', false],
    ['expire', 'expiree', false],
    ['refuse', 'refusee', false],
  ] as const)('ordre %s → %s', (status, phase, editable) => {
    const d = status ? { ...base, answer: { status, optionId: 'oui', createdAt: base.askedAt, expiresAt: base.askedAt } } : base;
    expect(decisionView(d)).toMatchObject({ phase, editable });
  });

  it('une réponse locale passe avant l’ordre connu', () => {
    const d = { ...base, answer: { status: 'expire' as const, optionId: 'oui', createdAt: base.askedAt, expiresAt: base.askedAt } };
    expect(decisionView(d, { optionId: 'non', at: '2026-11-24T15:00:00Z' })).toMatchObject({
      phase: 'envoyee',
      answer: { optionId: 'non', expiresAt: '2026-11-24T18:00:00.000Z' },
    });
  });

  it('l’ordre renvoyé par le Worker pendant la visite passe avant celui du chargement', () => {
    const d = { ...base, answer: { status: 'expire' as const, optionId: 'oui', createdAt: base.askedAt, expiresAt: base.askedAt } };
    const sent = { id: 'ord_X', status: 'en_attente' as const, optionId: 'non', createdAt: '2026-11-24T15:00:00Z', expiresAt: '2026-11-24T18:00:00Z' };
    expect(decisionView(d, undefined, sent)).toMatchObject({ phase: 'envoyee', editable: true, answer: { optionId: 'non' } });
  });

  it('attendent encore toi : en attente, expirée, refusée', () => {
    expect(['attente', 'envoyee', 'repondu', 'expiree', 'refusee'].filter((p) => needsYou(p as never))).toEqual(['attente', 'expiree', 'refusee']);
  });
});

describe('données fictives', () => {
  it('couvrent chaque cas et chaque état', () => {
    const all = mockDecisions(Date.parse('2026-11-24T14:00:00Z'));
    const phases = new Set(all.map((d) => decisionView(d).phase));
    expect([...phases].sort()).toEqual(['attente', 'envoyee', 'expiree', 'refusee', 'repondu']);
    expect(all.some(isOneTap)).toBe(true);
    expect(all.some((d) => d.recommended && !isOneTap(d))).toBe(true);
    expect(all.some((d) => d.freeText === 'obligatoire')).toBe(true);
    expect(all.some((d) => !d.reversible)).toBe(true);
    expect(all.some((d) => d.blocking)).toBe(true);
    expect(all.some((d) => d.kind === 'action')).toBe(true);
    expect(all.some((d) => d.kind === 'validation')).toBe(true);
    expect(all.some((d) => d.options.length > 3)).toBe(true);
  });
});

describe('store : réponses locales', () => {
  it('envoie, annule depuis le toast, et ne garde jamais un secret', () => {
    let s = reducer(initialState, { type: 'answer', itemId: 'x', optionId: 'oui', undoable: true, at: '2026-11-24T14:00:00Z' });
    expect(s.answers.x).toEqual({ optionId: 'oui', at: '2026-11-24T14:00:00Z' });
    expect(s.undo).toBe('x');
    s = reducer(s, { type: 'undoAnswer', itemId: 'x' });
    expect(s.answers.x).toBeUndefined();
    expect(s.toast).toBe('Réponse annulée.');
    s = reducer(s, { type: 'answer', itemId: 'y', optionId: 'a', text: 'password=hunter2' });
    expect(s.answers.y).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain('hunter2');
  });

  it('un autre toast retire le bouton « Annuler »', () => {
    let s = reducer(initialState, { type: 'answer', itemId: 'x', optionId: 'oui', undoable: true });
    s = reducer(s, { type: 'merge', prNumber: '#1' });
    expect(s.undo).toBeNull();
  });
});
