// Bindings shared by the lit scene shaders (terrain, water, tools).
@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(3) var skyTex: texture_2d<f32>;
@group(0) @binding(4) var linSampler: sampler;
@group(0) @binding(5) var<storage, read> sky: SkyData;
@group(1) @binding(6) var shadowMap: texture_depth_2d;
@group(1) @binding(7) var shadowSampler: sampler_comparison;

fn skyRadiance(d: vec3f) -> vec3f {
  return textureSampleLevel(skyTex, linSampler, equirectUV(d), 0.0).rgb;
}

fn shadowAt(wp: vec3f, nrm: vec3f) -> f32 {
  let p = cam.lightViewProj * vec4f(wp + nrm * 0.015, 1.0);
  let ndc = p.xyz / p.w;
  let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || ndc.z > 1.0) { return 1.0; }
  let ts = 1.0 / vec2f(textureDimensions(shadowMap));
  let refZ = ndc.z - 0.0004;
  var s = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      s += textureSampleCompareLevel(shadowMap, shadowSampler, uv + vec2f(f32(x), f32(y)) * ts * 1.3, refZ);
    }
  }
  return s / 9.0;
}

// Core shadow: the darkest band of a form sits just past the terminator, where neither the sun
// nor the bounce light from the sand reaches it; further round, the bounce lifts the shadow side
// again. Returns the fraction of fill light lost there (0 on lit planes and on the far side).
fn coreShadow(ndl: f32) -> f32 {
  return (1.0 - smoothstep(-0.12, 0.1, ndl)) * smoothstep(-0.75, -0.2, ndl);
}

// Steep surfaces darken as they turn away from the eye (rough-surface falloff, as in Oren-Nayar),
// so the lit side of a tower keeps a darker rim against the lit sand behind it.
fn turnShade(n: vec3f, V: vec3f) -> f32 {
  let steep = smoothstep(0.05, 0.35, 1.0 - n.y);
  return steep * (1.0 - smoothstep(0.0, 0.6, dot(n, V)));
}

// The diorama has no aerial perspective (kept as a hook for shaders that call it).
fn applyFog(col: vec3f, wp: vec3f) -> vec3f {
  return col;
}

fn clipReflection(wp: vec3f) {
  if (cam.clip.y > 0.5 && wp.y < cam.clip.x) { discard; }
}
