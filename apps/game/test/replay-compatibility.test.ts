import { afterEach, describe, expect, it, vi } from 'vitest';
import { historicalReplayBuildAvailable, stageReplayBuildTransfer, transferredReplay } from '../src/replay/compatibility.ts';

afterEach(() => vi.unstubAllGlobals());
describe('historical replay route contract', () => {
  it('requires a real retained versioned index and refuses the dev SPA fallback or a missing build', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    fetcher.mockResolvedValue(new Response('<script src="/src/main.tsx"></script>', { headers: { 'content-type': 'text/html' } }));
    expect(await historicalReplayBuildAvailable('old')).toBe(false);
    fetcher.mockResolvedValue(new Response('not found', { status: 404 })); expect(await historicalReplayBuildAvailable('old')).toBe(false);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ buildHash: 'old', replayPlayer: 1, sessionTransfer: 1 }), { headers: { 'content-type': 'application/json' } }));
    fetcher.mockResolvedValueOnce(new Response('<script src="/b/old/assets/index-abc.js"></script>', { headers: { 'content-type': 'text/html' } }));
    expect(await historicalReplayBuildAvailable('old')).toBe(true);
    expect(fetcher).toHaveBeenLastCalledWith('/b/old/index.html', { cache: 'no-store' });
  });
  it('rejects retained HTML without a capable viewer/transfer marker and rejects a different build marker', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ buildHash: 'old', replayPlayer: 1 }), { headers: { 'content-type': 'application/json' } }));
    expect(await historicalReplayBuildAvailable('old')).toBe(false); expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ buildHash: 'other', replayPlayer: 1, sessionTransfer: 1 }), { headers: { 'content-type': 'application/json' } }));
    expect(await historicalReplayBuildAvailable('old')).toBe(false);
  });
  it('preserves exact bytes across same-tab route transfer and repeated failed boots', () => {
    const files = new Map<string, string>(); vi.stubGlobal('sessionStorage', { setItem: (key: string, value: string) => files.set(key, value), getItem: (key: string) => files.get(key) ?? null });
    const bytes = Uint8Array.from({ length: 250001 }, (_, i) => i & 255), route = stageReplayBuildTransfer(bytes, 'b/ü');
    expect(route).toMatch(/^\/b\/b%2F%C3%BC\/\?replayTransfer=/);
    const query = route.slice(route.indexOf('?')); expect(transferredReplay(query)).toEqual(bytes); expect(transferredReplay(query)).toEqual(bytes);
    expect(transferredReplay('?replayTransfer=../../x')).toBeNull(); expect(transferredReplay('')).toBeNull();
  });
});
