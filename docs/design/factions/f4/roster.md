# Roster: Aurith-Chor (Fraktion f4, MVP)

> **Status:** Startwerte für alle MVP-Blueprints der Fraktion f4 auf Basis von `docs/design/factions/f4/faction.md`. Maschinenlesbar in `docs/design/factions/f4/roster.json` (Schema `faf-roster/1`, wie Varkan). **`roster.json` ist die einzige Quelle für Zahlen, ●/○-Status und Kitbash-Parts** der Fraktion; dieses Dokument ist daraus erzeugt (`tools/roster/f4/md.py`), `faction.md` §7.4, §9 und §11.1 sind daran angeglichen.
> **Umfang:** **49 Blueprints** (22 mobil, 27 Gebäude, jede Upgrade-Stufe einzeln), davon **26 im MS9-Kern (●)**, Rest bis MS14 (○). Zielbänder PLAN: MS9 25–30, MS14 45–55. 28 Visuals, 19 Icon-Glyphen (dieselben wie Varkan, keine neue). Ein Blueprint weniger als Varkan: Späher und leichter Sturmläufer fallen im Pfiff zusammen. Waffen-, Projektil- und Basis-BPs sind nicht mitgezählt.
> **Ausgeschlossen (Post-MVP laut features.json):** wie Varkan – TML/TMD, Nukes/SMD, Transporter (U13), T3-Luft (U12), Marine und Torpedos (U17/U18), Experimentals, Mass Fabricator (E15), SACU (U15), ACU-Enhancements (U14), Stealth/Omni (I4/I5). Vorbild-Asymmetrien, die solche Features brauchen, sind pro Einheit mit **⚑ Feature-ID** markiert (`special.postMvp`, Übersicht §17.2) und rein additiv.
> **Balancing:** Referenz ist die **Vorbild-Fraktion** (FA-Blueprints `XS*`, dazu die FAF-Einheit `DSLK004`), nicht die Varkan-Referenz. Gates wie Varkan: DPS/Mass und HP/Mass je ±25 % (hart, PLAN U3), vom Generator strenger erzwungen: Einzelachsen, **Produkt** und **Pulk-DPS/Mass** der Artillerie je ±15 %, **Treffer-bis-Tod-Matrix** exakt wie die Vorbild-Referenz (§14). Die Asymmetrie gegenüber Varkan entsteht allein dadurch, dass die Vorbild-Relationen übernommen werden (§17).

---

## 1. Quellen und Methodik

- **FA-Daten:** [FAForever/spooky-db](https://github.com/FAForever/spooky-db) `app/data/index.json` (Datenstand „3810“, derselbe wie bei Varkan), extrahiert mit `tools/roster/f4/ref.py` nach `tools/roster/f4/fa_ref.json` (49 Referenz-Blueprints, nur Zahlen). DPS nach `app/js/dps.js` (Nachladezeit auf 0,1-s-Ticks abgerundet, Salven über Racks/`MuzzleSalvoSize`, Strahl-Pulse über `BeamLifetime`).
- **Stichprobe gegen FAF `develop`** ([FAForever/fa](https://github.com/FAForever/fa) `units/*/…_unit.bp`, abgerufen 2026-09-29): T1-Gleiter-Referenz, T2-Stoßgleiter, Kommandant (HP 11.500, Regeneration 10, Tod 2.000/r30 + 500/r40) und Schildgeneratoren sind identisch. **Abweichungen seit 3810:** T2-Strahlverteidigung 50 statt 55 Schaden pro Puls (≈ 137,5 statt 151,25 DPS), Präzisionsläufer RW 60/70 statt 55/65. Der T3-Belagerungsgleiter hat in `develop` zwei Direktwaffen 57 / 0,5 s und die Indirektwaffe 625 / 3,4 s (≈ 412 DPS ohne Torpedo); 3810 kommt mit zwei Direktwaffen 64 / 0,5 s und 625 / 4,0 s auf dieselben ≈ 412 DPS. Das ist also keine Balance-Änderung, sondern war ein Extraktionsfehler (nächster Punkt). Das Roster bleibt wie Varkan auf 3810; Nachziehen vor dem MS9-Balancing (§19).
- **Doppelwaffen (`WeaponNumber`, Review R1):** spooky-db fasst identische Waffen (links/rechts) zu einem Eintrag mit `WeaponNumber` zusammen. `ref.py` wertet das Feld seit dem Review aus (`fa_ref.json` → `weapons[].count`, DPS × count). Betroffen in f4: T3-Belagerungsgleiter (2 Direktwaffen, Referenz-DPS ohne Torpedo 284 → 412), T2-Gunship (2 Bordwaffen, 57 → 114), T2-Jagdbomber (2 Luftwaffen, 200 → 275). Gegenprobe gegen FAF `develop`: dort stehen jeweils zwei getrennte Waffen-Einträge.
- **Schild-Regeneration** fehlt in spooky-db. Werte für `checks.shieldBreak` aus FAF `develop`: T2-Schild 153/s, T3-Schild 168/s, mobiler Schild 133/s, Regenerations-Verzögerung überall 3 s (Varkan-Vorbild: 3/3/1 s).
- **Referenzwahl:** je Rolle die Einheit der Vorbild-Fraktion (`faReference.bp`). Die Vorbild-Fraktion hat keinen reinen T1-Bot und keinen T2-Mobilschild; beide Rollen gehen in Pfiff bzw. Stille auf (faction.md §9.2 A1/A5). T3-Flugabwehr: FAF-Einheit `DSLK004`. T3-Radar: Omni-Sensor der Vorbild-Fraktion, ohne Omni halbiert wie beim Varkan-Horcher III. **Nur Blueprint-IDs und generische Rollenbezeichnungen, keine FA-Eigennamen**; `faReference` ist dev-only.
- **Referenz-DPS mit Auswahl (`balance.fa.dpsWeapons`):** Kantor nur Hauptwaffe (wie Vogt). Grollen ohne Torpedo, weil U18 Post-MVP ist. Diskant nur schneller Modus, weil sich die Modi ausschließen (spooky-db addiert beide). Zimbel und Schwärmer: beide Waffen, wie in der Referenz.
- **Einheiten, Waffen, Abweichung, Produkt, Pulk, Treffer bis Tod:** Definitionen identisch zu Varkan (`docs/design/roster.md` §1). Neu: **Strahlwaffen** (Gabel II, Zimbel) sind als Hitscan-Pulse notiert, `salvo` = Pulse pro Zyklus, `damage` = Schaden pro Puls (Vorschlag für K1, §19).
- **Kitbash:** Parts aus `faction.md` §3.3; ⟳ = animierter Part (≤ 2), `[mat]` = Material-Slot (`team`, `amber`, `glow`, `pearl`, sonst `body` = Pechglas). Der Dreipass-Sockel sind drei `lens`-Parts (Teamfarbe nur als Randmaske). Budget wie Varkan: mobil ≤ 7 Parts, Strukturen ≤ 9, ≤ 350 Tris; Superset pro Visual mobil ≤ 8, Strukturen ≤ 9. Lints im Generator: Resonanz-Monopol (`crystal`/`glow` nur ECONOMIC, FACTORY, ENGINEER), Form-Monopole (Gabel nur DIRECTFIRE, Trichter nur Artillerie/Indirekt, Pfeife nur ANTIAIR, Spindel nur SILO/ANTIAIR, Sichel und Perlglas nur ENGINEER), ≥ 1 Team-Part, `buildPower` bei upgradebaren Gebäuden, `regenStartS` bei Schilden, keine neue Icon-Glyphe.
- **Tonpunkte (`kitbash.techStripes`):** Feldname wie Varkan, Bedeutung bei f4: 1–3 Tonpunkte auf dem hinteren Kamm (Perlglas, bei Engineers Pechglas). Kantor und Grat ohne.
- **Prüfung:** `tools/roster/f4/gen.py` erzwingt alle Gates beim Erzeugen; `tools/roster/f4/validate.py` rechnet unabhängig aus `fa_ref.json` nach (Δ, Produkt, Pulk, Treffer-Matrix, Schema-Konsistenz) und endet bei Verstößen mit Exit-Code 1.
- **Spalten:** ● = MS9-Kern · MS = erster Meilenstein laut PLAN §5 · RW = Reichweite · s = sizeClass · Sicht / R = Radar · ⚑ = Post-MVP-Asymmetrie.

---

## 2. Zählung nach Meilenstein

| MS | neu gebraucht | Blueprints |
|---|---|---|
| MS4 | 3 (Σ 3) | ● Kantor, ● Stimmstock I, ● Resonator I |
| MS5 | 1 (Σ 4) | ● Triller |
| MS6 | 4 (Σ 8) | ● Chorist, ● Pfiff, ● Lichtkammer, ● Grundhalle I |
| MS7 | 2 (Σ 10) | ● Horn, ● Pfeife |
| MS8 | 14 (Σ 24) | ● Solist, ● Heuler, ● Brüller, ● Posaune, ● Bordun, ● Stimmstock II, ● Resonator II, ● Grundhalle II, ● Gabel I, ● Gabel II, ● Pfeifenwerk I, ● Pfeifenwerk II, ● Hochorgel, ● Grat |
| MS10 | 4 (Σ 28) | ● Äolsharfe, ● Bernsteinkammer, ○ Widerhall I, ○ Widerhall II |
| MS12 | 7 (Σ 35) | ○ Grille, ○ Zikade, ○ Maikäfer, ○ Schwebfliege, ○ Schwärmer, ○ Himmelshalle I, ○ Himmelshalle II |
| MS13 | 14 (Σ 49) | ○ Vorsänger, ○ Grollen, ○ Heerhorn, ○ Diskant, ○ Zimbel, ○ Stille, ○ Stimmstock III, ○ Resonator III, ○ Grundhalle III, ○ Widerhall III, ○ Dämpfer II, ○ Dämpfer III, ○ Fanfare, ○ Großhorn |

**MS9-Kern (26):** Kantor, Chorist, Solist, Pfiff, Triller, Horn, Pfeife, Heuler, Brüller, Posaune, Bordun, Stimmstock I, Stimmstock II, Resonator I, Resonator II, Äolsharfe, Bernsteinkammer, Lichtkammer, Grundhalle I, Grundhalle II, Gabel I, Gabel II, Pfeifenwerk I, Pfeifenwerk II, Hochorgel, Grat.

- 11 mobile Kern-Einheiten (Varkan: 11) und **dieselben 15 Kern-Strukturen wie Varkan**. Daten-Vorgriffe wie bei Varkan: Lichtkammer ab MS6 (Aufschrei braucht ≥ 7.500 E Vorrat), Bernsteinkammer und Äolsharfe (ohne neue Mechanik).
- **Brüller ist Kern**, weil der schwere T2-Läufer die Front der Fraktion trägt (A3); dafür entfällt der separate T1-Bot. Der **Pfiff** ist die erste Fabrik-Einheit im Opening (MS6) wie der Varkan-Stichel.
- **Hochorgel (SAM)** ist Kern wie der Varkan-Hochrost: B5 nimmt in MS8 „PD, Mauern, SAM“ ab; gespawnt per Konsole, baubar ab dem Vorsänger (MS13).

### 2.1 Abgrenzungen und Abweichungen gegenüber Varkan

| Punkt | Festlegung | Grund |
|---|---|---|
| `lnd_t1_bot` | nicht belegt | Pfiff (`lnd_t1_scout`) deckt Späher und LAB ab (A1); Icon `land_bot_t1`, Hotbuild A und S. |
| `lnd_t2_shield` → `lnd_t3_shield` | Stille erst auf T3 | Vorbild hat keinen T2-Mobilschild (A5). Varkans Schürze ist ebenfalls ○ (MS13), der Meilenstein verschiebt sich nicht. |
| `lnd_t3_bot` → `lnd_t3_tank` | Grollen statt T3-Läufer | Hybrid Direkt + Indirekt (A6); ID-Token `tank`, weil die Bauform ein Gleiter ist. |
| `lnd_t2_bot` | ● statt ○ | Linienanker der Fraktion (Varkan-Zange ist Roster-Auffüllung MS14). |
| Hallen | ein gemeinsames Visual `v_fac` | Grund- und Himmelshalle teilen Apsis und Kristalle, nur Rampe/Landereif unterscheiden sich (Rollenbit). Hält die Visual-Zahl bei 28 trotz separatem `v_sam`. |
| Namespace | `f4:` | Varkan bleibt `core:`; Vereinheitlichung offen (§19). |

---

## 3. Hotbuild-Raster (QWERT / ASDFG / ZXCVB, ohne Rebinding)

Belegung identisch zu Varkan (gleiche Taste = gleiche Rolle über alle Tech-Stufen). Ausnahme: Der Pfiff liegt auf A und S, weil er Späher und leichten Sturmläufer vereint; S wechselt ab T2 zum Brüller. D ist bis T3 leer.

**Grundhalle (Fabrik-Menü Land)**

| | Q / A / Z | W / S / X | E / D / C | R / F / V | T / G / B |
|---|---|---|---|---|---|
| Reihe 1 | **Q** Gleiter (Triller/Heuler/Grollen) | **W** Artillerie (Horn/Posaune/Heerhorn) | **E** Engineer (Chorist/Solist/Vorsänger) | **R** Flugabwehr (Pfeife/Bordun/Zimbel) | – |
| Reihe 2 | **A** Späher (Pfiff) | **S** Läufer (Pfiff T1 / Brüller T2) | **D** Support (Stille, ab T3) | **F** Präzision (Diskant) | – |

**Himmelshalle (Fabrik-Menü Luft)**

| | Q / A / Z | W / S / X | E / D / C | R / F / V | T / G / B |
|---|---|---|---|---|---|
| Reihe 1 | **Q** Abfangjäger (Zikade) | **W** Bomber (Maikäfer) | **E** Gunship (Schwebfliege) | **R** Jagdbomber (Schwärmer) | – |
| Reihe 2 | **A** Aufklärer (Grille) | – | – | – | – |

**Bau-Menü (Kantor und Engineers)**

| | Q / A / Z | W / S / X | E / D / C | R / F / V | T / G / B |
|---|---|---|---|---|---|
| Reihe 1 | **Q** Stimmstock | **W** Resonator | **E** Äolsharfe | **R** Bernsteinkammer | **T** Lichtkammer |
| Reihe 2 | **A** Grundhalle | **S** Himmelshalle | **D** Widerhall | **F** Dämpfer | – |
| Reihe 3 | **Z** Gabel | **X** Pfeifenwerk/Hochorgel | **C** Grat | **V** Fanfare/Großhorn | – |

---

## 4. Kantor und Engineers

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f4:cmd_commander` | **Kantor** / Cantor | Kommandant / Commander | Armored Command Unit (ACU), nur Hauptwaffe (`XSL0001`) | MS4 | 2.000 / 5.000.000 / 6.000.000 | 11.500 | 1,7 / 90° | 2×2 / s2 | 26 | – | `cmd_commander` |
| ● | `f4:lnd_t1_engineer` | **Chorist** / Chorister | Ingenieur / Engineer | T1 Engineer (`XSL0105`) | MS6 | 52 / 260 / 260 | 128 | 1,9 / 180° | 1×1 / s1 | 18 | Grundhalle: E | `eng_build_t1` |
| ● | `f4:lnd_t2_engineer` | **Solist** / Soloist | Ingenieur / Engineer | T2 Engineer (`XSL0208`) | MS8 | 130 / 650 / 650 | 360 | 1,9 / 160° | 1×1 / s1 | 20 | Grundhalle: E | `eng_build_t2` |
| ○ | `f4:lnd_t3_engineer` | **Vorsänger** / Precentor | Ingenieur / Engineer | T3 Engineer (`XSL0309`) | MS13 | 310 / 1.550 / 1.550 | 700 | 1,9 / 140° | 1×1 / s1 | 26 | Grundhalle: E | `eng_build_t3` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `cmd_commander` | `wpn_cantor_fork` Gabelton (Brustgabel): 100 / 1 s = **100 DPS**, RW 1–22, linear<br>`wpn_cantor_outcry` Aufschrei (Overcharge, manuell/auto): 15.000 / 3,3 s = **4545,4 DPS**, RW 22, linear, Splash 2,5 | 0,05 (0,05) | ±0 % | 5,75 (5,75) | ±0 % | ±0 % |
| `lnd_t1_engineer` | – | – (–) | – | 2,462 (2,404) | +2,4 % | – |
| `lnd_t2_engineer` | – | – (–) | – | 2,769 (2,692) | +2,9 % | – |
| `lnd_t3_engineer` | – | – (–) | – | 2,258 (2,244) | +0,6 % | – |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `cmd_commander` | LAND MOBILE COMMAND ENGINEER DIRECTFIRE RECLAIM REPAIR UNIQUE | BP 10 · +1 M/s · +20 E/s · Speicher 650 M · Speicher 3.900 E<br>Toggles: auto_outcry (MS10, C17)<br>Death: `wpn_cantor_shatter` 2.000/r30 + 500/r40 (Zerspringen, Phasenwelle, Kamera-Shake X4, FA-Relation 1:1 (FAF develop bestätigt 2000/30 + 500/40))<br>Einzigartig, Tod = Niederlage (U1/A4). Baut alle T1-Strukturen. Regeneration 10 HP/s. HP 11.500 = FA-Vorbild (−4 % zum Vogt). Wrack offen (faction.md §11.2 Nr. 11).<br>**⚑ U14:** Upgrades: Regenerations-Aura, Schadensstabilisierung, Feuerrate, Teleport (ohne Feature: Grundregeneration 10 HP/s wie Vogt)<br>**⚑ K16:** Taktische Rakete als Upgrade (ohne Feature: entfällt)<br>**⚑ P19:** Aufklang: Bernsteinsäule steigt auf und zerspringt (ohne Feature: 3-s-View-Platzhalter, spielbar ab Tick 0) | Dreibein mit rückwärts geknickten Gelenken (legs count 3), hoher Spindel-Torso, Krone aus drei Kristallen als stärkster Leuchtpunkt, Perlglas-Sichel als Halbkreis hinter der Krone, breite Gabel mittig vor der Brust; keine Arme, kein Kopf. Höhe ≥ 2,8 WU.<br>legs, keel(spindel torso) ⟳yaw [amber], fin(hinterkamm) [team], crystal(krone) [glow], sickle(bau halbkreis) [pearl], fork(brustgabel) ⟳pitch, lens(brustschale) [team] — 7 Parts, 2 anim., ≈ 260 Tris · Maßstab 1 · keine Tonpunkte | MS4 Bauen ohne Waffe; MS5 Waffe + Zerspringen; MS6 Aufschrei (U8) |
| `lnd_t1_engineer` | LAND MOBILE ENGINEER TECH1 RECLAIM REPAIR<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | BP 5<br>Baut T1-Strukturen, Assist, Reclaim, Repair. Fragil (A9): HP/Mass −20 % zum Varkan-Lehrling, FA-Vorbild-Relation. HP 128 hält die Breakpoints 2 Kantor-, 3 Horn-, 4 Triller- und 32 Pfiff-Treffer.<br>**⚑ M13:** amphibisch: fährt unter Wasser (Vorbild-Engineers) (ohne Feature: nur Land, wie Varkan-Engineers) | Kurzer breiter Kiel mit Perlglas-Rücken, eine Perlglas-Sichel diagonal vom linken Heck nach vorn rechts, Kristall an der Sichelspitze; teamfarbenes Kiel-Seitenband und kleiner Kamm; 1 Tonpunkt Pechglas.<br>keel(perlglas ruecken) [pearl], lens(schwebespalt), fin(kamm seitenband) [team], sickle ⟳yaw [pearl], crystal(emitter) ⟳pitch [glow] — 5 Parts, 2 anim., ≈ 160 Tris · Maßstab 1 · 1 Tonpunkt (Pechglas) | U2 (T1) in MS6 |
| `lnd_t2_engineer` | LAND MOBILE ENGINEER TECH2 RECLAIM REPAIR<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | BP 13<br>Baut T1+T2-Strukturen (Stimmstock II direkt, Resonator II, Gabel II, Pfeifenwerk II, Dämpfer II, Fanfare).<br>**⚑ M13:** amphibisch: fährt unter Wasser (Vorbild-Engineers) (ohne Feature: nur Land, wie Varkan-Engineers) | Chorist ×1,3 mit zwei verschieden großen Sicheln (Anzahl = Tech), 2 Tonpunkte Pechglas.<br>keel(perlglas ruecken) [pearl], lens(schwebespalt), fin(kamm seitenband) [team], sickle ⟳yaw [pearl], sickle(zweite sichel) [pearl], crystal(emitter) ⟳pitch [glow] — 6 Parts, 2 anim., ≈ 196 Tris · Maßstab 1,3 · 2 Tonpunkte (Pechglas) | U2 T2 als Daten in MS8 |
| `lnd_t3_engineer` | LAND MOBILE ENGINEER TECH3 RECLAIM REPAIR<br>*von:* `FACTORY & LAND & TECH3` | BP 32<br>Baut T1–T3-Strukturen (Hochorgel, Großhorn, Resonator III, Stimmstock III).<br>**⚑ M13:** amphibisch: fährt unter Wasser (Vorbild-Engineers) (ohne Feature: nur Land, wie Varkan-Engineers) | Maßstab 1,4 (Deckel 1×1), drei Sicheln (Anzahl = Tech), 3 Tonpunkte Pechglas; zweite und dritte Sichel statisch (Anim-Limit 2).<br>keel(perlglas ruecken) [pearl], lens(schwebespalt), fin(kamm seitenband) [team], sickle ⟳yaw [pearl], sickle(zweite sichel) [pearl], sickle(dritte sichel) [pearl], crystal(emitter) [glow] — 7 Parts, 1 anim., ≈ 232 Tris · Maßstab 1,4 · 3 Tonpunkte (Pechglas) | Rest U2 (T3-Engineer) in MS13 |

---

## 5. Landarmee T1

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f4:lnd_t1_scout` | **Pfiff** / Whistle | Kampfspäher / Combat Scout | T1 Combat Scout (deckt Scout + LAB) (`XSL0101`) | MS6 | 20 / 80 / 90 | 36 | 3,8 / 80° | 1×1 / s1 | 24 / R 40 | Grundhalle: A | `land_bot_t1` |
| ● | `f4:lnd_t1_tank` | **Triller** / Trill | Kampfgleiter / Battle Glider | T1 Medium Tank (`XSL0201`) | MS5 | 54 / 270 / 290 | 285 | 3,5 / 90° | 1×1 / s1 | 20 | Grundhalle: Q | `land_direct_t1` |
| ● | `f4:lnd_t1_arty` | **Horn** / Horn | Mobile Artillerie / Mobile Artillery | T1 Mobile Light Artillery (`XSL0103`) | MS7 | 54 / 180 / 290 | 180 | 2,7 / 90° | 1×1 / s1 | 18 | Grundhalle: W | `land_arty_t1` |
| ● | `f4:lnd_t1_aa` | **Pfeife** / Pipe | Mobile Flugabwehr / Mobile AA | T1 Mobile Anti-Air Gun (`XSL0104`) | MS7 | 55 / 275 / 220 | 315 | 3,4 / 90° | 1×1 / s1 | 20 | Grundhalle: R | `land_aa_t1` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `lnd_t1_scout` | `wpn_whistle_fork_t1` Kurzgabel (Schnellfeuer): 4 / 0,3 s = **13,3 DPS**, RW 18, linear | 0,666 (0,666) | ±0 % | 1,8 (1,75) | +2,9 % | +2,9 % |
| `lnd_t1_tank` | `wpn_fork_t1` Gabelton: 33 / 1,3 s = **25,4 DPS**, RW 18, linear | 0,47 (0,456) | +3,1 % | 5,278 (5,185) | +1,8 % | +4,9 % |
| `lnd_t1_arty` | `wpn_horn_t1` Streuklang: 44 / 2,8 s = **15,7 DPS**, RW 8–30, ballistisch, Splash 1,6<br>Pulk-DPS/Mass 1,008 (FA 0,935): +7,8 % | 0,291 (0,298) | −2,2 % | 3,333 (3,148) | +5,9 % | +3,5 % |
| `lnd_t1_aa` | `wpn_pipe_aa_t1` Orgel-Staccato (2 Pfeifen): 2×7 / 0,5 s = **28 DPS**, RW 32, linear (Vorhalt) [Luft] | 0,509 (0,473) | +7,7 % | 5,727 (5,636) | +1,6 % | +9,4 % |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `lnd_t1_scout` | LAND MOBILE SCOUT INTELLIGENCE DIRECTFIRE TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Hybrid (A1): Späher und Raider in einem Blueprint, ersetzt Späher + leichten Sturmläufer. Hotbuild A und S (beide T1-Rollen). Icon land_bot_t1 (Gefahr vor Funktion, faction.md §6.2).<br>**⚑ I5:** Tarnung im Stand (unsichtbar für Radar und Sicht), Unterhalt 1 E/s (ohne Feature: kein Tarnen, kein Unterhalt) | Kleinster Kiel, hoher dünner Mast ≥ 1,0 × Kiellänge, kurze waagerechte Gabel (Primär Direktfeuer ≥ 1,5 × Mast-Ø); Kamm niedriger als der Mast, kein Reif.<br>keel [amber], lens(schwebespalt), fin(kamm) [team], mast(horchmast), fork(kurze gabel) ⟳yaw — 5 Parts, 1 anim., ≈ 164 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | erste Fabrik-Einheit im Opening (MS6, übernimmt die LAB-Rolle); U4 abgenommen MS7; Radar-Feld ab MS10 (I3) |
| `lnd_t1_tank` | LAND MOBILE DIRECTFIRE TANK TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Linienhalter nach Vorbild-Relation. HP 285 hält die Breakpoints: 3 Kantor-, 6 Gabel-I-, 7 Horn-, 2 Heuler-, 9 Triller-Treffer. | Schlanker Kiel 0,9 × 0,5 × 1,4 WU, 0,25 WU über dem Boden; waagerechte Gabel (Zinken Ø 0,17, Länge 0,9 WU ≈ 65 % der Kiellänge) über die Kielspitze; Kamm 0,8 WU hoch, 1 Tonpunkt.<br>keel [amber], lens(schwebespalt), fork ⟳yaw, fin(kamm) [team], fin(glyphenfeld) [team] — 5 Parts, 1 anim., ≈ 156 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | erste Kampfeinheit (Konsole, MS5), Fabrik ab MS6 |
| `lnd_t1_arty` | LAND MOBILE INDIRECTFIRE ARTILLERY TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | A2: wenig Schaden pro Treffer, großer Splash, teuer und fragil. Räumt Engineers (3 Treffer) und Pulks, bricht keine Linie (Triller 7 Treffer). Einschläge hinterlassen ≈ 3 s einen blauen Klangring (nur View). | Kiel mit großem offenem Trichter (Öffnung Ø 0,6 WU, 50° geneigt) auf Schwenkfuß, Kamm als Gegengewicht weit nach hinten; keine Gabel.<br>keel [amber], lens(schwebespalt), ring(schwenkfuss) ⟳yaw, horn ⟳pitch [team], fin(kamm gegengewicht) [team] — 5 Parts, 2 anim., ≈ 180 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | K2 Ballistik in MS7 |
| `lnd_t1_aa` | LAND MOBILE ANTIAIR TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Nur Luftziele. | Kiel mit teamfarbener Kamm-Platte, darauf 2 senkrechte Pfeifen (≥ 75°) mit gestufter Länge quer zur Fahrtrichtung.<br>keel [amber], lens(schwebespalt), fin(pfeifenplatte) ⟳yaw [team], pipe(senkrecht lang), pipe(senkrecht kurz), fin(kamm) [team] — 6 Parts, 1 anim., ≈ 156 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | U4 in MS7, Wirkung gegen Luft MS12 |

---

## 6. Landarmee T2

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f4:lnd_t2_tank` | **Heuler** / Howler | Stoßgleiter / Strike Glider | T2 Hover Tank (`XSL0203`) | MS8 | 220 / 1.300 / 1.050 | 1.400 | 4 / 90° | 1×1 / s2 | 20 | Grundhalle: Q | `land_direct_t2` |
| ● | `f4:lnd_t2_bot` | **Brüller** / Roarer | Sturmläufer / Assault Walker | T2 Assault Bot (`XSL0202`) | MS8 | 360 / 1.800 / 1.600 | 2.550 | 2,6 / 90° | 1×1 / s2 | 24 | Grundhalle: S | `land_bot_t2` |
| ● | `f4:lnd_t2_mml` | **Posaune** / Trombone | Raketenwerfer / Missile Launcher | T2 Mobile Missile Launcher (`XSL0111`) | MS8 | 180 / 1.300 / 800 | 820 | 2,9 / 90° | 1×1 / s2 | 18 | Grundhalle: W | `land_mml_t2` |
| ● | `f4:lnd_t2_aa` | **Bordun** / Bourdon | Flak / Flak | T2 Mobile AA Flak Artillery (`XSL0205`) | MS8 | 160 / 800 / 800 | 1.050 | 2,7 / 120° | 1×1 / s2 | 20 | Grundhalle: R | `land_aa_t2` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `lnd_t2_tank` | `wpn_fork_t2_charged` Stoßton (schwerer Einzelschuss): 210 / 3,5 s = **60 DPS**, RW 20, linear | 0,273 (0,276) | −1 % | 6,364 (6,136) | +3,7 % | +2,7 % |
| `lnd_t2_bot` | `wpn_fork_t2_rapid` Breitgabel (Dauerfeuer): 37 / 0,3 s = **123,3 DPS**, RW 26, linear | 0,343 (0,324) | +5,7 % | 7,083 (6,944) | +2 % | +7,8 % |
| `lnd_t2_mml` | `wpn_spindle_t2` Stoßton-Rakete (Einzelgeschoss): 400 / 6 s = **66,7 DPS**, RW 10–64, homing (Wenderate, K11), Splash 0,5<br>Pulk-DPS/Mass 0,291 (FA 0,294): −1,2 % | 0,37 (0,375) | −1,2 % | 4,556 (4,444) | +2,5 % | +1,2 % |
| `lnd_t2_aa` | `wpn_pipe_flak_t2` Bordunflak: 70 / 0,5 s = **140 DPS**, RW 40, linear + Näherungszünder (MS12), Splash 4 [Luft] | 0,875 (0,9) | −2,8 % | 6,562 (6,25) | +5 % | +2,1 % |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `lnd_t2_tank` | LAND MOBILE DIRECTFIRE TANK TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | A3: schnell, ein schwerer Schuss (Alpha): Triller in 2, Chorist und Pfiff in 1 Schuss. Schwach gegen Masse (Overkill).<br>**⚑ M13:** echtes Schweben über Wasser (Hover) (ohne Feature: normale LAND-Einheit; Gleiter-Look ist reine Optik) | Triller ×1,3, längere Gabelzinken mit Linse (Ladekammer) dazwischen, Kamm +30 %, 2 Tonpunkte.<br>keel [amber], lens(schwebespalt), fork ⟳yaw, lens(ladekammer), fin(kamm) [team], fin(glyphenfeld) [team] — 6 Parts, 1 anim., ≈ 192 Tris · Maßstab 1,3 · 2 Tonpunkte (Perlglas) | U6 in MS8 |
| `lnd_t2_bot` | LAND MOBILE DIRECTFIRE BOT TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | A3: schwerer, langsamer Linienanker (Mass 360, HP 2.550: der zäheste T2-Körper beider Fraktionen). RW 26 = Gabel I, hält Stellungen auf Augenhöhe. | Dreibein mit Kiel-Torso, breite Gabel (Zinkenabstand ≥ 0,5 × Rumpfbreite), Kamm nach hinten ≥ 1,0 × Rumpflänge, 2 Tonpunkte; kein Trichter, keine Pfeifen.<br>legs, keel(torso) ⟳yaw [amber], fork(breite gabel) ⟳pitch, fin(kamm) [team], fin(glyphenfeld) [team] — 5 Parts, 2 anim., ≈ 180 Tris · Maßstab 1,3 · 2 Tonpunkte (Perlglas) | U6 in MS8 (Linienanker der Fraktion, ● statt Nachzügler) |
| `lnd_t2_mml` | LAND MOBILE INDIRECTFIRE ARTILLERY SILO TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | A4: eine schwere Lenkrakete statt 2er-Salve, RW 64 (Varkan-Rinne 60). Gabel II fällt nach 6 Raketen wie im Vorbild. | Kiel mit einer dicken Spindel (Ø ≥ 2 × Pfeifen-Ø), 50° geneigt, auf Schwenkfuß; ≥ 25° flacher als die Pfeifen, kein Trichter.<br>keel [amber], lens(schwebespalt), ring(schwenkfuss) ⟳yaw, spindle ⟳pitch, fin(kamm) [team], fin(glyphenfeld) [team] — 6 Parts, 2 anim., ≈ 188 Tris · Maßstab 1,3 · 2 Tonpunkte (Perlglas) | U6 inkl. MML über K11 in MS8 |
| `lnd_t2_aa` | LAND MOBILE ANTIAIR TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | Nur Luftziele, Splash trifft Pulks. | Pfeife ×1,3 mit 3 gestuften senkrechten Pfeifen, 2 Tonpunkte.<br>keel [amber], lens(schwebespalt), fin(pfeifenplatte) ⟳yaw [team], pipe, pipe, pipe, fin(kamm) [team] — 7 Parts, 1 anim., ≈ 176 Tris · Maßstab 1,3 · 2 Tonpunkte (Perlglas) | U6 in MS8, Wirkung/Näherungszünder MS12 |

---

## 7. Landarmee T3

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ○ | `f4:lnd_t3_tank` | **Grollen** / Rumble | Belagerungsgleiter / Siege Glider | T3 Siege Tank (Referenz-DPS ohne Torpedo) (`XSL0303`) | MS13 | 840 / 9.500 / 3.600 | 4.800 | 2,8 / 90° | 2×2 / s2 | 22 | Grundhalle: Q | `land_direct_t3` |
| ○ | `f4:lnd_t3_arty` | **Heerhorn** / Warhorn | Schwere Artillerie / Heavy Artillery | T3 Mobile Heavy Artillery (`XSL0304`) | MS13 | 800 / 8.000 / 4.300 | 950 | 2,2 / 75° | 2×2 / s2 | 26 | Grundhalle: W | `land_arty_t3` |
| ○ | `f4:lnd_t3_sniper` | **Diskant** / Descant | Präzisionsläufer / Sniper Walker | T3 Sniper Bot (Referenz-DPS = schneller Modus; Modi schließen sich aus) (`XSL0305`) | MS13 | 780 / 26.000 / 5.400 | 720 | 2,2 / 90° | 1×1 / s1 | 26 | Grundhalle: F | `land_sniper_t3` |
| ○ | `f4:lnd_t3_aa` | **Zimbel** / Cymbal | Entladungsgleiter / Discharge Glider (AA) | T3 Mobile AA, Luft + Boden (FAF-Einheit) (`DSLK004`) | MS13 | 720 / 9.000 / 3.600 | 1.850 | 3,4 / 75° | 2×2 / s2 | 26 | Grundhalle: R | `land_aa_t3` |
| ○ | `f4:lnd_t3_shield` | **Stille** / Hush | Großschild / Heavy Mobile Shield | T3 Mobile Shield Generator (`XSL0307`) | MS13 | 720 / 6.200 / 3.600 | 450 | 3,8 / 150° | 2×2 / s2 | 20 | Grundhalle: D | `land_shield_t3` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `lnd_t3_tank` | `wpn_fork_t3` Gabelton, schwer (beide Zinken): 2×66 / 0,5 s = **264 DPS**, RW 22, linear<br>`wpn_horn_t3_small` Kleiner Trichter (Stoßklang): 600 / 4 s = **150 DPS**, RW 28, ballistisch (flach), Splash 1,2 | 0,493 (0,491) | +0,4 % | 5,714 (5,595) | +2,1 % | +2,6 % |
| `lnd_t3_arty` | `wpn_horn_t3` Heerstoß: 720 / 10 s = **72 DPS**, RW 25–88, ballistisch, Splash 4,8<br>Pulk-DPS/Mass 1,986 (FA 2,079): −4,5 % | 0,09 (0,087) | +2,9 % | 1,188 (1,156) | +2,7 % | +5,6 % |
| `lnd_t3_sniper` | `wpn_descant_fast_t3` Diskantgabel (schneller Modus): 600 / 4 s = **150 DPS**, RW 55, linear (schnell)<br>`wpn_descant_heavy_t3` Diskantgabel (schwerer Modus): 1.900 / 14,5 s = **131 DPS**, RW 65, linear (schnell) | 0,192 (0,196) | −1,7 % | 0,923 (0,897) | +2,9 % | +1,1 % |
| `lnd_t3_aa` | `wpn_discharge_aa_t3` Entladung (Luft): 210 / 0,9 s = **233,3 DPS**, RW 58, Entladungsbogen (Hitscan-Puls), Splash 1 [Luft]<br>`wpn_discharge_ground_t3` Entladung (Boden): 3×70 / 4 s = **52,5 DPS**, RW 28, Entladungsbogen (Hitscan-Puls), Splash 1 | 0,397 (0,411) | −3,5 % | 2,569 (2,5) | +2,8 % | −0,8 % |
| `lnd_t3_shield` | – | – (–) | – | 13,958 (14,444) (inkl. Schild) | −3,4 % | – |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `lnd_t3_tank` | LAND MOBILE DIRECTFIRE INDIRECTFIRE TANK TECH3<br>*von:* `FACTORY & LAND & TECH3` | Hybrid A6: Direkt- und Indirektwaffe in einem Blueprint (ersetzt T3-Bot plus Begleit-Artillerie, spart Unit-Cap U7). Beide Waffen im DPS-Vergleich. Die Referenz hat zwei gleiche Direktwaffen (spooky-db `WeaponNumber` 2, Review R1); die Gabel feuert deshalb beide Zinken (Salve 2). Stärkster T3-Landkörper pro Mass, dafür langsam (2,8) und kurz (RW 22/28): Konter sind Heerhorn/Präzisionsläufer auf Abstand und Bomber.<br>**⚑ M13:** amphibisch (fährt unter Wasser) (ohne Feature: nur Land)<br>**⚑ U18:** Torpedowerfer als Drittwaffe (ohne Feature: entfällt; DPS/Mass auch in der FA-Referenz ohne Torpedo gemessen) | Überlanger Kiel, Gabel mit aufgesetztem kleinem Trichter (Primär Gabel ≥ 1,5 × Trichterlänge), Doppelkamm, 3 Tonpunkte; kein Kristall.<br>keel [amber], lens(schwebespalt), fork ⟳yaw, horn(kleiner trichter) ⟳pitch [team], fin(kamm) [team], fin(doppelkamm) [team] — 6 Parts, 2 anim., ≈ 188 Tris · Maßstab 1,7 · 3 Tonpunkte (Perlglas) | U10 T3-Landarmee in MS13 |
| `lnd_t3_arty` | LAND MOBILE INDIRECTFIRE ARTILLERY TECH3<br>*von:* `FACTORY & LAND & TECH3` | Kein Deploy. | Horn ×1,7 auf überlangem Kiel, Doppelkamm, 3 Tonpunkte; kein Kristall.<br>keel [amber], lens(schwebespalt), ring(schwenkfuss) ⟳yaw, horn ⟳pitch [team], fin(kamm gegengewicht) [team], fin(doppelkamm) [team] — 6 Parts, 2 anim., ≈ 196 Tris · Maßstab 1,7 · 3 Tonpunkte (Perlglas) | U10 in MS13 |
| `lnd_t3_sniper` | LAND MOBILE DIRECTFIRE SNIPER BOT TECH3<br>*von:* `FACTORY & LAND & TECH3` | Toggles: fire_mode (MS13, C17)<br>Hybrid A6: zwei Feuermodi, eine Form. Nur ein Modus aktiv (Toggle), DPS-Vergleich über den schnellen Modus. Schwerer Modus: Heuler 1 Schuss, Brüller 2 Schüsse (FA-Relation). | Schlankes Dreibein, Gabel mit extrem langen, eng stehenden Zinken (≥ 1,2 × Rumpflänge), schmaler Kamm; Maßstab 1,4 (1×1-Deckel), 3 Tonpunkte.<br>legs, keel(torso) ⟳yaw [amber], fork(langgabel) ⟳pitch, fin(kamm) [team], fin(glyphenfeld) [team] — 5 Parts, 2 anim., ≈ 180 Tris · Maßstab 1,4 · 3 Tonpunkte (Perlglas) | U10 in MS13; Modus-Toggle mit C17 |
| `lnd_t3_aa` | LAND MOBILE ANTIAIR DIRECTFIRE TECH3<br>*von:* `FACTORY & LAND & TECH3` | Hybrid A6, Primär Flugabwehr: trifft Luft und (schwächer) Boden; beide Waffen im DPS-Vergleich wie die Referenz. Hitscan-Puls braucht dieselbe K1-Entscheidung wie Gabel II (§19). | Bordun ×1,7 mit 3 dicken Pfeifen und kurzer Gabel davor (Sekundärmerkmal, Pfeifen ≥ 1,5 × Gabellänge), 3 Tonpunkte; kein zweiter Kamm (Superset-Limit).<br>keel [amber], lens(schwebespalt), fin(pfeifenplatte) ⟳yaw [team], pipe, pipe, pipe, fork(kurze gabel) — 7 Parts, 1 anim., ≈ 200 Tris · Maßstab 1,7 · 3 Tonpunkte (Perlglas) | U10 in MS13 |
| `lnd_t3_shield` | LAND MOBILE SHIELD DEFENSE TECH3<br>*von:* `FACTORY & LAND & TECH3` | Toggles: shield (MS13, C17)<br>Schild 9.600 HP, r 20, Regen 130/s ab 3 s nach dem letzten Treffer, Neuaufbau 40 s, 170 E/s<br>A5: kein mobiler T2-Schild, dafür ein großer T3-Schild, der einen ganzen Pulk deckt. Energy-Stall schaltet ab (E3). Vergleich über HP+Schild.<br>**⚑ M13:** echtes Schweben über Wasser (Hover) (ohne Feature: normale LAND-Einheit) | Überlanger Kiel mit Mast, waagerechter Reif (Ø ≥ 1,2 × Rumpfbreite) als höchster Punkt, Doppelkamm, 3 Tonpunkte; keine Gabel, kein Trichter.<br>keel [amber], lens(schwebespalt), mast, ring(waagerecht) ⟳yaw [team], fin(doppelkamm) [team] — 5 Parts, 1 anim., ≈ 172 Tris · Maßstab 1,7 · 3 Tonpunkte (Perlglas) | Rest U6 (mobiler Schild) mit K10 in MS13 – wie Varkan-Schürze |

---

## 8. Luftwaffe T1–T2

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ○ | `f4:air_t1_scout` | **Grille** / Cricket | Aufklärer / Air Scout | T1 Air Scout (`XSA0101`) | MS12 | 40 / 560 / 200 | 34 | 18,5 / 100° | 1×1 / s0 | 42 / R 60 | Himmelshalle: A | `air_intel_t1` |
| ○ | `f4:air_t1_fighter` | **Zikade** / Cicada | Abfangjäger / Interceptor | T1 Interceptor (`XSA0102`) | MS12 | 50 / 2.200 / 500 | 300 | 15 / 120° | 1×1 / s0 | 28 | Himmelshalle: Q | `air_aa_t1` |
| ○ | `f4:air_t1_bomber` | **Maikäfer** / Cockchafer | Bomber / Bomber | T1 Attack Bomber (`XSA0103`) | MS12 | 90 / 2.000 / 500 | 220 | 10 / 80° | 1×1 / s0 | 32 / R 40 | Himmelshalle: W | `air_bomb_t1` |
| ○ | `f4:air_t2_gunship` | **Schwebfliege** / Hoverfly | Kampfschweber / Gunship | T2 Gunship (`XSA0203`) | MS12 | 500 / 9.800 / 3.300 | 1.850 | 11 / 90° | 1×1 / s0 | 32 | Himmelshalle: E | `air_direct_t2` |
| ○ | `f4:air_t2_fbomber` | **Schwärmer** / Hawkmoth | Jagdbomber / Fighter-Bomber | T2 Fighter/Bomber (`XSA0202`) | MS12 | 420 / 8.200 / 2.400 | 1.050 | 15 / 110° | 1×1 / s0 | 32 / R 60 | Himmelshalle: R | `air_fbomb_t2` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `air_t1_scout` | – | – (–) | – | 0,85 (0,8) | +6,2 % | – |
| `air_t1_fighter` | `wpn_cicada_aa_t1` Zirpgeschütz: 3×17 / 1 s = **51 DPS**, RW 25, linear (Vorhalt) [Luft] | 1,02 (1,02) | ±0 % | 6 (5,8) | +3,4 % | +3,4 % |
| `air_t1_bomber` | `wpn_hum_bomb_t1` Summbombe: 240 / 5 s = **48 DPS**, RW 40, ballistisch (Abwurf), Splash 4 | 0,533 (0,556) | −4 % | 2,444 (2,333) | +4,8 % | +0,6 % |
| `air_t2_gunship` | `wpn_hoverfly_fork_t2` Bauchgabel (Doppelstoß beider Zinken): 4×21 / 0,7 s = **120 DPS**, RW 24, linear | 0,24 (0,229) | +5 % | 3,7 (3,6) | +2,8 % | +7,9 % |
| `air_t2_fbomber` | `wpn_hawkmoth_aa_t2` Zirpgeschütz, schwer (beide Gondeln): 6×24 / 1 s = **144 DPS**, RW 30, linear (Vorhalt) [Luft]<br>`wpn_hawkmoth_bomb_t2` Schwere Summbombe: 1.200 / 10 s = **120 DPS**, RW 60, ballistisch (Abwurf), Splash 3 | 0,629 (0,655) | −4 % | 2,5 (2,381) | +5 % | +0,8 % |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `air_t1_scout` | AIR MOBILE SCOUT INTELLIGENCE TECH1<br>*von:* `FACTORY & AIR & (TECH1 \| TECH2)` | Death: `wpn_air_crash_s` 10/r1 (Absturzschaden (K12))<br>Unbewaffnet. | Kleinster Flieger, kurzer Flügel, ein einzelner senkrechter Kamm; keine Waffen-Parts.<br>keel(rumpf) [amber], fin(fluegel) [team], fin(senkrechter kamm) [team] — 3 Parts, 0 anim., ≈ 80 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | U11 Luftwaffe in MS12 |
| `air_t1_fighter` | AIR MOBILE ANTIAIR TECH1<br>*von:* `FACTORY & AIR & (TECH1 \| TECH2)` | Death: `wpn_air_crash_s` 25/r1 (Absturzschaden (K12))<br>Nur Luftziele. | Schmales Pfeilblatt aus zwei Kämmen zu einem spitzen V (lang > breit); keine Fächer, keine Gondeln.<br>keel [amber], fin(pfeilblatt l) [team], fin(pfeilblatt r) [team] — 3 Parts, 0 anim., ≈ 80 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | U11 in MS12 |
| `air_t1_bomber` | AIR MOBILE BOMBER TECH1<br>*von:* `FACTORY & AIR & (TECH1 \| TECH2)` | Death: `wpn_air_crash_m` 100/r1 (Absturzschaden (K12))<br>A10: eine Bombe mit großem Splash, weniger DPS/Mass als die Varkan-Dohle. | Breiter Fächer (Deckflügel-Muschel von oben, breit ≥ lang) mit Bauch-Linse; keine Pfeilung, keine Gabel.<br>lens(bauchlinse) [amber], shell(faecher) [team], fin(leitkamm) — 3 Parts, 0 anim., ≈ 88 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | U11 in MS12 (Bomber-FSM) |
| `air_t2_gunship` | AIR MOBILE GUNSHIP DIRECTFIRE TECH2<br>*von:* `FACTORY & AIR & TECH2` | Death: `wpn_air_crash_m` 100/r1 (Absturzschaden (K12))<br>A10: teuer und zäh (Mass 500 statt 200 beim Varkan-Gunship). Referenz mit beiden Bordwaffen gezählt (spooky-db `WeaponNumber` 2, Review R1). Kein Transport (U13 Post-MVP). | Keine Flügel: Kiel mit zwei senkrechten Reifen seitlich, Gabel unten.<br>keel(oberschale) [team], ring(antrieb l) ⟳yaw, ring(antrieb r), fork(gabel unten) ⟳yaw — 4 Parts, 2 anim., ≈ 184 Tris · Maßstab 1,3 · 2 Tonpunkte (Perlglas) | U11 in MS12 (Orbit) |
| `air_t2_fbomber` | AIR MOBILE BOMBER ANTIAIR TECH2<br>*von:* `FACTORY & AIR & TECH2` | Death: `wpn_air_crash_l` 200/r1 (Absturzschaden (K12))<br>A10: eine schwere Einzelbombe. Beide Waffen addiert im DPS-Vergleich (wie Referenz); Luftwaffe aus beiden Gondeln (Referenz `WeaponNumber` 2, Review R1). | Pfeilblatt mit zwei Linsen-Gondeln an den Spitzen, Spannweite +30 % gegenüber Zikade; keine Reifen.<br>keel [amber], fin(pfeilblatt l) [team], fin(pfeilblatt r) [team], lens(gondel l), lens(gondel r) — 5 Parts, 0 anim., ≈ 152 Tris · Maßstab 1,3 · 2 Tonpunkte (Perlglas) | U11 in MS12 |

---

## 9. Wirtschaft

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f4:str_t1_mex` | **Stimmstock I** / Soundpost I | Massebohrung / Mass Extractor | T1 Mass Extractor (`XSB1103`) | MS4 | 36 / 360 / 60 | 400 | – | 2×2 | – | Bau: Q | `struct_mass_t1` |
| ● | `f4:str_t2_mex` | **Stimmstock II** / Soundpost II | Massebohrung / Mass Extractor | T2 Mass Extractor (Upgrade-Kosten) (`XSB1202`) | MS8 | 900 / 5.400 / 900 | 2.000 | – | 2×2 | 20 | Bau: Q (Upgrade: Command Card) | `struct_mass_t2` |
| ○ | `f4:str_t3_mex` | **Stimmstock III** / Soundpost III | Massebohrung / Mass Extractor | T3 Mass Extractor (Upgrade-Kosten) (`XSB1302`) | MS13 | 4.500 / 31.000 / 2.900 | 6.900 | – | 2×2 | 20 | Bau: Q (Upgrade: Command Card) | `struct_mass_t3` |
| ● | `f4:str_t1_pgen` | **Resonator I** / Resonator I | Kraftwerk / Power Generator | T1 Power Generator (`XSB1101`) | MS4 | 75 / 750 / 125 | 570 | – | 2×2 | – | Bau: W | `struct_energy_t1` |
| ● | `f4:str_t2_pgen` | **Resonator II** / Resonator II | Kraftwerk / Power Generator | T2 Power Generator (`XSB1201`) | MS8 | 1.200 / 12.000 / 2.200 | 2.350 | – | 6×6 | 20 | Bau: W | `struct_energy_t2` |
| ○ | `f4:str_t3_pgen` | **Resonator III** / Resonator III | Kraftwerk / Power Generator | T3 Power Generator (`XSB1301`) | MS13 | 3.200 / 57.000 / 6.800 | 7.100 | – | 8×8 | 20 | Bau: W | `struct_energy_t3` |
| ● | `f4:str_t1_hydro` | **Äolsharfe** / Aeolian Harp | Dampfkraftwerk / Geothermal Plant | T1 Hydrocarbon Power Plant (`XSB1102`) | MS10 | 160 / 800 / 400 | 1.750 | – | 6×6 | – | Bau: E | `struct_hydro_t1` |
| ● | `f4:str_t1_mstore` | **Bernsteinkammer** / Amber Vault | Massespeicher / Mass Storage | T1 Mass Storage (`XSB1106`) | MS10 | 200 / 1.500 / 250 | 720 | – | 2×2 | – | Bau: R | `struct_mstore_t1` |
| ● | `f4:str_t1_estore` | **Lichtkammer** / Light Vault | Energiespeicher / Energy Storage | T1 Energy Storage (`XSB1105`) | MS6 | 250 / 1.200 / 200 | 520 | – | 2×2 | – | Bau: T | `struct_estore_t1` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `str_t1_mex` | – | – (–) | – | 11,111 (10,556) | +5,3 % | – |
| `str_t2_mex` | – | – (–) | – | 2,222 (2,167) | +2,6 % | – |
| `str_t3_mex` | – | – (–) | – | 1,533 (1,467) | +4,5 % | – |
| `str_t1_pgen` | – | – (–) | – | 7,6 (7,333) | +3,6 % | – |
| `str_t2_pgen` | – | – (–) | – | 1,958 (2) | −2,1 % | – |
| `str_t3_pgen` | – | – (–) | – | 2,219 (2,16) | +2,7 % | – |
| `str_t1_hydro` | – | – (–) | – | 10,938 (10,625) | +2,9 % | – |
| `str_t1_mstore` | – | – (–) | – | 3,6 (3,5) | +2,9 % | – |
| `str_t1_estore` | – | – (–) | – | 2,08 (2) | +4 % | – |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `str_t1_mex` | STRUCTURE ECONOMIC MASSEXTRACTION TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | BP 10 · +2 M/s · −2 E/s<br>upgradesTo `f4:str_t2_mex`<br>Adjacency: Gibt Fabriken −7,5 % Mass-Verbrauch (8×8); erhält +12,5 % je angrenzender Bernsteinkammer.<br>Nur auf Mass-Spots; produziert während des Upgrades weiter (B4). | Niedriger Dreipass-Sockel, Reif um den Spot, zentraler Kristall (pulsiert als gezupfte Saite).<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], ring(reif), crystal(zentralkristall) ⟳tilt [glow] — 5 Parts, 1 anim., ≈ 180 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | E5 in MS4 |
| `str_t2_mex` | STRUCTURE ECONOMIC MASSEXTRACTION TECH2 SIZE4<br>*von:* `ENGINEER & (TECH2 \| TECH3) \| UPGRADE` | BP 15 · +6 M/s · −9 E/s<br>Upgrade von `f4:str_t1_mex`<br>upgradesTo `f4:str_t3_mex`<br>Adjacency: Fabriken −10 % Mass-Verbrauch; +12,5 % je Bernsteinkammer.<br>Kosten = Upgrade-Kosten (FA-Semantik). Auch direkt von Solist/Vorsänger baubar. Fällt mit 1 Fanfare-Schuss (FA-Relation). | Stimmstock mit Höhe ×1,2, 2 Tonpunkte auf dem Sockelrand.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], ring(reif), crystal(zentralkristall) ⟳tilt [glow] — 5 Parts, 1 anim., ≈ 180 Tris · Maßstab xz 1 / y 1,2 · 2 Tonpunkte (Perlglas) | B4 (T1→T2) in MS8 |
| `str_t3_mex` | STRUCTURE ECONOMIC MASSEXTRACTION TECH3 SIZE4<br>*von:* `ENGINEER & TECH3 \| UPGRADE` | +18 M/s · −54 E/s<br>Upgrade von `f4:str_t2_mex`<br>Adjacency: Fabriken −12,5 % Mass-Verbrauch; +12,5 % je Bernsteinkammer.<br>Upgrade-Kosten. | Stimmstock mit doppeltem Reif, Höhe ×1,4, 3 Tonpunkte; keine Harfenbögen (unterscheidet sich so von der Äolsharfe).<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], ring(reif), ring(zweiter reif), crystal(zentralkristall) ⟳tilt [glow] — 6 Parts, 1 anim., ≈ 228 Tris · Maßstab xz 1 / y 1,4 · 3 Tonpunkte (Perlglas) | Rest B4 (T3-Mex) in MS13 |
| `str_t1_pgen` | STRUCTURE ECONOMIC ENERGYPRODUCTION TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | +20 E/s<br>Adjacency: Fabriken (8×8) −1,56 % Energy-Verbrauch, 2×2-Verbraucher −6,25 %; erhält +25 % Produktion je angrenzender Lichtkammer (SIZE4).<br>Death: `wpn_resonator_burst_t1` 250/r2 (K14, Kettenreaktion-Golden MS10)<br>Frei platzierbar; kein Upgrade (T2/T3 werden neu gebaut, wie FA). | Dreipass-Sockel mit einem stehenden Kristall (Zahl der Kristalle = Tech, Höhe ≥ 1,5 × Sockel-Ø); keine Pfeifen.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], crystal(stehender kristall) [glow] — 4 Parts, 0 anim., ≈ 132 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | E6 in MS4 |
| `str_t2_pgen` | STRUCTURE ECONOMIC ENERGYPRODUCTION TECH2 SIZE12<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | +500 E/s<br>Adjacency: Fabriken −12,5 % Energy-Verbrauch; erhält +8,3 % Produktion je angrenzender Lichtkammer (SIZE12).<br>Death: `wpn_resonator_burst_t2` 1.500/r5 (K14)<br>Fällt mit 1 Fanfare-Schuss (FA-Relation: HP = Schaden der T2-Artillerie). | Resonator auf 6×6 (Maßstab 3,0, Höhe ×1,2) mit 2 Kristallen, 2 Tonpunkte.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], crystal [glow], crystal [glow] — 5 Parts, 0 anim., ≈ 156 Tris · Maßstab xz 3 / y 3,6 · 2 Tonpunkte (Perlglas) | E6-Tech-Leiter mit T2-Engineer (MS8); KI-Tech bis T2 in MS9 |
| `str_t3_pgen` | STRUCTURE ECONOMIC ENERGYPRODUCTION TECH3 SIZE16<br>*von:* `ENGINEER & TECH3` | +2.500 E/s<br>Adjacency: Fabriken −15,6 % Energy-Verbrauch; erhält +6,25 % Produktion je angrenzender Lichtkammer (SIZE16).<br>Death: `wpn_resonator_burst_t3` 5.500/r10 (K14, FA-Relation 1:1) | Resonator auf 8×8 (Maßstab 4,0, Höhe ×1,4) mit 3 Kristallen, 3 Tonpunkte.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], crystal [glow], crystal [glow], crystal [glow] — 6 Parts, 0 anim., ≈ 180 Tris · Maßstab xz 4 / y 5,6 · 3 Tonpunkte (Perlglas) | T3-Pgen-Nachlieferung in MS13 |
| `str_t1_hydro` | STRUCTURE ECONOMIC ENERGYPRODUCTION HYDROCARBON TECH1 SIZE12<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | +100 E/s<br>Adjacency: Wie Resonator II (Fabriken −12,5 % Energy); erhält +8,3 % je angrenzender Lichtkammer (SIZE12).<br>Nur auf Hydro-Spots; keine Death-Weapon (wie FA). | Reif mit drei gebogenen Kämmen (Harfenbogen) um einen Kristall; keine senkrechten Pfeifen.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], ring(reif), fin(harfenbogen), fin(harfenbogen), fin(harfenbogen), crystal(kern) [glow] — 8 Parts, 0 anim., ≈ 228 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | E9 in MS10; als Daten-Vorgriff im MS9-Kern (nur Spot-Regel wie E5) |
| `str_t1_mstore` | STRUCTURE ECONOMIC MASSSTORAGE TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | Speicher 500 M<br>Adjacency: +12,5 % Produktion je angrenzendem Stimmstock (FA-Relation, max. 4 Seiten = +50 %).<br>Keine Death-Weapon. | Flaches Sechseckprisma aus Bernstein (Kristall-Primitiv mit Spitzenhöhe 0, Parameter im Platzhalter), Mass = eckig; keine Spitze, kein Leuchten.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], crystal(sechseckblock ohne spitze) [amber] — 4 Parts, 0 anim., ≈ 132 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | E10 in MS10; Daten-Vorgriff im MS9-Kern (E4-Speicherlimit existiert ab MS4) |
| `str_t1_estore` | STRUCTURE ECONOMIC ENERGYSTORAGE TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | Speicher 10.000 E<br>Adjacency: Bufft alle angrenzenden Energieproduzenten (FA-Relation): Resonator I +25 % (SIZE4), Resonator II und Äolsharfe +8,3 % (SIZE12), Resonator III +6,25 % (SIZE16).<br>Death: `wpn_lightvault_burst` 1.000/r5 (K14) | Zwei gestapelte flache Linsen (Energy = rund), dazwischen eine leuchtende Fuge; keine stehenden Kristalle.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], lens(stapel unten) [amber], lens(stapel oben) [amber], ring(leuchtfuge) [glow] — 6 Parts, 0 anim., ≈ 228 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | Aufschrei (U8, MS6) feuert erst ab 7500 E Vorrat (> Grundspeicher 3900 E) ⇒ Daten-Vorgriff ab MS6; E10-Abnahme MS10 |

---

## 10. Hallen

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f4:str_t1_fac_land` | **Grundhalle I** / Ground Hall I | Landfabrik / Land Factory | T1 Land Factory (`XSB0101`) | MS6 | 240 / 2.100 / 300 | 3.600 | – | 8×8 | 20 | Bau: A | `struct_fac_land_t1` |
| ● | `f4:str_t2_fac_land` | **Grundhalle II** / Ground Hall II | Landfabrik / Land Factory | T2 Land Factory HQ (Upgrade-Kosten) (`XSB0201`) | MS8 | 1.400 / 11.000 / 2.300 | 7.200 | – | 8×8 | 20 | Bau: Upgrade (Command Card) | `struct_fac_land_t2` |
| ○ | `f4:str_t3_fac_land` | **Grundhalle III** / Ground Hall III | Landfabrik / Land Factory | T3 Land Factory HQ (Upgrade-Kosten) (`XSB0301`) | MS13 | 5.200 / 47.000 / 12.000 | 14.500 | – | 8×8 | 20 | Bau: Upgrade (Command Card) | `struct_fac_land_t3` |
| ○ | `f4:str_t1_fac_air` | **Himmelshalle I** / Sky Hall I | Luftfabrik / Air Factory | T1 Air Factory (`XSB0102`) | MS12 | 210 / 2.400 / 300 | 3.600 | – | 8×8 | 20 | Bau: S | `struct_fac_air_t1` |
| ○ | `f4:str_t2_fac_air` | **Himmelshalle II** / Sky Hall II | Luftfabrik / Air Factory | T2 Air Factory HQ (Upgrade-Kosten) (`XSB0202`) | MS12 | 920 / 17.500 / 2.300 | 7.200 | – | 8×8 | 20 | Bau: Upgrade (Command Card) | `struct_fac_air_t2` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `str_t1_fac_land` | – | – (–) | – | 15 (14,583) | +2,9 % | – |
| `str_t2_fac_land` | – | – (–) | – | 5,143 (4,965) | +3,6 % | – |
| `str_t3_fac_land` | – | – (–) | – | 2,788 (2,682) | +4 % | – |
| `str_t1_fac_air` | – | – (–) | – | 17,143 (16,667) | +2,9 % | – |
| `str_t2_fac_air` | – | – (–) | – | 7,826 (7,609) | +2,9 % | – |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `str_t1_fac_land` | STRUCTURE FACTORY LAND TECH1 SIZE16<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | BP 20 · Speicher 80 M<br>upgradesTo `f4:str_t2_fac_land`<br>Adjacency: Empfängt Adjacency von Stimmstöcken (Mass) und Resonatoren (Energy).<br>Queue/Repeat/Rally (B3). Upgrade-Verb „Einstimmen“. | Apsis (halb offene Muschel, offene Seite = Ausgang) mit Kamm-Rampe, Kristall über dem Scheitel.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], shell(apsis) [team], crystal(scheitelkristall) [glow], fin(kamm rampe) [team] — 6 Parts, 0 anim., ≈ 184 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | B3 in MS6 |
| `str_t2_fac_land` | STRUCTURE FACTORY LAND TECH2 SIZE16<br>*von:* `UPGRADE` | BP 40 · Speicher 160 M<br>Upgrade von `f4:str_t1_fac_land`<br>upgradesTo `f4:str_t3_fac_land`<br>Adjacency: Empfängt Adjacency von Stimmstöcken (Mass) und Resonatoren (Energy).<br>Nur per Upgrade (kein HQ/Support-System, B9 Post-MVP). | Grundhalle Höhe ×1,2 mit zweitem Scheitelkristall, 2 Tonpunkte.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], shell(apsis) [team], crystal(scheitelkristall) [glow], fin(kamm rampe) [team], crystal(zweiter kristall) [glow] — 7 Parts, 0 anim., ≈ 208 Tris · Maßstab xz 1 / y 1,2 · 2 Tonpunkte (Perlglas) | U5 in MS8 |
| `str_t3_fac_land` | STRUCTURE FACTORY LAND TECH3 SIZE16<br>*von:* `UPGRADE` | BP 90 · Speicher 320 M<br>Upgrade von `f4:str_t2_fac_land`<br>Adjacency: Empfängt Adjacency von Stimmstöcken (Mass) und Resonatoren (Energy).<br>Nur per Upgrade. | Grundhalle Höhe ×1,4 mit drei Scheitelkristallen, 3 Tonpunkte (8 Parts).<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], shell(apsis) [team], crystal(scheitelkristall) [glow], fin(kamm rampe) [team], crystal(zweiter kristall) [glow], crystal(dritter kristall) [glow] — 8 Parts, 0 anim., ≈ 232 Tris · Maßstab xz 1 / y 1,4 · 3 Tonpunkte (Perlglas) | U5 T3 / U10 in MS13 |
| `str_t1_fac_air` | STRUCTURE FACTORY AIR TECH1 SIZE16<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | BP 20 · Speicher 80 M<br>upgradesTo `f4:str_t2_fac_air`<br>Adjacency: Empfängt Adjacency von Stimmstöcken (Mass) und Resonatoren (Energy).<br>Baut keine Engineers (wie FA). | Apsis mit Landereif statt Kamm-Rampe (teilt das Visual mit der Grundhalle, Tech-Bitmaske + Rollenbit).<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], shell(apsis) [team], crystal(scheitelkristall) [glow], ring(landereif) — 6 Parts, 0 anim., ≈ 216 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | Luftfabrik T1→T2 in MS12 |
| `str_t2_fac_air` | STRUCTURE FACTORY AIR TECH2 SIZE16<br>*von:* `UPGRADE` | BP 40 · Speicher 160 M<br>Upgrade von `f4:str_t1_fac_air`<br>Adjacency: Empfängt Adjacency von Stimmstöcken (Mass) und Resonatoren (Energy).<br>Nur per Upgrade; keine T3-Himmelshalle (U12 Post-MVP). | Himmelshalle Höhe ×1,2 mit zweitem Scheitelkristall, 2 Tonpunkte.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], shell(apsis) [team], crystal(scheitelkristall) [glow], ring(landereif), crystal(zweiter kristall) [glow] — 7 Parts, 0 anim., ≈ 240 Tris · Maßstab xz 1 / y 1,2 · 2 Tonpunkte (Perlglas) | MS12 |

---

## 11. Verteidigung

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f4:str_t1_pd` | **Gabel I** / Fork I | Punktverteidigung / Point Defense | T1 Point Defense (`XSB2101`) | MS8 | 250 / 2.000 / 250 | 1.320 | – | 1×1 | 24 | Bau: Z | `struct_direct_t1` |
| ● | `f4:str_t2_pd` | **Gabel II** / Fork II | Strahlverteidigung / Beam Defense | T2 Point Defense (Beam) (`XSB2301`) | MS8 | 540 / 3.700 / 680 | 2.200 | – | 2×2 | 28 | Bau: Z | `struct_direct_t2` |
| ● | `f4:str_t1_aa` | **Pfeifenwerk I** / Pipework I | Flugabwehrturm / AA Tower | T1 Anti-Air Turret (`XSB2104`) | MS8 | 150 / 1.500 / 190 | 810 | – | 1×1 | 24 | Bau: X | `struct_aa_t1` |
| ● | `f4:str_t2_aa` | **Pfeifenwerk II** / Pipework II | Flakturm / Flak Tower | T2 Anti-Air Flak Artillery (`XSB2204`) | MS8 | 400 / 4.000 / 540 | 2.600 | – | 2×2 | 24 | Bau: X | `struct_aa_t2` |
| ● | `f4:str_t3_sam` | **Hochorgel** / Grand Organ | Raketenabwehr / SAM Site | T3 Anti-Air SAM Launcher (`XSB2304`) | MS8 | 800 / 8.000 / 1.400 | 5.100 | – | 2×2 | 28 | Bau: X | `struct_sam_t3` |
| ● | `f4:str_t1_wall` | **Grat** / Ridge | Mauer / Wall | Wall Section (`XSB5101`) | MS8 | 3 / 20 / 15 | 520 | – | 1×1 | 0 | Bau: C | `wall` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `str_t1_pd` | `wpn_fork_pd_t1` Gabelton (Stellung): 52 / 0,3 s = **173,3 DPS**, RW 26, linear | 0,693 (0,667) | +4 % | 5,28 (5,2) | +1,5 % | +5,6 % |
| `str_t2_pd` | `wpn_beam_t2` Schwebung (Dauerstrahl): 12×50 / 4 s = **150 DPS**, RW 50, Strahl: Hitscan-Puls alle 0,1 s (12 Pulse = 1,2 s Strahl) | 0,278 (0,28) | −0,8 % | 4,074 (3,889) | +4,8 % | +3,9 % |
| `str_t1_aa` | `wpn_pipework_aa_t1` Orgel-Staccato (3 Pfeifen): 3×7 / 0,3 s = **70 DPS**, RW 44, linear (Vorhalt) [Luft] | 0,467 (0,445) | +5 % | 5,4 (5,333) | +1,3 % | +6,3 % |
| `str_t2_aa` | `wpn_pipework_flak_t2` Bordunflak (Stellung): 2×48 / 0,7 s = **137,1 DPS**, RW 44, linear + Näherungszünder (MS12), Splash 4 [Luft] | 0,343 (0,357) | −4 % | 6,5 (6,3) | +3,2 % | −1 % |
| `str_t3_sam` | `wpn_grand_organ_t3` Stoßton-Flugabwehr (2er): 2×580 / 3,4 s = **341,2 DPS**, RW 60, homing + Näherungszünder, Splash 1,5 [Luft] | 0,426 (0,429) | −0,5 % | 6,375 (6,25) | +2 % | +1,5 % |
| `str_t1_wall` | – | – (–) | – | 173,333 (166,667) | +4 % | – |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `str_t1_pd` | STRUCTURE DEFENSE DIRECTFIRE TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | Dieselbe Gabel wie der Triller, auf Dreipass-Sockel. | Dreipass-Sockel mit waagerechter Gabel.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], fork ⟳yaw — 4 Parts, 1 anim., ≈ 148 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | B5 in MS8; Minimal-A8 der KI in MS9 |
| `str_t2_pd` | STRUCTURE DEFENSE DIRECTFIRE TECH2 SIZE4<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | Kein Upgrade von Gabel I (wie FA). RW 50 statt 48 (Varkan-Riegel II), kein Splash. | Gabel ×2 (2×2) mit Linse zwischen den Zinken (Strahl), 2 Tonpunkte.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], fork ⟳yaw, lens(strahllinse) — 5 Parts, 1 anim., ≈ 184 Tris · Maßstab xz 2 / y 2,4 · 2 Tonpunkte (Perlglas) | B5 (T2) in MS8; Strahl-Modell (K1) muss vorher entschieden sein |
| `str_t1_aa` | STRUCTURE DEFENSE ANTIAIR TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | Nur Luftziele. | Dreipass-Sockel mit teamfarbener Kamm-Platte und 2 gestuften senkrechten Pfeifen.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], fin(pfeifenplatte) ⟳yaw [team], pipe, pipe — 6 Parts, 1 anim., ≈ 164 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | B5 in MS8, Wirkung MS12 |
| `str_t2_aa` | STRUCTURE DEFENSE ANTIAIR TECH2 SIZE4<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | Nur Luftziele. | Pfeifenwerk auf 2×2 mit 3 Pfeifen, 2 Tonpunkte.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], fin(pfeifenplatte) ⟳yaw [team], pipe, pipe, pipe — 7 Parts, 1 anim., ≈ 184 Tris · Maßstab xz 2 / y 2,4 · 2 Tonpunkte (Perlglas) | B5 (T2) in MS8, Näherungszünder MS12 |
| `str_t3_sam` | STRUCTURE DEFENSE ANTIAIR TECH3 SIZE4<br>*von:* `ENGINEER & TECH3` | Nur Luftziele. Wenige, sehr schwere Treffer (Schwebfliege 2, Schwärmer 1 Salve). | Dreipass-Sockel mit teamfarbener Platte und 4 senkrechten Spindeln (doppelt so viele wie Pfeifenwerk I), 3 Tonpunkte.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], fin(platte) ⟳yaw [team], spindle(senkrecht), spindle(senkrecht), spindle(senkrecht), spindle(senkrecht) — 8 Parts, 1 anim., ≈ 220 Tris · Maßstab 1 · 3 Tonpunkte (Perlglas) | MS8 per Konsole/Test-Szenario gespawnt (B5: homing, K11), baubar ab MS13 (Vorsänger) |
| `str_t1_wall` | STRUCTURE DEFENSE WALL TECH1<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | wall-Flag (Drag-Linie), blockiert Schüsse und Pathing. | Niedrige Kette flacher Kämme, nur die Firstkante teamfarben (≈ 10 %).<br>fin(flachkamm), fin(firstkante) [team] — 2 Parts, 0 anim., ≈ 32 Tris · Maßstab 1 · keine Tonpunkte | B5/Minimal-Drag (DECISIONS 3) in MS8 |

---

## 12. Intel und Schilde

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ○ | `f4:str_t1_radar` | **Widerhall I** / Reverb I | Radar / Radar | T1 Radar System (`XSB3101`) | MS10 | 80 / 720 / 80 | 11 | – | 2×2 | 20 / R 116 | Bau: D | `struct_intel_t1` |
| ○ | `f4:str_t2_radar` | **Widerhall II** / Reverb II | Radar / Radar | T2 Radar System (Upgrade-Kosten) (`XSB3201`) | MS10 | 180 / 3.600 / 780 | 52 | – | 2×2 | 24 / R 200 | Bau: Upgrade (Command Card) | `struct_intel_t2` |
| ○ | `f4:str_t3_radar` | **Widerhall III** / Reverb III | Radar / Radar | T3 Omni Sensor Suite (Upgrade-Kosten; hier ohne Omni) (`XSB3104`) | MS13 | 1.200 / 15.000 / 1.200 | 52 | – | 2×2 | 30 / R 300 | Bau: Upgrade (Command Card) | `struct_intel_t3` |
| ○ | `f4:str_t2_shield` | **Dämpfer II** / Damper II | Schildgenerator / Shield Generator | T2 Shield Generator (`XSB4202`) | MS13 | 700 / 7.000 / 1.250 | 420 | – | 6×6 | 20 | Bau: F | `struct_shield_t2` |
| ○ | `f4:str_t3_shield` | **Dämpfer III** / Damper III | Schildgenerator / Shield Generator | T3 Heavy Shield Generator (Upgrade-Kosten) (`XSB4301`) | MS13 | 3.600 / 58.000 / 5.800 | 620 | – | 6×6 | 20 | Bau: Upgrade (Command Card) | `struct_shield_t3` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `str_t1_radar` | – | – (–) | – | 0,138 (0,125) | +10 % | – |
| `str_t2_radar` | – | – (–) | – | 0,289 (0,278) | +4 % | – |
| `str_t3_radar` | – | – (–) | – | 0,043 (0,042) | +4 % | – |
| `str_t2_shield` | – | – (–) | – | 18,6 (19,143) (inkl. Schild) | −2,8 % | – |
| `str_t3_shield` | – | – (–) | – | 5,867 (6) (inkl. Schild) | −2,2 % | – |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `str_t1_radar` | STRUCTURE INTELLIGENCE RADAR TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | BP 13 · −20 E/s<br>upgradesTo `f4:str_t2_radar`<br>Toggles: radar (MS10, C17)<br>Stall schaltet ab (E3). Sehr fragil (FA-Relation). | Hoher dünner Mast mit 35° gekippter Muschel-Schale, rotierend; kein Reif.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], mast, shell(schale 35grad) ⟳yaw — 5 Parts, 1 anim., ≈ 168 Tris · Maßstab 1 · 1 Tonpunkt (Perlglas) | I3 in MS10 |
| `str_t2_radar` | STRUCTURE INTELLIGENCE RADAR TECH2 SIZE4<br>*von:* `UPGRADE` | BP 20 · −150 E/s<br>Upgrade von `f4:str_t1_radar`<br>upgradesTo `f4:str_t3_radar`<br>Toggles: radar (MS10, C17)<br>Nur per Upgrade. | Widerhall Höhe ×1,2 mit Doppelmast, 2 Tonpunkte.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], mast, mast(zweiter mast), shell(schale 35grad) ⟳yaw — 6 Parts, 1 anim., ≈ 192 Tris · Maßstab xz 1 / y 1,2 · 2 Tonpunkte (Perlglas) | I3 T1→T2 in MS10 |
| `str_t3_radar` | STRUCTURE INTELLIGENCE RADAR TECH3 SIZE4<br>*von:* `UPGRADE` | −400 E/s<br>Upgrade von `f4:str_t2_radar`<br>Toggles: radar (MS10, C17)<br>Kein Omni (I4/I5 Post-MVP) ⇒ Kosten und Reichweite gegenüber FA halbiert (wie Varkan-Horcher III), HP/Mass in Relation; Unterhalt 400 E/s statt 2.000.<br>**⚑ I4:** Omni-Sensor (FA-Vorbild: Radar 600 + Omni) (ohne Feature: reines Radar r300) | Widerhall Höhe ×1,4 mit zweiter Schale, 3 Tonpunkte.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], mast, mast(zweiter mast), shell(schale 35grad) ⟳yaw, shell(zweite schale) — 7 Parts, 1 anim., ≈ 228 Tris · Maßstab xz 1 / y 1,4 · 3 Tonpunkte (Perlglas) | Rest I3 (T3-Radar) in MS13 |
| `str_t2_shield` | STRUCTURE SHIELD DEFENSE TECH2 SIZE12<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | BP 20<br>upgradesTo `f4:str_t3_shield`<br>Toggles: shield (MS13, C17)<br>Schild 12.600 HP, r 27, Regen 150/s ab 3 s nach dem letzten Treffer, Neuaufbau 25 s, 240 E/s<br>A8: stärker und teurer als Varkan-Schirm II (Mass 700 statt 600). Kollaps + Wiederaufbau nach rechargeS; Stall schaltet ab. Vergleich über HP+Schild. | Mast mit waagerechtem Reif (Ø ≥ 0,8 × Footprint-Kante); keine Muschel.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], mast, ring(waagerecht) ⟳yaw [team] — 5 Parts, 1 anim., ≈ 180 Tris · Maßstab 1 · 2 Tonpunkte (Perlglas) | K10 in MS13 |
| `str_t3_shield` | STRUCTURE SHIELD DEFENSE TECH3 SIZE12<br>*von:* `UPGRADE` | Upgrade von `f4:str_t2_shield`<br>Toggles: shield (MS13, C17)<br>Schild 20.500 HP, r 44, Regen 165/s ab 3 s nach dem letzten Treffer, Neuaufbau 25 s, 480 E/s<br>Nur per Upgrade. | Dämpfer Höhe ×1,4 mit zweitem Reif, 3 Tonpunkte.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], mast, ring(waagerecht) ⟳yaw [team], ring(zweiter reif) — 6 Parts, 1 anim., ≈ 228 Tris · Maßstab xz 1 / y 1,17 · 3 Tonpunkte (Perlglas) | K10 in MS13 |

---

## 13. Artilleriestellungen

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ○ | `f4:str_t2_arty` | **Fanfare** / Fanfare | Artilleriestellung / Artillery Emplacement | T2 Artillery Installation (`XSB2303`) | MS13 | 2.000 / 14.000 / 1.600 | 2.950 | – | 2×2 | 28 | Bau: V | `struct_arty_t2` |
| ○ | `f4:str_t3_arty` | **Großhorn** / Great Horn | Schwere Artilleriestellung / Heavy Artillery Emplacement | T3 Heavy Artillery Installation (auf MVP-Kartengröße skaliert) (`XSB2302`) | MS13 | 47.000 / 880.000 / 73.000 | 9.000 | – | 8×8 | 28 | Bau: V | `struct_arty_t3` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `str_t2_arty` | `wpn_fanfare_t2` Fanfarenstoß: 2.350 / 20 s = **117,5 DPS**, RW 50–112, ballistisch, Splash 3<br>Pulk-DPS/Mass 0,565 (FA 0,577): −2,1 % | 0,059 (0,06) | −2,1 % | 1,475 (1,425) | +3,5 % | +1,4 % |
| `str_t3_arty` | `wpn_great_horn_t3` Großhornstoß: 4.900 / 15 s = **326,7 DPS**, RW 60–200, ballistisch, Splash 7<br>Pulk-DPS/Mass 0,307 (FA 0,312): −1,6 % | 0,007 (0,007) | −1,6 % | 0,192 (0,191) | +0,4 % | −1,2 % |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `str_t2_arty` | STRUCTURE DEFENSE INDIRECTFIRE ARTILLERY TECH2 SIZE4<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | Ein Schuss tötet Stimmstock II, Resonator II und Gabel I (FA-Relation). Artillerie-Adjacency optional mit E11. | Großer Trichter auf Lafette über dem Dreipass-Sockel, Kamm als Gegengewicht; keine Gabel.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], ring(lafette) ⟳yaw, horn ⟳pitch [team], fin(gegengewicht) — 6 Parts, 2 anim., ≈ 204 Tris · Maßstab 1 · 2 Tonpunkte (Perlglas) | K13 in MS13 |
| `str_t3_arty` | STRUCTURE DEFENSE INDIRECTFIRE ARTILLERY TECH3 SIZE16<br>*von:* `ENGINEER & TECH3` | FA-Referenz: RW 825, 70.800 Mass, 5.000 Schaden alle 10 s. Skaliert wie Varkan-Hochofen: RW 200 (Gate ≤ 40 % der kleinsten Kartendiagonale), Kosten ≈ 66 %, fast gleicher Einzelschuss (Schild-Burst), Feuerrate ×⅔; DPS/Mass und HP/Mass bleiben in Relation. | Fanfare-Silhouette auf 8×8 mit überlangem Trichter (Länge ≥ 2 × Öffnung) und zweitem Kamm, 3 Tonpunkte; kein Kristall.<br>lens(dreipass) [team], lens(dreipass) [team], lens(dreipass) [team], ring(lafette) ⟳yaw, horn(ueberlanger trichter) ⟳pitch [team], fin(gegengewicht), fin(zweiter kamm) [team] — 7 Parts, 2 anim., ≈ 220 Tris · Maßstab xz 4 / y 4,67 · 3 Tonpunkte (Perlglas) | K13 + Reichweiten-Gate in MS13 |

---

## 14. Balance-Übersicht und Gates

- **DPS/Mass:** 24 bewaffnete Einträge, größte Abweichung +7,7 % (Pfeife), Mittelwert +0,2 %.
- **HP/Mass:** 49 Einträge, größte Abweichung +10 % (Widerhall I), Mittelwert +2,8 %.
- **Produkt DPS/Mass × HP/Mass:** größte Abweichung +9,4 % (Pfeife), Mittelwert +3 %. Gate ±15 %.
- **Pulk-DPS/Mass (Artillerie):** größte Abweichung +7,8 % (Horn). Gate ±15 %.
- **Globale Verschiebung wie Varkan:** HP/Mass im Mittel +2,8 %, DPS/Mass +0,2 % gegenüber der Vorbild-Referenz (Varkan gegenüber seiner Referenz: ebenfalls leicht zäher). Tötungszeiten verlängern sich im Mittel um ≈ 2,6 %; die Breakpoints (unten) bleiben exakt.
- **Keine 1:1-Kopien:** Werte weichen meist um 1–6 % von der Referenz ab. Exakt gleich bleiben nur Werte, die ein Breakpoint erzwingt (Pfiff 4 Schaden → Chorist 32 Treffer) oder die fraktionsübergreifend gleich sind (Kantor wie Vogt: Hauptwaffe, Aufschrei-Formel, Tod).
- **Maßstabs-Sonderfall Großhorn:** wie Varkan-Hochofen – FA-RW 825 WU auf RW 200 skaliert, Kosten ≈ 66 %, Einzelschuss 4.900 (FA 5.000, Schild-Burst), Feuerrate ×⅔; DPS/Mass und HP/Mass ±2 %.

**Pulk-DPS/Mass (Artillerie, Gate ±15 %)**

| Einheit | Schaden × Salve / Nachladezeit | Splash (FA) | Pulk-DPS/Mass (FA) | Δ Pulk | Δ Einzelziel |
|---|---|---|---|---|---|
| Horn | 44 / 2,8 s | 1,6 (1,5) | 1,008 (0,935) | +7,8 % | −2,2 % |
| Posaune | 400 / 6 s | 0,5 (0,5) | 0,291 (0,294) | −1,2 % | −1,2 % |
| Heerhorn | 720 / 10 s | 4,8 (5) | 1,986 (2,079) | −4,5 % | +2,9 % |
| Fanfare | 2.350 / 20 s | 3 (3) | 0,565 (0,577) | −2,1 % | −2,1 % |
| Großhorn | 4.900 / 15 s | 7 (7) | 0,307 (0,312) | −1,6 % | −1,6 % |

**Treffer-bis-Tod-Matrix (37 Paare, Pflicht: exakt wie die Vorbild-Referenz)**

| Angreifer (Waffe) → Ziel | Salvenschaden / Ziel-HP | Salven (Zeit) | FA: Salvenschaden / Ziel-HP | FA: Salven (Zeit) | ✓ |
|---|---|---|---|---|---|
| Kantor (`wpn_cantor_fork`) → Pfiff | 100 / 36 | 1 (0 s) | 100 / 35 | 1 (0 s) | ✓ |
| Kantor (`wpn_cantor_fork`) → Triller | 100 / 285 | 3 (2 s) | 100 / 280 | 3 (2 s) | ✓ |
| Kantor (`wpn_cantor_fork`) → Horn | 100 / 180 | 2 (1 s) | 100 / 170 | 2 (1 s) | ✓ |
| Kantor (`wpn_cantor_fork`) → Pfeife | 100 / 315 | 4 (3 s) | 100 / 310 | 4 (3 s) | ✓ |
| Kantor (`wpn_cantor_fork`) → Chorist | 100 / 128 | 2 (1 s) | 100 / 125 | 2 (1 s) | ✓ |
| Kantor (`wpn_cantor_fork`) → Solist | 100 / 360 | 4 (3 s) | 100 / 350 | 4 (3 s) | ✓ |
| Pfiff (`wpn_whistle_fork_t1`) → Pfiff | 4 / 36 | 9 (2,4 s) | 4 / 35 | 9 (2,4 s) | ✓ |
| Pfiff (`wpn_whistle_fork_t1`) → Chorist | 4 / 128 | 32 (9,3 s) | 4 / 125 | 32 (9,3 s) | ✓ |
| Triller (`wpn_fork_t1`) → Pfiff | 33 / 36 | 2 (1,3 s) | 32 / 35 | 2 (1,3 s) | ✓ |
| Triller (`wpn_fork_t1`) → Triller | 33 / 285 | 9 (10,4 s) | 32 / 280 | 9 (10,4 s) | ✓ |
| Triller (`wpn_fork_t1`) → Horn | 33 / 180 | 6 (6,5 s) | 32 / 170 | 6 (6,5 s) | ✓ |
| Triller (`wpn_fork_t1`) → Chorist | 33 / 128 | 4 (3,9 s) | 32 / 125 | 4 (3,9 s) | ✓ |
| Gabel I (`wpn_fork_pd_t1`) → Triller | 52 / 285 | 6 (1,5 s) | 50 / 280 | 6 (1,5 s) | ✓ |
| Gabel I (`wpn_fork_pd_t1`) → Pfiff | 52 / 36 | 1 (0 s) | 50 / 35 | 1 (0 s) | ✓ |
| Horn (`wpn_horn_t1`) → Pfiff | 44 / 36 | 1 (0 s) | 45 / 35 | 1 (0 s) | ✓ |
| Horn (`wpn_horn_t1`) → Chorist | 44 / 128 | 3 (5,6 s) | 45 / 125 | 3 (5,6 s) | ✓ |
| Horn (`wpn_horn_t1`) → Triller | 44 / 285 | 7 (16,8 s) | 45 / 280 | 7 (16,8 s) | ✓ |
| Heuler (`wpn_fork_t2_charged`) → Pfiff | 210 / 36 | 1 (0 s) | 200 / 35 | 1 (0 s) | ✓ |
| Heuler (`wpn_fork_t2_charged`) → Triller | 210 / 285 | 2 (3,5 s) | 200 / 280 | 2 (3,3 s) | ✓ |
| Heuler (`wpn_fork_t2_charged`) → Chorist | 210 / 128 | 1 (0 s) | 200 / 125 | 1 (0 s) | ✓ |
| Brüller (`wpn_fork_t2_rapid`) → Pfiff | 37 / 36 | 1 (0 s) | 35 / 35 | 1 (0 s) | ✓ |
| Brüller (`wpn_fork_t2_rapid`) → Triller | 37 / 285 | 8 (2,1 s) | 35 / 280 | 8 (2,1 s) | ✓ |
| Brüller (`wpn_fork_t2_rapid`) → Chorist | 37 / 128 | 4 (0,9 s) | 35 / 125 | 4 (0,9 s) | ✓ |
| Posaune (`wpn_spindle_t2`) → Gabel II | 400 / 2.200 | 6 (30 s) | 405 / 2.100 | 6 (30 s) | ✓ |
| Diskant (`wpn_descant_fast_t3`) → Triller | 600 / 285 | 1 (0 s) | 580 / 280 | 1 (0 s) | ✓ |
| Diskant (`wpn_descant_fast_t3`) → Brüller | 600 / 2.550 | 5 (16 s) | 580 / 2.500 | 5 (15,2 s) | ✓ |
| Diskant (`wpn_descant_heavy_t3`) → Heuler | 1.900 / 1.400 | 1 (0 s) | 2.000 / 1.350 | 1 (0 s) | ✓ |
| Diskant (`wpn_descant_heavy_t3`) → Brüller | 1.900 / 2.550 | 2 (14,5 s) | 2.000 / 2.500 | 2 (15,1 s) | ✓ |
| Fanfare (`wpn_fanfare_t2`) → Stimmstock II | 2.350 / 2.000 | 1 (0 s) | 2.400 / 1.950 | 1 (0 s) | ✓ |
| Fanfare (`wpn_fanfare_t2`) → Gabel I | 2.350 / 1.320 | 1 (0 s) | 2.400 / 1.300 | 1 (0 s) | ✓ |
| Fanfare (`wpn_fanfare_t2`) → Resonator II | 2.350 / 2.350 | 1 (0 s) | 2.400 / 2.400 | 1 (0 s) | ✓ |
| Pfeifenwerk I (`wpn_pipework_aa_t1`) → Grille | 21 / 34 | 2 (0,3 s) | 20 / 32 | 2 (0,3 s) | ✓ |
| Zikade (`wpn_cicada_aa_t1`) → Grille | 51 / 34 | 1 (0 s) | 51 / 32 | 1 (0 s) | ✓ |
| Zimbel (`wpn_discharge_aa_t3`) → Zikade | 210 / 300 | 2 (0,9 s) | 200 / 290 | 2 (1 s) | ✓ |
| Zimbel (`wpn_discharge_aa_t3`) → Schwebfliege | 210 / 1.850 | 9 (7,2 s) | 200 / 1.800 | 9 (8 s) | ✓ |
| Hochorgel (`wpn_grand_organ_t3`) → Schwebfliege | 1.160 / 1.850 | 2 (3,4 s) | 1.200 / 1.800 | 2 (3,5 s) | ✓ |
| Hochorgel (`wpn_grand_organ_t3`) → Schwärmer | 1.160 / 1.050 | 1 (0 s) | 1.200 / 1.000 | 1 (0 s) | ✓ |

**Breakpoints, die sich gegenüber Varkan bewusst ändern** (faction.md §9.2): Horn → Chorist 3 (Varkan Kelle → Lehrling 2), Horn → Triller 7 (Kelle → Punze 3), Heuler → Triller 2 (Meißel → Punze 5 Salven), Kantor → Pfiff 1 (Vogt → Funke 1, → Stichel 1). Die Aurith-Artillerie räumt Engineers und Pulks, bricht aber keine Linie; der Heuler tötet T1-Gleiter in zwei Schüssen.

**Schildbrechen (Info, ein einzelner Schütze, mit Regenerations-Verzögerung `regenStartS`)**

| Angreifer → Schild | Schüsse (Zeit) | FA-Waffe gegen FA-Schild |
|---|---|---|
| Fanfare → Dämpfer II | bricht allein nicht | bricht allein nicht |
| Großhorn → Dämpfer II | 4 (45 s) | 4 (30 s) |
| Großhorn → Dämpfer III | 7 (90 s) | 6 (50 s) |
| Heerhorn → Dämpfer II | bricht allein nicht | bricht allein nicht |
| Diskant → Stille | 21 (80 s) | 21 (76 s) |

Fanfare und Heerhorn brechen einen Dämpfer II allein nicht (Regeneration 150/s über 17 bzw. 7 s Pause), genau wie im Vorbild; sie brauchen Masse oder Unterstützung. Das Großhorn braucht wegen der ×⅔-Feuerrate gegen Dämpfer III einen Schuss mehr als im Vorbild (7 statt 6) – Folge der Kartenskalierung, wie beim Varkan-Hochofen.

---

## 15. Ökonomie-Kennzahlen (Kurzreferenz)

Identisch zur Varkan-Ökonomie (gleiche FA-Relationen in allen Fraktionen): Mass-Ertrag, Unterhalt, Upgrade-Kosten und Adjacency stimmen mit Varkan überein, nur HP und kleine Kostenrundungen unterscheiden sich. Amortisation = Upgrade-Mass / Mehrproduktion; die zweite Zahl rechnet den Energy-Mehrbedarf als anteiligen Resonator I ein (20 E/s ≙ 75 Mass).

| Gebäude | Ertrag | Unterhalt | Amortisation (Mass) | inkl. E-Mehrbedarf | Upgrade zur nächsten Stufe | Adjacency (FA-Relation) |
|---|---|---|---|---|---|---|
| Stimmstock I | 2 M/s | −2 E/s | 18 s | ≈ 22 s (+2 E/s) | Stimmstock II: 900 / BP 10 = 90 s | Gibt Fabriken −7,5 % Mass-Verbrauch (8×8); erhält +12,5 % je angrenzender Bernsteinkammer. |
| Stimmstock II | 6 M/s | −9 E/s | 225 s (Δ 4 M/s) | ≈ 232 s (+7 E/s) | Stimmstock III: 2.900 / BP 15 = 193 s | Fabriken −10 % Mass-Verbrauch; +12,5 % je Bernsteinkammer. |
| Stimmstock III | 18 M/s | −54 E/s | 375 s (Δ 12 M/s) | ≈ 389 s (+45 E/s) | – | Fabriken −12,5 % Mass-Verbrauch; +12,5 % je Bernsteinkammer. |
| Resonator I | 20 E/s | – | – | – | – | Fabriken (8×8) −1,56 % Energy-Verbrauch, 2×2-Verbraucher −6,25 %; erhält +25 % Produktion je angrenzender Lichtkammer (SIZE4). |
| Resonator II | 500 E/s | – | – | – | – | Fabriken −12,5 % Energy-Verbrauch; erhält +8,3 % Produktion je angrenzender Lichtkammer (SIZE12). |
| Resonator III | 2.500 E/s | – | – | – | – | Fabriken −15,6 % Energy-Verbrauch; erhält +6,25 % Produktion je angrenzender Lichtkammer (SIZE16). |
| Äolsharfe | 100 E/s | – | – | – | – | Wie Resonator II (Fabriken −12,5 % Energy); erhält +8,3 % je angrenzender Lichtkammer (SIZE12). |
| Bernsteinkammer | +500 M Speicher | – | – | – | – | +12,5 % Produktion je angrenzendem Stimmstock (FA-Relation, max. 4 Seiten = +50 %). |
| Lichtkammer | +10.000 E Speicher | – | – | – | – | Bufft alle angrenzenden Energieproduzenten (FA-Relation): Resonator I +25 % (SIZE4), Resonator II und Äolsharfe +8,3 % (SIZE12), Resonator III +6,25 % (SIZE16). |

Weitere Upgrade-Dauern (buildTime der Zielstufe / buildPower der Vorstufe): Grundhalle I → Grundhalle II 115 s; Grundhalle II → Grundhalle III 300 s; Himmelshalle I → Himmelshalle II 115 s; Widerhall I → Widerhall II 60 s; Widerhall II → Widerhall III 60 s; Dämpfer II → Dämpfer III 290 s.

Kantor: +1 M/s, +20 E/s, Grundspeicher 650 M / 3.900 E, Build Power 10 (wie Vogt).

---

## 16. Silhouetten-Pflichtpaare, Visuals, Glyphen

**Pflichtpaare MS9 (nur ●, 5 von 5 Testern müssen unterscheiden):** Pfiff ↔ Chorist, Pfiff ↔ Triller, Triller ↔ Pfeife, Horn ↔ Posaune, Posaune ↔ Pfeife, Heuler ↔ Brüller, Brüller ↔ Kantor, Gabel I ↔ Pfeifenwerk I, Stimmstock I ↔ Resonator I, Resonator I ↔ Lichtkammer, Bernsteinkammer ↔ Lichtkammer.

**Pflichtpaare MS14:** Zikade ↔ Schwärmer, Maikäfer ↔ Zikade, Grille ↔ Maikäfer, Widerhall I ↔ Dämpfer II, Pfiff ↔ Stille, Großhorn ↔ Resonator III, Stimmstock III ↔ Äolsharfe, Zimbel ↔ Bordun, Grollen ↔ Heuler, Diskant ↔ Brüller.

**Fraktionsübergreifend (neu, `silhouettePairs.crossFaction`):** Triller ↔ Punze (Varkan), Horn ↔ Kelle (Varkan), Pfeife ↔ Sieb (Varkan), Triller ↔ Zecke (f2), Triller ↔ Kauri (f3), Horn ↔ Dünung (f3). Im Schattenriss dieselbe Rolle (Winkel-Code), im Graustufenbild verschiedene Fraktionen (Höhe, Kurve gegen Kante).

**Visuals** (Superset-Mesh pro Rolle, Tech-Bitmaske pro Vertex wie Varkan; Vereinigung nach Part und Material):

| Visual | Mitglieder | Superset-Parts | ≈ Tris |
|---|---|---|---|
| `v_cmd` | Kantor | 7 | 260 |
| `v_eng` | Chorist, Solist, Vorsänger | 7 | 232 |
| `v_scout` | Pfiff | 5 | 164 |
| `v_tank` | Triller, Heuler, Grollen | 7 | 224 |
| `v_arty` | Horn, Heerhorn | 6 | 196 |
| `v_aa` | Pfeife, Bordun, Zimbel | 8 | 216 |
| `v_bot` | Brüller | 5 | 180 |
| `v_mml` | Posaune | 6 | 188 |
| `v_sniper` | Diskant | 5 | 180 |
| `v_shield_mobile` | Stille | 5 | 172 |
| `v_air_scout` | Grille | 3 | 80 |
| `v_fighter` | Zikade | 3 | 80 |
| `v_bomber` | Maikäfer | 3 | 88 |
| `v_gunship` | Schwebfliege | 4 | 184 |
| `v_fbomber` | Schwärmer | 5 | 152 |
| `v_mex` | Stimmstock I, Stimmstock II, Stimmstock III | 6 | 228 |
| `v_pgen` | Resonator I, Resonator II, Resonator III | 6 | 180 |
| `v_hydro` | Äolsharfe | 8 | 228 |
| `v_mstore` | Bernsteinkammer | 4 | 132 |
| `v_estore` | Lichtkammer | 6 | 228 |
| `v_fac` | Grundhalle I, Grundhalle II, Grundhalle III, Himmelshalle I, Himmelshalle II | 9 | 280 |
| `v_pd` | Gabel I, Gabel II | 5 | 184 |
| `v_aa_struct` | Pfeifenwerk I, Pfeifenwerk II | 7 | 184 |
| `v_sam` | Hochorgel | 8 | 220 |
| `v_wall` | Grat | 2 | 32 |
| `v_radar` | Widerhall I, Widerhall II, Widerhall III | 7 | 228 |
| `v_shield` | Dämpfer II, Dämpfer III | 6 | 228 |
| `v_arty_struct` | Fanfare, Großhorn | 7 | 220 |

**Draw-Budget:** 28 Visuals wie Varkan (28). Im 1v1 zweier verschiedener Fraktionen sind bis zu 56 Visuals aktiv (DECISIONS 17 rechnet mit 40) – Prüfung im Render-Bench (§19).

**Icon-Glyphen (19 Tokens):** `aa`, `arty`, `bomb`, `bot`, `build`, `direct`, `energy`, `estore`, `fac_air`, `fac_land`, `fbomb`, `hydro`, `intel`, `mass`, `mml`, `mstore`, `sam`, `shield`, `sniper`. Exakt der Varkan-Atlas (Generator-Lint), keine neue Grundform, keine neue Glyphe. Kantor (`cmd_commander`) und Grat (`wall`) ohne Glyphe.

---

## 17. Asymmetrie gegenüber Varkan

### 17.1 Relationen je Rolle (aus beiden `roster.json`)

Beide Fraktionen liegen je Einheit innerhalb ±15 % ihrer FA-Referenz. Die Unterschiede zwischen ihnen sind deshalb die Unterschiede zwischen den FA-Vorbildern – die Asymmetrie ist übernommen, nicht erfunden. Δ = Aurith / Varkan − 1.

| Rolle | Aurith | Varkan | Mass | Δ DPS/Mass | Δ HP/Mass | Δ Produkt | Lesart |
|---|---|---|---|---|---|---|---|
| Kommandant | Kantor | Vogt | 2.000 / 2.000 | ±0 % | −4,2 % | −4,2 % | wie Vogt, HP −4 % (A11) |
| Ingenieur | Chorist | Lehrling | 52 / 52 | – | −20 % | – | fragile Engineers (A9) |
| Ingenieur | Solist | Geselle | 130 / 130 | – | −14,3 % | – | A9 |
| Ingenieur | Vorsänger | Meister | 310 / 310 | – | −16,7 % | – | A9 |
| Kampfspäher | Pfiff | Funke | 20 / 12 | +299,9 % | −32,5 % | +169,9 % | bewaffneter Späher (A1) |
| Kampfspäher | Pfiff | Stichel | 20 / 30 | −14,3 % | −10 % | −22,9 % | Raider fast auf LAB-Niveau, billiger als Späher + LAB |
| Kampfgleiter | Triller | Punze | 54 / 56 | +12,8 % | −1,5 % | +11,1 % | Linie etwas stärker |
| Mobile Artillerie | Horn | Kelle | 54 / 36 | −5,7 % | −42,9 % | −46,1 % | Streuklang: teuer, fragil (A2) |
| Mobile Flugabwehr | Pfeife | Sieb | 55 / 55 | ±0 % | +1,6 % | +1,6 % |  |
| Stoßgleiter | Heuler | Meißel | 220 / 200 | +1,3 % | −20,5 % | −19,4 % | schnell, Alpha-Schuss, weniger zäh (A3) |
| Sturmläufer | Brüller | Zange | 360 / 190 | −2,4 % | +107,1 % | +102,1 % | schwerer Linienanker (A3) |
| Raketenwerfer | Posaune | Rinne | 180 / 180 | +11,1 % | +5,1 % | +16,8 % | eine schwere Rakete, RW 64 (A4) |
| Flak | Bordun | Rüttelsieb | 160 / 160 | ±0 % | ±0 % | ±0 % |  |
| Belagerungsgleiter | Grollen | Fallhammer | 840 / 500 | +64,3 % | −10,7 % | +46,7 % | Hybrid Direkt + Indirekt (A6); stärkster T3-Körper, langsam |
| Schwere Artillerie | Heerhorn | Pfanne | 800 / 800 | +2,9 % | −5 % | −2,3 % |  |
| Präzisionsläufer | Diskant | Reißnadel | 780 / 720 | −3,1 % | +18,7 % | +15 % | zwei Modi (A6) |
| Entladungsgleiter | Zimbel | Trommelsieb | 720 / 600 | +13,4 % | −22,9 % | −12,6 % | trifft auch Boden (A6) |
| Großschild | Stille | Schürze | 720 / 220 | – | −8,6 % | – | Großschild erst T3 (A5) |
| Aufklärer | Grille | Lerche | 40 / 40 | – | −15 % | – |  |
| Abfangjäger | Zikade | Turmfalke | 50 / 50 | +2 % | +1,7 % | +3,7 % |  |
| Bomber | Maikäfer | Dohle | 90 / 90 | −29,4 % | −4,3 % | −32,5 % | eine Bombe, großer Splash (A10) |
| Kampfschweber | Schwebfliege | Krähe | 500 / 200 | −10 % | −2,6 % | −12,4 % | teuer und zäh (A10), Referenz mit 2 Bordwaffen (R1) |
| Jagdbomber | Schwärmer | Elster | 420 / 340 | −24,7 % | −26,1 % | −44,4 % | schwere Einzelbombe, schwächerer Luftkampf (A10); FA-Relation ≈ −46 % Produkt |
| Punktverteidigung | Gabel I | Riegel I | 250 / 240 | −0,2 % | −6,1 % | −6,3 % |  |
| Strahlverteidigung | Gabel II | Riegel II | 540 / 520 | +15,6 % | −11,7 % | +2 % | Strahl, RW 50 (A7) |
| Flugabwehrturm | Pfeifenwerk I | Rost I | 150 / 150 | +5 % | −1,2 % | +3,7 % |  |
| Flakturm | Pfeifenwerk II | Rost II | 400 / 400 | −23,8 % | ±0 % | −23,8 % | Vorbild-Flak schwächer |
| Raketenabwehr | Hochorgel | Hochrost | 800 / 800 | −0,5 % | +2 % | +1,5 % |  |
| Mauer | Grat | Mauer | 3 / 3 | – | −5,5 % | – |  |
| Schildgenerator | Dämpfer II | Schirm II | 700 / 600 | – | +20,3 % | – | stärkerer Schild (A8) |
| Schildgenerator | Dämpfer III | Schirm III | 3.600 / 3.200 | – | +7,2 % | – | A8 |
| Artilleriestellung | Fanfare | Tiegel | 2.000 / 1.800 | +5,8 % | −26,2 % | −22 % | teurer, fragiler |
| Schwere Artilleriestellung | Großhorn | Hochofen | 47.000 / 48.000 | −9 % | −8,1 % | −16,4 % |  |

Wirtschafts-, Hallen- und Intel-Gebäude ohne Eintrag haben dieselben Erträge und Upgrade-Zeiten wie Varkan, Kosten ±2 % und −21,1 % … ±0 % HP/Mass (Vorbild-Gebäude etwas fragiler, am stärksten der Resonator III). Wirtschaft und Tech-Tempo sind damit symmetrisch. Die Varkan-Zange ist ein leichter FAF-Sturm-Bot (Roster-Auffüllung), kein direkter Gegenpart zum Brüller; der Vergleich zeigt nur die Gewichtsklasse.

### 17.2 Post-MVP-Asymmetrien (⚑, rein additiv)

| Feature-ID | Einheit | Vorbild-Verhalten | MVP-Verhalten ohne Feature |
|---|---|---|---|
| **U14** | Kantor | Upgrades: Regenerations-Aura, Schadensstabilisierung, Feuerrate, Teleport | Grundregeneration 10 HP/s wie Vogt |
| **K16** | Kantor | Taktische Rakete als Upgrade | entfällt |
| **P19** | Kantor | Aufklang: Bernsteinsäule steigt auf und zerspringt | 3-s-View-Platzhalter, spielbar ab Tick 0 |
| **M13** | Chorist | amphibisch: fährt unter Wasser (Vorbild-Engineers) | nur Land, wie Varkan-Engineers |
| **M13** | Solist | amphibisch: fährt unter Wasser (Vorbild-Engineers) | nur Land, wie Varkan-Engineers |
| **M13** | Vorsänger | amphibisch: fährt unter Wasser (Vorbild-Engineers) | nur Land, wie Varkan-Engineers |
| **I5** | Pfiff | Tarnung im Stand (unsichtbar für Radar und Sicht), Unterhalt 1 E/s | kein Tarnen, kein Unterhalt |
| **M13** | Heuler | echtes Schweben über Wasser (Hover) | normale LAND-Einheit; Gleiter-Look ist reine Optik |
| **M13** | Grollen | amphibisch (fährt unter Wasser) | nur Land |
| **U18** | Grollen | Torpedowerfer als Drittwaffe | entfällt; DPS/Mass auch in der FA-Referenz ohne Torpedo gemessen |
| **M13** | Stille | echtes Schweben über Wasser (Hover) | normale LAND-Einheit |
| **I4** | Widerhall III | Omni-Sensor (FA-Vorbild: Radar 600 + Omni) | reines Radar r300 |
| **I5** | – (Reserve) | Tarnfeld-Generator als T2-Gebäude | nicht im Roster |
| **U15 / U16 / U12** | – (Reserve) | Unterkantor, Experimental *Hymne*, T3-Luft *Kadenz* | nicht im Roster |

Alle Werte in §4–§14 sind ohne diese Features gemessen. **K10 über das MVP hinaus** braucht die Fraktion nicht: nur Bubble-Schilde (Stille, Dämpfer), keine Personal Shields.

---

## 18. Abgleich mit den vorläufigen Zielwerten aus `faction.md`

Die Zielwerte in `faction.md` §9.2 und §11.1 stammten direkt aus der FA-Referenz. Das Roster weicht wie bei Varkan um einige Prozent ab und hält dabei alle Breakpoints; `faction.md` ist entsprechend angeglichen.

| Einheit | Zielwert (faction.md, vorläufig) | Roster | Grund |
|---|---|---|---|
| Triller | HP 280, 32 / 1,3 s | HP 285, 33 / 1,3 s | Triller → Triller 9 Treffer wie FA (30 Schaden hätte 10 ergeben), PD I 6, Horn 7 |
| Horn | HP 170, 45 / 2,8 s, Splash 1,5 | HP 180, 44 / 2,8 s, Splash 1,6 | Pulk +7,8 %, Einzelziel −2,2 %; Chorist 3 und Triller 7 Treffer bleiben |
| Chorist | HP 125 | HP 128 | Pfiff → Chorist 32 Treffer (4 Schaden) wie FA; Horn 3, Triller 4, Kantor 2 bleiben |
| Pfiff | HP 35 | HP 36, RW 18 | Pfiff ↔ Pfiff 9 Treffer wie FA |
| Heuler | 200 / 3,3 s, HP 1.350 | 210 / 3,5 s, HP 1.400 | Alpha-Schuss etwas schwerer, gleiche DPS; Triller 2 Schüsse |
| Brüller | HP 2.500, DPS 117 | HP 2.550, 37 / 0,3 s = 123 DPS | Brüller → Triller 8 Treffer wie FA (36 Schaden hätte 9 ergeben) |
| Posaune | 405 / 6 s, RW 65 | 400 / 6 s, RW 64 | Gabel II fällt nach 6 Raketen wie FA |
| Stille | Schild 10.000 | Schild 9.600, HP 450 | HP+Schild/Mass −3,4 % |
| Grollen | DPS/Mass +20 % zum Fallhammer (erste Fassung), dann +12 % | +64 % (DPS 414) | Referenz ohne Torpedo (U18) mit beiden Direktwaffen (R1): 2×66 / 0,5 s + 600 / 4,0 s |
| Diskant | DPS/Mass +78 % zur Reißnadel | −3 % (schneller Modus), HP/Mass +19 % | Referenz-DPS nur ein Modus; spooky-db addiert beide Modi |
| Zimbel | Luft 240 / Boden 56 DPS | Luft 233 / Boden 52,5 DPS | Zimbel → Schwebfliege 9 Treffer wie FA |
| Schwebfliege | HP 1.800, 2×21 / 0,7 s | HP 1.850, 4×21 / 0,7 s = 120 DPS | Hochorgel → Schwebfliege 2 Salven wie FA; Referenz mit 2 Bordwaffen (R1) |
| Schwärmer | Bombe 1.250, Luft 3×24 / 1 s | Bombe 1.200 / 10 s, Luft 6×24 / 1 s, HP 1.050 | Produkt +0,8 %; Referenz mit 2 Luftwaffen (R1) |

---

## 19. Offene Punkte

1. **Namespace:** `f4:` gegen `core:` (Varkan). Vor den Blueprints entscheiden, ob alle Fraktionen `f1…f4` bekommen; die Umbenennung ist dann ein Suchen/Ersetzen in `roster.json` und `gen.py` (`NS`).
2. **Strahlwaffe (K1):** Gabel II und Zimbel sind als Hitscan-Pulse notiert (`salvo` = Pulse). Vor MS8 im Waffenmodell entscheiden; Fallback für Gabel II steht in der Waffennotiz (Projektil 600 / 4,0 s).
3. **Draw-Budget:** 28 Visuals pro Fraktion, im 1v1 zweier Fraktionen bis zu 56 aktiv (DECISIONS 17: 40). Render-Bench vor MS14.
4. **FA-Datenstand:** spooky-db 3810 gegen FAF `develop` weicht bei zwei Referenzen ab (§1: Strahl-PD −9 % DPS, Präzisionsläufer RW +5; der Belagerungsgleiter war ein Extraktionsfehler, R1). Vor MS9 mit dem dann aktuellen Stand nachziehen (`ref.py` gegen neue Daten, dann `gen.py` und `validate.py`).
5. **Luft-Balance zwischen den Fraktionen:** Nach R1 liegt die Schwebfliege bei Δ Produkt ≈ −12 % zur Varkan-Krähe (vorher −56 %). Der Schwärmer liegt nach der Varkan-Korrektur (Elster-Luftkanonen 2 × 70, fraktionsübergreifender Abgleich `docs/design/factions/README.md` §5.4) bei ≈ −44 % Produkt zur Elster; das entspricht der FA-Relation der Referenzen (≈ −46 %). Der Schwärmer ist also bewusst der schwächere Luftkämpfer mit der schwereren Bombe (A10). MS12 prüft im Spiegel- und Kreuz-Match.
6. **Modus-Toggle (Diskant):** braucht C17 „Modus“ neben Schild/Stealth/Auto-Overcharge.
7. **Abgleich mit f2/f3:** erledigt (§20 und fraktionsübergreifender Abgleich, `docs/design/factions/README.md` §4): Namenskollisionen behoben, Formbedeutungen konsistent, Kreuz-Silhouettenpaare ergänzt. Perlglas ist auf kühles Eisweiß `#D5DCE2` gesetzt (vorher `#E6E0D2`, fast gleich dem warmen Perlmutt der f3). Amber (≈ 37°, 25–35 % Fläche) und das Gold der f3 (≈ 43°, ≤ 8 % Kanten) bleiben: Die Fraktionen trennen sich über das dominante Material (Bernstein auf Pechglas gegen helles Perlmutt) und die Leuchtfarbe (Phasenblau gegen Goldlicht/Jade). Der Graustufen-Test Triller ↔ Kauri und Horn ↔ Dünung (§16) bleibt MS9-Abnahme.
8. **Schema:** `special.postMvp`, `balance.fa.dpsWeapons`, `checks.hitsToKill[].fa.weaponIdx` und `silhouettePairs.crossFaction` sind Erweiterungen gegenüber dem Varkan-JSON (optional, rückwärtskompatibel). Dazu die Placeholder-Erweiterungen aus `faction.md` §3.6 (neue PartKeys, `legs.count`, Kristall ohne Spitze für die Bernsteinkammer).
9. **Superset-Zählung:** Wie bei Varkan zählt die Vereinigung nach (Part, Material); gleiche Parts an verschiedenen Positionen (z. B. Pfeifen gestufter Länge) beim Mesh-Bau erneut prüfen.
10. **Namen:** Markenrecherche „Aurith“ und aller Rufnamen offen; FA-Namens-Grep erledigt (faction.md §7.1).
11. ~~**`WeaponNumber` in den anderen Fraktionen**~~ erledigt im fraktionsübergreifenden Abgleich (`docs/design/factions/README.md` §5.4): `fa_ref.json` von Varkan, f2 und f3 zählen `DEA0202`, `URA0102` und `UAA0102` jetzt doppelt (gegen FAF `develop` geprüft); Elster, Bremse (f2) und Raubmöwe (f3) sind nachgezogen. §17.1 ist neu erzeugt.

---

## 20. Review-Entscheidungen (2026-09-29)

Kritisches Review nach dem ersten Roster-Stand: Balance nachgerechnet, Lesbarkeit, Eigenständigkeit gegenüber FA, Vollständigkeit. Berechtigte Punkte sind eingearbeitet (`gen.py`, `md.py`, `ref.py`, `validate.py`, `faction.md`); danach `gen.py → md.py → validate.py` ohne Verstöße.

| # | Bereich | Befund | Entscheidung | Wirkung |
|---|---|---|---|---|
| R1 | Balance / Daten | spooky-db speichert gleiche Doppelwaffen als **einen** Eintrag mit `WeaponNumber` 2; `ref.py` ignorierte das Feld. Drei f4-Referenzen waren untergezählt: T3-Belagerungsgleiter 284 statt 412 DPS, T2-Gunship 57 statt 114, T2-Jagdbomber 200 statt 275. Die im ersten Bericht als „FAF-Änderung +45 %“ gemeldete Abweichung des Belagerungsgleiters war genau dieser Fehler. | `ref.py` multipliziert mit `WeaponNumber` und schreibt `weapons[].count`. Grollen: Gabel feuert beide Zinken (2×66 / 0,5 s). Schwebfliege: Bauchgabel 4×21 / 0,7 s. Schwärmer: Luftwaffe aus beiden Gondeln 6×24 / 1 s. Kitbash unverändert. | Grollen 282 → 414 DPS (Δ FA +0,4 %), Schwebfliege 60 → 120 (+5 %), Schwärmer 192 → 264 (−4 %). Kreuz-Relation Luft: −56 % → −12 % (Krähe), −46 % → −26 % (Elster). Varkan/f2/f3 betroffen (§19 Nr. 11). |
| R2 | Balance: T1-Rush gegen Kommandant | Simulation (Kommandant 100 Schaden/s auf das vorderste Ziel, Regeneration 10/s, ohne Aufschrei): 18 Triller (972 M) töten den Vogt in 49 s, 19 Punzen (1.064 M) töten den Kantor in 42 s (Vogt: 47 s). Artillerie außerhalb der Kommandanten-RW (540 M): 10 Hörner gegen Vogt 82 s, 15 Kellen gegen Kantor 73 s. | Keine Änderung. Kantor bleibt bei HP 11.500 (FA-Relation, wie f2/f3 ihre Kommandanten ebenfalls nach Vorbild setzen). Der Aurith-Tank-Rush ist ≈ 9 % billiger, der Kantor fällt ≈ 11 % schneller: das hebt sich im Rahmen der ±15-%-Methodik auf. | Rush-Timing symmetrisch innerhalb ±12 %. MS9-KI-Test: Rush-Abwehr mit Aufschrei in beiden Richtungen. |
| R3 | Balance: Opening ohne I5 | Der Pfiff ist der schwächere Raider (Produkt −25 % zum Stichel, seit dem FA-gleichen Stichel −23 %) und verliert im MVP seine Vorbild-Kompensation (Tarnung, I5). Gleichzeitig sind Aurith-Engineers anfälliger: Stichel → Chorist 5,4 s, Pfiff → Lehrling 11,7 s. `faction.md` §9.3 behauptete das Gegenteil („Pfiffe töten Engineers, Gegner braucht früh PD“). | Keine Wertänderung: Pfiff ↔ Pfiff 9 und Pfiff → Chorist 32 Treffer pinnen HP 36 und Schaden 4; Mass 19 hätte Produkt +14 % (zu nah am Gate). Konter statt Kompensation: Der Triller tötet einen Stichel in 2 Schüssen (1,3 s; vor dem fraktionsübergreifenden Abgleich 3 Schüsse bei 70 HP), der Stichel braucht 41 Treffer (12 s). §9.3 korrigiert. | MS9-Kriterium: Aurith-Engineer-Verluste bis 5:00 im Kreuz-Match gegen ein LAB-Opening ≤ 1,5 × Spiegel-Match. Sonst Hebel: Pfiff Mass 19 oder Triller-Eskorte in der KI. |
| R4 | Balance: Eco-Kurve | Engineers, Stimmstock, Resonator, Hallen, Upgrades: gleiche Kosten, Erträge, Build Power und Upgrade-Zeiten wie Varkan (§15); nur HP 0 … −21 %. T2-Durchsatz an Halle II: Brüller 360 M / 40 s = 9,0 M/s, Varkan-Meißel 200 M / 22,5 s = 8,9 M/s. | Keine Änderung. | Eco- und Tech-Tempo symmetrisch. |
| R5 | Balance: Konter T3 | Nach R1 ist Grollen Δ Produkt +47 % zum Varkan-Fallhammer. Einordnung: f2-T3-Läufer ≈ +49 %, f3 ≈ +11 % zum Fallhammer; der Fallhammer ist der Ausreißer nach unten. | Wert bleibt (Vorbild-Relation), Konter dokumentiert: langsam (2,8), RW 22/28 gegen Heerhorn (RW 88) und Präzisionsläufer (RW 55–65); keine Flugabwehr. | MS13-Prüfpunkt: T3-Kreuz-Match; Hebel wäre die Indirektwaffe (Nachladezeit), nicht die Gabel. |
| R6 | Lesbarkeit: Winkel-Code | `faction.md` §5.1 sagte „Mast = Intel … nie mit Reif“, Stille und Dämpfer sind aber Mast + Reif; der Gunship trägt senkrechte Reifen. | Präzisiert: Mast + Muschel-Schale = Intel, Mast + **waagerechter** Reif = Schild, Reif ohne Mast = Flow-Anschluss, **senkrechte** Reifen nur als Luft-Antrieb. | Keine Datenänderung. |
| R7 | Lesbarkeit: Pflichtpaare | Pfiff und Triller sind beide ● Direktfeuer-Gleiter auf demselben Kiel, aber sehr verschiedene Bedrohungen; das Paar fehlte. | MS9-Pflichtpaar Pfiff ↔ Triller ergänzt (kleinster Kiel mit hohem Mast und kurzer Gabel gegen lange Gabel über die Kielspitze). | 11 MS9-Paare (Varkan 9). |
| R8 | Lesbarkeit: Pfiff-Icon | Glyphe `bot` zeigt Beinstriche, der Pfiff gleitet. | Bleibt `land_bot_t1`: `land_direct_t1` würde mit dem Triller verschmelzen, `intel` würde den Raider verstecken. Gelesen wird die Glyphe fraktionsübergreifend als „leichter Direktfeuer-Raider“. | Vorschlag für die gemeinsame Grammatik (Varkan `faction.md` §6.3): Bedeutung von `bot` so formulieren. |
| R9 | Lesbarkeit: fraktionsübergreifend | f3 nutzt dieselben Formbedeutungen (Horn = Artillerie, Sichel = Bauen, senkrecht = Flugabwehr) und ebenfalls schwebende, helle Körper. | Kreuz-Paare ergänzt: Triller ↔ f2-T1-Panzer, Triller ↔ f3-T1-Panzer, Horn ↔ f3-T1-Artillerie. | Formbedeutung konsistent (gut); Farbnähe zu f3 als §19 Nr. 7 offen. |
| R10 | Eigenständigkeit: Namen | Zwei Kollisionen mit den Parallel-Fraktionen: „Hummel“ (f2-Gunship) und „Muschel“ (f3-Mobilschild). | T1-Bomber **Maikäfer / Cockchafer** (breite Deckflügel = Fächer-Silhouette). Radar **Widerhall I–III / Reverb I–III**. „Echo“ verworfen (FA-Sonarname). IDs unverändert. | `validate.py` prüft jetzt Namensgleichheit gegen alle vorhandenen Fraktions-Roster. |
| R11 | Eigenständigkeit: Begriffe | `faction.md` nannte in §10.2 FA-Fraktionsnamen und in §2.4 konkrete FA-Waffen-Wortstämme; „Kettenblitz“ übersetzte das Konzept der FAF-Referenzeinheit. | FA-Namen durch neutrale Beschreibungen ersetzt, Wortstamm-Liste durch Verweis auf den Grep (§7.1). Projektiltyp der Zimbel heißt jetzt „Entladungsbogen“. | Kein FA-Eigenname mehr in f4-Texten außerhalb `faReference` (dev-only). |
| R12 | Passung zum Vorbild | Amber/Blauleuchten, geschwungene Körper, Gleiter, Hybride, wenige große Einheiten treffen die Vorbild-Designsprache. Kein Design ist kopiert: Kommandant als armloses Dreibein, Lore als Ureinwohner, echte DE/EN-Wörter. | Keine Änderung. Die Assoziation „Chor“ ↔ Engelschöre ist ein allgemeines Motiv, kein FA-Inhalt; §2.3 schließt Heiligenpathos aus. | – |
| R13 | Vollständigkeit | Alle Varkan-Feature-IDs und Rollen sind belegt; `lnd_t1_bot`, `lnd_t2_shield`, `lnd_t3_bot` sind auf Pfiff, Stille und Grollen abgebildet (§2.1). Keine MVP-Rolle fehlt. | Keine Änderung. | 49 Blueprints, 26 ●, 28 Visuals, 19 Glyphen. |

---

## 21. Experimentals (T4, Post-MVP)

**5 T4-Blueprints** im eigenen Schlüssel `experimentals` von `roster.json` (`tier: T4`, `postMvp: true`). Sie zählen nicht in die 49 Blueprints, den MS9-Kern oder die 28 Visuals und sind für `cross.py` unsichtbar. Design, Herleitung und Kitbash im Detail: [`experimentals.md`](experimentals.md). Referenz: `tools/roster/f4/fa_ref_t4.json` (Vorbild `XSL0401`, `XSA0402`, `XSB2401`; Fremdreferenz `UEL0401`, `XAB1401`, weil das Vorbild keine mobile Fabrik und kein T4-Eco hat). Gates (Generator und `validate.py`): Δ DPS/Mass (Boden), Δ HP/Mass, Produkt und Pulk je ±15 %, Δ Luft-DPS/Mass ±25 %, Δ Mass ±15 %; T4-Kitbash ≤ 10 Parts, ≤ 4 animiert, Tris L0/L1/L2 1.500/800/320 (`@faf/modelkit` `T4_BUDGET`); Setons-Brücke (Gate 72 WU): mobile Land-T4 mit Außenmaß ≤ 12 WU, also ≥ 6 nebeneinander.

| ID | DE / EN | Rolle | Hotbuild | Icon | Mass / Energy / buildTime | HP (+Schild) | Tempo | Footprint / s | Δ DPS/M · Δ HP/M · Δ Prod | Features |
|---|---|---|---|---|---|---|---|---|---|---|
| `f4:exp_assault` | **Hymne** / Hymn | Experimenteller Sturmläufer | Q | `land_bot_t4` | 26.500 / 330.000 / 46.875 | 72.000 | 2,4 | 4×4 / s3 | −9,4 % · +7,5 % · −2,6 % | A16, K1-Erweiterung, K14, M13, P14, U16 |
| `f4:exp_mobile_fac` | **Ensemble** / Ensemble | Wandernde Halle | W | `land_arty_t4` | 28.000 / 350.000 / 47.500 | 11.000 + 24.000 | 1,7 | 6×6 / s3 | −5 % · +7,7 % · +2,3 % | B12, K10, M13, U21 |
| `f4:exp_air_bomber` | **Heupferd** / Katydid | Experimenteller Bomber | R | `air_bomb_t4` | 48.000 / 1.920.000 / 67.500 | 50.000 | 16 | 6×6 / s0 | +9,1 % · −3,8 % · +5 % | P14, U12, U21 |
| `f4:exp_strat_missile` | **Tuba** / Tuba | Experimenteller Strategiewerfer | V | `struct_mml_t4` | 185.000 / 10.000.000 / 250.000 | 12.500 | – | 6×6 | – · +5,7 % · – | A21, K17, P14, U21 |
| `f4:exp_resource` | **Klangschale** / Singing Bowl | Experimenteller Resonanzgenerator | T | `struct_mass_t4` | 250.200 / 7.506.000 / 325.000 | 5.500 | – | 8×8 | – · +10 % · – | E17, P14, U21 |

**Waffen und Besonderheiten**

| Einheit | Waffen | Tod | Kitbash |
|---|---|---|---|
| **Hymne** | `wpn_hymn_beam` Große Schwebung (Strahl zwischen den Brustzinken): 10×500 / 5 s = **1000 DPS**, RW 4–46, hitscan-puls, Splash 3<br>`wpn_hymn_fork` Doppelgabelton (beide Brustzinken): 2×560 / 0,6 s = **1866,7 DPS**, RW 46, linear<br>`wpn_hymn_horn` Stoßklang (Schultertrichter): 2.000 / 3,5 s = **571,4 DPS**, RW 46, ballistisch (flach), Splash 6<br>`wpn_hymn_pipes` Pfeifenkranz (Flugabwehr, gestuft): 6×30 / 1 s = **180 DPS**, RW 46, linear, Splash 3 [Luft] | 6.000 / 6; Feld 20 s, 500 / 0,5 s, R 14 | 9 Parts, 2 anim., ≈ 864 Tris |
| **Ensemble** | `wpn_ensemble_horn` Chorstoß (zwei Trichter im Wechsel): 2×1.400 / 1 s = **2800 DPS**, RW 10–90, ballistisch, Splash 1,5<br>`wpn_ensemble_fork` Gabelkranz (Nahabwehr): 2×150 / 0,3 s = **1000 DPS**, RW 40, linear<br>`wpn_ensemble_pipes` Pfeifenbank (Flugabwehr): 3×40 / 1 s = **120 DPS**, RW 40, linear [Luft] | 4.000 / 7 | 10 Parts, 3 anim., ≈ 960 Tris |
| **Heupferd** | `wpn_katydid_bomb` Dröhnbombe (ein Abwurf pro Anflug): 12.000 / 14 s = **857,1 DPS**, RW 90, Bombe, Splash 17<br>`wpn_katydid_pipes` Zirpkranz (vier Pfeifengruppen): 4×400 / 1 s = **1600 DPS**, RW 64, linear [Luft] | 8.000 / 10 | 8 Parts, 2 anim., ≈ 684 Tris |
| **Tuba** | `wpn_tuba_final` Schlussakkord (strategische Rakete): 1.000.000 / 60 s = **16666,7 DPS**, RW 20.000, Lenkrakete (strategisch), Splash 42 | 20.000 / 15 + 5.000 / 20 | 8 Parts, 2 anim., ≈ 732 Tris |
| **Klangschale** | – | 35.000 / 24 | 9 Parts, 1 anim., ≈ 864 Tris |

**Silhouetten-Pflichtpaare T4:** exp_assault ↔ cmd_commander, exp_assault ↔ lnd_t2_bot, exp_mobile_fac ↔ str_t3_fac_land, exp_mobile_fac ↔ lnd_t3_shield, exp_air_bomber ↔ air_t1_bomber, exp_air_bomber ↔ air_t2_fbomber, exp_strat_missile ↔ str_t3_arty, exp_strat_missile ↔ str_t3_sam, exp_resource ↔ str_t3_pgen, exp_resource ↔ str_t3_mex.

