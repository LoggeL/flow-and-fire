export interface BuildGridPoint { readonly x: number; readonly z: number; }
/** Match the simulation's existing per-unit queue bound; never issue commands while sampling. */
export const MAX_BUILD_DRAG_SITES = 32;

/** Footprint-spaced rectangle, or one line when only one axis spans another footprint. */
export function buildDragGrid(anchor: BuildGridPoint, end: BuildGridPoint, widthRaw: number, heightRaw: number): readonly BuildGridPoint[] {
  if (![anchor.x, anchor.z, end.x, end.z, widthRaw, heightRaw].every(Number.isFinite) || widthRaw <= 0 || heightRaw <= 0) return [];
  const nx = Math.min(MAX_BUILD_DRAG_SITES, Math.floor(Math.abs(end.x - anchor.x) / widthRaw) + 1);
  const nz = Math.min(MAX_BUILD_DRAG_SITES, Math.floor(Math.abs(end.z - anchor.z) / heightRaw) + 1);
  const dx = end.x >= anchor.x ? widthRaw : -widthRaw, dz = end.z >= anchor.z ? heightRaw : -heightRaw;
  const points: BuildGridPoint[] = [];
  // Serpentine rows avoid returning the builder across the entire row between adjacent sites.
  for (let row = 0; row < nz && points.length < MAX_BUILD_DRAG_SITES; row++) {
    for (let col = 0; col < nx && points.length < MAX_BUILD_DRAG_SITES; col++) {
      points.push({ x: anchor.x + (row % 2 === 0 ? col : nx - 1 - col) * dx, z: anchor.z + row * dz });
    }
  }
  return points;
}
