import { Link } from 'react-router';
import { EmptyState, PageHeader } from '../layout/ui.js';

/** Une adresse qui ne mène à aucun écran : le dire, et ramener à la Boîte de réception. */
export function PageIntrouvable() {
  return (
    <section>
      <PageHeader titre="Page introuvable" />
      <EmptyState
        titre="Cette adresse ne mène à aucun écran."
        action={<Link to="/retours">Revenir à la Boîte de réception</Link>}
      >
        Le lien est peut-être incomplet, ou l’élément a été supprimé.
      </EmptyState>
    </section>
  );
}
