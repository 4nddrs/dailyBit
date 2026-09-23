import { useEffect, useMemo, useState } from 'react';
import { subscribeAssignmentUpdate } from '../../services/firestore';
import { ImageLightbox } from '../ImageLightbox';
import { AssignmentUpdateDisplay, LeadNoteBlock, LeadQuestionBlock, LinkChips } from '../LeadView/LeadView';
import { taskLetter } from '../../utils/numbering';
import type {
  AssignmentUpdateWithImages,
  AssignmentWithId,
  LeadNoteWithId,
  LeadQuestionWithId,
  QuestionWithId,
  ReportTree,
  SectionWithTasks,
  TaskImageWithId,
  TaskWithId,
} from '../../types';

const optionLabels = ['A', 'B', 'C', 'D', 'E', 'F'];

function getOptionLabel(index: number): string {
  return optionLabels[index] ?? String(index + 1);
}

// Read-only image grid + lightbox for a task's attachments, matching the
// layout Lead View uses for the same content.
function PreviewTaskImages({ images }: { images: TaskImageWithId[] }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (images.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {images.map((image, imageIndex) => (
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

function PreviewTaskCard({
  task,
  letter,
  notes,
  questions,
}: {
  task: TaskWithId;
  letter: string;
  notes: LeadNoteWithId[];
  questions: LeadQuestionWithId[];
}) {
  return (
    <article className="px-4 py-3">
      <div className={`grid gap-3 ${task.images.length > 0 ? 'md:grid-cols-[7rem_1fr]' : ''}`}>
        {task.images.length > 0 ? <PreviewTaskImages images={task.images} /> : null}
        <div className="min-w-0">
          <p className="text-sm font-medium leading-6 text-fg">
            <span className="mr-1.5 font-semibold text-fg-muted tabular-nums">{letter}.</span>
            {task.description}
          </p>
          <LinkChips links={task.links} />
        </div>
      </div>

      <LeadQuestionBlock questions={questions} />
      <LeadNoteBlock notes={notes} />
    </article>
  );
}

function PreviewSectionCard({
  section,
  number,
  notesByTask,
  questionsByTask,
}: {
  section: SectionWithTasks;
  number: number;
  notesByTask: Map<string, LeadNoteWithId[]>;
  questionsByTask: Map<string, LeadQuestionWithId[]>;
}) {
  const sortedTasks = useMemo(() => [...section.tasks].sort((a, b) => a.order - b.order), [section.tasks]);

  return (
    <section className="rounded-md border border-line bg-canvas shadow-sm">
      <div className="rounded-t-md border-b border-line bg-canvas-subtle px-4 py-3">
        <h3 className="text-lg font-semibold text-fg">
          <span className="mr-1.5 text-fg-muted tabular-nums">{number}.</span>
          {section.title}
        </h3>
      </div>
      <div className="divide-y divide-line">
        {sortedTasks.length > 0 ? (
          sortedTasks.map((task, taskIndex) => (
            <PreviewTaskCard
              key={task.id}
              task={task}
              letter={taskLetter(taskIndex)}
              notes={notesByTask.get(task.id) ?? []}
              questions={questionsByTask.get(task.id) ?? []}
            />
          ))
        ) : (
          <p className="px-4 py-2 text-sm text-fg-muted">No tasks in this section.</p>
        )}
      </div>
    </section>
  );
}

// Dev-created multiple-choice question, shown with the lead's answer once
// available. Mirrors Developer View's own read display of the same data.
function PreviewDevQuestionCard({ question }: { question: QuestionWithId }) {
  const isAnswered = question.selectedAnswer !== undefined;

  return (
    <article className="rounded-md border-l-2 border-done-emphasis bg-canvas-subtle p-3">
      <p className="text-sm font-semibold leading-6 text-fg">{question.questionText}</p>
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
            {getOptionLabel(index)}. {option}
          </span>
        ))}
      </div>
      {!isAnswered ? (
        <p className="mt-2 text-xs font-semibold text-attention-fg">Pending the lead’s answer</p>
      ) : null}
    </article>
  );
}

// Subscribes to this developer's own update for one assignment/date, the
// same way Developer View's editable AssignmentRow does, but renders it
// read-only via the shared AssignmentUpdateDisplay.
function PreviewAssignmentRow({
  assignment,
  developerId,
  date,
}: {
  assignment: AssignmentWithId;
  developerId: string;
  date: string;
}) {
  const [update, setUpdate] = useState<AssignmentUpdateWithImages | null>(null);

  useEffect(() => {
    setUpdate(null);
    const unsubscribe = subscribeAssignmentUpdate(assignment.id, developerId, date, setUpdate);
    return unsubscribe;
  }, [assignment.id, developerId, date]);

  return (
    <div className="border-l-2 border-accent-emphasis px-4 py-3">
      <p className="text-sm font-medium text-fg">{assignment.description}</p>
      <p className="mt-1 text-xs text-fg-muted">Assigned {assignment.startDate}</p>
      {assignment.relatedTask ? (
        <p className="mt-1 truncate text-xs text-fg-muted">About: {assignment.relatedTask.description}</p>
      ) : null}
      <div className="mt-3">
        <AssignmentUpdateDisplay update={update} />
      </div>
    </div>
  );
}

function PreviewAssignmentsBox({
  assignments,
  developerId,
  date,
}: {
  assignments: AssignmentWithId[];
  developerId: string;
  date: string;
}) {
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
          <PreviewAssignmentRow key={assignment.id} assignment={assignment} developerId={developerId} date={date} />
        ))}
      </div>
    </section>
  );
}

export interface ReportPreviewProps {
  reportTree: ReportTree | null;
  developerId: string;
  date: string;
  assignments: AssignmentWithId[];
}

// Read-only rendering of a developer's own report, exactly as the lead sees
// it: numbered sections, lettered tasks, link chips, image thumbnails with a
// lightbox, lead notes/questions with answers, dev questions with the lead's
// answer, and assignments with this developer's update for the date.
export function ReportPreview({ reportTree, developerId, date, assignments }: ReportPreviewProps) {
  const sections = useMemo(
    () => [...(reportTree?.sections ?? [])].sort((a, b) => a.order - b.order),
    [reportTree?.sections],
  );
  const notes = reportTree?.notes ?? [];
  const leadQuestions = reportTree?.leadQuestions ?? [];
  const devQuestions = reportTree?.questions ?? [];

  const notesByTask = useMemo(() => {
    const grouped = new Map<string, LeadNoteWithId[]>();
    notes.forEach((note) => {
      grouped.set(note.targetTaskId, [...(grouped.get(note.targetTaskId) ?? []), note]);
    });
    return grouped;
  }, [notes]);

  const questionsByTask = useMemo(() => {
    const grouped = new Map<string, LeadQuestionWithId[]>();
    leadQuestions.forEach((question) => {
      grouped.set(question.taskId, [...(grouped.get(question.taskId) ?? []), question]);
    });
    return grouped;
  }, [leadQuestions]);

  const reportLevelNotes = notesByTask.get('') ?? [];
  const reportLevelQuestions = questionsByTask.get('') ?? [];

  const isEmpty =
    sections.length === 0 &&
    reportLevelNotes.length === 0 &&
    reportLevelQuestions.length === 0 &&
    devQuestions.length === 0 &&
    assignments.length === 0;

  if (isEmpty) {
    return <p className="px-4 py-6 text-sm text-fg-muted">Nothing reported for this date yet.</p>;
  }

  return (
    <div className="space-y-6">
      {assignments.length > 0 ? (
        <PreviewAssignmentsBox assignments={assignments} developerId={developerId} date={date} />
      ) : null}

      {reportLevelNotes.length > 0 || reportLevelQuestions.length > 0 ? (
        <section className="rounded-md border border-line bg-canvas shadow-sm">
          <div className="rounded-t-md border-b border-line bg-canvas-subtle px-4 py-3">
            <h2 className="text-lg font-semibold text-fg">From the lead</h2>
          </div>
          <div className="p-4">
            <LeadNoteBlock notes={reportLevelNotes} />
            <LeadQuestionBlock questions={reportLevelQuestions} />
          </div>
        </section>
      ) : null}

      {sections.length > 0 ? (
        <section>
          <h2 className="text-2xl font-semibold text-fg">Today’s work</h2>
          <div className="mt-4 space-y-6">
            {sections.map((section, sectionIndex) => (
              <PreviewSectionCard
                key={section.id}
                section={section}
                number={sectionIndex + 1}
                notesByTask={notesByTask}
                questionsByTask={questionsByTask}
              />
            ))}
          </div>
        </section>
      ) : null}

      {devQuestions.length > 0 ? (
        <section className="rounded-md border border-line bg-canvas shadow-sm">
          <div className="flex items-center gap-2 rounded-t-md border-b border-line bg-canvas-subtle px-4 py-3">
            <h2 className="text-lg font-semibold text-fg">Questions to the lead</h2>
          </div>
          <div className="space-y-3 p-4">
            {devQuestions.map((question) => (
              <PreviewDevQuestionCard key={question.id} question={question} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
