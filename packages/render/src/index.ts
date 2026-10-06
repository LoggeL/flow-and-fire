// Public API of @faf/render (PLAN §3.7, MS1 + MS2: terrain, water, decals, probe, presets, P2;
// MS3: strategic zoom, IconPass + MSDF atlas, HP bars, dynamic decals, placeholder turrets).
export * from './rhi/types.ts';
export { createWebGL2Device, validateStreams } from './webgl2/device.ts';
export type { DeviceCanvas, WebGL2Device, WebGL2DeviceOptions } from './webgl2/device.ts';
export { ContextLossRegistry } from './webgl2/registry.ts';
export type { ContextEventTarget, RegisteredResource, RegistryHooks } from './webgl2/registry.ts';
export { std140Layout, Std140Writer } from './std140.ts';
export type { Std140Field, Std140FieldLayout, Std140Layout, Std140Type } from './std140.ts';
export { RtsCamera, RAW_PER_WU, createRay, intersectGround, nearPlaneForHeight, NEAR_PER_HEIGHT, NEAR_MIN_WU, NEAR_MAX_WU } from './camera.ts';
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
export {
  createPlaceholderMesh,
  createPlaceholderLods,
  combineParts,
  meshBoundingRadius,
  CYL_SEGMENTS,
  CYL_LOD_SEGMENTS,
  MAX_MESH_PARTS,
} from './mesh/placeholder.ts';
export type { MeshData, MeshPart, PlaceholderHull, PlaceholderSpec, PlaceholderTurret } from './mesh/placeholder.ts';
export {
  UnitPass,
  mergeMeshes,
  MESH_VERTEX_STRIDE,
  HIGHLIGHT_STRIDE,
  UNIT_ATTR,
  PART_TEXTURE_WIDTH,
  PART_STRIDE,
} from './passes/units.ts';
export type { UnitPartsView, UnitVisualMeshes } from './passes/units.ts';
export { InstanceCuller, LOD_LEVELS, DEFAULT_LOD_DISTANCES, KEY_CULLED, KEY_DROPPED } from './units/culling.ts';
export type { CullStats, StrategicCull } from './units/culling.ts';
export {
  VisualDataTexture,
  VISUAL_DATA_GLSL,
  VISUAL_DATA_ROWS,
  VISUAL_DATA_WIDTH,
  UNIT_VISUAL_DATA,
  UNIT_ICON_ATLAS,
} from './units/visual-data.ts';
export type { VisualStrategic } from './units/visual-data.ts';
export {
  ICON_FADE_BAND,
  DEFAULT_ICON_THRESHOLD_PX,
  ICON_SIZE_PX,
  ICON_TECH_STRIP,
  ZOOM_Z1_FACTOR,
  ZOOM_Z2_FACTOR,
  ZOOM_Z1_MIN_WU,
  ZOOM_Z2_MIN_WU,
  ZOOM_FORCE_START,
  DEFAULT_MAP_SIZE_WU,
  HP_BAR_WIDTH_PX,
  HP_BAR_HEIGHT_PX,
  HP_BAR_GAP_PX,
  STRATEGIC_GLSL,
  strategicZoom,
  zoomFlags,
  iconProjectionScale,
  unitProjectedPx,
  iconFade,
  eyeDistanceWU,
  unitIconFade,
  iconScreenRect,
} from './strategic.ts';
export type { StrategicZoom, ZoomFlags, ZoomLevel } from './strategic.ts';
export {
  ICON_GLYPH_FALLBACK,
  ICON_GLYPH_TECH,
  ICON_GLYPH_BLIP,
  ICON_GLYPH_GHOST,
  MAX_ICON_GLYPHS,
  iconGlyphIndex,
  validateIconAtlas,
} from './icons/atlas.ts';
export type { IconAtlasGlyph, IconAtlasMetrics } from './icons/atlas.ts';
export { IconPass, RING_ATTR, UNIT_RING_GLSL, UNIT_RING_STREAMS } from './passes/icons.ts';
export { HpBarPass, hpBarMask, hpBarVisible, HP_BAR_ALL, HP_BAR_DAMAGED, HP_BAR_SELECTED } from './passes/hpbars.ts';
export type { HpBarMode } from './passes/hpbars.ts';
export { Frustum, OUTSIDE, INTERSECTS, INSIDE } from './frustum.ts';
export type { CullResult } from './frustum.ts';
export {
  TERRAIN_MAX_SIZE_WU,
  TERRAIN_MIN_SIZE_WU,
  TERRAIN_PATCH_WU,
  TERRAIN_PATCH_VERTS,
  LAND_MAX_WATER_DEPTH_RAW,
  validateTerrain,
  sampleTerrainHeightRaw,
  computeChunkBounds,
} from './terrain/heightfield.ts';
export type { ChunkBounds, HeightfieldLike, TerrainDesc, TerrainLight, TerrainSplat } from './terrain/heightfield.ts';
export {
  TERRAIN_HEIGHT_GLSL,
  TERRAIN_SPLAT_GLSL,
  TERRAIN_HEIGHT_LAYOUT,
  TERRAIN_ALBEDO_LAYERS,
  TERRAIN_ALBEDO_SIZE,
  TERRAIN_LAYER_COLORS,
  SLOT_TERRAIN_HEIGHT,
  UNIT_HEIGHTMAP,
  generateTerrainAlbedo,
} from './terrain/glsl.ts';
export { PatchCuller, cullChunksBruteForce } from './terrain/patches.ts';
export {
  DecalBinner,
  DecalLayer,
  DynamicDecals,
  DECAL_KIND_RING,
  DECAL_KIND_DISC,
  DECAL_KIND_RECT,
  DYNAMIC_RING_WIDTH_WU,
  MAX_TERRAIN_DECALS,
  MAX_DECALS_PER_CHUNK,
  DECALS_PER_ROW,
  DECAL_DATA_WIDTH,
  DECAL_DATA_HEIGHT,
  DECAL_LIST_WIDTH,
} from './terrain/decals.ts';
export type { DecalBinStats, TerrainDecal, TerrainDecalKind } from './terrain/decals.ts';
export { TerrainPass, TerrainHeightResources, PATCH_INDEX_COUNT } from './passes/terrain.ts';
export type { TerrainPassOptions } from './passes/terrain.ts';
export { WaterPass, WATER_BORDER_WU, WATER_FOAM_DEPTH_WU } from './passes/water.ts';
export { HeightProbe, PROBE_WIDTH, PROBE_HEIGHT, PROBE_BATCH } from './passes/probe.ts';
export {
  RENDER_PRESETS,
  RENDER_PRESET_NAMES,
  backbufferSize,
  parsePresetName,
  resolvePreset,
} from './presets.ts';
export type { RenderCaps, RenderPreset, RenderPresetName, ShadowMode, WaterQuality } from './presets.ts';
export { OverlayPass, MARKER_STRIDE, SEGMENT_STRIDE } from './passes/overlay.ts';
export type { OverlayMarker, OverlaySegment, Overlays } from './passes/overlay.ts';
export {
  DEFAULT_ARMY_COLORS,
  MAX_ARMY_COLORS,
  MAX_VISUALS,
  FRAME_LAYOUT,
  PALETTE_LAYOUT,
  FRAME_BLOCK_GLSL,
  PALETTE_BLOCK_GLSL,
  SLOT_FRAME,
  SLOT_PALETTE,
  SLOT_PASS,
  rgbHex,
} from './passes/shared.ts';
export { createRenderer, FIXED_PASS_DRAWS, sunDirection } from './renderer.ts';
export type {
  PassDraws,
  Renderer,
  RendererCanvas,
  RendererOptions,
  RenderStats,
  RenderUnits,
  RenderView,
  VisualEntry,
  VisualTable,
} from './renderer.ts';
