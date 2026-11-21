/**
 * AI Tutor endpoint, served by Vite dev/preview middleware.
 * The Anthropic API key stays on the server and never reaches the browser.
 * It isn't used for note recognition or evaluation; those stay deterministic in the client.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MODEL, streamTutor, tutorErrorMessage, type ChatMessage } from '../src/tutor/claude';

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
function hostnameOf(hostHeader: string): string {
  try { return new URL(`http://${hostHeader}`).hostname.toLowerCase(); } catch { return ''; }
}

/**
 * localhost and loopback addresses always; with TUTOR_ALLOW_REMOTE=1 also IP
 * literals (which DNS rebinding can't produce) and any names listed in
 * TUTOR_ALLOWED_HOSTS (comma-separated).
 */
function allowedHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const h = hostnameOf(hostHeader);
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true;
  if (process.env.TUTOR_ALLOW_REMOTE !== '1') return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\[[0-9a-f:.]+\]$/.test(h)) return true;
  const extra = (process.env.TUTOR_ALLOWED_HOSTS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return extra.includes(h);
}

const recent: number[] = [];
const RATE_LIMIT = 20; // requests per minute

function checkRequest(req: IncomingMessage) {
  if (!isLoopback(req.socket.remoteAddress) && process.env.TUTOR_ALLOW_REMOTE !== '1') {
    throw new HttpError(403, 'The tutor only accepts requests from this computer. Set TUTOR_ALLOW_REMOTE=1 to allow other devices.');
  }
  // Check hostnames against a fixed allowlist rather than comparing Origin to
  // Host: a DNS-rebinding page (evil.example resolving to 127.0.0.1) sends
  // matching Origin and Host headers.
  if (!allowedHost(req.headers.host)) throw new HttpError(403, 'Host not allowed');
  const origin = req.headers.origin;
  if (origin) {
    let host: string;
    try { host = new URL(origin).host; } catch { throw new HttpError(403, 'Bad origin'); }
    if (host !== req.headers.host || !allowedHost(host)) throw new HttpError(403, 'Cross-origin requests are not allowed');
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
  messages: ChatMessage[];
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

  const abort = new AbortController();
  req.on('close', () => abort.abort());
  try {
    await streamTutor(new Anthropic(), body.messages, body.context, { onText: (text) => send({ text }), onError: (error) => send({ error }) }, abort.signal);
    send({ done: true });
  } catch (err) {
    send({ error: tutorErrorMessage(err, Anthropic, 'The AI tutor is not configured: set ANTHROPIC_API_KEY (or run `ant auth login`) and restart the dev server.') });
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
