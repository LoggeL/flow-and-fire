import { createDefaultBrain } from '@faf/ai';
import { runAiWorker, type MessagePortLike } from '@faf/ai/host';
import type { GameAiWorkerResult } from './metrics.ts';

/** Shared browser and focused-test entry point, always the real game brain. */
export function startGameAiWorker(port: MessagePortLike, clock:()=>number=()=>performance.now()): void {
  let thinkMs=0;
  runAiWorker({onMessage:callback=>port.onMessage(callback),postMessage(message,transfer) {
    if(message.type==='result'){const measured:GameAiWorkerResult={...message,thinkMs};port.postMessage(measured,transfer);}
    else port.postMessage(message,transfer);
  }}, () => {
    const brain=createDefaultBrain(),think=brain.think.bind(brain);
    brain.think=(view,options)=>{const start=clock();try{return think(view,options);}finally{thinkMs=clock()-start;}};
    return brain;
  });
}
