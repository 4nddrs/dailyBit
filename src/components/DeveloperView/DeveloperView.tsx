import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  addQuestion,
  addSection,
  addTask,
  addTaskImage,
  answerLeadQuestion,
  removeQuestion,
  removeSection,
  removeTask,
  removeTaskImage,
  renameSection,
  updateTask,
} from '../../services/firestore';
import { useMyReport } from '../../hooks/useMyReport';
import type {
  LeadNoteWithId,
  LeadQuestionWithId,
  QuestionWithId,
  SectionWithTasks,
  TaskLink,
  TaskWithId,
} from '../../types';

const TASK_DESCRIPTION_LIMIT = 140;
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
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(new Date());
  }

  return new Intl.DateTimeFormat(undefined, {
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

function Header({ date, developerName }: { date?: string; developerName: string }) {
  return (
    <header className="rounded-3xl border border-line bg-canvas p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent-fg">DailyBit</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg">
            {formatDisplayDate(date)}
          </h1>
          <p className="mt-2 text-sm text-fg-muted">{developerName}</p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-success-emphasis/40 bg-success-muted px-3 py-1.5 text-sm font-medium text-success-fg">
          <span className="h-2 w-2 rounded-full bg-success-fg" aria-hidden="true" />
          Everything saves automatically
        </div>
      </div>
    </header>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-canvas-inset px-5 py-8 text-center">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-fg-muted">{description}</p>
    </div>
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
      className="w-full rounded-xl border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-fg outline-none transition hover:border-line focus:border-accent-emphasis focus:bg-canvas-subtle focus:ring-2 focus:ring-accent-emphasis"
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

function AddSectionForm({ reportId, sections }: { reportId: string; sections: SectionWithTasks[] }) {
  const [title, setTitle] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      return;
    }

    runSafely(
      addSection(reportId, {
        title: trimmedTitle,
        order: getNextOrder(sections),
      }),
      'Section add failed',
    );
    setTitle('');
  }

  return (
    <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleSubmit}>
      <input
        className="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-4 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-2 focus:ring-accent-emphasis"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Add main title"
        aria-label="Add main title"
      />
      <button
        className="rounded-xl border border-white/15 bg-success-emphasis px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-success-hover disabled:cursor-not-allowed disabled:opacity-50"
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
        className="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-2 focus:ring-accent-emphasis"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Add a short task, then press Enter"
        maxLength={TASK_DESCRIPTION_LIMIT}
        aria-label="New task description"
      />
      <button
        className="rounded-xl border border-line bg-control px-3 py-2 text-sm font-semibold text-fg transition hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50"
        type="submit"
        disabled={!description.trim()}
      >
        Add task
      </button>
    </form>
  );
}

function TaskLinks({
  links,
  onChange,
}: {
  links: TaskLink[];
  onChange: (links: TaskLink[]) => void;
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

    onChange([...links, { url: trimmedUrl, label: trimmedLabel || undefined }]);
    setUrl('');
    setLabel('');
  }

  return (
    <div className="space-y-3">
      {links.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {links.map((link, index) => (
            <span
              className="inline-flex items-center gap-2 rounded-full border border-line bg-canvas-subtle px-3 py-1 text-xs font-medium text-fg-muted"
              key={`${link.url}-${index}`}
            >
              <a className="max-w-[12rem] truncate hover:text-accent-fg" href={link.url} target="_blank" rel="noreferrer">
                {link.label || link.url}
              </a>
              <button
                className="text-danger-fg transition hover:text-danger-fg"
                type="button"
                onClick={() => onChange(links.filter((_, linkIndex) => linkIndex !== index))}
                aria-label={`Remove link ${link.label || link.url}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <form className="grid gap-2 md:grid-cols-[1fr_9rem_auto]" onSubmit={handleSubmit}>
        <input
          className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-2 focus:ring-accent-emphasis"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://..."
          aria-label="Link URL"
        />
        <input
          className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-2 focus:ring-accent-emphasis"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Label"
          aria-label="Link label"
        />
        <button
          className="rounded-xl border border-line bg-control px-3 py-2 text-sm font-semibold text-fg transition hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
          disabled={!isValidUrl(url.trim())}
        >
          Add link
        </button>
      </form>
    </div>
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
          className="rounded-xl border border-attention-emphasis/60 bg-attention-muted px-3 py-2 text-sm text-attention-fg"
          key={note.id}
        >
          <span className="border-l-4 border-attention-emphasis pl-3 leading-6">{note.noteText}</span>
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
    <article className="rounded-2xl border border-done-emphasis/40 bg-canvas-subtle p-4">
      <p className="text-sm font-semibold leading-6 text-fg">{question.questionText}</p>

      {!editing && isAnswered ? (
        <div className="mt-2">
          {question.kind === 'text' ? (
            <p className="rounded-lg border border-success-emphasis/40 bg-success-muted px-3 py-2 text-sm text-success-fg">
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
            className="mt-2 rounded-xl border border-line bg-control px-3 py-1.5 text-xs font-semibold text-fg transition hover:bg-control-hover"
            type="button"
            onClick={() => setEditing(true)}
          >
            Change answer
          </button>
        </div>
      ) : question.kind === 'text' ? (
        <form className="mt-2" onSubmit={handleTextSubmit}>
          <textarea
            className="min-h-16 w-full resize-y rounded-xl border border-line bg-canvas-subtle px-3 py-2 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-2 focus:ring-accent-emphasis"
            value={answerText}
            onChange={(event) => setAnswerText(event.target.value)}
            placeholder="Type your answer"
          />
          <div className="mt-2 flex justify-end">
            <button
              className="rounded-xl border border-white/15 bg-success-emphasis px-3 py-2 text-xs font-semibold text-white transition hover:bg-success-hover disabled:cursor-not-allowed disabled:opacity-50"
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

  return (
    <article className="rounded-2xl border border-line bg-canvas-subtle p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <label className="block text-xs font-semibold uppercase tracking-wide text-fg">
            Task
            <input
              className="mt-2 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-fg outline-none transition focus:border-accent-emphasis focus:ring-2 focus:ring-accent-emphasis"
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
        <button
          className="rounded-lg px-2 py-1 text-sm font-semibold text-danger-fg transition hover:bg-danger-muted hover:text-danger-fg"
          type="button"
          onClick={() => runSafely(removeTask(reportId, sectionId, task.id), 'Task remove failed')}
          aria-label="Remove task"
        >
          Remove
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[10rem_1fr]">
        <div>
          {task.images.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
              {task.images.map((image) => (
                <div className="relative" key={image.id}>
                  <a href={image.imageBase64} rel="noreferrer" target="_blank" aria-label="Open task image">
                    <img
                      className="h-24 w-full rounded-xl border border-line object-cover transition hover:opacity-90"
                      src={image.imageBase64}
                      alt="Task attachment preview"
                    />
                  </a>
                  <button
                    className="absolute right-1 top-1 rounded-full bg-canvas-subtle/90 px-1.5 py-0.5 text-xs font-semibold text-danger-fg transition hover:bg-danger-muted hover:text-danger-fg"
                    type="button"
                    onClick={() => handleRemoveImage(image.id)}
                    aria-label="Remove image"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="image/*"
            onChange={(event) => runSafely(handleImageSelected(event.target.files?.[0]), 'Image selection failed')}
          />
          <div className="mt-2 flex gap-2">
            <button
              className="inline-flex flex-1 items-center justify-center rounded-xl border border-line bg-control px-3 py-2 text-xs font-semibold text-fg transition hover:bg-control-hover disabled:cursor-wait disabled:opacity-60"
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? 'Processing...' : 'Attach image'}
            </button>
          </div>
          {uploadError && (
            <p className="mt-1 text-xs font-medium text-danger-fg" role="alert">{uploadError}</p>
          )}
        </div>

        <TaskLinks links={task.links ?? []} onChange={updateLinks} />
      </div>

      <LeadNotesReadOnly notes={leadNotes} />
      {leadQuestions.length > 0 ? (
        <div className="mt-3 space-y-3">
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
    <section className="rounded-3xl border border-line bg-canvas-subtle p-4">
      <div className="flex items-center gap-3">
        <SectionTitle reportId={reportId} section={section} />
        <button
          className="rounded-lg px-2 py-1 text-sm font-semibold text-danger-fg transition hover:bg-danger-muted hover:text-danger-fg"
          type="button"
          onClick={() => runSafely(removeSection(reportId, section.id), 'Section remove failed')}
        >
          Remove
        </button>
      </div>

      <div className="mt-4 space-y-3">
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

      <div className="mt-4">
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
}: {
  reportId: string;
  sections: SectionWithTasks[];
  leadNotesByTask: Map<string, LeadNoteWithId[]>;
  leadQuestionsByTask: Map<string, LeadQuestionWithId[]>;
}) {
  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.order - b.order),
    [sections],
  );

  return (
    <section className="rounded-3xl border border-line bg-canvas p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-fg">Today’s work</h2>
          <p className="mt-1 text-sm text-fg-muted">Group related work under clear main titles.</p>
        </div>
      </div>

      <div className="mt-5">
        <AddSectionForm reportId={reportId} sections={sortedSections} />
      </div>

      <div className="mt-5 space-y-4">
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

function QuestionComposer({ reportId }: { reportId: string }) {
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
      addQuestion(reportId, {
        questionText: trimmedQuestion,
        options: trimmedOptions,
      }),
      'Question add failed',
    );
    setQuestionText('');
    setOptions(['', '']);
  }

  return (
    <form className="rounded-2xl border border-done-emphasis/40 bg-done-muted p-4" onSubmit={handleSubmit}>
      <label className="block text-sm font-medium text-done-fg">
        Question for the lead
        <input
          className="mt-2 w-full rounded-xl border border-line bg-canvas-subtle px-3 py-2 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-2 focus:ring-accent-emphasis"
          value={questionText}
          onChange={(event) => setQuestionText(event.target.value)}
          placeholder="What should the lead decide?"
        />
      </label>

      <div className="mt-4 space-y-2">
        {options.map((option, index) => (
          <div className="flex items-center gap-2" key={index}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-muted text-xs font-semibold text-fg">
              {optionLabels[index]}
            </span>
            <input
              className="min-w-0 flex-1 rounded-xl border border-line bg-canvas-subtle px-3 py-2 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-2 focus:ring-accent-emphasis"
              value={option}
              onChange={(event) => updateOption(index, event.target.value)}
              placeholder={`Option ${optionLabels[index]}`}
            />
            <button
              className="rounded-lg px-2 py-1 text-sm font-semibold text-danger-fg transition hover:bg-danger-muted hover:text-danger-fg disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
              disabled={options.length <= QUESTION_OPTION_MINIMUM}
              onClick={() => removeOption(index)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-between">
        <button
          className="rounded-xl border border-line bg-control px-3 py-2 text-sm font-semibold text-fg transition hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={options.length >= QUESTION_OPTION_LIMIT}
          onClick={() => setOptions((currentOptions) => [...currentOptions, ''])}
        >
          Add option
        </button>
        <button
          className="rounded-xl border border-white/15 bg-success-emphasis px-4 py-2 text-sm font-semibold text-white transition hover:bg-success-hover disabled:cursor-not-allowed disabled:opacity-50"
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
    <article className="rounded-2xl border border-done-emphasis/40 bg-canvas-subtle p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fg">{question.questionText}</p>
          <p className={`mt-2 text-xs font-semibold ${isAnswered ? 'text-success-fg' : 'text-attention-fg'}`}>
            {isAnswered ? `Answered: ${answerText}` : 'Pending the lead’s answer'}
          </p>
        </div>
        <button
          className="rounded-lg px-2 py-1 text-sm font-semibold text-danger-fg transition hover:bg-danger-muted hover:text-danger-fg"
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

function QuestionsPanel({ reportId, questions = [] }: { reportId: string; questions?: QuestionWithId[] }) {
  return (
    <section className="rounded-3xl border border-done-emphasis/40 bg-canvas p-5">
      <div>
        <h2 className="text-xl font-semibold text-fg">Questions to the lead</h2>
        <p className="mt-1 text-sm text-fg-muted">Use multiple choice when you need a fast answer.</p>
      </div>

      <div className="mt-5">
        <QuestionComposer reportId={reportId} />
      </div>

      <div className="mt-5 space-y-3">
        {questions.length > 0 ? (
          questions.map((question) => <QuestionCard key={question.id} reportId={reportId} question={question} />)
        ) : (
          <EmptyState
            title="No questions yet"
            description="Add a decision the lead can answer quickly. Their selected answer will show here in realtime once question subscription is available."
          />
        )}
      </div>
    </section>
  );
}

export function DeveloperView({ userId, developerName }: DeveloperViewProps) {
  const { reportTree, reportId, loading } = useMyReport(userId);

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
        <Header developerName={developerName} />
        <div className="rounded-3xl border border-line bg-canvas p-8 text-sm text-fg-muted">
          Preparing today’s report...
        </div>
      </div>
    );
  }

  if (!reportTree) {
    return (
      <div className="space-y-6">
        <Header developerName={developerName} />
        <div className="rounded-3xl border border-danger-emphasis/40 bg-danger-muted p-8 text-sm text-danger-fg">
          Today’s report could not be loaded. Please refresh and try again.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header date={reportTree.date} developerName={developerName} />
      {reportLevelLeadNotes.length > 0 || reportLevelLeadQuestions.length > 0 ? (
        <section className="rounded-3xl border border-line bg-canvas p-5">
          <h2 className="text-lg font-semibold text-fg">From the lead</h2>
          <LeadNotesReadOnly notes={reportLevelLeadNotes} />
          {reportLevelLeadQuestions.length > 0 ? (
            <div className="mt-3 space-y-3">
              {reportLevelLeadQuestions.map((question) => (
                <LeadQuestionCard key={question.id} reportId={reportId} question={question} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      <SectionsList
        reportId={reportId}
        sections={reportTree.sections}
        leadNotesByTask={leadNotesByTask}
        leadQuestionsByTask={leadQuestionsByTask}
      />
      <QuestionsPanel reportId={reportId} questions={reportTree.questions} />
    </div>
  );
}
