import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { expect, test } from './support/silent-test.ts';
import { COI_PORT } from './support/ports.ts';
import { attachJson, PERF_GATE } from './support/game.ts';

const repo = resolve(import.meta.dirname, '../..');
let server: ChildProcess | null = null;
let scratch = '';
const port = COI_PORT + 2;
test.beforeAll(async ({ browserName }) => {
  if (browserName !== 'chromium') return;
  scratch = await mkdtemp(join(tmpdir(), 'faf-ms3-hmr-'));
  await mkdir(join(scratch, 'content'));
  await cp(join(repo, 'content/blueprints'), join(scratch, 'content/blueprints'), { recursive: true });
  await cp(join(repo, 'content/locales'), join(scratch, 'content/locales'), { recursive: true });
  await symlink(join(repo, 'packages'), join(scratch, 'packages'), 'dir');
  await symlink(join(repo, 'node_modules'), join(scratch, 'node_modules'), 'dir');
  server = spawn(process.execPath, [join(repo, 'node_modules/vite/bin/vite.js'), '--config', join(repo, 'apps/game/vite.config.ts'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: repo, env: { ...process.env, FAF_BLUEPRINT_DIR: join(scratch, 'content/blueprints'), FAF_LOCALES_DIR: join(scratch, 'content/locales') }, stdio: 'ignore',
  });
  await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/`)).status; } catch { return 0; } }, { timeout: 30000 }).toBe(200);
});
test.afterAll(async () => {
  if (server !== null) {
    const child = server; server = null;
    if (child.exitCode === null && child.signalCode === null) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const stopped = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGTERM');
      await Promise.race([stopped, new Promise<void>((resolve) => { timeout = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000); })]);
      clearTimeout(timeout);
    }
  }
  if (scratch !== '') await rm(scratch, { recursive: true, force: true });
});
test('MS3 blueprint HMR is transactional and changes live speed', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Blueprint HMR is a Vite development feature; production input is covered in all engines.');
  await page.goto(`http://127.0.0.1:${port}/?map=testplane&spawn=none`);
  await page.waitForFunction(() => window.__faf?.ready);
  await page.evaluate(() => { window.__faf!.console('spawn 1 0 core:lnd_t1_tank'); });
  await page.waitForFunction(() => window.__faf!.unitCount === 1);
  const speedBefore = await page.evaluate(async () => {
    const h = window.__faf!; const id = h.ownHandles()[0]!; h.sendMove([id], 450, 256); await h.waitTick(h.tick + 40);
    const p = h.unitPos(id)!; await h.waitTick(h.tick + 10); const q = h.unitPos(id)!;
    return Math.hypot(q.x - p.x, q.z - p.z);
  });
  const oldHash = await page.evaluate(() => window.__faf!.simHash);
  const file = join(scratch, 'content/blueprints/core/units/lnd_t1_tank.ts');
  const original = await readFile(file, 'utf8');
  await writeFile(file, original.replace('speed: 3.0', 'speed: 9.0'));
  await expect.poll(() => page.evaluate(() => window.__faf!.hmr.appliedAt), { timeout: 15000 }).not.toBeNull();
  expect(await page.evaluate(() => window.__faf!.simHash)).not.toBe(oldHash);
  expect(await page.evaluate(() => window.__faf!.tainted)).toBe(true);
  await expect(page.getByTestId('hud-simhash')).toContainText('tainted');
  const speedAfter = await page.evaluate(async () => {
    const h = window.__faf!; const id = h.ownHandles()[0]!; await h.waitTick(h.tick + 40);
    const p = h.unitPos(id)!; await h.waitTick(h.tick + 10); const q = h.unitPos(id)!;
    return Math.hypot(q.x - p.x, q.z - p.z);
  });
  expect(speedAfter).toBeGreaterThan(speedBefore * 1.5);
  const applied = await page.evaluate(() => ({ hmr: window.__faf!.hmr, hash: window.__faf!.simHash, tick: window.__faf!.tick }));
  if (PERF_GATE) expect(applied.hmr.elapsedMs!).toBeLessThanOrEqual(1000);
  await writeFile(file, original + '\nthis is not valid TypeScript !!!\n');
  await expect.poll(() => page.evaluate(() => window.__faf!.hmr.error)).not.toBeNull();
  expect(await page.evaluate(() => window.__faf!.simHash)).toBe(applied.hash);
  await page.waitForFunction((t) => window.__faf!.tick > t + 2, applied.tick);
  await attachJson(info, 'HMR measurement', { ...applied, speedBefore, speedAfter });
});
