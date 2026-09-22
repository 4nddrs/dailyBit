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
1. **Scaffold + core services** — Vite/TS/Tailwind project, firebase.ts, types.ts,
   auth/firestore/storage services, useAuth hook, auth gate. Build green.
2. **DeveloperView UI** — report editor: sections, tasks (short input + counter),
   image upload, links, MC questions to Ryan.
3. **RyanView UI** — daily rollup (realtime), per-task notes, answer MC questions,
   post questions to team.
4. **Verification & polish** — build, typecheck, smoke review, docs.

## External dependencies (blocked on user, not on tasks)
- `.env.local` with `VITE_FIREBASE_*` keys (a `.env.example` is generated)
- `users` collection seeded with 8 devs + Ryan (role: 'lead')
- Firestore rules + Storage rules

## Evidence log

### Task 1 — Scaffold + core services — DONE
- Commit: `af8c81c` (feature/dailybit-mvp) — 20 files, 4709 insertions
- Writer: gentle-ai-worker (scaffold + services + auth gate)
- Checks observed: `npm install` exit 0; `npm run build` exit 0; `npm run typecheck` exit 0 (zero TS errors)
- Known deviation: task functions take `reportId` + `sectionId` (nested paths need both) — accepted
- Blocked: `.env.example` write blocked by safety policy (env-path rule); keys documented in README in task 4; user creates `.env.local` manually
- Review focus carried forward: verify firestore paths/semantics during task 4 verification
