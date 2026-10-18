// Shovel & bucket. Runs as ONE workgroup over a 128×128-cell window centred on the aimed point,
// so every transfer between the terrain and the tool inventory is exactly volume-conserving.
struct ToolU {
  mode: u32, n: u32, frame: u32, moldType: u32,
  dx: f32, dt: f32, seaLevel: f32, radius: f32,
  shovelCap: f32, fillCap: f32, rBase: f32, rTop: f32,
  moldH: f32, merlon: f32, halfLen: f32, halfWBase: f32,
  halfWTop: f32, moldAngle: f32, targetH: f32, digRate: f32,
  fillRate: f32, scale: f32, _p1: f32, _p2: f32,
}
struct Inv {
  shovelSand: f32, shovelM: f32, bucketSand: f32, bucketM: f32,
  bucketWater: f32, flips: f32, lastTaken: f32, _p: f32,
}
@group(0) @binding(0) var<uniform> U: ToolU;
@group(0) @binding(1) var<storage, read_write> ground: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> water: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> inv: Inv;
@group(0) @binding(4) var<storage, read> hit: array<vec4f, 3>;

const MODE_DIG: u32 = 1u;
const MODE_DUMP: u32 = 2u;
const MODE_PAT: u32 = 3u;
const MODE_FILL: u32 = 4u;
const MODE_FLIP: u32 = 5u;
const MODE_POUR: u32 = 6u;
const MODE_CARVE: u32 = 7u;
const MODE_SMOOTH: u32 = 8u;
const MODE_FLATTEN: u32 = 9u;
const WIN: i32 = 128;
// Cells per thread side (WIN / 16) and per thread.
const CPS: i32 = 8;
const CPT: i32 = 64;
const LAYER: f32 = 0.06;
// The trowel keeps working when the shovel is full: its shavings may overfill it this much.
const TROWEL_SPILL: f32 = 10.0;

var<workgroup> red: array<f32, 256>;
var<private> origin: vec2i;
var<private> center: vec2f;
var<private> lid2: vec2i;

fn wsum(li: u32, v: f32) -> f32 {
  red[li] = v;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { red[li] += red[li + s]; }
    workgroupBarrier();
  }
  let r = red[0];
  workgroupBarrier();
  return r;
}

fn wmax(li: u32, v: f32) -> f32 {
  red[li] = v;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { red[li] = max(red[li], red[li + s]); }
    workgroupBarrier();
  }
  let r = red[0];
  workgroupBarrier();
  return r;
}

// k-th cell (0..CPT-1) handled by this thread; returns (x, y) or (-1, -1) if outside the domain.
fn cellK(k: i32) -> vec2i {
  let c = origin + vec2i(lid2.x * CPS + k % CPS, lid2.y * CPS + k / CPS);
  let n = i32(U.n);
  if (c.x < 0 || c.y < 0 || c.x >= n || c.y >= n) { return vec2i(-1); }
  return c;
}
fn idx(c: vec2i) -> u32 { return u32(c.y * i32(U.n) + c.x); }
fn dist(c: vec2i) -> f32 { return length(vec2f(c) - center) * U.dx; }
fn gauss(r: f32, R: f32) -> f32 {
  if (r >= R) { return 0.0; }
  let q = r / R;
  return exp(-3.0 * q * q) - exp(-3.0);
}
fn moistEq(above: f32) -> f32 { return select(0.8 * (1.0 - smoothstep(0.03, 0.9, above)), 1.0, above < 0.03); }

// Removes up to `budget` m³ of sand (gaussian footprint of radius R), returns (m³ taken, Σ m³·moisture).
fn takeSand(li: u32, R: f32, budget: f32) -> vec2f {
  var sw = 0.0;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) { sw += gauss(dist(c), R); }
  }
  let SW = max(wsum(li, sw), 1e-6);
  let b = budget / (U.dx * U.dx);
  var tw = 0.0;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) { tw += min(ground[idx(c)].y, b * gauss(dist(c), R) / SW); }
  }
  let TW = wsum(li, tw);
  let scale = select(0.0, min(1.0, b / TW), TW > 1e-9);
  var tm = 0.0;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) {
      let i = idx(c);
      var g = ground[i];
      let take = min(g.y, b * gauss(dist(c), R) / SW) * scale;
      if (take > 0.0) {
        tm += take * g.z;
        g.y -= take;
        // Freshly exposed sand below the dry crust is damper (water table below).
        g.z = max(g.z, moistEq(g.x + g.y - U.seaLevel));
        ground[i] = g;
        var w = water[i];
        if (w.x > 0.001) { w.x += take; water[i] = w; }
      }
    }
  }
  let TM = wsum(li, tm);
  return vec2f(TW * scale, TM) * U.dx * U.dx;
}

// Removes up to `budget` m³ of water.
fn takeWater(li: u32, R: f32, budget: f32) -> f32 {
  var sw = 0.0;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) { sw += gauss(dist(c), R); }
  }
  let SW = max(wsum(li, sw), 1e-6);
  let b = budget / (U.dx * U.dx);
  var tw = 0.0;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) { tw += min(water[idx(c)].x, b * gauss(dist(c), R) / SW); }
  }
  let TW = wsum(li, tw);
  let scale = select(0.0, min(1.0, b / TW), TW > 1e-9);
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) {
      let i = idx(c);
      var w = water[i];
      let take = min(w.x, b * gauss(dist(c), R) / SW) * scale;
      w.x -= take;
      water[i] = w;
    }
  }
  return TW * scale * U.dx * U.dx;
}

// Adds `vol` m³ of loose sand with moisture `m` (gaussian footprint).
fn depositSand(li: u32, R: f32, vol: f32, m: f32) {
  var sw = 0.0;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) { sw += gauss(dist(c), R); }
  }
  let SW = max(wsum(li, sw), 1e-6);
  let b = vol / (U.dx * U.dx);
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) {
      let add = b * gauss(dist(c), R) / SW;
      if (add > 0.0) {
        let i = idx(c);
        var g = ground[i];
        let wOld = min(g.y, LAYER);
        g.z = (g.z * wOld + m * add) / (wOld + add);
        g.w = g.w * wOld / (wOld + add);
        g.y += add;
        ground[i] = g;
        var w = water[i];
        if (w.x > 0.0) { w.x = max(0.0, w.x - add); water[i] = w; }
      }
    }
  }
}

// Spoil heap: adds `vol` m³ of loose sand in a ring around the footprint (radius R).
fn ringW(r: f32, R: f32) -> f32 {
  let q = (r - R * 1.1) / (R * 0.32);
  if (abs(q) > 2.0) { return 0.0; }
  return exp(-q * q) - exp(-4.0);
}
fn depositRing(li: u32, R: f32, vol: f32, m: f32) {
  var sw = 0.0;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) { sw += ringW(dist(c), R); }
  }
  let SW = max(wsum(li, sw), 1e-6);
  let b = vol / (U.dx * U.dx);
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) {
      let add = b * ringW(dist(c), R) / SW;
      if (add > 0.0) {
        let i = idx(c);
        var g = ground[i];
        let wOld = min(g.y, LAYER);
        g.z = (g.z * wOld + m * add) / (wOld + add);
        g.w = g.w * wOld / (wOld + add);
        g.y += add;
        ground[i] = g;
        var w = water[i];
        if (w.x > 0.0) { w.x = max(0.0, w.x - add); water[i] = w; }
      }
    }
  }
}

fn addWater(li: u32, R: f32, vol: f32) {
  var sw = 0.0;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) { sw += gauss(dist(c), R); }
  }
  let SW = max(wsum(li, sw), 1e-6);
  let b = vol / (U.dx * U.dx);
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) {
      let i = idx(c);
      var w = water[i];
      w.x += b * gauss(dist(c), R) / SW;
      water[i] = w;
    }
  }
}

// Packability: damp sand can be compacted, dry or soaked sand much less.
fn packable(m: f32) -> f32 {
  return smoothstep(0.03, 0.15, m) * (1.0 - smoothstep(0.9, 1.0, m) * 0.7);
}

// Mass-conserving smoothing: sand moves from above the local mean to below it; also packs it.
fn smoothSand(li: u32, R: f32, rate: f32, compact: f32) {
  var sh = 0.0;
  var sw = 0.0;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) {
      let w = gauss(dist(c), R);
      let g = ground[idx(c)];
      sh += w * (g.x + g.y);
      sw += w;
    }
  }
  let SH = wsum(li, sh);
  let SW = wsum(li, sw);
  let mean = SH / max(SW, 1e-6);
  let g0 = gauss(0.0, R);
  var sa = 0.0;
  var sb = 0.0;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) {
      let w = gauss(dist(c), R) / g0;
      let g = ground[idx(c)];
      let H = g.x + g.y;
      sa += min(g.y, w * max(H - mean, 0.0));
      sb += w * max(mean - H, 0.0);
    }
  }
  let A = wsum(li, sa);
  let B = wsum(li, sb);
  let T = min(A, B) * clamp(rate * U.dt, 0.0, 0.5);
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) {
      let w = gauss(dist(c), R) / g0;
      if (w > 0.0) {
        let i = idx(c);
        var g = ground[i];
        let H = g.x + g.y;
        var delta = 0.0;
        if (A > 1e-9) { delta -= min(g.y, w * max(H - mean, 0.0)) * T / A; }
        if (B > 1e-9) { delta += w * max(mean - H, 0.0) * T / B; }
        g.y = max(g.y + delta, 0.0);
        g.w = min(1.0, g.w + compact * U.dt * w * packable(g.z));
        ground[i] = g;
        var wt = water[i];
        if (wt.x > 0.0) { wt.x = max(0.0, wt.x - delta); water[i] = wt; }
      }
    }
  }
}

// Trowel tip: shaves sand off (into the shovel inventory, up to `room` m³). Returns (m³, Σ m³·moisture).
fn carve(li: u32, R: f32, depthRate: f32, room: f32) -> vec2f {
  let g0 = gauss(0.0, R);
  var tw = 0.0;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) { tw += min(ground[idx(c)].y, gauss(dist(c), R) / g0 * depthRate * U.dt); }
  }
  let TW = wsum(li, tw);
  let scale = select(0.0, min(1.0, room / (U.dx * U.dx) / TW), TW > 1e-9);
  var tm = 0.0;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) {
      let i = idx(c);
      var g = ground[i];
      let take = min(g.y, gauss(dist(c), R) / g0 * depthRate * U.dt) * scale;
      if (take > 0.0) {
        tm += take * g.z;
        g.y -= take;
        // A clean cut leaves a firm face.
        g.w = min(1.0, g.w + 0.5 * packable(g.z) * take / max(depthRate * U.dt, 1e-6));
        ground[i] = g;
        var wt = water[i];
        if (wt.x > 0.001) { wt.x += take; water[i] = wt; }
      }
    }
  }
  let TM = wsum(li, tm);
  return vec2f(TW * scale, TM) * U.dx * U.dx;
}

// Trowel flat: levels the surface to `target` (cuts above into the inventory, fills below from it).
// Returns (net m³ added to the inventory, Σ m³·moisture removed).
fn flatten(li: u32, R: f32, goal: f32, rate: f32, inSand: f32, inM: f32) -> vec2f {
  let g0 = gauss(0.0, R);
  var sr = 0.0;
  var sn = 0.0;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) {
      let w = gauss(dist(c), R) / g0;
      let g = ground[idx(c)];
      let diff = g.x + g.y - goal;
      sr += select(0.0, min(g.y, min(diff, rate * U.dt * w)), diff > 0.0);
      sn += select(0.0, min(-diff, rate * U.dt * w), diff < 0.0);
    }
  }
  let RM = wsum(li, sr);
  let NE = wsum(li, sn);
  let a2 = U.dx * U.dx;
  let filled = min(NE, inSand / a2 + RM);
  let fillScale = select(0.0, filled / NE, NE > 1e-9);
  var remScale = 1.0;
  let cap = U.shovelCap * TROWEL_SPILL;
  if (inSand + (RM - filled) * a2 > cap && RM > 1e-9) {
    remScale = clamp(((cap - inSand) / a2 + filled) / RM, 0.0, 1.0);
  }
  var tm = 0.0;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) {
      let w = gauss(dist(c), R) / g0;
      if (w > 0.0) {
        let i = idx(c);
        var g = ground[i];
        let diff = g.x + g.y - goal;
        var delta = 0.0;
        if (diff > 0.0) {
          let rem = min(g.y, min(diff, rate * U.dt * w)) * remScale;
          tm += rem * g.z;
          delta = -rem;
        } else if (diff < 0.0) {
          let add = min(-diff, rate * U.dt * w) * fillScale;
          let wOld = min(g.y, LAYER);
          g.z = (g.z * wOld + inM * add) / max(wOld + add, 1e-6);
          delta = add;
        }
        g.y = max(g.y + delta, 0.0);
        g.w = min(1.0, g.w + 2.0 * U.dt * w * packable(g.z));
        ground[i] = g;
        var wt = water[i];
        if (wt.x > 0.0) { wt.x = max(0.0, wt.x - delta); water[i] = wt; }
      }
    }
  }
  let TM = wsum(li, tm);
  return vec2f((RM * remScale - filled) * a2, TM * a2);
}

// Footprint of the active mould at cell c: (inside, body shape 0..1, merlon mask).
fn moldShape(c: vec2i) -> vec3f {
  let d = (vec2f(c) - center) * U.dx;
  if (U.moldType == 2u) {
    let ca = cos(U.moldAngle);
    let sa = sin(U.moldAngle);
    let u = d.x * ca + d.y * sa;
    let v = -d.x * sa + d.y * ca;
    if (abs(u) > U.halfLen || abs(v) > U.halfWBase) { return vec3f(0.0); }
    let tv = select(clamp((U.halfWBase - abs(v)) / max(U.halfWBase - U.halfWTop, 1e-4), 0.0, 1.0), 1.0, abs(v) <= U.halfWTop);
    let tu = clamp((U.halfLen - abs(u)) / (0.035 * U.scale), 0.0, 1.0);
    let shape = min(tv, tu);
    let m = select(0.0, 1.0, abs(v) <= U.halfWTop && fract(u / (0.16 * U.scale) + 0.25) < 0.5 && abs(u) < U.halfLen - 0.025 * U.scale);
    return vec3f(1.0, shape, m);
  }
  let r = length(d);
  if (r > U.rBase) { return vec3f(0.0); }
  let shape = select(clamp((U.rBase - r) / (U.rBase - U.rTop), 0.0, 1.0), 1.0, r <= U.rTop);
  var m = 0.0;
  if (U.moldType == 1u && r <= U.rTop && r >= U.rTop - 0.08 * U.scale) {
    let a = atan2(d.y, d.x);
    if (fract(a / 6.2831853 * 6.0) < 0.5) { m = 1.0; }
  }
  return vec3f(1.0, shape, m);
}

// Turns the mould over: a packed body (+ merlons) resting on the highest point of its footprint.
fn flip(li: u32, gate: f32) {
  var hm = -1e9;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0 && moldShape(c).x > 0.0) {
      let g = ground[idx(c)];
      hm = max(hm, g.x + g.y);
    }
  }
  let Hmax = wmax(li, hm);
  var gsum = 0.0;
  var ssum = 0.0;
  var msum = 0.0;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) {
      let ms = moldShape(c);
      if (ms.x > 0.0) {
        let g = ground[idx(c)];
        gsum += Hmax - (g.x + g.y);
        ssum += ms.y;
        msum += ms.z;
      }
    }
  }
  let G = wsum(li, gsum);
  let Ssh = max(wsum(li, ssum), 1e-6);
  let Sm = wsum(li, msum);
  let vol = inv.bucketSand / (U.dx * U.dx) * gate;
  var fillScale = 1.0;
  var h = 0.0;
  var mScale = 0.0;
  if (vol <= G) {
    fillScale = select(0.0, vol / G, G > 1e-9);
  } else {
    let rest = vol - G;
    let mv = U.merlon * Sm;
    if (rest < mv) {
      mScale = rest / mv;
    } else {
      mScale = select(0.0, 1.0, Sm > 0.0);
      h = min((rest - mv) / Ssh, U.moldH * 1.03);
    }
  }
  let m = inv.bucketM;
  var used = 0.0;
  for (var k = 0; k < CPT; k++) {
    let c = cellK(k);
    if (c.x >= 0) {
      let ms = moldShape(c);
      if (ms.x > 0.0) {
        let i = idx(c);
        var g = ground[i];
        let add = max(Hmax - (g.x + g.y), 0.0) * fillScale + h * ms.y + U.merlon * mScale * ms.z;
        if (add > 0.0) {
          let wOld = min(g.y, LAYER);
          g.z = (g.z * wOld + m * add) / (wOld + add);
          g.w = (g.w * wOld + add) / (wOld + add);
          g.y += add;
          ground[i] = g;
          var w = water[i];
          if (w.x > 0.0) { w.x = max(0.0, w.x - add); water[i] = w; }
          used += add;
        }
      }
    }
  }
  let USED = wsum(li, used) * U.dx * U.dx;
  if (li == 0u && gate > 0.0) {
    inv.bucketSand = max(inv.bucketSand - USED, 0.0);
    if (inv.bucketSand < 1e-6) { inv.bucketSand = 0.0; }
    inv.flips += 1.0;
  }
}

@compute @workgroup_size(16, 16)
fn main(@builtin(local_invocation_id) lid: vec3u, @builtin(local_invocation_index) li: u32) {
  let h0 = hit[0];
  let h2 = hit[2];
  let valid = select(0.0, 1.0, h0.w > 0.5);
  center = vec2f(h0.x, h0.z) / U.dx - 0.5;
  origin = vec2i(floor(center)) - vec2i(WIN / 2);
  lid2 = vec2i(lid.xy);

  let I = inv;
  workgroupBarrier();

  if (U.mode == MODE_DIG) {
    // Digging never stalls: once the shovel is full, the spoil is thrown onto a rim around the hole.
    let room = max(U.shovelCap - I.shovelSand, 0.0);
    let r = takeSand(li, U.radius, U.digRate * U.dt * valid);
    let kept = min(r.x, room);
    let mAvg = select(0.0, r.y / r.x, r.x > 1e-9);
    depositRing(li, U.radius, r.x - kept, mAvg);
    if (li == 0u) {
      if (kept > 0.0) {
        let total = I.shovelSand + kept;
        inv.shovelM = (I.shovelM * I.shovelSand + kept * mAvg) / total;
        inv.shovelSand = total;
      }
      inv.lastTaken = r.x;
    }
  } else if (U.mode == MODE_DUMP) {
    let vol = min(I.shovelSand, U.shovelCap / 0.3 * U.dt) * valid;
    depositSand(li, U.radius * 0.85, vol, I.shovelM);
    if (li == 0u) { inv.shovelSand = max(I.shovelSand - vol, 0.0); }
  } else if (U.mode == MODE_PAT) {
    smoothSand(li, U.radius, 9.0 * valid, 5.0);
  } else if (U.mode == MODE_FILL) {
    // A bucket holds either sand or water; an empty one takes whatever it is dipped into.
    let waterMode = I.bucketWater > 1e-6 || (I.bucketSand <= 1e-6 && h2.x > 0.025);
    let sandGate = select(valid, 0.0, waterMode);
    let waterGate = select(0.0, valid, waterMode);
    let rate = U.fillRate * U.dt;
    let rs = takeSand(li, U.radius, min(max(U.fillCap - I.bucketSand, 0.0), rate) * sandGate);
    let rw = takeWater(li, U.radius, min(max(U.fillCap - I.bucketWater, 0.0), rate * 1.5) * waterGate);
    if (li == 0u) {
      if (rs.x > 0.0) {
        let total = I.bucketSand + rs.x;
        inv.bucketM = (I.bucketM * I.bucketSand + rs.y) / total;
        inv.bucketSand = total;
      }
      inv.bucketWater = I.bucketWater + rw;
    }
  } else if (U.mode == MODE_FLIP) {
    flip(li, valid * select(0.0, 1.0, I.bucketSand > 1e-6));
  } else if (U.mode == MODE_POUR) {
    // A full bucket empties in under a second (same pace as filling it).
    let vol = min(I.bucketWater, U.fillRate * 0.6 * U.dt) * valid;
    addWater(li, 0.15 * U.scale, vol);
    if (li == 0u) { inv.bucketWater = max(I.bucketWater - vol, 0.0); }
  } else if (U.mode == MODE_CARVE) {
    let room = max(U.shovelCap * TROWEL_SPILL - I.shovelSand, 0.0);
    let r = carve(li, U.radius, 0.9 * U.scale, room * valid);
    if (li == 0u && r.x > 0.0) {
      let total = I.shovelSand + r.x;
      inv.shovelM = (I.shovelM * I.shovelSand + r.y) / total;
      inv.shovelSand = total;
    }
  } else if (U.mode == MODE_SMOOTH) {
    smoothSand(li, U.radius, 12.0 * valid, 2.5);
  } else if (U.mode == MODE_FLATTEN) {
    let r = flatten(li, U.radius, U.targetH, 1.2 * valid, I.shovelSand, I.shovelM);
    if (li == 0u) {
      let total = max(I.shovelSand + r.x, 0.0);
      if (r.x > 0.0) { inv.shovelM = (I.shovelM * I.shovelSand + r.y) / max(total, 1e-9); }
      inv.shovelSand = total;
    }
  }
}
