import { beforeAll, describe, expect, test } from 'vitest';
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { compileContent } from '@faf/blueprints/content';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import { createTestPlaneMap, mapSimData } from '@faf/formats';
import { BUILD_PAYLOAD_BYTES, CmdFlags, ECO_RECORD_BYTES, EcoField, encodeBuild, encodeSetPriority, encodeTogglePause, FrameFlags, FrameReader, FrameWriter, Op, type CommandEnvelope } from '@faf/protocol';
import { canPlace, cumulativeCost, ECO_ONE, mulDiv } from '@faf/rules';
import { createWorld, fullHash, initializeSkirmish, placementVerdict, placementWorld, restore, snapshot, step, UnitBits, writeFrame, type World } from '../src/index.ts';
import { spawnUnit } from '../src/units.ts';
import { nextSeq } from './support/fixtures.ts';
let bp: SimBpTable;
beforeAll(async () => { bp = decodeSimBin((await compileContent({ includeTest: true })).simBin); });
function world(): World { return createWorld({ bpTable: bp, seed: 1, armyCount: 2, mapSizeWu: 64 }); }
function spawn(w: World, id: string, x = 10, z = 10, army = 0): number { return spawnUnit(w, bp.ids.indexOf(id), army, fx(x), fx(z), 0); }
function command(w: World, u: number, op: Op, payload: Uint8Array, flags = 0): CommandEnvelope { return { tick: asTick(0), army: asArmyId(w.units.col.army[u]!), seq: nextSeq(0), op, flags, units: [w.units.handle(u) as Handle], payload }; }
function build(w: World, u: number, id: string, x: number, z: number, flags = 0): CommandEnvelope { return command(w, u, Op.Build, encodeBuild({ bp: bp.ids.indexOf(id), yaw: 0, x: fx(x), z: fx(z) }), flags); }
function bank(w: World, m = 650000, e = 3900000): void { w.armies.col.massStored.set(0, m); w.armies.col.energyStored.set(0, e); }
function site(w: World, id: string): number { for (let i = 0; i < w.units.highWater; i++)
    if (w.units.isLive(i) && w.units.col.bp[i] === bp.ids.indexOf(id))
        return i; return -1; }
describe('MS4 integer flow and construction', () => {
    test('compiles real roster values and optional UECO defaults', () => {
        const acu = bp.ids.indexOf('core:cmd_commander'), mex = bp.ids.indexOf('core:str_t1_mex');
        expect(bp.buildPowerQ16PerTickCol[acu]).toBe(65536);
        expect(bp.massIncomeMilliPerTickCol[acu]).toBe(100);
        expect(bp.massStorageMilliCol[acu]).toBe(650000);
        expect(bp.spotKindCol[mex]).toBe(0);
        expect(bp.canBuild(acu, mex)).toBe(true);
        expect(BUILD_PAYLOAD_BYTES).toBe(12);
        expect(ECO_RECORD_BYTES).toBe(112);
    });
    test('exact mulDiv and cumulative accounting for 10,000 deterministic random stalls', () => {
        let seed = 81;
        for (let i = 0; i < 10000; i++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const cost = seed * 23, parts = 1 + (seed % 21);
            let done = 0, paid = 0;
            for (let j = 0; j < parts; j++) {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                const next = j === parts - 1 ? ECO_ONE : Math.min(ECO_ONE, done + (seed % 5000));
                const charge = cumulativeCost(cost, next) - cumulativeCost(cost, done);
                paid += charge;
                done = next;
            }
            expect(paid).toBe(cost);
            const a = seed * 2001, b = seed % 65537, d = 1000 + seed % 9831;
            expect(mulDiv(a, b, d)).toBe(Number(BigInt(a) * BigInt(b) / BigInt(d)));
        }
    });
    test('commander builds Pgen, pays exact cost, produces only after completion', () => {
        const w = world(), u = spawn(w, 'core:cmd_commander');
        bank(w);
        step(w, [build(w, u, 'core:str_t1_pgen', 14, 10)]);
        const s = site(w, 'core:str_t1_pgen');
        expect(s).toBeGreaterThan(0);
        expect(w.units.col.buildDone.get(s)).toBeGreaterThan(0);
        expect(w.armies.col.energyIncome.get(0)).toBe(2000);
        for (let i = 0; i < 124; i++)
            step(w);
        expect(w.units.col.buildDone.get(s)).toBe(ECO_ONE);
        expect(w.units.col.buildPaidMass.get(s)).toBe(75000);
        expect(w.units.col.buildPaidEnergy.get(s)).toBe(750000);
        expect(w.units.col.hp[s]).toBe(620);
        step(w);
        expect(w.armies.col.energyIncome.get(0)).toBe(4000);
        expect(w.units.col.buildTarget[u]).toBe(0xffffffff);
    });
    test('sites share 50% resource ratio, never overdraw and restore bit exactly', () => {
        const w = world(), a = spawn(w, 'core:cmd_commander', 10, 10), b = spawn(w, 'core:cmd_commander', 10, 20);
        bank(w, 0, 0);
        // Pgen needs 600 milli mass/tick per ACU, total 1200. ACUs give 200, add 400 for exact 50%.
        bp.massIncomeMilliPerTickCol[bp.ids.indexOf('core:cmd_commander')] = 300;
        bp.energyIncomeMilliPerTickCol[bp.ids.indexOf('core:cmd_commander')] = 3000;
        step(w, [build(w, a, 'core:str_t1_pgen', 14, 10), build(w, b, 'core:str_t1_pgen', 14, 20)]);
        expect(w.armies.col.ratioNormal[0]).toBe(32768);
        expect(w.armies.col.massStored.get(0)).toBeGreaterThanOrEqual(0);
        const saved = snapshot(w), other = world();
        restore(other, saved);
        for (let i = 0; i < 300; i++) {
            step(w);
            step(other);
            expect(w.armies.col.massStored.get(0)).toBeGreaterThanOrEqual(0);
        }
        expect(fullHash(other)).toBe(fullHash(w));
        bp.massIncomeMilliPerTickCol[bp.ids.indexOf('core:cmd_commander')] = 100;
        bp.energyIncomeMilliPerTickCol[bp.ids.indexOf('core:cmd_commander')] = 2000;
    });
    test('priority protects high tier, pause resumes persistent construction and Stop leaves site', () => {
        const w = world(), a = spawn(w, 'core:cmd_commander', 10, 10), b = spawn(w, 'core:cmd_commander', 10, 20);
        bank(w, 0, 0);
        step(w, [command(w, a, Op.SetPriority, encodeSetPriority(0)), build(w, a, 'core:str_t1_pgen', 14, 10), build(w, b, 'core:str_t1_pgen', 14, 20)]);
        const s = site(w, 'core:str_t1_pgen');
        expect(w.units.col.ecoPriority[s]).toBe(0);
        step(w);
        expect(w.armies.col.ratioHigh[0]).toBeGreaterThan(w.armies.col.ratioNormal[0]!);
        step(w, [command(w, a, Op.TogglePause, encodeTogglePause(true))]);
        const done = w.units.col.buildDone.get(s);
        step(w);
        expect(w.units.col.buildDone.get(s)).toBe(done);
        step(w, [command(w, a, Op.Stop, new Uint8Array(0))]);
        expect(w.units.isLive(s)).toBe(true);
        step(w, [command(w, a, Op.TogglePause, encodeTogglePause(false)), build(w, a, 'core:str_t1_pgen', 14, 10)]);
        expect(w.units.col.buildDone.get(s)).toBeGreaterThan(done);
    });
    test('stallsOff shuts down within tick and remains off for 30 ticks', () => {
        const w = world(), u = spawn(w, 'test:stall_consumer');
        step(w);
        expect(w.units.col.ecoEnabled[u]).toBe(0);
        const until = w.units.col.ecoOffUntil[u]!;
        for (let i = 0; i < 29; i++) {
            step(w);
            expect(w.units.col.ecoEnabled[u]).toBe(0);
        }
        expect(w.tick).toBe(until - 1);
    });
    test('placement rejects occupied/off-grid/no-spot and restores footprint removal', () => {
        const w = world(), u = spawn(w, 'core:cmd_commander');
        bank(w);
        const p = bp.ids.indexOf('core:str_t1_pgen'), m = bp.ids.indexOf('core:str_t1_mex');
        expect(placementVerdict(w, m, fx(14), fx(10), 0)).not.toBe(0);
        expect(placementVerdict(w, p, fx(14.5), fx(10), 0)).not.toBe(0);
        step(w, [build(w, u, 'core:str_t1_pgen', 14, 10)]);
        expect(placementVerdict(w, p, fx(14), fx(10), 0)).not.toBe(0);
        const s = site(w, 'core:str_t1_pgen');
        step(w, [command(w, s, Op.Cheat, Uint8Array.of(2))]);
        expect(placementVerdict(w, p, fx(14), fx(10), 0)).toBe(0);
    });
    test('Mex placement on a real map spot pays exact cost and produces its roster flow', () => {
        const map = { ...mapSimData(createTestPlaneMap(64)), spots: [{ kind: 'mass' as const, x: fx(14), z: fx(10) }] }, w = createWorld({ bpTable: bp, seed: 1, armyCount: 2, map }), u = spawn(w, 'core:cmd_commander');
        bank(w);
        step(w, [build(w, u, 'core:str_t1_mex', 14, 10)]);
        for (let i = 0; i < 60; i++)
            step(w);
        const s = site(w, 'core:str_t1_mex');
        expect(w.units.col.buildPaidMass.get(s)).toBe(36000);
        expect(w.units.col.buildPaidEnergy.get(s)).toBe(360000);
        expect(w.armies.col.massIncome.get(0)).toBe(300);
        expect(w.armies.col.energySpent.get(0)).toBe(200);
    });
    test('10,000 client ghost verdicts equal authoritative placement, including terrain/occupancy', () => {
        const w = world(), p = bp.ids.indexOf('core:str_t1_pgen'), view = placementWorld(w);
        w.nav.stampFootprint(15, 15, 3, 4, 1);
        let seed = 3;
        for (let i = 0; i < 10000; i++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const x = fx((seed % 68) - 2);
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const z = fx((seed % 68) - 2), yaw = (seed % 4) * 16384;
            expect(placementVerdict(w, p, x, z, yaw)).toBe(canPlace(view, { x, z, yaw, w: bp.footprintW(p), h: bp.footprintH(p), maxSlopeRaw: bp.maxSlopeCol[p]!, spotKind: bp.spotKindCol[p]! }));
        }
        // A slope passable to land movers still exceeds this structure's placement limit.
        w.terrain.heights[10 * w.terrain.dim + 14] = 100;
        expect(placementVerdict(w, p, fx(14), fx(10), 0)).not.toBe(0);
    });
    test('queued buildings, footprint snapshots and own-army economy readback survive skipped frames', () => {
        const w = world(), u = spawn(w, 'core:cmd_commander');
        bank(w);
        step(w, [build(w, u, 'core:str_t1_pgen', 14, 10), build(w, u, 'core:str_t1_pgen', 10, 14, CmdFlags.Queue)]);
        for (let i = 0; i < 260; i++)
            step(w);
        const writer = new FrameWriter(), bytes = new Uint8Array(writer.capacityBytes), reader = new FrameReader();
        const len = writeFrame(w, 0, writer, bytes);
        expect(reader.reset(bytes.subarray(0, len))).toBe(true);
        expect(reader.version).toBe(5);
        expect(reader.flags & FrameFlags.FootprintSnapshot).not.toBe(0);
        expect(reader.footprintCount).toBe(4);
        expect(reader.ecoCount).toBe(1);
        expect(reader.ecoArmy(0)).toBe(0);
        expect(reader.ecoValue(0, EcoField.energyIncome)).toBe(6000);
        expect(w.units.col.flags[site(w, 'core:str_t1_pgen')]! & UnitBits.UnderConstruction).toBe(0);
    });
    test('untainted deterministic skirmish setup follows map starts and design bank', () => {
        const map = mapSimData(createTestPlaneMap(64)), w = createWorld({ bpTable: bp, seed: 2, armyCount: 2, map });
        initializeSkirmish(w);
        expect(w.units.liveCount).toBe(2);
        expect(w.armies.col.massStored.get(0)).toBe(650000);
        expect(w.armies.col.energyStored.get(1)).toBe(3900000);
        expect(() => initializeSkirmish(w)).toThrow();
    });
});
