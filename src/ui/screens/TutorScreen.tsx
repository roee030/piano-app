import { useEffect, useRef, useState } from 'react';
import { app } from '../../app/controller';
import { useStore } from '../hooks';
import { keyName } from '../../core/music/keys';
import { midiToName } from '../../core/music/pitch';
import { LESSONS } from '../../tutor/lessons';
import { forgetBrowserKey, getBrowserKey, isKeyRemembered, looksLikeKey, setBrowserKey } from '../../tutor/browserKey';
import type { ChatMessage } from '../../tutor/claude';

// Set for the GitHub Pages build, which has no server for the tutor endpoint;
// there the tutor calls the Anthropic API directly with the student's own key.
const STATIC_SITE = import.meta.env.VITE_STATIC_SITE === '1';

interface Msg {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const QUICK = [
  'Make me a 2-week practice plan based on my results',
  'Why do I keep missing the notes I miss most often?',
  'How do I read ledger lines quickly?',
  'What is the difference between a key signature and accidentals?',
  'Explain chord inversions with examples on C major',
  'How should I practice hands together?',
];

function buildContext(): string {
  const s = app.engineState.get();
  const ex = s.exercise;
  const cfg = ex.config;
  const lines = [
    `Current exercise: "${ex.title}" (${keyName(ex.key)}, ${ex.time.beats}/${ex.time.beatType}, ${ex.measures.length} measures, hands in score: ${ex.hands}).`,
    `Practice settings: mode=${s.settings.mode}, hands=${s.settings.hands}, bpm=${s.settings.bpm}, sensitivity=${s.settings.sensitivity}.`,
  ];
  if (cfg) lines.push(`Generator: LH range ${midiToName(cfg.leftRange.low)}–${midiToName(cfg.leftRange.high)}, RH range ${midiToName(cfg.rightRange.low)}–${midiToName(cfg.rightRange.high)}, scale=${cfg.scale}, texture=${cfg.texture}, difficulty=${cfg.difficulty}, notes/measure=${cfg.notesPerMeasure}.`);
  const st = s.stats;
  if (st.notesPlayed > 0) {
    const missed = Object.entries(st.missedByMidi).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([m, c]) => `${midiToName(Number(m))}×${c}`).join(', ');
    const kinds: Record<string, number> = {};
    for (const m of s.mistakes) kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
    lines.push(`Current attempt so far: ${st.notesPlayed} notes played, ${st.correct} correct, ${st.incorrect} wrong; missed: ${missed || 'none'}; mistake kinds: ${JSON.stringify(kinds)}.`);
  }
  lines.push(app.history.summaryForTutor());
  return lines.join('\n');
}

/** Streams a reply straight from the browser with the student's own key. */
async function streamFromBrowser(apiKey: string, history: ChatMessage[], context: string | undefined, onText: (t: string) => void, onError: (m: string) => void) {
  const [{ default: Anthropic }, { streamTutor, tutorErrorMessage }] = await Promise.all([import('@anthropic-ai/sdk'), import('../../tutor/claude')]);
  try {
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    await streamTutor(client, history, context, { onText, onError });
  } catch (err) {
    onError(tutorErrorMessage(err, Anthropic, 'Anthropic rejected this API key. Check it, or forget it and enter a new one.'));
  }
}

function KeyPanel({ browserKey, onChange }: { browserKey: string | null; onChange: (k: string | null) => void }) {
  const [draft, setDraft] = useState('');
  const [remember, setRemember] = useState(false);
  if (browserKey) {
    return (
      <div className="card card-pad grid" style={{ gap: 8 }}>
        <h2>Your API key</h2>
        <div className="muted" style={{ fontSize: 12 }}>
          Using your key ending in <span className="mono">…{browserKey.slice(-4)}</span>, {isKeyRemembered() ? 'remembered on this device' : 'kept until you close this tab'}. Requests go from your browser straight to api.anthropic.com and are billed to your Anthropic account.
        </div>
        <button className="btn" onClick={() => { forgetBrowserKey(); onChange(null); }}>Forget key</button>
      </div>
    );
  }
  const valid = looksLikeKey(draft);
  const save = () => { if (!valid) return; setBrowserKey(draft, remember); setDraft(''); onChange(getBrowserKey()); };
  return (
    <div className="card card-pad grid" style={{ gap: 8 }}>
      <h2>Use your own API key</h2>
      <div className="muted" style={{ fontSize: 12 }}>
        This hosted version has no server, so the tutor uses your own Anthropic API key (from console.anthropic.com). It is sent only to api.anthropic.com, directly from your browser, and usage is billed to your account. Use it on your own device only.
      </div>
      <input className="input" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
      {draft && !valid && <div className="muted" style={{ fontSize: 12 }}>That doesn't look like an Anthropic API key (they start with sk-ant-).</div>}
      <label style={{ cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this device</label>
      <button className="btn primary" disabled={!valid} onClick={save}>Use this key</button>
    </div>
  );
}

function renderRich(text: string) {
  // Minimal, safe formatting: **bold** and "#" headings, rendered as React nodes (no HTML injection)
  return text.split('\n').map((line, i) => {
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    const parts = (h ? h[1] : line).split(/(\*\*[^*]+\*\*)/g).map((p, j) => (p.startsWith('**') && p.endsWith('**') ? <b key={j}>{p.slice(2, -2)}</b> : p));
    return h ? <h4 key={i}>{parts}</h4> : <div key={i}>{parts.length ? parts : ' '}</div>;
  });
}

export function TutorScreen() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ configured: boolean } | null>(STATIC_SITE ? { configured: false } : null);
  const [share, setShare] = useState(true);
  const [lesson, setLesson] = useState<string | null>(null);
  const [browserKey, setBrowserKeyState] = useState<string | null>(() => getBrowserKey());
  const logRef = useRef<HTMLDivElement>(null);
  const report = useStore(app.report);
  void report;

  useEffect(() => {
    if (STATIC_SITE) return;
    fetch('/api/tutor/status').then((r) => r.json()).then(setStatus).catch(() => setStatus({ configured: false }));
  }, []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [msgs]);

  const serverReady = Boolean(status?.configured);
  const useBrowser = !serverReady && Boolean(browserKey);
  const canChat = serverReady || useBrowser;

  const appendText = (t: string) => setMsgs((m) => { const c = [...m]; c[c.length - 1] = { role: 'assistant', content: c[c.length - 1].content + t }; return c; });
  const showError = (e: string) => setMsgs((m) => [...m.filter((x, i) => !(i === m.length - 1 && x.role === 'assistant' && !x.content)), { role: 'system', content: e }]);

  const send = async (text: string) => {
    if (!canChat || !text.trim() || busy) return;
    const history = [...msgs.filter((m) => m.role !== 'system'), { role: 'user' as const, content: text.trim() }];
    setMsgs([...msgs, { role: 'user', content: text.trim() }, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    try {
      if (useBrowser) {
        await streamFromBrowser(browserKey!, history as ChatMessage[], share ? buildContext() : undefined, appendText, showError);
        return;
      }
      const res = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history, context: share ? buildContext() : undefined }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const ev of events) {
          const line = ev.replace(/^data: /, '');
          if (!line.trim()) continue;
          const data = JSON.parse(line) as { text?: string; error?: string; done?: boolean };
          if (data.text) appendText(data.text);
          if (data.error) showError(data.error);
        }
      }
    } catch (e) {
      setMsgs((m) => [...m.filter((x, i) => !(i === m.length - 1 && x.role === 'assistant' && !x.content)), { role: 'system', content: `The tutor is unavailable (${String(e)}). The built-in lessons on the right work offline.` }]);
    } finally {
      setBusy(false);
    }
  };

  const activeLesson = LESSONS.find((l) => l.id === lesson);

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <div className="page-head">
        <h1>AI tutor</h1>
        <p>Ask about theory, reading and technique, or ask for a practice plan. Your playing is always scored by the app's deterministic engine; the tutor only explains and plans.</p>
      </div>
      {status && !canChat && (
        <div className="banner">
          To chat with the tutor, enter your own Anthropic API key in the panel on the right
          {!STATIC_SITE && <> (or start the dev server with <span className="mono">ANTHROPIC_API_KEY</span> set)</>}. Until then, the built-in lessons and the recommendations in each performance report still work.
        </div>
      )}
      <div className="tutor">
        <section className="card chat">
          <div className="chat-log" ref={logRef}>
            {msgs.length === 0 && (
              <div className="grid" style={{ gap: 12, justifyItems: 'start' }}>
                <div className="display" style={{ fontSize: 22 }}>What would you like to work on?</div>
                <div className="chips">{QUICK.map((q) => <button key={q} className="chip" style={{ cursor: 'pointer' }} disabled={!canChat} onClick={() => send(q)}>{q}</button>)}</div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>{m.role === 'assistant' ? (m.content ? renderRich(m.content) : <span className="muted">Thinking…</span>) : m.content}</div>
            ))}
          </div>
          <div className="chat-input">
            <textarea value={input} placeholder="Ask your tutor…" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }} />
            <button className="btn primary lg" disabled={!canChat || busy || !input.trim()} onClick={() => send(input)}>{busy ? '…' : 'Send'}</button>
          </div>
        </section>
        <aside className="grid" style={{ gap: 14, alignContent: 'start', overflow: 'auto' }}>
          {status && !serverReady && <KeyPanel browserKey={browserKey} onChange={setBrowserKeyState} />}
          <div className="card card-pad grid" style={{ gap: 8 }}>
            <label style={{ cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 600 }}><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Share my practice results with the tutor</label>
            <div className="muted" style={{ fontSize: 12 }}>This sends a text summary of your recent accuracy, missed notes and settings to the Anthropic API. Nothing else is shared.</div>
          </div>
          <div className="card card-pad grid" style={{ gap: 8 }}>
            <h2>Built-in lessons</h2>
            <div className="muted" style={{ fontSize: 12 }}>These work offline.</div>
            <div className="lib-list">
              {LESSONS.map((l) => (
                <button key={l.id} className="lib-item" style={lesson === l.id ? { borderColor: 'var(--accent)' } : undefined} onClick={() => setLesson(lesson === l.id ? null : l.id)}>
                  <span className="t">{l.title}</span><span className="badge">{l.level}</span>
                  <span className="d">{l.summary}</span>
                </button>
              ))}
            </div>
          </div>
          {activeLesson && (
            <div className="card card-pad grid" style={{ gap: 8 }}>
              <h2>{activeLesson.title}</h2>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.6 }}>{renderRich(activeLesson.body)}</div>
              {activeLesson.exercise && (
                <button className="btn primary" onClick={() => { app.generate(activeLesson.exercise!); app.view.set('practice'); }}>Practice this →</button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
