/** Output level for each 4-bit amplitude: each step is 1/sqrt(2) (3 dB) of the next. */
export const AY_VOLUMES: readonly number[] = Array.from({ length: 16 }, (_, level) =>
  level === 0 ? 0 : Math.SQRT1_2 ** (15 - level),
);

/** Bits of each register that exist. */
const REGISTER_MASKS = [0xff, 0x0f, 0xff, 0x0f, 0xff, 0x0f, 0x1f, 0xff, 0x1f, 0x1f, 0x1f, 0xff, 0xff, 0x0f, 0xff, 0xff];
const REGISTERS = REGISTER_MASKS.length;
const NOISE_PERIOD = 6;
const ENABLES = 7;
const AMPLITUDE = 8;
const ENVELOPE_FINE = 11;
const ENVELOPE_COARSE = 12;
const ENVELOPE_SHAPE = 13;

/**
 * The General Instrument AY-3-8910: three square-wave tone channels, a noise
 * generator and an envelope. `tick` advances it by one step of its counters,
 * every 8 clocks; a tone with period P is a square wave with a period of 2P steps.
 */
export class Ay8910 {
  readonly registers = new Uint8Array(REGISTERS);
  readonly toneCounters = new Int32Array(3);
  readonly toneOutputs = new Uint8Array(3);
  noiseCounter = 0;
  /** 17-bit shift register; bit 0 is the noise output. */
  noiseShifter = 1;
  envelopeCounter = 0;
  /** 0-31 through the envelope's two halves, or -1 once it has stopped. */
  envelopeStep = 0;
  envelopeLevel = 0;

  reset(): void {
    this.registers.fill(0);
    this.toneCounters.fill(0);
    this.toneOutputs.fill(0);
    this.noiseCounter = 0;
    this.noiseShifter = 1;
    this.envelopeCounter = 0;
    this.envelopeStep = 0;
    this.envelopeLevel = 0;
  }

  read(register: number): number {
    return register < REGISTERS ? this.registers[register] : 0xff;
  }

  write(register: number, value: number): void {
    if (register >= REGISTERS) return;
    this.registers[register] = value & REGISTER_MASKS[register];
    if (register === ENVELOPE_SHAPE) {
      this.envelopeStep = 0;
      this.envelopeCounter = 0;
      this.envelopeLevel = this.registers[ENVELOPE_SHAPE] & 0x04 ? 0 : 15;
    }
  }

  /** A tone period of 0 counts as 1. */
  private tonePeriod(channel: number): number {
    return this.registers[channel * 2] | (this.registers[channel * 2 + 1] << 8) || 1;
  }

  /** The envelope steps every 2 x period counter steps. */
  private envelopePeriod(): number {
    return (this.registers[ENVELOPE_FINE] | (this.registers[ENVELOPE_COARSE] << 8) || 1) * 2;
  }

  /** The noise shifts every 2 x period steps. */
  private noisePeriod(): number {
    return (this.registers[NOISE_PERIOD] || 1) * 2;
  }

  /** Advances one counter step and returns the mixed level, 0 to 3. */
  tick(): number {
    const { toneCounters, toneOutputs, registers } = this;
    for (let channel = 0; channel < 3; channel++) {
      if (++toneCounters[channel] >= this.tonePeriod(channel)) {
        toneCounters[channel] = 0;
        toneOutputs[channel] ^= 1;
      }
    }
    if (++this.noiseCounter >= this.noisePeriod()) {
      this.noiseCounter = 0;
      const s = this.noiseShifter;
      this.noiseShifter = (s >> 1) ^ (s & 1 ? 0x10004 : 0);
    }
    if (++this.envelopeCounter >= this.envelopePeriod()) {
      this.envelopeCounter = 0;
      this.stepEnvelope();
    }

    const enables = registers[ENABLES];
    const noise = this.noiseShifter & 1;
    let level = 0;
    for (let channel = 0; channel < 3; channel++) {
      const tone = toneOutputs[channel] | ((enables >> channel) & 1);
      const noiseOn = noise | ((enables >> (channel + 3)) & 1);
      if (!(tone & noiseOn)) continue;
      const amplitude = registers[AMPLITUDE + channel];
      level += AY_VOLUMES[amplitude & 0x10 ? this.envelopeLevel : amplitude & 0x0f];
    }
    return level;
  }

  private stepEnvelope(): void {
    if (this.envelopeStep < 0) return;
    const shape = this.registers[ENVELOPE_SHAPE];
    const hold = shape & 0x01;
    const alternate = (shape >> 1) & 1;
    const attack = (shape >> 2) & 1;
    const repeat = (shape >> 3) & 1;
    const step = (this.envelopeStep + 1) & 31;
    if (step < 16) {
      this.envelopeLevel = attack ? step : 15 - step;
      this.envelopeStep = step;
    } else if (step === 16 && (!repeat || hold)) {
      this.envelopeLevel = repeat && attack !== alternate ? 15 : 0;
      this.envelopeStep = -1;
    } else if (step === 16 && !alternate) {
      this.envelopeLevel = attack ? 0 : 15;
      this.envelopeStep = 0;
    } else {
      this.envelopeLevel = attack ? 31 - step : step - 16;
      this.envelopeStep = step;
    }
  }
}
