/**
 * Node adapter of the environment-neutral `MessagePortLike` (@faf/ai/host): wraps a
 * worker_threads MessagePort / parentPort or a Worker.
 */
import type { MessagePortLike } from '@faf/ai/host';
import type { MessagePort, Transferable, Worker } from 'node:worker_threads';

type NodePort = Pick<MessagePort, 'postMessage' | 'on'> | Pick<Worker, 'postMessage' | 'on'>;

export function nodePortLike(port: NodePort): MessagePortLike {
  return {
    postMessage: (m, transfer) => {
      if (transfer === undefined) port.postMessage(m);
      else port.postMessage(m, transfer as unknown as readonly Transferable[]);
    },
    onMessage: (h) => {
      (port as MessagePort).on('message', (data: unknown) => h(data));
    },
  };
}
