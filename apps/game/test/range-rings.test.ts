import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeSimBin } from '@faf/blueprints/simbin';
import { FlowFlags, FrameFlags, FrameReader, FrameWriter, UnitFlags } from '@faf/protocol';
import { describe, expect, it } from 'vitest';
import { FrameRangeRings, MAX_RANGE_RINGS, MAX_RANGE_SOURCES, equalRangeRings, type RangeProjection } from '../src/hud/range-rings.ts';

const bp = decodeSimBin(new Uint8Array(readFileSync(resolve(import.meta.dirname, '../../../content/generated/sim.bin'))));
const raw = (wu: number) => wu * 4096;
interface Unit { readonly handle: number; readonly id?: string; readonly flags?: number; readonly army?: number; readonly x?: number; readonly z?: number; readonly prevX?: number; readonly build?: number }
function frame(units: readonly Unit[], viewer = 0, flowFlags?: number, staleFlow = false): FrameReader {
  const writer = new FrameWriter({ units: units.length, parts: 0, projectiles: 0, beams: 0, events: 0, debugBytes: 0, flow: 1 });
  const bytes = new Uint8Array(writer.capacityBytes);
  writer.beginFrame(bytes, 1, 5, 0, 1000, viewer, FrameFlags.Paused, 0, 0, 0);
  for (const unit of units) {
    const x = raw(unit.x ?? 256), z = raw(unit.z ?? 256), visual = bp.indexOf(unit.id ?? 'core:str_t1_radar');
    expect(visual).toBeGreaterThanOrEqual(0);
    writer.writeUnit(raw(unit.prevX ?? unit.x ?? 256), 0, z, x, 0, z, 0, 0, visual, unit.army ?? 0, 255, unit.build ?? 255, 0, unit.flags ?? 0, unit.handle, 0, 0);
  }
  if (flowFlags !== undefined && units[0]) {
    const unit = units[0]; writer.setFlowTick(staleFlow ? 4 : 5);
    writer.writeFlow(unit.handle, bp.indexOf(unit.id ?? 'core:str_t1_radar'), unit.army ?? 0, flowFlags, 1, 0xffffffff, 0, 0, 0, 0, 0, 0);
  }
  const reader = new FrameReader();
  expect(reader.reset(bytes.subarray(0, writer.endFrame()))).toBe(true);
  return reader;
}
const camera: RangeProjection = {
  mapSizeRaw: raw(512), viewportWidth: 1600, viewportHeight: 1200,
  heightAt: (x, z) => (x + z) / 16,
  project: (x, y, z, out) => { out[0] = x / 4096 * 2; out[1] = z / 4096 * 2 - y / 4096; return true; },
};
const allied = (army: number) => army === 0 || army === 2;
const project = (accepted: FrameReader, selected: readonly number[] = [42]) => new FrameRangeRings().project(accepted, bp, selected, camera, null, allied);

describe('current visible selected and placement ranges', () => {
  it('uses compiled sight and radar raw radii and follows terrain at each point', () => {
    const radar = bp.indexOf('core:str_t1_radar'), rings = project(frame([{ handle: 42 }]));
    expect(rings.map(ring => [ring.kind, ring.radiusRaw, ring.state])).toEqual([
      ['vision', bp.vision(radar), 'active'], ['radar', bp.radarCol[radar], 'active'],
    ]);
    for (const ring of rings) {
      expect(ring.segments.length).toBeGreaterThan(0);
      const point = ring.segments[0]!.split(' ')[0]!.split(',').map(Number);
      const x = raw(256) + ring.radiusRaw, z = raw(256), height = camera.heightAt(x, z) + 4096 / 16;
      expect(point[0]).toBeCloseTo(x / 4096 * 2, 0);
      expect(point[1]).toBeCloseTo(z / 4096 * 2 - height / 4096, 0);
    }
  });

  it('excludes enemies, ghosts, radar contacts, wrecks and stale handles but permits allies and observers', () => {
    const units: Unit[] = [
      { handle: 42 }, { handle: 43, army: 2, x: 270 }, { handle: 44, army: 1, x: 290 },
      { handle: 45, flags: UnitFlags.Ghost }, { handle: 46, flags: UnitFlags.Blip }, { handle: 47, flags: UnitFlags.Wreck },
    ];
    const selected = [42, 43, 44, 45, 46, 47, 999];
    expect(project(frame(units), selected)).toHaveLength(4);
    const observation = new FrameRangeRings().project(frame(units, -1), bp, selected, camera, null, () => false);
    expect(observation).toHaveLength(6);
    expect(project(frame(units), [999])).toEqual([]);
  });

  it('reads the enhanced commander blueprint and preserves weapon minimum and builder radii', () => {
    const commander = project(frame([{ handle: 42, id: 'core:cmd_commander_cannon' }]));
    const enhanced = bp.indexOf('core:cmd_commander_cannon'), weapon = bp.mountWeaponCol[bp.firstMount(enhanced)]!;
    expect(commander.find(ring => ring.kind === 'weapon')!.radiusRaw).toBe(bp.weaponRangeCol[weapon]);
    expect(commander.find(ring => ring.kind === 'build')!.radiusRaw).toBe(bp.buildRangeRawCol[enhanced]);
    expect(commander.find(ring => ring.kind === 'weapon')!.radiusRaw).toBe(raw(32));
    const artillery = project(frame([{ handle: 42, id: 'core:lnd_t1_arty' }]));
    const arty = bp.indexOf('core:lnd_t1_arty'), shell = bp.mountWeaponCol[bp.firstMount(arty)]!;
    expect(artillery.find(ring => ring.kind === 'weapon-min')!.radiusRaw).toBe(bp.weaponMinRangeCol[shell]);
  });

  it('marks planned, incomplete, paused and disabled radar accurately while sight stays active when paused', () => {
    const incomplete = project(frame([{ handle: 42, build: 80 }]));
    expect(incomplete.every(ring => ring.state === 'incomplete')).toBe(true);
    const paused = project(frame([{ handle: 42, flags: UnitFlags.Paused }]));
    expect(paused.find(ring => ring.kind === 'radar')!.state).toBe('paused');
    expect(paused.find(ring => ring.kind === 'vision')!.state).toBe('active');
    expect(project(frame([{ handle: 42, flags: UnitFlags.Stalled }])).find(ring => ring.kind === 'radar')!.state).toBe('stalled');
    expect(project(frame([{ handle: 42, flags: UnitFlags.Stalled }], 0, 0)).find(ring => ring.kind === 'radar')!.state).toBe('unpowered');
    expect(project(frame([{ handle: 42, flags: UnitFlags.Stalled }], 0, FlowFlags.Enabled)).find(ring => ring.kind === 'radar')!.state).toBe('active');
    expect(project(frame([{ handle: 42, flags: UnitFlags.Stalled }], 0, FlowFlags.Enabled, true)).find(ring => ring.kind === 'radar')!.state).toBe('stalled');
    const planned = new FrameRangeRings().project(frame([{ handle: 42, id: 'core:cmd_commander' }]), bp, [42], camera, { bp: bp.indexOf('core:str_t1_radar'), x: raw(240), z: raw(240) });
    expect(planned.map(ring => ring.kind)).toEqual(['radar', 'vision']);
    expect(planned.every(ring => ring.source === 'placement' && ring.state === 'planned')).toBe(true);
  });

  it('reprojects an unchanged paused frame and interpolates current unit positions', () => {
    const consumer = new FrameRangeRings(), accepted = frame([{ handle: 42, x: 260, prevX: 240 }]);
    const first = consumer.project(accepted, bp, [42], camera, null, allied, 0.5);
    expect(first[0]!.x).toBe(raw(250));
    const shifted: RangeProjection = { ...camera, project: (x, y, z, out) => { camera.project(x, y, z, out); out[0] = out[0]! + 20; return true; } };
    const second = consumer.project(accepted, bp, [42], shifted, null, allied, 0.5);
    expect(equalRangeRings(first, second)).toBe(false);
    expect(equalRangeRings(first, consumer.project(accepted, bp, [42], camera, null, allied, 0.5))).toBe(true);
    expect(consumer.project(null, bp, [42], camera)).toEqual([]);
    expect(project(frame([{ handle: 42, x: 260, prevX: 240, flags: UnitFlags.NoInterp }]))[0]!.x).toBe(raw(260));
  });

  it('caps and deduplicates large selections', () => {
    const units = Array.from({ length: 100 }, (_, i) => ({ handle: i + 1, x: 200 + i * 0.5 }));
    const rings = project(frame(units), units.map(unit => unit.handle));
    expect(rings).toHaveLength(MAX_RANGE_SOURCES * 2);
    expect(rings.length).toBeLessThanOrEqual(MAX_RANGE_RINGS);
    expect(project(frame(units.map(unit => ({ ...unit, x: 256 }))), units.map(unit => unit.handle))).toHaveLength(2);
  });

  it('splits rear-plane failures and map edges without connecting across invisible arcs and clips viewport coordinates', () => {
    const accepted = frame([{ handle: 42 }]);
    const clipped: RangeProjection = { ...camera, project: (x, y, z, out) => {
      if (z > raw(260) || z < raw(252)) return false;
      return camera.project(x, y, z, out);
    } };
    const rings = new FrameRangeRings().project(accepted, bp, [42], clipped);
    expect(rings[0]!.segments.length).toBeGreaterThanOrEqual(2);
    for (const segment of rings[0]!.segments) {
      const xs = segment.split(' ').map(point => Number(point.split(',')[0]));
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(5);
    }
    const edge = new FrameRangeRings().project(frame([{ handle: 42, x: 2, z: 256 }]), bp, [42], camera);
    for (const ring of edge) for (const segment of ring.segments) for (const point of segment.split(' ')) {
      const [x, y] = point.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(camera.viewportWidth);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(camera.viewportHeight);
    }
    const bad: RangeProjection = { ...camera, project: (_x, _y, _z, out) => { out[0] = NaN; out[1] = 0; return true; } };
    expect(new FrameRangeRings().project(accepted, bp, [42], bad)).toEqual([]);
    expect(new FrameRangeRings().project(accepted, bp, [42], { ...camera, project: () => false })).toEqual([]);
    const viewport = new FrameRangeRings().project(accepted, bp, [42], { ...camera, viewportWidth: 520, viewportHeight: 500 });
    for (const ring of viewport) for (const segment of ring.segments) for (const point of segment.split(' ')) {
      const [x, y] = point.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(520);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(500);
    }
  });
});
