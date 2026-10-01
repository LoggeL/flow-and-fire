import { createDefaultBrain, SnapshotPerception } from '../../../../packages/ai/src/index.ts';
import { AiHost, unpackStatic, type WorkerRequest, type WorkerResponse } from '../../../../packages/ai/src/host/index.ts';
import { encodeBatch } from '../../../../packages/protocol/src/index.ts';
import { hasMatchEnded } from '../../../../packages/sim/src/index.ts';
import { SimCore, parseCommandLog, SIM_BUILD } from '../../../../packages/sim-host/src/index.ts';
import { createGameAiSources, type GameAiPort, type GameAiWorkerResult } from '../../../../packages/sim-host/src/ai/index.ts';
import { initializationFor } from './contract.ts';

/** Synchronous real AiHost, same static/perception wire and brain, original headless 200 ms. */
function synchronousPort():GameAiPort {
  let callback:((message:WorkerRequest|WorkerResponse)=>void)|undefined;
  let host:AiHost|undefined,st:ReturnType<typeof unpackStatic>|undefined;
  return {execution:'custom',onMessage:cb=>{callback=cb;},dispose(){},postMessage(message){
    const request=structuredClone(message);
    if(request.type==='init'){
      st=unpackStatic(request.static);const brain=createDefaultBrain();brain.init(st,request.profile,request.options);
      host=new AiHost(brain,{timeoutMs:200});callback!({type:'ready'});
    }else if(request.type==='perceive'){
      if(host===undefined||st===undefined)throw new Error('Synchronous AI not initialized');
      const view=new SnapshotPerception(st,request.bytes),start=performance.now(),r=host.think(view);
      const response:GameAiWorkerResult={type:'result',tick:request.tick,batch:encodeBatch(r.commands),aborted:r.aborted,ops:r.opsTotal,opsByManager:r.opsByManager,thinkMs:performance.now()-start};
      callback!(response);
    }
  }};
}
export function runHeadlessDeterminism(simBin:Uint8Array,map:Uint8Array){
  const initialization=initializationFor('determinism');
  const ai=createGameAiSources({initialization,createPort:()=>synchronousPort(),timeoutMs:200});
  const core=new SimCore({simBin,map,seed:7,armyCount:2,playerArmy:-1,initialization,localSource:ai.local,sources:ai.sources,buildHash:'ai-qualification-ms6.1'});
  try {
    ai.bind(core);
    while(core.tick<6000){if(!core.runTick())throw new Error('Synchronous headless AI unexpectedly pending');if(hasMatchEnded(core.world)&&core.tick<6000)throw new Error(`Headless match ended at ${core.tick}`);}
    const log=core.recorder!.export(core.tick),parsed=parseCommandLog(log);
    return {simBuild:SIM_BUILD,simHash:core.world.bp.simHash>>>0,tick:core.tick,timeoutMs:200,
      commands:parsed.commands.map(c=>({tick:c.tick,bytes:Array.from(parsed.bytes.subarray(c.offset,c.offset+c.length))})),
      hashes:core.hashTrail(),finalRuleHash:core.ruleHash(),finalFullHash:core.fullHash(),ai:ai.status,log:Array.from(new Uint8Array(log))};
  }finally{ai.dispose();}
}
