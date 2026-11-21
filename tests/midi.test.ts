import { describe, expect, it } from 'vitest';
import { MidiInputProcessor, NoteEvent } from '../src/core/midi/MidiInputProcessor';
import { MidiConnectionManager, ConnectionEvent, ALL_INPUTS } from '../src/core/midi/MidiConnectionManager';
import { midiToName } from '../src/core/music/pitch';
import { FakeAccess, FakePort, memoryStorage } from './helpers';

const notes = (evs: ReturnType<MidiInputProcessor['handleMessage']>) => evs.filter((e): e is NoteEvent => e.type === 'noteOn' || e.type === 'noteOff');

describe('MidiInputProcessor', () => {
  it('[AC2] identifies every MIDI note with its octave (A0..C8)', () => {
    const p = new MidiInputProcessor();
    expect(midiToName(21)).toBe('A0');
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(61)).toBe('C#4');
    expect(midiToName(108)).toBe('C8');
    for (let m = 21; m <= 108; m++) {
      const on = notes(p.handleMessage([0x90, m, 64], m * 100, 'd'));
      expect(on).toHaveLength(1);
      expect(on[0]).toMatchObject({ type: 'noteOn', midi: m, velocity: 64 });
      const off = notes(p.handleMessage([0x80, m, 0], m * 100 + 50, 'd'));
      expect(off[0]).toMatchObject({ type: 'noteOff', midi: m });
    }
  });

  it('[AC3] handles Note On, Note Off, and a Note On with velocity 0 (as Note Off), on any channel', () => {
    const p = new MidiInputProcessor();
    expect(notes(p.handleMessage([0x93, 60, 100], 10, 'd'))[0]).toMatchObject({ type: 'noteOn', channel: 3 });
    expect(p.isHeld(60)).toBe(true);
    expect(notes(p.handleMessage([0x93, 60, 0], 20, 'd'))[0]).toMatchObject({ type: 'noteOff', midi: 60 });
    expect(p.isHeld(60)).toBe(false);
    p.handleMessage([0x90, 64, 90], 30, 'd');
    expect(notes(p.handleMessage([0x80, 64, 40], 40, 'd'))[0].type).toBe('noteOff');
  });

  it('keeps the timestamp and device id of each message', () => {
    const p = new MidiInputProcessor();
    const [e] = notes(p.handleMessage([0x90, 62, 70], 1234.5, 'dev-A'));
    expect(e).toMatchObject({ timestamp: 1234.5, deviceId: 'dev-A' });
  });

  it('removes duplicate Note On events that arrive within the dedupe window', () => {
    const p = new MidiInputProcessor({ dedupeWindowMs: 8 });
    expect(notes(p.handleMessage([0x90, 60, 80], 100, 'a'))).toHaveLength(1);
    const dup = p.handleMessage([0x90, 60, 80], 103, 'b');
    expect(notes(dup)).toHaveLength(0);
    expect(dup[0]).toMatchObject({ type: 'diagnostic', code: 'duplicate' });
    expect(p.counters.duplicates).toBe(1);
  });

  it('[AC15] treats repeated presses of the same key as separate events', () => {
    const p = new MidiInputProcessor();
    const all: NoteEvent[] = [];
    for (let i = 0; i < 4; i++) {
      all.push(...notes(p.handleMessage([0x90, 60, 80], i * 150, 'd')));
      all.push(...notes(p.handleMessage([0x80, 60, 0], i * 150 + 60, 'd')));
    }
    expect(all.filter((e) => e.type === 'noteOn')).toHaveLength(4);
    expect(all.filter((e) => e.type === 'noteOff')).toHaveLength(4);
  });

  it('closes a missed Note Off with a synthetic Note Off when the key is pressed again', () => {
    const p = new MidiInputProcessor();
    p.handleMessage([0x90, 60, 80], 0, 'd');
    const evs = notes(p.handleMessage([0x90, 60, 80], 500, 'd'));
    expect(evs.map((e) => e.type)).toEqual(['noteOff', 'noteOn']);
    expect(evs[0].synthetic).toBe(true);
  });

  it('drops orphan Note Offs and ignores real-time messages', () => {
    const p = new MidiInputProcessor();
    expect(notes(p.handleMessage([0x80, 60, 0], 0, 'd'))).toHaveLength(0);
    expect(p.counters.orphanNoteOffs).toBe(1);
    expect(p.handleMessage([0xfe], 1, 'd')).toEqual([]);
    expect(p.handleMessage([0xf8], 2, 'd')).toEqual([]);
    expect(p.counters.realtime).toBe(2);
  });

  it('handles simultaneous notes (chords) independently', () => {
    const p = new MidiInputProcessor();
    for (const m of [60, 64, 67]) p.handleMessage([0x90, m, 80], 100, 'd');
    expect(p.heldKeys()).toEqual([60, 64, 67]);
    p.handleMessage([0x80, 64, 0], 200, 'd');
    expect(p.heldKeys()).toEqual([60, 67]);
  });

  it('filters ghost touches below the velocity threshold and reports them', () => {
    const p = new MidiInputProcessor({ minVelocity: 10 });
    const evs = p.handleMessage([0x90, 60, 4], 0, 'd');
    expect(notes(evs)).toHaveLength(0);
    expect(evs[0]).toMatchObject({ code: 'ghostFiltered' });
    expect(notes(p.handleMessage([0x80, 60, 0], 10, 'd'))).toHaveLength(0);
    expect(p.counters.orphanNoteOffs).toBe(0);
  });

  it('reports malformed messages', () => {
    const p = new MidiInputProcessor();
    expect(p.handleMessage([0x90, 60], 0, 'd')[0]).toMatchObject({ code: 'malformed' });
  });

  it('tracks the sustain pedal and All Notes Off', () => {
    const p = new MidiInputProcessor();
    expect(p.handleMessage([0xb0, 64, 127], 0, 'd')[0]).toMatchObject({ type: 'sustain', down: true });
    p.handleMessage([0x90, 60, 80], 1, 'd');
    const offs = notes(p.handleMessage([0xb0, 123, 0], 2, 'd'));
    expect(offs).toHaveLength(1);
    expect(p.heldKeys()).toEqual([]);
  });

  it('releaseAll for one device creates synthetic Note Offs only for that device', () => {
    const p = new MidiInputProcessor();
    p.handleMessage([0x90, 60, 80], 0, 'a');
    p.handleMessage([0x90, 62, 80], 0, 'b');
    const evs = notes(p.releaseAll(10, 'a'));
    expect(evs.map((e) => e.midi)).toEqual([60]);
    expect(p.heldKeys()).toEqual([62]);
  });

  it('reports stuck keys as an input problem', () => {
    const p = new MidiInputProcessor({ stuckKeyMs: 1000 });
    p.handleMessage([0x90, 60, 80], 0, 'd');
    expect(p.checkStuck(500)).toHaveLength(0);
    expect(p.checkStuck(1500)[0]).toMatchObject({ code: 'stuckKey', midi: 60 });
    expect(p.checkStuck(3000)).toHaveLength(0); // reported only once
  });
});

describe('MidiConnectionManager', () => {
  const env = (access: FakeAccess | null, opts: { secure?: boolean; deny?: boolean } = {}) => ({
    isSecureContext: opts.secure ?? true,
    now: () => 42,
    storage: memoryStorage(),
    requestMIDIAccess: access
      ? async () => {
          if (opts.deny) throw Object.assign(new Error('denied'), { name: 'SecurityError' });
          return access;
        }
      : undefined,
  });

  it('[AC1] detects a connected keyboard and selects it automatically', async () => {
    const access = new FakeAccess();
    access.ports.set('in-1', new FakePort('in-1', 'Digital Piano'));
    const mgr = new MidiConnectionManager(env(access));
    expect(await mgr.init()).toBe('ready');
    expect(mgr.devices).toHaveLength(1);
    expect(mgr.devices[0]).toMatchObject({ name: 'Digital Piano', state: 'connected' });
    expect(mgr.selectedId).toBe('in-1');
    const received: number[][] = [];
    mgr.onMessage((d) => received.push([...d]));
    access.ports.get('in-1')!.send([0x90, 60, 99], 5);
    expect(received).toEqual([[0x90, 60, 99]]);
  });

  it('reports unsupported, insecure and denied states', async () => {
    expect(await new MidiConnectionManager(env(null)).init()).toBe('unsupported');
    expect(await new MidiConnectionManager(env(new FakeAccess(), { secure: false })).init()).toBe('insecure');
    expect(await new MidiConnectionManager(env(new FakeAccess(), { deny: true })).init()).toBe('denied');
  });

  it('[AC16] reports a disconnect, then reattaches when the same device is plugged back in, even with a new port id', async () => {
    const access = new FakeAccess();
    access.ports.set('in-1', new FakePort('in-1', 'Digital Piano'));
    const mgr = new MidiConnectionManager(env(access));
    await mgr.init();
    const events: ConnectionEvent[] = [];
    mgr.on((e) => events.push(e));
    const received: number[] = [];
    mgr.onMessage((d) => received.push(d[1]));

    access.unplug('in-1');
    expect(events.some((e) => e.type === 'deviceLost')).toBe(true);
    expect(mgr.isSelectedConnected()).toBe(false);

    const replugged = new FakePort('in-2', 'Digital Piano');
    access.ports.delete('in-1');
    access.plug(replugged);
    expect(events.some((e) => e.type === 'deviceRestored')).toBe(true);
    expect(mgr.selectedId).toBe('in-2');
    replugged.send([0x90, 64, 80], 10);
    expect(received).toEqual([64]);
  });

  it('can listen to every input at once', async () => {
    const access = new FakeAccess();
    access.ports.set('a', new FakePort('a', 'A'));
    access.ports.set('b', new FakePort('b', 'B'));
    const mgr = new MidiConnectionManager(env(access));
    await mgr.init();
    mgr.select(ALL_INPUTS);
    const got: string[] = [];
    mgr.onMessage((_d, _t, id) => got.push(id));
    access.ports.get('a')!.send([0x90, 60, 1], 0);
    access.ports.get('b')!.send([0x90, 61, 1], 0);
    expect(got).toEqual(['a', 'b']);
  });

  it('selects a hot-plugged device when none is selected', async () => {
    const access = new FakeAccess();
    const mgr = new MidiConnectionManager(env(access));
    await mgr.init();
    expect(mgr.selectedId).toBeNull();
    access.plug(new FakePort('x', 'New Keyboard'));
    expect(mgr.selectedId).toBe('x');
  });
});
