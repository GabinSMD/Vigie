import { Link, useParams } from 'react-router-dom';
import { BackLink } from '../components/BackLink';
import { StatusPill } from '../components/StatusPill';
import { findProject, sessions } from '../data/mock';
import { useStore, type Role } from '../data/store';
import type { Project } from '../data/types';
import { formatCap } from '../lib/format';
import { NotFound } from './NotFound';

/** Ce que fait chaque rôle, quel que soit le projet. */
const ROLE_JOB: Record<Role, string> = {
  'Chef de projet': 'Découpe les issues, lance les sessions',
  Développeur: 'Écrit le code',
  Relecteur: 'Relit les PR',
};

/** Ce que traite un rôle dans le projet : la ref de chaque session (issue, sinon titre), puis les sessions lancées. */
function workOf(project: Project, role: Role, launched: { role: Role; what: string }[]): string[] {
  const own = sessions
    .filter((s) => project.sessionIds.includes(s.id) && s.role === role)
    .map((s) => s.ref ?? s.title);
  return [...own, ...launched.filter((l) => l.role === role).map((l) => l.what)];
}

function RoleNode({ role, work, moi }: { role: string; work?: string[]; moi?: boolean }) {
  return (
    <div className={moi ? 'node moi' : 'node'}>
      <span className="k">{role}</span>
      {moi ? (
        <span className="det strong-ink">Tu décides, tu valides, tu fusionnes</span>
      ) : (
        <>
          <span className="t">{work && work.length > 0 ? work.join(' · ') : 'Aucune session'}</span>
          <span className="det">{ROLE_JOB[role as Role]}</span>
        </>
      )}
    </div>
  );
}

export function Equipe() {
  const { projectId } = useParams();
  const { state } = useStore();
  const project = findProject(projectId);
  if (!project) return <NotFound />;

  const launched = state.launched.filter((l) => l.projectId === project.id);
  const work = (role: Role) => workOf(project, role, launched);
  const { settings } = state;
  const auto = settings.autoMerge.includes(project.id);
  const costCap = settings.projectCaps[project.id] ?? project.costCap;

  return (
    <>
      <BackLink to={`/projets/${project.id}`} label={project.name} />
      <header className="head tight">
        <div>
          <h1 className="h1">Équipe</h1>
          <p className="det" style={{ marginTop: 4 }}>
            Qui délègue à qui
          </p>
        </div>
      </header>
      <div className="body" style={{ gap: 16 }}>
        <section aria-label="Organigramme">
          {/* Liste imbriquée : la hiérarchie se lit aussi au lecteur d'écran, les traits ne sont que décoratifs. */}
          <ul className="org">
            <li>
              <RoleNode role="Toi" moi />
              <ul>
                <li>
                  <RoleNode role="Chef de projet" work={work('Chef de projet')} />
                  <ul className="branch">
                    <li>
                      <RoleNode role="Développeur" work={work('Développeur')} />
                    </li>
                    <li>
                      <RoleNode role="Relecteur" work={work('Relecteur')} />
                    </li>
                  </ul>
                </li>
              </ul>
            </li>
          </ul>
        </section>

        <section className="card" aria-label="Règles d'autonomie">
          <span className="k">Règles d'autonomie</span>
          <div className="row sp">
            <span>Fusion automatique</span>
            <StatusPill status="neutre" label={auto ? 'Auto' : 'Manuelle'} />
          </div>
          <div className="row sp">
            <span>Sessions lancées par jour</span>
            <b>{settings.sessionCap} max</b>
          </div>
          <div className="row sp">
            <span>Coût par jour</span>
            <b>{formatCap(costCap)} max</b>
          </div>
          <Link className="btn full" style={{ marginTop: 4 }} to="/reglages">
            Modifier les règles
          </Link>
        </section>
      </div>
    </>
  );
}
