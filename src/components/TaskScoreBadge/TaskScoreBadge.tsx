import type { ReactNode } from 'react';
import { TASK_SCORE_LEVEL_LABELS, TASK_SCORE_LEVEL_STYLES } from '../../utils/taskScore';
import type { TaskScore } from '../../types';

// The lead's writing-quality score for a task, e.g. "Score: Clear — Well
// structured". Shared by Lead View (with `actions` for edit/remove) and the
// read-only views (Developer View, Report Preview).
export function TaskScoreBadge({
  score,
  label = 'Score',
  actions,
}: {
  score: Pick<TaskScore, 'level' | 'reason'>;
  label?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      className={`mt-3 flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm ${TASK_SCORE_LEVEL_STYLES[score.level]}`}
    >
      <p className="min-w-0 break-words leading-6">
        <span className="font-semibold">
          {label}: {TASK_SCORE_LEVEL_LABELS[score.level]}
        </span>
        {score.reason ? <span> — {score.reason}</span> : null}
      </p>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}
