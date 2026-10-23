import { Navigate } from 'react-router';
import { useEtatSetup, useSetup } from '../api/session.js';
import { PagePublique } from '../mise-en-page/Layout.js';
import { Chargement, MessageErreur } from '../mise-en-page/ui.js';
import { FormulaireCompte } from './FormulaireCompte.js';

/** Premier lancement : le premier Membre crée son compte. Fermé ensuite. */
export function Setup() {
  const etat = useEtatSetup();
  const setup = useSetup();

  if (setup.isSuccess) return <Navigate to="/projets" replace />;
  if (etat.isPending) return <Chargement />;
  if (etat.isError) return <MessageErreur erreur={etat.error} />;
  if (!etat.data.requis) return <Navigate to="/connexion" replace />;
  return (
    <PagePublique titre="Créer le premier compte">
      <p>Cette Instance n’a encore aucun Membre. Le compte créé ici pourra inviter les autres.</p>
      <FormulaireCompte
        action="Créer le compte"
        nouveauCompte
        enCours={setup.isPending}
        erreur={setup.error}
        onSubmit={(identifiants) => setup.mutate(identifiants)}
      />
    </PagePublique>
  );
}
