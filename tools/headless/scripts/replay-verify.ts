import { verifyReplayFile } from '../src/replay/verify.ts';
import { fileBytes, goldenReplayFiles, inputPath, replayAssets, uintArgument } from './replay-cli-lib.ts';
const args = process.argv.slice(2).filter((a) => a !== '--');
let json = false, map: string | undefined, untilTick: number | undefined;
const files: string[] = [];
try {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--json') json = true;
    else if (a === '--goldens') files.push(...goldenReplayFiles());
    else if (a === '--until') untilTick = uintArgument(args[++i], '--until');
    else if (a === '--map') { map = args[++i]; if (!map) throw new Error('--map: Pfad fehlt'); }
    else if (a.startsWith('-')) throw new Error(`Unbekannte Option ${a}`);
    else files.push(inputPath(a));
  }
  if (!files.length) throw new Error('replay-verify <Dateien...> [--goldens] [--map Karte.rtsmap] [--until Tick] [--json]');
  const assets = replayAssets(map), results: unknown[] = [];
  let code = 0;
  if (!json) console.log('Datei | Ticks | Hashes geprüft | Sub-Hashes | Ergebnis | Tempo x Echtzeit');
  for (const file of files) {
    try {
      const r = verifyReplayFile(fileBytes(file), assets, { ...(untilTick === undefined ? {} : { untilTick }), clock: () => performance.now() });
      results.push({ file, ...r });
      if (r.divergences.length) code = Math.max(code, 1);
      if (!json && r.divergences.length) { const d = r.divergences[0]!; console.error(`Tick ${d.tick}: erwartet 0x${d.expected.toString(16)}, ist 0x${d.actual.toString(16)}; Tabellen: ${d.regions.join(', ') || 'keine Sub-Hash-Abweichung'}`); }
      if (!json) console.log(`${file} | ${r.endTick} | ${r.compared} | ${r.subCompared} | ${r.divergences.length ? `Abweichung Tick ${r.divergences[0]!.tick}` : 'OK'} | ${r.xRealtime.toFixed(1)}x`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      code = Math.max(code, 2); results.push({ file, error: message });
      if (!json) console.error(`${file}: ${message}`);
    }
  }
  if (json) console.log(JSON.stringify(results, null, 2));
  process.exitCode = code;
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; }
