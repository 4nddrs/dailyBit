import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

// Full team-member account deletion for the lead-only Manage team panel.
// Unlike the client-side role change (a plain Firestore write allowed by the
// `users/{uid}` rule), a full delete must also remove the person's Firebase
// Auth login and cascade through several collections Firestore rules alone
// can't safely express, so it runs here with the Firebase Admin SDK, which
// bypasses security rules entirely. The caller's ID token is verified the
// same way `api/polish.ts` verifies it, and the caller's own `users/{uid}`
// profile must have `role: 'lead'`.

export type AdminUsersAction = 'delete';

interface AdminUsersRequestBody {
  action: AdminUsersAction;
  uid: string;
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

  const { action, uid } = body as Record<string, unknown>;

  if (action !== 'delete') {
    return { ok: false, error: 'Invalid "action". Expected "delete".' };
  }

  if (typeof uid !== 'string' || uid.trim().length === 0) {
    return { ok: false, error: 'Invalid "uid".' };
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

// Removes every trace of `uid` that Firestore rules can't cascade on their
// own, in the order the feature document specifies: reports (recursively,
// they own sections/tasks/images/questions/etc.), then this assignee's
// updates (and their images) across every assignment that lists them,
// removing them from `assigneeIds` (deleting the assignment outright once no
// assignees remain), then the team order, then the profile itself. Auth
// deletion happens after this resolves, in the handler below.
async function cascadeDeleteUserData(firestore: Firestore, uid: string): Promise<void> {
  const reportsSnapshot = await firestore.collection('reports').where('userId', '==', uid).get();
  for (const reportDoc of reportsSnapshot.docs) {
    await firestore.recursiveDelete(reportDoc.ref);
  }

  const assignmentsSnapshot = await firestore
    .collection('assignments')
    .where('assigneeIds', 'array-contains', uid)
    .get();

  for (const assignmentDoc of assignmentsSnapshot.docs) {
    const updatesSnapshot = await assignmentDoc.ref
      .collection('updates')
      .where('assigneeId', '==', uid)
      .get();
    for (const updateDoc of updatesSnapshot.docs) {
      await firestore.recursiveDelete(updateDoc.ref);
    }

    const assignmentData = assignmentDoc.data() as { assigneeIds?: string[] };
    const remainingAssigneeIds = (assignmentData.assigneeIds ?? []).filter((id) => id !== uid);

    if (remainingAssigneeIds.length === 0) {
      await firestore.recursiveDelete(assignmentDoc.ref);
    } else {
      await assignmentDoc.ref.update({ assigneeIds: remainingAssigneeIds });
    }
  }

  const teamSettingsRef = firestore.collection('settings').doc('team');
  const teamSettingsSnapshot = await teamSettingsRef.get();
  if (teamSettingsSnapshot.exists) {
    const memberOrder = (teamSettingsSnapshot.data()?.memberOrder as string[] | undefined) ?? [];
    if (memberOrder.includes(uid)) {
      await teamSettingsRef.update({ memberOrder: memberOrder.filter((id) => id !== uid) });
    }
  }

  await firestore.collection('users').doc(uid).delete();
}

async function deleteUser(firestore: Firestore, callerUid: string, targetUid: string): Promise<void> {
  const callerSnapshot = await firestore.collection('users').doc(callerUid).get();
  const callerRole = callerSnapshot.exists ? (callerSnapshot.data()?.role as string | undefined) : undefined;

  if (callerRole !== 'lead') {
    throw new AdminUsersError(403, 'Only a lead can delete a team member.');
  }

  if (targetUid === callerUid) {
    throw new AdminUsersError(400, "You can't delete your own account.");
  }

  const targetSnapshot = await firestore.collection('users').doc(targetUid).get();
  if (!targetSnapshot.exists) {
    throw new AdminUsersError(404, 'That user no longer exists.');
  }

  const targetRole = targetSnapshot.data()?.role as string | undefined;
  if (targetRole === 'lead') {
    const leadsSnapshot = await firestore.collection('users').where('role', '==', 'lead').get();
    if (leadsSnapshot.size <= 1) {
      throw new AdminUsersError(400, 'The last remaining lead cannot be deleted.');
    }
  }

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
    await deleteUser(firestore, callerUid, validation.value.uid);
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
