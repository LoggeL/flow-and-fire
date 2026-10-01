# rfx-p0-scaffold-core – Scaffold, Root-Konfiguration, render-fx-Core, Smoke-Harness

Track TRACK-RENDERFX (Vorarbeits-Track, Welle 0). Branch `track-renderfx`, Worktree `faf-renderfx`.

## Umgesetzt

- **Pakete**: `packages/render-fx` (`@faf/render-fx`, exports `./src/index.ts`, deps `@faf/render`, `@faf/fixed`,
  `@faf/protocol`, `gl-matrix ^3.4.4`; dev `@playwright/test`, `tsx`, `vite`, `@types/node` in den Versionen von
  tools/render-bench) und `apps/fx-lab` (`@faf/fx-lab`, nur `package.json`, `tsconfig.json`, `vite.config.ts` –
  `src/`, `index.html`, `scripts/`, `test/` legen rfx-p5/p6/p7 an). `pnpm install` lief offline, keine neuen
  Versionen im Lockfile (nur die zwei Importer-Einträge). `pnpm install --frozen-lockfile` sauber.
- **Barrel** `src/index.ts` re-exportiert core, effects, decals, post, light, particles, trails, shields.
  particles/trails/shields sind `export {};`-Barrels für rfx-p3/rfx-p4.
- **src/core** (öffentliche API, s. u.) mit 23 Node-Tests.
- **Smoke-Harness** `packages/render-fx/smoke` + `scripts/smoke.ts` und Fall `core`.

## Slot-Tabelle (`src/core/slots.ts`, verbindlich)

| Art | render (belegt) | frei für render/MS3 | render-fx |
|---|---|---|---|
| UBO-Slots | 0 Frame, 1 Palette, 2 Pass, 3 TerrainHeight | 4, 5 | 6 `SLOT_FX_VIEW`, 7 `SLOT_FX_SHADOW`, 8 `SLOT_FX_SCORCH` |
| Textur-Units | 0–7 | 8, 9 | 10 `UNIT_FX_SHADOW_STATIC`, 11 `UNIT_FX_SHADOW_DYNAMIC`, 12 `UNIT_FX_CURVE_LUT`, 13 `UNIT_FX_SCORCH_DATA`, 14 `UNIT_FX_SCORCH_CELLS` |

`FX_TIME_WRAP_S = 4096`. Alle Werte liegen unter den WebGL2-Mindestgrenzen (24 UBO-Bindings, 16 Units je Stufe);
der Test `test/core/slots.test.ts` prüft Kollisionsfreiheit gegen render's exportierte Konstanten.
Post-Passes sind eigenständige Fullscreen-Passes mit eigenen Units 0/1.

## Öffentliche API von src/core

- `FX_VIEW_BLOCK_GLSL` / `FX_VIEW_LAYOUT` (64 B: `u_fxRight`, `u_fxUp`, `u_fxFwd`, `u_fxTime` = (FX-Zeit mod 4096,
  dt, Pixel/WU in Distanz 1 = 0,5·viewportH/tan(fovY/2), Kameradistanz)). Test: JS-Layout = aus dem GLSL-Text
  geparstes std140-Layout.
- `FxBindings = { frame: BufH; fxView: BufH }`, Helfer `fxSharedBufferBindings(b)` → `[{slot 0, frame}, {slot 6, fxView}]`
  für die Bind-Group eines Passes.
- `FX_COMMON_GLSL` (nach FRAME_BLOCK_GLSL + FX_VIEW_BLOCK_GLSL einbinden): `fxRelPos(ivec3 posRaw)` (kamera-relativ,
  Integer-Differenz zuerst), `fxAge(t0)` (Alter mit Wrap), `fxBillboard(rel, corner, halfSize)`.
- `FxFrameUniforms(dev, { frameUbo?, writeFrame? })`: `frameUbo`, `fxViewUbo`, `bindings`, `frameData`/`viewData`
  (CPU-Kopien), `fxTime`, `pixelsPerWuAt1`, `update(camera, input)`, `destroy()`. `FxFrameInput = { timeS, dtS,
  alpha? (1), sunDir?, sunColor?, skyColor?, groundColor?, fog?, fogStart?, viewport: [w, h] }` – fehlende
  Lichtwerte = render-Defaults (`FX_DEFAULT_LIGHT`). Der Frame-Block wird **byte-identisch** zu
  `createRenderer().render()` geschrieben (Test instrumentiert den echten Renderer über FakeCanvas und vergleicht
  alle 208 Bytes). `update` ruft `camera.update()`; die CSS-Viewport-Größe der Kamera setzt der Aufrufer.
  Mit `{ frameUbo: <render-Puffer> }` wird nur der FxView-Block geschrieben (Integrationsmodus).
- `hideTimerQueryFromDevice(gl)` (VOR `createWebGL2Device` aufrufen; Accessor aktiviert die Extension nach Restore
  neu) und `GpuSpanTimer(gl, ext, segments, poolSize?)`: `beginFrame()`, `begin(i)`/`beginNamed(name)` (beendet das
  laufende Segment, nie verschachtelt), `endFrame()`, `poll(sink?)`, `latestMs`/`latestFrame`, `latestTotalMs()`,
  `available`, `skipped`, `disjoint`, `reset()` (bei Context-Loss/Restore), `dispose()`. `FX_SEGMENTS` =
  shadow, opaque, shields, particles, beams, post.
- `DynamicInstanceBuffer(dev, { label?, stride, capacity })`: Staging-`ArrayBuffer` mit Views f32/i32/u32/i16/u16/i8/u8,
  `upload(count)` = genau ein `writeBuffer` (wirft bei count > capacity – Aufrufer zählen `dropped` selbst),
  Restore lädt den zuletzt hochgeladenen Bereich aus Staging neu.
- `toHalf(f)`/`fromHalf(h)`/`HALF_MAX` (binary16, round-to-nearest-even direkt aus dem Double, ±Inf, Subnormals,
  NaN → 0x7e00). Tests: alle 65.536 Muster, Rundungsgrenzfälle, 200.000 Pseudozufallswerte gegen `Math.f16round`.
- `RAW_PER_WU`, `wuToRaw`, `rawToWu`; `FxPassStats`, `FxDrawStats`, `createFxPassStats`, `createFxDrawStats`,
  `resetFxDrawStats`, `addFxPassStats`.

## Test-Support

`test/support/fake-gl.ts` = Kopie von render's Fake (dep-cruiser verbietet relative Paket-Importe) plus Optionen
`colorBufferFloat` (EXT_color_buffer_float + EXT_float_blend → HDR-Pfad; Standard aus = LDR-Fallback),
`loseContext` (WEBGL_lose_context an `lose()`/`restore()`), `timerQuery`, `queryResults` (Map Query → ns),
`disjoint`.

## Smoke-Harness (Bedienung)

```
cd /Users/logge/Documents/Projects/faf-renderfx
/Users/logge/Documents/Projects/flow-and-fire/tools/heavy pnpm --filter @faf/render-fx run smoke -- --cases=core --browsers=chromium,firefox,webkit
# Root-Kurzform: tools/heavy pnpm smoke:fx -- --browsers=chromium   (ohne --cases = alle Fälle in smoke/cases)
# weitere Flags: --headed, --no-build
```

- Ein Fall = `smoke/cases/<name>.ts` mit `export const smokeCase: SmokeCase` (Interface in `smoke/case.ts`).
  `SmokeContext` wie im Vertrag (`dev`, `canvas`, `camera`, `frame`, `width`/`height` = 960×540, `readPixels`
  (Canvas-Koordinaten, Zeilen von oben), `project` (WU → Canvas-Pixel)) plus **Erweiterung `timer: GpuSpanTimer`**:
  Segment 0 `frame` umschließt jedes `frame()`; `SmokeCase.segments?` ergänzt eigene Segmente, die der Fall in
  `frame()` per `ctx.timer.beginNamed(...)` umschaltet (für die GPU-ms-Messungen von rfx-p2/p3/p4).
- Ablauf je Fall: laden → `frames` (Standard 30, dt 1/60, per rAF) → `check()` direkt nach dem letzten `frame()` →
  `dev.checkErrors()` → Canvas-Screenshot `test-results/render-fx-smoke/<case>-<browser>.png` →
  `loseAndRestore()` (debugLoseContext, ein Frame im verlorenen Zustand, Restore, ≥ 3 Frames, `check()` erneut) →
  `finish()` (destroy, GL-Fehler) → Bericht `test-results/render-fx-smoke.json` (Frames, Draws, JS-/GPU-ms p50,
  Renderer, Caps colorBufferFloat/timerQuery/loseContext). Exit 1 bei jedem Fehler (Page-Error, GL-/Shader-Konsole,
  Check, Context-Loss). Auslieferung über `page.route` unter `https://faf-render-fx-smoke.test` (kein Port),
  Browser nacheinander, Launch-Flags wie Root-`playwright.config.ts`.
- Kontext-Attribute: `antialias: false`, `preserveDrawingBuffer: true` (pixelgenaue Checks, Screenshots).
- Fall `core`: beleuchteter 512-WU-Schachbrettboden (Frame-Block) + drei Billboard-Marker (i32-Rohpositionen,
  DynamicInstanceBuffer, FxView-Achsen). Prüft Schwerpunkt = `project()` ±2 px, quadratisch (zeigt zur Kamera) und
  Kantenlänge = 2·half·`u_fxTime.z`/Blicktiefe ±2 px, Boden beleuchtet – auch nach Context-Restore.
  Screenshots in allen drei Browsern angesehen: identisch, Marker quadratisch auf dem Schachbrett.

## Root-Änderungen (für Merge-Konflikte mit anderen Tracks)

Alle additiv, Zeilen nur eingefügt:
- `package.json` scripts (nach `models:viewer`): `fx:lab`, `smoke:fx`, `bench:fx`, `test:e2e:fx`. `ci:local` unverändert.
- `tsconfig.json` references: `packages/render-fx` (nach `packages/render`), `apps/fx-lab` (nach `apps/model-viewer`).
- `tsconfig.tests.json` include: `packages/*/smoke/**/*.ts`, `apps/*/playwright.config.ts` (am Ende).
- `eslint.config.js`: Browser-Globals für `packages/render-fx/{src,smoke}/**/*.ts`; Ignore `docs/design/ui-mockups/**`
  – **identisch zur Zeile, die main inzwischen hat** (ohne sie war `pnpm lint` auf dem Branch-Stand 2fc956c rot).
- `.dependency-cruiser.cjs`: `render-fx-deps` (render, fixed, protocol), `render-fx-npm-deps` (nur gl-matrix),
  `render-never-imports-render-fx`, `fx-lab-deps` (render, render-fx, fixed, protocol);
  `presentation-never-imports-sim` erweitert auf `^(packages/(render|render-fx|client|ai)|apps/fx-lab)/`
  (einzige geänderte Zeile – bei Konflikt beide Erweiterungen vereinigen).
- `.gitignore`: `apps/fx-lab/results/*.json`.
- `pnpm-lock.yaml`: Importer `apps/fx-lab`, `packages/render-fx`.
- `vitest.config.ts`, `playwright.config.ts`, `pnpm-workspace.yaml`: unverändert.

## Abweichungen / Hinweise

- `FxFrameInput`: Lichtfelder optional mit render-Defaults und zusätzliches `fogStart?` (Standard wie render
  `max(250, Distanz·3)`) – Obermenge des Vertrags. `camMod.w` = `timeS mod 3600` wie render.
- `FxFrameUniforms` hat zweiten Parameter `FxFrameOptions` (`frameUbo`, `writeFrame`) statt nur `writeFrame`, weil
  render in der Integration den Frame-Puffer liefert.
- `SmokeContext.timer` / `SmokeCase.segments` sind Erweiterungen (s. o.).
- TypeScript-Projektreferenzen: `tsc -p packages/render-fx --noEmit` liest render's `.d.ts` aus
  `packages/render/dist/tsc`. Bei Fehler TS6305 einmal `tools/heavy pnpm exec tsc -b packages/render` (bzw.
  `packages/render-fx` für fx-lab) ausführen – Ausgabe ist git-ignoriert, render-Quellen bleiben unverändert.
- GLSL-Stolperfalle: Wer `FRAME_BLOCK_GLSL` im Fragment-Shader einbindet, braucht dort `precision highp int;`
  (sonst Link-Fehler „Precisions of uniform block member u_camPosInt differ“ in ANGLE).
- dep-cruiser: Temporäre Probe-Importe (`@faf/sim` aus render-fx/src, `@faf/client`/`@faf/rules` aus fx-lab/src)
  wurden von `render-fx-deps`, `presentation-never-imports-sim` und `fx-lab-deps` rot gemeldet (Probe wieder
  entfernt). Bekannte Lücke (wie bei `render-npm-deps`): npm-Pakete mit eigenen Typen lösen auf `.d.ts` auf, die
  die Config global ausschließt – `render-fx-npm-deps` greift daher nur für untypisierte Pakete.

## Messwerte (lokal gemessen, Apple M5 Pro)

Smoke `core` (2 Draws, 960×540): Chromium 153 (ANGLE Metal) GPU p50 0,18–0,30 ms/Frame, JS p50 0,03–0,06 ms;
Firefox 155 und WebKit 26.6 ohne Timer-Query (GPU n/a), JS p50 ≤ 0,06 ms. Context-Loss/Restore in allen drei
Browsern bestanden. `vitest run packages/render-fx/test/core`: 23 Tests, ~0,4 s.

## Abnahme

- `pnpm install --frozen-lockfile` ✔ · `pnpm exec tsc -p packages/render-fx --noEmit` ✔ · `tsc -b packages/render-fx` ✔
  · `tsc -p tsconfig.tests.json` ✔ · `vitest run packages/render-fx/test/core` 23/23 ✔ · `tools/heavy pnpm lint` ✔
  (eslint + dependency-cruiser, 454 Module) · Smoke `core` chromium/firefox/webkit ✔ ·
  `git diff --stat $(git merge-base HEAD main) -- packages/render tools/render-bench` leer ✔.

## Bekannte Grenzen

- `apps/fx-lab` hat bis rfx-p5 keine Quellen; `pnpm --filter @faf/fx-lab build` funktioniert erst mit `index.html`.
- GPU-Zeiten nur in Chromium (Firefox/WebKit exponieren EXT_disjoint_timer_query_webgl2 headless nicht).
- Der Smoke-Build bündelt alle Fälle in `smoke/cases`; ein Syntaxfehler in einem Fall bricht den Build für alle ab
  (Typfehler nicht – esbuild prüft keine Typen; `tsc -p packages/render-fx/smoke` prüft sie).
