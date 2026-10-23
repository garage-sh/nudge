import { Navigate, useLocation } from 'react-router';
import { useConnexion, useEtatSetup, useSession } from '../api/session.js';
import { PagePublique } from '../mise-en-page/Layout.js';
import { Chargement } from '../mise-en-page/ui.js';
import type { DepuisState } from '../session/RequireSession.js';
import { FormulaireCompte } from './FormulaireCompte.js';

export function Connexion() {
  const session = useSession();
  const etat = useEtatSetup();
  const connexion = useConnexion();
  const depuis = (useLocation().state as DepuisState | null)?.depuis ?? '/projets';

  if (session.data) return <Navigate to={depuis} replace />;
  if (session.isPending || etat.isPending) return <Chargement />;
  if (etat.data?.requis) return <Navigate to="/setup" replace />;
  return (
    <PagePublique titre="Connexion">
      <FormulaireCompte
        action="Se connecter"
        nouveauCompte={false}
        enCours={connexion.isPending}
        erreur={connexion.error}
        onSubmit={(identifiants) => connexion.mutate(identifiants)}
      />
    </PagePublique>
  );
}
