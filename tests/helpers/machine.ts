import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Apple2, CLOCK_HZ, type Model, type Roms } from '../../src/apple2';
import { textRowOffset } from '../../src/video/video';

/** Your own ROMs, in roms/ (never committed), as AppleWin names them. */
const romDir = join(import.meta.dirname, '..', '..', 'roms');
const ROM_FILES = {
  enhanced: 'Apple2e_Enhanced.rom',
  original: 'Apple2e.rom',
  plus: 'Apple2_Plus.rom',
  ii: 'Apple2.rom',
  video: 'Apple2e_Enhanced_Video.rom',
  video2: 'Apple2_Video.rom',
  disk: 'DISK2.rom',
};

/** The machines the tests run: both IIe ROMs, the II Plus and the II. */
export type TestModel = 'enhanced' | 'original' | 'plus' | 'ii';
const MODELS: Record<TestModel, Model> = { enhanced: 'iie', original: 'iie', plus: 'iiplus', ii: 'ii' };

export const hasRoms = Object.values(ROM_FILES).every((file) => existsSync(join(romDir, file)));

export function loadRoms(model: TestModel = 'enhanced'): Roms {
  const read = (file: string) => new Uint8Array(readFileSync(join(romDir, file)));
  const video = MODELS[model] === 'iie' ? ROM_FILES.video : ROM_FILES.video2;
  return { main: read(ROM_FILES[model]), video: read(video), disk: read(ROM_FILES.disk) };
}

export function machine(model: TestModel = 'enhanced'): Apple2 {
  return new Apple2(loadRoms(model), MODELS[model]);
}

export function runSeconds(apple: Apple2, seconds: number): void {
  apple.runCycles(Math.round(seconds * CLOCK_HZ));
}

/** A screen code as the character it shows (inverse and flashing shown as plain). */
function screenChar(code: number): string {
  const c = code & 0x7f;
  if (code >= 0x80) return String.fromCharCode(c < 0x20 ? c + 0x40 : c);
  return String.fromCharCode((c & 0x3f) < 0x20 ? (c & 0x3f) + 0x40 : c & 0x3f);
}

/** The 40-column text page as 24 lines. */
export function screenText(apple: Apple2, page = 1): string[] {
  const lines: string[] = [];
  for (let row = 0; row < 24; row++) {
    const base = page * 0x400 + textRowOffset(row);
    let line = '';
    for (let col = 0; col < 40; col++) line += screenChar(apple.main[base + col]);
    lines.push(line.trimEnd());
  }
  return lines;
}

/** Types text as if on the keyboard, waiting for each key to be taken. */
export function typeText(apple: Apple2, text: string): void {
  for (const char of text) {
    apple.pressKey(char === '\n' ? 0x0d : char.charCodeAt(0));
    for (let i = 0; i < 100 && apple.keyStrobe; i++) apple.runCycles(1000);
    apple.runCycles(5000);
  }
}
