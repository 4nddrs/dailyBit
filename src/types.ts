import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'dev' | 'lead';

export interface UserProfile {
  name: string;
  role: UserRole;
}

export interface UserProfileWithId extends UserProfile {
  id: string;
}

export interface TeamOrder {
  memberOrder: string[];
  updatedAt: Timestamp;
}

export interface Report {
  userId: string;
  date: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Section {
  title: string;
  order: number;
}

export interface TaskLink {
  label?: string;
  url: string;
}

export interface Task {
  description: string;
  links?: TaskLink[];
  order: number;
}

export interface TaskImage {
  imageBase64: string;
  createdAt: Timestamp;
}

export interface TaskImageWithId {
  id: string;
  imageBase64: string;
}

export interface QuestionOptionDetail {
  links: TaskLink[];
}

export interface Question {
  questionText: string;
  options: string[];
  // Parallel to `options` (never a nested array, since Firestore forbids
  // those): optionDetails[i].links are the links attached to options[i].
  // Only written when at least one option actually has a link.
  optionDetails?: QuestionOptionDetail[];
  selectedAnswer?: number;
  answeredBy?: string;
  answeredAt?: Timestamp;
  // When set, the question is anchored inside that section and interleaved
  // with its tasks by `order` (tasks and questions share one order space per
  // section). Omitted (or empty) means a report-level question, shown in the
  // trailing "Questions to the lead" panel instead.
  sectionId?: string;
  order?: number;
}

// Doc shape for `questions/{questionId}/images/{imageId}`: one image per
// doc, tagged with the option it belongs to (mirrors TaskImage plus the
// option index).
export interface QuestionOptionImage {
  imageBase64: string;
  optionIndex: number;
  createdAt: Timestamp;
}

export interface LeadNote {
  noteText: string;
  targetTaskId: string;
  createdAt: Timestamp;
}

export type LeadQuestionKind = 'text' | 'options';

export interface LeadQuestion {
  taskId: string;
  sectionId: string;
  questionText: string;
  kind: LeadQuestionKind;
  options?: string[];
  answerText?: string;
  answerLinks?: TaskLink[];
  selectedAnswer?: number;
  answeredAt?: Timestamp;
  createdAt: Timestamp;
}

export type UserProfileData = UserProfile;
export type ReportData = Report;
export type SectionData = Section;
export type TaskData = Task;
export type TaskLinkData = TaskLink;
export type QuestionData = Question;
export type LeadNoteData = LeadNote;
export type LeadQuestionData = LeadQuestion;

export interface TaskWithId extends Task {
  id: string;
  images: TaskImageWithId[];
}

export interface SectionWithTasks extends Section {
  id: string;
  tasks: TaskWithId[];
  // Dev questions anchored to this section (`Question.sectionId` matches),
  // sorted by `order`. Report-level questions (no `sectionId`) live on
  // `ReportTree.questions` instead.
  questions: QuestionWithId[];
}

export interface QuestionWithId extends Question {
  id: string;
  optionImages: Array<TaskImageWithId & { optionIndex: number }>;
}

export interface LeadNoteWithId extends LeadNote {
  id: string;
}

export interface LeadQuestionWithId extends LeadQuestion {
  id: string;
  answerImages: TaskImageWithId[];
}

// Top-level pointer at `leadQuestionCarryovers/{reportId}_{questionId}`, one
// per lead question (report-level or task-anchored), so an unanswered
// question keeps showing on later days without re-querying every past
// report (mirrors how `Assignment` makes a lead task visible across dates
// independent of `reports`). `date` is the origin report's date;
// `answeredDate` is a best-effort mirror of the question's real
// `answeredAt`, used only as a cheap prefilter (see
// `shouldSubscribeToLeadQuestionCarryoverPointer` in firestore.ts — real
// visibility is decided from the question doc itself).
export interface LeadQuestionCarryoverPointer {
  userId: string;
  reportId: string;
  questionId: string;
  date: string;
  answeredDate?: string;
  createdAt: Timestamp;
}

export interface LeadQuestionCarryoverPointerWithId extends LeadQuestionCarryoverPointer {
  id: string;
}

// A lead question (report-level or task-anchored) carried over from an
// earlier day: the origin question's full data (same shape
// `LeadQuestionWithId` has) plus where it came from, so callers can target
// the origin report for every action (answer, edit, delete, images) instead
// of the day currently being viewed.
export interface CarriedLeadQuestion extends LeadQuestionWithId {
  userId: string;
  originReportId: string;
  originDate: string;
  // The origin task's description, for a task-anchored question (unset for
  // a report-level one, or if the task was since deleted).
  originTaskDescription?: string;
}

export interface ReportTree extends Report {
  id: string;
  sections: SectionWithTasks[];
  // Report-level dev questions only (no `sectionId`); a section's own
  // questions live on that `SectionWithTasks.questions` instead.
  questions?: QuestionWithId[];
  notes?: LeadNoteWithId[];
  leadQuestions?: LeadQuestionWithId[];
}

export interface ReportSummary extends Report {
  id: string;
}

export type AssignmentStatus = 'open' | 'closed';

export interface Assignment {
  description: string;
  assigneeIds: string[];
  createdBy: string;
  startDate: string;
  status: AssignmentStatus;
  closedDate?: string;
  relatedTask?: { description: string };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AssignmentWithId extends Assignment {
  id: string;
}

export interface AssignmentUpdate {
  assigneeId: string;
  date: string;
  text?: string;
  links: TaskLink[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AssignmentUpdateWithImages extends AssignmentUpdate {
  id: string;
  images: TaskImageWithId[];
}

export function todayDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}
