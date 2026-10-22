import type { Apple2 } from '../apple2';
import { Joy, type Joystick } from './joystick';

const NUMPAD_KEYS: Record<string, number> = {
  Numpad8: Joy.Up,
  Numpad2: Joy.Down,
  Numpad4: Joy.Left,
  Numpad6: Joy.Right,
  Numpad7: Joy.Up | Joy.Left,
  Numpad9: Joy.Up | Joy.Right,
  Numpad1: Joy.Down | Joy.Left,
  Numpad3: Joy.Down | Joy.Right,
  Numpad0: Joy.Fire,
  Numpad5: Joy.Fire,
  NumpadDecimal: Joy.Fire2,
};

const ARROW_KEYS: Record<string, number> = {
  ArrowUp: Joy.Up,
  ArrowDown: Joy.Down,
  ArrowLeft: Joy.Left,
  ArrowRight: Joy.Right,
  Space: Joy.Fire,
  Slash: Joy.Fire2,
};

const WASD_KEYS: Record<string, number> = {
  KeyW: Joy.Up,
  KeyS: Joy.Down,
  KeyA: Joy.Left,
  KeyD: Joy.Right,
  KeyF: Joy.Fire,
  KeyG: Joy.Fire2,
};

export const KEY_SETS = { off: {}, numpad: NUMPAD_KEYS, arrows: ARROW_KEYS, wasd: WASD_KEYS } as const;
export type KeySetName = keyof typeof KEY_SETS;

/** Keys that aren't characters, as the codes the IIe keyboard sends. */
const SPECIAL_KEYS: Record<string, number> = {
  Enter: 0x0d,
  NumpadEnter: 0x0d,
  Backspace: 0x08,
  Tab: 0x09,
  Escape: 0x1b,
  Delete: 0x7f,
  ArrowLeft: 0x08,
  ArrowRight: 0x15,
  ArrowUp: 0x0b,
  ArrowDown: 0x0a,
};

/** Keys too short to see in a game that reads the joystick once a frame are held this long. */
const MIN_KEY_HOLD_MS = 40;

/** True when a key press belongs to a form field rather than the Apple. */
function typingInField(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return !!target && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));
}

/** The character a key types, ignoring what Option does to it on a Mac (it's an Apple key here). */
function baseCharacter(event: KeyboardEvent): string | null {
  if (!event.altKey && event.key.length === 1) return event.key;
  const code = event.code;
  if (code.startsWith('Key')) return event.shiftKey ? code.slice(3) : code.slice(3).toLowerCase();
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return ' ';
  return event.key.length === 1 ? event.key : null;
}

/** The ASCII code a key press sends, with Ctrl and Caps Lock applied, or null if it sends none. */
export function appleKeyCode(event: KeyboardEvent, capsLock: boolean): number | null {
  const special = SPECIAL_KEYS[event.code];
  if (special !== undefined) return special;
  const char = baseCharacter(event);
  if (char === null) return null;
  let code = char.charCodeAt(0);
  if (code >= 0x80) return null;
  if (event.ctrlKey) {
    // Ctrl makes control codes of letters and @ [ \ ] ^ _.
    const upper = code >= 0x61 && code <= 0x7a ? code - 0x20 : code;
    return upper >= 0x40 && upper <= 0x5f ? upper - 0x40 : null;
  }
  if (capsLock && code >= 0x61 && code <= 0x7a) code -= 0x20;
  return code;
}

/**
 * The browser's keyboard as the IIe's: keys type their characters, Left Alt
 * (Option) is Open Apple and Right Alt is Closed Apple, Ctrl+F12 (or
 * Ctrl+Pause) is Ctrl-Reset. Keys a joystick key set uses move the joystick
 * instead of typing.
 */
export class AppleKeyboard {
  capsLock = true;
  openApple = false;
  closedApple = false;
  /** Called for Ctrl-Reset; with Open Apple held it restarts the Apple. */
  onReset: () => void = () => {};
  /** Called when Caps Lock is pressed, which toggles the Apple's caps lock. */
  onCapsLock: (on: boolean) => void = () => {};
  private keySet: Record<string, number> = {};
  private readonly held = new Set<string>();
  private readonly heldJoystick = new Map<string, number>();
  private readonly pressedAt = new Map<string, number>();

  constructor(
    private readonly apple: Apple2,
    private readonly joystick: Joystick,
  ) {}

  setJoystickKeys(set: KeySetName): void {
    this.heldJoystick.clear();
    this.joystick.clear('keyboard');
    this.keySet = KEY_SETS[set];
  }

  attach(target: Window): void {
    target.addEventListener('keydown', (event) => this.onKey(event, true));
    target.addEventListener('keyup', (event) => this.onKey(event, false));
    target.addEventListener('blur', () => this.releaseAll());
  }

  private releaseAll(): void {
    this.held.clear();
    this.heldJoystick.clear();
    this.joystick.clear('keyboard');
    this.openApple = this.closedApple = false;
    this.apple.anyKeyDown = false;
  }

  private onKey(event: KeyboardEvent, down: boolean): void {
    if (typingInField(event)) return;
    if (event.metaKey) return;
    const code = event.code;
    if (code === 'AltLeft' || code === 'AltRight') {
      if (code === 'AltLeft') this.openApple = down;
      else this.closedApple = down;
      event.preventDefault();
      return;
    }
    if (down && event.ctrlKey && (code === 'F12' || code === 'Pause')) {
      event.preventDefault();
      this.onReset();
      return;
    }
    if (code === 'CapsLock') {
      if (down) {
        this.capsLock = !this.capsLock;
        this.onCapsLock(this.capsLock);
      }
      return;
    }
    const bits = this.keySet[code];
    if (bits !== undefined) {
      event.preventDefault();
      if (down && !event.repeat) this.pressJoystickKey(code, bits);
      else if (!down) this.releaseJoystickKey(code);
      return;
    }
    if (!down) {
      this.held.delete(code);
      this.apple.anyKeyDown = this.held.size > 0;
      return;
    }
    const key = appleKeyCode(event, this.capsLock);
    if (key === null) return;
    event.preventDefault();
    this.held.add(code);
    this.apple.anyKeyDown = true;
    this.apple.pressKey(key);
  }

  private pressJoystickKey(code: string, bits: number): void {
    this.heldJoystick.set(code, bits);
    this.pressedAt.set(code, performance.now());
    this.updateJoystick();
  }

  private releaseJoystickKey(code: string): void {
    const remaining = MIN_KEY_HOLD_MS - (performance.now() - (this.pressedAt.get(code) ?? 0));
    const release = () => {
      this.heldJoystick.delete(code);
      this.updateJoystick();
    };
    if (remaining > 0) setTimeout(release, remaining);
    else release();
  }

  private updateJoystick(): void {
    let bits = 0;
    for (const value of this.heldJoystick.values()) bits |= value;
    this.joystick.set('keyboard', { bits, x: 0, y: 0 });
  }
}
