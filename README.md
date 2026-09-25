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
| `npm run typecheck:api` | Type-check the `api/` Vercel Functions (`tsc --noEmit -p tsconfig.api.json`). |

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
    images/{imageId}
  leadNotes/{noteId}
  leadQuestions/{questionId}
    images/{imageId}
```

Reports are keyed by `reports/{userId}_{date}` where `date` is `YYYY-MM-DD`. Sections group tasks; tasks can include links and an `images` subcollection of compressed Base64 image data URLs; questions are developer-to-lead multiple-choice decisions, where each option's text may carry supporting `optionDetails[i].links` (parallel to `options`, only stored when at least one option has a link) and an `images` subcollection of compressed Base64 image data URLs tagged with the `optionIndex` they belong to; `leadNotes` are the lead's report-level or task-level notes; `leadQuestions` are the lead's report-level or per-task questions to the report owner (empty `taskId`/`sectionId` means the question is about the report as a whole), answered as free text or by picking one of several options. A free-text (`kind: 'text'`) answer may also include `answerLinks` and an `images` subcollection of compressed Base64 image data URLs, same shape as task images; an options answer stays a plain selected index, with no links or images.

A dev question may optionally carry `sectionId` and `order`: when set, the question is anchored inside that section and interleaved with its tasks (tasks and questions share one `order` space per section, same as `sections/{sectionId}/tasks/{taskId}.order`); when omitted (or empty), the question is report-level. New questions are always asked from a section; older report-level questions still show in a "General questions to the lead" block, which is hidden when there are none. No extra Firestore rule is needed for these fields: `create`/`delete` on `questions/{questionId}` are owner- or lead-controlled, and the `update` allowlist (`questionText`, `options`, `optionDetails`, `order`, plus the answer fields) already covers writing `order` when a section is reordered.

Every `leadQuestions` doc, report-level or task-anchored, also gets a top-level `leadQuestionCarryovers/{reportId}_{questionId}` pointer, written in the same batch that creates the question. It's what keeps an unanswered question showing on later days until the developer answers it, the same way `assignments` stays visible across dates independent of `reports`. A task-anchored question keeps rendering inline in its own task on its own day exactly as before; the pointer only makes it also show up (labeled "About task: ... — Asked on ...") in the "From the lead" panel / carried-question lists on later days. Deleting a task or section deletes any lead questions anchored to it (and their pointers) in the same batch — see `deleteTaskLeadArtifacts`. See "Lead question carry-over" below.

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
      // From the Manage team panel a lead can rename anyone, including
      // themselves. Role changes are NOT allowed here: they go through
      // api/admin-users.ts (firebase-admin) instead, so the last-remaining
      // -lead guard can be enforced atomically in a transaction rather than
      // racily from the client reading every profile's role first.
      allow update: if isLead()
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name'])
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.name.size() <= 80;
      // Full account deletion and role changes are handled server-side by
      // api/admin-users.ts (firebase-admin, which is not bound by these
      // client rules), so delete stays false for the client.
      allow delete: if false;
    }

    match /reports/{reportId} {
      // Allow reading a nonexistent report so the get-or-create flow works:
      // a rule that dereferences get(...).data on a missing doc fails closed
      // and blocks report creation.
      allow get: if isLead()
        || (signedIn()
            && (resource == null || resource.data.userId == request.auth.uid));
      allow list: if isLead();
      // A developer creates their own report as usual. The lead may also
      // create one on a developer's behalf — from the Lead tools panel's
      // note/question actions, when the chosen developer has none yet for
      // the date — but only for that exact developer and date: `userId`
      // must be a real `dev`, and the doc id must follow the
      // `${userId}_${date}` convention (`reportIdFor`), so the lead can't
      // create a report under an arbitrary id or for a non-dev user.
      allow create: if isOwnReportCreate() || (
        isLead() &&
        userProfile(request.resource.data.userId).role == 'dev' &&
        reportId == request.resource.data.userId + '_' + request.resource.data.date
      );
      // A lead editing a developer's report in place (see "Lead edit mode"
      // below) only ever touches `updatedAt`, the same field every dev write
      // below stamps on its parent report.
      allow update: if ownsExistingReport(reportId) || (
        isLead() &&
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['updatedAt'])
      );
      // The lead also needs delete: the Lead tools panel's fan-out (see
      // above) creates a developer's report on demand before writing a
      // note/question, and must clean that empty report back up if the
      // write fails, so a developer with no real report doesn't start
      // showing up as "reported". Rules can't see across requests to check
      // "the lead created this in the same operation", so this is simply
      // `isLead()` for any report; the client only ever calls it right after
      // its own create, never for a report it didn't just make.
      allow delete: if ownsExistingReport(reportId) || isLead();

      match /sections/{sectionId} {
        allow read: if ownsExistingReport(reportId) || isLead();
        allow write: if ownsExistingReport(reportId) || isLead();

        match /tasks/{taskId} {
          allow read: if ownsExistingReport(reportId) || isLead();
          allow write: if ownsExistingReport(reportId) || isLead();

          match /images/{imageId} {
            allow read: if ownsExistingReport(reportId) || isLead();
            allow write: if ownsExistingReport(reportId) || isLead();
          }
        }
      }

      match /questions/{questionId} {
        allow read: if ownsExistingReport(reportId) || isLead();
        allow create, delete: if ownsExistingReport(reportId) || isLead();
        // The report owner or the lead (editing in place) may edit a
        // question's text, options, and per-option links, and reorder it
        // (`order`, from drag-reorder inside a section); only the lead may
        // additionally set `selectedAnswer`/`answeredBy`/`answeredAt`. Either
        // editor may instead *clear* those three answer fields — an edited
        // option set can invalidate the lead's existing answer — but a write
        // that touches them is only allowed when it clears all three (the
        // resulting doc has none of them), never when it sets one, so the
        // owner still can't answer their own question.
        allow update: if (
          ownsExistingReport(reportId) &&
          request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['questionText', 'options', 'optionDetails', 'order', 'selectedAnswer', 'answeredBy', 'answeredAt']) &&
          (
            !request.resource.data.diff(resource.data).affectedKeys()
              .hasAny(['selectedAnswer', 'answeredBy', 'answeredAt']) ||
            (
              !('selectedAnswer' in request.resource.data) &&
              !('answeredBy' in request.resource.data) &&
              !('answeredAt' in request.resource.data)
            )
          )
        ) || (
          isLead() &&
          request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['questionText', 'options', 'optionDetails', 'order', 'selectedAnswer', 'answeredBy', 'answeredAt'])
        );

        // An option's image attachments; same read/write shape as task
        // images. The report owner or the lead (editing in place) creates or
        // deletes them (removeQuestion also cascades deletes). `update` is
        // scoped to `optionIndex` only, so editing a question can remap an
        // image to the option it now belongs to instead of deleting and
        // recreating it when an earlier option is removed.
        match /images/{imageId} {
          allow read: if ownsExistingReport(reportId) || isLead();
          allow create: if ownsExistingReport(reportId) || isLead();
          allow update: if (ownsExistingReport(reportId) || isLead()) &&
            request.resource.data.diff(resource.data).affectedKeys().hasOnly(['optionIndex']);
          allow delete: if ownsExistingReport(reportId) || isLead();
        }
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
        // images. The report owner or the lead (editing in place, answering
        // on the owner's behalf) creates them; either can delete, plus a
        // lead delete so removeLeadQuestion can cascade.
        match /images/{imageId} {
          allow read: if ownsExistingReport(reportId) || isLead();
          allow create: if ownsExistingReport(reportId) || isLead();
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
        // The assignee writes their own update; a lead editing in place
        // writes on the assignee's behalf instead, proven by the doc id
        // prefix matching the `assigneeId` the write itself declares (the
        // lead is never in `assigneeIds`, so it can't reuse the assignee check).
        allow create, update: if (signedIn()
            && request.resource.data.assigneeId == request.auth.uid
            && updateId.matches(request.auth.uid + '_.*')
            && request.auth.uid in
              get(/databases/$(database)/documents/assignments/$(assignmentId)).data.assigneeIds)
          || (isLead() && updateId.matches(request.resource.data.assigneeId + '_.*'));
        // The lead also needs delete here so removeAssignment's cascade can
        // clean up every assignee's updates, not only its own.
        allow delete: if isLead()
          || (signedIn() && resource.data.assigneeId == request.auth.uid);

        match /images/{imageId} {
          allow read: if isLead()
            || (signedIn() && updateId.matches(request.auth.uid + '_.*'));
          allow create, update: if isLead()
            || (signedIn()
                && updateId.matches(request.auth.uid + '_.*')
                && request.auth.uid in
                  get(/databases/$(database)/documents/assignments/$(assignmentId)).data.assigneeIds);
          allow delete: if isLead()
            || (signedIn() && updateId.matches(request.auth.uid + '_.*'));
        }
      }
    }

    // One pointer per `leadQuestions` doc (report-level or task-anchored),
    // doc id `${reportId}_${questionId}`, so an unanswered question keeps
    // showing on later days without re-reading every past report. The lead
    // owns create (same lifecycle as the question itself) and may also
    // update any field, unrestricted — including clearing `answeredDate` in
    // the same batch as the question edit when clearing an answer (see
    // `updateLeadQuestion`); the recipient dev may update the pointer only
    // to set `answeredDate`. Delete is `isLead()` or the recipient dev,
    // because a task-anchored question's pointer must be deletable in the
    // same batch as `deleteTaskLeadArtifacts` — which the report owner (not
    // just the lead) can trigger by deleting their own task/section; scoped
    // to `userId == request.auth.uid` so a dev can only ever delete their
    // own pointers, never another developer's.
    match /leadQuestionCarryovers/{pointerId} {
      allow read: if isLead()
        || (signedIn() && resource.data.userId == request.auth.uid);
      allow create: if isLead();
      allow delete: if isLead()
        || (signedIn() && resource.data.userId == request.auth.uid);
      allow update: if isLead()
        || (signedIn()
            && resource.data.userId == request.auth.uid
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['answeredDate']));
    }
  }
}
```

Security intent:

- Authenticated developers can read and write their own report tree.
- Developers may read a nonexistent own-report document so the client's get-or-create flow works; `list` on `reports` stays lead-only.
- A brand-new developer may create their own `users` profile with `role: 'dev'`; only the admin console or the seed script can grant `lead`.
- **Manage team panel:** the only client write a lead can make to another user's profile is renaming it (the `users/{uid}` update rule allows the `name` field only, 1–80 characters). Role changes (dev ↔ lead) and full account deletion both go through `api/admin-users.ts` (via `firebase-admin`, which bypasses these client rules), where self role changes, self-deletion and removing or demoting the last remaining lead are refused inside a transaction; `users/{uid}` delete stays `false` for the client.
- **Lead edit mode:** with the "Edit mode" switch on, LeadView renders the same `EditableReport` editor DeveloperView uses, letting the lead fix a developer's sections, tasks, links, images, dev questions (and their options/images), and assignment updates in place. The rules below grant `isLead()` every dev-owned write path the editor touches, so those writes succeed for the lead exactly as they do for the report owner. The editor itself never creates a report: a developer with no report for the date stays read-only in edit mode.
- **Lead tools panel — create for chosen developers:** the lead's Question/Note/Task actions (in the "Lead tools" panel under the Team list) can target a developer who has no report yet for the selected date. In that case the client calls `ensureReport`/`ensureReportWithStatus` for that developer before writing the note/question, which needs the lead to be able to create the developer's report doc. `reports` `create` therefore also allows `isLead()`, tightly scoped: the new doc's `userId` must belong to a real `role: 'dev'` user, and the report id must be exactly `${userId}_${date}` (the `reportIdFor` convention), so the lead can only ever create that one developer's report for that one date, never an arbitrary document. If the following note/question write then fails for a report the lead's own call just created, the client best-effort deletes that empty report so the developer doesn't end up looking "reported" with nothing in it; `reports` `delete` therefore also allows `isLead()` for any report — rules can't verify "created in this same client operation" across requests, so this is scoped only by the client only ever calling it right after its own create.
- Only users with `role: 'lead'` can create or update `leadNotes`; the report owner may also delete them so removing a task or section cleans up its lead feedback.
- The report owner or the lead (editing in place) can create or delete `questions`, and edit a question's `questionText`, `options`, `optionDetails`, and `order`; only the lead can additionally *set* `selectedAnswer`, `answeredBy`, and `answeredAt` — the owner may only *clear* all three together (a stale answer after an option edit), never set one, since a write that touches them is rejected unless the resulting document has none of them. A dev question's option image attachments follow the same read shape as task images: the report owner or the lead creates or deletes them (also cascaded by `removeQuestion`), and either may update an image's `optionIndex` alone, to remap it to its option's new index when an edit removes or reorders options instead of deleting and recreating the image.
- Only users with `role: 'lead'` can create `leadQuestions`; the lead or the report owner may delete them (task/section cleanup); the report owner may update a `leadQuestions` document only to set `answerText`, `selectedAnswer`, `answeredAt`, and `answerLinks`, while the lead may update any field (unrestricted, since it also owns question creation). A `leadQuestions` answer's `images` follow the same read shape as task images: the report owner or the lead (answering on the owner's behalf) creates them, and either can delete them, since `removeLeadQuestion` also cascades to them.
- Only users with `role: 'lead'` can read or write `settings/team`, which stores the lead's chosen developer ordering for the "Team" list and the reports rollup.
- Firestore documents are limited to 1 MB; DailyBit stores each task image in its own document and compresses each image client-side before saving it to stay under that per-document limit.
- Only users with `role: 'lead'` can create, update, or delete `assignments`; an assignee can only read the assignments that list their uid in `assigneeIds`.
- An assignee can create or update only their own `updates` doc (id `${assigneeId}_${date}`), and only while they're still listed in the parent assignment's `assigneeIds`; a lead editing in place may create or update any assignee's `updates`/`images` doc instead, proven by the doc id prefix matching the write's own `assigneeId` field rather than the lead's uid. The lead can also read and delete any assignee's `updates`/`images` so `removeAssignment` can cascade-delete them.
- Only users with `role: 'lead'` can create `leadQuestionCarryovers`, and the lead may also update or delete any of them, unrestricted; a developer can read only the pointers where `userId` is their own uid (the lead reads all of them), can delete only their own (`userId == auth.uid`, needed so deleting their own task/section can also delete that task-anchored question's pointer), and can update a pointer only to set `answeredDate`, and no other field.

> **Note:** the lead's private-notes collection was renamed to `leadNotes`, and the old team-wide prompts collection was removed in favor of per-task `leadQuestions`. If your Firestore security rules were already deployed with the previous shape, redeploy the rules above before using this build, or lead notes/questions will be rejected.
>
> **Note:** the `settings/team` rule is new. If your Firestore security rules were already deployed without it, redeploy the rules above before using this build, or saving the lead's team order will be rejected.
>
> **Note:** the `assignments` collection (and its `updates`/`images` subcollections) is new. If your Firestore security rules were already deployed without it, redeploy the rules above before using this build, or creating/answering lead assignments will be rejected.
>
> **Note:** the `leadQuestionCarryovers` collection is new (lead question carry-over across dates). If your Firestore security rules were already deployed without it, redeploy the rules above before using this build, or sending a report-level lead question, deleting one, clearing/editing one's answer, or a developer answering an older one will be rejected.
>
> **Note:** task-anchored lead questions now also carry over (every lead question gets a pointer, not just report-level ones), and `leadQuestionCarryovers` `delete` widened from lead-only to also allow the recipient dev to delete their own pointer (`userId == auth.uid`). If your Firestore security rules were already deployed with the previous lead-only `delete` rule, redeploy the rules above before using this build, or a developer deleting their own task/section that has a lead question attached will fail (the batch that also deletes its pointer gets rejected).
>
> **Note:** `leadQuestions.answerLinks` and the `leadQuestions/{questionId}/images` subcollection are new. If your Firestore security rules were already deployed without them, redeploy the rules above before using this build, or saving link/image attachments on a text answer will be rejected.
>
> **Note:** lead edit mode is new and widens `isLead()` write access onto `reports.updatedAt`, `sections`/`tasks`/`images`, `questions` (create/delete/`order`), `questions/{questionId}/images`, `leadQuestions/{questionId}/images`, and `assignments/{assignmentId}/updates` (and their `images`). If your Firestore security rules were already deployed without these, redeploy the rules above before using this build, or the lead's in-place edits will be rejected.
>
> **Note:** `questions.optionDetails` and the `questions/{questionId}/images` subcollection are new. If your Firestore security rules were already deployed without the `questions/{questionId}/images` match block, redeploy the rules above before using this build, or attaching a link/image to a dev question's option will be rejected.
>
> **Note:** editing an existing dev question (text, options, per-option links/images) is new. The `questions/{questionId}` `update` rule changed shape — from "the owner may write any field except the answer ones" to an explicit allowlist that also lets the owner clear (never set) a stale answer — and `questions/{questionId}/images` gained an `update` rule scoped to `optionIndex`. If your Firestore security rules were already deployed with the previous shape, redeploy the rules above before using this build, or editing a dev question will be rejected.
>
> **Note:** the Lead tools panel's Question/Note/Task actions for chosen developers are new. `reports` `create` widened from owner-only to also allow `isLead()` for a single developer/date pair (`userId` a real `dev`, doc id `${userId}_${date}`). If your Firestore security rules were already deployed with the previous owner-only `create` rule, redeploy the rules above before using this build, or the lead's create-for-a-developer-with-no-report action will be rejected.
>
> **Note:** `reports` `delete` widened from owner-only to also allow `isLead()`, so the Lead tools panel's fan-out can clean up an empty report it just created for a developer when the following note/question write fails. If your Firestore security rules were already deployed with the previous owner-only `delete` rule, redeploy the rules above before using this build, or that cleanup will silently fail and leave an empty report behind (the original note/question failure still surfaces to the lead either way).
>
> **Note:** the `users/{uid}` `update` rule is new (a lead renaming anyone from the Manage team panel). Role changes are NOT part of this rule — they go through `api/admin-users.ts` instead (see [Team management](#team-management)) — so if your rules previously allowed a lead to write `role` directly, redeploy the rules above to close that off. If your Firestore security rules were already deployed with the original `allow update, delete: if false;` rule, redeploy the rules above before using this build, or renames from the panel will be rejected.

## Usage

### DeveloperView

- Creates the report document for the selected date on the developer's first write (adding a main title, or a question to the lead when there are none yet) — opening or viewing a date never creates a report.
- Saves section titles, tasks, compressed Base64 image data URLs, links, and questions as the developer edits.
- Caps task descriptions at 500 characters.
- Lets developers attach compressed images directly in Firestore, add supporting links, send multiple-choice questions to the lead, and answer the lead's per-task questions (free text, with its own supporting links and images, or by picking an option).
- A question to the lead is added from inside a section via its "Ask the lead" entry next to "Add task" (the report-level composer was removed; older report-level questions stay visible in a "General questions to the lead" block). A section question is interleaved with that section's tasks by shared `order` and can be moved up/down or dragged past a task, same as a task; it takes no letter of its own (tasks stay lettered `a, b, c…` over tasks only) and shows a small "Question" badge instead.
- An existing question can be edited from its pencil icon, reopening the same composer prefilled with its text, options, links and images to add, rename, or remove options and attachments. Removing or reordering options remaps their images to the option's new position instead of losing them; if the option set or order changed (or the lead's already-selected option no longer matches), the lead's answer is cleared so it can't point at the wrong option.
- Shows an "Assigned by lead" block above the report when the developer has at least one assignment visible on the selected date, with a "Pending"/"Updated" pill per assignment; each is answered with its own daily text/links/images update, independent of the report (it works even with no report for that date).
- An unanswered lead question — report-level or task-anchored — keeps showing in the "From the lead" panel on every later day, labeled "Asked on {origin date}" (a task-anchored one also shows "About task: {origin task description} — "), until the developer answers it; answering, editing, or attaching an image still targets the day it was originally asked, not the day it's shown on. A task-anchored question also keeps rendering inline in its own task on its own day, exactly as before. "Preview as lead" shows the same carried-over questions read-only.

### LeadView

- Shows a date-based rollup of submitted reports, including reported count for the team.
- Displays each developer's sections, tasks, links, Firestore-stored images, and questions in realtime.
- Hovering a task reveals "Question" and "Note" buttons; a task can have several of each.
- Lets the lead ask a developer a per-task question (free text or multiple choice) and leave per-task notes; a free-text answer's links and images show alongside its text.
- Lets the lead answer developer questions, including a section question, answered right where it appears among that section's tasks; only report-level questions (no `sectionId`) show in the trailing "Questions from {developer}" block, which stays hidden when there are none.
- A developer's unanswered lead questions from earlier days — report-level or task-anchored — show under their card too, labeled "Asked on {origin date}" (task-anchored also shows "About task: {origin task description} — ") — even on a date the developer has no report for, alongside their assignments — and stay editable/removable there, targeting the day the question was originally asked. They count toward the "Only my questions & tasks" filter the same as today's lead questions.
- Shows a "Team" list with the lead's developers, in the same order the reports appear; the lead can reorder it (drag-and-drop or up/down buttons), which also reorders the reports. Clicking a name scrolls to that developer's report.
- A collapsible "Lead tools" panel sits right below the Team list, in the same sticky column so both stay visible while scrolling. It holds the "Only my questions & tasks" and "Edit mode" switches (moved out of the top header), plus Question/Note/Task actions for one or more chosen developers: a Task opens `AssignmentComposer` with no preselected developer (multi-select); a Note/Question opens the usual composer next to a developer picker and, on submit, writes a report-level note/question to each selected developer's report for the currently selected date in parallel — creating that developer's report first if they don't have one yet for the date. A partial failure keeps the composer open, lists which developers failed by name, and narrows the selection to just those so retrying never re-sends to the ones that already succeeded.

## Data model

| Collection/path | Purpose |
| --- | --- |
| `users/{uid}` | User profile and role: `{ name, role: 'dev' | 'lead' }`. |
| `reports/{userId}_{date}` | One report per user per day; stores `userId`, `date`, `createdAt`, and `updatedAt`. |
| `reports/{reportId}/sections/{sectionId}` | Ordered group headings for a daily report. |
| `reports/{reportId}/sections/{sectionId}/tasks/{taskId}` | Short task updates with optional `links` and `order`. |
| `reports/{reportId}/sections/{sectionId}/tasks/{taskId}/images/{imageId}` | Task image document with `imageBase64` data URL and `createdAt`; one doc per image, so the 1 MB limit applies per image doc. |
| `reports/{reportId}/questions/{questionId}` | Developer-to-lead multiple-choice questions and the lead's selected answer. `optionDetails?: { links }[]` is parallel to `options` (only stored when at least one option has a link). Optional `sectionId`/`order` anchor the question inside a section, interleaved with its tasks; omitted (or empty `sectionId`) means a report-level question. |
| `reports/{reportId}/questions/{questionId}/images/{imageId}` | An option's image attachment: `{ imageBase64, optionIndex, createdAt }`; one doc per image, same one-doc-per-image shape as task images. |
| `reports/{reportId}/leadNotes/{noteId}` | The lead's private notes for a report or task; `targetTaskId` is empty for report-level notes. |
| `reports/{reportId}/leadQuestions/{questionId}` | The lead's question to the report owner (`kind: 'text' | 'options'`) and the owner's answer; `taskId`/`sectionId` are empty for report-level questions. A `'text'` answer may also include `answerLinks`. |
| `reports/{reportId}/leadQuestions/{questionId}/images/{imageId}` | Image attached to a `'text'` lead question's answer; same one-doc-per-image shape as task images. |
| `leadQuestionCarryovers/{reportId}_{questionId}` | Pointer for a `leadQuestions` doc, report-level or task-anchored: `{ userId, reportId, questionId, date, answeredDate?, createdAt }`, where `date` is the origin report's date and `userId` is the recipient developer. On a later date D, the client subscribes to the origin question when `date < D` and (`answeredDate` is unset or `answeredDate >= D`) — a cheap prefilter to skip a long-answered question — then decides real visibility from the origin question's own `answeredAt`: unanswered, or answered on/after D. A task-anchored one also fetches its origin task's description (`reports/{reportId}/sections/{sectionId}/tasks/{taskId}`), one-time, for the "About task: ..." context on the carried item. Keeps an unanswered question showing on later days until answered, independent of `reports`, same as `assignments`. |
| `settings/team` | The lead's saved developer ordering: `{ memberOrder: string[], updatedAt }`, where `memberOrder` is an ordered list of developer uids. Drives both the "Team" list and the reports rollup order in LeadView. |
| `assignments/{assignmentId}` | A lead-created task assigned to one or more developers: `{ description, assigneeIds, createdBy, startDate, status: 'open' | 'closed', closedDate?, createdAt, updatedAt }`. Visible on a date when `startDate <= date` and the assignment is still `'open'` or `closedDate >= date`. Independent of `reports`. |
| `assignments/{assignmentId}/updates/{assigneeId}_{date}` | One assignee's daily answer to an assignment: `{ assigneeId, date, text?, links, createdAt, updatedAt }`. |
| `assignments/{assignmentId}/updates/{updateId}/images/{imageId}` | Update image document with `imageBase64` data URL and `createdAt`, same one-doc-per-image shape as task images. |

## AI polish

DeveloperView has a "Polish with AI" (sparkle) action next to a task description, the dev→lead question text, a lead question's free-text answer, and an assignment's daily update text. It sends the current field text to the `api/polish` Vercel Function, which asks OpenAI to rewrite it into a clear, English, stand-up-ready sentence while keeping every concrete fact (ticket IDs, names, numbers, link text). The suggestion is shown inline with "Use" and "Keep mine"; nothing is ever auto-replaced.

### How it works

- The client (`src/services/polish.ts`) reads the signed-in developer's Firebase ID token and calls `POST /api/polish` with `{ kind, text, questionContext? }`.
- `api/polish.ts` is a Vercel Function (Node runtime). It verifies the ID token against Google's public JWKS (no Firebase Admin SDK needed), validates and length-limits the input, applies a simple per-user rate limit, and calls the OpenAI Chat Completions API with a fixed system prompt per `kind` (`task`, `question`, `answer`, or `option` — an answer choice of a multiple-choice question, polished with the question as context). For `answer` and `option`, the model first checks that the text actually answers the question (JSON mode); an unrelated answer or option returns `422` with a "doesn't seem to address the question" message instead of a suggestion.
- The OpenAI API key never leaves the server: it is read from `OPENAI_API_KEY` and is never echoed back to the client, logged, or included in error responses.
- `npm run dev` (Vite only) does not serve `/api/*`. Test this feature locally with `vercel dev` instead, which runs both the Vite app and the Vercel Functions together.

### Configuration (Vercel project)

| Env var | Required | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes | Server-only secret. **Never** prefix it with `VITE_`, or it would be bundled into the client. Add it with `vercel env add OPENAI_API_KEY production --type secret` (repeat for `preview`/`development` as needed). |
| `OPENAI_MODEL` | No | Defaults to `gpt-4.1-nano`. Set to override the model. |
| `FIREBASE_PROJECT_ID` | No | Falls back to `VITE_FIREBASE_PROJECT_ID` if unset; only needed if the server should use a different project id than the client. |

### Cost note

`gpt-4.1-nano` is a small, non-reasoning model; each polish call is capped at `max_tokens: 200` with `temperature: 0.2`, so a typical request costs a small fraction of a cent. The per-user rate limit (30 requests / 10 minutes, per serverless instance, best effort) is an additional abuse guard, not a budget control.

## Team management

The lead-only Manage team panel (opened from the people icon next to the top bar's "Sign out") lists every user, lets the lead rename anyone, change a person's role (dev ↔ lead), and fully delete a team member's account after an inline "Are you sure?" confirmation (Yes / No — no browser `confirm()` dialogs). Renaming is a plain client-side Firestore write (`updateUserName` in `src/services/firestore.ts`, allowed by the `users/{uid}` `update` rule above); role changes and deletion are both server-side, described below.

- **Role change** and **full delete** both go through `api/admin-users.ts` (Vercel Function, Firebase Admin SDK), not a plain client Firestore write. Both need to atomically check "is this the last remaining lead?" against a fresh read of every profile's role, which a Firestore security rule can't safely express (a rule sees one document write at a time, not a consistent snapshot across a query plus a write) — so both run inside a Firestore transaction on the server instead. A lead can't change their own role or delete their own account, and the last remaining lead can't be demoted or deleted; all four are enforced server-side, not just in the UI (the UI still disables the controls as a convenience).
- **Full delete** removes the person everywhere: their Firebase Auth login (disabled and its refresh tokens revoked before anything else is touched, then removed at the end), `users/{uid}` profile, all their `reports` (recursively, with sections/tasks/images/questions/etc.), their `leadQuestionCarryovers` pointers (a top-level collection, so the recursive report delete above never reaches it — deleted separately, by `userId == uid`), their assignment `updates` (and those updates' images) across every assignment they're assigned to (removed from `assigneeIds` inside a transaction that re-reads the assignment first, deleting the assignment if no assignees remain), and their id in `settings/team.memberOrder`. This can't be expressed safely as a client-side Firestore rule (it needs to delete the Auth login too), so it runs server-side with the Firebase Admin SDK.
- **Residual session risk (accepted):** disabling the Auth user and revoking its refresh tokens stops the person from getting a *new* ID token, but an ID token issued just before deletion stays valid for Firestore requests until it naturally expires (at most ~1 hour) — Firestore has no built-in per-request revocation check. Given the short window and that all their data is being deleted moments later anyway, this is accepted rather than engineered around.
- **In-progress marker:** right after the last-lead check passes, the target's `users/{uid}` doc is marked `removing: true` (and, if they were a lead, their `role` is flipped to `'dev'` in the same transaction) so a second, concurrent delete/role-change request sees the change immediately instead of racing on stale data. This is a transient, server-only marker — the client never reads or writes it — so a person mid-deletion may briefly show as `dev` in the Manage/Lead views before their row disappears; deleting an already-marked target (e.g. retrying after a timeout) skips straight to the cascade instead of re-running the guard.

### How it works

- The client (`src/services/adminUsers.ts`) reads the signed-in lead's Firebase ID token and calls `POST /api/admin-users` with `{ action: 'delete', uid }` or `{ action: 'setRole', uid, role }`.
- `api/admin-users.ts` (Node runtime) verifies the ID token the same way `api/polish.ts` does (Google's public JWKS, no extra round trip), then initializes `firebase-admin` from a service account and checks the caller's own `users/{uid}.role` is `'lead'` before doing anything else.
- The service account key never leaves the server: it's read from `FIREBASE_SERVICE_ACCOUNT` (or `FIREBASE_SERVICE_ACCOUNT_BASE64`) and is never echoed back to the client, logged, or included in error responses.
- The function declares `export const config = { maxDuration: 60 }` (Vercel's per-function time budget) and deletes someone's reports/assignment-updates with bounded concurrency (5 at a time) rather than strictly one by one, so a person with a lot of history is less likely to time the delete out. Every step is idempotent, so retrying a timed-out or failed delete finishes the job instead of redoing (or breaking on) what already happened.
- A 404 from this endpoint ("That user no longer exists.") is shown by the client as-is; the ManagePanel treats it as the row already being gone (it disappears via the realtime profile list) rather than as a failure. The `vercel dev` hint below is only shown when the response isn't JSON from this function at all (e.g. Vite's own HTML 404 page), which is how a missing/undeployed endpoint is told apart from the endpoint's own 404.
- `npm run dev` (Vite only) does not serve `/api/*`. Test this feature locally with `vercel dev` instead, which runs both the Vite app and the Vercel Functions together.

### Configuration (Vercel project)

| Env var | Required | Notes |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | Yes (or the `_BASE64` variant below) | The full service account JSON as a string. Get it from **Firebase Console > Project settings > Service accounts > Generate new private key**, then paste the downloaded JSON's contents as this variable's value. Add it with `vercel env add FIREBASE_SERVICE_ACCOUNT production --type secret` (repeat for `preview`/`development` as needed). |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | No | Same JSON, base64-encoded; used only if `FIREBASE_SERVICE_ACCOUNT` is unset. Useful when a hosting UI mangles multi-line/quoted JSON env values. |
| `FIREBASE_PROJECT_ID` | No | Shared with `api/polish.ts`; falls back to `VITE_FIREBASE_PROJECT_ID` if unset. |

## Roles

| Role | User | View | Permissions in the app |
| --- | --- | --- | --- |
| `dev` | Engineers | DeveloperView | Create and edit their own daily report; add tasks, images, links, and questions to the lead; answer the lead's per-task questions. |
| `lead` | Team lead | LeadView | Read team reports; add per-task notes and questions; answer developer questions; create notes/questions/tasks for chosen developers (creating their report if they don't have one yet for the date). |

## Development

- Work branch: `feature/dailybit-mvp`.
- Feature document: `odd/tasks/dailybit-mvp.md`.
- Commit convention: use focused Conventional Commits, for example `feat: add daily report editor` or `docs: add DailyBit README`.
- Keep tests/checks with the behavior they validate; run `npm run typecheck` before handing off changes.
