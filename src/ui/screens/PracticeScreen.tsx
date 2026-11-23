import { pitchName } from '../../core/music/pitch';
import { scoreNoteName } from '../../core/practice/timeline';
import { useEffect, useMemo, useRef, useState } from 'react';
import { app } from '../../app/controller';
import { useStore, fmtPct } from '../hooks';
import { ScoreView } from '../notation/ScoreView';
import { Piano } from '../piano/Piano';
import { ReportModal } from './ReportModal';
import { metronome } from '../../audio/metronome';
import { beatTicks } from '../../core/generator/generator';
import { measureTicks } from '../../core/model/types';
import type { Hand, HandSelection } from '../../core/model/types';
import type { PracticeMode, Sensitivity } from '../../core/practice/types';
import { keyName } from '../../core/music/keys';
import { midiToName, MIDI_A0, MIDI_C8, pitchToMidi } from '../../core/music/pitch';
import { toMusicXML } from '../../core/model/musicxml';

const MODE_INFO: Record<PracticeMode, string> = {
  wait: 'Wait mode: the score waits until you play the right notes.',
  chord: 'Chord mode: every note of a chord must be struck together, within the chord tolerance.',
  rhythm: 'Rhythm mode: play in time with the metronome. Pitch and timing are both scored.',
};

export function PracticeScreen() {
  const snap = useStore(app.engineState);
  const prefs = useStore(app.prefs);
  const midi = useStore(app.midi);
  const report = useStore(app.report);
  const [showSettings, setShowSettings] = useState(false);
  const { settings, state, stats, steps, stepIndex, exercise } = snap;
  const step = snap.currentStep;
  // Names follow the score's spelling (Bb, not A#); a key just played may belong to the previous step
  const nameOf = (m: number) => scoreNoteName(m, [step, snap.steps[snap.stepIndex - 1], snap.nextStep], exercise.key.fifths < 0);
  const now = () => performance.now();

  // ---- metronome follows the transport
  useEffect(() => {
    let raf = 0;
    const bt = beatTicks(exercise.time);
    const perMeasure = measureTicks(exercise.time) / bt;
    const loop = () => {
      const s = app.engineState.get();
      const running = s.state === 'playing' || s.state === 'countIn';
      metronome.update(s.transport, bt, perMeasure, prefs.metronome && running && s.settings.mode === 'rhythm', performance.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [exercise, prefs.metronome]);

  // ---- keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowRight') app.engine.nextMeasure(now());
      else if (e.key === 'ArrowLeft') app.engine.prevMeasure(now());
      else if (e.key === 'r' && !e.ctrlKey) app.engine.restart();
      else if (e.key === 'l') toggleLoopCurrent();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const togglePlay = () => {
    metronome.unlock();
    const s = app.engineState.get();
    if (s.state === 'playing' || s.state === 'countIn') app.engine.pause('user', now());
    else app.engine.start(now());
  };
  const toggleLoopCurrent = () => {
    const s = app.engineState.get();
    if (s.loop) app.engine.setLoop(null, now());
    else {
      const m = s.currentStep?.measure ?? 0;
      app.engine.setLoop({ start: m, end: m }, now());
    }
  };

  // ---- piano state
  const pianoProps = useMemo(() => {
    const expected = new Map<number, Hand[]>();
    const satisfied = new Set<number>();
    const names = new Map<number, string>();
    if (step && state !== 'completed') {
      for (const n of step.notes) {
        expected.set(n.midi, n.hands);
        names.set(n.midi, pitchName(n.pitch));
        if (snap.noteStatus[n.midi] === 'correct') satisfied.add(n.midi);
      }
    }
    const upcoming = new Set<number>(snap.nextStep?.notes.map((n) => n.midi) ?? []);
    return { expected, names, satisfied, wrong: new Set(snap.wrongHeld), upcoming };
  }, [step, snap.noteStatus, snap.wrongHeld, snap.nextStep, state]);

  const [lo, hi] = useMemo(() => {
    if (prefs.pianoRange === 'full') return [MIDI_A0, MIDI_C8];
    const all = exercise.measures.flatMap((m) => Object.values(m.voices).flatMap((v) => v!.groups.flatMap((g) => g.pitches.map(pitchToMidi))));
    const mn = Math.min(...all, 60);
    const mx = Math.max(...all, 60);
    return [Math.max(MIDI_A0, Math.floor((mn - 5) / 12) * 12), Math.min(MIDI_C8, Math.ceil((mx + 5) / 12) * 12)];
  }, [exercise, prefs.pianoRange]);

  // ---- derived stats
  const done = Object.keys(snap.stepResults).length;
  const progress = steps.length ? Math.min(1, (state === 'completed' ? steps.length : stepIndex) / steps.length) : 0;
  const accuracy = stats.correct + stats.incorrect > 0 ? stats.correct / (stats.correct + stats.incorrect) : null;
  const handsPresent = (['R', 'L'] as Hand[]).filter((h) => exercise.measures.some((m) => m.voices[h]));
  const curMeasure = step?.measure ?? exercise.measures.length - 1;

  const fb = snap.lastFeedback;
  const fbClass = !fb ? '' : fb.kind === 'correct' ? 'ok' : ['early', 'late', 'releasedEarly', 'heldTooLong'].includes(fb.kind) ? 'warn' : 'bad';
  const lastWrong = [...snap.mistakes].reverse().find((m) => m.played !== undefined && m.stepIndex === stepIndex);

  const exportXml = () => {
    const blob = new Blob([toMusicXML(exercise)], { type: 'application/vnd.recordare.musicxml+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${exercise.title.replace(/[^\w-]+/g, '_')}.musicxml`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const notConnected = midi.status !== 'ready' || !midi.connected;

  return (
    <div className="practice">
      <header className="practice-head">
        <div className="practice-title">
          <div className="eyebrow">{exercise.source === 'generated' ? 'Generated exercise' : exercise.source === 'drill' ? 'Mistake drill' : 'Library'} · {keyName(exercise.key)} · {exercise.time.beats}/{exercise.time.beatType}</div>
          <h1>{exercise.title}</h1>
          {exercise.description && <div className="sub">{exercise.description}</div>}
        </div>
        <div className="head-controls">
          <div className="seg" role="group" aria-label="Hands">
            {(['L', 'R', 'both'] as HandSelection[]).map((h) => {
              const available = h === 'both' ? handsPresent.length === 2 : handsPresent.includes(h);
              return (
                <button key={h} className={settings.hands === h ? 'active' : ''} disabled={!available} style={!available ? { opacity: 0.35 } : undefined}
                  onClick={() => app.updateSettings({ hands: h })} title={available ? '' : 'This exercise has no part for this hand'}>
                  {h !== 'R' && <span className="hand-chip l" />}
                  {h !== 'L' && <span className="hand-chip r" />}
                  {h === 'L' ? 'Left' : h === 'R' ? 'Right' : 'Both'}
                </button>
              );
            })}
          </div>
          <div className="seg" role="group" aria-label="Mode">
            {(['wait', 'chord', 'rhythm'] as PracticeMode[]).map((m) => (
              <button key={m} className={settings.mode === m ? 'active' : ''} onClick={() => app.updateSettings({ mode: m })} title={MODE_INFO[m]}>
                {m === 'wait' ? 'Wait' : m === 'chord' ? 'Chord' : 'Rhythm'}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="stage">
        <section className="card score-card">
          <ScoreView snap={snap} />
          <StageStatus />
          {notConnected && <ConnectCard />}
        </section>

        <aside className="side">
          <div className={`feedback ${fbClass}`}>
            <div className="eyebrow">{state === 'idle' ? (settings.mode === 'rhythm' ? 'Press Start, then play after the count-in' : 'Play the first note to begin') : state === 'completed' ? 'Exercise complete' : `Measure ${curMeasure + 1} of ${exercise.measures.length}`}</div>
            <div className="fb-pair" key={fb?.time ?? 0}>
              <div className="fb-box">
                <div className="fb-k">Expected</div>
                <div className="fb-v">{step && state !== 'completed' ? step.notes.map((n) => nameOf(n.midi)).join(' ') : '—'}</div>
              </div>
              <div className={`fb-box ${fb?.kind === 'correct' ? 'ok' : lastWrong ? 'bad' : ''} fb-flash`}>
                <div className="fb-k">Played</div>
                <div className="fb-v">{snap.heldKeys.length ? snap.heldKeys.map(nameOf).join(' ') : lastWrong ? nameOf(lastWrong.played!) : fb?.played !== undefined ? nameOf(fb.played) : '—'}</div>
              </div>
            </div>
            <div className="fb-msg">{fb ? fb.message : MODE_INFO[settings.mode]}</div>
            {step && step.notes.length > 1 && state !== 'completed' && (
              <div className="chips" style={{ marginTop: 10 }}>
                {step.notes.map((n) => (
                  <span key={n.midi} className="chip" style={{ color: snap.noteStatus[n.midi] === 'correct' ? 'var(--correct)' : undefined }}>
                    {snap.noteStatus[n.midi] === 'correct' ? '✓' : '○'} {nameOf(n.midi)}
                  </span>
                ))}
                {snap.wrongHeld.map((m) => <span key={m} className="chip bad">✕ {nameOf(m)}</span>)}
              </div>
            )}
          </div>

          <div className="card card-pad grid" style={{ gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="eyebrow">Progress</span>
              <span className="muted" style={{ fontSize: 12 }}>{done}/{steps.length} steps{snap.loop ? ` · loop ×${snap.loopCount}` : ''}</span>
            </div>
            <div className="progress-bar"><div style={{ width: `${progress * 100}%` }} /></div>
            <div className="stat-row">
              <div className="stat"><div className="k">Accuracy</div><div className="v">{fmtPct(accuracy)}</div></div>
              <div className="stat"><div className="k">Correct</div><div className="v" style={{ color: 'var(--correct)' }}>{stats.correct}</div></div>
              <div className="stat"><div className="k">Wrong</div><div className="v" style={{ color: stats.incorrect ? 'var(--wrong)' : undefined }}>{stats.incorrect}</div></div>
            </div>
            <div className="hand-bars">
              {(['L', 'R'] as Hand[]).filter((h) => handsPresent.includes(h)).map((h) => {
                const hs = stats.byHand[h];
                const v = hs.steps ? hs.cleanSteps / hs.steps : null;
                return (
                  <div className="hand-bar" key={h}>
                    <span><span className={`hand-chip ${h.toLowerCase()}`} /> {h === 'L' ? 'Left' : 'Right'}</span>
                    <div className="track"><div className="fill" style={{ width: `${(v ?? 0) * 100}%`, background: h === 'L' ? 'var(--hand-l)' : 'var(--hand-r)' }} /></div>
                    <span className="muted" style={{ textAlign: 'right' }}>{fmtPct(v)}</span>
                  </div>
                );
              })}
            </div>
            {settings.mode === 'rhythm' && stats.deviations.length > 0 && (
              <div className="muted" style={{ fontSize: 12.5 }}>
                Timing: average offset {Math.round(stats.deviations.reduce((a, b) => a + Math.abs(b), 0) / stats.deviations.length)} ms · last {Math.round(stats.deviations[stats.deviations.length - 1])} ms
              </div>
            )}
          </div>
        </aside>
      </div>

      <div className="card transport">
        <button className="btn primary lg" onClick={togglePlay} style={{ minWidth: 120 }}>
          {state === 'playing' || state === 'countIn' ? '❚❚ Pause' : state === 'paused' ? '▶ Resume' : state === 'completed' ? '↻ Again' : '▶ Start'}
        </button>
        <button className="btn" onClick={() => app.engine.restart()} title="Restart (R)">↺ Restart</button>
        <span className="sep" />
        <button className="btn icon" onClick={() => app.engine.prevMeasure(now())} title="Previous measure (←)">‹</button>
        <span className="muted" style={{ minWidth: 76, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>m. {curMeasure + 1} / {exercise.measures.length}</span>
        <button className="btn icon" onClick={() => app.engine.nextMeasure(now())} title="Next measure (→)">›</button>
        <LoopControl />
        <span className="sep" />
        <button className="btn" disabled={!snap.mistakes.some((m) => m.played !== undefined || m.kind === 'incompleteChord' || m.kind === 'missed')} onClick={() => app.drillMistakes()} title="Practice only the measures where you made mistakes">⟲ Repeat mistakes</button>
        <button className="btn ghost" onClick={() => { app.engine.resetProgress(); app.history.clearExercise(exercise.id); app.historyVersion.set((v) => v + 1); }} title="Clear the marks and statistics for this exercise">Reset progress</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="bpm" style={{ opacity: settings.mode === 'rhythm' ? 1 : 0.55 }}>
            <span className="muted">♩=</span>
            <input type="range" min={30} max={200} value={settings.bpm} onChange={(e) => app.updateSettings({ bpm: Number(e.target.value) })} aria-label="Tempo in BPM" />
            <span className="val">{settings.bpm} BPM</span>
          </div>
          <button className={`btn icon ${prefs.metronome ? 'on' : ''}`} onClick={() => { metronome.unlock(); app.setPrefs({ metronome: !prefs.metronome }); }} title="Metronome (rhythm mode)">𝅘𝅥</button>
          <button className="btn icon" onClick={exportXml} title="Export as MusicXML">⤓</button>
          <div style={{ position: 'relative' }}>
            <button className={`btn icon ${showSettings ? 'on' : ''}`} onClick={() => setShowSettings((v) => !v)} title="Practice settings">⚙</button>
            {showSettings && <SettingsPopover onClose={() => setShowSettings(false)} />}
          </div>
        </div>
      </div>

      <div className="piano-dock">
        <Piano low={lo} high={hi} held={snap.heldKeys} labels={prefs.noteNames} onRendered={() => app.markRendered(snap.version)} {...pianoProps} />
      </div>

      {report && <ReportModal report={report} />}
    </div>
  );
}

function StageStatus() {
  const snap = useStore(app.engineState);
  const midi = useStore(app.midi);
  const [, force] = useState(0);
  const isCount = snap.state === 'countIn';
  useEffect(() => {
    if (!isCount) return;
    let raf = 0;
    const f = () => { force((x) => x + 1); raf = requestAnimationFrame(f); };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [isCount]);

  let countText: string | null = null;
  if (isCount) {
    const tr = snap.transport;
    const tick = tr.anchorTick + (performance.now() - tr.anchorTime) * tr.ticksPerMs;
    const bt = beatTicks(snap.exercise.time);
    const left = Math.ceil((snap.runStartTick - tick) / bt);
    countText = left > 0 ? String(left) : null;
  }
  return (
    <>
      {countText && <div className="countin">{countText}</div>}
      <div className="stage-status">
        {snap.pauseReason === 'midi-disconnected' ? (
          <><span className="dot bad pulse" /> MIDI disconnected: reconnect your keyboard{midi.lastLost ? ` (${midi.lastLost.name})` : ''}</>
        ) : snap.state === 'paused' ? (
          <><span className="dot warn" /> Paused{snap.pauseReason === 'hidden' ? ' (tab hidden)' : ''}. Your position is kept</>
        ) : snap.state === 'playing' && snap.transport.frozen && snap.settings.mode === 'rhythm' ? (
          <><span className="dot warn pulse" /> Waiting for the missed note</>
        ) : snap.state === 'playing' || isCount ? (
          <><span className="dot ok" /> {snap.settings.mode === 'rhythm' ? (isCount ? 'Count-in' : 'Playing in time') : 'Listening'}</>
        ) : snap.state === 'completed' ? (
          <><span className="dot ok" /> Complete</>
        ) : (
          <><span className="dot" /> Ready</>
        )}
      </div>
    </>
  );
}

function LoopControl() {
  const snap = useStore(app.engineState);
  const n = snap.exercise.measures.length;
  const loop = snap.loop;
  const cur = snap.currentStep?.measure ?? 0;
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <button className={`btn ${loop ? 'on' : ''}`} onClick={() => app.engine.setLoop(loop ? null : { start: cur, end: cur }, performance.now())} title="Loop the selected measures (L)">⟳ Loop</button>
      {loop && (
        <>
          <select className="input" value={loop.start} onChange={(e) => app.engine.setLoop({ start: Number(e.target.value), end: Math.max(Number(e.target.value), loop.end) }, performance.now())} aria-label="Loop start">
            {Array.from({ length: n }, (_, i) => <option key={i} value={i}>m. {i + 1}</option>)}
          </select>
          <span className="muted">–</span>
          <select className="input" value={loop.end} onChange={(e) => app.engine.setLoop({ start: Math.min(loop.start, Number(e.target.value)), end: Number(e.target.value) }, performance.now())} aria-label="Loop end">
            {Array.from({ length: n }, (_, i) => <option key={i} value={i}>m. {i + 1}</option>)}
          </select>
        </>
      )}
    </div>
  );
}

function SettingsPopover({ onClose }: { onClose: () => void }) {
  const snap = useStore(app.engineState);
  const prefs = useStore(app.prefs);
  const s = snap.settings;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.parentElement!.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [onClose]);
  return (
    <div className="card popover" ref={ref}>
      <div className="field">
        <label>Feedback sensitivity</label>
        <div className="seg">
          {(['gentle', 'standard', 'strict'] as Sensitivity[]).map((v) => (
            <button key={v} className={s.sensitivity === v ? 'active' : ''} onClick={() => app.updateSettings({ sensitivity: v })}>{v[0].toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          {s.sensitivity === 'gentle' ? 'Wrong notes are shown and counted, but a held wrong key does not block you.' : s.sensitivity === 'strict' ? 'A wrong note also clears a partly played chord.' : 'Release any wrong key before the step completes.'}
        </span>
      </div>
      <div className="field">
        <label>Chord tolerance: {s.chordToleranceMs} ms</label>
        <input type="range" min={50} max={1000} step={10} value={s.chordToleranceMs} onChange={(e) => app.updateSettings({ chordToleranceMs: Number(e.target.value) })} />
      </div>
      <div className="field">
        <label>Timing tolerance (rhythm): ±{s.timingToleranceMs} ms</label>
        <input type="range" min={40} max={400} step={10} value={s.timingToleranceMs} onChange={(e) => app.updateSettings({ timingToleranceMs: Number(e.target.value) })} />
      </div>
      <div className="check-row">
        <label><input type="checkbox" checked={s.rhythmStopOnMiss} onChange={(e) => app.updateSettings({ rhythmStopOnMiss: e.target.checked })} /> Stop at missed notes</label>
        <label><input type="checkbox" checked={s.countInMeasures > 0} onChange={(e) => app.updateSettings({ countInMeasures: e.target.checked ? 1 : 0 })} /> Count-in</label>
      </div>
      <div className="field">
        <label>Note names on keys</label>
        <div className="seg">
          {(['none', 'c-only', 'all'] as const).map((v) => (
            <button key={v} className={prefs.noteNames === v ? 'active' : ''} onClick={() => app.setPrefs({ noteNames: v })}>{v === 'none' ? 'Off' : v === 'c-only' ? 'C only' : 'All'}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Keyboard range</label>
        <div className="seg">
          <button className={prefs.pianoRange === 'full' ? 'active' : ''} onClick={() => app.setPrefs({ pianoRange: 'full' })}>88 keys</button>
          <button className={prefs.pianoRange === 'fit' ? 'active' : ''} onClick={() => app.setPrefs({ pianoRange: 'fit' })}>Fit exercise</button>
        </div>
      </div>
    </div>
  );
}

let connectDismissed = false;

function ConnectCard() {
  const midi = useStore(app.midi);
  const last = useStore(app.lastNoteOn);
  const [dismissed, setDismissedState] = useState(connectDismissed);
  const setDismissed = (v: boolean) => { connectDismissed = v; setDismissedState(v); };
  if (dismissed) return null;
  const s1 = midi.status === 'ready';
  const s2 = s1 && midi.connected;
  return (
    <div className="connect-card">
      <div className="card">
        <div className="eyebrow">Setup</div>
        <h2 className="display" style={{ fontSize: 24 }}>Connect your keyboard</h2>
        <p className="muted" style={{ margin: 0 }}>Plug your keyboard into a USB port with a MIDI-to-USB cable, then allow MIDI access in the browser.</p>
        <div className="connect-steps">
          <div className={`s ${s1 ? 'done' : ''}`}><span className="n">{s1 ? '✓' : 1}</span> Allow MIDI access {midi.status === 'denied' && <span style={{ color: 'var(--wrong)' }}>(blocked)</span>}</div>
          <div className={`s ${s2 ? 'done' : ''}`}><span className="n">{s2 ? '✓' : 2}</span> {s2 ? `Connected: ${midi.devices.find((d) => d.id === midi.selectedId)?.name ?? 'MIDI input'}` : 'Detect a MIDI input device'}</div>
          <div className={`s ${last ? 'done' : ''}`}><span className="n">{last ? '✓' : 3}</span> {last ? `Detected key ${midiToName(last.midi)} (velocity ${last.velocity})` : 'Press any key to confirm'}</div>
        </div>
        {midi.error && <div className={`banner ${midi.status === 'denied' || midi.status === 'unsupported' || midi.status === 'insecure' ? 'bad' : ''}`}>{midi.error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          {midi.status !== 'ready' ? (
            <button className="btn primary lg" onClick={() => app.initMidi()} disabled={midi.status === 'requesting' || midi.status === 'unsupported' || midi.status === 'insecure'}>
              {midi.status === 'requesting' ? 'Waiting for permission…' : 'Enable MIDI'}
            </button>
          ) : !midi.connected ? (
            <button className="btn lg" onClick={() => app.view.set('midi')}>Open MIDI diagnostics</button>
          ) : null}
          <button className="btn ghost lg" onClick={() => setDismissed(true)}>View the score first</button>
        </div>
      </div>
    </div>
  );
}
