# Experimentals (T4) des Varkan-Kompakts

> **Status:** Designentwurf vom 2026-09-29, Branch `experimentals`. **Post-MVP.** Laut PLAN/features.json ist U16
> („Erstes Land-Experimental“) Post-MVP, U21 („Volles Experimental-Roster & Game-Ender“) und E17 („Endgame-Eco“)
> sind „Später/Nice-to-have“. Die sechs Einheiten sind trotzdem vollständig ausgearbeitet: Werte, Mechaniken,
> Feature-IDs, Modelle und Icons. Damit lassen sich Relationen, Silhouetten und Budgets schon heute prüfen.
> **Quelle der Zahlen:** `docs/design/roster.json` (Einträge mit `tech: 4`, `postMvp: true`, Gruppe `exp`). Die
> Tabellen hier und in `roster.md` §19 sind daraus erzeugt bzw. abgeschrieben. Bei Widerspruch gilt `roster.json`.
> **Werkzeuge:** `python3 tools/roster/gen.py && python3 tools/roster/md.py && python3 tools/roster/validate.py`,
> Modelle `content/models/varkan/exp_*.ts`, `pnpm models`, Screenshots `tools/heavy pnpm models:shots --only exp_…`.
> **Abgrenzung:** Keine FA-Namen und keine FA-Designs. Übernommen werden nur die Rollen (Riesen-Laufroboter, mobile
> Fabrik, Luft-Experimental, strategische Artillerie, Eco-Experimental) und die Zahlenrelationen.

---

## 1. Die sechs Experimentals auf einen Blick

| ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | Mass / Energy / BT | HP (+Schild) | Hauptwaffe | Tempo | Footprint / s | MS |
|---|---|---|---|---|---|---|---|---|---|
| `core:exp_lnd_walker` | **Stampfe** / Stamper | Experimenteller Sturmläufer | Riesen-Laufroboter (`UAL0401`, Gegenprobe `XSL0401`, `URL0402`) | 27.000 / 340.000 / 51.000 | 96.000 | Doppelglocke 2.500 DPS, RW 40 | 2,4 | 6×6 / 6 | PM1 |
| `core:exp_lnd_foundry` | **Kokille** / Mould | Mobile Gießhalle | Mobile Fabrik/Festung (`UEL0401`, Gegenprobe `XRL0403`) | 28.000 / 350.000 / 47.500 | 13.000 + 20.000 | 1.307 DPS (Kellen RW 100, Glocken, Flak) | 1,75 | 7×9 / 7 | PM2 |
| `core:exp_air_gunship` | **Kolkrabe** / Raven | Experimenteller Kampfschweber | Luft-Experimental, Gunship (`URA0401`, Gegenprobe `UAA0310`) | 29.000 / 800.000 / 48.000 | 74.000 | 1.334 DPS, RW 30 (Flak 60) | 8 | 7×7 / Luft | PM2 |
| `core:exp_str_arty` | **Konverter** / Converter | Strategische Artillerie (Game-Ender) | Strategische Artillerie (`UEB2401`, Gegenprobe `URL0401`, `XAB2307`) | 220.000 / 5.900.000 / 300.000 | 8.000 | 16.000 alle 8 s, RW 150–1.500, Splash 7 | – | 10×10 | PM3 |
| `core:exp_str_eco` | **Tiefenstich** / Deep Tap | Tiefenzapfwerk (Endgame-Eco) | Ressourcen-Generator (`XAB1401`) | 245.000 / 7.300.000 / 325.000 | 5.200 | – (20 M/s + 1.000 E/s, Bedarf bis 750 M/s / 75.000 E/s) | – | 12×12 | PM3 |
| `core:exp_str_shield` | **Mantel** / Mantle | Großschild | kein FA-T4; Relation zum T3-Schildgenerator (`UEB4301`) | 16.000 / 260.000 / 24.000 | 2.500 + 80.000 (r 60) | – | – | 8×8 | PM2 |

Alle sechs werden von Meistern (T3-Engineers, `ENGINEER & TECH3`) gebaut, auch die mobilen (§3.1). Hotbuild im Bau-Menü unter
**G = Großguss** (§3.8), Icons mit Klammer (§3.6), eigene Visuals, Tri-Budget 1.600 / 800 / 320.

---

## 2. FA-Referenzen (Relationen)

Die Zahlen stammen aus spooky-db `app/data/index.json` (Datenstand 3810, derselbe Stand wie beim MVP-Roster). Die DPS-Formel ist
`app/js/dps.js`. Stichproben gegen FAF `develop` (`units/*/…_unit.bp`) ergänzen Footprint, Footfall, Air-Tempo und das
Paragon-Skript. Die Werte stehen in `tools/roster/fa_ref.json`. Zitiert werden nur Blueprint-IDs und generische Rollen.

| BP | Rolle | Mass | Energy | BT | HP (+Schild) | DPS (spooky) | RW | Tempo | Todeswaffe | Anmerkung |
|---|---|---|---|---|---|---|---|---|---|---|
| `UAL0401` | Sturm-Laufroboter | 27.500 | 343.750 | 51.500 | 99.999 | 2.500 (Dauerstrahl) | 40 | 2,4 / 40° | 8.000 r7 | Footfall 3.500 r1, kein Friendly Fire; amphibisch |
| `XSL0401` | Sturm-Laufroboter | 26.500 | 330.000 | 46.875 | 67.000 | 3.888 | 47 | 2,5 | 7.000 r6 | Footprint 3×3, Regen 20 |
| `URL0402` | Spinnen-Laufroboter | 20.000 | 260.000 | 27.500 | 45.000 | 4.304 | 30 / 64 | 2,5 | 4.000 r6 | Stealth, 400 E/s |
| `UEL0401` | Mobile Fabrik/Festung | 28.000 | 350.000 | 47.500 | 12.500 + 20.000 (r 24/25) | 1.382 (ohne Torpedo 1.307) | 100 / 45 | 1,75 / 30° | 4.000 r7 | BP 135, 600 E/s; `develop`: Schild-Regen 200 statt 100 |
| `XRL0403` | Mega-Läufer mit Fabrik | 37.500 | 437.500 | 60.625 | 110.000 | 1.493 | 64 | 2,0 | 8.000 r9 | BP 45 |
| `URA0401` | Luft-Gunship | 29.000 | 812.000 | 48.000 | 75.000 | 1.334 | 30 / 60 | 9 (MaxAirspeed) | 5.000 r8 (Absturz) | Regen 75, 600 E/s |
| `UAA0310` | Luft-Träger | 45.000 | 1.530.000 | 50.625 | 40.000 + 30.000 | 4.558 | 30 / 120 | 8 | 7.000 r15 | Footprint 20×20 |
| `XSA0402` | Luft-Bomber | 48.000 | 1.920.000 | 67.500 | 52.000 | 1.236 | 90 / 64 | 18 | 7.000 r10 | Bombe 11.000 r19 |
| `UEB2401` | Strategische Artillerie | 224.775 | 5.994.000 | 300.000 | 8.000 | 2.000 (16.000 / 8 s) | 150–4.000 | – | – | Splash 7, v 160, FiringRandomness 0,22 |
| `URL0401` | Mobile strategische Artillerie | 220.000 | 4.000.000 | 240.000 | 9.000 (`develop` 17.000) | 1.600 | 150–4.000 | 1,5 | – | Splash 12 |
| `XAB2307` | Schnellfeuer-Strategieartillerie | 202.500 | 5.400.000 | 100.000 | 9.000 | 71 | 150–4.000 | – | – | Splash 2 |
| `XAB1401` | Ressourcen-Generator | 250.200 | 7.506.000 | 325.000 | 5.000 | – | – | – | Nuke 35.000 r25 | 20 M/s + 1.000 E/s Grundlast, deckt Bedarf bis 10.000 M/s / 1.000.000 E/s |

**Relationen, die das Design trägt (FA):**
- **T4 sind pro Mass viel schwächer als T3** und gewinnen über Konzentration, Reichweite, Regeneration, Crush und Unaufhaltsamkeit.
  Beispiel Sturm-Läufer gegen T3-Belagerungsbot: DPS/Mass nur 0,29×, HP/Mass 0,56× bei gleicher Mass (57 Titans für einen Läufer).
- **Bauzeit ≈ 1,7–1,9 BT pro Mass** bei den mobilen T4, bei Game-Endern 1,3–1,4. Mit 20 T3-Engineers ist ein Land-T4 in ≈ 80 s fertig,
  dann zieht die Baustelle aber ≈ 340 M/s. Die Wirtschaft ist die Grenze, nicht die Build Power.
- **Game-Ender** kosten ≈ 8× ein Land-T4, sind fragil (≈ 0,04 HP/Mass) und brauchen 300.000 BT.
- **Todeswaffen** liegen zwischen 4.000 und 8.000 bei r 6–9. Nur das Eco-Experimental hat eine Nuke (35.000 r25).

---

## 3. Gemeinsame Regeln aller T4

### 3.1 Bau und Baustelle (XM1, XM9)

- **Erbauer:** nur Meister (`ENGINEER & TECH3`) mit Assist (B2). Der Vogt kann es nicht, weil ACU-Enhancements (U14, „T3-Engineering“) Post-MVP sind.
  Das Land- und das Luft-T4 entstehen wie in FA **als Baustelle im Feld** (XM1 „Mobile Großbaustelle“). Die Baustelle ist ein
  Strukturfootprint, blockiert das Pathing (B1) und lässt sich fortsetzen (B6). Bei 100 % wird daraus die Einheit, die ausläuft bzw. abhebt.
- **Sichtbarkeit:** Die Baustelle ist ein normales Gebäude im Bau. Der Radar-Blip bleibt das neutrale Sechseck (I3, verrät nichts), im Fog
  bleibt ein Ghost (I2). **Neu (XM9):** Sieht ein Haus eine fremde T4-Baustelle in echter Sicht, meldet die Ansage „Großguss gesichtet“ (P8).
  Ab 75 % Baufortschritt kommt ein Minimap-Ping dazu (C16). Das verschärft FA leicht zugunsten der Gegenwehr, weil die Karten im MVP-Pool
  kleiner sind als typische FA-Karten.
- **Bau-Glut:** Der Gieß-Dissolve (faction.md §3.5) füllt die Baustelle glühend von unten. Auf Strategic-Zoom-Distanz ist so ein Großguss
  schon als leuchtendes Rechteck lesbar.

**Bauzeit mit N Meistern** (Build Power 32; der Fluss ist das, was die Baustelle dann zieht; FA mit T3-Engineer BP 32,5):

| Einheit | BT | 1 Meister | 10 | 20 | 40 | Fluss bei 20 Meistern |
|---|---|---|---|---|---|---|
| Stampfe | 51.000 | 1.594 s | 159 s | 80 s | 40 s | 339 M/s, 4.267 E/s |
| Kokille | 47.500 | 1.484 s | 148 s | 74 s | 37 s | 377 M/s, 4.716 E/s |
| Kolkrabe | 48.000 | 1.500 s | 150 s | 75 s | 38 s | 387 M/s, 10.667 E/s |
| Konverter | 300.000 | 9.375 s | 938 s | 469 s | 234 s | 469 M/s, 12.587 E/s |
| Tiefenstich | 325.000 | 10.156 s | 1.016 s | 508 s | 254 s | 482 M/s, 14.375 E/s |
| Mantel | 24.000 | 750 s | 75 s | 38 s | 19 s | 427 M/s, 6.933 E/s |

Alle FA-Vergleichszeiten liegen innerhalb von 2 % (Tabelle in `roster.md` §19). Realistisch baut man ein Land-T4 mit 10–15 Meistern in
2–3 Minuten bei 110–170 M/s. Das entspricht 6–10 Zapfstellen III und ist damit ein klares Spätspiel-Ziel.

### 3.2 Pathing, Größe, Engstellen (XM3)

- `sizeClass` = geforderte Clearance in 1-WU-Zellen (PLAN, Pathing-Tabelle „Grids“: Größenklasse s verlangt Clearance ≥ s). Das Blueprint-Schema erlaubt 0–7. Stampfe 6, Kokille 7 (Footprint 7×9).
  Mehr als 7 braucht keine T4-Einheit. Luft ist `sizeClass 0`, der Footprint 7×7 gilt nur für Baustelle und Landung.
- **Setons-Brücke:** engste Stelle 76,4 WU (Soll ≥ 72). Nebeneinander passen mindestens 8 Kokillen. Die Brücke ist also kein Problem.
  **Kritisch sind Basisgassen:** 8×8-Werke mit 2–4 WU Abstand sperren Stampfe und Kokille. Der Pfad führt dann außen herum, oder die Einheit
  überrollt Mauern (§3.3). Die Clearance-Komponenten pro (Layer, s) aus M5/M6 brauchen dafür zwei zusätzliche Größenklassen (6 und 7).
  Precompute-Kosten: +2 Komponenten-Layer.
- **Steering (M7):** T4 werden von kleineren Einheiten nicht blockiert. Die positionsbasierte Kollisionsauflösung („nach Masse und Priorität“)
  schiebt Einheiten mit `sizeClass ≤ 3` beiseite.

### 3.3 Crush und Überfahren (XM2)

| Einheit | Mauern / Wracks unter dem Footprint | kleine Einheiten | Fußtritt |
|---|---|---|---|
| Stampfe | überrollt (Mauer zerstört, Wrack zerdrückt ohne Reclaim-Verlust) | schiebt `sizeClass ≤ 3` beiseite | **3.000 Schaden r 1,2** je Aufsetzen (≈ alle 1,2 s), nur Land, kein Friendly Fire (FA-Footfall 3.500 r1) |
| Kokille | überrollt | schiebt `sizeClass ≤ 3` beiseite | – (Kette) |

Der Fußtritt ist eine eigene Waffe (`core:wpn_stamper_footfall`), geht aber nicht in die DPS/Mass ein, genau wie der FA-Footfall
nicht in die spooky-DPS eingeht. Er tötet Stichel, Punze, Kelle und Meißel sofort. Der Fallhammer (3.200 HP) überlebt einen Tritt knapp.

### 3.4 Todeswaffen und Wracks (XM4, K5, K8, K14, P14)

| Einheit | Schaden / Radius (FA) | Verzögerung | Wirkung |
|---|---|---|---|
| Stampfe | 8.000 / r7 (8.000 / r7) | 2,0 s: kippt in Laufrichtung | tötet jede T3-Landeinheit im Radius |
| Kokille | 4.000 / r7 (4.000 / r7) | 1,5 s | Kesselbruch |
| Kolkrabe | 5.000 / r8 (5.000 / r8) | 3,0 s: trudelt, dann Aufschlag (K12) | Absturzort bestimmt der Flugvektor |
| Tiefenstich | 35.000 / r25 (Nuke 35.000 / r25) | 2,0 s | Kettenreaktion über K14 (Glutkessel, Speicher). Nicht neben Werke stellen. |
| Konverter, Mantel | – | – | wie FA ohne Todeswaffe |

Alle Todeswaffen treffen auch Eigenes (K8). Die Verzögerung ist ein Fluchtfenster und das „Gesicht“ des Großereignisses (P14: Druckring,
Kamera-Shake, abschaltbar). **Wracks:** 90 % der Mass (FA `Wreckage.MassMult 0.9`). Nach einem T4-Gefecht liegen also 24.000–26.000 Mass
Schlacke auf dem Feld. Das ist der Reclaim-Schub, der FA-Spätspiele kippt („Schlacke ist auch Erz“).

### 3.5 Kitbash- und Silhouettenregeln für T4

- **Maßstab:** T4 werden in Spielgröße modelliert (`kitbash.scale` 1,0), nicht in T1-Basisgröße.
- **Rollen-Grammatik bleibt:** Jede Waffe trägt die Signaturform ihrer Rolle (faction.md §5.2). Glocke + waagerechtes Rohr heißt Direktfeuer,
  offene Kelle heißt Artillerie, senkrechte Rohre bzw. Rost heißen Flak, Mast + waagerechter Ring heißt Schild, U-Portal heißt Fabrik. Schlot und
  Glutkern gibt es nur bei Flow-Einheiten (Kokille = FACTORY, Tiefenstich = ECONOMIC).
- **T4-Kennung am Modell: Keramik-Klammer.** Statt 1–3 Tech-Streifen tragen T4 zwei keramikweiße Winkelleisten „[ ]“ auf Deck bzw. Sockel
  (`content/models/varkan/_t4.ts`), als Gegenstück zur Icon-Klammer. Ab LOD1 entfällt die Klammer mit den Kleinteilen, dann übernimmt das Icon.
- **Budget:** LOD0/1/2 ≤ **1.600 / 800 / 320** Tris (`EXPERIMENTAL_BUDGET` in `@faf/modelkit`, greift automatisch bei `tech: 4`), Parts ≤ 16,
  animiert ≤ 8 (PartStream-Limit). Jedes T4 hat ein **eigenes Visual** (kein Superset mit T1–T3). Das sind 28 + 6 = 34 Visuals, also unter
  den 40, mit denen DECISIONS 17 das Draw-Budget getestet hat.
- **LOD-Distanzen:** 120 / 360 WU (Gebäude 120 / 400) statt 60 / 180. Die Meshes sind 4–10× so groß.
- **Strategic Zoom:** Unter 25 px Bildschirmlänge ersetzt das Icon das Mesh (faction.md §3.2). Weil ein T4 6–14 WU misst, bleibt das Mesh
  2–10× länger sichtbar als bei einer Punze. Im Kontaktabzug und im Silhouettenblatt (`models:shots`) ist jedes T4 bei 32 px als eigene
  Form lesbar.
- **Silhouetten-Pflichtpaare T4** (gleiche Grammatik, getrennt durch Größe ≥ 2,5×, Klammer und Icon): Stampfe ↔ Vogt, Kolkrabe ↔ Krähe,
  Konverter ↔ Hochofen, Mantel ↔ Schirm III, Kokille ↔ Schürze, Tiefenstich ↔ Zapfstelle III (`roster.json` → `silhouettePairs.t4`).

### 3.6 Strategic Icon: die Klammer (XM8)

faction.md §6.4 hatte es angekündigt: „Experimentals (Post-MVP) bekommen eine eckige Klammer um die Grundform.“ Umgesetzt ist das in
`content/icons/grammar.ts` (`bracketMarkup`, `bracketSvg`, Datei `svg/notches/t4.svg`):

- Icon-ID `<form>_<glyph>_t4`. Grundform = Domäne, Glyphe = Rolle wie bei T1–T3. **Statt der Tech-Kerben** stehen links und rechts der Form
  keramikweiße Klammern „[ ]“ (4 DE Strich, 5 DE Serifen, Graphit-Halo), außerhalb der 32×32-Form wie die Kerben. So kollidiert nichts
  mit Glyphe oder Auswahlring.
- **Faktor 1,5** (T3 mobil 1,3, Vogt 1,6). Der Vogt bleibt das größte Icon, T4 fallen im Strategic Zoom sofort auf.
- Ghost-Variante (Gebäude) mit Klammer. Der Radar-Blip bleibt neutral (Achteck/Dreieck/Sechseck) und verrät weder T4 noch Rolle.
- Icons: Stampfe `land_bot_t4`, Kokille `land_fac_land_t4` (Landform mit Fabrik-Glyphe heißt „mobile Landfabrik“), Kolkrabe `air_direct_t4`,
  Konverter `struct_arty_t4`, Tiefenstich `struct_mass_t4`, Mantel `struct_shield_t4`. Es gibt keine neue Glyphe, es bleibt bei 19 Tokens.

### 3.7 Namenssystem

Rufnamen folgen dem Wortfeld der Rolle, und die T4-Stufe nimmt das größte Gerät aus diesem Feld (faction.md §7):

| Rolle | Wortfeld | T1–T3 | T4 |
|---|---|---|---|
| Direktfeuer Land | Schmiedewerkzeug → Hütten-Großgerät | Punze … Fallhammer | **Stampfe** / Stamper (Pochstempel des Erzpochwerks) |
| Fabrik (mobil) | Gießform | – | **Kokille** / Mould (Dauerform der Gießerei) |
| Luft | Schornsteinvögel (Rabenvögel) | Lerche … Elster | **Kolkrabe** / Raven (größter Rabenvogel, Verwandter von Krähe, Dohle, Elster) |
| Artillerie | Gießgerät | Kelle … Hochofen | **Konverter** / Converter (kippbares Frischgefäß) |
| Schild | Schutzkleidung der Gießer | Schürze, Schirm | **Mantel** / Mantle (Hitzeschutzmantel) |
| Eco (Gebäude, Funktionsname) | Zapfen | Zapfstelle I–III | **Tiefenstich** / Deep Tap (Rolle „Tiefenzapfwerk / Resource Works“) |

Grep gegen die FA-Einheitennamen (spooky-db, 503 Blueprints): kein Treffer. Die Markenrecherche steht wie beim MVP-Roster noch aus.

### 3.8 Hotbuild: Untermenü „Großguss“

Im Bau-Menü ist **G** frei (5. Spalte, Reihe 2). G öffnet das Untermenü Großguss (nur mit Meister in der Auswahl). Dessen Tasten folgen den Rollen
der übrigen Menüs:

| | Q | W | E | A | S | F |
|---|---|---|---|---|---|---|
| Großguss | Stampfe (Direktfeuer = Landwerk Q) | Konverter (Artillerie = Landwerk W) | Kokille (Bauen = Landwerk E) | Tiefenstich (Wirtschaft) | Kolkrabe (Luft = Bau S) | Mantel (Schild = Bau F) |

---

## 4. Die Einheiten im Detail

### 4.1 Stampfe / Stamper – `core:exp_lnd_walker` (PM1, U16)

- **Rolle:** Experimenteller Sturmläufer. **FA-Referenzrolle:** Riesen-Laufroboter (`UAL0401`, Gegenprobe `XSL0401`).
- **Fantasy:** Das Pochwerk einer Hütte, auf zwei Beine gestellt: Jeder Schritt ist ein Stempelschlag, der Erz und Panzer gleich klein macht.
  Die Häuser gießen die Stampfe nur, wenn eine Front seit Stunden steht, denn „was die Stampfe überquert hat, ist Schlacke, und Schlacke ist auch Erz“.
- **Kosten:** 27.000 Mass, 340.000 Energy, 51.000 BT. **HP** 96.000, Regeneration 10 HP/s.
- **Waffen:**
  - `core:wpn_stamper_twin_bell` Doppelglocke: 2 × 500 Schaden alle 0,4 s (abwechselnd) = **2.500 DPS**, RW 2–40, Projektil linear (v 45), Splash 1,0.
  - `core:wpn_stamper_footfall` Stampfen: 3.000 Schaden r 1,2 je Schritt, nur Land, kein Friendly Fire (Crush, §3.3).
  - Keine Flugabwehr.
- **Bewegung:** 2,4 WU/s, 40 °/s, Beschleunigung 1,2. **Footprint** 6×6, **sizeClass 6**, Sicht 50.
- **Balance:** DPS/Mass +1,9 %, HP/Mass −2,2 %, Produkt −0,4 % gegen `UAL0401`. T3-Äquivalent: 54 Fallhammer (FA 57 Titans), T4/T3-Verhältnis
  DPS/Mass +6,1 %, HP/Mass −1,3 % gegenüber FA. Eigene Setzung: Projektilkanonen statt Dauerstrahl. Die Doppelglocke hat Flugzeit
  (v 45) und kann overkillen. Dafür bekommt sie Splash 1,0, und die Summe bleibt 2.500 DPS.
- **Besonderheiten:** Crush + Fußtritt (XM2). Todeswaffe Gussbruch 8.000 r7 nach 2,0 s (XM4). Wrack 24.300 Mass.
- **Konter:** Luft (keine Flugabwehr), Artillerie auf Abstand (Pfanne 85 WU, Hochofen 200 WU), Reißnadel-Pulks kiten (58 WU > 40 WU),
  die Baustelle früh angreifen. Ein Konverter-Treffer nimmt 1/6 der HP.
- **Mechaniken / Feature-IDs:** U16, B1, B2, B6, M5, M6, M7, K4, K5, K8, P14, A16, C2 · neu XM1, XM2, XM3, XM4, XM8, XM9.
- **Kitbash:** Becken (hull) · Beine L/R (`legs`, Stampffüße Ø 1,7 WU) · Torso-Wanne (team-Deck, Führerstand mit Sichtschlitz, liegender
  Rückenkessel, Keramik-Klammer, zwei Schulterglocken, alles `turret`, yaw) · Rohre L/R (pitch). **5 animierte Parts.**
  **Silhouette:** zwei Säulen + breiter Querbalken + zwei lange Rohre, ein „Π mit Hörnern“, 6,3 WU hoch (2,6× Vogt).
  **Tris 948 / 518 / 184**, Team-Draufsicht 44,9 %, Glut 0,1 %, Kupfer 11,3 %.
- **Icon** `land_bot_t4` · **Hotbuild** Bau → G → Q · **Meilenstein** PM1.

### 4.2 Kokille / Mould – `core:exp_lnd_foundry` (PM2, U21)

- **Rolle:** Mobile Gießhalle (mobile Fabrik + Festung). **FA-Referenzrolle:** mobile Fabrik/Festung (`UEL0401`, Gegenprobe `XRL0403`).
- **Fantasy:** Eine ganze Gießhalle auf Ketten, die an der Front anhält, das Heck öffnet und Panzer ausgießt wie Barren aus der Form. Unter
  ihrer Kuppel sammeln sich die Häuser zum letzten Vorstoß: Wo die Kokille steht, ist die Werkhalle.
- **Kosten:** 28.000 Mass, 350.000 Energy, 47.500 BT. **HP** 13.000 + **Kuppel** 20.000 (r 24, Regen 100/s ab 1 s, Neuaufbau 120 s,
  Unterhalt 600 E/s). Build Power 135, Speicher 200 M / 1.000 E.
- **Waffen:**
  - `core:wpn_foundry_ladle` Deckskellen: 3 × 250 / 1,0 s = **750 DPS**, RW 100, ballistisch, Splash 1,5.
  - `core:wpn_foundry_bell` Flankenglocken: 2 × 150 / 0,6 s = **500 DPS**, RW 45.
  - `core:wpn_foundry_aa` Rostkamm: 40 / 0,7 s = **57 DPS** gegen Luft, RW 45.
- **Bewegung:** 1,75 WU/s, 30 °/s. **Footprint** 7×9, **sizeClass 7** (Schema-Maximum), Sicht 32.
- **Balance:** DPS/Mass ±0 % (gegen FA ohne Torpedo, Marine Post-MVP), HP+Schild/Mass +1,5 %. T3-Äquivalent (Fallhammer) +4,2 % / +2,5 %.
- **Besonderheiten:** Mobile Fabrik mit der Bauliste von Landwerk III, baut nur im Stand, Ausgang Heckrampe, Rally relativ zum Träger (XM5).
  Die Kuppel deckt Begleiter (Radius 24) und fällt im Energy-Stall (E3) aus. Toggle Schild (C17). Crush (Mauern, Wracks, schiebt ≤ s3).
  Todeswaffe 4.000 r7 nach 1,5 s. Wrack 25.200.
- **Konter:** Energy-Stall erzwingen (600 E/s), Direktfeuer unter die Kuppel tragen (Stampfe, Fallhammer-Pulk), nach dem Kuppel-Kollaps
  bomben (Flak nur 57 DPS). Langsam, also für Hochofen und Konverter ein sicheres Ziel (2 Konverter-Treffer brechen die Kuppel).
- **Mechaniken / Feature-IDs:** U21, U5, B3, K10, K2, K4, K12, M5, M6, M7, C17, E3, P14, A16, C2 · neu XM1–XM5, XM8, XM9.
- **Kitbash:** vier Kettenblöcke, Deck mit Bugfase (team), **U-Portal** mit Stirnwand, glühendem Werkhallentor und Gießrinne, Heckrampe,
  zwei Schlote mit Glutkrone, Kupferleitungen · Glocken L/R (yaw) · Kellen L/R (yawpitch) · Rostkamm (yaw) · Schildring Ø 8 WU (spin) als
  höchster Punkt. **6 animierte Parts.** **Silhouette:** flacher Block mit riesigem Ring darüber und offenem U am Heck.
  **Tris 1.234 / 710 / 304**, Team 52,0 %, Glut 1,3 %, Kupfer 6,3 %.
- **Icon** `land_fac_land_t4` · **Hotbuild** Bau → G → E · **Meilenstein** PM2.

### 4.3 Kolkrabe / Raven – `core:exp_air_gunship` (PM2, U21)

- **Rolle:** Experimenteller Kampfschweber (Luft-Experimental). **FA-Referenzrolle:** Luft-Gunship (`URA0401`, Gegenprobe `UAA0310`).
- **Fantasy:** Vier Ringdüsen tragen eine Gussplatte, so schwer wie ein Werk, über die Linien, und darunter hängen die Glocken. Wenn sein
  Schatten über eine Basis zieht, nennen die Gießer das „Rabenwetter“.
- **Kosten:** 29.000 Mass, 800.000 Energy, 48.000 BT. **HP** 74.000, Regeneration 70 HP/s, Unterhalt 600 E/s.
- **Waffen:**
  - `core:wpn_raven_bells` Hängeglocken: 2 × 320 / 0,7 s = **914 DPS**, RW 30, Splash 3.
  - `core:wpn_raven_rockets` Rumpfraketen: 3 × 200 / 2,0 s = **300 DPS**, RW 30.
  - `core:wpn_raven_aa` Flakkamm: 2 × 150 / 2,5 s = **120 DPS** gegen Luft, RW 60, Lenkflugkörper (K11).
- **Bewegung:** 8 WU/s (FA 9; Relation Krähe 12 zu FA-T2-Gunship 13,5), 20 °/s, schwebt tief (≈ 12 WU, FA-Elevation 12). **Footprint** 7×7
  (Baustelle/Landung), sizeClass 0, Sicht 46.
- **Balance:** DPS/Mass +0,1 %, HP/Mass −1,3 % gegen `URA0401`. T3-Äquivalent: Varkan hat keine T3-Luft (U12 Post-MVP), deshalb der
  Vergleich mit der Krähe (T2-Gunship, FA `UEA0203`): +4,2 % / −5,3 %.
- **Besonderheiten:** Wird von Meistern gebaut, braucht also **kein T3-Luftwerk**. Im Energy-Stall halbe Feuerrate. Absturz 5.000 r8 nach 3 s
  Trudeln (K12, XM4). Wrack 26.100.
- **Konter:** Hochrost (SAM), Trommelsieb, Turmfalken-Schwärme. Ohne T3-Luft ist der Kolkrabe das einzige Varkan-Mittel, Luftüberlegenheit
  im Spätspiel zu erzwingen, und genau deshalb bleibt er bei FA-Werten und wird nicht aufgewertet.
- **Mechaniken / Feature-IDs:** U21, U11, K3, K4, K11, K12, E3, P14, A16, C2 · neu XM1, XM4, XM8, XM9.
- **Kitbash:** achteckige Deckscheibe (team) mit Bugkeil, vier Kupfer-Ausleger zu vier Ringdüsen (team), Bauch-Raketenkessel, Flak-Rost
  mit vier senkrechten Rohren, Keramik-Klammer · 4 Rotoren (spin) · 2 hängende Glocken mit Rohr (yaw). **6 animierte Parts.**
  **Silhouette:** Kreuz aus vier Ringen um eine Scheibe, zwei Rohre vorn, keine Flügel. **Tris 1.290 / 778 / 312**, Team 75,7 %, Kupfer 8,0 %.
- **Icon** `air_direct_t4` · **Hotbuild** Bau → G → S · **Meilenstein** PM2.

### 4.4 Konverter / Converter – `core:exp_str_arty` (PM3, U21 Game-Ender)

- **Rolle:** Strategische Artillerie. **FA-Referenzrolle:** strategische Artillerie (`UEB2401`, Gegenprobe `URL0401`, `XAB2307`).
- **Fantasy:** Die größte Birne, die je gegossen wurde: Sie kippt, der Kern schießt als weißglühender Guss über die ganze Karte. Die Charta
  kennt keinen Frieden, nur Häuser, die den Konverter noch nicht fertig haben.
- **Kosten:** 220.000 Mass, 5.900.000 Energy, 300.000 BT. **HP** 8.000.
- **Waffe:** `core:wpn_converter_shell` Konverterguss: **16.000 Schaden alle 8,0 s = 2.000 DPS**, RW **150–1.500**, ballistisch (v 160),
  Splash 7, Streuung σ ≈ 1,2 % der Distanz. Flugzeit ≈ 9 s auf 1.000 WU. Friendly Fire.
- **Balance:** DPS/Mass +2,2 %, HP/Mass +2,2 %, Produkt +4,4 %, Pulk-DPS/Mass +2,2 % gegen `UEB2401`. T3-Äquivalent: 4,6 Hochöfen
  (FA 3,1 Duke-Stellungen, weil der Hochofen nur 67 % kostet): +2,2 % / +2,2 %.
- **Reichweite, begründete Abweichung:** FA 4.000 deckt Karten bis 81 km (M14). Varkan setzt **1.500 WU**. Das deckt jede MVP-Karte ab, auch
  die Setons-Diagonale (1.448 WU), bleibt auf künftigen 40-km-Karten aber eine Position und keine Allmacht. Der Hochofen (T3) liegt bei 200 WU,
  der Sprung ist also gewollt: Der Konverter ist ein **Game-Ender**, kein besserer Hochofen.
- **Schild-Interaktion** (ein Schütze): Schirm II bricht mit 1 Schuss, Schirm III mit 2 (8 s), die Kuppel der Kokille mit 2, der **Mantel mit 6 (40 s)**.
- **Mechaniken / Feature-IDs:** U21, K13, K2, K4, K6 (Attack-Ground), K8, K10, I2, I3, C15, P8, P14, A21, C2 · neu XM6 (Feuern auf Intel
  außerhalb der Sicht, Streuung, Einschlagwarnung für den Beschossenen), XM8, XM9.
- **Konter:** Mantel über dem Kern, die Baustelle angreifen (300.000 BT, XM9 meldet sie), Vorstoß mit Stampfe oder Kolkrabe (8.000 HP, keine
  Eigenverteidigung), später Radar-Jamming (I5).
- **Kitbash:** Sockel 10×10 mit Randband (team) und Keramik-Klammer · Drehbühne mit zwei Wangen, Zapfenlagern und zwei Gegengewichten
  (`boom`, yaw) · Konverterbirne (team, Boden rund, Hals konisch, offene Mündung) mit Zapfenachse und Steilrohr 60° (`ladle`, pitch).
  **2 animierte Parts.** **Silhouette:** Riesenrund mit langem Strich, **14 WU hoch, höchstes Bauwerk**. **Tris 796 / 504 / 204**, Team 23 %.
- **Icon** `struct_arty_t4` · **Hotbuild** Bau → G → W · **Meilenstein** PM3.

### 4.5 Tiefenstich / Deep Tap – `core:exp_str_eco` (PM3, E17)

- **Rolle:** Tiefenzapfwerk / Resource Works (Endgame-Eco). **FA-Referenzrolle:** Ressourcen-Generator (`XAB1401`).
- **Fantasy:** Wo die Zapfstellen nur Adern anzapfen, sticht der Tiefenstich durch die Kruste bis in den Mantel von Kessa. Die Glutsäule
  im Bohrturm ist das hellste Licht der Karte, und wenn sie bricht, ist das auch weithin zu sehen.
- **Kosten:** 245.000 Mass, 7.300.000 Energy, 325.000 BT. **HP** 5.200. Speicher +100.000 E.
- **Ertrag (XM7):** Grundlast **20 M/s + 1.000 E/s**. Darüber deckt er den Bedarf des Hauses bis **750 M/s und 75.000 E/s**
  (Ertrag = Grundlast + clamp(Bedarf − Einkommen, 0, Deckel), je Eco-Tick nach der Stall-Auflösung E3, deterministisch).
- **Begründete Abweichung:** Bei FA liegt der Deckel bei 10.000 M/s / 1.000.000 E/s, also praktisch unbegrenzt. Der Varkan-Deckel hält das Verhältnis
  E:M = 100:1 wie FA, lässt ein zweites Zapfwerk sinnvoll bleiben und die Eco-Kurve im Unit-Cap (U7). Zum Vergleich: 750 M/s entsprechen 41,7 Zapfstellen III
  (Kette I→III zusammen 226.500 Mass, aber 42 Spots, die keine 1v1-Karte hat). Die Amortisation bei vollem Bedarf dauert 327 s, beim Paragon
  bei gleichem Verbrauch 334 s.
- **Balance:** HP/Mass +6,2 % gegen `XAB1401` (5.200 statt 5.000 HP, Kosten −2 %).
- **Todeswaffe:** Tiefenbruch 35.000 r25 nach 2 s (FA-Nuke 35.000 r25), Kettenreaktion über K14.
- **Konter:** 5.200 HP, der Konverter tötet ihn mit einem Treffer. Kolkrabe-Vorstoß, Bomber. Der Standort ist die Verteidigung, deshalb steht er
  unter einem Mantel und weit weg von den Werken.
- **Mechaniken / Feature-IDs:** E17, E1, E2, E3, E4, K8, K14, P14, A16, C10, C2 · neu XM7, XM8, XM9.
- **Kitbash:** Sockel 12×12 mit Randband (team), Keramik-Klammer, innerer Kranz mit Glut im Bohrloch, Bohrturm aus vier Streben mit
  Glutsäule, vier Eckschlote mit Glutkrone und Kupferleitungen · äußerer Kranz (team, spin) · mittlerer Kranz (Kupfer, spin gegenläufig) ·
  Pumpenkopf mit Glutbändern (spin). **3 animierte Parts.** **Silhouette:** Turm mit Kopf in einem Ring aus vier Schloten, als „Raute + Flamme“
  in Riesengröße. **Tris 1.166 / 728 / 286**, Team 26,2 %, **Glut 3,6 %** (Glutkern-Band 3–6 %).
- **Icon** `struct_mass_t4` · **Hotbuild** Bau → G → A · **Meilenstein** PM3.

### 4.6 Mantel / Mantle – `core:exp_str_shield` (PM2, Varkan-Ergänzung, Game-Ender-Konter)

- **Rolle:** Großschild. **FA-Referenzrolle:** Es gibt kein FA-Schild-Experimental. Die Relation läuft pro Mass gegen den T3-Schildgenerator
  (`UEB4301`), die Gegenprobe gegen die Festungskuppel von `UEL0401`.
- **Fantasy:** Der Hitzemantel, den die Gießer vor den Abstich hängen, als Kuppel über einem ganzen Haus. Unter dem Mantel wird weiter
  gegossen, auch wenn draußen der Konverter des Nachbarn kippt.
- **Kosten:** 16.000 Mass, 260.000 Energy, 24.000 BT. **HP** 2.500 + **Kuppel 80.000**, Radius **60**, Regen **400/s** ab 1 s, Neuaufbau
  60 s, **Unterhalt 2.000 E/s**. Toggle Schild (C17).
- **Balance:** HP+Schild/Mass −2,8 % gegen `UEB4301` (FA-Upgradekosten, wie Schirm III im Roster). T3-Äquivalent: 5 Schirm III
  (87.600 HP) auf 2,25× Fläche, HP-Verhältnis −5,8 %.
- **Warum T4:** Die Kuppel verändert Artillerie-Rechnungen grundsätzlich. Ein einzelner Hochofen bricht den Mantel nie (400 HP/s × 14 s >
  5.500 pro Schuss), der Konverter braucht 6 Treffer (40 s), eine Stampfe 32 s Dauerfeuer. Das ist die geplante Antwort auf den Game-Ender.
- **Konter:** Energy-Stall (2.000 E/s, E3 lässt die Kuppel sofort fallen), unter die Kuppel laufen (Stampfe, Kokille, alle Bodentruppen),
  Konverter + 2 Hochöfen im Takt. Todeswaffen innerhalb der Kuppel wirken voll.
- **Mechaniken / Feature-IDs:** K10, E3, C15, C17, P14, U21, A16, C2 · neu XM8, XM9. Die Kuppel mit 60 WU ist für den Fresnel-/Ripple-Shader
  aus K10 ein Größentest (Kuppel-Mesh-LOD).
- **Kitbash:** Sockel 8×8 mit Randband (team) und Keramik-Klammer, Schürze, stehender Generatorkessel mit Kupferbändern, Mast, unterer Ring
  (statisch) · mittlerer Ring (Kupfer, spin) · oberer Ring Ø 7,6 WU (team, spin gegenläufig) mit Mastkappe. **2 animierte Parts.**
  **Silhouette:** Kelch aus drei gestaffelten Ringen, 9,3 WU hoch. **Tris 824 / 584 / 270**, Team 28,3 %.
- **Icon** `struct_shield_t4` · **Hotbuild** Bau → G → F · **Meilenstein** PM2.

---

## 5. Balance-Prüfung (tools/roster)

`validate.py` rechnet alles neu und prüft (Stand dieses Entwurfs):

| Prüfung | Grenze | Ergebnis |
|---|---|---|
| DPS/Mass gegen FA-T4-Referenz | ±25 % hart, ±15 % Ziel | max. +2,2 % (Konverter) |
| HP/Mass (inkl. Schild) | ±25 % / ±15 % | max. +6,2 % (Tiefenstich) |
| Produkt DPS/Mass × HP/Mass | ±15 % | max. +4,4 % (Konverter) |
| Pulk-DPS/Mass (ARTILLERY) | ±15 % | +2,2 % (Konverter) |
| T3-Äquivalent (T4/T3-Verhältnis gegen FA-Verhältnis) | ±25 % | max. +6,1 % (Stampfe gegen Fallhammer) |
| Bauzeit mit N Meistern gegen FA mit T3-Engineers | – | innerhalb von 2 % |
| Kennzeichnung | `tier: T4`, `postMvp`, `msFirst` PM1–3, Feature-IDs existieren in features.json, Mechaniken in `experimentalMechanics` | ok |
| Kitbash | Parts ≤ 16, animiert ≤ 8, Schätzung ≤ 1.600, Keramik-Klammer, keine Streifen, Icon `_t4` | ok |
| Pathing | sizeClass 1–7 (Schema), mindestens 8 T4 nebeneinander auf der Setons-Brücke | ok |
| MVP unverändert | 50 Einträge, alle MVP-Gates und die Treffer-Matrix wie vorher | ok |

**Methodische Hinweise**
- Die FA-DPS der Referenz nimmt die Waffen, die es bei uns gibt: Kokille ohne Torpedo, Stampfe mit Strahl + Greifer, ohne Footfall.
- **Pro-Mass-Schwäche der T4 ist gewollt** (siehe T3-Äquivalent): Eine Stampfe hat 31 % der DPS und 56 % der HP von 54 Fallhämmern. Ihr Wert
  liegt in Konzentration (ein Ziel, 96.000 HP an einem Punkt), Regeneration, Reichweite 40 gegen 24, Crush und darin, dass Splash und Snipes
  an ihr abprallen.
- Die Zahlen sind Startwerte für ein Post-MVP-Balancing und stehen vor dem Umbau nochmals gegen den dann aktuellen FAF-Stand
  (Scathis und Fatboy haben sich in `develop` seit 3810 geändert, siehe §2).

---

## 6. Neue Mechaniken (Vorschlag, noch ohne Eintrag in features.json)

| Code | Mechanik | baut auf | gebraucht von |
|---|---|---|---|
| XM1 | Mobile Großbaustelle (Baustelle mit Footprint, wird zur Einheit) | B1, B2, B6, U16 | Stampfe, Kokille, Kolkrabe |
| XM2 | Massiv/Crush: Vorrang im Steering, Mauern/Wracks überrollen, Fußtritt-Schaden | M7, K4, K5 | Stampfe, Kokille |
| XM3 | Größenklassen 6–7: Clearance-Komponenten, Footprint 7×9 | M5, M6 | Stampfe, Kokille |
| XM4 | Verzögerte Todeswaffe mit Umkippen/Absturz | K4, K8, K12, P14 | Stampfe, Kokille, Kolkrabe, Tiefenstich |
| XM5 | Mobile Fabrik (Bauliste, Heckausgang, Rally am Träger) | B3, U5 | Kokille |
| XM6 | Strategische Reichweite: Intel-Ziele, Streuung, Einschlagwarnung | K2, K6, K13, I2, I3, P8 | Konverter |
| XM7 | Bedarfsdeckende Produktion mit Deckel | E1–E4 | Tiefenstich |
| XM8 | T4-Icon-Klammer, Faktor 1,5, längere Mesh-Sichtbarkeit | C2 | alle |
| XM9 | „Großguss gesichtet“-Ansage und Minimap-Ping | I1, P8, C16 | alle |

Vorschlag für features.json: XM1–XM5 als Teil von **U16** (Land-Experimental), XM6/XM7 als Teil von **U21/E17**, XM8/XM9 als Teil von U16.
Sie sind hier bewusst nur als Codes geführt, weil die Featureliste nicht Teil dieses Arbeitspakets ist.

---

## 7. Meilensteine nach dem MVP (Vorschlag)

| MS | Inhalt | Einheiten | Voraussetzungen |
|---|---|---|---|
| **PM1** (U16) | Erstes Land-Experimental: Großbaustelle, Crush, Größenklasse 6, verzögerte Todeswaffe, T4-Icon, Großguss-Menü, KI-Grundlagen A16 | Stampfe | MS14 (U10 T3-Land, B2), P14 für den Todeseffekt |
| **PM2** (U21, Teil 1) | Mobile Fabrik, Größenklasse 7, Luft-T4, Großschild | Kokille, Kolkrabe, Mantel | PM1, U11 (Luft), K10 (Schilde) |
| **PM3** (U21 Game-Ender, E17) | Strategische Reichweite, Einschlagwarnung, bedarfsdeckende Produktion, Nuke-Todeswaffe | Konverter, Tiefenstich | PM2 (Mantel als Konter muss vorher stehen), P14 |

**Abweichung zur Featureliste:** U21 hängt dort von U12 (T3-Luft), U17 (Marine) und K17 (Nukes) ab. Das Varkan-Roster braucht davon nichts. Der
Kolkrabe wird von Meistern gebaut, es gibt kein See-Experimental, und der Tiefenstich nutzt eine Todeswaffe, keine Nuke-Mechanik aus K17. Vorschlag:
U21 teilen in „U21a Land/Luft-T4 + Game-Ender“ (Abhängigkeiten U16, U11, K10, K13) und „U21b See-Experimentals“ (U17).

---

## 8. Modelle, Icons, Werkzeuge

| Datei | Inhalt |
|---|---|
| `content/models/varkan/exp_*.ts` | 6 Modelle in Spielgröße (Kitbash-DSL) |
| `content/models/varkan/_t4.ts` | `ceramicBracket()`, die gemeinsame T4-Kennung |
| `packages/modelkit/src/model.ts`, `build.ts`, `faction.ts` | `tech: 4`, `EXPERIMENTAL_BUDGET` (1.600 / 800 / 320), Roster-Übernahme von `tech: 4` |
| `content/icons/grammar.ts`, `build.ts` | `_t4`-IDs, Klammer statt Kerben, Faktor 1,5, `svg/notches/t4.svg` |
| `apps/model-viewer/src/views/icons.ts` | Klammer und Beispiel-Icon in der Icon-Übersicht |
| `tools/model-shots` | neue Option `--only exp_lnd_walker,…` (nur Einzelbilder, schnelle Iteration) |
| `tools/roster/*` | T4-Referenzen, Generator, `roster.md` §19, Validator |

| Modell | Tris L0/L1/L2 | Bounds (WU) | Team-Draufsicht | Glut | Kupfer | animierte Parts |
|---|---|---|---|---|---|---|
| Stampfe | 948 / 518 / 184 | 7,0 × 6,3 × 7,6 | 44,9 % | 0,1 % | 11,3 % | 5 (Beine ×2, Torso, Rohre ×2) |
| Kokille | 1.234 / 710 / 304 | 7,8 × 7,5 × 11,4 | 52,0 % | 1,3 % | 6,3 % | 6 (Glocken ×2, Kellen ×2, Flak, Ring) |
| Kolkrabe | 1.290 / 778 / 312 | 9,2 × 2,9 × 9,5 | 75,7 % | 0,1 % | 8,0 % | 6 (Rotoren ×4, Glocken ×2) |
| Konverter | 796 / 504 / 204 | 9,9 × 13,8 × 10,0 | 23,0 % | 0,1 % | 6,3 % | 2 (Drehbühne, Birne) |
| Tiefenstich | 1.166 / 728 / 286 | 11,9 × 11,4 × 11,9 | 26,2 % | 3,6 % | 7,1 % | 3 (Kränze ×2, Pumpenkopf) |
| Mantel | 824 / 584 / 270 | 7,9 × 9,3 × 7,9 | 28,3 % | 0,0 % | 7,2 % | 2 (Ringe ×2) |

Alle bauen fehlerfrei, im Budget und ohne Warnung (Footprint-Prüfung ok). Der Vertragstest `packages/modelkit/test/content.test.ts` prüft
zusätzlich T4-Budget, Keramik-Klammer und mehr als 350 Tris in LOD0 sowie die Icon-Klammer.
Screenshots: `tools/heavy pnpm models:shots --faction varkan --only exp_lnd_walker,exp_lnd_foundry,exp_air_gunship,exp_str_arty,exp_str_eco,exp_str_shield`
bzw. ohne `--only` für Kontaktabzug, Silhouettenblatt und Größenvergleich (`/private/tmp/claude-501/faf-models/varkan/`).

---

## 9. Offene Punkte

1. **Kokille-Glutkern** liegt mit 1,3 % unter dem Glutkern-Band für Flow-Einheiten (3–6 %). Das Tor ist von oben halb verdeckt. Das Problem
   teilt sie mit den Landwerken (§3 models.md). Beim Textur-Pass (MS14-Politur) die Gießrinne breiter machen.
2. **Kupferanteil** der Kokille (6,3 %) und des Konverters (6,3 %) knapp unter 8 %.
3. **Animierte Parts:** Die Faction-Regel „mobil ≤ 2 animiert“ gilt für T1–T3. T4 nutzen 2–6 von 8 PartStream-Slots, das ist bewusst so
   (Beine, Türme, Rotoren).
4. **Kuppel-Rendering r 60** (Mantel) und r 24 auf einem mobilen Träger (Kokille): Größentest für den K10-Shader.
5. **KI (A16):** T4-Bauentscheidungen, Engineer-Pulks auf Großbaustellen, Reaktion auf XM9-Meldungen. Konverter und Tiefenstich brauchen A21.
6. **FA-Stand:** Vor PM1 alle zwölf T4-Referenzen gegen den dann aktuellen FAF-Stand prüfen (Scathis-HP und Fatboy-Schild-Regen haben sich geändert).
7. **Unit-Cap (U7):** Ob T4 mehrfach zählen (z. B. 10 Slots), ist offen. Vorschlag: 1 Slot, die Begrenzung kommt über Mass und Bauzeit.
8. **Markenrecherche** für die sechs neuen Rufnamen steht aus.
