// Plastic toys (shovel, bucket) and their contents.
struct Obj {
  model: mat4x4f,
  tint: vec4f,     // rgb override when a > 0.5
  params: vec4f,   // roughness, wet sand (1) / water (2) material, -, -
}
@group(2) @binding(0) var<uniform> obj: Obj;

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
}

@vertex
fn vs_main(v: VIn) -> VOut {
  var o: VOut;
  let w = obj.model * vec4f(v.pos, 1.0);
  o.wp = w.xyz;
  o.pos = cam.viewProj * w;
  o.nrm = normalize((obj.model * vec4f(v.nrm, 0.0)).xyz);
  o.col = select(v.col, obj.tint.rgb, obj.tint.a > 0.5);
  return o;
}

@fragment
fn fs_main(in: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  clipReflection(in.wp);
  var n = normalize(in.nrm);
  if (!ff) { n = -n; }
  let V = normalize(cam.camPos.xyz - in.wp);
  let Ld = normalize(cam.sunDir.xyz);
  let sun = sky.sun.rgb;
  let shadow = shadowAt(in.wp, n);
  let nl = max(dot(n, Ld), 0.0);
  var rough = obj.params.x;
  var f0 = 0.04;
  var alb = in.col;
  if (obj.params.y > 0.5 && obj.params.y < 1.5) {
    // Sand inside the bucket / on the shovel.
    alb *= 0.9 + 0.2 * vnoise(in.wp.xz * 120.0);
    rough = 0.8;
  }
  var col = alb / PI * (sun * nl * shadow + ambientIrr(sky, n));
  let fr = fresnelSchlick(max(dot(n, V), 0.0), f0);
  col += sun * ggx(n, V, Ld, rough) * nl * shadow * fr * 4.0;
  col += skyRadiance(reflect(-V, n)) * fr * (1.0 - rough) * 0.8;
  if (obj.params.y > 1.5) {
    // Water in the bucket.
    let frw = fresnelSchlick(max(dot(n, V), 0.0), 0.02);
    col = mix(vec3f(0.02, 0.09, 0.1) * (sun.g * 0.2 + 0.2), skyRadiance(reflect(-V, n)), frw)
        + sun * ggx(n, V, Ld, 0.05) * nl * frw;
  }
  return vec4f(applyFog(col, in.wp), 1.0);
}
