// Gravity Wells: the shared simulation.
//
// The server runs this to decide what a volley did. Every client runs the identical
// code to replay it on screen. The stepping uses only + − × ÷ and Math.sqrt on
// numbers that came over the wire (JSON round-trips doubles exactly), so every
// JavaScript engine lands on the same bits. No trig or random numbers in here.

export const SIM = Object.freeze({
  W: 1600,
  H: 1000,
  DT: 1 / 120,
  MAX_T: 7.5,        // seconds a shot may fly
  SOFT2: 26 * 26,    // gravity softening²
  PROJ_R: 4,
  SELF_SAFE: 0.4,    // seconds before your own shot can hit your own planet
  VMIN: 110,
  VMAX: 520,
  POWER_DIST: 330,   // aim distance (world units) that maps to full power
  LOOP: 6.3,         // radians a shot must turn through (a full orbit) before a hit counts double
  MARGIN: 520,       // how far outside the map a shot may wander before it's lost
  PREVIEW_T: 0.55,   // seconds of your own path the aiming preview reveals
  HP: 3,
  PLAYBACK: 1.8,     // sim seconds shown per real second
});

// Clamp an aim vector into the legal power range.
export function clampAim(vx, vy) {
  const sp = Math.sqrt(vx * vx + vy * vy);
  if (!(sp > 1e-9)) return { vx: SIM.VMIN, vy: 0 };
  const k = sp > SIM.VMAX ? SIM.VMAX / sp : sp < SIM.VMIN ? SIM.VMIN / sp : 1;
  return { vx: vx * k, vy: vy * k };
}

// bodies: [{ id, kind: "star" | "hole" | "moon" | "planet", x, y, r, gm, hp? }]
// shots:  [{ owner, vx, vy }]. Each launches from the surface of its owner's planet.
export class Volley {
  constructor(bodies, shots) {
    this.bodies = bodies.map((b) => ({ ...b, dead: b.kind === "planet" && !(b.hp > 0) }));
    this.byId = new Map(this.bodies.map((b) => [b.id, b]));
    this.p = [];
    for (const s of shots) {
      const pl = this.byId.get(s.owner);
      if (!pl || pl.dead) continue;
      const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy) || 1;
      const off = pl.r + SIM.PROJ_R + 2;
      this.p.push({
        owner: s.owner,
        x: pl.x + (s.vx / sp) * off,
        y: pl.y + (s.vy / sp) * off,
        vx: s.vx,
        vy: s.vy,
        t: 0,
        turn: 0,
        alive: true,
      });
    }
    this.step = 0;
    this.limitSteps = Math.ceil(SIM.MAX_T / SIM.DT);
  }

  get done() {
    for (const p of this.p) if (p.alive) return false;
    return true;
  }

  // one fixed step for every live shot; returns what happened during it
  advance() {
    const dt = SIM.DT, bodies = this.bodies, events = [];
    this.step++;
    for (let i = 0; i < this.p.length; i++) {
      const p = this.p[i];
      if (!p.alive) continue;
      let ax = 0, ay = 0;
      for (let j = 0; j < bodies.length; j++) {
        const b = bodies[j];
        if (b.dead) continue;
        const dx = b.x - p.x, dy = b.y - p.y;
        const d2 = dx * dx + dy * dy + SIM.SOFT2;
        const k = b.gm / (d2 * Math.sqrt(d2));
        ax += dx * k;
        ay += dy * k;
      }
      const ovx = p.vx, ovy = p.vy;
      p.vx += ax * dt;
      p.vy += ay * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.t += dt;
      // how far the heading swung this step (sin Δθ ≈ Δθ at 120 Hz), no atan2 needed
      const cr = ovx * p.vy - ovy * p.vx;
      const nn = Math.sqrt((ovx * ovx + ovy * ovy) * (p.vx * p.vx + p.vy * p.vy));
      if (nn > 1e-9) p.turn += Math.abs(cr) / nn;

      for (let j = 0; j < bodies.length; j++) {
        const b = bodies[j];
        if (b.dead) continue;
        if (b.id === p.owner && p.t < SIM.SELF_SAFE) continue;
        const dx = b.x - p.x, dy = b.y - p.y, rr = b.r + SIM.PROJ_R;
        if (dx * dx + dy * dy < rr * rr) {
          p.alive = false;
          const ev = { step: this.step, i, owner: p.owner, body: b.id, kind: b.kind, x: p.x, y: p.y, dmg: 0, loop: false, kill: false };
          if (b.kind === "planet") {
            ev.loop = p.turn > SIM.LOOP;
            ev.dmg = ev.loop ? 2 : 1;
            b.hp -= ev.dmg;
            if (b.hp <= 0) {
              b.hp = 0;
              b.dead = true;
              ev.kill = true;
            }
          }
          events.push(ev);
          break;
        }
      }
      if (!p.alive) continue;
      if (
        this.step >= this.limitSteps ||
        p.x < -SIM.MARGIN || p.x > SIM.W + SIM.MARGIN || p.y < -SIM.MARGIN || p.y > SIM.H + SIM.MARGIN
      ) {
        p.alive = false;
        events.push({ step: this.step, i, owner: p.owner, body: null, kind: "lost", x: p.x, y: p.y, dmg: 0, loop: false, kill: false });
      }
    }
    return events;
  }

  // run to completion (server side): returns all events and the step count
  run() {
    const events = [];
    while (!this.done) for (const e of this.advance()) events.push(e);
    return { events, steps: this.step };
  }
}

// The opening stretch of one shot's path, for the aiming preview.
export function previewPath(bodies, owner, vx, vy, tMax = SIM.PREVIEW_T) {
  const v = new Volley(bodies, [{ owner, vx, vy }]);
  const pts = [];
  if (!v.p.length) return pts;
  pts.push(v.p[0].x, v.p[0].y);
  const n = Math.ceil(tMax / SIM.DT);
  for (let k = 0; k < n && !v.done; k++) {
    v.advance();
    pts.push(v.p[0].x, v.p[0].y);
  }
  return pts;
}
