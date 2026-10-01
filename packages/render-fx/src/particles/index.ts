// Stateless GPU particle system (rfx-p3): spawn ring, closed-form vertex shader, caps/priorities, emitters.
export {
  ParticleSystem,
  particleCapForPreset,
  UNIT_FX_PARTICLE_LAYERS,
  PARTICLE_RING_CAPACITY,
  MAX_PARTICLE_EMITTERS,
  EXPIRY_BUCKET_S,
  PRIO2_CAP_FRACTION,
  CULL_RADIUS_PX,
  THIN_RADIUS_PX,
  MAX_EMIT_DT_S,
} from './system.ts';
export type { ParticleSystemOptions, ParticleSpawnOptions, ParticleStats } from './system.ts';
export {
  PARTICLE_RECORD_STRIDE,
  PARTICLE_STREAM_LAYOUT,
  PARTICLE_ATTR,
  REC_ORIGIN,
  REC_T0,
  REC_VEC,
  REC_LAYER,
  REC_SEED,
  REC_TINT,
  createParticleRecord,
  readRecord,
  recordViews,
  writeRecord,
  encodeVecHalf,
} from './record.ts';
export type { ParticleRecord, RecordViews } from './record.ts';
export { PARTICLE_VS, PARTICLE_FS, PARTICLE_HASH_GLSL, GROUND_LIFT_WU, STREAK_SECONDS } from './shaders.ts';
export { mirrorParticle, mirrorCorner, mirrorLut, createMirrorState } from './vs-mirror.ts';
export type { MirrorState, MirrorAxes } from './vs-mirror.ts';
