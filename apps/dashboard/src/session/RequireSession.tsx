import { Navigate, Outlet, useLocation } from 'react-router';
import { useEtatSetup, useSession } from '../api/session.js';
import { Loading, ErrorMessage } from '../layout/ui.js';

/** État de navigation posé par la redirection vers la connexion. */
export interface DepuisState {
  readonly depuis?: string;
}

/**
 * Garde des routes connectées. Sans session : vers le setup tant qu'aucun
 * Membre n'existe, sinon vers la connexion, qui ramène ensuite à la page demandée.
 */
export function RequireSession() {
  const session = useSession();
  const location = useLocation();
  const setup = useEtatSetup({ enabled: session.data === null });

  if (session.isPending) return <Loading />;
  if (session.isError) return <ErrorMessage erreur={session.error} />;
  if (session.data) return <Outlet />;
  if (setup.isPending) return <Loading />;
  if (setup.data?.requis) return <Navigate to="/setup" replace />;
  const depuis: DepuisState = { depuis: `${location.pathname}${location.search}` };
  return <Navigate to="/connexion" replace state={depuis} />;
}
