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
    expect(modelName('iie', rom.data)).toBe('Enhanced Apple IIe');
  });

  it('turns away other Apples', () => {
    const iic = testRoms().main.slice();
    iic[0xfbc0 - 0xc000] = 0x00;
    expect(() => identifyRom('iic.rom', iic)).toThrow(/IIc/);
    expect(() => identifyRom('p6.rom', new Uint8Array(256))).toThrow(NotARom);
  });

  it("tells the II Plus's 12K ROM from the II's by Applesoft, and takes their 2K character ROM", () => {
    const applesoft = new Uint8Array(0x3000);
    applesoft.set([0x48, 0x47, 0x52, 0xb2], 0x100); // the HGR2 token
    expect(identifyRom('plus.rom', applesoft).kind).toBe('plus');
    expect(identifyRom('ii.rom', new Uint8Array(0x3000)).kind).toBe('ii');
    expect(identifyRom('chars.rom', new Uint8Array(0x800)).kind).toBe('video2');
    const roms = {
      plus: { name: 'p', data: applesoft },
      video2: { name: 'c', data: new Uint8Array(0x800) },
      disk: { name: 'd', data: testRoms().disk },
    };
    expect(hasRequiredRoms(roms, 'iiplus')).toBe(true);
    expect(hasRequiredRoms(roms, 'ii')).toBe(false);
    expect(machineRoms(roms, 'iiplus').main).toBe(applesoft);
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
    expect(hasRequiredRoms(roms, 'iie')).toBe(false);
    const all = { ...roms, video: { name: 'v', data: testRoms().video }, disk: { name: 'd', data: testRoms().disk } };
    expect(hasRequiredRoms(all, 'iie')).toBe(true);
    expect(hasRequiredRoms(all, 'iiplus')).toBe(false);
    expect(machineRoms(all, 'iie').main).toEqual(main);
  });

  it.skipIf(!hasRoms)("recognises Apple's own chips", () => {
    const roms = loadRoms('enhanced');
    expect(identifyRom('Apple2e_Enhanced.rom', roms.main)).toMatchObject({ kind: 'main', warning: null });
    expect(identifyRom('342-0304-a.e10', roms.main.slice(0, 0x2000))).toMatchObject({ kind: 'mainCD', warning: null });
    expect(identifyRom('342-0303-a.e8', roms.main.slice(0x2000))).toMatchObject({ kind: 'mainEF', warning: null });
    expect(identifyRom('video', roms.video)).toMatchObject({ kind: 'video', warning: null });
    expect(identifyRom('DISK2.rom', roms.disk)).toMatchObject({ kind: 'disk', warning: null });
    expect(modelName('iie', loadRoms('original').main)).toBe('Apple IIe');
    expect(identifyRom('Apple2_Plus.rom', loadRoms('plus').main)).toMatchObject({ kind: 'plus', warning: null });
    expect(identifyRom('Apple2.rom', loadRoms('ii').main)).toMatchObject({ kind: 'ii', warning: null });
    expect(identifyRom('Apple2_Video.rom', loadRoms('plus').video)).toMatchObject({ kind: 'video2', warning: null });
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
