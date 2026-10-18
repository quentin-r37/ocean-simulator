import GUI from 'lil-gui';
import { molds, settings, tideRising, toolSpec } from '../sim/params';
import type { Simulation } from '../sim/simulation';
import { isMold, ToolKind, Tools } from '../tools/tools';
import { DECOR } from '../world/decor';

const TOOL_NAMES: Record<ToolKind, string> = {
  shovel: 'Pelle',
  bucket: 'Seau',
  crenel: 'Seau crénelé',
  wall: 'Moule à muraille',
  trowel: 'Truelle',
  decor: 'Décor',
};

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 0;
  private gui: GUI;

  constructor(private tools: Tools, onReset: () => void, onScale: () => void) {
    document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => {
      b.addEventListener('click', () => tools.select(b.dataset.tool as ToolKind));
    });
    const pal = $('palette');
    for (const k of Tools.palette()) {
      const b = document.createElement('button');
      b.textContent = DECOR[k].icon;
      b.title = DECOR[k].name;
      b.dataset.kind = String(k);
      b.addEventListener('click', () => tools.selectDecor(k));
      pal.appendChild(b);
    }

    const gui = (this.gui = new GUI({ title: 'Réglages' }));
    const waves = gui.addFolder('Houle');
    waves.add(settings, 'waveAmp', 0, 0.4, 0.01).name('Hauteur (m)');
    waves.add(settings, 'wavePeriod', 2.5, 10, 0.1).name('Période (s)');
    const tide = gui.addFolder('Marée');
    tide.add(settings, 'tideAmp', 0, 0.6, 0.01).name('Marnage ½ (m)');
    tide.add(settings, 'tidePeriodMin', 2, 60, 1).name('Cycle (min)');
    tide.add(settings, 'tideSpeed', 0, 32, 0.5).name('Vitesse').listen();
    tide.add(settings, 'tidePaused').name('Pause').listen();
    const sun = gui.addFolder('Soleil');
    sun.add(settings, 'sunElevation', 2, 85, 0.5).name('Élévation (°)');
    sun.add(settings, 'sunAzimuth', -180, 180, 1).name('Azimut (°)');
    sun.add(settings, 'evaporation', 0, 1, 0.01).name('Séchage');
    const sand = gui.addFolder('Sable');
    sand.add(settings, 'dryAngle', 20, 45, 0.5).name('Angle sec (°)');
    sand.add(settings, 'wetAngle', 35, 80, 0.5).name('Angle humide (°)');
    sand.add(settings, 'compactAngle', 50, 88, 0.5).name('Angle tassé (°)');
    sand.add(settings, 'satAngle', 5, 30, 0.5).name('Angle saturé (°)');
    sand.add(settings, 'cohesion', 0, 2, 0.05).name('Cohésion (m)');
    sand.add(settings, 'slumpRate', 5, 150, 1).name('Vitesse éboulement');
    sand.add(settings, 'erosion', 0, 3, 0.05).name('Érosion');
    const simF = gui.addFolder('Simulation');
    simF.add(settings, 'substeps', 1, 16, 1).name('Sous-pas max / image');
    simF.add({ reset: onReset }, 'reset').name('Réinitialiser la plage');
    const render = gui.addFolder('Rendu');
    render.add(settings, 'exposure', 0.2, 3, 0.01).name('Exposition');
    render.add(settings, 'bloom', 0, 0.3, 0.005).name('Halo');
    render.add(settings, 'renderScale', 0.5, 2, 0.05).name('Résolution').onFinishChange(onScale);
    render.add(settings, 'showMoisture').name('Voir humidité');
    for (const f of [sand, simF, render]) f.close();
  }

  frame(dt: number, sim: Simulation): void {
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    const t = this.tools;
    document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === t.tool));
    $('palette').classList.toggle('show', t.tool === 'decor');
    document.querySelectorAll<HTMLButtonElement>('#palette button').forEach((b) => b.classList.toggle('active', Number(b.dataset.kind) === t.decorKind));
    $('tool-name').textContent = t.tool === 'decor' ? `Décor : ${DECOR[t.decorKind].name}` : TOOL_NAMES[t.tool];
    const cap = molds[isMold(t.tool) ? t.tool : 'bucket'].cap;

    const inv = t.inventory;
    const pct = (x: number) => `${Math.round(x * 100)} %`;
    const wetWord = (m: number) => (m < 0.08 ? 'sec' : m < 0.22 ? 'peu humide' : m < 0.9 ? 'humide' : 'détrempé');
    const sFrac = inv.shovelSand / toolSpec.shovelCap;
    $('shovel-bar').style.width = pct(Math.min(sFrac, 1));
    $('shovel-txt').textContent = sFrac < 0.01 ? 'vide' : `${(inv.shovelSand * 1000).toFixed(1)} L · ${wetWord(inv.shovelM)}`;

    const bucketBar = $('bucket-bar');
    if (inv.bucketWater > 1e-6) {
      bucketBar.className = 'water';
      bucketBar.style.width = pct(Math.min(inv.bucketWater / cap, 1));
      $('bucket-txt').textContent = `${(inv.bucketWater * 1000).toFixed(1)} L d'eau`;
    } else {
      bucketBar.className = 'sand';
      const f = inv.bucketSand / cap;
      bucketBar.style.width = pct(Math.min(f, 1));
      $('bucket-txt').textContent = f < 0.01 ? 'vide' : `${(inv.bucketSand * 1000).toFixed(1)} L · ${wetWord(inv.bucketM)}`;
    }

    const rising = tideRising(sim.tideTime);
    const speed = settings.tidePaused ? 'pause' : `×${settings.tideSpeed}`;
    $('tide-txt').textContent = `${sim.seaLevel >= 0 ? '+' : ''}${sim.seaLevel.toFixed(2)} m ${rising ? '↑' : '↓'} (${speed})`;

    const h = t.hit;
    $('aim-txt').textContent = !h.valid
      ? '—'
      : h.isWater
        ? `eau, ${(h.waterDepth * 100).toFixed(0)} cm`
        : `sable ${wetWord(h.moisture)}${h.compaction > 0.4 ? ', tassé' : ''}`;
    $('fps-txt').textContent = this.fps.toFixed(0);
  }

  get pointerOverUi(): boolean {
    return this.gui.domElement.matches(':hover');
  }
}
