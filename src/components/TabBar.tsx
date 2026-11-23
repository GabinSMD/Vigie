import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { plural } from '../lib/format';

const tabs: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'À faire', icon: 'todo', end: true },
  { to: '/projets', label: 'Projets', icon: 'projects' },
  { to: '/lancer', label: 'Lancer', icon: 'plus' },
  { to: '/reglages', label: 'Réglages', icon: 'settings' },
];

/** Barre d'onglets basse, 4 destinations à portée du pouce ; rail à gauche sur bureau. */
export function TabBar({ todoCount }: { todoCount: number }) {
  return (
    <nav className="tabbar" aria-label="Navigation principale">
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className="tab">
          <Icon name={tab.icon} className="" />
          {tab.label}
          {tab.to === '/' && todoCount > 0 && (
            <span className="cnt">
              {todoCount}
              <span className="sr-only"> : {plural(todoCount, 'élément')} en attente</span>
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
