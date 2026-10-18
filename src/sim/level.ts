import { WORLD_SIZE } from './params';

/** A boulder baked into the bedrock (water and sand flow around it). */
export interface Rock {
  x: number;
  z: number;
  rx: number;
  rz: number;
  h: number; // height above the local sand
  rot: number;
  seed: number; // picks the boulder mesh
}

/** A warped elliptic hollow: the lagoon, or a small tide pool. */
export interface Basin {
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
  floor: number; // height of the bottom (sea level 0)
  warp: number;
}

/** A trench dug between two points (lagoon outlet). */
export interface Channel {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  halfWidth: number;
  floor: number;
}

/** A sand bar parallel to the shore, under water. */
export interface Bar {
  z: number;
  width: number;
  top: number;
}

/**
 * Parametric description of a diorama. The sea is always on the +z edge (the swell comes from there),
 * dunes on the -z edge; everything in between is shaped by these values.
 */
export interface Level {
  seed: number;
  /** Offset of the noise seeds: changes the small-scale relief. */
  noise: number;
  beachHeight: number; // sand height at z = 0 before the dunes
  slope: number; // fall per metre towards the sea
  roughness: number;
  duneHeight: number;
  duneDepth: number; // how far the dunes reach into the diorama (m)
  shoreZ: number;
  shoreWiggle: number;
  /** > 0: bay (shore pulled inland in the middle), < 0: headland. */
  bay: number;
  shoreWidth: number; // length of the foreshore slope down to the sea floor
  bar: Bar | null;
  basins: Basin[];
  channels: Channel[];
  rocks: Rock[];
  pier: { x: number; y: number; z: number; rot: number } | null;
}

/** The hand-made beach: lagoon, channel, pier. */
export const CLASSIC_LEVEL: Level = {
  seed: 0,
  noise: 0,
  beachHeight: 0.3,
  slope: 0.01,
  roughness: 0.045,
  duneHeight: 0.5,
  duneDepth: 3.4,
  shoreZ: 12.4,
  shoreWiggle: 0.9,
  bay: 0,
  shoreWidth: 3,
  bar: null,
  basins: [{ x: 6.3, z: 7.4, rx: 4.4, rz: 2.7, rot: 0, floor: -0.55, warp: 0.13 }],
  channels: [{ ax: 9.4, az: 8.6, bx: 11.6, bz: 13.4, halfWidth: 0.9, floor: -0.42 }],
  rocks: [
    { x: 1.3, z: 13.4, rx: 1.5, rz: 1.9, h: 1.25, rot: 0.3, seed: 1 },
    { x: 2.9, z: 14.9, rx: 0.9, rz: 0.8, h: 0.8, rot: 1.1, seed: 2 },
    { x: 5.0, z: 6.6, rx: 0.6, rz: 0.5, h: 0.75, rot: 0.7, seed: 3 },
    { x: 13.4, z: 10.4, rx: 0.75, rz: 0.6, h: 0.75, rot: 2.0, seed: 4 },
    { x: 14.7, z: 11.5, rx: 0.55, rz: 0.6, h: 0.6, rot: 0.2, seed: 5 },
    { x: 10.2, z: 14.7, rx: 0.45, rz: 0.4, h: 0.5, rot: 1.6, seed: 6 },
  ],
  pier: { x: 12.6, y: 0.36, z: 9.4, rot: Math.PI + 0.22 },
};

/** Number of boulder mesh variants (rock seeds are folded onto them). */
export const BOULDER_VARIANTS = 8;

/** The level the diorama is (re)built from. */
export let level: Level = CLASSIC_LEVEL;

export function setLevel(l: Level): void {
  level = l;
}

/** Shoreline position at x (where the foreshore starts dropping to the sea floor). */
export function shoreAt(l: Level, x: number, wiggle: number): number {
  const u = (x - WORLD_SIZE / 2) / (WORLD_SIZE / 2);
  return l.shoreZ - l.bay * (1 - u * u) + l.shoreWiggle * wiggle;
}
