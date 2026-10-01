import { asArmyId, asTick, fx } from '../../../../packages/fixed/src/index.ts';
import { navClassOf } from '../../../../packages/nav/src/index.ts';
import { encodeBatch, encodeCheatSpawn, Op, type CommandEnvelope } from '../../../../packages/protocol/src/index.ts';
import { unitHandles, hasMatchEnded } from '../../../../packages/sim/src/index.ts';
import { isBlockedFor } from '../../../../packages/sim/src/terrain.ts';
import { startSimWorker, parseCommandLog, Metric, SIM_BUILD, type WorkerScopeLike } from '../../../../packages/sim-host/src/index.ts';
import { targetFor, initializationFor, type QualificationResult, type RunRequest } from './contract.ts';
import { installRecordedCommandSource } from './recorded-source.ts';

const scope=globalThis as unknown as WorkerScopeLike;
scope.addEventListener('message',event=>{
  const msg=(event as MessageEvent).data as {t?:string;request:RunRequest;simBin:ArrayBuffer;map:ArrayBuffer;frameCapacity:number};
  if(msg.t!=='qualification-run')return;
  const {request}=msg,target=targetFor(request.mode),replay=request.replay!==undefined;
  const initialization=initializationFor(request.mode,replay);
  const policyOverride=request.mode==='inline'?2:null;
  const host=startSimWorker(scope,{autoStart:false,opfs:null,statsWindow:8192,
    ...(policyOverride===null?{}:{ai:{hardwareConcurrency:policyOverride}})});
  const tickUs:number[]=[],unitsAfterSpawn:number[]=[];
  let done=false;
  const started=performance.now();
  function finish(error:string|null):void {
    if(done)return;done=true;host.scheduler.pause();
    const log=host.core.recorder!.export(host.tick),parsed=parseCommandLog(log);
    const result:QualificationResult={mode:request.mode,route:replay?'recorded-commands':'ai',tick:host.tick,target,
      simBuild:SIM_BUILD,simHash:host.core.world.bp.simHash>>>0,mapName:host.core.mapName,seed:7,
      hardwareConcurrency:navigator.hardwareConcurrency,policyOverride,speed:host.scheduler.speedFactor,
      wallMs:performance.now()-started,lostTicks:host.scheduler.lostTicks,error,initialization,unitsAfterSpawn,
      ai:host.aiDiagnostics(),tickUs,commands:parsed.commands.map(c=>({tick:c.tick,bytes:Array.from(parsed.bytes.subarray(c.offset,c.offset+c.length))})),
      hashes:host.core.hashTrail(),finalFullHash:host.core.fullHash(),finalRuleHash:host.core.ruleHash(),log:Array.from(new Uint8Array(log))};
    scope.postMessage({t:'qualification',result},[]);host.dispose();
  }
  try {
    host.init({t:'init',simBin:msg.simBin,map:msg.map,seed:7,armyCount:2,playerArmy:-1,transport:'transfer',frameCapacity:msg.frameCapacity,buildHash:'ai-qualification-ms6.1',persistentRecording:false,startPaused:true,initialization});
    if(replay){
      if(request.replayLog===undefined)throw new Error('Recorded replay requires the actual captured command log');
      installRecordedCommandSource(host.core,Uint8Array.from(request.replayLog),request.replay!,target);
    }
    if(request.mode==='budget'&&!replay){
      const w=host.core.world,bp=w.bp.indexOf('core:lnd_t1_tank'),cls=navClassOf(w.bp.sizeClassCol[bp]!);
      if(bp<0)throw new Error('Missing actual tank blueprint');
      const commands:CommandEnvelope[]=[];
      for(let army=0;army<2;army++){
        const start=host.core.map.meta.starts.find(s=>s.army===army)!;
        let count=0;
        // 300 individual real tanks per side on deterministic standable points, no overlap.
        for(let dz=-40;dz<=40&&count<300;dz+=4)for(let dx=-40;dx<=40&&count<300;dx+=4){
          if(dx*dx+dz*dz<36)continue;
          const x=fx(start.x/4096+dx),z=fx(start.z/4096+dz);
          if(isBlockedFor(w,w.bp.layerCol[bp]!,x,z,cls))continue;
          commands.push({tick:asTick(0),army:asArmyId(army),seq:count,op:Op.Cheat,flags:0,units:[],payload:encodeCheatSpawn({bp,army,count:1,x,z,spread:fx(0)})});count++;
        }
        if(count!==300)throw new Error(`Fixture has only ${count} standable tank positions for army ${army}`);
      }
      host.submit(encodeBatch(commands));
    }
    const advance=host.advance.bind(host);
    host.advance=()=>{
      if(done)return false;
      if(host.tick>=target){finish(null);return false;}
      try {
        const ran=advance();
        if(ran){
          tickUs.push(host.probe.lastUs[Metric.Tick]!);
          if(host.tick===1&&request.mode==='budget')for(let army=0;army<2;army++){
            const w=host.core.world,tank=w.bp.indexOf('core:lnd_t1_tank');
            unitsAfterSpawn.push(unitHandles(w,army).filter(h=>w.units.col.bp[w.units.resolve(h)]===tank).length);
          }
          if(host.tick===target)finish(null);
          else if(hasMatchEnded(host.core.world))finish('Match ended before required workload duration');
        }
        return ran;
      }catch(error){finish(error instanceof Error?error.message:String(error));return false;}
    };
    host.failed=error=>finish(error instanceof Error?error.message:String(error));
    host.ctl({t:'speed',speed:3});host.scheduler.start();host.ctl({t:'resume'});
  }catch(error){
    if(host.initialized)finish(error instanceof Error?error.message:String(error));
    else {scope.postMessage({t:'error',message:String(error)},[]);host.dispose();}
  }
});
