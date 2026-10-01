/**
 * Deterministic demo/fake data helpers (gallery, tests, benchmarks). Own seeded PRNG, never Math.random,
 * so every story renders identically on every run and browser.
 */
export const DEMO_SEED = 253698086;
/** Random source returning floats in [0, 1). */
export type Rng = () => number;
/** mulberry32: small, fast 32-bit PRNG. */
export function mulberry32(seed: number): Rng {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function createDemoRng(seed: number = DEMO_SEED): Rng {
    return mulberry32(seed);
}
/** Float in [min, max). */
export function range(rng: Rng, min: number, max: number): number {
    return min + (max - min) * rng();
}
/** Integer in [min, max] (inclusive). */
export function int(rng: Rng, min: number, max: number): number {
    return min + Math.floor(rng() * (max - min + 1));
}
/** One element of a non-empty list. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
    if (items.length === 0)
        throw new Error('pick: empty list');
    return items[Math.floor(rng() * items.length)] as T;
}
/** Shuffled copy (Fisher–Yates). */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = out[i] as T;
        out[i] = out[j] as T;
        out[j] = tmp;
    }
    return out;
}
/** True with probability p. */
export function chance(rng: Rng, p: number): boolean {
    return rng() < p;
}
