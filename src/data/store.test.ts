import { initialState, reducer, remainingSessions } from './store';

describe('store : réglages et lancement', () => {
  it('borne les plafonds et le seuil', () => {
    let s = reducer(initialState, { type: 'settings', patch: { sessionCap: 0, costCap: 500, threshold: 20 } });
    expect(s.settings).toMatchObject({ sessionCap: 1, costCap: 100, threshold: 50 });
    s = reducer(s, { type: 'projectCap', projectId: 'treizero', cap: 0 });
    expect(s.settings.projectCaps.treizero).toBe(1);
  });

  it('refuse de lancer au-delà du plafond du jour', () => {
    const full = { ...initialState, sessionsToday: initialState.settings.sessionCap };
    expect(remainingSessions(full)).toBe(0);
    const next = reducer(full, { type: 'launch', session: { projectId: 'ecole-saas', role: 'Développeur', what: 'Issue #450' } });
    expect(next.sessionsToday).toBe(full.sessionsToday);
    expect(next.launched).toHaveLength(0);
    expect(next.toast).toBe('Plafond du jour atteint : session non lancée.');
  });

  it('active puis retire la fusion automatique sans doublon', () => {
    let s = reducer(initialState, { type: 'autoMerge', projectId: 'treizero', on: true });
    s = reducer(s, { type: 'autoMerge', projectId: 'treizero', on: true });
    expect(s.settings.autoMerge).toEqual(['treizero']);
    s = reducer(s, { type: 'autoMerge', projectId: 'treizero', on: false });
    expect(s.settings.autoMerge).toEqual([]);
  });
});
