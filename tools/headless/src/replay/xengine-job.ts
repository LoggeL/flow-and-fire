/** Replay execution with observed hash trail and keyframe restore in every engine. */
import { hex32 } from '../goldens.ts';
import { openReplayFile, type ReplayAssets } from './verify.ts';
import type { Clock } from '../stats.ts';

export function runReplayVerifyJob(replayBytes: Uint8Array, assets: ReplayAssets, clock: Clock = () => 0) {
  const start = clock();
  const player = openReplayFile(replayBytes, assets);
  const trail: string[] = [];
  const check = player.sim.core.onHash;
  player.sim.core.onHash = (tick, hash): void => { check?.(tick, hash); trail.push(hex32(hash)); };
  const result = player.playToEnd();
  player.sim.core.onHash = check;
  const middle = Math.floor(player.endTick / 2);
  player.seek(middle);
  const middleFullHash = hex32(player.fullHash());
  player.playToEnd();
  return { trail, finalRuleHash: hex32(result.ruleHash), finalFullHash: hex32(result.fullHash),
    seekFullHash: hex32(player.fullHash()), middleFullHash, seekTick: middle,
    divergences: [...player.divergences], compared: result.compared, subCompared: result.subCompared,
    ticks: result.endTick, hashIntervalTicks: player.replay.hashes.interval, ms: clock() - start };
}
export type ReplayVerifyJobResult = ReturnType<typeof runReplayVerifyJob>;
