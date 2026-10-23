import { Link, Navigate, useParams } from 'react-router';
import { useInvitation } from '../api/invitations.js';
import { useAcceptationInvitation } from '../api/session.js';
import { PagePublique } from '../mise-en-page/Layout.js';
import { Chargement, MessageErreur } from '../mise-en-page/ui.js';
import { FormulaireCompte } from './FormulaireCompte.js';

/** Page du lien d'invitation : la personne invitée crée son compte de Membre. */
export function Invitation() {
  const jeton = useParams().jeton ?? '';
  const invitation = useInvitation(jeton);
  const acceptation = useAcceptationInvitation(jeton);

  if (acceptation.isSuccess) return <Navigate to="/projets" replace />;
  if (invitation.isPending) return <Chargement />;
  if (invitation.isError) {
    return (
      <PagePublique titre="Invitation">
        <MessageErreur erreur={invitation.error} />
        <p>
          Demandez un nouveau lien à un Membre, ou <Link to="/connexion">connectez-vous</Link>.
        </p>
      </PagePublique>
    );
  }
  return (
    <PagePublique titre="Rejoindre l’Instance">
      <p>Vous êtes invité à rejoindre cette Instance nudge. Créez votre compte de Membre.</p>
      <FormulaireCompte
        action="Créer mon compte"
        nouveauCompte
        enCours={acceptation.isPending}
        erreur={acceptation.error}
        onSubmit={(identifiants) => acceptation.mutate(identifiants)}
      />
    </PagePublique>
  );
}
