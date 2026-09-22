import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'dev' | 'lead';

export interface UserProfile {
  name: string;
  role: UserRole;
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
  imageUrl?: string;
  links?: TaskLink[];
  order: number;
}

export interface Question {
  questionText: string;
  options: string[];
  selectedAnswer?: number;
  answeredBy?: string;
  answeredAt?: Timestamp;
}

export interface RyanNote {
  noteText: string;
  targetTaskId: string;
  createdAt: Timestamp;
}

export interface TeamQuestion {
  questionText: string;
  options: string[];
  selectedAnswers?: Record<string, number>;
  createdAt: Timestamp;
}

export type UserProfileData = UserProfile;
export type ReportData = Report;
export type SectionData = Section;
export type TaskData = Task;
export type TaskLinkData = TaskLink;
export type QuestionData = Question;
export type RyanNoteData = RyanNote;
export type TeamQuestionData = TeamQuestion;

export interface TaskWithId extends Task {
  id: string;
}

export interface SectionWithTasks extends Section {
  id: string;
  tasks: TaskWithId[];
}

export interface QuestionWithId extends Question {
  id: string;
}

export interface RyanNoteWithId extends RyanNote {
  id: string;
}

export interface ReportTree extends Report {
  id: string;
  sections: SectionWithTasks[];
  questions?: QuestionWithId[];
  notes?: RyanNoteWithId[];
}

export interface ReportSummary extends Report {
  id: string;
}

export function todayDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}
