import { useEffect, useState } from 'react';
import { app } from '../../app/controller';
import { useStore } from '../hooks';
import { PREDEFINED } from '../../core/generator/predefined';
import { KEY_OPTIONS, keyName, SCALE_LABELS, ScaleType } from '../../core/music/keys';
import { midiToName, MIDI_A0, MIDI_C8 } from '../../core/music/pitch';
import { DURATION_LABELS, DurationCode, GeneratorConfig, NoteRange, Texture, HandSelection } from '../../core/model/types';
import { Piano } from '../piano/Piano';

const NOTE_OPTIONS = Array.from({ length: MIDI_C8 - MIDI_A0 + 1 }, (_, i) => MIDI_A0 + i);
const TIMES = [
  { beats: 4, beatType: 4 },
  { beats: 3, beatType: 4 },
  { beats: 2, beatType: 4 },
  { beats: 6, beatType: 8 },
];

function RangePicker({ label, hand, value, onChange }: { label: string; hand: 'L' | 'R'; value: NoteRange; onChange: (r: NoteRange) => void }) {
  const last = useStore(app.lastNoteOn);
  const midi = useStore(app.midi);
  const [capture, setCapture] = useState<null | { stage: 'low' | 'high'; since: number; low?: number }>(null);
  useEffect(() => {
    if (!capture || !last || last.at <= capture.since) return;
    if (capture.stage === 'low') setCapture({ stage: 'high', since: last.at, low: last.midi });
    else {
      const lo = Math.min(capture.low!, last.midi);
      const hi = Math.max(capture.low!, last.midi);
      onChange({ low: lo, high: hi });
      setCapture(null);
    }
  }, [last, capture, onChange]);
  const sel = (v: number, f: (n: number) => void) => (
    <select className="input" value={v} onChange={(e) => f(Number(e.target.value))}>
      {NOTE_OPTIONS.map((m) => <option key={m} value={m}>{midiToName(m)}</option>)}
    </select>
  );
  return (
    <div className="field full">
      <label><span className={`hand-chip ${hand.toLowerCase()}`} /> {label}</label>
      <div className="range-row">
        <div className="field"><span className="field-label">Lowest</span>{sel(value.low, (n) => onChange({ low: n, high: Math.max(n, value.high) }))}</div>
        <div className="field"><span className="field-label">Highest</span>{sel(value.high, (n) => onChange({ low: Math.min(n, value.low), high: n }))}</div>
        <button className={`btn ${capture ? 'on' : ''}`} disabled={!midi.connected} title={midi.connected ? 'Set the range by pressing two keys on your keyboard' : 'Connect a MIDI keyboard first'}
          onClick={() => setCapture(capture ? null : { stage: 'low', since: last?.at ?? 0 })}>
          {capture ? (capture.stage === 'low' ? 'Press lowest key…' : 'Press highest key…') : '🎹 From keyboard'}
        </button>
      </div>
    </div>
  );
}

export function ExercisesScreen() {
  const cfg = useStore(app.genConfig);
  const [draft, setDraft] = useState<GeneratorConfig>(cfg);
  const set = (p: Partial<GeneratorConfig>) => setDraft((d) => ({ ...d, ...p }));
  const [error, setError] = useState<string | null>(null);

  const go = (newSeed: boolean) => {
    try {
      app.generate({ ...draft, seed: newSeed ? Math.floor(Math.random() * 1e9) : draft.seed });
      setError(null);
      app.view.set('practice');
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  };

  const toggleDur = (d: DurationCode) => {
    const has = draft.durations.includes(d);
    const next = has ? draft.durations.filter((x) => x !== d) : [...draft.durations, d];
    if (next.length) set({ durations: next });
  };

  const lExp = new Map<number, ('L' | 'R')[]>();
  if (draft.hands !== 'R') for (let m = draft.leftRange.low; m <= draft.leftRange.high; m++) lExp.set(m, ['L']);
  if (draft.hands !== 'L') for (let m = draft.rightRange.low; m <= draft.rightRange.high; m++) lExp.set(m, lExp.has(m) ? ['L', 'R'] : ['R']);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Exercises</h1>
        <p>Generate a reading exercise for your own note ranges, or pick one from the library.</p>
      </div>
      <div className="two-col">
        <section className="card card-pad grid" style={{ gap: 18 }}>
          <div>
            <h2>Exercise generator</h2>
            <span className="muted" style={{ fontSize: 12.5 }}>Every note comes from a structured score, the same data the sheet music and the note checking use.</span>
          </div>
          <div className="form-grid">
            <div className="field full">
              <label>Hands</label>
              <div className="seg">
                {(['L', 'R', 'both'] as HandSelection[]).map((h) => (
                  <button key={h} className={draft.hands === h ? 'active' : ''} onClick={() => set({ hands: h })}>
                    {h !== 'R' && <span className="hand-chip l" />}{h !== 'L' && <span className="hand-chip r" />}
                    {h === 'L' ? 'Left hand' : h === 'R' ? 'Right hand' : 'Both hands'}
                  </button>
                ))}
              </div>
            </div>
            {draft.hands !== 'R' && <RangePicker label="Left-hand range" hand="L" value={draft.leftRange} onChange={(r) => set({ leftRange: r })} />}
            {draft.hands !== 'L' && <RangePicker label="Right-hand range" hand="R" value={draft.rightRange} onChange={(r) => set({ rightRange: r })} />}
            <div className="full"><Piano compact held={[]} labels="c-only" expected={lExp} /></div>

            <div className="field">
              <label>Key signature</label>
              <select className="input" value={`${draft.key.fifths}|${draft.key.mode}`} onChange={(e) => { const [f, m] = e.target.value.split('|'); set({ key: { fifths: Number(f), mode: m as 'major' | 'minor' } }); }}>
                {KEY_OPTIONS.map((k) => <option key={`${k.fifths}|${k.mode}`} value={`${k.fifths}|${k.mode}`}>{keyName(k)} ({k.fifths === 0 ? 'no accidentals' : `${Math.abs(k.fifths)} ${k.fifths > 0 ? '♯' : '♭'}`})</option>)}
              </select>
            </div>
            <div className="field">
              <label>Scale / note set</label>
              <select className="input" value={draft.scale} onChange={(e) => set({ scale: e.target.value as ScaleType })}>
                {(Object.keys(SCALE_LABELS) as ScaleType[]).map((s) => <option key={s} value={s}>{SCALE_LABELS[s]}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Time signature</label>
              <div className="seg">
                {TIMES.map((t) => (
                  <button key={`${t.beats}/${t.beatType}`} className={draft.time.beats === t.beats && draft.time.beatType === t.beatType ? 'active' : ''} onClick={() => set({ time: t })}>{t.beats}/{t.beatType}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Texture</label>
              <div className="seg">
                {(['single', 'mixed', 'chords'] as Texture[]).map((t) => (
                  <button key={t} className={draft.texture === t ? 'active' : ''} onClick={() => set({ texture: t })}>{t === 'single' ? 'Single notes' : t === 'mixed' ? 'Mixed' : 'Chords'}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Measures: {draft.measures}</label>
              <input type="range" min={1} max={16} value={draft.measures} onChange={(e) => set({ measures: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Notes per measure: {draft.notesPerMeasure}</label>
              <input type="range" min={1} max={8} value={draft.notesPerMeasure} onChange={(e) => set({ notesPerMeasure: Number(e.target.value) })} />
            </div>
            <div className="field full">
              <label>Note durations</label>
              <div className="check-row">
                {(Object.keys(DURATION_LABELS) as DurationCode[]).map((d) => (
                  <label key={d}><input type="checkbox" checked={draft.durations.includes(d)} onChange={() => toggleDur(d)} /> {DURATION_LABELS[d]}</label>
                ))}
              </div>
            </div>
            <div className="field full">
              <label>Difficulty: {draft.difficulty}, {['', 'steps and thirds', 'up to fourths', 'up to fifths, some rests', 'up to sixths, syncopation', 'octave leaps, full chords'][draft.difficulty]}</label>
              <input type="range" min={1} max={5} value={draft.difficulty} onChange={(e) => set({ difficulty: Number(e.target.value) as GeneratorConfig['difficulty'] })} />
            </div>
            <div className="field">
              <label>Seed (the same seed gives the same exercise)</label>
              <input className="input" type="number" value={draft.seed} onChange={(e) => set({ seed: Number(e.target.value) || 1 })} />
            </div>
          </div>
          {error && <div className="banner bad">{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary lg" onClick={() => go(true)}>Generate random exercise</button>
            <button className="btn lg" onClick={() => go(false)}>Use this seed</button>
          </div>
        </section>

        <section className="card card-pad grid" style={{ gap: 12 }}>
          <h2>Library</h2>
          <div className="lib-list">
            {PREDEFINED.map((ex) => (
              <button key={ex.id} className="lib-item" onClick={() => { app.loadExercise(ex); app.updateSettings({ hands: ex.hands }); app.view.set('practice'); }}>
                <span className="t">{ex.title}</span>
                <span className="badge">{ex.hands === 'both' ? 'Both hands' : ex.hands === 'L' ? 'LH' : 'RH'} · {keyName(ex.key)}</span>
                <span className="d">{ex.description}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
