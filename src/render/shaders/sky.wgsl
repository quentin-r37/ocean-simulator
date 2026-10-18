// Single-scattering atmosphere (Rayleigh + Mie) baked into an equirectangular radiance map,
// plus the sun irradiance and hemispherical ambient terms derived from it.
struct SkyU { sunDir: vec4f, params: vec4f }

@group(0) @binding(0) var<uniform> U: SkyU;
@group(0) @binding(1) var outTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var inTex: texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> skyOut: SkyData;

const RE: f32 = 6360e3;
const RA: f32 = 6420e3;
const HR: f32 = 7994.0;
const HM: f32 = 1200.0;
const BR: vec3f = vec3f(5.8e-6, 13.5e-6, 33.1e-6);
const BM: vec3f = vec3f(21e-6);
const SUN_E: f32 = 20.0;
// Compensates the missing multiple scattering (sky would be too dark otherwise).
const SKY_GAIN: f32 = 2.2;

fn raySphere(ro: vec3f, rd: vec3f, r: f32) -> vec2f {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - r * r;
  let disc = b * b - c;
  if (disc < 0.0) { return vec2f(-1.0); }
  let s = sqrt(disc);
  return vec2f(-b - s, -b + s);
}

fn transmittance(ro: vec3f, rd: vec3f) -> vec3f {
  let t = raySphere(ro, rd, RA).y;
  let e = raySphere(ro, rd, RE);
  if (e.x > 0.0) { return vec3f(0.0); }
  let steps = 24;
  let ds = t / f32(steps);
  var odR = 0.0;
  var odM = 0.0;
  for (var i = 0; i < steps; i++) {
    let p = ro + rd * (ds * (f32(i) + 0.5));
    let h = length(p) - RE;
    odR += exp(-h / HR) * ds;
    odM += exp(-h / HM) * ds;
  }
  return exp(-(BR * odR + BM * 1.1 * odM));
}

fn scatter(rdIn: vec3f, sun: vec3f) -> vec3f {
  let ro = vec3f(0.0, RE + 2.0, 0.0);
  // Lift grazing rays a little: without multiple scattering the very horizon turns muddy.
  let rd = normalize(vec3f(rdIn.x, max(rdIn.y, 0.0) * 0.9 + 0.045, rdIn.z));
  let tmax = raySphere(ro, rd, RA).y;
  let steps = 20;
  let ds = tmax / f32(steps);
  let mu = dot(rd, sun);
  let pR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  let g = 0.76;
  let pM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  var sumR = vec3f(0.0);
  var sumM = vec3f(0.0);
  var odR = 0.0;
  var odM = 0.0;
  for (var i = 0; i < steps; i++) {
    let p = ro + rd * (ds * (f32(i) + 0.5));
    let h = length(p) - RE;
    let hr = exp(-h / HR) * ds;
    let hm = exp(-h / HM) * ds;
    odR += hr;
    odM += hm;
    let tl = transmittance(p, sun);
    let tv = exp(-(BR * odR + BM * 1.1 * odM));
    sumR += tv * tl * hr;
    sumM += tv * tl * hm;
  }
  var col = SUN_E * SKY_GAIN * (sumR * BR * pR + sumM * BM * pM);
  // Cheap multiple-scattering term: whitens the haze towards the horizon.
  let lum = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3f(lum) * vec3f(0.95, 1.0, 1.08), 0.35 * (1.0 - smoothstep(0.0, 0.35, max(rdIn.y, 0.0))));
  // Below the horizon: darker, bluish (the far sea reflects the sky).
  if (rdIn.y < 0.0) {
    col *= mix(1.0, 0.25, smoothstep(0.0, 0.25, -rdIn.y));
  }
  return col;
}

@compute @workgroup_size(8, 8)
fn bake(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(dims);
  let phi = (uv.x - 0.5) * 2.0 * PI;
  let th = uv.y * PI;
  let d = vec3f(sin(th) * sin(phi), cos(th), -sin(th) * cos(phi));
  textureStore(outTex, gid.xy, vec4f(scatter(d, normalize(U.sunDir.xyz)), 1.0));
}

@compute @workgroup_size(1)
fn integrate() {
  let sun = normalize(U.sunDir.xyz);
  let ro = vec3f(0.0, RE + 2.0, 0.0);
  let sunIrr = SUN_E * transmittance(ro, sun) * smoothstep(-0.02, 0.04, sun.y);
  let dims = vec2i(textureDimensions(inTex));
  var up = vec3f(0.0);
  var hor = vec3f(0.0);
  let step = 4;
  let dOmega = (2.0 * PI / f32(dims.x)) * (PI / f32(dims.y)) * f32(step * step);
  for (var y = 0; y < dims.y / 2; y += step) {
    let th = (f32(y) + 0.5) / f32(dims.y) * PI;
    for (var x = 0; x < dims.x; x += step) {
      let phi = ((f32(x) + 0.5) / f32(dims.x) - 0.5) * 2.0 * PI;
      let d = vec3f(sin(th) * sin(phi), cos(th), -sin(th) * cos(phi));
      let L = textureLoad(inTex, vec2i(x, y), 0).rgb;
      let w = sin(th) * dOmega;
      up += L * max(d.y, 0.0) * w;
      // Average over the four horizontal normal directions.
      hor += L * 0.25 * (max(d.x, 0.0) + max(-d.x, 0.0) + max(d.z, 0.0) + max(-d.z, 0.0)) * w;
    }
  }
  // Light bounced by the sand (albedo ~0.4) for downward-facing / vertical surfaces.
  let groundL = 0.4 * (up + sunIrr * max(sun.y, 0.0)) / PI;
  skyOut.sun = vec4f(sunIrr, 1.0);
  skyOut.ambUp = vec4f(up, 1.0);
  skyOut.ambHor = vec4f(hor + groundL * PI * 0.5, 1.0);
  skyOut.ambDown = vec4f(groundL * PI, 1.0);
}
