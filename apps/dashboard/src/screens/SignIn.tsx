import { Navigate, useLocation } from 'react-router';
import { useSetupState, useSession, useSignIn } from '../api/session.js';
import { useT } from '../i18n/index.js';
import { PublicPage } from '../layout/Layout.js';
import { Loading } from '../layout/ui.js';
import type { FromState } from '../session/RequireSession.js';
import { AccountForm } from './AccountForm.js';

export function SignIn() {
  const t = useT();
  const session = useSession();
  const setup = useSetupState();
  const signIn = useSignIn();
  const from = (useLocation().state as FromState | null)?.from ?? '/feedbacks';

  if (session.data) return <Navigate to={from} replace />;
  if (session.isPending || setup.isPending) return <Loading />;
  if (setup.data?.required) return <Navigate to="/setup" replace />;
  return (
    <PublicPage title={t.signIn.title}>
      <AccountForm
        action={t.signIn.submit}
        newAccount={false}
        pending={signIn.isPending}
        error={signIn.error}
        onSubmit={(credentials) => signIn.mutate(credentials)}
      />
    </PublicPage>
  );
}
