import { useMemo } from 'react';
import { app } from '../../app/controller';
import { useStore, fmtPct, fmtDuration } from '../hooks';
import { Piano } from '../piano/Piano';
import { midiToName } from '../../core/music/pitch';

function TrendChart({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v !== null) as { v: number; i: number }[];
  const W = 640;
  const H = 180;
  const pad = 28;
  if (pts.length < 2) return <div className="muted" style={{ padding: 30, textAlign: 'center' }}>Finish at least two exercises to see your trend.</div>;
  const x = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - v * (H - pad * 2);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${d} L${x(pts[pts.length - 1].i)},${H - pad} L${x(pts[0].i)},${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Accuracy over time">
      <defs>
        <linearGradient id="trend" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--hand-r)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--hand-r)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 0.8, 1].map((g) => (
        <g key={g}>
          <line x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeDasharray={g === 0.8 ? '4 4' : undefined} />
          <text x={4} y={y(g) + 4} fontSize="10" fill="var(--muted)">{g * 100}%</text>
        </g>
      ))}
      <path d={area} fill="url(#trend)" />
      <path d={d} fill="none" stroke="var(--hand-r)" strokeWidth="2.5" strokeLinejoin="round" />
      {pts.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="3.5" fill="var(--surface)" stroke="var(--hand-r)" strokeWidth="2" />)}
    </svg>
  );
}

export function ProgressScreen() {
  useStore(app.historyVersion);
  const all = app.history.all();
  const mastery = app.history.noteMastery();
  const maxMiss = Math.max(1, ...Object.values(mastery));
  const heat = Object.fromEntries(Object.entries(mastery).map(([m, c]) => [m, c / maxMiss]));

  const totals = useMemo(() => {
    const notes = all.reduce((a, e) => a + e.notesPlayed, 0);
    const time = all.reduce((a, e) => a + e.durationMs, 0);
    const last10 = all.slice(-10).map((e) => e.firstTryAccuracy).filter((v): v is number => v !== null);
    const prev10 = all.slice(-20, -10).map((e) => e.firstTryAccuracy).filter((v): v is number => v !== null);
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const hand = (h: 'L' | 'R') => {
      const rows = all.flatMap((e) => e.byHand.filter((b) => b.hand === h));
      const steps = rows.reduce((a, r) => a + r.steps, 0);
      return steps ? rows.reduce((a, r) => a + r.cleanSteps, 0) / steps : null;
    };
    return { notes, time, recent: avg(last10), prev: avg(prev10), L: hand('L'), R: hand('R') };
  }, [all]);

  const delta = totals.recent !== null && totals.prev !== null ? totals.recent - totals.prev : null;
  const worst = Object.entries(mastery).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <div className="page">
      <div className="page-head" style={{ display: 'flex', alignItems: 'end' }}>
        <div>
          <h1>Progress</h1>
          <p>All results below come from your real MIDI playing. They are saved on this device only.</p>
        </div>
        {all.length > 0 && (
          <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => { if (confirm('Delete all practice history on this device?')) { app.history.clearAll(); app.historyVersion.set((v) => v + 1); } }}>Clear history</button>
        )}
      </div>

      <div className="kv" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="card card-pad"><div className="eyebrow">Sessions</div><div className="display" style={{ fontSize: 30 }}>{all.length}</div></div>
        <div className="card card-pad"><div className="eyebrow">Notes played</div><div className="display" style={{ fontSize: 30 }}>{totals.notes}</div></div>
        <div className="card card-pad"><div className="eyebrow">Practice time</div><div className="display" style={{ fontSize: 30 }}>{fmtDuration(totals.time)}</div></div>
        <div className="card card-pad">
          <div className="eyebrow">First-try accuracy (last 10)</div>
          <div className="display" style={{ fontSize: 30 }}>{fmtPct(totals.recent)}</div>
          {delta !== null && <div style={{ color: delta >= 0 ? 'var(--correct)' : 'var(--wrong)', fontSize: 12, fontWeight: 600 }}>{delta >= 0 ? '▲' : '▼'} {Math.abs(Math.round(delta * 100))} pts vs previous 10</div>}
        </div>
        <div className="card card-pad">
          <div className="eyebrow">By hand</div>
          <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
            <span><span className="hand-chip l" /> {fmtPct(totals.L)}</span>
            <span><span className="hand-chip r" /> {fmtPct(totals.R)}</span>
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="card card-pad grid" style={{ gap: 10 }}>
          <h2>Improvement over time</h2>
          <TrendChart values={all.slice(-40).map((e) => e.firstTryAccuracy)} />
        </div>
        <div className="card card-pad grid" style={{ gap: 10 }}>
          <h2>Most-missed notes</h2>
          {worst.length === 0 ? <div className="muted">No missed notes recorded yet.</div> : (
            <div className="chips">{worst.map(([m, c]) => <span key={m} className="chip bad">{midiToName(Number(m))} ×{c}</span>)}</div>
          )}
          <div className="muted" style={{ fontSize: 12 }}>Red keys mark where mistakes happen. Darker means more mistakes.</div>
          <Piano held={[]} labels="c-only" heat={heat} />
        </div>
      </div>

      <div className="card card-pad">
        <h2 style={{ marginBottom: 10 }}>Session history</h2>
        {all.length === 0 ? <div className="muted">No sessions yet. Finish an exercise to see your report here.</div> : (
          <table className="table">
            <thead><tr><th>Date</th><th>Exercise</th><th>Mode</th><th>Hands</th><th>Notes</th><th>Accuracy</th><th>First try</th><th>Timing</th><th>Time</th></tr></thead>
            <tbody>
              {[...all].reverse().slice(0, 50).map((e, i) => (
                <tr key={i}>
                  <td>{new Date(e.date).toLocaleString()}</td>
                  <td>{e.exerciseTitle}</td>
                  <td>{e.mode}{e.mode === 'rhythm' ? ` ${e.bpm}` : ''}</td>
                  <td>{e.hands === 'both' ? 'Both' : e.hands}</td>
                  <td>{e.notesPlayed}</td>
                  <td>{fmtPct(e.accuracy)}</td>
                  <td>{fmtPct(e.firstTryAccuracy)}</td>
                  <td>{e.timing ? `±${Math.round(e.timing.meanAbsMs)} ms` : '—'}</td>
                  <td>{fmtDuration(e.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
