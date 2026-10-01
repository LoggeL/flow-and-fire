import { HudScheduler, minimapTimings, snapshotOf, seedHud, createHudModel } from '@faf/hud';
import type { HudModel } from '@faf/hud';
export function attachPerf(model: HudModel): () => void {
    const source = createHudModel();
    seedHud(source, 'perf-500');
    const scheduler = new HudScheduler(model), flush: number[] = [], withLayout: number[] = [];
    let loaf = 0, layoutShifts = 0;
    let observer: PerformanceObserver | null = null;
    if (PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
        observer = new PerformanceObserver(list => { loaf += list.getEntries().length; });
        observer.observe({ type: 'long-animation-frame', buffered: true });
    }
    const shiftObserver = PerformanceObserver.supportedEntryTypes.includes('layout-shift') ? new PerformanceObserver(list => { for (const e of list.getEntries())
        layoutShifts += (e as unknown as {
            value: number;
        }).value; }) : null;
    shiftObserver?.observe({ type: 'layout-shift' });
    const perf = { async run(frames = 600) { flush.length = 0; withLayout.length = 0; minimapTimings.length = 0; loaf = 0; layoutShifts = 0; for (let i = 0; i < frames; i++) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            if (i === Math.min(60, Math.floor(frames * .1))) { observer?.takeRecords(); shiftObserver?.takeRecords(); loaf = 0; layoutShifts = 0; }
            source.eco.mass.stored.value = 320 + Math.sin(i / 15) * 50;
            source.factory.progress.value = (i % 60) / 60;
            const stats = source.selection.multiStats.peek();
            if (stats) {
                stats.groupHp.fill(.5 + (i % 30) / 60);
                source.selection.multiStats.value = { ...stats };
            }
            source.match.timeS.value = i / 60;
            source.minimap.units.value = { ...source.minimap.units.value };
            const snapshot = snapshotOf(source, 1);
            const start = performance.now();
            scheduler.push(snapshot, i, 3);
            scheduler.flush();
            await Promise.resolve();
            await Promise.resolve();
            flush.push(performance.now() - start);
            document.querySelector('[data-hud-root]')?.getBoundingClientRect();
            withLayout.push(performance.now() - start);
            performance.clearMeasures('hud-flush');
        } const stats = (values: number[]) => { const s = values.slice(Math.min(60, Math.floor(values.length * .1))).sort((a, b) => a - b); return { p50Ms: s[Math.floor(s.length * .5)] ?? 0, p95Ms: s[Math.floor(s.length * .95)] ?? 0, maxMs: s.at(-1) ?? 0, samples: s.length }; }; return { script: stats(flush), scriptAndLayout: stats(withLayout), minimap: stats(minimapTimings), layoutShifts, nodes: document.querySelector('[data-hud-root]')?.querySelectorAll('*').length ?? 0, loaf, loafSupported: PerformanceObserver.supportedEntryTypes.includes('long-animation-frame') }; } };
    (window as unknown as {
        __HUD_PERF__: typeof perf;
    }).__HUD_PERF__ = perf;
    return () => { scheduler.dispose(); observer?.disconnect(); shiftObserver?.disconnect(); delete (window as unknown as {
        __HUD_PERF__?: typeof perf;
    }).__HUD_PERF__; };
}
