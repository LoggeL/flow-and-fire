/**
 * Types of the tool state machines (DOM-free). The controller turns DOM pointer events into
 * `PointerInput`s and hands every tool a `ToolContext`: the store, the injected picking/camera
 * environment and setters for the controller-owned signals (draft, hover). All map coordinates are
 * Fx raw; client coordinates are CSS pixels.
 */
import type { MapPoint } from '@faf/formats';
import type { EditorStore } from '../store.ts';
import type { MarkerRef, ToolId } from '../../model/types.ts';
import type { DraftField } from '../../overlay/types.ts';

/** One pointer event of the primary (left) button, or a hover move. */
export interface PointerInput {
  /** Client position (CSS px). */
  readonly x: number;
  readonly y: number;
  readonly shift: boolean;
  /** Ctrl or Cmd. */
  readonly mod: boolean;
}

/** Picking, hit-testing and camera access (TerrainView/TerrainPicker in the app, fakes in tests). */
export interface ToolEnv {
  /** Terrain point (Fx raw) under a client pixel, null off the map. */
  pick(x: number, y: number): MapPoint | null;
  /**
   * Marker under a client pixel (hitTestMarkers on the current ViewMarkers). `selection` replaces
   * the selection used for the handle test (handles are only hit on selected fields).
   */
  hitTest(x: number, y: number, selection?: readonly MarkerRef[]): MarkerRef | null;
  /** Client pixel of a map point (Fx raw), null if not visible. */
  project(xRaw: number, zRaw: number): { x: number; y: number } | null;
  /** Point (WU) on the camera's ground plane under a client pixel (for panning), null if missed. */
  groundAt(x: number, y: number): { x: number; z: number } | null;
  /** Moves the camera target by (dx, dz) WU in world axes. */
  panBy(dxWu: number, dzWu: number): void;
}

export interface ToolContext {
  readonly store: EditorStore;
  readonly env: ToolEnv;
  setDraft(d: DraftField | null): void;
  setHover(r: MarkerRef | null): void;
}

export interface Tool {
  readonly id: ToolId;
  /** Left button pressed; false = not handled (the controller then does not capture the pointer). */
  down(p: PointerInput, ctx: ToolContext): boolean;
  /** Pointer moved (pressed or not). */
  move(p: PointerInput, ctx: ToolContext): void;
  /** Left button released. */
  up(p: PointerInput, ctx: ToolContext): void;
  /** Double click (after the two down/up pairs). */
  doubleClick(p: PointerInput, ctx: ToolContext): void;
  /** Escape: aborts the current action; false if there was nothing to abort. */
  cancel(ctx: ToolContext): boolean;
  /** Enter: finishes the current action; false if there was nothing to finish. */
  confirm(ctx: ToolContext): boolean;
  /** Backspace/Delete: tool-local undo (polygon point); false if not applicable. */
  backspace(ctx: ToolContext): boolean;
  /** Tool is left (tool switch, document change): drop drafts and end drags without undo. */
  reset(ctx: ToolContext): void;
  /** True while a button is held. */
  readonly pressed: boolean;
  /** CSS cursor for the canvas. */
  cursor(ctx: ToolContext): string;
}

/** Movement (CSS px) after which a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;
/** Pick radius (CSS px) of polygon edges for vertex insertion. */
export const EDGE_PICK_PX = 8;
/** Clicking within this distance (CSS px) of the first polygon point closes the polygon. */
export const CLOSE_POLYGON_PX = 8;
