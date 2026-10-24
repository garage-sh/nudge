import { lienInvitation, useCreationInvitation } from '../api/invitations.js';
import { CopyableValue, EmptyState, ErrorMessage, PageHeader } from '../layout/ui.js';

const dateLongue = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

/** Inviter un Membre : un lien à usage unique, transmis à la main (pas d'email en v1). */
export function Membres() {
  const invitation = useCreationInvitation();
  return (
    <section>
      <PageHeader
        titre="Membres"
        description="Tous les Membres voient tous les Projets. Pour inviter quelqu’un, générez un lien et transmettez-le lui : il sert une seule fois."
        actions={
          <button type="button" disabled={invitation.isPending} onClick={() => invitation.mutate()}>
            Générer un lien d’invitation
          </button>
        }
      />
      <div className="reglages">
        <ErrorMessage erreur={invitation.error} />
        {invitation.data ? (
          <div className="encadre" role="status">
            <h2>Lien d’invitation</h2>
            <CopyableValue
              libelle="Lien d’invitation"
              valeur={lienInvitation(invitation.data.jeton)}
            />
            <p className="aide">
              Valable jusqu’au {dateLongue(invitation.data.expireLe)}, pour un seul compte.
            </p>
          </div>
        ) : (
          <EmptyState titre="Aucune invitation en cours.">
            Le lien généré s’affiche ici, prêt à copier. Il n’est envoyé à personne : transmettez-le
            vous-même.
          </EmptyState>
        )}
      </div>
    </section>
  );
}
