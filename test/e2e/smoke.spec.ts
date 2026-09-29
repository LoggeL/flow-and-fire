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

    // The root page (dist/index.html) is served with 200 and redirects via an inline
    // location.replace to /b/<buildHash>/. Its status is checked with a plain request: the
    // return value of goto() is not reliable here — Firefox reports null when the inline script
    // navigates away before the first page's load event.
    const rootRes = await page.request.get(server.url, { maxRedirects: 0 });
    expect(rootRes.status()).toBe(200);
    const buildDoc = page.waitForResponse(
      (r) => /\/b\/[^/]+\/$/.test(new URL(r.url()).pathname) && r.request().resourceType() === 'document',
    );
    await page.goto(server.url, { waitUntil: 'commit' });
    expect((await buildDoc).status()).toBe(200);
    await page.waitForURL(/\/b\/[^/]+\/$/);
    await expect(page).toHaveTitle('Flow & Fire');

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
    expect(html.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    const pointer = await page.request.get(new URL('/build.json', server.url).toString());
    expect(pointer.headers()['cache-control']).toBe('no-cache');
    const root = await page.request.get(new URL('/', server.url).toString(), { maxRedirects: 0 });
    expect(root.headers()['cache-control']).toBe('no-cache');
    expect(await root.text()).toContain(`/b/${build.buildHash}/`);
    if (server.coi) {
      expect(html.headers()['cross-origin-opener-policy']).toBe('same-origin');
      expect(html.headers()['cross-origin-embedder-policy']).toBe('require-corp');
    } else {
      expect(html.headers()['cross-origin-embedder-policy']).toBeUndefined();
    }
    expectNoErrors(errors);
  });
}
