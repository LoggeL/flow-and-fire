import { OrderKind, PerceptionWriter, type KnownUnit, type OwnUnit } from '@faf/ai';
import { UnitBits, canSeePosition, perceive, type PerceivedUnit, type World } from '@faf/sim';

const ORDER_KINDS:Readonly<Record<number,OwnUnit['order']>>={1:OrderKind.Move,3:OrderKind.Build,4:OrderKind.Attack,5:OrderKind.Assist,6:OrderKind.Patrol,7:OrderKind.AttackMove,8:OrderKind.Attack,9:OrderKind.Repair,10:OrderKind.Guard};
const MAX_GHOST_STRUCTURES=8192;

/** Only filtered observations and own bookkeeping leave this host-side adapter. */
export class GameAiPerception {
  private readonly writer=new PerceptionWriter();
  private readonly previous=new Map<number,{bp:number;hp:number;complete:boolean;damaged:number}>();
  private readonly structures=new Map<number,KnownUnit>();
  constructor(private readonly world:World,readonly army:number) {}

  snapshot():Uint8Array {
    const w=this.world,p=perceive(w,this.army),e=p.economy,write=this.writer.begin(p.tick,p.army);
    let upkeep=0;
    for(const u of p.ownUnits){const slot=w.units.resolve(u.handle);if(slot>=0&&w.units.col.ecoEnabled[slot]===1&&(u.flags&UnitBits.UnderConstruction)===0)upkeep+=w.bp.energyUpkeepMilliPerTickCol[u.bp]!;}
    write.setEco({massIncome:e.massIncome/100,energyIncome:e.energyIncome/100,energyUpkeep:upkeep/100,
      massStored:e.massStored/1000,energyStored:e.energyStored/1000,massCapacity:e.massCapacity/1000,energyCapacity:e.energyCapacity/1000,
      massDemand:e.massDemand/100,energyDemand:e.energyDemand/100,
      massRatio:e.massDemand===0?1:Math.min(1,e.massSpent/e.massDemand),energyRatio:e.energyDemand===0?1:Math.min(1,e.energySpent/e.energyDemand)});
    const current=new Set<number>();
    for(const u of p.ownUnits){
      current.add(u.handle);const last=this.previous.get(u.handle),complete=(u.flags&UnitBits.UnderConstruction)===0;
      const damaged=last!==undefined&&u.hp<last.hp?p.tick:last?.damaged??-1;
      if(last!==undefined&&u.hp<last.hp)write.addEvent({kind:'ownDamaged',tick:p.tick,unit:u.handle,attacker:0,attackerBp:-1,amount:last.hp-u.hp});
      if(complete&&last!==undefined&&!last.complete)write.addEvent({kind:'ownCompleted',tick:p.tick,unit:u.handle,bp:u.bp});
      this.previous.set(u.handle,{bp:u.bp,hp:u.hp,complete,damaged});
      write.addOwn(this.own(u,damaged));
    }
    for(const [handle,last] of this.previous)if(!current.has(handle)){write.addEvent({kind:'ownDestroyed',tick:p.tick,unit:handle,bp:last.bp});this.previous.delete(handle);}
    for(const u of p.knownAllies)write.addKnown({id:u.handle,army:u.army,kind:'visible',bp:u.bp,x:u.x/4096,z:u.z/4096,hpFrac:u.hp/u.maxHp,lastSeenTick:p.tick});
    const visible=new Set<number>();
    for(const u of p.visibleEnemies){
      visible.add(u.handle);const known:KnownUnit={id:u.handle,army:u.army,kind:'visible',bp:u.bp,x:u.x/4096,z:u.z/4096,hpFrac:u.hp/u.maxHp,lastSeenTick:p.tick};
      write.addKnown(known);
      if(this.isStructure(u.bp)){
        if(!this.structures.has(u.handle)&&this.structures.size===MAX_GHOST_STRUCTURES)this.structures.delete(this.structures.keys().next().value!);
        this.structures.set(u.handle,known);
      }
    }
    for(const [id,known] of this.structures)if(!visible.has(id)) {
      if(canSeePosition(w,this.army,Math.round(known.x*4096),Math.round(known.z*4096))) {
        this.structures.delete(id);write.addEvent({kind:'enemyDestroyed',tick:p.tick,id,army:known.army,bp:known.bp});
      } else write.addKnown({...known,kind:'ghost',hpFrac:1});
    }
    return write.finish();
  }
  private isStructure(bp:number):boolean {const names=this.world.bp.categoryNames,bit=names.indexOf('STRUCTURE');return bit>=0&&(this.world.bp.categoryWord(bp,bit>>>5)&(1<<(bit&31)))!==0;}
  private own(u:PerceivedUnit,damaged:number):OwnUnit {
    const order=u.orders[0];
    const factory=this.world.bp.categoryNames.indexOf('FACTORY');
    const isFactory=factory>=0&&(this.world.bp.categoryWord(u.bp,factory>>>5)&(1<<(factory&31)))!==0;
    return {handle:u.handle,bp:u.bp,x:u.x/4096,z:u.z/4096,hpFrac:u.hp/u.maxHp,buildFrac:u.buildDone/65536,
      complete:(u.flags&UnitBits.UnderConstruction)===0,order:order===undefined?OrderKind.Idle:ORDER_KINDS[order.kind]??OrderKind.Idle,
      orderTarget:order===undefined||order.target===0xffffffff?0:order.target,orderBp:order?.bp??-1,
      orderX:(order?.x??u.x)/4096,orderZ:(order?.z??u.z)/4096,queueLength:Math.max(0,u.orders.length-1)+(isFactory?Math.max(0,u.queue.length-(u.producingBp>=0?1:0)):0),
      factoryBp:isFactory?u.producingBp:-1,factoryProgress:isFactory?u.producingProgress/65536:0,
      factoryRepeat:isFactory&&u.factoryRepeat,upgradingTo:-1,lastDamagedTick:damaged};
  }
}
