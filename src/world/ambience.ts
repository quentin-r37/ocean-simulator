import { settings, Settings } from '../sim/params';
import { smoothstep } from '../math';
import type { Text } from '../i18n';

/** Settings an ambience drives (sea state, light, weather). */
type AmbienceKey =
  | 'sunElevation' | 'sunAzimuth' | 'exposure' | 'bloom' | 'overcast' | 'wind'
  | 'waveAmp' | 'wavePeriod' | 'tideAmp' | 'tidePeriodMin' | 'evaporation';
export type AmbienceValues = Pick<Settings, AmbienceKey>;

export interface Ambience {
  name: Text;
  values: AmbienceValues;
}

export const AMBIENCES: Ambience[] = [
  {
    name: { fr: 'Après-midi', en: 'Afternoon' },
    values: { sunElevation: 52, sunAzimuth: -35, exposure: 1, bloom: 0.03, overcast: 0, wind: 1, waveAmp: 0.08, wavePeriod: 4.5, tideAmp: 0.1, tidePeriodMin: 12, evaporation: 0.5 },
  },
  {
    name: { fr: 'Matin', en: 'Morning' },
    values: { sunElevation: 11, sunAzimuth: -115, exposure: 1.35, bloom: 0.05, overcast: 0.12, wind: 0.5, waveAmp: 0.045, wavePeriod: 6, tideAmp: 0.1, tidePeriodMin: 12, evaporation: 0.2 },
  },
  {
    name: { fr: 'Midi', en: 'Noon' },
    values: { sunElevation: 78, sunAzimuth: -20, exposure: 0.9, bloom: 0.03, overcast: 0, wind: 0.9, waveAmp: 0.07, wavePeriod: 4.5, tideAmp: 0.1, tidePeriodMin: 12, evaporation: 0.95 },
  },
  {
    name: { fr: 'Soir', en: 'Evening' },
    values: { sunElevation: 5, sunAzimuth: 28, exposure: 1.45, bloom: 0.06, overcast: 0, wind: 0.7, waveAmp: 0.06, wavePeriod: 5.5, tideAmp: 0.1, tidePeriodMin: 12, evaporation: 0.3 },
  },
  {
    name: { fr: 'Ciel couvert', en: 'Overcast' },
    values: { sunElevation: 40, sunAzimuth: -40, exposure: 1.2, bloom: 0.02, overcast: 0.6, wind: 1.4, waveAmp: 0.12, wavePeriod: 5, tideAmp: 0.12, tidePeriodMin: 12, evaporation: 0.15 },
  },
  {
    name: { fr: 'Tempête', en: 'Storm' },
    values: { sunElevation: 30, sunAzimuth: -60, exposure: 1.3, bloom: 0.02, overcast: 0.92, wind: 2.8, waveAmp: 0.3, wavePeriod: 7.5, tideAmp: 0.25, tidePeriodMin: 12, evaporation: 0.05 },
  },
  {
    name: { fr: "Mer d'huile", en: 'Glassy sea' },
    values: { sunElevation: 42, sunAzimuth: 30, exposure: 1, bloom: 0.04, overcast: 0, wind: 0.25, waveAmp: 0.015, wavePeriod: 8, tideAmp: 0.08, tidePeriodMin: 12, evaporation: 0.6 },
  },
  {
    name: { fr: 'Grande marée', en: 'Spring tide' },
    values: { sunElevation: 35, sunAzimuth: -50, exposure: 1.05, bloom: 0.03, overcast: 0.2, wind: 1.2, waveAmp: 0.1, wavePeriod: 5, tideAmp: 0.42, tidePeriodMin: 8, evaporation: 0.4 },
  },
];

const KEYS = Object.keys(AMBIENCES[0].values) as AmbienceKey[];

/** Blends the settings towards an ambience over a few seconds. */
export class AmbienceBlend {
  private from: AmbienceValues | null = null;
  private to: AmbienceValues | null = null;
  private t = 0;
  private duration = 1;
  current = 0;

  apply(index: number, duration = 2.5): void {
    this.current = index;
    this.to = AMBIENCES[index].values;
    this.from = { ...settings };
    this.t = 0;
    this.duration = Math.max(duration, 1e-3);
    // Shortest way round for the sun.
    const da = ((((this.to.sunAzimuth - this.from.sunAzimuth) % 360) + 540) % 360) - 180;
    this.from.sunAzimuth = this.to.sunAzimuth - da;
    // The swell period switches at once: the wave phase is ω·t, so sweeping ω with a large t
    // would race through hundreds of crests during the blend.
    settings.wavePeriod = this.to.wavePeriod;
    if (duration <= 0) this.update(0);
  }

  next(): void {
    this.apply((this.current + 1) % AMBIENCES.length);
  }

  update(dt: number): void {
    if (!this.from || !this.to) return;
    this.t = Math.min(this.t + dt / this.duration, 1);
    const k = smoothstep(0, 1, this.t);
    for (const key of KEYS) {
      if (key === 'wavePeriod') continue;
      settings[key] = this.from[key] + (this.to[key] - this.from[key]) * k;
    }
    settings.sunAzimuth = ((((settings.sunAzimuth + 180) % 360) + 360) % 360) - 180;
    if (this.t >= 1) this.from = this.to = null;
  }
}
