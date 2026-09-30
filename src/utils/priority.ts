// Priority the lead can put on the questions and tasks (assignments) they create.
import type { PriorityLevel } from '../types';

// Lowest to highest.
export const PRIORITY_LEVELS: PriorityLevel[] = ['low', 'medium', 'high'];

// Stored data is cast straight to `PriorityLevel`, so check before indexing the maps below;
// an unknown value counts as no priority.
export function isPriorityLevel(value: unknown): value is PriorityLevel {
  return typeof value === 'string' && (PRIORITY_LEVELS as string[]).includes(value);
}

export const PRIORITY_LEVEL_LABELS: Record<PriorityLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

// Accent per level (CSS color), from the theme tokens so it follows light/dark mode.
export const PRIORITY_LEVEL_COLORS: Record<PriorityLevel, string> = {
  low: 'rgb(var(--color-accent-fg))',
  medium: 'rgb(var(--color-attention-fg))',
  high: 'rgb(var(--color-danger-fg))',
};
