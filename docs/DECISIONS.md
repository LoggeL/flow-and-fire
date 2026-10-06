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

## Nachtrag 2026-09-29 – SPK2 und Blueprint-Format (MS3)

22. **SPK2 Bewegungsgefühl → Steering ohne RVO/ORCA bleibt; Parametersatz `SPK2_PARAMS` fixiert.**
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

23. **Blueprint-Format MS3: sim.bin v2, view.json v2, iconThreshold, Größenklassen-Regel.**
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

## Nachtrag 2026-09-30 – SPK3 mit Sim-Integration und MS3-Headless-Abnahme (ms3-p5)

24. **SPK3 Pathing realistisch → HPA\* bleibt Standard, Budget 20.000 Expansionen/Tick, Korridor-Schnitt-Repath
    bestätigt; die Abbruchvariante „Invalidierung beim Chunk-Eintritt + Lazy-Repair“ wird nicht eingeführt.**
    Gemessen mit `pnpm bench:spk3` (Sim) und `pnpm bench:ms3` (Szenarien 3/4) auf den generierten
    `bases`-Karten mit 512/1.024 WU (Klippen-Plateaus mit Rampen, Fluss mit Furten, Gratlücken, FA-typische Basen als
    Footprints) und hollow-ridge. **Lokal gemessen, Apple M5 Pro, Node 24.18, Fremdlast (Load 5–7); Wertebereiche über
    2–3 Läufe; Tabellen in `docs/status/ms3-p5-bench.md`.**

    | Messung | Ergebnis |
    |---|---|
    | 200 Einzelanfragen gleichzeitig im Sim, 1.024 WU mit 381 Basis-Footprints | alle Ready nach **7 Ticks** in jedem Lauf (Kriterium ≤ 10); Phase PathService warm p50 2,9–4,0 / **p95 3,3–4,7** / max 4,2–5,4 ms (Kriterium p95 ≤ 5 ms), JIT-kalt p95 6,9–11 ms; Expansionen je Anfrage p50 555 / p95 1.609 / max 2.944 (8 % ≤ 100, 70 % 101–1.000, 22 % 1.001–3.000, keine > 3.000); 132.266 Expansionen gesamt |
    | dasselbe auf 512 WU / hollow-ridge | 5 bzw. 6 Ticks, PathService p95 3,0–4,3 bzw. 3,4–4,0 ms |
    | Gruppenbefehl mit 50 Units | `requestsIssued` genau +1, ein gemeinsamer Pfad |
    | Repath-Sturm (200 fahrende Units, 20 Footprints) | markierte Pfade == Brute-Force-Korridorregel: hollow-ridge 179, 1.024 WU 85 (0 falsch-positiv/-negativ, keine sonstigen Korridor-Repaths) |
    | Basisbau im Sim (200 Panzer unterwegs, alle 10 Ticks ein Footprint 3×3…8×8 wenige WU vor einer fahrenden Unit, 3 min) | 1.024 WU: 3,8 Korridor-Repaths je Footprint (p95 10, max 30) = 216/min, Stuck-Anfragen 6,7/min, 0 Aufgaben; 512 WU: 6,8 je Footprint = 333/min, Stuck 26/min, 1,7 Aufgaben/min; PathService p95 0,36–0,55 ms, max 5–9,5 ms (Ticks mit vielen Repaths, im Budget) |
    | Gefecht im Sim (2 × 100 Panzer tauschen die Plätze durcheinander hindurch, 5 min) | Stuck-Anfragen 13,8/min (1.024) bzw. 33/min (512), Stau-Episoden > 3 s 4,8 bzw. 12,6 je Minute, längste Pause max 47–61 Ticks, kein Deadlock, PathService p95 < 0,01 ms |
    | Korridor-Schnitt vs. Chunk-Eintritt + Lazy-Repair (Nav-Ebene, 200 Mover à 2,5 WU/s, alle 10 Ticks ein Footprint vor einem Mover, 3 min, gleiche Stempel- und Zielfolge) | **Korridor:** 646 (1.024) / 698 (512) Repaths, alle notwendig, Latenz 0, 0 Fahrten auf einem geschnittenen Stück. **Variante:** 458 / 725 Repaths, davon **21 % / 35 % unnötig** (Chunk geändert, Pfad aber nicht geschnitten), Latenz Schnitt → Repath p50 10–11 s, p95 54–79 s, **146 / 151 Lazy-Repairs** (Mover fuhr gegen das neue Hindernis, im Spiel ein sichtbarer Stopp), Expansionen −16 % / +4 %, Stempelkosten gleich (p50 0,6 ms; der Korridor-Check kostet im Stempel praktisch nichts) |

    Entscheidungen:
    - **HPA\* ist Standard** (PLAN §3.8) – bestätigt; M6 bleibt unverändert, kein Flow-Field-Zwang für Einzelanfragen.
    - **Budget-Konstante** `NAV_BUDGET_EXPANSIONS_PER_TICK` = `PATH_BUDGET_EXPANSIONS` = **20.000** bleibt (7 Ticks für
      den 1.024-WU-Burst, p95 unter 5 ms auf M5 Pro auch unter Fremdlast). Ergibt eine Messung auf dem Referenz-Laptop
      p95 > 5 ms, ist **15.000** der nächste Schritt (9 Ticks für die 132.266 Expansionen des Bursts, Kriterium ≤ 10
      bleibt erfüllt); das ist eine reine Konstantenänderung (neuer `SIM_BUILD`, Goldens neu).
    - **Repath-Strategie: Korridor-Schnitt** (Rückindex Sektor → Pfade, exakte Regel aus ms3-p0) bleibt. Kein
      Repath-Sturm: Repaths entstehen nur für geschnittene Pfade, sofort im selben Tick, ohne Fahrt gegen das
      Hindernis. Die Abbruchvariante spart nur scheinbar Arbeit (sie verschiebt Repaths, bis die Einheit den Chunk
      erreicht) und kostet unnötige Repaths und sichtbare Stopps. Sie existiert nur im Bench
      (`Nav.corridorRepath = false`, Setup-Option, kein State; die Sim setzt sie nie).
    - Konsequenzen: kein IndexedDB-Cache für den Nav-Precompute (unverändert ms3-p0); MS4-Gebäude nutzen
      `stampFootprint` mit der Korridorregel direkt; Stuck-Anfragen im Gedränge (Gefecht 14–33/min) sind billig
      (meist Direct/kurz) und bleiben.

25. **MS3-Headless-Abnahme: Messdefinitionen und Szenario-Zuschnitt (`pnpm bench:ms3`).**
    - **„Stuck > 3 s“** = 30 Ticks ohne 0,15 WU Fortschritt auf der Restroute einer Unit (Weg über ihre Wegpunkte bzw.
      Gruppen-Wegpunkte + Offset bis zum Slot), mit der Semantik des SPK2-Prototyps: ändert sich die Route (Pfad fertig,
      Korridor-Repath, Stuck-Repath, Ausweichpunkt, Lazy Refinement ersetzt die Gerade zum nächsten Portal), wird die
      Referenz auf eine längere neue Route angehoben, ohne Fortschritt gutzuschreiben und ohne die Uhr zurückzusetzen;
      ein neuer Befehl startet neu. Wartezeit im Gedränge zählt voll. Ankunft = Order erledigt, ≤ 5 WU vom Slot.
    - **„200 Units über die Karte“** startet wie in SPK2 aus offenem Gelände (hollow-ridge: NW-Tiefland, alle Ziele
      jenseits des Grats über beide Furten, eine 50er-Gruppe auf das SE-Plateau; 1.024 WU: Tiefland, Ziele jenseits des
      Flusses über zwei Furten). Die Variante „Start auf dem Startplateau“ (alle 200 über zwei 8-WU-Rampen, Ziele am
      Rampenfuß) wird nur berichtet (87 %): 200 Einheiten durch zwei Rampen ist eine Engstelle, die Szenario 2 prüft;
      Wartezeiten dort sind Stau, kein Stuck. Die Gratlücken (3–8 WU) der 1.024-WU-Karte gehören ebenso zu Szenario 2.
    - Gegated (immer): Anfahren ≤ 10 Ticks, ≥ 95 % ohne Stuck > 3 s (3 Seeds je Karte), ein Move = eine Anfrage, keine
      Land-Unit auf blockierter Zelle, Engstelle ≤ 600 Ticks ohne Deadlock, 200 Anfragen ≤ 10 Ticks, Gruppe ⇒ +1
      Anfrage, Repath-Gleichheit, End-Hash von Szenario 5 in allen Engines gleich; ms-Budgets nur mit
      `FAF_PERF_GATE=1` (Punkt 16).
    - Sim-Änderungen für die Abnahme (`SIM_BUILD` `faf-sim/ms3.1`, Goldens neu, 160 Hash-Ketten bitgleich): Gruppen-Slots
      hinter einer dünnen Wand/Klippenkante neben dem Ziel werden entlang des Offsets in Clearance-LOS des Ankers
      zurückgezogen (statt der nächsten freien Zelle auf der anderen Seite), verschobene Gruppen-Wegpunkte nur auf der
      Wandseite des Wegpunkts mit Rückfall auf den vorherigen Gruppen-Wegpunkt, und der Hindernisgradient wirkt für
      Klassen 2–3 auch an der Klassengrenze (Clearance < Klasse), an der schwere Panzer sonst ohne Gegenkraft
      verkeilten.
