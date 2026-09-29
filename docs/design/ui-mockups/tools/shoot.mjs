// Screenshots der UI-Mockups (Playwright, headless Chromium).
// Aufruf: node docs/design/ui-mockups/tools/shoot.mjs [ausgabeordner] [filter]
// Startet einen eigenen statischen Server auf einem freien Port und beendet ihn danach.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = resolve(process.argv[2] || '/private/tmp/claude-501/faf-ui');
const filter = process.argv[3] || '';
const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require('playwright');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = join(root, p.endsWith('/') ? p + 'index.html' : p);
    if (!f.startsWith(root)) throw new Error('outside');
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch { res.writeHead(404); res.end('404'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/`;

const R1080 = { width: 1920, height: 1080 }, R1440 = { width: 2560, height: 1440 };
const shots = [
  ['hud-1080-vogt', 'hud.html?clean=1&sel=vogt&tip=W', R1080],
  ['hud-1080-armee', 'hud.html?clean=1&sel=army', R1080],
  ['hud-1080-fabrik-stall', 'hud.html?clean=1&sel=factory&stall=1&tip=Q', R1080],
  ['hud-1080-platzieren', 'hud.html?clean=1&sel=vogt&place=1', R1080],
  ['hud-1080-konsole', 'hud.html?clean=1&sel=none&console=1', R1080],
  ['hud-1080-pause-cvd', 'hud.html?clean=1&sel=army&teams=cvd&paused=1&ring=1', R1080],
  ['hud-1440-vogt', 'hud.html?clean=1&sel=vogt&tip=W', R1440],
  ['hud-1440-fabrik', 'hud.html?clean=1&sel=factory&flow=1', R1440],
  ['hud-1440-kompakt', 'hud.html?clean=1&sel=army&scale=1&speed=2', R1440],
  ['menu-1080', 'menu.html', R1080],
  ['skirmish-1080', 'skirmish.html', R1080],
  ['skirmish-1440', 'skirmish.html', R1440],
  ['settings-1080-grafik', 'settings.html', R1080],
  ['settings-1080-tasten', 'settings.html?tab=keys', R1080],
  ['settings-1080-zugang', 'settings.html?tab=access', R1080],
  ['loading-1080', 'loading.html', R1080],
  ['score-1080', 'score.html', R1080],
  ['score-1440', 'score.html', R1440],
  ['components', 'components.html', { width: 1920, height: 1080 }, true],
  ['index', 'index.html', { width: 1920, height: 1080 }, true],
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, url, vp, full] of shots) {
    if (filter && !name.includes(filter)) continue;
    const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(base + url, { waitUntil: 'load' });
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(out, name + '.png'), fullPage: !!full });
    console.log(name.padEnd(28), errors.length ? 'FEHLER: ' + errors.join(' | ') : 'ok');
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
