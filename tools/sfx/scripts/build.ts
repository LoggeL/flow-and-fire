/**
 * CLI: pnpm sfx [--only <regex>] [--force] [--no-opus] [--threads N] [--spectro] [--strict]
 *
 * Renders all content/audio/<scope>/<name>.sfx.ts to content/audio/dist (WAV 48 kHz/24 bit + Opus/WebM)
 * and writes manifest.json. --spectro also writes spectrogram PNGs to /private/tmp/claude-501/faf-sfx/.
 * --strict exits with code 1 on any warning (CI).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DIST_DIR, build, pool } from '../src/pipeline.ts';
import { decodeWav } from '../src/wav.ts';
import { spectrogramPng } from '../src/spectrogram.ts';
import { SPECTRO_DIR, USER_CWD, printTable } from './report.ts';

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    force: { type: 'boolean', default: false },
    'no-opus': { type: 'boolean', default: false },
    threads: { type: 'string' },
    spectro: { type: 'boolean', default: false },
    strict: { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});

const report = await build({
  ...(values.only ? { filter: new RegExp(values.only) } : {}),
  force: values.force,
  opus: !values['no-opus'],
  ...(values.threads ? { threads: Math.max(1, Number(values.threads)) } : {}),
  ...(values.out ? { outDir: path.resolve(USER_CWD, values.out) } : {}),
  log: (l) => console.log(l),
});

const outDir = values.out ? path.resolve(USER_CWD, values.out) : DIST_DIR;
printTable(
  report.manifest.sounds.flatMap((s) =>
    s.variants.map((v) => ({ file: v.wav, category: s.category, durationS: v.durationS, lufs: v.lufs, truePeakDb: v.truePeakDb, target: s.targetLufs })),
  ),
);

if (values.spectro) {
  const wavs = report.manifest.sounds.filter((s) => !values.only || new RegExp(values.only).test(s.id)).flatMap((s) => s.variants.map((v) => v.wav));
  await pool(wavs, 4, async (rel) => {
    const { audio, sampleRate } = decodeWav(new Uint8Array(await readFile(path.join(outDir, rel))));
    const png = path.join(SPECTRO_DIR, rel.replace(/\.wav$/, '.png'));
    await mkdir(path.dirname(png), { recursive: true });
    await writeFile(png, spectrogramPng(audio, { sr: sampleRate }));
  });
  console.log(`[sfx] Spektrogramme: ${SPECTRO_DIR}`);
}

for (const w of report.warnings) console.warn(`[sfx] WARNUNG ${w.id} ${w.warning}`);
console.log(
  `[sfx] fertig in ${(report.ms / 1000).toFixed(1)} s: ${report.rendered.length} gerendert, ${report.cached.length} aus dem Cache, ${report.warnings.length} Warnungen → ${path.relative(USER_CWD, path.join(outDir, 'manifest.json'))}`,
);
if (values.strict && report.warnings.length > 0) process.exit(1);
