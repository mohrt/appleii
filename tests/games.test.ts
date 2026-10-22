import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLOCK_HZ, type Apple2 } from '../src/apple2';
import { FloppyDisk } from '../src/disk/floppy';
import { parseGameManifest, runsOn, type Machine } from '../src/games';
import { hasRoms, machine, runSeconds, type TestModel } from './helpers/machine';
import { framePng } from './helpers/png';

// Disk images are never committed. These boot the free games (`npm run fetch:games` puts
// them in public/games/) and any of your own you put in disks/, on your ROMs in roms/.
const root = join(import.meta.dirname, '..');
const EXTENSION = /\.(dsk|do|po|nib|woz)$/i;
const diskFiles = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((name) => EXTENSION.test(name)).map((name) => join(dir, name)) : [];
const MODELS: Record<Machine, TestModel> = { ii: 'ii', iiplus: 'plus', iie: 'original', 'enhanced-iie': 'enhanced' };
const manifestPath = join(root, 'public', 'games', 'index.json');
const freeGames = existsSync(manifestPath) ? parseGameManifest(JSON.parse(readFileSync(manifestPath, 'utf8'))) : [];
/** Each disk with the machines to boot it on: the free games on the IIc and the oldest machine they say they run on too. */
const runs: { path: string; model: TestModel }[] = [...diskFiles(join(root, 'public', 'games')), ...diskFiles(join(root, 'disks'))].flatMap((path) => {
  const game = freeGames.find((entry) => join(root, 'public', 'games', entry.file) === path);
  const oldest = game?.requires ? MODELS[game.requires] : 'enhanced';
  // The IIc runs everything the enhanced IIe does.
  const models: TestModel[] = game ? ['enhanced', 'iic', oldest] : ['enhanced'];
  return [...new Set(models)].map((model) => ({ path, model }));
});
const BOOT_SECONDS = Number(process.env.BOOT_SECONDS ?? 60);
const PLAY_SECONDS = Number(process.env.PLAY_SECONDS ?? 10);
/** Set SHOTS=<dir> to save screenshots of the title screen and after pressing keys. */
const shotsDir = process.env.SHOTS;

function screenshot(apple: Apple2, name: string): void {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  writeFileSync(join(shotsDir, `${name}.png`), framePng(apple));
}

const litPixels = (apple: Apple2) => apple.video.framebuffer.reduce((count, pixel) => count + ((pixel & 0xffffff) !== 0 ? 1 : 0), 0);

describe('the free games manifest', () => {
  it.skipIf(!existsSync(manifestPath))('lists games whose files are there', () => {
    expect(freeGames.length).toBeGreaterThan(0);
    for (const game of freeGames) expect(existsSync(join(root, 'public', 'games', game.file)), game.file).toBe(true);
  });

  it('offers each machine the games it can run: those for older machines too', () => {
    const games = parseGameManifest({
      games: [
        { title: 'Anywhere', file: 'a.dsk' },
        { title: 'Plus', file: 'b.dsk', requires: 'iiplus' },
        { title: 'Enhanced', file: 'c.dsk', requires: 'enhanced-iie' },
        { title: 'Unknown', file: 'd.dsk', requires: 'iigs' },
      ],
    });
    const titles = (machine: Machine) => games.filter((game) => runsOn(game, machine)).map((game) => game.title);
    expect(titles('ii')).toEqual(['Anywhere', 'Unknown']);
    expect(titles('iiplus')).toEqual(['Anywhere', 'Plus', 'Unknown']);
    expect(titles('iie')).toEqual(['Anywhere', 'Plus', 'Unknown']);
    expect(titles('enhanced-iie')).toEqual(['Anywhere', 'Plus', 'Enhanced', 'Unknown']);
  });
});

describe.skipIf(runs.length === 0 || !hasRoms)('games', () => {
  for (const { path, model } of runs) {
    const name = `${path.slice(path.lastIndexOf('/') + 1).replace(EXTENSION, '')} on ${model}`;
    it(`${name} boots, draws a picture and keeps running`, () => {
      const apple = machine(model);
      apple.insertDisk(0, FloppyDisk.fromImage(path, new Uint8Array(readFileSync(path))));
      // The Apple II starts in its Monitor, where C600G boots the disk.
      if (model === 'ii') apple.typeKeys('C600G\n');
      runSeconds(apple, BOOT_SECONDS);
      screenshot(apple, `${name} - title`);
      expect(apple.cpu.jammedAt, 'the CPU is running').toBe(-1);
      expect(litPixels(apple), 'something on the screen').toBeGreaterThan(100);
      // Press Space, Return and the button a few times, as a player would, then let it run.
      for (let second = 0; second < PLAY_SECONDS; second++) {
        if (second < 4) {
          apple.pressKey(second % 2 ? 0x0d : 0x20);
          apple.buttons[0] = true;
        }
        apple.runCycles(CLOCK_HZ / 10);
        apple.buttons[0] = false;
        apple.runCycles((CLOCK_HZ * 9) / 10);
      }
      screenshot(apple, `${name} - later`);
      expect(apple.video.frames).toBeGreaterThan((BOOT_SECONDS + PLAY_SECONDS) * 59);
    }, 120_000);
  }
});
