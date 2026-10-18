import { rng } from '../world/noise';
import { BOULDER_VARIANTS, Level, shoreAt } from './level';
import { WORLD_SIZE } from './params';
import { baseHeight, initialHeight, rockHeight } from './terrainInit';

const PIER_LEN = 3.2;

/**
 * Random beach for a seed. Layout rules keep the simulation sane: the sea floor reaches the open
 * boundary (+z) before the wave-maker band, the lagoon stays inland, the sand bar stays under water.
 */
export function generateLevel(seed: number): Level {
  const r = rng(Math.imul(seed, 2654435761) ^ 0x5bd1e995);
  const between = (a: number, b: number) => a + (b - a) * r();
  const chance = (p: number) => r() < p;
  const L = WORLD_SIZE;

  const bay = chance(0.55) ? between(-1.2, 2.4) : 0;
  const shoreWidth = between(2, 3.2);
  const shoreWiggle = between(0.3, 1.3);
  // The furthest shore point (middle of a headland, ±wiggle) plus its slope must end before z ≈ 15.
  const shoreZ = Math.min(between(10.4, 12.6) + Math.max(0, bay), 15 - 0.8 * shoreWidth - Math.max(0, -bay) - 0.6 * shoreWiggle);
  const slope = between(0.004, 0.026);
  const lv: Level = {
    seed,
    noise: (seed % 9973) * 37 + 1,
    beachHeight: 0.14 + slope * shoreZ + between(0, 0.14),
    slope,
    roughness: between(0.025, 0.08),
    duneHeight: between(0.2, 0.95),
    duneDepth: between(1.6, 4.6),
    shoreZ,
    shoreWiggle,
    bay,
    shoreWidth,
    bar: null,
    basins: [],
    channels: [],
    rocks: [],
    pier: null,
  };
  if (chance(0.4)) lv.bar = { z: Math.min(shoreZ + between(0.8, 1.6), 13.6), width: between(0.4, 0.7), top: between(-0.3, -0.08) };

  // Lagoon, usually linked to the sea by a channel.
  let lagoon = false;
  if (chance(0.7)) {
    const rx = between(2.2, 4.6);
    const rz = between(1.5, 2.6);
    const x = between(rx * 0.7 + 0.5, L - rx * 0.7 - 0.5);
    const z = Math.min(between(lv.duneDepth + 1.4, lv.duneDepth + 4.5), shoreZ - Math.max(0, bay) - rz - 1);
    lv.basins.push({ x, z, rx, rz, rot: between(-0.5, 0.5), floor: between(-0.65, -0.35), warp: between(0.08, 0.2) });
    lagoon = true;
    if (chance(0.75)) {
      const side = r() < 0.5 ? -1 : 1;
      const ax = x + side * rx * between(0.1, 0.5);
      const bx = Math.min(Math.max(ax + side * between(0.5, 2.5), 1.5), L - 1.5);
      lv.channels.push({ ax, az: z + rz * 0.4, bx, bz: shoreAt(lv, bx, 0) + 1, halfWidth: between(0.5, 1.1), floor: between(-0.48, -0.32) });
    }
  }
  // A few tide pools on the foreshore.
  const pools = Math.floor(between(0, 3.6));
  for (let i = 0; i < pools; i++) {
    const x = between(1.5, L - 1.5);
    const rx = between(0.5, 1.2);
    const z = shoreAt(lv, x, 0) - between(1, 2.5);
    lv.basins.push({ x, z, rx, rz: rx * between(0.6, 1.2), rot: between(0, Math.PI), floor: between(-0.3, -0.06), warp: between(0.1, 0.3) });
  }

  // Boulders, in one to three clusters.
  const clusters = 1 + Math.floor(between(0, 3));
  let variant = Math.floor(between(0, BOULDER_VARIANTS));
  for (let c = 0; c < clusters; c++) {
    const cx = between(1, L - 1);
    const cz = between(lv.duneDepth, 14.2);
    const n = 1 + Math.floor(between(0, 4));
    for (let i = 0; i < n; i++) {
      const size = i === 0 ? between(0.7, 1.6) : between(0.35, 0.9);
      const rx = size * between(0.8, 1.2);
      const rz = size * between(0.8, 1.2);
      lv.rocks.push({
        x: Math.min(Math.max(cx + between(-1.8, 1.8), 0.6), L - 0.6),
        // Keep clear of the wave-maker band along the open edge.
        z: Math.min(Math.max(cz + between(-1.5, 1.5), 0.6), 15 - Math.max(rx, rz)),
        rx,
        rz,
        h: size * between(0.6, 0.95) + 0.1,
        rot: between(0, Math.PI),
        seed: 1 + (variant++ % BOULDER_VARIANTS),
      });
    }
  }

  if (chance(0.65)) lv.pier = placePier(lv, r, lagoon);
  return lv;
}

/**
 * Finds a spot where a pier can run from dry sand into the water (the lagoon, or the sea),
 * clear of the boulders. Returns null if none is found.
 */
function placePier(lv: Level, r: () => number, lagoon: boolean): Level['pier'] {
  const L = WORLD_SIZE;
  for (let attempt = 0; attempt < 40; attempt++) {
    let ax: number, az: number, dx: number, dz: number;
    if (lagoon && attempt < 25) {
      // Walk out from the lagoon centre until dry land, then point back in.
      const b = lv.basins[0];
      const a = r() * Math.PI * 2;
      const ux = Math.cos(a) * b.rx, uz = Math.sin(a) * b.rz;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const ox = ux * c - uz * s, oz = ux * s + uz * c;
      let t = 0.3;
      while (t < 1.8 && baseHeight(b.x + ox * t, b.z + oz * t, lv) < 0.14) t += 0.04;
      ax = b.x + ox * t;
      az = b.z + oz * t;
      const n = Math.hypot(ox, oz);
      dx = -ox / n;
      dz = -oz / n;
    } else {
      // From the beach straight out to sea.
      ax = 2 + r() * (L - 4);
      az = shoreAt(lv, ax, 0) + 1.5;
      while (az > 1 && baseHeight(ax, az, lv) < 0.14) az -= 0.05;
      const a = Math.PI / 2 + (r() - 0.5) * 0.6;
      dx = Math.cos(a);
      dz = Math.sin(a);
    }
    const ex = ax + dx * PIER_LEN, ez = az + dz * PIER_LEN;
    if (ax < 0.5 || ax > L - 0.5 || ex < 0.5 || ex > L - 0.5 || ez > 15 || az < 0.5 || ez < 0.5) continue;
    const ground = baseHeight(ax, az, lv);
    if (ground > 0.45 || initialHeight(ex, ez, lv) > -0.15) continue;
    let clear = true;
    for (let k = 0; k <= 16 && clear; k++) {
      const t = (k / 16) * PIER_LEN;
      for (const side of [-0.6, 0, 0.6]) {
        if (rockHeight(ax + dx * t - dz * side, az + dz * t + dx * side, lv) > -Infinity) clear = false;
      }
    }
    if (!clear) continue;
    return { x: ax, y: Math.max(0.36, ground + 0.14), z: az, rot: Math.atan2(dz, dx) };
  }
  return null;
}

/** Seed from the URL (`?seed=123`), or null for the classic beach. */
export function urlSeed(): number | null {
  const q = new URLSearchParams(location.search).get('seed');
  const n = q ? parseInt(q, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
