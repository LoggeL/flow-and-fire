import type { Renderer } from '@faf/render';
import { describe, expect, it } from 'vitest';
import type { ClientCanvas, RafLike, RendererLike } from '../src/client.ts';
import type { AssetWorkerLike } from '../src/assets/manager.ts';
import type { FullscreenDocument, FullscreenRoot, LockableCanvas } from '../src/fullscreen.ts';
import type { InputEventTarget } from '../src/input.ts';

// Compile-time checks (tsc -p tsconfig.tests.json): the real browser/render types plug into the
// client's structural interfaces without casts.
type Assignable<T, U extends T> = U;
export type RendererFits = Assignable<RendererLike, Renderer>;
export type CanvasFits = Assignable<ClientCanvas, HTMLCanvasElement>;
export type WindowFits = Assignable<InputEventTarget, Window>;
export type DocumentFits = Assignable<InputEventTarget, Document>;
// MS2: fullscreen / pointer lock / asset worker.
export type RootFits = Assignable<FullscreenRoot, HTMLElement>;
export type FsDocumentFits = Assignable<FullscreenDocument, Document>;
export type LockCanvasFits = Assignable<LockableCanvas, HTMLCanvasElement>;
export type WorkerFits = Assignable<AssetWorkerLike, Worker>;

describe('structural interfaces', () => {
  it('rAF functions fit RafLike', () => {
    const raf: RafLike = {
      request: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number,
      cancel: (id: number) => clearTimeout(id),
    };
    expect(typeof raf.request).toBe('function');
  });
});
