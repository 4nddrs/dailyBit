import { FormEvent, useCallback, useMemo, useState, useEffect, type ReactNode } from 'react';
import {
  addLeadNote,
  addLeadQuestion,
  answerQuestion,
  closeAssignment,
  reopenAssignment,
  createAssignment,
  getUserProfile,
  removeAssignment,
  removeLeadNote,
  removeLeadQuestion,
  saveTeamOrder,
} from '../../services/firestore';
import { EditableReport } from '../DeveloperView/DeveloperView';
import { ImageLightbox } from '../ImageLightbox';
import { TASK_DESCRIPTION_LIMIT } from '../../constants';
import { useAssignmentsForDate } from '../../hooks/useAssignmentsForDate';
import { useAssignmentUpdates } from '../../hooks/useAssignmentUpdates';
import type { AssignmentUpdatesByAssignment } from '../../hooks/useAssignmentUpdates';
import { useReportsByDate } from '../../hooks/useReportsByDate';
import { useTeamOrder } from '../../hooks/useTeamOrder';
import { useUserProfiles } from '../../hooks/useUserProfiles';
import { taskLetter } from '../../utils/numbering';
import { mergeSectionItems, taskLettersById } from '../../utils/sectionItems';
import { orderDevelopers, orderReportsByTeam } from '../../utils/team';
import type {
  AssignmentUpdateWithImages,
  AssignmentWithId,
  LeadNoteWithId,
  LeadQuestionKind,
  LeadQuestionWithId,
  QuestionWithId,
  ReportTree,
  SectionWithTasks,
  TaskLink,
  TaskWithId,
  UserProfileWithId,
} from '../../types';
import { todayDateString } from '../../types';

const optionLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
const QUESTION_OPTION_MINIMUM = 2;
const QUESTION_OPTION_LIMIT = 6;
const UNKNOWN_DEVELOPER_NAME = 'Unknown developer';
const ONLY_MINE_STORAGE_KEY = 'leadView.onlyMineFilter';

function loadOnlyMineFilter(): boolean {
  try {
    return window.localStorage.getItem(ONLY_MINE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistOnlyMineFilter(value: boolean): void {
  try {
    window.localStorage.setItem(ONLY_MINE_STORAGE_KEY, String(value));
  } catch {
    // Best-effort only: an unavailable/blocked storage never blocks the toggle.
  }
}

interface LeadViewProps {
  leadUserId: string;
}

// One card entry per developer shown in the reports area: `report` is null
// for a developer who has no report on this date but does have at least one
// visible assignment.
interface CardEntry {
  userId: string;
  report: ReportTree | null;
}

function normalizeDateString(dateString: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return todayDateString();
  }

  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return todayDateString();
  }

  return dateString;
}

function formatDisplayDate(dateString: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${normalizeDateString(dateString)}T00:00:00`));
}

function getOptionLabel(index: number): string {
  return optionLabels[index] ?? String(index + 1);
}

function CompactEmptyState({ text }: { text: string }) {
  return <p className="py-1 text-sm text-fg-muted">{text}</p>;
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function OnlyMineToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-fg-muted">
      Only my questions &amp; tasks
      <button
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition ${
          checked ? 'border-accent-emphasis bg-accent-emphasis' : 'border-line bg-neutral-muted'
        }`}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition ${
            checked ? 'translate-x-4' : 'translate-x-1'
          }`}
          aria-hidden="true"
        />
      </button>
    </label>
  );
}

function EditModeToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-fg-muted">
      Edit mode
      <button
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition ${
          checked ? 'border-accent-emphasis bg-accent-emphasis' : 'border-line bg-neutral-muted'
        }`}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition ${
            checked ? 'translate-x-4' : 'translate-x-1'
          }`}
          aria-hidden="true"
        />
      </button>
    </label>
  );
}

function LeadHeader({
  date,
  onDateChange,
  reportedCount,
  totalDeveloperCount,
  onlyMineFilter,
  onOnlyMineFilterChange,
  editMode,
  onEditModeChange,
}: {
  date: string;
  onDateChange: (date: string) => void;
  reportedCount: number;
  totalDeveloperCount: number;
  onlyMineFilter: boolean;
  onOnlyMineFilterChange: (checked: boolean) => void;
  editMode: boolean;
  onEditModeChange: (checked: boolean) => void;
}) {
  return (
    <header className="rounded-md border border-line bg-canvas shadow-sm">
      <div className="flex flex-col gap-3 rounded-t-md border-b border-line bg-canvas-subtle px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <h1 className="text-xl font-semibold text-fg">{formatDisplayDate(date)}</h1>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            Report date
            <input
              className="rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
              type="date"
              value={date}
              onChange={(event) => onDateChange(event.target.value)}
            />
          </label>
          <OnlyMineToggle checked={onlyMineFilter} onChange={onOnlyMineFilterChange} />
          <EditModeToggle checked={editMode} onChange={onEditModeChange} />
          <span className="rounded-full bg-neutral-muted px-2 py-0.5 text-xs font-medium text-fg-muted">
            {reportedCount}/{totalDeveloperCount} reported
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success-emphasis/40 bg-success-muted px-2 py-0.5 text-xs font-medium text-success-fg">
            <span className="h-2 w-2 animate-pulse rounded-full bg-success-fg" aria-hidden="true" />
            Live
          </span>
        </div>
      </div>
    </header>
  );
}

export function LinkChips({ links = [] }: { links?: TaskLink[] }) {
  if (links.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {links.map((link, index) => (
        <a
          className="max-w-full truncate rounded-full border border-accent-emphasis/60 bg-accent-muted px-3 py-1 text-xs font-medium text-accent-fg transition hover:border-accent-emphasis hover:bg-accent-emphasis/25"
          href={link.url}
          key={`${link.url}-${index}`}
          rel="noreferrer"
          target="_blank"
        >
          {link.label || link.url}
        </a>
      ))}
    </div>
  );
}

// `onRemove` is optional so this block can be reused read-only (e.g. the
// developer's "Preview as lead" mode), where no removal action exists.
export function LeadNoteBlock({
  notes,
  onRemove,
}: {
  notes: LeadNoteWithId[];
  onRemove?: (noteId: string) => void;
}) {
  if (notes.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      {notes.map((note) => (
        <div
          className="flex items-start justify-between gap-3 rounded-md border-l-2 border-attention-emphasis bg-attention-muted px-3 py-2 text-sm text-attention-fg"
          key={note.id}
        >
          <p className="min-w-0 break-words leading-6">{note.noteText}</p>
          {onRemove ? (
            <RemoveButton label="Remove note" onClick={() => onRemove(note.id)} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function AnswerAttachmentImages({ images }: { images: Array<{ id: string; imageBase64: string }> }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (images.length === 0) {
    return null;
  }

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {images.map((image, index) => (
          <button
            className="cursor-zoom-in rounded-md focus:outline-none focus:ring-1 focus:ring-accent-emphasis"
            key={image.id}
            type="button"
            aria-label="Open answer image"
            onClick={() => setLightboxIndex(index)}
          >
            <img
              className="h-16 w-16 rounded-md border border-line object-cover transition hover:opacity-90"
              src={image.imageBase64}
              alt="Lead question answer attachment thumbnail"
            />
          </button>
        ))}
      </div>
      {lightboxIndex !== null ? (
        <ImageLightbox
          images={images}
          initialIndex={Math.min(lightboxIndex, images.length - 1)}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </>
  );
}

// `onRemove` is optional so this item can be reused read-only (e.g. the
// developer's "Preview as lead" mode), where no removal action exists.
export function LeadQuestionItem({
  question,
  onRemove,
  context,
}: {
  question: LeadQuestionWithId;
  onRemove?: (questionId: string) => void;
  context?: string;
}) {
  const isAnswered =
    question.kind === 'text'
      ? (Boolean(question.answerText?.trim()) || (question.answerLinks?.length ?? 0) > 0 || question.answerImages.length > 0)
      : question.selectedAnswer !== undefined;

  return (
    <div className="rounded-md border-l-2 border-done-emphasis bg-canvas-subtle px-3 py-2 text-sm">
      {context ? <p className="mb-1 break-words text-xs font-medium text-fg-muted">{context}</p> : null}
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words font-semibold leading-6 text-done-fg">{question.questionText}</p>
        {onRemove ? (
          <RemoveButton label="Remove question" onClick={() => onRemove(question.id)} />
        ) : null}
      </div>

      {!isAnswered ? (
        <p className="mt-2 text-xs font-semibold text-attention-fg">Waiting for answer</p>
      ) : question.kind === 'text' ? (
        <>
          <p className="mt-2 break-words rounded-md border border-success-emphasis/40 bg-success-muted px-3 py-2 text-sm text-success-fg">
            {question.answerText}
          </p>
          <LinkChips links={question.answerLinks} />
          <AnswerAttachmentImages images={question.answerImages} />
        </>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {(question.options ?? []).map((option, index) => (
            <span
              className={`max-w-full break-words rounded-full border px-3 py-1 text-xs font-medium ${
                question.selectedAnswer === index
                  ? 'border-success-emphasis/40 bg-success-muted text-success-fg'
                  : 'border-line bg-canvas-subtle text-fg-muted'
              }`}
              key={`${option}-${index}`}
            >
              {getOptionLabel(index)}. {option}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// `onRemove` is optional so this block can be reused read-only (e.g. the
// developer's "Preview as lead" mode), where no removal action exists.
export function LeadQuestionBlock({
  questions,
  onRemove,
}: {
  questions: LeadQuestionWithId[];
  onRemove?: (questionId: string) => void;
}) {
  if (questions.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      {questions.map((question) => (
        <LeadQuestionItem key={question.id} question={question} onRemove={onRemove} />
      ))}
    </div>
  );
}

// "Only my questions & tasks" mode hides section/task cards entirely, so
// per-task lead questions are flattened here with the task's own description
// shown as context instead of being nested under a task card.
function LeadTaskQuestionsOnly({
  sections,
  questionsByTarget,
  onRemove,
}: {
  sections: SectionWithTasks[];
  questionsByTarget: Map<string, LeadQuestionWithId[]>;
  onRemove: (questionId: string) => void;
}) {
  const items = sections.flatMap((section) =>
    section.tasks.flatMap((task) =>
      (questionsByTarget.get(task.id) ?? []).map((question) => ({ task, question })),
    ),
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      {items.map(({ task, question }) => (
        <LeadQuestionItem key={question.id} question={question} onRemove={onRemove} context={task.description} />
      ))}
    </div>
  );
}

type LeadActionKind = 'question' | 'note' | 'task';

const leadActionStyles: Record<LeadActionKind, string> = {
  question:
    'border-done-emphasis/60 bg-done-muted text-done-fg hover:border-done-emphasis hover:bg-done-emphasis/40 aria-pressed:border-done-emphasis aria-pressed:bg-done-emphasis/40',
  note: 'border-attention-emphasis/60 bg-attention-muted text-attention-fg hover:border-attention-emphasis hover:bg-attention-emphasis/40 aria-pressed:border-attention-emphasis aria-pressed:bg-attention-emphasis/40',
  task: 'border-accent-emphasis/60 bg-accent-muted text-accent-fg hover:border-accent-emphasis hover:bg-accent-emphasis/40 aria-pressed:border-accent-emphasis aria-pressed:bg-accent-emphasis/40',
};

const leadActionLabels: Record<LeadActionKind, string> = {
  question: 'Ask a question',
  note: 'Add a note',
  task: 'Assign a task',
};

function LeadActionIcon({ kind }: { kind: LeadActionKind }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === 'question' ? (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M6.25 6.25a1.75 1.75 0 1 1 2.6 1.53c-.5.28-.85.62-.85 1.22v.25" />
          <circle cx="8" cy="11.5" r="0.4" fill="currentColor" />
        </>
      ) : kind === 'note' ? (
        <>
          <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.5" />
          <path d="M5 6.5h6M5 9.5h4" />
        </>
      ) : (
        <>
          <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1.5" />
          <path d="m5.25 8.25 1.75 1.75 3.75-4" />
        </>
      )}
    </svg>
  );
}

// Always-visible icon button for the lead's Question / Note / Task actions.
// `active` marks the button whose composer is currently open.
function LeadActionButton({
  kind,
  active = false,
  onClick,
}: {
  kind: LeadActionKind;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition hover:scale-110 hover:shadow-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-emphasis ${leadActionStyles[kind]}`}
      type="button"
      aria-label={leadActionLabels[kind]}
      aria-pressed={active}
      title={leadActionLabels[kind]}
      onClick={onClick}
    >
      <LeadActionIcon kind={kind} />
    </button>
  );
}

// Always-visible trash button used for every lead-side removal.
function RemoveButton({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-danger-fg transition hover:scale-110 hover:bg-danger-emphasis/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-danger-emphasis disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 disabled:hover:bg-transparent"
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.75 1.75 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z" />
      </svg>
    </button>
  );
}

function NoteComposer({
  label,
  onAdd,
}: {
  label: string;
  onAdd: (noteText: string) => Promise<void>;
}) {
  const [noteText, setNoteText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedNote = noteText.trim();

    if (!trimmedNote) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onAdd(trimmedNote);
      setNoteText('');
    } catch (caughtError) {
      console.error('Lead note failed', caughtError);
      setError('Note could not be saved. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-3 rounded-md border-l-2 border-attention-emphasis bg-attention-muted p-4" onSubmit={handleSubmit}>
      <label className="block text-xs font-semibold uppercase tracking-wide text-attention-fg">
        {label}
        <textarea
          className="mt-2 min-h-20 w-full resize-y rounded-md border border-line bg-canvas-inset px-3 py-2 text-sm normal-case tracking-normal text-fg outline-none transition placeholder:text-fg-muted focus:border-attention-emphasis focus:ring-1 focus:ring-attention-muted"
          value={noteText}
          onChange={(event) => setNoteText(event.target.value)}
          placeholder="Add a private lead note"
          autoFocus
        />
      </label>
      {error ? <p className="mt-2 text-xs font-medium text-danger-fg">{error}</p> : null}
      <div className="mt-2 flex justify-end">
        <button
          className="rounded-md bg-attention-emphasis px-3 py-1.5 text-sm font-medium text-white transition hover:bg-attention-emphasis/80 disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
          disabled={!noteText.trim() || submitting}
        >
          {submitting ? 'Saving...' : 'Add note'}
        </button>
      </div>
    </form>
  );
}

function LeadQuestionComposer({
  onAdd,
}: {
  onAdd: (input: { questionText: string; kind: LeadQuestionKind; options?: string[] }) => Promise<void>;
}) {
  const [questionText, setQuestionText] = useState('');
  const [kind, setKind] = useState<LeadQuestionKind>('text');
  const [options, setOptions] = useState(['', '']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateOption(index: number, value: string) {
    setOptions((currentOptions) =>
      currentOptions.map((option, optionIndex) => (optionIndex === index ? value : option)),
    );
  }

  function removeOption(index: number) {
    if (options.length <= QUESTION_OPTION_MINIMUM) {
      return;
    }
    setOptions((currentOptions) => currentOptions.filter((_, optionIndex) => optionIndex !== index));
  }

  const trimmedOptions = options.map((option) => option.trim()).filter(Boolean);
  const canSubmit =
    questionText.trim().length > 0 && (kind === 'text' || trimmedOptions.length >= QUESTION_OPTION_MINIMUM);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = questionText.trim();

    if (!trimmedQuestion || (kind === 'options' && trimmedOptions.length < QUESTION_OPTION_MINIMUM)) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onAdd({
        questionText: trimmedQuestion,
        kind,
        options: kind === 'options' ? trimmedOptions : undefined,
      });
      setQuestionText('');
      setOptions(['', '']);
      setKind('text');
    } catch (caughtError) {
      console.error('Lead question failed', caughtError);
      setError('Question could not be saved. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-3 rounded-md border-l-2 border-done-emphasis bg-canvas-subtle p-4" onSubmit={handleSubmit}>
      <label className="block text-xs font-semibold uppercase tracking-wide text-done-fg">
        Question for the developer
        <textarea
          className="mt-2 min-h-20 w-full resize-y rounded-md border border-line bg-canvas-inset px-3 py-2 text-sm normal-case tracking-normal text-fg outline-none transition placeholder:text-fg-muted focus:border-done-emphasis focus:ring-1 focus:ring-done-muted"
          value={questionText}
          onChange={(event) => setQuestionText(event.target.value)}
          placeholder="What do you need to know about this task?"
          autoFocus
        />
      </label>

      <div className="mt-3 flex gap-2">
        <button
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
            kind === 'text'
              ? 'border-done-emphasis/40 bg-done-muted text-done-fg'
              : 'border-line bg-canvas-subtle text-fg-muted hover:border-done-emphasis/40'
          }`}
          type="button"
          onClick={() => setKind('text')}
        >
          Free text
        </button>
        <button
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
            kind === 'options'
              ? 'border-done-emphasis/40 bg-done-muted text-done-fg'
              : 'border-line bg-canvas-subtle text-fg-muted hover:border-done-emphasis/40'
          }`}
          type="button"
          onClick={() => setKind('options')}
        >
          Options
        </button>
      </div>

      {kind === 'options' ? (
        <div className="mt-3 space-y-2">
          {options.map((option, index) => (
            <div className="flex items-center gap-2" key={index}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-muted text-xs font-semibold text-fg">
                {getOptionLabel(index)}
              </span>
              <input
                className="min-w-0 flex-1 rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
                value={option}
                onChange={(event) => updateOption(index, event.target.value)}
                placeholder={`Option ${getOptionLabel(index)}`}
              />
              <RemoveButton
                label={`Remove option ${getOptionLabel(index)}`}
                disabled={options.length <= QUESTION_OPTION_MINIMUM}
                onClick={() => removeOption(index)}
              />
            </div>
          ))}
          <button
            className="rounded-md border border-line bg-control px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            disabled={options.length >= QUESTION_OPTION_LIMIT}
            onClick={() => setOptions((currentOptions) => [...currentOptions, ''])}
          >
            Add option
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs font-medium text-danger-fg">{error}</p> : null}

      <div className="mt-3 flex justify-end">
        <button
          className="rounded-md bg-done-emphasis px-3 py-1.5 text-sm font-medium text-white transition hover:bg-done-emphasis/80 disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
          disabled={!canSubmit || submitting}
        >
          {submitting ? 'Asking...' : 'Ask question'}
        </button>
      </div>
    </form>
  );
}

// After creating an assignment, bring the new row into view. The Firestore
// listener applies local writes almost immediately, so wait a frame or two for
// the row to render before scrolling.
function revealAssignment(assignmentId: string, assigneeId: string, attemptsLeft = 10) {
  const element = document.getElementById(`assignment-${assignmentId}-${assigneeId}`);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  if (attemptsLeft > 0) {
    window.setTimeout(() => revealAssignment(assignmentId, assigneeId, attemptsLeft - 1), 100);
  }
}

function AssignmentComposer({
  devs,
  preselectedDevId,
  relatedTask,
  onAssign,
  onDone,
}: {
  devs: UserProfileWithId[];
  preselectedDevId: string;
  relatedTask?: { description: string };
  onAssign: (input: {
    description: string;
    assigneeIds: string[];
    relatedTask?: { description: string };
  }) => Promise<string>;
  onDone: (assignmentId: string) => void;
}) {
  const [description, setDescription] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    preselectedDevId ? [preselectedDevId] : [],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleAssignee(devId: string) {
    setAssigneeIds((current) =>
      current.includes(devId) ? current.filter((id) => id !== devId) : [...current, devId],
    );
  }

  const trimmedDescription = description.trim();
  const canSubmit = trimmedDescription.length > 0 && assigneeIds.length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const assignmentId = await onAssign({ description: trimmedDescription, assigneeIds, relatedTask });
      setDescription('');
      setAssigneeIds(preselectedDevId ? [preselectedDevId] : []);
      onDone(assignmentId);
    } catch (caughtError) {
      console.error('Assignment create failed', caughtError);
      setError('Task could not be assigned. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-3 rounded-md border-l-2 border-accent-emphasis bg-canvas-subtle p-4" onSubmit={handleSubmit}>
      <label className="block text-xs font-semibold uppercase tracking-wide text-fg">
        Task description
        <textarea
          className="mt-2 min-h-16 w-full resize-y rounded-md border border-line bg-canvas-inset px-3 py-2 text-sm normal-case tracking-normal text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={TASK_DESCRIPTION_LIMIT}
          placeholder="What should they work on?"
          autoFocus
        />
      </label>
      <p className="mt-1 text-right text-xs font-medium text-fg-muted">
        {description.length}/{TASK_DESCRIPTION_LIMIT}
      </p>

      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-fg">Assign to</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {devs.map((dev) => (
            <label
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-canvas px-3 py-1 text-xs font-medium text-fg"
              key={dev.id}
            >
              <input
                className="shrink-0"
                type="checkbox"
                checked={assigneeIds.includes(dev.id)}
                onChange={() => toggleAssignee(dev.id)}
              />
              <span className="min-w-0 break-words">{dev.name}</span>
            </label>
          ))}
        </div>
      </div>

      {error ? <p className="mt-2 text-xs font-medium text-danger-fg" role="alert">{error}</p> : null}

      <div className="mt-3 flex justify-end">
        <button
          className="rounded-md bg-accent-emphasis px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-emphasis/80 disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
          disabled={!canSubmit || submitting}
        >
          {submitting ? 'Assigning...' : 'Assign task'}
        </button>
      </div>
    </form>
  );
}

// Renders one developer's update for an assignment (text, links, image
// thumbnails with their own lightbox), or "No updates" when empty. Shared by
// `LeadAssignmentRow` and the developer's read-only "Preview as lead" mode.
export function AssignmentUpdateDisplay({ update }: { update: AssignmentUpdateWithImages | null }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const hasUpdateContent = Boolean(
    (update?.text && update.text.trim().length > 0) ||
      (update?.links && update.links.length > 0) ||
      (update?.images && update.images.length > 0),
  );
  const images = update?.images ?? [];

  if (!hasUpdateContent) {
    return <p className="text-sm text-fg-muted">No updates</p>;
  }

  return (
    <>
      {update?.text ? <p className="text-sm text-fg">{update.text}</p> : null}
      <LinkChips links={update?.links} />
      {images.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((image, imageIndex) => (
            <button
              className="cursor-zoom-in rounded-md focus:outline-none focus:ring-1 focus:ring-accent-emphasis"
              key={image.id}
              type="button"
              aria-label="Open update image"
              onClick={() => setLightboxIndex(imageIndex)}
            >
              <img
                className="h-16 w-16 rounded-md border border-line object-cover transition hover:opacity-90"
                src={image.imageBase64}
                alt="Assignment update attachment thumbnail"
              />
            </button>
          ))}
        </div>
      ) : null}
      {lightboxIndex !== null ? (
        <ImageLightbox images={images} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      ) : null}
    </>
  );
}

function LeadAssignmentRow({
  assignment,
  assigneeId,
  update,
  onSetClosed,
  onRemove,
}: {
  assignment: AssignmentWithId;
  assigneeId: string;
  update: AssignmentUpdateWithImages | null;
  onSetClosed: (assignmentId: string, closed: boolean) => void;
  onRemove: (assignmentId: string) => void;
}) {
  const hasUpdateContent = Boolean(
    (update?.text && update.text.trim().length > 0) ||
      (update?.links && update.links.length > 0) ||
      (update?.images && update.images.length > 0),
  );
  const isClosed = assignment.status === 'closed';
  const otherAssigneeCount = assignment.assigneeIds.filter((id) => id !== assigneeId).length;

  return (
    <article id={`assignment-${assignment.id}-${assigneeId}`} className="scroll-mt-4 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={`break-words text-sm font-medium leading-6 ${isClosed ? 'text-fg-muted line-through' : 'text-fg'}`}
          >
            {assignment.description}
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            Assigned {assignment.startDate}
            {otherAssigneeCount > 0
              ? ` · Shared with ${otherAssigneeCount} other ${pluralize(otherAssigneeCount, 'developer', 'developers')}`
              : ''}
          </p>
          {assignment.relatedTask ? (
            <p className="mt-1 truncate text-xs text-fg-muted">About: {assignment.relatedTask.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
              hasUpdateContent
                ? 'border-success-emphasis/40 bg-success-muted text-success-fg'
                : 'border-line bg-neutral-muted text-fg-muted'
            }`}
          >
            {hasUpdateContent ? 'Updated' : 'No updates'}
          </span>
          {/* One toggle: "Close" while open, "Reopen" once closed. */}
          <button
            className={`w-16 shrink-0 rounded-md border px-2 py-1 text-xs font-medium transition ${
              isClosed
                ? 'border-accent-emphasis/60 bg-accent-muted text-accent-fg hover:border-accent-emphasis hover:bg-accent-emphasis/40'
                : 'border-line bg-control text-fg hover:border-fg-muted hover:bg-control-hover'
            }`}
            type="button"
            title={isClosed ? 'Reopen this task' : 'Close this task'}
            onClick={() => onSetClosed(assignment.id, !isClosed)}
          >
            {isClosed ? 'Reopen' : 'Close'}
          </button>
          <RemoveButton label="Remove assignment" onClick={() => onRemove(assignment.id)} />
        </div>
      </div>

      <div className="mt-2">
        <AssignmentUpdateDisplay update={update} />
      </div>
    </article>
  );
}

function LeadAssignmentsBox({
  assignments,
  assigneeId,
  updatesByAssignment,
  onSetClosed,
  onRemove,
}: {
  assignments: AssignmentWithId[];
  assigneeId: string;
  updatesByAssignment: AssignmentUpdatesByAssignment;
  onSetClosed: (assignmentId: string, closed: boolean) => void;
  onRemove: (assignmentId: string) => void;
}) {
  if (assignments.length === 0) {
    return null;
  }

  return (
    <section className="mt-4 rounded-md bg-canvas-subtle">
      <div className="flex items-center gap-2 px-4 py-3">
        <h3 className="text-base font-semibold text-fg">Assigned by lead</h3>
        <span className="rounded-full border border-accent-emphasis/40 bg-accent-muted px-2 py-0.5 text-xs font-medium text-accent-fg">
          {assignments.length}
        </span>
      </div>
      <div className="divide-y divide-line">
        {assignments.map((assignment) => (
          <LeadAssignmentRow
            key={assignment.id}
            assignment={assignment}
            assigneeId={assigneeId}
            update={updatesByAssignment.get(assignment.id)?.get(assigneeId) ?? null}
            onSetClosed={onSetClosed}
            onRemove={onRemove}
          />
        ))}
      </div>
    </section>
  );
}

function TaskCard({
  reportId,
  sectionId,
  task,
  letter,
  notes,
  questions,
  allDevs,
  reportOwnerId,
  onAddNote,
  onRemoveNote,
  onAddQuestion,
  onRemoveQuestion,
  onCreateAssignment,
}: {
  reportId: string;
  sectionId: string;
  task: TaskWithId;
  letter: string;
  notes: LeadNoteWithId[];
  questions: LeadQuestionWithId[];
  allDevs: UserProfileWithId[];
  reportOwnerId: string;
  onAddNote: (targetTaskId: string, noteText: string) => Promise<void>;
  onRemoveNote: (noteId: string) => void;
  onAddQuestion: (
    taskId: string,
    sectionId: string,
    input: { questionText: string; kind: LeadQuestionKind; options?: string[] },
  ) => Promise<void>;
  onRemoveQuestion: (questionId: string) => void;
  onCreateAssignment: (input: {
    description: string;
    assigneeIds: string[];
    relatedTask?: { description: string };
  }) => Promise<string>;
}) {
  const [openComposer, setOpenComposer] = useState<'question' | 'note' | 'task' | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  function toggleComposer(composer: 'question' | 'note' | 'task') {
    setOpenComposer((current) => (current === composer ? null : composer));
  }

  return (
    <article className="px-4 py-3">
      <div className={`grid gap-3 ${task.images.length > 0 ? 'md:grid-cols-[7rem_1fr]' : ''}`}>
        {task.images.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {task.images.map((image, imageIndex) => (
              <button
                className="cursor-zoom-in rounded-md focus:outline-none focus:ring-1 focus:ring-accent-emphasis"
                key={image.id}
                type="button"
                aria-label="Open task image"
                onClick={() => setLightboxIndex(imageIndex)}
              >
                <img
                  className="h-24 w-24 rounded-md border border-line object-cover transition hover:opacity-90"
                  src={image.imageBase64}
                  alt="Task attachment thumbnail"
                />
              </button>
            ))}
          </div>
        ) : null}

        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-1.5 text-sm font-medium leading-6 text-fg">
              <span className="shrink-0 font-semibold text-fg-muted tabular-nums">{letter}.</span>
              {/* Links share the text column so they indent with the description. */}
              <div className="min-w-0">
                <p className="break-words">{task.description}</p>
                <LinkChips links={task.links} />
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <LeadActionButton kind="question" active={openComposer === 'question'} onClick={() => toggleComposer('question')} />
              <LeadActionButton kind="note" active={openComposer === 'note'} onClick={() => toggleComposer('note')} />
              <LeadActionButton kind="task" active={openComposer === 'task'} onClick={() => toggleComposer('task')} />
            </div>
          </div>
        </div>
      </div>

      {openComposer === 'question' ? (
        <LeadQuestionComposer
          onAdd={async (input) => {
            await onAddQuestion(task.id, sectionId, input);
            setOpenComposer(null);
          }}
        />
      ) : null}
      {openComposer === 'note' ? (
        <NoteComposer
          label="Lead task note"
          onAdd={async (noteText) => {
            await onAddNote(task.id, noteText);
            setOpenComposer(null);
          }}
        />
      ) : null}
      {openComposer === 'task' ? (
        <AssignmentComposer
          devs={allDevs}
          preselectedDevId={reportOwnerId}
          relatedTask={{ description: task.description }}
          onAssign={onCreateAssignment}
          onDone={(assignmentId) => {
            setOpenComposer(null);
            revealAssignment(assignmentId, reportOwnerId);
          }}
        />
      ) : null}

      <LeadQuestionBlock questions={questions} onRemove={onRemoveQuestion} />
      <LeadNoteBlock notes={notes} onRemove={onRemoveNote} />

      {lightboxIndex !== null ? (
        <ImageLightbox
          images={task.images}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </article>
  );
}

function SectionCard({
  reportId,
  section,
  number,
  notesByTarget,
  questionsByTarget,
  allDevs,
  reportOwnerId,
  leadUserId,
  onAddNote,
  onRemoveNote,
  onAddQuestion,
  onRemoveQuestion,
  onCreateAssignment,
}: {
  reportId: string;
  section: SectionWithTasks;
  number: number;
  notesByTarget: Map<string, LeadNoteWithId[]>;
  questionsByTarget: Map<string, LeadQuestionWithId[]>;
  allDevs: UserProfileWithId[];
  reportOwnerId: string;
  leadUserId: string;
  onAddNote: (targetTaskId: string, noteText: string) => Promise<void>;
  onRemoveNote: (noteId: string) => void;
  onAddQuestion: (
    taskId: string,
    sectionId: string,
    input: { questionText: string; kind: LeadQuestionKind; options?: string[] },
  ) => Promise<void>;
  onRemoveQuestion: (questionId: string) => void;
  onCreateAssignment: (input: {
    description: string;
    assigneeIds: string[];
    relatedTask?: { description: string };
  }) => Promise<string>;
}) {
  // Section questions (dev-to-lead, answered in place here) are shown
  // interleaved with tasks by shared `order`, same merge as Developer View
  // and Report Preview. Lead View doesn't reorder them, so this is read-only.
  const mergedItems = useMemo(
    () => mergeSectionItems(section.tasks, section.questions),
    [section.tasks, section.questions],
  );
  const taskLetters = useMemo(() => taskLettersById(mergedItems, taskLetter), [mergedItems]);

  return (
    <section className="rounded-md bg-canvas-subtle">
      <div className="px-4 py-3">
        <h3 className="flex min-w-0 gap-1.5 text-base font-semibold text-fg">
          <span className="shrink-0 text-fg-muted tabular-nums">{number}.</span>
          <span className="min-w-0 break-words">{section.title}</span>
        </h3>
      </div>
      <div className="divide-y divide-line">
        {mergedItems.length > 0 ? (
          mergedItems.map((item) =>
            item.kind === 'task' ? (
              <TaskCard
                key={`task-${item.id}`}
                reportId={reportId}
                sectionId={section.id}
                task={item.task}
                letter={taskLetters.get(item.id) ?? ''}
                notes={notesByTarget.get(item.id) ?? []}
                questions={questionsByTarget.get(item.id) ?? []}
                allDevs={allDevs}
                reportOwnerId={reportOwnerId}
                onAddNote={onAddNote}
                onRemoveNote={onRemoveNote}
                onAddQuestion={onAddQuestion}
                onRemoveQuestion={onRemoveQuestion}
                onCreateAssignment={onCreateAssignment}
              />
            ) : (
              <div className="px-4 py-3" key={`question-${item.id}`}>
                <span className="mb-2 inline-flex items-center rounded-full border border-done-emphasis/60 bg-done-muted px-2 py-0.5 text-xs font-medium text-done-fg">
                  Question
                </span>
                <QuestionCard
                  reportId={reportId}
                  question={item.question}
                  leadUserId={leadUserId}
                  notes={notesByTarget.get(item.id) ?? []}
                  onAddNote={onAddNote}
                  onRemoveNote={onRemoveNote}
                />
              </div>
            ),
          )
        ) : (
          <div className="px-4 py-2">
            <CompactEmptyState text="No tasks in this section." />
          </div>
        )}
      </div>
    </section>
  );
}

// Read-only option rows for a developer's multiple-choice question: one bordered
// row per option so each option's links and images stay visibly grouped. The
// caller supplies the right-hand action (Choose button, Selected pill, ...).
export function QuestionOptionList({
  question,
  renderAction,
}: {
  question: QuestionWithId;
  renderAction?: (index: number, selected: boolean) => ReactNode;
}) {
  return (
    <ol className="mt-3 space-y-2">
      {question.options.map((option, index) => {
        const selected = question.selectedAnswer === index;
        const links = question.optionDetails?.[index]?.links ?? [];
        const images = question.optionImages.filter((image) => image.optionIndex === index);
        const hasAttachments = links.length > 0 || images.length > 0;

        return (
          <li
            className={`rounded-md border p-3 transition ${
              selected ? 'border-success-emphasis bg-success-muted' : 'border-line bg-canvas-subtle'
            }`}
            key={`${option}-${index}`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  selected ? 'bg-success-emphasis text-white' : 'bg-neutral-muted text-fg'
                }`}
                aria-hidden="true"
              >
                {getOptionLabel(index)}
              </span>
              <p className="min-w-0 flex-1 break-words text-sm text-fg">{option}</p>
              {renderAction?.(index, selected)}
            </div>
            {hasAttachments ? (
              <div className="mt-2 space-y-2 pl-9">
                <AnswerAttachmentImages images={images} />
                <LinkChips links={links} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function QuestionCard({
  reportId,
  question,
  leadUserId,
  notes,
  onAddNote,
  onRemoveNote,
}: {
  reportId: string;
  question: QuestionWithId;
  leadUserId: string;
  notes: LeadNoteWithId[];
  onAddNote: (targetTaskId: string, noteText: string) => Promise<void>;
  onRemoveNote: (noteId: string) => void;
}) {
  const [submittingIndex, setSubmittingIndex] = useState<number | null>(null);
  const [noteComposerOpen, setNoteComposerOpen] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);

  async function handleAnswer(optionIndex: number) {
    setSubmittingIndex(optionIndex);
    setAnswerError(null);
    try {
      await answerQuestion(reportId, question.id, optionIndex, leadUserId);
    } catch (caughtError) {
      console.error('Question answer failed', caughtError);
      setAnswerError('Answer could not be saved. Please try again.');
    } finally {
      setSubmittingIndex(null);
    }
  }

  const isAnswered = question.selectedAnswer !== undefined;

  return (
    <article className="rounded-md border border-line bg-canvas p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-sm font-semibold leading-6 text-fg">{question.questionText}</p>
        <div className="flex shrink-0 items-center gap-2">
          <LeadActionButton
            kind="note"
            active={noteComposerOpen}
            onClick={() => setNoteComposerOpen((current) => !current)}
          />
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
              isAnswered
                ? 'border-success-emphasis/40 bg-success-muted text-success-fg'
                : 'border-attention-emphasis/40 bg-attention-muted text-attention-fg'
            }`}
          >
            {isAnswered ? 'Answered' : 'Needs your answer'}
          </span>
        </div>
      </div>

      <QuestionOptionList
        question={question}
        renderAction={(index, selected) =>
          selected ? (
            <span className="shrink-0 rounded-full border border-success-emphasis/40 px-2 py-0.5 text-xs font-medium text-success-fg">
              Selected
            </span>
          ) : (
            <button
              className="shrink-0 rounded-md border border-line bg-control px-2 py-1 text-xs font-medium text-fg transition hover:border-accent-emphasis/50 hover:bg-accent-muted hover:text-accent-fg disabled:cursor-wait disabled:opacity-60"
              type="button"
              disabled={submittingIndex !== null}
              onClick={() => void handleAnswer(index)}
              aria-label={`Choose option ${getOptionLabel(index)}`}
            >
              {submittingIndex === index ? 'Saving...' : 'Choose'}
            </button>
          )
        }
      />
      {answerError ? <p className="mt-2 text-xs font-medium text-danger-fg" role="alert">{answerError}</p> : null}

      {noteComposerOpen ? (
        <NoteComposer
          label="Lead question note"
          onAdd={async (noteText) => {
            await onAddNote(question.id, noteText);
            setNoteComposerOpen(false);
          }}
        />
      ) : null}
      <LeadNoteBlock notes={notes} onRemove={onRemoveNote} />
    </article>
  );
}

function ReportCard({
  report,
  developerName,
  leadUserId,
  allDevs,
  assignments,
  updatesByAssignment,
  onCreateAssignment,
  onSetAssignmentClosed,
  onRemoveAssignment,
  onlyMineFilter,
  date,
  editMode,
}: {
  report: ReportTree;
  developerName: string;
  leadUserId: string;
  allDevs: UserProfileWithId[];
  assignments: AssignmentWithId[];
  updatesByAssignment: AssignmentUpdatesByAssignment;
  onCreateAssignment: (input: {
    description: string;
    assigneeIds: string[];
    relatedTask?: { description: string };
  }) => Promise<string>;
  onSetAssignmentClosed: (assignmentId: string, closed: boolean) => void;
  onRemoveAssignment: (assignmentId: string) => void;
  onlyMineFilter: boolean;
  date: string;
  editMode: boolean;
}) {
  const [openComposer, setOpenComposer] = useState<'question' | 'note' | 'task' | null>(null);

  // The report already exists (this card only renders for a dev with one),
  // so a lead edit never needs to create it.
  const ensureReportExists = useCallback(async () => report.id, [report.id]);

  const notes = report.notes ?? [];
  const leadQuestions = report.leadQuestions ?? [];

  function toggleComposer(composer: 'question' | 'note' | 'task') {
    setOpenComposer((current) => (current === composer ? null : composer));
  }

  const notesByTarget = useMemo(() => {
    const groupedNotes = new Map<string, LeadNoteWithId[]>();
    notes.forEach((note) => {
      groupedNotes.set(note.targetTaskId, [...(groupedNotes.get(note.targetTaskId) ?? []), note]);
    });
    return groupedNotes;
  }, [notes]);

  const questionsByTarget = useMemo(() => {
    const groupedQuestions = new Map<string, LeadQuestionWithId[]>();
    leadQuestions.forEach((question) => {
      groupedQuestions.set(question.taskId, [
        ...(groupedQuestions.get(question.taskId) ?? []),
        question,
      ]);
    });
    return groupedQuestions;
  }, [leadQuestions]);

  async function handleAddNote(targetTaskId: string, noteText: string) {
    await addLeadNote(report.id, { targetTaskId, noteText });
  }

  function handleRemoveNote(noteId: string) {
    removeLeadNote(report.id, noteId).catch((error: unknown) => {
      console.error('Failed to remove note', error);
    });
  }

  async function handleAddQuestion(
    taskId: string,
    sectionId: string,
    input: { questionText: string; kind: LeadQuestionKind; options?: string[] },
  ) {
    await addLeadQuestion(report.id, { taskId, sectionId, ...input });
  }

  function handleRemoveQuestion(questionId: string) {
    removeLeadQuestion(report.id, questionId).catch((error: unknown) => {
      console.error('Failed to remove question', error);
    });
  }

  const reportLevelNotes = notesByTarget.get('') ?? [];
  const reportLevelQuestions = questionsByTarget.get('') ?? [];
  // Dev questions live either report-level (`report.questions`) or anchored
  // to a section (`section.questions`); the summary counts both.
  const devQuestionCount =
    (report.questions?.length ?? 0) +
    report.sections.reduce((sum, section) => sum + section.questions.length, 0);
  const totalQuestionCount = devQuestionCount + leadQuestions.length;
  const summaryParts = [
    report.sections.length > 0
      ? `${report.sections.length} ${pluralize(report.sections.length, 'section', 'sections')}`
      : null,
    totalQuestionCount > 0
      ? `${totalQuestionCount} ${pluralize(totalQuestionCount, 'question', 'questions')}`
      : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <article className="rounded-md border border-line bg-canvas shadow-sm" id={`report-${report.userId}`}>
      <div className="flex flex-col gap-3 rounded-t-md border-b border-line bg-canvas-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-semibold text-fg">{developerName}</h2>
          {summaryParts.length > 0 ? (
            <p className="mt-0.5 text-xs text-fg-muted">{summaryParts.join(' · ')}</p>
          ) : null}
        </div>
        {editMode ? null : (
          <div className="flex shrink-0 gap-2">
            <LeadActionButton kind="question" active={openComposer === 'question'} onClick={() => toggleComposer('question')} />
            <LeadActionButton kind="note" active={openComposer === 'note'} onClick={() => toggleComposer('note')} />
            <LeadActionButton kind="task" active={openComposer === 'task'} onClick={() => toggleComposer('task')} />
          </div>
        )}
      </div>

      <div className="p-4">
        {editMode ? (
          <EditableReport
            reportId={report.id}
            reportTree={report}
            date={date}
            ownerUserId={report.userId}
            assignments={assignments}
            ensureReportExists={ensureReportExists}
            showWorkHeading={false}
          />
        ) : (
          <>
            {openComposer === 'question' ? (
              <LeadQuestionComposer
                onAdd={async (input) => {
                  await handleAddQuestion('', '', input);
                  setOpenComposer(null);
                }}
              />
            ) : null}
            {openComposer === 'note' ? (
              <NoteComposer
                label="Lead report note"
                onAdd={async (noteText) => {
                  await handleAddNote('', noteText);
                  setOpenComposer(null);
                }}
              />
            ) : null}
            {openComposer === 'task' ? (
              <AssignmentComposer
                devs={allDevs}
                preselectedDevId={report.userId}
                onAssign={onCreateAssignment}
                onDone={(assignmentId) => {
                  setOpenComposer(null);
                  revealAssignment(assignmentId, report.userId);
                }}
              />
            ) : null}

            {onlyMineFilter ? (
              <>
                <LeadQuestionBlock questions={reportLevelQuestions} onRemove={handleRemoveQuestion} />
                <LeadTaskQuestionsOnly
                  sections={report.sections}
                  questionsByTarget={questionsByTarget}
                  onRemove={handleRemoveQuestion}
                />
              </>
            ) : (
              <>
                <LeadQuestionBlock questions={reportLevelQuestions} onRemove={handleRemoveQuestion} />
                <LeadNoteBlock notes={reportLevelNotes} onRemove={handleRemoveNote} />

                <div className="mt-3 space-y-3">
                  {report.sections.length > 0 ? (
                    report.sections.map((section, sectionIndex) => (
                      <SectionCard
                        key={section.id}
                        reportId={report.id}
                        section={section}
                        number={sectionIndex + 1}
                        notesByTarget={notesByTarget}
                        questionsByTarget={questionsByTarget}
                        allDevs={allDevs}
                        reportOwnerId={report.userId}
                        leadUserId={leadUserId}
                        onAddNote={handleAddNote}
                        onRemoveNote={handleRemoveNote}
                        onAddQuestion={handleAddQuestion}
                        onRemoveQuestion={handleRemoveQuestion}
                        onCreateAssignment={onCreateAssignment}
                      />
                    ))
                  ) : (
                    <CompactEmptyState text="No tasks reported yet." />
                  )}
                </div>

                {report.questions && report.questions.length > 0 ? (
                  <section className="mt-4 rounded-md border border-done-emphasis/40 bg-canvas-subtle">
                    <div className="flex items-center gap-2 border-b border-done-emphasis/30 px-4 py-2">
                      <h3 className="min-w-0 break-words text-base font-semibold text-done-fg">
                        Questions from {developerName}
                      </h3>
                      <span className="shrink-0 rounded-full bg-neutral-muted px-2 py-0.5 text-xs font-medium text-fg">
                        {report.questions.length}
                      </span>
                    </div>
                    <div className="space-y-3 p-3">
                      {report.questions.map((question) => (
                        <QuestionCard
                          key={question.id}
                          reportId={report.id}
                          question={question}
                          leadUserId={leadUserId}
                          notes={notesByTarget.get(question.id) ?? []}
                          onAddNote={handleAddNote}
                          onRemoveNote={handleRemoveNote}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}
              </>
            )}

            <LeadAssignmentsBox
              assignments={assignments}
              assigneeId={report.userId}
              updatesByAssignment={updatesByAssignment}
              onSetClosed={onSetAssignmentClosed}
              onRemove={onRemoveAssignment}
            />
          </>
        )}
      </div>
    </article>
  );
}

function AssignmentOnlyCard({
  userId,
  developerName,
  allDevs,
  assignments,
  updatesByAssignment,
  onCreateAssignment,
  onSetAssignmentClosed,
  onRemoveAssignment,
  editMode,
}: {
  userId: string;
  developerName: string;
  allDevs: UserProfileWithId[];
  assignments: AssignmentWithId[];
  updatesByAssignment: AssignmentUpdatesByAssignment;
  onCreateAssignment: (input: {
    description: string;
    assigneeIds: string[];
    relatedTask?: { description: string };
  }) => Promise<string>;
  onSetAssignmentClosed: (assignmentId: string, closed: boolean) => void;
  onRemoveAssignment: (assignmentId: string) => void;
  editMode: boolean;
}) {
  const [composerOpen, setComposerOpen] = useState(false);

  return (
    <article className="rounded-md border border-line bg-canvas shadow-sm" id={`report-${userId}`}>
      <div className="flex items-center justify-between gap-3 rounded-t-md border-b border-line bg-canvas-subtle px-4 py-3">
        <h2 className="min-w-0 break-words text-lg font-semibold text-fg">{developerName}</h2>
        <LeadActionButton kind="task" active={composerOpen} onClick={() => setComposerOpen((current) => !current)} />
      </div>

      <div className="p-4">
        {editMode ? (
          <p className="mb-3 text-xs text-fg-muted">No report to edit yet.</p>
        ) : null}

        {composerOpen ? (
          <AssignmentComposer
            devs={allDevs}
            preselectedDevId={userId}
            onAssign={onCreateAssignment}
            onDone={(assignmentId) => {
              setComposerOpen(false);
              revealAssignment(assignmentId, userId);
            }}
          />
        ) : null}

        <LeadAssignmentsBox
          assignments={assignments}
          assigneeId={userId}
          updatesByAssignment={updatesByAssignment}
          onSetClosed={onSetAssignmentClosed}
          onRemove={onRemoveAssignment}
        />
      </div>
    </article>
  );
}

function TeamBox({
  devs,
  reportedUserIds,
  onMoveDev,
  onReorderDrag,
  onSelectDev,
  error,
}: {
  devs: UserProfileWithId[];
  reportedUserIds: Set<string>;
  onMoveDev: (devId: string, direction: 'up' | 'down') => void;
  onReorderDrag: (draggedId: string, targetId: string) => void;
  onSelectDev: (devId: string) => void;
  error: string | null;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  return (
    <section className="rounded-md border border-line bg-canvas shadow-sm">
      <div className="flex items-center justify-between rounded-t-md border-b border-line bg-canvas-subtle px-4 py-3">
        <h2 className="text-lg font-semibold text-fg">Team</h2>
        <span className="rounded-full bg-neutral-muted px-2 py-0.5 text-xs font-medium text-fg-muted">
          {devs.length}
        </span>
      </div>

      {error ? (
        <p className="px-4 py-2 text-xs font-medium text-danger-fg" role="alert">
          {error}
        </p>
      ) : null}

      {devs.length > 0 ? (
        <ul className="divide-y divide-line">
          {devs.map((dev, index) => (
            <li
              className={`flex items-center gap-2 px-4 py-2 transition ${
                draggingId === dev.id ? 'opacity-50' : ''
              }`}
              key={dev.id}
              draggable
              onDragStart={() => setDraggingId(dev.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (draggingId && draggingId !== dev.id) {
                  onReorderDrag(draggingId, dev.id);
                }
                setDraggingId(null);
              }}
              onDragEnd={() => setDraggingId(null)}
            >
              <span
                className="shrink-0 cursor-grab select-none text-fg-muted"
                aria-hidden="true"
                title="Drag to reorder"
              >
                ⋮⋮
              </span>
              <button
                className="min-w-0 flex-1 truncate text-left text-sm font-medium text-fg transition hover:text-accent-fg"
                type="button"
                onClick={() => onSelectDev(dev.id)}
              >
                {dev.name}
              </button>
              <span title={reportedUserIds.has(dev.id) ? 'Reported' : 'No report'}>
                <span
                  className={`block h-2 w-2 shrink-0 rounded-full ${
                    reportedUserIds.has(dev.id) ? 'bg-success-fg' : 'bg-fg-muted'
                  }`}
                  aria-hidden="true"
                />
                <span className="sr-only">
                  {reportedUserIds.has(dev.id) ? 'Reported' : 'No report'}
                </span>
              </span>
              <div className="flex shrink-0 gap-1">
                <button
                  className="rounded-md border border-line bg-control px-1.5 py-0.5 text-xs text-fg transition hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-40"
                  type="button"
                  disabled={index === 0}
                  aria-label={`Move ${dev.name} up`}
                  onClick={() => onMoveDev(dev.id, 'up')}
                >
                  ↑
                </button>
                <button
                  className="rounded-md border border-line bg-control px-1.5 py-0.5 text-xs text-fg transition hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-40"
                  type="button"
                  disabled={index === devs.length - 1}
                  aria-label={`Move ${dev.name} down`}
                  onClick={() => onMoveDev(dev.id, 'down')}
                >
                  ↓
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-4 py-2">
          <CompactEmptyState text="No developers yet." />
        </div>
      )}
    </section>
  );
}

export function LeadView({ leadUserId }: LeadViewProps) {
  const [selectedDate, setSelectedDate] = useState(() => todayDateString());
  const normalizedSelectedDate = normalizeDateString(selectedDate);
  const { reportTrees, loading } = useReportsByDate(normalizedSelectedDate);
  const { assignments } = useAssignmentsForDate(normalizedSelectedDate);
  const assignmentIds = useMemo(() => assignments.map((assignment) => assignment.id), [assignments]);
  const updatesByAssignment = useAssignmentUpdates(assignmentIds, normalizedSelectedDate);
  const { profiles } = useUserProfiles();
  const { memberOrder } = useTeamOrder();
  const devs = useMemo(() => profiles.filter((profile) => profile.role === 'dev'), [profiles]);
  const totalDeveloperCount = devs.length;
  const [developerNames, setDeveloperNames] = useState<Record<string, string>>({});
  const [onlyMineFilter, setOnlyMineFilter] = useState(() => loadOnlyMineFilter());
  const [editMode, setEditMode] = useState(false);

  function handleOnlyMineFilterChange(next: boolean) {
    setOnlyMineFilter(next);
    persistOnlyMineFilter(next);
  }

  const assignmentsByAssignee = useMemo(() => {
    const grouped = new Map<string, AssignmentWithId[]>();
    assignments.forEach((assignment) => {
      assignment.assigneeIds.forEach((assigneeId) => {
        grouped.set(assigneeId, [...(grouped.get(assigneeId) ?? []), assignment]);
      });
    });
    return grouped;
  }, [assignments]);

  async function handleCreateAssignment(input: {
    description: string;
    assigneeIds: string[];
    relatedTask?: { description: string };
  }) {
    return createAssignment({
      description: input.description,
      assigneeIds: input.assigneeIds,
      createdBy: leadUserId,
      startDate: normalizedSelectedDate,
      relatedTask: input.relatedTask,
    });
  }

  function handleSetAssignmentClosed(assignmentId: string, closed: boolean) {
    const update = closed
      ? closeAssignment(assignmentId, normalizedSelectedDate)
      : reopenAssignment(assignmentId);
    update.catch((error: unknown) => {
      console.error(`Failed to ${closed ? 'close' : 'reopen'} assignment`, error);
    });
  }

  function handleRemoveAssignment(assignmentId: string) {
    removeAssignment(assignmentId).catch((error: unknown) => {
      console.error('Failed to remove assignment', error);
    });
  }

  const persistedOrderedDevs = useMemo(() => orderDevelopers(devs, memberOrder), [devs, memberOrder]);
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
  const [teamOrderError, setTeamOrderError] = useState<string | null>(null);

  // Reset any optimistic override once the source data it was derived from
  // (the dev list or the saved order) actually changes underneath it.
  const devIdsKey = devs.map((dev) => dev.id).join(',');
  const memberOrderKey = memberOrder.join(',');
  useEffect(() => {
    setOrderOverride(null);
  }, [devIdsKey, memberOrderKey]);

  const displayedDevs = useMemo(() => {
    if (!orderOverride) {
      return persistedOrderedDevs;
    }

    const devById = new Map(persistedOrderedDevs.map((dev) => [dev.id, dev]));
    const overridden = orderOverride
      .map((id) => devById.get(id))
      .filter((dev): dev is UserProfileWithId => Boolean(dev));
    const overriddenIds = new Set(overridden.map((dev) => dev.id));
    const missing = persistedOrderedDevs.filter((dev) => !overriddenIds.has(dev.id));

    return [...overridden, ...missing];
  }, [orderOverride, persistedOrderedDevs]);

  const reportedUserIds = useMemo(
    () => new Set(reportTrees.map((report) => report.userId)),
    [reportTrees],
  );

  // A card shows for every developer who has a report on this date, or who
  // has at least one visible assignment on it — even without a report.
  const assignmentOnlyUserIds = useMemo(() => {
    const reportUserIds = reportedUserIds;
    return Array.from(assignmentsByAssignee.keys()).filter((userId) => !reportUserIds.has(userId));
  }, [assignmentsByAssignee, reportedUserIds]);

  const cardEntries = useMemo<CardEntry[]>(
    () => [
      ...reportTrees.map((report) => ({ userId: report.userId, report })),
      ...assignmentOnlyUserIds.map((userId) => ({ userId, report: null })),
    ],
    [reportTrees, assignmentOnlyUserIds],
  );

  const orderedCardEntries = useMemo(
    () => orderReportsByTeam(cardEntries, displayedDevs.map((dev) => dev.id)),
    [cardEntries, displayedDevs],
  );

  // "Only my questions & tasks" hides a card entirely once it has neither a
  // lead question (report- or task-level) nor a visible assignment.
  const visibleCardEntries = useMemo(() => {
    if (!onlyMineFilter) {
      return orderedCardEntries;
    }

    return orderedCardEntries.filter((entry) => {
      const assignmentCount = assignmentsByAssignee.get(entry.userId)?.length ?? 0;
      const leadQuestionCount = entry.report?.leadQuestions?.length ?? 0;
      return leadQuestionCount > 0 || assignmentCount > 0;
    });
  }, [orderedCardEntries, onlyMineFilter, assignmentsByAssignee]);

  async function persistOrder(nextIds: string[]) {
    const previousIds = displayedDevs.map((dev) => dev.id);
    setOrderOverride(nextIds);
    setTeamOrderError(null);
    try {
      await saveTeamOrder(nextIds);
    } catch (error) {
      console.error('Failed to save team order', error);
      setOrderOverride(previousIds);
      setTeamOrderError('Order could not be saved. Please try again.');
    }
  }

  function handleMoveDev(devId: string, direction: 'up' | 'down') {
    const ids = displayedDevs.map((dev) => dev.id);
    const index = ids.indexOf(devId);
    const swapWith = direction === 'up' ? index - 1 : index + 1;

    if (index === -1 || swapWith < 0 || swapWith >= ids.length) {
      return;
    }

    const nextIds = [...ids];
    [nextIds[index], nextIds[swapWith]] = [nextIds[swapWith], nextIds[index]];
    void persistOrder(nextIds);
  }

  function handleReorderDrag(draggedId: string, targetId: string) {
    const ids = displayedDevs.map((dev) => dev.id);
    const fromIndex = ids.indexOf(draggedId);
    const toIndex = ids.indexOf(targetId);

    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
      return;
    }

    const nextIds = [...ids];
    const [moved] = nextIds.splice(fromIndex, 1);
    nextIds.splice(toIndex, 0, moved);
    void persistOrder(nextIds);
  }

  function handleSelectDev(devId: string) {
    document.getElementById(`report-${devId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  useEffect(() => {
    let cancelled = false;
    const missingUserIds = Array.from(
      new Set(cardEntries.map((entry) => entry.userId).filter((userId) => !developerNames[userId])),
    );

    if (missingUserIds.length === 0) {
      return () => undefined;
    }

    missingUserIds.forEach((userId) => {
      getUserProfile(userId)
        .then((profile) => {
          if (!cancelled) {
            setDeveloperNames((currentNames) => ({
              ...currentNames,
              [userId]: profile?.name ?? UNKNOWN_DEVELOPER_NAME,
            }));
          }
        })
        .catch((error: unknown) => {
          console.error(`Failed to load profile for ${userId}`, error);
          if (!cancelled) {
            setDeveloperNames((currentNames) => ({
              ...currentNames,
              [userId]: UNKNOWN_DEVELOPER_NAME,
            }));
          }
        });
    });

    return () => {
      cancelled = true;
    };
  }, [developerNames, cardEntries]);

  return (
    <div className="space-y-6">
      <LeadHeader
        date={normalizedSelectedDate}
        onDateChange={(nextDate) => setSelectedDate(normalizeDateString(nextDate))}
        reportedCount={reportTrees.length}
        totalDeveloperCount={totalDeveloperCount}
        onlyMineFilter={onlyMineFilter}
        onOnlyMineFilterChange={handleOnlyMineFilterChange}
        editMode={editMode}
        onEditModeChange={setEditMode}
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="lg:order-2 lg:w-64 lg:shrink-0 lg:sticky lg:top-20 lg:self-start">
          <TeamBox
            devs={displayedDevs}
            reportedUserIds={reportedUserIds}
            onMoveDev={handleMoveDev}
            onReorderDrag={handleReorderDrag}
            onSelectDev={handleSelectDev}
            error={teamOrderError}
          />
        </aside>

        <div className="min-w-0 flex-1 space-y-6 lg:order-1">
          {loading ? (
            <div className="rounded-md border border-line bg-canvas p-4 text-sm text-fg-muted shadow-sm">
              Loading reports...
            </div>
          ) : visibleCardEntries.length > 0 ? (
            visibleCardEntries.map((entry) =>
              entry.report ? (
                <ReportCard
                  key={entry.userId}
                  report={entry.report}
                  developerName={developerNames[entry.userId] ?? 'Loading…'}
                  leadUserId={leadUserId}
                  allDevs={displayedDevs}
                  assignments={assignmentsByAssignee.get(entry.userId) ?? []}
                  updatesByAssignment={updatesByAssignment}
                  onCreateAssignment={handleCreateAssignment}
                  onSetAssignmentClosed={handleSetAssignmentClosed}
                  onRemoveAssignment={handleRemoveAssignment}
                  onlyMineFilter={onlyMineFilter}
                  date={normalizedSelectedDate}
                  editMode={editMode}
                />
              ) : (
                <AssignmentOnlyCard
                  key={entry.userId}
                  userId={entry.userId}
                  developerName={developerNames[entry.userId] ?? 'Loading…'}
                  allDevs={displayedDevs}
                  assignments={assignmentsByAssignee.get(entry.userId) ?? []}
                  updatesByAssignment={updatesByAssignment}
                  onCreateAssignment={handleCreateAssignment}
                  onSetAssignmentClosed={handleSetAssignmentClosed}
                  onRemoveAssignment={handleRemoveAssignment}
                  editMode={editMode}
                />
              ),
            )
          ) : onlyMineFilter ? (
            <p className="px-4 py-6 text-center text-sm text-fg-muted">Nothing assigned or asked for this date.</p>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-fg-muted">
              No reports yet today. Try a different date if you are reviewing past work.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
