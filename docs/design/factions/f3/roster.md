# Roster: Orden von Sael (Fraktion f3, MVP)

> **Status:** Startwerte für alle MVP-Blueprints der dritten Fraktion auf Basis von `docs/design/factions/f3/faction.md`, überarbeitet nach dem Review vom 2026-09-29 (§21). Maschinenlesbar in `docs/design/factions/f3/roster.json` (Schema `faf-roster/1`, dasselbe wie Varkan). **`roster.json` ist die einzige Quelle für Zahlen, ●/○-Status und Kitbash-Parts**; dieses Dokument ist daraus generiert (`tools/roster/f3/md.py`). Später Grundlage der Blueprints (`content/blueprints/f3/…`).
> **Umfang:** **50 Blueprints** (23 mobil, 27 Gebäude, jede Upgrade-Stufe einzeln), davon **26 im MS9-Kern (●)**, Rest bis MS14 (○). Rollen, Rollen-Tokens, Icon-IDs, Hotbuild-Slots, Visual-IDs und ●/○-Status sind **identisch zu Varkan** (`docs/design/roster.md`); der Generator erzwingt das. 28 Visuals, 19 Icon-Glyphen. Waffen-, Projektil- und Basis-BPs sind nicht mitgezählt. Dazu 5 Experimentals (T4, Post-MVP, §22), nicht mitgezählt.
> **Ausgeschlossen (Post-MVP laut features.json):** wie Varkan (TML/TMD, Nukes/SMD, Transporter U13, T3-Luft U12, Marine U17/U18, Experimentals, E15, SACU U15, ACU-Enhancements U14, Stealth/Omni I4/I5). Reservename: *Nautilus* (T3-Schwebepanzer). Experimentals als Post-MVP-Daten in §22 (*Perle* ist jetzt das Eco-Experimental).
> **Balancing:** Hartes Gate PLAN U3: DPS/Mass und HP/Mass je ±25 % der FA-Referenz **der Vorbild-Fraktion**. Der Generator erzwingt strenger: Einzelachsen, Produkt und Pulk-DPS/Mass der Artillerie je ±15 %, eine Treffer-bis-Tod-Matrix exakt nach Vorbild und **Kreuz-Breakpoints gegen Varkan** (`faction.md` §9.4). Asymmetrien mit Post-MVP-Mechanik sind je Blueprint in `special.postMvp` markiert; die Kern-Balance gilt mit dem MVP-Fallback.

---

## 1. Quellen und Methodik

- **Methodik:** wie Varkan (`docs/design/roster.md` §1): Δ = (unser Wert / FA-Wert − 1) × 100, Produkt, Pulk-Modell π · (Splash + 0,5)² / 4, Treffer bis Tod = ⌈Ziel-HP / Salvenschaden⌉, `reloadS` auf 0,1-s-Ticks, Maßstabsregeln, Superset-Visuals. Unterschiede stehen unten.
- **FA-Referenz:** die Einheit der **Vorbild-Fraktion** derselben Rolle, aus `tools/roster/f3/fa_ref.json` ([spooky-db](https://github.com/FAForever/spooky-db) `app/data/index.json`, Datenstand 3810, DPS nach `app/js/dps.js`). Die Varkan-Referenz derselben Rolle steht als Gegenprobe in `faReference.crossCheckBp`. Wo das Vorbild keine Einheit hat (T2-Läufer, Jagdbomber, T3-Präzision), steht die Wahl in `faReference.role`. Nur Blueprint-IDs und generische Rollenbezeichnungen werden zitiert; `faReference` ist dev-only.
- **Personal-Schilde:** Bei Zielen mit Personal-Schild (Vorbild-T2-Panzer, T3-Läufer; Varkan-Seite: T3-Referenz) zählt der Schild in der FA-Treffer-Rechnung zur Ziel-HP. Im Roster steckt er bis K10 in `health.max` (Fallback, §16).
- **Kreuz-Breakpoints:** `checks.crossHitsToKill` rechnet Waffen der einen Fraktion gegen Ziele der anderen: unsere Werte (Sael-Roster bzw. Varkan-`roster.json`) gegen die FA-Referenzen beider Rollen (`tools/roster/f3/fa_ref.json` bzw. `tools/roster/fa_ref.json`). `required: true` muss exakt passen; `required: false` sind Info-Paare, bei denen Varkan selbst von FA abweicht.
- **Prüfung:** `tools/roster/f3/gen.py` erzeugt `roster.json` und bricht bei jedem Gate-Verstoß ab; `tools/roster/f3/validate.py` rechnet alles unabhängig aus den Rohfeldern nach (auch Kreuz-Breakpoints, Monopol-Lints, FA-Begriffe in Anzeigefeldern) und endet mit Exit 1 bei Verstoß.
- **Kitbash:** Parts aus `faction.md` §3.3; `[mat]` = `team`, `gold`, `glow`, `jade`, sonst `body` (Perlmutt). Tris: `shell` 60, `hoverpad` 32, `legs` 60, `orb` 80, `lance` 12, `horn` 32, `spine` 10, `sickle` 48, `ring` 72, `arch` 36, `mast` 24, `fan` 16, `lantern` 64, `wing` 16. Lints (§5.3 Nr. 6): `spine` nur Flugabwehr am Boden, `horn` nur `ARTILLERY`, `lance` nur mit `orb`, höchstens eine `orb`, `orb` ohne `lance` nur in Flow-Kategorien, `lantern`/`sickle`/`glow` nur ECONOMIC, FACTORY, ENGINEER, `hoverpad` genau bei Schwebern, mindestens ein Team-Part.
- **Spalten:** ● = MS9-Kern · MS = erster Meilenstein laut PLAN §5 · RW = Reichweite · s = sizeClass · Sicht / R = Radar · Gangart Schweber/Läufer/Luft (`motion.gait`).

### 1.1 Prüfung der auffälligen spooky-Werte gegen FAF `develop`

Geprüft gegen [FAForever/fa](https://github.com/FAForever/fa) `develop`, `units/<BP>/<BP>_unit.bp` (Stand 2026-09-29). Korrekturen stehen in `conventions.faOverrides` und werden von Generator und Prüfer gleich angewendet.

| BP | Rolle | spooky 3810 | develop | Ergebnis |
|---|---|---|---|---|
| `UAL0103` | `lnd_t1_arty` | 200 Schaden / 2,0 s, Splash 0,5 = 100 DPS | identisch (RateOfFire 10/20, FiringRandomness 0,35) | bestätigt: Präzisions-Mörser gegen Stellungen; die Wirkung gegen bewegte Einheiten begrenzen Flugzeit (mv 14), Splash 0,5 und Streuung (K1). |
| `UAA0102` | `air_t1_fighter` | 24 DPS | 2 Waffen × 3 × 8 / 1,0 s = 48 DPS | spooky-Fehler (nur eine von zwei Waffen gezählt) → Referenz 48 DPS (FA_OVERRIDES). |
| `UAA0103` | `air_t1_bomber` | 200 / 5,0 s, Splash 4 = 40 DPS | identisch | bestätigt: eine große Bombe mit großem Splash statt Brandteppich (Referenz der Gegenseite 70 DPS inkl. DoT). |
| `UAL0201` | `lnd_t1_tank` | 40 / 1,6 s | 40 / 1,7 s (RateOfFire 10/17) | leichte Änderung nach 3810; Roster bleibt auf 3810 wie Varkan (Nachziehen vor MS9). |
| `UAB2301` | `str_t2_pd` | 600 / 4,0 s | 560 / 4,0 s | leichte Änderung nach 3810; Breakpoints unverändert (Brecher 4 Salven, Kauri 1 Schuss). |
| `UAB2302` | `str_t3_arty` | 73.200 Mass | 79.000 Mass | nach 3810 verteuert; Sintflut ist ohnehin auf MVP-Kartengröße skaliert. |
| `DEL0204` | `lnd_t2_bot (Gegenprobe)` | 38,79 DPS (nur Gatling) | zwei Waffen: 38,79 + 30,3 | summiert 69,09 wie Varkan-fa_ref; betrifft nur die Gegenprobe (faction.md §9.2 A7 nannte deshalb +43 % statt −20 %). |
| `XAL0305` | `lnd_t3_sniper` | 950 / 6,6 s, RW 60 | 950 / 6,7 s (RateOfFire 10/67), RW 65 | Review 2026-09-29: leichte Änderung nach 3810; Breakpoint Konus → Triton (3 Treffer) bleibt, Nachziehen vor MS9. |
| `UAL0103/UAL0304/UAB2303/UAB2302` | `Artillerie-Streuung` | nicht enthalten | FiringRandomness 0,35 / 1,0 / 2,0 / 0,35 | Review 2026-09-29: als weapons[].firingRandomness übernommen (FA-Semantik, K1 legt die Umrechnung fest). |
| `UAA0101/0102/0103/0203` | `air` | Physics.MaxSpeed 0,5 | Air.MaxAirspeed 19 / 15 / 10 / 12 | Luft-Tempi aus develop (AIR_SPEED), wie Varkan. |

---

## 2. Zählung nach Meilenstein

| MS | neu gebraucht | Blueprints |
|---|---|---|
| MS4 | 3 (Σ 3) | ● Prior, ● Brunnen I, ● Laterne I |
| MS5 | 1 (Σ 4) | ● Kauri |
| MS6 | 4 (Σ 8) | ● Novize, ● Knallkrebs, ● Schrein, ● Landkapitel I |
| MS7 | 3 (Σ 11) | ● Glimmer, ● Dünung, ● Seeigel |
| MS8 | 13 (Σ 24) | ● Akolyth, ● Triton, ● Brecher, ● Seestern, ● Brunnen II, ● Laterne II, ● Landkapitel II, ● Riff I, ● Riff II, ● Seelilie I, ● Seelilie II, ● Hochlilie, ● Deich |
| MS10 | 4 (Σ 28) | ● Quellbogen, ● Zisterne, ○ Warte I, ○ Warte II |
| MS12 | 7 (Σ 35) | ○ Seeschwalbe, ○ Sturmvogel, ○ Tölpel, ○ Albatros, ○ Raubmöwe, ○ Luftkapitel I, ○ Luftkapitel II |
| MS13 | 14 (Σ 49) | ○ Kustos, ○ Muschel, ○ Einsiedler, ○ Woge, ○ Konus, ○ Diadem, ○ Brunnen III, ○ Laterne III, ○ Landkapitel III, ○ Warte III, ○ Perlmutt II, ○ Perlmutt III, ○ Brandung, ○ Sintflut |
| MS14 | 1 (Σ 50) | ○ Languste |

**MS9-Kern (26):** Prior, Novize, Akolyth, Glimmer, Knallkrebs, Kauri, Dünung, Seeigel, Triton, Brecher, Seestern, Brunnen I, Brunnen II, Laterne I, Laterne II, Quellbogen, Zisterne, Schrein, Landkapitel I, Landkapitel II, Riff I, Riff II, Seelilie I, Seelilie II, Hochlilie, Deich.

- Dieselbe Herleitung wie Varkan: 23 Blueprints folgen aus PLAN MS4–MS8, drei sind Daten-Vorgriffe (Schrein ab MS6 für den Glanzstoß, Zisterne, Quellbogen). Hochlilie ist ●, in MS8 per Konsole/Test-Szenario gespawnt, baubar ab MS13 (Kustos).
- **Kreuz-Matches** (U19/U22) setzen beide Kerne voraus; der Sael-Kern deckt dieselben 26 Rollen ab wie der Varkan-Kern.

### 2.1 Abgrenzungen und Abweichungen

| Punkt | Festlegung | Grund |
|---|---|---|
| Rollen, ●/○, Hotbuild, Icons, Visual-IDs | identisch zu Varkan | Muskelgedächtnis und gemeinsame Icon-Grammatik (`faction.md` §6, §7.3); vom Generator erzwungen |
| Perlmutt III | Upgrade von Perlmutt II wie Varkan | gleicher Hotbuild-Weg; das Vorbild baut den T3-Schild neu. Kosten = Vorbild-Neubaukosten als Upgrade-Kosten (Gesamt 2.880 statt 2.400 Mass). |
| Languste (T2-Läufer) | Relation der schnellen T2-Sturmeinheit des Vorbilds (Schwebepanzer) | Vorbild hat keinen T2-Bot; Asymmetrie A7 |
| Raubmöwe (Jagdbomber) | FAF-T2-Jagdbomber als Referenz (wie Varkan), Vorbild-T2-Luftkampf als Gegenprobe | Vorbild hat keinen Jagdbomber |
| Konus | schwebt statt zu laufen | Sael-Identität; Icon `land_sniper_t3` bleibt (Glyphe = Rolle) |
| DoT-Waffen des Vorbilds (Woge, Brandung, Sintflut) | ein Einschlag mit derselben Schadenssumme | kein DoT-System im MVP; Breakpoints und Pulk bleiben gleich |

---

## 3. Hotbuild-Raster (identische Slots wie Varkan)

Gleiche Taste = gleiche Rolle über alle Tech-Stufen; mehrfaches Drücken wechselt nur die Tech-Stufe (höchste baubare zuerst). Upgrade-Stufen über das Upgrade-Kommando der Command Card. Das Bau-Menü nutzt die 5. Spalte (T), weil 13 Rollen nicht auf 12 Tasten passen. T4 im eigenen Tab des Bau-Menüs (Q Land-Sturm, W Game-Ender, E Land-Festung, R Luft, T Eco), Tastenbelegung fraktionsübergreifend.

**Landkapitel (Fabrik-Menü)**

| | Q / A / Z | W / S / X | E / D / C | R / F / V | T / G / B |
|---|---|---|---|---|---|
| Reihe 1 | **Q** Schwebepanzer (Kauri/Triton) | **W** Artillerie (Dünung/Brecher/Woge) | **E** Engineer (Novize/Akolyth/Kustos) | **R** Flugabwehr (Seeigel/Seestern/Diadem) | – |
| Reihe 2 | **A** Späher (Glimmer) | **S** Läufer (Knallkrebs/Languste/Einsiedler) | **D** Support (Muschel) | **F** Präzision (Konus) | – |

**Luftkapitel (Fabrik-Menü)**

| | Q / A / Z | W / S / X | E / D / C | R / F / V | T / G / B |
|---|---|---|---|---|---|
| Reihe 1 | **Q** Abfangjäger (Sturmvogel) | **W** Bomber (Tölpel) | **E** Gunship (Albatros) | **R** Jagdbomber (Raubmöwe) | – |
| Reihe 2 | **A** Aufklärer (Seeschwalbe) | – | – | – | – |

**Bau-Menü (Prior und Engineers)**

| | Q / A / Z | W / S / X | E / D / C | R / F / V | T / G / B |
|---|---|---|---|---|---|
| Reihe 1 | **Q** Brunnen | **W** Laterne | **E** Quellbogen | **R** Zisterne | **T** Schrein |
| Reihe 2 | **A** Landkapitel | **S** Luftkapitel | **D** Warte | **F** Perlmutt | – |
| Reihe 3 | **Z** Riff | **X** Seelilie/Hochlilie | **C** Deich | **V** Brandung/Sintflut | – |

---

## 4. Prior und Engineers

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f3:cmd_commander` | **Prior** / Prior | Kommandant / Commander | Armored Command Unit (ACU) (`UAL0001`, Gegenprobe `UEL0001`) | MS4 | 2.000 / 5.000.000 / 6.000.000 | 11.000 | 1,7 / 90° · Schweber | 2×2 / s2 | 26 | – | `cmd_commander` |
| ● | `f3:lnd_t1_engineer` | **Novize** / Novice | Ingenieur / Engineer | T1 Engineer (`UAL0105`, Gegenprobe `UEL0105`) | MS6 | 52 / 260 / 260 | 125 | 1,9 / 180° · Schweber | 1×1 / s1 | 18 | Landkapitel: E | `eng_build_t1` |
| ● | `f3:lnd_t2_engineer` | **Akolyth** / Acolyte | Ingenieur / Engineer | T2 Engineer (`UAL0208`, Gegenprobe `UEL0208`) | MS8 | 130 / 650 / 650 | 350 | 1,9 / 150° · Schweber | 1×1 / s1 | 20 | Landkapitel: E | `eng_build_t2` |
| ○ | `f3:lnd_t3_engineer` | **Kustos** / Custodian | Ingenieur / Engineer | T3 Engineer (`UAL0309`, Gegenprobe `UEL0309`) | MS13 | 310 / 1.550 / 1.550 | 700 | 1,9 / 120° · Schweber | 1×1 / s1 | 26 | Landkapitel: E | `eng_build_t3` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `cmd_commander` | `wpn_prior_lance` Prior-Lanze (Direktfeuer): 100 / 1 s = **100 DPS**, RW 1–22, linear<br>`wpn_prior_lustre` Glanzstoß (Sonderschuss, manuell/auto): 15.000 / 3,3 s = **4.545,4 DPS**, RW 22, linear, Splash 2,5<br>*wpn_prior_lustre:* Dieselben Konstanten wie Varkans Abstich (FAF-Formel OverchargeProjectile/OverchargeShared, FA-Relation fraktionsgleich): Schaden = clamp(max. HP der mobilen Nicht-Kommandanten im Umkreis 2,7 WU [ohne Ziel: 1250], 1250, min(15000, 0,9 x Vorrat / 6)); Drain = 6 x Schaden; gegen Strukturen fix 800, gegen Kommandanten fix 400; Feuern ab 7500 E Vorrat (braucht Schrein). Nicht in DPS/Mass gewertet. | 0,05 (0,05) | ±0 % | 5,5 (5,5) | ±0 % | ±0 % |
| `lnd_t1_engineer` | – | – (–) | – | 2,404 (2,308) | +4,2 % | – |
| `lnd_t2_engineer` | – | – (–) | – | 2,692 (2,615) | +2,9 % | – |
| `lnd_t3_engineer` | – | – (–) | – | 2,258 (2,179) | +3,6 % | – |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `cmd_commander` | LAND MOBILE HOVER COMMAND ENGINEER DIRECTFIRE RECLAIM REPAIR UNIQUE | BP 10 · +1 M/s · +20 E/s · Speicher 650 M · Speicher 3.900 E<br>Toggles: auto_lustre (MS10, C17)<br>Death: `wpn_pearl_crack` 2.000/r30 + 500/r40 (Perlsprung, Kamera-Shake X4, FA-Relation 1:1 (fraktionsgleich))<br>Einzigartig, Tod = Niederlage (U1/A4, „Perle gesprungen. Obhut erloschen.“). Baut alle T1-Strukturen. Regeneration 10 HP/s. HP 11.000 nach Vorbild-Relation (8 % unter dem Vogt); DPS, Glanzstoß und Perlsprung fraktionsgleich.<br>**Post-MVP M13:** Amphibischer/schwebender Prior (Vorbild-ACU ist amphibisch) — *MVP:* Layer land<br>**Post-MVP U14:** Enhancements: Teleport, Personal-Schild; Zeitdämpfer zusätzlich mit K18 — *MVP:* entfällt | Schwebender Kegelrock (Höhe ≥ 2,4 WU, Rockbreite ≥ 2,0 WU) mit drei teamfarbenen Bahnen, Brustschale, größte Perle als Kopf; goldene Halo-Sichel hinter dem Kopf (stärkster Goldkern der Armee), Lanze mittig waagerecht vor der Brust; kein Waffen-/Bauarm-Schema, keine Beine.<br>shell(kegelrock) [team], shell(brustschale), orb(kopfperle) ⟳yaw [team], lance(brustlanze) ⟳pitch, sickle(halo sichel) [glow], hoverpad — 6 Parts, 2 anim., ≈ 292 Tris · Maßstab 1 · keine Streifen · Schwebehöhe 0,25 WU | MS4 Bauen ohne Waffe; MS5 Lanze + Perlsprung; MS6 Glanzstoß (U8) |
| `lnd_t1_engineer` | LAND MOBILE HOVER ENGINEER TECH1 RECLAIM REPAIR<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | BP 5<br>Baut, assistiert, reclaimt, repariert. Vorbild-Engineers schweben über Wasser; hier nur Land (M13/U17). Baut T1-Strukturen. Zerbrechlicher als der Lehrling (A6).<br>**Post-MVP M13, U17:** Bauen auf Wasser (schwebende Engineers) — *MVP:* kein Bau auf Wasser | Kurze breite Schale auf Schwebeteller, Rand-Band teamfarben, goldene Deckplatte; goldene Sichel vom linken Heck über das Deck nach vorn rechts, Goldkern-Emitter an der Sichelspitze (umschlossen). 1 Tech-Streifen Tiefjade.<br>shell(schale mit randband) [team], wing(deckplatte) [gold], hoverpad, sickle(sichel) ⟳yaw [gold], orb(emitter) ⟳pitch [glow] — 5 Parts, 2 anim., ≈ 236 Tris · Maßstab 1 · 1 Streifen (Tiefjade) · Schwebehöhe 0,25 WU | U2 (T1) in MS6 |
| `lnd_t2_engineer` | LAND MOBILE HOVER ENGINEER TECH2 RECLAIM REPAIR<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | BP 13<br>Baut, assistiert, reclaimt, repariert. Vorbild-Engineers schweben über Wasser; hier nur Land (M13/U17). Baut T1+T2-Strukturen (u. a. Brunnen II direkt, Laterne II, Riff II, Seelilie II, Perlmutt II).<br>**Post-MVP M13, U17:** Bauen auf Wasser (schwebende Engineers) — *MVP:* kein Bau auf Wasser | Wie Novize, Maßstab 1,3, zwei Sicheln verschiedener Größe, 2 Tech-Streifen Tiefjade.<br>shell(schale mit randband) [team], wing(deckplatte) [gold], hoverpad, sickle(sichel) ⟳yaw [gold], sickle(kleine sichel) ⟳yaw [gold], orb(emitter) [glow] — 6 Parts, 2 anim., ≈ 284 Tris · Maßstab 1,3 · 2 Streifen (Tiefjade) · Schwebehöhe 0,3 WU | U2 T2 als Daten in MS8 |
| `lnd_t3_engineer` | LAND MOBILE HOVER ENGINEER TECH3 RECLAIM REPAIR<br>*von:* `FACTORY & LAND & TECH3` | BP 32<br>Baut, assistiert, reclaimt, repariert. Vorbild-Engineers schweben über Wasser; hier nur Land (M13/U17). Baut T1–T3-Strukturen (Hochlilie, Sintflut, Laterne III, Brunnen III).<br>**Post-MVP M13, U17:** Bauen auf Wasser (schwebende Engineers) — *MVP:* kein Bau auf Wasser | Maßstab 1,4 (Deckel für 1×1-Footprint), drei Sicheln (Anzahl = Tech), 3 Tech-Streifen Tiefjade; dritte Sichel statisch (Anim-Limit 2).<br>shell(schale mit randband) [team], wing(deckplatte) [gold], hoverpad, sickle(sichel) ⟳yaw [gold], sickle(kleine sichel) ⟳yaw [gold], sickle(dritte sichel) [gold], orb(emitter) [glow] — 7 Parts, 2 anim., ≈ 332 Tris · Maßstab 1,4 · 3 Streifen (Tiefjade) · Schwebehöhe 0,35 WU | Rest U2 (T3-Engineer) in MS13 |

---

## 5. Landarmee T1

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f3:lnd_t1_scout` | **Glimmer** / Glimmer | Späher / Scout | T1 Land Scout (`UAL0101`, Gegenprobe `UEL0101`) | MS7 | 8 / 60 / 60 | 22 | 4,6 / 90° · Schweber | 1×1 / s1 | 26 / R 48 | Landkapitel: A | `land_intel_t1` |
| ● | `f3:lnd_t1_bot` | **Knallkrebs** / Pistol Shrimp | Leichter Sturmläufer / Light Assault Walker | T1 Light Assault Bot (`UAL0106`, Gegenprobe `UEL0106`) | MS6 | 42 / 165 / 160 | 116 | 3,8 / 60° · Läufer | 1×1 / s1 | 18 | Landkapitel: S | `land_bot_t1` |
| ● | `f3:lnd_t1_tank` | **Kauri** / Cowrie | Leichter Schwebepanzer / Light Hover Tank | T1 Medium Tank (`UAL0201`, Gegenprobe `UEL0201`) | MS5 | 54 / 270 / 290 | 170 | 3 / 90° · Schweber | 1×1 / s1 | 20 | Landkapitel: Q | `land_direct_t1` |
| ● | `f3:lnd_t1_arty` | **Dünung** / Swell | Mobile Artillerie / Mobile Artillery | T1 Mobile Light Artillery (`UAL0103`, Gegenprobe `UEL0103`) | MS7 | 36 / 180 / 200 | 160 | 2,7 / 90° · Schweber | 1×1 / s1 | 18 | Landkapitel: W | `land_arty_t1` |
| ● | `f3:lnd_t1_aa` | **Seeigel** / Urchin | Mobile Flugabwehr / Mobile AA | T1 Mobile Anti-Air Gun (`UAL0104`, Gegenprobe `UEL0104`) | MS7 | 55 / 275 / 220 | 280 | 2,8 / 80° · Schweber | 1×1 / s1 | 20 | Landkapitel: R | `land_aa_t1` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `lnd_t1_scout` | `wpn_glimmer_ray_t1` Lichtnadel (starr im Bug, 90°): 2 / 2 s = **1 DPS**, RW 33, linear | 0,125 (0,125) | ±0 % | 2,75 (2,5) | +10 % | +10 % |
| `lnd_t1_bot` | `wpn_shrimp_lance_t1` Pulslanze (3er-Stoß): 3×9 / 1 s = **27 DPS**, RW 14, linear | 0,643 (0,643) | ±0 % | 2,762 (2,738) | +0,9 % | +0,9 % |
| `lnd_t1_tank` | `wpn_lance_t1` Lanze: 40 / 1,6 s = **25 DPS**, RW 26, linear | 0,463 (0,463) | ±0 % | 3,148 (2,87) | +9,7 % | +9,7 % |
| `lnd_t1_arty` | `wpn_horn_t1` Horn-Mörser (Präzision): 200 / 2 s = **100 DPS**, RW 5–30, ballistisch, Splash 0,5<br>Pulk-DPS/Mass 2,182 (FA 2,182): ±0 %<br>*wpn_horn_t1:* Vorbild-Relation (develop bestätigt): Stellungsbrecher. Streuung firingRandomness 0,35 wie Vorbild ist Pflicht (K1), sonst ist die Wirkung gegen bewegte Einheiten zu hoch. Abnahme MS7 (K1/K2): 4 Dünungen gegen 4 Punzen im Zickzack (Richtungswechsel alle 2 s) auf 25–30 WU, Trefferquote ≤ 30 % (Richtwert); gegen stehende Ziele ≥ 80 %. Liegt sie darüber: Nachladezeit 2,0 → 3,0 s (roster.md §20). Horn leuchtet 0,5 s vor dem Schuss (nur View). | 2,778 (2,778) | ±0 % | 4,444 (4,167) | +6,7 % | +6,7 % |
| `lnd_t1_aa` | `wpn_spine_t1` Stachelsalve (3er-Stoß): 3×8 / 1 s = **24 DPS**, RW 35, linear (Vorhalt) [Luft] | 0,436 (0,436) | ±0 % | 5,091 (4,818) | +5,7 % | +5,7 % |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `lnd_t1_scout` | LAND MOBILE HOVER SCOUT INTELLIGENCE TECH1 DIRECTFIRE<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Billig und weitsichtig (A8): Mass −33 % zum Funken, Waffen-RW 33 statt 22, Radar 48. Kein Turm; Waffe starr im Rumpf, arcDeg 90. | Kleinste Schale (Einlage teamfarben) auf Schwebeteller, hohe dünne Nadel ≥ 1,0 × Rumpflänge ohne Kopfteil, Lichtnaht an der Spitze.<br>shell [team], hoverpad, mast(nadel) — 3 Parts, 0 anim., ≈ 116 Tris · Maßstab 1 · 1 Streifen (Tiefjade) · Schwebehöhe 0,25 WU | U4 T1-Armee in MS7; Radar-Feld wirkt ab MS10 (I3) |
| `lnd_t1_bot` | LAND MOBILE DIRECTFIRE BOT TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Robuster Überfall-Läufer (A2): Mass +31 %, HP/Mass +26 %, DPS/Mass −12 % zum Stichel. Konter gegen Schweber-Artillerie. HP 116 hält die Kreuz-Breakpoints (Kauri-Zahl der Stichel-/Punze-Treffer wie FA). | Breiter Krebs-Rückenschild (breiter als lang) auf spitzen Beinen, Perle mit kurzer waagerechter Lanze; kein Schwebeteller.<br>legs, shell(rueckenschild) [team], orb ⟳yaw [team], lance ⟳pitch — 4 Parts, 2 anim., ≈ 212 Tris · Maßstab 1 · 1 Streifen (Tiefjade) | erste Fabrik-Einheit im Opening (MS6); U4 abgenommen MS7 |
| `lnd_t1_tank` | LAND MOBILE HOVER DIRECTFIRE TANK TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Reichweite statt Panzerung (A1): RW 26 gegen 18 der Punze, HP/Mass −41 %. HP 170 hält die Kreuz-Breakpoints: 7 Punze-, 2 Vogt-, 4 Riegel-I-Treffer; 8 eigene Treffer töten eine Punze. | Tropfenförmige Schale 1,0 × 0,35 × 1,4 WU auf Schwebeteller (Schattensaum 10 %), teamfarbene Perle Ø 0,45 WU, waagerechte Lanze 0,95 WU (≈ 68 % der Rumpflänge) über die Tropfenspitze, goldener Schaft.<br>shell [team], hoverpad, orb ⟳yaw [team], lance ⟳pitch, lance(schaft) [gold] — 5 Parts, 2 anim., ≈ 196 Tris · Maßstab 1 · 1 Streifen (Tiefjade) · Schwebehöhe 0,25 WU | erste Kampfeinheit (Konsole, MS5), Fabrik ab MS6 |
| `lnd_t1_arty` | LAND MOBILE HOVER INDIRECTFIRE ARTILLERY TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Einzelschuss-Präzision (A4): 1 Treffer tötet Knallkrebs, Novize und Kauri, 2 eine Punze, 7 einen Riegel I. Splash 0,5 ⇒ schwach gegen Pulks. | Schale auf Schwebeteller, Horn (weite Mündung, 50°) mittig auf kurzem Drehkranz, Heck-Gegenschale; keine Perle, keine waagerechte Lanze.<br>shell [team], hoverpad, mast(drehkranz) ⟳yaw, horn ⟳pitch, shell(gegenschale) — 5 Parts, 2 anim., ≈ 208 Tris · Maßstab 1 · 1 Streifen (Tiefjade) · Schwebehöhe 0,25 WU | K2 Ballistik in MS7 |
| `lnd_t1_aa` | LAND MOBILE HOVER ANTIAIR TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Nur Luftziele. RW 35 statt 30. | Schale auf Schwebeteller, Stachelkranz aus 3 dünnen senkrechten Stacheln (≥ 75°, Ø ≥ 0,17 WU) als Bogen quer zur Fahrtrichtung.<br>shell [team], hoverpad, spine(mittelstachel) ⟳yaw, spine, spine — 5 Parts, 1 anim., ≈ 122 Tris · Maßstab 1 · 1 Streifen (Tiefjade) · Schwebehöhe 0,25 WU | U4 in MS7, Wirkung gegen Luft MS12 |

---

## 6. Landarmee T2

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f3:lnd_t2_tank` | **Triton** / Triton | Schwerer Schildpanzer / Heavy Shield Tank | T2 Heavy Tank (`UAL0202`, Gegenprobe `UEL0202`) | MS8 | 360 / 1.800 / 1.600 | 2.750 (HP+Schild) | 2,7 / 90° · Schweber | 1×1 / s2 | 20 | Landkapitel: Q | `land_direct_t2` |
| ● | `f3:lnd_t2_mml` | **Brecher** / Breaker | Raketenwerfer / Missile Launcher | T2 Mobile Missile Launcher (`UAL0111`, Gegenprobe `UEL0111`) | MS8 | 180 / 1.350 / 800 | 780 | 2,8 / 90° · Schweber | 1×1 / s2 | 18 | Landkapitel: W | `land_mml_t2` |
| ● | `f3:lnd_t2_aa` | **Seestern** / Starfish | Flak / Flak | T2 Mobile AA Flak Artillery (`UAL0205`, Gegenprobe `UEL0205`) | MS8 | 160 / 800 / 800 | 1.050 | 2,7 / 90° · Schweber | 1×1 / s2 | 20 | Landkapitel: R | `land_aa_t2` |
| ○ | `f3:lnd_t2_shield` | **Muschel** / Clam | Mobiler Schild / Mobile Shield | T2 Mobile Shield Generator (`UAL0307`, Gegenprobe `UEL0307`) | MS13 | 220 / 1.080 / 790 | 110 | 4 / 120° · Schweber | 1×1 / s1 | 20 | Landkapitel: D | `land_shield_t2` |
| ○ | `f3:lnd_t2_bot` | **Languste** / Langouste | Sturmläufer / Assault Walker | T2 Assault Hover Tank (Vorbild hat keinen T2-Bot; Relation der schnellen T2-Sturmeinheit) (`XAL0203`, Gegenprobe `DEL0204`) | MS14 | 180 / 1.080 / 900 | 1.050 | 4 / 80° · Läufer | 1×1 / s1 | 24 | Landkapitel: S | `land_bot_t2` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `lnd_t2_tank` | `wpn_lance_t2` Doppellanze (Einzelstoß): 360 / 3 s = **120 DPS**, RW 20, linear | 0,333 (0,333) | ±0 % | 7,639 (7,639) (inkl. Schild) | ±0 % | ±0 % |
| `lnd_t2_mml` | `wpn_horn_missile_t2` Hornrakete (Einzelschuss): 600 / 10 s = **60 DPS**, RW 15–65, homing (Wenderate, K11), Splash 1<br>Pulk-DPS/Mass 0,589 (FA 0,589): ±0 % | 0,333 (0,333) | ±0 % | 4,333 (4,167) | +4 % | +4 % |
| `lnd_t2_aa` | `wpn_spine_flak_t2` Sprengstachel: 72 / 0,5 s = **144 DPS**, RW 40, linear + Näherungszünder (MS12), Splash 4 [Luft] | 0,9 (0,9) | ±0 % | 6,562 (6,25) | +5 % | +5 % |
| `lnd_t2_shield` | – | – (–) | – | 16,864 (16,364) (inkl. Schild) | +3,1 % | – |
| `lnd_t2_bot` | `wpn_langouste_lance_t2` Schnellfeuer-Lanzen: 15 / 0,3 s = **50 DPS**, RW 24, linear | 0,278 (0,278) | ±0 % | 5,833 (5,556) | +5 % | +5 % |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `lnd_t2_tank` | LAND MOBILE HOVER DIRECTFIRE TANK TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | Wenige teure Schwere (A3): Mass +80 % zum Meißel, 1 Schuss tötet Punze/Kauri/Knallkrebs, 5 einen Meißel. Balance-Basis HP + Schild.<br>**Post-MVP K10:** Personal-Schild: Rumpf 1.300 HP + Schild 1.450 HP, Regen 2/s ab 3 s nach dem letzten Treffer, Neuaufbau 75 s, 10 E/s — *MVP:* vor K10 (MS8–MS12): health.max = HP + Schild = 2.750, kein Unterhalt; (HP+Schild)/Mass bleibt gleich | Kauri ×1,3, lange Schale, große Perle mit zwei parallelen Lanzen (an der Perle geparentet), seitliche Schalenflügel, 2 Tech-Streifen; ab K10 Schildhülle (Shader).<br>shell [team], hoverpad, orb ⟳yaw [team], lance, lance, lance(schaft) [gold], shell(schalenfluegel) — 7 Parts, 1 anim., ≈ 268 Tris · Maßstab 1,3 · 2 Streifen (Tiefjade) · Schwebehöhe 0,3 WU | U6 in MS8 |
| `lnd_t2_mml` | LAND MOBILE HOVER INDIRECTFIRE ARTILLERY SILO TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | Einzelschuss-Präzision (A4): 600 statt 2×300; 4 Salven gegen Riff II und Riegel II wie FA. Lenkflugkörper mit begrenzter Wenderate (K11). | Horn-Paar nebeneinander (50°, an einem Drehkranz), Mündungen ≥ 2 × Stachel-Ø; keine Perle, keine Stacheln.<br>shell [team], hoverpad, mast(drehkranz) ⟳yaw, horn(horn links) ⟳pitch, horn(horn rechts) — 5 Parts, 2 anim., ≈ 180 Tris · Maßstab 1,3 · 2 Streifen (Tiefjade) · Schwebehöhe 0,3 WU | U6 inkl. MML über K11 in MS8 |
| `lnd_t2_aa` | LAND MOBILE HOVER ANTIAIR TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | Nur Luftziele, Splash trifft Pulks. | Seeigel ×1,3 mit 4 Stacheln im Kranz und Schalenflügeln, 2 Tech-Streifen.<br>shell [team], hoverpad, spine ⟳yaw, spine, spine, spine, shell(schalenfluegel) — 7 Parts, 1 anim., ≈ 192 Tris · Maßstab 1,3 · 2 Streifen (Tiefjade) · Schwebehöhe 0,3 WU | U6 in MS8, Wirkung/Näherungszünder MS12 |
| `lnd_t2_shield` | LAND MOBILE HOVER SHIELD DEFENSE TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | Toggles: shield (MS13, C17)<br>Schild 3.600 HP, r 15, Regen 58/s ab 3 s nach dem letzten Treffer, Neuaufbau 26 s, 55 E/s<br>Starke, kleine Schilde (A5): Schild/Mass +13 % zur Schürze, Radius 15 statt 16, Tempo 4,0 (folgt der Schweberlinie). Kuppelschild; Energy-Stall schaltet ab (E3). | Mast mit waagerechtem Ring (Ø ≥ 1,2 × Rumpfbreite) als höchstem Punkt, darunter zwei aufgeklappte Schalenhälften; keine Lanze, keine Perle.<br>shell [team], hoverpad, mast, ring(waagerecht) ⟳yaw [team], shell(aufgeklappte haelften) — 5 Parts, 1 anim., ≈ 248 Tris · Maßstab 1,3 · 2 Streifen (Tiefjade) · Schwebehöhe 0,3 WU | Rest U6 (mobiler Schild) mit K10 in MS13 |
| `lnd_t2_bot` | LAND MOBILE DIRECTFIRE BOT TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | Schnelle T2-Sturmeinheit (A7): schnell und zäh, kurze Reichweite (24 < Riff I 26) – Überfälle auf Engineers und Mex, nicht auf Stellungen. Tempo 4,0 (develop) statt 4,3 (3810). | Knallkrebs ×1,3 mit zweiter paralleler Lanze und seitlichen Schalenflügeln, 2 Tech-Streifen.<br>legs, shell(rueckenschild) [team], orb ⟳yaw [team], lance ⟳pitch, lance(zweite lanze), shell(schalenfluegel) — 6 Parts, 2 anim., ≈ 284 Tris · Maßstab 1,3 · 2 Streifen (Tiefjade) | Roster-Auffüllung auf 45–55 BP (MS14); nicht Teil von U6 |

---

## 7. Landarmee T3

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ○ | `f3:lnd_t3_bot` | **Einsiedler** / Hermit | Belagerungsläufer / Siege Walker | T3 Heavy Assault Bot (`UAL0303`, Gegenprobe `UEL0303`) | MS13 | 840 / 9.600 / 3.600 | 4.700 (HP+Schild) | 2,9 / 100° · Läufer | 2×2 / s2 | 22 | Landkapitel: S | `land_bot_t3` |
| ○ | `f3:lnd_t3_arty` | **Woge** / Billow | Schwere Artillerie / Heavy Artillery | T3 Mobile Heavy Artillery (`UAL0304`, Gegenprobe `UEL0304`) | MS13 | 800 / 8.000 / 4.300 | 950 | 2,2 / 75° · Schweber | 2×2 / s2 | 26 | Landkapitel: W | `land_arty_t3` |
| ○ | `f3:lnd_t3_sniper` | **Konus** / Conus | Präzisionsschweber / Sniper Hover | T3 Sniper Bot (Vorbild-Fraktion) (`XAL0305`) | MS13 | 700 / 25.000 / 4.950 | 520 | 2,4 / 110° · Schweber | 1×1 / s1 | 26 | Landkapitel: F | `land_sniper_t3` |
| ○ | `f3:lnd_t3_aa` | **Diadem** / Diadem | Schwere Flugabwehr / Heavy AA | T3 Mobile Missile AA (FAF) (`DALK003`, Gegenprobe `DELK002`) | MS13 | 600 / 7.500 / 3.000 | 1.800 | 3,3 / 100° · Schweber | 1×1 / s2 | 26 | Landkapitel: R | `land_aa_t3` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `lnd_t3_bot` | `wpn_hermit_lance_t3` Schwere Lanze: 160 / 0,5 s = **320 DPS**, RW 27, linear | 0,381 (0,381) | ±0 % | 5,595 (5,476) (inkl. Schild) | +2,2 % | +2,2 % |
| `lnd_t3_arty` | `wpn_horn_t3` Schweres Horn: 1.425 / 20 s = **71,2 DPS**, RW 25–90, ballistisch, Splash 3<br>Pulk-DPS/Mass 0,857 (FA 0,857): ±0 %<br>*wpn_horn_t3:* Vorbild verteilt den Schaden als DoT (15 Pulse à 95 über 4,2 s); hier ein Einschlag mit derselben Summe (kein DoT-System im MVP). | 0,089 (0,089) | ±0 % | 1,188 (1,125) | +5,6 % | +5,6 % |
| `lnd_t3_sniper` | `wpn_conus_lance_t3` Langlanze (Präzision): 950 / 6,6 s = **143,9 DPS**, RW 60, linear (schnell) | 0,206 (0,206) | ±0 % | 0,743 (0,714) | +4 % | +4 % |
| `lnd_t3_aa` | `wpn_spine_missile_t3` Stachelrakete: 1.200 / 5,9 s = **203,4 DPS**, RW 64, homing (K11), Splash 1,5 [Luft] | 0,339 (0,339) | ±0 % | 3 (2,833) | +5,9 % | +5,9 % |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `lnd_t3_bot` | LAND MOBILE DIRECTFIRE BOT TECH3<br>*von:* `FACTORY & LAND & TECH3` | Wenige teure Schwere (A3): Mass +68 % zum Fallhammer, DPS/Mass +27 %. Balance-Basis HP + Schild.<br>**Post-MVP K10:** Personal-Schild: Rumpf 3.700 HP + Schild 1.000 HP, Regen 30/s ab 2 s, Neuaufbau 30 s, 30 E/s (gewundene Schale als Emitter) — *MVP:* vor K10: health.max = HP + Schild = 4.700 | Überbreiter Rückenschild auf Beinen, Perle mit zwei Lanzen, obenauf eine gewundene Schale (Schild-Emitter ab K10), 3 Tech-Streifen; keine zweite Perle (Budget).<br>legs, shell(rueckenschild) [team], orb ⟳yaw [team], lance ⟳pitch, lance(zweite lanze), shell(gewundene schale) — 6 Parts, 2 anim., ≈ 284 Tris · Maßstab 1,7 · 3 Streifen (Tiefjade) | U10 T3-Landarmee in MS13 |
| `lnd_t3_arty` | LAND MOBILE HOVER INDIRECTFIRE ARTILLERY TECH3<br>*von:* `FACTORY & LAND & TECH3` | Seltener, schwerer Einschlag statt Takt: 1.425 alle 20 s (Pfanne 700 / 10 s). Kein Deploy. | Dünung ×1,7 mit überlanger Schale, 3 Tech-Streifen.<br>shell(ueberlange schale) [team], hoverpad, mast(drehkranz) ⟳yaw, horn ⟳pitch, shell(gegenschale) — 5 Parts, 2 anim., ≈ 208 Tris · Maßstab 1,7 · 3 Streifen (Tiefjade) · Schwebehöhe 0,35 WU | U10 in MS13 |
| `lnd_t3_sniper` | LAND MOBILE HOVER DIRECTFIRE SNIPER TECH3<br>*von:* `FACTORY & LAND & TECH3` | Schwebt (Vorbild: Läufer); Icon bleibt land_sniper_t3. 3 Treffer töten einen Triton. | Schmale, lange Schale, Perle mit extrem langer Lanze (≥ 1,4 × Rumpflänge), keine zweite Lanze; Maßstab 1,4 (1×1-Deckel).<br>shell(lange schale) [team], hoverpad, orb ⟳yaw [team], lance(langlanze) ⟳pitch — 4 Parts, 2 anim., ≈ 184 Tris · Maßstab 1,4 · 3 Streifen (Tiefjade) · Schwebehöhe 0,35 WU | U10 in MS13 |
| `lnd_t3_aa` | LAND MOBILE HOVER ANTIAIR TECH3<br>*von:* `FACTORY & LAND & TECH3` | Nur Luftziele. Einzelschuss 1.200: 1 Treffer tötet Albatros und Raubmöwe. | Seeigel ×1,4 (1×1-Deckel) mit 5 Stacheln im Kranz, 3 Tech-Streifen.<br>shell [team], hoverpad, spine ⟳yaw, spine, spine, spine, spine — 7 Parts, 1 anim., ≈ 142 Tris · Maßstab 1,4 · 3 Streifen (Tiefjade) · Schwebehöhe 0,35 WU | U10 in MS13 |

---

## 8. Luftwaffe T1–T2

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ○ | `f3:air_t1_scout` | **Seeschwalbe** / Tern | Aufklärer / Air Scout | T1 Air Scout (`UAA0101`, Gegenprobe `UEA0101`) | MS12 | 40 / 580 / 200 | 28 | 18 / 100° · Luft | 1×1 / s0 | 42 / R 64 | Luftkapitel: A | `air_intel_t1` |
| ○ | `f3:air_t1_fighter` | **Sturmvogel** / Petrel | Abfangjäger / Interceptor | T1 Interceptor (`UAA0102`, Gegenprobe `UEA0102`) | MS12 | 50 / 2.250 / 500 | 285 | 15 / 120° · Luft | 1×1 / s0 | 28 | Luftkapitel: Q | `air_aa_t1` |
| ○ | `f3:air_t1_bomber` | **Tölpel** / Gannet | Bomber / Bomber | T1 Attack Bomber (`UAA0103`, Gegenprobe `UEA0103`) | MS12 | 90 / 2.050 / 500 | 215 | 10 / 80° · Luft | 1×1 / s0 | 32 / R 40 | Luftkapitel: W | `air_bomb_t1` |
| ○ | `f3:air_t2_gunship` | **Albatros** / Albatross | Kampfschweber / Gunship | T2 Gunship (`UAA0203`, Gegenprobe `UEA0203`) | MS12 | 270 / 5.400 / 1.800 | 880 | 12 / 90° · Luft | 1×1 / s0 | 32 | Luftkapitel: E | `air_direct_t2` |
| ○ | `f3:air_t2_fbomber` | **Raubmöwe** / Skua | Jagdbomber / Fighter-Bomber | T2 Fighter/Bomber (FAF; Vorbild hat keinen, Gegenprobe T2-Luftkampf der Vorbild-Fraktion) (`DEA0202`, Gegenprobe `XAA0202`) | MS12 | 360 / 12.600 / 2.800 | 1.200 | 15 / 110° · Luft | 1×1 / s0 | 32 / R 60 | Luftkapitel: R | `air_fbomb_t2` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `air_t1_scout` | – | – (–) | – | 0,7 (0,625) | +12 % | – |
| `air_t1_fighter` | `wpn_petrel_spines_t1` Stachelsalven (2 × 3er-Stoß): 6×8 / 1 s = **48 DPS**, RW 25, linear (Vorhalt) [Luft] | 0,96 (0,96) | ±0 % | 5,7 (5,7) | ±0 % | ±0 % |
| `air_t1_bomber` | `wpn_gannet_pearl_t1` Perlbombe: 200 / 5 s = **40 DPS**, RW 40, ballistisch (Abwurf), Splash 4<br>*wpn_gannet_pearl_t1:* DPS = Salve/Nachladezeit (pro Anflug). Eine große Bombe mit Splash 4 statt Bombenreihe. | 0,444 (0,444) | ±0 % | 2,389 (2,278) | +4,9 % | +4,9 % |
| `air_t2_gunship` | `wpn_albatross_lance_t2` Hängelanze (4er-Stoß): 4×78 / 4,8 s = **65 DPS**, RW 20, linear, Splash 2 | 0,241 (0,241) | ±0 % | 3,259 (3,141) | +3,8 % | +3,8 % |
| `air_t2_fbomber` | `wpn_skua_spines_t2` Stachelkanonen (2 Läufe): 2×75 / 1 s = **150 DPS**, RW 30, linear (Vorhalt) [Luft]<br>`wpn_skua_pearl_t2` Schwere Perlbombe: 800 / 5 s = **160 DPS**, RW 60, ballistisch (Abwurf), Splash 3 | 0,861 (0,861) | ±0 % | 3,333 (3,333) | ±0 % | ±0 % |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `air_t1_scout` | AIR MOBILE SCOUT INTELLIGENCE TECH1<br>*von:* `FACTORY & AIR & (TECH1 \| TECH2)` | Death: `wpn_air_crash_s` 10/r1 (Absturzschaden (K12))<br>Unbewaffnet, Mindesttempo 16. | Kleinster Flieger, schmale Schwinge, gegabeltes Heck.<br>shell(rumpf), wing(schwinge) [team], wing(gabelheck) — 3 Parts, 0 anim., ≈ 92 Tris · Maßstab 1 · 1 Streifen (Tiefjade) | U11 Luftwaffe in MS12 |
| `air_t1_fighter` | AIR MOBILE ANTIAIR TECH1<br>*von:* `FACTORY & AIR & (TECH1 \| TECH2)` | Death: `wpn_air_crash_s` 25/r1 (Absturzschaden (K12))<br>Nur Luftziele. Referenz-DPS 48 (develop, beide Waffen; spooky 3810 zählt eine). | Schmale Pfeilsichel: lange Rumpfspindel, Schwingenspitzen nach hinten gebogen (lang > breit), 2 Lichtnähte hinten.<br>shell(rumpfspindel), wing(pfeilsichel) [team], wing(leitwerk) — 3 Parts, 0 anim., ≈ 92 Tris · Maßstab 1 · 1 Streifen (Tiefjade) | U11 in MS12 |
| `air_t1_bomber` | AIR MOBILE BOMBER TECH1<br>*von:* `FACTORY & AIR & (TECH1 \| TECH2)` | Death: `wpn_air_crash_m` 100/r1 (Absturzschaden (K12))<br>Einzeltreffer 200 (2 Bomben pro Punze). Snipe-Gate MS12.<br>**Post-MVP K18:** Lähmwirkung der Perlbombe (Vorbild-Bomber) — *MVP:* reiner Splash-Schaden ohne Lähmung | Breite Ovalschwinge (breit ≥ lang, Pfeilung ≤ 30°) mit Bauch-Gondel ≥ 1,4 × Schwingentiefe, ragt vorn und hinten sichtbar über.<br>wing(ovalschwinge) [team], shell(bauchgondel), wing(leitwerk) — 3 Parts, 0 anim., ≈ 92 Tris · Maßstab 1 · 1 Streifen (Tiefjade) | U11 in MS12 (Bomber-FSM) |
| `air_t2_gunship` | AIR MOBILE GUNSHIP DIRECTFIRE TECH2<br>*von:* `FACTORY & AIR & TECH2` | Death: `wpn_air_crash_m` 100/r1 (Absturzschaden (K12))<br>Schwebt im Orbit um das Ziel; Stoß mit Splash 2 statt Dauerfeuer. Kein Transport (U13 Post-MVP). | Keine Schwingen: hochgewölbte Kuppel, darunter hängende Perle mit Lanze, deren Spitze von oben sichtbar vor die Kuppel ragt.<br>shell(kuppel) [team], orb(haengende perle) ⟳yaw, lance ⟳pitch — 3 Parts, 2 anim., ≈ 152 Tris · Maßstab 1,3 · 2 Streifen (Tiefjade) | U11 in MS12 (Orbit) |
| `air_t2_fbomber` | AIR MOBILE BOMBER ANTIAIR TECH2<br>*von:* `FACTORY & AIR & TECH2` | Death: `wpn_air_crash_l` 200/r1 (Absturzschaden (K12))<br>Beide Waffen addiert im DPS-Vergleich (wie FA-Referenz 310: 2 × 75 Luft + 160 Bomben). HP 1.200 hält den Breakpoint: 1 Hochlilie-/Hochrost-Salve. | Pfeilsichel mit zwei Gondeln an den Schwingenspitzen, Spannweite +30 % gegenüber Sturmvogel; keine Kuppel, keine Bauch-Gondel.<br>shell(rumpf), wing(pfeilsichel) [team], shell(gondel l), shell(gondel r) — 4 Parts, 0 anim., ≈ 196 Tris · Maßstab 1,3 · 2 Streifen (Tiefjade) | U11 in MS12 |

---

## 9. Wirtschaft

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f3:str_t1_mex` | **Brunnen I** / Fountain I | Massebohrung / Mass Extractor | T1 Mass Extractor (`UAB1103`, Gegenprobe `UEB1103`) | MS4 | 36 / 360 / 60 | 380 | – | 2×2 | – | Bau: Q | `struct_mass_t1` |
| ● | `f3:str_t2_mex` | **Brunnen II** / Fountain II | Massebohrung / Mass Extractor | T2 Mass Extractor (Upgrade-Kosten) (`UAB1202`, Gegenprobe `UEB1202`) | MS8 | 900 / 5.400 / 900 | 1.950 | – | 2×2 | 20 | Bau: Q (Upgrade: Command Card) | `struct_mass_t2` |
| ○ | `f3:str_t3_mex` | **Brunnen III** / Fountain III | Massebohrung / Mass Extractor | T3 Mass Extractor (Upgrade-Kosten) (`UAB1302`, Gegenprobe `UEB1302`) | MS13 | 4.500 / 31.000 / 2.900 | 6.600 | – | 2×2 | 20 | Bau: Q (Upgrade: Command Card) | `struct_mass_t3` |
| ● | `f3:str_t1_pgen` | **Laterne I** / Lantern I | Kraftwerk / Power Generator | T1 Power Generator (`UAB1101`, Gegenprobe `UEB1101`) | MS4 | 75 / 750 / 125 | 540 | – | 2×2 | – | Bau: W | `struct_energy_t1` |
| ● | `f3:str_t2_pgen` | **Laterne II** / Lantern II | Kraftwerk / Power Generator | T2 Power Generator (`UAB1201`, Gegenprobe `UEB1201`) | MS8 | 1.200 / 12.000 / 2.200 | 2.350 | – | 6×6 | 20 | Bau: W | `struct_energy_t2` |
| ○ | `f3:str_t3_pgen` | **Laterne III** / Lantern III | Kraftwerk / Power Generator | T3 Power Generator (`UAB1301`, Gegenprobe `UEB1301`) | MS13 | 3.200 / 57.000 / 6.800 | 6.300 | – | 8×8 | 20 | Bau: W | `struct_energy_t3` |
| ● | `f3:str_t1_hydro` | **Quellbogen** / Spring Arch | Dampfkraftwerk / Geothermal Plant | T1 Hydrocarbon Power Plant (`UAB1102`, Gegenprobe `UEB1102`) | MS10 | 160 / 800 / 400 | 1.650 | – | 6×6 | – | Bau: E | `struct_hydro_t1` |
| ● | `f3:str_t1_mstore` | **Zisterne** / Cistern | Massespeicher / Mass Storage | T1 Mass Storage (`UAB1106`, Gegenprobe `UEB1106`) | MS10 | 200 / 1.500 / 250 | 680 | – | 2×2 | – | Bau: R | `struct_mstore_t1` |
| ● | `f3:str_t1_estore` | **Schrein** / Shrine | Energiespeicher / Energy Storage | T1 Energy Storage (`UAB1105`, Gegenprobe `UEB1105`) | MS6 | 250 / 1.200 / 200 | 520 | – | 2×2 | – | Bau: T | `struct_estore_t1` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `str_t1_mex` | – | – (–) | – | 10,556 (10,278) | +2,7 % | – |
| `str_t2_mex` | – | – (–) | – | 2,167 (2,111) | +2,6 % | – |
| `str_t3_mex` | – | – (–) | – | 1,467 (1,413) | +3,8 % | – |
| `str_t1_pgen` | – | – (–) | – | 7,2 (7) | +2,9 % | – |
| `str_t2_pgen` | – | – (–) | – | 1,958 (1,917) | +2,2 % | – |
| `str_t3_pgen` | – | – (–) | – | 1,969 (1,914) | +2,9 % | – |
| `str_t1_hydro` | – | – (–) | – | 10,312 (10) | +3,1 % | – |
| `str_t1_mstore` | – | – (–) | – | 3,4 (3,25) | +4,6 % | – |
| `str_t1_estore` | – | – (–) | – | 2,08 (2) | +4 % | – |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `str_t1_mex` | STRUCTURE ECONOMIC MASSEXTRACTION TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | BP 10 · +2 M/s · −2 E/s<br>upgradesTo `f3:str_t2_mex`<br>Adjacency: Gibt Fabriken −7,5 % Mass-Verbrauch (8×8); erhält +12,5 % je angrenzender Zisterne.<br>Nur auf Mass-Spots; produziert während des Upgrades weiter (B4). HP/Mass −8 % zu Varkan (A6). | Ring um den Spot, schwebender Kelch (kleine Schale auf Stiel) mit Goldkern und Tropfen-Takt, niedrig.<br>shell(kissen) [team], ring(kranz), mast(stiel), shell(kelch) ⟳tilt [glow] — 4 Parts, 1 anim., ≈ 216 Tris · Maßstab 1 · 1 Streifen (Tiefjade) | E5 in MS4 |
| `str_t2_mex` | STRUCTURE ECONOMIC MASSEXTRACTION TECH2 SIZE4<br>*von:* `ENGINEER & (TECH2 \| TECH3) \| UPGRADE` | BP 15 · +6 M/s · −9 E/s<br>Upgrade von `f3:str_t1_mex`<br>upgradesTo `f3:str_t3_mex`<br>Adjacency: Fabriken −10 % Mass-Verbrauch; +12,5 % je Zisterne.<br>Kosten = Upgrade-Kosten (FA-Semantik). Auch direkt von Akolyth/Kustos baubar. 1 Brandung-/Tiegel-Treffer. | Brunnen auf 2×2 (Höhe ×1,2) mit Seitenschale, 2 Tech-Streifen.<br>shell(kissen) [team], ring(kranz), mast(stiel), shell(kelch) ⟳tilt [glow], shell(seitenschale) — 5 Parts, 1 anim., ≈ 276 Tris · Maßstab xz 1 / y 1,2 · 2 Streifen (Tiefjade) | B4 (T1→T2) in MS8 |
| `str_t3_mex` | STRUCTURE ECONOMIC MASSEXTRACTION TECH3 SIZE4<br>*von:* `ENGINEER & TECH3 \| UPGRADE` | +18 M/s · −54 E/s<br>Upgrade von `f3:str_t2_mex`<br>Adjacency: Fabriken −12,5 % Mass-Verbrauch; +12,5 % je Zisterne.<br>Upgrade-Kosten. | Brunnen auf 2×2 (Höhe ×1,4), doppelter Ring, 3 Tech-Streifen; keine Bögen (unterscheidet sich so vom Quellbogen).<br>shell(kissen) [team], ring(kranz), ring(zweiter kranz), mast(stiel), shell(kelch) ⟳tilt [glow], shell(seitenschale) — 6 Parts, 1 anim., ≈ 348 Tris · Maßstab xz 1 / y 1,4 · 3 Streifen (Tiefjade) | Rest B4 (T3-Mex) in MS13 |
| `str_t1_pgen` | STRUCTURE ECONOMIC ENERGYPRODUCTION TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | +20 E/s<br>Adjacency: Fabriken (8×8) −1,56 % Energy-Verbrauch, 2×2-Verbraucher −6,25 %; erhält +25 % Produktion je angrenzendem Schrein (SIZE4).<br>Death: `wpn_lantern_burst_t1` 250/r2 (K14, Kettenreaktion-Golden MS10)<br>Frei platzierbar; kein Upgrade (T2/T3 werden neu gebaut, wie FA). HP/Mass −13 % zu Varkan (A6). | Eine stehende Laterne (Linse, Zahl = Tech, Höhe ≥ 1,5 × Schalen-Ø) über einer flachen Schale, Goldkern in der Linse.<br>shell(kissen) [team], shell(flache schale), lantern(laterne) [glow] — 3 Parts, 0 anim., ≈ 184 Tris · Maßstab 1 · 1 Streifen (Tiefjade) | E6 in MS4 |
| `str_t2_pgen` | STRUCTURE ECONOMIC ENERGYPRODUCTION TECH2 SIZE12<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | +500 E/s<br>Adjacency: Fabriken −12,5 % Energy-Verbrauch; erhält +8,3 % Produktion je angrenzendem Schrein (SIZE12).<br>Death: `wpn_lantern_burst_t2` 1.500/r5 (K14)<br>1 Brandung-Treffer, 2 Tiegel-Treffer (wie FA). | Laterne auf 6×6 (Maßstab 3,0, Höhe ×1,2) mit 2 Laternen, 2 Tech-Streifen; füllt ≥ 70 % der Footprint-Kante.<br>shell(kissen) [team], shell(flache schale), lantern(laterne) [glow], lantern(laterne) [glow] — 4 Parts, 0 anim., ≈ 248 Tris · Maßstab xz 3 / y 3,6 · 2 Streifen (Tiefjade) | E6-Tech-Leiter mit T2-Engineer (MS8); KI-Tech bis T2 in MS9 |
| `str_t3_pgen` | STRUCTURE ECONOMIC ENERGYPRODUCTION TECH3 SIZE16<br>*von:* `ENGINEER & TECH3` | +2.500 E/s<br>Adjacency: Fabriken −15,6 % Energy-Verbrauch; erhält +6,25 % Produktion je angrenzendem Schrein (SIZE16).<br>Death: `wpn_lantern_burst_t3` 5.500/r10 (K14, FA-Relation)<br>HP/Mass −30 % zu Varkan (A6, Vorbild-Relation). | Laterne auf 8×8 (Maßstab 4,0, Höhe ×1,4) mit 3 Laternen, 3 Tech-Streifen.<br>shell(kissen) [team], shell(flache schale), lantern [glow], lantern [glow], lantern [glow] — 5 Parts, 0 anim., ≈ 312 Tris · Maßstab xz 4 / y 5,6 · 3 Streifen (Tiefjade) | T3-Pgen-Nachlieferung in MS13 |
| `str_t1_hydro` | STRUCTURE ECONOMIC ENERGYPRODUCTION HYDROCARBON TECH1 SIZE12<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | +100 E/s<br>Adjacency: Wie Laterne II (Fabriken −12,5 % Energy); erhält +8,3 % je angrenzendem Schrein (SIZE12).<br>Nur auf Hydro-Spots; keine Death-Weapon (wie FA). ID `hydro` bleibt intern. | Ring mit drei Bögen, die sich über dem Spot treffen; Goldkern (umschlossene Perle) im Scheitel.<br>shell(kissen) [team], ring(kranz), arch, arch, arch, orb(scheitel) [glow] — 6 Parts, 0 anim., ≈ 320 Tris · Maßstab 1 · 1 Streifen (Tiefjade) | E9 in MS10; als Daten-Vorgriff im MS9-Kern (nur Spot-Regel wie E5) |
| `str_t1_mstore` | STRUCTURE ECONOMIC MASSSTORAGE TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | Speicher 500 M<br>Adjacency: +12,5 % Produktion je angrenzendem Brunnen (FA-Relation, max. 4 Seiten = +50 %).<br>Keine Death-Weapon. HP/Mass −19 % zu Varkan (A6). | Flaches, offenes Oval-Becken (umgedrehte Schale), Goldrand; keine Laterne, kein Ring.<br>shell(kissen) [team], shell(becken umgedreht), wing(goldrand) [gold] — 3 Parts, 0 anim., ≈ 136 Tris · Maßstab 1 · 1 Streifen (Tiefjade) | E10 in MS10; Daten-Vorgriff im MS9-Kern (E4-Speicherlimit existiert ab MS4) |
| `str_t1_estore` | STRUCTURE ECONOMIC ENERGYSTORAGE TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | Speicher 10.000 E<br>Adjacency: Bufft alle angrenzenden Energieproduzenten (FA-Relation): Laterne I +25 % (SIZE4), Laterne II und Quellbogen +8,3 % (SIZE12), Laterne III +6,25 % (SIZE16).<br>Death: `wpn_shrine_burst` 1.000/r5 (K14) | Zwei liegende Laternen in flacher Schale (Höhe ≤ 0,3 × Kante); keine stehende Laterne, kein Ring.<br>shell(kissen) [team], shell(flache schale), lantern(liegend) [glow], lantern(liegend) [glow] — 4 Parts, 0 anim., ≈ 248 Tris · Maßstab 1 · 1 Streifen (Tiefjade) | Glanzstoß (U8, MS6) feuert erst ab 7500 E Vorrat (> Grundspeicher 3900 E) ⇒ Daten-Vorgriff ab MS6; E10-Abnahme MS10 |

---

## 10. Kapitel (Fabriken)

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f3:str_t1_fac_land` | **Landkapitel I** / Land Chapter I | Landfabrik / Land Factory | T1 Land Factory (`UAB0101`, Gegenprobe `UEB0101`) | MS6 | 240 / 2.100 / 300 | 3.300 | – | 8×8 | 20 | Bau: A | `struct_fac_land_t1` |
| ● | `f3:str_t2_fac_land` | **Landkapitel II** / Land Chapter II | Landfabrik / Land Factory | T2 Land Factory HQ (Upgrade-Kosten) (`UAB0201`, Gegenprobe `UEB0201`) | MS8 | 1.400 / 11.000 / 2.300 | 6.500 | – | 8×8 | 20 | Bau: Upgrade (Command Card) | `struct_fac_land_t2` |
| ○ | `f3:str_t3_fac_land` | **Landkapitel III** / Land Chapter III | Landfabrik / Land Factory | T3 Land Factory HQ (Upgrade-Kosten) (`UAB0301`, Gegenprobe `UEB0301`) | MS13 | 5.200 / 47.000 / 12.000 | 13.000 | – | 8×8 | 20 | Bau: Upgrade (Command Card) | `struct_fac_land_t3` |
| ○ | `f3:str_t1_fac_air` | **Luftkapitel I** / Air Chapter I | Luftfabrik / Air Factory | T1 Air Factory (`UAB0102`, Gegenprobe `UEB0102`) | MS12 | 210 / 2.400 / 300 | 3.300 | – | 8×8 | 20 | Bau: S | `struct_fac_air_t1` |
| ○ | `f3:str_t2_fac_air` | **Luftkapitel II** / Air Chapter II | Luftfabrik / Air Factory | T2 Air Factory HQ (Upgrade-Kosten) (`UAB0202`, Gegenprobe `UEB0202`) | MS12 | 920 / 17.500 / 2.300 | 6.500 | – | 8×8 | 20 | Bau: Upgrade (Command Card) | `struct_fac_air_t2` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `str_t1_fac_land` | – | – (–) | – | 13,75 (13,333) | +3,1 % | – |
| `str_t2_fac_land` | – | – (–) | – | 4,643 (4,539) | +2,3 % | – |
| `str_t3_fac_land` | – | – (–) | – | 2,5 (2,452) | +2 % | – |
| `str_t1_fac_air` | – | – (–) | – | 15,714 (15,238) | +3,1 % | – |
| `str_t2_fac_air` | – | – (–) | – | 7,065 (6,957) | +1,6 % | – |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `str_t1_fac_land` | STRUCTURE FACTORY LAND TECH1 SIZE16<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | BP 20 · Speicher 80 M<br>upgradesTo `f3:str_t2_fac_land`<br>Adjacency: Empfängt Adjacency von Brunnen (Mass) und Kraftwerken (Energy).<br>Queue/Repeat/Rally (B3). Upgrade-Verb „Weihen“ / „Consecrate“. HP/Mass −21 % zu Varkan (A6). | Halbschale (Kuppelhalle), zur Ausgangsseite offen, goldener Torbogen mit Goldkern, Rampe.<br>shell(kissen) [team], shell(halbschale) [team], arch(torbogen) ⟳tilt [glow], shell(rampe) — 4 Parts, 1 anim., ≈ 216 Tris · Maßstab 1 · 1 Streifen (Tiefjade) | B3 in MS6 |
| `str_t2_fac_land` | STRUCTURE FACTORY LAND TECH2 SIZE16<br>*von:* `UPGRADE` | BP 40 · Speicher 160 M<br>Upgrade von `f3:str_t1_fac_land`<br>upgradesTo `f3:str_t3_fac_land`<br>Adjacency: Empfängt Adjacency von Brunnen (Mass) und Kraftwerken (Energy).<br>Nur per Upgrade („Weihen“; kein HQ/Support-System, B9 Post-MVP). | Landkapitel ×1,3 mit goldener Turmnadel, 2 Tech-Streifen.<br>shell(kissen) [team], shell(halbschale) [team], arch(torbogen) ⟳tilt [glow], shell(rampe), mast(turmnadel) [gold] — 5 Parts, 1 anim., ≈ 240 Tris · Maßstab xz 1 / y 1,2 · 2 Streifen (Tiefjade) | U5 in MS8 |
| `str_t3_fac_land` | STRUCTURE FACTORY LAND TECH3 SIZE16<br>*von:* `UPGRADE` | BP 90 · Speicher 320 M<br>Upgrade von `f3:str_t2_fac_land`<br>Adjacency: Empfängt Adjacency von Brunnen (Mass) und Kraftwerken (Energy).<br>Nur per Upgrade. | Landkapitel ×1,7 mit zwei Turmnadeln und Seitenschale, 3 Tech-Streifen.<br>shell(kissen) [team], shell(halbschale) [team], arch(torbogen) ⟳tilt [glow], shell(rampe), mast(turmnadel) [gold], mast(zweite nadel) [gold], shell(seitenschale) — 7 Parts, 1 anim., ≈ 324 Tris · Maßstab xz 1 / y 1,4 · 3 Streifen (Tiefjade) | U5 T3 / U10 in MS13 |
| `str_t1_fac_air` | STRUCTURE FACTORY AIR TECH1 SIZE16<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | BP 20 · Speicher 80 M<br>upgradesTo `f3:str_t2_fac_air`<br>Adjacency: Empfängt Adjacency von Brunnen (Mass) und Kraftwerken (Energy).<br>Baut keine Engineers (wie FA). | Halbschale mit Landescheibe (Ring) statt Rampe.<br>shell(kissen) [team], shell(halbschale) [team], arch(torbogen) ⟳tilt [glow], ring(landescheibe) — 4 Parts, 1 anim., ≈ 228 Tris · Maßstab 1 · 1 Streifen (Tiefjade) | Luftfabrik T1→T2 in MS12 |
| `str_t2_fac_air` | STRUCTURE FACTORY AIR TECH2 SIZE16<br>*von:* `UPGRADE` | BP 40 · Speicher 160 M<br>Upgrade von `f3:str_t1_fac_air`<br>Adjacency: Empfängt Adjacency von Brunnen (Mass) und Kraftwerken (Energy).<br>Nur per Upgrade; kein T3-Luftkapitel (U12 Post-MVP). | Luftkapitel ×1,3 mit Turmnadel, 2 Tech-Streifen.<br>shell(kissen) [team], shell(halbschale) [team], arch(torbogen) ⟳tilt [glow], ring(landescheibe), mast(turmnadel) [gold] — 5 Parts, 1 anim., ≈ 252 Tris · Maßstab xz 1 / y 1,2 · 2 Streifen (Tiefjade) | MS12 |

---

## 11. Verteidigung

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f3:str_t1_pd` | **Riff I** / Reef I | Punktverteidigung / Point Defense | T1 Point Defense (`UAB2101`, Gegenprobe `UEB2101`) | MS8 | 250 / 2.000 / 250 | 1.300 | – | 1×1 | 24 | Bau: Z | `struct_direct_t1` |
| ● | `f3:str_t2_pd` | **Riff II** / Reef II | Punktverteidigung / Point Defense | T2 Point Defense (`UAB2301`, Gegenprobe `UEB2301`) | MS8 | 540 / 3.800 / 680 | 2.100 | – | 2×2 | 28 | Bau: Z | `struct_direct_t2` |
| ● | `f3:str_t1_aa` | **Seelilie I** / Sea Lily I | Flugabwehrturm / AA Tower | T1 Anti-Air Turret (`UAB2104`, Gegenprobe `UEB2104`) | MS8 | 150 / 1.500 / 190 | 820 | – | 1×1 | 24 | Bau: X | `struct_aa_t1` |
| ● | `f3:str_t2_aa` | **Seelilie II** / Sea Lily II | Flakturm / Flak Tower | T2 Anti-Air Flak Artillery (`UAB2204`, Gegenprobe `UEB2204`) | MS8 | 400 / 4.000 / 540 | 2.550 | – | 2×2 | 24 | Bau: X | `struct_aa_t2` |
| ● | `f3:str_t3_sam` | **Hochlilie** / High Lily | Raketenabwehr / SAM Site | T3 Anti-Air SAM Launcher (`UAB2304`, Gegenprobe `UEB2304`) | MS8 | 800 / 8.000 / 1.400 | 5.000 | – | 2×2 | 28 | Bau: X | `struct_sam_t3` |
| ● | `f3:str_t1_wall` | **Deich** / Dike | Mauer / Wall | Wall Section (`UAB5101`, Gegenprobe `UEB5101`) | MS8 | 3 / 20 / 15 | 520 | – | 1×1 | 0 | Bau: C | `wall` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `str_t1_pd` | `wpn_reef_lance_t1` Lanze (Turm): 50 / 0,3 s = **166,7 DPS**, RW 26, linear | 0,667 (0,667) | ±0 % | 5,2 (5,2) | ±0 % | ±0 % |
| `str_t2_pd` | `wpn_reef_lance_t2` Schwere Lanze (Einzelstoß): 600 / 4 s = **150 DPS**, RW 50, linear, Splash 2 | 0,278 (0,278) | ±0 % | 3,889 (3,704) | +5 % | +5 % |
| `str_t1_aa` | `wpn_lily_spines_t1` Stachelsalve (3er-Stoß): 3×14 / 0,6 s = **70 DPS**, RW 44, linear (Vorhalt) [Luft] | 0,467 (0,467) | ±0 % | 5,467 (5,333) | +2,5 % | +2,5 % |
| `str_t2_aa` | `wpn_lily_flak_t2` Sprengstachel (Turm): 150 / 1 s = **150 DPS**, RW 50, linear + Näherungszünder (MS12), Splash 3 [Luft] | 0,375 (0,375) | ±0 % | 6,375 (6,125) | +4,1 % | +4,1 % |
| `str_t3_sam` | `wpn_high_lily_sam_t3` Stachelraketen (2er): 2×600 / 3,5 s = **342,9 DPS**, RW 60, homing + Näherungszünder, Splash 1,5 [Luft] | 0,429 (0,429) | ±0 % | 6,25 (6,25) | ±0 % | ±0 % |
| `str_t1_wall` | – | – (–) | – | 173,333 (166,667) | +4 % | – |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `str_t1_pd` | STRUCTURE DEFENSE DIRECTFIRE TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | Dieselbe Perle mit Lanze wie der Kauri, auf dem Sockel schwebend. 6 Treffer Punze, 4 Kauri, 3 Knallkrebs; 7 Dünung-Treffer. | Kissen-Sockel, darüber schwebend Perle mit waagerechter Lanze.<br>shell(kissen) [team], orb ⟳yaw [team], lance ⟳pitch — 3 Parts, 2 anim., ≈ 152 Tris · Maßstab 1 · 1 Streifen (Tiefjade) | B5 in MS8; Minimal-A8 der KI in MS9 |
| `str_t2_pd` | STRUCTURE DEFENSE DIRECTFIRE TECH2 SIZE4<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | Einzelschuss-Präzision (A4): 600 / 4 s mit Splash 2 statt Schnellfeuer; tötet Punze und Kauri mit 1, Meißel mit 3 Schüssen. Kein Upgrade von Riff I. | Riff ×1,3 mit zwei parallelen Lanzen (an der Perle geparentet) und Schürzenschale, 2 Tech-Streifen.<br>shell(kissen) [team], orb ⟳yaw [team], lance, lance(zweite lanze), shell(schuerze) — 5 Parts, 1 anim., ≈ 224 Tris · Maßstab xz 2 / y 2,4 · 2 Streifen (Tiefjade) | B5 (T2) in MS8 |
| `str_t1_aa` | STRUCTURE DEFENSE ANTIAIR TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | Nur Luftziele. 1 Salve tötet eine Seeschwalbe. | Stachelkranz (3 Stacheln) auf teamfarbenem Kissen-Sockel.<br>shell(kissen) [team], spine ⟳yaw, spine, spine — 4 Parts, 1 anim., ≈ 90 Tris · Maßstab 1 · 1 Streifen (Tiefjade) | B5 in MS8, Wirkung MS12 |
| `str_t2_aa` | STRUCTURE DEFENSE ANTIAIR TECH2 SIZE4<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | Nur Luftziele. | Seelilie ×1,3 mit 4 Stacheln und Schürzenschale, 2 Tech-Streifen.<br>shell(kissen) [team], spine ⟳yaw, spine, spine, spine, shell(schuerze) — 6 Parts, 1 anim., ≈ 160 Tris · Maßstab xz 2 / y 2,4 · 2 Streifen (Tiefjade) | B5 (T2) in MS8, Näherungszünder MS12 |
| `str_t3_sam` | STRUCTURE DEFENSE ANTIAIR TECH3 SIZE4<br>*von:* `ENGINEER & TECH3` | Nur Luftziele. 1 Salve tötet Albatros, Raubmöwe, Krähe und Elster. | Kissen-Sockel auf 2×2 mit doppelt so vielen, dickeren Stacheln (6), 3 Tech-Streifen.<br>shell(kissen) [team], spine ⟳yaw, spine, spine, spine, spine, spine — 7 Parts, 1 anim., ≈ 120 Tris · Maßstab xz 2 / y 2,8 · 3 Streifen (Tiefjade) | MS8 per Konsole/Test-Szenario gespawnt (B5: homing, K11), baubar ab MS13 (Kustos) |
| `str_t1_wall` | STRUCTURE DEFENSE WALL TECH1<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | wall-Flag (Drag-Linie), blockiert Schüsse und Pathing. | Niedrige, gerundete Wulstkette; nur der Kamm teamfarben (≈ 10 %, Maske).<br>shell(wulst) [team] — 1 Parts, 0 anim., ≈ 60 Tris · Maßstab 1 · keine Streifen | B5/Minimal-Drag (DECISIONS 3) in MS8 |

---

## 12. Intel und Schilde

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ○ | `f3:str_t1_radar` | **Warte I** / Lookout I | Radar / Radar | T1 Radar System (`UAB3101`, Gegenprobe `UEB3101`) | MS10 | 80 / 720 / 80 | 11 | – | 2×2 | 20 / R 116 | Bau: D | `struct_intel_t1` |
| ○ | `f3:str_t2_radar` | **Warte II** / Lookout II | Radar / Radar | T2 Radar System (Upgrade-Kosten) (`UAB3201`, Gegenprobe `UEB3201`) | MS10 | 180 / 3.600 / 780 | 55 | – | 2×2 | 24 / R 200 | Bau: Upgrade (Command Card) | `struct_intel_t2` |
| ○ | `f3:str_t3_radar` | **Warte III** / Lookout III | Radar / Radar | T3 Omni Sensor Array (Upgrade-Kosten; hier ohne Omni) (`UAB3104`, Gegenprobe `UEB3104`) | MS13 | 1.200 / 16.000 / 1.500 | 55 | – | 2×2 | 30 / R 350 | Bau: Upgrade (Command Card) | `struct_intel_t3` |
| ○ | `f3:str_t2_shield` | **Perlmutt II** / Nacre II | Schildgenerator / Shield Generator | T2 Shield Generator (`UAB4202`, Gegenprobe `UEB4202`) | MS13 | 480 / 5.800 / 950 | 160 | – | 6×6 | 20 | Bau: F | `struct_shield_t2` |
| ○ | `f3:str_t3_shield` | **Perlmutt III** / Nacre III | Schildgenerator / Shield Generator | T3 Heavy Shield Generator (Upgrade-Kosten) (`UAB4301`, Gegenprobe `UEB4301`) | MS13 | 2.400 / 44.000 / 4.100 | 320 | – | 6×6 | 20 | Bau: Upgrade (Command Card) | `struct_shield_t3` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `str_t1_radar` | – | – (–) | – | 0,138 (0,125) | +10 % | – |
| `str_t2_radar` | – | – (–) | – | 0,306 (0,278) | +10 % | – |
| `str_t3_radar` | – | – (–) | – | 0,046 (0,042) | +10 % | – |
| `str_t2_shield` | – | – (–) | – | 23,667 (23,229) (inkl. Schild) | +1,9 % | – |
| `str_t3_shield` | – | – (–) | – | 7,633 (7,625) (inkl. Schild) | +0,1 % | – |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `str_t1_radar` | STRUCTURE INTELLIGENCE RADAR TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | BP 13 · −20 E/s<br>upgradesTo `f3:str_t2_radar`<br>Toggles: radar (MS10, C17)<br>Stall schaltet ab (E3), Wiedereinschalten mit Hysterese. Sehr fragil (FA-Relation). | Hoher dünner Mast mit Fächer (Halbkreisplatte 1,6 × 0,8 WU, 35° gekippt), rotierend; kein Ring.<br>shell(kissen) [team], mast, fan(faecher) ⟳yaw — 3 Parts, 1 anim., ≈ 100 Tris · Maßstab 1 · 1 Streifen (Tiefjade) | I3 in MS10 |
| `str_t2_radar` | STRUCTURE INTELLIGENCE RADAR TECH2 SIZE4<br>*von:* `UPGRADE` | BP 20 · −150 E/s<br>Upgrade von `f3:str_t1_radar`<br>upgradesTo `f3:str_t3_radar`<br>Toggles: radar (MS10, C17)<br>Nur per Upgrade. | Warte auf 2×2 (Höhe ×1,2) mit Doppelmast, 2 Tech-Streifen.<br>shell(kissen) [team], mast, mast, fan(faecher) ⟳yaw — 4 Parts, 1 anim., ≈ 124 Tris · Maßstab xz 1 / y 1,2 · 2 Streifen (Tiefjade) | I3 T1→T2 in MS10 |
| `str_t3_radar` | STRUCTURE INTELLIGENCE RADAR TECH3 SIZE4<br>*von:* `UPGRADE` | −400 E/s<br>Upgrade von `f3:str_t2_radar`<br>Toggles: radar (MS10, C17)<br>Wie Varkan: kein Omni (I4/I5 Post-MVP) ⇒ Kosten und Reichweite gegenüber FA halbiert, HP/Mass in Relation. | Warte auf 2×2 (Höhe ×1,4) mit zweitem Fächer, 3 Tech-Streifen.<br>shell(kissen) [team], mast, mast, fan(faecher) ⟳yaw, fan(zweiter faecher) — 5 Parts, 1 anim., ≈ 140 Tris · Maßstab xz 1 / y 1,4 · 3 Streifen (Tiefjade) | Rest I3 (T3-Radar) in MS13 |
| `str_t2_shield` | STRUCTURE SHIELD DEFENSE TECH2 SIZE12<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | BP 20<br>upgradesTo `f3:str_t3_shield`<br>Toggles: shield (MS13, C17)<br>Schild 11.200 HP, r 20, Regen 138/s ab 3 s nach dem letzten Treffer, Neuaufbau 24 s, 150 E/s<br>Starke, kleine Schilde (A5): Schild/Mass +51 % zu Schirm II, Radius 20 statt 24. Kollaps + Wiederaufbau nach rechargeS; Stall schaltet ab. | Mast mit waagerechtem Ring (Ø ≥ 0,8 × Footprint-Kante), flache Fußschale.<br>shell(kissen) [team], shell(fussschale), mast, ring(waagerecht) ⟳yaw [team] — 4 Parts, 1 anim., ≈ 216 Tris · Maßstab 1 · 2 Streifen (Tiefjade) | K10 in MS13 |
| `str_t3_shield` | STRUCTURE SHIELD DEFENSE TECH3 SIZE12<br>*von:* `UPGRADE` | Upgrade von `f3:str_t2_shield`<br>Toggles: shield (MS13, C17)<br>Schild 18.000 HP, r 35, Regen 150/s ab 1 s nach dem letzten Treffer, Neuaufbau 24 s, 300 E/s<br>Upgrade wie Varkan (gleicher Hotbuild-Weg); das Vorbild baut den T3-Schild neu, die Kosten hier sind dessen Neubaukosten als Upgrade-Kosten (Gesamtkosten 2.880 statt 2.400). regenStartS 1 wie Varkans T3-Schild. | Perlmutt auf 6×6 (Höhe ×1,4) mit zweitem Ring und Schürzenschale, 3 Tech-Streifen.<br>shell(kissen) [team], shell(fussschale), mast, ring(waagerecht) ⟳yaw [team], ring(zweiter ring), shell(schuerze) — 6 Parts, 1 anim., ≈ 348 Tris · Maßstab xz 1 / y 1,17 · 3 Streifen (Tiefjade) | K10 in MS13 |

---

## 13. Artilleriestellungen

**Stammdaten**

| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ○ | `f3:str_t2_arty` | **Brandung** / Surf | Artilleriestellung / Artillery Emplacement | T2 Artillery Installation (`UAB2303`, Gegenprobe `UEB2303`) | MS13 | 2.080 / 14.900 / 1.600 | 2.300 | – | 2×2 | 28 | Bau: V | `struct_arty_t2` |
| ○ | `f3:str_t3_arty` | **Sintflut** / Deluge | Schwere Artilleriestellung / Heavy Artillery Emplacement | T3 Heavy Artillery Installation (auf MVP-Kartengröße skaliert) (`UAB2302`, Gegenprobe `UEB2302`) | MS13 | 48.800 / 915.000 / 80.000 | 8.000 | – | 8×8 | 28 | Bau: V | `struct_arty_t3` |

**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |
|---|---|---|---|---|---|---|
| `str_t2_arty` | `wpn_surf_horn_t2` Brandungsgranate: 2.875 / 20 s = **143,8 DPS**, RW 50–115, ballistisch, Splash 2,25<br>Pulk-DPS/Mass 0,41 (FA 0,41): ±0 %<br>*wpn_surf_horn_t2:* Vorbild: 5 DoT-Pulse à 575; hier ein Einschlag mit derselben Summe. Streuung wie Vorbild (FiringRandomness 2,0, K1). | 0,069 (0,069) | ±0 % | 1,106 (1,058) | +4,5 % | +4,5 % |
| `str_t3_arty` | `wpn_deluge_horn_t3` Sintflutgranate (Doppelschlag): 2×6.000 / 30 s = **400 DPS**, RW 60–200, ballistisch, Splash 5<br>Pulk-DPS/Mass 0,195 (FA 0,195): ±0 %<br>*wpn_deluge_horn_t3:* Vorbild: 2 Pulse à 6.000 alle 20 s, RW 825. Skaliert wie Varkans Hochofen: RW 200 (Gate ≤ 40 % der kleinsten Kartendiagonale), Kosten ≈ 67 %, gleicher Doppelschlag (12.000) für den Schild-Burst, Feuerrate ×⅔; DPS/Mass und HP/Mass ±0. | 0,008 (0,008) | ±0 % | 0,164 (0,164) | ±0 % | ±0 % |

**Kategorien, Besonderheiten, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|
| `str_t2_arty` | STRUCTURE DEFENSE INDIRECTFIRE ARTILLERY TECH2 SIZE4<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | Einzelschuss-Präzision (A4): DPS/Mass +31 % zum Tiegel bei kleinerem Splash; 1 Treffer tötet Brunnen II, Riff I, Laterne II und Glutkessel II. | Großes Horn auf Lafette über Kissen-Sockel, Gegenschale.<br>shell(kissen) [team], mast(lafette) ⟳yaw, horn ⟳pitch, shell(gegenschale) — 4 Parts, 2 anim., ≈ 176 Tris · Maßstab 1 · 2 Streifen (Tiefjade) | K13 in MS13 |
| `str_t3_arty` | STRUCTURE DEFENSE INDIRECTFIRE ARTILLERY TECH3 SIZE16<br>*von:* `ENGINEER & TECH3` | Maßstabs-Sonderfall wie Hochofen; Kartenpool ≥ 354 WU (roster.md §20). | Brandungs-Silhouette auf 8×8: Lafette, Horn Ø 3,0 WU × 7 WU, Gegenschale; 3 Tech-Streifen.<br>shell(kissen) [team], mast(lafette) ⟳yaw, horn ⟳pitch, shell(gegenschale), shell(lafettenschale) — 5 Parts, 2 anim., ≈ 236 Tris · Maßstab xz 4 / y 4,67 · 3 Streifen (Tiefjade) | K13 + Reichweiten-Gate in MS13 |

---

## 14. Balance-Übersicht und Gates

- **DPS/Mass:** 25 bewaffnete Einträge, größte Abweichung ±0 %, Mittelwert ±0 %. Die Waffen folgen der Vorbild-Relation exakt; Feinabstimmung läuft nur über HP.
- **HP/Mass:** 50 Einträge, größte Abweichung +12 % (Seeschwalbe), Mittelwert +3,8 %.
- **Produkt DPS/Mass × HP/Mass:** größte Abweichung +10 % (Glimmer), Mittelwert +3,6 %. Gate ±15 %.
- **Globale Verschiebung wie Varkan:** HP/Mass im Mittel +3,8 % (Varkan +4,3 %), DPS/Mass ±0 % (Varkan −1 %). Beide Fraktionen verlängern Gefechte also um ungefähr gleich viel; die Kreuz-Relationen bleiben erhalten.
- **HP-Werte mit Breakpoint-Bindung:** Knallkrebs 116 (17 Stichel-, 5 Punze-Treffer), Kauri 170 (7 Punze-, 4 Riegel-I-, 2 Vogt-Treffer), Triton 2.750 (40 Meißel-, 28 Vogt-, 14 Riegel-II-Salven), Riff I 1.300 (13 Kelle-, 7 Dünung-Treffer), Raubmöwe 1.200 (1 Hochlilie-/Hochrost-Salve).
- **Größte HP-Aufschläge** liegen bei winzigen Werten (Seeschwalbe 28 statt 25, Warte 11 statt 10, Glimmer 22 statt 20), wie bei Varkan. Sie ändern keinen Breakpoint.

**Pulk-DPS/Mass (Artillerie, Gate ±15 %)**

| Einheit | Schaden × Salve / Nachladezeit | Splash (FA) | Pulk-DPS/Mass (FA) | Δ Pulk | Δ Einzelziel |
|---|---|---|---|---|---|
| Dünung | 200 / 2 s | 0,5 (0,5) | 2,182 (2,182) | ±0 % | ±0 % |
| Brecher | 600 / 10 s | 1 (1) | 0,589 (0,589) | ±0 % | ±0 % |
| Woge | 1.425 / 20 s | 3 (3) | 0,857 (0,857) | ±0 % | ±0 % |
| Brandung | 2.875 / 20 s | 2,25 (2,25) | 0,41 (0,41) | ±0 % | ±0 % |
| Sintflut | 2×6.000 / 30 s | 5 (5) | 0,195 (0,195) | ±0 % | ±0 % |

**Treffer-bis-Tod-Matrix (Pflicht: exakt Vorbild)**

| Angreifer → Ziel | Salvenschaden / Ziel-HP | Salven (Zeit) | FA: Salvenschaden / Ziel-HP | FA: Salven (Zeit) | ✓ |
|---|---|---|---|---|---|
| Prior → Knallkrebs | 100 / 116 | 2 (1 s) | 100 / 115 | 2 (1 s) | ✓ |
| Prior → Kauri | 100 / 170 | 2 (1 s) | 100 / 155 | 2 (1 s) | ✓ |
| Prior → Dünung | 100 / 160 | 2 (1 s) | 100 / 150 | 2 (1 s) | ✓ |
| Prior → Seeigel | 100 / 280 | 3 (2 s) | 100 / 265 | 3 (2 s) | ✓ |
| Prior → Novize | 100 / 125 | 2 (1 s) | 100 / 120 | 2 (1 s) | ✓ |
| Prior → Glimmer | 100 / 22 | 1 (0 s) | 100 / 20 | 1 (0 s) | ✓ |
| Riff I → Kauri | 50 / 170 | 4 (0,9 s) | 50 / 155 | 4 (0,9 s) | ✓ |
| Riff I → Knallkrebs | 50 / 116 | 3 (0,6 s) | 50 / 115 | 3 (0,6 s) | ✓ |
| Dünung → Knallkrebs | 200 / 116 | 1 (0 s) | 200 / 115 | 1 (0 s) | ✓ |
| Dünung → Novize | 200 / 125 | 1 (0 s) | 200 / 120 | 1 (0 s) | ✓ |
| Dünung → Kauri | 200 / 170 | 1 (0 s) | 200 / 155 | 1 (0 s) | ✓ |
| Dünung → Riff I | 200 / 1.300 | 7 (12 s) | 200 / 1.300 | 7 (12 s) | ✓ |
| Triton → Knallkrebs | 360 / 116 | 1 (0 s) | 360 / 115 | 1 (0 s) | ✓ |
| Triton → Kauri | 360 / 170 | 1 (0 s) | 360 / 155 | 1 (0 s) | ✓ |
| Brecher → Riff II | 600 / 2.100 | 4 (30 s) | 600 / 2.000 | 4 (30 s) | ✓ |
| Riff II → Kauri | 600 / 170 | 1 (0 s) | 600 / 155 | 1 (0 s) | ✓ |
| Riff II → Triton | 600 / 2.750 | 5 (16 s) | 600 / 2.750 | 5 (16 s) | ✓ |
| Konus → Triton | 950 / 2.750 | 3 (13,2 s) | 950 / 2.750 | 3 (13,2 s) | ✓ |
| Brandung → Brunnen II | 2.875 / 1.950 | 1 (0 s) | 2.875 / 1.900 | 1 (0 s) | ✓ |
| Brandung → Riff I | 2.875 / 1.300 | 1 (0 s) | 2.875 / 1.300 | 1 (0 s) | ✓ |
| Brandung → Laterne II | 2.875 / 2.350 | 1 (0 s) | 2.875 / 2.300 | 1 (0 s) | ✓ |
| Seelilie I → Seeschwalbe | 42 / 28 | 1 (0 s) | 42 / 25 | 1 (0 s) | ✓ |
| Hochlilie → Albatros | 1.200 / 880 | 1 (0 s) | 1.200 / 848 | 1 (0 s) | ✓ |
| Hochlilie → Raubmöwe | 1.200 / 1.200 | 1 (0 s) | 1.200 / 1.200 | 1 (0 s) | ✓ |

**Kreuz-Breakpoints gegen Varkan (`checks.crossHitsToKill`, `faction.md` §9.4)** — 39/39 Pflichtpaare exakt, 10/12 Info-Paare exakt.

| Pflicht | Angreifer → Ziel | Salvenschaden / Ziel-HP | Salven (Zeit) | FA: Salvenschaden / Ziel-HP | FA: Salven (Zeit) | ✓ |
|---|---|---|---|---|---|---|
| ja | Punze (Varkan) → Kauri (Sael) | 28 / 170 | 7 (7,2 s) | 24 / 155 | 7 (6 s) | ✓ |
| ja | Kauri (Sael) → Punze (Varkan) | 40 / 300 | 8 (11,2 s) | 40 / 300 | 8 (11,2 s) | ✓ |
| ja | Vogt (Varkan) → Kauri (Sael) | 100 / 170 | 2 (1 s) | 100 / 155 | 2 (1 s) | ✓ |
| ja | Prior (Sael) → Punze (Varkan) | 100 / 300 | 3 (2 s) | 100 / 300 | 3 (2 s) | ✓ |
| ja | Triton (Sael) → Punze (Varkan) | 360 / 300 | 1 (0 s) | 360 / 300 | 1 (0 s) | ✓ |
| ja | Triton (Sael) → Meißel (Varkan) | 360 / 1.600 | 5 (12 s) | 360 / 1.500 | 5 (12 s) | ✓ |
| ja | Riegel I (Varkan) → Kauri (Sael) | 50 / 170 | 4 (0,9 s) | 50 / 155 | 4 (0,9 s) | ✓ |
| ja | Riff I (Sael) → Punze (Varkan) | 50 / 300 | 6 (1,5 s) | 50 / 300 | 6 (1,5 s) | ✓ |
| ja | Meißel (Varkan) → Triton (Sael) | 70 / 2.750 | 40 (50,7 s) | 70 / 2.750 | 40 (50,7 s) | ✓ |
| ja | Vogt (Varkan) → Triton (Sael) | 100 / 2.750 | 28 (27 s) | 100 / 2.750 | 28 (27 s) | ✓ |
| ja | Riegel II (Varkan) → Triton (Sael) | 200 / 2.750 | 14 (20,8 s) | 210 / 2.750 | 14 (20,8 s) | ✓ |
| ja | Punze (Varkan) → Knallkrebs (Sael) | 28 / 116 | 5 (4,8 s) | 24 / 115 | 5 (4 s) | ✓ |
| ja | Stichel (Varkan) → Knallkrebs (Sael) | 7 / 116 | 17 (4,8 s) | 7 / 115 | 17 (4,8 s) | ✓ |
| ja | Knallkrebs (Sael) → Punze (Varkan) | 27 / 300 | 12 (11 s) | 27 / 300 | 12 (11 s) | ✓ |
| ja | Kelle (Varkan) → Kauri (Sael) | 100 / 170 | 2 (9 s) | 100 / 155 | 2 (8,3 s) | ✓ |
| ja | Kelle (Varkan) → Novize (Sael) | 100 / 125 | 2 (9 s) | 100 / 120 | 2 (8,3 s) | ✓ |
| ja | Kelle (Varkan) → Riff I (Sael) | 100 / 1.300 | 13 (108 s) | 100 / 1.300 | 13 (99,6 s) | ✓ |
| ja | Dünung (Sael) → Punze (Varkan) | 200 / 300 | 2 (2 s) | 200 / 300 | 2 (2 s) | ✓ |
| ja | Dünung (Sael) → Stichel (Varkan) | 200 / 60 | 1 (0 s) | 200 / 60 | 1 (0 s) | ✓ |
| ja | Dünung (Sael) → Lehrling (Varkan) | 200 / 160 | 1 (0 s) | 200 / 150 | 1 (0 s) | ✓ |
| ja | Dünung (Sael) → Riegel I (Varkan) | 200 / 1.350 | 7 (12 s) | 200 / 1.300 | 7 (12 s) | ✓ |
| ja | Brecher (Sael) → Riegel II (Varkan) | 600 / 2.400 | 4 (30 s) | 600 / 2.250 | 4 (30 s) | ✓ |
| ja | Rinne (Varkan) → Riff II (Sael) | 600 / 2.100 | 4 (30 s) | 600 / 2.000 | 4 (30 s) | ✓ |
| ja | Riff II (Sael) → Meißel (Varkan) | 600 / 1.600 | 3 (8 s) | 600 / 1.500 | 3 (8 s) | ✓ |
| ja | Brandung (Sael) → Zapfstelle II (Varkan) | 2.875 / 2.100 | 1 (0 s) | 2.875 / 2.000 | 1 (0 s) | ✓ |
| ja | Brandung (Sael) → Glutkessel II (Varkan) | 2.875 / 2.600 | 1 (0 s) | 2.875 / 2.500 | 1 (0 s) | ✓ |
| ja | Brandung (Sael) → Riegel I (Varkan) | 2.875 / 1.350 | 1 (0 s) | 2.875 / 1.300 | 1 (0 s) | ✓ |
| ja | Tiegel (Varkan) → Brunnen II (Sael) | 2.100 / 1.950 | 1 (0 s) | 2.000 / 1.900 | 1 (0 s) | ✓ |
| ja | Tiegel (Varkan) → Laterne II (Sael) | 2.100 / 2.350 | 2 (21 s) | 2.000 / 2.300 | 2 (20 s) | ✓ |
| ja | Tiegel (Varkan) → Riff I (Sael) | 2.100 / 1.300 | 1 (0 s) | 2.000 / 1.300 | 1 (0 s) | ✓ |
| ja | Hochrost (Varkan) → Albatros (Sael) | 1.200 / 880 | 1 (0 s) | 1.200 / 848 | 1 (0 s) | ✓ |
| ja | Hochrost (Varkan) → Raubmöwe (Sael) | 1.200 / 1.200 | 1 (0 s) | 1.200 / 1.200 | 1 (0 s) | ✓ |
| ja | Hochlilie (Sael) → Krähe (Varkan) | 1.200 / 760 | 1 (0 s) | 1.200 / 700 | 1 (0 s) | ✓ |
| ja | Hochlilie (Sael) → Elster (Varkan) | 1.200 / 1.150 | 1 (0 s) | 1.200 / 1.200 | 1 (0 s) | ✓ |
| ja | Turmfalke (Varkan) → Sturmvogel (Sael) | 50 / 285 | 6 (5 s) | 50 / 285 | 6 (5 s) | ✓ |
| ja | Rost I (Varkan) → Seeschwalbe (Sael) | 40 / 28 | 1 (0 s) | 46 / 25 | 1 (0 s) | ✓ |
| ja | Seelilie I (Sael) → Lerche (Varkan) | 42 / 40 | 1 (0 s) | 42 / 35 | 1 (0 s) | ✓ |
| ja | Tölpel (Sael) → Punze (Varkan) | 200 / 300 | 2 (5 s) | 200 / 300 | 2 (5 s) | ✓ |
| ja | Tölpel (Sael) → Lehrling (Varkan) | 200 / 160 | 1 (0 s) | 200 / 150 | 1 (0 s) | ✓ |
| Info | Stichel (Varkan) → Kauri (Sael) | 7 / 170 | 25 (7,2 s) | 7 / 155 | 23 (6,6 s) | ✗ |
| Info | Sturmvogel (Sael) → Turmfalke (Varkan) | 48 / 295 | 7 (6 s) | 48 / 295 | 7 (6 s) | ✓ |
| Info | Punze (Varkan) → Dünung (Sael) | 28 / 160 | 6 (6 s) | 24 / 150 | 7 (6 s) | ✗ |
| Info | Stichel (Varkan) → Novize (Sael) | 7 / 125 | 18 (5,1 s) | 7 / 120 | 18 (5,1 s) | ✓ |
| Info | Knallkrebs (Sael) → Stichel (Varkan) | 27 / 60 | 3 (2 s) | 27 / 60 | 3 (2 s) | ✓ |
| Info | Kauri (Sael) → Stichel (Varkan) | 40 / 60 | 2 (1,6 s) | 40 / 60 | 2 (1,6 s) | ✓ |
| Info | Meißel (Varkan) → Knallkrebs (Sael) | 70 / 116 | 2 (1,3 s) | 70 / 115 | 2 (1,3 s) | ✓ |
| Info | Meißel (Varkan) → Kauri (Sael) | 70 / 170 | 3 (2,6 s) | 70 / 155 | 3 (2,6 s) | ✓ |
| Info | Konus (Sael) → Meißel (Varkan) | 950 / 1.600 | 2 (6,6 s) | 950 / 1.500 | 2 (6,6 s) | ✓ |
| Info | Reißnadel (Varkan) → Triton (Sael) | 1.000 / 2.750 | 3 (14 s) | 950 / 2.750 | 3 (13,2 s) | ✓ |
| Info | Riegel I (Varkan) → Knallkrebs (Sael) | 50 / 116 | 3 (0,6 s) | 50 / 115 | 3 (0,6 s) | ✓ |
| Info | Riff I (Sael) → Stichel (Varkan) | 50 / 60 | 2 (0,3 s) | 50 / 60 | 2 (0,3 s) | ✓ |

Die zwei abweichenden Info-Paare gehen auf den Konflikt zwischen Varkans Punze (28 statt 24 Schaden) und der Kauri-HP zurück: Stichel → Kauri braucht 25 statt 23 Treffer, Punze → Dünung 6 statt 7. Sie auf Sael-Seite zu „reparieren“ würde Pflichtpaare brechen (Kauri: Punze verlangt HP 169–196, Stichel 155–161). Der dritte Punkt (Sturmvogel → Turmfalke 6 statt 7) ist im fraktionsübergreifenden Abgleich behoben: Turmfalke 295 HP wie FA, Sturmvogel 285 HP wie FA (`docs/design/factions/README.md` §5.4, N×N-Prüfer `tools/roster/cross.py`).

**Schildbrechen (Info, ein einzelner Schütze, mit Regenerations-Verzögerung)** — zeigt Asymmetrie A5: Sael-Schilde halten Varkans Takt-Artillerie, Sael-Einzelschüsse brechen Varkan-Schilde schneller.

| Angreifer → Schild | Schüsse (Zeit) | FA-Waffe gegen FA-Schild-HP |
|---|---|---|
| Brandung (Sael) → Perlmutt II (Sael) | 17 (320 s) | 17 (320 s) |
| Sintflut (Sael) → Perlmutt II (Sael) | 1 (0 s) | 1 (0 s) |
| Sintflut (Sael) → Perlmutt III (Sael) | 2 (30 s) | 2 (20 s) |
| Woge (Sael) → Perlmutt II (Sael) | bricht allein nicht | bricht allein nicht |
| Tiegel (Varkan) → Perlmutt II (Sael) | bricht allein nicht | bricht allein nicht |
| Hochofen (Varkan) → Perlmutt III (Sael) | 5 (60 s) | 5 (40 s) |
| Brandung (Sael) → Schirm II (Varkan) | 8 (140 s) | 8 (140 s) |
| Sintflut (Sael) → Schirm III (Varkan) | 2 (30 s) | 2 (20 s) |

**T1-Rush gegen den Kommandanten (`checks.rush`, Review 2026-09-29)** — 3/3 Pflicht-Paarungen wie FA, 4/4 Info-Paarungen wie FA. Mindestzahl gleichzeitig feuernder T1-Einheiten, die den Kommandanten im offenen Schlagabtausch töten; Modell in `tools/roster/f3/rush.py` (Regeneration 10 HP/s, Sonderschuss ab 7.500 E, Start 13.900 E, +120 E/s, kein Kiten).

| Pflicht | Angreifer → Kommandant | ohne Sonderschuss | mit Sonderschuss | Mass (ohne / mit) | FA (ohne / mit) | ✓ |
|---|---|---|---|---|---|---|
| ja | Kauri (Sael) → Prior (Sael) | 21 | 22 | 1.134 / 1.188 | 21 / 22 | ✓ |
| ja | Punze (Varkan) → Prior (Sael) | 18 | 19 | 1.008 / 1.064 | 18 / 19 | ✓ |
| ja | Kauri (Sael) → Vogt (Varkan) | 22 | 23 | 1.188 / 1.242 | 22 / 23 | ✓ |
| Info | Punze (Varkan) → Vogt (Varkan) | 19 | 20 | 1.064 / 1.120 | 19 / 20 | ✓ |
| Info | Knallkrebs (Sael) → Prior (Sael) | 21 | 21 | 882 / 882 | 21 / 21 | ✓ |
| Info | Stichel (Varkan) → Prior (Sael) | 32 | 32 | 960 / 960 | 32 / 32 | ✓ |
| Info | Knallkrebs (Sael) → Vogt (Varkan) | 21 | 22 | 882 / 924 | 21 / 22 | ✓ |

Lesart: Sael braucht für den Vogt 21–22 Kauri (≈ 1.130–1.190 Mass), Varkan für den Prior 18–19 Punzen (≈ 1.010–1.060 Mass). Der Prior ist also rund 11 % billiger zu überrennen, wie das Vorbild-ACU (8 % weniger HP). Ausgleich: Kauri (RW 26) überreichen beide Kommandanten (RW 22) und können kiten, Punzen (RW 18) nicht. Die absoluten Zahlen hängen am Sonderschuss-Modell (Varkan-Review nannte 19 / 22); gegated wird nur die Gleichheit zur FA-Paarung.

---

## 15. Asymmetrie-Nachweis gegen Varkan

Verhältnis Sael ÷ Varkan pro Rolle, direkt aus beiden `roster.json`. Soll-Werte aus `faction.md` §9.2 (Vorbild-Relation). HP inkl. Schild.

| # | Rolle | Sael ↔ Varkan | Mass | HP/Mass | DPS/Mass | max. RW | Tempo | Soll (§9.2) |
|---|---|---|---|---|---|---|---|---|
| A1 | `lnd_t1_tank` | Kauri ↔ Punze | −3,6 % | −41,2 % | +11,1 % | 26 ↔ 18 | 3 ↔ 3,3 | RW +44 %, HP/Mass −46 %, DPS/Mass +8 %, Tempo −12 % |
| A2 | `lnd_t1_bot` | Knallkrebs ↔ Stichel | +40 % | +38,1 % | −17,3 % | 14 ↔ 14 | 3,8 ↔ 4,3 | Mass +40 %, HP/Mass +37 %, DPS/Mass −17 % |
| A3 | `lnd_t2_tank` | Triton ↔ Meißel | +80 % | −4,5 % | +23,8 % | 20 ↔ 22 | 2,7 ↔ 2,9 | Mass +82 %, DPS/Mass +23 %, (HP+Schild)/Mass +1 % |
| A3 | `lnd_t3_bot` | Einsiedler ↔ Fallhammer | +68 % | −12,6 % | +27 % | 27 ↔ 24 | 2,9 ↔ 3,3 | Mass +75 %, DPS/Mass +22 % |
| A4 | `lnd_t2_mml` | Brecher ↔ Rinne | ±0 % | ±0 % | ±0 % | 65 ↔ 60 | 2,8 ↔ 2,8 | Einzelschuss 600 statt 2×300 |
| A4 | `str_t2_pd` | Riff II ↔ Riegel II | +3,8 % | −15,7 % | +15,6 % | 50 ↔ 48 | – ↔ – | 600 / 4 s, Splash 2 statt Schnellfeuer |
| A4 | `str_t2_arty` | Brandung ↔ Tiegel | +15,6 % | −44,7 % | +24,4 % | 115 ↔ 110 | – ↔ – | DPS/Mass +31 % |
| A4 | `lnd_t1_arty` | Dünung ↔ Kelle | ±0 % | −23,8 % | +800,1 % | 30 ↔ 30 | 2,7 ↔ 2,7 | Präzisions-Mörser: DPS/Mass +730 % bei Splash 0,5 statt 1 (Stellungsbrecher) |
| A5 | `str_t2_shield` | Perlmutt II ↔ Schirm II | −20 % | +53 % | – | – ↔ – | – ↔ – | Schild/Mass +51 %, Radius −23 % |
| A5 | `lnd_t2_shield` | Muschel ↔ Schürze | ±0 % | +10,4 % | – | – ↔ – | 4 ↔ 3,4 | Schild/Mass +14 %, Tempo +14 % |
| A6 | `str_t1_fac_land` | Landkapitel I ↔ Landwerk I | ±0 % | −21,4 % | – | – ↔ – | – ↔ – | HP/Mass −20 % |
| A6 | `str_t1_pgen` | Laterne I ↔ Glutkessel I | ±0 % | −12,9 % | – | – ↔ – | – ↔ – | HP/Mass −12 % |
| A6 | `str_t1_mex` | Brunnen I ↔ Zapfstelle I | ±0 % | −5 % | – | – ↔ – | – ↔ – | HP/Mass −8 % |
| A6 | `str_t1_mstore` | Zisterne ↔ Erzspeicher | ±0 % | −20 % | – | – ↔ – | – ↔ – | HP/Mass bis −19 % |
| A6 | `lnd_t1_engineer` | Novize ↔ Lehrling | ±0 % | −21,9 % | – | – ↔ – | 1,9 ↔ 1,9 | HP −20 % |
| A7 | `lnd_t2_bot` | Languste ↔ Zange | −5,3 % | +70,5 % | −20,8 % | 24 ↔ 30 | 4 ↔ 3,2 | Tempo +48 %, HP/Mass +71 %, DPS/Mass −20 % (faction.md: +43 %, gerechnet mit nur einer der zwei Waffen der Varkan-Referenz) |
| A8 | `lnd_t1_scout` | Glimmer ↔ Funke | −33,3 % | +3,1 % | −25 % | 33 ↔ 22 | 4,6 ↔ 4,5 | Mass −33 %, RW 33 zu 26 |

Die Ist-Werte weichen von den Soll-Relationen nur so weit ab, wie Varkan und Sael jeweils innerhalb ±15 % um ihre FA-Referenz liegen (z. B. Kauri HP/Mass −41 % statt −46 %, weil Kauri +9,7 % und Punze ±0 % liegen).

---

## 16. Post-MVP-Markierungen (`special.postMvp`)

**Schweben über Wasser — M13** (15 Blueprints): Prior, Novize, Akolyth, Kustos, Glimmer, Kauri, Dünung, Seeigel, Triton, Brecher, Seestern, Muschel, Woge, Konus, Diadem. *MVP-Fallback:* Layer `land`; Schweben ist reine Optik (`motion.hoverHeightView`, Schattensaum, Schwebelicht). Tiefes Wasser bleibt unpassierbar wie für Varkan. Die Kategorie `HOVER` ist gesetzt, wirkt aber erst mit M13.

| Blueprint | Feature | Was | MVP-Fallback (Kern-Balance) |
|---|---|---|---|
| Prior | M13 | Amphibischer/schwebender Prior (Vorbild-ACU ist amphibisch) | Layer land |
| Prior | U14 | Enhancements: Teleport, Personal-Schild; Zeitdämpfer zusätzlich mit K18 | entfällt |
| Novize | M13, U17 | Bauen auf Wasser (schwebende Engineers) | kein Bau auf Wasser |
| Akolyth | M13, U17 | Bauen auf Wasser (schwebende Engineers) | kein Bau auf Wasser |
| Kustos | M13, U17 | Bauen auf Wasser (schwebende Engineers) | kein Bau auf Wasser |
| Triton | K10 | Personal-Schild: Rumpf 1.300 HP + Schild 1.450 HP, Regen 2/s ab 3 s nach dem letzten Treffer, Neuaufbau 75 s, 10 E/s | vor K10 (MS8–MS12): health.max = HP + Schild = 2.750, kein Unterhalt; (HP+Schild)/Mass bleibt gleich |
| Einsiedler | K10 | Personal-Schild: Rumpf 3.700 HP + Schild 1.000 HP, Regen 30/s ab 2 s, Neuaufbau 30 s, 30 E/s (gewundene Schale als Emitter) | vor K10: health.max = HP + Schild = 4.700 |
| Tölpel | K18 | Lähmwirkung der Perlbombe (Vorbild-Bomber) | reiner Splash-Schaden ohne Lähmung |
| (kein Blueprint) | neue ID (B-Kategorie) | Hingabe: Engineer löst sich in einen Bau auf | entfällt |
| (kein Blueprint) | K10 + neuer Schadenstyp | Schildbrecher | entfällt |
| (kein Blueprint) | M13, U17, U18 | Schweber als Marine-Konter | entfällt |

Keine Stealth-/Tarn-Asymmetrie (I5): das Vorbild setzt kaum darauf (`faction.md` §9.2).

---

## 17. Ökonomie-Kennzahlen (Kurzreferenz)

Produktion, Unterhalt und Adjacency sind fraktionsgleich (FA-Relation); Sael unterscheidet sich nur in HP/Mass (A6). Amortisation = Upgrade-Mass / Mehrproduktion; die zweite Zahl rechnet den Energy-Mehrbedarf als anteilige Laterne I ein (20 E/s ≙ 75 Mass).

| Gebäude | Ertrag | Unterhalt | Amortisation (Mass) | inkl. E-Mehrbedarf | Upgrade zur nächsten Stufe | Adjacency (FA-Relation) |
|---|---|---|---|---|---|---|
| Brunnen I | 2 M/s | −2 E/s | 18 s | ≈ 22 s (+2 E/s) | Brunnen II: 900 / BP 10 = 90 s | Gibt Fabriken −7,5 % Mass-Verbrauch (8×8); erhält +12,5 % je angrenzender Zisterne. |
| Brunnen II | 6 M/s | −9 E/s | 225 s (Δ 4 M/s) | ≈ 232 s (+7 E/s) | Brunnen III: 2.900 / BP 15 = 193 s | Fabriken −10 % Mass-Verbrauch; +12,5 % je Zisterne. |
| Brunnen III | 18 M/s | −54 E/s | 375 s (Δ 12 M/s) | ≈ 389 s (+45 E/s) | – | Fabriken −12,5 % Mass-Verbrauch; +12,5 % je Zisterne. |
| Laterne I | 20 E/s | – | – | – | – | Fabriken (8×8) −1,56 % Energy-Verbrauch, 2×2-Verbraucher −6,25 %; erhält +25 % Produktion je angrenzendem Schrein (SIZE4). |
| Laterne II | 500 E/s | – | – | – | – | Fabriken −12,5 % Energy-Verbrauch; erhält +8,3 % Produktion je angrenzendem Schrein (SIZE12). |
| Laterne III | 2.500 E/s | – | – | – | – | Fabriken −15,6 % Energy-Verbrauch; erhält +6,25 % Produktion je angrenzendem Schrein (SIZE16). |
| Quellbogen | 100 E/s | – | – | – | – | Wie Laterne II (Fabriken −12,5 % Energy); erhält +8,3 % je angrenzendem Schrein (SIZE12). |
| Zisterne | +500 M Speicher | – | – | – | – | +12,5 % Produktion je angrenzendem Brunnen (FA-Relation, max. 4 Seiten = +50 %). |
| Schrein | +10.000 E Speicher | – | – | – | – | Bufft alle angrenzenden Energieproduzenten (FA-Relation): Laterne I +25 % (SIZE4), Laterne II und Quellbogen +8,3 % (SIZE12), Laterne III +6,25 % (SIZE16). |

Weitere Upgrade-Dauern: Landkapitel I → Landkapitel II 115 s; Landkapitel II → Landkapitel III 300 s; Luftkapitel I → Luftkapitel II 115 s; Warte I → Warte II 60 s; Warte II → Warte III 75 s; Perlmutt II → Perlmutt III 205 s.

Prior: +1 M/s, +20 E/s, Grundspeicher 650 M / 3.900 E, Build Power 10 (wie Vogt).

---

## 18. Silhouetten-Pflichtpaare, Visuals, Glyphen

**Pflichtpaare MS9 (nur ●, 5 von 5 Testern):** Kauri ↔ Seeigel, Dünung ↔ Seeigel, Brecher ↔ Seestern, Triton ↔ Brecher, Knallkrebs ↔ Kauri, Novize ↔ Glimmer, Riff I ↔ Seelilie I, Brunnen I ↔ Laterne I, Laterne I ↔ Schrein, Zisterne ↔ Schrein.

**Pflichtpaare MS14:** Tölpel ↔ Sturmvogel, Sturmvogel ↔ Raubmöwe, Seeschwalbe ↔ Tölpel, Warte I ↔ Perlmutt II, Glimmer ↔ Muschel, Konus ↔ Triton, Sintflut ↔ Laterne III, Brunnen III ↔ Quellbogen.

**Kreuz-Fraktions-Paare (gleiche Rolle, Rolle muss trotz anderer Fraktion erkannt werden):** Kauri ↔ Punze, Seeigel ↔ Sieb, Dünung ↔ Kelle, Novize ↔ Lehrling, Riff I ↔ Riegel I.

**Visuals:** dieselben 28 Visual-IDs wie Varkan, je ein Superset-Mesh pro Rolle mit Tech-Bitmaske pro Vertex. Vereinigung nach (Part, Material):

| Visual | Mitglieder | Superset-Parts | ≈ Tris | Varkan-Tris |
|---|---|---|---|---|
| `v_cmd` | Prior | 6 | 292 | 256 |
| `v_eng` | Novize, Akolyth, Kustos | 7 | 332 | 220 |
| `v_scout` | Glimmer | 3 | 116 | 76 |
| `v_bot` | Knallkrebs, Languste, Einsiedler | 6 | 284 | 304 |
| `v_tank` | Kauri, Triton | 7 | 268 | 236 |
| `v_arty` | Dünung, Woge | 5 | 208 | 152 |
| `v_aa` | Seeigel, Seestern, Diadem | 8 | 202 | 188 |
| `v_mml` | Brecher | 5 | 180 | 152 |
| `v_shield_mobile` | Muschel | 5 | 248 | 124 |
| `v_sniper` | Konus | 4 | 184 | 168 |
| `v_air_scout` | Seeschwalbe | 3 | 92 | 52 |
| `v_fighter` | Sturmvogel | 3 | 92 | 52 |
| `v_bomber` | Tölpel | 3 | 92 | 88 |
| `v_gunship` | Albatros | 3 | 152 | 164 |
| `v_fbomber` | Raubmöwe | 4 | 196 | 148 |
| `v_mex` | Brunnen I, Brunnen II, Brunnen III | 6 | 348 | 204 |
| `v_pgen` | Laterne I, Laterne II, Laterne III | 5 | 312 | 204 |
| `v_hydro` | Quellbogen | 6 | 320 | 148 |
| `v_mstore` | Zisterne | 3 | 136 | 84 |
| `v_estore` | Schrein | 4 | 248 | 124 |
| `v_fac_land` | Landkapitel I, Landkapitel II, Landkapitel III | 7 | 324 | 244 |
| `v_fac_air` | Luftkapitel I, Luftkapitel II | 5 | 252 | 212 |
| `v_pd` | Riff I, Riff II | 5 | 224 | 160 |
| `v_aa_struct` | Seelilie I, Seelilie II, Hochlilie | 8 | 180 | 164 |
| `v_wall` | Deich | 1 | 60 | 28 |
| `v_radar` | Warte I, Warte II, Warte III | 5 | 140 | 100 |
| `v_shield` | Perlmutt II, Perlmutt III | 6 | 348 | 224 |
| `v_arty_struct` | Brandung, Sintflut | 5 | 236 | 152 |

Summe Superset-Tris: Sael ≈ 6.066, Varkan ≈ 4.428 (Kugeln und Tori sind teurer als Boxen). Im Kreuz-Match sind 56 Visuals im Umlauf (§20).

**Icon-Glyphen (19 Tokens, identisch zu Varkan):** `aa`, `arty`, `bomb`, `bot`, `build`, `direct`, `energy`, `estore`, `fac_air`, `fac_land`, `fbomb`, `hydro`, `intel`, `mass`, `mml`, `mstore`, `sam`, `shield`, `sniper`. Prior (`cmd_commander`) und Deich (`wall`) haben keine Glyphe. Schweben ändert kein Icon; Läufer tragen `bot`.

---

## 19. Entscheidungen beim Aufstellen

| Nr | Punkt | Entscheidung und Begründung |
|---|---|---|
| 1 | T1-Artillerie 100 DPS (spooky) | In FAF `develop` bestätigt (200 / 2,0 s, Splash 0,5). Übernommen als Sael-Identität „Stellungsbrecher“ (A4): 7 Treffer auf Riff I/Riegel I, 2 auf eine Punze. Gegen bewegte Ziele begrenzen Flugzeit, Splash 0,5 und Streuung die Wirkung; deshalb ist K1-Streuung für die Dünung Pflicht (§20). |
| 2 | Luft-DPS weit unter Varkan | Abfangjäger: spooky-Fehler (zweite Waffe fehlte), Referenz 48 statt 24 DPS. Bomber: 40 DPS ist echt (eine Bombe 200, Splash 4); Sael-Bomber schlagen selten und breit zu. Lähmung (K18) als Post-MVP markiert. |
| 3 | Triton-Schild | Rumpf 1.300 + Schild 1.450 = 2.750 statt 1.300 + 1.400 (faction.md §11.1): Nur 2.731–2.800 hält die 40 Meißel-Salven der FA-Relation. |
| 4 | Knallkrebs HP | 116 statt eines runderen Werts: Nur 113–119 hält gleichzeitig 5 Punze- und 17 Stichel-Treffer. |
| 5 | Riff I HP | 1.300 (±0 %) statt 1.350 wie Riegel I: sonst bräuchte die Kelle 14 statt 13 Treffer. |
| 6 | Raubmöwe HP | 1.200 (±0 %): Mit mehr HP überlebte sie eine Hochlilie-/Hochrost-Salve (FA: 1 Salve). |
| 7 | DoT-Waffen | Woge (15 × 95), Brandung (5 × 575) und Sintflut (2 × 6.000) schlagen als ein Einschlag bzw. Doppelschlag mit derselben Summe ein; Breakpoints und Pulk identisch. |
| 8 | Sintflut-Maßstab | wie Varkans Hochofen: RW 200, Kosten ≈ 67 %, Feuerrate ×⅔, gleicher Doppelschlag; Δ ±0. |
| 9 | Kitbash-Budget Engineers | Deckplatte als flaches `wing`-Prisma (16 Tris) statt zweiter `shell`, damit der Kustos mit drei Sicheln unter 350 Tris bleibt (332). Die Regel „eine Perle, ein Ring oder eine Sichel“ gilt für Kampfeinheiten; Engineers zeigen die Tech-Stufe über die Sichelzahl (§5.2). |
| 10 | Einsiedler-Doppelaufbau | keine zweite Perle (Budget-Lint max. 1 `orb`), stattdessen zweite Lanze und gewundene Schale. |
| 11 | Glanzstoß-Anzeige | Waffenbezeichnung ohne „Overcharge“ (faction.md §2.5); FAF-Formel nur in der dev-Notiz. |
| 12 | Referenzstand | Wie Varkan spooky 3810; develop-Abweichungen (T1-Panzer 1,7 s, T2-PD 560, T3-Artilleriestellung 79.000 Mass) nur dokumentiert, Nachziehen gemeinsam vor MS9. |

---

## 20. Offene Punkte

1. **Gemeinsamer Validator:** `checks.crossHitsToKill` existiert jetzt im Sael-Roster; `tools/roster/f3/validate.py` rechnet es gegen Varkans `roster.json` nach. Für f2/f4 braucht es einen fraktionsübergreifenden Validator (alle Paare N × N) und eine Entscheidung zu den drei Varkan-bedingten Info-Abweichungen (§14).
2. **Streuung (K1):** Das Feld `weapons[].firingRandomness` existiert jetzt (FA-Semantik, Pflicht für ballistische Artillerie, §21 B3). Offen: die Umrechnung in Sim-Einheiten in K1 und das MS7-Abnahmeszenario der Dünung (Zickzack-Trefferquote ≤ 30 %, Richtwert). Fallback, falls die Quote darüber liegt: Nachladezeit 2,0 → 3,0 s (Δ DPS/Mass −33 %, dann Referenz neu begründen). Varkan sollte das Feld für Kelle, Pfanne, Tiegel und Hochofen nachziehen.
3. **Draw-Budget Kreuz-Match:** 56 statt 28 Visuals; DECISIONS hat 40 Visuals getestet. Render-Bench mit beiden Fraktionen vor U22.
4. **Personal-Schild-Fallback** (Triton, Einsiedler) im Balance-Gate MS8/MS9 bestätigen; ab K10 Aufteilung in Rumpf und Schild ohne Änderung von (HP+Schild)/Mass.
5. **FA-Datenstand:** vor MS9 alle 50 Referenzen gegen den dann aktuellen FAF-Stand nachziehen, zusammen mit Varkan (siehe §1.1).
6. **Kartenpool und Sintflut:** Reichweiten-Gate wie beim Hochofen (Karten ≥ 354 WU).
7. **Schema-Erweiterung** um `ellipsoid`, `cone`, `torus`-Bogen und den Schicht-Dissolve (faction.md §3.6); die Tris-Werte hier sind Katalog-Schätzungen.
8. **Namen:** Markenrecherche zu „Sael“, Kapitel- und Rufnamen (Triton, Kauri); FA-Grep vor dem Einfrieren gegen den dann aktuellen FAF-Stand wiederholen (`fa_names.json` neu erzeugen). Der Prüfer checkt jetzt alle Rufnamen-Wörter gegen 357 FA-Einheiten- und 218 Waffennamen und hält Abstand ≥ 2 zu den Rufnamen aller anderen Roster (§21 E1, L2).
9. **Gemeinsamer Namens-Durchgang aller vier Fraktionen:** „Horn“ ist bei Sael Artillerie-Merkmal (Part, Waffennamen Horn-Mörser, Hornrakete, Schweres Horn) und bei f4 ein Einheitenname (T1-Artillerie). Gleiche Rolle, daher kein Blocker; beim Einfrieren entscheiden, ob eine Seite ausweicht.
10. **Rush-Modell für alle Fraktionen:** `tools/roster/f3/rush.py` in den gemeinsamen Validator übernehmen, damit alle Kommandanten-Paarungen (N × N) mit demselben Modell gegen FA gegated werden.

---

## 21. Review-Entscheidungen

Kritisches Review vom 2026-09-29 in vier Richtungen: **Balance** (nachgerechnet, Konter, T1-Rush gegen Kommandanten, Eco-Kurve), **Lesbarkeit** (Silhouetten, Icons, Namen im Match), **Eigenständigkeit** gegenüber FA und Passung zum Vorbild-Stil, **Vollständigkeit** der Rollen. ✓ = übernommen, ◐ = teilweise bzw. abgewandelt, ✗ = verworfen. Alle Gates danach erneut grün (`gen.py`, `validate.py`).

### Balance

| Nr | Punkt | | Entscheidung und Begründung |
|---|---|---|---|
| B1 | T1-Rush gegen den Kommandanten nicht nachgewiesen | ✓ | `tools/roster/f3/rush.py` und `checks.rush` (Generator-Gate, Prüfer rechnet nach). Kauri → Prior 21 / 22, Punze → Prior 18 / 19, Kauri → Vogt 22 / 23 Einheiten ohne / mit Sonderschuss, jeweils exakt wie die FA-Paarung. Der Prior ist gut 10 % billiger zu überrennen als der Vogt (Vorbild-Relation, 11.000 statt 12.000 HP); ausgeglichen durch die Kauri-Reichweite 26 gegen Kommandanten-RW 22 (Kiten). Keine Wertänderung nötig. |
| B2 | Eco-Kurve gleichwertig? | ✓ | Brunnen, Laternen, Quellbogen, Speicher, Kapitel, Engineers und Prior haben dieselben Kosten, Bauzeiten, Build Power und Erträge wie Varkan; das Opening ist bis zur ersten Kampfeinheit identisch (Kauri 14,5 s statt 15 s pro Einheit bei BP 20). Brunnen III und Luftkapitel II sind im fraktionsübergreifenden Abgleich auf die Varkan-Werte gesetzt (FA-Eco ist in allen Fraktionen gleich; `docs/design/factions/README.md` §5.1), es gibt keine Abweichung mehr. Sael zahlt die Asymmetrie nur in HP (A6), nicht im Tempo. |
| B3 | Dünung 100 DPS hängt an Streuung ohne Schemafeld | ✓ | Neues optionales Feld `weapons[].firingRandomness` (FA-Semantik, Werte aus FAF develop): Dünung 0,35, Woge 1,0, Brandung 2,0, Sintflut 0,35, Tölpel-Bombe 0. Der Prüfer verlangt es bei jeder ballistischen Artilleriewaffe. Die Dünung-Notiz enthält jetzt ein MS7-Abnahmeszenario (Zickzack-Trefferquote ≤ 30 %, Richtwert) mit dem Fallback 3,0 s. |
| B4 | „Dünung gegen Kelle ist ausgeglichen“ (faction.md §9.5) | ✓ | Falsch: Die Dünung tötet eine Kelle in 2 Treffern (2 s), die Kelle braucht 2 Treffer in 9 s; auch im Pulk-Modell liegt die Dünung pro Mass vorn. Wie im Vorbild gewinnt Sael das T1-Artillerie-Duell. Text korrigiert; Varkans Konter sind Stichel-Überfälle (4,3 gegen 2,7 Tempo, Mindest-RW 5) und Punzen-Vorstöße (6 Treffer auf eine Dünung). |
| B5 | Präzisionsschweber: develop-Stand abweichend | ◐ | develop hat RW 65 und 6,7 s statt RW 60 und 6,6 s (spooky 3810). Dokumentiert in `conventions.faDevelopCheck`, Nachziehen gemeinsam vor MS9; Breakpoint gegen den Triton (3 Treffer) bleibt. |
| B6 | Drei abweichende Kreuz-Info-Paare reparieren | ✗ | Ursache sind Varkan-Werte (Punze 28 statt 24 Schaden; Turmfalke 280 statt 295 HP ist im fraktionsübergreifenden Abgleich behoben, jetzt 2 statt 3 Paare). Auf Sael-Seite ginge das nur gegen Pflichtpaare (Kauri-HP-Fenster 169–196 gegen 155–161). Bleibt beim gemeinsamen Validator (§20.1). |
| B7 | Triton-Overkill gegen T1-Schwärme | ✗ | 360 Schaden pro Schuss tötet jede T1-Einheit einzeln; gegen Stichel-Schwärme verfällt Schaden. Das ist die Vorbild-Identität (A3/A4) und Varkans Konter. Keine Änderung. |

### Lesbarkeit

| Nr | Punkt | | Entscheidung und Begründung |
|---|---|---|---|
| L1 | Engineer: §5.2 verbietet die Perle, der Kitbash hat einen `orb`-Emitter | ✓ | Regel in faction.md §5.2 präzisiert: verboten sind Perle mit Lanze und eine freie Perle; ein kleiner, von der Sichelspitze umschlossener Glow-Emitter ist erlaubt (Flow-Ausnahme wie §5.3 Nr. 6). Geometrie bleibt. |
| L2 | Namensverwechslung zwischen den Fraktionen | ✓ | Regel 8 galt nur gegen Varkan. Treffer mit höchstens einem Buchstaben Abstand: Hummer ↔ Hummel (f2-Kampfschweber), Kegel ↔ Egel (f2-Massebohrung), Dorn ↔ Horn (f4-T1-Artillerie), EN Well ↔ Wall (Varkan-Mauer). Umbenannt in **Languste / Langouste**, **Konus / Conus**, **Seelilie I, II / Sea Lily I, II** und **Hochlilie / High Lily**, EN **Fountain I–III**. Waffen-IDs folgen (`wpn_langouste_lance_t2`, `wpn_conus_lance_t3`, `wpn_lily_*`). Der Prüfer hält jetzt Abstand ≥ 2 zu allen anderen Rostern. Belassen: Seeigel ↔ Igel (f2-SAM), gleiche Rolle, Abstand 3. |
| L3 | „Horn“ doppelt belegt (Sael-Artilleriemerkmal, f4-Einheitenname) | ◐ | Beide Male Artillerie, also kein Rollenkonflikt; der Part-Key ist Code, die Waffennamen stehen nur im Tooltip. Offen für den gemeinsamen Namens-Durchgang (§20.9). |
| L4 | Silhouetten, Icons, Teamfarbe | ✓ | Nachgeprüft: 28 Visuals, 19 Glyphen und alle Icon-IDs gleich Varkan, Monopol-Lints, Budget (max. 348 Tris) und Team-Part grün. Die AA-Familie trägt jetzt durchgängig „See…“ (Seeigel, Seestern, Seelilie); Seelilie ist wie Seeigel und Seestern ein Stachelhäuter (Wortfeld unverändert). |

### Eigenständigkeit

| Nr | Punkt | | Entscheidung und Begründung |
|---|---|---|---|
| E1 | FA-Grep deckte nur die Referenz-Einheiten ab | ✓ | Volltext-Grep gegen alle 357 Einheiten- und 218 Waffennamen aus spooky-db 3810 (`tools/roster/fa_names.json`, dev-only): Treffer „Crab“ (FA-Einheit „Crab Egg“). **Krabbe / Crab → Knallkrebs / Pistol Shrimp** (Waffe `wpn_shrimp_lance_t1`; der Knall passt zur Pulslanze). Der Prüfer führt den Grep jetzt bei jedem Lauf aus (erlaubt nur Air, Land, High, Sea). |
| E2 | Palette und Ordensrahmen nah am Vorbild | ◐ | Helles Perlmutt mit Jade-Licht und Gold sowie ein geistlicher Orden sind die gewollte Stil-Anlehnung. Eigenständig bleiben Motiv (Muschel, Perle, Meer, Mond), Formen (Schale auf Schwebeteller, Horn, Stachelkranz), Lore (Obhut statt Kreuzzug, kein Glaubensinhalt) und Klang (Klangschale statt Chor). Keine FA-Begriffe (§2.5), keine übernommenen Formen. Keine Änderung. |
| E3 | Passung zum Vorbild-Stil | ✓ | Schweben (M13), starke kleine Schilde (A5, K10), Reichweite (A1), Einzelschuss-Präzision (A4) und wenige teure Einheiten (A3) sind alle im Roster nachgewiesen (§15). Keine Änderung. |

### Vollständigkeit

| Nr | Punkt | | Entscheidung und Begründung |
|---|---|---|---|
| V1 | Rollenabdeckung | ✓ | 50 Blueprints, dieselben Rollen-IDs, ●/○, MS, Hotbuild-Slots und Visuals wie Varkan (Generator-Gate). Post-MVP-Asymmetrien tragen ihre Feature-ID: M13 (15 Blueprints), K10 (Triton, Einsiedler), K18 (Tölpel), U14 (Prior); I5 wird nicht gebraucht. |

---

## 22. Experimentals (T4, Post-MVP)

5 T4-Rollen, **nicht** in der Zählung oben (`experimentals[]`, gespiegelt in `reservedPostMvp[]` für den Namensabgleich in `cross.py`) und ohne Sim-Wirkung vor ihren Features. Design, Lore, Kitbash und Icons: `experimentals.md`. Daten und Gates: `tools/roster/f3/exp.py` (von `gen.py` eingebunden, von `validate.py` unabhängig nachgerechnet), Referenzen `fa_ref_t4.json` (Vorbild-T4, spooky 3810, dev-only). Gates: Boden-DPS/Mass, Luft-DPS/Mass, HP(+Schild)/Mass und Produkt je ±15 % gegen die Vorbild-T4, Pulk ±15 % bei Artillerie; Sael-Identität (Hauptwaffen-RW ≥ Vorbild, Schild-Anteil mobiler T4 ≥ 25 %, Strukturen zerbrechlicher, A6); Setons-Brücke (≥ 6 nebeneinander auf 72 WU); T4-Budget (≤ 1.500 / 800 / 320 Tris wie `@faf/modelkit` `T4_BUDGET`, ≤ 10 Part-Einträge, ≤ 3 animiert), `sizeClass = ceil(Außenmaß / 2)` und Monopol-Lints (§5.3 Nr. 6).

| ID | Name DE / EN | Rolle DE / EN | Mass / Energy / BT | HP (Rumpf + Schild) | DPS Boden · Luft | Tempo | Footprint · s | Icon | T4-Tab |
|---|---|---|---|---|---|---|---|---|---|
| `f3:exp_lnd_assault` | **Karkinos** / Karkinos | Riesen-Sturmläufer / Colossal Assault Walker | 27.500 / 343.750 / 51.500 | 102.000 (76.000 + 26.000) | 2.640 · – | 2,4 | 4×4 · 5 | `land_direct_t4` | Q |
| `f3:exp_lnd_fortress` | **Ammonit** / Ammonite | Schwebende Festung / Hover Fortress | 24.000 / 380.000 / 38.400 | 62.000 (44.000 + 18.000) | 800 · – | 2,5 | 8×8 · 5 | `land_sniper_t4` | E |
| `f3:exp_air_carrier` | **Pelikan** / Pelican | Schwebeträger / Hover Carrier | 45.000 / 1.530.000 / 50.625 | 70.000 (36.000 + 34.000) | 3.300 · 2.843 | 8 | 16×16 · 0 | `air_direct_t4` | R |
| `f3:exp_str_arty` | **Kreuzsee** / Cross Sea | Fernartillerie / Strategic Artillery | 202.500 / 5.400.000 / 100.000 | 8.100 | 426 · – | – | 10×10 | `struct_arty_t4` | W |
| `f3:exp_str_eco` | **Perle** / Pearl | Ressourcenperle / Resource Pearl | 250.200 / 7.506.000 / 325.000 | 4.500 | 0 · – | – | 8×8 | `struct_mass_t4` | T |

**Waffen und Todeswaffen:**

| Einheit | Waffen | Todeswaffe |
|---|---|---|
| Karkinos | `wpn_karkinos_lance` Tiefenlanze (Doppellanze, Einzelstoß): 1.200 / 0,5 s = **2.400 DPS**, RW 2–42, linear, Splash 0,5<br>`wpn_karkinos_claw` Scherenlanzen (2 × kurz): 2×60 / 0,5 s = **240 DPS**, RW 30, linear | 8.000 im Radius 7 (Schalenbruch: Rückenschild birst in Perlmutt-Splittern (P14); FA-Relation 1:1.) |
| Ammonit | `wpn_ammonite_lance` Gezeitenlanze (Einzelstoß, Überlänge): 8.000 / 10 s = **800 DPS**, RW 10–158, linear (langsam, Flugzeit), Splash 5 | 6.000 im Radius 8 (Spiralbruch: die Windungen reißen von außen nach innen (P14).) |
| Pelikan | `wpn_pelican_plunge` Senkstoß (aus dem Kehlsack, nur unter sich): 1.650 / 0,5 s = **3.300 DPS**, RW 30, senkrecht (Hitscan-Puls), Splash 4<br>`wpn_pelican_skyspine` Himmelsstachel (4 × Lenkrakete, Luft): 4×300 / 1,3 s = **923,1 DPS**, RW 120, Lenkflugkörper, Splash 2 [Luft]<br>`wpn_pelican_burstspine` Sprengstachel (2 Werfer × 2, Nahbereich, Luft): 4×240 / 0,5 s = **1.920 DPS**, RW 44, linear (Flak), Splash 3 [Luft] | 7.000 im Radius 15 (Absturz: Kuppel zerschellt, Kehlsack reißt auf (K12, P14); FA-Relation 1:1.) |
| Kreuzsee | `wpn_crosssea_horn` Kreuzseegranate (6 Splitter): 6×220 / 3,1 s = **425,8 DPS**, RW 150–1.500, ballistisch (teilt sich über dem Ziel), Splash 2 | 4.000 im Radius 10 (Hornbruch: Energievorrat der Kammer entlädt sich (K14, P14).) |
| Perle | – | 35.000 im Radius 25 (Perlsprung der Perle: wie das Vorbild (35.000 im Radius 25), K14/P14. Nie neben die eigene Basis setzen.) |

**Balance gegen die Vorbild-T4** (Referenz dev-only über Blueprint-ID; Gegenprobe = T4 der Varkan-Vorbild-Fraktion, nur Info):

| Einheit | Referenz | ΔDPS/Mass Boden | ΔDPS/Mass Luft | ΔHP/Mass | ΔProdukt | Pulk | Sael-Identität |
|---|---|---|---|---|---|---|---|
| Karkinos | `UAL0401` (Gegenprobe `UEL0401`) | +5,6 % | – | +2 % | +7,7 % | – | RW ≥ Vorbild ✓ · Schild-Anteil 25 % ✓ |
| Ammonit | `UAS0401` (Gegenprobe `UEL0401`) | ±0 % | – | +3,3 % | +3,3 % | – | RW ≥ Vorbild ✓ · Schild-Anteil 29 % ✓ |
| Pelikan | `UAA0310` (Gegenprobe `UES0401`) | −0,9 % | ±0 % | ±0 % | −0,9 % | – | RW ≥ Vorbild ✓ · Schild-Anteil 49 % ✓ |
| Kreuzsee | `XAB2307` (Gegenprobe `UEB2401`) | ±0 % | – | −10 % | −10 % | ±0 % | zerbrechlicher ✓ |
| Perle | `XAB1401` | – | – | −10 % | – | – | zerbrechlicher ✓ |

**Kitbash (T4-Budget):**

| Einheit | Monopol-Merkmal | Parts | Außenmaß L × B × H (Beinspanne) | Brücke 72 WU |
|---|---|---|---|---|
| Karkinos | Scherenschild: breitester Rückenschild der Armee (6,4 × 5,2 WU, breiter als lang) mit zwei vorgestreckten Scherenschalen, in jeder eine kurze Lanze; obenauf die Perle mit waagerechter Doppellanze. | legs×10, shell(rueckenschild) [team], shell(bauchschale) [jade], shell×2(scherenschalen) [team], orb(perle) ⟳yaw [team], lance×2(tiefenlanze) ⟳pitch, lance×2(scherenlanzen) — 7 Einträge, 2 anim., ≈ 1.036 Tris | 5,2 × 6,4 × 5 (8,4) WU | 8 nebeneinander |
| Ammonit | Liegende Spiralschale: drei ineinanderlaufende, teamfarbene Windungen (Ø 9 → 5 → 2,5 WU) als flache Spirale auf dem größten Schwebeteller, aus der Mündung eine Perle mit Überlänge-Lanze (≥ 1,2 × Rumpflänge), am Heck das goldene Kapiteltor. | hoverpad, shell×3(windungen) [team], shell(bauchschale) [jade], orb(muendungsperle) ⟳yaw [team], lance(gezeitenlanze) ⟳pitch, ring(schildring) ⟳yaw, arch(kapiteltor) [glow] — 7 Einträge, 3 anim., ≈ 944 Tris | 11 × 9 × 4,6 WU | 8 nebeneinander |
| Pelikan | Kehlsack-Schwinge: die breiteste Ovalschwinge (20 WU Spannweite) mit hängendem, teamfarbenem Kehlsack (≥ 0,6 × Rumpflänge), darüber eine Kuppel mit waagerechtem Schildring; keine Lanze, keine Perle. | wing×2(ovalschwinge) [team], shell(rueckenkuppel), shell(kehlsack) [team], ring(schildring) ⟳yaw, arch(hangartor) [glow] — 5 Einträge, 1 anim., ≈ 520 Tris | 14 × 20 × 4 WU | – |
| Kreuzsee | Hornkranz: drei große Hörner als Trommel um eine gemeinsame schräge Achse (50°), größte Horn-Mündung der Armee (Ø 2,4 WU), dahinter eine hohe Gegenschale. | shell(kissen) [team], shell(gegenschale), mast(lafette) ⟳yaw, horn×3(hornkranz) ⟳pitch, shell(kammerschale) [jade] — 5 Einträge, 2 anim., ≈ 600 Tris | 10 × 10 × 9 WU | – |
| Perle | Offene Muschel: größte Perle der Armee (Ø 3,2 WU, Goldkern) in einer aufgeklappten Doppelschale, darüber ein kreisender Goldring. | shell(kissen) [team], shell(untere schale), shell(obere schale) ⟳pitch, orb(riesenperle) [glow], ring(goldring) ⟳spin [gold] — 5 Einträge, 2 anim., ≈ 664 Tris | 8 × 8 × 6,5 WU | – |

**Post-MVP-Features je Einheit:**

| Einheit | braucht | Eigenheit (Feature) → MVP-Fallback |
|---|---|---|
| Karkinos | U16, K10, M13, K5, P14 | **K10**: Personal-Schild 26.000 (Regen 90/s ab 3 s, Neuaufbau 60 s, 150 E/s), Rumpf 76.000 HP → *vor K10: health.max = HP + Schild = 102.000*<br>**M13**: Amphibisch: schreitet über den Grund von Wasser, feuert nicht unter Wasser (Vorbild amphibisch) → *Layer land, Wasser unpassierbar*<br>**U16**: Erstes Land-Experimental des Ordens: Bau durch Kustos/Prior, großes Wrack (90 % Mass, K5) → *kein Blueprint vor U16*<br>**P14**: Großereignis-Effekt beim Schalenbruch (Klangschalen-Schlag, Splitterregen) → *Standard-Todeseffekt* |
| Ammonit | U21, M13, K10, B3-Erweiterung, I3, P14 | **M13**: Schwebt über Wasser (Layer Hover); einzige Sael-T4 für Wasserkarten → *Layer land, Wasser unpassierbar*<br>**K10**: Personal-Schild 18.000 (Regen 60/s ab 3 s, Neuaufbau 60 s, 100 E/s), Rumpf 44.000 HP → *vor K10: health.max = 62.000*<br>**B3-Erweiterung**: Produktion aus einer mobilen Einheit (Queue läuft auch in Bewegung, Ausstoß am Kapiteltor) → *keine Produktion*<br>**U18**: Tiefenstachel gegen Schiffe und U-Boote (Vorbild 6 × 350 alle 5 s, RW 80), nur mit U17/U18 → *entfällt*<br>**I3**: Radar 150 WU → *nur Sicht 60 WU* |
| Pelikan | U21, U12, K10, B3-Erweiterung, U13, U20, K12, I3, P14 | **U12**: Flugmodell der schweren Luft (Schweben über dem Ziel, Wendekreis, Bau durch T3-Engineers) → *kein Blueprint*<br>**K10**: Blasen-Schild 34.000, Radius 22, Regen 180/s ab 2 s, Neuaufbau 120 s, 500 E/s → *vor K10: health.max = 70.000, kein Schutz für andere*<br>**B3-Erweiterung**: Produktion aus einer fliegenden Einheit (Luftkapitel-Liste T1–T2) → *keine Produktion*<br>**U13**: Kehlsack-Hangar: lagert bis 40 Flieger T1–T2 und startet sie in Wellen → *kein Hangar*<br>**U20**: Air Staging im Hangar: Reparatur und Treibstoff → *entfällt*<br>**K12**: Absturzschaden 7.000 im Radius 15 → *Standard-Todeseffekt* |
| Kreuzsee | U21, K13, K2, K4, K1-Erweiterung, E3, I3, K14, P14 | **U21**: Game-Ender: Bau durch Kustos/Prior, kartenweite Reichweite → *kein Blueprint*<br>**K1-Erweiterung**: Splittergeschoss: teilt sich über dem Ziel in 6 Splitter (je eigener Einschlag, Streukreis 7 WU) → *Salve aus 6 Einzelgranaten à 220 mit Streukreis 7 WU (vorhandene K1-Streuung), gleiche Pulk-Rechnung*<br>**K13**: Stationäre Artillerie; eigenes T4-Reichweiten-Gate: RW 1.500 ≥ Diagonale jeder Karte bis 1.024 WU, Mindest-RW 150 → *Karten > 1.024 WU (M14): RW-Deckel prüfen*<br>**E3**: Energie pro Schuss (15.000) als Stall-Verbraucher: bei Energy-Stall Feuerpause → *Dauerverbrauch 4.840 E/s*<br>**K14**: Todeswaffe 4.000 im Radius 10 → *Standard-Todeseffekt*<br>**P14**: Großereignis: Einschlag-Kreuzmuster auf der Minimap, Alert „Fernbeschuss“ → *Standard-Alert* |
| Perle | U21, E17, E4, K14, P14 | **E17**: Endgame-Eco: Grundertrag plus Bedarfsdeckung (Mehrbedarf pro Tick bis zu den Deckeln) → *kein Blueprint*<br>**E4**: Energiespeicher 100.000 → *–*<br>**K14**: Todeswaffe 35.000 im Radius 25 (Perlsprung) → *Standard-Todeseffekt*<br>**P14**: Großereignis: Perlsprung mit Klangschalen-Schlag und Druckring → *Standard-Todeseffekt* |

**develop-Stand der T4-Referenzen** (Roster bleibt auf spooky 3810 wie alle Kern-Einheiten):

| BP | spooky 3810 | develop | Ergebnis |
|---|---|---|---|
| `UAA0310` | 45.000 M / 1.530.000 E / BT 50.625, Schild-Regen 180/s | 42.750 M / 1.453.500 E / BT 48.094, Schild-Regen 240/s, Luft-Tempo 8 (Air.MaxAirspeed) | nach 3810 um 5 % verbilligt; Relation DPS/Mass +5 %, HP/Mass +5 % → beim Nachziehen Pelikan-Kosten mitziehen. |
| `UAS0401` | 24.000 M / 380.000 E / BT 38.400, Kanone 8.000 / 10 s | 25.000 M / 400.000 E / BT 40.000, Kanone 10.000 / 11 s (RackSalvoReloadTime 10,9) | nach 3810 stärker (DPS/Mass +9 %); Ammonit beim Nachziehen auf 10.000 / 11 s. |
| `XAB2307` | 220 / 3,1 s = 70,97 DPS | 6 Splitter × 220 / 3,1 s = 425,81 DPS, 15.000 E pro Schuss | spooky-Fehler (Splitter nicht gezählt) → FA_T4_OVERRIDES. |
| `XAB1401` | kein Ertrag (Skript) | Skript XAB1401: Grundertrag 20 M/s + 1.000 E/s, deckt Mehrbedarf bis 10.000 M/s bzw. 1.000.000 E/s; Todeswaffe 35.000 im Radius 25 | Ertragsmodell aus develop übernommen (spooky führt es nicht). |
| `UAL0401` | identisch | Greifklauen RW 30 (spooky 41), TractorDamage 240 | ohne Einfluss (Klauen nicht übernommen). |

