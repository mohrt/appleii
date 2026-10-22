import { BLOCK_BYTES, DISK35_BLOCKS, DISK35_BYTES, Disk35 } from '../../src/disk/disk35';

/** The last block: on the inner zone's last cylinder, on side 1. */
const LAST_BLOCK = DISK35_BLOCKS - 1;
/** Where the boot program writes the last block to, and reads it back from. */
export const COPY_BLOCK = 800;
/** A JMP ($0000) to the firmware's ProDOS entry point, which the boot program calls. */
const TRAMPOLINE = 0x08f0;

/**
 * An 800K disk whose boot block, through the slot 5 firmware's ProDOS entry
 * point, reads the last block into $2000, writes it to block 800 and reads
 * that back into $3000. It leaves the three calls' error codes at $0300,
 * $0302 and $0303, then $A5 at $0301.
 */
export function bootTestDisk(): Disk35 {
  const code = [0x01, 0x86, 0x43, 0xad, 0xff, 0xc5, 0x85, 0x00, 0xa9, 0xc5, 0x85, 0x01];
  const call = (command: number, buffer: number, block: number, result: number) =>
    code.push(
      ...[0xa9, command, 0x85, 0x42, 0xa9, buffer & 0xff, 0x85, 0x44, 0xa9, buffer >> 8, 0x85, 0x45],
      ...[0xa9, block & 0xff, 0x85, 0x46, 0xa9, block >> 8, 0x85, 0x47],
      ...[0x20, TRAMPOLINE & 0xff, TRAMPOLINE >> 8, 0x8d, result & 0xff, result >> 8],
    );
  call(1, 0x2000, LAST_BLOCK, 0x0300);
  call(2, 0x2000, COPY_BLOCK, 0x0302);
  call(1, 0x3000, COPY_BLOCK, 0x0303);
  code.push(0xa9, 0xa5, 0x8d, 0x01, 0x03);
  const end = 0x800 + code.length;
  code.push(0x4c, end & 0xff, end >> 8);
  const image = new Uint8Array(DISK35_BYTES);
  image.set(code);
  image.set([0x6c, 0x00, 0x00], TRAMPOLINE - 0x800);
  image.set([...'LAST'].map((c) => c.charCodeAt(0)), LAST_BLOCK * BLOCK_BYTES);
  return Disk35.fromImage('boot-test.po', image);
}
