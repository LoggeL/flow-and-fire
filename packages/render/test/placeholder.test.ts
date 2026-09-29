import { describe, expect, it } from 'vitest';
import type { MeshData } from '../src/mesh/placeholder.ts';
import { CYL_SEGMENTS, createPlaceholderMesh } from '../src/mesh/placeholder.ts';
import { MESH_VERTEX_STRIDE, mergeMeshes } from '../src/passes/units.ts';

function checkMesh(m: MeshData): void {
  expect(m.positions.length).toBe(m.vertexCount * 3);
  expect(m.normals.length).toBe(m.vertexCount * 3);
  expect(m.partIds.length).toBe(m.vertexCount);
  expect(m.indices.length).toBe(m.indexCount);
  expect(m.indexCount % 3).toBe(0);
  for (let i = 0; i < m.vertexCount; i++) {
    const len = Math.hypot(m.normals[i * 3]!, m.normals[i * 3 + 1]!, m.normals[i * 3 + 2]!);
    expect(Math.abs(len - 1)).toBeLessThan(1e-6);
    expect(m.partIds[i]).toBe(0);
  }
  for (const idx of m.indices) expect(idx).toBeLessThan(m.vertexCount);
  // Counter-clockwise from outside: geometric face normal agrees with the vertex normals.
  const p = m.positions;
  const n = m.normals;
  for (let t = 0; t < m.indexCount; t += 3) {
    const a = m.indices[t]!;
    const b = m.indices[t + 1]!;
    const c = m.indices[t + 2]!;
    const ux = p[b * 3]! - p[a * 3]!;
    const uy = p[b * 3 + 1]! - p[a * 3 + 1]!;
    const uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
    const vx = p[c * 3]! - p[a * 3]!;
    const vy = p[c * 3 + 1]! - p[a * 3 + 1]!;
    const vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const avgN = [0, 1, 2].map((k) => n[a * 3 + k]! + n[b * 3 + k]! + n[c * 3 + k]!);
    expect(cx * avgN[0]! + cy * avgN[1]! + cz * avgN[2]!).toBeGreaterThan(0);
  }
}

describe('createPlaceholderMesh', () => {
  it('builds a box with 24 vertices / 36 indices and the requested extents', () => {
    const m = createPlaceholderMesh({ hull: 'box', size: [2, 1, 3] });
    expect(m.vertexCount).toBe(24);
    expect(m.indexCount).toBe(36);
    expect(m.bounds).toEqual([-1, 0, -1.5, 1, 1, 1.5]);
    checkMesh(m);
  });

  it('builds a cylinder with a fixed segment count', () => {
    const m = createPlaceholderMesh({ hull: 'cyl', size: [2, 4, 2] });
    // mantle: 2 rings; caps: center + ring each.
    expect(m.vertexCount).toBe(CYL_SEGMENTS * 2 + 2 * (CYL_SEGMENTS + 1));
    expect(m.indexCount).toBe(CYL_SEGMENTS * 6 + 2 * CYL_SEGMENTS * 3);
    expect(m.vertexCount).toBe(66);
    expect(m.indexCount).toBe(192);
    expect(m.bounds[1]).toBe(0);
    expect(m.bounds[4]).toBe(4);
    expect(m.bounds[3]).toBeCloseTo(1, 6);
    checkMesh(m);
  });

  it('keeps elliptic cylinder normals normalized', () => {
    checkMesh(createPlaceholderMesh({ hull: 'cyl', size: [4, 1, 1] }));
  });

  it('rejects non-positive sizes', () => {
    expect(() => createPlaceholderMesh({ hull: 'box', size: [0, 1, 1] })).toThrow(/positive/);
  });
});

describe('mergeMeshes', () => {
  it('interleaves position/normal/partId and pre-offsets indices', () => {
    const box = createPlaceholderMesh({ hull: 'box', size: [1, 1, 1] });
    const cyl = createPlaceholderMesh({ hull: 'cyl', size: [1, 2, 1] });
    const merged = mergeMeshes([box, cyl]);
    expect(merged.indexFormat).toBe('uint16');
    expect(Array.from(merged.firstIndex)).toEqual([0, 36]);
    expect(Array.from(merged.indexCount)).toEqual([36, 192]);
    expect(merged.vertices.byteLength).toBe((24 + 66) * MESH_VERTEX_STRIDE);
    expect(merged.indices[36]).toBe(cyl.indices[0]! + 24);
    const f32 = new Float32Array(merged.vertices);
    const i8 = new Int8Array(merged.vertices);
    const u8 = new Uint8Array(merged.vertices);
    const v = 24 + 5;
    const o = v * MESH_VERTEX_STRIDE;
    expect(f32[o >> 2]).toBe(cyl.positions[5 * 3]);
    expect(i8[o + 12]).toBe(Math.round(cyl.normals[5 * 3]! * 127));
    expect(u8[o + 16]).toBe(0);
  });
});
