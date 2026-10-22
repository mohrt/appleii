import { describe, expect, it } from 'vitest';
import { readGamepad } from '../src/io/gamepad-input';
import { Joy, Joystick } from '../src/io/joystick';
import { appleKeyCode } from '../src/io/keyboard';
import { testMachine } from './helpers/rom';

const key = (code: string, key: string, modifiers: Partial<KeyboardEvent> = {}) =>
  ({ code, key, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers }) as KeyboardEvent;

describe('the keyboard', () => {
  it('types letters in capitals with Caps Lock, as typed without', () => {
    expect(appleKeyCode(key('KeyA', 'a'), true)).toBe(0x41);
    expect(appleKeyCode(key('KeyA', 'a'), false)).toBe(0x61);
    expect(appleKeyCode(key('Digit1', '!', { shiftKey: true }), true)).toBe(0x21);
  });

  it('makes control codes with Ctrl', () => {
    expect(appleKeyCode(key('KeyC', 'c', { ctrlKey: true }), true)).toBe(0x03);
    expect(appleKeyCode(key('BracketLeft', '[', { ctrlKey: true }), true)).toBe(0x1b);
  });

  it('sends the IIe codes for Return, Escape, Delete and the arrows', () => {
    expect(appleKeyCode(key('Enter', 'Enter'), true)).toBe(0x0d);
    expect(appleKeyCode(key('Escape', 'Escape'), true)).toBe(0x1b);
    expect(appleKeyCode(key('Delete', 'Delete'), true)).toBe(0x7f);
    expect(appleKeyCode(key('ArrowLeft', 'ArrowLeft'), true)).toBe(0x08);
    expect(appleKeyCode(key('ArrowRight', 'ArrowRight'), true)).toBe(0x15);
    expect(appleKeyCode(key('ArrowUp', 'ArrowUp'), true)).toBe(0x0b);
    expect(appleKeyCode(key('ArrowDown', 'ArrowDown'), true)).toBe(0x0a);
    expect(appleKeyCode(key('Shift', 'Shift'), true)).toBeNull();
  });

  it('types the key itself with an Apple key (Option) held, not what Option makes of it', () => {
    expect(appleKeyCode(key('KeyS', 'ß', { altKey: true }), true)).toBe(0x53);
  });
});

describe('the joystick', () => {
  it('puts directions at the ends of the paddles and fire on the buttons', () => {
    const apple = testMachine();
    const joystick = new Joystick();
    joystick.apply(apple, false, false);
    expect(apple.paddles.slice(0, 2)).toEqual([127, 127]);
    joystick.set('keyboard', { bits: Joy.Left | Joy.Down | Joy.Fire, x: 0, y: 0 });
    joystick.apply(apple, false, false);
    expect(apple.paddles.slice(0, 2)).toEqual([0, 255]);
    expect(apple.buttons.slice(0, 2)).toEqual([true, false]);
    joystick.apply(apple, false, true);
    expect(apple.buttons[1]).toBe(true);
  });

  it('follows an analogue stick', () => {
    const apple = testMachine();
    const joystick = new Joystick();
    const pad = { id: 'pad', index: 0, mapping: 'standard', axes: [0.5, -1], buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === 1 })) };
    joystick.set('gamepad', readGamepad(pad));
    joystick.apply(apple, false, false);
    expect(apple.paddles[0]).toBe(191);
    expect(apple.paddles[1]).toBe(0);
    expect(apple.buttons.slice(0, 2)).toEqual([false, true]);
  });
});
