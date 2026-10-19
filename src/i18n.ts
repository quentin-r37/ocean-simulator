/**
 * Minimal FR / EN localisation. The language comes from `?lang=fr|en`, then the last choice
 * (localStorage), then the browser language. `setLang` switches at runtime and notifies listeners.
 */
export type Lang = 'fr' | 'en';
export const LANGS: Lang[] = ['fr', 'en'];

/** A text given in every language (used by data tables: decor, ambiences, tracks). */
export type Text = Record<Lang, string>;

const STORAGE_KEY = 'sandcastle.lang';

function detect(): Lang {
  const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang);
  const param = new URLSearchParams(location.search).get('lang');
  if (isLang(param)) return param;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // Storage unavailable (private mode…): fall through.
  }
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export let lang: Lang = detect();
const listeners: (() => void)[] = [];

export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    // Not persisted, still applied.
  }
  const url = new URL(location.href);
  if (url.searchParams.has('lang')) {
    url.searchParams.set('lang', l);
    history.replaceState(null, '', url);
  }
  for (const f of listeners) f();
}

export function onLangChange(f: () => void): void {
  listeners.push(f);
}

/** Picks the current language's version of a data text. */
export const tr = (text: Text): string => text[lang];

const fr = {
  title: 'Château de sable',
  pageTitle: 'Château de sable — WebGPU',
  langButton: 'English',
  langButtonTitle: 'Switch to English',

  'tool.shovel': 'Pelle',
  'tool.bucket': 'Seau',
  'tool.crenel': 'Seau crénelé',
  'tool.wall': 'Moule à muraille',
  'tool.trowel': 'Truelle',
  'tool.decor': 'Décor',
  'tool.giant': 'Seau géant',
  'tool.giantTitle': 'Seau géant : déplace énormément de sable',

  'hud.shovel': 'Pelle',
  'hud.bucket': 'Seau',
  'hud.tide': 'Marée',
  'hud.aim': 'Visée',
  'hud.fps': 'Images/s',
  'hud.time': 'Temps',
  'hud.timeTitle': 'Accélère le temps : houle, marée, séchage (V / Maj+V)',
  'hud.timeLag': (x: string) => `≈×${x}`,
  'hud.empty': 'vide',
  'hud.water': (l: string) => `${l} L d'eau`,
  'hud.decor': (name: string) => `Décor : ${name}`,
  'hud.paused': 'pause',
  'hud.aimWater': (cm: string) => `eau, ${cm} cm`,
  'hud.aimSand': (wet: string, packed: boolean) => `sable ${wet}${packed ? ', tassé' : ''}`,
  'wet.dry': 'sec',
  'wet.damp': 'peu humide',
  'wet.wet': 'humide',
  'wet.soaked': 'détrempé',

  'tsunami.button': '🌊 Tsunami',
  'tsunami.title': 'Envoie une énorme vague depuis le large (Y)',
  'tsunami.coming': '🌊 La vague arrive…',
  'tsunami.active': '🌊 Tsunami en cours…',

  'help.summary': 'Commandes',
  'help.keyboardMode': 'clavier et souris',
  'help.gamepadMode': 'manette',
  'help.keyboard': [
    "<b>Pelle</b> : clic creuser d'un niveau (fond plat ; en traînant, un fossé de niveau ; pelle pleine : les déblais sont jetés derrière le trou) · <kbd>Maj</kbd> vider · <kbd>Alt</kbd> tasser",
    "<b>Seaux / moule</b> : clic remplir (sable, ou eau en visant la mer) · <kbd>Maj</kbd>+clic retourner (ou verser l'eau) · <kbd>F</kbd> tourner la muraille",
    '<b>Truelle</b> : clic sculpter · <kbd>Maj</kbd> lisser · <kbd>Alt</kbd> aplanir à la hauteur visée (terrasses, escaliers)',
    "<b>Seau géant</b> (<kbd>7</kbd>) : comme le seau, mais il ramasse plusieurs m³ d'un coup sur une large zone (sable ou eau) pour déplacer des dunes entières",
    '<b>Décor</b> : clic poser · <kbd>Maj</kbd>+clic retirer · <kbd>C</kbd> objet suivant',
    '<kbd>Clic droit</kbd>/<kbd>Clic milieu</kbd> glisser : déplacer · <kbd>Molette</kbd> zoom · <kbd>Q</kbd>/<kbd>E</kbd> (<kbd>A</kbd>/<kbd>E</kbd> en AZERTY) tourner · <kbd>ZQSD</kbd>/<kbd>WASD</kbd> se déplacer',
    '<kbd>V</kbd>/<kbd>Maj</kbd>+<kbd>V</kbd> accélérer / ralentir le temps (×1 à ×8) · <kbd>T</kbd> pause marée · <kbd>+</kbd>/<kbd>-</kbd> vitesse marée · <kbd>R</kbd> réinitialiser · <kbd>H</kbd> aide',
    '<kbd>Y</kbd> tsunami · <kbd>N</kbd> nouvelle plage aléatoire · <kbd>B</kbd> ambiance suivante (matin, midi, soir, tempête…)',
    '<kbd>M</kbd> musique suivante · <kbd>Maj</kbd>+<kbd>M</kbd> couper / remettre la musique',
  ],
  'help.gamepad': [
    "<kbd>L1</kbd>/<kbd>R1</kbd> outil précédent / suivant · on vise le centre de l'écran",
    '<b>Pelle</b> : <kbd>L2</kbd> creuser · <kbd>R2</kbd> vider · <kbd>□</kbd>/<kbd>X</kbd> maintenu : tasser',
    "<b>Seaux / moule</b> : <kbd>L2</kbd> remplir (sable, ou eau en visant la mer) · <kbd>R2</kbd> retourner (ou verser l'eau) · <kbd>△</kbd>/<kbd>Y</kbd> tourner la muraille",
    '<b>Truelle</b> : <kbd>L2</kbd> sculpter · <kbd>R2</kbd> lisser · <kbd>□</kbd>/<kbd>X</kbd> maintenu : aplanir à la hauteur visée',
    '<b>Décor</b> : <kbd>R2</kbd> poser · <kbd>L2</kbd> retirer · croix <kbd>◀</kbd>/<kbd>▶</kbd> objet précédent / suivant',
    '<kbd>Stick gauche</kbd> se déplacer · <kbd>Stick droit</kbd> tourner (gauche / droite) et zoomer (haut / bas)',
    '<kbd>R3</kbd> accélérer le temps (×1 à ×8) · croix <kbd>▲</kbd>/<kbd>▼</kbd> vitesse marée · <kbd>○</kbd>/<kbd>B</kbd> pause marée',
    '<kbd>Create</kbd>/<kbd>View</kbd> ambiance suivante · <kbd>Options</kbd>/<kbd>Menu</kbd> aide',
  ],
  'help.tip': "Astuce : le sable humide tient en murs verticaux, le sec s'éboule. Arrosez vos tours !",

  'gui.title': 'Réglages',
  'gui.language': 'Langue',
  'gui.level': 'Plage et ambiance',
  'gui.ambience': 'Ambiance (B)',
  'gui.randomBeach': '🎲 Plage aléatoire (N)',
  'gui.randomAmbience': '…avec ambiance au hasard',
  'gui.seed': 'Graine (0 = classique)',
  'gui.waves': 'Houle',
  'gui.waveAmp': 'Hauteur (m)',
  'gui.wavePeriod': 'Période (s)',
  'gui.tsunamiAmp': 'Hauteur tsunami (m)',
  'gui.tsunami': '🌊 Tsunami (Y)',
  'gui.tide': 'Marée',
  'gui.tideAmp': 'Marnage ½ (m)',
  'gui.tidePeriod': 'Cycle (min)',
  'gui.tideSpeed': 'Vitesse',
  'gui.tidePaused': 'Pause',
  'gui.music': 'Musique',
  'gui.musicOn': 'Activée (Maj+M)',
  'gui.track': 'Piste',
  'gui.nextTrack': '⏭ Piste suivante (M)',
  'gui.volume': 'Volume',
  'gui.sun': 'Soleil et météo',
  'gui.sunElevation': 'Élévation (°)',
  'gui.sunAzimuth': 'Azimut (°)',
  'gui.overcast': 'Nuages',
  'gui.wind': 'Vent',
  'gui.evaporation': 'Séchage',
  'gui.sand': 'Sable',
  'gui.dryAngle': 'Angle sec (°)',
  'gui.wetAngle': 'Angle humide (°)',
  'gui.compactAngle': 'Angle tassé (°)',
  'gui.satAngle': 'Angle saturé (°)',
  'gui.cohesion': 'Cohésion (m)',
  'gui.slumpRate': 'Vitesse éboulement',
  'gui.erosion': 'Érosion',
  'gui.sim': 'Simulation',
  'gui.timeScale': 'Accélération du temps (V)',
  'gui.substeps': 'Sous-pas max / image',
  'gui.reset': 'Réinitialiser la plage',
  'gui.render': 'Rendu',
  'gui.exposure': 'Exposition',
  'gui.bloom': 'Halo',
  'gui.renderScale': 'Résolution',
  'gui.showMoisture': 'Voir humidité',

  'err.noWebgpu': 'Ce navigateur ne prend pas en charge WebGPU.<br>Utilisez une version récente de Chrome, Edge ou Safari (macOS 26+).',
  'err.noAdapter': 'Aucun adaptateur WebGPU disponible sur cette machine.',
  'err.noContext': "Impossible d'obtenir un contexte WebGPU pour le canvas.",
  'err.deviceLost': (msg: string) => `Le GPU a été perdu : ${msg}<br>Rechargez la page.`,
};

type Strings = typeof fr;
export type StringKey = keyof Strings;

const en: Strings = {
  title: 'Sandcastle',
  pageTitle: 'Sandcastle — WebGPU',
  langButton: 'Français',
  langButtonTitle: 'Passer en français',

  'tool.shovel': 'Shovel',
  'tool.bucket': 'Bucket',
  'tool.crenel': 'Crenellated bucket',
  'tool.wall': 'Wall mould',
  'tool.trowel': 'Trowel',
  'tool.decor': 'Decor',
  'tool.giant': 'Giant bucket',
  'tool.giantTitle': 'Giant bucket: moves a huge amount of sand',

  'hud.shovel': 'Shovel',
  'hud.bucket': 'Bucket',
  'hud.tide': 'Tide',
  'hud.aim': 'Aim',
  'hud.fps': 'FPS',
  'hud.time': 'Time',
  'hud.timeTitle': 'Speeds up time: swell, tide, drying (V / Shift+V)',
  'hud.timeLag': (x) => `≈×${x}`,
  'hud.empty': 'empty',
  'hud.water': (l) => `${l} L of water`,
  'hud.decor': (name) => `Decor: ${name}`,
  'hud.paused': 'paused',
  'hud.aimWater': (cm) => `water, ${cm} cm`,
  'hud.aimSand': (wet, packed) => `${wet}${packed ? ', packed' : ''} sand`,
  'wet.dry': 'dry',
  'wet.damp': 'damp',
  'wet.wet': 'wet',
  'wet.soaked': 'soaked',

  'tsunami.button': '🌊 Tsunami',
  'tsunami.title': 'Sends a huge wave in from the open sea (Y)',
  'tsunami.coming': '🌊 The wave is coming…',
  'tsunami.active': '🌊 Tsunami in progress…',

  'help.summary': 'Controls',
  'help.keyboardMode': 'keyboard and mouse',
  'help.gamepadMode': 'gamepad',
  'help.keyboard': [
    '<b>Shovel</b>: click to dig one level down (flat bottom; drag for a level trench; when full, the spoil is thrown beyond the hole) · <kbd>Shift</kbd> empty · <kbd>Alt</kbd> pack',
    '<b>Buckets / mould</b>: click to fill (sand, or water when aiming at the sea) · <kbd>Shift</kbd>+click to turn out (or pour the water) · <kbd>F</kbd> rotate the wall',
    '<b>Trowel</b>: click to sculpt · <kbd>Shift</kbd> smooth · <kbd>Alt</kbd> flatten to the aimed height (terraces, stairs)',
    '<b>Giant bucket</b> (<kbd>7</kbd>): like the bucket, but scoops several m³ at once over a wide area (sand or water) to move whole dunes',
    '<b>Decor</b>: click to place · <kbd>Shift</kbd>+click to remove · <kbd>C</kbd> next object',
    '<kbd>Right click</kbd>/<kbd>Middle click</kbd> drag: pan · <kbd>Wheel</kbd> zoom · <kbd>Q</kbd>/<kbd>E</kbd> (<kbd>A</kbd>/<kbd>E</kbd> on AZERTY) rotate · <kbd>WASD</kbd>/<kbd>ZQSD</kbd> move',
    '<kbd>V</kbd>/<kbd>Shift</kbd>+<kbd>V</kbd> speed up / slow down time (×1 to ×8) · <kbd>T</kbd> pause tide · <kbd>+</kbd>/<kbd>-</kbd> tide speed · <kbd>R</kbd> reset · <kbd>H</kbd> help',
    '<kbd>Y</kbd> tsunami · <kbd>N</kbd> new random beach · <kbd>B</kbd> next ambience (morning, noon, evening, storm…)',
    '<kbd>M</kbd> next track · <kbd>Shift</kbd>+<kbd>M</kbd> mute / unmute the music',
  ],
  'help.gamepad': [
    '<kbd>L1</kbd>/<kbd>R1</kbd> previous / next tool · you aim at the centre of the screen',
    '<b>Shovel</b>: <kbd>L2</kbd> dig · <kbd>R2</kbd> empty · hold <kbd>□</kbd>/<kbd>X</kbd>: pack',
    '<b>Buckets / mould</b>: <kbd>L2</kbd> fill (sand, or water when aiming at the sea) · <kbd>R2</kbd> turn out (or pour the water) · <kbd>△</kbd>/<kbd>Y</kbd> rotate the wall',
    '<b>Trowel</b>: <kbd>L2</kbd> sculpt · <kbd>R2</kbd> smooth · hold <kbd>□</kbd>/<kbd>X</kbd>: flatten to the aimed height',
    '<b>Decor</b>: <kbd>R2</kbd> place · <kbd>L2</kbd> remove · D-pad <kbd>◀</kbd>/<kbd>▶</kbd> previous / next object',
    '<kbd>Left stick</kbd> move · <kbd>Right stick</kbd> rotate (left / right) and zoom (up / down)',
    '<kbd>R3</kbd> speed up time (×1 to ×8) · D-pad <kbd>▲</kbd>/<kbd>▼</kbd> tide speed · <kbd>○</kbd>/<kbd>B</kbd> pause tide',
    '<kbd>Create</kbd>/<kbd>View</kbd> next ambience · <kbd>Options</kbd>/<kbd>Menu</kbd> help',
  ],
  'help.tip': 'Tip: wet sand holds vertical walls, dry sand slumps. Water your towers!',

  'gui.title': 'Settings',
  'gui.language': 'Language',
  'gui.level': 'Beach and ambience',
  'gui.ambience': 'Ambience (B)',
  'gui.randomBeach': '🎲 Random beach (N)',
  'gui.randomAmbience': '…with a random ambience',
  'gui.seed': 'Seed (0 = classic)',
  'gui.waves': 'Swell',
  'gui.waveAmp': 'Height (m)',
  'gui.wavePeriod': 'Period (s)',
  'gui.tsunamiAmp': 'Tsunami height (m)',
  'gui.tsunami': '🌊 Tsunami (Y)',
  'gui.tide': 'Tide',
  'gui.tideAmp': 'Tidal range ½ (m)',
  'gui.tidePeriod': 'Cycle (min)',
  'gui.tideSpeed': 'Speed',
  'gui.tidePaused': 'Paused',
  'gui.music': 'Music',
  'gui.musicOn': 'On (Shift+M)',
  'gui.track': 'Track',
  'gui.nextTrack': '⏭ Next track (M)',
  'gui.volume': 'Volume',
  'gui.sun': 'Sun and weather',
  'gui.sunElevation': 'Elevation (°)',
  'gui.sunAzimuth': 'Azimuth (°)',
  'gui.overcast': 'Clouds',
  'gui.wind': 'Wind',
  'gui.evaporation': 'Drying',
  'gui.sand': 'Sand',
  'gui.dryAngle': 'Dry angle (°)',
  'gui.wetAngle': 'Wet angle (°)',
  'gui.compactAngle': 'Packed angle (°)',
  'gui.satAngle': 'Saturated angle (°)',
  'gui.cohesion': 'Cohesion (m)',
  'gui.slumpRate': 'Slump speed',
  'gui.erosion': 'Erosion',
  'gui.sim': 'Simulation',
  'gui.timeScale': 'Time acceleration (V)',
  'gui.substeps': 'Max substeps / frame',
  'gui.reset': 'Reset the beach',
  'gui.render': 'Rendering',
  'gui.exposure': 'Exposure',
  'gui.bloom': 'Bloom',
  'gui.renderScale': 'Resolution',
  'gui.showMoisture': 'Show moisture',

  'err.noWebgpu': 'This browser does not support WebGPU.<br>Use a recent version of Chrome, Edge or Safari (macOS 26+).',
  'err.noAdapter': 'No WebGPU adapter is available on this machine.',
  'err.noContext': 'Could not get a WebGPU context for the canvas.',
  'err.deviceLost': (msg) => `The GPU was lost: ${msg}<br>Reload the page.`,
};

const STRINGS: Record<Lang, Strings> = { fr, en };

/** Current language's string (or formatter, or list) for `key`. */
export function t<K extends StringKey>(key: K): Strings[K] {
  return STRINGS[lang][key];
}
