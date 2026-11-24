import type { ReactNode } from 'react';

interface Props {
  className?: string;
  /** Données réelles : l'action n'existe pas encore, le bouton est désactivé et le dit. */
  live: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  children: ReactNode;
}

/** Bouton d'action : actif en démo ; en données réelles, désactivé avec « Bientôt » (étape 1 : lecture seule). */
export function ActionButton({ className = 'btn', live, disabled, onClick, type = 'button', children }: Props) {
  if (live) {
    return (
      <button type={type} className={className} disabled>
        {children} · Bientôt
      </button>
    );
  }
  return (
    <button type={type} className={className} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
