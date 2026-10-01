import type { SkirmishInitialization, SkirmishArmySetup } from '../../../../packages/protocol/src/index.ts';
import type { SimHost } from '../../../../packages/sim-host/src/index.ts';
export type Mode='scheduler'|'budget'|'determinism'|'inline';
export interface RunRequest {readonly mode:Mode;readonly replay?:readonly RecordedBatch[];readonly replayLog?:readonly number[];}
export interface RecordedBatch {readonly tick:number;readonly bytes:readonly number[];}
export interface QualificationResult {
  readonly mode:Mode;readonly route:'ai'|'recorded-commands';readonly tick:number;readonly target:number;
  readonly simBuild:string;readonly simHash:number;readonly mapName:string;readonly seed:number;
  readonly hardwareConcurrency:number;readonly policyOverride:number|null;readonly speed:number;
  readonly wallMs:number;readonly lostTicks:number;readonly error:string|null;
  readonly initialization:SkirmishInitialization;readonly unitsAfterSpawn:readonly number[];
  readonly ai:ReturnType<SimHost['aiDiagnostics']>;readonly tickUs:readonly number[];
  readonly commands:readonly RecordedBatch[];readonly hashes:readonly {tick:number;hash:number}[];
  readonly finalFullHash:number;readonly finalRuleHash:number;readonly log:readonly number[];
}
export const targetFor=(mode:Mode)=>mode==='determinism'?6000:mode==='scheduler'?3000:600;
export function initializationFor(mode:Mode,replay=false):SkirmishInitialization {
  return {kind:'skirmish',faction:0,slots:[0,1].map((army):SkirmishArmySetup=>({start:army,team:army,faction:0,
    controller:replay?'human':'ai',...(replay?{}:{difficulty:mode==='budget'?'hard':'normal'})})),
    rules:{unitCap:1000,fog:'explore',victory:'annihilation'}};
}
export function p95(values:readonly number[]):number {
  if(values.length===0)throw new Error('Missing native timing samples');
  const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.ceil(sorted.length*.95)-1]!;
}
