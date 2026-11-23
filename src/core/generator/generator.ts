import { Rng } from './random';
import type {
  DurationCode, Exercise, GeneratorConfig, Hand, Measure, NoteGroup, TimeSignature, Voice,
} from '../model/types';
import { DURATION_TICKS, measureTicks } from '../model/types';
import { isBlackKey, Pitch, pitchToMidi } from '../music/pitch';
import { keyName, keyTonic, scalePitches } from '../music/keys';

export const DEFAULT_CONFIG: GeneratorConfig = {
  hands: 'R',
  leftRange: { low: 48, high: 55 }, // C3..G3
  rightRange: { low: 60, high: 67 }, // C4..G4
  measures: 8,
  measuresPerLine: 4,
  notesPerMeasure: 4,
  key: { fifths: 0, mode: 'major' },
  scale: 'diatonic',
  time: { beats: 4, beatType: 4 },
  durations: ['h', 'q'],
  texture: 'single',
  difficulty: 1,
  seed: 1,
};

export function beatTicks(t: TimeSignature): number {
  if (t.beatType === 8 && t.beats % 3 === 0) return 6; // compound meter: dotted-quarter beat
  return (16 / t.beatType);
}

/**
 * Split one measure into durations whose ticks sum exactly to the measure length.
 * It uses the number of notes closest to `target` that the allowed durations can fill.
 */
export function composeRhythm(rng: Rng, time: TimeSignature, allowed: DurationCode[], target: number, syncopation = false): DurationCode[] {
  const total = measureTicks(time);
  const durs = [...new Set(allowed)].filter((d) => DURATION_TICKS[d] <= total);
  if (durs.length === 0) durs.push(total >= 4 ? 'q' : '8');
  const maxK = total / 2 + 1;
  // feasible[t][k]: can t ticks be filled with exactly k notes?
  const feasible: boolean[][] = Array.from({ length: total + 1 }, () => Array(maxK + 1).fill(false));
  feasible[0][0] = true;
  for (let t = 1; t <= total; t++)
    for (let k = 1; k <= maxK; k++)
      feasible[t][k] = durs.some((d) => DURATION_TICKS[d] <= t && feasible[t - DURATION_TICKS[d]][k - 1]);

  let k = -1;
  for (let delta = 0; delta <= maxK && k < 0; delta++) {
    if (target - delta >= 1 && feasible[total][target - delta]) k = target - delta;
    else if (target + delta <= maxK && feasible[total][target + delta]) k = target + delta;
  }
  if (k < 0) {
    // The allowed durations cannot fill this measure. Fall back to quarters and eighths.
    return composeRhythm(rng, time, ['q', '8'], target, syncopation);
  }
  const beat = beatTicks(time);
  const out: DurationCode[] = [];
  let pos = 0;
  let remaining = total;
  while (k > 0) {
    const options = durs.filter((d) => DURATION_TICKS[d] <= remaining && feasible[remaining - DURATION_TICKS[d]][k - 1]);
    // Prefer durations that don't cross a beat from an off-beat position (easier to read).
    const weights = options.map((d) => {
      const dt = DURATION_TICKS[d];
      const offBeat = pos % beat !== 0;
      const crosses = offBeat && (pos % beat) + dt > beat;
      return crosses && !syncopation ? 0.15 : 1;
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    let r = rng.next() * sum;
    let choice = options[options.length - 1];
    for (let i = 0; i < options.length; i++) {
      r -= weights[i];
      if (r <= 0) { choice = options[i]; break; }
    }
    out.push(choice);
    pos += DURATION_TICKS[choice];
    remaining -= DURATION_TICKS[choice];
    k--;
  }
  return out;
}

const MAX_LEAP: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 7 };

function pickStepSize(rng: Rng, maxLeap: number): number {
  const weights: number[] = [];
  for (let m = 0; m <= maxLeap; m++) weights.push(m === 0 ? 0.5 : m === 1 ? 3 : m === 2 ? 2 : 1.2 / (m - 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * sum;
  for (let m = 0; m <= maxLeap; m++) {
    r -= weights[m];
    if (r <= 0) return m;
  }
  return 1;
}

function nearestTonicIndex(pitches: Pitch[], cfg: GeneratorConfig, preferMiddle = true): number {
  const t = keyTonic(cfg.key);
  const candidates = pitches.map((p, i) => ({ p, i })).filter(({ p }) => p.step === t.step && p.alter === t.alter);
  if (candidates.length === 0) return preferMiddle ? Math.floor(pitches.length / 2) : 0;
  if (!preferMiddle) return candidates[0].i;
  const mid = (pitches.length - 1) / 2;
  candidates.sort((a, b) => Math.abs(a.i - mid) - Math.abs(b.i - mid));
  return candidates[0].i;
}

function buildChord(rootIdx: number, pitches: Pitch[], size: number, chromatic: boolean): Pitch[] | null {
  const offsets = chromatic ? (size === 2 ? [0, 4] : [0, 4, 7]) : size === 2 ? [0, 2] : [0, 2, 4];
  for (let shift = 0; shift <= offsets[offsets.length - 1]; shift++) {
    const r = rootIdx - shift;
    if (r < 0) break;
    const idx = offsets.map((o) => r + o);
    if (idx[idx.length - 1] >= pitches.length) continue;
    const chord = idx.map((i) => pitches[i]);
    const span = pitchToMidi(chord[chord.length - 1]) - pitchToMidi(chord[0]);
    if (span <= 12) return chord;
  }
  return null;
}

function generateVoice(rng: Rng, hand: Hand, cfg: GeneratorConfig): Voice[] {
  const range = hand === 'L' ? cfg.leftRange : cfg.rightRange;
  const low = Math.min(range.low, range.high);
  const high = Math.max(range.low, range.high);
  let pitches = scalePitches(cfg.key, cfg.scale, low, high);
  if (pitches.length === 0) pitches = scalePitches(cfg.key, 'chromatic', low, high);
  if (pitches.length === 0) throw new Error(`The ${hand === 'L' ? 'left' : 'right'}-hand range is empty.`);
  const chromatic = cfg.scale === 'chromatic';
  const d = cfg.difficulty;
  const maxLeap = Math.max(1, Math.round(MAX_LEAP[d] * (chromatic ? 1.7 : 1)));
  const chordProb = cfg.texture === 'chords' ? 1 : cfg.texture === 'mixed' ? 0.15 + 0.07 * d : 0;
  const chordSize = d <= 2 ? 2 : d === 3 ? (rng.chance(0.5) ? 2 : 3) : 3;
  const restProb = d >= 3 ? 0.06 : 0;

  let idx = nearestTonicIndex(pitches, cfg);
  let direction = rng.chance(0.5) ? 1 : -1;
  const voices: Voice[] = [];
  for (let mi = 0; mi < cfg.measures; mi++) {
    const rhythm = composeRhythm(rng, cfg.time, cfg.durations, cfg.notesPerMeasure, d >= 4);
    const groups: NoteGroup[] = [];
    let tick = 0;
    rhythm.forEach((dur, gi) => {
      const first = mi === 0 && gi === 0;
      const last = mi === cfg.measures - 1 && gi === rhythm.length - 1;
      let pitchesOut: Pitch[];
      if (!first && !last && rng.chance(restProb)) {
        pitchesOut = [];
      } else {
        if (!first) {
          const size = pickStepSize(rng, maxLeap);
          if (rng.chance(0.3)) direction = -direction;
          let next = idx + direction * size;
          if (next < 0 || next >= pitches.length) {
            direction = -direction;
            next = idx + direction * size;
          }
          idx = Math.max(0, Math.min(pitches.length - 1, next));
        }
        if (last) idx = nearestTonicIndex(pitches, cfg);
        pitchesOut = [pitches[idx]];
        if (pitches.length >= 3 && rng.chance(chordProb)) {
          const chord = buildChord(idx, pitches, chordSize, chromatic);
          if (chord) pitchesOut = chord;
        }
      }
      groups.push({ id: `m${mi}-${hand}-${gi}`, startTick: tick, duration: dur, pitches: pitchesOut });
      tick += DURATION_TICKS[dur];
    });
    voices.push({ hand, staff: hand === 'R' ? 'treble' : 'bass', groups });
  }
  return voices;
}

const ACCIDENTAL_SHARE = { none: 0, few: 0.1, many: 0.3 } as const;

/**
 * Raise or lower some natural notes to the neighboring black key (so never E#,
 * B#, Cb or Fb), inside the hand's range. The first and last notes stay in the
 * key. The chromatic scale already has accidentals and is left alone.
 */
function addAccidentals(rng: Rng, voices: Voice[], hand: Hand, cfg: GeneratorConfig) {
  const share = ACCIDENTAL_SHARE[cfg.accidentals ?? 'none'];
  if (!share || cfg.scale === 'chromatic') return;
  const range = hand === 'L' ? cfg.leftRange : cfg.rightRange;
  const low = Math.min(range.low, range.high);
  const high = Math.max(range.low, range.high);
  const type = cfg.accidentalType ?? 'both';
  const alters = type === 'sharps' ? [1] : type === 'flats' ? [-1] : [1, -1];

  const sounding = voices.flatMap((v) => v.groups).filter((g) => g.pitches.length > 0);
  const options = sounding.slice(1, -1).map((group) => ({
    group,
    choices: group.pitches.flatMap((p, i) => (p.alter !== 0 ? [] : alters.map((alter) => ({ i, pitch: { ...p, alter } })))).filter(({ i, pitch }) => {
      const midi = pitchToMidi(pitch);
      return isBlackKey(midi) && midi >= low && midi <= high
        && group.pitches.every((q, j) => j === i || pitchToMidi(q) !== midi);
    }),
  })).filter((o) => o.choices.length > 0);

  let remaining = Math.min(options.length, Math.max(1, Math.round(sounding.length * share)));
  while (remaining-- > 0) {
    const [{ group, choices }] = options.splice(rng.int(0, options.length - 1), 1);
    const c = rng.pick(choices);
    group.pitches = group.pitches.map((p, i) => (i === c.i ? c.pitch : p)).sort((a, b) => pitchToMidi(a) - pitchToMidi(b));
  }
}

export function generateExercise(cfg: GeneratorConfig): Exercise {
  const rng = new Rng(cfg.seed);
  const hands: Hand[] = cfg.hands === 'both' ? ['R', 'L'] : [cfg.hands];
  const perHand: Partial<Record<Hand, Voice[]>> = {};
  for (const h of hands) perHand[h] = generateVoice(rng, h, cfg);
  // A separate random stream, so turning accidentals on keeps the same melody
  const accRng = new Rng(cfg.seed ^ 0x5bd1e995);
  for (const h of hands) addAccidentals(accRng, perHand[h]!, h, cfg);
  const measures: Measure[] = [];
  for (let mi = 0; mi < cfg.measures; mi++) {
    const voices: Measure['voices'] = {};
    for (const h of hands) voices[h] = perHand[h]![mi];
    measures.push({ index: mi, voices });
  }
  const handLabel = cfg.hands === 'both' ? 'Both hands' : cfg.hands === 'L' ? 'Left hand' : 'Right hand';
  return {
    id: `gen-${cfg.seed}`,
    title: `${keyName(cfg.key)} · ${handLabel}`,
    description: `${cfg.measures} measures in ${cfg.time.beats}/${cfg.time.beatType}, difficulty ${cfg.difficulty}`,
    key: cfg.key,
    time: cfg.time,
    hands: cfg.hands,
    measures,
    config: cfg,
    source: 'generated',
  };
}

/** Make a new exercise from a subset of measures (for "repeat mistakes" drills). */
export function extractMeasures(ex: Exercise, measureIndexes: number[], title?: string): Exercise {
  const sorted = [...new Set(measureIndexes)].sort((a, b) => a - b);
  return {
    ...ex,
    id: `${ex.id}-drill-${sorted.join('_')}`,
    title: title ?? `${ex.title} · mistake drill`,
    description: `Measures ${sorted.map((i) => i + 1).join(', ')} from “${ex.title}”`,
    source: 'drill',
    measures: sorted.map((src, ni) => {
      const m = ex.measures[src];
      const voices: Measure['voices'] = {};
      for (const h of ['L', 'R'] as Hand[]) {
        const v = m.voices[h];
        if (v) voices[h] = { ...v, groups: v.groups.map((g, gi) => ({ ...g, id: `m${ni}-${h}-${gi}` })) };
      }
      return { index: ni, voices };
    }),
  };
}
