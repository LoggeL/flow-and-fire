import { UnitFlags } from '@faf/protocol';
import type { FrameReader } from '@faf/protocol';
import type { BindGroupH, Renderer, RenderView, RendererExtension, PassEncoder } from '@faf/render';
import { sunDirection } from '@faf/render';
import {
  BeamPass, BlobShadowPass, CameraShake, CascadedShadows, FX_DEFAULT_LIGHT, FxFrameUniforms,
  NullShadowReceiver, ParticleSystem, PostChain, ScorchGpu, TrailPass,
  SCORCH_GLSL, SCORCH_UNIFORM_BLOCKS, SHADOW_RECEIVE_GLSL, SHADOW_RECV_UNIFORM_BLOCKS,
  VARKAN_BEAM_STYLES, VARKAN_EFFECTS, VARKAN_TRAIL_STYLES,
  compileEffectLibrary, particleCapForPreset, postOptionsForPreset, shadowOptionsForPreset,
} from '@faf/render-fx';
import { SIM_TICK_HZ } from '@faf/rules';
import { FrameFxBridge } from './frames.ts';
export interface GameFxOptions {
  readonly renderer: Renderer;
  readonly getFrame: () => FrameReader | null;
  readonly weaponIds: readonly string[];
  readonly projectileIds: readonly string[];
  readonly groundHeightRaw: (xRaw: number, zRaw: number) => number;
}
export interface GameFxStats {
  frames: number; events: number; particles: number; particleCap: number; trails: number; beams: number;
  scorch: number; shadowDraws: number; transparentDraws: number; postDraws: number;
  emitters: number; cameraShake: boolean; bloom: boolean; antialias: 'off' | 'fxaa'; shadowCascades: number; shadowMode: 'none' | 'blob' | 'csm'; hdr: boolean; gpuMs: number | undefined; restores: number;
}
export interface GameFx { readonly stats: Readonly<GameFxStats>; setHudSetting(key: string, value: unknown): boolean; dispose(): void; }
/** Installs actual game FX into the renderer's RHI lifetime. Game owns the returned disposal. */
export function installGameFx(options: GameFxOptions): GameFx {
  const {renderer}=options;
  const settings: { cameraShake: boolean; bloom?: boolean; particleCap?: number; antialias?: 'off'|'fxaa'; shadowCascades?: 0|1|2 } = {cameraShake:true};
  let setSetting: (key:string,value:unknown)=>boolean=()=>false;
  const stats:GameFxStats={frames:0,events:0,particles:0,particleCap:0,trails:0,beams:0,scorch:0,shadowDraws:0,transparentDraws:0,postDraws:0,emitters:0,cameraShake:true,bloom:false,antialias:'fxaa',shadowCascades:0,shadowMode:'none',hdr:false,gpuMs:undefined,restores:0};
  const detach=renderer.installExtension(({device:dev,frameUbo})=>{
    const uniforms=new FxFrameUniforms(dev,{frameUbo});
    const library=compileEffectLibrary(VARKAN_EFFECTS);
    const shake=new CameraShake(); const posWu=new Float64Array(3);
    const particles=new ParticleSystem(dev,uniforms.bindings,library,{cap:particleCapForPreset(renderer.preset),onShake:(effect,pos,_time)=>{
      for(let c=0;c<3;c++)posWu[c]=pos[c]!/4096;
      if(settings.cameraShake)shake.addFromEffect(effect,posWu,now);
    }});
    const trails=new TrailPass(dev,uniforms.bindings);const beams=new BeamPass(dev,uniforms.bindings);
    const blobs=new BlobShadowPass(dev,frameUbo);
    const post=new PostChain(dev,postOptionsForPreset(renderer.preset));
    let shadows:CascadedShadows|NullShadowReceiver;
    let shadowGroup:BindGroupH|null=null;let scorch:ScorchGpu|null=null;
    let preset='';let terrain=renderer.terrain;let now=0;let previous=0;
    let camera:RenderView['camera']|null=null;let originalX=0;let originalY=0;let originalZ=0;
    let disposed=false;let settingsDirty=false;
    const emitters=new Map<number,number>(); const liveEmitters=new Set<number>();
    const touchEmitter=(key:number,effect:string,pos:Int32Array,target?:Int32Array)=>{
      let handle=emitters.get(key);
      if(handle===undefined){handle=particles.createEmitter(library.indexOf(effect),pos,{seed:key,...(target===undefined?{}:{targetRaw:target})});if(handle<0)return;emitters.set(key,handle);}
      particles.moveEmitter(handle,pos,target);liveEmitters.add(key);
    };
    const bridge=new FrameFxBridge(options.weaponIds,options.projectileIds,{
      reset:()=>{particles.clear();emitters.clear();liveEmitters.clear();shake.clear();scorch?.field.clear();},
      burst:(ids,pos,seed)=>{for(const id of ids)particles.spawn(library.indexOf(id),pos,{seed});stats.events++;},
      scorch:(pos,radius,crater,seed)=>{scorch?.field.add({xWu:pos[0]!/4096,zWu:pos[2]!/4096,radiusWu:radius,kind:crater?'crater':'scorch',seed,tS:now});},
      trail:(prev,cur,style)=>{trails.add(prev,cur,VARKAN_TRAIL_STYLES[style]);},
      beam:(from,to,handle)=>{beams.add(from,to,VARKAN_BEAM_STYLES.buildStream);touchEmitter(handle*4,'varkan:build_stream',from,to);},
      smoke:(handle,pos,wreck)=>{touchEmitter(handle*4+(wreck?2:1),wreck?'varkan:wreck_smolder':'varkan:smoke_damage',pos);},
    });
    const applySettings=()=>{
      const base=postOptionsForPreset(renderer.preset);
      const options={...base,bloom:settings.bloom??base.bloom,fxaa:settings.antialias===undefined?base.fxaa:settings.antialias==='fxaa'};
      post.setOptions(options);particles.setCap(settings.particleCap??particleCapForPreset(renderer.preset));
      stats.cameraShake=settings.cameraShake;stats.bloom=options.bloom;stats.antialias=options.fxaa?'fxaa':'off';
    };
    const configure=()=>{
      renderer.setOpaqueShader(null);
      if(shadowGroup!==null)dev.destroyBindGroup(shadowGroup);
      shadows?.destroy();scorch?.destroy();
      preset=renderer.preset.name;terrain=renderer.terrain;
      applySettings();
      const target=shadowOptionsForPreset(renderer.preset);
      const cascades=settings.shadowCascades;
      const csm=cascades===0?null:cascades===undefined?target.csm:{...(target.csm??{size:2048}),cascades};
      stats.shadowMode=cascades===0?'blob':csm===null?target.mode:'csm';
      stats.shadowCascades=csm?.cascades??0;
      shadows=csm===null?new NullShadowReceiver(dev):new CascadedShadows(dev,{...csm,worldMin:[0,-64,0],worldMax:[terrain?.sizeWu??4096,512,terrain?.sizeWu??4096]});
      const bindings=shadows.receiverBindings();
      scorch=terrain===null?null:new ScorchGpu(dev,terrain.sizeWu,renderer.preset.name);
      shadowGroup=dev.createBindGroup({label:'game.fx.opaque',buffers:[...bindings.buffers,...(scorch?.buffers??[])],
        textures:[...bindings.textures.map((binding,i)=>({...binding,unit:12+i})),...(scorch?.textures??[])]});
      renderer.setOpaqueShader({declarations:`${SHADOW_RECEIVE_GLSL}\nfloat renderSunVisibility(vec3 p,vec3 n){return fxShadow(p,n);}`,
        ...(scorch===null?{}:{terrainDeclarations:`${SCORCH_GLSL}\nvec3 renderGroundColor(vec3 c,vec3 p){vec4 s=fxScorch(p);return c*s.rgb+fxScorchGlow(s.a);}`}),
        uniformBlocks:[...SHADOW_RECV_UNIFORM_BLOCKS,...(scorch===null?[]:SCORCH_UNIFORM_BLOCKS)],
        samplers:[{name:'u_fxShadowStatic',unit:12},{name:'u_fxShadowDynamic',unit:13},...(scorch===null?[]:[{name:'u_fxScorchData',unit:14},{name:'u_fxScorchCells',unit:15}])],bindGroup:shadowGroup});
    };
    const restoreCamera=()=>{if(camera!==null){camera.targetX=originalX;camera.targetY=originalY;camera.targetZ=originalZ;camera.update();camera=null;}};
    setSetting=(key,value)=>{
      if(disposed)return false;
      switch(key){
        case 'cameraShake': if(typeof value!=='boolean')return false;settings.cameraShake=value;if(!value)shake.clear();break;
        case 'bloom': if(typeof value!=='boolean')return false;settings.bloom=value;break;
        case 'particleCap': if(typeof value!=='number'||!Number.isInteger(value)||value<1||value>particles.stats.capacity)return false;settings.particleCap=value;break;
        case 'antialias': if(value!=='off'&&value!=='fxaa')return false;settings.antialias=value;break;
        case 'shadowCascades': if(value!==0&&value!==1&&value!==2)return false;settings.shadowCascades=value;break;
        default:return false;
      }
      if(key==='shadowCascades')settingsDirty=true;else applySettings();return true;
    };
    configure();
    const offRestore=dev.onRestored(()=>{stats.restores++;});
    const extension:RendererExtension={
      prepare:(view,w,h)=>{
        restoreCamera();
        if(settingsDirty||preset!==renderer.preset.name||terrain!==renderer.terrain){configure();settingsDirty=false;}
        post.resize(w,h);trails.begin();beams.begin();blobs.begin();
        const frame=options.getFrame();
        now=frame===null?previous:(frame.tick+(frame.paused?0:view.alpha))/SIM_TICK_HZ;
        liveEmitters.clear();
        if(frame!==null){
          bridge.present(frame,view.alpha);
          if(stats.shadowMode==='blob')for(let i=0;i<frame.unitCount;i++){
            if((frame.unitFlags(i)&(UnitFlags.Ghost|UnitFlags.Blip|UnitFlags.Wreck))!==0)continue;
            const x=Math.round(frame.unitPrev(i,0)+(frame.unitCur(i,0)-frame.unitPrev(i,0))*view.alpha);
            const z=Math.round(frame.unitPrev(i,2)+(frame.unitCur(i,2)-frame.unitPrev(i,2))*view.alpha);
            const y=options.groundHeightRaw(x,z);
            if(frame.unitCur(i,1)-y>4096*4)continue;
            blobs.add(x,y,z,1.5);
          }
        }
        for(const [key,handle] of emitters)if(!liveEmitters.has(key)){particles.destroyEmitter(handle);emitters.delete(key);}
        particles.update(now,view.camera);
        camera=view.camera;originalX=camera.targetX;originalY=camera.targetY;originalZ=camera.targetZ;
        posWu[0]=originalX/4096;posWu[1]=originalY/4096;posWu[2]=originalZ/4096;
        const sample=shake.sample(now,posWu);
        camera.targetX+=sample.dx*4096;camera.targetY+=sample.dy*4096;camera.targetZ+=sample.dz*4096;
      },
      beforeScene:(view)=>{
        uniforms.update(view.camera,{timeS:now,dtS:Math.max(0,now-previous),alpha:view.alpha,viewport:[post.width,post.height]});
        previous=now;scorch?.update(now);beams.update(now);
        if(shadows instanceof CascadedShadows){
          const sun=terrain?.light===undefined?FX_DEFAULT_LIGHT.sunDir:sunDirection(terrain.light.azimuthDeg,terrain.light.elevationDeg);
          shadows.update(view.camera,sun);
          const cast=(enc:PassEncoder,_cascade:number,caster:Parameters<Renderer['drawOpaqueDepth']>[1])=>{const d=dev.counters.drawCalls;renderer.drawOpaqueDepth(enc,caster);return dev.counters.drawCalls-d;};
          stats.shadowDraws=shadows.renderStatic(cast)+shadows.renderDynamic(cast);
        }else stats.shadowDraws=0;
      },
      scenePass:(fallback)=>post.scenePass(fallback.clearColor??[0.52,0.6,0.68,1]),
      transparent:(encoder)=>{
        const start=dev.counters.drawCalls;
        blobs.encode(encoder);particles.encode(encoder);trails.encode(encoder);beams.encode(encoder);
        stats.transparentDraws=dev.counters.drawCalls-start;
      },
      afterScene:()=>{
        const start=dev.counters.drawCalls;post.resolve();stats.postDraws=dev.counters.drawCalls-start;
        stats.frames++;stats.particles=particles.stats.alive;stats.particleCap=particles.stats.cap;
        stats.trails=trails.stats.trails;stats.beams=beams.stats.beams;stats.scorch=scorch?.field.count??0;
        stats.emitters=particles.stats.emitters;stats.hdr=post.hdrActive;stats.gpuMs=dev.gpuTimeMs();restoreCamera();
      },
      dispose:()=>{
        if(disposed)return;disposed=true;restoreCamera();offRestore();
        particles.destroy();trails.destroy();beams.destroy();blobs.destroy();post.destroy();
        shadows.destroy();scorch?.destroy();if(shadowGroup!==null)dev.destroyBindGroup(shadowGroup);uniforms.destroy();
      },
    };
    return extension;
  });
  return {stats,setHudSetting:(key,value)=>setSetting(key,value),dispose:detach};
}
