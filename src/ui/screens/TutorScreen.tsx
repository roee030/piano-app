import { useEffect, useRef, useState } from 'react';
import { app } from '../../app/controller';
import { useStore } from '../hooks';
import { keyName } from '../../core/music/keys';
import { midiToName } from '../../core/music/pitch';
import { LESSONS } from '../../tutor/lessons';

// Set for the GitHub Pages build, which has no server for the tutor endpoint.
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

  const send = async (text: string) => {
    if (STATIC_SITE || !text.trim() || busy) return;
    const history = [...msgs.filter((m) => m.role !== 'system'), { role: 'user' as const, content: text.trim() }];
    setMsgs([...msgs, { role: 'user', content: text.trim() }, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    try {
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
          if (data.text) setMsgs((m) => { const c = [...m]; c[c.length - 1] = { role: 'assistant', content: c[c.length - 1].content + data.text }; return c; });
          if (data.error) setMsgs((m) => [...m.filter((x, i) => !(i === m.length - 1 && x.role === 'assistant' && !x.content)), { role: 'system', content: data.error! }]);
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
      {status && !status.configured && STATIC_SITE && (
        <div className="banner">The live AI tutor needs the app's server, so it isn't available on this hosted static version. The built-in lessons below and the recommendations in each performance report still work. To chat with the tutor, run the app locally with <span className="mono">ANTHROPIC_API_KEY</span> set.</div>
      )}
      {status && !status.configured && !STATIC_SITE && (
        <div className="banner">AI tutor setup: start the dev server with <span className="mono">ANTHROPIC_API_KEY</span> set (or sign in with <span className="mono">ant auth login</span>). Until then, the built-in lessons and the recommendations in each performance report still work.</div>
      )}
      <div className="tutor">
        <section className="card chat">
          <div className="chat-log" ref={logRef}>
            {msgs.length === 0 && (
              <div className="grid" style={{ gap: 12, justifyItems: 'start' }}>
                <div className="display" style={{ fontSize: 22 }}>What would you like to work on?</div>
                <div className="chips">{QUICK.map((q) => <button key={q} className="chip" style={{ cursor: 'pointer' }} onClick={() => send(q)}>{q}</button>)}</div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>{m.role === 'assistant' ? (m.content ? renderRich(m.content) : <span className="muted">Thinking…</span>) : m.content}</div>
            ))}
          </div>
          <div className="chat-input">
            <textarea value={input} placeholder="Ask your tutor…" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }} />
            <button className="btn primary lg" disabled={STATIC_SITE || busy || !input.trim()} onClick={() => send(input)}>{busy ? '…' : 'Send'}</button>
          </div>
        </section>
        <aside className="grid" style={{ gap: 14, alignContent: 'start', overflow: 'auto' }}>
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
