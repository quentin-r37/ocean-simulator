struct Params {
  n: u32, frame: u32, _p0: u32, _p1: u32,
  dx: f32, dt: f32, time: f32, seaLevel: f32,
  g: f32, waveAmp: f32, wavePeriod: f32, boundaryDepth: f32,
  spongeCells: f32, friction: f32, viscosity: f32, erosionK: f32,
  depositK: f32, capacityK: f32, critVel: f32, evap: f32,
  moistDiff: f32, slumpRate: f32, dryTan: f32, wetTan: f32,
  compTan: f32, satTan: f32, seepK: f32, infilK: f32,
  foamDecay: f32, waveTime: f32, cohH: f32, _p3: f32,
}

@group(0) @binding(0) var<uniform> P: Params;

// Thickness of the surface layer whose properties (moisture, compaction) mix with incoming sand.
const LAYER: f32 = 0.06;

fn inside(x: i32, y: i32) -> bool {
  let n = i32(P.n);
  return x >= 0 && y >= 0 && x < n && y < n;
}

fn cidx(x: i32, y: i32) -> u32 {
  let n = i32(P.n);
  return u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1));
}

fn hash11(p: u32) -> f32 {
  var h = p * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  h = (h >> 22u) ^ h;
  return f32(h) / 4294967295.0;
}

// Critical slope (tan of the angle of repose) as a function of moisture M and compaction C.
// Dry sand ~34°, damp sand is held by capillary bridges (up to near-vertical when packed),
// saturated sand liquefies and flows at low angle.
fn critTan(M: f32, C: f32, rnd: f32) -> f32 {
  let coh = smoothstep(0.04, 0.2, M) * (1.0 - smoothstep(0.88, 0.97, M));
  let wet = mix(P.wetTan, P.compTan, C);
  var t = mix(P.dryTan, wet, coh);
  let sat = smoothstep(0.9, 0.99, M);
  t = mix(t, P.satTan, sat * (1.0 - 0.6 * C));
  return t * (0.88 + 0.24 * rnd);
}

// Height of the vertical cliff that cohesion lets damp, packed sand hold before any slope
// applies (moulded towers stand straight); it vanishes as the sand dries out or saturates.
fn cohHeight(M: f32, C: f32) -> f32 {
  let coh = smoothstep(0.04, 0.2, M) * (1.0 - smoothstep(0.88, 0.97, M));
  return P.cohH * coh * C * C;
}

// Equilibrium moisture from the height above the water table (capillary fringe).
fn moistEq(above: f32) -> f32 {
  return select(0.8 * (1.0 - smoothstep(0.03, 0.9, above)), 1.0, above < 0.03);
}
