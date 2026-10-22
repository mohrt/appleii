import { describe, expect, it } from 'vitest';
import { hasRoms, machine, runSeconds, screenText, typeText } from './helpers/machine';

describe.skipIf(!hasRoms)('booting with your ROMs', () => {
  it('shows the enhanced IIe banner and looks for a disk', () => {
    const apple = machine('enhanced');
    runSeconds(apple, 1);
    expect(apple.enhanced).toBe(true);
    expect(screenText(apple).join('\n')).toContain('Apple //e');
    expect(apple.disk2.motorOn).toBe(true);
  });

  it('drops into Applesoft on Ctrl-Reset and runs a program', () => {
    const apple = machine('enhanced');
    runSeconds(apple, 0.5);
    apple.reset();
    runSeconds(apple, 0.5);
    typeText(apple, '10 PRINT 6*7\nRUN\n');
    runSeconds(apple, 0.5);
    const text = screenText(apple);
    expect(text).toContain(']RUN');
    expect(text).toContain('42');
  });

  it('switches to 80 columns with PR#3, half the characters in auxiliary memory', () => {
    const apple = machine('enhanced');
    runSeconds(apple, 0.5);
    apple.reset();
    runSeconds(apple, 0.5);
    typeText(apple, 'PR#3\nPRINT "HELLO"\n');
    runSeconds(apple, 0.5);
    expect(apple.videoSwitches.col80).toBe(true);
    expect(apple.videoSwitches.store80).toBe(true);
    const text = [...apple.main.subarray(0x400, 0x800), ...apple.aux.subarray(0x400, 0x800)].map((c) => String.fromCharCode(c & 0x7f)).join('');
    expect(text).toContain('HL');
    expect(text).toContain('EL');
  });

  it('starts the original IIe on an NMOS 6502', () => {
    const apple = machine('original');
    runSeconds(apple, 1);
    expect(apple.enhanced).toBe(false);
    expect(screenText(apple).join('\n')).toContain('Apple ][');
  });
});
