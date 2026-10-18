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

// The diorama has no aerial perspective (kept as a hook for shaders that call it).
fn applyFog(col: vec3f, wp: vec3f) -> vec3f {
  return col;
}

fn clipReflection(wp: vec3f) {
  if (cam.clip.y > 0.5 && wp.y < cam.clip.x) { discard; }
}
