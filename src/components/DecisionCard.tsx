import { Link } from 'react-router-dom';
import { useData } from '../data/source';
import { useStore } from '../data/store';
import type { ActionItem } from '../data/types';
import { ActionButton } from './ActionButton';
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
  const { live, findProject } = useData();
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
        <ActionButton live={live} className={pri} disabled={disabled} onClick={() => dispatch({ type: 'answer', itemId: item.id, answer: 'oui' })}>
          Répondre : oui
        </ActionButton>
        <ActionButton live={live} disabled={disabled} onClick={() => dispatch({ type: 'answer', itemId: item.id, answer: 'non' })}>
          Non
        </ActionButton>
      </ActionRow>
    );
  }
  return (
    <ActionRow meta={`${where}Livrable`} status="attention" statusLabel="À valider" title={item.title}>
      <ActionButton live={live} className={pri} disabled={disabled} onClick={() => dispatch({ type: 'validate', itemId: item.id })}>
        Valider
      </ActionButton>
      {showProject && (
        <Link className="btn" to={`/projets/${item.projectId}`}>
          Ouvrir
        </Link>
      )}
    </ActionRow>
  );
}
