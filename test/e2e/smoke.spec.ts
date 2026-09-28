import { expect, test, type Page } from '@playwright/test';

// Two servers from playwright.config.ts: 4173 with COOP/COEP, 4174 without (PLAN §5 DoD: "E2E ohne COOP/COEP").
const SERVERS = [
  { name: 'COOP/COEP (4173)', url: 'http://localhost:4173/', coi: true },
  { name: 'ohne COOP/COEP (4174)', url: 'http://localhost:4174/', coi: false },
] as const;

async function probeWebGl2(page: Page): Promise<{ ok: boolean; renderer: string }> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (gl === null) return { ok: false, renderer: '' };
    const renderer = String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true, renderer };
  });
}

for (const server of SERVERS) {
  test(`smoke: ${server.name}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(server.url);
    // dist/index.html redirects to /b/<buildHash>/
    await page.waitForURL(/\/b\/[^/]+\/$/);
    await expect(page).toHaveTitle('Flow & Fire');
    await expect(page.locator('#status')).toContainText('Flow & Fire – MS1-Gerüst');

    const coi = await page.evaluate(() => globalThis.crossOriginIsolated === true);
    expect(coi).toBe(server.coi);
    const sab = await page.evaluate(() => typeof SharedArrayBuffer === 'function');
    if (server.coi) expect(sab).toBe(true);

    const gl = await probeWebGl2(page);
    expect(gl.ok, 'WebGL2 context available').toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-webgl2', 'ok');
    testInfo.annotations.push({ type: 'webgl2-renderer', description: `${testInfo.project.name}: ${gl.renderer}` });

    const build = (await (await page.request.get(new URL('/build.json', server.url).toString())).json()) as {
      buildHash: string;
    };
    expect(page.url()).toContain(`/b/${build.buildHash}/`);
    expect(errors).toEqual([]);
  });
}
