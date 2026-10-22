import { describe, expect, it } from 'vitest';
import { FloppyDisk } from '../src/disk/floppy';
import { DISK_BYTES } from '../src/disk/nibble';
import { encodeState } from '../src/state/snapshot';
import { decodeSession, encodeSession } from '../src/storage/save-states';
import { testMachine } from './helpers/rom';

// INC $10; LDA $C030; LDA $10; STA $0400; STA $C005; STA $2000; STA $C004; JMP $F800:
// counts, clicks the speaker and writes to auxiliary memory.
const PROGRAM = [0xe6, 0x10, 0xad, 0x30, 0xc0, 0xa5, 0x10, 0x8d, 0x00, 0x04, 0x8d, 0x05, 0xc0, 0x8d, 0x00, 0x20, 0x8d, 0x04, 0xc0, 0x4c, 0x00, 0xf8];

describe('save states', () => {
  it('carry the whole Apple, so a restored one runs on exactly as the original', async () => {
    const original = testMachine(PROGRAM);
    original.insertDisk(0, FloppyDisk.fromImage('test.dsk', new Uint8Array(DISK_BYTES)));
    original.runCycles(123_457);
    const bytes = await encodeSession({ machine: original.saveState(), model: 'iie', modelName: 'test', romsCrc: 1, mockingboard: true, disks: [null, null] });
    const session = await decodeSession(bytes);

    const restored = testMachine(PROGRAM);
    restored.loadState(session.machine);
    expect(restored.cycles).toBe(original.cycles);
    original.runCycles(50_000);
    restored.runCycles(50_000);
    expect(restored.cpu.pc).toBe(original.cpu.pc);
    expect(restored.main).toEqual(original.main);
    expect(restored.aux).toEqual(original.aux);
    expect(restored.aux[0x2000]).toBeGreaterThan(0);
  });

  it('read states from before the II and II Plus as the IIe they came from', async () => {
    const bytes = await encodeState({ magic: 'appleii-session', machine: {}, romsCrc: 1, model: 'Enhanced Apple IIe', mockingboard: true, disks: [] });
    expect(await decodeSession(bytes)).toMatchObject({ model: 'iie', modelName: 'Enhanced Apple IIe' });
  });

  it('turn away files that are not save states', async () => {
    await expect(decodeSession(new Uint8Array([1, 2, 3]))).rejects.toThrow('not an Apple II save state');
  });

  it('keep a disk exactly, written tracks and all', () => {
    const disk = FloppyDisk.fromImage('game.po', new Uint8Array(DISK_BYTES).fill(7));
    disk.trackAt(0)![100] ^= 1;
    const restored = FloppyDisk.restore('game.po', disk.format, disk.toWoz());
    expect(restored.format).toBe('prodos');
    expect(restored.trackAt(0)).toEqual(disk.trackAt(0));
  });
});
