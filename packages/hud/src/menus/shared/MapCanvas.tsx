/**
 * Canvas pieces shared by the menus: the dimmed terrain background of every menu page, the small map
 * thumbnails of the lobby list and the large map preview with resource points and numbered start markers
 * (lobby, loading screen). Terrain is drawn once per spec (ui.md §9.2: canvas work only on change).
 */
import type { ComponentChildren, JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { MapPreviewSpec, SkirmishResource } from '../../model/menus/skirmish.ts';
import { cx } from '../../ui/cx.ts';
import { drawTerrain, heightField, previewField } from './terrain.ts';

/** Resource point colours (tokens --mass and a hydro blue, as in the mockup canvas). */
const MASS_FILL = '#7fd1b2';
const HYDRO_FILL = '#8fd0e8';
const SPOT_STROKE = '#0b0a09';

export interface MenuBackgroundProps {
  readonly seed: number;
  /** Map window [x0, y0, x1] (height follows the aspect ratio), like FF.menuBg. */
  readonly view?: readonly [number, number, number, number];
}

/** Background terrain of the menu pages (drawn at one third of the page size, then scaled). */
export function MenuBackground({ seed, view = [0.18, 0.2, 0.82, 0.56] }: MenuBackgroundProps): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    const host = c?.parentElement;
    if (!c || !host) return;
    // Measured once on mount (never in an update path).
    const w = Math.round(host.clientWidth / 3);
    const h = Math.round(host.clientHeight / 3);
    if (w <= 0 || h <= 0) return;
    c.width = w;
    c.height = h;
    const vw = view[2] - view[0];
    const vh = vw * (h / w);
    drawTerrain(c, heightField(seed, { mirror: true, plateau: true, freq: 2.6 }), {
      view: [view[0], view[1], view[0] + vw, view[1] + vh],
      tint: 0.8,
      detail: 3,
    });
  }, [seed, view[0], view[1], view[2], view[3]]);
  return (
    <div class="menu-bg" aria-hidden="true" data-testid="menu-bg">
      <canvas ref={ref} width={0} height={0} />
    </div>
  );
}

function drawSpots(canvas: HTMLCanvasElement, spots: readonly SkirmishResource[]): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const w = canvas.width;
  const s = Math.max(2.5, w / 160);
  for (const p of spots) {
    g.save();
    g.translate(p.x * w, p.y * canvas.height);
    g.rotate(Math.PI / 4);
    g.fillStyle = p.kind === 'hydro' ? HYDRO_FILL : MASS_FILL;
    g.strokeStyle = SPOT_STROKE;
    g.lineWidth = 1.5;
    g.fillRect(-s, -s, s * 2, s * 2);
    g.strokeRect(-s, -s, s * 2, s * 2);
    g.restore();
  }
}

export interface MapThumbProps {
  readonly spec: MapPreviewSpec;
  /** Canvas pixels (square). */
  readonly size?: number;
}

/** Small map thumbnail (lobby list). */
export function MapThumb({ spec, size = 56 }: MapThumbProps): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (ref.current) drawTerrain(ref.current, previewField(spec));
  }, [spec.seed, spec.water, size]);
  return <canvas ref={ref} width={size} height={size} aria-hidden="true" />;
}

export interface StartMarker {
  /** Start index (0-based; shown 1-based). */
  readonly index: number;
  readonly x: number;
  readonly y: number;
  /** CSS colour of the house holding it, null = free. */
  readonly color: string | null;
  /** Accessible name / tooltip (translated). */
  readonly label: string;
}

export interface MapPreviewProps {
  readonly spec: MapPreviewSpec | null;
  readonly resources: readonly SkirmishResource[];
  readonly markers: readonly StartMarker[];
  /** Click on a marker (lobby: swap start). Without it the markers are static. */
  readonly onPick?: ((index: number) => void) | undefined;
  /** Accessible name of the preview (translated). */
  readonly label: string;
  /** Canvas pixels (square). */
  readonly size?: number;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
  readonly children?: ComponentChildren;
}

/** Large preview: terrain + resource diamonds on a canvas, start markers as buttons above it. */
export function MapPreview(props: MapPreviewProps): JSX.Element {
  const { spec, resources, markers, onPick, size = 560 } = props;
  const ref = useRef<HTMLCanvasElement>(null);
  const spotsKey = resources.map((r) => `${r.kind[0]}${r.x.toFixed(3)},${r.y.toFixed(3)}`).join(';');
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c || !spec) return;
    if (drawTerrain(c, previewField(spec), { detail: 3 })) drawSpots(c, resources);
  }, [spec?.seed, spec?.water, spotsKey, size]);
  return (
    <div
      class={cx('preview__map', props.class)}
      role="group"
      aria-label={props.label}
      data-component="MapPreview"
      data-testid={props.testId ?? 'map-preview'}
    >
      <canvas ref={ref} width={size} height={size} aria-hidden="true" />
      {markers.map((m) => (
        <button
          key={m.index}
          type="button"
          class={cx('pmark', m.color === null && 'is-free')}
          style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, ...(m.color !== null ? { '--team': m.color } : {}) }}
          title={m.label}
          aria-label={m.label}
          disabled={onPick === undefined}
          onClick={onPick ? () => onPick(m.index) : undefined}
          data-testid={`start-${m.index + 1}`}
          data-start={m.index}
          data-taken={m.color !== null ? '' : undefined}
        >
          {m.index + 1}
        </button>
      ))}
      {props.children}
    </div>
  );
}
