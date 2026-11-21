/** Pitch math. Everything here is pure and deterministic. */

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const STEP_SEMITONES: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** A spelled pitch (equivalent to MusicXML <pitch>). */
export interface Pitch {
  step: Step;
  /** -2..2 (double flat .. double sharp) */
  alter: number;
  octave: number;
}

export const MIDI_A0 = 21;
export const MIDI_C8 = 108;

export function pitchToMidi(p: Pitch): number {
  return (p.octave + 1) * 12 + STEP_SEMITONES[p.step] + p.alter;
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Scientific pitch name for a MIDI number, e.g. 60 -> "C4". */
export function midiToName(midi: number, preferFlats = false): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[pc] + octave;
}

export function accidentalSymbol(alter: number): string {
  return alter === 0 ? '' : alter === 1 ? '#' : alter === -1 ? 'b' : alter === 2 ? '##' : alter === -2 ? 'bb' : '';
}

/** Name for a spelled pitch, e.g. {F,1,4} -> "F#4". */
export function pitchName(p: Pitch): string {
  return p.step + accidentalSymbol(p.alter) + p.octave;
}

/** Parse "C4", "F#3", "Bb5", "Ebb2". Returns null when the text is invalid. */
export function parsePitch(text: string): Pitch | null {
  const m = /^([A-Ga-g])(##|bb|#|b|x)?(-?\d)$/.exec(text.trim());
  if (!m) return null;
  const step = m[1].toUpperCase() as Step;
  const acc = m[2] ?? '';
  const alter = acc === '#' ? 1 : acc === 'b' ? -1 : acc === '##' || acc === 'x' ? 2 : acc === 'bb' ? -2 : 0;
  return { step, alter, octave: Number(m[3]) };
}

export function nameToMidi(text: string): number {
  const p = parsePitch(text);
  if (!p) throw new Error(`Invalid pitch name: ${text}`);
  return pitchToMidi(p);
}

export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

/** Default spelling for a MIDI note, using sharps or flats. */
export function midiToPitch(midi: number, preferFlats = false): Pitch {
  const name = midiToName(midi, preferFlats);
  return parsePitch(name)!;
}

export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function samePitch(a: Pitch, b: Pitch): boolean {
  return a.step === b.step && a.alter === b.alter && a.octave === b.octave;
}

/** Diatonic position of a pitch, used to measure staff distance. */
export function diatonicIndex(p: Pitch): number {
  return p.octave * 7 + STEPS.indexOf(p.step);
}
