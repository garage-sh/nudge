import { Navigate, Outlet, useLocation } from 'react-router';
import { useSetupState, useSession } from '../api/session.js';
import { Loading, ErrorMessage } from '../layout/ui.js';

/** Navigation state set by the redirect to sign in. */
export interface FromState {
  readonly from?: string;
}

/**
 * Guard of the signed-in routes. Without a session: to the setup while no Member
 * exists, otherwise to sign in, which then brings back to the requested page.
 */
export function RequireSession() {
  const session = useSession();
  const location = useLocation();
  const setup = useSetupState({ enabled: session.data === null });

  if (session.isPending) return <Loading />;
  if (session.isError) return <ErrorMessage error={session.error} />;
  if (session.data) return <Outlet />;
  if (setup.isPending) return <Loading />;
  if (setup.data?.required) return <Navigate to="/setup" replace />;
  const from: FromState = { from: `${location.pathname}${location.search}` };
  return <Navigate to="/sign-in" replace state={from} />;
}
