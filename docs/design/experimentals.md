# Experimentals (T4) des Varkan-Kompakts

> **Status:** Designentwurf vom 2026-09-29, Branch `experimentals`. **Post-MVP.** Laut PLAN/features.json ist U16
> („Erstes Land-Experimental“) Post-MVP, U21 („Volles Experimental-Roster & Game-Ender“) und E17 („Endgame-Eco“)
> sind „Später/Nice-to-have“. Die sechs Einheiten sind trotzdem vollständig ausgearbeitet: Werte, Mechaniken,
> Feature-IDs, Modelle und Icons. Damit lassen sich Relationen, Silhouetten und Budgets schon heute prüfen.
> **Review:** Kritisches Review vom 2026-09-29 ist eingearbeitet (Balance, FA-Spielgefühl, Technik, Eigenständigkeit, Lesbarkeit).
> Die Entscheidungen stehen in §10, geänderte Werte sind in `roster.json` und `roster.md` §19 übernommen.
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
Skript von `XAB1401`. Die Werte stehen in `tools/roster/fa_ref.json`. Zitiert werden nur Blueprint-IDs und generische Rollen.

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
  Beispiel Sturm-Läufer gegen T3-Belagerungsbot: DPS/Mass nur 0,29×, HP/Mass 0,56× bei gleicher Mass (57 × `UEL0303` für einen Läufer).
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
- **Platzierung (Review R7):** Eine Land-T4-Baustelle ist nur gültig, wenn ihr Footprint in der Clearance-Komponente (Land, sizeClass 6 bzw. 7)
  der Hauptfläche liegt. `rules.canPlace` prüft das über die vorhandenen Komponenten (M5/M6). So kann kein T4 zwischen 8×8-Werken
  eingeschlossen werden. Das Platzierungsraster färbt sich rot, der Tooltip nennt den Grund.
- **Unfertige Baustelle (Review R8):** Unter 100 % gibt es keine Todeswaffe. Das Wrack trägt 90 % der **verbauten** Mass, fällt also mit dem
  Baufortschritt. Wer die Baustelle zerstört und das Feld hält, holt sich den Einsatz. Das ist das Wagnis des Großgusses.
- **Sichtbarkeit:** Die Baustelle ist ein normales Gebäude im Bau. Der Radar-Blip bleibt das neutrale Sechseck (I3, verrät nichts), im Fog
  bleibt ein Ghost (I2). **Neu (XM9):** Sieht ein Haus eine fremde T4-Baustelle in echter Sicht, meldet die Ansage „Großguss gesichtet“ (P8).
  Ab 75 % Baufortschritt kommt ein Minimap-Ping dazu (C16). Das verschärft FA leicht zugunsten der Gegenwehr, weil die Karten im MVP-Pool
  kleiner sind als typische FA-Karten.
- **Game-Ender-Signatur (Review R4, XM9):** Eine Konverter-Baustelle meldet sich ab 50 % allen Gegnern, auch ohne Sicht: Ansage
  „Großguss-Signatur“ und ein Minimap-Ping mit 40 WU Unschärfe. Bei 20 Meistern bleiben danach noch ≈ 235 s bis zum ersten Schuss.
  Mobile T4 bleiben eine Überraschung wie in FA, der Game-Ender nicht.
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
  Mehr als 7 braucht keine T4-Einheit. Luft ist `sizeClass 0`, der Footprint 7×7 gilt nur für die Baustelle (der Kolkrabe landet nicht).
- **Länge der Kokille (Review R9):** Die Pfad-Klasse richtet sich nach der Breite (7). Die Länge 9 übernimmt das Steering: Ketten wenden auf der
  Stelle (PLAN, Steering), Gebäudekanten löst die positionsbasierte Kollisionsauflösung, Stuck (< ε über 20 Ticks) führt zum Repath. Eine
  Klasse 9 bräuchte ein breiteres Schema und zwei weitere Komponenten-Layer, das lohnt für eine Einheit nicht. **Abnahme in PM2:**
  SPK3-Testkarte mit Basisgassen von 7, 8 und 9 WU und 90°-Knicken, Kokille darf nirgends länger als 3 s hängen.
- **Nicht amphibisch (Review R10):** Im MVP gibt es nur die Layer Land und Air. Die Stampfe bleibt bewusst Land-Einheit (in FA läuft das
  Vorbild unter Wasser). Über Wasser geht es nur per Brücke. Auf Setons macht das die Brücke zur Bühne des T4-Vorstoßes.
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
nicht in die spooky-DPS eingeht. **Sim-Regel (Review R11):** Der Schrittakt ist Sim-Zustand (12 Ticks bei 10 Hz, Fuß abwechselnd, Fußposition
aus Position und Blickrichtung), die Animation folgt ihm und nicht umgekehrt. Der Tritt wird im Tick **vor** der Kollisionsauflösung
angewendet, sonst schiebt das Steering (M7) die Opfer vorher aus dem Fuß. Er tötet Stichel, Punze, Kelle und Meißel sofort. Der Fallhammer (3.200 HP) überlebt einen Tritt knapp.

### 3.4 Todeswaffen und Wracks (XM4, K5, K8, K14, P14)

| Einheit | Schaden / Radius (FA) | Verzögerung | Wirkung |
|---|---|---|---|
| Stampfe | 8.000 / r7 (8.000 / r7) | 2,0 s: kippt in Laufrichtung | tötet jede T3-Landeinheit im Radius |
| Kokille | 4.000 / r7 (4.000 / r7) | 1,5 s | Kesselbruch |
| Kolkrabe | 5.000 / r8 (5.000 / r8) | 3,0 s: trudelt, dann Aufschlag (K12) | Absturzort bestimmt der Flugvektor |
| Tiefenstich | 35.000 / r25 (Nuke 35.000 / r25) | 2,0 s | Kettenreaktion über K14 (Glutkessel, Speicher). Nicht neben Werke stellen. |
| Konverter, Mantel | – | – | wie FA ohne Todeswaffe |

Alle Todeswaffen treffen auch Eigenes (K8). Die Verzögerung ist ein Fluchtfenster und das „Gesicht“ des Großereignisses (P14: Druckring,
Kamera-Shake, abschaltbar). **Fairness-Regeln (Review R12):** Selbstzerstörung löst die Todeswaffe mit derselben Verzögerung aus, es gibt
also keinen verzögerungsfreien Sprengsatz. Unfertige Baustellen explodieren nicht (§3.1). Kettenreaktionen über K14 laufen deterministisch
nach Entity-Index und je Glied mindestens 3 Ticks versetzt. Das verteilt die Last auf mehrere Ticks und ergibt die sichtbare Kaskade. **Wracks:** 90 % der Mass (FA `Wreckage.MassMult 0.9`). Nach einem T4-Gefecht liegen also 24.000–26.000 Mass
Schlacke auf dem Feld. Das ist der Reclaim-Schub, der FA-Spätspiele kippt („Schlacke ist auch Erz“).

### 3.5 Kitbash- und Silhouettenregeln für T4

- **Maßstab:** T4 werden in Spielgröße modelliert (`kitbash.scale` 1,0), nicht in T1-Basisgröße.
- **Rollen-Grammatik bleibt:** Jede Waffe trägt die Signaturform ihrer Rolle (faction.md §5.2). Glocke + waagerechtes Rohr heißt Direktfeuer,
  offene Kelle heißt Artillerie, senkrechte Rohre bzw. Rost heißen Flak, Mast + waagerechter Ring heißt Schild, U-Portal heißt Fabrik. Schlot und
  Glutkern gibt es nur bei Flow-Einheiten (Kokille = FACTORY, Tiefenstich = ECONOMIC).
- **T4-Kennung am Modell: Keramik-Klammer.** Statt 1–3 Tech-Streifen tragen T4 zwei keramikweiße Winkelleisten „[ ]“ auf Deck bzw. Sockel
  (`content/models/varkan/_t4.ts`), als Gegenstück zur Icon-Klammer. Ab LOD1 entfällt die Klammer mit den Kleinteilen, dann übernimmt das Icon.
- **Budget:** LOD0/1/2 ≤ **1.600 / 800 / 320** Tris (`T4_BUDGET` bzw. Alias `EXPERIMENTAL_BUDGET` in `@faf/modelkit`, greift automatisch bei `tech: 4`; Fraktions-Override `budgets.t4`), Parts ≤ 16,
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
- **Zeichenreihenfolge (Review R16):** T4-Icons liegen im Strategic Zoom über allen T1–T3-Icons. Ein T4 verschwindet so nie in einem Pulk-Klumpen,
  und die Klammer bleibt sichtbar, wenn 50 Fallhämmer um eine Stampfe stehen.
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
- **Bewegung:** 2,4 WU/s, 40 °/s, Beschleunigung 1,2. **Footprint** 6×6, **sizeClass 6**, Sicht 50. Nur Layer Land, nicht amphibisch (§3.2).
- **Balance:** DPS/Mass +1,9 %, HP/Mass −2,2 %, Produkt −0,4 % gegen `UAL0401`. T3-Äquivalent: 54 Fallhammer (FA 57 × `UEL0303`), T4/T3-Verhältnis
  DPS/Mass +6,1 %, HP/Mass −1,3 % gegenüber FA. Eigene Setzung: Projektilkanonen statt Dauerstrahl. Die Doppelglocke hat Flugzeit
  (v 45) und kann overkillen. Dafür bekommt sie Splash 1,0, und die Summe bleibt 2.500 DPS.
- **Besonderheiten:** Crush + Fußtritt (XM2). Todeswaffe Gussbruch 8.000 r7 nach 2,0 s (XM4). Wrack 24.300 Mass.
- **Konter:** Luft (keine Flugabwehr: 30 Krähen, 6.000 Mass, zerlegen sie in ≈ 60 s ohne Verlust), Artillerie auf Abstand (Pfanne 85 WU,
  Hochofen 200 WU), Reißnadel-Pulks auf 58 WU (gleiches Tempo 2,4, Abstand halten braucht also Mikro), die Baustelle früh angreifen.
  Ein Konverter-Treffer nimmt 1/6 der HP, trifft aber bei 9 s Flugzeit nur eine stehende oder stur geradeaus laufende Stampfe.
- **Mechaniken / Feature-IDs:** U16, B1, B2, B6, M5, M6, M7, K4, K5, K8, P14, A16, C2 · neu XM1, XM2, XM3, XM4, XM8, XM9.
- **Kitbash:** Becken mit Kupferachse und Hüftschürzen (hull) · Beine L/R als Pochstempel (`legs`: schräger Oberschenkel, Gelenkwalze mit
  teamfarbener Kniekappe, Stempelgehäuse, blanke Kupfer-Stempelstange, Hydraulikzylinder am Beinrücken, Stampffuß Ø 1,7 WU) · Torso
  (`turret`, yaw) als Seitenprofil mit vorspringendem Kinn und schräger Stirn, durchgehender Sehschlitz, Kupfer-Kinnband, team-Deck,
  Luke, Bauchstück, liegender Rückenkessel mit Leitungen zu den Glocken, Keramik-Klammer, zwei Schulterglocken auf Schulterpanzern ·
  Rohre L/R mit Rücklaufmantel und Kupfer-Mündungsbremse (pitch). **5 animierte Parts.**
  **Silhouette:** zwei Säulen + breiter Querbalken + zwei lange Rohre, ein „Π mit Hörnern“, 6,5 WU hoch (2,1× Vogt).
  **Tris 1.304 / 708 / 200**, Team-Draufsicht 43,1 %, Glut 0,1 %, Kupfer 9,8 %.
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
  Kein Assist auf fremde Baustellen: Die Build Power gehört der eigenen Bauliste, die Kokille ist kein fahrender Meister-Pulk.
  Die Kuppel deckt Begleiter (Radius 24) und fällt im Energy-Stall (E3) aus. Toggle Schild (C17). Crush (Mauern, Wracks, schiebt ≤ s3).
  Todeswaffe 4.000 r7 nach 1,5 s. Wrack 25.200.
- **Konter:** Energy-Stall erzwingen (600 E/s), Direktfeuer unter die Kuppel tragen (Stampfe, Fallhammer-Pulk), nach dem Kuppel-Kollaps
  bomben (Flak nur 57 DPS). **Sie baut nur im Stand**, und dann ist sie für Hochofen und Konverter ein sicheres Ziel: 2 Konverter-Treffer brechen
  die Kuppel, der dritte zerstört die Kokille (13.000 HP). Fahrend weicht sie der Flugzeit aus. Genau das ist ihr Takt: vorrücken, stehen, gießen.
- **Mechaniken / Feature-IDs:** U21, U5, B3, K10, K2, K4, K12, M5, M6, M7, C17, E3, P14, A16, C2 · neu XM1–XM5, XM8, XM9.
- **Kitbash:** vier Kettenblöcke mit Kupfer-Laufradnaben, Bugramme (Crush) mit Kupferkante, Deck mit Bugfase (team) und Kupfer-Scheuerleisten,
  **U-Portal** mit Stirnwand, **Sheddach** aus drei Sägezahn-Sheds (Schrägen team, Fenster glühen nach vorn), glühendem Werkhallentor,
  Glutschein an den Portal-Innenwänden, breiter Gießrinne, Heckrampe mit Kupferkufen, zwei Schlote mit Glutkrone, Kupferleitungen ·
  Glocken L/R (yaw) · Kellen L/R (yawpitch) · Rostkamm (yaw) · Schildring Ø 7,4 WU (spin) als höchster Punkt. **6 animierte Parts.**
  **Silhouette:** flacher Block mit Sägezahn-Halle, riesigem Ring darüber und offenem U am Heck.
  **Tris 1.476 / 796 / 316**, Team 53,7 %, Glut 3,2 %, Kupfer 9,1 %.
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
  (nur Baustelle, er landet nicht), sizeClass 0, Sicht 46.
- **Balance:** DPS/Mass +0,1 %, HP/Mass −1,3 % gegen `URA0401`. T3-Äquivalent: Varkan hat keine T3-Luft (U12 Post-MVP), deshalb der
  Vergleich mit der Krähe (T2-Gunship, FA `UEA0203`): +4,2 % / −5,3 %.
- **Besonderheiten:** Wird von Meistern gebaut, braucht also **kein T3-Luftwerk**. Im Energy-Stall halbe Feuerrate. Absturz 5.000 r8 nach 3 s
  Trudeln (K12, XM4). Wrack 26.100.
- **Konter:** Hochrost (SAM, RW 58 > 30), Trommelsieb, Turmfalken-Schwärme. Acht Hochroste (6.400 Mass, 2.744 DPS) holen ihn in ≈ 27 s herunter.
  Er muss dafür in ihre Reichweite, weil seine Bodenwaffen nur 30 WU weit reichen. Ohne T3-Luft ist der Kolkrabe das einzige Varkan-Mittel, Luftüberlegenheit
  im Spätspiel zu erzwingen, und genau deshalb bleibt er bei FA-Werten und wird nicht aufgewertet.
- **Mechaniken / Feature-IDs:** U21, U11, K3, K4, K11, K12, E3, P14, A16, C2 · neu XM1, XM4, XM8, XM9.
- **Kitbash:** achteckige Deckscheibe (team), darauf der Rabenrücken (Gussbuckel, Oberseite team, Kupferleisten) mit Kopf, Sehschlitzen und
  spitzem Schnabel, flacher gekerbter Schwanzfächer (team, kein Flügel), vier Kupfer-Ausleger zu vier Ringdüsen (team), Bauch-Raketenkessel,
  Flak-Rost mit vier senkrechten Rohren auf dem Rücken, Keramik-Klammer · 4 Rotoren (spin) · 2 hängende Glocken mit Rohr (yaw). **6 animierte Parts.**
  **Silhouette:** Rabenkörper (Schnabel vorn, Fächer hinten) im Kreuz aus vier Ringen, zwei Rohre vorn, keine Flügel. **Tris 1.450 / 766 / 316**,
  Team 66,6 %, Kupfer 8,3 %.
- **Icon** `air_direct_t4` · **Hotbuild** Bau → G → S · **Meilenstein** PM2.

### 4.4 Konverter / Converter – `core:exp_str_arty` (PM3, U21 Game-Ender)

- **Rolle:** Strategische Artillerie. **FA-Referenzrolle:** strategische Artillerie (`UEB2401`, Gegenprobe `URL0401`, `XAB2307`).
- **Fantasy:** Die größte Birne, die je gegossen wurde: Sie kippt, der Kern schießt als weißglühender Guss über die ganze Karte. Die Charta
  kennt keinen Frieden, nur Häuser, die den Konverter noch nicht fertig haben.
- **Kosten:** 220.000 Mass, 5.900.000 Energy, 300.000 BT. **HP** 8.000.
- **Waffe:** `core:wpn_converter_shell` Konverterguss: **16.000 Schaden alle 8,0 s = 2.000 DPS**, RW **150–1.500**, ballistisch (v 160),
  Splash 7, Streuung **σ = max(8 WU, 1,2 % der Distanz)** (Review R5). Flugzeit ≈ 9 s auf 1.000 WU. Friendly Fire.
- **Einschlagwarnung (XM6, Review R5):** Mit dem Abschuss sieht das Haus des Ziels einen Warnring (Radius Splash + 2σ) am Zielpunkt und hört
  die Ansage (P8, höchstens alle 20 s). Einheiten können ausweichen, Gebäude nicht. Der Konverter bleibt Basis-Zerstörer, er wird kein
  Einheiten-Scharfschütze: Ein stehender Vogt (12.000 HP < 16.000) wird auf kurze Distanz mit ≈ 32 % je Schuss getroffen statt mit bis zu
  85 % (σ 3,6 WU auf 300 WU ohne Untergrenze), und er hört den Schuss kommen.
- **Balance:** DPS/Mass +2,2 %, HP/Mass +2,2 %, Produkt +4,4 %, Pulk-DPS/Mass +2,2 % gegen `UEB2401`. T3-Äquivalent: 4,6 Hochöfen
  (FA 3,1 × `UEB2302`, weil der Hochofen nur 67 % kostet): +2,2 % / +2,2 %.
- **Reichweite, begründete Abweichung:** FA 4.000 deckt Karten bis 81 km (M14). Varkan setzt **1.500 WU**. Das deckt jede MVP-Karte ab, auch
  die Setons-Diagonale (1.448 WU), bleibt auf künftigen 40-km-Karten aber eine Position und keine Allmacht. Der Hochofen (T3) liegt bei 200 WU,
  der Sprung ist also gewollt: Der Konverter ist ein **Game-Ender**, kein besserer Hochofen.
- **Schild-Interaktion** (ein Schütze): Schirm II bricht mit 1 Schuss, Schirm III mit 2 (8 s), die Kuppel der Kokille mit 2, der **Mantel mit 6 (40 s)**.
- **Mechaniken / Feature-IDs:** U21, K13, K2, K4, K6 (Attack-Ground), K8, K10, I2, I3, C15, P8, P14, A21, C2 · neu XM6 (Feuern auf Intel
  außerhalb der Sicht, Streuung, Einschlagwarnung für den Beschossenen), XM8, XM9.
- **Konter:** Mantel über dem Kern, die Baustelle angreifen (300.000 BT, ab 50 % meldet XM9 sie jedem Gegner), Vorstoß mit Stampfe oder Kolkrabe
  (8.000 HP, keine Eigenverteidigung), Einheiten aus dem Warnring ziehen, später Radar-Jamming (I5).
- **Zeitpunkt:** 220.000 Mass entsprechen ≈ 8 Stampfen. Selbst mit 40 Meistern (≈ 12.400 Mass nur für die Meister) dauert der Guss 234 s bei
  940 M/s, mit realistischen 20 Meistern 469 s. Mit Signatur ab 50 % und Warnung bei jedem Schuss ist ein Konverter nie ein stiller Sieg.
- **Kitbash:** zweistufiger Sockel 10×10 (Platte + Achteck-Podest) mit Randband (team), Ankerpollern, Kupfer-Laufschiene und Keramik-Klammer ·
  Drehbühne mit zwei A-Wangen, Zapfenlagern, Querhaupt über dem Heck, zwei Gegengewichten und Geschosstrommel (`boom`, yaw) ·
  Konverterbirne (team, Loft: runder Boden, zylindrischer Bauch mit Gussrippen, konischer Hals, offene Mündung) im Kupfer-Tragring mit Zapfen,
  Mantelrohr und bereiftes Steilrohr 60° mit Mündungsbremse (`ladle`, pitch). **2 animierte Parts.** **Silhouette:** Riesenrund mit langem
  Strich und Portalrahmen dahinter, **14,5 WU hoch, höchstes Bauwerk**. **Tris 1.414 / 768 / 276**, Team 21,7 %, Kupfer 11,6 %, Glut 0,1 %.
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
  (Kette I→III zusammen 226.500 Mass, aber 42 Spots, die keine 1v1-Karte hat). Die Amortisation bei vollem Bedarf dauert 327 s, bei `XAB1401`
  bei gleichem Verbrauch 334 s.
- **Balance:** HP/Mass +6,2 % gegen `XAB1401` (5.200 statt 5.000 HP, Kosten −2 %).
- **Todeswaffe:** Tiefenbruch 35.000 r25 nach 2 s (FA-Nuke 35.000 r25), Kettenreaktion über K14.
- **Konter:** 5.200 HP: Der Konverter und schon ein **Hochofen (5.500 Schaden, RW 200)** töten ihn mit einem Treffer, wie in FA. Dazu kommen
  Kolkrabe-Vorstoß und Bomber. Der Standort ist die Verteidigung, deshalb steht er mehr als 200 WU hinter der Front, unter einem Mantel und
  weit weg von den Werken. Wer ihn verliert, verliert mit dem Tiefenbruch (35.000 r25) oft auch das Viertel drumherum.
- **Mechaniken / Feature-IDs:** E17, E1, E2, E3, E4, K8, K14, P14, A16, C10, C2 · neu XM7, XM8, XM9.
- **Kitbash:** Sockel 12×12 mit Randband (team), Achteck-Podest, Keramik-Klammer, innerer Kranz mit Glut im Bohrloch, Bohrturm als sich
  verjüngender Vierbein-Derrick mit zwei Kupfer-Rahmen und Glutsäule, vier Eckschlote (Fuß, Kupferband, Kragen mit Glutkrone) mit
  Kupferleitungen zum Turmfuß, zwei Pumpenhäuser mit Glutschlitz · äußerer Kranz mit Zahnkranz (team, spin) · mittlerer Kranz (Kupfer, spin
  gegenläufig) · Pumpenkopf als Raute aus zwei Kegeln mit Glutgürtel (team oben, spin). **3 animierte Parts.** **Silhouette:** Derrick mit
  Rautenkopf in einem Ring aus vier Schloten, als „Raute + Flamme“ in Riesengröße, 13,7 WU hoch. **Tris 1.520 / 766 / 304**, Team 25,5 %,
  **Glut 3,3 %** (Glutkern-Band 3–6 %), Kupfer 9,4 %.
- **Icon** `struct_mass_t4` · **Hotbuild** Bau → G → A · **Meilenstein** PM3.

### 4.6 Mantel / Mantle – `core:exp_str_shield` (PM2, Varkan-Ergänzung, Game-Ender-Konter)

- **Rolle:** Großschild. **FA-Referenzrolle:** Es gibt kein FA-Schild-Experimental. Die Relation läuft pro Mass gegen den T3-Schildgenerator
  (`UEB4301`), die Gegenprobe gegen die Festungskuppel von `UEL0401`.
- **Fantasy:** Der Hitzemantel, den die Gießer vor den Abstich hängen, als Kuppel über einem ganzen Haus. Unter dem Mantel wird weiter
  gegossen, auch wenn draußen der Konverter des Nachbarn kippt.
- **Kosten:** 16.000 Mass, 260.000 Energy, 24.000 BT. **HP** 2.500 + **Kuppel 80.000**, Radius **60**, Regen **250/s** ab 1 s, Neuaufbau
  **90 s, danach mit 25 % (20.000)**, **Unterhalt 2.000 E/s**. Toggle Schild (C17). (Review R1/R2: vorher Regen 400/s, Neuaufbau 60 s mit voller Kuppel.)
- **Balance:** HP+Schild/Mass −2,8 % gegen `UEB4301` (FA-Upgradekosten, wie Schirm III im Roster). T3-Äquivalent: 5 Schirm III
  (87.600 HP) auf 2,25× Fläche, HP-Verhältnis −5,8 %.
- **Warum T4:** Die Kuppel verändert Artillerie-Rechnungen grundsätzlich, weil die Regeneration nicht wie bei 5 × Schirm III (650 HP/s) auf fünf
  Kuppeln verteilt ist, sondern dort wirkt, wo getroffen wird. Der Konverter braucht 6 Treffer (40 s), eine Stampfe 32 s Dauerfeuer, ein einzelner
  Hochofen ≈ 9,5 min (39 Schüsse), zwei im Wechsel ≈ 2,5 min, drei ≈ 85 s. Das ist die geplante Antwort auf den Game-Ender, aber kein Freibrief.
- **Stapeln (Review R2):** Nach dem Kollaps kommt die Kuppel nur mit 20.000 zurück, die ein Konverter mit 2 Treffern (8 s) wieder bricht. Pro Mantel
  und Zyklus von ≈ 98 s kostet das den Konverter 2 von ≈ 12 Schüssen. Drei Mäntel (48.000 Mass) halbieren seine Treffer auf die Basis, erst
  ≈ 6 Mäntel (96.000 Mass, 12.000 E/s Unterhalt) sperren ihn ganz. Dagegen hilft ein zweiter Konverter oder ein Hochofen-Paar im Takt. Mit
  voller Rückkehr nach 60 s hätten schon drei Mäntel einen Konverter dauerhaft gesperrt.
- **Konter:** Energy-Stall (2.000 E/s, E3 lässt die Kuppel sofort fallen), unter die Kuppel laufen (Stampfe, Kokille, alle Bodentruppen),
  Konverter + 2 Hochöfen im Takt, nach dem Kollaps nachsetzen (Rückkehr mit 25 %). Todeswaffen innerhalb der Kuppel wirken voll.
- **Mechaniken / Feature-IDs:** K10, E3, C15, C17, P14, U21, A16, C2 · neu XM8, XM9. Die Kuppel mit 60 WU ist für den Fresnel-/Ripple-Shader
  aus K10 ein Größentest (Kuppel-Mesh-LOD).
- **Kitbash:** Sockel 8×8 mit Randband (team) und Keramik-Klammer, gefaltete Schürze (der „Mantel“, team, Loft mit 16 Falten), stehender
  Generatorkessel mit Kupferbändern, vier Strebebögen auf den Sockelecken, Mast mit Kupfer-Isolatoren, unterer Ring (statisch, auf den
  Bögen) · mittlerer Ring (Kupfer, spin) · oberer Ring Ø 8,1 WU mit Klauenkranz (team, spin gegenläufig) und Mastkappe. **2 animierte Parts.**
  **Silhouette:** Kelch aus drei gestaffelten Ringen über einem Bogenfuß, 11,8 WU hoch (2,8× Schirm III). **Tris 1.194 / 770 / 270**, Team 45,9 %,
  Kupfer 8,3 %.
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
| Schildbrechen (Info) | Hochofen → Mantel muss brechen (kein „nie“), Konverter → Mantel 6 Treffer | 39 Schüsse (570 s) bzw. 6 (40 s) |

**Methodische Hinweise**
- Die FA-DPS der Referenz nimmt die Waffen, die es bei uns gibt: Kokille ohne Torpedo, Stampfe mit Strahl + Greifer, ohne Footfall.
- **Pro-Mass-Schwäche der T4 ist gewollt** (siehe T3-Äquivalent): Eine Stampfe hat 31 % der DPS und 56 % der HP von 54 Fallhämmern. Ihr Wert
  liegt in Konzentration (ein Ziel, 96.000 HP an einem Punkt), Regeneration, Reichweite 40 gegen 24, Crush und darin, dass Splash und Snipes
  an ihr abprallen.
- Die Zahlen sind Startwerte für ein Post-MVP-Balancing und stehen vor dem Umbau nochmals gegen den dann aktuellen FAF-Stand
  (`URL0401` und `UEL0401` haben sich in `develop` seit 3810 geändert, siehe §2).

---

## 6. Neue Mechaniken (Vorschlag, noch ohne Eintrag in features.json)

| Code | Mechanik | baut auf | gebraucht von |
|---|---|---|---|
| XM1 | Mobile Großbaustelle (Baustelle mit Footprint, wird zur Einheit; Platzierung nur in der Hauptkomponente; unfertig ohne Todeswaffe) | B1, B2, B6, U16, M5 | Stampfe, Kokille, Kolkrabe |
| XM2 | Massiv/Crush: Vorrang im Steering, Mauern/Wracks überrollen, Fußtritt-Schaden im Sim-Takt vor der Kollisionsauflösung | M7, K4, K5 | Stampfe, Kokille |
| XM3 | Größenklassen 6–7: Clearance-Komponenten, Pfad-Klasse nach der Breite, Länge über Steering | M5, M6, M7 | Stampfe, Kokille |
| XM4 | Verzögerte Todeswaffe mit Umkippen/Absturz, auch bei Selbstzerstörung; Ketten ≥ 3 Ticks versetzt | K4, K8, K12, K14, P14 | Stampfe, Kokille, Kolkrabe, Tiefenstich |
| XM5 | Mobile Fabrik (Bauliste, Heckausgang, Rally am Träger) | B3, U5 | Kokille |
| XM6 | Strategische Reichweite: Zielen auf Intel/Boden gibt es schon (I3, K6); neu sind Streuung σ = max(8 WU, 1,2 % d) und die Einschlagwarnung ab Abschuss | K2, K6, K13, I2, I3, P8 | Konverter |
| XM7 | Bedarfsdeckende Produktion mit Deckel | E1–E4 | Tiefenstich |
| XM8 | T4-Icon-Klammer, Faktor 1,5, Zeichenreihenfolge über T1–T3, längere Mesh-Sichtbarkeit | C2 | alle |
| XM9 | „Großguss gesichtet“-Ansage und Minimap-Ping; Konverter-Signatur ab 50 % für alle Gegner | I1, P8, C16 | alle |

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
U21 teilen in „U21a Land/Luft-T4 + Game-Ender“ (Abhängigkeiten U16, U11, K10, K13) und „U21b See-Experimentals“ (U17). Außerdem hängt E17
laut Featureliste an E15 (Mass Fabricator) und U15 (SACU). Der Tiefenstich braucht beides nicht, nur E1–E4 und PM2 (Mantel). **Lobby:** Mit A18
(Unit-Restriktionen, Post-MVP) kommen die FA-üblichen Presets „keine Experimentals“ und „keine Game-Ender“ (Kategorien `EXPERIMENTAL` bzw.
`STRATEGIC` + `exp_str_eco`). Das ist das Ventil für kleine 256-WU-Karten.

---

## 8. Modelle, Icons, Werkzeuge

| Datei | Inhalt |
|---|---|
| `content/models/varkan/exp_*.ts` | 6 Modelle in Spielgröße (Kitbash-DSL) |
| `content/models/varkan/_t4.ts` | `ceramicBracket()`, die gemeinsame T4-Kennung |
| `packages/modelkit/src/model.ts`, `build.ts`, `faction.ts` | `tech: 4` (`type Tech`), `T4_BUDGET` = `EXPERIMENTAL_BUDGET` (1.600 / 800 / 320, Override `budgets.t4`), Roster-Übernahme von `tech: 4` |
| `content/icons/grammar.ts`, `build.ts` | `_t4`-IDs, Klammer statt Kerben, Faktor 1,5, `svg/notches/t4.svg` |
| `apps/model-viewer/src/views/icons.ts` | Klammer und Beispiel-Icon in der Icon-Übersicht |
| `tools/model-shots` | neue Option `--only exp_lnd_walker,…` (nur Einzelbilder, schnelle Iteration) |
| `tools/roster/*` | T4-Referenzen, Generator, `roster.md` §19, Validator |

| Modell | Tris L0/L1/L2 | Bounds (WU) | Team-Draufsicht | Glut | Kupfer | animierte Parts |
|---|---|---|---|---|---|---|
| Stampfe | 1.304 / 708 / 200 | 7,3 × 6,5 × 8,3 | 43,1 % | 0,1 % | 9,8 % | 5 (Beine ×2, Torso, Rohre ×2) |
| Kokille | 1.476 / 796 / 316 | 7,3 × 7,4 × 11,8 | 53,7 % | 3,2 % | 9,1 % | 6 (Glocken ×2, Kellen ×2, Flak, Ring) |
| Kolkrabe | 1.450 / 766 / 316 | 9,2 × 3,5 × 9,5 | 66,6 % | 0,1 % | 8,3 % | 6 (Rotoren ×4, Glocken ×2) |
| Konverter | 1.414 / 768 / 276 | 9,95 × 14,5 × 9,96 | 21,7 % | 0,1 % | 11,6 % | 2 (Drehbühne, Birne) |
| Tiefenstich | 1.520 / 766 / 304 | 11,95 × 13,65 × 11,95 | 25,5 % | 3,3 % | 9,4 % | 3 (Kränze ×2, Pumpenkopf) |
| Mantel | 1.194 / 770 / 270 | 8,0 × 11,8 × 8,1 | 45,9 % | 0,0 % | 8,3 % | 2 (Ringe ×2) |

Alle bauen fehlerfrei, im Budget und ohne Warnung (Footprint-Prüfung ok). Der Vertragstest `packages/modelkit/test/content.test.ts` prüft
zusätzlich T4-Budget, Keramik-Klammer und mehr als 350 Tris in LOD0 sowie die Icon-Klammer.
Screenshots: `tools/heavy pnpm models:shots --faction varkan --only exp_lnd_walker,exp_lnd_foundry,exp_air_gunship,exp_str_arty,exp_str_eco,exp_str_shield`
bzw. ohne `--only` für Kontaktabzug, Silhouettenblatt und Größenvergleich (`/private/tmp/claude-501/faf-models/varkan/`).

---

## 9. Offene Punkte

1. ~~**Kokille-Glutkern**~~ erledigt: Sheddach-Fenster, Glutschein an den Portal-Innenwänden und breitere Gießrinne heben die Glut auf 3,2 %
   (Glutkern-Band 3–6 %). Die Landwerke (§3 models.md) haben das Problem weiterhin.
2. ~~**Kupferanteil**~~ erledigt: Kokille nach dem Modell-Pass 9,1 %, Konverter 11,6 %.
3. **Animierte Parts:** Die Faction-Regel „mobil ≤ 2 animiert“ gilt für T1–T3. T4 nutzen 2–6 von 8 PartStream-Slots, das ist bewusst so
   (Beine, Türme, Rotoren).
4. **Kuppel-Rendering r 60** (Mantel) und r 24 auf einem mobilen Träger (Kokille): Größentest für den K10-Shader.
5. **KI (A16):** T4-Bauentscheidungen, Engineer-Pulks auf Großbaustellen, Reaktion auf XM9-Meldungen. Konverter und Tiefenstich brauchen A21.
6. **FA-Stand:** Vor PM1 alle zwölf T4-Referenzen gegen den dann aktuellen FAF-Stand prüfen (HP von `URL0401` und Schild-Regen von `UEL0401` haben sich geändert).
7. ~~**Unit-Cap (U7)**~~ entschieden (Review R14): 1 Slot je T4.
8. **Markenrecherche** für die sechs neuen Rufnamen steht aus. Vorrang haben **Raven** (gleichnamige Einheit in StarCraft II) und **Mantle**
   (ehemalige AMD-Grafik-API). Beides sind Alltagswörter, faction.md §7.1 Regel 5 verbietet aber Namen, die einem bekannten Produkt gleichen.
   Ersatz, falls nötig: EN „Rook“ (DE bliebe Kolkrabe, dann aber keine wörtliche Übersetzung) bzw. „Cloak“.
9. **Zahlenformat:** Energiekosten von 5,9 und 7,3 Mio. passen nicht in Q20.12 (±524.287). Kosten müssen als Ganzzahl bzw. als Rate je Tick
   laufen. Das betrifft schon den Hochofen im MVP (900.000 E), es ist also kein neues T4-Risiko. Der Vertrag ist aber vor PM3 in `rules` festzuhalten.

---

## 10. Review-Entscheidungen (2026-09-29)

Kritisches Review des Entwurfs in fünf Prüfrichtungen. „Geändert“ heißt: Wert oder Regel ist in `tools/roster/gen.py` bzw. diesem Dokument
geändert, `roster.json` und `roster.md` §19 sind neu erzeugt, `validate.py` meldet keine Verstöße. Die Kennzahlen aus §5 (Wert pro Mass,
T3-Äquivalent, Bauzeiten) bleiben unverändert, weil keine Kosten, HP oder DPS geändert wurden.

### 10.1 Entscheidungen

| # | Prüfpunkt | Befund | Entscheidung | Status |
|---|---|---|---|---|
| R1 | Balance: Artillerie gegen Schild | Mantel-Regeneration 400 HP/s × 14 s = 5.600 lag um 100 HP über dem Hochofen-Schuss (5.500). Ein 16.000-Mass-Gebäude hätte einen 48.000-Mass-Hochofen **vollständig** entwertet, und jede kleine Balance-Änderung hätte das Ergebnis umgeworfen. | Regen **250 HP/s**. Konverter bleibt bei 6 Treffern (40 s). Ein Hochofen bricht in ≈ 9,5 min, zwei in ≈ 2,5 min, drei in ≈ 85 s. Das Artillerie-Spiel bekommt eine Kurve statt einer Kante. | geändert |
| R2 | Balance: Game-Ender-Konter | Mit Neuaufbau 60 s bei voller Kuppel sperrten 2–3 Mäntel (32.000–48.000 Mass) einen Konverter (220.000) dauerhaft. Der Konter wäre billiger als ein Siebtel des Game-Enders gewesen. | Neuaufbau **90 s, Rückkehr mit 25 %** (neues Schildfeld `rechargeFraction`). Erst ≈ 6 Mäntel (96.000 Mass, 12.000 E/s) sperren ganz, drei halbieren die Treffer. | geändert |
| R3 | Balance: Wert pro Mass | T4 liegen bei 31 % DPS und 56 % HP einer gleich teuren T3-Armee (FA 29 % / 56 %). Ihr Wert entsteht aus Konzentration, Reichweite, Regeneration und Crush. Das FA-Gefühl „T4 verliert gegen gleich viel T3, gewinnt aber die Front“ bleibt. | keine Änderung | geprüft |
| R4 | Game-Ender zu früh | Kosten (≈ 8 Stampfen) und Bauzeit (469 s bei 20 Meistern) passen. Auf 256–512-WU-Karten fehlte aber die Vorwarnung, weil der Radar-Blip neutral ist. | **Konverter-Signatur** ab 50 % für alle Gegner (XM9, 40 WU Unschärfe). Mobile T4 bleiben eine Überraschung. | geändert |
| R5 | Snipe und Fairness | σ = 1,2 % der Distanz ergab auf 300 WU nur 3,6 WU. Ein stehender Vogt (12.000 HP) wäre mit ≈ 85 % je Schuss getroffen worden, der Game-Ender wäre ein Assassinations-Werkzeug geworden. | **σ-Untergrenze 8 WU** (> Splash 7) und **Warnring ab Abschuss** (Splash + 2σ, P8). Stehender Vogt ≈ 32 % je Schuss, dazu die Warnung. Gebäude trifft er weiterhin sicher. | geändert |
| R6 | Konter-Texte | Drei Aussagen hielten der Rechnung nicht stand: Ein Konverter trifft auf große Distanz (≈ 9 s Flugzeit) keine fahrende Stampfe oder Kokille. Reißnadeln sind so schnell wie die Stampfe und können nicht frei kiten. Der Tiefenstich stirbt schon an **einem** Hochofen-Treffer. | Texte korrigiert. Die Kokille ist nur beim Bauen (im Stand) Konverter-Ziel, das ist ihr Takt. Der Tiefenstich braucht > 200 WU Abstand zur Front oder einen Mantel. | geändert |
| R7 | Technik: Pathing | Land-T4 im Basis-Kessel: Baustelle zwischen 8×8-Werken mit 2–4 WU Gasse, fertige Stampfe kommt nicht heraus. | `canPlace` verlangt für Land-T4-Baustellen die Clearance-Komponente der Hauptfläche (XM1). | geändert |
| R8 | Bau als Wagnis | Offen war, was eine zerstörte Baustelle hinterlässt und ob sie explodiert. | Keine Todeswaffe unter 100 %. Wrack = 90 % der **verbauten** Mass. Wer das Feld hält, erntet den Einsatz. | geändert |
| R9 | Technik: Footprint 7×9 | Pfad-Klasse 7 und Länge 9 widersprechen sich, eine Klasse 9 sprengt das Schema (0–7). | Pfad-Klasse nach Breite, Länge über Steering und Stuck-Repath. Abnahmetest mit Gassen 7/8/9 WU in PM2 (XM3). | geändert |
| R10 | Technik: Setons/Wasser | Das FA-Vorbild der Stampfe ist amphibisch, im MVP gibt es aber nur die Layer Land und Air. | Stampfe **nicht amphibisch**. Amphibious erst mit U17. Die Setons-Brücke (76,4 WU, ≥ 8 T4 nebeneinander) wird zur Bühne. | geändert |
| R11 | Technik: Determinismus | Der Fußtritt hing implizit an der Animation, und M7 schob die Opfer aus dem Fuß, bevor der Tritt kam. | Schritttakt als Sim-Zustand (12 Ticks, Fuß abwechselnd), Tritt vor der Kollisionsauflösung (XM2). | geändert |
| R12 | Todeswaffen fair | Die Werte liegen auf FA-Niveau und haben 1,5–3 s Fluchtfenster. Offen waren Selbstzerstörung und Kettenreaktionen (Tick-Spitze bei Tiefenbruch + Speicher). | Selbstzerstörung mit gleicher Verzögerung. K14-Ketten nach Entity-Index, je Glied ≥ 3 Ticks versetzt (XM4). | geändert |
| R13 | Technik: Performance | Projektile pro T4: Stampfe 5/s, Kokille 7,8/s, Kolkrabe 5,2/s, Konverter 0,125/s. Bei ≤ 6 s Flugzeit sind das ≤ 25 gleichzeitig je T4. Zehn T4 belegen ≈ 200 von 4.000 Big-Battle-Projektilen (5 %). Splash-Abfragen (r ≤ 7, Todeswaffen bis r 25) sind Einzelereignisse. Visuals 34 < 40, Tris ≤ 1.600. Einziger Kostentreiber: Kuppel r 60 (Überzeichnung, Projektil-gegen-Kuppel-Test über ≈ 16 Chunks). | keine Wertänderung. Kuppel-LOD und Überzeichnungs-Messung sind Pflicht im K10-Größentest (§9.4). | geprüft |
| R14 | Unit-Cap | offen | **1 Slot** je T4. Begrenzt wird über Mass, Bauzeit und Signatur. | entschieden |
| R15 | Eigenständigkeit | Namen: kein Treffer gegen 503 FA-Blueprints. Formen: eigene Gießerei-Grammatik (Pochwerk-Läufer, Gießhalle mit U-Portal, Ringdüsen-Platte, kippende Birne, Bohrturm, Ringkelch). Die Zahlen folgen bewusst den FA-Relationen (Projektregel). Dafür hat jede Einheit eine eigene Regel (Projektil statt Strahl + Land-Layer, Bauen nur im Stand, Meister-Bau + Stall-Drossel, Reichweite 1.500 + Signatur + Warnring, Deckel 750 M/s, Mantel als eigene Rolle). Der Dev-Text nannte trotz eigener Regel (§2) an sieben Stellen FA-Einheitennamen. | FA-Namen in `experimentals.md`, `roster.md` und `gen.py`/`md.py` durch Blueprint-IDs ersetzt. Markenrisiko Raven/Mantle in §9.8. | geändert |
| R16 | Lesbarkeit/Icon | Klammer + Faktor 1,5 tragen, die sechs Silhouetten sind bei 32 px unterscheidbar. Im Pulk konnte das T4-Icon aber unter T3-Icons liegen. | T4-Icons in der Zeichenreihenfolge oben (XM8). | geändert |
| R17 | Kokille als Build-Power-Quelle | BP 135 hätte als Assist auf Großbaustellen einen fahrenden Meister-Pulk ergeben (5 Kokillen = 21 Meister). | Kein Assist, BP nur für die eigene Bauliste. | geändert |
| R18 | Featureliste | U21 hängt an U12/U17/K17, E17 an E15/U15. Das Roster braucht davon nichts. | Vorschlag U21a/U21b (§7), E17 ohne E15/U15, A18-Presets „keine Experimentals/Game-Ender“. `features.json` bleibt unangetastet. | Vorschlag |

### 10.2 Spielgefühl: die geplanten FA-Momente

1. **Der Guss als Wette:** Die glühende Baustelle wächst von unten. Der Gegner hört „Großguss gesichtet“, beim Konverter ab 50 % sogar ohne Sicht.
   Der Angriff auf die Baustelle lohnt sich, das Wrack gehört dem, der das Feld hält (R4, R8).
2. **Die Stampfe an der Brücke:** Sie zertritt Mauern und T1, lässt Schlacke zurück und kippt beim Tod in Laufrichtung (8.000 r7 nach 2 s).
3. **Rabenwetter:** Der Kolkrabe zieht über die Basis, trudelt nach dem Abschuss 3 s und schlägt dort ein, wo sein Vektor hinzeigt.
4. **Der Ring am Boden:** Jeder Konverter-Schuss kündigt sich mit dem Abschuss an (≈ 9 s Flugzeit auf 1.000 WU, auf kurze Distanz weniger). Einheiten fliehen, Gebäude zittern unter dem Mantel.
5. **Der Mantel fällt:** Nach sechs Treffern bricht die Kuppel, 90 s bleibt die Basis offen, und das Fenster sieht jeder.
6. **Der Tiefenbruch:** 35.000 r25 mit versetzter Kettenreaktion durch Speicher und Glutkessel ist der größte Knall des Spiels (P14).

