import type { Status } from '../data/types';

const defaultLabel: Record<Status, string | undefined> = {
  ok: 'OK',
  attention: 'Attention',
  bloque: 'Bloqué',
  neutre: undefined,
};

const className: Record<Status, string> = {
  ok: 'pill p-ok',
  attention: 'pill p-att',
  bloque: 'pill p-blk',
  neutre: 'pill p-neu',
};

/** Icône d'état : ✓ cercle coché, ▲ triangle, ■ carré. La pastille neutre n'en a pas. */
function StatusGlyph({ status }: { status: Status }) {
  switch (status) {
    case 'ok':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M5 8.2l2 2 4-4.4" />
        </svg>
      );
    case 'attention':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M8 2l6.5 11.5h-13z" />
          <path d="M8 6.5v3.2M8 11.6v.1" />
        </svg>
      );
    case 'bloque':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
          <path d="M6 6l4 4M10 6l-4 4" />
        </svg>
      );
    case 'neutre':
      return null;
  }
}

/** Icône « envoyé » (↗), pour une pastille neutre qui doit tout de même en porter une. */
function SentGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4.5 11.5l7-7M6 4.5h5.5V10" />
    </svg>
  );
}

interface Props {
  status: Status;
  /** Remplace l'icône d'état : `sent` (↗) pour « Envoyée ». */
  glyph?: 'sent';
  /** Mot affiché. Obligatoire pour l'état neutre (« En cours », « En file »…). */
  label?: string;
  role?: 'status';
}

/** Pastille d'état : couleur + icône + mot, jamais la couleur seule. */
export function StatusPill({ status, label, role, glyph }: Props) {
  const text = label ?? defaultLabel[status];
  if (!text) throw new Error('StatusPill neutre : le libellé est obligatoire.');
  return (
    <span className={className[status]} data-status={status} role={role}>
      {glyph === 'sent' ? <SentGlyph /> : <StatusGlyph status={status} />}
      {text}
    </span>
  );
}
