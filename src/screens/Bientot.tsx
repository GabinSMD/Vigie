import { Link } from 'react-router-dom';

/** Onglets prévus par les maquettes mais hors du premier livrable. */
export function Bientot({ title }: { title: string }) {
  return (
    <>
      <header className="head">
        <h1 className="h1">{title}</h1>
      </header>
      <div className="state">
        <h2 className="h2">Cet écran arrive bientôt</h2>
        <p className="det" style={{ maxWidth: 320 }}>
          Il fait partie d'un prochain livrable. En attendant, tout se pilote depuis « À faire » et « Projets ».
        </p>
        <Link className="btn pri big" to="/">
          Revenir à « À faire »
        </Link>
      </div>
    </>
  );
}
