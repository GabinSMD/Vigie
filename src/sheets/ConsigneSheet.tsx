import { useEffect, useId, useState } from 'react';
import { ActionSheet } from '../components/ActionSheet';
import { findSession } from '../data/mock';
import { useStore } from '../data/store';

interface Props {
  sessionId: string | null;
  onClose: () => void;
}

const SUGGESTION = 'Pousse la branche.';

export function ConsigneSheet({ sessionId, onClose }: Props) {
  const { dispatch } = useStore();
  const session = findSession(sessionId ?? undefined);
  const [text, setText] = useState(SUGGESTION);
  const fieldId = useId();

  useEffect(() => {
    if (sessionId) setText(SUGGESTION);
  }, [sessionId]);

  const trimmed = text.trim();

  return (
    <ActionSheet open={Boolean(session)} title="Envoyer une consigne" onClose={onClose}>
      {session && (
        <form
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed) return;
            dispatch({ type: 'consigne', sessionId: session.id, text: trimmed });
            onClose();
          }}
        >
          <p className="det">
            {session.role} · {session.title}
          </p>
          <label className="label" htmlFor={fieldId}>
            Consigne pour la session
          </label>
          <textarea id={fieldId} className="field" value={text} onChange={(e) => setText(e.target.value)} data-autofocus />
          <p className="det">N'écris jamais de clé ni de mot de passe ici.</p>
          <button type="submit" className="btn pri big full" disabled={!trimmed}>
            Envoyer la consigne
          </button>
          <button type="button" className="btn full" onClick={onClose}>
            Annuler
          </button>
        </form>
      )}
    </ActionSheet>
  );
}
