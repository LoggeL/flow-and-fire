# Layout-Spezifikation „Tessera“ (Skirmish-Karte A, 1v1, 512 WU)

Stand 2026-09-29. Erste Karte des Skirmish-Kartensets für M8/MS9 (PLAN MS9: „1v1 auf 3 Karten“). **Eigener
Entwurf**, kein Nachbau: Layout, Name, Heightmap, Splat und Props sind neu (keine FA-Karte als Vorlage, kein
FA-/FAF-Kartenname). Aufbau wie `setons.spec.md`, Umsetzung später analog zu Setons (Generator
`packages/formats/scripts/mapgen-tessera.ts`, Quellen `content/maps/src/tessera/`, Vertragstest
`packages/formats/test/tessera.test.ts`, E2E `test/e2e/tessera.spec.ts`).

**Name:** „Tessera“ (DE/EN gleich; lat./dt./engl. „Mosaiksteinchen“). Bild der Karte: vier Mass-Spots als Raute
(„Mosaikstein“) in einer flachen Mulde voller Schieferscherben, eingerahmt von zwei Klippenriegeln. **id:** `tessera`.
Anzeige-Untertitel (Menü, optional): DE „Scherbenmulde“, EN „Shard Hollow“.

**Charakter:** offene, klassische Landkarte für Einsteiger. Kurzer, gerader Weg durch die Mitte (≈ 419 WU), zwei
breite Flanken als Umweg (≈ 509 WU), wenige Klippen, die nur zwei Engstellen („Scharten“) und zwei Flankentore
bilden. Kein Wasser auf Wegen, nichts hängt an Marine/Hover.

## 0. Konventionen

- Koordinaten normiert `0..1` bzw. in WU (normiert × 512), **x nach rechts, z nach unten** (Norden oben), wie
  Setons. Heightmap 513 × 513 (1 Pixel = 1 WU), alle Spot-Koordinaten ganzzahlig in WU.
- **Army 0 = SW** (unten links), **Army 1 = NO** (oben rechts). Kanonische Werte sind für SW angegeben.
- Drei Achsen/Abbildungen (alle ganzzahlig in WU):
  - **Punktspiegelung** P: (x, z) → (512 − x, 512 − z) – tauscht die Spieler. **Exakt** für Heightmap, Splat,
    Starts, Spots und Props (wie Setons, Test „exakt punktsymmetrisch“).
  - **Neutrale Achse** x = z (Diagonale NW-Ecke → SO-Ecke). Spiegelung N: (x, z) → (z, x) tauscht ebenfalls die
    Spieler. Jeder Punkt auf ihr ist von beiden Starts gleich weit entfernt.
  - **Basisachse** x + z = 512 (Diagonale SW-Ecke → NO-Ecke, beide Starts liegen darauf). Spiegelung B:
    (x, z) → (512 − z, 512 − x) tauscht die beiden Flanken eines Spielers.
- **Layout ist D2-symmetrisch** (P, N und B): Spots, Klippen, Mulde, Teiche, Props. Das feine Hügel-/Kantenrauschen
  muss nur P-symmetrisch sein (Amplitude klein, ohne Wirkung auf Wege). Damit sind beide Flanken für beide Spieler
  gleich weit und gleich reich (keine „bessere Seite“, wichtig für die KI-Abnahme in MS9).
- Hilfskoordinaten: **u** = (x − z)/√2 (Basisachse, SW-Start u = −209, NO-Start u = +209) und
  **v** = (512 − x − z)/√2 (quer, v > 0 = NW-Flanke, v < 0 = SO-Flanke; Mitte u = v = 0).
- Kanonisches Viertel (für Generator/Props): **W** = {z ≥ x, x + z ≤ 512} (Westkeil, enthält die Westkante); die
  übrigen Viertel entstehen per N, P und B.
- Passierbarkeit: befahrbar = Steigung ≤ 0,6 (PLAN §3.9 `maxSlope`), Ziel auf allen Wegen ≤ 0,3; Klippe =
  Steigung ≥ 1,0 durchgehend (Kern der Riegel ≥ 1,5), wie die Setons-Prüfkriterien.

## 1. Eckdaten

| Merkmal | Wert |
|---|---|
| Größe | `sizeWu` **512** (≈ 10 km), Diagonale 724 WU → Hochofen-Gate (200 WU ≤ 40 % = 290 WU) erfüllt, ≥ 354 WU (DECISIONS Roster 1) |
| Spieler | 2 (1v1), Starts auf der Basisachse, Luftlinie **418,6 WU** |
| Format | `heightScaleRaw` 32, **`waterLevel` 16 WU**, Heightmap 513² u16, Splat 2 × RGBA8 **128²** (4 WU/Texel wie Setons) |
| Mass | **34**: je Spieler 12 sicher (4 Start + 2 Vorfeld + 2 Eckhof + 2 × 2 Flügel), 10 umkämpft (Mitte 4, Flanken 2 × 3) |
| Hydro | **4**: je Basis 1 (hinter dem Start), je Flanke 1 (neutral, auf der Achse x = z) |
| Wasser | nur 2 Quelltümpel (≈ 450 WU² je, ≤ 1 WU tief) neben den Flanken-Hydros, abseits aller Wege; keine Furten nötig |
| Klippen | 2 Klippenriegel (je 2 Segmente, dazwischen eine Scharte 26 WU), 4 Felsnasen (Flankentore), 2 Eckmassive (NW, SO) |
| Reclaim | 61 Fels-Props (`core:rock_01/02`), davon 37 in der Scherbenmulde, ≈ 2.300 Mass (Vorschlag, §9) |
| Wege | Mitte 419 WU (gerade), Flanke 509 WU (+22 %), zwischen den Bahnen je eine Scharte |

## 2. Großlayout

- **Basen** (SW unten links, NO oben rechts) auf flachen, leicht erhöhten Tellern; dahinter zur Kartenecke ein
  sanfter Hang mit Hydro und Eckhof-Mex. Keine Klippen um die Basen – jede Basis ist nach vorn und zu beiden
  Flanken offen (Einsteiger: keine versteckten Umwege, keine Rampen-Fallen).
- **Mittelbahn** entlang der Basisachse: breite Ebene (160 WU zwischen den Riegelfüßen), in der Kartenmitte die
  **Scherbenmulde** (r ≈ 90 WU, 4 WU tiefer als die Ebene, sanft) mit der Mass-**Raute** und dem Scherbenfeld.
- **Zwei Klippenriegel** parallel zur Basisachse bei v = ±95 trennen Mittelbahn und Flanken auf 200 WU Länge. In
  ihrer Mitte (auf der neutralen Achse) je eine **Scharte** (26 WU breit): Abkürzung Mitte ↔ Flanke, klassische
  Engstelle für Riegel I (Reichweite 26) oder einen Punze-Pulk.
- **Zwei Flanken** (NW und SO) zwischen Riegel und Eckmassiv: offene Terrasse mit 3 Mex (Dreieck um die Achse
  x = z) und einem Hydro am Quelltümpel. Jede Flanke ist von beiden Starts gleich weit.
- **Flankentore:** je Spieler und Flanke eine Felsnase neben dem Flügel-Mex-Paar; sie teilt den Weg zur Flanke in
  zwei Durchlässe (40 WU an der Kartenkante, 47 WU zum Riegelende).
- **Eckmassive** in den Neutral-Ecken NW und SO (hinter den Flanken-Hydros, unpassierbar) schließen die Flanken
  nach außen; die Basis-Ecken SW/NO bleiben offenes, bebaubares Hinterland.

### 2.1 Raster 64 × 64 (eine Zelle = 8 WU)

Legende: `0`/`1` Start (Army) · `m` Mass · `H` Hydro · `B` Basisteller (r ≤ 48) · `-` Muldenboden (r ≤ 40) ·
`:` Muldenhang (r ≤ 90) · `R` Klippenriegel · `K` Felsnase · `M` Eckmassiv · `p` Quelltümpel · `*` Fels-Prop ·
`.` Ebene/Hügel (befahrbar). Mass-Paare im selben Rasterfeld erscheinen als ein `m`.

```
      x→ 0         1         2         3         4         5         6
z↓     0123456789012345678901234567890123456789012345678901234567890123
 0     MMMMMMMMMMMM....................................................
 1     MMMMMMMMMMM.....................................................
 2     MMMMMMMMMM......................................................
 3     MMMMMMMMM....*............................................m.....
 4     MMMMMMMM..*.....................................................
 5     MMMMMMM*......................KK.......m....................m...
 6     MMMMMM.pp....................KKK................................
 7     MMMMM*ppp....................KKK.....m............B.............
 8     MMMM..ppp......................................BBBBBBB..........
 9     MMM...........................................BBBBBBBBB.........
10     MM..*........................................BBBBBBBBBHB........
11     M............................................BBBBBmBBBBB........
12     ............H................................BBBBBBBBBBB........
13     ...*.............m..........................BBBBmB1BmBBBB.......
14     ...............................R.............BBBBBBBBBBB........
15     .............................RRRR............BBBBBmBBBBB........
16     ................m...........RRRRR............BBBBBBBBBBB........
17     .............m.............RRRRR..............BBBBBBBBB.........
18     ..........................RRRRR................BBBBBBB..........
19     .........................RRRRR....................B.............
20     ........................*RRRR.............m.....................
21     ........................RRRR:*::*:::............................
22     .........................RR:::::::::::......m...................
23     .........................:*::::::::::::.........................
24     ....................*R..::*:::*::*:::*::...................m....
25     ...................RRRR::::::::::::::::::.......................
26     ..................RRRRR**::::*::::*::::*::...............m......
27     .................RRRRR::::::::--*-::::::::......................
28     ................RRRRR:::::::-----*--:::::::.....................
29     ......KK.......RRRRR.*::::*:-m------:*:::::.....................
30     .....KKK.......RRRR..:::*::------m-*-::*:::.....................
31     .....KKK......RRRR...::::::----------::::::....RR...............
32     ...............RR....*:::::*----*---*:::::*...RRRR......KKK.....
33     .....................:::*::-*-m------::*:::..RRRR.......KKK.....
34     .....................:::::*:------m-:*::::*.RRRRR.......KK......
35     .....................:::::::--*-----:::::::RRRRR................
36     ......................::::::::--*-::::::::RRRRR.................
37     .......m..............::*::::*::::*::::**RRRRR..................
38     .......................::::::::::::::::::RRRR...................
39     .....m..................::*:::*::*:::*::..R*....................
40     .........................::::::::::::*:.........................
41     ..........................:::::::::::RR.........................
42     ....................m.......::::*:*:RRRR........................
43     ...................................RRRR*........................
44     .............B........m...........RRRRR.........................
45     ..........BBBBBBB................RRRRR..........................
46     .........BBBBBBBBB..............RRRRR.............m.............
47     ........BBBBBBBBBBB............RRRRR...........m................
48     ........BBBBBmBBBBB............RRRR.............................
49     ........BBBBBBBBBBB.............R...............................
50     .......BBBBmB0BmBBBB..........................m.............*...
51     ........BBBBBBBBBBB.............................................
52     ........BBBBBmBBBBB.................................H..........M
53     ........BBBBBBBBBBB........................................*..MM
54     .........BHBBBBBBB...........................................MMM
55     ..........BBBBBBB......................................ppp..MMMM
56     .............B..................KKK....................ppp.MMMMM
57     ..........................m.....KKK....................pp.MMMMMM
58     ...m............................KK.......................MMMMMMM
59     ........................m...............................MMMMMMMM
60     .....m.................................................MMMMMMMMM
61     ......................................................MMMMMMMMMM
62     .....................................................MMMMMMMMMMM
63     ....................................................MMMMMMMMMMMM
```

## 3. Höhen (WU, `waterLevel` 16)

| Zone | Höhe | Gestalt |
|---|---|---|
| Ebene (Grundhöhe) | 24 ± 1,8 | sanfte Hügel, Hauptwellenlänge ≈ 90 WU, Steigung p50 0,05–0,10, max. 0,3 auf Wegen |
| Basisteller | **28,0** | flach (±0,1) in r 48 um den Start (umfasst Start-Mex und Basis-Hydro), Rampe r 48 → 88 auf die Ebene (Steigung ≤ 0,12), Rand verrauscht (±6 WU) |
| Basis-Hinterland (Ecke SW/NO) | 28 → 31 zur Kartenecke | Hang ≤ 0,1, Eckhof-Mex auf Pads |
| Scherbenmulde | Boden **20,0** (r ≤ 40), Hang bis r 90 auf 24 | Schüssel, Steigung ≤ 0,1, Hügelrauschen im Boden auf ±0,5 gedämpft |
| Flankenterrasse | 26 | um (u 0 \| v ±190), r 70, 40 WU Übergang; flache Kuppe, trägt Flanken-Mex und Hydro |
| Quelltümpel-Senke | 24 → 16,3 (r 40 → 12), Bett ≥ 15,0 | Hang ≤ 0,3 (befahrbar bis ans Ufer), Wasser ≤ 1,0 WU tief (Land-Hindernis, optisch flach) |
| Klippenriegel | Kamm **+12 ± 2** über Grund (≈ 36) | Kapsel, Kern r 6 (Grat), Flanke r 6 → 13 (Steigung ≈ 1,7), zerklüftet |
| Felsnasen | Kamm **+10** (≈ 34) | runde Kapsel r 14 (Kern r 6), Steigung ≥ 1,2 |
| Eckmassive | Fuß 26 → 50–65 zur Ecke | unpassierbar (Fußband Steigung ≥ 1,2, dahinter Grate), Fußlinie x + z = 100 (NW) bzw. 924 (SO), ±8 WU verrauscht |
| Mex-/Hydro-Pads | lokale Höhe, ±0,01 | r 4 (Mex) bzw. r 6 (Hydro) flach, Blend bis r 16 |

Niedrigster trockener Punkt: Tümpelufer (≈ 16,3). Alle Spots ≥ 3,5 WU über Wasser (Muldenboden 20).

## 4. Klippen, Engstellen, Rampen

Alle Angaben in WU, D2-gespiegelt. Kapsel = Strecke a → b mit Radius (Fuß).

| Element | Lage | Maße | Funktion |
|---|---|---|---|
| **Klippenriegel NW**, Segment SW / NO | (128, 250) → (170, 207) / (207, 170) → (250, 128); Achse v = +95, u −86…−26 / +26…+86 | Fußradius 13, Länge je 60 WU (+ Enden) | trennt Mittelbahn und NW-Flanke |
| **Klippenriegel SO**, Segment SW / NO | (262, 384) → (305, 342) / (342, 305) → (384, 262); v = −95 | wie oben | trennt Mittelbahn und SO-Flanke |
| **Scharte NW / SO** | zwischen den Segmenten, Mitte (189, 189) bzw. (323, 323), auf der neutralen Achse | **26 WU** befahrbar (Fuß zu Fuß), Boden auf Ebenenhöhe, Steigung ≤ 0,1 | Engstelle Mitte ↔ Flanke; von beiden Starts gleich weit |
| **Felsnasen (Flankentore)** | (54, 246) SW-West · (266, 458) SW-Süd · (458, 266) NO-Ost · (246, 54) NO-Nord | r 14 | teilen den Weg Basis → Flanke: Durchlass zur Kartenkante **40 WU**, zum Riegelende **47 WU** |
| **Eckmassiv NW / SO** | Ecke (0, 0) bzw. (512, 512), Fuß x + z ≈ 100 bzw. 924 | ≈ 5.000 WU² je | schließt die Flanke nach außen, Kulisse, Fels-Reclaim am Fuß |

- **Rampen:** keine Plateaus mit Klippenrand. „Rampen“ sind nur die weichen Übergänge Basisteller → Ebene
  (Steigung ≤ 0,12), Ebene → Flankenterrasse und Mulde. Einsteiger können jede Basis-/Flankenfläche von überall
  befahren.
- **Durchgänge (Prüfkriterium):** Mittelbahn zwischen den Riegelfüßen ≥ 150 WU; zwischen Riegel-Außenende und
  Kartenkante ≥ 80 WU (außerhalb der Felsnase); keine Engstelle < 24 WU auf irgendeinem Weg zwischen Spots.

## 5. Wasser

- **Quelltümpel NW** um (62, 62), **SO** um (450, 450): r ≈ 12 WU, leicht verformt (Domain-Warp ≤ 4 WU, D2-
  gespiegelt an der Achse x = z), Bett ≥ 15,0 (≤ 1,0 WU tief → für Land gesperrt, `LAND_MAX_WATER_DEPTH` 0,5).
  Liegen zwischen Flanken-Hydro (48 WU entfernt) und Eckmassiv, **abseits aller Wege**.
- Sonst kein Wasser, keine Furten; `waterLevel` 16 liegt ≥ 4 WU unter jedem Weg. Die Karte bleibt ohne Marine/Hover
  vollständig spielbar (MVP).

## 6. Startpositionen

| Army | Seite | normiert (x \| z) | WU (x, z) |
|---|---|---|---|
| 0 | SW (Spieler im MVP) | (0,211 \| 0,789) | (108, 404) |
| 1 | NO (KI im MVP) | (0,789 \| 0,211) | (404, 108) |

Luftlinie 418,6 WU. Abstand Start ↔ nächste Kartenkante 108 WU. Kamera startet über der eigenen Basis (wie Setons).

## 7. Mass-Spots (34)

### 7.1 Je Spieler (12, sicher), kanonisch SW, NO = Punktspiegelung

| Gruppe | Anz. | SW normiert | SW WU | NO WU | Abstand eig. Start |
|---|---|---|---|---|---|
| Start-Ring („+“, r 16) | 4 | (0,180 \| 0,789); (0,242 \| 0,789); (0,211 \| 0,758); (0,211 \| 0,820) | (92, 404); (124, 404); (108, 388); (108, 420) | (420, 108); (388, 108); (404, 124); (404, 92) | 16 |
| Vorfeld-Paar (Richtung Mitte) | 2 | (0,312 \| 0,656); (0,344 \| 0,688) | (160, 336); (176, 352) | (352, 176); (336, 160) | 86 |
| Eckhof-Paar (hinter der Basis) | 2 | (0,059 \| 0,910); (0,090 \| 0,941) | (30, 466); (46, 482) | (482, 46); (466, 30) | 100 |
| Flügel West (SW) / Ost (NO) → NW- bzw. SO-Flanke | 2 | (0,078 \| 0,617); (0,109 \| 0,586) | (40, 316); (56, 300) | (472, 196); (456, 212) | 111 / 116 |
| Flügel Süd (SW) / Nord (NO) → SO- bzw. NW-Flanke | 2 | (0,383 \| 0,922); (0,414 \| 0,891) | (196, 472); (212, 456) | (316, 40); (300, 56) | 111 / 116 |

Zwischen den Start-Mex je 3 Kraftwerke Platz (Adjacency-Opener, Landwerk I 8 × 8 passt im Teller vor den Ring).

### 7.2 Umkämpft (10)

| Gruppe | Anz. | normiert | WU | Abstand SW / NO |
|---|---|---|---|---|
| **Mitte, Raute – neutrale Spitzen** (auf x = z) | 2 | (0,457 \| 0,457); (0,543 \| 0,543) | (234, 234); (278, 278) | 212 / 212 |
| **Mitte, Raute – Frontspitzen** (auf der Basisachse) | 2 | (0,473 \| 0,527); (0,527 \| 0,473) | (242, 270) SW-nah; (270, 242) NO-nah | 190 / 229; 229 / 190 |
| **Flanke NW** (Dreieck um x = z) | 3 | (0,258 \| 0,258); (0,207 \| 0,270); (0,270 \| 0,207) | (132, 132); (106, 138) SW-nah; (138, 106) NO-nah | 273 / 273; 266 / 300; 300 / 266 |
| **Flanke SO** (P-Bild) | 3 | (0,742 \| 0,742); (0,793 \| 0,730); (0,730 \| 0,793) | (380, 380); (406, 374) NO-nah; (374, 406) SW-nah | 273 / 273; 300 / 266; 266 / 300 |

Raute: 62 × 40 WU, alle vier Spots ≤ 31 WU vom Mittelpunkt (256, 256). Kleinster Spot-Abstand der Karte 22,6 WU
(Start-Ring, Paare), alle Spots ≥ 30 WU vom Kartenrand (Setons-Regel ≥ 12).

## 8. Hydros (4)

| Hydro | normiert | WU | Abstand SW / NO |
|---|---|---|---|
| Basis SW (hinter dem Start, Basisachse) | (0,156 \| 0,844) | (80, 432) | 40 / 458 |
| Basis NO | (0,844 \| 0,156) | (432, 80) | 458 / 40 |
| Flanke NW (am Quelltümpel, x = z) | (0,188 \| 0,188) | (96, 96) | 308 / 308 |
| Flanke SO | (0,812 \| 0,812) | (416, 416) | 308 / 308 |

Basis-Hydro liegt im flachen Teller (r 40 + halber 6-WU-Fußabdruck < 48) und hinter dem Start – der sichere
Energie-Opener für Einsteiger. Der Flanken-Hydro ist der Anreiz, eine Flanke zu nehmen (Luftwerk-Adjacency ab MS12).

## 9. Reclaim-Felder (Fels-Props `core:rock_01` klein / `core:rock_02` groß)

Kanonische Positionen im Viertel W; die übrigen drei Bilder per N, P, B (yaw wird mitgespiegelt, Wert aus `rng32`).
Mass-Werte sind ein **Vorschlag für die Prop-Blueprints (MS8)**: rock_01 ≈ 15 × scale², rock_02 ≈ 35 × scale².

| Feld | kanonische Props (x, z, id, scale) | gesamt | Mass (Vorschlag) |
|---|---|---|---|
| **Tesserastein** (Mittelpunkt, 1×) | (256, 256, 02, 2,2) | 1 | ≈ 170 |
| **Scherbenfeld Mulde** (r 30–86 um die Mitte, ≥ 14 WU von jedem Mex) | (220, 256, 02, 1,6); (228, 266, 01, 1,0); (212, 276, 01, 1,2); (212, 236, 01, 1,2); (195, 267, 02, 1,3); (195, 243, 01, 1,0); (195, 297, 01, 1,1); (195, 215, 01, 1,1); (170, 256, 02, 1,4) | 36 | ≈ 1.310 |
| **Scharten-Geröll** (Riegelfuß beidseits der Scharte, nicht im Durchlass) | (185, 214, 01, 1,2); (161, 195, 02, 1,2); (173, 235, 01, 0,9) | 12 | ≈ 340 |
| **Massiv-Geröll** (Fuß der Eckmassive, um den Tümpel) | (45, 62, 02, 1,5); (37, 85, 01, 1,1); (30, 109, 01, 1,3) | 12 | ≈ 490 |
| **Summe** | | **61** | **≈ 2.300** (Mitte ≈ 1.480 ≈ 26 Punzen) |

Das Scherbenfeld macht die Mitte doppelt wertvoll (4 Mex + ≈ 64 % des Reclaims) und belohnt frühes Engineer-
Reclaim zwischen den Kämpfen. Wracks entstehen erst im Spiel; keine vorplatzierten Wracks.

## 10. Balance-Begründung

### 10.1 Distanzen (Wegelänge auf dem Klippen-/Tümpel-Hindernisraster, 8-Nachbar)

| Strecke | WU | Punze 3,3 WU/s | Stichel 4,3 | Vogt 1,7 |
|---|---|---|---|---|
| Start ↔ Start, Mittelbahn | **419** | 127 s | 97 s | 246 s |
| Start ↔ Start, nur über eine Flanke | **509** (+22 %) | 154 s | 118 s | 299 s |
| Start → eigene Frontspitze der Raute | 190 | 58 s | 44 s | 112 s |
| Start → neutrale Rautenspitzen | 212 | 64 s | 49 s | 125 s |
| Start → eigener Flanken-Mex / Flanken-Hydro | 267 / 313 | 81 / 95 s | 62 / 73 s | – |
| Start → eigene Flügel / Vorfeld / Eckhof | 111–126 / 86 / 100 | – | – | – |

- **Rush-Distanz 4–5 min:** Landwerk I nach ≈ 0:30 (buildTime 300 / BP 10), erste Punzen ab ≈ 1:30 (15 s je
  Stück bei BP 20), eine Welle von 4–6 Punzen verlässt die Basis ≈ 2:15–3:00 und ist nach 127 s (+ Anfahren) beim
  Gegner → **Erstkontakt an der Basis ≈ 4:30–5:00**, an der Raute schon ≈ 3:15–3:45. Stichel-Raids erreichen die
  gegnerischen Flügel ≈ 1 min früher. Das entspricht einer klassischen 10-km-1v1-Karte und passt zur MS9-Abnahme
  („erste Welle ≤ 8 min“).
- **Fairness:** Alle Paarungen sind exakt D2-symmetrisch: jede Flanke und jede neutrale Rautenspitze ist von beiden
  Starts gleich weit (273 / 308 / 212 WU); wo ein Spot einem Spieler näher ist (Frontspitze, Flanken-Seitenmex),
  hat der andere auf derselben Bahn den gespiegelten Spot mit identischem Vorteil.
- **Staffelung:** 16 → 40 (Hydro) → 86–126 (Vorfeld, Eckhof, Flügel) → 190–212 (Raute) → 267–313 (Flanken). Die
  12 sicheren Mex (24 Mass/s bei T1) liegen alle ≤ 126 WU vom Start, also näher als die Hälfte der Gegnerdistanz;
  alle 10 umkämpften liegen zwischen 45 % und 75 % der Gegnerdistanz.
- **Erwartete Aufteilung:** typisches Spiel 5/5 der umkämpften → je 17 Mex (34 Mass/s T1); wer Mitte und eine Flanke
  hält, kommt auf ≈ 19–20 gegen 14–15 (≈ +35 %) – spürbarer, aber nicht spielentscheidender Vorteil.

### 10.2 Reichweiten (roster.json)

- **Mitte:** Ein Riegel II (48 WU) im Mittelpunkt deckt alle vier Rautenspitzen (≤ 31 WU) – klares T2-Ziel. Ein
  Tiegel (T2-Artillerie, 110 WU) auf der eigenen Frontspitze erreicht das gegnerische Vorfeld-Paar **nicht**
  (145 WU); vom eigenen Vorfeld erreicht er nur die eigene Frontspitze (105 WU), nicht die neutralen Spitzen
  (126–132) und nicht die gegnerische Frontspitze (145). Keine T2-Artillerie von Basis zu Basis.
- **Hochofen (T3, 200 WU):** vom Start aus nur die eigene Frontspitze (190), vom Vorfeld die ganze Mitte, nie die
  gegnerische Basis (≥ 334 WU vom eigenen Vorfeld). Kartengate 290 WU erfüllt.
- **Scharte:** 26 WU = Riegel-I-Reichweite; ein Riegel I oder zwei Punzen sperren sie. Rinne (60) kann die Scharte
  von der Mittelbahn aus beschießen, ohne durchzufahren.
- **Flanken-Tore:** Durchlässe 40/47 WU – mit Riegel II (48) von der Flügel-Mex aus abdeckbar (Abstand Felsnase ↔
  Flügel-Mex ≈ 55–70 WU).

### 10.3 Einsteigerfreundlichkeit

Drei klar lesbare Bahnen (Mitte kurz, Flanken lang), Basis ohne Klippen, sicheres Eco (12 Mex + Hydro) vor dem
ersten Kontakt erreichbar, Klippen nur als markante Riegel/Nasen (hohe Kontraste im Splat), kein Wasser auf Wegen,
Reclaim konzentriert an einem Ort. Kein Luftzwang: alle 34 Mex und 4 Hydros sind per Land erreichbar.

## 11. Oberfläche, Farben, Licht (gemalter Splat, DECISIONS 26)

- Thema **Spätsommer-Hochsteppe**, klar unterscheidbar von Setons (Oliv) und Hollow Ridge: Trockengras als Grundton,
  grünes Gras in Senken, in der Mulde und am Tümpel, Moos am Tümpelufer und an Nordhängen der Riegel.
- **Erde** auf den Basistellern (verrauschter Rand) und als dezente Fahrspuren entlang der drei Bahnen (≤ 12 WU,
  D2-gespiegelt, Deckkraft ≤ 40 %).
- **Dunkler Fels („Tessera-Platten“)** im Muldenboden: polygonale Schieferplatten (Voronoi-Zellen 10–18 WU, Fugen
  aus Erde) unter dem Scherbenfeld – das Wiedererkennungsbild der Karte.
- **Fels** an allen Steilflächen (Riegel, Nasen, Massive, triplanar), **Hochland** auf Graten und Massivkuppen,
  **kein Sand** (keine Küsten), Tümpelbett Schlamm (Erde/Moos).
- Licht (`markers.json` `light`): Azimut 300°, Elevation 40°, Sonne (255, 236, 205), Ambient (96, 104, 120) –
  flaches Nachmittagslicht, damit die Riegel lange Schatten auf die Mittelbahn werfen.

## 12. Hinweise für Generator und Prüfkriterien

- `markers.json`: `version` 1, `name` „Tessera“, `sizeWu` 512, `heightScaleRaw` 32, `waterLevel` 16, Starts Army 0/1
  aus §6, `mass` 34 (§7), `hydro` 4 (§8), `props` 61 (§9), `light` aus §11.
- Generator wie Setons: deterministisch (nur IEEE-exakte Operationen + `rng32`-Lattice-Rauschen), Layout-Masken im
  Viertel W definieren und D2-spiegeln, Rauschen in der Hälfte z ≥ x erzeugen und per P spiegeln; Pads/Basisteller
  zuletzt glätten; Registrierung in `GENERATORS` (`mapgen.ts`).
- **Vertragstest-Vorschlag** (`tessera.test.ts`, Muster `setons.test.ts`):
  1. Kopf: 512 WU, 2 Starts, 34 Mass, 4 Hydro, gepinnte Identität (mapSimHash-Golden).
  2. Heights/Starts/Spots/Props exakt P-symmetrisch; Spots und Props zusätzlich N- und B-symmetrisch.
  3. Start-Ring 4 Mex r 16; Basisteller 28 ± 0,1 in r 30 (Test) bzw. r 48 (Spec); alle Spots trocken und ±0,1 flach
     in ±3 WU; alle Spots ≥ 12 WU vom Rand.
  4. Konnektivität (Flood-Fill, befahrbar = kein tiefes Wasser und Steigung ≤ 0,6): beide Starts und alle Spots
     verbunden; mit gesperrter Mittelbahn (|v| < 95, |u| < 110) weiterhin verbunden (Flanken); mit gesperrten
     Flanken (|v| > 95) weiterhin verbunden (Mitte).
  5. Riegel: Steigung > 1,0 quer über jedes Segment, Scharte 22–30 WU befahrbar; Felsnasen-Durchlässe 36–52 WU.
  6. Wegelängen (Dijkstra auf dem 1-WU-Raster): Mitte 405–435 WU, Flanke 490–540 WU.
  7. Wasseranteil < 0,5 %; kein Tümpel-Pixel näher als 30 WU an einem Spot.
  8. Diagonale ≥ Hochofen-Reichweite / 0,4 (Gate PLAN §3.9).
- E2E `tessera.spec.ts` (FAF_E2E_PORT 4383): `?map=tessera` lädt, 2 Starts/34 Mass/4 Hydro, Kamera über Start 0,
  Terrain 1 Draw; nicht Standardkarte (Setons bleibt `DEFAULT_MAP`).

## 13. Offene Punkte

- Mass-/Energiewerte der Fels-Props kommen mit den Prop-Blueprints (MS8); die Werte in §9 sind Zielgrößen.
- Ob Props Wegfindung blockieren, entscheidet MS3 (Nav); die Scherben stehen so, dass kein Durchgang < 24 WU entsteht,
  auch wenn sie blockieren (Scharten-Geröll steht auf dem Riegelfuß, nicht im Durchlass).
- Timing (§10.1) ist aus roster.json gerechnet, nicht gespielt; nach MS9 mit den ≥ 200 Headless-KI-Spielen prüfen
  (Ziel: Erstkontakt 3:30–5:00, Seitenvorteil SW/NO < 5 % Siegquote).
- Name „Tessera“: vor einer Veröffentlichung Namensrecherche (wie Roster-Namen, DECISIONS Roster 7).
