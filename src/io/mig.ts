import type { Disk2 } from '../disk/disk2';

const RAM_BYTES = 0x800;
const WINDOW_BYTES = 0x20;
const PAGES = RAM_BYTES / WINDOW_BYTES;

/**
 * The IIc Plus's MIG ("Magic Interface Glue"), which sits beside the ROM at
 * $CC00-$CFFF. It has 2K of RAM that the 3.5" drive firmware works in, seen
 * 32 bytes at a time at $CE00-$CE1F: an access to $CEA0 goes back to the
 * first 32, one to $CE20 on to the next. Accesses to $CC80 and $CCC0 give the
 * IWM to the internal 3.5" drive and back to the disk port, and $CE40 and
 * $CE60 set the drive's SEL line low and high.
 */
export class Mig {
  readonly ram = new Uint8Array(RAM_BYTES);
  page = 0;

  constructor(private readonly iwm: Disk2) {}

  reset(): void {
    this.page = 0;
    this.iwm.drive35 = false;
    this.iwm.headSelect = false;
  }

  /**
   * An access (read, or write of `value`) to $CC00-$CFFF. Returns the byte
   * for the RAM window, or null where the ROM answers (the switches act either way).
   */
  access(addr: number, value: number | null): number | null {
    switch (addr & ~(WINDOW_BYTES - 1)) {
      case 0xce00: {
        const at = this.page * WINDOW_BYTES + (addr & (WINDOW_BYTES - 1));
        if (value !== null) this.ram[at] = value;
        return this.ram[at];
      }
      case 0xce20: this.page = (this.page + 1) % PAGES; break;
      case 0xcea0: this.page = 0; break;
      case 0xce40: this.iwm.headSelect = false; break;
      case 0xce60: this.iwm.headSelect = true; break;
      case 0xcc80: this.iwm.drive35 = true; break;
      case 0xccc0: this.iwm.drive35 = false; break;
    }
    return null;
  }
}
