import { ActionSheet } from '../components/ActionSheet';
import { Icon } from '../components/Icon';
import { findPullRequest, findProject } from '../data/mock';
import { useStore } from '../data/store';

interface Props {
  projectId: string;
  prNumber: string | null;
  onClose: () => void;
}

/** Fusion = action irréversible : elle passe toujours par cette confirmation. */
export function MergeSheet({ projectId, prNumber, onClose }: Props) {
  const { dispatch } = useStore();
  const pr = prNumber ? findPullRequest(projectId, prNumber.replace('#', '')) : undefined;
  const project = findProject(projectId);

  return (
    <ActionSheet open={Boolean(pr)} title={`Fusionner ${prNumber ?? ''} ?`} onClose={onClose}>
      {pr && (
        <>
          <p className="det">
            {project?.name} · « {pr.title} »
          </p>
          <div className="guard">
            <Icon name="shield" />
            <div>
              <b>Garde-fous respectés</b>
              <span className="det strong-ink">{pr.guards.join(' · ')}</span>
            </div>
          </div>
          <button
            type="button"
            className="btn pri big full"
            onClick={() => {
              dispatch({ type: 'merge', prNumber: pr.number });
              onClose();
            }}
          >
            Fusionner {pr.number}
          </button>
          <button type="button" className="btn full" data-autofocus onClick={onClose}>
            Annuler
          </button>
        </>
      )}
    </ActionSheet>
  );
}
