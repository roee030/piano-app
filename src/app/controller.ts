/**
 * App controller. It wires the MIDI Connection Manager, the MIDI Input Processor
 * and the Practice Engine together, measures latency and records progress.
 * The UI only reads stores and calls methods here.
 */
import { MidiConnectionManager, DeviceInfo, MidiStatus } from '../core/midi/MidiConnectionManager';
import { MidiInputProcessor, ProcessedEvent, MidiCounters, ProcessorOptions, DEFAULT_PROCESSOR_OPTIONS } from '../core/midi/MidiInputProcessor';
import { PracticeEngine, EngineSnapshot } from '../core/practice/PracticeEngine';
import { DEFAULT_SETTINGS, PracticeSettings } from '../core/practice/types';
import { DEFAULT_CONFIG, generateExercise, extractMeasures } from '../core/generator/generator';
import { PREDEFINED } from '../core/generator/predefined';
import type { Exercise, GeneratorConfig } from '../core/model/types';
import { buildReport, PerformanceReport, Suggestion } from '../core/progress/report';
import { ProgressHistory } from '../core/progress/history';
import { midiToName } from '../core/music/pitch';
import { Store, loadJSON, saveJSON } from './store';

export interface LogEntry {
  id: number;
  at: number; // MIDI timestamp
  device: string;
  raw: string;
  text: string;
  kind: 'noteOn' | 'noteOff' | 'sustain' | 'diagnostic' | 'connection';
}

export interface LatencyStats {
  /** MIDI timestamp -> JS handler (driver and browser delivery) */
  delivery: number[];
  /** Handler -> evaluation done (engine) */
  evaluation: number[];
  /** MIDI timestamp -> DOM committed with the feedback */
  toRender: number[];
  /** MIDI timestamp -> next animation frame after the commit (an approximation of paint) */
  toFrame: number[];
}

export interface MidiState {
  status: MidiStatus;
  error?: string;
  devices: DeviceInfo[];
  selectedId: string | null;
  connected: boolean;
  lastLost?: { name: string; at: number };
  lastMessageAt: number | null;
}

export interface DiagState {
  log: LogEntry[];
  counters: MidiCounters;
  latency: LatencyStats;
  held: number[];
  lowestSeen: number | null;
  highestSeen: number | null;
  warnings: { at: number; text: string }[];
}

export interface UiPrefs {
  theme: 'dark' | 'light';
  noteNames: 'c-only' | 'all' | 'none';
  pianoRange: 'full' | 'fit';
  metronome: boolean;
  metronomeInWait: boolean;
}

export type View = 'practice' | 'exercises' | 'progress' | 'tutor' | 'midi';

const SETTINGS_KEY = 'pianotutor.settings.v1';
const CONFIG_KEY = 'pianotutor.genconfig.v1';
const PREFS_KEY = 'pianotutor.prefs.v1';
const PROC_KEY = 'pianotutor.processor.v1';
const LOG_MAX = 200;
const LAT_MAX = 300;

export class AppController {
  midiManager = new MidiConnectionManager(MidiConnectionManager.browserEnvironment());
  processor: MidiInputProcessor;
  engine: PracticeEngine;
  history = new ProgressHistory(typeof localStorage !== 'undefined' ? localStorage : undefined);

  view = new Store<View>('practice');
  midi = new Store<MidiState>({ status: 'idle', devices: [], selectedId: null, connected: false, lastMessageAt: null });
  diag = new Store<DiagState>({
    log: [],
    counters: new MidiInputProcessor().counters,
    latency: { delivery: [], evaluation: [], toRender: [], toFrame: [] },
    held: [],
    lowestSeen: null,
    highestSeen: null,
    warnings: [],
  });
  engineState: Store<EngineSnapshot>;
  genConfig = new Store<GeneratorConfig>(loadJSON(CONFIG_KEY, DEFAULT_CONFIG));
  prefs = new Store<UiPrefs>(loadJSON(PREFS_KEY, { theme: 'dark', noteNames: 'c-only', pianoRange: 'full', metronome: true, metronomeInWait: false } as UiPrefs));
  report = new Store<PerformanceReport | null>(null);
  historyVersion = new Store(0);
  /** The most recent real Note On (for device confirmation and capturing a range from the keyboard) */
  lastNoteOn = new Store<{ midi: number; at: number; velocity: number } | null>(null);

  private logId = 0;
  /** Snapshot version -> MIDI timestamp of the event that produced it, for latency measurement */
  private pendingLatency = new Map<number, number>();
  private diagDirty = false;
  private lastCompletedVersion = -1;

  constructor() {
    const procOpts = loadJSON<ProcessorOptions>(PROC_KEY, DEFAULT_PROCESSOR_OPTIONS);
    this.processor = new MidiInputProcessor(procOpts);
    const settings = loadJSON<PracticeSettings>(SETTINGS_KEY, DEFAULT_SETTINGS);
    const cfg = this.genConfig.get();
    let exercise: Exercise;
    try {
      exercise = generateExercise({ ...cfg, hands: settings.hands === 'both' ? 'both' : cfg.hands });
    } catch {
      exercise = PREDEFINED[0];
    }
    this.engine = new PracticeEngine(exercise, settings);
    this.engineState = new Store(this.engine.getSnapshot());
    this.engine.subscribe((s) => this.onEngine(s));
    // Flush diagnostics at most once per frame
    const flush = () => {
      if (this.diagDirty) {
        this.diagDirty = false;
        this.diag.set((d) => ({ ...d, log: [...d.log], counters: { ...this.processor.counters }, held: this.processor.heldKeys() }));
      }
      for (const w of this.processor.checkStuck(performance.now())) this.warn(`${midiToName(w.midi!)} looks stuck: ${w.detail}`);
      this.engine.tick(performance.now());
      requestAnimationFrame(flush);
    };
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(flush);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.engine.getSnapshot().settings.mode === 'rhythm') this.engine.pause('hidden', performance.now());
      });
    }
  }

  // ------------------------------------------------------------------ MIDI

  async initMidi() {
    const m = this.midiManager;
    m.onMessage((data, ts, deviceId) => this.handleMidi(data, ts, deviceId));
    m.on((e) => {
      if (e.type === 'deviceLost') {
        // Synthetic Note Offs, so no key stays down on screen
        for (const ev of this.processor.releaseAll(performance.now(), e.device.id)) this.dispatch(ev);
        this.engine.inputLost(performance.now());
        this.logConnection(`Disconnected: ${e.device.name}`);
        this.midi.set((s) => ({ ...s, lastLost: { name: e.device.name, at: Date.now() } }));
      } else if (e.type === 'deviceRestored') {
        this.engine.inputRestored();
        this.logConnection(`Reconnected: ${e.device.name}`);
      } else if (e.type === 'deviceAdded') {
        this.logConnection(`Device available: ${e.device.name}`);
      }
      this.syncMidi();
    });
    await m.init();
    this.syncMidi();
  }

  selectDevice(id: string | null) {
    for (const ev of this.processor.releaseAll(performance.now())) this.dispatch(ev);
    this.midiManager.select(id);
    this.engine.inputRestored();
    this.syncMidi();
  }

  private syncMidi() {
    const m = this.midiManager;
    this.midi.set((s) => ({
      ...s,
      status: m.status,
      error: m.error,
      devices: [...m.devices],
      selectedId: m.selectedId,
      connected: m.isSelectedConnected(),
      lastMessageAt: this.processor.lastMessageAt,
    }));
  }

  /** Entry point for every MIDI message from a real port (and the dev-only simulator). */
  handleMidi(data: ArrayLike<number>, timeStamp: number, deviceId: string) {
    const tHandler = performance.now();
    // Some drivers deliver timeStamp 0; fall back to handler time
    const ts = timeStamp > 0 ? timeStamp : tHandler;
    const events = this.processor.handleMessage(data, ts, deviceId);
    for (const ev of events) this.dispatch(ev, data);
    const tEval = performance.now();
    if (events.some((e) => e.type === 'noteOn')) {
      this.pendingLatency.set(this.engine.getSnapshot().version, ts);
      this.pushLatency('delivery', tHandler - ts);
      this.pushLatency('evaluation', tEval - tHandler);
    }
    if (!this.midi.get().connected && deviceId !== 'dev-sim') this.syncMidi();
  }

  private dispatch(ev: ProcessedEvent, raw?: ArrayLike<number>) {
    const rawHex = raw ? Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join(' ') : '—';
    switch (ev.type) {
      case 'noteOn':
        this.engine.noteOn(ev.midi, ev.velocity, ev.timestamp);
        this.trackRange(ev.midi);
        this.lastNoteOn.set({ midi: ev.midi, at: ev.timestamp, velocity: ev.velocity });
        this.log({ at: ev.timestamp, device: ev.deviceId, raw: rawHex, kind: 'noteOn', text: `Note On  ${midiToName(ev.midi).padEnd(4)} (#${ev.midi}) vel ${ev.velocity} ch ${ev.channel + 1}${ev.synthetic ? ' [synthetic]' : ''}` });
        break;
      case 'noteOff':
        this.engine.noteOff(ev.midi, ev.timestamp);
        this.log({ at: ev.timestamp, device: ev.deviceId, raw: rawHex, kind: 'noteOff', text: `Note Off ${midiToName(ev.midi).padEnd(4)} (#${ev.midi})${ev.synthetic ? ' [synthetic]' : ''}` });
        break;
      case 'sustain':
        this.engine.sustainChange(ev.down);
        this.log({ at: ev.timestamp, device: ev.deviceId, raw: rawHex, kind: 'sustain', text: `Sustain pedal ${ev.down ? 'down' : 'up'}` });
        break;
      case 'diagnostic':
        this.log({ at: ev.timestamp, device: ev.deviceId, raw: rawHex, kind: 'diagnostic', text: `⚠ ${ev.code}${ev.midi !== undefined ? ' ' + midiToName(ev.midi) : ''}: ${ev.detail}` });
        if (ev.code === 'malformed' || ev.code === 'retrigger') this.warn(`Input: ${ev.code}, ${ev.detail}`);
        break;
    }
    this.diagDirty = true;
  }

  private trackRange(midi: number) {
    const d = this.diag.get();
    if (d.lowestSeen === null || midi < d.lowestSeen || d.highestSeen === null || midi > d.highestSeen) {
      this.diag.set((s) => ({
        ...s,
        lowestSeen: s.lowestSeen === null ? midi : Math.min(s.lowestSeen, midi),
        highestSeen: s.highestSeen === null ? midi : Math.max(s.highestSeen, midi),
      }));
    }
  }

  private log(e: Omit<LogEntry, 'id'>) {
    const entry = { ...e, id: ++this.logId };
    const d = this.diag.get();
    // Mutate and replace the array on each flush; the log can be busy
    d.log.push(entry);
    if (d.log.length > LOG_MAX) d.log.splice(0, d.log.length - LOG_MAX);
    this.diagDirty = true;
  }

  private logConnection(text: string) {
    this.log({ at: performance.now(), device: '', raw: '—', kind: 'connection', text });
    this.diag.set((d) => ({ ...d, log: [...d.log] }));
  }

  private warn(text: string) {
    this.diag.set((d) => ({ ...d, warnings: [...d.warnings.slice(-19), { at: Date.now(), text }] }));
  }

  private pushLatency(k: keyof LatencyStats, v: number) {
    const arr = this.diag.get().latency[k];
    arr.push(v);
    if (arr.length > LAT_MAX) arr.shift();
  }

  /** Called by the piano component after React has committed a snapshot. */
  markRendered(version: number) {
    const ts = this.pendingLatency.get(version);
    if (ts === undefined) return;
    this.pendingLatency.delete(version);
    const tCommit = performance.now();
    this.pushLatency('toRender', tCommit - ts);
    requestAnimationFrame(() => {
      const v = performance.now() - ts;
      // A hidden or throttled tab delays frames by seconds, which says nothing about MIDI latency
      if (document.visibilityState === 'visible' && v < 1000) this.pushLatency('toFrame', v);
      this.diagDirty = true;
    });
    if (this.pendingLatency.size > 50) this.pendingLatency.clear();
  }

  updateProcessor(patch: Partial<ProcessorOptions>) {
    this.processor.opts = { ...this.processor.opts, ...patch };
    saveJSON(PROC_KEY, this.processor.opts);
    this.diagDirty = true;
  }

  resetDiagnostics() {
    this.processor.resetCounters();
    this.diag.set((d) => ({ ...d, log: [], warnings: [], latency: { delivery: [], evaluation: [], toRender: [], toFrame: [] }, lowestSeen: null, highestSeen: null }));
  }

  // ---------------------------------------------------------------- practice

  private onEngine(s: EngineSnapshot) {
    this.engineState.set(s);
    if (s.state === 'completed' && this.lastCompletedVersion < 0) {
      this.lastCompletedVersion = s.version;
      const r = buildReport(s.exercise, s.steps, s.stats, s.mistakes, s.settings);
      this.history.add(r);
      this.historyVersion.set((v) => v + 1);
      this.report.set(r);
    } else if (s.state !== 'completed') {
      this.lastCompletedVersion = -1;
    }
  }

  updateSettings(patch: Partial<PracticeSettings>) {
    this.engine.updateSettings(patch, performance.now());
    saveJSON(SETTINGS_KEY, this.engine.getSnapshot().settings);
  }

  loadExercise(ex: Exercise) {
    this.report.set(null);
    this.engine.setExercise(ex);
    // Practice the hands the exercise actually contains
    const want = this.engine.getSnapshot().settings.hands;
    if (ex.hands !== 'both' && want !== ex.hands) this.updateSettings({ hands: ex.hands });
    if (ex.hands === 'both' && want !== 'both' && !ex.measures.some((m) => m.voices[want])) this.updateSettings({ hands: 'both' });
  }

  generate(patch: Partial<GeneratorConfig> = {}) {
    const cfg = { ...this.genConfig.get(), ...patch };
    this.genConfig.set(cfg);
    saveJSON(CONFIG_KEY, cfg);
    const ex = generateExercise(cfg);
    this.loadExercise(ex);
    this.updateSettings({ hands: cfg.hands });
    return ex;
  }

  newSeed() {
    return this.generate({ seed: Math.floor(Math.random() * 1e9) });
  }

  drillMistakes(measures?: number[]) {
    const s = this.engine.getSnapshot();
    const ms = measures ?? [...new Set(s.mistakes.filter((m) => !['early', 'late', 'releasedEarly', 'heldTooLong'].includes(m.kind)).map((m) => m.measure))];
    if (ms.length === 0) return false;
    this.loadExercise(extractMeasures(s.exercise, ms));
    return true;
  }

  applySuggestion(sg: Suggestion) {
    this.report.set(null);
    if (sg.drillMeasures) {
      this.drillMistakes(sg.drillMeasures);
    } else if (sg.configPatch) {
      this.generate(sg.configPatch);
    } else {
      this.engine.restart();
    }
    if (sg.settingsPatch) this.updateSettings(sg.settingsPatch);
  }

  setPrefs(patch: Partial<UiPrefs>) {
    this.prefs.set((p) => ({ ...p, ...patch }));
    saveJSON(PREFS_KEY, this.prefs.get());
  }
}

export const app = new AppController();
if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __app: AppController }).__app = app;
