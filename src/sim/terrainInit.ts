import { SEA_DEPTH, WORLD_SIZE } from './params';
import { clamp, smoothstep } from '../math';
import { fbm } from '../world/noise';
import { level, Level, shoreAt } from './level';

export type { Rock } from './level';

/** Moisture the sand holds at equilibrium given its height above the water table (mirrors moistEq in WGSL). */
export function moistEq(above: number): number {
  return above < 0.03 ? 1 : 0.8 * (1 - smoothstep(0.03, 0.9, above));
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az;
  const t = clamp(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz), 0, 1);
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Sand surface of the level (without boulders), sea level 0:
 * dunes at the back (-z), a beach, basins (lagoon, tide pools) and channels, the open sea (+z).
 */
export function baseHeight(x: number, z: number, l: Level = level): number {
  const s = l.noise;
  let h = l.beachHeight - l.slope * z + l.roughness * fbm(x * 0.22, z * 0.22, 3 + s) + 0.012 * fbm(x * 1.1, z * 1.1, 11 + s);
  // Dunes along the back edge.
  const dune = smoothstep(l.duneDepth, 0.3, z + 0.6 * fbm(x * 0.3, 1, 21 + s));
  h += dune * l.duneHeight * (1 + 0.5 * fbm(x * 0.35, z * 0.35, 7 + s));
  // Open sea.
  const shore = shoreAt(l, x, fbm(x * 0.18, 3, 5 + s));
  const sea = smoothstep(shore - 0.2 * l.shoreWidth, shore + 0.8 * l.shoreWidth, z);
  h = mix(h, -SEA_DEPTH + 0.06 * fbm(x * 0.4, z * 0.4, 9 + s), sea);
  // Sand bar off the beach.
  if (l.bar) {
    const b = l.bar;
    const t = Math.exp(-(((z - b.z + 0.3 * fbm(x * 0.3, 2, 23 + s)) / b.width) ** 2));
    h = Math.max(h, mix(-SEA_DEPTH, b.top + 0.05 * fbm(x * 0.5, 4, 27 + s), t));
  }
  // Basins (warped ellipses).
  for (const b of l.basins) {
    const c = Math.cos(b.rot), sn = Math.sin(b.rot);
    const lx = ((x - b.x) * c + (z - b.z) * sn) / b.rx;
    const lz = (-(x - b.x) * sn + (z - b.z) * c) / b.rz;
    const r = Math.hypot(lx, lz) + b.warp * fbm(x * 0.45, z * 0.45, 13 + s);
    const lag = smoothstep(1.0, 0.55, r);
    h = Math.min(h, mix(h, b.floor + 0.1 * fbm(x * 0.6, z * 0.6, 17 + s), lag));
  }
  // Channels from the lagoon to the sea.
  for (const ch of l.channels) {
    const dc = distToSegment(x, z, ch.ax, ch.az, ch.bx, ch.bz) + 0.15 * fbm(x * 0.7, z * 0.7, 19 + s);
    const t = smoothstep(ch.halfWidth + 0.6, ch.halfWidth - 0.6, dc);
    h = Math.min(h, mix(h, ch.floor, t));
  }
  return h;
}

/** Height of a boulder's top at (x, z), or -Infinity outside it. */
export function rockHeight(x: number, z: number, l: Level = level): number {
  let top = -Infinity;
  for (const r of l.rocks) {
    const c = Math.cos(r.rot), s = Math.sin(r.rot);
    const u = ((x - r.x) * c + (z - r.z) * s) / r.rx;
    const v = (-(x - r.x) * s + (z - r.z) * c) / r.rz;
    const q = u * u + v * v;
    if (q < 1) top = Math.max(top, baseHeight(r.x, r.z, l) - 0.15 + r.h * Math.sqrt(1 - q));
  }
  return top;
}

/** Highest point of the ground (sand or boulder) at (x, z) in the generated diorama. */
export function initialHeight(x: number, z: number, l: Level = level): number {
  return Math.max(baseHeight(x, z, l), rockHeight(x, z, l));
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
      let bed = h - (0.55 + 0.2 * fbm(x * 0.08, z * 0.08, 29 + level.noise, 2));
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
