import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cpu6502, type CpuBus, type CpuVariant } from '../src/cpu/cpu6502';

const fixtures = join(import.meta.dirname, 'fixtures');

class FlatBus implements CpuBus {
  readonly memory = new Uint8Array(0x10000);
  read(addr: number): number {
    return this.memory[addr];
  }
  write(addr: number, value: number): void {
    this.memory[addr] = value;
  }
}

/** Runs a Dormann test from $0400 until it traps in a loop; returns where. */
function runDormann(file: string, variant: CpuVariant, maxCycles: number): number {
  const bus = new FlatBus();
  bus.memory.set(readFileSync(join(fixtures, 'dormann', file)));
  const cpu = new Cpu6502(bus, variant, true);
  cpu.pc = 0x0400;
  while (cpu.totalCycles < maxCycles) {
    const pc = cpu.pc;
    cpu.step();
    if (cpu.pc === pc) return pc;
  }
  return -1;
}

const dormann = existsSync(join(fixtures, 'dormann'));

describe.skipIf(!dormann)("Klaus Dormann's functional tests", () => {
  it('passes the 6502 functional test', () => {
    expect(runDormann('6502_functional_test.bin', 'nmos', 200_000_000).toString(16)).toBe('3469');
  });

  it('passes the 65C02 extended opcodes test', () => {
    expect(runDormann('65C02_extended_opcodes_test.bin', 'cmos', 200_000_000).toString(16)).toBe('24f1');
  });
});

interface CpuState {
  pc: number;
  s: number;
  a: number;
  x: number;
  y: number;
  p: number;
  ram: [number, number][];
}

interface SingleStepTest {
  name: string;
  initial: CpuState;
  final: CpuState;
  cycles: unknown[];
}

/** The NMOS opcodes whose results depend on the chip's analogue behaviour. */
const UNSTABLE = new Set([0x8b, 0xab]);

function runSingleStep(variant: CpuVariant, dir: string): string[] {
  const failures: string[] = [];
  for (const file of readdirSync(dir).sort()) {
    const opcode = parseInt(file, 16);
    if (variant === 'nmos' && UNSTABLE.has(opcode)) continue;
    const tests = JSON.parse(readFileSync(join(dir, file), 'utf8')) as SingleStepTest[];
    for (const test of tests) {
      const bus = new FlatBus();
      const cpu = new Cpu6502(bus, variant, true);
      const { initial, final } = test;
      for (const [addr, value] of initial.ram) bus.memory[addr] = value;
      Object.assign(cpu, { pc: initial.pc, sp: initial.s, a: initial.a, x: initial.x, y: initial.y });
      cpu.status = initial.p;
      const cycles = cpu.step();
      // NMOS JAM opcodes halt; the tests model them differently.
      if (cpu.jammedAt >= 0) break;
      const got = { pc: cpu.pc, s: cpu.sp, a: cpu.a, x: cpu.x, y: cpu.y, p: cpu.status | 0x30 };
      const want = { pc: final.pc, s: final.s, a: final.a, x: final.x, y: final.y, p: final.p | 0x30 };
      const ramWrong = final.ram.filter(([addr, value]) => bus.memory[addr] !== value);
      if (JSON.stringify(got) !== JSON.stringify(want) || ramWrong.length || cycles !== test.cycles.length) {
        failures.push(
          `${test.name}: got ${JSON.stringify(got)} in ${cycles} cycles, want ${JSON.stringify(want)} in ${test.cycles.length}` +
            (ramWrong.length ? `, memory ${JSON.stringify(ramWrong)}` : ''),
        );
        break;
      }
    }
  }
  return failures;
}

const harte = (variant: string) => join(fixtures, '65x02', variant);

describe("Tom Harte's 65x02 single-step tests", () => {
  it.skipIf(!existsSync(harte('6502')))('match the NMOS 6502 on every opcode', () => {
    expect(runSingleStep('nmos', harte('6502'))).toEqual([]);
  });

  it.skipIf(!existsSync(harte('rockwell65c02')))('match the Rockwell 65C02 on every opcode', () => {
    expect(runSingleStep('cmos', harte('rockwell65c02'))).toEqual([]);
  });
});
