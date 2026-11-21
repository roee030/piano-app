import type { Hand, HandSelection } from '../model/types';

export type PracticeMode = 'wait' | 'chord' | 'rhythm';
export type Sensitivity = 'gentle' | 'standard' | 'strict';

export interface PracticeSettings {
  mode: PracticeMode;
  hands: HandSelection;
  /**
   * Chord tolerance: how far apart (ms) the notes of a chord may be pressed and still
   * count together when they are not all held. Chord mode requires every note
   * inside this window, even held ones.
   */
  chordToleranceMs: number;
  /** Rhythm mode: how far (ms) a note may be from its written time and still count as on time */
  timingToleranceMs: number;
  bpm: number;
  /**
   * gentle: a held wrong key doesn't block completing the step.
   * standard: wrong keys must be released before the step completes.
   * strict: a wrong note also clears a partly played chord.
   */
  sensitivity: Sensitivity;
  /** Rhythm mode: stop the transport at a missed note until it is played */
  rhythmStopOnMiss: boolean;
  countInMeasures: number;
}

export const DEFAULT_SETTINGS: PracticeSettings = {
  mode: 'wait',
  hands: 'R',
  chordToleranceMs: 250,
  timingToleranceMs: 150,
  bpm: 72,
  sensitivity: 'standard',
  rhythmStopOnMiss: true,
  countInMeasures: 1,
};

export type MistakeKind =
  | 'wrongNote'
  | 'wrongOctave'
  | 'wrongSequence'
  | 'extraNote'
  | 'incompleteChord'
  | 'missed'
  | 'early'
  | 'late'
  | 'releasedEarly'
  | 'heldTooLong';

/** These kinds are about timing or articulation. They don't count against pitch accuracy. */
export const TIMING_KINDS: MistakeKind[] = ['early', 'late', 'releasedEarly', 'heldTooLong'];

export interface Mistake {
  kind: MistakeKind;
  stepIndex: number;
  measure: number;
  time: number;
  /** The key played (for wrong, extra or octave mistakes) */
  played?: number;
  /** The expected keys this mistake concerns */
  expected: number[];
  hand?: Hand;
  deviationMs?: number;
}

export type NoteStatus = 'pending' | 'correct';

export interface Feedback {
  kind: 'correct' | MistakeKind;
  played?: number;
  expected: number[];
  message: string;
  time: number;
}

export type StepResult = 'clean' | 'corrected' | 'missed';

export interface HandStats {
  correct: number;
  incorrect: number;
  steps: number;
  cleanSteps: number;
}

export interface PracticeStats {
  notesPlayed: number;
  correct: number;
  incorrect: number;
  byHand: Record<Hand, HandStats>;
  /** Expected key -> number of mistakes made while that key was expected */
  missedByMidi: Record<number, number>;
  /** Step index -> number of attempts (1 = played correctly the first time) */
  attemptsByStep: Record<number, number>;
  /** Signed timing deviation (ms) for each note in rhythm mode */
  deviations: number[];
  releasedEarly: number;
  heldTooLong: number;
  startedAt: number | null;
  endedAt: number | null;
  /** Practice time, excluding pauses */
  activeMs: number;
  loopsCompleted: number;
}

export type EngineState = 'idle' | 'countIn' | 'playing' | 'paused' | 'completed';
export type PauseReason = 'user' | 'midi-disconnected' | 'hidden';

export interface TransportInfo {
  /** Transport position (ticks) at `anchorTime` */
  anchorTick: number;
  anchorTime: number;
  ticksPerMs: number;
  frozen: boolean;
}

export interface LoopRange {
  start: number;
  end: number;
}
