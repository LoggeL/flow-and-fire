import { Worker } from 'node:worker_threads';
import { AsyncAiSource, packStatic, type MessagePortLike, type WorkerInit, type WorkerResponse } from '@faf/ai/host';
import type { AiStatic, AiProfile, BrainInitOptions } from '@faf/ai';
import { tsxExecArgv } from '../stats/pool.ts';
export class NodeAiWorker {
  readonly worker:Worker;readonly port:MessagePortLike;
  private listeners:((m:WorkerResponse)=>void)[]=[];private wake:()=>void=()=>undefined;private failure:Error|undefined;
  private constructor() {
    this.worker=new Worker(new URL('bootstrap.mjs',import.meta.url),{execArgv:[...tsxExecArgv()]});
    this.port={postMessage:(message,transfer)=>this.worker.postMessage(message,transfer),onMessage:callback=>this.listeners.push(callback)};
    this.worker.on('message',(message:WorkerResponse)=>{if(message.type==='error')this.failure=new Error(message.message);for(const listener of this.listeners)listener(message);this.wake();});
    this.worker.on('error',error=>{this.failure=error;this.wake();});
  }
  static async create(options:{static:AiStatic;profile:AiProfile;options:BrainInitOptions;brainSpec?:string}):Promise<NodeAiWorker> {
    const host=new NodeAiWorker();const ready=new Promise<void>((resolve,reject)=>{host.listeners.push(message=>{if(message.type==='ready')resolve();if(message.type==='error')reject(new Error(message.message));});host.worker.once('error',reject);});
    const init:WorkerInit={type:'init',...options,static:packStatic(options.static)};host.worker.postMessage(init);
    try {await ready;return host;}catch(error){await host.close();throw error;}
  }
  source(options:{thinkEvery:number;lead:number;perceive:(tick:number)=>Uint8Array;onResult?:(result:Extract<WorkerResponse,{type:'result'}>)=>void}):AsyncAiSource{return new AsyncAiSource({...options,port:this.port});}
  async wait():Promise<void>{if(this.failure)throw this.failure;await new Promise<void>(resolve=>{this.wake=resolve;});if(this.failure)throw this.failure;}
  async close():Promise<void>{await this.worker.terminate();}
}
