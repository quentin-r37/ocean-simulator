// Granular avalanching, pass 1: each column computes how much sand it sheds to each of its
// 8 neighbours where the local slope exceeds the angle of repose.
@group(0) @binding(1) var<storage, read> ground: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> out0: array<vec4f>; // -x, +x, -z, +z
@group(0) @binding(3) var<storage, read_write> out1: array<vec4f>; // (-1,-1), (+1,-1), (-1,+1), (+1,+1)

const OFFS = array<vec2i, 8>(
  vec2i(-1, 0), vec2i(1, 0), vec2i(0, -1), vec2i(0, 1),
  vec2i(-1, -1), vec2i(1, -1), vec2i(-1, 1), vec2i(1, 1),
);

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = i32(P.n);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= n || y >= n) { return; }
  let i = u32(y * n + x);
  let g = ground[i];
  let H = g.x + g.y;
  // Slenderness: packing only holds a steep face up when the column belongs to a solid mass.
  // Count the columns around (5×5) standing about as high: walls, towers and merlons have plenty,
  // a thin spike left over by the surf or a sharp corner does not, and crumbles.
  var mass = 0.0;
  for (var oy = -2; oy <= 2; oy++) {
    for (var ox = -2; ox <= 2; ox++) {
      if ((ox != 0 || oy != 0) && inside(x + ox, y + oy)) {
        let gm = ground[cidx(x + ox, y + oy)];
        if (gm.x + gm.y >= H - 0.05) { mass += 1.0; }
      }
    }
  }
  let C = g.w * smoothstep(5.0, 12.0, mass);
  let t = critTan(g.z, C, hash11(i));
  let hc = cohHeight(g.z, C);
  var offs = OFFS;
  var ex: array<f32, 8>;
  var sum = 0.0;
  var mx = 0.0;
  for (var k = 0; k < 8; k++) {
    let o = offs[k];
    var e = 0.0;
    if (inside(x + o.x, y + o.y)) {
      let gn = ground[cidx(x + o.x, y + o.y)];
      let dist = select(P.dx, P.dx * 1.4142136, k >= 4);
      e = max(0.0, H - (gn.x + gn.y) - t * dist - hc);
    }
    ex[k] = e;
    sum += e;
    mx = max(mx, e);
  }
  var o0 = vec4f(0.0);
  var o1 = vec4f(0.0);
  if (sum > 0.0 && g.y > 0.0) {
    let rate = clamp(P.slumpRate * P.dt, 0.0, 0.5);
    let total = min(g.y, 0.5 * mx * rate);
    let s = total / sum;
    o0 = vec4f(ex[0], ex[1], ex[2], ex[3]) * s;
    o1 = vec4f(ex[4], ex[5], ex[6], ex[7]) * s;
  }
  out0[i] = o0;
  out1[i] = o1;
}
