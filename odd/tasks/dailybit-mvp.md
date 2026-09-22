# DailyBit MVP — Daily Stand-up Platform

## Goal
Internal web app for a 7-8 person engineering team + lead (Ryan), replacing a shared
Word document for daily status reports. Two views: Developer submission interface
and Ryan's consolidated dashboard.

## Confirmed decisions
- Stack: **Vite + React + TypeScript + Tailwind CSS** (pure SPA, no server framework)
- Auth: **Firebase email/password**
- App lives at repo root (no monorepo nesting)
- User (repo owner) handles Firebase project setup: config keys, `users` seeding,
  security rules
- Generated technical artifacts in English

## Refined data model (extends the user's sketch)
```
users/{uid}                        # REQUIRED ADDITION — role resolution
  name: string
  role: 'dev' | 'lead'

reports/{docId}                    # docId = `${userId}_${date}`
  userId: string
  date: string                     # YYYY-MM-DD
  createdAt / updatedAt: timestamp
  + subcollections:
      sections/{sectionId}         # main title
        title: string
        order: number
        + tasks/{taskId}
          description: string      # short/punchy, maxlength enforced in UI
          imageUrl?: string        # public URL from Storage
          links?: { label?: string, url: string }[]
          order: number
      questions/{questionId}       # dev -> Ryan
        questionText: string
        options: string[]
        selectedAnswer?: number    # index, set by Ryan
        answeredBy?: string
        answeredAt?: timestamp
      ryanNotes/{noteId}
        noteText: string
        targetTaskId: string       # FK to a task; may be '' for report-level
        createdAt: timestamp

teamQuestions/{questionId}         # Ryan -> team (global, not per-report)
  questionText: string
  options: string[]
  selectedAnswers?: Record<uid, number>  # per-dev selections
  createdAt: timestamp
```

## Task breakdown
5. **Base64 image storage** — user decision: replace Firebase Storage uploads with client-side compress + Base64 data URL stored in the task document field `imageBase64`; render via <img src={imageBase64} />. Guard the Firestore 1MB doc limit (compress to max 1024px / JPEG 0.75, reject >900KB). Remove storage service. Keep key.json out of git.

## Completed breakdown
1. **Scaffold + core services** — DONE (af8c81c)
2. **DeveloperView UI** — DONE (ed1fe35)
3. **RyanView UI** — DONE (3dbbbf3)
4. **Verification & polish** — DONE (d280e2a)

## External dependencies (blocked on user, not on tasks)
- `.env.local` with `VITE_FIREBASE_*` keys (a `.env.example` is generated)
- `users` collection seeded with 8 devs + Ryan (role: 'lead')
- Firestore rules + Storage rules

## Evidence log

### Task 2 — DeveloperView UI — DONE
- Commit: `ed1fe35` (feature/dailybit-mvp)
- Writer: gentle-ai-worker (components/hooks/App wiring); parent inline fix (subscribeReport questions subscription); worker fix (upload rejection handling)
- Checks observed: typecheck exit 0, build exit 0 (post-fix, by worker); earlier verify pass caught missing QuestionWithId import (parent defect) + unhandled upload rejection (fixed)
- Known minor: dynamic question-option inputs use index keys (low risk, accepted)
- Service gap found and closed: subscribeReport now subscribes questions subcollection

### Task 3 — RyanView UI — DONE
- Commit: `3dbbbf3` (feature/dailybit-mvp)
- Writers: gentle-ai-worker x2 (dashboard + gap closure)
- Checks observed: typecheck exit 0, build exit 0 (both runs)
- Service gaps found and closed: subscribeReport now also emits ryanNotes (RyanNoteWithId); new subscribeUserProfiles for 'X of Y developers reported'
- Notes flow: addRyanNote -> realtime subscription -> report-level (targetTaskId '') and per-task rendering with remove

### Task 4 — Verification + polish + README — DONE
- Commit: `d280e2a` (feature/dailybit-mvp)
- Final verification: gentle-ai-verify full pass — typecheck PASS, build PASS, README sanity PASS; 2 high + 2 medium defects found and fixed by gentle-ai-worker (lead writes vs security rules, answer rejection handling, date normalization, fire-and-forget logging)
- Accepted low-risk minors: index-derived keys on dynamic option/link lists
- Not verified: live browser/Firebase runtime; deployed rules (README rules are a starting point)

### Close-out — independent fix verification — DONE
- Commit: `b3a6cea` (feature/dailybit-mvp)
- Native review: consent declined for both candidates (scaffold+UI range, RyanView fix) — candidate-scoped, no lineage created
- ASSESS plan followed: writer self-verification + independent verifier (gentle-ai-verify) on the fix candidate — all 5 checks PASS, typecheck/build exit 0
- Untracked `key.json` at repo root excluded from review candidate; flagged to user (possible credentials)

### Task 1 — Scaffold + core services — DONE
- Commit: `af8c81c` (feature/dailybit-mvp) — 20 files, 4709 insertions
- Writer: gentle-ai-worker (scaffold + services + auth gate)
- Checks observed: `npm install` exit 0; `npm run build` exit 0; `npm run typecheck` exit 0 (zero TS errors)
- Known deviation: task functions take `reportId` + `sectionId` (nested paths need both) — accepted
- Blocked: `.env.example` write blocked by safety policy (env-path rule); keys documented in README in task 4; user creates `.env.local` manually
- Review focus carried forward: verify firestore paths/semantics during task 4 verification
