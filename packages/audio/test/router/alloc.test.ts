/**
 * Allocation of the router hot path, measured with garbage included (bench/heap.ts: no gc()
 * between the loop and the second reading; GCs during the loop are added back).
 *
 * Own file on purpose: like in the game (one sink, one event source, one spatial model) the
 * router's call sites stay monomorphic here. In a file that first drives the router through many
 * differently configured instances V8 optimises `handle` less aggressively and boxes a few more
 * doubles (≈ 5 B per event measured in event-router.test.ts) — still below the bound, but noisy.
 */
import { describe, expect, it } from 'vitest';
import { measureAllocation } from '../../bench/heap.ts';
import { DEFAULT_EVENT_SOUND_MAP, DEFAULT_EVENT_TYPES, EVENT_FLAG_STRUCTURE, type SimEventKind } from '../../src/events/index.ts';
import { EventRouter } from '../../src/router/index.ts';
import { CameraSpatialModel } from '../../src/spatial/index.ts';
import { ArrayEventSource, FX_ONE } from '../../src/types.ts';
import { loadRealManifest } from '../support/index.ts';
import { ManifestResolver, RecordingAlerts, RecordingSink } from './fakes.ts';

const VISUALS: Record<number, string> = {
  1: 'core:wpn_cannon_t1',
  2: 'core:wpn_spark_mg_t1',
  3: 'core:wpn_mg_t1',
  4: 'core:wpn_slag_mortar_t1',
  5: 'core:wpn_not_in_map',
  6: 'core:wpn_scriber_rail_t3',
  7: 'core:wpn_gatling_t2',
};

describe('EventRouter allocation', () => {
  it('routes 100,000 events after warm-up allocating < 1 MB (garbage included)', () => {
    const resolver = new ManifestResolver(loadRealManifest());
    const sink = new RecordingSink(resolver);
    sink.record = false;
    const alerts = new RecordingAlerts();
    alerts.record = false;
    alerts.accept = false;
    const spatial = new CameraSpatialModel();
    spatial.setListener({ focusX: 256, focusZ: 256, height: 60, viewHalfWidth: 40, rightX: 1, rightZ: 0 });
    const r = new EventRouter({ map: DEFAULT_EVENT_SOUND_MAP, resolver, faction: 'varkan', visualName: (v) => VISUALS[v], alerts, spatial });
    // One 10-Hz tick of a big battle: 200 events of all MS5 kinds + alerts, fractional positions.
    const kinds: SimEventKind[] = ['weaponFire', 'weaponFire', 'weaponFire', 'projectileImpact', 'projectileImpact', 'unitDeath', 'buildComplete', 'alert', 'reclaimStart'];
    const src = new ArrayEventSource();
    for (let i = 0; i < 200; i++) {
      const k = kinds[i % kinds.length]!;
      const x = Math.round((((i * 17) % 512) + 0.37) * FX_ONE);
      const z = Math.round((((i * 29) % 512) + 0.61) * FX_ONE);
      src.push(DEFAULT_EVENT_TYPES[k], 1 + (i % 7), 0, (i * 53) % 256, i % 11 === 0 ? EVENT_FLAG_STRUCTURE : 0, x, 0, z, i % 4, 7);
    }
    const run = (from: number, to: number): void => {
      for (let t = from; t < to; t++) {
        for (let i = 0; i < src.count; i++) src.events[i]!.tick = t;
        r.handle(src, sink, t * 0.1 + 0.013, t * 100.25);
      }
    };
    run(0, 200);
    const playsBefore = sink.count;
    const m = measureAllocation(() => run(200, 700));
    const plays = sink.count - playsBefore;
    expect(r.stats.events).toBe(700 * 200);
    expect(plays).toBeGreaterThan(10_000);
    console.info(`router alloc: ${(m.allocatedBytes / 1024).toFixed(1)} KB over 100000 events, ${plays} plays, ${m.gcs} GCs during the loop`);
    expect(m.allocatedBytes).toBeLessThan(1024 * 1024);
  });
});
