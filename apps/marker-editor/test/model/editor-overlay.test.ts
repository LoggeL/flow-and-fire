/**
 * editor.json (marker overlay of a map source directory) against the real `pnpm maps` compile step
 * (packages/formats/scripts/mapc.ts compileMapSource, allowed in tests):
 * editor export → content/maps/src/<name>/editor.json → compile → the editor's map again.
 *
 * - unchanged map: the compiled .rtsmap is byte-identical to the checked-in file;
 * - edited map (start moved, interleaved spots added, prop field): every chunk except PREV is
 *   byte-identical to the editor's own .rtsmap export and the sim bytes are identical (PREV is the
 *   thumbnail mapc re-renders with the new markers; the editor passes the old one through);
 * - the compiled map re-exports the identical editor.json (fixpoint), a second compile is identical.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mapSimBytes, readContainer } from '@faf/formats';
import { afterAll, describe, expect, it } from 'vitest';
import { compileMapSource, EDITOR_OVERLAY_FILE as MAPC_OVERLAY_FILE } from '../../../../packages/formats/scripts/mapc.ts';
import { EditorDocument } from '../../src/model/document.ts';
import { EDITOR_OVERLAY_FILE, toEditorOverlayJson } from '../../src/model/markers-json.ts';
import { applyOp } from '../../src/model/ops.ts';
import { bytesEqual, circle, field, MAP_NAMES, mapBytes, openDoc, REPO_ROOT, WU, type MapName } from './support.ts';

const tmp = mkdtempSync(join(tmpdir(), 'faf-editor-overlay-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Copies content/maps/src/<name> to a temp dir, writes editor.json and runs the pnpm-maps compile. */
function compileWithOverlay(name: MapName, overlay: string, tag: string): { bytes: Uint8Array } {
  const dir = join(tmp, `${name}-${tag}`);
  cpSync(resolve(REPO_ROOT, 'content/maps/src', name), dir, { recursive: true });
  writeFileSync(join(dir, EDITOR_OVERLAY_FILE), overlay);
  return compileMapSource(dir);
}

function chunksWithoutPreview(bytes: Uint8Array): { id: string; hex: string }[] {
  return readContainer(bytes, 'RTSM')
    .chunks.filter((c) => c.id !== 'PREV')
    .map((c) => ({ id: c.id, hex: Buffer.from(c.data).toString('hex') }));
}

function edited(name: MapName): EditorDocument {
  const doc = openDoc(name);
  const s0 = doc.starts[0]!;
  const sp = doc.spots[0]!;
  const c = (doc.sizeWu / 2) * WU;
  return applyOp(doc, {
    kind: 'batch',
    ops: [
      { kind: 'moveMarkers', refs: [{ type: 'start', index: 0 }], dx: 2 * WU + 1, dz: -WU },
      // hydro before mass: markers.json could not express this order, editor.json keeps it.
      { kind: 'addSpot', spot: { kind: 'hydro', x: sp.x + 3 * WU, z: sp.z } },
      { kind: 'addSpot', spot: { kind: 'mass', x: s0.x + 6 * WU + 17, z: s0.z + 5 * WU } },
      { kind: 'addField', field: field(circle(c / WU, c / WU, 12), { name: 'Hain Mitte', seed: 0xc0ffee }) },
    ],
  }).doc;
}

describe('editor.json overlay (markers owned by the editor survive pnpm maps)', () => {
  it('uses the same file name as mapc', () => {
    expect(EDITOR_OVERLAY_FILE).toBe(MAPC_OVERLAY_FILE);
  });

  for (const name of MAP_NAMES) {
    it(`${name}: overlay of the unchanged map compiles to the byte-identical checked-in .rtsmap`, () => {
      const doc = openDoc(name);
      const out = compileWithOverlay(name, toEditorOverlayJson(doc), 'plain');
      expect(bytesEqual(out.bytes, mapBytes(name))).toBe(true);
    });

    it(`${name}: edited overlay → compile → same chunks (except PREV), same sim bytes, fixpoint`, () => {
      const doc = edited(name);
      const overlay = toEditorOverlayJson(doc);
      const out = compileWithOverlay(name, overlay, 'edit');
      const editorBytes = doc.toBytes();
      expect(chunksWithoutPreview(out.bytes)).toEqual(chunksWithoutPreview(editorBytes));
      const compiled = EditorDocument.fromBytes(out.bytes);
      expect(bytesEqual(mapSimBytes(compiled.toRtsMap()), mapSimBytes(doc.toRtsMap()))).toBe(true);
      expect(compiled.spots.slice(-2).map((s) => s.kind)).toEqual(['hydro', 'mass']);
      expect(compiled.fields.map((f) => f.name)).toEqual(['Hain Mitte']);
      expect(toEditorOverlayJson(compiled)).toBe(overlay);
      expect(bytesEqual(compileWithOverlay(name, overlay, 'again').bytes, out.bytes)).toBe(true);
    });
  }
});
