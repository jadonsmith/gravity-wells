# Gravity Wells

Simultaneous-turn gravity artillery, part of the [play.jadon.me](https://play.jadon.me)
collection (`play.jadon.me/gravity/`).

Each player owns a planet in a randomly generated system: one big sun, a binary
pair, or a black hole (sometimes with a companion star), plus 1–3 moons. Everyone
aims at the same time by dragging from their planet: direction is where you drag
and distance is power. The preview shows only the first 0.55 s of the path.
When the timer runs out, or once every human has locked in, all shots launch
together. Everything with mass pulls on them, planets included. Planets have 3
hull points. A shot that turns through a full orbit (≥ 2π) before hitting does
double damage. Last planet standing wins.

- **Quick play** groups whoever presses Play within ~4.5 s and fills to 4 planets
  with bots ("Start now" skips the wait).
- **Private room**: 4-letter code, invite link `?room=CODE`. The host picks 0–5
  bots and starts. If you leave mid-match, a bot takes over your planet.

## How the netcode works

`public/js/sim.js` is shared by the server and every client. It uses only
`+ − × ÷` and `Math.sqrt`, with no trig or randomness, and JSON round-trips doubles
exactly, so a volley replays bit-for-bit everywhere. The server runs the volley
to decide the outcome (`game.js`), then broadcasts just the launch vectors and the
resulting hit points. Clients replay the volley at 1.8× speed for display, and
apply the server's hit points at the end as the final word.

Bots (`botAim` in `game.js`) test ~170 candidate shots in the same sim,
concentrating around last turn's best. They keep the best shot, then add aim
noise. In bot-only matches they hit about 40% of shots, and a 4-player match takes
about 8 turns.

## Code map

| File | What |
| --- | --- |
| `public/js/sim.js` | Shared, deterministic volley sim + aim preview |
| `game.js` | Room: lobby, system generation, turns, scoring, bots |
| `server.js` | Static files + `ws`, rooms/codes |
| `public/js/space.js` | WebGL2 backdrop: lensed starfield/nebula, pinched spacetime grid, suns, black-hole disk |
| `public/js/draw.js` | 2D: lit planets, moons, comet trails, aim arrow + preview, explosions with debris |
| `public/js/main.js` | Client state, aiming input (drag / arrows / Enter), volley playback, HUD |

Portrait screens rotate the world 90° (camera only; the game logic doesn't
change). Dev handle: `window.__gw`.

```bash
npm install && npm start     # http://localhost:3090
```
