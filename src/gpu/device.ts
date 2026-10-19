import { t } from '../i18n';

export interface GpuContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  canvasFormat: GPUTextureFormat;
  canvas: HTMLCanvasElement;
}

export function showError(html: string): void {
  const el = document.getElementById('error');
  const msg = document.getElementById('error-msg');
  if (el && msg) {
    msg.innerHTML = html;
    el.classList.add('show');
  }
  for (const id of ['hud', 'help']) document.getElementById(id)?.style.setProperty('display', 'none');
}

export async function initGpu(canvas: HTMLCanvasElement): Promise<GpuContext> {
  if (!('gpu' in navigator)) {
    throw new Error(t('err.noWebgpu'));
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error(t('err.noAdapter'));

  const device = await adapter.requestDevice({
    // Optional: GPU pass timings for profiling (?profile).
    requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
    requiredLimits: {
      maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 256 * 1024 * 1024),
      maxBufferSize: Math.min(adapter.limits.maxBufferSize, 256 * 1024 * 1024),
      maxStorageBuffersPerShaderStage: Math.min(adapter.limits.maxStorageBuffersPerShaderStage, 10),
    },
  });

  device.addEventListener('uncapturederror', (e) => {
    console.error('[WebGPU]', (e as GPUUncapturedErrorEvent).error.message);
  });
  device.lost.then((info) => {
    console.error('[WebGPU] device lost:', info.message);
    if (info.reason !== 'destroyed') showError(t('err.deviceLost')(info.message));
  });

  const context = canvas.getContext('webgpu');
  if (!context) throw new Error(t('err.noContext'));
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat, alphaMode: 'opaque' });
  return { device, context, canvasFormat, canvas };
}
