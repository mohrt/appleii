import { Ay8910 } from './ay8910';
import { Via6522 } from './via6522';

/** Port B's low bits drive the AY's bus control lines: /RESET, BDIR and BC1. */
const NOT_RESET = 0x04;
const LATCH_ADDRESS = 0x07;
const WRITE_DATA = 0x06;
const READ_DATA = 0x05;

/** One VIA and the AY-3-8910 on its ports. */
class SoundChip {
  readonly ay = new Ay8910();
  readonly via: Via6522;
  address = 0;
  control = NOT_RESET;

  constructor() {
    this.via = new Via6522({
      readPortA: () => (this.control === READ_DATA ? this.ay.read(this.address) : 0xff),
      onOutputChange: () => this.busChanged(),
    });
  }

  private busChanged(): void {
    const control = this.via.portBOutput & 0x07;
    if (control === this.control) return;
    this.control = control;
    if (!(control & NOT_RESET)) this.ay.reset();
    else if (control === LATCH_ADDRESS) this.address = this.via.portAOutput & 0x0f;
    else if (control === WRITE_DATA) this.ay.write(this.address, this.via.portAOutput);
  }
}

/**
 * Sweet Micro Systems' Mockingboard: two AY-3-8910 sound chips, each driven
 * through a 6522 VIA whose timers interrupt the CPU (music players run off
 * them). The first VIA answers at $Cn00-$Cn7F, the second at $Cn80-$CnFF.
 */
export class Mockingboard {
  readonly chips = [new SoundChip(), new SoundChip()];
  /** Cycle up to which the VIAs' timers have run. */
  lastCycle = 0;

  reset(): void {
    for (const chip of this.chips) {
      chip.via.reset();
      chip.ay.reset();
    }
  }

  catchUp(cycle: number): void {
    const elapsed = cycle - this.lastCycle;
    if (elapsed <= 0) return;
    this.lastCycle = cycle;
    for (const chip of this.chips) chip.via.tick(elapsed);
  }

  get irq(): boolean {
    return this.chips[0].via.irq || this.chips[1].via.irq;
  }

  /** An access to the card's ROM space: `value` is what was written, or null for a read. */
  access(offset: number, value: number | null, cycle: number): number {
    this.catchUp(cycle);
    const via = this.chips[offset & 0x80 ? 1 : 0].via;
    if (value === null) return via.read(offset & 0x0f);
    via.write(offset & 0x0f, value);
    return value;
  }
}
