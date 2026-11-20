// Gravity Wells: client. Socket, lobby, aiming, volley replay, HUD and the menu backdrop.
import { SIM, Volley, clampAim, previewPath } from "./sim.js";
import { Space } from "./space.js";
import { Draw } from "./draw.js";
import { Sfx } from "./sfx.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const space = new Space($("space"));
const draw = new Draw($("fx"));
const sfx = new Sfx();
const touch = matchMedia("(pointer: coarse)").matches;

const ui = {
  hud: $("hud"), menu: $("menu"), lobby: $("lobby"), results: $("results"),
  online: $("menu-online"), name: $("name"), code: $("code"), toast: $("toast"),
  turnN: $("turn-n"), turnPh: $("turn-ph"), timer: $("timer-fill"), timerBox: document.querySelector(".timer"),
  roster: $("roster"), callout: $("callout"), aimbar: $("aimbar"), lock: $("btn-lock"),
  pow: $("aim-pow"), ang: $("aim-ang"), hint: $("hint"), mute: $("btn-mute"),
  lobbyKicker: $("lobby-kicker"), lobbyTitle: $("lobby-title"), codeBox: $("code-box"), lobbyCode: $("lobby-code"),
  people: $("people"), botsRow: $("bots-row"), botsN: $("bots-n"), lobbyNote: $("lobby-note"), start: $("btn-start"),
  resKicker: $("res-kicker"), resTitle: $("res-title"), resList: $("res-list"), again: $("btn-again"),
};

const S = {
  ws: null, retry: 0, online: 0,
  mode: "menu",            // menu | lobby | match
  myId: null, priv: false, code: null, lobby: null, lastJoin: null,
  bodies: [], you: null, turn: 0, phase: "intro", deadline: 0, total: 1,
  locks: new Set(), aim: null, locked: false, dragging: false, lastAimSent: 0, aimDirty: false,
  preview: [], volley: null, ghosts: [], trails: [], pendingOver: null, over: null,
  cam: { x: innerWidth / 2, y: innerHeight / 2, s: 0.5, rot: false },
  lastTick: -1, demo: null,
};

const store = {
  get(k, d = "") { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
ui.name.value = store.get("gw_name");
function myName() {
  const n = ui.name.value.trim().slice(0, 16);
  store.set("gw_name", n);
  return n || "Player " + Math.floor(10 + Math.random() * 90);
}

// ───────── socket ─────────
function connect() {
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  const base = location.pathname.replace(/[^/]*$/, "");
  let ws;
  try { ws = new WebSocket(proto + location.host + base); } catch { reconnect(); return; }
  S.ws = ws;
  ws.onopen = () => {
    S.retry = 0;
    if (S.mode !== "menu" && S.lastJoin) send({ t: "play", ...S.lastJoin });
    else autoJoin();
  };
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    onMsg(m);
  };
  ws.onclose = () => {
    S.ws = null;
    ui.online.textContent = "reconnecting…";
    if (S.mode !== "menu") toast("Connection lost, reconnecting…");
    reconnect();
  };
}
function reconnect() {
  const delay = Math.min(8000, 400 * 2 ** S.retry++);
  setTimeout(() => {
    if (!document.hidden) return connect();
    const v = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", v); connect(); } };
    document.addEventListener("visibilitychange", v);
  }, delay);
}
function send(m) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(m)); }

let autoJoined = false;
function autoJoin() {
  if (autoJoined) return;
  autoJoined = true;
  const room = new URLSearchParams(location.search).get("room");
  if (room) play({ mode: "join", code: room.toUpperCase().slice(0, 4) });
}
function play(opts) {
  sfx.unlock();
  S.lastJoin = { ...opts, name: myName() };
  if (!S.ws || S.ws.readyState !== 1) { toast("Still connecting…"); return; }
  send({ t: "play", ...S.lastJoin });
}

function onMsg(m) {
  switch (m.t) {
    case "hi": setOnline(m.online); break;
    case "online": setOnline(m.n); break;
    case "joined":
      S.myId = m.id;
      S.priv = m.priv;
      S.code = m.code;
      if (m.priv) {
        S.lastJoin = { mode: "join", code: m.code, name: S.lastJoin?.name };
        history.replaceState(null, "", location.pathname + "?room=" + m.code);
      }
      break;
    case "lobby": onLobby(m); break;
    case "match": onMatch(m); break;
    case "aim": onAimPhase(m); break;
    case "locks": S.locks = new Set(m.ids); renderRoster(); break;
    case "volley": onVolley(m); break;
    case "over": onOver(m); break;
    case "left": {
      const b = S.bodies.find((x) => x.id === m.planet);
      if (b) toast(`${b.name} left. A bot is flying their planet.`);
      break;
    }
    case "err":
      toast(m.msg);
      if (m.fatal) showMenu();
      break;
  }
}
function setOnline(n) {
  S.online = n;
  ui.online.textContent = `${n} online`;
}

// ───────── lobby ─────────
let lobbyTimer = 0;
function onLobby(m) {
  S.lobby = m;
  S.lobbyAt = performance.now();
  if (m.state === "lobby" || (S.mode === "lobby")) {
    if (S.mode !== "match" || m.state === "lobby") showLobby();
  }
  renderLobby();
}
function showLobby() {
  S.mode = "lobby";
  ui.menu.hidden = true;
  ui.results.hidden = true;
  ui.hud.hidden = true;
  ui.lobby.hidden = false;
  renderLobby();
  clearInterval(lobbyTimer);
  lobbyTimer = setInterval(renderLobby, 250);
}
function renderLobby() {
  const m = S.lobby;
  if (!m || ui.lobby.hidden) { clearInterval(lobbyTimer); return; }
  const host = m.host === S.myId;
  ui.lobbyKicker.textContent = m.priv ? "Private room" : "Quick match";
  ui.codeBox.hidden = !m.priv;
  ui.lobbyCode.textContent = m.code || "····";
  ui.botsRow.hidden = !m.priv || !host;
  ui.botsN.textContent = m.bots;
  const left = m.startsIn == null ? 0 : Math.max(0, m.startsIn - (performance.now() - S.lobbyAt));
  if (m.priv) {
    ui.lobbyTitle.textContent = m.state === "over" ? "Ready for another?" : "Room ready";
    ui.lobbyNote.textContent = host ? `Start when everyone's in. ${m.bots ? `${m.bots} bot${m.bots > 1 ? "s" : ""} will join.` : "No bots."}` : "Waiting for the host to start…";
    ui.start.hidden = !host;
    ui.start.textContent = "Start match";
  } else {
    ui.lobbyTitle.textContent = left > 0 ? `Starting in ${Math.ceil(left / 1000)}…` : "Starting…";
    ui.lobbyNote.textContent = "Bots fill any empty orbits. Anyone who hits Play in the next few seconds joins you.";
    ui.start.hidden = false;
    ui.start.textContent = "Start now";
  }
  const rows = m.members.map((p) => `<li class="${p.bot ? "bot" : ""}"><span class="av"></span>${esc(p.id === S.myId ? p.name + " (you)" : p.name)}${p.id === m.host && m.priv ? "<small>host</small>" : ""}</li>`);
  if (m.bots) rows.push(`<li class="bot"><span class="av" style="background:#8b7cff"></span>+ ${m.bots} bot${m.bots > 1 ? "s" : ""}</li>`);
  const html = rows.join("");
  if (ui.people.dataset.html !== html) { ui.people.innerHTML = html; ui.people.dataset.html = html; }
}

// ───────── match ─────────
function onMatch(m) {
  S.mode = "match";
  clearInterval(lobbyTimer);
  S.bodies = m.bodies.map((b) => ({ ...b }));
  S.you = m.you;
  S.turn = m.turn;
  S.phase = m.state;
  S.locks = new Set();
  S.volley = null;
  S.trails = [];
  S.ghosts = [];
  S.over = null;
  S.pendingOver = null;
  draw.sprites.clear();
  draw.parts = [];
  draw.rings = [];
  draw.pops = [];
  ui.menu.hidden = true;
  ui.lobby.hidden = true;
  ui.results.hidden = true;
  ui.hud.hidden = false;
  const me = myPlanet();
  if (me) {
    // start aimed at the middle of the map, half power
    const dx = SIM.W / 2 - me.x, dy = SIM.H / 2 - me.y, d = Math.hypot(dx, dy) || 1;
    const sp = SIM.VMIN + (SIM.VMAX - SIM.VMIN) * 0.45;
    S.aim = clampAim((dx / d) * sp, (dy / d) * sp);
  } else S.aim = null;
  S.locked = false;
  refreshPreview();
  if (m.state === "aim") { S.deadline = performance.now() + m.ms; S.total = m.ms; }
  renderRoster();
  callout(me ? "Find your planet" : "Spectating", me ? "Yours has the pulsing ring" : "You'll join the next match");
}

function myPlanet() {
  return S.you ? S.bodies.find((b) => b.id === S.you) : null;
}
function iAmAlive() {
  const me = myPlanet();
  return !!(me && me.hp > 0);
}

function onAimPhase(m) {
  finishVolley(true);
  S.phase = "aim";
  S.turn = m.turn;
  S.deadline = performance.now() + m.ms;
  S.total = m.ms;
  S.locked = false;
  S.locks = new Set();
  S.lastTick = -1;
  if (iAmAlive()) {
    sendAim(false);
    callout(`Turn ${m.turn}`, "Aim your shot");
  } else callout(`Turn ${m.turn}`, "Watching from the wreckage");
  sfx.turn();
  renderRoster();
}

function onVolley(m) {
  finishVolley(true);
  S.phase = "fly";
  S.dragging = false;
  const vol = new Volley(S.bodies, m.shots);
  S.trails = vol.p.map((p) => {
    const b = S.bodies.find((x) => x.id === p.owner);
    return { pts: [p.x, p.y], color: b ? b.color : "#fff", alive: true, owner: p.owner };
  });
  S.volley = { vol, acc: 0, hp: m.hp, shots: m.shots, ev: m.ev, steps: m.steps };
  S.lastVolley = { shots: m.shots, ev: m.ev, steps: m.steps, bodies: S.bodies.map((b) => ({ ...b })) };
  callout("Fire!", m.shots.length === 1 ? "One shot in the air" : `${m.shots.length} shots in the air`);
  sfx.launch(m.shots.length);
  for (const p of vol.p) draw.burst(p.x, p.y, colorOf(p.owner), 10, 120, 0.4, 1.6);
  renderRoster();
}

function colorOf(pid) {
  const b = S.bodies.find((x) => x.id === pid);
  return b && b.color ? b.color : "#ffffff";
}

function stepVolley(dt) {
  const V = S.volley;
  if (!V) return;
  V.acc += dt * (1 / SIM.DT) * SIM.PLAYBACK;
  let n = 0;
  while (V.acc >= 1 && !V.vol.done && n < 400) {
    V.acc -= 1;
    n++;
    const evs = V.vol.advance();
    V.vol.p.forEach((p, i) => {
      if (p.alive && (V.vol.step & 1) === 0) S.trails[i].pts.push(p.x, p.y);
    });
    for (const e of evs) onShotEvent(e, true);
  }
  if (V.vol.done) finishVolley(false);
}

function onShotEvent(e, fx) {
  const tr = S.trails[e.i];
  if (tr) { tr.alive = false; tr.pts.push(e.x, e.y); }
  if (!fx) return;
  if (e.kind === "planet") {
    const b = S.bodies.find((x) => x.id === e.body);
    const col = b ? b.color : "#ffffff";
    draw.explode(e.x, e.y, col, e.kill);
    sfx.hit(e.kill);
    if (e.loop) draw.pop(e.x, e.y, "ORBIT SHOT ×2", "#ffc94d", true);
    else draw.pop(e.x, e.y, e.body === e.owner ? "−1 own goal" : "−1", "#ffffff");
    if (e.kill && b) {
      const vb = S.volley && S.volley.vol.byId.get(b.id);
      if (vb) b.hp = 0;
      if (b.id === S.you) { callout("Planet lost", "You're out. Stick around for the finish"); sfx.lose(); }
      else callout(`${b.name} destroyed`, e.owner === S.you ? "Your shot!" : "");
      if (navigator.vibrate && b.id === S.you) navigator.vibrate([80, 40, 140]);
    } else if (b && b.id === S.you && navigator.vibrate) navigator.vibrate(60);
    if (b && !e.kill) b.hp = Math.max(0, b.hp - e.dmg);
    renderRoster();
  } else if (e.kind === "star") {
    draw.burst(e.x, e.y, "#ffb347", 18, 120, 0.7, 2);
    draw.ring(e.x, e.y, "#ffcf7a", 4, 40, 0.5, 2);
    sfx.sun();
  } else if (e.kind === "hole") {
    draw.ring(e.x, e.y, "#c58cff", 46, 2, 0.6, 2);
    sfx.hole();
  } else if (e.kind === "moon") {
    draw.burst(e.x, e.y, "#cfcbe6", 16, 110, 0.6, 1.8);
    sfx.moon();
  }
}

function finishVolley(fast) {
  const V = S.volley;
  if (!V) return;
  if (fast) {
    let guard = 0;
    while (!V.vol.done && guard++ < 5000) for (const e of V.vol.advance()) onShotEvent(e, e.kill);
  }
  // the server's word is final
  for (const b of S.bodies) if (b.kind === "planet" && V.hp && b.id in V.hp) b.hp = V.hp[b.id];
  S.ghosts = S.trails.map((t) => ({ pts: t.pts, color: t.color, mine: t.owner === S.you }));
  S.trails = [];
  S.volley = null;
  renderRoster();
  refreshPreview();
  if (S.pendingOver) {
    const m = S.pendingOver;
    S.pendingOver = null;
    setTimeout(() => showResults(m), 1400);
  }
}

function onOver(m) {
  S.phase = "over";
  S.over = m;
  if (S.volley) S.pendingOver = m;
  else setTimeout(() => showResults(m), 600);
}

function showResults(m) {
  if (S.mode !== "match") return;
  const win = m.winner && S.bodies.find((b) => b.id === m.winner);
  const mine = win && win.id === S.you;
  ui.resKicker.textContent = `Match over · ${m.turns} turn${m.turns === 1 ? "" : "s"}`;
  ui.resTitle.innerHTML = !win ? "Mutual destruction" : mine ? `<span class="who">You</span> win!` : `<span class="who">${esc(win.name)}</span> wins`;
  if (mine) sfx.win();
  let rank = 0;
  const rows = [];
  for (const group of m.ranking) {
    rank++;
    for (const pid of group) {
      const b = S.bodies.find((x) => x.id === pid);
      if (!b) continue;
      const st = m.stats[pid] || {};
      rows.push(`<li class="${pid === S.you ? "me" : ""}"><span class="rk">${rank}</span><span class="sw" style="background:${b.color}"></span><span>${esc(pid === S.you ? "You" : b.name)}${b.bot ? ' <small style="color:var(--ink-3)">bot</small>' : ""}</span><span class="st"><b>${st.hits || 0}</b>/${st.shots || 0} hits${st.loops ? ` · <b>${st.loops}</b> orbit` : ""}</span></li>`);
    }
  }
  ui.resList.innerHTML = rows.join("");
  ui.again.textContent = S.priv ? (S.lobby && S.lobby.host === S.myId ? "Rematch" : "Back to room") : "Play again";
  ui.results.hidden = false;
}

// ───────── aiming ─────────
function refreshPreview() {
  const me = myPlanet();
  S.preview = me && S.aim && me.hp > 0 ? previewPath(S.bodies, me.id, S.aim.vx, S.aim.vy) : [];
}

function setAimFromScreen(px, py) {
  const me = myPlanet();
  if (!me) return;
  const w = draw.toWorld(px, py);
  const dx = w.x - me.x, dy = w.y - me.y, d = Math.hypot(dx, dy);
  if (d < me.r * 0.5) return;
  const pw = clamp((d - me.r) / SIM.POWER_DIST, 0, 1);
  const sp = SIM.VMIN + (SIM.VMAX - SIM.VMIN) * pw;
  S.aim = clampAim((dx / d) * sp, (dy / d) * sp);
  if (S.locked) setLocked(false);
  S.aimDirty = true;
  refreshPreview();
}

function sendAim(lock) {
  if (!S.aim || !iAmAlive()) return;
  send({ t: "aim", vx: S.aim.vx, vy: S.aim.vy, lock: !!lock });
  S.lastAimSent = performance.now();
  S.aimDirty = false;
}

function setLocked(on) {
  if (S.phase !== "aim" || !iAmAlive()) return;
  S.locked = on;
  sendAim(on);
  sfx.lock(on);
  if (on) S.locks.add(S.you);
  else S.locks.delete(S.you);
  renderRoster();
}

const canAim = () => S.mode === "match" && S.phase === "aim" && iAmAlive();

$("fx").addEventListener("pointerdown", (e) => {
  sfx.unlock();
  if (!canAim() || (e.pointerType === "mouse" && e.button !== 0)) return;
  S.dragging = true;
  S.dragId = e.pointerId;
  setAimFromScreen(e.clientX, e.clientY);
  ui.hint.classList.add("off");
});
addEventListener("pointermove", (e) => {
  if (!S.dragging || e.pointerId !== S.dragId) return;
  if (!canAim()) { S.dragging = false; return; }
  setAimFromScreen(e.clientX, e.clientY);
});
const endDrag = (e) => {
  if (!S.dragging || e.pointerId !== S.dragId) return;
  S.dragging = false;
  sendAim(false);
};
addEventListener("pointerup", endDrag);
addEventListener("pointercancel", endDrag);

addEventListener("keydown", (e) => {
  if (e.key === "m" || e.key === "M") { toggleMute(); return; }
  if (!canAim() || !S.aim) return;
  const k = e.key;
  let sp = Math.hypot(S.aim.vx, S.aim.vy), a = Math.atan2(S.aim.vy, S.aim.vx);
  const step = e.shiftKey ? 5 : 1;
  if (k === "ArrowLeft") a -= (step * Math.PI) / 180;
  else if (k === "ArrowRight") a += (step * Math.PI) / 180;
  else if (k === "ArrowUp") sp += (SIM.VMAX - SIM.VMIN) * 0.02 * step;
  else if (k === "ArrowDown") sp -= (SIM.VMAX - SIM.VMIN) * 0.02 * step;
  else if (k === "Enter" || k === " ") { e.preventDefault(); setLocked(!S.locked); return; }
  else return;
  e.preventDefault();
  S.aim = clampAim(Math.cos(a) * sp, Math.sin(a) * sp);
  if (S.locked) setLocked(false);
  S.aimDirty = true;
  refreshPreview();
});

ui.lock.addEventListener("click", () => { sfx.unlock(); setLocked(!S.locked); });

// ───────── HUD ─────────
let calloutTimer = 0;
function callout(big, small) {
  ui.callout.innerHTML = `${esc(big)}${small ? `<small>${esc(small)}</small>` : ""}`;
  ui.callout.className = "callout";
  void ui.callout.offsetWidth;
  ui.callout.className = "callout show";
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => { ui.callout.className = "callout"; ui.callout.innerHTML = ""; }, 2300);
}

function renderRoster() {
  if (S.mode !== "match") return;
  const planets = S.bodies.filter((b) => b.kind === "planet");
  const html = planets
    .map((b) => {
      const dead = !(b.hp > 0);
      const me = b.id === S.you;
      const pips = Array.from({ length: SIM.HP }, (_, i) => `<i class="${i < b.hp ? "" : "gone"}"></i>`).join("");
      const ready = S.locks.has(b.id);
      const stt = dead ? "✕" : S.phase === "aim" || S.phase === "resolving" ? (ready ? "✓" : "…") : "";
      return `<li class="${me ? "me" : ""} ${dead ? "dead" : ""}"><span class="sw" style="background:${b.color};box-shadow:0 0 8px ${b.color}"></span><span class="nm">${esc(me ? "You" : b.name)}</span><span class="hp">${pips}</span><span class="stt ${ready ? "ok" : ""}">${stt}</span></li>`;
    })
    .join("");
  if (ui.roster.dataset.html !== html) { ui.roster.innerHTML = html; ui.roster.dataset.html = html; }
}

let toastTimer = 0;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 2800);
}

function hud(now) {
  if (S.mode !== "match") return;
  ui.turnN.textContent = `Turn ${Math.max(1, S.turn)}`;
  const ph = { intro: "Get ready", aim: "Aim", resolving: "Launching", fly: "In flight", over: "Over" }[S.phase] || "";
  ui.turnPh.textContent = ph;
  let frac = 0;
  if (S.phase === "aim") {
    const left = Math.max(0, S.deadline - now);
    frac = left / S.total;
    const secs = Math.ceil(left / 1000);
    if (secs <= 5 && secs !== S.lastTick && left > 0) { S.lastTick = secs; sfx.tick(); }
    ui.turnPh.textContent = `Aim · ${secs}s`;
    ui.timerBox.classList.toggle("low", secs <= 5);
  }
  ui.timer.style.transform = `scaleX(${frac})`;
  const showAim = canAim();
  ui.aimbar.classList.toggle("off", !showAim);
  if (!showAim) ui.hint.classList.add("off");
  else if (!S.hintDone) ui.hint.classList.remove("off");
  if (S.dragging) S.hintDone = true;
  ui.lock.textContent = S.locked ? "Locked ✓" : "Lock in";
  ui.lock.classList.toggle("locked", S.locked);
  if (S.aim) {
    const sp = Math.hypot(S.aim.vx, S.aim.vy);
    ui.pow.textContent = Math.round(((sp - SIM.VMIN) / (SIM.VMAX - SIM.VMIN)) * 100) + "%";
    // angle as seen on screen, 0° = right, counter-clockwise
    const me = myPlanet();
    if (me) {
      const x0 = draw.sx(me.x, me.y), y0 = draw.sy(me.x, me.y);
      const x1 = draw.sx(me.x + S.aim.vx, me.y + S.aim.vy), y1 = draw.sy(me.x + S.aim.vx, me.y + S.aim.vy);
      let deg = Math.round((Math.atan2(-(y1 - y0), x1 - x0) * 180) / Math.PI);
      if (deg < 0) deg += 360;
      ui.ang.textContent = deg + "°";
    }
  }
  if (S.dragging && S.aimDirty && now - S.lastAimSent > 140) sendAim(false);
}

// ───────── buttons ─────────
$("play-form").addEventListener("submit", (e) => { e.preventDefault(); play({ mode: "quick" }); });
$("btn-create").addEventListener("click", () => play({ mode: "create" }));
$("join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const code = ui.code.value.toUpperCase().replace(/[^A-Z]/g, "");
  if (code.length !== 4) { toast("Room codes are 4 letters."); return; }
  play({ mode: "join", code });
});
ui.code.addEventListener("input", () => { ui.code.value = ui.code.value.toUpperCase().replace(/[^A-Z]/g, ""); });
ui.start.addEventListener("click", () => { sfx.unlock(); send({ t: "start" }); });
$("btn-lobby-leave").addEventListener("click", () => { send({ t: "leave" }); showMenu(); });
$("btn-leave").addEventListener("click", () => { send({ t: "leave" }); showMenu(); });
$("bots-minus").addEventListener("click", () => send({ t: "bots", n: (S.lobby?.bots || 0) - 1 }));
$("bots-plus").addEventListener("click", () => send({ t: "bots", n: (S.lobby?.bots || 0) + 1 }));
$("btn-copy").addEventListener("click", () => {
  const url = location.origin + location.pathname + "?room=" + S.code;
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(() => toast("Invite link copied"), () => toast(url));
  else toast(url);
});
$("btn-res-menu").addEventListener("click", () => { send({ t: "leave" }); showMenu(); });
ui.again.addEventListener("click", () => {
  sfx.unlock();
  if (S.priv) {
    if (S.lobby && S.lobby.host === S.myId) send({ t: "start" });
    else showLobby();
  } else {
    play({ mode: "quick" });
  }
});
ui.mute.addEventListener("click", toggleMute);
function toggleMute() {
  sfx.unlock();
  sfx.setMuted(!sfx.muted);
  ui.mute.textContent = sfx.muted ? "🔇" : "🔊";
}
ui.mute.textContent = sfx.muted ? "🔇" : "🔊";

function showMenu() {
  S.mode = "menu";
  S.you = null;
  S.volley = null;
  S.trails = [];
  S.ghosts = [];
  clearInterval(lobbyTimer);
  ui.hud.hidden = true;
  ui.lobby.hidden = true;
  ui.results.hidden = true;
  ui.menu.hidden = false;
  history.replaceState(null, "", location.pathname);
}

// ───────── menu backdrop: a little system with comets on loop ─────────
const DEMO = [
  { id: "s0", kind: "star", x: 560, y: 470, r: 62, gm: 2.3e7, hue: 0.3 },
  { id: "h0", kind: "hole", x: 1130, y: 560, r: 17, gm: 2.6e7 },
  { id: "m0", kind: "moon", x: 300, y: 220, r: 24, gm: 2.4e6 },
  { id: "m1", kind: "moon", x: 1330, y: 210, r: 19, gm: 1.8e6 },
  { id: "p0", kind: "planet", x: 170, y: 760, r: 26, gm: 1.4e6, hp: 3, color: "#ff5d73", name: "" },
  { id: "p1", kind: "planet", x: 900, y: 120, r: 26, gm: 1.4e6, hp: 3, color: "#4dd4ff", name: "" },
  { id: "p2", kind: "planet", x: 1440, y: 860, r: 26, gm: 1.4e6, hp: 3, color: "#ffc94d", name: "" },
];
function demoStep(dt) {
  if (!S.demo || S.demo.vol.done) {
    const shots = DEMO.filter((b) => b.kind === "planet").map((p) => {
      const a = Math.random() * TAU, sp = 200 + Math.random() * 260;
      return { owner: p.id, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp };
    });
    const vol = new Volley(DEMO, shots);
    S.demo = { vol, acc: 0, trails: vol.p.map((p) => ({ pts: [p.x, p.y], color: colorOfDemo(p.owner), alive: true })) };
  }
  const D = S.demo;
  D.acc += dt * 120;
  while (D.acc >= 1 && !D.vol.done) {
    D.acc -= 1;
    const evs = D.vol.advance();
    D.vol.p.forEach((p, i) => { if (p.alive && (D.vol.step & 1) === 0) D.trails[i].pts.push(p.x, p.y); });
    for (const e of evs) {
      D.trails[e.i].alive = false;
      if (e.kind === "star") draw.burst(e.x, e.y, "#ffb347", 10, 90, 0.6, 1.6);
      if (e.kind === "planet") draw.burst(e.x, e.y, colorOfDemo(e.body), 14, 110, 0.7, 1.8);
    }
  }
}
function colorOfDemo(id) {
  const b = DEMO.find((x) => x.id === id);
  return (b && b.color) || "#fff";
}

// ───────── camera + loop ─────────
function resize() {
  const dpr = window.devicePixelRatio || 1;
  space.resize(innerWidth, innerHeight, dpr);
  draw.resize(innerWidth, innerHeight, dpr);
}
addEventListener("resize", resize);
resize();

function updateCam() {
  const W = innerWidth, H = innerHeight;
  const rot = H > W * 1.12;
  const inMatch = S.mode === "match";
  const padTop = inMatch ? (W < 640 ? 64 : 66) : 0;
  const padBot = inMatch ? (W < 640 ? 150 : 92) : 0;
  const ww = rot ? SIM.H : SIM.W, wh = rot ? SIM.W : SIM.H;
  const availW = W - 16, availH = Math.max(120, H - padTop - padBot);
  const s = Math.min(availW / (ww + 60), availH / (wh + 60)) * (inMatch ? 1 : 1.08);
  S.cam = { x: W / 2, y: padTop + availH / 2, s, rot };
  draw.setCam(S.cam);
}

const heavy = () => (S.mode === "match" ? S.bodies : DEMO).filter((b) => b.kind === "star" || b.kind === "hole");
function lightDir(b) {
  let best = null, bi = 0;
  for (const h of heavy()) {
    const d = Math.hypot(h.x - b.x, h.y - b.y) || 1;
    const k = h.gm / (d * d);
    if (k > bi) { bi = k; best = { x: (h.x - b.x) / d, y: (h.y - b.y) / d }; }
  }
  if (!best) return { x: -0.6, y: -0.6 };
  // rotate into screen space with the camera
  return S.cam.rot ? { x: -best.y, y: best.x } : best;
}

let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const t = now / 1000;
  updateCam();

  let bodies, view;
  if (S.mode === "match") {
    stepVolley(dt);
    bodies = S.bodies;
    const me = myPlanet();
    view = {
      bodies, phase: S.phase, you: S.you, locks: S.locks, ghosts: S.ghosts, trails: S.trails, lightDir,
      aimView: canAim() && S.aim && me ? { x: me.x, y: me.y, r: me.r, vx: S.aim.vx, vy: S.aim.vy, color: me.color, preview: S.preview, locked: S.locked } : null,
    };
    hud(now);
  } else {
    demoStep(dt);
    bodies = DEMO;
    view = { bodies, phase: "demo", you: null, locks: new Set(), ghosts: [], trails: S.demo ? S.demo.trails : [], lightDir, aimView: null };
  }
  draw.step(dt, heavy());
  space.draw(S.cam, SIM.W, SIM.H, t, bodies, draw.flash);
  draw.draw(view, t);
}
requestAnimationFrame(frame);
connect();

window.__gw = { S, send, draw };
