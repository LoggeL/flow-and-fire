import type { ClientMap } from '@faf/client';

const RAW = 4096;
/** Light from the north-west, as in the strategic view; shading only, no invented features. */
const LIGHT = [-0.55, 0.62, -0.55] as const;

/** RGBA relief of the actual heightfield and water level, `res`×`res` samples. */
export function mapReliefPixels(map: Pick<ClientMap, 'sizeWu' | 'heightAtRaw' | 'minHeightRaw' | 'maxHeightRaw' | 'waterLevelRaw'>, res = 96): Uint8ClampedArray<ArrayBuffer> {
  const size = map.sizeWu, step = size / res, out = new Uint8ClampedArray(new ArrayBuffer(res * res * 4));
  const range = Math.max(1, map.maxHeightRaw - map.minHeightRaw), water = map.waterLevelRaw;
  const h = (x: number, z: number) => map.heightAtRaw(Math.min(size, Math.max(0, x)) * RAW, Math.min(size, Math.max(0, z)) * RAW) / RAW;
  for (let z = 0; z < res; z++) for (let x = 0; x < res; x++) {
    const wx = (x + .5) * step, wz = (z + .5) * step, ground = map.heightAtRaw(wx * RAW, wz * RAW), o = (z * res + x) * 4;
    if (water !== null && ground < water) {
      const depth = Math.min(1, (water - ground) / (6 * RAW));
      out[o] = 24 - depth * 10; out[o + 1] = 70 - depth * 25; out[o + 2] = 112 - depth * 30; out[o + 3] = 255; continue;
    }
    const dx = (h(wx + step, wz) - h(wx - step, wz)) / (2 * step), dz = (h(wx, wz + step) - h(wx, wz - step)) / (2 * step);
    const len = Math.hypot(dx, 1, dz), shade = Math.max(0.25, (-dx * LIGHT[0] + LIGHT[1] - dz * LIGHT[2]) / len / Math.hypot(...LIGHT));
    const e = (ground - map.minHeightRaw) / range, steep = Math.min(1, Math.hypot(dx, dz) * 1.2);
    const r = (58 + e * 40) * (1 - steep) + 92 * steep, g = (78 + e * 34) * (1 - steep) + 88 * steep, b = (44 + e * 18) * (1 - steep) + 80 * steep;
    out[o] = r * shade * 1.25; out[o + 1] = g * shade * 1.25; out[o + 2] = b * shade * 1.25; out[o + 3] = 255;
  }
  return out;
}

/** PNG data URL of the relief; undefined without a DOM canvas (workers, tests). */
export function mapPreviewUrl(map: Parameters<typeof mapReliefPixels>[0], res = 96): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas'); canvas.width = res; canvas.height = res;
  const context = canvas.getContext('2d'); if (context === null) return undefined;
  context.putImageData(new ImageData(mapReliefPixels(map, res), res, res), 0, 0);
  try { return canvas.toDataURL('image/png'); } catch { return undefined; }
}
