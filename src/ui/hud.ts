import GUI from 'lil-gui';
import { molds, settings, tideRising, toolSpec } from '../sim/params';
import type { Simulation } from '../sim/simulation';
import { isMold, ToolKind, Tools } from '../tools/tools';
import { DECOR } from '../world/decor';
import { AmbienceBlend, AMBIENCES } from '../world/ambience';
import { Music, TRACKS } from '../audio/music';
import { Lang, lang, onLangChange, setLang, StringKey, t, tr } from '../i18n';

/** Level / ambience controls provided by main. */
export interface WorldControls {
  ambience: AmbienceBlend;
  /** Seed of the current beach (0 = the classic one) and options of the generator. */
  state: { seed: number; randomAmbience: boolean };
  randomBeach: () => void;
  loadSeed: (seed: number) => void;
  tsunami: () => void;
}

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 0;
  private gui!: GUI;
  private amb = { index: 0 };
  private langState = { lang };

  constructor(private tools: Tools, private world: WorldControls, private music: Music, private onReset: () => void, private onScale: () => void) {
    document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => {
      b.addEventListener('click', () => tools.select(b.dataset.tool as ToolKind));
    });
    $('tsunami').addEventListener('click', () => world.tsunami());
    $('lang').addEventListener('click', () => setLang(lang === 'fr' ? 'en' : 'fr'));
    const pal = $('palette');
    for (const k of Tools.palette()) {
      const b = document.createElement('button');
      b.textContent = DECOR[k].icon;
      b.dataset.kind = String(k);
      b.addEventListener('click', () => tools.selectDecor(k));
      pal.appendChild(b);
    }
    this.applyLang();
    onLangChange(() => this.applyLang());
  }

  /** (Re)writes every static text and rebuilds the settings panel in the current language. */
  private applyLang(): void {
    document.documentElement.lang = lang;
    document.title = t('pageTitle');
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n as StringKey) as string;
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
      el.title = t(el.dataset.i18nTitle as StringKey) as string;
    });
    const langBtn = $('lang');
    langBtn.textContent = t('langButton');
    langBtn.title = t('langButtonTitle');
    $('help-list').innerHTML = t('help.items').map((item) => `<li>${item}</li>`).join('');
    document.querySelectorAll<HTMLButtonElement>('#palette button').forEach((b) => {
      b.title = tr(DECOR[Number(b.dataset.kind)].name);
    });

    // lil-gui labels are fixed at creation: rebuild the panel, keeping which folders were open.
    const closed = this.gui ? [this.gui._closed, ...this.gui.folders.map((f) => f._closed)] : null;
    this.gui?.destroy();
    this.buildGui();
    if (closed) [this.gui, ...this.gui.folders].forEach((f, i) => f.open(!closed[i]));
  }

  private buildGui(): void {
    const { world, music } = this;
    const gui = (this.gui = new GUI({ title: t('gui.title') }));
    this.langState.lang = lang;
    gui
      .add(this.langState, 'lang', { Français: 'fr', English: 'en' })
      .name(t('gui.language'))
      .onChange((l: Lang) => setLang(l));
    const level = gui.addFolder(t('gui.level'));
    level
      .add(this.amb, 'index', Object.fromEntries(AMBIENCES.map((a, i) => [tr(a.name), i])))
      .name(t('gui.ambience'))
      .onChange((i: number) => world.ambience.apply(i))
      .listen();
    level.add(world, 'randomBeach').name(t('gui.randomBeach'));
    level.add(world.state, 'randomAmbience').name(t('gui.randomAmbience'));
    level
      .add(world.state, 'seed')
      .step(1)
      .name(t('gui.seed'))
      .onFinishChange((v: number) => world.loadSeed(Math.max(0, Math.round(v))))
      .listen();
    const waves = gui.addFolder(t('gui.waves'));
    waves.add(settings, 'waveAmp', 0, 0.4, 0.01).name(t('gui.waveAmp')).listen();
    waves.add(settings, 'wavePeriod', 2.5, 10, 0.1).name(t('gui.wavePeriod')).listen();
    waves.add(settings, 'tsunamiAmp', 0.1, 0.7, 0.01).name(t('gui.tsunamiAmp'));
    waves.add(world, 'tsunami').name(t('gui.tsunami'));
    const tide = gui.addFolder(t('gui.tide'));
    tide.add(settings, 'tideAmp', 0, 0.6, 0.01).name(t('gui.tideAmp')).listen();
    tide.add(settings, 'tidePeriodMin', 2, 60, 1).name(t('gui.tidePeriod')).listen();
    tide.add(settings, 'tideSpeed', 0, 32, 0.5).name(t('gui.tideSpeed')).listen();
    tide.add(settings, 'tidePaused').name(t('gui.tidePaused')).listen();
    const mus = gui.addFolder(t('gui.music'));
    mus.add(music.state, 'on').name(t('gui.musicOn')).onChange(() => music.apply()).listen();
    mus
      .add(music.state, 'track', Object.fromEntries(TRACKS.map((tk, i) => [tr(tk.name), i])))
      .name(t('gui.track'))
      .onChange((i: number) => music.select(i))
      .listen();
    mus.add(music, 'next').name(t('gui.nextTrack'));
    mus.add(music.state, 'volume', 0, 1, 0.01).name(t('gui.volume')).onChange(() => music.apply());
    const sun = gui.addFolder(t('gui.sun'));
    sun.add(settings, 'sunElevation', 2, 85, 0.5).name(t('gui.sunElevation')).listen();
    sun.add(settings, 'sunAzimuth', -180, 180, 1).name(t('gui.sunAzimuth')).listen();
    sun.add(settings, 'overcast', 0, 1, 0.01).name(t('gui.overcast')).listen();
    sun.add(settings, 'wind', 0, 3, 0.05).name(t('gui.wind')).listen();
    sun.add(settings, 'evaporation', 0, 1, 0.01).name(t('gui.evaporation')).listen();
    const sand = gui.addFolder(t('gui.sand'));
    sand.add(settings, 'dryAngle', 20, 45, 0.5).name(t('gui.dryAngle'));
    sand.add(settings, 'wetAngle', 35, 80, 0.5).name(t('gui.wetAngle'));
    sand.add(settings, 'compactAngle', 50, 88, 0.5).name(t('gui.compactAngle'));
    sand.add(settings, 'satAngle', 5, 30, 0.5).name(t('gui.satAngle'));
    sand.add(settings, 'cohesion', 0, 2, 0.05).name(t('gui.cohesion'));
    sand.add(settings, 'slumpRate', 5, 150, 1).name(t('gui.slumpRate'));
    sand.add(settings, 'erosion', 0, 3, 0.05).name(t('gui.erosion'));
    const simF = gui.addFolder(t('gui.sim'));
    simF.add(settings, 'substeps', 1, 16, 1).name(t('gui.substeps'));
    simF.add({ reset: this.onReset }, 'reset').name(t('gui.reset'));
    const render = gui.addFolder(t('gui.render'));
    render.add(settings, 'exposure', 0.2, 3, 0.01).name(t('gui.exposure')).listen();
    render.add(settings, 'bloom', 0, 0.3, 0.005).name(t('gui.bloom')).listen();
    render.add(settings, 'renderScale', 0.5, 2, 0.05).name(t('gui.renderScale')).onFinishChange(this.onScale);
    render.add(settings, 'showMoisture').name(t('gui.showMoisture'));
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
    this.amb.index = this.world.ambience.current;
    const tl = this.tools;
    document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === tl.tool));
    $('palette').classList.toggle('show', tl.tool === 'decor');
    document.querySelectorAll<HTMLButtonElement>('#palette button').forEach((b) => b.classList.toggle('active', Number(b.dataset.kind) === tl.decorKind));
    $('tool-name').textContent = tl.tool === 'decor' ? t('hud.decor')(tr(DECOR[tl.decorKind].name)) : t(`tool.${tl.tool}`);
    const cap = molds[isMold(tl.tool) ? tl.tool : 'bucket'].cap;

    const inv = tl.inventory;
    const pct = (x: number) => `${Math.round(x * 100)} %`;
    const wetWord = (m: number) => t(m < 0.08 ? 'wet.dry' : m < 0.22 ? 'wet.damp' : m < 0.9 ? 'wet.wet' : 'wet.soaked');
    const sFrac = inv.shovelSand / toolSpec.shovelCap;
    $('shovel-bar').style.width = pct(Math.min(sFrac, 1));
    $('shovel-txt').textContent = sFrac < 0.01 ? t('hud.empty') : `${(inv.shovelSand * 1000).toFixed(1)} L · ${wetWord(inv.shovelM)}`;

    const bucketBar = $('bucket-bar');
    if (inv.bucketWater > 1e-6) {
      bucketBar.className = 'water';
      bucketBar.style.width = pct(Math.min(inv.bucketWater / cap, 1));
      $('bucket-txt').textContent = t('hud.water')((inv.bucketWater * 1000).toFixed(1));
    } else {
      bucketBar.className = 'sand';
      const f = inv.bucketSand / cap;
      bucketBar.style.width = pct(Math.min(f, 1));
      $('bucket-txt').textContent = f < 0.01 ? t('hud.empty') : `${(inv.bucketSand * 1000).toFixed(1)} L · ${wetWord(inv.bucketM)}`;
    }

    const ts = sim.tsunamiProgress;
    const tsBtn = $('tsunami') as HTMLButtonElement;
    tsBtn.disabled = ts !== null;
    tsBtn.textContent = t(ts === null ? 'tsunami.button' : ts < 0.5 ? 'tsunami.coming' : 'tsunami.active');
    const rising = tideRising(sim.tidePhase);
    const speed = settings.tidePaused ? t('hud.paused') : `×${settings.tideSpeed}`;
    $('tide-txt').textContent = `${sim.seaLevel >= 0 ? '+' : ''}${sim.seaLevel.toFixed(2)} m ${rising ? '↑' : '↓'} (${speed})`;

    const h = tl.hit;
    $('aim-txt').textContent = !h.valid
      ? '—'
      : h.isWater
        ? t('hud.aimWater')((h.waterDepth * 100).toFixed(0))
        : t('hud.aimSand')(wetWord(h.moisture), h.compaction > 0.4);
    $('fps-txt').textContent = this.fps.toFixed(0);
  }

  get pointerOverUi(): boolean {
    return this.gui.domElement.matches(':hover');
  }
}
