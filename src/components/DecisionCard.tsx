import { Link } from 'react-router-dom';
import { findProject } from '../data/mock';
import { useStore } from '../data/store';
import type { ActionItem } from '../data/types';
import { ActionRow } from './ActionRow';

export type DecisionItem = Extract<ActionItem, { kind: 'question' | 'livrable' }>;

export const isDecision = (item: ActionItem): item is DecisionItem => item.kind === 'question' || item.kind === 'livrable';

interface Props {
  item: DecisionItem;
  /** Le bouton principal de la carte est plein (un seul par écran). */
  primary?: boolean;
  disabled?: boolean;
  /** Sur la page d'un projet, le nom du projet et le lien « Ouvrir » sont inutiles. */
  showProject?: boolean;
}

/** Carte de décision (question ou livrable), partagée par « À faire » et la page d'un projet. */
export function DecisionCard({ item, primary, disabled, showProject = true }: Props) {
  const { dispatch } = useStore();
  const pri = primary ? 'btn pri' : 'btn';
  const where = showProject ? `${findProject(item.projectId)?.name ?? item.projectId} · ` : '';

  if (item.kind === 'question') {
    return (
      <ActionRow
        meta={`${where}Question`}
        status="attention"
        title={item.title}
        detail={
          <>
            PR <span className="code">{item.prRef}</span> {item.detail}
          </>
        }
      >
        <button type="button" className={pri} disabled={disabled} onClick={() => dispatch({ type: 'answer', itemId: item.id, answer: 'oui' })}>
          Répondre : oui
        </button>
        <button type="button" className="btn" disabled={disabled} onClick={() => dispatch({ type: 'answer', itemId: item.id, answer: 'non' })}>
          Non
        </button>
      </ActionRow>
    );
  }
  return (
    <ActionRow meta={`${where}Livrable`} status="attention" statusLabel="À valider" title={item.title}>
      <button type="button" className={pri} disabled={disabled} onClick={() => dispatch({ type: 'validate', itemId: item.id })}>
        Valider
      </button>
      {showProject && (
        <Link className="btn" to={`/projets/${item.projectId}`}>
          Ouvrir
        </Link>
      )}
    </ActionRow>
  );
}
