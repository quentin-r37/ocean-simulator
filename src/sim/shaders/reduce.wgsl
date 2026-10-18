// Partial sums of the total sand volume (bed + suspended), for the conservation readout.
@group(0) @binding(1) var<storage, read> ground: array<vec4f>;
@group(0) @binding(2) var<storage, read> aux: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> partial: array<f32>;

var<workgroup> sh: array<f32, 256>;

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3u) {
  let total = P.n * P.n;
  var s = 0.0;
  for (var k = 0u; k < 16u; k++) {
    let idx = wg.x * 4096u + k * 256u + li;
    if (idx < total) { s += ground[idx].y + aux[idx].x; }
  }
  sh[li] = s;
  workgroupBarrier();
  for (var st = 128u; st > 0u; st >>= 1u) {
    if (li < st) { sh[li] += sh[li + st]; }
    workgroupBarrier();
  }
  if (li == 0u) { partial[wg.x] = sh[0]; }
}
