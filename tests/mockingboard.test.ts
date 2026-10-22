import { describe, expect, it } from 'vitest';
import { CLOCK_HZ } from '../src/apple2';
import { testMachine } from './helpers/rom';

/** Writes an AY register through the first VIA, as Mockingboard drivers do. */
function writeAy(apple: ReturnType<typeof testMachine>, register: number, value: number): void {
  apple.write(0xc401, register); // ORA: the register number
  apple.write(0xc400, 0x07); // ORB: latch address
  apple.write(0xc400, 0x04); // inactive
  apple.write(0xc401, value);
  apple.write(0xc400, 0x06); // write data
  apple.write(0xc400, 0x04);
}

describe('the Mockingboard', () => {
  it('passes register writes through the VIA to the AY', () => {
    const apple = testMachine();
    apple.write(0xc402, 0xff); // DDRB
    apple.write(0xc403, 0xff); // DDRA
    writeAy(apple, 0, 0x40);
    writeAy(apple, 8, 0x0f);
    writeAy(apple, 7, 0x3e);
    const ay = apple.mockingboard.chips[0].ay;
    expect(ay.registers[0]).toBe(0x40);
    expect(ay.registers[8]).toBe(0x0f);
    expect(ay.registers[7]).toBe(0x3e);
    expect(apple.mockingboard.chips[1].ay.registers[8]).toBe(0);
  });

  it('plays a tone', () => {
    const apple = testMachine();
    apple.audio.setRates(CLOCK_HZ, 48_000);
    apple.write(0xc402, 0xff);
    apple.write(0xc403, 0xff);
    writeAy(apple, 0, 0x80);
    writeAy(apple, 8, 0x0f);
    writeAy(apple, 7, 0x3e);
    apple.runCycles(CLOCK_HZ / 10);
    const samples = apple.audio.takeSamples();
    const left = samples.filter((_, i) => i % 2 === 0);
    const peak = left.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeGreaterThan(0.05);
  });

  it('interrupts from VIA timer 1 when enabled', () => {
    const apple = testMachine();
    apple.write(0xc40b, 0x40); // ACR: T1 free-running
    apple.write(0xc40e, 0xc0); // IER: enable T1
    apple.write(0xc404, 0x00);
    apple.write(0xc405, 0x10); // T1 = $1000, starts it
    expect(apple.mockingboard.irq).toBe(false);
    apple.runCycles(0x1100);
    expect(apple.mockingboard.irq).toBe(true);
    apple.read(0xc404); // reading T1 low clears the flag
    expect(apple.mockingboard.irq).toBe(false);
  });

  it('is gone from slot 4 when switched off', () => {
    const apple = testMachine();
    apple.setMockingboard(false);
    apple.write(0xc402, 0xff);
    expect(apple.mockingboard.chips[0].via.read(2)).toBe(0);
  });
});
