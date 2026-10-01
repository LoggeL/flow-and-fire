const TRANSFER_PREFIX = 'faf-replay-transfer:';
export function replayBuildRoute(buildHash: string): string { return `/b/${encodeURIComponent(buildHash)}/`; }

/** Validate a real versioned index rather than accepting the dev server's generic SPA fallback. */
export async function historicalReplayBuildAvailable(buildHash: string): Promise<boolean> {
  const route = replayBuildRoute(buildHash);
  try {
    const marker = await fetch(`${route}replay-capabilities.json`, { cache: 'no-store' });
    if (!marker.ok || marker.redirected || !(marker.headers.get('content-type') ?? '').includes('application/json')) return false;
    const capability = await marker.json() as { buildHash?: string; replayPlayer?: number; sessionTransfer?: number };
    if (capability.buildHash !== buildHash || capability.replayPlayer !== 1 || capability.sessionTransfer !== 1) return false;
    const response = await fetch(`${route}index.html`, { cache: 'no-store' });
    return response.ok && !response.redirected && (response.headers.get('content-type') ?? '').includes('text/html')
      && (await response.text()).includes(`${route}assets/`);
  } catch { return false; }
}

/** Same-tab transfer contract for a retained build. The bytes remain in session storage on this origin. */
export function stageReplayBuildTransfer(bytes: Uint8Array, buildHash: string): string {
  const id = crypto.randomUUID();
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  sessionStorage.setItem(`${TRANSFER_PREFIX}${id}`, btoa(binary));
  return `${replayBuildRoute(buildHash)}?replayTransfer=${encodeURIComponent(id)}`;
}
/** Read without deleting: a failed map/asset load must leave the requested recording recoverable. */
export function transferredReplay(search = location.search): Uint8Array | null {
  const id = new URLSearchParams(search).get('replayTransfer');
  if (id === null || !/^[a-f0-9-]{36}$/.test(id)) return null;
  const encoded = sessionStorage.getItem(`${TRANSFER_PREFIX}${id}`); if (encoded === null) return null;
  const binary = atob(encoded); return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
