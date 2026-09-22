import { useEffect, useState } from 'react';
import { subscribeUserProfiles } from '../services/firestore';
import type { UserProfile } from '../types';

interface UseUserProfilesResult {
  profiles: UserProfile[];
  loading: boolean;
}

export function useUserProfiles(): UseUserProfilesResult {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
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
