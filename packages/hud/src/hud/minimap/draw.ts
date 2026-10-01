import type { MinimapFog, MinimapUnits, MinimapSpot, MinimapPing } from '../../model/minimap.ts';
/** Canvas contract used by the browser renderer and the recording tests. */
export type MiniCtx = Pick<CanvasRenderingContext2D, 'clearRect' | 'fillRect' | 'strokeRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'stroke' | 'fill' | 'arc' | 'fillStyle' | 'strokeStyle' | 'lineWidth'>;
export function worldPoint(x: number, y: number, rect: {
    left: number;
    top: number;
    width: number;
    height: number;
}, mapSize: number): readonly [
    number,
    number
] {
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    return [clamp((x - rect.left) / rect.width) * mapSize, clamp((y - rect.top) / rect.height) * mapSize];
}
export function drawFog(ctx: MiniCtx, fog: MinimapFog | null, edge: number): void {
    if (!fog)
        return;
    const cell = edge / fog.res;
    for (let z = 0; z < fog.res; z++)
        for (let x = 0; x < fog.res; x++) {
            const value = fog.cells[z * fog.res + x];
            if (value === 2)
                continue;
            ctx.fillStyle = value === 0 ? 'rgba(0,0,0,.94)' : 'rgba(0,0,0,.55)';
            ctx.fillRect(x * cell, z * cell, cell + .5, cell + .5);
        }
}
export function drawDynamics(ctx: MiniCtx, edge: number, mapSize: number, units: MinimapUnits, spots: readonly MinimapSpot[], pings: readonly MinimapPing[], colors: readonly string[], timeS: number): void {
    const scale = edge / mapSize;
    ctx.lineWidth = 1;
    for (const s of spots) {
        const x = s.x * scale, z = s.z * scale;
        ctx.strokeStyle = s.kind === 'mass' ? '#7fd1b2' : '#8fd0e8';
        ctx.fillStyle = s.taken ? '#2a5747' : '#7fd1b2';
        ctx.beginPath();
        ctx.moveTo(x, z - 3);
        ctx.lineTo(x + 3, z);
        ctx.lineTo(x, z + 3);
        ctx.lineTo(x - 3, z);
        ctx.closePath();
        if (!s.taken)
            ctx.fill();
        ctx.stroke();
    }
    for (let i = 0; i < units.count; i++) {
        const x = units.x[i]! * scale, z = units.z[i]! * scale, kind = units.kind[i]!, size = kind === 1 ? 6 : 4;
        ctx.fillStyle = colors[units.army[i]! % colors.length] ?? '#999';
        ctx.strokeStyle = '#100e0d';
        if (kind === 2) {
            ctx.strokeStyle = '#aaa';
            ctx.beginPath();
            ctx.arc(x, z, 3, 0, Math.PI * 2);
            ctx.stroke();
        }
        else if (kind === 3) {
            ctx.strokeStyle = String(ctx.fillStyle);
            ctx.strokeRect(x - size / 2, z - size / 2, size, size);
        }
        else {
            ctx.fillRect(x - size / 2, z - size / 2, size, size);
            ctx.strokeRect(x - size / 2, z - size / 2, size, size);
        }
    }
    for (const p of pings) {
        const age = timeS - p.bornS;
        if (age < 0 || age > 8)
            continue;
        ctx.strokeStyle = '#ff8a2a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x * scale, p.z * scale, 4 + (age % 2) * 5, 0, Math.PI * 2);
        ctx.stroke();
    }
}
export function drawCamera(ctx: MiniCtx, corners: readonly (readonly [
    number,
    number
])[], mapSize: number, edge: number): void {
    ctx.clearRect(0, 0, edge, edge);
    if (!corners.length)
        return;
    ctx.strokeStyle = '#f6f0e5';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    corners.forEach(([x, z], i) => { if (i === 0)
        ctx.moveTo(x / mapSize * edge, z / mapSize * edge);
    else
        ctx.lineTo(x / mapSize * edge, z / mapSize * edge); });
    ctx.closePath();
    ctx.stroke();
}
