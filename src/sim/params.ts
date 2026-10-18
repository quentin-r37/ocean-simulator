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
  waveAmp: 0.08,
  wavePeriod: 4.5,
  tsunamiAmp: 0.45, // crest height of the tsunami (m)
  // Marée
  tideAmp: 0.1,
  tidePeriodMin: 12, // minutes simulées pour un cycle complet
  tideSpeed: 1,
  tidePaused: false,
  // Soleil
  sunElevation: 52,
  sunAzimuth: -35,
  evaporation: 0.5,
  // Météo
  wind: 1, // multiplies the sway of plants and flags and the ripples
  overcast: 0, // cloud cover: greyer sky, weaker sun
  // Sable (angles en degrés)
  dryAngle: 34,
  wetAngle: 62,
  compactAngle: 85,
  satAngle: 17,
  cohesion: 1.2, // hauteur de paroi verticale tenue par le sable humide tassé (m)
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

export type MoldKind = 'bucket' | 'crenel' | 'wall' | 'giant';

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

/** Size multiplier applied to every tool and mould (`?tools=1|1.5|2`). */
export const TOOL_SCALE = (() => {
  const q = parseFloat(new URLSearchParams(location.search).get('tools') ?? '');
  return q >= 0.5 && q <= 2 ? q : 1.5;
})();

/** Mould shapes at scale 1; the tool meshes are built from these and scaled by TOOL_SCALE. */
export const baseMolds: Record<MoldKind, MoldSpec> = {
  // Toy-sized "giant" moulds so the castles read well at the diorama scale.
  bucket: { cap: 0.145, height: 0.56, merlon: 0, rBase: 0.306, rTop: 0.262, halfLen: 0, halfWBase: 0, halfWTop: 0 },
  crenel: { cap: 0.15, height: 0.525, merlon: 0.1, rBase: 0.306, rTop: 0.275, halfLen: 0, halfWBase: 0, halfWTop: 0 },
  wall: { cap: 0.1, height: 0.32, merlon: 0.075, rBase: 0, rTop: 0, halfLen: 0.5, halfWBase: 0.16, halfWTop: 0.13 },
  // Wide and squat so the tower it leaves stays under the height wet sand can hold (cohesion).
  giant: { cap: 1.207, height: 0.7, merlon: 0, rBase: 0.8, rTop: 0.68, halfLen: 0, halfWBase: 0, halfWTop: 0 },
};

function scaleMold(m: MoldSpec, s: number): MoldSpec {
  return {
    cap: m.cap * s ** 3, height: m.height * s, merlon: m.merlon * s, rBase: m.rBase * s, rTop: m.rTop * s,
    halfLen: m.halfLen * s, halfWBase: m.halfWBase * s, halfWTop: m.halfWTop * s,
  };
}

/** Mould shapes in world units (scaled). */
export const molds: Record<MoldKind, MoldSpec> = {
  bucket: scaleMold(baseMolds.bucket, TOOL_SCALE),
  crenel: scaleMold(baseMolds.crenel, TOOL_SCALE),
  wall: scaleMold(baseMolds.wall, TOOL_SCALE),
  giant: scaleMold(baseMolds.giant, TOOL_SCALE),
};

export const toolSpec = {
  shovelCap: 0.04 * TOOL_SCALE ** 3, // m³ (40 L at scale 1)
  shovelRadius: 0.3 * TOOL_SCALE,
  patRadius: 0.4 * TOOL_SCALE,
  fillRadius: 0.6 * TOOL_SCALE,
  trowelCarveRadius: 0.1 * TOOL_SCALE,
  trowelSmoothRadius: 0.22 * TOOL_SCALE,
  trowelFlattenRadius: 0.22 * TOOL_SCALE,
  /** Time (s) to fill the shovel / a mould while digging. */
  digTime: 0.45,
  fillTime: 0.45,
  /** The giant bucket scoops from a much wider area, and takes longer to fill. */
  giantFillRadius: 1.5 * TOOL_SCALE,
  giantFillTime: 1.1,
};

/** Sea level for a point of the tide cycle (phase in cycles; 0 = mid tide, rising). */
export function tideLevel(tidePhase: number, s: Settings = settings): number {
  return s.tideAmp * Math.sin(2 * Math.PI * tidePhase);
}

export function tideRising(tidePhase: number): boolean {
  return Math.cos(2 * Math.PI * tidePhase) > 0;
}
