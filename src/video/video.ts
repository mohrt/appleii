export const SCREEN_WIDTH = 560;
export const SCREEN_LINES = 192;
/** Each line is shown twice, so the picture keeps the Apple's shape. */
export const FRAME_HEIGHT = SCREEN_LINES * 2;
export const CYCLES_PER_LINE = 65;
export const LINES_PER_FRAME = 262;
export const CYCLES_PER_FRAME = CYCLES_PER_LINE * LINES_PER_FRAME;
/** The first cycle of a line that fetches a byte shown on screen (the 40 before are the border and blanking). */
const FIRST_VISIBLE_CYCLE = 25;
const MIXED_TEXT_LINE = 160;
/** Flashing characters swap every this many frames (about twice a second). */
const FLASH_FRAMES = 16;

export type Monitor = 'color' | 'green' | 'amber' | 'white';

/** The soft switches that choose what the screen shows. */
export class VideoSwitches {
  text = true;
  mixed = false;
  page2 = false;
  hires = false;
  col80 = false;
  store80 = false;
  altChar = false;
  /** Annunciator 3 off: double hi-res (and double lo-res) with 80 columns on. */
  dhires = false;
}

/** The lo-res colours, which are also every colour the NTSC signal can make, as RGB. */
const PALETTE_RGB = [
  0x000000, 0xe31e60, 0x604ebd, 0xff44fd, 0x00a360, 0x9c9c9c, 0x14cffd, 0xd0c3ff,
  0x607203, 0xff6a3c, 0x9c9c9c, 0xffa0d0, 0x14f53c, 0xd0dd8d, 0x72ffd0, 0xffffff,
];
const MONITOR_RGB: Record<Exclude<Monitor, 'color'>, number> = { green: 0x33ff66, amber: 0xffb000, white: 0xffffff };

/** RGB as a canvas pixel (little-endian RGBA). */
const pixel = (rgb: number) => 0xff000000 | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff);
const PALETTE = Uint32Array.from(PALETTE_RGB, pixel);
const BLACK = pixel(0);

/** Offset of a text (and lo-res) row in its page: the rows are interleaved in thirds. */
export function textRowOffset(row: number): number {
  return ((row & 7) << 7) | ((row >> 3) * 40);
}

/** Offset of a hi-res line in its page. */
export function hiresLineOffset(line: number): number {
  return ((line & 7) << 10) | textRowOffset(line >> 3);
}

/**
 * The IIe's video: text in 40 and 80 columns (with the video ROM's
 * characters, flashing and MouseText), lo-res, hi-res and their double
 * versions, and mixed mode. Lines are drawn as the beam finishes them, so
 * mode changes mid-frame show where they happened. Each line becomes 560
 * dots; in colour, each dot takes the colour the NTSC signal of the four dots
 * around it makes, which gives the artifact colours and their fringes.
 */
export class Video {
  readonly framebuffer = new Uint32Array(SCREEN_WIDTH * FRAME_HEIGHT);
  monitor: Monitor = 'color';
  /** Cycle at which the frame being drawn started. */
  frameStart = 0;
  /** The next line to draw. */
  nextLine = 0;
  frames = 0;
  /** Called when a frame is complete. */
  onFrame: (framebuffer: Uint32Array) => void = () => {};
  /** Two dots of margin either side for the colour window. */
  private readonly dots = new Uint8Array(SCREEN_WIDTH + 4);

  constructor(
    private readonly switches: VideoSwitches,
    private readonly main: Uint8Array,
    private readonly aux: Uint8Array,
    private charRom: Uint8Array,
  ) {}

  setCharRom(rom: Uint8Array): void {
    this.charRom = rom;
  }

  /** Where the beam is: line 0-261 and cycle 0-64 within it. */
  beam(cycle: number): { line: number; h: number } {
    const position = (cycle - this.frameStart) % CYCLES_PER_FRAME;
    return { line: Math.floor(position / CYCLES_PER_LINE), h: position % CYCLES_PER_LINE };
  }

  /** In vertical blanking (lines 192-261). */
  inVbl(cycle: number): boolean {
    return (cycle - this.frameStart) % CYCLES_PER_FRAME >= SCREEN_LINES * CYCLES_PER_LINE;
  }

  /** Draws the lines the beam has finished by `cycle`. */
  catchUp(cycle: number): void {
    for (;;) {
      const position = cycle - this.frameStart;
      while (this.nextLine < SCREEN_LINES && (this.nextLine + 1) * CYCLES_PER_LINE <= position) this.drawLine(this.nextLine++);
      if (position < CYCLES_PER_FRAME) return;
      this.frameStart += CYCLES_PER_FRAME;
      this.nextLine = 0;
      this.frames++;
      this.onFrame(this.framebuffer);
    }
  }

  /**
   * The byte the video is fetching at `cycle`, which is what reads of
   * unconnected addresses return (the "floating bus").
   */
  floatingBus(cycle: number): number {
    const { line, h } = this.beam(cycle);
    const s = this.switches;
    const v = line & 0xff;
    const page = s.page2 && !s.store80 ? 2 : 1;
    const low = ((((v >> 6) & 3) * 40 + h - FIRST_VISIBLE_CYCLE) & 0x7f) | (((v >> 3) & 7) << 7);
    const graphics = !s.text && !(s.mixed && v >= MIXED_TEXT_LINE && v < SCREEN_LINES);
    const address = graphics && s.hires ? page * 0x2000 + ((v & 7) << 10) + low : page * 0x400 + low;
    return this.main[address];
  }

  private get flashOn(): boolean {
    return Math.floor(this.frames / FLASH_FRAMES) % 2 === 1;
  }

  private drawLine(line: number): void {
    const s = this.switches;
    const page = s.page2 && !s.store80 ? 1 : 0;
    const doubled = s.col80 && s.dhires;
    const text = s.text || (s.mixed && line >= MIXED_TEXT_LINE);
    this.dots.fill(0);
    if (text) {
      if (s.col80) this.text80(line, page);
      else this.text40(line, page);
    } else if (s.hires) {
      if (doubled) this.doubleHires(line, page);
      else this.hires(line, page);
    } else if (doubled) {
      this.doubleLores(line, page);
    } else {
      this.lores(line, page);
    }
    if (this.monitor === 'color' && !text) this.colorize(line);
    else this.mono(line, this.monitor === 'color' ? 0xffffff : MONITOR_RGB[this.monitor]);
  }

  /** The 7 dots of a character's row (bit 0 is the leftmost), lit where the ROM has a 0. */
  private glyphRow(code: number, row: number): number {
    let index = code;
    if (!this.switches.altChar && code >= 0x40 && code < 0x80) {
      // Flashing characters alternate between inverse and normal.
      index = (code & 0x3f) | (this.flashOn ? 0 : 0x80);
    }
    return ~this.charRom[index * 8 + row] & 0x7f;
  }

  private text40(line: number, page: number): void {
    const base = 0x400 + page * 0x400 + textRowOffset(line >> 3);
    const dots = this.dots;
    for (let col = 0; col < 40; col++) {
      const glyph = this.glyphRow(this.main[base + col], line & 7);
      let x = 2 + col * 14;
      for (let bit = 0; bit < 7; bit++) {
        const on = (glyph >> bit) & 1;
        dots[x++] = on;
        dots[x++] = on;
      }
    }
  }

  private text80(line: number, page: number): void {
    const base = 0x400 + page * 0x400 + textRowOffset(line >> 3);
    const dots = this.dots;
    let x = 2;
    for (let col = 0; col < 40; col++) {
      for (const memory of [this.aux, this.main]) {
        const glyph = this.glyphRow(memory[base + col], line & 7);
        for (let bit = 0; bit < 7; bit++) dots[x++] = (glyph >> bit) & 1;
      }
    }
  }

  private lores(line: number, page: number): void {
    const base = 0x400 + page * 0x400 + textRowOffset(line >> 3);
    const shift = line & 4;
    const dots = this.dots;
    for (let col = 0; col < 40; col++) {
      const color = (this.main[base + col] >> shift) & 0x0f;
      for (let x = col * 14; x < col * 14 + 14; x++) dots[x + 2] = (color >> (x & 3)) & 1;
    }
  }

  private doubleLores(line: number, page: number): void {
    const base = 0x400 + page * 0x400 + textRowOffset(line >> 3);
    const shift = line & 4;
    const dots = this.dots;
    for (let col = 0; col < 40; col++) {
      // Aux memory holds its colours rotated a bit right (so the sky's light blue 7 is $B there).
      const auxColor = (this.aux[base + col] >> shift) & 0x0f;
      const color = [((auxColor << 1) | (auxColor >> 3)) & 0x0f, (this.main[base + col] >> shift) & 0x0f];
      for (let x = col * 14; x < col * 14 + 14; x++) dots[x + 2] = (color[x - col * 14 < 7 ? 0 : 1] >> (x & 3)) & 1;
    }
  }

  private hires(line: number, page: number): void {
    const base = 0x2000 + page * 0x2000 + hiresLineOffset(line);
    const dots = this.dots;
    for (let col = 0; col < 40; col++) {
      const byte = this.main[base + col];
      let x = 2 + col * 14;
      if (byte & 0x80) {
        // The palette bit delays the byte's dots by half a dot; the previous dot fills the gap.
        dots[x] = col > 0 ? dots[x - 1] : 0;
        x++;
      }
      for (let bit = 0; bit < 7; bit++) {
        const on = (byte >> bit) & 1;
        dots[x++] = on;
        dots[x++] = on;
      }
    }
  }

  private doubleHires(line: number, page: number): void {
    const base = 0x2000 + page * 0x2000 + hiresLineOffset(line);
    const dots = this.dots;
    let x = 2;
    for (let col = 0; col < 40; col++) {
      for (const byte of [this.aux[base + col], this.main[base + col]]) {
        for (let bit = 0; bit < 7; bit++) dots[x++] = (byte >> bit) & 1;
      }
    }
  }

  private mono(line: number, rgb: number): void {
    const on = pixel(rgb);
    const row = line * 2 * SCREEN_WIDTH;
    const fb = this.framebuffer;
    const dots = this.dots;
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const value = dots[x + 2] ? on : BLACK;
      fb[row + x] = value;
      fb[row + SCREEN_WIDTH + x] = value;
    }
  }

  /** Each dot gets the colour of the four dots from one before it to two after, by their phase in the colour cycle. */
  private colorize(line: number): void {
    const row = line * 2 * SCREEN_WIDTH;
    const fb = this.framebuffer;
    const dots = this.dots;
    // dots[i] is dot i - 2; the window for dot x is dots x-1 to x+2.
    let pattern = 0;
    for (let x = -1; x <= 1; x++) if (dots[x + 2]) pattern |= 1 << (x & 3);
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const entering = x + 2;
      const phase = entering & 3;
      pattern = (pattern & ~(1 << phase)) | ((entering < SCREEN_WIDTH ? dots[entering + 2] : 0) << phase);
      const value = PALETTE[pattern];
      fb[row + x] = value;
      fb[row + SCREEN_WIDTH + x] = value;
    }
  }
}
