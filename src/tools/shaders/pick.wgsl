// Ray-marches the sand/water heightfield along the mouse ray.
// hit[0] = (pos, valid), hit[1] = (normal, isWater), hit[2] = (waterDepth, sand, moisture, compaction)
struct PickU {
  origin: vec4f,
  dir: vec4f,
  n: u32, _a: u32, dx: f32, _b: f32,
}
@group(0) @binding(0) var<uniform> U: PickU;
@group(0) @binding(1) var<storage, read> ground: array<vec4f>;
@group(0) @binding(2) var<storage, read> water: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> hit: array<vec4f, 3>;

fn cell(x: i32, y: i32) -> u32 {
  let n = i32(U.n);
  return u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1));
}

fn surfCell(x: i32, y: i32) -> f32 {
  let i = cell(x, y);
  let g = ground[i];
  let d = water[i].x;
  return g.x + g.y + select(0.0, d, d > 0.004);
}

fn surface(p: vec2f) -> f32 {
  let q = p / U.dx - 0.5;
  let i0 = vec2i(floor(q));
  let t = q - floor(q);
  let a = surfCell(i0.x, i0.y);
  let b = surfCell(i0.x + 1, i0.y);
  let c = surfCell(i0.x, i0.y + 1);
  let d = surfCell(i0.x + 1, i0.y + 1);
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

@compute @workgroup_size(1)
fn main() {
  let L = f32(U.n) * U.dx;
  let o = U.origin.xyz;
  let d = normalize(U.dir.xyz);
  // Clip the ray to the domain box.
  var t0 = 0.0;
  var t1 = 400.0;
  for (var k = 0; k < 3; k++) {
    let lo = select(0.0, -20.0, k == 1);
    let hi = select(L, 20.0, k == 1);
    if (abs(d[k]) < 1e-6) {
      if (o[k] < lo || o[k] > hi) { t1 = -1.0; }
    } else {
      let ta = (lo - o[k]) / d[k];
      let tb = (hi - o[k]) / d[k];
      t0 = max(t0, min(ta, tb));
      t1 = min(t1, max(ta, tb));
    }
  }
  hit[0] = vec4f(0.0);
  if (t1 <= t0) { return; }
  var t = t0;
  var tPrev = t0;
  var found = false;
  for (var i = 0; i < 3000; i++) {
    let p = o + d * t;
    let diff = p.y - surface(p.xz);
    if (diff < 0.0) { found = true; break; }
    tPrev = t;
    t += max(diff * 0.35, U.dx * 0.35);
    if (t > t1) { break; }
  }
  if (!found) { return; }
  var a = tPrev;
  var b = t;
  for (var i = 0; i < 16; i++) {
    let m = 0.5 * (a + b);
    let p = o + d * m;
    if (p.y - surface(p.xz) < 0.0) { b = m; } else { a = m; }
  }
  let p = o + d * b;
  let e = U.dx;
  let nrm = normalize(vec3f(surface(p.xz - vec2f(e, 0.0)) - surface(p.xz + vec2f(e, 0.0)), 2.0 * e,
                            surface(p.xz - vec2f(0.0, e)) - surface(p.xz + vec2f(0.0, e))));
  let ci = cell(i32(p.x / U.dx), i32(p.z / U.dx));
  let g = ground[ci];
  let w = water[ci];
  hit[0] = vec4f(p, 1.0);
  hit[1] = vec4f(nrm, select(0.0, 1.0, w.x > 0.02));
  hit[2] = vec4f(w.x, g.y, g.z, g.w);
}
