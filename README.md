# Étude: an interactive piano tutor

A web app that listens to a physical MIDI keyboard, shows real sheet music on a grand staff, and coaches you note by note. **It never advances until you have played the right notes.**

**Live demo:** https://roee030.github.io/piano-app/ (open it in desktop Chrome or Edge with a MIDI keyboard connected). The hosted version is a static site with no server, so the AI tutor asks for your own Anthropic API key there. The key stays in your browser (only until you close the tab, unless you choose to remember it) and is sent only to api.anthropic.com.

## Quick start

```powershell
npm install
npm run dev          # http://localhost:5173 (localhost counts as a secure context for Web MIDI)
npm test             # 61 automated tests with simulated MIDI
npm run build        # type-check and production build
```

- Use **desktop Chrome or Edge**. Web MIDI is not available in Safari.
- To use the app from another device on the LAN: `npm run dev:https` (self-signed certificate).
- **AI tutor (optional):** set `ANTHROPIC_API_KEY` before `npm run dev`, or enter your own key on the AI tutor screen. Without it, the tutor shows built-in offline lessons, and each performance report still gives recommendations, which are deterministic.

## What's inside

- **MIDI**:
  - Web MIDI connection manager: permission, device picker, hot-plug, and auto-reconnect matched by device name.
  - Input processor: Note On/Off, velocity-0 Note Offs, de-duplication, missing Note Off repair, ghost-touch filter, stuck-key and malformed-message warnings.
  - Diagnostics screen: live event log, counters, hardware self-test, and MIDI-to-feedback latency.
- **Exercise generator**:
  - Settings: per-hand note ranges (which you can set by pressing keys), hands, measures, notes per measure, key signature, scale, time signature, durations, single notes/mixed/chords, difficulty 1–5, and a seed. The library has 10 predefined exercises.
  - The structured score model is the single source of truth for notation, evaluation and MusicXML export.
- **Notation**: VexFlow engraving on a grand staff, with an overlay positioned from the engraved notehead coordinates (cursor, green/amber/red noteheads, red ghost notes for wrong keys, loop band).
- **Practice engine** (a deterministic state machine):
  - **Wait mode**: the score waits for the right notes.
  - **Chord mode**: every chord note must be struck within the chord tolerance.
  - **Rhythm mode**: BPM, count-in, metronome, timing deviation, and an optional stop on a missed note.
  - Mistake types: wrong note, wrong octave, played ahead, extra note, incomplete chord, missed, early, late, released early, held too long.
  - Three feedback sensitivity levels.
  - Hand assignment comes from the score. A shared unison needs only one key press.
- **Controls**: start/pause/resume, restart, previous/next measure, loop measures, repeat mistakes (a drill exercise of only the measures with mistakes), reset progress, BPM, and hand selection.
- **Progress**: an end-of-exercise report (accuracy, first-try accuracy, by hand, most-missed notes, hardest spots, timing) with practice suggestions you can apply in one click. Local history, a trend chart, and a heat-map keyboard of mistakes.
- **AI tutor**: Claude (`claude-opus-5-5`), streamed through a server-side endpoint (`server/tutor.ts`) so the API key never reaches the browser. If you agree, it gets your practice summary as context. It is never involved in note recognition.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the research, architecture, data model, roadmap and risks, and [docs/TESTING.md](docs/TESTING.md) for the test matrix and the **hardware test protocol**.

## Deployment

Every push to `main` runs the tests, builds the app and publishes it to GitHub Pages (`.github/workflows/pages.yml`). The Pages build sets `VITE_STATIC_SITE=1`, which switches the tutor to bring-your-own-key mode: the browser calls the Anthropic API directly (`src/tutor/claude.ts` holds the request shared with the local server endpoint).

## Status

All automated tests pass using simulated MIDI. **I have not tested it with a physical keyboard yet.** Follow the hardware protocol in `docs/TESTING.md` before relying on the MIDI functionality.
