/**
 * Movement layers (PLAN §3.1 "Bewegungs-Layer"). The enum is part of the binary formats
 * (sim.bin, Units.layer): values are append-only. MVP-active: Land, Air.
 */
export const MotionLayer = {
  Land: 0,
  Water: 1,
  Seabed: 2,
  Hover: 3,
  Amphibious: 4,
  Air: 5,
} as const;
export type MotionLayer = (typeof MotionLayer)[keyof typeof MotionLayer];

/** Number of defined layers. */
export const MOTION_LAYER_COUNT = 6;

/** Layer names as written in blueprints (index = MotionLayer value). */
export const MOTION_LAYER_NAMES = ['land', 'water', 'seabed', 'hover', 'amphibious', 'air'] as const;
export type MotionLayerName = (typeof MOTION_LAYER_NAMES)[number];

/** Layers a blueprint may use in the MVP. */
export const MVP_MOTION_LAYERS: readonly MotionLayerName[] = ['land', 'air'];

/** Layer value of a blueprint layer name, or −1 if unknown. */
export function motionLayerOf(name: string): number {
  for (let i = 0; i < MOTION_LAYER_NAMES.length; i++) if (MOTION_LAYER_NAMES[i] === name) return i;
  return -1;
}

/** Simulation tick rate (PLAN §3.4: 10 Hz). Blueprint units are converted per tick with it. */
export const SIM_TICK_HZ = 10;
