@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(3) var skyTex: texture_2d<f32>;
@group(0) @binding(4) var linSampler: sampler;
@group(0) @binding(5) var<storage, read> sky: SkyData;

struct VOut { @builtin(position) pos: vec4f, @location(0) ndc: vec2f }

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: VOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.ndc = p;
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  if (cam.clip.z < 0.5) {
    // Main view: plain studio backdrop behind the diorama.
    let g = 0.5 + 0.5 * in.ndc.y;
    return vec4f(mix(vec3f(0.26, 0.28, 0.29), vec3f(0.36, 0.38, 0.39), g), 1.0);
  }
  let w = cam.invViewProj * vec4f(in.ndc, 0.5, 1.0);
  let dir = normalize(w.xyz / w.w - cam.camPos.xyz);
  var col = textureSampleLevel(skyTex, linSampler, equirectUV(dir), 0.0).rgb;
  // Below the horizon (beyond the far ocean mesh): a calm sea reflecting the sky.
  if (dir.y < 0.0) {
    let up = vec3f(dir.x, -dir.y, dir.z);
    let f = 0.02 + 0.98 * pow(1.0 - min(-dir.y * 6.0, 1.0), 5.0);
    col = mix(vec3f(0.01, 0.05, 0.07) * (sky.ambUp.rgb + sky.sun.rgb * 0.3), textureSampleLevel(skyTex, linSampler, equirectUV(up), 0.0).rgb, f);
  }
  // Sun disc (skipped in the planar reflection: the water shader adds its own glint).
  if (cam.clip.z < 0.5) {
    let sd = normalize(cam.sunDir.xyz);
    let c = dot(dir, sd);
    let r = 0.0055;
    let x = clamp((1.0 - c) / (1.0 - cos(r)), 0.0, 1.0);
    if (x < 1.0) {
      let limb = 1.0 - 0.6 * (1.0 - sqrt(1.0 - x));
      col += sky.sun.rgb * 900.0 * limb * smoothstep(1.0, 0.8, x);
    }
    col += sky.sun.rgb * 0.08 * pow(max(c, 0.0), 300.0);
  }
  return vec4f(col, 1.0);
}
