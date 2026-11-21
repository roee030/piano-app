import type { Exercise, GeneratorConfig, Hand } from '../model/types';
import type { Mistake, PracticeSettings, PracticeStats, MistakeKind } from '../practice/types';
import { TIMING_KINDS } from '../practice/types';
import type { Step } from '../practice/timeline';
import { midiToName } from '../music/pitch';

export interface HandReport {
  hand: Hand;
  steps: number;
  cleanSteps: number;
  firstTryAccuracy: number | null;
  wrongNotes: number;
}

export interface Suggestion {
  id: string;
  title: string;
  detail: string;
  /** Changes to apply to the generator config and/or practice settings */
  configPatch?: Partial<GeneratorConfig>;
  settingsPatch?: Partial<PracticeSettings>;
  drillMeasures?: number[];
}

export interface PerformanceReport {
  exerciseId: string;
  exerciseTitle: string;
  mode: PracticeSettings['mode'];
  hands: PracticeSettings['hands'];
  bpm: number;
  date: number;
  notesPlayed: number;
  correct: number;
  incorrect: number;
  /** correct / (correct + incorrect) */
  accuracy: number | null;
  /** Steps played correctly on the first attempt */
  firstTryAccuracy: number | null;
  totalSteps: number;
  completedSteps: number;
  durationMs: number;
  byHand: HandReport[];
  mostMissed: { midi: number; name: string; count: number }[];
  mistakeCounts: Partial<Record<MistakeKind, number>>;
  measuresWithMistakes: number[];
  hardestSteps: { stepIndex: number; measure: number; attempts: number; notes: string }[];
  timing: { meanAbsMs: number; meanMs: number; early: number; late: number; count: number } | null;
  articulation: { releasedEarly: number; heldTooLong: number };
  loopsCompleted: number;
  suggestions: Suggestion[];
}

const pct = (a: number, b: number) => (b > 0 ? a / b : null);

export function buildReport(
  ex: Exercise,
  steps: Step[],
  stats: PracticeStats,
  mistakes: Mistake[],
  settings: PracticeSettings,
  date = Date.now(),
): PerformanceReport {
  const pitchMistakes = mistakes.filter((m) => !TIMING_KINDS.includes(m.kind));
  const mistakeCounts: Partial<Record<MistakeKind, number>> = {};
  for (const m of mistakes) mistakeCounts[m.kind] = (mistakeCounts[m.kind] ?? 0) + 1;

  const attempted = Object.keys(stats.attemptsByStep).map(Number);
  const clean = attempted.filter((i) => stats.attemptsByStep[i] === 1).length;

  const byHand: HandReport[] = (['R', 'L'] as Hand[])
    .filter((h) => stats.byHand[h].steps > 0 || stats.byHand[h].incorrect > 0)
    .map((h) => ({
      hand: h,
      steps: stats.byHand[h].steps,
      cleanSteps: stats.byHand[h].cleanSteps,
      firstTryAccuracy: pct(stats.byHand[h].cleanSteps, stats.byHand[h].steps),
      wrongNotes: stats.byHand[h].incorrect,
    }));

  const mostMissed = Object.entries(stats.missedByMidi)
    .map(([m, c]) => ({ midi: Number(m), name: midiToName(Number(m)), count: c }))
    .sort((a, b) => b.count - a.count || a.midi - b.midi)
    .slice(0, 6);

  const measuresWithMistakes = [...new Set(pitchMistakes.map((m) => m.measure))].sort((a, b) => a - b);

  const hardestSteps = attempted
    .filter((i) => stats.attemptsByStep[i] > 1)
    .sort((a, b) => stats.attemptsByStep[b] - stats.attemptsByStep[a])
    .slice(0, 5)
    .map((i) => ({
      stepIndex: i,
      measure: steps[i]?.measure ?? 0,
      attempts: stats.attemptsByStep[i],
      notes: (steps[i]?.notes ?? []).map((n) => midiToName(n.midi)).join(' '),
    }));

  let timing: PerformanceReport['timing'] = null;
  if (stats.deviations.length > 0) {
    const tol = settings.timingToleranceMs;
    const n = stats.deviations.length;
    timing = {
      count: n,
      meanMs: stats.deviations.reduce((a, b) => a + b, 0) / n,
      meanAbsMs: stats.deviations.reduce((a, b) => a + Math.abs(b), 0) / n,
      early: stats.deviations.filter((d) => d < -tol).length,
      late: stats.deviations.filter((d) => d > tol).length,
    };
  }

  const report: PerformanceReport = {
    exerciseId: ex.id,
    exerciseTitle: ex.title,
    mode: settings.mode,
    hands: settings.hands,
    bpm: settings.bpm,
    date,
    notesPlayed: stats.notesPlayed,
    correct: stats.correct,
    incorrect: stats.incorrect,
    accuracy: pct(stats.correct, stats.correct + stats.incorrect),
    firstTryAccuracy: pct(clean, attempted.length),
    totalSteps: steps.length,
    completedSteps: attempted.length,
    durationMs: stats.activeMs,
    byHand,
    mostMissed,
    mistakeCounts,
    measuresWithMistakes,
    hardestSteps,
    timing,
    articulation: { releasedEarly: stats.releasedEarly, heldTooLong: stats.heldTooLong },
    loopsCompleted: stats.loopsCompleted,
    suggestions: [],
  };
  report.suggestions = suggestNext(report, ex, settings);
  return report;
}

/** Recommendations made deterministically from the results. The AI tutor can explain them further. */
export function suggestNext(r: PerformanceReport, ex: Exercise, settings: PracticeSettings): Suggestion[] {
  const out: Suggestion[] = [];
  const cfg = ex.config;
  const acc = r.firstTryAccuracy ?? 0;

  if (r.measuresWithMistakes.length > 0 && r.measuresWithMistakes.length < ex.measures.length) {
    out.push({
      id: 'drill',
      title: `Drill measure${r.measuresWithMistakes.length > 1 ? 's' : ''} ${r.measuresWithMistakes.map((m) => m + 1).join(', ')}`,
      detail: 'Repeat only the measures where mistakes happened until they are clean.',
      drillMeasures: r.measuresWithMistakes,
    });
  }

  const [l, rh] = [r.byHand.find((h) => h.hand === 'L'), r.byHand.find((h) => h.hand === 'R')];
  if (l && rh && l.firstTryAccuracy !== null && rh.firstTryAccuracy !== null && Math.abs(l.firstTryAccuracy - rh.firstTryAccuracy) >= 0.15) {
    const weak = l.firstTryAccuracy < rh.firstTryAccuracy ? 'L' : 'R';
    out.push({
      id: 'weak-hand',
      title: `Practice the ${weak === 'L' ? 'left' : 'right'} hand alone`,
      detail: `Its first-try accuracy was ${Math.round((weak === 'L' ? l : rh).firstTryAccuracy! * 100)}%, compared with ${Math.round((weak === 'L' ? rh : l).firstTryAccuracy! * 100)}% for the other hand.`,
      settingsPatch: { hands: weak },
    });
  }

  if (r.mostMissed.length > 0 && r.mostMissed[0].count >= 2 && cfg) {
    const focus = r.mostMissed.slice(0, 3).map((m) => m.midi);
    const lo = Math.min(...focus) - 2;
    const hi = Math.max(...focus) + 2;
    const leftHand = focus.every((m) => m < 60) ? true : focus.every((m) => m >= 60) ? false : null;
    if (leftHand !== null) {
      out.push({
        id: 'focus-notes',
        title: `Focus on ${r.mostMissed.slice(0, 3).map((m) => m.name).join(', ')}`,
        detail: 'A new exercise in a narrow range around the notes you missed most often.',
        configPatch: leftHand
          ? { hands: 'L', leftRange: { low: lo, high: Math.max(hi, lo + 5) }, seed: cfg.seed + 101 }
          : { hands: 'R', rightRange: { low: lo, high: Math.max(hi, lo + 5) }, seed: cfg.seed + 101 },
      });
    }
  }

  if (r.timing && r.timing.meanAbsMs > settings.timingToleranceMs * 0.8) {
    out.push({
      id: 'slower',
      title: `Slow down to ${Math.max(40, Math.round(settings.bpm * 0.85))} BPM`,
      detail: `Your average timing offset was ${Math.round(r.timing.meanAbsMs)} ms${r.timing.meanMs < -20 ? ' (mostly rushing)' : r.timing.meanMs > 20 ? ' (mostly dragging)' : ''}.`,
      settingsPatch: { bpm: Math.max(40, Math.round(settings.bpm * 0.85)) },
    });
  }

  if (acc >= 0.95 && r.completedSteps === r.totalSteps) {
    if (settings.mode !== 'rhythm') {
      out.push({ id: 'rhythm', title: 'Try it in rhythm mode', detail: 'You have the notes. Now play them in time with the metronome.', settingsPatch: { mode: 'rhythm' } });
    } else if (r.timing && r.timing.meanAbsMs < settings.timingToleranceMs * 0.5) {
      out.push({ id: 'faster', title: `Speed up to ${Math.round(settings.bpm * 1.1)} BPM`, detail: 'Your timing was steady.', settingsPatch: { bpm: Math.round(settings.bpm * 1.1) } });
    }
    if (cfg && cfg.difficulty < 5) {
      out.push({ id: 'harder', title: `Move up to difficulty ${cfg.difficulty + 1}`, detail: 'Larger leaps, more chords and more variety in rhythm.', configPatch: { difficulty: (cfg.difficulty + 1) as GeneratorConfig['difficulty'], seed: cfg.seed + 1 } });
    }
    if (cfg && settings.hands !== 'both') {
      out.push({ id: 'both', title: 'Add the other hand', detail: 'Combine both hands on the grand staff.', configPatch: { hands: 'both', seed: cfg.seed + 7 }, settingsPatch: { hands: 'both' } });
    }
  } else if (acc < 0.7 && cfg && cfg.difficulty > 1) {
    out.push({ id: 'easier', title: `Step back to difficulty ${cfg.difficulty - 1}`, detail: 'Build confidence with smaller intervals first.', configPatch: { difficulty: (cfg.difficulty - 1) as GeneratorConfig['difficulty'], seed: cfg.seed + 3 } });
  }

  if (cfg && out.length === 0) {
    out.push({ id: 'new', title: 'A new exercise with the same settings', detail: 'Fresh notes help you keep reading instead of memorizing.', configPatch: { seed: cfg.seed + 1 } });
  }
  return out;
}
