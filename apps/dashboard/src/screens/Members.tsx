import { DASHBOARD_LIMITS, type MemberView } from '@nudge/shared';
import { useState, type FormEvent } from 'react';
import { invitationUrl, useCreateInvitation } from '../api/invitations.js';
import { useMembers, useRemoveMember } from '../api/members.js';
import { useChangePassword, useSession, useSignOutOthers } from '../api/session.js';
import { useI18n, useT } from '../i18n/index.js';
import {
  ConfirmAction,
  CopyableValue,
  ErrorMessage,
  Field,
  Loading,
  PageHeader,
} from '../layout/ui.js';

/**
 * The Instance's Members: invite one (a single-use link, sent by hand, no email in v1),
 * remove one, and the signed-in Member's own account (password, other sessions).
 */
export function Members() {
  const { t, format } = useI18n();
  const invitation = useCreateInvitation();
  const { data: me } = useSession();
  return (
    <section>
      <PageHeader
        title={t.members.title}
        description={t.members.description}
        actions={
          <button type="button" disabled={invitation.isPending} onClick={() => invitation.mutate()}>
            {t.members.generate}
          </button>
        }
      />
      <div className="settings">
        <ErrorMessage error={invitation.error} />
        {invitation.data ? (
          <div className="panel" role="status">
            <h2>{t.members.invitationLink}</h2>
            <CopyableValue
              label={t.members.invitationLink}
              value={invitationUrl(invitation.data.token)}
            />
            <p className="help">
              {t.members.validUntil(format.longDateTime(invitation.data.expiresAt))}
            </p>
          </div>
        ) : null}
        <MemberList />
        {me ? <PasswordChange me={me} /> : null}
        {me ? <OtherSessions /> : null}
      </div>
    </section>
  );
}

function MemberList() {
  const { t, format } = useI18n();
  const members = useMembers();
  const removal = useRemoveMember();
  const { data: me } = useSession();
  if (members.isPending) return <Loading />;
  if (members.isError) {
    return <ErrorMessage error={members.error} onRetry={() => void members.refetch()} />;
  }
  return (
    <>
      <ErrorMessage error={removal.error} />
      <p role="status" className="save-status">
        {removal.isSuccess ? t.members.removed(removal.variables.email) : ''}
      </p>
      <ul className="list members" aria-label={t.members.list}>
        {members.data.map((member) => (
          <li key={member.id}>
            <span className="member-email">
              {member.email}
              {member.id === me?.id ? <span className="muted">{t.members.you}</span> : null}
            </span>
            <span className="member-side">
              <span className="muted">{t.members.since(format.longDate(member.since))}</span>
              {/* Removing oneself is refused: another Member does it. */}
              {member.id === me?.id ? null : (
                <ConfirmAction
                  label={t.members.remove}
                  accessibleLabel={t.members.removeLabel(member.email)}
                  question={t.members.removeQuestion(member.email)}
                  pending={removal.isPending}
                  onConfirm={() => removal.mutate(member)}
                />
              )}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Change one's password: the current one is required; the other sessions end. */
function PasswordChange({ me }: { me: MemberView }) {
  const t = useT();
  const a = t.ownAccount;
  const change = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword('');
          setNewPassword('');
        },
      },
    );
  };
  return (
    <form
      onSubmit={submit}
      onChange={() => change.reset()}
      className="form panel"
      aria-labelledby="account-password"
    >
      <h2 id="account-password">{a.title}</h2>
      {/* For password managers: the account whose password changes. */}
      <input type="email" autoComplete="username" value={me.email} readOnly hidden />
      <Field
        label={a.currentPassword}
        type="password"
        autoComplete="current-password"
        required
        maxLength={DASHBOARD_LIMITS.passwordMax}
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
      />
      <Field
        label={a.newPassword}
        type="password"
        autoComplete="new-password"
        required
        minLength={DASHBOARD_LIMITS.passwordMin}
        maxLength={DASHBOARD_LIMITS.passwordMax}
        help={t.account.passwordHelp(DASHBOARD_LIMITS.passwordMin)}
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
      />
      <ErrorMessage error={change.error} />
      <div className="actions">
        <button type="submit" disabled={change.isPending}>
          {a.changePassword}
        </button>
      </div>
      <p role="status" className="save-status">
        {change.isSuccess ? a.passwordChanged : ''}
      </p>
    </form>
  );
}

/** "Sign out everywhere else": every session of the Member but this one ends. */
function OtherSessions() {
  const a = useT().ownAccount;
  const signOut = useSignOutOthers();
  return (
    <section className="panel form" aria-labelledby="account-sessions">
      <h2 id="account-sessions">{a.sessionsTitle}</h2>
      <p className="help">{a.sessionsHelp}</p>
      <ErrorMessage error={signOut.error} />
      <div className="actions">
        <button type="button" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
          {a.signOutOthers}
        </button>
      </div>
      <p role="status" className="save-status">
        {signOut.data ? a.signedOutOthers(signOut.data.revoked) : ''}
      </p>
    </section>
  );
}
