# DailyBit

DailyBit replaces the shared Word document used for daily stand-up updates: developers submit grouped daily updates, and Ryan gets a consolidated realtime dashboard for the team.

## What it does

DailyBit has two role-based views:

- **DeveloperView**: each developer maintains their own daily report.
- **RyanView**: Ryan sees the team's reports for a selected date and can respond in place.

The app routes users by `users/{uid}.role`: `dev` users see DeveloperView; `lead` users see RyanView.

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
| `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` in the Firebase web app config. |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` in the Firebase web app config. |
| `VITE_FIREBASE_APP_ID` | `appId` in the Firebase web app config. |

`.env.local` template:

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
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

Ryan must have `role: 'lead'`. The app uses this role to choose RyanView instead of DeveloperView.

### 3. Firestore structure

Summary:

```text
users/{uid}
reports/{userId}_{date}
  sections/{sectionId}
    tasks/{taskId}
  questions/{questionId}
  ryanNotes/{noteId}
teamQuestions/{questionId}
```

Reports are keyed by `reports/{userId}_{date}` where `date` is `YYYY-MM-DD`. Sections group tasks; tasks can include an image URL and links; questions are developer-to-Ryan multiple-choice decisions; `ryanNotes` are Ryan's report-level or task-level notes; `teamQuestions` are Ryan's multiple-choice questions to the team.

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

    function reportOwner(reportId) {
      return get(/databases/$(database)/documents/reports/$(reportId)).data.userId;
    }

    function ownsExistingReport(reportId) {
      return signedIn() && reportOwner(reportId) == request.auth.uid;
    }

    function isOwnReportCreate() {
      return signedIn() && request.resource.data.userId == request.auth.uid;
    }

    match /users/{uid} {
      allow read: if signedIn();
      allow write: if false; // Seed users outside the client app.
    }

    match /reports/{reportId} {
      allow read: if ownsExistingReport(reportId) || isLead();
      allow create: if isOwnReportCreate();
      allow update, delete: if ownsExistingReport(reportId);

      match /sections/{sectionId} {
        allow read: if ownsExistingReport(reportId) || isLead();
        allow write: if ownsExistingReport(reportId);

        match /tasks/{taskId} {
          allow read: if ownsExistingReport(reportId) || isLead();
          allow write: if ownsExistingReport(reportId);
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

      match /ryanNotes/{noteId} {
        allow read: if ownsExistingReport(reportId) || isLead();
        allow write: if isLead();
      }
    }

    match /teamQuestions/{questionId} {
      allow read: if signedIn();
      allow write: if isLead();
    }
  }
}

service firebase.storage {
  match /b/{bucket}/o {
    match /reports/{userId}/{date}/{fileName} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Security intent:

- Authenticated developers can read and write their own report tree.
- Only users with `role: 'lead'` can write `ryanNotes`.
- Only users with `role: 'lead'` can write `questions.selectedAnswer`, `questions.answeredBy`, and `questions.answeredAt`.
- Only users with `role: 'lead'` can write `teamQuestions`.
- Authenticated users can upload report files only under `reports/{userId}/{date}/*` for their own `userId`.

## Usage

### DeveloperView

- Creates today's report automatically after sign-in.
- Saves section titles, tasks, images, links, and questions as the developer edits.
- Keeps task descriptions short with a 140-character limit.
- Lets developers attach images, add supporting links, and send multiple-choice questions to Ryan.

### RyanView

- Shows a date-based rollup of submitted reports, including reported count for the team.
- Displays each developer's sections, tasks, links, images, and questions in realtime.
- Lets Ryan add report-level or task-level notes.
- Lets Ryan answer developer questions and post multiple-choice questions to the team.

## Data model

| Collection/path | Purpose |
| --- | --- |
| `users/{uid}` | User profile and role: `{ name, role: 'dev' | 'lead' }`. |
| `reports/{userId}_{date}` | One report per user per day; stores `userId`, `date`, `createdAt`, and `updatedAt`. |
| `reports/{reportId}/sections/{sectionId}` | Ordered group headings for a daily report. |
| `reports/{reportId}/sections/{sectionId}/tasks/{taskId}` | Short task updates with optional `imageUrl`, optional `links`, and `order`. |
| `reports/{reportId}/questions/{questionId}` | Developer-to-Ryan multiple-choice questions and Ryan's selected answer. |
| `reports/{reportId}/ryanNotes/{noteId}` | Ryan's private notes for a report or task; `targetTaskId` is empty for report-level notes. |
| `teamQuestions/{questionId}` | Ryan-to-team multiple-choice prompts. |
| `storage/reports/{userId}/{date}/{fileName}` | Uploaded task images for a user's report date. |

## Roles

| Role | User | View | Permissions in the app |
| --- | --- | --- | --- |
| `dev` | Engineers | DeveloperView | Create and edit their own daily report; add tasks, images, links, and questions to Ryan. |
| `lead` | Ryan | RyanView | Read team reports; add notes; answer developer questions; post team questions. |

## Development

- Work branch: `feature/dailybit-mvp`.
- Feature document: `odd/tasks/dailybit-mvp.md`.
- Commit convention: use focused Conventional Commits, for example `feat: add daily report editor` or `docs: add DailyBit README`.
- Keep tests/checks with the behavior they validate; run `npm run typecheck` before handing off changes.
