import { initGpu, showError } from './gpu/device';
import { Input } from './input/input';
import { IsoCamera } from './camera/isoCamera';
import { Simulation } from './sim/simulation';
import { gridSize, molds, settings } from './sim/params';
import { Tools } from './tools/tools';
import { Renderer } from './render/renderer';
import { ToolAnimator } from './render/toolMesh';
import { Hud } from './ui/hud';
import { Particles } from './render/particles';
import { Sfx } from './audio/sfx';
import { DECOR, DecorSet } from './world/decor';

async function main(): Promise<void> {
  const canvas = document.getElementById('gfx') as HTMLCanvasElement;
  const gpu = await initGpu(canvas);
  const { device } = gpu;

  const sim = new Simulation(device, gridSize());
  const decor = new DecorSet();
  decor.reset(sim.seaLevel);
  const tools = new Tools(device, sim, decor);
  const renderer = new Renderer(gpu, sim);
  const camera = new IsoCamera();
  const input = new Input(canvas);
  const animator = new ToolAnimator();
  const particles = new Particles(64);
  const sfx = new Sfx();

  const reset = () => {
    sim.reset();
    decor.reset(sim.seaLevel);
    tools.resetInventory();
  };
  const resize = () => renderer.resize(canvas.clientWidth, canvas.clientHeight);
  const hud = new Hud(tools, reset, resize);
  window.addEventListener('resize', resize);
  resize();

  // Debug/automation hook.
  const debug = { sim, tools, camera, settings, renderer, decor, paused: false };
  (window as unknown as { sandbox: typeof debug }).sandbox = debug;

  let last = performance.now();
  const frame = (now: number) => {
    if (debug.paused) {
      last = now;
      requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;

    if (input.hit('KeyT')) settings.tidePaused = !settings.tidePaused;
    if (input.hit('+') || input.hit('Equal') || input.hit('NumpadAdd') || input.hit('BracketRight'))
      settings.tideSpeed = Math.min(settings.tideSpeed * 2 || 1, 32);
    if (input.hit('-') || input.hit('Minus') || input.hit('NumpadSubtract') || input.hit('BracketLeft'))
      settings.tideSpeed = settings.tideSpeed > 1 ? settings.tideSpeed / 2 : 0.5;
    if (input.hit('KeyR')) reset();
    if (input.hit('KeyH')) {
      const help = document.getElementById('help') as HTMLDetailsElement;
      help.open = !help.open;
    }

    resize();
    camera.update(input, dt);
    tools.update(input, dt, hud.pointerOverUi);

    const encoder = device.createCommandEncoder();
    sim.encode(encoder, dt);
    tools.encode(encoder, camera, [input.mouseX, input.mouseY], [canvas.clientWidth, canvas.clientHeight], dt, input.alt, input.shift);
    const afterVolume = sim.encodeVolume(encoder);
    const afterTools = tools.encodeReadback(encoder);

    const items = [...animator.update(tools, camera.position, dt), ...particles.update(tools, dt)];
    sfx.update(tools);
    const hit = tools.hit;
    const isWall = tools.tool === 'wall';
    const kind = tools.decorKind;
    renderer.render(encoder, {
      camera,
      time: sim.simTime,
      waveTime: sim.simTime,
      seaLevel: sim.seaLevel,
      boundaryDepth: sim.boundaryDepth(),
      cursor: {
        x: hit.pos[0],
        z: hit.pos[2],
        radius: tools.cursorRadius(input.alt, input.shift),
        visible: hit.valid,
        water: hit.isWater,
        wallHalfLen: isWall ? molds.wall.halfLen : 0,
        wallAngle: tools.moldAngle,
      },
      items,
      decor,
      preview:
        tools.tool === 'decor' && hit.valid && !input.shift
          ? { kind, variant: Math.floor(tools.decorSeed * 997) % DECOR[kind].meshes.length, x: hit.pos[0], z: hit.pos[2], seed: tools.decorSeed }
          : null,
    });
    device.queue.submit([encoder.finish()]);
    afterVolume?.();
    afterTools?.();
    tools.sync();
    sim.updateVolume();
    hud.frame(dt, sim);
    input.endFrame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((e: unknown) => {
  console.error(e);
  showError(e instanceof Error ? e.message : String(e));
});
