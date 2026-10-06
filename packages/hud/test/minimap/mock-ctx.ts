/** Recording 2D-context mock for the minimap drawing tests (happy-dom has no canvas). */
import type { PixelCtx2D } from '../../src/hud/minimap/draw.ts';
import type { Bitmap } from '../../src/hud/minimap/renderer.ts';

export type Call = readonly [string, ...unknown[]];

export interface RecordingCtx extends PixelCtx2D {
  readonly calls: Call[];
  /** Calls of one method. */
  of(name: string): Call[];
  clear(): void;
}

const PROPS = ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'imageSmoothingEnabled'] as const;

export function recordingCtx(): RecordingCtx {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, imageSmoothingEnabled: true };
  const rec =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push([name, ...args]);
    };
  const ctx = {
    calls,
    of: (name: string) => calls.filter((c) => c[0] === name),
    clear: () => {
      calls.length = 0;
    },
    clearRect: rec('clearRect'),
    fillRect: rec('fillRect'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    rect: rec('rect'),
    arc: rec('arc'),
    fill: () => calls.push(['fill', state['fillStyle']]),
    stroke: () => calls.push(['stroke', state['strokeStyle'], state['lineWidth'], state['globalAlpha']]),
    drawImage: rec('drawImage'),
    createImageData: (w: number, h: number) => {
      calls.push(['createImageData', w, h]);
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: 'srgb' } as unknown as ImageData;
    },
    putImageData: (img: ImageData, x: number, y: number) => calls.push(['putImageData', img, x, y]),
  } as unknown as RecordingCtx;
  for (const p of PROPS) {
    Object.defineProperty(ctx, p, {
      get: () => state[p],
      set: (v: unknown) => {
        state[p] = v;
        calls.push(['set', p, v]);
      },
      enumerable: true,
    });
  }
  return ctx;
}

/** Offscreen bitmap factory with recording contexts. */
export function recordingBitmaps(): { readonly create: (w: number, h: number) => Bitmap; readonly made: { w: number; h: number; ctx: RecordingCtx }[] } {
  const made: { w: number; h: number; ctx: RecordingCtx }[] = [];
  return {
    made,
    create: (w, h) => {
      const ctx = recordingCtx();
      made.push({ w, h, ctx });
      return { image: { width: w, height: h } as unknown as Bitmap['image'], ctx };
    },
  };
}
