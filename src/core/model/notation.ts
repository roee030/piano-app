import type { Exercise, NoteGroup, Hand } from './types';
import { keyAlterFor } from '../music/keys';

/**
 * The accidental to print for each pitch, following standard engraving rules.
 * Accidentals are compared against the key signature and against earlier accidentals
 * at the same staff position (step + octave) in the same measure and staff.
 * Returns a map from `${groupId}:${pitchIndex}` to an accidental ('#', 'b', 'n', '##', 'bb').
 */
export function computeDisplayAccidentals(ex: Exercise): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of ex.measures) {
    for (const hand of ['R', 'L'] as Hand[]) {
      const voice = m.voices[hand];
      if (!voice) continue;
      const state = new Map<string, number>();
      for (const g of voice.groups) {
        g.pitches.forEach((p, i) => {
          const pos = `${p.step}${p.octave}`;
          const current = state.has(pos) ? state.get(pos)! : keyAlterFor(p.step, ex.key.fifths);
          if (p.alter !== current) {
            out.set(`${g.id}:${i}`, p.alter === 0 ? 'n' : p.alter === 1 ? '#' : p.alter === -1 ? 'b' : p.alter === 2 ? '##' : 'bb');
            state.set(pos, p.alter);
          }
        });
      }
    }
  }
  return out;
}

export function isRest(g: NoteGroup): boolean {
  return g.pitches.length === 0;
}
