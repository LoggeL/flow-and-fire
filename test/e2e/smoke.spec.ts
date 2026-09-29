import { expect, test, type Page } from '@playwright/test';
import { captureErrors, expectNoErrors, SERVERS } from './support/game.ts';

// Two servers from playwright.config.ts: 4173 with COOP/COEP, 4174 without (PLAN §5 DoD: "E2E ohne COOP/COEP").
// Smoke = hosting contract (G20): redirect to /b/<buildHash>/, headers/isolation, WebGL2, HUD with the build hash.

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
  test(`smoke: ${server.label}`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);

    const res = await page.goto(server.url);
    // dist/index.html redirects to /b/<buildHash>/
    await page.waitForURL(/\/b\/[^/]+\/$/);
    await expect(page).toHaveTitle('Flow & Fire');
    expect(res?.status()).toBe(200);

    const coi = await page.evaluate(() => globalThis.crossOriginIsolated === true);
    expect(coi).toBe(server.coi);
    const sab = await page.evaluate(() => typeof SharedArrayBuffer === 'function');
    if (server.coi) expect(sab).toBe(true);

    const gl = await probeWebGl2(page);
    expect(gl.ok, 'WebGL2 context available').toBe(true);
    testInfo.annotations.push({ type: 'webgl2-renderer', description: `${testInfo.project.name}: ${gl.renderer}` });

    const build = (await (await page.request.get(new URL('/build.json', server.url).toString())).json()) as {
      buildHash: string;
    };
    expect(page.url()).toContain(`/b/${build.buildHash}/`);
    await expect(page.locator('[data-testid="hud-build"]')).toHaveText(build.buildHash);
    await expect(page.locator('html')).toHaveAttribute('data-transport', server.transport);
    await expect(page.locator('html')).toHaveAttribute('data-ready', '1', { timeout: 20_000 });

    // Immutable caching of hashed build assets vs. no-cache for the redirect (serve.mjs mirrors deploy/nginx.conf).
    const html = await page.request.get(new URL(`/b/${build.buildHash}/`, server.url).toString());
    expect(html.headers()['content-type']).toContain('text/html');
    if (server.coi) {
      expect(html.headers()['cross-origin-opener-policy']).toBe('same-origin');
      expect(html.headers()['cross-origin-embedder-policy']).toBe('require-corp');
    } else {
      expect(html.headers()['cross-origin-embedder-policy']).toBeUndefined();
    }
    expectNoErrors(errors);
  });
}
