import type { ReactNode } from 'react';

interface Props {
  className?: string;
  /** Données réelles : l'action n'existe pas encore, le bouton est désactivé et le dit. */
  live: boolean;
  /** L'action existe aussi en données réelles (réponse à une décision, lot 4) : pas de « Bientôt ». */
  ready?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  /** Id du texte qui explique pourquoi le bouton est désactivé. */
  describedBy?: string;
  children: ReactNode;
}

/** Bouton d'action : actif en démo ; en données réelles, désactivé avec « Bientôt » tant que l'action n'est pas branchée (`ready`). */
export function ActionButton({ className = 'btn', live, ready, disabled, onClick, type = 'button', describedBy, children }: Props) {
  if (live && !ready) {
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
