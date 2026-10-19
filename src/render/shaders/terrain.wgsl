// Sand rendering: simulated domain (vertex-pulled heightfield) + far-field beach & dunes.
@group(0) @binding(1) var<storage, read> ground: array<vec4f>;
@group(0) @binding(2) var<storage, read> water: array<vec4f>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) nrm: vec3f,
  @location(2) mat: vec4f, // moisture, compaction, water depth, ambient occlusion
  @location(3) sand: f32, // sand thickness (0 = bare boulder)
}

fn gidx(x: i32, y: i32) -> u32 {
  let n = i32(cam.grid.x);
  return u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1));
}

fn hAt(x: i32, y: i32) -> f32 {
  let g = ground[gidx(x, y)];
  return g.x + g.y;
}

// 5×5 heights around the vertex being built (stride apart), indexed from -2 to 2.
var<private> nb: array<f32, 25>;
fn nbH(k: i32, j: i32) -> f32 { return nb[(j + 2) * 5 + k + 2]; }
// Sobel gradient at a neighbour (|k|, |j| <= 1), in height per stride.
fn nbGrad(k: i32, j: i32) -> vec2f {
  let gx = (nbH(k + 1, j - 1) + 2.0 * nbH(k + 1, j) + nbH(k + 1, j + 1)) - (nbH(k - 1, j - 1) + 2.0 * nbH(k - 1, j) + nbH(k - 1, j + 1));
  let gy = (nbH(k - 1, j + 1) + 2.0 * nbH(k, j + 1) + nbH(k + 1, j + 1)) - (nbH(k - 1, j - 1) + 2.0 * nbH(k, j - 1) + nbH(k + 1, j - 1));
  return vec2f(gx, gy) / 8.0;
}

// Steep faces (moulded towers, walls) span only a cell or two, so drawn straight off the grid
// they follow the cell staircase: jagged rim, zigzag creases down the sides. The cells on the
// face hold exact samples of its profile, but the flat top and the foot are clamped and have
// lost where the face starts. So a vertex at the top or the foot of its 3×3 slides along the
// slope to where a line fitted through the unclamped heights of its 5×5 reaches its height:
// a fresh round tower reads as a clean truncated cone. Face vertices and smooth terrain (whose
// crests have no steep line to extrapolate) stay put. Returns the shift in world units.
const CLAMP_EPS: f32 = 0.02; // m: closer than this to its local extreme, a height counts as clamped
fn contourShift(H: f32, fs: f32) -> vec2f {
  var lo3 = H;
  var hi3 = H;
  for (var j = -1; j <= 1; j++) {
    for (var k = -1; k <= 1; k++) {
      lo3 = min(lo3, nbH(k, j));
      hi3 = max(hi3, nbH(k, j));
    }
  }
  let clamped = 1.0 - smoothstep(0.0, CLAMP_EPS, min(hi3 - H, H - lo3));
  if (clamped <= 0.0) { return vec2f(0.0); }
  var lo = H;
  var hi = H;
  for (var j = -2; j <= 2; j++) {
    for (var k = -2; k <= 2; k++) {
      lo = min(lo, nbH(k, j));
      hi = max(hi, nbH(k, j));
    }
  }
  // Too little relief around for any slope steep enough to act on (most of the beach).
  if (hi - lo < 0.8 * fs) { return vec2f(0.0); }
  // Uphill direction from the gradient averaged over the 3×3 (a single cell's follows the staircase).
  var gavg = vec2f(0.0);
  for (var j = -1; j <= 1; j++) {
    for (var k = -1; k <= 1; k++) { gavg += nbGrad(k, j) * f32((2 - abs(k)) * (2 - abs(j))); }
  }
  gavg /= 16.0;
  let L = length(gavg);
  if (L < 1e-6) { return vec2f(0.0); }
  let dir = gavg / L;
  // Weighted line h = hm + b (t - tm) along `dir` (t in strides), through the unclamped samples
  // close to the vertex's own slope line; the averaged gradient is a weak prior on the slope.
  // The slide stops short of the nearest unclamped neighbour on its way (none: no slide that
  // way), so the flat ground around a foot is not dragged in and folded over it.
  var sw = 0.0;
  var st = 0.0;
  var sh = 0.0;
  var tUp = 0.0;
  var tDown = 0.0;
  for (var j = -2; j <= 2; j++) {
    for (var k = -2; k <= 2; k++) {
      let h = nbH(k, j);
      let p = vec2f(f32(k), f32(j));
      let u = dot(p, vec2f(-dir.y, dir.x));
      let t = dot(p, dir);
      let free = smoothstep(0.0, CLAMP_EPS, min(hi - h, h - lo));
      let w = free * exp(-u * u);
      sw += w;
      st += w * t;
      sh += w * h;
      if (abs(k) <= 1 && abs(j) <= 1 && free > 0.25) {
        if (t > 0.05) { tUp = select(t, min(tUp, t), tUp > 0.0); }
        if (t < -0.05) { tDown = select(t, max(tDown, t), tDown < 0.0); }
      }
    }
  }
  if (sw < 1e-4) { return vec2f(0.0); }
  let tm = st / sw;
  let hm = sh / sw;
  var num = 0.02 * L;
  var den = 0.02;
  for (var j = -2; j <= 2; j++) {
    for (var k = -2; k <= 2; k++) {
      let h = nbH(k, j);
      let p = vec2f(f32(k), f32(j));
      let u = dot(p, vec2f(-dir.y, dir.x));
      let w = smoothstep(0.0, CLAMP_EPS, min(hi - h, h - lo)) * exp(-u * u);
      let dt = dot(p, dir) - tm;
      num += w * dt * (h - hm);
      den += w * dt * dt;
    }
  }
  let b = num / den;
  let steep = smoothstep(0.8, 2.0, b / fs);
  if (steep <= 0.0) { return vec2f(0.0); }
  // (only 3/4 of the way there: that neighbour is rarely right on the slide line)
  let t = clamp(tm + (H - hm) / b, 0.75 * tDown, 0.75 * tUp);
  return dir * (t * fs * steep * clamped * smoothstep(0.0, 0.5, sw));
}

// Cell centres, except the outermost row/column which is stretched to the domain border.
fn edgeCoord(g: i32, n: i32, dx: f32) -> f32 {
  if (g == 0) { return 0.0; }
  if (g == n - 1) { return f32(n) * dx; }
  return (f32(g) + 0.5) * dx;
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) row: u32) -> VOut {
  let n = i32(cam.grid.x);
  let dx = cam.grid.y;
  let stride = i32(cam.grid.w);
  let gx = min(i32(vi / 2u) * stride, n - 1);
  let gy = min((i32(row) + i32(vi % 2u)) * stride, n - 1);
  let i = gidx(gx, gy);
  let g = ground[i];
  let H = g.x + g.y;
  let s = max(stride, 1);
  let hl = hAt(gx - s, gy);
  let hr = hAt(gx + s, gy);
  let hb = hAt(gx, gy - s);
  let ht = hAt(gx, gy + s);
  var nrm = normalize(vec3f(hl - hr, 2.0 * dx * f32(s), hb - ht));

  var shift = vec2f(0.0);
  if (gx > 0 && gy > 0 && gx < n - 1 && gy < n - 1) {
    for (var j = -2; j <= 2; j++) {
      for (var k = -2; k <= 2; k++) { nb[(j + 2) * 5 + k + 2] = hAt(gx + k * s, gy + j * s); }
    }
    let fs = dx * f32(s);
    shift = contourShift(H, fs);
    // On steep faces, the normal's heading comes from the 3×3-averaged gradient (the fragment
    // shader keeps it and takes the tilt from the triangle itself).
    var gavg = vec2f(0.0);
    for (var j = -1; j <= 1; j++) {
      for (var k = -1; k <= 1; k++) { gavg += nbGrad(k, j) * f32((2 - abs(k)) * (2 - abs(j))); }
    }
    gavg /= 16.0 * fs;
    nrm = normalize(mix(nrm, normalize(vec3f(-gavg.x, 1.0, -gavg.y)), smoothstep(0.8, 2.0, length(gavg))));
  }

  // Cheap heightfield ambient occlusion: how much the surroundings rise above this point.
  var occ = 0.0;
  for (var k = 0; k < 8; k++) {
    let a = f32(k) * 0.785398;
    let o = vec2f(cos(a), sin(a));
    let o1 = vec2i(round(o * 5.0));
    let o2 = vec2i(round(o * 16.0));
    occ += clamp((hAt(gx + o1.x, gy + o1.y) - H) / (5.0 * dx), 0.0, 1.0) * 0.6;
    occ += clamp((hAt(gx + o2.x, gy + o2.y) - H) / (16.0 * dx), 0.0, 1.0) * 0.4;
  }
  let ao = 1.0 - clamp(occ / 8.0, 0.0, 1.0) * 0.85;

  var o: VOut;
  o.wp = vec3f(edgeCoord(gx, n, dx) + shift.x, H, edgeCoord(gy, n, dx) + shift.y);
  o.pos = cam.viewProj * vec4f(o.wp, 1.0);
  o.nrm = nrm;
  o.mat = vec4f(g.z, g.w, water[i].x, ao);
  o.sand = g.y;
  return o;
}

// Caustic network: domain-warped ridged noise, two drifting layers. Returns [0, 1], mean ≈ 0.18.
fn causticLayer(p: vec2f, t: f32) -> f32 {
  let w = vec2f(vnoise(p * 0.8 + vec2f(t * 0.31, -t * 0.17)), vnoise(p * 0.8 + vec2f(-t * 0.23, t * 0.29) + 7.3));
  let q = p + w * 0.9;
  let r = 1.0 - abs(vnoise(q * 1.6 + vec2f(t * 0.12, t * 0.09)));
  return r * r * r * r * r;
}

fn causticPattern(p: vec2f, t: f32) -> f32 {
  return 0.5 * (causticLayer(p, t) + causticLayer(p * 1.37 + vec2f(3.1, 1.7), t * 1.13));
}

// Pebble/speckle layer on a plane. Returns (pebble coverage, pebble shade, speckle darkening).
fn pebbles(p: vec2f) -> vec3f {
  let pc = floor(p * 7.0);
  let ph = hash32(pc);
  var k = 0.0;
  if (ph.z > 0.72) {
    let ctr = (pc + 0.2 + ph.xy * 0.6) / 7.0;
    let rad = 0.008 + 0.02 * fract(ph.z * 13.7);
    k = 1.0 - smoothstep(rad * 0.75, rad, length(p - ctr));
  }
  let sp = hash12(floor(p * 45.0));
  return vec3f(k, 0.8 + 0.5 * ph.x, select(0.0, 0.45, sp > 0.985));
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4f {
  let facet = normalize(cross(dpdy(in.wp), dpdx(in.wp)));
  clipReflection(in.wp);
  let t = cam.camPos.w;
  let wp = in.wp;
  let V = normalize(cam.camPos.xyz - wp);
  let dist = length(cam.camPos.xyz - wp);
  let Ld = normalize(cam.sunDir.xyz);
  let M = clamp(in.mat.x, 0.0, 1.0);
  let C = clamp(in.mat.y, 0.0, 1.0);
  let d = in.mat.z;
  let ao = in.mat.w;
  let wet = smoothstep(0.08, 0.7, M);
  let underwater = smoothstep(0.002, 0.02, d);

  // ----- Normal: geometry + soft ripples on the submerged bed -----
  var n = normalize(in.nrm);
  // Around near-vertical faces, vertex normals smear the crease: the flat top and the ground at
  // the foot darken. There the tilt comes from the triangle itself (crisp rim and foot), the
  // heading from the smooth vertex normal (a round tower shades round, not in facets).
  let fN = select(-facet, facet, dot(facet, n) >= 0.0);
  let hd = select(fN.xz, n.xz, dot(n.xz, n.xz) > 1e-4);
  let fS = vec3f(normalize(hd) * length(fN.xz), fN.y).xzy;
  n = normalize(mix(n, select(fN, fS, fN.y < 0.9), 1.0 - smoothstep(0.35, 0.6, min(fN.y, n.y))));
  let flat = smoothstep(0.85, 0.98, n.y);
  let bedPh = dot(wp.xz, vec2f(0.3, 0.95)) * (6.2831 / 0.13) + fbm(wp.xz * 1.3) * 2.5;
  let pert = vec2f(0.3, 0.95) * cos(bedPh) * underwater * flat * 0.18;
  n = normalize(n + vec3f(-pert.x, 0.0, -pert.y));

  // ----- Albedo: pale cream sand with scattered dark pebbles -----
  var alb = vec3f(0.93, 0.80, 0.53);
  let mott = fbm(wp.xz * 0.9) * 0.6 + fbm(wp.xz * 6.0) * 0.4;
  alb *= 0.95 + 0.08 * mott;
  // Pebbles (a few per square metre, 1-3 cm) and fine speckles, projected triplanarly so they
  // stay round on the steep walls of moulded towers instead of smearing into vertical streaks.
  let tw = pow(abs(in.nrm), vec3f(4.0));
  let tws = tw / (tw.x + tw.y + tw.z);
  let pb = tws.x * pebbles(wp.zy) + tws.y * pebbles(wp.xz) + tws.z * pebbles(wp.xy + vec2f(31.0, 17.0));
  alb = mix(alb, vec3f(0.11, 0.1, 0.09) * pb.y, pb.x);
  alb *= 1.0 - pb.z;
  // Wet sand: darker, warmer.
  alb = mix(alb, alb * vec3f(0.62, 0.56, 0.47), wet);
  // Lagoon bed: tinted, with darker weed patches.
  let weed = smoothstep(0.15, 0.45, fbm(wp.xz * 0.9 + vec2f(5.0, 2.0))) * underwater;
  alb = mix(alb, vec3f(0.2, 0.28, 0.16), weed * 0.6);
  // Bare boulder surface.
  let bare = 1.0 - smoothstep(0.0, 0.02, in.sand);
  alb = mix(alb, vec3f(0.3, 0.28, 0.25) * (0.85 + 0.3 * mott), bare);

  // ----- Lighting -----
  let shadow = shadowAt(wp, in.nrm);
  // Near-Lambert terminator (a wide wrap would smear the core shadow away).
  let ndl = dot(n, Ld);
  let nl = clamp((ndl + 0.04) / 1.04, 0.0, 1.0);
  let sun = sky.sun.rgb;
  let fill = ambientIrr(sky, n) * (0.4 + 0.6 * ao) * 1.2 * (1.0 - 0.7 * coreShadow(ndl));
  var col = alb / PI * (sun * nl * shadow + fill) * (1.0 - 0.35 * turnShade(n, V));

  // Wet sheen in the swash zone.
  let pooled = smoothstep(-0.25, 0.35, fbm(wp.xz * 1.8 + vec2f(3.0, 1.0)));
  let film = clamp((smoothstep(0.9, 1.0, M) * pooled + smoothstep(0.0005, 0.004, d)) * (1.0 - underwater), 0.0, 1.0);
  if (film > 0.0) {
    let fr = fresnelSchlick(max(dot(n, V), 0.0), 0.02);
    col += skyRadiance(reflect(-V, n)) * fr * film * 0.5;
    col += sun * ggx(n, V, Ld, 0.15) * fr * max(dot(n, Ld), 0.0) * shadow * film;
  }

  // Caustics on the submerged bed (energy-conserving redistribution of the direct light).
  if (d > 0.003) {
    let ca = causticPattern(wp.xz * 2.6, t * 0.9);
    // Soft and only in the shallows: the light network blurs out within a few tens of cm.
    let k = smoothstep(0.003, 0.04, d) * (1.0 - smoothstep(0.12, 0.6, d));
    let mul = mix(1.0, 0.75 + 1.4 * ca, k);
    col += alb / PI * sun * nl * shadow * (mul - 1.0);
  }

  let dbg = i32(cam.misc.z);
  if (dbg == 8) { return vec4f(vec3f(shadow), 1.0); }
  if (dbg == 9 && d > 0.003) { return vec4f(vec3f(causticPattern(wp.xz * 2.6, t * 0.9)), 1.0); }
  if (dbg == 10) { return vec4f(n * 0.5 + 0.5, 1.0); }

  // Moisture debug overlay.
  if (cam.waves.w > 0.5) {
    let mc = mix(vec3f(0.9, 0.7, 0.2), vec3f(0.05, 0.25, 0.9), M);
    col = mix(col, mc * (sun * 0.05 + 0.2), 0.75) + vec3f(C * 0.3, 0.0, 0.0);
  }

  // Tool cursor (ring, or a rectangle for the wall mould).
  if (cam.cursor.w > 0.5 && cam.clip.z < 0.5) {
    let r = cam.cursor.z;
    let lw = max(0.006, dist * 0.0007);
    let rel = wp.xz - cam.cursor.xy;
    var dd = length(rel);
    var rr = r;
    if (cam.misc.w != 0.0) {
      // misc.w = wall half length (sign) / angle packed: angle in clip.w.
      let a = cam.clip.w;
      let u = abs(rel.x * cos(a) + rel.y * sin(a));
      let v = abs(-rel.x * sin(a) + rel.y * cos(a));
      dd = max(u / abs(cam.misc.w), v / r) ;
      rr = 1.0;
      let ring = smoothstep(rr - lw / r * 2.0, rr - lw / r, dd) * (1.0 - smoothstep(rr, rr + lw / r, dd));
      col = mix(col, vec3f(1.0, 0.95, 0.8) * (sun * 0.08 + 0.4), ring * 0.85);
    } else {
      let ring = smoothstep(rr - lw * 2.0, rr - lw, dd) * (1.0 - smoothstep(rr, rr + lw, dd));
      let tint = select(vec3f(1.0, 0.95, 0.8), vec3f(0.7, 0.95, 1.0), cam.misc.y > 0.5);
      col = mix(col, tint * (sun * 0.08 + 0.4), ring * 0.85);
    }
  }
  return vec4f(col, 1.0);
}
