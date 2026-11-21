import type { PerformanceReport } from './report';
import { midiToName } from '../music/pitch';

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const KEY = 'pianotutor.history.v1';
const MAX = 500;

export type HistoryEntry = Omit<PerformanceReport, 'suggestions' | 'hardestSteps'>;

export class ProgressHistory {
  constructor(private storage: StorageLike | undefined) {}

  all(): HistoryEntry[] {
    try {
      return JSON.parse(this.storage?.getItem(KEY) ?? '[]') as HistoryEntry[];
    } catch {
      return [];
    }
  }

  add(r: PerformanceReport) {
    const { suggestions: _s, hardestSteps: _h, ...entry } = r;
    void _s;
    void _h;
    const list = [...this.all(), entry].slice(-MAX);
    this.storage?.setItem(KEY, JSON.stringify(list));
  }

  clearExercise(exerciseId: string) {
    this.storage?.setItem(KEY, JSON.stringify(this.all().filter((e) => e.exerciseId !== exerciseId)));
  }

  clearAll() {
    this.storage?.setItem(KEY, '[]');
  }

  /** Mistakes per key, added up across all sessions */
  noteMastery(): Record<number, number> {
    const out: Record<number, number> = {};
    for (const e of this.all()) for (const m of e.mostMissed) out[m.midi] = (out[m.midi] ?? 0) + m.count;
    return out;
  }

  /** A short text summary for the AI tutor */
  summaryForTutor(): string {
    const all = this.all();
    if (all.length === 0) return 'No practice sessions recorded yet.';
    const recent = all.slice(-10);
    const lines = recent.map((e) => {
      const d = new Date(e.date).toISOString().slice(0, 10);
      const hands = e.byHand.map((h) => `${h.hand}:${h.firstTryAccuracy === null ? '-' : Math.round(h.firstTryAccuracy * 100) + '%'}`).join(' ');
      const missed = e.mostMissed.slice(0, 4).map((m) => `${m.name}×${m.count}`).join(', ');
      const kinds = Object.entries(e.mistakeCounts).map(([k, v]) => `${k}:${v}`).join(', ');
      return `- ${d} "${e.exerciseTitle}" mode=${e.mode} hands=${e.hands} bpm=${e.bpm} accuracy=${e.accuracy === null ? '-' : Math.round(e.accuracy * 100) + '%'} firstTry=${e.firstTryAccuracy === null ? '-' : Math.round(e.firstTryAccuracy * 100) + '%'} byHand[${hands}] missed[${missed}] mistakes[${kinds}]${e.timing ? ` timingMeanAbs=${Math.round(e.timing.meanAbsMs)}ms` : ''}`;
    });
    const mastery = Object.entries(this.noteMastery()).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return `Sessions recorded: ${all.length}. Last ${recent.length} sessions:\n${lines.join('\n')}\nMost-missed notes overall: ${mastery.map(([m, c]) => `${midiToName(Number(m))}×${c}`).join(', ')}`;
  }
}
