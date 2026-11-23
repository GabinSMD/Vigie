import { CostGauge } from '../components/CostGauge';
import { ProjectCard } from '../components/ProjectCard';
import { projects, totalCostToday } from '../data/mock';
import { useStore } from '../data/store';

export function Projets() {
  const { state } = useStore();
  const { sessionCap, costCap, threshold } = state.settings;
  return (
    <>
      <header className="head">
        <div>
          <h1 className="h1">Projets</h1>
          <p className="det" style={{ marginTop: 4 }}>
            {state.sessionsToday} sessions lancées aujourd'hui sur {sessionCap} permises
          </p>
        </div>
      </header>
      <div className="body">
        <section className="card" aria-label="Coût du jour, tous projets">
          <CostGauge label="Coût du jour, tous projets" cost={totalCostToday()} cap={costCap} threshold={threshold} />
          <p className="det">Le premier plafond atteint met les sessions en pause.</p>
        </section>
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </>
  );
}
