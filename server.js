// Gravity Wells: static file server + WebSocket rooms in one Node process.
// Quick play groups whoever presses Play within a few seconds and fills the rest with
// bots. Private rooms use a 4-letter code. Game rules live in game.js, physics in public/js/sim.js.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { Room, RULES } from "./game.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3090;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const NAME_MAX = 16;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

// ---------- static files ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split("?")[0]); } catch { res.writeHead(400); res.end(); return; }
  if (urlPath.endsWith("/")) urlPath += "index.html";
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const mtime = st.mtime.toUTCString();
    if (req.headers["if-modified-since"] === mtime) { res.writeHead(304); res.end(); return; }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      "Content-Length": st.size,
      "Last-Modified": mtime,
      "Cache-Control": "no-cache",
    });
    if (req.method === "HEAD") { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, maxPayload: 4096 });

// ---------- rooms ----------
const rooms = new Set();
const byCode = new Map();

function sendRaw(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 1 << 19) ws.send(data);
}
function sendWs(ws, msg) { sendRaw(ws, JSON.stringify(msg)); }

function makeRoom(isPrivate) {
  let code = null;
  if (isPrivate) do { code = ""; for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; } while (byCode.has(code));
  const room = new Room({
    isPrivate, code,
    send: (m, msg) => sendWs(m.ws, msg),
    broadcast: (msg) => {
      const data = JSON.stringify(msg);
      for (const m of room.members.values()) if (m.ws) sendRaw(m.ws, data);
    },
    onEmpty: (r) => dropRoom(r),
  });
  rooms.add(room);
  if (code) byCode.set(code, room);
  return room;
}

function dropRoom(room) {
  room.destroy();
  rooms.delete(room);
  if (room.code) byCode.delete(room.code);
  for (const m of room.members.values()) if (m.ws && m.ws.room === room) { m.ws.room = null; m.ws.member = null; }
}

function cleanName(s) {
  return String(s || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  const id = ws.member.id;
  ws.room = null;
  ws.member = null;
  room.removeHuman(id);
}

function join(ws, room, name) {
  leave(ws);
  ws.room = room;
  ws.member = room.addHuman(ws, name);
}

// ---------- sockets ----------
let online = 0;
let onlineDirty = false;

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.room = null;
  ws.member = null;
  ws.win = Date.now();
  ws.count = 0;
  ws.on("pong", () => { ws.isAlive = true; });
  online++;
  onlineDirty = true;
  sendWs(ws, { t: "hi", online });

  ws.on("message", (raw) => {
    const now = Date.now();
    if (now - ws.win > 1000) { ws.win = now; ws.count = 0; }
    if (++ws.count > 80) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== "string") return;
    const room = ws.room, me = ws.member;

    switch (msg.t) {
      case "play": {
        const name = cleanName(msg.name) || "Player";
        if (msg.mode === "create") {
          join(ws, makeRoom(true), name);
        } else if (msg.mode === "join") {
          const code = String(msg.code || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
          const r = byCode.get(code);
          if (!r) { sendWs(ws, { t: "err", msg: "No room with that code. Check it and try again.", fatal: true }); return; }
          if (r.humans >= RULES.MAX_PLAYERS) { sendWs(ws, { t: "err", msg: "That room is full.", fatal: true }); return; }
          join(ws, r, name);
        } else {
          let best = null;
          for (const r of rooms) if (!r.isPrivate && r.joinable && (!best || r.humans > best.humans)) best = r;
          join(ws, best || makeRoom(false), name);
        }
        break;
      }
      case "start":
        if (room) room.requestStart(me.id);
        break;
      case "bots":
        if (room) room.setBots(me.id, msg.n);
        break;
      case "aim":
        if (room) room.onAim(me, msg.vx, msg.vy, msg.lock);
        break;
      case "leave":
        leave(ws);
        sendWs(ws, { t: "left-ok" });
        break;
      case "ping":
        sendWs(ws, { t: "pong", c: msg.c });
        break;
    }
  });

  ws.on("close", () => {
    leave(ws);
    online--;
    onlineDirty = true;
  });
  ws.on("error", () => {});
});

setInterval(() => {
  if (!onlineDirty) return;
  onlineDirty = false;
  const data = JSON.stringify({ t: "online", n: online });
  for (const ws of wss.clients) sendRaw(ws, data);
}, 1000);

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 25000);
wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, HOST, () => {
  console.log(`Gravity Wells listening on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    for (const ws of wss.clients) { try { ws.close(1001, "server restarting"); } catch {} }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
