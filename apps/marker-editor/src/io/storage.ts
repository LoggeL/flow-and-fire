/**
 * Remembers the last opened bundled map in localStorage. Every access is guarded: storage can be
 * missing or throw (private windows, blocked site data); the editor then simply starts with the
 * default map.
 */
const KEY = 'faf.markerEditor.lastMap';
const MAP_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Name of the last bundled map, or null. */
export function readLastMap(): string | null {
  try {
    const v = storage()?.getItem(KEY) ?? null;
    return v !== null && MAP_NAME_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeLastMap(name: string): void {
  try {
    storage()?.setItem(KEY, name);
  } catch {
    // storage full or blocked: nothing to remember
  }
}

/** True for a valid bundled map name (file name without .rtsmap, no path parts). */
export function isMapName(name: string): boolean {
  return MAP_NAME_RE.test(name);
}
