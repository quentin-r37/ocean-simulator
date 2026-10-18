import { computePipeline, createBuffer, Readback, STORAGE, UNIFORM } from '../gpu/utils';
import type { Input } from '../input/input';
import type { IsoCamera } from '../camera/isoCamera';
import type { Simulation } from '../sim/simulation';
import { MoldKind, molds, TOOL_SCALE, toolSpec } from '../sim/params';
import type { Vec3 } from '../math';
import { DECOR, DecorSet } from '../world/decor';

import pickWgsl from './shaders/pick.wgsl?raw';
import toolsWgsl from './shaders/tools.wgsl?raw';

export type ToolKind = 'shovel' | 'bucket' | 'crenel' | 'wall' | 'trowel' | 'decor' | 'giant';

export const TOOL_ORDER: ToolKind[] = ['shovel', 'bucket', 'crenel', 'wall', 'trowel', 'decor', 'giant'];

export enum Mode {
  None = 0,
  Dig = 1,
  Dump = 2,
  Pat = 3,
  Fill = 4,
  Flip = 5,
  Pour = 6,
  Carve = 7,
  Smooth = 8,
  Flatten = 9,
}

const HIT_OFFSET = 0;
const INV_OFFSET = 256;
const MOLD_TYPE: Record<MoldKind, number> = { bucket: 0, crenel: 1, wall: 2, giant: 3 };

export interface Inventory {
  shovelSand: number;
  shovelM: number;
  bucketSand: number;
  bucketM: number;
  bucketWater: number;
  flips: number;
}

export interface Hit {
  valid: boolean;
  pos: Vec3;
  normal: Vec3;
  isWater: boolean;
  waterDepth: number;
  sand: number;
  moisture: number;
  compaction: number;
}

export type ToolEvent = 'flip' | 'decorAdd' | 'decorRemove';

export const isMold = (t: ToolKind): t is MoldKind => t === 'bucket' || t === 'crenel' || t === 'wall' || t === 'giant';

export class Tools {
  tool: ToolKind = 'shovel';
  mode: Mode = Mode.None;
  /** Seconds since the last mould flip (for the animation). */
  flipAge = 99;
  /** Orientation of the wall mould (radians). */
  moldAngle = 0;
  /** Discrete events of the last update (for sounds and particles). */
  events: ToolEvent[] = [];
  /** Selected decoration (index into DECOR). */
  decorKind = 0;
  decorSeed = Math.random();
  inventory: Inventory = { shovelSand: 0, shovelM: 0, bucketSand: 0, bucketM: 0, bucketWater: 0, flips: 0 };
  hit: Hit = {
    valid: false, pos: [0, 0, 0], normal: [0, 1, 0], isWater: false,
    waterDepth: 0, sand: 0, moisture: 0, compaction: 0,
  };
  /** Height the trowel levels to (taken when the click starts). */
  private flattenTarget = 0;

  private hitBuf: GPUBuffer;
  private invBuf: GPUBuffer;
  private state: GPUBuffer; // hit + inventory gathered for the readback
  private pickU: GPUBuffer;
  private toolU: GPUBuffer;
  private pickPipe: GPUComputePipeline;
  private toolPipe: GPUComputePipeline;
  private pickGroup: GPUBindGroup;
  private toolGroup: GPUBindGroup;
  private readback: Readback;
  private flipLatched = false;
  /** A click always performs a full stroke, even if the button is released at once (trackpad tap). */
  private stroke = 0;
  private pickData = new ArrayBuffer(48);
  private toolData = new ArrayBuffer(96);

  constructor(private device: GPUDevice, private sim: Simulation, private decor: DecorSet) {
    this.hitBuf = createBuffer(device, 48, STORAGE, 'toolHit');
    this.invBuf = createBuffer(device, 32, STORAGE, 'toolInventory');
    this.state = createBuffer(device, INV_OFFSET + 32, STORAGE, 'toolState');
    this.pickU = createBuffer(device, 48, UNIFORM, 'pickU');
    this.toolU = createBuffer(device, 96, UNIFORM, 'toolU');
    this.pickPipe = computePipeline(device, pickWgsl, 'pick');
    this.toolPipe = computePipeline(device, toolsWgsl, 'tools');
    this.pickGroup = device.createBindGroup({
      layout: this.pickPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.pickU } },
        { binding: 1, resource: { buffer: sim.ground[0] } },
        { binding: 2, resource: { buffer: sim.water } },
        { binding: 3, resource: { buffer: this.hitBuf } },
      ],
    });
    this.toolGroup = device.createBindGroup({
      layout: this.toolPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.toolU } },
        { binding: 1, resource: { buffer: sim.ground[0] } },
        { binding: 2, resource: { buffer: sim.water } },
        { binding: 3, resource: { buffer: this.invBuf } },
        { binding: 4, resource: { buffer: this.hitBuf } },
      ],
    });
    this.readback = new Readback(device, INV_OFFSET + 32, 3, 'toolReadback');
  }

  resetInventory(): void {
    this.device.queue.writeBuffer(this.invBuf, 0, new Float32Array(8));
    this.inventory = { shovelSand: 0, shovelM: 0, bucketSand: 0, bucketM: 0, bucketWater: 0, flips: 0 };
  }

  select(tool: ToolKind): void {
    this.tool = tool;
  }

  selectDecor(kind: number): void {
    this.decorKind = kind;
    this.tool = 'decor';
  }

  /** Placeable decorations, in palette order. */
  static palette(): number[] {
    return DECOR.map((k, i) => (k.placeable ? i : -1)).filter((i) => i >= 0);
  }

  /** Radius of the tool footprint shown by the cursor. */
  cursorRadius(alt: boolean, shift: boolean): number {
    switch (this.tool) {
      case 'shovel':
        return alt ? toolSpec.patRadius : toolSpec.shovelRadius;
      case 'trowel':
        return alt ? toolSpec.trowelFlattenRadius : shift ? toolSpec.trowelSmoothRadius : toolSpec.trowelCarveRadius;
      case 'wall':
        return molds.wall.halfWBase;
      case 'decor':
        return 0.12;
      default:
        return molds[this.tool].rBase;
    }
  }

  /** Decides the tool action from the input state. */
  update(input: Input, dt: number, uiBlocked: boolean): void {
    this.events.length = 0;
    TOOL_ORDER.forEach((t, i) => {
      if (input.hit(`Digit${i + 1}`) || input.hit(`Numpad${i + 1}`)) this.tool = t;
    });
    if (input.hit('KeyF')) this.moldAngle = (this.moldAngle + Math.PI / 4) % Math.PI;
    if (input.hit('KeyC')) {
      const pal = Tools.palette();
      const at = pal.indexOf(this.decorKind);
      this.selectDecor(pal[(at + (input.shift ? pal.length - 1 : 1)) % pal.length]);
    }
    this.flipAge += dt;

    let mode = Mode.None;
    if (input.leftPressed && !uiBlocked && !input.right) this.stroke = this.strokeTime();
    else this.stroke = Math.max(0, this.stroke - dt);
    const active = (input.left || this.stroke > 0) && !uiBlocked && !input.right;
    if (active) {
      switch (this.tool) {
        case 'shovel':
          mode = input.alt ? Mode.Pat : input.shift ? Mode.Dump : Mode.Dig;
          break;
        case 'trowel':
          if (input.leftPressed && this.hit.valid) this.flattenTarget = this.hit.pos[1];
          mode = input.alt ? Mode.Flatten : input.shift ? Mode.Smooth : Mode.Carve;
          break;
        case 'decor':
          if (input.leftPressed && this.hit.valid) {
            const [x, , z] = this.hit.pos;
            if (input.shift) {
              this.decor.removeNear(x, z, 0.3);
              this.events.push('decorRemove');
            } else {
              this.decor.add(this.decorKind, x, z, this.decorSeed);
              this.events.push('decorAdd');
              this.decorSeed = Math.random();
            }
          }
          break;
        default:
          if (input.shift) {
            if (input.leftPressed && this.inventory.bucketSand > 1e-6) {
              mode = Mode.Flip;
              this.flipLatched = true;
              this.flipAge = 0;
              this.stroke = 0;
              this.events.push('flip');
            } else if (!this.flipLatched && this.inventory.bucketWater > 1e-6) {
              mode = Mode.Pour;
            }
          } else {
            mode = Mode.Fill;
          }
      }
    }
    if (!input.left && this.stroke <= 0) this.flipLatched = false;
    this.mode = mode;
  }

  private strokeTime(): number {
    switch (this.tool) {
      case 'shovel':
        return toolSpec.digTime;
      case 'trowel':
        return 0.15;
      case 'decor':
        return 0;
      case 'giant':
        return toolSpec.giantFillTime;
      default:
        return toolSpec.fillTime;
    }
  }

  encode(encoder: GPUCommandEncoder, cam: IsoCamera, mouse: [number, number], size: [number, number], dt: number, alt: boolean, shift: boolean): void {
    const { origin, dir } = cam.ray(mouse[0], mouse[1], size[0], size[1]);
    const pf = new Float32Array(this.pickData);
    const pu = new Uint32Array(this.pickData);
    pf.set([origin[0], origin[1], origin[2], 0, dir[0], dir[1], dir[2], 0]);
    pu[8] = this.sim.n;
    pf[10] = this.sim.dx;
    this.device.queue.writeBuffer(this.pickU, 0, this.pickData);

    const moldKind: MoldKind = isMold(this.tool) ? this.tool : 'bucket';
    const mold = molds[moldKind];
    const tf = new Float32Array(this.toolData);
    const tu = new Uint32Array(this.toolData);
    tu[0] = this.mode;
    tu[1] = this.sim.n;
    tu[2] = this.sim.frame;
    tu[3] = MOLD_TYPE[moldKind];
    tf[4] = this.sim.dx;
    tf[5] = dt;
    tf[6] = this.sim.seaLevel;
    const giant = this.tool === 'giant';
    tf[7] = this.mode === Mode.Fill ? (giant ? toolSpec.giantFillRadius : toolSpec.fillRadius) : this.cursorRadius(alt, shift);
    tf[8] = toolSpec.shovelCap;
    tf[9] = mold.cap;
    tf[10] = mold.rBase;
    tf[11] = mold.rTop;
    tf[12] = mold.height;
    tf[13] = mold.merlon;
    tf[14] = mold.halfLen;
    tf[15] = mold.halfWBase;
    tf[16] = mold.halfWTop;
    tf[17] = this.moldAngle;
    tf[18] = this.flattenTarget;
    tf[19] = toolSpec.shovelCap / toolSpec.digTime;
    tf[20] = mold.cap / (giant ? toolSpec.giantFillTime : toolSpec.fillTime);
    tf[21] = TOOL_SCALE;
    // Cells per thread side of the workgroup window: 16×8 = 128 cells, 16×16 = 256 for the giant bucket.
    tf[22] = giant ? 16 : 8;
    this.device.queue.writeBuffer(this.toolU, 0, this.toolData);

    const pass = encoder.beginComputePass({ label: 'tools' });
    pass.setPipeline(this.pickPipe);
    pass.setBindGroup(0, this.pickGroup);
    pass.dispatchWorkgroups(1);
    if (this.mode !== Mode.None) {
      pass.setPipeline(this.toolPipe);
      pass.setBindGroup(0, this.toolGroup);
      pass.dispatchWorkgroups(1);
    }
    pass.end();
  }

  encodeReadback(encoder: GPUCommandEncoder): (() => void) | null {
    encoder.copyBufferToBuffer(this.hitBuf, 0, this.state, HIT_OFFSET, 48);
    encoder.copyBufferToBuffer(this.invBuf, 0, this.state, INV_OFFSET, 32);
    return this.readback.copy(encoder, this.state);
  }

  /** Pulls the latest readback into CPU-side state. */
  sync(): void {
    const r = this.readback.latest;
    if (!r) return;
    const h = this.hit;
    h.valid = r[3] > 0.5;
    if (h.valid) {
      h.pos = [r[0], r[1], r[2]];
      h.normal = [r[4], r[5], r[6]];
      h.isWater = r[7] > 0.5;
      h.waterDepth = r[8];
      h.sand = r[9];
      h.moisture = r[10];
      h.compaction = r[11];
    }
    const k = INV_OFFSET / 4;
    const inv = this.inventory;
    inv.shovelSand = r[k];
    inv.shovelM = r[k + 1];
    inv.bucketSand = r[k + 2];
    inv.bucketM = r[k + 3];
    inv.bucketWater = r[k + 4];
    inv.flips = r[k + 5];
  }
}
