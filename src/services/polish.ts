import { auth } from '../firebase';

export type PolishKind = 'task' | 'question' | 'answer' | 'option';

export interface PolishTextInput {
  kind: PolishKind;
  text: string;
  questionContext?: string;
}

/**
 * User-facing error from the AI polish flow; `message` is always short and
 * safe to show inline. `exampleAnswer` is set only when an `answer` kind is
 * rejected as off-topic (see `api/polish.ts`'s `ANSWER_RELEVANCE_INSTRUCTIONS`):
 * an example of what a good answer could look like, for the caller to offer
 * as a starting point.
 */
export class PolishError extends Error {
  exampleAnswer?: string;

  constructor(message: string, exampleAnswer?: string) {
    super(message);
    this.exampleAnswer = exampleAnswer;
  }
}

export interface PolishTextResult {
  suggestion: string;
  // `'partial'` only for a relevant-but-incomplete `answer` (see
  // `api/polish.ts`); every other kind/result is `'ok'`.
  status: 'ok' | 'partial';
}

/**
 * Sends the developer's text to the `/api/polish` Vercel Function for an
 * English, stand-up-ready rewrite. Never replaces the caller's field value:
 * the caller decides whether to use the returned suggestion.
 */
export async function polishText({ kind, text, questionContext }: PolishTextInput): Promise<PolishTextResult> {
  const user = auth.currentUser;
  if (!user) {
    throw new PolishError('You must be signed in to use AI polish.');
  }

  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch {
    throw new PolishError('Could not verify your session. Please try again.');
  }

  let response: Response;
  try {
    response = await fetch('/api/polish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ kind, text, questionContext }),
    });
  } catch {
    throw new PolishError('AI polish is unavailable right now. Please try again.');
  }

  if (response.ok) {
    const data = (await response.json().catch(() => null)) as { suggestion?: string; status?: string } | null;
    if (data && typeof data.suggestion === 'string' && data.suggestion.trim().length > 0) {
      return { suggestion: data.suggestion, status: data.status === 'partial' ? 'partial' : 'ok' };
    }
    throw new PolishError('AI polish returned an unexpected response.');
  }

  if (response.status === 401) {
    throw new PolishError('Your session expired. Please sign in again.');
  }
  if (response.status === 429) {
    throw new PolishError('Too many polish requests. Please wait a bit and try again.');
  }
  if (response.status === 400) {
    throw new PolishError('That text could not be polished. Try shortening it.');
  }

  if (response.status === 404) {
    throw new PolishError('AI polish is not available here. Run the app with `vercel dev`.');
  }

  const failure = (await response.json().catch(() => null)) as { error?: string; exampleAnswer?: string } | null;
  throw new PolishError(
    failure?.error ?? 'AI polish failed. Please try again.',
    typeof failure?.exampleAnswer === 'string' ? failure.exampleAnswer : undefined,
  );
}
