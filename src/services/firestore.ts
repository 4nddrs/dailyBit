import {
  FieldPath,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type FirestoreError,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  Question,
  QuestionWithId,
  Report,
  ReportSummary,
  ReportTree,
  RyanNote,
  RyanNoteWithId,
  Section,
  SectionWithTasks,
  Task,
  TaskWithId,
  TeamQuestion,
  UserProfile,
  UserRole,
} from '../types';

export type CreateQuestionInput = Pick<Question, 'questionText' | 'options'>;
export type CreateRyanNoteInput = Pick<RyanNote, 'noteText' | 'targetTaskId'>;
export type CreateTeamQuestionInput = Pick<TeamQuestion, 'questionText' | 'options'>;

const collections = {
  users: 'users',
  reports: 'reports',
  sections: 'sections',
  tasks: 'tasks',
  questions: 'questions',
  ryanNotes: 'ryanNotes',
  teamQuestions: 'teamQuestions',
} as const;

function reportDocId(userId: string, date: string): string {
  return `${userId}_${date}`;
}

function userDoc(uid: string) {
  return doc(db, collections.users, uid);
}

function reportDoc(reportId: string) {
  return doc(db, collections.reports, reportId);
}

function sectionsCollection(reportId: string) {
  return collection(reportDoc(reportId), collections.sections);
}

function sectionDoc(reportId: string, sectionId: string) {
  return doc(sectionsCollection(reportId), sectionId);
}

function tasksCollection(reportId: string, sectionId: string) {
  return collection(sectionDoc(reportId, sectionId), collections.tasks);
}

function taskDoc(reportId: string, sectionId: string, taskId: string) {
  return doc(tasksCollection(reportId, sectionId), taskId);
}

function questionsCollection(reportId: string) {
  return collection(reportDoc(reportId), collections.questions);
}

function questionDoc(reportId: string, questionId: string) {
  return doc(questionsCollection(reportId), questionId);
}

function ryanNotesCollection(reportId: string) {
  return collection(reportDoc(reportId), collections.ryanNotes);
}

function ryanNoteDoc(reportId: string, noteId: string) {
  return doc(ryanNotesCollection(reportId), noteId);
}

function teamQuestionsCollection() {
  return collection(db, collections.teamQuestions);
}

function teamQuestionDoc(questionId: string) {
  return doc(teamQuestionsCollection(), questionId);
}

function toReportSummary(id: string, data: Report): ReportSummary {
  return { id, ...data };
}

export async function ensureUserDoc(
  uid: string,
  name: string,
  role: UserRole = 'dev',
): Promise<void> {
  const ref = userDoc(uid);
  const snapshot = await getDoc(ref);

  if (!snapshot.exists()) {
    await setDoc(ref, { name, role } satisfies UserProfile);
  }
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await getDoc(userDoc(uid));
  return snapshot.exists() ? (snapshot.data() as UserProfile) : null;
}

export function subscribeUserProfile(
  uid: string,
  callback: (profile: UserProfile | null) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(
    userDoc(uid),
    (snapshot) => {
      callback(snapshot.exists() ? (snapshot.data() as UserProfile) : null);
    },
    onError,
  );
}

export function subscribeUserProfiles(
  callback: (profiles: UserProfile[]) => void,
): Unsubscribe {
  return onSnapshot(collection(db, collections.users), (snapshot) => {
    callback(snapshot.docs.map((userSnapshot) => userSnapshot.data() as UserProfile));
  });
}

export async function getOrCreateTodayReport(
  userId: string,
  date: string,
): Promise<ReportSummary> {
  const id = reportDocId(userId, date);
  const ref = reportDoc(id);
  const existing = await getDoc(ref);

  if (existing.exists()) {
    return toReportSummary(existing.id, existing.data() as Report);
  }

  await setDoc(ref, {
    userId,
    date,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const created = await getDoc(ref);
  return toReportSummary(created.id, created.data() as Report);
}

export function subscribeReport(
  reportId: string,
  callback: (report: ReportTree | null) => void,
): Unsubscribe {
  let report: Report | null = null;
  const sections = new Map<string, Section>();
  const tasks = new Map<string, TaskWithId[]>();
  const questions: QuestionWithId[] = [];
  const notes: RyanNoteWithId[] = [];
  const taskUnsubscribes = new Map<string, Unsubscribe>();

  const emit = () => {
    if (!report) {
      callback(null);
      return;
    }

    const sectionTrees: SectionWithTasks[] = Array.from(sections.entries())
      .map(([id, section]) => ({
        id,
        ...section,
        tasks: [...(tasks.get(id) ?? [])].sort((a, b) => a.order - b.order),
      }))
      .sort((a, b) => a.order - b.order);

    callback({
      id: reportId,
      ...report,
      sections: sectionTrees,
      questions: [...questions],
      notes: [...notes],
    });
  };

  const reportUnsubscribe = onSnapshot(reportDoc(reportId), (snapshot) => {
    report = snapshot.exists() ? (snapshot.data() as Report) : null;
    emit();
  });

  const sectionsQuery = query(sectionsCollection(reportId), orderBy('order', 'asc'));
  const sectionsUnsubscribe = onSnapshot(sectionsQuery, (snapshot) => {
    const nextSectionIds = new Set<string>();

    snapshot.docs.forEach((sectionSnapshot) => {
      const sectionId = sectionSnapshot.id;
      nextSectionIds.add(sectionId);
      sections.set(sectionId, sectionSnapshot.data() as Section);

      if (!taskUnsubscribes.has(sectionId)) {
        const tasksQuery = query(tasksCollection(reportId, sectionId), orderBy('order', 'asc'));
        const unsubscribeTasks = onSnapshot(tasksQuery, (taskSnapshot) => {
          tasks.set(
            sectionId,
            taskSnapshot.docs.map((taskDocument) => ({
              id: taskDocument.id,
              ...(taskDocument.data() as Task),
            })),
          );
          emit();
        });

        taskUnsubscribes.set(sectionId, unsubscribeTasks);
      }
    });

    Array.from(sections.keys()).forEach((sectionId) => {
      if (!nextSectionIds.has(sectionId)) {
        sections.delete(sectionId);
        tasks.delete(sectionId);
        taskUnsubscribes.get(sectionId)?.();
        taskUnsubscribes.delete(sectionId);
      }
    });

    emit();
  });

  const questionsUnsubscribe = onSnapshot(questionsCollection(reportId), (snapshot) => {
    questions.length = 0;
    snapshot.docs.forEach((questionSnapshot) => {
      questions.push({
        id: questionSnapshot.id,
        ...(questionSnapshot.data() as Question),
      });
    });
    emit();
  });

  const notesUnsubscribe = onSnapshot(ryanNotesCollection(reportId), (snapshot) => {
    notes.length = 0;
    snapshot.docs.forEach((noteSnapshot) => {
      notes.push({
        id: noteSnapshot.id,
        ...(noteSnapshot.data() as RyanNote),
      });
    });
    emit();
  });

  return () => {
    reportUnsubscribe();
    sectionsUnsubscribe();
    questionsUnsubscribe();
    notesUnsubscribe();
    taskUnsubscribes.forEach((unsubscribe) => unsubscribe());
  };
}

export async function addSection(reportId: string, section: Section): Promise<string> {
  await updateDoc(reportDoc(reportId), { updatedAt: serverTimestamp() });
  const ref = await addDoc(sectionsCollection(reportId), section);
  return ref.id;
}

export async function renameSection(
  reportId: string,
  sectionId: string,
  title: string,
): Promise<void> {
  await updateDoc(sectionDoc(reportId, sectionId), { title });
  await updateDoc(reportDoc(reportId), { updatedAt: serverTimestamp() });
}

export async function removeSection(reportId: string, sectionId: string): Promise<void> {
  const taskSnapshots = await getDocs(tasksCollection(reportId, sectionId));
  const batch = writeBatch(db);

  taskSnapshots.docs.forEach((taskSnapshot) => batch.delete(taskSnapshot.ref));
  batch.delete(sectionDoc(reportId, sectionId));
  batch.update(reportDoc(reportId), { updatedAt: serverTimestamp() });

  await batch.commit();
}

export async function addTask(
  reportId: string,
  sectionId: string,
  task: Task,
): Promise<string> {
  await updateDoc(reportDoc(reportId), { updatedAt: serverTimestamp() });
  const ref = await addDoc(tasksCollection(reportId, sectionId), task);
  return ref.id;
}

export async function updateTask(
  reportId: string,
  sectionId: string,
  taskId: string,
  updates: Partial<Task>,
): Promise<void> {
  await updateDoc(taskDoc(reportId, sectionId, taskId), updates);
  await updateDoc(reportDoc(reportId), { updatedAt: serverTimestamp() });
}

export async function removeTask(
  reportId: string,
  sectionId: string,
  taskId: string,
): Promise<void> {
  await deleteDoc(taskDoc(reportId, sectionId, taskId));
  await updateDoc(reportDoc(reportId), { updatedAt: serverTimestamp() });
}

export async function addQuestion(
  reportId: string,
  question: CreateQuestionInput,
): Promise<string> {
  const ref = await addDoc(questionsCollection(reportId), question);
  await updateDoc(reportDoc(reportId), { updatedAt: serverTimestamp() });
  return ref.id;
}

export function removeQuestion(reportId: string, questionId: string): Promise<void> {
  return deleteDoc(questionDoc(reportId, questionId));
}

export async function answerQuestion(
  reportId: string,
  questionId: string,
  optionIndex: number,
  answeredBy: string,
): Promise<void> {
  await updateDoc(questionDoc(reportId, questionId), {
    selectedAnswer: optionIndex,
    answeredBy,
    answeredAt: serverTimestamp(),
  });
}

export async function addRyanNote(
  reportId: string,
  note: CreateRyanNoteInput,
): Promise<string> {
  const ref = await addDoc(ryanNotesCollection(reportId), {
    ...note,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export function removeRyanNote(reportId: string, noteId: string): Promise<void> {
  return deleteDoc(ryanNoteDoc(reportId, noteId));
}

export async function addTeamQuestion(question: CreateTeamQuestionInput): Promise<string> {
  const ref = await addDoc(teamQuestionsCollection(), {
    ...question,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export function subscribeTeamQuestions(
  callback: (questions: Array<TeamQuestion & { id: string }>) => void,
): Unsubscribe {
  const teamQuestionsQuery = query(teamQuestionsCollection(), orderBy('createdAt', 'desc'));
  return onSnapshot(teamQuestionsQuery, (snapshot) => {
    callback(
      snapshot.docs.map((teamQuestion) => ({
        id: teamQuestion.id,
        ...(teamQuestion.data() as TeamQuestion),
      })),
    );
  });
}

export function selectTeamQuestionAnswer(
  questionId: string,
  uid: string,
  optionIndex: number,
): Promise<void> {
  return updateDoc(
    teamQuestionDoc(questionId),
    new FieldPath('selectedAnswers', uid),
    optionIndex,
  );
}

export function subscribeReportsByDate(
  date: string,
  callback: (reports: ReportSummary[]) => void,
): Unsubscribe {
  const reportsQuery = query(collection(db, collections.reports), where('date', '==', date));

  return onSnapshot(reportsQuery, (snapshot) => {
    const reports = snapshot.docs
      .map((reportSnapshot) => toReportSummary(reportSnapshot.id, reportSnapshot.data() as Report))
      .sort((a, b) => a.userId.localeCompare(b.userId));

    callback(reports);
  });
}
