/**
 * Entry module of a Node AI worker thread (loaded through tsx): serves the AI worker protocol of
 * @faf/ai/host on the parent port; the brain comes from the init message's brain specifier
 * ('module#export', default '@faf/ai#createDefaultBrain'), the emergency-stop clock from
 * workerData.clock ('wall' | 'thread', see bench/clock.ts). Ends after `shutdown` (or when the
 * parent terminates the thread).
 */
import { runAiWorker } from '@faf/ai/host';
import { parentPort, workerData } from 'node:worker_threads';
import { hostClock, type HostClockKind } from '../bench/clock.ts';
import { loadBrainFactory } from './brain-spec.ts';
import { nodePortLike } from './node-port.ts';

const port = parentPort;
if (port === null) throw new Error('ai worker entry must run inside a worker thread');
const clockKind: HostClockKind = (workerData as { clock?: HostClockKind } | null)?.clock === 'thread' ? 'thread' : 'wall';
void runAiWorker(nodePortLike(port), async (spec) => (await loadBrainFactory(spec))(), { clock: hostClock(clockKind) }).then(() => {
  port.close();
});
