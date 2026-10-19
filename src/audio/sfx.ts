import { molds, toolSpec } from '../sim/params';
import { isMold, Mode, Tools } from '../tools/tools';

type Flow = 'none' | 'fill' | 'pour';

/**
 * Procedural sound effects (WebAudio, no assets): a continuous filtered-noise "scrape" whose level
 * and colour follow the active tool, a water voice (turbulent stream + bubbles) for filling and
 * pouring the bucket, plus one-shots for discrete events (flip, dump, decor, full).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private scrapeGain!: GainNode;
  private scrapeFilter!: BiquadFilterNode;
  private smooth!: AudioBuffer;
  private waterGain!: GainNode;
  private waterLP!: BiquadFilterNode;
  private waterPeak!: BiquadFilterNode;
  private lastT = 0;
  private prevFlow: Flow = 'none';
  private prevMode = Mode.None;
  private prevShovel = 0;
  private prevBucket = 0;
  private flipQueued = false;

  constructor() {
    // Browsers only allow audio after a user gesture.
    const start = () => this.start();
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
  }

  private start(): void {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    // Grainy noise: white noise with random crackles, closer to sand than plain hiss.
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.03 ? 1 : 0.35);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.scrapeFilter = ctx.createBiquadFilter();
    this.scrapeFilter.type = 'bandpass';
    this.scrapeFilter.Q.value = 0.9;
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    src.connect(this.scrapeFilter).connect(this.scrapeGain).connect(this.master);
    src.start();

    // Water stream: smooth noise (no crackles), low-passed, with a resonant peak standing in for
    // the bucket's air cavity.
    this.smooth = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.smooth.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
    const wsrc = ctx.createBufferSource();
    wsrc.buffer = this.smooth;
    wsrc.loop = true;
    this.waterLP = ctx.createBiquadFilter();
    this.waterLP.type = 'lowpass';
    this.waterLP.Q.value = 0.5;
    this.waterPeak = ctx.createBiquadFilter();
    this.waterPeak.type = 'peaking';
    this.waterPeak.Q.value = 4;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    wsrc.connect(this.waterLP).connect(this.waterPeak).connect(this.waterGain).connect(this.master);
    wsrc.start();
    this.lastT = ctx.currentTime;
  }

  update(tools: Tools): void {
    const ctx = this.ctx;
    const mode = tools.mode;
    const inv = tools.inventory;
    for (const e of tools.events) {
      if (e === 'flip') this.flipQueued = true;
      else if (e === 'decorAdd') this.pop(520, 880);
      else if (e === 'decorRemove') this.pop(700, 380);
    }
    if (this.flipQueued && tools.flipAge > 0.28) {
      this.flipQueued = false;
      this.thump();
      this.burst(0.25, 500, 0.35, 0.45);
    }
    if (!ctx) {
      this.prevMode = mode;
      return;
    }

    // Continuous scrape.
    let level = 0;
    let freq = 1000;
    // Same rule as the tool shader: a bucket holds water once it has some, or when an empty one dips in.
    const water = inv.bucketWater > 1e-6 || (inv.bucketSand <= 1e-6 && tools.hit.waterDepth > 0.025);
    switch (mode) {
      case Mode.Dig:
        level = 0.55;
        freq = 900;
        break;
      case Mode.Dump:
        level = inv.shovelSand > 1e-5 ? 0.4 : 0;
        freq = 500;
        break;
      case Mode.Pat:
        level = 0.25;
        freq = 350;
        break;
      case Mode.Fill:
        level = water ? 0 : 0.45;
        freq = 700;
        break;
      case Mode.Carve:
        level = 0.3;
        freq = 3200;
        break;
      case Mode.Smooth:
      case Mode.Flatten:
        level = 0.22;
        freq = 1500;
        break;
    }
    if (!tools.hit.valid) level = 0;
    const t = ctx.currentTime;
    // A little wobble keeps the loop from sounding static.
    const wobble = 1 + 0.25 * Math.sin(t * 23) * Math.sin(t * 7.3);
    this.scrapeGain.gain.setTargetAtTime(level * wobble, t, level > 0 ? 0.03 : 0.08);
    this.scrapeFilter.frequency.setTargetAtTime(freq * (0.9 + 0.2 * Math.random()), t, 0.05);

    const cap = molds[isMold(tools.tool) ? tools.tool : 'bucket'].cap;
    const wFrac = Math.min(inv.bucketWater / cap, 1);
    let flow: Flow = 'none';
    if (tools.hit.valid && mode === Mode.Fill && water && wFrac < 0.98) flow = 'fill';
    else if (tools.hit.valid && mode === Mode.Pour && inv.bucketWater > 1e-6) flow = 'pour';
    this.water(flow, wFrac, Math.min(tools.hit.waterDepth / 0.02, 1), Math.min(t - this.lastT, 0.1));
    this.lastT = t;

    if (mode === Mode.Dump && this.prevMode !== Mode.Dump && inv.shovelSand > 1e-5) this.burst(0.3, 600, 0.5, 0.25);
    if (mode === Mode.Dig && this.prevMode !== Mode.Dig) this.burst(0.08, 2500, 0.5, 0.06);

    // "Full" cues.
    const sFull = toolSpec.shovelCap * 0.98;
    if (this.prevShovel < sFull && inv.shovelSand >= sFull && mode === Mode.Dig) this.ding(1046);
    const b = Math.max(inv.bucketSand, inv.bucketWater);
    if (this.prevBucket < cap * 0.98 && b >= cap * 0.98) this.ding(784, 1175);
    this.prevShovel = inv.shovelSand;
    this.prevBucket = b;
    this.prevMode = mode;
  }

  /**
   * Water voice. Filling: turbulent stream plus bubbles, with a cavity resonance that climbs as the
   * bucket fills. Pouring: a granular splash (many tiny noise impacts) over a low body, wetter and
   * more bubbly when it lands in a puddle, thinning to a trickle as the bucket empties.
   */
  private water(flow: Flow, frac: number, wet: number, dt: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    let level = 0;
    let reso = 400;
    let peak = 0;
    let cutoff = 1200;
    let bubbles = 0;
    let fLo = 400;
    let fHi = 1600;
    let grains = 0;
    if (flow === 'fill') {
      // Like filling a bottle.
      reso = 240 * 4 ** frac;
      peak = 14;
      level = 0.55;
      cutoff = 1500;
      bubbles = 28;
      fLo = reso * 0.9;
      fHi = reso * 2.4;
    } else if (flow === 'pour') {
      // Body: dull, low thud of the water mass; the splash itself comes from the grains.
      const thick = Math.min(1, 0.25 + frac * 1.5);
      reso = 220;
      peak = 4;
      level = 0.35 * thick;
      cutoff = 500 + 400 * thick;
      grains = 60 + 140 * thick;
      bubbles = (4 + 22 * wet) * thick;
      fLo = 600;
      fHi = 1500;
    }
    // Random amplitude flutter reads as turbulence rather than a steady hiss.
    this.waterGain.gain.setTargetAtTime(level * (0.65 + 0.7 * Math.random()), t, level > 0 ? 0.035 : 0.12);
    this.waterLP.frequency.setTargetAtTime(cutoff, t, 0.05);
    this.waterPeak.frequency.setTargetAtTime(reso, t, 0.06);
    this.waterPeak.gain.setTargetAtTime(peak, t, 0.03);

    for (let k = this.count(bubbles * dt); k > 0; k--) {
      this.bubble(t + 0.015 + Math.random() * dt, fLo * (fHi / fLo) ** Math.random(), 0.04 + 0.08 * Math.random());
    }
    if (grains > 0) {
      // A thin trickle sounds higher and lighter; landing on dry sand is duller than in a puddle.
      const lo = 350 + 900 * (1 - frac);
      const hi = 2200 + 2500 * wet;
      for (let k = this.count(grains * dt); k > 0; k--) {
        const r = Math.random();
        this.grain(t + 0.015 + Math.random() * dt, lo * (hi / lo) ** Math.random(), 0.35 + 1.1 * r * r, 0.008 + 0.03 * Math.random());
      }
    }

    if (flow !== this.prevFlow) {
      if (flow === 'fill') {
        // Bucket plunging into the water.
        this.burst(0.3, 900, 0.5, 0, this.smooth);
        this.bubble(t + 0.02, 150, 0.35, 0.16);
        this.bubble(t + 0.07, 230, 0.2, 0.1);
      } else if (flow === 'pour') {
        // First mass of water slapping the ground.
        this.burst(0.35, 700 + 900 * wet, 0.6, 0.02, this.smooth);
      } else if (this.prevFlow !== 'none') {
        this.drips(this.prevFlow === 'pour' ? 7 : 5, this.prevFlow === 'pour' ? 0.1 : 0.09);
      }
      this.prevFlow = flow;
    }
  }

  /** Number of events this frame for an expected (fractional) count. */
  private count(n: number): number {
    return Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
  }

  /** A tiny band-passed noise click: one droplet impact of a splash. */
  private grain(at: number, f: number, amp: number, dur: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.smooth;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(amp, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(at, Math.random() * 1.9);
    src.stop(at + dur + 0.01);
  }

  /**
   * One bubble: a sine whose pitch chirps upward as it rises, with a fast decay. Smaller bubbles
   * ring higher and die out quicker (Minnaert resonance).
   */
  private bubble(at: number, f: number, amp: number, dur = 0.02 + 30 / f): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(f, at);
    o.frequency.exponentialRampToValueAtTime(f * (1.4 + 0.7 * Math.random()), at + dur);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(amp, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  /** A few drops falling off the bucket, spreading out over time. */
  private drips(n: number, amp: number): void {
    let at = this.ctx!.currentTime + 0.06;
    for (let i = 0; i < n; i++) {
      at += 0.05 + 0.15 * Math.random() * (1 + 0.5 * i);
      this.bubble(at, 1000 + 1400 * Math.random(), amp * (1 - (0.6 * i) / n), 0.045);
    }
  }

  private thump(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.32);
  }

  /** Filtered noise burst. */
  private burst(dur: number, freq: number, gain: number, delay = 0, buf = this.noise): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.8 + 0.4 * Math.random();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private pop(f0: number, f1: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + 0.09);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
    this.burst(0.08, 1500, 0.2);
  }

  private ding(...notes: number[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.08;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.27);
    });
  }
}
