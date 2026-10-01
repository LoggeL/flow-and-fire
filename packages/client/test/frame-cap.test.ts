import { describe, expect, it } from 'vitest';
import { GameClient } from '../src/client.ts';
import { FakeSimLink } from './support/fake-sim-link.ts';
import { Clock, FakeCanvas, FakeRenderer, FakeTarget } from './support/fakes.ts';
function setup(){
 const clock=new Clock(1000),canvas=new FakeCanvas(1280,720),renderer=new FakeRenderer(),link=new FakeSimLink({units:1,enemyUnits:0});
 const client=new GameClient({canvas,renderer,link,visuals:[{spec:{hull:'box',size:[1,1,1]}}],playerArmy:0,keyTarget:new FakeTarget(),now:clock.now,focusProbe:()=>null});
 const frame=(ms=1000/60)=>{clock.advance(ms);client.frame(clock.t);};
 return{clock,renderer,link,client,frame};
}
describe('GPU presentation cap without input/ACK throttling',()=>{
 it.each([[30,30],[60,60],[120,60],['monitor',60]] as const)('applies %s to60 RAFs when no new frame needs immediate presentation', (cap,expected)=>{
  const {client,renderer,frame}=setup();expect(client.setFrameCap(cap)).toBe(true);
  for(let i=0;i<60;i++)frame();expect(renderer.calls).toBe(expected);expect(client.frameCap).toBe(cap);
  expect(client.metrics.rafs).toBe(60);client.dispose();
 });
 it('renders command feedback in the next RAF even inside the cap interval',()=>{
  const {client,renderer,frame}=setup();client.setFrameCap(30);frame();frame(1);expect(renderer.calls).toBe(1);
  client.moveTo(220*4096,220*4096,[0]);frame(1);expect(renderer.calls).toBe(2);
  expect(client.metrics.snapshot().clickToMarkerFrames.p95).toBe(1);client.dispose();
 });
 it('polls and confirms the actual seq before the next capped presentation is due',()=>{
  const {client,renderer,link,frame}=setup();client.setFrameCap(30);frame();
  const seq=client.moveTo(220*4096,220*4096,[0]);frame(1);expect(client.commands.isPending(seq)).toBe(true);
  link.advance(100);frame(1);expect(client.commands.isPending(seq)).toBe(false);
  expect(client.metrics.snapshot().clickToAckMs.count).toBe(1);expect(renderer.calls).toBe(3);
  expect(client.frameCap).toBe(30);client.dispose();
 });
});
