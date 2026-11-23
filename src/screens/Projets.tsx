import { CostGauge } from '../components/CostGauge';
import { ProjectCard } from '../components/ProjectCard';
import { DAILY_SESSION_CAP, GLOBAL_COST_CAP, SESSIONS_TODAY, projects, totalCostToday } from '../data/mock';

export function Projets() {
  return (
    <>
      <header className="head">
        <div>
          <h1 className="h1">Projets</h1>
          <p className="det" style={{ marginTop: 4 }}>
            {SESSIONS_TODAY} sessions lancées aujourd'hui sur {DAILY_SESSION_CAP} permises
          </p>
        </div>
      </header>
      <div className="body">
        <section className="card" aria-label="Coût du jour, tous projets">
          <CostGauge label="Coût du jour, tous projets" cost={totalCostToday()} cap={GLOBAL_COST_CAP} />
          <p className="det">Le premier plafond atteint met les sessions en pause.</p>
        </section>
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </>
  );
}
