# ms3-p3-render – Strategic Zoom, IconPass + MSDF-Atlas, Terrain-Decals (G19), HP-Balken, Platzhalter mit Turm (MS3, Welle 1)

Feature-IDs (Render-Anteil): **C2** (Strategic Zoom, IconPass = 1 Draw, MSDF-Atlas), **G19** (dynamische Decals im
Terrain-FS), dazu HP-Balken und der Platzhalter-Turm aus view.json v2. Geändert: `packages/render/**`,
`tools/assets-pipeline/**`, `tools/render-bench/**`, `content/icons/**`, `content/generated/assets/**` und dieses
Fragment; außerhalb der eigenen Pfade zwei kleine, notwendige Anpassungen (siehe Abweichungen 1 und 2).
`@faf/client` und `apps/game` kompilieren unverändert (alle neuen Optionen/Felder optional).

## Umgesetzt

| Teil | Inhalt | Dateien |
|---|---|---|
| MSDF-Generator | Eigener Generator in TypeScript (keine npm-Abhängigkeit): Konturen aus Strecken und Kreisbögen (Bulge-Notation), Orientierung normiert (außen positive Fläche, Löcher negativ), Kantenfärbung wie msdfgen „simple“ (Ecken ab ≈ 8° Richtungswechsel, CYAN/MAGENTA/YELLOW-Zyklus, Teardrop-Fall mit Kantenteilung), je Kanal **Pseudo-Distanz** der nächsten Kante des Kanals (Tie-Break: orthogonalere Kante), Vorzeichen/Innen per Nonzero-Winding (fein abgetastete Bögen), Fehlerkorrektur (falsches Median-Vorzeichen an Texel-Mitten und bilinear interpolierte Clashes > 0,3 Texel ⇒ Texel auf exakte SDF abgeflacht), 8-Bit-Kodierung `0,5 + d/range` | `tools/assets-pipeline/src/msdf.ts` |
| Icon-Quellen | `content/icons/icons.json`: eigene Vektorformen (keine FA-Assets) für alle 9 `ICON_IDS` – Land = breites Rechteck mit ausgestanztem Innenzeichen (direkt: Kreis, indirekt: Dreieck, Flak: Chevron, Späher: Raute, Ingenieur: Plus), Luft = Dreieck, Struktur = Quadrat mit Loch, Kommandant = Achteck mit Stern, Würfel = abgerundetes Quadrat – plus `generic` (Fallback-Ring), `tech1..3` (1–3 senkrechte Striche), `blip` (Ring mit Punkt) und `ghost` (vier Eckwinkel) | `content/icons/icons.json` |
| Atlas | 15 Glyphen à **48 px**, 8 Spalten ⇒ 384 × 96, **pxRange 4**; RGB = MSDF der Glyphe (Löcher ausgestanzt), **A = SDF der Silhouette** (Löcher gefüllt, enthaltene Formen ignoriert, Range 12 px) für Umriss und dunklen Hintergrund. Raw-RGBA8 (`icons/atlas.<hash8>.rgba`, Kind `iconatlas`) + Metrik-JSON (`icons/atlas.<hash8>.json`, Kind `iconmetrics`: Größe, Zelle, Ranges, je Glyphe `id`, `index`, Pixel- und UV-Rechteck), beide mit SRI-sha256 im Manifest; bytegleich reproduzierbar, `check` erkennt Drift; Build bricht ab, wenn ein `view.icon` keine Glyphe hat | `tools/assets-pipeline/src/icons.ts`, `build.ts` |
| Strategic Zoom | Reine Funktionen (identische Formeln im GLSL-Spiegel `STRATEGIC_GLSL`): `iconFade`, `unitProjectedPx`, `iconProjectionScale`, `unitIconFade`, `eyeDistanceWU`, `iconScreenRect`, `strategicZoom`, `zoomFlags` | `packages/render/src/strategic.ts` |
| Crossfade | Unit-VS berechnet je Einheit die Icon-Deckung (Schwelle/Auswahlradius aus der Datentextur), Unit-FS blendet das Mesh per **Screen-Door-Dithering** (4×4-Bayer) aus – kein Sortieren. Der CPU-Culler sortiert Einheiten, deren Mesh bei **jedem** Interpolations-Alpha unsichtbar ist (Deckung ≥ 1 selbst bei `|cur−Auge| − |cur−prev|`), in einen eigenen Icon-only-Bucket (kein Mesh-Draw); Kugel-Culling um den Icon-Fußabdruck vergrößert (kein Aufpoppen am Rand) | `passes/units.ts`, `units/culling.ts` |
| Datentextur | `VisualDataTexture` (RGBA32F 256 × 4, Unit 8): je Visual (Glyphe, Tech, iconThreshold, selectionRadius) und Mesh-Oberkante; Glyphen-Rechtecke; Sonder-Glyphen (tech1–3, blip, ghost, generic), Atlas-Ranges. Lazy-Upload, Restore aus CPU-Kopie | `units/visual-data.ts` |
| IconPass | **Ein** instanzierter Draw (6 Vertices × sichtbare Records) direkt aus dem Instanz-Ring des UnitPass (kein zusätzlicher Upload), VS interpoliert prev/cur wie der UnitPass, Icon-only-Records (Instanz ≥ `iconOnlyStart`) mit Deckung 1, Deckung 0 ⇒ degeneriertes Quad. Bildschirmfeste Größe (20 CSS-px × DPR), Tech-Strich-Streifen (0,4 × Größe) über dem Icon als zweites Atlas-Sample, Teamfarbe aus der Palette, Selektion = heller breiterer Rand, Blip = Blip-Glyphe in gedämpfter Teamfarbe ohne Tech, Ghost = Klassen-Icon mit 55 % Alpha + Ghost-Rahmen. MSDF-FS: Median → Glyphen-Distanz, Alpha → Silhouette (Umriss, Hintergrund in Löchern), screenPxRange = pxRange × Größe/48. Ohne Atlas prozedurale Ersatzform (Ring + Tech-Balken), weiterhin 1 Draw. Kein Tiefentest (Icons liegen oben). Atlas-Textur in der Context-Loss-Registry (Restore aus CPU-Kopie) | `passes/icons.ts` |
| HP-Balken | Ein instanzierter Draw im Overlay-Pass über denselben Ring; Maske (`auto` = selektiert **oder** hp < 255, `selected`, `damaged`, `all`, `off`) im VS; 26 × 4 CSS-px + Rand, über der Mesh-Oberkante bzw. unter dem Icon (Deckung ≥ 0,5); Farbe grün → gelb → rot; Draw entfällt, wenn laut CPU-Zählung kein Record passt | `passes/hpbars.ts` |
| Zoomstufen | Z0 / Z1 / Z2 aus `camera.distance` relativ zur Kartengröße (Konstanten unten); Z1 ⇒ Decal-Details reduziert (keine Striche, keine Footprint-Füllung, Ringe ≥ 1,5 px), Flags `shadows/props = false` für spätere Passes; Z2 ⇒ UnitPass übersprungen (0 Draws), Icon-Kraft rampt vorher 0 → 1 (kein Pop) | `renderer.ts`, `passes/terrain.ts` |
| Near/Far | Near = `clamp(Höhe über Grund · 0,02; 0,05; 32)` WU; `RtsCamera.mapSizeWU` (setzt der Renderer aus dem Terrain) ⇒ Far reicht immer bis zur fernsten Kartenecke (bis 4.096 WU) | `camera.ts` |
| G19 Decals | Zweite, **dynamische** Decal-Schicht im Terrain-FS (eigene Daten-/Chunk-/Listen-Texturen, Schleife nach der statischen Schicht). `DynamicDecals`: vorab reservierte SoA-Arrays, `ring` (optional gestrichelt, `dashes`), `disc`, `rect` (Footprint mit Umriss + Füllung), `clear/touch`, Versionszähler; Neu-Binning **nur bei neuer Version**, allokationsfrei, statische Schicht wird dabei nie neu gebinnt; Upload nur der belegten Zeilen. Grenzen gemeinsam: 4.096 Decals, 32 je Chunk (dynamisch bekommt den Rest), Überläufe gezählt. Statische Decals können jetzt auch `rect`/`dashes` | `terrain/decals.ts`, `passes/terrain.ts` |
| Turm-Platzhalter | `PlaceholderSpec.turret {hull, size, offset}` ⇒ Merged-Part-Mesh: Part 0 Rumpf, Part 1 Turm + kurzes Rohr (+x), Pivot = `offset`; PartStream-Eintrag `partBase` dreht den Turm; LODs wie bisher (LOD 2 ohne Rohr) | `mesh/placeholder.ts` |
| Demo/Smoke | Demo lädt den Atlas über `manifest.json` (Vite-publicDir = `content/generated/assets`), 4 Visuals inkl. Turm-Panzer, Blips/Ghosts, beschädigte Einheiten, dynamische Decals (Selektionsringe, gestrichelter Reichweitenring, Wegpunkt, Footprint), Pause, Test-API (`poseForFade`, `iconRect`, `iconFadeOf`, `setUnitCount`, `setUnitsVisible`); Profiling-Schalter `?icons=0&decals=0` | `demo/main.ts`, `scripts/smoke.ts`, `vite.config.ts` |
| render-bench | Budget `FIXED_PASS_DRAWS` 4 → 6 übernommen, Icon-Draw der Fassade in der Overlay-Spalte; `pnpm bench:spk4 -- --quick` läuft | `tools/render-bench/src/{budget,bench-renderer}.ts` |

## API-Vertrag für ms3-p4 (Client/Spiel)

```ts
// Atlas (Assets 'icons/atlas' = RGBA8 roh, 'icons/atlas-metrics' = JSON) – einmal nach dem Laden:
renderer.setIconAtlas(pixels: Uint8Array, metrics.width, metrics.height, metrics /* IconAtlasMetrics */);
renderer.setIconAtlas(null);                       // zurück zur prozeduralen Ersatzform
renderer.iconAtlas;                                // aktuelle Metriken | null
iconGlyphIndex(metrics, 'land_direct');            // Glyph-Index (−1 = unbekannt)

// VisualEntry (setVisuals) – alle neu und optional:
{ spec: { hull, size, color?, turret?: { hull, size, offset } },   // = view.json v2 placeholder
  icon?: number | string,   // Glyph-Index oder Icon-ID (wird gegen den Atlas aufgelöst, auch nachträglich)
  tech?: 0..3,              // = view.tech
  iconThreshold?: number,   // = view.iconThreshold (CSS-px, Default 14; 0 = nie Icon außer in Z2)
  selectionRadius?: number, // = view.selectionRadius (WU; Default 1,2 × halbe horizontale Mesh-Ausdehnung)
  meshes?, lodDistancesWU?, color?, baseWeight? }

// Dynamische Decals (G19): ein Puffer, jeden Frame übergeben; gebinnt wird nur bei neuer Version.
const decals = new DynamicDecals();               // Kapazität 4.096, allokationsfrei
decals.clear();                                    // bei Selektions-/Befehlsänderung neu füllen
decals.ring(xRaw, zRaw, selectionRadius, 0x7dffa0, 0.85, 0.1);          // Selektionsring
decals.ring(xRaw, zRaw, rangeWU, 0xff7050, 0.7, 0.18, 48);              // Reichweite, 48 Striche
decals.disc(xRaw, zRaw, 0.7, 0xffd040);                                 // Wegpunkt/Ziel
decals.rect(xRaw, zRaw, halfXWU, halfZWU, 0x60b0ff, 0.95, 0.2);         // Platzierungs-Footprint (MS4)
renderer.setDynamicDecals(decals);                 // → DecalBinStats (decals, droppedDecals, chunkOverflow)

renderer.setHpBars('auto' | 'selected' | 'damaged' | 'all' | 'off');   // Default 'auto'; Option hpBars
renderer.setIconSize(px);                          // Default ICON_SIZE_PX = 20 (Option iconSizePx)
renderer.zoom;                                     // { level, iconForce, z1, z2 } des letzten Frames

// Box-Select auf Icons (exakt die Geometrie des IconPass; Position = interpolierte Einheitenposition):
const fade = unitIconFade(camera, x, y, z, selectionRadius, iconThreshold, renderer.zoom.iconForce);
if (fade >= 0.5 && iconScreenRect(camera, x, y, z, rect /* [x0,y0,x1,y1] CSS-px */)) { /* Rechteck-Test */ }
```

- **RenderStats** neu: `zoomLevel` (0–2), `iconForce`, `iconCount` (Icon sichtbar), `fadedUnits` (im
  Überblendband), `iconOnlyUnits` (ohne Mesh-Draw), `dynamicDecals`, `drawsByPass.icons`; `passDraws` ist dasselbe
  Objekt wie `drawsByPass`. `decals`, `decalChunkOverflow`, `decalsDropped` summieren beide Schichten.
  `unitInstances` zählt weiterhin alle sichtbaren Einheiten (Mesh oder Icon).
- `FIXED_PASS_DRAWS` = **6** (Terrain, Wasser, Icons, Linien, Marker, HP-Balken); Draws ≤ (Visual, LOD)-Buckets + 6.
- Pass-Reihenfolge: Terrain → Units (nicht in Z2) → Wasser → **Icons** → Overlay (Linien, Marker, HP-Balken).
- Frame-UBO um `u_strategic` (projK, Icon-Kraft, Device-px je CSS-px, Zoomstufe) und `u_iconParams`
  (Icon-Größe, erster Icon-only-Record, HP-Maske) erweitert (`FRAME_LAYOUT.size` 208 → 240 B); Passes, die
  `FRAME_BLOCK_GLSL` einbinden, sind unverändert kompatibel.
- Ein Renderer-Aufruf mit einem **anderen Kamera-Objekt** invalidiert alle Culling-Caches (Kameraversionen sind je
  Objekt).

### Zoom-Konstanten (`strategic.ts`, relativ zur Kantenlänge der Karte S; ohne Terrain S = 1.024)

| Konstante | Wert | Bedeutung |
|---|---|---|
| `ICON_FADE_BAND` | 1,5 | Mesh voll sichtbar ab 1,5 × iconThreshold, Icon voll ab ≤ iconThreshold (linear dazwischen) |
| `DEFAULT_ICON_THRESHOLD_PX` | 14 | wie `DEFAULT_ICON_THRESHOLD` der Blueprints |
| `ZOOM_Z1_FACTOR` / `ZOOM_Z1_MIN_WU` | 0,25 / 60 | Z1 ab `max(0,25·S; 60)` WU Kameraabstand |
| `ZOOM_Z2_FACTOR` / `ZOOM_Z2_MIN_WU` | 0,75 / 180 | Z2 ab `max(0,75·S; 180)` WU (512 WU: 384, 1.024: 768, 4.096: 3.072) |
| `ZOOM_FORCE_START` | 0,85 | Icon-Kraft rampt linear von 0,85·Z2 bis Z2 |
| `ICON_SIZE_PX` / `ICON_TECH_STRIP` | 20 / 0,4 | Icon-Kantenlänge (CSS-px), Tech-Streifen über dem Icon |
| `HP_BAR_WIDTH_PX` / `HEIGHT` / `GAP` | 26 / 4 / 3 | HP-Balken |
| `NEAR_PER_HEIGHT` / `NEAR_MIN_WU` / `NEAR_MAX_WU` | 0,02 / 0,05 / 32 | dynamische Near-Plane |

`maxDistanceForMap` des Clients (≈ 1,39·S) liegt oberhalb von Z2; zwischen Z2 und Maximalzoom sind nur Icons zu sehen.

## Tests

`pnpm vitest run packages/render tools/assets-pipeline tools/render-bench`: 18 Dateien, **124 Tests** grün
(render 88, davon neu 15; assets-pipeline 15, davon neu 8; render-bench 21).

| Datei | Inhalt |
|---|---|
| `tools/assets-pipeline/test/msdf.test.ts` | **Median-Rekonstruktion == Rasterung in ≥ 99 %** der Pixel für jede der 15 Glyphen (4-fach überabgetastet, bilinear auf den 8-Bit-Texeln); **Quadrat-Ecken scharf** (Punkte 0,15–0,3 Texel innen/außen an allen 4 Ecken korrekt, die einfache SDF rundet sie nachweislich ab, 0 Korrekturen nötig); Kantenfärbung (Eckkanten teilen genau einen Kanal, Kreis einfarbig); Loch-Orientierung; **Atlas-Layout stabil** (Reihenfolge `ICON_IDS` + Sonderglyphen, Raster 8 × 48, Index, UV, zweiter Build bytegleich); Silhouetten-Alpha; Validierung der Quelle; Manifest-Einträge mit Kind und Hash |
| `packages/render/test/strategic.test.ts` | Crossfade-Formel (Wechsel an der Schwelle, Band bis 1,5 T, Kraft, GLSL-Konstanten); Zoomstufen für 256–4.096 WU und monotone Rampe; Near-Plane-Formel, Far-Plane über alle Ecken einer 4.096-WU-Karte; Renderer: Mesh → Band → Icon-only mit Draws und Stats; **IconPass genau 1 Draw bei 1 und 8.000 Einheiten, 0 bei 0 Einheiten**, **Z2: 0 Unit-Draws**; **`iconScreenRect` == Quad-Ecken aus dem tatsächlich hochgeladenen Frame-UBO** (DPR 2, 3 Punkte); Datentextur (Glyphe/Tech/Schwelle/Radius/Oberkante, ID-Auflösung, Sonderglyphen); **Context-Loss inkl. Atlas** (neu erzeugt, Pixel und Datentextur erneut hochgeladen, gleiche Draws); **HP-Balken-Maske** (CPU-Spiegel + Draw 0/1 je Maske); **Turm-Mesh** (Parts 0/1, Pivot, Rohr, LOD 2, Radius) |
| `packages/render/test/decals-dynamic.test.ts` | `DynamicDecals` (Push, Überlauf, Version); Packen von Strichen/Rechtecken; **dynamische Schicht nutzt nur den Rest je Chunk**, statische Schicht unberührt; gemeinsames 4.096-Budget; **1.000 Selektionsringe binnen ≤ 0,5 ms** (gemessen, Gate nur mit `FAF_PERF_GATE=1`); Renderer lädt nur bei neuer Version und nur die 3 dynamischen Texturen (belegte Zeilen) |
| angepasst | `std140.test.ts` (Frame-Block 240 B), `terrain-renderer.test.ts` (15 statt 10 Texturen nach Context-Loss: + 3 dynamische Decal-Texturen, Datentextur, Atlas), `webgl2-device.test.ts` (Tests der Mesh-Passes mit `iconThreshold: 0`, HP-Balken aus), `render-bench/test/stats-budget.test.ts` (6 feste Draws) |

**Browser-Smoke** `pnpm --filter @faf/render smoke`: **3/3 OK** (Chromium 153, Firefox 155, WebKit 26.6). Neu:
Atlas geladen; Gesamtkarten-Zoom (Z2, 160 Einheiten, HUD ausgeblendet): **IconPass = 1 Draw, Unit-Draws = 0**,
alle sichtbaren Einheiten icon-only, an **46/46–48/48** isolierten Einheitenpositionen ein Icon in Teamfarbe
(Schwelle ≥ 95 %); Z2 mit allen 2.000 fahrenden Einheiten: 6 Draws, IconPass 1; **Übergang ohne Lücke**: je Visual
eine isolierte Einheit bei Deckung 0,15/0,5/0,85 (`poseForFade`), gemessene Deckung ±0,05, `fadedUnits ≥ 1`,
Icons = 1 und Units ≥ 1 Draw, an der Einheitenposition Pixelabweichung zum Frame ohne Einheiten **≥ 60** (Minimum
über 12 Proben je Browser: 60–90); nach Context-Loss dieselbe Icon-Prüfung erneut grün (Atlas wieder da).

## Messwerte (lokal, Apple M5 Pro, Playwright headless – kein Iris-Xe-Runner, DECISIONS 5)

| Browser | Draws Übersicht (T/U/W/I/O) | Render-JS p50 / p95 Übersicht | Render-JS p95 Flug | Draws max Flug | Z2, 2.000 Einheiten: Draws, Render-JS p50 / p95 | FPS |
|---|---|---|---|---|---|---|
| Chromium 153 | 10 (1/4/1/1/3) | 0,075–0,095 / 0,19–0,22 ms | 0,25–0,29 ms | 13 | 6, 0,035 / 0,14 ms | 59–60 |
| Firefox 155 | 10 (1/4/1/1/3) | 0,08–0,12 / 0,22–0,30 ms | 0,30 ms | 13 | 6, 0,06 / 0,26 ms | 60 |
| WebKit 26.6 | 10 (1/4/1/1/3) | 0,10–0,12 / 0,26–0,34 ms | 0,30–0,36 ms | 13 | 6, 0,04 / 0,14 ms | 60 |

- Übersicht = Kamera 150 WU/52° über der 512-WU-Demo (Z1), 2.000 Einheiten (4 Visuals × 3 LODs); die Werte liegen
  im Bereich von MS2 (0,21–0,53 ms p95), der Mehraufwand der Überblendungs-Klassifikation im Culler ist nicht
  messbar. Node (Fake-GL): 8.000 Einheiten in Z2 mit neuen Frame-Daten (Culling + Klassifikation + Sortierung +
  Upload) **0,58 ms** Median je Tick; **1.000 Selektionsringe binnen 0,033 ms** Median (p95 0,06 ms) – Grenze 0,5 ms.
- **GPU-Zeiten nicht belastbar:** Während aller Läufe liefen fremde GPU-Jobs des Nutzers (h3-turbo/MLX-Benchmarks
  über `tools/gpurun`, `mediaanalysisd`); `bench:spk4` meldet die Fremdlast selbst („CONTENDED“). Chromium-Timer-
  Query schwankte zwischen 3,2 ms und 31 ms p50 bei identischer Szene. Ein A/B-Lauf (Demo mit `?icons=0&decals=0`
  gegen alles an, abwechselnd, 2 Runden) zeigte keinen Unterschied oberhalb dieses Rauschens. Die MS2-Bestwerte
  (≈ 0,7 ms p50) sind unter dieser Last nicht reproduzierbar; nachmessen ohne Fremdlast (MS14/SPK4-Nachlauf).
- Atlas: 147.456 B (raw RGBA8) + 1.721 B Metriken; Generierung aller 15 Glyphen ≈ 0,26 s.

## Abweichungen vom Auftrag / Plan (mit Begründung)

1. **`packages/blueprints/src/asset-manifest.ts` (fremder Pfad) additiv erweitert:** `AssetKind` um `iconatlas` und
   `iconmetrics`. Ohne neue Kinds lehnt `parseAssetManifest` die Atlas-Einträge ab; der Auftrag verlangt den Atlas
   „im Manifest mit sha256“. Der Client-Loader behandelt unbekannte Kinds bereits generisch (Rohbytes, Ladeordnung
   nach den bekannten Kinds) – keine Client-Änderung nötig.
2. **`packages/client/test/assets.test.ts` (fremder Pfad):** Die Tests zählen die echten Assets des Builds
   (4 → 6) und die Ladeordnung; nur diese Erwartungen angepasst. Zwei weitere Fehlschläge in derselben Datei
   (`ids` = nur `core:cube`, Kommandant-Visuals) stammen aus dem neuen Blueprint-Content von ms3-p1 und sind **nicht**
   von diesem Paket verursacht (ms3-p4 übernimmt den Client).
3. **Atlas als Rohdaten statt PNG:** Der vorhandene PNG-Kodierer liegt in `packages/formats/scripts` (nicht
   exportiert, `node:zlib` ⇒ Bytes hängen von der zlib-Version ab), und das PNG-Dekodieren im Browser
   (Farbmanagement, Premultiplied Alpha) würde die Distanzwerte verfälschen. 147 KB roh sind unkritisch.
4. **Alpha-Kanal = Silhouetten-SDF (Range 12):** pxRange 4 reicht bei ~20 px Darstellung (≈ 1,7 px Distanz) nicht
   für einen Umriss außerhalb der Form; der Alpha-Kanal liefert Umriss und dunklen Hintergrund in Löchern
   (lesbare Innenzeichen), die MSDF-Kanäle bleiben pxRange 4.
5. **Metrik „projizierte Höhe“ mit euklidischem Abstand Auge → Einheit** (nicht Clip-w): identisch in Shader,
   CPU-Culler und `unitIconFade`, unabhängig von der Blickrichtung; DECISIONS 23 („in der Entfernung der Einheit“).
6. **Icon-only-Bucket im Culler:** Einheiten, deren Mesh garantiert unsichtbar ist, kosten keinen Mesh-Draw (sonst
   würden in Z1 alle fernen Einheiten voll durch den Vertex-Shader laufen, nur um im FS verworfen zu werden). In Z2
   ist jede Einheit icon-only; der UnitPass wird dort zusätzlich explizit übersprungen.
7. **IconPass 0 Draws**, wenn keine Einheit sichtbar ist **oder** keine Einheit bei irgendeinem Alpha eine
   Icon-Deckung > 0 haben kann (nahe Kamera) – spart einen leeren Draw; sonst immer genau 1.
8. **`FIXED_PASS_DRAWS` 4 → 6** (Icons, HP-Balken). HP-Balken zählen im Overlay-Pass (wie beauftragt).
9. **Near-Plane-Formel ersetzt** (`clamp(h·0,02; 0,05; 32)` statt `max((h−4)·0,5; h·0,01)`): kleiner, clippt nie
   hohe Objekte; Tiefenauflösung mit 24 Bit bleibt ausreichend (bei 3.000 WU Abstand ≈ 0,02 WU).
10. **Turm-Platzhalter mit kurzem Rohr** (gleicher Part 1): nur so ist die Turmrichtung erkennbar; LOD 2 ohne Rohr.
11. **Renderer invalidiert Caches bei neuem Kamera-Objekt** (vorher nur Kameraversion): Versionen sind je Objekt,
    zwei Kameras mit gleicher Versionsnummer lieferten sonst ein veraltetes Culling.

## Selbsttest-Nachlauf (2026-09-30, lokal, Apple M5 Pro)

Erneuter Lauf dieses Pakets im Worktree `flow-and-fire/.worktrees/flow-and-fire-ms3` (Branch `ms3`; der im Auftrag
genannte Pfad `Projects/flow-and-fire-ms3` existiert nicht, der Worktree liegt unter `.worktrees/`). Umsetzung war
bereits vollständig; nur verifiziert, keine Codeänderung:
`pnpm typecheck` grün, `pnpm lint` grün (ESLint + depcruise), `pnpm vitest run packages/render tools/assets-pipeline
tools/render-bench` 18 Dateien / 124 Tests grün (8.000 Einheiten Z2: 0,61 ms Median je Frame, Fake-GL; 1.000
Selektionsringe: 0,033 ms Median, p95 0,074 ms), `pnpm assets` 0 Dateien geschrieben (bytegleich) + `check` aktuell,
`pnpm --filter @faf/render smoke` 3/3 OK (Z2: Icons 1 Draw, Units 0; Teamfarben-Icons 48/48, 46/46, 46/46;
Crossfade-Mindestabweichung 75/83/86), `pnpm bench:spk4 -- --quick` läuft (Chromium ms2 26 / full 93 Draws max,
Fremdlast „CONTENDED“ durch h3-turbo).

## Bekannte Grenzen

- Mesh-Überblendung per 4×4-Dithering hat 16 Stufen; bei Bewegung der Kamera ist das Muster fest im Bildschirm
  (bewusst, kein Flimmern durch Zeitrauschen).
- Kein Mipmapping des Atlas (Darstellung ~20 px aus 48-px-Zellen, Faktor 2,4): leichtes Aliasing bei sehr kleinen
  Icons möglich; Icons werden nicht nach Kategorie/Größe skaliert (eine Größe für alle).
- Icons überdecken einander ohne Priorität (Reihenfolge = Instanzreihenfolge, d. h. nach Visual sortiert).
- Z1-Flags `shadows`/`props` sind nur definiert (es gibt noch keine Schatten-/Prop-Passes im Spiel-Renderer).
- Die Icon-Deckung nutzt `camera.distance` für die Zoomstufe (Abstand zum Fokuspunkt), nicht die Höhe über Grund.
- Der Client (ms3-p4) muss Atlas laden, `VisualEntry.icon/tech/iconThreshold/selectionRadius` aus view.json v2
  setzen und `setDynamicDecals` bedienen; bis dahin zeigt das Spiel beim Herauszoomen die prozedurale Ersatzform.
- GPU-Messung ohne Fremdlast steht aus (siehe Messwerte).
