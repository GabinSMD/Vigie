import { ActionSheet } from '../components/ActionSheet';
import { Icon } from '../components/Icon';
import { findProject } from '../data/mock';
import { useStore } from '../data/store';

interface Props {
  projectId: string | null;
  onClose: () => void;
}

/** Donner plus d'autonomie aux agents passe toujours par une confirmation ; la retirer, non. */
export function AutoMergeSheet({ projectId, onClose }: Props) {
  const { dispatch } = useStore();
  const project = findProject(projectId ?? undefined);

  return (
    <ActionSheet open={Boolean(project)} title={`Autoriser la fusion automatique sur ${project?.name ?? ''} ?`} onClose={onClose}>
      {project && (
        <>
          <p className="det">Les agents pourront fusionner seuls les PR de ce projet, sans ton accord.</p>
          <div className="guard">
            <Icon name="shield" />
            <div>
              <b>Seulement si</b>
              <ul className="det strong-ink" style={{ margin: 0, paddingLeft: 18 }}>
                <li>La PR n'est pas en brouillon</li>
                <li>La CI est verte</li>
                <li>Elle vise la branche principale</li>
              </ul>
            </div>
          </div>
          <button
            type="button"
            className="btn pri big full"
            onClick={() => {
              dispatch({ type: 'autoMerge', projectId: project.id, on: true });
              onClose();
            }}
          >
            Autoriser
          </button>
          <button type="button" className="btn full" data-autofocus onClick={onClose}>
            Annuler
          </button>
        </>
      )}
    </ActionSheet>
  );
}
