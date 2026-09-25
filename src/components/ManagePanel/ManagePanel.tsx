import { useState } from 'react';
import { updateUserRole } from '../../services/firestore';
import { AdminUsersError, deleteUserAccount } from '../../services/adminUsers';
import { useUserProfiles } from '../../hooks/useUserProfiles';
import type { UserRole } from '../../types';

interface ManagePanelProps {
  currentUserId: string;
  onBack: () => void;
}

// Lead-only panel (routed to by App.tsx's Manage team button) listing every
// team member with a role selector and a full-delete action. Role changes
// write straight to Firestore (see the `users/{uid}` update rule in the
// README); deletion goes through `api/admin-users.ts` since it must also
// remove the person's Firebase Auth login.
export function ManagePanel({ currentUserId, onBack }: ManagePanelProps) {
  const { profiles, loading } = useUserProfiles();
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const [roleErrorByUid, setRoleErrorByUid] = useState<Record<string, string>>({});
  const [confirmingUid, setConfirmingUid] = useState<string | null>(null);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const [deleteErrorByUid, setDeleteErrorByUid] = useState<Record<string, string>>({});

  const leadCount = profiles.filter((profile) => profile.role === 'lead').length;

  function clearRoleError(uid: string) {
    setRoleErrorByUid((previous) => {
      if (!(uid in previous)) {
        return previous;
      }
      const next = { ...previous };
      delete next[uid];
      return next;
    });
  }

  function clearDeleteError(uid: string) {
    setDeleteErrorByUid((previous) => {
      if (!(uid in previous)) {
        return previous;
      }
      const next = { ...previous };
      delete next[uid];
      return next;
    });
  }

  async function handleRoleChange(uid: string, currentRole: UserRole, nextRole: UserRole) {
    if (nextRole === currentRole || uid === currentUserId) {
      return;
    }

    if (currentRole === 'lead' && nextRole === 'dev' && leadCount <= 1) {
      setRoleErrorByUid((previous) => ({
        ...previous,
        [uid]: "The last remaining lead can't be demoted.",
      }));
      return;
    }

    clearRoleError(uid);
    setSavingUid(uid);
    try {
      await updateUserRole(uid, nextRole);
    } catch (error) {
      setRoleErrorByUid((previous) => ({
        ...previous,
        [uid]: error instanceof Error ? error.message : 'Could not save the role change.',
      }));
    } finally {
      setSavingUid(null);
    }
  }

  async function handleConfirmDelete(uid: string) {
    clearDeleteError(uid);
    setDeletingUid(uid);
    try {
      await deleteUserAccount(uid);
      setConfirmingUid(null);
    } catch (error) {
      setDeleteErrorByUid((previous) => ({
        ...previous,
        [uid]: error instanceof AdminUsersError ? error.message : 'Could not delete this account.',
      }));
    } finally {
      setDeletingUid(null);
    }
  }

  return (
    <section className="rounded-md border border-line bg-canvas shadow-sm">
      <div className="flex items-center justify-between rounded-t-md border-b border-line bg-canvas-subtle px-4 py-3">
        <h2 className="text-lg font-semibold text-fg">Manage team</h2>
        <button
          className="rounded-md border border-line bg-control px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-control-hover"
          type="button"
          onClick={onBack}
        >
          Back to reports
        </button>
      </div>

      {loading ? (
        <p className="px-4 py-3 text-sm text-fg-muted">Loading team members...</p>
      ) : profiles.length === 0 ? (
        <p className="px-4 py-3 text-sm text-fg-muted">No team members yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {profiles.map((profile) => {
            const isSelf = profile.id === currentUserId;
            const isLastLead = profile.role === 'lead' && leadCount <= 1;
            const roleError = roleErrorByUid[profile.id];
            const deleteError = deleteErrorByUid[profile.id];
            const isConfirming = confirmingUid === profile.id;
            const isDeleting = deletingUid === profile.id;

            return (
              <li className="flex flex-col gap-2 px-4 py-3" key={profile.id}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="truncate text-sm font-medium text-fg">{profile.name}</span>
                    {isSelf ? (
                      <span className="ml-2 rounded-full bg-neutral-muted px-2 py-0.5 text-xs font-medium text-fg-muted">
                        You
                      </span>
                    ) : null}
                  </div>

                  <select
                    className="rounded-md border border-line bg-control px-2 py-1 text-sm text-fg transition hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-60"
                    value={profile.role}
                    disabled={isSelf || isLastLead || savingUid === profile.id}
                    aria-label={`Role for ${profile.name}`}
                    onChange={(event) =>
                      void handleRoleChange(profile.id, profile.role, event.target.value as UserRole)
                    }
                  >
                    <option value="dev">dev</option>
                    <option value="lead">lead</option>
                  </select>

                  {savingUid === profile.id ? <span className="text-xs text-fg-muted">Saving...</span> : null}

                  <RemoveButton
                    label={`Delete ${profile.name}`}
                    onClick={() => setConfirmingUid(profile.id)}
                    disabled={isSelf || isLastLead || isDeleting}
                  />
                </div>

                {roleError ? (
                  <p className="text-xs font-medium text-danger-fg" role="alert">
                    {roleError}
                  </p>
                ) : null}

                {isConfirming ? (
                  <div className="rounded-md border border-danger-emphasis/50 bg-danger-muted px-3 py-2">
                    <p className="text-sm text-fg">
                      Are you sure you want to delete {profile.name}? This removes their account and all their
                      reports.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        className="rounded-md border border-white/15 bg-danger-emphasis px-3 py-1.5 text-sm font-medium text-white transition hover:bg-danger-emphasis/80 disabled:cursor-not-allowed disabled:opacity-60"
                        type="button"
                        disabled={isDeleting}
                        onClick={() => void handleConfirmDelete(profile.id)}
                      >
                        {isDeleting ? 'Deleting...' : 'Yes'}
                      </button>
                      <button
                        className="rounded-md border border-line bg-control px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-60"
                        type="button"
                        disabled={isDeleting}
                        onClick={() => setConfirmingUid(null)}
                      >
                        No
                      </button>
                    </div>
                    {deleteError ? (
                      <p className="mt-2 text-xs font-medium text-danger-fg" role="alert">
                        {deleteError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// Mirrors LeadView's always-visible trash icon button.
function RemoveButton({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-danger-fg transition hover:scale-110 hover:bg-danger-emphasis/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-danger-emphasis disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 disabled:hover:bg-transparent"
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.75 1.75 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z" />
      </svg>
    </button>
  );
}
