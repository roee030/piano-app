/**
 * TEST-ONLY simulated MIDI hardware. It is never imported by application code.
 * The simulated keyboard sends raw MIDI bytes through the real MidiInputProcessor
 * into the real PracticeEngine, the same path a physical keyboard uses.
 */
import { MidiInputProcessor } from '../src/core/midi/MidiInputProcessor';
import type { MidiAccessLike, MidiPortLike } from '../src/core/midi/MidiConnectionManager';
import { PracticeEngine } from '../src/core/practice/PracticeEngine';
import { nameToMidi } from '../src/core/music/pitch';

export class FakePort implements MidiPortLike {
  type = 'input' as const;
  state: 'connected' | 'disconnected' = 'connected';
  connection: 'open' | 'closed' | 'pending' = 'closed';
  onmidimessage: MidiPortLike['onmidimessage'] = null;
  manufacturer = 'TestCo';
  constructor(public id: string, public name: string) {}
  async open() {
    this.connection = 'open';
  }
  send(bytes: number[], timeStamp: number) {
    this.onmidimessage?.({ data: new Uint8Array(bytes), timeStamp });
  }
}

export class FakeAccess implements MidiAccessLike {
  ports = new Map<string, FakePort>();
  onstatechange: MidiAccessLike['onstatechange'] = null;
  inputs = {
    forEach: (cb: (p: MidiPortLike, k: string) => void) => this.ports.forEach((p, k) => cb(p, k)),
  };
  plug(port: FakePort) {
    port.state = 'connected';
    this.ports.set(port.id, port);
    this.onstatechange?.({ port });
  }
  unplug(id: string) {
    const p = this.ports.get(id);
    if (!p) return;
    p.state = 'disconnected';
    p.connection = 'closed';
    this.onstatechange?.({ port: p });
  }
}

export function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

/** Wires a simulated keyboard to the processor and engine. */
export class Rig {
  processor = new MidiInputProcessor();
  t = 1000;
  constructor(public engine: PracticeEngine) {}

  raw(bytes: number[], dt = 0) {
    this.t += dt;
    for (const ev of this.processor.handleMessage(bytes, this.t, 'test-device')) {
      if (ev.type === 'noteOn') this.engine.noteOn(ev.midi, ev.velocity, ev.timestamp);
      else if (ev.type === 'noteOff') this.engine.noteOff(ev.midi, ev.timestamp);
      else if (ev.type === 'sustain') this.engine.sustainChange(ev.down);
    }
  }
  down(note: string | number, dt = 0, vel = 80) {
    const m = typeof note === 'number' ? note : nameToMidi(note);
    this.raw([0x90, m, vel], dt);
  }
  up(note: string | number, dt = 0) {
    const m = typeof note === 'number' ? note : nameToMidi(note);
    this.raw([0x80, m, 0], dt);
  }
  /** Press and release a key */
  tap(note: string | number, gap = 120) {
    this.down(note, gap);
    this.up(note, 80);
  }
  /** Press several keys together, then release them */
  chord(notes: string[], spread = 10, hold = 200) {
    notes.forEach((n, i) => this.down(n, i === 0 ? 100 : spread));
    this.t += hold;
    notes.forEach((n) => this.up(n));
  }
  advance(ms: number) {
    this.t += ms;
    this.engine.tick(this.t);
  }
  get snap() {
    return this.engine.getSnapshot();
  }
}
