import { Builder, MeshData } from './meshBuilder';
import { compose, mat4RotateX, mat4RotateY, mat4RotateZ, mat4Scale, mat4Translate, Mat4, Vec3, v3, clamp, smoothstep } from '../math';
import { baseMolds, molds, MoldKind, MoldSpec, TOOL_SCALE, toolSpec } from '../sim/params';

const S = TOOL_SCALE;
import type { Tools } from '../tools/tools';
import { Mode } from '../tools/tools';

const RED: Vec3 = [0.62, 0.035, 0.025];
const BLUE: Vec3 = [0.03, 0.18, 0.62];
const GREEN: Vec3 = [0.05, 0.42, 0.12];
const YELLOW: Vec3 = [0.8, 0.5, 0.03];
const WHITE: Vec3 = [0.8, 0.8, 0.78];
const STEEL: Vec3 = [0.55, 0.57, 0.6];
const ORANGE: Vec3 = [0.85, 0.24, 0.02];
const WOOD: Vec3 = [0.45, 0.28, 0.14];

/**
 * Round bucket: opening (radius rBase) at the top y = height, bottom (radius rTop) at y = 0.
 * `detail` scales the wall thickness, rim and handle (for big buckets).
 */
export function buildBucket(spec: MoldSpec, col: Vec3, crenel: boolean, detail = 1): MeshData {
  const b = new Builder();
  const rt = spec.rBase;
  const rb = spec.rTop;
  const h = spec.height;
  const d = detail;
  const th = 0.005 * d;
  const slope = (rt - rb) / h;
  const wall = (inner: boolean) =>
    b.surface(48, 6, (u, v) => {
      const a = u * Math.PI * 2;
      const y = v * h;
      const r = rb + (rt - rb) * v - (inner ? th : 0);
      const n = v3.norm([Math.cos(a), -slope, Math.sin(a)]);
      return { p: [Math.cos(a) * r, y + (inner ? th : 0) * (1 - v), Math.sin(a) * r], n: inner ? v3.scale(n, -1) : n };
    }, col);
  wall(false);
  wall(true);
  for (const [y, ny] of [[0, -1], [th, 1]] as const) {
    const c = b.vert([0, y, 0], [0, ny, 0], col);
    const ring: number[] = [];
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      ring.push(b.vert([Math.cos(a) * (rb - (ny > 0 ? th : 0)), y, Math.sin(a) * (rb - (ny > 0 ? th : 0))], [0, ny, 0], col));
    }
    for (let k = 0; k < 48; k++) b.tri(c, ring[k], ring[k + 1]);
  }
  if (crenel) {
    // Crenel notches moulded in the bottom (they become the merlons of the tower).
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 12;
      const r = rb - 0.04;
      const blk = new Builder();
      blk.box([0, 0, 0], [0.09, 0.08, 0.06], col.map((x) => x * 0.8) as Vec3);
      b.append(blk.build(), compose(mat4Translate([Math.cos(a) * r, -0.02, Math.sin(a) * r]), mat4RotateY(-a)));
    }
  }
  const rim: Vec3[] = [];
  for (let k = 0; k <= 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    rim.push([Math.cos(a) * (rt - th * 0.5), h, Math.sin(a) * (rt - th * 0.5)]);
  }
  b.tube(rim, 0.007 * d, col, 10, false);
  const arc: Vec3[] = [];
  for (let k = 0; k <= 32; k++) {
    const a = (k / 32) * Math.PI;
    arc.push([Math.cos(a) * (rt + 0.012 * d), h - 0.03 * d + Math.sin(a) * rt * 1.2, 0]);
  }
  b.tube(arc, 0.0045 * d, WHITE, 8);
  for (const s of [-1, 1]) b.tube([[s * (rt - 0.002 * d), h - 0.03 * d, 0], [s * (rt + 0.016 * d), h - 0.03 * d, 0]], 0.012 * d, col, 12);
  return b.build();
}

/** Rectangular wall mould (opening at the top), long axis along x. */
export function buildWallMold(spec: MoldSpec): MeshData {
  const b = new Builder();
  const h = spec.height;
  const L = spec.halfLen;
  const wb = spec.halfWTop; // bottom of the mould = top of the wall
  const wt = spec.halfWBase;
  const th = 0.006;
  // Side walls (two long, two short) as thin slanted boxes.
  for (const s of [-1, 1]) {
    const m = compose(mat4Translate([0, h / 2, s * (wb + wt) / 2]), mat4RotateX(s * Math.atan2(wt - wb, h)));
    const p = new Builder();
    p.box([0, 0, 0], [2 * L + th, h, th], GREEN);
    b.append(p.build(), m);
    const e = new Builder();
    e.box([0, 0, 0], [th, h, (wb + wt)], GREEN);
    b.append(e.build(), mat4Translate([s * L, h / 2, 0]));
  }
  b.box([0, th / 2, 0], [2 * L, th, 2 * wb], GREEN);
  // Crenel blocks under the bottom.
  for (let x = -L + 0.04; x < L; x += 0.16) b.box([x + 0.04, -0.025, 0], [0.08, 0.05, 2 * wb], GREEN.map((c) => c * 0.8) as Vec3);
  // Handles.
  for (const s of [-1, 1]) b.tube([[s * (L + 0.005), h * 0.75, -0.03], [s * (L + 0.04), h * 0.75, 0], [s * (L + 0.005), h * 0.75, 0.03]], 0.008, WHITE, 8);
  return b.build();
}

/** Mason's trowel: diamond blade (tip at the origin, pointing -z) and a wooden handle. */
export function buildTrowel(): MeshData {
  const b = new Builder();
  const tip: Vec3 = [0, 0.004, 0];
  const l: Vec3 = [-0.045, 0.004, 0.09];
  const r: Vec3 = [0.045, 0.004, 0.09];
  const back: Vec3 = [0, 0.004, 0.14];
  b.flatTri(tip, l, back, STEEL);
  b.flatTri(tip, back, r, STEEL);
  b.tube([[0, 0.006, 0.12], [0, 0.04, 0.15], [0, 0.07, 0.17]], 0.004, STEEL, 6);
  b.tube([[0, 0.07, 0.17], [0, 0.09, 0.27]], 0.013, WOOD, 10);
  return b.build();
}

export function buildShovel(): MeshData {
  const b = new Builder();
  const halfW = 0.085;
  const len = 0.2;
  const halfWidth = (v: number) => {
    const tip = 0.32;
    const q = v < tip ? (tip - v) / tip : 0;
    return halfW * Math.sqrt(Math.max(1 - q * q, 0)) * (1 - 0.18 * v);
  };
  const scoop = (x: number, v: number) => 0.028 * (x / halfW) ** 2 + 0.012 * v;
  // Blade (single surface, shaded two-sided).
  b.surface(16, 20, (u, v) => {
    const x = (u * 2 - 1) * halfWidth(v);
    const y = scoop(x, v);
    const z = v * len;
    const dydx = (2 * 0.028 * x) / (halfW * halfW);
    return { p: [x, y, z], n: v3.norm([-dydx, 1, -0.06]) };
  }, BLUE);
  // Raised rim around the blade.
  const edge: Vec3[] = [];
  for (let k = 0; k <= 40; k++) {
    const v = Math.min(1, Math.abs(k / 20 - 1) * 1.0);
    const s = k < 20 ? -1 : 1;
    const vv = 1 - v;
    const x = s * halfWidth(vv);
    edge.push([x, scoop(x, vv) + 0.006, vv * len]);
  }
  b.tube(edge, 0.004, BLUE, 6, false);
  // Neck and shaft.
  b.tube([[0, 0.02, len - 0.01], [0, 0.03, len + 0.05], [0, 0.04, len + 0.08]], 0.016, BLUE, 12);
  b.tube([[0, 0.04, len + 0.07], [0, 0.075, len + 0.6]], 0.0135, YELLOW, 14);
  // T-grip.
  b.tube([[-0.06, 0.077, len + 0.62], [0.06, 0.077, len + 0.62]], 0.016, BLUE, 12);
  b.tube([[0, 0.075, len + 0.59], [0, 0.077, len + 0.625]], 0.014, BLUE, 12);
  return b.build();
}

export function buildDisc(): MeshData {
  const b = new Builder();
  const c = b.vert([0, 0, 0], [0, 1, 0], [1, 1, 1]);
  const ring: number[] = [];
  for (let k = 0; k <= 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    ring.push(b.vert([Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [1, 1, 1]));
  }
  for (let k = 0; k < 48; k++) b.tri(c, ring[k + 1], ring[k]);
  return b.build();
}

export function buildDome(): MeshData {
  const b = new Builder();
  b.surface(24, 10, (u, v) => {
    const a = u * Math.PI * 2;
    const e = v * Math.PI * 0.5;
    const n: Vec3 = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
    return { p: n, n };
  }, [1, 1, 1]);
  return b.build();
}

export type ToolMeshId = 'bucket' | 'crenel' | 'wall' | 'giant' | 'shovel' | 'trowel' | 'disc' | 'dome' | 'box';

export function toolMeshes(): Record<ToolMeshId, MeshData> {
  const box = new Builder();
  box.box([0, 0, 0], [1, 1, 1], [1, 1, 1]);
  return {
    bucket: buildBucket(baseMolds.bucket, RED, false),
    crenel: buildBucket(baseMolds.crenel, BLUE, true),
    wall: buildWallMold(baseMolds.wall),
    giant: buildBucket(baseMolds.giant, ORANGE, false, 3),
    shovel: buildShovel(),
    trowel: buildTrowel(),
    disc: buildDisc(),
    dome: buildDome(),
    box: box.build(),
  };
}

export interface DrawItem {
  mesh: ToolMeshId;
  model: Mat4;
  tint: [number, number, number, number];
  params: [number, number, number, number];
}

export const SAND_TINT = (m: number): [number, number, number, number] => {
  const w = smoothstep(0.05, 0.65, m);
  const k = 1 - 0.4 * w;
  return [0.93 * k, 0.8 * k * k, 0.53 * k * k, 1];
};

/**
 * Digging gesture, one pose per quarter of the cycle: push the blade in, lever the handle down, lift the
 * load (and throw it onto the heap when the shovel is full), back to rest. Each pose is
 * [depth into the sand 0..1, handle elevation offset (deg), lift above the ground 0..1, throw 0..1].
 */
const DIG_POSES = [
  [0, 0, 0, 0],
  [1, -6, 0, 0],
  [0.7, -24, 0, 0],
  [-0.15, -12, 0.7, 1],
];
/** Duration (s) of one digging gesture. */
const DIG_CYCLE = 0.6;

/** Cyclic Catmull-Rom through evenly spaced poses, at phase p (cycles). */
function cyclicSpline(poses: number[][], p: number): number[] {
  const n = poses.length;
  const x = (p - Math.floor(p)) * n;
  const i = Math.floor(x);
  const t = x - i;
  const k = (j: number) => poses[(i + j + n) % n];
  return k(0).map((_, c) => {
    const p0 = k(-1)[c], p1 = k(0)[c], p2 = k(1)[c], p3 = k(2)[c];
    return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
  });
}

/** Smoothly animated placement of the active tool. */
export class ToolAnimator {
  private pos: Vec3 = [8, 0.3, 8];
  private yaw = 0;
  /** Horizontal unit vector from the tool towards the camera. */
  private back: Vec3 = [0, 0, 1];
  private digPhase = 0;
  /** Shovel gesture (cycles); it always runs to the end of the current cycle before resting. */
  private digCycle = 0;
  /** Gesture amplitude: full while the blade bites, small once the hole has reached its level. */
  private digAmp = 1;
  private dumpBlend = 0;
  private patBlend = 0;
  private fillBlend = 0;
  private pourBlend = 0;

  update(tools: Tools, camPos: Vec3, dt: number): DrawItem[] {
    const hit = tools.hit;
    if (!hit.valid || tools.tool === 'decor') return [];
    const k = 1 - Math.exp(-dt * 25);
    this.pos = v3.lerp(this.pos, hit.pos, k);
    const back = v3.norm([camPos[0] - this.pos[0], 0, camPos[2] - this.pos[2]]);
    this.back = back;
    const targetYaw = tools.tool === 'wall' ? -tools.moldAngle : Math.atan2(back[0], back[2]);
    let dy = targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 10);

    const ease = (cur: number, on: boolean, speed = 10) => cur + ((on ? 1 : 0) - cur) * Math.min(1, dt * speed);
    const m = tools.mode;
    this.dumpBlend = ease(this.dumpBlend, m === Mode.Dump);
    this.patBlend = ease(this.patBlend, m === Mode.Pat);
    this.fillBlend = ease(this.fillBlend, m === Mode.Fill);
    this.pourBlend = ease(this.pourBlend, m === Mode.Pour, 6);
    const working = m === Mode.Pat || m === Mode.Carve || m === Mode.Smooth || m === Mode.Flatten;
    if (working) this.digPhase += dt * 14;
    else this.digPhase = 0;
    const next = this.digCycle + dt / DIG_CYCLE;
    if (m === Mode.Dig) this.digCycle = next;
    else if (this.digCycle > 0) this.digCycle = Math.floor(next) > Math.floor(this.digCycle) ? 0 : next;
    if (m === Mode.Dig) this.digAmp += ((tools.biting ? 1 : 0.3) - this.digAmp) * Math.min(1, dt * 6);
    else if (this.digCycle === 0) this.digAmp = 1;

    if (tools.tool === 'shovel') return this.shovel(tools);
    if (tools.tool === 'trowel') return this.trowel(tools);
    return this.mold(tools);
  }

  private shovel(tools: Tools): DrawItem[] {
    const inv = tools.inventory;
    const full = inv.shovelSand >= toolSpec.shovelCap * 0.98;
    const [depth, elevOff, lift, throwT] = cyclicSpline(DIG_POSES, this.digCycle).map((x) => x * this.digAmp);
    const toss = full ? throwT : 0;
    const pat = this.patBlend * Math.abs(Math.sin(this.digPhase)) * 0.05 * S;
    const elev = (55 + elevOff - 30 * this.patBlend) * (Math.PI / 180);
    const roll = this.dumpBlend * 2.2 + this.patBlend * Math.PI + 0.7 * toss;
    const at = v3.add(this.pos, v3.scale(this.back, -0.15 * toss * S));
    const model = compose(
      mat4Translate(v3.add(at, [0, (0.015 - 0.08 * depth + 0.1 * lift) * S + pat, 0])),
      mat4RotateY(this.yaw),
      mat4RotateX(-elev),
      mat4Translate([0, 0, -0.1 * depth * S]),
      mat4RotateZ(roll),
      mat4Translate([0, this.patBlend * 0.05 * S, 0]),
      mat4Scale([1.7 * S, 1.7 * S, 1.7 * S]),
    );
    const items: DrawItem[] = [{ mesh: 'shovel', model, tint: [0, 0, 0, 0], params: [0.35, 0, 0, 0] }];
    const frac = clamp(inv.shovelSand / toolSpec.shovelCap, 0, 1);
    if (frac > 0.01) {
      items.push({
        mesh: 'dome',
        model: compose(model, mat4Translate([0, 0.015, 0.1]), mat4Scale([0.062 * Math.sqrt(frac), 0.05 * frac, 0.085 * Math.sqrt(frac)])),
        tint: SAND_TINT(inv.shovelM),
        params: [0.8, 1, 0, 0],
      });
    }
    return items;
  }

  private trowel(tools: Tools): DrawItem[] {
    const work = Math.abs(Math.sin(this.digPhase));
    const elev = (tools.mode === Mode.Flatten || tools.mode === Mode.Smooth ? 8 : 35) * (Math.PI / 180);
    const model = compose(
      mat4Translate(v3.add(this.pos, [0, (0.01 + 0.02 * work) * S, 0])),
      mat4RotateY(this.yaw),
      mat4RotateX(-elev),
      mat4Translate([0, 0, -0.03 * work * S]),
      mat4Scale([1.4 * S, 1.4 * S, 1.4 * S]),
    );
    return [{ mesh: 'trowel', model, tint: [0, 0, 0, 0], params: [0.25, 0, 0, 0] }];
  }

  private mold(tools: Tools): DrawItem[] {
    const kind = tools.tool as MoldKind;
    const spec = baseMolds[kind];
    const cap = molds[kind].cap;
    const inv = tools.inventory;
    const h = spec.height;
    // Pouring / dipping motions are sized for the small bucket: scale them for bigger ones.
    const big = kind === 'wall' ? 1 : spec.rBase / baseMolds.bucket.rBase;
    const t = tools.flipAge;
    let angle = 0;
    let lift = 0.03;
    let pivotOffset: Vec3 = [0, 0, 0];
    if (t < 1.6) {
      // Flip: turn over (0-0.3 s), hold (0.3-0.65), lift off the tower (0.65-1.1), turn back (1.1-1.6).
      if (t < 0.3) {
        const e = smoothstep(0, 0.3, t);
        angle = Math.PI * e;
        lift = 0.12 * big * Math.sin(Math.PI * e);
      } else if (t < 0.65) {
        angle = Math.PI;
        lift = 0;
      } else if (t < 1.1) {
        angle = Math.PI;
        lift = h * 1.15 * smoothstep(0.65, 1.1, t);
      } else {
        angle = Math.PI * (1 - smoothstep(1.1, 1.6, t));
        lift = h * 1.15 * (1 - smoothstep(1.1, 1.6, t)) + 0.03;
      }
    } else {
      angle = -0.45 * this.fillBlend - 1.9 * this.pourBlend;
      lift = (0.03 - 0.06 * this.fillBlend + 0.32 * this.pourBlend) * big;
      pivotOffset = [0, 0, 0.12 * this.pourBlend * big];
    }
    // Animated in mould-local units (scale 1), then scaled to world size.
    const model = compose(
      mat4Translate(this.pos),
      mat4Scale([S, S, S]),
      mat4Translate([0, h / 2 + lift, 0]),
      mat4RotateY(this.yaw),
      mat4Translate(pivotOffset),
      mat4RotateX(angle),
      mat4Translate([0, -h / 2, 0]),
    );
    const mesh: ToolMeshId = kind;
    const items: DrawItem[] = [{ mesh, model, tint: [0, 0, 0, 0], params: [0.3, 0, 0, 0] }];
    const sandFrac = clamp(inv.bucketSand / cap, 0, 1);
    const waterFrac = clamp(inv.bucketWater / cap, 0, 1);
    const frac = Math.max(sandFrac, waterFrac);
    if (frac > 0.01 && Math.abs(angle) < 0.6 && t >= 0.3) {
      const y = 0.006 + (h - 0.012) * frac;
      const tint: [number, number, number, number] = waterFrac > sandFrac ? [0.02, 0.1, 0.11, 1] : SAND_TINT(inv.bucketM);
      const params: [number, number, number, number] = [0.8, waterFrac > sandFrac ? 2 : 1, 0, 0];
      if (kind === 'wall') {
        const w = spec.halfWTop + (spec.halfWBase - spec.halfWTop) * (y / h);
        items.push({ mesh: 'box', model: compose(model, mat4Translate([0, y - 0.002, 0]), mat4Scale([spec.halfLen * 2 - 0.01, 0.004, w * 2 - 0.01])), tint, params });
      } else {
        const r = spec.rTop + (spec.rBase - spec.rTop) * (y / h) - 0.006;
        items.push({ mesh: 'disc', model: compose(model, mat4Translate([0, y, 0]), mat4Scale([r, 1, r])), tint, params });
      }
    }
    return items;
  }
}
