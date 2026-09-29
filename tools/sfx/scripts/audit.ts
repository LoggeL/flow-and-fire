/**
 * CLI: pnpm sfx:audit [--json out.json] [--verbose]
 *
 * Gesamtprüfung aller Dateien in content/audio/dist (nach `pnpm sfx`). Geprüft wird jede Variante als WAV
 * und als dekodiertes Opus:
 * - Lautheit in der Messart des Sounds gegen das Ziel (Toleranz ±1,5 LU),
 * - True Peak ≤ Grenze (−1 dBTP),
 * - Loop-Nähte: Sprung, Klick-Energie (2. Differenz) und Pegelsprung an der Naht im Vergleich zum Rest,
 * - Unterschiedlichkeit der Varianten (Kreuzkorrelation + log-Spektral-Distanz),
 * - spektrale Nachbarschaft Alerts ↔ Waffen (nächster Nachbar in einem Merkmalsraum aus Bandenergien,
 *   Flachheit, Tonalität, Dauer und Anschlägen),
 * - Opus-Gesamtgröße (Budget 3 MB) und Abdeckung der SOUNDLIST.
 * Exit-Code 1 bei Verstößen.
 */
import { spawn } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loudness, truePeak } from '../src/analysis.ts';
import { fft, hann } from '../src/fft.ts';
import { AUDIO_ROOT, DIST_DIR, FFMPEG, type Manifest, type ManifestSound, type VariantEntry, findSfxFiles, idForFile, pool } from '../src/pipeline.ts';
import { type Audio, SR, gainToDb, isStereo } from '../src/signal.ts';
import { decodeWav } from '../src/wav.ts';
import { USER_CWD } from './report.ts';

const { values } = parseArgs({ options: { json: { type: 'string' }, verbose: { type: 'boolean', default: false } } });

const OPUS_BUDGET_BYTES = 3_000_000;
const LU_TOL = 1.5;
const TP_CEIL = -1;
/** Variants count as "too similar" above this cross-correlation (or above 0.6 with a near-identical spectrum). */
const XCORR_MAX = 0.85;

const mono = (a: Audio): Float32Array => (isStereo(a) ? a[0].map((v, i) => 0.5 * (v + (a[1][i] as number))) : a);
const first = (a: Audio): Float32Array => (isStereo(a) ? a[0] : a);

function decode(file: string): Promise<Audio> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-ar', String(SR), '-c:a', 'pcm_f32le', '-f', 'wav', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    p.stdout.on('data', (d: Buffer) => chunks.push(d));
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve(decodeWav(new Uint8Array(Buffer.concat(chunks))).audio) : reject(new Error(`ffmpeg ${c}: ${file}`))));
  });
}

interface Features {
  /** log10 of the relative energy in octave-ish bands. */
  bands: number[];
  flatness: number;
  tonality: number;
  onsets: number;
  centroidHz: number;
  /** Long-term power spectrum (2048-point bins). */
  spectrum: Float64Array;
}

const N_FFT = 2048;
const BANDS = [0, 90, 180, 350, 700, 1400, 2800, 5600, 11200, 24000];

function features(x: Float32Array): Features {
  const hop = 512;
  const w = hann(N_FFT);
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  const band = new Float64Array(BANDS.length - 1);
  const spectrum = new Float64Array(N_FFT / 2);
  const frameE: number[] = [];
  let weight = 0;
  let flatSum = 0;
  let tonalSum = 0;
  for (let s = 0; s < Math.max(1, x.length - N_FFT + hop); s += hop) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < N_FFT; i++) re[i] = (x[s + i] ?? 0) * (w[i] as number);
    fft(re, im);
    let e = 0;
    let logSum = 0;
    let lin = 0;
    let mx = 0;
    let cnt = 0;
    for (let k = 1; k < N_FFT / 2; k++) {
      const p = (re[k] as number) ** 2 + (im[k] as number) ** 2;
      spectrum[k] = (spectrum[k] as number) + p;
      const f = (k * SR) / N_FFT;
      for (let b = 0; b < band.length; b++) if (f >= (BANDS[b] as number) && f < (BANDS[b + 1] as number)) band[b] = (band[b] as number) + p;
      e += p;
      if (f > 60 && f < 12000) {
        logSum += Math.log(p + 1e-20);
        lin += p;
        cnt++;
        mx = Math.max(mx, p);
      }
    }
    frameE.push(e);
    if (cnt > 0 && lin > 0) {
      flatSum += (Math.exp(logSum / cnt) / (lin / cnt)) * e;
      tonalSum += (mx / lin) * e;
      weight += e;
    }
  }
  const tot = band.reduce((a, b) => a + b, 0) || 1;
  const maxE = Math.max(...frameE);
  let onsets = 0;
  for (let i = 1; i < frameE.length; i++) if ((frameE[i] as number) > (frameE[i - 1] as number) * 4 && (frameE[i] as number) > maxE * 0.01) onsets++;
  let cNum = 0;
  let cDen = 0;
  for (let k = 1; k < N_FFT / 2; k++) {
    cNum += (spectrum[k] as number) * ((k * SR) / N_FFT);
    cDen += spectrum[k] as number;
  }
  return {
    bands: [...band].map((b) => Math.log10(b / tot + 1e-6)),
    flatness: weight ? flatSum / weight : 1,
    tonality: weight ? tonalSum / weight : 0,
    onsets,
    centroidHz: cNum / (cDen || 1),
    spectrum,
  };
}

/** Maximum normalized cross-correlation within ±10 ms (first 1.5 s). */
function xcorrMax(a: Float32Array, b: Float32Array, maxLag = 480): number {
  const n = Math.min(a.length, b.length, SR * 1.5);
  let ea = 0;
  let eb = 0;
  for (let i = 0; i < n; i++) {
    ea += (a[i] as number) ** 2;
    eb += (b[i] as number) ** 2;
  }
  let best = 0;
  for (let lag = -maxLag; lag <= maxLag; lag += 4) {
    let s = 0;
    for (let i = Math.max(0, -lag); i < n && i + lag < n; i++) s += (a[i] as number) * (b[i + lag] as number);
    best = Math.max(best, Math.abs(s) / Math.sqrt(ea * eb + 1e-20));
  }
  return best;
}

/** RMS distance (dB) of two energy-normalized long-term spectra on 48 log bins, 60 Hz–16 kHz. */
function spectralDistance(a: Float64Array, b: Float64Array): number {
  const bins = 48;
  const agg = (s: Float64Array): number[] => {
    const o = new Float64Array(bins);
    let t = 0;
    for (let k = 1; k < N_FFT / 2; k++) {
      const f = (k * SR) / N_FFT;
      if (f < 60 || f > 16000) continue;
      const bi = Math.min(bins - 1, Math.floor((Math.log(f / 60) / Math.log(16000 / 60)) * bins));
      o[bi] = (o[bi] as number) + (s[k] as number);
      t += s[k] as number;
    }
    return [...o].map((v) => 10 * Math.log10(v / (t || 1) + 1e-9));
  };
  const A = agg(a);
  const B = agg(b);
  let s = 0;
  for (let i = 0; i < bins; i++) s += ((A[i] as number) - (B[i] as number)) ** 2;
  return Math.sqrt(s / bins);
}

interface Seam {
  /** Wrap step |x[start] − x[end−1]| relative to the 99.9th percentile of all sample steps. */
  wrapRatio: number;
  /** Click energy (2nd difference, 2 ms) at the seam relative to the 99th percentile elsewhere. */
  clickRatio: number;
  /** Level jump across the seam (30 ms RMS either side) and the 99th percentile of the same metric elsewhere. */
  levelJumpDb: number;
  levelJumpP99: number;
}

function seam(full: Float32Array, start: number, stop: number): Seam {
  const ch = full.subarray(start, stop);
  const n = ch.length;
  const at = (i: number): number => ch[((i % n) + n) % n] as number;
  const steps: number[] = [];
  for (let i = 1; i < n; i++) steps.push(Math.abs(at(i) - at(i - 1)));
  steps.sort((a, b) => a - b);
  const wrap = Math.abs(at(0) - at(n - 1));
  const W = 1440;
  const rms = (s: number, e: number): number => {
    let q = 0;
    for (let i = s; i < e; i++) q += at(i) ** 2;
    return Math.sqrt(q / (e - s));
  };
  const jumps: number[] = [];
  for (let c = W; c < n - W; c += 480) jumps.push(Math.abs(gainToDb(rms(c, c + W)) - gainToDb(rms(c - W, c))));
  jumps.sort((a, b) => a - b);
  const d2 = (i: number): number => at(i) - 2 * at(i - 1) + at(i - 2);
  const click = (c: number): number => {
    let q = 0;
    for (let i = c - 48; i < c + 48; i++) q += d2(i) ** 2;
    return q;
  };
  const clicks: number[] = [];
  for (let c = 200; c < n - 200; c += 97) clicks.push(click(c));
  clicks.sort((a, b) => a - b);
  return {
    wrapRatio: wrap / ((steps[Math.floor(steps.length * 0.999)] ?? 0) + 1e-12),
    clickRatio: click(0) / ((clicks[Math.floor(clicks.length * 0.99)] ?? 0) + 1e-20),
    levelJumpDb: gainToDb(rms(n - W, n)) - gainToDb(rms(0, W)),
    levelJumpP99: jumps[Math.floor(jumps.length * 0.99)] ?? 0,
  };
}

const seamOk = (s: Seam, wrapMax: number): boolean => s.wrapRatio <= wrapMax && s.clickRatio <= 3 && Math.abs(s.levelJumpDb) <= Math.max(1.5, s.levelJumpP99);

interface Row {
  id: string;
  category: string;
  variant: number;
  target: number;
  lufsWav: number;
  lufsOpus: number;
  tpWav: number;
  tpOpus: number;
  opusBytes: number;
  durationS: number;
  signal: Float32Array;
  f: Features;
  seamWav: Seam | null;
  seamOpus: Seam | null;
}

const manifest = JSON.parse(await readFile(path.join(DIST_DIR, 'manifest.json'), 'utf8')) as Manifest;
const rows: Row[] = [];
const jobs: { s: ManifestSound; v: VariantEntry }[] = manifest.sounds.flatMap((s) => s.variants.map((v) => ({ s, v })));
await pool(jobs, 6, async ({ s, v }) => {
  const wav = decodeWav(new Uint8Array(await readFile(path.join(DIST_DIR, v.wav)))).audio;
  const opus = v.opus ? await decode(path.join(DIST_DIR, v.opus)) : wav;
  const key = s.loudnessMode === 'integrated' ? 'integrated' : 'momentaryMax';
  let x = mono(wav);
  if (s.loop) x = x.slice(s.loop.startSample, s.loop.endSample);
  rows.push({
    id: s.id,
    category: s.category,
    variant: v.index,
    target: s.targetLufs,
    lufsWav: loudness(wav)[key],
    lufsOpus: loudness(opus)[key],
    tpWav: gainToDb(truePeak(wav)),
    tpOpus: gainToDb(truePeak(opus)),
    opusBytes: v.opus ? (await stat(path.join(DIST_DIR, v.opus))).size : 0,
    durationS: x.length / SR,
    signal: x,
    f: features(x),
    seamWav: s.loop ? seam(first(wav), s.loop.startSample, s.loop.endSample) : null,
    seamOpus: s.loop ? seam(first(opus), s.loop.startSample, Math.min(s.loop.endSample, first(opus).length)) : null,
  });
});
rows.sort((a, b) => a.id.localeCompare(b.id) || a.variant - b.variant);

const problems: string[] = [];
const out: string[] = [];
const say = (l: string): void => void out.push(l);
const fmt = (v: number, d = 2): string => (v >= 0 ? '+' : '') + v.toFixed(d);

say('Lautheit und True Peak je Kategorie (Δ zum Ziel in LU, Messart des Sounds; TP in dBTP)');
const cats = [...new Set(rows.map((r) => r.category))].sort();
for (const c of cats) {
  const rs = rows.filter((r) => r.category === c);
  const dw = rs.map((r) => r.lufsWav - r.target);
  const dop = rs.map((r) => r.lufsOpus - r.target);
  say(
    `  ${c.padEnd(11)} ${String(rs.length).padStart(3)} Dateien  WAV Δ ${fmt(Math.min(...dw))}…${fmt(Math.max(...dw))}  Opus Δ ${fmt(Math.min(...dop))}…${fmt(Math.max(...dop))}  TP max WAV ${Math.max(...rs.map((r) => r.tpWav)).toFixed(2)} Opus ${Math.max(...rs.map((r) => r.tpOpus)).toFixed(2)}`,
  );
}
for (const r of rows) {
  const n = `${r.id} v${r.variant}`;
  if (Math.abs(r.lufsWav - r.target) > LU_TOL) problems.push(`Lautheit WAV ${n}: ${r.lufsWav.toFixed(2)} LUFS (Ziel ${r.target})`);
  if (Math.abs(r.lufsOpus - r.target) > LU_TOL) problems.push(`Lautheit Opus ${n}: ${r.lufsOpus.toFixed(2)} LUFS (Ziel ${r.target})`);
  if (r.tpWav > TP_CEIL) problems.push(`True Peak WAV ${n}: ${r.tpWav.toFixed(2)} dBTP`);
  if (r.tpOpus > TP_CEIL) problems.push(`True Peak Opus ${n}: ${r.tpOpus.toFixed(2)} dBTP`);
}

say('\nLoop-Nähte (Sprung/p99.9, Klick/p99, Pegelsprung dB mit p99 im Rest)');
for (const r of rows.filter((x) => x.seamWav)) {
  const w = r.seamWav as Seam;
  const o = r.seamOpus as Seam;
  const ok = seamOk(w, 1) && seamOk(o, 1.5);
  if (!ok) problems.push(`Loop-Naht ${r.id} v${r.variant}`);
  if (!ok || values.verbose) {
    say(`  ${ok ? 'ok ' : 'NAHT'} ${r.id} v${r.variant}  WAV ${w.wrapRatio.toFixed(2)}/${w.clickRatio.toFixed(2)}/${fmt(w.levelJumpDb, 1)} (p99 ${w.levelJumpP99.toFixed(1)})  Opus ${o.wrapRatio.toFixed(2)}/${o.clickRatio.toFixed(2)}/${fmt(o.levelJumpDb, 1)}`);
  }
}
say(`  ${rows.filter((x) => x.seamWav).length} Loop-Varianten geprüft`);

say('\nVarianten (ähnlichstes Paar: max. Kreuzkorrelation, Spektral-Distanz dB)');
const ids = [...new Set(rows.map((r) => r.id))];
let pairs = 0;
for (const id of ids) {
  const vs = rows.filter((r) => r.id === id);
  if (vs.length < 2) continue;
  let worst = { xc: 0, sd: Infinity, pair: '' };
  for (let i = 0; i < vs.length; i++) {
    for (let j = i + 1; j < vs.length; j++) {
      const a = vs[i] as Row;
      const b = vs[j] as Row;
      const xc = xcorrMax(a.signal, b.signal);
      const sd = spectralDistance(a.f.spectrum, b.f.spectrum);
      pairs++;
      if (xc - sd / 10 > worst.xc - worst.sd / 10) worst = { xc, sd, pair: `v${a.variant}/v${b.variant}` };
    }
  }
  const similar = worst.xc > XCORR_MAX || (worst.xc > 0.6 && worst.sd < 0.8);
  if (similar) problems.push(`Varianten zu ähnlich ${id} ${worst.pair}`);
  if (similar || values.verbose) say(`  ${similar ? 'ÄHNLICH' : 'ok     '} ${id.padEnd(36)} ${worst.pair} xcorr ${worst.xc.toFixed(2)} Δspec ${worst.sd.toFixed(2)} dB`);
}
say(`  ${pairs} Variantenpaare geprüft`);

// Nearest neighbour in a standardized feature space (leave the own sound out).
const vec = (r: Row): number[] => [...r.f.bands, 2 * Math.log10(r.f.flatness + 1e-4), 2 * Math.log10(r.f.tonality + 1e-4), Math.log10(r.durationS), 0.5 * Math.log2(1 + r.f.onsets)];
const V = rows.map(vec);
const D = (V[0] ?? []).length;
const mu = Array.from({ length: D }, (_, d) => V.reduce((a, v) => a + (v[d] as number), 0) / V.length);
const sd = Array.from({ length: D }, (_, d) => Math.sqrt(V.reduce((a, v) => a + ((v[d] as number) - (mu[d] as number)) ** 2, 0) / V.length) || 1);
const Z = V.map((v) => v.map((x, d) => (x - (mu[d] as number)) / (sd[d] as number)));
const dist = (i: number, j: number): number => Math.sqrt((Z[i] as number[]).reduce((a, x, d) => a + (x - ((Z[j] as number[])[d] as number)) ** 2, 0));
const nearest = (i: number, pred: (r: Row) => boolean = () => true): { j: number; d: number } => {
  let best = { j: -1, d: Infinity };
  for (let j = 0; j < rows.length; j++) {
    const r = rows[j] as Row;
    if (r.id === (rows[i] as Row).id || !pred(r)) continue;
    const d = dist(i, j);
    if (d < best.d) best = { j, d };
  }
  return best;
};
say('\nSpektrale Unterscheidbarkeit (Mittel je Kategorie; nächster Nachbar Alerts ↔ Waffen)');
for (const c of cats) {
  const rs = rows.filter((r) => r.category === c);
  const m = (f: (r: Row) => number): number => rs.reduce((a, r) => a + f(r), 0) / rs.length;
  say(`  ${c.padEnd(11)} Schwerpunkt ${m((r) => r.f.centroidHz).toFixed(0).padStart(5)} Hz  Tonalität ${m((r) => r.f.tonality).toFixed(2)}  Anschläge ${m((r) => r.f.onsets).toFixed(1)}  Dauer ${m((r) => r.durationS).toFixed(2)} s`);
}
let minAlertWeapon = Infinity;
let minAlertAlert = Infinity;
for (let i = 0; i < rows.length; i++) {
  const r = rows[i] as Row;
  if (r.category !== 'alert' && r.category !== 'weapon') continue;
  const nn = nearest(i);
  const other = rows[nn.j] as Row;
  if ((r.category === 'alert' && other.category === 'weapon') || (r.category === 'weapon' && other.category === 'alert')) {
    problems.push(`Alert/Waffe verwechselbar: ${r.id} v${r.variant} ↔ ${other.id}`);
  }
  if (r.category === 'alert') {
    minAlertWeapon = Math.min(minAlertWeapon, nearest(i, (x) => x.category === 'weapon').d);
    minAlertAlert = Math.min(minAlertAlert, nearest(i, (x) => x.category === 'alert').d);
  }
}
say(`  kleinster Abstand Alert→Waffe ${minAlertWeapon.toFixed(2)}, Alert→Alert ${minAlertAlert.toFixed(2)} (z-Einheiten)`);

say('\nGröße (Opus/WebM)');
const total = rows.reduce((a, r) => a + r.opusBytes, 0);
for (const c of cats) say(`  ${c.padEnd(11)} ${(rows.filter((r) => r.category === c).reduce((a, r) => a + r.opusBytes, 0) / 1e3).toFixed(0).padStart(5)} kB`);
say(`  gesamt ${(total / 1e6).toFixed(3)} MB in ${rows.length} Dateien (${ids.length} Sounds), Budget ${OPUS_BUDGET_BYTES / 1e6} MB`);
if (total > OPUS_BUDGET_BYTES) problems.push(`Opus-Gesamtgröße ${(total / 1e6).toFixed(2)} MB > ${OPUS_BUDGET_BYTES / 1e6} MB`);

// SOUNDLIST coverage: every id in a table row must exist as a .sfx.ts file and vice versa.
const list = await readFile(path.join(AUDIO_ROOT, 'SOUNDLIST.md'), 'utf8');
const listed = new Set<string>();
for (const line of list.split('\n')) {
  const m = /^\|[^|]*\|\s*`([a-z][a-z0-9_]*:[a-z][a-z0-9_]*)`/.exec(line);
  if (m) listed.add(m[1] as string);
}
const files = new Set((await findSfxFiles()).map((f) => idForFile(f)));
const missing = [...listed].filter((id) => !files.has(id));
const unlisted = [...files].filter((id) => !listed.has(id));
const unbuilt = [...files].filter((id) => !ids.includes(id));
for (const id of missing) problems.push(`SOUNDLIST: ${id} fehlt als Datei`);
for (const id of unlisted) problems.push(`SOUNDLIST: ${id} nicht gelistet`);
for (const id of unbuilt) problems.push(`nicht gebaut: ${id} (pnpm sfx)`);
say(`\nSOUNDLIST: ${listed.size} Einträge, ${files.size} Sound-Dateien, ${missing.length} fehlen, ${unlisted.length} nicht gelistet`);

say(problems.length ? `\n${problems.length} Verstöße:\n${problems.map((p) => `  - ${p}`).join('\n')}` : '\nKeine Verstöße.');
console.log(out.join('\n'));
if (values.json) {
  const json = rows.map(({ signal: _s, f, seamWav, seamOpus, ...r }) => ({ ...r, centroidHz: Math.round(f.centroidHz), tonality: f.tonality, onsets: f.onsets, seamWav, seamOpus }));
  await writeFile(path.resolve(USER_CWD, values.json), JSON.stringify({ problems, totalOpusBytes: total, rows: json }, null, 2));
}
if (problems.length) process.exitCode = 1;
