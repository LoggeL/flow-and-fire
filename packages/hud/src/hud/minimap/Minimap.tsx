import { effect } from '@preact/signals';
import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { t } from '../../i18n/t.ts';
import { useCommands, useHud } from '../../model/index.ts';
import { livePings, minimapKeyFigures } from '../../model/minimap.ts';
import type { MinimapMode } from '../../model/minimap.ts';
import { cx } from '../../ui/cx.ts';
import { LineIcon } from '../../ui/LineIcon.tsx';
import { Panel } from '../../ui/Panel.tsx';
import { minimapToWorld } from './draw.ts';
import type { Ctx2D } from './draw.ts';
import { MinimapRenderer } from './renderer.ts';
import type { Bitmap, MinimapRendererOptions } from './renderer.ts';

/** Backing-store size before the first ResizeObserver report (CSS px, ≈ the canvas at scale 1.0). */
export const MINIMAP_FALLBACK_PX = 186;

export interface MinimapProps {
  /** Test/gallery hooks for the canvas contexts (default: real 2D contexts). */
  readonly getContext?: ((canvas: HTMLCanvasElement) => Ctx2D | null) | undefined;
  readonly createBitmap?: ((w: number, h: number) => Bitmap) | undefined;
  /** Receives the renderer once it exists (measurements, tests). */
  readonly onRenderer?: ((renderer: MinimapRenderer) => void) | undefined;
  readonly testId?: string | undefined;
}

function nextMode(mode: MinimapMode): MinimapMode {
  return mode === 'terrain' ? 'tactical' : 'terrain';
}

function modeLabel(mode: MinimapMode): string {
  return mode === 'terrain' ? t('ui.minimap.mode.terrain') : t('ui.minimap.mode.tactical');
}

/** Head tools: terrain/tactical, resource spots, whole map (strategic zoom). Re-renders on mode changes only. */
function MinimapTools({ available }: { readonly available: boolean }): JSX.Element {
  const { minimap } = useHud();
  const commands = useCommands();
  const mode = minimap.mode.value;
  const res = minimap.showResources.value;
  const modeText = t('ui.minimap.mode.toggle', { mode: modeLabel(mode), next: modeLabel(nextMode(mode)) });
  return (
    <span class="ff-ph__end minimap__tools">
      {available ? (
        <>
          <button
            type="button"
            class={cx(mode === 'terrain' && 'is-on')}
            title={modeText}
            aria-label={modeText}
            aria-pressed={mode === 'terrain'}
            data-testid="minimap-mode"
            data-mode={mode}
            onClick={() => commands.setMinimapMode(nextMode(mode))}
          >
            <LineIcon name="layers" />
          </button>
          <button
            type="button"
            class={cx(res && 'is-on')}
            title={t('ui.minimap.resources')}
            aria-label={t('ui.minimap.resources')}
            aria-pressed={res}
            data-testid="minimap-resources"
            onClick={() => commands.toggleResources()}
          >
            <LineIcon name="mass" />
          </button>
        </>
      ) : null}
      <button
        type="button"
        title={t('ui.minimap.wholeMap')}
        aria-label={t('ui.minimap.wholeMap')}
        data-testid="minimap-whole"
        onClick={() => commands.showWholeMap()}
      >
        <LineIcon name="fullscreen" />
      </button>
    </span>
  );
}

/** Map key figures in the dock slot before MS11 (UI-E2): name, size, mex and hydro spots free/taken. */
function MinimapFacts(): JSX.Element {
  const { minimap } = useHud();
  const name = minimap.mapName.value;
  const size = minimap.mapSizeWu.value;
  const f = minimapKeyFigures(minimap.spots.value);
  return (
    <div class="minimap__facts" data-testid="minimap-facts" aria-label={t('ui.minimap.facts.region')}>
      <div class="minimap__name" data-fit="">
        {name !== '' ? name : t('ui.minimap.facts.unknownMap')}
      </div>
      <dl class="minimap__dl">
        <dt>{t('ui.minimap.facts.size')}</dt>
        <dd class="num" data-testid="minimap-facts-size">
          {t('ui.minimap.facts.sizeValue', { n: size })}
        </dd>
        <dt>{t('ui.minimap.facts.mex')}</dt>
        <dd class="num" data-testid="minimap-facts-mex">
          {t('ui.minimap.facts.pair', { free: f.massFree, taken: f.massTaken })}
        </dd>
        <dt>{t('ui.minimap.facts.hydro')}</dt>
        <dd class="num" data-testid="minimap-facts-hydro">
          {t('ui.minimap.facts.pair', { free: f.hydroFree, taken: f.hydroTaken })}
        </dd>
      </dl>
      <p class="minimap__note">{t('ui.minimap.facts.note')}</p>
    </div>
  );
}

interface CanvasProps {
  readonly options: MinimapRendererOptions;
  readonly onRenderer?: ((renderer: MinimapRenderer) => void) | undefined;
}

/**
 * The canvas layers and the imperative renderer. The component itself renders once; signals drive the
 * renderer through effects: terrain/mode → terrain layer, fog → fog layer (2 Hz), units/pings/spots →
 * dynamic layer (4 Hz, one batch = one draw), camera → overlay (rAF-bundled).
 */
function MinimapCanvas({ options, onRenderer }: CanvasProps): JSX.Element {
  const model = useHud();
  const commands = useCommands();
  const wrapRef = useRef<HTMLDivElement>(null);
  const terrainRef = useRef<HTMLCanvasElement>(null);
  const fogRef = useRef<HTMLCanvasElement>(null);
  const dynRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const terrain = terrainRef.current;
    const fog = fogRef.current;
    const dynamic = dynRef.current;
    const overlay = overlayRef.current;
    if (wrap === null || terrain === null || fog === null || dynamic === null || overlay === null) return undefined;
    const mm = model.minimap;
    const renderer = new MinimapRenderer({ terrain, fog, dynamic, overlay }, options);
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    renderer.resize(MINIMAP_FALLBACK_PX, dpr);
    onRenderer?.(renderer);

    const disposers: (() => void)[] = [];
    disposers.push(effect(() => renderer.setTerrain(mm.terrain.value, mm.mode.value)));
    disposers.push(
      effect(() => {
        renderer.setFog(mm.fog.value);
      }),
    );
    disposers.push(
      effect(() => {
        // Ping age follows the 4-Hz redraws; the 1-Hz timer alone does not trigger a redraw.
        const nowS = model.match.timeS.peek();
        renderer.drawDynamic({
          mapSizeWu: mm.mapSizeWu.value,
          spots: mm.spots.value,
          showResources: mm.showResources.value,
          units: mm.units.value,
          pings: livePings(mm.pings.value, nowS),
          nowS,
        });
      }),
    );
    disposers.push(effect(() => renderer.setCamera(mm.camera.value)));
    // Team colours: read the CSS tokens once per mode, after the root attribute changed (next frame).
    let paletteFrame = 0;
    disposers.push(
      effect(() => {
        void model.teams.value;
        const token = ++paletteFrame;
        const run = (): void => {
          if (token === paletteFrame) renderer.refreshPalette();
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
        else run();
      }),
    );

    // Backing store = CSS size of the square canvas × dpr, measured by ResizeObserver (never in the update path).
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver((entries) => {
        const e = entries[entries.length - 1];
        if (e === undefined) return;
        const box = e.contentRect;
        const css = Math.min(box.width, box.height);
        if (css > 0) renderer.resize(css, typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
      });
      ro.observe(overlay);
    }

    // Pointer: left click/drag → camera, right click → order (Shift appends), wheel → nothing (no world zoom).
    let dragId: number | null = null;
    let rect: DOMRect | null = null;
    const world = (e: PointerEvent): { x: number; z: number } | null => {
      if (rect === null) return null;
      const p = minimapToWorld(e.clientX, e.clientY, rect, mm.mapSizeWu.peek());
      return p === null ? null : { x: p.x, z: p.z };
    };
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0 && e.button !== 2) return;
      rect = overlay.getBoundingClientRect();
      const p = world(e);
      if (p === null) return;
      e.preventDefault();
      if (e.button === 2) {
        commands.minimapOrder(p.x, p.z, e.shiftKey);
        return;
      }
      dragId = e.pointerId;
      if (typeof overlay.setPointerCapture === 'function') {
        try {
          overlay.setPointerCapture(e.pointerId);
        } catch {
          // Synthetic events (tests) have no active pointer to capture.
        }
      }
      commands.setCamera(p.x, p.z);
    };
    const onMove = (e: PointerEvent): void => {
      if (dragId === null || e.pointerId !== dragId || rect === null) return;
      const fx = Math.min(Math.max(e.clientX, rect.left), rect.left + rect.width);
      const fz = Math.min(Math.max(e.clientY, rect.top), rect.top + rect.height);
      const p = minimapToWorld(fx, fz, rect, mm.mapSizeWu.peek());
      if (p !== null) commands.setCamera(p.x, p.z);
    };
    const onUp = (e: PointerEvent): void => {
      if (dragId === null || e.pointerId !== dragId) return;
      dragId = null;
      if (typeof overlay.releasePointerCapture === 'function') {
        try {
          overlay.releasePointerCapture(e.pointerId);
        } catch {
          // Capture was never taken.
        }
      }
    };
    const onContext = (e: Event): void => e.preventDefault();
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    overlay.addEventListener('pointerdown', onDown);
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointercancel', onUp);
    overlay.addEventListener('contextmenu', onContext);
    wrap.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      for (const d of disposers) d();
      paletteFrame++;
      ro?.disconnect();
      overlay.removeEventListener('pointerdown', onDown);
      overlay.removeEventListener('pointermove', onMove);
      overlay.removeEventListener('pointerup', onUp);
      overlay.removeEventListener('pointercancel', onUp);
      overlay.removeEventListener('contextmenu', onContext);
      wrap.removeEventListener('wheel', onWheel);
      renderer.dispose();
    };
  }, []);

  return (
    <div class="minimap__wrap" ref={wrapRef} data-testid="minimap-wrap">
      <canvas class="minimap__layer" ref={terrainRef} data-layer="terrain" aria-hidden="true" />
      <canvas class="minimap__layer" ref={fogRef} data-layer="fog" aria-hidden="true" />
      <canvas class="minimap__layer" ref={dynRef} data-layer="dynamic" aria-hidden="true" />
      <canvas class="minimap__layer minimap__overlay" ref={overlayRef} data-layer="overlay" data-testid="minimap-canvas" role="img" aria-label={t('ui.minimap.canvas')} />
    </div>
  );
}

/**
 * Minimap panel (ui.md §5.4, C16): 216 × 220 dock slot with head tools and the canvas layers, or the map
 * key figures while `minimap.available` is false (UI-E2, before MS11).
 */
export function Minimap(props: MinimapProps): JSX.Element {
  const { minimap } = useHud();
  const available = minimap.available.value;
  const options: MinimapRendererOptions = { getContext: props.getContext, createBitmap: props.createBitmap };
  return (
    <Panel as="section" class={cx('minimap', !available && 'is-facts')} component="Minimap" panelId="minimap" label={t('ui.minimap.region')} testId={props.testId ?? 'minimap'}>
      <div class="ff-ph" data-component="PanelHead" data-testid="minimap-head">
        <span data-fit="">{t('ui.minimap.title')}</span>
        <MinimapTools available={available} />
      </div>
      {available ? <MinimapCanvas options={options} onRenderer={props.onRenderer} /> : <MinimapFacts />}
    </Panel>
  );
}
