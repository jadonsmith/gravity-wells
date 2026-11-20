// Gravity Wells: one room. Lobby, star-system generation, simultaneous turns and bots.
// Pure game logic. server.js hands it a `send(member, msg)` and a `broadcast(msg)`.
import { SIM, Volley, clampAim } from "./public/js/sim.js";

const TAU = Math.PI * 2;
export const COLORS = ["#ff5d73", "#4dd4ff", "#ffc94d", "#7cff8a", "#c58cff", "#ff9f43"];
const BOT_NAMES = [
  "Vega", "Rigel", "Deneb", "Altair", "Sirius", "Mira", "Lyra", "Atlas",
  "Nova", "Pulsar", "Quasar", "Comet", "Castor", "Pollux", "Electra", "Halley",
];

export const RULES = Object.freeze({
  LOBBY_MS: 4500,         // public lobby waits this long for more humans
  FIRST_AIM_MS: 22000,
  AIM_MS: 16000,
  MATCH_INTRO_MS: 1400,
  AFTER_VOLLEY_MS: 1500,
  KILL_PAUSE_MS: 600,
  ALL_LOCKED_GRACE_MS: 450,
  MAX_PLAYERS: 6,
  PUBLIC_SIZE: 4,         // public matches fill with bots to this many planets
  PRIVATE_BOTS: 1,        // default bots in a private room
});

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const r2 = (v) => Math.round(v * 100) / 100;
function gauss() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- star systems ----------
export function genWorld(n) {
  const { W, H } = SIM, cx = W / 2, cy = H / 2;
  for (let attempt = 0; attempt < 400; attempt++) {
    const bodies = [];
    const roll = Math.random();
    if (roll < 0.4) {
      bodies.push({ id: "s0", kind: "star", x: r2(cx + rand(-110, 110)), y: r2(cy + rand(-70, 70)), r: r2(rand(58, 70)), gm: Math.round(rand(2.1e7, 2.6e7)), hue: r2(rand(0, 1)) });
    } else if (roll < 0.72) {
      const a = rand(-0.6, 0.6), d = rand(220, 290);
      for (const sg of [1, -1]) {
        bodies.push({
          id: sg > 0 ? "s0" : "s1", kind: "star",
          x: r2(cx + Math.cos(a) * d * sg), y: r2(cy + Math.sin(a) * d * 0.75 * sg),
          r: r2(rand(42, 52)), gm: Math.round(rand(1.25e7, 1.6e7)), hue: r2(rand(0, 1)),
        });
      }
    } else {
      const hx = cx + rand(-90, 90), hy = cy + rand(-60, 60);
      bodies.push({ id: "h0", kind: "hole", x: r2(hx), y: r2(hy), r: 17, gm: Math.round(rand(2.7e7, 3.2e7)) });
      if (Math.random() < 0.55) {
        const a = rand(0, TAU), d = rand(360, 430);
        const sx = hx + Math.cos(a) * d * 1.2, sy = hy + Math.sin(a) * d * 0.7;
        if (sx > 120 && sx < W - 120 && sy > 110 && sy < H - 110) {
          bodies.push({ id: "s0", kind: "star", x: r2(sx), y: r2(sy), r: r2(rand(32, 38)), gm: Math.round(rand(6e6, 8e6)), hue: r2(rand(0, 1)) });
        }
      }
    }
    const heavy = bodies.slice();

    // moons
    const nm = randInt(1, 3);
    for (let k = 0; k < nm; k++) {
      for (let tries = 0; tries < 60; tries++) {
        const m = { id: "m" + k, kind: "moon", x: r2(rand(150, W - 150)), y: r2(rand(120, H - 120)), r: r2(rand(17, 29)), gm: Math.round(rand(1.6e6, 3.2e6)) };
        const ok = bodies.every((b) => Math.hypot(b.x - m.x, b.y - m.y) > b.r + m.r + (b.kind === "moon" ? 170 : 140));
        if (ok) { bodies.push(m); break; }
      }
    }

    // planets, spread round an ellipse so nobody starts on top of anyone
    const rot = rand(0, TAU), rx = rand(600, 655), ry = rand(355, 395);
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      let placed = false;
      for (let tries = 0; tries < 30 && !placed; tries++) {
        const a = rot + (i / n) * TAU + rand(-0.2, 0.2);
        const p = {
          id: "p" + i, kind: "planet",
          x: r2(Math.min(W - 90, Math.max(90, cx + Math.cos(a) * rx * rand(0.92, 1.03)))),
          y: r2(Math.min(H - 80, Math.max(80, cy + Math.sin(a) * ry * rand(0.92, 1.03)))),
          r: 26, gm: 1.4e6, hp: SIM.HP,
        };
        const clear = bodies.every((b) => {
          const d = Math.hypot(b.x - p.x, b.y - p.y);
          if (b.kind === "planet") return d > 270;
          if (b.kind === "moon") return d > b.r + p.r + 80;
          return d > b.r + p.r + 170;
        });
        if (clear) { bodies.push(p); placed = true; }
      }
      ok = placed;
    }
    if (ok && heavy.length) return bodies;
  }
  throw new Error("could not lay out a star system");
}

// ---------- bot aiming: sample shots in the sim, keep the best, then fumble it a little ----------
export function botAim(bodies, me, brain) {
  const enemies = bodies.filter((b) => b.kind === "planet" && b.hp > 0 && b.id !== me.id);
  let best = null;
  const N = 170;
  for (let k = 0; k < N; k++) {
    let ang, sp;
    if (brain.last && k < N * 0.55) {
      ang = brain.last.ang + gauss() * 0.16;
      sp = Math.min(SIM.VMAX, Math.max(SIM.VMIN, brain.last.sp * (1 + gauss() * 0.14)));
    } else {
      ang = Math.random() * TAU;
      sp = rand(SIM.VMIN + 30, SIM.VMAX);
    }
    const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
    const v = new Volley(bodies, [{ owner: me.id, vx, vy }]);
    let score = null, minD = Infinity;
    while (!v.done && score === null) {
      const evs = v.advance();
      const p = v.p[0];
      if (p.alive && (v.step & 3) === 0) {
        for (const e of enemies) {
          const d = Math.hypot(e.x - p.x, e.y - p.y) - e.r;
          if (d < minD) minD = d;
        }
      }
      if (evs.length) {
        const ev = evs[0];
        if (ev.kind === "planet") score = ev.body === me.id ? -5000 : 1000 + (ev.loop ? 250 : 0) - v.step * 0.05;
        else score = -minD;
      }
    }
    if (score === null) score = -minD;
    if (!best || score > best.score) best = { score, ang, sp };
  }
  brain.last = best;
  const ang = best.ang + gauss() * brain.aimNoise;
  const sp = Math.min(SIM.VMAX, Math.max(SIM.VMIN, best.sp * (1 + gauss() * brain.powNoise)));
  return { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp };
}

export function newBrain() {
  return { last: null, aimNoise: rand(0.025, 0.055), powNoise: rand(0.022, 0.05), think: rand(2500, 9000) };
}

// ---------- the room ----------
let seq = 0;

export class Room {
  constructor({ isPrivate = false, code = null, send, broadcast, onEmpty = () => {} }) {
    this.isPrivate = isPrivate;
    this.code = code;
    this.send = send;
    this.bcast = broadcast;
    this.onEmpty = onEmpty;
    this.members = new Map();
    this.state = "lobby";
    this.hostId = null;
    this.botCount = RULES.PRIVATE_BOTS;
    this.timers = new Set();
    this.match = null;
    this.created = Date.now();
    this.startsAt = isPrivate ? 0 : Date.now() + RULES.LOBBY_MS;
    if (!isPrivate) this.later(() => this.startMatch(), RULES.LOBBY_MS);
  }

  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }
  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
  destroy() {
    this.clearTimers();
    this.state = "dead";
  }

  get humans() {
    let n = 0;
    for (const m of this.members.values()) if (!m.bot && m.ws) n++;
    return n;
  }
  get joinable() {
    return this.state === "lobby" && this.humans < RULES.MAX_PLAYERS;
  }

  // ---------- membership ----------
  addHuman(ws, name) {
    const m = { id: ++seq, name, ws, bot: null, planet: null };
    this.members.set(m.id, m);
    if (this.hostId == null) this.hostId = m.id;
    this.send(m, { t: "joined", id: m.id, code: this.code, priv: this.isPrivate });
    if (this.match && this.state !== "lobby") this.sendMatch(m);
    this.lobbyUpdate();
    if (!this.isPrivate && this.state === "lobby" && this.humans >= RULES.MAX_PLAYERS) this.startMatch();
    return m;
  }

  removeHuman(id) {
    const m = this.members.get(id);
    if (!m) return;
    if (this.match && m.planet && this.planetAlive(m.planet) && this.state !== "over" && this.state !== "lobby") {
      // they leave mid-match: a bot keeps their planet in the fight
      m.ws = null;
      m.bot = newBrain();
      m.left = true;
      this.bcast({ t: "left", id, planet: m.planet });
    } else {
      this.members.delete(id);
    }
    if (this.hostId === id) {
      this.hostId = null;
      for (const mm of this.members.values()) if (!mm.bot && mm.ws) { this.hostId = mm.id; break; }
    }
    if (this.humans === 0) { this.destroy(); this.onEmpty(this); return; }
    this.lobbyUpdate();
    if (this.state === "aim") this.checkAllLocked();
  }

  lobbyUpdate() {
    const members = [];
    for (const m of this.members.values()) {
      if (m.bot && !m.left) continue;
      members.push({ id: m.id, name: m.name, bot: !!m.bot });
    }
    this.bcast({
      t: "lobby", state: this.state, priv: this.isPrivate, code: this.code, host: this.hostId,
      members, bots: this.isPrivate ? this.botCount : Math.max(0, RULES.PUBLIC_SIZE - this.humans),
      startsIn: this.state === "lobby" && !this.isPrivate ? Math.max(0, this.startsAt - Date.now()) : null,
    });
  }

  setBots(by, n) {
    if (!this.isPrivate || by !== this.hostId || this.state === "aim" || this.state === "fly") return;
    this.botCount = Math.max(0, Math.min(RULES.MAX_PLAYERS - 1, n | 0));
    this.lobbyUpdate();
  }

  requestStart(by) {
    if (this.state === "aim" || this.state === "fly") return;
    if (this.isPrivate && by !== this.hostId) return;
    this.startMatch();
  }

  // ---------- match ----------
  startMatch() {
    if (this.state === "aim" || this.state === "fly" || this.state === "dead") return;
    this.clearTimers();
    // drop the bots of a finished match and anyone who left
    for (const [id, m] of this.members) if (m.bot) this.members.delete(id);
    const humans = [...this.members.values()].filter((m) => m.ws).slice(0, RULES.MAX_PLAYERS);
    const want = this.isPrivate ? this.botCount : RULES.PUBLIC_SIZE;
    const nb = this.isPrivate
      ? Math.min(want, RULES.MAX_PLAYERS - humans.length)
      : Math.max(0, Math.min(RULES.MAX_PLAYERS, want) - humans.length);
    if (humans.length + nb < 2) {
      for (const m of humans) this.send(m, { t: "err", msg: "Need at least two planets. Add a bot or invite a friend." });
      return;
    }
    const used = new Set(humans.map((h) => h.name));
    const bots = [];
    for (let i = 0; i < nb; i++) {
      const free = BOT_NAMES.filter((n) => !used.has(n));
      const name = free.length ? pick(free) : "Bot";
      used.add(name);
      const b = { id: ++seq, name, ws: null, bot: newBrain(), planet: null };
      this.members.set(b.id, b);
      bots.push(b);
    }
    const parts = shuffle([...humans, ...bots]);
    const bodies = genWorld(parts.length);
    const planets = bodies.filter((b) => b.kind === "planet");
    const order = shuffle(COLORS.map((_, i) => i));
    parts.forEach((m, i) => {
      const p = planets[i];
      p.owner = m.id;
      p.name = m.name;
      p.color = COLORS[order[i]];
      p.bot = !!m.bot;
      m.planet = p.id;
    });
    for (const m of this.members.values()) if (!parts.includes(m)) m.planet = null;
    const stats = {};
    for (const p of planets) stats[p.id] = { shots: 0, hits: 0, dmg: 0, loops: 0, self: 0 };
    this.match = { bodies, turn: 0, aims: new Map(), current: new Map(), ranking: [], stats, deadline: 0 };
    this.state = "intro";
    for (const m of this.members.values()) if (m.ws) this.sendMatch(m);
    this.later(() => this.beginAim(), RULES.MATCH_INTRO_MS);
  }

  sendMatch(m) {
    const M = this.match;
    this.send(m, {
      t: "match", you: m.planet, bodies: M.bodies, turn: M.turn, state: this.state,
      ms: this.state === "aim" ? Math.max(0, M.deadline - Date.now()) : 0, sim: { W: SIM.W, H: SIM.H },
    });
  }

  planetAlive(pid) {
    const b = this.match && this.match.bodies.find((x) => x.id === pid);
    return !!(b && b.hp > 0);
  }

  alivePlanets() {
    return this.match.bodies.filter((b) => b.kind === "planet" && b.hp > 0);
  }

  beginAim() {
    const M = this.match;
    M.turn++;
    M.aims.clear();
    const ms = M.turn === 1 ? RULES.FIRST_AIM_MS : RULES.AIM_MS;
    M.deadline = Date.now() + ms;
    this.state = "aim";
    this.bcast({ t: "aim", turn: M.turn, ms });
    this.later(() => this.resolve(), ms);
    // bots think on their own clocks
    for (const m of this.members.values()) {
      if (!m.bot || !this.planetAlive(m.planet)) continue;
      const wait = Math.min(ms - 1200, m.bot.think * rand(0.6, 1.3));
      this.later(() => this.botTurn(m), Math.max(400, wait));
    }
  }

  botTurn(m) {
    if (this.state !== "aim" || !this.planetAlive(m.planet) || this.match.aims.get(m.planet)?.lock) return;
    const me = this.match.bodies.find((b) => b.id === m.planet);
    const raw = botAim(this.match.bodies, me, m.bot);
    const a = clampAim(raw.vx, raw.vy);
    this.match.aims.set(m.planet, { vx: a.vx, vy: a.vy, lock: true });
    this.match.current.set(m.planet, { vx: a.vx, vy: a.vy });
    this.locksUpdate();
    this.checkAllLocked();
  }

  onAim(m, vx, vy, lock) {
    if (this.state !== "aim" || !m.planet || !this.planetAlive(m.planet)) return;
    vx = Number(vx);
    vy = Number(vy);
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) return;
    const a = clampAim(vx, vy);
    const prev = this.match.aims.get(m.planet);
    this.match.aims.set(m.planet, { vx: a.vx, vy: a.vy, lock: !!lock });
    this.match.current.set(m.planet, { vx: a.vx, vy: a.vy });
    if (!prev || prev.lock !== !!lock) this.locksUpdate();
    if (lock) this.checkAllLocked();
  }

  locksUpdate() {
    const ids = [];
    for (const [pid, a] of this.match.aims) if (a.lock) ids.push(pid);
    this.bcast({ t: "locks", ids });
  }

  checkAllLocked() {
    if (this.state !== "aim") return;
    for (const m of this.members.values()) {
      if (m.bot || !m.ws || !this.planetAlive(m.planet)) continue;
      if (!this.match.aims.get(m.planet)?.lock) return;
    }
    // every human is locked in: bots that haven't decided yet decide now
    for (const m of this.members.values()) {
      if (m.bot && this.planetAlive(m.planet) && !this.match.aims.get(m.planet)?.lock) this.botTurn(m);
    }
    if (this.state !== "aim") return;
    this.state = "resolving";
    this.later(() => this.resolve(), RULES.ALL_LOCKED_GRACE_MS);
  }

  resolve() {
    if (this.state !== "aim" && this.state !== "resolving") return;
    this.clearTimers();
    const M = this.match;
    // stragglers: bots that never got to think, then everyone fires their current aim
    for (const m of this.members.values()) {
      if (m.bot && this.planetAlive(m.planet) && !M.aims.has(m.planet)) {
        const me = M.bodies.find((b) => b.id === m.planet);
        const a = botAim(M.bodies, me, m.bot);
        M.current.set(m.planet, clampAim(a.vx, a.vy));
      }
    }
    const shots = [];
    for (const p of this.alivePlanets()) {
      const a = M.aims.get(p.id) || M.current.get(p.id);
      if (!a) continue; // never aimed at all: holds fire
      shots.push({ owner: p.id, vx: a.vx, vy: a.vy });
      M.stats[p.id].shots++;
    }
    const vol = new Volley(M.bodies, shots);
    const { events, steps } = vol.run();
    let kills = 0;
    const killed = [];
    for (const ev of events) {
      if (ev.kind !== "planet") continue;
      const st = M.stats[ev.owner];
      if (ev.body === ev.owner) st.self++;
      else { st.hits++; st.dmg += ev.dmg; if (ev.loop) st.loops++; }
      if (ev.kill) { kills++; killed.push(ev.body); }
    }
    const hp = {};
    for (const b of vol.bodies) {
      if (b.kind !== "planet") continue;
      hp[b.id] = b.hp;
      const mine = M.bodies.find((x) => x.id === b.id);
      mine.hp = b.hp;
    }
    if (killed.length) M.ranking.push(killed);
    this.state = "fly";
    this.bcast({
      t: "volley", turn: M.turn, shots, steps, hp,
      ev: events.filter((e) => e.kind === "planet").map((e) => [e.step, e.owner, e.body, e.dmg, e.loop ? 1 : 0, e.kill ? 1 : 0]),
    });
    const playMs = (steps * SIM.DT * 1000) / SIM.PLAYBACK;
    this.later(() => this.afterVolley(), playMs + RULES.AFTER_VOLLEY_MS + kills * RULES.KILL_PAUSE_MS);
  }

  afterVolley() {
    const alive = this.alivePlanets();
    if (alive.length <= 1) this.finish(alive[0] || null);
    else this.beginAim();
  }

  finish(winner) {
    const M = this.match;
    this.state = "over";
    const ranking = [];
    if (winner) ranking.push([winner.id]);
    for (let i = M.ranking.length - 1; i >= 0; i--) ranking.push(M.ranking[i]);
    this.bcast({ t: "over", winner: winner ? winner.id : null, ranking, stats: M.stats, turns: M.turn });
    if (!this.isPrivate) {
      // public rooms are single-use: once everyone has seen the result, it closes
      this.later(() => { this.destroy(); this.onEmpty(this); }, 120000);
    } else {
      for (const [id, m] of this.members) if (m.left) this.members.delete(id);
      this.lobbyUpdate();
    }
  }
}
