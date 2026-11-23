import { COST_ALERT_THRESHOLD } from '../data/mock';
import { formatCap, formatCost, gauge } from '../lib/format';

interface Props {
  label: string;
  cost: number;
  cap: number;
}

/** Jauge de coût : chiffre écrit en toutes lettres, la barre ne fait que l'illustrer. */
export function CostGauge({ label, cost, cap }: Props) {
  const { pct, level } = gauge(cost, cap, COST_ALERT_THRESHOLD);
  const barClass = level === 'plafond' ? 'blk' : level === 'alerte' ? 'warn' : undefined;
  return (
    <>
      <div className="row sp det">
        <span>{label}</span>
        <span>
          <b className="strong-ink">{formatCost(cost)}</b> sur {formatCap(cap)}
        </span>
      </div>
      <div className="bar" aria-hidden="true">
        <i className={barClass} style={{ width: `${pct}%` }} />
      </div>
    </>
  );
}
