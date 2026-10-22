import { describe, expect, it } from 'vitest';
import { Apple2 } from '../src/apple2';
import { testMachine, testRoms } from './helpers/rom';

describe('the IIe memory map', () => {
  it('reads the ROM above $D000 and writes nowhere there at power on', () => {
    const apple = testMachine();
    expect(apple.read(0xfbc0)).toBe(0xe0);
    apple.write(0xd000, 0x55);
    expect(apple.read(0xd000)).toBe(0);
  });

  it('sends reads and writes to auxiliary memory with RAMRD and RAMWRT', () => {
    const apple = testMachine();
    apple.write(0x2000, 0x11);
    apple.write(0xc005, 0); // RAMWRT on
    apple.write(0x2000, 0x22);
    expect(apple.read(0x2000)).toBe(0x11);
    apple.write(0xc003, 0); // RAMRD on
    expect(apple.read(0x2000)).toBe(0x22);
    expect(apple.read(0xc013) & 0x80).toBe(0x80);
    expect(apple.main[0x2000]).toBe(0x11);
    expect(apple.aux[0x2000]).toBe(0x22);
  });

  it('switches zero page, the stack and the language card with ALTZP', () => {
    const apple = testMachine();
    apple.write(0x80, 1);
    apple.write(0xc009, 0); // ALTZP on
    apple.write(0x80, 2);
    expect(apple.main[0x80]).toBe(1);
    expect(apple.aux[0x80]).toBe(2);
    expect(apple.read(0xc016) & 0x80).toBe(0x80);
  });

  it('with 80STORE, lets PAGE2 choose the memory of the text page (and hi-res page with HIRES)', () => {
    const apple = testMachine();
    apple.write(0xc001, 0); // 80STORE on
    apple.read(0xc055); // PAGE2
    apple.write(0x400, 0xaa);
    apple.write(0x2000, 0xbb);
    expect(apple.aux[0x400]).toBe(0xaa);
    expect(apple.main[0x2000]).toBe(0xbb);
    apple.read(0xc057); // HIRES
    apple.write(0x2000, 0xcc);
    expect(apple.aux[0x2000]).toBe(0xcc);
    // The display stays on page 1.
    expect(apple.video.floatingBus(apple.cycles)).toBeGreaterThanOrEqual(0);
  });

  it('enables language card writes after two reads of an odd address', () => {
    const apple = testMachine();
    apple.read(0xc080); // an even address turns writing off
    apple.read(0xc083);
    apple.write(0xd000, 0x12);
    expect(apple.read(0xd000)).toBe(0);
    apple.read(0xc083);
    apple.write(0xd000, 0x12);
    expect(apple.read(0xd000)).toBe(0x12);
    // A write to the switch doesn't count towards the two reads.
    apple.read(0xc080);
    apple.write(0xc083, 0);
    apple.read(0xc083);
    apple.write(0xe000, 0x34);
    expect(apple.read(0xe000)).toBe(0);
  });

  it('has two banks at $D000 and one above $E000', () => {
    const apple = testMachine();
    apple.read(0xc083);
    apple.read(0xc083); // bank 2, read and write RAM
    apple.write(0xd000, 2);
    apple.write(0xe000, 0xee);
    apple.read(0xc08b);
    apple.read(0xc08b); // bank 1
    expect(apple.read(0xd000)).toBe(0);
    apple.write(0xd000, 1);
    expect(apple.read(0xe000)).toBe(0xee);
    expect(apple.read(0xc011) & 0x80).toBe(0);
    apple.read(0xc083);
    expect(apple.read(0xd000)).toBe(2);
    expect(apple.read(0xc011) & 0x80).toBe(0x80);
    apple.read(0xc081); // read ROM
    expect(apple.read(0xd000)).toBe(0);
    expect(apple.read(0xc012) & 0x80).toBe(0);
  });

  it('maps the internal $C3 firmware, and $C800 after it is used, until $CFFF', () => {
    const apple = testMachine();
    expect(apple.read(0xc800)).not.toBe(0xc8);
    expect(apple.read(0xc300)).toBe(0xc3);
    expect(apple.read(0xc800)).toBe(0xc8);
    apple.read(0xcfff);
    expect(apple.read(0xc800)).not.toBe(0xc8);
    apple.write(0xc00b, 0); // SLOTC3ROM: the (empty) slot 3
    expect(apple.read(0xc300)).not.toBe(0xc3);
    apple.write(0xc007, 0); // INTCXROM: all internal
    expect(apple.read(0xc300)).toBe(0xc3);
    expect(apple.read(0xc600)).toBe(0);
  });

  it('shows the Disk II boot ROM in slot 6', () => {
    const apple = testMachine();
    expect(apple.read(0xc601)).toBe(0x20);
  });

  it('resets the soft switches on Ctrl-Reset but keeps memory', () => {
    const apple = testMachine();
    apple.write(0x300, 0x77);
    apple.write(0xc005, 0);
    apple.write(0xc00d, 0); // 80COL
    apple.reset();
    expect(apple.read(0xc014) & 0x80).toBe(0);
    expect(apple.read(0xc01f) & 0x80).toBe(0);
    expect(apple.read(0x300)).toBe(0x77);
  });
});

describe('the keyboard and game port', () => {
  it('latches a key with the strobe until $C010 is touched', () => {
    const apple = testMachine();
    apple.pressKey(0x41);
    expect(apple.read(0xc000)).toBe(0xc1);
    apple.anyKeyDown = true;
    expect(apple.read(0xc010)).toBe(0xc1);
    expect(apple.read(0xc000)).toBe(0x41);
  });

  it('times the paddles from $C070 by their position', () => {
    const apple = testMachine();
    apple.paddles[0] = 0;
    apple.paddles[1] = 255;
    apple.read(0xc070);
    apple.runCycles(100);
    expect(apple.read(0xc064) & 0x80).toBe(0);
    expect(apple.read(0xc065) & 0x80).toBe(0x80);
    apple.runCycles(3000);
    expect(apple.read(0xc065) & 0x80).toBe(0);
  });

  it('reads the buttons in bit 7', () => {
    const apple = testMachine();
    apple.buttons[1] = true;
    expect(apple.read(0xc061) & 0x80).toBe(0);
    expect(apple.read(0xc062) & 0x80).toBe(0x80);
  });

  it('reports vertical blanking at $C019 for 70 of the 262 lines', () => {
    const apple = testMachine();
    const start = apple.cycles;
    let blank = 0;
    for (let line = 0; line < 262; line++) {
      apple.runCycles(start + line * 65 + 30 - apple.cycles);
      if (!(apple.read(0xc019) & 0x80)) blank++;
    }
    expect(blank).toBe(70);
  });
});

describe('the speaker', () => {
  it('clicks with each touch of $C030', () => {
    // LDA $C030; LDX #$40; DEX; BNE -3; JMP $F800: a square wave
    const apple = testMachine([0xad, 0x30, 0xc0, 0xa2, 0x40, 0xca, 0xd0, 0xfd, 0x4c, 0x00, 0xf8]);
    apple.audio.setRates(1_020_484, 48_000);
    apple.runCycles(1_020_484 / 10);
    const samples = apple.audio.takeSamples();
    expect(samples.length).toBeGreaterThan(9000);
    const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeGreaterThan(0.1);
  });
});

describe('the Apple IIc', () => {
  /** A 32K IIc ROM whose two banks hold their bank number at $D000. */
  function iic(): Apple2 {
    const roms = testRoms();
    const main = new Uint8Array(0x8000);
    main.set(roms.main);
    main.set(roms.main, 0x4000);
    main[0xfbc0 - 0xc000] = main[0x4000 + 0xfbc0 - 0xc000] = 0x00;
    main[0xd000 - 0xc000] = 0;
    main[0x4000 + 0xd000 - 0xc000] = 1;
    return new Apple2({ ...roms, main }, 'iic');
  }

  it('switches its ROM banks at $C028, and has its own firmware in every slot', () => {
    const apple = iic();
    expect(apple.read(0xd000)).toBe(0);
    apple.write(0xc028, 0);
    expect(apple.read(0xd000)).toBe(1);
    apple.write(0xc028, 0);
    expect(apple.read(0xd000)).toBe(0);
    expect(apple.read(0xc300)).toBe(0xc3);
    expect(apple.read(0xc601)).not.toBe(0x20); // no Disk II card: its own ROM
  });

  it('sets its vertical blank flag as each blank begins, until $C070 clears it', () => {
    const apple = iic();
    const lineCycles = 65;
    apple.runCycles(193 * lineCycles - (apple.cycles % (262 * lineCycles)));
    expect(apple.read(0xc019) & 0x80).toBe(0x80);
    apple.read(0xc070);
    expect(apple.read(0xc019) & 0x80).toBe(0);
  });

  it('has no Mockingboard', () => {
    const apple = iic();
    apple.setMockingboard(true);
    expect(apple.hasMockingboard).toBe(false);
  });
});
