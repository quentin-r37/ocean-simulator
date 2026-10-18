/** Collects mouse / keyboard state from the canvas. */
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
  private keys = new Set<string>();
  private pressed = new Set<string>();

  constructor(el: HTMLElement) {
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

  down(code: string): boolean {
    return this.keys.has(code);
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
