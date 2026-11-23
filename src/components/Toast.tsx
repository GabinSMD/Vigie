import { useEffect } from 'react';
import { useStore } from '../data/store';

/** Confirmation brève après une décision ; annoncée aux lecteurs d'écran. */
export function Toast() {
  const { state, dispatch } = useStore();
  useEffect(() => {
    if (!state.toast) return;
    const timer = window.setTimeout(() => dispatch({ type: 'dismissToast' }), 3500);
    return () => window.clearTimeout(timer);
  }, [state.toast, dispatch]);

  return (
    <div role="status" aria-live="polite">
      {state.toast && <div className="toast">{state.toast}</div>}
    </div>
  );
}
