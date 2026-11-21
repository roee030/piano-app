import type { Pitch } from '../music/pitch';
import type { KeySpec, ScaleType } from '../music/keys';

export type Hand = 'L' | 'R';
export type HandSelection = 'L' | 'R' | 'both';
export type StaffId = 'treble' | 'bass';

/** Duration codes: w=whole, h=half, q=quarter, 8=eighth; a trailing "d" means dotted. */
export type DurationCode = 'w' | 'hd' | 'h' | 'qd' | 'q' | '8';

/** Ticks per quarter note. The 16th note is the finest grid the generator uses. */
export const TICKS_PER_QUARTER = 4;

export const DURATION_TICKS: Record<DurationCode, number> = {
  w: 16,
  hd: 12,
  h: 8,
  qd: 6,
  q: 4,
  '8': 2,
};

export const DURATION_LABELS: Record<DurationCode, string> = {
  w: 'Whole',
  hd: 'Dotted half',
  h: 'Half',
  qd: 'Dotted quarter',
  q: 'Quarter',
  '8': 'Eighth',
};

export interface TimeSignature {
  beats: number;
  beatType: number;
}

export function measureTicks(t: TimeSignature): number {
  return (t.beats * TICKS_PER_QUARTER * 4) / t.beatType;
}

/** A note, chord or rest at one position in one hand's voice. */
export interface NoteGroup {
  /** Stable id, e.g. "m3-R-1" */
  id: string;
  /** Start tick within the measure */
  startTick: number;
  duration: DurationCode;
  /** Empty for a rest */
  pitches: Pitch[];
}

export interface Voice {
  hand: Hand;
  staff: StaffId;
  groups: NoteGroup[];
}

export interface Measure {
  index: number;
  voices: Partial<Record<Hand, Voice>>;
}

export interface NoteRange {
  low: number; // MIDI
  high: number; // MIDI
}

export type Texture = 'single' | 'mixed' | 'chords';

export interface GeneratorConfig {
  hands: HandSelection;
  leftRange: NoteRange;
  rightRange: NoteRange;
  measures: number;
  notesPerMeasure: number;
  key: KeySpec;
  scale: ScaleType;
  time: TimeSignature;
  durations: DurationCode[];
  texture: Texture;
  difficulty: 1 | 2 | 3 | 4 | 5;
  seed: number;
}

/** The source of truth for notation, evaluation and export. */
export interface Exercise {
  id: string;
  title: string;
  description?: string;
  key: KeySpec;
  time: TimeSignature;
  /** Which hands the score contains */
  hands: HandSelection;
  measures: Measure[];
  /** Generator settings, when the exercise was generated */
  config?: GeneratorConfig;
  source: 'generated' | 'predefined' | 'drill';
}
