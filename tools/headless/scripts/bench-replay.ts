import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { prepareReplayBenchmark, type benchmarkPreparedReplay } from '../src/replay/replay-bench.ts';
import { isoDate, loadMaps, loadSimBin, machine, REPO_DIR, RESULTS_DIR, writeText } from './lib.ts';
const quick = process.argv.includes('--quick'), update = process.argv.includes('--update-docs');
type WorkerResult = ReturnType<typeof benchmarkPreparedReplay> & { pid: number };
const runs = [], assets = { simBin: loadSimBin(), maps: loadMaps() };
const dir = mkdtempSync(resolve(tmpdir(), 'faf-replay-bench-'));
try {
  for (let i = 0; i < 2; i++) {
    console.log(`Lauf ${i + 1}: ${quick ? 10 : 30}-Minuten-Aufnahme und Konvertierung vorbereiten`);
    const prepared = prepareReplayBenchmark(assets, quick ? 10 : 30);
    const replayPath = resolve(dir, `${i}.rtsreplay`), baselinePath = resolve(dir, `${i}.json`);
    writeFileSync(replayPath, prepared.bytes); writeFileSync(baselinePath, JSON.stringify(prepared.baseline));
    const measure = (mode: 'cold' | 'warm'): WorkerResult => {
      console.log(`Lauf ${i + 1}: frischer Node-Prozess für ${mode}${mode === 'warm' ? ' (mit vollständigem Warm-up)' : ''}`);
      const child = spawnSync(process.execPath, ['--import', 'tsx', resolve(REPO_DIR, 'tools/headless/scripts/replay-bench-worker.ts'), mode, replayPath, baselinePath],
        { cwd: REPO_DIR, encoding: 'utf8', timeout: 600000, maxBuffer: 4 * 1024 * 1024 });
      if (child.error !== undefined) throw child.error;
      if (child.status !== 0) throw new Error(`${mode} benchmark failed (${child.status}): ${child.stderr}`);
      return JSON.parse(child.stdout) as WorkerResult;
    };
    const cold = measure('cold'), warm = measure('warm');
    if (cold.pid === warm.pid || cold.pid === process.pid || warm.pid === process.pid) throw new Error('Benchmark processes must be distinct');
    if (warm.seek === null) throw new Error('Warm seek report missing');
    const playback = [cold.playback, warm.playback], pass = warm.seek.p95 <= 2000 && playback.every((x) => x.xRealtime >= 20);
    const result = { ...prepared.baseline, baseline: prepared.baseline, playback, seek: warm.seek,
      bytes: prepared.bytesReport, synthetic: prepared.synthetic, keyframes: warm.keyframes, stats: prepared.stats,
      processes: { parent: process.pid, cold: cold.pid, warm: warm.pid }, pass };
    runs.push(result);
    console.log(`Lauf ${i + 1}: ${result.bytes.total} B; Wiedergabe ${playback.map((p) => `${p.mode} ${p.xRealtime.toFixed(1)}x`).join(', ')}; Seek p95 ${result.seek.p95.toFixed(1)} ms, max ${result.seek.max.toFixed(1)} ms; ${pass ? 'PASS' : 'FAIL'}`);
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
const report = { date: isoDate(), machine: machine(), node: process.version, quick,
  method: 'prewritten replay and original final hashes; fresh cold Node process; separate warm process with one complete unmeasured playback; timed open+playToEnd including verification and keyframes; backward seeks checked against direct rule/full hashes', runs };
writeText(resolve(RESULTS_DIR, `replay-bench-${isoDate()}${quick ? '-quick' : ''}.json`), JSON.stringify(report, null, 2) + '\n');
if (update) {
  const rows = runs.map((r, i) => `| ${i + 1} | ${r.bytes.total} | ${r.bytes.byChunk['CMDS']} | ${r.playback.map((p) => p.xRealtime.toFixed(1)).join(' / ')} | ${r.seek.median.toFixed(1)} | ${r.seek.p95.toFixed(1)} | ${r.seek.max.toFixed(1)} | ${r.keyframes.bytes} |`);
  writeText(resolve(REPO_DIR, 'docs/status/track-replay/p5-benchmark.md'), `# Replay-Messung\n\nLokal gemessen am ${report.date}, ${report.machine}, Node ${process.version}. ${quick ? 10 : 30} Minuten Spielzeit, 120 APM pro Armee. Aufnahme und Konvertierung vor der Messung; Replay und Original-End-Hashes als Dateien. Kalt: frischer Node-Prozess ohne vorherige Simulation. Warm: separater Node-Prozess nach einem vollständigen ungemessenen Durchlauf. Die Zeit umfasst Öffnen, Wiedergabe, Regel-/Sub-Hash-Prüfung und Keyframe-Aufbau; Prozessstart und Datei-IO liegen außerhalb. Betriebssystem-Dateicaches werden nicht geleert. Alle Seek-Ziele stimmen im Regel- und Voll-Hash mit dem Direktlauf ohne Keyframes überein.\n\n| Lauf | Gesamt B | CMDS B | kalt / warm x Echtzeit | Seek Median ms | p95 ms | max ms | Keyframes B |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n\nGates: jede Wiedergabe mindestens 20x, Seek-p95 höchstens 2000 ms. Ergebnis: ${runs.every((r) => r.pass) ? 'bestanden' : 'nicht bestanden'}. JSON mit Prozess-IDs, Original-End-Hashes und jedem Seek-Hash: tools/headless/results/replay-bench-${report.date}${quick ? '-quick' : ''}.json.\n`);
}
if (runs.some((r) => !r.pass)) process.exitCode = 1;
