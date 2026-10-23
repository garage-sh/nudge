import { Navigate } from 'react-router';
import { useEtatSetup, useSetup } from '../api/session.js';
import { PublicPage } from '../layout/Layout.js';
import { Loading, ErrorMessage } from '../layout/ui.js';
import { AccountForm } from './AccountForm.js';

/** Premier lancement : le premier Membre crée son compte. Fermé ensuite. */
export function Setup() {
  const etat = useEtatSetup();
  const setup = useSetup();

  if (setup.isSuccess) return <Navigate to="/projets" replace />;
  if (etat.isPending) return <Loading />;
  if (etat.isError) return <ErrorMessage erreur={etat.error} />;
  if (!etat.data.requis) return <Navigate to="/connexion" replace />;
  return (
    <PublicPage titre="Créer le premier compte">
      <p>Cette Instance n’a encore aucun Membre. Le compte créé ici pourra inviter les autres.</p>
      <AccountForm
        action="Créer le compte"
        nouveauCompte
        enCours={setup.isPending}
        erreur={setup.error}
        onSubmit={(identifiants) => setup.mutate(identifiants)}
      />
    </PublicPage>
  );
}
