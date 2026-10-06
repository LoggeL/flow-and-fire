# Entscheidungen (autonom getroffen, Nutzer: "ohne Rückfragen")

Stand 2026-09-28. Offene Entscheidungen aus PLAN.md §7:

1. **Reihenfolge:** (a) früher FA-Loop, Balancing nur einmal auf finaler Kampfphysik.
2. **Rust/WASM-Ausweg:** (a) vorab freigegeben, falls SPK1 das Tick-Budget verfehlt.
3. **Mauern:** (a) Minimal-Drag-Linie für Strukturen mit `wall`-Flag in MS8.
4. **Area-Reclaim (E14):** (a) wird mit E8 in MS8 ins MVP gezogen.
5. **GPU-Hardware:** Keine Iris-Xe/UHD-620-Runner verfügbar. Gemessen wird lokal (Apple M5 Pro) plus
   Playwright Chromium/Firefox/WebKit headless. GPU-/FPS-Gates gegen iGPU sind damit nicht belegbar und
   werden als "lokal gemessen" markiert.

Weitere pragmatische Anpassungen:
- **CI:** zunächst lokales Skript `pnpm ci:local` statt Hosted-CI (kein Remote-Repo).
- **Bun (JSC):** Cross-Engine-Determinismus über Node (V8) + Playwright WebKit (JSC) + Firefox (SpiderMonkey).
- **Spikes SPK1–SPK6:** als Benchmarks/Prototypen innerhalb von MS1 statt 7-Wochen-Block.
- **Name:** **Flow & Fire (FAF)** — Initialen als Anlehnung an Forged Alliance Forever. Ordner `flow-and-fire`, Paket-Scope `@faf/*`. (Anfangs-Codename `ironflow`, Umbenennung nach MS1.) Eigene Fraktion, keine FA-Namen/Assets.
- **Speicher:** Mac ohne Swap → max. 2 schwere Build-/Test-Agenten parallel.

## Nachtrag 2026-09-29 – Spike-Entscheidungen MS1

Gemessen lokal auf Apple M5 Pro (Node 24 + Playwright Chromium/Firefox/WebKit headless), nicht auf dem
Referenz-Laptop; Details und Rohdaten in `docs/STATUS.md` („Spike-Ergebnisse“) und `docs/status/P6-headless.md`.

6. **SPK1 Sim-Durchsatz → alles bleibt TypeScript.** Big-Battle-Prototyp (1.000 Boden, 300 Luft, ≈ 3.900 Projektile,
   Vision, Targeting, Hash) p95 max. 1,38 ms in der langsamsten Engine (Firefox kalt) bei 25 ms Budget. Der
   Rust/WASM-Ausweg aus Punkt 2 bleibt freigegeben, wird aber nicht gezogen. Größter Posten: Targeting (≈ 50 %).
7. **SPK5 Hash und Snapshot → Live-Bereich-Hash in JS.** Hash-Tick p95 ≤ 0,39 ms (kalt), warm ≤ 0,05 ms bei 2 ms
   Budget; kein Rolling-Hash, kein WASM-xxh3. Snapshot/Restore bleibt `memcpy` (0,02–0,03 ms für die 1,4-MB-Sim-Arena).
   Keyframes bleiben bis MS11 unkomprimiert im Speicher (deflate-raw 36–40:1 steht bei Bedarf bereit).
8. **SPK6 Latenz → `inputDelay = 0`, Render-Delay adaptiv ≈ ½ Tick, keine Client-Vorhersage.** Klick → erster
   bewegter Pixel p95 106–133 ms (alle Browser × SAB/Transfer, Pipeline bei naher Kamera), Klickmarker ≤ 1 Frame,
   seq-Bestätigung ≤ 1 Tick (+ ≤ 1 Anzeige-Frame). Offener Punkt für SPK2/MS3: Aus dem Stand wird die erste
   Bewegung in der Übersichtsansicht erst nach 220–270 ms sichtbar – das ist Beschleunigung/Drehen der Einheit
   (Tuning), nicht Transportlatenz.
9. **SPK2, SPK3, SPK4, SPK7 nicht in MS1:** SPK2 (Bewegungsgefühl) vor MS3, SPK3 (Pathing) in MS3 mit `nav`,
   SPK4 (Render-Last) in MS2 und nur mit GPU-Runner aussagekräftig (Punkt 5), SPK7 (KI-Loop) in MS6.
10. **Lint des Orchestrator-Skripts:** `.claude/eslint.config.js` schließt `.claude/workflows/*` vom Projekt-Lint aus
    (Workflow-Runtime-Globals); Root-`eslint.config.js` bleibt unverändert.

## Nachtrag 2026-09-29 – Nachbesserung nach dem MS1-Review

11. **SPK6-Latenz als Abweichung akzeptiert, kein Tick-Vorziehen.** In der Spielansicht (105 WU) wird die erste
    Bewegung erst nach p95 216–283 ms sichtbar, die seq-Bestätigung am Client liegt bei p95 ≈ 100–109 ms. Beides
    verfehlt die wörtlichen Kriterien (≤ 150 ms bzw. ≤ 100 ms) und steht in `docs/STATUS.md` als „teilweise erfüllt“.
    Transport und Takt sind ausgereizt: `cmd` wird immer im nächsten Tick angewandt (`cmdApplyTicksMax = 1`, gegated),
    der Frame direkt nach dem Tick publiziert. Einen Tick bei Befehlseingang vorzuziehen, würde den festen 10-Hz-Takt
    (Replay-, Speed- und späterer MP-Vertrag) brechen und wird verworfen. Die Spielansicht-Latenz ist Anfahrverhalten
    (3 WU/s² aus dem Stand) und wird mit SPK2/MS3 gelöst (Sofort-Drehung bzw. Anfahrprofil), nicht per Latenz-Hack
    in der MS1-Würfel-Sim.
12. **`SIM_BUILD` gehört der Sim und wird über die Goldens erzwungen.** Die Konstante liegt in
    `packages/sim/src/constants.ts` (`faf-sim/ms1.2`), `sim-host` re-exportiert sie. Jedes L2-Golden speichert den
    `simBuild`, mit dem es aufgenommen wurde (Format v2): Der Golden-Test verlangt `simBuild == SIM_BUILD`, und
    `goldens --update` verweigert eine geänderte Hash-Kette (oder geänderten Layout-/simHash) ohne neuen `SIM_BUILD`.
    Damit können Logs vor und nach einer Verhaltensänderung nie dieselbe simId tragen.
13. **Spalte `Units.gen` gestrichen (Abweichung von PLAN §3.5).** Die Generation steht bereits in der
    Generation-Spalte der Table-DSL (`units.gen`, Handles `index:20|gen:12`); eine zweite, nur beim Spawn kopierte
    Spalte wäre eine zweite, getrennt gehashte Wahrheit. Solange das Layout jung ist, wird sie entfernt (Layout-Hash
    `0xcc8737d2`).
14. **Der letzte Regel-Hash ist kein Regel-State.** `lastHash/lastHashTick` liegen in der eigenen Region `hashlog`
    mit `derived: true` (Snapshot und Voll-Hash ja, Regel-Hash nein). Hash-Kadenz (`HASH_INTERVAL_TICKS`, Release
    später 50) und Hash-Verfahren (Rolling/WASM) ändern damit den simulierten Zustand nicht; Debug- und Release-Builds
    teilen dieselben Regel-Hashes je Tick. Die World-Header-Wörter 2/3 bleiben reserviert (0).
15. **`seq` innerhalb einer Armee in Serial-Number-Ordnung.** CommandApply sortiert nach
    `(army, (seq − lastAckSeq − 1) & 0xffff, Ankunft)`; damit wirkt nach dem u16-Umlauf (65535 → 1, 0 wird vom Client
    übersprungen) der neuere Befehl zuletzt, und `lastAckSeq` bestätigt ihn (passt zu `seqAcked` im Client).
16. **Messung ≠ Gate.** Maschinenabhängige ms-Grenzen gaten nicht mehr den normalen Testlauf: Das Latenz-E2E gated
    nur Invarianten (Frames/Ticks), die ms-Gates laufen mit `FAF_LATENCY_GATE=1`. `pnpm bench` schreibt nur lokale,
    git-ignorierte Berichte (`results/*.json`); die Tabellen in `docs/status/P6-headless.md` ändert nur
    `pnpm bench -- --update-docs`. STATUS nennt Wertebereiche über mehrere Läufe statt Einzelwerte.

## Erste Karte: „Setons“ (Nutzerwunsch, 2026-09-29)

- Nachbau nach dem Vorbild von *Seton's Clutch* (FA-Klassiker, 20 × 20 km, 8 Startpositionen, Teams gegenüber, Wasser dazwischen).
- **Eigene Heightmap, eigene Texturen, eigene Props** — Layout nach öffentlichen Kartenbildern/Beschreibungen nachmodelliert, keine Original-Dateien (.scmap) übernommen.
- Größe 1.024 WU (≈ 20 km). Das liegt über der MVP-Spielgröße (256–512 WU); Formate und Nav sind dafür ausgelegt, Terrain-LOD (M11) kommt erst in MS14 → bis dahin muss die Karte ohne LOD flüssig laufen (auf M5 Pro gemessen).
- 8 Startpositionen im Kartenformat; der MVP spielt 1v1 auf 2 davon (gegenüberliegend).
- Marine/Hover sind Post-MVP: Die Landverbindungen zwischen den Seiten müssen für Land-Einheiten begehbar sein; Wasser ist bis dahin Hindernis bzw. Luftraum.
- Wird nach MS2 (sobald Kartenformat + CLI-Import stehen) gebaut und als Standardkarte gesetzt.

## Nachtrag 2026-09-29 – SPK4 (MS2)

17. **SPK4 Render-Last → Merged-Part und Preset-Infrastruktur fixiert; Medium-Werte = Fallback-Medium, CSM ab High.**
    **Lokal gemessen (Apple M5 Pro, Playwright Chromium 153 / Firefox 155 / WebKit 26.6 headless), kein Iris Xe und
    kein echtes Safari** (Punkt 5). Benchmark `pnpm bench:spk4` (`tools/render-bench`), Szene: hollow-ridge 512 WU,
    2.000 Merged-Part-Units (12 Visuals × 3 LODs, PartStream), 30.000 instanzierte Props, Viewport 1920×1080,
    Backbuffer 1536×864 (Render-Scale 0,8), 10-s-Kameraflug; Wertebereiche über 2 Volläufe, GPU-Werte nur ohne
    Fremdlast (Details und Rohtabellen: `docs/status/ms2-p5-spk4.md`).

    | Szenario | Draws max (Grenze) | Main-JS p95 Chromium / Firefox / WebKit (Ø, 1-ms-Takt) | GPU p50 / p95 (nur Chromium, Timer-Query) | FPS Chromium / Firefox / WebKit |
    |---|---|---|---|---|
    | `full` (CSM 2×2048, 8 Layer, HDR, Bloom, ACES, FXAA) | 94 (250) | 0,62–0,72 / 1,04–1,06 / 0,37–0,38 ms | 4,8–5,4 / 7,8–8,7 ms | 60 / 120 / 60 |
    | `fallback` (Blob, 4 Layer, Impostor-Ring 110 WU) | 44 (250) | 0,39–0,53 / 0,62–0,70 / 0,34–0,38 ms | 2,0–2,3 / 4,2–4,6 ms | 60 / 120 / 60 |
    | `ms2` (Fassade: Terrain + Wasser + 2.000 Units) | 25 (50) | 0,25–0,35 / 0,48–0,50 / 0,25–0,29 ms | 0,8 / 2,2 ms | 60 / 120 / 60 |

    Das Exit-Kriterium (≤ 250 Draws, Main-JS ≤ 5 ms, GPU ≤ 12 ms) ist **lokal in allen drei Browsern erfüllt**, mit
    großer Reserve bei Draws und Main-JS (hardwareunabhängig bzw. auf langsameren 4-Kern-CPUs noch ≥ 4× Luft).
    Für die GPU belegt die Messung das Iris-Xe-Ziel nicht: Nimmt man für Iris Xe (96 EU) gegenüber dem M5 Pro einen
    Faktor 4–5 an (FP32-Leistung und Speicherbandbreite; **Annahme, nicht gemessen**), läge `full` bei ≈ 20–27 ms p50,
    `fallback` bei ≈ 8–12 ms – `full` verfehlt 12 ms deutlich, `fallback` liegt an der Grenze. `full` kostet GPU-seitig
    ≈ 2× `fallback` (CSM-Empfang im Terrain-/Prop-FS, 8 Layer, Schatten-Passes).

    Konsequenzen:
    - **Fixiert:** Merged-Part (ein Draw pro (Visual, LOD), PartStream als Datentextur, CPU-Culling/LOD nur bei neuem
      Frame oder Kamerawechsel), instanzierte Props mit Chunk-Culling (ein Draw pro (Mesh, LOD)), die Preset-
      Infrastruktur und die Pass-Struktur (Schatten statisch gecacht + Units pro Frame mit reduziertem LOD, HDR-Kette).
    - **Preset-Tabelle (`packages/render/src/presets.ts`, umzusetzen mit MS8/MS14 vom Render-Paket):**
      Low: keine Schatten, 4 Layer, Impostor-Ring ab ≈ 70 WU, LDR ohne Bloom; **Medium: Blob-Schatten, 4 Layer,
      Impostor-Ring ab 110 WU, HDR + Bloom (5 Stufen) + FXAA, Render-Scale 0,8**; High: CSM 2 Kaskaden 2048², 8 Layer,
      Props ohne Impostor-Ring, MSAA 4; Ultra wie High mit LOD-Bias 1,25. `shadows`/`shadowCascades`/`hdr`/`bloom`
      bekommen damit ihre echten Werte (MS2 noch `'none'`/`false`).
    - **Draw-Budget skaliert mit der Visual-Zahl:** Units 3 Draws/Visual, CSM-Caster 2 Draws/Visual/Kaskade. Mit der
      Fraktion (≈ 45–55 Blueprints) würde High mit CSM > 250 Draws erreichen (Test: 40 Visuals ⇒ 309). MS14 bündelt
      deshalb die Caster (nur LOD 2 im Schatten ⇒ 1 Draw/Visual/Kaskade) bzw. nutzt `WEBGL_multi_draw` (Chromium und
      WebKit ja, Firefox nein).
    - **MS14 (Grafik-Politur):** GPU-Messung auf echter iGPU/echtem Safari nachholen (Autodetect + 3-s-Benchmark
      entscheiden Medium vs. High); Terrain-/Unit-Pass bekommen den Schatten-Empfang (`SHADOW_RECEIVE_GLSL` aus
      `tools/render-bench/src/proto/shadow-glsl.ts` als Vorlage, Units empfangen im Prototyp noch keine Schatten);
      Bloom-Kette auf iGPU prüfen (5 Stufen, auf dem M5 Pro ≈ 1,3–2,3 ms inkl. Composite/FXAA).

## Nachtrag 2026-09-29 – Nachbesserung nach dem MS2-Review

18. **Die Testebene ist eine generierte Karte, kein Sonderpfad.** `?map=testplane`, Szenarien mit `map({ sizeWu })`,
    `createWorld`/`SimCore` ohne Karte und der Client ohne `setMap` laufen alle über
    `formats.createTestPlaneMap(size)` (flach, kein Wasser, keine Spots, Name `testplane`, Starts = MS1-Layout
    (256, 256)/(312, 214) bei 512 WU) – also durch denselben Pfad wie jede Karte: statische Arena-Region, reguläre
    `mapSimHash`/simId, `ClientMap`, `TerrainPicker`, CDLOD-`TerrainPass`. Entfernt: `GroundPass`, `GroundPicker`,
    `FlatTerrain`, `World.testPlane`/`MT_TEST_PLANE`, `simIdOf` und alle `map === null`-Zweige. Der alte
    String-Hash lebt nur noch als `legacyTestPlaneMapSimHash` zum Lesen von v1-Logs (MS1). Die Goldens `cubes-*`
    wurden mit der neuen Identität neu aufgenommen (Hash-Ketten unverändert, nur `mapSimHash`/simId neu; kein
    `SIM_BUILD`-Bump, weil sich nur die Karte, nicht der Sim-Code ändert – Regel aus Punkt 12). Kartengrößen sind
    überall dieselben: Zweierpotenz in 64..4096 WU (formats, sim, render).
19. **Licht-Konvention der Karte ist die des Formats.** `META.light.azimuthDeg`: 0° = Sonne aus +z, 90° = aus +x;
    Richtung zur Sonne `(sin az · cos el, sin el, cos az · cos el)`. `render.sunDirection` rechnete vorher
    `(cos az, …, sin az)` (an x = z gespiegelt) und wurde an das Format angepasst; Karten werden nicht umgeschrieben.
    Ein Client-Test nagelt Format → `ClientMap.toTerrainDesc` → `sunDirection` gemeinsam fest.
20. **Sitzungs-Snapshots tragen ihre Identität.** `SimCore.snapshot()` = 16-B-Kopf (`'FAFS'`, simId, layoutHash,
    Arena-Länge) + dynamische Arena; `restoreSnapshot` lehnt fremde simId (andere Karte/Blueprints/Build), anderes
    Layout oder andere Größe mit `SnapshotError` ab, bevor etwas geschrieben wird. Die rohe Arena-Kopie
    (`sim.snapshot/restore`) bleibt für Keyframes derselben Welt.
21. **Ein UTF-8-Codec.** Der strikte Codec (wirft bei einzelnen Surrogaten, überlangen Formen) liegt in
    `@faf/protocol` (`encodeUtf8`/`decodeUtf8`) und wird von simId, `.rtsmap` (über `@faf/formats`, Re-Export) und dem
    Command-Log-Kopf benutzt; `protocol.utf8Encode` (ersetzte still durch U+FFFD) und der lose Decoder im Log-Format
    sind entfernt.

## Nachtrag 2026-09-29 – Karte Setons (Standardkarte)

22. **Setons ist die Standardkarte; MS1/MS2-E2E bleiben auf hollow-ridge fixiert.** `DEFAULT_MAP = 'setons'`
    (`apps/game/src/params.ts`); `?map=hollow-ridge` und `?map=testplane` bleiben erreichbar. Die E2E-Specs, die
    hollow-ridge-Identitäten und -Positionen prüfen, öffnen die Seite über `openGame`, das ohne `map=` in der Query
    `map=hollow-ridge` ergänzt (`test/e2e/support/game.ts`, `withPinnedMap`); nur `setons.spec.ts` und
    `map-load.spec.ts` laden die Standardkarte ohne Parameter. Spieler = Armee 0 (SW-Mid), Gegner = Armee 1 (NO-Mid)
    wie in der Spezifikation vorgeschlagen (Mid gegen Mid über die Landbrücke).
23. **Setons ohne Terrain-LOD: keine Render-Änderung nötig.** Gemessen (Apple M5 Pro, Chromium headless, Medium,
    1280×720): Gesamtansicht mit allen 1.024 Terrain-Patches (≈ 2,1 Mio. Dreiecke, 1 Draw) 60 FPS (vsync), GPU p50/p95
    ≈ 3,3–5,6 / 6,1–6,5 ms, Render-JS p95 ≈ 0,3 ms. Patchgröße (32 WU), Chunk-Culling und Sim-Höhe bleiben
    unverändert; die auto-berechnete Kamera-Maximaldistanz (`maxDistanceForMap`) zeigt die ganze Karte (alle vier
    Ecken im Bild, E2E-gegated). Für die iGPU (Faktor 4–5 angenommen, nicht gemessen) läge die Gesamtansicht bei
    ≈ 25–30 ms – Terrain-LOD (M11, MS14) bleibt dafür nötig.
24. **Setons wird geskriptet, nicht importiert.** `packages/formats/scripts/mapgen-setons.ts` baut Heightmap,
    Splat (8 Layer, 256²) und `markers.json` aus der Spezifikation `content/maps/src/setons.spec.md` (eigene
    Formen: Signed-Distance-Felder der Uferpolygone mit antisymmetrischem Domain-Warp, Profile für Schelf/Strand/
    Tiefwasser, Inseln, Kapsel-Gebirge, deterministisches Lattice-Rauschen aus `rng32`). Der Generator ist exakt
    punktsymmetrisch (symmetrische Funktion + Spiegelung der kanonischen NO-Hälfte). Referenzbilder und
    Original-Dateien liegen nicht im Repo.

## Nachtrag 2026-09-29 – Setons-Review Runde 1 (Optik)

25. **Medium nutzt 8 Splat-Layer und Triplanar-Klippen (Abweichung von DECISIONS 17 / PLAN §3.7 „Triplanar ab
    High“).** Ohne Ebene 1 fehlten auf Medium Erde, trockenes Gras, dunkler Fels und Moos (Karte einheitlich grün).
    Gemessen (Apple M5 Pro, Chromium headless, Setons-Gesamtansicht, 1.024 Patches, unkontendierte A/B-Läufe
    abwechselnd alt/neu): GPU p50 5,5–6,3 ms neu gegen 5,7–6,2 ms alt, beide 60 FPS; im Kameraflug p50 1,9–3,8
    gegen 1,4–2,4 ms. Low bleibt bei 4 Layern ohne Triplanar. Kosten bleiben klein, weil der Terrain-FS nur Layer mit
    Gewicht > 1/256 abtastet (explizite Gradienten, `textureGrad`) und die Seitenprojektionen nur an steilen Flächen.
26. **Gemalte Splatmaps können die Auto-Splat-Basis vollständig ersetzen – kein neues Formatfeld.** Der Terrain-FS
    überblendet die gemalten Layer weiterhin der Reihe nach (FA-artig); ist in Ebene 0 R = 1, ersetzt die gemalte
    Verteilung Auto-Splat und automatisches Uferband ganz. Der Setons-Generator legt dafür zuerst das Endgewicht jedes
    Layers fest und kodiert daraus exakte Überblendfaktoren (Ebene 0 als 4-Layer-Näherung für Low, Ebene 1 obenauf).
    So braucht es kein Karten-Flag „Uferband aus“ im META (Format und hollow-ridge bleiben unverändert).
27. **Wasser: Tiefenfarbe pro Karte, Rand exakt an der Kartenkante.** Volle Tiefenfarbe bei 85 % der tiefsten Stelle
    (3–13 WU; Setons 13 WU, hollow-ridge 3 WU; seit Review Runde 2: tiefste Stelle, 3–16 WU, Tiefblau erst ab 55 %,
    Rand-Abdunkelung 10 statt 24 WU – siehe 29), drei Farbstufen (Schelf türkis → Blau → Tiefblau) mit leichtem
    Tiefenrauschen, Flachwasser deckender (α 0,55). Wellen auf der Weltposition mit unregelmäßigen Richtungen und
    inkommensurablen Wellenlängen (kein gemeinsames 32-WU-Raster mehr), je Welle Ausblendung nach Pixel-Footprint,
    Böen-Rauschen und ruhigeres Fernfeld; schwächeres Glanzlicht. `WATER_BORDER_WU = 0`; Terrain und Wasser dunkeln
    über die letzten 24 WU zur Kartenkante ab (FA-artiger Rand statt harter Kante).
28. **Ressourcen-Spots bleiben aus der Ferne lesbar.** Terrain-Decals haben eine Mindestgröße in Pixeln
    (`minRadiusPx`, begrenzt durch `maxRadiusWU` für das Chunk-Binning), Linien ≥ 2 px; Hydro ist eine eigene Form
    (Raute, Decal-Art `diamond`), Mass ein Ring. Echte strategische Symbole (Overlay) folgen mit MS8/MS14.

## Nachtrag 2026-09-29 – Setons-Review Runde 2 (Politur)

29. **Setons-Review Runde 2: Nahdetail im Terrain-FS statt größerer Texturen.** Detail-Normal (zwei Rausch-Oktaven,
    0,9/2,6 WU Wellenlänge, nur Beleuchtung) und rauschgeschärfte Splat-Übergänge werden prozedural im Terrain-FS
    berechnet und nach Pixel-Footprint ausgeblendet; die Albedo-Kacheln (128², 8 WU) bleiben, nur mit mehr Kontrast
    (≈ ±25 %). Keine neuen Texturen/Formatfelder; Gesamtansicht ohne Mehrkosten (A/B gemessen, status/setons-map.md).
    `terrainAlbedoTri` bekommt das Schärfungsrauschen vom Aufrufer (`TERRAIN_SPLAT_GLSL` bleibt ohne Rausch-Helfer,
    tools/render-bench unverändert). Die Kantenabdunkelung wirkt vor den Decals und nur noch 10 WU; Karten halten
    Spots ≥ 12 WU vom Rand.

## Fraktion Varkan-Kompakt (2026-09-29)

Konzept, Roster (50 Einträge, 26 bis MS9) und Werte: `docs/design/faction.md`, `roster.md`, `roster.json` (einzige Zahlenquelle).
Generator-/Prüfskripte: `tools/roster/`. Offene Punkte aus dem Roster-Review, autonom entschieden:

1. **Hochofen (T3-Artillerie) vs. Kartengröße:** Alle MVP-Karten haben ≥ 354 WU Kantenlänge (Setons 1.024, Hollow Ridge 512). Der Balancing-Gate im Blueprint-Compiler (PLAN §3.9) bleibt und sperrt kleinere Karten.
2. **`iconThreshold`:** Der Roster-Wert (25 px für mobile Einheiten) gilt; das Beispiel in PLAN §3.9 (14) ist veraltet.
3. **FA-Referenzwerte:** vor MS9 gegen den aktuellen FAF-Stand neu rechnen (Aufgabe in MS9).
4. **Abstich (Overcharge):** Formel als ganzzahlige Tabelle in MS6 festlegen.
5. **Vogt-Wrack, Luft-Drehraten, Beschleunigungen:** werden im jeweiligen Meilenstein (MS5, MS12, MS3) festgelegt und in `roster.json` nachgetragen.
6. **Bomber/Flak gegen Gruppen:** in MS12 nachrechnen.
7. **Namens-/Markenrecherche** („Varkan“, „Kessa“, Einheitennamen): vor einer Veröffentlichung, nicht MVP-blockierend.
8. **Blueprint-Schema-Erweiterungen** (Schild-Regenerationsverzögerung, Maßstab, Tech-Maske der Modelle): in den Meilensteinen, die die Felder brauchen.

## Nachtrag 2026-09-29 – SPK2 und Blueprint-Format (MS3)

Die importierten MS3-Entscheidungen hatten ebenfalls die Nummern 22 und 23. Hier heißen sie
`MS3-22` und `MS3-23`; Setons 22/23 bleiben unverändert. Frühere MS3-Verweise auf 22/23 meinen
SPK2 beziehungsweise das Blueprint-Format, Setons-Verweise die Standardkarte und Render-Messung.

MS3-22. **SPK2 Bewegungsgefühl → Steering ohne RVO/ORCA bleibt; Parametersatz `SPK2_PARAMS` fixiert.**
    Wegwerf-Prototyp mit Float64 in `tools/headless/src/spk2/` (10 Hz, Grid-A\* + String-Pulling, Separation über
    ≤ 8 Nachbarn aus einem 2-WU-Grid, Abstandsfeld-Gradient, Ketten-Kinematik, positionsbasierte Kollision nach Masse
    und Priorität, Arrival-Contagion, Idle-Nudge, Stuck → Repath/Ausweichen, Gruppen-Move mit Offset-Erhalt), Benchmark
    `pnpm bench:spk2` (`--quick` < 60 s, `--trace <szenario>` + Canvas2D-Viewer `tools/headless/spk2/viewer.html`).
    **Lokal gemessen, Apple M5 Pro, Node 24; Wertebereiche über 2 Seeds (Tabelle in
    `docs/status/ms3-p1-blueprints-spk2.md`), Robustheit zusätzlich über 8 Seeds geprüft: alle 6 Szenarien 8/8 bestanden.**

    | Szenario | Ergebnis (Seeds 1–8) |
    |---|---|
    | 200 Units über die Karte (256 WU, Grat mit 2 Pässen, See, Felsen; Klassen 1–3) | kein Deadlock, alle nach 146,7–156,7 s angekommen, **98–100 % ohne Stuck > 3 s** (Kriterium ≥ 95 %), eine Pfadanfrage für die Gruppe |
    | Engstelle 3 WU, 100 T1-Panzer | kein Deadlock, **alle durch nach 22,2–24,7 s** (Kriterium ≤ 60 s) |
    | Roll-off an der Fabrik (40 Units, Tor, Rally-Punkt) | kein Deadlock, Tor nie blockiert, alle am Rally-Punkt nach 47,4 s |
    | Klumpen bei Attack-Move (100 Units auf einen Punkt) | kein Deadlock, alle ruhend nach 28,1–35,4 s, Restüberlappung ≤ 0,05 WU |
    | Mauerlücken 2/4/6 WU (80 Units, Klassen 1–3) | kein Deadlock, alle durch nach 80,4–83,2 s, 100 % ohne Stuck > 3 s |
    | Offset-Erhalt (60 Units, 3 Reihen, 100 WU) | Offset-Fehler p95 0,31–1,24 WU (Kriterium ≤ 1,5 WU), Maximum 1,01–1,74 WU |

    Parameter (Einheiten WU, WU/s, °, Ticks): Bremsen = 2 × accel; Anfahren während des Drehens bis 70° Kursfehler
    (Tempo linear 100 % → 40 %), darüber Drehen auf der Stelle mit 10 % Kriechtempo; Start-Kick 3 Ticks mit 2 × accel;
    Separation Stärke 0,5, Reichweite 1,5 × (ri + rj), ≤ 8 Nachbarn; Clearance-Gradient ab radius + 0,5 WU mit Stärke 1,5;
    Ankunftsradius 0,35 WU; Contagion bis 4 WU vom Slot, Berührung + 0,3 WU, nur bei belegtem Slot oder 10 Ticks ohne
    Fortschritt; weggeschobene Angekommene fahren nach 10 Ticks ab 1,0 WU Abweichung zurück; Kollision 2 Iterationen,
    fahrende Units wiegen 4 × gegenüber stehenden; Idle-Nudge an (seitliches Ausweichen mit 50 % Tempo für 6 Ticks);
    Stuck = < 0,15 WU Fortschritt auf dem Restpfad in 20 Ticks → 1. Repath, 2. Ausweich-Wegpunkt 2,5 WU seitlich;
    Wegpunkt erreicht bei 1,0 WU, LOS-Vorausschau alle 5 Ticks; Offset-Kompression R(n) = 2 + 1,1 · √n WU, aber nie enger
    als ri + rj + 0,15 WU; Default-Masse je Größenklasse 1, 2, 4, 8. Der Sweep (one-at-a-time, 12 Parameter) zeigt ein
    flaches Optimum; ohne Idle-Nudge und mit Anfahrwinkel 90° reißen Szenarien – beides bleibt wie gewählt.

    Entscheidungen:
    - **Kein Wechsel auf ORCA-lite:** Alle Szenarien laufen ohne Deadlock mit dem Steering aus PLAN §3.8; ms3-p2 portiert
      die Werte auf Fx (Konstanten mit Herkunftskommentar, Umrechnung genau einmal).
    - **Anfahrprofil (SPK6-Folgepunkt aus 8/11):** Die Drehung beginnt im ersten Tick nach dem Befehl (sichtbar nach
      1–2 Ticks), Units unter 70° Kursfehler fahren sofort an, darüber rollen sie mit 10 % Tempo während der Drehung
      (Wenderadius ≈ 0,2 WU beim T1-Panzer). Damit ändert jede Unit ihre Position nach ≤ 5 Ticks (MS3 „alle fahren
      < 1 s los“); zusätzlich verdoppelt ein Start-Kick die Beschleunigung für 3 Ticks.
    - **Gruppenpfad-Rezept:** ein A\* von der Unit nächst am Schwerpunkt (Klasse = größte der Gruppe); je Unit
      Gruppen-Wegpunkt + eigener Offset, **wenn für ihre Klasse passierbar und in Clearance-LOS zum vorherigen
      Wegpunkt**, sonst der Gruppen-Wegpunkt selbst (sonst schneiden verschobene Teilstrecken Klippen/Mauern).
    - **Contagion nur bei belegtem Slot oder Stillstand** (sonst halten Units mit eigenem Slot zu früh an) und der
      Contagion-Punkt wird zum neuen Slot; nur weggeschobene Units fahren zu ihrem Slot zurück.

MS3-23. **Blueprint-Format MS3: sim.bin v2, view.json v2, iconThreshold, Größenklassen-Regel.**
    - **sim.bin v2:** Kopf 48 B (die ersten 32 B wie v1) plus Sektionsverzeichnis (4CC, Offset, Länge, Anzahl, Stride;
      unbekannte Sektionen werden übersprungen). Der 64-B-Unit-Record behält alle v1-Felder an ihren Offsets; die
      reservierten Bytes tragen jetzt `mass` (u16), `upgradesTo`, `brakePerTick` (Fx/Tick²), `buildableBy`
      (Ausdrucks-Index), `deathWeapon`, `firstMount`/`mountCount`, `veterancy`, `flags` Bit 0 = `turnInPlace`.
      Neue Sektionen: Unit-Erweiterung (Kosten, Wrack, Hitbox), Waffen, Projektile, Waffen-Mounts, Zielprioritäten,
      Kategorie-Ausdrücke (Bytecode-Pool + Quelltexte), Props, Fraktionen. **v1 bleibt lesbar** (`decodeSimBin` füllt die
      v2-Defaults, `table.version === 1`); andere Versionen werden mit „unsupported version N (this build reads 1..2)“
      abgelehnt. Die `SimBpTable`-API ist quellkompatibel erweitert. Der simHash des Spiel-Bundles ändert sich damit
      (0xD4135AF1 → 0x49678DEF); die L2-Goldens nimmt ms3-p2 mit neuem `SIM_BUILD` auf (Regel aus 12).
    - **Kategorie-Ausdrücke** werden dedupliziert, nach Code-Units sortiert (Index = Position) und als @faf/rules-Bytecode
      in sim.bin abgelegt; Decoder und Encoder prüfen den Bytecode (`validateCategoryCode`).
    - **view.json v2:** je Visual `icon` (Registry `ICON_IDS`, Pflicht für Spiel-Einheiten), `iconThreshold`, `tech`
      (0–3), `categories` (Namen in Bit-Reihenfolge), `selectionRadius` (= 1,2 × max(radius, max(footprint)/2), auf
      1/100 WU gerundet, überschreibbar), `sizeClass`, `hotkeySlot`, `fx`, Platzhalter-`turret {hull, size, offset}`,
      dazu die Effekt-Tabelle. `parseViewJson` liest v1 (hebt auf die v2-Form an) und v2. Kategorien stehen jetzt auch in
      der View – eine Kategorieänderung ändert beide Hashes.
    - **iconThreshold-Semantik:** projizierte Bildschirmhöhe in CSS-Pixeln des Auswahlkreises der Einheit
      (Durchmesser 2 × `selectionRadius` in der Entfernung der Einheit, bei der Kamera-FOV und Viewport-Höhe in CSS-px).
      Unter `iconThreshold` ersetzt das Icon das Mesh vollständig, ab 1,5 × `iconThreshold` ist nur das Mesh sichtbar,
      dazwischen Crossfade (Band aus ms3-p3). Default 14 px; der MS1-Würfel behält 8, Strukturen nutzen 10.
    - **Größenklassen-Regel:** Mobile Land-Einheiten nutzen `sizeClass` 0–3 (Nav-Klasse = max(1, sizeClass),
      `navClassOf` aus ms3-p0) und ihr Kollisionsradius muss in die Klasse passen: `radius ≤ max(0,5; sizeClass − 0,5)` WU
      (Klasse s verlangt Clearance ≥ s, d. h. s − 1 freie Zellen um die Zelle der Einheit). Default-Kollisionsmasse je
      Klasse 1/2/4/8 (Blueprint `motion.mass` überschreibt), `turnInPlace` Default für Land, `brake` Default 2 × accel.
    - **Tech-Baum „zyklusfrei“** heißt: jede Einheit ist von einer Wurzel (nicht baubare Einheit oder Fraktions-Start)
      über Bau-/Upgrade-Kanten erreichbar; FA-übliche Zyklen (Ingenieur ↔ Fabrik), die an einer Wurzel hängen, sind
      erlaubt. Geschlossene Zyklen ohne Zugang von außen werden mit Pfad gemeldet, `upgradesTo`-Ketten müssen für sich
      zyklusfrei sein. Behavior- und Toggle-Registry sind in MS3 leer; `test:`-Blueprints sind von Icon-, TECH- und
      i18n-Pflicht ausgenommen.


## Nachtrag 2026-09-29: Konsolidierung und vorbereitete Integration

30. **Ein aktiver Projektordner.** Entwicklung und alle Start-/Prüfbefehle laufen aus
    `flow-and-fire` auf `main`. Die sieben ursprünglichen Arbeitskopien bleiben als ignorierte
    Archive unter `.worktrees/` erhalten, einschließlich ihrer uncommitteten Inhalte. Der lokale
    SHA-256-Vergleich meldet keine Abweichungen. Historische Track-Pläne beschreiben ihre damaligen
    Worktrees; README und Konsolidierungsbericht geben die aktuellen Arbeitsanweisungen vor.
    Kein Commit, Push oder Wechsel der Branch gehört zu dieser Zusammenführung.

31. **SPK3: HPA* und Korridor-Repath bleiben Standard bei 20.000 Expansionen pro Tick.** Zwei
    lokale Läufe auf Apple M5 Pro bewältigten 200 Einzelanfragen auf 512/1.024 WU in 5/9 Ticks;
    die funktionalen MS3-Abnahmen bestehen. Der Chunk-Eintritt-Vergleich erzeugt im Basisbau
    85 statt 40 Zusatzanfragen auf 512 WU und 31 statt 21 auf 1.024 WU. Native Lazy-Refinement
    und Kollisionsschutz bleiben in der Benchmark-Alternative aktiv. Die Stempelzeiten enthalten
    Korridor-Erkennung und belegen keinen CPU-Gewinn durch Indexentfernung; Korridor-Schnitt bleibt
    daher die Produktionsstrategie. PathService-p95 liegt abhängig von Fremdlast teils über 5 ms,
    Zeitwerte bleiben ohne `FAF_PERF_GATE=1` advisory. Der 1.000-Unit-Tick-Benchmark liegt in
    Node/Chromium/Firefox/WebKit unter 8 ms. Ein Give-up im 1.024-WU-Basisbau-Spike bleibt
    dokumentiert; Traversal-Abnahme: 197/200 ohne Stall über 30 Ticks, keine blockierten Positionen.
    Details: [MS3 P5](status/ms3-p5-bench.md). Die Messentscheidung ändert kein Sim-Verhalten.

32. **KI als isolierter Adapter und Arena.** `@faf/ai` importiert fixed/protocol/rules und erhält
    ausschließlich erlaubte Perception-Daten. Intel, Opening, Economy, Tech, Defense, Factory,
    Engineer und Platoon arbeiten mit Profil-, APM- und Operationsbudgets. Die lokale Arena nutzt
    eine eigene Welt; ihre Turniere erfüllen keine Abnahme gegen die echte Fixed-Point-Sim.
    Abweichungen der Opening-Zeiten bleiben gegenüber unveränderten expect sichtbar. MS6/MS9/MS10
    übernehmen die Perception-, Command- und Host-Verträge und wiederholen die Szenarien gegen die
    echte Sim. Welt-Tick ±2 % und Referenz-Hardware bleiben unbelegt.

33. **HUD als Präsentationspaket.** `@faf/hud` konsumiert Snapshots und gibt UI-Commands aus; die
    Galerie verwendet lokale Demo-Daten. Locale-Keys, Snapshot- und Action-Verträge bleiben für
    die Integration stabil. MS4/MS6 binden Ressourcen, Auswahl und Produktion an reale Frames und
    Befehle; MS9/MS11/MS14 übernehmen Menüs, Alerts, Minimap und Settings. Die strikten lokalen
    Performance-Gates verwenden dieselbe Warmup-Grenze und dokumentierte Browser-Uhr-Auflösung;
    sie belegen die Galerie auf der Messmaschine.

34. **Editor als eigenständiges Werkzeug.** three.js bleibt im Marker-Editor, ohne Import der
    Spielsimulation oder des Spiel-Renderers. `PFLD` erweitert das Kartenformat additiv; bestehende
    Karten ohne Felder bleiben bytegleich. Feldexpansion rechnet integer-only in Q20.12-Rohwerten,
    Feldnamen verändern den Sim-Hash nicht. Die Algo-Version gehört in den Hash. Unbekannte Chunks
    bleiben beim Bearbeiten erhalten; der Download ist das exportierte Ergebnis und überschreibt
    keine mitgelieferte Karte.

35. **Audio als Blatt-Paket vor MS5.** `@faf/audio` importiert kein Workspace-Paket.
    Manifest-Kategorie `voice` läuft auf dem Bus `alerts`. Loop-Grenzen werden in Sekunden geführt,
    damit Resampling ihre Dauer erhält. Die Dekodierkette lautet native `decodeAudioData`,
    WebCodecs, dynamisch geladener WASM-Opus-Fallback. Eine höhere Priorität verdrängt die leiseste
    niedrigere Stimme, begrenzte Ausblend-Tails leben höchstens 12 ms. Alerts bleiben unräumlich,
    behalten ihre Position aber als Kamerasprungziel. Harte JS-Zeitgrenzen werden ausschließlich
    mit `FAF_AUDIO_PERF_GATE=1` aktiviert. `baseLatency` und `outputLatency` sind Browserfelder,
    keine gemessene Geräte-Reaktionszeit. Automatisierte Browserprüfungen verbinden den realen
    Mixer mit einem MediaStream-Ausgang ohne Lautsprecherverbindung. MS5 liefert echte Event-IDs
    und den FrameReader-Adapter.

36. **FX im Lab qualifizieren und über öffentliche Render-Ports integrieren.** `@faf/render-fx`
    liest den aktuellen Frame-Vertrag und reserviert eigene UBO-/Textur-Bindungen. Partikel,
    Beams/Trails, Schilde, Scorch, HDR/Post und CSM laufen in einer eigenen Lab-Shell ohne Sim.
    MS5/MS7/MS13/MS14 übernehmen Event-Routing, Pass-Reihenfolge, Terrain-Binning und Schatten in
    den Spiel-Renderer. Fehlende GPU-Timer bleiben n/v. Die lokale Auswertung umfasst 40 ruhige
    Originalfälle und zwei unveränderte ruhige Wiederholungen mit expliziter Rohdaten-Herkunft.
    Chromium erreicht im Medium-Gefecht etwa 60 FPS, die gemeldeten Schild- und CSM-Zeiten
    überschreiten ihre Ziele. Diese Messung belegt keine Referenz-iGPU-Abnahme.

37. **Replay-Dateien, lokale Keyframes und getrennte Messprozesse.** `.rtsreplay` speichert
    versionierte Metadaten, Spielsetup, Commands, Regel-/Regions-Hashes und Markierungen im
    geprüften Chunk-Container. Komprimierung verwendet deflate-raw Level 6, mem 4; Keyframes bleiben
    lokale Wiedergabe-Caches. Build, Blueprint-, Karten- und Layout-Identität werden vor dem Start
    geprüft. Der Konverter erhält vollständige Hash-Belege aus `.faflog`; CLI und Player melden
    die erste Abweichung mit Tick und Regionen. Kalt- und Warmläufe verwenden getrennte frische
    Node-Prozesse, der Warmlauf erhält einen vollständigen ungemessenen Durchlauf. Dateicaches
    werden nicht geleert. Aufzeichnung, OPFS-Export und Player sind vorhanden; die Spieloberfläche
    und Wiedergabe unter `/b/<buildHash>/` gehören weiterhin zu MS11.

Detailbelege: [Konsolidierung](status/consolidation.md), [KI](status/track-ai.md),
[HUD](status/track-hud.md), [Editor](status/track-editor.md), [Audio](status/track-audioeng.md),
[FX](status/track-renderfx.md), [Replay](status/track-replay/p6.md).

## Nachtrag 2026-09-30 – Vorarbeits-Track TRACK-EDITOR (Marker-Editor, M12 vorgezogen)

Nummerierung `TE-n`, damit parallele Tracks nicht kollidieren. Details: `docs/status/track-editor.md`.

- **TE-1 Prop-Felder als Kartenchunk `PFLD`:** optional, zwischen `PROP` und `PREV`; Felder (Kreis/Polygon, Art
  tree/rock/wreck, 1–16 Blueprint-IDs mit Gewicht, Dichte je 1024 WU², u32-Seed, Skalierung ‰, max. Neigung ‰, dryOnly,
  Reclaim Masse/Energie in Milli je Prop). Fehlt der Chunk, bleibt die Datei bytegleich. Zusatzgrenzen: 256 Felder,
  64 Polygonpunkte, `MAP_MAX_FIELD_CELLS = 2^21`, Props gesamt ≤ `MAP_MAX_PROPS`.
- **TE-2 Hash-Regel und Algo-Version (Review-Korrektur):** Die Version des Expansionsverfahrens steht **in der
  Datei** (PFLD-Kopf `u16 algoVersion | u16 fieldCount`, im Modell `RtsMap.propFieldAlgo`), nicht nur als
  Code-Konstante. Der Leser kennt die Liste `PROPFIELD_ALGO_VERSIONS` und lehnt andere Versionen ab (`bad-value`);
  die Expansion wählt das Verfahren nach der gespeicherten Version; neue Felder bekommen `PROPFIELD_ALGO_VERSION`.
  Ein geändertes Verfahren wird eine **neue** Version, alte Versionen bleiben implementiert – vorhandene Karten
  expandieren dadurch nie stillschweigend anders. `mapSimBytes` hängt nur bei nicht leeren Feldern
  `'PFLD' | propFieldsSimBytes` an (PFLD-Layout inkl. gespeicherter Version, ohne Namen); der Feldname ist hash-neutral.
  Algo v1 (globales Zellgitter `isqrt(2^34/Dichte)`, `rng32`-Kandidaten, Wassertest, Zellneigung nach TE-7) liegt in
  `@faf/formats` unter dem Determinismus-Lint. Der Editor behält die Version der geöffneten Karte bei jeder Änderung bei.
- **TE-3 three.js im Editor statt `packages/render`:** Tool-Code nach PLAN §3.2; unabhängig vom parallel umgebauten
  Spiel-Renderer, eigene Overlays und exaktes Picking gegen `sampleHeightRaw`. depcruise erlaubt `apps/marker-editor/src`
  nur formats, fixed, rules, protocol, three, preact, @preact/signals.
- **TE-4 Validierungsschwellen:** Spot-Rand 12 WU (DECISIONS 29), Start-Rand 16 WU; Spot flach: > 0,5 WU Höhenunterschied
  im Radius 1,5 WU = Fehler, > 0,1 WU im Radius 3 WU = Warnung; Spot-Abstand < 2 WU Fehler / < 4 WU Warnung; Spot–Start
  < 4 WU Fehler; Start–Start < 48 WU Fehler / < 96 WU Warnung; Bauplatz ≥ 50 % passierbare Zellen im Radius 8 WU;
  Erreichbarkeit über die Land-Passierbarkeit des Spiels (TE-7, Größenklasse 1); Feld-Props frei ≥ 2 WU um Spots,
  ≥ 8 WU um Starts. Die vier bestehenden Karten liefern damit 0 errors.
- **TE-5 Editor-E2E nicht in `ci:local` bis zum Merge:** `pnpm test:e2e:editor` läuft separat (eigener Preview-Server,
  Port `FAF_E2E_PORT`/4783); der Merge-Schritt ergänzt `ci:local`.
- **TE-6 Prop-Blueprints und Reclaim-Defaults sind Platzhalter:** Editor-Template referenziert `core:tree_01`,
  `core:rock_01`, `core:wreck_01` (Baum 25 E, Fels 10 M, Wrack 30 M je Prop, Dichte 64, Neigung 600 ‰, dryOnly);
  Blueprints und Balancing folgen in MS8/E8.
- **TE-7 Eine Land-Passierbarkeit für Nav, Editor und Prop-Felder (Review-Korrektur):** Die Zellregel steht jetzt in
  `@faf/rules` (`terrain.ts`, additiv): `LAND_MAX_CELL_SLOPE_RAW = 3072` (0,75), `landCellSlopeRaw` (max − min der
  4 Eckhöhen einer 1-WU-Zelle) und `isLandCellBlocked` (Kartenrand, Neigung, Tiefwasser in Zellmitte) – identisch zu
  `NAV_LAND_MAX_SLOPE_RAW`/`cellSlopeRaw`/`terrainCell` der MS3-Nav. Der Editor rechnet Erreichbarkeit auf diesen
  Zellen mit Clearance je Größenklasse und 8-Nachbarschaft ohne Eckenschneiden wie die Nav; die Prop-Feld-Expansion
  prüft `maxSlope` gegen dieselbe Zellneigung (vorher drei Varianten: Editor-Gradient 0,6, Nav-Zelle 0,75,
  Expansions-Zentraldifferenz). Der Editor importiert `@faf/nav` weiterhin nicht (Regel `marker-editor-deps`
  unverändert); `rules` ist der gemeinsame Ort. Paritätstest `apps/marker-editor/test/validate/nav-parity.test.ts`
  vergleicht Passierbarkeit, Clearance und Komponentenlabels aller 3 Klassen auf den 4 Karten mit der Nav
  (über `FAF_NAV_SRC` gegen den MS3-Worktree: 0 Abweichungen; nach dem Merge automatisch gegen `packages/nav`).
  Übergabe an den Merge: `packages/nav/src/static.ts` soll `landCellSlopeRaw`/`LAND_MAX_CELL_SLOPE_RAW` aus `rules`
  verwenden statt eigener Kopien.
- **TE-8 Marker gehören dem Editor, Terrain dem Generator (Review-Korrektur):** `markers.json` bleibt Ausgabe der
  Generatoren (`mapgen*.ts` schreiben sie bei jedem `pnpm maps` neu). Der Editor exportiert zusätzlich
  **`editor.json`** (Starts, Spots in Kartenreihenfolge, Prop-Felder, `propFieldAlgo`) für
  `content/maps/src/<name>/editor.json`; kein Skript schreibt diese Datei. `mapc` (`compileMapSource`, `--overlay`)
  ersetzt damit Starts/Spots/Felder aus `markers.json` vor dem Kompilieren. Editor-Änderungen überstehen so jede
  Regeneration. Dazu kann `markers.json` Spots jetzt optional als geordnete Liste `spots: [{kind, x, z}]` statt
  `mass`/`hydro` führen (additiv).
- **TE-9 Test-Hook ohne eigene SHA-256:** `window.__editor.exportHash()` liefert xxHash32 (`@faf/fixed`) der
  Export-Bytes; die zweite SHA-256-Implementierung und die Demo-Seiten (`overlay-demo.html`, `ui-preview.html`) sind
  entfernt, `vite build` baut nur noch `index.html`.
- **TE-10 Buchstabenkürzel nach Zeichen, nicht nach Tastenposition (Review-Korrektur):** Z/Y/S/O/F/G im Editor
  werden über `KeyboardEvent.key` zugeordnet, `code` ist nur Rückfall für nicht-lateinische Layouts. Auf QWERTZ
  (Taste „Z“ meldet `code = 'KeyY'`) macht Strg/⌘+Z damit rückgängig statt wiederherzustellen. Ziffern, Entf, Esc,
  Enter bleiben positionsbasiert (`code`).
