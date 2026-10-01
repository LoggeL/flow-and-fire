import { ReplaySource, parseCommandLog, type SimCore } from '../../../../packages/sim-host/src/index.ts';
import type { RecordedBatch } from './contract.ts';

/** Qualification-only setup: consume the actual captured log through production ReplaySource. */
export function installRecordedCommandSource(core: SimCore, logBytes: Uint8Array, expected: readonly RecordedBatch[], target: number): void {
  if (core.tick !== 0 || core.sources.length !== 1 || core.sources[0] !== core.local || core.local.queued !== 0) {
    throw new Error('Recorded source requires a fresh no-AI host with only its empty local source');
  }
  const log = parseCommandLog(logBytes), header = log.header;
  if (log.truncated || log.endTick !== target || log.lastTick !== target) throw new Error('Captured log is incomplete or has the wrong duration');
  if ((header.simId >>> 0) !== core.simId || (header.layoutHash >>> 0) !== (core.world.layoutHash >>> 0)
    || (header.bpSimHash >>> 0) !== (core.world.bp.simHash >>> 0) || (header.mapSimHash >>> 0) !== core.mapSimHash
    || header.seed !== core.world.seed || header.armyCount !== core.world.armyCount) {
    throw new Error('Captured log does not match the no-AI simulation identity');
  }
  if (log.commands.length !== expected.length) throw new Error('Captured log command record count differs');
  for (let i = 0; i < log.commands.length; i++) {
    const actual = log.commands[i]!, wanted = expected[i]!;
    if (actual.tick !== wanted.tick || actual.length !== wanted.bytes.length) throw new Error(`Captured command record ${i} differs`);
    for (let j = 0; j < actual.length; j++) {
      if (log.bytes[actual.offset + j] !== wanted.bytes[j]) throw new Error(`Captured command record ${i} byte ${j} differs`);
    }
  }
  const source = new ReplaySource(log);
  // One setup-time delegation. SimCore's actual gather/recorder/step pipeline remains intact.
  // Unlike live input aggregation, ReplaySource preserves non-null zero-envelope batches.
  core.local.batchFor = source.batchFor.bind(source);
}
