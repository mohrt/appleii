import { Cpu6502, type CpuBus } from './cpu/cpu6502';
import { Disk2 } from './disk/disk2';
import type { FloppyDisk } from './disk/floppy';
import { AudioMixer } from './sound/audio-mixer';
import { Mockingboard } from './sound/mockingboard';
import { captureState, restoreState, type StateNode } from './state/snapshot';
import { CYCLES_PER_FRAME, CYCLES_PER_LINE, SCREEN_LINES, Video, VideoSwitches } from './video/video';

/** 14.31818 MHz / 14, with every 65th cycle stretched by two 14M ticks. */
export const CLOCK_HZ = 1_020_484;
export const DISK_SLOT = 6;
export const MOCKINGBOARD_SLOT = 4;
/** Each count of a paddle's value holds its timer for about 11 µs. */
const PADDLE_CYCLES_PER_UNIT = 11;
export const PADDLE_CENTRE = 127;

/** The Apple II (with Integer BASIC), the Apple II Plus (with Applesoft), the Apple IIe or the Apple IIc. */
export type Model = 'ii' | 'iiplus' | 'iie' | 'iic';

export interface Roms {
  /**
   * The IIe's 16K for $C000-$FFFF (its internal firmware at $C100-$CFFF, then
   * Applesoft and the Monitor), the IIc's 16K or two 16K banks of that, or the
   * II and II Plus's 12K for $D000-$FFFF.
   */
  main: Uint8Array;
  /** The video ROM's character shapes: the IIe's 4K, or the II and II Plus's 2K. */
  video: Uint8Array;
  /** The Disk II controller's 256-byte boot ROM. */
  disk: Uint8Array;
}

const IIE_ROM_SIZE = 0x4000;
const VBL_START_CYCLE = SCREEN_LINES * CYCLES_PER_LINE;

/** The enhanced IIe's Monitor has $E0 at $FBC0 (the original has $EA); it runs on a 65C02. */
export function isEnhancedRom(main: Uint8Array): boolean {
  return main.length === IIE_ROM_SIZE && main[0xfbc0 - 0xc000] === 0xe0;
}

/**
 * A main ROM as the $C000-$FFFF images the memory map reads: the II's and II
 * Plus's start at $D000, and the later IIc's 32K is two banks.
 */
function romBanks(main: Uint8Array): Uint8Array[] {
  if (main.length === IIE_ROM_SIZE) return [main];
  if (main.length === IIE_ROM_SIZE * 2) return [main.subarray(0, IIE_ROM_SIZE), main.subarray(IIE_ROM_SIZE)];
  const image = new Uint8Array(IIE_ROM_SIZE);
  image.set(main, IIE_ROM_SIZE - main.length);
  return [image];
}

/** Every IIc has a 65C02; so has the enhanced IIe. */
const cpuFor = (main: Uint8Array, model: Model) => (model === 'iic' || isEnhancedRom(main) ? 'cmos' : 'nmos');

/** The IIe's memory soft switches (the MMU) and the language card (the II and II Plus's, in slot 0). */
class MemorySwitches {
  ramRd = false;
  ramWrt = false;
  altZp = false;
  intCxRom = false;
  slotC3Rom = false;
  /** The internal ROM is at $C800-$CFFF (after $C3xx was read with the internal $C3 ROM). */
  intC8Rom = false;
  lcBank2 = true;
  lcReadRam = false;
  lcWrite = true;
  lcPrewrite = false;
}

/**
 * An Apple IIe: 6502 (or 65C02 for the enhanced IIe), 64K of main RAM and
 * the extended 80-column card's 64K of auxiliary RAM, the MMU and IOU soft
 * switches, the keyboard, the game port, the speaker, a Disk II controller in
 * slot 6 and optionally a Mockingboard in slot 4. As an Apple II or II Plus
 * it has 48K and a 16K language card instead, and none of the IIe's
 * additions: no auxiliary memory, 80 columns, double graphics or lowercase.
 */
export class Apple2 implements CpuBus {
  readonly main = new Uint8Array(0x10000);
  readonly aux = new Uint8Array(0x10000);
  rom: Uint8Array;
  private romBanks: Uint8Array[];
  /** Which of the 32K IIc ROM's banks is in ($C028 switches). */
  romBank = 0;
  /** The IIc's IOUDIS switch ($C07E on, $C07F off). */
  iouDisabled = false;
  /** When $C070 last cleared the IIc's vertical blank flag. */
  vblClearedAt = 0;
  readonly video: Video;
  readonly videoSwitches = new VideoSwitches();
  readonly memory = new MemorySwitches();
  readonly cpu: Cpu6502;
  readonly disk2: Disk2;
  readonly mockingboard = new Mockingboard();
  readonly audio = new AudioMixer();
  mockingboardOn = true;
  cycles = 0;

  // Keyboard and game port
  keyLatch = 0;
  keyStrobe = false;
  /** Set by the input code: whether any key is held (read at $C010). */
  anyKeyDown = false;
  /** Open Apple, Closed Apple (and the shift key mod) as pushbuttons 0-2. */
  readonly buttons = [false, false, false];
  /** The paddles (a joystick is paddles 0 and 1), 0-255. */
  readonly paddles = [PADDLE_CENTRE, PADDLE_CENTRE, PADDLE_CENTRE, PADDLE_CENTRE];
  paddleTriggered = -1_000_000;
  /** Keys waiting to be typed. */
  private keyQueue: number[] = [];

  /** For each 256-byte page, the memory it reads from (null for I/O and slot space) and where in it. */
  private readonly readPages: (Uint8Array | null)[] = new Array(256).fill(null);
  private readonly readBases = new Int32Array(256);
  private readonly writePages: (Uint8Array | null)[] = new Array(256).fill(null);
  private readonly writeBases = new Int32Array(256);
  /** Where writes to ROM go. */
  private readonly sink = new Uint8Array(0x100);

  constructor(
    roms: Roms,
    public model: Model = 'iie',
  ) {
    this.romBanks = romBanks(roms.main);
    this.rom = this.romBanks[0];
    this.cpu = new Cpu6502(this, cpuFor(roms.main, model));
    this.disk2 = new Disk2(roms.disk);
    this.disk2.iwm = model === 'iic';
    this.video = new Video(this.videoSwitches, this.main, this.aux, roms.video, this.hasMmu ? 'iie' : 'ii');
    this.audio.mockingboard = this.mockingboard;
    this.powerOn();
  }

  get enhanced(): boolean {
    return this.cpu.variant === 'cmos';
  }

  /** The IIe and IIc: auxiliary memory, 80 columns, double graphics and the MMU and IOU soft switches. */
  get hasMmu(): boolean {
    return this.model === 'iie' || this.model === 'iic';
  }

  // --- Power and reset ------------------------------------------------------------

  /** Switches the Apple off and on: memory cleared, everything back to its power-on state. */
  powerOn(): void {
    this.main.fill(0);
    this.aux.fill(0);
    Object.assign(this.videoSwitches, new VideoSwitches());
    this.selectRomBank(0);
    this.iouDisabled = false;
    this.keyLatch = 0;
    this.keyStrobe = false;
    this.keyQueue = [];
    this.disk2.reset();
    this.disk2.drives.forEach((drive) => (drive.quarterTrack = 0));
    this.reset();
  }

  /** The RESET line (Ctrl-Reset): the MMU, the cards and the CPU restart; memory is kept. */
  reset(): void {
    Object.assign(this.memory, new MemorySwitches());
    const video = this.videoSwitches;
    video.store80 = video.col80 = video.altChar = false;
    this.disk2.reset();
    this.mockingboard.reset();
    this.updatePages();
    this.cpu.reset();
  }

  // --- Running ------------------------------------------------------------------

  /** Runs for at least `budget` cycles; returns the cycles run. */
  runCycles(budget: number): number {
    const start = this.cycles;
    const end = start + budget;
    const cpu = this.cpu;
    const board = this.hasMockingboard ? this.mockingboard : null;
    while (this.cycles < end) {
      if (this.keyQueue.length !== 0 && !this.keyStrobe) this.pressKey(this.keyQueue.shift()!);
      if (board) {
        board.catchUp(this.cycles);
        cpu.irqLine = board.irq;
      }
      this.cycles += cpu.step();
      this.video.catchUp(this.cycles);
    }
    this.audio.run(this.cycles);
    return this.cycles - start;
  }

  /** The cycle of the bus access the current instruction is making. */
  private get now(): number {
    return this.cycles + this.cpu.accessCycle;
  }

  // --- Memory map -----------------------------------------------------------------

  read(addr: number): number {
    const page = addr >> 8;
    const memory = this.readPages[page];
    if (memory) return memory[this.readBases[page] + (addr & 0xff)];
    return page === 0xc0 ? this.io(addr, null) : this.slotSpace(addr, null);
  }

  write(addr: number, value: number): void {
    const page = addr >> 8;
    const memory = this.writePages[page];
    if (memory) {
      memory[this.writeBases[page] + (addr & 0xff)] = value;
      return;
    }
    if (page === 0xc0) this.io(addr, value);
    else if (page < 0xd0) this.slotSpace(addr, value);
  }

  /** Works out where every page reads and writes from the soft switches. */
  private updatePages(): void {
    const m = this.memory;
    const v = this.videoSwitches;
    const set = (page: number, read: Uint8Array, write: Uint8Array) => {
      this.readPages[page] = read;
      this.readBases[page] = page << 8;
      this.writePages[page] = write;
      this.writeBases[page] = page << 8;
    };
    const zp = m.altZp ? this.aux : this.main;
    for (let page = 0x00; page < 0x02; page++) set(page, zp, zp);
    const readBank = m.ramRd ? this.aux : this.main;
    const writeBank = m.ramWrt ? this.aux : this.main;
    for (let page = 0x02; page < 0xc0; page++) set(page, readBank, writeBank);
    if (v.store80) {
      // With 80STORE, PAGE2 picks the memory for the text page (and with HIRES, the hi-res page).
      const display = v.page2 ? this.aux : this.main;
      for (let page = 0x04; page < 0x08; page++) set(page, display, display);
      if (v.hires) for (let page = 0x20; page < 0x40; page++) set(page, display, display);
    }
    for (let page = 0xc0; page < 0xd0; page++) {
      this.readPages[page] = null;
      this.writePages[page] = null;
    }
    // The language card: 16K of RAM over the ROM, with two banks at $D000.
    for (let page = 0xd0; page < 0x100; page++) {
      // Bank 1 of $D000 is kept where $C000 would be, which is never RAM otherwise.
      const ramBase = page < 0xe0 && !m.lcBank2 ? (page - 0x10) << 8 : page << 8;
      if (m.lcReadRam) {
        this.readPages[page] = zp;
        this.readBases[page] = ramBase;
      } else {
        this.readPages[page] = this.rom;
        this.readBases[page] = (page - 0xc0) << 8;
      }
      this.writePages[page] = m.lcWrite ? zp : this.sink;
      this.writeBases[page] = m.lcWrite ? ramBase : 0;
    }
  }

  /** $C100-$CFFF: slot ROMs, or the IIe's internal firmware (the IIc has only its firmware). */
  private slotSpace(addr: number, value: number | null): number {
    const m = this.memory;
    const offset = addr - 0xc000;
    let result: number;
    if (this.model === 'iic') return this.rom[offset];
    if (!this.hasMmu) {
      const slot = (addr >> 8) & 7;
      if (addr < 0xc800 && slot === DISK_SLOT) return this.disk2.rom[addr & 0xff];
      if (addr < 0xc800 && slot === MOCKINGBOARD_SLOT && this.hasMockingboard) return this.mockingboard.access(addr & 0xff, value, this.now);
      return this.video.floatingBus(this.now);
    }
    if (addr >= 0xc800) {
      result = m.intCxRom || m.intC8Rom ? this.rom[offset] : this.video.floatingBus(this.now);
      if (addr === 0xcfff) m.intC8Rom = false;
      return result;
    }
    const slot = (addr >> 8) & 7;
    if (m.intCxRom || (slot === 3 && !m.slotC3Rom)) {
      if (slot === 3) m.intC8Rom = true;
      return this.rom[offset];
    }
    if (slot === DISK_SLOT) return this.disk2.rom[addr & 0xff];
    if (slot === MOCKINGBOARD_SLOT && this.hasMockingboard) return this.mockingboard.access(addr & 0xff, value, this.now);
    return this.video.floatingBus(this.now);
  }

  /** Puts one of the ROM's banks in (only the 32K IIc ROMs have two). */
  private selectRomBank(bank: number): void {
    this.romBank = bank % this.romBanks.length;
    this.rom = this.romBanks[this.romBank];
    this.updatePages();
  }

  /** The IIc's vertical blank flag: set as each blank begins, cleared by $C070. */
  private vblFlag(now: number): boolean {
    const intoFrame = (now - this.video.frameStart) % CYCLES_PER_FRAME;
    const blankStart = now - intoFrame + VBL_START_CYCLE - (intoFrame < VBL_START_CYCLE ? CYCLES_PER_FRAME : 0);
    return blankStart > this.vblClearedAt;
  }

  // --- I/O ------------------------------------------------------------------------

  private bit(on: boolean): number {
    return (on ? 0x80 : 0) | (this.keyLatch & 0x7f);
  }

  private io(addr: number, value: number | null): number {
    const reg = addr & 0xff;
    const m = this.memory;
    const v = this.videoSwitches;
    if (reg < 0x10) {
      if (value === null) return this.keyLatch | (this.keyStrobe ? 0x80 : 0);
      if (this.hasMmu) this.memorySwitch(reg);
      return 0;
    }
    if (reg < 0x20) {
      // Before the IIe, any of $C010-$C01F just cleared the keyboard strobe.
      if (!this.hasMmu) {
        this.keyStrobe = false;
        return this.video.floatingBus(this.now);
      }
      if (reg === 0x10 || value !== null) {
        this.keyStrobe = false;
        return this.bit(this.anyKeyDown);
      }
      switch (reg) {
        case 0x11: return this.bit(m.lcBank2);
        case 0x12: return this.bit(m.lcReadRam);
        case 0x13: return this.bit(m.ramRd);
        case 0x14: return this.bit(m.ramWrt);
        // On the IIc, $C015 and $C017 are the (absent) mouse's interrupt flags.
        case 0x15: return this.bit(this.model !== 'iic' && m.intCxRom);
        case 0x16: return this.bit(m.altZp);
        case 0x17: return this.bit(this.model !== 'iic' && m.slotC3Rom);
        case 0x18: return this.bit(v.store80);
        case 0x19: return this.bit(this.model === 'iic' ? this.vblFlag(this.now) : !this.video.inVbl(this.now));
        case 0x1a: return this.bit(v.text);
        case 0x1b: return this.bit(v.mixed);
        case 0x1c: return this.bit(v.page2);
        case 0x1d: return this.bit(v.hires);
        case 0x1e: return this.bit(v.altChar);
        default: return this.bit(v.col80);
      }
    }
    if (reg >= 0x30 && reg < 0x40) this.audio.toggleSpeaker(this.now);
    else if (reg === 0x28 && this.model === 'iic') this.selectRomBank(this.romBank + 1);
    else if (reg >= 0x50 && reg < 0x60) this.displaySwitch(reg);
    else if (reg >= 0x60 && reg < 0x70) return this.gamePort(reg & 7) | (this.video.floatingBus(this.now) & 0x7f);
    else if ((reg === 0x7e || reg === 0x7f) && this.model === 'iic') return this.iouSwitch(reg, value);
    else if (reg >= 0x70 && reg < 0x80) {
      this.paddleTriggered = this.now;
      this.vblClearedAt = this.now;
    } else if (reg >= 0x80 && reg < 0x90) this.languageCard(reg, value !== null);
    else if (this.model === 'iic' && ((reg >= 0x98 && reg < 0x9c) || (reg >= 0xa8 && reg < 0xac))) return this.serialPort(reg & 3);
    else if (reg >= 0x90) {
      const slot = (reg >> 4) - 8;
      if (slot === DISK_SLOT) return this.disk2.access(reg & 0x0f, value, this.now);
    }
    return this.video.floatingBus(this.now);
  }

  /** $C000-$C00F, written. */
  private memorySwitch(reg: number): void {
    const on = (reg & 1) === 1;
    const m = this.memory;
    const v = this.videoSwitches;
    switch (reg >> 1) {
      case 0: v.store80 = on; break;
      case 1: m.ramRd = on; break;
      case 2: m.ramWrt = on; break;
      case 3: m.intCxRom = on; break;
      case 4: m.altZp = on; break;
      case 5: m.slotC3Rom = on; break;
      case 6: v.col80 = on; break;
      default: v.altChar = on; break;
    }
    this.updatePages();
  }

  /** $C050-$C05F, read or written. */
  private displaySwitch(reg: number): void {
    this.video.catchUp(this.now);
    const on = (reg & 1) === 1;
    const v = this.videoSwitches;
    switch ((reg >> 1) & 7) {
      case 0: v.text = on; break;
      case 1: v.mixed = on; break;
      case 2:
        v.page2 = on;
        if (v.store80) this.updatePages();
        break;
      case 3:
        v.hires = on;
        if (v.store80) this.updatePages();
        break;
      case 7: v.dhires = !on; break;
      // Annunciators 0-2 go to the game port; nothing here listens.
    }
  }

  /** The IIc's $C07E and $C07F: IOUDIS when written; read, it (and double hi-res) in bit 7. */
  private iouSwitch(reg: number, value: number | null): number {
    if (value !== null) {
      this.iouDisabled = reg === 0x7e;
      return 0;
    }
    return this.bit(reg === 0x7e ? this.iouDisabled : this.videoSwitches.dhires);
  }

  /**
   * The IIc's serial ports, $C098-$C09B and $C0A8-$C0AB: nothing is plugged in,
   * so the 6551s only say their transmit registers are empty.
   */
  private serialPort(register: number): number {
    return register === 1 ? 0x10 : 0;
  }

  /** $C060-$C067: the cassette input, pushbuttons and paddle timers. */
  private gamePort(index: number): number {
    if (index === 0) return 0;
    // The IIc's $C063 is its mouse button, which reads 0 while pressed.
    if (index === 3 && this.model === 'iic') return this.buttons[2] ? 0 : 0x80;
    if (index < 4) return this.buttons[index - 1] ? 0x80 : 0;
    const timeout = this.paddleTriggered + this.paddles[index - 4] * PADDLE_CYCLES_PER_UNIT;
    return this.now < timeout ? 0x80 : 0;
  }

  /**
   * $C080-$C08F: bit 3 picks the $D000 bank, bits 0-1 whether reads come
   * from RAM or ROM and whether RAM can be written. Writing needs two reads
   * in a row of an odd address.
   */
  private languageCard(reg: number, isWrite: boolean): void {
    const m = this.memory;
    m.lcBank2 = (reg & 0x08) === 0;
    const mode = reg & 0x03;
    m.lcReadRam = mode === 0 || mode === 3;
    if (mode & 1) {
      if (isWrite) {
        m.lcPrewrite = false;
      } else {
        if (m.lcPrewrite) m.lcWrite = true;
        m.lcPrewrite = true;
      }
    } else {
      m.lcWrite = false;
      m.lcPrewrite = false;
    }
    this.updatePages();
  }

  // --- Inputs and media ------------------------------------------------------------

  /** Types text, each key as soon as the program has taken the last one. */
  typeKeys(text: string): void {
    this.keyQueue.push(...[...text].map((char) => (char === '\n' ? 0x0d : char.charCodeAt(0))));
  }

  /** A key typed: its ASCII code goes in the keyboard latch with the strobe set. */
  pressKey(code: number): void {
    let key = code & 0x7f;
    if (!this.hasMmu) {
      // The II and II Plus keyboards have only capitals, and nothing above them in ASCII.
      if (key >= 0x61 && key <= 0x7a) key -= 0x20;
      if (key >= 0x60) return;
    }
    this.keyLatch = key;
    this.keyStrobe = true;
  }

  insertDisk(drive: number, disk: FloppyDisk | null): void {
    this.disk2.drives[drive].disk = disk;
  }

  /** Becomes another model with its ROMs (followed by a power cycle). */
  setRoms(roms: Roms, model: Model = this.model): void {
    this.model = model;
    this.disk2.iwm = model === 'iic';
    this.romBanks = romBanks(roms.main);
    this.selectRomBank(0);
    (this.disk2 as { rom: Uint8Array }).rom = roms.disk;
    this.video.setCharRom(roms.video, this.hasMmu ? 'iie' : 'ii');
    this.cpu.setVariant(cpuFor(roms.main, model));
    this.setMockingboard(this.mockingboardOn);
  }

  /** The Mockingboard goes in slot 4, if it is switched on; the IIc has no slots. */
  get hasMockingboard(): boolean {
    return this.mockingboardOn && this.model !== 'iic';
  }

  setMockingboard(on: boolean): void {
    this.mockingboardOn = on;
    this.audio.mockingboard = this.hasMockingboard ? this.mockingboard : null;
    this.cpu.irqLine = false;
  }

  // --- Save states ----------------------------------------------------------------

  saveState(): StateNode {
    return captureState(this);
  }

  loadState(state: StateNode): void {
    restoreState(this, state);
    this.selectRomBank(this.romBank);
    this.audio.resync(this.cycles);
  }
}
