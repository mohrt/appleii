import { Apple2, type Roms } from '../../src/apple2';

/**
 * Stand-in ROMs for tests that don't need Apple's: a main ROM with the
 * enhanced IIe's ID bytes whose reset vector runs `code` at $F800 (a loop by
 * default), a video ROM where every character's rows are its code, and a
 * Disk II ROM with just the slot signature.
 */
export function testRoms(code: number[] = [0x4c, 0x00, 0xf8]): Roms {
  const main = new Uint8Array(0x4000);
  main.set(code, 0xf800 - 0xc000);
  main[0xfbb3 - 0xc000] = 0x06;
  main[0xfbc0 - 0xc000] = 0xe0;
  // Reset and IRQ both go to $F800.
  main.set([0x00, 0xf8, 0x00, 0xf8], 0xfffc - 0xc000);
  // Something recognisable in the internal $C3 and $C800 firmware.
  main[0xc300 - 0xc000] = 0xc3;
  main[0xc800 - 0xc000] = 0xc8;
  const video = Uint8Array.from({ length: 0x1000 }, (_, i) => i >> 3);
  const disk = new Uint8Array(0x100);
  disk.set([0xa2, 0x20, 0xa0, 0x00, 0xa2, 0x03, 0x86, 0x3c]);
  return { main, video, disk };
}

export function testMachine(code?: number[]): Apple2 {
  return new Apple2(testRoms(code));
}
