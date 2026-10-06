/**
 * Varkan effect library (docs/design/faction.md §3.5/§4: glow core #FFD9A0, falloff #FF8A2A,
 * HDR 3–6, white-hot #FFE9C0; dark iron/soot smoke; combat effects stay brief – a large lasting
 * glow on the field always means economy/build, so only build/reclaim streams glow continuously).
 *
 * Scale reference: T1 units are ≈ 1 WU long, the default game camera is ≈ 105 WU away.
 * Sizes are quad edge lengths in WU. Priorities: 0 only for the core layers of the commander
 * explosion (never dropped), 1 for the readable core of other effects, 2 for cosmetics.
 */
import type { ColorCurve, ColorKey } from './curves.ts';
import { colorKey, hexColor } from './curves.ts';
import type { EffectDef, EffectId } from './define.ts';
import { defineEffect } from './define.ts';

const CORE = '#FFD9A0';
const FALLOFF = '#FF8A2A';
const WHITE_HOT = '#FFE9C0';
const DEEP_RED = '#B8401A';
const SPARK = '#FFB45A';
const SOOT = '#1E1B19';
const IRON_SMOKE = '#3A342F';
const ASH = '#5A534C';
const DUST = '#6B5E4E';
const DIRT = '#3B3128';
const RUST = '#8A4A2A';
const CAST_IRON = '#2E2B29';
const SHIELD_FLASH = '#CFE8FF';
const WATER = '#C8D8E0';

const k = (t: number, hex: string, intensity: number, alpha: number): ColorKey => colorKey(t, hex, intensity, alpha);

/** Linear glow colors of the faction (unit intensity; multiply with the HDR strength 3–6). */
export const VARKAN_GLOW = {
  core: hexColor(CORE) as readonly [number, number, number],
  falloff: hexColor(FALLOFF) as readonly [number, number, number],
  whiteHot: hexColor(WHITE_HOT) as readonly [number, number, number],
  /** Default HDR strength of glow emissives. */
  intensity: 4,
} as const;

// Reusable curves -------------------------------------------------------------------------------

/** Short muzzle/impact flash: white-hot → glow falloff, gone after the lifetime. */
function flashColor(peak: number): ColorCurve {
  return [k(0, WHITE_HOT, peak, 1), k(0.35, CORE, peak * 0.7, 0.85), k(1, FALLOFF, peak * 0.3, 0)];
}

/** Fireball: white-hot → core → falloff → dark red embers. */
function fireballColor(peak: number): ColorCurve {
  return [
    k(0, WHITE_HOT, peak, 1),
    k(0.1, CORE, peak * 0.7, 1),
    k(0.3, FALLOFF, peak * 0.5, 0.9),
    k(0.65, DEEP_RED, peak * 0.2, 0.6),
    k(1, DEEP_RED, 0.05, 0),
  ];
}

/** Dark iron smoke lit by the fire at birth (alpha blended). */
function fireSmokeColor(alpha: number): ColorCurve {
  return [k(0, FALLOFF, 1.4, 0), k(0.08, '#4A3226', 1, alpha), k(0.4, '#342E2A', 1, alpha * 0.75), k(1, IRON_SMOKE, 1, 0)];
}

function sparkColor(peak: number): ColorCurve {
  return [k(0, WHITE_HOT, peak, 1), k(0.3, SPARK, peak * 0.8, 1), k(1, DEEP_RED, peak * 0.2, 0)];
}

const FIRE_SMOKE_BLEND = [
  [0, 0.2],
  [0.12, 1],
] as const;

// Effects ---------------------------------------------------------------------------------------

const muzzleSmall = defineEffect({
  id: 'varkan:muzzle_small',
  boundsWu: 2,
  layers: [
    {
      name: 'flash', shape: 'flash', orient: 'billboard', motion: 'ballistic', count: 1,
      lifetime: [0.06, 0.08], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 0.75], [1, 0.35]], color: flashColor(5), blend: 0, priority: 1,
    },
    {
      name: 'streaks', shape: 'spark', orient: 'velocity', motion: 'ballistic', count: [3, 5],
      lifetime: [0.08, 0.14], speed: [8, 14], spread: 12, gravity: 0, drag: 6,
      size: 0.1, stretch: 2.5, color: sparkColor(5), blend: 0, priority: 2,
    },
    {
      name: 'puff', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: 1,
      lifetime: [0.4, 0.6], speed: [0.5, 1], spread: 20, gravity: 0.6, drag: 2,
      size: [[0, 0.3], [1, 0.9]], color: [k(0, ASH, 1, 0.35), k(1, ASH, 1, 0)], blend: 1, priority: 2,
    },
  ],
});

const muzzleCannon = defineEffect({
  id: 'varkan:muzzle_cannon',
  boundsWu: 4,
  layers: [
    {
      name: 'flash', shape: 'flash', orient: 'billboard', motion: 'ballistic', count: 1,
      lifetime: [0.08, 0.1], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 1.4], [1, 0.6]], color: flashColor(6), blend: 0, priority: 1,
    },
    {
      name: 'tongue', shape: 'glow', orient: 'velocity', motion: 'ballistic', count: 2,
      lifetime: [0.08, 0.12], speed: [6, 10], spread: 6, gravity: 0, drag: 10,
      size: [[0, 0.6], [1, 0.3]], stretch: 3, color: flashColor(4), blend: 0, priority: 1,
    },
    {
      name: 'sparks', shape: 'spark', orient: 'velocity', motion: 'ballistic', count: [5, 8],
      lifetime: [0.12, 0.25], speed: [9, 16], spread: 16, gravity: -6, drag: 4,
      size: 0.12, stretch: 2.5, color: sparkColor(5), blend: 0, priority: 2,
    },
    {
      name: 'smoke', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: [2, 3],
      lifetime: [0.7, 1.1], speed: [1, 2.2], spread: 25, gravity: 0.5, drag: 2.5, sizeJitter: 0.3,
      size: [[0, 0.5], [1, 1.6]], color: [k(0, ASH, 1, 0.45), k(1, IRON_SMOKE, 1, 0)], blend: 1,
      spin: [-1, 1], priority: 2,
    },
  ],
});

const muzzleArtillery = defineEffect({
  id: 'varkan:muzzle_artillery',
  boundsWu: 6,
  layers: [
    {
      name: 'flash', shape: 'flash', orient: 'billboard', motion: 'ballistic', count: 1,
      lifetime: [0.1, 0.13], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 2.4], [1, 1]], color: flashColor(6), blend: 0, priority: 1,
    },
    {
      name: 'blast', shape: 'glow', orient: 'billboard', motion: 'ballistic', count: 4,
      lifetime: [0.15, 0.25], speed: [3, 6], spread: 25, gravity: 0, drag: 6,
      size: [[0, 0.7], [0.3, 1.2], [1, 1.3]], color: fireballColor(5), blend: 0, priority: 1,
    },
    {
      name: 'ring_smoke', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: [5, 7],
      lifetime: [1.5, 2.2], speed: [2, 3.2], spread: 60, gravity: 0.4, drag: 1.6, sizeJitter: 0.3,
      size: [[0, 0.8], [1, 2.6]], color: [k(0, ASH, 1, 0.5), k(0.5, IRON_SMOKE, 1, 0.35), k(1, IRON_SMOKE, 1, 0)],
      blend: 1, spin: [-0.8, 0.8], priority: 2,
    },
    {
      name: 'sparks', shape: 'spark', orient: 'velocity', motion: 'ballistic', count: [6, 9],
      lifetime: [0.2, 0.4], speed: [10, 18], spread: 20, gravity: -9.8, drag: 2.5,
      size: 0.14, stretch: 2.5, color: sparkColor(5), blend: 0, priority: 2,
    },
  ],
});

const muzzleMissile = defineEffect({
  id: 'varkan:muzzle_missile',
  boundsWu: 5,
  layers: [
    {
      name: 'flash', shape: 'flash', orient: 'billboard', motion: 'ballistic', count: 1,
      lifetime: [0.1, 0.12], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 1.2], [1, 0.5]], color: flashColor(5), blend: 0, priority: 1,
    },
    {
      name: 'backblast', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: [5, 7],
      lifetime: [0.9, 1.5], speed: [0.8, 2.5], spread: 180, gravity: 0.5, drag: 2, sizeJitter: 0.35,
      size: [[0, 0.5], [1, 2]], color: [k(0, FALLOFF, 1.6, 0.2), k(0.1, ASH, 1, 0.5), k(1, ASH, 1, 0)],
      blend: [[0, 0.3], [0.1, 1]], spin: [-1, 1], priority: 2,
    },
    {
      name: 'crackle', shape: 'spark', orient: 'velocity', motion: 'ballistic', count: [6, 10],
      lifetime: [0.15, 0.3], speed: [4, 9], spread: 60, gravity: -4, drag: 3,
      size: 0.1, stretch: 2, color: sparkColor(4), blend: 0, priority: 2,
    },
  ],
});

const impactGroundSmall = defineEffect({
  id: 'varkan:impact_ground_small',
  boundsWu: 4,
  layers: [
    {
      name: 'flash', shape: 'flash', orient: 'billboard', motion: 'ballistic', count: 1,
      lifetime: [0.07, 0.1], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 0.9], [1, 0.4]], color: flashColor(4), blend: 0, priority: 1,
    },
    {
      name: 'dirt', shape: 'debris', orient: 'billboard', motion: 'ballistic', count: [5, 8],
      lifetime: [0.5, 0.8], speed: [3, 6], spread: 35, gravity: -12, drag: 0.5, sizeJitter: 0.4,
      size: 0.16, color: [k(0, DIRT, 1, 1), k(0.8, DIRT, 1, 1), k(1, DIRT, 1, 0)], blend: 1,
      spin: [-10, 10], priority: 2,
    },
    {
      name: 'dust', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: [2, 3],
      lifetime: [1, 1.5], speed: [0.8, 1.6], spread: 60, gravity: 0.3, drag: 1.5, sizeJitter: 0.3,
      size: [[0, 0.6], [1, 1.7]], color: [k(0, DUST, 1, 0.5), k(1, DUST, 1, 0)], blend: 1,
      spin: [-0.6, 0.6], priority: 2,
    },
    {
      name: 'sparks', shape: 'spark', orient: 'velocity', motion: 'ballistic', count: [2, 4],
      lifetime: [0.15, 0.3], speed: [4, 8], spread: 50, gravity: -9.8, drag: 1,
      size: 0.08, stretch: 2, color: sparkColor(4), blend: 0, priority: 2,
    },
  ],
});

const impactGroundLarge = defineEffect({
  id: 'varkan:impact_ground_large',
  boundsWu: 9,
  layers: [
    {
      name: 'flash', shape: 'flash', orient: 'billboard', motion: 'ballistic', count: 1,
      lifetime: [0.1, 0.14], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 2.6], [1, 1.2]], color: flashColor(6), blend: 0, priority: 1,
    },
    {
      name: 'fire', shape: 'glow', orient: 'billboard', motion: 'ballistic', count: [4, 6],
      lifetime: [0.25, 0.45], speed: [1.5, 3.5], spread: 50, gravity: 1.5, drag: 3, sizeJitter: 0.3,
      size: [[0, 0.8], [0.3, 1.5], [1, 1.7]], color: fireballColor(4), blend: [[0, 0], [1, 0.3]], priority: 1,
    },
    {
      name: 'dirt', shape: 'debris', orient: 'billboard', motion: 'ballistic', count: [12, 16],
      lifetime: [0.8, 1.3], speed: [5, 10], spread: 30, gravity: -14, drag: 0.4, sizeJitter: 0.5,
      size: 0.25, color: [k(0, DIRT, 1, 1), k(0.85, DIRT, 1, 1), k(1, DIRT, 1, 0)], blend: 1,
      spin: [-10, 10], priority: 2,
    },
    {
      name: 'column', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: [6, 8],
      lifetime: [2, 3], speed: [2, 4], spread: 25, gravity: 0.8, drag: 1.2, sizeJitter: 0.3,
      size: [[0, 1.2], [1, 4]], color: [k(0, DUST, 0.9, 0.6), k(0.5, DUST, 0.75, 0.45), k(1, IRON_SMOKE, 1, 0)],
      blend: 1, spin: [-0.5, 0.5], priority: 2,
    },
    {
      name: 'ground_ring', shape: 'ring', orient: 'ground', motion: 'ballistic', count: 1,
      lifetime: [0.35, 0.4], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 0.8], [1, 6]], color: [k(0, DUST, 0.95, 0.55), k(1, DUST, 0.8, 0)], blend: 1, priority: 2,
    },
    {
      name: 'sparks', shape: 'spark', orient: 'velocity', motion: 'ballistic', count: [8, 12],
      lifetime: [0.3, 0.6], speed: [6, 12], spread: 55, gravity: -9.8, drag: 0.8,
      size: 0.1, stretch: 2.5, color: sparkColor(5), blend: 0, priority: 2,
    },
  ],
});

const impactMetal = defineEffect({
  id: 'varkan:impact_metal',
  boundsWu: 3,
  layers: [
    {
      name: 'flash', shape: 'flash', orient: 'billboard', motion: 'ballistic', count: 1,
      lifetime: [0.05, 0.08], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 0.7], [1, 0.3]], color: flashColor(6), blend: 0, priority: 1,
    },
    {
      name: 'sparks', shape: 'spark', orient: 'velocity', motion: 'ballistic', count: [10, 16],
      lifetime: [0.2, 0.5], speed: [4, 9], spread: 50, gravity: -9.8, drag: 1.5,
      size: 0.09, stretch: 3, color: sparkColor(6), blend: 0, priority: 1,
    },
    {
      name: 'smoke', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: 1,
      lifetime: [0.6, 0.9], speed: [0.4, 0.8], spread: 30, gravity: 0.6, drag: 1.5,
      size: [[0, 0.3], [1, 1]], color: [k(0, IRON_SMOKE, 1, 0.4), k(1, IRON_SMOKE, 1, 0)], blend: 1, priority: 2,
    },
  ],
});

const impactShield = defineEffect({
  id: 'varkan:impact_shield',
  boundsWu: 4,
  layers: [
    {
      name: 'flash', shape: 'flash', orient: 'billboard', motion: 'ballistic', count: 1,
      lifetime: [0.08, 0.12], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 1.2], [1, 0.5]],
      color: [k(0, '#FFFFFF', 5, 1), k(0.4, SHIELD_FLASH, 3, 0.8), k(1, SHIELD_FLASH, 1, 0)], blend: 0, priority: 1,
    },
    {
      name: 'ring', shape: 'ring', orient: 'billboard', motion: 'ballistic', count: 1,
      lifetime: [0.28, 0.32], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 0.3], [1, 2.6]], color: [k(0, SHIELD_FLASH, 3, 0.9), k(1, SHIELD_FLASH, 1, 0)], blend: 0, priority: 1,
    },
    {
      name: 'sparks', shape: 'spark', orient: 'velocity', motion: 'ballistic', count: [6, 10],
      lifetime: [0.15, 0.3], speed: [3, 7], spread: 70, gravity: -3, drag: 3,
      size: 0.08, stretch: 2,
      color: [k(0, '#FFFFFF', 5, 1), k(0.4, SHIELD_FLASH, 3, 1), k(1, SPARK, 1, 0)], blend: 0, priority: 2,
    },
  ],
});

const impactWater = defineEffect({
  id: 'varkan:impact_water',
  boundsWu: 5,
  layers: [
    {
      name: 'crown', shape: 'spark', orient: 'velocity', motion: 'ballistic', count: [10, 14],
      lifetime: [0.5, 0.8], speed: [3, 5.5], spread: 30, spreadInner: 10, gravity: -12, drag: 0.5,
      size: 0.14, stretch: 1.5, color: [k(0, WATER, 1.3, 0.8), k(1, WATER, 1, 0)], blend: 0.6, priority: 2,
    },
    {
      name: 'column', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: [2, 3],
      lifetime: [0.6, 0.9], speed: [2, 3.5], spread: 10, gravity: -4, drag: 1.5,
      size: [[0, 0.5], [1, 1.4]], color: [k(0, WATER, 1.2, 0.6), k(1, WATER, 1, 0)], blend: 1, priority: 1,
    },
    {
      name: 'ring', shape: 'ring', orient: 'ground', motion: 'ballistic', count: 1,
      lifetime: [0.6, 0.7], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 0.5], [1, 3.5]], color: [k(0, WATER, 1.2, 0.6), k(1, WATER, 1, 0)], blend: 1, priority: 2,
    },
  ],
});

const explosionSmall = defineEffect({
  id: 'varkan:explosion_small',
  boundsWu: 6,
  layers: [
    {
      name: 'flash', shape: 'flash', orient: 'billboard', motion: 'ballistic', count: 1,
      lifetime: [0.1, 0.12], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 3], [1, 1.6]], color: flashColor(4.5), blend: 0, priority: 1,
    },
    {
      name: 'fireball', shape: 'glow', orient: 'billboard', motion: 'ballistic', count: [6, 8],
      lifetime: [0.35, 0.6], speed: [1, 2.5], spread: 180, gravity: 1, drag: 3, sizeJitter: 0.3,
      size: [[0, 0.6], [0.3, 1.4], [1, 1.8]], color: fireballColor(3.5), blend: [[0, 0], [0.6, 0.2], [1, 0.5]],
      spin: [-2, 2], priority: 1,
    },
    {
      name: 'smoke', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: [5, 7],
      lifetime: [1.6, 2.4], delay: [0.05, 0.15], speed: [0.8, 1.6], spread: 70, gravity: 0.9, drag: 1.2,
      sizeJitter: 0.3, size: [[0, 1], [1, 3.4]], color: fireSmokeColor(0.55), blend: FIRE_SMOKE_BLEND,
      spin: [-0.7, 0.7], priority: 2,
    },
    {
      name: 'sparks', shape: 'spark', orient: 'velocity', motion: 'ballistic', count: [10, 14],
      lifetime: [0.4, 0.8], speed: [4, 9], spread: 75, gravity: -9.8, drag: 0.8,
      size: 0.1, stretch: 2, color: sparkColor(5), blend: 0, priority: 2,
    },
    {
      name: 'debris', shape: 'debris', orient: 'billboard', motion: 'ballistic', count: [5, 7],
      lifetime: [0.8, 1.2], speed: [3, 6], spread: 50, gravity: -12, drag: 0.3, sizeJitter: 0.4,
      size: 0.22, color: [k(0, FALLOFF, 2, 1), k(0.25, CAST_IRON, 1, 1), k(0.9, CAST_IRON, 1, 1), k(1, CAST_IRON, 1, 0)],
      blend: [[0, 0.2], [0.25, 1]], spin: [-8, 8], priority: 2,
    },
  ],
});

const explosionMedium = defineEffect({
  id: 'varkan:explosion_medium',
  boundsWu: 10,
  layers: [
    {
      name: 'flash', shape: 'flash', orient: 'billboard', motion: 'ballistic', count: 1,
      lifetime: [0.12, 0.15], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 5], [1, 2.6]], color: flashColor(4.5), blend: 0, priority: 1,
    },
    {
      name: 'fireball', shape: 'glow', orient: 'billboard', motion: 'ballistic', count: [12, 16],
      lifetime: [0.5, 0.9], speed: [1.5, 3.5], spread: 180, gravity: 1.2, drag: 2.6, sizeJitter: 0.3,
      size: [[0, 1], [0.3, 2.2], [1, 2.8]], color: fireballColor(3.5), blend: [[0, 0], [0.6, 0.2], [1, 0.5]],
      spin: [-2, 2], priority: 1,
    },
    {
      name: 'secondary', shape: 'glow', orient: 'billboard', motion: 'ballistic', count: [3, 4],
      lifetime: [0.3, 0.5], delay: [0.1, 0.35], speed: [2, 4], spread: 90, emitRadius: 1, gravity: 1, drag: 3,
      size: [[0, 0.8], [0.3, 1.6], [1, 1.8]], color: fireballColor(4), blend: [[0, 0], [1, 0.4]], priority: 2,
    },
    {
      name: 'smoke', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: [10, 13],
      lifetime: [2.2, 3.4], delay: [0.05, 0.2], speed: [1, 2.2], spread: 70, gravity: 1, drag: 1, sizeJitter: 0.3,
      size: [[0, 1.5], [1, 5]], color: fireSmokeColor(0.6), blend: FIRE_SMOKE_BLEND, spin: [-0.6, 0.6], priority: 2,
    },
    {
      name: 'sparks', shape: 'spark', orient: 'velocity', motion: 'ballistic', count: [22, 28],
      lifetime: [0.5, 1], speed: [5, 12], spread: 80, gravity: -9.8, drag: 0.7,
      size: 0.12, stretch: 2.2, color: sparkColor(5), blend: 0, priority: 2,
    },
    {
      name: 'debris', shape: 'debris', orient: 'billboard', motion: 'ballistic', count: [10, 13],
      lifetime: [1, 1.6], speed: [4, 8], spread: 55, gravity: -12, drag: 0.3, sizeJitter: 0.4,
      size: 0.3, color: [k(0, FALLOFF, 2, 1), k(0.25, CAST_IRON, 1, 1), k(0.9, CAST_IRON, 1, 1), k(1, CAST_IRON, 1, 0)],
      blend: [[0, 0.2], [0.25, 1]], spin: [-8, 8], priority: 2,
    },
    {
      name: 'ground_ring', shape: 'ring', orient: 'ground', motion: 'ballistic', count: 1,
      lifetime: [0.4, 0.45], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 1], [1, 8]], color: [k(0, DUST, 0.95, 0.5), k(1, DUST, 0.8, 0)], blend: 1, priority: 2,
    },
  ],
});

const explosionLarge = defineEffect({
  id: 'varkan:explosion_large',
  boundsWu: 18,
  layers: [
    {
      name: 'flash', shape: 'flash', orient: 'billboard', motion: 'ballistic', count: 1,
      lifetime: [0.15, 0.18], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 9], [1, 4.5]], color: flashColor(7), blend: 0, priority: 1,
    },
    {
      name: 'fireball', shape: 'glow', orient: 'billboard', motion: 'ballistic', count: [18, 22],
      lifetime: [0.7, 1.2], speed: [2, 5], spread: 180, gravity: 1.5, drag: 2.2, sizeJitter: 0.3,
      size: [[0, 1.6], [0.3, 3.6], [1, 4.4]], color: fireballColor(4), blend: [[0, 0], [0.6, 0.2], [1, 0.5]],
      spin: [-1.5, 1.5], priority: 1,
    },
    {
      name: 'secondary', shape: 'glow', orient: 'billboard', motion: 'ballistic', count: [8, 10],
      lifetime: [0.4, 0.7], delay: [0.1, 0.6], speed: [2, 5], spread: 100, emitRadius: 2.5, gravity: 1, drag: 3,
      size: [[0, 1.2], [0.3, 2.4], [1, 2.8]], color: fireballColor(4.5), blend: [[0, 0], [1, 0.4]], priority: 2,
    },
    {
      name: 'smoke', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: [22, 26],
      lifetime: [3, 4.5], delay: [0.1, 0.4], speed: [1.5, 3.5], spread: 70, gravity: 1.2, drag: 0.9, sizeJitter: 0.35,
      size: [[0, 2.5], [1, 8]], color: fireSmokeColor(0.65), blend: FIRE_SMOKE_BLEND, spin: [-0.5, 0.5], priority: 2,
    },
    {
      name: 'sparks', shape: 'spark', orient: 'velocity', motion: 'ballistic', count: [45, 55],
      lifetime: [0.6, 1.3], speed: [7, 16], spread: 80, gravity: -9.8, drag: 0.6,
      size: 0.14, stretch: 2.5, color: sparkColor(5.5), blend: 0, priority: 2,
    },
    {
      name: 'debris', shape: 'debris', orient: 'billboard', motion: 'ballistic', count: [22, 26],
      lifetime: [1.2, 2], speed: [5, 11], spread: 60, gravity: -12, drag: 0.25, sizeJitter: 0.5,
      size: 0.4, color: [k(0, FALLOFF, 2, 1), k(0.2, CAST_IRON, 1, 1), k(0.9, CAST_IRON, 1, 1), k(1, CAST_IRON, 1, 0)],
      blend: [[0, 0.2], [0.2, 1]], spin: [-6, 6], priority: 2,
    },
    {
      name: 'embers', shape: 'glow', orient: 'billboard', motion: 'ballistic', count: [28, 34],
      lifetime: [1.5, 3], delay: [0.2, 0.8], speed: [0.5, 2.5], spread: 180, emitRadius: 3, gravity: 0.7, drag: 1,
      size: [[0, 0.25], [1, 0.1]], color: [k(0, CORE, 4, 1), k(0.5, FALLOFF, 2.5, 0.8), k(1, DEEP_RED, 0.5, 0)],
      blend: 0, priority: 2,
    },
    {
      name: 'ground_ring', shape: 'ring', orient: 'ground', motion: 'ballistic', count: 1,
      lifetime: [0.5, 0.55], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 2], [1, 16]], color: [k(0, DUST, 1, 0.55), k(1, DUST, 0.8, 0)], blend: 1, priority: 2,
    },
  ],
});

/** Commander death ("Lotbruch"): white flash, fireball, mushroom, ground shock ring, debris, afterglow. */
const acuExplosion = defineEffect({
  id: 'varkan:acu_explosion',
  boundsWu: 70,
  shake: { amplitudeWu: 2.4, durationS: 2.4, radiusWu: 160, frequencyHz: 9 },
  layers: [
    {
      name: 'flash', shape: 'flash', orient: 'billboard', motion: 'ballistic', count: 1,
      lifetime: [0.3, 0.3], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 10], [0.2, 26], [1, 16]],
      color: [k(0, '#FFFFFF', 6, 1), k(0.25, WHITE_HOT, 4.5, 0.85), k(1, CORE, 1.5, 0)], blend: 0, priority: 0,
    },
    {
      name: 'fireball', shape: 'glow', orient: 'billboard', motion: 'ballistic', count: [90, 110],
      lifetime: [0.9, 1.7], speed: [6, 16], spread: 180, emitRadius: 2.5, gravity: 2.5, drag: 2, sizeJitter: 0.35,
      size: [[0, 4], [0.3, 9], [1, 11]], color: fireballColor(2.6), blend: [[0, 0.1], [0.15, 0.55], [0.5, 0.85], [1, 1]],
      spin: [-1, 1], priority: 0,
    },
    {
      name: 'shockwave', shape: 'ring', orient: 'ground', motion: 'ballistic', count: 1,
      lifetime: [1.1, 1.1], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: [[0, 2], [0.4, 70], [1, 100]],
      color: [k(0, WHITE_HOT, 2.4, 0.9), k(0.15, CORE, 1.4, 0.75), k(0.45, DUST, 1.3, 0.55), k(1, DUST, 1, 0)],
      blend: [[0, 0], [0.2, 0.6], [0.5, 1]], priority: 0,
    },
    {
      name: 'stem', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: [70, 90],
      lifetime: [5, 8], delay: [0.2, 1.2], speed: [6, 14], spread: 10, emitRadius: 2, gravity: 3, drag: 0.9,
      sizeJitter: 0.3, size: [[0, 5], [1, 12]], color: fireSmokeColor(0.8), blend: FIRE_SMOKE_BLEND,
      spin: [-0.3, 0.3], priority: 1,
    },
    {
      name: 'cap', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: [110, 140],
      lifetime: [6, 9], delay: [0.6, 1.6], speed: [5, 12], spread: 70, emitRadius: 6, gravity: 2.5, drag: 0.5,
      sizeJitter: 0.35, size: [[0, 6], [1, 15]],
      color: [k(0, FALLOFF, 2.2, 0.6), k(0.1, '#5A3A28', 1, 0.8), k(0.5, IRON_SMOKE, 1, 0.75), k(1, SOOT, 1, 0)],
      blend: [[0, 0.3], [0.1, 1]], spin: [-0.25, 0.25], priority: 1,
    },
    {
      name: 'sparks', shape: 'spark', orient: 'velocity', motion: 'ballistic', count: [200, 240],
      lifetime: [1.2, 2.4], speed: [12, 32], spread: 80, gravity: -9.8, drag: 0.6,
      size: 0.28, stretch: 3, color: sparkColor(2.4), blend: 0, priority: 2,
    },
    {
      name: 'debris', shape: 'debris', orient: 'billboard', motion: 'ballistic', count: [60, 80],
      lifetime: [1.6, 2.6], speed: [8, 20], spread: 70, gravity: -14, drag: 0.25, sizeJitter: 0.5,
      size: 0.8, color: [k(0, FALLOFF, 2.5, 1), k(0.2, CAST_IRON, 1, 1), k(0.9, CAST_IRON, 1, 1), k(1, CAST_IRON, 1, 0)],
      blend: [[0, 0.2], [0.2, 1]], spin: [-5, 5], priority: 2,
    },
    {
      name: 'embers', shape: 'glow', orient: 'billboard', motion: 'ballistic', count: [180, 220],
      lifetime: [3, 6], delay: [0.3, 1.5], speed: [1, 5], spread: 180, emitRadius: 8, gravity: 0.8, drag: 1,
      size: [[0, 0.5], [1, 0.2]], color: [k(0, CORE, 3.5, 1), k(0.4, FALLOFF, 2.5, 0.9), k(1, DEEP_RED, 0.5, 0)],
      blend: 0, priority: 2,
    },
  ],
});

/** Ground part of the commander explosion (dust ring, burning ground, low smoke); spawned with it. */
const acuAftermath = defineEffect({
  id: 'varkan:acu_aftermath',
  boundsWu: 40,
  layers: [
    {
      name: 'dust_ring', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: [60, 72],
      lifetime: [3, 5], delay: [0.05, 0.25], speed: [18, 30], spread: 88, spreadInner: 78, emitRadius: 3,
      gravity: 0.3, drag: 1.4, sizeJitter: 0.4, size: [[0, 3], [1, 11]],
      color: [k(0, DUST, 0.8, 0.7), k(0.4, DUST, 0.65, 0.55), k(1, IRON_SMOKE, 1, 0)], blend: 1,
      spin: [-0.4, 0.4], priority: 1,
    },
    {
      name: 'ground_fire', shape: 'glow', orient: 'ground', motion: 'ballistic', count: [16, 20],
      lifetime: [3, 5], delay: [0.1, 0.4], speed: [0, 0], spread: 0, emitRadius: 12, gravity: 0, drag: 0,
      sizeJitter: 0.4, size: [[0, 4], [1, 7]],
      color: [k(0, FALLOFF, 1.8, 0.55), k(0.3, DEEP_RED, 1.1, 0.45), k(1, DEEP_RED, 0.3, 0)], blend: 0, priority: 1,
    },
    {
      name: 'ground_smoke', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: [50, 60],
      lifetime: [4, 7], delay: [0.3, 1.2], speed: [8, 16], spread: 90, spreadInner: 70, emitRadius: 4,
      gravity: 0.4, drag: 1.2, sizeJitter: 0.4, size: [[0, 5], [1, 14]], color: fireSmokeColor(0.65),
      blend: FIRE_SMOKE_BLEND, spin: [-0.3, 0.3], priority: 2,
    },
  ],
});

const smokeDamage = defineEffect({
  id: 'varkan:smoke_damage',
  boundsWu: 6,
  continuous: true,
  layers: [
    {
      name: 'smoke', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: 0, rate: 12,
      lifetime: [2.2, 3.4], speed: [0.8, 1.4], spread: 15, gravity: 1.2, drag: 0.8, sizeJitter: 0.3,
      size: [[0, 0.5], [1, 2.6]], color: [k(0, '#2C2724', 1, 0), k(0.1, '#2C2724', 1, 0.65), k(1, SOOT, 1, 0)],
      blend: 1, spin: [-0.8, 0.8], priority: 2,
    },
    {
      name: 'embers', shape: 'glow', orient: 'billboard', motion: 'ballistic', count: 0, rate: 3,
      lifetime: [0.4, 0.8], speed: [0.5, 1.2], spread: 30, gravity: 0.8, drag: 1,
      size: 0.12, color: [k(0, FALLOFF, 3, 1), k(1, DEEP_RED, 0.8, 0)], blend: 0, priority: 2,
    },
  ],
});

const smokePuff = defineEffect({
  id: 'varkan:smoke_puff',
  boundsWu: 6,
  layers: [
    {
      name: 'smoke', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: [6, 9],
      lifetime: [1.5, 2.5], speed: [0.6, 1.8], spread: 80, gravity: 0.7, drag: 1.2, sizeJitter: 0.35,
      size: [[0, 1], [1, 3.2]], color: [k(0, ASH, 1, 0.6), k(0.5, IRON_SMOKE, 1, 0.45), k(1, SOOT, 1, 0)],
      blend: 1, spin: [-0.6, 0.6], priority: 2,
    },
  ],
});

const sparksBurst = defineEffect({
  id: 'varkan:sparks_burst',
  boundsWu: 4,
  layers: [
    {
      name: 'sparks', shape: 'spark', orient: 'velocity', motion: 'ballistic', count: [20, 30],
      lifetime: [0.3, 0.7], speed: [4, 10], spread: 70, gravity: -9.8, drag: 1,
      size: 0.1, stretch: 2.5, color: sparkColor(6), blend: 0, priority: 2,
    },
    {
      name: 'flash', shape: 'glow', orient: 'billboard', motion: 'ballistic', count: 1,
      lifetime: [0.08, 0.1], speed: [0, 0], spread: 0, gravity: 0, drag: 0,
      size: 0.8, color: flashColor(4), blend: 0, priority: 2,
    },
  ],
});

const wreckSmolder = defineEffect({
  id: 'varkan:wreck_smolder',
  boundsWu: 6,
  continuous: true,
  layers: [
    {
      name: 'smoke', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: 0, rate: 7,
      lifetime: [3.5, 5.5], speed: [0.4, 0.9], spread: 12, emitRadius: 0.4, gravity: 0.8, drag: 0.8, sizeJitter: 0.35,
      size: [[0, 0.7], [1, 3.2]], color: [k(0, SOOT, 1, 0), k(0.12, IRON_SMOKE, 1, 0.38), k(0.6, ASH, 1, 0.22), k(1, ASH, 1, 0)],
      blend: 1, spin: [-0.4, 0.4], priority: 2,
    },
    {
      name: 'embers', shape: 'glow', orient: 'billboard', motion: 'ballistic', count: 0, rate: 1.5,
      lifetime: [0.6, 1.2], speed: [0.2, 0.6], spread: 40, emitRadius: 0.5, gravity: 0.4, drag: 1,
      size: 0.1, color: [k(0, FALLOFF, 1.8, 0.9), k(1, DEEP_RED, 0.4, 0)], blend: 0, priority: 2,
    },
  ],
});

const missileSmokeTrail = defineEffect({
  id: 'varkan:missile_smoke_trail',
  boundsWu: 3,
  continuous: true,
  layers: [
    {
      name: 'smoke', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: 0, rate: 40,
      lifetime: [0.8, 1.4], speed: [0, 0.3], spread: 180, gravity: 0.3, drag: 1, sizeJitter: 0.3,
      size: [[0, 0.25], [1, 0.9]], color: [k(0, FALLOFF, 2.5, 0.8), k(0.08, ASH, 1, 0.55), k(1, ASH, 1, 0)],
      blend: [[0, 0], [0.1, 1]], spin: [-1, 1], priority: 2,
    },
    {
      name: 'crackle', shape: 'spark', orient: 'velocity', motion: 'ballistic', count: 0, rate: 16,
      lifetime: [0.1, 0.2], speed: [1, 3], spread: 180, gravity: 0, drag: 2,
      size: 0.06, stretch: 1.5, color: sparkColor(4), blend: 0, priority: 2,
    },
  ],
});

/** Build beam as a pouring stream of molten metal ("Gießstrom", faction.md §3.5). */
const buildStream = defineEffect({
  id: 'varkan:build_stream',
  boundsWu: 12,
  continuous: true,
  layers: [
    {
      name: 'pour', shape: 'stream', orient: 'velocity', motion: 'stream', count: 0, rate: 90,
      lifetime: [0.5, 0.6], speed: [0, 0], spread: 0, emitRadius: 0.15, gravity: -2.5, drag: 0,
      streamWave: 0.1, streamWaves: 1.5, sizeJitter: 0.2,
      size: [[0, 0.18], [0.4, 0.3], [1, 0.24]], stretch: 2,
      color: [k(0, CORE, 3, 0.9), k(0.6, CORE, 2.6, 0.9), k(1, FALLOFF, 2.2, 0.7)], blend: 0, tint: 'spawn', priority: 1,
    },
    {
      name: 'droplets', shape: 'glow', orient: 'billboard', motion: 'stream', count: 0, rate: 36,
      lifetime: [0.45, 0.65], speed: [0, 0], spread: 0, emitRadius: 0.35, gravity: -2.5, drag: 0,
      streamWave: 0.35, streamWaves: 2.5, sizeJitter: 0.4, size: 0.1,
      color: [k(0, CORE, 3.5, 1), k(1, FALLOFF, 2.2, 0.4)], blend: 0, tint: 'spawn', priority: 2,
    },
  ],
});

/** Reclaim: the wreck melts from rust into a glowing stream flowing to the engineer. */
const reclaimStream = defineEffect({
  id: 'varkan:reclaim_stream',
  boundsWu: 12,
  continuous: true,
  layers: [
    {
      name: 'melt', shape: 'stream', orient: 'velocity', motion: 'stream', count: 0, rate: 70,
      lifetime: [0.6, 0.8], speed: [0, 0], spread: 0, emitRadius: 0.9, gravity: -2, drag: 0,
      streamWave: 0.15, streamWaves: 1.2, sizeJitter: 0.25,
      size: [[0, 0.3], [0.5, 0.26], [1, 0.18]], stretch: 1.8,
      color: [k(0, RUST, 1.2, 0.8), k(0.35, FALLOFF, 3, 0.9), k(1, CORE, 4, 0.9)],
      blend: [[0, 1], [0.35, 0]], tint: 'spawn', priority: 1,
    },
    {
      name: 'slag', shape: 'debris', orient: 'billboard', motion: 'stream', count: 0, rate: 18,
      lifetime: [0.7, 0.9], speed: [0, 0], spread: 0, emitRadius: 1.1, gravity: -2, drag: 0,
      streamWave: 0.3, streamWaves: 2, sizeJitter: 0.4, size: [[0, 0.16], [1, 0.08]],
      color: [k(0, RUST, 1, 1), k(0.5, FALLOFF, 2, 1), k(1, CORE, 3, 0)], blend: [[0, 1], [0.5, 0]],
      spin: [-6, 6], priority: 2,
    },
  ],
});

/** All Varkan effects (library order = effect index after {@link compileEffectLibrary}). */
export const VARKAN_EFFECTS: readonly EffectDef[] = [
  muzzleSmall,
  muzzleCannon,
  muzzleArtillery,
  muzzleMissile,
  impactGroundSmall,
  impactGroundLarge,
  impactMetal,
  impactShield,
  impactWater,
  explosionSmall,
  explosionMedium,
  explosionLarge,
  acuExplosion,
  acuAftermath,
  smokeDamage,
  smokePuff,
  sparksBurst,
  wreckSmolder,
  missileSmokeTrail,
  buildStream,
  reclaimStream,
];

export type VarkanWeaponClass = 'direct_small' | 'cannon' | 'artillery' | 'missile' | 'aa';
export type VarkanImpactClass = 'ground' | 'ground_large' | 'unit' | 'shield' | 'water';
export type VarkanDeathClass = 'small' | 'medium' | 'large' | 'structure' | 'acu';

export interface VarkanEventFx {
  /** Muzzle effect per weapon class (spawned at the muzzle, dir = barrel direction). */
  readonly weapon: Readonly<Record<VarkanWeaponClass, readonly EffectId[]>>;
  /** Impact per hit surface (dir = surface normal, or reversed projectile direction). */
  readonly impact: Readonly<Record<VarkanImpactClass, readonly EffectId[]>>;
  /** Impact class used for a weapon class when it hits the ground. */
  readonly groundImpactForWeapon: Readonly<Record<VarkanWeaponClass, VarkanImpactClass>>;
  /** Death explosion per size class (dir = +y). */
  readonly death: Readonly<Record<VarkanDeathClass, readonly EffectId[]>>;
  /** Continuous emitters: origin = builder/wreck, target = build site/engineer. */
  readonly build: readonly EffectId[];
  readonly reclaim: readonly EffectId[];
  /** Emitter while HP < 50 % (faction.md §3.5: seams flicker, unit smokes). */
  readonly damaged: readonly EffectId[];
  /** Emitter on fresh wrecks for a while. */
  readonly wreck: readonly EffectId[];
  /** Emitter attached to missiles in flight. */
  readonly missileTrail: readonly EffectId[];
}

/** Gameplay event → effect ids (for MS5/MS7 event integration and the fx-lab scenes). */
export const VARKAN_EVENT_FX: VarkanEventFx = {
  weapon: {
    direct_small: ['varkan:muzzle_small'],
    cannon: ['varkan:muzzle_cannon'],
    artillery: ['varkan:muzzle_artillery'],
    missile: ['varkan:muzzle_missile'],
    aa: ['varkan:muzzle_small'],
  },
  impact: {
    ground: ['varkan:impact_ground_small'],
    ground_large: ['varkan:impact_ground_large'],
    unit: ['varkan:impact_metal'],
    shield: ['varkan:impact_shield'],
    water: ['varkan:impact_water'],
  },
  groundImpactForWeapon: {
    direct_small: 'ground',
    cannon: 'ground',
    artillery: 'ground_large',
    missile: 'ground_large',
    aa: 'ground',
  },
  death: {
    small: ['varkan:explosion_small'],
    medium: ['varkan:explosion_medium'],
    large: ['varkan:explosion_large'],
    structure: ['varkan:explosion_large', 'varkan:smoke_puff'],
    acu: ['varkan:acu_explosion', 'varkan:acu_aftermath'],
  },
  build: ['varkan:build_stream'],
  reclaim: ['varkan:reclaim_stream'],
  damaged: ['varkan:smoke_damage'],
  wreck: ['varkan:wreck_smolder'],
  missileTrail: ['varkan:missile_smoke_trail'],
};

/** Hue of the glow falloff color (≈ 27°, faction.md §4.3). */
export const GLOW_HUE_DEG = 27;
/** Team colors closer than this to the glow hue switch the army's glow to white-hot. */
export const GLOW_CONFLICT_DEG = 25;

export interface GlowTint {
  /** True when the army glows white-hot instead of amber. */
  readonly whiteHot: boolean;
  /** Linear core / falloff glow colors of this army (unit intensity). */
  readonly core: readonly [number, number, number];
  readonly falloff: readonly [number, number, number];
  /**
   * Spawn tint 0xRRGGBB for layers with tint 'spawn' (multiplier = byte / 255): 0xFFFFFF for amber,
   * the normalized white-hot/core ratio for white-hot armies (less saturated glow).
   */
  readonly tint: number;
}

/** Hue in degrees [0, 360) and saturation (max − min) / max of an rgb color (0..1). */
export function hueSat(rgb: ArrayLike<number>): { hue: number; sat: number } {
  const r = rgb[0]!;
  const g = rgb[1]!;
  const b = rgb[2]!;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (max <= 0 || d <= 0) return { hue: 0, sat: 0 };
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { hue: h, sat: d / max };
}

const WHITE_HOT_TINT = ((): number => {
  const c = hexColor(CORE);
  const w = hexColor(WHITE_HOT);
  const ratio = [w[0] / c[0], w[1] / c[1], w[2] / c[2]];
  const m = Math.max(ratio[0]!, ratio[1]!, ratio[2]!);
  const byte = (v: number): number => Math.round((v / m) * 255);
  return (byte(ratio[0]!) << 16) | (byte(ratio[1]!) << 8) | byte(ratio[2]!);
})();

const AMBER: GlowTint = { whiteHot: false, core: VARKAN_GLOW.core, falloff: VARKAN_GLOW.falloff, tint: 0xffffff };
const WHITE: GlowTint = {
  whiteHot: true,
  core: VARKAN_GLOW.whiteHot,
  falloff: hexColor('#FFC890') as readonly [number, number, number],
  tint: WHITE_HOT_TINT,
};

/**
 * Glow variant of an army (faction.md §4.3): if the team color's hue lies less than 25° from the
 * glow hue (≈ 27°) – red and orange in the default palette – the army glows white-hot. Grey-ish
 * colors (saturation < 0.25) never conflict.
 */
export function glowTintForArmyColor(rgb: ArrayLike<number>): GlowTint {
  const { hue, sat } = hueSat(rgb);
  if (sat < 0.25) return AMBER;
  let d = Math.abs(hue - GLOW_HUE_DEG) % 360;
  if (d > 180) d = 360 - d;
  return d < GLOW_CONFLICT_DEG ? WHITE : AMBER;
}
