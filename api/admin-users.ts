import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type DocumentReference, type Firestore } from 'firebase-admin/firestore';

// Server-side team administration for the lead-only Manage team panel:
// full account deletion and role changes. Both bypass Firestore rules via
// firebase-admin (deletion needs to remove the Auth login too, which client
// rules can never do; role changes moved here so the "don't demote/delete
// the last lead" guard can be enforced atomically instead of racily in the
// client, see markUserForDeletion/setUserRole below). The caller's ID token
// is verified the same way `api/polish.ts` verifies it, and the caller's own
// `users/{uid}` profile must have `role: 'lead'`.

// Vercel Functions read this export to extend the default execution time
// limit; the cascade below can touch many documents for an active user.
export const config = {
  maxDuration: 60,
};

export type AdminUsersAction = 'delete' | 'setRole';
type AdminUserRole = 'dev' | 'lead';

interface AdminUsersRequestBody {
  action: AdminUsersAction;
  uid: string;
  role?: AdminUserRole;
}

const firebaseProjectId = process.env.FIREBASE_PROJECT_ID ?? process.env.VITE_FIREBASE_PROJECT_ID;

// Cached across warm invocations of the same instance, same as api/polish.ts.
const firebaseJwks = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

function extractBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith('Bearer ')) {
    return null;
  }
  const token = value.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

async function verifyFirebaseIdToken(token: string): Promise<string> {
  if (!firebaseProjectId) {
    throw new Error('Firebase project id is not configured.');
  }

  const { payload } = await jwtVerify(token, firebaseJwks, {
    issuer: `https://securetoken.google.com/${firebaseProjectId}`,
    audience: firebaseProjectId,
  });

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('Token payload is missing a subject.');
  }

  return payload.sub;
}

function parseJsonBody(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return raw.length > 0 ? JSON.parse(raw) : {};
    } catch {
      return null;
    }
  }
  return raw;
}

type ValidationResult =
  | { ok: true; value: AdminUsersRequestBody }
  | { ok: false; error: string };

function validateBody(raw: unknown): ValidationResult {
  const body = parseJsonBody(raw);
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Invalid request body.' };
  }

  const { action, uid, role } = body as Record<string, unknown>;

  if (action !== 'delete' && action !== 'setRole') {
    return { ok: false, error: 'Invalid "action". Expected "delete" or "setRole".' };
  }

  if (typeof uid !== 'string' || uid.trim().length === 0) {
    return { ok: false, error: 'Invalid "uid".' };
  }

  if (action === 'setRole') {
    if (role !== 'dev' && role !== 'lead') {
      return { ok: false, error: 'Invalid "role". Expected "dev" or "lead".' };
    }
    return { ok: true, value: { action, uid: uid.trim(), role } };
  }

  return { ok: true, value: { action, uid: uid.trim() } };
}

// Cached across warm invocations, same as the JWKS above: firebase-admin
// throws if initializeApp is called more than once for the same app.
let cachedApp: App | undefined;

function readServiceAccountJson(): string | undefined {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().length > 0) {
    return raw;
  }

  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (base64 && base64.trim().length > 0) {
    return Buffer.from(base64, 'base64').toString('utf-8');
  }

  return undefined;
}

function getAdminApp(): App {
  if (cachedApp) {
    return cachedApp;
  }

  const existingApps = getApps();
  if (existingApps.length > 0) {
    cachedApp = existingApps[0];
    return cachedApp;
  }

  const json = readServiceAccountJson();
  if (!json) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured.');
  }

  let serviceAccount: ServiceAccount;
  try {
    serviceAccount = JSON.parse(json) as ServiceAccount;
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON.');
  }

  cachedApp = initializeApp({ credential: cert(serviceAccount) });
  return cachedApp;
}

class AdminUsersError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function getCallerRole(firestore: Firestore, callerUid: string): Promise<string | undefined> {
  const callerSnapshot = await firestore.collection('users').doc(callerUid).get();
  return callerSnapshot.exists ? (callerSnapshot.data()?.role as string | undefined) : undefined;
}

// Runs `fn` over `items` with at most `limit` in flight at once, instead of
// either strictly sequential (slow for someone with many reports/updates) or
// fully parallel (risks Firestore rate limits and blows past Vercel's time
// budget in bursts). Order of completion doesn't matter to any caller here.
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await fn(item);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

const DELETE_CONCURRENCY = 5;

// Atomically guards and marks a user for deletion: re-reads the target and
// (only when the target is currently a lead) the full lead set inside one
// transaction, refuses to proceed if the target is the last remaining lead,
// and otherwise marks the target so a concurrent request sees the change
// immediately — role is flipped to 'dev' (so a second, concurrent delete of
// another lead recomputes the lead count correctly) and `removing: true` is
// set as an explicit in-progress marker. `removing` is transient and never
// read by the client; the ManagePanel/LeadView list simply renders the
// person with their (possibly just-flipped) role until the cascade below
// finishes and the profile doc is deleted.
// Idempotent: if the target is already marked `removing`, the guard already
// ran on an earlier, interrupted attempt, so this call is a no-op and the
// retry proceeds straight to the cascade.
async function markUserForDeletion(firestore: Firestore, targetUid: string): Promise<void> {
  await firestore.runTransaction(async (transaction) => {
    const targetRef = firestore.collection('users').doc(targetUid);
    const targetSnapshot = await transaction.get(targetRef);

    if (!targetSnapshot.exists) {
      throw new AdminUsersError(404, 'That user no longer exists.');
    }

    const data = targetSnapshot.data() as { role?: string; removing?: boolean } | undefined;
    if (data?.removing) {
      return;
    }

    if (data?.role === 'lead') {
      const leadsSnapshot = await transaction.get(firestore.collection('users').where('role', '==', 'lead'));
      if (leadsSnapshot.size <= 1) {
        throw new AdminUsersError(400, 'The last remaining lead cannot be deleted.');
      }
      transaction.update(targetRef, { role: 'dev', removing: true });
    } else {
      transaction.update(targetRef, { removing: true });
    }
  });
}

// Disables the Auth login and revokes its refresh tokens before touching any
// data, so a signed-in session can't keep writing while the cascade runs.
// `auth/user-not-found` is treated as already-done so a retry (e.g. after a
// timeout) still succeeds. Residual risk, accepted: an ID token issued
// before this call remains valid for Firestore requests (not for getting a
// *new* token) until it naturally expires, up to about 1 hour — Firestore
// rules have no way to check "has this token been revoked" without an extra
// round trip per request, which this app doesn't do.
async function disableAndRevokeAuth(targetUid: string): Promise<void> {
  try {
    await getAuth().updateUser(targetUid, { disabled: true });
  } catch (error) {
    if ((error as { code?: string } | undefined)?.code !== 'auth/user-not-found') {
      console.error('Failed to disable the Firebase Auth user', error);
      throw new AdminUsersError(500, 'Could not disable the account. Please retry.');
    }
  }

  try {
    await getAuth().revokeRefreshTokens(targetUid);
  } catch (error) {
    if ((error as { code?: string } | undefined)?.code !== 'auth/user-not-found') {
      console.error('Failed to revoke the Firebase Auth user session', error);
      throw new AdminUsersError(500, 'Could not revoke the account session. Please retry.');
    }
  }
}

// Removes `uid` from one assignment's `assigneeIds`, re-reading the doc
// inside a transaction so a concurrent edit (e.g. the lead editing the same
// assignment from another tab) is never overwritten with a stale array.
// Deletes the assignment doc itself once no assignees remain in that fresh
// read. Returns whether the assignment doc is now gone (just now, or already
// gone from an earlier interrupted attempt) so the caller knows whether to
// sweep its subcollections.
async function removeAssigneeFromAssignment(
  firestore: Firestore,
  assignmentRef: DocumentReference,
  uid: string,
): Promise<boolean> {
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(assignmentRef);
    if (!snapshot.exists) {
      return true;
    }

    const data = snapshot.data() as { assigneeIds?: string[] } | undefined;
    const currentAssigneeIds = data?.assigneeIds ?? [];
    const remainingAssigneeIds = currentAssigneeIds.filter((id) => id !== uid);

    if (remainingAssigneeIds.length === 0) {
      transaction.delete(assignmentRef);
      return true;
    }

    if (remainingAssigneeIds.length !== currentAssigneeIds.length) {
      transaction.update(assignmentRef, { assigneeIds: remainingAssigneeIds });
    }

    return false;
  });
}

// Removes every trace of `uid` that Firestore rules can't cascade on their
// own: reports (recursively, they own sections/tasks/images/questions/etc.),
// then, for every assignment that lists this assignee, their own `updates`
// (and those updates' images) followed by their atomic removal from
// `assigneeIds` (sweeping the assignment's subcollections once it has no
// assignees left), then the team order. The profile is deliberately NOT
// deleted here: the caller deletes the Auth login first and the profile
// last, so a failure partway through leaves the profile in place and a
// retry from the Manage panel can still find the person and finish the job.
// Every step is idempotent, and reports/updates/assignments are each swept
// with bounded concurrency instead of strictly one at a time, to make better
// use of the function's time budget for someone with a lot of history.
async function cascadeDeleteUserData(firestore: Firestore, uid: string): Promise<void> {
  const reportsSnapshot = await firestore.collection('reports').where('userId', '==', uid).get();
  await mapWithConcurrency(reportsSnapshot.docs, DELETE_CONCURRENCY, async (reportDoc) => {
    await firestore.recursiveDelete(reportDoc.ref);
  });

  const assignmentsSnapshot = await firestore
    .collection('assignments')
    .where('assigneeIds', 'array-contains', uid)
    .get();

  await mapWithConcurrency(assignmentsSnapshot.docs, DELETE_CONCURRENCY, async (assignmentDoc) => {
    const updatesSnapshot = await assignmentDoc.ref.collection('updates').where('assigneeId', '==', uid).get();
    await mapWithConcurrency(updatesSnapshot.docs, DELETE_CONCURRENCY, async (updateDoc) => {
      await firestore.recursiveDelete(updateDoc.ref);
    });

    const assignmentGone = await removeAssigneeFromAssignment(firestore, assignmentDoc.ref, uid);
    if (assignmentGone) {
      await firestore.recursiveDelete(assignmentDoc.ref);
    }
  });

  const teamSettingsRef = firestore.collection('settings').doc('team');
  const teamSettingsSnapshot = await teamSettingsRef.get();
  if (teamSettingsSnapshot.exists) {
    const memberOrder = (teamSettingsSnapshot.data()?.memberOrder as string[] | undefined) ?? [];
    if (memberOrder.includes(uid)) {
      await teamSettingsRef.update({ memberOrder: memberOrder.filter((id) => id !== uid) });
    }
  }
}

async function deleteUser(firestore: Firestore, callerUid: string, targetUid: string): Promise<void> {
  const callerRole = await getCallerRole(firestore, callerUid);
  if (callerRole !== 'lead') {
    throw new AdminUsersError(403, 'Only a lead can delete a team member.');
  }

  if (targetUid === callerUid) {
    throw new AdminUsersError(400, "You can't delete your own account.");
  }

  // Atomically refuses to delete the last remaining lead and marks the
  // target so a concurrent delete/role-change sees it; see the function doc
  // for why this must happen before anything else, in its own transaction.
  await markUserForDeletion(firestore, targetUid);

  await disableAndRevokeAuth(targetUid);

  await cascadeDeleteUserData(firestore, targetUid);

  try {
    await getAuth().deleteUser(targetUid);
  } catch (error) {
    if ((error as { code?: string } | undefined)?.code !== 'auth/user-not-found') {
      console.error('Failed to delete the Firebase Auth user', error);
      throw new AdminUsersError(
        500,
        "Deleted the account's data, but failed to remove their login. Please retry.",
      );
    }
  }

  // Last, so the person stays listed (and retryable) until their login is gone.
  await firestore.collection('users').doc(targetUid).delete();
}

// Changes another team member's role. Moved server-side (rather than a
// plain client Firestore write) so demoting the last remaining lead can be
// refused atomically: the transaction re-reads the target and, only for a
// lead-to-dev demotion, the full lead set, in one round trip, so two
// concurrent demotions can never both see "2 leads left" and both succeed.
async function setUserRole(
  firestore: Firestore,
  callerUid: string,
  targetUid: string,
  role: AdminUserRole,
): Promise<void> {
  const callerRole = await getCallerRole(firestore, callerUid);
  if (callerRole !== 'lead') {
    throw new AdminUsersError(403, 'Only a lead can change a team member’s role.');
  }

  if (targetUid === callerUid) {
    throw new AdminUsersError(400, "You can't change your own role.");
  }

  await firestore.runTransaction(async (transaction) => {
    const targetRef = firestore.collection('users').doc(targetUid);
    const targetSnapshot = await transaction.get(targetRef);

    if (!targetSnapshot.exists) {
      throw new AdminUsersError(404, 'That user no longer exists.');
    }

    const data = targetSnapshot.data() as { role?: string; removing?: boolean } | undefined;
    if (data?.removing) {
      // Being deleted: treat the same as already gone rather than
      // resurrecting a role change on an account that's on its way out.
      throw new AdminUsersError(404, 'That user no longer exists.');
    }

    if (data?.role === role) {
      return;
    }

    if (data?.role === 'lead' && role === 'dev') {
      const leadsSnapshot = await transaction.get(firestore.collection('users').where('role', '==', 'lead'));
      if (leadsSnapshot.size <= 1) {
        throw new AdminUsersError(400, 'The last remaining lead cannot be demoted.');
      }
    }

    transaction.update(targetRef, { role });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  if (!firebaseProjectId) {
    console.error('FIREBASE_PROJECT_ID / VITE_FIREBASE_PROJECT_ID is not configured for this function.');
    res.status(500).json({ error: 'Account management is not configured on the server.' });
    return;
  }

  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token.' });
    return;
  }

  let callerUid: string;
  try {
    callerUid = await verifyFirebaseIdToken(token);
  } catch (error) {
    console.error('Firebase ID token verification failed', error);
    res.status(401).json({ error: 'Invalid or expired token.' });
    return;
  }

  const validation = validateBody(req.body);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  let app: App;
  try {
    app = getAdminApp();
  } catch (error) {
    // Never surface the missing-config detail to the client.
    console.error('Firebase Admin initialization failed', error);
    res.status(500).json({ error: 'Account management is not available right now.' });
    return;
  }

  const firestore = getFirestore(app);

  try {
    if (validation.value.action === 'delete') {
      await deleteUser(firestore, callerUid, validation.value.uid);
    } else {
      // `validateBody` only returns action: 'setRole' together with a role.
      await setUserRole(firestore, callerUid, validation.value.uid, validation.value.role as AdminUserRole);
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof AdminUsersError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Unexpected /api/admin-users error', error);
    res.status(500).json({ error: 'Unexpected error.' });
  }
}
