export function createBuffer(
  device: GPUDevice,
  size: number,
  usage: GPUBufferUsageFlags,
  label?: string,
  data?: ArrayBufferView,
): GPUBuffer {
  const buffer = device.createBuffer({ size: Math.ceil(size / 4) * 4, usage, label, mappedAtCreation: !!data });
  if (data) {
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    buffer.unmap();
  }
  return buffer;
}

export function computePipeline(device: GPUDevice, code: string, label: string, entryPoint = 'main'): GPUComputePipeline {
  const module = device.createShaderModule({ code, label });
  return device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint }, label });
}

/** Build a bind group for group `group` of an auto-layout pipeline from a binding -> resource map. */
export function bindGroup(
  device: GPUDevice,
  pipeline: GPUComputePipeline | GPURenderPipeline,
  entries: Record<number, GPUBuffer | GPUTextureView | GPUSampler>,
  group = 0,
  label?: string,
): GPUBindGroup {
  return device.createBindGroup({
    label,
    layout: pipeline.getBindGroupLayout(group),
    entries: Object.entries(entries).map(([binding, res]) => ({
      binding: Number(binding),
      resource: res instanceof GPUBuffer ? { buffer: res } : res,
    })),
  });
}

/** Ring of MAP_READ staging buffers so a readback never stalls the frame. */
export class Readback {
  private ring: { buf: GPUBuffer; busy: boolean }[] = [];
  latest: Float32Array | null = null;

  constructor(
    device: GPUDevice,
    private size: number,
    count = 3,
    label = 'readback',
  ) {
    for (let i = 0; i < count; i++) {
      this.ring.push({
        buf: device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, label }),
        busy: false,
      });
    }
  }

  /** Records a copy if a staging buffer is free; returns a callback to call after submit. */
  copy(encoder: GPUCommandEncoder, src: GPUBuffer, srcOffset = 0): (() => void) | null {
    const slot = this.ring.find((s) => !s.busy);
    if (!slot) return null;
    slot.busy = true;
    encoder.copyBufferToBuffer(src, srcOffset, slot.buf, 0, this.size);
    return () => {
      slot.buf
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          this.latest = new Float32Array(slot.buf.getMappedRange().slice(0));
          slot.buf.unmap();
          slot.busy = false;
        })
        .catch(() => {
          slot.busy = false;
        });
    };
  }

  destroy(): void {
    for (const s of this.ring) s.buf.destroy();
  }
}

export const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
export const UNIFORM = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
