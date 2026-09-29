/**
 * CLI: pnpm sfx:analyze [files or dirs…] [--xcheck] [--json out.json] [--no-png]
 *
 * Per file: duration, peak, true peak, RMS, integrated loudness (BS.1770, K-weighted, gated), momentary
 * max, clipping, DC, spectral centroid. Writes a spectrogram+waveform PNG per file to
 * /private/tmp/claude-501/faf-sfx/ (view with an image viewer). Default input: content/audio/dist.
 * Opus/WebM and other formats are decoded through ffmpeg. --xcheck compares LUFS with ffmpeg's ebur128.
 */
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { type Analysis, analyze } from '../src/analysis.ts';
import { DIST_DIR, FFMPEG, pool } from '../src/pipeline.ts';
import type { Audio } from '../src/signal.ts';
import { spectrogramPng } from '../src/spectrogram.ts';
import { decodeWav } from '../src/wav.ts';
import { type Row, SPECTRO_DIR, USER_CWD, printTable } from './report.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    xcheck: { type: 'boolean', default: false },
    json: { type: 'string' },
    'no-png': { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});

async function collect(p: string): Promise<string[]> {
  if (!existsSync(p)) throw new Error(`nicht gefunden: ${p}`);
  if (!statSync(p).isDirectory()) return [p];
  const out: string[] = [];
  for (const e of await readdir(p, { withFileTypes: true })) {
    const q = path.join(p, e.name);
    if (e.isDirectory()) out.push(...(await collect(q)));
    else if (/\.(wav)$/i.test(e.name)) out.push(q);
  }
  return out.sort();
}

function run(args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (d: Buffer) => chunks.push(d));
    p.stderr.on('data', (d: Buffer) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve({ stdout: Buffer.concat(chunks), stderr: err }) : reject(new Error(`ffmpeg ${code}: ${err.slice(-400)}`))));
  });
}

async function load(file: string): Promise<{ audio: Audio; sr: number }> {
  if (/\.wav$/i.test(file)) {
    const d = decodeWav(new Uint8Array(await readFile(file)));
    return { audio: d.audio, sr: d.sampleRate };
  }
  // Decode anything else (webm/opus/ogg/mp3) through ffmpeg to 48 kHz float WAV.
  const { stdout } = await run(['-hide_banner', '-loglevel', 'error', '-i', file, '-ar', '48000', '-c:a', 'pcm_f32le', '-f', 'wav', 'pipe:1']);
  const d = decodeWav(new Uint8Array(stdout));
  return { audio: d.audio, sr: d.sampleRate };
}

/** Integrated loudness from ffmpeg's ebur128 filter (reference implementation). */
async function ffmpegLufs(file: string): Promise<number | null> {
  try {
    const { stderr } = await run(['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=framelog=quiet', '-f', 'null', '-']);
    const m = /Integrated loudness:\s*I:\s*(-?[\d.]+|-inf)\s*LUFS/.exec(stderr);
    return m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : null;
  } catch {
    return null;
  }
}

const inputs = positionals.length > 0 ? positionals.map((p) => path.resolve(USER_CWD, p)) : [DIST_DIR];
const files = (await Promise.all(inputs.map(collect))).flat();
if (files.length === 0) {
  console.error('[sfx:analyze] keine Dateien – erst `pnpm sfx` ausführen oder Pfade angeben');
  process.exit(1);
}

// Loudness targets from the manifest, if the files come from dist.
const targets = new Map<string, { lufs: number; mode: 'integrated' | 'momentary' }>();
const manifestPath = path.join(DIST_DIR, 'manifest.json');
if (existsSync(manifestPath)) {
  const m = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    sounds: { targetLufs: number; loudnessMode: 'integrated' | 'momentary'; variants: { wav: string; opus: string | null }[] }[];
  };
  for (const s of m.sounds) for (const v of s.variants) for (const f of [v.wav, v.opus]) if (f) targets.set(path.join(DIST_DIR, f), { lufs: s.targetLufs, mode: s.loudnessMode });
}

const spectroDir = values.out ? path.resolve(USER_CWD, values.out) : SPECTRO_DIR;
const results: (Analysis & { file: string; png: string | null; ffmpegLufs: number | null })[] = [];
await pool(files, 4, async (file) => {
  const { audio, sr } = await load(file);
  const a = analyze(audio, sr);
  let png: string | null = null;
  if (!values['no-png']) {
    const rel = file.startsWith(DIST_DIR) ? path.relative(DIST_DIR, file) : path.basename(file);
    png = path.join(spectroDir, rel.replace(/\.[^.]+$/, '.png'));
    await mkdir(path.dirname(png), { recursive: true });
    await writeFile(png, spectrogramPng(audio, { sr }));
  }
  results.push({ ...a, file, png, ffmpegLufs: values.xcheck ? await ffmpegLufs(file) : null });
});
results.sort((a, b) => a.file.localeCompare(b.file));

const rows: Row[] = results.map((r) => ({
  file: path.relative(USER_CWD, r.file),
  durationS: r.durationS,
  lufs: r.lufs,
  lufsM: r.lufsMomentaryMax,
  ...(targets.has(r.file) ? { target: targets.get(r.file)!.lufs, mode: targets.get(r.file)!.mode } : {}),
  peakDb: r.peakDb,
  truePeakDb: r.truePeakDb,
  rmsDb: r.rmsDb,
  centroidHz: r.centroidHz,
  clipped: r.clippedSamples,
  xcheck: r.ffmpegLufs,
}));
printTable(rows);
const clipped = results.filter((r) => r.clippedSamples > 0);
for (const r of clipped) console.warn(`[sfx:analyze] CLIPPING ${r.file}: ${r.clippedSamples} Samples`);
if (values.xcheck) {
  const diffs = results.filter((r) => r.ffmpegLufs !== null && Number.isFinite(r.ffmpegLufs) && !r.lufsShort).map((r) => Math.abs(r.lufs - r.ffmpegLufs!));
  if (diffs.length) console.log(`[sfx:analyze] LUFS vs. ffmpeg ebur128: max. Abweichung ${Math.max(...diffs).toFixed(2)} LU über ${diffs.length} Dateien (≥ 400 ms)`);
}
if (values.json) await writeFile(path.resolve(USER_CWD, values.json), JSON.stringify(results, null, 2));
if (!values['no-png']) console.log(`[sfx:analyze] Spektrogramme: ${spectroDir}`);
if (clipped.length > 0) process.exitCode = 1;
