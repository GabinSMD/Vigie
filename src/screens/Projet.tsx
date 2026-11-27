import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ActionRow } from '../components/ActionRow';
import { BackLink } from '../components/BackLink';
import { DecisionCard } from '../components/DecisionCard';
import { CostGauge } from '../components/CostGauge';
import { LaunchedList } from '../components/LaunchedRow';
import { StatusPill } from '../components/StatusPill';
import { ActionButton } from '../components/ActionButton';
import { answeredWithin, isDecision, needsYou, sortDecisionItems, type DecisionItem } from '../data/decisionState';
import { useData } from '../data/source';
import { useStore, viewOf } from '../data/store';
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
  const { live, findProject } = useData();
  const project = findProject(projectId);
  if (!project) return <NotFound />;
  /* Données réelles : pas d'onglet Coût (D7). */
  const tabs = live ? TABS.filter((t) => t.id !== 'cout') : TABS;
  const current: TabId = tabs.some((t) => t.id === tab) ? (tab as TabId) : 'sessions';

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
        <div className="head-side">
          <StatusPill status={project.status} label={project.statusLabel} />
          <Link className="btn sm" to={`/projets/${project.id}/equipe`}>
            Équipe
          </Link>
        </div>
      </header>
      <nav aria-label={`Sections de ${project.name}`} style={{ padding: '0 16px 12px' }}>
        <div className="seg">
          {tabs.map((t) => (
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
  const { sessions, actionItems } = useData();
  const list = sessions.filter((s) => project.sessionIds.includes(s.id));
  const launched = state.launched.filter((l) => l.projectId === project.id);
  const own = actionItems.filter(isDecision).filter((i) => i.projectId === project.id);
  const phaseOf = (i: DecisionItem) => viewOf(state, i);
  const waiting = sortDecisionItems(own.filter((i) => needsYou(phaseOf(i).phase)));
  const sent = sortDecisionItems(own.filter((i) => phaseOf(i).phase === 'envoyee'));
  /* « Répondues récemment » : 7 jours (§ 3.1), la plus récente d'abord. */
  const answered = sortDecisionItems(own.filter((i) => answeredWithin(phaseOf(i), 24 * 7))).reverse();
  if (list.length === 0 && launched.length === 0 && waiting.length + sent.length + answered.length === 0)
    return <p className="det">Aucune session pour ce projet aujourd'hui.</p>;
  const firstWaiting = waiting.length > 0 ? undefined : list.find((s) => s.status === 'attention' && !state.consignes[s.id]?.length);

  return (
    <>
      {waiting.length > 0 && (
        <h2 className="h2">
          En attente de ta réponse ({waiting.length})
        </h2>
      )}
      {waiting.map((item, index) => (
        <DecisionCard key={item.id} item={item} primary={index === 0} showProject={false} />
      ))}
      {sent.map((item) => (
        <DecisionCard key={item.id} item={item} showProject={false} />
      ))}
      <LaunchedList sessions={launched} showProject={false} />
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
      {answered.length > 0 && (
        <section aria-labelledby="sec-answered" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          <h2 id="sec-answered" className="h2">
            Répondues récemment
          </h2>
          {answered.map((item) => (
            <DecisionCard key={item.id} item={item} showProject={false} />
          ))}
        </section>
      )}
    </>
  );
}

function PrTab({ project }: { project: Project }) {
  const { state } = useStore();
  const { live, pullRequests } = useData();
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
          {!pr.draft &&
            (live ? (
              <a className={index === 0 ? 'btn pri' : 'btn'} href={pr.url} target="_blank" rel="noreferrer noopener">
                Ouvrir sur GitHub<span className="sr-only"> (nouvel onglet)</span>
              </a>
            ) : (
              <button type="button" className={index === 0 ? 'btn pri' : 'btn'} onClick={() => setMerging(pr.number)}>
                Fusionner
              </button>
            ))}
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
  const { live } = useData();
  if (project.issues.length === 0)
    return <p className="det">{live ? 'Aucune issue ouverte.' : "Pas d'issue détaillée pour ce projet dans la démo."}</p>;
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
          {live ? (
            <>
              <ActionButton live>Lancer une session</ActionButton>
              <a className="btn" href={issue.url} target="_blank" rel="noreferrer noopener">
                Ouvrir sur GitHub<span className="sr-only"> (nouvel onglet)</span>
              </a>
            </>
          ) : (
            <Link className="btn" to={`/lancer?projet=${project.id}&issue=${issue.number.slice(1)}`}>
              Lancer une session
            </Link>
          )}
        </ActionRow>
      ))}
    </>
  );
}

function CostTab({ project }: { project: Project }) {
  const { settings } = useStore().state;
  const cap = settings.projectCaps[project.id] ?? project.costCap;
  const { level } = gauge(project.costToday, cap, settings.threshold);
  const rest = cap - project.costToday;
  return (
    <>
      <section className="card" aria-label="Coût du jour">
        <span className="k">Coût du jour</span>
        <div className="row sp" style={{ alignItems: 'baseline' }}>
          <span className="num">{formatCost(project.costToday)}</span>
          <span className="det">plafond {formatCost(cap)}</span>
        </div>
        <CostGauge label="Consommé" cost={project.costToday} cap={cap} threshold={settings.threshold} />
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
