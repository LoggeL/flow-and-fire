import logo from './assets/menu/flow-fire-logo-v1.webp';
import './brand.css';

/** The same generated identity is used in the frontend and the in-match menu. */
export function BrandLogo({ compact = false }: { readonly compact?: boolean }) {
  return <img class={compact ? 'live-brand-logo' : 'main-menu-logo'} src={logo} alt="Flow & Fire" draggable={false} decoding="async" data-testid="game-brand-logo"/>;
}
