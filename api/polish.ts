import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createRemoteJWKSet, jwtVerify } from 'jose';

// Rewrites a developer's short text (task update, question to the lead, or
// free-text answer to the lead) into a clear, English, stand-up-ready
// sentence via OpenAI. The API key stays server-side only: it is read from
// `OPENAI_API_KEY` and never forwarded to, or echoed back to, the client.

export type PolishKind = 'task' | 'question' | 'answer';

interface PolishRequestBody {
  kind: PolishKind;
  text: string;
  questionContext?: string;
}

const VALID_KINDS: PolishKind[] = ['task', 'question', 'answer'];

const MAX_TEXT_LENGTH = 500;
const MAX_CONTEXT_LENGTH = 500;

const KIND_LIMITS: Record<PolishKind, number> = {
  task: 140,
  question: 200,
  answer: 280,
};

const BASE_SYSTEM_PROMPT = [
  "You rewrite a software developer's short text for a team lead's daily stand-up report.",
  'Always respond in English, no matter what language the input is written in.',
  'Keep every concrete fact from the original text: ticket IDs, names, numbers, and link text. Never invent information that is not present in the original text.',
  'Output only the rewritten text: no preamble, no quotation marks, and no markdown formatting.',
].join(' ');

const KIND_INSTRUCTIONS: Record<PolishKind, string> = {
  task: 'Rewrite it as one sentence that starts with a past- or present-tense action verb. It must be a punchy status update of at most 140 characters.',
  question:
    'Rewrite it as one clear, direct question the lead can answer without needing extra context. At most 200 characters.',
  answer:
    "Rewrite it so it directly answers the question given as context, in 1 to 2 short sentences, at most 280 characters.",
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
    return { ok: false, error: 'Invalid "kind". Expected task, question, or answer.' };
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

function buildMessages(
  kind: PolishKind,
  text: string,
  questionContext: string | undefined,
): Array<{ role: 'system' | 'user'; content: string }> {
  const systemContent = `${BASE_SYSTEM_PROMPT} ${KIND_INSTRUCTIONS[kind]}`;
  const userContent =
    kind === 'answer' && questionContext
      ? `Question from the lead: "${questionContext}"\n\nDeveloper's answer to rewrite:\n"""${text}"""`
      : `Text to rewrite:\n"""${text}"""`;

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

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function requestPolishedText(
  messages: Array<{ role: 'system' | 'user'; content: string }>,
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
        max_tokens: 200,
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
    const rawSuggestion = await requestPolishedText(messages);
    const suggestion = enforceLimit(rawSuggestion, KIND_LIMITS[kind]);
    res.status(200).json({ suggestion });
  } catch (error) {
    if (error instanceof PolishError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Unexpected /api/polish error', error);
    res.status(500).json({ error: 'Unexpected error.' });
  }
}
