import { NETWORK_ERROR, SESSION_EXPIRED, postOrdre } from './ordres';
import { initialState, reducer } from './store';

const req = { type: 'repondre' as const, projectId: 'vigie', decisionId: '5-choix-nom', optionId: 'a', text: 'Texte' };

describe('postOrdre', () => {
  it('connexion Access expirée (redirection vers la page de connexion) : erreur, rien de refusé', async () => {
    const redirect = { type: 'opaqueredirect', status: 0, json: async () => null } as unknown as Response;
    expect(await postOrdre('/', req, async () => redirect)).toEqual({ kind: 'error', message: SESSION_EXPIRED });
  });

  it('403 : le message du Worker est repris', async () => {
    const response = new Response(JSON.stringify({ error: 'forbidden', message: 'Seule ta connexion personnelle peut répondre.' }), { status: 403 });
    expect(await postOrdre('/', req, async () => response)).toEqual({ kind: 'error', message: 'Seule ta connexion personnelle peut répondre.' });
  });

  it('422 : « Refusée » avec la raison, sans garder le texte', async () => {
    const response = new Response(JSON.stringify({ error: 'secret', message: 'Ne colle jamais…' }), { status: 422 });
    const result = await postOrdre('/', req, async () => response);
    expect(result).toMatchObject({ kind: 'refused', answer: { status: 'refuse', optionId: 'a', reason: 'Ne colle jamais…' } });
    expect(JSON.stringify(result)).not.toContain('Texte');
  });

  it('201 illisible : traité comme une erreur réseau', async () => {
    expect(await postOrdre('/', req, async () => new Response('{}', { status: 201 }))).toEqual({ kind: 'error', message: NETWORK_ERROR });
  });
});

describe('store : réponses du Worker', () => {
  const answer = { id: 'ord_A', status: 'en_attente' as const, optionId: 'oui', createdAt: '2026-11-24T14:00:00Z', expiresAt: '2026-11-24T17:00:00Z' };

  it('« ordre » remplace la réponse locale', () => {
    const local = reducer(initialState, { type: 'answer', itemId: 'dec-x', optionId: 'oui', undoable: true });
    const next = reducer(local, { type: 'ordre', itemId: 'dec-x', answer });
    expect(next.answers).toEqual({});
    expect(next.ordres).toEqual({ 'dec-x': answer });
  });

  it('« answerFailed » retire la réponse locale et le dit', () => {
    const local = reducer(initialState, { type: 'answer', itemId: 'dec-x', optionId: 'oui', undoable: true });
    const next = reducer(local, { type: 'answerFailed', itemId: 'dec-x', message: NETWORK_ERROR });
    expect(next.answers).toEqual({});
    expect(next.toast).toBe(NETWORK_ERROR);
    expect(next.undo).toBeNull();
  });
});
