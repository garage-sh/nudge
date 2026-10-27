import { DASHBOARD_LIMITS } from '@nudge/shared';
import { useState } from 'react';
import { Navigate } from 'react-router';
import { useSetupState, useSetup } from '../api/session.js';
import { useT } from '../i18n/index.js';
import { PublicPage } from '../layout/Layout.js';
import { Loading, ErrorMessage, Field } from '../layout/ui.js';
import { AccountForm } from './AccountForm.js';

/**
 * First launch: the first Member creates their account, with the setup token the
 * server prints in its logs. Closed afterwards.
 */
export function Setup() {
  const t = useT();
  const state = useSetupState();
  const setup = useSetup();
  const [setupToken, setSetupToken] = useState('');

  if (setup.isSuccess) return <Navigate to="/projects" replace />;
  if (state.isPending || state.isError) {
    return (
      <PublicPage title={t.setup.title}>
        {state.isPending ? <Loading /> : null}
        <ErrorMessage error={state.error} onRetry={() => void state.refetch()} />
      </PublicPage>
    );
  }
  if (!state.data.required) return <Navigate to="/sign-in" replace />;
  return (
    <PublicPage title={t.setup.title}>
      <p>{t.setup.intro}</p>
      <AccountForm
        action={t.setup.submit}
        newAccount
        pending={setup.isPending}
        error={setup.error}
        onSubmit={(credentials) => setup.mutate({ ...credentials, setupToken })}
      >
        <Field
          label={t.setup.token}
          autoComplete="off"
          spellCheck={false}
          required
          maxLength={DASHBOARD_LIMITS.setupToken}
          help={t.setup.tokenHelp}
          value={setupToken}
          onChange={(e) => setSetupToken(e.target.value)}
        />
      </AccountForm>
    </PublicPage>
  );
}
