import type { QuestionWithId, TaskWithId } from '../types';

export type SectionItem =
  | { kind: 'task'; id: string; order: number; task: TaskWithId }
  | { kind: 'question'; id: string; order: number; question: QuestionWithId };

// Merges a section's tasks and its own dev questions into one ordered list,
// shared by Developer View, Lead View, and Report Preview so all three show
// section questions interleaved with tasks the same way. Ties (equal
// `order`, e.g. both freshly created) break tasks-before-questions, then by
// id, so the merge order stays deterministic.
export function mergeSectionItems(tasks: TaskWithId[], questions: QuestionWithId[]): SectionItem[] {
  const items: SectionItem[] = [
    ...tasks.map((task) => ({ kind: 'task' as const, id: task.id, order: task.order, task })),
    ...questions.map((question) => ({
      kind: 'question' as const,
      id: question.id,
      order: question.order ?? 0,
      question,
    })),
  ];

  return items.sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    if (a.kind !== b.kind) {
      return a.kind === 'task' ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

// Task letters (`a, b, c…`) are computed over tasks only, skipping
// questions; this builds a task-id -> letter map over a merged item list so
// callers can look up each task's letter without a second pass.
export function taskLettersById(items: SectionItem[], letterFor: (index: number) => string): Map<string, string> {
  const letters = new Map<string, string>();
  let taskIndex = 0;
  items.forEach((item) => {
    if (item.kind === 'task') {
      letters.set(item.id, letterFor(taskIndex));
      taskIndex += 1;
    }
  });
  return letters;
}
