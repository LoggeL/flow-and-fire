/** EditorSession (file IO without DOM): bundled maps, bytes/files, errors, save, markers.json. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAP_FX_ONE as FX } from '@faf/formats';
import { EditorStore } from '../../src/app/store.ts';
import { HttpError } from '../../src/io/errors.ts';
import { baseName, EditorSession, LoadCancelled, rtsmapFileName } from '../../src/io/session.ts';
import { bytesEqual, mapBytes, MAPS_DIR, type MapName } from './support.ts';

const NAMES: readonly MapName[] = ['hollow-ridge', 'tessera', 'braidwater', 'setons'];

/** fetch over content/maps (like the vite maps plugin); counts requests. */
function fakeFetch(log: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    log.push(url.pathname);
    if (url.pathname === '/maps/index.json') {
      return new Response(JSON.stringify(NAMES.slice().sort().map((name) => ({ name, file: `${name}.rtsmap`, bytes: 1 }))), { status: 200 });
    }
    const m = /^\/maps\/([a-z0-9-]+)\.rtsmap$/.exec(url.pathname);
    if (m !== null && (NAMES as readonly string[]).includes(m[1]!)) {
      return new Response(new Uint8Array(readFileSync(resolve(MAPS_DIR, `${m[1]}.rtsmap`))), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

interface Harness {
  readonly store: EditorStore;
  readonly session: EditorSession;
  readonly downloads: { data: Uint8Array | string; name: string; type: string }[];
  readonly remembered: string[];
  readonly requests: string[];
  confirmAnswer: boolean;
  confirms: number;
  frames: number;
}

function harness(): Harness {
  const store = new EditorStore();
  const h: Harness = {
    store,
    session: null as unknown as EditorSession,
    downloads: [],
    remembered: [],
    requests: [],
    confirmAnswer: true,
    confirms: 0,
    frames: 0,
  };
  let t = 0;
  (h as { session: EditorSession }).session = new EditorSession({
    store,
    afterOpen: async () => {
      h.frames++;
    },
    download: (data, name, type) => h.downloads.push({ data, name, type }),
    confirm: () => {
      h.confirms++;
      return h.confirmAnswer;
    },
    now: () => (t += 5),
    fetch: fakeFetch(h.requests),
    rememberMap: (name) => h.remembered.push(name),
  });
  return h;
}

describe('EditorSession', () => {
  it('lists and loads bundled maps; saving without changes downloads the identical file', async () => {
    const h = harness();
    expect(await h.session.listBundled()).toEqual(['braidwater', 'hollow-ridge', 'setons', 'tessera']);
    await h.session.listBundled();
    expect(h.requests.filter((p) => p === '/maps/index.json')).toHaveLength(1);
    for (const name of NAMES) {
      await h.session.loadBundled(name);
      expect(h.session.ready.value).toBe(true);
      expect(h.session.mapName.value).toBe(name);
      expect(h.store.fileName.value).toBe(`${name}.rtsmap`);
      expect(h.session.save()).toBe(true);
      const d = h.downloads.at(-1)!;
      expect(d.name).toBe(`${name}.rtsmap`);
      expect(d.type).toBe('application/octet-stream');
      expect(bytesEqual(d.data as Uint8Array, mapBytes(name))).toBe(true);
    }
    expect(h.remembered).toEqual([...NAMES]);
    expect(h.session.loadMs).toBeGreaterThan(0);
    expect(h.session.lastError).toBeNull();
  });

  it('save marks the state saved and names the file; markers.json is its own download', async () => {
    const h = harness();
    await h.session.loadBundled('hollow-ridge');
    h.store.addSpot('mass', 250 * FX, 200 * FX);
    expect(h.store.dirty.value).toBe(true);
    expect(h.session.save()).toBe(true);
    expect(h.store.dirty.value).toBe(false);
    expect(h.store.status.value).toMatch(/^hollow-ridge\.rtsmap gespeichert/);
    expect(h.session.exportMarkersJson()).toBe(true);
    const m = h.downloads.at(-1)!;
    expect(m.name).toBe('markers.json');
    expect(m.type).toBe('application/json');
    const json = JSON.parse(m.data as string) as { mass: { x: number; z: number }[]; starts: unknown[] };
    expect(json.starts).toHaveLength(2);
    expect(json.mass).toContainEqual({ x: 250, z: 200 });
    expect(h.store.status.value).toBe('markers.json exportiert');
    expect(h.session.exportEditorOverlay()).toBe(true);
    const o = h.downloads.at(-1)!;
    expect(o.name).toBe('editor.json');
    expect(o.type).toBe('application/json');
    const overlay = JSON.parse(o.data as string) as { editorOverlay: number; spots: { kind: string; x: number; z: number }[] };
    expect(overlay.editorOverlay).toBe(1);
    expect(overlay.spots.at(-1)).toEqual({ kind: 'mass', x: 250, z: 200 });
    expect(h.store.status.value).toMatch(/^editor\.json exportiert/);
  });

  it('a broken file keeps the previous map and reports a German message', async () => {
    const h = harness();
    await h.session.loadBundled('tessera');
    const bad = mapBytes('hollow-ridge');
    bad[0] = 0;
    await expect(h.session.loadBytes(bad, 'kaputt.rtsmap')).rejects.toThrow();
    expect(h.store.status.value).toMatch(/^Karte kaputt konnte nicht geladen werden: keine Flow-&-Fire-Kartendatei/);
    expect(h.session.lastError).not.toBeNull();
    expect(h.session.ready.value).toBe(true);
    expect(h.session.mapName.value).toBe('tessera');
    expect(h.store.doc.value!.name).toBe(h.store.doc.value!.source.meta.name);
    expect(h.store.fileName.value).toBe('tessera.rtsmap');

    const truncated = mapBytes('hollow-ridge').slice(0, 100);
    await expect(h.session.loadBytes(truncated, 'kurz.rtsmap')).rejects.toThrow();
    expect(h.store.status.value).toContain('unvollständig');
  });

  it('a missing bundled map fails with an HTTP 404 error', async () => {
    const h = harness();
    const err = await h.session.loadBundled('does-not-exist').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(String(err)).toContain('404');
    expect(h.store.status.value).toContain('404');
    expect(h.session.ready.value).toBe(false);
    await expect(h.session.loadBundled('../etc/passwd')).rejects.toThrow(/ungültiger Kartenname/);
  });

  it('opens files and raw bytes; other file types are refused', async () => {
    const h = harness();
    const bytes = mapBytes('braidwater');
    await h.session.loadFile({ name: 'Downloads/meine-karte.rtsmap', arrayBuffer: async () => bytes.slice().buffer });
    expect(h.session.mapName.value).toBe('meine-karte');
    expect(h.store.fileName.value).toBe('Downloads/meine-karte.rtsmap');
    h.session.save();
    expect(h.downloads.at(-1)!.name).toBe('meine-karte.rtsmap');
    await expect(h.session.loadFile({ name: 'bild.png', arrayBuffer: async () => new ArrayBuffer(4) })).rejects.toThrow();
    expect(h.store.status.value).toBe('bild.png ist keine .rtsmap-Datei');
    await h.session.loadBytes(mapBytes('setons'), 'setons');
    expect(h.session.mapName.value).toBe('setons');
    expect(h.remembered).toEqual([]);
  });

  it('asks before discarding unsaved changes (UI paths only)', async () => {
    const h = harness();
    await h.session.loadBundled('hollow-ridge');
    h.store.addSpot('hydro', 250 * FX, 200 * FX);
    h.confirmAnswer = false;
    await expect(h.session.loadBundled('tessera', { confirmDiscard: true })).rejects.toBeInstanceOf(LoadCancelled);
    expect(h.session.mapName.value).toBe('hollow-ridge');
    expect(h.store.dirty.value).toBe(true);
    h.confirmAnswer = true;
    await h.session.loadBundled('tessera', { confirmDiscard: true });
    expect(h.session.mapName.value).toBe('tessera');
    expect(h.confirms).toBe(2);
    // Programmatic loads never ask; clean documents never ask.
    await h.session.loadBundled('setons', { confirmDiscard: true });
    expect(h.confirms).toBe(2);
  });

  it('a newer load supersedes one still in flight', async () => {
    const h = harness();
    const a = h.session.loadBundled('setons');
    const b = h.session.loadBundled('tessera');
    await Promise.all([a, b]);
    expect(h.session.mapName.value).toBe('tessera');
    expect(h.store.fileName.value).toBe('tessera.rtsmap');
    expect(h.session.ready.value).toBe(true);
  });

  it('save/export without a map report it', () => {
    const h = harness();
    expect(h.session.save()).toBe(false);
    expect(h.session.exportMarkersJson()).toBe(false);
    expect(h.session.exportEditorOverlay()).toBe(false);
    expect(h.store.status.value).toBe('Keine Karte geladen');
    expect(h.downloads).toEqual([]);
  });

  it('file name helpers', () => {
    expect(baseName('hollow-ridge.rtsmap')).toBe('hollow-ridge');
    expect(baseName('a/b\\c.RTSMAP')).toBe('c');
    expect(baseName('plain')).toBe('plain');
    expect(rtsmapFileName('x.rtsmap')).toBe('x.rtsmap');
    expect(rtsmapFileName('x')).toBe('x.rtsmap');
    expect(rtsmapFileName(null)).toBe('map.rtsmap');
    expect(rtsmapFileName('.rtsmap')).toBe('map.rtsmap');
  });
});
