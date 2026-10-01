import { CategoryRegistry } from '@faf/rules';
import { decodeBatch, encodeBatch } from '@faf/protocol';
import { PendingAiSource } from '../source.ts';
import type { AiBrain, BrainInitOptions, ThinkResult } from '../brain.ts';
import { RosterTable } from '../data/roster-adapter.ts';
import { SnapshotPerception } from '../perception/snapshot.ts';
import type { TelemetryEvent } from '../blackboard.ts';
import type { AiProfile } from '../profile.ts';
import type { AiBlueprint, AiStatic, PerceptionView } from '../types.ts';
import { defaultClock, type AiClock } from './clock.ts';
export * from './clock.ts';

export class AiHost {
  constructor(readonly brain: AiBrain, private readonly options: {clock?: AiClock; timeoutMs?: number; onTimeout?: (tick:number)=>void} = {}) {}
  think(view: PerceptionView): ThinkResult {
    const now = this.options.clock ?? defaultClock, start = now();
    const result = this.brain.think(view, {shouldAbort: () => now()-start >= (this.options.timeoutMs ?? 200)});
    if (result.aborted) {
      this.brain.blackboard.telemetry.push({kind:'aiTimeout',tick:view.tick});
      this.options.onTimeout?.(view.tick);
    }
    return result;
  }
}
export interface StaticWire extends Omit<AiStatic,'bps'> {bps:{list:readonly AiBlueprint[];names:readonly string[]};}
/** Blueprint masks and compiled expressions retain their registry indices across clone. */
export function packStatic(s:AiStatic):StaticWire {return {...s,bps:{list:s.bps.list,names:s.bps.registry.names}};}
export function unpackStatic(s:StaticWire):AiStatic {return {...s,bps:new RosterTable([...s.bps.list],new CategoryRegistry(s.bps.names))};}
export interface WorkerInit {type:'init';static:StaticWire;profile:AiProfile;options:BrainInitOptions;brainSpec?:string;timeoutMs?:number;}
export type WorkerRequest = WorkerInit | {type:'perceive';tick:number;bytes:Uint8Array};
export type WorkerResponse = {type:'ready'} | {type:'result';tick:number;batch:Uint8Array;aborted:boolean;ops:number;opsByManager:Readonly<Record<string,number>>;telemetry?:readonly TelemetryEvent[]} | {type:'error';message:string};
export interface MessagePortLike {postMessage(message:WorkerRequest|WorkerResponse,transfer?:ArrayBuffer[]):void;onMessage(callback:(message:WorkerRequest|WorkerResponse)=>void):void;}
export function runAiWorker(port:MessagePortLike,brainFactory:(specifier?:string)=>AiBrain|Promise<AiBrain>):void {
  let host:AiHost|undefined,st:AiStatic|undefined;let telemetryCursor=0;
  let chain=Promise.resolve();
  port.onMessage(message=>{chain=chain.then(async()=>{
    if(message.type==='init') {st=unpackStatic(message.static);const brain=await brainFactory(message.brainSpec);brain.init(st,message.profile,message.options);host=new AiHost(brain,{...(message.timeoutMs===undefined?{}:{timeoutMs:message.timeoutMs})});port.postMessage({type:'ready'});}
    else if(message.type==='perceive') {if(!host||!st)throw new Error('AI worker not initialized');const view=new SnapshotPerception(st,message.bytes);if(view.tick!==message.tick)throw new Error('Perception tick mismatch');const r=host.think(view);const batch=encodeBatch(r.commands);const telemetry=host.brain.blackboard.telemetry.events.slice(telemetryCursor);telemetryCursor=host.brain.blackboard.telemetry.events.length;port.postMessage({type:'result',tick:message.tick,batch,aborted:r.aborted,ops:r.opsTotal,opsByManager:r.opsByManager,telemetry},[batch.buffer as ArrayBuffer]);}
  }).catch((error:unknown)=>port.postMessage({type:'error',message:error instanceof Error?error.message:String(error)}));});
}
export class AsyncAiSource extends PendingAiSource {
  constructor(options:{port:MessagePortLike;thinkEvery:number;lead:number;perceive:(tick:number)=>Uint8Array;onResult?:(result:Extract<WorkerResponse,{type:'result'}>)=>void}) {
    super({thinkEvery:options.thinkEvery,lead:options.lead,request:tick=>{const bytes=options.perceive(tick).slice();options.port.postMessage({type:'perceive',tick,bytes},[bytes.buffer as ArrayBuffer]);}});
    options.port.onMessage(message=>{if(message.type==='result'){this.deliver(message.tick,decodeBatch(message.batch));options.onResult?.(message);} });
  }
}
