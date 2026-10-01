/** Injected clock is the sole wall-clock dependency of the AI package. */
export type AiClock = () => number;
export const defaultClock: AiClock = () => {
  const host = globalThis as unknown as { performance?: { now(): number } };
  return host.performance?.now() ?? 0;
};
