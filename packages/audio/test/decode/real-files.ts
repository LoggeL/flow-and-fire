/** Access to the real content/audio/dist files for decode tests (Node only). */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DIST_DIR = fileURLToPath(new URL('../../../../content/audio/dist/', import.meta.url));

export interface RealVariant {
  readonly soundId: string;
  readonly channels: number;
  readonly opus: string;
  readonly samples: number;
  readonly tags: readonly string[];
}

interface ManifestJson {
  sampleRate: number;
  sounds: {
    id: string;
    channels: number;
    tags: string[];
    variants: { opus: string; samples: number }[];
  }[];
}

let cache: RealVariant[] | null = null;

export function realVariants(): readonly RealVariant[] {
  if (cache) return cache;
  const m = JSON.parse(readFileSync(DIST_DIR + 'manifest.json', 'utf8')) as ManifestJson;
  const out: RealVariant[] = [];
  for (const s of m.sounds) {
    for (const v of s.variants) out.push({ soundId: s.id, channels: s.channels, opus: v.opus, samples: v.samples, tags: s.tags });
  }
  cache = out;
  return out;
}

export function realBytes(relPath: string): Uint8Array {
  const buf = readFileSync(DIST_DIR + relPath);
  // Own ArrayBuffer (Node pools small reads) so views and mutations stay isolated.
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
