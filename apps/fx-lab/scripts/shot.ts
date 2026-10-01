/** Frozen scene captures on all requested engines; uses the same isolated origin as the benchmark. */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { build } from 'vite';
import { APP, REPO, ORIGIN, GL_ERROR, launchConfig, ready, serve } from './browser.ts';
const args = process.argv.slice(2);
const flag = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const engines = (flag('browsers') ?? 'chromium,firefox,webkit').split(',');
const selected = flag('scenes')?.split(',');
const forcedFreeze = flag('freeze');
if (!process.argv.includes('--no-build')) await build({ configFile: resolve(APP, 'vite.config.ts') });
const dir = resolve(REPO, 'test-results/fx-shots'); mkdirSync(dir, { recursive: true });
for (const engine of engines) {
  const cfg = launchConfig(engine), browser = await cfg.type.launch(cfg.options);
  try {
    for (const [scene, time] of [['battle', 12], ['shields', 6], ['big', 1.6], ['big', 4], ['gallery', 2.8], ['gallery', 3], ['lighting', 3]] as const) {
      if (selected && !selected.includes(scene)) continue;
      const freeze = forcedFreeze === undefined ? time : Number(forcedFreeze);
      if (!Number.isFinite(freeze) || freeze < 0) throw new Error(`Invalid freeze time: ${forcedFreeze}`);
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' || GL_ERROR.test(m.text())) errors.push(m.text()); });
      try {
        await serve(page); await page.goto(`${ORIGIN}/?scene=${scene}&freeze=${freeze}&seed=77`); await ready(page);
        // Let the HUD's 4 Hz text refresh catch up to the held scene time.
        await page.waitForTimeout(300);
        // Keep projected effect labels while removing the controls/statistics for visual acceptance.
        if (args.includes('--clean')) await page.addStyleTag({ content: '.hud { display: none; }' });
        await page.screenshot({ path: resolve(dir, `${scene}-${freeze}-${engine}.png`) });
        if (errors.length) throw new Error(`${engine}/${scene}: ${errors.join('; ')}`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}
