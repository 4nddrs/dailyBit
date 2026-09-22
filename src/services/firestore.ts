import {
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
  LeadNote,
  LeadNoteWithId,
  LeadQuestion,
  LeadQuestionWithId,
  Question,
  QuestionWithId,
  Report,
  ReportSummary,
  ReportTree,
  Section,
  SectionWithTasks,
  Task,
  TaskImage,
  TaskImageWithId,
  TaskWithId,
  UserProfile,
  UserRole,
} from '../types';

export type CreateQuestionInput = Pick<Question, 'questionText' | 'options'>;
export type CreateLeadNoteInput = Pick<LeadNote, 'noteText' | 'targetTaskId'>;
export type CreateLeadQuestionInput = Pick<
  LeadQuestion,
  'taskId' | 'sectionId' | 'questionText' | 'kind' | 'options'
>;
export type AnswerLeadQuestionInput = { answerText: string } | { selectedAnswer: number };

const collections = {
  users: 'users',
  reports: 'reports',
  sections: 'sections',
  tasks: 'tasks',
  images: 'images',
  questions: 'questions',
  leadNotes: 'leadNotes',
  leadQuestions: 'leadQuestions',
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

function imagesCollection(reportId: string, sectionId: string, taskId: string) {
  return collection(taskDoc(reportId, sectionId, taskId), collections.images);
}

function taskImageDoc(reportId: string, sectionId: string, taskId: string, imageId: string) {
  return doc(imagesCollection(reportId, sectionId, taskId), imageId);
}

function questionsCollection(reportId: string) {
  return collection(reportDoc(reportId), collections.questions);
}

function questionDoc(reportId: string, questionId: string) {
  return doc(questionsCollection(reportId), questionId);
}

function leadNotesCollection(reportId: string) {
  return collection(reportDoc(reportId), collections.leadNotes);
}

function leadNoteDoc(reportId: string, noteId: string) {
  return doc(leadNotesCollection(reportId), noteId);
}

function leadQuestionsCollection(reportId: string) {
  return collection(reportDoc(reportId), collections.leadQuestions);
}

function leadQuestionDoc(reportId: string, questionId: string) {
  return doc(leadQuestionsCollection(reportId), questionId);
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
  const tasks = new Map<string, Array<Task & { id: string }>>();
  const taskImages = new Map<string, TaskImageWithId[]>();
  const questions: QuestionWithId[] = [];
  const notes: LeadNoteWithId[] = [];
  const leadQuestions: LeadQuestionWithId[] = [];
  const taskUnsubscribes = new Map<string, Unsubscribe>();
  const imageUnsubscribes = new Map<string, Unsubscribe>();

  const emit = () => {
    if (!report) {
      callback(null);
      return;
    }

    const sectionTrees: SectionWithTasks[] = Array.from(sections.entries())
      .map(([id, section]) => ({
        id,
        ...section,
        tasks: [...(tasks.get(id) ?? [])]
          .map((task) => ({
            ...task,
            images: [...(taskImages.get(`${id}/${task.id}`) ?? [])],
          }))
          .sort((a, b) => a.order - b.order),
      }))
      .sort((a, b) => a.order - b.order);

    callback({
      id: reportId,
      ...report,
      sections: sectionTrees,
      questions: [...questions],
      notes: [...notes],
      leadQuestions: [...leadQuestions],
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
          const nextTaskKeys = new Set<string>();
          const nextTasks = taskSnapshot.docs.map((taskDocument) => {
            const taskId = taskDocument.id;
            const taskKey = `${sectionId}/${taskId}`;
            nextTaskKeys.add(taskKey);

            if (!imageUnsubscribes.has(taskKey)) {
              const imagesQuery = query(
                imagesCollection(reportId, sectionId, taskId),
                orderBy('createdAt', 'asc'),
              );
              const unsubscribeImages = onSnapshot(imagesQuery, (imageSnapshot) => {
                taskImages.set(
                  taskKey,
                  imageSnapshot.docs.map((imageDocument) => {
                    const image = imageDocument.data() as TaskImage;
                    return {
                      id: imageDocument.id,
                      imageBase64: image.imageBase64,
                    };
                  }),
                );
                emit();
              });

              imageUnsubscribes.set(taskKey, unsubscribeImages);
            }

            return {
              id: taskDocument.id,
              ...(taskDocument.data() as Task),
            };
          });

          tasks.set(sectionId, nextTasks);

          Array.from(imageUnsubscribes.keys()).forEach((taskKey) => {
            if (taskKey.startsWith(`${sectionId}/`) && !nextTaskKeys.has(taskKey)) {
              taskImages.delete(taskKey);
              imageUnsubscribes.get(taskKey)?.();
              imageUnsubscribes.delete(taskKey);
            }
          });

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
        Array.from(imageUnsubscribes.keys()).forEach((taskKey) => {
          if (taskKey.startsWith(`${sectionId}/`)) {
            taskImages.delete(taskKey);
            imageUnsubscribes.get(taskKey)?.();
            imageUnsubscribes.delete(taskKey);
          }
        });
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

  const notesUnsubscribe = onSnapshot(leadNotesCollection(reportId), (snapshot) => {
    notes.length = 0;
    snapshot.docs.forEach((noteSnapshot) => {
      notes.push({
        id: noteSnapshot.id,
        ...(noteSnapshot.data() as LeadNote),
      });
    });
    emit();
  });

  const leadQuestionsUnsubscribe = onSnapshot(leadQuestionsCollection(reportId), (snapshot) => {
    leadQuestions.length = 0;
    snapshot.docs.forEach((leadQuestionSnapshot) => {
      leadQuestions.push({
        id: leadQuestionSnapshot.id,
        ...(leadQuestionSnapshot.data() as LeadQuestion),
      });
    });
    emit();
  });

  return () => {
    reportUnsubscribe();
    sectionsUnsubscribe();
    questionsUnsubscribe();
    notesUnsubscribe();
    leadQuestionsUnsubscribe();
    taskUnsubscribes.forEach((unsubscribe) => unsubscribe());
    imageUnsubscribes.forEach((unsubscribe) => unsubscribe());
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

// Firestore write batches accept at most 500 operations.
const MAX_BATCH_DELETES = 450;

// Firestore never cascades deletes into subcollections, so image docs must be
// removed explicitly. They are deleted before their parent task so a partial
// failure never leaves orphaned images behind an already-deleted task.
async function deleteTaskImages(reportId: string, sectionId: string, taskId: string) {
  const imageSnapshots = await getDocs(imagesCollection(reportId, sectionId, taskId));

  for (let start = 0; start < imageSnapshots.docs.length; start += MAX_BATCH_DELETES) {
    const batch = writeBatch(db);
    imageSnapshots.docs
      .slice(start, start + MAX_BATCH_DELETES)
      .forEach((imageSnapshot) => batch.delete(imageSnapshot.ref));
    await batch.commit();
  }
}

// Firestore never cascades deletes, and leadQuestions/leadNotes live in
// report-level collections rather than under the task, so both are queried
// by their task-reference field and deleted explicitly.
async function deleteTaskLeadArtifacts(reportId: string, taskId: string) {
  const [questionSnapshots, noteSnapshots] = await Promise.all([
    getDocs(query(leadQuestionsCollection(reportId), where('taskId', '==', taskId))),
    getDocs(query(leadNotesCollection(reportId), where('targetTaskId', '==', taskId))),
  ]);
  const docsToDelete = [...questionSnapshots.docs, ...noteSnapshots.docs];

  for (let start = 0; start < docsToDelete.length; start += MAX_BATCH_DELETES) {
    const batch = writeBatch(db);
    docsToDelete
      .slice(start, start + MAX_BATCH_DELETES)
      .forEach((docSnapshot) => batch.delete(docSnapshot.ref));
    await batch.commit();
  }
}

export async function removeSection(reportId: string, sectionId: string): Promise<void> {
  const taskSnapshots = await getDocs(tasksCollection(reportId, sectionId));
  await Promise.all(
    taskSnapshots.docs.map((taskSnapshot) =>
      Promise.all([
        deleteTaskImages(reportId, sectionId, taskSnapshot.id),
        deleteTaskLeadArtifacts(reportId, taskSnapshot.id),
      ]),
    ),
  );
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
  await Promise.all([
    deleteTaskImages(reportId, sectionId, taskId),
    deleteTaskLeadArtifacts(reportId, taskId),
  ]);
  await deleteDoc(taskDoc(reportId, sectionId, taskId));
  await updateDoc(reportDoc(reportId), { updatedAt: serverTimestamp() });
}

export async function addTaskImage(
  reportId: string,
  sectionId: string,
  taskId: string,
  imageBase64: string,
): Promise<string> {
  const ref = await addDoc(imagesCollection(reportId, sectionId, taskId), {
    imageBase64,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export function removeTaskImage(
  reportId: string,
  sectionId: string,
  taskId: string,
  imageId: string,
): Promise<void> {
  return deleteDoc(taskImageDoc(reportId, sectionId, taskId, imageId));
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

export async function addLeadNote(
  reportId: string,
  note: CreateLeadNoteInput,
): Promise<string> {
  const ref = await addDoc(leadNotesCollection(reportId), {
    ...note,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export function removeLeadNote(reportId: string, noteId: string): Promise<void> {
  return deleteDoc(leadNoteDoc(reportId, noteId));
}

export async function addLeadQuestion(
  reportId: string,
  question: CreateLeadQuestionInput,
): Promise<string> {
  const { taskId, sectionId, questionText, kind } = question;
  // Firestore rejects undefined field values, so `options` is only written for
  // options questions instead of being spread through as `options: undefined`.
  const payload: Record<string, unknown> = {
    taskId,
    sectionId,
    questionText,
    kind,
    createdAt: serverTimestamp(),
  };

  if (kind === 'options') {
    const nonEmptyOptions = (question.options ?? []).map((option) => option.trim()).filter(Boolean);
    if (nonEmptyOptions.length < 2) {
      throw new Error('An options question needs at least 2 non-empty options.');
    }
    payload.options = nonEmptyOptions;
  }

  const ref = await addDoc(leadQuestionsCollection(reportId), payload);
  return ref.id;
}

export function removeLeadQuestion(reportId: string, questionId: string): Promise<void> {
  return deleteDoc(leadQuestionDoc(reportId, questionId));
}

export async function answerLeadQuestion(
  reportId: string,
  questionId: string,
  answer: AnswerLeadQuestionInput,
): Promise<void> {
  await updateDoc(leadQuestionDoc(reportId, questionId), {
    ...answer,
    answeredAt: serverTimestamp(),
  });
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
