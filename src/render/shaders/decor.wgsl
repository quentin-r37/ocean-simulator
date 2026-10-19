// Instanced props that follow the simulated sand / water surface.
struct Inst {
  a: vec4f, // x, y (absolute or offset), z, rotation
  b: vec4f, // scale xyz, seed
  c: vec4f, // kind, material (flag colour index, -2 stone), y mode, sway
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
  @location(4) stone: f32,
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
    let wind = mix(cam.env.x, 1.0, under);
    let speed = mix(1.9, 0.9, under);
    let ph = t * speed + seed * 40.0 + it.a.x * 0.7 + it.a.z * 0.5;
    let amt = sway * hgt * hgt * mix(0.9, 2.2, under) * wind;
    lp.x += (sin(ph) * 0.7 + sin(ph * 2.3) * 0.3) * amt;
    lp.z += cos(ph * 0.8) * amt * 0.6;
  }
  if (cloth) {
    let k = v.pos.x / 0.13;
    let w = cam.env.x;
    lp.z += sin(t * 7.0 + v.pos.x * 32.0 + seed * 10.0) * 0.018 * k * (0.3 + 0.7 * w);
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
  o.stone = select(0.0, 1.0, it.c.y < -1.5);
  return o;
}

// Triplanar value noise (blend weights `w`): value in x, gradient in yzw.
fn triNoise(p: vec3f, w: vec3f) -> vec4f {
  let a = vnoised(p.zy);
  let b = vnoised(p.xz);
  let c = vnoised(p.xy + vec2f(17.3, 5.1));
  let v = w.x * a.x + w.y * b.x + w.z * c.x;
  let g = w.x * vec3f(0.0, a.z, a.y) + w.y * vec3f(b.y, 0.0, b.z) + w.z * vec3f(c.y, c.z, 0.0);
  return vec4f(v, g);
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
  var alb = in.col;
  var wet = 0.0; // wet sheen (only above the water: under it the surface does the reflecting)
  var rough = 0.45;
  if (in.stone > 0.5) {
    let wp = in.wp;
    let w0 = pow(abs(n), vec3f(4.0));
    let w = w0 / (w0.x + w0.y + w0.z);
    // Fine detail fades out with distance so it does not shimmer.
    let fade = 1.0 - smoothstep(3.0, 14.0, length(cam.camPos.xyz - wp));
    // Weathered relief: a few octaves of triplanar noise bend the normal.
    var g = vec3f(0.0);
    var relief = 0.0;
    var f = 4.0;
    var amp = 1.0;
    for (var i = 0; i < 4; i++) {
      let s = triNoise(wp * f + f32(i) * 7.1, w);
      relief += s.x * amp;
      g += s.yzw * f * amp;
      f *= 2.4;
      amp *= mix(0.25, 0.42, fade);
    }
    n = normalize(n - 0.011 * (g - dot(g, n) * n));
    alb *= 0.9 + 0.12 * relief;
    // Granite grain: light and dark crystals.
    let grain = triNoise(wp * 95.0, w).x;
    alb *= 1.0 + 0.22 * clamp(grain * 2.0, -1.0, 1.0) * fade;
    alb = mix(alb, alb * 0.45, smoothstep(0.55, 0.8, triNoise(wp * 140.0 + 3.0, w).x) * fade);
    // Hairline cracks along the zero lines of a warped noise.
    let cr = triNoise(wp * 2.2 + relief * 0.08, w).x;
    alb *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, 0.035, abs(cr))) * smoothstep(-0.2, 0.3, triNoise(wp * 1.3 + 11.0, w).x);

    // Waterline: dark wet band up to the swash, green weed and barnacles just below
    // the surface, a dimmer greenish tint deeper down.
    let h = wp.y - cam.sunDir.w;
    let wob = triNoise(wp * 7.0, w).x * 0.05;
    let reach = 0.04 + cam.waves.x * 1.5;
    let damp = 1.0 - smoothstep(reach * 0.5, reach + 0.06, h + wob);
    wet = damp * smoothstep(-0.03, 0.01, h);
    let weed = smoothstep(-0.3, -0.12, h + wob) * (1.0 - smoothstep(-0.02, 0.05, h + wob * 1.5));
    let deep = 1.0 - smoothstep(-0.4, -0.15, h);
    alb = mix(alb, alb * vec3f(0.55, 0.52, 0.48), damp);
    alb = mix(alb, vec3f(0.05, 0.075, 0.03), weed * 0.8 * smoothstep(-0.2, 0.3, triNoise(wp * 18.0, w).x));
    let barn = smoothstep(0.55, 0.7, triNoise(wp * 70.0, w).x) * weed * fade;
    alb = mix(alb, vec3f(0.3, 0.29, 0.26), barn * 0.5);
    alb = mix(alb, alb * vec3f(0.7, 0.85, 0.75), deep);

    // A few small crusty lichen spots on the dry, sun-facing tops: orange and pale grey-green.
    let lv = triNoise(wp * 7.0 + 5.0, w).x * 0.6 + triNoise(wp * 22.0, w).x * 0.4;
    let lichen = smoothstep(0.42, 0.47, lv) * smoothstep(0.35, 0.75, n.y) * smoothstep(0.0, 0.12, h - reach);
    let lcol = select(vec3f(0.22, 0.22, 0.18), vec3f(0.26, 0.15, 0.05), triNoise(wp * 0.9 + 2.0, w).x > 0.0);
    alb = mix(alb, lcol * (0.8 + 0.4 * (grain * 0.5 + 0.5)), lichen * 0.7);
    rough = 0.8;
  }
  // Wrapped diffuse keeps the stylised look soft.
  let nl = clamp((dot(n, Ld) + 0.25) / 1.25, 0.0, 1.0);
  var col = alb / PI * (sun * nl * shadow + ambientIrr(sky, n) * 1.15);
  col += sun * ggx(n, V, Ld, mix(rough, 0.2, wet)) * max(dot(n, Ld), 0.0) * shadow * mix(0.04, 0.25, wet);
  if (in.preview > 0.5) {
    col = mix(col, vec3f(1.2, 1.1, 0.8), 0.25 + 0.15 * sin(cam.camPos.w * 6.0));
  }
  return vec4f(col, 1.0);
}
