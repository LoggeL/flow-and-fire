import { beforeAll, expect, test } from 'vitest';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints';
import { compileContent } from '@faf/blueprints/content';
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { CmdFlags, encodeFactoryQueue, encodeFactoryQueueEdit, encodeMove, encodeTogglePause,
  EventType, Op, type CommandEnvelope } from '@faf/protocol';
import { createWorld, initializeSkirmish, spawnUnit, step, UnitBits } from '../src/index.ts';
import { ORD_FORMATION, ORD_NEXT, ORDER_RECORD_WORDS } from '../src/schema.ts';

const COMMANDS = 1_000_000;
const PER_TICK = 64;
const TICKS = 15_625;
const SEED = 0x51a11;
let bp: SimBpTable;
beforeAll(async () => { bp = decodeSimBin((await compileContent({ includeTest: true })).simBin); });

interface ActiveProduct { handle: number; bp: number; repeatable: boolean }
interface FactoryModel { unit: number; queue: number[]; paused: boolean; repeat: boolean; active?: ActiveProduct }
type Intent =
  | { kind: 'replace' | 'append' | 'front'; factory: number; bp: number; count: number }
  | { kind: 'remove'; factory: number; index: number; count: number }
  | { kind: 'clear'; factory: number }
  | { kind: 'pause'; factory: number; value: boolean }
  | { kind: 'repeat'; factory: number; value: boolean }
  | { kind: 'ignored' };
interface Input { envelope: CommandEnvelope; intent: Intent; label: string }

/** Array semantics oracle, independent of production's slab/link implementation. */
function applyIntent(models: FactoryModel[], intent: Intent): void {
  if (intent.kind === 'ignored') return;
  const model = models[intent.factory]!;
  if (intent.kind === 'pause' || intent.kind === 'repeat') {
    if (intent.kind === 'pause') model.paused = intent.value;
    else model.repeat = intent.value;
    return;
  }
  if (intent.kind === 'clear' || intent.kind === 'replace') {
    model.queue = model.active === undefined ? [] : [model.active.bp];
    if (model.active !== undefined) model.active.repeatable = false;
    if (intent.kind === 'clear') return;
  }
  if (intent.kind === 'remove') {
    if (model.active !== undefined && intent.index === 0) return;
    model.queue.splice(intent.index, intent.count);
    return;
  }
  const additions = Array<number>(Math.min(intent.count, 32 - model.queue.length)).fill(intent.bp);
  if (intent.kind === 'front') model.queue.splice(model.active === undefined ? 0 : 1, 0, ...additions);
  else model.queue.push(...additions);
}

test('PLAN MS6 L5: one million actual command envelopes preserve queues and World invariants', () => {
  expect(PER_TICK * TICKS).toBe(COMMANDS);
  const w = createWorld({ bpTable: bp, seed: SEED, armyCount: 2, mapSizeWu: 128 });
  // Canonical game banks/income, supplied by actual skirmish initialization, not arena writes.
  initializeSkirmish(w, { kind: 'skirmish', faction: 0,
    rules: { unitCap: 8192, fog: 'revealed', victory: 'annihilation' } });
  const factoryBp = bp.indexOf('core:fac_land_t1'), engineerBp = bp.indexOf('core:eng_t1');
  const scoutBp = bp.indexOf('core:lnd_t1_scout');
  for (const id of [factoryBp, engineerBp, scoutBp]) expect(id).toBeGreaterThanOrEqual(0);
  expect(bp.canBuild(factoryBp, engineerBp)).toBe(true);
  expect(bp.canBuild(factoryBp, scoutBp)).toBe(true);
  // Completed setup entities are explicit fixture spawns; every production product is created by step.
  const factories = [spawnUnit(w, factoryBp, 0, fx(20.5), fx(20.5), 0),
    spawnUnit(w, factoryBp, 0, fx(20.5), fx(60.5), 0)];
  const helper = spawnUnit(w, engineerBp, 0, fx(10.5), fx(40.5), 0);
  for (const unit of [...factories, helper]) expect(unit).toBeGreaterThanOrEqual(0);
  const models: FactoryModel[] = factories.map(unit => ({ unit, queue: [], paused: false, repeat: false }));
  const U = w.units.col, A = w.armies.col;
  const produced = new Map<number, number>();
  const fqStamp = new Int32Array(w.factoryQueue.cap), orderStamp = new Int32Array(w.orders.cap);
  const formationRefs = new Int32Array(w.formations.cap);
  const sequences = [0, 0];
  const labels = new Map<string, number>();
  const recent: string[] = [];
  let random = SEED, checkedTick = 0, submitted = 0, completed = 0, repeated = 0, activeEdits = 0;
  let bankStalls = 0, generatedInvalidInputs = 0, sequenceWraps = 0;
  const next = (): number => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random; };
  const check = (condition: boolean, reason: string): void => {
    if (!condition) throw new Error(`queue fuzz seed=${SEED} tick=${checkedTick} submitted=${submitted}: ${reason}\n${recent.join('\n')}`);
  };
  const envelope = (unit: number, op: Op, payload: Uint8Array, flags = 0, army = 0, handle?: number): CommandEnvelope => {
    let seq = sequences[army]! + 1;
    if (seq > 65535) { seq = 1; sequenceWraps++; }
    sequences[army] = seq;
    return { tick: asTick(w.tick + 1), army: asArmyId(army), seq, op, flags,
      units: [handle ?? w.units.handle(unit)] as Handle[], payload };
  };
  const ignored = (envelope: CommandEnvelope, label: string): Input => ({ envelope, intent: { kind: 'ignored' }, label });
  const input = (tick: number, slot: number): Input => {
    // These setup commands are part of the counted million, rather than extra submissions.
    if (tick === 0 && slot < 2) return ignored(envelope(slot, Op.FireState, Uint8Array.of(0), 0, slot), 'setup-hold-fire');
    if (tick === 0 && slot < 4) {
      const fi = slot - 2;
      return ignored(envelope(factories[fi]!, Op.SetRally,
        encodeMove({ x: fx(46.5), y: fx(0), z: fx(fi === 0 ? 20.5 : 60.5) })), 'setup-rally');
    }
    const fi = next() >>> 31, factory = factories[fi]!;
    const product = (next() >>> 31) === 0 ? engineerBp : scoutBp;
    const count = 1 + ((next() >>> 8) % 32);
    // Uninterrupted production windows preserve real consumption/Repeat coverage amid edit fuzz.
    // All 64 envelopes are still submitted each tick; the World and prices are unchanged.
    const productionWindow = tick % 512 < 128;
    const kind = (next() >>> 8) % (productionWindow ? 8 : 20);
    if (kind === 0 || kind === 1) {
      const repeat = kind === 1, value = productionWindow ? repeat : (next() >>> 31) === 1;
      return { envelope: envelope(factory, repeat ? Op.FactoryRepeat : Op.TogglePause,
        repeat ? Uint8Array.of(Number(value)) : encodeTogglePause(value)),
        intent: { kind: repeat ? 'repeat' : 'pause', factory: fi, value }, label: repeat ? 'repeat' : 'pause' };
    }
    if (kind === 2 || (!productionWindow && kind === 3)) {
      const append = kind === 2;
      return { envelope: envelope(factory, Op.FactoryQueue, encodeFactoryQueue({ bp: product, count }), append ? CmdFlags.Queue : 0),
        intent: { kind: append ? 'append' : 'replace', factory: fi, bp: product, count }, label: append ? 'append' : 'replace' };
    }
    if (!productionWindow && kind === 4) return { envelope: envelope(factory, Op.FactoryQueueEdit,
      encodeFactoryQueueEdit({ action: 2, index: 0, bp: product, count })),
      intent: { kind: 'front', factory: fi, bp: product, count }, label: 'front' };
    if (!productionWindow && kind === 5) {
      const index = (next() >>> 8) % 32;
      return { envelope: envelope(factory, Op.FactoryQueueEdit, encodeFactoryQueueEdit({ action: 1, index, bp: 0, count })),
        intent: { kind: 'remove', factory: fi, index, count }, label: 'remove' };
    }
    if (!productionWindow && kind === 6) return { envelope: envelope(factory, Op.FactoryQueueEdit,
      encodeFactoryQueueEdit({ action: 0, index: 0, bp: 0, count: 0 })), intent: { kind: 'clear', factory: fi }, label: 'clear' };
    if ((!productionWindow && kind === 7) || (productionWindow && kind === 3)) return ignored(envelope(helper, Op.Move,
      encodeMove({ x: fx(4 + (next() >>> 8) % 112), y: fx(0), z: fx(4 + (next() >>> 8) % 112) }),
      (next() >>> 31) === 0 ? 0 : CmdFlags.Queue), 'move-order');
    if ((!productionWindow && kind === 8) || (productionWindow && kind === 4)) return ignored(envelope(helper, Op.Stop,
      new Uint8Array(0), (next() >>> 31) === 0 ? 0 : CmdFlags.Queue), 'stop-order');
    generatedInvalidInputs++;
    if (kind === 9 || (productionWindow && kind === 5)) return ignored(envelope(factory, Op.FactoryQueue,
      encodeFactoryQueue({ bp: product, count }), CmdFlags.Queue, 1), 'foreign-army');
    if (kind === 10 || (productionWindow && kind === 6)) return ignored(envelope(factory, Op.FactoryQueue,
      encodeFactoryQueue({ bp: product, count }), CmdFlags.Queue, 0, 0xffffffff), 'invalid-handle');
    if (kind === 11 || (productionWindow && kind === 7)) return ignored(envelope(factory, Op.FactoryQueue, new Uint8Array(3)), 'short-payload');
    if (kind === 12) return ignored(envelope(factory, Op.FactoryQueue, Uint8Array.of(255, 255, 1, 0)), 'invalid-bp');
    if (kind === 13) return ignored(envelope(factory, Op.FactoryQueue, Uint8Array.of(product & 255, product >>> 8, 33, 0)), 'invalid-count');
    if (kind === 14) return ignored(envelope(factory, Op.FactoryQueueEdit, Uint8Array.of(3, 0, 0, 0, 1, 0)), 'invalid-action');
    if (kind === 15) return ignored(envelope(factory, Op.FactoryQueueEdit, Uint8Array.of(1, 32, 0, 0, 1, 0)), 'invalid-index');
    if (kind === 16) return ignored(envelope(helper, Op.FactoryQueue, encodeFactoryQueue({ bp: product, count })), 'nonfactory');
    if (kind === 17) return ignored(envelope(factory, Op.FactoryQueue, encodeFactoryQueue({ bp: bp.indexOf('core:str_t1_pgen'), count })), 'stationary-product');
    if (kind === 18) return ignored(envelope(factory, Op.FactoryRepeat, Uint8Array.of(2)), 'invalid-repeat');
    return ignored(envelope(factory, Op.TogglePause, new Uint8Array(2)), 'invalid-pause-payload');
  };

  for (let tick = 0; tick < TICKS; tick++) {
    checkedTick = tick + 1;
    const inputs = Array.from({ length: PER_TICK }, (_, slot) => input(tick, slot));
    for (const entry of inputs) {
      if (entry.intent.kind !== 'ignored' && models[entry.intent.factory]!.active !== undefined &&
        ['replace', 'front', 'clear', 'remove'].includes(entry.intent.kind)) activeEdits++;
      applyIntent(models, entry.intent);
      labels.set(entry.label, (labels.get(entry.label) ?? 0) + 1);
    }
    recent.splice(0, recent.length, ...inputs.slice(-8).map(entry =>
      `${entry.envelope.army}:${entry.envelope.seq} ${entry.label} ${JSON.stringify(entry.intent)}`));
    const hadActive = models.map(model => model.active !== undefined);
    const beforeMass = [A.massStored.get(0), A.massStored.get(1)];
    const beforeEnergy = [A.energyStored.get(0), A.energyStored.get(1)];
    step(w, inputs.map(entry => entry.envelope));
    submitted += inputs.length;

    // Actual BuildComplete events drive the array oracle's consumption, never copied queue fields.
    const completedHandles = new Set<number>(), events = w.combatEvents.i32;
    for (let e = 0; e < events[0]!; e++) {
      const offset = 1 + e * 11; // CombatEvents schema used by intel.event and writeFrame.
      if (events[offset] === EventType.BuildComplete) completedHandles.add(events[offset + 9]! >>> 0);
    }
    for (let fi = 0; fi < models.length; fi++) {
      const model = models[fi]!, active = model.active;
      if (active !== undefined && completedHandles.delete(active.handle)) {
        check(!model.paused, 'paused factory emitted completion');
        check(model.queue[0] === active.bp, 'completion has wrong oracle head');
        const row = w.units.resolve(active.handle);
        check(row >= 0 && U.buildDone.get(row) === 65536 && (U.flags[row]! & UnitBits.UnderConstruction) === 0, 'completion event lacks completed unit');
        model.queue.shift(); completed++;
        if (model.repeat && active.repeatable) { model.queue.push(active.bp); repeated++; }
        delete model.active;
      }
      const actualHandle = U.buildTarget[model.unit]! >>> 0;
      if (!hadActive[fi] && !model.paused && model.queue.length > 0) {
        const row = w.units.resolve(actualHandle);
        check(row >= 0, 'eligible pending head did not start a real product');
        check(U.bp[row] === model.queue[0], 'new product differs from oracle head');
        check((U.flags[row]! & UnitBits.UnderConstruction) !== 0, 'new product skipped real progress');
        model.active = { handle: actualHandle, bp: model.queue[0]!, repeatable: true };
        produced.set(actualHandle, model.queue[0]!);
      }
      check(actualHandle === (model.active?.handle ?? 0xffffffff), 'active product handle mismatch');
      check(U.ecoPaused[model.unit] === Number(model.paused), 'Pause state mismatch');
      check(U.factoryRepeat[model.unit] === Number(model.repeat), 'Repeat state mismatch');
    }
    check(completedHandles.size === 0, 'unattributed completion event');

    // Every allocated queue/order record must belong to exactly one live unit chain.
    let factoryRecords = 0, orderRecords = 0;
    formationRefs.fill(0);
    for (const model of models) {
      const actual: number[] = []; let tail = -1;
      for (let q = U.productionHead[model.unit]!; q >= 0; q = w.factoryQueue.i32[q * 2 + 1]!) {
        check(q < w.factoryQueue.highWater && w.factoryQueue.isLive(q), 'factory chain points outside live slab');
        check(fqStamp[q] !== checkedTick, 'factory cycle or shared record'); fqStamp[q] = checkedTick;
        actual.push(w.factoryQueue.i32[q * 2]!); tail = q; factoryRecords++;
        check(actual.length <= 32, 'factory queue exceeds cap');
      }
      check(actual.length === model.queue.length && actual.every((id, i) => id === model.queue[i]), 'factory queue differs from independent oracle');
      check(U.productionCount[model.unit] === actual.length && U.productionTail[model.unit] === tail, 'factory count/tail mismatch');
    }
    for (let u = 0; u < w.units.highWater; u++) if (w.units.isLive(u)) {
      let count = 0, tail = -1;
      for (let q = U.orderHead[u]!; q >= 0; q = w.orders.i32[q * ORDER_RECORD_WORDS + ORD_NEXT]!) {
        check(q < w.orders.highWater && w.orders.isLive(q), 'order points outside live slab');
        check(orderStamp[q] !== checkedTick, 'order cycle or shared record'); orderStamp[q] = checkedTick;
        const formation = w.orders.i32[q * ORDER_RECORD_WORDS + ORD_FORMATION]!;
        if (formation >= 0) { check(w.formations.isLive(formation), 'order references dead formation'); formationRefs[formation] = formationRefs[formation]! + 1; }
        tail = q; count++; orderRecords++; check(count <= 32, 'order queue exceeds cap');
      }
      check(U.orderTail[u] === tail && w.movers.col.orders[U.mover[u]!] === count, 'order count/tail mismatch');
      check(U.hp[u]! > 0 && U.hp[u]! <= bp.maxHpCol[U.bp[u]!]!, 'HP outside blueprint bounds');
      check(U.x[u]! >= 0 && U.x[u]! <= w.mapMax && U.z[u]! >= 0 && U.z[u]! <= w.mapMax, 'unit outside map');
    }
    for (const [pool, stamp, owned] of [[w.factoryQueue, fqStamp, factoryRecords], [w.orders, orderStamp, orderRecords]] as const) {
      check(pool.liveCount === owned && pool.liveCount + pool.freeCount === pool.highWater, 'slab live/free accounting mismatch');
      for (let row = 0; row < pool.highWater; row++) check(pool.isLive(row) === (stamp[row] === checkedTick), 'orphan or wrongly freed slab record');
    }
    for (let f = 0; f < w.formations.highWater; f++) {
      check(w.formations.isLive(f) === (formationRefs[f]! > 0), 'orphan/dead formation');
      if (w.formations.isLive(f)) check(w.formations.col.refs[f] === formationRefs[f], 'formation reference count mismatch');
    }
    for (let army = 0; army < 2; army++) {
      const mass = A.massStored.get(army), energy = A.energyStored.get(army);
      check(mass >= 0 && energy >= 0, 'negative economy bank');
      check(mass === beforeMass[army]! + A.massIncome.get(army) - A.massSpent.get(army) - A.massOverflow.get(army), 'mass conservation mismatch');
      check(energy === beforeEnergy[army]! + A.energyIncome.get(army) - A.energySpent.get(army) - A.energyOverflow.get(army), 'energy conservation mismatch');
      check(mass <= A.massCapacity.get(army) && energy <= A.energyCapacity.get(army), 'bank exceeds capacity');
      if (A.massDemand.get(army) > A.massSpent.get(army) || A.energyDemand.get(army) > A.energySpent.get(army)) bankStalls++;
    }
    for (const [handle, id] of produced) {
      const row = w.units.resolve(handle); check(row >= 0, 'produced fixture unit disappeared');
      const done = U.buildDone.get(row); check(done >= 0 && done <= 65536, 'production progress outside bounds');
      check(U.buildPaidMass.get(row) === Math.floor(bp.massCostCol[id]! * 1000 * done / 65536), 'product mass ledger differs from unchanged price');
      check(U.buildPaidEnergy.get(row) === Math.floor(bp.energyCostCol[id]! * 1000 * done / 65536), 'product energy ledger differs from unchanged price');
    }
    check(w.projectiles.liveCount === 0, 'hold-fire fixture unexpectedly entered combat');
    check(w.stage.count === 0, 'command stage retained processed envelopes');
    for (let army = 0; army < 2; army++) check(A.lastAckSeq[army] === sequences[army], 'per-army acknowledgement mismatch');
  }
  expect(submitted).toBe(COMMANDS); expect(w.tick).toBe(TICKS);
  expect(generatedInvalidInputs).toBeGreaterThan(0); expect(sequenceWraps).toBeGreaterThan(0);
  expect(activeEdits).toBeGreaterThan(0); expect(completed).toBeGreaterThan(0); expect(repeated).toBeGreaterThan(0);
  expect(bankStalls).toBeGreaterThan(0);
  for (const label of ['append', 'replace', 'front', 'remove', 'clear', 'pause', 'repeat', 'move-order', 'stop-order',
    'foreign-army', 'invalid-handle', 'short-payload', 'invalid-bp', 'invalid-count', 'invalid-action', 'invalid-index',
    'nonfactory', 'stationary-product', 'invalid-repeat', 'invalid-pause-payload']) expect(labels.get(label) ?? 0, label).toBeGreaterThan(0);
  console.log(JSON.stringify({ criterion: 'PLAN629', seed: SEED, submitted, commandsPerTick: PER_TICK,
    actualTicks: w.tick, generatedInvalidInputs, sequenceWraps, activeEdits, startedProducts: produced.size, completed, repeated,
    bankStalls, labels: Object.fromEntries(labels) }));
}, 120_000);
