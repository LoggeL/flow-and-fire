import type { MapLight } from '@faf/formats';

/**
 * Unit vector towards the sun (DECISIONS 19, format convention): azimuth 0° = sun from +z,
 * 90° = from +x; (sin az · cos el, sin el, cos az · cos el).
 */
export function sunDirection(light: MapLight): [number, number, number] {
  const az = (light.azimuthDeg * Math.PI) / 180;
  const el = (light.elevationDeg * Math.PI) / 180;
  const ce = Math.cos(el);
  return [Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce];
}
