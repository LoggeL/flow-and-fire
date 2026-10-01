import { describe,expect,it } from 'vitest';
import { asHandle } from '@faf/fixed';
import { Op } from '@faf/protocol';
import { profileFor,OrderKind,ThreatGrid,createBrain,defineManager,productionMix,engineerManager,economyManager,platoonManager,defenseManager,openingManager,techManager } from '../src/index.ts';
import { flatStatic,FakeWorld,runThinks } from '../src/testing/index.ts';
import { loadRoster,loadOpenings } from './support/fixtures.ts';
const bps=loadRoster(),doc=loadOpenings();
const by=(category:string,tech=1)=>bps.list.find(b=>b.tech===tech&&b.categoryNames.includes(category)&&(!['FACTORY','SCOUT'].includes(category)||b.categoryNames.includes('LAND')))!;
function fixture(managers= [platoonManager]){const st=flatStatic({bps,sizeWu:256,starts:[{x:40,z:40},{x:216,z:216}],spots:[{kind:'mass',x:50,z:40},{kind:'mass',x:40,z:50},{kind:'mass',x:30,z:40},{kind:'mass',x:40,z:30}]});const brain=createBrain({managers});brain.init(st,profileFor('normal',doc),{openings:doc,openingId:'eco_standard'});return {brain,world:new FakeWorld(st)};}
describe('manager behavioral contracts',()=>{
 it.each([[11,true],[10,false]])('AI-PLT-01: seven versus %i gives retreat %s', (enemies,retreat)=>{const {brain,world}=fixture(),bp=by('TANK');const units=Array.from({length:7},()=>world.addOwn(bp.id,100,100));for(let n=0;n<enemies;n++)world.addEnemy(bp.id,105,100);brain.blackboard.platoons.push({id:1,state:'attack',units,x:100,z:100,ratio:1,target:null,isFirstWave:false});const results=runThinks(brain,world,5);expect(results.some(r=>r.commands.some(c=>c.op===Op.Move))).toBe(retreat);expect(brain.blackboard.platoons[0]!.state).toBe(retreat?'retreat':'attack');});
 it('AI-PLT-01c: R=0.8 does not reenter',()=>{const {brain,world}=fixture(),bp=by('TANK'),units=Array.from({length:8},()=>world.addOwn(bp.id,100,100));for(let n=0;n<10;n++)world.addEnemy(bp.id,105,100);brain.blackboard.platoons.push({id:1,state:'retreat',units,x:100,z:100,ratio:1,target:null,isFirstWave:false});runThinks(brain,world,5);expect(brain.blackboard.platoons[0]!.state).toBe('retreat');});
 it('AI-PLT-04: commander cancels pursuit beyond its factory leash',()=>{const {brain,world}=fixture();const acu=bps.list.find(b=>b.categoryNames.includes('COMMAND'))!,bot=by('BOT');const h=world.addOwn(acu.id,40,40),enemy=world.addEnemy(bot.id,140,40);world.own(h).order=OrderKind.Attack;world.own(h).orderTarget=enemy;const result=runThinks(brain,world,3);expect(result.some(r=>r.commands.some(c=>c.units.includes(asHandle(h))&&c.op===Op.Move))).toBe(true);});
 it('AI-PLT-05: forced wave starts despite an unfavorable target ratio',()=>{const {brain,world}=fixture(),bp=by('TANK'),units=Array.from({length:8},()=>world.addOwn(bp.id,40,40));brain.blackboard.platoons.push({id:1,state:'staging',units,x:40,z:40,ratio:0.8,target:null,isFirstWave:true});world.tick=brain.opening!.followUp.waves.maxS*10;const result=runThinks(brain,world,1);expect(result[0]!.commands.some(c=>c.op===Op.AttackMove)).toBe(true);expect(brain.blackboard.telemetry.first('waveAttack')?.forced).toBe(true);});
 it('AI-DEF-03: passing scout alone does not request a turret',()=>{const {brain,world}=fixture([defenseManager]);world.tick=3000;for(const p of [[40,40],[50,40],[40,50]])world.addOwn(by('MASSEXTRACTION').id,p[0]!,p[1]!);world.addEnemy(by('SCOUT').id,45,45);runThinks(brain,world,5);expect(brain.blackboard.taskBoard.ordered()).toHaveLength(0);});
 it('AI-DEF-01: actual ground damage requests only one cluster turret',()=>{const {brain,world}=fixture([defenseManager]);world.tick=3000;world.setEco({massIncome:100});const mex=by('MASSEXTRACTION'),bot=by('BOT');const h=world.addOwn(mex.id,40,40);world.addOwn(mex.id,50,40);world.addOwn(mex.id,40,50);const attacker=world.addEnemy(bot.id,45,45);for(let i=0;i<2;i++){world.event({kind:'ownDamaged',tick:world.tick,unit:h,attacker,attackerBp:bot.index,amount:10});runThinks(brain,world,4);}expect(brain.blackboard.taskBoard.ordered().filter(t=>t.role==='pd')).toHaveLength(1);});
 it('AI-ECO-01: excess energy demand requests power on the next economy cycle',()=>{const {brain,world}=fixture([economyManager]);world.setEco({energyIncome:20,energyDemand:120,massRatio:1,energyStored:0});runThinks(brain,world,3);expect(brain.blackboard.taskBoard.ordered().some(t=>t.role==='pgen'&&t.prio===100)).toBe(true);});
 it('power loss promotes already queued plants despite a full inflight cap',()=>{
  const {brain,world}=fixture([economyManager]);world.tick=6000;world.setEco({energyIncome:20,energyDemand:200,massRatio:1,energyStored:0});
  const count=brain.opening!.followUp.energy.maxInflight;
  const tasks=Array.from({length:count},(_,i)=>brain.blackboard.taskBoard.add({kind:'build',role:'pgen',site:'slot:eco',prio:90,source:'economy',key:`old-power-${i}`},5500));
  runThinks(brain,world,1);
  expect(tasks.every(t=>t.prio===100)).toBe(true);
  expect(brain.blackboard.taskBoard.ordered().filter(t=>t.role==='pgen')).toHaveLength(count);
 });

 it('AI-OPEN-04: sustained six-bot base threat hands off to defense',()=>{const {brain,world}=fixture([openingManager]);world.tick=1200;world.addOwn(bps.list.find(b=>b.categoryNames.includes('COMMAND'))!.id,40,40);for(let n=0;n<6;n++)world.addEnemy(by('BOT').id,50+n,40);runThinks(brain,world,16);expect(brain.blackboard.opening.defenseMode).toBe(true);expect(brain.blackboard.taskBoard.ordered().some(t=>t.role==='pd')).toBe(true);});

 it('AI-ECO-02: prolonged mass overflow creates an additional factory sink',()=>{const {brain,world}=fixture([economyManager]);world.tick=6000;world.setEco({massIncome:30,massStored:650,massCapacity:650,energyIncome:100,energyDemand:0,energyStored:3900});world.addOwn(by('FACTORY').id,60,40);runThinks(brain,world,80);expect(brain.blackboard.taskBoard.ordered().some(t=>t.role==='fac_land')).toBe(true);expect(brain.blackboard.eco.reservedE).toBeGreaterThan(0);});
 it('AI-ECO-03: safe own-zone mex upgrades while contested mex is excluded',()=>{const {brain,world}=fixture([economyManager]);world.tick=6000;world.setEco({massIncome:30,energyIncome:200,energyDemand:0,energyStored:3900});brain.blackboard.tech.level=2;const mex=by('MASSEXTRACTION'),safe=world.addOwn(mex.id,50,40),contested=world.addOwn(mex.id,128,128);const result=runThinks(brain,world,1);const upgrades=result[0]!.commands.filter(c=>c.op===Op.Upgrade);expect(upgrades).toHaveLength(1);expect(upgrades[0]!.units).toContain(safe);expect(upgrades[0]!.units).not.toContain(contested);});
 it('AI-ECO-04/05: energy-free=100 starts at most one mex upgrade alongside tech',()=>{const {brain,world}=fixture([economyManager]);world.tick=6000;world.setEco({massIncome:30,massStored:650,energyIncome:100,energyDemand:0,energyStored:0});const mex=by('MASSEXTRACTION');for(const sp of world.static.spots)world.addOwn(mex.id,sp.x,sp.z);const fac=by('FACTORY');world.addOwn(fac.id,65,40,{upgradingTo:fac.upgradesTo});brain.blackboard.tech.upgrading=true;const result=runThinks(brain,world,1);expect(result[0]!.commands.filter(c=>c.op===Op.Upgrade)).toHaveLength(1);expect(brain.blackboard.eco.reservedE).toBeGreaterThanOrEqual(60);});
 it('tech assist survives the think that issues an upgrade before command lead',()=>{
  const {brain,world}=fixture([techManager,engineerManager]);world.tick=3900;world.setEco({massIncome:30,energyIncome:400,energyStored:3900});
  const fac=world.addOwn(by('FACTORY').id,60,40),eng=world.addOwn(by('ENGINEER').id,65,40);
  const result=runThinks(brain,world,1);
  expect(result[0]!.commands.some(c=>c.op===Op.Upgrade&&c.units.includes(asHandle(fac)))).toBe(true);
  expect(result[0]!.commands.some(c=>c.op===Op.Assist&&c.units.includes(asHandle(eng)))).toBe(true);
  expect(brain.blackboard.taskBoard.byKey('tech-assist')?.assigned).toContain(eng);
 });
 it('AI-FAC-01: observed bots select >=60% tank and >=25% artillery mass share',()=>{let mix:ReturnType<typeof productionMix>=[];const manager=defineManager('factory',()=>ctx=>{mix=productionMix(ctx,1);});const {brain,world}=fixture([manager]);for(let i=0;i<12;i++)world.addEnemy(by('BOT').id,100,100);runThinks(brain,world,3);expect(mix.find(e=>e.role==='tank')!.weight).toBeGreaterThanOrEqual(0.6);expect(mix.find(e=>e.role==='arty')!.weight).toBeGreaterThanOrEqual(0.25);});
 it('completed upgrade releases its assist task even when factory production has resumed',()=>{
  const {brain,world}=fixture([engineerManager]);world.tick=4000;world.setEco({energyIncome:400,energyStored:3900});
  const fac=world.addOwn(by('FACTORY',2).id,60,40,{factoryBp:by('ENGINEER').index});
  const eng=world.addOwn(by('ENGINEER').id,65,40,{order:OrderKind.Assist,orderTarget:fac});
  const task=brain.blackboard.taskBoard.add({kind:'assist',target:fac,bp:by('FACTORY',2).index,prio:80,source:'tech',key:'tech-assist'},3900);
  brain.blackboard.taskBoard.assign(task.id,eng);
  runThinks(brain,world,1);
  expect(brain.blackboard.taskBoard.byKey('tech-assist')).toBeUndefined();
  expect(brain.blackboard.taskBoard.tasksOf(eng)).toHaveLength(0);
 });
 it('obstructed fixed sites do not spend every builder budget and remain retriable next think',()=>{
  const {brain,world}=fixture([engineerManager]);world.tick=4000;world.setEco({energyIncome:10000,energyStored:39000});
  world.addOwn(by('FACTORY').id,70,40,{factoryBp:by('TANK').index});
  const engineers=Array.from({length:12},()=>world.addOwn(by('ENGINEER').id,65,40));
  const tasks=Array.from({length:4},(_,i)=>brain.blackboard.taskBoard.add({kind:'build',bp:by('FACTORY').index,site:{x:-100,z:-100},prio:90,source:'economy',key:`blocked-${i}`},3900));
  const first=runThinks(brain,world,1)[0]!;
  expect(first.commands.filter(c=>c.op===Op.Guard).flatMap(c=>c.units)).toEqual(engineers);
  expect(first.opsTotal).toBeLessThanOrEqual(brain.profile.budget.total);
  expect(tasks.every(t=>t.state==='open')).toBe(true);
  tasks[0]!.site={x:100,z:60};
  const later=runThinks(brain,world,4);
  expect(later.some(t=>t.commands.some(c=>c.op===Op.Build))).toBe(true);
 });
 it('underfunded builders reuse successful placement while leaving budget for cheap guards',()=>{
  const calls:number[]=[];
  const manager=defineManager('engineer',init=>{const inner=engineerManager.create(init);return ctx=>{
   const canPlace=ctx.view.canPlace.bind(ctx.view);let attempts=0;
   ctx.view.canPlace=(bp,x,z,rot)=>{attempts++;return attempts%24===0&&canPlace(bp,x,z,rot);};
   inner.think(ctx);calls.push(attempts);
  };});
  const {brain,world}=fixture([manager]);world.tick=4000;world.setEco({energyIncome:5,energyStored:1000});
  world.addOwn(by('FACTORY').id,70,40,{factoryBp:by('TANK').index});
  for(let i=0;i<12;i++)world.addOwn(by('ENGINEER').id,65,40);
  for(let i=0;i<4;i++)brain.blackboard.taskBoard.add({kind:'build',bp:by('FACTORY').index,site:{x:110,z:110},prio:90,source:'economy',key:`costly-${i}`},3900);
  const result=runThinks(brain,world,1)[0]!;
  expect(result.commands.some(c=>c.op===Op.Build)).toBe(false);
  expect(calls[0]).toBe(96);
  expect(result.commands.filter(c=>c.op===Op.Guard).length).toBeGreaterThan(3);
  expect(result.opsTotal).toBeLessThanOrEqual(brain.profile.budget.total);
 });
 it('successful same-think fixed-site builds reserve distinct footprints',()=>{
  const {brain,world}=fixture([engineerManager]);world.tick=4000;world.setEco({energyIncome:10000,energyStored:39000});
  for(let i=0;i<2;i++)world.addOwn(by('ENGINEER').id,65,40);
  for(let i=0;i<2;i++)brain.blackboard.taskBoard.add({kind:'build',bp:by('FACTORY').index,site:{x:100+i*4,z:100},prio:90,source:'economy',key:`same-${i}`},3900);
  const tasks=runThinks(brain,world,1)[0]!.commands.filter(c=>c.op===Op.Build);
  expect(tasks).toHaveLength(2);
  const sites=brain.blackboard.taskBoard.ordered().map(t=>t.site).filter((p):p is {x:number;z:number}=>typeof p==='object'&&p!==null);
  const footprint=by('FACTORY').footprint;
  expect(Math.abs(sites[0]!.x-sites[1]!.x)>=footprint[0]||Math.abs(sites[0]!.z-sites[1]!.z)>=footprint[1]).toBe(true);
 });
 it('emergency power recovers at a known safe own cluster when the template is invaded',()=>{
  const {brain,world}=fixture([engineerManager]);world.tick=6000;world.setEco({energyIncome:200,energyStored:3900});brain.blackboard.eco.emergency=true;
  world.addOwn(by('FACTORY').id,60,40);
  world.addOwn(by('ENGINEER').id,65,40);
  const unsafe={x:200,z:200},threat=new ThreatGrid(256);brain.blackboard.threat=threat;threat.surface[threat.index(unsafe.x,unsafe.z)]=100;
  const task=brain.blackboard.taskBoard.add({kind:'build',role:'pgen',site:unsafe,prio:100,source:'economy',key:'recover-power'},5900);
  const result=runThinks(brain,world,1)[0]!;
  expect(result.commands.some(c=>c.op===Op.Build)).toBe(true);
  expect(typeof task.site).toBe('object');
  const site=task.site as {x:number;z:number};
  expect(brain.blackboard.threat.threatAt('surface',site.x,site.z)).toBeLessThan(20);
  expect(Math.abs(site.x-60)).toBeLessThan(30);
 });
 it('recovery checks the final placement and keeps already active construction in place',()=>{
  const {brain,world}=fixture([engineerManager]);world.tick=6000;world.setEco({energyIncome:200,energyStored:3900});brain.blackboard.eco.emergency=true;
  const factory=by('FACTORY'),power=bps.list.find(b=>b.tech===1&&b.categoryNames.includes('ENERGYPRODUCTION')&&!b.categoryNames.includes('HYDROCARBON'))!;world.addOwn(factory.id,60,40);world.addOwn(by('ENGINEER').id,55,40);
  const unsafe={x:200,z:200},candidate={x:60+Math.max(...factory.footprint)/2+Math.max(...power.footprint)/2+2,z:40};
  const threat=new ThreatGrid(256);brain.blackboard.threat=threat;threat.surface[threat.index(unsafe.x,unsafe.z)]=100;
  threat.surface[threat.index(candidate.x,candidate.z)]=100;
  const task=brain.blackboard.taskBoard.add({kind:'build',role:'pgen',site:unsafe,prio:100,source:'economy'},5900);
  runThinks(brain,world,1);const site=task.site as {x:number;z:number};
  expect(brain.blackboard.threat.threatAt('surface',site.x,site.z)).toBeLessThan(20);
  const active=world.addOwn(power.id,200,200,{complete:false,buildFrac:0.4});
  const existing=brain.blackboard.taskBoard.add({kind:'build',role:'pgen',bp:power.index,site:unsafe,prio:100,source:'economy'},5900);existing.siteHandle=active;
  runThinks(brain,world,4);
  expect(existing.siteHandle).toBe(active);expect(existing.site).toEqual(unsafe);
 });
 it('an assigned assist with no active work can take a queued recovery task',()=>{
  const {brain,world}=fixture([engineerManager]);world.tick=6000;world.setEco({energyIncome:200,energyStored:3900});brain.blackboard.eco.emergency=true;
  const target=world.addOwn(by('FACTORY').id,60,40);
  const eng=world.addOwn(by('ENGINEER').id,65,40,{order:OrderKind.Assist,orderTarget:target});
  const old=brain.blackboard.taskBoard.add({kind:'build',role:'mex',site:{x:50,z:40},prio:50,source:'economy'},5900);brain.blackboard.taskBoard.assign(old.id,eng);
  const power=brain.blackboard.taskBoard.add({kind:'build',role:'pgen',site:{x:80,z:40},prio:100,source:'economy'},5950);
  const result=runThinks(brain,world,1)[0]!;
  expect(result.commands.some(c=>c.op===Op.Build&&c.units.includes(asHandle(eng)))).toBe(true);
  expect(power.assigned).toContain(eng);expect(old.assigned).toHaveLength(0);
 });
 it('destroyed own construction reopens the build request instead of assisting a stale handle',()=>{
  const {brain,world}=fixture([engineerManager]);world.tick=6000;world.setEco({energyIncome:200,energyStored:3900});
  const bp=bps.list.find(b=>b.tech===1&&b.categoryNames.includes('ENERGYPRODUCTION')&&!b.categoryNames.includes('HYDROCARBON'))!,site=world.addOwn(bp.id,80,40,{complete:false,buildFrac:0.4});
  const eng=world.addOwn(by('ENGINEER').id,65,40,{order:OrderKind.Assist,orderTarget:site});
  const task=brain.blackboard.taskBoard.add({kind:'build',role:'pgen',bp:bp.index,site:{x:80,z:40},prio:90,source:'economy'},5900);task.siteHandle=site;brain.blackboard.taskBoard.assign(task.id,eng);
  runThinks(brain,world,1);world.removeOwn(site);
  const result=runThinks(brain,world,1)[0]!;
  expect(task.siteHandle).toBe(0);
  expect(result.commands.some(c=>c.op===Op.Build&&c.units.includes(asHandle(eng)))).toBe(true);
  expect(result.commands.some(c=>c.op===Op.Assist)).toBe(false);
 });
 it('a past commander combat claim is released when local contacts need no combat action',()=>{
  const {brain,world}=fixture([platoonManager]);world.tick=6000;world.setEco({energyStored:0});
  const acu=bps.list.find(b=>b.categoryNames.includes('COMMAND'))!;
  const commander=world.addOwn(acu.id,40,40);world.addOwn(by('FACTORY').id,40,40);
  const enemies=[world.addEnemy(acu.id,90,40,{hpFrac:0.75}),world.addEnemy(acu.id,95,40,{hpFrac:0.75})];runThinks(brain,world,5);
  expect(brain.blackboard.enemy.current).toHaveLength(2);
  brain.blackboard.reservations.handoverAcu('opening','engineer',world.tick);brain.blackboard.reservations.claimAcu('platoon',world.tick,'local-defense');
  const result=runThinks(brain,world,1)[0]!;
  expect(result.commands.some(c=>c.op===Op.Attack||c.op===Op.Move)).toBe(false);
  expect(brain.blackboard.reservations.acuOwner).toBe('engineer');
  for(const id of enemies)world.enemy(id).hpFrac=0.25;
  const attack=runThinks(brain,world,4);
  expect(attack.some(r=>r.commands.some(c=>c.op===Op.Attack))).toBe(true);expect(brain.blackboard.reservations.acuOwner).toBe('platoon');
  world.own(commander).hpFrac=0.25;const retreat=runThinks(brain,world,1)[0]!;
  expect(retreat.commands.some(c=>c.op===Op.Move)).toBe(true);expect(brain.blackboard.reservations.acuOwner).toBe('platoon');
 });
 it('AI-INT-02: mobile threat halves in 13.5s; structure threat persists',()=>{const grid=new ThreatGrid(256),i=grid.index(40,40);grid.surface[i]=100;grid.structure[i]=25;grid.tick=135;expect(grid.threatAt('surface',40,40)).toBeGreaterThan(70);expect(grid.threatAt('surface',40,40)).toBeLessThan(80);});
 it('AI-OPEN-03: opening reserves all ring mex before engineer assignment',()=>{const {brain,world}=fixture([openingManager,engineerManager]);world.addOwn(bps.list.find(b=>b.categoryNames.includes('COMMAND'))!.id,40,40);const engineer=world.addOwn(by('ENGINEER').id,40,40);runThinks(brain,world,1);expect(brain.blackboard.reservations.reservedSpots()).toHaveLength(4);expect(brain.blackboard.reservations.unitOwner(engineer)).toBe('opening');});
});
