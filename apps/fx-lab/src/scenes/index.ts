/**
 * Scene registry of the fx-lab and the real LabFx wiring (rfx-p6): 'battle', 'shields', 'big',
 * 'gallery' (this package) and 'lighting' (rfx-p5). {@link createLabFx} builds the LabFxKit with the GPU
 * systems of render-fx; without a device (headless tests) it uses the recording parts.
 */
import type { LabContext, LabFx, LabScene, SceneName } from '../app/context.ts';
import { createBattleScene } from './battle.ts';
import { createBigScene } from './big.ts';
import { LabFxKit, createGpuFxParts, labEffectLibrary, labShakeHook } from './fx.ts';
import { createRecordingFxParts } from './fx-record.ts';
import { createGalleryScene } from './gallery.ts';
import { createLightingScene } from './lighting.ts';
import { createShieldsScene } from './shields.ts';
import { particleCapForPreset } from '@faf/render-fx';

export const LAB_SCENES: Readonly<Record<SceneName, (() => LabScene) | undefined>> = {
  lighting: createLightingScene,
  battle: createBattleScene,
  shields: createShieldsScene,
  big: createBigScene,
  gallery: createGalleryScene,
};

/**
 * FX systems of a scene context: ParticleSystem (cap = particleCapForPreset, onShake →
 * ctx.shake.addFromEffect), ShieldPass, TrailPass, BeamPass behind the LabFxKit helpers.
 * Without a GPU device the kit runs on recording parts (0 draws, call checksum).
 */
export function createLabFx(ctx: LabContext): LabFx {
  const onShake = labShakeHook(ctx);
  const parts = (ctx.dev as LabContext['dev'] | null) === null ? createRecordingFxParts(labEffectLibrary(), onShake, particleCapForPreset(ctx.preset)) : createGpuFxParts(ctx, onShake);
  return new LabFxKit(ctx, parts);
}

export { LabFxKit, labFxKit, createGpuFxParts, labEffectLibrary, labShakeHook } from './fx.ts';
export type { LabFxParts, LabImpactHandler, LabWeapon, LabImpactKind, LabDeathClass } from './fx.ts';
export { createRecordingFxParts, FxCallLog } from './fx-record.ts';
