import { useEffect, useMemo, useRef, useState } from 'react';
import { app, LogEntry } from '../../app/controller';
import { ALL_INPUTS } from '../../core/midi/MidiConnectionManager';
import { useStore, percentile } from '../hooks';
import { Piano } from '../piano/Piano';
import { midiToName } from '../../core/music/pitch';

/** Hardware self-test. Each check passes only on real MIDI events from the selected device. */
function useHardwareChecks(log: LogEntry[], since: number) {
  return useMemo(() => {
    const ev = log.filter((e) => e.id > since && e.device !== 'dev-sim');
    const ons = ev.filter((e) => e.kind === 'noteOn' && !e.text.includes('[synthetic]'));
    const offs = ev.filter((e) => e.kind === 'noteOff' && !e.text.includes('[synthetic]'));
    const midiOf = (e: LogEntry) => Number(/#(\d+)/.exec(e.text)?.[1]);
    // Chord: at least 3 Note Ons within 80 ms of each other
    let chord = false;
    for (let i = 2; i < ons.length; i++) if (ons[i].at - ons[i - 2].at < 80 && new Set([midiOf(ons[i]), midiOf(ons[i - 1]), midiOf(ons[i - 2])]).size === 3) chord = true;
    // Repeat: the same key pressed 3 times in a row with Note Offs between
    let repeat = false;
    const seq = ev.filter((e) => e.kind === 'noteOn' || e.kind === 'noteOff');
    for (let i = 0; i + 5 < seq.length + 1; i++) {
      const w = seq.slice(i, i + 6);
      if (w.length === 6 && w.every((e, k) => e.kind === (k % 2 ? 'noteOff' : 'noteOn')) && new Set(w.map(midiOf)).size === 1) repeat = true;
    }
    const keysSeen = new Set(ons.map(midiOf));
    const c4 = ons.some((e) => midiOf(e) === 60);
    return [
      { id: 'on', label: 'Press any key: a Note On is received', pass: ons.length > 0 },
      { id: 'off', label: 'Release it: a Note Off is received', pass: offs.length > 0 },
      { id: 'c4', label: 'Press middle C: it is identified as C4 (MIDI 60)', pass: c4 },
      { id: 'chord', label: 'Play a three-note chord (C–E–G): all three keys are detected', pass: chord },
      { id: 'repeat', label: 'Press one key three times: three separate events', pass: repeat },
      { id: 'many', label: `Play 12 different keys (${keysSeen.size}/12)`, pass: keysSeen.size >= 12 },
    ];
  }, [log, since]);
}

function LatencyRow({ label, arr, hint }: { label: string; arr: number[]; hint: string }) {
  const med = percentile(arr, 50);
  const p95 = percentile(arr, 95);
  const f = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)} ms`);
  return (
    <tr>
      <td>{label}<div className="muted" style={{ fontSize: 11.5 }}>{hint}</div></td>
      <td>{f(med)}</td>
      <td>{f(p95)}</td>
      <td>{arr.length}</td>
    </tr>
  );
}

export function MidiScreen() {
  const midi = useStore(app.midi);
  const diag = useStore(app.diag);
  const logRef = useRef<HTMLDivElement>(null);
  const [testSince, setTestSince] = useState(0);
  const checks = useHardwareChecks(diag.log, testSince);
  const [opts, setOpts] = useState(app.processor.opts);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [diag.log.length, diag.counters.messages]);

  const statusText: Record<string, string> = {
    idle: 'MIDI is not enabled yet',
    requesting: 'Waiting for your permission…',
    ready: 'MIDI access granted',
    denied: 'Permission denied',
    unsupported: 'Web MIDI is not supported in this browser',
    insecure: 'This page is not a secure context',
    error: 'Error',
  };
  const silentFor = midi.lastMessageAt !== null ? (performance.now() - midi.lastMessageAt) / 1000 : null;

  return (
    <div className="page">
      <div className="page-head">
        <h1>MIDI diagnostics</h1>
        <p>Check your keyboard connection, look at the raw MIDI events, run the hardware self-test and measure latency.</p>
      </div>

      <div className="two-col">
        <section className="card card-pad grid" style={{ gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={`dot ${midi.status === 'ready' && midi.connected ? 'ok' : midi.status === 'ready' ? 'warn' : midi.status === 'idle' ? '' : 'bad'}`} />
            <h2>{statusText[midi.status]}</h2>
            {midi.status !== 'ready' && (
              <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => app.initMidi()} disabled={midi.status === 'requesting' || midi.status === 'unsupported' || midi.status === 'insecure'}>Enable MIDI</button>
            )}
          </div>
          {midi.error && <div className="banner bad">{midi.error}</div>}
          {midi.status === 'denied' && (
            <div className="banner">Click the lock icon at the left of the address bar, open <b>Site settings</b>, set <b>MIDI devices</b> to <b>Allow</b>, then reload the page.</div>
          )}
          {midi.status === 'ready' && (
            <>
              <div className="field">
                <label>Input device</label>
                <div className="lib-list">
                  {midi.devices.length === 0 && <div className="banner">No MIDI inputs found. Check the cable and power, try another USB port, and close any other app (a DAW, for example) that may be using the device.</div>}
                  {midi.devices.map((d) => (
                    <button key={d.id} className="lib-item" style={midi.selectedId === d.id ? { borderColor: 'var(--accent)' } : undefined} onClick={() => app.selectDevice(d.id)}>
                      <span className="t"><span className={`dot ${d.state === 'connected' ? 'ok' : 'bad'}`} style={{ display: 'inline-block', marginRight: 8 }} />{d.name}</span>
                      <span className="badge">{midi.selectedId === d.id ? 'Selected' : d.state}</span>
                      <span className="d">{d.manufacturer || 'Unknown manufacturer'} · port {d.connection} · id {d.id.slice(0, 18)}</span>
                    </button>
                  ))}
                  {midi.devices.length > 1 && (
                    <button className="lib-item" style={midi.selectedId === ALL_INPUTS ? { borderColor: 'var(--accent)' } : undefined} onClick={() => app.selectDevice(ALL_INPUTS)}>
                      <span className="t">All inputs</span><span className="badge">{midi.selectedId === ALL_INPUTS ? 'Selected' : ''}</span>
                      <span className="d">Listen to every device. Duplicate events are merged.</span>
                    </button>
                  )}
                </div>
              </div>
              <div className="kv">
                <div className="stat"><div className="k">Messages</div><div className="v">{diag.counters.messages}</div></div>
                <div className="stat"><div className="k">Note On</div><div className="v">{diag.counters.noteOn}</div></div>
                <div className="stat"><div className="k">Note Off</div><div className="v">{diag.counters.noteOff}</div></div>
                <div className="stat"><div className="k">Duplicates removed</div><div className="v">{diag.counters.duplicates}</div></div>
                <div className="stat"><div className="k">Orphan Note Offs</div><div className="v">{diag.counters.orphanNoteOffs}</div></div>
                <div className="stat"><div className="k">Missed Note Offs</div><div className="v">{diag.counters.retriggers}</div></div>
                <div className="stat"><div className="k">Ghosts filtered</div><div className="v">{diag.counters.ghosts}</div></div>
                <div className="stat"><div className="k">Clock / sensing</div><div className="v">{diag.counters.realtime}</div></div>
              </div>
              <div className="muted" style={{ fontSize: 12.5 }}>
                Keys seen: {diag.lowestSeen === null ? '—' : `${midiToName(diag.lowestSeen)} – ${midiToName(diag.highestSeen!)}`} ·
                {' '}Last message: {silentFor === null ? 'none yet' : `${silentFor.toFixed(1)} s ago`}
              </div>
            </>
          )}
          {diag.warnings.length > 0 && (
            <div className="grid" style={{ gap: 6 }}>
              <div className="eyebrow">Input warnings (these are not playing mistakes)</div>
              {diag.warnings.slice(-5).map((w, i) => <div key={i} className="banner">{new Date(w.at).toLocaleTimeString()}: {w.text}</div>)}
            </div>
          )}
        </section>

        <section className="card card-pad grid" style={{ gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <h2>Hardware self-test</h2>
            <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setTestSince(diag.log[diag.log.length - 1]?.id ?? 0)}>Reset test</button>
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>Each check passes only on events from a physical keyboard. Simulated input is never counted.</div>
          <div className="check-list">
            {checks.map((c) => (
              <div key={c.id} className={`check-item ${c.pass ? 'pass' : ''}`}>
                <span className={`dot ${c.pass ? 'ok' : ''}`} /> {c.label}
                <span className="status">{c.pass ? 'PASS' : 'waiting'}</span>
              </div>
            ))}
          </div>
          <h2 style={{ marginTop: 8 }}>MIDI-to-feedback latency</h2>
          <table className="table">
            <thead><tr><th>Stage</th><th>Median</th><th>p95</th><th>Samples</th></tr></thead>
            <tbody>
              <LatencyRow label="Delivery" arr={diag.latency.delivery} hint="MIDI timestamp → JavaScript handler" />
              <LatencyRow label="Evaluation" arr={diag.latency.evaluation} hint="Processor + practice engine" />
              <LatencyRow label="Rendered" arr={diag.latency.toRender} hint="MIDI timestamp → DOM updated" />
              <LatencyRow label="On screen" arr={diag.latency.toFrame} hint="MIDI timestamp → next frame" />
            </tbody>
          </table>
          <div className="muted" style={{ fontSize: 12 }}>Play on the Practice screen to collect samples. The USB and driver delay before the browser timestamps a message cannot be seen from the browser.</div>
        </section>
      </div>

      <section className="card card-pad grid" style={{ gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2>Live input</h2>
          <span className="muted">Held: {diag.held.length ? diag.held.map((m) => midiToName(m)).join(' ') : 'none'}</span>
          <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => app.resetDiagnostics()}>Clear</button>
        </div>
        <Piano held={diag.held} labels="c-only" />
        <div className="log" ref={logRef}>
          {diag.log.length === 0 && <div className="muted">No MIDI messages yet. Press a key on your keyboard.</div>}
          {diag.log.map((e) => (
            <div key={e.id} className={`log-row ${e.kind}`}>
              <span>{e.at.toFixed(1)}</span>
              <span>{e.raw}</span>
              <span>{e.text}{e.device === 'dev-sim' ? '  (simulated, dev only)' : ''}</span>
            </div>
          ))}
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="field">
            <label>Duplicate window: {opts.dedupeWindowMs} ms</label>
            <input type="range" min={0} max={30} value={opts.dedupeWindowMs} onChange={(e) => { const o = { ...opts, dedupeWindowMs: Number(e.target.value) }; setOpts(o); app.updateProcessor(o); }} />
          </div>
          <div className="field">
            <label>Ignore ghost touches below velocity: {opts.minVelocity}</label>
            <input type="range" min={1} max={30} value={opts.minVelocity} onChange={(e) => { const o = { ...opts, minVelocity: Number(e.target.value) }; setOpts(o); app.updateProcessor(o); }} />
          </div>
          <div className="field">
            <label>Stuck-key warning after: {Math.round(opts.stuckKeyMs / 1000)} s</label>
            <input type="range" min={5} max={60} value={opts.stuckKeyMs / 1000} onChange={(e) => { const o = { ...opts, stuckKeyMs: Number(e.target.value) * 1000 }; setOpts(o); app.updateProcessor(o); }} />
          </div>
        </div>
      </section>
    </div>
  );
}
