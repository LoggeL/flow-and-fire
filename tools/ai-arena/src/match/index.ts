import { asTick } from '@faf/fixed';
import type { CommandEnvelope, CommandSource } from '@faf/protocol';
import { ArenaWorld, type ArenaSetup } from '../world/index.ts';
export interface ArmyMetrics {army:number;t2Tick:number|null;fac1:number|null;eng1:number|null;eng4:number|null;mex4:number|null;mex8:number|null;idleEngineerPct:number;energyStallPct:number;energyStallTicks:number;observedEnergyTicks:number;overflowPct:number;firstCombatTick:number;apmMax:number;massInc:Record<string,number>;mexAt:Record<string,number>;produced:Record<string,number>;}
export interface MatchMetrics {endTick:number;winner:number|null;armies:ArmyMetrics[];waitTicks:number;}
export interface MatchResult {world:ArenaWorld;hash:number;log:CommandEnvelope[];metrics:MatchMetrics;}
export interface MatchOptions {world:ArenaWorld;sides:readonly {army:number;source:CommandSource}[];maxTicks:number;onTick?:(world:ArenaWorld)=>void;}
function armyMetrics(w:ArenaWorld,a:number):ArmyMetrics{
  const entries=w.completed.get(a)??[];const time=(category:string,count:number,tech?:number):number|null=>{const es=entries.filter(e=>{const b=w.setup.bps.list[e.bp]!;return b.categoryNames.includes(category)&&(tech===undefined||b.tech===tech);});return es[count-1]?.tick??null;};
  const ticks=w.commandTicks.get(a)??[];let start=0,max=0;for(let i=0;i<ticks.length;i++){while(ticks[start]!<=ticks[i]!-600)start++;max=Math.max(max,i-start+1);}
  const produced:Record<string,number>={};for(const e of entries){const b=w.setup.bps.list[e.bp]!;produced[b.id]=(produced[b.id]??0)+1;}
  return {army:a,t2Tick:time('FACTORY',1,2),fac1:time('FACTORY',1),eng1:time('ENGINEER',1,1),eng4:time('ENGINEER',4,1),mex4:time('MASSEXTRACTION',4,1),mex8:time('MASSEXTRACTION',8,1),idleEngineerPct:w.engineerTicks[a]!>0?w.idleEngineerTicks[a]!/w.engineerTicks[a]!*100:0,...w.economy.reportOf(a),firstCombatTick:w.firstCombatTick,energyStallTicks:w.economy.statsOf(a).energyStallTicks,observedEnergyTicks:w.economy.statsOf(a).ticks-w.economy.statsOf(a).exemptTicks,apmMax:max,massInc:{},mexAt:{},produced};
}
function finish(o:MatchOptions,log:CommandEnvelope[],waitTicks:number,samples:Map<number,{massInc:Record<string,number>;mexAt:Record<string,number>}>):MatchResult{
  const w=o.world;const remaining=w.static.activeArmies.filter(a=>!w.defeated.has(a));const armies=w.static.activeArmies.map(a=>({...armyMetrics(w,a),...samples.get(a)}));return {world:w,hash:w.hash(),log,metrics:{endTick:w.tick,winner:w.defeated.size>0&&remaining.length===1?remaining[0]!:null,armies,waitTicks}};
}
function sample(w:ArenaWorld,samples:Map<number,{massInc:Record<string,number>;mexAt:Record<string,number>}>):void {
  if(![1800,3000,4800,7200].includes(w.tick))return;for(const a of w.static.activeArmies){const e=samples.get(a)??{massInc:{},mexAt:{}};e.massInc[String(w.tick/10)]=w.economy.snapshot(a).massIncome;e.mexAt[String(w.tick/10)]=[...w.units.values()].filter(u=>u.army===a&&u.complete&&w.blueprint(u).categoryNames.includes('MASSEXTRACTION')).length;samples.set(a,e);}
}
function commandsFor(o:MatchOptions):CommandEnvelope[]{const commands:CommandEnvelope[]=[];for(const side of o.sides){const c=side.source.commandsFor(asTick(o.world.tick));if(c==='pending')throw new Error('Synchronous arena received pending; use runMatchAsync');commands.push(...c);}return commands.sort((a,b)=>a.army-b.army||a.seq-b.seq);}
export function runMatch(o:MatchOptions):MatchResult {const log:CommandEnvelope[]=[],samples=new Map();while(o.world.tick<o.maxTicks&&o.world.defeated.size===0){o.onTick?.(o.world);const c=commandsFor(o);log.push(...c);o.world.apply(c);o.world.step();sample(o.world,samples);}return finish(o,log,0,samples);}
export async function runMatchAsync(o:MatchOptions&{wait:()=>Promise<void>;beforeTick?:()=>Promise<void>}):Promise<MatchResult>{
  const log:CommandEnvelope[]=[],samples=new Map();let waitTicks=0;
  while(o.world.tick<o.maxTicks&&o.world.defeated.size===0){await o.beforeTick?.();o.onTick?.(o.world);const completed=new Map<number,readonly CommandEnvelope[]>();let waited=false;
    while(completed.size<o.sides.length){for(const side of o.sides){if(completed.has(side.army))continue;const c=side.source.commandsFor(asTick(o.world.tick));if(c!=='pending')completed.set(side.army,c);}if(completed.size<o.sides.length){waited=true;await o.wait();}}
    if(waited)waitTicks++;const c=[...completed.values()].flat().sort((a,b)=>a.army-b.army||a.seq-b.seq);log.push(...c);o.world.apply(c);o.world.step();sample(o.world,samples);
  }return finish(o,log,waitTicks,samples);
}
export function replayMatch(setup:ArenaSetup,log:readonly CommandEnvelope[],maxTicks:number):MatchResult{
  const byTick=new Map<number,CommandEnvelope[]>();for(const c of log){const list=byTick.get(c.tick)??[];list.push(c);byTick.set(c.tick,list);}
  return runMatch({world:ArenaWorld.create(setup),sides:[{army:0,source:{commandsFor:t=>byTick.get(t)??[]}}],maxTicks});
}
