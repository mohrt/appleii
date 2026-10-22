import type { Mockingboard } from './mockingboard';

/** The AY-3-8910's counters step every 8 of its clocks, which on the Mockingboard is the CPU clock. */
const AY_CYCLES_PER_TICK = 8;
const SPEAKER_GAIN = 0.25;
/** All three channels of one AY at full volume. */
const AY_GAIN = 0.5 / 3;
/** How much of each AY goes to the other side, so headphones aren't hard left and right. */
const AY_CROSSFEED = 0.25;
/** A gentle high-pass that takes away DC (the speaker cone left pushed out, the AYs' offset). */
const DC_BLOCK = 0.995;

/**
 * Turns the speaker's clicks and the Mockingboard into stereo samples at the
 * audio device's rate. The speaker toggles whenever $C030 is touched; each
 * sample averages its position over the cycles the sample covers. The
 * Mockingboard's two AYs go left and right.
 */
export class AudioMixer {
  speakerLevel = -1;
  /** Cycle up to which samples have been made. */
  lastCycle = 0;
  private cyclesPerSample = 1_020_484 / 48_000;
  private sampleEnd = this.cyclesPerSample;
  private speakerSum = 0;
  private ayPhase = 0;
  private aySums = [0, 0];
  private ayTicks = 0;
  private lastIn = [0, 0];
  private lastOut = [0, 0];
  private buffer = new Float32Array(8192);
  private length = 0;
  mockingboard: Mockingboard | null = null;

  setRates(clockHz: number, sampleRate: number): void {
    this.cyclesPerSample = clockHz / sampleRate;
    this.sampleEnd = this.lastCycle + this.cyclesPerSample;
  }

  /** Restarts at `cycle` (after a reset or loading a state). */
  resync(cycle: number): void {
    this.lastCycle = cycle;
    this.sampleEnd = cycle + this.cyclesPerSample;
    this.speakerSum = this.ayPhase = this.ayTicks = 0;
    this.aySums = [0, 0];
  }

  toggleSpeaker(cycle: number): void {
    this.run(cycle);
    this.speakerLevel = -this.speakerLevel;
  }

  /** Makes the samples up to `cycle`. */
  run(cycle: number): void {
    if (cycle <= this.lastCycle) return;
    while (this.sampleEnd <= cycle) {
      this.advance(this.sampleEnd);
      this.emit();
      this.sampleEnd += this.cyclesPerSample;
    }
    this.advance(cycle);
  }

  private advance(cycle: number): void {
    const span = cycle - this.lastCycle;
    this.speakerSum += this.speakerLevel * span;
    const board = this.mockingboard;
    if (board) {
      this.ayPhase += span;
      while (this.ayPhase >= AY_CYCLES_PER_TICK) {
        this.ayPhase -= AY_CYCLES_PER_TICK;
        this.aySums[0] += board.chips[0].ay.tick();
        this.aySums[1] += board.chips[1].ay.tick();
        this.ayTicks++;
      }
    }
    this.lastCycle = cycle;
  }

  private emit(): void {
    const speaker = (this.speakerSum / this.cyclesPerSample) * SPEAKER_GAIN;
    let left = speaker;
    let right = speaker;
    if (this.ayTicks > 0) {
      const a = (this.aySums[0] / this.ayTicks) * AY_GAIN;
      const b = (this.aySums[1] / this.ayTicks) * AY_GAIN;
      left += a + b * AY_CROSSFEED;
      right += b + a * AY_CROSSFEED;
    }
    this.speakerSum = 0;
    this.aySums[0] = this.aySums[1] = 0;
    this.ayTicks = 0;
    if (this.length + 2 > this.buffer.length) {
      const bigger = new Float32Array(this.buffer.length * 2);
      bigger.set(this.buffer);
      this.buffer = bigger;
    }
    this.buffer[this.length++] = this.filter(0, left);
    this.buffer[this.length++] = this.filter(1, right);
  }

  private filter(side: number, value: number): number {
    const out = value - this.lastIn[side] + DC_BLOCK * this.lastOut[side];
    this.lastIn[side] = value;
    this.lastOut[side] = out;
    return out;
  }

  /** The samples made since the last call, interleaved left and right. */
  takeSamples(): Float32Array {
    const samples = this.buffer.slice(0, this.length);
    this.length = 0;
    return samples;
  }
}
