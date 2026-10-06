// Blueprint HMR (MS3): the page-side tracker and the dev-server plugin against a temporary copy of
// the content (FAF_BLUEPRINT_DIR/FAF_LOCALES_DIR mechanism): edit → sim.bin/view.json event, broken
// content → diagnostics, no event loss. The plugin timing (file mtime → event) is reported; the
// ≤ 1 s gate is machine-dependent (FAF_PERF_GATE=1, DECISIONS 16).
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeSimBin } from '@faf/blueprints/simbin';
import { parseViewJson } from '@faf/blueprints/view';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blueprintHmrPlugin, contentFiles, contentSource, stripAnsi } from '../scripts/blueprint-hmr.ts';
import { BLUEPRINT_HMR_EVENT, HmrTracker, base64ToBytes, type BlueprintHmrPayload } from '../src/hmr.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const PERF_GATE = process.env['FAF_PERF_GATE'] === '1';

function okPayload(id: number, changedAt: number, simBin = new Uint8Array([1, 2, 3])): BlueprintHmrPayload {
  return {
    ok: true,
    id,
    files: ['content/blueprints/core/units/lnd_t1_tank.ts'],
    changedAt,
    compiledAt: changedAt + 40,
    compileMs: 35,
    simBin: Buffer.from(simBin).toString('base64'),
    viewJson: '{}',
    simHash: 0x12345678,
    viewHash: 1,
  };
}

describe('HmrTracker (page side)', () => {
  it('ok payload → pending until the worker status confirms (devReloads), timing changedAt → applied', () => {
    const t = new HmrTracker();
    const p = t.receive(okPayload(1, 10_000), 10_050, 0)!;
    expect(p).not.toBeNull();
    expect([...p.simBin]).toEqual([1, 2, 3]);
    expect(p.expectDevReloads).toBe(1);
    expect(t.snapshot().pending).toBe(true);
    expect(t.onStatus(0, 0, false, 10_060)).toBeNull();
    const done = t.onStatus(1, 0xabcdef01, true, 10_300);
    expect(done).toBe(p);
    const s = t.snapshot();
    expect(s).toMatchObject({ count: 1, applied: 1, failed: 0, pending: false });
    expect(s.last).toMatchObject({ id: 1, ok: true, totalMs: 300, simHash: 0xabcdef01, tainted: true, error: null, appliedAt: 10_300 });
  });

  it('compile errors, host rejection and superseded updates are failures', () => {
    const t = new HmrTracker();
    expect(
      t.receive({ ok: false, id: 1, files: ['x'], changedAt: 1, compiledAt: 2, compileMs: 1, diagnostics: 'core:x /sim: bad', count: 1 }, 5, 0),
    ).toBeNull();
    expect(t.snapshot().last).toMatchObject({ ok: false, error: 'core:x /sim: bad' });
    t.receive(okPayload(2, 100), 110, 0);
    expect(t.onHostError('RangeError: devReload rejected: …', 120)).toBe(true);
    expect(t.onHostError('other', 130)).toBe(false);
    t.receive(okPayload(3, 200), 210, 0);
    t.receive(okPayload(4, 300), 310, 0);
    const s = t.snapshot();
    expect(s).toMatchObject({ count: 4, applied: 0, failed: 3, pending: true });
    expect(s.history.map((r) => r.error)).toEqual(['core:x /sim: bad', 'RangeError: devReload rejected: …', 'superseded by a newer update']);
    expect(t.onStatus(1, 5, true, 400)?.payload.id).toBe(4);
  });

  it('base64ToBytes round-trips', () => {
    const b = new Uint8Array(300).map((_, i) => (i * 37) & 255);
    expect([...base64ToBytes(Buffer.from(b).toString('base64'))]).toEqual([...b]);
  });
});

describe('blueprint HMR plugin (dev server)', () => {
  let tmp = '';
  let bpDir = '';
  let locDir = '';
  let server: ViteDevServer | null = null;
  const events: { at: number; data: BlueprintHmrPayload }[] = [];
  let waiters: (() => void)[] = [];

  const nextEvent = (after: number, timeoutMs = 15_000): Promise<{ at: number; data: BlueprintHmrPayload }> =>
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const check = (): void => {
        const e = events.find((x) => x.data.id > after);
        if (e !== undefined) resolve(e);
        else if (Date.now() - t0 > timeoutMs) reject(new Error(`no HMR event after #${after} within ${timeoutMs} ms`));
        else waiters.push(check);
      };
      check();
    });

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'faf-hmr-'));
    bpDir = join(tmp, 'content', 'blueprints');
    locDir = join(tmp, 'content', 'locales');
    cpSync(join(REPO, 'content', 'blueprints'), bpDir, { recursive: true });
    cpSync(join(REPO, 'content', 'locales'), locDir, { recursive: true });
    server = await createServer({
      configFile: false,
      root: tmp,
      logLevel: 'silent',
      server: { middlewareMode: true, hmr: false, watch: { usePolling: false } },
      plugins: [blueprintHmrPlugin({ repoRoot: REPO, blueprintDir: bpDir, localesDir: locDir, debounceMs: 15 })],
    });
    const s = server;
    s.ws.send = ((payload: { type: string; event?: string; data?: unknown }) => {
      if (payload.type === 'custom' && payload.event === BLUEPRINT_HMR_EVENT) {
        events.push({ at: Date.now(), data: payload.data as BlueprintHmrPayload });
        const w = waiters;
        waiters = [];
        for (const f of w) f();
      }
    }) as typeof s.ws.send;
    // Let the watcher pick up the copied tree.
    await new Promise((r) => setTimeout(r, 300));
  }, 30_000);

  afterAll(async () => {
    await server?.close();
    if (tmp !== '') rmSync(tmp, { recursive: true, force: true });
  });

  it('content files and their CLI source names', () => {
    const files = contentFiles(bpDir);
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.endsWith('lnd_t1_tank.ts'))).toBe(true);
    expect(contentSource(bpDir, join(bpDir, 'core', 'units', 'cube.ts'))).toBe('content/blueprints/core/units/cube.ts');
  });

  it('edit → compiled sim.bin + view.json event; broken content → diagnostics; fixed again → ok', async () => {
    const file = join(bpDir, 'core', 'units', 'lnd_t1_tank.ts');
    const original = readFileSync(file, 'utf8');
    const baseHash = decodeSimBin(new Uint8Array(readFileSync(join(REPO, 'content', 'generated', 'sim.bin')))).simHash >>> 0;

    // 1. Faster light tank: new simHash, same ids.
    writeFileSync(file, original.replace('speed: 3.0,', 'speed: 3.4,'));
    const e1 = await nextEvent(0);
    expect(e1.data.ok, e1.data.ok ? '' : e1.data.diagnostics).toBe(true);
    if (!e1.data.ok) return;
    const table = decodeSimBin(base64ToBytes(e1.data.simBin));
    expect(table.ids[0]).toBe('core:cube');
    expect(table.simHash >>> 0).toBe(e1.data.simHash);
    expect(e1.data.simHash).not.toBe(baseHash);
    expect(parseViewJson(e1.data.viewJson).visuals.map((v) => v.id)).toEqual(table.ids);
    expect(e1.data.files).toHaveLength(1);
    const latency1 = e1.at - e1.data.changedAt;
    console.log(`[HMR] plugin: file mtime → event ${latency1} ms (compile ${e1.data.compileMs.toFixed(0)} ms), lokal`);
    if (PERF_GATE) expect(latency1).toBeLessThanOrEqual(1000);

    // 2. Broken: unknown weapon reference ⇒ diagnostics, no sim.bin.
    writeFileSync(file, original.replace("ref: 'core:wpn_cannon_t1'", "ref: 'core:wpn_does_not_exist'"));
    const e2 = await nextEvent(e1.data.id);
    expect(e2.data.ok).toBe(false);
    if (e2.data.ok) return;
    expect(e2.data.diagnostics).toMatch(/wpn_does_not_exist/);
    expect(e2.data.count).toBeGreaterThanOrEqual(1);

    // 3. Syntax error in a module ⇒ load error as diagnostics.
    writeFileSync(file, original.replace('export default defineUnit({', 'export default defineUnit({{'));
    const e3 = await nextEvent(e2.data.id);
    expect(e3.data.ok).toBe(false);

    // 4. Fixed again ⇒ the original blueprints (original simHash).
    writeFileSync(file, original);
    const e4 = await nextEvent(e3.data.id);
    expect(e4.data.ok).toBe(true);
    if (e4.data.ok) expect(e4.data.simHash).toBe(baseHash);

    // 5. Locale change ⇒ recompiled (view only: same simHash).
    const de = join(locDir, 'de.json');
    const deText = readFileSync(de, 'utf8');
    writeFileSync(de, deText.replace('"Keiler"', '"Keiler II"'));
    const e5 = await nextEvent(e4.data.id);
    expect(e5.data.ok).toBe(true);
    expect(e5.data.files).toEqual([expect.stringMatching(/de\.json$/)]);
  }, 60_000);
});

describe('stripAnsi (HMR diagnostics shown in the HUD)', () => {
  it('removes color and cursor escape sequences, keeps the text', () => {
    expect(stripAnsi('\u001b[31m[PARSE_ERROR] \u001b[0mUnexpected token')).toBe('[PARSE_ERROR] Unexpected token');
    expect(stripAnsi('\u001b[38;5;246m╭\u001b[0m─ a.ts:11:26')).toBe('╭─ a.ts:11:26');
    expect(stripAnsi('plain')).toBe('plain');
  });
});
