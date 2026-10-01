import type { WorkerRequest, WorkerResponse } from '@faf/ai/host';
import { startGameAiWorker } from './runtime.ts';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
startGameAiWorker({
  postMessage(message:WorkerRequest|WorkerResponse,transfer:ArrayBuffer[]=[]) {scope.postMessage(message,transfer);},
  onMessage(callback) {scope.addEventListener('message',(event:MessageEvent<WorkerRequest>)=>callback(event.data));},
});
