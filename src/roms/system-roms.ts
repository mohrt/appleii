import { isEnhancedRom, type Model, type Roms } from '../apple2';
import type { KeyValueStore } from '../storage/store';
import { crc32 } from '../util/crc32';

/**
 * The ROMs kept: the IIe's main ROM (or one of its two chips until both are
 * given) and video ROM, the II Plus's and the II's 12K ROMs and their 2K
 * character ROM, and the Disk II ROM all of them use.
 */
export type RomKind = 'main' | 'mainCD' | 'mainEF' | 'video' | 'plus' | 'ii' | 'video2' | 'disk';
export const ROM_KINDS: readonly RomKind[] = ['main', 'mainCD', 'mainEF', 'video', 'plus', 'ii', 'video2', 'disk'];
/** The rows of the setup panel. */
export type RomSlot = 'main' | 'video' | 'plus' | 'ii' | 'video2' | 'disk';
/** The ROMs each model needs. */
export const MODEL_ROMS: Record<Model, readonly RomSlot[]> = {
  iie: ['main', 'video', 'disk'],
  iiplus: ['plus', 'video2', 'disk'],
  ii: ['ii', 'video2', 'disk'],
};
export const MODEL_NAMES: Record<Model, string> = { ii: 'Apple II', iiplus: 'Apple II Plus', iie: 'Apple IIe' };

const MAIN_SIZE = 0x4000;
const CHIP_SIZE = 0x2000;
const II_SIZE = 0x3000;
const VIDEO_SIZE = 0x1000;
const VIDEO2_SIZE = 0x800;
const DISK_SIZE = 0x100;
export const ROM_FILE_SIZES = new Set([MAIN_SIZE, CHIP_SIZE, II_SIZE, VIDEO_SIZE, VIDEO2_SIZE, DISK_SIZE]);

/** CRC-32s of Apple's chips. */
const KNOWN: Record<number, { kind: RomKind; title: string }> = {
  0x443aa7c4: { kind: 'mainCD', title: 'enhanced IIe, 342-0304' },
  0x95e10034: { kind: 'mainEF', title: 'enhanced IIe, 342-0303' },
  0xe248835e: { kind: 'mainCD', title: 'original IIe, 342-0135' },
  0xfc3d59d8: { kind: 'mainEF', title: 'original IIe, 342-0134' },
  0x2651014d: { kind: 'video', title: 'enhanced IIe video, 342-0265' },
  0xb081df66: { kind: 'video', title: 'original IIe video, 342-0133' },
  0x1d05c1b1: { kind: 'plus', title: 'Apple II Plus, Applesoft and the Autostart Monitor' },
  0x2af3a6c1: { kind: 'ii', title: 'Apple II, Integer BASIC and the Monitor' },
  0x64f415c6: { kind: 'video2', title: 'Apple II character ROM, 341-0036' },
  0xce7144f6: { kind: 'disk', title: 'Disk II, 341-0027' },
};

/** Applesoft's HGR2 token (the last letter has its top bit set); Integer BASIC has no HGR. */
const APPLESOFT_TOKEN = [0x48, 0x47, 0x52, 0xb2];

function hasApplesoft(data: Uint8Array): boolean {
  for (let i = 0; i + APPLESOFT_TOKEN.length <= data.length; i++) {
    if (APPLESOFT_TOKEN.every((byte, j) => data[i + j] === byte)) return true;
  }
  return false;
}

export interface StoredRom {
  /** The file it came from, shown to the user. */
  name: string;
  data: Uint8Array;
}

export interface IdentifiedRom extends StoredRom {
  kind: RomKind;
  /** Set when the file is the right size but not one of Apple's ROMs. */
  warning: string | null;
}

export type SystemRoms = Partial<Record<RomKind, StoredRom>>;

/** Files of other sizes in a collection that are skipped quietly rather than reported. */
export class NotARom extends Error {}

const baseName = (name: string) => name.split('/').pop()!;

/** The Monitor's ID bytes: $FBB3 is $06 on a IIe or IIc, and $FBC0 is $EA or $E0 on a IIe ($00 on a IIc). */
function isIIeRom(main: Uint8Array): boolean {
  const id = main[0xfbb3 - 0xc000];
  const version = main[0xfbc0 - 0xc000];
  return id === 0x06 && (version === 0xea || version === 0xe0);
}

/** The Disk II's 16-sector boot ROM has the slot signature bytes $20, $00, $03 and $3C at 1, 3, 5 and 7. */
function isDiskRom(data: Uint8Array): boolean {
  return data[1] === 0x20 && data[3] === 0x00 && data[5] === 0x03 && data[7] === 0x3c;
}

/** Of the IIe's two 8K chips, the one at $E000 ends with the 6502's vectors, which point into the ROM. */
function looksLikeEfChip(data: Uint8Array): boolean {
  const reset = data[CHIP_SIZE - 4] | (data[CHIP_SIZE - 3] << 8);
  const irq = data[CHIP_SIZE - 2] | (data[CHIP_SIZE - 1] << 8);
  return reset >= 0xf800 && irq >= 0xc000;
}

/** Works out which ROM a file is; throws if it can't be one. */
export function identifyRom(name: string, data: Uint8Array): IdentifiedRom {
  const known = KNOWN[crc32(data)];
  if (known) return { kind: known.kind, name, data, warning: null };
  const unknown = 'not one of Apple\'s ROMs; some software may not work with it';
  switch (data.length) {
    case MAIN_SIZE:
      if (!isIIeRom(data)) {
        throw new Error(`${baseName(name)} is 16K but not an Apple IIe ROM (Apple IIc ROMs won't work: the IIc has no slots).`);
      }
      return { kind: 'main', name, data, warning: KNOWN[crc32(data.subarray(0, CHIP_SIZE))] ? null : unknown };
    case CHIP_SIZE:
      return { kind: looksLikeEfChip(data) ? 'mainEF' : 'mainCD', name, data, warning: unknown };
    case VIDEO_SIZE:
      return { kind: 'video', name, data, warning: unknown };
    case II_SIZE:
      return { kind: hasApplesoft(data) ? 'plus' : 'ii', name, data, warning: unknown };
    case VIDEO2_SIZE:
      return { kind: 'video2', name, data, warning: unknown };
    case DISK_SIZE:
      if (!isDiskRom(data)) {
        throw new NotARom(`${baseName(name)} is 256 bytes but not the Disk II's 16-sector boot ROM (341-0027).`);
      }
      return { kind: 'disk', name, data, warning: unknown };
    default:
      throw new NotARom(
        `${baseName(name)} is ${data.length.toLocaleString('en')} bytes, which isn't an Apple II ROM. ` +
          "The IIe's ROM is 16,384 bytes (or two chips of 8,192) and its video ROM 4,096; the II's and II Plus's ROM " +
          'is 12,288 bytes and their character ROM 2,048; the Disk II ROM is 256.',
      );
  }
}

/** The main ROM, from its single file or both chips. */
export function mainRom(roms: SystemRoms): Uint8Array | null {
  if (roms.main) return roms.main.data;
  if (!roms.mainCD || !roms.mainEF) return null;
  const main = new Uint8Array(MAIN_SIZE);
  main.set(roms.mainCD.data);
  main.set(roms.mainEF.data, CHIP_SIZE);
  return main;
}

export function hasRom(roms: SystemRoms, slot: RomSlot): boolean {
  return slot === 'main' ? mainRom(roms) !== null : roms[slot] !== undefined;
}

export function hasRequiredRoms(roms: SystemRoms, model: Model): boolean {
  return MODEL_ROMS[model].every((slot) => hasRom(roms, slot));
}

/** The ROMs a model maps in; throws if any is missing. */
export function machineRoms(roms: SystemRoms, model: Model): Roms {
  if (!hasRequiredRoms(roms, model)) throw new Error(`The ${MODEL_NAMES[model]} needs its ROMs: load them in Machine setup.`);
  const main = model === 'iie' ? mainRom(roms)! : roms[model === 'iiplus' ? 'plus' : 'ii']!.data;
  const video = roms[model === 'iie' ? 'video' : 'video2']!.data;
  return { main, video, disk: roms.disk!.data };
}

/** The model's name, telling the enhanced IIe from the original by its ROM. */
export function modelName(model: Model, main: Uint8Array): string {
  return model === 'iie' && isEnhancedRom(main) ? 'Enhanced Apple IIe' : MODEL_NAMES[model];
}

/** The CRC-32 of the ROMs a state was saved with: states only make sense with the same ones. */
export function romsCrc(roms: Roms): number {
  const all = new Uint8Array(roms.main.length + roms.video.length);
  all.set(roms.main);
  all.set(roms.video, roms.main.length);
  return crc32(all);
}

/**
 * The user's ROMs, kept in browser storage (IndexedDB) so they only have to be
 * given once. Saving asks the browser to make the storage persistent, which
 * stops it evicting the ROMs under storage pressure.
 */
export class SystemRomStore {
  constructor(private readonly store: KeyValueStore<StoredRom>) {}

  async load(): Promise<SystemRoms> {
    const roms: SystemRoms = {};
    for (const [key, rom] of await this.store.entries()) {
      if (ROM_KINDS.includes(key as RomKind)) roms[key as RomKind] = rom;
    }
    return roms;
  }

  async save(kind: RomKind, rom: StoredRom): Promise<void> {
    void globalThis.navigator?.storage?.persist?.().catch(() => false);
    await this.store.put(kind, { name: rom.name, data: rom.data });
    // A whole ROM replaces its chips, and a chip the whole ROM.
    if (kind === 'main') await Promise.all([this.store.delete('mainCD'), this.store.delete('mainEF')]);
    if (kind === 'mainCD' || kind === 'mainEF') await this.store.delete('main');
  }

  async forget(): Promise<void> {
    await Promise.all(ROM_KINDS.map((kind) => this.store.delete(kind)));
  }
}
