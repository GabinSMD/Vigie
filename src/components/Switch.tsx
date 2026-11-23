interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  detail?: string;
  /** Mot écrit à côté de l'interrupteur : l'état ne repose jamais sur la couleur seule. */
  onLabel?: string;
  offLabel?: string;
}

/**
 * Interrupteur qui couvre toute la ligne : un seul bouton role="switch",
 * cible de 56 px de haut, état dit par aria-checked et par un mot.
 */
export function Switch({ checked, onChange, title, detail, onLabel = 'Oui', offLabel = 'Non' }: Props) {
  return (
    <button type="button" className="tog" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="grow">
        <span className="t">{title}</span>
        {detail && <span className="det">{detail}</span>}
      </span>
      <span className="swl" aria-hidden="true">
        {checked ? onLabel : offLabel}
      </span>
      <span className={checked ? 'sw on' : 'sw'} aria-hidden="true" />
    </button>
  );
}
