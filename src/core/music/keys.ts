import { Pitch, Step, STEPS, STEP_SEMITONES, pitchToMidi, accidentalSymbol } from './pitch';

export type Mode = 'major' | 'minor';

/** A key, described by its key-signature fifths (-7..7) and mode (like MusicXML <key>). */
export interface KeySpec {
  fifths: number;
  mode: Mode;
}

const SHARP_ORDER: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

const MAJOR_TONICS: Record<number, { step: Step; alter: number }> = {
  [-7]: { step: 'C', alter: -1 }, [-6]: { step: 'G', alter: -1 }, [-5]: { step: 'D', alter: -1 },
  [-4]: { step: 'A', alter: -1 }, [-3]: { step: 'E', alter: -1 }, [-2]: { step: 'B', alter: -1 },
  [-1]: { step: 'F', alter: 0 }, 0: { step: 'C', alter: 0 }, 1: { step: 'G', alter: 0 },
  2: { step: 'D', alter: 0 }, 3: { step: 'A', alter: 0 }, 4: { step: 'E', alter: 0 },
  5: { step: 'B', alter: 0 }, 6: { step: 'F', alter: 1 }, 7: { step: 'C', alter: 1 },
};

const MINOR_TONICS: Record<number, { step: Step; alter: number }> = {
  [-7]: { step: 'A', alter: -1 }, [-6]: { step: 'E', alter: -1 }, [-5]: { step: 'B', alter: -1 },
  [-4]: { step: 'F', alter: 0 }, [-3]: { step: 'C', alter: 0 }, [-2]: { step: 'G', alter: 0 },
  [-1]: { step: 'D', alter: 0 }, 0: { step: 'A', alter: 0 }, 1: { step: 'E', alter: 0 },
  2: { step: 'B', alter: 0 }, 3: { step: 'F', alter: 1 }, 4: { step: 'C', alter: 1 },
  5: { step: 'G', alter: 1 }, 6: { step: 'D', alter: 1 }, 7: { step: 'A', alter: 1 },
};

export function keyTonic(key: KeySpec): { step: Step; alter: number } {
  return (key.mode === 'major' ? MAJOR_TONICS : MINOR_TONICS)[key.fifths];
}

export function keyName(key: KeySpec): string {
  const t = keyTonic(key);
  return `${t.step}${accidentalSymbol(t.alter).replace('b', '♭').replace('#', '♯')} ${key.mode}`;
}

/** Key name as VexFlow expects it, e.g. "Bb", "F#m". */
export function vexKeySignature(key: KeySpec): string {
  const t = keyTonic(key);
  return t.step + accidentalSymbol(t.alter) + (key.mode === 'minor' ? 'm' : '');
}

/** The alteration the key signature applies to a step. */
export function keyAlterFor(step: Step, fifths: number): number {
  if (fifths > 0 && SHARP_ORDER.slice(0, fifths).includes(step)) return 1;
  if (fifths < 0 && FLAT_ORDER.slice(0, -fifths).includes(step)) return -1;
  return 0;
}

/** The keys offered in the UI. Key signatures with up to 6 accidentals cover all practical cases. */
export const KEY_OPTIONS: KeySpec[] = [
  ...[0, 1, 2, 3, 4, 5, 6, -1, -2, -3, -4, -5, -6].map((f) => ({ fifths: f, mode: 'major' as Mode })),
  ...[0, 1, 2, 3, 4, 5, -1, -2, -3, -4, -5, -6].map((f) => ({ fifths: f, mode: 'minor' as Mode })),
];

export type ScaleType = 'diatonic' | 'pentatonic' | 'harmonicMinor' | 'melodicMinor' | 'triad' | 'chromatic';

export const SCALE_LABELS: Record<ScaleType, string> = {
  diatonic: 'Diatonic (the key)',
  pentatonic: 'Pentatonic',
  harmonicMinor: 'Harmonic minor',
  melodicMinor: 'Melodic minor (ascending)',
  triad: 'Tonic triad (arpeggio)',
  chromatic: 'Chromatic',
};

/** Pitch classes of the scale as spelled (step, alter) entries, each with its diatonic offset from the tonic. */
interface ScaleDegree {
  stepOffset: number; // diatonic steps above the tonic letter
  semitones: number; // semitones above the tonic
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NAT_MINOR = [0, 2, 3, 5, 7, 8, 10];
const HARM_MINOR = [0, 2, 3, 5, 7, 8, 11];
const MEL_MINOR = [0, 2, 3, 5, 7, 9, 11];

function degreesFor(scale: ScaleType, mode: Mode): ScaleDegree[] {
  const diatonic = (arr: number[], idx?: number[]) =>
    (idx ?? arr.map((_, i) => i)).map((i) => ({ stepOffset: i, semitones: arr[i] }));
  const base = mode === 'major' ? MAJOR : NAT_MINOR;
  switch (scale) {
    case 'diatonic':
      return diatonic(base);
    case 'pentatonic':
      return mode === 'major' ? diatonic(MAJOR, [0, 1, 2, 4, 5]) : diatonic(NAT_MINOR, [0, 2, 3, 4, 6]);
    case 'harmonicMinor':
      return diatonic(HARM_MINOR);
    case 'melodicMinor':
      return diatonic(MEL_MINOR);
    case 'triad':
      return diatonic(base, [0, 2, 4]);
    case 'chromatic':
      return []; // handled separately
  }
}

/**
 * Every spelled pitch of the scale within [lowMidi, highMidi], sorted ascending.
 * Spelling follows the key, so G major yields F#, never Gb.
 */
export function scalePitches(key: KeySpec, scale: ScaleType, lowMidi: number, highMidi: number): Pitch[] {
  const out: Pitch[] = [];
  if (scale === 'chromatic') {
    const preferFlats = key.fifths < 0;
    for (let m = lowMidi; m <= highMidi; m++) out.push(spellChromatic(m, key, preferFlats));
    return out;
  }
  const tonic = keyTonic(key);
  const tonicStepIdx = STEPS.indexOf(tonic.step);
  const tonicSemis = STEP_SEMITONES[tonic.step] + tonic.alter;
  const degrees = degreesFor(scale, key.mode);
  for (let octave = -1; octave <= 9; octave++) {
    for (const d of degrees) {
      const stepAbs = tonicStepIdx + d.stepOffset;
      const step = STEPS[stepAbs % 7];
      const oct = octave + Math.floor(stepAbs / 7);
      const targetMidi = (octave + 1) * 12 + tonicSemis + d.semitones;
      const natural = pitchToMidi({ step, alter: 0, octave: oct });
      const alter = targetMidi - natural;
      if (alter < -2 || alter > 2) continue;
      const p = { step, alter, octave: oct };
      const m = pitchToMidi(p);
      if (m >= lowMidi && m <= highMidi) out.push(p);
    }
  }
  out.sort((a, b) => pitchToMidi(a) - pitchToMidi(b));
  // A pitch can appear twice when octaves overlap; remove the duplicates.
  return out.filter((p, i) => i === 0 || pitchToMidi(p) !== pitchToMidi(out[i - 1]));
}

/** Spell a MIDI note so that it fits the key: a diatonic note when one matches, otherwise sharp or flat. */
export function spellChromatic(midi: number, key: KeySpec, preferFlats: boolean): Pitch {
  const octaveGuess = Math.floor(midi / 12) - 1;
  // A diatonic spelling in the key always wins.
  for (const step of STEPS) {
    for (const octave of [octaveGuess - 1, octaveGuess, octaveGuess + 1]) {
      const alter = keyAlterFor(step, key.fifths);
      if (pitchToMidi({ step, alter, octave }) === midi) return { step, alter, octave };
    }
  }
  for (const step of STEPS) {
    for (const octave of [octaveGuess - 1, octaveGuess, octaveGuess + 1]) {
      for (const alter of preferFlats ? [0, -1, 1] : [0, 1, -1]) {
        if (pitchToMidi({ step, alter, octave }) === midi) return { step, alter, octave };
      }
    }
  }
  throw new Error(`cannot spell ${midi}`);
}
