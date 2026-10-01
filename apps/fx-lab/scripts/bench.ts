/** Three-engine, real-frame FX benchmark. No preview server or reserved ports. */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { cpus, platform, arch, totalmem, loadavg } from 'node:os';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';
import { APP, REPO, ORIGIN, GL_ERROR, launchConfig, ready, serve } from './browser.ts';
import type { FxLabSample } from '../src/app/hooks.ts';
import type { Browser } from '@playwright/test';
const args = process.argv.slice(2);
const flag = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const quick = args.includes('--quick');
const engines = (flag('browsers') ?? (quick ? 'chromium' : 'chromium,firefox,webkit')).split(',');
const seconds = Number(flag('seconds') ?? (quick ? 3 : 8));
const warmup = Number(flag('warmup') ?? (quick ? 1 : 2));
const repeats = Number(flag('runs') ?? (quick ? 1 : 2));
if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(warmup) || warmup < 0 || !Number.isInteger(repeats) || repeats < 1) throw new Error('seconds > 0, warmup >= 0 and integer runs >= 1 are required');
const scenarios: Record<string, string> = {
  battle: 'scene=battle&preset=medium', battlelow: 'scene=battle&preset=low',
  shields: 'scene=shields&preset=medium', big: 'scene=big&preset=medium',
  lightingcsm: 'scene=lighting&csm=1', lightingnocsm: 'scene=lighting&csm=0',
  battleldr: 'scene=battle&hdr=0',
};
const selected = (flag('scenarios') ?? (quick ? 'battle,shields,big' : Object.keys(scenarios).join(','))).split(',');
const shots = resolve(REPO, 'test-results/fx-bench'), results = resolve(APP, 'results');
mkdirSync(shots, { recursive: true }); mkdirSync(results, { recursive: true });
function foreignLoad(): string[] {
  const lines = execFileSync('ps', ['-axo', 'pid=,pcpu=,command='], { encoding: 'utf8' }).split('\n');
  return lines.filter(line => {
    const m = /^\s*(\d+)\s+([\d.]+)\s+(.*)$/.exec(line);
    if (!m || m[1] === String(process.pid) || Number(m[2]) < 1) return false;
    const executable = m[3]!.split(/\s+/, 1)[0]!.split('/').at(-1)!;
    // A curl URL or a shell reading an MLX source file is not a running MLX workload.
    return /^(?:node|pnpm|bun|python[\d.]*|mlx[\w.-]*|vitest|playwright|tsc)$/.test(executable)
      && /playwright test|vitest|mlx|tsc -b|vite build|scripts\/bench|scripts\/spk4|scripts\/smoke/.test(m[3]!);
  }).map(s => s.trim());
}
const wait = Number(flag('wait') ?? 0), waitStart = Date.now();
while (foreignLoad().length && Date.now() - waitStart < wait * 1000) await new Promise(r => setTimeout(r, 1000));
if (!args.includes('--no-build')) await build({ configFile: resolve(APP, 'vite.config.ts') });
const pct = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)]!;
  return { mean: values.reduce((sum, value) => sum + value, 0) / values.length, p50: p(0.5), p95: p(0.95), p99: p(0.99), max: sorted[sorted.length - 1] };
};
const report = { date: new Date().toISOString(), quick, warmup, seconds, repeats, machine: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, memory: totalmem(), load: loadavg() }, foreignLoad: foreignLoad(), browsers: [] as { engine: string; version: string; scenarios: Record<string, unknown>[]; errors: string[] }[] };
const digest = createHash('sha256');
function hashTree(dir: string): void { for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) { const path = resolve(dir, entry.name); if (entry.isDirectory()) hashTree(path); else { digest.update(path); digest.update(readFileSync(path)); } } }
hashTree(resolve(APP, 'dist')); for (const file of ['scripts/bench.ts', 'scripts/browser.ts', 'vite.config.ts']) digest.update(readFileSync(resolve(APP, file))); digest.update(`${process.platform}/${process.arch}/${process.version}`); digest.update(JSON.stringify({ engines, selected, seconds, warmup, repeats, quick, cpu: report.machine.cpu }));
const fingerprint = digest.digest('hex'), checkpoint = resolve(results, `fx-incomplete${quick ? '-quick' : ''}.json`);
if (existsSync(checkpoint)) { const saved = JSON.parse(readFileSync(checkpoint, 'utf8')) as { fingerprint?: string; report?: typeof report }; if (saved.fingerprint === fingerprint && Array.isArray(saved.report?.browsers)) { report.browsers.push(...saved.report.browsers); report.date = saved.report.date; report.foreignLoad = saved.report.foreignLoad; } }
function persist(): void { writeFileSync(checkpoint + '.tmp', JSON.stringify({ fingerprint, report }, null, 2)); renameSync(checkpoint + '.tmp', checkpoint); }
let failed = false;
for (const engine of engines) {
  let browser: Browser | null = null;
  const br = report.browsers.find(b => b.engine === engine) ?? { engine, version: '', scenarios: [] as Record<string, unknown>[], errors: [] as string[] }; if (!report.browsers.includes(br)) report.browsers.push(br);
  try {
    const cfg = launchConfig(engine); browser = await cfg.type.launch(cfg.options); const version = browser.version(); if (br.version !== version) { br.scenarios.length = 0; br.errors.length = 0; } br.version = version; br.errors.length = 0;
    for (const name of selected) for (let run = 1; run <= repeats; run++) {
      if (!scenarios[name]) throw new Error(`Unknown scenario ${name}`);
      const previous = br.scenarios.find(s => s['scenario'] === name && s['run'] === run);
      if (previous && Array.isArray(previous['errors']) && previous['errors'].length === 0 && Number(previous['frames']) > 0) { console.log(`Resumed ${engine}/${name}/${run}`); continue; }
      if (previous) br.scenarios.splice(br.scenarios.indexOf(previous), 1);
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      const errors: string[] = [], loadBefore = foreignLoad();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' || GL_ERROR.test(m.text())) errors.push(m.text()); });
      try {
        await serve(page); await page.goto(`${ORIGIN}/?${scenarios[name]}&bench=1&seed=77&flight=1`); await ready(page);
        await page.waitForTimeout(warmup * 1000); await page.evaluate(() => window.__fxlab!.resetSamples());
        await page.waitForTimeout(seconds * 1000);
        const measured = await page.evaluate(() => ({ stats: window.__fxlab!.stats(), samples: window.__fxlab!.samples(), error: window.__fxlab!.error }));
        const s = measured.samples as FxLabSample[];
        if (measured.error) errors.push(measured.error);
        const fxDraws = measured.stats.drawsBySeg.shields + measured.stats.drawsBySeg.particles + measured.stats.drawsBySeg.beams;
        if (fxDraws > 6 || s.some(v => v.draws > 40 || v.fxDraws > 6)) errors.push(`Draw budget: FX ${fxDraws}, total ${measured.stats.draws}`);
        if (!s.length) errors.push('No frame samples');
        const summary = {
          scenario: name, run, frames: s.length, stats: measured.stats,
          frameMs: pct(s.map(v => v.frameMs)), fps: pct(s.map(v => 1000 / v.frameMs)),
          mainJsMs: pct(s.map(v => v.mainJsMs)), fxJsMs: pct(s.map(v => v.fxJsMs)), labJsMs: pct(s.map(v => v.labJsMs)),
          draws: pct(s.map(v => v.draws)), fxDraws: pct(s.map(v => v.fxDraws)), particlesAlive: pct(s.map(v => v.particlesAlive)),
          gpuMs: pct(s.flatMap(v => v.gpuMs === null ? [] : [v.gpuMs])),
          gpuSegments: Object.fromEntries(['shadow', 'opaque', 'shields', 'particles', 'beams', 'post'].map(seg => [seg, pct(s.flatMap(v => { const n = v.gpuSeg[seg as keyof FxLabSample['gpuSeg']]; return n === null ? [] : [n]; }))])),
          loadBefore, loadAfter: foreignLoad(), errors,
        };
        br.scenarios.push(summary); failed ||= errors.length > 0; persist();
        await page.locator('canvas').screenshot({ path: resolve(shots, `${name}-${engine}-${run}.png`) });
        console.log(`${engine}/${name}/${run}: ${s.length} frames, main p95 ${summary.mainJsMs?.p95.toFixed(2)}ms, FX p95 ${summary.fxJsMs?.p95.toFixed(2)}ms, particles median ${summary.particlesAlive?.p50}, errors ${errors.length}`);
      } catch (e) { failed = true; br.scenarios.push({ scenario: name, run, errors: [...errors, String(e)] }); console.error(`${engine}/${name}: ${String(e)}`); }
      finally { await page.close(); }
    }
  } catch (e) { failed = true; br.errors.push(String(e)); console.error(`${engine}: ${String(e)}`); }
  finally { if (browser) await browser.close(); }
}
failed ||= report.browsers.some(b => b.errors.length > 0 || selected.some(name => Array.from({length: repeats}, (_,i) => i + 1).some(run => !b.scenarios.some(s => s['scenario'] === name && s['run'] === run && Number(s['frames']) > 0 && Array.isArray(s['errors']) && s['errors'].length === 0))));
const file = resolve(results, `fx-${new Date().toISOString().slice(0, 10)}${quick ? '-quick' : ''}.json`);
writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
if (args.includes('--update-docs')) {
  const path = resolve(REPO, 'docs/status/track-renderfx.md');
  const triple = (p: ReturnType<typeof pct>) => p ? `${p.p50.toFixed(2)} / ${p.p95.toFixed(2)} / ${p.p99.toFixed(2)}` : 'n/v';
  const rows = report.browsers.flatMap(b => b.scenarios.map(s => `| ${b.engine} | ${s['scenario']} | ${s['run']} | ${['frameMs', 'mainJsMs', 'fxJsMs', 'labJsMs', 'gpuMs'].map(k => triple(s[k] as ReturnType<typeof pct>)).join(' | ')} |`));
  const gpuRows = report.browsers.flatMap(b => b.scenarios.map(s => {
    const g = s['gpuSegments'] as Record<string, ReturnType<typeof pct>> | undefined;
    return `| ${b.engine} | ${s['scenario']} | ${s['run']} | ${['shadow', 'opaque', 'shields', 'particles', 'beams', 'post'].map(k => g?.[k]?.p95.toFixed(3) ?? 'n/v').join(' | ')} |`;
  }));
  const budgetRows = report.browsers.flatMap(b => b.scenarios.map(s => {
    const p = (s['stats'] as { fx: { particles: { cap: number; dropped: number[] } | null } } | undefined)?.fx.particles;
    const draws = s['draws'] as ReturnType<typeof pct>, fx = s['fxDraws'] as ReturnType<typeof pct>, alive = s['particlesAlive'] as ReturnType<typeof pct>;
    return `| ${b.engine} | ${s['scenario']} | ${s['run']} | ${draws ? `${draws.p50} / ${draws.max}` : 'n/v'} | ${fx ? `${fx.p50} / ${fx.max}` : 'n/v'} | ${alive ? `${alive.mean.toFixed(1)} / ${alive.p50}` : 'n/v'} | ${p?.cap ?? 'n/v'} | ${p?.dropped.join(' / ') ?? 'n/v'} |`;
  }));
  const contention = report.foreignLoad.length > 0 || report.browsers.some(b => b.scenarios.some(s => (s['loadBefore'] as string[] | undefined)?.length || (s['loadAfter'] as string[] | undefined)?.length));
  const table = `<!-- fx:results:begin -->\nLokal gemessen, ${report.machine.cpu ?? 'CPU unbekannt'}, kein Iris Xe. ${report.date}, ${repeats} Durchläufe, ${warmup}s Aufwärmen und ${seconds}s Erfassung, 1920×1080 CSS-Pixel (Preset-Skalierung im JSON). ${contention ? 'Fremdlast erkannt, Messung unter Last wiederholen.' : 'Keine erkannte Fremdlast an den Messgrenzen.'}\n\nZeiten: p50 / p95 / p99 in ms. Fehlende GPU-Timer: n/v.\n\n| Engine | Szene | Lauf | Frame | Main-JS | FX-JS | Lab-JS | GPU gesamt |\n| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |\n${rows.join('\n')}\n\nGPU-Segmente, p95 in ms.\n\n| Engine | Szene | Lauf | Shadow | Opaque | Shields | Particles | Beams | Post |\n| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${gpuRows.join('\n')}\n\n| Engine | Szene | Lauf | Draws p50/max | FX-Draws p50/max | Partikel Mittel/p50 | Cap | Dropped Prio 0/1/2 |\n| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |\n${budgetRows.join('\n')}\n<!-- fx:results:end -->`;
  const doc = readFileSync(path, 'utf8');
  if (!/<!-- fx:results:begin -->[\s\S]*?<!-- fx:results:end -->/.test(doc)) throw new Error('FX result markers missing from status doc');
  writeFileSync(path, doc.replace(/<!-- fx:results:begin -->[\s\S]*?<!-- fx:results:end -->/, table));
}
if (existsSync(checkpoint)) unlinkSync(checkpoint);
console.log(`Report: ${file}`);
if (failed) process.exitCode = 1;
