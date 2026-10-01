import type { CursorState } from '@faf/client';
import './cursors.css';

export type GameCursor = 'arrow' | 'select' | 'move' | 'attack' | 'patrol' | 'assist' | 'repair' | 'reclaim' | 'build' | 'blocked' | 'pan' | 'rotate' | 'box'
  | 'north' | 'south' | 'east' | 'west' | 'northEast' | 'northWest' | 'southEast' | 'southWest';
interface CursorArt { readonly image: string; readonly css: string; readonly x: number; readonly y: number }
function art(shape: string, color = '#8bd7ee', x = 16, y = 16): CursorArt {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g fill="none" stroke="#071018" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round">${shape}</g><g fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${shape}</g></svg>`;
  const image = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return { image, css: `${image} ${x} ${y}, default`, x, y };
}
const arrow = '<path d="M4 3 24 16 15 18 11 27Z" fill="#8bd7ee"/>';
const cross = '<path d="M16 3v6m0 14v6M3 16h6m14 0h6"/><circle cx="16" cy="16" r="7"/>';
const wrench = '<path d="m7 26 12-12a7 7 0 0 0 8-9l-5 5-4-4 5-5a7 7 0 0 0-9 8L2 21Z"/>';
const direction = (degrees: number): string => `<g transform="rotate(${degrees} 16 16)"><path d="M16 4 7 14h6v13h6V14h6Z" fill="#8bd7ee"/></g>`;
export const CURSOR_ART: Readonly<Record<GameCursor, CursorArt>> = {
  arrow: art(arrow, '#8bd7ee', 4, 3),
  select: art(`${arrow}<path d="M22 22v8m-4-4h8"/>`, '#c2f3ff', 4, 3),
  move: art('<path d="M16 4v24M4 16h24M16 4l-4 5m4-5 4 5M16 28l-4-5m4 5 4-5M4 16l5-4m-5 4 5 4M28 16l-5-4m5 4-5 4"/>', '#8adea8'),
  attack: art(cross, '#ff756f'),
  patrol: art('<path d="M25 12a10 10 0 0 0-18-2l-3 4m0-7v7h7M7 20a10 10 0 0 0 18 2l3-4m0 7v-7h-7"/>'),
  assist: art(`${wrench}<path d="M25 22v8m-4-4h8"/>`),
  repair: art(`${wrench}<path d="M25 22v8m-4-4h8"/>`, '#8adea8'),
  reclaim: art('<path d="m13 4 3 5 3-5m-3 5a9 9 0 0 1 8 14m4-1-5 1 1-5M23 23a9 9 0 0 1-15-2m-1 5 1-5 5 1M8 21a9 9 0 0 1 8-12"/>', '#edcd83'),
  build: art('<path d="m6 12 10-6 10 6v12l-10 6-10-6Zm0 0 10 6 10-6M16 18v12M3 3h8M7 0v7"/>', '#a8e49f', 7, 3),
  blocked: art('<circle cx="16" cy="16" r="11"/><path d="m8 8 16 16"/>', '#ff756f'),
  pan: art('<path d="M10 16V8a2 2 0 0 1 4 0v8V5a2 2 0 0 1 4 0v11V8a2 2 0 0 1 4 0v8v-4a2 2 0 0 1 4 0v10l-4 7H12L5 19a2 2 0 0 1 3-3l2 2"/>'),
  rotate: art('<path d="M25 12a10 10 0 0 0-18-2l-3 4m0-7v7h7M7 20a10 10 0 0 0 18 2l3-4m0 7v-7h-7"/><circle cx="16" cy="16" r="2"/>', '#edcd83'),
  box: art('<path d="M4 11V4h7m10 0h7v7m0 10v7h-7m-10 0H4v-7M12 16h8m-4-4v8"/>'),
  north: art(direction(0)), south: art(direction(180)), east: art(direction(90)), west: art(direction(270)),
  northEast: art(direction(45)), northWest: art(direction(315)), southEast: art(direction(135)), southWest: art(direction(225)),
};
const edges: readonly GameCursor[] = ['southWest', 'south', 'southEast', 'west', 'arrow', 'east', 'northWest', 'north', 'northEast'];
/** Input ownership always takes priority over an armed gameplay order. */
export function gameCursor(state: CursorState, edgeX: number, edgeY: number, contextual: GameCursor): GameCursor {
  if (state === 'boxSelect') return 'box';
  if (state === 'grabPan') return 'pan';
  if (state === 'rotate') return 'rotate';
  if (state === 'edgePan' || state === 'confinedEdgePan') return edges[(Math.sign(edgeY) + 1) * 3 + Math.sign(edgeX) + 1]!;
  return contextual;
}

/** Same art and hotspot for the native cursor and the existing fullscreen virtual cursor. */
export class WorldCursor {
  private last: GameCursor | null = null;
  private confined = false;
  private virtual: HTMLElement | null = null;
  constructor(private readonly canvas: HTMLCanvasElement | null) {}
  present(kind: GameCursor, confined: boolean): void {
    if (!this.canvas) return;
    const current = this.canvas.ownerDocument.getElementById('faf-virtual-cursor');
    const changed = kind !== this.last || confined !== this.confined;
    if (changed) {
      this.canvas.dataset['gameCursor'] = kind;
      this.canvas.style.setProperty('--faf-world-cursor', confined ? 'none' : CURSOR_ART[kind].css);
      this.last = kind; this.confined = confined;
    }
    if (current && (changed || current !== this.virtual)) {
      const cursor = CURSOR_ART[kind];
      current.dataset['gameCursor'] = kind;
      current.style.backgroundImage = cursor.image;
      current.style.marginLeft = `${-cursor.x}px`; current.style.marginTop = `${-cursor.y}px`;
      this.virtual = current;
    }
  }
  dispose(): void {
    if (!this.canvas) return;
    delete this.canvas.dataset['gameCursor']; this.canvas.style.removeProperty('--faf-world-cursor');
    if (this.virtual) {
      delete this.virtual.dataset['gameCursor']; this.virtual.style.backgroundImage = '';
      this.virtual.style.marginLeft = ''; this.virtual.style.marginTop = '';
    }
  }
}
