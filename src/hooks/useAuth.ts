import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { UserProfile } from '../types';
import { observeAuth, signOut as signOutService } from '../services/auth';
import { subscribeUserProfile } from '../services/firestore';

interface UseAuthResult {
  user: User | null;
  profile: UserProfile | null;
  profileError: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;

    const unsubscribeAuth = observeAuth((nextUser) => {
      unsubscribeProfile?.();
      unsubscribeProfile = undefined;
      setUser(nextUser);
      setProfile(null);
      setProfileError(null);
      setAuthLoading(false);

      if (nextUser) {
        setProfileLoading(true);
        unsubscribeProfile = subscribeUserProfile(
          nextUser.uid,
          (nextProfile) => {
            setProfile(nextProfile);
            setProfileError(null);
            setProfileLoading(false);
          },
          (error) => {
            setProfileError(`Firestore profile read failed: ${error.code}: ${error.message}`);
            setProfileLoading(false);
          },
        );
      } else {
        setProfileLoading(false);
      }
    });

    return () => {
      unsubscribeProfile?.();
      unsubscribeAuth();
    };
  }, []);

  return {
    user,
    profile,
    profileError,
    loading: authLoading || (profileLoading && !profileError),
    signOut: signOutService,
  };
}
