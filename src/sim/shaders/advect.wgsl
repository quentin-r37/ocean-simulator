// Conservative transport of suspended sediment (x) and foam (y): each cell exports the same
// fraction of its content as the fraction of its water leaving through the pipes this step.
// Runs between the flux pass and the depth update (water.x is still the pre-step depth).
@group(0) @binding(1) var<storage, read> water: array<vec4f>;
@group(0) @binding(2) var<storage, read> auxIn: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> auxOut: array<vec4f>;
@group(0) @binding(4) var<storage, read> flux: array<vec4f>;

fn leaving(i: u32, f: f32) -> f32 {
  let d = water[i].x;
  if (d < 1e-6) { return 0.0; }
  return clamp(f * P.dt / (d * P.dx * P.dx), 0.0, 1.0);
}

fn incoming(x: i32, y: i32, comp: u32) -> vec2f {
  if (!inside(x, y)) { return vec2f(0.0); }
  let j = cidx(x, y);
  return auxIn[j].xy * leaving(j, flux[j][comp]);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = i32(P.n);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= n || y >= n) { return; }
  let i = u32(y * n + x);
  var a = auxIn[i];
  let f = flux[i];
  let out = leaving(i, f.x + f.y + f.z + f.w);
  var c = a.xy * (1.0 - out);
  c += incoming(x - 1, y, 1u) + incoming(x + 1, y, 0u) + incoming(x, y - 1, 3u) + incoming(x, y + 1, 2u);
  let d = water[i].x;
  let decay = P.foamDecay + select(0.0, 2.5, d < 0.004);
  auxOut[i] = vec4f(c.x, c.y * exp(-P.dt * decay), a.z, a.w);
}
