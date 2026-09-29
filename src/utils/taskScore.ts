// Writing-quality score the lead gives a dev task: five word levels, each with
// its own list of canned reasons. Every level also offers a custom reason
// (`OTHER_REASON_LABEL` in the picker), stored with `isCustomReason: true`.
import type { TaskScoreLevel } from '../types';

// Lowest to highest.
export const TASK_SCORE_LEVELS: TaskScoreLevel[] = ['unclear', 'vague', 'adequate', 'clear', 'excellent'];

// Stored data is cast straight to `TaskScoreLevel`, so check before indexing the maps below.
export function isTaskScoreLevel(value: unknown): value is TaskScoreLevel {
  return typeof value === 'string' && (TASK_SCORE_LEVELS as string[]).includes(value);
}

export const TASK_SCORE_LEVEL_LABELS: Record<TaskScoreLevel, string> = {
  unclear: 'Unclear',
  vague: 'Vague',
  adequate: 'Adequate',
  clear: 'Clear',
  excellent: 'Excellent',
};

export const TASK_SCORE_REASONS: Record<TaskScoreLevel, string[]> = {
  unclear: [
    "Can't tell what was done",
    'Missing context',
    'Too short or one-word description',
    'Ambiguous wording',
    'Spelling/grammar makes it hard to read',
  ],
  vague: [
    'Too generic',
    'Missing the outcome or result',
    'Missing the why',
    'Mixes several tasks in one',
    'Missing ticket or reference',
  ],
  adequate: [
    'Understandable but lacks detail',
    'Could be more concise',
    'Missing result or next step',
    'Minor wording issues',
  ],
  clear: [
    'Clearly states what was done',
    'Includes the outcome',
    'Well structured',
    'Concise and to the point',
  ],
  excellent: [
    'Clear, concise and complete',
    'Includes context, outcome and next steps',
    'Anyone on the team could understand it',
    'Useful references or links',
  ],
};

export const OTHER_REASON_LABEL = 'Other (write your own)';

export const TASK_SCORE_REASON_LIMIT = 200;

// Solid accent per level (CSS color), for the score picker and the badge meter.
// Runs danger -> success using the theme tokens so it follows light/dark mode;
// "vague" has no theme token, so it uses a fixed orange that reads on both themes.
export const TASK_SCORE_LEVEL_COLORS: Record<TaskScoreLevel, string> = {
  unclear: 'rgb(var(--color-danger-fg))',
  vague: 'rgb(234 138 30)',
  adequate: 'rgb(var(--color-attention-fg))',
  clear: 'rgb(var(--color-accent-fg))',
  excellent: 'rgb(var(--color-success-fg))',
};
