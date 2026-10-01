import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { chromium, firefox, webkit } from '@playwright/test';
const port = Number(process.env['FAF_HUD_PERF_PORT'] ?? 4490), url = `http://127.0.0.1:${port}`, server = spawn(process.execPath, [resolve(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
let stderr = '';
server.stderr.on('data', chunk => { stderr += String(chunk); });
try {
    for (let i = 0; i < 100; i++) {
        if (server.exitCode !== null)
            throw new Error(stderr || 'Preview exited');
        try {
            if ((await fetch(url)).ok)
                break;
        }
        catch { /* Preview can still be starting. */ }
        await new Promise(r => setTimeout(r, 100));
    }
    const results = [];
    for (const [name, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]] as const) {
        const ffhome = resolve('node_modules/.cache/faf-firefox-home');
        mkdirSync(ffhome, { recursive: true });
        const browser = await type.launch({ headless: true, ...(name === 'firefox' && process.platform === 'darwin' ? { env: { ...process.env, CFFIXED_USER_HOME: ffhome } } : {}) });
        try {
            const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } }), errors: string[] = [];
            page.on('pageerror', e => errors.push(e.message));
            await page.goto(`${url}/#/story/hud--4?shot=1&motion=reduce`);
            await page.waitForFunction(() => Boolean((window as unknown as {
                __HUD_PERF__?: unknown;
            }).__HUD_PERF__));
            await page.evaluate(() => document.fonts.ready);
            const result = await page.evaluate(async () => { const p = window as unknown as {
                __HUD_PERF__: {
                    run(): Promise<unknown>;
                };
            }; return await p.__HUD_PERF__.run(); });
            if (errors.length)
                throw new Error(errors.join('\n'));
            results.push({ browser: name, ...result as object });
        }
        finally {
            await browser.close();
        }
    }
    mkdirSync('results', { recursive: true });
    writeFileSync('results/bench-browser.json', JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
    console.log(JSON.stringify(results, null, 2));
    if (process.env['FAF_PERF_GATE'] === '1' && results.some(r => { const x = r as unknown as {
        browser: string;
        script: {
            p95Ms: number;
        };
        scriptAndLayout: {
            p95Ms: number;
        };
        nodes: number;
        layoutShifts: number;
    }; return x.nodes > 700 || x.layoutShifts > 0 || x.browser === 'chromium' && (x.script.p95Ms > 1 || x.scriptAndLayout.p95Ms > 1.5); }))
        throw new Error('Local HUD performance or layout budget exceeded');
}
finally {
    server.kill('SIGTERM');
    await new Promise<void>(r => { if (server.exitCode !== null)
        r();
    else
        server.on('exit', () => r()); });
}
