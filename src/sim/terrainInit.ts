import { SEA_DEPTH, WORLD_SIZE } from './params';
import { clamp, smoothstep } from '../math';
import { fbm } from '../world/noise';

/** Moisture the sand holds at equilibrium given its height above the water table (mirrors moistEq in WGSL). */
export function moistEq(above: number): number {
  return above < 0.03 ? 1 : 0.8 * (1 - smoothstep(0.03, 0.9, above));
}

/** A boulder baked into the bedrock (water and sand flow around it). */
export interface Rock {
  x: number;
  z: number;
  rx: number;
  rz: number;
  h: number; // height above the local sand
  rot: number;
  seed: number;
}

export const ROCKS: Rock[] = [
  { x: 1.3, z: 13.4, rx: 1.5, rz: 1.9, h: 1.25, rot: 0.3, seed: 1 },
  { x: 2.9, z: 14.9, rx: 0.9, rz: 0.8, h: 0.8, rot: 1.1, seed: 2 },
  { x: 5.0, z: 6.6, rx: 0.6, rz: 0.5, h: 0.75, rot: 0.7, seed: 3 },
  { x: 13.4, z: 10.4, rx: 0.75, rz: 0.6, h: 0.75, rot: 2.0, seed: 4 },
  { x: 14.7, z: 11.5, rx: 0.55, rz: 0.6, h: 0.6, rot: 0.2, seed: 5 },
  { x: 10.2, z: 14.7, rx: 0.45, rz: 0.4, h: 0.5, rot: 1.6, seed: 6 },
];

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az;
  const t = clamp(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz), 0, 1);
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Sand surface of the generated diorama (without boulders), sea level 0:
 * dunes at the back (-z), a beach, a lagoon linked to the open sea (+z) by a channel.
 */
export function baseHeight(x: number, z: number): number {
  let h = 0.3 - 0.01 * z + 0.045 * fbm(x * 0.22, z * 0.22, 3) + 0.012 * fbm(x * 1.1, z * 1.1, 11);
  // Dunes along the back edge.
  const dune = smoothstep(3.4, 0.3, z + 0.6 * fbm(x * 0.3, 1, 21));
  h += dune * (0.5 + 0.25 * fbm(x * 0.35, z * 0.35, 7));
  // Open sea.
  const shore = 12.4 + 0.9 * fbm(x * 0.18, 3, 5);
  h = mix(h, -SEA_DEPTH + 0.06 * fbm(x * 0.4, z * 0.4, 9), smoothstep(shore - 0.6, shore + 2.4, z));
  // Lagoon (warped ellipse).
  const lx = (x - 6.3) / 4.4;
  const lz = (z - 7.4) / 2.7;
  const r = Math.hypot(lx, lz) + 0.13 * fbm(x * 0.45, z * 0.45, 13);
  const lag = smoothstep(1.0, 0.55, r);
  h = mix(h, -0.55 + 0.1 * fbm(x * 0.6, z * 0.6, 17), lag);
  // Channel from the lagoon to the sea.
  const dc = distToSegment(x, z, 9.4, 8.6, 11.6, 13.4) + 0.15 * fbm(x * 0.7, z * 0.7, 19);
  const ch = smoothstep(1.5, 0.3, dc);
  h = Math.min(h, mix(h, -0.42, ch));
  return h;
}

/** Height of a boulder's top at (x, z), or -Infinity outside it. */
export function rockHeight(x: number, z: number): number {
  let top = -Infinity;
  for (const r of ROCKS) {
    const c = Math.cos(r.rot), s = Math.sin(r.rot);
    const u = ((x - r.x) * c + (z - r.z) * s) / r.rx;
    const v = (-(x - r.x) * s + (z - r.z) * c) / r.rz;
    const q = u * u + v * v;
    if (q < 1) top = Math.max(top, baseHeight(r.x, r.z) - 0.15 + r.h * Math.sqrt(1 - q));
  }
  return top;
}

/** Highest point of the ground (sand or boulder) at (x, z) in the generated diorama. */
export function initialHeight(x: number, z: number): number {
  return Math.max(baseHeight(x, z), rockHeight(x, z));
}

/**
 * Builds the initial diorama: ground = (bedrock, sand, moisture, compaction),
 * water = (depth, 0, vx, vz).
 */
export function buildBeach(n: number, seaLevel: number): { ground: Float32Array; water: Float32Array } {
  const ground = new Float32Array(n * n * 4);
  const water = new Float32Array(n * n * 4);
  const dx = WORLD_SIZE / n;
  for (let j = 0; j < n; j++) {
    const z = (j + 0.5) * dx;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * dx;
      const h = baseHeight(x, z);
      const rock = rockHeight(x, z);
      let bed = h - (0.55 + 0.2 * fbm(x * 0.08, z * 0.08, 29, 2));
      // A boulder raises the bedrock; above the sand it is bare rock.
      bed = Math.max(bed, rock);
      const top = Math.max(h, bed);
      const k = (j * n + i) * 4;
      ground[k] = bed;
      ground[k + 1] = top - bed;
      const above = top - seaLevel;
      const m = clamp(moistEq(above) * (1 - 0.3 * smoothstep(0.05, 0.3, above)), 0, 1);
      ground[k + 2] = m;
      ground[k + 3] = 0.25 * smoothstep(0.3, 0.9, m);
      water[k] = Math.max(0, seaLevel - top);
    }
  }
  return { ground, water };
}
