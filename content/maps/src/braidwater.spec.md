# Layout-Spezifikation „Braidwater“ (Karte B des Skirmish-Kartensets, 1v1, 512 WU)

Stand 2026-09-29. Eigener Entwurf für das MS9-Kartenset (PLAN MS9/M8: „1v1 auf 3 Karten“, gespielt 256–512 WU),
**kein** Nachbau einer FA-Karte. Taktische 1v1-Karte: Plateaus mit Rampen, ein Fluss mit Furten (Furten passierbar,
Tiefwasser blockiert), Hydros an umkämpften Stellen, **eine kurze und eine lange Angriffsroute**. Sie belohnt
Map-Control (Flussufer, Flussinsel) und Artillerie-Positionen (drei Überhöhungen je Seite, jede auf eine Querung
ausgerichtet). Umsetzung analog zu Setons: Generator `packages/formats/scripts/mapgen-braidwater.ts` → Quellen
`content/maps/src/braidwater/` → `content/maps/braidwater.rtsmap` (siehe §11).

## 0. Name, Konventionen, Kennzeichnung

- **Name „Braidwater“**, id **`braidwater`**. Eigenname, in DE und EN unverändert (sprechbar, keine Übersetzung
  nötig); Anspielung auf den „geflochtenen“ Fluss (engl. *braided river*, dt. „verzweigter Fluss“), der sich im
  Osten um die Flussinsel teilt. Optionaler Untertitel für Menü/i18n: DE „Zopfstrom“, EN „The Braided River“.
- Koordinaten normiert `0..1`, **x nach rechts (Osten), z nach unten (Süden)**, Norden oben. WU = normiert × 512
  (Kartengröße 512 WU, Heightmap 513 × 513, 1 Sample = 1 WU).
- **Achsensymmetrie (Spiegelung an z = 0,5)**, *nicht* Punktsymmetrie wie Setons/Hollow Ridge: N-Wert =
  (x, 1 − z) bzw. (x, 512 − z) in WU. Begründung: Nur bei Achsensymmetrie kann jeder Spieler genau **eine** kurze
  und **eine** lange Route haben. Bei 180°-Drehung wird eine Route über die Westflanke auf eine gleich lange Route
  über die Ostflanke abgebildet; eine allein-kurze Route müsste durch den Kartenmittelpunkt laufen, und zwei
  getrennte Routen können das nicht beide. Mit Spiegelung an der Flussachse bildet sich jede Route auf sich selbst ab
  (West = kurz, Ost = lang für beide).
- Kanonische Werte unten gelten für das **S-Team (Army 0, Spieler)**; das N-Team (Army 1, Gegner) ist die
  Spiegelung.
- Kennzeichnung: **[F]** fest (Kartenvertrag, wird getestet), **[R]** Richtwert (Generator darf für ein natürliches
  Bild um die angegebene Toleranz abweichen, aber nur spiegelsymmetrisch).

## 1. Eckdaten

| Merkmal | Wert | Status |
|---|---|---|
| Größe | 512 × 512 WU (≈ 10 km), `sizeWu` 512, `heightScaleRaw` 32, `waterLevel` **12 WU** | [F] |
| Spieler | 2 (1v1), Army 0 = S (Spieler), Army 1 = N (Gegner) | [F] |
| Symmetrie | exakt spiegelsymmetrisch an z = 256 (Heightmap-Zeile 256 ist die Achse) | [F] |
| Starts | S (154, 446), N (154, 66); Luftlinie 380 WU | [F] |
| Mass | **36** (je Seite 17, dazu 2 auf der Flussinsel) | [F] |
| Hydro | **5** (je Seite Basis + Furt, dazu 1 auf der Flussinsel) | [F] |
| Querungen | 3 Furten: West-Furt (kurze Route) und 2 Inselfurten (lange Route); sonst Tiefwasser | [F] |
| Routen Basis ↔ Basis (Landweg) | kurz **≈ 428 WU** (West-Furt), lang **≈ 676 WU** (Inselfurten), Verhältnis 1,58 | [F] ±5 % |
| Wasseranteil | ≈ 13 % (Fluss, Kanäle, Mündungsbecken) | [R] ±3 % |
| Reclaim | ≈ 64 Fels-Props (`core:rock_01/02`) in 6 Feldern | [R] |
| Balancing-Gate | T3-Artillerie „Hochofen“ 200 WU ≤ 40 % der Diagonale (724 WU → 290 WU) ✓ (DECISIONS Fraktion 1) | [F] |

## 2. Großlayout

- Ein **Fluss** läuft von West nach Ost genau auf der Spiegelachse z = 0,5 und trennt die Seiten vollständig.
  - **Westabschnitt** (x 0–0,31): schmal (36 WU Wasser), mit der **West-Furt** bei x 0,125–0,19 → kurze Route.
  - **Mittelabschnitt** (x 0,31–0,49): tiefer, 48 WU breit, beidseits von den **Hochufern** (Steilufer-Plateaus)
    eingefasst → keine Querung, Artillerie-Duell über den Fluss.
  - **Zopfabschnitt** (x 0,49–0,84): Der Fluss teilt sich um die **Zopfinsel** (Flussinsel auf der Achse) in einen
    Nord- und einen Südkanal; je Kanal eine **Inselfurt** bei x 0,74–0,80 → lange Route über die Insel.
  - **Mündungsbecken** (x ≥ 0,84): Kanäle vereinen sich zu einem tiefen Becken am Ostrand.
- Jede Seite hat (S-Seite beschrieben, N gespiegelt):
  - **Basisplateau** am Südrand (x 0,16–0,46), mit West-Rampe (zur kurzen Route) und Ost-Rampe (zur langen Route).
  - **Wachtplateau** am Westrand über der West-Furt (Artillerie-Position der kurzen Route).
  - **Hochufer** am Mittelabschnitt (Artillerie-Position über Fluss und Inselspitze), nur über eine Rückrampe.
  - **Kanzel**, eine kleine Felskuppe im Ostflur (Artillerie-Position über der Inselfurt).
  - **Westsenke** (Sackgasse hinter dem Wachtplateau), **Ostflur** (offene Expansion), **Mündungsufer** (ferne
    Expansion an der langen Route).
- Kartenecken: unpassierbare Eckfelsen (Viertelkreis r 50 WU um SW/NW, r 60 WU um SO/NO).

### 2.1 Raster 64 × 64 (eine Zelle = 8 WU), schematisch [F] Topologie, [R] Konturen

Aus den Formen in §3–§4 gerastert (Zellmitte). Legende: `~` Tiefwasser · `f` Furt (≤ 0,5 WU tief) · `i` Zopfinsel ·
`B` Basisplateau · `W` Wachtplateau · `H` Hochufer · `K` Kanzel · `r` Rampe · `#` Klippe/Fels (unpassierbar) ·
`.` befahrbares Land · `0`/`1` Start Army 0/1 · `M` Mass · `Y` Hydro. Klippenbänder (≈ 6 WU) fallen teils zwischen
die Zellmitten; maßgeblich sind die Formen. Der Generator ergänzt Rauschen (Uferlinie ±4 WU, Hügel), das Raster
nicht.

```
      x→ 0         1         2         3         4         5         6
z↓     0123456789012345678901234567890123456789012345678901234567890123
 0     ######....#BBBBBBBBBBBBBBBBBB#.............................#####
 1     ######....#BBBBBBBBBBBBBBBBBB#.............................#####
 2     ######....#BBBBMBBBBBBBBBBBBB#.............................#####
 3     #####.....#BBBBBBBBBBBBBBBBBB#.............................#####
 4     ####......#BBBBBBBBBBBBBBBBBB#.............................#####
 5     ###.......#BBMBBBBBBBBBYBBBBB#..................................
 6     ..........#BBBBBBBBMBBBBBBBBB#..................................
 7     ..........#BBBBBBBBBBBBBBBBBB#..................................
 8     ..........#BBBBBBMB1BMBBBBBBB#..................................
 9     ..........#BBBBBBBBBBBBBBBBBB#..................................
10     .....M....#BBBBBBBBMBBBBBBBBB#..................................
11     ..........#BBBBBBBBBBBBBBBBBrrrrrrr........M....................
12     ..........#BBBBBBBBBBBBBBBBBrrrrrrr....rr.....M............M....
13     ..........#BBBBBBBBBBBBBBBBBrrrrrrr....rr.......................
14     ...........#rrrBBBBBBBBBBBBB#..........rr.......................
15     ............rrr#############...........rr..M............M.......
16     .##WWW##....rrr.......................#rr.......................
17     #WWWWWWW#...rrr......................#KKK#......................
18     WWWWWWWWW#..rrr......................#KKKK#.....................
19     WWWWWWWWW#..rrr..........rr..........#KKKK#.....................
20     WWWWWWMWWWrrrrrr.........rr..........#KKK#......................
21     WWWWWWWWWWrrrrrr.........rr...........###.....................~~
22     WWWMWWWWWWrrrrrr....#####rr#####............................~~~~
23     WWWWWWWWW#.........#HHHHHHHHHHHH#.........................~~~~~~
24     WWWWWWWWW#.........HHHHHHHHHHHHH#........................~~~~~~~
25     #WWWWWWW#..........HHHHHHHHHHHHH#...~~~~~~~~~~~fffff~~~~~~~~~~~~
26     .##WWW##..M........HHHMHHHHHHMHH#..~~~~~~~~~~~~fffff~~~~~~~~~~~~
27     ...............Y...HHHHHHHHHHHHH#.~~~~~~~~~~~~~fffff~~~~~~~~~~~~
28     ...................HHHHHHHHHHHHH#~~~~~~~~~~~~~~fffff~~~~~~~~~~~~
29     .................~~~~~~~~~~~~~~~~~~~~~iiiiiiiiiiiiff~~~~~~~~~~~~
30     ~~~~~~~~ffff~~~~~~~~~~~~~~~~~~~~~~~~iiiiiiiiiiiiiiii~~~~~~~~~~~~
31     ~~~~~~~~ffff~~~~~~~~~~~~~~~~~~~~~~~iiiiiiiiiiiiiiiii~~~~~~~~~~~~
32     ~~~~~~~~ffff~~~~~~~~~~~~~~~~~~~~~~~iiMiiiiiYiiiiiiMi~~~~~~~~~~~~
33     ~~~~~~~~ffff~~~~~~~~~~~~~~~~~~~~~~~~iiiiiiiiiiiiiiii~~~~~~~~~~~~
34     .................~~~~~~~~~~~~~~~~~~~~~iiiiiiiiiiiiff~~~~~~~~~~~~
35     ...................HHHHHHHHHHHHH#~~~~~~~~~~~~~~fffff~~~~~~~~~~~~
36     ...................HHHHHHHHHHHHH#.~~~~~~~~~~~~~fffff~~~~~~~~~~~~
37     .##WWW##.......Y...HHHMHHHHHHMHH#..~~~~~~~~~~~~fffff~~~~~~~~~~~~
38     #WWWWWWW#.M........HHHHHHHHHHHHH#...~~~~~~~~~~~fffff~~~~~~~~~~~~
39     WWWWWWWWW#.........HHHHHHHHHHHHH#........................~~~~~~~
40     WWWWWWWWW#.........#HHHHHHHHHHHH#.........................~~~~~~
41     WWWWWWWWWWrrrrrr....#####rr#####............................~~~~
42     WWWMWWWWWWrrrrrr.........rr...........###.....................~~
43     WWWWWWWWWWrrrrrr.........rr..........#KKK#......................
44     WWWWWWMWW#..rrr..........rr..........#KKKK#.....................
45     WWWWWWWWW#..rrr......................#KKKK#.....................
46     #WWWWWWW#...rrr......................#KKK#......................
47     .##WWW##....rrr.......................#rr.......................
48     ............rrr#############...........rr.......................
49     ...........#rrrBBBBBBBBBBBBB#..........rr..M............M.......
50     ..........#BBBBBBBBBBBBBBBBBrrrrrrr....rr.......................
51     ..........#BBBBBBBBBBBBBBBBBrrrrrrr....rr.....M............M....
52     ..........#BBBBBBBBBBBBBBBBBrrrrrrr........M....................
53     ..........#BBBBBBBBMBBBBBBBBB#..................................
54     .....M....#BBBBBBBBBBBBBBBBBB#..................................
55     ..........#BBBBBBMB0BMBBBBBBB#..................................
56     ..........#BBBBBBBBBBBBBBBBBB#..................................
57     ..........#BBBBBBBBMBBBBBBBBB#..................................
58     ###.......#BBMBBBBBBBBBYBBBBB#..................................
59     ####......#BBBBBBBBBBBBBBBBBB#.............................#####
60     #####.....#BBBBBBBBBBBBBBBBBB#.............................#####
61     ######....#BBBBMBBBBBBBBBBBBB#.............................#####
62     ######....#BBBBBBBBBBBBBBBBBB#.............................#####
63     ######....#BBBBBBBBBBBBBBBBBB#.............................#####
```

## 3. Wasser

### 3.1 Formen (WU; d = |z − 256| = Abstand zur Achse) [F] Topologie, [R] Konturen ±4 WU

| Element | Form | Wasserbreite |
|---|---|---|
| Fluss West | d < 18 für x < 120, Übergang (smoothstep) auf d < 24 bis x 160 | 36 → 48 WU |
| Fluss Mitte | d < 24 für x 160–250 | 48 WU |
| Zopfaufweitung | Außenufer d < 24 → 58 (smoothstep x 250–300), danach d < 58 bis zum Ostrand | – |
| **Zopfinsel** (Land) | Ellipse Mitte (350, 256), Halbachsen 70 × 28 WU → x 280–420, z 228–284; ausgeschnitten | Kanäle je 30–36 WU (bei x 396: z 278–313) |
| Mündungsbecken | Ellipse Mitte (530, 256), Halbachsen 100 × 90 WU (am Rand abgeschnitten), vereinigt mit dem Fluss | Becken bis d ≈ 88 am Ostrand |

Normiert: Fluss-Achse z 0,500; Zopfinsel x 0,547–0,820, z 0,445–0,555; Mündung ab x ≈ 0,84.

### 3.2 Furten [F]

| Furt | Lage (WU) | normiert | Breite (quer zur Fahrtrichtung) | Länge durchs Wasser |
|---|---|---|---|---|
| **West-Furt** | x 64–96, über die ganze Flussbreite (z 238–274) | x 0,125–0,188 | 32 WU | 36 WU |
| **Inselfurt Süd** | x 380–412, Südkanal (z ≈ 278–313) | x 0,742–0,805, z 0,54–0,61 | 32 WU | ≈ 35 WU |
| **Inselfurt Nord** | Spiegelung (z ≈ 199–234) | z 0,39–0,46 | 32 WU | ≈ 35 WU |

- Furt-Sohle 11,65 WU → Tiefe **0,30–0,40 WU** (≤ `LAND_MAX_WATER_DEPTH` 0,5 WU, begehbar), flach (Steigung < 0,1).
- Übergang Furt → Tiefwasser seitlich über ≤ 4 WU (keine begehbaren Flachwasser-Säume neben der Furt).
- Anfahrt an beiden Ufern: Steigung ≤ 0,2 über ≥ 12 WU.
- Außerhalb der Furten ist **jede** Wasserzelle tiefer als 0,5 WU; im Fluss (ohne Furt-Übergänge) ≥ 2 WU.

### 3.3 Tiefen [R]

| Zone | Sohle (WU) | Tiefe |
|---|---|---|
| Fluss West/Mitte, Kanäle | 5–7 (gewellt ± 1) | 5–7 WU |
| Mündungsbecken | 3–5 | 7–9 WU (tiefste Stelle, volle Tiefenfarbe) |
| Uferschelf (≤ 6 WU breit, außer am Hochufer) | 9–11 | 1–3 WU (nicht begehbar) |
| Furten | 11,65 | 0,35 WU |

## 4. Land, Höhen, Plateaus, Rampen

### 4.1 Höhenzonen [R]

| Zone | Höhe (WU) | Gestalt |
|---|---|---|
| Aue (≤ 30 WU vom Wasser) | 13–15 | flach, zum Wasser ≤ 0,2 |
| Zopfinsel | 13,5–15, Kiesrücken bis 16 | flach, Pads um die Spots |
| Mittelland / Ostflur | 16–20 | sanfte Hügel (Wellenlänge ≈ 60 WU, Steigung p50 ≈ 0,08, max 0,3) |
| Westsenke | 15–17 | Mulde, Geröll |
| **Basisplateau** | **28** | flach (±0,5 in r 45 um den Start), Klippe ≈ 10 WU |
| **Wachtplateau** | **30** | flach oben, Klippe ≈ 14 WU |
| **Hochufer** | **24** | Nordwand direkt ins Flussbett (≈ 18 WU Abfall), Seiten/Rücken ≈ 6 WU Klippe |
| **Kanzel** | **28** | Kuppe, Klippe ≈ 9 WU |
| Eckfelsen | 30–48 | Grate, unpassierbar |

Klippen [F]: Steigung ≥ 1,2 im Klippenband (Band ≈ 6 WU), damit sie auch mit Nav-Hangbegrenzung (`maxSlope` der
Landeinheiten 0,6) sicher sperren. Befahrbares Gelände außerhalb der Klippen: Steigung ≤ 0,3.

### 4.2 Plateaus (S-Seite) [F] Lage, [R] Kontur ±6 WU

| Plateau | Form (WU) | normiert | Zweck |
|---|---|---|---|
| Basisplateau | abgerundetes Rechteck x 84–236, z 388–512 (Ecken r 24), Südseite = Kartenrand | x 0,164–0,461, z 0,758–1 | Basis, 4 Start-Mex, Hinterhof |
| Wachtplateau | Kreis Mitte (36, 340), r 44, am Westrand abgeschnitten | (0,070; 0,664), r 0,086 | Artillerie über der West-Furt |
| Hochufer | abgerundetes Rechteck x 152–262, z 276–330 (r 12); Nordkante = Flussufer (d ≈ 24) | x 0,297–0,512, z 0,539–0,645 | Artillerie über Fluss, West-Furt, Inselspitze |
| Kanzel | Kreis Mitte (318, 360), r 20 | (0,621; 0,703), r 0,039 | Artillerie über der Inselfurt Süd |

### 4.3 Rampen (S-Seite; Achse oben → unten) [F] Lage/Breite, [R] Länge

| Rampe | Achse (WU) | Breite | Höhe | Steigung |
|---|---|---|---|---|
| Basis-West | (110, 396) → (110, 346), nach Norden | 20 WU | 28 → 17 | ≈ 0,22 |
| Basis-Ost | (228, 410) → (282, 410), nach Osten | 24 WU | 28 → 18 | ≈ 0,19 |
| Wacht | (74, 340) → (128, 340), nach Osten | 20 WU | 30 → 16 | ≈ 0,26 |
| Hochufer-Rück | (208, 326) → (208, 362), nach Süden | 20 WU | 24 → 18 | ≈ 0,17 |
| Kanzel | (318, 376) → (318, 416), nach Süden | 16 WU | 28 → 19 | ≈ 0,23 |

Die Füße von Basis-West- und Wacht-Rampe treffen sich bei ≈ (112–128, 340–350) in der Westaue (Rampen per `max()`
überlagern, keine Kante). Hochufer und Kanzel haben **nur** die Rückrampe zur eigenen Seite; der Gegner erreicht sie
nur, nachdem er gequert hat.

### 4.4 Felsen/Sperren [F]

- Eckfelsen S-Seite: SO-Ecke Viertelkreis r 60 um (512, 512); SW-Ecke Viertelkreis r 50 um (0, 512). N gespiegelt.
- Hochufer-Nordwand fällt direkt ins Tiefwasser (kein begehbarer Uferstreifen unter dem Hochufer).
- Keine weiteren Sperren; das Mittelland zwischen Basis-Ost-Rampe, Hochufer und Kanzel bleibt offen (Manövrierraum
  für die lange Route).

## 5. Routen und Konnektivität [F]

- Einzige Landverbindungen zwischen den Seiten: **West-Furt** und die Kette **Inselfurt Süd → Zopfinsel → Inselfurt
  Nord**. Ohne alle drei Furten sind die Seiten getrennt; die Zopfinsel ist nur über die Inselfurten erreichbar.
- Kürzeste Landwege (8-Nachbarschaft, 1-WU-Raster, gemessen an den Formen oben):

| Route | Verlauf | Länge Start ↔ Start | T1-Panzer (3,3 WU/s) | T1-Bot (4,3) | Vogt (1,7) |
|---|---|---|---|---|---|
| **kurz (West)** | Basis-West-Rampe → Westaue (zwischen Wachtplateau und Hochufer) → West-Furt → Spiegelweg | **428 WU** | 130 s | 100 s | 252 s |
| **lang (Ost)** | Basis-Ost-Rampe → Mittelland/Ostflur (an der Kanzel vorbei) → Inselfurt S → Insel → Inselfurt N → Spiegelweg | **676 WU** | 205 s | 157 s | 398 s |

- Start → West-Furt 221 WU, Start → Inselfurt Süd (Mitte) 302 WU, Start → Inselmitte 345 WU.
- Kurze Route: ein Engpass (Furt 32 WU breit), überblickt von beiden Wachtplateaus und den Westenden beider
  Hochufer. Lange Route: offen bis zur Insel, zwei Engpässe hintereinander, dazwischen die umkämpfte Insel; sie
  führt am Ostflur und am Mündungsufer des Gegners vorbei (Raid-Route).

## 6. Starts [F]

| Army | Seite | normiert (x, z) | WU | Plateau |
|---|---|---|---|---|
| 0 | S (Spieler) | (0,301; 0,871) | (154, 446) | Basisplateau S |
| 1 | N (Gegner) | (0,301; 0,129) | (154, 66) | Basisplateau N |

Kamera startet über der eigenen Basis (wie Setons). Start ≥ 66 WU vom Rand, Basisfläche r 45 flach.

## 7. Mass-Spots [F] Lage (±4 WU zulässig, symmetrisch), Pads r 4 flach (Blend bis 12 WU)

Kanonisch S; N = (x, 512 − z). Pfad = kürzester Landweg ab eigenem bzw. gegnerischem Start (WU).

| Gruppe | S normiert (x; z) | S WU | N WU | Pfad eigen | Pfad Gegner |
|---|---|---|---|---|---|
| Start-Ring | (0,270; 0,871) | (138, 446) | (138, 66) | 16 | 421 |
| Start-Ring | (0,332; 0,871) | (170, 446) | (170, 66) | 16 | 435 |
| Start-Ring | (0,301; 0,840) | (154, 430) | (154, 82) | 16 | 412 |
| Start-Ring | (0,301; 0,902) | (154, 462) | (154, 50) | 16 | 444 |
| Hinterhof (Plateau) | (0,211; 0,914) | (108, 468) | (108, 44) | 55 | 431 |
| Hinterhof (Plateau) | (0,242; 0,965) | (124, 494) | (124, 18) | 60 | 464 |
| Westsenke | (0,086; 0,844) | (44, 432) | (44, 80) | 157 | 412 |
| Wachtplateau | (0,059; 0,656) | (30, 336) | (30, 176) | 183 | 348 |
| Wachtplateau | (0,094; 0,688) | (48, 352) | (48, 160) | 160 | 336 |
| Furtufer West | (0,164; 0,594) | (84, 304) | (84, 208) | 171 | 267 |
| Hochufer | (0,352; 0,582) | (180, 298) | (180, 214) | 217 | 401 |
| Hochufer | (0,461; 0,582) | (236, 298) | (236, 214) | 215 | 411 |
| Ostflur | (0,684; 0,766) | (350, 392) | (350, 120) | 218 | 487 |
| Ostflur | (0,727; 0,801) | (372, 410) | (372, 102) | 233 | 495 |
| Ostflur | (0,676; 0,820) | (346, 420) | (346, 92) | 203 | 516 |
| Mündungsufer | (0,883; 0,766) | (452, 392) | (452, 120) | 320 | 504 |
| Mündungsufer | (0,926; 0,801) | (474, 410) | (474, 102) | 335 | 531 |
| **Zopfinsel West** (Achse) | (0,586; 0,500) | (300, 256) | – | 403 | 403 |
| **Zopfinsel Ost** (Achse) | (0,781; 0,500) | (400, 256) | – | 346 | 346 |

Summe: 2 × 17 + 2 = **36**. Start-Ring als „+“ mit 16 WU (wie Setons), Platz für je 3 Kraftwerke (Adjacency).
Alle Spots ≥ 12 WU vom Rand (engster: Hinterhof 18 WU), trocken (Höhe ≥ Wasser + 1), flach (±0,1 WU in r 3).

## 8. Hydros [F]

| Hydro | S normiert | S WU | N WU | Pfad eigen | Pfad Gegner | Rolle |
|---|---|---|---|---|---|---|
| Basis | (0,363; 0,918) | (186, 470) | (186, 42) | 42 | 465 | sicher, Luftfabrik-Adjacency |
| **Furt** | (0,234; 0,578) | (120, 296) | (120, 216) | 164 | 265 | umkämpft: 40 WU südlich der West-Furt, 80 WU vom gegnerischen Furt-Hydro |
| **Zopfinsel** (Achse) | (0,684; 0,500) | (350, 256) | – | 353 | 353 | umkämpft, neutral |

Pads für Hydro-Footprint 6 × 6 plus Rand (flach in r 8).

## 9. Reclaim (Fels-Props `core:rock_01/02`, spiegelsymmetrisch) [R]

| Feld | Lage S (WU) | Anzahl je Seite | Größe | Zweck |
|---|---|---|---|---|
| Furtgeröll | Ufer der West-Furt x 56–112, z 276–300 | 6 | klein (0,8–1,3) | Früh-Reclaim an der kurzen Route |
| Westsenke | x 10–80, z 400–500 | 8 | groß (1,4–2,0) | sichere, reiche Reserve hinter dem Wachtplateau |
| Kanzelfuß | Ring r 26–34 um (318, 360), nicht auf der Rampe | 4 | mittel | Reclaim an der langen Route |
| Mündungsufer | x 430–500, z 340–440, außerhalb der Eckfelsen | 6 | mittel/groß | lohnt die ferne Expansion |
| Hochufer-Rücken | x 160–260, z 334–350, neben der Rückrampe | 3 | klein | Deckung/Flair |
| **Zopfinsel-Kies** | auf der Insel, 4 Paare (z = 256 ± 8…16) + 2 auf der Achse an den Spitzen | 10 gesamt | mittel | umkämpft, hoher Anreiz für die Insel |

Gesamt ≈ 2 × 27 + 10 = **64** Props. Keine Props auf Rampen, Furten, Spot-Pads (r 8) oder Basisflächen (r 45).
Wracks/Bäume folgen mit dem Prop-System (MS8), Platz dafür: Westaue und Ostflur.

## 10. Balance (Begründung)

### 10.1 Fairness

- Exakte Spiegelung → identische Distanzen, Höhen und Sichtlinien für beide Seiten. Sonne **aus Westen, parallel zur
  Achse** (`light.azimuthDeg` 270 nach der .rtsmap-Konvention 0° = aus +z, 90° = aus +x), damit die zum Fluss
  zeigenden Klippen beider Seiten gleich beleuchtet sind; Elevation ≈ 45°.
- Auf der Achse liegen nur Insel-Spots (gleich weit von beiden Starts: 346 / 353 / 403 WU).

### 10.2 Ökonomie je Zone (pro Seite)

| Zone | Mass | Hydro | Pfad ab Start | Sicherheit |
|---|---|---|---|---|
| Basis (Ring + Hinterhof) | 6 | 1 | 16–60 | sicher (Plateau, 2 Rampen) |
| Westsenke | 1 | – | 157 | sicher, nur über die Westaue erreichbar |
| Westflanke (Wachtplateau + Furtufer) | 3 | 1 | 160–183 | vorgeschoben; Gegner-Pfad 267–348 |
| Hochufer | 2 | – | 215–217 | Landweg nur für den Besitzer, aber in T3-Artillerie-Reichweite des gegnerischen Hochufers |
| Ostflur | 3 | – | 203–233 | offen, erst über die lange Route angreifbar (Gegner-Pfad ≈ 490–520) |
| Mündungsufer | 2 | – | 320–335 | fern; nur ≈ 110 WU hinter der Inselfurt Süd → Raid-Ziel des Gegners |
| Zopfinsel (geteilt) | 2 | 1 | 346–403 | neutral, umkämpft |

- Sicher: 7 Mass + 1 Hydro (≈ 41 % der eigenen Spots). Mit Westflanke + Ostflur (Map-Control der eigenen Hälfte):
  13 Mass + 2 Hydro. Wer zusätzlich Mündungsufer und Insel hält, kommt auf 17 + 2 Mass und 3 Hydros – der
  Unterschied „nur Basis“ gegen „volle Kontrolle“ ist ≈ 3:1, das belohnt Map-Control deutlich.
- Der Furt-Hydro liegt 164 WU vom eigenen und 265 WU vom gegnerischen Start, der gegnerische Furt-Hydro nur 80 WU
  entfernt über die Furt: die erste Energie-Expansion ist zugleich der erste Kontaktpunkt der kurzen Route.
- Der Insel-Hydro ist der wertvollste neutrale Punkt (Hydro + 2 Mass + Kies-Reclaim), aber 345 WU entfernt und nur
  über zwei Engpässe zu halten – ein Anreiz, die lange Route zu besetzen, statt nur auf der kurzen zu drücken.

### 10.3 Artillerie-Positionen (Reichweiten aus `docs/design/roster.json`)

Reichweiten: Kelle (T1-Art.) 30, Rinne (T2-MML) 60, Pfanne (T3-Art.) 85, Tiegel (T2-Stat.) 110, Hochofen (T3-Stat.)
200 WU.

| Position | Ziel | Distanz | Wirkt ab |
|---|---|---|---|
| Wachtplateau (Mitte / Ostkante) | West-Furt (Mitte) | 95 / ≈ 51 | Tiegel von überall, Pfanne und Rinne von der Kante |
| Wachtplateau | eigener Furt-Hydro / gegnerischer Furt-Hydro | 95 / 150 | Tiegel schützt den eigenen, erreicht den gegnerischen nicht |
| Wachtplateau ↔ gegnerisches Wachtplateau | – | 168 | nur Hochofen |
| Hochufer-Vorderkante ↔ gegnerische Vorderkante | über den Fluss | 48 | Rinne (60); Kelle (30) nicht |
| Hochufer-Vorderkante → gegnerische Hochufer-Mex | – | 72 | Pfanne; Rinne nicht |
| Hochufer-Mex ↔ gegnerische Hochufer-Mex | – | 84 | Pfanne (knapp), Tiegel |
| Hochufer-Ostecke (262, 284) | Insel-Mex West / Insel-Hydro | 47 / 92 | Rinne / Tiegel |
| Hochufer-Westende (160, 290) | West-Furt | 87 | Tiegel, Pfanne von der Kante |
| Kanzel (Mitte) | Inselfurt Süd / Insel-Hydro | 101 / 109 | Tiegel; Pfanne von der Nordkante |
| Kanzel ↔ gegnerische Kanzel | – | 208 | knapp außerhalb Hochofen |
| eigenes Hochufer (Vorderkante) | gegnerischer Start / Vorderkante gegnerisches Basisplateau | 221 / 165 | Hochofen erreicht nur die Plateau-Vorderkante |
| gegnerische Kanzel / Wachtplateau / Hochufer | gegnerischer Start | 187 / 159 / 175 | Hochofen – erst nach Eroberung |

Folgerungen:

- Jede Querung hat auf **jeder** Seite eine Überhöhung, aus der T2-Stellungsartillerie sie deckt; die eigene Furt
  wird besser gedeckt als die gegnerische (Verteidigervorteil an den Engpässen).
- Die Hochufer stehen sich auf 48 WU gegenüber: ab T2 (Rinne) entsteht ein Artillerie-Duell über den Fluss, ohne dass
  Bodentruppen queren können; ab T3 (Pfanne) werden die Hochufer-Mex gegenseitig bedroht.
- Den gegnerischen **Start** erreicht ein Hochofen nur von einer gegnerischen Überhöhung (Kanzel, Wachtplateau,
  Hochufer). Wer die Flussufer des Gegners erobert, gewinnt damit die Endspiel-Artillerie – Map-Control statt
  Basis-zu-Basis-Beschuss.
- Keine Artilleriestellung sieht direkt in die gegnerische Basis ohne Querung; Kelle (30 WU) spielt nur an den Furten.

### 10.4 Tempo und Spielverlauf (Erwartung)

- Erster Kontakt an der West-Furt nach ≈ 2 min (T1-Bots 100 s ab Fabrik), Ostflur-Raids über die lange Route nach
  ≈ 3–3,5 min.
- Frühspiel: Furt-Hydro und Wachtplateau sichern, Ostflur mit Engineers nehmen. Mittelspiel: Hochufer-Artillerie
  und Kampf um die Insel. Endspiel: Durchbruch an einer Furt, Hochofen auf eroberter Überhöhung.
- MS9-Ziel „Matchdauer ≥ 12 min“: Die kurze Route (428 WU, gedeckte Furt) verhindert frühe Basis-Rushes, die lange
  Route bietet Flankenalternativen – beides spricht für Partien jenseits von 12 min.

## 11. Hinweise für Generator, `markers.json` und Tests [R]

- Aufbau wie Setons: `packages/formats/scripts/mapgen-braidwater.ts` (in `GENERATORS` von `mapgen.ts`
  registrieren), Quellen `content/maps/src/braidwater/{heightmap.png, splat-0.png, splat-1.png, markers.json}`,
  Karte `content/maps/braidwater.rtsmap`. Nur ganzzahlige/IEEE-exakte Operationen und `rng32`-Rauschen.
- **Symmetrie:** nur die S-Hälfte (z ≥ 256) berechnen und spiegeln: h(x, z) = h(x, 512 − z); Rauschen immer an
  (x, |z − 256|) auswerten, damit auch die Achsenzeile konsistent ist.
- `markers.json`: `name` „Braidwater“, `sizeWu` 512, `heightScaleRaw` 32, `waterLevel` 12; Starts Army 0/1 wie §6;
  `mass` in der Reihenfolge von §7 (S dann N je Zeile, Insel-Spots zuletzt), `hydro` Basis S/N, Furt S/N, Insel.
- Splat (8 Layer wie Setons): Erde auf Basen und Rampen, Kies/Sand an Furten und auf der Zopfinsel, Moos in der Aue,
  Fels an Klippen, Wachtplateau/Kanzel oben mit Fels-Flecken, Schlamm am Flussbett, Gras sonst.
- Kartenvertrag (`packages/formats/test/braidwater.test.ts`), sinngemäß wie `setons.test.ts`:
  1. Kopf/Identität, exakte Spiegelung der Heightmap und aller Marker an z = 256.
  2. 2 Starts, 36 Mass, 5 Hydro; alle Spots trocken, flach, ≥ 12 WU vom Rand.
  3. Konnektivität (walkable = nicht Tiefwasser, zusätzlich Steigung ≤ 0,6): beide Starts verbunden; ohne West-Furt
     verbunden mit Weglänge ≥ 1,45 × kurze Route; ohne Inselfurten verbunden (kurze Route 400–450 WU); ohne alle
     Furten getrennt; Zopfinsel ohne Inselfurten unerreichbar.
  4. Furten: Tiefe 0,2–0,45 WU, Breite 28–36 WU; Fluss außerhalb der Furt-Übergänge ≥ 2 WU tief.
  5. Plateaus: Höhen laut §4.2 ±1 WU, Klippenbänder Steigung ≥ 1,2 außer an den Rampen; Rampen ≥ 16 WU breit,
     Steigung ≤ 0,3; Hochufer und Kanzel nur über ihre Rückrampe erreichbar (Flood-Fill mit Steigungsgrenze).
  6. Artillerie-Geometrie: Wachtplateau-Kante ↔ West-Furt ≤ 60 WU, Hochufer-Vorderkanten 40–56 WU auseinander,
     Kanzel ↔ gegnerische Kanzel > 200 WU.
- Frische-Test (mapgen == Quellen, mapc bytegleich), E2E `test/e2e/braidwater.spec.ts` (`?map=braidwater`,
  Identität, Starts, Gesamtansicht) wie bei Setons.

## 12. Offene Punkte

- Nav mit Hangbegrenzung kommt mit MS3; bis dahin sperrt nur Tiefwasser. Die Routenstruktur (§5) hängt allein an
  Wasser und Furten und gilt schon jetzt (Weglängen mit und ohne Klippen gleich: 428 / 676 WU); Plateaus sind ohne
  Hangbegrenzung vorerst auch über die Klippen befahrbar.
- Reclaim-Mengen hängen an den Prop-Blueprints (Masse je Fels); Verhältnis der Felder ist maßgeblich, nicht der
  Absolutwert.
- Marine/Hover (Post-MVP): Mündungsbecken und Kanäle wären Marine-Raum; für das MVP nur Hindernis und Luftraum.
- Playtest (MS9, 5 Tester) entscheidet über Feinjustage: Furt-Breite (28–36 WU), Abstand Furt-Hydro, Anzahl
  Ostflur-Mex.

## 13. Umsetzung (Generator) und Abweichungen

Stand 2026-09-29. Generator `packages/formats/scripts/mapgen-braidwater.ts` (Registry `GENERATORS` in `mapgen.ts`,
`pnpm --filter @faf/formats mapgen braidwater`), Quellen `content/maps/src/braidwater/`, Karte
`content/maps/braidwater.rtsmap` (1.120.112 B, mapSimHash **`0xeeaec694`**), im Spiel über `?map=braidwater`.
Kartenvertrag `packages/formats/test/braidwater.test.ts`, E2E `test/e2e/braidwater.spec.ts`.

### 13.1 Abweichungen vom Entwurf

| Punkt | Entwurf | Umsetzung | Grund |
|---|---|---|---|
| Basis-West-Rampe | (110, 396) → (110, 346) | **(128, 388) → (128, 342)**, 20 WU, Steigung 0,24 | In 3D kreuzte die Rampe die Wacht-Rampe: deren Mitte liegt bei x 110 noch ≈ 22 WU hoch, der Basis-Rampenfuß bei 17 WU – Fuß vor einer Wand, Westaue und Furt-Anfahrt nur um die Wacht-Rampe herum (kurze Route ≈ 480 WU). |
| Wacht-Rampe | (74, 340) → (128, 340) nach Osten, 20 WU | **(76, 360) → (114, 360)**, 16 WU, mündet in halber Höhe seitlich in die Basis-West-Rampe (Y-Verzweigung, Fuß folgt der Basis-Rampe) | Wachtplateau bleibt von der Basis-West-Rampe aus erreichbar (Pfad 168–193 WU wie im Entwurf), die Westaue zwischen Wachtplateau und Hochufer bleibt frei; der Gegner muss die eigene Basis-Rampe hinauf (Pfad 382–407 statt 336–348 WU). |
| Westsenke | „nur über die Westaue erreichbar“ | **Senkenrampe** (84, 448) → (36, 448), 16 WU, vom Basisplateau nach Westen; die Senke ist eine Sackgasse hinter der Basis | Mit Wacht- und Basis-Rampe als Wänden (Klippen ≥ 1,2) war die Senke von der Westaue aus nur über Rampenflanken zu erreichen. Pfad eigen 119 WU (Entwurf 157), Gegner 466 WU (412). |
| Rampenprofil | Achse oben → unten | Beginn an der Plateaukante, konstante Steigung (Fußhöhe = Boden am Fußpunkt), 10 WU Auslauf | keine Stufe an der Kante, Steigung ≤ 0,3 trotz Hügeln |
| Plateau-Konturen | [R] ±6 WU | ±3 WU (langwelliges Rauschen gedämpft) | Längs einer verrauschten Kante ließe sich eine Klippe sonst in flachem Winkel „abschreiten“; so sperren alle Klippen mit Reserve bis Steigungsgrenze 0,8 (Nav: 0,6) |
| Splat | 128² o. ä. | 256² (2 WU je Texel), 8 Layer wie Setons | schärfere Rampen/Klippen auf der kleinen Karte |
| Splat-Gestaltung (visueller Abgleich) | Erde auf Basen und Rampen | Basisplateau als trockene Hochwiese mit ausgefranstem Erdkern r ≈ 34–48 um den Start; Rampen mit Kies-/Trockengras-Rand und schmaler Fahrspur; Fels-Saum an allen Plateaukanten, Strata-Bänder (Periode 3,2 WU) an Klippen; heller Kies-Pad (r ≈ 5) unter jedem Mass-/Hydro-Spot; Furt-Kies nur auf der überfluteten Sohle, Ufer-Kies kurzwellig ausgefranst | vollflächige Erde wirkte im Spiel wie eine Brettspielplatte; Spots und Plateaus sind so aus der Gesamtansicht lesbarer |

### 13.2 Ist-Werte (Test bzw. Generator)

| Merkmal | Soll | Ist |
|---|---|---|
| Kurze Route (West-Furt) | 428 WU ±5 % | **428,0** (nur Wasser sperrt) / **428,0** (mit Hanggrenze 0,6) |
| Lange Route (Inselfurten) | 676 WU ±5 % | **673,8** / **709,0**; Verhältnis 1,57 / 1,66 |
| Ohne alle Furten / Insel ohne Inselfurten | getrennt / unerreichbar | ✓ / ✓ (beide Varianten) |
| Wasseranteil | ≈ 13 % | 13,0 % |
| Furten | 0,2–0,45 WU tief, 28–36 WU breit | 0,352 WU tief, 32–33 WU breit, Sohle flach |
| Plateaus | 28 / 30 / 24 / 28 WU | 28 (flach ±0 in r 45) / 30 / 24 / 28 (Kuppe ±0,3); Klippen ≥ 1,2 außer an Rampen |
| Hochufer, Kanzel, Wachtplateau, Senke | nur über ihre Rampe | ✓ (Flood-Fill mit Hanggrenze 0,75 im Test, gemessen dicht bis 0,8) |
| Artillerie | Wacht-Kante ↔ West-Furt ≤ 60; Hochufer-Kanten 40–56; Kanzel ↔ Kanzel > 200 | 50,5 / 52–54 (Wasser 44–46) / 208 |
| Pfade eigen (Hanggrenze) | §7/§8 | Start-Ring 16, Hinterhof 55–60, Senke 119, Wacht 168–193, Furtufer 171, Furt-Hydro 164, Hochufer 220–228, Ostflur 203–233, Mündung 320–335, Insel 363–418 |
| Pfade Gegner (Hanggrenze) | §7/§8 | Furtufer 267, Furt-Hydro 264, Ostflur 503–533, Mündung 520–547 |
| Reclaim | ≈ 64 | 64 Fels-Props (2 × 27 + 10 auf der Insel) |
| Höhenbereich | – | 3,5–48,2 WU |

Messung im Spiel (E2E, lokal Apple M5 Pro, Playwright headless, Preset Medium): Chromium/WebKit 60 FPS, Firefox
120 FPS in Gesamtansicht und Kameraflug, 3 Draws, Main-JS p95 ≤ 1 ms; CPU == GPU-Höhen (4.000 Proben), Einheiten auf
dem Terrain, alle vier Kartenecken bei maximalem Zoom im Bild.
