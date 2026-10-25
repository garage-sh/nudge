import { invitationUrl, useCreateInvitation } from '../api/invitations.js';
import { useMembers } from '../api/members.js';
import { useSession } from '../api/session.js';
import { useI18n } from '../i18n/index.js';
import { CopyableValue, ErrorMessage, Loading, PageHeader } from '../layout/ui.js';

/** Invite a Member: a single-use link, sent by hand (no email in v1). */
export function Members() {
  const { t, format } = useI18n();
  const invitation = useCreateInvitation();
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
      </div>
    </section>
  );
}

function MemberList() {
  const { t, format } = useI18n();
  const members = useMembers();
  const { data: me } = useSession();
  if (members.isPending) return <Loading />;
  if (members.isError) {
    return <ErrorMessage error={members.error} onRetry={() => void members.refetch()} />;
  }
  return (
    <ul className="list members" aria-label={t.members.list}>
      {members.data.map((member) => (
        <li key={member.id}>
          <span className="member-email">
            {member.email}
            {member.id === me?.id ? <span className="muted">{t.members.you}</span> : null}
          </span>
          <span className="muted">{t.members.since(format.longDate(member.since))}</span>
        </li>
      ))}
    </ul>
  );
}
