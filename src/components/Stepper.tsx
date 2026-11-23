import { useId, type ReactNode } from 'react';

interface Props {
  /** Complément lu après le verbe de chaque bouton : « le plafond de sessions » → « Diminuer le plafond de sessions ». */
  label: string;
  /** Nom visible du réglage, qui nomme aussi le groupe. */
  title: ReactNode;
  detail?: ReactNode;
  value: number;
  /** Valeur mise en forme : « 12 $ », « 80 % ». */
  display?: string;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
}

/** Réglage pas à pas : deux boutons de 48 × 44 px, la valeur écrite entre les deux et annoncée. */
export function Stepper({ label, title, detail, value, display, min, max, step = 1, onChange }: Props) {
  const id = useId();
  return (
    <div className="row sp" role="group" aria-labelledby={id}>
      <div className="grow">
        <div id={id} className="t">
          {title}
        </div>
        {detail && <p className="det">{detail}</p>}
      </div>
      <div className="step">
        <button
          type="button"
          className="btn"
          aria-label={`Diminuer ${label}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
        >
          −
        </button>
        <output className="v" aria-live="polite">
          {display ?? value}
        </output>
        <button
          type="button"
          className="btn"
          aria-label={`Augmenter ${label}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
        >
          +
        </button>
      </div>
    </div>
  );
}
