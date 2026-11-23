import type { Exercise, Hand, HandSelection } from '../model/types';
import { DURATION_TICKS, measureTicks } from '../model/types';
import { midiToName, Pitch, pitchName, pitchToMidi } from '../music/pitch';

/** A reference from an expected note back to the score (for highlighting). */
export interface NoteRef {
  groupId: string;
  pitchIndex: number;
  hand: Hand;
}

/** One physical key that must be pressed at a step. */
export interface ExpectedNote {
  midi: number;
  /** As spelled in the score (Bb or A#) */
  pitch: Pitch;
  /** Hands that need this key here. Both hands appear on a shared unison. */
  hands: Hand[];
  refs: NoteRef[];
  /** Written length in ticks (the longest when hands share the key) */
  durationTicks: number;
}

/** One position in the score: all notes of the practiced hands that start at the same tick. */
export interface Step {
  index: number;
  /** Absolute tick from the start of the exercise */
  tick: number;
  measure: number;
  notes: ExpectedNote[];
}

export function handsIn(sel: HandSelection): Hand[] {
  return sel === 'both' ? ['R', 'L'] : [sel];
}

/**
 * Build the ordered evaluation timeline from the score. The score is the only
 * source of truth. Hand assignment comes from the voice a note belongs to,
 * never from a MIDI channel. Rests produce no step.
 */
export function buildSteps(ex: Exercise, practice: HandSelection): Step[] {
  const mTicks = measureTicks(ex.time);
  const hands = handsIn(practice);
  const byTick = new Map<number, { measure: number; notes: Map<number, ExpectedNote> }>();
  for (const m of ex.measures) {
    for (const hand of hands) {
      const voice = m.voices[hand];
      if (!voice) continue;
      for (const g of voice.groups) {
        if (g.pitches.length === 0) continue;
        const tick = m.index * mTicks + g.startTick;
        let slot = byTick.get(tick);
        if (!slot) {
          slot = { measure: m.index, notes: new Map() };
          byTick.set(tick, slot);
        }
        g.pitches.forEach((p, pitchIndex) => {
          const midi = pitchToMidi(p);
          const dur = DURATION_TICKS[g.duration];
          const existing = slot!.notes.get(midi);
          if (existing) {
            if (!existing.hands.includes(hand)) existing.hands.push(hand);
            existing.refs.push({ groupId: g.id, pitchIndex, hand });
            existing.durationTicks = Math.max(existing.durationTicks, dur);
          } else {
            slot!.notes.set(midi, { midi, pitch: p, hands: [hand], refs: [{ groupId: g.id, pitchIndex, hand }], durationTicks: dur });
          }
        });
      }
    }
  }
  return [...byTick.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tick, slot], index) => ({
      index,
      tick,
      measure: slot.measure,
      notes: [...slot.notes.values()].sort((a, b) => a.midi - b.midi),
    }));
}

/** Name a key as the score spells it in the first of `steps` that contains it. */
export function scoreNoteName(midi: number, steps: (Step | undefined | null)[], preferFlats = false): string {
  for (const s of steps) {
    const n = s?.notes.find((x) => x.midi === midi);
    if (n) return pitchName(n.pitch);
  }
  return midiToName(midi, preferFlats);
}

export function firstStepOfMeasure(steps: Step[], measure: number): number {
  const i = steps.findIndex((s) => s.measure >= measure);
  return i < 0 ? steps.length : i;
}

export function lastStepOfMeasure(steps: Step[], measure: number): number {
  let last = -1;
  steps.forEach((s, i) => {
    if (s.measure <= measure) last = i;
  });
  return last;
}
