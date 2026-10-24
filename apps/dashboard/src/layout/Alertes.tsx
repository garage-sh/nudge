import { Link } from 'react-router';
import { useAlertes } from '../api/alertes.js';

/**
 * Badges de ce qui attend un Membre : les Retours En revue et chaque Destination
 * Suspendue, avec un lien pour agir. Rien quand rien n'attend, ni quand la lecture
 * échoue (les écrans signalent leurs propres erreurs).
 */
export function Alertes() {
  const { data } = useAlertes();
  if (!data || (data.retoursEnRevue === 0 && data.destinationsSuspendues.length === 0)) {
    return null;
  }
  const { retoursEnRevue, destinationsSuspendues } = data;
  return (
    <section className="bandeau-alertes" aria-label="Alertes">
      {retoursEnRevue > 0 ? (
        <Link className="badge badge-attention" to="/retours?etat=en_revue">
          {retoursEnRevue === 1 ? '1 Retour en revue' : `${retoursEnRevue} Retours en revue`}
        </Link>
      ) : null}
      {destinationsSuspendues.map(({ id, nom, projet }) => (
        <Link
          key={id}
          className="badge badge-attention"
          to={`/projets/${encodeURIComponent(projet.id)}/destinations`}
        >
          Destination suspendue : {nom} ({projet.nom})
        </Link>
      ))}
    </section>
  );
}
