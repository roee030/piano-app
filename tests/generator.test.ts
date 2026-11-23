import { describe, expect, it } from 'vitest';
import { composeRhythm, DEFAULT_CONFIG, generateExercise, extractMeasures } from '../src/core/generator/generator';
import { PREDEFINED } from '../src/core/generator/predefined';
import { Rng } from '../src/core/generator/random';
import { DURATION_TICKS, GeneratorConfig, measureTicks } from '../src/core/model/types';
import { pitchToMidi, nameToMidi } from '../src/core/music/pitch';
import { scalePitches, keyAlterFor, spellChromatic } from '../src/core/music/keys';
import { computeDisplayAccidentals } from '../src/core/model/notation';
import { toMusicXML } from '../src/core/model/musicxml';
import { buildSteps } from '../src/core/practice/timeline';

const cfg = (p: Partial<GeneratorConfig>): GeneratorConfig => ({ ...DEFAULT_CONFIG, ...p });

describe('Music theory', () => {
  it('spells scales correctly for the key', () => {
    const g = scalePitches({ fifths: 1, mode: 'major' }, 'diatonic', nameToMidi('G4'), nameToMidi('G5'));
    expect(g.map((p) => p.step + (p.alter === 1 ? '#' : ''))).toEqual(['G', 'A', 'B', 'C', 'D', 'E', 'F#', 'G']);
    const f = scalePitches({ fifths: -1, mode: 'major' }, 'diatonic', nameToMidi('F4'), nameToMidi('F5'));
    expect(f.find((p) => p.step === 'B')!.alter).toBe(-1);
    const a = scalePitches({ fifths: 0, mode: 'minor' }, 'harmonicMinor', nameToMidi('A3'), nameToMidi('A4'));
    expect(a.find((p) => p.step === 'G')!.alter).toBe(1);
  });

  it('key signature alterations', () => {
    expect(keyAlterFor('F', 2)).toBe(1);
    expect(keyAlterFor('C', 2)).toBe(1);
    expect(keyAlterFor('G', 2)).toBe(0);
    expect(keyAlterFor('B', -1)).toBe(-1);
  });

  it('chromatic spelling prefers notes in the key', () => {
    expect(spellChromatic(nameToMidi('F#4'), { fifths: 1, mode: 'major' }, false)).toMatchObject({ step: 'F', alter: 1 });
    expect(spellChromatic(nameToMidi('Bb3'), { fifths: -1, mode: 'major' }, true)).toMatchObject({ step: 'B', alter: -1 });
  });

  it('prints accidentals only when they differ from the key signature or an earlier accidental', () => {
    const ex = PREDEFINED.find((e) => e.id === 'g-major-scale')!;
    expect(computeDisplayAccidentals(ex).size).toBe(0); // F# is in the key signature
  });
});

describe('Rhythm composition', () => {
  it('always fills the measure exactly', () => {
    const rng = new Rng(7);
    for (const time of [{ beats: 4, beatType: 4 }, { beats: 3, beatType: 4 }, { beats: 2, beatType: 4 }, { beats: 6, beatType: 8 }]) {
      for (let n = 1; n <= 8; n++) {
        const r = composeRhythm(rng, time, ['h', 'q', '8'], n);
        expect(r.reduce((a, d) => a + DURATION_TICKS[d], 0)).toBe(measureTicks(time));
      }
    }
  });

  it('meets the requested note count when it is possible', () => {
    const r = composeRhythm(new Rng(1), { beats: 4, beatType: 4 }, ['q'], 4);
    expect(r).toEqual(['q', 'q', 'q', 'q']);
    expect(composeRhythm(new Rng(1), { beats: 4, beatType: 4 }, ['w'], 4)).toEqual(['w']);
  });
});

describe('Exercise generator', () => {
  it('is deterministic for a given seed', () => {
    expect(generateExercise(cfg({ seed: 42 }))).toEqual(generateExercise(cfg({ seed: 42 })));
    expect(generateExercise(cfg({ seed: 42 }))).not.toEqual(generateExercise(cfg({ seed: 43 })));
  });

  it('keeps every note inside its hand range, across many seeds and settings', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const c = cfg({
        seed,
        hands: 'both',
        leftRange: { low: nameToMidi('C2'), high: nameToMidi('E4') },
        rightRange: { low: nameToMidi('A3'), high: nameToMidi('C6') },
        texture: (['single', 'mixed', 'chords'] as const)[seed % 3],
        difficulty: ((seed % 5) + 1) as GeneratorConfig['difficulty'],
        scale: (['diatonic', 'pentatonic', 'chromatic', 'triad'] as const)[seed % 4],
        key: { fifths: (seed % 7) - 3, mode: seed % 2 ? 'major' : 'minor' },
        durations: ['h', 'q', '8'],
        notesPerMeasure: (seed % 6) + 1,
        measures: 4,
      });
      const ex = generateExercise(c);
      expect(ex.measures).toHaveLength(4);
      for (const m of ex.measures) {
        for (const [hand, range] of [['L', c.leftRange], ['R', c.rightRange]] as const) {
          const v = m.voices[hand]!;
          expect(v.groups.reduce((a, g) => a + DURATION_TICKS[g.duration], 0)).toBe(measureTicks(c.time));
          for (const g of v.groups) for (const p of g.pitches) {
            const midi = pitchToMidi(p);
            expect(midi).toBeGreaterThanOrEqual(range.low);
            expect(midi).toBeLessThanOrEqual(range.high);
          }
        }
      }
    }
  });

  it('single-hand exercises contain only that hand', () => {
    const ex = generateExercise(cfg({ hands: 'L', seed: 5 }));
    expect(ex.measures.every((m) => m.voices.L && !m.voices.R)).toBe(true);
  });

  it('chord texture produces chords that a hand can span', () => {
    const ex = generateExercise(cfg({ texture: 'chords', difficulty: 4, rightRange: { low: 60, high: 79 }, seed: 9 }));
    const groups = ex.measures.flatMap((m) => m.voices.R!.groups).filter((g) => g.pitches.length);
    expect(groups.every((g) => g.pitches.length >= 2)).toBe(true);
    for (const g of groups) {
      const ms = g.pitches.map(pitchToMidi);
      expect(Math.max(...ms) - Math.min(...ms)).toBeLessThanOrEqual(12);
    }
  });

  it('evaluation steps match the score exactly, so the notation and the evaluation share one source', () => {
    const ex = generateExercise(cfg({ hands: 'both', seed: 11, texture: 'mixed', difficulty: 3 }));
    const steps = buildSteps(ex, 'both');
    const scoreNotes = ex.measures.flatMap((m) => (['L', 'R'] as const).flatMap((h) => m.voices[h]!.groups.flatMap((g) => g.pitches.map(pitchToMidi))));
    const stepNoteRefs = steps.flatMap((s) => s.notes.flatMap((n) => n.refs.map(() => n.midi)));
    expect(stepNoteRefs.sort()).toEqual(scoreNotes.sort());
  });

  it('extracts measures into a drill exercise', () => {
    const ex = generateExercise(cfg({ seed: 3, measures: 6 }));
    const d = extractMeasures(ex, [4, 1, 4]);
    expect(d.measures).toHaveLength(2);
    expect(d.measures[0].voices.R!.groups.map((g) => g.pitches)).toEqual(ex.measures[1].voices.R!.groups.map((g) => g.pitches));
  });

  it('exports valid-looking MusicXML', () => {
    const xml = toMusicXML(PREDEFINED.find((e) => e.id === 'chords-145')!);
    expect(xml).toContain('<score-partwise version="4.0">');
    expect(xml.match(/<measure /g)).toHaveLength(4);
    expect(xml).toContain('<chord/>');
  });

  it('all predefined exercises parse correctly', () => {
    expect(PREDEFINED.length).toBeGreaterThan(5);
    for (const ex of PREDEFINED) expect(buildSteps(ex, ex.hands).length).toBeGreaterThan(0);
  });
});

describe('Extra accidentals', () => {
  const pitches = (c: GeneratorConfig) => generateExercise(c).measures.flatMap((m) => (['R', 'L'] as const).flatMap((h) => m.voices[h]?.groups.flatMap((g) => g.pitches) ?? []));

  it('adds only the requested type, in range, on black keys, and more for "many"', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const texture of ['single', 'chords'] as const) {
        const base = cfg({ seed, hands: 'both', texture, difficulty: 3 });
        expect(pitches(base).every((p) => p.alter === 0)).toBe(true);
        for (const type of ['sharps', 'flats', 'both'] as const) {
          const few = pitches({ ...base, accidentals: 'few', accidentalType: type }).filter((p) => p.alter !== 0);
          const many = pitches({ ...base, accidentals: 'many', accidentalType: type }).filter((p) => p.alter !== 0);
          expect(few.length).toBeGreaterThan(0);
          expect(many.length).toBeGreaterThan(few.length);
          for (const p of many) {
            if (type !== 'both') expect(p.alter).toBe(type === 'sharps' ? 1 : -1);
            const midi = pitchToMidi(p);
            expect([1, 3, 6, 8, 10]).toContain(midi % 12);
            expect((midi >= 48 && midi <= 55) || (midi >= 60 && midi <= 67)).toBe(true);
          }
        }
      }
    }
  });

  it('is repeatable, keeps the melody, and prints the accidentals', () => {
    const c = cfg({ seed: 9, accidentals: 'many' });
    expect(generateExercise(c)).toEqual(generateExercise(c));
    const strip = (x: GeneratorConfig) => pitches(x).map((p) => `${p.step}${p.octave}`);
    expect(strip(c)).toEqual(strip({ ...c, accidentals: 'none' }));
    const shown = [...computeDisplayAccidentals(generateExercise(c)).values()];
    expect(shown.some((a) => a === '#' || a === 'b')).toBe(true);
    expect(toMusicXML(generateExercise(c))).toMatch(/<alter>-?1<\/alter>/);
  });
});
