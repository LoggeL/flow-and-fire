/**
 * Minimal structural typing of `WebAssembly.Memory`. The sim packages compile with
 * `lib: ["ES2022"]`, which does not declare the WebAssembly namespace (it lives in the DOM and
 * WebWorker libs), so the global is reached through `globalThis` with a local interface.
 * The value is a real `WebAssembly.Memory` in every engine (Node, browsers, workers).
 */

/** Structural subset of `WebAssembly.Memory` used by the arena. */
export interface WasmMemory {
  readonly buffer: ArrayBuffer;
  grow(deltaPages: number): number;
}

interface WasmMemoryDescriptor {
  initial: number;
  maximum: number;
}

interface WasmNamespace {
  Memory: new (descriptor: WasmMemoryDescriptor) => WasmMemory;
}

/** Largest arena the builder accepts: 32768 pages = 2 GiB. */
export const MAX_ARENA_PAGES = 32768;

/** Creates a non-shared memory with initial == maximum pages (it never grows). */
export function createFixedMemory(pages: number): WasmMemory {
  const wa = (globalThis as unknown as { WebAssembly?: WasmNamespace }).WebAssembly;
  if (wa === undefined) throw new Error('WebAssembly is not available in this engine');
  return new wa.Memory({ initial: pages, maximum: pages });
}
