/**
 * Size gate of .rtsreplay (PLAN §3.11 / §5.2 MS11): a complete replay of the synthetic 30-min 1v1
 * (2 × 120 APM, src/replay/synthetic.ts — the model is fixed, see docs/status/track-replay/p0.md)
 * must stay within CMDS ≤ 100,000 B and file ≤ 250,000 B. 2 × 200 APM is reported, not gated.
 */
import { describe, expect, it } from 'vitest';
import { readAllCommands, readRtsReplay, rewriteRtsReplay, type ReplayTickCommands } from '@faf/formats';
import { buildSyntheticReplay, CMDS_GATE_BYTES, FILE_GATE_BYTES, formatSizeTable, sizeGate } from '../scripts/replay-size.ts';

function sameCommands(a: readonly ReplayTickCommands[], b: readonly { tick: number; batch: Uint8Array }[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!.batch;
    const y = b[i]!.batch;
    if (a[i]!.tick !== b[i]!.tick || x.length !== y.length) return false;
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return false;
  }
  return true;
}

describe('.rtsreplay size gate (synthetic 30-min 1v1)', () => {
  const gated = buildSyntheticReplay(120);

  it(`2 × 120 APM: CMDS ≤ ${CMDS_GATE_BYTES} B and file ≤ ${FILE_GATE_BYTES} B`, () => {
    const { report, game } = gated;
    console.log(formatSizeTable(gated));
    expect(game.stats.envelopes).toBe(7200);
    expect(report.blocks).toBe(30);
    for (const id of ['HEAD', 'GAME', 'CMDS', 'HASH', 'MARK', 'META']) expect(report.byChunk[id], id).toBeGreaterThan(0);
    const gate = sizeGate(report);
    expect(gate.cmds).toBeLessThanOrEqual(CMDS_GATE_BYTES);
    expect(gate.total).toBeLessThanOrEqual(FILE_GATE_BYTES);
    expect(gate.ok).toBe(true);
  });

  it('the gated replay is complete and lossless (commands, hashes, sub-hashes, marks, byte-exact rewrite)', () => {
    const r = readRtsReplay(gated.bytes, { verifyBlocks: true });
    expect(sameCommands(readAllCommands(r), gated.game.commands)).toBe(true);
    expect(Array.from(r.hashes.hashes)).toEqual(Array.from(gated.game.hashes.values));
    expect(r.hashes.hashes.length).toBe(1800);
    expect(r.hashes.regionNames).toEqual(gated.game.subHashes.regionNames);
    expect(Array.from(r.hashes.subHashes)).toEqual(Array.from(gated.game.subHashes.values));
    expect(r.marks).toEqual(gated.game.marks);
    expect(r.meta!.durationTicks).toBe(18_000);
    const again = rewriteRtsReplay(r);
    expect(again.length).toBe(gated.bytes.length);
    expect(again.every((v, i) => v === gated.bytes[i])).toBe(true);
    // Deterministic writer.
    const second = buildSyntheticReplay(120);
    expect(second.bytes.every((v, i) => v === gated.bytes[i]) && second.bytes.length === gated.bytes.length).toBe(true);
  });

  it('2 × 200 APM (report only)', () => {
    const high = buildSyntheticReplay(200);
    console.log(formatSizeTable(high));
    expect(high.game.stats.envelopes).toBe(12_000);
    const r = readRtsReplay(high.bytes, { verifyBlocks: true });
    expect(sameCommands(readAllCommands(r), high.game.commands)).toBe(true);
    // Grows about linearly with the command count.
    expect(high.report.byChunk.CMDS!).toBeGreaterThan(gated.report.byChunk.CMDS!);
  });
});
