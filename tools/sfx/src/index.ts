/**
 * @faf/sfx — procedural, deterministic sound synthesis for Flow & Fire.
 * Authoring API for content/audio/<scope>/<name>.sfx.ts. Node-only pipeline code lives in ./pipeline.ts.
 */
export * from './signal.ts';
export * from './env.ts';
export * from './osc.ts';
export * from './noise.ts';
export * from './filter.ts';
export * from './fx.ts';
export * from './reverb.ts';
export * from './recipes.ts';
export { Rng, hashString, variantSeed } from './rng.ts';
export { CATEGORIES, MAX_VOICES, type CategoryInfo, type SfxCategory } from './categories.ts';
export { defineSfx, type SfxContext, type SfxDefinition, type LoopSpec, type PostSpec } from './define.ts';
export { analyze, loudness, truePeak, spectralCentroid, type Analysis } from './analysis.ts';
export { renderVariant, makeLoop, normalize, type RenderedVariant } from './render.ts';
