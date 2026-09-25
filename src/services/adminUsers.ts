import { auth } from '../firebase';
import type { UserRole } from '../types';

/** User-facing error from the team-admin flows; `message` is always short and safe to show inline. */
export class AdminUsersError extends Error {}

/**
 * Thrown by `deleteUserAccount` specifically when the server reports the
 * target no longer exists (its own 404 "That user no longer exists."):
 * callers should treat this as success, not failure — the row already
 * disappears from the realtime profile list, so surfacing it as an error
 * would be misleading.
 */
export class AdminUserNotFoundError extends AdminUsersError {}

async function getIdTokenOrThrow(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new AdminUsersError('You must be signed in to manage the team.');
  }

  try {
    return await user.getIdToken();
  } catch {
    throw new AdminUsersError('Could not verify your session. Please try again.');
  }
}

// Maps a non-OK `/api/admin-users` response to a user-facing error. The
// endpoint always responds with a JSON body carrying an `error` string
// (401/403/404/500, see api/admin-users.ts), so that message is trusted and
// shown as-is whenever it's present — this is what lets a 404 surface the
// server's own "That user no longer exists." instead of a generic failure.
// The one case that is NOT this server's own response is when the endpoint
// doesn't exist at all — e.g. `npm run dev` (Vite only, no `/api/*`) returns
// an HTML 404 page — which fails to parse as JSON and falls back to the
// `vercel dev` hint instead.
async function toAdminUsersError(response: Response): Promise<AdminUsersError> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (body && typeof body.error === 'string' && body.error.length > 0) {
    return response.status === 404 ? new AdminUserNotFoundError(body.error) : new AdminUsersError(body.error);
  }

  // Vite's dev server has no `/api/*`, so a plain 404 there means the
  // function isn't being served at all. Anything else (e.g. Vercel's own
  // FUNCTION_INVOCATION_FAILED 500 page) is a deployment/runtime failure.
  if (response.status === 404) {
    return new AdminUsersError('Account management is not available here. Run the app with `vercel dev`.');
  }
  return new AdminUsersError(`Account management failed on the server (HTTP ${response.status}). Please try again later.`);
}

async function postAdminUsers(body: Record<string, unknown>): Promise<void> {
  const idToken = await getIdTokenOrThrow();

  let response: Response;
  try {
    response = await fetch('/api/admin-users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AdminUsersError('Account management is unavailable right now. Please try again.');
  }

  if (response.ok) {
    return;
  }

  throw await toAdminUsersError(response);
}

/**
 * Sends a full account-delete request to the `/api/admin-users` Vercel
 * Function: removes the target's Firebase Auth login, `users/{uid}` profile,
 * reports, assignment updates, and team-order entry. Only a lead's ID token
 * is accepted server-side; self-delete and deleting the last remaining lead
 * are rejected there too.
 */
export async function deleteUserAccount(uid: string): Promise<void> {
  await postAdminUsers({ action: 'delete', uid });
}

/**
 * Sends a role-change request to the `/api/admin-users` Vercel Function.
 * Role changes moved server-side (from a plain Firestore write) so the
 * last-remaining-lead guard can be enforced atomically; only a lead's ID
 * token is accepted, and self role changes are rejected there too.
 */
export async function setUserRole(uid: string, role: UserRole): Promise<void> {
  await postAdminUsers({ action: 'setRole', uid, role });
}
