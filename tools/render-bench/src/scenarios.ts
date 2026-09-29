/**
 * SPK4 scenarios (PLAN §4 SPK4, MS2 plan ms2-p5-spk4):
 *
 * - `full`: everything the spike asks for on Medium at render scale 0.8 – 2,000 merged-part units
 *   (3 LODs), 30,000 instanced props (2 LODs), CSM with 2 cascades (terrain/props cached, units per
 *   frame with reduced LOD), 8-layer splatmap, HDR RGBA16F + dual-Kawase bloom + ACES + FXAA.
 * - `fallback`: the plan's fallback Medium – no CSM (blob shadows), splatmap limited to 4 layers,
 *   props with an impostor ring; HDR/bloom/FXAA stay.
 * - `ms2`: the MS2 acceptance flight – the real `@faf/render` facade (terrain + water + spot decals +
 *   2,000 units), Medium preset, no extras.
 */
import type { RenderPreset } from '@faf/render';
import { RENDER_PRESETS } from '@faf/render';

export type ScenarioName = 'full' | 'fallback' | 'ms2';
export const SCENARIO_NAMES: readonly ScenarioName[] = ['ms2', 'full', 'fallback'];

export type ShadowTechnique = 'none' | 'csm' | 'blob';

export interface ScenarioConfig {
  readonly name: ScenarioName;
  /** Render preset handed to the passes (Medium with the scenario's overrides). */
  readonly preset: RenderPreset;
  /** true = the game's renderer facade (ms2); false = the SPK4 prototype pipeline. */
  readonly facade: boolean;
  readonly splatLayers: 0 | 4 | 8;
  readonly shadows: ShadowTechnique;
  readonly cascades: 0 | 2;
  /** Shadow map edge (texels) per cascade. */
  readonly shadowMapSize: number;
  readonly props: boolean;
  /** Props beyond this distance (WU, × LOD bias) are drawn as impostors; Infinity = never. */
  readonly impostorDistanceWU: number;
  /** Prop LOD 0 → 1 switch distance in WU (× LOD bias). */
  readonly propLodDistanceWU: number;
  readonly hdr: boolean;
  readonly bloom: boolean;
  /** Dual-Kawase levels (downsample chain length). */
  readonly bloomLevels: number;
  readonly fxaa: boolean;
  /** Draw budget gate of the scenario. */
  readonly maxDraws: number;
}

/** CSS viewport and device pixel ratio of every scenario. */
export const VIEWPORT = { width: 1920, height: 1080, dpr: 1 } as const;
/** SPK4 exit criterion: draws per frame. */
export const SPK4_MAX_DRAWS = 250;
/** MS2 acceptance: draws per frame with 2,000 placeholders + terrain + water. */
export const MS2_MAX_DRAWS = 50;
/** SPK4 exit criteria (Medium, render scale 0.8), in ms (p95). Informational (DECISIONS 16). */
export const SPK4_MAIN_JS_MS = 5;
export const SPK4_GPU_MS = 12;

const medium = RENDER_PRESETS.medium;

export const SCENARIOS: { readonly [K in ScenarioName]: ScenarioConfig } = {
  full: {
    name: 'full',
    preset: { ...medium, splatLayers: 8, shadows: 'csm', shadowCascades: 2, hdr: true, bloom: true },
    facade: false,
    splatLayers: 8,
    shadows: 'csm',
    cascades: 2,
    shadowMapSize: 2048,
    props: true,
    impostorDistanceWU: Number.POSITIVE_INFINITY,
    propLodDistanceWU: 60,
    hdr: true,
    bloom: true,
    bloomLevels: 5,
    fxaa: true,
    maxDraws: SPK4_MAX_DRAWS,
  },
  fallback: {
    name: 'fallback',
    preset: { ...medium, splatLayers: 4, shadows: 'blob', shadowCascades: 0, hdr: true, bloom: true },
    facade: false,
    splatLayers: 4,
    shadows: 'blob',
    cascades: 0,
    shadowMapSize: 0,
    props: true,
    impostorDistanceWU: 110,
    propLodDistanceWU: 60,
    hdr: true,
    bloom: true,
    bloomLevels: 5,
    fxaa: true,
    maxDraws: SPK4_MAX_DRAWS,
  },
  ms2: {
    name: 'ms2',
    preset: medium,
    facade: true,
    splatLayers: 0,
    shadows: 'none',
    cascades: 0,
    shadowMapSize: 0,
    props: false,
    impostorDistanceWU: Number.POSITIVE_INFINITY,
    propLodDistanceWU: 60,
    hdr: false,
    bloom: false,
    bloomLevels: 0,
    fxaa: false,
    maxDraws: MS2_MAX_DRAWS,
  },
};

export function parseScenario(s: string | null | undefined): ScenarioName | undefined {
  return s === 'full' || s === 'fallback' || s === 'ms2' ? s : undefined;
}
