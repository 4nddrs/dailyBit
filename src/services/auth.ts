import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth } from '../firebase';
import type { UserRole } from '../types';
import { ensureUserDoc } from './firestore';

export async function signUp(
  email: string,
  password: string,
  name: string,
  role: UserRole = 'dev',
): Promise<User> {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await ensureUserDoc(credential.user.uid, name, role);
  return credential.user;
}

export async function signIn(email: string, password: string): Promise<User> {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

export function signOut(): Promise<void> {
  return firebaseSignOut(auth);
}

export function observeAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}
