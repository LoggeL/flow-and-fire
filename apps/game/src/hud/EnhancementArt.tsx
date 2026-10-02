import engineering from './assets/enhancement-art-v1/engineering-v1.webp?url';
import cannon from './assets/enhancement-art-v1/cannon-v1.webp?url';
import armor from './assets/enhancement-art-v1/armor-v1.webp?url';
import './enhancement-art.css';

const ART = { engineering, cannon, armor } as const;

/** Pictorial module illustration; slot labels and accepted blueprint stats remain authoritative. */
export function EnhancementArt({ module }: { readonly module: keyof typeof ART }) {
  return <img class="live-enhancement-art" src={ART[module]} alt="" aria-hidden="true" draggable={false} width={128} height={128}/>;
}
