import { Navigate, Outlet, useLocation } from 'react-router';
import { useEtatSetup, useSession } from '../api/session.js';
import { Chargement, MessageErreur } from '../mise-en-page/ui.js';

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

  if (session.isPending) return <Chargement />;
  if (session.isError) return <MessageErreur erreur={session.error} />;
  if (session.data) return <Outlet />;
  if (setup.isPending) return <Chargement />;
  if (setup.data?.requis) return <Navigate to="/setup" replace />;
  const depuis: DepuisState = { depuis: `${location.pathname}${location.search}` };
  return <Navigate to="/connexion" replace state={depuis} />;
}
