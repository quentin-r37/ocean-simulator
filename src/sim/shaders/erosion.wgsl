// Sand <-> water coupling: hydraulic erosion/deposition, moisture (wetting, capillarity,
// drainage, evaporation), infiltration, groundwater seepage, foam generation, compaction loss.
@group(0) @binding(1) var<storage, read> groundIn: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> groundOut: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> water: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> aux: array<vec4f>; // in place (own cell only)

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
  let above = Hn - P.seaLevel;
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

  // --- Infiltration of perched water and seepage from the water table ---
  if (d > 0.0 && Hn > P.seaLevel + 0.005) {
    let inf = min(d, P.infilK * (1.03 - M) * P.dt);
    d -= inf;
    M = min(1.0, M + inf * 25.0);
  }
  if (Hn < P.seaLevel - 0.004) {
    let surf = Hn + d;
    if (surf < P.seaLevel) { d += (P.seaLevel - surf) * min(P.seepK * P.dt, 1.0); }
  }

  // Saturated sand slowly loses its packing (liquefaction).
  C = max(C - 0.05 * P.dt * smoothstep(0.9, 1.0, M), 0.0);

  // --- Foam: whitecaps on fast/breaking water and swash foam on the shore ---
  let gen = 0.5 * smoothstep(1.3, 2.6, speed) * smoothstep(0.004, 0.04, d)
          + 0.3 * smoothstep(0.5, 1.6, speed) * smoothstep(0.002, 0.01, d) * (1.0 - smoothstep(0.03, 0.2, d));
  foam = clamp(foam + gen * P.dt * 4.0, 0.0, 1.0);

  groundOut[i] = vec4f(g.x, max(S, 0.0), M, C);
  water[i] = vec4f(d, w.y, w.z, w.w);
  aux[i] = vec4f(sed, foam, a.z, a.w);
}
