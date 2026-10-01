import { sampleHeightRaw, type Heightfield } from './terrain.ts';
/** Pure shared placement verdict, no dependency on simulation or navigation implementation. */
export const PlacementVerdict = { Valid: 0, Bounds: 1, Grid: 2, Terrain: 3, Occupied: 4, Spot: 5 } as const;
export interface PlacementWorld {
    readonly terrain: Heightfield;
    readonly waterLevelRaw: number | null;
    /** One cell per WU: 0 blocked terrain, otherwise passable. */
    readonly terrainCells: Uint8Array;
    readonly footprints: Uint8Array | Uint16Array;
    /** Triples kind, xRaw, zRaw. */
    readonly spots: Int32Array;
    readonly spotCount: number;
}
export interface PlacementRequest {
    readonly x: number;
    readonly z: number;
    readonly w: number;
    readonly h: number;
    readonly yaw: number;
    readonly maxSlopeRaw: number;
    readonly spotKind: number;
}
export function footprintWidth(w: number, h: number, yaw: number): number { return ((yaw + 8192) >> 14) % 2 === 0 ? w : h; }
export function footprintHeight(w: number, h: number, yaw: number): number { return footprintWidth(h, w, yaw); }
export function footprintX(x: number, w: number): number { return Math.floor((x - w*2048)/4096); }
export function canPlace(world: PlacementWorld, request: PlacementRequest): number {
    const { x, z, yaw, maxSlopeRaw, spotKind } = request;
    const w = footprintWidth(request.w, request.h, yaw), h = footprintHeight(request.w, request.h, yaw);
    if (!Number.isInteger(x) || !Number.isInteger(z) || !Number.isInteger(yaw) || w < 1 || h < 1 || w > 64 || h > 64 || yaw < 0 || yaw > 65535)
        return PlacementVerdict.Grid;
    // Cell-aligned edges: odd footprints have a half-cell centre.
    if ((x - w * 2048) % 4096 !== 0 || (z - h * 2048) % 4096 !== 0)
        return PlacementVerdict.Grid;
    const x0 = footprintX(x, w), z0 = footprintX(z, h), size = world.terrain.sizeWu;
    if (x0 < 0 || z0 < 0 || x0 + w > size || z0 + h > size)
        return PlacementVerdict.Bounds;
    const centreY = sampleHeightRaw(world.terrain, x, z);
    for (let cz = z0; cz < z0 + h; cz++)
        for (let cx = x0; cx < x0 + w; cx++) {
            const cell = cz * size + cx;
            if (world.footprints[cell]! !== 0)
                return PlacementVerdict.Occupied;
            const at = cz * world.terrain.dim + cx, heights = world.terrain.heights;
            const h00 = heights[at]!, h10 = heights[at + 1]!, h01 = heights[at + world.terrain.dim]!, h11 = heights[at + world.terrain.dim + 1]!;
            const slope = (Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11)) * world.terrain.heightScaleRaw;
            if (slope > maxSlopeRaw)
                return PlacementVerdict.Terrain;
            const ground = sampleHeightRaw(world.terrain, cx * 4096 + 2048, cz * 4096 + 2048);
            if (world.terrainCells[cell] === 0 || (world.waterLevelRaw !== null && world.waterLevelRaw > ground) || Math.abs(ground - centreY) > maxSlopeRaw * Math.max(w, h))
                return PlacementVerdict.Terrain;
        }
    if (spotKind >= 0) {
        for (let i = 0; i < world.spotCount; i++)
            if (world.spots[i * 3] === spotKind && world.spots[i * 3 + 1] === x && world.spots[i * 3 + 2] === z)
                return PlacementVerdict.Valid;
        return PlacementVerdict.Spot;
    }
    return PlacementVerdict.Valid;
}
