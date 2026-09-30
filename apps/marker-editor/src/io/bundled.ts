/** Maps shipped with the editor: /maps/index.json and /maps/<name>.rtsmap (vite.config.ts mapsPlugin). */
import { HttpError } from './errors.ts';
import { isMapName } from './storage.ts';

export interface BundledMapEntry {
  readonly name: string;
  readonly file: string;
  readonly bytes: number;
}

const MAPS_BASE = 'maps/';

function mapsUrl(path: string): string {
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  return new URL(`${MAPS_BASE}${path}`, base).href;
}

/** The bundled map index (sorted by name, as served). */
export async function fetchMapIndex(fetchFn: typeof fetch = fetch): Promise<readonly BundledMapEntry[]> {
  const url = mapsUrl('index.json');
  const res = await fetchFn(url, { cache: 'no-store' });
  if (!res.ok) throw new HttpError(res.status, url);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error('maps/index.json: keine Liste');
  const out: BundledMapEntry[] = [];
  for (const e of data as unknown[]) {
    if (e === null || typeof e !== 'object') continue;
    const { name, file, bytes } = e as Record<string, unknown>;
    if (typeof name === 'string' && isMapName(name) && typeof file === 'string') out.push({ name, file, bytes: typeof bytes === 'number' ? bytes : 0 });
  }
  return out;
}

/** Bytes of maps/<name>.rtsmap (HttpError on a failed request). */
export async function fetchMapBytes(name: string, fetchFn: typeof fetch = fetch): Promise<Uint8Array> {
  if (!isMapName(name)) throw new Error(`ungültiger Kartenname: ${name}`);
  const url = mapsUrl(`${name}.rtsmap`);
  const res = await fetchFn(url, { cache: 'no-store' });
  if (!res.ok) throw new HttpError(res.status, `/${MAPS_BASE}${name}.rtsmap`);
  return new Uint8Array(await res.arrayBuffer());
}
