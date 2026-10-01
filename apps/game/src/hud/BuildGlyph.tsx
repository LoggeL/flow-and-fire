import type { JSX } from 'preact';
import { BUILD_ROLE_COLORS as COLORS, type BuildRole } from './build-role.ts';

// 32×32 silhouettes, filled with the class colour over a dark keyline for contrast on any cell.
const SHAPES: Record<BuildRole, JSX.Element> = {
  mass: <><path d="M6 27h20l-3-5H9z"/><path d="M16 4l6 9-6 9-6-9z"/><path d="M13 22h6v5h-6z"/></>,
  energy: <><path d="M5 27h22v-4H5z"/><path d="M8 23v-7a8 8 0 0 1 16 0v7z"/><path d="M17 8l-5 8h4l-2 6 6-9h-4l2-5z" fill="#111714"/></>,
  storage: <><rect x="8" y="6" width="16" height="21" rx="3"/><path d="M8 12h16M8 19h16" stroke="#111714" stroke-width="2"/><path d="M13 3h6v3h-6z"/></>,
  factory: <><path d="M3 27V14l7 4v-4l7 4v-4l7 4V6h5v21z"/><path d="M8 22h4v5H8zM15 22h4v5h-4z" fill="#111714"/></>,
  engineer: <><circle cx="16" cy="11" r="5"/><path d="M7 27c0-6 4-9 9-9s9 3 9 9z"/><path d="M21 4l5 5-2 2-5-5z"/></>,
  radar: <><path d="M15 27h2V16h-2z"/><path d="M10 27h12v-3H10z"/><path d="M6 13a10 10 0 0 1 20 0z"/><circle cx="16" cy="6" r="2"/></>,
  defense: <><path d="M6 27h20v-6H6z"/><path d="M9 21v-6a7 7 0 0 1 14 0v6z"/><path d="M18 12h11v3H18z"/></>,
  artillery: <><path d="M4 25h24v-5H4z"/><path d="M10 20l3-6h6l2 6z"/><path d="M17 15l9-10 2 2-9 10z"/></>,
  scout: <><path d="M4 22h24l-3-6H9z"/><circle cx="9" cy="24" r="3"/><circle cx="23" cy="24" r="3"/><circle cx="16" cy="12" r="3"/></>,
  tank: <><path d="M3 24h26l-3-6H6z"/><path d="M9 18l2-5h10l2 5z"/><path d="M19 14h11v2.5H19z"/></>,
  unit: <><path d="M6 24h20l-3-8H9z"/></>,
};

/** Distinct class silhouettes and colours for the build/production card. */
export function BuildGlyph({ role, tier }: { readonly role: BuildRole; readonly tier: number }) {
  return <svg class="ff-cell__icon live-build-glyph" data-role={role} viewBox="0 0 32 32" aria-hidden="true" focusable="false" style={{ color: COLORS[role] }}>
    <g fill="currentColor" stroke="#0b100d" stroke-width="1.2" stroke-linejoin="round" paint-order="stroke">{SHAPES[role]}</g>
    {tier > 0 && <g class="live-build-glyph-tier" fill="currentColor">{Array.from({ length: tier }, (_, i) => <rect key={i} x={29 - (tier - i) * 4} y="1" width="3" height="3"/>)}</g>}
  </svg>;
}
