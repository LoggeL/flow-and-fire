/**
 * Node-side build pipeline: discover content/audio/**\/*.sfx.ts, render variants in a worker pool,
 * write 24-bit WAV + Opus/WebM (ffmpeg), incremental cache, manifest.json (+ manifest.js for the preview).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { Analysis } from './analysis.ts';
import { CATEGORIES, MAX_VOICES } from './categories.ts';
import { ID_RE, type SfxDefinition, resolveSettings, splitId } from './define.ts';
import { renderVariant } from './render.ts';
import { SR } from './signal.ts';
import { encodeWav } from './wav.ts';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const AUDIO_ROOT = path.join(REPO_ROOT, 'content/audio');
export const DIST_DIR = path.join(AUDIO_ROOT, 'dist');
export const FFMPEG = process.env.FAF_FFMPEG ?? (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');
export const MANIFEST_VERSION = 1;

export interface VariantEntry {
  index: number;
  wav: string;
  opus: string | null;
  samples: number;
  durationS: number;
  /** Loudness in the sound's loudnessMode (the value normalized to targetLufs). */
  lufs: number;
  lufsIntegrated: number;
  lufsMomentaryMax: number;
  truePeakDb: number;
  /** Peak reduction applied by the limiter (dB). */
  limitedDb: number;
  centroidHz: number;
  sha1: string;
}

export interface ManifestSound {
  id: string;
  scope: string;
  name: string;
  category: string;
  bus: string;
  description: string;
  channels: 1 | 2;
  spatial: boolean;
  /** Longest variant. */
  durationS: number;
  loop: { startSample: number; endSample: number; startS: number; endS: number } | null;
  priority: number;
  cooldownMs: number;
  maxVoices: number;
  targetLufs: number;
  /** 'momentary' = max. momentary loudness (400 ms, one-shots), 'integrated' = gated integrated (loops). */
  loudnessMode: 'integrated' | 'momentary';
  tags: string[];
  variants: VariantEntry[];
  warnings: string[];
}

export interface Manifest {
  version: number;
  generator: string;
  sampleRate: number;
  maxVoices: number;
  categories: typeof CATEGORIES;
  sounds: ManifestSound[];
}

/** Recursively list *.sfx.ts under the audio root (dist excluded). */
export async function findSfxFiles(root = AUDIO_ROOT): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'dist' && !e.name.startsWith('.')) await walk(p);
      } else if (e.name.endsWith('.sfx.ts')) out.push(p);
    }
  };
  if (existsSync(root)) await walk(root);
  return out.sort();
}

/** Expected id for a definition file: <scope>/<name>.sfx.ts → "scope:name". */
export function idForFile(file: string, root = AUDIO_ROOT): string {
  const rel = path.relative(root, file).split(path.sep);
  if (rel.length !== 2) throw new Error(`${file}: erwartet content/audio/<scope>/<name>.sfx.ts`);
  return `${rel[0]}:${rel[1]!.replace(/\.sfx\.ts$/, '')}`;
}

export async function loadDefinition(file: string, root = AUDIO_ROOT): Promise<SfxDefinition> {
  const mod = (await import(pathToFileURL(file).href)) as { default?: SfxDefinition };
  const def = mod.default;
  if (!def || typeof def.render !== 'function') throw new Error(`${file}: default export muss defineSfx({...}) sein`);
  const expected = idForFile(file, root);
  if (def.id !== expected) throw new Error(`${file}: id "${def.id}" passt nicht zum Pfad (erwartet "${expected}")`);
  if (!ID_RE.test(def.id)) throw new Error(`${file}: ungültige id`);
  return def;
}

async function hashFiles(files: readonly string[]): Promise<string> {
  const h = createHash('sha1');
  for (const f of [...files].sort()) {
    h.update(path.relative(REPO_ROOT, f));
    h.update(await readFile(f));
  }
  return h.digest('hex');
}

/** Hash of everything that can change the output except the individual .sfx.ts file. */
export async function engineHash(): Promise<string> {
  const srcDir = path.join(REPO_ROOT, 'tools/sfx/src');
  const src = (await readdir(srcDir)).filter((f) => f.endsWith('.ts')).map((f) => path.join(srcDir, f));
  // Shared helpers inside content/audio (anything .ts that is not a sound definition).
  const helpers: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (!existsSync(dir)) return;
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'dist') await walk(p);
      } else if (e.name.endsWith('.ts') && !e.name.endsWith('.sfx.ts')) helpers.push(p);
    }
  };
  await walk(AUDIO_ROOT);
  return hashFiles([...src, ...helpers]);
}

export interface RenderJob {
  file: string;
  variant: number;
  /** Audio root the file lives in (id = <scope>:<name> relative to it). */
  root: string;
}

export interface RenderResult {
  file: string;
  variant: number;
  wav: Uint8Array;
  samples: number;
  analysis: Analysis;
  loudnessMode: 'integrated' | 'momentary';
  lufs: number;
  limitedDb: number;
  loop: { start: number; end: number } | null;
  warnings: string[];
}

/** Render one variant in this thread. */
export async function renderJob(job: RenderJob): Promise<RenderResult> {
  const def = await loadDefinition(job.file, job.root);
  const r = renderVariant(def, job.variant, SR);
  const wav = encodeWav(r.audio, SR, 'pcm24');
  const samples = Array.isArray(r.audio) ? r.audio[0].length : r.audio.length;
  return { file: job.file, variant: job.variant, wav, samples, analysis: r.analysis, loudnessMode: r.loudnessMode, lufs: r.lufs, limitedDb: r.limitedDb, loop: r.loop, warnings: r.warnings };
}

/** Render jobs with a pool of worker threads (falls back to in-thread for jobs = 1). */
export async function renderAll(jobs: readonly RenderJob[], threads: number, onDone?: (r: RenderResult) => void): Promise<RenderResult[]> {
  const results: RenderResult[] = [];
  if (threads <= 1 || jobs.length <= 1) {
    for (const j of jobs) {
      const r = await renderJob(j);
      onDone?.(r);
      results.push(r);
    }
    return results;
  }
  const queue = [...jobs];
  const workerUrl = new URL('./render-worker.ts', import.meta.url);
  const run = (): Promise<void> =>
    new Promise((resolve, reject) => {
      // Workers inherit process.execArgv (`--import tsx`), so they can load TypeScript.
      const w = new Worker(workerUrl);
      const next = (): void => {
        const j = queue.shift();
        if (!j) {
          void w.terminate().then(() => resolve());
          return;
        }
        w.postMessage(j);
      };
      w.on('message', (msg: { ok: true; result: RenderResult } | { ok: false; error: string }) => {
        if (!msg.ok) {
          void w.terminate();
          reject(new Error(msg.error));
          return;
        }
        onDone?.(msg.result);
        results.push(msg.result);
        next();
      });
      w.on('error', reject);
      next();
    });
  await Promise.all(Array.from({ length: Math.min(threads, jobs.length) }, run));
  return results;
}

/** Encode a WAV file to Opus in WebM with bit-exact, metadata-free output. */
export function encodeOpus(wavPath: string, outPath: string, channels: 1 | 2): Promise<void> {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', wavPath,
    '-map_metadata', '-1',
    '-c:a', 'libopus',
    '-b:a', channels === 1 ? '64k' : '96k',
    '-vbr', 'on',
    '-compression_level', '10',
    '-application', 'audio',
    '-frame_duration', '20',
    '-fflags', '+bitexact',
    '-flags:a', '+bitexact',
    '-f', 'webm',
    outPath,
  ];
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d: Buffer) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg (${code}): ${err.trim()}`))));
  });
}

/** Run async tasks with bounded concurrency. */
export async function pool<T>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const q = [...items];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, q.length)) }, async () => {
      for (let it = q.shift(); it !== undefined; it = q.shift()) await fn(it);
    }),
  );
}

interface CacheEntry {
  key: string;
  sound: ManifestSound;
}

interface Cache {
  version: number;
  entries: Record<string, CacheEntry>;
}

export interface BuildOptions {
  /** Only ids matching this substring/regex (others keep their cached manifest entry). */
  filter?: RegExp;
  opus?: boolean;
  /** Render threads. */
  threads?: number;
  /** Re-render the selected sounds even if cached. */
  force?: boolean;
  outDir?: string;
  /** Audio root with <scope>/<name>.sfx.ts (default content/audio). */
  root?: string;
  log?: (line: string) => void;
}

export interface BuildReport {
  manifest: Manifest;
  rendered: string[];
  cached: string[];
  warnings: { id: string; warning: string }[];
  ms: number;
}

/**
 * Suggested worker count: at most 6 threads and 2 cores headroom. A render worker needs well under
 * 100 MB, but the dev Mac has no swap, so drop to 2 threads when free memory is scarce.
 */
export function defaultThreads(): number {
  const n = Math.max(1, Math.min(6, os.availableParallelism() - 2));
  return os.freemem() < 512 * 2 ** 20 ? Math.min(2, n) : n;
}

export async function build(o: BuildOptions = {}): Promise<BuildReport> {
  const t0 = performance.now();
  const log = o.log ?? ((): void => {});
  const out = o.outDir ?? DIST_DIR;
  const opus = o.opus ?? true;
  await mkdir(out, { recursive: true });
  const cachePath = path.join(out, '.cache.json');
  let cache: Cache = { version: MANIFEST_VERSION, entries: {} };
  if (existsSync(cachePath)) {
    try {
      cache = JSON.parse(await readFile(cachePath, 'utf8')) as Cache;
    } catch {
      /* rebuild */
    }
  }
  const root = o.root ?? AUDIO_ROOT;
  const files = await findSfxFiles(root);
  const engine = await engineHash();
  const defs = new Map<string, { file: string; def: SfxDefinition; key: string }>();
  for (const file of files) {
    const def = await loadDefinition(file, root);
    if (defs.has(def.id)) throw new Error(`doppelte id ${def.id}`);
    const key = createHash('sha1')
      .update(engine)
      .update(await readFile(file))
      .update(opus ? 'opus' : 'wav')
      .digest('hex');
    defs.set(def.id, { file, def, key });
  }
  const todo: string[] = [];
  const cached: string[] = [];
  for (const [id, d] of defs) {
    const c = cache.entries[id];
    const selected = !o.filter || o.filter.test(id);
    const filesPresent = c?.sound.variants.every((v) => existsSync(path.join(out, v.wav)) && (!v.opus || existsSync(path.join(out, v.opus))));
    // --force re-renders the selected sounds (all without filter); unselected ones keep their cache entry.
    if (c && filesPresent && ((c.key === d.key && !o.force) || !selected)) cached.push(id);
    else if (selected || !c) todo.push(id);
  }
  const jobs: RenderJob[] = todo.flatMap((id) => {
    const d = defs.get(id)!;
    return Array.from({ length: d.def.variants }, (_, v) => ({ file: d.file, variant: v, root }));
  });
  const threads = o.threads ?? defaultThreads();
  log(`[sfx] ${defs.size} Sounds, ${todo.length} zu rendern (${jobs.length} Varianten, ${threads} Threads), ${cached.length} aus dem Cache`);
  const results = await renderAll(jobs, threads);
  const byId = new Map<string, RenderResult[]>();
  for (const r of results) {
    const id = idForFile(r.file, root);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id)!.push(r);
  }
  const warnings: BuildReport['warnings'] = [];
  const encodes: { wav: string; opus: string; channels: 1 | 2 }[] = [];
  const fresh = new Map<string, ManifestSound>();
  for (const id of todo) {
    const d = defs.get(id)!;
    const s = resolveSettings(d.def);
    const { scope, name } = splitId(id);
    await mkdir(path.join(out, scope), { recursive: true });
    // Remove stale variant files of this sound (variant count may have shrunk).
    for (const f of existsSync(path.join(out, scope)) ? await readdir(path.join(out, scope)) : []) {
      if (f.startsWith(`${name}.v`)) await rm(path.join(out, scope, f));
    }
    const rs = (byId.get(id) ?? []).sort((a, b) => a.variant - b.variant);
    const variants: VariantEntry[] = [];
    const sw: string[] = [];
    for (const r of rs) {
      const wavRel = `${scope}/${name}.v${r.variant}.wav`;
      const opusRel = opus ? `${scope}/${name}.v${r.variant}.webm` : null;
      await writeFile(path.join(out, wavRel), r.wav);
      if (opusRel) encodes.push({ wav: path.join(out, wavRel), opus: path.join(out, opusRel), channels: s.channels });
      variants.push({
        index: r.variant,
        wav: wavRel,
        opus: opusRel,
        samples: r.samples,
        durationS: round(r.analysis.durationS, 4),
        lufs: round(r.lufs, 2),
        lufsIntegrated: round(r.analysis.lufs, 2),
        lufsMomentaryMax: round(r.analysis.lufsMomentaryMax, 2),
        truePeakDb: round(r.analysis.truePeakDb, 2),
        limitedDb: round(r.limitedDb, 2),
        centroidHz: Math.round(r.analysis.centroidHz),
        sha1: createHash('sha1').update(r.wav).digest('hex'),
      });
      for (const w of r.warnings) sw.push(`v${r.variant}: ${w}`);
    }
    const loop = rs[0]?.loop ?? null;
    const sound: ManifestSound = {
      id,
      scope,
      name,
      category: d.def.category,
      bus: s.bus,
      description: d.def.description ?? '',
      channels: s.channels,
      spatial: s.spatial,
      durationS: round(Math.max(...variants.map((v) => v.durationS)), 4),
      loop: loop ? { startSample: loop.start, endSample: loop.end, startS: loop.start / SR, endS: round(loop.end / SR, 6) } : null,
      priority: s.priority,
      cooldownMs: s.cooldownMs,
      maxVoices: s.maxVoices,
      targetLufs: s.targetLufs,
      loudnessMode: d.def.loop ? 'integrated' : 'momentary',
      tags: [...(d.def.tags ?? [])],
      variants,
      warnings: sw,
    };
    fresh.set(id, sound);
    for (const w of sw) warnings.push({ id, warning: w });
  }
  if (encodes.length > 0) {
    log(`[sfx] Opus/WebM: ${encodes.length} Dateien (${Math.min(8, os.availableParallelism())} parallel)`);
    await pool(encodes, Math.min(8, os.availableParallelism()), (e) => encodeOpus(e.wav, e.opus, e.channels));
  }
  const sounds: ManifestSound[] = [];
  const entries: Record<string, CacheEntry> = {};
  for (const [id, d] of [...defs].sort(([a], [b]) => a.localeCompare(b))) {
    const sound = fresh.get(id) ?? cache.entries[id]!.sound;
    sounds.push(sound);
    entries[id] = { key: fresh.has(id) ? d.key : cache.entries[id]!.key, sound };
    if (!fresh.has(id)) for (const w of sound.warnings) warnings.push({ id, warning: w });
  }
  // Remove outputs of deleted definitions.
  for (const id of Object.keys(cache.entries)) {
    if (!defs.has(id)) for (const v of cache.entries[id]!.sound.variants) for (const f of [v.wav, v.opus]) if (f) await rm(path.join(out, f), { force: true });
  }
  const manifest: Manifest = { version: MANIFEST_VERSION, generator: '@faf/sfx', sampleRate: SR, maxVoices: MAX_VOICES, categories: CATEGORIES, sounds };
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(path.join(out, 'manifest.js'), `// generiert von @faf/sfx – für die Vorschau (file:// ohne fetch)\nwindow.FAF_SFX_MANIFEST = ${JSON.stringify(manifest)};\n`);
  await writeFile(cachePath, JSON.stringify({ version: MANIFEST_VERSION, entries } satisfies Cache));
  return { manifest, rendered: todo, cached, warnings, ms: performance.now() - t0 };
}

function round(v: number, d: number): number {
  if (!Number.isFinite(v)) return v;
  const k = 10 ** d;
  return Math.round(v * k) / k;
}
