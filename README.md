# DailyBit

DailyBit replaces the shared Word document used for daily stand-up updates: developers submit grouped daily updates, and the lead gets a consolidated realtime dashboard for the team.

## What it does

DailyBit has two role-based views:

- **DeveloperView**: each developer maintains their own daily report.
- **LeadView**: the lead sees the team's reports for a selected date and can respond in place.

The app routes users by `users/{uid}.role`: `dev` users see DeveloperView; `lead` users see LeadView.

## Quick start

### Prerequisites

- Node.js 18+
- A Firebase project with Email/Password auth enabled
- A seeded `users` collection; see [Firebase setup](#firebase-setup)

### Run locally

```bash
npm install
# Create .env.local from the template in Configuration.
npm run dev
```

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server. |
| `npm run build` | Run TypeScript checks and build the production bundle. |
| `npm run preview` | Preview the built production bundle locally. |
| `npm run typecheck` | Run `tsc --noEmit`. |

## Configuration

Create `.env.local` at the repo root. The app reads Firebase web app config through Vite environment variables.

Find each value in **Firebase Console > Project settings > Your apps > Web app config**.

| Key | Where to find it |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | `apiKey` in the Firebase web app config. |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` in the Firebase web app config. |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` in the Firebase web app config. |
| `VITE_FIREBASE_STORAGE_BUCKET` | Optional/unused for now; task images are stored as compressed Base64 data URLs in Firestore. |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` in the Firebase web app config. |
| `VITE_FIREBASE_APP_ID` | `appId` in the Firebase web app config. |

`.env.local` template:

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
# VITE_FIREBASE_STORAGE_BUCKET= # Optional/unused for now.
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Email/password authentication must be enabled in **Firebase Console > Authentication > Sign-in method**.

## Firebase setup

The repository does not create Firebase resources. The owner must configure Firebase before the team can use the app.

### 1. Enable auth

Enable **Email/Password** in **Firebase Console > Authentication > Sign-in method**.

### 2. Seed users

Create one document per Firebase Auth user:

```text
users/{uid} = {
  name: string,
  role: 'dev' | 'lead'
}
```

The lead must have `role: 'lead'`. The app uses this role to choose LeadView instead of DeveloperView.

### 3. Firestore structure

Summary:

```text
users/{uid}
reports/{userId}_{date}
  sections/{sectionId}
    tasks/{taskId}
      images/{imageId}
  questions/{questionId}
  leadNotes/{noteId}
  leadQuestions/{questionId}
    images/{imageId}
```

Reports are keyed by `reports/{userId}_{date}` where `date` is `YYYY-MM-DD`. Sections group tasks; tasks can include links and an `images` subcollection of compressed Base64 image data URLs; questions are developer-to-lead multiple-choice decisions; `leadNotes` are the lead's report-level or task-level notes; `leadQuestions` are the lead's report-level or per-task questions to the report owner (empty `taskId`/`sectionId` means the question is about the report as a whole), answered as free text or by picking one of several options. A free-text (`kind: 'text'`) answer may also include `answerLinks` and an `images` subcollection of compressed Base64 image data URLs, same shape as task images; an options answer stays a plain selected index, with no links or images.

See `odd/tasks/dailybit-mvp.md` for the detailed model and implementation notes.

### 4. Suggested minimum security rules

These rules are a starting point. Review them against the team's exact admin and rollout needs before production use.

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function userProfile(uid) {
      return get(/databases/$(database)/documents/users/$(uid)).data;
    }

    function isLead() {
      return signedIn() && userProfile(request.auth.uid).role == 'lead';
    }

    function ownsExistingReport(reportId) {
      return signedIn() &&
        get(/databases/$(database)/documents/reports/$(reportId)).data.userId
          == request.auth.uid;
    }

    function isOwnReportCreate() {
      return signedIn() && request.resource.data.userId == request.auth.uid;
    }

    match /users/{uid} {
      allow read: if signedIn();
      // A brand-new user may create their own profile, but only as 'dev';
      // role changes stay in the admin console / seed script.
      allow create: if signedIn() && request.auth.uid == uid
        && request.resource.data.role == 'dev';
      allow update, delete: if false;
    }

    match /reports/{reportId} {
      // Allow reading a nonexistent report so the get-or-create flow works:
      // a rule that dereferences get(...).data on a missing doc fails closed
      // and blocks report creation.
      allow get: if isLead()
        || (signedIn()
            && (resource == null || resource.data.userId == request.auth.uid));
      allow list: if isLead();
      allow create: if isOwnReportCreate();
      allow update, delete: if ownsExistingReport(reportId);

      match /sections/{sectionId} {
        allow read: if ownsExistingReport(reportId) || isLead();
        allow write: if ownsExistingReport(reportId);

        match /tasks/{taskId} {
          allow read: if ownsExistingReport(reportId) || isLead();
          allow write: if ownsExistingReport(reportId);

          match /images/{imageId} {
            allow read: if ownsExistingReport(reportId) || isLead();
            allow write: if ownsExistingReport(reportId);
          }
        }
      }

      match /questions/{questionId} {
        allow read: if ownsExistingReport(reportId) || isLead();
        allow create, delete: if ownsExistingReport(reportId);
        allow update: if (
          ownsExistingReport(reportId) &&
          !request.resource.data.diff(resource.data).affectedKeys()
            .hasAny(['selectedAnswer', 'answeredBy', 'answeredAt'])
        ) || (
          isLead() &&
          request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['selectedAnswer', 'answeredBy', 'answeredAt'])
        );
      }

      // The report owner may delete lead notes/questions so that removing one of
      // their tasks or sections can also remove the lead feedback attached to it.
      match /leadNotes/{noteId} {
        allow read: if ownsExistingReport(reportId) || isLead();
        allow create, update: if isLead();
        allow delete: if isLead() || ownsExistingReport(reportId);
      }

      match /leadQuestions/{questionId} {
        allow read: if ownsExistingReport(reportId) || isLead();
        allow create: if isLead();
        allow delete: if isLead() || ownsExistingReport(reportId);
        allow update: if isLead() || (
          ownsExistingReport(reportId) &&
          request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['answerText', 'selectedAnswer', 'answeredAt', 'answerLinks'])
        );

        // A text answer's image attachments; same read/write shape as task
        // images, plus a lead delete so removeLeadQuestion can cascade.
        match /images/{imageId} {
          allow read: if ownsExistingReport(reportId) || isLead();
          allow create: if ownsExistingReport(reportId);
          allow delete: if isLead() || ownsExistingReport(reportId);
        }
      }
    }

    match /settings/{docId} {
      allow read: if isLead();
      allow write: if isLead();
    }

    match /assignments/{assignmentId} {
      allow read: if isLead()
        || (signedIn() && request.auth.uid in resource.data.assigneeIds);
      allow create, update, delete: if isLead();

      match /updates/{updateId} {
        // The update doc id is `${assigneeId}_${date}`, so its prefix proves
        // ownership without a parent lookup when the doc doesn't exist yet
        // (the assignee's first write of the day).
        allow read: if isLead()
          || (signedIn()
              && (resource == null
                  ? updateId.matches(request.auth.uid + '_.*')
                  : resource.data.assigneeId == request.auth.uid));
        allow create, update: if signedIn()
          && request.resource.data.assigneeId == request.auth.uid
          && updateId.matches(request.auth.uid + '_.*')
          && request.auth.uid in
            get(/databases/$(database)/documents/assignments/$(assignmentId)).data.assigneeIds;
        // The lead also needs delete here so removeAssignment's cascade can
        // clean up every assignee's updates, not only its own.
        allow delete: if isLead()
          || (signedIn() && resource.data.assigneeId == request.auth.uid);

        match /images/{imageId} {
          allow read: if isLead()
            || (signedIn() && updateId.matches(request.auth.uid + '_.*'));
          allow create, update: if signedIn()
            && updateId.matches(request.auth.uid + '_.*')
            && request.auth.uid in
              get(/databases/$(database)/documents/assignments/$(assignmentId)).data.assigneeIds;
          allow delete: if isLead()
            || (signedIn() && updateId.matches(request.auth.uid + '_.*'));
        }
      }
    }
  }
}
```

Security intent:

- Authenticated developers can read and write their own report tree.
- Developers may read a nonexistent own-report document so the client's get-or-create flow works; `list` on `reports` stays lead-only.
- A brand-new developer may create their own `users` profile with `role: 'dev'`; only the admin console or the seed script can grant `lead`.
- Only users with `role: 'lead'` can create or update `leadNotes`; the report owner may also delete them so removing a task or section cleans up its lead feedback.
- Only users with `role: 'lead'` can write `questions.selectedAnswer`, `questions.answeredBy`, and `questions.answeredAt`.
- Only users with `role: 'lead'` can create `leadQuestions`; the lead or the report owner may delete them (task/section cleanup); the report owner may update a `leadQuestions` document only to set `answerText`, `selectedAnswer`, `answeredAt`, and `answerLinks`. A `leadQuestions` answer's `images` follow the same read shape as task images: the report owner creates them (attaching an image to their own answer) and either the report owner or the lead can delete them, since `removeLeadQuestion` also cascades to them.
- Only users with `role: 'lead'` can read or write `settings/team`, which stores the lead's chosen developer ordering for the "Team" list and the reports rollup.
- Firestore documents are limited to 1 MB; DailyBit stores each task image in its own document and compresses each image client-side before saving it to stay under that per-document limit.
- Only users with `role: 'lead'` can create, update, or delete `assignments`; an assignee can only read the assignments that list their uid in `assigneeIds`.
- An assignee can create or update only their own `updates` doc (id `${assigneeId}_${date}`), and only while they're still listed in the parent assignment's `assigneeIds`; the lead can read and delete any assignee's `updates`/`images` so `removeAssignment` can cascade-delete them.

> **Note:** the lead's private-notes collection was renamed to `leadNotes`, and the old team-wide prompts collection was removed in favor of per-task `leadQuestions`. If your Firestore security rules were already deployed with the previous shape, redeploy the rules above before using this build, or lead notes/questions will be rejected.
>
> **Note:** the `settings/team` rule is new. If your Firestore security rules were already deployed without it, redeploy the rules above before using this build, or saving the lead's team order will be rejected.
>
> **Note:** the `assignments` collection (and its `updates`/`images` subcollections) is new. If your Firestore security rules were already deployed without it, redeploy the rules above before using this build, or creating/answering lead assignments will be rejected.
>
> **Note:** `leadQuestions.answerLinks` and the `leadQuestions/{questionId}/images` subcollection are new. If your Firestore security rules were already deployed without them, redeploy the rules above before using this build, or saving link/image attachments on a text answer will be rejected.

## Usage

### DeveloperView

- Creates the report document for the selected date on the developer's first write (adding a main title, or a question to the lead when there are none yet) — opening or viewing a date never creates a report.
- Saves section titles, tasks, compressed Base64 image data URLs, links, and questions as the developer edits.
- Keeps task descriptions short with a 140-character limit.
- Lets developers attach compressed images directly in Firestore, add supporting links, send multiple-choice questions to the lead, and answer the lead's per-task questions (free text, with its own supporting links and images, or by picking an option).
- Shows an "Assigned by lead" block above the report when the developer has at least one assignment visible on the selected date, with a "Pending"/"Updated" pill per assignment; each is answered with its own daily text/links/images update, independent of the report (it works even with no report for that date).

### LeadView

- Shows a date-based rollup of submitted reports, including reported count for the team.
- Displays each developer's sections, tasks, links, Firestore-stored images, and questions in realtime.
- Hovering a task reveals "Question" and "Note" buttons; a task can have several of each.
- Lets the lead ask a developer a per-task question (free text or multiple choice) and leave per-task notes; a free-text answer's links and images show alongside its text.
- Lets the lead answer developer questions.
- Shows a "Team" list with the lead's developers, in the same order the reports appear; the lead can reorder it (drag-and-drop or up/down buttons), which also reorders the reports. Clicking a name scrolls to that developer's report.

## Data model

| Collection/path | Purpose |
| --- | --- |
| `users/{uid}` | User profile and role: `{ name, role: 'dev' | 'lead' }`. |
| `reports/{userId}_{date}` | One report per user per day; stores `userId`, `date`, `createdAt`, and `updatedAt`. |
| `reports/{reportId}/sections/{sectionId}` | Ordered group headings for a daily report. |
| `reports/{reportId}/sections/{sectionId}/tasks/{taskId}` | Short task updates with optional `links` and `order`. |
| `reports/{reportId}/sections/{sectionId}/tasks/{taskId}/images/{imageId}` | Task image document with `imageBase64` data URL and `createdAt`; one doc per image, so the 1 MB limit applies per image doc. |
| `reports/{reportId}/questions/{questionId}` | Developer-to-lead multiple-choice questions and the lead's selected answer. |
| `reports/{reportId}/leadNotes/{noteId}` | The lead's private notes for a report or task; `targetTaskId` is empty for report-level notes. |
| `reports/{reportId}/leadQuestions/{questionId}` | The lead's question to the report owner (`kind: 'text' | 'options'`) and the owner's answer; `taskId`/`sectionId` are empty for report-level questions. A `'text'` answer may also include `answerLinks`. |
| `reports/{reportId}/leadQuestions/{questionId}/images/{imageId}` | Image attached to a `'text'` lead question's answer; same one-doc-per-image shape as task images. |
| `settings/team` | The lead's saved developer ordering: `{ memberOrder: string[], updatedAt }`, where `memberOrder` is an ordered list of developer uids. Drives both the "Team" list and the reports rollup order in LeadView. |
| `assignments/{assignmentId}` | A lead-created task assigned to one or more developers: `{ description, assigneeIds, createdBy, startDate, status: 'open' | 'closed', closedDate?, createdAt, updatedAt }`. Visible on a date when `startDate <= date` and the assignment is still `'open'` or `closedDate >= date`. Independent of `reports`. |
| `assignments/{assignmentId}/updates/{assigneeId}_{date}` | One assignee's daily answer to an assignment: `{ assigneeId, date, text?, links, createdAt, updatedAt }`. |
| `assignments/{assignmentId}/updates/{updateId}/images/{imageId}` | Update image document with `imageBase64` data URL and `createdAt`, same one-doc-per-image shape as task images. |

## Roles

| Role | User | View | Permissions in the app |
| --- | --- | --- | --- |
| `dev` | Engineers | DeveloperView | Create and edit their own daily report; add tasks, images, links, and questions to the lead; answer the lead's per-task questions. |
| `lead` | Team lead | LeadView | Read team reports; add per-task notes and questions; answer developer questions. |

## Development

- Work branch: `feature/dailybit-mvp`.
- Feature document: `odd/tasks/dailybit-mvp.md`.
- Commit convention: use focused Conventional Commits, for example `feat: add daily report editor` or `docs: add DailyBit README`.
- Keep tests/checks with the behavior they validate; run `npm run typecheck` before handing off changes.
