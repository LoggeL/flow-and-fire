/**
 * OPFS export (PLAN §3.11 "Aufnahme … übersteht einen Crash … Export als Download"): a game
 * recorded through OpfsLogSink into the (fake) OPFS is listed, converted and verified — including
 * the tab-kill case (no END entry) and a torn last entry.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import { readRtsReplay, ReplayFlags } from '@faf/formats';
import {
  CommandLogError,
  exportRecordedLogAsReplay,
  HeadlessSim,
  listRecordedLogs,
  LOG_DIR_NAME,
  openOpfsLogSink,
  replayFileNameForLog,
  verifyReplay,
} from '../src/index.ts';
import { FakeDir, FakeFile } from './support/fake-opfs.ts';
import { gameSimBin, runScenario } from './support/fixtures.ts';

const SEED = 0x0bf5_0001;

let table: SimBpTable;

/** Makes the fake files readable like OPFS file handles (`getFile()`), without touching the fake. */
function readable(root: FakeDir): FakeDir {
  const dir = root.dirs.get(LOG_DIR_NAME)!;
  for (const f of dir.files.values()) {
    Object.assign(f, { getFile: async (): Promise<Blob> => new Blob([f.bytes() as Uint8Array<ArrayBuffer>]) });
  }
  return root;
}

interface Game {
  readonly root: FakeDir;
  readonly name: string;
  readonly file: FakeFile;
  readonly sim: HeadlessSim;
  /** Full hash of the live game after every tick (index = tick). */
  readonly fullHashes: number[];
}

/** Plays the reference scenario for `ticks` ticks with the log going to a fake OPFS; the tab then dies. */
async function playAndKill(ticks: number, root = new FakeDir(), date = new Date(Date.UTC(2026, 8, 30, 12, 0, 0))): Promise<Game> {
  const sim = new HeadlessSim({ bpTable: table, seed: SEED, armyCount: 2, keyframes: false, buildHash: 'opfs0001' });
  const sink = await openOpfsLogSink(root, { simId: sim.simId, date });
  expect(sim.recorder!.attachSink(sink)).toBe(true);
  const fullHashes = [sim.fullHash()];
  runScenario(sim, ticks, (t) => (fullHashes[t] = sim.fullHash()));
  sim.recorder!.flush();
  // Tab killed: no END entry, the sync access handle is simply gone.
  const file = root.dirs.get(LOG_DIR_NAME)!.files.get(sink.name)!;
  file.open = false;
  return { root: readable(root), name: sink.name, file, sim, fullHashes };
}

beforeAll(() => {
  table = decodeSimBin(gameSimBin());
});

describe('OPFS export', () => {
  it('lists the stored logs (oldest first) and nothing without a log directory', async () => {
    expect(await listRecordedLogs(new FakeDir())).toEqual([]);
    const a = await playAndKill(20);
    const b = await playAndKill(20, a.root, new Date(Date.UTC(2026, 8, 30, 13, 0, 0)));
    expect(await listRecordedLogs(a.root)).toEqual([a.name, b.name]);
    expect(replayFileNameForLog(a.name)).toBe(a.name.replace(/\.faflog$/, '.rtsreplay'));
  });

  it('tab kill after 1,005 ticks → Truncated replay up to the last recorded tick, verified', async () => {
    const g = await playAndKill(1005);
    const res = await exportRecordedLogAsReplay(g.root, g.name, { bpTable: table });
    expect(res.truncatedSource).toBe(true);
    expect(res.verified).toBe(true);
    expect(res.lastTick).toBeGreaterThanOrEqual(995); // PLAN MS11: kill at 10:00 → replay ≥ 9:50
    expect(res.lastTick).toBe(1001); // last entry: the commands of tick 1,001 (scenario)
    const r = readRtsReplay(res.bytes);
    expect(r.head.flags).toBe(ReplayFlags.Tainted | ReplayFlags.Truncated);
    expect(r.head.buildHash).toBe('opfs0001');
    const v = verifyReplay(res.bytes, { bpTable: table });
    expect(v.divergences).toEqual([]);
    expect(v.endTick).toBe(1001);
    expect(v.compared).toBe(100);
    expect(v.truncated).toBe(true);
    expect(v.complete).toBe(false);
    // Same state as the live game at tick 1,001.
    expect(v.fullHash).toBe(g.fullHashes[1001]);
  });

  it('a torn last entry is cut off; everything before stays verified', async () => {
    const g = await playAndKill(1210);
    g.file.size -= 6; // crash while appending the last entry
    const res = await exportRecordedLogAsReplay(readable(g.root), g.name, { bpTable: table });
    expect(res.truncatedSource).toBe(true);
    expect(res.verified).toBe(true);
    expect(res.lastTick).toBeLessThan(1210);
    expect(res.lastTick).toBeGreaterThanOrEqual(1190);
    expect(res.warnings.some((w) => w.includes('torn'))).toBe(true);
    const v = verifyReplay(res.bytes, { bpTable: table });
    expect(v.divergences).toEqual([]);
    expect(v.endTick).toBe(res.lastTick);
  });

  it('rejects a missing file and a file that is not a command log', async () => {
    const g = await playAndKill(10);
    await expect(exportRecordedLogAsReplay(g.root, 'log-missing.faflog')).rejects.toThrow();
    g.file.size = 8;
    await expect(exportRecordedLogAsReplay(readable(g.root), g.name)).rejects.toThrow(CommandLogError);
  });
});
