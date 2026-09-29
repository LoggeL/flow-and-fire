# ms2-p3-client – ClientMap, Heightmap-Picking (G15), FA-Kamera (C1), Eingabe (G16/C11), Asset-Pipeline + Asset-Worker (P3), Blueprint-View mesh/lod

Stand 2026-09-29 (MS2, Welle 1). Feature-IDs (Client-Anteil): **C1** (Kamera), **C11** (Hotkeys über `code`,
Kontextmenü/Autoscroll unterdrückt, Fullscreen, Pointer-Confinement), **P3** (Asset-Pipeline, Asset-Worker, Manifest,
Fallback), **M1/M4** client-seitig (ClientMap → Terrain + Spot-Decals), **P2** client-seitig (PartStream an
`RenderView.parts`, Blueprint-`view.mesh`/`view.lod`); Grundbausteine **G15** (Screen↔World per Heightmap-Raymarch)
und **G16** (Action-Mapping, Cursor-FSM, Fokusregeln). Messwerte lokal auf Apple M5 Pro (Node 24.18, Playwright
Chromium 153 / Firefox 155 / WebKit 26.6 headless) – kein Referenz-Laptop (DECISIONS 5).

Geändert wurden nur die eigenen Pfade: `packages/client/**`, `packages/blueprints/**`, `content/blueprints/**`,
`content/generated/**`, `tools/assets-pipeline/**` (plus dieses Fragment). `apps/game` brauchte **keine** Änderung:
es kompiliert und baut mit der neuen Client-API unverändert (die neuen Optionen sind optional).

## Umgesetzt

| Bereich | Inhalt | Ort |
|---|---|---|
| ClientMap | aus `.rtsmap`-Bytes/`RtsMap`; `heightfield` (= `rules.Heightfield`), `bounds`, `starts`, `spots`, Wasser; `heightAtRaw` = `rules.sampleHeightRaw` (bitgleich zur Sim per Konstruktion, Test gegen rules **und** den JS-Spiegel von render); `heightWU` = stetige Float64-Bilinearfläche derselben Samples (Kamera/Picking); `waterDepthRaw`, `isDeepWaterForLand`; `chunkMaxRaw`/`chunkMinRaw` je 32×32-WU-Chunk (exakt: Bilinear+floor verlässt nie [min, max] der Ecken); `toTerrainDesc()` (inkl. Licht, SPLT codec 0); `spotDecals()`; `startOf(army)`; `FlatTerrain` für die Testebene | `packages/client/src/map.ts` |
| G15 TerrainPicker | Strahl (render `screenToRay`) gegen die Terrainfläche: Clip auf Kartenrechteck + Höhenband, Chunk-DDA mit Überspringen über Chunk-Max-Höhen, Zell-DDA mit Schritten ≤ 0,5 WU (in einer Zelle ist f(t) exakt quadratisch ⇒ Extremum je Schritt geprüft, streifende Treffer gehen nicht verloren), Bisektion bis < 1/256 WU + Sekantenschritt. Ergebnis raw: x/z gerundet + geklemmt, **y = `sampleHeightRaw(x, z)`** (Sim-Höhe des Befehlsziels), dazu Float-Treffer in WU. Kein Treffer ⇒ Ebenen-Fallback (s. u.). Allokationsfrei | `packages/client/src/terrain-picker.ts` |
| C1 Kamera | `CameraController` neu: Fokus-y folgt dem Terrain (räumlich tiefpassgefiltert + zeitlich geglättet, τ = 150 ms), Pitch-Kurve, Zoom 6 WU … Gesamtkarte, Zoom zum Cursor mit 1D-Wurzel-Solve, Terrain-Clearance ≥ 2 WU (Pitch anheben, notfalls Auge heben), `camera.groundHeight` = Terrain unter dem Auge (dynamische Near-Plane), WASD/Pfeile + Edge-Pan (Tempo ∝ Distanz), Mittelklick-„Grab“ (gegriffener Terrainpunkt folgt dem Cursor), Strg+Mittelklick-Rotation (Yaw; vertikal Pitch-Offset ± 20°), `resetRotation`, `jumpTo`, `setTerrain`; stationärer Frame ohne Arbeit (allokationsfrei) | `packages/client/src/camera-controller.ts` |
| G16 ActionMap | Aktion → Liste `{code, ctrl/alt/shift/meta/primary, anyModifiers}`; `DEFAULT_ACTION_MAP` exportiert; Nachschlagen **nur über `code`**; Tap/Hold für Tasten mit Pan + Aktion (S) | `packages/client/src/actions.ts` |
| G16 CursorFsm | `idle, boxSelect, grabPan, rotate, edgePan, confinedEdgePan`; Tasten-Interaktionen haben Vorrang vor Edge-Pan; `cancel()` bei blur/pointercancel; CSS-Cursor je Zustand (allokationsfreie Tabelle) | `packages/client/src/cursor-fsm.ts` |
| C11 Fullscreen + Confinement | `FullscreenController` (`requestFullscreen` des Spiel-Roots, Toggle, Change-Events); `PointerConfinement`: im Fullscreen Pointer Lock beim ersten Druck (User-Geste), virtueller Cursor aus `movementX/Y`, in den Viewport geklemmt, DOM-Element `#faf-virtual-cursor` (position: fixed, im Fullscreen-Root), speist Picking/Box/Edge-Pan; Esc bzw. Verlassen des Fullscreens gibt frei, erneuter Klick sperrt wieder; ohne Pointer-Lock-API normales Edge-Pan | `packages/client/src/fullscreen.ts` |
| Eingabe | `InputController` auf ActionMap + CursorFsm umgebaut: neue Aktionen `grabStart`/`pan` (mit Cursorposition)/`grabEnd`, `rotate`, `jumpToCommander` (H), `resetCamera` (Pos1/Home), `toggleFullscreen` (Alt+Enter); Edge-Pan-Scan `updateEdge()` (8 px, nur Fenster fokussiert **und** Zeiger im Fenster bzw. eingefangen, aus bei blur/pointerout/Texteingabe); Kontextmenü, Mittelklick-Autoscroll (`mousedown` Taste 1) und `auxclick` unterdrückt; Canvas-Fokus bei `pointerdown`; Fokusregel wie MS1 | `packages/client/src/input.ts` |
| GameClient | `setMap(clientMap \| null)` → `renderer.setTerrain` + Spot-Decals + Kamera-Bounds/Terrain + TerrainPicker; `pickAt`, `heightAtRaw`, `jumpTo`, `jumpToCommander`, `toggleFullscreen`, `hover`; PartStream des Frames an `RenderView.parts`; Rechtsklick-Ziel, Klickmarker und Wegpunktlinie auf Terrainhöhe (Linie vom interpolierten 3D-Schwerpunkt); ohne Karte MS1-Verhalten | `packages/client/src/client.ts`, `frames.ts` (`parts()`, `partCount`) |
| Visual-Tabelle | `visualTableFromView(view, models)` → `VisualEntry` mit `meshes` (LODs aus der Pipeline) + `lodDistancesWU` (= `view.lod`), sonst Platzhalter; `commanderVisuals(simBpTable)` (Kategorie COMMAND) | `packages/client/src/visuals.ts` |
| P3 Asset-Worker | Modul-Worker `@faf/client/asset-worker`: Manifest (no-cache) → je Asset Cache API (`faf-assets-v1`, Schlüssel = absolute URL mit Hash, Treffer ⇒ kein Netz) sonst gestreamtes `fetch` + `put`; SHA-256 per `crypto.subtle` (JS-Fallback auf unsicheren Origins); Fortschritt je Chunk; GLB-Parser + meshopt-Decoder im Worker → `MeshData` je LOD (Transfer); Fallback `.raw.glb` bei fehlendem/scheiterndem Decoder oder `?assets=raw`; ohne Cache API normales fetch. Logik als reine Funktionen (`loadAssets(env, req, emit)`) | `packages/client/src/assets/{loader,env,glb,messages,sha256,worker}.ts` |
| P3 AssetManager | Main-Thread-Fassade: Worker (Transfer) oder In-Thread-Fallback ohne Worker **oder wenn der Worker scheitert** (`error`-Event, z. B. COEP-Blockade); `onProgress` (Bytes geladen/gesamt, Asset, Quelle, Assets fertig/gesamt); Ergebnis `files` (Karte, sim.bin, view.json) + `models` + `stats` | `packages/client/src/assets/manager.ts` |
| P3 Pipeline | `tools/assets-pipeline` ersetzt das Gerüst: prozedurales Quellmodell `units/cube_bot` (Rumpf+2 Ketten / Turm / Rohr als Parts, `_PARTID`, Part-Pivots/Parents in `extras.faf`, 3 LODs 108/78/36 Dreiecke), glTF via `@gltf-transform/core`; komprimiert: `quantize()` (POSITION int16/14 bit mit Knoten-Transform, NORMAL int8) + `EXT_meshopt_compression` (required, Methode quantize) → `cube_bot.<hash8>.glb` (8.388 B); Fallback float32 `cube_bot.<hash8>.raw.glb` (13.440 B); `content/maps/*.rtsmap` (mit `readRtsMap` validiert), `sim.bin`, `view.json` als gehashte Kopien; `manifest.json` kanonisch; Prüfung „jedes `view.mesh` hat ein Modell“; Scripts `build` / `check` | `tools/assets-pipeline/{src,scripts,test}` |
| Manifest-Vertrag | `{version: 1, assets: {<id>: {url, bytes, hash: 'sha256-<base64>', kind, fallback?}}}`, strenger Parser (unbekannte Schlüssel, Pfade mit `..`/Schema, Hash-Format), kanonische Serialisierung | `packages/blueprints/src/asset-manifest.ts` (`@faf/blueprints/asset-manifest`) |
| Blueprint-View | Schema `view.mesh?: string` (Asset-ID) und `view.lod?: [number, number]` (> 0, steigend; Compiler-Diagnose), `view.json`-Parser/-Ausgabe; `core:cube` nutzt `units/cube_bot` mit `lod [60, 180]`; `view.json`/`bundle.json`/`hashes.json` neu kompiliert (viewHash `0xF34D65D7`), **simHash `0xD4135AF1` und `sim.bin` bytegleich** (SHA-256 `e6be93f7…46ed`, Test pinnt beides) | `packages/blueprints/src/{schema,view,compiler,define}.ts`, `content/blueprints/core/units/cube.ts`, `content/generated/*` |

## Verträge / APIs für Folgepakete (ms2-p4-game, ms2-p5-spk4)

```ts
// Karte
const map = ClientMap.fromBytes(bytes);            // FormatError bei kaputter Datei
client.setMap(map);                                // Terrain+Wasser+Licht, Spot-Decals, Kamera, Picking; null = Testebene
map.heightAtRaw(x, z) === rules.sampleHeightRaw(map.heightfield, x, z)   // Frame-y-Vergleich, probeHeights-Hook
client.pickAt(cssX, cssY)  // {x, y, z (raw, y = Sim-Höhe), hit} | null – identisch zum Rechtsklick-Ziel
client.hover               // {x, y, z, valid, hit}: Terrainpunkt unter dem Cursor (HUD-Koordinaten)
client.jumpTo(xRaw, zRaw, distanceWU?); client.jumpToCommander();   // KeyH: COMMAND-Einheit, sonst eigener Start
client.cameraState()       // {x, y, z, distance, yaw, pitch, clearance}
client.cameraController.focusHeightWU(x, z)   // Ziel-Fokushöhe (tiefpassgefiltert)

// GameClientOptions (alle optional, neu)
{ map, actionMap, edgePan /* default true */, commanderVisuals /* commanderVisuals(bp) */,
  fullscreen: { root /* Spiel-Root-Element */, doc: document, confine?: boolean } }
client.toggleFullscreen(); client.fullscreen; client.confinement   // UI-Knopf; Alt+Enter ist gebunden

// Assets (Ladebildschirm, p4)
import AssetWorker from '@faf/client/asset-worker?worker';
const mgr = new AssetManager({ manifestUrl: '<assets>/manifest.json', createWorker: () => new AssetWorker() });
mgr.onProgress((p) => …);  // {id, url, source: 'cache'|'network', loaded, total, bytesLoaded, bytesTotal, done, assetsDone, assetsTotal}
const res = await mgr.load();          // res.files.get('maps/hollow-ridge' | 'content/sim.bin' | 'content/view.json').bytes
                                       // res.models.get('units/cube_bot').lods (MeshData[3]), res.stats {bytesNetwork, bytesCache, fromCache, …}
renderer.setVisuals(visualTableFromView(parseViewJson(viewText), res.models));
```

- **Logische Asset-IDs:** Modelle = `view.mesh` (`units/cube_bot`), Karten `maps/<name>`, `content/sim.bin`,
  `content/view.json`. URLs relativ zum Manifest (`models/units/cube_bot.<hash8>.glb`, `maps/hollow-ridge.<hash8>.rtsmap`,
  `content/sim.<hash8>.bin`, `content/view.<hash8>.json`), `hash8` = die ersten 8 Hex des **eigenen** SHA-256 jeder
  Datei (Fallback hat einen eigenen Hash). Nur `manifest.json` ist ungehasht (Einstieg, mit `no-cache` geladen). Für
  Vite/nginx (p4): `content/generated/assets/` unverändert ausliefern, `.rtsmap` = `application/octet-stream`,
  `.glb` = `model/gltf-binary`, gehashte Dateien immutable.
- **GLB-Layout** (Pipeline ↔ Parser): Szene `extras.faf = {id, lods, parts: [{name, parent, pivot}]}`, Knoten
  `lod0..2` mit `extras.faf.lod` und je einem Mesh (ein Dreiecks-Primitive: POSITION, NORMAL, `_PARTID` u8,
  Indizes u16). Pivots im Modellraum (nach Knoten-Transform). Konvention wie render `MeshData`: Ursprung
  Footprint-Mitte am Boden, +y oben, vorn = +x; Part 0 = Rumpf, Part k ≥ 1 liest PartStream `partBase + k − 1`.
- **Spot-Decals (M4):** Mass = Ring r 1,6 WU, Linie 0,35 WU, `0x40ff50`, α 0,95; Hydro = Ring r 2,6 WU, Linie
  0,45 WU, `0x20e0ff`, α 0,95 (Werte aus dem ms2-p1-Vorschlag übernommen, `MASS_SPOT_DECAL`/`HYDRO_SPOT_DECAL`).
- **Tastenbelegung (Standard, nur `code`):** WASD/Pfeile Pan, S tippen = Stop, Strg/⌘+A alle, P/Pause, N Schritt,
  `Backquote`/`IntlBackslash`/F1 Konsole, **H** zum Kommandanten/Start, **Pos1 (Home)** Kamera-Reset, **Alt+Enter**
  Vollbild; Maus: links Box/Klick, rechts Move, Mitte Grab, Strg+Mitte Rotation, Rad Zoom zum Cursor.
- **Canvas-Fokus:** `pointerdown` ruft `canvas.focus({preventScroll: true})` – das Canvas braucht dafür `tabindex`
  (apps/game, p4).

## Abweichungen vom Auftrag / Plan (mit Begründung)

1. **Fokushöhe tiefpassgefiltert.** „Ziel-y = Terrainhöhe am Fokus, geglättet“ ist räumlich **und** zeitlich
   umgesetzt: Ziel = gewichtetes 3×3-Mittel (1-2-1) der Terrainhöhe mit Abstand r = clamp(0,05·d, 0,5, 24) WU, darauf
   Exponentialglättung τ = 150 ms. Grund: Mit der reinen Punkthöhe springt der Fokus an Klippen (Mesa: 17 WU auf
   wenigen WU) – die Kamera „nickt“ beim Pannen, und der Zoom-zum-Cursor-Anker hatte dort keine stabile Lösung
   (Fixpunktiteration oszillierte zwischen Mesa und Tal, gemessen 4,2 WU Fehler).
2. **Zoom zum Cursor als 1D-Wurzel.** Statt den Fokus iterativ zu verschieben, wird das Auge auf dem Cursorstrahl
   durch den gegriffenen Terrainpunkt A platziert (Auge = A − r·L) und L so gelöst, dass der Fokus auf der
   Fokushöhenfläche liegt (Einschluss + Bisektion); Pitch-Änderungen durch die Clearance werden in ≤ 4 Durchläufen
   nachgeführt. Dieselbe Lösung nutzt das Mittelklick-Grab. Ergebnis: Fehler ≤ 7·10⁻⁸ WU, kein Nachdriften.
3. **Pitch-Kurve (gewählt):** `pitch(d) = 38° + 44° · smoothstep(t)`, `t = ln(d/6)/ln(dMax/6)`, `dMax =
   size/(2·tan(fov/2))·1,15` (512 WU: ≈ 711 WU). Die MS1-Startansicht (105 WU) hat damit ≈ 66° statt 55° – die
   SPK6-„Startansicht“ in E2E (p4) sieht also steiler auf die Einheiten.
4. **Picking gegen die stetige Bilinearfläche** (Float64) statt gegen die ganzzahlige Formel: Die Integer-Formel ist
   in 1/256-WU-Stufen konstant und für Marsch/Bisektion ungeeignet; die Abweichung beider ist < 1/256 WU·Steigung.
   Das zurückgegebene **y ist trotzdem die Sim-Höhe** am gerundeten Punkt. Die gerenderten CDLOD-Dreiecke weichen
   innerhalb einer Zelle um ≤ |h00 − h10 − h01 + h11|/4 von der Bilinearfläche ab (an Klippen sichtbar) – E2E-Picking
   (p4) sollte gegen die Bilinearfläche (`ClientMap.heightWU`) referenzieren, nicht gegen Pixel-Tiefen.
5. **Ebenen-Fallback ohne Treffer:** Strahl ∩ Ebene auf mittlerer Kartenhöhe → Punkt auf die Karte geklemmt →
   Strahl ∩ Ebene auf der Terrainhöhe dieses Randpunkts → auf die Karte geklemmt, y = Sim-Höhe; `hit = false`,
   `clamped = true`. Strahl am/über dem Horizont ⇒ kein Pick (wie MS1).
6. **Manifest-Schema in `@faf/blueprints`** (`@faf/blueprints/asset-manifest`) statt in `client` oder `formats`: Die
   Pipeline darf `client` nicht importieren (dep-cruiser „nobody-imports-client“), `formats` gehört ms2-p2; Blueprints
   referenzieren Assets ohnehin über `view.mesh`. Rein, ohne DOM/Node.
7. **Asset-Worker-Fallback erweitert:** Neben „kein Worker“ fällt der AssetManager auch dann in-thread zurück, wenn der
   Worker ein `error`-Event liefert. Beobachtet in WebKit gegen den Vite-Dev-Server: das Worker-Skript unter `/@fs/…`
   wurde gelegentlich per COEP blockiert (betrifft Dev, nicht den Build; für p4/Sim-Worker relevant).
8. **Integritätsprüfung:** Ein Cache-Treffer mit falschem Hash wird verworfen und einmal neu geladen (statt sofort
   Fehler), ein falscher Download ist ein Fehler (`AssetIntegrityError`). Ohne `crypto.subtle` (unsichere Origins)
   rechnet ein JS-SHA-256 (gegen `node:crypto` getestet).
9. **Konsolen-Taste nur noch über `code`** (`Backquote`, `IntlBackslash` – macOS-ISO-Tastaturen melden ^ so –, `F1`);
   die MS1-Erkennung über `key === '^'`/`` '`' `` entfällt (Vertrag „nie über key“).
10. **Move-Befehl trägt y = Terrainhöhe** des Ziels (MS1: 0). Die Sim wertet y für Landeinheiten nicht aus; der Wert
    ist nur semantisch korrekt (Luft später).
11. **Bewusst nicht in `apps/game` verdrahtet** (gehört ms2-p4 in Welle 2): Karte laden/`setMap`, Ladebildschirm,
    Fullscreen-Root, Canvas-`tabindex`, `?assets=raw`. Das Spiel verhält sich wie MS1 (Testebene, Platzhalter), mit
    den neuen Kameraeigenschaften (Pitch-Kurve, Edge-Pan, Rotation, H/Home/Alt+Enter ohne Fullscreen-Root wirkungslos).
12. Kleinkram: `GroundPicker.wuY`; `RendererLike.setTerrain?/setTerrainDecals?` optional; `FakeSimLink` kann
    PartStream-Einträge schreiben (`parts: true`, Test-Caps `parts` 4.096).

## Messwerte (lokal, Apple M5 Pro)

| Messung | Wert |
|---|---|
| G15: 10.000 Zufallsstrahlen auf hollow-ridge gegen Float64-Referenz (1/64-WU-Marsch + 40 Bisektionen) | 9.666 Treffer / 334 Fehlstrahlen, **max. \|Δxz\| 1,46·10⁻² WU, max. \|Δy\| 2,80·10⁻² WU** (Grenze 1/16) |
| G15: Zeit je Pick (Node) | p50 2,7–4,3 µs, **p95 8,7–16,7 µs** (über 3 Läufe; Ziel ≤ 0,2 ms) |
| C1: Zoom zum Cursor, 400 Radschritte an Zufallspositionen/-distanzen, inkl. 10 Glättungs-Frames danach | max. Fehler **7,3·10⁻⁸ WU** (Grenze 1/16) |
| C1: Clearance über 3.000 Zufallsansichten (Fokus, Distanz 6–206 WU, Rotation) | min. **2,027 WU** (≥ 2) |
| Client-Frame-Pfad (MS1-Allokationstest, 1.000 Würfel) | 0 GCs, < 256 B/rAF (Block-Messung ≈ 85–95 B/rAF, = MS1-Basis) |
| Pipeline `build` | 17–24 ms, 6 Dateien, 616.775 B; zweimal gebaut ⇒ bytegleich; `check` grün |
| `cube_bot` | meshopt-GLB 8.388 B vs. raw 13.440 B; Positionsabweichung < 10⁻⁴ WU, Normalen < 0,02 |
| Asset-Worker im Browser (Vite-Dev, eigener Port, 602.352 B) | kalt/warm (Cache API, **0 Netz-Bytes warm**): Chromium 25–37 / 2,5–2,8 ms, Firefox 68 / 8 ms, WebKit 40 / 3,4 ms; meshopt-Dekodierung im Worker in allen drei Engines, raw-Fallback und In-Thread-Pfad geprüft (temporäre Smoke-Seite, danach entfernt) |

## Tests

`pnpm vitest run packages/client packages/blueprints tools/assets-pipeline apps/game` – **22 Dateien, 162 Tests grün**.

| Datei | Inhalt |
|---|---|
| `packages/client/test/terrain-picker.test.ts` | 10.000 Strahlen vs. Float64-Referenz (≤ 1/16 WU, p50/p95 geloggt), y = Sim-Höhe, Rückprojektion auf den Cursor, Rand-Fallback, Horizont |
| `packages/client/test/camera-controller.test.ts` | Testebene: Pan/Edge-Pan ∝ Distanz, dt-Kappung, Clamp, Zoom zum Cursor + Grenzen 6 WU … Karte, Pitch-Kurve, Rotation/Reset; hollow-ridge: Zoom-Anker ≤ 1/16 WU (auch nach Glättung), Clearance ≥ 2 WU + `groundHeight`, Terrainfolge an der Klippe, Grab, `setTerrain` |
| `packages/client/test/map.test.ts` | Kartendaten, `heightAtRaw` == rules == render-JS-Spiegel (20.000 Punkte), Chunk-Min/Max, `toTerrainDesc`, Spot-Decals, Wasser, SPLT, kaputte Bytes |
| `packages/client/test/input-ms2.test.ts` | ActionMap DE/US (code `KeyZ`/key `y`), Modifier-Regeln; CursorFsm-Übergänge; neue Hotkeys; Autoscroll/Kontextmenü/Canvas-Fokus; Rotation; Edge-Pan-Regeln (Band, blur, pointerout, Texteingabe); Fullscreen + Pointer Lock mit Fakes (virtueller Cursor, Klemmung, Esc, Re-Lock, Rechtsklick am virtuellen Cursor, ohne API) |
| `packages/client/test/assets.test.ts` | GLB-Parser gegen die Pipeline-Ausgabe (meshopt == raw), Fehlerfälle; Loader mit Fakes: kalt/warm (0 Netz-Bytes), Integrität, ohne Cache API, drei Fallback-Arten; Worker-Handler; AssetManager Worker/In-Thread/Worker-Fehler; Browser-Env mit Fake-Globals (Streaming, Cache API, subtle, Decoder); JS-SHA-256/Base64; Visual-Tabelle |
| `packages/client/test/client-map.test.ts` | `setMap`, Rechtsklick-Ziel = Pick mit y = Terrainhöhe (Payload), Marker/Linie auf Terrain, Hover, KeyH (Start/COMMAND), PartStream an den Renderer, Edge-Pan nur mit Fokus + in Pause, Alt+Enter/Rotation/Home |
| `packages/client/test/types.test.ts` | + `HTMLElement` → `FullscreenRoot`, `Document` → `FullscreenDocument`, Canvas → `LockableCanvas`, `Worker` → `AssetWorkerLike` |
| `packages/blueprints/test/view-assets.test.ts` | `view.mesh`/`view.lod` nur im View (simHash/sim.bin unverändert), Validierung, **simHash `0xD4135AF1` + SHA-256 von sim.bin gepinnt**; Manifest-Serialisierung/Parser-Fehler |
| `tools/assets-pipeline/test/pipeline.test.ts` | Determinismus (2 Builds bytegleich), Manifest-Schema + Hashes/Größen/URLs, meshopt-GLB == raw (unabhängig per gltf-transform-Reader), Modell-LODs/Parts, eingecheckte Ausgabe aktuell, `check` erkennt fehlend/geändert/veraltet, unbekanntes `view.mesh` |

Selbsttest (2026-09-29, nacheinander): `pnpm typecheck` grün, `pnpm lint` grün (ESLint 0 Warnungen, dep-cruiser 0
Verstöße), Vitest s. o. grün, `pnpm --filter @faf/assets-pipeline build` + `check` grün, `pnpm --filter @faf/game
build` grün.

## Bekannte Grenzen / Hinweise für Folgepakete

- `content/generated/assets` hängt von `content/maps/*.rtsmap` und dem Blueprint-Compiler ab: Nach `pnpm maps` oder
  `pnpm --filter @faf/blueprints compile` muss `pnpm assets` laufen (`check` bzw. der Vitest-Frischetest schlagen sonst
  an). `pnpm build` (root) baut die Pipeline mit.
- Hover-Pick nur bei Zeiger-/Kamera-/Kartenänderung (render `screenToRay` allokiert über `Math.hypot`), daher kein
  Allokationsproblem im Stillstand; beim Bewegen der Maus entstehen kleine Boxen.
- Edge-Pan hängt an `document.hasFocus()` und Zeigerereignissen auf `window`: headless ohne Mausbewegung kein
  Edge-Pan; E2E kann `edgePan: false` setzen oder den Zeiger bewusst an den Rand bewegen.
- Rotation ist optional und ohne Kompass/Minimap-Bezug; das Kamera-Reset stellt nur Yaw und Pitch-Offset zurück.
- Keine Einheiten-Picks (Angriffsziel) – folgt mit C4/MS3; Selektion projiziert Einheiten mit ihrem Frame-y.
- Keine KTX2-Texturen, keine LOD-Generierung per Simplifier (P3-Rest in MS9); die Pipeline hat genau ein Modell.
- Echte Pointer-Lock-/Fullscreen-Prüfung im Browser (headless nur eingeschränkt) folgt in der E2E von ms2-p4.
