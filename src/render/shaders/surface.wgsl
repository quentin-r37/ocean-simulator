// Bilinear sampling of the simulated sand/water heights (needs `ground` and `water` bindings).
fn cellIdx(x: i32, y: i32) -> u32 {
  let n = i32(cam.grid.x);
  return u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1));
}

// Returns (sand surface H, water depth d) at world position p (x, z).
fn sampleSurface(p: vec2f) -> vec2f {
  let q = p / cam.grid.y - 0.5;
  let i0 = vec2i(floor(q));
  let t = q - floor(q);
  let ia = cellIdx(i0.x, i0.y);
  let ib = cellIdx(i0.x + 1, i0.y);
  let ic = cellIdx(i0.x, i0.y + 1);
  let id = cellIdx(i0.x + 1, i0.y + 1);
  let a = vec2f(ground[ia].x + ground[ia].y, water[ia].x);
  let b = vec2f(ground[ib].x + ground[ib].y, water[ib].x);
  let c = vec2f(ground[ic].x + ground[ic].y, water[ic].x);
  let d = vec2f(ground[id].x + ground[id].y, water[id].x);
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
