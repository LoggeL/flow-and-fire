/** Rebuild the game's build-button images from its actual model manifest. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { installSilentOutput } from '../../../apps/game/test/support/silent-output.ts';

const root = resolve(import.meta.dirname, '../../..');
const output = resolve(root, 'apps/game/src/hud/assets/build-icons');
const view = JSON.parse(readFileSync(resolve(root, 'content/generated/view.json'), 'utf8')) as {
  visuals: { id: string; mesh: string; tech: number }[];
};
const meshes = [...new Set(view.visuals.map(v => v.mesh).filter(m => m.startsWith('units/varkan/')))].sort();
const options = { size: 192, team: '#2F6FD0', azimuth: 35, elevation: 32, background: '#304038' };
const server = await createServer({
  configFile: resolve(root, 'apps/model-viewer/vite.config.ts'),
  root: resolve(root, 'apps/model-viewer'), logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 320 } });
  await installSilentOutput(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.resolvedUrls!.local[0]}#/shot/varkan/str_t1_mex?chrome=0&w=256&h=256`);
  await page.waitForFunction(() => document.documentElement.dataset['ready'] === '1');
  mkdirSync(output, { recursive: true });
  const images = [];
  for (const mesh of meshes) {
    const unit = mesh.split('/').at(-1)!;
    const shot = await page.evaluate(async ({ unit, options }) => {
      const modelsUrl = '/src/models.ts', thumbsUrl = '/src/thumbs.ts';
      const { loadManifest } = await import(/* @vite-ignore */ modelsUrl);
      const { thumbnail } = await import(/* @vite-ignore */ thumbsUrl);
      const manifest = await loadManifest();
      const meta = manifest.models.find((m: { faction: string; unit: string }) => m.faction === 'varkan' && m.unit === unit);
      if (!meta) throw new Error(`Missing model: ${unit}`);
      return { data: await thumbnail(meta, options), modelSha256: meta.sha256 };
    }, { unit, options });
    const bytes = Buffer.from(shot.data.slice(shot.data.indexOf(',') + 1), 'base64');
    const file = `${unit}.png`;
    writeFileSync(resolve(output, file), bytes);
    images.push({ mesh, file, modelSha256: shot.modelSha256, sha256: createHash('sha256').update(bytes).digest('hex') });
    process.stdout.write(`${file}\n`);
  }
  // The model viewer creates no audio contexts; the strict sink is still installed before navigation.
  const silent = await page.evaluate(() => {
    const audio = (window as unknown as { __fafSilentAudio: { installed: boolean; speakerConnections: number; blockedConnections: number; contexts: number; streamDestinations: number } }).__fafSilentAudio;
    return audio.installed && audio.speakerConnections === 0 && audio.blockedConnections === 0 && audio.contexts === audio.streamDestinations;
  });
  if (!silent) throw new Error('Model thumbnail renderer has an audible audio connection');
  if (errors.length) throw new Error(errors.join('\n'));
  const blueprints = Object.fromEntries(view.visuals.filter(v => v.mesh.startsWith('units/varkan/')).map(v => [v.id, v.mesh.split('/').at(-1)!]));
  writeFileSync(resolve(output, 'manifest.json'), JSON.stringify({ generator: 'pnpm exec tsx tools/model-shots/scripts/hud-icons.ts', options, blueprints, images }, null, 2) + '\n');
  writeFileSync(resolve(output, '../../build-portraits.gen.ts'), '/** Generated from the live visual-to-model mapping by hud-icons.ts. */\nexport const BUILD_PORTRAIT_MODELS: Readonly<Record<string, string>> = ' + JSON.stringify(blueprints, null, 2) + ';\n');
} finally {
  await browser?.close();
  await server.close();
}
