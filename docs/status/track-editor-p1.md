# TRACK-EDITOR · P1 – Gerüst apps/marker-editor, Root-Konfiguration, Terrain-Ansicht (three.js)

Stand: 2026-09-29 · Branch `track-editor` · Welle 0

## Umfang

- **Paket `@faf/marker-editor`** (`apps/marker-editor`, private, ESM, Vite 8). Einziger Install-Schritt des Tracks:
  - dependencies: `@faf/formats`, `@faf/fixed`, `@faf/rules`, `@faf/protocol` (workspace), `three ^0.186.1`, `preact ^10.29.8`, `@preact/signals ^2.11.2`
  - devDependencies: `@types/three ^0.186.0`, `@preact/preset-vite ^2.10.6`, `@babel/core ^7.29.7`, `vite ^8.3.1`, `@playwright/test ^1.63.0`, `@types/node ^24.19.0`, `tsx ^4.23.15`, `fast-check ^4.10.2`, `@faf/client` + `@faf/sim-host` (workspace, nur für Roundtrip-Tests), **`happy-dom ^20.0.0` (installiert: 20.14.5)** – ließ sich ohne minimumReleaseAge-Ausnahme installieren.
  - Alle übrigen Versionen stammen aus dem vorhandenen Lockfile; `pnpm install --frozen-lockfile` ist konsistent.
  - Scripts: `dev` (vite), `build` (vite build), `serve` (`vite preview --strictPort`, Port per `--port`). `bench` ergänzt P3.
- **Root-Konfiguration**
  - `tsconfig.json`: Referenz `apps/marker-editor`.
  - `tsconfig.tests.json`: zusätzlich `apps/*/test/**/*.tsx` und `apps/*/playwright.config.ts`.
  - `eslint.config.js`: `apps/*/playwright.config.ts` und `**/test/**/*.tsx` im Node-Block; `apps/*/test/**/*.tsx` zusätzlich mit Browser-Globals (happy-dom-Komponententests); `docs/design/**` ignoriert (siehe Abweichungen).
  - `.dependency-cruiser.cjs`: Regel `marker-editor-deps` (apps/marker-editor/src → nur formats, fixed, rules, protocol) und `marker-editor-npm-deps` (npm nur three, @types/three, preact, @preact/signals). Gegenprobe: ein Import von `@faf/sim-host`, `@faf/client` oder `fast-check` in `src/` wird gemeldet.
  - `package.json`: Scripts `editor` und `test:e2e:editor` (ci:local unverändert).
- **vite.config.ts**: root = App-Ordner, Dev-Port 5220 (strictPort false), Preview 5221, `fs.allow` = Repo-Root, Preact-Plugin, Plugin `faf-editor-maps`: `content/maps/*.rtsmap` unter `/maps/<name>.rtsmap` und `/maps/index.json` (`[{name, file, bytes}]`, nach Name sortiert) in dev **und** preview (immer der aktuelle Stand von `content/maps`), beim Build nach `dist/maps/` kopiert. Zusätzliche HTML-Einstiege `overlay-demo.html` (P4) und `ui-preview.html` (P6) werden automatisch mitgebaut, sobald die Dateien existieren.
- **playwright.config.ts** (App): testDir `test/e2e`, outputDir `../../test-results/marker-editor/artifacts`, JSON-Report `test-results/marker-editor/e2e.json`, workers 1, retries 0, forbidOnly, chromium/firefox/webkit mit denselben launchOptions wie das Root-Config (ANGLE Metal, Firefox `CFFIXED_USER_HOME`), ein einziger webServer `pnpm --filter @faf/marker-editor run serve --port <FAF_E2E_PORT|4783>`, `reuseExistingServer: false`, keine COOP/COEP.
- **Terrain-Ansicht `src/view/**`** (öffentliche API, Re-Export über `src/view/index.ts`):
  - `buildTerrainGeometry(map, maxVertsPerSide = 513)` → `{ positions, normals, colors, indices, step, vertsPerSide }`: rein, ohne DOM. Höhe = `heights[i]·heightScaleRaw/4096` WU (exakt in float32). Schritt = kleinste Zweierpotenz mit `sizeWu/step + 1 ≤ maxVertsPerSide` (512 WU → 1, Setons 1024 WU → 2). Normalen aus zentralen Differenzen der vollen Auflösung. Farbe: Auto-Schichtung nach Höhe/Neigung (Bänder wie der Spiel-Renderer: Ufer, Wiese, Fels ab Neigung 0,28, Hochland ab 72 % der Höhenspanne), darüber SPLT-Codec-0-Layer in Layer-Reihenfolge geblendet (Layer i = `strata[i]`, sonst Fallback-Palette `FALLBACK_LAYER_SRGB`); ohne Splat nehmen die Auto-Layer die ersten vier Strata. Farben linear (sRGB → linear), leichte Abdunkelung steiler Flächen (max. 18 %). Dreiecke CCW von +y.
  - `sunDirection(light)` = `(sin az·cos el, sin el, cos az·cos el)` (DECISIONS 19).
  - `class TerrainView` genau wie spezifiziert (`scene`, `camera`, `renderer`, `canvas`, `map`, `setMap`, `heightWuAt` über `rules.sampleHeightRaw`, `requestRender` rAF-gebündelt, `onBeforeRender` mit Abmeldefunktion, `setGridVisible`, `fitCamera`, `focus`, `resize` (plus ResizeObserver), `dispose`, `stats`, `rig`). Erweiterungen: `mapGroup` (Terrain/Wasser/Raster), `renderNow()` (synchron, für Messungen/Screenshots), `gridIsVisible`, Konstante `RENDER_ORDER` (terrain 0, grid 1, water 2, overlay ≥ 10) für P4.
  - Wasser: Ebene auf `waterLevelRaw/4096` (≤ 257 Vertices je Seite), RGBA-Vertexfarben nach Tiefe (flach hell/klar α 0,5 → tief dunkel α 0,88 ab 7 WU), Phong mit schwachem Glanzpunkt; die Uferlinie ergibt der Tiefentest gegen das Terrain.
  - 32-WU-Chunkraster als LineSegments über dem Terrain (Segmente à 2 WU, +0,12 WU, Terrain mit Polygon-Offset).
  - `class CameraRig`: Orbit um einen Bodenpunkt (Ziel-y = Terrainhöhe). Pan per rechter/mittlerer Maustaste (Boden folgt dem Cursor) und WASD/Pfeile (`KeyboardEvent.code`, nicht bei Strg/Cmd/Alt oder Fokus in Eingabefeldern), Zoom per Rad zum Cursor hin, Drehen per Alt+Linksziehen und Q/E. Linke Maustaste ohne Alt bleibt frei. `enabled`, `panBy(dxWu, dzWu)` (**Welt-Achsen x/z**), `zoomBy(factor, clientX?, clientY?)`, zusätzlich `rotateBy`, `pose()/setPose()`, `groundAt(clientX, clientY)`, `setBounds`, `dispose`. Yaw 0 = Blick von +z nach −z (Kartenzeile z = 0 oben, x nach rechts).
- **src/main.ts + index.html** (vorläufig, P5 ersetzt/erweitert): Struktur `<div id="app"><canvas id="terrain"></canvas><div id="ui"></div></div>` wie von P5/P6 vorausgesetzt; lädt `?map=<name>` (Default hollow-ridge), zeigt Name/Größe/Starts/Spots (`data-testid="map-label"`). Hook `window.__editorView` (Typ in `src/env.d.ts`): `ready`, `mapName`, `error`, `loadMs`, `stats()`, `load(name)`, zusätzlich `frame()` (ein Render abwarten) und `benchFrames(n)` (n synchrone Frames mit 1-Pixel-readPixels → Frame-Zeit inkl. GPU).

## Dateien

`apps/marker-editor/{package.json, tsconfig.json, vite.config.ts, index.html, playwright.config.ts}`, `src/{main.ts, env.d.ts}`, `src/view/{index,colors,geometry,light,water,grid,camera-rig,terrain-view}.ts`, `test/view/{geometry,light}.test.ts`, `test/e2e/view.spec.ts`, `test/e2e/support/{ports,editor,png}.ts`; Root: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `tsconfig.tests.json`, `eslint.config.js`, `.dependency-cruiser.cjs`.

## Tests

- **Vitest (Node, ohne WebGL)** – `pnpm vitest run apps/marker-editor`: 2 Dateien, **21 Tests** grün. Geometriegrößen 512 WU (513², Schritt 1) und Setons 1024 WU (513², Schritt 2), Höhen an je 1.000 Gitterpunkten aller 4 Karten `== sampleHeightRaw/4096` (bitgleich), Randverhalten, Normalen normiert/nach oben/gegen die Steigung, CCW-Dreiecke, Determinismus, Splat-Farben (voll bemalter Layer = Strata-Farbe, Fallback-Palette, Blend-Reihenfolge), Auto-Farbe nach Höhe, plausible Farben aller Karten, Wasser (Höhe, Alpha nach Tiefe), Raster, `sunDirection`-Konvention.
- **Playwright** – `FAF_E2E_PORT=4783 tools/heavy pnpm test:e2e:editor`: **18 Tests (6 × chromium/firefox/webkit) grün**, 14,8 s. Kartenindex + Auslieferung, alle 4 Karten laden, ≥ 3 gerenderte Frames (inkl. echtem Radzoom), > 500 k Dreiecke, ≥ 2 Draw Calls, Screenshot (`test-results/marker-editor/view-<karte>-<browser>.png`), Canvas nicht einfarbig (dominante Farbe < 60 %, > 200 Farben, Luma-σ > 8), keine Konsolenfehler; Kartenwechsel, Rechts-Drag-Pan + Q/E-Drehung verändern das Bild, fehlende Karte liefert sauberen Fehler.
- **Visuell geprüft** (Read-Tool, alle 4 Karten in chromium, Stichproben firefox/webkit): Terrain mit Plateaus/Rampen/Klippen klar erkennbar, Splat-Farben (Tessera, Braidwater, Setons) und Strata-Auto-Farben (Hollow Ridge), Wasser mit Tiefenverlauf und sauberer Uferlinie, Sonnenrichtung passt zu `azimuthDeg`, 32-WU-Raster sichtbar. Korrigiert wurde ein zu breiter Phong-Glanzpunkt, der große Wasserflächen weiß überstrahlte.
- Weitere Selbsttests: `npx tsc -p apps/marker-editor/tsconfig.json --noEmit`, `tools/heavy pnpm typecheck` (tsc -b + tests), `tools/heavy pnpm lint` (eslint + depcruise, 436 Module), `tools/heavy pnpm --filter @faf/marker-editor build` (JS 599 kB / 158 kB gzip, 120–220 ms), `pnpm install --frozen-lockfile` – alle grün.

## Messwerte (lokal gemessen, Apple M5 Pro, Playwright headless, 1280×720; kein iGPU-/GPU-Runner)

Ladezeit = fetch + readRtsMap + Geometrie + erster Frame; Frame-Zeit = `benchFrames(60)` (Render + 1-Pixel-readPixels, also inkl. GPU-Sync; Firefox/WebKit mit ~1-ms-Timerauflösung, WebKit mit DPR 2).

| Karte | Browser | Ladezeit ms | Frame Ø ms | p95 ms |
|---|---|---:|---:|---:|
| hollow-ridge | chromium / firefox / webkit | 70 / 55 / 56 | 4,1 / 4,5 / 4,6 | 7,9 / 9 / 11 |
| tessera | chromium / firefox / webkit | 77 / 93 / 61 | 1,9 / 5,7 / 6,0 | 6,6 / 16 / 11 |
| braidwater | chromium / firefox / webkit | 95 / 80 / 65 | 4,0 / 2,1 / 4,7 | 9,3 / 4 / 10 |
| **setons** | chromium / firefox / webkit | **92 / 93 / 73** | **3,8 / 2,9 / 1,0** | 9,4 / 6 / 2 |

Alle Karten: 655.360 Dreiecke (Terrain 524.288 + Wasser 131.072), 3 Draw Calls. Rohdaten: `test-results/marker-editor/view-*.json`.

## Abweichungen / Entscheidungen

- **three.js statt `packages/render`** für die Terrain-Ansicht (PLAN §3.2 erlaubt three.js in Tools; render wird parallel geändert). Die Farben sind eine vereinfachte, einfarbige Version der Auto-Splat-Logik des Spiels (keine prozeduralen Albedo-Texturen).
- **Rand x = sizeWu / z = sizeWu:** `sampleHeightRaw` klemmt auf `size·4096 − 16`, dort ist der Wert also nicht exakt `h·s`. Die Geometrie zeigt am Rand den echten Sample-Wert; der 1.000-Punkte-Test prüft Gitterpunkte mit x, z < sizeWu (bitgleich), der Rand wird separat getestet (Abweichung < 0,05 WU).
- **`.dependency-cruiser.cjs` `exclude`:** Vorher wurden alle `*.d.ts` ausgeschlossen. npm-Pakete, deren `exports` `types` zuerst nennen (z. B. fast-check), lösen auf ihre `.d.ts` auf und waren damit für npm-Regeln unsichtbar. Jetzt werden nur Workspace-Deklarationsdateien (`packages|apps|tools|content|test/**.d.ts`) ausgeschlossen; repo-weit weiterhin 0 Verstöße.
- **`eslint.config.js` ignoriert `docs/design/**`:** Die mit Commit 8f04d23 eingecheckten statischen UI-Mockups (Browser-Skripte ohne Modul-Setup) ließen `pnpm lint` auf der Basis 2fc956c mit 89 `no-undef`-Fehlern scheitern; das ist Doku, kein Projektcode.
- `panBy(dxWu, dzWu)` verschiebt in Welt-Achsen (nicht Bildschirm-Achsen); Tastatur-/Maus-Pan rechnet intern bildschirmrelativ.
- Hook `__editorView` um `error`, `frame()` und `benchFrames(n)` erweitert.

## Offene Punkte für Folgepakete

- **P4:** Overlays direkt in `view.scene` einhängen, nicht in `mapGroup` (dort verwaltet `setMap` Terrain/Wasser/Raster), `renderOrder ≥ RENDER_ORDER.overlay`, nach Änderungen `view.requestRender()`. Die Kamera ist nach jeder Rig-Änderung aktuell (`updateMatrixWorld`), `camera`/`canvas.getBoundingClientRect()` taugen direkt für Picking; `rig.groundAt` schneidet nur die Ebene auf Zielhöhe (kein Terrain-Picking).
- **P5:** `main.ts`/`index.html` ersetzen; `window.__editorView` für `view.spec.ts` erhalten (inkl. `frame`, `benchFrames`, `loadMs`). `rig.enabled = false` während Werkzeug-Drags, falls nötig; Alt+Linksziehen ist bereits Drehen.
- **P6:** happy-dom ist installiert. Achtung: Die Root-`vitest.config.ts` (nicht in P1-Besitz) nimmt nur `*/test/**/*.test.ts` auf – Komponententests also als `.test.ts` (Preact `h()`) schreiben oder P7 ergänzt `*.test.tsx` im Include. `tsconfig.tests.json` und ESLint kennen `apps/*/test/**/*.tsx` bereits.
- **P3:** Script `bench` in `apps/marker-editor/package.json` ergänzen (keine neuen Dependencies nötig; `tsx` ist vorhanden).
- **P7:** `ci:local` um `test:e2e:editor` erweitern entscheidet der Merge-Schritt.
