import { writeFileSync } from 'node:fs';
import { captureStateDump, readStateDump, writeStateDump } from '../src/replay/dump.ts';
import { desyncDiff } from '../src/replay/desync.ts';
import { diffStateDumps, formatStateDiff } from '../src/replay/state-diff.ts';
import { openReplayFile } from '../src/replay/verify.ts';
import { fileBytes, inputPath, replayAssets, uintArgument } from './replay-cli-lib.ts';
const args = process.argv.slice(2).filter((x) => x !== '--');
try {
  const files: string[] = []; let dump: string | undefined, out: string | undefined, tick: number | undefined, map: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--dump') { dump = args[++i]; if (!dump) throw new Error('--dump: Replay fehlt'); }
    else if (a === '--out') { out = args[++i]; if (!out) throw new Error('--out: Pfad fehlt'); }
    else if (a === '--tick') tick = uintArgument(args[++i], '--tick');
    else if (a === '--map') { map = args[++i]; if (!map) throw new Error('--map: Karte fehlt'); }
    else if (a.startsWith('-')) throw new Error(`Unbekannte Option ${a}`);
    else files.push(inputPath(a));
  }
  if (dump !== undefined) {
    if (files.length || out === undefined || tick === undefined) throw new Error('desync-diff --dump Replay --tick Tick --out Datei.rtsdump');
    const player = openReplayFile(fileBytes(inputPath(dump)), replayAssets(map)); player.runUntil(tick);
    writeFileSync(inputPath(out), writeStateDump(captureStateDump(player.world, { label: dump, simId: player.sim.simId })));
    console.log(`Zustand bei Tick ${tick}: ${inputPath(out)}`);
  } else {
    if (files.length !== 2 || out !== undefined || tick !== undefined) throw new Error('desync-diff <A.rtsreplay|faflog|rtsdump> <B> [--map Karte]');
    const a = fileBytes(files[0]!), b = fileBytes(files[1]!);
    if (a[0] === 82 && a[1] === 84 && a[2] === 83 && a[3] === 68) {
      const diff = diffStateDumps(readStateDump(a), readStateDump(b)); console.log(formatStateDiff(diff)); process.exitCode = diff.equal ? 0 : diff.layoutEqual ? 1 : 2;
    } else {
      const result = desyncDiff(a, b, replayAssets(map));
      console.log(`Erster unterschiedlicher Befehl: ${result.firstCommandTick ?? 'keiner'}; Aufnahme-Hash: ${result.firstRecordedTick ?? 'gleich'}; Sim-Tick: ${result.tick ?? 'gleich'}`);
      if (result.diff !== null) console.log(formatStateDiff(result.diff));
      if (result.status === 'recorded-only') console.log('Engine-/Build-Desync: Aufnahme weicht ab, Nachsimulation stimmt überein. Dump in der anderen Engine erzeugen (--dump).');
      process.exitCode = result.status === 'equal' ? 0 : result.status === 'explained' ? 1 : 3;
    }
  }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; }
