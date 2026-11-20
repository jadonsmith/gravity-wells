// Gravity Wells: synthesized sound effects (WebAudio, no assets).

export class Sfx {
  constructor(key = "gw_mute") {
    this.key = key;
    this.ctx = null;
    try { this.muted = localStorage.getItem(key) === "1"; } catch { this.muted = false; }
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch { this.ctx = null; }
    } else if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem(this.key, m ? "1" : "0"); } catch {}
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
  }

  get ready() { return this.ctx && this.ctx.state === "running" && !this.muted; }

  tone(f0, f1, dur, type = "sine", vol = 0.1, delay = 0) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, f0, f1, q = 1, vol = 0.1, delay = 0) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  launch(n = 1) {
    this.tone(90, 42, 0.45, "sine", Math.min(0.32, 0.14 + n * 0.04));
    this.noise(0.35, 900, 160, 1.1, 0.12);
    this.tone(260, 520, 0.18, "triangle", 0.04, 0.02);
  }

  hit(big) {
    this.noise(big ? 0.9 : 0.45, big ? 1600 : 2200, 90, 1.3, big ? 0.38 : 0.22);
    this.tone(big ? 120 : 180, 30, big ? 1.0 : 0.4, "sine", big ? 0.35 : 0.2);
    if (big) this.tone(60, 25, 1.4, "triangle", 0.22, 0.05);
  }

  sun() {
    this.noise(0.6, 5200, 1400, 0.8, 0.09);
    this.tone(500, 180, 0.4, "sine", 0.04);
  }

  hole() {
    this.tone(520, 40, 0.9, "sine", 0.12);
    this.noise(0.8, 400, 60, 2, 0.08);
  }

  moon() {
    this.noise(0.25, 700, 150, 1.4, 0.1);
    this.tone(140, 70, 0.2, "sine", 0.08);
  }

  lock(on) {
    this.tone(on ? 660 : 520, on ? 990 : 380, 0.12, "triangle", 0.1);
  }

  tick() {
    this.tone(1100, 1100, 0.05, "square", 0.035);
  }

  turn() {
    this.tone(392, 392, 0.14, "triangle", 0.07);
    this.tone(587.33, 587.33, 0.2, "triangle", 0.07, 0.12);
  }

  win() {
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, f, 0.4, "triangle", 0.1, i * 0.1));
  }

  lose() {
    [392, 349.23, 311.13, 261.63].forEach((f, i) => this.tone(f, f * 0.98, 0.35, "triangle", 0.08, i * 0.16));
  }
}
