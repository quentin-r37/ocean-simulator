/**
 * Gamepad buttons (W3C "standard" mapping, PlayStation / Xbox names), exposed as virtual key codes
 * so `down()` / `hit()` work for them like for keyboard keys.
 */
export const PAD = {
  A: 'PadA', // ✕ / A
  B: 'PadB', // ○ / B
  X: 'PadX', // □ / X
  Y: 'PadY', // △ / Y
  L1: 'PadL1',
  R1: 'PadR1',
  L2: 'PadL2',
  R2: 'PadR2',
  Select: 'PadSelect', // Create / View
  Start: 'PadStart', // Options / Menu
  L3: 'PadL3',
  R3: 'PadR3',
  Up: 'PadUp',
  Down: 'PadDown',
  Left: 'PadLeft',
  Right: 'PadRight',
} as const;
const PAD_BUTTONS = Object.values(PAD);
const STICK_DEADZONE = 0.18;
const TRIGGER_THRESHOLD = 0.35;

/** Collects mouse / keyboard / gamepad state from the canvas. */
export class Input {
  mouseX = 0;
  mouseY = 0;
  left = false;
  right = false;
  middle = false;
  shift = false;
  alt = false;
  wheel = 0;
  dragX = 0;
  dragY = 0;
  leftPressed = false; // edge-triggered, consumed by the frame
  private releasePending = false;
  /** Gamepad sticks, dead zone applied (y down is positive). */
  stickL: [number, number] = [0, 0];
  stickR: [number, number] = [0, 0];
  /** The gamepad was used more recently than the mouse: aim at the centre of the screen. */
  usingPad = false;
  /** A gamepad is connected (browsers only report it after one of its buttons was pressed). */
  padConnected = false;
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private pad = new Set<string>();

  constructor(private el: HTMLElement) {
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      if (e.button === 0) {
        this.left = true;
        this.leftPressed = true;
        this.releasePending = false;
      }
      if (e.button === 1) {
        this.middle = true;
        e.preventDefault();
      }
      if (e.button === 2) this.right = true;
      this.updateMods(e);
    });
    el.addEventListener('pointerup', (e) => {
      // A tap (press + release within one frame) still counts as held for that frame.
      if (e.button === 0) {
        if (this.leftPressed) this.releasePending = true;
        else this.left = false;
      }
      if (e.button === 1) this.middle = false;
      if (e.button === 2) this.right = false;
      this.updateMods(e);
    });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.usingPad = false;
      this.dragX += e.movementX;
      this.dragY += e.movementY;
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
      this.updateMods(e);
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        // Trackpad pinch arrives as ctrl+wheel with small deltas.
        this.wheel += e.ctrlKey ? e.deltaY * 4 : e.deltaY * (e.deltaMode === 1 ? 30 : 1);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('.lil-gui')) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (e.key === '+' || e.key === '-') this.pressed.add(e.key);
      this.updateMods(e);
      if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.updateMods(e);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.left = this.right = this.middle = this.shift = this.alt = false;
    });
  }

  private updateMods(e: MouseEvent | KeyboardEvent): void {
    this.shift = e.shiftKey;
    this.alt = e.altKey;
  }

  /** Reads the first connected gamepad; call once at the start of the frame. */
  poll(): void {
    const gp = [...(navigator.getGamepads?.() ?? [])].filter((g): g is Gamepad => !!g?.connected);
    const g = gp.find((g) => g.mapping === 'standard') ?? gp[0];
    this.padConnected = !!g;
    if (!g) {
      this.pad.clear();
      this.stickL = [0, 0];
      this.stickR = [0, 0];
      return;
    }
    const axis = (i: number) => {
      const v = g.axes[i] ?? 0;
      return Math.abs(v) < STICK_DEADZONE ? 0 : (v - Math.sign(v) * STICK_DEADZONE) / (1 - STICK_DEADZONE);
    };
    this.stickL = [axis(0), axis(1)];
    this.stickR = [axis(2), axis(3)];
    let active = [...this.stickL, ...this.stickR].some((v) => v !== 0);
    PAD_BUTTONS.forEach((code, i) => {
      const b = g.buttons[i];
      const on = !!b && (code === PAD.L2 || code === PAD.R2 ? b.value > TRIGGER_THRESHOLD : b.pressed);
      if (on && !this.pad.has(code)) this.pressed.add(code);
      if (on) {
        this.pad.add(code);
        active = true;
      } else this.pad.delete(code);
    });
    if (active) this.usingPad = true;
    if (this.usingPad) {
      this.mouseX = this.el.clientWidth / 2;
      this.mouseY = this.el.clientHeight / 2;
    }
  }

  down(code: string): boolean {
    return this.keys.has(code) || this.pad.has(code);
  }

  /** True once per key press. */
  hit(code: string): boolean {
    return this.pressed.has(code);
  }

  endFrame(): void {
    this.pressed.clear();
    this.wheel = 0;
    this.dragX = 0;
    this.dragY = 0;
    this.leftPressed = false;
    if (this.releasePending) {
      this.left = false;
      this.releasePending = false;
    }
  }
}
