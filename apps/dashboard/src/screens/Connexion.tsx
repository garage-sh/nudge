import { Navigate, useLocation } from 'react-router';
import { useConnexion, useEtatSetup, useSession } from '../api/session.js';
import { PublicPage } from '../layout/Layout.js';
import { Loading } from '../layout/ui.js';
import type { DepuisState } from '../session/RequireSession.js';
import { AccountForm } from './AccountForm.js';

export function Connexion() {
  const session = useSession();
  const etat = useEtatSetup();
  const connexion = useConnexion();
  const depuis = (useLocation().state as DepuisState | null)?.depuis ?? '/retours';

  if (session.data) return <Navigate to={depuis} replace />;
  if (session.isPending || etat.isPending) return <Loading />;
  if (etat.data?.requis) return <Navigate to="/setup" replace />;
  return (
    <PublicPage titre="Connexion">
      <AccountForm
        action="Se connecter"
        nouveauCompte={false}
        enCours={connexion.isPending}
        erreur={connexion.error}
        onSubmit={(identifiants) => connexion.mutate(identifiants)}
      />
    </PublicPage>
  );
}
