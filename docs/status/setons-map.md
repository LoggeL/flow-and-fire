# setons-map – Karte „Setons“ (1.024 WU, 8 Starts) als Standardkarte

Stand 2026-09-29 (nach MS2). Grundlage: `content/maps/src/setons.spec.md` (Layout-Spezifikation nach *Seton's
Clutch*, [B]/[V]/[S]-markiert), DECISIONS „Erste Karte: Setons“ und 22–24. Messwerte lokal auf Apple M5 Pro
(Node 24, Playwright headless) – kein iGPU-/GPU-Runner (DECISIONS 5).

## Umgesetzt

| Bereich | Inhalt | Ort |
|---|---|---|
| Generator | `mapgen-setons.ts`: deterministisch (nur IEEE-exakte Operationen + `rng32`-Lattice-Rauschen), exakt punktsymmetrisch; ≈ 0,6 s; über `pnpm maps` (Registry `GENERATORS` in `mapgen.ts`) | `packages/formats/scripts/mapgen-setons.ts` |
| Quellen | `heightmap.png` (1.025², u16), `splat-0.png`/`splat-1.png` (256², RGBA8, 8 Layer), `markers.json` (8 Starts, 108 Mass, 8 Hydro, 72 Fels-Props) | `content/maps/src/setons/` |
| Karte | `setons.rtsmap` 2.698.440 B, SHA-256 `110bd0d6…823c`, mapSimHash **`0x52eccf92`** (Golden, seit Review-Runde 2; R1 `0x21fdf253`, davor `0x4ccc0005`), simId im Spiel `0x049b1605` | `content/maps/setons.rtsmap`, Asset `maps/setons.110bd0d6.rtsmap` |
| Standardkarte | `DEFAULT_MAP = 'setons'`; `?map=hollow-ridge`, `?map=testplane` weiter erreichbar; Spieler bei Start 0 (SW-Mid 354/678), Gegner bei Start 1 (NO-Mid 670/346), Kamera startet über der eigenen Basis | `apps/game/src/params.ts` (Rest unverändert: `startLayout`, `PLAYER_ARMY`/`ENEMY_ARMY`) |
| Tests | Kartenvertrag (Kopf, Symmetrie, Wasseranteil, Start-Mex/Basisflächen, Spots flach+trocken, Konnektivität nur über die Brücke, Brückenbreite, Inseln, Klippen), Frische (mapgen == Quellen, mapc == `.rtsmap` bytegleich), Golden `setons-bridge-move`, Content-/Loading-/Params-Tests, E2E `setons` | `packages/formats/test/{setons,mapc}.test.ts`, `tools/headless/{src/scenarios.ts,goldens/setons-bridge-move.json}`, `apps/game/test/*`, `test/e2e/setons.spec.ts` |

## Layout (Umsetzung der Spezifikation)

| Spec | Umsetzung | Ist-Wert (Test) |
|---|---|---|
| §3 Seen, Buchten, Teiche | Uferpolygone (Chaikin ×3 in Eckpunktform, Randpunkte 60 WU über den Rand bleiben fest), Signed Distance mit antisymmetrischem Domain-Warp (15 WU, an der Brücke 3 WU) plus feinem Uferrauschen (±3–6 WU, R2); Polygonkanten jenseits der Kartenkante zählen nicht als Ufer (Tiefe wächst bis an den Rand); Buchten als Halbellipsen (R2), Teiche als verformte Kapseln (Domain-Warp 7 WU) bis 1,5 WU tief | Wasseranteil **56,1 %** (Spec ≈ 57 %), Raster 64² zu **96,7 %** deckungsgleich mit der Referenz (R1: 97,1 %) |
| §3.2 Tiefen | Profil über die Uferdistanz: Saum 0–4 WU auf 19,4, Schelf (Breite 20 WU an Rock-Küsten … 70 WU an Beach/Brücke) auf 16, Mittelwasser 11, Tiefe 6 ± 2 plus gewellter Boden (± 1,4); Zusatzsenken im Schelf | Tiefste Stelle 4,4 WU (Wasser 20), Kartenecken ≥ 12 WU tief |
| §4.1 Höhen | Land 20 → 26 über 70 WU + Hügel (Hauptwellenlänge ≈ 100 WU, Kammanteil, nach oben verschoben; Brücke und Basen flach), Rock-Umfeld zerklüftet; Basisflächen r 40 ± 8 (verrauscht) flach (26,5–29,5) mit 52-WU-Rampe nur auf Land, Spot-Pads r 4 (Blend bis 16) | Landhöhen p25–p75 **24,7–31,6 WU**, Steigung p50 **0,12** (vorher 24,8–28,9 / 0,056), Pads ±0,008 WU |
| §4.2 Fels/Gebirge | Eckgebirge: Kapsel-Grundriss (Smooth-Min, verrauschter Rand), darin Kamm-Rauschen (3 Oktaven), zum Kartenrand höher, gestufte Flanken (Vorberge ≲ 0,7, Hauptmassiv ≳ 1,5); Rock-Felsfeld aus 5 zerklüfteten Rippen (verjüngte Enden, Kamm-Grat) plus niedrige Kuppen dazwischen; Felsgruppe an der Buchtspitze aus 4 flachen Brocken | Gebirge bis 77,8 WU, Klippe z 110: 1,88; Durchgänge zu den Fels-Mex ≥ 13 WU; Brocken ≤ 7,1 WU über Wasser (gegated) |
| §5 Landbrücke | einzige Landverbindung; flach (≤ 0,3) | engste Stelle **76,4 WU** (R1: 72,1), ≈ 120–150 WU auf zusammen ≈ 230 WU der Brückenachse (beidseits der Engstelle); ohne Brücke getrennt (gegated) |
| §6 Inseln | Plateau 40 WU aus verrauschter Ellipse (Ausbuchtungen ±12–15 WU, R2), Klippenring 6–12 WU breit mit variierender Oberkante, Felskuppen, Unterwasser-Sockel, keine Rampe | 5 Mex je Insel, per Land unerreichbar (gegated) |
| §7–§9 Starts/Spots | NO-Werte der Spec, SW = Spiegelung; Rand-Mex (x = 1.016) auf 1.012 bzw. 12 gezogen | 8 Starts, 4 Start-Mex je Start, 108 Mass, 8 Hydro |
| §10 Reclaim | nur Fels-Props (`core:rock_01/02`) am Teich, am Felsrücken, an der Felsgruppe und am Gebirgsrand; Wracks/Bäume fehlen (keine Prop-IDs, M-Props ab MS8) | 72 Props |
| Farben | Gemalte Verteilung ersetzt den Auto-Splat ganz (Ebene 0 R = 1, DECISIONS 26): Oliv-Wiese mit Erde-/Trockengras-Flecken, Moos in Senken und an Nicht-Strand-Ufern, Sand nur als ≤ 9-WU-Saum an den Beach-Küsten (NO x 0,50–0,62, z < 0,30 + Spiegel), Seeböden Schlamm (Erde/Moos/dunkler Fels), Erde auf Basen (verrauschter Rand) und Brücke, Fels an Steilflächen, Rippen, Brocken und Gebirge, Hochland auf Graten, Inseloberseite teils felsig; Ebene 0 hält eine 4-Layer-Näherung für Low | 362 Sand-Texel (16 WU²) an Land, 0 außerhalb der Beach-Küsten (gegated) |

## Messwerte (E2E `setons`, Chromium, Preset Medium, 1280×720)

Gegated (maschinenunabhängig): Kartenidentität, 8 Starts/108 Mass/8 Hydro, Kamera über Start 0, 1.000 eigene Würfel
im Umkreis ≤ 45 WU, Frame-y == CPU-Höhe, alle vier Kartenecken bei maximalem Zoom im Bild, Terrain 1 Draw, Draws ≤ 50,
Gesamtansicht = 1.024 Patches. FPS/Ladezeit nur mit `FAF_PERF_GATE=1` (DECISIONS 16).

| Lauf | Laden (Nav → ready) | rAF-Leerlauf | Gesamtansicht FPS / GPU p50–p95 | Herauszoomen Basis → Gesamt | Kameraflug 8 s | Main-JS p95 |
|---|---|---|---|---|---|---|
| Chromium, einzeln, unbelastet (SAB / Transfer) | 361 / 230 ms Wand | 60 Hz | **60,1 FPS**, GPU 3,3–5,6 / 6,4–6,5 ms | 60,1 FPS, GPU 3,1–4,3 / 6,1–6,4 ms | 60,0 FPS, GPU 1,3 / 3,7–4,6 ms | 0,38–0,50 ms |
| Chromium, voller E2E-Lauf unter Fremdlast | 298–447 ms (122–224 ms) | 40–46 Hz | 41,6–44,3 FPS (≥ 0,95 × rAF), GPU 18–22 / 47–60 ms | 42–53 FPS | 49–59 FPS | 0,30–0,40 ms |
| Firefox (SAB / Transfer) | 410 / 294 ms (212 / 181) | 84 / 120 Hz | 84,7 / 120,0 FPS | 119,6 / 120,1 FPS | 120,1 / 119,1 FPS | 0,44 / ≤ 1,0 ms (1-ms-Uhr) |
| WebKit (SAB / Transfer), unter Fremdlast | 487–620 / 282 ms (233–261 / 143) | 30–34 Hz | 31–37 FPS (≥ rAF-Takt) | 38–44 FPS | 49–52 FPS | 0,36–0,38 / ≤ 1,0 ms |

`map-load` (Standardkarte, 2,7 MB): kalt 235–540 ms, aus dem Cache 160–216 ms (alle 6 Kombinationen, 0 Netz-Bytes im
Cache-Lauf). Die Fremdlast (u. a. ein laufendes Spiel des Nutzers) drückte den rAF-Leerlauftakt in Chromium auf
40–46 Hz und in WebKit auf 30–34 Hz; die Setons-Bildrate lag dabei immer auf dem verfügbaren rAF-Takt. Ohne
Fremdlast (erster Einzellauf) 60 FPS in allen drei Szenen bei GPU ≤ 6,5 ms p95.

Weitere Läufe: `pnpm test:xengine` 100/100 Hash-Ketten (5 Szenarien × 4 Engines, `setons-bridge-move` kalt
Node/Browser 168–238 ms); E2E komplett 113 bestanden, 4 übersprungen (Pointer Lock headless), 11,3 min.

## Abweichungen / bekannte Grenzen

- Der flache Schelf ist bewusst **nicht** begehbar (Spec §12 offen); die begehbare Brückenbreite zählt den 0,5-WU-
  Saum mit.
- Wracks, Bäume und Unterwasser-Wracks fehlen (keine Prop-Blueprints vor MS8); nur Fels-Props.
- Ohne Pathing (MS3) fahren Einheiten geradeaus: Mid ↔ Mid über die Brücke funktioniert direkt (Golden
  `setons-bridge-move`), andere Starts brauchen Wegpunkte um die Seen.
- `map-load` misst jetzt die Standardkarte Setons (2,7 MB statt 0,6 MB) mit den MS2-Grenzen ≤ 8 s / ≤ 3 s.
- Keine Terrain-LOD: Gesamtansicht zeichnet alle 1.024 Patches (≈ 2,1 Mio. Dreiecke); auf dem M5 Pro unkritisch,
  für iGPU erst mit M11 (MS14).

## Review Runde 1 (Optik) – Behebung

Grundlage: Mängelliste Runde 1 (Screenshots gegen das öffentliche Vorschaubild, Layout war schon passend). Änderungen
in `packages/formats/scripts/mapgen-setons.ts` (Karte neu erzeugt) und im Render-Paket (gilt für alle Karten).

| Punkt | Behebung | Ort |
|---|---|---|
| P1-1 Wasser fast schwarz | Volle Tiefenfarbe pro Karte (85 % der tiefsten Stelle, 3–13 WU; Setons 13 WU), drei Stufen türkis (0,35/0,75/0,8) → blau (0,1/0,4/0,65) → tiefblau (0,05/0,18/0,42), Flachwasser α 0,55, leichtes Tiefenrauschen; Seeboden gewellt | `render/src/passes/water.ts`, Generator `lakeBed` |
| P1-2 Moiré | Wellen auf der Weltposition (unregelmäßige Richtungen, inkommensurable Wellenlängen 2,1–12,7 WU statt gemeinsamer 32-WU-Periode), Ausblendung je Welle ab Footprint > λ/16…λ/6, Böen-Rauschen, ruhigeres Fernfeld, Fresnel überwiegend von der Mittelfläche, Glanz Exponent 40 statt 96 und 0,06–0,2 statt 0,8; Medium 6 statt 4 Wellen | `water.ts` |
| P1-3 Sand überall | Unter Wasser Schlamm statt Sand; gemalte Verteilung deckt den Auto-Splat samt Uferband ganz ab; Sand nur an den Beach-Küsten, ≤ 9 WU breit; Brücke/Teiche/Rock-Küsten Gras/Moos bis ans Wasser | Generator `splatWeights`, DECISIONS 26 |
| P1-4 Medium nur Ebene 0 | Medium 8 Layer; Gras oliv (0,28/0,33/0,16), Moos/Trockengras/Fels angepasst | `render/src/presets.ts`, `terrain/glsl.ts`, DECISIONS 25 |
| P1-5 Kachelmuster/Streifen | Albedo: domain-gewarptes 5-Oktaven-Rauschen, weniger Kontrast, keine Sinus-Strata/-Rippel mehr (Test: Kontrast < 12 %, keine Zeilen-/Spaltenstreifen); zweite Kachel (gedreht um atan(1/3), √10/4 skaliert) per Makro-Rauschen gemischt; Triplanar an Steilflächen | `terrain/glsl.ts`, `passes/terrain.ts` |
| P2-1 Tafelberge | Kamm-Rauschen, zum Rand höher, gestufte Flanken, Smooth-Min der Kapseln (keine Knickkante) | Generator `mountainAdd` |
| P2-2 Rock-Buckel | 5 zerklüftete Felsrippen + niedrige Kuppen, Fels-Splat über weiche Masken (keine Pixelkante) | Generator `ribAdd`, `ROCK_RIBS_NO` |
| P2-3 Felsgruppe | 4 breite, flache Brocken (≤ 5,5 WU + Rauschen), Fels-Splat auch oben | Generator `boulderAdd` |
| P2-4 Klippen dunkel/gestreift | Fels/dunkler Fels heller, Triplanar, Inseloberseite teils felsig/Hochland | `glsl.ts`, Generator |
| P2-5 flaches Hinterland | Hügel mit ≈ 100 WU Hauptwellenlänge und Kammanteil, Brücke/Basen flach gehalten | Generator `hills` |
| P2-6 Kreis-Stempel | Basisradius verrauscht (40 ± 8), Rampe 52 WU nur auf Land; Erde-Maske mit verrauschtem Rand und 40-WU-Übergang | Generator `flattenBases`, `splatWeights` |
| P2-7 Kartenrand | Wasserfläche endet an der Kante (`WATER_BORDER_WU = 0`), Terrain und Wasser dunkeln über 24 WU zur Kante ab | `water.ts`, `passes/terrain.ts` |
| P3-1 Hantel-Teiche | Kapseln mit Domain-Warp, Ausläufer nach Westen, bis 1,5 WU tief (überwiegend Wasser) | Generator `pondDist` |
| P3-2 Seen am Rand flacher | Polygonkanten jenseits der Kante zählen nicht als Ufer; Chaikin lässt Außenpunkte fest (vorher schnitt die Rundung die Kartenecken ab: Mini-Landecke) | Generator `Poly`, `polyWu` |
| P3-3 Spots unsichtbar | Decal-Mindestgröße in Pixeln (Mass ≥ 4 px bis 9 WU, Hydro ≥ 6 px bis 14 WU), Linien ≥ 2 px; Hydro als Raute | `terrain/decals.ts`, `passes/terrain.ts`, `client/src/map.ts`, DECISIONS 28 |

Tests: Setons-Vertrag erweitert (Tiefe am Rand, Relief, Felsfeld-Durchgänge, Brocken-Höhe, Sand nur an den
Beach-Küsten, Auto-Splat abgedeckt), Render-Tests (Albedo ohne Streifen, GLSL-Bausteine, Wasser-Tiefenfarbe,
Decal-Packing/Binning), E2E-Hydro-Stichprobe auf der Raute. Golden `setons-bridge-move` neu (nur Karten-Identität,
kein SIM_BUILD-Bump). Screenshots (Chromium `--use-angle=metal`, 1.600 × 1.000, Medium/High) lagen während der
Arbeit nur lokal im Scratchpad.


## Review Runde 2 (Politur Wasser/Nahansicht/Inseln) – Behebung

Grundlage: Mängelliste Runde 2 (keine P1 mehr offen). Änderungen im Generator (Karte neu erzeugt, Golden
`setons-bridge-move` neu, kein SIM_BUILD-Bump) und im Render-Paket (gilt für alle Karten). Kontrolle mit
Screenshots (Brave headless, `--use-angle=metal`, 1.600 × 1.000, Medium/High; Playwright-Chromium war in diesem
Lauf nicht installiert) und dem Analyse-Skript der Runde (Raster, Brücke, Relief).

| Punkt | Behebung | Ort |
|---|---|---|
| P2-1 Tiefwasser einfarbig | Volle Tiefe = tiefste Stelle (max. 16 WU; Setons 15,6), Tiefblau erst ab 55 % (`smoothstep(0.55, 0.95)`), Tiefblau (0,055/0,19/0,36); Rauschen jetzt multiplikativ auf die Farbe (±22 %) plus leichte Petrol-Tönung statt auf f (war bei f = 1 wirkungslos; `terrainValueNoise` liefert schon −1..1). Gesamtansicht: Wasserpixel tief/mittel/hell 48/39/13 % (Referenz 52/39/9 %, eigene Klassifikation; vorher 65/23/12), Tief-Median RGB (17, 59, 99) gegen Referenz (17, 58, 96) | `render/src/passes/water.ts` |
| P2-2 Schaum-Perlenkette | Schaum aus zwei driftenden Rauschoktaven (6 und 2,3 WU) statt Sinusfeld, Anteil 0,6 | `water.ts` |
| P2-3 Nahansicht verwaschen | Albedo-Kontrast ≈ ±25 % (σ/Mittel 0,10–0,13 statt 0,05, Gewicht auf 0,25–1-WU-Körnung); Detail-Normal aus zwei Rausch-Oktaven (Zellen 0,45/1,3 WU, analytischer Gradient `terrainValueNoiseD`) nur für die Beleuchtung, an Steilflächen stärker; Splat-Übergänge per Rauschmaske geschärft (`terrainSharpenWeights`, Zellen 4/1,6 WU, Band 0,3). Beides blendet nach Pixel-Footprint aus (Gesamtansicht unverändert) | `terrain/glsl.ts`, `passes/terrain.ts` |
| P2-4 Ufer polygonal | Chaikin ×3 statt ×2 und feines, symmetrisches Uferrauschen (Zellen 11/6 WU, ≈ ±3–6 WU) auf die Signed Distance; keins im Umkreis der Starts, an der Brückenenge halbe Amplitude + 2,5 WU Landzuschlag | Generator `waterAt`/`shoreNoise`, `polyWu` |
| P2-5 Randbucht rechteckig | Bucht als Halbellipse (40 WU tief, ±31 WU breit, 15°-Schritte) mit Uferrauschen, Bett mit Rauschen (±3 WU) | Generator `BAY_O`/`bayPoly`, `lakeBed` |
| P2-6 Inseln als Tortenstücke | Umriss mit Ausbuchtungen (Rauschen ±12–15 WU, Wellenlänge ≈ 50 WU), Mex behalten ≥ 20 WU Plateau; Klippe 6–12 WU breit, Oberkante ±3 WU, zerklüftete Wand; niedrige Felskuppen oben; Oberseite überwiegend Fels/Hochland/dunkler Fels, Gras (verrauscht) nur um die Mex | Generator `islandEdge`/`islandHeight`, `splatWeights` |
| P3-1 Randabdunkelung | 10 statt 24 WU und vor den Decals angewandt (Spots nie abgedunkelt); alle Spots ≥ 12 WU vom Rand (Test) | `passes/terrain.ts`, `water.ts` |
| P3-2 Treppige Felskanten | Fels-/Gebirgs-/Brocken-Höhen vor dem Addieren und Quantisieren mit [1 2 1]² weichgezeichnet (1 Durchgang) | Generator `blur121` |
| P3-3 Wasser mittlere Entfernung | Böen-Ausblendung erst ab 200 WU (auf 40 % bis 600 WU), breiter schwacher Glanz von der Mittelfläche, dezente Wellenschattierung (±5 %) | `water.ts` |
| P3-4 Props/Wracks | außerhalb des Umfangs (Prop-System) | – |

Ist-Werte: Wasser 56,1 %, Raster 64² zu **96,7 %** deckungsgleich (vorher 97,1 %), Brücke engste Stelle **76,4 WU**
(Test 70–80), Starts eben, Pads ±0,008 WU, Steigung p50 0,13, Gebirge bis 77,3 WU (Klippe z 110: 1,84), Insel-Mitte
39,6 WU, Sand-Rasterzellen 26 (Referenz 37). Neue Tests: Insel-Umriss weicht entlang 13 Strahlen um ≥ 12 WU von der
Ellipse ab, alle Spots ≥ 12 WU vom Rand, Kantenabdunkelung ≤ 10 WU, Albedo-Kontrast 0,08–0,18, Wasser-Volltiefe.

Leistung (Brave headless, Metal, 1.600 × 1.000, GPU unbelastet, A/B im selben Lauf mit abgeschalteter Detail-
Normal/Schärfung): Gesamtansicht 60 FPS, GPU p50 5,9–6,3 ms (Medium) / 6,3–7,5 ms (High) gegen 6,1–6,5 / 7,1–8,3 ms
ohne; Kameraflug 60 FPS, GPU p50 3,7–5,0 ms gegen 3,6–4,0 ms. Main-JS p95 ≤ 0,47 ms. Kein messbarer Mehraufwand in der
Gesamtansicht (Detail per Footprint aus), in Nahansichten innerhalb der Streuung.
