import { describe, expect, it } from 'vitest';
import { PracticeEngine } from '../src/core/practice/PracticeEngine';
import { buildExercise } from '../src/core/generator/predefined';
import { buildReport } from '../src/core/progress/report';
import { nameToMidi } from '../src/core/music/pitch';
import { Rig } from './helpers';

const N = nameToMidi;

const melody = () => buildExercise({ id: 't', title: 't', right: 'C4 D4 E4 F4 | G4 A4 B4 C5' });
const chords = () => buildExercise({ id: 'c', title: 'c', right: '[C4 E4 G4]/h [D4 F4 A4]/h | C4/w' });
const both = () =>
  buildExercise({ id: 'b', title: 'b', right: 'E4/h G4/h | C5/w', left: 'C3/w | G2 A2 B2 C3' });

describe('Wait mode', () => {
  it('[AC5] a correct note advances the exercise', () => {
    const rig = new Rig(new PracticeEngine(melody(), { hands: 'R' }));
    rig.tap('C4');
    expect(rig.snap.state).toBe('playing');
    expect(rig.snap.stepIndex).toBe(1);
    expect(rig.snap.stepResults[0]).toBe('clean');
  });

  it('[AC4][AC6] a wrong note is detected immediately and does not advance', () => {
    const rig = new Rig(new PracticeEngine(melody(), { hands: 'R' }));
    rig.down('D4');
    const s = rig.snap;
    expect(s.stepIndex).toBe(0);
    expect(s.lastFeedback).toMatchObject({ kind: 'wrongSequence', played: N('D4'), expected: [N('C4')] });
    expect(s.wrongHeld).toEqual([N('D4')]);
    rig.up('D4');
    rig.tap('E4');
    expect(rig.snap.stepIndex).toBe(0);
    expect(rig.snap.lastFeedback).toMatchObject({ kind: 'wrongNote', played: N('E4') });
    rig.tap('C4');
    expect(rig.snap.stepIndex).toBe(1);
    expect(rig.snap.stepResults[0]).toBe('corrected');
  });

  it('detects a wrong octave', () => {
    const rig = new Rig(new PracticeEngine(melody(), { hands: 'R' }));
    rig.tap('C5');
    expect(rig.snap.lastFeedback?.kind).toBe('wrongOctave');
    expect(rig.snap.lastFeedback?.message).toContain('expected C4');
    expect(rig.snap.stepIndex).toBe(0);
  });

  it('a held wrong key blocks completion until it is released (standard sensitivity)', () => {
    const rig = new Rig(new PracticeEngine(melody(), { hands: 'R' }));
    rig.down('F#4');
    rig.down('C4', 50);
    expect(rig.snap.stepIndex).toBe(0);
    rig.up('F#4', 30);
    expect(rig.snap.stepIndex).toBe(1); // C4 is still held, so the step completes
  });

  it('gentle sensitivity: a held wrong key does not block, but the mistake is still recorded', () => {
    const rig = new Rig(new PracticeEngine(melody(), { hands: 'R', sensitivity: 'gentle' }));
    rig.down('F#4');
    rig.down('C4', 50);
    expect(rig.snap.stepIndex).toBe(1);
    expect(rig.snap.mistakes).toHaveLength(1);
  });

  it('[AC15] repeated notes need separate presses; a held key does not carry over', () => {
    const ex = buildExercise({ id: 'r', title: 'r', right: 'C4 C4 C4 D4' });
    const rig = new Rig(new PracticeEngine(ex, { hands: 'R' }));
    rig.down('C4');
    expect(rig.snap.stepIndex).toBe(1);
    rig.advance(1000); // still holding C4
    expect(rig.snap.stepIndex).toBe(1);
    rig.up('C4');
    rig.down('C4', 100);
    expect(rig.snap.stepIndex).toBe(2);
    rig.up('C4', 50);
    rig.tap('C4');
    expect(rig.snap.stepIndex).toBe(3);
  });

  it('completes the exercise only after the last correct note', () => {
    const rig = new Rig(new PracticeEngine(melody(), { hands: 'R' }));
    for (const n of ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']) rig.tap(n);
    expect(rig.snap.state).toBe('playing');
    rig.tap('B4'); // wrong
    expect(rig.snap.state).toBe('playing');
    rig.tap('C5');
    expect(rig.snap.state).toBe('completed');
  });
});

describe('Chords', () => {
  it('[AC7] a chord needs every expected note', () => {
    const rig = new Rig(new PracticeEngine(chords(), { hands: 'R' }));
    rig.down('C4');
    rig.down('E4', 20);
    expect(rig.snap.stepIndex).toBe(0);
    expect(rig.snap.noteStatus).toEqual({ [N('C4')]: 'correct', [N('E4')]: 'correct', [N('G4')]: 'pending' });
    rig.down('G4', 20);
    expect(rig.snap.stepIndex).toBe(1);
  });

  it('[AC8] an extra note is detected and blocks the chord until released', () => {
    const rig = new Rig(new PracticeEngine(chords(), { hands: 'R' }));
    rig.down('C4');
    rig.down('E4', 10);
    rig.down('F4', 10);
    expect(rig.snap.lastFeedback).toMatchObject({ kind: 'extraNote', played: N('F4') });
    rig.down('G4', 10);
    expect(rig.snap.stepIndex).toBe(0);
    rig.up('F4', 10);
    expect(rig.snap.stepIndex).toBe(1);
    expect(rig.snap.stepResults[0]).toBe('corrected');
  });

  it('wait mode: keys pressed one at a time count while they are held', () => {
    const rig = new Rig(new PracticeEngine(chords(), { hands: 'R', mode: 'wait', chordToleranceMs: 100 }));
    rig.down('C4');
    rig.down('E4', 2000);
    rig.down('G4', 2000);
    expect(rig.snap.stepIndex).toBe(1);
  });

  it('a released chord note expires after the chord tolerance and becomes pending again', () => {
    const rig = new Rig(new PracticeEngine(chords(), { hands: 'R', chordToleranceMs: 200 }));
    rig.tap('C4');
    rig.down('E4', 400);
    expect(rig.snap.mistakes.map((m) => m.kind)).toEqual(['incompleteChord']);
    expect(rig.snap.noteStatus[N('C4')]).toBe('pending');
    rig.down('G4', 20);
    expect(rig.snap.stepIndex).toBe(0);
    rig.down('C4', 20);
    expect(rig.snap.stepIndex).toBe(1);
  });

  it('chord mode: all notes must be struck within the tolerance window, even if they are held', () => {
    const rig = new Rig(new PracticeEngine(chords(), { hands: 'R', mode: 'chord', chordToleranceMs: 150 }));
    rig.down('C4');
    rig.down('E4', 300);
    rig.down('G4', 10);
    expect(rig.snap.stepIndex).toBe(0);
    rig.up('C4');
    rig.up('E4');
    rig.up('G4');
    rig.chord(['C4', 'E4', 'G4'], 30);
    expect(rig.snap.stepIndex).toBe(1);
  });

  it('strict sensitivity: a wrong note clears a partly played chord', () => {
    const rig = new Rig(new PracticeEngine(chords(), { hands: 'R', sensitivity: 'strict' }));
    rig.down('C4');
    rig.down('E4', 10);
    rig.tap('B4');
    expect(rig.snap.noteStatus[N('C4')]).toBe('pending');
    rig.down('G4', 10);
    expect(rig.snap.stepIndex).toBe(0);
  });
});

describe('Hands', () => {
  it('[AC9] the left hand works on its own and ignores the right-hand part', () => {
    const rig = new Rig(new PracticeEngine(both(), { hands: 'L' }));
    expect(rig.snap.steps.map((s) => s.notes.map((n) => n.midi))).toEqual([[N('C3')], [N('G2')], [N('A2')], [N('B2')], [N('C3')]]);
    rig.tap('E4'); // a right-hand note is wrong when practicing the left hand
    expect(rig.snap.stepIndex).toBe(0);
    rig.tap('C3');
    expect(rig.snap.stepIndex).toBe(1);
  });

  it('[AC10] the right hand works on its own', () => {
    const rig = new Rig(new PracticeEngine(both(), { hands: 'R' }));
    expect(rig.snap.steps).toHaveLength(3);
    rig.tap('E4');
    rig.tap('G4');
    rig.tap('C5');
    expect(rig.snap.state).toBe('completed');
    expect(rig.snap.stats.byHand.R.correct).toBe(3);
    expect(rig.snap.stats.byHand.L.steps).toBe(0);
  });

  it('[AC11] both hands: notes that start together must be played together; left and right are tracked separately', () => {
    const rig = new Rig(new PracticeEngine(both(), { hands: 'both' }));
    const s0 = rig.snap.steps[0];
    expect(s0.notes.map((n) => [n.midi, n.hands])).toEqual([[N('C3'), ['L']], [N('E4'), ['R']]]);
    rig.down('E4');
    expect(rig.snap.stepIndex).toBe(0);
    rig.down('C3', 20);
    expect(rig.snap.stepIndex).toBe(1); // both held
    rig.up('E4');
    // Step 1: G4 (RH) at beat 3 while LH holds C3
    rig.tap('G4');
    expect(rig.snap.stepIndex).toBe(2);
    rig.up('C3');
    rig.tap('A2'); // wrong: expected C5 + G2
    expect(rig.snap.stats.byHand.L.incorrect).toBe(1);
    rig.chord(['C5', 'G2']);
    rig.tap('A2');
    rig.tap('B2');
    rig.tap('C3');
    expect(rig.snap.state).toBe('completed');
    const st = rig.snap.stats;
    expect(st.byHand.R).toMatchObject({ correct: 3, incorrect: 0, steps: 3 });
    expect(st.byHand.L).toMatchObject({ correct: 5, incorrect: 1, steps: 5, cleanSteps: 4 });
  });

  it('[AC12] overlapping ranges: hands come from the score, and a shared unison needs a single press', () => {
    const ex = buildExercise({ id: 'o', title: 'o', right: 'C4 E4 D4 C4', left: 'G3 E3 F3 C4' });
    const rig = new Rig(new PracticeEngine(ex, { hands: 'both' }));
    const last = rig.snap.steps[3];
    expect(last.notes).toHaveLength(1);
    expect(last.notes[0].hands.sort()).toEqual(['L', 'R']);
    rig.chord(['C4', 'G3']);
    rig.chord(['E4', 'E3']);
    rig.chord(['D4', 'F3']);
    rig.tap('C4');
    expect(rig.snap.state).toBe('completed');
    expect(rig.snap.stats.byHand.L.correct).toBe(4);
    expect(rig.snap.stats.byHand.R.correct).toBe(4);
  });

  it('[AC12] a note inside the other hand’s range is still assigned to the right hand', () => {
    // The RH plays B3, which lies in the usual LH range. It belongs to the RH because the score says so.
    const ex = buildExercise({ id: 'x', title: 'x', right: 'B3 C4 D4 E4', left: 'C4/w' });
    const engine = new PracticeEngine(ex, { hands: 'both' });
    const s0 = engine.getSnapshot().steps[0];
    expect(s0.notes.find((n) => n.midi === N('B3'))!.hands).toEqual(['R']);
    expect(s0.notes.find((n) => n.midi === N('C4'))!.hands).toEqual(['L']);
  });
});

describe('Controls', () => {
  it('[AC13] pause and resume keep the exact position', () => {
    const rig = new Rig(new PracticeEngine(melody(), { hands: 'R' }));
    rig.tap('C4');
    rig.tap('D4');
    expect(rig.snap.stepIndex).toBe(2);
    rig.engine.pause('user', rig.t);
    expect(rig.snap.state).toBe('paused');
    rig.tap('E4'); // ignored while paused
    rig.tap('F4');
    expect(rig.snap.stepIndex).toBe(2);
    rig.engine.resume(rig.t);
    expect(rig.snap.state).toBe('playing');
    expect(rig.snap.stepIndex).toBe(2);
    rig.tap('E4');
    expect(rig.snap.stepIndex).toBe(3);
  });

  it('[AC14] loop mode repeats the selected measures and never runs past the loop end', () => {
    const rig = new Rig(new PracticeEngine(melody(), { hands: 'R' }));
    rig.engine.setLoop({ start: 1, end: 1 });
    expect(rig.snap.currentStep?.measure).toBe(1);
    for (let round = 0; round < 3; round++) for (const n of ['G4', 'A4', 'B4', 'C5']) rig.tap(n);
    expect(rig.snap.loopCount).toBe(3);
    expect(rig.snap.state).toBe('playing');
    expect(rig.snap.currentStep?.notes[0].midi).toBe(N('G4'));
    rig.engine.setLoop(null);
    for (const n of ['G4', 'A4', 'B4', 'C5']) rig.tap(n);
    expect(rig.snap.state).toBe('completed');
  });

  it('previous and next measure navigation', () => {
    const rig = new Rig(new PracticeEngine(melody(), { hands: 'R' }));
    rig.engine.nextMeasure();
    expect(rig.snap.currentStep?.measure).toBe(1);
    rig.engine.prevMeasure();
    expect(rig.snap.stepIndex).toBe(0);
  });

  it('restart resets the position and statistics', () => {
    const rig = new Rig(new PracticeEngine(melody(), { hands: 'R' }));
    rig.tap('C4');
    rig.tap('E4');
    rig.engine.restart();
    expect(rig.snap.stepIndex).toBe(0);
    expect(rig.snap.state).toBe('idle');
    expect(rig.snap.stats.notesPlayed).toBe(0);
  });

  it('[AC16] a MIDI disconnect pauses the exercise and is not counted as a playing mistake', () => {
    const rig = new Rig(new PracticeEngine(melody(), { hands: 'R' }));
    rig.tap('C4');
    rig.down('D4'); // completes step 1. D4 is still held when the cable is pulled
    expect(rig.snap.stepIndex).toBe(2);
    rig.engine.inputLost(rig.t);
    expect(rig.snap.state).toBe('paused');
    expect(rig.snap.pauseReason).toBe('midi-disconnected');
    expect(rig.snap.heldKeys).toEqual([]);
    expect(rig.snap.mistakes).toHaveLength(0);
    rig.engine.inputRestored();
    rig.engine.resume(rig.t);
    expect(rig.snap.stepIndex).toBe(2);
    rig.tap('E4');
    expect(rig.snap.stepIndex).toBe(3);
  });
});

describe('Rhythm mode', () => {
  // 60 BPM in 4/4: one quarter = 1000 ms = 4 ticks
  const ex = () => buildExercise({ id: 'rh', title: 'rh', right: 'C4 D4 E4 F4' });

  it('counts in, then measures timing deviation for each note', () => {
    const rig = new Rig(new PracticeEngine(ex(), { hands: 'R', mode: 'rhythm', bpm: 60, timingToleranceMs: 100 }));
    rig.engine.start(rig.t);
    expect(rig.snap.state).toBe('countIn');
    rig.advance(4000); // the count-in measure
    expect(rig.snap.state).toBe('playing');
    rig.down('C4', 20); // 20 ms late
    rig.up('C4', 700);
    rig.down('D4', 250); // t = 5970, D4 is due at 6000, so 30 ms early
    const devs = rig.snap.stats.deviations;
    expect(devs[0]).toBeCloseTo(20, 0);
    expect(devs[1]).toBeCloseTo(-30, 0);
    expect(devs).toHaveLength(2);
    expect(rig.snap.mistakes).toHaveLength(0);
  });

  it('stop on miss: the transport freezes at a missed note and waits for it', () => {
    const rig = new Rig(new PracticeEngine(ex(), { hands: 'R', mode: 'rhythm', bpm: 60, timingToleranceMs: 100, countInMeasures: 0 }));
    rig.engine.start(rig.t);
    rig.advance(150); // past C4 + tolerance with nothing played
    expect(rig.snap.mistakes.map((m) => m.kind)).toEqual(['missed']);
    expect(rig.snap.transport.frozen).toBe(true);
    expect(rig.snap.stepIndex).toBe(0);
    rig.tap('C4', 3000);
    expect(rig.snap.stepIndex).toBe(1);
    expect(rig.snap.transport.frozen).toBe(false);
  });

  it('continuous mode: a missed note is skipped and marked', () => {
    const rig = new Rig(new PracticeEngine(ex(), { hands: 'R', mode: 'rhythm', bpm: 60, timingToleranceMs: 100, countInMeasures: 0, rhythmStopOnMiss: false }));
    rig.engine.start(rig.t);
    rig.advance(150);
    expect(rig.snap.stepIndex).toBe(1);
    expect(rig.snap.stepResults[0]).toBe('missed');
  });

  it('early notes are flagged as timing mistakes', () => {
    const rig = new Rig(new PracticeEngine(ex(), { hands: 'R', mode: 'rhythm', bpm: 60, timingToleranceMs: 100, countInMeasures: 0 }));
    rig.engine.start(rig.t);
    rig.tap('C4', 0);
    rig.down('D4', 400); // ~500 ms early
    expect(rig.snap.mistakes.find((m) => m.kind === 'early')).toBeTruthy();
  });

  it('detects a note released too early', () => {
    const ex2 = buildExercise({ id: 'w', title: 'w', right: 'C4/w | D4/w' });
    const rig = new Rig(new PracticeEngine(ex2, { hands: 'R', mode: 'rhythm', bpm: 60, timingToleranceMs: 100, countInMeasures: 0 }));
    rig.engine.start(rig.t);
    rig.down('C4');
    rig.up('C4', 500); // a whole note is 4000 ms long
    expect(rig.snap.stats.releasedEarly).toBe(1);
  });
});

describe('[AC17] progress report reflects actual results', () => {
  it('counts correct notes, wrong notes, accuracy, hands and most-missed notes', () => {
    const exr = melody();
    const rig = new Rig(new PracticeEngine(exr, { hands: 'R' }));
    rig.tap('C4');
    rig.tap('E4'); // wrong (expected D4)
    rig.tap('E4'); // wrong again
    rig.tap('D4');
    for (const n of ['E4', 'F4', 'G4', 'A4', 'B4', 'C5']) rig.tap(n);
    const s = rig.snap;
    expect(s.state).toBe('completed');
    const r = buildReport(exr, s.steps, s.stats, s.mistakes, s.settings, 0);
    expect(r.notesPlayed).toBe(10);
    expect(r.correct).toBe(8);
    expect(r.incorrect).toBe(2);
    expect(r.accuracy).toBeCloseTo(0.8);
    expect(r.firstTryAccuracy).toBeCloseTo(7 / 8);
    expect(r.mostMissed[0]).toMatchObject({ name: 'D4', count: 2 });
    expect(r.hardestSteps[0]).toMatchObject({ stepIndex: 1, attempts: 3, notes: 'D4' });
    expect(r.measuresWithMistakes).toEqual([0]);
    expect(r.byHand).toEqual([{ hand: 'R', steps: 8, cleanSteps: 7, firstTryAccuracy: 7 / 8, wrongNotes: 2 }]);
    expect(r.suggestions.find((x) => x.id === 'drill')?.drillMeasures).toEqual([0]);
  });
});
