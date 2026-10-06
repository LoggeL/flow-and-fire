// Demo data barrel: the single export path of all deterministic demo/fake data modules (seeded PRNG from
// core.ts, never Math.random) plus the full-HUD scenarios and the snapshot generator. The component group
// barrels do not re-export demo data (hud-p7-final).
export * from './core.ts';
export * from './catalog.ts';
export * from './top.ts';
export * from './selection.ts';
export * from './card.ts';
export * from './menus.ts';
export * from './minimap.ts';
export * from './scenarios.ts';
