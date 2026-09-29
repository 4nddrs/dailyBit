// Writing-quality score the lead gives a dev task: five word levels, each with
// its own list of canned reasons. Every level also offers a custom reason
// (`OTHER_REASON_LABEL` in the picker), stored with `isCustomReason: true`.
import type { TaskScoreLevel } from '../types';

// Lowest to highest.
export const TASK_SCORE_LEVELS: TaskScoreLevel[] = ['unclear', 'vague', 'adequate', 'clear', 'excellent'];

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

// Badge colors run danger -> success across the five levels, using the
// theme tokens so they follow light/dark mode.
export const TASK_SCORE_LEVEL_STYLES: Record<TaskScoreLevel, string> = {
  unclear: 'border-danger-emphasis/50 bg-danger-muted text-danger-fg',
  vague: 'border-orange-500/50 bg-orange-400/10 text-orange-700 dark:text-orange-300',
  adequate: 'border-attention-emphasis/50 bg-attention-muted text-attention-fg',
  clear: 'border-accent-emphasis/50 bg-accent-muted text-accent-fg',
  excellent: 'border-success-emphasis/50 bg-success-muted text-success-fg',
};
