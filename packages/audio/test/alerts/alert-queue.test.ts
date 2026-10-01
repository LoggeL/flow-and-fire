import { beforeEach, describe, expect, it } from 'vitest';
import { AlertQueue, type AlertQueueOptions } from '../../src/alerts/index.ts';
import { DEFAULT_EVENT_SOUND_MAP } from '../../src/events/index.ts';
import type { AlertRecord } from '../../src/types.ts';
import { ManifestResolver, RecordingSink } from '../router/fakes.ts';
import { loadRealManifest } from '../support/index.ts';

const resolver = new ManifestResolver(loadRealManifest());

let now = 0;
let jumps: [number, number][] = [];
let records: AlertRecord[] = [];
let starts: number[] = [];

function queue(opts: Partial<AlertQueueOptions> = {}): AlertQueue {
  return new AlertQueue({
    resolver,
    faction: 'varkan',
    clockMs: () => now,
    rules: DEFAULT_EVENT_SOUND_MAP.alerts,
    onJumpTo: (x, z) => jumps.push([x, z]),
    onAlert: (a) => records.push(a),
    onAlertStart: (d) => starts.push(d),
    ...opts,
  });
}

beforeEach(() => {
  now = 0;
  jumps = [];
  records = [];
  starts = [];
});

/** Ends the current alert voice and runs one update. */
function next(q: AlertQueue, sink: RecordingSink): void {
  for (const h of sink.handles) h.alive = false;
  q.update(now, sink);
}

describe('AlertQueue priority and single voice', () => {
  it('announces higher priority first, FIFO on ties, one voice at a time', () => {
    const q = queue();
    const sink = new RecordingSink(resolver);
    expect(q.push({ kind: 'alt_build_complete' })).toBe(true); // 96
    expect(q.push({ kind: 'alt_unit_attacked', x: 1, z: 1 })).toBe(true); // 97
    expect(q.push({ kind: 'alt_storage_full' })).toBe(true); // 96
    expect(q.push({ kind: 'alt_base_attacked', x: 5, z: 5 })).toBe(true); // 99
    expect(q.size).toBe(4);
    q.update(now, sink);
    expect(sink.plays.map((p) => p.soundId)).toEqual(['common:alt_base_attacked']);
    // Voice still alive and within its duration: nothing else starts.
    now = 500;
    q.update(now, sink);
    expect(sink.plays).toHaveLength(1);
    expect(q.busy).toBe(true);
    next(q, sink);
    next(q, sink);
    next(q, sink);
    expect(sink.plays.map((p) => p.soundId)).toEqual([
      'common:alt_base_attacked',
      'common:alt_unit_attacked',
      'common:alt_build_complete',
      'common:alt_storage_full',
    ]);
    expect(q.size).toBe(0);
    // Alerts are centred (no position on the play request) at gain 1.
    expect(sink.plays.every((p) => p.x === undefined && p.z === undefined && p.gain === 1)).toBe(true);
  });

  it('starts the next alert after the nominal duration even if the handle stays alive', () => {
    const q = queue();
    const sink = new RecordingSink(resolver);
    q.push({ kind: 'alt_base_attacked', x: 0, z: 0 });
    q.push({ kind: 'alt_unit_attacked', x: 0, z: 0 });
    q.update(now, sink);
    const dur = resolver.byIndex(resolver.idx('common:alt_base_attacked')).durationS * 1000;
    now = dur + 50;
    q.update(now, sink);
    expect(sink.plays).toHaveLength(1);
    now = dur + 101;
    q.update(now, sink);
    expect(sink.plays).toHaveLength(2);
  });

  it('calls onAlertStart with the duration and onAlert with the record', () => {
    const q = queue();
    const sink = new RecordingSink(resolver);
    now = 1234;
    q.push({ kind: 'alt_commander_danger', x: 10.5, z: -3 });
    q.update(now, sink);
    expect(starts).toEqual([resolver.byIndex(resolver.idx('common:alt_commander_danger')).durationS]);
    expect(records).toEqual([{ kind: 'alt_commander_danger', soundId: 'common:alt_commander_danger', x: 10.5, z: -3, atMs: 1234 }]);
    expect(q.stats).toMatchObject({ queued: 1, announced: 1, voiced: 1 });
  });

  it('announces silently when the sink drops the voice (locked engine) and does not block', () => {
    const q = queue();
    const sink = new RecordingSink(resolver);
    sink.dropAll = 'locked';
    q.push({ kind: 'alt_base_attacked', x: 1, z: 2 });
    q.push({ kind: 'alt_enemy_air', x: 3, z: 4 });
    q.update(now, sink);
    q.update(now, sink);
    expect(starts).toEqual([]);
    expect(records.map((r) => r.kind)).toEqual(['alt_base_attacked', 'alt_enemy_air']);
    expect(q.jumpToLast()).toBe(true);
    expect(jumps).toEqual([[3, 4]]);
  });

  it('rejects unknown alerts', () => {
    const q = queue();
    expect(q.push({ kind: 'alt_does_not_exist' })).toBe(false);
    expect(q.stats.unknown).toBe(1);
  });
});

describe('AlertQueue repeat interval and location exception', () => {
  it('uses the manifest cooldownMs of each alert as its repeat interval', () => {
    const q = queue();
    expect(resolver.byIndex(resolver.idx('common:alt_base_attacked')).cooldownMs).toBe(15000);
    expect(q.push({ kind: 'alt_base_attacked', x: 100, z: 100 })).toBe(true);
    now = 5000;
    expect(q.push({ kind: 'alt_base_attacked', x: 100, z: 100 })).toBe(false);
    now = 14_999;
    expect(q.push({ kind: 'alt_base_attacked', x: 110, z: 100 })).toBe(false);
    now = 15_000;
    expect(q.push({ kind: 'alt_base_attacked', x: 110, z: 100 })).toBe(true);
    // Other alerts have their own interval (unit_attacked 10 s) and are independent.
    expect(q.push({ kind: 'alt_unit_attacked', x: 0, z: 0 })).toBe(true);
    now = 24_999;
    expect(q.push({ kind: 'alt_unit_attacked', x: 0, z: 0 })).toBe(false);
    now = 25_000;
    expect(q.push({ kind: 'alt_unit_attacked', x: 0, z: 0 })).toBe(true);
    expect(q.stats.suppressed).toBe(3);
  });

  it('honours a rule repeatMs override', () => {
    const q = queue({ rules: { alt_gong: { sound: 'alt_gong', repeatMs: 2000, radiusWu: null } } });
    expect(q.push({ kind: 'alt_gong' })).toBe(true);
    now = 1999;
    expect(q.push({ kind: 'alt_gong' })).toBe(false);
    now = 2000;
    expect(q.push({ kind: 'alt_gong' })).toBe(true);
  });

  it('lets the same alert at a clearly different place through after minSpacingMs', () => {
    const q = queue();
    // radiusWu of alt_base_attacked in the default map: 64.
    expect(q.push({ kind: 'alt_base_attacked', x: 100, z: 100 })).toBe(true);
    now = 1000;
    expect(q.push({ kind: 'alt_base_attacked', x: 400, z: 400 })).toBe(false); // < 1500 ms
    now = 1500;
    expect(q.push({ kind: 'alt_base_attacked', x: 160, z: 100 })).toBe(false); // 60 WU ≤ 64
    expect(q.push({ kind: 'alt_base_attacked', x: 400, z: 400 })).toBe(true);
    now = 3100;
    expect(q.push({ kind: 'alt_base_attacked', x: 105, z: 95 })).toBe(false); // near the first
    expect(q.push({ kind: 'alt_base_attacked', x: 400, z: 350 })).toBe(false); // near the second
    expect(q.push({ kind: 'alt_base_attacked', x: 170, z: 100 })).toBe(true); // 70 WU from the first
    // Without a position there is no exception.
    now = 5000;
    expect(q.push({ kind: 'alt_base_attacked' })).toBe(false);
  });

  it('uses the default radius (48 WU) when the rule has none', () => {
    const q = queue({ rules: {} });
    q.push({ kind: 'alt_unit_attacked', x: 0, z: 0 });
    now = 2000;
    expect(q.push({ kind: 'alt_unit_attacked', x: 48, z: 0 })).toBe(false);
    expect(q.push({ kind: 'alt_unit_attacked', x: 49, z: 0 })).toBe(true);
  });
});

describe('AlertQueue expiry and overflow', () => {
  it('drops pending alerts older than maxAgeMs', () => {
    const q = queue();
    const sink = new RecordingSink(resolver);
    q.push({ kind: 'alt_base_attacked', x: 0, z: 0 });
    q.update(now, sink);
    now = 100;
    q.push({ kind: 'alt_unit_attacked', x: 0, z: 0 });
    // First voice never ends (alive, no update until after the max age).
    now = 6101;
    q.update(now, sink);
    expect(sink.plays).toHaveLength(1);
    expect(q.stats.expired).toBe(1);
    expect(q.size).toBe(0);
  });

  it('evicts the lowest priority when full and rejects equal/lower priority', () => {
    const q = queue({ maxQueue: 2 });
    const sink = new RecordingSink(resolver);
    expect(q.push({ kind: 'alt_build_complete' })).toBe(true); // 96
    expect(q.push({ kind: 'alt_storage_full' })).toBe(true); // 96
    expect(q.push({ kind: 'alt_factory_upgraded' })).toBe(false); // 96, full
    expect(q.push({ kind: 'alt_base_attacked', x: 0, z: 0 })).toBe(true); // 99 evicts the oldest 96
    expect(q.size).toBe(2);
    q.update(now, sink);
    next(q, sink);
    expect(sink.plays.map((p) => p.soundId)).toEqual(['common:alt_base_attacked', 'common:alt_storage_full']);
    expect(q.stats.overflow).toBe(2);
  });
});

describe('AlertQueue history and jumpToLast', () => {
  function announce(q: AlertQueue, sink: RecordingSink, kind: string, x?: number, z?: number): void {
    now += 20_000; // beyond every repeat interval
    expect(q.push({ kind, x, z })).toBe(true);
    next(q, sink);
  }

  it('returns false without history or without positions', () => {
    const q = queue();
    const sink = new RecordingSink(resolver);
    expect(q.jumpToLast()).toBe(false);
    announce(q, sink, 'alt_mass_stall');
    announce(q, sink, 'alt_storage_full');
    expect(q.jumpToLast()).toBe(false);
    expect(jumps).toEqual([]);
  });

  it('jumps to the newest located alert and steps back on repeated calls within 3 s', () => {
    const q = queue();
    const sink = new RecordingSink(resolver);
    announce(q, sink, 'alt_base_attacked', 10, 20);
    announce(q, sink, 'alt_mass_stall');
    announce(q, sink, 'alt_unit_attacked', 30, 40);
    announce(q, sink, 'alt_enemy_air', 50, 60);
    announce(q, sink, 'alt_storage_full');
    expect(q.jumpToLast()).toBe(true);
    now += 1000;
    expect(q.jumpToLast()).toBe(true);
    now += 2900;
    expect(q.jumpToLast()).toBe(true);
    now += 100;
    expect(q.jumpToLast()).toBe(true); // wraps around to the newest
    expect(jumps).toEqual([
      [50, 60],
      [30, 40],
      [10, 20],
      [50, 60],
    ]);
    // After the window it starts at the newest again.
    now += 3001;
    q.jumpToLast();
    expect(jumps.at(-1)).toEqual([50, 60]);
    // A new alert during stepping becomes the newest target after the window.
    now += 500;
    q.jumpToLast(); // → [30, 40]
    announce(q, sink, 'alt_commander_danger', 70, 80);
    q.jumpToLast();
    expect(jumps.at(-1)).toEqual([70, 80]);
  });

  it('keeps only historySize entries (ring)', () => {
    const q = queue({ historySize: 3 });
    const sink = new RecordingSink(resolver);
    announce(q, sink, 'alt_base_attacked', 1, 1);
    announce(q, sink, 'alt_unit_attacked', 2, 2);
    announce(q, sink, 'alt_enemy_air', 3, 3);
    announce(q, sink, 'alt_commander_danger', 4, 4);
    expect(q.historyList().map((r) => r.x)).toEqual([4, 3, 2]);
    q.jumpToLast();
    q.jumpToLast();
    q.jumpToLast();
    q.jumpToLast();
    expect(jumps).toEqual([
      [4, 4],
      [3, 3],
      [2, 2],
      [4, 4],
    ]);
  });

  it('does not allocate while idle', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    const q = queue();
    const sink = new RecordingSink(resolver);
    for (let i = 0; i < 10_000; i++) q.update(i, sink);
    gc?.();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200_000; i++) q.update(i, sink);
    gc?.();
    if (gc !== undefined) expect(process.memoryUsage().heapUsed - before).toBeLessThan(256 * 1024);
  });
});
