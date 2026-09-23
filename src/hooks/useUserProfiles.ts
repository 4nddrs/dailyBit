import { useEffect, useState } from 'react';
import { subscribeUserProfiles } from '../services/firestore';
import type { UserProfileWithId } from '../types';

interface UseUserProfilesResult {
  profiles: UserProfileWithId[];
  loading: boolean;
}

export function useUserProfiles(): UseUserProfilesResult {
  const [profiles, setProfiles] = useState<UserProfileWithId[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeUserProfiles((nextProfiles) => {
      setProfiles(nextProfiles);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { profiles, loading };
}
