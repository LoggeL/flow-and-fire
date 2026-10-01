import { parentPort } from 'node:worker_threads';
import { createDefaultBrain, type AiBrain } from '@faf/ai';
import { runAiWorker, type MessagePortLike } from '@faf/ai/host';
if (!parentPort) throw new Error('AI entry requires worker_threads');
const port=parentPort;
runAiWorker({postMessage:(message,transfer)=>port.postMessage(message,transfer),onMessage:callback=>port.on('message',callback)} satisfies MessagePortLike,async spec=>{
  if(!spec||spec==='@faf/ai#createDefaultBrain')return createDefaultBrain();
  const [moduleName,name='createDefaultBrain']=spec.split('#');const module=await import(moduleName!);const factory=module[name] as (()=>AiBrain)|undefined;
  if(!factory)throw new Error(`Missing brain factory ${spec}`);return factory();
});
