# ms2-p0-formats – Root-Tooling, MS2-Dependencies, `@faf/formats`, `rules/terrain`, Karte hollow-ridge

Stand 2026-09-29 (MS2, Welle 0). Messwerte lokal auf Apple M5 Pro (Node 24.18).

## Umgesetzt

| Bereich | Inhalt | Ort |
|---|---|---|
| Dependencies | alle MS2-Pakete installiert, Lockfile aktualisiert, `pnpm install --frozen-lockfile` grün | `package.json`-Dateien, `pnpm-lock.yaml`, `pnpm-workspace.yaml` |
| Neue Workspace-Pakete | `@faf/formats` (vollständig), `@faf/assets-pipeline` und `@faf/render-bench` (Gerüste für Welle 1/2) | `packages/formats`, `tools/assets-pipeline`, `tools/render-bench` |
| Root-Konfiguration | TS-References, ESLint (Determinismus für `formats/src`, Browser-/Worker-/Node-Globals), dependency-cruiser (`render-bench` ≠ sim), `.gitignore`, Root-Scripts `maps`/`assets`/`bench:spk4`, `ci:local` erweitert | Root |
| Chunk-Container | 16-B-Kopf, Chunks `4CC ‖ len ‖ data ‖ pad ‖ CRC32`, Reader mit `FormatError` (code, chunkId, offset) | `packages/formats/src/container.ts`, `crc32.ts`, `errors.ts` |
| `.rtsmap` | META (kanonisches JSON), `HGT `, SPLT, PROP, PREV, unbekannte Chunks bytegleich erhalten, `createRtsMap`, `mapSimHash`, `mapSimData` | `packages/formats/src/rtsmap.ts`, `utf8.ts` |
| CLI-Import | `mapc` (Heightmap `.png`/`.pgm`/`.r16` + `markers.json` → `.rtsmap`), PNG-Codec, Heightmap-I/O, Vorschaubild | `packages/formats/scripts/{mapc,png,heightmap-io}.ts` |
| Kartengenerator | `mapgen` (deterministisch, Ganzzahl-Value-Noise über `rng32`), `maps` (alle Karten) | `packages/formats/scripts/{mapgen,maps}.ts` |
| Karte hollow-ridge | 512 WU, 2 Spieler, Fluss mit See, Tiefwasser-Rinne, 2 Furten, Plateaus/Mesas mit Klippen und Rampen, 16 Mass + 2 Hydro | `content/maps/hollow-ridge.rtsmap`, Quellen `content/maps/src/hollow-ridge/` |
| Höhenabfrage | `sampleHeightRaw`, `waterDepthRaw`, `isDeepWaterForLand`, Konstanten | `packages/rules/src/terrain.ts` (Export über `rules/src/index.ts`) |

## Dependencies und Workspace (für alle Folgepakete fix – Lockfile nicht mehr ändern)

| Paket | neue Einträge |
|---|---|
| `@faf/formats` (neu) | deps `@faf/fixed`, `@faf/protocol`; devDeps `@faf/rules` (nur Scripts/Tests, s. Abweichungen), `tsx`, `@types/node`; exports `'.' → ./src/index.ts`; Scripts `mapc`, `mapgen`, `maps` |
| `@faf/assets-pipeline` (neu, Gerüst) | deps `@gltf-transform/core` 4.5.1, `@gltf-transform/extensions` 4.5.1, `@gltf-transform/functions` 4.5.1, `meshoptimizer` 1.3.0, `@faf/formats`, `@faf/blueprints`; devDeps `tsx`, `@types/node`; **kein** `build`-Script (setzt ms2-p3-client); `src/index.ts` = `export {};` |
| `@faf/render-bench` (neu, Gerüst) | deps `@faf/render`, `@faf/formats`, `@faf/rules`, `@faf/fixed`, `@faf/protocol`, `gl-matrix` 3.4.4; devDeps `vite`, `@playwright/test`, `tsx`, `@types/node`; keine Scripts (setzt ms2-p5-spk4); `tsconfig.json` für Browser-Code (`lib DOM`, `types: vite/client`) mit `include: src/**, page/**`; `scripts/`, `test/` laufen über `tsconfig.tests.json` |
| `@faf/sim`, `@faf/sim-host`, `@faf/headless` | + `@faf/formats` (tsconfig-Reference ergänzt) |
| `@faf/client` | + `@faf/formats`, + `meshoptimizer` 1.3.0 (Decoder im Asset-Worker) |
| `@faf/game` | + `@faf/formats`, + `@faf/rules` (E2E-Hooks vergleichen CPU-Höhen), devDep `@faf/assets-pipeline` (topologische Build-Reihenfolge) |

`@gltf-transform/*@4.5.1` ist jünger als die `minimumReleaseAge` von pnpm 11; pnpm hat die drei Versionen (wie
typescript-eslint in MS1) unter `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` eingetragen.

## Root-Konfiguration

- `tsconfig.json`: References `packages/formats`, `tools/assets-pipeline`, `tools/render-bench`.
- `eslint.config.js`: `SIM_SOURCES += 'packages/formats/src/**/*.ts'` (nicht `scripts/`); Browser-Globals zusätzlich für
  `tools/render-bench/{src,page}/**/*.ts`; Worker-Globals für `packages/client/src/assets/worker.ts` (fester Pfad des
  Asset-Workers, P3); Node-Globals für `tools/assets-pipeline/**`.
- `.dependency-cruiser.cjs`: neue Regel `render-bench-never-imports-sim` (`tools/render-bench/**` → weder `sim` noch
  `sim-host`, per Probe geprüft); `formats-deps` (fixed, protocol) und alle übrigen Paketgrenzen unverändert.
- `tools/eslint-plugin-sim/test/config.test.ts`: `formats` in der Liste der Sim-Pakete; eigener Test für
  `packages/formats/src/{rtsmap,container}.ts`; Negativfälle `packages/formats/{scripts,test}`, `tools/render-bench/src`,
  `tools/assets-pipeline/src`. Der bestehende Test „jede Runtime-Dependency von `@faf/sim`“ erfasst `formats` automatisch.
- `.gitignore`: `tools/render-bench/dist/`, `tools/render-bench/results/*.json`.
- Root-Scripts: `maps` = `pnpm --filter @faf/formats run maps`, `assets` = `pnpm --filter @faf/assets-pipeline run build`,
  `bench:spk4` = `pnpm --filter @faf/render-bench run spk4`; `ci:local` endet mit
  `… && pnpm --filter @faf/assets-pipeline run check && pnpm bench:spk4 -- --quick`. **Bis Welle 1 (`check`) bzw. Welle 2
  (`spk4`) die Scripts anlegen, scheitert `ci:local` an dieser Stelle** (erwartet).
- `vitest.config.ts`, `playwright.config.ts`, `tsconfig.base.json`, `tsconfig.tests.json`, `.npmrc`: unverändert (die
  bestehenden Globs decken die neuen Pakete ab).

## Verträge / APIs für die Folgepakete

### `@faf/formats` (Determinismus-Lint gilt für `src/`)

```ts
// Container
readContainer(bytes: Uint8Array, magic: string): { magic; formatVersion; chunks: {id, data, offset}[] }  // data = Views
writeContainer(magic: string, formatVersion: number, chunks: {id, data}[]): Uint8Array
class FormatError extends Error { code: FormatErrorCode; chunkId: string | null; offset: number }
// codes: truncated, bad-magic, bad-container-version, bad-format-version, bad-reserved, bad-chunk-id, bad-length,
//        bad-crc, bad-padding, trailing-bytes, missing-chunk, duplicate-chunk, chunk-order, bad-json, non-canonical, bad-value
crc32(bytes, off?, len?), crc32Update(crc, bytes, off?, len?); encodeUtf8 / decodeUtf8 (strikt, ohne TextEncoder)

// .rtsmap
interface RtsMap { meta: MapMeta; heights: Uint16Array; splat: MapSplat | null; props: MapProp[];
                   preview: MapPreview | null; unknownChunks: UnknownChunk[] }            // alles readonly
interface MapMeta { v: 1; name; sizeWu; heightScaleRaw; waterLevelRaw: number | null;
                    starts: {army, x, z}[]; spots: {kind: 'mass'|'hydro', x, z}[];
                    light: {azimuthDeg, elevationDeg, sun: [r,g,b], ambient: [r,g,b]}; strata: {name, color}[] }
type MapSplat = { codec: 0; layers: 4|8; resolution; planes: Uint8Array[] }        // raw RGBA8, layers/4 Ebenen
              | { codec: 1; layers: 4|8; resolution; payload: Uint8Array }         // KTX2 (MS9), roh durchgereicht
interface MapProp { id: string; x; z; yaw /* Ang16 */; scalePermille }
interface MapPreview { width; height; rgba: Uint8Array }
interface UnknownChunk { id; data; after: 'META'|'HGT '|'SPLT'|'PROP'|'PREV'|null }
readRtsMap(bytes): RtsMap            // wirft FormatError; prüft Container, Reihenfolge, Werte, kanonisches META
writeRtsMap(map): Uint8Array         // validiert; read → write eines kanonischen Files ist bytegleich
createRtsMap(params): RtsMap         // validierender Builder: {sizeWu, name?, heightScaleRaw? (32), waterLevelRaw? (null),
                                     //   heights?: Uint16Array | (x, z) => u16, starts? (Army 0 bei ¼,¼ / 1 bei ¾,¾),
                                     //   spots?, props?, light?, strata?, splat?, preview?, unknownChunks?}
validateRtsMap(map); metaToCanonicalJson(meta); mapSimBytes(map)
mapSimHash(map): number              // u32
mapSimData(map): MapSimData          // {sizeWu, dim, heightScaleRaw, waterLevelRaw, heights, starts, spots, props}
                                     // teilt die Arrays (read-only behandeln); strukturell == rules.Heightfield
```

Die Struktur von `MapSimData` ist gleichzeitig ein `rules.Heightfield`; `splat` (codec 0) ist strukturell kompatibel zu
`TerrainDesc.splat` von `@faf/render` (`{layers, resolution, planes}`).

**Koordinaten:** Fx raw (Q20.12, 4.096 = 1 WU), `x` nach Osten, `z` nach Süden (Kartenbild: Zeile 0 = `z = 0`,
„NW“ = kleines x und z). Höhen-Index `z·dim + x`, `dim = sizeWu + 1`, 1 Sample pro WU. `light.azimuthDeg`: Richtung,
aus der die Sonne scheint, 0° = von +z, 90° = von +x (Vektor zur Sonne = (sin az·cos el, sin el, cos az·cos el)).

### Container- und Chunk-Layout (alle Ganzzahlen little-endian)

| Teil | Layout |
|---|---|
| Dateikopf (16 B) | u32 magic (4CC, ASCII in Dateireihenfolge, `'RTSM'`) · u16 containerVersion = 1 · u16 formatVersion = 1 · u32 chunkCount · u32 reserved = 0 |
| Chunk | 4CC-ID · u32 dataLength · data · Nullpadding auf 4 B · u32 CRC-32 (IEEE) über ID ‖ Länge ‖ data |
| `META` | kanonisches UTF-8-JSON, feste Schlüsselreihenfolge `v,name,sizeWu,heightScaleRaw,waterLevelRaw,starts,spots,light,strata`, kein Whitespace, nur Ganzzahlen; Starts nach Army aufsteigend (eindeutig); Koordinaten in [0, sizeWu·4096] |
| `HGT ` | u16 dim (= sizeWu + 1) · u16 reserved = 0 · dim² × u16 (Index z·dim + x); sizeWu 2er-Potenz 64..4096, getestet bis 1024 |
| `SPLT` (optional) | u8 codec (0 raw RGBA8, 1 KTX2) · u8 layerCount (4/8) · u16 resolution · codec 0: layerCount/4 RGBA8-Ebenen à resolution², codec 1: Rohdaten |
| `PROP` | u32 count · je Prop: u16 idLen · id (UTF-8, `ns:name`) · Nullpadding auf 4 (relativ zum Chunkanfang) · i32 x · i32 z · u16 yaw · u16 scalePermille |
| `PREV` (optional) | u16 w · u16 h · w·h RGBA8 |

Schreibreihenfolge fest: `META`, `HGT `, `SPLT`?, `PROP`, `PREV`?. Unbekannte Chunks werden mit ihrem Vorgänger-Chunk
(`after`) aufbewahrt und dort wieder geschrieben; fehlt der Anker beim Schreiben (z. B. PREV entfernt), rückt der Chunk
hinter den nächsten vorhandenen Vorgänger. Der Reader lehnt doppelte oder falsch sortierte bekannte Chunks, Nicht-Null-
Padding/-Reserved, Restbytes und nicht-kanonisches META ab – dadurch ist jede gelesene Datei bytegleich schreibbar.

### `mapSimHash` (geht in `simId` ein, PLAN §3.1)

`xxHash32(seed 0)` über die kanonischen Sim-Bytes (LE): ASCII `FAFMAPS1` ‖ u32 sizeWu ‖ u32 heightScaleRaw ‖ u32
Wasser-Flag (0/1) ‖ i32 waterLevelRaw (0 ohne Wasser) ‖ u32 Anzahl Starts ‖ je (u32 army, i32 x, i32 z) ‖ u32 Anzahl
Spots ‖ je (u32 kind 0 = mass / 1 = hydro, i32 x, i32 z) ‖ `HGT `-Nutzdaten ‖ `PROP`-Nutzdaten. **Nicht** enthalten:
name, light, strata, SPLT, PREV, unbekannte Chunks (Test belegt Invarianz bzw. Änderung bei Höhe/Spot/Spot-Art/
Wasserspiegel/Skala/Start/Prop).

**Festgeschrieben: `mapSimHash(hollow-ridge) = 0x90ec94f0`** (Golden in `packages/formats/test/rtsmap.test.ts`).
`content/maps/hollow-ridge.rtsmap`: 593.420 B, SHA-256 `fd3b31d78689817d3d9cd81dfb330b707ed969f5e8f28c1f0718fc8c5f6591ec`
(Chunks: META 1.131 B, `HGT ` 526.342 B, PROP 340 B, PREV 65.540 B = 128×128).

### Höhenformel (verbindlich, bitgleich CPU/GPU) – `@faf/rules`

```ts
interface Heightfield { sizeWu; dim; heights: Uint16Array; heightScaleRaw }   // dim = sizeWu + 1
sampleHeightRaw(hf, xRaw, zRaw): number                  // allokationsfrei
waterDepthRaw(hf, waterLevelRaw: number | null, xRaw, zRaw): number   // ≤ 0 = trocken; null ⇒ −Höhe
isDeepWaterForLand(hf, waterLevelRaw, xRaw, zRaw): boolean            // Tiefe > LAND_MAX_WATER_DEPTH_RAW
LAND_MAX_WATER_DEPTH_RAW = 2048 (0,5 WU); HEIGHT_FRAC_BITS = 8
```

`xr = clamp(xRaw, 0, sizeWu·4096 − 16)`, `zr` analog; `cx = xr >> 12`, `cz = zr >> 12`; `fx = (xr >> 4) & 255`,
`fz = (zr >> 4) & 255`; `a = h00·(256 − fx) + h10·fx`, `b = h01·(256 − fx) + h11·fx`, `c = a·(256 − fz) + b·fz`
(`0 ≤ c < 2³²`); Ergebnis `(c >>> 16)·s + (((c & 0xffff)·s) >>> 16)` mit `s = heightScaleRaw` (= `floor(c·s/65536)`,
< 2³¹). An Sample-Punkten exakt `h·s`. Der Code-Kommentar verweist auf `TERRAIN_HEIGHT_GLSL` in `@faf/render`, das die
Formel bitgleich spiegeln muss (rules importiert render nicht). Jede Änderung ist eine Sim-Änderung (SIM_BUILD) **und**
eine Shader-Änderung.

### CLI-Import `mapc` (PLAN §3.9)

```
pnpm --filter @faf/formats mapc -- --heightmap <datei.png|.pgm|.r16> --markers <markers.json> --out <datei.rtsmap>
                                   [--splat a.png[,b.png]] [--preview]
```

Relative Pfade gelten ab dem Aufrufverzeichnis (`INIT_CWD`). `markers.json` (WU, Dezimalzahlen):
`{version: 1, name, sizeWu, heightScale (WU/Stufe) | heightScaleRaw, waterLevel (WU | null), starts: [{army, x, z}],
mass: [{x, z}], hydro: [{x, z}], props?: [{id, x, z, yawDeg?, scale?}], light?, strata?}`. Umrechnung genau einmal im
CLI: WU → raw `Math.round(v·4096)`, `yawDeg` → Ang16 `Math.round(yawDeg·65536/360) mod 65536`, `scale` →
`Math.round(scale·1000)`, `heightScale` → `Math.round(heightScale·4096)`. Validierung sammelt alle Probleme in einer
`MapcError`-Meldung: Größe ≠ Heightmap (`2^n+1`, 64..4096), Punkte außerhalb der Karte, doppelte Army, fehlende Starts,
Spot/Start im Tiefwasser (> 0,5 WU), unbekannte Schlüssel, Skala außerhalb 1..32 raw, ungültige Prop-IDs/Licht/Strata.
Heightmaps: PNG 16 Bit Graustufen roh, 8 Bit ×257; PGM P5 16 Bit big-endian roh (8 Bit ×257); `.r16` roh LE, Seite aus
Dateigröße (`2^n+1`). `--splat`: 1–2 RGBA8-PNGs (4/8 Layer). `--preview`: deterministisches 128×128-Vorschaubild
(Höhenrampe, Schummerung, Wasser nach Tiefe, Spots, Starts).

Konvention für `content/maps/src/<name>/`: genau eine `heightmap.{png,pgm,r16}`, `markers.json`, optional
`splat-0.png`/`splat-1.png`; `pnpm maps` (Root) = `mapgen` für alle Generatoren + `mapc` (immer mit Vorschau) für alle
Quellordner → `content/maps/<name>.rtsmap`. Idempotent: zweiter Lauf ändert nichts (die PNG wird nur neu geschrieben,
wenn sich die dekodierten Samples ändern – unabhängig von der zlib-Version).

## Karte hollow-ridge (Daten für Goldens und E2E; alle Werte in WU)

Eigenes Design, nichts aus FA. **Punktsymmetrisch** um (256, 256): `(x, z) ↔ (512 − x, 512 − z)` (Test: alle Höhen und
Spots). `sizeWu` 512, `heightScaleRaw` 32 (1 Stufe = 1/128 WU), **Wasserspiegel 10 WU** (`waterLevelRaw` 40.960),
Höhen 6,5–36,1 WU.

| Element | Daten |
|---|---|
| Starts | Army 0 (96, 96) NW, Army 1 (416, 416) SE – je auf einem Plateau (24,1 WU) |
| Mass (16) | NW-Plateau (116, 100), (100, 116), (78, 106), (106, 78); SE-Plateau (396, 412), (412, 396), (434, 406), (406, 434); Mesa NW (112, 244), (128, 256); Mesa SE (400, 268), (384, 256); Furt NE: (328, 128) NW-Ufer, (384, 184) SE-Ufer; Furt SW: (128, 328) NW-Ufer, (184, 384) SE-Ufer |
| Hydro (2) | (200, 150) NW-Seite, (312, 362) SE-Seite |
| Props (12, MS8) | `core:rock_01`/`core:rock_02` bei (180, 60), (230, 40), (60, 200), (40, 250), (200, 190), (260, 90) und gespiegelt |
| Fluss | Mittellinie `x + z = 512` (NE-Ecke → SW-Ecke) mit Mäander `u = 16·sin(2π·(x − z)/400)` (u-Einheit = 1/√2 WU, ±11,3 WU quer); Querprofil über `q = |x + z − 512 − Mäander|` (u-Einheiten): Sohle 6,5 WU für q ≤ 14, Anstieg auf 10 WU bis q = 30 (Uferlinie), Ufer +0,25 WU pro u |
| Tiefwasser-Rinne | Tiefe > 0,5 WU für q < ≈ 27,7 (≈ ±19,6 WU quer zur Mittellinie); Sohle 6,5 WU = **3,5 WU tief**. Stichproben mit 3,5 WU Tiefe: (256, 256), (300, 212), (212, 300); tief auch (420, 92), (92, 420), NE-Ecke (506, 6), SW-Ecke (6, 506). Querschnitt durch (300, 212) entlang (1, 1): tief von t = −8,25 bis +23,75 |
| See | um (256, 256), für \|x − z\| < 100 bis zu 40 u (≈ 28 WU) breiter; Querschnitt durch die Mitte entlang (1, 1): tief von t = −33,75 bis +33,75 |
| Furten | **(356, 156)** und **(156, 356)**, Sohle 9,75 WU = **0,25 WU tief** im Kern (±10 u ≈ ±7 WU entlang des Flusses), Übergang bis ±22 u; Querungslinie entlang (1, 1), z. B. (326, 126) → (386, 186) bzw. (126, 326) → (186, 386): max. Tiefe 0,25 WU, nass von t = −14,75 bis +14,75 |
| Plateau-Klippen | um (96, 96) und (416, 416): flach r ≤ 52, Klippe 52–58 (≈ 10 WU Abfall auf 6 WU, Steigung > 1,5); Rampen je 12 WU breit (+3 WU Übergang), Steigung ≈ 0,28: NW nach Osten (x 148 → 182 bei z 90–102) und Süden (z 148 → 182 bei x 90–102); SE nach Westen (x 364 → 330 bei z 410–422) und Norden (z 364 → 330 bei x 410–422) – Engstellen für M5 |
| Mesas („Hollow Ridge“) | (120, 250) und (392, 262): 36 WU, flach r ≤ 22, Klippe 22–27; je eine Rampe (12 WU breit, Steigung ≈ 0,46): NW-Mesa nach Norden (z 228 → 180 bei x 114–126), SE-Mesa nach Süden (z 284 → 332 bei x 386–398) |
| Tiefland | ≈ 14 WU ± 3,75 WU Value-Noise (4 Oktaven 64/32/16/8 WU) |

Belegte Eigenschaften (`packages/formats/test/hollow-ridge.test.ts`): Flutfüllung über 1-WU-Samples mit
`isDeepWaterForLand` verbindet die Starts; ohne die Furt-Umgebungen (±30 WU) sind sie getrennt; jede Furt allein
verbindet. Alle Spots/Starts trocken; 4 Mass je Startplateau.

Vorschläge für ms2-p2-sim (`ridge-water-block`): Furt-Gruppe von (320, 120) (trocken, 15,5 WU) nach (392, 192)
(13,1 WU) – die Gerade läuft durch die Furt (356, 156). Blockierte Gruppe z. B. von (230, 170) (14,0 WU) nach
(282, 342) (14,0 WU): die Gerade quert die Rinne/den See, Tiefwasser zwischen beiden. `ridge-1000-move`: Hänge an den
Rampen (z. B. (160, 96) 20,8 WU, (176, 96) 16,7 WU) und am Mesa-Fuß (120, 200) 23,2 WU → (120, 180) 14,0 WU.

## Tests

| Datei | Inhalt |
|---|---|
| `packages/formats/test/crc32.test.ts` | Vektoren (`123456789` → `0xCBF43926`, leer, `a`, Fox, 32×0x00/0xFF), Offset/Chaining (fast-check) |
| `packages/formats/test/utf8.test.ts` | Gleichheit mit TextEncoder/TextDecoder (fast-check), lange Eingaben, fehlerhafte Sequenzen |
| `packages/formats/test/container.test.ts` | Roundtrip (fast-check, 300 Fälle), dokumentiertes Byte-Layout, jede Fehlerart mit code/chunkId/offset, jede Kürzung → FormatError |
| `packages/formats/test/rtsmap.test.ts` | Roundtrip aller Chunk-Arten, kanonisches META, **jede Einzelbit-Kippung** einer 9,0-KB-Datei erkannt, Kürzungen, `ZZZZ` zwischen META und HGT übersprungen **und** bytegleich zurückgeschrieben, Anker-Fallback, KTX2-Durchreichung, Reihenfolge/Duplikat/fehlend/nicht-kanonisch, Wertevalidierung, 1024-WU-Roundtrip, hollow-ridge read → write bytegleich, **Golden `mapSimHash` 0x90ec94f0**, Invarianz/Änderung, `mapSimData` |
| `packages/formats/test/png.test.ts` | encode → decode Identität (Gray 8/16, RGBA 8/16), **alle 5 Filtertypen** × 4 Farbtypen × 2 Tiefen gegen einen unabhängigen Referenz-Encoder, Fehlerfälle (CRC, Signatur, IEND, Interlace, Palette) |
| `packages/formats/test/mapc.test.ts` | Umrechnung WU → raw, **.png/.pgm/.r16 derselben Höhen ⇒ bytegleiche Karte**, 8-Bit-Eingaben, Splat, Validierungsfehler (inkl. Spot im Tiefwasser), CLI per `node --import tsx`, **Frische: mapc aus `content/maps/src` == eingecheckte `.rtsmap`**, mapgen == eingecheckte Quellen |
| `packages/formats/test/hollow-ridge.test.ts` | Kartenvertrag (s. o.): Kopf, Symmetrie, Spots, Rinne/Furten per Flutfüllung, Furt-Tiefe ≤ 0,3 WU, Tiefwasser-Stichproben, Klippen/Rampen |
| `packages/rules/test/terrain.test.ts` | Property-Test gegen BigInt-Referenz `floor(c·s/65536)` (**10⁵ Fälle**, Skalen 1..32, Extremwerte 0/65535), alle Skalen × Extrem-Ecken × Randbrüche, `h·s` an Sample-Punkten, Interpolation, Randklemmung, Wassertiefe/Tiefwasser-Schwelle, Durchsatz (geloggt) |
| `tools/eslint-plugin-sim/test/config.test.ts` | `sim/determinism` greift in `packages/formats/src`, nicht in `formats/{scripts,test}`, `render-bench`, `assets-pipeline` |

Selbsttest (2026-09-29): `pnpm install --frozen-lockfile` grün; `pnpm vitest run packages/formats packages/rules
tools/eslint-plugin-sim` 11 Dateien, **178 Tests grün**; `pnpm lint` grün (ESLint 0 Warnungen, dep-cruiser 0 Verstöße);
`tsc -p tsconfig.tests.json` grün; `tsc -b` für formats, rules, sim, sim-host, headless, assets-pipeline grün;
`pnpm maps` zweimal (auch nach Löschen der Ausgaben) → SHA-256 von `.rtsmap`, `heightmap.png`, `markers.json` identisch.

## Messwerte (lokal, Apple M5 Pro, Node 24.18, nicht gegated)

| Messung | Wert |
|---|---|
| `sampleHeightRaw` (512-WU-Feld, Zufallspunkte) | ≈ 69 M Abfragen/s (≈ 14 ns) |
| `readRtsMap(hollow-ridge)` (593 KB, inkl. CRC, JSON, Validierung) | 1,5–2,5 ms |
| `mapSimHash(hollow-ridge)` | ≈ 1,0 ms |
| `writeRtsMap(hollow-ridge)` | ≈ 1,3 ms |
| `pnpm maps` (mapgen + mapc + Vorschau, Prozess gesamt) | ≈ 0,8 s |

## Abweichungen mit Begründung

- **`@faf/rules` als devDependency von `@faf/formats`:** `mapc` prüft „Spot/Start im Tiefwasser“ und rendert die Vorschau
  mit derselben Höhenformel wie die Sim; das bleibt auf `scripts/` und `test/` beschränkt (dep-cruiser `formats-deps`
  für `src/` unverändert: nur fixed, protocol).
- **Strikter Reader:** Neben den geforderten Prüfungen lehnt `readRtsMap` nicht-kanonisches META, falsch sortierte oder
  doppelte bekannte Chunks, Padding/Reserved ≠ 0 und Restbytes ab (zusätzliche Codes `non-canonical`, `chunk-order`,
  `duplicate-chunk`, `bad-padding`, `trailing-bytes`, `bad-json`). Nur so ist „read → write bytegleich“ für jede
  akzeptierte Datei garantiert und jede Einzelbit-Kippung erkennbar. Starts müssen nach Army aufsteigend sortiert sein
  (`mapc`/`createRtsMap` sortieren selbst).
- **Unbekannte Chunks:** Position als „nach bekanntem Chunk X“ (`after`) statt absoluter Index gespeichert; das bleibt
  auch beim Hinzufügen/Entfernen optionaler Chunks definiert.
- **Wertebereiche**, die der Auftrag offenließ: `waterLevelRaw` 0..65535·s, 1–16 Starts, ≤ 1.024 Spots, ≤ 65.536 Props,
  ≤ 8 Strata, Name ≤ 128 B, Prop-ID `^[a-z0-9_]+:[a-z0-9_./-]+$` ≤ 128 B, Splat-Auflösung ≤ 4.096, Vorschau ≤ 1.024².
- **PNG-Decoder** kann zusätzlich RGB/RGBA/Gray+Alpha (für `--splat`); 8-Bit-Heightmaps (PNG/PGM) werden mit ×257 auf
  16 Bit gespreizt (sonst wären sie bei `heightScaleRaw ≤ 32` höchstens 2 WU hoch).
- **UTF-8** eigener strikter Codec in `formats/src` (Sim-Pakete haben kein `TextEncoder` in `lib ES2022`).
- **Höhen der Karte 6,5–36,1 WU** („etwa 0–40“): tiefster Punkt ist die Flusssohle, höchster die Mesas.
- **Props in hollow-ridge** verweisen auf `core:rock_01`/`core:rock_02`, die es erst ab MS8 als Blueprints gibt; sie
  stehen schon jetzt in der Karte, damit PROP in `mapSimHash` und im Roundtrip real belegt ist. Die Sim ignoriert Props
  in MS2 (ms2-p2).

## Hinweise / bekannte Grenzen

- `pnpm typecheck` (Root, `tsc -b`) ist zum Zeitpunkt dieses Fragments nur wegen der parallel laufenden Arbeit von
  ms2-p1-render in `packages/render/src/renderer.ts` rot; alle Projekte dieses Pakets und `tsconfig.tests.json` sind grün.
- `tools/headless/tsconfig.harness-worker.json` (gehört ms2-p2) referenziert `packages/formats` noch nicht; sobald der
  Harness-Worker `@faf/formats` importiert, dort ergänzen.
- `ci:local` scheitert bis Welle 1/2 an `@faf/assets-pipeline check` und `bench:spk4` (Scripts fehlen noch, s. o.).
- SPLT codec 1 (KTX2) wird nur roh durchgereicht (Dekodierung ab MS9); hollow-ridge hat keine Splatmap (Auto-Splat im
  Renderer).
- Die PNG-Bytes der Quelle hängen von der zlib-Version ab; `mapgen` schreibt sie deshalb nur bei geänderten Samples neu,
  Frische-Tests vergleichen Samples bzw. die daraus erzeugte `.rtsmap` (unabhängig von zlib).
