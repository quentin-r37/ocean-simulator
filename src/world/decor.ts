import type { MeshData } from '../render/meshBuilder';
import {
  bottleMesh, bushMesh, buoyMesh, coralMesh, flagMesh, grassMesh, pierMesh, rockMesh, seaweedMesh, shellMesh, starfishMesh,
} from '../render/decorMeshes';
import { baseHeight, initialHeight } from '../sim/terrainInit';
import { BOULDER_VARIANTS, CLASSIC_LEVEL, level } from '../sim/level';
import { WORLD_SIZE } from '../sim/params';
import type { Text } from '../i18n';
import { fbm, rng } from './noise';

/** How an instance gets its height every frame. */
export enum YMode {
  Ground = 0, // sits on the (moving) sand surface
  Float = 1, // floats on the water when there is some
  Absolute = 2, // fixed height (pier, boulders)
}

export interface DecorKind {
  id: string;
  name: Text;
  icon: string;
  meshes: MeshData[]; // variants
  yMode: YMode;
  sway: number; // wind / current motion amplitude
  scale: [number, number];
  placeable: boolean;
  colorIndex?: number; // flags
  stone?: boolean; // wet / algae-covered around the waterline
}

/** Per-instance material slot: flag colour index, -2 for stone, -1 otherwise. */
export const materialOf = (k: DecorKind) => k.colorIndex ?? (k.stone ? -2 : -1);

const variants = (f: (seed: number) => MeshData, n: number) => Array.from({ length: n }, (_, k) => f(k + 1));

export const DECOR: DecorKind[] = [
  { id: 'flagRed', name: { fr: 'Drapeau rouge', en: 'Red flag' }, icon: '🚩', meshes: [flagMesh()], yMode: YMode.Ground, sway: 0.2, scale: [2.2, 2.2], placeable: true, colorIndex: 0 },
  { id: 'flagPurple', name: { fr: 'Drapeau violet', en: 'Purple flag' }, icon: '🟪', meshes: [flagMesh()], yMode: YMode.Ground, sway: 0.2, scale: [2.2, 2.2], placeable: true, colorIndex: 1 },
  { id: 'flagGreen', name: { fr: 'Drapeau vert', en: 'Green flag' }, icon: '🟩', meshes: [flagMesh()], yMode: YMode.Ground, sway: 0.2, scale: [2.2, 2.2], placeable: true, colorIndex: 2 },
  { id: 'flagYellow', name: { fr: 'Drapeau jaune', en: 'Yellow flag' }, icon: '🟨', meshes: [flagMesh()], yMode: YMode.Ground, sway: 0.2, scale: [2.2, 2.2], placeable: true, colorIndex: 3 },
  { id: 'shell', name: { fr: 'Coquillage', en: 'Shell' }, icon: '🐚', meshes: [shellMesh()], yMode: YMode.Ground, sway: 0, scale: [2.6, 3.6], placeable: true },
  { id: 'starfish', name: { fr: 'Étoile de mer', en: 'Starfish' }, icon: '⭐', meshes: [starfishMesh()], yMode: YMode.Ground, sway: 0, scale: [2.4, 3.2], placeable: true },
  { id: 'rock', name: { fr: 'Rocher', en: 'Rock' }, icon: '🪨', meshes: variants((s) => rockMesh(s + 40), 4), yMode: YMode.Ground, sway: 0, scale: [0.15, 0.35], placeable: true, stone: true },
  { id: 'coral', name: { fr: 'Corail', en: 'Coral' }, icon: '🪸', meshes: variants(coralMesh, 4), yMode: YMode.Ground, sway: 0, scale: [1.4, 2.2], placeable: true },
  { id: 'seaweed', name: { fr: 'Algue', en: 'Seaweed' }, icon: '🌿', meshes: variants(seaweedMesh, 3), yMode: YMode.Ground, sway: 0.6, scale: [1.2, 1.8], placeable: true },
  { id: 'grass', name: { fr: 'Oyat', en: 'Beach grass' }, icon: '🌾', meshes: variants(grassMesh, 3), yMode: YMode.Ground, sway: 0.5, scale: [1.5, 2.3], placeable: true },
  { id: 'bush', name: { fr: 'Buisson', en: 'Bush' }, icon: '🌳', meshes: variants(bushMesh, 3), yMode: YMode.Ground, sway: 0.12, scale: [1.6, 2.6], placeable: true },
  { id: 'bottle', name: { fr: 'Bouteille', en: 'Bottle' }, icon: '🍾', meshes: [bottleMesh()], yMode: YMode.Float, sway: 0, scale: [2.2, 2.6], placeable: true },
  { id: 'buoy', name: { fr: 'Bouée', en: 'Buoy' }, icon: '🔴', meshes: [buoyMesh()], yMode: YMode.Float, sway: 0, scale: [1.6, 1.8], placeable: true },
  { id: 'boulder', name: { fr: 'Gros rocher', en: 'Boulder' }, icon: '', meshes: variants(rockMesh, BOULDER_VARIANTS), yMode: YMode.Absolute, sway: 0, scale: [1, 1], placeable: false, stone: true },
  { id: 'pier', name: { fr: 'Ponton', en: 'Pier' }, icon: '', meshes: [pierMesh()], yMode: YMode.Absolute, sway: 0, scale: [1, 1], placeable: false },
];

export const kindIndex = (id: string) => DECOR.findIndex((k) => k.id === id);

export interface DecorInstance {
  kind: number;
  variant: number;
  x: number;
  y: number; // absolute height (YMode.Absolute) or offset otherwise
  z: number;
  rot: number;
  sx: number;
  sy: number;
  sz: number;
  seed: number;
}

export const MAX_DECOR = 4096;
export const INSTANCE_FLOATS = 12;

/** Owns the decoration instances; the renderer uploads `pack()` when `dirty`. */
export class DecorSet {
  instances: DecorInstance[] = [];
  dirty = true;

  reset(seaLevel: number): void {
    this.instances = generateDecor(seaLevel);
    this.dirty = true;
  }

  add(kind: number, x: number, z: number, seed = Math.random()): void {
    if (this.instances.length >= MAX_DECOR - 1) return;
    const k = DECOR[kind];
    const s = k.scale[0] + (k.scale[1] - k.scale[0]) * seed;
    this.instances.push({
      kind, variant: Math.floor(seed * 997) % k.meshes.length, x, y: 0, z,
      rot: seed * 6.2831853 * 13.7, sx: s, sy: s, sz: s, seed,
    });
    this.dirty = true;
  }

  /** Removes the placeable instance nearest to (x, z) within `radius`; returns true if one was removed. */
  removeNear(x: number, z: number, radius: number): boolean {
    let best = -1;
    let bd = radius;
    this.instances.forEach((it, i) => {
      if (!DECOR[it.kind].placeable) return;
      const d = Math.hypot(it.x - x, it.z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best < 0) return false;
    this.instances.splice(best, 1);
    this.dirty = true;
    return true;
  }

  /**
   * Packs instances sorted by (kind, variant) and returns the draw ranges.
   * Layout per instance: (x, y, z, rot), (sx, sy, sz, seed), (kind, material, yMode, sway).
   */
  pack(): { data: Float32Array; ranges: { kind: number; variant: number; first: number; count: number }[] } {
    const sorted = [...this.instances].sort((a, b) => a.kind - b.kind || a.variant - b.variant);
    const data = new Float32Array(MAX_DECOR * INSTANCE_FLOATS);
    const ranges: { kind: number; variant: number; first: number; count: number }[] = [];
    sorted.forEach((it, i) => {
      const k = DECOR[it.kind];
      data.set([it.x, it.y, it.z, it.rot, it.sx, it.sy, it.sz, it.seed, it.kind, materialOf(k), k.yMode, k.sway], i * INSTANCE_FLOATS);
      const last = ranges[ranges.length - 1];
      if (last && last.kind === it.kind && last.variant === it.variant) last.count++;
      else ranges.push({ kind: it.kind, variant: it.variant, first: i, count: 1 });
    });
    return { data, ranges };
  }
}

function generateDecor(seaLevel: number): DecorInstance[] {
  const out: DecorInstance[] = [];
  const r = rng(12345 + level.seed);
  const rocks = level.rocks;
  const L = WORLD_SIZE;
  const push = (id: string, x: number, z: number, scaleMul = 1, extra: Partial<DecorInstance> = {}) => {
    const kind = kindIndex(id);
    const k = DECOR[kind];
    const seed = r();
    const s = (k.scale[0] + (k.scale[1] - k.scale[0]) * r()) * scaleMul;
    out.push({ kind, variant: Math.floor(r() * k.meshes.length), x, y: 0, z, rot: r() * Math.PI * 2, sx: s, sy: s, sz: s, seed, ...extra });
  };
  const nearRock = (x: number, z: number, pad: number) =>
    rocks.some((rk) => Math.hypot((x - rk.x) / (rk.rx + pad), (z - rk.z) / (rk.rz + pad)) < 1);

  // Boulders (their footprint is baked into the bedrock; the mesh is enlarged a little to cover it).
  rocks.forEach((rk) => {
    out.push({
      kind: kindIndex('boulder'), variant: (rk.seed - 1) % BOULDER_VARIANTS, x: rk.x, y: baseHeight(rk.x, rk.z) - 0.17, z: rk.z,
      rot: rk.rot, sx: rk.rx * 1.14, sy: (rk.h + 0.2) * 1.08, sz: rk.rz * 1.14, seed: r(),
    });
  });

  // Pier from the sand into the lagoon or the sea.
  const pier = level.pier;
  if (pier) out.push({ kind: kindIndex('pier'), variant: 0, x: pier.x, y: pier.y, z: pier.z, rot: pier.rot, sx: 1, sy: 1, sz: 1, seed: 0.5 });

  const tries = (n: number, f: (x: number, z: number) => void) => {
    for (let i = 0; i < n; i++) f(0.25 + r() * (L - 0.5), 0.25 + r() * (L - 0.5));
  };
  // Vegetation on the dunes, clumped with noise.
  tries(9000, (x, z) => {
    const h = initialHeight(x, z) - seaLevel;
    const clump = fbm(x * 0.6, z * 0.6, 51);
    if (h < 0.32 || nearRock(x, z, 0.1)) return;
    const dune = Math.max(0, 1 - z / 4.2);
    if (r() < dune * 0.1 * (clump + 1.0)) push(r() < 0.25 ? 'bush' : 'grass', x, z);
    else if (r() < 0.006) push('grass', x, z, 0.8);
  });
  // Under water: seaweed meadows and coral clusters.
  tries(9000, (x, z) => {
    const depth = seaLevel - initialHeight(x, z);
    if (depth < 0.08 || nearRock(x, z, -0.05)) return;
    const meadow = fbm(x * 0.5, z * 0.5, 61);
    if (depth < 0.8 && meadow > 0.0 && r() < 0.09) push('seaweed', x, z);
    const reef = fbm(x * 0.35, z * 0.35, 71);
    if (depth > 0.18 && reef > 0.05 && r() < 0.05) push('coral', x, z);
    else if (depth > 0.15 && r() < 0.004) push('rock', x, z);
  });
  // Corals around the boulders standing in water.
  for (const rk of rocks) {
    for (let i = 0; i < 10; i++) {
      const a = r() * Math.PI * 2;
      const x = rk.x + Math.cos(a) * (rk.rx + 0.15 + r() * 0.5);
      const z = rk.z + Math.sin(a) * (rk.rz + 0.15 + r() * 0.5);
      if (seaLevel - initialHeight(x, z) > 0.15) push(r() < 0.6 ? 'coral' : 'seaweed', x, z);
    }
  }
  // Shells, starfish and pebbles on the beach.
  tries(900, (x, z) => {
    const h = initialHeight(x, z) - seaLevel;
    if (h < -0.15 || h > 0.3 || nearRock(x, z, 0.05)) return;
    const u = r();
    if (u < 0.03) push('shell', x, z);
    else if (u < 0.036) push('starfish', x, z);
    else if (u < 0.05) push('rock', x, z, 0.6);
  });
  if (level === CLASSIC_LEVEL) {
    push('bottle', 7.6, 14.8);
    push('buoy', 13.6, 14.6);
  } else {
    push('bottle', 1 + r() * (L - 2), 14.3 + r() * 0.6);
    push('buoy', 1 + r() * (L - 2), 13.8 + r() * 1.0);
  }
  return out;
}
