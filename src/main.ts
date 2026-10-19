import { initGpu, showError } from './gpu/device';
import { Input, PAD } from './input/input';
import { IsoCamera } from './camera/isoCamera';
import { Simulation } from './sim/simulation';
import { gridSize, molds, settings } from './sim/params';
import { Tools } from './tools/tools';
import { Renderer } from './render/renderer';
import { ToolAnimator } from './render/toolMesh';
import { Hud } from './ui/hud';
import { Particles } from './render/particles';
import { Sfx } from './audio/sfx';
import { Music } from './audio/music';
import { DECOR, DecorSet } from './world/decor';
import { CLASSIC_LEVEL, setLevel } from './sim/level';
import { generateLevel, urlSeed } from './sim/levelGen';
import { AmbienceBlend, AMBIENCES } from './world/ambience';

async function main(): Promise<void> {
  const canvas = document.getElementById('gfx') as HTMLCanvasElement;
  const gpu = await initGpu(canvas);
  const { device } = gpu;

  const seed0 = urlSeed();
  if (seed0) setLevel(generateLevel(seed0));
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
  const music = new Music();

  const reset = () => {
    sim.reset();
    decor.reset(sim.seaLevel);
    tools.resetInventory();
  };
  const resize = () => renderer.resize(canvas.clientWidth, canvas.clientHeight);
  const ambience = new AmbienceBlend();
  const world = {
    ambience,
    state: { seed: seed0 ?? 0, randomAmbience: false },
    loadSeed: (seed: number) => {
      world.state.seed = seed;
      setLevel(seed > 0 ? generateLevel(seed) : CLASSIC_LEVEL);
      reset();
      const url = new URL(location.href);
      if (seed > 0) url.searchParams.set('seed', String(seed));
      else url.searchParams.delete('seed');
      history.replaceState(null, '', url);
    },
    randomBeach: () => {
      world.loadSeed(1 + Math.floor(Math.random() * 99999));
      if (world.state.randomAmbience) ambience.apply(Math.floor(Math.random() * AMBIENCES.length));
    },
    tsunami: () => sim.triggerTsunami(settings.tsunamiAmp),
  };
  const hud = new Hud(tools, world, music, reset, resize);
  window.addEventListener('resize', resize);
  resize();

  // Debug/automation hook.
  const debug = { sim, tools, camera, settings, renderer, decor, world, paused: false };
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
    input.poll();

    if (input.hit('KeyT') || input.hit(PAD.B)) settings.tidePaused = !settings.tidePaused;
    if (input.hit('+') || input.hit('Equal') || input.hit('NumpadAdd') || input.hit('BracketRight') || input.hit(PAD.Up))
      settings.tideSpeed = Math.min(settings.tideSpeed * 2 || 1, 32);
    if (input.hit('-') || input.hit('Minus') || input.hit('NumpadSubtract') || input.hit('BracketLeft') || input.hit(PAD.Down))
      settings.tideSpeed = settings.tideSpeed > 1 ? settings.tideSpeed / 2 : 0.5;
    if (input.hit('KeyR')) reset();
    if (input.hit('KeyN')) world.randomBeach();
    if (input.hit('KeyB') || input.hit(PAD.Select)) ambience.next();
    if (input.hit('KeyY')) world.tsunami();
    if (input.hit('KeyM')) {
      if (input.shift) music.toggle();
      else music.next();
    }
    ambience.update(dt);
    if (input.hit('KeyH') || input.hit(PAD.Start)) {
      const help = document.getElementById('help') as HTMLDetailsElement;
      help.open = !help.open;
    }

    resize();
    camera.update(input, dt);
    tools.update(input, dt, hud.pointerOverUi && !input.usingPad);

    const encoder = device.createCommandEncoder();
    sim.encode(encoder, dt);
    tools.encode(encoder, camera, [input.mouseX, input.mouseY], [canvas.clientWidth, canvas.clientHeight], dt, tools.alt, tools.shift);
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
        radius: tools.cursorRadius(tools.alt, tools.shift),
        visible: hit.valid,
        water: hit.isWater,
        wallHalfLen: isWall ? molds.wall.halfLen : 0,
        wallAngle: tools.moldAngle,
      },
      items,
      decor,
      preview:
        tools.tool === 'decor' && hit.valid && !tools.shift
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
