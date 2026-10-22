const REG_ORB = 0x0;
const REG_ORA = 0x1;
const REG_DDRB = 0x2;
const REG_DDRA = 0x3;
const REG_T1C_LO = 0x4;
const REG_T1C_HI = 0x5;
const REG_T1L_LO = 0x6;
const REG_T1L_HI = 0x7;
const REG_T2C_LO = 0x8;
const REG_T2C_HI = 0x9;
const REG_SR = 0xa;
const REG_ACR = 0xb;
const REG_PCR = 0xc;
const REG_IFR = 0xd;
const REG_IER = 0xe;
const REG_ORA_NO_HANDSHAKE = 0xf;

export const VIA_IRQ_CA2 = 0x01;
export const VIA_IRQ_CA1 = 0x02;
export const VIA_IRQ_CB2 = 0x08;
export const VIA_IRQ_CB1 = 0x10;
export const VIA_IRQ_T2 = 0x20;
export const VIA_IRQ_T1 = 0x40;
const IRQ_ANY = 0x80;

const ACR_PA_LATCH = 0x01;
const ACR_PB_LATCH = 0x02;
const ACR_T1_FREE_RUN = 0x40;
const PCR_CA1_POSITIVE = 0x01;
const PCR_CB1_POSITIVE = 0x10;
/** CA2/CB2 control value for "manual output high". */
const CONTROL_MANUAL_HIGH = 0b111;
const CONTROL_MANUAL_LOW = 0b110;

export interface ViaPorts {
  /** External pin levels; lines nobody drives should read 1. */
  readPortA?: () => number;
  readPortB?: () => number;
  /** Called after a write that may have changed the port outputs. */
  onOutputChange?: () => void;
}

/**
 * MOS 6522 Versatile Interface Adapter, as used twice on the Mockingboard. Covers the
 * ports with input latching, both timers, the interrupt registers, and CA1/CB1
 * edges plus CA2/CB2 manual outputs. The shift register only stores its value.
 */
export class Via6522 {
  private orb = 0;
  private ora = 0;
  private ddrb = 0;
  private ddra = 0;
  private paLatch = 0xff;
  private pbLatch = 0xff;
  private t1Counter = 0xffff;
  private t1Latch = 0xffff;
  private t1Armed = false;
  private t2Counter = 0xffff;
  private t2LatchLow = 0xff;
  private t2Armed = false;
  private shift = 0;
  private acr = 0;
  private pcr = 0;
  private ifr = 0;
  private ier = 0;
  private ca1 = true;
  private cb1 = true;

  constructor(private readonly ports: ViaPorts = {}) {}

  reset(): void {
    this.orb = this.ora = this.ddrb = this.ddra = 0;
    this.t1Armed = this.t2Armed = false;
    this.acr = this.pcr = this.ifr = this.ier = 0;
    this.shift = 0;
    this.ports.onOutputChange?.();
  }

  get irq(): boolean {
    return (this.ifr & this.ier & 0x7f) !== 0;
  }

  /** Port levels driven by the VIA; input lines float high. */
  get portAOutput(): number {
    return (this.ora | ~this.ddra) & 0xff;
  }

  get portBOutput(): number {
    return (this.orb | ~this.ddrb) & 0xff;
  }

  get ca2High(): boolean {
    return ((this.pcr >> 1) & 0x07) === CONTROL_MANUAL_HIGH;
  }

  get cb2High(): boolean {
    return ((this.pcr >> 5) & 0x07) === CONTROL_MANUAL_HIGH;
  }

  get cb2Low(): boolean {
    return ((this.pcr >> 5) & 0x07) === CONTROL_MANUAL_LOW;
  }

  /** Drives the CA1 input; the selected edge sets the CA1 flag and latches port A. */
  setCa1(level: boolean): void {
    if (level === this.ca1) return;
    this.ca1 = level;
    if (level === ((this.pcr & PCR_CA1_POSITIVE) !== 0)) {
      if (this.acr & ACR_PA_LATCH) this.paLatch = this.readPinsA();
      this.ifr |= VIA_IRQ_CA1;
    }
  }

  setCb1(level: boolean): void {
    if (level === this.cb1) return;
    this.cb1 = level;
    if (level === ((this.pcr & PCR_CB1_POSITIVE) !== 0)) {
      if (this.acr & ACR_PB_LATCH) this.pbLatch = this.readPinsB();
      this.ifr |= VIA_IRQ_CB1;
    }
  }

  /** A pulse on CA1 of the selected polarity, e.g. the 1541's BYTE READY. */
  pulseCa1(): void {
    const active = (this.pcr & PCR_CA1_POSITIVE) !== 0;
    this.setCa1(!active);
    this.setCa1(active);
  }

  tick(cycles: number): void {
    this.tickTimer1(cycles);
    this.tickTimer2(cycles);
  }

  read(register: number): number {
    switch (register & 0x0f) {
      case REG_ORB:
        this.ifr &= ~(VIA_IRQ_CB1 | VIA_IRQ_CB2);
        return this.readPortB();
      case REG_ORA:
        this.ifr &= ~(VIA_IRQ_CA1 | VIA_IRQ_CA2);
        return this.readPortA();
      case REG_ORA_NO_HANDSHAKE:
        return this.readPortA();
      case REG_DDRB:
        return this.ddrb;
      case REG_DDRA:
        return this.ddra;
      case REG_T1C_LO:
        this.ifr &= ~VIA_IRQ_T1;
        return this.t1Value & 0xff;
      case REG_T1C_HI:
        return this.t1Value >> 8;
      case REG_T1L_LO:
        return this.t1Latch & 0xff;
      case REG_T1L_HI:
        return this.t1Latch >> 8;
      case REG_T2C_LO:
        this.ifr &= ~VIA_IRQ_T2;
        return this.t2Counter & 0xff;
      case REG_T2C_HI:
        return this.t2Counter >> 8;
      case REG_SR:
        return this.shift;
      case REG_ACR:
        return this.acr;
      case REG_PCR:
        return this.pcr;
      case REG_IFR:
        return this.ifr | (this.irq ? IRQ_ANY : 0);
      case REG_IER:
      default:
        return this.ier | IRQ_ANY;
    }
  }

  write(register: number, value: number): void {
    switch (register & 0x0f) {
      case REG_ORB:
        this.orb = value;
        this.ifr &= ~(VIA_IRQ_CB1 | VIA_IRQ_CB2);
        this.ports.onOutputChange?.();
        break;
      case REG_ORA:
        this.ifr &= ~(VIA_IRQ_CA1 | VIA_IRQ_CA2);
        this.ora = value;
        this.ports.onOutputChange?.();
        break;
      case REG_ORA_NO_HANDSHAKE:
        this.ora = value;
        this.ports.onOutputChange?.();
        break;
      case REG_DDRB:
        this.ddrb = value;
        this.ports.onOutputChange?.();
        break;
      case REG_DDRA:
        this.ddra = value;
        this.ports.onOutputChange?.();
        break;
      case REG_T1C_LO:
      case REG_T1L_LO:
        this.t1Latch = (this.t1Latch & 0xff00) | value;
        break;
      case REG_T1C_HI:
        this.t1Latch = (this.t1Latch & 0x00ff) | (value << 8);
        this.t1Counter = this.t1Latch;
        this.ifr &= ~VIA_IRQ_T1;
        this.t1Armed = true;
        break;
      case REG_T1L_HI:
        this.t1Latch = (this.t1Latch & 0x00ff) | (value << 8);
        this.ifr &= ~VIA_IRQ_T1;
        break;
      case REG_T2C_LO:
        this.t2LatchLow = value;
        break;
      case REG_T2C_HI:
        this.t2Counter = this.t2LatchLow | (value << 8);
        this.ifr &= ~VIA_IRQ_T2;
        this.t2Armed = true;
        break;
      case REG_SR:
        this.shift = value;
        break;
      case REG_ACR:
        this.acr = value;
        break;
      case REG_PCR:
        this.pcr = value;
        this.ports.onOutputChange?.();
        break;
      case REG_IFR:
        this.ifr &= ~value & 0x7f;
        break;
      case REG_IER:
      default:
        if (value & IRQ_ANY) this.ier |= value & 0x7f;
        else this.ier &= ~value & 0x7f;
    }
  }

  private readPinsA(): number {
    return this.portAOutput & (this.ports.readPortA?.() ?? 0xff);
  }

  private readPinsB(): number {
    return this.portBOutput & (this.ports.readPortB?.() ?? 0xff);
  }

  /** Port A reads the pins (or the CA1 latch); port B reads output bits from ORB. */
  private readPortA(): number {
    return this.acr & ACR_PA_LATCH ? this.paLatch : this.readPinsA();
  }

  private readPortB(): number {
    const pins = this.acr & ACR_PB_LATCH ? this.pbLatch : this.readPinsB();
    return (this.orb & this.ddrb) | (pins & ~this.ddrb & 0xff);
  }

  /**
   * T1 counts down every cycle. In free-running mode it reloads from the latch
   * after passing $FFFF, giving a period of latch + 2 cycles.
   */
  private tickTimer1(cycles: number): void {
    if (cycles <= 0) return;
    if (this.acr & ACR_T1_FREE_RUN) {
      // t1Counter is -1 for the cycle spent at $FFFF just after an underflow.
      const untilUnderflow = this.t1Counter < 0 ? this.t1Latch + 2 : this.t1Counter + 1;
      if (cycles < untilUnderflow) {
        this.t1Counter = this.t1Counter < 0 ? this.t1Latch - (cycles - 1) : this.t1Counter - cycles;
        return;
      }
      const sinceUnderflow = (cycles - untilUnderflow) % (this.t1Latch + 2);
      this.t1Counter = sinceUnderflow === 0 ? -1 : this.t1Latch - (sinceUnderflow - 1);
      this.ifr |= VIA_IRQ_T1;
      return;
    }
    const next = (this.t1Counter < 0 ? 0xffff : this.t1Counter) - cycles;
    if (next < 0 && this.t1Armed) {
      this.ifr |= VIA_IRQ_T1;
      this.t1Armed = false;
    }
    this.t1Counter = ((next % 0x10000) + 0x10000) % 0x10000;
  }

  private get t1Value(): number {
    return this.t1Counter < 0 ? 0xffff : this.t1Counter;
  }

  /** T2 is one-shot: it interrupts once, then keeps counting down through $FFFF. */
  private tickTimer2(cycles: number): void {
    const next = this.t2Counter - cycles;
    if (next < 0 && this.t2Armed) {
      this.ifr |= VIA_IRQ_T2;
      this.t2Armed = false;
    }
    this.t2Counter = ((next % 0x10000) + 0x10000) % 0x10000;
  }
}
