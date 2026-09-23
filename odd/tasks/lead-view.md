# Lead View — per-task questions and notes

## Objective
Rework the lead (manager) experience: rename it to "Lead View" everywhere, replace
team-wide questions with per-task questions addressed to the report owner, and add a
hover action bar (Question / Note) on each task. Hide the "No image" placeholder.

## Problem / why
- The lead view is named after a person ("RyanView", "Ryan's notes"); it must be role-based.
- Lead questions today go to the whole team (`teamQuestions`), but the lead needs to ask a
  specific developer about a specific task in their daily report.
- "No image" placeholders add noise when a task has no images.

## Scope
- Rename code identifiers, folders, UI copy, types, Firestore collection `ryanNotes` →
  `leadNotes`, seed script and README rules. No "Ryan" string may remain in the app.
- New `reports/{reportId}/leadQuestions/{questionId}`:
  `{ taskId, sectionId, questionText, kind: 'text' | 'options', options?: string[],
     answerText?, selectedAnswer?, answeredAt?, createdAt }`.
  Lead creates/deletes; report owner answers (text or option, per `kind`).
- Remove the `teamQuestions` feature (UI, services, types, rules, seed).
- Lead View task card: on hover show two buttons, "Question" and "Note"; a task can have
  both (and several of each). Question composer lets the lead pick free text or options.
- Developer View: show lead questions under each task and let the owner answer them;
  show lead notes under each task (read-only).
- Keep dev → lead report questions (`questions`) unchanged.
- Remove "No image" placeholders in both views; render images only when present.

## Constraints
- Firestore rules live in the console; README documents them. Renamed/new collections
  need the user to deploy updated rules BEFORE using the new build.
- Artifacts in English. Only the parent commits.

## TDD
- Mode: Strict TDD enabled (global config). Runner: NONE — the project has no test
  runner or tests. Disclosed to user; checks are `npx tsc --noEmit` + `npx vite build`.

## Delivery
- Strategy: ask-on-risk. Forecast ~550 authored changed lines (> 400); chain strategy
  will be asked before any PR is opened. Work-unit commits on feature/dailybit-mvp.

## Tasks
- [x] T1 — Rename Ryan → Lead everywhere (folders, components, identifiers, UI copy,
      `ryanNotes` → `leadNotes`, types, seed, README rules). Route: delegated (writer
      trigger: 5+ files).
- [x] T2 — Remove "No image" placeholders in both views. Route: delegated with T3 writer
      or inline (1–2 files).
- [x] T3 — Per-task lead questions (text/options) + hover Question/Note bar in Lead View,
      answering in Developer View, remove `teamQuestions`. Route: delegated (writer
      trigger: 4+ files).

- [x] T4 — Compact empty states in Lead View: replace the large "No sections yet" /
      "No questions" boxes with one-line muted messages; header summary counts stay small.
- [x] T5 — Report-level lead questions and notes (user decision 2026-09-23): the lead can
      ask a question (text/options) or leave a note on the report as a whole, not only on a
      task; works when the report has no sections. Report-level = `taskId`/`sectionId` ''
      (questions) and `targetTaskId` '' (notes). Developer View shows and answers them.
      Route: delegated (writer trigger: 2+ non-trivial files), together with T4.

## Acceptance criteria
- `grep -rni ryan src scripts README.md` returns nothing.
- Lead hovers a task → "Question" and "Note" buttons; both can be added to the same task.
- Dev sees lead questions on their task and can answer (text or chosen option).
- No team-wide question UI remains.
- Tasks without images show no image block.
- tsc + build pass.

## Progress
- T1: commit `2d82944`; review `review-76ced42d772140d9` APPROVED (4 lenses, no findings). tsc/build/py_compile OK; `grep -rni ryan` empty.
- T2: done inline (2 files, mechanical). Lead View drops the image column when a task has no images. tsc OK.

- T3: delegated writer (4+ files). `leadQuestions` subcollection (kind text|options), hover Question/Note bar, dev answers/re-answers, cascade delete of lead questions/notes with task/section, teamQuestions removed, README rules + seed updated. tsc/build/py_compile OK; grep teamQuestion/ryan empty. Composers stay open after submit (flagged). First review `review-084c9903cfc06b93` escalated: options: undefined rejected by Firestore for text questions; dev task delete denied by lead-only delete rules. Fixed (conditional options payload; owner may delete leadNotes/leadQuestions). Re-review `review-5a11a140c56ed8a9` APPROVED. Commit `33a98f6`.

- T4+T5: delegated writer. CompactEmptyState one-liners, dev-questions section hidden when empty, pluralized summary; report-level Question/Note buttons in card header (taskId/sectionId/targetTaskId ''), Developer View shows/answers them above sections. tsc/build OK.

## Next step
- User deploys updated Firestore rules (leadNotes, leadQuestions) before using the build.
