import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ActionRow } from '../components/ActionRow';
import { Icon } from '../components/Icon';
import { LaunchedList } from '../components/LaunchedRow';
import { findProject, findSession } from '../data/mock';
import { pendingItems, useStore, type Launched } from '../data/store';
import type { ActionItem } from '../data/types';
import { plural } from '../lib/format';
import { ConsigneSheet } from '../sheets/ConsigneSheet';
import { KeySheet } from '../sheets/KeySheet';
import { MergeSheet } from '../sheets/MergeSheet';

/** États de démonstration, choisis par ?etat= dans l'URL. */
export type HomeDemo = 'chargement' | 'vide' | 'horsligne' | 'erreur';
const DEMOS: HomeDemo[] = ['chargement', 'vide', 'horsligne', 'erreur'];

const projectName = (id: string) => findProject(id)?.name ?? id;

export function Accueil() {
  const [params] = useSearchParams();
  const raw = params.get('etat');
  const demo = DEMOS.includes(raw as HomeDemo) ? (raw as HomeDemo) : null;
  const { state, dispatch } = useStore();
  const [sheet, setSheet] = useState<
    { kind: 'key' } | { kind: 'merge'; projectId: string; pr: string } | { kind: 'consigne'; session: string } | null
  >(null);
  const close = () => setSheet(null);

  if (demo === 'chargement') return <Loading />;
  if (demo === 'vide') return <Empty launched={state.launched} />;

  const offline = demo === 'horsligne';
  const failing = demo === 'erreur';
  let items = pendingItems(state);
  if (failing) items = items.filter((i) => i.projectId !== 'treizero');

  const blocking = items.filter((i) => i.kind === 'blocage');
  const toValidate = items.filter((i) => i.kind !== 'blocage');
  if (items.length === 0) return <Empty launched={state.launched} />;

  const subtitle = offline
    ? 'Données de 14 h 02'
    : failing
      ? 'Une erreur empêche la mise à jour de treizero'
      : `${plural(items.length, 'élément')}${blocking.length ? ` · ${blocking.length} bloque un agent` : ''}`;

  /* Un seul bouton plein par écran : celui de la carte la plus urgente. */
  const primaryId = offline || failing ? null : (blocking[0] ?? toValidate[0])?.id;

  const renderItem = (item: ActionItem) => {
    const pri = item.id === primaryId ? 'btn pri' : 'btn';
    switch (item.kind) {
      case 'blocage':
        return (
          <ActionRow key={item.id} urgent meta={`${projectName(item.projectId)} · Session`} status="bloque" title={item.title} detail={item.detail}>
            <button type="button" className={pri} disabled={offline} onClick={() => setSheet({ kind: 'key' })}>
              Voir où poser la clé
            </button>
            <Link className="btn" to={`/projets/${item.projectId}/sessions/${item.sessionId}`}>
              Ouvrir la session
            </Link>
          </ActionRow>
        );
      case 'session':
        return (
          <ActionRow
            key={item.id}
            meta={
              <>
                {projectName(item.projectId)} · Session <span className="code">{findSession(item.sessionId)?.ref}</span>
              </>
            }
            status="attention"
            title={item.title}
          >
            <button type="button" className={pri} disabled={offline} onClick={() => setSheet({ kind: 'consigne', session: item.sessionId })}>
              Envoyer une consigne
            </button>
            <Link className="btn" to={`/projets/${item.projectId}/sessions/${item.sessionId}`}>
              Ouvrir la session
            </Link>
          </ActionRow>
        );
      case 'pr':
        return (
          <ActionRow
            key={item.id}
            meta={
              <>
                {projectName(item.projectId)} · PR <span className="code">{item.prNumber}</span>
              </>
            }
            status={offline ? 'bloque' : 'ok'}
            statusLabel={offline ? 'Non envoyée' : 'CI verte'}
            title={item.title}
            detail={offline ? "Ta fusion n'est pas partie : réessaie quand le réseau revient." : item.detail}
          >
            <button type="button" className={pri} disabled={offline} onClick={() => setSheet({ kind: 'merge', projectId: item.projectId, pr: item.prNumber })}>
              Fusionner
            </button>
            <Link className="btn" to={`/projets/${item.projectId}/pr/${item.prNumber.slice(1)}`}>
              Ouvrir la relecture
            </Link>
          </ActionRow>
        );
      case 'question':
        return (
          <ActionRow
            key={item.id}
            meta={`${projectName(item.projectId)} · Question`}
            status="attention"
            title={item.title}
            detail={
              <>
                PR <span className="code">{item.prRef}</span> {item.detail}
              </>
            }
          >
            <button type="button" className={pri} disabled={offline} onClick={() => dispatch({ type: 'answer', itemId: item.id, answer: 'oui' })}>
              Répondre : oui
            </button>
            <button type="button" className="btn" disabled={offline} onClick={() => dispatch({ type: 'answer', itemId: item.id, answer: 'non' })}>
              Non
            </button>
          </ActionRow>
        );
      case 'livrable':
        return (
          <ActionRow key={item.id} meta={`${projectName(item.projectId)} · Livrable`} status="attention" statusLabel="À valider" title={item.title}>
            <button type="button" className={pri} disabled={offline} onClick={() => dispatch({ type: 'validate', itemId: item.id })}>
              Valider
            </button>
            <Link className="btn" to={`/projets/${item.projectId}`}>
              Ouvrir
            </Link>
          </ActionRow>
        );
    }
  };

  return (
    <>
      <header className="head">
        <div>
          <h1 className="h1">À faire par toi</h1>
          <p className="det" style={{ marginTop: 4 }}>
            {subtitle}
          </p>
        </div>
      </header>

      {offline && (
        <div className="banner att" role="status">
          <Icon name="offline" className="" />
          <span style={{ flex: 1 }}>Pas de réseau. Les actions sont désactivées.</span>
        </div>
      )}

      {failing && (
        <div className="banner blk" role="alert">
          <div className="row">
            <Icon name="blocked" className="" />
            <span>treizero : accès GitHub refusé</span>
          </div>
          <p className="det strong-ink">
            Impossible de lire les PR et les issues de treizero. Réautorise l'accès à ce dépôt depuis les réglages de GitHub,
            puis réessaie.
          </p>
          <div className="row wrap" style={{ width: '100%' }}>
            <Link className="btn pri" to="/?">
              Réessayer
            </Link>
          </div>
        </div>
      )}

      <div className="body">
        <LaunchedList sessions={state.launched} />
        {blocking.length > 0 && (
          <section aria-labelledby="sec-blk" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 id="sec-blk" className="h2">
              Bloque un agent ({blocking.length})
            </h2>
            {blocking.map(renderItem)}
          </section>
        )}
        {toValidate.length > 0 && (
          <section aria-labelledby="sec-val" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            <h2 id="sec-val" className="h2">
              À valider ({toValidate.length})
            </h2>
            {toValidate.map(renderItem)}
          </section>
        )}
        {failing && (
          <ActionRow dim meta="treizero" status="bloque" statusLabel="Indisponible" title="Données non mises à jour" detail="Les éléments de treizero reviendront après la réautorisation." />
        )}
      </div>

      {offline && (
        <div className="footer-actions">
          <Link className="btn pri big full" to="/?">
            <Icon name="retry" />
            Réessayer
          </Link>
        </div>
      )}

      <KeySheet open={sheet?.kind === 'key'} onClose={close} />
      <MergeSheet
        projectId={sheet?.kind === 'merge' ? sheet.projectId : ''}
        prNumber={sheet?.kind === 'merge' ? sheet.pr : null}
        onClose={close}
      />
      <ConsigneSheet sessionId={sheet?.kind === 'consigne' ? sheet.session : null} onClose={close} />
    </>
  );
}

function Loading() {
  return (
    <>
      <header className="head">
        <div>
          <h1 className="h1">À faire par toi</h1>
          <p className="det" style={{ marginTop: 4 }} role="status">
            Chargement en cours…
          </p>
        </div>
      </header>
      <div className="body" aria-busy="true">
        {[0, 1, 2].map((n) => (
          <div key={n} className="ar" aria-hidden="true">
            <div className="row sp">
              <div className="skel" style={{ width: 140 }} />
              <div className="skel pillish" />
            </div>
            <div className="skel l" style={{ width: '80%' }} />
            <div className="skel" style={{ width: '60%' }} />
            <div className="skel btnish" />
          </div>
        ))}
      </div>
    </>
  );
}

function Empty({ launched }: { launched: Launched[] }) {
  return (
    <>
      <header className="head">
        <div>
          <h1 className="h1">À faire par toi</h1>
          <p className="det" style={{ marginTop: 4 }}>
            0 élément
          </p>
        </div>
      </header>
      {launched.length > 0 && (
        <div className="body" style={{ flex: 'none' }}>
          <LaunchedList sessions={launched} />
        </div>
      )}
      <div className="state">
        <div className="bigico" aria-hidden="true">
          <Icon name="check" className="" />
        </div>
        <h2 className="h2">Rien n'attend ta décision</h2>
        <p className="det" style={{ maxWidth: 320 }}>
          Les agents avancent seuls. Tu seras prévenu dès qu'une PR, une question ou un blocage demande ton avis.
        </p>
        <Link className="btn pri big" to="/lancer">
          Lancer du travail
        </Link>
        <Link className="btn ghost" to="/projets">
          Voir les projets
        </Link>
      </div>
    </>
  );
}
