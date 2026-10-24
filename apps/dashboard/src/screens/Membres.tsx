import { lienInvitation, useCreationInvitation } from '../api/invitations.js';
import { useMembres } from '../api/membres.js';
import { useSession } from '../api/session.js';
import { CopyableValue, ErrorMessage, Loading, PageHeader } from '../layout/ui.js';

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
              Valable jusqu’au {dateLongue(invitation.data.expireLe)}, pour un seul compte. Un
              nouveau lien ne révoque pas les précédents.
            </p>
          </div>
        ) : null}
        <ListeMembres />
      </div>
    </section>
  );
}

const dateDuJour = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'long' });

function ListeMembres() {
  const membres = useMembres();
  const { data: moi } = useSession();
  if (membres.isPending) return <Loading />;
  if (membres.isError) {
    return <ErrorMessage erreur={membres.error} onRetry={() => void membres.refetch()} />;
  }
  return (
    <ul className="liste membres" aria-label="Membres de l’Instance">
      {membres.data.map((membre) => (
        <li key={membre.id}>
          <span className="membre-email">
            {membre.email}
            {membre.id === moi?.id ? <span className="discret"> (vous)</span> : null}
          </span>
          <span className="discret">Membre depuis le {dateDuJour(membre.depuis)}</span>
        </li>
      ))}
    </ul>
  );
}
