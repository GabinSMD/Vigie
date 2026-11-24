import { useState } from 'react';
import { CostGauge } from '../components/CostGauge';
import { Icon } from '../components/Icon';
import { Stepper } from '../components/Stepper';
import { Switch } from '../components/Switch';
import { ActionButton } from '../components/ActionButton';
import { useData } from '../data/source';
import { LIMITS, useStore, type SettingsPatch } from '../data/store';
import { formatCap, formatCost } from '../lib/format';
import { AutoMergeSheet } from '../sheets/AutoMergeSheet';

const QUICK_COST_CAPS = [5, 10, 20, 50];

/** Autonomie des agents, budgets et alertes. Aucun bouton plein : chaque réglage s'applique tout de suite. */
export function Reglages() {
  const { live } = useData();
  if (live) return <ReglagesLecture />;
  return <ReglagesDemo />;
}

/** Données réelles (étape 1) : aucun réglage n'est appliqué, les coûts sont masqués (D7). */
function ReglagesLecture() {
  return (
    <>
      <header className="head">
        <div>
          <h1 className="h1">Réglages</h1>
          <p className="det" style={{ marginTop: 4 }}>
            Lecture seule
          </p>
        </div>
      </header>
      <div className="body">
        <section className="card" aria-label="Réglages à venir">
          <span className="k">Bientôt</span>
          <p style={{ margin: 0 }}>
            Les plafonds de sessions, la fusion automatique et les alertes seront appliqués par le pilote (étapes 2 à 4).
            Les coûts ne sont pas affichés dans cette version.
          </p>
          <ActionButton live className="btn full">
            Modifier les réglages
          </ActionButton>
        </section>
      </div>
    </>
  );
}

function ReglagesDemo() {
  const { projects, totalCostToday } = useData();
  const { state, dispatch } = useStore();
  const [confirming, setConfirming] = useState<string | null>(null);
  const { settings } = state;
  const set = (patch: SettingsPatch) => dispatch({ type: 'settings', patch });
  const total = totalCostToday();

  return (
    <>
      <header className="head">
        <div>
          <h1 className="h1">Réglages</h1>
          <p className="det" style={{ marginTop: 4 }}>
            Autonomie, budgets et alertes
          </p>
        </div>
      </header>
      <div className="body">
        <section className="card" aria-labelledby="reg-globaux">
          <h2 id="reg-globaux" className="k">
            Plafonds globaux, par jour
          </h2>
          <Stepper
            title="Sessions lancées"
            label="le plafond de sessions"
            detail={`Aujourd'hui : ${state.sessionsToday}`}
            value={settings.sessionCap}
            {...LIMITS.sessionCap}
            onChange={(sessionCap) => set({ sessionCap })}
          />
          <Stepper
            title="Coût, tous projets"
            label="le plafond de coût global"
            detail={`Aujourd'hui : ${formatCost(total)}`}
            value={settings.costCap}
            display={formatCap(settings.costCap)}
            {...LIMITS.costCap}
            onChange={(costCap) => set({ costCap })}
          />
          <div className="chips" role="group" aria-label="Plafond global rapide">
            {QUICK_COST_CAPS.map((v) => (
              <button
                key={v}
                type="button"
                className="chip"
                aria-pressed={settings.costCap === v}
                aria-label={`Plafond global ${v} dollars`}
                onClick={() => set({ costCap: v })}
              >
                {formatCap(v)}
              </button>
            ))}
          </div>
          <CostGauge label="Consommé, tous projets" cost={total} cap={settings.costCap} threshold={settings.threshold} />
        </section>

        <section className="card" aria-labelledby="reg-projets" style={{ gap: 4 }}>
          <h2 id="reg-projets" className="k">
            Par projet : fusion automatique et plafond
          </h2>
          {projects.map((p) => {
            const auto = settings.autoMerge.includes(p.id);
            const cap = settings.projectCaps[p.id] ?? p.costCap;
            return (
              <div key={p.id} className="proj-cap">
                <Switch
                  checked={auto}
                  title={p.name}
                  detail={`Fusion automatique · aujourd'hui ${formatCost(p.costToday)}`}
                  onLabel="Auto"
                  offLabel="Manuelle"
                  onChange={(next) => (next ? setConfirming(p.id) : dispatch({ type: 'autoMerge', projectId: p.id, on: false }))}
                />
                <Stepper
                  title={<span className="det strong-ink" style={{ fontWeight: 400 }}>Plafond par jour</span>}
                  label={`le plafond de ${p.name}`}
                  value={cap}
                  display={formatCap(cap)}
                  {...LIMITS.projectCap}
                  onChange={(next) => dispatch({ type: 'projectCap', projectId: p.id, cap: next })}
                />
              </div>
            );
          })}
          <div className="guard" style={{ marginTop: 8 }}>
            <Icon name="shield" />
            <div>
              <b>Garde-fous</b>
              <span className="det strong-ink">
                Fusion automatique : seulement PR pas en brouillon, CI verte, branche principale.
              </span>
            </div>
          </div>
        </section>

        <section className="card" aria-labelledby="reg-alertes">
          <h2 id="reg-alertes" className="k">
            Alertes
          </h2>
          <Switch
            checked={settings.push}
            title="Notification push"
            detail="Blocage, PR prête, plafond"
            onChange={(push) => set({ push })}
          />
          <Stepper
            title="Prévenir à"
            label="le seuil d'alerte"
            detail="du plafond de coût"
            value={settings.threshold}
            display={`${settings.threshold} %`}
            {...LIMITS.threshold}
            onChange={(threshold) => set({ threshold })}
          />
          <p className="det strong-ink">
            {settings.threshold} % = {formatCost((settings.costCap * settings.threshold) / 100)} sur{' '}
            {formatCap(settings.costCap)} (tous projets)
          </p>
        </section>
      </div>

      <AutoMergeSheet projectId={confirming} onClose={() => setConfirming(null)} />
    </>
  );
}
