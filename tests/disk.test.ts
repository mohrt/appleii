import { describe, expect, it } from 'vitest';
import { Disk2 } from '../src/disk/disk2';
import { FloppyDisk, isProdosOrder } from '../src/disk/floppy';
import { DISK_BYTES, DOS_ORDER, buildTrack, decode62, encode62, readSectors, trackNibbles } from '../src/disk/nibble';
import { buildWoz, parseWoz } from '../src/disk/woz';

function patternImage(): Uint8Array {
  const image = new Uint8Array(DISK_BYTES);
  for (let i = 0; i < image.length; i++) image[i] = (i * 7 + (i >> 8) * 13) & 0xff;
  return image;
}

describe('6-and-2 encoding', () => {
  it('round-trips any sector', () => {
    const data = Uint8Array.from({ length: 256 }, (_, i) => (i * 37 + 11) & 0xff);
    const nibbles = encode62(data);
    expect(nibbles).toHaveLength(343);
    expect(nibbles.every((n) => n >= 0x96)).toBe(true);
    expect(decode62(nibbles)).toEqual(data);
  });

  it('rejects a damaged field', () => {
    const nibbles = encode62(new Uint8Array(256).fill(0x42));
    nibbles[100] = nibbles[100] === 0x96 ? 0x97 : 0x96;
    expect(decode62(nibbles)).toBeNull();
  });
});

describe('tracks', () => {
  it('are about a revolution of bits and read back every sector', () => {
    const sector = (physical: number) => new Uint8Array(256).fill(physical);
    const bits = buildTrack(5, sector);
    expect(bits.length).toBeGreaterThan(50_000);
    expect(bits.length).toBeLessThan(52_000);
    const sectors = readSectors(bits);
    expect(sectors.size).toBe(16);
    expect(sectors.get(9)).toEqual(sector(9));
  });

  it('start each byte at its first 1 bit, skipping self-sync zeros', () => {
    const nibbles = trackNibbles(buildTrack(0, () => new Uint8Array(256)));
    expect([...nibbles.subarray(0, 4)]).toEqual([0xff, 0xff, 0xff, 0xff]);
    expect([...nibbles].join(',')).toContain([0xd5, 0xaa, 0x96].join(','));
  });
});

describe('disk images', () => {
  it('turn a .dsk into tracks and back unchanged', () => {
    const image = patternImage();
    const disk = FloppyDisk.fromImage('test.dsk', image);
    expect(disk.format).toBe('dos');
    expect(disk.toImage()).toEqual(image);
  });

  it('keep sectors written to a track', () => {
    const image = patternImage();
    const disk = FloppyDisk.fromImage('test.po', image);
    expect(disk.format).toBe('prodos');
    const track3 = disk.trackAt(12)!;
    const replacement = buildTrack(3, (physical) => new Uint8Array(256).fill(physical === 2 ? 0xaa : 0));
    track3.set(replacement.subarray(0, track3.length));
    const saved = disk.toImage();
    // Physical sector 2 is ProDOS-order sector 1.
    expect(saved[3 * 4096 + 256]).toBe(0xaa);
  });

  it('tell ProDOS-ordered .dsk images from DOS ones', () => {
    const prodos = new Uint8Array(DISK_BYTES);
    prodos[0x404] = 0xf5;
    expect(isProdosOrder('game.dsk', prodos)).toBe(true);
    const dos = prodos.slice();
    dos.set([4, 17, 15, 3], 17 * 4096);
    dos[17 * 4096 + 0x27] = 122;
    dos[17 * 4096 + 0x34] = 35;
    dos[17 * 4096 + 0x35] = 16;
    expect(isProdosOrder('game.dsk', dos)).toBe(false);
  });

  it('round-trip through WOZ 2', () => {
    const disk = FloppyDisk.fromImage('test.dsk', patternImage());
    const woz = buildWoz({ quarterTracks: disk.quarterTracks, tracks: disk.tracks.map((bits) => ({ bits })), writeProtected: true, bitTiming: 32, info: new Uint8Array(60), meta: null });
    const parsed = parseWoz(woz);
    expect(parsed.writeProtected).toBe(true);
    expect(parsed.quarterTracks[4]).toBe(1);
    expect(parsed.tracks[7].bits).toEqual(disk.tracks[7]);
    const reloaded = FloppyDisk.fromImage('test.woz', woz);
    expect(readSectors(reloaded.trackAt(68)!).get(3)).toEqual(readSectors(disk.trackAt(68)!).get(3));
  });
});

describe('the Disk II controller', () => {
  function controllerWith(disk: FloppyDisk): { disk2: Disk2; cycle: { now: number } } {
    const disk2 = new Disk2(new Uint8Array(256));
    disk2.drives[0].disk = disk;
    const cycle = { now: 0 };
    disk2.access(0x9, null, cycle.now); // motor on
    disk2.access(0xe, null, cycle.now); // read mode
    return { disk2, cycle };
  }

  /** Reads disk bytes as a polling loop would: every 7 cycles, taking each byte with its top bit set once. */
  function readBytes(disk2: Disk2, cycle: { now: number }, count: number): number[] {
    const out: number[] = [];
    let last = 0;
    while (out.length < count) {
      cycle.now += 7;
      const value = disk2.access(0xc, null, cycle.now);
      if (value & 0x80 && value !== last) out.push(value);
      last = value & 0x80 ? value : 0;
    }
    return out;
  }

  it('reads the bytes of a track through the latch', () => {
    const image = new Uint8Array(DISK_BYTES);
    for (let t = 0; t < 35; t++) for (let s = 0; s < 16; s++) image.fill(t * 16 + DOS_ORDER.indexOf(s), t * 4096 + s * 256, t * 4096 + s * 256 + 256);
    const { disk2, cycle } = controllerWith(FloppyDisk.fromImage('test.dsk', image));
    const bytes = readBytes(disk2, cycle, 8000);
    const text = bytes.map((b) => b.toString(16)).join(' ');
    expect(text).toContain('d5 aa 96');
    expect(text).toContain('d5 aa ad');
  });

  it('steps the head a half track per phase', () => {
    const { disk2, cycle } = controllerWith(FloppyDisk.fromImage('test.dsk', new Uint8Array(DISK_BYTES)));
    // Phases 1, 2, 3, 0 in turn move the head out two tracks.
    for (const phase of [1, 2, 3, 0]) {
      disk2.access(phase * 2 + 1, null, (cycle.now += 100));
      disk2.access(((phase + 3) % 4) * 2, null, (cycle.now += 100));
    }
    expect(disk2.drives[0].quarterTrack).toBe(8);
  });

  it('writes bytes loaded every 32 cycles, and sync bytes every 40', () => {
    const disk = FloppyDisk.fromImage('test.dsk', new Uint8Array(DISK_BYTES));
    const { disk2, cycle } = controllerWith(disk);
    disk2.access(0xd, null, cycle.now); // load mode
    disk2.access(0xf, 0xff, (cycle.now += 4)); // write mode, sync byte
    const start = disk2.drives[0].bitPosition;
    disk2.access(0xc, null, (cycle.now += 4)); // shift
    for (const [value, gap] of [[0xff, 40], [0xd5, 40], [0xaa, 32], [0x96, 32], [0xff, 32]] as const) {
      disk2.access(0xd, value, (cycle.now += gap - 4));
      disk2.access(0xc, null, (cycle.now += 4));
    }
    disk2.access(0xe, null, (cycle.now += 32));
    expect(disk.dirty).toBe(true);
    const track = disk.trackAt(0)!;
    const written = trackNibbles(track.subarray(start, disk2.drives[0].bitPosition));
    expect([...written].map((b) => b.toString(16)).join(' ')).toContain('ff ff d5 aa 96');
  });
});
