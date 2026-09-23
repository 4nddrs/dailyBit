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

export interface Question {
  questionText: string;
  options: string[];
  selectedAnswer?: number;
  answeredBy?: string;
  answeredAt?: Timestamp;
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
}

export interface QuestionWithId extends Question {
  id: string;
}

export interface LeadNoteWithId extends LeadNote {
  id: string;
}

export interface LeadQuestionWithId extends LeadQuestion {
  id: string;
}

export interface ReportTree extends Report {
  id: string;
  sections: SectionWithTasks[];
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
