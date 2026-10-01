// Gamepad support (Xbox / PlayStation / generic "standard" layout).
// Buttons are turned into the same key codes the keyboard uses, so every action
// (jump, headbutt, menu, respawn...) goes through the normal keydown/keyup handlers.
// Sticks are read every frame: left = walk (analog), right = camera.

// standard mapping button index -> key code
const BUTTONS = {
  0: 'Space',      // A / ✕       jump (and respawn when dead)
  1: 'KeyZ',       // B / ○       lie down / stand up
  2: 'KeyE',       // X / □       graze / drink (hold)
  3: 'KeyQ',       // Y / △       moo
  4: 'ShiftLeft',  // LB / L1     run (hold)
  5: 'KeyF',       // RB / R1     headbutt
  6: 'ShiftLeft',  // LT / L2     run (hold)
  7: 'KeyF',       // RT / R2     headbutt
  8: 'KeyG',       // View / Share  clan manager
  9: 'Escape',     // Menu / Options  settings
  14: 'KeyC',      // D-pad left  cinematic mode
  15: 'KeyM',      // D-pad right milk the cow (in the barn)
};
const DEAD = 0.18; // stick dead zone

function stick(x, y) {
  const m = Math.hypot(x, y);
  if (m < DEAD) return [0, 0, 0];
  const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m; // rescale so movement starts smoothly at the dead zone
  return [x * k, y * k, Math.min(1, m * k)];
}

export class GamepadInput {
  constructor({ onKey, onConnect }) {
    this.onKey = onKey;           // (code, down) -> void
    this.onConnect = onConnect;   // (name, connected) -> void
    this.index = -1;
    this.prev = [];
    this.held = new Map();        // code -> number of buttons holding it
    this.move = { x: 0, y: 0, m: 0 };
    this.look = { x: 0, y: 0 };
    this.zoom = 0;                // -1..1 from the D-pad up/down
    this.recenter = false;        // right stick click
    addEventListener('gamepadconnected', (e) => {
      if (this.index < 0) this.index = e.gamepad.index;
      this.onConnect?.(e.gamepad.id, true);
    });
    addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index !== this.index) return;
      this.releaseAll();
      this.index = -1;
      this.onConnect?.(e.gamepad.id, false);
    });
  }

  get connected() { return this.index >= 0; }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let p = pads[this.index];
    if (!p) { // pick up a pad that was plugged in before the page loaded
      p = [...pads].find(Boolean);
      if (p) this.index = p.index;
    }
    return p || null;
  }

  press(code, down) {
    const n = (this.held.get(code) || 0) + (down ? 1 : -1);
    if (n > 0) this.held.set(code, n); else this.held.delete(code);
    // only report the first press / last release of a key shared by two buttons
    if ((down && n === 1) || (!down && n <= 0)) this.onKey(code, down);
  }

  releaseAll() {
    for (const code of this.held.keys()) this.onKey(code, false);
    this.held.clear();
    this.prev = [];
  }

  // call once per frame
  poll() {
    const p = this.pad();
    if (!p) { this.move.x = this.move.y = this.move.m = 0; this.look.x = this.look.y = 0; this.zoom = 0; return false; }
    const b = p.buttons.map((x) => x.pressed || x.value > 0.5);
    for (const [i, code] of Object.entries(BUTTONS)) {
      if (b[i] && !this.prev[i]) this.press(code, true);
      else if (!b[i] && this.prev[i]) this.press(code, false);
    }
    this.recenter = b[11] && !this.prev[11];
    this.zoom = (b[13] ? 1 : 0) - (b[12] ? 1 : 0);
    this.prev = b;
    const a = p.axes;
    const [mx, my, mm] = stick(a[0] || 0, a[1] || 0);
    this.move.x = mx; this.move.y = my; this.move.m = mm;
    const [lx, ly] = stick(a[2] || 0, a[3] || 0);
    this.look.x = lx; this.look.y = ly;
    return true;
  }

  rumble(strength, ms = 180) {
    const p = this.pad();
    const act = p && p.vibrationActuator;
    if (!act || !act.playEffect) return;
    try {
      act.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strength), weakMagnitude: Math.min(1, strength * 0.6) });
    } catch {}
  }
}
