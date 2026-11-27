import { useEffect } from 'react';
import { useStore } from '../data/store';

/** Durée du toast ; 5 s quand la réponse peut encore être annulée (D13). */
const DURATION = 3500;
const UNDO_DURATION = 5000;

/** Confirmation brève après une décision ; annoncée aux lecteurs d'écran. */
export function Toast() {
  const { state, dispatch } = useStore();
  const { toast, undo } = state;
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => dispatch({ type: 'dismissToast' }), undo ? UNDO_DURATION : DURATION);
    return () => window.clearTimeout(timer);
  }, [toast, undo, dispatch]);

  return (
    <div role="status" aria-live="polite">
      {toast && (
        <div className={undo ? 'toast with-undo' : 'toast'}>
          <span>{toast}</span>
          {undo && (
            <button type="button" className="toast-undo" onClick={() => dispatch({ type: 'undoAnswer', itemId: undo })}>
              Annuler
            </button>
          )}
        </div>
      )}
    </div>
  );
}
