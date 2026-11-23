import { useLayoutEffect, useMemo } from 'react';
import { isBlackKey, midiToName, MIDI_A0, MIDI_C8 } from '../../core/music/pitch';
import type { Hand } from '../../core/model/types';

export type KeyVisual = 'correct' | 'wrong' | 'held' | null;

export interface PianoProps {
  low?: number;
  high?: number;
  /** Keys expected now, with the hand that plays each */
  expected?: Map<number, Hand[]>;
  /** Expected keys that are already satisfied */
  satisfied?: Set<number>;
  /** Keys down right now (from real MIDI events) */
  held: number[];
  /** Score spelling of the expected keys (Bb instead of A#) */
  names?: Map<number, string>;
  wrong?: Set<number>;
  /** Faint preview of the next step */
  upcoming?: Set<number>;
  /** Heat-map intensity 0..1 per key (progress view) */
  heat?: Record<number, number>;
  labels: 'c-only' | 'all' | 'none';
  onRendered?: () => void;
  compact?: boolean;
}

/** Virtual piano. Its key states come only from MIDI events and the engine snapshot. */
export function Piano({ low = MIDI_A0, high = MIDI_C8, expected, names, satisfied, held, wrong, upcoming, heat, labels, onRendered, compact }: PianoProps) {
  useLayoutEffect(() => {
    onRendered?.();
  });
  const keys = useMemo(() => {
    let lo = low;
    let hi = high;
    while (isBlackKey(lo)) lo--;
    while (isBlackKey(hi)) hi++;
    const whites: number[] = [];
    for (let m = lo; m <= hi; m++) if (!isBlackKey(m)) whites.push(m);
    return { lo, hi, whites };
  }, [low, high]);
  const heldSet = new Set(held);
  const W = keys.whites.length;
  const whiteIndex = new Map(keys.whites.map((m, i) => [m, i]));

  const render = (m: number) => {
    const black = isBlackKey(m);
    const exp = expected?.get(m);
    const isHeld = heldSet.has(m);
    const isWrong = wrong?.has(m) && isHeld;
    const isSat = satisfied?.has(m);
    let state = '';
    if (isWrong) state = 'is-wrong';
    else if (isHeld && exp) state = 'is-correct';
    else if (isHeld) state = 'is-held';
    else if (isSat) state = 'is-correct-released';
    const handCls = exp ? (exp.length > 1 ? 'exp-both' : exp[0] === 'R' ? 'exp-r' : 'exp-l') : '';
    let style: React.CSSProperties;
    if (black) {
      const leftWhite = whiteIndex.get(m - 1)!;
      style = { left: `calc(${((leftWhite + 1) / W) * 100}% - var(--bk-w) / 2)` };
    } else {
      const i = whiteIndex.get(m)!;
      style = { left: `${(i / W) * 100}%`, width: `${100 / W}%` };
    }
    const h = heat?.[m];
    if (h !== undefined && h > 0) (style as Record<string, string>)['--heat'] = String(Math.min(1, h));
    const name = names?.get(m) ?? midiToName(m);
    const showLabel = !black && (labels === 'all' || (labels === 'c-only' && m % 12 === 0) || (!!exp && !compact));
    return (
      <div
        key={m}
        className={`key ${black ? 'black' : 'white'} ${state} ${handCls} ${upcoming?.has(m) && !exp ? 'upcoming' : ''} ${h ? 'heat' : ''}`}
        style={style}
        data-midi={m}
        title={name}
      >
        {exp && <span className="key-dot" />}
        {showLabel && <span className={`key-label ${exp ? 'strong' : ''}`}>{name}</span>}
        {black && exp && !compact && <span className="key-label black-label">{name}</span>}
      </div>
    );
  };

  return (
    <div className={`piano ${compact ? 'compact' : ''}`} style={{ ['--white-count' as string]: W }} role="img" aria-label="Virtual piano keyboard">
      <div className="piano-keys">
        {keys.whites.map(render)}
        {Array.from({ length: keys.hi - keys.lo + 1 }, (_, i) => keys.lo + i).filter(isBlackKey).map(render)}
      </div>
    </div>
  );
}
