import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  addQuestion,
  addSection,
  addTask,
  removeQuestion,
  removeSection,
  removeTask,
  renameSection,
  updateTask,
} from '../../services/firestore';
import { uploadTaskImage } from '../../services/storage';
import { useMyReport } from '../../hooks/useMyReport';
import type { QuestionWithId, SectionWithTasks, TaskLink, TaskWithId } from '../../types';

const TASK_DESCRIPTION_LIMIT = 140;
const QUESTION_OPTION_LIMIT = 6;
const QUESTION_OPTION_MINIMUM = 2;
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

function Header({ date, developerName }: { date?: string; developerName: string }) {
  return (
    <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">DailyBit</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            {formatDisplayDate(date)}
          </h1>
          <p className="mt-2 text-sm text-slate-500">{developerName}</p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          Everything saves automatically
        </div>
      </div>
    </header>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-5 py-8 text-center">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
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
      void renameSection(reportId, section.id, nextTitle);
    }
    setTitle(nextTitle);
  }

  return (
    <input
      className="w-full rounded-xl border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-slate-950 outline-none transition hover:border-slate-200 focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-100"
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

    void addSection(reportId, {
      title: trimmedTitle,
      order: getNextOrder(sections),
    });
    setTitle('');
  }

  return (
    <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleSubmit}>
      <input
        className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Add main title"
        aria-label="Add main title"
      />
      <button
        className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
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

    void addTask(reportId, section.id, {
      description: trimmedDescription,
      links: [],
      order: getNextOrder(section.tasks),
    });
    setDescription('');
  }

  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleSubmit}>
      <input
        className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Add a short task, then press Enter"
        maxLength={TASK_DESCRIPTION_LIMIT}
        aria-label="New task description"
      />
      <button
        className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
              key={`${link.url}-${index}`}
            >
              <a className="max-w-[12rem] truncate hover:text-sky-700" href={link.url} target="_blank" rel="noreferrer">
                {link.label || link.url}
              </a>
              <button
                className="text-slate-400 transition hover:text-rose-600"
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
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://..."
          aria-label="Link URL"
        />
        <input
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Label"
          aria-label="Link label"
        />
        <button
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
          disabled={!isValidUrl(url.trim())}
        >
          Add link
        </button>
      </form>
    </div>
  );
}

function TaskCard({
  reportId,
  userId,
  date,
  sectionId,
  task,
}: {
  reportId: string;
  userId: string;
  date: string;
  sectionId: string;
  task: TaskWithId;
}) {
  const [description, setDescription] = useState(task.description);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDescription(task.description);
  }, [task.description]);

  const charactersRemaining = TASK_DESCRIPTION_LIMIT - description.length;
  const counterColor = charactersRemaining <= 10 ? 'text-rose-600' : charactersRemaining <= 25 ? 'text-amber-600' : 'text-slate-400';

  function persistDescription() {
    const nextDescription = description.trim();
    if (nextDescription && nextDescription !== task.description) {
      void updateTask(reportId, sectionId, task.id, { description: nextDescription });
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
      const imageUrl = await uploadTaskImage(file, userId, date);
      await updateTask(reportId, sectionId, task.id, { imageUrl });
    } catch (error) {
      console.error('Image upload failed', error);
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function updateLinks(links: TaskLink[]) {
    void updateTask(reportId, sectionId, task.id, { links });
  }

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Task
            <input
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
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
          className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
          type="button"
          onClick={() => void removeTask(reportId, sectionId, task.id)}
          aria-label="Remove task"
        >
          Remove
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[10rem_1fr]">
        <div>
          {task.imageUrl ? (
            <img
              className="h-28 w-full rounded-xl border border-slate-200 object-cover"
              src={task.imageUrl}
              alt="Task attachment preview"
            />
          ) : (
            <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
              No image
            </div>
          )}
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="image/*"
            onChange={(event) => void handleImageSelected(event.target.files?.[0])}
          />
          <button
            className="mt-2 inline-flex w-full items-center justify-center rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? 'Uploading...' : task.imageUrl ? 'Replace image' : 'Attach image'}
          </button>
          {uploadError && (
            <p className="mt-1 text-xs font-medium text-rose-600" role="alert">{uploadError}</p>
          )}
        </div>

        <TaskLinks links={task.links ?? []} onChange={updateLinks} />
      </div>
    </article>
  );
}

function SectionCard({
  reportId,
  userId,
  date,
  section,
}: {
  reportId: string;
  userId: string;
  date: string;
  section: SectionWithTasks;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex items-center gap-3">
        <SectionTitle reportId={reportId} section={section} />
        <button
          className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
          type="button"
          onClick={() => void removeSection(reportId, section.id)}
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
              userId={userId}
              date={date}
              sectionId={section.id}
              task={task}
            />
          ))
        ) : (
          <EmptyState title="No tasks yet" description="Add one crisp update. Keep it short so Ryan can scan it quickly." />
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
  userId,
  date,
  sections,
}: {
  reportId: string;
  userId: string;
  date: string;
  sections: SectionWithTasks[];
}) {
  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.order - b.order),
    [sections],
  );

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Today’s work</h2>
          <p className="mt-1 text-sm text-slate-500">Group related work under clear main titles.</p>
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
              userId={userId}
              date={date}
              section={section}
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

    void addQuestion(reportId, {
      questionText: trimmedQuestion,
      options: trimmedOptions,
    });
    setQuestionText('');
    setOptions(['', '']);
  }

  return (
    <form className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4" onSubmit={handleSubmit}>
      <label className="block text-sm font-medium text-slate-700">
        Question for Ryan
        <input
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          value={questionText}
          onChange={(event) => setQuestionText(event.target.value)}
          placeholder="What should Ryan decide?"
        />
      </label>

      <div className="mt-4 space-y-2">
        {options.map((option, index) => (
          <div className="flex items-center gap-2" key={index}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
              {optionLabels[index]}
            </span>
            <input
              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              value={option}
              onChange={(event) => updateOption(index, event.target.value)}
              placeholder={`Option ${optionLabels[index]}`}
            />
            <button
              className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
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
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={options.length >= QUESTION_OPTION_LIMIT}
          onClick={() => setOptions((currentOptions) => [...currentOptions, ''])}
        >
          Add option
        </button>
        <button
          className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
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
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-950">{question.questionText}</p>
          <p className={`mt-2 text-xs font-semibold ${isAnswered ? 'text-emerald-700' : 'text-amber-700'}`}>
            {isAnswered ? `Answered: ${answerText}` : 'Pending Ryan’s answer'}
          </p>
        </div>
        <button
          className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
          type="button"
          onClick={() => void removeQuestion(reportId, question.id)}
        >
          Remove
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {question.options.map((option, index) => (
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              question.selectedAnswer === index
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-50 text-slate-600'
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
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-semibold text-slate-950">Questions to Ryan</h2>
        <p className="mt-1 text-sm text-slate-500">Use multiple choice when you need a fast answer.</p>
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
            description="Add a decision Ryan can answer quickly. His selected answer will show here in realtime once question subscription is available."
          />
        )}
      </div>
    </section>
  );
}

export function DeveloperView({ userId, developerName }: DeveloperViewProps) {
  const { reportTree, reportId, loading } = useMyReport(userId);

  if (loading || !reportId) {
    return (
      <div className="space-y-6">
        <Header developerName={developerName} />
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
          Preparing today’s report...
        </div>
      </div>
    );
  }

  if (!reportTree) {
    return (
      <div className="space-y-6">
        <Header developerName={developerName} />
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-sm text-rose-700">
          Today’s report could not be loaded. Please refresh and try again.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header date={reportTree.date} developerName={developerName} />
      <SectionsList
        reportId={reportId}
        userId={userId}
        date={reportTree.date}
        sections={reportTree.sections}
      />
      <QuestionsPanel reportId={reportId} questions={reportTree.questions} />
    </div>
  );
}
