// Sand <-> water coupling: hydraulic erosion/deposition, moisture (wetting, capillarity,
// drainage, evaporation), infiltration, groundwater seepage, foam generation, compaction loss.
@group(0) @binding(1) var<storage, read> groundIn: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> groundOut: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> water: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> aux: array<vec4f>; // in place (own cell only)

// Surf attacking a structure (castle, dune scarp) standing above the water's edge in direction
// `dir`. The water is looked for up to UNDERMINE cells away: the column facing it is hit in full,
// the ones behind less and less, as the soaked, scoured base undermines them. So a castle at the
// water's edge slumps in slices (and loses height) instead of being nibbled one column at a time.
// Water runs up any debris apron (run-up ≈ v²/2g). Returns (wetted height, wetted height × surf
// speed²) with that fall-off: the structure soaks up water and the surf (pore pressure, backwash,
// flow along the face: ∝ v²) breaks its packing.
const UNDERMINE: i32 = 9;
fn faceAttack(x: i32, y: i32, dir: vec2i, H: f32) -> vec2f {
  var toeH = H;
  var reach = -1e9;
  var speed = 0.0;
  var first = 0;
  for (var k = 1; k <= UNDERMINE + 2; k++) {
    if (first > 0 && k > first + 2) { break; }
    let c = cidx(x + dir.x * k, y + dir.y * k);
    let gs = groundIn[c];
    let Hs = gs.x + gs.y;
    let w = water[c];
    if (first == 0) { toeH = min(toeH, Hs); }
    if (w.x > 0.004) {
      if (first == 0) {
        if (k > UNDERMINE) { break; }
        first = k;
      }
      let v = length(w.zw);
      reach = max(reach, Hs + w.x + v * v / (2.0 * P.g));
      speed = max(speed, v);
    }
  }
  let face = H - toeH;
  // Columns behind the face only count against a real wall, not the gentle slope of the beach.
  if (first == 0 || face < select(0.06, 0.02, first == 1)) { return vec2f(0.0); }
  let reachIn = f32(first - 1) * length(vec2f(dir));
  let contact = clamp(reach - toeH, 0.0, face) * max(1.0 - reachIn / f32(UNDERMINE), 0.0);
  let surf = 0.8 + speed;
  return vec2f(contact, contact * surf * surf);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = i32(P.n);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= n || y >= n) { return; }
  let i = u32(y * n + x);
  let g = groundIn[i];
  var S = g.y;
  var M = g.z;
  var C = g.w;
  var w = water[i];
  var d = w.x;
  var a = aux[i];
  var sed = a.x;
  var foam = a.y;

  let gl = groundIn[cidx(x - 1, y)];
  let gr = groundIn[cidx(x + 1, y)];
  let gb = groundIn[cidx(x, y - 1)];
  let gt = groundIn[cidx(x, y + 1)];
  let H = g.x + S;
  let grad = vec2f((gr.x + gr.y) - (gl.x + gl.y), (gt.x + gt.y) - (gb.x + gb.y)) / (2.0 * P.dx);
  let slope = length(grad);
  let speed = length(w.zw);

  // --- Hydraulic erosion (transport capacity model with critical velocity) ---
  if (d > 0.002) {
    let sinA = slope / sqrt(1.0 + slope * slope);
    let excess = max(speed - P.critVel, 0.0);
    let cap = P.capacityK * excess * (0.25 + sinA) * smoothstep(0.004, 0.04, d);
    if (sed < cap) {
      let e = min(S, P.erosionK * (1.0 - 0.75 * C) * (cap - sed) * P.dt);
      S -= e;
      sed += e;
    } else {
      let dep = min(sed, P.depositK * (sed - cap) * P.dt);
      S += dep;
      sed -= dep;
    }
    // Flowing water breaks the packing of the surface.
    C = max(C - 0.8 * P.dt * excess, 0.0);
  } else {
    S += sed;
    sed = 0.0;
  }

  // --- Moisture ---
  let Hn = g.x + S;
  let above = Hn - P.waterTable;
  if (d > 0.004) {
    M = min(1.0, M + 3.0 * P.dt);
  } else {
    let eq = moistEq(above);
    let tgt = eq * mix(1.0, 0.3, P.evap * smoothstep(0.05, 0.3, above));
    if (M > tgt) {
      // Saturated sand drains quickly to field capacity, then slowly evaporates.
      let rate = select(0.0012 + 0.007 * P.evap, 0.07, M > 0.9);
      M = max(tgt, M - rate * P.dt);
    } else {
      M = min(tgt, M + 0.012 * P.dt);
    }
  }
  // Capillary diffusion between neighbouring columns.
  let lap = gl.z + gr.z + gb.z + gt.z - 4.0 * g.z;
  M = clamp(M + P.moistDiff * P.dt / (P.dx * P.dx) * lap, 0.0, 1.0);

  // --- Infiltration of perched water, drainage of pools into the water table, seepage from it ---
  let surf = Hn + d;
  if (d > 0.0 && Hn > P.waterTable + 0.005) {
    let inf = min(d, P.infilK * (1.03 - M) * P.dt);
    d -= inf;
    M = min(1.0, M + inf * 25.0);
  } else if (surf > P.seaLevel) {
    // A pool sitting on saturated sand drains through the beach towards the sea, as slowly as
    // the water table itself, until its floor comes out above the table and it soaks in.
    d -= min(d, (surf - P.seaLevel) * min(P.drainK * P.dt, 1.0));
  }
  if (Hn < P.seaLevel - 0.004 && surf < P.seaLevel) {
    d += (P.seaLevel - surf) * min(P.seepK * P.dt, 1.0);
  }
  d = max(d - P.surfEvap * P.dt, 0.0);

  // --- Waves against the faces of steep columns: soaked and battered, the packing goes, the
  // cohesion with it, and the column slumps into the water (castles melt from the base). ---
  var atk = vec2f(0.0);
  for (var a = 0; a < 8; a++) {
    let dirs = array<vec2i, 8>(vec2i(-1, 0), vec2i(1, 0), vec2i(0, -1), vec2i(0, 1),
                               vec2i(-1, -1), vec2i(1, -1), vec2i(-1, 1), vec2i(1, 1));
    atk += faceAttack(x, y, dirs[a], Hn);
  }
  if (atk.x > 0.0) {
    M = min(1.0, M + 15.0 * atk.x * P.dt);
    C = max(C - 25.0 * P.erosionK * atk.y * P.dt, 0.0);
  }

  // Saturated sand slowly loses its packing (liquefaction).
  C = max(C - 0.05 * P.dt * smoothstep(0.9, 1.0, M), 0.0);

  // --- Foam: whitecaps on fast/breaking water and swash foam on the shore ---
  // Breaking: in shallow water a wave breaks when the flow speed nears the wave celerity
  // (high Froude number); that is where the white water of the surf and swash comes from.
  let froude = speed / sqrt(9.81 * max(d, 0.005));
  let gen = 0.5 * smoothstep(1.3, 2.6, speed) * smoothstep(0.004, 0.04, d)
          + 0.9 * smoothstep(0.35, 0.8, froude) * smoothstep(0.004, 0.02, d) * (1.0 - smoothstep(0.25, 0.6, d))
          + 0.3 * smoothstep(0.5, 1.6, speed) * smoothstep(0.002, 0.01, d) * (1.0 - smoothstep(0.03, 0.2, d));
  foam = clamp(foam + gen * P.dt * 4.0, 0.0, 1.0);

  groundOut[i] = vec4f(g.x, max(S, 0.0), M, C);
  water[i] = vec4f(d, w.y, w.z, w.w);
  aux[i] = vec4f(sed, foam, a.z, a.w);
}
