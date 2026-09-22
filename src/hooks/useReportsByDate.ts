import { useEffect, useState } from 'react';
import { subscribeReport, subscribeReportsByDate } from '../services/firestore';
import type { ReportTree } from '../types';

interface UseReportsByDateResult {
  reportTrees: ReportTree[];
  loading: boolean;
}

export function useReportsByDate(date: string): UseReportsByDateResult {
  const [reportTrees, setReportTrees] = useState<ReportTree[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const reportUnsubscribes = new Map<string, () => void>();
    const reportTreeMap = new Map<string, ReportTree>();
    let expectedReportIds = new Set<string>();
    let receivedSummaries = false;

    function publish() {
      if (cancelled) {
        return;
      }

      const nextReportTrees = Array.from(reportTreeMap.values()).sort((a, b) =>
        a.userId.localeCompare(b.userId),
      );
      setReportTrees(nextReportTrees);

      if (receivedSummaries && reportTreeMap.size >= expectedReportIds.size) {
        setLoading(false);
      }
    }

    setLoading(true);
    setReportTrees([]);

    const unsubscribeSummaries = subscribeReportsByDate(date, (summaries) => {
      if (cancelled) {
        return;
      }

      receivedSummaries = true;
      expectedReportIds = new Set(summaries.map((summary) => summary.id));

      Array.from(reportUnsubscribes.keys()).forEach((reportId) => {
        if (!expectedReportIds.has(reportId)) {
          reportUnsubscribes.get(reportId)?.();
          reportUnsubscribes.delete(reportId);
          reportTreeMap.delete(reportId);
        }
      });

      summaries.forEach((summary) => {
        if (reportUnsubscribes.has(summary.id)) {
          return;
        }

        const unsubscribeReport = subscribeReport(summary.id, (reportTree) => {
          if (cancelled) {
            return;
          }

          if (reportTree) {
            reportTreeMap.set(summary.id, reportTree);
          } else {
            reportTreeMap.delete(summary.id);
          }
          publish();
        });

        reportUnsubscribes.set(summary.id, unsubscribeReport);
      });

      if (summaries.length === 0) {
        setReportTrees([]);
        setLoading(false);
        return;
      }

      publish();
    });

    return () => {
      cancelled = true;
      unsubscribeSummaries();
      reportUnsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [date]);

  return { reportTrees, loading };
}
