/**
 * DEVELOPMENT-ONLY simulated MIDI input. It is enabled only in `vite dev` and only
 * with ?sim in the URL. Production builds remove it (import.meta.env.DEV is false there).
 * It sends raw MIDI bytes through the same processor and engine as a real
 * keyboard, with device id "dev-sim". The hardware self-test ignores that device.
 */
import { useEffect, useState } from 'react';
import { app } from '../app/controller';

const MAP = 'awsedftgyhujkolp;'; // C D♭ D E♭ E F G♭ G A♭ A B♭ B C ...

export function DevSimulator() {
  const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).has('sim');
  const [octave, setOctave] = useState(4);
  useEffect(() => {
    if (!enabled) return;
    const down = new Set<string>();
    const noteFor = (k: string) => {
      const i = MAP.indexOf(k);
      return i < 0 ? null : (octave + 1) * 12 + i;
    };
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === 'z') return setOctave((o) => Math.max(0, o - 1));
      if (e.key === 'x') return setOctave((o) => Math.min(7, o + 1));
      const n = noteFor(e.key);
      if (n === null || down.has(e.key)) return;
      down.add(e.key);
      app.handleMidi([0x90, n, 80], performance.now(), 'dev-sim');
    };
    const ku = (e: KeyboardEvent) => {
      const n = noteFor(e.key);
      if (n === null || !down.has(e.key)) return;
      down.delete(e.key);
      app.handleMidi([0x80, n, 0], performance.now(), 'dev-sim');
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, [enabled, octave]);
  if (!enabled) return null;
  return <div className="dev-banner">DEV ONLY · simulated MIDI from the computer keyboard (A–; = C{octave}…, Z/X = octave)</div>;
}
