import type { GeneratorConfig } from '../core/model/types';

export interface Lesson {
  id: string;
  title: string;
  level: 'Beginner' | 'Intermediate';
  summary: string;
  body: string;
  /** A matching exercise to generate */
  exercise?: Partial<GeneratorConfig>;
}

/** Offline theory lessons. The content is static and deterministic. */
export const LESSONS: Lesson[] = [
  {
    id: 'grand-staff',
    title: 'The grand staff and landmark notes',
    level: 'Beginner',
    summary: 'Treble and bass clefs, middle C, and anchor notes for fast reading.',
    body: `The grand staff joins a **treble clef** staff (usually the right hand) and a **bass clef** staff (usually the left hand) with a brace.

**Middle C (C4)** sits on one ledger line between the two staves. It is the same key whether written below the treble staff or above the bass staff.

Learn a few **landmarks** and read the other notes by step from them:
- Treble G (G4): the treble clef curls around this line.
- Bass F (F3): the two dots of the bass clef surround this line.
- Treble C (C5), the third space, and bass C (C3), the second space.

Reading tip: a note one step away moves from a line to a space. A third skips one line or one space.`,
    exercise: { hands: 'both', leftRange: { low: 48, high: 57 }, rightRange: { low: 60, high: 69 }, difficulty: 1, texture: 'single', scale: 'diatonic', key: { fifths: 0, mode: 'major' } },
  },
  {
    id: 'ledger',
    title: 'Reading ledger lines',
    level: 'Intermediate',
    summary: 'Count from the staff by lines, not by individual notes.',
    body: `Ledger lines extend the staff. To read one quickly:
1. Count the **lines**, not the notes. Above the treble staff the first ledger line is A5, the second C6 and the third E6 (one third apart).
2. Below the bass staff the ledger lines are E2, C2 and A1.
3. Notes close to middle C are easier: C4 is one ledger line below the treble staff and one above the bass staff.

Practice by playing exercises in a high range (C5–C6) or a low range (C2–C3).`,
    exercise: { hands: 'R', rightRange: { low: 72, high: 84 }, difficulty: 2, texture: 'single', scale: 'diatonic' },
  },
  {
    id: 'keysig',
    title: 'Key signatures and accidentals',
    level: 'Beginner',
    summary: 'Why F♯ in G major is never written as a sharp sign on each note.',
    body: `A **key signature** at the start of each line says which notes are always sharp or flat. In G major (one sharp), every F is F♯ unless an accidental says otherwise.

**Accidentals** (♯, ♭, ♮) change a note only until the end of the measure, and only at that staff position.

Sharps always appear in the order F C G D A E B. Flats appear in the reverse order: B E A D G C F.

When you practice in a new key, find the black keys first. Your hand shape changes, and so does the pattern of the scale.`,
    exercise: { key: { fifths: 1, mode: 'major' }, hands: 'R', rightRange: { low: 62, high: 74 }, difficulty: 2 },
  },
  {
    id: 'intervals',
    title: 'Reading by intervals',
    level: 'Beginner',
    summary: 'Read the distance between notes instead of naming every note.',
    body: `Fluent readers seldom name every note. They read **intervals**:
- **Step** (2nd): line to the next space, or space to the next line.
- **Skip** (3rd): line to the next line, or space to the next space.
- **5th**: three lines apart, or three spaces apart. This is the five-finger stretch.

On the keyboard, a step is the next finger. A third skips a finger.`,
    exercise: { difficulty: 3, texture: 'single' },
  },
  {
    id: 'chords',
    title: 'Triads and inversions',
    level: 'Intermediate',
    summary: 'Recognize chord shapes on the staff at a glance.',
    body: `A **triad** stacks two thirds. In **root position** the three notes sit all on lines or all on spaces, like a snowman.

**Inversions** move the bottom note up an octave:
- First inversion (C–E–G becomes E–G–C) has a fourth on top.
- Second inversion (G–C–E) has a fourth on the bottom.

In Chord mode the app makes you strike all the notes together. Shape the hand before you press.`,
    exercise: { texture: 'chords', difficulty: 3, hands: 'R', rightRange: { low: 60, high: 76 } },
  },
  {
    id: 'rhythm',
    title: 'Counting rhythm',
    level: 'Beginner',
    summary: 'Count out loud, subdivide, and use the metronome.',
    body: `Count the beats out loud: "1 2 3 4" in 4/4. A **half note** lasts 2 beats, a **whole note** 4 beats, and a **dotted half** 3 beats. **Eighth notes** split a beat: "1 & 2 &".

In Rhythm mode:
1. Start slowly (60 BPM or less) and let the count-in set the pulse.
2. Aim to be on the beat rather than just "near" it. The report shows whether you rush or drag.
3. Raise the BPM by about 5% only when your average timing offset is small.`,
    exercise: { durations: ['h', 'q', '8'], difficulty: 2 },
  },
  {
    id: 'hands-together',
    title: 'Hands together',
    level: 'Intermediate',
    summary: 'A step-by-step method for coordinating both hands.',
    body: `1. Play each hand alone until it is clean in Wait mode.
2. Combine the hands in Wait mode. The app waits until both parts of each beat are pressed.
3. Loop the hardest measure.
4. Change to Rhythm mode at a slow BPM.

Watch for notes that start together in both hands. Those are your anchors. Notes where only one hand moves are where the hands most often drift apart.`,
    exercise: { hands: 'both', difficulty: 2 },
  },
];
