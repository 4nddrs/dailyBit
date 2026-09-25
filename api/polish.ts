import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createRemoteJWKSet, jwtVerify } from 'jose';

// Rewrites a developer's short text (task update, question to the lead, or
// free-text answer to the lead) into a clear, English, stand-up-ready
// sentence via OpenAI. The API key stays server-side only: it is read from
// `OPENAI_API_KEY` and never forwarded to, or echoed back to, the client.

export type PolishKind = 'task' | 'question' | 'answer' | 'option';

interface PolishRequestBody {
  kind: PolishKind;
  text: string;
  questionContext?: string;
}

const VALID_KINDS: PolishKind[] = ['task', 'question', 'answer', 'option'];

const MAX_TEXT_LENGTH = 500;
const MAX_CONTEXT_LENGTH = 500;

const KIND_LIMITS: Record<PolishKind, number> = {
  task: 500,
  question: 200,
  answer: 280,
  option: 80,
};

const BASE_SYSTEM_PROMPT = [
  "You rewrite a software developer's short text for a team lead's daily stand-up report.",
  'Always respond in English, no matter what language the input is written in.',
  'Keep every concrete fact from the original text: ticket IDs, names, numbers, and link text. Never invent information that is not present in the original text.',
  'Output only the rewritten text: no preamble, no quotation marks, and no markdown formatting.',
].join(' ');

const KIND_INSTRUCTIONS: Record<PolishKind, string> = {
  task: 'Rewrite it as a status update that starts with a past- or present-tense action verb. Keep it concise, at most 500 characters; use a second or third sentence only when needed to keep every fact.',
  question:
    'Rewrite it as one clear, direct question the lead can answer without needing extra context. At most 200 characters.',
  answer:
    "Rewrite it so it directly answers the question given as context, in 1 to 2 short sentences, at most 280 characters.",
  option:
    'Rewrite it as one answer option for the multiple-choice question given as context: a short, specific phrase that is clearly distinct and directly answers the question, at most 80 characters, without a leading letter or label and without a trailing period.',
};

// Simple per-instance sliding-window rate limit. This resets whenever the
// serverless instance is recycled and is not shared across instances or
// regions, so it is a best-effort abuse guard, not a hard quota.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const requestTimestampsByUid = new Map<string, number[]>();

function isRateLimited(uid: string): boolean {
  const now = Date.now();
  const recentTimestamps = (requestTimestampsByUid.get(uid) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );
  recentTimestamps.push(now);
  requestTimestampsByUid.set(uid, recentTimestamps);
  return recentTimestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

const firebaseProjectId = process.env.FIREBASE_PROJECT_ID ?? process.env.VITE_FIREBASE_PROJECT_ID;

// Cached across warm invocations of the same instance, like the rate limiter.
const firebaseJwks = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

function extractBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith('Bearer ')) {
    return null;
  }
  const token = value.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

async function verifyFirebaseIdToken(token: string): Promise<string> {
  if (!firebaseProjectId) {
    throw new Error('Firebase project id is not configured.');
  }

  const { payload } = await jwtVerify(token, firebaseJwks, {
    issuer: `https://securetoken.google.com/${firebaseProjectId}`,
    audience: firebaseProjectId,
  });

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('Token payload is missing a subject.');
  }

  return payload.sub;
}

type ValidationResult =
  | { ok: true; value: PolishRequestBody }
  | { ok: false; error: string };

function parseJsonBody(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return raw.length > 0 ? JSON.parse(raw) : {};
    } catch {
      return null;
    }
  }
  return raw;
}

function validateBody(raw: unknown): ValidationResult {
  const body = parseJsonBody(raw);
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Invalid request body.' };
  }

  const { kind, text, questionContext } = body as Record<string, unknown>;

  if (typeof kind !== 'string' || !VALID_KINDS.includes(kind as PolishKind)) {
    return { ok: false, error: 'Invalid "kind". Expected task, question, answer, or option.' };
  }

  if (typeof text !== 'string') {
    return { ok: false, error: 'Invalid "text".' };
  }

  const trimmedText = text.trim();
  if (trimmedText.length < 1 || trimmedText.length > MAX_TEXT_LENGTH) {
    return { ok: false, error: `"text" must be between 1 and ${MAX_TEXT_LENGTH} characters.` };
  }

  let trimmedContext: string | undefined;
  if (questionContext !== undefined) {
    if (typeof questionContext !== 'string') {
      return { ok: false, error: 'Invalid "questionContext".' };
    }
    trimmedContext = questionContext.trim();
    if (trimmedContext.length > MAX_CONTEXT_LENGTH) {
      return { ok: false, error: `"questionContext" must be at most ${MAX_CONTEXT_LENGTH} characters.` };
    }
  }

  return {
    ok: true,
    value: { kind: kind as PolishKind, text: trimmedText, questionContext: trimmedContext },
  };
}

// Answers to the lead's questions are first checked for relevance: an answer
// that has nothing to do with the question is rejected instead of polished.
// `option` keeps the original, simpler contract (no suggestion when
// off-topic — it's discarded either way, see `parseRelevanceResult`).
const OPTION_RELEVANCE_INSTRUCTIONS = [
  "Before rewriting, judge whether the developer's text is a plausible answer to the question, even partially or indirectly.",
  'A text that does not answer what the question asks (for example, an object when the question asks for a color) is NOT related.',
  "Be lenient: short, partial, or not-yet-known answers that still address the question count as related.",
  'Respond ONLY with a JSON object of the form {"relevant": boolean, "suggestion": string}.',
  'If the answer is not related to the question, set "relevant" to false and "suggestion" to an empty string.',
].join(' ');

// `answer` additionally judges whether a related answer is only partial, and
// always returns a usable "suggestion": an example answer when off-topic (so
// the developer sees the expected shape), a merged/completed answer when
// partial, or the normal rewrite when the answer is already complete.
const ANSWER_RELEVANCE_INSTRUCTIONS = [
  "Before rewriting, judge whether the developer's text is a plausible answer to the question, even partially or indirectly.",
  'A text that does not answer what the question asks (for example, an object when the question asks for a color) is NOT related.',
  "Be lenient: short, partial, or not-yet-known answers that still address the question count as related.",
  'If related, also judge whether it fully answers everything the question asks, or only partially answers it (leaves out something the question asked for).',
  'Respond ONLY with a JSON object of the form {"relevant": boolean, "partial": boolean, "suggestion": string}.',
  'If NOT related: set "relevant" to false, "partial" to false, and "suggestion" to an example of what a good answer could look like, in 1 to 2 short sentences, at most 280 characters. Use [bracketed placeholders] for every fact you do not actually know from the question or the developer\'s text — never invent concrete facts such as names, numbers, ticket ids, or dates, and never use the developer\'s off-topic text as a fact source.',
  'If related but only PARTIAL: set "relevant" to true, "partial" to true, and "suggestion" to a better answer that keeps every fact the developer already gave, unchanged, and adds [bracketed placeholders] only for what is still missing to fully answer the question.',
  'If related and already COMPLETE: set "relevant" to true, "partial" to false, and "suggestion" to the normal rewritten answer, with no placeholders.',
].join(' ');

const OFF_TOPIC_MESSAGES: Partial<Record<PolishKind, string>> = {
  answer: "Your answer doesn't seem to address the question. Please rewrite it and try again.",
  option: "This option doesn't seem to answer the question. Please rewrite it and try again.",
};

function needsRelevanceCheck(kind: PolishKind, questionContext: string | undefined): boolean {
  return (kind === 'answer' || kind === 'option') && Boolean(questionContext);
}

interface RelevanceResult {
  relevant: boolean;
  // Defensive default: missing/non-`true` "partial" reads as not partial —
  // `option` never sends this field, and an unexpected response shouldn't
  // ever be treated as more uncertain than "relevant, complete".
  partial: boolean;
  suggestion: string;
}

function parseRelevanceResult(kind: PolishKind, content: string): RelevanceResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new PolishError(500, 'AI polish returned an unexpected response.');
  }
  const result = parsed as { relevant?: unknown; partial?: unknown; suggestion?: unknown };
  // Permissive on purpose (mirrors the original check): only an explicit
  // `false` counts as off-topic, so a malformed/missing field never wrongly
  // rejects a real answer.
  const relevant = result.relevant !== false;
  const partial = result.partial === true;
  // Only a relevant result needs a non-empty suggestion. An off-topic
  // `answer`'s example is optional: when the model omits it, the caller still
  // returns the off-topic 422, just without an `exampleAnswer`.
  if (relevant && (typeof result.suggestion !== 'string' || result.suggestion.trim().length === 0)) {
    throw new PolishError(500, 'AI polish returned an unexpected response.');
  }
  return { relevant, partial, suggestion: typeof result.suggestion === 'string' ? result.suggestion : '' };
}

function buildMessages(
  kind: PolishKind,
  text: string,
  questionContext: string | undefined,
): Array<{ role: 'system' | 'user'; content: string }> {
  const relevanceInstructions = kind === 'answer' ? ANSWER_RELEVANCE_INSTRUCTIONS : OPTION_RELEVANCE_INSTRUCTIONS;
  const systemContent = `${BASE_SYSTEM_PROMPT} ${KIND_INSTRUCTIONS[kind]}${
    needsRelevanceCheck(kind, questionContext) ? ` ${relevanceInstructions}` : ''
  }`;
  let userContent = `Text to rewrite:\n"""${text}"""`;
  if (kind === 'answer' && questionContext) {
    userContent = `Question from the lead: "${questionContext}"\n\nDeveloper's answer to rewrite:\n"""${text}"""`;
  } else if (kind === 'option' && questionContext) {
    userContent = `Multiple-choice question for the lead: "${questionContext}"\n\nAnswer option to rewrite:\n"""${text}"""`;
  }

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
}

// Enforces the per-kind length limit server-side, in case the model ignores
// the instruction; falls back to trimming at the nearest word boundary.
function enforceLimit(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }

  const sliced = trimmed.slice(0, limit);
  const lastSpaceIndex = sliced.lastIndexOf(' ');
  const boundarySliced = lastSpaceIndex > 0 ? sliced.slice(0, lastSpaceIndex) : sliced;
  return boundarySliced.trim();
}

class PolishError extends Error {
  status: number;
  // Set only for an off-topic `answer`: an example answer the client shows
  // alongside the rejection message, so the developer sees the expected
  // shape (see `ANSWER_RELEVANCE_INSTRUCTIONS`).
  exampleAnswer?: string;

  constructor(status: number, message: string, exampleAnswer?: string) {
    super(message);
    this.status = status;
    this.exampleAnswer = exampleAnswer;
  }
}

async function requestPolishedText(
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  jsonMode = false,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Never surface the missing-config detail to the client.
    console.error('OPENAI_API_KEY is not configured.');
    throw new PolishError(500, 'AI polish is not available right now.');
  }

  const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-nano';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_tokens: 300,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Never echo the upstream response body to the client.
      console.error(`OpenAI polish request failed with status ${response.status}`);
      throw new PolishError(500, 'AI polish request failed.');
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new PolishError(500, 'AI polish returned an empty response.');
    }

    return content;
  } catch (error) {
    if (error instanceof PolishError) {
      throw error;
    }
    console.error('OpenAI polish request errored', error);
    throw new PolishError(500, 'AI polish request failed.');
  } finally {
    clearTimeout(timeoutId);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  // A missing project id is a server misconfiguration, not an expired session.
  if (!firebaseProjectId) {
    console.error('FIREBASE_PROJECT_ID / VITE_FIREBASE_PROJECT_ID is not configured for this function.');
    res.status(500).json({ error: 'AI polish is not configured on the server.' });
    return;
  }

  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token.' });
    return;
  }

  let uid: string;
  try {
    uid = await verifyFirebaseIdToken(token);
  } catch (error) {
    console.error('Firebase ID token verification failed', error);
    res.status(401).json({ error: 'Invalid or expired token.' });
    return;
  }

  if (isRateLimited(uid)) {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return;
  }

  const validation = validateBody(req.body);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const { kind, text, questionContext } = validation.value;
  const messages = buildMessages(kind, text, questionContext);

  try {
    const checkRelevance = needsRelevanceCheck(kind, questionContext);
    const content = await requestPolishedText(messages, checkRelevance);

    if (!checkRelevance) {
      res.status(200).json({ suggestion: enforceLimit(content, KIND_LIMITS[kind]) });
      return;
    }

    const result = parseRelevanceResult(kind, content);
    const suggestion = enforceLimit(result.suggestion, KIND_LIMITS[kind]);

    if (!result.relevant) {
      const message = OFF_TOPIC_MESSAGES[kind] ?? 'The text does not match the question.';
      // Only `answer` carries the example answer onward — `option`'s
      // off-topic "suggestion" is always empty (see `parseRelevanceResult`)
      // and stays backwards compatible with just `{ error }`.
      throw new PolishError(422, message, kind === 'answer' && suggestion ? suggestion : undefined);
    }

    if (kind === 'answer') {
      res.status(200).json({ suggestion, status: result.partial ? 'partial' : 'ok' });
      return;
    }

    res.status(200).json({ suggestion });
  } catch (error) {
    if (error instanceof PolishError) {
      const body: Record<string, unknown> = { error: error.message };
      if (error.exampleAnswer !== undefined) {
        body.exampleAnswer = error.exampleAnswer;
      }
      res.status(error.status).json(body);
      return;
    }
    console.error('Unexpected /api/polish error', error);
    res.status(500).json({ error: 'Unexpected error.' });
  }
}
