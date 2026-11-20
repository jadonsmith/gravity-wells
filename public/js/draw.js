// Gravity Wells: 2D layer. Planets (lit by their nearest star), moons, comet trails,
// the aiming arrow + preview, explosions, debris that falls into the wells, popups.
import { SIM } from "./sim.js";

const TAU = Math.PI * 2;
const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
function mixHex(hex, k, toward = 0) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (toward - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// seeded noise so a planet's sprite stays the same all match
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 4294967296);
}

export class Draw {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = 1;
    this.w = 1;
    this.h = 1;
    this.sprites = new Map();
    this.parts = [];
    this.rings = [];
    this.pops = [];
    this.shake = 0;
    this.flash = 0;
  }

  resize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = Math.min(dpr, 2);
    const pw = Math.round(w * this.dpr), ph = Math.round(h * this.dpr);
    if (this.c.width !== pw || this.c.height !== ph) { this.c.width = pw; this.c.height = ph; }
  }

  setCam(cam) {
    this.cam = cam;
  }
  sx(x, y) {
    const c = this.cam, dx = x - SIM.W / 2, dy = y - SIM.H / 2;
    return c.x + this.ox + (c.rot ? -dy : dx) * c.s;
  }
  sy(x, y) {
    const c = this.cam, dx = x - SIM.W / 2, dy = y - SIM.H / 2;
    return c.y + this.oy + (c.rot ? dx : dy) * c.s;
  }
  toWorld(px, py) {
    const c = this.cam, dx = (px - c.x) / c.s, dy = (py - c.y) / c.s;
    return c.rot ? { x: dy + SIM.W / 2, y: -dx + SIM.H / 2 } : { x: dx + SIM.W / 2, y: dy + SIM.H / 2 };
  }

  // ---------- sprites ----------
  spriteFor(b) {
    const key = b.id + ":" + (b.color || "") + ":" + b.r;
    let sp = this.sprites.get(key);
    if (sp) return sp;
    const S = 160;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    const R = S / 2;
    const rand = rng([...key].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
    g.save();
    g.beginPath();
    g.arc(R, R, R, 0, TAU);
    g.clip();
    if (b.kind === "moon") {
      g.fillStyle = "#8d8aa0";
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 26; i++) {
        const x = rand() * S, y = rand() * S, r = 4 + rand() * 18;
        g.fillStyle = `rgba(40,38,58,${0.15 + rand() * 0.25})`;
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
        g.strokeStyle = "rgba(220,215,240,0.18)";
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(x - 1, y - 1, r, Math.PI * 0.9, Math.PI * 1.7); g.stroke();
      }
    } else {
      const base = b.color || "#888";
      g.fillStyle = mixHex(base, 0.35, 0);
      g.fillRect(0, 0, S, S);
      // banded atmosphere, gently wavy
      const bands = 7 + Math.floor(rand() * 5);
      for (let i = 0; i < bands; i++) {
        const y = (i / bands) * S + rand() * 8, hgt = 6 + rand() * 18;
        g.fillStyle = rand() < 0.5 ? mixHex(base, 0.15 + rand() * 0.2, 255) : mixHex(base, 0.45 + rand() * 0.2, 0);
        g.globalAlpha = 0.35 + rand() * 0.4;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= S; x += 8) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 3 * rand());
        g.lineTo(S, y + hgt);
        g.lineTo(0, y + hgt);
        g.fill();
      }
      g.globalAlpha = 1;
      // a storm
      g.fillStyle = mixHex(base, 0.3, 255);
      g.globalAlpha = 0.6;
      g.beginPath();
      g.ellipse(S * (0.3 + rand() * 0.4), S * (0.35 + rand() * 0.3), 10 + rand() * 8, 5 + rand() * 4, 0, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
    }
    g.restore();
    sp = cv;
    this.sprites.set(key, sp);
    return sp;
  }

  // ---------- effects ----------
  burst(x, y, col, n, speed, life, size = 2, grav = false) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = speed * (0.25 + Math.random() * 0.75);
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: life * (0.6 + Math.random() * 0.6), col, size: size * (0.5 + Math.random()), grav });
    }
  }
  ring(x, y, col, r0, r1, life, width = 3) {
    this.rings.push({ x, y, col, r0, r1, life, t: 0, width });
  }
  pop(x, y, text, col, big = false) {
    this.pops.push({ x, y, text, col, t: 0, life: big ? 2 : 1.4, big });
  }
  explode(x, y, col, big) {
    this.burst(x, y, "#ffffff", big ? 40 : 16, big ? 260 : 160, big ? 1.1 : 0.6, 2.2);
    this.burst(x, y, col, big ? 90 : 26, big ? 340 : 190, big ? 2.6 : 1.2, big ? 3 : 2.2, true);
    this.ring(x, y, col, 4, big ? 150 : 60, big ? 0.9 : 0.5, big ? 4 : 2.5);
    if (big) this.ring(x, y, "#ffffff", 10, 240, 1.3, 2);
    this.shake = Math.max(this.shake, big ? 16 : 6);
    if (big) this.flash = Math.max(this.flash, 0.22);
  }

  step(dt, heavies) {
    for (const p of this.parts) {
      p.t += dt;
      if (p.grav) {
        for (const b of heavies) {
          const dx = b.x - p.x, dy = b.y - p.y, d2 = dx * dx + dy * dy + 900;
          const k = b.gm / (d2 * Math.sqrt(d2));
          p.vx += dx * k * dt;
          p.vy += dy * k * dt;
          if (d2 < b.r * b.r) p.t = p.life;
        }
      } else {
        p.vx *= 1 - 1.8 * dt;
        p.vy *= 1 - 1.8 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.parts = this.parts.filter((p) => p.t < p.life);
    if (this.parts.length > 1400) this.parts.splice(0, this.parts.length - 1400);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < r.life);
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter((p) => p.t < p.life);
    this.shake *= Math.exp(-dt * 8);
    this.flash *= Math.exp(-dt * 6);
  }

  // ---------- frame ----------
  draw(st, t) {
    const ctx = this.ctx, s = this.cam.s;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.ox = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    this.oy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // ghost trails of the last volley
    ctx.globalCompositeOperation = "lighter";
    for (const g of st.ghosts) {
      const p = g.pts;
      if (p.length < 4) continue;
      ctx.strokeStyle = hexA(g.color, g.mine ? 0.32 : 0.14);
      ctx.lineWidth = g.mine ? 1.6 : 1.1;
      ctx.setLineDash(g.mine ? [] : [3, 6]);
      ctx.beginPath();
      ctx.moveTo(this.sx(p[0], p[1]), this.sy(p[0], p[1]));
      for (let k = 2; k < p.length; k += 4) ctx.lineTo(this.sx(p[k], p[k + 1]), this.sy(p[k], p[k + 1]));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // live comet trails + heads
    for (const tr of st.trails) {
      const p = tr.pts;
      const n = p.length / 2;
      if (n < 2) continue;
      const from = Math.max(0, n - 220);
      for (let k = from + 1; k < n; k++) {
        const f = (k - from) / (n - from);
        ctx.strokeStyle = hexA(tr.color, f * f * 0.85);
        ctx.lineWidth = 0.6 + f * 3.4;
        ctx.beginPath();
        ctx.moveTo(this.sx(p[(k - 1) * 2], p[(k - 1) * 2 + 1]), this.sy(p[(k - 1) * 2], p[(k - 1) * 2 + 1]));
        ctx.lineTo(this.sx(p[k * 2], p[k * 2 + 1]), this.sy(p[k * 2], p[k * 2 + 1]));
        ctx.stroke();
      }
      if (tr.alive) {
        const hx = this.sx(p[(n - 1) * 2], p[(n - 1) * 2 + 1]), hy = this.sy(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
        const gr = ctx.createRadialGradient(hx, hy, 0, hx, hy, 16);
        gr.addColorStop(0, "rgba(255,255,255,0.95)");
        gr.addColorStop(0.25, hexA(tr.color, 0.8));
        gr.addColorStop(1, hexA(tr.color, 0));
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(hx, hy, 16, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";

    // bodies drawn here: moons and planets (suns and holes live in the shader)
    for (const b of st.bodies) {
      if (b.kind !== "moon" && b.kind !== "planet") continue;
      const x = this.sx(b.x, b.y), y = this.sy(b.x, b.y), r = b.r * s;
      if (b.kind === "planet" && !(b.hp > 0)) {
        this.drawWreck(b, x, y, r, t);
        continue;
      }
      // atmosphere glow
      if (b.kind === "planet") {
        ctx.globalCompositeOperation = "lighter";
        const ag = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 1.9);
        ag.addColorStop(0, hexA(b.color, 0.45));
        ag.addColorStop(1, hexA(b.color, 0));
        ctx.fillStyle = ag;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.9, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.drawImage(this.spriteFor(b), x - r, y - r, r * 2, r * 2);
      // light from the brightest well
      const L = st.lightDir(b);
      const lx = x + L.x * r * 0.55, ly = y + L.y * r * 0.55;
      const sh = ctx.createRadialGradient(lx, ly, r * 0.1, x - L.x * r * 0.2, y - L.y * r * 0.2, r * 1.25);
      sh.addColorStop(0, "rgba(255,245,225,0.28)");
      sh.addColorStop(0.45, "rgba(0,0,0,0)");
      sh.addColorStop(1, "rgba(2,2,12,0.82)");
      ctx.fillStyle = sh;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();

      if (b.kind === "planet") this.drawPlanetUi(b, x, y, r, t, st);
    }

    // my aim
    if (st.aimView) this.drawAim(st.aimView, t);

    // effects
    ctx.globalCompositeOperation = "lighter";
    for (const r of this.rings) {
      const f = r.t / r.life;
      ctx.strokeStyle = typeof r.col === "string" && r.col[0] === "#" ? hexA(r.col, (1 - f) * 0.9) : r.col;
      ctx.lineWidth = r.width * (1 - f * 0.7);
      ctx.beginPath();
      ctx.arc(this.sx(r.x, r.y), this.sy(r.x, r.y), (r.r0 + (r.r1 - r.r0) * (1 - (1 - f) ** 3)) * s, 0, TAU);
      ctx.stroke();
    }
    for (const p of this.parts) {
      const f = 1 - p.t / p.life;
      ctx.fillStyle = hexA(p.col, f);
      ctx.beginPath();
      ctx.arc(this.sx(p.x, p.y), this.sy(p.x, p.y), Math.max(0.5, p.size * (0.5 + f * 0.5)), 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const p of this.pops) {
      const f = p.t / p.life;
      const x = this.sx(p.x, p.y), y = this.sy(p.x, p.y) - 26 - f * 36;
      ctx.globalAlpha = f < 0.15 ? f / 0.15 : 1 - Math.max(0, (f - 0.6) / 0.4);
      ctx.font = `800 ${p.big ? 22 : 16}px Sora, system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(5,4,20,0.85)";
      ctx.strokeText(p.text, x, y);
      ctx.fillStyle = p.col;
      ctx.fillText(p.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  drawWreck(b, x, y, r, t) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(30,26,48,0.9)";
    ctx.beginPath();
    ctx.arc(x, y, r * 0.42, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = hexA(b.color, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.42, 0, TAU);
    ctx.stroke();
    const rand = rng(b.id.charCodeAt(1) * 977 + 3);
    ctx.fillStyle = hexA(b.color, 0.5);
    for (let i = 0; i < 14; i++) {
      const a = rand() * TAU + t * (0.15 + rand() * 0.2), d = r * (0.8 + rand() * 0.7);
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.55, 1 + rand() * 1.8, 0, TAU);
      ctx.fill();
    }
  }

  drawPlanetUi(b, x, y, r, t, st) {
    const ctx = this.ctx;
    const me = b.id === st.you;
    // owner ring
    ctx.strokeStyle = hexA(b.color, me ? 0.95 : 0.6);
    ctx.lineWidth = me ? 2.2 : 1.4;
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, TAU);
    ctx.stroke();
    if (me) {
      const pulse = (t * 0.8) % 1;
      ctx.strokeStyle = hexA(b.color, 0.5 * (1 - pulse));
      ctx.beginPath();
      ctx.arc(x, y, r + 7 + pulse * 18, 0, TAU);
      ctx.stroke();
    }
    // hull points
    const hp = Math.max(0, b.hp);
    for (let i = 0; i < SIM.HP; i++) {
      const px = x + (i - (SIM.HP - 1) / 2) * 11, py = y + r + 14;
      ctx.fillStyle = i < hp ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.16)";
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(px - 4, py - 3, 8, 6, 2) : ctx.rect(px - 4, py - 3, 8, 6);
      ctx.fill();
    }
    // name + status
    ctx.font = `600 ${me ? 13 : 12}px Sora, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const label = me ? "You" : b.name;
    ctx.fillStyle = "rgba(5,4,20,0.7)";
    ctx.fillText(label, x + 1, y - r - 9);
    ctx.fillStyle = me ? "#fff" : "rgba(240,236,255,0.85)";
    ctx.fillText(label, x, y - r - 10);
    if (st.phase === "aim" || st.phase === "resolving") {
      const locked = st.locks.has(b.id);
      ctx.font = "700 11px JetBrains Mono, monospace";
      ctx.fillStyle = locked ? "#7cff8a" : "rgba(255,255,255,0.45)";
      const dots = ".".repeat(1 + (Math.floor(t * 3) % 3));
      ctx.fillText(locked ? "✓ ready" : "aiming" + dots, x, y - r - 26);
    }
  }

  drawAim(a, t) {
    const ctx = this.ctx, s = this.cam.s;
    const x = this.sx(a.x, a.y), y = this.sy(a.x, a.y);
    // preview path: dots that fade into the unknown
    const p = a.preview;
    ctx.globalCompositeOperation = "lighter";
    const n = p.length / 2;
    for (let k = 0; k < n; k += 3) {
      const f = 1 - k / n;
      ctx.fillStyle = hexA(a.color, 0.15 + f * 0.75);
      ctx.beginPath();
      ctx.arc(this.sx(p[k * 2], p[k * 2 + 1]), this.sy(p[k * 2], p[k * 2 + 1]), 1.2 + f * 1.8, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    // power arrow
    const sp = Math.hypot(a.vx, a.vy) || 1;
    const ux = a.vx / sp, uy = a.vy / sp;
    const pw = (sp - SIM.VMIN) / (SIM.VMAX - SIM.VMIN);
    const len = (a.r + 18 + pw * 90);
    const ex = this.sx(a.x + ux * len, a.y + uy * len), ey = this.sy(a.x + ux * len, a.y + uy * len);
    const bx = this.sx(a.x + ux * (a.r + 8), a.y + uy * (a.r + 8)), by = this.sy(a.x + ux * (a.r + 8), a.y + uy * (a.r + 8));
    const gr = ctx.createLinearGradient(bx, by, ex, ey);
    gr.addColorStop(0, hexA(a.color, 0.2));
    gr.addColorStop(1, a.locked ? "#7cff8a" : "#ffffff");
    ctx.strokeStyle = gr;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    const ang = Math.atan2(ey - by, ex - bx);
    ctx.fillStyle = a.locked ? "#7cff8a" : "#ffffff";
    ctx.beginPath();
    ctx.moveTo(ex + Math.cos(ang) * 6, ey + Math.sin(ang) * 6);
    ctx.lineTo(ex + Math.cos(ang + 2.5) * 9, ey + Math.sin(ang + 2.5) * 9);
    ctx.lineTo(ex + Math.cos(ang - 2.5) * 9, ey + Math.sin(ang - 2.5) * 9);
    ctx.fill();
    // power arc around the planet
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, a.r * s + 12, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = a.locked ? "#7cff8a" : hexA(a.color, 0.95);
    ctx.beginPath();
    ctx.arc(x, y, a.r * s + 12, -Math.PI / 2, -Math.PI / 2 + TAU * (0.04 + pw * 0.96));
    ctx.stroke();
  }
}
