// Procedural low-poly props. Each mesh stands on its origin (+y up), roughly unit-sized:
// instances scale them. Vertex colour (1, 0, 1) marks flag cloth (tinted per instance).
import { Builder, icosphere, MeshData } from './meshBuilder';
import { compose, mat4RotateX, mat4RotateY, mat4RotateZ, mat4Scale, mat4Translate, Vec3, v3 } from '../math';
import { fbm, rng } from '../world/noise';

export const CLOTH: Vec3 = [1, 0, 1];

const mixc = (a: Vec3, b: Vec3, t: number): Vec3 => v3.lerp(a, b, t);

/** Lumpy boulder: base flat at y=0, top at y=1, radius 1. */
export function rockMesh(seed: number): MeshData {
  const b = new Builder();
  const r = rng(seed * 7919);
  const off = r() * 100;
  const shape = (p: Vec3): Vec3 => {
    const d = 1 + 0.28 * fbm(p[0] * 1.3 + off, p[2] * 1.3 + p[1] * 0.7, seed, 3) + 0.08 * fbm(p[0] * 4 + off, p[1] * 4, seed + 3, 2);
    const q = v3.scale(p, d);
    // Flatten the base, squash slightly, then map y to [0, 1].
    const y = Math.max(q[1], -0.25);
    return [q[0], (y + 0.25) / 1.3, q[2]];
  };
  const dark: Vec3 = [0.05, 0.045, 0.04];
  const light: Vec3 = [0.13, 0.115, 0.1];
  for (const [a, c, d] of icosphere(2)) {
    const pa = shape(a), pc = shape(c), pd = shape(d);
    b.flatTri(pa, pc, pd, (p) => mixc(dark, light, Math.min(1, Math.max(0, p[1] * 0.9 + 0.15 * fbm(p[0] * 3, p[2] * 3, 5)))));
  }
  return b.build();
}

/** Branching coral, ~0.35 m tall at scale 1. */
export function coralMesh(seed: number): MeshData {
  const b = new Builder();
  const r = rng(seed * 104729);
  const base: Vec3 = [0.8, 0.2, 0.17];
  const tip: Vec3 = [0.95, 0.42, 0.3];
  const branch = (p0: Vec3, dir: Vec3, len: number, rad: number, depth: number) => {
    const pts: Vec3[] = [p0];
    let p = p0;
    let d = dir;
    for (let k = 0; k < 4; k++) {
      d = v3.norm(v3.add(d, [(r() - 0.5) * 0.5, 0.15, (r() - 0.5) * 0.5]));
      p = v3.add(p, v3.scale(d, len / 4));
      pts.push(p);
    }
    b.tube(pts, rad, mixc(base, tip, depth * 0.4), 6, true);
    if (depth < 2) {
      const n = 2 + Math.floor(r() * 2);
      for (let k = 0; k < n; k++) {
        const at = pts[2 + Math.floor(r() * 2)];
        branch(at, v3.norm([d[0] + (r() - 0.5) * 1.6, 0.6, d[2] + (r() - 0.5) * 1.6]), len * 0.6, rad * 0.7, depth + 1);
      }
    } else {
      // Rounded polyp tip.
      for (const [a, c, e] of icosphere(0)) {
        b.flatTri(v3.add(p, v3.scale(a, rad * 1.8)), v3.add(p, v3.scale(c, rad * 1.8)), v3.add(p, v3.scale(e, rad * 1.8)), tip);
      }
    }
  };
  const trunks = 2 + Math.floor(r() * 2);
  for (let k = 0; k < trunks; k++) {
    branch([(r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.08], v3.norm([(r() - 0.5) * 0.8, 1, (r() - 0.5) * 0.8]), 0.18, 0.018, 0);
  }
  return b.build();
}

/** Ribbon blades (seaweed or beach grass); `curl` bends them, colours go root -> tip. */
function bladesMesh(seed: number, count: number, height: number, width: number, curl: number, root: Vec3, tipc: Vec3, spread: number): MeshData {
  const b = new Builder();
  const r = rng(seed * 2654435761);
  for (let k = 0; k < count; k++) {
    const ang = r() * Math.PI * 2;
    const lean = 0.15 + r() * curl;
    const h = height * (0.6 + 0.4 * r());
    const w = width * (0.7 + 0.6 * r());
    const ox = Math.cos(ang) * spread * r();
    const oz = Math.sin(ang) * spread * r();
    const dir: Vec3 = [Math.cos(ang), 0, Math.sin(ang)];
    const side: Vec3 = [-dir[2], 0, dir[0]];
    const segs = 4;
    const pts: Vec3[] = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      pts.push([ox + dir[0] * lean * h * t * t, h * t, oz + dir[2] * lean * h * t * t]);
    }
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs, t1 = (s + 1) / segs;
      const w0 = w * (1 - t0 * 0.9), w1 = w * (1 - t1 * 0.9);
      const a = v3.add(pts[s], v3.scale(side, -w0)), c = v3.add(pts[s], v3.scale(side, w0));
      const d = v3.add(pts[s + 1], v3.scale(side, -w1)), e = v3.add(pts[s + 1], v3.scale(side, w1));
      const col0 = mixc(root, tipc, t0), col1 = mixc(root, tipc, t1);
      const n = v3.norm(v3.add(v3.cross(v3.sub(d, a), v3.sub(c, a)), [0, 0.6, 0]));
      const ia = b.vert(a, n, col0), ic = b.vert(c, n, col0), id = b.vert(d, n, col1), ie = b.vert(e, n, col1);
      b.tri(ia, id, ic);
      b.tri(ic, id, ie);
    }
  }
  return b.build();
}

export const seaweedMesh = (seed: number) => bladesMesh(seed, 7, 0.32, 0.018, 0.5, [0.04, 0.22, 0.1], [0.16, 0.5, 0.18], 0.06);
export const grassMesh = (seed: number) => bladesMesh(seed, 18, 0.3, 0.016, 0.9, [0.16, 0.24, 0.06], [0.5, 0.56, 0.22], 0.07);

/** Round shrub with a few yellow/white flowers. */
export function bushMesh(seed: number): MeshData {
  const b = new Builder();
  const r = rng(seed * 31337);
  const greens: Vec3[] = [[0.05, 0.2, 0.04], [0.1, 0.3, 0.05], [0.22, 0.36, 0.06], [0.45, 0.42, 0.08]];
  const blobs = 6 + Math.floor(r() * 4);
  for (let k = 0; k < blobs; k++) {
    const c: Vec3 = [(r() - 0.5) * 0.35, 0.08 + r() * 0.18, (r() - 0.5) * 0.35];
    const rad = 0.09 + r() * 0.08;
    const col = greens[Math.floor(r() * greens.length)];
    for (const [a, d, e] of icosphere(1)) {
      const s = (p: Vec3): Vec3 => v3.add(c, v3.scale(p, rad * (1 + 0.15 * Math.sin(p[0] * 9 + k))));
      b.flatTri(s(a), s(d), s(e), (p) => v3.scale(col, 0.75 + 0.5 * (p[1] - c[1] + rad) / (2 * rad)));
    }
  }
  const flowerCols: Vec3[] = [[0.95, 0.75, 0.15], [0.95, 0.95, 0.9], [0.95, 0.55, 0.15]];
  const fc = flowerCols[Math.floor(r() * flowerCols.length)];
  for (let k = 0; k < 7; k++) {
    const p: Vec3 = [(r() - 0.5) * 0.4, 0.2 + r() * 0.12, (r() - 0.5) * 0.4];
    b.box(p, [0.035, 0.035, 0.035], fc);
  }
  return b.build();
}

/** Scallop shell (ribbed fan). */
export function shellMesh(): MeshData {
  const b = new Builder();
  const col: Vec3 = [0.96, 0.82, 0.74];
  const dark: Vec3 = [0.85, 0.6, 0.55];
  b.surface(16, 4, (u, v) => {
    const a = (u - 0.5) * Math.PI * 0.9;
    const rad = 0.05 * v;
    const rib = 0.004 * Math.cos(u * Math.PI * 16) * v;
    const y = 0.022 * Math.sin(v * Math.PI * 0.5) * (1 - Math.abs(u - 0.5)) + rib;
    return { p: [Math.sin(a) * rad, y, Math.cos(a) * rad - 0.02], n: v3.norm([Math.sin(a) * 0.3, 1, Math.cos(a) * 0.3]) };
  }, col);
  b.box([0, 0.004, -0.024], [0.03, 0.008, 0.012], dark);
  return b.build();
}

/** Five-armed starfish. */
export function starfishMesh(): MeshData {
  const b = new Builder();
  const col: Vec3 = [0.92, 0.28, 0.1];
  const tipc: Vec3 = [1.0, 0.5, 0.25];
  const centre: Vec3 = [0, 0.018, 0];
  for (let k = 0; k < 5; k++) {
    const a0 = (k / 5) * Math.PI * 2;
    const a1 = a0 + Math.PI / 5;
    const am = a0 - Math.PI / 5;
    const tip: Vec3 = [Math.cos(a0) * 0.085, 0.004, Math.sin(a0) * 0.085];
    const l: Vec3 = [Math.cos(a1) * 0.03, 0.006, Math.sin(a1) * 0.03];
    const rr: Vec3 = [Math.cos(am) * 0.03, 0.006, Math.sin(am) * 0.03];
    b.flatTri(centre, l, tip, (p) => mixc(col, tipc, v3.len([p[0], 0, p[2]]) / 0.085));
    b.flatTri(centre, tip, rr, (p) => mixc(col, tipc, v3.len([p[0], 0, p[2]]) / 0.085));
  }
  return b.build();
}

/** Glass bottle lying on its side (floats). */
export function bottleMesh(): MeshData {
  const b = new Builder();
  const glass: Vec3 = [0.12, 0.06, 0.035];
  b.tube([[-0.11, 0.035, 0], [0.05, 0.035, 0]], 0.035, glass, 12, true);
  b.tube([[0.05, 0.035, 0], [0.08, 0.035, 0], [0.12, 0.035, 0]], 0.014, glass, 10, true);
  b.tube([[0.12, 0.035, 0], [0.135, 0.035, 0]], 0.016, [0.7, 0.55, 0.35], 8, true);
  return b.build();
}

/** Red marker buoy (floats). */
export function buoyMesh(): MeshData {
  const b = new Builder();
  const red: Vec3 = [0.85, 0.06, 0.04];
  const white: Vec3 = [0.92, 0.92, 0.9];
  for (const [a, c, d] of icosphere(2)) {
    const s = (p: Vec3): Vec3 => [p[0] * 0.13, p[1] * 0.1 + 0.05, p[2] * 0.13];
    b.flatTri(s(a), s(c), s(d), red);
  }
  b.tube([[0, 0.1, 0], [0, 0.32, 0]], 0.045, red, 12, true);
  b.tube([[0, 0.2, 0], [0, 0.24, 0]], 0.047, white, 12, false);
  b.box([0, 0.36, 0], [0.025, 0.08, 0.025], [0.2, 0.2, 0.2]);
  return b.build();
}

/** Flag on a pole; the cloth is tinted per instance and waves in the vertex shader. */
export function flagMesh(): MeshData {
  const b = new Builder();
  b.tube([[0, -0.03, 0], [0, 0.34, 0]], 0.005, [0.85, 0.82, 0.75], 6, true);
  b.surface(6, 3, (u, v) => {
    const x = u * 0.13;
    const y = 0.33 - v * 0.08 * (1 - u * 0.85) - u * 0.04 * v;
    return { p: [x, y - 0.02 * u, 0], n: [0, 0, 1] };
  }, CLOTH);
  return b.build();
}

/** Weathered wooden pier, 3.2 m long along +x, deck top at y=0. */
export function pierMesh(): MeshData {
  const b = new Builder();
  const r = rng(77);
  const len = 3.2;
  const width = 0.95;
  for (let x = 0; x < len; x += 0.16) {
    const shade = 0.82 + r() * 0.3;
    const wood: Vec3 = [0.55 * shade, 0.49 * shade, 0.41 * shade];
    const m = compose(mat4Translate([x + 0.07, -0.02 + (r() - 0.5) * 0.01, (r() - 0.5) * 0.04]), mat4RotateY((r() - 0.5) * 0.05), mat4RotateX((r() - 0.5) * 0.04));
    const plank = new Builder();
    plank.box([0, 0, 0], [0.13, 0.035, width * (0.94 + r() * 0.08)], wood);
    b.append(plank.build(), m);
  }
  const post: Vec3 = [0.38, 0.33, 0.27];
  for (let x = 0.15; x < len; x += 1.0) {
    for (const z of [-width / 2 + 0.05, width / 2 - 0.05]) {
      b.tube([[x, -1.4, z], [x, 0.12, z]], 0.045, post, 8, true);
    }
  }
  for (const z of [-width / 2 + 0.02, width / 2 - 0.02]) b.box([len / 2, -0.06, z], [len, 0.05, 0.05], post);
  return b.build();
}

/** Mirror a mesh (used to make variants). */
export function scaled(m: MeshData, s: Vec3, rotY = 0, rotZ = 0): MeshData {
  const b = new Builder();
  b.append(m, compose(mat4RotateY(rotY), mat4RotateZ(rotZ), mat4Scale(s)));
  return b.build();
}
