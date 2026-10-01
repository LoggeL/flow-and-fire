import simUrl from '../../../../content/generated/sim.bin?url';
import mapUrl from '../../../../content/maps/setons.rtsmap?url';
import { createTransferConsumer, DEFAULT_FRAME_CAPS, frameCapacityBytes } from '../../../../packages/protocol/src/index.ts';
import type { QualificationResult, RunRequest } from './contract.ts';

const capacity=frameCapacityBytes(DEFAULT_FRAME_CAPS);
let running=false;
async function run(request:RunRequest):Promise<QualificationResult> {
  if(running)throw new Error('Qualification runs must be serial');running=true;
  const worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module',name:'real-sim-ai-qualification'});
  const consumer=createTransferConsumer(worker,capacity);
  try {
    const [simBin,map]=await Promise.all([fetch(simUrl).then(r=>r.arrayBuffer()),fetch(mapUrl).then(r=>r.arrayBuffer())]);
    return await new Promise<QualificationResult>((resolve,reject)=>{
      worker.addEventListener('error',event=>reject(new Error(event.message)));
      worker.addEventListener('message',(event:MessageEvent)=>{
        const message=event.data as {t?:string;message?:string;result?:QualificationResult};
        if(message.t==='qualification'){document.getElementById('status')!.textContent=JSON.stringify(message.result,null,2);resolve(message.result!);}
        else if(message.t==='error')reject(new Error(message.message));
      });
      worker.postMessage({t:'qualification-run',request,simBin,map,frameCapacity:capacity},[simBin,map]);
    });
  }finally{consumer.close();worker.terminate();running=false;}
}
(window as unknown as {__fafAiQualification:{run:typeof run}}).__fafAiQualification={run};
