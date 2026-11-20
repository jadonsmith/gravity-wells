// Gravity Wells: WebGL2 backdrop.
// A starfield + nebula seen *through* the system's gravity (point-mass lensing: the
// background is sampled at β = θ − θE²·θ/|θ|², so black holes grow Einstein rings),
// a spacetime grid pinched toward every mass, glowing suns and a black hole with an
// accretion disk. Planets and moons are drawn on the 2D layer above.

const VS = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec2 uC;        // world centre on canvas (px)
uniform float uS;       // canvas px per world unit
uniform float uRot;     // 1 = world rotated 90° (portrait)
uniform vec2 uWH;       // world size
uniform float uT;
uniform int uN;
uniform vec4 uB[12];    // x, y, r, gm
uniform vec4 uK[12];    // kind (0 star, 1 hole, 2 moon, 3 planet), hue, alive, -
uniform float uFlash;
out vec4 o;

float h21(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
vec2 h22(vec2 p) { float a = h21(p); return vec2(a, h21(p + a)); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.55;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

float starLayer(vec2 p, float cell, float dens, float sz) {
  vec2 c = floor(p / cell);
  vec2 f = p / cell - c;
  float s = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 n = c + vec2(i, j);
    vec2 r = h22(n);
    if (r.x > dens) continue;
    vec2 pos = vec2(i, j) + h22(n + 7.7) - f;
    float d = length(pos) * cell;
    float tw = 0.65 + 0.35 * sin(uT * (1.0 + r.y * 3.0) + r.x * 40.0);
    s += exp(-d * d / (sz * sz)) * tw * (0.4 + r.y);
  }
  return s;
}

vec3 sunColor(float hue, float k) {
  vec3 warm = mix(vec3(1.0, 0.55, 0.2), vec3(1.0, 0.85, 0.55), k);
  vec3 cool = mix(vec3(0.45, 0.65, 1.0), vec3(0.85, 0.92, 1.0), k);
  return mix(warm, cool, smoothstep(0.65, 0.95, hue));
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 d = (px - uC) / uS;
  vec2 w = (uRot > 0.5 ? vec2(d.y, -d.x) : d) + uWH * 0.5;
  float pw = 1.0 / uS;

  // lensing + grid pinch
  vec2 wl = w, wg = w;
  float depth = 0.0;
  for (int i = 0; i < 12; i++) {
    if (i >= uN) break;
    vec4 b = uB[i];
    if (uK[i].z < 0.5) continue;
    vec2 dd = w - b.xy;
    float r2 = dot(dd, dd);
    float E2 = b.w * (uK[i].x > 0.5 && uK[i].x < 1.5 ? 2.2e-4 : 1.6e-4);
    wl -= dd * E2 / max(r2, 1.0);
    float c2 = b.z * b.z * 5.0;
    wg += dd * (b.w * 4.0e-4) / (r2 + c2);
    depth += b.w / sqrt(r2 + c2);
  }

  // deep space behind everything
  vec2 bp = wl;
  float neb = fbm(bp / 520.0 + vec2(3.1, 1.7));
  float neb2 = fbm(bp / 260.0 - vec2(5.4, 2.2));
  vec3 col = mix(vec3(0.012, 0.01, 0.04), vec3(0.03, 0.022, 0.075), smoothstep(0.0, 1.0, w.y / uWH.y));
  col += vec3(0.35, 0.12, 0.42) * pow(neb, 3.0) * 0.55;
  col += vec3(0.08, 0.25, 0.45) * pow(neb2, 4.0) * 0.5;
  col += vec3(0.85, 0.88, 1.0) * starLayer(bp, 26.0, 0.18, 0.9 + pw * 0.7);
  col += vec3(1.0, 0.92, 0.8) * starLayer(bp + 311.0, 70.0, 0.22, 1.4 + pw * 0.7) * 0.9;
  col += vec3(0.75, 0.85, 1.0) * starLayer(bp + 97.0, 160.0, 0.3, 2.2 + pw * 0.7) * 0.8;

  // spacetime grid, inside the map only
  vec2 g = wg / 80.0;
  vec2 gv = abs(fract(g) - 0.5);
  vec2 fw = fwidth(g) * 1.3;
  float line = max(1.0 - smoothstep(0.0, fw.x, 0.5 - gv.x), 1.0 - smoothstep(0.0, fw.y, 0.5 - gv.y));
  vec2 inMap = smoothstep(vec2(-40.0), vec2(40.0), w) * smoothstep(vec2(-40.0), vec2(40.0), uWH - w);
  float gm = clamp(depth * 9.0e-6, 0.0, 1.0);
  col += mix(vec3(0.15, 0.55, 0.75), vec3(0.65, 0.4, 1.0), gm) * line * (0.06 + gm * 0.22) * inMap.x * inMap.y;

  // suns and black holes
  for (int i = 0; i < 12; i++) {
    if (i >= uN) break;
    vec4 b = uB[i];
    vec4 k = uK[i];
    vec2 dd = w - b.xy;
    float r = length(dd);
    if (k.x < 0.5) {
      // a sun: limb-darkened disc, churning surface, flaring corona
      float R = b.z;
      float ang = atan(dd.y, dd.x);
      if (r < R) {
        float mu = sqrt(1.0 - (r * r) / (R * R));
        float gran = fbm(dd / (R * 0.18) + vec2(uT * 0.3, -uT * 0.2));
        vec3 c = sunColor(k.y, 0.55 + 0.45 * mu) * (0.75 + 0.45 * mu) * (0.85 + 0.3 * gran);
        col = mix(col, c * 1.25, smoothstep(R, R - pw * 1.5, r));
      }
      float cor = exp(-max(r - R, 0.0) / (R * 0.42));
      float flare = 0.6 + 0.6 * fbm(vec2(ang * 3.0, uT * 0.25 + r / R * 0.5));
      float rays = pow(max(0.0, sin(ang * 7.0 + uT * 0.15) * 0.5 + 0.5), 6.0) * exp(-max(r - R, 0.0) / (R * 1.4));
      col += sunColor(k.y, 0.4) * (cor * flare * 0.9 + rays * 0.25) * step(R * 0.98, r);
      col += sunColor(k.y, 0.2) * exp(-r / (R * 3.2)) * 0.18;
    } else if (k.x < 1.5) {
      // a black hole: shadow, photon ring, tilted accretion disk
      float R = b.z;
      vec2 q = vec2(dd.x, dd.y / 0.3);
      float rq = length(q);
      float ang = atan(q.y, q.x);
      float diskBand = smoothstep(R * 1.7, R * 2.1, rq) * (1.0 - smoothstep(R * 3.2, R * 5.2, rq));
      float swirl = fbm(vec2(ang * 2.5 - uT * 1.6 + rq * 0.06, rq * 0.08));
      float doppler = 0.7 + 0.6 * clamp(dd.x / (R * 4.0), -1.0, 1.0);
      vec3 disk = mix(vec3(1.0, 0.45, 0.15), vec3(1.0, 0.9, 0.7), swirl) * diskBand * (0.6 + 0.9 * swirl) * doppler;
      float front = step(0.0, dd.y);            // lower half of the disk passes in front
      float shadow = smoothstep(R * 1.02, R * 0.9, r);
      col += disk * (1.0 - shadow * (1.0 - front)) * 1.4;
      col *= 1.0 - shadow * (1.0 - front * diskBand);
      float ring = exp(-abs(r - R * 1.5) / (pw * 1.2 + R * 0.06));
      col += vec3(1.0, 0.8, 0.55) * ring * 0.9 * (1.0 - shadow);
      col += vec3(0.9, 0.5, 0.25) * exp(-r / (R * 6.0)) * 0.12;
    }
  }

  vec2 uv = px / uRes - 0.5;
  col *= 1.0 - 0.55 * dot(uv, uv);
  col += uFlash * vec3(1.0, 0.95, 0.85);
  col += (h21(px + uT) - 0.5) * 0.012;
  o = vec4(col, 1.0);
}`;

export class Space {
  constructor(canvas) {
    this.c = canvas;
    this.k = 1;
    this.ok = false;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" });
    if (!gl) return;
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS);
    if (!v || !f) return;
    const p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(p)); return; }
    this.prog = p;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const loc = gl.getAttribLocation(p, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ["uRes", "uC", "uS", "uRot", "uWH", "uT", "uN", "uB", "uK", "uFlash"]) this.u[n] = gl.getUniformLocation(p, n);
    this.B = new Float32Array(48);
    this.K = new Float32Array(48);
    this.ok = true;
  }

  resize(cssW, cssH, dpr) {
    const k = Math.min(dpr, 1.5) * (cssW * cssH > 1.4e6 ? 0.62 : 0.8);
    this.k = k;
    const w = Math.max(1, Math.round(cssW * k)), h = Math.max(1, Math.round(cssH * k));
    if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h; }
  }

  draw(cam, W, H, t, bodies, flash) {
    if (!this.ok) return;
    const gl = this.gl, u = this.u, k = this.k;
    const n = Math.min(12, bodies.length);
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      this.B[i * 4] = b.x;
      this.B[i * 4 + 1] = b.y;
      this.B[i * 4 + 2] = b.r;
      this.B[i * 4 + 3] = b.gm;
      this.K[i * 4] = b.kind === "star" ? 0 : b.kind === "hole" ? 1 : b.kind === "moon" ? 2 : 3;
      this.K[i * 4 + 1] = b.hue || 0;
      this.K[i * 4 + 2] = b.kind === "planet" && !(b.hp > 0) ? 0 : 1;
    }
    gl.viewport(0, 0, this.c.width, this.c.height);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(u.uRes, this.c.width, this.c.height);
    gl.uniform2f(u.uC, cam.x * k, cam.y * k);
    gl.uniform1f(u.uS, cam.s * k);
    gl.uniform1f(u.uRot, cam.rot ? 1 : 0);
    gl.uniform2f(u.uWH, W, H);
    gl.uniform1f(u.uT, t);
    gl.uniform1i(u.uN, n);
    gl.uniform4fv(u.uB, this.B);
    gl.uniform4fv(u.uK, this.K);
    gl.uniform1f(u.uFlash, flash || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
