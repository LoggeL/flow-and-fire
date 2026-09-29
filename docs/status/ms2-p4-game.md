# ms2-p4-game-e2e – Spiel-Integration (Ladebildschirm, Karte in Sim und Client, Presets, Kamera/Input) und E2E-Abnahme MS2

Stand 2026-09-29 (MS2, Welle 2). Feature-IDs (Spiel-Anteil): **M1/M2/M4** (Terrain, Wasser, Spots im Spiel), **M3**
(Karte über die Asset-Pipeline in Sim und Client, Export-Roundtrip), **C1** (FA-Kamera im Spiel), **C11/G16**
(ActionMap, Cursor-FSM, Fullscreen, Pointer-Confinement verdrahtet), **P2** (Kameraflug mit 2.000 Platzhaltern),
**P3** (Ladebildschirm, Asset-Worker, Cache API), **P10** (Context-Loss mit Terrain/Wasser/Decals), Preset-Infrastruktur
im Spiel. Messwerte lokal auf Apple M5 Pro (Darwin 27, Node 24.18, Playwright 1.63 headless: Chromium 153, Firefox 155,
WebKit 26.6) – **kein iGPU-/GPU-Runner, kein echtes Safari** (DECISIONS 5, s. u.).

Geändert wurden nur die owns: `apps/game/**`, `test/e2e/**`, `deploy/**`, `packages/client/src/index.ts`
(ein Re-Export, s. Abweichungen) und dieses Fragment. `packages/render` blieb unverändert.

## Umgesetzt

### `apps/game`

| Datei | Inhalt |
|---|---|
| `src/main.tsx` | Boot: Preact-Root sofort mit Ladebildschirm → `AssetManager` (`@faf/client/asset-worker?worker`, Manifest unter `<BASE>/assets/manifest.json`) → `Game` mit Karte → `ready` → erster gerenderter Frame → `data-ready="1"`. `<html data-loading-progress>` 0–100. Der Asset-Worker bleibt für die Sitzung am Leben (s. Abweichungen). Fehler ⇒ Ladebildschirm im Zustand `error` mit Grund. |
| `src/loading.ts` | `sessionAssetIds(manifest, map)` (sim.bin, view.json, `maps/<name>` – nicht bei `testplane` –, alle Modelle; unbekannte Karte ⇒ Fehler mit Liste), `loadSessionAssets` (Manifest, Laden mit Fortschritt, Ergebnis + `LoadTimings`), Fortschrittsmodell (0–90 % Asset-Bytes, 95 % Sim-Start, 100 % bereit, monoton). |
| `src/ui/LoadingScreen.tsx` | Fortschrittsbalken + %, Phase (Manifest/Assets/Sim/Fehler), aktuelles Asset mit Quelle („aus dem Cache“/„aus dem Netz“), Bytes geladen/gesamt, Assets fertig/gesamt, Zähler Cache/Netz. `data-testid="loading-screen"`, `data-phase`. |
| `src/game.ts` | Sitzung auf der Karte: `ClientMap.fromBytes` → `GameClient({map, commanderVisuals, fullscreen: {root: #game-root, doc}})`, Renderer mit `preset` (Render-Scale über das Backbuffer-Sizing des Renderers), Visual-Tabelle über `visualTableFromView` (glTF-LODs von `units/cube_bot` aus der Pipeline, sonst Platzhalter), `init.map` = transferierte **Kopie** der Kartenbytes, Kamera startet an der eigenen Startposition (105 WU, Terrain-Folge). Bei `ready`: Cheat-Spawn der Start-Armeen um die Karten-Starts (Army 0 eigene, Army 1 fremde) und – mit `?units=` – der Flugtest-Cluster. HUD-Zustand um Karte, mapSimHash, Cursor-Terrainkoordinaten, Preset, Vollbild. Konsole: `map`, `camera`, `preset`. Command-Tap (letztes Move-Ziel) für E2E. Host-`error` vor `ready` ⇒ `whenReady()` wird abgelehnt (Ladebildschirm zeigt den Grund). |
| `src/content.ts` | `startLayout(map, 0, 1)` (Karten-Starts, fehlender Gegnerstart = Punktspiegel, Testebene = MS1-Layout (256, 256)/(312, 214)), `discIsLand`, `flightClusters(map, n, armies, seed)` (Cluster à ≤ 32 Einheiten über ein gejittertes Gitter der ganzen Karte, nur Scheiben ohne Tiefwasser, abwechselnd beide Armeen, deterministisch), `visualsFromViewJson(text, models)`. |
| `src/params.ts` | + `?map=` (Standard `hollow-ridge`, `testplane` = flache MS1-Ebene), `?preset=low|medium|high|ultra` (Standard medium), `?units=N` (0..16.384; setzt `cubes`/`enemy` auf 0, sofern nicht explizit angegeben). `?assets=raw` liest der AssetManager selbst. |
| `src/console-commands.ts` | + `map` (Name, Größe, Höhenbereich, Wasserspiegel, Starts, Spots, mapSimHash/simId), `camera <x> <z> [dist]` (WU, Dezimalkomma erlaubt, auf die Karte begrenzt), `preset [name]`. |
| `src/hooks.ts` | `window.__faf` erweitert (s. Verträge). |
| `src/testing/reference.ts` | Test-Support der Hooks: `referencePick` (Float64-Marsch 1/64 WU + 40 Bisektionen gegen die Bilinearfläche), `probePoints` (xorshift32, jeder 64. Punkt bis 1 WU außerhalb der Karte). |
| `src/worker-link.ts` | `onCommandBatch`-Tap vor dem Transfer (E2E „Rechtsklick-Ziel == Pickpunkt“). |
| `src/ui/App.tsx`, `index.html` | HUD-Zeilen Karte/mapSimHash/Cursor (WU)/Preset, Vollbild-Knopf; `#game-root` (Fullscreen-Root mit Canvas + UI-Overlay, Elternelement des virtuellen Cursors), Ladebildschirm-Styles. |
| `vite.config.ts` | Plugin `faf-pipeline-assets`: im Dev `/assets/*` aus `content/generated/assets` (MIME `.rtsmap`/`.bin` octet-stream, `.glb` model/gltf-binary, `.json`; `no-cache`); **COOP/COEP/CORP auf jeder Dev-Antwort** (auch Vites eigene Module, s. Abweichungen); im Build Kopie nach `dist/b/<buildHash>/assets/` (Fehler, wenn `pnpm assets` fehlt). |
| `scripts/serve.mjs` | MIME `.rtsmap`, `.faflog` = `application/octet-stream` (Caching unverändert: `/b/<hash>/…` immutable). |

### `deploy/nginx.conf`

MIME-Tabelle um `rtsmap` (octet-stream) ergänzt (`glb` = `model/gltf-binary` war da), gzip zusätzlich für
`application/octet-stream` und `model/gltf-binary` (die `.rtsmap` ist das größte Asset; der Client zählt dekodierte
Bytes, Gesamtgrößen kommen aus dem Manifest). Assets liegen unter `/b/<hash>/assets/` und erben damit das immutable
Caching und COOP/COEP/CORP des `/b/`-Blocks.

### E2E (`test/e2e`, Root-Config: 4183 mit, 4184 ohne COOP/COEP (`FAF_E2E_PORT`, s. `test/e2e/support/ports.ts`); Chromium → Firefox → WebKit, 1 Worker)

| Spec | Server | Prüft (gegated) | Gemessen/Bericht |
|---|---|---|---|
| `map-load` (neu) | 4173 + 4174 | kalt: neuer **persistenter** Kontext auf frischem Profil, alle 4 Assets aus dem Netz (> 590 KB), Cache API vorhanden, Modelle per meshopt; Cache: zweite Navigation – alle Assets Cache-Treffer, **0 Netz-Bytes**, `bytesCache` == kalte Netz-Bytes; Ladebildschirm gesehen, Fortschritt monoton 0 → … → 100 mit Zwischenwerten (kalt mit Asset-Byte-Anteil), Phasen `assets`, `sim` | Wandzeit goto → `data-ready`, `navigationToReadyMs`, Asset-/Sim-Start-Zeit → `test-results/map-load-<browser>-<transport>.json`; ≤ 8 s / ≤ 3 s nur mit `FAF_PERF_GATE=1` |
| `terrain` (neu) | 4173 + 4174 | **CPU == GPU in 10.000 Stichproben** (immer), 1.024 Einheiten mit Frame-y == CPU-Höhe (cur **und** prev) in Ruhe und während 8 s Fahrt die Plateauklippe hinab (8 Prüfungen), ≥ 20 Würfel unter 23 WU; Startansicht nicht einfarbig, < 5 % Clear-Color (Terrain deckt), 1 Terrain- + 1 Wasser-Draw, 18 Decals; Tiefwasser (256, 256) wasserfarben (> 50 % der 21×21-Box); Mass-Ring (112, 244) grün und Hydro-Ring (200, 150) cyan (≥ 6/16 Ringpunkte) | `terrain-<browser>-<transport>.json` |
| `terrain` `?map=testplane` | 4173 | flache Ebene: keine Kartenassets geladen, kein Wasser-Draw, 0 Patches, Einheiten auf y = 0 | – |
| `picking` (neu) | 4173 | 4 Ansichten (Start, Mesa-Klippen, gedreht über dem Fluss, Übersicht) × 12×8 Punkte: **380 Vergleiche**, `pickAt` vs. Float64-Referenz ≤ 1/16 WU (xz und y); 5 echte Rechtsklicks: Move-Payload x/y/z raw == `pickAt` raw, Kamera unverändert | `picking-<browser>.json` |
| `camera` (neu, 4 Tests) | 4173 | Start an eigener Startposition (Terrain-Folge, Clearance ≥ 2 WU); WASD/Pfeile; KeyH; Hotkeys nur über `code` (DE-QWERTZ: `KeyZ`/'y', `KeyY`/'z', Konsole `Backquote`/'Dead'; US `Backquote`/'\`'; umgelegte `key`-Werte auf `KeyH`/`KeyP` wirken, 'h'/'p' auf fremden Codes nicht); Kamera in Pause (Tasten, Rad, H; Tick steht); Mittelklick-Grab (gegriffener Punkt bleibt unter dem Cursor ≤ 0,1 WU), Rad-Zoom zum Cursor (4 Schritte rein/raus ≤ 1/16 WU), Edge-Pan (Zeiger im 8-px-Rand), Strg+Mittelklick-Rotation + Home-Reset; Kontextmenü (echt + synthetisch), Mittelklick-`pointerdown`/`mousedown`/`auxclick` `defaultPrevented`; Vollbild per Alt+Enter auf `#game-root` (HUD sichtbar) und zurück; Pointer Lock im Vollbild mit virtuellem Cursor (Bewegung, Klemmung auf den Viewport, Freigabe) | `camera-{keys,mouse,fullscreen,pointerlock}-<browser>.json` |
| `map-roundtrip` (neu) | 4173 + 4174 | `mapc` (CLI, Heightmap + JSON-Marker, frisch in `beforeAll`) == eingecheckte `.rtsmap` (SHA-256); im Spiel `writeRtsMap(readRtsMap(geladene Bytes))` bytegleich (SHA-256, Länge); mapSimHash Node == Konstante `0x90ec94f0` == Sim-Worker (`ready`) == Seite == HUD; simId == `simIdFor(bpSimHash, mapSimHash)` aus Node, stabil über Reload; Testebene hat eigene simId (`simIdOf`) und keinen Export | `map-roundtrip-<browser>-<transport>.json` |
| `context-loss` (erweitert) | 4173 + 4174 | laufendes Spiel auf der Karte: Banner, Sim tickt ≥ 10 Ticks weiter, nach Restore 1 Terrain-/1 Wasser-Draw, Patches, 18 Decals, Einheiten, **GPU-Sonde == CPU (2.000 Punkte)**, Bild nicht einfarbig, < 5 % Clear-Color | Restore → erster neuer Frame (ms), ≤ 2 s nur mit `FAF_PERF_GATE=1` → `context-loss-<browser>-<transport>.json` |
| `context-loss` Determinismus (neu) | 4173 | `?autostart=0`: zwei Läufe bis Tick 60 (Move bei 20), einer mit Verlust von Tick 30 bis 45 (Steps während des Verlusts) – **Regel-Hash bei Tick 60 identisch** und Frame-Fingerprints Tick 1..60 identisch | `context-loss-determinism-<browser>.json` |
| `flight` (neu) | 4173 | `?units=2000&preset=medium`: 2.000 Einheiten (beide Armeen > 900), alle auf dem Terrain, Backbuffer = CSS × DPR × 0,8; 2 s Aufwärmen + **10-s-Flug** über 9 Wegpunkte: **Draws ≤ 50 in jedem Frame**, genau 1 Terrain- und 1 Wasser-Draw, Culling aktiv (> 1.000 gecullt), ≥ 2 LOD-Stufen in Gebrauch | FPS, Main-JS p50/p95, Render-JS, GPU-Zeit (Timer-Query) → `flight-<browser>.json`; FPS ≥ 50 / Main-JS p95 ≤ 5 ms nur mit `FAF_PERF_GATE=1` |
| `smoke` (erweitert) | 4173 + 4174 | + jede Datei des Asset-Manifests unter `/b/<hash>/assets/`: 200, MIME (`.rtsmap`/`.bin` octet-stream, `.json`, `.glb` model/gltf-binary), immutable, Größe == Manifest, CORP auf 4173 | – |
| `boot`, `move`, `pause`, `console`, `transports`, `latency` (umgestellt) | wie MS1 | laufen auf hollow-ridge: Armeen an den Karten-Starts; `boot` prüft zusätzlich Kartenname, mapSimHash und Frame-y == Terrain; `latency` gruppiert um den eigenen Start; `transports`-Ziel an Land (150, 190) | wie MS1 |

Zusatzwerkzeuge (keine Playwright-Specs): `test/e2e/scripts/dev-check.ts` (Dev-/Build-Check gegen eine laufende URL,
Chromium/Firefox/WebKit) und `test/e2e/safari/safari-check.ts` (echtes Safari über safaridriver/WebDriver).

### Selbsttest (2026-09-29, nacheinander)

| Befehl | Ergebnis |
|---|---|
| `pnpm typecheck` | grün |
| `pnpm lint` | grün (ESLint 0 Warnungen, dep-cruiser 0 Verstöße, 338 Module) |
| `pnpm vitest run apps/game packages/client packages/render` | 32 Dateien, **222 Tests** grün |
| `pnpm test:e2e` | **91 bestanden, 2 übersprungen** (Pointer Lock headless Chromium/WebKit, mit Begründung), 8,3 min |
| `pnpm dev` + `dev-check.ts` | Chromium, Firefox, WebKit grün; Server danach beendet |
| `safari-check.ts` | ⚠️ `unavailable` (Remote Automation nicht freigegeben) |

### Unit-Tests (`apps/game/test`, 7 Dateien, 42 Tests)

`content` (Visual-Tabelle mit/ohne Pipeline-Modell, `view.lod`, Startlayout Karte/Testebene/Spiegel, Start-Armeen auf
trockenem Land, Flugtest-Cluster: 2.000 Einheiten, ≤ 32 je Cluster, beide Armeen, jede Scheibe Land, alle 4 Quadranten,
deterministisch, Randfälle), `loading` (Asset-IDs je Karte, Testebene ohne Karte, unbekannte Karte, Fortschritt
0–90 % monoton, Quellen-Zähler), `reference` (Referenz-Pick == `TerrainPicker` ≤ 1/16 WU auf > 100 Kamerastrahlen,
Fehlstrahlen, Sondenpunkte deterministisch und mit Außenpunkten, Move-Dekodierung des Command-Taps),
`console-commands` (+ map/camera/preset), `params` (+ map/preset/units), `frame-hash`, `worker-link` (unverändert).

## Verträge / APIs für Folgepakete

```ts
// window.__faf (Alias window['__flow-and-fire']) – MS2-Erweiterungen
mapName; mapSimHash                          // aus ready
probeHeights(n, seed) → {n, mismatches, first, ms}     // renderer.probeTerrainHeights vs rules.sampleHeightRaw
unitHeights() → {units, mismatches, prevMismatches, maxAbsDiffRaw, first, tick}
pickAt(px, py) → {x, y, z (WU), raw: {x, y, z}, hit} | null    // == Rechtsklick-Ziel
pickReference(px, py) → {x, y, z} | null     // Float64-Referenz (1/64 WU + 40 Bisektionen)
project(x, y, z) → {x, y} | null; heightAt(x, z)          // WU ↔ CSS-px
camera() / cameraState(); setCamera(x, z, dist?); setYaw(yaw)
flight(path: {x, z, distance?}[], ms) → FlightReport       // Draws/Frame, Render-JS, GPU, Main-JS, FPS, Culling, LOD
exportMap() → {bytes, sha256, mapSimHash, workerMapSimHash, identical} | null
mapInfo() → {name, sizeWu, waterLevel, starts, spots} | null
loadTimings() → {navigationToReadyMs, assetsMs, simStartMs, fromCache, fromNetwork, bytesNetwork, bytesCache,
                 cacheApi, mode, sources, models}
lastMoveTarget() → {seq, units, x, y, z (raw)} | null
ruleHash() → {tick, hashTick, hash} | null
fullscreen() → {supported, active, pointerLockSupported, locked, lockRequests, lockErrors, virtualCursor}
renderStats() → + drawsByPass, unitInstances, culledInstances, lodInstances, terrainPatches, decals, gpuMs, preset,
                  backbuffer, css, devicePixelRatio
```

- **URL-Parameter:** `?map=<name>|testplane`, `?preset=low|medium|high|ultra`, `?units=N`, `?assets=raw` (neu) neben
  `?transport`, `?seed`, `?cubes`, `?enemy`, `?autostart` (MS1).
- **Hosting:** Assets unter `<base>/assets/` (Dev: `/assets/`, Build: `/b/<buildHash>/assets/`), Manifest
  `manifest.json` (einzige ungehashte Datei, vom Loader mit `no-cache` revalidiert). `pnpm build` (root) baut die
  Pipeline vor dem Spiel; `apps/game` allein braucht eine aktuelle `content/generated/assets` (`pnpm assets`).
- **Sitzungsidentität hollow-ridge** (`faf-sim/ms2.0`): mapSimHash `0x90ec94f0`, simId `0xb3668e44` (E2E rechnet sie
  in Node nach); Testebene `0xca103f02`.
- **Starts:** Army 0 = Spieler (96, 96), Army 1 (416, 416); Kamera startet am eigenen Start (105 WU).
- **E2E-Konstanten** in `test/e2e/support/game.ts` (`HOLLOW_RIDGE`, `PERF_GATE`, `writeReport`; `COI_SERVERS` seit dem
  MS2-Review entfernt – camera, picking und flight laufen gegen beide Server) und
  Pixelprüfungen in `test/e2e/support/terrain.ts` (DPR-bewusst, Kriterien wie `render smoke`).

## Messwerte (lokal, Apple M5 Pro, Playwright headless – kein iGPU-Runner, kein echtes Safari)

Alle Werte aus dem vollständigen Lauf `pnpm test:e2e` (2026-09-29, **91 bestanden, 2 übersprungen**, 8,3 min) bzw.
den Berichten `test-results/*.json` (git-ignoriert). Nicht gegatete ms-Werte (DECISIONS 16).

**Laden der 512-WU-Karte** (`map-load`; Wand = `goto` inkl. Root-Redirect bis `data-ready`, Nav = `performance.now()`
der Build-Seite bei `data-ready`; Assets 602.352 B = sim.bin, view.json, hollow-ridge.rtsmap, cube_bot.glb):

| Browser | Server | kalt Wand / Nav (ms) | davon Assets / Sim-Start (ms) | Cache Wand / Nav (ms) | Cache-Treffer / Netz-Bytes | Kriterium ≤ 8 s / ≤ 3 s |
|---|---|---|---|---|---|---|
| Chromium | 4173 | 1.757 / 1.692 (erster Test des Laufs, Browser-Kaltstart) | 87 / 125 | 153 / 93 | 4/4 / 0 | ✅ / ✅ |
| Chromium | 4174 | 322 / 287 | 113 / 42 | 161 / 126 | 4/4 / 0 | ✅ / ✅ |
| Firefox | 4173 | 528 / 337 | 36 / 169 | 183 / 162 | 4/4 / 0 | ✅ / ✅ |
| Firefox | 4174 | 341 / 226 | 47 / 34 | 166 / 149 | 4/4 / 0 | ✅ / ✅ |
| WebKit | 4173 | 506 / 241 | 66 / 52 | 164 / 138 | 4/4 / 0 | ✅ / ✅ |
| WebKit | 4174 | 233 / 153 | 43 / 28 | 193 / 148 | 4/4 / 0 | ✅ / ✅ |

Frühere Einzelläufe: kalt 186–530 ms, Cache 98–190 ms. Asset-Laden immer im Asset-Worker (`mode: worker`), Modelle
meshopt-dekodiert. Localhost ohne Netzlatenz – über echtes Netz dominiert die 593-KB-Karte (gzip in nginx).

**Kameraflug** (`flight`, `?units=2000&preset=medium`, 1280×720 CSS, 10 s, 9 Wegpunkte, 2.000 Einheiten beider Armeen):

| Browser | Frames / FPS | Draws je Frame max (min/Ø) | Main-JS p50 / p95 / p99 (ms) | Render-JS p50 / p95 (ms) | GPU p50 / p95 (ms) | sichtbar / gecullt (min–max) | Backbuffer |
|---|---|---|---|---|---|---|---|
| Chromium 153 | 595 / 59,4 | **4** (3 / 3,3) | 0,16 / 0,30 / 0,37 | 0,12 / 0,20 | 4,3 / 18,9 ¹ | 10–1.318 / 682–1.990 | 1024×576 (0,8) |
| Firefox 155 | 1.200 / 119,9 | **4** (3 / 3,3) | 0,18 / 0,34 / 0,58 | 0,14 / 0,26 | n/a | 11–1.321 / 679–1.989 | 1024×576 (0,8) |
| WebKit 26.6 | 601 / 60,1 | **4** (3 / 3,3) | 0,14 / 0,24 / 0,30 | 0,12 / 0,20 | n/a | 9–1.312 / 688–1.991 | 2048×1152 (DPR 2 × 0,8) |

Terrain-Patches 13–192 je Frame; LOD-Instanzen max. [0, 224, 1.318] (LOD 1/2, s. Grenzen). Budget ≤ 50 Draws mit
höchstens 4 Draws weit erfüllt; FPS = rAF-Takt der headless Engine. ¹ Timer-Query unter fremder GPU-Last (s. ⚠️);
der Einzellauf zuvor lag bei p50 7,3 / p95 15,8 ms, ms2-p1 maß ohne Fremdlast ≈ 0,7 ms p50.

**Terrain / Picking / Roundtrip / Context-Loss** (alle 3 Browser, beide Server wo zutreffend):

| Messung | Wert |
|---|---|
| CPU == GPU, 10.000 Stichproben | **0 Abweichungen** in allen 6 Kombinationen; Sonde inkl. Readback 3,9–19 ms |
| Frame-y == CPU-Höhe | 0 Abweichungen (cur und prev) in Ruhe und über 80 Ticks Fahrt; 55 Würfel verlassen das Plateau (> 1 WU tiefer) |
| Pixel | Tiefwasser (256, 256) rgb (36, 61, 68), Box 100 % wasserfarben; Mass-Ring 16/16, Hydro-Ring 16/16; Clear-Color 0 % |
| Picking | 380 Vergleiche je Browser; max. \|Δxz\| 1,7·10⁻⁴ WU, max. \|Δy\| 0,020 WU (Grenze 0,0625); 5/5 Rechtsklicks == Pick (raw) |
| Kamera | Grab-Fehler 0 (raw), Zoom-zum-Cursor 0 (raw, 4 Radschritte), Edge-Pan 19,6–21,9 WU in 0,5 s |
| Roundtrip | SHA-256 `fd3b31d7…91ec` (mapc == Datei == exportMap), mapSimHash `0x90ec94f0` (Node == Worker == Seite == HUD), simId `0xb3668e44` stabil (Testebene `0xca103f02`/`0x2f59dccf`) |
| Context-Loss | Restore → erster Frame **13–40 ms** (Grenze 2 s); 11–12 Ticks während des Verlusts; nach Restore Sonde 0 Abw., Bild ≥ 938 Farben |
| Determinismus Context-Loss | Regel-Hash Tick 60 `0x8f16dc4c` mit und ohne Verlust identisch, Frames 1..60 identisch – in allen 3 Browsern gleich |

**Latenz (SPK6, jetzt auf hollow-ridge, Informationswerte)**: seq-Ack p95 92–112 ms, erster bewegter Pixel Pipeline
(6 WU) p95 108–147 ms, Startansicht p95 225–263 ms, Main-JS p95 0,24–0,4 ms (4174: 1-ms-Uhr), Invarianten gegated
(Marker ≤ 1 rAF, `cmdApplyTicksMax = 1`).

**Dev-Check** (`pnpm dev` → http://localhost:5173/, danach beendet; `test/e2e/scripts/dev-check.ts`): Chromium, Firefox
und WebKit grün – COOP/COEP-Header, Hollow Ridge, 1.024 Würfel, Frame-y == CPU, 4.000 Sonden 0 Abweichungen,
Wasserpixel, Mass/Hydro-Ringe 16/16, keine Konsolenfehler; Nav → ready im Dev 0,24 s (Chromium) / 0,45 s (Firefox) /
1,37 s (WebKit).

## Abweichungen mit Begründung

1. **`packages/client/src/index.ts`**: zusätzlicher Re-Export `RENDER_PRESET_NAMES` aus `@faf/render` (Konsole
   `preset`; Apps importieren render nur über client, PLAN §3.2). Keine API-Änderung sonst; client/render-Tests
   unverändert grün.
2. **map-load mit persistentem Kontext** statt `browser.newContext()`: WebKits ephemere Sitzungen (Private Browsing)
   verwerfen den Cache Storage bei jeder Navigation – gemessen: nach der zweiten Navigation 0 Einträge, auch mit einer
   zweiten offenen Seite derselben Origin; im persistenten Profil 4/4 Treffer. „Neuer Kontext, leerer Cache“ ist damit
   ein frisches Profilverzeichnis je Test (entspricht dem Erstbesuch in einem normalen Browserfenster), in allen drei
   Engines gleich.
3. **Asset-Worker wird nach dem Laden nicht beendet**: In WebKit gingen die Cache-API-Schreibvorgänge verloren, wenn
   `mgr.dispose()` den Worker direkt nach `done` terminierte (die `put`-Promises sind dann erfüllt, die Einträge aber
   nicht festgeschrieben; nachgemessen: 0 statt 4 Einträge). Der Worker bleibt für die Sitzung (≈ 1 Worker, später für
   Nachladen/MS9 nutzbar) und wird erst beim Sitzungsende (HMR-Dispose) beendet.
4. **COOP/COEP/CORP auf jeder Dev-Antwort** (eigene Middleware vor Vites internen): `server.headers` erreicht Vites
   Module `/@vite/client` und `/@fs/…/vite/dist/client/env.mjs` nicht, die Modul-Worker importieren; WebKit blockierte
   deshalb Sim- und Asset-Worker unter COEP („Worker load was blocked by Cross-Origin-Embedder-Policy“) – das MS1-
   Spiel lief im Dev nur in Chromium/Firefox. Jetzt `pnpm dev` in allen drei Engines grün.
5. **`?units=` ersetzt die Start-Armeen** (cubes/enemy werden 0, sofern nicht explizit gesetzt), damit der Flugtest
   genau N Einheiten hat. Cluster à ≤ 32 Einheiten nur auf Scheiben ohne Tiefwasser (Sim verwirft Land-Spawns im
   Tiefwasser, ms2-p2) – so kommt die Zahl exakt an.
6. **Ladefortschritt**: 0–90 % Asset-Bytes, 95 % Sim-Start, 100 % nach dem **ersten gerenderten Frame** mit Karte
   (`data-ready` bedeutet „Terrain/Wasser/Spots sichtbar“, nicht nur „Worker bereit“). Das Manifest wird einmal im
   Main-Thread (Asset-Auswahl je Karte) und einmal vom Loader gelesen (je < 1 KB, revalidiert).
7. **Messung ≠ Gate (DECISIONS 16)**: Ladezeiten (≤ 8 s/≤ 3 s), Restore ≤ 2 s, FPS, Main-JS werden immer gemessen und
   berichtet, aber nur mit `FAF_PERF_GATE=1` gegated. Immer gegated sind maschinenunabhängige Kriterien: CPU == GPU,
   Frame-y == CPU, Pick-Genauigkeit, Draws ≤ 50, Cache-Treffer/0 Netz-Bytes, Roundtrip-Bytes, Hash-Gleichheit.
8. **Pixelprüfungen DPR-bewusst**: Playwrights „Desktop Safari“ läuft mit `devicePixelRatio` 2 – Projektionen (CSS-px)
   werden auf Screenshot-Pixel skaliert.
9. **Mittelklick-Autoscroll**: Der Client verhindert bereits `pointerdown` der Mitteltaste, Browser senden dann teils
   kein Kompatibilitäts-`mousedown`. Die E2E prüft deshalb `pointerdown` (echt), `mousedown`/`auxclick` (echt, falls
   vorhanden, und synthetisch) auf `defaultPrevented`.
10. **Port 4173 doppelt belegt**: Auf dem Rechner lauscht ein fremder `python3 -m http.server 4173 --bind 127.0.0.1`
    (Projekt „LMF“, seit 2026-09-28). `serve.mjs` bindet dual-stack und bekommt `::1`; Browser und Playwright lösen
    `localhost` zu `::1` auf – die E2E laufen korrekt, `curl http://127.0.0.1:4173` träfe aber den fremden Server. Der
    fremde Prozess wurde nicht angefasst.

## Bekannte Grenzen / ⚠️

- ⚠️ **Echtes Safari nicht geprüft**: `safaridriver` startet, die Session wird aber abgelehnt: „You must enable 'Allow
  remote automation' in the Developer section of Safari Settings to control Safari via WebDriver.“ Systemeinstellungen
  und `safaridriver --enable` (sudo) wurden bewusst nicht geändert. Nach Freigabe durch den Nutzer:
  `pnpm build && node --import tsx test/e2e/safari/safari-check.ts` (Bericht `test-results/safari-check.json`).
- ⚠️ **Kein iGPU-/GPU-Runner** (DECISIONS 5): FPS/GPU-Zeiten nur lokal (M5 Pro); die GPU-Timer-Query (nur Chromium)
  misst unter fremder GPU-Last Wartezeit mit (während der Läufe liefen andere GPU-Jobs – Werte als obere Schranke lesen).
- Pointer Lock wird im headless Chromium und WebKit nicht gewährt (Anfrage erfolgt, `pointerlockerror`) ⇒ der
  Pointer-Lock-Test ist dort **mit Begründung übersprungen**; in Firefox headless läuft er vollständig (Lock, virtueller
  Cursor, Klemmung, Freigabe). Vollbild per Alt+Enter läuft in allen drei Engines.
- ~~LOD 0 wird im Flug kaum erreicht; geprüft wird „≥ 2 Stufen in Gebrauch“.~~ Seit dem MS2-Review beginnt der Flug in
  20 WU über einem Einheiten-Cluster; gegated wird „alle 3 LODs gezeichnet“ (s. docs/STATUS.md, MS2).
- Die SPK6-Latenzwerte (Startansicht) sind mit MS2 nicht direkt mit MS1 vergleichbar: steilere Pitch-Kurve der neuen
  Kamera (ms2-p3) und Start auf dem Plateau.
- `deploy/nginx.conf`: nur die MIME-/gzip-Zeilen geändert; `nginx -t` in Docker wurde diesmal nicht wiederholt (Image
  `nginx:alpine` lokal nicht vorhanden, kein Pull). Die Auslieferung derselben Regeln prüft `serve.mjs` in `smoke`.
- `?map=` kennt nur Karten aus dem Manifest (MS2: `hollow-ridge`) plus `testplane`.
