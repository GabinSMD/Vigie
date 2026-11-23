import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Feuille modale ancrée en bas : role="dialog" + aria-modal, Échap ferme,
 * le focus entre dans la feuille (élément marqué data-autofocus, sinon le premier
 * contrôle), y reste, puis revient au déclencheur à la fermeture.
 */
export function ActionSheet({ open, title, onClose, children }: Props) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');

    const sheet = sheetRef.current;
    const target = sheet?.querySelector<HTMLElement>('[data-autofocus]') ?? sheet?.querySelector<HTMLElement>(FOCUSABLE);
    (target ?? sheet)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !sheet) return;
      const items = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      root?.removeAttribute('inert');
      trigger?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <>
      <button type="button" className="scrim" aria-label="Fermer" tabIndex={-1} onClick={onClose} />
      <div ref={sheetRef} className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="grab" aria-hidden="true" />
        <h2 id={titleId} className="h2">
          {title}
        </h2>
        {children}
      </div>
    </>,
    document.body,
  );
}
