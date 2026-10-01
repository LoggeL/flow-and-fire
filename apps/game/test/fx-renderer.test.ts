import { describe, expect, it } from 'vitest';
import { FrameReader, FrameSection, FrameWriter, EventType } from '@faf/protocol';
import { createRenderer, RtsCamera } from '@faf/render';
import type { RenderView, RenderPresetName } from '@faf/render';
import { FakeCanvas } from '../../../packages/render-fx/test/support/fake-gl.ts';
import { installGameFx } from '../src/fx/install.ts';
function setup(preset:RenderPresetName='high',hdr=true){
 const canvas=new FakeCanvas({colorBufferFloat:hdr,loseContext:true});
 const renderer=createRenderer(canvas,{preset,pixelRatio:1,terrain:{sizeWu:64,dim:65,heights:new Uint16Array(65*65),heightScaleRaw:32,waterLevelRaw:null}});
 renderer.setVisuals([{spec:{hull:'box',size:[2,3,2]},iconThreshold:0}]);
 const writer=new FrameWriter({units:2,parts:0,projectiles:1,beams:1,events:1,debugBytes:0});
 const bytes=new Uint8Array(writer.capacityBytes);writer.beginFrame(bytes,1,20,0,1000,0,0,0,0,0);
 writer.writeUnit(32*4096,0,32*4096,32*4096,0,32*4096,0,0,0,0,255,255,0,0,1,0,0);
 writer.writeUnit(35*4096,0,32*4096,35*4096,0,32*4096,0,0,0,0,255,255,0,0,2,0,0);
 writer.writeProjectile(32*4096,4096,32*4096,33*4096,4096,32*4096,0,0,0);
 writer.writeBeam(1,2,65535,0,0);writer.writeEvent(EventType.Impact,0,20,0,0,32*4096,0,32*4096,0,2);
 const frame=new FrameReader();frame.reset(bytes.subarray(0,writer.endFrame()));
 const camera=new RtsCamera({distance:45});camera.setTargetWU(32,0,32);
 const view:RenderView={camera,units:{bytes:frame.section(FrameSection.Units),count:frame.unitCount,version:1},alpha:.5,timeMs:2000};
 const fx=installGameFx({renderer,getFrame:()=>frame,weaponIds:['core:wpn_cannon_t1'],projectileIds:['core:prj_shell_light'],groundHeightRaw:()=>0});
 return{canvas,renderer,view,fx};
}
describe('game renderer FX extension, recorded WebGL2 RHI calls',()=>{
 it('draws real unit and terrain shadow geometry, filtered frame effects and HDR bloom into the existing renderer',()=>{
  const {renderer,view,fx,canvas}=setup();renderer.render(view);
  expect(fx.stats.shadowDraws).toBeGreaterThan(0);expect(fx.stats.transparentDraws).toBeGreaterThan(2);
  expect(fx.stats.trails).toBe(1);expect(fx.stats.beams).toBe(1);expect(fx.stats.scorch).toBe(1);expect(fx.stats.emitters).toBe(1);
  expect(fx.stats.postDraws).toBeGreaterThan(5);expect(fx.stats.hdr).toBe(true);
  expect(renderer.stats.drawCalls).toBeGreaterThan(fx.stats.postDraws+fx.stats.transparentDraws);
  const shaders=canvas.gl.named('shaderSource').map(c=>String(c.args[1]));
  expect(shaders.some(s=>s.includes('color = renderGroundColor'))).toBe(true);
  expect(shaders.some(s=>s.includes('renderSunVisibility((v_rel + u_camFrac.xyz), n)'))).toBe(true);
  fx.dispose();renderer.dispose();
 });
 it('uses actual medium blob shadows and falls back to LDR without float render targets',()=>{
  const {renderer,view,fx}=setup('medium',false);renderer.render(view);
  expect(fx.stats.shadowDraws).toBe(0);expect(fx.stats.hdr).toBe(false);
  expect(fx.stats.transparentDraws).toBeGreaterThan(3);expect(fx.stats.postDraws).toBeGreaterThan(0);
  fx.dispose();renderer.dispose();
 });
 it('restores device resources and cached shadow casters and detaches without destroying the renderer',()=>{
  const {renderer,view,fx,canvas}=setup();renderer.render(view);
  canvas.gl.lose();renderer.render(view);expect(renderer.stats.lost).toBe(true);
  canvas.gl.restore();renderer.render(view);expect(fx.stats.restores).toBe(1);
  expect(fx.stats.shadowDraws).toBeGreaterThan(0);expect(fx.stats.trails).toBe(1);
  const frames=fx.stats.frames;fx.dispose();fx.dispose();renderer.render(view);
  expect(fx.stats.frames).toBe(frames);expect(renderer.stats.lost).toBe(false);renderer.dispose();
 });
 it('applies real HUD FX settings, rejects unsupported values and preserves settings through restore',()=>{
  const {renderer,view,fx,canvas}=setup();
  expect(fx.setHudSetting('cameraShake',false)).toBe(true);
  expect(fx.setHudSetting('particleCap',14000)).toBe(true);
  expect(fx.setHudSetting('bloom',false)).toBe(true);expect(fx.setHudSetting('antialias','off')).toBe(true);
  expect(fx.setHudSetting('shadowCascades',1)).toBe(true);renderer.render(view);
  expect(fx.stats).toMatchObject({cameraShake:false,particleCap:14000,bloom:false,antialias:'off',shadowCascades:1,shadowMode:'csm',postDraws:1});
  expect(fx.setHudSetting('shadowCascades',3)).toBe(false);expect(fx.setHudSetting('antialias','msaa4')).toBe(false);
  expect(fx.setHudSetting('particleCap',NaN)).toBe(false);
  canvas.gl.lose();canvas.gl.restore();renderer.render(view);
  expect(fx.stats).toMatchObject({particleCap:14000,bloom:false,antialias:'off',shadowCascades:1,restores:1});
  expect(fx.setHudSetting('shadowCascades',0)).toBe(true);renderer.render(view);expect(fx.stats.shadowMode).toBe('blob');expect(fx.stats.shadowDraws).toBe(0);
  fx.dispose();expect(fx.setHudSetting('bloom',true)).toBe(false);renderer.dispose();
 });
 it('reconfigures real passes when the renderer preset changes and leaves the logical camera untouched',()=>{
  const {renderer,view,fx}=setup('low');const target=[view.camera.targetX,view.camera.targetY,view.camera.targetZ];
  renderer.render(view);expect(fx.stats.shadowDraws).toBe(0);expect(fx.stats.postDraws).toBe(2);
  renderer.setPreset('high');renderer.render(view);expect(fx.stats.shadowDraws).toBeGreaterThan(0);
  expect([view.camera.targetX,view.camera.targetY,view.camera.targetZ]).toEqual(target);
  renderer.dispose();fx.dispose();
 });
});
