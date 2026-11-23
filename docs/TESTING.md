# Testing

## 1. Automated tests (simulated MIDI)

```powershell
npm test
```

The 64 tests in `tests/` drive the **real** `MidiInputProcessor` → `PracticeEngine` pipeline with raw MIDI bytes from a test-only simulated keyboard (`tests/helpers.ts`). The simulated keyboard is never imported by application code.

| Acceptance criterion | Test(s) |
|---|---|
| 1. Keyboard detected | `midi.test.ts`: "[AC1] detects a connected keyboard…" |
| 2. Every note identified with its octave | "[AC2] identifies every MIDI note… (A0..C8)" |
| 3. Note On / Note Off | "[AC3] handles Note On, Note Off, and Note On velocity 0…" |
| 4. Wrong notes identified immediately | `practice.test.ts`: "[AC4][AC6]…" and "detects a wrong octave" |
| 5. Correct notes advance | "[AC5]…" |
| 6. Wrong notes don't advance | "[AC4][AC6]…" and "completes the exercise only after the last correct note" |
| 7. Chords need every note | "[AC7]…", plus the chord tolerance and Chord mode tests |
| 8. Extra notes detected | "[AC8]…" |
| 9–11. Left / right / both hands | "[AC9]", "[AC10]", "[AC11]" |
| 12. Overlapping hand ranges | "[AC12]…" (2 tests) |
| 13. Pause and resume keep the position | "[AC13]…" |
| 14. Loop mode | "[AC14]…" |
| 15. Repeated notes are separate events | "[AC15]…" (processor and engine) |
| 16. MIDI disconnection | "[AC16]…" (connection manager reconnect, engine pause) |
| 17. Reports reflect real results | "[AC17]…" |

## 2. Hardware testing (required before calling MIDI "done")

**Status: NOT YET DONE.** I could not test with a physical keyboard. Everything below must be run with a real keyboard connected through a MIDI-to-USB cable.

1. Run `npm run dev` and open `http://localhost:5173` in **desktop Chrome or Edge**. Don't add `?sim`.
2. Click **Enable MIDI** and allow access. The top bar should show your device name with a green dot.
3. Open **MIDI → Hardware self-test** and complete every check. They pass only on events from a physical device:
   - Note On received; Note Off received
   - Middle C identified as C4 (MIDI 60)
   - A three-note chord, with all three keys detected
   - The same key three times, giving three separate events
   - 12 different keys
4. Also on the MIDI screen:
   - Play the lowest and highest keys. "Keys seen" should match your keyboard (for example A0–C8 on 88 keys, or C2–C7 on 61 keys).
   - Watch the counters while playing normally. **Duplicates removed**, **Orphan Note Offs** and **Missed Note Offs** should stay at or near 0. If duplicates climb, your cable or driver is sending doubled events; the processor removes them.
   - Press the sustain pedal. The log should show `Sustain pedal down/up`.
5. On the **Practice** screen, check each behavior:
   - A correct note → green, and the score advances.
   - A wrong note → red ghost note on the staff, a red key, "Expected X, you played Y", and **no** advance.
   - Hold a wrong key, then play the right one → no advance until the wrong key is released (standard sensitivity).
   - Chord exercise (Library → I–IV–V–I) → no advance until every chord note is down. An extra key is flagged.
   - Left hand only, right hand only, both hands → only the practiced hand's notes are required.
   - Pause, play some keys, then resume → the position is unchanged.
   - Loop a measure → it repeats, and the loop counter increases.
   - Repeated notes (Library → Repeated notes) → each note needs its own press.
   - **Unplug the USB cable mid-exercise** → the status shows "MIDI disconnected", the exercise pauses, no key stays lit, and no mistake is recorded. Plug it back in → the device is restored, and Resume continues from the same position.
6. **Latency**: after a minute of playing, read **MIDI → MIDI-to-feedback latency**. Note the medians and p95 values for *Delivery*, *Rendered* and *On screen*. The browser can't see the USB and driver delay before the browser timestamps a message.

Record the results (device model, OS, browser version, latency numbers, any failing step) before declaring MIDI support verified.

## 3. Dev-only simulated input

`http://localhost:5173/?sim` (in `npm run dev` only) maps the computer keyboard to MIDI notes (A W S E D F T G Y H U J K = C4…C5; Z/X change the octave). It feeds the same pipeline with the device id `dev-sim`. A purple "DEV ONLY" banner shows while it's active. Production builds remove it (`import.meta.env.DEV`), and the hardware self-test ignores it.
