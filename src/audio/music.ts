/**
 * Procedural chill background music (WebAudio, no assets): a 16th-note step sequencer driving a few
 * small synths (FM electric piano, pads, plucks, bass, soft drums). Each track is a chord loop plus a
 * pattern function with a bit of randomness, so the melodies never repeat exactly.
 */

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
const chance = (p: number) => Math.random() < p;
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

/** Bass root and upper voicing, as MIDI notes. */
interface Chord {
  root: number;
  notes: number[];
}
const ch = (root: number, ...notes: number[]): Chord => ({ root, notes });

interface Step {
  /** 16th index in the bar (0-15). */
  s: number;
  bar: number;
  /** Start time (AudioContext clock, swing included). */
  t: number;
  /** Length of a 16th (s). */
  d: number;
  chord: Chord;
}

interface Track {
  name: string;
  bpm: number;
  /** Delay of the off 16ths, as a fraction of a 16th. */
  swing: number;
  barsPerChord: number;
  chords: Chord[];
  /** Vinyl crackle level. */
  crackle: number;
  /** Tape wobble depth (cents). */
  wow: number;
  /** Master low-pass (Hz): lower is warmer, more "lo-fi". */
  tone: number;
  /** Echo time, in 16ths. */
  echo: number;
  play(x: Synth, p: Step): void;
}

/** Per-track output, faded out as a whole when the track changes. */
interface Bus {
  dry: GainNode;
  rev: GainNode;
  dly: GainNode;
}

class Synth {
  bus!: Bus;

  constructor(
    private ctx: AudioContext,
    private noise: AudioBuffer,
    private wow: GainNode,
  ) {}

  private gain(v: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  private osc(type: OscillatorType, freq: number, t: number, stop: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    this.wow.connect(o.detune);
    o.onended = () => this.wow.disconnect(o.detune);
    o.start(t);
    o.stop(stop);
    return o;
  }

  private noiseSrc(t: number, dur: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur);
    return s;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /** Percussive envelope: fast attack, exponential decay. */
  private perc(t: number, peak: number, decay: number): GainNode {
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(1e-4, t + decay);
    return g;
  }

  private out(node: AudioNode, rev: number, dly = 0, pan = 0): void {
    let n = node;
    if (pan) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      n = node.connect(p);
    }
    n.connect(this.bus.dry);
    if (rev > 0) n.connect(this.gain(rev)).connect(this.bus.rev);
    if (dly > 0) n.connect(this.gain(dly)).connect(this.bus.dly);
  }

  /** FM electric piano (Rhodes-ish), notes strummed slightly. */
  epiano(notes: number[], t: number, dur: number, v: number, echo = 0, strum = 0.012): void {
    notes.forEach((m, i) => {
      const tt = t + i * strum;
      const f = mtof(m);
      const end = tt + dur + 1;
      const car = this.osc('sine', f, tt, end);
      const mod = this.osc('sine', f, tt, end);
      const idx = this.gain(0);
      idx.gain.setValueAtTime(f * 1.6, tt);
      idx.gain.exponentialRampToValueAtTime(f * 0.12, tt + 0.6);
      mod.connect(idx).connect(car.frequency);
      const g = this.gain(0);
      const peak = v * 0.12;
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(peak, tt + 0.006);
      g.gain.setTargetAtTime(peak * 0.3, tt + 0.006, 0.6);
      g.gain.setTargetAtTime(0, tt + dur, 0.15);
      car.connect(g);
      this.out(g, 0.25, echo, notes.length > 1 ? (i / (notes.length - 1) - 0.5) * 0.5 : 0);
    });
  }

  /** Slow detuned-saw pad. */
  pad(notes: number[], t: number, dur: number, v: number): void {
    const f = this.filter('lowpass', 500);
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(1300, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(700, t + dur);
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v * 0.05, t + 1.8);
    g.gain.setTargetAtTime(0, t + dur, 0.9);
    for (const m of notes) {
      for (const det of [-9, 8]) {
        const o = this.osc('sawtooth', mtof(m), t, t + dur + 5);
        o.detune.value = det;
        o.connect(f);
      }
    }
    f.connect(g);
    this.out(g, 0.6);
  }

  /** Soft plucked string. */
  pluck(m: number, t: number, v: number, bright = 2400, echo = 0): void {
    const f = this.filter('lowpass', bright, 1);
    f.frequency.setValueAtTime(bright, t);
    f.frequency.exponentialRampToValueAtTime(350, t + 0.45);
    this.osc('triangle', mtof(m), t, t + 1.3).connect(f);
    const sq = this.osc('square', mtof(m), t, t + 1.3);
    sq.connect(this.gain(0.12)).connect(f);
    const g = this.perc(t, v * 0.25, 1.2);
    f.connect(g);
    this.out(g, 0.3, echo, (Math.random() - 0.5) * 0.6);
  }

  /** Nylon-guitar chord: a quick strum of plucks. */
  guitar(notes: number[], t: number, v: number): void {
    notes.forEach((m, i) => this.pluck(m, t + i * 0.016, v * 0.6, 2200));
  }

  bass(m: number, t: number, dur: number, v: number): void {
    const f = this.filter('lowpass', 650);
    const end = t + dur + 0.5;
    this.osc('sine', mtof(m), t, end).connect(f);
    this.osc('triangle', mtof(m), t, end).connect(this.gain(0.3)).connect(f);
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v * 0.45, t + 0.012);
    g.gain.setTargetAtTime(v * 0.3, t + 0.012, 0.3);
    g.gain.setTargetAtTime(0, t + dur, 0.06);
    f.connect(g);
    this.out(g, 0.03);
  }

  /** FM bell. */
  bell(m: number, t: number, v: number, echo = 0.35): void {
    const f = mtof(m);
    const car = this.osc('sine', f, t, t + 2.6);
    const mod = this.osc('sine', f * 3.5, t, t + 2.6);
    const idx = this.gain(0);
    idx.gain.setValueAtTime(f * 1.5, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.05, t + 1.2);
    mod.connect(idx).connect(car.frequency);
    const g = this.perc(t, v * 0.1, 2.5);
    car.connect(g);
    this.out(g, 0.5, echo, (Math.random() - 0.5) * 0.8);
  }

  kick(t: number, v: number): void {
    const o = this.osc('sine', 110, t, t + 0.45);
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.perc(t, v * 0.7, 0.4);
    o.connect(g);
    this.out(g, 0);
  }

  snare(t: number, v: number): void {
    const n = this.noiseSrc(t, 0.25);
    const g = this.perc(t, v * 0.32, 0.2);
    n.connect(this.filter('bandpass', 1700, 0.6)).connect(g);
    this.out(g, 0.2);
    const b = this.perc(t, v * 0.2, 0.08);
    this.osc('triangle', 185, t, t + 0.1).connect(b);
    this.out(b, 0.1);
  }

  rim(t: number, v: number, echo = 0): void {
    const g = this.perc(t, v * 0.22, 0.04);
    this.osc('triangle', 1650, t, t + 0.05).connect(g);
    this.noiseSrc(t, 0.04).connect(this.filter('bandpass', 3000, 3)).connect(g);
    this.out(g, 0.15, echo, 0.15);
  }

  hat(t: number, v: number): void {
    const g = this.perc(t, v * 0.18, 0.045);
    this.noiseSrc(t, 0.06).connect(this.filter('highpass', 7500)).connect(g);
    this.out(g, 0.05, 0, 0.25);
  }

  shaker(t: number, v: number): void {
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v * 0.15, t + 0.012);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.08);
    this.noiseSrc(t, 0.1).connect(this.filter('bandpass', 6000, 0.8)).connect(g);
    this.out(g, 0.1, 0, -0.2);
  }
}

const PENTA_C = [72, 74, 76, 79, 81, 84];
const PENTA_D = [74, 76, 78, 81, 83, 86];
const PENTA_AM = [69, 72, 74, 76, 79, 81];
const PENTA_DM = [74, 77, 79, 81, 84, 86];

export const TRACKS: Track[] = [
  {
    name: 'Lo-fi au soleil',
    bpm: 76,
    swing: 0.3,
    barsPerChord: 1,
    // Fmaj9 – Em7 – Dm9 – G13
    chords: [ch(41, 57, 60, 64, 67), ch(40, 55, 59, 62, 64), ch(38, 53, 57, 60, 64), ch(43, 53, 57, 59, 64)],
    crackle: 0.05,
    wow: 9,
    tone: 4200,
    echo: 3,
    play(x, { s, t, d, bar, chord }) {
      if (s === 0 || s === 10 || (s === 7 && chance(0.3))) x.kick(t, s === 0 ? 0.9 : 0.6);
      if (s === 4 || s === 12) x.snare(t, 0.5);
      if (s % 2 === 0) x.hat(t, s % 4 === 0 ? 0.22 : 0.14);
      else if (chance(0.15)) x.hat(t, 0.07);
      if (s === 0) x.epiano(chord.notes, t, d * 9, 0.55);
      if (s === 10 && chance(0.6)) x.epiano(chord.notes, t, d * 5, 0.35);
      if (s === 0) x.bass(chord.root, t, d * 6, 0.7);
      if (s === 10) x.bass(chord.root, t, d * 3, 0.5);
      if (s === 14 && chance(0.4)) x.bass(chord.root + 7, t, d * 1.5, 0.4);
      if (bar % 4 >= 2 && s % 2 === 0 && chance(0.22)) x.epiano([pick(PENTA_C)], t, d * 3, 0.45, 0.25);
    },
  },
  {
    name: 'Coucher de soleil',
    bpm: 64,
    swing: 0,
    barsPerChord: 2,
    // Dmaj9 – Bm11 – Gmaj9 – A6sus
    chords: [ch(38, 54, 57, 61, 64), ch(35, 54, 57, 62, 64), ch(43, 54, 57, 59, 62), ch(45, 52, 57, 59, 64)],
    crackle: 0,
    wow: 3,
    tone: 7000,
    echo: 3,
    play(x, { s, t, d, bar, chord }) {
      if (s === 0 && bar % 2 === 0) {
        x.pad(chord.notes, t, d * 32, 0.6);
        x.bass(chord.root, t, d * 30, 0.4);
      }
      const n = chord.notes.length;
      if (s % 2 === 0 && chance(0.55)) x.pluck(chord.notes[(s / 2 + bar * 3) % n] + 12, t, 0.28, 1800, 0.3);
      if (s % 4 === 0 && chance(0.12)) x.bell(pick(PENTA_D), t, 0.5);
    },
  },
  {
    name: 'Bossa des dunes',
    bpm: 132,
    swing: 0.08,
    barsPerChord: 1,
    // Am7 – D9 – Gmaj7 – Cmaj7 – Fmaj7 – Bm7b5 – E7 – Am7
    chords: [
      ch(45, 55, 60, 64, 67), ch(38, 54, 57, 60, 64), ch(43, 55, 59, 62, 66), ch(48, 52, 55, 59, 60),
      ch(41, 53, 57, 60, 64), ch(47, 53, 57, 59, 62), ch(40, 52, 56, 59, 62), ch(45, 55, 60, 64, 67),
    ],
    crackle: 0.02,
    wow: 4,
    tone: 6000,
    echo: 3,
    play(x, { s, t, d, bar, chord }) {
      const comp = bar % 2 === 0 ? [0, 3, 6, 10, 12] : [2, 6, 8, 11, 14];
      if (comp.includes(s)) x.guitar(chord.notes, t, s === 0 ? 0.5 : 0.4);
      if (s === 0) x.bass(chord.root, t, d * 5, 0.7);
      if (s === 6) x.bass(chord.root, t, d * 1.5, 0.5);
      if (s === 8) x.bass(chord.root + 7, t, d * 5, 0.6);
      if (s === 14) x.bass(chord.root + 7, t, d * 1.5, 0.45);
      if (s === 0 || s === 8) x.kick(t, 0.4);
      x.shaker(t, s % 4 === 0 ? 0.5 : s % 2 === 0 ? 0.35 : 0.22);
      if ((bar % 2 === 0 ? [0, 6, 12] : [4, 10]).includes(s)) x.rim(t, 0.45);
      if (bar % 4 >= 2 && s % 2 === 0 && chance(0.18)) x.epiano([pick(PENTA_AM)], t, d * 4, 0.4, 0.2);
    },
  },
  {
    name: 'Marée basse (dub)',
    bpm: 70,
    swing: 0.18,
    barsPerChord: 2,
    // Dm9 – Gm9 – Bbmaj9 – A7sus
    chords: [ch(38, 53, 57, 60, 64), ch(43, 53, 57, 58, 62), ch(46, 53, 57, 60, 62), ch(45, 52, 55, 57, 62)],
    crackle: 0.04,
    wow: 6,
    tone: 3800,
    echo: 3,
    play(x, { s, t, d, chord }) {
      // One drop: kick and rim together on the third beat.
      if (s === 8) {
        x.kick(t, 0.9);
        x.rim(t, 0.6, 0.5);
      }
      if (s % 4 === 2) x.hat(t, 0.16);
      if (s === 4 || s === 12) x.epiano(chord.notes, t, d * 1.2, 0.4, 0.45, 0.004);
      const line: Record<number, number> = { 0: 0, 3: 0, 6: 7, 10: 12, 13: 7 };
      if (s in line) x.bass(chord.root + line[s], t, d * (s === 0 ? 2.5 : 1.6), 0.75);
      if (s % 4 === 0 && chance(0.08)) x.bell(pick(PENTA_DM), t, 0.45, 0.5);
    },
  },
];

/** Decaying stereo noise: a cheap plate-like reverb impulse. */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  return buf;
}

export class Music {
  readonly state = { on: true, volume: 0.45, track: TRACKS[0].name };
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private tone!: BiquadFilterNode;
  private reverb!: ConvolverNode;
  private delayIn!: GainNode;
  private delay!: DelayNode;
  private crackle!: GainNode;
  private wow!: GainNode;
  private synth!: Synth;
  private bus: Bus | null = null;
  private trackIdx = 0;
  private step = 0;
  private nextTime = 0;

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
    this.master.gain.value = 0;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.master.connect(this.tone).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx, 3.2);
    this.reverb.connect(this.master);

    this.delayIn = ctx.createGain();
    this.delay = ctx.createDelay(2);
    const fbFilter = ctx.createBiquadFilter();
    fbFilter.type = 'lowpass';
    fbFilter.frequency.value = 2200;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    this.delayIn.connect(this.delay).connect(this.master);
    this.delay.connect(fbFilter).connect(fb).connect(this.delay);

    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // Vinyl crackle: sparse clicks over a faint hiss.
    const vinyl = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const vd = vinyl.getChannelData(0);
    for (let i = 0; i < vd.length; i++) vd[i] = (Math.random() * 2 - 1) * (Math.random() < 0.0004 ? 0.9 : 0.04);
    const vsrc = ctx.createBufferSource();
    vsrc.buffer = vinyl;
    vsrc.loop = true;
    const vhp = ctx.createBiquadFilter();
    vhp.type = 'highpass';
    vhp.frequency.value = 1200;
    this.crackle = ctx.createGain();
    this.crackle.gain.value = 0;
    vsrc.connect(vhp).connect(this.crackle).connect(this.master);
    vsrc.start();

    // Tape wobble, shared by every oscillator.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    this.wow = ctx.createGain();
    this.wow.gain.value = 0;
    lfo.connect(this.wow);
    lfo.start();

    this.synth = new Synth(ctx, noise, this.wow);
    this.select(this.trackIdx);
    this.apply();
    setInterval(() => this.tick(), 25);
  }

  select(index: number): void {
    this.trackIdx = index;
    const tr = TRACKS[index];
    this.state.track = tr.name;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const old = this.bus;
    if (old) {
      for (const g of [old.dry, old.rev, old.dly]) g.gain.setTargetAtTime(0, t, 0.4);
      setTimeout(() => [old.dry, old.rev, old.dly].forEach((g) => g.disconnect()), 4000);
    }
    const mk = (dest: AudioNode) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.3);
      g.connect(dest);
      return g;
    };
    this.bus = this.synth.bus = { dry: mk(this.master), rev: mk(this.reverb), dly: mk(this.delayIn) };
    this.delay.delayTime.setTargetAtTime((tr.echo * 60) / tr.bpm / 4, t, 0.1);
    this.tone.frequency.setTargetAtTime(tr.tone, t, 0.5);
    this.crackle.gain.setTargetAtTime(tr.crackle, t, 0.5);
    this.wow.gain.setTargetAtTime(tr.wow, t, 0.5);
    this.step = 0;
    this.nextTime = t + 0.1;
  }

  next(): void {
    this.select((this.trackIdx + 1) % TRACKS.length);
  }

  toggle(): void {
    this.state.on = !this.state.on;
    this.apply();
  }

  /** Applies `state.on` / `state.volume`. */
  apply(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.state.on) void ctx.resume();
    this.master.gain.setTargetAtTime(this.state.on ? this.state.volume : 0, ctx.currentTime, 0.15);
    if (!this.state.on) setTimeout(() => !this.state.on && void ctx.suspend(), 600);
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.state.on || ctx.state !== 'running') return;
    // Timers are throttled in background tabs: schedule further ahead there.
    const ahead = document.hidden ? 1.5 : 0.2;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    const tr = TRACKS[this.trackIdx];
    const d = 60 / tr.bpm / 4;
    while (this.nextTime < ctx.currentTime + ahead) {
      const s = this.step % 16;
      const bar = Math.floor(this.step / 16);
      const chord = tr.chords[Math.floor(bar / tr.barsPerChord) % tr.chords.length];
      tr.play(this.synth, { s, bar, t: this.nextTime + (s % 2 ? tr.swing * d : 0), d, chord });
      this.nextTime += d;
      this.step++;
    }
  }
}
