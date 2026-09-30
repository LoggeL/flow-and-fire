/**
 * Replay size report and gate (script `replay-size`, PLAN §3.11 / §5.2 MS11): builds a complete
 * .rtsreplay (HEAD, GAME, all CMDS blocks, HASH with rule hashes every 10 ticks and sub-hashes
 * every 100 ticks, MARK, META) from the synthetic 30-min 1v1 command stream
 * (src/replay/synthetic.ts) and prints the size table for 2 × 120 APM (gated) and 2 × 200 APM
 * (report only).
 *
 *   pnpm --filter @faf/headless replay-size [-- --json] [--long]
 *
 * `--long` additionally converts the sim-valid 30-min long game (src/replay/long-game.ts, FAFL
 * log on hollow-ridge) and reports its size (not gated; Move/Stop only, see p3 fragment).
 * Exit 1 if the 120-APM replay misses the gate (CMDS ≤ 100,000 B, file ≤ 250,000 B).
 * The builder is exported for tools/headless/test/replay-size.test.ts.
 */
import { pathToFileURL } from 'node:url';
import {
  RTSREPLAY_FORMAT_VERSION,
  ReplayArmyKind,
  ReplayFlags,
  RtsReplayBuilder,
  replaySizeReport,
  type ReplaySizeReport,
} from '@faf/formats';
import { COMMAND_BATCH_VERSION } from '@faf/protocol';
import { SIM_BUILD } from '@faf/sim';
import { parseCommandLog } from '@faf/sim-host';
import { recordLongGame } from '../src/replay/long-game.ts';
import { generateSynthetic1v1, type SyntheticGame } from '../src/replay/synthetic.ts';
import { loadMaps, loadSimBin } from './lib.ts';

/** PLAN §3.11: CMDS ≤ 100 KB for a 30-min 1v1. */
export const CMDS_GATE_BYTES = 100_000;
/** PLAN §3.11: whole file ≤ 250 KB for a 30-min 1v1. */
export const FILE_GATE_BYTES = 250_000;

export interface SyntheticReplay {
  readonly apm: number;
  readonly game: SyntheticGame;
  readonly bytes: Uint8Array;
  readonly report: ReplaySizeReport;
}

/** Alliance matrix of a 1v1: every army allied with itself only (bit a·16+a). */
function selfAlliances(armies: number): Uint8Array {
  const out = new Uint8Array(32);
  for (let a = 0; a < armies; a++) {
    const bit = a * 16 + a;
    out[bit >>> 3]! |= 1 << (bit & 7);
  }
  return out;
}

/** Builds the full replay of the synthetic 1v1 (both armies at `apm`) via RtsReplayBuilder. */
export function buildSyntheticReplay(apm: number, minutes = 30): SyntheticReplay {
  const game = generateSynthetic1v1({ minutes, apm: [apm, apm] });
  const b = new RtsReplayBuilder(
    {
      formatVersion: RTSREPLAY_FORMAT_VERSION,
      simBuild: SIM_BUILD,
      buildHash: '3f9c2a71d0be',
      simId: 0x6b1d02e4,
      bpSimHash: 0x1f0e2d3c,
      mapSimHash: 0x9a8b7c6d,
      layoutHash: 0x51c0ffee,
      protocolVersion: COMMAND_BATCH_VERSION,
      hashInterval: game.hashes.interval,
      subHashInterval: game.subHashes.interval,
      flags: ReplayFlags.Complete,
      sourceLogVersion: 0,
    },
    {
      seed: game.seed,
      mapName: 'Hollow Ridge',
      mapSizeWu: game.mapSizeWu,
      playerArmy: 0,
      armies: [
        { index: 0, kind: ReplayArmyKind.Human, team: 1, aixPermille: 1000, name: 'Spieler 1', aiProfile: '', faction: 'varkan' },
        { index: 1, kind: ReplayArmyKind.Human, team: 2, aixPermille: 1000, name: 'Spieler 2', aiProfile: '', faction: 'varkan' },
      ],
      alliances: selfAlliances(2),
    },
    { regionNames: game.subHashes.regionNames },
  );
  for (const c of game.commands) b.commands(c.tick, c.batch);
  const h = game.hashes;
  for (let i = 0; i < h.values.length; i++) b.hash(h.firstTick + i * h.interval, h.values[i]!);
  const s = game.subHashes;
  const rc = s.regionNames.length;
  for (let k = 0; k * rc < s.values.length; k++) b.subHashes(s.firstTick + k * s.interval, s.values.subarray(k * rc, k * rc + rc));
  for (const m of game.marks) b.mark(m.tick, m.kind, m.value);
  const endTick = game.stats.ticks;
  const bytes = b.finish({
    durationTicks: endTick,
    endTick,
    players: [
      { army: 0, name: 'Spieler 1' },
      { army: 1, name: 'Spieler 2' },
    ],
    result: { winner: 0, reason: 'acu-destroyed' },
    stats: {
      apm0: game.stats.apmPerArmy[0]!,
      apm1: game.stats.apmPerArmy[1]!,
      commands: game.stats.envelopes,
      unitsBuilt: game.stats.unitsCreated,
      unitsLost: game.stats.unitsCreated - game.stats.liveUnitsAtEnd[0]! - game.stats.liveUnitsAtEnd[1]!,
    },
    extra: { source: 'synthetic-1v1', model: `apm ${apm}/${apm}, ${minutes} min` },
  });
  return { apm, game, bytes, report: replaySizeReport(bytes) };
}

function fmt(n: number): string {
  return n.toLocaleString('de-DE');
}

function pct(part: number, total: number): string {
  return `${((part * 100) / total).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

/** Markdown size table of one replay. */
export function formatSizeTable(r: SyntheticReplay): string {
  const { report, game } = r;
  const lines: string[] = [];
  lines.push(`### Synthetisches 1v1, ${game.minutes} min, 2 × ${r.apm} APM (${fmt(game.stats.envelopes)} Commands, ${fmt(game.stats.ticks)} Ticks)`);
  lines.push('');
  lines.push('| Chunk | Bytes | Anteil |');
  lines.push('|---|---:|---:|');
  const order = ['header', 'HEAD', 'GAME', 'CMDS', 'HASH', 'MARK', 'META'];
  const ids = [...order.filter((id) => report.byChunk[id] !== undefined), ...Object.keys(report.byChunk).filter((id) => !order.includes(id)).sort()];
  for (const id of ids) lines.push(`| ${id === 'header' ? 'Dateikopf' : id} | ${fmt(report.byChunk[id]!)} | ${pct(report.byChunk[id]!, report.total)} |`);
  lines.push(`| **gesamt** | **${fmt(report.total)}** | 100,0 % |`);
  lines.push('');
  const cmds = report.byChunk.CMDS ?? 0;
  lines.push('| CMDS | Wert |');
  lines.push('|---|---:|');
  lines.push(`| Blöcke à 600 Ticks | ${report.blocks} |`);
  lines.push(`| Protokoll-Batches (unkodiert) | ${fmt(game.stats.rawCommandBytes)} B |`);
  lines.push(`| CMDS roh (Blockkodierung, vor Codec) | ${fmt(report.cmdsRawBytes)} B |`);
  lines.push(`| CMDS gespeichert (nach Codec) | ${fmt(report.cmdsStoredBytes)} B |`);
  lines.push(`| CMDS-Chunks inkl. Kopf/CRC | ${fmt(cmds)} B |`);
  lines.push(`| Bytes pro Command | ${(cmds / game.stats.envelopes).toLocaleString('de-DE', { maximumFractionDigits: 2 })} |`);
  lines.push(`| Faktor gegenüber Protokoll | ${(game.stats.rawCommandBytes / cmds).toLocaleString('de-DE', { maximumFractionDigits: 2 })} × |`);
  return lines.join('\n');
}

export interface GateResult {
  readonly ok: boolean;
  readonly cmds: number;
  readonly total: number;
}

export function sizeGate(report: ReplaySizeReport): GateResult {
  const cmds = report.byChunk.CMDS ?? 0;
  return { ok: cmds <= CMDS_GATE_BYTES && report.total <= FILE_GATE_BYTES, cmds, total: report.total };
}

export interface LongGameReplay {
  readonly bytes: Uint8Array;
  readonly report: ReplaySizeReport;
  readonly envelopes: number;
  readonly logBytes: number;
  readonly ticks: number;
}

/**
 * The sim-valid 30-min long game (p3) as .rtsreplay: CMDS, rule hashes and marks straight from
 * its FAFL log. Sub-hashes need a re-simulation (p4 convertCommandLog) and are left out here; at
 * 5 regions every 100 ticks they add about 3.6 KB (180 rows × 5 regions × 4 B + names) to HASH.
 */
export function buildLongGameReplay(minutes = 30): LongGameReplay {
  const game = recordLongGame({ minutes, maps: loadMaps(), simBin: loadSimBin() });
  const log = parseCommandLog(game.log);
  const h = log.header;
  const tainted = log.tainted;
  const b = new RtsReplayBuilder(
    {
      formatVersion: RTSREPLAY_FORMAT_VERSION,
      simBuild: SIM_BUILD,
      buildHash: h.buildHash,
      simId: h.simId,
      bpSimHash: h.bpSimHash,
      mapSimHash: h.mapSimHash,
      layoutHash: h.layoutHash,
      protocolVersion: COMMAND_BATCH_VERSION,
      hashInterval: h.hashInterval,
      subHashInterval: 0,
      flags: (log.endTick >= 0 ? ReplayFlags.Complete : 0) | (tainted ? ReplayFlags.Tainted : 0),
      sourceLogVersion: log.version,
    },
    {
      seed: h.seed,
      mapName: 'hollow-ridge',
      mapSizeWu: h.mapSizeWu,
      playerArmy: h.playerArmy,
      armies: Array.from({ length: h.armyCount }, (_, index) => ({ index, kind: ReplayArmyKind.Human, team: index + 1, aixPermille: 1000, name: `Armee ${index + 1}`, aiProfile: '', faction: 'varkan' })),
      alliances: selfAlliances(h.armyCount),
    },
  );
  for (const c of log.commands) b.commands(c.tick, log.bytes.subarray(c.offset, c.offset + c.length));
  for (const e of log.hashes) b.hash(e.tick, e.hash);
  for (const m of log.marks) b.mark(m.tick, m.kind, m.value);
  const bytes = b.finish({
    durationTicks: log.lastTick,
    endTick: log.lastTick,
    players: [],
    result: { winner: -1, reason: 'unknown' },
    stats: { commands: game.stats.envelopes },
    extra: { source: 'long-game' },
  });
  return { bytes, report: replaySizeReport(bytes), envelopes: game.stats.envelopes, logBytes: game.log.length, ticks: log.lastTick };
}

function formatLongGame(r: LongGameReplay): string {
  const lines = ['### Sim-valide Langpartie (hollow-ridge, 2 × 120 APM + Cheat-Ersatz, ohne Sub-Hashes)', '', '| Chunk | Bytes | Anteil |', '|---|---:|---:|'];
  for (const id of Object.keys(r.report.byChunk)) lines.push(`| ${id === 'header' ? 'Dateikopf' : id} | ${fmt(r.report.byChunk[id]!)} | ${pct(r.report.byChunk[id]!, r.report.total)} |`);
  lines.push(`| **gesamt** | **${fmt(r.report.total)}** | 100,0 % |`);
  lines.push('');
  const cmds = r.report.byChunk.CMDS ?? 0;
  lines.push(`FAFL-Log ${fmt(r.logBytes)} B, ${fmt(r.envelopes)} Envelopes, ${fmt(r.ticks)} Ticks; CMDS ${fmt(cmds)} B = ${(cmds / r.envelopes).toLocaleString('de-DE', { maximumFractionDigits: 2 })} B/Command.`);
  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const json = args.includes('--json');
  const long = args.includes('--long');
  for (const a of args) {
    if (a !== '--json' && a !== '--long') {
      console.error(`unknown argument ${a} (allowed: --json, --long)`);
      process.exit(2);
    }
  }
  const gated = buildSyntheticReplay(120);
  const high = buildSyntheticReplay(200);
  const gate = sizeGate(gated.report);
  const longGame = long ? buildLongGameReplay() : null;
  if (json) {
    console.log(JSON.stringify({ gate: { ...gate, cmdsLimit: CMDS_GATE_BYTES, totalLimit: FILE_GATE_BYTES }, apm120: gated.report, apm200: high.report, longGame: longGame?.report ?? null }, null, 2));
  } else {
    console.log(formatSizeTable(gated));
    console.log('');
    console.log(formatSizeTable(high));
    console.log('');
    if (longGame !== null) {
      console.log(formatLongGame(longGame));
      console.log('');
    }
    console.log(
      `Gate (2 × 120 APM): CMDS ${fmt(gate.cmds)} B ≤ ${fmt(CMDS_GATE_BYTES)} B ${gate.cmds <= CMDS_GATE_BYTES ? 'ok' : 'VERFEHLT'}, ` +
        `gesamt ${fmt(gate.total)} B ≤ ${fmt(FILE_GATE_BYTES)} B ${gate.total <= FILE_GATE_BYTES ? 'ok' : 'VERFEHLT'}`,
    );
  }
  if (!gate.ok) process.exit(1);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
