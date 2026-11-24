import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackLink } from '../components/BackLink';
import { Icon } from '../components/Icon';
import { StatusPill } from '../components/StatusPill';
import { ActionButton } from '../components/ActionButton';
import { useData } from '../data/source';
import { useStore } from '../data/store';
import type { EventKind, SessionEvent } from '../data/types';
import { ConsigneSheet } from '../sheets/ConsigneSheet';
import { NotFound } from './NotFound';

/* Repère de la frise : forme + mot d'état devant l'heure, jamais la couleur seule. */
const eventStyle: Record<EventKind, { dot: string; word: string }> = {
  fait: { dot: 'dot', word: 'Fait' },
  reussi: { dot: 'dot g', word: 'Réussi' },
  attente: { dot: 'dot w', word: 'Attente' },
  perdu: { dot: 'dot b', word: 'Perdu' },
  envoye: { dot: 'dot g', word: 'Envoyé' },
};

export function Session() {
  const { projectId, sessionId } = useParams();
  const { live, findProject, findSession } = useData();
  const project = findProject(projectId);
  const session = findSession(sessionId);
  const { state, dispatch } = useStore();
  const [consigne, setConsigne] = useState(false);
  if (!project || !session || session.projectId !== project.id) return <NotFound />;

  const sent = state.consignes[session.id] ?? [];
  const waiting = Boolean(session.waitingFor) && sent.length === 0;
  const events: SessionEvent[] = [
    ...sent
      .slice()
      .reverse()
      .map((text): SessionEvent => ({ kind: 'envoye', title: `Consigne envoyée : ${text}`, when: "à l'instant" })),
    ...session.events.filter((e) => !(sent.length > 0 && e.kind === 'attente')),
  ];
  const back = `/projets/${project.id}`;

  if (session.disconnected) {
    return (
      <>
        <BackLink to={back} label={project.name} />
        <header className="head tight">
          <div>
            <div className="k">{session.role}</div>
            <h1 className="h1" style={{ marginTop: 2 }}>
              {session.title}
            </h1>
          </div>
          <StatusPill status="bloque" label="Déconnectée" />
        </header>
        <div className="body">
          <div className="guard blk">
            <Icon name="blocked" />
            <div>
              <b>La session ne répond plus</b>
              <span className="det strong-ink">
                Dernier signe de vie {session.disconnected.lastSeen}. Ce qui est déjà sur GitHub y reste.
              </span>
            </div>
          </div>
          <section className="card" aria-label="Dernier résumé connu">
            <span className="k">Dernier résumé connu</span>
            <p style={{ margin: 0 }}>{session.summary}</p>
          </section>
          <Timeline events={events} />
        </div>
        <div className="footer-actions">
          <ActionButton live={live} className="btn pri big full" onClick={() => dispatch({ type: 'notify', message: 'Reprise demandée.' })}>
            <Icon name="retry" />
            Reprendre la session
          </ActionButton>
        </div>
      </>
    );
  }

  return (
    <>
      <BackLink to={back} label={project.name} />
      <header className="head tight">
        <div>
          <div className="k">
            {session.role}
            {session.ref && (
              <>
                {' · '}
                <span className="code">{session.ref}</span>
              </>
            )}
          </div>
          <h1 className="h1" style={{ marginTop: 2 }}>
            {session.title}
          </h1>
        </div>
        {sent.length > 0 ? (
          <StatusPill status="neutre" label="En cours" />
        ) : (
          <StatusPill status={session.status} label={session.statusLabel} />
        )}
      </header>
      <div className="body">
        <section className="card" aria-label="Résumé">
          <span className="k">Résumé</span>
          <p style={{ margin: 0 }}>
            {sent.length > 0 ? 'La consigne a été prise en compte. La session poursuit son travail.' : session.summary}
          </p>
        </section>
        {waiting && (
          <div className="guard att">
            <Icon name="warning" />
            <div>
              <b>Attendu de toi</b>
              <span className="det strong-ink">{session.waitingFor}</span>
            </div>
          </div>
        )}
        <Timeline events={events} />
      </div>
      <div className="footer-actions">
        <ActionButton live={live} className="btn pri big full" onClick={() => setConsigne(true)}>
          Envoyer une consigne
        </ActionButton>
        {session.linkedPr && (
          <Link className="btn full" to={`/projets/${project.id}/pr/${session.linkedPr.slice(1)}`}>
            Ouvrir la PR <span className="code">{session.linkedPr}</span>
          </Link>
        )}
      </div>
      <ConsigneSheet sessionId={consigne ? session.id : null} onClose={() => setConsigne(false)} />
    </>
  );
}

function Timeline({ events }: { events: SessionEvent[] }) {
  return (
    <section aria-labelledby="tl-title" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <h2 id="tl-title" className="h2" style={{ marginTop: 4 }}>
        Derniers événements
      </h2>
      <ol className="tl">
        {events.map((event, index) => {
          const style = eventStyle[event.kind];
          return (
            <li key={`${event.title}-${index}`} className="ev">
              <span className={style.dot} aria-hidden="true" />
              <div>
                <div className="t">{event.title}</div>
                <p className="det">
                  {style.word}, {event.when}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
