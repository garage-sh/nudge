import { DASHBOARD_LIMITS } from '@nudge/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useT } from '../i18n/index.js';
import { Field, ErrorMessage } from '../layout/ui.js';

/**
 * Email + password: sign in, or create an account (setup, invitation). `children`: the
 * fields a flow adds before them (the setup token).
 */
export function AccountForm({
  action,
  newAccount,
  pending,
  error,
  onSubmit,
  children,
}: {
  action: string;
  newAccount: boolean;
  pending: boolean;
  error: unknown;
  onSubmit: (credentials: { email: string; password: string }) => void;
  children?: ReactNode;
}) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ email, password });
  };
  return (
    <form onSubmit={submit} className="form">
      {children}
      <Field
        label={t.account.email}
        type="email"
        autoComplete={newAccount ? 'email' : 'username'}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        label={t.account.password}
        type="password"
        autoComplete={newAccount ? 'new-password' : 'current-password'}
        required
        minLength={newAccount ? DASHBOARD_LIMITS.passwordMin : undefined}
        help={newAccount ? t.account.passwordHelp(DASHBOARD_LIMITS.passwordMin) : undefined}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <ErrorMessage error={error} />
      <button type="submit" disabled={pending}>
        {action}
      </button>
    </form>
  );
}
