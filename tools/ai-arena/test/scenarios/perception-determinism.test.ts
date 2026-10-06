/**
 * Not cheating by construction, end to end (ai.md §1, §9): AI-PERC-01/02/03 through arena perception
 * → default brain → commands; and AI-DET-02 (halved budget, twice).
 */
import { describe, expect, it } from 'vitest';
import { Op } from '@faf/protocol';
import { createDefaultBrain, decodeAiPayload, PROFILES, type AiBrain, type EncodedCommand, type EngineerManager } from '@faf/ai';
import { runScenario, type ScenarioResult, type ScenarioRuntime, type SpawnSpec, type TimedHook } from '../../src/scenarios/index.ts';
import { dist, ID, sec } from './support.ts';

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function perceptionRun(seconds: number, spawns: SpawnSpec[], cheats: TimedHook[] = [], observe: TimedHook[] = []): ScenarioResult {
  return runScenario({
    map: 'setons',
    seed: 11,
    sides: [{ army: 0, ai: { openingId: 'eco_standard', recordPerception: true } }, { army: 1 }],
    spawns,
    cheats,
    observe,
    until: { seconds },
  });
}

describe('AI-PERC-01: an enemy unit in the fog next to the AI base', () => {
  it('perception bytes and command stream are identical with and without the hidden unit', () => {
    let seen = false;
    // Handles are allocated globally: run A spawns the same unit far behind the enemy base, run B next
    // to the AI base — both unseen, so the only difference is the position of a hidden unit.
    const hidden = (near: boolean): SpawnSpec => ({
      name: 'hidden',
      army: 1,
      unit: ID.tank,
      at: (rt) => (near ? rt.brain(0).analysis.toWorld(-60, 25) : rt.brain(0).analysis.toWorld(rt.brain(0).analysis.pathLengthWu + 40, 0)),
    });
    const quiet: TimedHook = { tick: 0, run: (rt) => rt.world.holdFire(rt.spawned('hidden')[0]!, true) };
    const watch: TimedHook = {
      every: 1,
      run: (rt) => {
        const u = rt.world.unit(rt.spawned('hidden')[0]!);
        if (u !== null && rt.world.sees(0, u)) seen = true;
      },
    };
    const a = perceptionRun(45, [hidden(false)], [quiet]);
    const b = perceptionRun(45, [hidden(true)], [quiet], [watch]);
    expect(seen, 'the unit stayed hidden').toBe(false);
    const pa = a.perception(0);
    const pb = b.perception(0);
    expect(pa.length).toBe(sec(45) / 5);
    expect(pb.length).toBe(pa.length);
    for (let i = 0; i < pa.length; i++) expect(equalBytes(pa[i]!, pb[i]!), `snapshot ${i}`).toBe(true);
    expect(b.streamKey(0)).toBe(a.streamKey(0));
  });
});

describe('AI-PERC-02: enemy Zapfstelle in the fog on an own expansion spot', () => {
  it('freeMassSpots/canPlace see nothing until sighted; the engineer walks there, sees it, re-plans in the next think', () => {
    // Pass 1 (no enemy mex): the first outer spot an engineer is sent to.
    let spot = -1;
    const a = runScenario({
      map: 'setons',
      seed: 11,
      sides: [
        {
          army: 0,
          ai: {
            openingId: 'eco_standard',
            recordPerception: true,
            onThink: (_t, res) => {
              if (spot >= 0) return;
              for (const c of res.commands) {
                if (c.op !== Op.Build) continue;
                const d = decodeAiPayload(c.op, c.payload);
                if (d.op !== 'build') continue;
                const i = spotIndexAt(d.value.x, d.value.z);
                if (i >= 0 && !ringSpots.includes(i) && commanderHandle !== c.units[0]) spot = i;
              }
            },
          },
        },
        { army: 1 },
      ],
      // A far, unseen dummy keeps the global handle allocation equal to pass 2.
      spawns: [{ name: 'mex', army: 1, unit: ID.mex, at: (rt) => farPoint(rt) }],
      observe: [
        {
          // Observers run after the step (first call: tick 1); engineers get their first orders at ~47 s.
          tick: 1,
          run: (rt) => {
            ringSpots = [...rt.brain(0).analysis.ringSpots];
            commanderHandle = rt.world.commander(0)!.handle;
            spotsOf = rt.world.baseStatic.spots;
          },
        },
      ],
      until: { seconds: 110 },
    });
    expect(spot, 'an engineer went to an outer spot').toBeGreaterThanOrEqual(0);
    // Pass 2: an enemy Zapfstelle stands on that spot from the start (in the fog).
    let sighted = -1;
    let replanned = -1;
    const b = runScenario({
      map: 'setons',
      seed: 11,
      sides: [{ army: 0, ai: { openingId: 'eco_standard', recordPerception: true } }, { army: 1 }],
      spawns: [{ name: 'mex', army: 1, unit: ID.mex, at: { x: spotsOf[spot]!.x, z: spotsOf[spot]!.z } }],
      observe: [
        {
          every: 1,
          run: (rt, t) => {
            const u = rt.world.unit(rt.spawned('mex')[0]!)!;
            if (sighted < 0 && rt.world.sees(0, u)) sighted = t;
            if (sighted < 0 || replanned >= 0) return;
            const sp = spotsOf[spot]!;
            const onSpot = rt.world
              .unitsOf(0)
              .some((e) => e.alive && e.info.isBuilder && e.orders.some((o) => o.kind === 4 && dist(o.x, o.z, sp.x, sp.z) <= 1));
            if (!onSpot) replanned = t;
          },
        },
      ],
      until: { seconds: 110 },
    });
    expect(sighted, 'the engineer saw the enemy mex').toBeGreaterThan(0);
    // Until the sighting the AI's perception (and with it freeMassSpots/canPlace) is byte-identical.
    const pa = a.perception(0);
    const pb = b.perception(0);
    const firstDiff = pa.findIndex((x, i) => !equalBytes(x, pb[i]!));
    expect(firstDiff).toBeGreaterThan(0);
    expect(firstDiff * 5, 'first differing snapshot = sighting').toBeGreaterThanOrEqual(sighted - 5);
    // The engineer was sent there (it walked to the spot) …
    const sp = spotsOf[spot]!;
    const sentThere = b.thinks(0).some((t) =>
      t.commands.some((c) => {
        if (c.op !== Op.Build) return false;
        const d = decodeAiPayload(c.op, c.payload);
        return d.op === 'build' && dist(d.value.x, d.value.z, sp.x, sp.z) <= 1;
      }),
    );
    expect(sentThere).toBe(true);
    // … and re-planned within one think + lead after the sighting; no own mex on the occupied spot.
    expect(replanned, 're-planned').toBeGreaterThanOrEqual(sighted);
    expect(replanned - sighted).toBeLessThanOrEqual(sec(1) + 3);
    expect(b.world.unitsOf(0).some((u) => u.alive && u.info.isMex && dist(u.x, u.z, sp.x, sp.z) <= 1)).toBe(false);
  });
});

let ringSpots: number[] = [];
let commanderHandle = 0;
let spotsOf: readonly { readonly x: number; readonly z: number }[] = [];

function spotIndexAt(x: number, z: number): number {
  return spotsOf.findIndex((sp) => Math.abs(sp.x - x) <= 1 && Math.abs(sp.z - z) <= 1);
}

function farPoint(rt: ScenarioRuntime): { x: number; z: number } {
  const a = rt.brain(0).analysis;
  return a.toWorld(a.pathLengthWu + 40, 0);
}

describe('AI-PERC-03: no foreign economy', () => {
  it('visible enemy commander with empty vs full energy storage (no Glutspeicher seen, before 5:00) ⇒ identical command stream', () => {
    let seenAt = -1;
    const run = (energy: number): ScenarioResult =>
      runScenario({
        map: 'setons',
        seed: 11,
        sides: [{ army: 0, ai: { openingId: 'eco_standard', recordPerception: true } }, { army: 1 }],
        // The enemy commander walks towards the AI's rally point (visible to its army from ~3:30).
        commands: [
          {
            army: 1,
            tick: 1,
            issue: (rt) => {
              const a = rt.brain(0).analysis;
              return rt.cmd.move(1, [rt.world.commander(1)!.handle], a.rally.x, a.rally.z);
            },
          },
        ],
        cheats: [{ every: 10, run: (rt) => rt.world.setStorage(1, 0, energy) }],
        until: { seconds: 290 },
        observe: [
          {
            every: 1,
            run: (rt, t) => {
              const c = rt.world.commander(1);
              if (seenAt < 0 && t >= sec(150) && c !== null && rt.world.sees(0, c)) seenAt = t;
            },
          },
        ],
      });
    const empty = run(0);
    const full = run(3900);
    expect(seenAt, 'enemy commander visible before 5:00').toBeGreaterThan(0);
    expect(seenAt).toBeLessThan(sec(300));
    expect(empty.brain(0).blackboard.enemy.estoreSeen).toBe(false);
    expect(full.streamKey(0)).toBe(empty.streamKey(0));
    const pa = empty.perception(0);
    const pb = full.perception(0);
    for (let i = 0; i < pa.length; i++) expect(equalBytes(pa[i]!, pb[i]!), `snapshot ${i}`).toBe(true);
  });
});

describe('AI-DET-02: Normal AI with a halved budget, twice', () => {
  // Setons, seed 5, 15 min: late enough that the halved engineer allotment (2,500 ops) is really
  // exhausted (tai review: in the first 6 min no manager reaches its halved allotment).
  const SCALE = 0.5;
  const ENGINEER_ALLOT = Math.floor(PROFILES.normal.budget.engineer * SCALE);
  /** A manager stops at the first `take(n)` that does not fit; the largest single take is < 50 ops. */
  const EPS = 50;

  interface Trace {
    readonly cursors: { update: number; assign: number; repair: number }[];
    readonly boardErrors: string[];
  }

  const run = (): { r: ScenarioResult; trace: Trace[] } => {
    const trace: Trace[] = [0, 1].map(() => ({ cursors: [], boardErrors: [] }));
    const brains: AiBrain[] = [];
    const side = (army: number) => ({
      army,
      ai: {
        budgetScale: SCALE,
        brain: (): AiBrain => {
          const b = createDefaultBrain();
          brains[army] = b;
          return b;
        },
        onThink: (tick: number) => {
          const b = brains[army]!;
          trace[army]!.cursors.push({ ...(b.manager?.('engineer') as EngineerManager).cursors });
          // Across thinks: no task has more builders than wanted, and every build assignment is
          // backed by the builder's current or queued job — a builder holds at most two build tasks
          // (cur + next), a resumed pass never assigns the same builder twice. (Assist tasks are
          // held by the economy's upgrade assist without an engineer job — also at full budget.)
          const eng = b.manager?.('engineer') as EngineerManager;
          const perBuilder = new Map<number, number>();
          for (const t of b.blackboard.taskBoard.ordered()) {
            if (t.assigned.length > t.wanted) trace[army]!.boardErrors.push(`${tick}: task ${t.id} ${t.assigned.length}/${t.wanted}`);
            if (new Set(t.assigned).size !== t.assigned.length) trace[army]!.boardErrors.push(`${tick}: task ${t.id} lists a builder twice`);
            if (t.kind !== 'build') continue;
            for (const h of t.assigned) {
              perBuilder.set(h, (perBuilder.get(h) ?? 0) + 1);
              if (eng.jobOf(h)?.taskId !== t.id && eng.nextJobOf(h)?.taskId !== t.id) trace[army]!.boardErrors.push(`${tick}: task ${t.id} ↔ builder ${h} without a job`);
            }
          }
          for (const [h, n] of perBuilder) if (n > 2) trace[army]!.boardErrors.push(`${tick}: builder ${h} on ${n} build tasks`);
        },
      },
    });
    const r = runScenario({ map: 'setons', seed: 5, sides: [side(0), side(1)], until: { seconds: 900 } });
    return { r, trace };
  };

  it('identical command streams; the budget bites and is continued by cursor without duplicate orders', () => {
    const { r: a, trace } = run();
    const { r: b } = run();
    const recKey = (c: EncodedCommand): string => `${c.op}:${c.flags}:${c.units.join(',')}:${Array.from(c.payload).join('.')}`;
    let continued = 0;
    for (const army of [0, 1]) {
      expect(b.streamKey(army)).toBe(a.streamKey(army));
      const thinks = a.thinks(army);
      const cur = trace[army]!.cursors;
      expect(cur).toHaveLength(thinks.length);
      expect(thinks.every((t) => !t.aborted)).toBe(true);
      // The budget really bit: the engineer manager used its whole halved allotment in some thinks.
      const exhausted = thinks.map((t, i) => ((t.opsByManager.engineer ?? 0) >= ENGINEER_ALLOT - EPS ? i : -1)).filter((i) => i >= 0);
      expect(exhausted.length, `army ${army}: thinks with an exhausted engineer budget`).toBeGreaterThan(0);
      for (const i of exhausted) expect(thinks[i]!.opsByManager.engineer).toBeLessThanOrEqual(ENGINEER_ALLOT);
      // Cursor continuation: an exhausted think stopped mid-pass (cursor > 0) and the next think
      // resumed there and moved on (the cursor advanced or the pass completed).
      for (const i of exhausted) {
        const c = cur[i]!;
        const n = cur[i + 1];
        if (n === undefined || c.update + c.assign + c.repair === 0) continue;
        expect(thinks[i + 1]!.opsByManager.engineer ?? 0).toBeGreaterThan(0);
        if (n.update !== c.update || n.assign !== c.assign || n.repair !== c.repair || thinks[i + 1]!.opsByManager.engineer! < ENGINEER_ALLOT - EPS) continued++;
      }
      // No duplicate orders — within one think no identical record twice, and no unit gets the
      // identical record again in the following think (a resumed pass must not re-issue work).
      for (let i = 0; i < thinks.length; i++) {
        const keys = thinks[i]!.commands.map(recKey);
        expect(new Set(keys).size, `think ${thinks[i]!.tick}`).toBe(keys.length);
        if (i === 0) continue;
        const prev = new Set(thinks[i - 1]!.commands.map(recKey));
        const again = keys.filter((k) => prev.has(k));
        expect(again, `army ${army}, think ${thinks[i]!.tick}: repeated orders`).toEqual([]);
      }
      expect(trace[army]!.boardErrors.slice(0, 8), `army ${army}: task board`).toEqual([]);
      const structs = a.world.unitsOf(army).filter((u) => u.alive && u.info.isStructure);
      for (let i = 0; i < structs.length; i++) {
        for (let j = i + 1; j < structs.length; j++) {
          const p = structs[i]!;
          const q = structs[j]!;
          const ox = (p.bp.footprint[0] + q.bp.footprint[0]) / 2;
          const oz = (p.bp.footprint[1] + q.bp.footprint[1]) / 2;
          const overlap = Math.abs(p.x - q.x) < ox - 1e-6 && Math.abs(p.z - q.z) < oz - 1e-6;
          expect(overlap, `structures ${p.handle}/${q.handle} overlap`).toBe(false);
        }
      }
    }
    expect(continued, 'exhausted thinks continued by cursor in the next think').toBeGreaterThan(0);
    expect(b.match.hash).toBe(a.match.hash);
  });
});
