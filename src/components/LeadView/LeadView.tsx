import { FormEvent, useMemo, useState, useEffect } from 'react';
import {
  addLeadNote,
  addLeadQuestion,
  answerQuestion,
  getUserProfile,
  removeLeadNote,
  removeLeadQuestion,
} from '../../services/firestore';
import { useReportsByDate } from '../../hooks/useReportsByDate';
import { useUserProfiles } from '../../hooks/useUserProfiles';
import type {
  LeadNoteWithId,
  LeadQuestionKind,
  LeadQuestionWithId,
  QuestionWithId,
  ReportTree,
  SectionWithTasks,
  TaskLink,
  TaskWithId,
} from '../../types';
import { todayDateString } from '../../types';

const optionLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
const QUESTION_OPTION_MINIMUM = 2;
const QUESTION_OPTION_LIMIT = 6;
const UNKNOWN_DEVELOPER_NAME = 'Unknown developer';

interface LeadViewProps {
  leadUserId: string;
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
  return new Intl.DateTimeFormat(undefined, {
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

function LeadHeader({
  date,
  onDateChange,
  reportedCount,
  totalDeveloperCount,
}: {
  date: string;
  onDateChange: (date: string) => void;
  reportedCount: number;
  totalDeveloperCount: number;
}) {
  return (
    <header className="rounded-md border border-line bg-canvas-subtle px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h1 className="text-lg font-semibold tracking-tight text-fg">{formatDisplayDate(date)}</h1>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            Report date
            <input
              className="rounded-md border border-line bg-canvas px-3 py-1.5 text-sm text-fg outline-none transition focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
              type="date"
              value={date}
              onChange={(event) => onDateChange(event.target.value)}
            />
          </label>
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

function LinkChips({ links = [] }: { links?: TaskLink[] }) {
  if (links.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {links.map((link, index) => (
        <a
          className="max-w-full truncate rounded-full border border-line bg-canvas-subtle px-3 py-1 text-xs font-medium text-fg-muted transition hover:border-accent-emphasis/50 hover:bg-accent-muted hover:text-accent-fg"
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

function LeadNoteBlock({
  notes,
  onRemove,
}: {
  notes: LeadNoteWithId[];
  onRemove: (noteId: string) => void;
}) {
  if (notes.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      {notes.map((note) => (
        <div
          className="flex items-start justify-between gap-3 rounded-md border border-attention-emphasis/60 bg-attention-muted px-3 py-2 text-sm text-attention-fg"
          key={note.id}
        >
          <p className="border-l-4 border-attention-emphasis pl-3 leading-6">{note.noteText}</p>
          <button
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-attention-fg transition hover:bg-danger-muted hover:text-danger-fg"
            type="button"
            onClick={() => onRemove(note.id)}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function LeadQuestionBlock({
  questions,
  onRemove,
}: {
  questions: LeadQuestionWithId[];
  onRemove: (questionId: string) => void;
}) {
  if (questions.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      {questions.map((question) => {
        const isAnswered =
          question.kind === 'text' ? Boolean(question.answerText) : question.selectedAnswer !== undefined;

        return (
          <div
            className="rounded-md border border-done-emphasis/40 bg-canvas-subtle px-3 py-2 text-sm"
            key={question.id}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold leading-6 text-done-fg">{question.questionText}</p>
              <button
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-danger-fg transition hover:bg-danger-muted hover:text-danger-fg"
                type="button"
                onClick={() => onRemove(question.id)}
              >
                Remove
              </button>
            </div>

            {!isAnswered ? (
              <p className="mt-2 text-xs font-semibold text-attention-fg">Waiting for answer</p>
            ) : question.kind === 'text' ? (
              <p className="mt-2 rounded-md border border-success-emphasis/40 bg-success-muted px-3 py-2 text-sm text-success-fg">
                {question.answerText}
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
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
          </div>
        );
      })}
    </div>
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
    <form className="mt-3 rounded-md border border-attention-emphasis/60 bg-attention-muted p-3" onSubmit={handleSubmit}>
      <label className="block text-xs font-semibold uppercase tracking-wide text-attention-fg">
        {label}
        <textarea
          className="mt-2 min-h-20 w-full resize-y rounded-md border border-attention-emphasis/60 bg-canvas-subtle px-3 py-2 text-sm normal-case tracking-normal text-fg outline-none transition placeholder:text-fg-muted focus:border-attention-emphasis focus:ring-1 focus:ring-attention-muted"
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
    <form className="mt-3 rounded-md border border-done-emphasis/40 bg-canvas-subtle p-3" onSubmit={handleSubmit}>
      <label className="block text-xs font-semibold uppercase tracking-wide text-done-fg">
        Question for the developer
        <textarea
          className="mt-2 min-h-20 w-full resize-y rounded-md border border-done-emphasis/40 bg-canvas-subtle px-3 py-2 text-sm normal-case tracking-normal text-fg outline-none transition placeholder:text-fg-muted focus:border-done-emphasis focus:ring-1 focus:ring-done-muted"
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
                className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
                value={option}
                onChange={(event) => updateOption(index, event.target.value)}
                placeholder={`Option ${getOptionLabel(index)}`}
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

function TaskCard({
  reportId,
  sectionId,
  task,
  notes,
  questions,
  onAddNote,
  onRemoveNote,
  onAddQuestion,
  onRemoveQuestion,
}: {
  reportId: string;
  sectionId: string;
  task: TaskWithId;
  notes: LeadNoteWithId[];
  questions: LeadQuestionWithId[];
  onAddNote: (targetTaskId: string, noteText: string) => Promise<void>;
  onRemoveNote: (noteId: string) => void;
  onAddQuestion: (
    taskId: string,
    sectionId: string,
    input: { questionText: string; kind: LeadQuestionKind; options?: string[] },
  ) => Promise<void>;
  onRemoveQuestion: (questionId: string) => void;
}) {
  const [openComposer, setOpenComposer] = useState<'question' | 'note' | null>(null);

  function toggleComposer(composer: 'question' | 'note') {
    setOpenComposer((current) => (current === composer ? null : composer));
  }

  return (
    <article className="group px-4 py-3">
      <div className={`grid gap-3 ${task.images.length > 0 ? 'md:grid-cols-[7rem_1fr]' : ''}`}>
        {task.images.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {task.images.map((image) => (
              <a
                href={image.imageBase64}
                key={image.id}
                rel="noreferrer"
                target="_blank"
                aria-label="Open task image"
              >
                <img
                  className="h-24 w-24 rounded-md border border-line object-cover transition hover:opacity-90"
                  src={image.imageBase64}
                  alt="Task attachment thumbnail"
                />
              </a>
            ))}
          </div>
        ) : null}

        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium leading-6 text-fg">{task.description}</p>
            <div className="flex shrink-0 gap-2 opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
              <button
                className="rounded-md border border-line bg-control px-2 py-1 text-xs font-medium text-fg transition hover:bg-control-hover"
                type="button"
                onClick={() => toggleComposer('question')}
              >
                Question
              </button>
              <button
                className="rounded-md border border-line bg-control px-2 py-1 text-xs font-medium text-fg transition hover:bg-control-hover"
                type="button"
                onClick={() => toggleComposer('note')}
              >
                Note
              </button>
            </div>
          </div>
          <LinkChips links={task.links} />
        </div>
      </div>

      {openComposer === 'question' ? (
        <LeadQuestionComposer onAdd={(input) => onAddQuestion(task.id, sectionId, input)} />
      ) : null}
      {openComposer === 'note' ? (
        <NoteComposer label="Lead task note" onAdd={(noteText) => onAddNote(task.id, noteText)} />
      ) : null}

      <LeadQuestionBlock questions={questions} onRemove={onRemoveQuestion} />
      <LeadNoteBlock notes={notes} onRemove={onRemoveNote} />
      <span className="sr-only">Report {reportId}</span>
    </article>
  );
}

function SectionCard({
  reportId,
  section,
  notesByTarget,
  questionsByTarget,
  onAddNote,
  onRemoveNote,
  onAddQuestion,
  onRemoveQuestion,
}: {
  reportId: string;
  section: SectionWithTasks;
  notesByTarget: Map<string, LeadNoteWithId[]>;
  questionsByTarget: Map<string, LeadQuestionWithId[]>;
  onAddNote: (targetTaskId: string, noteText: string) => Promise<void>;
  onRemoveNote: (noteId: string) => void;
  onAddQuestion: (
    taskId: string,
    sectionId: string,
    input: { questionText: string; kind: LeadQuestionKind; options?: string[] },
  ) => Promise<void>;
  onRemoveQuestion: (questionId: string) => void;
}) {
  return (
    <section className="rounded-md border border-line bg-canvas">
      <div className="border-b border-line bg-canvas-subtle px-4 py-2">
        <h3 className="text-sm font-semibold text-fg">{section.title}</h3>
      </div>
      <div className="divide-y divide-line-muted">
        {section.tasks.length > 0 ? (
          section.tasks.map((task) => (
            <TaskCard
              key={task.id}
              reportId={reportId}
              sectionId={section.id}
              task={task}
              notes={notesByTarget.get(task.id) ?? []}
              questions={questionsByTarget.get(task.id) ?? []}
              onAddNote={onAddNote}
              onRemoveNote={onRemoveNote}
              onAddQuestion={onAddQuestion}
              onRemoveQuestion={onRemoveQuestion}
            />
          ))
        ) : (
          <div className="px-4 py-2">
            <CompactEmptyState text="No tasks in this section." />
          </div>
        )}
      </div>
    </section>
  );
}

function QuestionCard({
  reportId,
  question,
  leadUserId,
}: {
  reportId: string;
  question: QuestionWithId;
  leadUserId: string;
}) {
  const [submittingIndex, setSubmittingIndex] = useState<number | null>(null);
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

  return (
    <article className="rounded-md border border-done-emphasis/40 bg-canvas-subtle p-3">
      <p className="text-sm font-semibold leading-6 text-fg">{question.questionText}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {question.options.map((option, index) => {
          const selected = question.selectedAnswer === index;
          return (
            <button
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-wait disabled:opacity-60 ${
                selected
                  ? 'border-success-emphasis/40 bg-success-muted text-success-fg'
                  : 'border-line bg-canvas-subtle text-fg-muted hover:border-accent-emphasis/50 hover:bg-accent-muted hover:text-accent-fg'
              }`}
              key={`${option}-${index}`}
              type="button"
              disabled={submittingIndex !== null}
              onClick={() => void handleAnswer(index)}
            >
              {submittingIndex === index ? 'Saving...' : `${getOptionLabel(index)}. ${option}`}
            </button>
          );
        })}
      </div>
      {answerError ? <p className="mt-2 text-xs font-medium text-danger-fg" role="alert">{answerError}</p> : null}
    </article>
  );
}

function ReportCard({
  report,
  developerName,
  leadUserId,
}: {
  report: ReportTree;
  developerName: string;
  leadUserId: string;
}) {
  const [openComposer, setOpenComposer] = useState<'question' | 'note' | null>(null);

  const notes = report.notes ?? [];
  const leadQuestions = report.leadQuestions ?? [];

  function toggleComposer(composer: 'question' | 'note') {
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
  const devQuestionCount = report.questions?.length ?? 0;
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
    <article className="rounded-md border border-line bg-canvas">
      <div className="flex flex-col gap-3 border-b border-line bg-canvas-subtle px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-fg">{developerName}</h2>
          {summaryParts.length > 0 ? (
            <p className="mt-0.5 text-xs text-fg-muted">{summaryParts.join(' · ')}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            className="rounded-md border border-line bg-control px-2 py-1 text-xs font-medium text-fg transition hover:bg-control-hover"
            type="button"
            onClick={() => toggleComposer('question')}
          >
            Question
          </button>
          <button
            className="rounded-md border border-line bg-control px-2 py-1 text-xs font-medium text-fg transition hover:bg-control-hover"
            type="button"
            onClick={() => toggleComposer('note')}
          >
            Note
          </button>
        </div>
      </div>

      <div className="p-4">
        {openComposer === 'question' ? (
          <LeadQuestionComposer onAdd={(input) => handleAddQuestion('', '', input)} />
        ) : null}
        {openComposer === 'note' ? (
          <NoteComposer label="Lead report note" onAdd={(noteText) => handleAddNote('', noteText)} />
        ) : null}

        <LeadQuestionBlock questions={reportLevelQuestions} onRemove={handleRemoveQuestion} />
        <LeadNoteBlock notes={reportLevelNotes} onRemove={handleRemoveNote} />

        <div className="mt-3 space-y-3">
          {report.sections.length > 0 ? (
            report.sections.map((section) => (
              <SectionCard
                key={section.id}
                reportId={report.id}
                section={section}
                notesByTarget={notesByTarget}
                questionsByTarget={questionsByTarget}
                onAddNote={handleAddNote}
                onRemoveNote={handleRemoveNote}
                onAddQuestion={handleAddQuestion}
                onRemoveQuestion={handleRemoveQuestion}
              />
            ))
          ) : (
            <CompactEmptyState text="No tasks reported yet." />
          )}
        </div>

        {report.questions && report.questions.length > 0 ? (
          <section className="mt-3 rounded-md border border-line bg-canvas-subtle p-3">
            <h3 className="text-sm font-semibold text-fg">Questions from {developerName}</h3>
            <div className="mt-3 space-y-3">
              {report.questions.map((question) => (
                <QuestionCard key={question.id} reportId={report.id} question={question} leadUserId={leadUserId} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </article>
  );
}

export function LeadView({ leadUserId }: LeadViewProps) {
  const [selectedDate, setSelectedDate] = useState(() => todayDateString());
  const normalizedSelectedDate = normalizeDateString(selectedDate);
  const { reportTrees, loading } = useReportsByDate(normalizedSelectedDate);
  const { profiles } = useUserProfiles();
  const totalDeveloperCount = profiles.filter((profile) => profile.role === 'dev').length;
  const [developerNames, setDeveloperNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const missingUserIds = Array.from(
      new Set(reportTrees.map((report) => report.userId).filter((userId) => !developerNames[userId])),
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
  }, [developerNames, reportTrees]);

  return (
    <div className="space-y-4">
      <LeadHeader
        date={normalizedSelectedDate}
        onDateChange={(nextDate) => setSelectedDate(normalizeDateString(nextDate))}
        reportedCount={reportTrees.length}
        totalDeveloperCount={totalDeveloperCount}
      />

      <div className="space-y-3">
        {loading ? (
          <div className="rounded-md border border-line bg-canvas p-4 text-sm text-fg-muted">
            Loading reports...
          </div>
        ) : reportTrees.length > 0 ? (
          reportTrees.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              developerName={developerNames[report.userId] ?? 'Loading…'}
              leadUserId={leadUserId}
            />
          ))
        ) : (
          <p className="px-1 py-2 text-sm text-fg-muted">
            No reports yet today. Try a different date if you are reviewing past work.
          </p>
        )}
      </div>
    </div>
  );
}
