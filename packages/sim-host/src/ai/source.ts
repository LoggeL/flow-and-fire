import { parseOpenings, profileFor, type AiProfile } from '@faf/ai';
import { packStatic, type MessagePortLike, type WorkerRequest, type WorkerResponse } from '@faf/ai/host';
import type { Tick } from '@faf/fixed';
import { hasMatchEnded } from '@faf/sim';
import { decodeBatch, encodeSkirmishInitialization, validateSkirmishInitialization, type CommandEnvelope, type SkirmishInitialization } from '@faf/protocol';
import type { SimCore } from '../core.ts';
import { LocalSource, type TickSource } from '../sources.ts';
import { DEFAULT_OPENINGS_JSON } from './default-openings.ts';
import { gameAiCommands } from './commands.ts';
import { gameAiStatic } from './static.ts';
import { GameAiPerception } from './perception.ts';
import { AiBudgetMetrics, type AiBudgetSummary, type AiThinkSample } from './metrics.ts';
import { startGameAiWorker } from './runtime.ts';

export interface GameAiPort extends MessagePortLike {readonly execution?:'worker'|'inline'|'custom';dispose(): void; }
export interface GameAiStatus {
  readonly army: number;
  readonly difficulty: AiProfile['name'];
  readonly thinks: number;
  readonly timeouts: number;
  readonly pending: number;
  readonly error: string | null;
  readonly execution:'worker'|'inline'|'custom';
  readonly hardwareConcurrency:number|null;
  readonly opsCap:number;
  readonly budget:AiBudgetSummary;
}
export interface GameAiOptions {
  /** The same complete setup passed to SimCore, persisted in its recording. */
  readonly initialization: SkirmishInitialization;
  /** One child per army by default; <=2 cores uses the same brain in the Sim worker. */
  readonly createPort?: (army:number) => GameAiPort;
  readonly openingsJson?: unknown;
  /** Browser emergency limit defaults to 40 ms. Resulting batches are recorded before application. */
  readonly timeoutMs?: number;
  /** Setup-time capability override, principally for qualification of the <=2-core policy. */
  readonly hardwareConcurrency?: number;
  readonly onResult?: (army:number,result:Extract<WorkerResponse,{type:'result'}>) => void;
}

function browserPort(): GameAiPort {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), {type:'module',name:'game-ai'});
  return {
    execution:'worker',
    postMessage(message, transfer=[]) {worker.postMessage(message,transfer);},
    onMessage(callback) {worker.addEventListener('message',(event:MessageEvent<WorkerRequest|WorkerResponse>)=>callback(event.data));worker.addEventListener('error',event=>callback({type:'error',message:event.message||'AI worker failed'}));},
    dispose() {worker.terminate();},
  };
}

/** Same worker runtime and wire clone in the Sim worker for the original <=2-core policy. */
export function inlineGameAiPort():GameAiPort {
  let workerCallback:((message:WorkerRequest|WorkerResponse)=>void)|undefined;
  let hostCallback:((message:WorkerRequest|WorkerResponse)=>void)|undefined;
  let disposed=false;
  startGameAiWorker({postMessage(message){if(!disposed)hostCallback?.(structuredClone(message));},onMessage(callback){workerCallback=callback;}});
  return {execution:'inline',postMessage(message){if(!disposed)workerCallback!(structuredClone(message));},
    onMessage(callback){hostCallback=callback;},dispose(){disposed=true;}};
}

class GameAiSource implements TickSource {
  private core: SimCore | null = null;
  private perception: GameAiPerception | null = null;
  private port: GameAiPort | null = null;
  private readonly due = new Map<number,Uint8Array>();
  private readonly outstanding = new Set<number>();
  private lastThink = -1;
  private sequence = 0;
  private error: string | null = null;
  private thinks = 0;
  private timeouts = 0;
  private disposed = false;
  private readonly budgetMetrics=new AiBudgetMetrics();
  private hardwareConcurrency:number|null=null;
  constructor(readonly army:number, readonly profile:AiProfile, private readonly options:GameAiOptions, private readonly openings:ReturnType<typeof parseOpenings>) {}

  bind(core:SimCore):void {
    if(this.core !== null || core.tick !== 0) throw new Error('AI sources must bind once at tick zero');
    this.core=core;
    const st=gameAiStatic(core,this.army,this.openings);
    this.perception=new GameAiPerception(core.world,this.army);
    const cores=this.options.hardwareConcurrency??globalThis.navigator?.hardwareConcurrency;
    this.hardwareConcurrency=cores===undefined||!Number.isFinite(cores)||cores<1?null:cores;
    this.port=this.options.createPort?.(this.army)??(this.hardwareConcurrency!==null&&this.hardwareConcurrency<=2?inlineGameAiPort():browserPort());
    this.port.onMessage(message=>{
      if(this.disposed||this.finishIfMatchEnded()) return;
      if(message.type==='error') {this.error=message.message;return;}
      if(message.type!=='result') return;
      if(!this.outstanding.delete(message.tick)) {this.error='Unexpected AI result tick';return;}
      try {
        const at=message.tick+this.profile.lead;
        const batch=gameAiCommands(message.batch,this.army,at,()=>{const value=this.sequence;this.sequence=(value+1)&65535;return value;});
        this.due.set(at,batch);this.thinks++;if(message.aborted)this.timeouts++;
        this.budgetMetrics.record(message);
        this.options.onResult?.(this.army,message);
      } catch(error:unknown) {this.error=error instanceof Error?error.message:String(error);}
    });
    this.port.postMessage({type:'init',static:packStatic(st),profile:this.profile,options:{openings:this.openings,gameSeed:st.gameSeed,maxMs:9},timeoutMs:this.options.timeoutMs??40});
    this.request(0);
  }

  private request(tick:number):void {
    if(this.core===null||this.perception===null||this.port===null)throw new Error('AI source is not bound');
    if(this.core.tick!==tick)throw new Error('AI perception must observe its exact completed tick');
    this.lastThink=tick;this.outstanding.add(tick);
    const bytes=this.perception.snapshot().slice();
    this.port.postMessage({type:'perceive',tick,bytes},[bytes.buffer as ArrayBuffer]);
  }
  /** Public terminal state releases unfinished worker decisions before projectile aftermath ticks. */
  private finishIfMatchEnded():boolean {
    if(this.core===null||this.core.replaying||!hasMatchEnded(this.core.world))return false;
    this.dispose();return true;
  }
  pending(tick:number):boolean {
    if(this.disposed||this.core?.replaying)return false;
    if(this.finishIfMatchEnded())return false;
    if(this.error!==null)throw new Error(`AI army ${this.army}: ${this.error}`);
    if(this.core===null)throw new Error('AI source is not bound');
    const completed=this.core.tick;
    if(tick!==completed+1)throw new Error('AI source requires the next simulation tick');
    if(completed%this.profile.thinkEvery===0&&completed>this.lastThink)this.request(completed);
    for(const n of this.outstanding)if(n+this.profile.lead<=tick)return true;
    return false;
  }
  batchFor(tick:number):Uint8Array|null {
    if(this.disposed||this.core?.replaying)return null;
    if(this.pending(tick))throw new Error('AI batch is still pending');
    const batch=this.due.get(tick)??null;this.due.delete(tick);return batch;
  }
  commandsFor(tick:Tick):readonly CommandEnvelope[]|'pending' {
    if(this.pending(tick))return 'pending';const b=this.batchFor(tick);return b===null?[]:decodeBatch(b);
  }
  get status():GameAiStatus {return {army:this.army,difficulty:this.profile.name,thinks:this.thinks,timeouts:this.timeouts,pending:this.outstanding.size,error:this.error,
    execution:this.port?.execution??'custom',hardwareConcurrency:this.hardwareConcurrency,opsCap:this.profile.budget.total,budget:this.budgetMetrics.summary()};}
  get samples():readonly AiThinkSample[]{return this.budgetMetrics.samples();}
  dispose():void {this.disposed=true;this.port?.dispose();this.due.clear();this.outstanding.clear();}
}

/** Install only for a new skirmish. Replays use ReplaySource and never install this controller. */
export function createGameAiSources(options:GameAiOptions):{
  readonly local:LocalSource;
  readonly sources:readonly TickSource[];
  bind(core:SimCore):void;
  dispose():void;
  readonly status:readonly GameAiStatus[];
  readonly samples:readonly {army:number;samples:readonly AiThinkSample[]}[];
} {
  validateSkirmishInitialization(options.initialization);
  const openings=parseOpenings(options.openingsJson??JSON.parse(DEFAULT_OPENINGS_JSON)), local=new LocalSource();
  const ai=(options.initialization.slots??[]).flatMap((slot,army)=>slot.controller==='ai'?[new GameAiSource(army,profileFor(slot.difficulty??'normal',openings),options,openings)]:[]);
  return {local,sources:[local,...ai],bind(core) {
    if(core.recorder!==null) {
      const recorded=core.recorder.header.initialization;
      if(recorded===undefined)throw new Error('AI cannot bind to a sandbox session');
      const a=encodeSkirmishInitialization(recorded),b=encodeSkirmishInitialization(options.initialization);
      if(a.length!==b.length||a.some((byte,i)=>byte!==b[i]))throw new Error('AI setup differs from recorded skirmish setup');
    }
    if(core.local!==local||!core.acceptsLocal)throw new Error('Install AI sources with localSource: controller.local');
    if(options.initialization.slots?.length!==undefined&&options.initialization.slots.length!==core.world.armyCount)throw new Error('AI setup army count mismatch');
    for(const source of ai)source.bind(core);
  },dispose(){for(const source of ai)source.dispose();},get status(){return ai.map(source=>source.status);},
    get samples(){return ai.map(source=>({army:source.army,samples:source.samples}));}};
}
