/**
 * Sound categories = voice-manager classes (PLAN §3.7 Audio, faction.md §8.3). Defaults per category;
 * every sound may override targetLufs/priority/cooldownMs/maxVoices. Values mirror content/audio/SOUNDLIST.md.
 */

export type Bus = 'sfx' | 'ui' | 'voice' | 'music' | 'ambience';
export type Band = 'low' | 'mid' | 'high' | 'full';

export interface CategoryInfo {
  label: string;
  bus: Bus;
  /**
   * Loudness target of the file in LUFS (BS.1770 K-weighting). One-shots are measured by maximum momentary
   * loudness (400 ms window, zero-padded if shorter), loops by gated integrated loudness. The mixer applies
   * bus/distance gains on top.
   */
  targetLufs: number;
  /** 0..100, higher wins when the 32 voices are exhausted. */
  priority: number;
  /** Suggested minimum interval between two starts of the same sound id. */
  cooldownMs: number;
  /** Suggested concurrent voices of this category. */
  maxVoices: number;
  /** 1 = mono (positional through a panner), 2 = stereo (UI, music, ambience). */
  channels: 1 | 2;
  /** Upper bound for one variant (loops: loop length). */
  maxDurationS: number;
  /** Main frequency band (mix rule faction.md §8.3). */
  band: Band;
  /** Played positionally (distance/zoom attenuation, panning). */
  spatial: boolean;
}

export const CATEGORIES = {
  weapon: { label: 'Waffen-Abschuss', bus: 'sfx', targetLufs: -20, priority: 50, cooldownMs: 50, maxVoices: 10, channels: 1, maxDurationS: 2.5, band: 'mid', spatial: true },
  projectile: { label: 'Projektil im Flug (Loop)', bus: 'sfx', targetLufs: -24, priority: 30, cooldownMs: 0, maxVoices: 4, channels: 1, maxDurationS: 4, band: 'mid', spatial: true },
  impact: { label: 'Einschlag / Treffer', bus: 'sfx', targetLufs: -21, priority: 40, cooldownMs: 40, maxVoices: 8, channels: 1, maxDurationS: 2, band: 'mid', spatial: true },
  explosion: { label: 'Explosion / Tod', bus: 'sfx', targetLufs: -17, priority: 70, cooldownMs: 80, maxVoices: 6, channels: 1, maxDurationS: 5, band: 'low', spatial: true },
  signature: { label: 'Signatur-Glockenschlag', bus: 'sfx', targetLufs: -19, priority: 90, cooldownMs: 1000, maxVoices: 2, channels: 1, maxDurationS: 7, band: 'mid', spatial: true },
  build: { label: 'Bau / Reclaim / Fabrik', bus: 'sfx', targetLufs: -24, priority: 30, cooldownMs: 100, maxVoices: 3, channels: 1, maxDurationS: 4, band: 'mid', spatial: true },
  eco: { label: 'Wirtschaft / Flow-Grundton', bus: 'sfx', targetLufs: -30, priority: 5, cooldownMs: 0, maxVoices: 4, channels: 1, maxDurationS: 6, band: 'low', spatial: true },
  unit: { label: 'Bewegung / Antrieb', bus: 'sfx', targetLufs: -26, priority: 20, cooldownMs: 60, maxVoices: 8, channels: 1, maxDurationS: 4, band: 'low', spatial: true },
  shield: { label: 'Schilde', bus: 'sfx', targetLufs: -21, priority: 45, cooldownMs: 60, maxVoices: 4, channels: 1, maxDurationS: 3, band: 'mid', spatial: true },
  intel: { label: 'Intel / Radar', bus: 'sfx', targetLufs: -26, priority: 25, cooldownMs: 500, maxVoices: 2, channels: 1, maxDurationS: 2, band: 'high', spatial: true },
  ui: { label: 'UI / Befehle', bus: 'ui', targetLufs: -27, priority: 80, cooldownMs: 30, maxVoices: 4, channels: 2, maxDurationS: 0.8, band: 'high', spatial: false },
  ack: { label: 'Quittung (Pips)', bus: 'voice', targetLufs: -21, priority: 85, cooldownMs: 150, maxVoices: 2, channels: 1, maxDurationS: 0.8, band: 'high', spatial: false },
  alert: { label: 'Alert-Signalton', bus: 'voice', targetLufs: -16, priority: 100, cooldownMs: 3000, maxVoices: 1, channels: 1, maxDurationS: 3, band: 'high', spatial: false },
  music: { label: 'Musik-Stinger', bus: 'music', targetLufs: -16, priority: 95, cooldownMs: 0, maxVoices: 1, channels: 2, maxDurationS: 15, band: 'full', spatial: false },
  ambience: { label: 'Ambience (Loop)', bus: 'ambience', targetLufs: -30, priority: 10, cooldownMs: 0, maxVoices: 2, channels: 2, maxDurationS: 30, band: 'full', spatial: false },
} as const satisfies Record<string, CategoryInfo>;

export type SfxCategory = keyof typeof CATEGORIES;

export function isCategory(c: string): c is SfxCategory {
  return Object.hasOwn(CATEGORIES, c);
}

/** Global voice budget of the mixer (PLAN §3.7). */
export const MAX_VOICES = 32;
