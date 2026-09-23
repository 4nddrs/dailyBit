import {
  DragEvent,
  FormEvent,
  KeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  addAssignmentUpdateImage,
  addLeadQuestionAnswerImage,
  addQuestion,
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
  reorderSections,
  reorderTasks,
  saveAssignmentUpdate,
  subscribeAssignmentUpdate,
  updateTask,
} from '../../services/firestore';
import { ImageLightbox } from '../ImageLightbox';
import { ReportPreview } from '../ReportPreview/ReportPreview';
import { useMyAssignments } from '../../hooks/useMyAssignments';
import { useMyReport } from '../../hooks/useMyReport';
import type { CreateQuestionInput } from '../../services/firestore';
import type {
  AssignmentUpdateWithImages,
  AssignmentWithId,
  LeadNoteWithId,
  LeadQuestionWithId,
  QuestionWithId,
  Section,
  SectionWithTasks,
  TaskLink,
  TaskWithId,
} from '../../types';
import { todayDateString } from '../../types';

import { TASK_DESCRIPTION_LIMIT } from '../../constants';
import { taskLetter } from '../../utils/numbering';
const QUESTION_OPTION_LIMIT = 6;
const QUESTION_OPTION_MINIMUM = 2;
const MAX_IMAGE_SIDE = 1024;
const MAX_IMAGE_DATA_URL_LENGTH = 900_000;
const optionLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
const SECTION_DRAG_TYPE = 'application/x-dailybit-section';
const TASK_DRAG_TYPE = 'application/x-dailybit-task';
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

function getNextOrder(items: Array<{ order: number }>): number {
  return items.length === 0 ? 0 : Math.max(...items.map((item) => item.order)) + 1;
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

async function compressTaskImage(file: File): Promise<string> {
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
        <div>
          <h1 className="text-xl font-semibold text-fg">{formatDisplayDate(date)}</h1>
          <p className="mt-1 text-sm text-fg-muted">{developerName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-medium text-fg">
          Report date
          <input
            className="rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
            type="date"
            value={date}
            max={todayDateString()}
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
}: {
  reportId: string;
  section: SectionWithTasks;
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
        order: getNextOrder(section.tasks),
      }),
      'Task add failed',
    );
    setDescription('');
  }

  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleSubmit}>
      <input
        className="min-w-0 flex-1 rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Add a short task, then press Enter"
        maxLength={TASK_DESCRIPTION_LIMIT}
        aria-label="New task description"
      />
      <button
        className="rounded-md border border-line bg-control px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50"
        type="submit"
        disabled={!description.trim()}
      >
        Add task
      </button>
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

function CardToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 md:opacity-0 md:group-hover/task:opacity-100 md:group-focus-within/task:opacity-100">
      {children}
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
          className="group/link inline-flex items-center gap-2 rounded-full border border-line bg-canvas-subtle px-3 py-1 text-xs font-medium text-fg-muted"
          key={`${link.url}-${index}`}
        >
          <a className="max-w-[12rem] truncate hover:text-accent-fg" href={link.url} target="_blank" rel="noreferrer">
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

  return (
    <form
      className="grid gap-2 md:grid-cols-[1fr_9rem_auto_auto]"
      onSubmit={handleSubmit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
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
        type="submit"
        disabled={!isValidUrl(url.trim())}
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
    </form>
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
          <input
            className="mt-2 w-full rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none transition focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={persistText}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
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
        </CardToolbar>
      </div>
      <p className={`mt-1 text-right text-xs font-medium ${counterColor}`}>
        {text.length}/{TASK_DESCRIPTION_LIMIT}
      </p>

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
        <p className="text-sm font-medium text-fg">{assignment.description}</p>
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
          className="rounded-md border-l-2 border-attention-emphasis bg-attention-muted px-3 py-2 text-sm leading-6 text-attention-fg"
          key={note.id}
        >
          {note.noteText}
        </p>
      ))}
    </div>
  );
}

function LeadQuestionCard({ reportId, question }: { reportId: string; question: LeadQuestionWithId }) {
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
      answerLeadQuestion(reportId, question.id, {
        answerText: question.answerText ?? '',
        answerLinks: nextLinks,
      }),
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
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold leading-6 text-fg">{question.questionText}</p>
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
            <p className="rounded-md border border-success-emphasis/40 bg-success-muted px-3 py-2 text-sm text-success-fg">
              {question.answerText}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(question.options ?? []).map((option, index) => (
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
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
          <textarea
            className="min-h-16 w-full resize-y rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
            value={answerText}
            onChange={(event) => setAnswerText(event.target.value)}
            placeholder="Type your answer"
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
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
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
  onReorderDrop: (draggedTaskId: string, targetTaskId: string) => void;
}) {
  const [description, setDescription] = useState(task.description);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragArmed, setDragArmed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    event.dataTransfer.setData(TASK_DRAG_TYPE, JSON.stringify({ sectionId, taskId: task.id }));
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
    const raw = event.dataTransfer.getData(TASK_DRAG_TYPE);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { sectionId: string; taskId: string };
      if (parsed.sectionId === sectionId && parsed.taskId !== task.id) {
        onReorderDrop(parsed.taskId, task.id);
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
            <span className="mt-2 flex items-center gap-2">
            <span className="w-6 shrink-0 text-sm font-semibold normal-case tracking-normal text-fg-muted tabular-nums">
              {letter}.
            </span>
            <input
              className="w-full rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none transition focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={persistDescription}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
              }}
              maxLength={TASK_DESCRIPTION_LIMIT}
            />
            </span>
          </label>
          <p className={`mt-1 text-right text-xs font-medium ${counterColor}`}>
            {description.length}/{TASK_DESCRIPTION_LIMIT}
          </p>
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
          <IconButton
            icon={<TrashIcon />}
            label="Remove task"
            danger
            onClick={() => runSafely(removeTask(reportId, sectionId, task.id), 'Task remove failed')}
          />
        </CardToolbar>
      </div>

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
        images={task.images}
        onRemoveImage={handleRemoveImage}
        imageAlt="Task attachment preview"
        links={links}
        onRemoveLink={(index) => updateLinks(links.filter((_, linkIndex) => linkIndex !== index))}
        error={uploadError}
      />

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
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragArmed, setDragArmed] = useState(false);
  const [taskOrderOverride, setTaskOrderOverride] = useState<string[] | null>(null);
  const [taskOrderError, setTaskOrderError] = useState<string | null>(null);

  // Reset the optimistic override once the source data it was derived from
  // (the task ids under this section) changes underneath it.
  const taskIdsKey = section.tasks.map((task) => task.id).join(',');
  useEffect(() => {
    setTaskOrderOverride(null);
  }, [taskIdsKey]);

  const displayedTasks = useMemo(() => {
    if (!taskOrderOverride) {
      return section.tasks;
    }

    const taskById = new Map(section.tasks.map((task) => [task.id, task]));
    const overridden = taskOrderOverride
      .map((id) => taskById.get(id))
      .filter((task): task is TaskWithId => Boolean(task));
    const overriddenIds = new Set(overridden.map((task) => task.id));
    const missing = section.tasks.filter((task) => !overriddenIds.has(task.id));

    return [...overridden, ...missing];
  }, [taskOrderOverride, section.tasks]);

  async function persistTaskOrder(nextIds: string[]) {
    const previousIds = displayedTasks.map((task) => task.id);
    setTaskOrderOverride(nextIds);
    setTaskOrderError(null);
    try {
      await reorderTasks(reportId, section.id, nextIds);
    } catch (error) {
      console.error('Task reorder failed', error);
      setTaskOrderOverride(previousIds);
      setTaskOrderError('Order could not be saved. Please try again.');
    }
  }

  function handleMoveTask(taskId: string, direction: 'up' | 'down') {
    const ids = displayedTasks.map((task) => task.id);
    const next = reorderedIdsForMove(ids, taskId, direction);
    if (next) {
      void persistTaskOrder(next);
    }
  }

  function handleTaskReorderDrop(draggedTaskId: string, targetTaskId: string) {
    const ids = displayedTasks.map((task) => task.id);
    const next = reorderedIdsForDrag(ids, draggedTaskId, targetTaskId);
    if (next) {
      void persistTaskOrder(next);
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
        <button
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-danger-fg transition hover:bg-danger-muted hover:text-danger-fg md:opacity-0 md:group-hover/section:opacity-100 md:group-focus-within/section:opacity-100"
          type="button"
          onClick={() => runSafely(removeSection(reportId, section.id), 'Section remove failed')}
        >
          Remove
        </button>
      </div>

      {taskOrderError ? (
        <p className="px-4 py-2 text-xs font-medium text-danger-fg" role="alert">
          {taskOrderError}
        </p>
      ) : null}

      <div className="divide-y divide-line">
        {displayedTasks.length > 0 ? (
          displayedTasks.map((task, taskIndex) => (
            <TaskCard
              key={task.id}
              reportId={reportId}
              sectionId={section.id}
              task={task}
              letter={taskLetter(taskIndex)}
              leadNotes={leadNotesByTask.get(task.id) ?? []}
              leadQuestions={leadQuestionsByTask.get(task.id) ?? []}
              isFirst={taskIndex === 0}
              isLast={taskIndex === displayedTasks.length - 1}
              onMoveUp={() => handleMoveTask(task.id, 'up')}
              onMoveDown={() => handleMoveTask(task.id, 'down')}
              onReorderDrop={handleTaskReorderDrop}
            />
          ))
        ) : (
          <EmptyState title="No tasks yet" description="Add one crisp update. Keep it short so the lead can scan it quickly." />
        )}
      </div>

      <div className="border-t border-line px-4 py-3">
        <AddTaskForm reportId={reportId} section={section} />
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
}: {
  reportId: string;
  sections: SectionWithTasks[];
  leadNotesByTask: Map<string, LeadNoteWithId[]>;
  leadQuestionsByTask: Map<string, LeadQuestionWithId[]>;
  onAddSection: (section: Section) => Promise<unknown>;
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
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-fg">Today’s work</h2>
          <p className="text-sm text-fg-muted">Group related work under clear main titles.</p>
        </div>
      </div>

      {sectionOrderError ? (
        <p className="mt-2 text-xs font-medium text-danger-fg" role="alert">
          {sectionOrderError}
        </p>
      ) : null}

      <div className="mt-3">
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

function QuestionComposer({
  onAddQuestion,
}: {
  onAddQuestion: (question: CreateQuestionInput) => Promise<unknown>;
}) {
  const [questionText, setQuestionText] = useState('');
  const [options, setOptions] = useState(['', '']);

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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = questionText.trim();
    const trimmedOptions = options.map((option) => option.trim()).filter(Boolean);

    if (!trimmedQuestion || trimmedOptions.length < QUESTION_OPTION_MINIMUM) {
      return;
    }

    runSafely(
      onAddQuestion({
        questionText: trimmedQuestion,
        options: trimmedOptions,
      }),
      'Question add failed',
    );
    setQuestionText('');
    setOptions(['', '']);
  }

  return (
    <form className="rounded-md border-l-2 border-done-emphasis bg-done-muted p-4" onSubmit={handleSubmit}>
      <label className="block text-sm font-medium text-done-fg">
        Question for the lead
        <input
          className="mt-2 w-full rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
          value={questionText}
          onChange={(event) => setQuestionText(event.target.value)}
          placeholder="What should the lead decide?"
        />
      </label>

      <div className="mt-3 space-y-2">
        {options.map((option, index) => (
          <div className="flex items-center gap-2" key={index}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-muted text-xs font-semibold text-fg">
              {optionLabels[index]}
            </span>
            <input
              className="min-w-0 flex-1 rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
              value={option}
              onChange={(event) => updateOption(index, event.target.value)}
              placeholder={`Option ${optionLabels[index]}`}
            />
            <button
              className="rounded-md px-2 py-1 text-xs font-medium text-danger-fg transition hover:bg-danger-muted hover:text-danger-fg disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
              disabled={options.length <= QUESTION_OPTION_MINIMUM}
              onClick={() => removeOption(index)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-between">
        <button
          className="rounded-md border border-line bg-control px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={options.length >= QUESTION_OPTION_LIMIT}
          onClick={() => setOptions((currentOptions) => [...currentOptions, ''])}
        >
          Add option
        </button>
        <button
          className="rounded-md border border-white/15 bg-success-emphasis px-3 py-1.5 text-sm font-medium text-white transition hover:bg-success-hover disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
          disabled={!questionText.trim() || options.filter((option) => option.trim()).length < QUESTION_OPTION_MINIMUM}
        >
          Add question
        </button>
      </div>
    </form>
  );
}

function QuestionCard({ reportId, question }: { reportId: string; question: QuestionWithId }) {
  const isAnswered = question.selectedAnswer !== undefined;
  const answerText = isAnswered ? question.options[question.selectedAnswer ?? 0] : undefined;

  return (
    <article className="group/question rounded-md border-l-2 border-done-emphasis bg-canvas-subtle p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fg">{question.questionText}</p>
          <p className={`mt-2 text-xs font-semibold ${isAnswered ? 'text-success-fg' : 'text-attention-fg'}`}>
            {isAnswered ? `Answered: ${answerText}` : 'Pending the lead’s answer'}
          </p>
        </div>
        <button
          className="rounded-md px-2 py-1 text-xs font-medium text-danger-fg transition hover:bg-danger-muted hover:text-danger-fg md:opacity-0 md:group-hover/question:opacity-100 md:group-focus-within/question:opacity-100"
          type="button"
          onClick={() => runSafely(removeQuestion(reportId, question.id), 'Question remove failed')}
        >
          Remove
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {question.options.map((option, index) => (
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              question.selectedAnswer === index
                ? 'border-success-emphasis/40 bg-success-muted text-success-fg'
                : 'border-line bg-canvas-subtle text-fg-muted'
            }`}
            key={`${option}-${index}`}
          >
            {optionLabels[index]}. {option}
          </span>
        ))}
      </div>
    </article>
  );
}

function QuestionsPanel({
  reportId,
  questions = [],
  onAddQuestion,
}: {
  reportId: string;
  questions?: QuestionWithId[];
  onAddQuestion: (question: CreateQuestionInput) => Promise<unknown>;
}) {
  return (
    <section className="rounded-md border border-line bg-canvas shadow-sm">
      <div className="flex items-center gap-2 rounded-t-md border-b border-line bg-canvas-subtle px-4 py-3">
        <h2 className="text-lg font-semibold text-fg">Questions to the lead</h2>
        <span className="rounded-full border border-done-emphasis/40 bg-done-muted px-2 py-0.5 text-xs font-medium text-done-fg">
          multiple choice
        </span>
      </div>

      <div className="p-4">
        <p className="text-sm text-fg-muted">Use multiple choice when you need a fast answer.</p>

        <div className="mt-3">
          <QuestionComposer onAddQuestion={onAddQuestion} />
        </div>

        <div className="mt-4 space-y-3">
          {questions.length > 0 ? (
            questions.map((question) => <QuestionCard key={question.id} reportId={reportId} question={question} />)
          ) : (
            <EmptyState
              title="No questions yet"
              description="Add a decision the lead can answer quickly. Their selected answer will show here in realtime once question subscription is available."
            />
          )}
        </div>
      </div>
    </section>
  );
}

export function DeveloperView({ userId, developerName }: DeveloperViewProps) {
  // null means "follow today"; picking today's date again returns to that mode.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const { reportTree, reportId, loading, date, ensureReportExists } = useMyReport(userId, selectedDate);
  const { assignments } = useMyAssignments(userId, date);
  const [previewAsLead, setPreviewAsLead] = useState(() => loadPreviewAsLead());
  const handleDateChange = (nextDate: string) =>
    setSelectedDate(nextDate === todayDateString() ? null : nextDate);

  function handlePreviewAsLeadChange(next: boolean) {
    setPreviewAsLead(next);
    persistPreviewAsLead(next);
  }

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
    (reportTree?.notes ?? []).forEach((note) => {
      if (!note.targetTaskId) {
        return;
      }
      grouped.set(note.targetTaskId, [...(grouped.get(note.targetTaskId) ?? []), note]);
    });
    return grouped;
  }, [reportTree?.notes]);

  const leadQuestionsByTask = useMemo(() => {
    const grouped = new Map<string, LeadQuestionWithId[]>();
    (reportTree?.leadQuestions ?? []).forEach((question) => {
      grouped.set(question.taskId, [...(grouped.get(question.taskId) ?? []), question]);
    });
    return grouped;
  }, [reportTree?.leadQuestions]);

  const reportLevelLeadNotes = useMemo(
    () => (reportTree?.notes ?? []).filter((note) => !note.targetTaskId),
    [reportTree?.notes],
  );
  const reportLevelLeadQuestions = leadQuestionsByTask.get('') ?? [];

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
        <ReportPreview reportTree={reportTree} developerId={userId} date={date} assignments={assignments} />
      ) : (
        <>
          <AssignmentsBox assignments={assignments} userId={userId} date={date} />
          {reportLevelLeadNotes.length > 0 || reportLevelLeadQuestions.length > 0 ? (
            <section className="rounded-md border border-line bg-canvas shadow-sm">
              <div className="rounded-t-md border-b border-line bg-canvas-subtle px-4 py-3">
                <h2 className="text-lg font-semibold text-fg">From the lead</h2>
              </div>
              <div className="p-4">
                <LeadNotesReadOnly notes={reportLevelLeadNotes} />
                {reportLevelLeadQuestions.length > 0 ? (
                  <div className="mt-3 space-y-3">
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
          />
          <QuestionsPanel reportId={reportId} questions={reportTree.questions} onAddQuestion={handleAddQuestion} />
        </>
      )}
    </div>
  );
}
