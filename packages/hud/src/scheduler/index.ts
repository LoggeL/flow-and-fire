import { batch } from '@preact/signals';
import type { HudModel } from '../model/index.ts';
import type { HudSnapshot } from '../model/snapshot.ts';
import { tickAlerts } from '../model/alerts.ts';
export interface SchedulerOptions {
    readonly now?: () => number;
    readonly requestFrame?: (cb: () => void) => number;
    readonly cancelFrame?: (id: number) => void;
}
interface Writable {
    value: unknown;
    peek(): unknown;
}
/** Equality avoids repainting stable snapshots without JSON allocation; typed arrays are compared by value. */
export function sameValue(a: unknown, b: unknown): boolean {
    if (Object.is(a, b))
        return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object')
        return false;
    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
        const av = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), bv = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
        return av.length === bv.length && av.every((v, i) => v === bv[i]);
    }
    const ak = Object.keys(a), bk = Object.keys(b);
    return ak.length === bk.length && ak.every((k) => Object.hasOwn(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
function write(section: object, data: object, keys?: readonly string[]): number {
    const target = section as Record<string, Writable>, values = data as Record<string, unknown>;
    let n = 0;
    for (const key of keys ?? Object.keys(values)) {
        if (key === 'net' || key === 'status' || key === 'page')
            continue;
        const sig = target[key];
        if (sig && ((['multiStats', 'units', 'fog'].includes(key) && !Object.is(sig.peek(), values[key])) || !sameValue(sig.peek(), values[key]))) {
            sig.value = values[key];
            n++;
        }
    }
    return n;
}
export class HudScheduler {
    private latest: {
        snapshot: HudSnapshot;
        tick: number;
        speed: number;
        paused: boolean;
    } | null = null;
    private versions: HudSnapshot['versions'] | null = null;
    private tick = -1;
    private times = [-Infinity, -Infinity, -Infinity, -Infinity];
    private frame: number | null = null;
    private disposed = false;
    private readonly now: () => number;
    private readonly requestFrame: (cb: () => void) => number;
    private readonly cancelFrame: (id: number) => void;
    /** Counts actual signal writes, useful for contract tests and diagnostics. */
    writes = 0;
    flushes = 0;
    constructor(readonly model: HudModel, options: SchedulerOptions = {}) {
        this.now = options.now ?? (() => performance.now());
        this.requestFrame = options.requestFrame ?? ((cb) => requestAnimationFrame(cb));
        this.cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
    }
    push(snapshot: HudSnapshot, simTick: number, simSpeed = 1, paused = false): void {
        if (this.disposed)
            return;
        this.latest = { snapshot, tick: simTick, speed: simSpeed, paused };
        if (this.frame === null)
            this.frame = this.requestFrame(() => { this.frame = null; this.flush(); });
    }
    flush(): void {
        if (!this.latest || this.disposed)
            return;
        const { snapshot: s, tick, speed, paused } = this.latest;
        this.latest = null;
        if (this.frame !== null) {
            this.cancelFrame(this.frame);
            this.frame = null;
        }
        const start = performance.now(), now = this.now(), fresh = tick !== this.tick;
        const changed = (key: keyof HudSnapshot['versions']) => this.versions === null || this.versions[key] !== s.versions[key];
        let writes = 0;
        batch(() => {
            if (changed('selection')) {
                writes += write(this.model.selection, s.selection, ['kind', 'multi', 'single', 'focusTypeId', 'groupLabel', 'controlGroup']);
                writes += write(this.model.factory, s.factory, ['detail']);
            }
            if (changed('card')) {
                writes += write(this.model.card, s.card, ['selectedTypes', 'unitCount', 'tab', 'armedSlot', 'placingTypeId', 'capReached', 'queueCounts', 'flashSlot']);
                writes += write(this.model.orders, s.orders);
            }
            if (changed('alerts'))
                writes += write(this.model.alerts, s.alerts);
            if (changed('queue')) {
                writes += write(this.model.factory, s.factory, ['queue']);
                writes += write(this.model.card, s.card, ['queueCounts']);
            }
            if (changed('banners'))
                writes += write(this.model.match, { ...s.match, speed }, ['speed', 'pause', 'simLag', 'contextLost', 'replay', 'scores']);
            if (changed('minimap'))
                writes += write(this.model.minimap, s.minimap, ['terrain', 'spots', 'camera', 'mapName', 'mapSizeWu', 'mode', 'showResources', 'available']);
            if (fresh && !paused) {
                if (now - this.times[0]! >= 100 - .001) {
                    this.times[0] = now;
                    writes += write(this.model.eco.mass, s.eco.mass);
                    writes += write(this.model.eco.energy, s.eco.energy);
                    writes += write(this.model.factory, s.factory, ['progress', 'remainingS']);
                    writes += write(this.model.card, s.card, ['progress']);
                }
                if (now - this.times[1]! >= 250 - .001) {
                    this.times[1] = now;
                    writes += write(this.model.selection, s.selection, ['single', 'multiStats']);
                    writes += write(this.model.factory, s.factory, ['detail']);
                    writes += write(this.model.orders, s.orders);
                    writes += write(this.model.minimap, s.minimap, ['units', 'pings']);
                    if (this.model.eco.detailsOpen.peek())
                        writes += write(this.model.eco, s.eco, ['consumers']);
                }
                if (now - this.times[2]! >= 500 - .001) {
                    this.times[2] = now;
                    writes += write(this.model.minimap, s.minimap, ['fog']);
                }
                if (now - this.times[3]! >= 1000 - .001) {
                    this.times[3] = now;
                    writes += write(this.model.match, s.match, ['timeS', 'units', 'unitCap']);
                    writes += write(this.model.strip, s.strip);
                    tickAlerts(this.model.alerts, s.match.timeS);
                }
            }
        });
        this.tick = tick;
        this.versions = s.versions;
        this.writes += writes;
        this.flushes++;
        performance.measure('hud-flush', { start, end: performance.now() });
    }
    dispose(): void { this.disposed = true; if (this.frame !== null)
        this.cancelFrame(this.frame); this.frame = null; this.latest = null; }
}
