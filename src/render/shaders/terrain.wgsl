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
  let nrm = normalize(vec3f(hl - hr, 2.0 * dx * f32(s), hb - ht));

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
  o.wp = vec3f(edgeCoord(gx, n, dx), H, edgeCoord(gy, n, dx));
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

@fragment
fn fs_main(in: VOut) -> @location(0) vec4f {
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
  let flat = smoothstep(0.85, 0.98, n.y);
  let bedPh = dot(wp.xz, vec2f(0.3, 0.95)) * (6.2831 / 0.13) + fbm(wp.xz * 1.3) * 2.5;
  let pert = vec2f(0.3, 0.95) * cos(bedPh) * underwater * flat * 0.18;
  n = normalize(n + vec3f(-pert.x, 0.0, -pert.y));

  // ----- Albedo: pale cream sand with scattered dark pebbles -----
  var alb = vec3f(0.93, 0.80, 0.53);
  let mott = fbm(wp.xz * 0.9) * 0.6 + fbm(wp.xz * 6.0) * 0.4;
  alb *= 0.95 + 0.08 * mott;
  // Pebbles: a few per square metre, 1-3 cm.
  let pc = floor(wp.xz * 7.0);
  let ph = hash32(pc);
  if (ph.z > 0.72) {
    let ctr = (pc + 0.2 + ph.xy * 0.6) / 7.0;
    let rad = 0.008 + 0.02 * fract(ph.z * 13.7);
    let dd = length(wp.xz - ctr);
    let k = 1.0 - smoothstep(rad * 0.75, rad, dd);
    alb = mix(alb, vec3f(0.11, 0.1, 0.09) * (0.8 + 0.5 * ph.x), k);
  }
  // Fine speckles.
  let sp = hash12(floor(wp.xz * 45.0));
  alb *= select(1.0, 0.55, sp > 0.985);
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
  let nl = clamp((dot(n, Ld) + 0.15) / 1.15, 0.0, 1.0);
  let sun = sky.sun.rgb;
  var col = alb / PI * (sun * nl * shadow + ambientIrr(sky, n) * (0.4 + 0.6 * ao) * 1.2);

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
