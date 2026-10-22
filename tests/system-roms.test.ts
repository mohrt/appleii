import { describe, expect, it } from 'vitest';
import { NotARom, SystemRomStore, hasRequiredRoms, identifyRom, machineRoms, mainRom, modelName } from '../src/roms/system-roms';
import { MemoryStore } from '../src/storage/store';
import { hasRoms, loadRoms } from './helpers/machine';
import { testRoms } from './helpers/rom';

describe('identifying ROMs', () => {
  it('takes an unfamiliar 16K IIe ROM, with a warning', () => {
    const rom = identifyRom('mine.rom', testRoms().main);
    expect(rom.kind).toBe('main');
    expect(rom.warning).toMatch(/not one of Apple's/);
    expect(modelName(rom.data)).toBe('Enhanced Apple IIe');
  });

  it('turns away other Apples', () => {
    const iic = testRoms().main.slice();
    iic[0xfbc0 - 0xc000] = 0x00;
    expect(() => identifyRom('iic.rom', iic)).toThrow(/IIc/);
    expect(() => identifyRom('plus.rom', new Uint8Array(0x3000))).toThrow(/II Plus/);
    expect(() => identifyRom('p6.rom', new Uint8Array(256))).toThrow(NotARom);
  });

  it('tells the two 8K chips apart by the vectors at the end of the $E000 one', () => {
    const main = testRoms().main;
    expect(identifyRom('cd.bin', main.slice(0, 0x2000)).kind).toBe('mainCD');
    expect(identifyRom('ef.bin', main.slice(0x2000)).kind).toBe('mainEF');
  });

  it('joins the chips into the main ROM', () => {
    const main = testRoms().main;
    const roms = { mainCD: { name: 'cd', data: main.slice(0, 0x2000) }, mainEF: { name: 'ef', data: main.slice(0x2000) } };
    expect(mainRom(roms)).toEqual(main);
    expect(hasRequiredRoms(roms)).toBe(false);
    const all = { ...roms, video: { name: 'v', data: testRoms().video }, disk: { name: 'd', data: testRoms().disk } };
    expect(hasRequiredRoms(all)).toBe(true);
    expect(machineRoms(all).main).toEqual(main);
  });

  it.skipIf(!hasRoms)("recognises Apple's own chips", () => {
    const roms = loadRoms('enhanced');
    expect(identifyRom('Apple2e_Enhanced.rom', roms.main)).toMatchObject({ kind: 'main', warning: null });
    expect(identifyRom('342-0304-a.e10', roms.main.slice(0, 0x2000))).toMatchObject({ kind: 'mainCD', warning: null });
    expect(identifyRom('342-0303-a.e8', roms.main.slice(0x2000))).toMatchObject({ kind: 'mainEF', warning: null });
    expect(identifyRom('video', roms.video)).toMatchObject({ kind: 'video', warning: null });
    expect(identifyRom('DISK2.rom', roms.disk)).toMatchObject({ kind: 'disk', warning: null });
    expect(modelName(loadRoms('original').main)).toBe('Apple IIe');
  });
});

describe('the ROM store', () => {
  it('keeps a whole ROM in place of its chips, and the other way round', async () => {
    const store = new SystemRomStore(new MemoryStore());
    const main = testRoms().main;
    await store.save('mainCD', { name: 'cd', data: main.slice(0, 0x2000) });
    await store.save('main', { name: 'main', data: main });
    expect(Object.keys(await store.load())).toEqual(['main']);
    await store.save('mainEF', { name: 'ef', data: main.slice(0x2000) });
    expect(Object.keys(await store.load())).toEqual(['mainEF']);
    await store.forget();
    expect(await store.load()).toEqual({});
  });
});
