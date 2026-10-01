import { describe, expect, it } from 'vitest';
import {
  exportRecordedLogAsReplay, HeadlessSim, listRecordedLogs, LOG_DIR_NAME,
  openOpfsLogSink, verifyReplay, type DirectoryHandleLike,
} from '../src/index.ts';
import { FakeDir } from './support/fake-opfs.ts';
import { gameSimBin, spawnCmd } from './support/fixtures.ts';

describe('portable replay export from OPFS', () => {
  it('exports a durable recording and its recoverable crash prefix', async () => {
    const simBin = gameSimBin();
    const sim = new HeadlessSim({ simBin, seed: 83, armyCount: 2, keyframes: false });
    const root = new FakeDir();
    const sink = await openOpfsLogSink(root, { simId: sim.simId });
    expect(sim.recorder!.attachSink(sink)).toBe(true);
    const file = root.dirs.get(LOG_DIR_NAME)!.files.get(sink.name)!;
    // The shared sync-handle fake does not implement the browser's getFile read API.
    Object.assign(file, { getFile: async () => new Blob([new Uint8Array(file.bytes())]) });
    sim.submit([spawnCmd(0, 20, 128, 128, 10, 1)]);
    sim.step(120);
    expect(await listRecordedLogs(root)).toEqual([sink.name]);

    const crash = await exportRecordedLogAsReplay(root, sink.name, { simBin });
    expect(crash.verified).toBe(true);
    expect(crash.truncatedSource).toBe(true);
    const recovered = verifyReplay(crash.bytes, { simBin, keyframes: false });
    expect(recovered.endTick).toBe(120);
    expect(recovered.divergences).toEqual([]);
    expect(recovered.fullHash).toBe(sim.fullHash());

    const complete = sim.exportLog();
    sink.write(complete, 0, complete.length, 0);
    sink.truncate(complete.length);
    sim.recorder!.close();
    const exported = await exportRecordedLogAsReplay(root, sink.name, { simBin });
    const replay = verifyReplay(exported.bytes, { simBin, keyframes: false });
    expect(exported.verified).toBe(true);
    expect(replay.complete).toBe(true);
    expect(replay.truncated).toBe(false);
    expect(replay.fullHash).toBe(sim.fullHash());
    expect(file.open).toBe(false);
  });

  it('treats an absent log directory as empty but preserves storage errors', async () => {
    const root = new FakeDir() as DirectoryHandleLike;
    root.getDirectoryHandle = async () => { throw new DOMException('No logs yet', 'NotFoundError'); };
    expect(await listRecordedLogs(root)).toEqual([]);
    root.getDirectoryHandle = async () => { throw new DOMException('Denied', 'SecurityError'); };
    await expect(listRecordedLogs(root)).rejects.toThrow('Denied');
  });
});
