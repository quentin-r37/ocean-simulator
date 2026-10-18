import { Mat4, Vec3, v3 } from '../math';

export interface MeshData {
  vertices: Float32Array; // pos3, normal3, color3
  indices: Uint32Array;
}

export class Builder {
  v: number[] = [];
  i: number[] = [];
  vert(p: Vec3, n: Vec3, c: Vec3): number {
    this.v.push(...p, ...n, ...c);
    return this.v.length / 9 - 1;
  }
  tri(a: number, b: number, c: number): void {
    this.i.push(a, b, c);
  }
  /** Grid surface from a parametric function (u, v in [0,1]). */
  surface(nu: number, nv: number, f: (u: number, v: number) => { p: Vec3; n: Vec3 }, c: Vec3): void {
    const base = this.v.length / 9;
    for (let j = 0; j <= nv; j++) {
      for (let k = 0; k <= nu; k++) {
        const { p, n } = f(k / nu, j / nv);
        this.vert(p, n, c);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let k = 0; k < nu; k++) {
        const a = base + j * (nu + 1) + k;
        const b = a + 1;
        const d = a + nu + 1;
        const e = d + 1;
        this.tri(a, d, b);
        this.tri(b, d, e);
      }
    }
  }
  /** Tube of radius r along a polyline. */
  tube(path: Vec3[], r: number, c: Vec3, seg = 12, caps = true): void {
    const frames = path.map((p, k) => {
      const t = v3.norm(v3.sub(path[Math.min(k + 1, path.length - 1)], path[Math.max(k - 1, 0)]));
      let a: Vec3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const x = v3.norm(v3.cross(a, t));
      a = v3.cross(t, x);
      return { p, x, y: a };
    });
    this.surface(seg, path.length - 1, (u, v) => {
      const f = frames[Math.round(v * (path.length - 1))];
      const ang = u * Math.PI * 2;
      const n = v3.add(v3.scale(f.x, Math.cos(ang)), v3.scale(f.y, Math.sin(ang)));
      return { p: v3.add(f.p, v3.scale(n, r)), n };
    }, c);
    if (caps) {
      for (const end of [0, path.length - 1]) {
        const f = frames[end];
        const t = v3.norm(v3.cross(f.x, f.y));
        const nrm = end === 0 ? v3.scale(t, -1) : t;
        const ctr = this.vert(f.p, nrm, c);
        const ring: number[] = [];
        for (let k = 0; k <= seg; k++) {
          const ang = (k / seg) * Math.PI * 2;
          const n = v3.add(v3.scale(f.x, Math.cos(ang)), v3.scale(f.y, Math.sin(ang)));
          ring.push(this.vert(v3.add(f.p, v3.scale(n, r)), nrm, c));
        }
        for (let k = 0; k < seg; k++) this.tri(ctr, ring[k], ring[k + 1]);
      }
    }
  }

  /** Appends another mesh transformed by `m` (normals use the upper 3x3, assumed rigid or uniformly scaled). */
  append(mesh: MeshData, m: Mat4, color?: Vec3): void {
    const base = this.v.length / 9;
    const vv = mesh.vertices;
    for (let k = 0; k < vv.length; k += 9) {
      const p: Vec3 = [vv[k], vv[k + 1], vv[k + 2]];
      const n: Vec3 = [vv[k + 3], vv[k + 4], vv[k + 5]];
      const tp: Vec3 = [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
      ];
      const tn = v3.norm([
        m[0] * n[0] + m[4] * n[1] + m[8] * n[2],
        m[1] * n[0] + m[5] * n[1] + m[9] * n[2],
        m[2] * n[0] + m[6] * n[1] + m[10] * n[2],
      ]);
      this.vert(tp, tn, color ?? [vv[k + 6], vv[k + 7], vv[k + 8]]);
    }
    for (const i of mesh.indices) this.i.push(base + i);
  }
  /** Flat-shaded triangle (low-poly look). */
  flatTri(a: Vec3, b: Vec3, c: Vec3, col: Vec3 | ((p: Vec3) => Vec3)): void {
    const n = v3.norm(v3.cross(v3.sub(b, a), v3.sub(c, a)));
    const cf = (p: Vec3) => (typeof col === 'function' ? col(p) : col);
    const ia = this.vert(a, n, cf(a));
    const ib = this.vert(b, n, cf(b));
    const ic = this.vert(c, n, cf(c));
    this.tri(ia, ib, ic);
  }
  /** Axis-aligned box. */
  box(c: Vec3, s: Vec3, col: Vec3): void {
    const h = v3.scale(s, 0.5);
    const faces: [Vec3, Vec3, Vec3][] = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
      [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
      [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    ];
    for (const [n, u, w] of faces) {
      const o: Vec3 = [c[0] + n[0] * h[0], c[1] + n[1] * h[1], c[2] + n[2] * h[2]];
      const U = v3.scale(u, u[0] * h[0] + u[1] * h[1] + u[2] * h[2]);
      const W = v3.scale(w, w[0] * h[0] + w[1] * h[1] + w[2] * h[2]);
      const p = [v3.sub(v3.sub(o, U), W), v3.sub(v3.add(o, U), W), v3.add(v3.add(o, U), W), v3.add(v3.sub(o, U), W)];
      const ids = p.map((q) => this.vert(q, n, col));
      this.tri(ids[0], ids[1], ids[2]);
      this.tri(ids[0], ids[2], ids[3]);
    }
  }
  build(): MeshData {
    return { vertices: new Float32Array(this.v), indices: new Uint32Array(this.i) };
  }
}


/** Unit icosphere triangles (subdivided), returned as a flat list of vertex triplets. */
export function icosphere(sub: number): Vec3[][] {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: Vec3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((p) => v3.norm(p as Vec3));
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < sub; s++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let m = cache.get(key);
      if (m === undefined) {
        m = verts.length;
        verts = [...verts, v3.norm(v3.scale(v3.add(verts[a], verts[b]), 0.5))];
        cache.set(key, m);
      }
      return m;
    };
    const next: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return faces.map((f) => f.map((i) => verts[i]));
}
