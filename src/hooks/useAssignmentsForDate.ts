import { useEffect, useState } from 'react';
import { subscribeAssignmentsForDate } from '../services/firestore';
import type { AssignmentWithId } from '../types';

interface UseAssignmentsForDateResult {
  assignments: AssignmentWithId[];
  loading: boolean;
}

// Lead-only: every assignment visible on `date`, across all assignees.
// Independent of `reports`, so it loads even for developers with no report
// doc on this date.
export function useAssignmentsForDate(date: string): UseAssignmentsForDateResult {
  const [assignments, setAssignments] = useState<AssignmentWithId[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const unsubscribe = subscribeAssignmentsForDate(
      date,
      (nextAssignments) => {
        if (!cancelled) {
          setAssignments(nextAssignments);
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

  return { assignments, loading };
}
