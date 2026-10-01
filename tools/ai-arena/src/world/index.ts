import { makeHandle, xxHash32 } from '@faf/fixed';
import { CmdFlags, Op, type CommandEnvelope } from '@faf/protocol';
import { canPlaceKnown, createAiStatic, decodeAiPayload, MutableOwnUnit, OrderKind, placementContext, staticForArmy, type AiBlueprint, type AiBlueprintTable, type AiStatic, type KnownUnit, type PerceptionEvent, type RejectReason, type Vec2 } from '@faf/ai';
import { FlowEconomy, toMilli } from '../eco/flow.ts';
import type { ArenaMap } from '../data/maps.ts';
import { ArenaPaths } from './path.ts';
import { ArenaSpatial } from './spatial.ts';

export interface ArenaSetup { readonly map: ArenaMap; readonly bps: AiBlueprintTable; readonly seed: number; readonly armies: readonly {army:number;startIndex:number}[]; }
interface Order { kind: OrderKind; x: number; z: number; bp: number; target: number; rot: number; seq: number; }
export class ArenaUnit extends MutableOwnUnit {
  army=0; hp=1; orders: Order[]=[]; production:number[]=[]; repeat:number[]=[]; repeatIndex=0;
  rollOffUntil=0; rally:Vec2|null=null; path:readonly Vec2[]=[]; pathIndex=0; pathKey=''; upgradeProgress=0;
  bornTick=0; idleTicks=0;
}
interface Work { unit:ArenaUnit; bp:AiBlueprint; power:number; mode:'build'|'factory'|'upgrade'|'repair'; progress:number; }

/** Float arena, deliberately separate from the fixed-point game simulation. */
export class ArenaWorld {
  readonly setup:ArenaSetup; readonly static:AiStatic; readonly paths:ArenaPaths; readonly economy=new FlowEconomy(16);
  readonly units=new Map<number,ArenaUnit>(); readonly events=new Map<number,PerceptionEvent[]>(); readonly known=new Map<number,Map<number,KnownUnit>>();
  readonly defeated=new Set<number>(); readonly spatial=new ArenaSpatial<ArenaUnit>();
  readonly commandTicks=new Map<number,number[]>(); readonly completed=new Map<number,{tick:number;bp:number}[]>();
  readonly engineerTicks=new Float64Array(16); readonly idleEngineerTicks=new Float64Array(16);
  tick=0; firstCombatTick=-1;
  private nextSlot=1; private readonly free:number[]=[]; private readonly generations=new Map<number,number>();
  private readonly extraIncome=new Map<number,Vec2>(); private readonly extraDemand=new Map<number,Vec2>();
  private readonly placement; private readonly statics=new Map<number,AiStatic>();
  private static readonly terrain=new WeakMap<ArenaMap,AiStatic>();
  static create(setup:ArenaSetup):ArenaWorld{return new ArenaWorld(setup);}
  private constructor(setup:ArenaSetup){
    this.setup=setup;
    let terrain=ArenaWorld.terrain.get(setup.map);
    if(!terrain){terrain=createAiStatic({...setup.map,army:setup.armies[0]!.army,gameSeed:setup.seed,bps:setup.bps,coords:'wu',starts:setup.armies.map(a=>({...setup.map.starts[a.startIndex]!,army:a.army}))});ArenaWorld.terrain.set(setup.map,terrain);}
    const armyStart=new Array<number>(16).fill(-1);for(const a of setup.armies)armyStart[a.army]=a.startIndex;
    this.static={...terrain,bps:setup.bps,army:setup.armies[0]!.army,gameSeed:setup.seed,armyStart,starts:setup.map.starts,activeArmies:setup.armies.map(a=>a.army).sort((a,b)=>a-b),passLowRes:terrain.passLowRes.slice()};
    this.paths=new ArenaPaths(this.static);this.placement=placementContext(this.static);
    const acu=setup.bps.list.find(b=>b.categoryNames.includes('COMMAND'));if(!acu)throw new Error('Arena roster has no commander');
    for(const a of setup.armies){this.events.set(a.army,[]);this.known.set(a.army,new Map());this.commandTicks.set(a.army,[]);this.completed.set(a.army,[]);const p=setup.map.starts[a.startIndex];if(!p)throw new Error('Invalid startIndex');this.spawn(a.army,acu.id,p.x,p.z);this.economy.setCapacity(a.army,650,3900);this.economy.setStored(a.army,650,3900);}
    this.updateVisibility();
  }
  staticFor(army:number):AiStatic {let s=this.statics.get(army);if(!s){s=staticForArmy(this.static,army);this.statics.set(army,s);}return s;}
  blueprint(unit:ArenaUnit):AiBlueprint{return this.setup.bps.list[unit.bp]!;}
  spawn(army:number,bpId:string,x:number,z:number,opts:{complete?:boolean}={}):number {
    const b=this.setup.bps.byId(bpId);if(!b)throw new Error(`Unknown blueprint ${bpId}`);
    const slot=this.free.shift()??this.nextSlot++;if(slot>=0x100000)throw new Error('Arena unit slots exhausted');
    const gen=this.generations.get(slot)??1;const u=new ArenaUnit();u.handle=makeHandle(slot,gen);u.bp=b.index;u.army=army;u.x=x;u.z=z;u.orderX=x;u.orderZ=z;u.complete=opts.complete??true;u.buildFrac=u.complete?1:0;u.hp=u.complete?b.hpEff:1;u.hpFrac=u.hp/b.hpEff;u.bornTick=this.tick;
    this.units.set(u.handle,u);if(u.complete)this.noteCompleted(u);return u.handle;
  }
  private noteCompleted(u:ArenaUnit):void{this.completed.get(u.army)?.push({tick:this.tick,bp:u.bp});this.event(u.army,{kind:'ownCompleted',tick:this.tick,unit:u.handle,bp:u.bp});}
  event(army:number,event:PerceptionEvent):void{this.events.get(army)?.push(event);}
  drainEvents(army:number):readonly PerceptionEvent[]{const e=this.events.get(army)??[];this.events.set(army,[]);return e;}
  kill(handle:number):void {
    const u=this.units.get(handle);if(!u)return;const bp=this.blueprint(u);
    this.units.delete(handle);const slot=handle&0xfffff;this.generations.set(slot,(((handle>>>20)+1)&0xfff)||1);this.free.push(slot);
    this.event(u.army,{kind:'ownDestroyed',tick:this.tick,unit:handle,bp:u.bp});
    for(const [army,k] of this.known){if(k.get(handle)?.kind==='visible'){k.delete(handle);this.event(army,{kind:'enemyDestroyed',tick:this.tick,id:handle,army:u.army,bp:u.bp});}}
    if(bp.categoryNames.includes('COMMAND'))this.defeated.add(u.army);
    if(bp.energyPerSec>0||bp.storageEnergy>0)this.economy.exemptEnergyStallUntil(u.army,this.tick+600);
  }
  setStorage(army:number,mass:number,energy:number):void{this.economy.setStored(army,mass,energy);}
  addIncome(army:number,mass:number,energy:number):void{const p=this.extraIncome.get(army)??{x:0,z:0};this.extraIncome.set(army,{x:p.x+mass,z:p.z+energy});}
  addDemand(army:number,mass:number,energy:number):void{const p=this.extraDemand.get(army)??{x:0,z:0};this.extraDemand.set(army,{x:p.x+mass,z:p.z+energy});}
  blockCells(cells:readonly number[]):void{for(const c of cells)this.static.passLowRes[c]=0;this.paths.clear();}
  canPlace(bp:number,x:number,z:number,rot=0):boolean{return canPlaceKnown(this.placement,[...this.units.values()].filter(u=>this.blueprint(u).isStructure),bp,x,z,rot);}
  private reject(c:CommandEnvelope,reason:RejectReason,unit=0):void{this.event(c.army,{kind:'commandRejected',tick:this.tick,seq:c.seq,reason,unit});}
  apply(commands:readonly CommandEnvelope[]):void {
    const sorted=[...commands].sort((a,b)=>a.army-b.army||a.seq-b.seq);
    for(const c of sorted){
      let p;try{p=decodeAiPayload(c.op,c.payload);}catch{this.reject(c,'malformed');continue;}
      this.commandTicks.get(c.army)?.push(this.tick);
      for(const h of c.units){const u=this.units.get(h);if(!u){this.reject(c,'invalidUnit',h);continue;}if(u.army!==c.army){this.reject(c,'notOwner',h);continue;}
        const own=this.blueprint(u);const queue=(c.flags&CmdFlags.Queue)!==0;
        if(p.op==='stop'){u.orders=[];u.production=[];u.repeat=[];u.upgradingTo=-1;this.syncOrder(u);continue;}
        if(p.op==='factoryRepeat'||p.op==='factoryQueue'){
          const items=p.op==='factoryRepeat'?p.value.items:new Array<number>(p.value.count).fill(p.value.bp);
          if(!own.categoryNames.includes('FACTORY')||items.some(i=>!this.setup.bps.list[i]||!this.setup.bps.canBuild(own,this.setup.bps.list[i]!))){this.reject(c,'notBuildable',h);continue;}
          if(p.op==='factoryRepeat'){u.repeat=[...items];u.repeatIndex=0;u.factoryRepeat=items.length>0;}else{if(!queue){u.production=[];u.factoryBp=-1;u.factoryProgress=0;}u.production.push(...items);}continue;
        }
        if(p.op==='upgrade') {if(own.upgradesTo!==p.value){this.reject(c,'notBuildable',h);continue;}u.upgradingTo=p.value;u.upgradeProgress=0;u.orders=[];continue;}
        let order:Order={kind:OrderKind.Idle,x:u.x,z:u.z,bp:-1,target:0,rot:0,seq:c.seq};
        if(p.op==='build'){
          const b=this.setup.bps.list[p.value.bp];if(!b||!this.setup.bps.canBuild(own,b)){this.reject(c,'notBuildable',h);continue;}
          if(!this.canPlace(p.value.bp,p.value.x,p.value.z,p.value.rot)){this.reject(c,'placement',h);continue;}
          order={...order,kind:OrderKind.Build,...p.value};
        }else if(p.op==='position'){
          if(c.op===Op.SetRally){u.rally={x:p.value.x,z:p.value.z};continue;}
          order={...order,kind:c.op===Op.Move?OrderKind.Move:c.op===Op.Patrol?OrderKind.Patrol:OrderKind.AttackMove,x:p.value.x,z:p.value.z};
        }else if(p.op==='target'){
          const target=this.units.get(p.value);const hostile=c.op===Op.Attack||c.op===Op.Overcharge;if(!target||c.op===Op.Reclaim||(hostile?(target.army===u.army||!this.known.get(u.army)?.has(target.handle)):target.army!==u.army)){this.reject(c,'noTarget',h);continue;}
          if(c.op===Op.Overcharge){const e=this.economy.snapshot(u.army);if(!own.categoryNames.includes('COMMAND')||e.energyStored<7500||this.known.get(u.army)?.get(target.handle)?.kind!=='visible'||(target.x-u.x)*(target.x-u.x)+(target.z-u.z)*(target.z-u.z)>own.rangeMax*own.rangeMax){this.reject(c,'noEnergy',h);continue;}this.economy.setStored(u.army,e.massStored,e.energyStored-5000);this.damage(target,12000,u);continue;}
          order={...order,kind:c.op===Op.Attack?OrderKind.Attack:c.op===Op.Assist?OrderKind.Assist:c.op===Op.Guard?OrderKind.Guard:OrderKind.Repair,target:p.value,x:target.x,z:target.z};
        }
        if(!queue)u.orders=[];u.orders.push(order);u.pathKey='';this.syncOrder(u);
      }
    }
  }
  private syncOrder(u:ArenaUnit):void{const o=u.orders[0];u.order=o?.kind??OrderKind.Idle;u.orderTarget=o?.target??0;u.orderBp=o?.bp??-1;u.orderX=o?.x??u.x;u.orderZ=o?.z??u.z;u.queueLength=Math.max(0,u.orders.length-1)+u.production.length;}
  private finishOrder(u:ArenaUnit):void{u.orders.shift();u.pathKey='';this.syncOrder(u);}
  private range(u:ArenaUnit):number{const b=this.blueprint(u);return b.categoryNames.includes('COMMAND')?10:b.tech>=3?8:b.tech===2?7:6;}
  private move(u:ArenaUnit,x:number,z:number,stop=0):boolean {
    const dx=x-u.x,dz=z-u.z,d=Math.sqrt(dx*dx+dz*dz);if(d<=stop+0.01)return true;
    const b=this.blueprint(u);if(b.speed<=0)return false;
    const key=`${x}:${z}`;if(key!==u.pathKey){u.pathKey=key;u.pathIndex=0;u.path=b.layer==='air'?[{x,z}]:this.paths.path(u,{x,z});}
    let allowance=b.speed/10;
    while(allowance>0&&u.pathIndex<u.path.length){const p=u.path[u.pathIndex]!;const ax=p.x-u.x,az=p.z-u.z,dd=Math.sqrt(ax*ax+az*az);if(dd<=allowance){u.x=p.x;u.z=p.z;u.pathIndex++;allowance-=dd;}else{u.x+=ax/dd*allowance;u.z+=az/dd*allowance;allowance=0;}const ex=x-u.x,ez=z-u.z;if(ex*ex+ez*ez<=stop*stop)return true;}
    return false;
  }
  private damage(target:ArenaUnit,amount:number,attacker:ArenaUnit):void {
    if(!this.units.has(target.handle))return;target.hp-=amount;target.hpFrac=Math.max(0,target.hp/this.blueprint(target).hpEff);target.lastDamagedTick=this.tick;
    const visible=this.known.get(target.army)?.get(attacker.handle)?.kind==='visible';
    this.event(target.army,{kind:'ownDamaged',tick:this.tick,unit:target.handle,attacker:visible?attacker.handle:0,attackerBp:visible?attacker.bp:-1,amount});
    if(this.firstCombatTick<0)this.firstCombatTick=this.tick;if(target.hp<=0)this.kill(target.handle);
  }
  private target(u:ArenaUnit):ArenaUnit|undefined{
    const b=this.blueprint(u);let best:ArenaUnit|undefined;let distance=Infinity;
    this.spatial.query(u.x,u.z,b.rangeMax,t=>{if(t.army===u.army||!this.units.has(t.handle)||this.known.get(u.army)?.get(t.handle)?.kind!=='visible')return;const tb=this.blueprint(t);if((tb.layer==='air'?b.dpsAir:b.dpsSurface)<=0)return;const dx=t.x-u.x,dz=t.z-u.z,d=dx*dx+dz*dz;if(d<b.rangeMin*b.rangeMin)return;if(d<distance||(d===distance&&t.handle<(best?.handle??Infinity))){best=t;distance=d;}});return best;
  }
  step():void {
    const list=[...this.units.values()].sort((a,b)=>a.handle-b.handle);this.spatial.rebuild(list);
    const works=new Map<number,Work>();
    const addWork=(unit:ArenaUnit,bp:AiBlueprint,power:number,mode:Work['mode'],progress:number):void=>{const w=works.get(unit.handle);if(w)w.power+=power;else works.set(unit.handle,{unit,bp,power,mode,progress});};
    for(const u of list){if(!this.units.has(u.handle)||!u.complete)continue;const b=this.blueprint(u);
      if(u.upgradingTo>=0){addWork(u,this.setup.bps.list[u.upgradingTo]!,b.buildPower,'upgrade',u.upgradeProgress);continue;}
      if(b.categoryNames.includes('FACTORY')&&this.tick>=u.rollOffUntil){if(u.factoryBp<0){u.factoryBp=u.production.shift()??(u.repeat.length>0?u.repeat[u.repeatIndex++%u.repeat.length]!:-1);u.factoryProgress=0;}
        if(u.factoryBp>=0)addWork(u,this.setup.bps.list[u.factoryBp]!,b.buildPower,'factory',u.factoryProgress);}
      const o=u.orders[0];if(!o)continue;
      if(o.kind===OrderKind.Build){const target=this.units.get(o.target);if(target?.complete){this.finishOrder(u);continue;}
        if(!this.move(u,o.x,o.z,this.range(u)+Math.max(...this.setup.bps.list[o.bp]!.footprint)/2))continue;
        let site=target;
        if(!site){if(!this.canPlace(o.bp,o.x,o.z,o.rot)){this.event(u.army,{kind:'commandRejected',tick:this.tick,seq:o.seq,reason:'placement',unit:u.handle});this.finishOrder(u);continue;}const h=this.spawn(u.army,this.setup.bps.list[o.bp]!.id,o.x,o.z,{complete:false});o.target=h;site=this.units.get(h)!;this.syncOrder(u);}
        addWork(site,this.blueprint(site),b.buildPower,'build',site.buildFrac);
      }else if(o.kind===OrderKind.Move||o.kind===OrderKind.AttackMove||o.kind===OrderKind.Patrol){if(o.kind!==OrderKind.Move&&this.target(u))continue;if(this.move(u,o.x,o.z)){if(o.kind===OrderKind.Patrol){u.orders.push({...o,x:u.orderX===o.x?this.setup.map.starts[this.static.armyStart[u.army]!]!.x:u.orderX,z:this.setup.map.starts[this.static.armyStart[u.army]!]!.z});}this.finishOrder(u);}}
      else if(o.kind===OrderKind.Attack){const t=this.units.get(o.target),known=this.known.get(u.army)?.get(o.target);if(!t)this.finishOrder(u);else if(!known){if(this.move(u,o.x,o.z))this.finishOrder(u);}else {o.x=known.x;o.z=known.z;this.move(u,o.x,o.z,Math.max(1,b.rangeMax-1));}}
    }
    for(const u of list){if(!u.complete||!this.units.has(u.handle))continue;const o=u.orders[0];if(!o||![OrderKind.Assist,OrderKind.Guard,OrderKind.Repair].includes(o.kind as 5|6|7))continue;
      let t=this.units.get(o.target);if(!t){this.finishOrder(u);continue;}if(!this.move(u,t.x,t.z,this.range(u)+Math.max(...this.blueprint(t).footprint)/2))continue;
      if(t.order===OrderKind.Build)t=this.units.get(t.orderTarget)??t;
      if(o.kind===OrderKind.Repair){if(t.hpFrac>=1){this.finishOrder(u);continue;}addWork(t,this.blueprint(t),this.blueprint(u).buildPower,'repair',t.hpFrac);}
      else {const w=works.get(t.handle);if(w)w.power+=this.blueprint(u).buildPower;else if(!t.complete)addWork(t,this.blueprint(t),this.blueprint(u).buildPower,'build',t.buildFrac);else if(o.kind===OrderKind.Assist&&t.upgradingTo<0&&t.factoryBp<0)this.finishOrder(u);}
    }
    this.economy.beginTick();const capsM=new Float64Array(16).fill(650),capsE=new Float64Array(16).fill(3900);
    for(const u of list){if(!u.complete||!this.units.has(u.handle))continue;const b=this.blueprint(u);let energy=b.energyPerSec;
      if(energy>0&&!b.categoryNames.includes('COMMAND')){for(const t of list){if(t.army!==u.army||!t.complete||!this.blueprint(t).categoryNames.includes('ENERGYSTORAGE'))continue;const tb=this.blueprint(t);if(Math.abs(u.x-t.x)<=(b.footprint[0]+tb.footprint[0])/2+0.1&&Math.abs(u.z-t.z)<=(b.footprint[1]+tb.footprint[1])/2+0.1){energy*=1.25;break;}}}
      this.economy.addIncome(u.army,b.massPerSec,energy);this.economy.addUpkeep(u.army,b.upkeepEnergyPerSec);if(!b.categoryNames.includes('COMMAND')){capsM[u.army]!+=b.storageMass;capsE[u.army]!+=b.storageEnergy;}}
    for(const a of this.static.activeArmies){this.economy.setCapacity(a,capsM[a]!,capsE[a]!);const i=this.extraIncome.get(a);if(i)this.economy.addIncome(a,i.x,i.z);const d=this.extraDemand.get(a);if(d)this.economy.request(a,-a-1,d.x/10,d.z/10);}
    for(const w of works.values()){const delta=Math.min(1-w.progress,w.power/w.bp.buildTime/10);this.economy.request(w.unit.army,w.unit.handle,delta*w.bp.mass,delta*w.bp.energy,w.power);}
    this.economy.resolve();
    for(const a of this.extraDemand.keys())this.economy.chargeGranted(-a-1);
    for(const w of works.values()){
      const old=w.progress,done=Math.min(1,old+w.power/w.bp.buildTime/10*this.economy.ratio(w.unit.army));const u=w.unit;
      this.economy.chargeProgress(u.army,toMilli(w.bp.mass),toMilli(w.bp.energy),old,done);
      if(w.mode==='build'){u.buildFrac=done;u.hp=Math.max(u.hp,w.bp.hpEff*done);u.hpFrac=u.hp/w.bp.hpEff;if(done===1){u.complete=true;this.noteCompleted(u);}}
      else if(w.mode==='factory'){u.factoryProgress=done;if(done===1){const h=this.spawn(u.army,w.bp.id,u.x,u.z);const child=this.units.get(h)!;if(u.rally){child.orders=[{kind:OrderKind.Move,...u.rally,bp:-1,target:0,rot:0,seq:0}];this.syncOrder(child);}u.factoryBp=-1;u.factoryProgress=0;u.rollOffUntil=this.tick+20;}}
      else if(w.mode==='upgrade'){u.upgradeProgress=done;if(done===1){u.bp=w.bp.index;u.hp=w.bp.hpEff;u.hpFrac=1;u.upgradingTo=-1;this.noteCompleted(u);}}
      else{u.hp=w.bp.hpEff*done;u.hpFrac=done;}
    }
    this.economy.endTick();
    for(const u of list){if(!u.complete||!this.units.has(u.handle))continue;const b=this.blueprint(u);const t=this.target(u);if(t)this.damage(t,(this.blueprint(t).layer==='air'?b.dpsAir:b.dpsSurface)/10,u);
      this.syncOrder(u);if(b.categoryNames.includes('ENGINEER')&&!b.categoryNames.includes('COMMAND')){this.engineerTicks[u.army]!++;const o=u.orders[0];const idle=!o||((o.kind===OrderKind.Guard||o.kind===OrderKind.Assist)&&!works.has(o.target));u.idleTicks=idle?u.idleTicks+1:0;if(u.idleTicks>=20)this.idleEngineerTicks[u.army]!++;}}
    this.tick++;if(this.tick%2===0)this.updateVisibility();
  }
  updateVisibility():void {
    const list=[...this.units.values()].sort((a,b)=>a.handle-b.handle);this.spatial.rebuild(list);
    for(const army of this.static.activeArmies){const k=this.known.get(army)!;const seen=new Set<number>();
      for(const u of list){if(u.army!==army||!u.complete)continue;this.spatial.query(u.x,u.z,this.blueprint(u).vision,t=>{if(t.army!==army)seen.add(t.handle);});}
      for(const u of list){if(u.army===army)continue;if(seen.has(u.handle)){if(!k.has(u.handle))this.event(army,{kind:'enemySighted',tick:this.tick,id:u.handle,army:u.army,bp:u.bp});k.set(u.handle,{id:u.handle,army:u.army,kind:'visible',bp:u.bp,x:u.x,z:u.z,hpFrac:u.hpFrac,lastSeenTick:this.tick});}}
      for(const [id,e] of k){if(seen.has(id))continue;const b=this.setup.bps.list[e.bp]!;if(!b.isStructure){k.delete(id);continue;}
        let visibleEmpty=false;for(const u of list){if(u.army!==army||!u.complete)continue;const dx=u.x-e.x,dz=u.z-e.z;if(dx*dx+dz*dz<=this.blueprint(u).vision*this.blueprint(u).vision){visibleEmpty=true;break;}}
        if(visibleEmpty&&!this.units.has(id)){k.delete(id);this.event(army,{kind:'enemyDestroyed',tick:this.tick,id,army:e.army,bp:e.bp});}else k.set(id,{...e,kind:'ghost',hpFrac:1});}
    }
  }
  hash():number {
    const dump=JSON.stringify({tick:this.tick,units:[...this.units.values()].sort((a,b)=>a.handle-b.handle),eco:this.static.activeArmies.map(a=>this.economy.snapshot(a)),defeated:[...this.defeated],free:this.free,generations:[...this.generations],next:this.nextSlot});
    const bytes=new Uint8Array(dump.length*2);for(let i=0;i<dump.length;i++){const c=dump.charCodeAt(i);bytes[2*i]=c&255;bytes[2*i+1]=c>>>8;}return xxHash32(bytes,0,bytes.length,0);
  }
}
export * from './path.ts';
