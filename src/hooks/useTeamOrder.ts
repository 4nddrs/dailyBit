import { useEffect, useState } from 'react';
import { subscribeTeamOrder } from '../services/firestore';

interface UseTeamOrderResult {
  memberOrder: string[];
  loading: boolean;
}

export function useTeamOrder(): UseTeamOrderResult {
  const [memberOrder, setMemberOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeTeamOrder((nextOrder) => {
      setMemberOrder(nextOrder);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { memberOrder, loading };
}
