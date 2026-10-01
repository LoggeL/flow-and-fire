import { describe, expect, it } from 'vitest';
import { EventType, FrameReader, FrameWriter, UnitFlags } from '@faf/protocol';
import { FrameFxBridge } from '../src/fx/frames.ts';
import type { FrameFxSink } from '../src/fx/frames.ts';
function frame(tick:number,viewer=0,flags=0):FrameReader {
 const writer=new FrameWriter({units:4,parts:0,projectiles:2,beams:2,events:4,debugBytes:0});
 const bytes=new Uint8Array(writer.capacityBytes);writer.beginFrame(bytes,tick,tick,0,1000,viewer,0,0,0,0);
 writer.writeUnit(0,0,0,4096,0,0,0,0,0,0,255,255,0,0,11,0,0);
 writer.writeUnit(4096,0,0,8192,0,0,0,0,0,0,255,255,0,flags,12,0,0);
 writer.writeBeam(11,12,65535,0,0);writer.writeBeam(11,999,65535,0,0);
 writer.writeProjectile(0,1,2,100,101,102,0,0,0);
 writer.writeEvent(EventType.Shot,1,tick,0,0,10,20,30,12,11);
 writer.writeEvent(EventType.Impact,0,tick,0,0,10,20,30,0,12);
 writer.writeEvent(EventType.UnitDeath,99,tick,0,4,10,20,30,2,99);
 const reader=new FrameReader();reader.reset(bytes.subarray(0,writer.endFrame()));return reader;
}
function setup(){
 const bursts:{ids:readonly string[];position:number[];seed:number}[]=[];
 const beams:number[][]=[];const trails:number[][]=[];const smoke:{handle:number;position:number[];wreck:boolean}[]=[];let resets=0;let scorches=0;
 const sink:FrameFxSink={reset:()=>{resets++;},burst:(ids,p,seed)=>{bursts.push({ids,position:[...p],seed});},
  scorch:()=>{scorches++;},trail:(p,c)=>{trails.push([...p,...c]);},beam:(p,c)=>{beams.push([...p,...c]);},smoke:(handle,p,wreck)=>{smoke.push({handle,position:[...p],wreck});}};
 const bridge=new FrameFxBridge(['core:wpn_arty_t1','core:wpn_mg_t1'],['core:prj_shell_light'],sink);
 return{bridge,bursts,beams,trails,smoke,get resets(){return resets;},get scorches(){return scorches;}};
}
describe('viewer-filtered game FX protocol',()=>{
 it('resolves lexical weapon/projectile indices and commander death independently of unit visual',()=>{
  const s=setup();s.bridge.present(frame(10),.5);
  expect(s.bursts.map(b=>b.ids[0])).toEqual(['varkan:muzzle_small','varkan:impact_ground_large','varkan:acu_explosion']);
  expect(s.bursts[0]!.position).toEqual([10,20,30]);expect(s.scorches).toBe(2);
  expect(s.trails).toEqual([[0,1,2,100,101,102]]);
  expect(s.beams).toEqual([[2048,0,0,6144,0,0]]);
 });
 it('does not repeat bursts when paused or rendering the same tick again, while keeping live trails',()=>{
  const s=setup();s.bridge.present(frame(10),1);s.bridge.present(frame(10),1);
  expect(s.bursts).toHaveLength(3);expect(s.trails).toHaveLength(2);
 });
 it('clears effects on rewind and viewer changes, with reproducible burst seeds',()=>{
  const s=setup();s.bridge.present(frame(10),1);const seed=s.bursts[0]!.seed;
  s.bridge.present(frame(11),1);s.bridge.present(frame(10),1);
  expect(s.resets).toBe(2);expect(s.bursts[6]!.seed).toBe(seed);
  s.bridge.present(frame(10,1),1);expect(s.resets).toBe(3);
 });
 it('uses actual damaged and wreck records for smoke, excluding fog ghosts',()=>{
  const s=setup();s.bridge.present(frame(10,0,UnitFlags.Damaged),.5);
  expect(s.smoke).toEqual([{handle:12,position:[6144,0,0],wreck:false}]);
  s.bridge.present(frame(11,0,UnitFlags.Wreck),1);expect(s.smoke[1]!.wreck).toBe(true);
  s.bridge.present(frame(12,0,UnitFlags.Ghost|UnitFlags.Damaged),1);expect(s.smoke).toHaveLength(2);
 });
 it.each([UnitFlags.Ghost,UnitFlags.Blip,UnitFlags.Wreck])('never constructs a beam to hidden or wreck handles (%i)',flags=>{
  const s=setup();s.bridge.present(frame(10,0,flags),1);expect(s.beams).toHaveLength(0);
 });
});
