# ms2-p5-spk4 – SPK4 Render-Last als Browser-Benchmark (MS2, Welle 2)

Spike SPK4 (PLAN §4) als echter, wiederholbarer Browser-Benchmark in `tools/render-bench` (ersetzt das Gerüst aus
ms2-p0): 2.000 mehrteilige Units mit 3 LODs, 30.000 Props, CSM mit 2 Kaskaden, Splatmap mit 8 Layern, HDR + Bloom –
gemessen in Chromium, Firefox und WebKit (Playwright headless) auf dem Entwicklungsrechner (**Apple M5 Pro, lokal
gemessen, kein Iris Xe / kein echtes Safari**, DECISIONS 5). Entscheidung: **DECISIONS 17**.
Geändert wurden nur `tools/render-bench/**`, `docs/DECISIONS.md` und dieses Fragment; `packages/render` nur lesend.

## Umgesetzt

| Datei | Inhalt |
|---|---|
| `page/index.html`, `src/main.ts` | Benchmark-Seite: lädt `content/maps/hollow-ridge.rtsmap` (Vite-Asset, `@faf/formats`), baut die Szene einmal und bietet `window.__spk4.run({scenario, warmupS, measureS})`. Pro Lauf frische Canvas (CSS 1920×1080, DPR 1, Backbuffer **1536×864** = Render-Scale 0,8), Aufwärmflug + Messflug im rAF-Takt; synthetische Sim-Ticks (10 Hz) **außerhalb** der Messung. Pro Frame: Draws (gesamt + je Pass), Main-JS (`performance.now` um `render()` = CPU-Culling/LOD/Sortierung/Uploads + WebGL-Submission), GPU-Zeit, rAF-Intervall, sichtbare Units/Props/Impostor/Patches, Schatten-Caster. Handbetrieb: `dist/index.html?scenario=full`. |
| `src/scene.ts` | Deterministische Szene (seeded xorshift, gleiche Kartenbytes ⇒ bitgleiche Szene): Terrain aus hollow-ridge + **synthetische 8-Layer-Splatmap** (2 RGBA8-Ebenen 512², aus Höhe, Neigung, Value-Noise); **2.000 Units** (12 Varianten, zwei Basen + Front, auf dem Terrain über `rules.sampleHeightRaw`), 10-Hz-Kreisbewegung + **PartStream** (Turm-Gier, Rohr-Nicken, 2 Parts/Unit); **30.000 Props** (Wälder, Felsfelder, Büsche auf trockenem, nicht zu steilem Land); Spot-Decals (Konstanten wie `ClientMap`); **10-s-Kameraflug** (Basis nah 42 WU → Front → Übersicht 260 WU → andere Basis → Front, eine schnelle Drehung, Sonne seitlich). |
| `src/meshes.ts` | 12 Merged-Part-Varianten aus **3 Part-Meshes (Rumpf-Box, Turm-Zylinder, Rohr-Box, Rohr hängt am Turm)** über `combineParts`, je **3 LODs** (Platzhalter-LODs 16/8/4 Segmente); 3 Prop-Meshes (Baum, Fels, Busch) × **2 LODs** mit Vertexfarben. |
| `src/bench-renderer.ts` | `FacadeBench` (ms2: die echte Fassade `createRenderer` wie im Client) und `PrototypeBench` (full/fallback): eigener Frame-/Palette-UBO, `TerrainHeightResources`, **echter `UnitPass`** (Merged-Part, Instanz-Culling, 3 LODs, ein Draw pro (Visual, LOD)), echter `WaterPass`, plus Prototyp-Passes. Reihenfolge: Schatten statisch (nur bei Cache-Refresh) → Schatten Units → Szene (Terrain, Props, Units, Blob, Impostor, Wasser) in RGBA16F → Bloom → Composite → FXAA. |
| `src/proto/terrain.ts` | Terrain-Variante mit CSM-Empfang, zusammengesetzt aus `TERRAIN_HEIGHT_GLSL` (bitgleiche Höhen), `TERRAIN_SPLAT_GLSL` (Auto-Splat + 4/8 gemalte Layer), `SHADOW_RECEIVE_GLSL` und den Spot-Decals (`DecalBinner`); CDLOD eine Stufe, ein instanzierter Draw, Quadtree-Patch-Culling (`PatchCuller`). |
| `src/proto/props.ts`, `src/prop-grid.ts` | Instanzierter **PropPass**: ein Draw pro (Mesh, LOD) (≤ 6), Culling/LOD **pro 32-WU-Chunk** nur bei Kamerawechsel, Counting-Sort vorsortierter Chunk-Bereiche (Kopien statt Arbeit pro Prop, allokationsfrei), 3-Regionen-Ring; 16-B-Instanz (i32×3, Gier, Skala, Mesh/Tönung). |
| `src/proto/shadows.ts`, `src/proto/shadow-glsl.ts` | **CSM mit 2 Kaskaden** (je 2048², DEPTH24 als 2D-Array mit Compare): Kaskaden aus Sichttiefen-Scheiben (λ 0,55, Schattendistanz folgt dem Zoom), **gecachte Lichtbox je Kaskade** – statische Ebene (Terrain + Props LOD 1) wird nur neu gezeichnet, wenn die benötigte Kugel die Box verlässt oder sich die Größe deutlich ändert; dynamische Ebene (Units) **jeden Frame mit reduziertem LOD** (Kamera-LOD + 1), Unit-Culling gegen die Kaskade nur bei neuem Unit-Frame/Refresh. Caster ganzzahlig relativ zum Kaskaden-Anker, Empfänger mit Matrix aus kamerarelativem Raum; Empfang mit Hardware-PCF (4 Taps) über `min(statisch, dynamisch)`. |
| `src/proto/post.ts` | Szene in **RGBA16F** (LDR-Fallback RGBA8 ohne `EXT_color_buffer_float`, dann ohne ACES), **Dual-Kawase-Bloom** (5 Down, 4 Up, weiche Schwelle), Composite mit **ACES** (Narkowicz) + Belichtung, **FXAA** (3.11-artig) in die Canvas. |
| `src/proto/blob.ts` | **Blob-Schatten**: ein instanzierter Draw für alle Units, 4×4-Gitter je Unit, Vertexhöhen über `TERRAIN_HEIGHT_GLSL` (schmiegt sich an Hänge), Interpolation prev→cur wie der UnitPass. |
| `src/proto/impostor.ts` | **Impostor-Ring**: Props ab Distanz X (fallback: 110 WU × LOD-Bias) als zylindrische Billboards, **ein Draw für alle Meshes**; Atlas wird beim Start (und nach Context-Restore) aus den LOD-0-Meshes gerendert (Ortho-Seitenansicht, Mips). |
| `src/gpu-timer.ts` | GPU-Zeit je Frame und Abschnitt (Uploads+Schatten / Szene / Post) über `EXT_disjoint_timer_query_webgl2`, Ergebnisse asynchron nach Frame-Index, disjunkte verworfen. |
| `src/scenarios.ts`, `src/budget.ts`, `src/stats.ts`, `src/report.ts` | Szenario-Konfigurationen, Draw-Budget-Rechnung, Perzentile (nearest rank) / Zusammenfassungen / Formatierung, Berichtstypen. |
| `scripts/spk4.ts`, `vite.config.ts` | Script `spk4` (+ `build:bench`): Vite-Build nach `dist/`, dann **Chromium → Firefox → WebKit nacheinander** (Flags wie `playwright.config.ts`, Firefox mit `CFFIXED_USER_HOME`), Seite per **`page.route` unter `https://faf-render-bench.test`** mit COOP/COEP/CORP (kein Port), je Szenario frische Seite + Screenshot (`test-results/spk4/`). Bericht `results/spk4-<datum-uhrzeit>[-quick].json` (git-ignoriert), `--update-docs` schreibt die Tabellen unten. Erkennt Fremdlast (MLX-Jobs, parallele Playwright-/Vitest-Läufe), wartet im Volllauf bis zu 240 s darauf und wiederholt belastete Szenarien (max. 3 Versuche); Last steht im Bericht. Exit 1 nur bei Fehlern (Shader/GL/Konsole/Seite, Draw-Budget), nie wegen ms-Werten. |

Szenarien (alle Viewport 1920×1080, DPR 1, Backbuffer 1536×864):

| Szenario | Inhalt |
|---|---|
| `full` | Medium (LOD-Bias 0,8, Wasser medium) mit **8 Splat-Layern, CSM 2×2048, HDR RGBA16F, Bloom, ACES, FXAA**, 2.000 Units (12 Visuals × 3 LODs, PartStream), 30.000 Props (Mesh-LOD 1 ab 60 WU × Bias) |
| `fallback` | Plan-Fallback: **ohne CSM (Blob-Schatten), 4 Splat-Layer, Impostor-Ring ab 110 WU × Bias**; HDR/Bloom/FXAA bleiben |
| `ms2` | MS2-Abnahmeflug mit der **echten Fassade** (`createRenderer`, Preset medium): Terrain + Wasser + Spot-Decals + 2.000 Platzhalter-Units, keine Extras, Draw-Gate 50 |

## Tests

`pnpm vitest run tools/render-bench` – 3 Dateien, **21 Tests** (Node, ohne GPU):

| Datei | Inhalt |
|---|---|
| `test/scene.test.ts` | Zählwerte (**2.000 Units, 30.000 Props, 8 Layer**, 2 Splat-Ebenen, 12 Visuals × **3 LODs** mit je 3 Parts und fallender Indexzahl, Rohr-Parent = Turm, 3 Prop-Meshes × 2 LODs), **Determinismus** (zweimal gebaut ⇒ gleicher FNV-Hash über Records, PartStream, Props, Splat), Units stehen exakt auf `rules.sampleHeightRaw` (auch nach Ticks), Props auf trockenem Land, Flug stetig mit Nah- (< 50 WU) und Übersichtsphase (> 200 WU). |
| `test/stats-budget.test.ts` | Nearest-Rank-Perzentile, NaN-Behandlung, Sample-Puffer mit späten GPU-Ergebnissen, Formatierung; **Draw-Budget**: full 103 (Refresh-Frame 111), fallback 57, ms2 40 – alle unter 250 bzw. 50; Skalierung mit der Visual-Zahl (40 Visuals ⇒ > 250 mit CSM). |
| `test/culling.test.ts` | PropGrid: ganze Karte ⇒ genau 30.000, Buckets konsistent; **kein sichtbares Prop fehlt**, keine Duplikate (3 Kameras); LOD-Klassen nah/Impostor. CSM: Caster- und Empfängermatrix treffen denselben Texel/dieselbe Tiefe, Cache (kleine Bewegung kein Refresh, Sprung/Zoom schon), sichtbare Terrainpunkte der Nah-Scheibe liegen in Kaskade 0; Schatten-Unit-Culler (Buckets (Visual, LOD 1/2) vollständig). |

## Messwerte (automatisch, `spk4 --update-docs`)

<!-- spk4:results:begin -->
Wertebereiche über 2 Volllauf/Volläufe (2026-09-29 … 2026-09-29); GPU-Werte nur aus Läufen ohne Fremdlast:

| Browser | Szenario | Läufe (ohne Fremdlast) | Draws max | Main-JS p95 (WebKit: Ø) | GPU p50 | GPU p95 | FPS | Frame-Intervall p95 |
|---|---|---|---|---|---|---|---|---|
| chromium | ms2 | 2 (1) | 25 | 0,25–0,35 ms | 0,77 ms | 2,15 ms | 60,0 | 16,7 ms |
| chromium | full | 2 (2) | 94 | 0,62–0,72 ms | 4,84–5,39 ms | 7,83–8,72 ms | 60,0 | 16,7 ms |
| chromium | fallback | 2 (2) | 44 | 0,39–0,53 ms | 1,99–2,34 ms | 4,16–4,61 ms | 60,0 | 16,7 ms |
| firefox | ms2 | 2 (2) | 25 | 0,48–0,50 ms | n/a | n/a | 120,0 | 9,0–9,1 ms |
| firefox | full | 2 (2) | 94 | 1,04–1,06 ms | n/a | n/a | 120,0 | 9,0–9,2 ms |
| firefox | fallback | 2 (2) | 44 | 0,62–0,70 ms | n/a | n/a | 120,0 | 9,1–9,2 ms |
| webkit | ms2 | 2 (2) | 25 | 0,25–0,29 ms | n/a | n/a | 60,0 | 17,0–18,0 ms |
| webkit | full | 2 (2) | 94 | 0,37–0,38 ms | n/a | n/a | 60,0 | 18,0 ms |
| webkit | fallback | 2 (2) | 44 | 0,34–0,38 ms | n/a | n/a | 60,0 | 17,0–18,0 ms |

Letzter Lauf im Detail:

Lauf 2026-09-29T11:21:26.297Z (voll), lokal gemessen (Apple M5 Pro, Playwright headless), kein Iris Xe/echtes Safari; Viewport 1920×1080, DPR 1, Backbuffer 1536×864 (Render-Scale 0,8).
Last: loadavg vorher 4,7/5,4/5,6, nachher 5,2/5,7/5,7; parallel: nichts Auffälliges.

| Browser | Szenario | Frames / FPS | Draws p50 / max (Grenze) | Main-JS p50 / p95 / p99 | GPU p50 / p95 / p99 | Frame-Intervall p95 | Units sichtbar p50 | Props (Mesh/Impostor) p50 | Schatten-Refresh | Fremdlast | Draws | JS ≤ 5 | GPU ≤ 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| chromium 153.0.8010.12 | ms2 | 600 / 60,0 | 20 / 25 (50) | 0,18 / 0,35 / 0,47 ms | 0,77 / 2,15 / 3,22 ms | 16,7 ms | 347 | 0 / 0 | 0 | keine | ✅ | ✅ | ✅ |
| chromium 153.0.8010.12 | full | 600 / 60,0 | 61 / 94 (250) | 0,32 / 0,62 / 1,02 ms | 4,84 / 7,83 / 10,35 ms | 16,7 ms | 347 | 3939 / 0 | 27 | keine | ✅ | ✅ | ✅ |
| chromium 153.0.8010.12 | fallback | 600 / 60,0 | 36 / 44 (250) | 0,23 / 0,53 / 0,66 ms | 2,34 / 4,16 / 5,94 ms | 16,7 ms | 347 | 1108 / 2485 | 0 | keine | ✅ | ✅ | ✅ |
| firefox 155.0 | ms2 | 1199 / 120,0 | 20 / 25 (50) | 0,26 / 0,50 / 0,72 ms | n/a | 9,0 ms | 347 | 0 / 0 | 0 | keine | ✅ | ✅ | n/a |
| firefox 155.0 | full | 1200 / 120,0 | 61 / 94 (250) | 0,42 / 1,04 / 1,58 ms | n/a | 9,0 ms | 348 | 3939 / 0 | 27 | keine | ✅ | ✅ | n/a |
| firefox 155.0 | fallback | 1200 / 120,0 | 36 / 44 (250) | 0,34 / 0,70 / 1,02 ms | n/a | 9,1 ms | 346 | 1108 / 2478 | 0 | keine | ✅ | ✅ | n/a |
| webkit 26.6 | ms2 | 600 / 60,0 | 20 / 25 (50) | Ø 0,29 ms (Takt 1,0 ms, p95 1,00) | n/a | 17,0 ms | 346 | 0 / 0 | 0 | keine | ✅ | ✅ | n/a |
| webkit 26.6 | full | 600 / 60,0 | 61 / 94 (250) | Ø 0,37 ms (Takt 1,0 ms, p95 1,00) | n/a | 18,0 ms | 346 | 3939 / 0 | 27 | keine | ✅ | ✅ | n/a |
| webkit 26.6 | fallback | 600 / 60,0 | 36 / 44 (250) | Ø 0,38 ms (Takt 1,0 ms, p95 1,00) | n/a | 17,0 ms | 346 | 1108 / 2478 | 0 | keine | ✅ | ✅ | n/a |

Draws je Pass (Maximum im Flug):

| Browser | Szenario | Schatten statisch | Schatten Units | Terrain | Props | Units | Blob | Impostor | Wasser | Post | Overlay |
|---|---|---|---|---|---|---|---|---|---|---|---|
| chromium | ms2 | 0 | 0 | 1 | 0 | 23 | 0 | 0 | 1 | 0 | 0 |
| chromium | full | 4 | 48 | 1 | 6 | 23 | 0 | 0 | 1 | 11 | 0 |
| chromium | fallback | 0 | 0 | 1 | 6 | 23 | 1 | 1 | 1 | 11 | 0 |
| firefox | ms2 | 0 | 0 | 1 | 0 | 23 | 0 | 0 | 1 | 0 | 0 |
| firefox | full | 4 | 48 | 1 | 6 | 23 | 0 | 0 | 1 | 11 | 0 |
| firefox | fallback | 0 | 0 | 1 | 6 | 23 | 1 | 1 | 1 | 11 | 0 |
| webkit | ms2 | 0 | 0 | 1 | 0 | 23 | 0 | 0 | 1 | 0 | 0 |
| webkit | full | 4 | 48 | 1 | 6 | 23 | 0 | 0 | 1 | 11 | 0 |
| webkit | fallback | 0 | 0 | 1 | 6 | 23 | 1 | 1 | 1 | 11 | 0 |

GPU-Zeit je Abschnitt (Timer-Query, p50 / p95):

| Browser | Szenario | Uploads + Schatten | Szene (Terrain, Props, Units, Wasser …) | Post (Bloom, ACES, FXAA) |
|---|---|---|---|---|
| chromium | full | 0,39 / 1,06 ms | 2,05 / 3,66 ms | 2,36 / 3,30 ms |
| chromium | fallback | 0,00 / 0,02 ms | 1,02 / 2,18 ms | 1,27 / 2,00 ms |

GPU/Treiber: chromium: ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version) (Timer-Query ja, EXT_color_buffer_float ja, COI ja); firefox: Apple M1, or similar (Timer-Query nein, EXT_color_buffer_float ja, COI ja); webkit: Apple GPU (Timer-Query nein, EXT_color_buffer_float ja, COI ja).

Browser-Hinweise (Warnungen, keine Fehler):

- firefox: full: [JavaScript Warning: "WebGL warning: drawElementsInstanced: Depth texture comparison requests (e.g. `LINEAR`) Filtering, but behavior is implementation-defined, and so on some systems will sometimes behave as `NEAREST`. (warns once)"]
<!-- spk4:results:end -->


## Bewertung (Kurzfassung, Entscheidung: DECISIONS 17)

- **Exit lokal erfüllt** in allen Szenarien und Browsern: Draws max 94 (`full`) / 44 (`fallback`) / 25 (`ms2`, Gate 50);
  Main-JS p95 ≤ 1,1 ms (Firefox `full`), WebKit Ø ≤ 0,4 ms (1-ms-Takt, p95 dort nicht aussagekräftig); GPU (Chromium)
  `full` p50 4,8–5,4 / p95 7,8–8,7 ms, `fallback` 2,0–2,3 / 4,2–4,6 ms, `ms2` 0,8 / 2,2 ms; überall volle rAF-Rate
  (Chromium/WebKit 60, Firefox headless 120 FPS ⇒ Frame ≤ ≈ 9 ms auch dort).
- **Iris Xe nicht belegbar** (DECISIONS 5). Mit angenommenem Faktor 4–5 verfehlt `full` die 12 ms, `fallback` liegt an der
  Grenze ⇒ Medium = Fallback-Medium, CSM/8 Layer ab High; Merged-Part und Preset-Infrastruktur fixiert.
- MS2-Abnahme „Kameraflug mit 2.000 Platzhaltern ≤ 50 Draws, ≥ 60 FPS“: lokal erfüllt (25 Draws, 60 FPS in Chromium/WebKit,
  120 in Firefox), Main-JS p95 0,25–0,50 ms.
- Die GPU-Aufteilung je Abschnitt (Tabelle oben) ist auf Apple-GPUs (TBDR, ANGLE/Metal) nur grob: Arbeit eines
  Render-Passes wird teils dem Folgeabschnitt zugerechnet; belastbar ist die Frame-Summe.

## Verträge / APIs für Folgepakete (MS8 Props, MS14 Grafik-Politur)

- **Benchmark:** `pnpm bench:spk4` (Volllauf, 3 Browser) bzw. `-- --quick` (Chromium, 3 s, `ms2` + `full`, Verify-Runde);
  `--update-docs`, `--browsers=`, `--scenarios=`, `--seconds=`, `--warmup=`, `--no-build`, `--headed`, `--wait=`,
  `--attempts=`. Seite: `window.__spk4.run({scenario, warmupS, measureS}) → ScenarioResult` (`src/report.ts`).
- **Schatten-Empfang:** `SHADOW_RECEIVE_GLSL` (`float shadowFactor(vec3 relPos, vec3 n)`, UBO-Slot 4 `ShadowRecv`,
  Textureinheiten 7/8, braucht den Frame-Block) – Vorlage für Terrain-/Unit-/Prop-Pass in MS14.
- **CSM:** `CascadeFitter` (Kaskaden, Cache-Regel: Refresh nur wenn die Kugel die Box verlässt oder Radius ∉ [0,55; 1]×
  gecacht; Anker-relative Lichtmatrix, `receiverMatrix`), `ShadowUnitCuller` (Bucket = Visual·2 + (LOD−1)), `CsmShadows`.
  Refresh-Rate im Flug: 27–28 Cache-Refreshes in 10 s (beide Kaskaden zusammen).
- **Props (MS8):** Instanzformat 16 B (i32 x/y/z raw, u16 Gier, u8 Skala×64, u8 Mesh<<6|Tönung), `PropGrid`
  (32-WU-Chunks, `select(frustum, origin, {eye, lod0Distance, impostorDistance, fixedLod}, out)`), ein Draw pro
  (Mesh, LOD) + ein Impostor-Draw. Kartenprops (`PROP`-Chunk) lassen sich direkt in dieses Format übersetzen.
- **Draw-Budget:** `drawBudget(cfg, shape)` = Terrain 1 + Wasser 1 + Visuals×3 + Props Meshes×2 (+1 Impostor)
  + CSM Kaskaden×Visuals×2 (+ Kaskaden×(1+Meshes) im Refresh-Frame) + Blob 1 + Post (Stufen + Stufen−1 + 2).
- **GPU-Timing:** `hideTimerQueryFromDevice(gl)` + `GpuTimer` (Segmente je Frame) – das RHI-Device liefert nur den
  letzten aufgelösten Wert.

## Abweichungen vom Auftrag / Plan (mit Begründung)

- **Units empfangen im Prototyp keine CSM-Schatten** (sie werfen sie): `UnitPass` (render) hat keinen Schatten-Eingang
  und ist nur lesend nutzbar. Units bedecken wenig Bildfläche; die GPU-Zahl ist dadurch leicht optimistisch.
- **Unit-Caster dupliziert die Merged-Part-Transformation** (GLSL-Kopie aus `UnitPass`, eigene Part-/Pivot-Texturen und
  Mesh-Puffer mit LOD 1/2), weil `UnitPass` Shader/Puffer nicht exportiert.
- **Props: Culling und LOD pro 32-WU-Chunk** statt pro Instanz: CPU-Aufwand O(Chunks) + Kopien; den Rest clippt die GPU.
- **12 Unit-Visuals** statt „3 Part-Meshes“ als ein einziges Visual: jede Variante besteht aus den drei Part-Meshes
  (Rumpf/Turm/Rohr), die Varianten machen die Draw-Zahl realistisch (FA zeigt viele Unit-Typen gleichzeitig).
- `ms2` zeichnet dieselben Merged-Part-Platzhalter wie `full` (prozedurale Platzhalter aus `combineParts`), nicht Würfel.
- HDR: Sonnenfarbe ×1,35 für Glanzlichter; ACES auf linearisierten Farben (die Szene-Shader liefern display-bezogene Werte).
- Berichtsname `spk4-<datum>-<uhrzeit>[-quick].json` (mehrere Läufe pro Tag für Wertebereiche).
- Firefox zusätzlich mit `webgl.enable-privileged-extensions` (nur Messhilfe; Firefox bietet trotzdem keine Timer-Query).
- Der Volllauf wartet auf Fremdlast (bis 240 s) und wiederholt belastete Szenarien – auf dem Rechner liefen während
  der Messung wiederholt MLX-Jobs (`h3mlx … gate_b`) und die E2E-Läufe von ms2-p4; Chromium `ms2` konnte im ersten
  Volllauf nicht ohne Fremdlast gemessen werden (steht als ⚠️ in der Tabelle, GPU-Wert nicht gewertet).
- Warnungen des Browsers (z. B. Firefox „Depth texture comparison … LINEAR … implementation-defined“) sind Hinweise,
  keine Fehler; als Fehler zählen Konsolen-Errors, GL-Fehler (`checkErrors`), Shader-/Link-Fehler, Seitenfehler und
  überschrittene Draw-Budgets.

## Befunde in `packages/render` (nur dokumentiert, im Benchmark umgangen)

1. **Sonnenazimut-Konvention:** `formats.MapLight.azimuthDeg` ist „0 = von +z, 90 = von +x“, `render.TerrainLight.azimuthDeg`
   „von +x Richtung +z“; `ClientMap.toTerrainDesc` reicht den Wert unverändert durch ⇒ die Sonne steht gespiegelt/gedreht
   (korrekt wäre `azRender = 90 − azFormats`). Der Benchmark übernimmt bewusst das Verhalten des Spiels.
2. **GPU-Zeit im RHI:** `gpuTimeMs()` liefert nur den zuletzt aufgelösten Wert, keine Zuordnung zu Frames/Abschnitten;
   eine eigene Query ist parallel nicht möglich (nur eine TIME_ELAPSED aktiv). Umgangen durch Verbergen der Extension
   vor dem Device. Vorschlag MS14: Segment-Timing im RHI.
3. **Kein Schatten-Eingang** in `TerrainPass`/`UnitPass` und keine exportierten Caster-Shader (s. Abweichungen).
4. `RENDER_PRESETS` Medium/High haben noch `shadows 'none'`, `hdr/bloom false` – Werte laut DECISIONS 17 nachziehen.

## Bekannte Grenzen

- Keine Messung auf Iris Xe/UHD 620 oder echtem Safari; GPU-Zeit nur in Chromium (Firefox/WebKit ohne Timer-Query ⇒
  Frame-Intervall als Ersatz). WebKit: `performance.now` mit 1-ms-Takt ⇒ Main-JS als Mittelwert.
- Headless-rAF ist an 60 Hz (Chromium/WebKit) bzw. 120 Hz (Firefox) gebunden; FPS sagt daher nur „Budget gehalten“.
- Main-JS enthält keine Frame-Dekodierung/UI des Clients; die synthetische Sim läuft im Main-Thread, aber außerhalb der Messung.
- Cache-Refresh-Frames der statischen Schattenebene erscheinen als Spitzen im p99 (GPU p99 `full` ≈ 10 ms).
- Szene-Inhalte sind Platzhalter (keine Texturen/Normal-Maps der Asset-Pipeline); echte Art erhöht die Fragmentkosten.
