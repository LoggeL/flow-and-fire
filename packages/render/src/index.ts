// Public API of @faf/render (PLAN §3.7, MS1).
export * from './rhi/types.ts';
export { createWebGL2Device, validateStreams } from './webgl2/device.ts';
export type { DeviceCanvas, WebGL2Device, WebGL2DeviceOptions } from './webgl2/device.ts';
export { ContextLossRegistry } from './webgl2/registry.ts';
export type { ContextEventTarget, RegisteredResource, RegistryHooks } from './webgl2/registry.ts';
export { std140Layout, Std140Writer } from './std140.ts';
export type { Std140Field, Std140FieldLayout, Std140Layout, Std140Type } from './std140.ts';
export { RtsCamera, RAW_PER_WU, createRay, intersectGround } from './camera.ts';
export type { CameraOptions, Ray } from './camera.ts';
export {
  UNIT_INSTANCE_STRIDE,
  UNIT_INSTANCE_OFF_PREV_POS,
  UNIT_INSTANCE_OFF_CUR_POS,
  UNIT_INSTANCE_OFF_PREV_YAW,
  UNIT_INSTANCE_OFF_CUR_YAW,
  UNIT_INSTANCE_OFF_VISUAL,
  UNIT_INSTANCE_OFF_ARMY,
  UNIT_INSTANCE_OFF_HP,
  UNIT_INSTANCE_OFF_BUILD,
  UNIT_INSTANCE_OFF_BANK,
  UNIT_INSTANCE_OFF_FLAGS,
  UNIT_INSTANCE_OFF_HANDLE,
  UNIT_INSTANCE_OFF_PART_BASE,
  UNIT_INSTANCE_OFF_PART_COUNT,
  UNIT_INSTANCE_OFF_RESERVED,
  UNIT_FLAG_NO_INTERP,
  UnitRecordWriter,
  VisualBuckets,
} from './instance-layout.ts';
export type { UnitRecordInit } from './instance-layout.ts';
export { createPlaceholderMesh, CYL_SEGMENTS } from './mesh/placeholder.ts';
export type { MeshData, PlaceholderHull, PlaceholderSpec } from './mesh/placeholder.ts';
export { UnitPass, mergeMeshes, MESH_VERTEX_STRIDE, HIGHLIGHT_STRIDE, UNIT_ATTR } from './passes/units.ts';
export { GroundPass } from './passes/ground.ts';
export type { GroundOptions } from './passes/ground.ts';
export { OverlayPass, MARKER_STRIDE, SEGMENT_STRIDE } from './passes/overlay.ts';
export type { OverlayMarker, OverlaySegment, Overlays } from './passes/overlay.ts';
export { DEFAULT_ARMY_COLORS, MAX_ARMY_COLORS, MAX_VISUALS, FRAME_LAYOUT, PALETTE_LAYOUT, rgbHex } from './passes/shared.ts';
export { createRenderer, FIXED_PASS_DRAWS } from './renderer.ts';
export type {
  Renderer,
  RendererCanvas,
  RendererOptions,
  RenderStats,
  RenderUnits,
  RenderView,
  VisualEntry,
  VisualTable,
} from './renderer.ts';
