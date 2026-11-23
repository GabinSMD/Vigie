import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ActionRow } from '../components/ActionRow';
import { BackLink } from '../components/BackLink';
import { CostGauge } from '../components/CostGauge';
import { StatusPill } from '../components/StatusPill';
import { COST_ALERT_THRESHOLD, findProject, pullRequests, sessions } from '../data/mock';
import { useStore } from '../data/store';
import type { Project } from '../data/types';
import { formatCost, gauge } from '../lib/format';
import { MergeSheet } from '../sheets/MergeSheet';
import { NotFound } from './NotFound';

const TABS = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'pr', label: 'PR' },
  { id: 'issues', label: 'Issues' },
  { id: 'cout', label: 'Coût' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function Projet() {
  const { projectId, tab } = useParams();
  const project = findProject(projectId);
  if (!project) return <NotFound />;
  const current: TabId = TABS.some((t) => t.id === tab) ? (tab as TabId) : 'sessions';

  return (
    <>
      <BackLink to="/projets" label="Projets" />
      <header className="head tight">
        <div>
          <h1 className="h1">{project.name}</h1>
          <p className="det" style={{ marginTop: 4 }}>
            {project.line}
          </p>
        </div>
        <StatusPill status={project.status} label={project.statusLabel} />
      </header>
      <nav aria-label={`Sections de ${project.name}`} style={{ padding: '0 16px 12px' }}>
        <div className="seg">
          {TABS.map((t) => (
            <Link key={t.id} to={`/projets/${project.id}/${t.id}`} aria-current={t.id === current ? 'page' : undefined}>
              {t.label}
            </Link>
          ))}
        </div>
      </nav>
      <div className="body">
        {current === 'sessions' && <SessionsTab project={project} />}
        {current === 'pr' && <PrTab project={project} />}
        {current === 'issues' && <IssuesTab project={project} />}
        {current === 'cout' && <CostTab project={project} />}
      </div>
    </>
  );
}

function SessionsTab({ project }: { project: Project }) {
  const { state } = useStore();
  const list = sessions.filter((s) => project.sessionIds.includes(s.id));
  if (list.length === 0) return <p className="det">Aucune session pour ce projet aujourd'hui.</p>;
  const firstWaiting = list.find((s) => s.status === 'attention' && !state.consignes[s.id]?.length);

  return (
    <>
      {list.map((s) => {
        const sent = Boolean(state.consignes[s.id]?.length);
        return (
          <ActionRow
            key={s.id}
            meta={
              <>
                {s.role}
                {s.ref && (
                  <>
                    {' · '}
                    <span className="code">{s.ref}</span>
                  </>
                )}
              </>
            }
            status={sent ? 'neutre' : s.status}
            statusLabel={sent ? 'En cours' : s.statusLabel}
            title={s.title}
            detail={sent ? 'Consigne reçue, la session travaille.' : s.line}
          >
            <Link className={s.id === firstWaiting?.id ? 'btn pri' : 'btn'} to={`/projets/${project.id}/sessions/${s.id}`}>
              Ouvrir la session
            </Link>
          </ActionRow>
        );
      })}
    </>
  );
}

function PrTab({ project }: { project: Project }) {
  const { state } = useStore();
  const [merging, setMerging] = useState<string | null>(null);
  const open = pullRequests.filter((pr) => pr.projectId === project.id && !state.merged.includes(pr.number));
  const justMerged = pullRequests.filter((pr) => pr.projectId === project.id && state.merged.includes(pr.number));

  return (
    <>
      {open.length === 0 && <p className="det">Aucune PR ouverte.</p>}
      {open.map((pr, index) => (
        <ActionRow
          key={pr.number}
          meta={
            <>
              PR <span className="code">{pr.number}</span>
            </>
          }
          status={pr.status}
          statusLabel={pr.statusLabel}
          title={pr.title}
          detail={pr.line}
        >
          {!pr.draft && (
            <button type="button" className={index === 0 ? 'btn pri' : 'btn'} onClick={() => setMerging(pr.number)}>
              Fusionner
            </button>
          )}
          <Link className="btn" to={`/projets/${project.id}/pr/${pr.number.slice(1)}`}>
            Détail
          </Link>
        </ActionRow>
      ))}

      {(justMerged.length > 0 || project.closedPrs.length > 0) && (
        <>
          <h2 className="h2" style={{ marginTop: 4 }}>
            Récemment fermées
          </h2>
          <ul className="list">
            {justMerged.map((pr) => (
              <ClosedRow key={pr.number} number={pr.number} title={pr.title} when="Fusionnée à l'instant" merged />
            ))}
            {project.closedPrs.map((pr) => (
              <ClosedRow key={pr.number} {...pr} />
            ))}
          </ul>
        </>
      )}

      <MergeSheet projectId={project.id} prNumber={merging} onClose={() => setMerging(null)} />
    </>
  );
}

function ClosedRow({ number, title, when, merged }: { number: string; title: string; when: string; merged: boolean }) {
  return (
    <li className="li">
      <span className="pill p-neu code">{number}</span>
      <div className="grow">
        <div className="t" style={{ fontSize: 16 }}>
          {title}
        </div>
        <p className="det">{when}</p>
      </div>
      {merged ? <StatusPill status="ok" label="Fusionnée" /> : <StatusPill status="neutre" label="Fermée" />}
    </li>
  );
}

function IssuesTab({ project }: { project: Project }) {
  if (project.issues.length === 0) return <p className="det">Pas d'issue détaillée pour ce projet dans la démo.</p>;
  return (
    <>
      {project.issues.map((issue) => (
        <ActionRow
          key={issue.number}
          meta={
            <>
              Issue <span className="code">{issue.number}</span>
            </>
          }
          status="neutre"
          statusLabel="En file"
          title={issue.title}
        >
          <Link className="btn" to="/lancer">
            Lancer une session
          </Link>
        </ActionRow>
      ))}
    </>
  );
}

function CostTab({ project }: { project: Project }) {
  const { level } = gauge(project.costToday, project.costCap, COST_ALERT_THRESHOLD);
  const rest = project.costCap - project.costToday;
  return (
    <>
      <section className="card" aria-label="Coût du jour">
        <span className="k">Coût du jour</span>
        <div className="row sp" style={{ alignItems: 'baseline' }}>
          <span className="num">{formatCost(project.costToday)}</span>
          <span className="det">plafond {formatCost(project.costCap)}</span>
        </div>
        <CostGauge label="Consommé" cost={project.costToday} cap={project.costCap} />
        <p className="det">
          {level === 'plafond'
            ? 'Plafond du projet atteint : les sessions sont en pause.'
            : `Reste ${formatCost(rest)} avant le plafond du projet.`}
        </p>
        {level === 'alerte' && <StatusPill status="attention" label="Seuil d'alerte atteint" role="status" />}
        {level === 'plafond' && <StatusPill status="bloque" label="Plafond atteint" role="status" />}
      </section>
      <ul className="list">
        {project.costs.map((line) => (
          <li key={line.title} className="li">
            <div className="grow">
              <div className="t">{line.title}</div>
              <p className="det">{line.detail}</p>
            </div>
            <b>{formatCost(line.amount)}</b>
          </li>
        ))}
      </ul>
    </>
  );
}
