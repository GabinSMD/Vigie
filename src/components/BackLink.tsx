import { Link } from 'react-router-dom';
import { Icon } from './Icon';

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <div style={{ padding: '8px 8px 0' }}>
      <Link className="back" to={to}>
        <Icon name="back" className="" />
        {label}
      </Link>
    </div>
  );
}
