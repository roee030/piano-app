/**
 * Practice State Machine and Note Evaluation Engine.
 *
 * Everything is deterministic. Callers pass time explicitly (MIDI timestamps,
 * in the performance.now() time base). The engine has no timers, DOM or AI.
 *
 * States: idle -> (countIn ->) playing <-> paused -> completed
 */
import type { Exercise, Hand } from '../model/types';
import { measureTicks } from '../model/types';
import { beatTicks } from '../generator/generator';
import { midiToName, pitchClass } from '../music/pitch';
import { buildSteps, firstStepOfMeasure, lastStepOfMeasure, ExpectedNote, Step } from './timeline';
import {
  DEFAULT_SETTINGS, EngineState, Feedback, LoopRange, Mistake, MistakeKind, NoteStatus, PauseReason,
  PracticeSettings, PracticeStats, StepResult, TransportInfo,
} from './types';

interface StepRuntime {
  /** Fresh presses of expected keys since the step became active: midi -> press time */
  pressed: Map<number, number>;
  /** Wrong keys pressed during this step and still held */
  wrongHeld: Set<number>;
  /** Wrong keys pressed in this step, for display on the staff */
  wrongPlayed: { midi: number; kind: MistakeKind }[];
  errors: number;
  activatedAt: number;
  missedReported: boolean;
  /** Rhythm mode: signed deviation per key (ms) */
  deviations: Map<number, number>;
}

export interface EngineSnapshot {
  version: number;
  state: EngineState;
  pauseReason?: PauseReason;
  settings: PracticeSettings;
  exercise: Exercise;
  steps: Step[];
  stepIndex: number;
  currentStep?: Step;
  nextStep?: Step;
  noteStatus: Record<number, NoteStatus>;
  wrongHeld: number[];
  wrongPlayed: { midi: number; kind: MistakeKind }[];
  heldKeys: number[];
  sustain: boolean;
  lastFeedback?: Feedback;
  stepResults: Record<number, StepResult>;
  loop: LoopRange | null;
  loopCount: number;
  transport: TransportInfo;
  /** First tick of the current run (rhythm count-in ends here) */
  runStartTick: number;
  stats: PracticeStats;
  mistakes: Mistake[];
}

function emptyStats(): PracticeStats {
  return {
    notesPlayed: 0,
    correct: 0,
    incorrect: 0,
    byHand: { L: { correct: 0, incorrect: 0, steps: 0, cleanSteps: 0 }, R: { correct: 0, incorrect: 0, steps: 0, cleanSteps: 0 } },
    missedByMidi: {},
    attemptsByStep: {},
    deviations: [],
    releasedEarly: 0,
    heldTooLong: 0,
    startedAt: null,
    endedAt: null,
    activeMs: 0,
    loopsCompleted: 0,
  };
}

const names = (ms: number[]) => ms.map((m) => midiToName(m)).join(' ');

export class PracticeEngine {
  private exercise: Exercise;
  private settings: PracticeSettings;
  private steps: Step[] = [];
  private stepIndex = 0;
  private state: EngineState = 'idle';
  private pauseReason?: PauseReason;
  private rt: StepRuntime = this.newRuntime(0);
  private held = new Map<number, number>();
  private sustain = false;
  private stats: PracticeStats = emptyStats();
  private mistakes: Mistake[] = [];
  private stepResults: Record<number, StepResult> = {};
  private lastFeedback?: Feedback;
  private loop: LoopRange | null = null;
  private loopCount = 0;
  private transport: TransportInfo = { anchorTick: 0, anchorTime: 0, ticksPerMs: 0, frozen: true };
  private runStartTick = 0;
  private activeSince: number | null = null;
  /** Rhythm articulation: key -> its press time and expected length */
  private activeHolds = new Map<number, { pressT: number; expectedMs: number }>();
  private version = 0;
  private listeners = new Set<(s: EngineSnapshot) => void>();
  private snapshot!: EngineSnapshot;

  constructor(exercise: Exercise, settings: Partial<PracticeSettings> = {}) {
    this.exercise = exercise;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.rebuild();
  }

  // ---------------------------------------------------------------- public API

  subscribe(cb: (s: EngineSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getSnapshot(): EngineSnapshot {
    return this.snapshot;
  }

  setExercise(ex: Exercise) {
    this.exercise = ex;
    this.loop = null;
    this.rebuild();
  }

  updateSettings(patch: Partial<PracticeSettings>, now?: number) {
    const prev = this.settings;
    this.settings = { ...this.settings, ...patch };
    if (patch.hands !== undefined && patch.hands !== prev.hands) {
      this.rebuild();
      return;
    }
    if (patch.mode !== undefined && patch.mode !== prev.mode) {
      // Switching mode starts a new attempt from the current measure.
      const measure = this.steps[this.stepIndex]?.measure ?? 0;
      this.resetAttempt();
      this.stepIndex = firstStepOfMeasure(this.steps, measure);
      this.rt = this.newRuntime(0);
    }
    if (patch.bpm !== undefined && now !== undefined && this.isRunning() && !this.transport.frozen) {
      // Re-anchor so the transport continues smoothly at the new tempo.
      this.transport = { anchorTick: this.tickAt(now), anchorTime: now, ticksPerMs: this.ticksPerMs(), frozen: false };
    } else if (patch.bpm !== undefined) {
      this.transport = { ...this.transport, ticksPerMs: this.ticksPerMs() };
    }
    this.emit();
  }

  /** Start (or restart from idle). Rhythm mode begins with a count-in. */
  start(now: number) {
    if (this.steps.length === 0) return;
    if (this.state === 'completed') this.restart();
    if (this.state === 'paused') return this.resume(now);
    if (this.state !== 'idle') return;
    if (this.stats.startedAt === null) this.stats.startedAt = now;
    this.beginRun(now);
    this.emit();
  }

  pause(reason: PauseReason = 'user', now?: number) {
    if (this.state !== 'playing' && this.state !== 'countIn') {
      if (reason === 'midi-disconnected' && this.state === 'idle') {
        this.pauseReason = reason;
        this.emit();
      }
      return;
    }
    this.accumulateActive(now ?? this.transport.anchorTime);
    this.state = 'paused';
    this.pauseReason = reason;
    if (this.settings.mode === 'rhythm' && now !== undefined) this.freezeTransport(now);
    this.emit();
  }

  resume(now: number) {
    if (this.state !== 'paused') return;
    this.pauseReason = undefined;
    // The position is kept. The step's partial input is discarded and needs a fresh press.
    this.rt = this.newRuntime(now);
    this.beginRun(now);
    this.emit();
  }

  restart() {
    this.stepIndex = this.loop ? firstStepOfMeasure(this.steps, this.loop.start) : 0;
    this.resetAttempt();
    this.state = 'idle';
    this.pauseReason = undefined;
    this.emit();
  }

  /** Clear statistics and marks but keep the position. */
  resetProgress() {
    const idx = this.stepIndex;
    this.resetAttempt();
    this.stepIndex = idx;
    this.emit();
  }

  gotoMeasure(measure: number, now = 0) {
    const m = Math.max(0, Math.min(this.exercise.measures.length - 1, measure));
    this.stepIndex = Math.min(firstStepOfMeasure(this.steps, m), Math.max(0, this.steps.length - 1));
    this.rt = this.newRuntime(now);
    this.lastFeedback = undefined;
    if (this.state === 'completed') this.state = 'idle';
    if (this.settings.mode === 'rhythm' && this.isRunning()) {
      this.accumulateActive(now);
      this.state = 'paused';
      this.pauseReason = 'user';
      this.freezeTransport(now);
    }
    this.emit();
  }

  nextMeasure(now = 0) {
    this.gotoMeasure((this.steps[this.stepIndex]?.measure ?? 0) + 1, now);
  }

  prevMeasure(now = 0) {
    this.gotoMeasure((this.steps[this.stepIndex]?.measure ?? 0) - 1, now);
  }

  setLoop(loop: LoopRange | null, now = 0) {
    if (loop) {
      const start = Math.max(0, Math.min(loop.start, loop.end));
      const end = Math.min(this.exercise.measures.length - 1, Math.max(loop.start, loop.end));
      this.loop = { start, end };
      this.loopCount = 0;
      const cur = this.steps[this.stepIndex];
      if (!cur || cur.measure < start || cur.measure > end) {
        this.stepIndex = firstStepOfMeasure(this.steps, start);
        this.rt = this.newRuntime(now);
      }
      if (this.state === 'completed') this.state = 'idle';
    } else {
      this.loop = null;
    }
    this.emit();
  }

  sustainChange(down: boolean) {
    this.sustain = down;
    this.emit();
  }

  noteOn(midi: number, velocity: number, t: number) {
    void velocity;
    this.held.set(midi, t);
    if (this.state === 'idle' && this.settings.mode !== 'rhythm' && this.steps.length > 0 && !this.pauseReason) {
      // In wait and chord mode, the first key press starts the exercise.
      this.start(t);
    }
    if (this.state === 'playing' || this.state === 'countIn') {
      this.stats.notesPlayed++;
      this.evaluateNoteOn(midi, t);
    }
    this.emit();
  }

  noteOff(midi: number, t: number) {
    this.held.delete(midi);
    if (this.state === 'playing' || this.state === 'countIn') {
      this.rt.wrongHeld.delete(midi);
      this.checkArticulation(midi, t);
      this.checkExpiry(t);
      this.tryComplete(t);
    }
    this.emit();
  }

  /** Call every animation frame. Drives the rhythm transport and chord-tolerance expiry. */
  tick(now: number) {
    if (this.state !== 'playing' && this.state !== 'countIn') return;
    let changed = false;
    if (this.state === 'countIn' && this.tickAt(now) >= this.runStartTick) {
      this.state = 'playing';
      changed = true;
    }
    if (this.checkExpiry(now)) changed = true;
    if (this.settings.mode === 'rhythm') {
      const step = this.steps[this.stepIndex];
      if (step && !this.transport.frozen) {
        const tolTicks = this.settings.timingToleranceMs * this.transport.ticksPerMs;
        if (this.tickAt(now) > step.tick + tolTicks && !this.rt.missedReported) {
          const missing = step.notes.filter((n) => !this.rt.pressed.has(n.midi)).map((n) => n.midi);
          this.rt.missedReported = true;
          this.recordMistake('missed', now, { expected: missing });
          this.feedback('missed', now, missing, `Missed ${names(missing)}: too late`);
          if (this.settings.rhythmStopOnMiss) {
            this.freezeTransport(now);
          } else {
            this.stepResults[this.stepIndex] = 'missed';
            this.finishStep(now, false);
          }
          changed = true;
        }
      }
    }
    if (changed) this.emit();
  }

  /** The MIDI device disconnected. This is an input problem, not a playing mistake. */
  inputLost(now: number) {
    for (const m of [...this.held.keys()]) this.held.delete(m);
    this.rt.wrongHeld.clear();
    this.pause('midi-disconnected', now);
    if (this.state !== 'paused') {
      this.pauseReason = 'midi-disconnected';
      this.emit();
    }
  }

  inputRestored() {
    if (this.pauseReason === 'midi-disconnected' && this.state !== 'paused') this.pauseReason = undefined;
    this.emit();
  }

  /** Transport tick at time t (rhythm mode) */
  tickAt(t: number): number {
    const tr = this.transport;
    return tr.frozen ? tr.anchorTick : tr.anchorTick + (t - tr.anchorTime) * tr.ticksPerMs;
  }

  // ------------------------------------------------------------- internals

  private isRunning() {
    return this.state === 'playing' || this.state === 'countIn';
  }

  private ticksPerMs() {
    return (this.settings.bpm * beatTicks(this.exercise.time)) / 60000;
  }

  private rebuild() {
    this.steps = buildSteps(this.exercise, this.settings.hands);
    this.stepIndex = 0;
    this.resetAttempt();
    this.state = 'idle';
    this.pauseReason = undefined;
    this.emit();
  }

  private resetAttempt() {
    this.stats = emptyStats();
    this.mistakes = [];
    this.stepResults = {};
    this.lastFeedback = undefined;
    this.loopCount = 0;
    this.activeSince = null;
    this.activeHolds.clear();
    this.rt = this.newRuntime(0);
    this.transport = { anchorTick: 0, anchorTime: 0, ticksPerMs: this.ticksPerMs(), frozen: true };
  }

  private newRuntime(t: number): StepRuntime {
    return { pressed: new Map(), wrongHeld: new Set(), wrongPlayed: [], errors: 0, activatedAt: t, missedReported: false, deviations: new Map() };
  }

  private beginRun(now: number) {
    this.activeSince = now;
    const step = this.steps[this.stepIndex];
    if (this.settings.mode === 'rhythm') {
      const mTicks = measureTicks(this.exercise.time);
      const measureStart = step.measure * mTicks;
      this.runStartTick = measureStart;
      const countIn = this.settings.countInMeasures * mTicks;
      this.transport = { anchorTick: measureStart - countIn, anchorTime: now, ticksPerMs: this.ticksPerMs(), frozen: false };
      this.state = countIn > 0 ? 'countIn' : 'playing';
    } else {
      this.state = 'playing';
    }
    this.rt.activatedAt = now;
  }

  private freezeTransport(now: number) {
    this.transport = { ...this.transport, anchorTick: this.tickAt(now), anchorTime: now, frozen: true };
  }

  private accumulateActive(now: number) {
    if (this.activeSince !== null) {
      this.stats.activeMs += Math.max(0, now - this.activeSince);
      this.activeSince = null;
    }
  }

  /** Whether a pressed expected key still counts toward the current step. */
  private isValid(midi: number, t: number): boolean {
    const pressT = this.rt.pressed.get(midi);
    if (pressT === undefined) return false;
    const withinTol = t - pressT <= this.settings.chordToleranceMs;
    if (this.settings.mode === 'chord') return withinTol;
    return this.held.has(midi) || withinTol;
  }

  /** Drop presses that have expired. Returns true if anything changed. */
  private checkExpiry(t: number): boolean {
    const step = this.steps[this.stepIndex];
    if (!step || this.rt.pressed.size === 0) return false;
    const expired = [...this.rt.pressed.keys()].filter((m) => !this.isValid(m, t));
    if (expired.length === 0) return false;
    const missing = step.notes.filter((n) => !this.rt.pressed.has(n.midi) || expired.includes(n.midi)).map((n) => n.midi);
    for (const m of expired) this.rt.pressed.delete(m);
    this.rt.errors++;
    this.stats.incorrect++;
    for (const m of missing) this.stats.missedByMidi[m] = (this.stats.missedByMidi[m] ?? 0) + 1;
    this.recordMistake('incompleteChord', t, { expected: missing });
    if (step.notes.length === 1) {
      this.feedback('incompleteChord', t, missing, `Release the wrong key, then play ${names(missing)} again`);
    } else {
      const hint = this.settings.mode === 'chord' ? 'press all the notes together' : 'hold the notes or press them together';
      this.feedback('incompleteChord', t, missing, `Chord incomplete. Missing ${names(missing)}: ${hint}`);
    }
    return true;
  }

  private evaluateNoteOn(midi: number, t: number) {
    const step = this.steps[this.stepIndex];
    if (!step) return;
    this.checkExpiry(t);
    const expected = step.notes.find((n) => n.midi === midi);
    if (expected) {
      this.rt.pressed.set(midi, t);
      this.stats.correct++;
      if (this.settings.mode === 'rhythm') this.recordTiming(expected, step, t);
      this.feedback('correct', t, [midi], `${midiToName(midi)} ✓`, midi);
      this.tryComplete(t);
      return;
    }
    // A wrong key. It is never ignored.
    this.rt.wrongHeld.add(midi);
    this.rt.errors++;
    this.stats.incorrect++;
    const unsatisfied = step.notes.filter((n) => !this.isValid(n.midi, t));
    const pool = unsatisfied.length ? unsatisfied : step.notes;
    const nearest = [...pool].sort((a, b) => Math.abs(a.midi - midi) - Math.abs(b.midi - midi))[0];
    const hand = nearest?.hands[0];
    if (hand) this.stats.byHand[hand].incorrect++;
    for (const n of pool) this.stats.missedByMidi[n.midi] = (this.stats.missedByMidi[n.midi] ?? 0) + 1;

    let kind: MistakeKind;
    let message: string;
    const octaveMatch = pool.find((n) => pitchClass(n.midi) === pitchClass(midi));
    const next = this.steps[this.stepIndex + 1];
    const partial = step.notes.length > 1 && step.notes.some((n) => this.isValid(n.midi, t));
    if (octaveMatch) {
      kind = 'wrongOctave';
      message = `Wrong octave: expected ${midiToName(octaveMatch.midi)}, you played ${midiToName(midi)}`;
    } else if (partial) {
      kind = 'extraNote';
      message = `Extra note ${midiToName(midi)}. The chord is ${names(step.notes.map((n) => n.midi))}`;
    } else if (next && next.notes.some((n) => n.midi === midi)) {
      kind = 'wrongSequence';
      message = `${midiToName(midi)} comes next. Play ${names(pool.map((n) => n.midi))} first`;
    } else {
      kind = 'wrongNote';
      message = `Expected ${names(pool.map((n) => n.midi))}, you played ${midiToName(midi)}`;
    }
    this.rt.wrongPlayed.push({ midi, kind });
    this.recordMistake(kind, t, { played: midi, expected: pool.map((n) => n.midi), hand });
    this.feedback(kind, t, pool.map((n) => n.midi), message, midi);
    if (this.settings.sensitivity === 'strict') this.rt.pressed.clear();
  }

  private recordTiming(n: ExpectedNote, step: Step, t: number) {
    const tickNow = this.tickAt(t);
    const devMs = (tickNow - step.tick) / this.transport.ticksPerMs;
    this.rt.deviations.set(n.midi, devMs);
    this.activeHolds.set(n.midi, { pressT: t, expectedMs: n.durationTicks / this.transport.ticksPerMs });
    if (this.transport.frozen) return; // this was already reported as missed
    this.stats.deviations.push(devMs);
    const tol = this.settings.timingToleranceMs;
    if (devMs < -tol) this.recordMistake('early', t, { expected: [n.midi], deviationMs: devMs, hand: n.hands[0] });
    else if (devMs > tol) this.recordMistake('late', t, { expected: [n.midi], deviationMs: devMs, hand: n.hands[0] });
  }

  private checkArticulation(midi: number, t: number) {
    if (this.settings.mode !== 'rhythm') return;
    const h = this.activeHolds.get(midi);
    if (!h) return;
    this.activeHolds.delete(midi);
    if (this.sustain) return;
    const dur = t - h.pressT;
    const tol = this.settings.timingToleranceMs;
    const step = this.steps[this.stepIndex];
    if (dur < h.expectedMs * 0.5 - tol) {
      this.stats.releasedEarly++;
      this.recordMistake('releasedEarly', t, { expected: [midi] }, step);
    } else if (dur > h.expectedMs * 1.5 + 2 * tol) {
      this.stats.heldTooLong++;
      this.recordMistake('heldTooLong', t, { expected: [midi] }, step);
    }
  }

  private tryComplete(t: number) {
    const step = this.steps[this.stepIndex];
    if (!step) return;
    const allValid = step.notes.every((n) => this.isValid(n.midi, t));
    if (!allValid) return;
    if (this.settings.sensitivity !== 'gentle' && this.rt.wrongHeld.size > 0) return;
    this.finishStep(t, true);
  }

  private finishStep(t: number, completed: boolean) {
    const step = this.steps[this.stepIndex];
    const clean = completed && this.rt.errors === 0;
    if (completed) this.stepResults[this.stepIndex] = clean ? 'clean' : 'corrected';
    this.stats.attemptsByStep[this.stepIndex] = (this.stats.attemptsByStep[this.stepIndex] ?? 0) + 1 + this.rt.errors;
    const handsInStep = new Set<Hand>(step.notes.flatMap((n) => n.hands));
    for (const h of handsInStep) {
      this.stats.byHand[h].steps++;
      if (clean) this.stats.byHand[h].cleanSteps++;
    }
    if (completed) for (const n of step.notes) for (const h of n.hands) this.stats.byHand[h].correct++;

    // In rhythm mode, a step completed while the transport was frozen moves the transport to the step's time.
    if (this.settings.mode === 'rhythm' && this.transport.frozen && this.isRunning()) {
      this.transport = { ...this.transport, anchorTick: step.tick, anchorTime: t, frozen: false };
    }

    const loopEnd = this.loop ? lastStepOfMeasure(this.steps, this.loop.end) : -1;
    if (this.loop && this.stepIndex === loopEnd) {
      this.loopCount++;
      this.stats.loopsCompleted++;
      this.stepIndex = firstStepOfMeasure(this.steps, this.loop.start);
      if (this.settings.mode === 'rhythm') {
        // Count in again before each repetition.
        this.rt = this.newRuntime(t);
        this.beginRun(t);
        return;
      }
    } else {
      this.stepIndex++;
    }
    this.rt = this.newRuntime(t);
    if (this.stepIndex >= this.steps.length) {
      this.stepIndex = this.steps.length;
      this.accumulateActive(t);
      this.stats.endedAt = t;
      this.state = 'completed';
      this.transport = { ...this.transport, anchorTick: this.tickAt(t), anchorTime: t, frozen: true };
    }
  }

  private recordMistake(kind: MistakeKind, t: number, extra: Partial<Mistake>, stepOverride?: Step) {
    const step = stepOverride ?? this.steps[this.stepIndex];
    this.mistakes.push({ kind, time: t, stepIndex: step?.index ?? this.stepIndex, measure: step?.measure ?? 0, expected: [], ...extra });
  }

  private feedback(kind: Feedback['kind'], t: number, expected: number[], message: string, played?: number) {
    this.lastFeedback = { kind, time: t, expected, message, played };
  }

  private emit() {
    const step = this.steps[this.stepIndex];
    const noteStatus: Record<number, NoteStatus> = {};
    if (step) for (const n of step.notes) noteStatus[n.midi] = this.rt.pressed.has(n.midi) ? 'correct' : 'pending';
    this.version++;
    this.snapshot = {
      version: this.version,
      state: this.state,
      pauseReason: this.pauseReason,
      settings: this.settings,
      exercise: this.exercise,
      steps: this.steps,
      stepIndex: this.stepIndex,
      currentStep: step,
      nextStep: this.steps[this.stepIndex + 1],
      noteStatus,
      wrongHeld: [...this.rt.wrongHeld],
      wrongPlayed: [...this.rt.wrongPlayed],
      heldKeys: [...this.held.keys()].sort((a, b) => a - b),
      sustain: this.sustain,
      lastFeedback: this.lastFeedback,
      stepResults: { ...this.stepResults },
      loop: this.loop,
      loopCount: this.loopCount,
      transport: { ...this.transport },
      runStartTick: this.runStartTick,
      stats: { ...this.stats, byHand: { L: { ...this.stats.byHand.L }, R: { ...this.stats.byHand.R } } },
      mistakes: [...this.mistakes],
    };
    for (const l of this.listeners) l(this.snapshot);
  }
}
