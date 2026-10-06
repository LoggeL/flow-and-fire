/**
 * Imperative Canvas2D renderer of the minimap (ui.md §5.4, §9.1, §9.2 "Terrain einmal in eine Offscreen-Canvas,
 * Fog/Einheiten auf eigene Ebenen"): visible layers
 *   terrain  – drawn once per terrain/mode from an offscreen bitmap,
 *   fog      – the 3-level fog (small bitmap rebuilt and scaled up only when the fog changes, 2 Hz),
 *   dynamic  – resource spots + units/blips/ghosts + pings (4 Hz; blips and ghosts stamped from sprites),
 *   overlay  – only the camera trapezoid, redrawn on camera change, bundled into one animation frame.
 * No getImageData, no text; team colours are read from CSS tokens once per team mode.
 */
import type { MinimapFog, MinimapMode, MinimapPing, MinimapSpot, MinimapTerrain, MinimapUnits } from '../../model/minimap.ts';
import { emptyMinimapUnits } from '../../model/minimap.ts';
import {
  DEFAULT_MINIMAP_PALETTE,
  blipSpriteSize,
  drawCameraLayer,
  drawDynamicLayer,
  drawFogLayer,
  drawTerrainLayer,
  ghostSpriteSize,
  paintBlipSprite,
  paintGhostSprite,
  paintFogBitmap,
  paintTerrainBitmap,
  readMinimapPalette,
} from './draw.ts';
import type { Ctx2D, MinimapPalette, MinimapSprites, PixelCtx2D, Sprite } from './draw.ts';
import { nowMs, requestFrameFallback } from '../../ui/frame.ts';

/** Name of the performance measure of one dynamic-layer draw (budget ≤ 0.5 ms, MS11). */
export const MINIMAP_DRAW_MEASURE = 'hud-minimap';

/** An offscreen bitmap with its context (null context = drawing unavailable, e.g. happy-dom). */
export interface Bitmap {
  readonly image: CanvasImageSource & { width: number; height: number };
  readonly ctx: PixelCtx2D | null;
}

export interface MinimapLayers {
  readonly terrain: HTMLCanvasElement;
  readonly fog: HTMLCanvasElement;
  readonly dynamic: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
}

export interface MinimapRendererOptions {
  /** 2D context of a visible layer (default canvas.getContext('2d')). */
  readonly getContext?: ((canvas: HTMLCanvasElement) => Ctx2D | null) | undefined;
  /** Offscreen bitmap factory (default: a detached <canvas>). */
  readonly createBitmap?: ((w: number, h: number) => Bitmap) | undefined;
  /** Reads a CSS custom property (default: getComputedStyle of the terrain canvas). */
  readonly readToken?: ((token: string) => string) | undefined;
  /** Schedules the overlay draw (default requestAnimationFrame). */
  readonly requestFrame?: ((cb: () => void) => unknown) | undefined;
}

export interface DynamicInput {
  readonly mapSizeWu: number;
  readonly spots: readonly MinimapSpot[];
  readonly showResources: boolean;
  readonly units: MinimapUnits;
  readonly pings: readonly MinimapPing[];
  readonly nowS: number;
}

export interface MinimapRendererStats {
  terrainDraws: number;
  /** Fog bitmap rebuilds (= fog layer draws). */
  fogBuilds: number;
  dynamicDraws: number;
  overlayDraws: number;
  /** Duration of the last / slowest dynamic draw in ms. */
  lastDynamicMs: number;
  maxDynamicMs: number;
}

function defaultGetContext(canvas: HTMLCanvasElement): Ctx2D | null {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

function defaultCreateBitmap(w: number, h: number): Bitmap {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  let ctx: PixelCtx2D | null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  return { image: canvas, ctx };
}


const EMPTY_INPUT: DynamicInput = { mapSizeWu: 0, spots: [], showResources: true, units: emptyMinimapUnits(), pings: [], nowS: 0 };

export class MinimapRenderer {
  readonly stats: MinimapRendererStats = { terrainDraws: 0, fogBuilds: 0, dynamicDraws: 0, overlayDraws: 0, lastDynamicMs: 0, maxDynamicMs: 0 };
  private readonly layers: MinimapLayers;
  private readonly ctx: { readonly terrain: Ctx2D | null; readonly fog: Ctx2D | null; readonly dynamic: Ctx2D | null; readonly overlay: Ctx2D | null };
  private readonly createBitmap: (w: number, h: number) => Bitmap;
  private readonly readToken: (token: string) => string;
  private readonly requestFrame: (cb: () => void) => unknown;
  private sizePx = 0;
  private dprValue = 1;
  private palette: MinimapPalette = DEFAULT_MINIMAP_PALETTE;
  private terrainKey: { terrain: MinimapTerrain | null; mode: MinimapMode } = { terrain: null, mode: 'terrain' };
  private terrainBitmap: Bitmap | null = null;
  private fogRef: MinimapFog | null = null;
  private fogBitmap: Bitmap | null = null;
  private input: DynamicInput = EMPTY_INPUT;
  private camera: readonly (readonly [number, number])[] = [];
  private sprites: MinimapSprites | null = null;
  private spritesKey = '';
  private overlayPending = false;
  private disposed = false;

  constructor(layers: MinimapLayers, options: MinimapRendererOptions = {}) {
    this.layers = layers;
    const get = options.getContext ?? defaultGetContext;
    this.ctx = { terrain: get(layers.terrain), fog: get(layers.fog), dynamic: get(layers.dynamic), overlay: get(layers.overlay) };
    this.createBitmap = options.createBitmap ?? defaultCreateBitmap;
    this.readToken =
      options.readToken ??
      ((token) => (typeof getComputedStyle === 'function' ? getComputedStyle(layers.terrain).getPropertyValue(token) : ''));
    this.requestFrame = options.requestFrame ?? requestFrameFallback;
  }

  /** Backing-store edge in device pixels. */
  get size(): number {
    return this.sizePx;
  }

  get dpr(): number {
    return this.dprValue;
  }

  get currentPalette(): MinimapPalette {
    return this.palette;
  }

  /** Sets the square backing store (CSS px × device pixel ratio) and redraws every layer. */
  resize(cssPx: number, dpr = 1): void {
    const size = Math.max(1, Math.round(cssPx * dpr));
    if (size === this.sizePx && dpr === this.dprValue) return;
    this.sizePx = size;
    this.dprValue = dpr;
    for (const c of [this.layers.terrain, this.layers.fog, this.layers.dynamic, this.layers.overlay]) {
      c.width = size;
      c.height = size;
    }
    this.drawTerrain();
    this.drawFog();
    this.drawDynamic(this.input);
    this.drawOverlayNow();
  }

  /** Re-reads the team colours from the CSS tokens (once per team-mode change) and redraws. */
  refreshPalette(): void {
    this.palette = readMinimapPalette(this.readToken);
    this.drawDynamic(this.input);
    this.drawOverlayNow();
  }

  /** Terrain or mode changed: rebuild the offscreen bitmap and draw the terrain layer (once). */
  setTerrain(terrain: MinimapTerrain | null, mode: MinimapMode): void {
    if (terrain === this.terrainKey.terrain && mode === this.terrainKey.mode && this.terrainBitmap !== null) return;
    this.terrainKey = { terrain, mode };
    if (terrain === null) {
      this.terrainBitmap = null;
    } else {
      const bmp =
        this.terrainBitmap !== null && this.terrainBitmap.image.width === terrain.width && this.terrainBitmap.image.height === terrain.height
          ? this.terrainBitmap
          : this.createBitmap(terrain.width, terrain.height);
      if (bmp.ctx !== null) paintTerrainBitmap(bmp.ctx, terrain, mode);
      this.terrainBitmap = bmp;
    }
    this.drawTerrain();
  }

  /** Fog changed (2 Hz): rebuild the small fog bitmap and redraw the fog layer. False when unchanged. */
  setFog(fog: MinimapFog | null): boolean {
    if (fog === this.fogRef) return false;
    this.fogRef = fog;
    if (fog === null) {
      this.fogBitmap = null;
    } else {
      const bmp = this.fogBitmap !== null && this.fogBitmap.image.width === fog.res ? this.fogBitmap : this.createBitmap(fog.res, fog.res);
      if (bmp.ctx !== null) paintFogBitmap(bmp.ctx, fog);
      this.fogBitmap = bmp;
    }
    this.stats.fogBuilds++;
    this.drawFog();
    return true;
  }

  /** Draws the dynamic layer (fog, spots, units, pings) and measures it ("hud-minimap"). */
  drawDynamic(input: DynamicInput): void {
    this.input = input;
    const ctx = this.ctx.dynamic;
    if (ctx === null || this.sizePx === 0 || this.disposed) return;
    const t0 = nowMs();
    const sprites = this.ensureSprites();
    drawDynamicLayer(ctx, {
      size: this.sizePx,
      dpr: this.dprValue,
      mapSizeWu: input.mapSizeWu,
      spots: input.spots,
      showResources: input.showResources,
      units: input.units,
      pings: input.pings,
      nowS: input.nowS,
      palette: this.palette,
      sprites,
    });
    const t1 = nowMs();
    const ms = t1 - t0;
    this.stats.dynamicDraws++;
    this.stats.lastDynamicMs = ms;
    if (ms > this.stats.maxDynamicMs) this.stats.maxDynamicMs = ms;
    measure(t0, t1);
  }

  /** Camera changed: redraw the overlay in the next animation frame (several changes → one draw). */
  setCamera(camera: readonly (readonly [number, number])[]): void {
    this.camera = camera;
    if (this.overlayPending || this.disposed) return;
    this.overlayPending = true;
    this.requestFrame(() => {
      this.overlayPending = false;
      this.drawOverlayNow();
    });
  }

  dispose(): void {
    this.disposed = true;
  }

  /** Blip and ghost sprites for the current palette and pixel ratio (rebuilt when either changes). */
  private ensureSprites(): MinimapSprites | null {
    const p = this.palette;
    const key = `${p.blip}|${p.self}|${p.enemy}@${this.dprValue}`;
    if (key === this.spritesKey) return this.sprites;
    this.spritesKey = key;
    const make = (size: number, paint: (ctx: Ctx2D) => void): Sprite | null => {
      const bmp = this.createBitmap(size, size);
      if (bmp.ctx === null) return null;
      paint(bmp.ctx);
      return { image: bmp.image, size };
    };
    const dpr = this.dprValue;
    const blip = make(blipSpriteSize(dpr), (c) => paintBlipSprite(c, dpr, p));
    const ghostSelf = make(ghostSpriteSize(dpr), (c) => paintGhostSprite(c, dpr, p.self));
    const ghostEnemy = make(ghostSpriteSize(dpr), (c) => paintGhostSprite(c, dpr, p.enemy));
    this.sprites = blip !== null && ghostSelf !== null && ghostEnemy !== null ? { blip, ghostSelf, ghostEnemy } : null;
    return this.sprites;
  }

  private drawTerrain(): void {
    const ctx = this.ctx.terrain;
    if (ctx === null || this.sizePx === 0 || this.disposed) return;
    const bmp = this.terrainBitmap;
    drawTerrainLayer(ctx, bmp !== null && bmp.ctx !== null ? bmp.image : null, this.sizePx);
    this.stats.terrainDraws++;
  }

  private drawFog(): void {
    const ctx = this.ctx.fog;
    if (ctx === null || this.sizePx === 0 || this.disposed) return;
    const bmp = this.fogBitmap;
    drawFogLayer(ctx, bmp !== null && bmp.ctx !== null ? bmp.image : null, this.sizePx);
  }

  private drawOverlayNow(): void {
    const ctx = this.ctx.overlay;
    if (ctx === null || this.sizePx === 0 || this.disposed) return;
    drawCameraLayer(ctx, this.camera, this.sizePx, this.input.mapSizeWu, this.dprValue, this.palette);
    this.stats.overlayDraws++;
  }
}

function measure(start: number, end: number): void {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return;
  try {
    performance.measure(MINIMAP_DRAW_MEASURE, { start, end });
    performance.clearMeasures(MINIMAP_DRAW_MEASURE);
  } catch {
    // measure(name, options) is unavailable in very old engines; the stats above still hold the value.
  }
}
