/*
 * Line icons (24 × 24, 2 px stroke, currentColor), ported from docs/design/ui-mockups/assets/ff.js.
 * Rendered once as an SVG sprite of <symbol id="gi-<name>"> and referenced with <svg><use> (ui.md §9.2).
 * `class="f"` in the mockup (filled parts) becomes fill="currentColor" stroke="none"; `class="thin"`
 * becomes stroke-width="1.6".
 */

export const LINE_ICON_PATHS = {
  move: "<path d=\"M5 19 17 7M10 7h7v7\"/>",
  attack: "<circle cx=\"12\" cy=\"12\" r=\"6\"/><path d=\"M12 2v5M12 17v5M2 12h5M17 12h5\"/><circle cx=\"12\" cy=\"12\" r=\"1\" class=\"f\"/>",
  attackmove: "<path d=\"M3 21 10 14M5 14h5v5\"/><circle cx=\"16\" cy=\"8\" r=\"4.2\"/><path d=\"M16 1.5v3M16 11.5v3M9.5 8h3M19.5 8h3\"/>",
  patrol: "<path d=\"M5.5 10a7 7 0 0 1 12.3-3.6M18 3v4h-4M18.5 14a7 7 0 0 1-12.3 3.6M6 21v-4h4\"/>",
  assist: "<path d=\"M3 17l5-5-5-5M10 17l5-5-5-5\"/><path d=\"M18 6h3v12h-3z\"/>",
  guard: "<path d=\"M12 3 20 6v6c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V6z\"/>",
  reclaim: "<path d=\"M4 4h16l-6 8v6l-4 2v-8z\"/><path d=\"M8 4c1 1.5 2.5 2 4 2s3-.5 4-2\"/>",
  repair: "<path d=\"M14.7 6.3a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.7-7.7a4 4 0 0 0-2-2z\"/><path d=\"M5 5l4 4\"/>",
  stop: "<path d=\"M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7z\"/><path d=\"M9 12h6\"/>",
  fire_return: "<circle cx=\"12\" cy=\"12\" r=\"5.5\"/><path d=\"M12 3v3M12 18v3M3 12h3M18 12h3\"/><path d=\"M8.5 12h7\"/>",
  fire_hold: "<circle cx=\"12\" cy=\"12\" r=\"5.5\"/><path d=\"M12 3v3M12 18v3M3 12h3M18 12h3M5 5l14 14\"/>",
  fire_ground: "<circle cx=\"12\" cy=\"10\" r=\"5\"/><path d=\"M12 2v3M12 15v2M4 10h3M17 10h3M3 21h18M7 21l2-3M15 18l2 3\"/>",
  fire_free: "<circle cx=\"12\" cy=\"12\" r=\"5.5\"/><path d=\"M12 3v3M12 18v3M3 12h3M18 12h3\"/><circle cx=\"12\" cy=\"12\" r=\"1.4\" class=\"f\"/>",
  attackground: "<circle cx=\"12\" cy=\"9.5\" r=\"5\"/><path d=\"M12 2v3M12 14v3M4.5 9.5h3M16.5 9.5h3M3 21h18\"/><path d=\"M8 21l4-4 4 4\"/>",
  pause: "<path d=\"M8 5v14M16 5v14\"/>",
  play: "<path d=\"M7 5l12 7-12 7z\" class=\"f\"/>",
  selfdestruct: "<path d=\"M12 2.5l1.8 5.2 5-2.6-2.6 5 5.3 1.9-5.3 1.9 2.6 5-5-2.6-1.8 5.2-1.8-5.2-5 2.6 2.6-5L2.5 12l5.3-1.9-2.6-5 5 2.6z\"/>",
  shield: "<path d=\"M3.5 18a8.5 8.5 0 0 1 17 0z\"/><path d=\"M12 9.5v8.5M7.5 12l2 6M16.5 12l-2 6\"/>",
  radar: "<path d=\"M12 21v-9\"/><path d=\"M6.5 4.5l12 5.5-3 3.5-12-5.5z\"/><path d=\"M8 21h8\"/>",
  tapshot: "<path d=\"M13 2 6 13h5l-1.5 9L18 10h-5.2z\"/>",
  formation: "<path d=\"M3 17h18\"/><circle cx=\"6\" cy=\"11\" r=\"2\"/><circle cx=\"12\" cy=\"11\" r=\"2\"/><circle cx=\"18\" cy=\"11\" r=\"2\"/>",
  repeat: "<path d=\"M17 2l3.5 3.5L17 9M3.5 11V10a4.5 4.5 0 0 1 4.5-4.5h12.5M7 22l-3.5-3.5L7 15M20.5 13v1a4.5 4.5 0 0 1-4.5 4.5H3.5\"/>",
  rally: "<path d=\"M6 21V3.5M6 4h12l-2.5 4 2.5 4H6\"/>",
  upgrade: "<path d=\"M6 13l6-6 6 6M6 19l6-6 6 6\"/>",
  idle: "<circle cx=\"11\" cy=\"13\" r=\"7.5\"/><path d=\"M11 9v8M7 13h8\"/><path d=\"M16 3h5l-5 5h5\" class=\"thin\"/>",
  f_all: "<path d=\"M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z\"/>",
  f_land: "<path d=\"M6 4h12l2 2v12l-2 2H6l-2-2V6z\"/>",
  f_air: "<path d=\"M12 4l9 16H3z\"/>",
  f_fac: "<path d=\"M12 3l8 4.5v9L12 21l-8-4.5v-9z\"/><path d=\"M9 10h6v4H9z\"/>",
  f_eng: "<circle cx=\"12\" cy=\"12\" r=\"8\"/><path d=\"M12 8v8M8 12h8\"/>",
  f_def: "<path d=\"M12 3l8 4.5v9L12 21l-8-4.5v-9z\"/><circle cx=\"12\" cy=\"12\" r=\"2.5\" class=\"f\"/>",
  menu: "<path d=\"M4 7h16M4 12h16M4 17h16\"/>",
  timer: "<circle cx=\"12\" cy=\"13\" r=\"8\"/><path d=\"M12 9v4l3 2M9 2h6\"/>",
  cap: "<path d=\"M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z\"/><path d=\"M14 17h6M17 14v6\"/>",
  score: "<path d=\"M5 20V11M12 20V4M19 20v-6M3 20h18\"/>",
  speed: "<path d=\"M4 6l7 6-7 6M13 6l7 6-7 6\"/>",
  warn: "<path d=\"M12 3.5 21.5 20h-19z\"/><path d=\"M12 10v4.5M12 17.2v.3\"/>",
  crit: "<path d=\"M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7z\"/><path d=\"M12 7.5v6M12 16.5v.3\"/>",
  info: "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v6M12 7.5v.3\"/>",
  ok: "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M8 12.5l3 3 5-6\"/>",
  jump: "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M12 2v4M12 18v4M2 12h4M18 12h4\"/>",
  close: "<path d=\"M6 6l12 12M18 6 6 18\"/>",
  lock: "<rect x=\"5\" y=\"11\" width=\"14\" height=\"10\" rx=\"1\"/><path d=\"M8 11V8a4 4 0 0 1 8 0v3\"/>",
  console: "<path d=\"M4 6l6 6-6 6M12 18h8\"/>",
  mass: "<path d=\"M12 3l8 9-8 9-8-9z\" class=\"f\"/>",
  energy: "<path d=\"M12 2.5c3 4.6 7 7.6 7 12a7 7 0 0 1-14 0c0-2.5 1.3-4.5 3-6 .3 2 1.3 3 2.3 3.4C9.8 8.8 10.5 5.4 12 2.5z\" class=\"f\"/>",
  sliders: "<path d=\"M4 7h9M17 7h3M4 17h3M11 17h9\"/><circle cx=\"15\" cy=\"7\" r=\"2\"/><circle cx=\"9\" cy=\"17\" r=\"2\"/>",
  speaker: "<path d=\"M4 9h4l5-4v14l-5-4H4z\"/><path d=\"M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12\"/>",
  keyboard: "<rect x=\"2.5\" y=\"6\" width=\"19\" height=\"12\" rx=\"1\"/><path d=\"M6 10h.5M10 10h.5M14 10h.5M18 10h.5M7 14h10\"/>",
  eye: "<path d=\"M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  globe: "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z\"/>",
  flag: "<path d=\"M5 21V4M5 4c3-1.5 5 1.5 8 0s4-1 6 0v9c-2-1-3-1.5-6 0s-5-1.5-8 0\"/>",
  replay: "<path d=\"M4 12a8 8 0 1 0 2.4-5.7M4 3v4h4\"/><path d=\"M10 9l5 3-5 3z\" class=\"f\"/>",
  book: "<path d=\"M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z\"/><path d=\"M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5\"/>",
  exit: "<path d=\"M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10\"/>",
  chevron: "<path d=\"M9 6l6 6-6 6\"/>",
  chevdown: "<path d=\"M6 9l6 6 6-6\"/>",
  plus: "<path d=\"M12 5v14M5 12h14\"/>",
  minus: "<path d=\"M5 12h14\"/>",
  dice: "<rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"2\"/><circle cx=\"9\" cy=\"9\" r=\"1\" class=\"f\"/><circle cx=\"15\" cy=\"15\" r=\"1\" class=\"f\"/><circle cx=\"15\" cy=\"9\" r=\"1\" class=\"f\"/><circle cx=\"9\" cy=\"15\" r=\"1\" class=\"f\"/>",
  cpu: "<rect x=\"7\" y=\"7\" width=\"10\" height=\"10\"/><path d=\"M10 2v5M14 2v5M10 17v5M14 17v5M2 10h5M2 14h5M17 10h5M17 14h5\"/>",
  user: "<circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4 21a8 8 0 0 1 16 0\"/>",
  fullscreen: "<path d=\"M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5\"/>",
  layers: "<path d=\"M12 3 21 8l-9 5-9-5z\"/><path d=\"M3 13l9 5 9-5\"/>",
  target: "<circle cx=\"12\" cy=\"12\" r=\"8\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  skull: "<path d=\"M12 3a7.5 7.5 0 0 0-4.5 13.5V20h9v-3.5A7.5 7.5 0 0 0 12 3z\"/><circle cx=\"9.5\" cy=\"11\" r=\"1.4\" class=\"f\"/><circle cx=\"14.5\" cy=\"11\" r=\"1.4\" class=\"f\"/>",
} as const;

export type LineIconName = keyof typeof LINE_ICON_PATHS;

export const LINE_ICON_NAMES = Object.keys(LINE_ICON_PATHS) as readonly LineIconName[];

/** Symbol body with the mockup helper classes resolved to presentation attributes. */
export function lineIconBody(name: LineIconName): string {
  return LINE_ICON_PATHS[name]
    .replace(/class="f"/g, 'fill="currentColor" stroke="none"')
    .replace(/class="thin"/g, 'stroke-width="1.6"');
}

export const LINE_ICON_SPRITE_ID = 'ff-gi-sprite';

/** Complete sprite markup (hidden, zero size even before CSS loads). */
export function lineIconSpriteMarkup(): string {
  const symbols = LINE_ICON_NAMES.map((n) => `<symbol id="gi-${n}" viewBox="0 0 24 24">${lineIconBody(n)}</symbol>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" id="${LINE_ICON_SPRITE_ID}" class="ff-sprite" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false">${symbols}</svg>`;
}

/** Inserts the sprite into `doc.body` once (idempotent, re-inserts after the body was cleared). */
export function ensureLineIconSprite(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (!doc?.body || doc.getElementById(LINE_ICON_SPRITE_ID)) return;
  doc.body.insertAdjacentHTML('afterbegin', lineIconSpriteMarkup());
}
