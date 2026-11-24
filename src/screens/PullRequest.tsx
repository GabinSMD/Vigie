import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackLink } from '../components/BackLink';
import { Icon } from '../components/Icon';
import { StatusPill } from '../components/StatusPill';
import { useData } from '../data/source';
import { useStore } from '../data/store';
import { MergeSheet } from '../sheets/MergeSheet';
import { NotFound } from './NotFound';

export function PullRequest() {
  const { projectId, prNumber } = useParams();
  const { live, findProject, findPullRequest, findSession } = useData();
  const project = findProject(projectId);
  const pr = findPullRequest(projectId, prNumber);
  const { state } = useStore();
  const [merging, setMerging] = useState(false);
  if (!project || !pr) return <NotFound />;

  const merged = state.merged.includes(pr.number);
  const session = findSession(pr.sessionRef);

  return (
    <>
      <BackLink to={`/projets/${project.id}/pr`} label={project.name} />
      <header className="head tight">
        <div>
          <div className="k">
            Pull request <span className="code">{pr.number}</span>
          </div>
          <h1 className="h1" style={{ marginTop: 2 }}>
            {pr.title}
          </h1>
        </div>
      </header>
      <div className="body">
        <div className="row wrap">
          {merged ? (
            <StatusPill status="ok" label="Fusionnée" />
          ) : (
            <>
              {pr.draft && <StatusPill status="neutre" label="Brouillon" />}
              {pr.guards.map((g) => (
                <StatusPill key={g} status="ok" label={g} />
              ))}
            </>
          )}
        </div>
        <section className="card" aria-label="Résumé">
          <span className="k">Résumé</span>
          <p style={{ margin: 0 }}>{pr.summary}</p>
          {session && (
            <p className="det">
              Session liée :{' '}
              <Link to={`/projets/${project.id}/sessions/${session.id}`}>
                {session.title} · {session.statusLabel.toLowerCase()}
              </Link>
            </p>
          )}
        </section>
        <section className="card" aria-label="Vérifications">
          <span className="k">Vérifications</span>
          {pr.checks.map((c) => (
            <div key={c.label} className="row sp">
              <span>{c.label}</span>
              <StatusPill status={c.status} label={c.statusLabel} />
            </div>
          ))}
        </section>
        {merged ? (
          <div className="guard" role="status">
            <Icon name="check" />
            <div>
              <b>PR fusionnée</b>
              <span className="det strong-ink">Elle a rejoint la branche principale.</span>
            </div>
          </div>
        ) : pr.draft ? (
          <div className="guard att">
            <Icon name="warning" />
            <div>
              <b>Pas encore fusionnable</b>
              <span className="det strong-ink">Elle est en brouillon tant que la session attend ta réponse.</span>
            </div>
          </div>
        ) : (
          <div className="guard">
            <Icon name="shield" />
            <div>
              <b>Prête à fusionner</b>
              <span className="det strong-ink">Garde-fous respectés : {pr.guards.join(', ').toLowerCase()}.</span>
            </div>
          </div>
        )}
      </div>
      {!merged && !pr.draft && (
        <div className="footer-actions">
          {live ? (
            <a className="btn pri big full" href={pr.url} target="_blank" rel="noreferrer noopener">
              Ouvrir {pr.number} sur GitHub<span className="sr-only"> (nouvel onglet)</span>
            </a>
          ) : (
            <button type="button" className="btn pri big full" onClick={() => setMerging(true)}>
              Fusionner {pr.number}
            </button>
          )}
        </div>
      )}
      <MergeSheet projectId={project.id} prNumber={merging ? pr.number : null} onClose={() => setMerging(false)} />
    </>
  );
}
