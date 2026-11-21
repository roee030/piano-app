/**
 * MIDI Input Processor: turns raw MIDI bytes into clean, de-duplicated
 * Note On/Off events. It is deterministic and has no DOM dependency.
 */

export interface NoteEvent {
  type: 'noteOn' | 'noteOff';
  midi: number;
  velocity: number;
  /** DOMHighResTimeStamp of the MIDI message (same time base as performance.now()) */
  timestamp: number;
  deviceId: string;
  channel: number;
  /** True when the processor created the event (key retrigger, device disconnect, All Notes Off) */
  synthetic?: boolean;
}

export interface PedalEvent {
  type: 'sustain';
  down: boolean;
  timestamp: number;
  deviceId: string;
}

export type DiagnosticCode =
  | 'duplicate' // the same Note On arrived twice within the dedupe window
  | 'retrigger' // Note On for a key already held: a Note Off was missed
  | 'orphanNoteOff' // Note Off for a key that was not held
  | 'ghostFiltered' // velocity below the sensitivity threshold
  | 'malformed' // a message too short or invalid
  | 'stuckKey'; // a key held a very long time without a Note Off

export interface DiagnosticEvent {
  type: 'diagnostic';
  code: DiagnosticCode;
  midi?: number;
  timestamp: number;
  deviceId: string;
  detail: string;
}

export type ProcessedEvent = NoteEvent | PedalEvent | DiagnosticEvent;

export interface ProcessorOptions {
  /** A repeat Note On for a held key inside this window is a duplicate (ms) */
  dedupeWindowMs: number;
  /** Note Ons quieter than this velocity are filtered as ghost touches (1 = none filtered) */
  minVelocity: number;
  /** A key held longer than this is reported as possibly stuck (ms) */
  stuckKeyMs: number;
}

export const DEFAULT_PROCESSOR_OPTIONS: ProcessorOptions = {
  dedupeWindowMs: 8,
  minVelocity: 1,
  stuckKeyMs: 20000,
};

interface HeldKey {
  timestamp: number;
  velocity: number;
  deviceId: string;
  channel: number;
  stuckReported: boolean;
}

export interface MidiCounters {
  messages: number;
  noteOn: number;
  noteOff: number;
  realtime: number;
  duplicates: number;
  orphanNoteOffs: number;
  ghosts: number;
  malformed: number;
  retriggers: number;
}

export class MidiInputProcessor {
  opts: ProcessorOptions;
  private held = new Map<number, HeldKey>();
  private filtered = new Set<number>();
  private lastNoteOff = new Map<number, number>();
  sustainDown = false;
  counters: MidiCounters = this.zeroCounters();
  lastMessageAt: number | null = null;

  constructor(opts: Partial<ProcessorOptions> = {}) {
    this.opts = { ...DEFAULT_PROCESSOR_OPTIONS, ...opts };
  }

  private zeroCounters(): MidiCounters {
    return { messages: 0, noteOn: 0, noteOff: 0, realtime: 0, duplicates: 0, orphanNoteOffs: 0, ghosts: 0, malformed: 0, retriggers: 0 };
  }

  resetCounters() {
    this.counters = this.zeroCounters();
  }

  heldKeys(): number[] {
    return [...this.held.keys()].sort((a, b) => a - b);
  }

  isHeld(midi: number) {
    return this.held.has(midi);
  }

  handleMessage(data: ArrayLike<number>, timestamp: number, deviceId: string): ProcessedEvent[] {
    this.counters.messages++;
    this.lastMessageAt = timestamp;
    if (!data || data.length === 0) return [this.diag('malformed', timestamp, deviceId, 'empty message')];
    const status = data[0];
    if (status >= 0xf8) {
      // Real-time messages (clock, active sensing). They show the link is alive and carry no notes.
      this.counters.realtime++;
      return [];
    }
    if (status < 0x80) {
      this.counters.malformed++;
      return [this.diag('malformed', timestamp, deviceId, `data byte without status: ${hex(data)}`)];
    }
    const cmd = status & 0xf0;
    const channel = status & 0x0f;
    if (cmd === 0x90 || cmd === 0x80) {
      if (data.length < 3 || data[1] > 127 || data[2] > 127) {
        this.counters.malformed++;
        return [this.diag('malformed', timestamp, deviceId, `bad note message: ${hex(data)}`)];
      }
      const midi = data[1];
      const velocity = data[2];
      if (cmd === 0x90 && velocity > 0) return this.noteOn(midi, velocity, timestamp, deviceId, channel);
      return this.noteOff(midi, velocity, timestamp, deviceId, channel);
    }
    if (cmd === 0xb0 && data.length >= 3) {
      const cc = data[1];
      const value = data[2];
      if (cc === 64) {
        const down = value >= 64;
        if (down === this.sustainDown) return [];
        this.sustainDown = down;
        return [{ type: 'sustain', down, timestamp, deviceId }];
      }
      if (cc === 123 || cc === 120) return this.releaseAll(timestamp, deviceId, 'All Notes Off');
    }
    return [];
  }

  private noteOn(midi: number, velocity: number, timestamp: number, deviceId: string, channel: number): ProcessedEvent[] {
    if (velocity < this.opts.minVelocity) {
      this.counters.ghosts++;
      this.filtered.add(midi);
      return [this.diag('ghostFiltered', timestamp, deviceId, `velocity ${velocity} below threshold ${this.opts.minVelocity}`, midi)];
    }
    const existing = this.held.get(midi);
    const out: ProcessedEvent[] = [];
    if (existing) {
      if (timestamp - existing.timestamp <= this.opts.dedupeWindowMs) {
        this.counters.duplicates++;
        return [this.diag('duplicate', timestamp, deviceId, `duplicate Note On within ${this.opts.dedupeWindowMs} ms`, midi)];
      }
      // The key was pressed again without a Note Off in between. Close the old press first.
      this.counters.retriggers++;
      out.push(this.diag('retrigger', timestamp, deviceId, 'Note On for a held key (missing Note Off)', midi));
      out.push({ type: 'noteOff', midi, velocity: 0, timestamp, deviceId, channel, synthetic: true });
      this.counters.noteOff++;
    } else {
      // A Note On that follows its own Note Off within the window is a bounce or duplicate.
      // Real repeated presses are far slower than this.
      const lastOff = this.lastNoteOff.get(midi);
      if (lastOff !== undefined && timestamp - lastOff < 0) {
        this.counters.duplicates++;
        return [this.diag('duplicate', timestamp, deviceId, 'Note On older than the last Note Off', midi)];
      }
    }
    this.filtered.delete(midi);
    this.held.set(midi, { timestamp, velocity, deviceId, channel, stuckReported: false });
    this.counters.noteOn++;
    out.push({ type: 'noteOn', midi, velocity, timestamp, deviceId, channel });
    return out;
  }

  private noteOff(midi: number, velocity: number, timestamp: number, deviceId: string, channel: number): ProcessedEvent[] {
    if (this.filtered.has(midi)) {
      this.filtered.delete(midi);
      return [];
    }
    if (!this.held.has(midi)) {
      this.counters.orphanNoteOffs++;
      return [this.diag('orphanNoteOff', timestamp, deviceId, 'Note Off for a key that was not down', midi)];
    }
    this.held.delete(midi);
    this.lastNoteOff.set(midi, timestamp);
    this.counters.noteOff++;
    return [{ type: 'noteOff', midi, velocity, timestamp, deviceId, channel }];
  }

  /** Release every held key, or only one device's keys (used on disconnect). */
  releaseAll(timestamp: number, deviceId?: string, reason = 'release'): ProcessedEvent[] {
    const out: ProcessedEvent[] = [];
    for (const [midi, k] of [...this.held.entries()]) {
      if (deviceId && k.deviceId !== deviceId && reason !== 'All Notes Off') continue;
      this.held.delete(midi);
      out.push({ type: 'noteOff', midi, velocity: 0, timestamp, deviceId: k.deviceId, channel: k.channel, synthetic: true });
    }
    if (reason !== 'All Notes Off' && this.sustainDown) {
      this.sustainDown = false;
      out.push({ type: 'sustain', down: false, timestamp, deviceId: deviceId ?? '' });
    }
    return out;
  }

  /** Call this regularly to report keys that look stuck (an input problem, not a playing mistake). */
  checkStuck(now: number): DiagnosticEvent[] {
    const out: DiagnosticEvent[] = [];
    for (const [midi, k] of this.held) {
      if (!k.stuckReported && now - k.timestamp > this.opts.stuckKeyMs) {
        k.stuckReported = true;
        out.push(this.diag('stuckKey', now, k.deviceId, `held ${Math.round((now - k.timestamp) / 1000)} s with no Note Off`, midi));
      }
    }
    return out;
  }

  private diag(code: DiagnosticCode, timestamp: number, deviceId: string, detail: string, midi?: number): DiagnosticEvent {
    return { type: 'diagnostic', code, timestamp, deviceId, detail, midi };
  }
}

function hex(data: ArrayLike<number>): string {
  return Array.from(data, (b) => b.toString(16).padStart(2, '0')).join(' ');
}
