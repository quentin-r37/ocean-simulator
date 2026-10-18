import { molds, toolSpec } from '../sim/params';
import { isMold, Mode, Tools } from '../tools/tools';

/**
 * Procedural sound effects (WebAudio, no assets): a continuous filtered-noise "scrape" whose level
 * and colour follow the active tool, plus one-shots for discrete events (flip, dump, decor, full).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private scrapeGain!: GainNode;
  private scrapeFilter!: BiquadFilterNode;
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
    const water = inv.bucketWater > 1e-6 || tools.hit.isWater;
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
        level = 0.45;
        freq = water ? 1800 : 700;
        break;
      case Mode.Pour:
        level = 0.35;
        freq = 2200;
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

    if (mode === Mode.Dump && this.prevMode !== Mode.Dump && inv.shovelSand > 1e-5) this.burst(0.3, 600, 0.5, 0.25);
    if (mode === Mode.Dig && this.prevMode !== Mode.Dig) this.burst(0.08, 2500, 0.5, 0.06);

    // "Full" cues.
    const sFull = toolSpec.shovelCap * 0.98;
    if (this.prevShovel < sFull && inv.shovelSand >= sFull && mode === Mode.Dig) this.ding(1046);
    const cap = molds[isMold(tools.tool) ? tools.tool : 'bucket'].cap * 0.98;
    const b = Math.max(inv.bucketSand, inv.bucketWater);
    if (this.prevBucket < cap && b >= cap) this.ding(784, 1175);
    this.prevShovel = inv.shovelSand;
    this.prevBucket = b;
    this.prevMode = mode;
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
  private burst(dur: number, freq: number, gain: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
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
