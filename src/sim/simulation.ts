import { computePipeline, createBuffer, Readback, STORAGE, UNIFORM } from '../gpu/utils';
import { GRAVITY, MAX_SUBSTEPS, SEA_DEPTH, settings, tideLevel, WORLD_SIZE } from './params';
import { buildBeach } from './terrainInit';

import wavesWgsl from '../shaders/waves.wgsl?raw';
import commonWgsl from './shaders/sim_common.wgsl?raw';
import fluxWgsl from './shaders/flux.wgsl?raw';
import waterUpdateWgsl from './shaders/water_update.wgsl?raw';
import advectWgsl from './shaders/advect.wgsl?raw';
import erosionWgsl from './shaders/erosion.wgsl?raw';
import slumpOutWgsl from './shaders/slump_out.wgsl?raw';
import slumpApplyWgsl from './shaders/slump_apply.wgsl?raw';
import reduceWgsl from './shaders/reduce.wgsl?raw';

const PARAM_BYTES = 144;
const PARAM_STRIDE = 256;
const deg = (a: number) => Math.tan((a * Math.PI) / 180);
/** Water depth (m) the fixed time step is sized for (CFL). */
const CFL_DEPTH = 1.15;
/** Half-width of the tsunami hump (m), as TSUNAMI_WIDTH in waves.wgsl. */
const TSUNAMI_WIDTH = 8;
/** The crest starts this many widths beyond the open edge, so the sea rises smoothly. */
const TSUNAMI_LEAD = 2.5;
/** Time constants of the water table, as fractions of the tide period: it rises with the flood
 *  almost at once (the swash soaks in) but drains out of the beach well behind the ebb. */
const TABLE_RISE = 0.02;
const TABLE_FALL = 0.12;
/** Evaporation of standing water at full drying (m/s), sped up like the drying of the sand. */
const SURFACE_EVAP = 1e-4;

/**
 * GPU beach simulation on an n×n grid.
 *   ground[k] = (bedrock, sand thickness, moisture, compaction)
 *   water     = (depth, speed, vx, vz)
 *   flux      = pipe outflows (-x, +x, -z, +z)
 *   aux[k]    = (suspended sediment, foam, -, -)
 * Each substep ends with ground and aux back in slot 0.
 */
export class Simulation {
  readonly n: number;
  readonly dx: number;
  readonly size = WORLD_SIZE;
  readonly ground: GPUBuffer[];
  readonly water: GPUBuffer;
  readonly flux: GPUBuffer;
  readonly aux: GPUBuffer[];
  private slump: GPUBuffer[];
  private partial: GPUBuffer;
  private params: GPUBuffer;
  private paramData = new ArrayBuffer(PARAM_BYTES);
  private pipelines: Record<string, GPUComputePipeline>;
  private groups: GPUBindGroup[][] = [];
  private frameGroups: GPUBindGroup[];
  private reduceGroup: GPUBindGroup;
  private volumeReadback: Readback;
  readonly partialCount: number;

  simTime = 0;
  /** Position in the tide cycle (cycles), so the cycle length can change without a jump. */
  tidePhase = 0;
  seaLevel = 0;
  /** Height of the water table under the beach: lags the sea level on the ebb. */
  waterTable = 0;
  frame = 0;
  dtMax: number;
  sandVolume = 0;
  /** Simulated seconds per real second actually achieved (smoothed), below `timeScale` when capped. */
  speed = 1;
  private lastVolumeFrame = -1000;
  /** Simulated time owed to the water solver (fixed steps of dtMax). */
  private stepDebt = 0;
  /** Running tsunami: start time (sim time), crest height and celerity; null when none. */
  private tsunami: { start: number; amp: number; speed: number } | null = null;

  constructor(private device: GPUDevice, n: number) {
    this.n = n;
    this.dx = WORLD_SIZE / n;
    const cells = n * n;
    const vecBytes = cells * 16;
    this.ground = [0, 1].map((k) => createBuffer(device, vecBytes, STORAGE, `ground${k}`));
    this.water = createBuffer(device, vecBytes, STORAGE, 'water');
    this.flux = createBuffer(device, vecBytes, STORAGE, 'flux');
    this.aux = [0, 1].map((k) => createBuffer(device, vecBytes, STORAGE, `aux${k}`));
    this.slump = [0, 1].map((k) => createBuffer(device, vecBytes, STORAGE, `slump${k}`));
    this.partialCount = Math.ceil(cells / 4096);
    this.partial = createBuffer(device, this.partialCount * 4, STORAGE, 'partial');
    this.params = createBuffer(device, PARAM_STRIDE * (MAX_SUBSTEPS + 1), UNIFORM, 'simParams');
    this.volumeReadback = new Readback(device, this.partialCount * 4, 2, 'volume');

    // Time step bounded by the CFL condition of the deepest water (≈ 1.2 m with high tide + waves);
    // the flux pass caps the pipe conductance at that depth for anything dug deeper.
    this.dtMax = (0.45 * this.dx) / Math.sqrt(GRAVITY * CFL_DEPTH);

    const mk = (code: string, label: string) => computePipeline(device, commonWgsl + wavesWgsl + code, label);
    this.pipelines = {
      flux: mk(fluxWgsl, 'flux'),
      water: mk(waterUpdateWgsl, 'waterUpdate'),
      advect: mk(advectWgsl, 'advect'),
      erosion: mk(erosionWgsl, 'erosion'),
      slumpOut: mk(slumpOutWgsl, 'slumpOut'),
      slumpApply: mk(slumpApplyWgsl, 'slumpApply'),
      reduce: mk(reduceWgsl, 'reduce'),
    };

    const p = this.pipelines;
    const [g0, g1] = this.ground;
    const [a0, a1] = this.aux;
    const [s0, s1] = this.slump;
    const bg = (pl: GPUComputePipeline, slot: number, e: Record<number, GPUBuffer>) =>
      device.createBindGroup({
        layout: pl.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.params, offset: slot * PARAM_STRIDE, size: PARAM_BYTES } },
          ...Object.entries(e).map(([b, buf]) => ({ binding: Number(b), resource: { buffer: buf } })),
        ],
      });
    // Hydrodynamics run every substep; aux (sediment, foam) ping-pongs between a0 and a1.
    for (let s = 0; s < MAX_SUBSTEPS; s++) {
      this.groups.push([
        bg(p.flux, s, { 1: g0, 2: this.water, 3: this.flux }),
        bg(p.advect, s, { 1: this.water, 2: a0, 3: a1, 4: this.flux }),
        bg(p.advect, s, { 1: this.water, 2: a1, 3: a0, 4: this.flux }),
        bg(p.water, s, { 1: g0, 2: this.flux, 3: this.water }),
      ]);
    }
    // Sand processes run once per frame with the frame time step.
    const F = MAX_SUBSTEPS;
    this.frameGroups = [
      bg(p.erosion, F, { 1: g0, 2: g1, 3: this.water, 4: a0 }),
      bg(p.slumpOut, F, { 1: g1, 2: s0, 3: s1 }),
      bg(p.slumpApply, F, { 1: g1, 2: s0, 3: s1, 4: g0, 5: this.water }),
    ];
    this.reduceGroup = device.createBindGroup({
      layout: p.reduce.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params, offset: 0, size: PARAM_BYTES } },
        { binding: 1, resource: { buffer: g0 } },
        { binding: 2, resource: { buffer: a0 } },
        { binding: 3, resource: { buffer: this.partial } },
      ],
    });
    this.reset();
  }

  reset(): void {
    this.simTime = 0;
    this.tidePhase = 0;
    this.tsunami = null;
    this.seaLevel = tideLevel(0);
    this.waterTable = this.seaLevel;
    const { ground, water } = buildBeach(this.n, this.seaLevel);
    const q = this.device.queue;
    q.writeBuffer(this.ground[0], 0, ground);
    q.writeBuffer(this.ground[1], 0, ground);
    q.writeBuffer(this.water, 0, water);
    const zeros = new Float32Array(this.n * this.n * 4);
    q.writeBuffer(this.flux, 0, zeros);
    q.writeBuffer(this.aux[0], 0, zeros);
    q.writeBuffer(this.aux[1], 0, zeros);
  }

  /** Sends a tsunami from the open sea; it reaches the diorama after a few seconds. */
  triggerTsunami(amp: number): void {
    if (this.tsunami) return;
    // Solitary wave celerity √(g(h + a)).
    this.tsunami = { start: this.simTime, amp, speed: Math.sqrt(GRAVITY * (this.boundaryDepth() + amp)) };
  }

  /** Progress of the running tsunami: 0 = just sent, 1 = crest past the open edge; null when none. */
  get tsunamiProgress(): number | null {
    if (!this.tsunami) return null;
    const travel = this.tsunami.speed * (this.simTime - this.tsunami.start);
    return Math.min(travel / (2 * TSUNAMI_LEAD * TSUNAMI_WIDTH), 1);
  }

  /** Crest position (z) of the running tsunami. */
  private tsunamiFront(): number {
    const t = this.tsunami!;
    return WORLD_SIZE + TSUNAMI_LEAD * TSUNAMI_WIDTH - t.speed * (this.simTime - t.start);
  }

  /** Depth of the sea at the open boundary (for the wave dispersion relation). */
  boundaryDepth(): number {
    return Math.max(this.seaLevel + SEA_DEPTH, 0.3);
  }

  private writeParams(slot: number, dt: number): void {
    const s = settings;
    const u = new Uint32Array(this.paramData);
    const f = new Float32Array(this.paramData);
    u[0] = this.n;
    u[1] = this.frame;
    if (this.tsunami && this.tsunamiFront() < WORLD_SIZE - 0.8 - TSUNAMI_LEAD * TSUNAMI_WIDTH) this.tsunami = null;
    f[2] = this.tsunami ? this.tsunamiFront() : 0;
    f[3] = this.tsunami ? this.tsunami.amp : 0;
    f[4] = this.dx;
    f[5] = dt;
    f[6] = this.simTime;
    f[7] = this.seaLevel;
    f[8] = GRAVITY;
    f[9] = s.waveAmp;
    f[10] = s.wavePeriod;
    f[11] = this.boundaryDepth();
    f[12] = Math.round(0.8 / this.dx); // wave-maker / sponge width: 0.8 m
    f[13] = 0.0025; // bottom friction (m/s)
    f[14] = 0.04; // viscosity (1/s)
    f[15] = 3.0 * s.erosion; // erosion rate
    f[16] = 1.5; // deposition rate
    f[17] = 0.014 * s.erosion; // transport capacity
    f[18] = 0.45; // critical velocity (m/s)
    f[19] = s.evaporation;
    f[20] = 0.0003; // capillary diffusion (m²/s)
    f[21] = s.slumpRate;
    f[22] = deg(s.dryAngle);
    f[23] = deg(s.wetAngle);
    f[24] = deg(s.compactAngle);
    f[25] = deg(s.satAngle);
    f[26] = 0.08; // seepage rate (1/s)
    f[27] = 0.02; // infiltration (m/s)
    f[28] = 0.35; // foam decay (1/s)
    f[29] = this.simTime;
    f[30] = s.cohesion;
    f[31] = CFL_DEPTH;
    f[32] = this.waterTable;
    f[33] = 1 / (TABLE_FALL * settings.tidePeriodMin * 60); // drainage of perched water (1/s)
    f[34] = SURFACE_EVAP * s.evaporation;
    this.device.queue.writeBuffer(this.params, slot * PARAM_STRIDE, this.paramData);
  }

  /** Records the fixed-size water steps due for `frameDt` seconds + one sand step (slower than real time if capped). */
  encode(encoder: GPUCommandEncoder, frameDt: number): void {
    // Fixed time step: the pipe model sits close to its CFL limit, and a step size that changes
    // from frame to frame (frame-pacing jitter) excites grid-scale waves until the surface blows up.
    // Time acceleration runs more water steps per frame (the budget grows with it).
    const scale = Math.max(settings.timeScale, 0);
    const maxSteps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.round(settings.substeps * Math.max(scale, 1))));
    const dt = this.dtMax;
    this.stepDebt += frameDt * scale;
    const steps = Math.min(maxSteps, Math.floor(this.stepDebt / dt));
    // Time beyond the substep budget is dropped (slow motion) rather than piling up.
    this.stepDebt = Math.min(this.stepDebt - steps * dt, dt);
    if (frameDt > 0) this.speed += ((steps * dt) / frameDt - this.speed) * Math.min(frameDt * 2, 1);
    if (steps === 0) return;
    const wg = Math.ceil(this.n / 16);
    const p = this.pipelines;
    const pass = encoder.beginComputePass({ label: 'simulation' });
    const run = (pl: GPUComputePipeline, g: GPUBindGroup) => {
      pass.setPipeline(pl);
      pass.setBindGroup(0, g);
      pass.dispatchWorkgroups(wg, wg);
    };
    for (let s = 0; s < steps; s++) {
      this.simTime += dt;
      if (!settings.tidePaused) this.tidePhase += (dt * settings.tideSpeed) / (settings.tidePeriodMin * 60);
      this.seaLevel = tideLevel(this.tidePhase);
      const lag = (this.seaLevel > this.waterTable ? TABLE_RISE : TABLE_FALL) * settings.tidePeriodMin * 60;
      this.waterTable += (this.seaLevel - this.waterTable) * Math.min(dt / lag, 1);
      this.writeParams(s, dt);
      const g = this.groups[s];
      run(p.flux, g[0]);
      run(p.advect, g[1 + (s & 1)]);
      run(p.water, g[3]);
    }
    this.writeParams(MAX_SUBSTEPS, dt * steps);
    const [erosion, slumpOut, slumpApply] = this.frameGroups;
    pass.end();
    // Odd substep count leaves aux in a1: bring it back to a0.
    if (steps & 1) encoder.copyBufferToBuffer(this.aux[1], 0, this.aux[0], 0, this.aux[0].size);
    const pass2 = encoder.beginComputePass({ label: 'sand' });
    for (const [pl, g] of [[p.erosion, erosion], [p.slumpOut, slumpOut], [p.slumpApply, slumpApply]] as const) {
      pass2.setPipeline(pl);
      pass2.setBindGroup(0, g);
      pass2.dispatchWorkgroups(wg, wg);
    }
    pass2.end();
    this.frame++;
  }

  /** Periodically sums the sand volume on the GPU and reads it back asynchronously. */
  encodeVolume(encoder: GPUCommandEncoder): (() => void) | null {
    if (this.frame - this.lastVolumeFrame < 30) return null;
    this.lastVolumeFrame = this.frame;
    const pass = encoder.beginComputePass({ label: 'reduce' });
    pass.setPipeline(this.pipelines.reduce);
    pass.setBindGroup(0, this.reduceGroup);
    pass.dispatchWorkgroups(this.partialCount);
    pass.end();
    const done = this.volumeReadback.copy(encoder, this.partial);
    return done;
  }

  updateVolume(): void {
    const r = this.volumeReadback.latest;
    if (!r) return;
    let s = 0;
    for (let i = 0; i < r.length; i++) s += r[i];
    this.sandVolume = s * this.dx * this.dx;
  }
}
