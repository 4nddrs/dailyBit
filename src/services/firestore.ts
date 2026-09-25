import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type FirestoreError,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  Assignment,
  AssignmentUpdate,
  AssignmentUpdateWithImages,
  AssignmentWithId,
  CarriedLeadQuestion,
  LeadNote,
  LeadNoteWithId,
  LeadQuestion,
  LeadQuestionCarryoverPointer,
  LeadQuestionWithId,
  Question,
  QuestionOptionImage,
  QuestionWithId,
  Report,
  ReportSummary,
  ReportTree,
  Section,
  SectionWithTasks,
  Task,
  TaskImage,
  TaskImageWithId,
  TaskLink,
  TaskWithId,
  TeamOrder,
  UserProfile,
  UserProfileWithId,
  UserRole,
} from '../types';
import { todayDateString } from '../types';

// `optionLinks[i]` are the links for `options[i]`, kept parallel by the
// caller (the composer keeps per-option links aligned as options are added,
// removed, and filtered before submit). `sectionId`/`order` are only passed
// for a question added inside a section; a report-level question omits both.
export type CreateQuestionInput = Pick<Question, 'questionText' | 'options'> & {
  optionLinks?: TaskLink[][];
  sectionId?: string;
  order?: number;
};
export type CreateLeadNoteInput = Pick<LeadNote, 'noteText' | 'targetTaskId'>;
export type CreateLeadQuestionInput = Pick<
  LeadQuestion,
  'taskId' | 'sectionId' | 'questionText' | 'kind' | 'options'
>;
// Editing a lead question never moves it to a different task/section, so
// only the text, kind, and options are writable.
export type UpdateLeadQuestionInput = Pick<LeadQuestion, 'questionText' | 'kind' | 'options'>;
export type AnswerLeadQuestionInput =
  | { answerText: string; answerLinks?: TaskLink[] }
  | { selectedAnswer: number };

const collections = {
  users: 'users',
  reports: 'reports',
  sections: 'sections',
  tasks: 'tasks',
  images: 'images',
  questions: 'questions',
  leadNotes: 'leadNotes',
  leadQuestions: 'leadQuestions',
  settings: 'settings',
  assignments: 'assignments',
  updates: 'updates',
  leadQuestionCarryovers: 'leadQuestionCarryovers',
} as const;

export type CreateAssignmentInput = Pick<
  Assignment,
  'description' | 'assigneeIds' | 'createdBy' | 'startDate' | 'relatedTask'
>;
export type SaveAssignmentUpdateInput = { text?: string; links?: TaskLink[] };

const TEAM_SETTINGS_DOC_ID = 'team';

export function reportIdFor(userId: string, date: string): string {
  return `${userId}_${date}`;
}

function userDoc(uid: string) {
  return doc(db, collections.users, uid);
}

function teamSettingsDoc() {
  return doc(db, collections.settings, TEAM_SETTINGS_DOC_ID);
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

function questionImagesCollection(reportId: string, questionId: string) {
  return collection(questionDoc(reportId, questionId), collections.images);
}

function questionImageDoc(reportId: string, questionId: string, imageId: string) {
  return doc(questionImagesCollection(reportId, questionId), imageId);
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

function leadQuestionImagesCollection(reportId: string, questionId: string) {
  return collection(leadQuestionDoc(reportId, questionId), collections.images);
}

function leadQuestionImageDoc(reportId: string, questionId: string, imageId: string) {
  return doc(leadQuestionImagesCollection(reportId, questionId), imageId);
}

function assignmentsCollection() {
  return collection(db, collections.assignments);
}

function assignmentDoc(assignmentId: string) {
  return doc(assignmentsCollection(), assignmentId);
}

function assignmentUpdatesCollection(assignmentId: string) {
  return collection(assignmentDoc(assignmentId), collections.updates);
}

export function assignmentUpdateIdFor(assigneeId: string, date: string): string {
  return `${assigneeId}_${date}`;
}

function assignmentUpdateDocById(assignmentId: string, updateId: string) {
  return doc(assignmentUpdatesCollection(assignmentId), updateId);
}

function assignmentUpdateDoc(assignmentId: string, assigneeId: string, date: string) {
  return assignmentUpdateDocById(assignmentId, assignmentUpdateIdFor(assigneeId, date));
}

function assignmentUpdateImagesCollection(assignmentId: string, updateId: string) {
  return collection(assignmentUpdateDocById(assignmentId, updateId), collections.images);
}

function assignmentUpdateImageDoc(assignmentId: string, updateId: string, imageId: string) {
  return doc(assignmentUpdateImagesCollection(assignmentId, updateId), imageId);
}

function leadQuestionCarryoversCollection() {
  return collection(db, collections.leadQuestionCarryovers);
}

export function leadQuestionCarryoverIdFor(reportId: string, questionId: string): string {
  return `${reportId}_${questionId}`;
}

function leadQuestionCarryoverDoc(reportId: string, questionId: string) {
  return doc(leadQuestionCarryoversCollection(), leadQuestionCarryoverIdFor(reportId, questionId));
}

function toReportSummary(id: string, data: Report): ReportSummary {
  return { id, ...data };
}

// Firestore reads always resolve `Timestamp` fields (never a pending
// server-timestamp sentinel), so this is only used to sort already-fetched
// documents, never as a write-time guard.
function timestampMillis(value: Assignment['createdAt'] | undefined): number {
  return value ? value.toMillis() : 0;
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
  callback: (profiles: UserProfileWithId[]) => void,
): Unsubscribe {
  return onSnapshot(collection(db, collections.users), (snapshot) => {
    callback(
      snapshot.docs.map((userSnapshot) => ({
        id: userSnapshot.id,
        ...(userSnapshot.data() as UserProfile),
      })),
    );
  });
}

export const USER_NAME_MAX_LENGTH = 80;

export async function updateUserName(uid: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('A name is required.');
  }
  if (trimmed.length > USER_NAME_MAX_LENGTH) {
    throw new Error(`Names can be at most ${USER_NAME_MAX_LENGTH} characters.`);
  }
  await updateDoc(userDoc(uid), { name: trimmed });
}

// Missing doc means no order has been saved yet, so callers get an empty
// order and fall back to their own default (e.g. alphabetical by name).
export function subscribeTeamOrder(
  callback: (memberOrder: string[]) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(
    teamSettingsDoc(),
    (snapshot) => {
      const data = snapshot.exists() ? (snapshot.data() as TeamOrder) : null;
      callback(data?.memberOrder ?? []);
    },
    onError,
  );
}

export async function saveTeamOrder(uids: string[]): Promise<void> {
  await setDoc(
    teamSettingsDoc(),
    { memberOrder: uids, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

// Idempotent create-if-missing, reporting whether this call was the one that
// created the doc. Callers that need to clean up after themselves (e.g. the
// Lead tools panel's fan-out, which must not leave an empty report behind
// when the following write fails) use this instead of `ensureReport`; every
// other caller keeps using the plain `ensureReport` below, unchanged.
export async function ensureReportWithStatus(
  userId: string,
  date: string,
): Promise<{ id: string; created: boolean }> {
  const id = reportIdFor(userId, date);
  const ref = reportDoc(id);

  // The existence check and the create run in one transaction, so a report
  // the developer creates at the same moment is never overwritten, and
  // `created` is only true when this call really wrote the doc.
  const created = await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(ref);

    if (existing.exists()) {
      return false;
    }

    transaction.set(ref, {
      userId,
      date,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return true;
  });

  return { id, created };
}

// Only called from a write entry point (the developer actually adding
// content), never just from opening/viewing a date. Viewing a date must
// never create a `reports/{userId}_{date}` doc.
export async function ensureReport(userId: string, date: string): Promise<string> {
  const { id } = await ensureReportWithStatus(userId, date);
  return id;
}

// Best-effort cleanup for a report doc created moments ago by
// `ensureReportWithStatus` in the same operation, when the write that
// followed then failed — never called for a pre-existing report. Every
// developer edit bumps the report's `updatedAt`, while a freshly created doc
// has `updatedAt` equal to `createdAt` (same server timestamp). So the delete
// only happens, inside a transaction, while the doc is still untouched; if
// the developer started using it in the meantime it is kept. Resolves to
// whether the doc was deleted.
export async function removeUntouchedReport(reportId: string): Promise<boolean> {
  const ref = reportDoc(reportId);

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);

    if (!snapshot.exists()) {
      return false;
    }

    const { createdAt, updatedAt } = snapshot.data() as Report;
    const untouched = Boolean(createdAt && updatedAt && createdAt.isEqual(updatedAt));

    if (untouched) {
      transaction.delete(ref);
    }
    return untouched;
  });
}

// Watches only the report document's existence, never its subcollections.
// Firestore rules allow `get` on a missing report for a signed-in user (see
// README's `ownsExistingReport`/get-or-create note), but subcollection rules
// require an existing report, so callers must not subscribe to them while
// `exists` is false.
export function subscribeReportDoc(
  reportId: string,
  callback: (exists: boolean) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(
    reportDoc(reportId),
    (snapshot) => {
      callback(snapshot.exists());
    },
    onError,
  );
}

export function subscribeReport(
  reportId: string,
  callback: (report: ReportTree | null) => void,
): Unsubscribe {
  let report: Report | null = null;
  const sections = new Map<string, Section>();
  const tasks = new Map<string, Array<Task & { id: string }>>();
  const taskImages = new Map<string, TaskImageWithId[]>();
  const questionsBase = new Map<string, Question>();
  const questionImages = new Map<string, Array<TaskImageWithId & { optionIndex: number }>>();
  const questionImageUnsubscribes = new Map<string, Unsubscribe>();
  const notes: LeadNoteWithId[] = [];
  const leadQuestionsBase = new Map<string, LeadQuestion>();
  const leadQuestionImages = new Map<string, TaskImageWithId[]>();
  const leadQuestionImageUnsubscribes = new Map<string, Unsubscribe>();
  const taskUnsubscribes = new Map<string, Unsubscribe>();
  const imageUnsubscribes = new Map<string, Unsubscribe>();

  const emit = () => {
    if (!report) {
      callback(null);
      return;
    }

    const questionTrees: QuestionWithId[] = Array.from(questionsBase.entries()).map(([id, question]) => ({
      id,
      ...question,
      optionImages: [...(questionImages.get(id) ?? [])],
    }));

    // Split dev questions by `sectionId`: section questions are attached to
    // their section below, and only the report-level ones stay on the tree's
    // own `questions` array. A question whose section is missing (e.g. a
    // section delete that only partly finished) falls back to report level
    // so it never silently disappears.
    const sectionQuestions = new Map<string, QuestionWithId[]>();
    const reportLevelQuestions: QuestionWithId[] = [];
    questionTrees.forEach((question) => {
      if (question.sectionId && sections.has(question.sectionId)) {
        sectionQuestions.set(question.sectionId, [...(sectionQuestions.get(question.sectionId) ?? []), question]);
      } else {
        reportLevelQuestions.push(question);
      }
    });

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
        questions: [...(sectionQuestions.get(id) ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      }))
      .sort((a, b) => a.order - b.order);

    const leadQuestionTrees: LeadQuestionWithId[] = Array.from(leadQuestionsBase.entries()).map(
      ([id, leadQuestion]) => ({
        id,
        ...leadQuestion,
        answerImages: [...(leadQuestionImages.get(id) ?? [])],
      }),
    );

    callback({
      id: reportId,
      ...report,
      sections: sectionTrees,
      questions: reportLevelQuestions,
      notes: [...notes],
      leadQuestions: leadQuestionTrees,
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
    const nextQuestionIds = new Set<string>();

    snapshot.docs.forEach((questionSnapshot) => {
      const questionId = questionSnapshot.id;
      nextQuestionIds.add(questionId);
      questionsBase.set(questionId, questionSnapshot.data() as Question);

      if (!questionImageUnsubscribes.has(questionId)) {
        const imagesQuery = query(
          questionImagesCollection(reportId, questionId),
          orderBy('createdAt', 'asc'),
        );
        const unsubscribeImages = onSnapshot(imagesQuery, (imageSnapshot) => {
          questionImages.set(
            questionId,
            imageSnapshot.docs.map((imageDocument) => {
              const image = imageDocument.data() as QuestionOptionImage;
              return {
                id: imageDocument.id,
                imageBase64: image.imageBase64,
                optionIndex: image.optionIndex,
              };
            }),
          );
          emit();
        });
        questionImageUnsubscribes.set(questionId, unsubscribeImages);
      }
    });

    Array.from(questionsBase.keys()).forEach((questionId) => {
      if (!nextQuestionIds.has(questionId)) {
        questionsBase.delete(questionId);
        questionImages.delete(questionId);
        questionImageUnsubscribes.get(questionId)?.();
        questionImageUnsubscribes.delete(questionId);
      }
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
    const nextQuestionIds = new Set<string>();

    snapshot.docs.forEach((leadQuestionSnapshot) => {
      const questionId = leadQuestionSnapshot.id;
      nextQuestionIds.add(questionId);
      leadQuestionsBase.set(questionId, leadQuestionSnapshot.data() as LeadQuestion);

      if (!leadQuestionImageUnsubscribes.has(questionId)) {
        const imagesQuery = query(
          leadQuestionImagesCollection(reportId, questionId),
          orderBy('createdAt', 'asc'),
        );
        const unsubscribeImages = onSnapshot(imagesQuery, (imageSnapshot) => {
          leadQuestionImages.set(
            questionId,
            imageSnapshot.docs.map((imageDocument) => {
              const image = imageDocument.data() as TaskImage;
              return { id: imageDocument.id, imageBase64: image.imageBase64 };
            }),
          );
          emit();
        });
        leadQuestionImageUnsubscribes.set(questionId, unsubscribeImages);
      }
    });

    Array.from(leadQuestionsBase.keys()).forEach((questionId) => {
      if (!nextQuestionIds.has(questionId)) {
        leadQuestionsBase.delete(questionId);
        leadQuestionImages.delete(questionId);
        leadQuestionImageUnsubscribes.get(questionId)?.();
        leadQuestionImageUnsubscribes.delete(questionId);
      }
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
    questionImageUnsubscribes.forEach((unsubscribe) => unsubscribe());
    leadQuestionImageUnsubscribes.forEach((unsubscribe) => unsubscribe());
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

// Persists a new section order in one batch: `order` is set to each id's
// index in `orderedSectionIds`, so callers pass the full desired order.
export async function reorderSections(
  reportId: string,
  orderedSectionIds: string[],
): Promise<void> {
  const batch = writeBatch(db);
  orderedSectionIds.forEach((sectionId, index) => {
    batch.update(sectionDoc(reportId, sectionId), { order: index });
  });
  batch.update(reportDoc(reportId), { updatedAt: serverTimestamp() });
  await batch.commit();
}

export interface SectionOrderItem {
  kind: 'task' | 'question';
  id: string;
}

// Persists a new order for one section's tasks and its own questions
// together, in a single batch: `order` is set to each item's index in
// `orderedItems`, so callers pass the full desired interleaved order.
// Replaces the previous tasks-only `reorderTasks`; moving an item to a
// different section is out of scope.
export async function reorderSectionItems(
  reportId: string,
  sectionId: string,
  orderedItems: SectionOrderItem[],
): Promise<void> {
  const batch = writeBatch(db);
  orderedItems.forEach((item, index) => {
    const ref =
      item.kind === 'task' ? taskDoc(reportId, sectionId, item.id) : questionDoc(reportId, item.id);
    batch.update(ref, { order: index });
  });
  batch.update(reportDoc(reportId), { updatedAt: serverTimestamp() });
  await batch.commit();
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

// Firestore never cascades deletes into subcollections, so a lead question's
// answer images must be removed explicitly, before its own doc, same as
// deleteTaskImages above.
async function deleteLeadQuestionImages(reportId: string, questionId: string) {
  const imageSnapshots = await getDocs(leadQuestionImagesCollection(reportId, questionId));

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
// by their task-reference field and deleted explicitly. Lead notes can also
// target a developer question (`targetTaskId` holds the question id), so the
// same cleanup runs when a question is removed. Every lead question now has
// a carry-over pointer regardless of kind (see `addLeadQuestion`), so each
// one found here also has its pointer queued for the same batch. Deleting a
// pointer that doesn't exist (an older question, from before carry-over) is a
// no-op, and the delete rule explicitly allows it (`resource == null`) so a
// developer's batch isn't rejected, so this never needs to check first.
async function deleteTaskLeadArtifacts(reportId: string, taskId: string) {
  const [questionSnapshots, noteSnapshots] = await Promise.all([
    getDocs(query(leadQuestionsCollection(reportId), where('taskId', '==', taskId))),
    getDocs(query(leadNotesCollection(reportId), where('targetTaskId', '==', taskId))),
  ]);

  await Promise.all(
    questionSnapshots.docs.map((questionSnapshot) =>
      deleteLeadQuestionImages(reportId, questionSnapshot.id),
    ),
  );

  const refsToDelete = [
    ...questionSnapshots.docs.map((questionSnapshot) => questionSnapshot.ref),
    ...noteSnapshots.docs.map((noteSnapshot) => noteSnapshot.ref),
    ...questionSnapshots.docs.map((questionSnapshot) => leadQuestionCarryoverDoc(reportId, questionSnapshot.id)),
  ];

  for (let start = 0; start < refsToDelete.length; start += MAX_BATCH_DELETES) {
    const batch = writeBatch(db);
    refsToDelete.slice(start, start + MAX_BATCH_DELETES).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

// Removing a section must not orphan the questions anchored to it, so its
// `questions` (queried by `sectionId`, same as `deleteTaskLeadArtifacts`
// queries by `taskId`) are cleaned up the same way tasks are: images first,
// then the docs themselves, all in the section's delete batch.
export async function removeSection(reportId: string, sectionId: string): Promise<void> {
  const [taskSnapshots, questionSnapshots] = await Promise.all([
    getDocs(tasksCollection(reportId, sectionId)),
    getDocs(query(questionsCollection(reportId), where('sectionId', '==', sectionId))),
  ]);
  await Promise.all([
    ...taskSnapshots.docs.map((taskSnapshot) =>
      Promise.all([
        deleteTaskImages(reportId, sectionId, taskSnapshot.id),
        deleteTaskLeadArtifacts(reportId, taskSnapshot.id),
      ]),
    ),
    ...questionSnapshots.docs.map((questionSnapshot) =>
      Promise.all([
        deleteQuestionImages(reportId, questionSnapshot.id),
        deleteTaskLeadArtifacts(reportId, questionSnapshot.id),
      ]),
    ),
  ]);
  const batch = writeBatch(db);

  taskSnapshots.docs.forEach((taskSnapshot) => batch.delete(taskSnapshot.ref));
  questionSnapshots.docs.forEach((questionSnapshot) => batch.delete(questionSnapshot.ref));
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
  const { questionText, options, optionLinks, sectionId, order } = question;
  const payload: Record<string, unknown> = { questionText, options };

  // Firestore rejects undefined field values, so `optionDetails` is only
  // included when at least one option actually has a link.
  if (optionLinks?.some((links) => links.length > 0)) {
    payload.optionDetails = options.map((_option, index) => ({ links: optionLinks[index] ?? [] }));
  }

  // Same undefined-field rule: `sectionId`/`order` are only written for a
  // section question, so a report-level question keeps its previous shape.
  if (sectionId) {
    payload.sectionId = sectionId;
    payload.order = order ?? 0;
  }

  const ref = await addDoc(questionsCollection(reportId), payload);
  await updateDoc(reportDoc(reportId), { updatedAt: serverTimestamp() });
  return ref.id;
}

export async function addQuestionOptionImage(
  reportId: string,
  questionId: string,
  optionIndex: number,
  imageBase64: string,
): Promise<string> {
  const ref = await addDoc(questionImagesCollection(reportId, questionId), {
    imageBase64,
    optionIndex,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

// One final option's edited state: `keepImageIds` are existing option-image
// doc ids that remain under this option at its (possibly new) index, and
// `newImages` are base64 payloads to add there. Any existing image id not
// listed in some option's `keepImageIds` is deleted.
export interface UpdateQuestionOptionInput {
  text: string;
  links?: TaskLink[];
  keepImageIds?: string[];
  newImages?: string[];
}

export interface UpdateQuestionInput {
  questionText: string;
  options: UpdateQuestionOptionInput[];
}

// `failedImageCount > 0` means the question itself (text/options/links,
// image remap, stale-answer clear) is already saved — only some of the new
// option images failed to upload afterwards. Callers must treat this as a
// completed save, not a failed one: retrying the whole edit would re-upload
// images that already succeeded and could re-delete ones that didn't fail.
export interface UpdateQuestionResult {
  failedImageCount: number;
}

// Edits an existing dev question in place (text, options, per-option links
// and images), reusing the same composer the developer used to create it.
// Option images live one-per-doc tagged with `optionIndex`, so removing or
// reordering options must remap or delete their images. The question/report
// field updates plus the kept-image remap and the dropped-image deletes stay
// in one small batch — new images are NOT included there: each can be ~900 KB
// of base64, so 10+ of them in the same batch can exceed Firestore's
// per-request size limit and fail the whole edit. Instead, new images are
// uploaded one doc at a time (mirroring `addQuestion`/`addQuestionOptionImage`
// on the create path) only after that batch has committed, each tagged with
// its option's final index — so a failure can never leave an image attached
// to the wrong (or a since-removed) option; at worst some images are missing,
// reported via the resolved `failedImageCount` rather than a thrown error, so
// a partial image failure can never be mistaken for the batch itself having
// failed (which still rejects the returned promise, e.g. `batch.commit()`
// throwing). A stale answer — the option set or order no longer matches what
// the lead answered — is cleared the same way `answerQuestion` sets it, via
// `deleteField()`; text-only or links/images-only edits keep the existing
// answer.
export async function updateQuestion(
  reportId: string,
  questionId: string,
  input: UpdateQuestionInput,
): Promise<UpdateQuestionResult> {
  const questionSnapshot = await getDoc(questionDoc(reportId, questionId));
  const previousOptions = (questionSnapshot.data() as Question | undefined)?.options ?? [];

  const options = input.options.map((option) => option.text);
  const optionLinks = input.options.map((option) => option.links ?? []);

  const payload: Record<string, unknown> = { questionText: input.questionText, options };
  // Same undefined-field rule as `addQuestion`, plus the explicit clear this
  // update needs: an existing `optionDetails` from before the edit must be
  // removed once no option has a link left.
  if (optionLinks.some((links) => links.length > 0)) {
    payload.optionDetails = options.map((_option, index) => ({ links: optionLinks[index] }));
  } else {
    payload.optionDetails = deleteField();
  }

  const optionsChanged =
    options.length !== previousOptions.length || options.some((text, index) => text !== previousOptions[index]);
  if (optionsChanged) {
    payload.selectedAnswer = deleteField();
    payload.answeredBy = deleteField();
    payload.answeredAt = deleteField();
  }

  const batch = writeBatch(db);
  batch.update(questionDoc(reportId, questionId), payload);

  const imageSnapshots = await getDocs(questionImagesCollection(reportId, questionId));
  const existingImageRefsById = new Map(imageSnapshots.docs.map((snapshot) => [snapshot.id, snapshot.ref]));
  const keptImageIds = new Set<string>();

  input.options.forEach((option, optionIndex) => {
    (option.keepImageIds ?? []).forEach((imageId) => {
      const ref = existingImageRefsById.get(imageId);
      if (!ref) {
        return;
      }
      keptImageIds.add(imageId);
      batch.update(ref, { optionIndex });
    });
  });

  existingImageRefsById.forEach((ref, imageId) => {
    if (!keptImageIds.has(imageId)) {
      batch.delete(ref);
    }
  });

  batch.update(reportDoc(reportId), { updatedAt: serverTimestamp() });
  await batch.commit();

  const newImageUploads = input.options.flatMap((option, optionIndex) =>
    (option.newImages ?? []).map((imageBase64) =>
      addQuestionOptionImage(reportId, questionId, optionIndex, imageBase64),
    ),
  );

  if (newImageUploads.length === 0) {
    return { failedImageCount: 0 };
  }

  const uploadResults = await Promise.allSettled(newImageUploads);
  const failedImageCount = uploadResults.filter((result) => result.status === 'rejected').length;
  uploadResults.forEach((result) => {
    if (result.status === 'rejected') {
      console.error('Question option image upload failed', result.reason);
    }
  });

  return { failedImageCount };
}

// Firestore never cascades deletes into subcollections, so a question's
// option images must be removed explicitly, before its own doc, same as
// deleteTaskImages/deleteLeadQuestionImages above.
async function deleteQuestionImages(reportId: string, questionId: string) {
  const imageSnapshots = await getDocs(questionImagesCollection(reportId, questionId));

  for (let start = 0; start < imageSnapshots.docs.length; start += MAX_BATCH_DELETES) {
    const batch = writeBatch(db);
    imageSnapshots.docs
      .slice(start, start + MAX_BATCH_DELETES)
      .forEach((imageSnapshot) => batch.delete(imageSnapshot.ref));
    await batch.commit();
  }
}

export async function removeQuestion(reportId: string, questionId: string): Promise<void> {
  await Promise.all([
    deleteQuestionImages(reportId, questionId),
    deleteTaskLeadArtifacts(reportId, questionId),
  ]);
  await deleteDoc(questionDoc(reportId, questionId));
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

// Undoes answerQuestion: lets the lead unselect their answer to a developer's
// multiple-choice question instead of only ever changing it to another
// option.
export async function clearQuestionAnswer(reportId: string, questionId: string): Promise<void> {
  await updateDoc(questionDoc(reportId, questionId), {
    selectedAnswer: deleteField(),
    answeredBy: deleteField(),
    answeredAt: deleteField(),
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

export function updateLeadNote(reportId: string, noteId: string, noteText: string): Promise<void> {
  return updateDoc(leadNoteDoc(reportId, noteId), { noteText });
}

// `origin` (the recipient developer and the report's own date) is used to
// write the `leadQuestionCarryovers` pointer, alongside the question, in the
// same batch — every lead question now carries over until answered,
// report-level or task-anchored. A task-anchored one still keeps rendering
// inline in its own task on its own day exactly as before; the pointer is
// only what makes it also show up on later days (see
// `shouldSubscribeToLeadQuestionCarryoverPointer`/`isCarriedLeadQuestionVisible`),
// never before its origin date, so there's no duplicate rendering.
export async function addLeadQuestion(
  reportId: string,
  question: CreateLeadQuestionInput,
  origin: { userId: string; date: string },
): Promise<string> {
  const { questionText, kind } = question;
  // Firestore rejects undefined field values, so `options` is only written for
  // options questions instead of being spread through as `options: undefined`.
  const payload: Record<string, unknown> = {
    taskId: question.taskId,
    sectionId: question.sectionId,
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

  // The question doc's id is generated up front (instead of `addDoc`) so the
  // pointer can reference it and both writes land in the same batch.
  const questionRef = doc(leadQuestionsCollection(reportId));
  const batch = writeBatch(db);
  batch.set(questionRef, payload);

  const pointerPayload: Record<string, unknown> = {
    userId: origin.userId,
    reportId,
    questionId: questionRef.id,
    date: origin.date,
    createdAt: serverTimestamp(),
  };
  batch.set(leadQuestionCarryoverDoc(reportId, questionRef.id), pointerPayload);

  await batch.commit();
  return questionRef.id;
}

export async function removeLeadQuestion(reportId: string, questionId: string): Promise<void> {
  await deleteLeadQuestionImages(reportId, questionId);
  // A task-anchored question never had a pointer; deleting a missing doc is
  // a no-op, so this is safe for both kinds without checking first.
  const batch = writeBatch(db);
  batch.delete(leadQuestionDoc(reportId, questionId));
  batch.delete(leadQuestionCarryoverDoc(reportId, questionId));
  await batch.commit();
}

// Edits an existing lead question's text, kind, and options in place. A
// change to `kind` or the options array can invalidate the developer's
// existing answer, so the caller (which knows both the previous and the new
// shape) decides via `clearAnswer` whether to wipe it — same split between
// deciding and clearing as `updateQuestion` above, mirrored for the lead's
// own questions. Clearing also removes any answer images, same cascade as
// removeLeadQuestion.
export async function updateLeadQuestion(
  reportId: string,
  questionId: string,
  input: UpdateLeadQuestionInput,
  { clearAnswer }: { clearAnswer: boolean },
): Promise<void> {
  const payload: Record<string, unknown> = {
    questionText: input.questionText,
    kind: input.kind,
  };

  if (input.kind === 'options') {
    const nonEmptyOptions = (input.options ?? []).map((option) => option.trim()).filter(Boolean);
    if (nonEmptyOptions.length < 2) {
      throw new Error('An options question needs at least 2 non-empty options.');
    }
    payload.options = nonEmptyOptions;
  } else {
    payload.options = deleteField();
  }

  const batch = writeBatch(db);

  if (clearAnswer) {
    await deleteLeadQuestionImages(reportId, questionId);
    payload.answerText = deleteField();
    payload.answerLinks = deleteField();
    payload.selectedAnswer = deleteField();
    payload.answeredAt = deleteField();

    // Clear the pointer's `answeredDate` in the same batch as the question
    // clear below, so the two can never go out of sync — a stale
    // `answeredDate` left behind by a non-atomic clear could otherwise hide
    // a carried question whose answer was actually just cleared (see
    // `isCarriedLeadQuestionVisible`). A no-op when there is no pointer (a
    // task-anchored question, or one asked before carry-over): `update`
    // rejects on a missing doc, so this checks existence first instead of
    // relying on a best-effort catch, now that the lead has full update
    // access on the pointer (see the Firestore rules).
    const pointerRef = leadQuestionCarryoverDoc(reportId, questionId);
    const pointerSnapshot = await getDoc(pointerRef);
    if (pointerSnapshot.exists()) {
      batch.update(pointerRef, { answeredDate: deleteField() });
    }
  }

  batch.update(leadQuestionDoc(reportId, questionId), payload);
  await batch.commit();
}

// Best-effort: stamps today's real local date (never the day view the
// caller happens to be looking at — answering an earlier date's question
// must still record when it was actually answered) onto the carry-over
// pointer's `answeredDate`, from every path that answers a lead question.
// This is purely a cheap prefilter for
// `subscribeLeadQuestionCarryoversFromQuery` to skip subscribing to a
// long-answered question — visibility itself is decided from the question
// doc's own `answeredAt` (see `isCarriedLeadQuestionVisible`), so using the
// real "now" here (instead of a view date threaded in from the caller) is
// what keeps the prefilter and the real visibility check from ever
// disagreeing. A failure (e.g. an older question with no pointer —
// `updateDoc` on a missing doc rejects, caught here) can never hide or
// wrongly show a question either way.
async function stampLeadQuestionCarryoverAnswered(reportId: string, questionId: string): Promise<void> {
  try {
    await updateDoc(leadQuestionCarryoverDoc(reportId, questionId), { answeredDate: todayDateString() });
  } catch (error) {
    console.error('Lead question carry-over pointer update failed', error);
  }
}

// Firestore rejects undefined field values, so `answerLinks` is only included
// when the caller actually passed it.
export async function answerLeadQuestion(
  reportId: string,
  questionId: string,
  answer: AnswerLeadQuestionInput,
): Promise<void> {
  const payload: Record<string, unknown> = { answeredAt: serverTimestamp() };

  if ('selectedAnswer' in answer) {
    payload.selectedAnswer = answer.selectedAnswer;
  } else {
    payload.answerText = answer.answerText;
    if (answer.answerLinks !== undefined) {
      payload.answerLinks = answer.answerLinks;
    }
  }

  await updateDoc(leadQuestionDoc(reportId, questionId), payload);
  await stampLeadQuestionCarryoverAnswered(reportId, questionId);
}

// Mirrors addTaskImage: an image on an otherwise-unanswered text question
// counts as answering it, so this also stamps `answeredAt`.
export async function addLeadQuestionAnswerImage(
  reportId: string,
  questionId: string,
  imageBase64: string,
): Promise<string> {
  const ref = await addDoc(leadQuestionImagesCollection(reportId, questionId), {
    imageBase64,
    createdAt: serverTimestamp(),
  });
  await updateDoc(leadQuestionDoc(reportId, questionId), { answeredAt: serverTimestamp() });
  await stampLeadQuestionCarryoverAnswered(reportId, questionId);
  return ref.id;
}

export function removeLeadQuestionAnswerImage(
  reportId: string,
  questionId: string,
  imageId: string,
): Promise<void> {
  return deleteDoc(leadQuestionImageDoc(reportId, questionId, imageId));
}

// Cheap prefilter using only the pointer doc, to decide whether it's even
// worth subscribing to the origin question: `pointer.date` never changes
// once written, so `pointer.date < date` is always reliable. `answeredDate`
// is only a best-effort mirror of the question's real `answeredAt` (see
// `answerLeadQuestion`), so this uses it only to skip a pointer that's
// definitely long answered — the real visibility decision, once subscribed,
// is `isCarriedLeadQuestionVisible` below, applied against the live question.
function shouldSubscribeToLeadQuestionCarryoverPointer(
  pointer: Pick<LeadQuestionCarryoverPointer, 'date' | 'answeredDate'>,
  date: string,
): boolean {
  return pointer.date < date && (!pointer.answeredDate || pointer.answeredDate >= date);
}

// Source of truth for whether a carried question is still visible on `date`:
// unanswered, or answered on/after `date` (by the local calendar date of
// `answeredAt`). `answeredAt` is stamped by every path that flips a lead
// question to answered — `answerLeadQuestion` (text/links/options) and
// `addLeadQuestionAnswerImage` (an image-only answer) — and cleared
// atomically with the pointer's `answeredDate` by `updateLeadQuestion`'s
// `clearAnswer` path, so this can never wrongly hide a just-cleared question.
function isCarriedLeadQuestionVisible(question: LeadQuestion, date: string): boolean {
  if (!question.answeredAt) {
    return true;
  }
  return todayDateString(question.answeredAt.toDate()) >= date;
}

// The one origin lead question doc, plus its answer images and (for a
// task-anchored question) its origin task's description, same combined
// doc+subcollection shape `subscribeAssignmentUpdate` uses. Emits `null` if
// the question was deleted out from under an open pointer. `question`,
// `images`, and `taskDescription` are kept in outer mutable variables and
// `emit` always reads all three current values, so an images-only update
// (which never re-fires the question doc listener) still re-emits the
// latest question instead of the one captured when the images listener was
// first created.
function subscribeLeadQuestionWithImages(
  reportId: string,
  questionId: string,
  callback: (question: LeadQuestion | null, images: TaskImageWithId[], taskDescription: string | undefined) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  let question: LeadQuestion | null = null;
  let images: TaskImageWithId[] = [];
  let imagesUnsubscribe: Unsubscribe | undefined;
  let taskDescription: string | undefined;
  let taskDescriptionFetched = false;

  const emit = () => {
    callback(question, images, taskDescription);
  };

  const docUnsubscribe = onSnapshot(
    leadQuestionDoc(reportId, questionId),
    (snapshot) => {
      if (!snapshot.exists()) {
        question = null;
        images = [];
        imagesUnsubscribe?.();
        imagesUnsubscribe = undefined;
        emit();
        return;
      }

      question = snapshot.data() as LeadQuestion;

      if (!imagesUnsubscribe) {
        const imagesQuery = query(
          leadQuestionImagesCollection(reportId, questionId),
          orderBy('createdAt', 'asc'),
        );
        imagesUnsubscribe = onSnapshot(
          imagesQuery,
          (imageSnapshot) => {
            images = imageSnapshot.docs.map((imageDocument) => {
              const image = imageDocument.data() as TaskImage;
              return { id: imageDocument.id, imageBase64: image.imageBase64 };
            });
            emit();
          },
          onError,
        );
      }

      // A task-anchored question's origin task rarely changes once written,
      // so this is a one-time `getDoc` (not a live subscription) fetched
      // once per subscription lifetime, purely for the carried item's "About
      // task: ..." context. Best-effort: a deleted task, or any read
      // failure, just leaves `taskDescription` unset (the context line is
      // then omitted) instead of blocking the question itself from loading.
      if (!taskDescriptionFetched && question.taskId && question.sectionId) {
        taskDescriptionFetched = true;
        getDoc(taskDoc(reportId, question.sectionId, question.taskId))
          .then((taskSnapshot) => {
            if (taskSnapshot.exists()) {
              taskDescription = (taskSnapshot.data() as Task).description;
              emit();
            }
          })
          .catch((error: unknown) => {
            console.error('Lead question carry-over origin task fetch failed', error);
          });
      }

      emit();
    },
    onError,
  );

  return () => {
    docUnsubscribe();
    imagesUnsubscribe?.();
  };
}

// Shared by the assignee- and lead-scoped subscriptions below: for every
// pointer that passes the cheap prefilter, subscribes the origin question
// (+ its answer images) and re-emits the combined list on any change,
// filtering the final results by the live question's real visibility and
// tearing down a question subscription once its pointer fails the prefilter
// or disappears.
function subscribeLeadQuestionCarryoversFromQuery(
  pointersQuery: Query,
  date: string,
  callback: (questions: CarriedLeadQuestion[]) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  const pointers = new Map<string, LeadQuestionCarryoverPointer>();
  const questions = new Map<string, LeadQuestion>();
  const questionImages = new Map<string, TaskImageWithId[]>();
  const questionTaskDescriptions = new Map<string, string | undefined>();
  const questionUnsubscribes = new Map<string, Unsubscribe>();
  // Pointer ids whose origin-question subscription hasn't delivered its
  // first snapshot (or error) yet. `emit` is held back while any are
  // pending, so the very first callback after a pointers-query change never
  // fires with an incomplete (or empty) list — a flash the hooks would
  // otherwise read as "loaded, nothing here" before the real list arrives.
  const pendingFirstSnapshot = new Set<string>();

  const emit = () => {
    if (pendingFirstSnapshot.size > 0) {
      return;
    }

    const results: CarriedLeadQuestion[] = [];

    pointers.forEach((pointer, pointerId) => {
      const question = questions.get(pointerId);
      if (!question || !isCarriedLeadQuestionVisible(question, date)) {
        return;
      }

      results.push({
        id: pointer.questionId,
        ...question,
        answerImages: [...(questionImages.get(pointerId) ?? [])],
        userId: pointer.userId,
        originReportId: pointer.reportId,
        originDate: pointer.date,
        originTaskDescription: questionTaskDescriptions.get(pointerId),
      });
    });

    results.sort((a, b) => a.originDate.localeCompare(b.originDate));
    callback(results);
  };

  const stopQuestionSubscription = (pointerId: string) => {
    questions.delete(pointerId);
    questionImages.delete(pointerId);
    questionTaskDescriptions.delete(pointerId);
    questionUnsubscribes.get(pointerId)?.();
    questionUnsubscribes.delete(pointerId);
    // A pointer that stops being subscribable before its question ever
    // resolved (prefilter now fails, or the pointer itself disappeared)
    // must not leave `emit` blocked forever.
    pendingFirstSnapshot.delete(pointerId);
  };

  const pointersUnsubscribe = onSnapshot(
    pointersQuery,
    (snapshot) => {
      const nextIds = new Set<string>();

      snapshot.docs.forEach((pointerSnapshot) => {
        const pointerId = pointerSnapshot.id;
        nextIds.add(pointerId);
        const pointer = pointerSnapshot.data() as LeadQuestionCarryoverPointer;
        pointers.set(pointerId, pointer);

        if (!shouldSubscribeToLeadQuestionCarryoverPointer(pointer, date)) {
          stopQuestionSubscription(pointerId);
          return;
        }

        if (!questionUnsubscribes.has(pointerId)) {
          pendingFirstSnapshot.add(pointerId);
          let firstSnapshotDelivered = false;
          const resolveFirstSnapshot = () => {
            if (!firstSnapshotDelivered) {
              firstSnapshotDelivered = true;
              pendingFirstSnapshot.delete(pointerId);
            }
          };

          const unsubscribeQuestion = subscribeLeadQuestionWithImages(
            pointer.reportId,
            pointer.questionId,
            (question, images, taskDescription) => {
              if (question) {
                questions.set(pointerId, question);
                questionImages.set(pointerId, images);
                questionTaskDescriptions.set(pointerId, taskDescription);
              } else {
                questions.delete(pointerId);
                questionImages.delete(pointerId);
                questionTaskDescriptions.delete(pointerId);
              }
              resolveFirstSnapshot();
              emit();
            },
            (error) => {
              resolveFirstSnapshot();
              emit();
              onError?.(error);
            },
          );
          questionUnsubscribes.set(pointerId, unsubscribeQuestion);
        }
      });

      Array.from(pointers.keys()).forEach((pointerId) => {
        if (!nextIds.has(pointerId)) {
          pointers.delete(pointerId);
          stopQuestionSubscription(pointerId);
        }
      });

      emit();
    },
    onError,
  );

  return () => {
    pointersUnsubscribe();
    questionUnsubscribes.forEach((unsubscribe) => unsubscribe());
  };
}

// No composite index: `userId` is filtered server-side (a single equality
// query), and visibility (`date`/`answeredDate`) is filtered client-side, same
// split `subscribeAssignmentsForAssignee` uses.
export function subscribeLeadQuestionCarryoversForAssignee(
  uid: string,
  date: string,
  callback: (questions: CarriedLeadQuestion[]) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  const pointersQuery = query(leadQuestionCarryoversCollection(), where('userId', '==', uid));
  return subscribeLeadQuestionCarryoversFromQuery(pointersQuery, date, callback, onError);
}

// Lead-only: reads every pointer (no per-developer filter is possible for
// "any recipient"), so visibility is filtered entirely client-side to avoid a
// composite index, same as `subscribeAssignmentsForDate`.
export function subscribeLeadQuestionCarryoversForDate(
  date: string,
  callback: (questions: CarriedLeadQuestion[]) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  return subscribeLeadQuestionCarryoversFromQuery(leadQuestionCarryoversCollection(), date, callback, onError);
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

// A task the lead assigns to one or more developers. It stays visible on
// every date from `startDate` up to (and including) `closedDate`, or forever
// while `status` is `'open'`. Independent of `reports`: an assignee answers
// it daily even on a date with no report of their own.
export function isAssignmentVisibleOn(
  assignment: Pick<Assignment, 'startDate' | 'status' | 'closedDate'>,
  date: string,
): boolean {
  if (assignment.startDate > date) {
    return false;
  }

  return assignment.status === 'open' || (assignment.closedDate ?? '') >= date;
}

export async function createAssignment(input: CreateAssignmentInput): Promise<string> {
  const description = input.description.trim();
  const assigneeIds = Array.from(new Set(input.assigneeIds.filter(Boolean)));

  if (!description) {
    throw new Error('An assignment needs a description.');
  }

  if (assigneeIds.length === 0) {
    throw new Error('An assignment needs at least one assignee.');
  }

  // Firestore rejects undefined field values, so `relatedTask` is only
  // included when the caller actually passed one.
  const payload: Record<string, unknown> = {
    description,
    assigneeIds,
    createdBy: input.createdBy,
    startDate: input.startDate,
    status: 'open',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.relatedTask !== undefined) {
    payload.relatedTask = input.relatedTask;
  }

  const ref = await addDoc(assignmentsCollection(), payload);

  return ref.id;
}

export interface UpdateAssignmentInput {
  description: string;
  assigneeIds: string[];
}

// Edits an existing assignment's description and assignees. Removing an
// assignee here only stops the assignment showing on their side; their
// existing `updates` docs are left in place rather than deleted.
export async function updateAssignment(assignmentId: string, input: UpdateAssignmentInput): Promise<void> {
  const description = input.description.trim();
  const assigneeIds = Array.from(new Set(input.assigneeIds.filter(Boolean)));

  if (!description) {
    throw new Error('An assignment needs a description.');
  }

  if (assigneeIds.length === 0) {
    throw new Error('An assignment needs at least one assignee.');
  }

  await updateDoc(assignmentDoc(assignmentId), {
    description,
    assigneeIds,
    updatedAt: serverTimestamp(),
  });
}

export async function closeAssignment(assignmentId: string, closedDate: string): Promise<void> {
  await updateDoc(assignmentDoc(assignmentId), {
    status: 'closed',
    closedDate,
    updatedAt: serverTimestamp(),
  });
}

// Undoes closeAssignment: the assignment becomes visible on every date again
// from its `startDate`, so `closedDate` is dropped rather than kept stale.
export async function reopenAssignment(assignmentId: string): Promise<void> {
  await updateDoc(assignmentDoc(assignmentId), {
    status: 'open',
    closedDate: deleteField(),
    updatedAt: serverTimestamp(),
  });
}

// Mirrors deleteTaskImages/removeSection above: Firestore never cascades
// deletes, so every update doc's images are removed first (batched under the
// 500-op write-batch limit), then the update docs, then the assignment doc.
async function deleteAssignmentUpdateImages(assignmentId: string, updateId: string) {
  const imageSnapshots = await getDocs(assignmentUpdateImagesCollection(assignmentId, updateId));

  for (let start = 0; start < imageSnapshots.docs.length; start += MAX_BATCH_DELETES) {
    const batch = writeBatch(db);
    imageSnapshots.docs
      .slice(start, start + MAX_BATCH_DELETES)
      .forEach((imageSnapshot) => batch.delete(imageSnapshot.ref));
    await batch.commit();
  }
}

export async function removeAssignment(assignmentId: string): Promise<void> {
  const updateSnapshots = await getDocs(assignmentUpdatesCollection(assignmentId));

  await Promise.all(
    updateSnapshots.docs.map((updateSnapshot) =>
      deleteAssignmentUpdateImages(assignmentId, updateSnapshot.id),
    ),
  );

  for (let start = 0; start < updateSnapshots.docs.length; start += MAX_BATCH_DELETES) {
    const batch = writeBatch(db);
    updateSnapshots.docs
      .slice(start, start + MAX_BATCH_DELETES)
      .forEach((updateSnapshot) => batch.delete(updateSnapshot.ref));
    await batch.commit();
  }

  await deleteDoc(assignmentDoc(assignmentId));
}

// No composite index: `assigneeIds` is filtered server-side (a single
// array-contains query), and visibility (`startDate`/`status`/`closedDate`)
// is filtered client-side so this never needs a range filter alongside it.
export function subscribeAssignmentsForAssignee(
  uid: string,
  date: string,
  callback: (assignments: AssignmentWithId[]) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  const assignmentsQuery = query(
    assignmentsCollection(),
    where('assigneeIds', 'array-contains', uid),
  );

  return onSnapshot(
    assignmentsQuery,
    (snapshot) => {
      const visible = snapshot.docs
        .map((assignmentSnapshot) => ({
          id: assignmentSnapshot.id,
          ...(assignmentSnapshot.data() as Assignment),
        }))
        .filter((assignment) => isAssignmentVisibleOn(assignment, date))
        .sort((a, b) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt));

      callback(visible);
    },
    onError,
  );
}

// Lead-only: reads every assignment (no `assigneeIds` filter is possible for
// "any assignee"), so visibility is filtered entirely client-side to avoid a
// composite index.
export function subscribeAssignmentsForDate(
  date: string,
  callback: (assignments: AssignmentWithId[]) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(
    assignmentsCollection(),
    (snapshot) => {
      const visible = snapshot.docs
        .map((assignmentSnapshot) => ({
          id: assignmentSnapshot.id,
          ...(assignmentSnapshot.data() as Assignment),
        }))
        .filter((assignment) => isAssignmentVisibleOn(assignment, date))
        .sort((a, b) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt));

      callback(visible);
    },
    onError,
  );
}

// The one assignee/date update doc, plus its images. Emits null while the
// doc doesn't exist yet (the assignee hasn't written anything for this date).
export function subscribeAssignmentUpdate(
  assignmentId: string,
  assigneeId: string,
  date: string,
  callback: (update: AssignmentUpdateWithImages | null) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  const updateId = assignmentUpdateIdFor(assigneeId, date);
  const updateRef = assignmentUpdateDocById(assignmentId, updateId);

  let updateData: AssignmentUpdate | null = null;
  let images: TaskImageWithId[] = [];
  let imagesUnsubscribe: Unsubscribe | undefined;

  const emit = () => {
    if (!updateData) {
      callback(null);
      return;
    }

    callback({ id: updateId, ...updateData, images: [...images] });
  };

  const docUnsubscribe = onSnapshot(
    updateRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        updateData = null;
        images = [];
        imagesUnsubscribe?.();
        imagesUnsubscribe = undefined;
        emit();
        return;
      }

      updateData = snapshot.data() as AssignmentUpdate;

      if (!imagesUnsubscribe) {
        const imagesQuery = query(
          assignmentUpdateImagesCollection(assignmentId, updateId),
          orderBy('createdAt', 'asc'),
        );
        imagesUnsubscribe = onSnapshot(imagesQuery, (imageSnapshot) => {
          images = imageSnapshot.docs.map((imageSnapshotDoc) => {
            const image = imageSnapshotDoc.data() as TaskImage;
            return { id: imageSnapshotDoc.id, imageBase64: image.imageBase64 };
          });
          emit();
        });
      }

      emit();
    },
    onError,
  );

  return () => {
    docUnsubscribe();
    imagesUnsubscribe?.();
  };
}

// Lead-only: every assignee's update doc for one assignment/date, with each
// update's images managed the same way subscribeReport manages task images.
export function subscribeAssignmentUpdatesForDate(
  assignmentId: string,
  date: string,
  callback: (updates: AssignmentUpdateWithImages[]) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  const updates = new Map<string, AssignmentUpdate>();
  const updateImages = new Map<string, TaskImageWithId[]>();
  const imageUnsubscribes = new Map<string, Unsubscribe>();

  const emit = () => {
    const results = Array.from(updates.entries()).map(([id, data]) => ({
      id,
      ...data,
      images: [...(updateImages.get(id) ?? [])],
    }));
    callback(results);
  };

  const updatesQuery = query(assignmentUpdatesCollection(assignmentId), where('date', '==', date));
  const updatesUnsubscribe = onSnapshot(
    updatesQuery,
    (snapshot) => {
      const nextIds = new Set<string>();

      snapshot.docs.forEach((updateSnapshot) => {
        const updateId = updateSnapshot.id;
        nextIds.add(updateId);
        updates.set(updateId, updateSnapshot.data() as AssignmentUpdate);

        if (!imageUnsubscribes.has(updateId)) {
          const imagesQuery = query(
            assignmentUpdateImagesCollection(assignmentId, updateId),
            orderBy('createdAt', 'asc'),
          );
          const unsubscribeImages = onSnapshot(imagesQuery, (imageSnapshot) => {
            updateImages.set(
              updateId,
              imageSnapshot.docs.map((imageSnapshotDoc) => {
                const image = imageSnapshotDoc.data() as TaskImage;
                return { id: imageSnapshotDoc.id, imageBase64: image.imageBase64 };
              }),
            );
            emit();
          });
          imageUnsubscribes.set(updateId, unsubscribeImages);
        }
      });

      Array.from(updates.keys()).forEach((updateId) => {
        if (!nextIds.has(updateId)) {
          updates.delete(updateId);
          updateImages.delete(updateId);
          imageUnsubscribes.get(updateId)?.();
          imageUnsubscribes.delete(updateId);
        }
      });

      emit();
    },
    onError,
  );

  return () => {
    updatesUnsubscribe();
    imageUnsubscribes.forEach((unsubscribe) => unsubscribe());
  };
}

// setDoc merge so the first write creates the doc and later writes never
// clobber fields the caller didn't pass; `createdAt` is only set once, read
// back via getDoc first since merge would otherwise reset it every write.
// Firestore rejects undefined field values, so `text`/`links` are only
// included when the caller actually passed them.
export async function saveAssignmentUpdate(
  assignmentId: string,
  assigneeId: string,
  date: string,
  input: SaveAssignmentUpdateInput,
): Promise<void> {
  const ref = assignmentUpdateDoc(assignmentId, assigneeId, date);
  const existing = await getDoc(ref);

  const payload: Record<string, unknown> = {
    assigneeId,
    date,
    updatedAt: serverTimestamp(),
  };

  if (input.text !== undefined) {
    payload.text = input.text;
  }

  if (input.links !== undefined) {
    payload.links = input.links;
  }

  if (!existing.exists()) {
    payload.createdAt = serverTimestamp();
  }

  await setDoc(ref, payload, { merge: true });
}

// Ensures the update doc exists first so its `images` subcollection has a
// readable parent under the Firestore rules (mirrors ensureReport/addTaskImage).
export async function addAssignmentUpdateImage(
  assignmentId: string,
  assigneeId: string,
  date: string,
  imageBase64: string,
): Promise<string> {
  await saveAssignmentUpdate(assignmentId, assigneeId, date, {});
  const updateId = assignmentUpdateIdFor(assigneeId, date);
  const ref = await addDoc(assignmentUpdateImagesCollection(assignmentId, updateId), {
    imageBase64,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export function removeAssignmentUpdateImage(
  assignmentId: string,
  assigneeId: string,
  date: string,
  imageId: string,
): Promise<void> {
  const updateId = assignmentUpdateIdFor(assigneeId, date);
  return deleteDoc(assignmentUpdateImageDoc(assignmentId, updateId, imageId));
}
