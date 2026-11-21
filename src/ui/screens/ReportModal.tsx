import { app } from '../../app/controller';
import type { PerformanceReport } from '../../core/progress/report';
import type { MistakeKind } from '../../core/practice/types';
import { fmtDuration, fmtPct } from '../hooks';

const KIND_LABEL: Record<MistakeKind, string> = {
  wrongNote: 'Wrong notes',
  wrongOctave: 'Wrong octave',
  wrongSequence: 'Played ahead',
  extraNote: 'Extra notes',
  incompleteChord: 'Incomplete chords',
  missed: 'Missed (late)',
  early: 'Early',
  late: 'Late',
  releasedEarly: 'Released early',
  heldTooLong: 'Held too long',
};

export function ReportModal({ report: r }: { report: PerformanceReport }) {
  const close = () => app.report.set(null);
  const p = Math.round((r.firstTryAccuracy ?? 0) * 100);
  const verdict = p >= 95 ? 'Excellent reading.' : p >= 80 ? 'Solid. A few spots to polish.' : p >= 60 ? 'Good progress. Drill the hard spots.' : 'Take it slower. Accuracy first.';
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="card modal" role="dialog" aria-label="Performance report">
        <div className="card-pad grid" style={{ gap: 22, padding: 28 }}>
          <div className="report-hero">
            <div className="ring" style={{ ['--p' as string]: p }}>
              <div>
                <div>
                  <div className="big">{p}%</div>
                  <div className="muted" style={{ fontSize: 11 }}>first try</div>
                </div>
              </div>
            </div>
            <div className="grid" style={{ gap: 6 }}>
              <div className="eyebrow">Performance report · {r.mode} mode{r.mode === 'rhythm' ? ` · ${r.bpm} BPM` : ''}</div>
              <h2 className="display" style={{ fontSize: 28 }}>{verdict}</h2>
              <div className="muted">{r.exerciseTitle}</div>
              <div className="stat-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginTop: 10 }}>
                <div className="stat"><div className="k">Notes played</div><div className="v">{r.notesPlayed}</div></div>
                <div className="stat"><div className="k">Correct</div><div className="v" style={{ color: 'var(--correct)' }}>{r.correct}</div></div>
                <div className="stat"><div className="k">Wrong</div><div className="v" style={{ color: r.incorrect ? 'var(--wrong)' : undefined }}>{r.incorrect}</div></div>
                <div className="stat"><div className="k">Accuracy</div><div className="v">{fmtPct(r.accuracy)}</div></div>
                <div className="stat"><div className="k">Time</div><div className="v">{fmtDuration(r.durationMs)}</div></div>
              </div>
            </div>
          </div>

          <div className="two-col" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="grid" style={{ gap: 14 }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>By hand</div>
                <div className="hand-bars">
                  {r.byHand.map((h) => (
                    <div className="hand-bar" key={h.hand}>
                      <span><span className={`hand-chip ${h.hand.toLowerCase()}`} /> {h.hand === 'L' ? 'Left' : 'Right'}</span>
                      <div className="track"><div className="fill" style={{ width: `${(h.firstTryAccuracy ?? 0) * 100}%`, background: h.hand === 'L' ? 'var(--hand-l)' : 'var(--hand-r)' }} /></div>
                      <span className="muted" style={{ textAlign: 'right' }}>{fmtPct(h.firstTryAccuracy)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Most-missed notes</div>
                <div className="chips">
                  {r.mostMissed.length === 0 ? <span className="muted">None. Every note was right.</span> : r.mostMissed.map((m) => <span key={m.midi} className="chip bad">{m.name} ×{m.count}</span>)}
                </div>
              </div>
              <div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Mistake types</div>
                <div className="chips">
                  {Object.entries(r.mistakeCounts).length === 0 ? <span className="muted">No mistakes</span> : Object.entries(r.mistakeCounts).map(([k, v]) => <span key={k} className="chip">{KIND_LABEL[k as MistakeKind]} · {v}</span>)}
                </div>
              </div>
              {r.timing && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>Timing</div>
                  <div className="muted">Average offset {Math.round(r.timing.meanAbsMs)} ms ({r.timing.meanMs < -15 ? 'rushing' : r.timing.meanMs > 15 ? 'dragging' : 'centered'}) · {r.timing.early} early · {r.timing.late} late</div>
                </div>
              )}
              {r.hardestSteps.length > 0 && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>Hardest spots</div>
                  <div className="chips">{r.hardestSteps.map((s) => <span key={s.stepIndex} className="chip">m.{s.measure + 1} {s.notes} · {s.attempts} tries</span>)}</div>
                </div>
              )}
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>What to practice next</div>
              <div className="suggestions">
                {r.suggestions.map((s) => (
                  <button key={s.id} className="suggestion" onClick={() => app.applySuggestion(s)}>
                    <div style={{ flex: 1 }}>
                      <div className="t">{s.title}</div>
                      <div className="d">{s.detail}</div>
                    </div>
                    <span className="muted">→</span>
                  </button>
                ))}
                <button className="suggestion" onClick={() => { close(); app.view.set('tutor'); }}>
                  <div style={{ flex: 1 }}>
                    <div className="t">Ask the AI tutor about this session</div>
                    <div className="d">Get an explanation and a personal practice plan.</div>
                  </div>
                  <span className="muted">→</span>
                </button>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => { close(); app.engine.restart(); }}>↺ Play again</button>
            <button className="btn primary" onClick={close}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
