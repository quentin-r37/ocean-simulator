// Water surface: planar reflection + screen-space refraction, Beer-Lambert absorption,
// sun glitter (GGX), foam and turbidity from the simulation.
@group(0) @binding(1) var<storage, read> ground: array<vec4f>;
@group(0) @binding(2) var<storage, read> water: array<vec4f>;
@group(0) @binding(8) var<storage, read> aux: array<vec4f>;
@group(2) @binding(9) var refrTex: texture_2d<f32>;
@group(2) @binding(10) var depthTex: texture_depth_2d;
@group(2) @binding(11) var reflTex: texture_2d<f32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) nrm: vec3f,
  @location(2) info: vec4f, // depth, foam, sediment, speed
  @location(3) far: f32,
}

const DRY: f32 = 0.003;

fn gidx(x: i32, y: i32) -> u32 {
  let n = i32(cam.grid.x);
  return u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1));
}

fn surfOr(x: i32, y: i32, fallback: f32) -> f32 {
  let i = gidx(x, y);
  let d = water[i].x;
  if (d < DRY) { return fallback; }
  let g = ground[i];
  return g.x + g.y + d;
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
  let w = water[i];
  let H = g.x + g.y;
  var y = H + w.x;
  var depth = w.x;
  if (w.x < DRY) {
    // Dry vertex: tuck it under the sand, but keep the level of wet neighbours so the
    // shoreline edge stays smooth (it is hidden by the terrain anyway).
    var lvl = -1e9;
    var offs = array<vec2i, 4>(vec2i(-1, 0), vec2i(1, 0), vec2i(0, -1), vec2i(0, 1));
    for (var k = 0; k < 4; k++) {
      let o = offs[k] * stride;
      let j = gidx(gx + o.x, gy + o.y);
      if (water[j].x >= DRY) {
        let gj = ground[j];
        lvl = max(lvl, gj.x + gj.y + water[j].x);
      }
    }
    y = select(H - 0.03, min(lvl, H + 0.002), lvl > -1e8);
    depth = 0.0;
  }
  let hl = surfOr(gx - stride, gy, y);
  let hr = surfOr(gx + stride, gy, y);
  let hb = surfOr(gx, gy - stride, y);
  let ht = surfOr(gx, gy + stride, y);
  let a = aux[i];
  var o: VOut;
  o.wp = vec3f(edgeCoord(gx, n, dx), y, edgeCoord(gy, n, dx));
  o.pos = cam.viewProj * vec4f(o.wp, 1.0);
  o.nrm = normalize(vec3f(hl - hr, 2.0 * dx * f32(stride), hb - ht));
  o.info = vec4f(depth, a.y, a.x, w.y);
  o.far = 0.0;
  return o;
}

fn surfaceLines(p: vec2f, t: f32) -> f32 {
  let w = vec2f(vnoise(p * 0.7 + vec2f(t * 0.2, -t * 0.13)), vnoise(p * 0.7 + vec2f(-t * 0.17, t * 0.21) + 4.1));
  let r = 1.0 - abs(vnoise((p + w * 0.8) * 1.3 + vec2f(t * 0.1)));
  return pow(r, 14.0);
}

// Small-scale wind waves: animated value-noise octaves (slopes), each drifting in its own
// direction so the pattern never repeats; high frequencies fade with distance (anti-aliasing).
fn detailSlope(p: vec2f, t: f32, dist: f32) -> vec2f {
  var s = vec2f(0.0);
  var freq = 0.9;
  var amp = 0.085;
  var ang = 0.35;
  for (var k = 0; k < 6; k++) {
    let c = cos(ang);
    let sn = sin(ang);
    let rot = mat2x2f(c, sn, -sn, c);
    // Dispersion: shorter ripples travel slower (deep-water c = sqrt(g / k)).
    let speed = sqrt(9.81 / (6.2831 * freq)) * 0.35;
    let q = rot * p * freq + vec2f(0.0, -t * speed * freq);
    let nd = vnoised(q);
    let fade = 1.0 - smoothstep(15.0 / freq, 70.0 / freq, dist);
    s += (transpose(rot) * nd.yz) * amp * fade;
    freq *= 1.93;
    amp *= 0.62;
    ang += 1.37;
  }
  return s;
}

fn worldFromDepth(uv: vec2f, z: f32) -> vec3f {
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let w = cam.invViewProj * vec4f(ndc, z, 1.0);
  return w.xyz / w.w;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4f {
  let L = cam.grid.z;
  let fragPos = in.pos;
  let dx = cam.grid.y;
  if (in.far > 0.5) {
    if (in.wp.x > 0.0 && in.wp.x < L && in.wp.z > 0.0 && in.wp.z < L) { discard; }
  }
  let depthCol = in.info.x;
  if (in.far < 0.5 && depthCol < DRY * 0.5) { discard; }

  let t = cam.camPos.w;
  let wp = in.wp;
  let toCam = cam.camPos.xyz - wp;
  let dist = length(toCam);
  let V = toCam / dist;
  let Ld = normalize(cam.sunDir.xyz);
  let sun = sky.sun.rgb;
  let foamAmt = clamp(in.info.y, 0.0, 1.0);
  let sed = in.info.z;

  // ----- Normal -----
  let calm = smoothstep(0.0, 0.08, depthCol) * (1.0 - smoothstep(30.0, 400.0, dist) * 0.7);
  let ds = detailSlope(wp.xz, t, dist) * calm * (0.6 + 0.4 * cam.env.x);
  var n = normalize(normalize(in.nrm) + vec3f(-ds.x, 0.0, -ds.y));
  if (dot(n, V) < 0.02) { n = normalize(n + V * (0.02 - dot(n, V))); }

  // ----- What lies beneath (refraction) -----
  let res = cam.screen.xy;
  let uv0 = fragPos.xy / res;
  let z0 = textureLoad(depthTex, vec2i(fragPos.xy), 0);
  let bottom0 = worldFromDepth(uv0, z0);
  let thick0 = select(length(bottom0 - wp), 50.0, z0 <= 0.0);
  var uvR = uv0 + n.xz * 0.03 * clamp(thick0 * 2.0, 0.0, 1.0);
  uvR = clamp(uvR, vec2f(0.0), vec2f(1.0));
  var zR = textureLoad(depthTex, vec2i(uvR * res), 0);
  var bottom = worldFromDepth(uvR, zR);
  // Refracted sample in front of the water (e.g. a tool or a dune)? Fall back to the straight one.
  if (dot(bottom - wp, -V) < 0.0 || (zR <= 0.0 && z0 > 0.0)) {
    uvR = uv0;
    zR = z0;
    bottom = bottom0;
  }
  let thick = select(length(bottom - wp), 80.0, zR <= 0.0);
  let vdepth = max(wp.y - bottom.y, 0.0);
  let behind = textureSampleLevel(refrTex, linSampler, uvR, 0.0).rgb;

  // Stylised lagoon colour: clear turquoise over the sand, deep blue in the holes.
  let shadow = shadowAt(wp, vec3f(0.0, 1.0, 0.0));
  let light = (sun * max(Ld.y, 0.0) * (0.55 + 0.45 * shadow) + ambientIrr(sky, vec3f(0.0, 1.0, 0.0))) / PI;
  let shallowC = vec3f(0.10, 0.78, 0.80);
  let midC = vec3f(0.0, 0.40, 0.64);
  let deepC = vec3f(0.0, 0.10, 0.30);
  var bodyCol = mix(mix(shallowC, midC, smoothstep(0.04, 0.3, vdepth)), deepC, smoothstep(0.3, 0.8, vdepth)) * light;
  // Stirred-up sand clouds the water.
  bodyCol = mix(bodyCol, vec3f(0.75, 0.68, 0.5) * light, clamp(sed * 60.0, 0.0, 0.8));
  let opacity = clamp(1.0 - exp(-(vdepth * 3.2 + thick * 0.12 + sed * 80.0)), 0.0, 0.95);
  let tint = mix(vec3f(1.0), vec3f(0.5, 0.97, 1.0), clamp(vdepth * 5.0, 0.0, 1.0));
  var refr = mix(behind * tint, bodyCol, opacity);
  // Bright wavy lines of light on the surface.
  refr += sun * surfaceLines(wp.xz, t) * 0.004 * (0.4 + 0.6 * shadow) * smoothstep(0.01, 0.08, vdepth);

  // ----- Reflection -----
  let fr = fresnelSchlick(max(dot(n, V), 0.0), 0.02);
  let sea = cam.sunDir.w;
  let rdir = reflect(-V, n);
  var refl = skyRadiance(normalize(vec3f(rdir.x, max(rdir.y, 0.005), rdir.z)));
  // The planar mirror is only valid for water near the reference sea level.
  let planarOk = 1.0 - smoothstep(0.08, 0.35, abs(wp.y - sea));
  if (planarOk > 0.0) {
    let uvRefl = clamp(uv0 + n.xz * vec2f(0.03, 0.03) * vec2f(1.0, -1.0), vec2f(0.001), vec2f(0.999));
    let pr = textureSampleLevel(reflTex, linSampler, uvRefl, 0.0);
    refl = mix(refl, pr.rgb, planarOk * pr.a);
  }

  // ----- Sun glitter ("réverbération") -----
  let rough = mix(0.07, 0.2, smoothstep(5.0, 300.0, dist));
  let spec = ggx(n, V, Ld, rough) * fresnelSchlick(max(dot(normalize(V + Ld), V), 0.0), 0.02);
  let glint = sun * spec * max(dot(n, Ld), 0.0) * shadow;

  // Sub-pixel glitter: random micro-facets that happen to mirror the sun (the "réverbération").
  var sparkle = 0.0;
  let gcell = floor(wp.xz * 7.0 + vec2f(t * 0.6, -t * 0.4));
  let gh = hash32(gcell + floor(t * 3.0) * 17.0);
  if (gh.z > 0.88) {
    let facet = normalize(n + vec3f(gh.x - 0.5, 0.0, gh.y - 0.5) * 0.35);
    let al = max(dot(reflect(-V, facet), Ld), 0.0);
    sparkle = pow(al, 3000.0) * 12.0 * smoothstep(0.0, 0.15, depthCol + in.far);
  }
  var col = mix(refr, refl, fr) + glint + sun * sparkle * shadow * fresnelSchlick(max(dot(n, V), 0.0), 0.02) * 8.0;

  // ----- Foam -----
  let fnoise = fbm(wp.xz * 5.0 + vec2f(t * 0.25, -t * 0.4)) * 0.5 + 0.5;
  let fnoise2 = vnoise(wp.xz * 22.0 - vec2f(t * 0.6)) * 0.5 + 0.5;
  let shoreFoam = 0.45 * (1.0 - smoothstep(0.0, 0.03, depthCol)) * smoothstep(0.3, 1.2, in.info.w) * (1.0 - in.far);
  let f = clamp(foamAmt + shoreFoam, 0.0, 1.0);
  let foamMask = smoothstep(0.55, 0.9, f * (0.55 + 0.6 * fnoise) + (fnoise2 - 0.5) * 0.25);
  let foamCol = vec3f(0.85, 0.88, 0.88) / PI * (sun * max(dot(n, Ld), 0.0) * shadow + ambientIrr(sky, n));
  col = mix(col, foamCol, foamMask * 0.9);

  // Soft shoreline: fade into what is underneath where the film is very thin.
  let edge = smoothstep(0.0, 0.025, vdepth + select(0.0, 1.0, in.far > 0.5));
  col = mix(behind, col, edge);

  let dbg = i32(cam.misc.z);
  if (dbg == 1) { col = refr; }
  if (dbg == 2) { col = refl; }
  if (dbg == 3) { col = vec3f(shadow); }
  if (dbg == 4) { col = n * 0.5 + 0.5; }
  if (dbg == 5) { col = behind; }
  if (dbg == 6) { col = vec3f(fr * 5.0); }
  if (dbg == 7) { col = vec3f(clamp(thick, 0.0, 1.0), clamp(vdepth * 5.0, 0.0, 1.0), 0.0); }
  return vec4f(col, 1.0);
}
