import { AiCommandSource, bpTableFromRoster, createDefaultBrain, parseOpenings, PerceptionWriter, profileFor, SnapshotPerception, type AiBrain, type Difficulty, type ThinkResult } from '@faf/ai';
import { AiHost } from '@faf/ai/host';
import type { CommandEnvelope, CommandSource } from '@faf/protocol';
import { getArenaMap } from '../data/maps.ts';
import { loadRosterJson,loadOpeningsJson } from '../data/design.ts';
import { ArenaWorld } from '../world/index.ts';
import { buildArenaStatic,writePerception } from '../perception/index.ts';
import { runMatch, type MatchResult } from '../match/index.ts';
export interface Scenario {map:string;seed:number;until:number;sides?:readonly {army:number;profile:Difficulty;opening?:string;brain?:AiBrain;source?:CommandSource}[];spawns?:readonly {army:number;bp:string;x:number;z:number}[];cheats?:readonly {tick:number;apply:(world:ArenaWorld)=>void}[];commands?:readonly CommandEnvelope[];asserts?:readonly ((result:ScenarioResult)=>void)[];budgetScale?:number;}
export interface ScenarioResult extends MatchResult {brains:ReadonlyMap<number,AiBrain>;thinks:ReadonlyMap<number,readonly ThinkResult[]>;}
export function createScenario(s:Scenario):{world:ArenaWorld;brains:Map<number,AiBrain>;thinks:Map<number,ThinkResult[]>;sides:{army:number;source:CommandSource}[]} {
  const bps=bpTableFromRoster(loadRosterJson()),openings=parseOpenings(loadOpeningsJson());const world=ArenaWorld.create({map:getArenaMap(s.map),bps,seed:s.seed,armies:[{army:0,startIndex:0},{army:1,startIndex:1}]});
  for(const spawn of s.spawns??[])world.spawn(spawn.army,spawn.bp,spawn.x,spawn.z);world.updateVisibility();
  const brains=new Map<number,AiBrain>(),thinks=new Map<number,ThinkResult[]>();
  const sides=(s.sides??[{army:0,profile:'normal'},{army:1,profile:'normal'}]).map(side=>{
    if(side.source)return {army:side.army,source:side.source};const brain=side.brain??createDefaultBrain(),st=buildArenaStatic(world,side.army),writer=new PerceptionWriter();brain.init(st,profileFor(side.profile,openings),{openings,...(side.opening?{openingId:side.opening}:{})});brains.set(side.army,brain);const records:ThinkResult[]=[];const host=new AiHost(brain);thinks.set(side.army,records);
    return {army:side.army,source:new AiCommandSource({brain,...(s.budgetScale===undefined?{think:(view)=>host.think(view)}:{}),perceive:tick=>new SnapshotPerception(st,writePerception(world,side.army,tick,writer)),onThink:(_t,r)=>records.push(r),...(s.budgetScale===undefined?{}:{thinkOptions:{budgetScale:s.budgetScale}})})};
  });return {world,brains,thinks,sides};
}
export function runScenario(s:Scenario):ScenarioResult{
  const c=createScenario(s);const result=runMatch({world:c.world,sides:c.sides,maxTicks:s.until,onTick:w=>{for(const cheat of s.cheats??[])if(cheat.tick===w.tick)cheat.apply(w);w.apply((s.commands??[]).filter(c=>c.tick===w.tick));}});const out={...result,brains:c.brains,thinks:c.thinks};for(const assertion of s.asserts??[])assertion(out);return out;
}
