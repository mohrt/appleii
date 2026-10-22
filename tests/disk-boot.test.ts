import { describe, expect, it } from 'vitest';
import { FloppyDisk } from '../src/disk/floppy';
import { DISK_BYTES } from '../src/disk/nibble';
import { hasRoms, machine, runSeconds, screenText } from './helpers/machine';

/**
 * A disk whose boot sector asks the boot ROM for two more sectors of track 0
 * (it reads physical sectors in turn), then prints the bytes they hold.
 */
function bootDisk(): FloppyDisk {
  const image = new Uint8Array(DISK_BYTES);
  // DOS order: physical sectors 1 and 2 are DOS sectors 7 and 14.
  image.fill(0xc1, 7 * 256, 8 * 256); // "A"
  image.fill(0xc2, 14 * 256, 15 * 256); // "B"
  const code = [
    0x03, // sectors to load: the boot ROM reads physical 0, 1 and 2 into $800, $900, $A00
    0xad, 0x00, 0x09, // LDA $0900
    0x8d, 0x00, 0x04, // STA $0400
    0xad, 0x00, 0x0a, // LDA $0A00
    0x8d, 0x01, 0x04, // STA $0401
    0x4c, 0x0d, 0x08, // JMP *
  ];
  image.set(code, 0);
  return FloppyDisk.fromImage('boot.dsk', image);
}

describe.skipIf(!hasRoms)('booting from a disk', () => {
  it('loads the boot sectors through the Disk II ROM and runs them', () => {
    const apple = machine('enhanced');
    apple.insertDisk(0, bootDisk());
    runSeconds(apple, 4);
    expect(screenText(apple)[0].slice(0, 2)).toBe('AB');
    expect(apple.cpu.pc).toBe(0x080d);
  });

  it('boots on the original IIe too', () => {
    const apple = machine('original');
    apple.insertDisk(0, bootDisk());
    runSeconds(apple, 4);
    expect(screenText(apple)[0].slice(0, 2)).toBe('AB');
  });
});
