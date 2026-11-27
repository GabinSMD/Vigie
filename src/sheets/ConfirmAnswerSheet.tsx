import { ActionSheet } from '../components/ActionSheet';
import { Icon } from '../components/Icon';

interface Props {
  open: boolean;
  question: string;
  /** Libellé de l'option choisie. */
  choice: string;
  text?: string;
  onConfirm: () => void;
  onClose: () => void;
}

/** Réponse irréversible : jamais en un tap, elle passe toujours par cette confirmation (§ 3.2). */
export function ConfirmAnswerSheet({ open, question, choice, text, onConfirm, onClose }: Props) {
  return (
    <ActionSheet open={open} title="Envoyer cette réponse ?" onClose={onClose}>
      <p className="det">« {question} »</p>
      <div className="guard blk">
        <Icon name="warning" />
        <div>
          <b>Irréversible</b>
          <span className="det strong-ink">On ne pourra pas revenir en arrière après l'envoi.</span>
        </div>
      </div>
      <p className="strong-ink" style={{ margin: 0 }}>
        Ton choix : <b>{choice}</b>
      </p>
      {text && <p className="det quote strong-ink">{text}</p>}
      <button type="button" className="btn pri big full" onClick={onConfirm}>
        Envoyer
      </button>
      <button type="button" className="btn full" data-autofocus onClick={onClose}>
        Annuler
      </button>
    </ActionSheet>
  );
}
