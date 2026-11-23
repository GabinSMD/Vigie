import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <>
      <header className="head">
        <h1 className="h1">Page introuvable</h1>
      </header>
      <div className="body">
        <p className="det strong-ink">Ce lien ne mène à rien, ou l'élément n'existe plus.</p>
        <Link className="btn pri big" to="/">
          Revenir à « À faire »
        </Link>
      </div>
    </>
  );
}
