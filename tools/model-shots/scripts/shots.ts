/**
 * Model screenshots via the model viewer (Playwright, headless Chromium):
 *   <out>/<faction>/contact.png      contact sheet, all models, 3/4 view, team blue
 *   <out>/<faction>/silhouettes.png  silhouettes from the game camera (+ 48/32 px)
 *   <out>/<faction>/compare.png      size comparison on the 1-WU grid
 *   <out>/<faction>/<unit>.png       single pictures
 *   <out>/icons.png                  icon grammar overview
 * Starts its own Vite server on a free port (never 5199) and always shuts it down. Needs `pnpm models` first.
 *
 * Usage: pnpm models:shots [--faction varkan] [--out /private/tmp/claude-501/faf-models] [--team blue]
 *        [--no-singles] [--smoke (also gallery + single view near/far)]
 *        (heavy: run through tools/heavy)
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const viewerRoot = join(repo, 'apps/model-viewer');
const manifestFile = join(repo, 'content/models/dist/manifest.json');

const { values } = parseArgs({
  allowNegative: true,
  options: {
    faction: { type: 'string' },
    out: { type: 'string', default: '/private/tmp/claude-501/faf-models' },
    team: { type: 'string', default: 'blue' },
    singles: { type: 'boolean', default: true },
    /** Also capture the interactive viewer pages (gallery, single view near/far with icon) as a smoke test. */
    smoke: { type: 'boolean', default: false },
  },
});

interface ManifestLike {
  factions: { slug: string; name: string }[];
  models: { faction: string; unit: string }[];
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createNetServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      s.close(() => (port === 5199 ? freePort().then(res, rej) : res(port)));
    });
  });
}

async function waitReady(page: Page, what: string): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset['ready'] === '1' || document.documentElement.dataset['error'] !== undefined, null, {
    timeout: 60_000,
  });
  const err = await page.evaluate(() => document.documentElement.dataset['error'] ?? null);
  if (err !== null) throw new Error(`${what}: ${err}`);
}

if (!existsSync(manifestFile)) {
  console.error('content/models/dist/manifest.json fehlt – erst "pnpm models" ausführen.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as ManifestLike;
const factions = manifest.factions.filter((f) => values.faction === undefined || f.slug === values.faction);
if (factions.length === 0) {
  console.error(`Keine Fraktion ${values.faction ?? ''} im Manifest.`);
  process.exit(1);
}

let server: ViteDevServer | null = null;
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
let failed = false;
try {
  const port = await freePort();
  server = await createServer({
    configFile: join(viewerRoot, 'vite.config.ts'),
    root: viewerRoot,
    logLevel: 'warn',
    server: { port, strictPort: true, host: '127.0.0.1' },
  });
  await server.listen();
  const base = `http://127.0.0.1:${port}/`;
  const args = ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  try {
    browser = await chromium.launch({ args });
  } catch {
    // headless shell missing/incomplete: full Chromium build in new headless mode
    browser = await chromium.launch({ args, channel: 'chromium' });
  }
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(`[page] ${e.message}`));
  const shoot = async (hash: string, file: string, selector = '#sheet'): Promise<void> => {
    await page.goto(`${base}#${hash}`);
    await page.reload(); // hash routes: start from a clean page (fresh WebGL context per sheet)
    await waitReady(page, hash);
    mkdirSync(dirname(file), { recursive: true });
    await page.locator(selector).screenshot({ path: file });
    console.log(`  ${file}`);
  };
  const t = values.team;
  for (const f of factions) {
    const dir = join(values.out, f.slug);
    console.log(`${f.name}:`);
    await shoot(`/sheet/${f.slug}?chrome=0&mode=color&team=${t}`, join(dir, 'contact.png'));
    await shoot(`/sheet/${f.slug}?chrome=0&mode=silhouette`, join(dir, 'silhouettes.png'));
    await shoot(`/compare?chrome=0&f=${f.slug}&team=${t}`, join(dir, 'compare.png'), '.stage');
    if (values.singles) {
      for (const m of manifest.models.filter((x) => x.faction === f.slug)) {
        await shoot(`/shot/${f.slug}/${m.unit}?chrome=0&team=${t}`, join(dir, `${m.unit}.png`));
      }
    }
  }
  await shoot(`/icons?chrome=0&team=${t}`, join(values.out, 'icons.png'), '#app');
  if (values.smoke) {
    const first = manifest.models.find((m) => factions.some((f) => f.slug === m.faction));
    await shoot('/', join(values.out, 'viewer-gallery.png'), 'body');
    if (first !== undefined) {
      await shoot(`/model/${first.faction}/${first.unit}`, join(values.out, 'viewer-single.png'), 'body');
      // far away in game-camera mode: the strategic icon replaces the mesh below iconThreshold
      await page.locator('#dist').fill('150');
      await page.locator('#dist').dispatchEvent('input');
      await page.waitForTimeout(300);
      const hud = await page.locator('.hud').textContent();
      if (hud === null || !hud.includes('Icon')) throw new Error(`single view at 150 WU shows no icon: ${hud ?? ''}`);
      await page.locator('body').screenshot({ path: join(values.out, 'viewer-single-far.png') });
      console.log(`  ${join(values.out, 'viewer-single-far.png')} (${hud})`);
    }
  }
} catch (e) {
  failed = true;
  console.error(e instanceof Error ? e.message : e);
} finally {
  await browser?.close();
  await server?.close();
}
process.exit(failed ? 1 : 0);
