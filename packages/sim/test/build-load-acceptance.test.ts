/** Original PLAN MS4/MS6 acceptance: real command, Orders, Economy and Construction phases. */
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { CmdFlags, encodeBuild, encodeFactoryQueue, encodeFactoryQueueEdit, encodeMove, encodeTarget, Op, type CommandEnvelope } from '@faf/protocol';
import { ECO_ONE } from '@faf/rules';
import { describe, expect, it } from 'vitest';
import { createWorld, queueLength, spawnUnit, step, UnitBits, type World } from '../src/index.ts';
import { gameTable, nextSeq } from './support/fixtures.ts';

const bp = gameTable();
const commanderBp = bp.indexOf('core:cmd_commander');
const factoryBp = bp.indexOf('core:fac_land_t1');
const engineerBp = bp.indexOf('core:eng_t1');
const pgenBp = bp.indexOf('core:str_t1_pgen');
const storageBp = bp.indexOf('core:str_t1_estorage');

function world(seed = 73, size = 64): World {
  return createWorld({ bpTable: bp, seed, armyCount: 1, mapSizeWu: size });
}
function command(w: World, unit: number, op: Op, payload: Uint8Array = new Uint8Array(0), flags = 0): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(0), seq: nextSeq(0), op, flags,
    units: [w.units.handle(unit) as Handle], payload };
}
function build(w: World, unit: number, target: number, x: number, z: number): CommandEnvelope {
  return command(w, unit, Op.Build, encodeBuild({ bp: target, yaw: 0, x: fx(x), z: fx(z) }));
}
// Explicit resource-rich test input. It changes no blueprint, progress, paid cost, order or phase.
function fund(w: World, builders = 1): void {
  w.armies.col.massStored.set(0, 650000 * builders);
  w.armies.col.energyStored.set(0, 3900000 * builders);
}
function fundedStep(w: World, commands?: readonly CommandEnvelope[]): void {
  fund(w);
  step(w, commands);
}
function completed(w: World, unit: number): boolean {
  return w.units.isLive(unit) && (w.units.col.flags[unit]! & UnitBits.UnderConstruction) === 0;
}
function expectExactCost(w: World, site: number): void {
  const U = w.units.col, id = U.bp[site]!;
  expect(U.buildDone.get(site)).toBe(ECO_ONE);
  expect(U.buildPaidMass.get(site)).toBe(bp.massCostCol[id]! * 1000);
  expect(U.buildPaidEnergy.get(site)).toBe(bp.energyCostCol[id]! * 1000);
  expect(U.hp[site]).toBe(bp.maxHpCol[id]);
}
function constructedFactory(w: World): number {
  const acu = spawnUnit(w, commanderBp, 0, fx(18.5), fx(20.5), 0);
  fund(w);
  step(w, [build(w, acu, factoryBp, 22.5, 20.5)]);
  const factory = w.units.resolve(w.units.col.buildTarget[acu]!);
  expect(factory).toBeGreaterThanOrEqual(0);
  for (let t = 0; t < 350 && !completed(w, factory); t++) fundedStep(w);
  expect(completed(w, factory)).toBe(true);
  expectExactCost(w, factory);
  expect(w.units.col.flags[factory]! & UnitBits.Footprint).not.toBe(0);
  return factory;
}
function receipt(value: Record<string, unknown>): void {
  console.info('build-load-acceptance', JSON.stringify(value));
}

describe('original construction and factory load acceptance', () => {
  it('consumes exact real costs in 10,000 completed builds with randomized resource stalls', () => {
    // Arena capacity is 8,192, so these are 100 actual sessions of 100 parallel construction
    // sites. Each session has its own seed, roster mix and random mass/energy bank schedule.
    // No cumulativeCost oracle is used: both the site's ledger and actual Army debits are read.
    let random = 0x51a11, count = 0, stalledBuilds = 0, totalTicks = 0, spentMass = 0, spentEnergy = 0;
    const next = (): number => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random; };
    for (let batch = 0; batch < 100; batch++) {
      const w = world(next(), 128), U = w.units.col, A = w.armies.col;
      const commands: CommandEnvelope[] = [], builders: number[] = [];
      for (let i = 0; i < 100; i++) {
        const target = [pgenBp, storageBp, factoryBp][next() % 3]!;
        const x = 10 + (i % 10) * 11 + (bp.footprintW(target) % 2) * 0.5;
        const z = 10 + Math.floor(i / 10) * 11 + (bp.footprintH(target) % 2) * 0.5;
        const builder = spawnUnit(w, commanderBp, 0, fx(x - 4), fx(z), 0);
        expect(builder).toBeGreaterThanOrEqual(0);
        builders.push(builder);
        commands.push(build(w, builder, target, x, z));
      }
      // Empty banks are an actual initial stall for every site, including the first tick's
      // real commander income. Later random shortages exercise cumulative fractional billing.
      step(w, commands);
      const sites = builders.map(builder => w.units.resolve(U.buildTarget[builder]!));
      expect(new Set(sites).size).toBe(100);
      const stalled = sites.map(site => { expect(site).toBeGreaterThanOrEqual(0); return U.ecoRatio[site]! < ECO_ONE; });
      let paidMass: number = A.massSpent.get(0), paidEnergy: number = A.energySpent.get(0);
      for (let t = 0; t < 96; t++) {
        const massRatio = next() % 65537, energyRatio = next() % 65537;
        A.massStored.set(0, Math.max(0, Math.floor(A.massDemand.get(0) * massRatio / ECO_ONE) - A.massIncome.get(0)));
        A.energyStored.set(0, Math.max(0, Math.floor(A.energyDemand.get(0) * energyRatio / ECO_ONE) - A.energyIncome.get(0)));
        step(w);
        paidMass += A.massSpent.get(0); paidEnergy += A.energySpent.get(0);
        expect(A.massStored.get(0)).toBeGreaterThanOrEqual(0);
        expect(A.energyStored.get(0)).toBeGreaterThanOrEqual(0);
        sites.forEach((site, i) => { stalled[i] ||= !completed(w, site) && U.ecoRatio[site]! < ECO_ONE; });
      }
      for (let t = 0; t < 350 && sites.some(site => !completed(w, site)); t++) {
        fund(w, 100); step(w);
        paidMass += A.massSpent.get(0); paidEnergy += A.energySpent.get(0);
      }
      let expectedMass = 0, expectedEnergy = 0;
      for (const site of sites) {
        expect(completed(w, site)).toBe(true);
        expectExactCost(w, site);
        expectedMass += bp.massCostCol[U.bp[site]!]! * 1000;
        expectedEnergy += bp.energyCostCol[U.bp[site]!]! * 1000;
      }
      expect(paidMass).toBe(expectedMass);
      expect(paidEnergy).toBe(expectedEnergy);
      expect(stalled.every(Boolean)).toBe(true);
      count += sites.length; stalledBuilds += stalled.filter(Boolean).length; totalTicks += w.tick;
      spentMass += paidMass; spentEnergy += paidEnergy;
    }
    expect(count).toBe(10000);
    expect(stalledBuilds).toBe(10000);
    receipt({ criterion: 'PLAN564', builds: count, stalledBuilds, sessions: 100, realTicks: totalTicks, spentMass, spentEnergy });
  }, 120000);

  it('one actual footprint-stamped factory rolls off 50 products using +1, Shift+5 and Repeat', () => {
    const w = world(), factory = constructedFactory(w), U = w.units.col;
    const products = new Set<number>(), active = new Set<number>();
    fundedStep(w, [
      command(w, factory, Op.SetRally, encodeMove({ x: fx(42), y: fx(0), z: fx(20) })),
      command(w, factory, Op.FactoryQueue, encodeFactoryQueue({ bp: engineerBp, count: 1 })),
      command(w, factory, Op.FactoryQueue, encodeFactoryQueue({ bp: engineerBp, count: 5 }), CmdFlags.Queue),
      command(w, factory, Op.FactoryRepeat, Uint8Array.of(1)),
    ]);
    expect(U.productionCount[factory]).toBe(6);
    const began = w.tick;
    for (let t = 0; t < 7000 && products.size < 50; t++) {
      const target = w.units.resolve(U.buildTarget[factory]!);
      if (target >= 0) active.add(target);
      fundedStep(w);
      for (const site of active) if (completed(w, site)) products.add(site);
      expect(U.productionCount[factory]).toBe(6);
    }
    expect(products.size).toBe(50);
    // Stop Repeat and clear only pending work through its real command contract. At this
    // completion boundary no 51st active product exists, so no product is killed or moved.
    fundedStep(w, [command(w, factory, Op.FactoryRepeat, Uint8Array.of(0)),
      command(w, factory, Op.FactoryQueueEdit, encodeFactoryQueueEdit({ action: 0, index: 0, bp: 0, count: 0 }))]);
    expect(U.productionCount[factory]).toBe(0);
    expect(U.buildTarget[factory]).toBe(0xffffffff);
    for (let t = 0; t < 240; t++) fundedStep(w);
    expect(w.units.liveCount).toBe(52); // real ACU, actual built factory, all fifty products
    for (const site of products) {
      expectExactCost(w, site);
      expect(U.bp[site]).toBe(engineerBp);
      // The actual Movement phase moved every product clear of the factory's 5WU footprint.
      expect(U.x[site]! / 4096).toBeGreaterThan(30);
      expect(Math.hypot(U.x[site]! / 4096 - 42, U.z[site]! / 4096 - 20)).toBeLessThan(8);
    }
    receipt({ criterion: 'PLAN623', factories: 1, products: products.size, productionTicks: w.tick - began - 241, queueCapacity: 32, repeat: true, rolloffChecked: products.size });
  }, 60000);

  it('Factory Guard retains its order and real BP across products, pause and an idle queue', () => {
    const w = world(), factory = constructedFactory(w), U = w.units.col;
    const helper = spawnUnit(w, engineerBp, 0, fx(26.5), fx(22.5), 0);
    fundedStep(w, [command(w, helper, Op.Guard, encodeTarget(w.units.handle(factory))),
      command(w, factory, Op.FactoryQueue, encodeFactoryQueue({ bp: engineerBp, count: 3 }))]);
    const guardHead = U.orderHead[helper]!, products = new Set<number>();
    const basePower = bp.buildPowerQ16PerTickCol[factoryBp]!, helperPower = bp.buildPowerQ16PerTickCol[engineerBp]!;
    let contributedTicks = 0;
    for (let t = 0; t < 500 && products.size < 3; t++) {
      const target = w.units.resolve(U.buildTarget[factory]!);
      fundedStep(w);
      expect(U.orderHead[helper]).toBe(guardHead);
      if (target >= 0 && w.frameFlowContributor[helper] === 1) {
        expect(w.frameFlowPower.get(target)).toBe(basePower + helperPower);
        contributedTicks++;
      }
      if (target >= 0 && completed(w, target)) products.add(target);
    }
    expect(products.size).toBe(3);
    expect(contributedTicks).toBeGreaterThan(250);
    for (let t = 0; t < 10; t++) { fundedStep(w); expect(U.orderHead[helper]).toBe(guardHead); }
    expect(U.productionCount[factory]).toBe(0);
    fundedStep(w, [command(w, factory, Op.FactoryQueue, encodeFactoryQueue({ bp: engineerBp, count: 1 }))]);
    fundedStep(w);
    const target = w.units.resolve(U.buildTarget[factory]!);
    expect(w.frameFlowPower.get(target)).toBe(basePower + helperPower);
    fundedStep(w, [command(w, helper, Op.TogglePause, Uint8Array.of(1))]);
    expect(w.frameFlowPower.get(target)).toBe(basePower);
    expect(U.orderHead[helper]).toBe(guardHead);
    fundedStep(w, [command(w, helper, Op.TogglePause, Uint8Array.of(0))]);
    expect(w.frameFlowPower.get(target)).toBe(basePower + helperPower);
    for (let t = 0; t < 150 && !completed(w, target); t++) fundedStep(w);
    expect(completed(w, target)).toBe(true);
    expectExactCost(w, target);
    expect(U.orderHead[helper]).toBe(guardHead);
    expect(queueLength(w, helper)).toBe(1);
    receipt({ criterion: 'PLAN625-Guard', products: 4, persistentGuardHead: guardHead, contributedTicks, basePower, helperPower });
  });

  it('real equal-power Assist halves measured construction time within one tick', () => {
    function session(assisted: boolean): number {
      const w = world(), U = w.units.col;
      spawnUnit(w, commanderBp, 0, fx(4), fx(4), 0);
      const primary = spawnUnit(w, engineerBp, 0, fx(12), fx(10), 0);
      const helper = spawnUnit(w, engineerBp, 0, fx(15), fx(12), 0);
      fund(w);
      step(w, [build(w, primary, pgenBp, 16, 10)]);
      const site = w.units.resolve(U.buildTarget[primary]!);
      expect(site).toBeGreaterThanOrEqual(0);
      const began = w.tick;
      if (assisted) fundedStep(w, [command(w, helper, Op.Assist, encodeTarget(w.units.handle(site)))]);
      for (let t = 0; t < 300 && !completed(w, site); t++) {
        fundedStep(w);
        expect(U.ecoRatio[site]).toBe(ECO_ONE);
        if (assisted) expect(w.frameFlowPower.get(site)).toBe(2 * bp.buildPowerQ16PerTickCol[engineerBp]!);
      }
      expect(completed(w, site)).toBe(true);
      expectExactCost(w, site);
      return w.tick - began + 1; // includes the initial, actually billed construction tick
    }
    const soloTicks = session(false), assistedTicks = session(true);
    expect(soloTicks).toBe(250); // compiled 125-tick work / compiled 0.5BP per tick
    expect(Math.abs(assistedTicks - soloTicks / 2)).toBeLessThanOrEqual(1);
    receipt({ criterion: 'PLAN625-Assist', soloTicks, assistedTicks, toleranceTicks: 1 });
  });
});
