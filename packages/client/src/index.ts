// Public API of @faf/client (MS1: main-thread game logic, PLAN §3.2/§3.6/§3.7).
export type { SimLink } from './sim-link.ts';
export { CameraController } from './camera-controller.ts';
export type { CameraControllerOptions, CameraState } from './camera-controller.ts';
export { InputController, isTextInputElement } from './input.ts';
export type { Action, ActionType, DragBox, InputEventTarget, InputOptions, InputSurface } from './input.ts';
export { GroundPicker, TEST_PLANE_SIZE_WU, clampRaw, mapBoundsWU, wuToRaw } from './picking.ts';
export type { MapBounds } from './picking.ts';
export { Selection, interpolatedPos, isOwnUnit } from './selection.ts';
export type { SelectionMode } from './selection.ts';
export { CommandBuilder, MAX_PENDING_COMMANDS, seqAcked } from './commands.ts';
export type { AckListener, CommandSink } from './commands.ts';
export { BASE_TICK_MS, FrameStream } from './frames.ts';
export type { FrameStreamOptions } from './frames.ts';
export {
  ClientMetrics,
  MAX_MEASUREMENTS,
  MEASUREMENT_TIMEOUT_MS,
  MOVED_PX,
  RingStats,
  SAMPLE_UNITS,
  interpolatedYaw,
} from './metrics.ts';
export type { MetricsSnapshot, MetricsSources, StatSummary } from './metrics.ts';
export { GameClient, visualCornerRadii } from './client.ts';
export type {
  ClientCanvas,
  GameClientCallbacks,
  GameClientOptions,
  RafLike,
  RendererLike,
  ScreenPos,
} from './client.ts';

// Renderer facade for apps (PLAN §3.2: apps depend on client only; client owns the render dependency).
export { createRenderer, RtsCamera, RAW_PER_WU } from '@faf/render';
export type { Renderer, RendererOptions, RenderStats, VisualEntry, VisualTable } from '@faf/render';
