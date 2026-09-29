# Roster: Varkan-Kompakt (MVP)

> **Status:** Startwerte für alle MVP-Blueprints (U3) auf Basis von `docs/design/faction.md`, überarbeitet nach Balance- und Lesbarkeits-Review (§17). Maschinenlesbar in `docs/design/roster.json` (Schema `faf-roster/1`). **`roster.json` ist die einzige Quelle für Zahlen, ●/○-Status und Kitbash-Parts**; dieses Dokument und `faction.md` §7.4 sind daraus abgeleitet. Später Grundlage der Blueprints (`content/blueprints/core/…`).
> **Umfang:** **50 MVP-Blueprints** (23 mobil, 27 Gebäude, jede Upgrade-Stufe einzeln), davon **26 im MS9-Kern (●)**, Rest bis MS14 (○). Zielbänder PLAN: MS9 25–30, MS14 45–55. 28 Visuals (ein Superset-Mesh pro Rolle, Tech per Kitbash), 19 Icon-Glyphen. Waffen-, Projektil- und Basis-BPs (`core:base_*`) sind nicht mitgezählt. Dazu kommen **6 Experimentals (T4, Post-MVP)** in §19, Design in [`experimentals.md`](experimentals.md).
> **Ausgeschlossen (Post-MVP laut features.json):** TML/TMD, Nukes/SMD, Transporter (U13), T3-Luft (U12), Marine und Torpedobomber (U17/U18), Experimentals (nur als Post-MVP-Daten in §19), Mass Fabricator (E15), SACU (U15), ACU-Enhancements (U14), Stealth/Omni (I4/I5, damit auch der Stealth-Teil von U6). Kein T3-Panzer (Reservename *Amboss*).
> **Balancing:** Hartes Gate PLAN U3: DPS/Mass und HP/Mass je ±25 % der FA-Referenz. Der Generator erzwingt strenger: Einzelachsen, **Produkt** (DPS/Mass × HP/Mass) und **Pulk-DPS/Mass** der Artillerie je ±15 %, dazu eine **Treffer-bis-Tod-Matrix**, die exakt der FA-Referenz entspricht (§14). Die Zahlen sind Startwerte für das Balancing in MS8/MS9, keine Endwerte.

---

## 1. Quellen und Methodik

- **FA-Daten:** [FAForever/spooky-db](https://github.com/FAForever/spooky-db) `app/data/index.json` (Datenstand „3810“, 503 Blueprints), abgerufen 2026-09-29. DPS nach der dortigen Formel `app/js/dps.js` (Nachladezeit auf 0,1-s-Ticks abgerundet, Salven über `MuzzleSalvoSize`/Racks, DoT und Initialschaden addiert). Das Balance-Review hat alle 50 Referenzen (Kosten, HP, Waffen), die Adjacency-Tabelle und die Abstich-Konstanten gegen spooky-db 3810 und FAF `develop` bestätigt.
- **Stichprobe gegen den aktuellen FAF-Stand** ([FAForever/fa](https://github.com/FAForever/fa) `develop`, `units/*/…_unit.bp`): T1-Panzer, LAB und ACU sind identisch; T2-Flak, T2-PD und der FAF-T2-Gatling-Bot haben seither leicht geänderte Feuerraten. Vor dem MS9-Balancing einmal gegen den dann aktuellen FAF-Stand nachziehen (§18).
- **Adjacency:** Werte aus `lua/sim/AdjacencyBuffs.lua` (FAF `develop`), ACU-Lotbruch und Abstich-Formel aus `units/UEL0001/UEL0001_unit.bp` bzw. `lua/sim/projectiles/OverchargeProjectile.lua`.
- **Referenzwahl:** primär die UEF-Einheit der Rolle (Allrounder wie unsere Fraktion), Cybran als Gegenprobe (`crossCheckBp` im JSON). Fehlt eine UEF-Rolle (Sniper), wird eine andere FA-Fraktion genommen. **Nur Blueprint-IDs und generische Rollenbezeichnungen werden zitiert, keine FA-Eigennamen.** Das Feld `faReference` ist **dev-only** (`devOnly: true`): Der Blueprint-Build entfernt es per Lint, es landet nie in `view.json` oder i18n.
- **Einheiten:** 1 WU = 1 FA-Ogrid (20-km-Karte = 1.024 WU, DECISIONS „Setons“). Reichweite in WU, Tempo in WU/s, Drehrate in °/s. `buildTime` in FA-Semantik: Sekunden = buildTime / Build Power des Erbauers; Upgrade-Dauer = buildTime der Zielstufe / `buildPower` der Vorstufe. Bei Upgrade-Stufen sind Kosten Upgrade-Kosten.
- **Waffen:** `reloadS` ist ein Vielfaches von 0,1 s (10-Hz-Sim). DPS = Schaden × Salve / Nachladezeit. Bomber-DPS = Salve pro Anflug / Nachladezeit (theoretisch). Abstich (Overcharge) geht nicht in die DPS/Mass ein.
- **Abweichung:** Δ = (unser Wert / FA-Wert − 1) × 100. Bei Schild-Einheiten wird HP + Schild-HP verglichen (Mobiler Schild, Schildgeneratoren, T3-Belagerungsläufer gegen eine FA-Referenz mit Personal-Schild).
- **Produkt:** Δ Produkt = (DPS/Mass ÷ FA) × (HP/Mass ÷ FA) − 1. Es bestimmt die Stärke im direkten Gefecht und fängt Verschiebungen ab, die auf beiden Einzelachsen knapp im Band liegen.
- **Pulk-DPS/Mass (Artillerie):** Schaden × Salve × Ziele / Nachladezeit / Mass mit Ziele = π · (Splash + 0,5)² / 4. Rechenannahme: ein Ziel pro 4 WU² (2 WU Abstand), Zielradius 0,5 WU. Gilt für alle Einträge mit Kategorie `ARTILLERY`.
- **Treffer bis Tod:** Salven bis zum Tod = ⌈Ziel-HP / Salvenschaden⌉. Die Pflichtpaare in `checks.hitsToKill` müssen exakt der FA-Referenz entsprechen (FA-Salve aus spooky-DPS × Nachladezeit).
- **Kitbash:** Parts aus dem Katalog `faction.md` §3.3; ⟳ = animierter Part (≤ 2), `[mat]` = Material-Slot (`team`, `glow`, `copper`, `ceramic`, sonst `body`). Tris-Schätzung aus den Katalogwerten, `legs` mit ≈ 60 angesetzt. Budget: mobil ≤ 7 Parts, Strukturen ≤ 9, ≤ 350 Tris; Superset pro Visual mobil ≤ 8 Parts (PartStream-Limit), Strukturen ≤ 9. Lints im Generator: Glut-Monopol (`stack`/`glow` nur bei ECONOMIC, FACTORY, ENGINEER), mindestens ein Team-Part pro Blueprint, `buildPower` bei upgradebaren Gebäuden, `regenStartS` bei Schilden.
- **Maßstab (`kitbash.scale`):** mobil uniform T1 1,0 / T2 1,3 / T3 1,7, bei 1×1-Footprint höchstens 1,4. Strukturen: xz = Footprint-Kante / Footprint-Kante der niedrigsten Stufe des Visuals (Sockel füllt 100 % des Footprints), y = xz × Höhenfaktor (T1 1,0 / T2 1,2 / T3 1,4) relativ zur Basisstufe. In-Place-Upgrades wachsen also nur in der Höhe.
- **Spalten:** ● = MS9-Kern · MS = erster Meilenstein, in dem der Blueprint laut PLAN §5 gebraucht wird · RW = Reichweite · s = sizeClass · Sicht / R = Radar.

---

## 2. Zählung nach Meilenstein

| MS | neu gebraucht | Blueprints |
|---|---|---|
| MS4 | 3 (Σ 3) | ● Vogt, ● Zapfstelle I, ● Glutkessel I |
| MS5 | 1 (Σ 4) | ● Punze |
| MS6 | 4 (Σ 8) | ● Lehrling, ● Stichel, ● Glutspeicher, ● Landwerk I |
| MS7 | 3 (Σ 11) | ● Funke, ● Kelle, ● Sieb |
| MS8 | 13 (Σ 24) | ● Geselle, ● Meißel, ● Rinne, ● Rüttelsieb, ● Zapfstelle II, ● Glutkessel II, ● Landwerk II, ● Riegel I, ● Riegel II, ● Rost I, ● Rost II, ● Hochrost, ● Mauer |
| MS10 | 4 (Σ 28) | ● Dampfquelle, ● Erzspeicher, ○ Horcher I, ○ Horcher II |
| MS12 | 7 (Σ 35) | ○ Lerche, ○ Turmfalke, ○ Dohle, ○ Krähe, ○ Elster, ○ Luftwerk I, ○ Luftwerk II |
| MS13 | 14 (Σ 49) | ○ Meister, ○ Schürze, ○ Fallhammer, ○ Pfanne, ○ Reißnadel, ○ Trommelsieb, ○ Zapfstelle III, ○ Glutkessel III, ○ Landwerk III, ○ Horcher III, ○ Schirm II, ○ Schirm III, ○ Tiegel, ○ Hochofen |
| MS14 | 1 (Σ 50) | ○ Zange |

**MS9-Kern (26):** Vogt, Lehrling, Geselle, Funke, Stichel, Punze, Kelle, Sieb, Meißel, Rinne, Rüttelsieb, Zapfstelle I, Zapfstelle II, Glutkessel I, Glutkessel II, Dampfquelle, Erzspeicher, Glutspeicher, Landwerk I, Landwerk II, Riegel I, Riegel II, Rost I, Rost II, Hochrost, Mauer.

- 23 davon folgen direkt aus PLAN MS4–MS8 (U1, U2, U4, U5, U6, B4, B5, E5, E6). Die übrigen drei sind **Daten-Vorgriffe** ohne neue Mechanik: Glutspeicher (ab MS6, weil der Abstich ≥ 7.500 E Vorrat braucht), Erzspeicher (Speicherlimit E4 existiert ab MS4) und Dampfquelle (Spot-Regel wie beim Mex). Die Abnahme von E9/E10/E11 bleibt in MS10.
- **Hochrost (SAM)** gehört zum Kern, weil PLAN §5.3 B5 „MS8 (PD, Mauern, SAM)“ abnimmt. In MS8 wird er per Konsole/Test-Szenario gespawnt (Lenkflugkörper, K11); im Spiel baubar ist er erst mit dem Meister (MS13).

### 2.1 Abgrenzungen und Abweichungen

| Punkt | Festlegung | Grund |
|---|---|---|
| MS9-Kern ohne Luft und Radar | Lerche, Turmfalke, Dohle, Luftwerk I und Horcher I sind ○; dafür Glutkessel II, Riegel II, Rost II und Hochrost ● | Luft (U11, AirMovers) kommt erst in MS12, Radar (I3) in MS10. PD/AA/SAM fordert B5 in MS8, Pgen T2 die T2-Tech-Leiter (E6, KI bis T2 in MS9). |
| Horcher III | `core:str_t3_radar` enthalten | PLAN §5.3: Rest I3 = T3-Radar in MS13 |
| U6-Stealth | entfällt | I5 ist „Später“; U6 gilt mit der Schürze (mobiler Schild) als erfüllt. |
| Glutkessel, Riegel, Rost | kein In-Place-Upgrade; T2/T3 werden neu gebaut | wie FA; generisches B8 ist Post-MVP. Upgrades nur bei Zapfstelle, Werken, Horcher, Schirm. |
| `faction.md` §7.4 / §10.1 | an dieses Roster angeglichen (Review A3) | `roster.json` ist die einzige Quelle für Zahlen und ●/○. |

---

## 3. Hotbuild-Raster (QWERT / ASDFG / ZXCVB, ohne Rebinding)

Gleiche Taste = gleiche Rolle über alle Tech-Stufen. Mehrfaches Drücken wechselt **nur die Tech-Stufe** (höchste baubare zuerst), nie den Typ. Upgrade-Stufen laufen über das Upgrade-Kommando der Command Card. Das Bau-Menü nutzt die fünfte Spalte (T), weil 13 Rollen nicht auf 12 Tasten passen.

**Landwerk (Fabrik-Menü)**

| | Q / A / Z | W / S / X | E / D / C | R / F / V | T / G / B |
|---|---|---|---|---|---|
| Reihe 1 | **Q** Panzer (Punze/Meißel) | **W** Artillerie (Kelle/Rinne/Pfanne) | **E** Engineer (Lehrling/Geselle/Meister) | **R** Flugabwehr (Sieb/Rüttelsieb/Trommelsieb) | – |
| Reihe 2 | **A** Späher (Funke) | **S** Bots (Stichel/Zange/Fallhammer) | **D** Support (Schürze) | **F** Präzision (Reißnadel) | – |

**Luftwerk (Fabrik-Menü)**

| | Q / A / Z | W / S / X | E / D / C | R / F / V | T / G / B |
|---|---|---|---|---|---|
| Reihe 1 | **Q** Abfangjäger (Turmfalke) | **W** Bomber (Dohle) | **E** Gunship (Krähe) | **R** Jagdbomber (Elster) | – |
| Reihe 2 | **A** Aufklärer (Lerche) | – | – | – | – |

**Bau-Menü (Vogt und Engineers)**

| | Q / A / Z | W / S / X | E / D / C | R / F / V | T / G / B |
|---|---|---|---|---|---|
| Reihe 1 | **Q** Zapfstelle | **W** Glutkessel | **E** Dampfquelle | **R** Erzspeicher | **T** Glutspeicher |
| Reihe 2 | **A** Landwerk | **S** Luftwerk | **D** Horcher | **F** Schirm | **G** Großguss (T4-Untermenü, Post-MVP) |
| Reihe 3 | **Z** Riegel | **X** Rost/Hochrost | **C** Mauer | **V** Tiegel/Hochofen | – |

**Großguss (T4-Untermenü über Bau: G, nur Meister, Post-MVP)**

| | Q / A / Z | W / S / X | E / D / C | R / F / V | T / G / B |
|---|---|---|---|---|---|
| Reihe 1 | **Q** Sturmläufer (Stampfe) | **W** Strategische Artillerie (Konverter) | **E** Mobile Gießhalle (Kokille) | – | – |
| Reihe 2 | **A** Tiefenzapfwerk (Tiefenstich) | **S** Luft-Experimental (Kolkrabe) | – | **F** Großschild (Mantel) | – |

---

## 4. Kommandant und Engineers

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `core:cmd_commander` | **Vogt** / Reeve | Kommandant / Commander | Armored Command Unit (ACU) (`UEL0001`, Gegenprobe `URL0001`) | MS4 | 2.000 / 5.000.000 / 6.000.000 | 12.000 | 1,7 / 90° | 2×2 / s2 | 26 | – | `cmd_commander` |
| ● | `core:lnd_t1_engineer` | **Lehrling** / Prentice | Ingenieur / Engineer | T1 Engineer (`UEL0105`) | MS6 | 52 / 260 / 260 | 160 | 1,9 / 180° | 1×1 / s1 | 18 | Landwerk: E | `eng_build_t1` |
| ● | `core:lnd_t2_engineer` | **Geselle** / Journeyman | Ingenieur / Engineer | T2 Engineer (`UEL0208`) | MS8 | 130 / 650 / 650 | 420 | 1,9 / 150° | 1×1 / s1 | 20 | Landwerk: E | `eng_build_t2` |
| ○ | `core:lnd_t3_engineer` | **Meister** / Master | Ingenieur / Engineer | T3 Engineer (`UEL0309`) | MS13 | 310 / 1.550 / 1.550 | 840 | 1,9 / 120° | 1×1 / s1 | 26 | Landwerk: E | `eng_build_t3` |

**Waffen und Balance** (Δ gegenüber FA-Referenz)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `cmd_commander` | `wpn_reeve_cannon` Direktfeuer-Kanone: 100 / 1 s = **100 DPS**, RW 1–22, linear<br>`wpn_reeve_tapshot` Abstich (Overcharge, manuell/auto): 15.000 / 3,3 s = **4545,4 DPS**, RW 22, linear, Splash 2,5 | 0,05 (0,05) | ±0 % | 6 (6) | ±0 % | ±0 % |
| `lnd_t1_engineer` | – | – (–) | – | 3,077 (2,885) | +6,7 % | – |
| `lnd_t2_engineer` | – | – (–) | – | 3,231 (3,077) | +5 % | – |
| `lnd_t3_engineer` | – | – (–) | – | 2,71 (2,564) | +5,7 % | – |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `cmd_commander` | LAND MOBILE COMMAND ENGINEER DIRECTFIRE RECLAIM REPAIR UNIQUE | BP 10 · +1 M/s · +20 E/s · Speicher 650 M · Speicher 3.900 E<br>Toggles: auto_tapshot (MS10, C17)<br>Death: `wpn_plumb_break` 2.000/r30 + 500/r40 (Lotbruch, Kamera-Shake X4, FA-Relation 1:1)<br>Einzigartig, Tod = Niederlage (U1/A4). Baut alle T1-Strukturen. Regeneration 10 HP/s. Wrack offen (faction.md §10.2 Nr. 3). | Lot-Kopf auf Bot-Beinen, Torso-Wanne mit Schulterplatten (Team), Rücken-Schlot als stärkster Glutpunkt; Glocke mit Rohr auf der rechten Schulter, Keramik-Rückenkran über die linke Schulter (kein Waffen-/Bauarm-Schema). Höhe ≥ 2,4 WU, Schulterbreite ≥ 2,0 WU.<br>legs, hull(torso) ⟳yaw, plumb(kopf) [team], stack(rueckenschlot) [glow], bell(rechte schulter) [team], barrel ⟳pitch, boom(rueckenkran) [ceramic] — 7 Parts, 2 anim., ≈ 256 Tris · Maßstab 1 · keine Streifen | MS4 Bauen ohne Waffe; MS5 Waffe + Lotbruch; MS6 Abstich (U8) |
| `lnd_t1_engineer` | LAND MOBILE ENGINEER TECH1 RECLAIM REPAIR<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | BP 5<br>Baut T1-Strukturen, Assist, Reclaim, Repair. FA-Engineers sind amphibisch, hier nur land (Marine Post-MVP). | Kurze breite Wanne mit Keramik-Deck, ein diagonaler Kupfer-Kranarm mit Glut-Emitter, liegender Kessel mit teamfarbenem Bauchband; 1 Tech-Streifen graphit auf dem Keramik-Deck.<br>hull [ceramic], tracks, boiler(kessel bauchband) [team], boom ⟳yaw [copper], ring(emitter) ⟳pitch [glow] — 5 Parts, 2 anim., ≈ 172 Tris · Maßstab 1 · 1 Streifen (graphit) | U2 (T1) in MS6 |
| `lnd_t2_engineer` | LAND MOBILE ENGINEER TECH2 RECLAIM REPAIR<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | BP 13<br>Baut T1+T2-Strukturen (u. a. Zapfstelle II direkt, Glutkessel II, Riegel II, Rost II). | Wie Lehrling, Maßstab 1,3, zwei Kupfer-Kranarme verschiedener Länge, 2 Tech-Streifen graphit.<br>hull [ceramic], tracks, boiler(kessel bauchband) [team], boom ⟳yaw [copper], boom(kurzer arm) ⟳yaw [copper], ring(emitter) [glow] — 6 Parts, 2 anim., ≈ 196 Tris · Maßstab 1,3 · 2 Streifen (graphit) | U2 T2 als Daten in MS8 |
| `lnd_t3_engineer` | LAND MOBILE ENGINEER TECH3 RECLAIM REPAIR<br>*von:* `FACTORY & LAND & TECH3` | BP 32<br>Baut T1–T3-Strukturen (Hochrost, Hochofen, Glutkessel III, Zapfstelle III). | Maßstab 1,4 (Deckel für 1×1-Footprint), drei Kupfer-Kranarme (Anzahl = Tech), 3 Tech-Streifen graphit; dritter Arm statisch (Anim-Limit 2).<br>hull [ceramic], tracks, boiler(kessel bauchband) [team], boom ⟳yaw [copper], boom ⟳yaw [copper], boom(dritter arm) [copper], ring(emitter) [glow] — 7 Parts, 2 anim., ≈ 220 Tris · Maßstab 1,4 · 3 Streifen (graphit) | Rest U2 (T3-Engineer) in MS13 |

---

## 5. Landarmee T1

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `core:lnd_t1_scout` | **Funke** / Spark | Späher / Scout | T1 Land Scout (`UEL0101`, Gegenprobe `URL0101`) | MS7 | 12 / 80 / 60 | 32 | 4,5 / 90° | 1×1 / s1 | 26 / R 40 | Landwerk: A | `land_intel_t1` |
| ● | `core:lnd_t1_bot` | **Stichel** / Graver | Leichter Sturmläufer / Light Assault Bot | T1 Light Assault Bot (`UEL0106`, Gegenprobe `URL0106`) | MS6 | 30 / 120 / 120 | 60 | 4,3 / 60° | 1×1 / s1 | 18 | Landwerk: S | `land_bot_t1` |
| ● | `core:lnd_t1_tank` | **Punze** / Punch | Kampfpanzer / Battle Tank | T1 Medium Tank (`UEL0201`, Gegenprobe `URL0107`) | MS5 | 56 / 280 / 300 | 300 | 3,3 / 90° | 1×1 / s1 | 20 | Landwerk: Q | `land_direct_t1` |
| ● | `core:lnd_t1_arty` | **Kelle** / Ladle | Mobile Artillerie / Mobile Artillery | T1 Mobile Light Artillery (`UEL0103`, Gegenprobe `URL0103`) | MS7 | 36 / 180 / 200 | 210 | 2,7 / 90° | 1×1 / s1 | 18 | Landwerk: W | `land_arty_t1` |
| ● | `core:lnd_t1_aa` | **Sieb** / Sieve | Mobile Flugabwehr / Mobile AA | T1 Mobile Anti-Air Gun (`UEL0104`, Gegenprobe `URL0104`) | MS7 | 55 / 275 / 220 | 310 | 3,3 / 80° | 1×1 / s1 | 20 | Landwerk: R | `land_aa_t1` |

**Waffen und Balance** (Δ gegenüber FA-Referenz)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `lnd_t1_scout` | `wpn_spark_mg_t1` Rumpf-MG (fester Bugwinkel 90°): 4 / 2 s = **2 DPS**, RW 22, linear | 0,167 (0,167) | ±0 % | 2,667 (2,417) | +10,3 % | +10,3 % |
| `lnd_t1_bot` | `wpn_mg_t1` Schnellfeuer-MG: 7 / 0,3 s = **23,3 DPS**, RW 14, linear | 0,778 (0,778) | ±0 % | 2 (2) | ±0 % | ±0 % |
| `lnd_t1_tank` | `wpn_cannon_t1` Glockenkanone: 28 / 1,2 s = **23,3 DPS**, RW 18, linear | 0,417 (0,429) | −2,8 % | 5,357 (5,357) | ±0 % | −2,8 % |
| `lnd_t1_arty` | `wpn_slag_mortar_t1` Schlackenmörser: 100 / 9 s = **11,1 DPS**, RW 6–30, ballistisch, Splash 1,1<br>Pulk-DPS/Mass 0,621 (FA 0,591): +4,9 % | 0,309 (0,335) | −7,8 % | 5,833 (5,694) | +2,4 % | −5,6 % |
| `lnd_t1_aa` | `wpn_aa_repeater_t1` Zwillings-Flugabwehrkanone: 2×14 / 1 s = **28 DPS**, RW 30, linear (Vorhalt) [Luft] | 0,509 (0,473) | +7,7 % | 5,636 (5,636) | ±0 % | +7,7 % |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `lnd_t1_scout` | LAND MOBILE SCOUT INTELLIGENCE TECH1 DIRECTFIRE<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Kein Turm (Monopol-Regel); Waffe starr im Rumpf, arcDeg 90. | Kleinster Rumpf (Deck teamfarben), hoher dünner Mast ≥ 1,0 × Rumpflänge ohne Kopfteil, Glutnaht an der Spitze.<br>hull [team], tracks, mast [copper] — 3 Parts, 0 anim., ≈ 76 Tris · Maßstab 1 · 1 Streifen (keramik) | U4 T1-Armee in MS7; Radar-Feld wirkt ab MS10 (I3) |
| `lnd_t1_bot` | LAND MOBILE DIRECTFIRE BOT TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Raider/Engineer-Jäger: höchste DPS/Mass der T1-Armee, wenig HP. Kosten und HP seit dem fraktionsübergreifenden Abgleich exakt FA-Relation (vorher 32 Mass / 70 HP; das verschob vier Kreuz-Breakpoints, factions/README.md §5.4). | Kleine Wanne auf Beinen, Glocke mit kurzem waagerechtem Rohr.<br>legs, hull, bell ⟳yaw [team], barrel ⟳pitch — 4 Parts, 2 anim., ≈ 168 Tris · Maßstab 1 · 1 Streifen (keramik) | erste Fabrik-Einheit im Opening (MS6); U4 abgenommen MS7 |
| `lnd_t1_tank` | LAND MOBILE DIRECTFIRE TANK TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Linienhalter nach FA-Relation. HP 300 hält die Breakpoints: 3 Vogt-Treffer, 6 Riegel-I-Treffer, 5 Meißel-Salven. | Gedrungene Wanne 1,0×0,4×1,4 WU auf Ketten, mittige Glocke, Rohr ≈ 65 % der Rumpflänge über den Bug.<br>hull [team], tracks, bell ⟳yaw [team], barrel ⟳pitch, barrel(kupferleitung) [copper] — 5 Parts, 2 anim., ≈ 156 Tris · Maßstab 1 · 1 Streifen (keramik) | erste Kampfeinheit (Konsole, MS5), Fabrik ab MS6 |
| `lnd_t1_arty` | LAND MOBILE INDIRECTFIRE ARTILLERY TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Splash 1,1 statt 1 (FA), dafür langsamer (9,0 s statt 8,3 s). Schaden 100 wie FA: 1 Treffer Stichel, 2 Lehrling, 3 Punze. Glüht nur beim Schuss (0,5 s). | Lange schmale Wanne, offene Kelle auf kurzem Schwenkarm, Gegengewicht am Heck; keine Glocke, kein waagerechtes Rohr.<br>hull [team], tracks, boom ⟳yaw, ladle ⟳pitch [team], hull(gegengewicht) — 5 Parts, 2 anim., ≈ 152 Tris · Maßstab 1 · 1 Streifen (keramik) | K2 Ballistik in MS7 |
| `lnd_t1_aa` | LAND MOBILE ANTIAIR TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Nur Luftziele. | Wanne mit Rost-Platte, darauf 2 dünne senkrechte Rohre (≥ 75°) als Kamm quer zur Fahrtrichtung.<br>hull [team], tracks, grate ⟳yaw, barrel(senkrecht), barrel(senkrecht) — 5 Parts, 1 anim., ≈ 112 Tris · Maßstab 1 · 1 Streifen (keramik) | U4 in MS7, Wirkung gegen Luft MS12 |

---

## 6. Landarmee T2

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `core:lnd_t2_tank` | **Meißel** / Chisel | Schwerer Panzer / Heavy Tank | T2 Heavy Tank (`UEL0202`, Gegenprobe `URL0202`) | MS8 | 200 / 1.000 / 900 | 1.600 | 2,9 / 90° | 1×1 / s2 | 20 | Landwerk: Q | `land_direct_t2` |
| ● | `core:lnd_t2_mml` | **Rinne** / Runner | Raketenwerfer / Missile Launcher | T2 Mobile Missile Launcher (`UEL0111`, Gegenprobe `URL0111`) | MS8 | 180 / 1.300 / 800 | 780 | 2,8 / 90° | 1×1 / s2 | 18 | Landwerk: W | `land_mml_t2` |
| ● | `core:lnd_t2_aa` | **Rüttelsieb** / Riddle | Flak / Flak | T2 Mobile AA Flak Artillery (`UEL0205`, Gegenprobe `URL0205`) | MS8 | 160 / 800 / 800 | 1.050 | 3 / 90° | 1×1 / s2 | 20 | Landwerk: R | `land_aa_t2` |
| ○ | `core:lnd_t2_shield` | **Schürze** / Apron | Mobiler Schild / Mobile Shield | T2 Mobile Shield Generator (`UEL0307`) | MS13 | 220 / 950 / 700 | 160 | 3,4 / 120° | 1×1 / s1 | 20 | Landwerk: D | `land_shield_t2` |
| ○ | `core:lnd_t2_bot` | **Zange** / Tongs | Sturmläufer / Assault Bot | T2 Gatling Bot (FAF) (`DEL0204`) | MS14 | 190 / 950 / 950 | 650 | 3,2 / 80° | 1×1 / s1 | 24 | Landwerk: S | `land_bot_t2` |

**Waffen und Balance** (Δ gegenüber FA-Referenz)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `lnd_t2_tank` | `wpn_cannon_t2` Doppel-Glockenkanone: 2×35 / 1,3 s = **53,9 DPS**, RW 22, linear | 0,269 (0,272) | −1 % | 8 (7,576) | +5,6 % | +4,5 % |
| `lnd_t2_mml` | `wpn_runner_missile_t2` Glutraketen (2er-Salve): 2×300 / 10 s = **60 DPS**, RW 12–60, homing (Wenderate, K11), Splash 1<br>Pulk-DPS/Mass 0,589 (FA 0,589): ±0 % | 0,333 (0,333) | ±0 % | 4,333 (4,583) | −5,5 % | −5,5 % |
| `lnd_t2_aa` | `wpn_flak_t2` Splitterflak: 70 / 0,5 s = **140 DPS**, RW 38, linear + Näherungszünder (MS12), Splash 4 [Luft] | 0,875 (0,9) | −2,8 % | 6,562 (6,25) | +5 % | +2,1 % |
| `lnd_t2_shield` | – | – (–) | – | 15,273 (14,318) (inkl. Schild) | +6,7 % | – |
| `lnd_t2_bot` | `wpn_gatling_t2` Glut-Gatling: 20 / 0,3 s = **66,7 DPS**, RW 30, linear | 0,351 (0,345) | +1,6 % | 3,421 (3,25) | +5,3 % | +6,9 % |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `lnd_t2_tank` | LAND MOBILE DIRECTFIRE TANK TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | Rohre am Glocken-Part geparentet (1 animierter Part). | Punze ×1,3, breitere Glocke mit zwei parallelen Rohren, seitliche Schürzenplatten, 2 Tech-Streifen.<br>hull [team], tracks, bell ⟳yaw [team], barrel, barrel, hull(schuerze l), hull(schuerze r) — 7 Parts, 1 anim., ≈ 212 Tris · Maßstab 1,3 · 2 Streifen (keramik) | U6 in MS8 |
| `lnd_t2_mml` | LAND MOBILE INDIRECTFIRE ARTILLERY SILO TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | Lenkflugkörper mit begrenzter Wenderate (ausweichbar, K11). | Wanne mit liegendem Kessel, ein breiter Raketenkasten 0,5 × 0,25 × 1,1 WU auf Schwenkarm, 50° geneigt (≥ 25° flacher als AA-Rohre, Breite ≥ 2 × AA-Rohr-Ø); kein Rohr.<br>hull [team], tracks, boiler, boom ⟳yaw, hull(raketenkasten) ⟳pitch — 5 Parts, 2 anim., ≈ 152 Tris · Maßstab 1,3 · 2 Streifen (keramik) | U6 inkl. MML über K11 in MS8 |
| `lnd_t2_aa` | LAND MOBILE ANTIAIR TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | Nur Luftziele, Splash trifft Pulks. | Sieb ×1,3 mit 3 senkrechten Rohren (≥ 75°) und Schürzenplatte, 2 Tech-Streifen.<br>hull [team], tracks, grate ⟳yaw, barrel, barrel, barrel, hull(schuerze) — 7 Parts, 1 anim., ≈ 164 Tris · Maßstab 1,3 · 2 Streifen (keramik) | U6 in MS8, Wirkung/Näherungszünder MS12 |
| `lnd_t2_shield` | LAND MOBILE SHIELD DEFENSE TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | Toggles: shield (MS13, C17)<br>Schild 3.200 HP, r 16, Regen 50/s ab 3 s nach dem letzten Treffer, Neuaufbau 25 s, 80 E/s<br>Kuppelschild; Energy-Stall schaltet ab (E3). Vergleich HP/Mass über HP+Schild. | Wanne mit Mast, waagerechter Ring (Ø ≥ 1,2 × Rumpfbreite) als höchster Punkt; kein Rohr, keine Glocke.<br>hull [team], tracks, mast, ring(waagerecht) ⟳yaw [team] — 4 Parts, 1 anim., ≈ 124 Tris · Maßstab 1,3 · 2 Streifen (keramik) | Rest U6 (mobiler Schild) mit K10 in MS13 |
| `lnd_t2_bot` | LAND MOBILE DIRECTFIRE BOT TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | Sturm-Bot, der Riegel I (RW 26) überreicht; RW 30 statt 34 (FA), 1 Waffe statt 2. | Stichel ×1,3 mit Schürzenplatten und 2 Tech-Streifen.<br>legs, hull [team], bell ⟳yaw [team], barrel ⟳pitch, hull(schuerze l), hull(schuerze r) — 6 Parts, 2 anim., ≈ 224 Tris · Maßstab 1,3 · 2 Streifen (keramik) | Roster-Auffüllung auf 45–55 BP (MS14); nicht Teil von U6 |

---

## 7. Landarmee T3

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ○ | `core:lnd_t3_bot` | **Fallhammer** / Drophammer | Belagerungsläufer / Siege Bot | T3 Heavy Assault Bot (`UEL0303`, Gegenprobe `URL0303`) | MS13 | 500 / 5.000 / 2.500 | 3.200 | 3,3 / 100° | 2×2 / s2 | 22 | Landwerk: S | `land_bot_t3` |
| ○ | `core:lnd_t3_arty` | **Pfanne** / Pour Pan | Schwere Artillerie / Heavy Artillery | T3 Mobile Heavy Artillery (`UEL0304`, Gegenprobe `URL0304`) | MS13 | 800 / 8.000 / 4.300 | 1.000 | 2,2 / 75° | 2×2 / s2 | 26 | Landwerk: W | `land_arty_t3` |
| ○ | `core:lnd_t3_sniper` | **Reißnadel** / Scriber | Präzisionsläufer / Sniper Bot | T3 Sniper Bot (UEF/Cybran haben keinen – Referenz aus anderer FA-Fraktion) (`XAL0305`, Gegenprobe `XSL0305`) | MS13 | 720 / 20.000 / 4.800 | 560 | 2,4 / 110° | 1×1 / s1 | 26 | Landwerk: F | `land_sniper_t3` |
| ○ | `core:lnd_t3_aa` | **Trommelsieb** / Trommel | Schwere Flugabwehr / Heavy AA | T3 Mobile Rapid-fire AA Cannon (FAF) (`DELK002`) | MS13 | 600 / 7.000 / 3.000 | 2.000 | 3,3 / 100° | 1×1 / s2 | 26 | Landwerk: R | `land_aa_t3` |

**Waffen und Balance** (Δ gegenüber FA-Referenz)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `lnd_t3_bot` | `wpn_cannon_t3` Doppel-Glocke, schwer: 2×60 / 0,8 s = **150 DPS**, RW 24, linear | 0,3 (0,312) | −4 % | 6,4 (6,458) (inkl. Schild) | −0,9 % | −4,9 % |
| `lnd_t3_arty` | `wpn_pour_shell_t3` Gießgranate: 700 / 10 s = **70 DPS**, RW 25–85, ballistisch, Splash 4,4<br>Pulk-DPS/Mass 1,65 (FA 1,491): +10,7 % | 0,087 (0,094) | −6,7 % | 1,25 (1,188) | +5,3 % | −1,8 % |
| `lnd_t3_sniper` | `wpn_scriber_rail_t3` Langrohr-Präzisionskanone: 1.000 / 7 s = **142,9 DPS**, RW 58, linear (schnell) | 0,198 (0,206) | −3,5 % | 0,778 (0,714) | +8,9 % | +5,1 % |
| `lnd_t3_aa` | `wpn_aa_drum_t3` Trommel-Flugabwehrkanone: 105 / 0,5 s = **210 DPS**, RW 55, linear (Vorhalt), Splash 1,5 [Luft] | 0,35 (0,353) | −1 % | 3,333 (3,167) | +5,3 % | +4,2 % |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `lnd_t3_bot` | LAND MOBILE DIRECTFIRE BOT TECH3<br>*von:* `FACTORY & LAND & TECH3` | Kein Personal-Schild (FA-Referenz hat 700 Schild-HP) – dafür mehr Rumpf-HP; Vergleich über HP+Schild. | Überlange Wanne auf Beinen, Doppelaufbau aus zwei Glocken, 3 Tech-Streifen; kein Schlot (Glut-Monopol).<br>legs, hull [team], bell ⟳yaw [team], barrel, bell ⟳yaw [team], barrel — 6 Parts, 2 anim., ≈ 248 Tris · Maßstab 1,7 · 3 Streifen (keramik) | U10 T3-Landarmee in MS13 |
| `lnd_t3_arty` | LAND MOBILE INDIRECTFIRE ARTILLERY TECH3<br>*von:* `FACTORY & LAND & TECH3` | Kein Deploy (FA-Referenz muss sich aufstellen) – ein Mechanik-Sonderfall weniger. | Kelle ×1,7 auf überlanger Wanne, 3 Tech-Streifen; kein Schlot (Glut-Monopol).<br>hull [team], tracks, boom ⟳yaw, ladle ⟳pitch [team], hull(gegengewicht) — 5 Parts, 2 anim., ≈ 152 Tris · Maßstab 1,7 · 3 Streifen (keramik) | U10 in MS13 |
| `lnd_t3_sniper` | LAND MOBILE DIRECTFIRE SNIPER BOT TECH3<br>*von:* `FACTORY & LAND & TECH3` | Energy-Anteil niedriger als FA (20k statt 25k), sonst FA-Relation. | Schlanke Beine, Glocke mit extrem langem waagerechtem Rohr (≥ 1,2 × Rumpflänge), kein zweites Rohr; Maßstab 1,4 (1×1-Deckel).<br>legs, hull [team], bell ⟳yaw [team], barrel(langrohr) ⟳pitch — 4 Parts, 2 anim., ≈ 168 Tris · Maßstab 1,4 · 3 Streifen (keramik) | U10 in MS13 |
| `lnd_t3_aa` | LAND MOBILE ANTIAIR TECH3<br>*von:* `FACTORY & LAND & TECH3` | Nur Luftziele. | Sieb ×1,4 (1×1-Deckel) mit 4 senkrechten Rohren, 3 Tech-Streifen.<br>hull [team], tracks, grate ⟳yaw, barrel, barrel, barrel, barrel — 7 Parts, 1 anim., ≈ 160 Tris · Maßstab 1,4 · 3 Streifen (keramik) | U10 in MS13 |

---

## 8. Luftwaffe T1–T2

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ○ | `core:air_t1_scout` | **Lerche** / Lark | Aufklärer / Air Scout | T1 Air Scout (`UEA0101`) | MS12 | 40 / 560 / 200 | 40 | 18 / 100° | 1×1 / s0 | 40 / R 60 | Luftwerk: A | `air_intel_t1` |
| ○ | `core:air_t1_fighter` | **Turmfalke** / Kestrel | Abfangjäger / Interceptor | T1 Interceptor (`UEA0102`, Gegenprobe `URA0102`) | MS12 | 50 / 2.200 / 500 | 295 | 15 / 120° | 1×1 / s0 | 28 | Luftwerk: Q | `air_aa_t1` |
| ○ | `core:air_t1_bomber` | **Dohle** / Jackdaw | Bomber / Bomber | T1 Attack Bomber (`UEA0103`, Gegenprobe `URA0103`) | MS12 | 90 / 2.000 / 500 | 230 | 10 / 80° | 1×1 / s0 | 32 / R 40 | Luftwerk: W | `air_bomb_t1` |
| ○ | `core:air_t2_gunship` | **Krähe** / Crow | Kampfschweber / Gunship | T2 Gunship (`UEA0203`, Gegenprobe `URA0203`) | MS12 | 200 / 3.800 / 1.300 | 760 | 12 / 90° | 1×1 / s0 | 32 | Luftwerk: E | `air_direct_t2` |
| ○ | `core:air_t2_fbomber` | **Elster** / Magpie | Jagdbomber / Fighter-Bomber | T2 Fighter/Bomber (FAF) (`DEA0202`) | MS12 | 340 / 11.000 / 2.600 | 1.150 | 15 / 110° | 1×1 / s0 | 32 / R 60 | Luftwerk: R | `air_fbomb_t2` |

**Waffen und Balance** (Δ gegenüber FA-Referenz)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `air_t1_scout` | – | – (–) | – | 1 (0,875) | +14,3 % | – |
| `air_t1_fighter` | `wpn_kestrel_gun_t1` Zwillings-Luftkanone: 2×25 / 1 s = **50 DPS**, RW 25, linear (Vorhalt) [Luft] | 1 (1) | ±0 % | 5,9 (5,9) | ±0 % | ±0 % |
| `air_t1_bomber` | `wpn_slag_bomb_t1` Schlackenbomben (4er-Reihe): 4×85 / 5 s = **68 DPS**, RW 40, ballistisch (Abwurf), Splash 3 | 0,756 (0,778) | −2,9 % | 2,556 (2,389) | +7 % | +3,9 % |
| `air_t2_gunship` | `wpn_crow_gun_t2` Bauch-Glocke: 16 / 0,3 s = **53,3 DPS**, RW 22, linear | 0,267 (0,278) | −4 % | 3,8 (3,646) | +4,2 % | +0,1 % |
| `air_t2_fbomber` | `wpn_magpie_gun_t2` Luftkanonen (2 Läufe): 2×70 / 1 s = **140 DPS**, RW 30, linear (Vorhalt) [Luft]<br>`wpn_magpie_bomb_t2` Schlackenbomben (2er): 2×360 / 5 s = **144 DPS**, RW 50, ballistisch (Abwurf), Splash 3 | 0,835 (0,861) | −3 % | 3,382 (3,333) | +1,5 % | −1,6 % |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `air_t1_scout` | AIR MOBILE SCOUT INTELLIGENCE TECH1<br>*von:* `FACTORY & AIR & (TECH1 \| TECH2)` | Death: `wpn_air_crash_s` 10/r1 (Absturzschaden (K12))<br>Unbewaffnet, Mindesttempo 16. | Kleinster Flieger, gerader Kurzflügel, einzelnes Seitenleitwerk.<br>hull [team], wing [team], wing(seitenleitwerk) — 3 Parts, 0 anim., ≈ 52 Tris · Maßstab 1 · 1 Streifen (keramik) | U11 Luftwaffe in MS12 |
| `air_t1_fighter` | AIR MOBILE ANTIAIR TECH1<br>*von:* `FACTORY & AIR & (TECH1 \| TECH2)` | Death: `wpn_air_crash_s` 25/r1 (Absturzschaden (K12))<br>Nur Luftziele; verfolgt mit Vorhalt. | Schmales, stark gepfeiltes Delta (lang > breit), 2 Glutnähte am Heck.<br>hull, wing(delta) [team], wing(leitwerk) — 3 Parts, 0 anim., ≈ 52 Tris · Maßstab 1 · 1 Streifen (keramik) | U11 in MS12 |
| `air_t1_bomber` | AIR MOBILE BOMBER TECH1<br>*von:* `FACTORY & AIR & (TECH1 \| TECH2)` | Death: `wpn_air_crash_m` 100/r1 (Absturzschaden (K12))<br>Bombenreihe quer zur Anflugrichtung; Snipe-Gate MS12. | Gerader Breitflügel (breit ≥ lang) mit Bauch-Kessel, T-Form von oben; Kessellänge ≥ 1,4 × Flügeltiefe, ragt vorn und hinten sichtbar über.<br>hull, wing(breitfluegel) [team], boiler(bombenbauch) — 3 Parts, 0 anim., ≈ 88 Tris · Maßstab 1 · 1 Streifen (keramik) | U11 in MS12 (Bomber-FSM) |
| `air_t2_gunship` | AIR MOBILE GUNSHIP DIRECTFIRE TECH2<br>*von:* `FACTORY & AIR & TECH2` | Death: `wpn_air_crash_m` 100/r1 (Absturzschaden (K12))<br>Schwebt im Orbit um das Ziel. Kein Transport (U13 Post-MVP). | Keine Flügel: Ringdüse als Scheibe, darunter Glocke mit Rohr.<br>ductfan ⟳yaw [team], hull, bell ⟳yaw, barrel — 4 Parts, 2 anim., ≈ 164 Tris · Maßstab 1,3 · 2 Streifen (keramik) | U11 in MS12 (Orbit) |
| `air_t2_fbomber` | AIR MOBILE BOMBER ANTIAIR TECH2<br>*von:* `FACTORY & AIR & TECH2` | Death: `wpn_air_crash_l` 200/r1 (Absturzschaden (K12))<br>Beide Waffen addiert im DPS-Vergleich (wie FA-Referenz). Luftkanonen 2 × 70 seit dem fraktionsübergreifenden Abgleich (FA-Referenz hat zwei Railguns, spooky zählte nur eine; factions/README.md §5.4). | Delta mit zwei Kessel-Gondeln an den Flügelspitzen, Spannweite +30 % gegenüber Turmfalke; keine Ringdüse.<br>hull, wing(delta) [team], boiler(gondel l), boiler(gondel r), wing(leitwerk) — 5 Parts, 0 anim., ≈ 148 Tris · Maßstab 1,3 · 2 Streifen (keramik) | U11 in MS12 |

---

## 9. Wirtschaft

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `core:str_t1_mex` | **Zapfstelle I** / Tap I | Massebohrung / Mass Extractor | T1 Mass Extractor (`UEB1103`) | MS4 | 36 / 360 / 60 | 400 | – | 2×2 | – | Bau: Q | `struct_mass_t1` |
| ● | `core:str_t2_mex` | **Zapfstelle II** / Tap II | Massebohrung / Mass Extractor | T2 Mass Extractor (Upgrade-Kosten) (`UEB1202`) | MS8 | 900 / 5.400 / 900 | 2.100 | – | 2×2 | 20 | Bau: Q (Upgrade: Command Card) | `struct_mass_t2` |
| ○ | `core:str_t3_mex` | **Zapfstelle III** / Tap III | Massebohrung / Mass Extractor | T3 Mass Extractor (Upgrade-Kosten) (`UEB1302`) | MS13 | 4.500 / 31.000 / 2.900 | 7.000 | – | 2×2 | 20 | Bau: Q (Upgrade: Command Card) | `struct_mass_t3` |
| ● | `core:str_t1_pgen` | **Glutkessel I** / Ember Boiler I | Kraftwerk / Power Generator | T1 Power Generator (`UEB1101`) | MS4 | 75 / 750 / 125 | 620 | – | 2×2 | – | Bau: W | `struct_energy_t1` |
| ● | `core:str_t2_pgen` | **Glutkessel II** / Ember Boiler II | Kraftwerk / Power Generator | T2 Power Generator (`UEB1201`) | MS8 | 1.200 / 12.000 / 2.200 | 2.600 | – | 6×6 | 20 | Bau: W | `struct_energy_t2` |
| ○ | `core:str_t3_pgen` | **Glutkessel III** / Ember Boiler III | Kraftwerk / Power Generator | T3 Power Generator (`UEB1301`) | MS13 | 3.200 / 57.000 / 6.800 | 9.000 | – | 8×8 | 20 | Bau: W | `struct_energy_t3` |
| ● | `core:str_t1_hydro` | **Dampfquelle** / Vent Cap | Dampfkraftwerk / Geothermal Plant | T1 Hydrocarbon Power Plant (`UEB1102`) | MS10 | 160 / 800 / 400 | 1.800 | – | 6×6 | – | Bau: E | `struct_hydro_t1` |
| ● | `core:str_t1_mstore` | **Erzspeicher** / Ore Silo | Massespeicher / Mass Storage | T1 Mass Storage (`UEB1106`) | MS10 | 200 / 1.500 / 250 | 850 | – | 2×2 | – | Bau: R | `struct_mstore_t1` |
| ● | `core:str_t1_estore` | **Glutspeicher** / Heat Bank | Energiespeicher / Energy Storage | T1 Energy Storage (`UEB1105`) | MS6 | 250 / 1.200 / 200 | 520 | – | 2×2 | – | Bau: T | `struct_estore_t1` |

**Waffen und Balance** (Δ gegenüber FA-Referenz)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `str_t1_mex` | – | – (–) | – | 11,111 (11,111) | ±0 % | – |
| `str_t2_mex` | – | – (–) | – | 2,333 (2,222) | +5 % | – |
| `str_t3_mex` | – | – (–) | – | 1,556 (1,522) | +2,2 % | – |
| `str_t1_pgen` | – | – (–) | – | 8,267 (8) | +3,3 % | – |
| `str_t2_pgen` | – | – (–) | – | 2,167 (2,083) | +4 % | – |
| `str_t3_pgen` | – | – (–) | – | 2,812 (2,778) | +1,2 % | – |
| `str_t1_hydro` | – | – (–) | – | 11,25 (11,25) | ±0 % | – |
| `str_t1_mstore` | – | – (–) | – | 4,25 (4) | +6,2 % | – |
| `str_t1_estore` | – | – (–) | – | 2,08 (2) | +4 % | – |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `str_t1_mex` | STRUCTURE ECONOMIC MASSEXTRACTION TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | BP 10 · +2 M/s · −2 E/s<br>upgradesTo `core:str_t2_mex`<br>Adjacency: Gibt Fabriken −7,5 % Mass-Verbrauch (8×8); erhält +12,5 % je angrenzendem Erzspeicher.<br>Nur auf Mass-Spots; produziert während des Upgrades weiter (B4). | Ring um den Spot, zentraler glühender Pumpenkopf (Pumpentakt-Animation), niedrig.<br>hull(sockel), ring(kranz) [team], stack(pumpenkopf) ⟳tilt [glow] — 3 Parts, 1 anim., ≈ 100 Tris · Maßstab 1 · 1 Streifen (keramik) | E5 in MS4 |
| `str_t2_mex` | STRUCTURE ECONOMIC MASSEXTRACTION TECH2 SIZE4<br>*von:* `ENGINEER & (TECH2 \| TECH3) \| UPGRADE` | BP 15 · +6 M/s · −9 E/s<br>Upgrade von `core:str_t1_mex`<br>upgradesTo `core:str_t3_mex`<br>Adjacency: Fabriken −10 % Mass-Verbrauch; +12,5 % je Erzspeicher.<br>Kosten = Upgrade-Kosten (FA-Semantik). Auch direkt von Geselle/Meister baubar. | Zapfstelle auf 2×2 (Höhe ×1,2) mit Schürzenplatten, 2 Tech-Streifen.<br>hull(sockel), ring(kranz) [team], stack(pumpenkopf) ⟳tilt [glow], hull(schuerze l), hull(schuerze r) — 5 Parts, 1 anim., ≈ 156 Tris · Maßstab xz 1 / y 1,2 · 2 Streifen (keramik) | B4 (T1→T2) in MS8 |
| `str_t3_mex` | STRUCTURE ECONOMIC MASSEXTRACTION TECH3 SIZE4<br>*von:* `ENGINEER & TECH3 \| UPGRADE` | +18 M/s · −54 E/s<br>Upgrade von `core:str_t2_mex`<br>Adjacency: Fabriken −12,5 % Mass-Verbrauch; +12,5 % je Erzspeicher.<br>Upgrade-Kosten. | Zapfstelle auf 2×2 (Höhe ×1,4), doppelter Kranz, 3 Tech-Streifen; kein Heckschlot (unterscheidet sich so von der Dampfquelle).<br>hull(sockel), ring(kranz) [team], ring(zweiter kranz), stack(pumpenkopf) ⟳tilt [glow], hull(schuerze l), hull(schuerze r) — 6 Parts, 1 anim., ≈ 204 Tris · Maßstab xz 1 / y 1,4 · 3 Streifen (keramik) | Rest B4 (T3-Mex) in MS13 |
| `str_t1_pgen` | STRUCTURE ECONOMIC ENERGYPRODUCTION TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | +20 E/s<br>Adjacency: Fabriken (8×8) −1,56 % Energy-Verbrauch, 2×2-Verbraucher −6,25 %; erhält +25 % Produktion je angrenzendem Glutspeicher (SIZE4).<br>Death: `wpn_boiler_burst_t1` 250/r2 (K14, Kettenreaktion-Golden MS10)<br>Frei platzierbar; kein Upgrade (T2/T3 werden neu gebaut, wie FA). | Liegender Kessel mit einem Schlot (Zahl der Schlote = Tech, Schlothöhe ≥ 1,5 × Kessel-Ø), glühende Krone, Ruß-Gradient.<br>hull(sockel), boiler [team], stack(krone) [glow] — 3 Parts, 0 anim., ≈ 100 Tris · Maßstab 1 · 1 Streifen (keramik) | E6 in MS4 |
| `str_t2_pgen` | STRUCTURE ECONOMIC ENERGYPRODUCTION TECH2 SIZE12<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | +500 E/s<br>Adjacency: Fabriken −12,5 % Energy-Verbrauch; erhält +8,3 % Produktion je angrenzendem Glutspeicher (SIZE12).<br>Death: `wpn_boiler_burst_t2` 1.500/r5 (K14) | Kessel auf 6×6 (Maßstab 3,0, Höhe ×1,2) mit 2 Schloten, 2 Tech-Streifen; füllt ≥ 70 % der Footprint-Kante.<br>hull(sockel), boiler [team], stack(krone) [glow], stack(krone) [glow], hull(schuerze) — 5 Parts, 0 anim., ≈ 152 Tris · Maßstab xz 3 / y 3,6 · 2 Streifen (keramik) | E6-Tech-Leiter mit T2-Engineer (MS8); KI-Tech bis T2 in MS9 |
| `str_t3_pgen` | STRUCTURE ECONOMIC ENERGYPRODUCTION TECH3 SIZE16<br>*von:* `ENGINEER & TECH3` | +2.500 E/s<br>Adjacency: Fabriken −15,6 % Energy-Verbrauch; erhält +6,25 % Produktion je angrenzendem Glutspeicher (SIZE16).<br>Death: `wpn_boiler_burst_t3` 5.000/r10 (K14; FA 5500) | Kessel auf 8×8 (Maßstab 4,0, Höhe ×1,4) mit 3 Schloten, 3 Tech-Streifen; füllt ≥ 70 % der Footprint-Kante.<br>hull(sockel), boiler [team], stack [glow], stack [glow], stack [glow], hull(schuerze l), hull(schuerze r) — 7 Parts, 0 anim., ≈ 204 Tris · Maßstab xz 4 / y 5,6 · 3 Streifen (keramik) | T3-Pgen-Nachlieferung in MS13 |
| `str_t1_hydro` | STRUCTURE ECONOMIC ENERGYPRODUCTION HYDROCARBON TECH1 SIZE12<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | +100 E/s<br>Adjacency: Wie Glutkessel II (Fabriken −12,5 % Energy); erhält +8,3 % je angrenzendem Glutspeicher (SIZE12).<br>Nur auf Hydro-Spots; keine Death-Weapon (wie FA). | Ring mit drei stehenden Schloten darin.<br>hull(sockel), ring [team], stack [glow], stack [glow], stack [glow] — 5 Parts, 0 anim., ≈ 148 Tris · Maßstab 1 · 1 Streifen (keramik) | E9 in MS10; als Daten-Vorgriff im MS9-Kern (nur Spot-Regel wie E5) |
| `str_t1_mstore` | STRUCTURE ECONOMIC MASSSTORAGE TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | Speicher 500 M<br>Adjacency: +12,5 % Produktion je angrenzender Zapfstelle (FA-Relation, max. 4 Seiten = +50 %).<br>Keine Death-Weapon. | Niedriger eckiger Stapel (Mass = eckig), kein Schlot.<br>hull(sockel), hull(stapel) [team], hull(stapel) — 3 Parts, 0 anim., ≈ 84 Tris · Maßstab 1 · 1 Streifen (keramik) | E10 in MS10; Daten-Vorgriff im MS9-Kern (E4-Speicherlimit existiert ab MS4) |
| `str_t1_estore` | STRUCTURE ECONOMIC ENERGYSTORAGE TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | Speicher 10.000 E<br>Adjacency: Bufft alle angrenzenden Energieproduzenten (FA-Relation): Glutkessel I +25 % (SIZE4), Glutkessel II und Dampfquelle +8,3 % (SIZE12), Glutkessel III +6,25 % (SIZE16).<br>Death: `wpn_heatbank_burst` 1.000/r5 (K14) | Zwei stehende, flache Trommeln (Ø 0,8 × Kante, Höhe ≤ 0,3 × Kante; Energy = rund), kein liegender Kessel, kein Schlot.<br>hull(sockel), boiler(trommel stehend) [team], boiler(trommel stehend) — 3 Parts, 0 anim., ≈ 124 Tris · Maßstab 1 · 1 Streifen (keramik) | Abstich (U8, MS6) feuert erst ab 7500 E Vorrat (> Grundspeicher 3900 E) ⇒ Daten-Vorgriff ab MS6; E10-Abnahme MS10 |

---

## 10. Fabriken

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `core:str_t1_fac_land` | **Landwerk I** / Land Works I | Landfabrik / Land Factory | T1 Land Factory (`UEB0101`) | MS6 | 240 / 2.100 / 300 | 4.200 | – | 8×8 | 20 | Bau: A | `struct_fac_land_t1` |
| ● | `core:str_t2_fac_land` | **Landwerk II** / Land Works II | Landfabrik / Land Factory | T2 Land Factory HQ (Upgrade-Kosten) (`UEB0201`) | MS8 | 1.400 / 11.000 / 2.300 | 8.200 | – | 8×8 | 20 | Bau: Upgrade (Command Card) | `struct_fac_land_t2` |
| ○ | `core:str_t3_fac_land` | **Landwerk III** / Land Works III | Landfabrik / Land Factory | T3 Land Factory HQ (Upgrade-Kosten) (`UEB0301`) | MS13 | 5.200 / 47.000 / 12.000 | 16.000 | – | 8×8 | 20 | Bau: Upgrade (Command Card) | `struct_fac_land_t3` |
| ○ | `core:str_t1_fac_air` | **Luftwerk I** / Air Works I | Luftfabrik / Air Factory | T1 Air Factory (`UEB0102`) | MS12 | 210 / 2.400 / 300 | 4.200 | – | 8×8 | 20 | Bau: S | `struct_fac_air_t1` |
| ○ | `core:str_t2_fac_air` | **Luftwerk II** / Air Works II | Luftfabrik / Air Factory | T2 Air Factory HQ (Upgrade-Kosten) (`UEB0202`) | MS12 | 920 / 17.500 / 2.300 | 8.200 | – | 8×8 | 20 | Bau: Upgrade (Command Card) | `struct_fac_air_t2` |

**Waffen und Balance** (Δ gegenüber FA-Referenz)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `str_t1_fac_land` | – | – (–) | – | 17,5 (16,667) | +5 % | – |
| `str_t2_fac_land` | – | – (–) | – | 5,857 (5,674) | +3,2 % | – |
| `str_t3_fac_land` | – | – (–) | – | 3,077 (3,065) | +0,4 % | – |
| `str_t1_fac_air` | – | – (–) | – | 20 (19,048) | +5 % | – |
| `str_t2_fac_air` | – | – (–) | – | 8,913 (8,696) | +2,5 % | – |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `str_t1_fac_land` | STRUCTURE FACTORY LAND TECH1 SIZE16<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | BP 20 · Speicher 80 M<br>upgradesTo `core:str_t2_fac_land`<br>Adjacency: Empfängt Adjacency von Zapfstellen (Mass) und Kraftwerken (Energy).<br>Queue/Repeat/Rally (B3). Upgrade-Verb „Freisprechen“. | U-Portal mit Rampe (offene Seite = Ausgang), glühendes Werkhallentor.<br>hull(sockel), hull(wand l) [team], hull(wand r) [team], hull(dach) [team], hull(rampe), hull(werkhallentor) ⟳tilt [glow] — 6 Parts, 1 anim., ≈ 168 Tris · Maßstab 1 · 1 Streifen (keramik) | B3 in MS6 |
| `str_t2_fac_land` | STRUCTURE FACTORY LAND TECH2 SIZE16<br>*von:* `UPGRADE` | BP 40 · Speicher 160 M<br>Upgrade von `core:str_t1_fac_land`<br>upgradesTo `core:str_t3_fac_land`<br>Adjacency: Empfängt Adjacency von Zapfstellen (Mass) und Kraftwerken (Energy).<br>Nur per Upgrade (kein HQ/Support-System, B9 Post-MVP). | Landwerk ×1,3 mit Schlot, 2 Tech-Streifen.<br>hull(sockel), hull(wand l) [team], hull(wand r) [team], hull(dach) [team], hull(rampe), hull(werkhallentor) ⟳tilt [glow], stack(schlot) — 7 Parts, 1 anim., ≈ 192 Tris · Maßstab xz 1 / y 1,2 · 2 Streifen (keramik) | U5 in MS8 |
| `str_t3_fac_land` | STRUCTURE FACTORY LAND TECH3 SIZE16<br>*von:* `UPGRADE` | BP 90 · Speicher 320 M<br>Upgrade von `core:str_t2_fac_land`<br>Adjacency: Empfängt Adjacency von Zapfstellen (Mass) und Kraftwerken (Energy).<br>Nur per Upgrade. | Landwerk ×1,7 mit zwei Schloten und Schürze, 3 Tech-Streifen (9 Parts = Struktur-Maximum).<br>hull(sockel), hull(wand l) [team], hull(wand r) [team], hull(dach) [team], hull(rampe), hull(werkhallentor) ⟳tilt [glow], stack, stack, hull(schuerze) — 9 Parts, 1 anim., ≈ 244 Tris · Maßstab xz 1 / y 1,4 · 3 Streifen (keramik) | U5 T3 / U10 in MS13 |
| `str_t1_fac_air` | STRUCTURE FACTORY AIR TECH1 SIZE16<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | BP 20 · Speicher 80 M<br>upgradesTo `core:str_t2_fac_air`<br>Adjacency: Empfängt Adjacency von Zapfstellen (Mass) und Kraftwerken (Energy).<br>Baut keine Engineers (wie FA). | U-Portal mit Landescheibe statt Rampe.<br>hull(sockel), hull(wand l) [team], hull(wand r) [team], hull(dach) [team], ring(landescheibe), hull(werkhallentor) ⟳tilt [glow] — 6 Parts, 1 anim., ≈ 188 Tris · Maßstab 1 · 1 Streifen (keramik) | Luftfabrik T1→T2 in MS12 |
| `str_t2_fac_air` | STRUCTURE FACTORY AIR TECH2 SIZE16<br>*von:* `UPGRADE` | BP 40 · Speicher 160 M<br>Upgrade von `core:str_t1_fac_air`<br>Adjacency: Empfängt Adjacency von Zapfstellen (Mass) und Kraftwerken (Energy).<br>Nur per Upgrade; kein T3-Luftwerk (U12 Post-MVP). | Luftwerk ×1,3 mit Schlot, 2 Tech-Streifen.<br>hull(sockel), hull(wand l) [team], hull(wand r) [team], hull(dach) [team], ring(landescheibe), hull(werkhallentor) ⟳tilt [glow], stack(schlot) — 7 Parts, 1 anim., ≈ 212 Tris · Maßstab xz 1 / y 1,2 · 2 Streifen (keramik) | MS12 |

---

## 11. Verteidigung

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `core:str_t1_pd` | **Riegel I** / Bolt I | Punktverteidigung / Point Defense | T1 Point Defense (`UEB2101`) | MS8 | 240 / 2.000 / 250 | 1.350 | – | 1×1 | 24 | Bau: Z | `struct_direct_t1` |
| ● | `core:str_t2_pd` | **Riegel II** / Bolt II | Punktverteidigung / Point Defense | T2 Point Defense (`UEB2301`) | MS8 | 520 / 3.700 / 700 | 2.400 | – | 2×2 | 28 | Bau: Z | `struct_direct_t2` |
| ● | `core:str_t1_aa` | **Rost I** / Grate I | Flugabwehrturm / AA Tower | T1 Anti-Air Turret (`UEB2104`) | MS8 | 150 / 1.500 / 190 | 820 | – | 1×1 | 24 | Bau: X | `struct_aa_t1` |
| ● | `core:str_t2_aa` | **Rost II** / Grate II | Flakturm / Flak Tower | T2 Anti-Air Flak Artillery (`UEB2204`) | MS8 | 400 / 4.000 / 550 | 2.600 | – | 2×2 | 24 | Bau: X | `struct_aa_t2` |
| ● | `core:str_t3_sam` | **Hochrost** / High Grate | Raketenabwehr / SAM Site | T3 Anti-Air SAM Launcher (`UEB2304`) | MS8 | 800 / 8.000 / 1.400 | 5.000 | – | 2×2 | 28 | Bau: X | `struct_sam_t3` |
| ● | `core:str_t1_wall` | **Mauer** / Wall | Mauer / Wall | Wall Section (`UEB5101`) | MS8 | 3 / 20 / 15 | 550 | – | 1×1 | 0 | Bau: C | `wall` |

**Waffen und Balance** (Δ gegenüber FA-Referenz)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `str_t1_pd` | `wpn_bolt_cannon_t1` Glockenkanone (Turm): 50 / 0,3 s = **166,7 DPS**, RW 26, linear | 0,695 (0,667) | +4,2 % | 5,625 (5,2) | +8,2 % | +12,7 % |
| `str_t2_pd` | `wpn_bolt_cannon_t2` Doppel-Glockenkanone (Turm): 2×100 / 1,6 s = **125 DPS**, RW 48, linear, Splash 1,5 | 0,24 (0,243) | −1,1 % | 4,615 (4,167) | +10,8 % | +9,6 % |
| `str_t1_aa` | `wpn_grate_aa_t1` Zwillings-Flugabwehr: 2×20 / 0,6 s = **66,7 DPS**, RW 42, linear (Vorhalt) [Luft] | 0,445 (0,438) | +1,5 % | 5,467 (5,333) | +2,5 % | +4 % |
| `str_t2_aa` | `wpn_grate_flak_t2` Splitterflak (Turm): 90 / 0,5 s = **180 DPS**, RW 48, linear + Näherungszünder (MS12), Splash 3,5 [Luft] | 0,45 (0,446) | +0,8 % | 6,5 (6,475) | +0,4 % | +1,2 % |
| `str_t3_sam` | `wpn_high_grate_sam_t3` Glutraketen-Flugabwehr: 6×200 / 3,5 s = **342,9 DPS**, RW 58, homing + Näherungszünder, Splash 1,5 [Luft] | 0,429 (0,429) | ±0 % | 6,25 (6,25) | ±0 % | ±0 % |
| `str_t1_wall` | – | – (–) | – | 183,333 (166,667) | +10 % | – |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `str_t1_pd` | STRUCTURE DEFENSE DIRECTFIRE TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | Dieselbe Glocke wie der Panzer, auf Sockel. | Gefaster Gusssockel, Glocke mit waagerechtem Rohr.<br>hull(sockel), bell ⟳yaw [team], barrel ⟳pitch — 3 Parts, 2 anim., ≈ 108 Tris · Maßstab 1 · 1 Streifen (keramik) | B5 in MS8; Minimal-A8 der KI in MS9 |
| `str_t2_pd` | STRUCTURE DEFENSE DIRECTFIRE TECH2 SIZE4<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | Kein Upgrade von Riegel I (wie FA; B8 generisch ist Post-MVP). | Riegel ×1,3, breitere Glocke, zwei Rohre, 2 Tech-Streifen.<br>hull(sockel), bell ⟳yaw [team], barrel, barrel, hull(schuerze) — 5 Parts, 1 anim., ≈ 160 Tris · Maßstab xz 2 / y 2,4 · 2 Streifen (keramik) | B5 (T2) in MS8 |
| `str_t1_aa` | STRUCTURE DEFENSE ANTIAIR TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | Nur Luftziele. | Sockel mit Rost-Platte und 2 senkrechten Rohren.<br>hull(sockel), grate ⟳yaw [team], barrel, barrel — 4 Parts, 1 anim., ≈ 88 Tris · Maßstab 1 · 1 Streifen (keramik) | B5 in MS8, Wirkung MS12 |
| `str_t2_aa` | STRUCTURE DEFENSE ANTIAIR TECH2 SIZE4<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | Nur Luftziele. | Rost ×1,3 mit 3 Rohren, 2 Tech-Streifen.<br>hull(sockel), grate ⟳yaw [team], barrel, barrel, barrel, hull(schuerze) — 6 Parts, 1 anim., ≈ 140 Tris · Maßstab xz 2 / y 2,4 · 2 Streifen (keramik) | B5 (T2) in MS8, Näherungszünder MS12 |
| `str_t3_sam` | STRUCTURE DEFENSE ANTIAIR TECH3 SIZE4<br>*von:* `ENGINEER & TECH3` | Nur Luftziele. | Rost auf 2×2 mit doppelt so vielen, dickeren Rohren (4), 3 Tech-Streifen; kein Schlot (Glut-Monopol).<br>hull(sockel), grate ⟳yaw [team], barrel, barrel, barrel, barrel — 6 Parts, 1 anim., ≈ 136 Tris · Maßstab xz 2 / y 2,8 · 3 Streifen (keramik) | MS8 per Konsole/Test-Szenario gespawnt (B5: homing, K11), baubar ab MS13 (Meister) |
| `str_t1_wall` | STRUCTURE DEFENSE WALL TECH1<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | wall-Flag (Drag-Linie), blockiert Schüsse und Pathing. | Niedriger Quader, nur die Oberkante teamfarben (≈ 10 %).<br>hull(oberkante) [team] — 1 Parts, 0 anim., ≈ 28 Tris · Maßstab 1 · keine Streifen | B5/Minimal-Drag (DECISIONS 3) in MS8 |

---

## 12. Intel und Schilde

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ○ | `core:str_t1_radar` | **Horcher I** / Listener I | Radar / Radar | T1 Radar System (`UEB3101`) | MS10 | 80 / 720 / 80 | 11 | – | 2×2 | 20 / R 116 | Bau: D | `struct_intel_t1` |
| ○ | `core:str_t2_radar` | **Horcher II** / Listener II | Radar / Radar | T2 Radar System (Upgrade-Kosten) (`UEB3201`) | MS10 | 180 / 3.600 / 780 | 55 | – | 2×2 | 24 / R 200 | Bau: Upgrade (Command Card) | `struct_intel_t2` |
| ○ | `core:str_t3_radar` | **Horcher III** / Listener III | Radar / Radar | T3 Omni Sensor Array (Upgrade-Kosten; hier ohne Omni) (`UEB3104`) | MS13 | 1.200 / 16.000 / 1.500 | 55 | – | 2×2 | 30 / R 350 | Bau: Upgrade (Command Card) | `struct_intel_t3` |
| ○ | `core:str_t2_shield` | **Schirm II** / Canopy II | Schildgenerator / Shield Generator | T2 Shield Generator (`UEB4202`) | MS13 | 600 / 6.000 / 1.150 | 280 | – | 6×6 | 20 | Bau: F | `struct_shield_t2` |
| ○ | `core:str_t3_shield` | **Schirm III** / Canopy III | Schildgenerator / Shield Generator | T3 Heavy Shield Generator (Upgrade-Kosten) (`UEB4301`) | MS13 | 3.200 / 52.000 / 5.000 | 520 | – | 6×6 | 20 | Bau: Upgrade (Command Card) | `struct_shield_t3` |

**Waffen und Balance** (Δ gegenüber FA-Referenz)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `str_t1_radar` | – | – (–) | – | 0,138 (0,125) | +10 % | – |
| `str_t2_radar` | – | – (–) | – | 0,306 (0,278) | +10 % | – |
| `str_t3_radar` | – | – (–) | – | 0,046 (0,042) | +10 % | – |
| `str_t2_shield` | – | – (–) | – | 15,467 (15,417) (inkl. Schild) | +0,3 % | – |
| `str_t3_shield` | – | – (–) | – | 5,475 (5,303) (inkl. Schild) | +3,2 % | – |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `str_t1_radar` | STRUCTURE INTELLIGENCE RADAR TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | BP 13 · −20 E/s<br>upgradesTo `core:str_t2_radar`<br>Toggles: radar (MS10, C17)<br>Stall schaltet ab (E3), Wiedereinschalten mit Hysterese. Sehr fragil (FA-Relation). | Hoher dünner Mast mit rechteckiger Radarplatte (wing-Prisma 1,6 × 0,8 × 0,1 WU, 35° gekippt), rotierend; kein Ring (Ring = Flow/Schild).<br>hull(sockel), mast, wing(radarplatte) ⟳yaw [team] — 3 Parts, 1 anim., ≈ 64 Tris · Maßstab 1 · 1 Streifen (keramik) | I3 in MS10 |
| `str_t2_radar` | STRUCTURE INTELLIGENCE RADAR TECH2 SIZE4<br>*von:* `UPGRADE` | BP 20 · −150 E/s<br>Upgrade von `core:str_t1_radar`<br>upgradesTo `core:str_t3_radar`<br>Toggles: radar (MS10, C17)<br>Nur per Upgrade. | Horcher auf 2×2 (Höhe ×1,2) mit Doppelmast, 2 Tech-Streifen.<br>hull(sockel), mast, mast, wing(radarplatte) ⟳yaw [team] — 4 Parts, 1 anim., ≈ 88 Tris · Maßstab xz 1 / y 1,2 · 2 Streifen (keramik) | I3 T1→T2 in MS10 |
| `str_t3_radar` | STRUCTURE INTELLIGENCE RADAR TECH3 SIZE4<br>*von:* `UPGRADE` | −400 E/s<br>Upgrade von `core:str_t2_radar`<br>Toggles: radar (MS10, C17)<br>Kein Omni (I4/I5 Post-MVP) ⇒ Kosten und Reichweite gegenüber FA halbiert, HP/Mass in Relation. Unterhalt 400 E/s (FA 2.000 mit Omni): r350 bringt auf 256–512-WU-Karten nur begrenzt mehr als Horcher II. | Horcher auf 2×2 (Höhe ×1,4) mit zweiter Radarplatte, 3 Tech-Streifen; kein Schlot (Glut-Monopol).<br>hull(sockel), mast, mast, wing(radarplatte) ⟳yaw [team], wing(zweite platte) — 5 Parts, 1 anim., ≈ 100 Tris · Maßstab xz 1 / y 1,4 · 3 Streifen (keramik) | Rest I3 (T3-Radar) in MS13 |
| `str_t2_shield` | STRUCTURE SHIELD DEFENSE TECH2 SIZE12<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | BP 20<br>upgradesTo `core:str_t3_shield`<br>Toggles: shield (MS13, C17)<br>Schild 9.000 HP, r 24, Regen 110/s ab 3 s nach dem letzten Treffer, Neuaufbau 25 s, 200 E/s<br>Kollaps + Wiederaufbau nach rechargeS; Stall schaltet ab. Vergleich über HP+Schild. | Mast mit waagerechtem Ring (Ø ≥ 0,8 × Footprint-Kante), Generator-Kessel am Fuß.<br>hull(sockel), boiler, mast, ring(waagerecht) ⟳yaw [team] — 4 Parts, 1 anim., ≈ 148 Tris · Maßstab 1 · 2 Streifen (keramik) | K10 in MS13 |
| `str_t3_shield` | STRUCTURE SHIELD DEFENSE TECH3 SIZE12<br>*von:* `UPGRADE` | Upgrade von `core:str_t2_shield`<br>Toggles: shield (MS13, C17)<br>Schild 17.000 HP, r 40, Regen 130/s ab 1 s nach dem letzten Treffer, Neuaufbau 25 s, 400 E/s<br>Nur per Upgrade. | Schirm auf 6×6 (Höhe ×1,4/1,2) mit zweitem Ring und Schürze, 3 Tech-Streifen; kein Schlot (Glut-Monopol).<br>hull(sockel), boiler, mast, ring(waagerecht) ⟳yaw [team], ring(zweiter ring), hull(schuerze) — 6 Parts, 1 anim., ≈ 224 Tris · Maßstab xz 1 / y 1,17 · 3 Streifen (keramik) | K10 in MS13 |

---

## 13. Artilleriestellungen

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ○ | `core:str_t2_arty` | **Tiegel** / Crucible | Artilleriestellung / Artillery Emplacement | T2 Artillery Installation (`UEB2303`) | MS13 | 1.800 / 13.000 / 1.600 | 3.600 | – | 2×2 | 28 | Bau: V | `struct_arty_t2` |
| ○ | `core:str_t3_arty` | **Hochofen** / Blast Furnace | Schwere Artilleriestellung / Heavy Artillery Emplacement | T3 Heavy Artillery Installation (auf MVP-Kartengröße skaliert) (`UEB2302`) | MS13 | 48.000 / 900.000 / 76.700 | 10.000 | – | 8×8 | 28 | Bau: V | `struct_arty_t3` |

**Waffen und Balance** (Δ gegenüber FA-Referenz)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `str_t2_arty` | `wpn_crucible_shell_t2` Tiegelgranate: 2.100 / 21 s = **100 DPS**, RW 50–110, ballistisch, Splash 3<br>Pulk-DPS/Mass 0,534 (FA 0,506): +5,6 % | 0,056 (0,053) | +5,6 % | 2 (1,895) | +5,6 % | +11,4 % |
| `str_t3_arty` | `wpn_furnace_shell_t3` Hochofengranate: 5.500 / 15 s = **366,7 DPS**, RW 60–200, ballistisch, Splash 6<br>Pulk-DPS/Mass 0,254 (FA 0,254): ±0 % | 0,008 (0,008) | ±0 % | 0,208 (0,208) | ±0 % | ±0 % |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `str_t2_arty` | STRUCTURE DEFENSE INDIRECTFIRE ARTILLERY TECH2 SIZE4<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | Artillerie-Adjacency (Kraftwerke erhöhen Feuerrate, FA-Relation) optional mit E11. | Große Kelle (Tiegel) auf Schwenkarm über Sockel, Gegengewicht.<br>hull(sockel), boom ⟳yaw, ladle(tiegel) ⟳pitch [team], hull(gegengewicht) — 4 Parts, 2 anim., ≈ 128 Tris · Maßstab 1 · 2 Streifen (keramik) | K13 in MS13 |
| `str_t3_arty` | STRUCTURE DEFENSE INDIRECTFIRE ARTILLERY TECH3 SIZE16<br>*von:* `ENGINEER & TECH3` | FA-Referenz: Reichweite 825, 72.000 Mass, 5.500 Schaden alle 10 s. Hier Reichweite 200 (Gate ≤ 40 % der kleinsten Kartendiagonale ⇒ Kartenpool ≥ 354 WU), Kosten ≈ 67 %, gleicher Einzelschuss (Burst gegen Schilde: Schirm III fällt nach 5 Schüssen/60 s), Feuerrate ×2/3; DPS/Mass und HP/Mass bleiben in Relation. | Tiegel-Silhouette auf 8×8: Lafette, Kelle Ø 3,0 WU (Team), Steilrohr 7 WU × Ø 0,6 aus der Kelle (an die Kelle geparentet), Gegengewicht; kein Schlot, 3 Tech-Streifen.<br>hull(sockel), boom(lafette) ⟳yaw, ladle(kelle) ⟳pitch [team], barrel(steilrohr), hull(gegengewicht) — 5 Parts, 2 anim., ≈ 152 Tris · Maßstab xz 4 / y 4,67 · 3 Streifen (keramik) | K13 + Reichweiten-Gate in MS13 |

---

## 14. Balance-Übersicht und Gates

- **DPS/Mass:** 25 bewaffnete Einträge, größte Abweichung −7,8 % (Kelle), Mittelwert −0,8 %.
- **HP/Mass:** 50 Einträge, größte Abweichung +14,3 % (Lerche), Mittelwert +4,1 %.
- **Produkt DPS/Mass × HP/Mass:** größte Abweichung +12,7 % (Riegel I), Mittelwert +2,5 %. Gate ±15 %.
- **Bewusste globale Verschiebung:** HP/Mass liegt im Mittel bei +4,1 %, DPS/Mass bei −0,8 %. Jede Tötungszeit verlängert sich dadurch im Mittel um ≈ 4,9 %. Das ist gewollt (etwas längere Gefechte, mehr Zeit zum Mikro) und bleibt klein genug, dass die Rolle-gegen-Rolle-Relationen und Breakpoints (Tabelle unten) unverändert bleiben.
- **Fraktions-Signatur (bewusst, klein):** Stellungen etwas zäher (Riegel, Mauer, Radar +8–11 % HP/Mass), T2-Panzer und -Flak leicht zäher bei gleicher Feuerkraft, Artillerie mit etwas größerem Splash bei langsamerem Takt (Kelle 1,1 statt 1 bei 9,0 statt 8,3 s; Pfanne 4,4 statt 4). Die Breakpoints der T1-Linie (Vogt, Riegel I, Meißel gegen Punze und Stichel) sind exakt FA.
- **Maßstabs-Sonderfall Hochofen:** FA-Reichweite 825 WU ist auf 256–512-WU-Karten nicht spielbar. Reichweite 200, gleicher Einzelschuss wie FA (5.500, Splash 6) für den Schild-Burst, Feuerrate ×⅔, Kosten ≈ 67 %; DPS/Mass und HP/Mass ±0. Das Compiler-Gate (≤ 40 % der kleinsten Kartendiagonale) verlangt Karten ≥ 354 WU (§18).
- **Relationen, die das Balancing im Blick behalten muss:** LAB-DPS/Mass ≈ 1,75× Panzer (Raider), Flak ≈ 3× T2-Panzer DPS/Mass gegen Luft, Radar extrem fragil (FA 10 HP), Mauer 183 HP/Mass.

**Pulk-DPS/Mass (Artillerie, Gate ±15 %)**

| Einheit | Schaden × Salve / Nachladezeit | Splash (FA) | Pulk-DPS/Mass (FA) | Δ Pulk | Δ Einzelziel |
|---|---|---|---|---|---|
| Kelle | 100 / 9 s | 1,1 (1) | 0,621 (0,591) | +4,9 % | −7,8 % |
| Rinne | 2×300 / 10 s | 1 (1) | 0,589 (0,589) | ±0 % | ±0 % |
| Pfanne | 700 / 10 s | 4,4 (4) | 1,65 (1,491) | +10,7 % | −6,7 % |
| Tiegel | 2.100 / 21 s | 3 (3) | 0,534 (0,506) | +5,6 % | +5,6 % |
| Hochofen | 5.500 / 15 s | 6 (6) | 0,254 (0,254) | ±0 % | ±0 % |

**Treffer-bis-Tod-Matrix (Pflicht: exakt FA)**

| Angreifer → Ziel | Salvenschaden / Ziel-HP | Salven (Zeit) | FA: Salvenschaden / Ziel-HP | FA: Salven (Zeit) | ✓ |
|---|---|---|---|---|---|
| Vogt → Stichel | 100 / 60 | 1 (0 s) | 100 / 60 | 1 (0 s) | ✓ |
| Vogt → Punze | 100 / 300 | 3 (2 s) | 100 / 300 | 3 (2 s) | ✓ |
| Vogt → Kelle | 100 / 210 | 3 (2 s) | 100 / 205 | 3 (2 s) | ✓ |
| Vogt → Sieb | 100 / 310 | 4 (3 s) | 100 / 310 | 4 (3 s) | ✓ |
| Vogt → Lehrling | 100 / 160 | 2 (1 s) | 100 / 150 | 2 (1 s) | ✓ |
| Vogt → Funke | 100 / 32 | 1 (0 s) | 100 / 29 | 1 (0 s) | ✓ |
| Riegel I → Punze | 50 / 300 | 6 (1,5 s) | 50 / 300 | 6 (1,5 s) | ✓ |
| Riegel I → Stichel | 50 / 60 | 2 (0,3 s) | 50 / 60 | 2 (0,3 s) | ✓ |
| Kelle → Stichel | 100 / 60 | 1 (0 s) | 100 / 60 | 1 (0 s) | ✓ |
| Kelle → Lehrling | 100 / 160 | 2 (9 s) | 100 / 150 | 2 (8,3 s) | ✓ |
| Kelle → Punze | 100 / 300 | 3 (18 s) | 100 / 300 | 3 (16,6 s) | ✓ |
| Meißel → Stichel | 70 / 60 | 1 (0 s) | 70 / 60 | 1 (0 s) | ✓ |
| Meißel → Punze | 70 / 300 | 5 (5,2 s) | 70 / 300 | 5 (5,2 s) | ✓ |
| Rinne → Riegel II | 600 / 2.400 | 4 (30 s) | 600 / 2.250 | 4 (30 s) | ✓ |
| Tiegel → Zapfstelle II | 2.100 / 2.100 | 1 (0 s) | 2.000 / 2.000 | 1 (0 s) | ✓ |
| Tiegel → Riegel I | 2.100 / 1.350 | 1 (0 s) | 2.000 / 1.300 | 1 (0 s) | ✓ |
| Tiegel → Glutkessel II | 2.100 / 2.600 | 2 (21 s) | 2.000 / 2.500 | 2 (20 s) | ✓ |
| Rost I → Lerche | 40 / 40 | 1 (0 s) | 46 / 35 | 1 (0 s) | ✓ |
| Hochrost → Krähe | 1.200 / 760 | 1 (0 s) | 1.200 / 700 | 1 (0 s) | ✓ |
| Hochrost → Elster | 1.200 / 1.150 | 1 (0 s) | 1.200 / 1.200 | 1 (0 s) | ✓ |

Rush-Simulation (Review-Skript, Panzer gegen Vogt, Regen 10 HP/s): FA braucht 19 T1-Panzer ohne und 22 mit Overcharge (13,9k E Start, +120 E/s); das Roster jetzt ebenfalls 19 / 22 (vorher 16 / 19).

**Schildbrechen (Info, ein einzelner Schütze, mit Regenerations-Verzögerung `regenStartS`)**

| Angreifer → Schild | Schüsse (Zeit) | FA-Waffe gegen FA-Schild-HP |
|---|---|---|
| Tiegel → Schirm II | 59 (1.218 s) | 55 (1.080 s) |
| Hochofen → Schirm II | 2 (15 s) | 2 (10 s) |
| Hochofen → Schirm III | 5 (60 s) | 4 (30 s) |
| Pfanne → Schirm II | bricht allein nicht | bricht allein nicht |

---

## 15. Ökonomie-Kennzahlen (Kurzreferenz)

Beim Mex-Upgrade ersetzt die neue Stufe die alte Produktion. Amortisation = Upgrade-Mass / Mehrproduktion; die zweite Zahl rechnet den Energy-Mehrbedarf als anteiligen Glutkessel I ein (20 E/s ≙ 75 Mass).

| Gebäude | Ertrag | Unterhalt | Amortisation (Mass) | inkl. E-Mehrbedarf | Upgrade zur nächsten Stufe | Adjacency (FA-Relation) |
|---|---|---|---|---|---|---|
| Zapfstelle I | 2 M/s | −2 E/s | 18 s | ≈ 22 s (+2 E/s) | Zapfstelle II: 900 / BP 10 = 90 s | Gibt Fabriken −7,5 % Mass-Verbrauch (8×8); erhält +12,5 % je angrenzendem Erzspeicher. |
| Zapfstelle II | 6 M/s | −9 E/s | 225 s (Δ 4 M/s) | ≈ 232 s (+7 E/s) | Zapfstelle III: 2.900 / BP 15 = 193 s | Fabriken −10 % Mass-Verbrauch; +12,5 % je Erzspeicher. |
| Zapfstelle III | 18 M/s | −54 E/s | 375 s (Δ 12 M/s) | ≈ 389 s (+45 E/s) | – | Fabriken −12,5 % Mass-Verbrauch; +12,5 % je Erzspeicher. |
| Glutkessel I | 20 E/s | – | – | – | – | Fabriken (8×8) −1,56 % Energy-Verbrauch, 2×2-Verbraucher −6,25 %; erhält +25 % Produktion je angrenzendem Glutspeicher (SIZE4). |
| Glutkessel II | 500 E/s | – | – | – | – | Fabriken −12,5 % Energy-Verbrauch; erhält +8,3 % Produktion je angrenzendem Glutspeicher (SIZE12). |
| Glutkessel III | 2.500 E/s | – | – | – | – | Fabriken −15,6 % Energy-Verbrauch; erhält +6,25 % Produktion je angrenzendem Glutspeicher (SIZE16). |
| Dampfquelle | 100 E/s | – | – | – | – | Wie Glutkessel II (Fabriken −12,5 % Energy); erhält +8,3 % je angrenzendem Glutspeicher (SIZE12). |
| Erzspeicher | +500 M Speicher | – | – | – | – | +12,5 % Produktion je angrenzender Zapfstelle (FA-Relation, max. 4 Seiten = +50 %). |
| Glutspeicher | +10.000 E Speicher | – | – | – | – | Bufft alle angrenzenden Energieproduzenten (FA-Relation): Glutkessel I +25 % (SIZE4), Glutkessel II und Dampfquelle +8,3 % (SIZE12), Glutkessel III +6,25 % (SIZE16). |

Weitere Upgrade-Dauern (buildTime der Zielstufe / buildPower der Vorstufe): Landwerk I → Landwerk II 115 s; Landwerk II → Landwerk III 300 s; Luftwerk I → Luftwerk II 115 s; Horcher I → Horcher II 60 s; Horcher II → Horcher III 75 s; Schirm II → Schirm III 250 s.

Vogt: +1 M/s, +20 E/s, Grundspeicher 650 M / 3.900 E, Build Power 10. Adjacency-Größenklassen nach FA: 2×2 = SIZE4, 6×6 = SIZE12, 8×8 = SIZE16; der Bonus hängt von der Größe des *empfangenden* Gebäudes ab (Glutspeicher: 0,25 / 0,125 / 0,0833 / 0,0625 / 0,05 für SIZE4/8/12/16/20).

---

## 16. Silhouetten-Pflichtpaare, Visuals, Glyphen

**Pflichtpaare MS9 (nur ●, 5 von 5 Testern müssen unterscheiden):** Punze ↔ Sieb, Kelle ↔ Sieb, Rinne ↔ Rüttelsieb, Meißel ↔ Rinne, Lehrling ↔ Funke, Riegel I ↔ Rost I, Zapfstelle I ↔ Glutkessel I, Glutkessel I ↔ Glutspeicher, Erzspeicher ↔ Glutspeicher.

**Pflichtpaare MS14:** Dohle ↔ Turmfalke, Turmfalke ↔ Elster, Lerche ↔ Dohle, Horcher I ↔ Schirm II, Funke ↔ Schürze, Hochofen ↔ Glutkessel III, Zapfstelle III ↔ Dampfquelle.

**Visuals:** Ein Visual ist ein Superset-Mesh pro Rolle. Jeder Vertex trägt eine Tech-Bitmaske (T1/T2/T3); der Vertex-Shader kollabiert Parts, die für die Tech der Instanz nicht gelten. So bleibt es bei einem Draw pro (Visual, LOD), ohne PartStream-Slots für ausgeblendete Parts. Vereinigung nach (Part, Material):

| Visual | Mitglieder | Superset-Parts | ≈ Tris |
|---|---|---|---|
| `v_cmd` | Vogt | 7 | 256 |
| `v_eng` | Lehrling, Geselle, Meister | 7 | 220 |
| `v_scout` | Funke | 3 | 76 |
| `v_bot` | Stichel, Zange, Fallhammer | 8 | 304 |
| `v_tank` | Punze, Meißel | 8 | 236 |
| `v_arty` | Kelle, Pfanne | 5 | 152 |
| `v_aa` | Sieb, Rüttelsieb, Trommelsieb | 8 | 188 |
| `v_mml` | Rinne | 5 | 152 |
| `v_shield_mobile` | Schürze | 4 | 124 |
| `v_sniper` | Reißnadel | 4 | 168 |
| `v_air_scout` | Lerche | 3 | 52 |
| `v_fighter` | Turmfalke | 3 | 52 |
| `v_bomber` | Dohle | 3 | 88 |
| `v_gunship` | Krähe | 4 | 164 |
| `v_fbomber` | Elster | 5 | 148 |
| `v_mex` | Zapfstelle I, Zapfstelle II, Zapfstelle III | 6 | 204 |
| `v_pgen` | Glutkessel I, Glutkessel II, Glutkessel III | 7 | 204 |
| `v_hydro` | Dampfquelle | 5 | 148 |
| `v_mstore` | Erzspeicher | 3 | 84 |
| `v_estore` | Glutspeicher | 3 | 124 |
| `v_fac_land` | Landwerk I, Landwerk II, Landwerk III | 9 | 244 |
| `v_fac_air` | Luftwerk I, Luftwerk II | 7 | 212 |
| `v_pd` | Riegel I, Riegel II | 5 | 160 |
| `v_aa_struct` | Rost I, Rost II, Hochrost | 7 | 164 |
| `v_wall` | Mauer | 1 | 28 |
| `v_radar` | Horcher I, Horcher II, Horcher III | 5 | 100 |
| `v_shield` | Schirm II, Schirm III | 6 | 224 |
| `v_arty_struct` | Tiegel, Hochofen | 5 | 152 |

**Icon-Glyphen (19 Tokens):** `aa`, `arty`, `bomb`, `bot`, `build`, `direct`, `energy`, `estore`, `fac_air`, `fac_land`, `fbomb`, `hydro`, `intel`, `mass`, `mml`, `mstore`, `sam`, `shield`, `sniper`. Vogt (`cmd_commander`) und Mauer (`wall`) haben keine Glyphe. Formen und Maße: `faction.md` §6.

---

## 17. Review-Entscheidungen

Zwei Reviews vom 2026-09-29: **Balance** (Breakpoints, Splash, Methodik) und **Lesbarkeit/Vollständigkeit** (Features, Silhouetten, Icons, Namen). ✓ = übernommen, ◐ = teilweise bzw. abgewandelt, ✗ = verworfen.

### 17.1 Balance-Review

| Nr | Punkt | | Entscheidung und Begründung |
|---|---|---|---|
| 1 | Punze HP 330 reißt Breakpoints | ✓ | Punze HP 300, Tempo 3,3, BT 300; Riegel I 50 / 0,3 s. Breakpoints wieder FA (3 Vogt-Treffer, 6 Riegel-I-Treffer, 5 Meißel-Salven), Rush-Simulation nachgerechnet: 19 / 22 Panzer wie FA. |
| 2 | Vogt HP 11.000 | ✓ | HP 12.000 (±0 %). |
| 3 | Meißel 2×32 tötet keinen Stichel | ✓ | 2×35 / 1,3 s: Stichel 1 Salve, Punze 5 Salven. |
| 4 | Hochofen ohne Burst | ✓ | 5.500 / 15 s, Splash 6, 48.000 M, 900.000 E, BT 76.700, HP 10.000; Schirm III fällt nach 5 Schüssen (60 s). Streichen verworfen: K13 (T2/T3-Artillerie) ist MVP, das Reichweiten-Gate bleibt offener Punkt §18. |
| 5 | Schilde ohne Regenerations-Verzögerung | ✓ | `regenStartS` 3 / 3 / 1 für Schürze, Schirm II, Schirm III; Generator-Lint. |
| 6 | Kelle Splash 1,5 + 110 Schaden | ◐ | Mass 36, Energy 180, BT 200 übernommen. Statt 90 / 8,0 s / Splash 1,2 gilt **100 / 9,0 s / Splash 1,1**: 90 Schaden hätte den Breakpoint Kelle → Punze auf 4 statt 3 Treffer verschoben, und Splash 1,2 läge mit Pulk +20 % über dem neuen ±15-%-Gate. Ergebnis: Einzelziel −7,8 %, Pulk +4,9 %, Produkt −5,6 %. |
| 7 | Pfanne und Tiegel: Splash-Inflation | ◐ | Pfanne 700 / 10 s übernommen, **Splash 4,4 statt 4,5** (4,5 ergibt Pulk +15,2 % und reißt das Gate; 4,4 ergibt +10,7 %). Tiegel 2.100 / Splash 3 übernommen, **Nachladezeit 21 statt 22 s**: Mit `regenStartS` 3 regeneriert Schirm II bei 22 s 2.090 HP pro Zyklus, ein Tiegel käme netto nur 10 HP pro Schuss voran (FA 130); bei 21 s sind es 120. DPS/Mass +5,6 %, Produkt +11,4 %. Ein Schuss tötet Zapfstelle II und Riegel I, Glutkessel II braucht zwei. |
| 8 | Rinne 2×280 gegen Riegel II | ✓ | 2×300 / 10 s: 4 Salven wie FA. Zusätzlich **Splash 1,5 → 1,0**: Das neue Pulk-Gate zeigte +78 %. |
| 9 | Eco-Tabelle falsch | ✓ | §15 rechnet mit der Mehrproduktion (225 s bzw. 375 s) und zeigt den Energy-Mehrbedarf separat (≈ 232 s bzw. ≈ 389 s). |
| 10 | `buildPower` bei Upgrade-Gebäuden | ✓ | Zapfstelle I 10, Zapfstelle II 15, Horcher I 13, Horcher II 20, Schirm II 20; Generator-Lint. Upgrade-Dauern in §15. |
| 11 | Luft gegen Flugabwehr | ✓ | Turmfalke 2×25 / 1,0 s (Produkt −5,1 %), Krähe 16 / 0,3 s (Produkt +0,1 %), Rost I 2×20 / 0,6 s (Lerche 1 Salve), Hochrost 6×200 / 3,5 s (Krähe und Elster 1 Salve). |
| 12 | Abstich-Formel unvollständig | ✓ | FAF-Formel in der Waffennotiz des Vogts (Schaden = E/6, Drain = 6 × Schaden, clamp auf max. HP im Umkreis 2,7 WU, 1.250 … 15.000). |
| 13 | Zange RW 26 = Riegel I | ✓ | RW 30, HP 650 (Produkt +6,9 %). |
| 14 | Horcher III 1.000 E/s | ◐ | Unterhalt 400 E/s übernommen. Streichen verworfen: PLAN §5.3 verlangt das T3-Radar als Rest von I3 in MS13. |
| 15 | Glutspeicher-Adjacency zu eng | ✓ | Bufft alle Energieproduzenten: +25 % (SIZE4), +8,3 % (SIZE12: Glutkessel II, Dampfquelle), +6,25 % (SIZE16: Glutkessel III); Werte aus `AdjacencyBuffs.lua` bestätigt. |
| D | Gate erweitern | ✓ | Produkt-Gate ±15 %, Treffer-bis-Tod-Matrix (20 Paare, alle exakt FA), Pulk-DPS/Mass ±15 % für `ARTILLERY`, alles im Generator erzwungen; globale Verschiebung als Entscheidung in §14. Durch die neuen Gates zusätzlich geändert: **Sieb HP 300 → 310** (Vogt-Breakpoint 4 statt 3 Treffer wie FA) und **Riegel I HP 1.400 → 1.350** (Produkt +16,9 % → +12,7 %). |

### 17.2 Lesbarkeits- und Vollständigkeits-Review

| Nr | Punkt | | Entscheidung und Begründung |
|---|---|---|---|
| A1 | SAM für B5 erst ab MS13 baubar | ✓ | Hochrost ist ● (Kern 26); `msNote`: in MS8 per Konsole/Test-Szenario gespawnt, baubar ab MS13. |
| A2 | U6-Stealth nicht dokumentiert | ✓ | §2.1 und `faction.md` §7.4: U6-Stealth entfällt (I5 = Später). |
| A3 | faction.md und roster.md widersprechen sich | ✓ | `faction.md` Kopfzeile, §7.4 und §10.1 angeglichen; `roster.json` ist die einzige Quelle (`sourceOfTruth`). |
| A4 | Visual-Zahl unklar | ◐ | Superset-Mesh pro Rolle übernommen, aber mit **Tech-Bitmaske pro Vertex** statt Skalierung einzelner Parts pro Instanz (braucht keine PartStream-Slots). Generator prüft Superset ≤ 8 Parts mobil / ≤ 9 Strukturen und ≤ 350 Tris: 28 Visuals (Hochofen teilt jetzt `v_arty_struct`), größte: `v_fac_land` 9, `v_bot`/`v_tank`/`v_aa` 8. DECISIONS 17 (40 Visuals ⇒ 309 Draws) bleibt gültig. |
| B1 | Glut-Monopol durch `stack` verletzt | ✓ | Stacks aus Fallhammer, Pfanne, Reißnadel, Hochrost, Horcher III, Schirm III und Hochofen entfernt, dazu der Heckschlot der Zapfstelle III; „Schlot am Heck“ aus `faction.md` §3.4 gestrichen. Lint: `stack`/`glow` nur bei ECONOMIC, FACTORY, ENGINEER. |
| B2 | Pflicht-Teamfarbe fehlt | ✓ | Engineers: Kessel `team` (Bauchband), Kranarm `copper`; Funke: Wanne `team`; Rost I/II und Hochrost: `grate` `team`. Lint: ≥ 1 Team-Part pro Blueprint. |
| B3 | Mauer mit Tech-Streifen | ✓ | `techStripes` 0 (auch Vogt). |
| B4 | Engineer-Streifen unsichtbar | ✓ | Graphit auf Keramik (`techStripeMat`); Streifenmaß 0,10 WU × Maßstab, Abstand 0,10 WU, hinteres Drittel. |
| B5 | Tech-Maßstab gegen Footprint | ◐ | Upgrade-Strukturen: Sockel füllt den Footprint, nur die Höhe wächst (1,2 / 1,4). Neubauten mit Footprint-Sprung: xz = Footprint-Verhältnis (Glutkessel II 3,0, III 4,0, Riegel II 2,0, Hochofen 4,0). Mobil: Deckel 1,4 bei 1×1 übernommen (Meister, Reißnadel, Trommelsieb). **Verworfen:** die Regel „Modelllänge ≤ 1,25 × Footprint-Kante“ – schon die Punze (1,4 WU auf 1×1) verletzt sie; der Footprint ist eine Pathing-Zelle, auch FA-Modelle überragen ihn. Werte in `kitbash.scale`. |
| B6 | Mindestgröße gegen iconThreshold | ◐ | Variante „iconThreshold mobil ≥ 25 px“ übernommen (12 % von 25 px = 3 px). Die konkreten Maße sind an die 12-%-Regel angepasst statt 0,12 WU (das wären bei 25 px nur 2,1 px): AA-Rohr Ø ≥ 0,17 WU, Raketenkasten-/Kellenrohr-Breite ≥ 0,34 WU, Kranarm ≥ 0,17 WU (Basis Punze 1,4 WU). PLAN §3.9 nennt im Beispiel `iconThreshold:14` – Anpassung ist offener Punkt §18. |
| C1 | Rinne ↔ Rüttelsieb | ✓ | Rinne mit einem Raketenkasten 0,5 × 0,25 × 1,1 WU bei 50°, AA-Rohre ≥ 75° (Differenz ≥ 25°); Paar in der MS9-Pflichtliste. |
| C2 | Hochofen ↔ Glutkessel III | ✓ | Hochofen = Tiegel-Silhouette (Sockel, Lafette, Kelle Ø 3,0, Steilrohr 7 × 0,6 WU, Gegengewicht, 5 Parts, kein Schlot). Artillerie hat damit zwei Signaturen: Kelle und Raketenkasten. |
| C3 | Glutspeicher ↔ Glutkessel I | ✓ | Glutspeicher = zwei stehende, flache Trommeln; Glutkessel = liegender Kessel mit Schlot ≥ 1,5 × Kessel-Ø. |
| C4 | Zapfstelle III ↔ Dampfquelle | ✓ | Gelöst durch B1 (kein Heckschlot) und B5 (Zapfstelle bleibt 2×2). |
| C5 | Horcher ↔ Schirm, Funke ↔ Schürze | ✓ | Radar trägt eine rechteckige Platte (`wing`-Prisma 1,6 × 0,8 × 0,1 WU, 35°) statt eines Rings – kein neues Primitiv nötig. Schild-Ring Ø ≥ 0,8 × Footprint-Kante, Schürzen-Ring Ø ≥ 1,2 × Rumpfbreite, Funken-Mast ≥ 1,0 × Rumpflänge. |
| C6 | Turmfalke ↔ Elster, Lerche ↔ Dohle | ✓ | Elster mit zwei Kessel-Gondeln an den Flügelspitzen, Spannweite +30 %; Dohlen-Kessel ≥ 1,4 × Flügeltiefe. „Krähe ↔ Elster“ ersetzt durch „Turmfalke ↔ Elster“. |
| C7 | Pflichtpaare nur ● | ✓ | `silhouettePairs.ms9` (9 Paare, vom Generator auf ● geprüft) und `silhouettePairs.ms14` (7 Paare), §16. |
| C8 | Vogt-Größe | ✓ | Höhe ≥ 2,4 WU, Schulterbreite ≥ 2,0 WU. |
| D1 | Radar-Blip verrät Vogt | ✓ | Blips nur Achteck (Land inkl. Engineer und Vogt), Dreieck (Luft), Sechseck (Gebäude), einheitlich 1,0×. |
| D2 | Achteck ↔ Kreis | ✓ | Land = Quadrat mit Fase ≤ 4 DE, Engineer = Kreis Ø 28 DE. |
| D3 | Kerben unter 3 px | ◐ | Mindeststrich 5 DE, Kerben 5 × 9 DE übernommen; Späher-Faktor **1,0 statt 0,8** (bei 0,8 hätten 5-DE-Striche nur 2,5 px). Mauer bleibt 0,6, sie hat weder Glyphe noch Kerben. |
| D4 | LAB und Panzer mit gleichem Icon | ✓ | Glyphe `bot` (Punkt + 2 Beinstriche), `land_bot_t1..t3` für Stichel, Zange, Fallhammer. |
| D5 | Glyphen-Zahl | ✓ | 19 Tokens (`iconGlyphs`), Tabelle mit IDs in `faction.md` §6.3; Jagdbomber als Sanduhr (^ über v, je 6 DE, 2 DE Abstand). |
| D6 | Hotbuild-Prinzip gebrochen | ◐ | Reißnadel auf **F statt D** (D ist Schürze, sonst teilten sich wieder zwei Rollen eine Taste). S = Bots (Stichel → Zange → Fallhammer), Q = Panzer (Punze → Meißel). Bau-Menü: Glutspeicher auf **T statt F**; Schirm bleibt F, Tiegel/Hochofen V. Grund: 13 Rollen passen nicht auf 12 Tasten; der Vorschlag hätte die Artilleriestellungen verdrängt. |
| E1 | Grep gegen FA-Namen | ✓ | Durchgeführt gegen alle 357 Einheitennamen aus spooky-db 3810: kein Treffer. Einzige Teilwort-Übereinstimmung „Master“ (in „Burst Master“) ist ein generisches Wort und bleibt. Markenrecherche bleibt offen (§18). |
| E2 | „Hydrocarbon Plant“ | ✓ | Rolle jetzt „Dampfkraftwerk / Geothermal Plant“; ID `hydro` bleibt intern. |
| E3 | `faReference.role` zitiert FA-Strings | ✓ | `faReference.devOnly: true`; Lint entfernt das Feld beim Blueprint-Build. |
| E4 | Vogt-Layout = FA-ACU-Schema | ✓ | Glocke auf der rechten Schulter, Keramik-Rückenkran über die linke Schulter; Lot-Kopf bleibt Hauptmerkmal. |
| E5 | Rollenbezeichnungen | ✓ | Rost I „Flugabwehrturm“, Krähe „Kampfschweber“. |

---

## 18. Offene Punkte

1. **FA-Datenstand:** spooky-db „3810“ ist nicht der aktuelle FAF-Patch. Vor MS9 alle 50 Referenzen gegen den dann aktuellen `FAForever/fa`-Stand prüfen (Skript: Referenz-IDs aus `roster.json` → DPS-Formel → Δ, Produkt, Pulk und Treffer-Matrix neu rechnen).
2. **Kartenpool und Hochofen:** Enthält der MVP-Pool eine 256-WU-Karte, schlägt das Reichweiten-Gate (200 > 145) fehl. Entweder Pool ≥ 354 WU oder Hochofen per Karten-Restriktion sperren. Mit 48.000 Mass ist er auf kleinen Karten ohnehin ein Spätspiel-Ziel.
3. **Abstich als Integer-Tabelle:** Die FAF-Formel steht fest (Waffennotiz des Vogts). Für den Determinismus wird sie in MS6 als ganzzahlige Umrechnung E ↔ Schaden festgelegt (MS6-Golden).
4. **Vogt-Wrack** (`faction.md` §10.2) bleibt offen, `wreck` ist beim Vogt noch nicht gesetzt.
5. **Luft-Drehraten:** FA gibt `Air.TurnSpeed` in eigener Einheit an. Die `turnRateDeg`-Werte der Luft sind Entwurfswerte für das kinematische Modell und werden in MS12 getunt.
6. **Beschleunigung (`accel`)** ist ein Entwurfswert pro Klasse (Panzer 2,2–2,5, Bots 2,6–4,0, Artillerie 1,8–2,2); FA liefert dafür keine direkt übertragbare Zahl. Tuning mit SPK2/MS3.
7. **Schema:** `roster.json` enthält Felder, die `UnitSchema` heute nicht kennt (Waffen, Ökonomie, Schilde inkl. `regenStartS`, Toggles, Adjacency, `kitbash.parts`/`scale`/`techStripeMat`, Tech-Bitmaske der Visuals). Die Übernahme folgt dem Schema-Ausbau in MS4–MS8.
8. **iconThreshold:** PLAN §3.9 zeigt im Blueprint-Beispiel `iconThreshold:14`. Für die Mindestgröße gilt jetzt 25 px (mobil, bezogen auf die Bildschirmlänge der Einheit); das muss bei der Blueprint-Übernahme bzw. in DECISIONS nachgezogen werden.
9. **Pulk-Gate für Bomber und Flak:** Das Pulk-Gate gilt nur für `ARTILLERY`. Bomben (Dohle, Elster) und Flak (Rüttelsieb, Rost II) werden in MS12 mit demselben Modell nachgerechnet.
10. **Superset-Zählung:** Die Visual-Vereinigung zählt nach (Part, Material). Sitzen gleiche Parts auf verschiedenen Positionen (Punze-Rohr mittig, Meißel-Rohre parallel), zählen sie beim Mesh-Bau doppelt; die Grenzen (8 / 9 Parts) dann erneut prüfen und notfalls das Visual teilen.
11. **Namen:** Markenrecherche zu allen Rufnamen, „Varkan“ und „Kessa“ steht aus; der FA-Namens-Grep ist erledigt (§17.2 E1).

---

## 19. Experimentals (T4, Post-MVP)

> **Nicht Teil des MVP.** U16 (erstes Land-Experimental) ist Post-MVP, U21 (volles Roster, Game-Ender) und E17 (Endgame-Eco) sind „Später“. Die Einträge stehen als vollständige Daten bereit (`tech: 4`, `postMvp: true`, Meilenstein PM1–PM3), damit Modelle, Icons und Balancing-Relationen früh prüfbar sind. Design, Mechaniken und Konter: [`experimentals.md`](experimentals.md). Gleiche Gates wie das MVP gegen die FA-T4-Referenz (±25 % hart, ±15 % Ziel inkl. Produkt/Pulk) plus T3-Äquivalent-Relation (±25 %). Review vom 2026-09-29 eingearbeitet (Mantel-Regeneration und -Neuaufbau, Konverter-Streuung, -Warnung und -Signatur, Baustellen- und Pathing-Regeln): [`experimentals.md`](experimentals.md) §10.

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T4 | `core:exp_lnd_walker` | **Stampfe** / Stamper | Experimenteller Sturmläufer / Experimental Assault Walker | Experimental Assault Bot (Riesen-Laufroboter) (`UAL0401`, Gegenprobe `XSL0401`) | PM1 | 27.000 / 340.000 / 51.000 | 96.000 | 2,4 / 40° | 6×6 / s6 | 50 | Großguss: Q | `land_bot_t4` |
| T4 | `core:exp_lnd_foundry` | **Kokille** / Mould | Mobile Gießhalle / Mobile Foundry | Experimental Mobile Factory (mobile Fabrik/Festung) (`UEL0401`, Gegenprobe `XRL0403`) | PM2 | 28.000 / 350.000 / 47.500 | 13.000 | 1,75 / 30° | 7×9 / s7 | 32 | Großguss: E | `land_fac_land_t4` |
| T4 | `core:exp_air_gunship` | **Kolkrabe** / Raven | Experimenteller Kampfschweber / Experimental Gunship | Experimental Gunship (Luft-Experimental) (`URA0401`, Gegenprobe `UAA0310`) | PM2 | 29.000 / 800.000 / 48.000 | 74.000 | 8 / 20° | 7×7 / s0 | 46 | Großguss: S | `air_direct_t4` |
| T4 | `core:exp_str_arty` | **Konverter** / Converter | Strategische Artillerie / Strategic Artillery | Experimental Artillery (strategische Artillerie, Game-Ender) (`UEB2401`, Gegenprobe `URL0401`) | PM3 | 220.000 / 5.900.000 / 300.000 | 8.000 | – | 10×10 | 28 | Großguss: W | `struct_arty_t4` |
| T4 | `core:exp_str_eco` | **Tiefenstich** / Deep Tap | Tiefenzapfwerk / Resource Works | Experimental Resource Generator (Endgame-Eco) (`XAB1401`) | PM3 | 245.000 / 7.300.000 / 325.000 | 5.200 | – | 12×12 | 20 | Großguss: A | `struct_mass_t4` |
| T4 | `core:exp_str_shield` | **Mantel** / Mantle | Großschild / Bastion Shield | T3 Heavy Shield Generator ×≈5 (FA hat kein Schild-Experimental; Relation pro Mass) (`UEB4301`, Gegenprobe `UEL0401`) | PM2 | 16.000 / 260.000 / 24.000 | 2.500 | – | 8×8 | 24 | Großguss: F | `struct_shield_t4` |

**Waffen und Balance** (Δ gegenüber der FA-T4-Referenz; Vergleichsbasis in der letzten Spalte)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt | Vergleich |
|---|---|---|---|---|---|---|---|
| `exp_lnd_walker` | `wpn_stamper_twin_bell` Doppelglocke (zwei Schulterkanonen, abwechselnd): 2×500 / 0,4 s = **2500 DPS**, RW 2–40, linear, Splash 1<br>`wpn_stamper_footfall` Stampfen (Fußtritt beim Aufsetzen, Crush): 3.000 / 1,2 s = **2500 DPS**, RW 1,2, fußtritt, Splash 1,2 | 0,0926 (0,0909) | +1,9 % | 3,5556 (3,6363) | −2,2 % | −0,4 % | FA-DPS = Strahl 2.500 + Greifer 0,04 (ohne Todeswaffe); Stampfen nicht gewertet (FA-Footfall ebenfalls nicht in spooky-DPS) |
| `exp_lnd_foundry` | `wpn_foundry_ladle` Deckskellen (drei Schlackenwerfer, gemeinsame Salve): 3×250 / 1 s = **750 DPS**, RW 100, ballistisch, Splash 1,5<br>`wpn_foundry_bell` Flankenglocken (Schnellfeuer, zwei Türme): 2×150 / 0,6 s = **500 DPS**, RW 45, linear<br>`wpn_foundry_aa` Rostkamm (Flak): 40 / 0,7 s = **57,1 DPS**, RW 45, linear [Luft] | 0,0467 (0,0467) | ±0 % | 1,1786 (1,1607) (inkl. Schild) | +1,5 % | +1,5 % | FA-DPS = Artillerie 750 + Riot 500 + Flak 57,14 (ohne Torpedo 75, Marine Post-MVP) |
| `exp_air_gunship` | `wpn_raven_bells` Hängeglocken (zwei schwere Schnellfeuer-Kanonen): 2×320 / 0,7 s = **914,3 DPS**, RW 30, linear, Splash 3<br>`wpn_raven_rockets` Rumpfraketen (Dreiersalve): 3×200 / 2 s = **300 DPS**, RW 30, linear<br>`wpn_raven_aa` Flakkamm (Luftabwehr-Raketen): 2×150 / 2,5 s = **120 DPS**, RW 60, lenkflugkörper [Luft] | 0,046 (0,046) | +0,1 % | 2,5517 (2,5862) | −1,3 % | −1,3 % | FA-DPS = Raketen 285 + Flak 120 + Bolter 928,57 (alle Waffen außer Absturz); FA-Tempo 9 (Air.MaxAirspeed) |
| `exp_str_arty` | `wpn_converter_shell` Konverterguss (Schwerstgranate): 16.000 / 8 s = **2000 DPS**, RW 150–1.500, ballistisch, Splash 7<br>Pulk-DPS/Mass 0,4016 (FA 0,3931): +2,2 % | 0,0091 (0,0089) | +2,2 % | 0,0364 (0,0356) | +2,2 % | +4,4 % | FA-DPS = 16.000 / 8 s; Pulk-DPS/Mass mit Splash 7 wie FA |
| `exp_str_eco` | – | – (–) | – | 0,0212 (0,02) | +6,2 % | – | keine Waffen; HP/Mass-Vergleich gegen `XAB1401` |
| `exp_str_shield` | – | – (–) | – | 5,1562 (5,303) (inkl. Schild) | −2,8 % | – | HP+Schild pro Mass gegen T3-Schildgenerator (FA-Upgradekosten) |

**Besonderheiten, Mechaniken, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Feature-IDs · neue Mechaniken | Kitbash (Parts) |
|---|---|---|---|---|
| `exp_lnd_walker` | LAND MOBILE DIRECTFIRE BOT EXPERIMENTAL<br>*von:* `ENGINEER & TECH3` | Death: `wpn_stamper_break` 8.000/r7 (Gussbruch: kippt in Laufrichtung, Explosion nach 2,0 s (XM4), Friendly Fire (K8); FA-Relation 8000 r7)<br>Reiner Nahkampf-Koloss ohne Flugabwehr: Konter sind Luft (Krähe, Elster, Kolkrabe), Hochofen-/Pfannen-Beschuss auf Abstand und Reißnadel-Pulks. Regeneration 10 HP/s. Nicht amphibisch (Layer Land; Amphibious erst mit U17), Wasser nur über Brücken. Wrack 90 % Mass (24.300) – „Schlacke ist auch Erz“. (Verzögerung 2 s)<br>Crush: Mauern ja, Wracks ja, schiebt sizeClass ≤ 3, Fußtritt 3.000/r1,2<br>Wrack 24.300 Mass<br>**Konter:** Luft (Krähe, Elster, Kolkrabe) – keine Flugabwehr; Artillerie auf Abstand (Pfanne 85 WU, Hochofen 200 WU) gegen Tempo 2,4; Reißnadel-Pulks auf 58 WU (gleiches Tempo 2,4: Abstand halten braucht Mikro); Baustelle früh angreifen (XM9) | U16, B2, B1, B6, M5, M6, M7, K4, K5, K8, P14, A16, C2 · XM1, XM2, XM3, XM4, XM8, XM9 | Zweibeiniger Stampfkoloss, Höhe ≈ 6,3 WU (2,6× Vogt): breite Torso-Wanne (team) auf zwei Säulenbeinen mit runden Stampffüßen (Ø 1,6 WU), zwei Schulterglocken mit waagerechten Rohren (Direktfeuer-Monopol), liegender Rückenkessel als Gegengewicht. Keramik-Klammer (zwei Winkelleisten an den Deckkanten) statt Tech-Streifen. Kein Schlot, kein Lot-Kopf (Vogt-Monopol).<br>legs(bein l) ⟳legs, legs(bein r) ⟳legs, hull(becken), hull(torso) ⟳yaw [team], bell(schulter l) [team], bell(schulter r) [team], barrel(rohr l) ⟳pitch, barrel(rohr r) ⟳pitch, boiler(rueckenkessel), hull(stampffuss l), hull(stampffuss r), hull(klammer) [ceramic] — 12 Parts, 5 anim., ≈ 468 Tris · Maßstab 1 · keine Streifen · Budget 1600/800/320 Tris |
| `exp_lnd_foundry` | LAND MOBILE FACTORY DIRECTFIRE INDIRECTFIRE ANTIAIR SHIELD EXPERIMENTAL<br>*von:* `ENGINEER & TECH3` | BP 135 · Speicher 200 M · Speicher 1.000 E<br>Toggles: shield (C17)<br>Death: `wpn_foundry_burst` 4.000/r7 (Kesselbruch (XM4), Friendly Fire (K8); FA-Relation 4000 r7)<br>Schild 20.000 HP, r 24, Regen 100/s ab 1 s nach dem letzten Treffer, Neuaufbau 120 s, 600 E/s<br>Mobile Fabrik mit der Bauliste von Landwerk III (Build Power 135 wie FA), Personal-Kuppel 20.000 HP (Radius 24, deckt Begleiter). Baut nur im Stand, Ausgang über die Heckrampe (XM5), kein Assist auf fremde Baustellen. Kein Torpedo (Marine Post-MVP): FA-Vergleich ohne Anti-Navy-Waffe. (Verzögerung 1,5 s)<br>Crush: Mauern ja, Wracks ja, schiebt sizeClass ≤ 3<br>Wrack 25.200 Mass<br>**Konter:** Energy-Stall (600 E/s Unterhalt, E3) schaltet die Kuppel ab; Konzentrierter Direktbeschuss (Stampfe, Fallhammer-Pulk) unter die Kuppel; Bomber nach Kuppel-Kollaps (Flak nur 57 DPS); Baut nur im Stand – dann treffen Hochofen und Konverter sicher (2 Konverter-Treffer brechen die Kuppel, der dritte zerstört die Kokille) | U21, U5, B3, K10, K2, K4, K12, M5, M6, M7, C17, E3, P14, A16, C2 · XM1, XM2, XM3, XM4, XM5, XM8, XM9 | Rollende Gießhalle auf vier Kettenblöcken (7 × 9 WU): U-Portal (Fabrik-Monopol) mit glühendem Werkhallentor und Heckrampe, zwei Schlote (FACTORY = Flow-Einheit), vorn zwei Deckskellen (Artillerie), seitlich zwei Glocken (Direktfeuer), am Heck ein Rostkamm (Flak), mittig Schildmast mit waagerechtem Ring als höchstem Punkt. Keramik-Klammer an den Deckkanten.<br>tracks(kette l), tracks(kette r), hull(wanne), hull(deck) [team], hull(portal), stack(schlot l) [glow], stack(schlot r) [glow], ladle(kelle l) ⟳yaw [team], ladle(kelle r) ⟳yaw [team], bell(glocke l) ⟳yaw [team], bell(glocke r) ⟳yaw [team], grate(rostkamm) ⟳yaw [team], mast(schildmast), ring(schildring) ⟳spin [team], hull(klammer) [ceramic] — 15 Parts, 6 anim., ≈ 500 Tris · Maßstab 1 · keine Streifen · Budget 1600/800/320 Tris |
| `exp_air_gunship` | AIR MOBILE GUNSHIP DIRECTFIRE ANTIAIR EXPERIMENTAL<br>*von:* `ENGINEER & TECH3` | −600 E/s<br>Death: `wpn_raven_crash` 5.000/r8 (Absturz (K12, XM4): trudelt 3 s, Aufschlag wie FA 5000 r8)<br>Schwebt tief (Flughöhe ≈ 12 WU) und langsam (8 WU/s); nur Flugabwehr trifft (K3). Landet nicht, Footprint 7×7 nur für die Baustelle. Regeneration 70 HP/s. Unterhalt 600 E/s (FA-Relation), im Energy-Stall halbe Feuerrate. Konter: Hochrost, Trommelsieb, Turmfalken-Schwärme. (Verzögerung 3 s)<br>Wrack 26.100 Mass<br>**Konter:** Hochrost (SAM) und Trommelsieb; Turmfalken-Schwärme (Abfangjäger); Energy-Stall halbiert die Feuerrate | U21, U11, K3, K11, K12, K4, E3, P14, A16, C2 · XM1, XM4, XM8, XM9 | Fliegende Gussplatte ≈ 9,5 × 9,5 WU ohne Flügel (Gunship-Monopol): vier Ringdüsen im Kreuz um eine gefaste Deckscheibe (team), darunter zwei hängende Glocken mit waagerechten Rohren, Raketenkessel im Bauch, vier senkrechte Flakrohre als Kamm am Heck. Keramik-Klammer an der Deckscheibe.<br>hull(deckscheibe) [team], ductfan(duese vl) ⟳spin [team], ductfan(duese vr) ⟳spin [team], ductfan(duese hl) ⟳spin [team], ductfan(duese hr) ⟳spin [team], bell(glocke l) ⟳yaw [team], bell(glocke r) ⟳yaw [team], barrel(rohr l), barrel(rohr r), boiler(raketenkessel), barrel(flakkamm), hull(klammer) [ceramic] — 12 Parts, 6 anim., ≈ 512 Tris · Maßstab 1 · keine Streifen · Budget 1600/800/320 Tris |
| `exp_str_arty` | STRUCTURE ARTILLERY INDIRECTFIRE STRATEGIC EXPERIMENTAL SIZE20<br>*von:* `ENGINEER & TECH3` | Reichweite 1.500 WU deckt jede MVP-Karte (Setons-Diagonale 1.448 WU); FA 4.000 (bis 81-km-Karten, M14). Einzelschuss und Takt wie FA: ein Schuss knackt Schirm II allein, Schirm III nach 2 Treffern, den Mantel nach 6. Streuung mit Untergrenze 8 WU (> Splash 7): auf kurzen Distanzen kein Einheiten-Scharfschütze, ein stehender Vogt (12.000 HP) wird mit ≈ 32 % je Schuss getroffen und hört die Einschlagwarnung. Baustelle ab 50 % für alle Gegner sichtbar (XM9). Keine Death-Weapon (wie FA), Wrack 90 % Mass.<br>Wrack 198.000 Mass<br>**Konter:** Mantel über der Basis (6 Treffer = 40 s bis zum Bruch); Früher Angriff auf die Baustelle (300.000 BT: Sicht-Meldung XM9); Stampfe/Kolkrabe-Vorstoß: 8.000 HP, keine Eigenverteidigung; Einheiten weichen dem Warnring aus (Flugzeit ≈ 9 s auf 1.000 WU); Radar-Jamming (I5, später) verhindert Zielauflösung | U21, K13, K2, K4, K6, K8, K10, I2, I3, C15, P8, P14, A21, C2 · XM6, XM8, XM9 | Kippender Konverter auf 10×10: Drehbühne mit zwei Wangen, darin die birnenförmige Konverter-Kelle (Ø ≈ 5 WU, team, Artillerie-Monopol) mit Steilrohr ≈ 8 WU aus der Mündung (60°), zwei Gegengewichte; Höhe ≈ 14 WU – höchstes Bauwerk des Rosters. Keramik-Klammer am Sockel, kein Schlot.<br>hull(sockel), hull(randband) [team], boom(drehbuehne) ⟳yaw, boom(wange l), boom(wange r), ladle(konverterbirne) ⟳pitch [team], barrel(steilrohr), hull(gegengewicht l), hull(gegengewicht r), hull(klammer) [ceramic] — 10 Parts, 2 anim., ≈ 284 Tris · Maßstab 1 · keine Streifen · Budget 1600/800/320 Tris |
| `exp_str_eco` | STRUCTURE ECONOMIC MASSPRODUCTION ENERGYPRODUCTION EXPERIMENTAL SIZE24<br>*von:* `ENGINEER & TECH3` | +20 M/s · +1.000 E/s · Speicher 100.000 E<br>Death: `wpn_deep_tap_break` 35.000/r25 (Tiefenbruch: Glutsäule bricht ein, Explosion nach 2 s (XM4), Kettenreaktion (K14), Friendly Fire; FA-Relation 35000 r25)<br>Grundlast 20 M/s + 1.000 E/s, darüber deckt er den Bedarf des Hauses bis 750 M/s und 75.000 E/s (XM7). FA deckelt erst bei 10.000 M/s / 1.000.000 E/s (praktisch unbegrenzt); der Deckel hält ein zweites Zapfwerk sinnvoll und die Eco-Kurve im Unit-Cap. Verhältnis E:M = 100:1 wie FA. (Verzögerung 2 s)<br>Wrack 220.500 Mass<br>**Konter:** Nur 5.200 HP: Konverter und schon ein Hochofen (5.500) töten ihn mit einem Treffer – Standort > 200 WU hinter der Front oder unter dem Mantel; Kolkrabe-Vorstoß, Bomber; Todesexplosion 35.000 r25 – nicht neben Werke stellen | E17, E1, E2, E3, E4, K14, K8, P14, A16, C10, C2 · XM4, XM7, XM8, XM9 | Bohrwerk auf 12×12: drei konzentrische Kränze (Zapfstellen-Grammatik, zwei drehen gegenläufig) um einen Bohrturm mit glühendem Pumpenkopf (Glutkern), vier Eckschlote (Energy). Liest sich als „Raute + Flamme“ in Riesengröße. Keramik-Klammer am Sockel.<br>hull(sockel), hull(randband) [team], ring(kranz 1) ⟳spin [team], ring(kranz 2) ⟳spin, ring(kranz 3), mast(bohrturm), boiler(pumpenkopf) [glow], stack(schlot 1) [glow], stack(schlot 2) [glow], stack(schlot 3) [glow], stack(schlot 4) [glow], hull(klammer) [ceramic] — 12 Parts, 2 anim., ≈ 396 Tris · Maßstab 1 · keine Streifen · Budget 1600/800/320 Tris |
| `exp_str_shield` | STRUCTURE SHIELD DEFENSE EXPERIMENTAL SIZE16<br>*von:* `ENGINEER & TECH3` | Toggles: shield (C17)<br>Schild 80.000 HP, r 60, Regen 250/s ab 1 s nach dem letzten Treffer, Neuaufbau 90 s (danach 25 %), 2.000 E/s<br>Eigene Varkan-Rolle ohne FA-T4-Vorbild: Kuppel Radius 60 (2,25× Fläche von Schirm III) mit 80.000 HP und 250 HP/s Regeneration (5 Schirm III: 650 HP/s verteilt). Der Konverter bricht sie nach 6 Treffern (40 s), ein einzelner Hochofen nach ≈ 9,5 min, zwei im Wechsel nach ≈ 2,5 min. Nach dem Kollaps 90 s offline, dann mit 25 % (20.000) zurück: gestapelte Mäntel verzögern einen Konverter, sperren ihn aber nicht dauerhaft. Unterhalt 2.000 E/s: ein Energy-Stall (E3) lässt die Kuppel sofort fallen.<br>Wrack 14.400 Mass<br>**Konter:** Energy-Stall (2.000 E/s); Einheiten laufen unter die Kuppel (Stampfe, Kokille); Konverter + 2 Hochöfen im Takt; Nach dem Kollaps kehrt die Kuppel nur mit 25 % zurück (2 Konverter-Treffer); Kuppel schützt nicht gegen Todeswaffen innerhalb | K10, E3, C17, C15, P14, U21, A16, C2 · XM8, XM9 | Schildturm auf 8×8: dicker Mast mit drei gestaffelten waagerechten Ringen (oberster = größter, Ø ≈ 8 WU, team; Schild-Monopol), Generatorkessel am Fuß, gefaltete Schürze (der „Mantel“, team), vier Strebebögen tragen den unteren Ring. Höhe ≈ 12 WU (≈ 2,7× Schirm III). Keramik-Klammer am Sockel, kein Schlot.<br>hull(sockel), hull(randband) [team], boiler(generator), mast(hauptmast), ring(ring oben) ⟳spin [team], ring(ring mitte) ⟳spin, ring(ring unten), hull(schuerze) [team], hull(klammer) [ceramic] — 9 Parts, 2 anim., ≈ 328 Tris · Maßstab 1 · keine Streifen · Budget 1600/800/320 Tris |

**Neue Mechaniken (Vorschlag, noch ohne Eintrag in `features.json`)**

| Code | Mechanik | gebraucht von |
|---|---|---|
| XM1 | Mobile Großbaustelle: Meister gießen mobile T4 als Baustelle mit Footprint (blockiert Pathing wie ein Gebäude, B1/B6), die bei 100 % zur Einheit wird und ausläuft (FA: NEEDMOBILEBUILD). Platzierung nur, wenn der Footprint in der Clearance-Komponente (Land, sizeClass) der Hauptfläche liegt (kein T4 im Basis-Kessel); Baustellen < 100 % haben keine Todeswaffe, ihr Wrack trägt 90 % der verbauten Mass | Stampfe, Kokille, Kolkrabe |
| XM2 | Massiv/Crush: kleinere Einheiten blockieren nicht (Steering-Priorität nach sizeClass, M7), werden beiseitegeschoben; Mauern und Wracks unter dem Footprint werden überrollt; Fußtritt-Schaden je Schritt (FA: Footfall-Damage) im festen Sim-Takt (12 Ticks, Fuß abwechselnd), im Tick vor der Kollisionsauflösung | Stampfe, Kokille |
| XM3 | Große Größenklassen: sizeClass 6–7 mit eigenen Clearance-Komponenten (M5/M6); Pfad-Klasse nach der Breite, die Länge 9 der Kokille löst das Steering (Wenden auf der Stelle, Stuck → Repath); Abnahme mit Basisgassen 7–9 WU | Stampfe, Kokille |
| XM4 | Verzögerte Death-Weapon (Umkippen/Absturz, 1,5–3 s Fluchtfenster) mit Kamera-Shake und Großereignis-Effekt (P14); Selbstzerstörung nutzt dieselbe Verzögerung; Kettenreaktionen (K14) je Glied ≥ 3 Ticks versetzt | Stampfe, Kokille, Kolkrabe, Tiefenstich |
| XM5 | Mobile Fabrik: Bauliste (B3) in einer mobilen Einheit, Ausgang Heckrampe, Rally relativ zum Träger; baut nur im Stand | Kokille |
| XM6 | Strategische Reichweite: Feuern auf Radar-/Ghost-Ziele außerhalb der Sicht (baut auf I3/K6 auf), Streuung σ = max(8 WU, 1,2 % der Distanz), Einschlagwarnung für den Beschossenen ab dem Abschuss (Ring Splash + 2σ, Ansage P8) | Konverter |
| XM7 | Bedarfsdeckende Produktion: Ertrag = Grundlast + clamp(Bedarf − Einkommen, 0, Deckel) je Eco-Tick, deterministisch nach der Stall-Auflösung (E3) | Tiefenstich |
| XM8 | T4-Icon: Klammer statt Tech-Kerben, Faktor 1,5 (content/icons/grammar.ts), Zeichenreihenfolge über T1–T3, Mesh bleibt länger vor dem Icon sichtbar (C2) | Stampfe, Kokille, Kolkrabe, Konverter, Tiefenstich, Mantel |
| XM9 | Großguss-Meldung: sieht ein Haus eine fremde T4-Baustelle (Sicht, nicht Radar), meldet die Ansage „Großguss gesichtet“ (P8); ab 75 % Baufortschritt zusätzlich Minimap-Ping (C16). Konverter-Baustellen melden sich ab 50 % allen Gegnern auch ohne Sicht (Ping mit 40 WU Unschärfe, „Großguss-Signatur“) | Stampfe, Kokille, Kolkrabe, Konverter, Tiefenstich, Mantel |

**T3-Äquivalent** (gleiche Mass in der stärksten T3-Einheit derselben Rolle; Relation T4/T3 von DPS/Mass bzw. HP/Mass gegen dasselbe Verhältnis in FA, Gate ±25 %)

| T4 → T3 | Anzahl T3 für gleiche Mass (FA) | Pool-DPS / Pool-HP der T3 | T4/T3 DPS/Mass (FA) | Δ | T4/T3 HP/Mass (FA) | Δ |
|---|---|---|---|---|---|---|
| Stampfe → Fallhammer | 54 (57,3) | 8100 / 172.800 | 0,309 (0,291) | +6,1 % | 0,556 (0,563) | −1,3 % |
| Kokille → Fallhammer | 56 (58,3) | 8400 / 179.200 | 0,156 (0,149) | +4,2 % | 0,184 (0,18) | +2,5 % |
| Kolkrabe → Krähe | 145 (151) | 7733 / 110.200 | 0,173 (0,166) | +4,2 % | 0,672 (0,709) | −5,3 % |
| Konverter → Hochofen | 4,6 (3,1) | 1681 / 45.833 | 1,19 (1,165) | +2,2 % | 0,175 (0,171) | +2,2 % |
| Tiefenstich → Zapfstelle III | 54,4 (54,4) | – / 381.111 | – (–) | – | 0,014 (0,013) | +3,9 % |
| Mantel → Schirm III | 5 (1) | – / 87.600 | – (–) | – | 0,942 (1) | −5,8 % |

**Tiefenstich als Mass-Quelle:** Deckel 750 M/s ≙ 41,7 Zapfstellen III (Kette I→III je 5.436 Mass, zusammen 226.500 Mass und 42 Spots); Amortisation bei vollem Bedarf 327 s (`XAB1401` bei gleichem Verbrauch 334 s).

**Bauzeit mit N Meistern** (Build Power 32 je Meister; Mass-/Energy-Fluss, den die Baustelle dann zieht; FA mit T3-Engineer BP 32,5)

| Einheit | BT | 1 Meister | 10 | 20 | 40 | Fluss bei 20 Meistern |
|---|---|---|---|---|---|---|
| Stampfe | 51.000 | 1.594 s (FA 1.585 s) | 159 s (FA 158 s) | 80 s (FA 79 s) | 40 s (FA 40 s) | 339 M/s, 4.267 E/s |
| Kokille | 47.500 | 1.484 s (FA 1.462 s) | 148 s (FA 146 s) | 74 s (FA 73 s) | 37 s (FA 37 s) | 377 M/s, 4.716 E/s |
| Kolkrabe | 48.000 | 1.500 s (FA 1.477 s) | 150 s (FA 148 s) | 75 s (FA 74 s) | 38 s (FA 37 s) | 387 M/s, 10.667 E/s |
| Konverter | 300.000 | 9.375 s (FA 9.231 s) | 938 s (FA 923 s) | 469 s (FA 462 s) | 234 s (FA 231 s) | 469 M/s, 12.587 E/s |
| Tiefenstich | 325.000 | 10.156 s (FA 10.000 s) | 1.016 s (FA 1.000 s) | 508 s (FA 500 s) | 254 s (FA 250 s) | 482 M/s, 14.375 E/s |
| Mantel | 24.000 | 750 s | 75 s | 38 s | 19 s | 427 M/s, 6.933 E/s |

**Schildbrechen mit T4** (ein Schütze, Hauptwaffe, Regeneration nach `regenStartS`)

| Angreifer → Schild | Salven (Zeit) |
|---|---|
| Konverter → Schirm II | 1 (0 s) |
| Konverter → Schirm III | 2 (8 s) |
| Konverter → Mantel | 6 (40 s) |
| Hochofen → Mantel | 39 (570 s) |
| Stampfe → Mantel | 80 (31,6 s) |
| Kolkrabe → Mantel | 125 (86,8 s) |
| Konverter → Kokille | 2 (8 s) |

**Silhouetten-Pflichtpaare T4** (Rollen-Verwandte gleicher Grammatik; getrennt durch Größe ≥ 2,5×, Keramik-Klammer und Icon-Klammer): Stampfe ↔ Vogt, Kolkrabe ↔ Krähe, Konverter ↔ Hochofen, Mantel ↔ Schirm III, Kokille ↔ Schürze, Tiefenstich ↔ Zapfstelle III.

**Todeswaffen** (Friendly Fire, K8/K14; FA-Relation)

| Einheit | Schaden / Radius (FA) | Verzögerung | tötet Fallhammer | tötet Glutkessel III |
|---|---|---|---|---|
| Stampfe | 8.000 / r7 (8.000 / r7) | 2 s | ja | nein |
| Kokille | 4.000 / r7 (4.000 / r7) | 1,5 s | ja | nein |
| Kolkrabe | 5.000 / r8 (5.000 / r8) | 3 s | ja | nein |
| Tiefenstich | 35.000 / r25 (35.000 / r25) | 2 s | ja | ja |

