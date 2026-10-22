import { describe, expect, it } from 'vitest';
import { CYCLES_PER_FRAME, SCREEN_WIDTH, hiresLineOffset, textRowOffset } from '../src/video/video';
import { Apple2 } from '../src/apple2';
import { testMachine, testRoms } from './helpers/rom';

/** A canvas pixel (little-endian RGBA) as RGB. */
const rgb = (pixel: number) => ((pixel & 0xff) << 16) | (pixel & 0xff00) | ((pixel >> 16) & 0xff);

function frameOf(setup: (apple: ReturnType<typeof testMachine>) => void): (x: number, line: number) => number {
  const apple = testMachine();
  setup(apple);
  apple.runCycles(CYCLES_PER_FRAME * 2);
  return (x, line) => rgb(apple.video.framebuffer[line * 2 * SCREEN_WIDTH + x]);
}

describe('the video', () => {
  it('lays out text rows and hi-res lines in thirds', () => {
    expect(textRowOffset(0)).toBe(0);
    expect(textRowOffset(1)).toBe(0x80);
    expect(textRowOffset(8)).toBe(0x28);
    expect(textRowOffset(23)).toBe(0x3d0);
    expect(hiresLineOffset(1)).toBe(0x400);
    expect(hiresLineOffset(191)).toBe(0x1fd0);
  });

  it('draws text from the video ROM, lit where its bits are 0', () => {
    const pixel = frameOf((apple) => {
      apple.main[0x400] = 0x00; // the test video ROM's rows for code 0 are all 0: every dot lit
      apple.main[0x401] = 0xff; // and for $FF all 1: none lit
    });
    expect(pixel(0, 0)).toBe(0xffffff);
    expect(pixel(13, 7)).toBe(0xffffff);
    expect(pixel(14, 0)).toBe(0x000000);
  });

  it('shows lo-res blocks in their colours', () => {
    const pixel = frameOf((apple) => {
      apple.read(0xc050); // graphics
      apple.main[0x400] = 0x96; // medium blue on top, orange below
    });
    expect(pixel(6, 1)).toBe(0x14cffd);
    expect(pixel(6, 5)).toBe(0xff6a3c);
  });

  it('shows double lo-res with aux memory colours rotated, as Flapple Bird draws its sky', () => {
    const pixel = frameOf((apple) => {
      apple.read(0xc050);
      apple.write(0xc00d, 0); // 80COL
      apple.read(0xc05e); // double graphics
      apple.aux[0x400] = 0xbb; // light blue, rotated
      apple.main[0x400] = 0x77; // light blue
    });
    for (const x of [3, 10]) expect(pixel(x, 1)).toBe(0xd0c3ff);
  });

  it('gives hi-res dots their artifact colours by column and palette bit', () => {
    const pixel = frameOf((apple) => {
      apple.read(0xc050);
      apple.read(0xc057);
      apple.main[0x2000] = 0x55; // even columns: violet
      apple.main[0x2000 + hiresLineOffset(1)] = 0x2a; // odd columns: green
      apple.main[0x2000 + hiresLineOffset(2)] = 0xd5; // with the palette bit: blue
      apple.main[0x2000 + hiresLineOffset(3)] = 0x7f; // all on: white
    });
    expect(pixel(6, 0)).toBe(0xff44fd);
    expect(pixel(6, 1)).toBe(0x14f53c);
    expect(pixel(6, 2)).toBe(0x14cffd);
    expect(pixel(6, 3)).toBe(0xffffff);
  });

  it('shows a mono picture on a green monitor', () => {
    const apple = testMachine();
    apple.video.monitor = 'green';
    apple.read(0xc050);
    apple.read(0xc057);
    apple.main[0x2000] = 0x01;
    apple.runCycles(CYCLES_PER_FRAME * 2);
    expect(rgb(apple.video.framebuffer[0])).toBe(0x33ff66);
    expect(rgb(apple.video.framebuffer[2])).toBe(0);
  });

  it('puts the byte the video is fetching on the floating bus', () => {
    const apple = testMachine();
    apple.main.fill(0x5a, 0x400, 0x800);
    // Reading an empty slot's ROM space during the visible part of a line returns text page bytes.
    let seen = 0;
    for (let i = 0; i < 200; i++) {
      apple.runCycles(37);
      if (apple.read(0xc500) === 0x5a) seen++;
    }
    expect(seen).toBeGreaterThan(50);
  });
});

describe("the Apple II and II Plus's video", () => {
  it('draws their 64 characters mirrored from the 2K ROM, inverse below $40', () => {
    const roms = testRoms();
    const chars = new Uint8Array(0x800);
    chars[0x01 * 8] = 0x40; // "A"'s top row: just its leftmost dot (bit 6)
    const apple = new Apple2({ ...roms, main: roms.main.slice(0x1000), video: chars }, 'iiplus');
    apple.main[0x400] = 0xc1; // normal A
    apple.main[0x401] = 0x01; // inverse A
    apple.runCycles(CYCLES_PER_FRAME * 2);
    const pixel = (x: number) => rgb(apple.video.framebuffer[x]);
    expect([pixel(0), pixel(1), pixel(2)]).toEqual([0xffffff, 0xffffff, 0]);
    expect([pixel(14), pixel(16)]).toEqual([0, 0xffffff]);
  });
});
