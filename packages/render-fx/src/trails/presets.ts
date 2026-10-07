/**
 * Varkan beam and trail styles (faction.md §3.5/§4: glow core #FFD9A0, falloff #FF8A2A, HDR 3–6,
 * white-hot #FFE9C0; combat units without a glow core). Starting points for fx-lab and the MS5/MS7/MS14
 * integration – styles are plain data and may be copied/tinted per army (glowTintForArmyColor).
 */
import { VARKAN_GLOW } from '../effects/varkan.ts';
import type { BeamStyle } from './beams.ts';
import type { TrailStyle } from './trails.ts';

type Rgb = readonly [number, number, number];

function scale(c: Rgb, k: number): [number, number, number] {
  return [c[0] * k, c[1] * k, c[2] * k];
}

const CORE = VARKAN_GLOW.core;
const FALLOFF = VARKAN_GLOW.falloff;
const WHITE_HOT = VARKAN_GLOW.whiteHot;

export type VarkanBeamStyleName = 'buildStream' | 'reclaimStream' | 'laser' | 'lightning' | 'shieldArc';

/** Beam styles of the Varkan faction. */
export const VARKAN_BEAM_STYLES: Readonly<Record<VarkanBeamStyleName, BeamStyle>> = {
  /** "Gießstrom" core: dense, flowing glow stream (particles from rfx-p3 ride on top of it). */
  buildStream: {
    widthWu: 1.3,
    core: scale(CORE, 2.6),
    glow: scale(FALLOFF, 1.2),
    alpha: 1,
    scrollSpeed: 14,
    noise: 0.65,
    taper: [0.7, 1.15],
  },
  /** Reclaim: rust-red, flowing from the wreck to the engineer. */
  reclaimStream: {
    widthWu: 1.1,
    core: [2.0, 0.85, 0.35],
    glow: [0.8, 0.22, 0.07],
    alpha: 1,
    scrollSpeed: 10,
    noise: 0.55,
    taper: [1.2, 0.7],
  },
  /** Short direct-fire laser shot (use with addTimed, ~0.12 s). */
  laser: {
    widthWu: 0.7,
    core: scale(WHITE_HOT, 6),
    glow: scale(FALLOFF, 1.8),
    alpha: 1,
    scrollSpeed: 0,
    noise: 0,
  },
  /** Crackling arc (addTimed ~0.2 s). */
  lightning: {
    widthWu: 1.2,
    core: [4.5, 4.8, 5.5],
    glow: [0.45, 0.6, 1.4],
    alpha: 1,
    scrollSpeed: 60,
    noise: 1,
  },
  /** Faint arc from a shield generator to its bubble centre. */
  shieldArc: {
    widthWu: 0.5,
    core: [1.2, 2.2, 3.2],
    glow: [0.15, 0.35, 0.7],
    alpha: 0.8,
    scrollSpeed: 6,
    noise: 0.3,
  },
};

export type VarkanTrailStyleName = 'tracer' | 'cannon' | 'artillery' | 'missile' | 'aa';

/** Projectile trail styles of the Varkan faction. */
export const VARKAN_TRAIL_STYLES: Readonly<Record<VarkanTrailStyleName, TrailStyle>> = {
  /** Small direct-fire tracer: short, bright, thin. */
  tracer: { lengthWu: 3.5, widthWu: 0.28, head: [...scale(WHITE_HOT, 5), 1], tail: [...scale(FALLOFF, 1.5), 0] },
  /** Cannon shell: medium streak, amber. */
  cannon: { lengthWu: 5, widthWu: 0.45, head: [...scale(CORE, 5), 1], tail: [...scale(FALLOFF, 1.2), 0] },
  /** Artillery shell: long faint glow line along the arc. */
  artillery: { lengthWu: 9, widthWu: 0.6, head: [...scale(CORE, 2.8), 1], tail: [...scale(FALLOFF, 0.9), 0] },
  /** Missile exhaust glow (the smoke is a particle emitter). */
  missile: { lengthWu: 4, widthWu: 0.8, head: [...scale(WHITE_HOT, 3.5), 1], tail: [...scale(FALLOFF, 1.6), 0] },
  /** Anti-air flak tracer: thin, cool white. */
  aa: { lengthWu: 4.5, widthWu: 0.22, head: [3.5, 3.8, 4.2, 1], tail: [0.6, 0.7, 1.2, 0] },
};
