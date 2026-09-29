import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ClientMap, RAW_PER_WU, RtsCamera, TerrainPicker } from '@faf/client';
import { asFx, type ArmyId, type Handle, type Tick } from '@faf/fixed';
import { Op, encodeBatch, encodeMove } from '@faf/protocol';
import { describe, expect, it } from 'vitest';
import { decodeLastMove } from '../src/game.ts';
import { probePoints, referencePick } from '../src/testing/reference.ts';

const ridge = ClientMap.fromBytes(new Uint8Array(readFileSync(resolve(import.meta.dirname, '../../../content/maps/hollow-ridge.rtsmap'))));

describe('E2E reference pick (float64 march 1/64 WU + bisection)', () => {
  it('agrees with the client TerrainPicker within 1/16 WU on camera rays over hollow-ridge', () => {
    const cam = new RtsCamera();
    cam.setViewport(1280, 720);
    let s = 12345;
    const rnd = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const picker = new TerrainPicker(ridge);
    let compared = 0;
    for (let k = 0; k < 40; k++) {
      cam.targetX = (40 + rnd() * 432) * RAW_PER_WU;
      cam.targetZ = (40 + rnd() * 432) * RAW_PER_WU;
      cam.targetY = ridge.heightWU(cam.targetX / RAW_PER_WU, cam.targetZ / RAW_PER_WU) * RAW_PER_WU;
      cam.distance = 20 + rnd() * 150;
      cam.pitch = (40 + rnd() * 40) * (Math.PI / 180);
      cam.yaw = rnd() * Math.PI * 2;
      cam.update();
      for (let j = 0; j < 5; j++) {
        const px = rnd() * 1280;
        const py = 100 + rnd() * 620;
        if (!picker.pick(cam, px, py) || !picker.hit) continue;
        const ray = cam.screenToRay(px, py);
        const ref = referencePick(ridge, ray.origin[0]!, ray.origin[1]!, ray.origin[2]!, ray.dir[0]!, ray.dir[1]!, ray.dir[2]!);
        expect(ref).not.toBeNull();
        expect(Math.hypot(ref!.x - picker.wuX, ref!.z - picker.wuZ)).toBeLessThanOrEqual(1 / 16);
        expect(Math.abs(ref!.y - picker.wuY)).toBeLessThanOrEqual(1 / 16);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  it('rays that leave the map or point up have no hit', () => {
    expect(referencePick(ridge, -10, 50, -10, -0.7, -0.1, -0.7)).toBeNull();
    expect(referencePick(ridge, 100, 50, 100, 0, 1, 0)).toBeNull();
    const down = referencePick(ridge, 96, 60, 96, 0, -1, 0);
    expect(down!.y).toBeCloseTo(ridge.heightWU(96, 96), 6);
  });
});

describe('probe points', () => {
  it('deterministic, inside the map except every 64th point (≤ 1 WU outside)', () => {
    const a = probePoints(10_000, 7, 512);
    expect(probePoints(10_000, 7, 512)).toEqual(a);
    expect(probePoints(10_000, 8, 512)).not.toEqual(a);
    let outside = 0;
    for (let i = 0; i < 10_000; i++) {
      const x = a[2 * i]!;
      const z = a[2 * i + 1]!;
      const out = x < 0 || z < 0 || x > 512 * 4096 || z > 512 * 4096;
      if (out) outside++;
      if (i % 64 !== 63) expect(out).toBe(false);
      expect(x).toBeGreaterThanOrEqual(-4096);
      expect(x).toBeLessThanOrEqual(513 * 4096);
    }
    expect(outside).toBeGreaterThan(0);
  });
});

describe('command tap', () => {
  it('decodes the last Move of a batch (right-click target)', () => {
    const env = (seq: number, units: number[], x: number, y: number, z: number) => ({
      tick: 0 as Tick,
      army: 0 as ArmyId,
      seq,
      op: Op.Move,
      flags: 0,
      units: units as Handle[],
      payload: encodeMove({ x: asFx(x), y: asFx(y), z: asFx(z) }),
    });
    const mv = decodeLastMove(encodeBatch([env(3, [1, 2], 100, 5, 200), env(4, [1], 7, 8, 9)]));
    expect(mv).toEqual({ seq: 4, units: 1, x: 7, y: 8, z: 9 });
  });
});
