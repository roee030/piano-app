import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EngineSnapshot } from '../../core/practice/PracticeEngine';
import type { Hand } from '../../core/model/types';
import { renderScore, ScoreLayout, xForTick } from './renderScore';
import { midiToName } from '../../core/music/pitch';
import { handsIn } from '../../core/practice/timeline';

const SCALE = 1.28;
const HAND_COLOR: Record<Hand, string> = { R: 'var(--hand-r)', L: 'var(--hand-l)' };

export function ScoreView({ snap }: { snap: EngineSnapshot }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engraveRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<SVGLineElement>(null);
  const [width, setWidth] = useState(0);
  const [layoutState, setLayout] = useState<{ l: ScoreLayout; ex: unknown; dim: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ex = snap.exercise;
  const practiced = handsIn(snap.settings.hands);
  const dimHands = (['L', 'R'] as Hand[]).filter((h) => !practiced.includes(h));
  const dimKey = dimHands.join('');
  // Use the layout only if it was made for this exercise (group ids repeat between exercises)

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!engraveRef.current || width === 0) return;
    try {
      const l = renderScore(engraveRef.current, ex, { width: width - 4, dimHands, inkColor: '#1d1b17', dimColor: '#b3ab9c', scale: SCALE });
      setLayout({ l, ex, dim: dimKey });
      setError(null);
    } catch (e) {
      setError(String(e));
      console.error(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex, width, dimKey]);

  const layout = layoutState && layoutState.ex === ex ? layoutState.l : null;

  // Scroll the current system into view
  const step = snap.currentStep;
  const curSystem = useMemo(() => {
    if (!layout || !step) return -1;
    const ref = step.notes[0]?.refs[0];
    return ref ? layout.notes.get(ref.groupId)?.system ?? -1 : -1;
  }, [layout, step]);
  useEffect(() => {
    if (!layout || curSystem < 0 || !scrollRef.current) return;
    const sys = layout.systems[curSystem];
    const box = scrollRef.current;
    const top = (sys.top - 60) * layout.scale;
    const bottom = (sys.bottom + 60) * layout.scale;
    if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) box.scrollTo({ top: Math.max(0, top - 10), behavior: 'smooth' });
  }, [curSystem, layout]);

  // Rhythm cursor, moved by rAF without React renders
  const tr = snap.transport;
  const isRhythm = snap.settings.mode === 'rhythm';
  const running = snap.state === 'playing' || snap.state === 'countIn';
  useEffect(() => {
    if (!layout || !isRhythm) return;
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      const tick = tr.frozen ? tr.anchorTick : tr.anchorTick + (now - tr.anchorTime) * tr.ticksPerMs;
      const sys = layout.systems.find((s) => tick >= s.startTick && tick < s.endTick) ?? (tick < 0 ? layout.systems.find((s) => snap.runStartTick >= s.startTick && snap.runStartTick < s.endTick) : undefined);
      const line = cursorRef.current;
      if (line) {
        if (sys && (running || snap.state === 'paused')) {
          const x = tick < snap.runStartTick ? xForTick(sys, snap.runStartTick) - 10 : xForTick(sys, tick);
          line.setAttribute('x1', String(x));
          line.setAttribute('x2', String(x));
          line.setAttribute('y1', String(sys.top - 26));
          line.setAttribute('y2', String(sys.bottom + 26));
          line.style.opacity = tick < snap.runStartTick ? '0.35' : '1';
        } else {
          line.style.opacity = '0';
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [layout, isRhythm, tr.anchorTick, tr.anchorTime, tr.ticksPerMs, tr.frozen, running, snap.state, snap.runStartTick]);

  const overlay = layout ? <Overlay snap={snap} layout={layout} /> : null;

  return (
    <div className="score-scroll" ref={scrollRef}>
      <div className="score-paper" ref={hostRef}>
        {error && <div className="score-error">Notation error: {error}</div>}
        <div className="score-stack" style={{ height: layout ? layout.height * layout.scale : 300 }}>
          <div ref={engraveRef} className="score-engraving" aria-label="Sheet music" />
          {layout && (
            <svg className="score-overlay" width={layout.width * layout.scale} height={layout.height * layout.scale} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden>
              {overlay}
              {isRhythm && <line ref={cursorRef} className="rhythm-cursor" x1={0} x2={0} y1={0} y2={0} />}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}

function Halo({ x, y, className, color }: { x: number; y: number; className: string; color?: string }) {
  return <ellipse cx={x} cy={y} rx={6.6} ry={4.9} transform={`rotate(-22 ${x} ${y})`} className={className} style={color ? { ['--c' as string]: color } : undefined} />;
}

function Overlay({ snap, layout }: { snap: EngineSnapshot; layout: ScoreLayout }) {
  const { steps, stepIndex, stepResults, loop } = snap;
  const els: React.ReactNode[] = [];

  // Loop range
  if (loop) {
    for (const m of layout.measures) {
      if (m.index < loop.start || m.index > loop.end) continue;
      const sys = layout.systems[m.system];
      els.push(<rect key={`loop-${m.index}`} className="loop-band" x={m.x + 1} y={sys.top - 34} width={m.width - 2} height={sys.bottom - sys.top + 68} rx={6} />);
    }
  }

  // Notes already played
  for (const [k, res] of Object.entries(stepResults)) {
    const st = steps[Number(k)];
    if (!st || Number(k) === stepIndex) continue;
    for (const n of st.notes) for (const r of n.refs) {
      const nl = layout.notes.get(r.groupId);
      if (!nl || nl.ys[r.pitchIndex] === undefined) continue;
      els.push(<Halo key={`done-${k}-${r.groupId}-${r.pitchIndex}`} x={nl.x} y={nl.ys[r.pitchIndex]} className={`halo halo-${res}`} />);
    }
  }

  // The current step
  const step = steps[stepIndex];
  if (step && snap.state !== 'completed') {
    const pts = step.notes.flatMap((n) => n.refs.map((r) => ({ n, r, nl: layout.notes.get(r.groupId) }))).filter((p) => p.nl);
    if (pts.length) {
      const sys = layout.systems[pts[0].nl!.system];
      const xs = pts.map((p) => p.nl!.x);
      const x0 = Math.min(...xs) - 15;
      const x1 = Math.max(...xs) + 15;
      els.push(<rect key="cursor" className={`step-cursor ${snap.wrongPlayed.length ? 'has-error' : ''} ${snap.state === 'paused' ? 'paused' : ''}`} x={x0} y={sys.top - 30} width={x1 - x0} height={sys.bottom - sys.top + 60} rx={9} />);
      for (const p of pts) {
        const status = snap.noteStatus[p.n.midi];
        const y = p.nl!.ys[p.r.pitchIndex];
        if (y === undefined) continue;
        els.push(
          <Halo
            key={`cur-${p.r.groupId}-${p.r.pitchIndex}`}
            x={p.nl!.x}
            y={y}
            className={status === 'correct' ? 'halo halo-clean' : 'halo halo-pending'}
            color={HAND_COLOR[p.r.hand]}
          />,
        );
      }
      // Wrong notes, drawn as red ghost noteheads at the pitch actually played
      const wrongs = snap.wrongPlayed.slice(-3);
      wrongs.forEach((w, i) => {
        const nearest = [...step.notes].sort((a, b) => Math.abs(a.midi - w.midi) - Math.abs(b.midi - w.midi))[0];
        const hand = nearest.refs[0].hand;
        const staff = hand === 'R' ? 'treble' : 'bass';
        const measure = pts[0].nl!.measure;
        const g = layout.yForMidi(measure, staff, w.midi);
        const gx = Math.max(...xs) + 22 + i * 20;
        const ledgers: number[] = [];
        if (g.line <= 0) for (let l = 0; l >= Math.ceil(g.line - 0.01) && l >= -8; l--) ledgers.push(l);
        if (g.line >= 6) for (let l = 6; l <= Math.floor(g.line + 0.01) && l <= 14; l++) ledgers.push(l);
        const held = snap.wrongHeld.includes(w.midi);
        els.push(
          <g key={`ghost-${i}-${w.midi}`} className={`ghost ${held ? 'held' : ''}`}>
            {ledgers.map((l) => (
              <line key={l} x1={gx - 10} x2={gx + 10} y1={layout.staffLineY(measure, staff, l)} y2={layout.staffLineY(measure, staff, l)} className="ghost-ledger" />
            ))}
            <ellipse cx={gx} cy={g.y} rx={6.2} ry={4.6} transform={`rotate(-22 ${gx} ${g.y})`} className="ghost-head" />
            {g.pitch.alter !== 0 && (
              <text x={gx - 15} y={g.y + 4} className="ghost-acc">{g.pitch.alter > 0 ? '♯' : '♭'}</text>
            )}
            <text x={gx} y={(staff === 'treble' ? layout.systems[pts[0].nl!.system].top - 36 : layout.systems[pts[0].nl!.system].bottom + 44) + i * 0} className="ghost-label" textAnchor="middle">
              {midiToName(w.midi, g.pitch.alter < 0)}
            </text>
          </g>,
        );
      });
    }
  }
  return <>{els}</>;
}
