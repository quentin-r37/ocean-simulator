// Bloom (Jimenez 2014 down/up-sampling), ACES tonemapping, FXAA.
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> pp: vec4f; // texel size of src (xy), karis/strength (z), exposure (w)
@group(0) @binding(3) var bloomTex: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(src, samp, uv, 0.0).rgb; }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn karis(c: vec3f) -> f32 { return 1.0 / (1.0 + luma(c)); }

@fragment
fn down(in: VOut) -> @location(0) vec4f {
  let t = pp.xy;
  let uv = in.uv;
  let a = tap(uv + t * vec2f(-2.0, -2.0));
  let b = tap(uv + t * vec2f(0.0, -2.0));
  let c = tap(uv + t * vec2f(2.0, -2.0));
  let d = tap(uv + t * vec2f(-2.0, 0.0));
  let e = tap(uv);
  let f = tap(uv + t * vec2f(2.0, 0.0));
  let g = tap(uv + t * vec2f(-2.0, 2.0));
  let h = tap(uv + t * vec2f(0.0, 2.0));
  let i = tap(uv + t * vec2f(2.0, 2.0));
  let j = tap(uv + t * vec2f(-1.0, -1.0));
  let k = tap(uv + t * vec2f(1.0, -1.0));
  let l = tap(uv + t * vec2f(-1.0, 1.0));
  let m = tap(uv + t * vec2f(1.0, 1.0));
  var col: vec3f;
  if (pp.z > 0.5) {
    // First level: Karis average of the 5 boxes kills sun-glint fireflies.
    let g0 = (a + b + d + e) * 0.25;
    let g1 = (b + c + e + f) * 0.25;
    let g2 = (d + e + g + h) * 0.25;
    let g3 = (e + f + h + i) * 0.25;
    let g4 = (j + k + l + m) * 0.25;
    let w0 = karis(g0); let w1 = karis(g1); let w2 = karis(g2); let w3 = karis(g3); let w4 = karis(g4);
    col = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5)
        / (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  return vec4f(min(col, vec3f(6e4)), 1.0);
}

@fragment
fn up(in: VOut) -> @location(0) vec4f {
  let t = pp.xy;
  let uv = in.uv;
  var c = tap(uv) * 4.0;
  c += (tap(uv + t * vec2f(-1.0, 0.0)) + tap(uv + t * vec2f(1.0, 0.0)) + tap(uv + t * vec2f(0.0, -1.0)) + tap(uv + t * vec2f(0.0, 1.0))) * 2.0;
  c += tap(uv + t * vec2f(-1.0, -1.0)) + tap(uv + t * vec2f(1.0, -1.0)) + tap(uv + t * vec2f(-1.0, 1.0)) + tap(uv + t * vec2f(1.0, 1.0));
  return vec4f(c / 16.0, 1.0);
}

@fragment
fn tonemap(in: VOut) -> @location(0) vec4f {
  let scene = textureSampleLevel(src, samp, in.uv, 0.0).rgb;
  let bloom = textureSampleLevel(bloomTex, samp, in.uv, 0.0).rgb;
  var c = mix(scene, bloom, pp.z) * pp.w;
  c = ACESFilm(c);
  // Subtle vignette.
  let q = in.uv - 0.5;
  c *= 1.0 - dot(q, q) * 0.35;
  c = pow(c, vec3f(1.0 / 2.2));
  return vec4f(c, dot(c, vec3f(0.299, 0.587, 0.114)));
}

// FXAA 3.11-style (quality-lite), luma stored in alpha by the tonemap pass.
@fragment
fn fxaa(in: VOut) -> @location(0) vec4f {
  let t = pp.xy;
  let uv = in.uv;
  let rgbM = textureSampleLevel(src, samp, uv, 0.0);
  let lM = rgbM.a;
  let lNW = textureSampleLevel(src, samp, uv + vec2f(-1.0, -1.0) * t, 0.0).a;
  let lNE = textureSampleLevel(src, samp, uv + vec2f(1.0, -1.0) * t, 0.0).a;
  let lSW = textureSampleLevel(src, samp, uv + vec2f(-1.0, 1.0) * t, 0.0).a;
  let lSE = textureSampleLevel(src, samp, uv + vec2f(1.0, 1.0) * t, 0.0).a;
  let lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  let lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0312, lMax * 0.125)) { return vec4f(rgbM.rgb, 1.0); }
  var dir = vec2f(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  let dirReduce = max((lNW + lNE + lSW + lSE) * 0.25 * 0.125, 1.0 / 128.0);
  let rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcp, vec2f(-8.0), vec2f(8.0)) * t;
  let a = 0.5 * (textureSampleLevel(src, samp, uv + dir * (1.0 / 3.0 - 0.5), 0.0).rgb +
                 textureSampleLevel(src, samp, uv + dir * (2.0 / 3.0 - 0.5), 0.0).rgb);
  let b = a * 0.5 + 0.25 * (textureSampleLevel(src, samp, uv + dir * -0.5, 0.0).rgb +
                            textureSampleLevel(src, samp, uv + dir * 0.5, 0.0).rgb);
  let lB = dot(b, vec3f(0.299, 0.587, 0.114));
  if (lB < lMin || lB > lMax) { return vec4f(a, 1.0); }
  return vec4f(b, 1.0);
}
