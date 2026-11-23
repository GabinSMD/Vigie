import { ActionSheet } from '../components/ActionSheet';

/** Dit où poser une clé API, sans jamais en afficher ni en demander la valeur. */
export function KeySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ActionSheet open={open} title="Poser la clé API Last.fm" onClose={onClose}>
      <p className="det strong-ink">
        Ne la colle jamais dans le chat. Place-la dans un fichier de configuration sur le serveur, puis relance la
        session.
      </p>
      <button type="button" className="btn pri big full" data-autofocus onClick={onClose}>
        Compris
      </button>
    </ActionSheet>
  );
}
