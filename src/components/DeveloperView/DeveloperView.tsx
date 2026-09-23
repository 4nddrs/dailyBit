import { FormEvent, KeyboardEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addAssignmentUpdateImage,
  addQuestion,
  addSection,
  addTask,
  addTaskImage,
  answerLeadQuestion,
  removeAssignmentUpdateImage,
  removeQuestion,
  removeSection,
  removeTask,
  removeTaskImage,
  renameSection,
  saveAssignmentUpdate,
  subscribeAssignmentUpdate,
  updateTask,
} from '../../services/firestore';
import { ImageLightbox } from '../ImageLightbox';
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
const QUESTION_OPTION_LIMIT = 6;
const QUESTION_OPTION_MINIMUM = 2;
const MAX_IMAGE_SIDE = 1024;
const MAX_IMAGE_DATA_URL_LENGTH = 900_000;
const optionLabels = ['A', 'B', 'C', 'D', 'E', 'F'];

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

function Header({
  date,
  developerName,
  onDateChange,
}: {
  date: string;
  developerName: string;
  onDateChange: (date: string) => void;
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
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-success-emphasis/40 bg-success-muted px-2 py-1 text-xs font-medium text-success-fg">
          <span className="h-2 w-2 rounded-full bg-success-fg" aria-hidden="true" />
          Everything saves automatically
        </div>
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
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted transition ${
        danger ? 'hover:bg-danger-muted hover:text-danger-fg' : 'hover:bg-control-hover hover:text-fg'
      }`}
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
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
  const isAnswered = question.kind === 'text' ? Boolean(question.answerText) : question.selectedAnswer !== undefined;
  const [editing, setEditing] = useState(!isAnswered);
  const [answerText, setAnswerText] = useState(question.answerText ?? '');
  const [submittingIndex, setSubmittingIndex] = useState<number | null>(null);
  const [submittingText, setSubmittingText] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);

  useEffect(() => {
    setAnswerText(question.answerText ?? '');
  }, [question.answerText]);

  useEffect(() => {
    setEditing(!isAnswered);
  }, [isAnswered]);

  async function handleTextSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedAnswer = answerText.trim();

    if (!trimmedAnswer) {
      return;
    }

    setSubmittingText(true);
    setAnswerError(null);
    try {
      await answerLeadQuestion(reportId, question.id, { answerText: trimmedAnswer });
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

  return (
    <article className="rounded-md border-l-2 border-done-emphasis bg-canvas-subtle p-3">
      <p className="text-sm font-semibold leading-6 text-fg">{question.questionText}</p>

      {!editing && isAnswered ? (
        <div className="mt-2">
          {question.kind === 'text' ? (
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
      ) : question.kind === 'text' ? (
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
      {answerError ? <p className="mt-2 text-xs font-medium text-danger-fg" role="alert">{answerError}</p> : null}
    </article>
  );
}

function TaskCard({
  reportId,
  sectionId,
  task,
  leadNotes,
  leadQuestions,
}: {
  reportId: string;
  sectionId: string;
  task: TaskWithId;
  leadNotes: LeadNoteWithId[];
  leadQuestions: LeadQuestionWithId[];
}) {
  const [description, setDescription] = useState(task.description);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showLinkForm, setShowLinkForm] = useState(false);
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

  const links = task.links ?? [];

  return (
    <article className="group/task px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <label className="block text-xs font-semibold uppercase tracking-wide text-fg">
            Task
            <input
              className="mt-2 w-full rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-sm text-fg outline-none transition focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
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
          </label>
          <p className={`mt-1 text-right text-xs font-medium ${counterColor}`}>
            {description.length}/{TASK_DESCRIPTION_LIMIT}
          </p>
        </div>
        <CardToolbar>
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
  leadNotesByTask,
  leadQuestionsByTask,
}: {
  reportId: string;
  section: SectionWithTasks;
  leadNotesByTask: Map<string, LeadNoteWithId[]>;
  leadQuestionsByTask: Map<string, LeadQuestionWithId[]>;
}) {
  return (
    <section className="rounded-md border border-line bg-canvas shadow-sm">
      <div className="group/section flex items-center gap-3 rounded-t-md border-b border-line bg-canvas-subtle px-4 py-3">
        <SectionTitle reportId={reportId} section={section} />
        <button
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-danger-fg transition hover:bg-danger-muted hover:text-danger-fg md:opacity-0 md:group-hover/section:opacity-100 md:group-focus-within/section:opacity-100"
          type="button"
          onClick={() => runSafely(removeSection(reportId, section.id), 'Section remove failed')}
        >
          Remove
        </button>
      </div>

      <div className="divide-y divide-line">
        {section.tasks.length > 0 ? (
          section.tasks.map((task) => (
            <TaskCard
              key={task.id}
              reportId={reportId}
              sectionId={section.id}
              task={task}
              leadNotes={leadNotesByTask.get(task.id) ?? []}
              leadQuestions={leadQuestionsByTask.get(task.id) ?? []}
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

  return (
    <section>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-fg">Today’s work</h2>
          <p className="text-sm text-fg-muted">Group related work under clear main titles.</p>
        </div>
      </div>

      <div className="mt-3">
        <AddSectionForm sections={sortedSections} onAddSection={onAddSection} />
      </div>

      <div className="mt-4 space-y-6">
        {sortedSections.length > 0 ? (
          sortedSections.map((section) => (
            <SectionCard
              key={section.id}
              reportId={reportId}
              section={section}
              leadNotesByTask={leadNotesByTask}
              leadQuestionsByTask={leadQuestionsByTask}
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
  const handleDateChange = (nextDate: string) =>
    setSelectedDate(nextDate === todayDateString() ? null : nextDate);

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
        <Header date={date} developerName={developerName} onDateChange={handleDateChange} />
        <div className="rounded-md border border-line bg-canvas p-4 text-sm text-fg-muted shadow-sm">
          Preparing the report...
        </div>
      </div>
    );
  }

  if (!reportTree) {
    return (
      <div className="space-y-6">
        <Header date={date} developerName={developerName} onDateChange={handleDateChange} />
        <div className="rounded-md border border-danger-emphasis/40 bg-danger-muted p-4 text-sm text-danger-fg shadow-sm">
          Today’s report could not be loaded. Please refresh and try again.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header date={date} developerName={developerName} onDateChange={handleDateChange} />
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
    </div>
  );
}
