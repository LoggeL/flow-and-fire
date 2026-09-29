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
