/**
 * Minimap drawing (ui.md §5.4, §9.2 "Fog/Einheiten auf eigene Ebenen"): pure functions against a minimal
 * 2D-context interface, so they run
 * against a recording mock in tests. Never reads pixels back (no getImageData) and never draws text.
 * Coordinates: world units (x east, z south) → canvas pixels via `k = size / mapSizeWu`.
 */
import type { MinimapFog, MinimapMode, MinimapPing, MinimapSpot, MinimapTerrain, MinimapUnits } from '../../model/minimap.ts';
import { MINIMAP_KIND_BLIP, MINIMAP_KIND_GHOST, MINIMAP_KIND_STRUCTURE, MINIMAP_PING_LIFE_S, pingAgeS } from '../../model/minimap.ts';

/** The part of CanvasRenderingContext2D the minimap uses (a real context is assignable to it). */
export interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  imageSmoothingEnabled: boolean;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
  stroke(): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
}

/** Contexts of the offscreen bitmaps (terrain, fog) additionally upload pixels. */
export interface PixelCtx2D extends Ctx2D {
  createImageData(w: number, h: number): ImageData;
  putImageData(data: ImageData, dx: number, dy: number): void;
}

/** Colours of the dynamic layer; team colours come from CSS tokens (read once per team mode). */
export interface MinimapPalette {
  readonly self: string;
  readonly enemy: string;
  /** Dark outline around unit squares. */
  readonly outline: string;
  readonly blip: string;
  readonly mass: string;
  readonly hydro: string;
  readonly ping: string;
  readonly camera: string;
}

/** Fallbacks = tokens.css values (house colours), used when CSS variables are not readable (tests). */
export const DEFAULT_MINIMAP_PALETTE: MinimapPalette = {
  self: '#2f6fd0',
  enemy: '#c8372d',
  outline: '#090807',
  blip: '#9a9a9a',
  mass: '#7fd1b2',
  hydro: '#8fb8e8',
  ping: '#ff8a2a',
  camera: '#f1ebdf',
};

/** CSS custom properties behind each palette entry. */
export const MINIMAP_PALETTE_TOKENS: Readonly<Record<keyof MinimapPalette, string>> = {
  self: '--team-self',
  enemy: '--team-enemy',
  outline: '--iron-1000',
  blip: '--neutral-blip',
  mass: '--mass',
  hydro: '--info',
  ping: '--ember-500',
  camera: '--text-hi',
};

/** Reads the palette from computed CSS variables (call once per team-mode change, never per draw). */
export function readMinimapPalette(read: (token: string) => string): MinimapPalette {
  const out: Record<string, string> = {};
  for (const key of Object.keys(MINIMAP_PALETTE_TOKENS) as (keyof MinimapPalette)[]) {
    const v = read(MINIMAP_PALETTE_TOKENS[key]).trim();
    out[key] = v !== '' ? v : DEFAULT_MINIMAP_PALETTE[key];
  }
  return out as unknown as MinimapPalette;
}

// ---------------------------------------------------------------------------------------------------------
// Sizes (CSS px at scale 1; multiplied by the device pixel ratio of the backing store)

/** Unit square edge (ui.md §5.4: units 4 px, structures 6 px), outline 1 px. */
export const UNIT_PX = 4;
export const STRUCTURE_PX = 6;
export const OUTLINE_PX = 1;
export const BLIP_RADIUS_PX = 3;
export const SPOT_PX = 4;
/** Two ember rings (mockup: 11/19 px on a 400-px canvas shown at ≈ 200 CSS px). */
export const PING_RADII_PX: readonly [number, number] = [6, 10];

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------------------
// Terrain (once per terrain / mode)

/** Tactical colours: water, low, mid, high land (iron tokens, flat, readable under unit squares). */
const TACTICAL: readonly (readonly [number, number, number])[] = [
  [22, 34, 42],
  [46, 43, 41],
  [59, 54, 50],
  [78, 71, 65],
];

/** Pixel is water: clearly blue-dominant. */
function isWater(r: number, g: number, b: number): boolean {
  return b > r + 12 && b >= g;
}

/**
 * Fills `out` (RGBA, terrain.width × terrain.height) from the terrain: 'terrain' copies the colours,
 * 'tactical' flattens them to water + three land bands by brightness.
 */
export function buildTerrainPixels(terrain: MinimapTerrain, mode: MinimapMode, out: Uint8ClampedArray): void {
  const src = terrain.rgba;
  const n = terrain.width * terrain.height * 4;
  if (mode === 'terrain') {
    out.set(src.subarray(0, n));
    return;
  }
  for (let i = 0; i < n; i += 4) {
    const r = src[i]!;
    const g = src[i + 1]!;
    const b = src[i + 2]!;
    let c: readonly [number, number, number];
    if (isWater(r, g, b)) c = TACTICAL[0]!;
    else {
      const lum = 0.3 * r + 0.59 * g + 0.11 * b;
      c = lum < 72 ? TACTICAL[1]! : lum < 104 ? TACTICAL[2]! : TACTICAL[3]!;
    }
    out[i] = c[0];
    out[i + 1] = c[1];
    out[i + 2] = c[2];
    out[i + 3] = 255;
  }
}

/** Uploads the terrain into its offscreen context (putImageData, no readback). */
export function paintTerrainBitmap(ctx: PixelCtx2D, terrain: MinimapTerrain, mode: MinimapMode): void {
  const img = ctx.createImageData(terrain.width, terrain.height);
  buildTerrainPixels(terrain, mode, img.data);
  ctx.putImageData(img, 0, 0);
}

/** Draws the cached terrain bitmap scaled to the visible terrain layer (smoothly). */
export function drawTerrainLayer(ctx: Ctx2D, bitmap: CanvasImageSource | null, size: number): void {
  ctx.clearRect(0, 0, size, size);
  if (bitmap === null) {
    ctx.fillStyle = '#0a0908';
    ctx.fillRect(0, 0, size, size);
    return;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bitmap, 0, 0, size, size);
}

// ---------------------------------------------------------------------------------------------------------
// Fog (2 Hz): 0 never seen = dark, 1 explored = dimmed, 2 visible = clear (I1)

/** RGBA per fog level (warm black over the terrain). */
export const FOG_RGBA: readonly (readonly [number, number, number, number])[] = [
  [6, 5, 4, 200],
  [6, 5, 4, 110],
  [6, 5, 4, 0],
];

export function buildFogPixels(fog: MinimapFog, out: Uint8ClampedArray): void {
  const cells = fog.cells;
  const n = fog.res * fog.res;
  for (let i = 0; i < n; i++) {
    const lvl = cells[i]!;
    const c = FOG_RGBA[lvl > 2 ? 2 : lvl]!;
    const o = i * 4;
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = c[2];
    out[o + 3] = c[3];
  }
}

export function paintFogBitmap(ctx: PixelCtx2D, fog: MinimapFog): void {
  const img = ctx.createImageData(fog.res, fog.res);
  buildFogPixels(fog, img.data);
  ctx.putImageData(img, 0, 0);
}

/** Fog layer (own canvas, redrawn only when the fog changes, 2 Hz): the small bitmap scaled up smoothly. */
export function drawFogLayer(ctx: Ctx2D, bitmap: CanvasImageSource | null, size: number): void {
  ctx.clearRect(0, 0, size, size);
  if (bitmap === null) return;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bitmap, 0, 0, size, size);
}

// ---------------------------------------------------------------------------------------------------------
// Dynamic layer (4 Hz): resource spots, units, blips, ghosts, pings

export interface DynamicFrame {
  /** Backing-store edge in device pixels. */
  readonly size: number;
  /** Device pixels per CSS pixel (unit sizes scale with it). */
  readonly dpr: number;
  readonly mapSizeWu: number;
  readonly spots: readonly MinimapSpot[];
  readonly showResources: boolean;
  readonly units: MinimapUnits;
  readonly pings: readonly MinimapPing[];
  readonly nowS: number;
  readonly palette: MinimapPalette;
  /** Pre-rendered blip ring and ghost squares; null draws them as paths. */
  readonly sprites?: MinimapSprites | null | undefined;
}

/** Resource spots as diamonds: free filled, taken hollow; hydro in its own colour. */
export function drawSpots(ctx: Ctx2D, spots: readonly MinimapSpot[], k: number, dpr: number, palette: MinimapPalette): void {
  const h = (SPOT_PX * dpr) / 2;
  for (const kind of ['mass', 'hydro'] as const) {
    const colour = kind === 'mass' ? palette.mass : palette.hydro;
    ctx.beginPath();
    let any = false;
    for (const s of spots) {
      if (s.kind !== kind || s.taken) continue;
      any = true;
      diamond(ctx, s.x * k, s.z * k, h);
    }
    if (any) {
      ctx.fillStyle = colour;
      ctx.fill();
    }
    ctx.beginPath();
    any = false;
    for (const s of spots) {
      if (s.kind !== kind || !s.taken) continue;
      any = true;
      diamond(ctx, s.x * k, s.z * k, h);
    }
    if (any) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = dpr;
      ctx.stroke();
    }
  }
}

function diamond(ctx: Ctx2D, x: number, y: number, h: number): void {
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + h, y);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x - h, y);
  ctx.closePath();
}

/** A pre-rendered marker, stamped with drawImage (far cheaper than hundreds of arcs/strokes in Firefox). */
export interface Sprite {
  readonly image: CanvasImageSource;
  /** Edge in device pixels (the marker is centred). */
  readonly size: number;
}

/** Sprites of the dynamic layer: blip ring (grey) and hollow ghost squares per owner colour. */
export interface MinimapSprites {
  readonly blip: Sprite;
  readonly ghostSelf: Sprite;
  readonly ghostEnemy: Sprite;
}

/** Edge of the blip sprite for a device pixel ratio (ring radius + line width on both sides). */
export function blipSpriteSize(dpr: number): number {
  return Math.ceil((BLIP_RADIUS_PX + 1.5) * dpr * 2);
}

/** Edge of a ghost sprite (structure square + line width). */
export function ghostSpriteSize(dpr: number): number {
  return Math.ceil((STRUCTURE_PX + 2) * dpr);
}

/** Paints the grey blip ring into a sprite of blipSpriteSize(dpr) (once per palette / pixel ratio). */
export function paintBlipSprite(ctx: Ctx2D, dpr: number, palette: MinimapPalette): void {
  const size = blipSpriteSize(dpr);
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = palette.blip;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(c, c, BLIP_RADIUS_PX * dpr, 0, TAU);
  ctx.stroke();
}

/** Paints a hollow ghost square (structure size, 1.5-px line) into a sprite of ghostSpriteSize(dpr). */
export function paintGhostSprite(ctx: Ctx2D, dpr: number, colour: string): void {
  const size = ghostSpriteSize(dpr);
  const h = (STRUCTURE_PX * dpr) / 2;
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.rect(c - h, c - h, h * 2, h * 2);
  ctx.stroke();
}

function stamp(ctx: Ctx2D, sprite: Sprite, x: number, y: number): void {
  const h = sprite.size / 2;
  ctx.drawImage(sprite.image, x - h, y - h, sprite.size, sprite.size);
}

/**
 * Units and structures as squares in team colour with a dark outline (own and visible enemies filled),
 * ghost structures hollow, radar blips as grey rings. Squares are batched into one path per colour (3 fills
 * regardless of the unit count); ghosts and blips are stamped from `sprites` when given, else drawn as paths.
 */
export function drawUnits(ctx: Ctx2D, units: MinimapUnits, k: number, dpr: number, palette: MinimapPalette, sprites: MinimapSprites | null = null): void {
  const n = units.count;
  const { x, z, army, kind } = units;
  const u = (UNIT_PX * dpr) / 2;
  const st = (STRUCTURE_PX * dpr) / 2;
  const o = OUTLINE_PX * dpr;
  // Outline under all filled squares.
  ctx.beginPath();
  let filled = 0;
  for (let i = 0; i < n; i++) {
    const kd = kind[i]!;
    if (kd === MINIMAP_KIND_BLIP || kd === MINIMAP_KIND_GHOST) continue;
    const h = (kd === MINIMAP_KIND_STRUCTURE ? st : u) + o;
    ctx.rect(x[i]! * k - h, z[i]! * k - h, h * 2, h * 2);
    filled++;
  }
  if (filled > 0) {
    ctx.fillStyle = palette.outline;
    ctx.fill();
  }
  // Fills: own (army 0), then everyone else.
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < n; i++) {
      const kd = kind[i]!;
      if (kd === MINIMAP_KIND_BLIP || kd === MINIMAP_KIND_GHOST) continue;
      if ((army[i] === 0) !== (pass === 0)) continue;
      const h = kd === MINIMAP_KIND_STRUCTURE ? st : u;
      ctx.rect(x[i]! * k - h, z[i]! * k - h, h * 2, h * 2);
      any = true;
    }
    if (any) {
      ctx.fillStyle = pass === 0 ? palette.self : palette.enemy;
      ctx.fill();
    }
  }
  if (sprites !== null) {
    // Ghost structures (hollow, owner colour) and radar blips (grey rings, no owner, I3) as stamped sprites.
    for (let i = 0; i < n; i++) {
      const kd = kind[i]!;
      if (kd === MINIMAP_KIND_GHOST) stamp(ctx, army[i] === 0 ? sprites.ghostSelf : sprites.ghostEnemy, x[i]! * k, z[i]! * k);
      else if (kd === MINIMAP_KIND_BLIP) stamp(ctx, sprites.blip, x[i]! * k, z[i]! * k);
    }
    return;
  }
  // Ghost structures: hollow squares in the owner's colour.
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < n; i++) {
      if (kind[i] !== MINIMAP_KIND_GHOST || (army[i] === 0) !== (pass === 0)) continue;
      ctx.rect(x[i]! * k - st, z[i]! * k - st, st * 2, st * 2);
      any = true;
    }
    if (any) {
      ctx.strokeStyle = pass === 0 ? palette.self : palette.enemy;
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
    }
  }
  // Radar blips: grey rings (no owner colour, I3).
  const r = BLIP_RADIUS_PX * dpr;
  ctx.beginPath();
  let blips = 0;
  for (let i = 0; i < n; i++) {
    if (kind[i] !== MINIMAP_KIND_BLIP) continue;
    const cx = x[i]! * k;
    const cy = z[i]! * k;
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, TAU);
    blips++;
  }
  if (blips > 0) {
    ctx.strokeStyle = palette.blip;
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();
  }
}

/** Alert pings: two ember rings, fading over MINIMAP_PING_LIFE_S (static under reduced motion as well). */
export function drawPings(ctx: Ctx2D, pings: readonly MinimapPing[], nowS: number, k: number, dpr: number, palette: MinimapPalette): void {
  if (pings.length === 0) return;
  ctx.strokeStyle = palette.ping;
  ctx.lineWidth = 1.5 * dpr;
  for (const p of pings) {
    const age = pingAgeS(p, nowS);
    if (age >= MINIMAP_PING_LIFE_S) continue;
    const fade = 1 - (age / MINIMAP_PING_LIFE_S) * 0.6;
    const cx = p.x * k;
    const cy = p.z * k;
    for (let ring = 0; ring < 2; ring++) {
      const r = PING_RADII_PX[ring]! * dpr;
      ctx.globalAlpha = ring === 0 ? 0.95 * fade : 0.45 * fade;
      ctx.beginPath();
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** Whole dynamic layer in one pass (cleared first). */
export function drawDynamicLayer(ctx: Ctx2D, f: DynamicFrame): void {
  const { size, dpr } = f;
  const k = f.mapSizeWu > 0 ? size / f.mapSizeWu : 0;
  ctx.clearRect(0, 0, size, size);
  if (k === 0) return;
  if (f.showResources) drawSpots(ctx, f.spots, k, dpr, f.palette);
  drawUnits(ctx, f.units, k, dpr, f.palette, f.sprites ?? null);
  drawPings(ctx, f.pings, f.nowS, k, dpr, f.palette);
}

// ---------------------------------------------------------------------------------------------------------
// Overlay (on camera change): the camera trapezoid, 4 lines

export function drawCameraLayer(
  ctx: Ctx2D,
  camera: readonly (readonly [number, number])[],
  size: number,
  mapSizeWu: number,
  dpr: number,
  palette: MinimapPalette,
): void {
  ctx.clearRect(0, 0, size, size);
  if (camera.length < 2 || !(mapSizeWu > 0)) return;
  const k = size / mapSizeWu;
  ctx.strokeStyle = palette.camera;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  const first = camera[0]!;
  ctx.moveTo(first[0] * k, first[1] * k);
  for (let i = 1; i < camera.length; i++) {
    const p = camera[i]!;
    ctx.lineTo(p[0] * k, p[1] * k);
  }
  ctx.closePath();
  ctx.stroke();
}

// ---------------------------------------------------------------------------------------------------------
// Pointer → world

export interface ClientRectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Converts a client position over the (square) minimap canvas into world units; null outside the canvas.
 * Positions on the edge clamp to the map.
 */
export function minimapToWorld(clientX: number, clientY: number, rect: ClientRectLike, mapSizeWu: number): { readonly x: number; readonly z: number } | null {
  if (!(rect.width > 0) || !(rect.height > 0) || !(mapSizeWu > 0)) return null;
  const fx = (clientX - rect.left) / rect.width;
  const fz = (clientY - rect.top) / rect.height;
  if (fx < 0 || fx > 1 || fz < 0 || fz > 1) return null;
  return { x: fx * mapSizeWu, z: fz * mapSizeWu };
}

/** World position → canvas pixel (inverse of minimapToWorld for a backing store of `size`). */
export function worldToMinimap(x: number, z: number, size: number, mapSizeWu: number): { readonly px: number; readonly py: number } {
  const k = mapSizeWu > 0 ? size / mapSizeWu : 0;
  return { px: x * k, py: z * k };
}
