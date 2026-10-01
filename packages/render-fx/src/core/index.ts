// Core contracts of @faf/render-fx shared by every FX module (TRACK-RENDERFX common contracts).
export {
  SLOT_FX_VIEW,
  SLOT_FX_SHADOW,
  SLOT_FX_SCORCH,
  UNIT_FX_SHADOW_STATIC,
  UNIT_FX_SHADOW_DYNAMIC,
  UNIT_FX_CURVE_LUT,
  UNIT_FX_SCORCH_DATA,
  UNIT_FX_SCORCH_CELLS,
  FX_TIME_WRAP_S,
} from './slots.ts';
export { FX_VIEW_BLOCK_GLSL, FX_VIEW_LAYOUT, FX_COMMON_GLSL, fxSharedBufferBindings } from './view.ts';
export type { FxBindings } from './view.ts';
export { FxFrameUniforms, FX_DEFAULT_LIGHT, wrapFxTime } from './frame.ts';
export type { FxFrameInput, FxFrameOptions, Vec3Like } from './frame.ts';
export { GpuSpanTimer, hideTimerQueryFromDevice, TIMER_QUERY_EXT } from './gpu-timer.ts';
export type { GpuSpanSink, TimerGl } from './gpu-timer.ts';
export { DynamicInstanceBuffer } from './instance-buffer.ts';
export type { DynamicInstanceBufferDesc } from './instance-buffer.ts';
export { toHalf, fromHalf, HALF_MAX } from './half.ts';
export { RAW_PER_WU, wuToRaw, rawToWu } from './units.ts';
export { FX_SEGMENTS, createFxPassStats, createFxDrawStats, resetFxDrawStats, addFxPassStats } from './stats.ts';
export type { FxSegment, FxPassStats, FxDrawStats } from './stats.ts';
