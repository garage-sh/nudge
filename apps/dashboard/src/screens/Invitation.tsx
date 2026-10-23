import { Link, Navigate, useParams } from 'react-router';
import { useInvitation } from '../api/invitations.js';
import { useAcceptationInvitation } from '../api/session.js';
import { PublicPage } from '../layout/Layout.js';
import { Loading, ErrorMessage } from '../layout/ui.js';
import { AccountForm } from './AccountForm.js';

/** Page du lien d'invitation : la personne invitée crée son compte de Membre. */
export function Invitation() {
  const jeton = useParams().jeton ?? '';
  const invitation = useInvitation(jeton);
  const acceptation = useAcceptationInvitation(jeton);

  if (acceptation.isSuccess) return <Navigate to="/projets" replace />;
  if (invitation.isPending) return <Loading />;
  if (invitation.isError) {
    return (
      <PublicPage titre="Invitation">
        <ErrorMessage erreur={invitation.error} />
        <p>
          Demandez un nouveau lien à un Membre, ou <Link to="/connexion">connectez-vous</Link>.
        </p>
      </PublicPage>
    );
  }
  return (
    <PublicPage titre="Rejoindre l’Instance">
      <p>Vous êtes invité à rejoindre cette Instance nudge. Créez votre compte de Membre.</p>
      <AccountForm
        action="Créer mon compte"
        nouveauCompte
        enCours={acceptation.isPending}
        erreur={acceptation.error}
        onSubmit={(identifiants) => acceptation.mutate(identifiants)}
      />
    </PublicPage>
  );
}
