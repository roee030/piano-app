import type { Exercise, Hand, DurationCode } from './types';
import { TICKS_PER_QUARTER, DURATION_TICKS } from './types';

const TYPE: Record<DurationCode, { type: string; dot: boolean }> = {
  w: { type: 'whole', dot: false },
  hd: { type: 'half', dot: true },
  h: { type: 'half', dot: false },
  qd: { type: 'quarter', dot: true },
  q: { type: 'quarter', dot: false },
  '8': { type: 'eighth', dot: false },
};

/** Serialize an exercise to MusicXML 4.0 partwise, as a single piano part on a grand staff. */
export function toMusicXML(ex: Exercise): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  lines.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  lines.push('<score-partwise version="4.0">');
  lines.push(`  <work><work-title>${esc(ex.title)}</work-title></work>`);
  lines.push('  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>');
  lines.push('  <part id="P1">');
  const mTicks = (ex.time.beats * TICKS_PER_QUARTER * 4) / ex.time.beatType;
  ex.measures.forEach((m, mi) => {
    lines.push(`    <measure number="${mi + 1}">`);
    if (mi === 0) {
      lines.push('      <attributes>');
      lines.push(`        <divisions>${TICKS_PER_QUARTER}</divisions>`);
      lines.push(`        <key><fifths>${ex.key.fifths}</fifths><mode>${ex.key.mode}</mode></key>`);
      lines.push(`        <time><beats>${ex.time.beats}</beats><beat-type>${ex.time.beatType}</beat-type></time>`);
      lines.push('        <staves>2</staves>');
      lines.push('        <clef number="1"><sign>G</sign><line>2</line></clef>');
      lines.push('        <clef number="2"><sign>F</sign><line>4</line></clef>');
      lines.push('      </attributes>');
    }
    const order: Hand[] = ['R', 'L'];
    order.forEach((hand, vi) => {
      const voice = m.voices[hand];
      const staff = hand === 'R' ? 1 : 2;
      if (vi > 0) lines.push(`      <backup><duration>${mTicks}</duration></backup>`);
      if (!voice) {
        lines.push(`      <note><rest measure="yes"/><duration>${mTicks}</duration><voice>${staff}</voice><staff>${staff}</staff></note>`);
        return;
      }
      for (const g of voice.groups) {
        const dur = DURATION_TICKS[g.duration];
        const t = TYPE[g.duration];
        const tail = `<duration>${dur}</duration><voice>${staff}</voice><type>${t.type}</type>${t.dot ? '<dot/>' : ''}<staff>${staff}</staff>`;
        if (g.pitches.length === 0) {
          lines.push(`      <note><rest/>${tail}</note>`);
          continue;
        }
        g.pitches.forEach((p, i) => {
          const alter = p.alter !== 0 ? `<alter>${p.alter}</alter>` : '';
          lines.push(`      <note>${i > 0 ? '<chord/>' : ''}<pitch><step>${p.step}</step>${alter}<octave>${p.octave}</octave></pitch>${tail}</note>`);
        });
      }
    });
    lines.push('    </measure>');
  });
  lines.push('  </part>');
  lines.push('</score-partwise>');
  return lines.join('\n');
}
