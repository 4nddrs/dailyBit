import { useEffect, useState } from 'react';
import { subscribeLeadQuestionCarryoversForAssignee } from '../services/firestore';
import type { CarriedLeadQuestion } from '../types';

interface UseMyLeadQuestionCarryoversResult {
  carriedQuestions: CarriedLeadQuestion[];
  loading: boolean;
}

// Carried-over report-level lead questions are independent of `reports`,
// same as `useMyAssignments`: they load for a date even when the developer
// has no report doc yet.
export function useMyLeadQuestionCarryovers(
  userId: string | null | undefined,
  date: string,
): UseMyLeadQuestionCarryoversResult {
  const [carriedQuestions, setCarriedQuestions] = useState<CarriedLeadQuestion[]>([]);
  const [loading, setLoading] = useState(Boolean(userId));

  useEffect(() => {
    if (!userId) {
      setCarriedQuestions([]);
      setLoading(false);
      return () => undefined;
    }

    let cancelled = false;
    setLoading(true);

    const unsubscribe = subscribeLeadQuestionCarryoversForAssignee(
      userId,
      date,
      (nextCarriedQuestions) => {
        if (!cancelled) {
          setCarriedQuestions(nextCarriedQuestions);
          setLoading(false);
        }
      },
      () => {
        if (!cancelled) {
          setLoading(false);
        }
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId, date]);

  return { carriedQuestions, loading };
}
