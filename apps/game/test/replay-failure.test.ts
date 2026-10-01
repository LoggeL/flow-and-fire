import { signal } from '@preact/signals';
import type { HostMessage } from '@faf/protocol';
import type { HostReadyMsg } from '@faf/sim-host';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../src/game.ts';
import { isReplayStartupCompatibilityNotice, visibleReplayWorkError } from '../src/replay/startup-failure.ts';

const notice = {
  t: 'error' as const,
  message: 'Client build old differs from current. Open the recording build at /b/old%2F%C3%BC/',
  replayBuild: 'old/ü', replayRoute: '/b/old%2F%C3%BC/',
};
const failure = { message: notice.message, buildHash: notice.replayBuild, route: notice.replayRoute };

afterEach(() => vi.restoreAllMocks());

describe('replay startup compatibility boundary', () => {
  it('accepts only the canonical encoded pre-ready replay build handoff', () => {
    expect(isReplayStartupCompatibilityNotice(notice, true, false)).toBe(true);
  });
  it.each([
    ['live host', notice, false, false],
    ['ready replay host', notice, true, true],
    ['worker failure', { ...notice, message: 'worker: crashed' }, true, false],
    ['different message kind', { ...notice, t: 'status' }, true, false],
    ['missing build', { t: 'error', message: 'Replay failed' }, true, false],
    ['empty build', { ...notice, replayBuild: '' }, true, false],
    ['blank build', { ...notice, replayBuild: ' ' }, true, false],
    ['nonstring build', { ...notice, replayBuild: 12 }, true, false],
    ['malformed Unicode build', { ...notice, replayBuild: '\uD800' }, true, false],
    ['missing route', { ...notice, replayRoute: undefined }, true, false],
    ['other build route', { ...notice, replayRoute: '/b/other/' }, true, false],
    ['unencoded route', { ...notice, replayRoute: '/b/old/ü/' }, true, false],
    ['route with query', { ...notice, replayRoute: `${notice.replayRoute}?x=1` }, true, false],
    ['absolute route', { ...notice, replayRoute: `https://example.test${notice.replayRoute}` }, true, false],
    ['missing slash', { ...notice, replayRoute: '/b/old%2F%C3%BC' }, true, false],
    ['empty message', { ...notice, message: '' }, true, false],
    ['nonstring message', { ...notice, message: 12 }, true, false],
    ['null message', null, true, false],
  ] as const)('keeps %s outside the compatibility classification', (_name, message, replayMode, ready) => {
    expect(isReplayStartupCompatibilityNotice(message, replayMode, ready)).toBe(false);
  });

  it('removes only the duplicate controller compatibility notice from the work alert', () => {
    expect(visibleReplayWorkError(notice.message, failure, false)).toBeNull();
    expect(visibleReplayWorkError('The retained build is unavailable', failure, false)).toBe('The retained build is unavailable');
    expect(visibleReplayWorkError(notice.message, null, false)).toBe(notice.message);
    expect(visibleReplayWorkError(notice.message, failure, true)).toBe(notice.message);
    expect(visibleReplayWorkError(notice.message, { ...failure, route: '/b/other/' }, false)).toBe(notice.message);
    expect(visibleReplayWorkError('worker: crashed', { ...failure, message: 'worker: crashed' }, false)).toBe('worker: crashed');
  });
});

interface StartupGame {
  ready: HostReadyMsg | null;
  replayMode: boolean;
  fatal: ReturnType<typeof signal<string | null>>;
  hostErrors: string[];
  print: ReturnType<typeof vi.fn>;
  readyWaiters: ((ready: HostReadyMsg) => void)[];
  failWaiters: ((error: Error) => void)[];
  whenReady(): Promise<HostReadyMsg>;
  onHostMessage(message: HostMessage): void;
}
/** Exercise Game's real startup message/readiness methods without creating a WebGL session. */
function startupGame(replayMode = true, ready: HostReadyMsg | null = null): StartupGame {
  return Object.assign(Object.create(Game.prototype) as StartupGame, {
    replayMode, ready, disposed: false, startupFailure: null,
    fatal: signal<string | null>(null), hostErrors: [], print: vi.fn(), pendingReload: null,
    readyWaiters: [], failWaiters: [],
  });
}

describe('Game startup rejection and compatibility notice', () => {
  it('rejects both waiting and later callers with the actual message, without a false fatal or error log', async () => {
    const game = startupGame(), consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rejection = expect(game.whenReady()).rejects.toThrow(notice.message);
    game.onHostMessage(notice);
    await rejection;
    await expect(game.whenReady()).rejects.toThrow(notice.message);
    expect(game.ready).toBeNull();
    expect(game.fatal.peek()).toBeNull();
    expect(game.hostErrors).toEqual([]);
    expect(game.print).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(game.readyWaiters).toEqual([]);
    expect(game.failWaiters).toEqual([]);
  });

  it.each([
    ['live compatibility-shaped error', false, null, notice],
    ['ordinary replay startup rejection', true, null, { t: 'error' as const, message: 'Invalid replay bytes' }],
    ['worker crash with misleading compatibility fields', true, null, { ...notice, message: 'worker: crashed' }],
    ['malformed replay route', true, null, { ...notice, replayRoute: '/b/other/' }],
    ['runtime error after ready', true, {} as HostReadyMsg, notice],
  ] as const)('retains error logging and the existing fatal policy for %s', async (_name, replayMode, ready, message) => {
    const game = startupGame(replayMode, ready), consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    game.onHostMessage(message);
    expect(game.hostErrors).toEqual([message.message]);
    expect(game.print).toHaveBeenCalledWith('err', `host: ${message.message}`);
    expect(consoleError).toHaveBeenCalledWith(`[faf] sim host error: ${message.message}`);
    if (message.message.startsWith('worker:')) expect(game.fatal.peek()).toContain('Sim-Worker ausgefallen');
    else if (ready === null) expect(game.fatal.peek()).toContain('Sim-Start fehlgeschlagen');
    else expect(game.fatal.peek()).toBeNull();
    if (ready === null) await expect(game.whenReady()).rejects.toThrow(game.fatal.peek() ?? message.message);
    else await expect(game.whenReady()).resolves.toBe(ready);
  });
});
