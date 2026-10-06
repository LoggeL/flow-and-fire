// Public API of @faf/client (MS1 main-thread game logic + MS2 map, camera, input, assets +
// MS3 selection, control groups, order feedback, strategic zoom; PLAN §3.2/§3.6/§3.7).
export type { SimLink } from './sim-link.ts';
export {
  CameraController,
  DEFAULT_PITCH_CURVE,
  MAX_PITCH_OFFSET,
  MIN_EYE_CLEARANCE_WU,
  MIN_ZOOM_DISTANCE_WU,
  OVERVIEW_DRIFT_START,
  maxDistanceForMap,
} from './camera-controller.ts';
export type { CameraControllerOptions, CameraState, PitchCurve } from './camera-controller.ts';
export { InputController, isTextInputElement } from './input.ts';
export type { Action, ActionType, DragBox, InputEventTarget, InputOptions, InputSurface } from './input.ts';
export {
  ActionMap,
  CONTROL_GROUP_ACTIONS,
  DEFAULT_ACTION_MAP,
  DIGIT_CODES,
  KEY_ACTIONS,
  PAN_ACTIONS,
  bindingMatches,
  bindingNeedsModifier,
  formatBinding,
} from './actions.ts';
export type { ActionTable, KeyAction, KeyBinding, KeyChord } from './actions.ts';
export { CursorFsm, cursorCss } from './cursor-fsm.ts';
export type { CursorEvent, CursorState } from './cursor-fsm.ts';
export { FullscreenController, PointerConfinement, VIRTUAL_CURSOR_ID } from './fullscreen.ts';
export type {
  FullscreenDocument,
  FullscreenRoot,
  LockableCanvas,
  PointerConfinementOptions,
  VirtualCursorElement,
} from './fullscreen.ts';
export { TEST_PLANE_SIZE_WU, clampRaw, mapBoundsWU, wuToRaw } from './picking.ts';
export type { MapBounds } from './picking.ts';
export { ClientMap, HYDRO_SPOT_DECAL, MAP_CHUNK_WU, MASS_SPOT_DECAL } from './map.ts';
export type { TerrainHeightSource } from './map.ts';
export { TerrainPicker, PICK_BISECT_WU, PICK_MAX_STEP_WU } from './terrain-picker.ts';
export type { PickableTerrain } from './terrain-picker.ts';
export { ICON_HIT_FADE, ScreenProjection, Selection, interpolatedPos, isOwnUnit } from './selection.ts';
export { HandleIndex } from './handle-index.ts';
export { CONTROL_GROUP_COUNT, ControlGroups, DOUBLE_TAP_MS, controlGroupOfCode } from './control-groups.ts';
export type { ControlGroupOp } from './control-groups.ts';
export {
  CommandTargets,
  MAX_COMMAND_TARGETS,
  MAX_ROUTE_SEGMENTS,
  OrderFeedback,
  QUEUED_COLOR,
  ROUTE_COLOR,
  STOP_COLOR,
} from './order-feedback.ts';
export type { HeightSource } from './order-feedback.ts';
export { CommandBuilder, MAX_PENDING_COMMANDS, seqAcked } from './commands.ts';
export { NAV_LAND_MAX_SLOPE_RAW_REPLICA, landCellBlocked } from './map.ts';
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
  KeyboardLockLike,
  RafLike,
  RendererLike,
  ScreenPos,
  WorldPick,
} from './client.ts';
export { COMMAND_CATEGORY, VisualGeometry, armyColorHex, commanderVisuals, visualTableFromView } from './visuals.ts';
export type { ModelLookup } from './visuals.ts';

// Assets (P3): manager on the main thread, loader shared with the worker ('@faf/client/asset-worker').
export { AssetManager, rawAssetsRequested } from './assets/manager.ts';
export type { AssetManagerOptions, AssetProgress, AssetWorkerLike, LoadedAssets, LoadedFile, LoadedModel } from './assets/manager.ts';
export { ASSET_CACHE_NAME, AssetIntegrityError, base64, defaultLoadOrder, loadAssets, resolveAssetUrl } from './assets/loader.ts';
export type { AssetCache, AssetEnv } from './assets/loader.ts';
export { createAssetEnv } from './assets/env.ts';
export type { AssetGlobals } from './assets/env.ts';
export { GlbError, parseGlb } from './assets/glb.ts';
export type { MeshoptDecoderLike, ModelPartInfo, ParsedModel } from './assets/glb.ts';
export type { AssetLoadRequest, AssetLoadStats, AssetSource, AssetWorkerMessage } from './assets/messages.ts';

// Renderer facade for apps (PLAN §3.2: apps depend on client only; client owns the render dependency).
export {
  backbufferSize,
  createRenderer,
  iconGlyphIndex,
  iconScreenRect,
  iconFade,
  strategicZoom,
  unitIconFade,
  parsePresetName,
  RtsCamera,
  RAW_PER_WU,
  RENDER_PRESET_NAMES,
  RENDER_PRESETS,
  ICON_SIZE_PX,
} from '@faf/render';
export type {
  IconAtlasMetrics,
  StrategicZoom,
  MeshData,
  RenderPresetName,
  Renderer,
  RendererOptions,
  RenderStats,
  TerrainDesc,
  VisualEntry,
  VisualTable,
} from '@faf/render';
