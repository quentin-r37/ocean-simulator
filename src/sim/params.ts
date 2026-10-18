// Global, user-tweakable settings (bound to lil-gui) and world constants.

export const WORLD_SIZE = 16; // metres, square diorama
export const GRAVITY = 9.81;
export const MAX_SUBSTEPS = 16;
/** Bottom of the diorama slab (the cut faces go down to here). */
export const SLAB_BOTTOM = -1.4;
/** Depth of the open sea at the far (+z) edge, at mean tide. */
export const SEA_DEPTH = 0.85;

export function gridSize(): number {
  const q = new URLSearchParams(location.search).get('grid');
  const n = q ? parseInt(q, 10) : 512;
  return [256, 384, 512, 768].includes(n) ? n : 512;
}

export const settings = {
  // Houle
  waveAmp: 0.045,
  wavePeriod: 4.5,
  // Marée
  tideAmp: 0.1,
  tidePeriodMin: 12, // minutes simulées pour un cycle complet
  tideSpeed: 1,
  tidePaused: false,
  // Soleil
  sunElevation: 52,
  sunAzimuth: -35,
  evaporation: 0.5,
  // Sable (angles en degrés)
  dryAngle: 34,
  wetAngle: 62,
  compactAngle: 85,
  satAngle: 17,
  slumpRate: 60,
  erosion: 1,
  // Simulation
  substeps: 8, // maximum; the actual count follows the CFL limit
  // Rendu
  exposure: 1.0,
  bloom: 0.03,
  renderScale: Math.min(window.devicePixelRatio || 1, 1.5),
  showMoisture: false,
};

export type Settings = typeof settings;

export type MoldKind = 'bucket' | 'crenel' | 'wall';

export interface MoldSpec {
  cap: number; // m³
  height: number; // body height (m)
  merlon: number; // crenel height (m), 0 = none
  // Round moulds: opening (base of the tower) and bottom (top of the tower) radii.
  rBase: number;
  rTop: number;
  // Wall mould: half length / half width at the base and at the top.
  halfLen: number;
  halfWBase: number;
  halfWTop: number;
}

export const molds: Record<MoldKind, MoldSpec> = {
  // Toy-sized "giant" moulds so the castles read well at the diorama scale.
  bucket: { cap: 0.145, height: 0.56, merlon: 0, rBase: 0.306, rTop: 0.262, halfLen: 0, halfWBase: 0, halfWTop: 0 },
  crenel: { cap: 0.15, height: 0.525, merlon: 0.1, rBase: 0.306, rTop: 0.275, halfLen: 0, halfWBase: 0, halfWTop: 0 },
  wall: { cap: 0.1, height: 0.32, merlon: 0.075, rBase: 0, rTop: 0, halfLen: 0.5, halfWBase: 0.16, halfWTop: 0.13 },
};

export const toolSpec = {
  shovelCap: 0.04, // m³ (40 L)
  shovelRadius: 0.3,
  patRadius: 0.4,
  fillRadius: 0.6,
  trowelCarveRadius: 0.1,
  trowelSmoothRadius: 0.22,
  trowelFlattenRadius: 0.22,
  /** Time (s) to fill the shovel / a mould while digging. */
  digTime: 0.45,
  fillTime: 0.45,
};

/** Sea level for a point of the tide cycle (starts at mid tide, rising). */
export function tideLevel(tideTime: number, s: Settings = settings): number {
  const period = s.tidePeriodMin * 60;
  return s.tideAmp * Math.sin((2 * Math.PI * tideTime) / period);
}

export function tideRising(tideTime: number, s: Settings = settings): boolean {
  const period = s.tidePeriodMin * 60;
  return Math.cos((2 * Math.PI * tideTime) / period) > 0;
}
