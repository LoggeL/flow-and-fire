import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ClientMap } from '@faf/client';
import { readableGpuName, recommendPreset } from '../src/gpu-info.ts';
import { mapReliefPixels } from '../src/map-preview.ts';
import { describeSessionMap } from '../src/session-assets.ts';
import { presetSettings } from '../src/preset-settings.ts';

const hollow = new Uint8Array(readFileSync(fileURLToPath(new URL('../../../content/maps/hollow-ridge.rtsmap', import.meta.url))));

describe('settings device description', () => {
  it('shortens ANGLE renderer strings and recommends without claiming a measurement', () => {
    expect(readableGpuName('ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)')).toBe('Apple M2 Pro');
    expect(readableGpuName('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('NVIDIA GeForce RTX 3070');
    expect(readableGpuName('Mali-G78')).toBe('Mali-G78'); expect(readableGpuName('  ')).toBeNull();
    expect(recommendPreset({ name: 'Google SwiftShader', software: true, cores: 8 })).toBe('low');
    expect(recommendPreset({ name: null, software: false, cores: 8 })).toBe('medium');
    expect(recommendPreset({ name: 'Apple M2 Pro', software: false, cores: 4 })).toBe('medium');
    expect(recommendPreset({ name: 'Apple M2 Pro', software: false, cores: 10 })).toBe('high');
    expect(recommendPreset({ name: 'Intel(R) Iris(R) Xe Graphics', software: false, cores: 8 })).toBe('medium');
  });
  it('stores the values a chosen preset implies', () => {
    expect(presetSettings('high')).toMatchObject({ preset: 'high', shadowCascades: 2 });
    expect(presetSettings('low')).toMatchObject({ preset: 'low', shadowCascades: 0 });
  });
});

describe('skirmish map preview', () => {
  it('uses the actual spot records and a relief that follows the heightfield and water', () => {
    const menu = describeSessionMap('hollow-ridge', hollow).menu, map = ClientMap.fromBytes(hollow);
    expect(menu.spotPositions).toHaveLength(map.spots.length);
    expect(menu.spotPositions![0]).toEqual({ x: map.spots[0]!.x / (map.sizeWu * 4096), z: map.spots[0]!.z / (map.sizeWu * 4096), kind: map.spots[0]!.kind });
    const pixels = mapReliefPixels(map, 32), centre = (16 * 32 + 16) * 4;
    // Hollow Ridge has a river through the centre: the relief marks it as water (blue-dominant).
    expect(map.waterLevelRaw !== null && map.heightAtRaw(256 * 4096, 256 * 4096) < map.waterLevelRaw).toBe(true);
    expect(pixels[centre + 2]!).toBeGreaterThan(pixels[centre]!);
    const distinct = new Set<number>(); for (let i = 0; i < pixels.length; i += 4) distinct.add(pixels[i]! << 16 | pixels[i + 1]! << 8 | pixels[i + 2]!);
    expect(distinct.size).toBeGreaterThan(50);
  });
});
