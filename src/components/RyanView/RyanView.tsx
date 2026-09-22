import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  addRyanNote,
  addTeamQuestion,
  answerQuestion,
  getUserProfile,
  removeRyanNote,
  subscribeTeamQuestions,
} from '../../services/firestore';
import { useReportsByDate } from '../../hooks/useReportsByDate';
import { useUserProfiles } from '../../hooks/useUserProfiles';
import type {
  QuestionWithId,
  ReportTree,
  RyanNoteWithId,
  SectionWithTasks,
  TaskLink,
  TaskWithId,
  TeamQuestion,
} from '../../types';
import { todayDateString } from '../../types';

const optionLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
const QUESTION_OPTION_MINIMUM = 2;
const QUESTION_OPTION_LIMIT = 6;

interface RyanViewProps {
  leadUserId: string;
}

type TeamQuestionWithId = TeamQuestion & { id: string };

function formatDisplayDate(dateString: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${dateString}T00:00:00`));
}

function getOptionLabel(index: number): string {
  return optionLabels[index] ?? String(index + 1);
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-5 py-8 text-center">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

function RyanHeader({
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
    <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">RyanView</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            {formatDisplayDate(date)}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {reportedCount} of {totalDeveloperCount} developers reported
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="text-sm font-medium text-slate-700">
            Report date
            <input
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 sm:w-44"
              type="date"
              value={date}
              onChange={(event) => onDateChange(event.target.value)}
            />
          </label>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
            Live
          </div>
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
          className="max-w-full truncate rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
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

function RyanNoteBlock({
  notes,
  onRemove,
}: {
  notes: RyanNoteWithId[];
  onRemove: (noteId: string) => void;
}) {
  if (notes.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      {notes.map((note) => (
        <div
          className="flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-950"
          key={note.id}
        >
          <p className="border-l-4 border-amber-400 pl-3 leading-6">{note.noteText}</p>
          <button
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 hover:text-rose-700"
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
      console.error('Ryan note failed', caughtError);
      setError('Note could not be saved. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/50 p-3" onSubmit={handleSubmit}>
      <label className="block text-xs font-semibold uppercase tracking-wide text-amber-700">
        {label}
        <textarea
          className="mt-2 min-h-20 w-full resize-y rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm normal-case tracking-normal text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
          value={noteText}
          onChange={(event) => setNoteText(event.target.value)}
          placeholder="Add a private Ryan note"
        />
      </label>
      {error ? <p className="mt-2 text-xs font-medium text-rose-600">{error}</p> : null}
      <div className="mt-2 flex justify-end">
        <button
          className="rounded-xl bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
          disabled={!noteText.trim() || submitting}
        >
          {submitting ? 'Saving...' : 'Add note'}
        </button>
      </div>
    </form>
  );
}

function TaskCard({
  reportId,
  task,
  notes,
  onAddNote,
  onRemoveNote,
}: {
  reportId: string;
  task: TaskWithId;
  notes: RyanNoteWithId[];
  onAddNote: (targetTaskId: string, noteText: string) => Promise<void>;
  onRemoveNote: (noteId: string) => void;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-4 md:grid-cols-[7rem_1fr]">
        {task.imageUrl ? (
          <a href={task.imageUrl} rel="noreferrer" target="_blank" aria-label="Open task image">
            <img
              className="h-24 w-full rounded-xl border border-slate-200 object-cover transition hover:opacity-90"
              src={task.imageUrl}
              alt="Task attachment thumbnail"
            />
          </a>
        ) : (
          <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
            No image
          </div>
        )}

        <div className="min-w-0">
          <p className="text-sm font-medium leading-6 text-slate-950">{task.description}</p>
          <LinkChips links={task.links} />
        </div>
      </div>

      <RyanNoteBlock notes={notes} onRemove={onRemoveNote} />
      <NoteComposer label="Ryan task note" onAdd={(noteText) => onAddNote(task.id, noteText)} />
      <span className="sr-only">Report {reportId}</span>
    </article>
  );
}

function SectionCard({
  reportId,
  section,
  notesByTarget,
  onAddNote,
  onRemoveNote,
}: {
  reportId: string;
  section: SectionWithTasks;
  notesByTarget: Map<string, RyanNoteWithId[]>;
  onAddNote: (targetTaskId: string, noteText: string) => Promise<void>;
  onRemoveNote: (noteId: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <h3 className="text-base font-semibold text-slate-950">{section.title}</h3>
      <div className="mt-4 space-y-3">
        {section.tasks.length > 0 ? (
          section.tasks.map((task) => (
            <TaskCard
              key={task.id}
              reportId={reportId}
              task={task}
              notes={notesByTarget.get(task.id) ?? []}
              onAddNote={onAddNote}
              onRemoveNote={onRemoveNote}
            />
          ))
        ) : (
          <EmptyState title="No tasks in this section" description="The developer has not added task details here yet." />
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

  async function handleAnswer(optionIndex: number) {
    setSubmittingIndex(optionIndex);
    try {
      await answerQuestion(reportId, question.id, optionIndex, leadUserId);
    } finally {
      setSubmittingIndex(null);
    }
  }

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold leading-6 text-slate-950">{question.questionText}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {question.options.map((option, index) => {
          const selected = question.selectedAnswer === index;
          return (
            <button
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
                selected
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700'
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
  const notes = report.notes ?? [];
  const notesByTarget = useMemo(() => {
    const groupedNotes = new Map<string, RyanNoteWithId[]>();
    notes.forEach((note) => {
      groupedNotes.set(note.targetTaskId, [...(groupedNotes.get(note.targetTaskId) ?? []), note]);
    });
    return groupedNotes;
  }, [notes]);

  async function handleAddNote(targetTaskId: string, noteText: string) {
    await addRyanNote(report.id, { targetTaskId, noteText });
  }

  function handleRemoveNote(noteId: string) {
    void removeRyanNote(report.id, noteId);
  }

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">{developerName}</h2>
          <p className="mt-1 text-sm text-slate-500">{report.sections.length} sections · {report.questions?.length ?? 0} questions</p>
        </div>
        <span className="w-fit rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
          {report.userId}
        </span>
      </div>

      <div className="mt-4">
        <RyanNoteBlock notes={notesByTarget.get('') ?? []} onRemove={handleRemoveNote} />
        <NoteComposer label="Ryan report note" onAdd={(noteText) => handleAddNote('', noteText)} />
      </div>

      <div className="mt-5 space-y-4">
        {report.sections.length > 0 ? (
          report.sections.map((section) => (
            <SectionCard
              key={section.id}
              reportId={report.id}
              section={section}
              notesByTarget={notesByTarget}
              onAddNote={handleAddNote}
              onRemoveNote={handleRemoveNote}
            />
          ))
        ) : (
          <EmptyState title="No sections yet" description="This report exists, but the developer has not added sections." />
        )}
      </div>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
        <h3 className="text-base font-semibold text-slate-950">Questions from {developerName}</h3>
        <div className="mt-4 space-y-3">
          {report.questions && report.questions.length > 0 ? (
            report.questions.map((question) => (
              <QuestionCard key={question.id} reportId={report.id} question={question} leadUserId={leadUserId} />
            ))
          ) : (
            <EmptyState title="No questions" description="There are no decisions waiting on this report." />
          )}
        </div>
      </section>
    </article>
  );
}

function AskTeamComposer() {
  const [questionText, setQuestionText] = useState('');
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = questionText.trim();
    const trimmedOptions = options.map((option) => option.trim()).filter(Boolean);

    if (!trimmedQuestion || trimmedOptions.length < QUESTION_OPTION_MINIMUM) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await addTeamQuestion({ questionText: trimmedQuestion, options: trimmedOptions });
      setQuestionText('');
      setOptions(['', '']);
    } catch (caughtError) {
      console.error('Team question failed', caughtError);
      setError('Question could not be posted. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={handleSubmit}>
      <div>
        <h2 className="text-xl font-semibold text-slate-950">Ask the team</h2>
        <p className="mt-1 text-sm text-slate-500">Post a multiple-choice question for quick team input.</p>
      </div>

      <label className="mt-5 block text-sm font-medium text-slate-700">
        Question
        <input
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          value={questionText}
          onChange={(event) => setQuestionText(event.target.value)}
          placeholder="What should the team decide?"
        />
      </label>

      <div className="mt-4 space-y-2">
        {options.map((option, index) => (
          <div className="flex items-center gap-2" key={index}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-50 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
              {getOptionLabel(index)}
            </span>
            <input
              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              value={option}
              onChange={(event) => updateOption(index, event.target.value)}
              placeholder={`Option ${getOptionLabel(index)}`}
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

      {error ? <p className="mt-3 text-sm font-medium text-rose-600">{error}</p> : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-between">
        <button
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={options.length >= QUESTION_OPTION_LIMIT}
          onClick={() => setOptions((currentOptions) => [...currentOptions, ''])}
        >
          Add option
        </button>
        <button
          className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
          disabled={submitting || !questionText.trim() || options.filter((option) => option.trim()).length < QUESTION_OPTION_MINIMUM}
        >
          {submitting ? 'Posting...' : 'Post question'}
        </button>
      </div>
    </form>
  );
}

function TeamQuestionsPanel() {
  const [teamQuestions, setTeamQuestions] = useState<TeamQuestionWithId[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeTeamQuestions((questions) => {
      setTeamQuestions(questions);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-semibold text-slate-950">Team questions</h2>
        <p className="mt-1 text-sm text-slate-500">Selection counts update as developers answer.</p>
      </div>

      <div className="mt-5 space-y-3">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            Loading team questions...
          </div>
        ) : teamQuestions.length > 0 ? (
          teamQuestions.map((question) => <TeamQuestionCard key={question.id} question={question} />)
        ) : (
          <EmptyState title="No team questions" description="Ask the team a focused question when you need a quick signal." />
        )}
      </div>
    </section>
  );
}

function TeamQuestionCard({ question }: { question: TeamQuestionWithId }) {
  const selectedAnswers = question.selectedAnswers ?? {};
  const selectedAnswerValues = Object.values(selectedAnswers);
  const totalSelections = selectedAnswerValues.length;

  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-sm font-semibold leading-6 text-slate-950">{question.questionText}</p>
        <span className="w-fit rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
          {totalSelections} selections
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {question.options.map((option, index) => {
          const count = selectedAnswerValues.filter((answerIndex) => answerIndex === index).length;
          return (
            <div
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              key={`${option}-${index}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{getOptionLabel(index)}. {option}</span>
                <span className="text-xs font-semibold text-slate-500">{count}</span>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export function RyanView({ leadUserId }: RyanViewProps) {
  const [selectedDate, setSelectedDate] = useState(() => todayDateString());
  const { reportTrees, loading } = useReportsByDate(selectedDate);
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
      getUserProfile(userId).then((profile) => {
        if (!cancelled) {
          setDeveloperNames((currentNames) => ({
            ...currentNames,
            [userId]: profile?.name ?? userId,
          }));
        }
      });
    });

    return () => {
      cancelled = true;
    };
  }, [developerNames, reportTrees]);

  return (
    <div className="space-y-6">
      <RyanHeader
        date={selectedDate}
        onDateChange={setSelectedDate}
        reportedCount={reportTrees.length}
        totalDeveloperCount={totalDeveloperCount}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="space-y-4">
          {loading ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
              Loading reports...
            </div>
          ) : reportTrees.length > 0 ? (
            reportTrees.map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                developerName={developerNames[report.userId] ?? report.userId}
                leadUserId={leadUserId}
              />
            ))
          ) : (
            <EmptyState
              title="No reports yet today"
              description="Reports will appear here live after developers start their daily updates. Try a different date if you are reviewing past work."
            />
          )}
        </section>

        <aside className="space-y-6">
          <AskTeamComposer />
          <TeamQuestionsPanel />
        </aside>
      </div>
    </div>
  );
}
