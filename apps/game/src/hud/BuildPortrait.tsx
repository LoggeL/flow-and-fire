import type { BuildRole } from './build-role.ts';
import { BuildGlyph } from './BuildGlyph.tsx';
import { simTypeId } from './type-ids.ts';
import { BUILD_PORTRAIT_MODELS } from './build-portraits.gen.ts';
import './build-portrait.css';

// Vite bundles these with the same versioned build as the code and replay assets.
const images = import.meta.glob<string>('./assets/build-icons/*.png', { eager: true, query: '?url', import: 'default' });

/** Build candidates show their actual model; unknown future content keeps its semantic glyph. */
export function BuildPortrait({ typeId, role, tier }: { readonly typeId: string; readonly role: BuildRole; readonly tier: number }) {
  const unit = BUILD_PORTRAIT_MODELS[simTypeId(typeId)];
  const image = unit ? images[`./assets/build-icons/${unit}.png`] : undefined;
  if (!image) return <BuildGlyph role={role} tier={tier}/>;
  return <span class="ff-cell__icon live-build-portrait" data-role={role} aria-hidden="true">
    <img src={image} alt="" draggable={false} width={192} height={192}/>
    {tier > 0 && <span class="live-build-portrait-tier">{Array.from({ length: tier }, (_, i) => <i key={i}/>)}</span>}
  </span>;
}
