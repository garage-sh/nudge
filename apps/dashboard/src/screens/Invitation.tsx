import { Link, Navigate, useParams } from 'react-router';
import { useInvitation } from '../api/invitations.js';
import { useAcceptInvitation } from '../api/session.js';
import { useT } from '../i18n/index.js';
import { PublicPage } from '../layout/Layout.js';
import { Loading, ErrorMessage } from '../layout/ui.js';
import { AccountForm } from './AccountForm.js';

/** The invitation link's page: the invited person creates their Member account. */
export function Invitation() {
  const t = useT();
  const token = useParams().token ?? '';
  const invitation = useInvitation(token);
  const acceptance = useAcceptInvitation(token);

  if (acceptance.isSuccess) return <Navigate to="/projects" replace />;
  if (invitation.isPending) return <Loading />;
  if (invitation.isError) {
    return (
      <PublicPage title={t.invitation.title}>
        <ErrorMessage error={invitation.error} />
        <p>
          {t.invitation.askAgainBefore}
          <Link to="/sign-in">{t.invitation.signInLink}</Link>
          {t.invitation.askAgainAfter}
        </p>
      </PublicPage>
    );
  }
  return (
    <PublicPage title={t.invitation.joinTitle}>
      <p>{t.invitation.intro}</p>
      <AccountForm
        action={t.invitation.submit}
        newAccount
        pending={acceptance.isPending}
        error={acceptance.error}
        onSubmit={(credentials) => acceptance.mutate(credentials)}
      />
    </PublicPage>
  );
}
