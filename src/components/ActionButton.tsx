import type { ReactNode } from 'react';

interface Props {
  className?: string;
  /** Données réelles : l'action n'existe pas encore, le bouton est désactivé et le dit. */
  live: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  /** Id du texte qui explique pourquoi le bouton est désactivé. */
  describedBy?: string;
  children: ReactNode;
}

/** Bouton d'action : actif en démo ; en données réelles, désactivé avec « Bientôt » (étape 1 : lecture seule). */
export function ActionButton({ className = 'btn', live, disabled, onClick, type = 'button', describedBy, children }: Props) {
  if (live) {
    return (
      <button type={type} className={className} disabled aria-describedby={describedBy}>
        {children} · Bientôt
      </button>
    );
  }
  return (
    <button type={type} className={className} disabled={disabled} onClick={onClick} aria-describedby={describedBy}>
      {children}
    </button>
  );
}
