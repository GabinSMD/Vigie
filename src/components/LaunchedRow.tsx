import { useData } from '../data/source';
import type { Launched } from '../data/store';
import { ActionRow } from './ActionRow';

/**
 * Session lancée depuis « Lancer du travail ».
 * Ce n'est pas une décision à prendre : pastille neutre, aucun bouton, pas comptée dans « À faire ».
 */
export function LaunchedRow({ session, showProject = true }: { session: Launched; showProject?: boolean }) {
  const { findProject } = useData();
  const project = findProject(session.projectId)?.name ?? session.projectId;
  return (
    <ActionRow
      meta={showProject ? `${project} · ${session.role}` : session.role}
      status="neutre"
      statusLabel="En cours"
      title={session.what}
      detail="La session démarre. Tu seras prévenu si elle a besoin de toi."
    />
  );
}

/** Liste des sessions lancées, la plus récente en premier. */
export function LaunchedList({ sessions, showProject }: { sessions: Launched[]; showProject?: boolean }) {
  if (sessions.length === 0) return null;
  return (
    <section aria-label="Sessions lancées" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sessions.map((s, index) => (
        <LaunchedRow key={`${sessions.length - index}`} session={s} showProject={showProject} />
      ))}
    </section>
  );
}
