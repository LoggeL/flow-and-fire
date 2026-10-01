/** Shared deterministic MS3 burst workload; callers inject blueprint bytes and clock. */
import { asArmyId, asTick, fx, rng32, type Handle } from '@faf/fixed';
import { mapSimData } from '@faf/formats';
import { NAV_BUDGET_EXPANSIONS_PER_TICK, PATH_DIRECT, PATH_READY } from '@faf/nav';
import { encodeCheatSpawn, encodeMove, Op, type CommandEnvelope } from '@faf/protocol';
import { createWorld, step, unitHandles, unitInfo, PhaseId, type World, type PhaseProbe } from '@faf/sim';
import { navTestRtsMap } from '../maps.ts';
import { summarize, type Clock } from '../stats.ts';

/** Deterministic distant reachable endpoints with sufficient land clearance. */
export function endpoints(w: World, count = 200): { cls: number; sx: number; sz: number; tx: number; tz: number }[] {
  const out: { cls: number; sx: number; sz: number; tx: number; tz: number }[] = [];
  const size = w.mapSizeWu;
  for (let attempt = 0; out.length < count && attempt < 100000; attempt++) {
    const cls = 1 + out.length % 3;
    const x = 8 + rng32(73, attempt, 1, 1) % (size - 16);
    const z = 8 + rng32(73, attempt, 1, 2) % (size - 16);
    const tx = 8 + rng32(73, attempt, 1, 3) % (size - 16);
    const tz = 8 + rng32(73, attempt, 1, 4) % (size - 16);
    if (!w.nav.isPassable(cls, x, z) || !w.nav.isPassable(cls, tx, tz) || w.nav.componentAt(cls, x, z) !== w.nav.componentAt(cls, tx, tz)) continue;
    if (Math.hypot(tx - x, tz - z) < size / 3) continue;
    if (out.some((p) => Math.hypot(p.sx - x, p.sz - z) < 4)) continue;
    out.push({ cls, sx: x + 0.5, sz: z + 0.5, tx: tx + 0.5, tz: tz + 0.5 });
  }
  if (out.length !== count) throw new Error(`only ${out.length}/${count} endpoints`);
  return out;
}

export function requestBurst(size: 512 | 1024, simBin: Uint8Array, clock: Clock) {
  const generated = navTestRtsMap('bases', size, 73);
  const w = createWorld({ simBin, map: mapSimData(generated.map), seed: 73, armyCount: 2 });
  let sequence = 1;
  const envelope = (op: Op, units: readonly Handle[], payload: Uint8Array): CommandEnvelope => ({ tick: asTick(0), army: asArmyId(0), seq: (sequence++ % 65535) + 1, op, flags: 0, units, payload });
  const spawn = (bp: number, x: number, z: number): CommandEnvelope => envelope(Op.Cheat, [], encodeCheatSpawn({ bp, army: 0, count: 1, x: fx(x), z: fx(z), spread: fx(0) }));
  const move = (hs: readonly Handle[], x: number, z: number): CommandEnvelope => envelope(Op.Move, hs, encodeMove({ x: fx(x), y: fx(0), z: fx(z) }));
  for (const f of generated.nav.baseFootprints) w.nav.stampFootprint(f.x, f.z, f.w, f.h, 1);
  const req = endpoints(w);
  const blueprints = [w.bp.indexOf('core:lnd_t1_tank'), w.bp.indexOf('core:lnd_t2_tank'), w.bp.indexOf('core:lnd_t3_heavy')];
  step(w, req.map((p) => spawn(blueprints[p.cls - 1]!, p.sx, p.sz)));
  const hs = unitHandles(w);
  const ms: number[] = []; const expansions: number[] = [];
  let start = 0;
  const probe: PhaseProbe = { begin(p) { if (p === PhaseId.PathService) start = clock(); }, end(p) { if (p === PhaseId.PathService) ms.push(clock() - start); } };
  const before = w.nav.requestsIssued;
  const commands = hs.map((h, i) => move([h], req[i]!.tx, req[i]!.tz));
  let ticks = 0;
  do { step(w, ticks === 0 ? commands : null, probe); expansions.push(w.nav.expansionsLastTick); ticks++; } while (w.nav.pendingCount > 0 && ticks < 30);
  const ready = hs.filter((h) => { const p = unitInfo(w, h)!.path; return p >= 0 && [PATH_DIRECT, PATH_READY].includes(w.nav.pathState(p)); }).length;
  const requests = w.nav.requestsIssued - before;
  const groupBefore = w.nav.requestsIssued; step(w, [move(hs.slice(0, 50), req[0]!.tx, req[0]!.tz)]);
  const groupRequests50 = w.nav.requestsIssued - groupBefore;
  return { size, units: hs.length, ticks, ready, requests, groupRequests50, phaseMs: summarize(Float64Array.from(ms)), expansions: summarize(Float64Array.from(expansions)), budget: NAV_BUDGET_EXPANSIONS_PER_TICK };
}

export type RequestBurstResult = ReturnType<typeof requestBurst>;
/** Timing is optional, workload and request counts are always acceptance gates. */
export function requestBurstProblems(r: RequestBurstResult, perfGate = false): string[] {
  const errors: string[] = [];
  if (r.units !== 200 || r.ready !== 200 || r.requests !== 200 || r.groupRequests50 !== 1 || r.ticks > 10) errors.push(`burst ${r.size}: units=${r.units}, ready=${r.ready}, requests=${r.requests}, group=${r.groupRequests50}, ticks=${r.ticks}`);
  if (perfGate && r.phaseMs.p95 > 5) errors.push(`burst ${r.size}: PathService p95 ${r.phaseMs.p95} > 5 ms`);
  return errors;
}
