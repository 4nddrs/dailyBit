import type { ReactNode } from 'react';
import { TASK_SCORE_LEVELS, TASK_SCORE_LEVEL_COLORS, TASK_SCORE_LEVEL_LABELS } from '../../utils/taskScore';
import type { TaskScore } from '../../types';

// The lead's writing-quality score for a task: a mini 5-segment meter, the
// level word and the muted reason on one line. Shared by Lead View (with
// `actions` for edit/remove) and the read-only views (Developer View, Report
// Preview).
export function TaskScoreBadge({
  score,
  label = 'Score',
  actions,
}: {
  score: Pick<TaskScore, 'level' | 'reason'>;
  label?: string;
  actions?: ReactNode;
}) {
  const levelIndex = TASK_SCORE_LEVELS.indexOf(score.level);
  const color = TASK_SCORE_LEVEL_COLORS[score.level];
  const levelLabel = TASK_SCORE_LEVEL_LABELS[score.level];

  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-sm">
      <p
        className="flex min-w-0 items-center gap-2"
        title={score.reason ? `${label}: ${levelLabel} — ${score.reason}` : `${label}: ${levelLabel}`}
      >
        <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</span>
        <span className="flex shrink-0 items-center gap-0.5" role="img" aria-label={`${levelLabel}, ${levelIndex + 1} of 5`}>
          {TASK_SCORE_LEVELS.map((level, index) => (
            <span
              className={`h-1.5 w-3 rounded-full ${index <= levelIndex ? '' : 'bg-line'}`}
              style={index <= levelIndex ? { backgroundColor: color } : undefined}
              key={level}
            />
          ))}
        </span>
        <span className="shrink-0 font-semibold" style={{ color }}>
          {levelLabel}
        </span>
        {score.reason ? <span className="min-w-0 truncate text-fg-muted">— {score.reason}</span> : null}
      </p>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}
