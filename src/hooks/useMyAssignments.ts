import { useEffect, useState } from 'react';
import { subscribeAssignmentsForAssignee } from '../services/firestore';
import type { AssignmentWithId } from '../types';

interface UseMyAssignmentsResult {
  assignments: AssignmentWithId[];
  loading: boolean;
}

// Assignments are independent of `reports`: they load for a date even when
// the developer has no report doc yet, so this never calls ensureReport.
export function useMyAssignments(
  userId: string | null | undefined,
  date: string,
): UseMyAssignmentsResult {
  const [assignments, setAssignments] = useState<AssignmentWithId[]>([]);
  const [loading, setLoading] = useState(Boolean(userId));

  useEffect(() => {
    if (!userId) {
      setAssignments([]);
      setLoading(false);
      return () => undefined;
    }

    let cancelled = false;
    setLoading(true);

    const unsubscribe = subscribeAssignmentsForAssignee(
      userId,
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
  }, [userId, date]);

  return { assignments, loading };
}
