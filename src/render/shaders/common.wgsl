struct Camera {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  lightViewProj: mat4x4f,
  camPos: vec4f,  // xyz, time
  sunDir: vec4f,  // xyz (towards the sun), sea level
  clip: vec4f,    // clip height, clip enabled, is reflection pass, -
  cursor: vec4f,  // x, z, radius, enabled
  screen: vec4f,  // w, h, 1/w, 1/h
  grid: vec4f,    // n, dx, L, stride
  waves: vec4f,   // amplitude, period, boundary depth, moisture overlay
  misc: vec4f,    // wave time, cursor kind, -, -
}

struct SkyData {
  sun: vec4f,     // sun irradiance (rgb)
  ambUp: vec4f,   // irradiance on an up-facing surface
  ambHor: vec4f,  // irradiance on a vertical surface
  ambDown: vec4f, // irradiance on a down-facing surface (ground bounce)
}

const PI: f32 = 3.14159265;

fn equirectUV(d: vec3f) -> vec2f {
  return vec2f(atan2(d.x, -d.z) / (2.0 * PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI);
}

fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash32(p: vec2f) -> vec3f {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash12(i);
  let b = hash12(i + vec2f(1.0, 0.0));
  let c = hash12(i + vec2f(0.0, 1.0));
  let d = hash12(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

// Value noise with analytic derivatives: (value, d/dx, d/dy).
fn vnoised(p: vec2f) -> vec3f {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let du = 6.0 * f * (1.0 - f);
  let a = hash12(i);
  let b = hash12(i + vec2f(1.0, 0.0));
  let c = hash12(i + vec2f(0.0, 1.0));
  let d = hash12(i + vec2f(1.0, 1.0));
  let k1 = b - a;
  let k2 = c - a;
  let k3 = a - b - c + d;
  return vec3f(a + k1 * u.x + k2 * u.y + k3 * u.x * u.y,
               du.x * (k1 + k3 * u.y),
               du.y * (k2 + k3 * u.x)) * vec3f(2.0, 2.0, 2.0) - vec3f(1.0, 0.0, 0.0);
}

fn fbm(p: vec2f) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 4; i++) {
    s += a * vnoise(q);
    q = q * 2.03 + vec2f(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}

fn softplus(x: f32) -> f32 {
  return select(log(1.0 + exp(x)), x, x > 30.0);
}

// Must match beachProfile() in params.ts.
fn beachProfile(z: f32) -> f32 {
  var h = 0.55 - 0.08 * z - 0.08 * softplus(z - 7.0);
  if (z < 0.0) { h += 0.035 * -z; }
  let b = (z - 4.0) / 0.9;
  h += 0.05 * exp(-b * b);
  return clamp(h, -6.0, 4.0);
}

fn farHeight(p: vec2f) -> f32 {
  var h = beachProfile(p.y);
  // Dunes behind the beach, out of the simulated domain.
  let dunes = smoothstep(-2.0, -25.0, p.y);
  h += dunes * (1.6 * (fbm(p * 0.02) * 0.5 + 0.5) + 0.25 * fbm(p * 0.09));
  return h;
}

fn moistEq(above: f32) -> f32 {
  return select(0.8 * (1.0 - smoothstep(0.03, 0.9, above)), 1.0, above < 0.03);
}

fn fresnelSchlick(cosT: f32, f0: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(1.0 - clamp(cosT, 0.0, 1.0), 5.0);
}

// GGX specular lobe (D * V), multiply by F and NdotL outside.
fn ggx(n: vec3f, v: vec3f, l: vec3f, rough: f32) -> f32 {
  let h = normalize(v + l);
  let nh = max(dot(n, h), 0.0);
  let nv = max(dot(n, v), 1e-3);
  let nl = max(dot(n, l), 1e-3);
  let a = rough * rough;
  let a2 = a * a;
  let dd = nh * nh * (a2 - 1.0) + 1.0;
  let D = a2 / (PI * dd * dd);
  let k = a * 0.5;
  let V = 1.0 / ((nv * (1.0 - k) + k) * (nl * (1.0 - k) + k) * 4.0);
  return D * V;
}

fn ambientIrr(sky: SkyData, n: vec3f) -> vec3f {
  if (n.y >= 0.0) { return mix(sky.ambHor.rgb, sky.ambUp.rgb, n.y); }
  return mix(sky.ambHor.rgb, sky.ambDown.rgb, -n.y);
}

fn ACESFilm(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
