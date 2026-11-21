/**
 * A WebAudio metronome that follows the practice engine's transport.
 * Clicks are scheduled ahead on the audio clock, so they don't drift with frame timing.
 */
import type { TransportInfo } from '../core/practice/types';

export class Metronome {
  private ctx: AudioContext | null = null;
  private lastScheduledBeat = -Infinity;
  private lastAnchor = '';

  private ensure() {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Unlock audio from a user gesture (browser autoplay policy) */
  unlock() {
    this.ensure();
  }

  /**
   * Call once per frame. It schedules clicks for beats that fall within the lookahead window.
   * @param beatTicks ticks per beat
   * @param beatsPerMeasure the downbeat is accented
   */
  update(tr: TransportInfo, beatTicks: number, beatsPerMeasure: number, enabled: boolean, nowPerf: number) {
    if (!enabled || tr.frozen || tr.ticksPerMs <= 0) {
      this.lastScheduledBeat = -Infinity;
      return;
    }
    const anchorKey = `${tr.anchorTick}|${tr.anchorTime}|${tr.ticksPerMs}`;
    if (anchorKey !== this.lastAnchor) {
      this.lastAnchor = anchorKey;
      // A re-anchor (resume, tempo change) restarts scheduling from now
      const curTick = tr.anchorTick + (nowPerf - tr.anchorTime) * tr.ticksPerMs;
      this.lastScheduledBeat = Math.ceil(curTick / beatTicks - 1e-6) - 1;
    }
    const ctx = this.ensure();
    const lookaheadMs = 120;
    const horizonTick = tr.anchorTick + (nowPerf + lookaheadMs - tr.anchorTime) * tr.ticksPerMs;
    const lastBeat = Math.floor(horizonTick / beatTicks);
    for (let b = this.lastScheduledBeat + 1; b <= lastBeat; b++) {
      const beatTime = tr.anchorTime + (b * beatTicks - tr.anchorTick) / tr.ticksPerMs;
      const delay = (beatTime - nowPerf) / 1000;
      if (delay < -0.02) continue;
      const accent = ((b % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure === 0;
      this.click(ctx, ctx.currentTime + Math.max(0, delay), accent);
    }
    this.lastScheduledBeat = Math.max(this.lastScheduledBeat, lastBeat);
  }

  private click(ctx: AudioContext, at: number, accent: boolean) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1175;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.28, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.08);
  }
}

export const metronome = new Metronome();
