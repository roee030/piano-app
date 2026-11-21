/**
 * AI Tutor endpoint, served by Vite dev/preview middleware.
 * The Anthropic API key stays on the server and never reaches the browser.
 * It isn't used for note recognition or evaluation; those stay deterministic in the client.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MODEL = 'claude-opus-5-5';

const SYSTEM_PROMPT = `You are the AI tutor inside a piano-learning web app. The student plays a physical MIDI keyboard while the app shows real sheet music on a grand staff. The app itself decides deterministically, in real time, whether each note was right. You do not grade notes. You teach.

What you do:
- Explain music theory clearly: clefs, ledger lines, key signatures, intervals, scales, chords and inversions, rhythm and counting, time signatures, dynamics.
- Teach note-reading strategies, such as landmark notes (middle C, treble G, bass F), interval reading, and line versus space patterns.
- Diagnose patterns in the student's mistake data when it is provided (for example, wrong octave errors around ledger lines, or the left hand weaker than the right) and recommend focused exercises.
- Build personal practice plans with concrete daily sessions: which hand, which note range, mode (Wait, Chord or Rhythm), BPM, and minutes.
- Answer general questions about learning piano: posture, fingering, practice habits, motivation.

The app's features you can recommend: an exercise generator (left- and right-hand note ranges, key signature, scale, time signature, number of measures, notes per measure, durations, single notes, mixed or chords, difficulty 1–5), practice modes (Wait: the score waits for the right notes; Chord: the notes of each chord must be struck together; Rhythm: metronome and timing scoring at an adjustable BPM), loop selected measures, repeat mistakes, and practice of each hand alone or both together. When you recommend an exercise, name the concrete settings.

Style: warm, encouraging and precise. Use scientific pitch names (C4 is middle C). Keep answers focused. Use short paragraphs or brief lists, and avoid long essays unless the student asks for depth. Never claim to have heard the student play. Base any statement about their playing only on the practice data provided.`;

const MAX_BODY = 200_000;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      data += c;
      if (data.length > MAX_BODY) {
        done = true;
        req.removeAllListeners('data');
        req.pause();
        reject(new HttpError(413, 'Request too large'));
      }
    });
    req.on('end', () => { if (!done) resolve(data); });
    req.on('error', reject);
  });
}

const isLoopback = (addr: string | undefined) =>
  addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

/**
 * The endpoint spends the server's API credentials, so only accept requests
 * that come from the app itself: same-origin JSON (which forces a CORS
 * preflight for cross-site pages), from this machine unless
 * TUTOR_ALLOW_REMOTE=1, and within a simple rate limit.
 */
const recent: number[] = [];
const RATE_LIMIT = 20; // requests per minute

function checkRequest(req: IncomingMessage) {
  if (!isLoopback(req.socket.remoteAddress) && process.env.TUTOR_ALLOW_REMOTE !== '1') {
    throw new HttpError(403, 'The tutor only accepts requests from this computer. Set TUTOR_ALLOW_REMOTE=1 to allow other devices.');
  }
  const origin = req.headers.origin;
  if (origin) {
    let host: string;
    try { host = new URL(origin).host; } catch { throw new HttpError(403, 'Bad origin'); }
    if (host !== req.headers.host) throw new HttpError(403, 'Cross-origin requests are not allowed');
  }
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'Expected application/json');
  }
  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= RATE_LIMIT) throw new HttpError(429, 'Too many tutor requests; wait a minute.');
  recent.push(now);
}

interface TutorRequest {
  messages: { role: 'user' | 'assistant'; content: string }[];
  context?: string;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'GET' && req.url?.endsWith('/status')) {
    const configured = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ configured, model: MODEL }));
    return;
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end();
    return;
  }
  let body: TutorRequest;
  try {
    checkRequest(req);
    body = JSON.parse(await readBody(req));
    if (!Array.isArray(body.messages) || body.messages.length === 0) throw new Error('messages required');
  } catch (e) {
    res.statusCode = e instanceof HttpError ? e.status : 400;
    res.setHeader('content-type', 'application/json');
    if (res.statusCode === 413) res.setHeader('connection', 'close');
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    if (res.statusCode === 413) req.destroy();
    return;
  }

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const messages = body.messages
    .slice(-30)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

  const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
  if (body.context) system.push({ type: 'text', text: `Student practice data (from the app's deterministic tracking):\n${body.context.slice(0, 12000)}` });

  try {
    const client = new Anthropic();
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages,
    });
    req.on('close', () => stream.abort());
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') send({ text: event.delta.text });
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') send({ error: 'The tutor could not answer this request. Try rephrasing it.' });
    else if (final.stop_reason === 'max_tokens') send({ text: '\n\n…(answer truncated)' });
    send({ done: true });
  } catch (err) {
    let msg = String(err);
    if (err instanceof Anthropic.AuthenticationError || /authentication method/i.test(msg)) msg = 'The AI tutor is not configured: set ANTHROPIC_API_KEY (or run `ant auth login`) and restart the dev server.';
    else if (err instanceof Anthropic.RateLimitError) msg = 'The tutor is rate limited. Wait a moment and try again.';
    else if (err instanceof Anthropic.APIConnectionError) msg = 'Could not reach the Anthropic API. Check your internet connection.';
    else if (err instanceof Anthropic.APIError) msg = `Tutor error (${err.status}): ${err.message}`;
    send({ error: msg });
  }
  res.end();
}

export function tutorPlugin(): Plugin {
  const mw = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/tutor')) return next();
    handle(req, res).catch((e) => {
      res.statusCode = 500;
      res.end(String(e));
    });
  };
  return {
    name: 'piano-ai-tutor',
    configureServer(server) {
      server.middlewares.use(mw);
    },
    configurePreviewServer(server) {
      server.middlewares.use(mw);
    },
  };
}
