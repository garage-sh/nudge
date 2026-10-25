import { Link } from 'react-router';
import { useT } from '../i18n/index.js';
import { EmptyState, PageHeader } from '../layout/ui.js';

/** An address that leads to no screen: say so, and bring back to the Inbox. */
export function NotFound() {
  const t = useT();
  return (
    <section>
      <PageHeader title={t.notFound.title} />
      <EmptyState title={t.notFound.empty} action={<Link to="/feedbacks">{t.notFound.back}</Link>}>
        {t.notFound.help}
      </EmptyState>
    </section>
  );
}
