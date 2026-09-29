# Layout-Spezifikation „Setons“ (Nachbau nach *Seton's Clutch*)

Stand 2026-09-29. Grundlage für den eigenen Nachbau (DECISIONS „Erste Karte: Setons“). **Keine Original-Dateien:**
Diese Spezifikation beschreibt nur das Layout; Heightmap, Texturen und Props werden neu gebaut. Das Referenzbild
(öffentliches FAF-Vault-Vorschaubild, 256 × 256 px) liegt nur lokal außerhalb des Repos und wird nicht eingecheckt.

## 0. Konventionen und Belegstatus

- Koordinaten normiert `0..1`, **x nach rechts, z nach unten** (wie die Vorschau, Norden oben). WU-Werte = normiert ×
  1.024 (Kartengröße 1.024 WU ≈ 20 km, 1 WU ≈ 19,5 m – entspricht zufällig genau der FA-Einheit „ogrid“).
- Teams: **NO** (Nordost, oben rechts) und **SW** (Südwest, unten links).
- Die Karte wird **exakt punktsymmetrisch** gebaut (180°-Drehung um (0,5 | 0,5)): SW-Wert = (1 − x, 1 − z).
  Die kanonischen Werte unten sind für das NO-Team angegeben (Mittelwert aus NO-Messung und gespiegelter SW-Messung).
  Das Original ist nur näherungsweise symmetrisch (Abweichungen meist ≤ 0,02, vereinzelt bis 0,09 – siehe §12).
- Kennzeichnung jeder Angabe:
  - **[B]** belegt durch Text-Quelle (siehe §13),
  - **[V]** aus dem Vorschaubild vermessen (Auflösung 1 px = 4 WU, Markersymbole ≈ 4 px ⇒ Genauigkeit ≈ ±8–12 WU),
  - **[S]** geschätzt/eigene Festlegung (keine Quelle, für den Nachbau plausibel gewählt).

## 1. Eckdaten

| Merkmal | Wert | Status |
|---|---|---|
| Größe | 20 × 20 km → `sizeWu` 1.024 | [B] |
| Spieler | 8 (4v4), auch 3v3 mit gesperrter Front- oder Rear-Position üblich | [B] |
| Teams | NO (oben rechts) gegen SW (unten links), Kontakt über eine diagonale Landbrücke in der Kartenmitte | [B] Landbrücke, [V] Lage |
| Wasseranteil | ≈ 57 % der Fläche (zwei große Seen je ≈ 28 %, dazu 2 Randbuchten, 2 Teiche) | [V] |
| Mass-Spots | 54 je Team, **108 gesamt** (je Start 4 am Spawn + 38 im Gelände inkl. 5 auf der Insel) | [V], 4 Start-Mex [B]/[V], 5 Insel-Mex [B] |
| Hydros | 8 (je Spieler 1, nahe am Start) | [V] |
| Reclaim | hochwertige Wracks auf der Landbrücke; Bäume und Felsen im Hinterland | [B] qualitativ, Positionen [S] |
| Original-Kennung | FA-Szenario `SCMP_009` (nur als Hinweis, Datei wird nicht verwendet) | [B] |

## 2. Großlayout (Übersicht)

- Ein **breites Landband läuft diagonal von unten links (SW) nach oben rechts (NO)**. Links oben und rechts unten liegt
  je ein großer, tiefer **See**; beide reichen bis an die Kartenränder und sind **nicht miteinander verbunden** [V].
- Das Landband verjüngt sich in der Mitte zu einer **Landbrücke** (engste Stelle ≈ 74 WU bei (0,49 | 0,50)), das ist
  die einzige Landverbindung zwischen den Teams [B]/[V].
- Jedes Team hat vier Starts: **Air/Rear** in der Kartenecke (vor Gebirge), **Beach** an der Küste des „gegnerischen“
  Sees, **Mid/Front** an der Landbrücke, **Rock** auf felsigem Gelände an der Küste des anderen Sees [B] Rollen, [V] Lage.
- Auf jeder Seite eine **kleine, erhöhte Insel** mit 5 Mass am Kartenrand (links oben bzw. rechts unten), je näher an
  der Rock-Position [B].
- Kartenecken NO (oben rechts) und SW (unten links): **Gebirge** hinter den Air-Starts [V].
- Kleine **Teiche** im Hinterland jedes Teams und je eine **Randbucht** am Kartenrand neben der Rock-Position [V].

### 2.1 Raster 64 × 64 (eine Zelle = 16 WU), aus der Vorschau klassifiziert [V]

Legende: `D` tiefes Wasser · `d` mittleres Wasser · `s` Flachwasser/Schelf · `p` Teich · `b` Strand ·
`R` Fels/Klippe/Gebirge · `.` Land · `H` Hydro · Ziffer = Start (Army, siehe §7). Einzelne `R`-/`p`-Zellen mitten im
Land können Artefakte der Kartensymbole sein; maßgeblich sind die Flächen.

```
      x→ 0         1         2         3         4         5         6
z↓     0123456789012345678901234567890123456789012345678901234567890123
 0     DDDDDDDDDDDDDDDDDDDDDddssssssssss.......................RRRRRRRR
 1     DDDDDDDDDDDDDDDDDDDDdddsssdssssss........................RRRRRRR
 2     DDDDDDDDDDDDDDDDDDDDDDdssdddsssss........................RRRRRRR
 3     DDDDDDDDDDDDDDDDDDDDDddddDDdssss..........................RRRRRR
 4     DDDDDDDDDDDDDDDDDDdDDDddDddddsss........................H..RRRR.
 5     DDDDDDDDDDDDDDDDDDDdDDddDDdDdsss.........................R..RRRR
 6     DDDDDdDDDDDDDDDDDDDDDDdddDdDDdsss........................3..RR.R
 7     DDDDDddDDDDDDDDDDDDDDdddddDDDDssss.b........................RR.R
 8     DDdDDDddDDdDDDDDDDDDDDDdDDDDddsssddbb..........................R
 9     dDDDDDDDDDDDDDDDDDDDDDDdddddddddssssRRbb.......................R
10     dDDDDDDDDdDDDDDDDDDDDdDdddddsdDdsssssss..7.H...................R
11     dDDDdddDddDDDDDDDDdDDDDDddddddDddssssssb......................RR
12     ddddddddddDDDDDDDDDDDDDDdddddddddssssssp......................RR
13     ddddssssddDDDDDDDDdddDDddddddddDdssssssbb.......................
14     sddsssssddDDDDDDDDdDdDdddddddddDddsssssbb.......................
15     .RRRsssdddDDDDDDDDDdddDdddddddddddsssssR........................
16     RR.RsssssdDDDDDDDDDdddDDdddddddddssssssd..............d.........
17     ....ssssddDDDDDDDDDDdddDDDdddddddssssssd.....H......ppdp........
18     ....ssssddDDDDDDDDDDdddddDDDDDdddssssss..........R.pppD.........
19     ....psssddDDDDDDDDDDddddddDDddddssssssD.............p..pR.......
20     RR...sssdDDDDDDDDDDDDDddddddDDddssssss..........................
21     .RbssssdddDDDDDDDDDDDDDDDDddDDdddssssD...1......................
22     sssssssdddDDDDDDDDDDdDdDDdDdDdddsssss...........................
23     sssdddddddDDDDDDDDDDddDDDDDDddddsssss.........RRss......H.......
24     dddddDDDdddddDDDDDDDDdDDDDDDDDdssssss........ssssss...........dd
25     ddddDDDDdddddddDDDDDDDDDDDDDDDddssssd.......ssdsssD..........ddD
26     ddDDdDdddddddDdDDDDDDDDDDDDDddddssss.......ssDdddssd.R.......dDD
27     ddDddddddssdDDDDDdDDDDDDDDDDdssssd.........sdddddss..5.......ddD
28     ddssssdddssdDDDDDdDDDDDDDDddssssdp.........sddDDddd....RRRR...R.
29     dddddssdsssddDDDDdDDdDDDddsssssdp..........dddDDddd....R.RRR..R.
30     RR.bRRdRssssdDDDDDDddddsdsssssdp..........sdDDDDDdsd....RRRR...R
31     RR...RRRR.ssdDDDDDDdddssssssdp.....bRs...ssdDDDDDDdss..RRRRR...R
32     R...RR.RRR.ssdDDDDDdddds.ddsR.....bpssssssdddDDDDDDdssRRRRRR...R
33     ....RRRR....ssdDDDDDdd..........bRRsssssssddDDDDDDDDdsssRRbRb.RR
34     .R..RRRRR....sddDDDddd.........bRssssssddddddDDDDDDDdssssssRRR.R
35     ......RRR....ssdDDDdd.........bRssssssddDDDDDDDDDDDDdssssdssssss
36     dd.....R..4..ssddDddd.........bsssssdDDDDDDDDDDdDDDDdsssdddddddd
37     DDd.......R.bsssddddd........ssssdddDDDDDDDDDDDDDDDDddssdddddDDd
38     DDdD......R..dssssDdd......sssssdddDDDDDDDDDDDDDDddddddddDDDdDdd
39     ddD..........sdsdsdd.......sssssddDDDDDDDDDDDDDDDDDdddddDDDDddds
40     .......H......ddd..........ssssssddDDDDDDDDDDDDDDDDDDDDddddddddd
41     ......................R....sssssddDDDDDDDDDDDDDDDDDDDDDddddddssd
42     .....................R0....sssssddDDDDDDDDDDDDDDDDDDDDDddssssd..
43     ...........................sssssdDDDDDDDDDDDDDDDDDDDDDDddssd..RR
44     .......Rp.................ssssssddDDDDDDDdDDDDDDDDDDDDDddssd....
45     .......p.p.pp.............ssssssdDDDDDDDdDDdDDDDDDDDDDDdssss....
46     .........dDpp.....H.....bssssssdDDDDDDDDDDDdDDDDDDDDDDddssss....
47     .........dD........R....bssssssdDDddDDDDDDDDdDDDDDDDDDdddsss.RRR
48     ........................bssssssddddddDdDDDDddDDDDDDDDDddssssdRRR
49     ........................RsssssddDdddDdddDDDDDDDDDDDDDDDddssss..s
50     .......................bbsssssddDDddddddDDDDDDDDDDDDDDdddsssssss
51     .R.....................bbsssssddDDDdddDDDDDDDDDDDDDDDDdddddddddd
52     .R......................bRssssssdDDdddddDDDDDDDDDDDDDDdddddddDdd
53     R...................H.6.bRssssssdDDdddddDDDDDDDDDDDDDDDdDDDDDDDd
54     R.....................R.bb.dssssdDDddddddDDDDDDDDDDDDDDDDDDDDDDD
55     R..........................b.ddsssddDDDDdDDDDDDDDDDDDdDDDdDDDDdD
56     R..R.R.......................bdsssdDDDDDDDDDDDDDDDDDDDDDDdddDDDD
57     R.RR.R2.......................RsssdDDDDDddDDDDDDDDDDDDDDDDddDDDD
58     R.RR............................ssddDDDDddDDDDDDDDDDDDDDDDDDDDDD
59     .RRbR..H........................sssdddDDdddDDdDDDDDDDDDDDDDDDDDD
60     .RRRRR..........................ssssddDddddDDDDDDDDDDDDDDDDDDDDD
61     RRRRRRR.........................sssssdDddddDDDDDDDDDDDDDDDDDDDDD
62     RRRRRRR.........................sssssddssdddDDDDDDDDDDDDDDDDDDDD
63     RRRRRRRRR.....................bbssssssdssdddDDDDDDDDDDDDDDDDDDDD
```

Hinweis: Das Raster ist direkt aus dem (leicht unsymmetrischen) Original gemessen. Für den Nachbau gilt die
NO-Hälfte (Zellen mit x > z) als Vorlage, die SW-Hälfte entsteht durch Punktspiegelung.

## 3. Wasserflächen

### 3.1 Uferlinien (vereinfachte Polygone, normiert) [V]

Punkte im Uhrzeigersinn, Polygonfehler ≈ ±0,01. Randpunkte (0,01 bzw. 1,00) liegen auf dem Kartenrand.

- **See NW** (Fläche ≈ 28,2 %; grenzt an NO-Beach und SW-Rock, umschließt die NW-Insel):
  (0,01|0,01) (0,01|0,22) (0,04|0,23) (0,06|0,24) (0,08|0,30) (0,06|0,33) (0,01|0,35) (0,01|0,46) (0,06|0,46)
  (0,17|0,49) (0,21|0,53) (0,20|0,60) (0,23|0,64) (0,29|0,63) (0,32|0,60) (0,34|0,53) (0,36|0,51) (0,44|0,51)
  (0,53|0,43) (0,57|0,41) (0,58|0,35) (0,62|0,27) (0,60|0,16) (0,56|0,15) (0,51|0,10) (0,51|0,01)
  - Die Ausbuchtung (0,20–0,33 | 0,50–0,64) greift nach Süden zwischen SW-Rock und SW-Mid ins Land.
  - Der Abschnitt (0,01|0,22)–(0,01|0,35) umläuft die NW-Insel (Insel = Land zwischen Rand und diesen Punkten).
- **See SO** (Fläche ≈ 27,9 %; grenzt an SW-Beach und NO-Rock, umschließt die SO-Insel) – exakte Punktspiegelung:
  (0,78|0,37) (0,71|0,38) (0,68|0,41) (0,67|0,46) (0,65|0,49) (0,57|0,50) (0,48|0,58) (0,46|0,58) (0,43|0,61)
  (0,43|0,66) (0,39|0,75) (0,41|0,84) (0,46|0,86) (0,50|0,91) (0,49|1,00) (1,00|1,00) (1,00|0,78) (0,96|0,78)
  (0,93|0,72) (0,93|0,68) (1,00|0,66) (1,00|0,54) (0,94|0,55) (0,83|0,51) (0,80|0,47) (0,80|0,40)
- **Randbucht O** (neben NO-Rock, ≈ 0,25 %, tief bis zum Rand, vom See getrennt): (0,97|0,38) (0,96|0,40) (0,96|0,43)
  (1,00|0,44) (1,00|0,38). Gegenstück **Randbucht W** bei (0,00–0,05 | 0,56–0,63) neben SW-Rock.
- **Teich NO** (≈ 0,08 %, im Hinterland zwischen Air und Rock): (0,84–0,86 | 0,26–0,29), mit kleinem Ausläufer nach
  Westen bis ≈ 0,80. Gegenstück **Teich SW** (0,14–0,17 | 0,71–0,75).

### 3.2 Tiefenzonen [V] Verteilung, [S] Zahlenwerte

| Zone | Lage | Anteil | Tiefe unter Wasserspiegel (Vorschlag) |
|---|---|---|---|
| Tief `D` | Kern beider Seen, reicht bis an die Kartenränder (NW-See: Kern ≈ (0,02–0,46 | 0,01–0,56); SO-See spiegelbildlich) | ≈ 28 % | 10–16 WU |
| Mittel `d` | Ring um den Kern, v. a. zwischen Kern und Rock-Küsten | ≈ 28 % (mit `D` zusammen) | 4–10 WU |
| Flach `s` | **breiter Schelf entlang der Beach-Küsten und der Landbrücke** (NW-See: Band x ≈ 0,45–0,60 von z = 0 bis 0,55; SO-See spiegelbildlich x ≈ 0,40–0,55 von z = 0,45 bis 1); schmaler Schelf an den Rock-Küsten und um die Inseln | ≈ 15 % der Wasserfläche | 0,6–4 WU (für Land-Einheiten nicht begehbar, > `LAND_MAX_WATER_DEPTH` 0,5 WU) |
| Teiche `p` | Hinterland | < 0,2 % | 0,6–1,5 WU (Hindernis für Land, optisch flach) |

Tiefe Zusatzsenken im Schelf: NW-See bei (0,39–0,45 | 0,09–0,13), SO-See bei (0,55–0,62 | 0,87–0,92) [V].

## 4. Land, Höhen, Klippen

### 4.1 Höhenverhältnisse [S] (Vorschau enthält keine Höhen; Werte FA-typisch gewählt)

Format: `heightScaleRaw` 32 (1 Stufe = 1/128 WU), Heightmap 1.025 × 1.025 (u16), `waterLevel` **20 WU**.

| Zone | Höhe (WU) | Gestalt |
|---|---|---|
| Seeboden tief | 4–10 | weich gewellt |
| Schelf | 16–19,4 | flach, sanft zum Ufer ansteigend |
| Strand | 20,5–22 | schmaler Saum, Steigung < 0,15 |
| Landbrücke | 22–26 | flach, leicht gewölbte Mitte (≈ 25 WU) |
| Basisflächen (alle 8 Starts) | 26–30 | flach (Steigung < 0,1) in r ≈ 40 WU um den Start |
| Hinterland/Hügel | 24–36 | sanfte Hügel, Steigung < 0,4 (überall befahrbar) |
| Fels-Gelände Rock-Position | 30–42 | zerklüftet, einzelne unpassierbare Felsrippen (Steigung > 1,0) |
| Inseln (Plateau) | 38–42 | flach oben, **ringsum Klippe** ≈ 18–22 WU Abfall ins Wasser [B „erhöht“] |
| Eckgebirge | 45–75 | unpassierbar, Grate zum Kartenrand hin höher |

### 4.2 Unpassierbare Fels-/Klippenflächen [V] Lage, [S] Höhe

- **Eckgebirge NO:** (0,82–1,00 | 0,00–0,20), Schwerpunkt (0,95|0,06); fällt nach Westen/Süden zu den Air-Basisflächen
  ab. Gegenstück SW: (0,00–0,18 | 0,80–1,00).
- **Fels-Rücken an der NO-Rock-Position** (Namensgeber „Rock“): (0,85–1,00 | 0,42–0,55), Schwerpunkt (0,92|0,49),
  zwischen Rock-Start, Randbucht und SO-See. Der Fels-Cluster-Mex (§8) liegt in seinen Lücken → Durchgänge ≥ 12 WU
  freihalten. Gegenstück SW: (0,00–0,15 | 0,45–0,58).
- **Felsgruppe an der Nordspitze der SO-See-Ausbuchtung:** (0,71–0,75 | 0,36–0,38) (Felsen am Ufer, Reclaim-Kandidat);
  Gegenstück (0,25–0,29 | 0,62–0,64).
- **Inselklippen:** vollständiger Klippenring (Steigung > 1,5), **keine Rampe** [B: Engineer muss per Transport rein
  oder vom Wasser aus eine Fabrik „auf die Insel“ bauen].

### 4.3 Plateaus und Rampen

- Einzige echte Plateaus sind die **Inseln** (ohne Rampe) [B].
- Die Air-Basis liegt als flache Mulde vor dem Eckgebirge; offenes Hinterland „ideal für Luftlandungen“ [B], d. h.
  **keine** Klippen/Rampen zwischen Air, Beach, Mid und Rock desselben Teams – alle Startbereiche eines Teams sind
  frei untereinander befahrbar [B]/[V].
- Für MS-Nav-Tests sinnvoll [S]: flache Rampe (Steigung ≈ 0,3) vom Strand zur Landbrücke an beiden Enden.

## 5. Landverbindungen zwischen den Teams

- **Genau eine**: die diagonale Landbrücke. Achse ≈ (0,33|0,66) → (0,50|0,50) → (0,67|0,34) [V].
- Breite senkrecht zur Achse [V]: 0,20 (≈ 210 WU) an den Enden bei Mid, 0,12–0,14 (≈ 125–145 WU) auf ≈ 430 WU Länge,
  **engste Stelle 0,072 ≈ 74 WU** im Zentrum (0,45–0,55 | 0,45–0,55); kürzester Abstand der beiden Seen dort ≈ 74 WU
  zwischen (0,45|0,50) und (0,50|0,55).
- Keine weitere Landroute: Inseln, Randbuchten und Seen trennen alles andere. Solange Marine/Hover fehlen (MVP), ist
  die Landbrücke der **einzige Bodenweg**; Wasser ist Hindernis bzw. Luftraum (DECISIONS).
- Beide Strand-Schelfe liegen an der Brücke – später Hover-/Amphibienrouten entlang der Brückenflanken [S].

## 6. Inseln [B] 5 Mass, erhöht; [V] Lage

| Insel | Ausdehnung (normiert) | nächster Start (Abstand) | Wasserabstand zum Festland |
|---|---|---|---|
| NW-Insel (SW-Team-Seite) | x 0,00–0,08, z 0,23–0,35, liegt am Kartenrand | SW-Rock (≈ 0,32 ≈ 330 WU) | ≈ 0,11–0,13 zum SW-Festland (nach Süden) |
| SO-Insel (NO-Team-Seite) | x 0,92–1,00, z 0,65–0,77 | NO-Rock (≈ 0,32) | ≈ 0,10–0,12 zum NO-Festland (nach Norden) |

Laut Quelle begünstigt die Lage den jeweiligen **linken Flügel** (= Rock), der gegnerische rechte Flügel (Beach) kann
sie über den See trotzdem nehmen [B].

## 7. Startpositionen

Rollen [B] (Air/Rear, Mid/Front, Beach, Rock; „unten links ist Air“, „Mitte links ist Rock“), Lage [V].
Army-Nummern sind ein Vorschlag [S]: gerade = SW, ungerade = NO; **Army 0/1 = Mid gegen Mid für den MVP-1v1**
(direkter Landkontakt über die Brücke, Luftlinie ≈ 458 WU; Air↔Air wären ≈ 1.159 WU).

| Army NO | Rolle | x | z | x WU | z WU | Army SW | x | z | x WU | z WU |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Mid (Front) | 0,654 | 0,338 | 670 | 346 | 0 | 0,346 | 0,662 | 354 | 678 |
| 3 | Air (Rear) | 0,900 | 0,100 | 922 | 102 | 2 | 0,100 | 0,900 | 102 | 922 |
| 5 | Rock (linke Flanke, Marine) | 0,834 | 0,424 | 854 | 434 | 4 | 0,166 | 0,576 | 170 | 590 |
| 7 | Beach (rechte Flanke, Marine) | 0,643 | 0,163 | 658 | 167 | 6 | 0,357 | 0,837 | 366 | 857 |

Rollenbeschreibung [B]: Mid/Front trägt den Landkampf auf der Brücke und reclaimt die Zentrums-Wracks (wichtigste und
stressigste Position); Rear/Air geht auf Lufthoheit (T3-ASF) und unterstützt; Beach und Rock sind die Flanken mit
Marine (Beach und Rock des Gegners teilen sich jeweils einen See: NW-See = NO-Beach gegen SW-Rock, SO-See = SW-Beach
gegen NO-Rock).

## 8. Mass-Spots

### 8.1 Start-Ring [B] 4 Mex (Rear-Bauplan: 3 vom ACU, der 4. vom ersten Engineer), [V]/[S] Lage

Je Start 4 Mex als „+“ um den Spawn, Abstand ≈ 16 WU (Symbole in der Vorschau teils vom Startsymbol verdeckt):
(x ± 16, z) und (x, z ± 16) in WU. Platz für je 3 Kraftwerke um jeden Start-Mex lassen (Adjacency-Opener) [B].

### 8.2 Gelände-Mex je Team (38) [V]

Kanonische NO-Werte; SW = Punktspiegelung. Summe je Team: 16 Start + 33 Gelände + 5 Insel = **54**.

| Zuständig | Gruppe (Anzahl) | NO normiert (x, z) | NO in WU | SW in WU |
|---|---|---|---|---|
| Air | Paar am Hydro, NW des Starts (2) | (0,859, 0,051); (0,861, 0,074) | (880, 52); (882, 76) | (144, 972); (142, 948) |
| Air | Dreieck „Richtung Mid“, Hinterland-Mitte (3) | (0,777, 0,123); (0,758, 0,154); (0,785, 0,154) | (796, 126); (776, 158); (804, 158) | (228, 898); (248, 866); (220, 866) |
| Air | am Teich (1) | (0,811, 0,221) | (830, 226) | (194, 798) |
| Air | Kette „Richtung Rock“ (3) | (0,914, 0,166); (0,914, 0,201); (0,879, 0,222) | (936, 170); (936, 206); (900, 227) | (88, 854); (88, 818); (124, 797) |
| Beach | Nordküste am Kartenrand, Cluster (3) | (0,536, 0,016); (0,552, 0,014); (0,548, 0,032) | (549, 16); (565, 14); (561, 33) | (475, 1008); (459, 1010); (463, 991) |
| Beach | Hinterland Nord (2) | (0,709, 0,055); (0,656, 0,115) | (726, 56); (672, 118) | (298, 968); (352, 906) |
| Beach | Küste West (1) | (0,588, 0,127) | (602, 130) | (422, 894) |
| Beach | am Beach-Hydro (1) | (0,701, 0,170) | (718, 174) | (306, 850) |
| Beach | Übergang Beach→Mid (1) | (0,668, 0,223) | (684, 228) | (340, 796) |
| Mid | nördlich/östlich des Starts (2) | (0,654, 0,289); (0,703, 0,324) | (670, 296); (720, 332) | (354, 728); (304, 692) |
| Mid | südlich des Starts, Brückenkopf (2) | (0,621, 0,383); (0,660, 0,389) | (636, 392); (676, 398) | (388, 632); (348, 626) |
| Mid | Landbrücke, eigene Hälfte (2) | (0,584, 0,449); (0,639, 0,451) | (598, 460); (654, 462) | (426, 564); (370, 562) |
| Mid | **Landbrücke Zentrum (umkämpft)** (1) | (0,518, 0,479) | (530, 490) | (494, 534) |
| Rock | Nord, Richtung Air (2) | (0,900, 0,291); (0,969, 0,257) | (922, 298); (992, 263) | (102, 726); (32, 761) |
| Rock | nördlich des Starts (2) | (0,846, 0,369); (0,881, 0,379) | (866, 378); (902, 388) | (158, 646); (122, 636) |
| Rock | Fels-Cluster östlich des Starts (3) | (0,893, 0,416); (0,914, 0,422); (0,938, 0,443) | (914, 426); (936, 432); (961, 454) | (110, 598); (88, 592); (63, 570) |
| Rock | Südküste am SO-See (1) | (0,838, 0,488) | (858, 500) | (166, 524) |
| Rock | Kartenrand an der Randbucht (1) | (0,959, 0,500) | (982, 512) | (42, 512) |
| Insel | SO-Insel, 5 Mex [B] (5) | (0,945, 0,682); (0,957, 0,699); (0,992, 0,701); (0,945, 0,715); (0,992, 0,714) | (968, 698); (980, 716); (1016, 718); (968, 732); (1016, 731) | (56, 326); (44, 308); (8, 306); (56, 292); (8, 293) |

Die Zuordnung „Zuständig“ folgt dem Rear-Bauplan der Quelle (Hydro + 2 Mex, 3 Mex Richtung Mid, 1 Mex am Teich,
3 Mex Richtung Rock) [B] und sonst der Nähe [S]. Rand-Mex bei x = 1.016 WU beim Bau auf ≥ Footprint-Abstand vom
Rand nachziehen (Vorschlag ≤ 1.014 bzw. ≥ 10) [S].

### 8.3 Umkämpfte Spots

- **Zentrum der Landbrücke:** 2 Mex (530, 490) und (494, 534), ≈ 57 WU auseinander, beide auf der engsten Stelle [V].
- **Brückenköpfe:** je Team 2 Mex auf der eigenen Brückenhälfte (≈ 100–150 WU vom Zentrum) [V].
- **Inseln:** je 5 Mex, erreichbar nur per Luft/Wasser (MVP: nur per Luft) [B].
- **Beach-Rand-Cluster** (NO: (549–565, 14–33)) liegt am NW-See direkt gegenüber dem SW-Rock-Ufer – Marine-Ziel [S].

## 9. Hydros [V]

| Zuständig | NO (x, z) | NO WU | SW WU |
|---|---|---|---|
| Air | (0,878, 0,076) | (899, 78) | (125, 946) |
| Beach | (0,675, 0,169) | (691, 173) | (333, 851) |
| Mid | (0,705, 0,278) | (722, 285) | (302, 739) |
| Rock | (0,889, 0,362) | (910, 371) | (114, 653) |

Air- und Beach-Hydro liegen ≈ 30 WU neben dem Start, Mid- und Rock-Hydro ≈ 80 WU entfernt im Hinterland [V].
Platz für Luftfabriken um den Hydro lassen (Adjacency) [B].

## 10. Reclaim-Felder (für später, M-Props) [B] qualitativ, [S] Werte/Positionen

| Feld | Lage | Inhalt (Vorschlag) |
|---|---|---|
| **Wrack-Feld Landbrücke** | Streifen um die Brückenachse von (0,40|0,60) bis (0,60|0,40), Breite ≈ 60 WU, dichter im Zentrum | 20–30 große Wracks (hoher Mass-Wert; in FA ohne das frühere Monkeylord-Wrack [B]), gesamt ≈ 3.000–5.000 Mass, exakt punktsymmetrisch |
| Unterwasser-Wracks | verstreut in beiden Seen, v. a. auf den Schelfen vor Beach und Brücke | [S] optional, Flair-Text „remains … under the waves“ [B]; 10–15 kleine Wracks je See |
| Wälder | Hinterland aller Starts, v. a. um Air (Dreieck-Mex, Teich-Umfeld) und zwischen Beach und Mid | Baumgruppen à 10–30 Bäume (je ≈ 1–5 Mass, Energie), in Clustern für Engineer-Patrol [B] |
| Felsen am Teich | Ufer von Teich NO (0,80–0,87 | 0,25–0,30) / Teich SW | 10–20 Felsen, Mass-reich [B „reclaim rocks near the lake“] |
| Felsen am Rock-Rücken und Eckgebirge-Rand | §4.2 | Felsbrocken als Mass-Reclaim [S] |
| Uferfelsen an der See-Ausbuchtung | (0,71–0,75 | 0,36–0,38) + Spiegel | 5–10 Felsen [V]/[S] |

## 11. Hinweise für `markers.json`/Heightmap [S]

- `sizeWu` 1.024, `heightScaleRaw` 32, `waterLevel` 20, Heightmap 1.025 × 1.025 u16 (1 Pixel = 1 WU).
- Starts in der Reihenfolge Army 0–7 aus §7; `mass` = 8 × 4 Start-Ring + 2 × 38 aus §8.2 = **108**; `hydro` = 8.
- Heightmap prozedural aus den Polygonen (§3.1) bauen: Signed-Distance zum Ufer → Schelf/Strand-Profil, Tiefenkern
  nach §3.2, Hügel per eigenem Rauschen (Seed fest), Fels/Klippen per Masken §4.2, danach NO-Hälfte auf SW spiegeln,
  damit die Karte exakt fair ist. Basisflächen und Mex-Umgebung (r ≈ 6 WU) glätten.
- Prüfkriterien für den Import: Landbrücke engste Stelle 70–80 WU begehbar; alle 4 Starts je Team über Land verbunden;
  Inseln ohne Landzugang; kein Mex im Wasser oder auf Steigung > Baugrenze.

## 12. Unsicherheiten und Abweichungen

- **Höhen** sind komplett geschätzt (die Vorschau ist eine Draufsicht ohne Höhen; nur „Inseln erhöht“ ist belegt).
- **Start-Ring**: 4 Mex je Start sind durch den Bauplan für Rear belegt und im Bild angedeutet (teilweise verdeckt),
  für die anderen Starts per Analogie angenommen; Ring-Radius 16 WU geschätzt.
- **Asymmetrien im Original:** NO hat Mex bei (0,879|0,222) und (0,969|0,257), SW an den gespiegelten Stellen
  stattdessen (0,094|0,652) und (0,031|0,656) (≈ 0,09 in z versetzt); übrige Paare weichen ≤ 0,03 ab. Für den
  Nachbau werden die NO-Werte gespiegelt.
- **Mass-Gesamtzahl** (108) ist aus dem Bild gezählt, nicht durch eine Textquelle bestätigt.
- **Tiefenwerte**: nur die relative Verteilung (Farbhelligkeit) ist gemessen; ob der helle Schelf im Original für
  Land-Einheiten teils begehbar ist, ist offen – hier bewusst nicht begehbar.
- **Wrack-/Baum-Positionen** sind nicht aus der Vorschau ablesbar; nur „viele hochwertige Wracks auf der Landbrücke“ ist
  belegt.
- Die Rollennamen variieren in der Community (Front = Mid, Rear = Air/Back, Rock = „Mountain“, Beach = „Naval“).

## 13. Quellen

- Vorschaubild FAF-Content-Server, `https://content.faforever.com/maps/previews/large/scmp_009.png` (256 × 256,
  mit Start-, Mass- und Hydro-Symbolen) – nur lokal als Referenz angesehen, nicht im Repo.
- Supreme Commander Wiki (Fandom), „Seton's Clutch“ (Größe 20, 8 Spieler, `SCMP_009`, Landbrücke mit Wracks, zwei
  erhöhte Inseln mit je 5 Mass, Flankenrollen, Rear = Luft): https://supcom.fandom.com/wiki/Seton's_Clutch
- Supreme Commander Wiki, „Seton's Clutch multiplayer strategy“ (Positionen Rear/Beach/Rock/Mid, Rear-Bauplan mit
  4 Start-Mex, Hydro + 2 Mex, 3 Mex Richtung Mid, Mex am Teich, 3 Mex Richtung Rock, Felsen-Reclaim am Teich):
  https://supcom.fandom.com/wiki/Seton's_Clutch_multiplayer_strategy
- Steam-Guide „Setons Clutch Multiplayer“ (Ground reclaimt Zentrums-Wracks, Air/Navy-Rollen):
  https://steamcommunity.com/sharedfiles/filedetails/?id=2674533608
- Suchergebnis-Zusammenfassungen zu FAF-Forum/YouTube („bottom left is the air player“, „middle left is the rock spot
  naval player“); FAF-Forum-Threads selbst („Seton's Clutch – Rock Spot“, „Typical setons“) waren nicht abrufbar.
