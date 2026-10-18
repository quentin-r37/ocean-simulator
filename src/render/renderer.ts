import type { GpuContext } from '../gpu/device';
import { createBuffer, UNIFORM } from '../gpu/utils';
import { compose, mat4Invert, mat4LookAt, mat4Mul, mat4Ortho, mat4ReflectY, Mat4, Vec3, v3 } from '../math';
import type { IsoCamera } from '../camera/isoCamera';
import type { Simulation } from '../sim/simulation';
import { settings } from '../sim/params';
import { DrawItem, toolMeshes, ToolMeshId } from './toolMesh';
import type { MeshData } from './meshBuilder';
import { DECOR, DecorSet, INSTANCE_FLOATS, MAX_DECOR } from '../world/decor';

import commonWgsl from './shaders/common.wgsl?raw';
import lightingWgsl from './shaders/lighting.wgsl?raw';
import surfaceWgsl from './shaders/surface.wgsl?raw';
import wavesWgsl from '../shaders/waves.wgsl?raw';
import skyWgsl from './shaders/sky.wgsl?raw';
import skyboxWgsl from './shaders/skybox.wgsl?raw';
import terrainWgsl from './shaders/terrain.wgsl?raw';
import waterWgsl from './shaders/water.wgsl?raw';
import meshWgsl from './shaders/mesh.wgsl?raw';
import decorWgsl from './shaders/decor.wgsl?raw';
import dioramaWgsl from './shaders/diorama.wgsl?raw';
import postWgsl from './shaders/post.wgsl?raw';

const HDR: GPUTextureFormat = 'rgba16float';
const DEPTH: GPUTextureFormat = 'depth32float';
const SHADOW_SIZE = 4096;
const CAM_BYTES = 320;
const SKY_W = 512;
const SKY_H = 256;
const MAX_OBJECTS = 72; // tools + their contents + sand particles
const BLOOM_LEVELS = 6;

export interface DecorPreview {
  kind: number;
  variant: number;
  x: number;
  z: number;
  seed: number;
}

export interface FrameInfo {
  camera: IsoCamera;
  time: number;
  waveTime: number;
  seaLevel: number;
  boundaryDepth: number;
  cursor: { x: number; z: number; radius: number; visible: boolean; water: boolean; wallHalfLen: number; wallAngle: number };
  items: DrawItem[];
  decor: DecorSet;
  preview: DecorPreview | null;
}

interface MeshGpu {
  vbuf: GPUBuffer;
  ibuf: GPUBuffer;
  count: number;
}

type Pass = 'main' | 'refl' | 'shadow';

const VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: 36,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'float32x3' },
  ],
};

export class Renderer {
  private device: GPUDevice;
  private width = 1;
  private height = 1;

  private camBuf: Record<Pass, GPUBuffer>;
  private camData = new ArrayBuffer(CAM_BYTES);
  private skyTex: GPUTexture;
  private skyData: GPUBuffer;
  private skyU: GPUBuffer;
  private skyBakePipe: GPUComputePipeline;
  private skyIntPipe: GPUComputePipeline;
  private skyBakeGroup: GPUBindGroup;
  private skyIntGroup: GPUBindGroup;
  private lastSunKey = '';

  private shadowTex: GPUTexture;
  private linSampler: GPUSampler;
  private clampSampler: GPUSampler;
  private shadowSampler: GPUSampler;

  private layouts!: { scene: GPUBindGroupLayout; shadowRead: GPUBindGroupLayout; waterTex: GPUBindGroupLayout; obj: GPUBindGroupLayout; empty: GPUBindGroupLayout };
  private pipes!: Record<
    | 'sky' | 'terrain' | 'terrainShadow' | 'water' | 'wside' | 'floor' | 'side' | 'sideShadow'
    | 'decor' | 'decorShadow' | 'mesh' | 'meshShadow' | 'down' | 'up' | 'tonemap' | 'fxaa',
    GPURenderPipeline
  >;
  private sceneGroups!: Record<Pass, GPUBindGroup>;
  private shadowReadGroup!: GPUBindGroup;
  private emptyGroup!: GPUBindGroup;
  private waterTexGroup!: GPUBindGroup;
  private postGroups: Record<string, GPUBindGroup> = {};
  private objBufs: GPUBuffer[] = [];
  private objGroups: GPUBindGroup[] = [];
  private toolMeshGpu: Record<ToolMeshId, MeshGpu>;
  private postU: GPUBuffer[] = [];

  // Decorations: one merged mesh buffer, an instance buffer and per-variant index ranges.
  private decorV: GPUBuffer;
  private decorI: GPUBuffer;
  private decorParts: { firstIndex: number; count: number; baseVertex: number }[][] = [];
  private decorInst: GPUBuffer;
  private decorRanges: { kind: number; variant: number; first: number; count: number }[] = [];

  // Size-dependent targets.
  private sceneTex!: GPUTexture;
  private refrTex!: GPUTexture;
  private depthTex!: GPUTexture;
  private reflTex!: GPUTexture;
  private reflDepth!: GPUTexture;
  private bloomTex: GPUTexture[] = [];
  private ldrTex!: GPUTexture;

  constructor(private gpu: GpuContext, private sim: Simulation) {
    const device = (this.device = gpu.device);
    this.camBuf = {
      main: createBuffer(device, CAM_BYTES, UNIFORM, 'camMain'),
      refl: createBuffer(device, CAM_BYTES, UNIFORM, 'camRefl'),
      shadow: createBuffer(device, CAM_BYTES, UNIFORM, 'camShadow'),
    };
    this.skyTex = device.createTexture({
      size: [SKY_W, SKY_H],
      format: HDR,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      label: 'sky',
    });
    this.skyData = createBuffer(device, 64, GPUBufferUsage.STORAGE, 'skyData');
    this.skyU = createBuffer(device, 32, UNIFORM, 'skyU');
    this.shadowTex = device.createTexture({
      size: [SHADOW_SIZE, SHADOW_SIZE],
      format: DEPTH,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: 'shadow',
    });
    this.linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge' });
    this.clampSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.shadowSampler = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });

    const skyModule = device.createShaderModule({ code: commonWgsl + skyWgsl, label: 'sky' });
    this.skyBakePipe = device.createComputePipeline({ layout: 'auto', compute: { module: skyModule, entryPoint: 'bake' } });
    this.skyIntPipe = device.createComputePipeline({ layout: 'auto', compute: { module: skyModule, entryPoint: 'integrate' } });
    this.skyBakeGroup = device.createBindGroup({
      layout: this.skyBakePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.skyU } },
        { binding: 1, resource: this.skyTex.createView() },
      ],
    });
    this.skyIntGroup = device.createBindGroup({
      layout: this.skyIntPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.skyU } },
        { binding: 2, resource: this.skyTex.createView() },
        { binding: 3, resource: { buffer: this.skyData } },
      ],
    });

    // Decorations.
    const merged = mergeMeshes(DECOR.map((k) => k.meshes));
    this.decorV = createBuffer(device, merged.vertices.byteLength, GPUBufferUsage.VERTEX, 'decorV', merged.vertices);
    this.decorI = createBuffer(device, merged.indices.byteLength, GPUBufferUsage.INDEX, 'decorI', merged.indices);
    this.decorParts = merged.parts;
    this.decorInst = createBuffer(device, MAX_DECOR * INSTANCE_FLOATS * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'decorInst');

    this.createLayouts();
    this.createPipelines();
    this.createGroups();

    const upload = (m: MeshData): MeshGpu => ({
      vbuf: createBuffer(device, m.vertices.byteLength, GPUBufferUsage.VERTEX, 'mesh-v', m.vertices),
      ibuf: createBuffer(device, m.indices.byteLength, GPUBufferUsage.INDEX, 'mesh-i', m.indices),
      count: m.indices.length,
    });
    const tm = toolMeshes();
    this.toolMeshGpu = Object.fromEntries(Object.entries(tm).map(([k, m]) => [k, upload(m)])) as Record<ToolMeshId, MeshGpu>;
    for (let i = 0; i < MAX_OBJECTS; i++) {
      const buf = createBuffer(device, 96, UNIFORM, `obj${i}`);
      this.objBufs.push(buf);
      this.objGroups.push(device.createBindGroup({ layout: this.layouts.obj, entries: [{ binding: 0, resource: { buffer: buf } }] }));
    }
    for (let i = 0; i < BLOOM_LEVELS * 2 + 2; i++) this.postU.push(createBuffer(device, 16, UNIFORM, `post${i}`));
  }

  private createLayouts(): void {
    const d = this.device;
    const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    const F = GPUShaderStage.FRAGMENT;
    const ro: GPUBufferBindingLayout = { type: 'read-only-storage' };
    this.layouts = {
      scene: d.createBindGroupLayout({
        label: 'scene',
        entries: [
          { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
          { binding: 1, visibility: VF, buffer: ro },
          { binding: 2, visibility: VF, buffer: ro },
          { binding: 3, visibility: VF, texture: { sampleType: 'float' } },
          { binding: 4, visibility: VF, sampler: { type: 'filtering' } },
          { binding: 5, visibility: VF, buffer: ro },
          { binding: 8, visibility: VF, buffer: ro },
          { binding: 12, visibility: VF, buffer: ro },
        ],
      }),
      shadowRead: d.createBindGroupLayout({
        label: 'shadowRead',
        entries: [
          { binding: 6, visibility: F, texture: { sampleType: 'depth' } },
          { binding: 7, visibility: F, sampler: { type: 'comparison' } },
        ],
      }),
      waterTex: d.createBindGroupLayout({
        label: 'waterTex',
        entries: [
          { binding: 9, visibility: F, texture: { sampleType: 'float' } },
          { binding: 10, visibility: F, texture: { sampleType: 'depth' } },
          { binding: 11, visibility: F, texture: { sampleType: 'float' } },
        ],
      }),
      obj: d.createBindGroupLayout({ label: 'obj', entries: [{ binding: 0, visibility: VF, buffer: { type: 'uniform' } }] }),
      empty: d.createBindGroupLayout({ label: 'empty', entries: [] }),
    };
  }

  private createPipelines(): void {
    const d = this.device;
    const L = this.layouts;
    const mod = (code: string, label: string) => d.createShaderModule({ code, label });
    const scene = (code: string, label: string, surface = false) =>
      mod(commonWgsl + lightingWgsl + wavesWgsl + (surface ? surfaceWgsl : '') + code, label);
    const terrainMod = scene(terrainWgsl, 'terrain');
    const waterMod = scene(waterWgsl, 'water');
    const meshMod = scene(meshWgsl, 'mesh');
    const decorMod = scene(decorWgsl, 'decor', true);
    const dioramaMod = scene(dioramaWgsl, 'diorama', true);
    const skyMod = mod(commonWgsl + skyboxWgsl, 'skybox');
    const postMod = mod(commonWgsl + postWgsl, 'post');

    const pl = (...groups: GPUBindGroupLayout[]) => d.createPipelineLayout({ bindGroupLayouts: groups });
    const litLayout = pl(L.scene, L.shadowRead);
    const casterLayout = pl(L.scene);
    const waterLayout = pl(L.scene, L.shadowRead, L.waterTex);
    const meshLayout = pl(L.scene, L.shadowRead, L.obj);
    const meshShadowLayout = pl(L.scene, L.empty, L.obj);

    const reversedDepth: GPUDepthStencilState = { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' };
    const readDepth: GPUDepthStencilState = { format: DEPTH, depthWriteEnabled: false, depthCompare: 'greater' };
    const shadowDepth: GPUDepthStencilState = { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.5 };
    const strip: GPUPrimitiveState = { topology: 'triangle-strip', cullMode: 'none' };
    const list: GPUPrimitiveState = { topology: 'triangle-list', cullMode: 'none' };
    const hdr: GPUColorTargetState[] = [{ format: HDR }];

    const lit = (
      label: string, layout: GPUPipelineLayout, module: GPUShaderModule, vs: string, fs: string,
      prim: GPUPrimitiveState, depth = reversedDepth, buffers: GPUVertexBufferLayout[] = [],
    ) =>
      d.createRenderPipeline({
        label, layout, primitive: prim, depthStencil: depth,
        vertex: { module, entryPoint: vs, buffers },
        fragment: { module, entryPoint: fs, targets: hdr },
      });
    const caster = (label: string, layout: GPUPipelineLayout, module: GPUShaderModule, vs: string, prim: GPUPrimitiveState, buffers: GPUVertexBufferLayout[] = []) =>
      d.createRenderPipeline({ label, layout, primitive: prim, depthStencil: shadowDepth, vertex: { module, entryPoint: vs, buffers } });
    const fullscreen = (entry: string, format: GPUTextureFormat, blend?: GPUBlendState) =>
      d.createRenderPipeline({
        label: entry,
        layout: 'auto',
        vertex: { module: postMod, entryPoint: 'vs' },
        fragment: { module: postMod, entryPoint: entry, targets: [{ format, blend }] },
        primitive: { topology: 'triangle-list' },
      });

    this.pipes = {
      sky: lit('skybox', litLayout, skyMod, 'vs', 'fs', list, { format: DEPTH, depthWriteEnabled: false, depthCompare: 'always' }),
      terrain: lit('terrain', litLayout, terrainMod, 'vs_main', 'fs_main', strip),
      terrainShadow: caster('terrainShadow', casterLayout, terrainMod, 'vs_main', strip),
      water: lit('water', waterLayout, waterMod, 'vs_main', 'fs_main', strip, readDepth),
      wside: lit('waterSide', litLayout, dioramaMod, 'vs_wside', 'fs_wside', strip, readDepth),
      floor: lit('floor', litLayout, dioramaMod, 'vs_floor', 'fs_floor', list),
      side: lit('side', litLayout, dioramaMod, 'vs_side', 'fs_side', strip),
      sideShadow: caster('sideShadow', casterLayout, dioramaMod, 'vs_side', strip),
      decor: lit('decor', litLayout, decorMod, 'vs_main', 'fs_main', list, reversedDepth, [VERTEX_LAYOUT]),
      decorShadow: caster('decorShadow', casterLayout, decorMod, 'vs_main', list, [VERTEX_LAYOUT]),
      mesh: lit('mesh', meshLayout, meshMod, 'vs_main', 'fs_main', list, reversedDepth, [VERTEX_LAYOUT]),
      meshShadow: caster('meshShadow', meshShadowLayout, meshMod, 'vs_main', list, [VERTEX_LAYOUT]),
      down: fullscreen('down', HDR),
      up: fullscreen('up', HDR, {
        color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      }),
      tonemap: fullscreen('tonemap', 'rgba8unorm'),
      fxaa: fullscreen('fxaa', this.gpu.canvasFormat),
    };
  }

  private createGroups(): void {
    const d = this.device;
    const sim = this.sim;
    const skyView = this.skyTex.createView();
    const sceneFor = (cam: GPUBuffer) =>
      d.createBindGroup({
        layout: this.layouts.scene,
        entries: [
          { binding: 0, resource: { buffer: cam } },
          { binding: 1, resource: { buffer: sim.ground[0] } },
          { binding: 2, resource: { buffer: sim.water } },
          { binding: 3, resource: skyView },
          { binding: 4, resource: this.linSampler },
          { binding: 5, resource: { buffer: this.skyData } },
          { binding: 8, resource: { buffer: sim.aux[0] } },
          { binding: 12, resource: { buffer: this.decorInst } },
        ],
      });
    this.sceneGroups = { main: sceneFor(this.camBuf.main), refl: sceneFor(this.camBuf.refl), shadow: sceneFor(this.camBuf.shadow) };
    this.shadowReadGroup = d.createBindGroup({
      layout: this.layouts.shadowRead,
      entries: [
        { binding: 6, resource: this.shadowTex.createView() },
        { binding: 7, resource: this.shadowSampler },
      ],
    });
    this.emptyGroup = d.createBindGroup({ layout: this.layouts.empty, entries: [] });
  }

  resize(cssW: number, cssH: number): void {
    const scale = settings.renderScale;
    const w = Math.max(1, Math.floor(cssW * scale));
    const h = Math.max(1, Math.floor(cssH * scale));
    if (w === this.width && h === this.height && this.sceneTex) return;
    this.width = w;
    this.height = h;
    this.gpu.canvas.width = w;
    this.gpu.canvas.height = h;
    const d = this.device;
    for (const t of [this.sceneTex, this.refrTex, this.depthTex, this.reflTex, this.reflDepth, this.ldrTex, ...this.bloomTex]) t?.destroy();
    const tex = (size: [number, number], format: GPUTextureFormat, usage: number, label: string) =>
      d.createTexture({ size, format, usage, label });
    const RA = GPUTextureUsage.RENDER_ATTACHMENT;
    const TB = GPUTextureUsage.TEXTURE_BINDING;
    this.sceneTex = tex([w, h], HDR, RA | TB | GPUTextureUsage.COPY_SRC, 'scene');
    this.refrTex = tex([w, h], HDR, TB | GPUTextureUsage.COPY_DST, 'refraction');
    this.depthTex = tex([w, h], DEPTH, RA | TB, 'depth');
    const rw = Math.max(1, w >> 1), rh = Math.max(1, h >> 1);
    this.reflTex = tex([rw, rh], HDR, RA | TB, 'reflection');
    this.reflDepth = tex([rw, rh], DEPTH, RA, 'reflDepth');
    this.ldrTex = tex([w, h], 'rgba8unorm', RA | TB, 'ldr');
    this.bloomTex = [];
    let bw = w, bh = h;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
      this.bloomTex.push(tex([bw, bh], HDR, RA | TB, `bloom${i}`));
    }

    this.waterTexGroup = d.createBindGroup({
      layout: this.layouts.waterTex,
      entries: [
        { binding: 9, resource: this.refrTex.createView() },
        { binding: 10, resource: this.depthTex.createView() },
        { binding: 11, resource: this.reflTex.createView() },
      ],
    });
    const p = this.pipes;
    const post = (pipe: GPURenderPipeline, src: GPUTexture, u: GPUBuffer, bloom?: GPUTexture) => {
      const e: GPUBindGroupEntry[] = [
        { binding: 0, resource: src.createView() },
        { binding: 1, resource: this.clampSampler },
        { binding: 2, resource: { buffer: u } },
      ];
      if (bloom) e.push({ binding: 3, resource: bloom.createView() });
      return d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: e });
    };
    const g: Record<string, GPUBindGroup> = {};
    for (let i = 0; i < BLOOM_LEVELS; i++) g[`down${i}`] = post(p.down, i === 0 ? this.sceneTex : this.bloomTex[i - 1], this.postU[i]);
    for (let i = 0; i < BLOOM_LEVELS - 1; i++) g[`up${i}`] = post(p.up, this.bloomTex[i + 1], this.postU[BLOOM_LEVELS + i]);
    g.tonemap = post(p.tonemap, this.sceneTex, this.postU[BLOOM_LEVELS * 2], this.bloomTex[0]);
    g.fxaa = post(p.fxaa, this.ldrTex, this.postU[BLOOM_LEVELS * 2 + 1]);
    this.postGroups = g;
  }

  sunDirection(): Vec3 {
    const e = (settings.sunElevation * Math.PI) / 180;
    const a = (settings.sunAzimuth * Math.PI) / 180;
    return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
  }

  private writeCamera(pass: Pass, viewProj: Mat4, camPos: Vec3, lightVP: Mat4, info: FrameInfo, clip: [number, number, number, number], stride: number): void {
    const f = new Float32Array(this.camData);
    f.set(viewProj, 0);
    f.set(mat4Invert(viewProj), 16);
    f.set(lightVP, 32);
    const sun = this.sunDirection();
    f.set([camPos[0], camPos[1], camPos[2], info.time], 48);
    f.set([sun[0], sun[1], sun[2], info.seaLevel], 52);
    f.set(clip, 56);
    const c = info.cursor;
    f.set([c.x, c.z, c.radius, c.visible ? 1 : 0], 60);
    f.set([this.width, this.height, 1 / this.width, 1 / this.height], 64);
    f.set([this.sim.n, this.sim.dx, this.sim.size, stride], 68);
    f.set([settings.waveAmp, settings.wavePeriod, info.boundaryDepth, settings.showMoisture ? 1 : 0], 72);
    const dbg = (window as unknown as { waterDebug?: number }).waterDebug ?? 0;
    f.set([info.waveTime, c.water ? 1 : 0, dbg, c.wallHalfLen], 76);
    this.device.queue.writeBuffer(this.camBuf[pass], 0, this.camData);
  }

  private bakeSky(encoder: GPUCommandEncoder): void {
    const sun = this.sunDirection();
    const key = sun.map((x) => x.toFixed(4)).join(',');
    if (key === this.lastSunKey) return;
    this.lastSunKey = key;
    this.device.queue.writeBuffer(this.skyU, 0, new Float32Array([...sun, 0, 0, 0, 0, 0]));
    const pass = encoder.beginComputePass({ label: 'sky' });
    pass.setPipeline(this.skyBakePipe);
    pass.setBindGroup(0, this.skyBakeGroup);
    pass.dispatchWorkgroups(SKY_W / 8, SKY_H / 8);
    pass.setPipeline(this.skyIntPipe);
    pass.setBindGroup(0, this.skyIntGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
  }

  private uploadDecor(info: FrameInfo): void {
    const q = this.device.queue;
    if (info.decor.dirty) {
      const { data, ranges } = info.decor.pack();
      q.writeBuffer(this.decorInst, 0, data);
      this.decorRanges = ranges;
      info.decor.dirty = false;
    }
    const pv = info.preview;
    const slot = new Float32Array(INSTANCE_FLOATS);
    if (pv) {
      const k = DECOR[pv.kind];
      const s = k.scale[0] + (k.scale[1] - k.scale[0]) * pv.seed;
      slot.set([pv.x, 0, pv.z, pv.seed * 6.2831853 * 13.7, s, s, s, pv.seed, pv.kind, k.colorIndex ?? -1, k.yMode, k.sway]);
    }
    q.writeBuffer(this.decorInst, (MAX_DECOR - 1) * INSTANCE_FLOATS * 4, slot);
  }

  private drawDecor(pass: GPURenderPassEncoder, shadow: boolean, preview: DecorPreview | null): void {
    pass.setPipeline(shadow ? this.pipes.decorShadow : this.pipes.decor);
    pass.setVertexBuffer(0, this.decorV);
    pass.setIndexBuffer(this.decorI, 'uint32');
    for (const r of this.decorRanges) {
      const part = this.decorParts[r.kind][r.variant];
      pass.drawIndexed(part.count, r.count, part.firstIndex, part.baseVertex, r.first);
    }
    if (preview && !shadow) {
      const part = this.decorParts[preview.kind][preview.variant];
      pass.drawIndexed(part.count, 1, part.firstIndex, part.baseVertex, MAX_DECOR - 1);
    }
  }

  private drawTerrain(pass: GPURenderPassEncoder, stride: number, shadow: boolean): void {
    const n = this.sim.n;
    const cols = Math.floor((n - 1) / stride) + 1;
    pass.setPipeline(shadow ? this.pipes.terrainShadow : this.pipes.terrain);
    pass.draw(cols * 2, cols - 1);
    pass.setPipeline(shadow ? this.pipes.sideShadow : this.pipes.side);
    pass.draw(n * 2, 4);
  }

  private drawItems(pass: GPURenderPassEncoder, items: DrawItem[], shadow: boolean): void {
    if (!items.length) return;
    pass.setPipeline(shadow ? this.pipes.meshShadow : this.pipes.mesh);
    if (shadow) pass.setBindGroup(1, this.emptyGroup);
    items.forEach((it, i) => {
      const m = this.toolMeshGpu[it.mesh];
      pass.setBindGroup(2, this.objGroups[i]);
      pass.setVertexBuffer(0, m.vbuf);
      pass.setIndexBuffer(m.ibuf, 'uint32');
      pass.drawIndexed(m.count);
    });
  }

  render(encoder: GPUCommandEncoder, info: FrameInfo): void {
    const d = this.device;
    const cam = info.camera;
    cam.aspect = this.width / this.height;
    cam.computeMatrices();
    this.bakeSky(encoder);
    this.uploadDecor(info);

    // Sun shadow map covering the slab and the floor around it.
    const L = this.sim.size;
    const center: Vec3 = [L / 2, 0, L / 2];
    const sun = this.sunDirection();
    const lightView = mat4LookAt(v3.add(center, v3.scale(sun, 100)), center, [0, 1, 0]);
    const e = L * 0.95;
    const lightVP = mat4Mul(mat4Ortho(-e, e, -e, e, 1, 220), lightView);

    const n = this.sim.n;
    const lowStride = n > 512 ? 2 : 1;
    const c = info.cursor;
    this.writeCamera('main', cam.viewProj, cam.position, lightVP, info, [0, 0, 0, c.wallAngle], 1);
    const sea = info.seaLevel;
    const reflVP = compose(cam.viewProj, mat4ReflectY(sea));
    const reflPos: Vec3 = [cam.position[0], 2 * sea - cam.position[1], cam.position[2]];
    this.writeCamera('refl', reflVP, reflPos, lightVP, info, [sea + 0.01, 1, 1, 0], lowStride);
    this.writeCamera('shadow', lightVP, cam.position, lightVP, info, [0, 0, 0, 0], lowStride);

    const items = info.items.slice(0, MAX_OBJECTS);
    items.forEach((it, i) => {
      const f = new Float32Array(24);
      f.set(it.model, 0);
      f.set(it.tint, 16);
      f.set(it.params, 20);
      d.queue.writeBuffer(this.objBufs[i], 0, f);
    });

    // 1. Shadow map.
    {
      const pass = encoder.beginRenderPass({
        label: 'shadow',
        colorAttachments: [],
        depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setBindGroup(0, this.sceneGroups.shadow);
      this.drawTerrain(pass, lowStride, true);
      this.drawDecor(pass, true, null);
      this.drawItems(pass, items, true);
      pass.end();
    }

    // 2. Planar reflection (mirrored about the sea level).
    {
      const pass = encoder.beginRenderPass({
        label: 'reflection',
        colorAttachments: [{ view: this.reflTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
        depthStencilAttachment: { view: this.reflDepth.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      });
      pass.setBindGroup(0, this.sceneGroups.refl);
      pass.setBindGroup(1, this.shadowReadGroup);
      pass.setPipeline(this.pipes.sky);
      pass.draw(3);
      pass.setPipeline(this.pipes.terrain);
      const cols = Math.floor((n - 1) / lowStride) + 1;
      pass.draw(cols * 2, cols - 1);
      this.drawDecor(pass, false, null);
      this.drawItems(pass, items, false);
      pass.end();
    }

    // 3. Opaque scene.
    {
      const pass = encoder.beginRenderPass({
        label: 'scene',
        colorAttachments: [{ view: this.sceneTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        depthStencilAttachment: { view: this.depthTex.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setBindGroup(0, this.sceneGroups.main);
      pass.setBindGroup(1, this.shadowReadGroup);
      pass.setPipeline(this.pipes.sky);
      pass.draw(3);
      pass.setPipeline(this.pipes.floor);
      pass.draw(6);
      this.drawTerrain(pass, 1, false);
      this.drawDecor(pass, false, info.preview);
      this.drawItems(pass, items, false);
      pass.end();
    }

    // 4. Water (reads a copy of the opaque colour + the depth buffer).
    encoder.copyTextureToTexture({ texture: this.sceneTex }, { texture: this.refrTex }, [this.width, this.height]);
    {
      const pass = encoder.beginRenderPass({
        label: 'water',
        colorAttachments: [{ view: this.sceneTex.createView(), loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: this.depthTex.createView(), depthReadOnly: true },
      });
      pass.setBindGroup(0, this.sceneGroups.main);
      pass.setBindGroup(1, this.shadowReadGroup);
      pass.setPipeline(this.pipes.wside);
      pass.draw(n * 2, 4);
      pass.setBindGroup(2, this.waterTexGroup);
      pass.setPipeline(this.pipes.water);
      pass.draw(n * 2, n - 1);
      pass.end();
    }

    // 5. Bloom.
    const full = (view: GPUTextureView, pipe: GPURenderPipeline, group: GPUBindGroup, load = false) => {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view, loadOp: load ? 'load' : 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
      });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    };
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const src = i === 0 ? this.sceneTex : this.bloomTex[i - 1];
      d.queue.writeBuffer(this.postU[i], 0, new Float32Array([1 / src.width, 1 / src.height, i === 0 ? 1 : 0, 0]));
      full(this.bloomTex[i].createView(), this.pipes.down, this.postGroups[`down${i}`]);
    }
    for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
      const src = this.bloomTex[i + 1];
      d.queue.writeBuffer(this.postU[BLOOM_LEVELS + i], 0, new Float32Array([1 / src.width, 1 / src.height, 0, 0]));
      full(this.bloomTex[i].createView(), this.pipes.up, this.postGroups[`up${i}`], true);
    }

    // 6. Tonemap + FXAA.
    d.queue.writeBuffer(this.postU[BLOOM_LEVELS * 2], 0, new Float32Array([0, 0, settings.bloom, settings.exposure * 0.26]));
    full(this.ldrTex.createView(), this.pipes.tonemap, this.postGroups.tonemap);
    d.queue.writeBuffer(this.postU[BLOOM_LEVELS * 2 + 1], 0, new Float32Array([1 / this.width, 1 / this.height, 0, 0]));
    full(this.gpu.context.getCurrentTexture().createView(), this.pipes.fxaa, this.postGroups.fxaa);
  }
}

/** Concatenates mesh variants into one vertex/index buffer pair, remembering each part's range. */
function mergeMeshes(groups: MeshData[][]): {
  vertices: Float32Array;
  indices: Uint32Array;
  parts: { firstIndex: number; count: number; baseVertex: number }[][];
} {
  let vCount = 0;
  let iCount = 0;
  for (const g of groups) for (const m of g) {
    vCount += m.vertices.length;
    iCount += m.indices.length;
  }
  const vertices = new Float32Array(vCount);
  const indices = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  const parts = groups.map((g) =>
    g.map((m) => {
      vertices.set(m.vertices, vo);
      indices.set(m.indices, io);
      const part = { firstIndex: io, count: m.indices.length, baseVertex: vo / 9 };
      vo += m.vertices.length;
      io += m.indices.length;
      return part;
    }),
  );
  return { vertices, indices, parts };
}
