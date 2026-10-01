import type { WorkerResponse } from '@faf/ai/host';

/** Observation in the executing worker's clock domain, never network round-trip time. */
export type GameAiWorkerResult = Extract<WorkerResponse, {type:'result'}> & {readonly thinkMs:number};
export interface AiThinkSample {readonly tick:number;readonly thinkMs:number;readonly ops:number;readonly aborted:boolean;}
export interface AiBudgetSummary {
  readonly measured:number;readonly missingTiming:number;readonly dropped:number;
  readonly thinkP95Ms:number|null;readonly opsP99:number|null;readonly opsMax:number;
}

/** Fixed host-only observation storage; never enters World, commands, hashes or snapshots. */
export class AiBudgetMetrics {
  private readonly times:Float64Array;
  private readonly ops:Uint32Array;
  private readonly ticks:Uint32Array;
  private readonly aborts:Uint8Array;
  private readonly scratch:Float64Array;
  private count=0;
  private missing=0;
  private max=0;
  constructor(readonly capacity=8192) {
    this.times=new Float64Array(capacity);this.ops=new Uint32Array(capacity);
    this.ticks=new Uint32Array(capacity);this.aborts=new Uint8Array(capacity);this.scratch=new Float64Array(capacity);
  }
  record(result:Extract<WorkerResponse,{type:'result'}>):void {
    const ms=(result as Partial<GameAiWorkerResult>).thinkMs;
    if(ms===undefined||!Number.isFinite(ms)||ms<0){this.missing++;return;}
    const index=this.count%this.capacity;
    this.times[index]=ms;this.ops[index]=result.ops;this.ticks[index]=result.tick;this.aborts[index]=result.aborted?1:0;
    this.max=Math.max(this.max,result.ops);this.count++;
  }
  private quantile(values:Float64Array|Uint32Array,q:number):number|null {
    const n=Math.min(this.count,this.capacity);if(n===0)return null;
    for(let i=0;i<n;i++)this.scratch[i]=values[i]!;
    this.scratch.subarray(0,n).sort();return this.scratch[Math.ceil(q*n)-1]!;
  }
  summary():AiBudgetSummary {return {measured:this.count,missingTiming:this.missing,dropped:Math.max(0,this.count-this.capacity),
    thinkP95Ms:this.quantile(this.times,0.95),opsP99:this.quantile(this.ops,0.99),opsMax:this.max};}
  samples():AiThinkSample[] {
    const samples:AiThinkSample[]=[],start=Math.max(0,this.count-this.capacity);
    for(let n=start;n<this.count;n++){const i=n%this.capacity;samples.push({tick:this.ticks[i]!,thinkMs:this.times[i]!,ops:this.ops[i]!,aborted:this.aborts[i]===1});}
    return samples;
  }
}

/** Deduplicates repeated retries of one monotonic live simulation tick. */
export class AiWaitMetrics {
  private readonly ticks=new Uint32Array(8192);
  private last=-1;
  distinct=0;
  retries=0;
  monotonic=true;
  blocked(tick:number):void {
    this.retries++;
    if(tick===this.last)return;
    if(tick<this.last)this.monotonic=false;
    this.last=tick;
    if(this.distinct<this.ticks.length)this.ticks[this.distinct]=tick;
    this.distinct++;
  }
  ids():number[]{return Array.from(this.ticks.subarray(0,Math.min(this.distinct,this.ticks.length)));}
  get dropped():number{return Math.max(0,this.distinct-this.ticks.length);}
}
