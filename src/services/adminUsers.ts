import { auth } from '../firebase';

/** User-facing error from the account-deletion flow; `message` is always short and safe to show inline. */
export class AdminUsersError extends Error {}

/**
 * Sends a full account-delete request to the `/api/admin-users` Vercel
 * Function: removes the target's Firebase Auth login, `users/{uid}` profile,
 * reports, assignment updates, and team-order entry. Only a lead's ID token
 * is accepted server-side; self-delete and deleting the last remaining lead
 * are rejected there too.
 */
export async function deleteUserAccount(uid: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    throw new AdminUsersError('You must be signed in to manage the team.');
  }

  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch {
    throw new AdminUsersError('Could not verify your session. Please try again.');
  }

  let response: Response;
  try {
    response = await fetch('/api/admin-users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ action: 'delete', uid }),
    });
  } catch {
    throw new AdminUsersError('Account deletion is unavailable right now. Please try again.');
  }

  if (response.ok) {
    return;
  }

  if (response.status === 401) {
    throw new AdminUsersError('Your session expired. Please sign in again.');
  }
  if (response.status === 403) {
    throw new AdminUsersError('Only a lead can delete a team member.');
  }
  if (response.status === 404) {
    throw new AdminUsersError('Account deletion is not available here. Run the app with `vercel dev`.');
  }

  const failure = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new AdminUsersError(failure?.error ?? 'Account deletion failed. Please try again.');
}
