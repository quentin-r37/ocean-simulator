// Shallow-water "virtual pipes" (Mei et al. 2007) with a depth-dependent pipe conductance
// so long waves travel at sqrt(g h). flux = outflow (m³/s) towards -x, +x, -z, +z.
@group(0) @binding(1) var<storage, read> ground: array<vec4f>;
@group(0) @binding(2) var<storage, read> water: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> flux: array<vec4f>;

fn faceFlux(f0: f32, h: f32, H: f32, x: i32, y: i32) -> f32 {
  if (!inside(x, y)) { return 0.0; }
  let i = cidx(x, y);
  let g = ground[i];
  let Hn = g.x + g.y;
  let hn = Hn + water[i].x;
  // Water depth available at the shared face (handles flow over crests and walls).
  let hf = max(0.0, max(h, hn) - max(H, Hn));
  if (hf <= 1e-5) { return 0.0; }
  let damp = 1.0 / (1.0 + P.dt * (P.viscosity + P.friction / max(hf, 0.004)));
  return max(0.0, (f0 + P.dt * P.g * hf * (h - hn)) * damp);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = i32(P.n);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= n || y >= n) { return; }
  let i = u32(y * n + x);
  let g = ground[i];
  let d = water[i].x;
  let H = g.x + g.y;
  let h = H + d;
  let f0 = flux[i];
  var f = vec4f(
    faceFlux(f0.x, h, H, x - 1, y),
    faceFlux(f0.y, h, H, x + 1, y),
    faceFlux(f0.z, h, H, x, y - 1),
    faceFlux(f0.w, h, H, x, y + 1),
  );
  // Never drain more water than the cell holds.
  let total = (f.x + f.y + f.z + f.w) * P.dt;
  let vol = d * P.dx * P.dx;
  if (total > vol && total > 0.0) { f *= vol / total; }
  flux[i] = f;
}
