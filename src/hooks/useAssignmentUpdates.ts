import { useEffect, useState } from 'react';
import { subscribeAssignmentUpdatesForDate } from '../services/firestore';
import type { AssignmentUpdateWithImages } from '../types';

export type AssignmentUpdatesByAssignment = Map<string, Map<string, AssignmentUpdateWithImages>>;

// Lead-only: one `subscribeAssignmentUpdatesForDate` listener per assignment,
// shared across every report/assignment card that needs it, instead of each
// card subscribing on its own. Re-subscribes whenever the set of assignment
// ids or the date changes; listeners are torn down on cleanup.
export function useAssignmentUpdates(
  assignmentIds: string[],
  date: string,
): AssignmentUpdatesByAssignment {
  const [updatesByAssignment, setUpdatesByAssignment] = useState<AssignmentUpdatesByAssignment>(
    () => new Map(),
  );
  const assignmentIdsKey = assignmentIds.join(',');

  useEffect(() => {
    let cancelled = false;
    const data = new Map<string, Map<string, AssignmentUpdateWithImages>>();

    function emit() {
      if (cancelled) {
        return;
      }
      setUpdatesByAssignment(new Map(Array.from(data.entries()).map(([id, byAssignee]) => [id, new Map(byAssignee)])));
    }

    const unsubscribes = assignmentIdsKey
      .split(',')
      .filter(Boolean)
      .map((assignmentId) =>
        subscribeAssignmentUpdatesForDate(assignmentId, date, (updates) => {
          data.set(assignmentId, new Map(updates.map((update) => [update.assigneeId, update])));
          emit();
        }),
      );

    emit();

    return () => {
      cancelled = true;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
    // `assignmentIdsKey` is the stable dependency; `assignmentIds` itself is a
    // new array reference on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentIdsKey, date]);

  return updatesByAssignment;
}
