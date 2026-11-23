import { Link } from 'react-router-dom';
import { useStore } from '../data/store';
import type { Project } from '../data/types';
import { CostGauge } from './CostGauge';
import { StatusPill } from './StatusPill';

/** Une carte par projet : nom, pastille, compteurs, jauge de coût. Toute la carte est le lien. */
export function ProjectCard({ project }: { project: Project }) {
  const { settings } = useStore().state;
  const cap = settings.projectCaps[project.id] ?? project.costCap;
  return (
    <Link className="card" to={`/projets/${project.id}`}>
      <div className="row sp">
        <h2 className="h2">{project.name}</h2>
        <StatusPill status={project.status} label={project.statusLabel} />
      </div>
      <p className="det">{project.line}</p>
      <CostGauge label="Coût du jour" cost={project.costToday} cap={cap} threshold={settings.threshold} />
    </Link>
  );
}
