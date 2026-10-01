import type { LabScene, SceneName } from '../app/context.ts';
import { createLightingScene } from './lighting.ts';
import { createBattleScene } from './battle.ts';
import { createShieldsScene } from './shields.ts';
import { createBigScene } from './big.ts';
import { createGalleryScene } from './gallery.ts';
export { createLabFx } from './fx.ts';
export const LAB_SCENES: Readonly<Record<SceneName, () => LabScene>> = {
  lighting: createLightingScene, battle: createBattleScene, shields: createShieldsScene,
  big: createBigScene, gallery: createGalleryScene,
};
