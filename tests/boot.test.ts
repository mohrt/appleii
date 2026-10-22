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

describe.skipIf(!hasRoms)('the Apple II Plus and Apple II', () => {
  it('starts the II Plus in Applesoft when Ctrl-Reset stops the disk boot, typing in capitals', () => {
    const apple = machine('plus');
    runSeconds(apple, 0.5);
    expect(screenText(apple)[0]).toContain('APPLE ][');
    apple.reset();
    runSeconds(apple, 0.5);
    typeText(apple, 'print 6*7\n');
    runSeconds(apple, 0.3);
    const text = screenText(apple);
    expect(text).toContain(']PRINT 6*7');
    expect(text).toContain('42');
  });

  it('has no IIe soft switches, 80 columns or auxiliary memory on the II Plus', () => {
    const apple = machine('plus');
    apple.write(0xc005, 0); // RAMWRT on a IIe
    apple.write(0x2000, 0x55);
    expect(apple.main[0x2000]).toBe(0x55);
    expect(apple.aux[0x2000]).toBe(0);
    apple.write(0xc00d, 0); // 80COL on a IIe
    expect(apple.videoSwitches.col80).toBe(false);
  });

  it('starts the original Apple II in the Monitor, with Integer BASIC a Ctrl-B away', () => {
    const apple = machine('ii');
    runSeconds(apple, 0.5);
    expect(screenText(apple).some((line) => line.startsWith('*'))).toBe(true);
    typeText(apple, '\x02\n');
    runSeconds(apple, 0.3);
    typeText(apple, 'PRINT 6*7\n');
    runSeconds(apple, 0.3);
    const text = screenText(apple);
    expect(text).toContain('>PRINT 6*7');
    expect(text).toContain('42');
  });
});
