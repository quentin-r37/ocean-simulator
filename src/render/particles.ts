import { compose, mat4RotateX, mat4RotateY, mat4Scale, mat4Translate, Vec3 } from '../math';
import { molds, toolSpec } from '../sim/params';
import { isMold, Mode, Tools } from '../tools/tools';
import { DrawItem, SAND_TINT } from './toolMesh';

interface Particle {
  p: Vec3;
  v: Vec3;
  floor: number;
  age: number;
  life: number;
  size: number;
  spin: number;
  tint: [number, number, number, number];
  water: boolean;
}

const WATER_TINT: [number, number, number, number] = [0.75, 0.9, 0.95, 1];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Sand clods and droplets thrown by the tools (CPU-simulated, drawn as small tinted boxes). */
export class Particles {
  private list: Particle[] = [];
  private acc = 0;

  constructor(private max: number) {}

  update(tools: Tools, dt: number): DrawItem[] {
    const hit = tools.hit;
    const inv = tools.inventory;
    const sand = SAND_TINT(hit.moisture);
    if (hit.valid) {
      const [x, y, z] = hit.pos;
      let rate = 0;
      let kind: 'spray' | 'throw' | 'fall' | 'drip' | 'shave' = 'spray';
      switch (tools.mode) {
        case Mode.Dig:
          rate = tools.biting ? 70 : 8;
          // Full shovel: the spoil flies onto the heap beyond the hole.
          if (inv.shovelSand >= toolSpec.shovelCap * 0.98) kind = 'throw';
          break;
        case Mode.Dump:
          if (inv.shovelSand > 1e-5) {
            rate = 60;
            kind = 'fall';
          }
          break;
        case Mode.Fill:
          rate = 35;
          if (inv.bucketWater > 1e-6 || hit.isWater) kind = 'drip';
          break;
        case Mode.Pour:
          rate = 60;
          kind = 'drip';
          break;
        case Mode.Carve:
          rate = 40;
          kind = 'shave';
          break;
        case Mode.Pat:
        case Mode.Smooth:
        case Mode.Flatten:
          rate = 12;
          kind = 'shave';
          break;
      }
      this.acc += rate * dt;
      while (this.acc >= 1) {
        this.acc -= 1;
        const a = Math.random() * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        if (kind === 'spray') {
          const h = rnd(0.6, 1.6);
          this.spawn([x + c * 0.1, y + 0.02, z + s * 0.1], [c * h, rnd(1.8, 3.2), s * h], y - 0.2, rnd(0.045, 0.085), sand, false);
        } else if (kind === 'throw') {
          const [dx, dz] = tools.digDir;
          const j = rnd(-0.4, 0.4), h = rnd(1.2, 2.2);
          const tx = dx - dz * j, tz = dz + dx * j;
          this.spawn([x + c * 0.05, y + 0.02, z + s * 0.05], [tx * h, rnd(2.2, 3.2), tz * h], y - 0.2, rnd(0.045, 0.085), sand, false);
        } else if (kind === 'fall') {
          this.spawn([x + c * 0.08, y + 0.35, z + s * 0.08], [c * 0.3, rnd(-0.5, 0.3), s * 0.3], y - 0.05, rnd(0.05, 0.09), SAND_TINT(inv.shovelM), false);
        } else if (kind === 'drip') {
          this.spawn([x + c * 0.15, y + 0.3, z + s * 0.15], [c * 0.6, rnd(0.5, 1.6), s * 0.6], y - 0.1, rnd(0.025, 0.045), WATER_TINT, true);
        } else {
          this.spawn([x, y + 0.01, z], [c * 0.5, rnd(0.6, 1.3), s * 0.5], y - 0.1, rnd(0.02, 0.035), sand, false);
        }
      }
      for (const e of tools.events) {
        if (e === 'decorAdd' || e === 'decorRemove') {
          for (let k = 0; k < 10; k++) {
            const a = Math.random() * Math.PI * 2;
            this.spawn([x, y + 0.03, z], [Math.cos(a) * 0.8, rnd(1, 2), Math.sin(a) * 0.8], y - 0.1, rnd(0.015, 0.03), sand, false);
          }
        }
      }
    } else {
      this.acc = 0;
    }
    // Puff of sand around the base when the mould lands upside down.
    if (isMold(tools.tool) && tools.flipAge >= 0.28 && tools.flipAge - dt < 0.28 && hit.valid) {
      const spec = molds[tools.tool];
      const R = tools.tool === 'wall' ? spec.halfLen : spec.rBase;
      for (let k = 0; k < 28; k++) {
        const a = Math.random() * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        const [x, y, z] = hit.pos;
        this.spawn([x + c * R, y + 0.03, z + s * R], [c * rnd(0.8, 1.8), rnd(0.6, 1.6), s * rnd(0.8, 1.8)], y - 0.1, rnd(0.035, 0.065), SAND_TINT(Math.max(inv.bucketM, 0.3)), false);
      }
    }

    const items: DrawItem[] = [];
    this.list = this.list.filter((q) => {
      q.age += dt;
      q.v[1] -= 9.81 * dt;
      q.p[0] += q.v[0] * dt;
      q.p[1] += q.v[1] * dt;
      q.p[2] += q.v[2] * dt;
      if (q.p[1] < q.floor) return false;
      if (q.age > q.life) return false;
      const k = 1 - Math.pow(q.age / q.life, 3);
      const sz = q.size * k;
      items.push({
        mesh: 'box',
        model: compose(mat4Translate(q.p), mat4RotateY(q.spin * q.age), mat4RotateX(q.spin * 0.7 * q.age + q.spin), mat4Scale([sz, sz, sz])),
        tint: q.tint,
        params: [q.water ? 0.1 : 0.85, q.water ? 0 : 1, 0, 0],
      });
      return true;
    });
    return items;
  }

  private spawn(p: Vec3, v: Vec3, floor: number, size: number, tint: [number, number, number, number], water: boolean): void {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ p, v, floor, age: 0, life: rnd(0.5, 0.9), size, spin: rnd(-8, 8), tint, water });
  }
}
