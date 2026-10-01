import { PerceptionWriter, type AiStatic } from '@faf/ai';
import type { ArenaWorld } from '../world/index.ts';
export function buildArenaStatic(world:ArenaWorld,army:number,gameSeed=world.setup.seed):AiStatic{return {...world.staticFor(army),gameSeed};}
/** Byte snapshots contain only own economy, own events and visible/remembered enemies. */
export function writePerception(world:ArenaWorld,army:number,tick:number,writer:PerceptionWriter):Uint8Array {
  writer.begin(tick,army).setEco(world.economy.snapshot(army));
  for(const u of [...world.units.values()].sort((a,b)=>a.handle-b.handle))if(u.army===army)writer.addOwn(u);
  for(const k of [...(world.known.get(army)?.values()??[])].sort((a,b)=>a.id-b.id))writer.addKnown(k);
  for(const e of world.drainEvents(army))writer.addEvent(e);
  return writer.finish();
}
