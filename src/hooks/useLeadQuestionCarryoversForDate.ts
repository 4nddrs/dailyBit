import { useEffect, useState } from 'react';
import { subscribeLeadQuestionCarryoversForDate } from '../services/firestore';
import type { CarriedLeadQuestion } from '../types';

interface UseLeadQuestionCarryoversForDateResult {
  carriedQuestions: CarriedLeadQuestion[];
  loading: boolean;
}

// Lead-only: every carried-over report-level lead question visible on
// `date`, across all developers. Independent of `reports`, so it loads even
// for a developer with no report doc on this date.
export function useLeadQuestionCarryoversForDate(date: string): UseLeadQuestionCarryoversForDateResult {
  const [carriedQuestions, setCarriedQuestions] = useState<CarriedLeadQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Unlike `useAssignmentsForDate`, this resets the list (not just
    // `loading`) on every date change: carried questions are labeled by
    // origin date and grouped by developer for the currently viewed date, so
    // keeping the previous date's list visible while the new one loads
    // would show stale entries under the wrong developer/date.
    setCarriedQuestions([]);
    setLoading(true);

    const unsubscribe = subscribeLeadQuestionCarryoversForDate(
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
  }, [date]);

  return { carriedQuestions, loading };
}
