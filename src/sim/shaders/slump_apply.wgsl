// Granular avalanching, pass 2 (gather): exact mass conservation, moving moisture with the sand.
@group(0) @binding(1) var<storage, read> ground: array<vec4f>;
@group(0) @binding(2) var<storage, read> out0: array<vec4f>;
@group(0) @binding(3) var<storage, read> out1: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> groundOut: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> water: array<vec4f>;

var<private> inSum: f32 = 0.0;
var<private> inM: f32 = 0.0;

fn gather(x: i32, y: i32, amount: f32) {
  if (amount > 0.0) {
    inSum += amount;
    inM += amount * ground[cidx(x, y)].z;
  }
}

fn o0At(x: i32, y: i32) -> vec4f {
  if (!inside(x, y)) { return vec4f(0.0); }
  return out0[cidx(x, y)];
}
fn o1At(x: i32, y: i32) -> vec4f {
  if (!inside(x, y)) { return vec4f(0.0); }
  return out1[cidx(x, y)];
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = i32(P.n);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= n || y >= n) { return; }
  let i = u32(y * n + x);
  let g = ground[i];
  let mine = dot(out0[i], vec4f(1.0)) + dot(out1[i], vec4f(1.0));

  gather(x - 1, y, o0At(x - 1, y).y);
  gather(x + 1, y, o0At(x + 1, y).x);
  gather(x, y - 1, o0At(x, y - 1).w);
  gather(x, y + 1, o0At(x, y + 1).z);
  gather(x - 1, y - 1, o1At(x - 1, y - 1).w);
  gather(x + 1, y - 1, o1At(x + 1, y - 1).z);
  gather(x - 1, y + 1, o1At(x - 1, y + 1).y);
  gather(x + 1, y + 1, o1At(x + 1, y + 1).x);

  let rem = max(g.y - mine, 0.0);
  let Snew = rem + inSum;
  var M = g.z;
  var C = g.w;
  if (inSum > 1e-7) {
    let wOld = min(rem, LAYER);
    M = (g.z * wOld + inM) / (wOld + inSum);
    C = g.w * wOld / (wOld + inSum);
  }
  groundOut[i] = vec4f(g.x, Snew, M, C);

  // Sand moving in/out under water displaces it, keeping the free surface level.
  var w = water[i];
  if (w.x > 0.0) {
    w.x = max(0.0, w.x - (Snew - g.y));
    water[i] = w;
  }
}
