# Piano Tutor: Architecture, Research & Roadmap

## 1. Research: what existing products do well

| Product | Pattern worth adopting | Gap we address |
|---|---|---|
| Synthesia | Falling-notes "wait mode": the song pauses until the right key is pressed. | No real sheet music, so it doesn't teach reading. |
| Simply Piano / Flowkey | Real notation plus a cursor, wait-for-note, per-hand practice, and loops. | The exercises are fixed songs and don't drill a chosen note range. |
| Piano Marvel | A "SASR" sight-reading test with random exercises, and scoring by accuracy and timing. | A dated UI with a busy practice screen. |
| Musition / Tenuto | Theory drills, note-reading by range, and progress statistics. | No MIDI-based playing. |

Best practices we take from these:

- Show one clear cursor.
- Color every note's state (pending, correct, wrong).
- Show the expected note and the played note side by side.
- Practice each hand separately before both hands.
- Loop and slow down the hard passages.
- Count in before rhythm play.
- Give a short report after each run, with a concrete next step.

## 2. Architecture

```
src/
  core/                      (pure TypeScript, no DOM or React; fully unit-tested)
    music/                   pitch math, spelling, keys/scales, ranges
    model/                   Exercise data model (the source of truth)
    generator/               Music Exercise Generator, plus predefined exercises
    midi/
      MidiInputProcessor     raw bytes -> NoteOn/NoteOff events, dedupe, retrigger, stuck-note guard
      MidiConnectionManager  Web MIDI access, device list/selection, hot-plug, reconnect
    practice/
      timeline               Exercise -> ordered evaluation Steps (per practiced hand)
      NoteEvaluator          deterministic Wait/Chord matching and mistake classification
      RhythmEvaluator        timed matching against a transport clock
      PracticeEngine         the state machine (idle/countIn/playing/paused/completed), loop, navigation
    progress/                session stats, report, recommendations, local history
  ui/                        React views: Live Practice, Setup, Diagnostics, Progress, Tutor
    notation/                VexFlow renderer plus an SVG overlay for cursor and state highlights
    piano/                   virtual keyboard
  audio/                     metronome (WebAudio)
server/tutor.ts              AI Tutor endpoint (Anthropic SDK, server side only, so the key never reaches the browser)
```

The flow is: MIDI bytes → `MidiInputProcessor` → `PracticeEngine.noteOn/noteOff` (synchronous and deterministic) → an immutable snapshot → React render. The AI is never on this path.

## 3. Libraries

- **Notation: VexFlow 4.2.** VexFlow is the standard engraving library and supports a grand staff, key signatures, chords, and accidentals. We render with VexFlow and draw our own overlay, so feedback updates never re-engrave the score. We use VexFlow's own coordinate functions, so every highlight is positioned from the musical data.
- **MIDI: the native Web MIDI API.** It is small and well defined, and a wrapper (for example WebMidi.js) would hide the timestamp and port-state details we need for diagnostics and latency measurement.
- **UI: React 19 and Vite.**
- **Tests: Vitest.**
- **AI: `@anthropic-ai/sdk`**, called from the dev/preview server middleware.

## 4. Data model (source of truth)

```ts
Pitch       { step: 'C'..'B', alter: -2..2, octave }   // spelled pitch; midi is derived from it
NoteGroup   { id, startTick, durationTicks, duration: 'w'|'h'|'q'|'8'(+dots), pitches: Pitch[], rest? }
Voice       { hand: 'L'|'R', staff: 'bass'|'treble', groups: NoteGroup[] }   // per measure
Measure     { index, voices: { L?: Voice, R?: Voice } }
Exercise    { id, title, key: KeySpec, time: {beats, beatType}, ticksPerQuarter, measures, config }
Step        { index, tick, measure, notes: ExpectedNote[] }  // all onsets at one tick for the practiced hands
ExpectedNote{ midi, hand, groupId, pitchIndex }
```

The hand assignment comes from the score (`Voice.hand`), never from MIDI channels. When both hands expect the same key at the same moment, a single key press satisfies that key for both hands.

The model maps one-to-one onto MusicXML concepts (step/alter/octave, divisions, voice, staff), and a MusicXML exporter is included.

## 5. Evaluation rules (deterministic)

- **Step completion.** Every expected pitch must have a fresh Note On after the step became active. Each one must still be held, or must have been pressed within the chord tolerance (ms) of the completing press. In addition, no wrong key may be held down. A key left held from the previous step does not count, so repeated notes need a new press.
- **Wrong-note classification:**
  - *wrong octave*: the pitch class matches an expected note.
  - *played ahead / wrong sequence*: the note matches the next step.
  - *extra note*: some of the chord is correct and other keys were added.
  - *wrong note*: anything else.

  Every wrong note is recorded and shown. With **strict** sensitivity, a wrong note also clears the progress on a partly played chord.
- **Rhythm mode.** Each onset has an expected time (`start + tick × msPerTick`). A press matches the nearest unmatched expected note of the same pitch within ±tolerance, and its deviation is recorded. If a note passes its window without a match, it is marked missed. With *stop on miss* (the default), the transport freezes until the note is played. Releasing a note before 50% of its written length counts as "released early". Holding it past the next onset of the same hand counts as "held too long".
- **Input problems are separate from wrong notes.** These include a disconnected device, a stuck key (Note On with no Note Off for 20 s or more), duplicate events, and out-of-range note numbers. They appear as input warnings and never count as playing mistakes.

## 6. Roadmap

1. Core model, generator, MIDI processing, evaluator, and state machine, with unit tests on simulated input. (Done.)
2. Live Practice screen with notation, overlay, virtual piano, and controls. (Done.)
3. Setup flow (device and ranges), the Diagnostics screen, and latency measurement. (Done.)
4. Progress tracking, the end-of-exercise report, and history. (Done.)
5. AI Tutor with progress context, plus a deterministic offline fallback. (Done.)
6. **Hardware validation on a real keyboard. (Pending; must be done by the user, see TESTING.md.)**
7. Later: MusicXML import, audio playback of the exercise, and a PWA/offline mode.

## 7. Risks and browser limitations

- **Browser support.** Web MIDI works in Chrome and Edge (desktop) only. Firefox supports it from version 108, after a permission add-on prompt. Safari does not support it at all. The app detects this and explains it.
- **Secure context.** The page must be served from `https://` or `localhost`. Run `npm run dev:https` when testing from another machine on the LAN.
- **Permission state.** A denied MIDI permission persists per origin. The Diagnostics screen explains how to reset it.
- **Windows ports.** On Windows, a MIDI port opened by another app (a DAW) may fail to open. We surface `connection: 'pending'/'closed'` and the error.
- **Duplicate events.** Some USB-MIDI cables send duplicate events or "running status" junk. The processor de-duplicates and filters active sensing and clock.
- **Timestamps.** `MIDIMessageEvent.timeStamp` shares a time base with `performance.now()`, which allows latency measurement. Some drivers stamp messages late; the Diagnostics screen shows the distribution.
- **Background tabs.** A tab in the background throttles timers. Rhythm mode pauses when the tab is hidden.
- **AI Tutor.** It needs `ANTHROPIC_API_KEY` (or an `ant auth login` profile) on the server. Without one, the tutor falls back to built-in, deterministic lessons and recommendations.
