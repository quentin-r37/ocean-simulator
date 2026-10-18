// Instanced props that follow the simulated sand / water surface.
struct Inst {
  a: vec4f, // x, y (absolute or offset), z, rotation
  b: vec4f, // scale xyz, seed
  c: vec4f, // kind, flag colour index, y mode, sway
}
@group(0) @binding(1) var<storage, read> ground: array<vec4f>;
@group(0) @binding(2) var<storage, read> water: array<vec4f>;
@group(0) @binding(12) var<storage, read> inst: array<Inst>;

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) col: vec3f,
}
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) nrm: vec3f,
  @location(2) col: vec3f,
  @location(3) preview: f32,
}

fn flagColor(i: f32) -> vec3f {
  if (i < 0.5) { return vec3f(0.85, 0.05, 0.04); }
  if (i < 1.5) { return vec3f(0.35, 0.06, 0.6); }
  if (i < 2.5) { return vec3f(0.04, 0.55, 0.25); }
  return vec3f(0.95, 0.75, 0.05);
}

@vertex
fn vs_main(v: VIn, @builtin(instance_index) ii: u32) -> VOut {
  let it = inst[ii];
  let t = cam.camPos.w;
  let seed = it.b.w;
  var lp = v.pos * it.b.xyz;
  let cloth = v.col.r > 0.99 && v.col.g < 0.01 && v.col.b > 0.99;
  let surf = sampleSurface(it.a.xz);
  let under = smoothstep(0.02, 0.1, surf.y);

  // Wind (dry land) or current (under water) bending, growing with height above the root.
  let sway = it.c.w;
  if (sway > 0.0 && !cloth) {
    let hgt = max(v.pos.y, 0.0);
    let speed = mix(1.9, 0.9, under);
    let ph = t * speed + seed * 40.0 + it.a.x * 0.7 + it.a.z * 0.5;
    let amt = sway * hgt * hgt * mix(0.9, 2.2, under);
    lp.x += (sin(ph) * 0.7 + sin(ph * 2.3) * 0.3) * amt;
    lp.z += cos(ph * 0.8) * amt * 0.6;
  }
  if (cloth) {
    let k = v.pos.x / 0.13;
    lp.z += sin(t * 7.0 + v.pos.x * 32.0 + seed * 10.0) * 0.018 * k;
    lp.y += sin(t * 5.0 + v.pos.x * 20.0) * 0.004 * k;
  }

  let cr = cos(it.a.w);
  let sr = sin(it.a.w);
  let wxz = vec2f(lp.x * cr - lp.z * sr, lp.x * sr + lp.z * cr);
  var y0 = surf.x - 0.008;
  let ymode = i32(it.c.z + 0.5);
  if (ymode == 1 && surf.y > 0.03) {
    y0 = surf.x + surf.y - 0.03 + sin(t * 1.6 + seed * 20.0) * 0.012;
  } else if (ymode == 2) {
    y0 = it.a.y;
  }
  var o: VOut;
  o.wp = vec3f(it.a.x + wxz.x, y0 + lp.y, it.a.z + wxz.y);
  o.pos = cam.viewProj * vec4f(o.wp, 1.0);
  let ns = v.nrm / max(it.b.xyz, vec3f(1e-3));
  o.nrm = normalize(vec3f(ns.x * cr - ns.z * sr, ns.y, ns.x * sr + ns.z * cr));
  var col = v.col * (0.88 + 0.24 * fract(seed * 7.31));
  if (cloth) { col = flagColor(it.c.y); }
  o.col = col;
  o.preview = select(0.0, 1.0, ii == arrayLength(&inst) - 1u);
  return o;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4f {
  clipReflection(in.wp);
  let V = normalize(cam.camPos.xyz - in.wp);
  var n = normalize(in.nrm);
  if (dot(n, V) < 0.0) { n = -n; }
  let Ld = normalize(cam.sunDir.xyz);
  let sun = sky.sun.rgb;
  let shadow = shadowAt(in.wp, n);
  // Wrapped diffuse keeps the stylised look soft.
  let nl = clamp((dot(n, Ld) + 0.25) / 1.25, 0.0, 1.0);
  var col = in.col / PI * (sun * nl * shadow + ambientIrr(sky, n) * 1.15);
  col += sun * ggx(n, V, Ld, 0.45) * max(dot(n, Ld), 0.0) * shadow * 0.04;
  if (in.preview > 0.5) {
    col = mix(col, vec3f(1.2, 1.1, 0.8), 0.25 + 0.15 * sin(cam.camPos.w * 6.0));
  }
  return vec4f(col, 1.0);
}
