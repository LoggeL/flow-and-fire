import { describe, expect, test } from 'vitest';
import {
  DEFAULT_MINIMAP_PALETTE,
  FOG_RGBA,
  MINIMAP_PALETTE_TOKENS,
  buildFogPixels,
  blipSpriteSize,
  buildTerrainPixels,
  drawCameraLayer,
  drawDynamicLayer,
  drawFogLayer,
  drawPings,
  drawSpots,
  drawUnits,
  ghostSpriteSize,
  minimapToWorld,
  paintBlipSprite,
  paintGhostSprite,
  readMinimapPalette,
  worldToMinimap,
} from '../../src/hud/minimap/draw.ts';
import { MINIMAP_KIND_BLIP, MINIMAP_KIND_GHOST, MINIMAP_KIND_STRUCTURE, MINIMAP_KIND_UNIT, MINIMAP_PING_LIFE_S } from '../../src/model/minimap.ts';
import type { MinimapUnits } from '../../src/model/minimap.ts';
import { recordingCtx } from './mock-ctx.ts';

const P = DEFAULT_MINIMAP_PALETTE;

function units(list: readonly (readonly [number, number, number, number])[]): MinimapUnits {
  const n = list.length;
  const u = { count: n, x: new Float32Array(n), z: new Float32Array(n), army: new Uint8Array(n), kind: new Uint8Array(n) };
  list.forEach(([x, z, army, kind], i) => {
    u.x[i] = x;
    u.z[i] = z;
    u.army[i] = army;
    u.kind[i] = kind;
  });
  return u;
}

describe('drawUnits (ui.md §5.4)', () => {
  const sample = units([
    [100, 100, 0, MINIMAP_KIND_UNIT],
    [120, 100, 0, MINIMAP_KIND_STRUCTURE],
    [300, 50, 1, MINIMAP_KIND_UNIT],
    [320, 50, 1, MINIMAP_KIND_GHOST],
    [340, 60, 1, MINIMAP_KIND_BLIP],
  ]);

  test('own 4 px / structures 6 px in team colour with a dark 1-px outline, enemies filled, ghosts hollow, blips grey rings', () => {
    const ctx = recordingCtx();
    drawUnits(ctx, sample, 1, 1, P);
    const rects = ctx.of('rect');
    // Outline pass (3 filled entries, +1 px each side), own fill (2), enemy fill (1), ghost (1).
    expect(rects.slice(0, 3)).toEqual([
      ['rect', 97, 97, 6, 6],
      ['rect', 116, 96, 8, 8],
      ['rect', 297, 47, 6, 6],
    ]);
    expect(rects.slice(3, 5)).toEqual([
      ['rect', 98, 98, 4, 4],
      ['rect', 117, 97, 6, 6],
    ]);
    expect(rects[5]).toEqual(['rect', 298, 48, 4, 4]);
    expect(rects[6]).toEqual(['rect', 317, 47, 6, 6]);
    expect(ctx.of('fill')).toEqual([
      ['fill', P.outline],
      ['fill', P.self],
      ['fill', P.enemy],
    ]);
    const strokes = ctx.of('stroke');
    expect(strokes.map((s) => s[1])).toEqual([P.enemy, P.blip]);
    expect(ctx.of('arc')).toEqual([['arc', 340, 60, 3, 0, Math.PI * 2]]);
  });

  test('batched: a constant number of fill/stroke calls for 800 entries', () => {
    const list: [number, number, number, number][] = [];
    for (let i = 0; i < 800; i++) list.push([i % 512, (i * 7) % 512, i < 500 ? 0 : 1, i % 4]);
    const ctx = recordingCtx();
    drawUnits(ctx, units(list), 0.5, 2, P);
    expect(ctx.of('fill').length + ctx.of('stroke').length).toBeLessThanOrEqual(6);
    expect(ctx.of('rect').length + ctx.of('arc').length).toBeGreaterThan(800);
  });

  test('ghosts and blips stamped from pre-rendered sprites (one drawImage each, no arcs or strokes)', () => {
    const img = (name: string): CanvasImageSource => ({ name }) as unknown as CanvasImageSource;
    const sprites = {
      blip: { image: img('blip'), size: blipSpriteSize(2) },
      ghostSelf: { image: img('gs'), size: ghostSpriteSize(2) },
      ghostEnemy: { image: img('ge'), size: ghostSpriteSize(2) },
    };
    expect(sprites.blip.size).toBe(18);
    expect(sprites.ghostEnemy.size).toBe(16);
    const ctx = recordingCtx();
    drawUnits(ctx, sample, 1, 2, P, sprites);
    expect(ctx.of('arc')).toHaveLength(0);
    expect(ctx.of('stroke')).toHaveLength(0);
    expect(ctx.of('drawImage')).toEqual([
      ['drawImage', sprites.ghostEnemy.image, 312, 42, 16, 16],
      ['drawImage', sprites.blip.image, 331, 51, 18, 18],
    ]);
    const spr = recordingCtx();
    paintBlipSprite(spr, 2, P);
    expect(spr.of('arc')).toEqual([['arc', 9, 9, 6, 0, Math.PI * 2]]);
    expect(spr.of('stroke')[0]![1]).toBe(P.blip);
    const gh = recordingCtx();
    paintGhostSprite(gh, 2, P.enemy);
    expect(gh.of('rect')).toEqual([['rect', 2, 2, 12, 12]]);
    expect(gh.of('stroke')[0]![1]).toBe(P.enemy);
  });

  test('device pixel ratio scales the squares', () => {
    const ctx = recordingCtx();
    drawUnits(ctx, units([[10, 10, 0, MINIMAP_KIND_UNIT]]), 1, 2, P);
    expect(ctx.of('rect')[1]).toEqual(['rect', 6, 6, 8, 8]);
  });
});

describe('spots, pings, camera', () => {
  test('free spots filled diamonds, taken hollow; hydro in its own colour', () => {
    const ctx = recordingCtx();
    drawSpots(
      ctx,
      [
        { x: 10, z: 10, kind: 'mass', taken: false },
        { x: 20, z: 10, kind: 'mass', taken: true },
        { x: 30, z: 10, kind: 'hydro', taken: false },
      ],
      1,
      1,
      P,
    );
    expect(ctx.of('fill')).toEqual([
      ['fill', P.mass],
      ['fill', P.hydro],
    ]);
    expect(ctx.of('stroke').map((s) => s[1])).toEqual([P.mass]);
    expect(ctx.of('moveTo')[0]).toEqual(['moveTo', 10, 8]);
  });

  test('pings: two ember rings, fading with age, gone after the lifetime', () => {
    const ctx = recordingCtx();
    drawPings(
      ctx,
      [
        { x: 50, z: 50, bornS: 100, level: 'crit' },
        { x: 80, z: 80, bornS: 100 - MINIMAP_PING_LIFE_S, level: 'warn' },
      ],
      100,
      1,
      1,
      P,
    );
    const strokes = ctx.of('stroke');
    expect(strokes).toHaveLength(2);
    expect(strokes.every((s) => s[1] === P.ping)).toBe(true);
    expect(strokes[0]![3]).toBeCloseTo(0.95);
    expect(strokes[1]![3]).toBeCloseTo(0.45);
    const aged = recordingCtx();
    drawPings(aged, [{ x: 50, z: 50, bornS: 100, level: 'crit' }], 104, 1, 1, P);
    expect(aged.of('stroke')[0]![3]).toBeLessThan(0.95);
  });

  test('camera: the trapezoid as one closed path of 4 corners, on a cleared overlay', () => {
    const ctx = recordingCtx();
    drawCameraLayer(ctx, [[0, 0], [100, 0], [80, 50], [20, 50]], 200, 400, 1, P);
    expect(ctx.of('clearRect')).toEqual([['clearRect', 0, 0, 200, 200]]);
    expect(ctx.of('moveTo')).toEqual([['moveTo', 0, 0]]);
    expect(ctx.of('lineTo')).toEqual([
      ['lineTo', 50, 0],
      ['lineTo', 40, 25],
      ['lineTo', 10, 25],
    ]);
    expect(ctx.of('closePath')).toHaveLength(1);
    expect(ctx.of('stroke')).toHaveLength(1);
  });

  test('dynamic layer: cleared, spots only when shown, never text or pixel reads; fog on its own layer', () => {
    const ctx = recordingCtx();
    const frame = { size: 200, dpr: 1, mapSizeWu: 512, spots: [{ x: 1, z: 1, kind: 'mass' as const, taken: false }], showResources: false, units: units([]), pings: [], nowS: 0, palette: P };
    drawDynamicLayer(ctx, frame);
    expect(ctx.calls[0]).toEqual(['clearRect', 0, 0, 200, 200]);
    expect(ctx.of('drawImage')).toHaveLength(0);
    expect(ctx.of('fill')).toHaveLength(0);
    drawDynamicLayer(ctx, { ...frame, showResources: true });
    expect(ctx.of('fill')).toHaveLength(1);
    const names = new Set(ctx.calls.map((c) => c[0]));
    for (const forbidden of ['getImageData', 'fillText', 'strokeText', 'measureText']) expect(names.has(forbidden)).toBe(false);
    const fogCtx = recordingCtx();
    const fog = {} as CanvasImageSource;
    drawFogLayer(fogCtx, fog, 200);
    expect(fogCtx.calls).toEqual([
      ['clearRect', 0, 0, 200, 200],
      ['set', 'imageSmoothingEnabled', true],
      ['drawImage', fog, 0, 0, 200, 200],
    ]);
  });
});

describe('terrain, fog, palette, coordinates', () => {
  test('terrain mode copies the colours; tactical flattens water + three land bands', () => {
    const rgba = new Uint8ClampedArray([20, 40, 60, 255, 60, 60, 50, 255, 90, 90, 80, 255, 150, 140, 130, 255]);
    const t = { width: 4, height: 1, rgba };
    const out = new Uint8ClampedArray(16);
    buildTerrainPixels(t, 'terrain', out);
    expect([...out]).toEqual([...rgba]);
    buildTerrainPixels(t, 'tactical', out);
    expect([...out.subarray(0, 4)]).toEqual([22, 34, 42, 255]);
    expect([...out.subarray(4, 8)]).toEqual([46, 43, 41, 255]);
    expect([...out.subarray(8, 12)]).toEqual([59, 54, 50, 255]);
    expect([...out.subarray(12, 16)]).toEqual([78, 71, 65, 255]);
  });

  test('fog: never seen dark, explored dimmed, visible clear', () => {
    const out = new Uint8ClampedArray(12);
    buildFogPixels({ res: 1, cells: new Uint8Array([0]) }, out);
    expect([...out.subarray(0, 4)]).toEqual([...FOG_RGBA[0]!]);
    const three = new Uint8ClampedArray(16);
    buildFogPixels({ res: 2, cells: new Uint8Array([0, 1, 2, 2]) }, three);
    expect(three[3]).toBeGreaterThan(three[7]!);
    expect(three[11]).toBe(0);
  });

  test('palette from CSS tokens, defaults when unreadable', () => {
    const p = readMinimapPalette((token) => (token === MINIMAP_PALETTE_TOKENS.self ? ' #0072b2 ' : token === MINIMAP_PALETTE_TOKENS.enemy ? '#d7263d' : ''));
    expect(p.self).toBe('#0072b2');
    expect(p.enemy).toBe('#d7263d');
    expect(p.mass).toBe(DEFAULT_MINIMAP_PALETTE.mass);
  });

  test('pointer → world and back; outside the canvas → null', () => {
    const rect = { left: 100, top: 50, width: 200, height: 200 };
    expect(minimapToWorld(100, 50, rect, 512)).toEqual({ x: 0, z: 0 });
    expect(minimapToWorld(200, 150, rect, 512)).toEqual({ x: 256, z: 256 });
    expect(minimapToWorld(300, 250, rect, 512)).toEqual({ x: 512, z: 512 });
    expect(minimapToWorld(99, 60, rect, 512)).toBeNull();
    expect(minimapToWorld(150, 60, { ...rect, width: 0 }, 512)).toBeNull();
    const p = worldToMinimap(256, 128, 372, 512);
    expect(p).toEqual({ px: 186, py: 93 });
  });
});
