/** Worker thread: renders one (definition file, variant) job per message. */
import { parentPort } from 'node:worker_threads';
import { type RenderJob, renderJob } from './pipeline.ts';

if (!parentPort) throw new Error('render-worker: nur als Worker-Thread verwendbar');
const port = parentPort;

port.on('message', (job: RenderJob) => {
  renderJob(job).then(
    (result) => port.postMessage({ ok: true, result }, [result.wav.buffer as ArrayBuffer]),
    (e: unknown) => port.postMessage({ ok: false, error: `${job.file} v${job.variant}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}` }),
  );
});
