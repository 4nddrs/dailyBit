import { useEffect, useState } from 'react';
import { getOrCreateTodayReport, subscribeReport } from '../services/firestore';
import type { ReportTree } from '../types';
import { todayDateString } from '../types';

interface UseMyReportResult {
  reportTree: ReportTree | null;
  reportId: string | null;
  loading: boolean;
  date: string;
}

const DATE_CHECK_INTERVAL_MS = 60_000;

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

    setLoading(true);
    setReportTree(null);
    setReportId(null);

    getOrCreateTodayReport(userId, date)
      .then((report) => {
        if (cancelled) {
          return;
        }

        setReportId(report.id);
        unsubscribeReport = subscribeReport(report.id, (nextReportTree) => {
          if (!cancelled) {
            setReportTree(nextReportTree);
            setLoading(false);
          }
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      unsubscribeReport?.();
    };
  }, [date, userId]);

  return { reportTree, reportId, loading, date };
}
