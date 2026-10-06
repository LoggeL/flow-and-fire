/**
 * Perception of one army in the arena (adapter boundary: from MS9 the sim's FrameWriter profile of
 * the own army writes the same snapshot bytes).
 *
 * Contents — nothing else (not cheating by construction, ai.md §1, A10):
 * - own units in slot order (all fields of `OwnUnit`),
 * - known enemies: currently visible units in slot order, then ghosts of enemy structures that are
 *   not visible right now (insertion order of the army's ghost memory); no radar/blips in the arena,
 * - own events since the previous call for this army (the queue is consumed),
 * - the own economy (FlowEconomy snapshot of the last resolved tick).
 */
import {
  MutableKnownUnit,
  MutableOwnUnit,
  OrderKind,
  PerceptionWriter,
  SnapshotPerception,
  type AiStatic,
  type EcoState,
  type PerceptionView,
} from '@faf/ai';
import type { ArenaUnit } from '../world/unit.ts';
import type { ArenaWorld } from '../world/world.ts';

const scratchOwn = new MutableOwnUnit();
const scratchKnown = new MutableKnownUnit();

function fillOwn(u: ArenaUnit, o: MutableOwnUnit): MutableOwnUnit {
  o.handle = u.handle;
  o.bp = u.bp.index;
  o.x = u.x;
  o.z = u.z;
  o.hpFrac = u.hpFrac;
  o.buildFrac = u.complete ? 1 : u.buildDone;
  o.complete = u.complete;
  o.order = OrderKind.Idle;
  o.orderTarget = 0;
  o.orderBp = -1;
  o.orderX = u.x;
  o.orderZ = u.z;
  o.queueLength = 0;
  o.factoryBp = u.prodBp;
  o.factoryProgress = u.prodBp >= 0 ? u.prodDone : 0;
  o.factoryRepeat = u.repeat.length > 0;
  o.upgradingTo = u.upgradeBp;
  o.lastDamagedTick = u.lastDamagedTick;
  if (u.info.isStructure) {
    if (u.upgradeBp >= 0) {
      o.order = OrderKind.Upgrade;
      o.orderBp = u.upgradeBp;
    }
    let q = 0;
    for (const c of u.queueCount) q += c;
    o.queueLength = q;
    return o;
  }
  const cur = u.orders[0];
  if (cur === undefined) return o;
  o.order = cur.kind;
  o.queueLength = u.orders.length - 1;
  switch (cur.kind) {
    case OrderKind.Move:
    case OrderKind.AttackMove:
    case OrderKind.Patrol:
      o.orderX = cur.x;
      o.orderZ = cur.z;
      break;
    case OrderKind.Build:
      o.orderX = cur.x;
      o.orderZ = cur.z;
      o.orderBp = cur.bp;
      o.orderTarget = cur.site;
      break;
    default:
      o.orderTarget = cur.target;
  }
  return o;
}

/** Own economy of an army as `EcoState`. */
export function arenaEcoState(world: ArenaWorld, army: number): EcoState {
  const s = world.eco.snapshot(army);
  return {
    massIncome: s.massIncome,
    energyIncome: s.energyIncome,
    energyUpkeep: s.energyUpkeep,
    massStored: s.massStored,
    energyStored: s.energyStored,
    massCapacity: s.massCapacity,
    energyCapacity: s.energyCapacity,
    massRatio: s.massRatio,
    energyRatio: s.energyRatio,
    massDemand: s.massDemand,
    energyDemand: s.energyDemand,
  };
}

/**
 * Writes the perception snapshot of `army` at `tick` (must equal `world.tick`) and consumes the
 * army's pending events. Returns the writer's view (valid until the writer's next `finish`).
 */
export function writePerception(world: ArenaWorld, army: number, tick: number, writer: PerceptionWriter): Uint8Array {
  if (tick !== world.tick) throw new Error(`writePerception: tick ${tick} != world tick ${world.tick}`);
  if (!world.isActive(army)) throw new RangeError(`writePerception: army ${army} is not active`);
  writer.begin(tick, army).setEco(arenaEcoState(world, army));
  for (const u of world.slots) {
    if (u === null || !u.alive || u.army !== army) continue;
    writer.addOwn(fillOwn(u, scratchOwn));
  }
  const bit = 1 << army;
  const k = scratchKnown;
  const seen = world.lastVisionTick < 0 ? 0 : world.lastVisionTick;
  for (const u of world.slots) {
    if (u === null || !u.alive || u.army === army || (u.seenMask & bit) === 0) continue;
    k.id = u.handle;
    k.army = u.army;
    k.kind = 'visible';
    k.bp = u.bp.index;
    k.x = u.x;
    k.z = u.z;
    k.hpFrac = u.hpFrac;
    k.lastSeenTick = seen;
    writer.addKnown(k);
  }
  for (const g of world.ghosts[army]!.values()) {
    const live = world.unit(g.handle);
    if (live !== null && (live.seenMask & bit) !== 0) continue;
    k.id = g.handle;
    k.army = g.army;
    k.kind = 'ghost';
    k.bp = g.bp;
    k.x = g.x;
    k.z = g.z;
    k.hpFrac = 1;
    k.lastSeenTick = g.lastSeen;
    writer.addKnown(k);
  }
  const q = world.events[army]!;
  for (const e of q) writer.addEvent(e);
  q.length = 0;
  return writer.finish();
}

const staticCache = new WeakMap<ArenaWorld, Map<string, AiStatic>>();

/**
 * AiStatic of `army` for this world: terrain, spots and passability of the map (same data as the
 * world), starts of the map, `armyStart`/`activeArmies` from the match setup.
 */
export function buildArenaStatic(world: ArenaWorld, army: number, gameSeed: number = world.seed): AiStatic {
  if (!world.isActive(army)) throw new RangeError(`buildArenaStatic: army ${army} is not active`);
  let m = staticCache.get(world);
  if (m === undefined) {
    m = new Map();
    staticCache.set(world, m);
  }
  const key = `${army}|${gameSeed >>> 0}`;
  let s = m.get(key);
  if (s === undefined) {
    s = { ...world.baseStatic, army, gameSeed: gameSeed >>> 0 };
    m.set(key, s);
  }
  return s;
}

/**
 * Perception source of one army: `perceive(tick)` returns a `PerceptionView` over a copy of the
 * snapshot bytes (safe to keep during a think); `bytes(tick)` returns the raw snapshot copy.
 */
export class ArenaPerceiver {
  readonly world: ArenaWorld;
  readonly army: number;
  readonly static: AiStatic;
  private readonly writer = new PerceptionWriter();

  constructor(world: ArenaWorld, army: number, gameSeed: number = world.seed) {
    this.world = world;
    this.army = army;
    this.static = buildArenaStatic(world, army, gameSeed);
  }

  bytes(tick: number): Uint8Array {
    return writePerception(this.world, this.army, tick, this.writer).slice();
  }

  perceive(tick: number): PerceptionView {
    return new SnapshotPerception(this.static, this.bytes(tick));
  }
}
