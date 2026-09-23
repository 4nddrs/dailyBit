import { Timestamp } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import { ensureReport, reportIdFor, subscribeReport, subscribeReportDoc } from '../services/firestore';
import type { ReportTree } from '../types';
import { todayDateString } from '../types';

interface UseMyReportResult {
  reportTree: ReportTree | null;
  reportId: string | null;
  loading: boolean;
  date: string;
  ensureReportExists: () => Promise<string>;
}

const DATE_CHECK_INTERVAL_MS = 60_000;

// A report document must exist before it has a tree to show. While it
// doesn't, this placeholder stands in so views can render an empty state
// without ever creating `reports/{userId}_{date}` just by being opened.
function createEmptyReportTree(id: string, userId: string, date: string): ReportTree {
  const placeholder = Timestamp.now();

  return {
    id,
    userId,
    date,
    createdAt: placeholder,
    updatedAt: placeholder,
    sections: [],
    questions: [],
    notes: [],
    leadQuestions: [],
  };
}

// `selectedDate` pins the report to a specific day; when it is null the hook
// follows the current day and rolls over automatically at midnight.
export function useMyReport(
  userId: string | null | undefined,
  selectedDate: string | null = null,
): UseMyReportResult {
  const [today, setToday] = useState(() => todayDateString());
  const date = selectedDate ?? today;
  const [reportTree, setReportTree] = useState<ReportTree | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(userId));

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const nextToday = todayDateString();
      setToday((currentToday) => (currentToday === nextToday ? currentToday : nextToday));
    }, DATE_CHECK_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribeReport: (() => void) | undefined;

    if (!userId) {
      setReportTree(null);
      setReportId(null);
      setLoading(false);
      return () => undefined;
    }

    const id = reportIdFor(userId, date);
    setLoading(true);
    setReportTree(null);
    setReportId(id);

    // The report document may not exist yet (the developer hasn't written
    // anything for this date). Only once it exists do subcollections become
    // readable under the Firestore rules, so the full tree subscription
    // starts lazily when `exists` flips true.
    const unsubscribeDoc = subscribeReportDoc(
      id,
      (exists) => {
        if (cancelled) {
          return;
        }

        if (!exists) {
          unsubscribeReport?.();
          unsubscribeReport = undefined;
          setReportTree(createEmptyReportTree(id, userId, date));
          setLoading(false);
          return;
        }

        if (unsubscribeReport) {
          return;
        }

        unsubscribeReport = subscribeReport(id, (nextReportTree) => {
          // subscribeReport can emit null before its own report-doc listener
          // fires; existence is tracked by subscribeReportDoc, so keep the
          // current tree instead of flashing the error state.
          if (!cancelled && nextReportTree) {
            setReportTree(nextReportTree);
            setLoading(false);
          }
        });
      },
      () => {
        if (!cancelled) {
          setLoading(false);
        }
      },
    );

    return () => {
      cancelled = true;
      unsubscribeDoc();
      unsubscribeReport?.();
    };
  }, [date, userId]);

  const ensureReportExists = useCallback(async (): Promise<string> => {
    if (!userId) {
      throw new Error('ensureReportExists requires a signed-in user.');
    }

    return ensureReport(userId, date);
  }, [userId, date]);

  return { reportTree, reportId, loading, date, ensureReportExists };
}
