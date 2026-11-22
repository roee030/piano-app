/**
 * Music Notation Renderer. It engraves an Exercise with VexFlow on a grand staff and
 * returns a layout map (the x/y of every notehead), so the feedback overlay is
 * placed from the musical data and never from guessed positions.
 */
import { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Beam, Dot, StaveConnector, Flow, Fraction } from 'vexflow';
import type { Exercise, Hand, NoteGroup, StaffId } from '../../core/model/types';
import { measureTicks } from '../../core/model/types';
import { computeDisplayAccidentals } from '../../core/model/notation';
import { vexKeySignature, spellChromatic } from '../../core/music/keys';
import { Pitch, pitchToMidi } from '../../core/music/pitch';
import { beatTicks } from '../../core/generator/generator';

export interface NoteLayout {
  groupId: string;
  hand: Hand;
  staff: StaffId;
  measure: number;
  system: number;
  /** Center x of the notehead */
  x: number;
  /** y for each pitch, indexed like group.pitches */
  ys: number[];
  /** Absolute tick */
  tick: number;
}

export interface MeasureLayout {
  index: number;
  system: number;
  x: number;
  width: number;
  noteStartX: number;
  endX: number;
}

export interface SystemLayout {
  index: number;
  /** Top of the treble staff's first line */
  top: number;
  /** Bottom of the bass staff's last line */
  bottom: number;
  trebleLines: [number, number];
  bassLines: [number, number];
  /** (tick, x) anchors, used to move the rhythm cursor smoothly */
  anchors: { tick: number; x: number }[];
  startTick: number;
  endTick: number;
}

export interface ScoreLayout {
  /** Drawing scale actually used (may be below the requested one so the chosen measures per line fit). */
  scale: number;
  width: number;
  height: number;
  notes: Map<string, NoteLayout>;
  measures: MeasureLayout[];
  systems: SystemLayout[];
  /** y of an arbitrary MIDI note on a staff in a measure (for wrong-note ghosts) */
  yForMidi: (measure: number, staff: StaffId, midi: number) => { y: number; line: number; pitch: Pitch };
  staffLineY: (measure: number, staff: StaffId, line: number) => number;
}

const VEX_DUR: Record<string, string> = { w: 'w', hd: 'hd', h: 'h', qd: 'qd', q: 'q', '8': '8' };
const SYSTEM_HEIGHT = 250;
const MIN_SCALE = 0.72;
const BASS_OFFSET = 105;
const TOP_PAD = 10;

function vexKey(p: Pitch) {
  const acc = p.alter === 1 ? '#' : p.alter === -1 ? 'b' : p.alter === 2 ? '##' : p.alter === -2 ? 'bb' : '';
  return `${p.step.toLowerCase()}${acc}/${p.octave}`;
}

export function renderScore(
  container: HTMLDivElement,
  ex: Exercise,
  opts: { width: number; dimHands: Hand[]; inkColor: string; dimColor: string; scale?: number },
): ScoreLayout {
  container.replaceChildren();
  const accidentals = computeDisplayAccidentals(ex);
  const mTicks = measureTicks(ex.time);
  const keySig = vexKeySignature(ex.key);
  const keyWidth = 12 + Math.abs(ex.key.fifths) * 10;

  // ---- line breaking
  const minWidth = ex.measures.map((m) => {
    const counts = (['R', 'L'] as Hand[]).map((h) => m.voices[h]?.groups.length ?? 1);
    const accs = [...accidentals.keys()].filter((k) => k.startsWith(`m${m.index}-`)).length;
    return 64 + Math.max(...counts) * 30 + accs * 8;
  });
  const margin = 14;
  const perLine = Math.max(1, ex.config?.measuresPerLine ?? 4);

  // Shrink the drawing (down to MIN_SCALE) so the chosen number of measures
  // fits on each line; only if it still doesn't fit does a line wrap early.
  let needed = 0;
  for (let i = 0; i < ex.measures.length; i += perLine) {
    const chunk = minWidth.slice(i, i + perLine).reduce((a, b) => a + b, 0);
    needed = Math.max(needed, chunk + 45 + keyWidth + (i === 0 ? 30 : 0) + margin * 2);
  }
  const requested = opts.scale ?? 1;
  const scale = Math.min(requested, Math.max(MIN_SCALE, opts.width / needed));
  const width = Math.max(320, opts.width / scale);
  const usable = width - margin * 2;
  // Lines hold `perLine` measures each; a group that is still too wide at the
  // minimum scale is split, without shifting the groups after it.
  const lines: number[][] = [];
  for (let start = 0; start < ex.measures.length; start += perLine) {
    let cur: number[] = [];
    let curW = 0;
    for (let i = start; i < Math.min(start + perLine, ex.measures.length); i++) {
      const w = minWidth[i] + (cur.length === 0 ? 45 + keyWidth + (lines.length === 0 ? 30 : 0) : 0);
      if (cur.length > 0 && curW + w > usable) {
        lines.push(cur);
        cur = [];
        curW = 45 + keyWidth + minWidth[i];
        cur.push(i);
        continue;
      }
      cur.push(i);
      curW += w;
    }
    if (cur.length) lines.push(cur);
  }

  const height = TOP_PAD + lines.length * SYSTEM_HEIGHT + 10;
  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(width * scale, height * scale);
  const ctx = renderer.getContext();
  ctx.scale(scale, scale);
  ctx.setFillStyle(opts.inkColor);
  ctx.setStrokeStyle(opts.inkColor);

  const notes = new Map<string, NoteLayout>();
  const measures: MeasureLayout[] = [];
  const systems: SystemLayout[] = [];
  const staves = new Map<string, Stave>();
  const beatGroup = new Fraction(beatTicks(ex.time), 16);

  lines.forEach((line, si) => {
    const y = TOP_PAD + si * SYSTEM_HEIGHT;
    // Share the space out in proportion to each measure's minimum width
    const extras = 45 + keyWidth + (si === 0 ? 30 : 0);
    const totalMin = line.reduce((a, i) => a + minWidth[i], 0);
    const isLastLine = si === lines.length - 1;
    const stretch = isLastLine && totalMin + extras < usable * 0.6 ? 1 : (usable - extras) / totalMin;
    let x = margin;
    const anchors: { tick: number; x: number }[] = [];
    let trebleFirst: Stave | null = null;
    let bassFirst: Stave | null = null;

    line.forEach((mi, li) => {
      const m = ex.measures[mi];
      const w = minWidth[mi] * stretch + (li === 0 ? extras : 0);
      const treble = new Stave(x, y, w);
      const bass = new Stave(x, y + BASS_OFFSET, w);
      if (li === 0) {
        treble.addClef('treble').addKeySignature(keySig);
        bass.addClef('bass').addKeySignature(keySig);
        if (si === 0) {
          treble.addTimeSignature(`${ex.time.beats}/${ex.time.beatType}`);
          bass.addTimeSignature(`${ex.time.beats}/${ex.time.beatType}`);
        }
      }
      const startX = Math.max(treble.getNoteStartX(), bass.getNoteStartX());
      treble.setNoteStartX(startX);
      bass.setNoteStartX(startX);
      treble.setContext(ctx).draw();
      bass.setContext(ctx).draw();
      staves.set(`${mi}-treble`, treble);
      staves.set(`${mi}-bass`, bass);
      if (li === 0) {
        trebleFirst = treble;
        bassFirst = bass;
        new StaveConnector(treble, bass).setType('brace').setContext(ctx).draw();
        new StaveConnector(treble, bass).setType('singleLeft').setContext(ctx).draw();
      }
      const isFinal = mi === ex.measures.length - 1;
      new StaveConnector(treble, bass).setType(isFinal ? 'boldDoubleRight' : 'singleRight').setContext(ctx).draw();

      // ---- voices
      const vfVoices: Voice[] = [];
      const allBeams: Beam[] = [];
      const placed: { g: NoteGroup; hand: Hand; staff: StaffId; note: StaveNote; order: number[] }[] = [];
      for (const hand of ['R', 'L'] as Hand[]) {
        const staffId: StaffId = hand === 'R' ? 'treble' : 'bass';
        const clef = staffId;
        const v = m.voices[hand];
        const voice = new Voice({ num_beats: ex.time.beats, beat_value: ex.time.beatType }).setMode(Voice.Mode.SOFT);
        const vNotes: StaveNote[] = [];
        if (!v) {
          const rest = new StaveNote({ keys: [clef === 'treble' ? 'b/4' : 'd/3'], duration: 'wr', clef, align_center: true });
          vNotes.push(rest);
        } else {
          for (const g of v.groups) {
            if (g.pitches.length === 0) {
              const rest = new StaveNote({ keys: [clef === 'treble' ? 'b/4' : 'd/3'], duration: VEX_DUR[g.duration] + 'r', clef });
              if (g.duration.endsWith('d')) Dot.buildAndAttach([rest], { all: true });
              vNotes.push(rest);
              continue;
            }
            // Sort the pitches low to high for VexFlow, keeping a map back to the original indexes
            const order = g.pitches.map((_, i) => i).sort((a, b) => pitchToMidi(g.pitches[a]) - pitchToMidi(g.pitches[b]));
            const note = new StaveNote({ keys: order.map((i) => vexKey(g.pitches[i])), duration: VEX_DUR[g.duration], clef, auto_stem: true });
            order.forEach((orig, sortedIdx) => {
              const acc = accidentals.get(`${g.id}:${orig}`);
              if (acc) note.addModifier(new Accidental(acc), sortedIdx);
            });
            if (g.duration.endsWith('d')) Dot.buildAndAttach([note], { all: true });
            if (opts.dimHands.includes(hand)) note.setStyle({ fillStyle: opts.dimColor, strokeStyle: opts.dimColor });
            note.setAttribute('id', `n-${g.id}`);
            vNotes.push(note);
            placed.push({ g, hand, staff: staffId, note, order });
          }
        }
        voice.addTickables(vNotes);
        const beams = Beam.generateBeams(vNotes.filter((n) => !n.isRest()), { groups: [beatGroup] });
        allBeams.push(...beams);
        vfVoices.push(voice);
        voice.setStave(hand === 'R' ? treble : bass);
      }
      const fmt = new Formatter();
      vfVoices.forEach((vv) => fmt.joinVoices([vv]));
      fmt.format(vfVoices, Math.max(40, treble.getNoteEndX() - startX - 14));
      vfVoices[0].draw(ctx, treble);
      vfVoices[1].draw(ctx, bass);
      allBeams.forEach((b) => b.setContext(ctx).draw());

      const measureStartTick = mi * mTicks;
      anchors.push({ tick: measureStartTick, x: startX - 4 });
      const groupAnchors = new Map<number, number>();
      for (const p of placed) {
        const cx = (p.note.getNoteHeadBeginX() + p.note.getNoteHeadEndX()) / 2;
        const sortedYs = p.note.getYs();
        const ys: number[] = [];
        p.order.forEach((orig, sortedIdx) => (ys[orig] = sortedYs[sortedIdx]));
        const tick = measureStartTick + p.g.startTick;
        notes.set(p.g.id, { groupId: p.g.id, hand: p.hand, staff: p.staff, measure: mi, system: si, x: cx, ys, tick });
        if (!groupAnchors.has(tick)) groupAnchors.set(tick, cx);
        else groupAnchors.set(tick, Math.min(groupAnchors.get(tick)!, cx));
      }
      [...groupAnchors.entries()].sort((a, b) => a[0] - b[0]).forEach(([tick, ax]) => anchors.push({ tick, x: ax }));
      measures.push({ index: mi, system: si, x, width: w, noteStartX: startX, endX: x + w });
      x += w;
    });

    const t0 = trebleFirst as unknown as Stave;
    const b0 = bassFirst as unknown as Stave;
    const lastM = line[line.length - 1];
    anchors.push({ tick: (lastM + 1) * mTicks, x: x - 6 });
    anchors.sort((a, b) => a.tick - b.tick);
    systems.push({
      index: si,
      top: t0.getYForLine(0),
      bottom: b0.getYForLine(4),
      trebleLines: [t0.getYForLine(0), t0.getYForLine(4)],
      bassLines: [b0.getYForLine(0), b0.getYForLine(4)],
      anchors,
      startTick: line[0] * mTicks,
      endTick: (lastM + 1) * mTicks,
    });
  });

  const yForMidi = (measure: number, staff: StaffId, midi: number) => {
    const stave = staves.get(`${measure}-${staff}`) ?? staves.get(`0-${staff}`)!;
    const pitch = spellChromatic(midi, ex.key, ex.key.fifths < 0);
    const props = Flow.keyProperties(vexKey(pitch), staff) as { line: number };
    return { y: stave.getYForNote(props.line), line: props.line, pitch };
  };
  const staffLineY = (measure: number, staff: StaffId, line: number) => {
    const stave = staves.get(`${measure}-${staff}`) ?? staves.get(`0-${staff}`)!;
    return stave.getYForNote(line);
  };

  return { scale, width, height, notes, measures, systems, yForMidi, staffLineY };
}

/** x position of a transport tick within a system (linear between anchors). */
export function xForTick(sys: SystemLayout, tick: number): number {
  const a = sys.anchors;
  if (tick <= a[0].tick) return a[0].x;
  for (let i = 1; i < a.length; i++) {
    if (tick <= a[i].tick) {
      const p = a[i - 1];
      const q = a[i];
      const f = q.tick === p.tick ? 0 : (tick - p.tick) / (q.tick - p.tick);
      return p.x + f * (q.x - p.x);
    }
  }
  return a[a.length - 1].x;
}
