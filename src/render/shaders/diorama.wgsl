// The slab the diorama stands on: grey floor, cut faces of the sand and of the water.
@group(0) @binding(1) var<storage, read> ground: array<vec4f>;
@group(0) @binding(2) var<storage, read> water: array<vec4f>;

const SLAB_BOTTOM: f32 = -1.4;
const FLOOR_EXTENT: f32 = 400.0;
const BG: vec3f = vec3f(0.30, 0.32, 0.33);

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) nrm: vec3f,
  @location(2) info: vec2f, // bedrock height, water surface height
}

// ----- Floor -----
@vertex
fn vs_floor(@builtin(vertex_index) vi: u32) -> VOut {
  var corners = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(1, 1), vec2f(-1, -1), vec2f(1, 1), vec2f(-1, 1));
  let L = cam.grid.z;
  let p = vec2f(L * 0.5) + corners[vi] * FLOOR_EXTENT;
  var o: VOut;
  o.wp = vec3f(p.x, SLAB_BOTTOM - 0.002, p.y);
  o.pos = cam.viewProj * vec4f(o.wp, 1.0);
  o.nrm = vec3f(0.0, 1.0, 0.0);
  o.info = vec2f(0.0);
  return o;
}

@fragment
fn fs_floor(in: VOut) -> @location(0) vec4f {
  let L = cam.grid.z;
  let q = abs(in.wp.xz - vec2f(L * 0.5)) - vec2f(L * 0.5);
  let dRect = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
  let ao = mix(0.55, 1.0, smoothstep(0.0, 3.0, dRect));
  let shadow = shadowAt(in.wp, vec3f(0.0, 1.0, 0.0));
  let lit = mix(0.62, 1.0, shadow);
  var col = BG * lit * ao;
  // Fade to the plain background far away.
  let dist = length(in.wp - cam.camPos.xyz);
  col = mix(col, BG, smoothstep(80.0, 260.0, dist));
  return vec4f(col, 1.0);
}

// ----- Cut faces (instance = edge 0..3: z=0, x=L, z=L, x=0) -----
fn edgeCell(edge: u32, k: i32) -> vec2i {
  let n = i32(cam.grid.x);
  switch edge {
    case 0u: { return vec2i(k, 0); }
    case 1u: { return vec2i(n - 1, k); }
    case 2u: { return vec2i(n - 1 - k, n - 1); }
    default: { return vec2i(0, n - 1 - k); }
  }
}

fn edgePos(edge: u32, k: i32) -> vec2f {
  let n = i32(cam.grid.x);
  let L = cam.grid.z;
  let dx = cam.grid.y;
  let s = select((f32(k) + 0.5) * dx, 0.0, k == 0);
  let s2 = select(s, L, k == n - 1);
  switch edge {
    case 0u: { return vec2f(s2, 0.0); }
    case 1u: { return vec2f(L, s2); }
    case 2u: { return vec2f(L - s2, L); }
    default: { return vec2f(0.0, L - s2); }
  }
}

fn edgeNormal(edge: u32) -> vec3f {
  switch edge {
    case 0u: { return vec3f(0.0, 0.0, -1.0); }
    case 1u: { return vec3f(1.0, 0.0, 0.0); }
    case 2u: { return vec3f(0.0, 0.0, 1.0); }
    default: { return vec3f(-1.0, 0.0, 0.0); }
  }
}

@vertex
fn vs_side(@builtin(vertex_index) vi: u32, @builtin(instance_index) edge: u32) -> VOut {
  let k = i32(vi / 2u);
  let c = edgeCell(edge, k);
  let i = cellIdx(c.x, c.y);
  let g = ground[i];
  let H = g.x + g.y;
  let p = edgePos(edge, k);
  var o: VOut;
  o.wp = vec3f(p.x, select(SLAB_BOTTOM, H, vi % 2u == 1u), p.y);
  o.pos = cam.viewProj * vec4f(o.wp, 1.0);
  o.nrm = edgeNormal(edge);
  o.info = vec2f(g.x, H + water[i].x);
  return o;
}

@fragment
fn fs_side(in: VOut) -> @location(0) vec4f {
  let wp = in.wp;
  let n = in.nrm;
  let along = wp.x + wp.z;
  // Sand strata above the bedrock, darker compact sandstone below.
  let wob = fbm(vec2f(along * 0.8, wp.y * 3.0)) * 0.04;
  var alb = vec3f(0.86, 0.72, 0.46);
  let band = sin((wp.y + wob) * 55.0) * 0.5 + 0.5;
  alb *= 0.9 + 0.08 * band;
  let sea = cam.sunDir.w;
  alb *= mix(1.0, 0.7, smoothstep(sea + 0.1, sea - 0.15, wp.y)); // wet below the water table
  if (wp.y < in.info.x) {
    let rockBand = sin((wp.y + wob * 3.0) * 18.0) * 0.5 + 0.5;
    alb = mix(vec3f(0.55, 0.44, 0.31), vec3f(0.62, 0.5, 0.36), rockBand);
  }
  // Fade towards the bottom of the slab.
  alb *= mix(0.55, 1.0, smoothstep(SLAB_BOTTOM, SLAB_BOTTOM + 1.0, wp.y));
  let Ld = normalize(cam.sunDir.xyz);
  let shadow = shadowAt(wp, n);
  let nl = max(dot(n, Ld), 0.0);
  let col = alb / PI * (sky.sun.rgb * nl * shadow + ambientIrr(sky, n) * 1.1);
  return vec4f(col, 1.0);
}

// Water cut face: from the sand to the water surface.
@vertex
fn vs_wside(@builtin(vertex_index) vi: u32, @builtin(instance_index) edge: u32) -> VOut {
  let k = i32(vi / 2u);
  let c = edgeCell(edge, k);
  let i = cellIdx(c.x, c.y);
  let g = ground[i];
  let H = g.x + g.y;
  let d = water[i].x;
  let top = select(H, H + d, d > 0.003);
  let p = edgePos(edge, k);
  var o: VOut;
  o.wp = vec3f(p.x, select(H, top, vi % 2u == 1u), p.y);
  // Nudge the face slightly outwards to avoid z-fighting with the sand face.
  o.wp += edgeNormal(edge) * 0.002;
  o.pos = cam.viewProj * vec4f(o.wp, 1.0);
  o.nrm = edgeNormal(edge);
  o.info = vec2f(H, top);
  return o;
}

@fragment
fn fs_wside(in: VOut) -> @location(0) vec4f {
  let depth = in.info.y - in.wp.y;
  if (in.info.y - in.info.x < 0.003) { discard; }
  let shallow = vec3f(0.08, 0.62, 0.68);
  let deep = vec3f(0.0, 0.2, 0.42);
  var alb = mix(shallow, deep, smoothstep(0.0, 0.9, depth));
  let sun = sky.sun.rgb;
  var col = alb * (sun * 0.12 + ambientIrr(sky, vec3f(0.0, 1.0, 0.0)) * 0.35);
  // Bright meniscus at the surface.
  col += vec3f(0.6, 0.9, 0.95) * (sun * 0.03) * (1.0 - smoothstep(0.0, 0.025, depth));
  return vec4f(col, 1.0);
}
