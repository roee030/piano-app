/**
 * MIDI Connection Manager. It wraps the Web MIDI API: permission, device
 * discovery, selection, hot-plug and automatic reconnection.
 * It depends only on minimal structural interfaces, so tests can inject a simulated MIDIAccess.
 */

export interface MidiPortLike {
  id: string;
  name: string | null;
  manufacturer: string | null;
  state: 'connected' | 'disconnected';
  connection: 'open' | 'closed' | 'pending';
  type: 'input' | 'output';
  onmidimessage: ((e: { data: Uint8Array | null; timeStamp: number }) => void) | null;
  open?: () => Promise<unknown>;
}

export interface MidiAccessLike {
  inputs: { forEach(cb: (port: MidiPortLike, key: string) => void): void; get?(id: string): MidiPortLike | undefined };
  onstatechange: ((e: { port: MidiPortLike | null }) => void) | null;
}

export type MidiStatus =
  | 'idle'
  | 'unsupported' // the browser has no Web MIDI
  | 'insecure' // the page is not served from HTTPS or localhost
  | 'requesting'
  | 'denied'
  | 'ready'
  | 'error';

export interface DeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: 'connected' | 'disconnected';
  connection: 'open' | 'closed' | 'pending';
}

export type ConnectionEvent =
  | { type: 'status'; status: MidiStatus; error?: string }
  | { type: 'devices'; devices: DeviceInfo[] }
  | { type: 'deviceLost'; device: DeviceInfo; timestamp: number }
  | { type: 'deviceRestored'; device: DeviceInfo; timestamp: number }
  | { type: 'deviceAdded'; device: DeviceInfo };

export type MessageHandler = (data: Uint8Array, timeStamp: number, deviceId: string) => void;

export interface MidiEnvironment {
  requestMIDIAccess?: (opts?: { sysex?: boolean }) => Promise<MidiAccessLike>;
  isSecureContext: boolean;
  now: () => number;
  storage?: { getItem(k: string): string | null; setItem(k: string, v: string): void };
}

const STORAGE_KEY = 'pianotutor.midi.lastDevice';
export const ALL_INPUTS = '__all__';

export class MidiConnectionManager {
  status: MidiStatus = 'idle';
  error?: string;
  devices: DeviceInfo[] = [];
  /** A device id, ALL_INPUTS, or null */
  selectedId: string | null = null;
  private selectedName: string | null = null;
  private access: MidiAccessLike | null = null;
  private attached = new Map<string, MidiPortLike>();
  private listeners = new Set<(e: ConnectionEvent) => void>();
  private messageHandler: MessageHandler | null = null;
  private selectedConnected = false;

  constructor(private env: MidiEnvironment) {}

  static browserEnvironment(): MidiEnvironment {
    const nav = typeof navigator !== 'undefined' ? (navigator as unknown as { requestMIDIAccess?: MidiEnvironment['requestMIDIAccess'] }) : undefined;
    return {
      requestMIDIAccess: nav?.requestMIDIAccess ? nav.requestMIDIAccess.bind(nav) : undefined,
      isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
      now: () => performance.now(),
      storage: typeof localStorage !== 'undefined' ? localStorage : undefined,
    };
  }

  on(cb: (e: ConnectionEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onMessage(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  private emit(e: ConnectionEvent) {
    for (const l of this.listeners) l(e);
  }

  private setStatus(s: MidiStatus, error?: string) {
    this.status = s;
    this.error = error;
    this.emit({ type: 'status', status: s, error });
  }

  async init(): Promise<MidiStatus> {
    if (!this.env.isSecureContext) {
      this.setStatus('insecure', 'Web MIDI needs a secure context. Serve the page from https:// or localhost.');
      return this.status;
    }
    if (!this.env.requestMIDIAccess) {
      this.setStatus('unsupported', 'This browser has no Web MIDI. Use desktop Chrome or Edge.');
      return this.status;
    }
    this.setStatus('requesting');
    try {
      this.access = await this.env.requestMIDIAccess({ sysex: false });
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e?.name === 'SecurityError' || e?.name === 'NotAllowedError') {
        this.setStatus('denied', 'MIDI permission was denied. Allow MIDI in the site settings (the lock icon in the address bar), then reload.');
      } else {
        this.setStatus('error', e?.message ?? String(err));
      }
      return this.status;
    }
    this.access.onstatechange = (e) => this.handleStateChange(e.port);
    this.refreshDevices();
    this.setStatus('ready');
    this.autoSelect();
    return this.status;
  }

  private portInfo(p: MidiPortLike): DeviceInfo {
    return {
      id: p.id,
      name: p.name ?? 'Unknown MIDI device',
      manufacturer: p.manufacturer ?? '',
      state: p.state,
      connection: p.connection,
    };
  }

  private inputPorts(): MidiPortLike[] {
    const out: MidiPortLike[] = [];
    this.access?.inputs.forEach((p) => out.push(p));
    return out;
  }

  private refreshDevices() {
    this.devices = this.inputPorts().map((p) => this.portInfo(p));
    this.emit({ type: 'devices', devices: this.devices });
  }

  private autoSelect() {
    if (this.selectedId) return;
    const connected = this.devices.filter((d) => d.state === 'connected');
    if (connected.length === 0) return;
    const remembered = this.env.storage?.getItem(STORAGE_KEY);
    const match = connected.find((d) => d.name === remembered) ?? connected[0];
    this.select(match.id);
  }

  select(id: string | null) {
    for (const [, port] of this.attached) port.onmidimessage = null;
    this.attached.clear();
    this.selectedId = id;
    this.selectedName = null;
    this.selectedConnected = false;
    if (!id) return;
    if (id === ALL_INPUTS) {
      for (const p of this.inputPorts()) if (p.state === 'connected') this.attach(p);
      this.selectedConnected = this.attached.size > 0;
      return;
    }
    const port = this.inputPorts().find((p) => p.id === id);
    if (port) {
      this.selectedName = port.name;
      if (port.name) this.env.storage?.setItem(STORAGE_KEY, port.name);
      if (port.state === 'connected') {
        this.attach(port);
        this.selectedConnected = true;
      }
    }
  }

  private attach(port: MidiPortLike) {
    port.onmidimessage = (e) => {
      if (!e.data) return;
      this.messageHandler?.(e.data, e.timeStamp, port.id);
    };
    this.attached.set(port.id, port);
    // open() is implicit when a handler is set, but calling it surfaces errors such as a port busy in another app.
    port.open?.().catch((err: unknown) => this.setStatus('error', `Could not open ${port.name}: ${String(err)}`));
  }

  isSelectedConnected(): boolean {
    return this.selectedConnected;
  }

  private handleStateChange(port: MidiPortLike | null) {
    this.refreshDevices();
    if (!port || port.type !== 'input') return;
    const info = this.portInfo(port);
    const now = this.env.now();
    const isSelected =
      this.selectedId === ALL_INPUTS || port.id === this.selectedId || (this.selectedName !== null && port.name === this.selectedName);

    if (port.state === 'disconnected') {
      if (isSelected && this.attached.has(port.id)) {
        this.attached.get(port.id)!.onmidimessage = null;
        this.attached.delete(port.id);
        if (this.attached.size === 0) {
          this.selectedConnected = false;
          this.emit({ type: 'deviceLost', device: info, timestamp: now });
        }
      }
      return;
    }
    // connected
    if (isSelected) {
      if (!this.attached.has(port.id)) {
        // On reconnect the OS may give the port a new id, so it is matched by name too.
        if (this.selectedId !== ALL_INPUTS) this.selectedId = port.id;
        const wasDisconnected = !this.selectedConnected;
        this.attach(port);
        this.selectedConnected = true;
        if (wasDisconnected) this.emit({ type: 'deviceRestored', device: info, timestamp: now });
      }
    } else {
      this.emit({ type: 'deviceAdded', device: info });
      if (!this.selectedId) this.autoSelect();
    }
  }
}
