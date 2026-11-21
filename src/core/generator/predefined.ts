import type { DurationCode, Exercise, Hand, HandSelection, Measure, NoteGroup, TimeSignature } from '../model/types';
import { DURATION_TICKS, measureTicks } from '../model/types';
import type { KeySpec } from '../music/keys';
import { parsePitch, Pitch } from '../music/pitch';

/**
 * A compact text format for writing scores.
 *   "C4 D4/h [C4 E4 G4]/q r/q | E4/w"
 * Each token is a note, a [chord] or r (rest), with an optional /duration (default q).
 * Measures are separated by "|".
 */
export function parseVoice(text: string, hand: Hand, time: TimeSignature): NoteGroup[][] {
  const measures = text.split('|').map((s) => s.trim()).filter(Boolean);
  const total = measureTicks(time);
  return measures.map((mText, mi) => {
    const tokens = mText.match(/\[[^\]]+\](?:\/\w+)?|\S+/g) ?? [];
    let tick = 0;
    const groups = tokens.map((tok, gi): NoteGroup => {
      const [body, durRaw] = tok.split('/');
      const duration = (durRaw ?? 'q') as DurationCode;
      if (!(duration in DURATION_TICKS)) throw new Error(`Bad duration "${durRaw}" in "${tok}"`);
      let pitches: Pitch[] = [];
      if (body !== 'r') {
        const names = body.replace(/[[\]]/g, '').split(/\s+/).filter(Boolean);
        pitches = names.map((n) => {
          const p = parsePitch(n);
          if (!p) throw new Error(`Bad pitch "${n}"`);
          return p;
        });
      }
      const g = { id: `m${mi}-${hand}-${gi}`, startTick: tick, duration, pitches };
      tick += DURATION_TICKS[duration];
      return g;
    });
    if (tick !== total) throw new Error(`Measure ${mi + 1} (${hand}) has ${tick} ticks; expected ${total}`);
    return groups;
  });
}

export function buildExercise(opts: {
  id: string;
  title: string;
  description?: string;
  key?: KeySpec;
  time?: TimeSignature;
  right?: string;
  left?: string;
}): Exercise {
  const time = opts.time ?? { beats: 4, beatType: 4 };
  const key = opts.key ?? { fifths: 0, mode: 'major' };
  const r = opts.right ? parseVoice(opts.right, 'R', time) : undefined;
  const l = opts.left ? parseVoice(opts.left, 'L', time) : undefined;
  const count = Math.max(r?.length ?? 0, l?.length ?? 0);
  if (r && l && r.length !== l.length) throw new Error(`${opts.id}: the two hands have different measure counts`);
  const measures: Measure[] = [];
  for (let i = 0; i < count; i++) {
    const voices: Measure['voices'] = {};
    if (r) voices.R = { hand: 'R', staff: 'treble', groups: r[i] };
    if (l) voices.L = { hand: 'L', staff: 'bass', groups: l[i] };
    measures.push({ index: i, voices });
  }
  const hands: HandSelection = r && l ? 'both' : r ? 'R' : 'L';
  return { id: opts.id, title: opts.title, description: opts.description, key, time, hands, measures, source: 'predefined' };
}

export const PREDEFINED: Exercise[] = [
  buildExercise({
    id: 'five-finger-rh',
    title: 'Five-finger position C · Right hand',
    description: 'Stepwise motion within C4–G4. Thumb on middle C.',
    right: 'C4 D4 E4 F4 | G4 F4 E4 D4 | C4 E4 D4 F4 | E4 D4 C4/h',
  }),
  buildExercise({
    id: 'five-finger-lh',
    title: 'Five-finger position C · Left hand',
    description: 'Stepwise motion within C3–G3. Pinky on C3.',
    left: 'C3 D3 E3 F3 | G3 F3 E3 D3 | C3 E3 D3 F3 | E3 D3 C3/h',
  }),
  buildExercise({
    id: 'parallel-both',
    title: 'Parallel motion · Both hands',
    description: 'Both hands move together, an octave apart.',
    right: 'C4 D4 E4 F4 | G4/h E4/h | F4 E4 D4 E4 | C4/w',
    left: 'C3 D3 E3 F3 | G3/h E3/h | F3 E3 D3 E3 | C3/w',
  }),
  buildExercise({
    id: 'contrary-both',
    title: 'Contrary motion · Both hands',
    description: 'The hands move away from each other and back. Both thumbs start on C.',
    right: 'C4 D4 E4 F4 | G4/h F4/h | E4 D4 E4 D4 | C4/w',
    left: 'C3 B2 A2 G2 | F2/h G2/h | A2 B2 A2 B2 | C3/w',
  }),
  buildExercise({
    id: 'repeated-notes',
    title: 'Repeated notes',
    description: 'Each repeated note needs a fresh key press.',
    right: 'C4 C4 D4 D4 | E4 E4 D4/h | E4 E4 F4 F4 | G4 G4 C4/h',
  }),
  buildExercise({
    id: 'chords-145',
    title: 'I – IV – V – I chords',
    description: 'Right-hand triads over a left-hand bass line. Play each chord as one gesture.',
    right: '[C4 E4 G4]/w | [C4 F4 A4]/w | [B3 D4 G4]/w | [C4 E4 G4]/w',
    left: 'C3/w | F3/w | G3/w | C3/w',
  }),
  buildExercise({
    id: 'g-major-scale',
    title: 'G major scale · Both hands',
    description: 'One octave in parallel motion. Watch the F♯.',
    key: { fifths: 1, mode: 'major' },
    right: 'G4 A4 B4 C5 | D5 E5 F#5 G5 | F#5 E5 D5 C5 | B4 A4 G4/h',
    left: 'G2 A2 B2 C3 | D3 E3 F#3 G3 | F#3 E3 D3 C3 | B2 A2 G2/h',
  }),
  buildExercise({
    id: 'ode-to-joy',
    title: 'Ode to Joy (Beethoven) · Right hand',
    description: 'The theme from the Ninth Symphony (public domain).',
    right:
      'E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4/qd D4/8 D4/h | ' +
      'E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4/qd C4/8 C4/h',
  }),
  buildExercise({
    id: 'waltz-34',
    title: 'Waltz bass · 3/4',
    description: 'Bass note then chord, a common left-hand pattern.',
    time: { beats: 3, beatType: 4 },
    right: 'E4/hd | F4/hd | D4/hd | C4/hd',
    left: 'C3 [E3 G3] [E3 G3] | F3 [A3 C4] [A3 C4] | G2 [B2 F3] [B2 F3] | C3 [E3 G3] [E3 G3]',
  }),
  buildExercise({
    id: 'overlap-hands',
    title: 'Crossing ranges · Both hands',
    description: 'The hands share middle C. Hand assignment comes from the score.',
    right: 'C4 E4 D4 C4 | E4 F4 G4/h',
    left: 'G3 E3 F3 C4 | C4 B3 C4/h',
  }),
];
