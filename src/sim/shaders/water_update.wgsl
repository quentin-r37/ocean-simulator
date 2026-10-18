@group(0) @binding(1) var<storage, read> ground: array<vec4f>;
@group(0) @binding(2) var<storage, read> flux: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> water: array<vec4f>;

fn fluxAt(x: i32, y: i32) -> vec4f {
  if (!inside(x, y)) { return vec4f(0.0); }
  return flux[cidx(x, y)];
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = i32(P.n);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= n || y >= n) { return; }
  let i = u32(y * n + x);
  let f = flux[i];
  let fl = fluxAt(x - 1, y);
  let fr = fluxAt(x + 1, y);
  let fb = fluxAt(x, y - 1);
  let ft = fluxAt(x, y + 1);
  let inflow = fl.y + fr.x + fb.w + ft.z;
  let outflow = f.x + f.y + f.z + f.w;
  let w = water[i];
  let d1 = w.x;
  var d2 = max(0.0, d1 + P.dt * (inflow - outflow) / (P.dx * P.dx));

  // Depth-averaged velocity from the discharge through the cell.
  let dbar = 0.5 * (d1 + d2);
  let qx = 0.5 * (fl.y - f.x + f.y - fr.x);
  let qz = 0.5 * (fb.w - f.z + f.w - ft.z);
  var v = vec2f(0.0);
  if (dbar > 0.003) { v = vec2f(qx, qz) / (P.dx * dbar); }
  // Thin films cannot carry more than a few times the long-wave celerity.
  let vmax = min(5.0, 2.0 * sqrt(P.g * max(dbar, 0.003)));
  let sp = length(v);
  if (sp > vmax) { v *= vmax / sp; }

  // Wave-maker / absorbing relaxation zone along the open-sea edge (+z).
  let s0 = f32(n) - P.spongeCells;
  if (f32(y) > s0) {
    let s = (f32(y) - s0) / P.spongeCells;
    let g = ground[i];
    let H = g.x + g.y;
    let p = vec2f((f32(x) + 0.5) * P.dx, (f32(y) + 0.5) * P.dx);
    let eta = waveEta(p, P.waveTime, P.waveAmp, P.wavePeriod, P.boundaryDepth) + tsunamiEta(p.y, P.tsunamiFront, P.tsunamiAmp);
    let tgt = max(P.seaLevel + eta - H, 0.0);
    d2 = mix(d2, tgt, clamp(s * s * P.dt * 40.0, 0.0, 1.0));
    v *= 1.0 - clamp(s * s * P.dt * 10.0, 0.0, 1.0);
  }
  water[i] = vec4f(d2, sp, v.x, v.y);
}
