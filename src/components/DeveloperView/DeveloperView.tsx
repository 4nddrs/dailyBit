import {
  DragEvent,
  FormEvent,
  ReactNode,
  TextareaHTMLAttributes,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  addAssignmentUpdateImage,
  addLeadQuestionAnswerImage,
  addQuestion,
  addQuestionOptionImage,
  addSection,
  addTask,
  addTaskImage,
  answerLeadQuestion,
  removeAssignmentUpdateImage,
  removeLeadQuestionAnswerImage,
  removeQuestion,
  removeSection,
  removeTask,
  removeTaskImage,
  renameSection,
  reorderSectionItems,
  reorderSections,
  saveAssignmentUpdate,
  subscribeAssignmentUpdate,
  updateQuestion,
  updateTask,
} from '../../services/firestore';
import { ImageLightbox } from '../ImageLightbox';
import { carriedLeadQuestionLabel, QuestionOptionList } from '../LeadView/LeadView';
import { ReportPreview } from '../ReportPreview/ReportPreview';
import { useMyAssignments } from '../../hooks/useMyAssignments';
import { useMyLeadQuestionCarryovers } from '../../hooks/useMyLeadQuestionCarryovers';
import { useMyReport } from '../../hooks/useMyReport';
import { PolishError, polishText } from '../../services/polish';
import type { CreateQuestionInput, SectionOrderItem } from '../../services/firestore';
import type { PolishKind } from '../../services/polish';
import type {
  AssignmentUpdateWithImages,
  AssignmentWithId,
  CarriedLeadQuestion,
  LeadNoteWithId,
  LeadQuestionWithId,
  QuestionWithId,
  ReportTree,
  Section,
  SectionWithTasks,
  TaskLink,
  TaskWithId,
} from '../../types';
import { todayDateString } from '../../types';

import { TASK_DESCRIPTION_LIMIT } from '../../constants';
import { taskLetter } from '../../utils/numbering';
import { mergeSectionItems, taskLettersById, type SectionItem } from '../../utils/sectionItems';
const QUESTION_OPTION_LIMIT = 6;
const QUESTION_OPTION_MINIMUM = 2;
const MAX_IMAGE_SIDE = 1024;
const MAX_IMAGE_DATA_URL_LENGTH = 900_000;
const optionLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
// Marks a locally-added option image (not yet uploaded) in a composer option:
// `QuestionOptionRow` mints these, and `QuestionComposer`'s edit-mode submit
// uses the prefix to tell a new upload apart from a kept existing image doc.
const LOCAL_IMAGE_PREFIX = 'local-';
const SECTION_DRAG_TYPE = 'application/x-dailybit-section';
// Carries `{ sectionId, kind: 'task' | 'question', id }`: tasks and section
// questions share one drag type so either can be dropped on the other.
const SECTION_ITEM_DRAG_TYPE = 'application/x-dailybit-section-item';
const PREVIEW_AS_LEAD_STORAGE_KEY = 'developerView.previewAsLead';

function loadPreviewAsLead(): boolean {
  try {
    return window.localStorage.getItem(PREVIEW_AS_LEAD_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistPreviewAsLead(value: boolean): void {
  try {
    window.localStorage.setItem(PREVIEW_AS_LEAD_STORAGE_KEY, String(value));
  } catch {
    // Best-effort only: an unavailable/blocked storage never blocks the toggle.
  }
}

// Swaps `id` with its adjacent neighbor in `direction`; returns null at a
// boundary (nothing to move) or when `id` is not found.
function reorderedIdsForMove(ids: string[], id: string, direction: 'up' | 'down'): string[] | null {
  const index = ids.indexOf(id);
  const swapWith = direction === 'up' ? index - 1 : index + 1;

  if (index === -1 || swapWith < 0 || swapWith >= ids.length) {
    return null;
  }

  const next = [...ids];
  [next[index], next[swapWith]] = [next[swapWith], next[index]];
  return next;
}

// Moves `draggedId` to just before/after `targetId` (i.e. to `targetId`'s
// current slot); returns null when either id is missing or they are equal.
function reorderedIdsForDrag(ids: string[], draggedId: string, targetId: string): string[] | null {
  const fromIndex = ids.indexOf(draggedId);
  const toIndex = ids.indexOf(targetId);

  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return null;
  }

  const next = [...ids];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

interface DeveloperViewProps {
  userId: string;
  developerName: string;
}

function formatDisplayDate(dateString?: string): string {
  if (!dateString) {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(new Date());
  }

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${dateString}T00:00:00`));
}

// `order` is optional here only so a section's questions (whose `order` type
// is optional on `Question`) can be mixed in with its tasks when computing
// the next slot for a new task or question.
function getNextOrder(items: Array<{ order?: number }>): number {
  return items.length === 0 ? 0 : Math.max(...items.map((item) => item.order ?? -1)) + 1;
}

// Drag payload shared by tasks and section questions (see
// SECTION_ITEM_DRAG_TYPE); `key` is the composite `${kind}:${id}` used by the
// section's item-order state.
interface SectionDragPayload {
  sectionId: string;
  kind: 'task' | 'question';
  id: string;
}

function sectionItemKey(item: Pick<SectionDragPayload, 'kind' | 'id'>): string {
  return `${item.kind}:${item.id}`;
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function runSafely(operation: Promise<unknown>, message: string): void {
  operation.catch((error) => {
    console.error(message, error);
  });
}

function getOptionLabel(index: number): string {
  return optionLabels[index] ?? String(index + 1);
}


function loadImageFromObjectUrl(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be loaded.'));
    image.src = objectUrl;
  });
}

// Exported so LeadView's own image-attaching editors (e.g. editing a
// developer's lead question answer in place) compress uploads the same way.
export async function compressTaskImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageFromObjectUrl(objectUrl);
    const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = longestSide > MAX_IMAGE_SIDE ? MAX_IMAGE_SIDE / longestSide : 1;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Image could not be processed.');
    }

    context.drawImage(image, 0, 0, width, height);
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.75);

    if (imageBase64.length > MAX_IMAGE_DATA_URL_LENGTH) {
      throw new Error('Image too large after compression. Please use a smaller image.');
    }

    return imageBase64;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function PreviewAsLeadToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-fg">
      Preview as lead
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

function Header({
  date,
  developerName,
  onDateChange,
  previewAsLead,
  onPreviewAsLeadChange,
}: {
  date: string;
  developerName: string;
  onDateChange: (date: string) => void;
  previewAsLead: boolean;
  onPreviewAsLeadChange: (checked: boolean) => void;
}) {
  return (
    <header className="rounded-md border border-line bg-canvas shadow-sm">
      <div className="flex flex-col gap-3 rounded-t-md border-b border-line bg-canvas-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-fg">{formatDisplayDate(date)}</h1>
          <p className="mt-1 break-words text-sm text-fg-muted">{developerName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-medium text-fg">
          Report date
          <input
            className="rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
            type="date"
            value={date}
            onChange={(event) => {
              if (event.target.value) {
                onDateChange(event.target.value);
              }
            }}
          />
        </label>
        <PreviewAsLeadToggle checked={previewAsLead} onChange={onPreviewAsLeadChange} />
        {previewAsLead ? null : (
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-success-emphasis/40 bg-success-muted px-2 py-1 text-xs font-medium text-success-fg">
            <span className="h-2 w-2 rounded-full bg-success-fg" aria-hidden="true" />
            Everything saves automatically
          </div>
        )}
        </div>
      </div>
    </header>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <p className="px-4 py-6 text-center text-sm text-fg-muted">
      <span className="font-medium text-fg">{title}.</span> {description}
    </p>
  );
}

function SectionTitle({
  reportId,
  section,
}: {
  reportId: string;
  section: SectionWithTasks;
}) {
  const [title, setTitle] = useState(section.title);

  useEffect(() => {
    setTitle(section.title);
  }, [section.title]);

  function persistTitle() {
    const nextTitle = title.trim() || 'Untitled section';
    if (nextTitle !== section.title) {
      runSafely(renameSection(reportId, section.id, nextTitle), 'Section rename failed');
    }
    setTitle(nextTitle);
  }

  return (
    <input
      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-fg outline-none transition hover:border-line focus:border-accent-emphasis focus:bg-canvas-subtle focus:ring-1 focus:ring-accent-emphasis"
      value={title}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={persistTitle}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
      aria-label="Section title"
    />
  );
}

function AddSectionForm({
  sections,
  onAddSection,
}: {
  sections: SectionWithTasks[];
  onAddSection: (section: Section) => Promise<unknown>;
}) {
  const [title, setTitle] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      return;
    }

    runSafely(
      onAddSection({
        title: trimmedTitle,
        order: getNextOrder(sections),
      }),
      'Section add failed',
    );
    setTitle('');
  }

  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleSubmit}>
      <input
        className="min-w-0 flex-1 rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Add main title"
        aria-label="Add main title"
      />
      <button
        className="rounded-md border border-white/15 bg-success-emphasis px-3 py-1.5 text-sm font-medium text-white transition hover:bg-success-hover disabled:cursor-not-allowed disabled:opacity-50"
        type="submit"
        disabled={!title.trim()}
      >
        Add main title
      </button>
    </form>
  );
}

function AddTaskForm({
  reportId,
  section,
  onClose,
}: {
  reportId: string;
  section: SectionWithTasks;
  onClose: () => void;
}) {
  const [description, setDescription] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedDescription = description.trim();

    if (!trimmedDescription) {
      return;
    }

    runSafely(
      addTask(reportId, section.id, {
        description: trimmedDescription,
        links: [],
        // Tasks and section questions share one order space per section.
        order: getNextOrder([...section.tasks, ...section.questions]),
      }),
      'Task add failed',
    );
    // Stay open (and focused) so several tasks can be added in a row.
    setDescription('');
  }

  return (
    <form
      className="rounded-md border-l-2 border-accent-emphasis bg-accent-muted p-4"
      onSubmit={handleSubmit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose();
        }
      }}
    >
      <label className="block text-sm font-medium text-accent-fg">
        New task
        <TaskTextarea
          className="mt-2 w-full rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm font-normal leading-5 text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
          value={description}
          onValueChange={setDescription}
          onEnter={(field) => field.form?.requestSubmit()}
          placeholder="What did you work on? Press Enter to add it."
          maxLength={TASK_DESCRIPTION_LIMIT}
          autoFocus
        />
      </label>
      <div className="mt-3 flex justify-end gap-2">
        <button
          className="rounded-md border border-line bg-control px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-control-hover"
          type="button"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="rounded-md border border-white/15 bg-success-emphasis px-3 py-1.5 text-sm font-medium text-white transition hover:bg-success-hover disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
          disabled={!description.trim()}
        >
          Add task
        </button>
      </div>
    </form>
  );
}

function LinkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25Zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83 0Z" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M1.5 1h13a1.25 1.25 0 0 1 1.25 1.25v11.5A1.25 1.25 0 0 1 14.5 15h-13A1.25 1.25 0 0 1 .25 13.75V2.25A1.25 1.25 0 0 1 1.5 1Zm-.25 1.25v9.19l2.293-2.293a.75.75 0 0 1 .945-.093l2.109 1.406 3.383-3.383a.75.75 0 0 1 1.06 0l2.71 2.71V2.25a.25.25 0 0 0-.25-.25h-13a.25.25 0 0 0-.25.25Zm.25 11.25h11.638l-4.879-4.879-3.339 3.34a.75.75 0 0 1-.945.093L2.5 10.291l-1.25 1.25v1.71a.25.25 0 0 0 .25.25Z" />
      <path d="M5.25 6.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.75 1.75 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z" />
    </svg>
  );
}

function IconButton({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted transition disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? 'hover:bg-danger-muted hover:text-danger-fg' : 'hover:bg-control-hover hover:text-fg'
      }`}
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
    </button>
  );
}

type TaskTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange' | 'onKeyDown' | 'rows'
> & {
  value: string;
  onValueChange: (value: string) => void;
  onEnter: (field: HTMLTextAreaElement) => void;
};

// Task text wraps and grows with its content so long descriptions stay
// readable while typing. Task text is still a single paragraph: Enter runs
// `onEnter` instead of inserting a newline, and pasted line breaks become spaces.
function TaskTextarea({ value, onValueChange, onEnter, className = '', ...props }: TaskTextareaProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const fitHeight = useCallback(() => {
    const field = fieldRef.current;
    if (!field) {
      return;
    }
    field.style.height = 'auto';
    // scrollHeight excludes the border, which border-box sizing counts.
    field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
  }, []);

  useLayoutEffect(fitHeight, [fitHeight, value]);

  // Refit whenever the field's width changes (window or layout resizes, first
  // shown after being hidden) and once web fonts finish loading, since both
  // change where the text wraps. Height-only changes are ignored so the refit
  // cannot retrigger itself.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) {
      return;
    }
    void document.fonts?.ready.then(fitHeight);
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    let lastWidth = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth !== lastWidth) {
        lastWidth = field.clientWidth;
        fitHeight();
      }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [fitHeight]);

  return (
    <textarea
      {...props}
      ref={fieldRef}
      rows={1}
      className={`block resize-none overflow-hidden ${className}`}
      value={value}
      onChange={(event) => onValueChange(event.target.value.replace(/\r\n|[\r\n]/g, ' '))}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onEnter(event.currentTarget);
        }
      }}
    />
  );
}

function CardToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 md:opacity-0 md:group-hover/task:opacity-100 md:group-focus-within/task:opacity-100">
      {children}
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M8 1a.75.75 0 0 1 .728.568l.65 2.598a3.75 3.75 0 0 0 2.706 2.706l2.598.65a.75.75 0 0 1 0 1.456l-2.598.65a3.75 3.75 0 0 0-2.706 2.706l-.65 2.598a.75.75 0 0 1-1.456 0l-.65-2.598a3.75 3.75 0 0 0-2.706-2.706l-2.598-.65a.75.75 0 0 1 0-1.456l2.598-.65a3.75 3.75 0 0 0 2.706-2.706l.65-2.598A.75.75 0 0 1 8 1Z" />
    </svg>
  );
}

/**
 * Shared state machine for a single "Polish with AI" action: calls the
 * `/api/polish` client service for `text`, then hands the result to `onUse`
 * only when the developer explicitly accepts it (never auto-replaces).
 * `status` only ever populates for an `answer` kind, and `exampleAnswer` for
 * an off-topic `answer` or `option` (see `polishText`/`PolishError`); every
 * other kind leaves them `null`.
 */
function usePolishAction({
  kind,
  questionContext,
  onUse,
  onUseExample,
}: {
  kind: PolishKind;
  questionContext?: string;
  onUse: (suggestion: string) => void;
  // Fills the field with the off-topic example answer without saving it —
  // distinct from `onUse`, which some callers (e.g. an answer to a lead
  // question) save immediately. Falls back to `onUse` when the caller
  // doesn't need that distinction (every kind but `answer`, which never
  // gets an example answer anyway).
  onUseExample?: (exampleAnswer: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [status, setStatus] = useState<'ok' | 'partial' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exampleAnswer, setExampleAnswer] = useState<string | null>(null);

  async function trigger(text: string) {
    const trimmedText = text.trim();
    if (!trimmedText || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    setSuggestion(null);
    setStatus(null);
    setExampleAnswer(null);
    try {
      const result = await polishText({ kind, text: trimmedText, questionContext });
      setSuggestion(result.suggestion);
      setStatus(result.status);
    } catch (caughtError) {
      console.error('AI polish failed', caughtError);
      if (caughtError instanceof PolishError) {
        setError(caughtError.message);
        setExampleAnswer(caughtError.exampleAnswer ?? null);
      } else {
        setError('AI polish failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  function useSuggestion() {
    if (suggestion) {
      onUse(suggestion);
    }
    setSuggestion(null);
    setStatus(null);
    setError(null);
  }

  function useExample() {
    if (exampleAnswer) {
      (onUseExample ?? onUse)(exampleAnswer);
    }
    setError(null);
    setExampleAnswer(null);
  }

  function dismiss() {
    setSuggestion(null);
    setStatus(null);
    setError(null);
    setExampleAnswer(null);
  }

  return { loading, suggestion, status, error, exampleAnswer, trigger, useSuggestion, useExample, dismiss };
}

function PolishButton({
  disabled,
  loading,
  onClick,
}: {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <IconButton
      icon={<SparkleIcon />}
      label={loading ? 'Polishing with AI' : 'Polish with AI'}
      onClick={onClick}
      disabled={disabled || loading}
    />
  );
}

function PolishSuggestionPanel({
  loading,
  suggestion,
  status,
  error,
  exampleAnswer,
  exampleLabel = 'Example answer',
  onUse,
  onUseExample,
  onDismiss,
}: {
  loading: boolean;
  suggestion: string | null;
  // Only ever `'partial'` for an `answer` kind; every other caller leaves it
  // `undefined`/`null` and gets the unchanged plain-suggestion layout.
  status?: 'ok' | 'partial' | null;
  error: string | null;
  // Only ever set for an off-topic `answer` or `option` (see
  // `PolishError.exampleAnswer`).
  exampleAnswer?: string | null;
  exampleLabel?: string;
  onUse: () => void;
  onUseExample?: () => void;
  onDismiss: () => void;
}) {
  if (!loading && !suggestion && !error) {
    return null;
  }

  return (
    <div className="mt-2 rounded-md border border-accent-emphasis/40 bg-accent-muted p-2 text-sm" role="status">
      {loading ? (
        <p className="text-fg-muted">Polishing with AI...</p>
      ) : error ? (
        <>
          <p className="font-medium text-danger-fg" role="alert">
            {error}
          </p>
          {exampleAnswer ? (
            <div className="mt-2 rounded-md border border-line bg-canvas p-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{exampleLabel}</p>
              <p className="mt-1 text-fg">{exampleAnswer}</p>
              <div className="mt-2 flex justify-end">
                <button
                  className="rounded-md border border-line bg-control px-2 py-1 text-xs font-medium text-fg transition hover:bg-control-hover"
                  type="button"
                  onClick={onUseExample}
                >
                  Use as starting point
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {status === 'partial' ? (
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Suggested better answer</p>
          ) : null}
          <p className="text-fg">{suggestion}</p>
          {status === 'partial' ? (
            <p className="mt-1 text-xs text-fg-muted">Fill in the [bracketed] parts before saving.</p>
          ) : null}
          <div className="mt-2 flex justify-end gap-2">
            <button
              className="rounded-md border border-line bg-control px-2 py-1 text-xs font-medium text-fg transition hover:bg-control-hover"
              type="button"
              onClick={onDismiss}
            >
              Keep mine
            </button>
            <button
              className="rounded-md border border-white/15 bg-accent-emphasis px-2 py-1 text-xs font-medium text-white transition hover:bg-accent-emphasis/80"
              type="button"
              onClick={onUse}
            >
              Use
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function AttachmentImages({
  images,
  onRemove,
  altText,
}: {
  images: Array<{ id: string; imageBase64: string }>;
  onRemove: (imageId: string) => void;
  altText: string;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (images.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
      {images.map((image, index) => (
        <div className="group/media relative" key={image.id}>
          <button
            className="block w-full cursor-zoom-in rounded-md focus:outline-none focus:ring-1 focus:ring-accent-emphasis"
            type="button"
            onClick={() => setLightboxIndex(index)}
            aria-label="Open attachment image"
          >
            <img
              className="h-24 w-full rounded-md border border-line object-cover transition hover:opacity-90"
              src={image.imageBase64}
              alt={altText}
            />
          </button>
          <button
            className="absolute right-1 top-1 rounded-full bg-canvas-subtle/90 px-1.5 py-0.5 text-xs font-semibold text-danger-fg transition hover:bg-danger-muted hover:text-danger-fg md:opacity-0 md:group-hover/media:opacity-100 md:group-focus-within/media:opacity-100"
            type="button"
            onClick={() => onRemove(image.id)}
            aria-label="Remove image"
          >
            ✕
          </button>
        </div>
      ))}
      {lightboxIndex !== null ? (
        <ImageLightbox
          images={images}
          initialIndex={Math.min(lightboxIndex, images.length - 1)}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </div>
  );
}

function LinkChips({
  links,
  onRemove,
}: {
  links: TaskLink[];
  onRemove: (index: number) => void;
}) {
  if (links.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link, index) => (
        <span
          className="group/link inline-flex items-center gap-2 rounded-full border border-accent-emphasis/60 bg-accent-muted px-3 py-1 text-xs font-medium text-accent-fg"
          key={`${link.url}-${index}`}
        >
          <a className="max-w-[12rem] truncate hover:underline" href={link.url} target="_blank" rel="noreferrer">
            {link.label || link.url}
          </a>
          <button
            className="text-danger-fg transition hover:text-danger-fg md:opacity-0 md:group-hover/link:opacity-100 md:group-focus-within/link:opacity-100"
            type="button"
            onClick={() => onRemove(index)}
            aria-label={`Remove link ${link.label || link.url}`}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

function LinkForm({
  onAdd,
  onClose,
}: {
  onAdd: (link: TaskLink) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');

  function submitLink() {
    const trimmedUrl = url.trim();
    const trimmedLabel = label.trim();

    if (!isValidUrl(trimmedUrl)) {
      return;
    }

    onAdd({ url: trimmedUrl, label: trimmedLabel || undefined });
    setUrl('');
    setLabel('');
    onClose();
  }

  // Deliberately not a <form>: LinkForm is rendered inside other forms (e.g. the
  // question composer), and nested forms would submit the outer form instead.
  return (
    <div
      className="grid gap-2 md:grid-cols-[1fr_9rem_auto_auto]"
      role="group"
      aria-label="Add link"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          submitLink();
        }
      }}
    >
      <input
        className="rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://..."
        aria-label="Link URL"
        autoFocus
      />
      <input
        className="rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="Label"
        aria-label="Link label"
      />
      <button
        className="rounded-md border border-line bg-control px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        disabled={!isValidUrl(url.trim())}
        onClick={submitLink}
      >
        Add link
      </button>
      <button
        className="rounded-md border border-line bg-control px-3 py-1.5 text-sm font-medium text-fg-muted transition hover:bg-control-hover hover:text-fg"
        type="button"
        onClick={onClose}
      >
        Cancel
      </button>
    </div>
  );
}

function TaskAttachments({
  images,
  onRemoveImage,
  imageAlt,
  links,
  onRemoveLink,
  error,
}: {
  images: Array<{ id: string; imageBase64: string }>;
  onRemoveImage: (imageId: string) => void;
  imageAlt: string;
  links: TaskLink[];
  onRemoveLink: (index: number) => void;
  error: string | null;
}) {
  if (images.length === 0 && links.length === 0 && !error) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      <AttachmentImages images={images} onRemove={onRemoveImage} altText={imageAlt} />
      <LinkChips links={links} onRemove={onRemoveLink} />
      {error ? (
        <p className="text-xs font-medium text-danger-fg" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AssignmentUpdateEditor({
  assignmentId,
  assigneeId,
  date,
  update,
}: {
  assignmentId: string;
  assigneeId: string;
  date: string;
  update: AssignmentUpdateWithImages | null;
}) {
  const [text, setText] = useState(update?.text ?? '');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const updatePolish = usePolishAction({
    kind: 'task',
    onUse: (suggestion) => {
      setText(suggestion);
      runSafely(
        saveAssignmentUpdate(assignmentId, assigneeId, date, { text: suggestion }),
        'Assignment update save failed',
      );
    },
  });

  useEffect(() => {
    setText(update?.text ?? '');
  }, [update?.text]);

  const charactersRemaining = TASK_DESCRIPTION_LIMIT - text.length;
  const counterColor = charactersRemaining <= 10 ? 'text-danger-fg' : charactersRemaining <= 25 ? 'text-attention-fg' : 'text-fg-muted';

  function persistText() {
    const nextText = text.trim();
    if (nextText !== (update?.text ?? '')) {
      runSafely(
        saveAssignmentUpdate(assignmentId, assigneeId, date, { text: nextText }),
        'Assignment update save failed',
      );
      setText(nextText);
    }
  }

  function updateLinks(links: TaskLink[]) {
    runSafely(
      saveAssignmentUpdate(assignmentId, assigneeId, date, { links }),
      'Assignment update links save failed',
    );
  }

  async function handleImageSelected(file: File | undefined) {
    if (!file) {
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const imageBase64 = await compressTaskImage(file);
      await addAssignmentUpdateImage(assignmentId, assigneeId, date, imageBase64);
    } catch (error) {
      console.error('Assignment image processing failed', error);
      setUploadError(error instanceof Error ? error.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function handleRemoveImage(imageId: string) {
    setUploadError(null);
    runSafely(
      removeAssignmentUpdateImage(assignmentId, assigneeId, date, imageId),
      'Assignment image remove failed',
    );
  }

  const images = update?.images ?? [];
  const links = update?.links ?? [];

  return (
    <div className="mt-3">
      <div className="flex items-start gap-3">
        <label className="block min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-fg">
          Your update
          <TaskTextarea
            className="mt-2 w-full rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm normal-case leading-5 tracking-normal text-fg outline-none transition focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
            value={text}
            onValueChange={setText}
            onBlur={persistText}
            onEnter={(field) => field.blur()}
            maxLength={TASK_DESCRIPTION_LIMIT}
            placeholder="What did you do on this assignment today?"
          />
        </label>
        <CardToolbar>
          <IconButton icon={<LinkIcon />} label="Add link" onClick={() => setShowLinkForm(true)} />
          <IconButton
            icon={<ImageIcon />}
            label={uploading ? 'Processing image' : 'Add image'}
            onClick={() => fileInputRef.current?.click()}
          />
          <PolishButton
            disabled={!text.trim()}
            loading={updatePolish.loading}
            onClick={() => void updatePolish.trigger(text)}
          />
        </CardToolbar>
      </div>
      <p className={`mt-1 text-right text-xs font-medium ${counterColor}`}>
        {text.length}/{TASK_DESCRIPTION_LIMIT}
      </p>

      <PolishSuggestionPanel
        loading={updatePolish.loading}
        suggestion={updatePolish.suggestion}
        error={updatePolish.error}
        onUse={updatePolish.useSuggestion}
        onDismiss={updatePolish.dismiss}
      />

      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept="image/*"
        onChange={(event) => runSafely(handleImageSelected(event.target.files?.[0]), 'Image selection failed')}
      />

      {showLinkForm ? (
        <div className="mt-3">
          <LinkForm onAdd={(link) => updateLinks([...links, link])} onClose={() => setShowLinkForm(false)} />
        </div>
      ) : null}

      <TaskAttachments
        images={images}
        onRemoveImage={handleRemoveImage}
        imageAlt="Assignment update attachment preview"
        links={links}
        onRemoveLink={(index) => updateLinks(links.filter((_, linkIndex) => linkIndex !== index))}
        error={uploadError}
      />
    </div>
  );
}

function AssignmentRow({
  assignment,
  assigneeId,
  date,
}: {
  assignment: AssignmentWithId;
  assigneeId: string;
  date: string;
}) {
  const [update, setUpdate] = useState<AssignmentUpdateWithImages | null>(null);

  useEffect(() => {
    setUpdate(null);
    const unsubscribe = subscribeAssignmentUpdate(assignment.id, assigneeId, date, setUpdate);
    return unsubscribe;
  }, [assignment.id, assigneeId, date]);

  const hasUpdateContent = Boolean(
    (update?.text && update.text.trim().length > 0) ||
      (update?.links && update.links.length > 0) ||
      (update?.images && update.images.length > 0),
  );

  return (
    <div className="group/task border-l-2 border-accent-emphasis px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-sm font-medium text-fg">{assignment.description}</p>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${
            hasUpdateContent
              ? 'border-success-emphasis/40 bg-success-muted text-success-fg'
              : 'border-attention-emphasis/40 bg-attention-muted text-attention-fg'
          }`}
        >
          {hasUpdateContent ? 'Updated' : 'Pending'}
        </span>
      </div>
      <p className="mt-1 text-xs text-fg-muted">Assigned {assignment.startDate}</p>
      {assignment.relatedTask ? (
        <p className="mt-1 truncate text-xs text-fg-muted">About: {assignment.relatedTask.description}</p>
      ) : null}

      <AssignmentUpdateEditor assignmentId={assignment.id} assigneeId={assigneeId} date={date} update={update} />
    </div>
  );
}

function AssignmentsBox({
  assignments,
  userId,
  date,
}: {
  assignments: AssignmentWithId[];
  userId: string;
  date: string;
}) {
  if (assignments.length === 0) {
    return null;
  }

  return (
    <section className="rounded-md border border-line bg-canvas shadow-sm">
      <div className="flex items-center gap-2 rounded-t-md border-b border-line bg-canvas-subtle px-4 py-3">
        <h2 className="text-lg font-semibold text-fg">Assigned by lead</h2>
        <span className="rounded-full border border-accent-emphasis/40 bg-accent-muted px-2 py-0.5 text-xs font-medium text-accent-fg">
          {assignments.length}
        </span>
      </div>
      <div className="divide-y divide-line">
        {assignments.map((assignment) => (
          <AssignmentRow key={assignment.id} assignment={assignment} assigneeId={userId} date={date} />
        ))}
      </div>
    </section>
  );
}

function LeadNotesReadOnly({ notes }: { notes: LeadNoteWithId[] }) {
  if (notes.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      {notes.map((note) => (
        <p
          className="break-words rounded-md border-l-2 border-attention-emphasis bg-attention-muted px-3 py-2 text-sm leading-6 text-attention-fg"
          key={note.id}
        >
          {note.noteText}
        </p>
      ))}
    </div>
  );
}

// `originLabel` is set only for a carried-over question (report-level or
// task-anchored) and shows an "About task: ... — Asked on ..." (or just
// "Asked on ...") label above it — see `carriedLeadQuestionLabel`.
function LeadQuestionCard({
  reportId,
  question,
  originLabel,
}: {
  reportId: string;
  question: LeadQuestionWithId;
  originLabel?: string;
}) {
  const isText = question.kind === 'text';
  const isAnswered = isText
    ? (Boolean(question.answerText?.trim()) || (question.answerLinks?.length ?? 0) > 0 || question.answerImages.length > 0)
    : question.selectedAnswer !== undefined;
  const [editing, setEditing] = useState(!isAnswered);
  const [answerText, setAnswerText] = useState(question.answerText ?? '');
  const [submittingIndex, setSubmittingIndex] = useState<number | null>(null);
  const [submittingText, setSubmittingText] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const answerPolish = usePolishAction({
    kind: 'answer',
    questionContext: question.questionText,
    // A suggestion with [bracketed] placeholders (a "partial" answer) still
    // needs the developer's facts, so it only fills the field; a complete one
    // is saved right away as before.
    onUse: (suggestion) =>
      /\[[^\]]+\]/.test(suggestion) ? setAnswerText(suggestion) : void handleUseAnswerSuggestion(suggestion),
    // An off-topic example is only a starting point: fill the field, let the
    // developer edit and fill in the [bracketed] parts, never save it as-is.
    onUseExample: (exampleAnswer) => setAnswerText(exampleAnswer),
  });

  useEffect(() => {
    setAnswerText(question.answerText ?? '');
  }, [question.answerText]);

  useEffect(() => {
    setEditing(!isAnswered);
  }, [isAnswered]);

  const answerLinks = question.answerLinks ?? [];
  const answerImages = question.answerImages;

  async function handleTextSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedAnswer = answerText.trim();

    if (!trimmedAnswer) {
      return;
    }

    setSubmittingText(true);
    setAnswerError(null);
    try {
      await answerLeadQuestion(reportId, question.id, { answerText: trimmedAnswer, answerLinks });
      setEditing(false);
    } catch (caughtError) {
      console.error('Lead question answer failed', caughtError);
      setAnswerError('Answer could not be saved. Please try again.');
    } finally {
      setSubmittingText(false);
    }
  }

  async function handleUseAnswerSuggestion(suggestion: string) {
    setAnswerText(suggestion);
    setSubmittingText(true);
    setAnswerError(null);
    try {
      await answerLeadQuestion(reportId, question.id, { answerText: suggestion, answerLinks });
      setEditing(false);
    } catch (caughtError) {
      console.error('Lead question answer failed', caughtError);
      setAnswerError('Answer could not be saved. Please try again.');
    } finally {
      setSubmittingText(false);
    }
  }

  async function handleOptionSelect(index: number) {
    setSubmittingIndex(index);
    setAnswerError(null);
    try {
      await answerLeadQuestion(reportId, question.id, { selectedAnswer: index });
      setEditing(false);
    } catch (caughtError) {
      console.error('Lead question answer failed', caughtError);
      setAnswerError('Answer could not be saved. Please try again.');
    } finally {
      setSubmittingIndex(null);
    }
  }

  function updateAnswerLinks(nextLinks: TaskLink[]) {
    runSafely(
      answerLeadQuestion(reportId, question.id, { answerText: question.answerText ?? '', answerLinks: nextLinks }),
      'Lead question answer links save failed',
    );
  }

  async function handleImageSelected(file: File | undefined) {
    if (!file) {
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const imageBase64 = await compressTaskImage(file);
      await addLeadQuestionAnswerImage(reportId, question.id, imageBase64);
    } catch (error) {
      console.error('Lead question image processing failed', error);
      setUploadError(error instanceof Error ? error.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function handleRemoveImage(imageId: string) {
    setUploadError(null);
    runSafely(
      removeLeadQuestionAnswerImage(reportId, question.id, imageId),
      'Lead question image remove failed',
    );
  }

  return (
    <article className="group/task rounded-md border-l-2 border-done-emphasis bg-canvas-subtle p-3">
      {originLabel ? (
        <p className="mb-1 text-xs font-medium text-fg-muted">{originLabel}</p>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-sm font-semibold leading-6 text-fg">{question.questionText}</p>
        {isText ? (
          <CardToolbar>
            <IconButton icon={<LinkIcon />} label="Add link" onClick={() => setShowLinkForm(true)} />
            <IconButton
              icon={<ImageIcon />}
              label={uploading ? 'Processing image' : 'Add image'}
              onClick={() => fileInputRef.current?.click()}
            />
          </CardToolbar>
        ) : null}
      </div>

      {isText ? (
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept="image/*"
          onChange={(event) => runSafely(handleImageSelected(event.target.files?.[0]), 'Image selection failed')}
        />
      ) : null}

      {isText && showLinkForm ? (
        <div className="mt-2">
          <LinkForm
            onAdd={(link) => updateAnswerLinks([...answerLinks, link])}
            onClose={() => setShowLinkForm(false)}
          />
        </div>
      ) : null}

      {!editing && isAnswered ? (
        <div className="mt-2">
          {isText ? (
            <p className="break-words rounded-md border border-success-emphasis/40 bg-success-muted px-3 py-2 text-sm text-success-fg">
              {question.answerText}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
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
          <button
            className="mt-2 rounded-md border border-line bg-control px-2 py-1 text-xs font-medium text-fg transition hover:bg-control-hover"
            type="button"
            onClick={() => setEditing(true)}
          >
            Change answer
          </button>
        </div>
      ) : isText ? (
        <form className="mt-2" onSubmit={handleTextSubmit}>
          <div className="flex items-start gap-2">
            <textarea
              className="min-h-16 min-w-0 flex-1 resize-y rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
              value={answerText}
              onChange={(event) => setAnswerText(event.target.value)}
              placeholder="Type your answer"
            />
            <PolishButton
              disabled={!answerText.trim()}
              loading={answerPolish.loading}
              onClick={() => void answerPolish.trigger(answerText)}
            />
          </div>
          <PolishSuggestionPanel
            loading={answerPolish.loading}
            suggestion={answerPolish.suggestion}
            status={answerPolish.status}
            error={answerPolish.error}
            exampleAnswer={answerPolish.exampleAnswer}
            onUse={answerPolish.useSuggestion}
            onUseExample={answerPolish.useExample}
            onDismiss={answerPolish.dismiss}
          />
          <div className="mt-2 flex justify-end">
            <button
              className="rounded-md border border-white/15 bg-success-emphasis px-3 py-1.5 text-xs font-medium text-white transition hover:bg-success-hover disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
              disabled={!answerText.trim() || submittingText}
            >
              {submittingText ? 'Sending...' : 'Send answer'}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {(question.options ?? []).map((option, index) => (
            <button
              className={`max-w-full break-words rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
                question.selectedAnswer === index
                  ? 'border-success-emphasis/40 bg-success-muted text-success-fg'
                  : 'border-line bg-canvas-subtle text-fg-muted hover:border-accent-emphasis/50 hover:bg-accent-muted hover:text-accent-fg'
              }`}
              key={`${option}-${index}`}
              type="button"
              disabled={submittingIndex !== null}
              onClick={() => void handleOptionSelect(index)}
            >
              {submittingIndex === index ? 'Saving...' : `${getOptionLabel(index)}. ${option}`}
            </button>
          ))}
        </div>
      )}

      {isText ? (
        <TaskAttachments
          images={answerImages}
          onRemoveImage={handleRemoveImage}
          imageAlt="Lead question answer attachment preview"
          links={answerLinks}
          onRemoveLink={(index) => updateAnswerLinks(answerLinks.filter((_, linkIndex) => linkIndex !== index))}
          error={uploadError}
        />
      ) : null}

      {answerError ? <p className="mt-2 text-xs font-medium text-danger-fg" role="alert">{answerError}</p> : null}
    </article>
  );
}

function TaskCard({
  reportId,
  sectionId,
  task,
  letter,
  leadNotes,
  leadQuestions,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onReorderDrop,
}: {
  reportId: string;
  sectionId: string;
  task: TaskWithId;
  letter: string;
  leadNotes: LeadNoteWithId[];
  leadQuestions: LeadQuestionWithId[];
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onReorderDrop: (draggedKey: string, targetKey: string) => void;
}) {
  const [description, setDescription] = useState(task.description);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragArmed, setDragArmed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const descriptionPolish = usePolishAction({
    kind: 'task',
    onUse: (suggestion) => {
      setDescription(suggestion);
      runSafely(updateTask(reportId, sectionId, task.id, { description: suggestion }), 'Task update failed');
    },
  });

  useEffect(() => {
    setDescription(task.description);
  }, [task.description]);

  const charactersRemaining = TASK_DESCRIPTION_LIMIT - description.length;
  const counterColor = charactersRemaining <= 10 ? 'text-danger-fg' : charactersRemaining <= 25 ? 'text-attention-fg' : 'text-fg-muted';

  function persistDescription() {
    const nextDescription = description.trim();
    if (nextDescription && nextDescription !== task.description) {
      runSafely(updateTask(reportId, sectionId, task.id, { description: nextDescription }), 'Task update failed');
      setDescription(nextDescription);
    }
  }

  async function handleImageSelected(file: File | undefined) {
    if (!file) {
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const imageBase64 = await compressTaskImage(file);
      await addTaskImage(reportId, sectionId, task.id, imageBase64);
    } catch (error) {
      console.error('Image processing failed', error);
      setUploadError(error instanceof Error ? error.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function handleRemoveImage(imageId: string) {
    setUploadError(null);
    runSafely(removeTaskImage(reportId, sectionId, task.id, imageId), 'Image remove failed');
  }

  function updateLinks(links: TaskLink[]) {
    runSafely(updateTask(reportId, sectionId, task.id, { links }), 'Task links update failed');
  }

  function handleDragStart(event: DragEvent<HTMLElement>) {
    const payload: SectionDragPayload = { sectionId, kind: 'task', id: task.id };
    event.dataTransfer.setData(SECTION_ITEM_DRAG_TYPE, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const raw = event.dataTransfer.getData(SECTION_ITEM_DRAG_TYPE);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as SectionDragPayload;
      const targetKey = sectionItemKey({ kind: 'task', id: task.id });
      if (parsed.sectionId === sectionId && sectionItemKey(parsed) !== targetKey) {
        onReorderDrop(sectionItemKey(parsed), targetKey);
      }
    } catch {
      // A malformed or unrelated drag payload (e.g. a section drag): ignore.
    }
  }

  function handleDragEnd() {
    setIsDragging(false);
    setDragArmed(false);
  }

  const links = task.links ?? [];

  return (
    <article
      className={`group/task px-4 py-3 transition ${isDragging ? 'opacity-50' : ''}`}
      // Only the handle arms dragging, so selecting text inside inputs never starts a drag.
      draggable={dragArmed}
      onPointerUp={() => setDragArmed(false)}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-2 shrink-0 cursor-grab select-none text-fg-muted"
          aria-hidden="true"
          title="Drag to reorder"
          onPointerDown={() => setDragArmed(true)}
        >
          ⋮⋮
        </span>
        <div className="min-w-0 flex-1">
          <label className="block text-xs font-semibold uppercase tracking-wide text-fg">
            Task
            <span className="mt-2 flex items-start gap-2">
            <span className="w-6 shrink-0 pt-1.5 text-sm font-semibold leading-5 normal-case tracking-normal text-fg-muted tabular-nums">
              {letter}.
            </span>
            <TaskTextarea
              className="w-full rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm normal-case leading-5 tracking-normal text-fg outline-none transition focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
              value={description}
              onValueChange={setDescription}
              onBlur={persistDescription}
              onEnter={(field) => field.blur()}
              maxLength={TASK_DESCRIPTION_LIMIT}
            />
            </span>
          </label>
          <p className={`mt-1 text-right text-xs font-medium ${counterColor}`}>
            {description.length}/{TASK_DESCRIPTION_LIMIT}
          </p>
          {/* ml-8 matches the letter column (w-6 + gap-2) so attachments line up with the task field. */}
          <div className="ml-8">
            <TaskAttachments
              images={task.images}
              onRemoveImage={handleRemoveImage}
              imageAlt="Task attachment preview"
              links={links}
              onRemoveLink={(index) => updateLinks(links.filter((_, linkIndex) => linkIndex !== index))}
              error={uploadError}
            />
          </div>
        </div>
        <CardToolbar>
          <IconButton
            icon={<span aria-hidden="true">↑</span>}
            label="Move task up"
            onClick={onMoveUp}
            disabled={isFirst}
          />
          <IconButton
            icon={<span aria-hidden="true">↓</span>}
            label="Move task down"
            onClick={onMoveDown}
            disabled={isLast}
          />
          <IconButton icon={<LinkIcon />} label="Add link" onClick={() => setShowLinkForm(true)} />
          <IconButton
            icon={<ImageIcon />}
            label={uploading ? 'Processing image' : 'Add image'}
            onClick={() => fileInputRef.current?.click()}
          />
          <PolishButton
            disabled={!description.trim()}
            loading={descriptionPolish.loading}
            onClick={() => void descriptionPolish.trigger(description)}
          />
          <IconButton
            icon={<TrashIcon />}
            label="Remove task"
            danger
            onClick={() => runSafely(removeTask(reportId, sectionId, task.id), 'Task remove failed')}
          />
        </CardToolbar>
      </div>

      <PolishSuggestionPanel
        loading={descriptionPolish.loading}
        suggestion={descriptionPolish.suggestion}
        error={descriptionPolish.error}
        onUse={descriptionPolish.useSuggestion}
        onDismiss={descriptionPolish.dismiss}
      />

      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept="image/*"
        onChange={(event) => runSafely(handleImageSelected(event.target.files?.[0]), 'Image selection failed')}
      />

      {showLinkForm ? (
        <div className="mt-3">
          <LinkForm onAdd={(link) => updateLinks([...links, link])} onClose={() => setShowLinkForm(false)} />
        </div>
      ) : null}

      <LeadNotesReadOnly notes={leadNotes} />
      {leadQuestions.length > 0 ? (
        <div className="mt-2 space-y-2">
          {leadQuestions.map((question) => (
            <LeadQuestionCard key={question.id} reportId={reportId} question={question} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

// A section question interleaved with tasks: same move-up/down + drag chrome
// as TaskCard, but reuses QuestionCard (defined below) for the question's own
// rendering/removal instead of forking it. Questions take no letter, so a
// small "Question" badge stands in for TaskCard's letter column.
function SectionQuestionCard({
  reportId,
  sectionId,
  question,
  leadNotes,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onReorderDrop,
}: {
  reportId: string;
  sectionId: string;
  question: QuestionWithId;
  leadNotes: LeadNoteWithId[];
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onReorderDrop: (draggedKey: string, targetKey: string) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragArmed, setDragArmed] = useState(false);

  function handleDragStart(event: DragEvent<HTMLElement>) {
    const payload: SectionDragPayload = { sectionId, kind: 'question', id: question.id };
    event.dataTransfer.setData(SECTION_ITEM_DRAG_TYPE, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const raw = event.dataTransfer.getData(SECTION_ITEM_DRAG_TYPE);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as SectionDragPayload;
      const targetKey = sectionItemKey({ kind: 'question', id: question.id });
      if (parsed.sectionId === sectionId && sectionItemKey(parsed) !== targetKey) {
        onReorderDrop(sectionItemKey(parsed), targetKey);
      }
    } catch {
      // A malformed or unrelated drag payload (e.g. a section drag): ignore.
    }
  }

  function handleDragEnd() {
    setIsDragging(false);
    setDragArmed(false);
  }

  return (
    <div
      className={`group/task flex items-start gap-3 px-4 py-3 transition ${isDragging ? 'opacity-50' : ''}`}
      draggable={dragArmed}
      onPointerUp={() => setDragArmed(false)}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
    >
      <span
        className="mt-2 shrink-0 cursor-grab select-none text-fg-muted"
        aria-hidden="true"
        title="Drag to reorder"
        onPointerDown={() => setDragArmed(true)}
      >
        ⋮⋮
      </span>
      <div className="min-w-0 flex-1">
        <span className="mb-2 inline-flex items-center rounded-full border border-done-emphasis/60 bg-done-muted px-2 py-0.5 text-xs font-medium text-done-fg">
          Question
        </span>
        <QuestionCard reportId={reportId} question={question} leadNotes={leadNotes} />
      </div>
      <CardToolbar>
        <IconButton
          icon={<span aria-hidden="true">↑</span>}
          label="Move question up"
          onClick={onMoveUp}
          disabled={isFirst}
        />
        <IconButton
          icon={<span aria-hidden="true">↓</span>}
          label="Move question down"
          onClick={onMoveDown}
          disabled={isLast}
        />
      </CardToolbar>
    </div>
  );
}

function SectionCard({
  reportId,
  section,
  number,
  leadNotesByTask,
  leadQuestionsByTask,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onReorderDrop,
  onAddQuestion,
}: {
  reportId: string;
  section: SectionWithTasks;
  number: number;
  leadNotesByTask: Map<string, LeadNoteWithId[]>;
  leadQuestionsByTask: Map<string, LeadQuestionWithId[]>;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onReorderDrop: (draggedSectionId: string, targetSectionId: string) => void;
  onAddQuestion: (question: CreateQuestionInput) => Promise<string>;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragArmed, setDragArmed] = useState(false);
  const [itemOrderOverride, setItemOrderOverride] = useState<string[] | null>(null);
  const [itemOrderError, setItemOrderError] = useState<string | null>(null);
  // Only one composer is open at a time; the section footer shows just the
  // two entry buttons until one of them is clicked.
  const [openComposer, setOpenComposer] = useState<'task' | 'question' | null>(null);

  const mergedItems = useMemo(
    () => mergeSectionItems(section.tasks, section.questions),
    [section.tasks, section.questions],
  );

  // Reset the optimistic override once the source data it was derived from
  // (the task/question ids under this section) changes underneath it.
  const itemIdsKey = mergedItems.map(sectionItemKey).join(',');
  useEffect(() => {
    setItemOrderOverride(null);
  }, [itemIdsKey]);

  const displayedItems = useMemo(() => {
    if (!itemOrderOverride) {
      return mergedItems;
    }

    const itemByKey = new Map(mergedItems.map((item) => [sectionItemKey(item), item]));
    const overridden = itemOrderOverride
      .map((key) => itemByKey.get(key))
      .filter((item): item is SectionItem => Boolean(item));
    const overriddenKeys = new Set(overridden.map(sectionItemKey));
    const missing = mergedItems.filter((item) => !overriddenKeys.has(sectionItemKey(item)));

    return [...overridden, ...missing];
  }, [itemOrderOverride, mergedItems]);

  const taskLetters = useMemo(() => taskLettersById(displayedItems, taskLetter), [displayedItems]);

  async function handleAddSectionQuestion(question: CreateQuestionInput) {
    const nextOrder = getNextOrder([...section.tasks, ...section.questions]);
    return onAddQuestion({ ...question, sectionId: section.id, order: nextOrder });
  }

  async function persistItemOrder(nextKeys: string[]) {
    const previousKeys = displayedItems.map(sectionItemKey);
    setItemOrderOverride(nextKeys);
    setItemOrderError(null);
    try {
      const orderedItems: SectionOrderItem[] = nextKeys.map((key) => {
        const [kind, id] = key.split(':') as ['task' | 'question', string];
        return { kind, id };
      });
      await reorderSectionItems(reportId, section.id, orderedItems);
    } catch (error) {
      console.error('Section item reorder failed', error);
      setItemOrderOverride(previousKeys);
      setItemOrderError('Order could not be saved. Please try again.');
    }
  }

  function handleMoveItem(key: string, direction: 'up' | 'down') {
    const keys = displayedItems.map(sectionItemKey);
    const next = reorderedIdsForMove(keys, key, direction);
    if (next) {
      void persistItemOrder(next);
    }
  }

  function handleItemReorderDrop(draggedKey: string, targetKey: string) {
    const keys = displayedItems.map(sectionItemKey);
    const next = reorderedIdsForDrag(keys, draggedKey, targetKey);
    if (next) {
      void persistItemOrder(next);
    }
  }

  function handleDragStart(event: DragEvent<HTMLElement>) {
    event.dataTransfer.setData(SECTION_DRAG_TYPE, section.id);
    event.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData(SECTION_DRAG_TYPE);
    if (draggedId && draggedId !== section.id) {
      onReorderDrop(draggedId, section.id);
    }
  }

  function handleDragEnd() {
    setIsDragging(false);
    setDragArmed(false);
  }

  return (
    <section
      className={`rounded-md border border-line bg-canvas shadow-sm transition ${isDragging ? 'opacity-50' : ''}`}
      // Only the handle arms dragging, so editing the title or tasks never starts a drag.
      draggable={dragArmed}
      onPointerUp={() => setDragArmed(false)}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
    >
      <div className="group/section flex items-center gap-3 rounded-t-md border-b border-line bg-canvas-subtle px-4 py-3">
        <span
          className="shrink-0 cursor-grab select-none text-fg-muted"
          aria-hidden="true"
          title="Drag to reorder"
          onPointerDown={() => setDragArmed(true)}
        >
          ⋮⋮
        </span>
        <span className="shrink-0 text-lg font-semibold text-fg-muted tabular-nums">{number}.</span>
        <SectionTitle reportId={reportId} section={section} />
        <div className="flex shrink-0 items-center gap-1 md:opacity-0 md:group-hover/section:opacity-100 md:group-focus-within/section:opacity-100">
          <button
            className="rounded-md border border-line bg-control px-1.5 py-0.5 text-xs text-fg transition hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            disabled={isFirst}
            aria-label="Move section up"
            onClick={onMoveUp}
          >
            ↑
          </button>
          <button
            className="rounded-md border border-line bg-control px-1.5 py-0.5 text-xs text-fg transition hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            disabled={isLast}
            aria-label="Move section down"
            onClick={onMoveDown}
          >
            ↓
          </button>
        </div>
        <div className="shrink-0 md:opacity-0 md:group-hover/section:opacity-100 md:group-focus-within/section:opacity-100">
          <IconButton
            icon={<TrashIcon />}
            label="Remove section"
            danger
            onClick={() => runSafely(removeSection(reportId, section.id), 'Section remove failed')}
          />
        </div>
      </div>

      {itemOrderError ? (
        <p className="px-4 py-2 text-xs font-medium text-danger-fg" role="alert">
          {itemOrderError}
        </p>
      ) : null}

      <div className="divide-y divide-line">
        {displayedItems.length > 0 ? (
          displayedItems.map((item, itemIndex) =>
            item.kind === 'task' ? (
              <TaskCard
                key={`task-${item.id}`}
                reportId={reportId}
                sectionId={section.id}
                task={item.task}
                letter={taskLetters.get(item.id) ?? ''}
                leadNotes={leadNotesByTask.get(item.id) ?? []}
                leadQuestions={leadQuestionsByTask.get(item.id) ?? []}
                isFirst={itemIndex === 0}
                isLast={itemIndex === displayedItems.length - 1}
                onMoveUp={() => handleMoveItem(sectionItemKey(item), 'up')}
                onMoveDown={() => handleMoveItem(sectionItemKey(item), 'down')}
                onReorderDrop={handleItemReorderDrop}
              />
            ) : (
              <SectionQuestionCard
                key={`question-${item.id}`}
                reportId={reportId}
                sectionId={section.id}
                question={item.question}
                leadNotes={leadNotesByTask.get(item.id) ?? []}
                isFirst={itemIndex === 0}
                isLast={itemIndex === displayedItems.length - 1}
                onMoveUp={() => handleMoveItem(sectionItemKey(item), 'up')}
                onMoveDown={() => handleMoveItem(sectionItemKey(item), 'down')}
                onReorderDrop={handleItemReorderDrop}
              />
            ),
          )
        ) : (
          <EmptyState
            title="Nothing here yet"
            description="Add a task, or ask the lead a question. Keep it short so it's easy to scan."
          />
        )}
      </div>

      <div className="border-t border-line px-4 py-3">
        {openComposer === 'task' ? (
          <AddTaskForm reportId={reportId} section={section} onClose={() => setOpenComposer(null)} />
        ) : openComposer === 'question' ? (
          <QuestionComposer
            reportId={reportId}
            onAddQuestion={handleAddSectionQuestion}
            onCancel={() => setOpenComposer(null)}
            onAdded={() => setOpenComposer(null)}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-accent-emphasis/60 bg-accent-muted px-3 py-1.5 text-sm font-medium text-accent-fg transition hover:border-accent-emphasis hover:bg-accent-emphasis/25"
              type="button"
              onClick={() => setOpenComposer('task')}
            >
              <span aria-hidden="true">+</span>
              Add task
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-done-emphasis/60 bg-done-muted px-3 py-1.5 text-sm font-medium text-done-fg transition hover:border-done-emphasis hover:bg-done-emphasis/25"
              type="button"
              onClick={() => setOpenComposer('question')}
            >
              <span aria-hidden="true">?</span>
              Ask the lead
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function SectionsList({
  reportId,
  sections,
  leadNotesByTask,
  leadQuestionsByTask,
  onAddSection,
  onAddQuestion,
  showHeading = true,
}: {
  reportId: string;
  sections: SectionWithTasks[];
  leadNotesByTask: Map<string, LeadNoteWithId[]>;
  leadQuestionsByTask: Map<string, LeadQuestionWithId[]>;
  onAddSection: (section: Section) => Promise<unknown>;
  onAddQuestion: (question: CreateQuestionInput) => Promise<string>;
  showHeading?: boolean;
}) {
  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.order - b.order),
    [sections],
  );

  const [sectionOrderOverride, setSectionOrderOverride] = useState<string[] | null>(null);
  const [sectionOrderError, setSectionOrderError] = useState<string | null>(null);

  // Reset the optimistic override once the source data it was derived from
  // (the section ids on this report) changes underneath it.
  const sectionIdsKey = sortedSections.map((section) => section.id).join(',');
  useEffect(() => {
    setSectionOrderOverride(null);
  }, [sectionIdsKey]);

  const displayedSections = useMemo(() => {
    if (!sectionOrderOverride) {
      return sortedSections;
    }

    const sectionById = new Map(sortedSections.map((section) => [section.id, section]));
    const overridden = sectionOrderOverride
      .map((id) => sectionById.get(id))
      .filter((section): section is SectionWithTasks => Boolean(section));
    const overriddenIds = new Set(overridden.map((section) => section.id));
    const missing = sortedSections.filter((section) => !overriddenIds.has(section.id));

    return [...overridden, ...missing];
  }, [sectionOrderOverride, sortedSections]);

  async function persistSectionOrder(nextIds: string[]) {
    const previousIds = displayedSections.map((section) => section.id);
    setSectionOrderOverride(nextIds);
    setSectionOrderError(null);
    try {
      await reorderSections(reportId, nextIds);
    } catch (error) {
      console.error('Section reorder failed', error);
      setSectionOrderOverride(previousIds);
      setSectionOrderError('Order could not be saved. Please try again.');
    }
  }

  function handleMoveSection(sectionId: string, direction: 'up' | 'down') {
    const ids = displayedSections.map((section) => section.id);
    const next = reorderedIdsForMove(ids, sectionId, direction);
    if (next) {
      void persistSectionOrder(next);
    }
  }

  function handleSectionReorderDrop(draggedSectionId: string, targetSectionId: string) {
    const ids = displayedSections.map((section) => section.id);
    const next = reorderedIdsForDrag(ids, draggedSectionId, targetSectionId);
    if (next) {
      void persistSectionOrder(next);
    }
  }

  return (
    <section>
      {showHeading ? (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-fg">Today’s work</h2>
            <p className="text-sm text-fg-muted">Group related work under clear main titles.</p>
          </div>
        </div>
      ) : null}

      {sectionOrderError ? (
        <p className="mt-2 text-xs font-medium text-danger-fg" role="alert">
          {sectionOrderError}
        </p>
      ) : null}

      <div className={showHeading ? 'mt-3' : undefined}>
        <AddSectionForm sections={sortedSections} onAddSection={onAddSection} />
      </div>

      <div className="mt-4 space-y-6">
        {displayedSections.length > 0 ? (
          displayedSections.map((section, sectionIndex) => (
            <SectionCard
              key={section.id}
              reportId={reportId}
              section={section}
              number={sectionIndex + 1}
              leadNotesByTask={leadNotesByTask}
              leadQuestionsByTask={leadQuestionsByTask}
              isFirst={sectionIndex === 0}
              isLast={sectionIndex === displayedSections.length - 1}
              onMoveUp={() => handleMoveSection(section.id, 'up')}
              onMoveDown={() => handleMoveSection(section.id, 'down')}
              onReorderDrop={handleSectionReorderDrop}
              onAddQuestion={onAddQuestion}
            />
          ))
        ) : (
          <EmptyState
            title="Start with a main title"
            description="Create a section such as Focus, Blockers, or Shipped. Then add short tasks underneath."
          />
        )}
      </div>
    </section>
  );
}

function QuestionOptionRow({
  label,
  value,
  questionText,
  links,
  images,
  canRemove,
  blockedMessage,
  onChange,
  onLinksChange,
  onImagesChange,
  onRemove,
}: {
  label: string;
  value: string;
  questionText: string;
  links: TaskLink[];
  images: Array<{ id: string; imageBase64: string }>;
  canRemove: boolean;
  blockedMessage: string | null;
  onChange: (value: string) => void;
  onLinksChange: (links: TaskLink[]) => void;
  onImagesChange: (images: Array<{ id: string; imageBase64: string }>) => void;
  onRemove: () => void;
}) {
  // The question is sent as context so the option is polished as an answer to it.
  const optionPolish = usePolishAction({
    kind: 'option',
    questionContext: questionText.trim() || undefined,
    onUse: onChange,
  });
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nextImageId = useRef(0);

  async function handleImageSelected(file: File | undefined) {
    if (!file) {
      return;
    }
    setImageError(null);
    try {
      const imageBase64 = await compressTaskImage(file);
      onImagesChange([...images, { id: `${LOCAL_IMAGE_PREFIX}${nextImageId.current++}`, imageBase64 }]);
    } catch (caughtError) {
      console.error('Option image add failed', caughtError);
      setImageError(caughtError instanceof Error ? caughtError.message : 'Image could not be added.');
    }
  }

  function handleRemoveImage(imageId: string) {
    onImagesChange(images.filter((image) => image.id !== imageId));
  }

  function handleRemoveLink(index: number) {
    onLinksChange(links.filter((_, linkIndex) => linkIndex !== index));
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-muted text-xs font-semibold text-fg">
          {label}
        </span>
        <input
          className="min-w-0 flex-1 rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={`Option ${label}`}
        />
        <IconButton icon={<LinkIcon />} label="Add link" onClick={() => setShowLinkForm(true)} />
        <IconButton icon={<ImageIcon />} label="Add image" onClick={() => fileInputRef.current?.click()} />
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          onChange={(event) => {
            void handleImageSelected(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <PolishButton
          disabled={!value.trim()}
          loading={optionPolish.loading}
          onClick={() => void optionPolish.trigger(value)}
        />
        <IconButton icon={<TrashIcon />} label="Remove option" danger disabled={!canRemove} onClick={onRemove} />
      </div>
      <PolishSuggestionPanel
        loading={optionPolish.loading}
        suggestion={optionPolish.suggestion}
        error={optionPolish.error}
        exampleAnswer={optionPolish.exampleAnswer}
        exampleLabel="Example option"
        onUse={optionPolish.useSuggestion}
        onUseExample={optionPolish.useExample}
        onDismiss={optionPolish.dismiss}
      />
      {showLinkForm ? (
        <div className="ml-10 mt-2">
          <LinkForm onAdd={(link) => onLinksChange([...links, link])} onClose={() => setShowLinkForm(false)} />
        </div>
      ) : null}
      {images.length > 0 || links.length > 0 || imageError ? (
        <div className="ml-10 mt-2 space-y-2">
          <AttachmentImages images={images} onRemove={handleRemoveImage} altText={`Option ${label} attachment`} />
          <LinkChips links={links} onRemove={handleRemoveLink} />
          {imageError ? (
            <p className="text-xs font-medium text-danger-fg" role="alert">
              {imageError}
            </p>
          ) : null}
        </div>
      ) : null}
      {blockedMessage ? (
        <p className="ml-10 mt-2 text-xs font-medium text-danger-fg" role="alert">
          {blockedMessage}
        </p>
      ) : null}
    </div>
  );
}

interface ComposerOption {
  text: string;
  links: TaskLink[];
  images: Array<{ id: string; imageBase64: string }>;
}

function emptyComposerOption(): ComposerOption {
  return { text: '', links: [], images: [] };
}

// An option with no text is dropped from the submitted question — silently
// taking its links/images with it unless submit is blocked first.
function optionDropsContentOnSubmit(option: ComposerOption): boolean {
  return !option.text.trim() && (option.images.length > 0 || option.links.length > 0);
}

// Message shown on an option that would otherwise be silently dropped along
// with its links/images (see `optionDropsContentOnSubmit`), or null once it's
// no longer blocked.
function optionBlockMessage(option: ComposerOption): string | null {
  if (!optionDropsContentOnSubmit(option)) {
    return null;
  }
  const hasImages = option.images.length > 0;
  const hasLinks = option.links.length > 0;
  if (hasImages && hasLinks) {
    return 'Add text to this option, or remove its links and images.';
  }
  if (hasImages) {
    return 'Add text to this option, or remove its images.';
  }
  return 'Add text to this option, or remove its links.';
}

// Seeds the composer from an existing question for edit mode: each option's
// images carry their real Firestore doc id, so submit can tell a kept image
// apart from a newly-added one (see `LOCAL_IMAGE_PREFIX`).
function composerOptionsFromQuestion(question: QuestionWithId): ComposerOption[] {
  return question.options.map((text, index) => ({
    text,
    links: question.optionDetails?.[index]?.links ?? [],
    images: question.optionImages
      .filter((image) => image.optionIndex === index)
      .map((image) => ({ id: image.id, imageBase64: image.imageBase64 })),
  }));
}

// Reused for both creating a question (`onAddQuestion`) and, when `question`
// is passed, editing one in place (`onSaved`) — same fields, options and
// per-option links/images, just a different submit target. `onCancel` is
// passed whenever the composer can be dismissed without saving (creating a
// section question on demand, or editing any question): it adds a Cancel
// button, Escape-to-close and autofocus. `onAdded` runs once a newly created
// question and all its option images are saved, so a failed image upload
// keeps the composer (and its error message) on screen. `onSaved` runs once
// an edit's question batch has committed — the edit is saved at that point
// even if `failedImageCount` is nonzero, so the caller closes the composer
// either way and surfaces any partial image failure elsewhere (on the
// question card itself), rather than keeping stale local image state around
// for a retry to trip over.
function QuestionComposer({
  reportId,
  question,
  onAddQuestion,
  onCancel,
  onAdded,
  onSaved,
}: {
  reportId: string;
  question?: QuestionWithId;
  onAddQuestion?: (question: CreateQuestionInput) => Promise<string>;
  onCancel?: () => void;
  onAdded?: () => void;
  onSaved?: (result: { failedImageCount: number }) => void;
}) {
  const isEditing = Boolean(question);
  const [questionText, setQuestionText] = useState(question?.questionText ?? '');
  const [options, setOptions] = useState<ComposerOption[]>(() =>
    question ? composerOptionsFromQuestion(question) : [emptyComposerOption(), emptyComposerOption()],
  );
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const questionPolish = usePolishAction({
    kind: 'question',
    onUse: (suggestion) => setQuestionText(suggestion),
  });

  function updateOption(index: number, value: string) {
    setOptions((currentOptions) =>
      currentOptions.map((option, optionIndex) => (optionIndex === index ? { ...option, text: value } : option)),
    );
  }

  function updateOptionLinks(index: number, links: TaskLink[]) {
    setOptions((currentOptions) =>
      currentOptions.map((option, optionIndex) => (optionIndex === index ? { ...option, links } : option)),
    );
  }

  function updateOptionImages(index: number, images: ComposerOption['images']) {
    setOptions((currentOptions) =>
      currentOptions.map((option, optionIndex) => (optionIndex === index ? { ...option, images } : option)),
    );
  }

  function removeOption(index: number) {
    if (options.length <= QUESTION_OPTION_MINIMUM) {
      return;
    }
    setOptions((currentOptions) => currentOptions.filter((_, optionIndex) => optionIndex !== index));
  }

  const hasBlockedOption = options.some(optionDropsContentOnSubmit);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = questionText.trim();
    const nonEmptyOptions = options.filter((option) => option.text.trim());

    if (!trimmedQuestion || nonEmptyOptions.length < QUESTION_OPTION_MINIMUM || hasBlockedOption) {
      return;
    }

    setImageUploadError(null);

    if (question) {
      // Edit mode: the question fields, option-image remap/delete and the
      // stale-answer clear commit in one small batch; new option images
      // upload separately afterwards (see `updateQuestion`). Once that batch
      // has committed the edit is saved regardless of `failedImageCount`, so
      // the composer always closes here — retrying a partial image failure
      // must start from a fresh edit of what's actually saved, not reuse
      // this composer's local (now stale) image ids. Only a rejection (the
      // batch itself failing) keeps the composer open with an inline error.
      setSaving(true);
      updateQuestion(reportId, question.id, {
        questionText: trimmedQuestion,
        options: nonEmptyOptions.map((option) => ({
          text: option.text.trim(),
          links: option.links,
          keepImageIds: option.images
            .filter((image) => !image.id.startsWith(LOCAL_IMAGE_PREFIX))
            .map((image) => image.id),
          newImages: option.images
            .filter((image) => image.id.startsWith(LOCAL_IMAGE_PREFIX))
            .map((image) => image.imageBase64),
        })),
      })
        .then((result) => onSaved?.(result))
        .catch((caughtError) => {
          console.error('Question update failed', caughtError);
          setImageUploadError(
            caughtError instanceof Error ? caughtError.message : 'Question could not be saved. Please try again.',
          );
        })
        .finally(() => setSaving(false));
      return;
    }

    if (!onAddQuestion) {
      return;
    }

    runSafely(
      (async () => {
        const questionId = await onAddQuestion({
          questionText: trimmedQuestion,
          options: nonEmptyOptions.map((option) => option.text.trim()),
          optionLinks: nonEmptyOptions.map((option) => option.links),
        });

        // The question is created first so it stays created even if an
        // option image upload below fails.
        const uploads = nonEmptyOptions.flatMap((option, optionIndex) =>
          option.images.map((image) =>
            addQuestionOptionImage(reportId, questionId, optionIndex, image.imageBase64),
          ),
        );

        if (uploads.length > 0) {
          try {
            await Promise.all(uploads);
          } catch (caughtError) {
            console.error('Question option image upload failed', caughtError);
            setImageUploadError('Question added, but one or more images failed to upload.');
            return;
          }
        }
        onAdded?.();
      })(),
      'Question add failed',
    );
    setQuestionText('');
    setOptions([emptyComposerOption(), emptyComposerOption()]);
    questionPolish.dismiss();
  }

  return (
    <form
      className="rounded-md border-l-2 border-done-emphasis bg-done-muted p-4"
      onSubmit={handleSubmit}
      onKeyDown={(event) => {
        if (onCancel && event.key === 'Escape') {
          onCancel();
        }
      }}
    >
      <div className="flex items-start gap-2">
        <label className="block min-w-0 flex-1 text-sm font-medium text-done-fg">
          {isEditing ? 'Edit question for the lead' : 'Question for the lead'}
          <input
            className="mt-2 w-full rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
            value={questionText}
            onChange={(event) => setQuestionText(event.target.value)}
            placeholder="What should the lead decide?"
            autoFocus={Boolean(onCancel)}
          />
        </label>
        <PolishButton
          disabled={!questionText.trim()}
          loading={questionPolish.loading}
          onClick={() => void questionPolish.trigger(questionText)}
        />
      </div>

      <PolishSuggestionPanel
        loading={questionPolish.loading}
        suggestion={questionPolish.suggestion}
        error={questionPolish.error}
        onUse={questionPolish.useSuggestion}
        onDismiss={questionPolish.dismiss}
      />

      <div className="mt-3 space-y-2">
        {options.map((option, index) => (
          <QuestionOptionRow
            key={index}
            label={optionLabels[index]}
            value={option.text}
            questionText={questionText}
            links={option.links}
            images={option.images}
            canRemove={options.length > QUESTION_OPTION_MINIMUM}
            blockedMessage={optionBlockMessage(option)}
            onChange={(value) => updateOption(index, value)}
            onLinksChange={(links) => updateOptionLinks(index, links)}
            onImagesChange={(images) => updateOptionImages(index, images)}
            onRemove={() => removeOption(index)}
          />
        ))}
      </div>

      {imageUploadError ? (
        <p className="mt-2 text-xs font-medium text-danger-fg" role="alert">
          {imageUploadError}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-between">
        <button
          className="rounded-md border border-line bg-control px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={options.length >= QUESTION_OPTION_LIMIT}
          onClick={() => setOptions((currentOptions) => [...currentOptions, emptyComposerOption()])}
        >
          Add option
        </button>
        <div className="flex justify-end gap-2">
          {onCancel ? (
            <button
              className="rounded-md border border-line bg-control px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-control-hover"
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
          ) : null}
          <button
            className="rounded-md border border-white/15 bg-success-emphasis px-3 py-1.5 text-sm font-medium text-white transition hover:bg-success-hover disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={
              saving ||
              !questionText.trim() ||
              options.filter((option) => option.text.trim()).length < QUESTION_OPTION_MINIMUM ||
              hasBlockedOption
            }
          >
            {isEditing ? (saving ? 'Saving...' : 'Save changes') : 'Add question'}
          </button>
        </div>
      </div>
    </form>
  );
}

function QuestionCard({
  reportId,
  question,
  leadNotes,
}: {
  reportId: string;
  question: QuestionWithId;
  leadNotes: LeadNoteWithId[];
}) {
  const [editing, setEditing] = useState(false);
  // Set once an edit's question batch commits with one or more new option
  // images that failed to upload. The edit is already saved at that point
  // (see `QuestionComposer`'s `onSaved`), so this is a standalone notice on
  // the card rather than something the composer keeps open for.
  const [imageUploadFailureNotice, setImageUploadFailureNotice] = useState(false);
  const isAnswered = question.selectedAnswer !== undefined;

  if (editing) {
    return (
      <QuestionComposer
        reportId={reportId}
        question={question}
        onCancel={() => setEditing(false)}
        onSaved={(result) => {
          setEditing(false);
          setImageUploadFailureNotice(result.failedImageCount > 0);
        }}
      />
    );
  }

  return (
    <article className="group/question rounded-md border border-line bg-canvas p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-sm font-semibold leading-6 text-fg">{question.questionText}</p>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${
              isAnswered
                ? 'border-success-emphasis/40 bg-success-muted text-success-fg'
                : 'border-attention-emphasis/40 bg-attention-muted text-attention-fg'
            }`}
          >
            {isAnswered ? 'Answered by the lead' : 'Waiting for the lead'}
          </span>
          <div className="flex shrink-0 items-center gap-0.5 md:opacity-0 md:group-hover/question:opacity-100 md:group-focus-within/question:opacity-100">
            <IconButton icon={<EditIcon />} label="Edit question" onClick={() => setEditing(true)} />
            <IconButton
              icon={<TrashIcon />}
              label="Remove question"
              danger
              onClick={() => runSafely(removeQuestion(reportId, question.id), 'Question remove failed')}
            />
          </div>
        </div>
      </div>
      {imageUploadFailureNotice ? (
        <div
          className="mt-2 flex items-start justify-between gap-2 rounded-md border border-attention-emphasis/40 bg-attention-muted px-3 py-2 text-xs font-medium text-attention-fg"
          role="alert"
        >
          <p>Question saved, but some images could not be saved. Edit the question to add them again.</p>
          <button
            type="button"
            className="shrink-0 leading-none text-attention-fg/70 transition hover:text-attention-fg"
            aria-label="Dismiss"
            onClick={() => setImageUploadFailureNotice(false)}
          >
            &times;
          </button>
        </div>
      ) : null}
      <QuestionOptionList
        question={question}
        renderAction={(_, selected) =>
          selected ? (
            <span className="shrink-0 rounded-full border border-success-emphasis/40 px-2 py-0.5 text-xs font-medium text-success-fg">
              Lead's choice
            </span>
          ) : null
        }
      />
      <LeadNotesReadOnly notes={leadNotes} />
    </article>
  );
}

// New dev questions are asked from a section ("Ask the lead"), so there is
// no report-level composer anymore. Older report-level questions (no
// `sectionId`) are still listed here so they stay visible and answerable;
// the panel disappears entirely when there are none.
function QuestionsPanel({
  reportId,
  questions = [],
  leadNotesByTask,
}: {
  reportId: string;
  questions?: QuestionWithId[];
  leadNotesByTask: Map<string, LeadNoteWithId[]>;
}) {
  if (questions.length === 0) {
    return null;
  }

  return (
    <section className="rounded-md border border-line bg-canvas shadow-sm">
      <div className="flex items-center gap-2 rounded-t-md border-b border-line bg-canvas-subtle px-4 py-3">
        <h2 className="text-lg font-semibold text-fg">General questions to the lead</h2>
        <span className="ml-auto rounded-full border border-line bg-canvas px-2 py-0.5 text-xs font-medium text-fg-muted tabular-nums">
          {questions.length}
        </span>
      </div>
      <div className="space-y-3 p-4">
        {questions.map((question) => (
          <QuestionCard
            key={question.id}
            reportId={reportId}
            question={question}
            leadNotes={leadNotesByTask.get(question.id) ?? []}
          />
        ))}
      </div>
    </section>
  );
}

interface EditableReportProps {
  reportId: string;
  reportTree: ReportTree;
  date: string;
  ownerUserId: string;
  assignments: AssignmentWithId[];
  ensureReportExists: () => Promise<string>;
  // The "Today's work" heading and hint only make sense in the developer's
  // own view; Lead View's edit mode repeats this body once per developer.
  showWorkHeading?: boolean;
  // "Assigned by lead" sits at the top for the developer's own view, but
  // Lead View's edit mode keeps it at the bottom to match the normal
  // (non-edit) report layout, where it always renders last.
  assignmentsPosition?: 'top' | 'bottom';
  // Report-level lead questions still unanswered (or answered on this date)
  // from an earlier day, shown alongside today's own "From the lead" panel
  // with their origin date; every action still targets their origin report.
  carriedQuestions?: CarriedLeadQuestion[];
}

// The editable body of a report: assignments, lead notes/questions, sections
// with tasks, and the report-level questions panel. Shared by `DeveloperView`
// (a developer editing their own report) and `LeadView`'s edit mode (a lead
// editing a developer's report in place).
export function EditableReport({
  reportId,
  reportTree,
  date,
  ownerUserId,
  assignments,
  ensureReportExists,
  showWorkHeading = true,
  assignmentsPosition = 'top',
  carriedQuestions = [],
}: EditableReportProps) {
  // The report document only exists once the developer actually adds
  // content, so every write that could be the first one on an empty report
  // (adding a section, or a dev question when there are none yet) creates it
  // first. Adding a task/image/link/answer already requires an existing
  // section or question, so the report is guaranteed to exist by then.
  const handleAddSection = useCallback(
    async (section: Section) => {
      const id = await ensureReportExists();
      return addSection(id, section);
    },
    [ensureReportExists],
  );

  const handleAddQuestion = useCallback(
    async (question: CreateQuestionInput) => {
      const id = await ensureReportExists();
      return addQuestion(id, question);
    },
    [ensureReportExists],
  );

  const leadNotesByTask = useMemo(() => {
    const grouped = new Map<string, LeadNoteWithId[]>();
    (reportTree.notes ?? []).forEach((note) => {
      if (!note.targetTaskId) {
        return;
      }
      grouped.set(note.targetTaskId, [...(grouped.get(note.targetTaskId) ?? []), note]);
    });
    return grouped;
  }, [reportTree.notes]);

  const leadQuestionsByTask = useMemo(() => {
    const grouped = new Map<string, LeadQuestionWithId[]>();
    (reportTree.leadQuestions ?? []).forEach((question) => {
      grouped.set(question.taskId, [...(grouped.get(question.taskId) ?? []), question]);
    });
    return grouped;
  }, [reportTree.leadQuestions]);

  const reportLevelLeadNotes = useMemo(
    () => (reportTree.notes ?? []).filter((note) => !note.targetTaskId),
    [reportTree.notes],
  );
  const reportLevelLeadQuestions = leadQuestionsByTask.get('') ?? [];

  const assignmentsBox = (
    <AssignmentsBox assignments={assignments} userId={ownerUserId} date={date} />
  );

  return (
    <>
      {assignmentsPosition === 'top' ? assignmentsBox : null}
      {reportLevelLeadNotes.length > 0 || reportLevelLeadQuestions.length > 0 || carriedQuestions.length > 0 ? (
        <section className="rounded-md border border-line bg-canvas shadow-sm">
          <div className="rounded-t-md border-b border-line bg-canvas-subtle px-4 py-3">
            <h2 className="text-lg font-semibold text-fg">From the lead</h2>
          </div>
          <div className="p-4">
            <LeadNotesReadOnly notes={reportLevelLeadNotes} />
            {carriedQuestions.length > 0 || reportLevelLeadQuestions.length > 0 ? (
              <div className="mt-3 space-y-3">
                {carriedQuestions.map((question) => (
                  <LeadQuestionCard
                    key={question.id}
                    reportId={question.originReportId}
                    question={question}
                    originLabel={carriedLeadQuestionLabel(question)}
                  />
                ))}
                {reportLevelLeadQuestions.map((question) => (
                  <LeadQuestionCard key={question.id} reportId={reportId} question={question} />
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
      <SectionsList
        reportId={reportId}
        sections={reportTree.sections}
        leadNotesByTask={leadNotesByTask}
        leadQuestionsByTask={leadQuestionsByTask}
        onAddSection={handleAddSection}
        onAddQuestion={handleAddQuestion}
        showHeading={showWorkHeading}
      />
      <QuestionsPanel
        reportId={reportId}
        questions={reportTree.questions}
        leadNotesByTask={leadNotesByTask}
      />
      {assignmentsPosition === 'bottom' ? assignmentsBox : null}
    </>
  );
}

export function DeveloperView({ userId, developerName }: DeveloperViewProps) {
  // null means "follow today"; picking today's date again returns to that mode.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const { reportTree, reportId, loading, date, ensureReportExists } = useMyReport(userId, selectedDate);
  const { assignments } = useMyAssignments(userId, date);
  const { carriedQuestions } = useMyLeadQuestionCarryovers(userId, date);
  const [previewAsLead, setPreviewAsLead] = useState(() => loadPreviewAsLead());
  const handleDateChange = (nextDate: string) =>
    setSelectedDate(nextDate === todayDateString() ? null : nextDate);

  function handlePreviewAsLeadChange(next: boolean) {
    setPreviewAsLead(next);
    persistPreviewAsLead(next);
  }

  if (loading || !reportId) {
    return (
      <div className="space-y-6">
        <Header
          date={date}
          developerName={developerName}
          onDateChange={handleDateChange}
          previewAsLead={previewAsLead}
          onPreviewAsLeadChange={handlePreviewAsLeadChange}
        />
        <div className="rounded-md border border-line bg-canvas p-4 text-sm text-fg-muted shadow-sm">
          Preparing the report...
        </div>
      </div>
    );
  }

  if (!reportTree) {
    return (
      <div className="space-y-6">
        <Header
          date={date}
          developerName={developerName}
          onDateChange={handleDateChange}
          previewAsLead={previewAsLead}
          onPreviewAsLeadChange={handlePreviewAsLeadChange}
        />
        <div className="rounded-md border border-danger-emphasis/40 bg-danger-muted p-4 text-sm text-danger-fg shadow-sm">
          Today’s report could not be loaded. Please refresh and try again.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header
        date={date}
        developerName={developerName}
        onDateChange={handleDateChange}
        previewAsLead={previewAsLead}
        onPreviewAsLeadChange={handlePreviewAsLeadChange}
      />
      {previewAsLead ? (
        <ReportPreview
          reportTree={reportTree}
          developerId={userId}
          date={date}
          assignments={assignments}
          carriedQuestions={carriedQuestions}
        />
      ) : (
        <EditableReport
          reportId={reportId}
          reportTree={reportTree}
          date={date}
          ownerUserId={userId}
          assignments={assignments}
          ensureReportExists={ensureReportExists}
          carriedQuestions={carriedQuestions}
        />
      )}
    </div>
  );
}
