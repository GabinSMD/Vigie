import type { ReactNode } from 'react';
import type { Status } from '../data/types';
import { StatusPill } from './StatusPill';

interface Props {
  /** Contexte d'une ligne : projet · qui attend quoi. */
  meta: ReactNode;
  status: Status;
  statusLabel?: string;
  title: ReactNode;
  detail?: ReactNode;
  /** Une carte qui bloque un agent est cerclée en Bloqué. */
  urgent?: boolean;
  dim?: boolean;
  children?: ReactNode;
}

/** Ligne de la file « À faire par toi » : un verbe d'action principal + une ligne de contexte. */
export function ActionRow({ meta, status, statusLabel, title, detail, urgent, dim, children }: Props) {
  const classes = ['ar', urgent && 'urgent', dim && 'dim'].filter(Boolean).join(' ');
  return (
    <article className={classes}>
      <div className="row sp">
        <span className="k">{meta}</span>
        <StatusPill status={status} label={statusLabel} />
      </div>
      <h3 className="t">{title}</h3>
      {detail && <p className="det">{detail}</p>}
      {children && <div className="go">{children}</div>}
    </article>
  );
}
