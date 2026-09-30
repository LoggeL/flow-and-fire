/**
 * desync-diff (TRACK-REPLAY p5): a changed Move target is found at its application tick and the
 * full dump names table/column/entity; a column perturbation is found at exactly its tick;
 * identical recordings → 0; recording-only divergence → 3; dump mode write/read/compare; CLI exit
 * codes.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readRtsReplay, rtsReplayToInput, writeRtsReplay, type RtsReplayInput } from '@faf/formats';
import { CommandBatchView, Op } from '@faf/protocol';
import { convertCommandLog } from '@faf/sim-host';
import { compareStateDumps, desyncDiff, DesyncIncompatibleError, dumpReplayAt, formatDesyncReport, worldColumn } from '../src/replay/desync.ts';
import { readStateDump, writeStateDump } from '../src/replay/dump.ts';
import { recordLongGame } from '../src/replay/long-game.ts';
import type { ReplayAssets } from '../src/replay/verify.ts';
import { HEADLESS_DIR } from '../scripts/lib.ts';
import { loadReplayAssets } from '../scripts/replay-cli-lib.ts';

const RIDGE = 'content/maps/hollow-ridge.rtsmap';

let assets: ReplayAssets;
let faflA: Uint8Array;
let replayA: Uint8Array;
/** A with a changed Move target in the first Move at or after tick 1,100. */
let replayB: Uint8Array;
let changedTick = -1;
let tmp: string;

function modified(bytes: Uint8Array, edit: (inp: RtsReplayInput) => RtsReplayInput): Uint8Array {
  return writeRtsReplay(edit(rtsReplayToInput(readRtsReplay(bytes))));
}

beforeAll(() => {
  assets = loadReplayAssets();
  faflA = recordLongGame({ minutes: 2, simBin: assets.simBin, maps: assets.maps }).log;
  const conv = convertCommandLog(faflA, { map: assets.maps[RIDGE]!, simBin: assets.simBin });
  expect(conv.verified).toBe(true);
  replayA = conv.bytes;
  replayB = modified(replayA, (inp) => {
    const v = new CommandBatchView();
    const commands = inp.commands.map((c) => {
      if (c.tick < 1100 || changedTick >= 0) return c;
      const batch = c.batch.slice();
      v.reset(batch);
      while (v.next()) {
        if (v.op === Op.Move && v.unitCount > 0) {
          const dv = new DataView(batch.buffer, batch.byteOffset, batch.byteLength);
          const po = v.payloadOffset;
          dv.setInt32(po, dv.getInt32(po, true) + 4096 * 30, true); // target x + 30 WU
          changedTick = c.tick;
          return { tick: c.tick, batch };
        }
      }
      return c;
    });
    return { ...inp, commands };
  });
  expect(changedTick).toBeGreaterThanOrEqual(1100);
  expect(changedTick).toBeLessThan(1200);
  tmp = mkdtempSync(resolve(tmpdir(), 'faf-desync-'));
});

afterAll(() => {
  if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
});

describe('desyncDiff', () => {
  it('a changed Move target → first divergent tick is exactly its application tick; the dump names units/movers and the entity', () => {
    const r = desyncDiff(replayA, replayB, assets);
    expect(r.status).toBe('divergent');
    expect(r.exitCode).toBe(1);
    // The recordings only differ in the command (B keeps A's HASH chunk).
    expect(r.recorded.ruleTick).toBeNull();
    expect(r.recorded.sub).toBeNull();
    expect(r.recorded.commandTick).toBe(changedTick);
    expect(r.startTick).toBe(600); // last keyframe before the changed command
    expect(r.tick).toBe(changedTick);
    expect(r.ruleA).not.toBe(r.ruleB);
    const d = r.diff!;
    expect(d.equal).toBe(false);
    expect(d.tickA).toBe(changedTick);
    const rule = d.entries.filter((e) => !e.derived);
    expect(rule.length).toBeGreaterThan(0);
    expect(rule.every((e) => e.region === 'units' || e.region === 'movers' || /order/i.test(e.region))).toBe(true);
    // Order target / position of the commanded units, named by entity slot.
    expect(rule.some((e) => (e.region === 'units' && (e.part === 'x' || e.part === 'z')) || e.region === 'movers' || /order/i.test(e.region))).toBe(true);
    for (const e of rule) expect(e.entity).toMatch(/slot \d+/);
    const text = formatDesyncReport(r);
    expect(text).toContain(`Erste Abweichung der Nachsimulation bei Tick ${changedTick.toLocaleString('de-DE')}`);
    expect(text).toContain('= erster unterschiedlicher Command-Tick');
    expect(text).toContain('Region');
    expect(text).toContain('Ergebnis: Abweichung gefunden und erklärt');
  });

  it('perturbation units.hp of slot 5 at tick 700 → tick 700, exactly that region/column/entity first', () => {
    const r = desyncDiff(replayA, replayA, assets, { perturbB: { tick: 700, region: 'units', column: 'hp', index: 5, value: 1 } });
    expect(r.status).toBe('divergent');
    expect(r.tick).toBe(700);
    expect(r.startTick).toBe(600);
    const first = r.diff!.entries[0]!;
    expect(first).toMatchObject({ region: 'units', part: 'hp', index: 5, b: 1 });
    expect(first.a).not.toBe(1);
    expect(first.entity).toMatch(/^slot 5 /);
    expect(r.diff!.entries.filter((e) => !e.derived)).toHaveLength(1);
    // A perturbation at a keyframe tick and at tick 0 is found as well.
    expect(desyncDiff(replayA, replayA, assets, { perturbB: { tick: 600, region: 'units', column: 'hp', index: 5, value: 2 } }).tick).toBe(600);
    expect(desyncDiff(replayA, replayA, assets, { perturbB: { tick: 0, region: 'armies', column: 'unitCap', index: 1, value: 3 } }).tick).toBe(0);
  });

  it('identical recordings (also FAFL ↔ .rtsreplay) → equal, exit 0, no simulation needed', () => {
    const r = desyncDiff(replayA, replayA.slice(), assets);
    expect(r).toMatchObject({ status: 'equal', exitCode: 0, simulated: false, tick: null, diff: null });
    const mixed = desyncDiff(faflA, replayA, assets);
    expect(mixed).toMatchObject({ status: 'equal', exitCode: 0, kindA: 'fafl', kindB: 'rtsreplay' });
    expect(mixed.recorded.subNote).toContain('ohne Sub-Hashes');
    expect(formatDesyncReport(r)).toContain('Keine Abweichung');
  });

  it('only a recording differs (manipulated HASH entry) → recording-only, exit 3, names the odd recording', () => {
    const odd = modified(replayA, (inp) => {
      const hashes = inp.hashes.hashes.slice();
      const i = (800 - inp.hashes.firstTick) / inp.hashes.interval;
      hashes[i] = (hashes[i]! ^ 1) >>> 0;
      return { ...inp, hashes: { ...inp.hashes, hashes } };
    });
    const r = desyncDiff(replayA, odd, assets);
    expect(r.status).toBe('recording-only');
    expect(r.exitCode).toBe(3);
    expect(r.recorded.ruleTick).toBe(800);
    expect(r.tick).toBeNull();
    expect(r.recordingA).toBeNull();
    expect(r.recordingB?.tick).toBe(800);
    expect(formatDesyncReport(r)).toContain('Engine-/Build-Desync: Aufnahme weicht ab, Nachsimulation stimmt überein – Dump in der anderen Engine erzeugen (--dump)');
  });

  it('an earlier recording-only difference does not hide a real divergence → divergent, exit 1, with a note', () => {
    // B: the changed Move command (real divergence at changedTick) AND a manipulated HASH entry at 500.
    const both = modified(replayB, (inp) => {
      const hashes = inp.hashes.hashes.slice();
      const i = (500 - inp.hashes.firstTick) / inp.hashes.interval;
      hashes[i] = (hashes[i]! ^ 1) >>> 0;
      return { ...inp, hashes: { ...inp.hashes, hashes } };
    });
    const r = desyncDiff(replayA, both, assets);
    expect(r.recorded.ruleTick).toBe(500);
    expect(r.tick).toBe(changedTick);
    expect(r.status).toBe('divergent');
    expect(r.exitCode).toBe(1);
    expect(r.recordingFirst).toBe(500);
    expect(r.recordingB?.tick).toBe(500);
    expect(r.diff).not.toBeNull();
    const text = formatDesyncReport(r);
    expect(text).toContain('Ergebnis: Abweichung gefunden und erklärt');
    expect(text).toContain('Hinweis: die Aufnahmen weichen schon ab Tick 500 voneinander ab');
    expect(text).not.toContain('Engine-/Build-Desync');
    // Without the earlier recording difference there is no note.
    expect(desyncDiff(replayA, replayB, assets).recordingFirst).toBeNull();
  });

  it('different games are refused; bad perturbations are range errors', () => {
    const other = modified(replayA, (inp) => ({ ...inp, game: { ...inp.game, seed: (inp.game.seed + 1) >>> 0 } }));
    expect(() => desyncDiff(replayA, other, assets)).toThrow(DesyncIncompatibleError);
    expect(() => desyncDiff(replayA, replayA, assets, { perturbB: { tick: 99999, region: 'units', column: 'hp', index: 5, value: 1 } })).toThrow(RangeError);
    expect(() => desyncDiff(replayA, replayA, assets, { perturbB: { tick: 10, region: 'nope', column: 'hp', index: 5, value: 1 } })).toThrow(RangeError);
    expect(() => desyncDiff(replayA, replayA, assets, { perturbB: { tick: 10, region: 'units', column: 'nope', index: 5, value: 1 } })).toThrow(RangeError);
  });

  it('dump mode: write, read back byte-identically, compare', () => {
    const d = dumpReplayAt(replayA, assets, 700, { label: 'node' });
    expect(d.tick).toBe(700);
    const bytes = writeStateDump(d);
    const back = readStateDump(bytes);
    expect(writeStateDump(back)).toEqual(bytes);
    expect(compareStateDumps(back, d).exitCode).toBe(0);
    // B = the same state with units.hp of slot 5 changed (via the table view of a replayed world).
    const b = dumpReplayAt(replayA, assets, 700, { label: 'other' });
    const view = new DataView(b.bytes.buffer, b.bytes.byteOffset, b.bytes.byteLength);
    const hp = b.regions.find((r) => r.name === 'units')!.parts.find((p) => p.name === 'hp')!;
    const off = hp.byteOffset - b.dynamicStart + 5 * 4;
    view.setInt32(off, view.getInt32(off, true) - 7, true);
    const c = compareStateDumps(d, b);
    expect(c.exitCode).toBe(1);
    expect(c.diff.entries[0]).toMatchObject({ region: 'units', part: 'hp', index: 5 });
    expect(() => compareStateDumps(d, { ...b, simId: (d.simId ^ 1) >>> 0 })).toThrow(DesyncIncompatibleError);
    expect(() => worldColumn({} as never, 'units', 'hp')).toThrow(RangeError);
  });
});

describe('desync-diff CLI', () => {
  function cli(args: readonly string[]): { status: number | null; out: string } {
    const r = spawnSync(process.execPath, ['--import', 'tsx', resolve(HEADLESS_DIR, 'scripts/desync-diff.ts'), ...args], {
      cwd: HEADLESS_DIR,
      encoding: 'utf8',
      env: { ...process.env, INIT_CWD: tmp },
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  }

  it('exit codes 0/1/2/3 and dump mode', () => {
    writeFileSync(resolve(tmp, 'a.rtsreplay'), replayA);
    writeFileSync(resolve(tmp, 'b.rtsreplay'), replayB);
    writeFileSync(resolve(tmp, 'a.faflog'), faflA);
    const odd = modified(replayA, (inp) => {
      const hashes = inp.hashes.hashes.slice();
      hashes[50] = (hashes[50]! ^ 1) >>> 0;
      return { ...inp, hashes: { ...inp.hashes, hashes } };
    });
    writeFileSync(resolve(tmp, 'odd.rtsreplay'), odd);
    writeFileSync(resolve(tmp, 'other.rtsreplay'), modified(replayA, (inp) => ({ ...inp, game: { ...inp.game, seed: 7 } })));

    const same = cli(['--', 'a.faflog', 'a.rtsreplay']);
    expect(same.status).toBe(0);
    expect(same.out).toContain('Keine Abweichung');

    const diff = cli(['a.rtsreplay', 'b.rtsreplay', '--dumps', 'dumps', '--limit', '8']);
    expect(diff.status).toBe(1);
    expect(diff.out).toContain(`Erste Abweichung der Nachsimulation bei Tick ${changedTick.toLocaleString('de-DE')}`);
    expect(diff.out).toMatch(/Region\s+\| Spalte/);
    expect(diff.out).toContain('dumps/a.rtsdump');

    const dumps = cli(['dumps/a.rtsdump', 'dumps/b.rtsdump']);
    expect(dumps.status).toBe(1);
    expect(dumps.out).toContain('Ergebnis: Abweichung gefunden (Exit 1)');

    expect(cli(['a.rtsreplay', 'odd.rtsreplay']).status).toBe(3);
    const other = cli(['a.rtsreplay', 'other.rtsreplay']);
    expect(other.status).toBe(2);
    expect(other.out).toContain('inkompatibel');

    const dumped = cli(['--dump', 'a.rtsreplay', '--tick', '700', '--out', 'x/a700.rtsdump']);
    expect(dumped.status).toBe(0);
    expect(dumped.out).toContain('Voll-Dump geschrieben: x/a700.rtsdump – Tick 700');
    expect(readStateDump(new Uint8Array(readFileSync(resolve(tmp, 'x/a700.rtsdump')))).tick).toBe(700);
    expect(cli(['x/a700.rtsdump', 'x/a700.rtsdump']).status).toBe(0);
    expect(cli(['x/a700.rtsdump', 'a.rtsreplay']).status).toBe(2);
    expect(cli(['a.rtsreplay', 'a.rtsreplay', '--perturb-b', '700:units.hp[5]=1']).status).toBe(1);
  });
});
