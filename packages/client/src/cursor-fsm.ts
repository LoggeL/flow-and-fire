/**
 * Cursor state machine (G16, MS2): which pointer interaction owns the cursor.
 *
 *   idle ──left press + drag ≥ threshold──▶ boxSelect ──left release──▶ idle
 *   idle ──middle press──▶ grabPan ──middle release──▶ idle
 *   idle ──Ctrl + middle press──▶ rotate ──middle release──▶ idle
 *   idle ──pointer in the edge band (focused window)──▶ edgePan / confinedEdgePan (pointer lock)
 *   edgePan/confinedEdgePan ──pointer leaves the band / blur──▶ idle
 *   any ──cancel (blur, pointercancel, focus into a text field)──▶ idle
 *
 * Button-driven states (boxSelect, grabPan, rotate) take precedence over edge panning; a press
 * while edge-panning leaves the edge state. A left press without drag stays `idle` and yields a
 * click on release. Pure data, no DOM: the InputController feeds it and reads `state`.
 */

export type CursorState = 'idle' | 'boxSelect' | 'grabPan' | 'rotate' | 'edgePan' | 'confinedEdgePan';

/** Result of an FSM step that the input layer turns into actions. */
export type CursorEvent = 'none' | 'boxStart' | 'boxEnd' | 'click' | 'grabStart' | 'grabEnd' | 'rotateStart' | 'rotateEnd';

export class CursorFsm {
  state: CursorState = 'idle';
  /** Edge direction while edge panning (x right, y forward/up), else 0. */
  edgeX = 0;
  edgeY = 0;
  /** Left button pressed (click or box pending). */
  leftPressed = false;
  readonly dragThresholdPx: number;
  /** Transitions so far (tests/diagnostics). */
  transitions = 0;
  private startX = 0;
  private startY = 0;

  constructor(dragThresholdPx = 4) {
    this.dragThresholdPx = dragThresholdPx;
  }

  /** True while a button-driven interaction owns the cursor. */
  get busy(): boolean {
    return this.state === 'boxSelect' || this.state === 'grabPan' || this.state === 'rotate' || this.leftPressed;
  }

  leftDown(x: number, y: number): CursorEvent {
    if (this.state === 'grabPan' || this.state === 'rotate') return 'none';
    this.leftPressed = true;
    this.startX = x;
    this.startY = y;
    this.set('idle');
    return 'none';
  }

  /** Pointer moved to (x, y); starts the box once the threshold is crossed. */
  move(x: number, y: number): CursorEvent {
    if (this.leftPressed && this.state === 'idle') {
      if (Math.hypot(x - this.startX, y - this.startY) >= this.dragThresholdPx) {
        this.set('boxSelect');
        return 'boxStart';
      }
    }
    return 'none';
  }

  leftUp(): CursorEvent {
    if (!this.leftPressed) return 'none';
    this.leftPressed = false;
    if (this.state === 'boxSelect') {
      this.set('idle');
      return 'boxEnd';
    }
    return 'click';
  }

  middleDown(ctrl: boolean): CursorEvent {
    if (this.state === 'boxSelect' || this.leftPressed) return 'none';
    if (ctrl) {
      this.set('rotate');
      return 'rotateStart';
    }
    this.set('grabPan');
    return 'grabStart';
  }

  middleUp(): CursorEvent {
    if (this.state === 'grabPan') {
      this.set('idle');
      return 'grabEnd';
    }
    if (this.state === 'rotate') {
      this.set('idle');
      return 'rotateEnd';
    }
    return 'none';
  }

  /**
   * Edge scan result of this frame: direction (0 = not at an edge), whether the pointer is
   * confined (pointer lock) and whether edge panning is allowed (window focused, pointer inside or
   * captured, no text field focused).
   */
  edge(dirX: number, dirY: number, confined: boolean, allowed: boolean): void {
    if (this.busy) {
      this.edgeX = 0;
      this.edgeY = 0;
      return;
    }
    if (allowed && (dirX !== 0 || dirY !== 0)) {
      this.edgeX = dirX;
      this.edgeY = dirY;
      this.set(confined ? 'confinedEdgePan' : 'edgePan');
    } else {
      this.edgeX = 0;
      this.edgeY = 0;
      if (this.state === 'edgePan' || this.state === 'confinedEdgePan') this.set('idle');
    }
  }

  /** Aborts everything (blur, pointercancel, text focus). Returns the event to finish. */
  cancel(): CursorEvent {
    const s = this.state;
    this.leftPressed = false;
    this.edgeX = 0;
    this.edgeY = 0;
    this.set('idle');
    return s === 'boxSelect' ? 'boxEnd' : s === 'grabPan' ? 'grabEnd' : s === 'rotate' ? 'rotateEnd' : 'none';
  }

  private set(s: CursorState): void {
    if (s !== this.state) {
      this.state = s;
      this.transitions++;
    }
  }
}

/** Edge-pan cursors by direction, index (edgeY + 1) · 3 + (edgeX + 1) (no string building per frame). */
const EDGE_CURSORS = ['sw-resize', 's-resize', 'se-resize', 'w-resize', 'default', 'e-resize', 'nw-resize', 'n-resize', 'ne-resize'];

/** CSS cursor for a state (DOM cursor; the virtual cursor mirrors it as a class). */
export function cursorCss(state: CursorState, edgeX: number, edgeY: number): string {
  switch (state) {
    case 'boxSelect':
      return 'crosshair';
    case 'grabPan':
      return 'grabbing';
    case 'rotate':
      return 'move';
    case 'edgePan':
    case 'confinedEdgePan':
      return EDGE_CURSORS[(Math.sign(edgeY) + 1) * 3 + Math.sign(edgeX) + 1]!;
    default:
      return 'default';
  }
}
