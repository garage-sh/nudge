import { lienInvitation, useCreationInvitation } from '../api/invitations.js';
import { MessageErreur, ValeurCopiable } from '../mise-en-page/ui.js';

const dateLongue = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

/** Inviter un Membre : un lien à usage unique, transmis à la main (pas d'email en v1). */
export function Membres() {
  const invitation = useCreationInvitation();
  return (
    <section>
      <h1>Membres</h1>
      <p>
        Tous les Membres voient tous les Projets. Pour inviter quelqu’un, générez un lien et
        transmettez-le lui : il sert une seule fois.
      </p>
      <button type="button" disabled={invitation.isPending} onClick={() => invitation.mutate()}>
        Générer un lien d’invitation
      </button>
      <MessageErreur erreur={invitation.error} />
      {invitation.data ? (
        <div className="encadre">
          <ValeurCopiable
            libelle="Lien d’invitation"
            valeur={lienInvitation(invitation.data.jeton)}
          />
          <p className="aide">Valable jusqu’au {dateLongue(invitation.data.expireLe)}.</p>
        </div>
      ) : null}
    </section>
  );
}
