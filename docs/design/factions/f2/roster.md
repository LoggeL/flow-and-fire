# Roster: Skarn-Geflecht (f2, MVP)

> **Status:** Startwerte für alle MVP-Blueprints der zweiten Fraktion auf Basis von `docs/design/factions/f2/faction.md`. Maschinenlesbar in `docs/design/factions/f2/roster.json` (Schema `faf-roster/1`, identisch zu Varkan). **`roster.json` ist die einzige Quelle für Zahlen, ●/○-Status und Kitbash-Parts**; dieses Dokument ist daraus erzeugt (`tools/roster/f2/md.py`). Überarbeitet nach dem Review vom 2026-09-29 (§19).
> **Umfang:** **50 Blueprints** (23 mobil, 27 Gebäude, jede Upgrade-Stufe einzeln), davon **26 im MS9-Kern (●)**, Rest bis MS14 (○). Gleiche Rollen-IDs, Feature-IDs, Icons und Hotbuild-Tasten wie Varkan. 28 Visuals, 19 Icon-Glyphen (dieselben wie Varkan). Dazu 5 reservierte Post-MVP-Rollen (§16) und 5 Experimentals (T4, §20), nicht mitgezählt.
> **Ausgeschlossen:** wie Varkan (TML/TMD, Nukes, Transporter, T3-Luft, Marine, Experimentals, SACU, Enhancements, Stealth/Omni). Eigenheiten der Vorbild-Fraktion, die solche Mechaniken brauchen, sind pro Einheit als `special.postMvp` mit Feature-ID markiert (§16). Die Kern-Balance gilt ohne sie.
> **Balancing:** gegen die **Vorbild-Fraktion** als FA-Referenz (nur über Blueprint-Präfix `UR*`/`DR*` referenziert, dev-only). Hartes Gate ±25 % DPS/Mass und HP/Mass; der Generator erzwingt Einzelachsen, Produkt und Pulk-DPS/Mass je ±15 %, eine Treffer-bis-Tod-Matrix exakt wie die Vorbild-Referenz und einen **Kreuz-Check gegen Varkan** (§14.4). Validierung: `tools/roster/f2/validate.py`.

---

## 1. Quellen und Methodik

- **FA-Daten:** [FAForever/spooky-db](https://github.com/FAForever/spooky-db) `app/data/index.json` (Datenstand „3810“, 503 Blueprints), abgerufen 2026-09-29, extrahiert mit `tools/roster/f2/fa_extract.py` nach `tools/roster/f2/fa_ref.json` (nur Zahlen, dev-only). DPS-Formel wie Varkan (`app/js/dps.js`: Nachladezeit auf 0,1-s-Ticks, Salven über Muzzle/Racks, Strahl-Waffen über Pulse).
- **Referenzwahl (faction.md §9.2):** primär die Einheit der Vorbild-Fraktion in derselben Rolle (`faReference.bp`), Gegenprobe ist Varkans Referenz (`crossCheckBp`). Fehlt der Vorbild-Fraktion eine Rolle, gilt Varkans Referenz: **Mobiler Schild** (`UEL0307`, bewusst am unteren Bandrand) und **Präzisionsläufer** (`XAL0305`). **Schildkette:** Kokon II gegen Stufe 1 (`URB4202`), Kokon III gegen die erste T3-Stufe (`URB4206`); die zwei T2-Zwischenstufen der Vorbild-Kette entfallen, weitere Stufen kommen mit B8.
- **Mehrwaffen-Einheiten:** Alle Waffen der Referenz werden addiert (wie spooky-db), unsere ebenso: Klette und Hagedorn mit schwacher Bodenwaffe, Tarantel mit Nahlinse, Stechmücke mit Luft- und Abwurfwaffe. Beim Rädelsführer zählt nur die Hauptwaffe (Überschlag nicht in DPS/Mass).
- **Globale Verschiebung wie Varkan:** Varkan liegt im Mittel bei +4,3 % HP/Mass und −1 % DPS/Mass gegenüber seiner Referenz. Damit beide Fraktionen untereinander im FA-Verhältnis stehen, trägt Skarn dieselbe Verschiebung (HP ≈ +4 %, wo kein Breakpoint bricht). Die Skarn-Signatur (billiger, schneller, zerbrechlicher) steckt in den Relationen der Vorbild-Referenz selbst, nicht in Zusatz-Abschlägen.
- **Einheiten, Waffen, Abweichung, Produkt, Pulk, Treffer bis Tod, Kitbash-Budget, Maßstab:** exakt wie Varkan (`docs/design/roster.md` §1). Tris-Schätzung **ohne Beine** (der Render-Pfad erzeugt sie, faction.md §3.3); `legs` zählt als 1 Part, die Beinzahl steht in `kitbash.legs` (2 leicht, 4 Linie, 6 T3/Rädelsführer).
- **Lints (faction.md §5.3):** `spike` nur bei ANTIAIR/WALL, `tail` nur bei ARTILLERY, `lens` nur bei DIRECTFIRE, `spool`/`druse`/`glow` nur bei ECONOMIC/FACTORY/ENGINEER, mindestens ein Team-Part, Beinzahl 6 bei T3 und Rädelsführer, gleiche Icons/Hotbuild-Tasten wie Varkan.
- **Spalten:** ● = MS9-Kern · MS = erster Meilenstein (1:1 von Varkan, weil aus denselben Features) · RW = Reichweite · s = sizeClass · R = Radar · Regen = HP/s · Δ = gegen Vorbild-Referenz · ΔV = Relation zu Varkan gegen FA-Relation (§14.3).

---

## 2. Zählung nach Meilenstein

| MS | neu gebraucht | Blueprints |
|---|---|---|
| MS4 | 3 (Σ 3) | ● Rädelsführer, ● Egel I, ● Druse I |
| MS5 | 1 (Σ 4) | ● Zecke |
| MS6 | 4 (Σ 8) | ● Flicker, ● Floh, ● Glimmzelle, ● Landnest I |
| MS7 | 3 (Σ 11) | ● Schabe, ● Nessel, ● Klette |
| MS8 | 13 (Σ 24) | ● Stopfer, ● Ohrwurm, ● Wolfsmilch, ● Ginster, ● Egel II, ● Druse II, ● Landnest II, ● Falle I, ● Falle II, ● Schlehe I, ● Schlehe II, ● Igel, ● Hecke |
| MS10 | 4 (Σ 28) | ● Fumarole, ● Wabe, ○ Fühler I, ○ Fühler II |
| MS12 | 7 (Σ 35) | ○ Motte, ○ Bremse, ○ Brummer, ○ Hummel, ○ Stechmücke, ○ Luftnest I, ○ Luftnest II |
| MS13 | 14 (Σ 49) | ○ Weber, ○ Gespinst, ○ Tarantel, ○ Stechapfel, ○ Langbein, ○ Hagedorn, ○ Egel III, ○ Druse III, ○ Landnest III, ○ Fühler III, ○ Kokon II, ○ Kokon III, ○ Schierling, ○ Bilsenkraut |
| MS14 | 1 (Σ 50) | ○ Milbe |

**MS9-Kern (26):** Rädelsführer, Flicker, Stopfer, Schabe, Floh, Zecke, Nessel, Klette, Ohrwurm, Wolfsmilch, Ginster, Egel I, Egel II, Druse I, Druse II, Fumarole, Wabe, Glimmzelle, Landnest I, Landnest II, Falle I, Falle II, Schlehe I, Schlehe II, Igel, Hecke.

### 2.1 Abweichungen gegenüber Varkan (Rollen gleich, Ausprägung anders)

| Punkt | Festlegung | Grund |
|---|---|---|
| Schabe unbewaffnet | `f2:lnd_t1_scout` ohne Waffe, Kategorie ohne DIRECTFIRE | Vorbild-Relation (die Referenz hat keine Waffe); dafür 8 statt 12 Mass, Radar 44 |
| Klette / Hagedorn mit Bodenwaffe | zusätzliche schwache Waffe gegen Land, Kategorie DIRECTFIRE | Vorbild-Relation; Form bleibt Dornenkamm (Winkel-Code senkrecht) |
| Milbe als Raketenläufer | T2-Läufer mit ungelenkter Direktfeuer-Raketensalve (Splash 2) statt Gatling | Vorbild-Relation (FAF-T2-Raketenläufer); Abschuss aus der Linse, damit der Winkel-Code direkt bleibt |
| Regeneration der Basis | `health.regenPerSec` bei Egel, Druse, Fumarole, Wabe, Nestern | faction.md §9.3; Sim über die generische `regen`-Spalte (PLAN §3.4, G6 ab MS10), vor U19 vorhanden (§19 R3) |
| Gespinst am unteren Bandrand | −10 % Kosten, ≈ −14 % HP+Schild/Mass gegenüber `UEL0307` | Vorbild hat keinen mobilen Schild (faction.md §9.2) |
| Kokon II → III ohne Zwischenstufen | ein Upgrade-Sprung, Stufen IV/V mit B8 | faction.md §9.4; Gesamtkosten II+III pro HP+Schild ≈ Varkans Schirm II+III |
| Nessel schneller nachladend | 5,8 statt 6,0 s | gleicht die fehlende Lähmung (K18) innerhalb des 15-%-Bands aus (faction.md §9.5 Nr. 1); nicht weiter, weil die Kreuz-Relation zur Kelle sonst +16 % erreicht (§19 R1) |
| Tarantel zäher | 3.200 statt 3.000 HP | gleicht den fehlenden Raketen-Ablenker (K16) im Band aus |

---

## 3. Hotbuild-Raster (identisch zu Varkan)

**Landnest**

| | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Reihe 1 | **Q** Kampfläufer (Zecke/Ohrwurm) | **W** Artillerie (Nessel/Wolfsmilch/Stechapfel) | **E** Engineer (Flicker/Stopfer/Weber) | **R** Flugabwehr (Klette/Ginster/Hagedorn) | – |
| Reihe 2 | **A** Späher (Schabe) | **S** Läufer (Floh/Milbe/Tarantel) | **D** Support (Gespinst) | **F** Präzision (Langbein) | **G** reserviert: Tarnfeld (Silberfisch, I5) |

**Luftnest**

| | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Reihe 1 | **Q** Abfangjäger (Bremse) | **W** Bomber (Brummer) | **E** Gunship (Hummel) | **R** Jagdbomber (Stechmücke) | – |
| Reihe 2 | **A** Aufklärer (Motte) | – | – | – | – |

**Bau**

| | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Reihe 1 | **Q** Egel | **W** Druse | **E** Fumarole | **R** Wabe | **T** Glimmzelle |
| Reihe 2 | **A** Landnest | **S** Luftnest | **D** Fühler | **F** Kokon | **G** reserviert: Tarnfeld-Generator (Nachtschatten, I5) |
| Reihe 3 | **Z** Falle | **X** Schlehe/Igel | **C** Hecke | **V** Schierling/Bilsenkraut | – |

Gleiche Taste = gleiche Rolle über alle Tech-Stufen; mehrfaches Drücken wechselt nur die Tech-Stufe (höchste baubare zuerst). Upgrade-Stufen über das Upgrade-Kommando der Command Card. Das Bau-Menü nutzt die 5. Spalte (T), weil 13 Rollen nicht auf 12 Tasten passen. Raster identisch zu Varkan (gleiche Taste = gleiche Rolle in jeder Fraktion).

---

## 4. Rädelsführer und Engineers

**Stammdaten**

| | ID | DE / EN | Rolle | Referenz (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Beine | Footprint | Sicht / R | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f2:cmd_commander` | **Rädelsführer** / Ringleader | Kommandant / Commander | Armored Command Unit (ACU) (`URL0001`, Gegenprobe `UEL0001`) | MS4 | 2.000 / 5.000.000 / 6.000.000 | 10.000 (+18/s) | 1,7 / 90° | 6 | 2×2 / s2 | 26 | – | `cmd_commander` |
| ● | `f2:lnd_t1_engineer` | **Flicker** / Patcher | Ingenieur / Engineer | T1 Engineer (`URL0105`, Gegenprobe `UEL0105`) | MS6 | 52 / 260 / 260 | 147 | 1,9 / 180° | 4 | 1×1 / s1 | 18 | Landnest: E | `eng_build_t1` |
| ● | `f2:lnd_t2_engineer` | **Stopfer** / Darner | Ingenieur / Engineer | T2 Engineer (`URL0208`, Gegenprobe `UEL0208`) | MS8 | 130 / 650 / 650 | 405 | 1,9 / 160° | 4 | 1×1 / s1 | 20 | Landnest: E | `eng_build_t2` |
| ○ | `f2:lnd_t3_engineer` | **Weber** / Weaver | Ingenieur / Engineer | T3 Engineer (`URL0309`, Gegenprobe `UEL0309`) | MS13 | 310 / 1.550 / 1.550 | 770 | 1,9 / 140° | 6 | 1×1 / s1 | 26 | Landnest: E | `eng_build_t3` |

**Waffen und Balance** (Δ gegen Vorbild-Referenz; ΔV = Relation zu Varkan gegen FA-Relation)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt | ΔV DPS / HP |
|---|---|---|---|---|---|---|---|
| `cmd_commander` | `wpn_ringleader_lens` Granatlinse (Direktfeuer): 100 / 1 s = **100,0 DPS**, RW 1–22, linear<br>`wpn_ringleader_flashover` Überschlag (Overcharge, manuell/auto): 15.000 / 3,3 s = **4.545,4 DPS**, RW 22, linear, Splash 2,5 | 0,050 (0,050) | ±0 % | 5,000 (5,000) | ±0 % | ±0 % | ±0 % / ±0 % |
| `lnd_t1_engineer` | – | – (–) | – | 2,827 (2,788) | +1,4 % | – | – / −5,0 % |
| `lnd_t2_engineer` | – | – (–) | – | 3,115 (3,000) | +3,8 % | – | – / −1,1 % |
| `lnd_t3_engineer` | – | – (–) | – | 2,484 (2,372) | +4,7 % | – | – / −0,9 % |

**Kategorien, Besonderheiten, Post-MVP, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Post-MVP (Feature-ID) | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|---|
| `cmd_commander` | LAND MOBILE COMMAND ENGINEER DIRECTFIRE RECLAIM REPAIR UNIQUE | BP 10 · +1 M/s · +20 E/s · Speicher 650 M · Speicher 3.900 E<br>Toggles: auto_flashover (MS10, C17)<br>Death: `wpn_tangle_snap` 2.000/r30 + 500/r40 (Geflechtriss: Schaden und Radius wie Varkans Lotbruch (FA-Relation 1:1, beide Referenzen gleich), Kamera-Shake X4. Lähmung erst mit K18.)<br>Einzigartig, Tod = Niederlage (U1/A4, „Geflecht gerissen. Biss verloren.“). Baut alle T1-Strukturen. Regeneration 18 HP/s (Varkan 10), dafür 10.000 statt 12.000 HP (Vorbild-Relation). Durchbruch-Spawn nur View (P19).<br>wpn_ringleader_flashover: Gleiche Formel wie Varkans Abstich (core:wpn_reeve_tapshot): Schaden = clamp(max. HP der mobilen Nicht-Kommandanten im Umkreis 2,7 WU [ohne Ziel: 1250], 1250, min(15000, 0,9 × Vorrat / 6)); Drain = 6 × tatsächlicher Schaden; feuert erst ab 7500 E Vorrat (braucht Glimmzelle). Gegen Strukturen fix 800, gegen Kommandanten fix 400. Nicht in DPS/Mass gewertet. | **K18**: Geflechtriss lähmt mobile Einheiten im Radius. Skarn-eigene Ergänzung ohne Vorbild-Wert (Review E4); Dauer und Radius werden mit K18 festgelegt.<br>**I5 + U14**: Tarnung als Enhancement (Radar-Unsichtbarkeit).<br>**M13**: Amphibisch: läuft über den Grund von Wasser (Vorbild-Relation: nur Kommandant und Engineers). Im MVP reine Landeinheit (faction.md §9.5 Nr. 3). | Großer 6-Beiner (Höhe 2,1 WU, Beinspanne 3,4 WU): Keilpanzer-Torso mit teamfarbenem Kopfkamm, Herzdruse als stärkster Glutpunkt auf dem Rücken, Granatlinse mittig unter dem Kopf, zwei Quarz-Nadeln als Taster links/rechts (symmetrisch, kein Waffen-/Bauarm-Schema), Spule im Rücken.<br>legs#6, carapace(torso kopfkamm) ⟳yaw [team], druse(herzdruse) [glow], lens(kopflinse) ⟳pitch [sinew], needle(taster l) [quartz], needle(taster r) [quartz], spool(ruecken) [team] — 7 Parts, 2 anim., ≈ 178 Tris · Maßstab 1 · keine Streifen | MS4 Bauen ohne Waffe; MS5 Waffe + Geflechtriss; MS6 Überschlag (U8) |
| `lnd_t1_engineer` | LAND MOBILE ENGINEER TECH1 RECLAIM REPAIR<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | BP 5<br>Baut T1-Strukturen, Assist, Reclaim, Repair. Baustrahl = Fadenstrom (2–3 Granatfäden, nur View). | **M13**: Amphibisch: läuft über den Grund von Wasser (Vorbild-Relation: nur Kommandant und Engineers). Im MVP reine Landeinheit (faction.md §9.5 Nr. 3). | Kurzer breiter Keilpanzer mit Quarz-Deck auf 4 Beinen, Spule quer über dem Heck (Randscheiben teamfarben, Achse glüht), eine Quarz-Nadel diagonal nach vorn rechts mit glühendem Emitter; 1 Tech-Streifen schwarz.<br>legs#4, carapace(deck) [quartz], spool(spule) [team], needle(nadel) ⟳yaw [quartz], needle(emitter) ⟳pitch [glow] — 5 Parts, 2 anim., ≈ 116 Tris · Maßstab 1 · 1 Streifen (schwarz) | U2 (T1) in MS6 |
| `lnd_t2_engineer` | LAND MOBILE ENGINEER TECH2 RECLAIM REPAIR<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | BP 13<br>Baut T1+T2-Strukturen (u. a. Egel II direkt, Druse II, Falle II, Schlehe II, Kokon II). | **M13**: Amphibisch: läuft über den Grund von Wasser (Vorbild-Relation: nur Kommandant und Engineers). Im MVP reine Landeinheit (faction.md §9.5 Nr. 3). | Wie Flicker, Maßstab 1,3, zwei Quarz-Nadeln verschiedener Länge, 2 Tech-Streifen schwarz.<br>legs#4, carapace(deck) [quartz], spool(spule) [team], needle(nadel) ⟳yaw [quartz], needle(kurze nadel) [quartz], needle(emitter) ⟳pitch [glow] — 6 Parts, 2 anim., ≈ 132 Tris · Maßstab 1,3 · 2 Streifen (schwarz) | U2 T2 als Daten in MS8 |
| `lnd_t3_engineer` | LAND MOBILE ENGINEER TECH3 RECLAIM REPAIR<br>*von:* `FACTORY & LAND & TECH3` | BP 32<br>Baut T1–T3-Strukturen (u. a. Igel, Bilsenkraut, Druse III, Egel III direkt). Kokon III nur per Upgrade. | **M13**: Amphibisch: läuft über den Grund von Wasser (Vorbild-Relation: nur Kommandant und Engineers). Im MVP reine Landeinheit (faction.md §9.5 Nr. 3). | Maßstab 1,4 (Deckel für 1×1), 6 Beine, drei Quarz-Nadeln (Anzahl = Tech, dritte statisch), 3 Tech-Streifen schwarz.<br>legs#6, carapace(deck) [quartz], spool(spule) [team], needle(nadel) ⟳yaw [quartz], needle(kurze nadel) [quartz], needle(dritte nadel) [quartz], needle(emitter) ⟳pitch [glow] — 7 Parts, 2 anim., ≈ 148 Tris · Maßstab 1,4 · 3 Streifen (schwarz) | Rest U2 (T3-Engineer) in MS13 |

---

## 5. Landarmee T1

**Stammdaten**

| | ID | DE / EN | Rolle | Referenz (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Beine | Footprint | Sicht / R | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f2:lnd_t1_scout` | **Schabe** / Roach | Späher / Scout | T1 Land Scout (`URL0101`, Gegenprobe `UEL0101`) | MS7 | 8 / 60 / 60 | 16 | 4,8 / 180° | 2 | 1×1 / s1 | 24 / R 44 | Landnest: A | `land_intel_t1` |
| ● | `f2:lnd_t1_bot` | **Floh** / Flea | Leichter Sturmläufer / Light Assault Bot | T1 Light Assault Bot (`URL0106`, Gegenprobe `UEL0106`) | MS6 | 35 / 140 / 140 | 95 | 4 / 45° | 2 | 1×1 / s1 | 18 | Landnest: S | `land_bot_t1` |
| ● | `f2:lnd_t1_tank` | **Zecke** / Tick | Kampfläufer / Battle Walker | T1 Assault Bot (Linienrolle) (`URL0107`, Gegenprobe `UEL0201`) | MS5 | 56 / 280 / 285 | 280 | 3,7 / 80° | 4 | 1×1 / s1 | 20 | Landnest: Q | `land_direct_t1` |
| ● | `f2:lnd_t1_arty` | **Nessel** / Nettle | Mobile Artillerie / Mobile Artillery | T1 Mobile Light Artillery (`URL0103`, Gegenprobe `UEL0103`) | MS7 | 36 / 180 / 200 | 140 | 2,9 / 90° | 4 | 1×1 / s1 | 18 | Landnest: W | `land_arty_t1` |
| ● | `f2:lnd_t1_aa` | **Klette** / Bur | Mobile Flugabwehr / Mobile AA | T1 Mobile Anti-Air Gun (`URL0104`, Gegenprobe `UEL0104`) | MS7 | 55 / 275 / 220 | 270 | 2,9 / 90° | 4 | 1×1 / s1 | 20 | Landnest: R | `land_aa_t1` |

**Waffen und Balance** (Δ gegen Vorbild-Referenz; ΔV = Relation zu Varkan gegen FA-Relation)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt | ΔV DPS / HP |
|---|---|---|---|---|---|---|---|
| `lnd_t1_scout` | – | – (–) | – | 2,000 (1,875) | +6,7 % | – | – / −3,3 % |
| `lnd_t1_bot` | `wpn_pulse_lens_t1_light` Pulslinse (3er-Puls): 3×7 / 1 s = **21,0 DPS**, RW 14, linear (Puls) | 0,600 (0,600) | ±0 % | 2,714 (2,571) | +5,6 % | +5,6 % | ±0 % / +5,6 % |
| `lnd_t1_tank` | `wpn_pulse_lens_t1` Pulslinse: 8 / 0,3 s = **26,7 DPS**, RW 18, linear (Puls) | 0,476 (0,476) | ±0 % | 5,000 (4,821) | +3,7 % | +3,7 % | +2,9 % / +3,7 % |
| `lnd_t1_arty` | `wpn_emp_capsule_t1` Blitzkapsel: 230 / 5,8 s = **39,7 DPS**, RW 5–30, ballistisch, Splash 2 | 1,102 (1,065) | +3,5 % | 3,889 (3,889) | ±0 % | +3,5 % | +12,2 % / −2,4 % |
| `lnd_t1_aa` | `wpn_bur_darts_aa_t1` Lenkpfeile (Luft): 16 / 0,5 s = **32,0 DPS**, RW 32, homing (K11) [air]<br>`wpn_bur_darts_ground_t1` Pfeilsalve (Boden, schwach): 9 / 0,5 s = **18,0 DPS**, RW 18, linear | 0,909 (0,909) | ±0 % | 4,909 (4,727) | +3,8 % | +3,8 % | −7,1 % / +3,8 % |

**Kategorien, Besonderheiten, Post-MVP, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Post-MVP (Feature-ID) | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|---|
| `lnd_t1_scout` | LAND MOBILE SCOUT INTELLIGENCE TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | −1 E/s Unterhalt<br>Unbewaffnet (Vorbild-Relation; Varkans Funke hat ein MG). Billiger (8 statt 12 Mass), schneller, größeres Radar (44 statt 40). | **I5**: Tarnung (Cloak) wie die Vorbild-Referenz; Bedingungen und Energiekosten legt I5 fest. Im MVP ohne Tarnung, Balance unverändert. | Kleinster Panzer auf 2 Beinen, zwei lange Fühler (≥ 1,0 × Rumpflänge) schräg nach vorn oben; keine Linse, kein Ring.<br>legs#2, carapace [team], antenna(fuehler l), antenna(fuehler r) — 4 Parts, 0 anim., ≈ 56 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | U4 T1-Armee in MS7; Radar-Feld wirkt ab MS10 (I3) |
| `lnd_t1_bot` | LAND MOBILE DIRECTFIRE BOT TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Zäher Raider: HP/Mass +24 %, DPS/Mass −18 % gegenüber Varkans Stichel (Vorbild-Relation). | – | Kurzer Keilpanzer hoch auf 2 langen Beinen (Beine länger als der Panzer), Granatlinse auf kurzem Hals.<br>legs#2, carapace [team], neck ⟳yaw, lens ⟳pitch [sinew] — 4 Parts, 2 anim., ≈ 44 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | erste Fabrik-Einheit im Opening (MS6); U4 abgenommen MS7 |
| `lnd_t1_tank` | LAND MOBILE DIRECTFIRE TANK TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Glaskanone der Linie: DPS/Mass +14 %, HP/Mass −7 %, Tempo 3,7 statt 3,3 gegenüber der Punze. Viele kleine Treffer (8 Schaden / 0,3 s). Breakpoints: 3 Kommandanten-Treffer, 6 Falle-I-Treffer, 6 Ohrwurm-Salven (exakt Vorbild). | – | Flacher Keilpanzer 1,0 × 0,3 × 1,4 WU auf 4 Hochbeinen (Spanne ≈ 1,6 WU), waagerechte Granatlinse (≈ 54 % der Rumpflänge) ragt über die Bugspitze; teamfarbene Rückenplatte ≈ 34 % inkl. Beine.<br>legs#4, carapace [team], neck ⟳yaw, lens ⟳pitch [sinew], carapace(heckplatte) — 5 Parts, 2 anim., ≈ 68 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | erste Kampfeinheit (Konsole, MS5), Fabrik ab MS6 |
| `lnd_t1_arty` | LAND MOBILE INDIRECTFIRE ARTILLERY TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Harter Einzelschlag (2,3 × Kelle), Splash 2, wenig HP. Nachladezeit 5,8 statt 6,0 s: gleicht die fehlende Lähmung innerhalb des 15-%-Bands aus (faction.md §9.5 Nr. 1, +3,5 % DPS/Mass). Nicht 5,6 s: Varkans Kelle liegt schon 8 % unter ihrer Referenz, die Kreuz-Relation Nessel/Kelle stiege sonst auf +16 % (Review R1).<br>wpn_emp_capsule_t1: Im MVP ohne Lähmung; Einschlag hinterlässt ≈ 3 s ein knisterndes Blitz-Decal (nur View). | **K18**: Treffer lähmen Ziele im Splash kurz (Dauer nach Vorbild-Relation); dann Nachladezeit zurück auf 6,0 s. | Langer schmaler Keilpanzer auf 4 Beinen, dreigliedriger Schwanz über dem Rücken, Sechseck-Kapsel (Ø 0,4 WU) schräg nach vorn (≈ 50°); keine Linse, nichts Waagerechtes.<br>legs#4, carapace [team], neck(schwanzansatz) ⟳yaw, tail ⟳pitch [team], pod(kapsel) [sinew] — 5 Parts, 2 anim., ≈ 92 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | K2 Ballistik in MS7 |
| `lnd_t1_aa` | LAND MOBILE ANTIAIR DIRECTFIRE TECH1<br>*von:* `FACTORY & LAND & (TECH1 \| TECH2 \| TECH3)` | Starke, zerbrechliche T1-Flugabwehr mit schwacher Bodenwaffe (Vorbild-Relation). Beide Waffen im DPS-Vergleich addiert. | – | Keilpanzer auf 4 Beinen, Dornenkamm aus 3 senkrechten Dornen (≥ 75°) quer zur Laufrichtung.<br>legs#4, carapace [team], neck(kammsockel) ⟳yaw, spike(dorn), spike(dorn), spike(dorn) — 6 Parts, 1 anim., ≈ 60 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | U4 in MS7, Wirkung gegen Luft MS12 |

---

## 6. Landarmee T2

**Stammdaten**

| | ID | DE / EN | Rolle | Referenz (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Beine | Footprint | Sicht / R | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f2:lnd_t2_tank` | **Ohrwurm** / Earwig | Schwerer Kampfläufer / Heavy Battle Walker | T2 Heavy Tank (`URL0202`, Gegenprobe `UEL0202`) | MS8 | 290 / 1.450 / 1.300 | 1.980 | 2,9 / 90° | 4 | 1×1 / s2 | 22 | Landnest: Q | `land_direct_t2` |
| ● | `f2:lnd_t2_mml` | **Wolfsmilch** / Spurge | Raketenwerfer / Missile Launcher | T2 Mobile Missile Launcher (`URL0111`, Gegenprobe `UEL0111`) | MS8 | 180 / 1.300 / 800 | 730 | 3 / 90° | 4 | 1×1 / s2 | 18 | Landnest: W | `land_mml_t2` |
| ● | `f2:lnd_t2_aa` | **Ginster** / Gorse | Flak / Flak | T2 Mobile AA Flak Artillery (`URL0205`, Gegenprobe `UEL0205`) | MS8 | 160 / 800 / 800 | 1.050 | 2,9 / 90° | 4 | 1×1 / s2 | 20 | Landnest: R | `land_aa_t2` |
| ○ | `f2:lnd_t2_shield` | **Gespinst** / Gossamer | Mobiler Schild / Mobile Shield | T2 Mobile Shield Generator (Vorbild hat keinen – Varkan-Referenz) (`UEL0307`) | MS13 | 198 / 810 / 600 | 140 + Schild 2.300 | 3,5 / 120° | 4 | 1×1 / s1 | 20 | Landnest: D | `land_shield_t2` |
| ○ | `f2:lnd_t2_bot` | **Milbe** / Mite | Raketenläufer / Rocket Bot | T2 Rocket Bot (FAF) (`DRL0204`, Gegenprobe `DEL0204`) | MS14 | 200 / 1.000 / 1.000 | 570 | 3,4 / 80° | 2 | 1×1 / s1 | 26 | Landnest: S | `land_bot_t2` |

**Waffen und Balance** (Δ gegen Vorbild-Referenz; ΔV = Relation zu Varkan gegen FA-Relation)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt | ΔV DPS / HP |
|---|---|---|---|---|---|---|---|
| `lnd_t2_tank` | `wpn_pulse_lens_t2` Doppel-Pulslinse: 2×25 / 0,6 s = **83,3 DPS**, RW 24, linear (schnell) | 0,287 (0,287) | ±0 % | 6,828 (6,552) | +4,2 % | +4,2 % | +1,0 % / −1,3 % |
| `lnd_t2_mml` | `wpn_spurge_missile_t2` Saftrakete: 200 / 3,3 s = **60,6 DPS**, RW 6–60, homing (Wenderate, K11), Splash 1 | 0,337 (0,337) | ±0 % | 4,056 (3,889) | +4,3 % | +4,3 % | ±0 % / +10,3 % |
| `lnd_t2_aa` | `wpn_gorse_flak_t2` Dornenflak: 90 / 0,6 s = **150,0 DPS**, RW 40, linear + Näherungszünder (MS12), Splash 4 [air] | 0,938 (0,938) | ±0 % | 6,562 (6,250) | +5,0 % | +5,0 % | +2,9 % / ±0 % |
| `lnd_t2_shield` | – | – (–) | – | 12,323 (14,318) | −13,9 % | – | – / −19,3 % |
| `lnd_t2_bot` | `wpn_mite_rockets_t2` Stachelraketen (3er-Salve, Direktfeuer): 3×60 / 4 s = **45,0 DPS**, RW 36, linear (langsam, ungelenkt), Splash 2 | 0,225 (0,225) | ±0 % | 2,850 (2,750) | +3,6 % | +3,6 % | −1,5 % / −1,5 % |

**Kategorien, Besonderheiten, Post-MVP, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Post-MVP (Feature-ID) | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|---|
| `lnd_t2_tank` | LAND MOBILE DIRECTFIRE TANK TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | Linsen am Hals geparentet (1 animierter Part). Teurer und zäher als Varkans Meißel (Vorbild-Relation). HP 1.980 statt 1.900: dieselbe globale HP-Verschiebung wie der Rest des Rosters, bricht keinen Breakpoint (Review R2). | – | Zecke × 1,3 mit zwei parallelen Linsen und Zangen-Platten am Bug (aus V2 „Klaue“), 2 Tech-Streifen, weiterhin 4 Beine.<br>legs#4, carapace [team], neck ⟳yaw, lens [sinew], lens [sinew], carapace(zangen platten) — 6 Parts, 1 anim., ≈ 76 Tris · Maßstab 1,3 · 2 Streifen (quarzweiß) | U6 in MS8 |
| `lnd_t2_mml` | LAND MOBILE INDIRECTFIRE ARTILLERY SILO TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | Einzelraketen im schnellen Takt statt Varkans 2er-Salve (Vorbild-Relation). RW 60 wie Varkans Rinne. | – | Schwanz trägt statt der Kapsel einen breiten Köcher (0,5 × 0,25 × 1,1 WU) bei 50° (≥ 2 × Dorn-Breite); keine Linse.<br>legs#4, carapace [team], neck(schwanzansatz) ⟳yaw, tail ⟳pitch [team], pod(koecher) — 5 Parts, 2 anim., ≈ 92 Tris · Maßstab 1,3 · 2 Streifen (quarzweiß) | U6 inkl. MML über K11 in MS8 |
| `lnd_t2_aa` | LAND MOBILE ANTIAIR TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | Nur Luftziele, Splash trifft Pulks. | – | Klette × 1,3 mit 4 senkrechten Dornen, 2 Tech-Streifen.<br>legs#4, carapace [team], neck(kammsockel) ⟳yaw, spike, spike, spike, spike — 7 Parts, 1 anim., ≈ 68 Tris · Maßstab 1,3 · 2 Streifen (quarzweiß) | U6 in MS8, Wirkung/Näherungszünder MS12 |
| `lnd_t2_shield` | LAND MOBILE SHIELD DEFENSE TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | Schild 2.300 HP, r15, +50/s nach 3 s, Neuaufbau 24 s, −70 E/s<br>Toggles: shield (MS13, C17)<br>Vorbild-Fraktion hat keinen mobilen Schild: Referenz wie Varkans Schürze, bewusst am unteren Bandrand (−10 % Kosten, ≈ −14 % HP+Schild/Mass, faction.md §9.2). Erfüllt U6; der Silberfisch (I5) kommt später zusätzlich. | – | Keilpanzer auf 4 Beinen, Netzring waagerecht (Ø ≥ 1,2 × Rumpfbreite) als höchster Punkt auf zwei Fühler-Stützen.<br>legs#4, carapace [team], antenna(stuetze l), antenna(stuetze r), webring(netzring) ⟳yaw [team] — 5 Parts, 1 anim., ≈ 80 Tris · Maßstab 1,3 · 2 Streifen (quarzweiß) | Rest U6 (mobiler Schild) mit K10 in MS13 |
| `lnd_t2_bot` | LAND MOBILE DIRECTFIRE BOT TECH2<br>*von:* `FACTORY & LAND & (TECH2 \| TECH3)` | Salvenläufer, der Falle I (RW 26) überreicht. Ungelenkte Direktfeuer-Raketen mit Splash; Abschuss aus der Linse, damit der Winkel-Code direkt bleibt. | – | Floh × 1,3 mit Seitenplatten und 2 Tech-Streifen, weiterhin 2 Beine.<br>legs#2, carapace [team], neck ⟳yaw, lens ⟳pitch [sinew], carapace(seitenplatten) — 5 Parts, 2 anim., ≈ 68 Tris · Maßstab 1,3 · 2 Streifen (quarzweiß) | Roster-Auffüllung auf 45–55 BP (MS14); nicht Teil von U6 |

---

## 7. Landarmee T3

**Stammdaten**

| | ID | DE / EN | Rolle | Referenz (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Beine | Footprint | Sicht / R | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ○ | `f2:lnd_t3_bot` | **Tarantel** / Tarantula | Belagerungsläufer / Siege Bot | T3 Siege Assault Bot (`URL0303`, Gegenprobe `UEL0303`) | MS13 | 480 / 5.000 / 2.400 | 3.200 | 3,8 / 120° | 6 | 2×2 / s2 | 22 | Landnest: S | `land_bot_t3` |
| ○ | `f2:lnd_t3_arty` | **Stechapfel** / Thornapple | Schwere Artillerie / Heavy Artillery | T3 Mobile Heavy Artillery (`URL0304`, Gegenprobe `UEL0304`) | MS13 | 800 / 8.000 / 4.300 | 880 | 2,2 / 75° | 6 | 2×2 / s2 | 26 | Landnest: W | `land_arty_t3` |
| ○ | `f2:lnd_t3_sniper` | **Langbein** / Longlegs | Präzisionsläufer / Sniper Bot | T3 Sniper Bot (Vorbild hat keinen – Referenz aus anderer FA-Fraktion, wie Varkan) (`XAL0305`) | MS13 | 700 / 22.000 / 4.800 | 460 | 2,4 / 110° | 6 | 1×1 / s1 | 26 | Landnest: F | `land_sniper_t3` |
| ○ | `f2:lnd_t3_aa` | **Hagedorn** / Hawthorn | Schwere Flugabwehr / Heavy AA | T3 Mobile Missile Anti-Air (FAF) (`DRLK001`, Gegenprobe `DELK002`) | MS13 | 600 / 7.000 / 3.000 | 1.980 | 3,6 / 120° | 6 | 1×1 / s2 | 26 | Landnest: R | `land_aa_t3` |

**Waffen und Balance** (Δ gegen Vorbild-Referenz; ΔV = Relation zu Varkan gegen FA-Relation)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt | ΔV DPS / HP |
|---|---|---|---|---|---|---|---|
| `lnd_t3_bot` | `wpn_tarantula_lens_t3` Doppellinse, schwer (3er-Puls): 3×150 / 3,3 s = **136,4 DPS**, RW 20, linear<br>`wpn_tarantula_close_t3` Nahlinse: 28 / 0,4 s = **70,0 DPS**, RW 24, linear (Puls) | 0,430 (0,430) | ±0 % | 6,667 (6,250) | +6,7 % | +6,7 % | +4,2 % / +7,6 % |
| `lnd_t3_arty` | `wpn_thornapple_capsule_t3` Brandkapsel, schwer: 450 / 6,6 s = **68,2 DPS**, RW 25–88, ballistisch, Splash 6 | 0,085 (0,085) | ±0 % | 1,100 (1,062) | +3,5 % | +3,5 % | +7,2 % / −1,6 % |
| `lnd_t3_sniper` | `wpn_longlegs_lens_t3` Langlinse: 1.000 / 6,6 s = **151,5 DPS**, RW 60, linear (schnell) | 0,216 (0,206) | +5,3 % | 0,657 (0,714) | −8,0 % | −3,2 % | +9,1 % / −15,5 % |
| `lnd_t3_aa` | `wpn_hawthorn_aa_t3` Lenkdornen: 100 / 1 s = **100,0 DPS**, RW 60, homing (K11), Splash 1,5 [air]<br>`wpn_hawthorn_ground_t3` Bodendornen (schwach): 30 / 1,8 s = **16,7 DPS**, RW 25, linear | 0,195 (0,195) | −0,4 % | 3,300 (3,167) | +4,2 % | +3,8 % | +0,6 % / −1,0 % |

**Kategorien, Besonderheiten, Post-MVP, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Post-MVP (Feature-ID) | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|---|
| `lnd_t3_bot` | LAND MOBILE DIRECTFIRE BOT TECH3<br>*von:* `FACTORY & LAND & TECH3` | HP 3200 statt 3000: gleicht den fehlenden Raketen-Ablenker innerhalb des Bands aus (faction.md §9.5 Nr. 1). | **K16**: Ablenker fängt taktische Raketen im Nahbereich ab; dann HP zurück auf 3000.<br>**K18**: Death-EMP lähmt Einheiten im Umkreis. | Überlanger Keilpanzer auf 6 Beinen, Doppellinse plus kurze Nahlinse, Rückenpanzer, 3 Tech-Streifen.<br>legs#6, carapace [team], neck ⟳yaw, lens [sinew], lens [sinew], lens(nahlinse) [sinew], carapace(rueckenpanzer) — 7 Parts, 1 anim., ≈ 84 Tris · Maßstab 1,7 · 3 Streifen (quarzweiß) | U10 T3-Landarmee in MS13 |
| `lnd_t3_arty` | LAND MOBILE INDIRECTFIRE ARTILLERY TECH3<br>*von:* `FACTORY & LAND & TECH3` | Kein Deploy (wie Varkan). Kleinerer Einzelschlag, schnellerer Takt und größerer Splash als Varkans Pfanne (Vorbild-Relation). | – | Nessel × 1,7 auf 6 Beinen mit zweitem Schwanz, 3 Tech-Streifen.<br>legs#6, carapace [team], neck(schwanzansatz) ⟳yaw, tail ⟳pitch [team], pod(kapsel) [sinew], tail(zweiter schwanz) — 6 Parts, 2 anim., ≈ 128 Tris · Maßstab 1,7 · 3 Streifen (quarzweiß) | U10 in MS13 |
| `lnd_t3_sniper` | LAND MOBILE DIRECTFIRE SNIPER BOT TECH3<br>*von:* `FACTORY & LAND & TECH3` | Zerbrechlicher und etwas schneller feuernd als Varkans Reißnadel (Fraktionssignatur, im Band). | – | Panzer hoch über dem Boden (Knie ≥ 1,5 × Rumpflänge) auf 6 überlangen Beinen, Linse ≥ 1,2 × Rumpflänge; Maßstab 1,4.<br>legs#6, carapace [team], neck ⟳yaw, lens(langlinse) ⟳pitch [sinew] — 4 Parts, 2 anim., ≈ 44 Tris · Maßstab 1,4 · 3 Streifen (quarzweiß) | U10 in MS13 |
| `lnd_t3_aa` | LAND MOBILE ANTIAIR DIRECTFIRE TECH3<br>*von:* `FACTORY & LAND & TECH3` | Lenkflugkörper-Flugabwehr mit schwacher Bodenwaffe (Vorbild-Relation). | – | Ginster × 1,4 (1×1-Deckel) mit 4 dickeren Dornen auf 6 Beinen, 3 Tech-Streifen.<br>legs#6, carapace [team], neck(kammsockel) ⟳yaw, spike, spike, spike, spike — 7 Parts, 1 anim., ≈ 68 Tris · Maßstab 1,4 · 3 Streifen (quarzweiß) | U10 in MS13 |

---

## 8. Luftwaffe T1–T2

**Stammdaten**

| | ID | DE / EN | Rolle | Referenz (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Beine | Footprint | Sicht / R | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ○ | `f2:air_t1_scout` | **Motte** / Moth | Aufklärer / Air Scout | T1 Air Scout (`URA0101`, Gegenprobe `UEA0101`) | MS12 | 40 / 560 / 200 | 28 | 19 / 100° | – | 1×1 / s0 | 42 / R 64 | Luftnest: A | `air_intel_t1` |
| ○ | `f2:air_t1_fighter` | **Bremse** / Gadfly | Abfangjäger / Interceptor | T1 Interceptor (`URA0102`, Gegenprobe `UEA0102`) | MS12 | 50 / 2.200 / 500 | 280 | 15 / 120° | – | 1×1 / s0 | 28 | Luftnest: Q | `air_aa_t1` |
| ○ | `f2:air_t1_bomber` | **Brummer** / Bluebottle | Bomber / Bomber | T1 Attack Bomber (`URA0103`, Gegenprobe `UEA0103`) | MS12 | 90 / 2.000 / 500 | 200 | 10 / 80° | – | 1×1 / s0 | 32 / R 44 | Luftnest: W | `air_bomb_t1` |
| ○ | `f2:air_t2_gunship` | **Hummel** / Bumblebee | Kampfschweber / Gunship | T2 Gunship (`URA0203`, Gegenprobe `UEA0203`) | MS12 | 270 / 5.200 / 1.800 | 850 | 12 / 90° | – | 1×1 / s0 | 32 | Luftnest: E | `air_direct_t2` |
| ○ | `f2:air_t2_fbomber` | **Stechmücke** / Mosquito | Jagdbomber / Fighter-Bomber | T2 Fighter/Bomber (FAF) (`DRA0202`, Gegenprobe `DEA0202`) | MS12 | 420 / 8.000 / 2.400 | 1.150 | 15 / 110° | – | 1×1 / s0 | 32 / R 64 | Luftnest: R | `air_fbomb_t2` |

**Waffen und Balance** (Δ gegen Vorbild-Referenz; ΔV = Relation zu Varkan gegen FA-Relation)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt | ΔV DPS / HP |
|---|---|---|---|---|---|---|---|
| `air_t1_scout` | – | – (–) | – | 0,700 (0,650) | +7,7 % | – | – / −5,8 % |
| `air_t1_fighter` | `wpn_gadfly_pulse_t1` Stachelpuls (2 × 3er): 6×8 / 1 s = **48,0 DPS**, RW 25, linear (Vorhalt) [air] | 0,960 (0,960) | ±0 % | 5,600 (5,600) | ±0 % | ±0 % | ±0 % / ±0 % |
| `air_t1_bomber` | `wpn_bluebottle_pods_t1` Brutkapseln (6er-Reihe): 6×50 / 5 s = **60,0 DPS**, RW 40, ballistisch (Abwurf), Splash 3 | 0,667 (0,667) | ±0 % | 2,222 (2,222) | ±0 % | ±0 % | +2,9 % / −6,5 % |
| `air_t2_gunship` | `wpn_bumblebee_lens_t2` Streulinse (3er-Puls): 3×20 / 1 s = **60,0 DPS**, RW 22, linear, Splash 3 | 0,222 (0,222) | ±0 % | 3,148 (3,082) | +2,2 % | +2,2 % | +4,2 % / −2,0 % |
| `air_t2_fbomber` | `wpn_mosquito_pulse_t2` Stechpuls (Luft): 2×40 / 1 s = **80,0 DPS**, RW 30, linear (Vorhalt) [air]<br>`wpn_mosquito_pods_t2` Brandkapseln (4er): 4×150 / 10 s = **60,0 DPS**, RW 40, ballistisch (Abwurf), Splash 2 | 0,333 (0,333) | ±0 % | 2,738 (2,619) | +4,5 % | +4,5 % | +3,1 % / +3,0 % |

**Kategorien, Besonderheiten, Post-MVP, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Post-MVP (Feature-ID) | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|---|
| `air_t1_scout` | AIR MOBILE SCOUT INTELLIGENCE TECH1<br>*von:* `FACTORY & AIR & (TECH1 \| TECH2)` | Death: `wpn_air_crash_s` 10/r1 (Absturzschaden (K12))<br>Unbewaffnet, schneller als Varkans Lerche (19 statt 18), größere Sicht. | – | Kleinster Flieger, ein Flügelpaar, zwei Fühler nach vorn; keine Waffen-Parts.<br>carapace [team], wing [team], antenna(fuehler l), antenna(fuehler r) — 4 Parts, 0 anim., ≈ 68 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | U11 Luftwaffe in MS12 |
| `air_t1_fighter` | AIR MOBILE ANTIAIR TECH1<br>*von:* `FACTORY & AIR & (TECH1 \| TECH2)` | Death: `wpn_air_crash_s` 25/r1 (Absturzschaden (K12))<br>Nur Luftziele. Zwei Stachelpuls-Werfer à 3 × 8 (Vorbild-Referenz hat zwei identische Waffen; spooky 3810 zählte nur eine, korrigiert im fraktionsübergreifenden Abgleich, factions/README.md §5.4). | – | Zwei schmale, stark gepfeilte Flügelpaare (X-Grundriss, lang > breit).<br>carapace, wing(vorderes paar) [team], wing(hinteres paar) [team] — 3 Parts, 0 anim., ≈ 48 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | U11 in MS12 |
| `air_t1_bomber` | AIR MOBILE BOMBER TECH1<br>*von:* `FACTORY & AIR & (TECH1 \| TECH2)` | Death: `wpn_air_crash_m` 100/r1 (Absturzschaden (K12))<br>Mehr, kleinere Kapseln als Varkans Dohle, zerbrechlicher.<br>wpn_bluebottle_pods_t1: DPS = Salve/Nachladezeit (pro Anflug). | – | Dicker Hinterleib (≥ 1,4 × Flügeltiefe, ragt hinten über) mit kurzen, breiten, geraden Flügeln (T-Form von oben).<br>abdomen(hinterleib) [team], wing(breitfluegel) [team], wing(stummel) — 3 Parts, 0 anim., ≈ 60 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | U11 in MS12 (Bomber-FSM) |
| `air_t2_gunship` | AIR MOBILE GUNSHIP DIRECTFIRE TECH2<br>*von:* `FACTORY & AIR & TECH2` | Death: `wpn_air_crash_m` 100/r1 (Absturzschaden (K12))<br>Schwebt im Orbit um das Ziel. Kleiner Splash (Vorbild-Relation). Kein Transport (U13 Post-MVP). | – | Keine Flügel: Schwirrscheibe (opak, dunkel gestreift) über dem Rumpf, Granatlinse unten.<br>buzzdisc ⟳yaw [team], carapace [team], lens(bauchlinse) ⟳yaw [sinew] — 3 Parts, 2 anim., ≈ 46 Tris · Maßstab 1,3 · 2 Streifen (quarzweiß) | U11 in MS12 (Orbit) |
| `air_t2_fbomber` | AIR MOBILE BOMBER ANTIAIR TECH2<br>*von:* `FACTORY & AIR & TECH2` | Death: `wpn_air_crash_l` 200/r1 (Absturzschaden (K12))<br>Beide Waffen addiert im DPS-Vergleich (wie FA-Referenz). Mehr Luftkampf, weniger Bombe als Varkans Elster. | – | Gepfeiltes Flügelpaar mit zwei Kapseln an den Flügelspitzen, schlanker Keilrumpf (`carapace`, kein Hinterleib: der bleibt Bomber-Monopol), Spannweite +30 % ggü. Bremse.<br>carapace(schlanker rumpf), wing(pfeilfluegel) [team], pod(kapsel l), pod(kapsel r) — 4 Parts, 0 anim., ≈ 76 Tris · Maßstab 1,3 · 2 Streifen (quarzweiß) | U11 in MS12 |

---

## 9. Wirtschaft

**Stammdaten**

| | ID | DE / EN | Rolle | Referenz (dev-only) | MS | Mass / Energy / BT | HP (Regen) | Footprint | Sicht / R | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f2:str_t1_mex` | **Egel I** / Leech I | Massebohrung / Mass Extractor | T1 Mass Extractor (`URB1103`, Gegenprobe `UEB1103`) | MS4 | 36 / 360 / 60 | 375 (+2/s) | 2×2 | – | Bau: Q | `struct_mass_t1` |
| ● | `f2:str_t2_mex` | **Egel II** / Leech II | Massebohrung / Mass Extractor | T2 Mass Extractor (Upgrade-Kosten) (`URB1202`, Gegenprobe `UEB1202`) | MS8 | 900 / 5.400 / 900 | 1.880 (+6/s) | 2×2 | 20 | Bau: Q (Upgrade: Command Card) | `struct_mass_t2` |
| ○ | `f2:str_t3_mex` | **Egel III** / Leech III | Massebohrung / Mass Extractor | T3 Mass Extractor (Upgrade-Kosten) (`URB1302`, Gegenprobe `UEB1302`) | MS13 | 4.500 / 31.000 / 2.900 | 6.500 (+20/s) | 2×2 | 20 | Bau: Q (Upgrade: Command Card) | `struct_mass_t3` |
| ● | `f2:str_t1_pgen` | **Druse I** / Geode I | Kraftwerk / Power Generator | T1 Power Generator (`URB1101`, Gegenprobe `UEB1101`) | MS4 | 75 / 750 / 125 | 520 (+2/s) | 2×2 | – | Bau: W | `struct_energy_t1` |
| ● | `f2:str_t2_pgen` | **Druse II** / Geode II | Kraftwerk / Power Generator | T2 Power Generator (`URB1201`, Gegenprobe `UEB1201`) | MS8 | 1.200 / 12.000 / 2.200 | 2.290 (+6/s) | 6×6 | 20 | Bau: W | `struct_energy_t2` |
| ○ | `f2:str_t3_pgen` | **Druse III** / Geode III | Kraftwerk / Power Generator | T3 Power Generator (`URB1301`, Gegenprobe `UEB1301`) | MS13 | 3.200 / 57.000 / 6.800 | 6.250 (+20/s) | 8×8 | 20 | Bau: W | `struct_energy_t3` |
| ● | `f2:str_t1_hydro` | **Fumarole** / Fumarole | Dampfkraftwerk / Geothermal Plant | T1 Hydro Power Plant (Spot-Kraftwerk) (`URB1102`, Gegenprobe `UEB1102`) | MS10 | 160 / 800 / 400 | 1.450 (+5/s) | 6×6 | – | Bau: E | `struct_hydro_t1` |
| ● | `f2:str_t1_mstore` | **Wabe** / Honeycomb | Massespeicher / Mass Storage | T1 Mass Storage (`URB1106`, Gegenprobe `UEB1106`) | MS10 | 200 / 1.500 / 250 | 625 (+3/s) | 2×2 | – | Bau: R | `struct_mstore_t1` |
| ● | `f2:str_t1_estore` | **Glimmzelle** / Glow Cell | Energiespeicher / Energy Storage | T1 Energy Storage (`URB1105`, Gegenprobe `UEB1105`) | MS6 | 250 / 1.200 / 200 | 520 | 2×2 | – | Bau: T | `struct_estore_t1` |

**Waffen und Balance** (Δ gegen Vorbild-Referenz; ΔV = Relation zu Varkan gegen FA-Relation)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt | ΔV DPS / HP |
|---|---|---|---|---|---|---|---|
| `str_t1_mex` | – | – (–) | – | 10,417 (10,000) | +4,2 % | – | – / +4,2 % |
| `str_t2_mex` | – | – (–) | – | 2,089 (2,000) | +4,4 % | – | – / −0,5 % |
| `str_t3_mex` | – | – (–) | – | 1,444 (1,359) | +6,3 % | – | – / +4,0 % |
| `str_t1_pgen` | – | – (–) | – | 6,933 (6,667) | +4,0 % | – | – / +0,6 % |
| `str_t2_pgen` | – | – (–) | – | 1,908 (1,833) | +4,1 % | – | – / +0,1 % |
| `str_t3_pgen` | – | – (–) | – | 1,953 (1,852) | +5,5 % | – | – / +4,2 % |
| `str_t1_hydro` | – | – (–) | – | 9,062 (8,750) | +3,6 % | – | – / +3,6 % |
| `str_t1_mstore` | – | – (–) | – | 3,125 (3,000) | +4,2 % | – | – / −2,0 % |
| `str_t1_estore` | – | – (–) | – | 2,080 (2,000) | +4,0 % | – | – / ±0 % |

**Kategorien, Besonderheiten, Post-MVP, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Post-MVP (Feature-ID) | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|---|
| `str_t1_mex` | STRUCTURE ECONOMIC MASSEXTRACTION TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | BP 10 · +2 M/s · −2 E/s Unterhalt<br>Upgrade → Egel II<br>Adjacency: Gibt Fabriken −7,5 % Mass-Verbrauch (8×8); erhält +12,5 % je angrenzender Wabe (FA-Relation, wie Varkan).<br>Nur auf Mass-Spots; produziert während des Upgrades weiter (B4). 11 % weniger HP als Zapfstelle I, dafür 2 HP/s Regeneration. | – | Netzring um den Spot, zentrale Druse mit Glutkern (Saug-Puls-Animation), niedrig.<br>crust, webring(kranz) [team], druse(herzdruse) ⟳tilt [glow] — 3 Parts, 1 anim., ≈ 110 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | E5 in MS4 |
| `str_t2_mex` | STRUCTURE ECONOMIC MASSEXTRACTION TECH2 SIZE4<br>*von:* `ENGINEER & (TECH2 \| TECH3) \| UPGRADE` | BP 15 · +6 M/s · −9 E/s Unterhalt<br>Upgrade → Egel III<br>Adjacency: Fabriken −10 % Mass-Verbrauch; +12,5 % je Wabe.<br>Kosten = Upgrade-Kosten (FA-Semantik). Auch direkt von Stopfer/Weber baubar. | – | Egel auf 2×2 (Höhe × 1,2) mit Seitenplatten, 2 Tech-Streifen.<br>crust, webring(kranz) [team], druse(herzdruse) ⟳tilt [glow], carapace(seitenplatten) — 4 Parts, 1 anim., ≈ 134 Tris · Maßstab 1/1,2 · 2 Streifen (quarzweiß) | B4 (T1→T2) in MS8 |
| `str_t3_mex` | STRUCTURE ECONOMIC MASSEXTRACTION TECH3 SIZE4<br>*von:* `ENGINEER & TECH3 \| UPGRADE` | +18 M/s · −54 E/s Unterhalt<br>Adjacency: Fabriken −12,5 % Mass-Verbrauch; +12,5 % je Wabe.<br>Upgrade-Kosten. | – | Egel auf 2×2 (Höhe × 1,4), doppelter Netzring, 3 Tech-Streifen; nur eine Druse (unterscheidet sich so von der Fumarole).<br>crust, webring(kranz) [team], webring(zweiter ring), druse(herzdruse) ⟳tilt [glow], carapace(seitenplatten) — 5 Parts, 1 anim., ≈ 158 Tris · Maßstab 1/1,4 · 3 Streifen (quarzweiß) | Rest B4 (T3-Mex) in MS13 |
| `str_t1_pgen` | STRUCTURE ECONOMIC ENERGYPRODUCTION TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | +20 E/s<br>Adjacency: Fabriken (8×8) −1,56 % Energy-Verbrauch, 2×2-Verbraucher −6,25 %; erhält +25 % je angrenzender Glimmzelle (SIZE4).<br>Death: `wpn_geode_burst_t1` 250/r2 (K14, Kettenreaktion-Golden MS10)<br>Frei platzierbar; kein Upgrade (T2/T3 werden neu gebaut, wie FA). | – | Kristallcluster auf Kruste, 1 Druse (Zahl = Tech, Höhe ≥ 1,5 × Krustenhöhe); kein Ring.<br>crust [team], druse(druse) [glow] — 2 Parts, 0 anim., ≈ 86 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | E6 in MS4 |
| `str_t2_pgen` | STRUCTURE ECONOMIC ENERGYPRODUCTION TECH2 SIZE12<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | +500 E/s<br>Adjacency: Fabriken −12,5 % Energy-Verbrauch; erhält +8,3 % je angrenzender Glimmzelle (SIZE12).<br>Death: `wpn_geode_burst_t2` 1.500/r5 (K14)<br>— | – | Kruste auf 6×6 (Maßstab 3,0, Höhe × 1,2) mit 2 Drusen, 2 Tech-Streifen; füllt ≥ 70 % der Footprint-Kante.<br>crust [team], druse [glow], druse [glow], carapace(seitenplatten) — 4 Parts, 0 anim., ≈ 164 Tris · Maßstab 3/3,6 · 2 Streifen (quarzweiß) | E6-Tech-Leiter mit T2-Engineer (MS8); KI-Tech bis T2 in MS9 |
| `str_t3_pgen` | STRUCTURE ECONOMIC ENERGYPRODUCTION TECH3 SIZE16<br>*von:* `ENGINEER & TECH3` | +2.500 E/s<br>Adjacency: Fabriken −15,6 % Energy-Verbrauch; erhält +6,25 % je angrenzender Glimmzelle (SIZE16).<br>Death: `wpn_geode_burst_t3` 5.500/r10 (K14; FA-Relation 1:1)<br>— | – | Kruste auf 8×8 (Maßstab 4,0, Höhe × 1,4) mit 3 Drusen, 3 Tech-Streifen.<br>crust [team], druse [glow], druse [glow], druse [glow], carapace(seitenplatten l), carapace(seitenplatten r) — 6 Parts, 0 anim., ≈ 242 Tris · Maßstab 4/5,6 · 3 Streifen (quarzweiß) | T3-Pgen-Nachlieferung in MS13 |
| `str_t1_hydro` | STRUCTURE ECONOMIC ENERGYPRODUCTION HYDROCARBON TECH1 SIZE12<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | +100 E/s<br>Adjacency: Wie Druse II (Fabriken −12,5 % Energy); erhält +8,3 % je angrenzender Glimmzelle (SIZE12).<br>Nur auf Hydro-Spots; keine Death-Weapon (wie FA). | – | Offener Netzring mit drei Drusen darin und Dampfsäule (Partikel, nur View).<br>crust, webring(offener ring) [team], druse [glow], druse [glow], druse [glow] — 5 Parts, 0 anim., ≈ 218 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | E9 in MS10; als Daten-Vorgriff im MS9-Kern (nur Spot-Regel wie E5) |
| `str_t1_mstore` | STRUCTURE ECONOMIC MASSSTORAGE TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | Speicher 500 M<br>Adjacency: +12,5 % Produktion je angrenzendem Egel (FA-Relation, max. 4 Seiten = +50 %).<br>Keine Death-Weapon. | – | Niedriger eckiger Stapel aus Panzerplatten (Mass = eckig), keine Druse, keine Spule.<br>crust, carapace(stapel) [team], carapace(stapel) — 3 Parts, 0 anim., ≈ 80 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | E10 in MS10; Daten-Vorgriff im MS9-Kern (E4-Speicherlimit existiert ab MS4) |
| `str_t1_estore` | STRUCTURE ECONOMIC ENERGYSTORAGE TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | Speicher 10.000 E<br>Adjacency: Bufft angrenzende Energieproduzenten (FA-Relation): Druse I +25 % (SIZE4), Druse II und Fumarole +8,3 % (SIZE12), Druse III +6,25 % (SIZE16).<br>Death: `wpn_glowcell_burst` 1.000/r5 (K14)<br>Keine Regeneration (Vorbild-Relation). | – | Zwei flache Sechseckzellen mit Deckelglimmen (Nervennaht, kein Herzkern); keine Druse, keine Spule.<br>crust, crust(zelle 1) [team], crust(zelle 2) [team] — 3 Parts, 0 anim., ≈ 96 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | Überschlag (U8, MS6) feuert erst ab 7500 E Vorrat (> Grundspeicher 3900 E) ⇒ Daten-Vorgriff ab MS6; E10-Abnahme MS10 |

---

## 10. Fabriken (Nester)

**Stammdaten**

| | ID | DE / EN | Rolle | Referenz (dev-only) | MS | Mass / Energy / BT | HP (Regen) | Footprint | Sicht / R | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f2:str_t1_fac_land` | **Landnest I** / Land Nest I | Landfabrik / Land Factory | T1 Land Factory (`URB0101`, Gegenprobe `UEB0101`) | MS6 | 240 / 2.100 / 300 | 2.860 (+9/s) | 8×8 | 20 | Bau: A | `struct_fac_land_t1` |
| ● | `f2:str_t2_fac_land` | **Landnest II** / Land Nest II | Landfabrik / Land Factory | T2 Land Factory HQ (Upgrade-Kosten) (`URB0201`, Gegenprobe `UEB0201`) | MS8 | 1.400 / 11.000 / 2.300 | 5.700 (+20/s) | 8×8 | 20 | Bau: Upgrade (Command Card) | `struct_fac_land_t2` |
| ○ | `f2:str_t3_fac_land` | **Landnest III** / Land Nest III | Landfabrik / Land Factory | T3 Land Factory HQ (Upgrade-Kosten) (`URB0301`, Gegenprobe `UEB0301`) | MS13 | 5.200 / 47.000 / 12.000 | 11.450 (+40/s) | 8×8 | 20 | Bau: Upgrade (Command Card) | `struct_fac_land_t3` |
| ○ | `f2:str_t1_fac_air` | **Luftnest I** / Air Nest I | Luftfabrik / Air Factory | T1 Air Factory (`URB0102`, Gegenprobe `UEB0102`) | MS12 | 210 / 2.400 / 300 | 2.860 (+9/s) | 8×8 | 20 | Bau: S | `struct_fac_air_t1` |
| ○ | `f2:str_t2_fac_air` | **Luftnest II** / Air Nest II | Luftfabrik / Air Factory | T2 Air Factory HQ (Upgrade-Kosten) (`URB0202`, Gegenprobe `UEB0202`) | MS12 | 920 / 17.500 / 2.300 | 5.700 (+20/s) | 8×8 | 20 | Bau: Upgrade (Command Card) | `struct_fac_air_t2` |

**Waffen und Balance** (Δ gegen Vorbild-Referenz; ΔV = Relation zu Varkan gegen FA-Relation)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt | ΔV DPS / HP |
|---|---|---|---|---|---|---|---|
| `str_t1_fac_land` | – | – (–) | – | 11,917 (11,458) | +4,0 % | – | – / −1,0 % |
| `str_t2_fac_land` | – | – (–) | – | 4,071 (3,901) | +4,4 % | – | – / +1,1 % |
| `str_t3_fac_land` | – | – (–) | – | 2,202 (2,107) | +4,5 % | – | – / +4,1 % |
| `str_t1_fac_air` | – | – (–) | – | 13,619 (13,095) | +4,0 % | – | – / −1,0 % |
| `str_t2_fac_air` | – | – (–) | – | 6,196 (5,978) | +3,6 % | – | – / +1,1 % |

**Kategorien, Besonderheiten, Post-MVP, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Post-MVP (Feature-ID) | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|---|
| `str_t1_fac_land` | STRUCTURE FACTORY LAND TECH1 SIZE16<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | BP 20 · Speicher 80 M<br>Upgrade → Landnest II<br>Adjacency: Empfängt Adjacency von Egeln (Mass) und Drusen (Energy).<br>Queue/Repeat/Rally (B3). Upgrade-Verb „Ausreifen“. 32 % weniger HP als Landwerk I, dafür 9 HP/s Regeneration. | – | Nestmaul (V-Portal, offene Spitze = Ausgang) mit Rampe auf gezackter Kruste; Nestkern glüht.<br>crust [team], gate(nestmaul) [team], carapace(rampe), druse(nestkern) [glow] — 4 Parts, 0 anim., ≈ 134 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | B3 in MS6 |
| `str_t2_fac_land` | STRUCTURE FACTORY LAND TECH2 SIZE16<br>*von:* `UPGRADE` | BP 40 · Speicher 160 M<br>Upgrade → Landnest III<br>Adjacency: Empfängt Adjacency von Egeln (Mass) und Drusen (Energy).<br>Nur per Upgrade (kein HQ/Support-System, B9 Post-MVP). | – | Landnest × 1,3 mit Brutspule, 2 Tech-Streifen.<br>crust [team], gate(nestmaul) [team], carapace(rampe), druse(nestkern) [glow], spool(brutspule) [team] — 5 Parts, 0 anim., ≈ 194 Tris · Maßstab 1/1,2 · 2 Streifen (quarzweiß) | U5 in MS8 |
| `str_t3_fac_land` | STRUCTURE FACTORY LAND TECH3 SIZE16<br>*von:* `UPGRADE` | BP 90 · Speicher 320 M<br>Adjacency: Empfängt Adjacency von Egeln (Mass) und Drusen (Energy).<br>Nur per Upgrade. | – | Landnest × 1,7 mit zweitem Nestkern und Seitenplatten, 3 Tech-Streifen.<br>crust [team], gate(nestmaul) [team], carapace(rampe), druse(nestkern) [glow], druse(zweiter kern) [glow], spool(brutspule) [team], carapace(seitenplatten) — 7 Parts, 0 anim., ≈ 272 Tris · Maßstab 1/1,4 · 3 Streifen (quarzweiß) | U5 T3 / U10 in MS13 |
| `str_t1_fac_air` | STRUCTURE FACTORY AIR TECH1 SIZE16<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | BP 20 · Speicher 80 M<br>Upgrade → Luftnest II<br>Adjacency: Empfängt Adjacency von Egeln (Mass) und Drusen (Energy).<br>Baut keine Engineers (wie FA). | – | Nestmaul mit flachem Landenetz (Netzring) statt Rampe.<br>crust [team], gate(nestmaul) [team], webring(landenetz), druse(nestkern) [glow] — 4 Parts, 0 anim., ≈ 134 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | Luftfabrik T1→T2 in MS12 |
| `str_t2_fac_air` | STRUCTURE FACTORY AIR TECH2 SIZE16<br>*von:* `UPGRADE` | BP 40 · Speicher 160 M<br>Adjacency: Empfängt Adjacency von Egeln (Mass) und Drusen (Energy).<br>Nur per Upgrade; kein T3-Luftnest (U12 Post-MVP). | – | Luftnest × 1,3 mit Brutspule, 2 Tech-Streifen.<br>crust [team], gate(nestmaul) [team], webring(landenetz), druse(nestkern) [glow], spool(brutspule) [team] — 5 Parts, 0 anim., ≈ 194 Tris · Maßstab 1/1,2 · 2 Streifen (quarzweiß) | MS12 |

---

## 11. Verteidigung

**Stammdaten**

| | ID | DE / EN | Rolle | Referenz (dev-only) | MS | Mass / Energy / BT | HP (Regen) | Footprint | Sicht / R | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ● | `f2:str_t1_pd` | **Falle I** / Snare I | Punktverteidigung / Point Defense | T1 Point Defense (`URB2101`, Gegenprobe `UEB2101`) | MS8 | 250 / 2.000 / 250 | 1.350 | 1×1 | 24 | Bau: Z | `struct_direct_t1` |
| ● | `f2:str_t2_pd` | **Falle II** / Snare II | Punktverteidigung / Point Defense | T2 Point Defense (`URB2301`, Gegenprobe `UEB2301`) | MS8 | 480 / 3.300 / 600 | 2.000 | 2×2 | 28 | Bau: Z | `struct_direct_t2` |
| ● | `f2:str_t1_aa` | **Schlehe I** / Sloe I | Flugabwehrturm / AA Tower | T1 Anti-Air Turret (`URB2104`, Gegenprobe `UEB2104`) | MS8 | 150 / 1.500 / 190 | 830 | 1×1 | 24 | Bau: X | `struct_aa_t1` |
| ● | `f2:str_t2_aa` | **Schlehe II** / Sloe II | Flakturm / Flak Tower | T2 Anti-Air Flak Artillery (`URB2204`, Gegenprobe `UEB2204`) | MS8 | 400 / 4.000 / 540 | 2.480 | 2×2 | 24 | Bau: X | `struct_aa_t2` |
| ● | `f2:str_t3_sam` | **Igel** / Hedgehog | Raketenabwehr / SAM Site | T3 Anti-Air SAM Launcher (`URB2304`, Gegenprobe `UEB2304`) | MS8 | 800 / 8.000 / 1.400 | 5.200 | 2×2 | 28 | Bau: X | `struct_sam_t3` |
| ● | `f2:str_t1_wall` | **Hecke** / Hedge | Mauer / Wall | Wall Section (`URB5101`, Gegenprobe `UEB5101`) | MS8 | 3 / 20 / 15 | 540 | 1×1 | 0 | Bau: C | `wall` |

**Waffen und Balance** (Δ gegen Vorbild-Referenz; ΔV = Relation zu Varkan gegen FA-Relation)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt | ΔV DPS / HP |
|---|---|---|---|---|---|---|---|
| `str_t1_pd` | `wpn_trap_lens_t1` Pulslinse (Stellung): 50 / 0,3 s = **166,7 DPS**, RW 26, linear | 0,667 (0,667) | ±0 % | 5,400 (5,200) | +3,8 % | +3,8 % | −4,0 % / −4,0 % |
| `str_t2_pd` | `wpn_trap_lens_t2` Dreifach-Pulslinse: 3×10 / 0,3 s = **100,0 DPS**, RW 50, linear (schnell) | 0,208 (0,208) | ±0 % | 4,167 (4,167) | ±0 % | ±0 % | +1,1 % / −9,7 % |
| `str_t1_aa` | `wpn_spine_aa_t1` Dornensalve: 2×14 / 0,4 s = **70,0 DPS**, RW 44, linear (Vorhalt) [air] | 0,467 (0,467) | ±0 % | 5,533 (5,333) | +3,8 % | +3,8 % | −1,4 % / +1,2 % |
| `str_t2_aa` | `wpn_spine_flak_t2` Splitterdornen (Flak): 2×38 / 0,5 s = **152,0 DPS**, RW 44, linear + Näherungszünder (MS12), Splash 5 [air] | 0,380 (0,380) | ±0 % | 6,200 (5,950) | +4,2 % | +4,2 % | −0,8 % / +3,8 % |
| `str_t3_sam` | `wpn_hedgehog_sam_t3` Saftraketen-Flugabwehr: 4×300 / 3,5 s = **342,9 DPS**, RW 60, homing + Näherungszünder, Splash 1,5 [air] | 0,429 (0,429) | ±0 % | 6,500 (6,250) | +4,0 % | +4,0 % | ±0 % / +4,0 % |
| `str_t1_wall` | – | – (–) | – | 180,000 (166,667) | +8,0 % | – | – / −1,8 % |

**Kategorien, Besonderheiten, Post-MVP, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Post-MVP (Feature-ID) | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|---|
| `str_t1_pd` | STRUCTURE DEFENSE DIRECTFIRE TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | Dieselbe Linse wie die Zecke unter einer schrägen Falltür-Platte. | – | Gezackte Kruste, schräge Falltür-Platte (teamfarben), darunter waagerechte Granatlinse.<br>crust, carapace(falltuer) ⟳yaw [team], lens ⟳pitch [sinew] — 3 Parts, 2 anim., ≈ 64 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | B5 in MS8; Minimal-A8 der KI in MS9 |
| `str_t2_pd` | STRUCTURE DEFENSE DIRECTFIRE TECH2 SIZE4<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | Große Reichweite, kein Splash (Vorbild-Relation). Kein Upgrade von Falle I (wie FA). | – | Falle × 1,3 mit drei Linsen unter der Falltür, 2 Tech-Streifen.<br>crust, carapace(falltuer) ⟳yaw [team], lens [sinew], lens [sinew], lens [sinew] — 5 Parts, 1 anim., ≈ 80 Tris · Maßstab 2/2,4 · 2 Streifen (quarzweiß) | B5 (T2) in MS8 |
| `str_t1_aa` | STRUCTURE DEFENSE ANTIAIR TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | Nur Luftziele. | – | Kruste mit Dornenkamm aus 2 senkrechten Dornen.<br>crust [team], neck(kammsockel) ⟳yaw, spike, spike — 4 Parts, 1 anim., ≈ 60 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | B5 in MS8, Wirkung MS12 |
| `str_t2_aa` | STRUCTURE DEFENSE ANTIAIR TECH2 SIZE4<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | Nur Luftziele. | – | Schlehe × 1,3 mit 3 Dornen und Seitenplatten, 2 Tech-Streifen.<br>crust [team], neck(kammsockel) ⟳yaw, spike, spike, spike, carapace(seitenplatten) — 6 Parts, 1 anim., ≈ 92 Tris · Maßstab 2/2,4 · 2 Streifen (quarzweiß) | B5 (T2) in MS8, Näherungszünder MS12 |
| `str_t3_sam` | STRUCTURE DEFENSE ANTIAIR TECH3 SIZE4<br>*von:* `ENGINEER & TECH3` | Nur Luftziele. | – | Kruste auf 2×2 mit doppelt so vielen, dickeren Dornen im Halbkreis (4), 3 Tech-Streifen.<br>crust [team], neck(kammsockel) ⟳yaw, spike, spike, spike, spike — 6 Parts, 1 anim., ≈ 76 Tris · Maßstab 2/2,8 · 3 Streifen (quarzweiß) | MS8 per Konsole/Test-Szenario gespawnt (B5: homing, K11), baubar ab MS13 (Weber) |
| `str_t1_wall` | STRUCTURE DEFENSE WALL TECH1<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | wall-Flag (Drag-Linie), blockiert Schüsse und Pathing. | – | Niedriger Krustenblock mit kurzen Dornen (≤ 0,3 × Blockhöhe, keine AA-Lesart), nur die Spitzen-Kappen teamfarben (≈ 10 %).<br>crust, spike(dornenkappen) [team] — 2 Parts, 0 anim., ≈ 40 Tris · Maßstab 1 · keine Streifen | B5/Minimal-Drag (DECISIONS 3) in MS8 |

---

## 12. Intel und Schilde

**Stammdaten**

| | ID | DE / EN | Rolle | Referenz (dev-only) | MS | Mass / Energy / BT | HP (Regen) | Footprint | Sicht / R | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ○ | `f2:str_t1_radar` | **Fühler I** / Feeler I | Radar / Radar | T1 Radar System (`URB3101`, Gegenprobe `UEB3101`) | MS10 | 80 / 720 / 80 | 11 | 2×2 | 20 / R 116 | Bau: D | `struct_intel_t1` |
| ○ | `f2:str_t2_radar` | **Fühler II** / Feeler II | Radar / Radar | T2 Radar System (Upgrade-Kosten) (`URB3201`, Gegenprobe `UEB3201`) | MS10 | 180 / 3.600 / 780 | 55 | 2×2 | 24 / R 200 | Bau: Upgrade (Command Card) | `struct_intel_t2` |
| ○ | `f2:str_t3_radar` | **Fühler III** / Feeler III | Radar / Radar | T3 Omni Sensor Array (Upgrade-Kosten; hier ohne Omni) (`URB3104`, Gegenprobe `UEB3104`) | MS13 | 1.200 / 15.000 / 1.200 | 55 | 2×2 | 30 / R 350 | Bau: Upgrade (Command Card) | `struct_intel_t3` |
| ○ | `f2:str_t2_shield` | **Kokon II** / Cocoon II | Schildgenerator / Shield Generator | T2 Shield Generator (Stufe 1 der Schildkette) (`URB4202`, Gegenprobe `UEB4202`) | MS13 | 160 / 2.000 / 700 | 450 + Schild 3.500 | 6×6 | 20 | Bau: F | `struct_shield_t2` |
| ○ | `f2:str_t3_shield` | **Kokon III** / Cocoon III | Schildgenerator / Shield Generator | T3 Shield Generator (erste T3-Stufe der Schildkette, Upgrade-Kosten) (`URB4206`, Gegenprobe `UEB4301`) | MS13 | 2.600 / 42.000 / 3.600 | 500 + Schild 12.000 | 6×6 | 20 | Bau: Upgrade (Command Card) | `struct_shield_t3` |

**Waffen und Balance** (Δ gegen Vorbild-Referenz; ΔV = Relation zu Varkan gegen FA-Relation)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt | ΔV DPS / HP |
|---|---|---|---|---|---|---|---|
| `str_t1_radar` | – | – (–) | – | 0,138 (0,125) | +10,0 % | – | – / ±0 % |
| `str_t2_radar` | – | – (–) | – | 0,306 (0,278) | +10,0 % | – | – / ±0 % |
| `str_t3_radar` | – | – (–) | – | 0,046 (0,042) | +10,0 % | – | – / +0,2 % |
| `str_t2_shield` | – | – (–) | – | 24,688 (28,125) | −12,2 % | – | – / −12,5 % |
| `str_t3_shield` | – | – (–) | – | 4,808 (5,488) | −12,4 % | – | – / −15,1 % |

**Kategorien, Besonderheiten, Post-MVP, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Post-MVP (Feature-ID) | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|---|
| `str_t1_radar` | STRUCTURE INTELLIGENCE RADAR TECH1 SIZE4<br>*von:* `(ENGINEER & (TECH1 \| TECH2 \| TECH3)) \| COMMAND` | BP 13 · −20 E/s Unterhalt<br>Toggles: radar (MS10, C17)<br>Upgrade → Fühler II<br>Stall schaltet ab (E3). Extrem fragil (FA-Relation). | – | Zwei hohe, geknickte Fühler als V (35° gespreizt); kein Ring.<br>crust [team], antenna(fuehler l), antenna(fuehler r) — 3 Parts, 0 anim., ≈ 64 Tris · Maßstab 1 · 1 Streifen (quarzweiß) | I3 in MS10 |
| `str_t2_radar` | STRUCTURE INTELLIGENCE RADAR TECH2 SIZE4<br>*von:* `UPGRADE` | BP 20 · −150 E/s Unterhalt<br>Toggles: radar (MS10, C17)<br>Upgrade → Fühler III<br>Nur per Upgrade. | – | Fühler auf 2×2 (Höhe × 1,2) mit Seitenplatten, 2 Tech-Streifen.<br>crust [team], antenna(fuehler l), antenna(fuehler r), carapace(seitenplatten) — 4 Parts, 0 anim., ≈ 88 Tris · Maßstab 1/1,2 · 2 Streifen (quarzweiß) | I3 T1→T2 in MS10 |
| `str_t3_radar` | STRUCTURE INTELLIGENCE RADAR TECH3 SIZE4<br>*von:* `UPGRADE` | −400 E/s Unterhalt<br>Toggles: radar (MS10, C17)<br>Kein Omni (I4 Post-MVP) ⇒ Kosten und Reichweite gegenüber FA halbiert, HP/Mass in Relation (wie Varkans Horcher III). | – | Fühler auf 2×2 (Höhe × 1,4) mit drittem, kurzem Fühler, 3 Tech-Streifen.<br>crust [team], antenna(fuehler l), antenna(fuehler r), antenna(kurzer fuehler), carapace(seitenplatten) — 5 Parts, 0 anim., ≈ 104 Tris · Maßstab 1/1,4 · 3 Streifen (quarzweiß) | Rest I3 (T3-Radar) in MS13 |
| `str_t2_shield` | STRUCTURE SHIELD DEFENSE TECH2 SIZE12<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | BP 20 · −100 E/s Unterhalt<br>Schild 3.500 HP, r18, +45/s nach 3 s, Neuaufbau 20 s, −100 E/s<br>Toggles: shield (MS13, C17)<br>Upgrade → Kokon III<br>Billig und schwach (160 statt 600 Mass, 3.500 statt 9.000 Schild-HP), am unteren Bandrand der Vorbild-Referenz. Kollaps + Wiederaufbau nach rechargeS; Stall schaltet ab. | – | Netzring waagerecht (Ø ≥ 0,8 × Footprint-Kante) auf Fühler-Dreibein; kein V.<br>crust, antenna(dreibein), antenna(dreibein), antenna(dreibein), webring(netzring) ⟳yaw [team] — 5 Parts, 1 anim., ≈ 104 Tris · Maßstab 1 · 2 Streifen (quarzweiß) | K10 in MS13 |
| `str_t3_shield` | STRUCTURE SHIELD DEFENSE TECH3 SIZE12<br>*von:* `UPGRADE` | −400 E/s Unterhalt<br>Schild 12.000 HP, r32, +125/s nach 1 s, Neuaufbau 25 s, −400 E/s<br>Toggles: shield (MS13, C17)<br>Nur per Upgrade. Die zwei T2-Zwischenstufen der Vorbild-Kette entfallen (ein Sprung II→III); Vergleich gegen die erste T3-Stufe. Gesamtkosten Kokon II+III = 2.760 Mass für 12.500 HP+Schild (4,53/Mass), Varkans Schirm II+III 3.800 Mass für 17.520 (4,61/Mass). | **B8**: Weitere In-Place-Stufen Kokon IV/V wie die Vorbild-Kette. | Kokon auf 6×6 (Höhe × 1,4/1,2) mit zweitem Netzring und Seitenplatten, 3 Tech-Streifen.<br>crust, antenna(dreibein), antenna(dreibein), antenna(dreibein), webring(netzring) ⟳yaw [team], webring(zweiter ring), carapace(seitenplatten) — 7 Parts, 1 anim., ≈ 152 Tris · Maßstab 1/1,17 · 3 Streifen (quarzweiß) | K10 in MS13 |

---

## 13. Artilleriestellungen

**Stammdaten**

| | ID | DE / EN | Rolle | Referenz (dev-only) | MS | Mass / Energy / BT | HP (Regen) | Footprint | Sicht / R | Hotbuild | Icon |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ○ | `f2:str_t2_arty` | **Schierling** / Hemlock | Artilleriestellung / Artillery Emplacement | T2 Artillery Installation (`URB2303`, Gegenprobe `UEB2303`) | MS13 | 1.680 / 12.000 / 1.600 | 3.280 | 2×2 | 28 | Bau: V | `struct_arty_t2` |
| ○ | `f2:str_t3_arty` | **Bilsenkraut** / Henbane | Schwere Artilleriestellung / Heavy Artillery Emplacement | T3 Heavy Artillery Installation (auf MVP-Kartengröße skaliert) (`URB2302`, Gegenprobe `UEB2302`) | MS13 | 46.000 / 870.000 / 70.000 | 7.280 | 8×8 | 28 | Bau: V | `struct_arty_t3` |

**Waffen und Balance** (Δ gegen Vorbild-Referenz; ΔV = Relation zu Varkan gegen FA-Relation)

| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt | ΔV DPS / HP |
|---|---|---|---|---|---|---|---|
| `str_t2_arty` | `wpn_hemlock_capsule_t2` Brandkapsel (Stellung): 1.750 / 20 s = **87,5 DPS**, RW 50–110, ballistisch, Splash 4 | 0,052 (0,052) | ±0 % | 1,952 (1,875) | +4,1 % | +4,1 % | −5,4 % / −1,4 % |
| `str_t3_arty` | `wpn_henbane_capsule_t3` Bilsenkapsel: 3.700 / 11,4 s = **324,6 DPS**, RW 60–200, ballistisch, Splash 9 | 0,007 (0,007) | +0,9 % | 0,158 (0,151) | +4,9 % | +5,8 % | +0,9 % / +4,9 % |

**Kategorien, Besonderheiten, Post-MVP, Kitbash**

| ID | Kategorien / buildableBy | Besonderheiten | Post-MVP (Feature-ID) | Kitbash (Parts) | MS-Hinweis |
|---|---|---|---|---|---|
| `str_t2_arty` | STRUCTURE DEFENSE INDIRECTFIRE ARTILLERY TECH2 SIZE4<br>*von:* `ENGINEER & (TECH2 \| TECH3)` | RW 110 wie Varkans Tiegel (FA 115). Artillerie-Adjacency optional mit E11. | – | Großer Schwanz auf Kruste, Kapsel schräg nach vorn (45–55°).<br>crust, neck(schwanzansatz) ⟳yaw, tail ⟳pitch [team], pod(kapsel) [sinew] — 4 Parts, 2 anim., ≈ 100 Tris · Maßstab 1 · 2 Streifen (quarzweiß) | K13 in MS13 |
| `str_t3_arty` | STRUCTURE DEFENSE INDIRECTFIRE ARTILLERY TECH3 SIZE16<br>*von:* `ENGINEER & TECH3` | FA-Referenz: RW 825, 69.600 Mass, 3.700 Schaden alle 7,6 s, Splash 9. Hier wie Varkans Hochofen skaliert: RW 200 (Kartenpool ≥ 354 WU), Kosten ≈ 66 %, gleicher Einzelschuss und Splash, Feuerrate × ⅔; DPS/Mass und HP/Mass in Relation. Kleinerer Einzelschuss, größerer Splash und schnellerer Takt als der Hochofen (Vorbild-Relation). | – | 8×8: doppelter Schwanz, Kapsel Ø 3,0 WU, Gegengewicht; 3 Tech-Streifen.<br>crust, neck(lafette) ⟳yaw, tail(schwanz) ⟳pitch [team], pod(kapsel) [sinew], tail(zweiter schwanz), carapace(gegengewicht) — 6 Parts, 2 anim., ≈ 160 Tris · Maßstab 4/4,67 · 3 Streifen (quarzweiß) | K13 + Reichweiten-Gate in MS13 |

---

## 14. Balance-Übersicht und Gates

- **DPS/Mass:** 24 Einträge, größte Abweichung +5,3 % (Langbein), Mittel +0,4 %. Gate ±15 % (hart ±25 %).
- **HP/Mass:** 50 Einträge, größte Abweichung −13,9 % (Gespinst), Mittel +3,1 %. Gate ±15 % (hart ±25 %).
- **Produkt DPS/Mass × HP/Mass:** 24 Einträge, größte Abweichung +6,7 % (Tarantel), Mittel +3,2 %. Gate ±15 % (hart ±25 %).
- **Parität zu Varkan:** Varkan liegt im Mittel bei +4,1 % HP/Mass und −0,8 % DPS/Mass gegenüber seiner Referenz, Skarn bei +3,1 % / +0,4 %. Die Relation Skarn/Varkan weicht damit im Mittel um −0,9 % (HP/Mass) und +1,3 % (DPS/Mass) von der FA-Relation der beiden Referenzfraktionen ab.
- **Bewusste Abweichungen (im Band):** Nessel +3,5 % DPS/Mass (Ersatz für K18-Lähmung), Tarantel +7 % HP/Mass (Ersatz für K16-Ablenker), Langbein zerbrechlicher und schneller feuernd (−8 % HP, +5 % DPS), Gespinst und Kokon am unteren Bandrand (−12 bis −14 %), Bilsenkraut maßstabsskaliert wie Varkans Hochofen (RW 200, Kosten ≈ 66 %, Feuerrate × ⅔).

### 14.1 Fraktions-Signatur gegenüber Varkan (Vorbild-Relation)

| Rolle | Skarn | Varkan | DPS/Mass Skarn ÷ Varkan | HP/Mass Skarn ÷ Varkan | Tempo | Kosten (Mass) |
|---|---|---|---|---|---|---|
| cmd_commander | Rädelsführer | Vogt | ±0 % | −16,7 % | 1,7 / 1,7 | 2.000 / 2.000 |
| lnd_t1_bot | Floh | Stichel | −22,8 % | +35,7 % | 4 / 4,3 | 35 / 30 |
| lnd_t1_tank | Zecke | Punze | +14,3 % | −6,7 % | 3,7 / 3,3 | 56 / 56 |
| lnd_t1_arty | Nessel | Kelle | +257,0 % | −33,3 % | 2,9 / 2,7 | 36 / 36 |
| lnd_t1_aa | Klette | Sieb | +78,6 % | −12,9 % | 2,9 / 3,3 | 55 / 55 |
| lnd_t2_tank | Ohrwurm | Meißel | +6,7 % | −14,7 % | 2,9 / 2,9 | 290 / 200 |
| lnd_t2_mml | Wolfsmilch | Rinne | +1,0 % | −6,4 % | 3 / 2,8 | 180 / 180 |
| lnd_t3_bot | Tarantel | Fallhammer | +43,3 % | +4,2 % | 3,8 / 3,3 | 480 / 500 |
| lnd_t3_arty | Stechapfel | Pfanne | −2,6 % | −12,0 % | 2,2 / 2,2 | 800 / 800 |
| air_t1_bomber | Brummer | Dohle | −11,8 % | −13,0 % | 10 / 10 | 90 / 90 |
| air_t2_gunship | Hummel | Krähe | −16,6 % | −17,2 % | 12 / 12 | 270 / 200 |
| str_t1_mex | Egel I | Zapfstelle I | – | −6,2 % | – | 36 / 36 |
| str_t1_fac_land | Landnest I | Landwerk I | – | −31,9 % | – | 240 / 240 |
| str_t1_pd | Falle I | Riegel I | −4,0 % | −4,0 % | – | 250 / 240 |
| str_t2_pd | Falle II | Riegel II | −13,3 % | −9,7 % | – | 480 / 520 |
| str_t2_shield | Kokon II | Schirm II | – | +59,6 % | – | 160 / 600 |

Die Spalten zeigen die Unterschiede, die die Fraktion ausmachen: Linie mit mehr Feuerkraft und weniger Panzerung, zäher Raider, harte, zerbrechliche Artillerie, zerbrechliche Basis mit Regeneration, billige Schilde mit wenig Schild-HP (pro Mass trotzdem effizient, wie die Vorbild-Relation). Die Werte sind gewollt groß: Sie sind die FA-Relation der beiden Referenzfraktionen. Wie genau Skarn und Varkan dieses Verhältnis treffen, zeigt die Spalte ΔV in §4–13 (Gate ±25 %, Mittel ≈ ±2 %).

### 14.2 Pulk-DPS/Mass (Artillerie, Gate ±15 %)

| Einheit | Schaden × Salve / Nachladezeit | Splash (FA) | Pulk-DPS/Mass (FA) | Δ Pulk | Δ Einzelziel |
|---|---|---|---|---|---|
| Nessel | 230 / 5,8 s | 2 (2) | 5,407 (5,227) | +3,4 % | +3,5 % |
| Wolfsmilch | 200 / 3,3 s | 1 (1) | 0,595 (0,595) | ±0 % | ±0 % |
| Stechapfel | 450 / 6,6 s | 6 (6) | 2,828 (2,828) | ±0 % | ±0 % |
| Schierling | 1.750 / 20 s | 4 (4) | 0,828 (0,828) | ±0 % | ±0 % |
| Bilsenkraut | 3.700 / 11,4 s | 9 (9) | 0,500 (0,496) | +0,9 % | +0,9 % |

### 14.3 Treffer-bis-Tod-Matrix (Pflicht: exakt Vorbild-FA)

| Angreifer → Ziel | Salvenschaden / Ziel-HP | Salven (Zeit) | FA: Salvenschaden / Ziel-HP | FA: Salven (Zeit) | ✓ |
|---|---|---|---|---|---|
| Rädelsführer → Floh | 100 / 95 | 1 (0 s) | 100 / 90 | 1 (0 s) | ✓ |
| Rädelsführer → Zecke | 100 / 280 | 3 (2 s) | 100 / 270 | 3 (2 s) | ✓ |
| Rädelsführer → Nessel | 100 / 140 | 2 (1 s) | 100 / 140 | 2 (1 s) | ✓ |
| Rädelsführer → Klette | 100 / 270 | 3 (2 s) | 100 / 260 | 3 (2 s) | ✓ |
| Rädelsführer → Flicker | 100 / 147 | 2 (1 s) | 100 / 145 | 2 (1 s) | ✓ |
| Rädelsführer → Schabe | 100 / 16 | 1 (0 s) | 100 / 15 | 1 (0 s) | ✓ |
| Falle I → Zecke | 50 / 280 | 6 (1,5 s) | 50 / 270 | 6 (1,5 s) | ✓ |
| Falle I → Floh | 50 / 95 | 2 (0,3 s) | 50 / 90 | 2 (0,3 s) | ✓ |
| Nessel → Floh | 230 / 95 | 1 (0 s) | 230 / 90 | 1 (0 s) | ✓ |
| Nessel → Flicker | 230 / 147 | 1 (0 s) | 230 / 145 | 1 (0 s) | ✓ |
| Nessel → Zecke | 230 / 280 | 2 (5,8 s) | 230 / 270 | 2 (6 s) | ✓ |
| Ohrwurm → Floh | 50 / 95 | 2 (0,6 s) | 50 / 90 | 2 (0,6 s) | ✓ |
| Ohrwurm → Zecke | 50 / 280 | 6 (3 s) | 50 / 270 | 6 (3 s) | ✓ |
| Wolfsmilch → Falle II | 200 / 2.000 | 10 (29,7 s) | 200 / 2.000 | 10 (29,7 s) | ✓ |
| Schierling → Egel II | 1.750 / 1.880 | 2 (20 s) | 1.750 / 1.800 | 2 (20 s) | ✓ |
| Schierling → Falle I | 1.750 / 1.350 | 1 (0 s) | 1.750 / 1.300 | 1 (0 s) | ✓ |
| Schierling → Druse II | 1.750 / 2.290 | 2 (20 s) | 1.750 / 2.200 | 2 (20 s) | ✓ |
| Schlehe I → Motte | 28 / 28 | 1 (0 s) | 28 / 26 | 1 (0 s) | ✓ |
| Igel → Hummel | 1.200 / 850 | 1 (0 s) | 1.200 / 832 | 1 (0 s) | ✓ |
| Igel → Stechmücke | 1.200 / 1.150 | 1 (0 s) | 1.200 / 1.100 | 1 (0 s) | ✓ |
| Zecke → Floh | 8 / 95 | 12 (3,3 s) | 8 / 90 | 12 (3,3 s) | ✓ |
| Floh → Flicker | 21 / 147 | 7 (6 s) | 21 / 145 | 7 (6 s) | ✓ |
| Klette → Motte | 16 / 28 | 2 (0,5 s) | 16 / 26 | 2 (0,5 s) | ✓ |

### 14.4 Kreuz-Check gegen Varkan (faction.md §9.2)

Salven bis zum Tod zwischen den Fraktionen müssen dieselben sein wie zwischen den beiden FA-Referenzfraktionen (Angreifer-Waffe der einen gegen Ziel-HP der anderen). **Pflichtpaare:**

| Angreifer → Ziel | Salvenschaden / Ziel-HP | Salven (Zeit) | FA-Paarung: Salven (Zeit) | Ergebnis |
|---|---|---|---|---|
| Zecke → Punze | 8 / 300 | 38 (11,1 s) | 38 (11,1 s) | ✓ exakt |
| Punze → Zecke | 28 / 280 | 10 (10,8 s) | 12 (11 s) | ✓ Ausnahme: Tötungszeit −1,8 %. Varkans Punze 28 statt 24 Schaden (Varkan-Entscheidung). Exakte Salvenzahl bräuchte Zecke-HP > 308 und bräche Kommandant→Zecke (3) und Kelle→Zecke (3). Geprüft wird die Tötungszeit. |
| Nessel → Punze | 230 / 300 | 2 (5,8 s) | 2 (6 s) | ✓ exakt |
| Kelle → Zecke | 100 / 280 | 3 (18 s) | 3 (16,6 s) | ✓ exakt |

**Info-Matrix:** 68 weitere Paare (Rädelsführer/Vogt, T1-Läufer/Bots, T1-Linie, T1-Artillerie, T2-Linie, T1-PD gegen die T1-Armee und die T2-Linie der anderen Fraktion, beide Richtungen). Breakpoints (≤ 10 FA-Salven) müssen exakt stimmen, größere Salvenzahlen innerhalb ±10 % Tötungszeit. 63 passen. 4 Abweichungen gehen auf bewusste **Varkan**-Abweichungen zurück (Punze 28 statt 24 Schaden, Lehrling 160 statt 150 HP; der Stichel ist seit dem fraktionsübergreifenden Abgleich FA-gleich 60 HP / 30 Mass). 1 geht auf Skarn zurück: Kelle → Ohrwurm braucht nach der HP-Verschiebung des Ohrwurms (§19 R2) 20 statt 19 Salven. Das ist kein Breakpoint; von den +14,5 % Tötungszeit stammen +8,4 % aus Varkans langsamerer Kelle (9,0 statt 8,3 s). Der Validator erzwingt, dass Skarn keinen Kreuz-Breakpoint bricht:

| Angreifer → Ziel | Salven | FA-Paarung | Tötungszeit | Ursache |
|---|---|---|---|---|
| Ohrwurm → Lehrling | 4 | 3 | 1,8 s statt 1,2 s | Varkan |
| Falle I → Lehrling | 4 | 3 | 0,9 s statt 0,6 s | Varkan |
| Punze → Nessel | 5 | 6 | 4,8 s statt 5 s | Varkan |
| Punze → Flicker | 6 | 7 | 6 s statt 6 s | Varkan |
| Kelle → Ohrwurm | 20 | 19 | 171 s statt 149,4 s | Skarn |

### 14.5 Schildbrechen (Info, ein Schütze, mit `regenStartS`)

| Angreifer → Schild | Schüsse (Zeit) | FA-Waffe gegen FA-Schild-HP |
|---|---|---|
| Schierling → Kokon II | 3 (40 s) | 4 (60 s) |
| Bilsenkraut → Kokon II | 1 (0 s) | 2 (7,6 s) |
| Bilsenkraut → Kokon III | 5 (45,6 s) | 5 (30,4 s) |
| Stechapfel → Kokon II | 12 (72,6 s) | 14 (85,8 s) |

Kokon II fällt schneller als die Vorbild-Stufe 1 (bewusst: billiger, schwächer, unterer Bandrand). Die Stufe III hält den Schild-Burst des Bilsenkrauts wie die Vorbild-T3-Stufe (5 Schüsse).

---

## 15. Ökonomie-Kennzahlen (Kurzreferenz)

| Gebäude | Ertrag | Unterhalt | Regeneration | Upgrade zur nächsten Stufe | Adjacency |
|---|---|---|---|---|---|
| Egel I | 2 M/s | −2 E/s | 2 HP/s | Egel II: 900 M / BP 10 = 90 s | Gibt Fabriken −7,5 % Mass-Verbrauch (8×8); erhält +12,5 % je angrenzender Wabe (FA-Relation, wie Varkan). |
| Egel II | 6 M/s | −9 E/s | 6 HP/s | Egel III: 4.500 M / BP 15 = 193 s | Fabriken −10 % Mass-Verbrauch; +12,5 % je Wabe. |
| Egel III | 18 M/s | −54 E/s | 20 HP/s | – | Fabriken −12,5 % Mass-Verbrauch; +12,5 % je Wabe. |
| Druse I | 20 E/s | – | 2 HP/s | – | Fabriken (8×8) −1,56 % Energy-Verbrauch, 2×2-Verbraucher −6,25 %; erhält +25 % je angrenzender Glimmzelle (SIZE4). |
| Druse II | 500 E/s | – | 6 HP/s | – | Fabriken −12,5 % Energy-Verbrauch; erhält +8,3 % je angrenzender Glimmzelle (SIZE12). |
| Druse III | 2.500 E/s | – | 20 HP/s | – | Fabriken −15,6 % Energy-Verbrauch; erhält +6,25 % je angrenzender Glimmzelle (SIZE16). |
| Fumarole | 100 E/s | – | 5 HP/s | – | Wie Druse II (Fabriken −12,5 % Energy); erhält +8,3 % je angrenzender Glimmzelle (SIZE12). |
| Wabe | +500 M Speicher | – | 3 HP/s | – | +12,5 % Produktion je angrenzendem Egel (FA-Relation, max. 4 Seiten = +50 %). |
| Glimmzelle | +10.000 E Speicher | – | – | – | Bufft angrenzende Energieproduzenten (FA-Relation): Druse I +25 % (SIZE4), Druse II und Fumarole +8,3 % (SIZE12), Druse III +6,25 % (SIZE16). |

Weitere Upgrade-Dauern (buildTime der Zielstufe / buildPower der Vorstufe): Landnest I → Landnest II 115 s; Landnest II → Landnest III 300 s; Luftnest I → Luftnest II 115 s; Fühler I → Fühler II 60 s; Fühler II → Fühler III 60 s; Kokon II → Kokon III 180 s.

Rädelsführer: +1 M/s, +20 E/s, Grundspeicher 650 M / 3.900 E, Build Power 10, Regeneration 18 HP/s. Überschlag nach Varkans Abstich-Formel, feuert erst ab 7.500 E Vorrat (Glimmzelle nötig, daher Daten-Vorgriff ab MS6 wie Varkans Glutspeicher).

---

## 16. Post-MVP-Markierungen und reservierte Rollen

Keine dieser Eigenheiten ist für die Kern-Balance nötig. In `roster.json` stehen sie als `special.postMvp: [{feature, effect}]` ohne Sim-Wirkung.

| Feature-ID | Einheiten | Wirkung, sobald verfügbar |
|---|---|---|
| **B8** | Kokon III | Weitere In-Place-Stufen Kokon IV/V wie die Vorbild-Kette. |
| **I5** | Schabe | Tarnung (Cloak) wie die Vorbild-Referenz; Bedingungen und Energiekosten legt I5 fest. Im MVP ohne Tarnung, Balance unverändert. |
| **I5 + U14** | Rädelsführer | Tarnung als Enhancement (Radar-Unsichtbarkeit). |
| **K16** | Tarantel | Ablenker fängt taktische Raketen im Nahbereich ab; dann HP zurück auf 3000. |
| **K18** | Rädelsführer, Nessel, Tarantel | Rädelsführer: Geflechtriss lähmt mobile Einheiten im Radius. Skarn-eigene Ergänzung ohne Vorbild-Wert (Review E4); Dauer und Radius werden mit K18 festgelegt.<br>Nessel: Treffer lähmen Ziele im Splash kurz (Dauer nach Vorbild-Relation); dann Nachladezeit zurück auf 6,0 s.<br>Tarantel: Death-EMP lähmt Einheiten im Umkreis. |
| **M13** | Rädelsführer, Flicker, Stopfer, Weber | Amphibisch: läuft über den Grund von Wasser (Vorbild-Relation: nur Kommandant und Engineers). Im MVP reine Landeinheit (faction.md §9.5 Nr. 3). |
| **U9** (fraktionsweit) | alle mobilen Einheiten | Veteranen-Regeneration nach FAF-Vet-Tabelle |

**Reservierte Rollen (nicht gezählt, `reservedPostMvp`):**

| Reserve-ID | DE / EN | Rolle | braucht | Hotbuild | Icon |
|---|---|---|---|---|---|
| `f2:lnd_t2_stealth` | **Silberfisch** / Silverfish | mobiler Tarnfeld-Träger | I5 | Landnest: G | land_stealth_t2 (Token stealth, reserviert) |
| `f2:str_t2_stealth` | **Nachtschatten** / Nightshade | Tarnfeld-Generator | I5 | Bau: G | struct_stealth_t2 (Token stealth, reserviert) |
| `f2:lnd_t2_amph` | **Wasserläufer** / Pondskater | amphibischer Kampfläufer | M13 | – | land_direct_t2 (amph: keine eigene Glyphe) |
| `f2:nav_t2_destroyer` | **Bisamratte** / Muskrat | Zerstörer, der an Land laufen kann | U17, M13 | – | Marine-Grundform (reserviert) |
| `f2:lnd_t3_armored` | **Schildwanze** / Shieldbug | schwer gepanzerter T3-Läufer | U10-Erweiterung (nur Budget), M13 (nur für die Amphibik der Referenz) | – | land_direct_t3 |

---

## 17. Silhouetten-Pflichtpaare, Visuals, Glyphen

**Pflichtpaare MS9 (nur ●):** Zecke ↔ Klette, Nessel ↔ Klette, Wolfsmilch ↔ Ginster, Ohrwurm ↔ Wolfsmilch, Floh ↔ Schabe, Flicker ↔ Schabe, Falle I ↔ Schlehe I, Egel I ↔ Druse I, Druse I ↔ Glimmzelle, Wabe ↔ Glimmzelle, Schlehe I ↔ Hecke.

**Pflichtpaare MS14:** Brummer ↔ Bremse, Bremse ↔ Stechmücke, Motte ↔ Brummer, Fühler I ↔ Kokon II, Schabe ↔ Gespinst, Bilsenkraut ↔ Druse III, Egel III ↔ Fumarole.

**Fraktions-Paartest:** Punze ↔ Zecke, Kelle ↔ Nessel, Sieb ↔ Klette, Lehrling ↔ Flicker, Vogt ↔ Rädelsführer. Rolle gleich lesen (Winkel-Code), Fraktion verschieden (Umriss mit Beinen, Glanz), jeweils 5 von 5 Testern bei 48 px.

**Visuals** (Superset-Mesh pro Rolle, Beinzahl als Instanzparameter):

| Visual | Mitglieder | Superset-Parts | ≈ Tris (ohne Beine) | Beine |
|---|---|---|---|---|
| `v_cmd` | Rädelsführer | 7 | 178 | 6 |
| `v_eng` | Flicker, Stopfer, Weber | 7 | 148 | 4/6 |
| `v_scout` | Schabe | 4 | 56 | 2 |
| `v_bot` | Floh, Milbe, Tarantel | 7 | 84 | 2/6 |
| `v_tank` | Zecke, Ohrwurm | 6 | 76 | 4 |
| `v_arty` | Nessel, Stechapfel | 6 | 128 | 4/6 |
| `v_aa` | Klette, Ginster, Hagedorn | 7 | 68 | 4/6 |
| `v_mml` | Wolfsmilch | 5 | 92 | 4 |
| `v_shield_mobile` | Gespinst | 5 | 80 | 4 |
| `v_sniper` | Langbein | 4 | 44 | 6 |
| `v_air_scout` | Motte | 4 | 68 | – |
| `v_fighter` | Bremse | 3 | 48 | – |
| `v_bomber` | Brummer | 3 | 60 | – |
| `v_gunship` | Hummel | 3 | 46 | – |
| `v_fbomber` | Stechmücke | 4 | 76 | – |
| `v_mex` | Egel I, Egel II, Egel III | 5 | 158 | – |
| `v_pgen` | Druse I, Druse II, Druse III | 6 | 242 | – |
| `v_hydro` | Fumarole | 5 | 218 | – |
| `v_mstore` | Wabe | 3 | 80 | – |
| `v_estore` | Glimmzelle | 3 | 96 | – |
| `v_fac_land` | Landnest I, Landnest II, Landnest III | 7 | 272 | – |
| `v_fac_air` | Luftnest I, Luftnest II | 5 | 194 | – |
| `v_pd` | Falle I, Falle II | 5 | 80 | – |
| `v_aa_struct` | Schlehe I, Schlehe II, Igel | 7 | 100 | – |
| `v_wall` | Hecke | 2 | 40 | – |
| `v_radar` | Fühler I, Fühler II, Fühler III | 5 | 104 | – |
| `v_shield` | Kokon II, Kokon III | 7 | 152 | – |
| `v_arty_struct` | Schierling, Bilsenkraut | 6 | 160 | – |

**Icon-Glyphen (19 Tokens, identisch zu Varkan):** `aa`, `arty`, `bomb`, `bot`, `build`, `direct`, `energy`, `estore`, `fac_air`, `fac_land`, `fbomb`, `hydro`, `intel`, `mass`, `mml`, `mstore`, `sam`, `shield`, `sniper`. Rädelsführer (`cmd_commander`) und Hecke (`wall`) ohne Glyphe. Reserviert: `stealth` (I5).

---

## 18. Offene Punkte

1. **Regeneration für Strukturen (Prüfpunkt, kein Blocker):** Die Sim faltet `regen` generisch als effektive Spalte für alle Einheiten (PLAN §3.4, Modifier G6, MS10). Skarn kommt mit U19 und damit nach MS10. Bei der Integration prüfen, dass `health.regenPerSec` aus dem Blueprint für Strukturen in diese Spalte fließt und nicht nur für den Kommandanten. Ohne das fehlen der Skarn-Basis 2–40 HP/s, und Egel, Druse und Nester (10–32 % weniger HP als bei Varkan) wären zu schwach.
2. **Kreuz-Ausnahme Punze → Zecke:** 10 statt 12 Salven bei praktisch gleicher Tötungszeit (−1,8 %). Löst sich nur, wenn Varkans Punze auf 24 Schaden / 1,0 s zurückgeht (Varkan-Entscheidung, nicht Teil dieses Rosters). Zecke-HP 281–307 ergäbe 11 Salven, aber +9 % Tötungszeit; 280 bleibt näher an FA.
3. **FAF-Stand nachziehen:** Referenzwerte sind spooky-db 3810. Vor dem MS9-Balancing gegen den dann aktuellen FAF-Stand prüfen (wie Varkan §18).
4. **Kokon-Kette:** Der Sprung II→III lässt die zwei T2-Zwischenstufen der Vorbild-Kette aus. Wenn B8 kommt, Kokon IV/V ergänzen und prüfen, ob Kokon III dann eine Zwischenstufe werden soll.
5. **Bein- und Draw-Budget:** 28 Visuals (Ziel eingehalten), zusammen mit Varkan 56 in einem Match; Messung und Bein-Renderer bei 200+ Einheiten offen (faction.md §11.2).
6. **Markenrecherche** für „Skarn“ und alle Rufnamen offen. Der Namens-Grep gegen die 357 FA-Einheitennamen (spooky-db 3810) läuft im Validator (`validate.py <index.json>`) und ist sauber, jetzt einschließlich der Lore-Namen (Rotten, Waffen, Spielbegriffe).

---

## 19. Review-Entscheidungen

Kritisches Review vom 2026-09-29 zu Balance, Lesbarkeit, Eigenständigkeit gegenüber FA und Vollständigkeit. Alle Werte sind aus den Rohdaten nachgerechnet (spooky-db 3810, `fa_ref.json`, Varkans `roster.json`), dazu Gefechts-Simulationen im 0,1-s-Takt mit Fokusfeuer. ✓ = übernommen, ◐ = teilweise bzw. abgewandelt, ✗ = geprüft und verworfen.

### 19.1 Balance

**T1-Rush gegen den Kommandanten** (alle Angreifer in Reichweite, Kommandant tötet einen nach dem anderen, ohne Überschlag; beide Kommandanten nutzen dieselbe Überschlag-Formel und verschieben das Ergebnis gleich):

| Angreifer → Kommandant | Einheiten (Mass) | FA-Paarung der Referenzen |
|---|---|---|
| Zecke → Rädelsführer | 17 (952) | 17 |
| Zecke → Vogt | 18 (1.008) | 18 |
| Punze → Rädelsführer | 18 (1.008) | 18 |
| Punze → Vogt | 19 (1.064) | 19 |
| Floh → Rädelsführer | 33 (1.155) | 33 |
| Floh → Vogt | 35 (1.225) | 35 |
| Stichel → Rädelsführer | 31 (930) | 31 |

Ergebnis: Beide Fraktionen brauchen für den Rush auf den gegnerischen Kommandanten dieselbe Masse (Zecke → Vogt = Punze → Rädelsführer = 1.008). Der Rädelsführer ist gegen Rushes ≈ 5 % anfälliger als der Vogt (10.000 HP + 18/s gegen 12.000 + 10/s), genau wie in der FA-Paarung. Der Floh ist ein schlechter Kommandanten-Rusher (wenig DPS), das ist Vorbild-Identität.

**Eco-Kurve:** Kommandant (+1 M/s, +20 E/s, 650 M / 3.900 E Speicher, BP 10), Egel I/II, Druse I/II, Glimmzelle, Wabe und Landnest I haben dieselben Kosten und Bauzeiten wie bei Varkan. Landnest II/III, Weber, Egel III und Druse III sind seit dem fraktionsübergreifenden Abgleich ebenfalls auf die Varkan-Werte gesetzt (FA-Eco ist fraktionsgleich; vorher 0,4–2,2 % Rundungsunterschied). Die Opening-Kurven sind damit identisch. Unterschiede entstehen erst an der Front: Die Zecke ist 5 % schneller gebaut (BT 285 statt 300), die Schabe kostet 8 statt 12 Mass.

**Gruppengefechte gleicher Masse (N = 3–25, Mittel der überlebenden Masse, + = Skarn gewinnt):** Zecke gegen Punze −0,18 (FA-Paarung −0,11), Floh gegen Stichel +0,17 (FA +0,37; Stand vor dem fraktionsübergreifenden Abgleich, seitdem ist der Stichel FA-gleich 60 HP / 30 Mass, Stärkeverhältnis 0,96 zu FA 1,01 laut `tools/roster/cross.py`), Ohrwurm gegen Meißel −0,22 (FA −0,23; vor R2: −0,29). Die T1-Abweichungen kommen aus Varkans Breakpoint-Entscheidungen (Punze 28 Schaden, damals Stichel 70 HP) und liegen bei nahezu gleicher Tötungszeit (−1,8 %). Nahe der Parität vergrößert das Quadratgesetz kleine Unterschiede stark. Kein Handlungsbedarf auf Skarn-Seite.

| Nr | Punkt | | Entscheidung und Begründung |
|---|---|---|---|
| R1 | Nessel: Ersatz für die Lähmung zu groß | ✓ | Nachladezeit **5,8 statt 5,6 s** (DPS/Mass +3,5 % statt +7,1 %, Pulk +3,4 %). Varkans Kelle liegt schon 8 % unter ihrer Referenz (9,0 statt 8,3 s). Mit 5,6 s stieg die Kreuz-Relation Nessel/Kelle auf +16,2 % gegenüber FA, jetzt +12,2 %. Breakpoints unverändert (Zecke und Punze je 2 Kapseln). |
| R2 | Ohrwurm ohne globale HP-Verschiebung | ✓ | HP **1.980 statt 1.900** (+4,2 %, wie der Rest des Rosters). Varkans Meißel liegt +6,7 % über seiner Referenz, der Ohrwurm lag bei ±0; Kreuz-Relation HP −5,3 % → −1,3 %, Gruppengefecht jetzt auf FA-Niveau. Kein Breakpoint bricht. Eine Info-Paarung (Kelle → Ohrwurm, 20 statt 19 Salven) ist in §14.4 dokumentiert. |
| R3 | Regeneration der Gebäude nicht gesichert | ◐ | Kein neues Feature: PLAN §3.4 faltet `regen` als generische Spalte (G6, MS10), Skarn kommt mit U19 danach. Bleibt als Prüfpunkt §18 Nr. 1. |
| R4 | Zecke +3,7 % HP bei Varkan-Punze −2,8 % DPS: Linie zu stark? | ✗ | Nachgerechnet: Die Punze tötet die Zecke in 10 Salven (Breakpoint 280 = 10 × 28), das Gruppengefecht kippt eher zu Varkan. HP 270 änderte nichts (weiter 10 Salven). |
| R5 | Langbein zerbrechlicher als Varkans Reißnadel, obwohl die Vorbild-Fraktion keinen Sniper hat | ✗ | Bleibt: Glaskanonen-Signatur (Produkt −3,2 %, Kreuz-Relation im Gate); ○-Einheit ab MS13. |
| R6 | Gespinst: Kreuz-Relation −19,3 % | ✗ | Bleibt bewusst am unteren Rand: Die Vorbild-Fraktion hat keinen mobilen Schild, Skarn setzt auf Tempo und später Tarnung. Gate ±25 % hält. |

### 19.2 Lesbarkeit, Silhouetten, Icons

| Nr | Punkt | | Entscheidung und Begründung |
|---|---|---|---|
| L1 | Stechmücke nutzte den Hinterleib, das Monopol-Merkmal des Bombers | ✓ | Rumpf ist jetzt ein schlanker `carapace`-Keil. Neuer Lint in Generator und Validator: `abdomen` nur bei BOMBER ohne ANTIAIR. `v_fbomber` 76 statt 88 Tris. |
| L2 | Icons | ✓ | Geprüft: gleiche Icon-IDs, 19 Glyphen und Hotbuild-Tasten wie Varkan (Generator-Assert). Die Tarnung der Schabe (V2) ändert kein Icon; `stealth` bleibt reserviert. |
| L3 | Floh ↔ Zecke (beide mit Linse) | ✗ | Kein neues Pflichtpaar: Beinzahl 2 gegen 4, Panzer kürzer als die Beine, anderes Icon (`bot` gegen `direct`). |

### 19.3 Eigenständigkeit gegenüber FA und Passung zum Vorbild

| Nr | Punkt | | Entscheidung und Begründung |
|---|---|---|---|
| E1 | Rottenname „Pack Shard“ ist ein FA-Einheitenname | ✓ | Umbenannt in **Rotte Splitt / Pack Splinter** (faction.md §1). Der Validator greppt jetzt auch die Lore-Namen (Fraktion, Rotten, Waffen- und Spielbegriffe). |
| E2 | M13 „Vorbild-Relation“ bei allen T3-Läufern falsch | ✓ | In spooky-db sind von den Referenzen nur Kommandant und Engineers amphibisch, nicht `URL0303`, `URL0304`, `DRLK001` oder `XAL0305`. M13 bleibt bei Rädelsführer, Flicker, Stopfer und Weber (4 statt 8 Einheiten) sowie bei den Reserve-Rollen Wasserläufer, Bisamratte und Schildwanze (deren Referenz `XRL0305` ist amphibisch). |
| E3 | Dauerstrahl bei Tarantel und Langbein ohne Vorbild | ✓ | Gestrichen: Beide Referenzen feuern Pulse bzw. Projektile. Der Beam-Waffentyp bleibt als Idee für Experimentals und ein Rädelsführer-Enhancement (faction.md §9.4); keine MVP-Rolle hängt mehr an einer Feature-ID, die es noch nicht gibt. |
| E4 | K18 beim Rädelsführer als „Vorbild-Relation“ | ✓ | Die Referenz hat keine EMP-Todesexplosion. Umformuliert als Skarn-eigene Ergänzung. Nessel und Tarantel behalten K18, beide Referenzen haben EMP. |
| E5 | „Nachwachsen im Feld“ unter K10 | ✓ | Gestrichen: nicht aus der Vorbild-Referenz belegt (mobile Einheiten regenerieren dort nur über Veteranenstufen, U9), stärkt Skarn-Raider über die Referenz hinaus und hängt fachfremd an K10 (Schilde). |
| E6 | Bisamratte (Zerstörer, der an Land läuft) zu nah am Vorbild? | ✗ | Bleibt reserviert: Übernommen wird nur die Mechanik (Layer-Wechsel), nicht Name, Form oder Lore. Das ist Anlehnung über Gameplay-Identität, wie gewünscht. |
| E7 | Kampfläufer mit Reparatur (Referenz `URL0107` hat REPAIR, BP 1) | ✗ | Nicht übernommen: BP 1 ist spielerisch bedeutungslos, würde aber Repair für Nicht-Engineers in der Order-Logik erzwingen. |

### 19.4 Vollständigkeit der Rollen

| Nr | Punkt | | Entscheidung und Begründung |
|---|---|---|---|
| V1 | Rollen gegen Varkan | ✓ | Geprüft: 50/50 Rollen-IDs, gleiche MS-Zuordnung, 26 im MS9-Kern, gleiche Hotbuild-Tasten. |
| V2 | Vorbild-Fähigkeiten gegen Post-MVP-Markierungen | ◐ | Alle `Display.Abilities` der 50 Referenzen abgeglichen. Ergänzt: Schabe mit **I5** (Tarnung, die Referenz hat Cloaking). Nicht markiert, weil Varkan sie ebenso ignoriert: Omni am Kommandanten (I4), `Aquatic`-Bauplatz der Flugabwehrtürme (U17), Radar der Stechmücke. |
| V3 | Reserve-Rollen | ✓ | Vollständig für die Vorbild-Signaturen: mobiles und stationäres Tarnfeld, amphibischer T2-Läufer, Zerstörer an Land, gepanzerter T3-Läufer (jetzt mit M13). |

---

## 20. Experimentals (T4, Post-MVP)

5 T4-Rollen, **nicht** in der Zählung oben und ohne Sim-Wirkung vor ihren Features. Design, Lore, Kitbash und Icons: `experimentals.md`. Daten und Gates: `tools/roster/f2/exp.py` (von `gen.py` eingebunden), Referenzen `fa_ref_t4.json` (Vorbild-T4, dev-only). Gates: DPS/Mass, HP/Mass und Produkt je ±15 % gegen die Vorbild-T4, Pulk ±15 % bei Artillerie, Identität „billiger, schneller, zerbrechlicher“ (Mass ≤, Tempo ≥, HP/Mass ≤ Referenz), Setons-Brücke (≥ 6 nebeneinander auf 72 WU), T4-Budget (≤ 1.200 Tris L0, ≤ 12 Parts, ≤ 3 animiert).

| ID | Name DE / EN | Rolle | Mass | Energy | BT | HP | Regen | DPS | Tempo | Footprint · s | Beine | Icon | Hotbuild |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `f2:exp_lnd_assault` | **Skolopender** / Scolopendra | Experimenteller Sturmläufer | 19.500 | 250.000 | 27.000 | 42.000 | 10 | 4.409 | 2,7 | 4×10 · 3 | 14 | `land_direct_t4` | Q |
| `f2:exp_lnd_siege` | **Assel** / Woodlouse | Experimenteller Brutläufer | 36.000 | 420.000 | 58.000 | 104.000 | 1 | 2.430 | 2,2 | 8×8 · 3 | 14 | `land_direct_t4` | E |
| `f2:exp_air_gunship` | **Tsetse** / Tsetse | Experimenteller Kampfschweber | 27.500 | 780.000 | 46.000 | 70.000 | 70 | 2.538 | 10 | 6×6 · 0 | – | `air_direct_t4` | R |
| `f2:exp_lnd_arty` | **Bärenklau** / Hogweed | Experimentelle Schnellfeuer-Artillerie | 210.000 | 3.800.000 | 230.000 | 8.500 | 0 | 1.500 | 1,6 | 6×8 · 3 | 8 | `land_arty_t4` | W |
| `f2:exp_str_eco` | **Myzel** / Mycelium | Experimenteller Geflechtknoten | 36.000 | 900.000 | 90.000 | 5.000 | 25 | 0 | – | 10×10 | – | `struct_mass_t4` | T |

**Waffen:**

| Einheit | Waffe | Schaden × Salve / Nachladen | DPS | RW (min) | Splash | Ziel |
|---|---|---|---|---|---|---|
| Skolopender | Granatstrahl (Dauerstrahl; MVP-Fallback Pulslinse 390 alle 0,1 s) | 390 × 1 / 0,1 s | 3.900 | 30 (4) | 0,5 | land |
| Skolopender | Kieferlinsen (2 × Puls) | 150 × 2 / 0,7 s | 429 | 60 | – | land |
| Skolopender | Dornenkamm Heck (2 × Lenkpfeil, Luft) | 40 × 4 / 2 s | 80 | 60 | – | air |
| Skolopender | Todeswaffe | 4.000 im Radius 6 | – | – | – | – |
| Assel | Zwillingslinsen (2 Türme × 2 Linsen) | 720 × 4 / 1,2 s | 2.400 | 60 (4) | 2 | land |
| Assel | Flakdornen (Luft) | 18 × 1 / 0,6 s | 30 | 40 | 2 | air |
| Assel | Todeswaffe | 8.000 im Radius 9 | – | – | – | – |
| Tsetse | Bauchlinsen (4 × Puls) | 300 × 4 / 0,7 s | 1.714 | 30 | 3 | land |
| Tsetse | Stachelköcher (2 × 3 Raketen) | 200 × 6 / 2 s | 600 | 30 | – | land |
| Tsetse | Dornenkamm (4 × Lenkpfeil, Luft) | 140 × 4 / 2,5 s | 224 | 60 | – | air |
| Tsetse | Todeswaffe | 5.000 im Radius 8 | – | – | – | – |
| Bärenklau | Doldensalve (20 Kapseln nacheinander, 0,25 s Abstand) | 1.500 × 20 / 20 s | 1.500 | 4.000 (150) | 12 | land |
| Bärenklau | Todeswaffe | 3.000 im Radius 8 | – | – | – | – |
| Myzel | Todeswaffe | 3.000 im Radius 20 | – | – | – | – |

**Balance gegen die Vorbild-T4** (Referenz dev-only über Blueprint-Präfix):

| Einheit | Referenz | ΔDPS/Mass | ΔHP/Mass | ΔProdukt | Pulk | Identität (Mass ≤ · Tempo ≥ · HP/Mass ≤) | Amortisation |
|---|---|---|---|---|---|---|---|
| Skolopender | `URL0402` | −0,8 % | −4,3 % | −5,0 % | – | ✓ · ✓ · ✓ | – |
| Assel | `XRL0403` | −4,4 % | −1,5 % | −5,8 % | – | ✓ · ✓ · ✓ | – |
| Tsetse | `URA0401` | +0,4 % | −1,6 % | −1,2 % | – | ✓ · ✓ · ✓ | – |
| Bärenklau | `URL0401` | −1,8 % | −1,1 % | −2,8 % | −1,8 % | ✓ · ✓ · ✓ | – |
| Myzel | `XAB1401 (Fremdreferenz, Info)` | – | – | – | – | – | 536 s = 1,75 × Egel-Kette (306 s) |

**Kitbash:**

| Einheit | Monopol-Merkmal | Parts | animiert | ≈ Tris L0 (ohne Beine) | Außenmaß (L × B × H, Beinspanne) | Brücke |
|---|---|---|---|---|---|---|
| Skolopender | Segmentkette: sieben flache Keilglieder hintereinander (Länge ≥ 3,4 × Breite), 14 Beine als Doppelreihe; überlange Strahllinse am Kopf. | 8 | 2 | 432 | 11 × 3,2 × 2,2, 5,6 WU | 12 nebeneinander |
| Assel | Plattenkuppel: sieben überlappende, teamfarbene Querplatten als flache Kuppel (Breite ≥ 0,7 × Länge), vorn ein glühendes Brutmaul. | 8 | 2 | 364 | 9,5 × 7 × 4,4, 10,5 WU | 6 nebeneinander |
| Tsetse | Vierfach-Schwirrscheibe: vier opake Schwirrscheiben an X-Auslegern um einen langen Gliederrumpf, keine Flügel. | 7 | 2 | 304 | 10 × 11 × 2,4 WU | – |
| Bärenklau | Dolde: ein doppelt gegliederter Riesenschwanz trägt eine schirmförmige Dolde aus 12 Kapseln (Ø 4 WU) schräg nach vorn (50°). | 6 | 3 | 396 | 8,5 × 5,5 × 10,5, 9 WU | 8 nebeneinander |
| Myzel | Ringgeflecht: drei konzentrische, glühende Netzringe flach über einer 10 × 10-Kruste, fünf Drusen im Ring; niedrig und breit. | 4 | 0 | 518 | 10 × 10 × 6 WU | – |

**Post-MVP-Features je Einheit:**

| Einheit | braucht | Eigenheiten mit Feature-ID |
|---|---|---|
| Skolopender | U16, U21, K1-Erweiterung, I5, M13, U18, P14 | **K1-Erweiterung**: Granatstrahl als echter Dauerstrahl (Schaden pro Tick, trifft alles auf der Strahllinie bis zum ersten Hindernis).<br>**I5**: Tarnfeld um sich (Radar- und Sicht-Tarnung für sich und Einheiten im Radius 12 WU), Unterhalt 400 E/s wie die Vorbild-Relation.<br>**M13**: Amphibisch: läuft über den Grund von Wasser.<br>**U18**: Giftstachel unter Wasser (Torpedo, 50 Schaden alle 4 s, RW 45). |
| Assel | U21, B3-Erweiterung, M13, U18, P14 | **M13**: Amphibisch: läuft über den Grund von Wasser; brütet auch unter Wasser.<br>**U18**: Tiefenstachel (Torpedo, 20 × 4 Schaden alle 1,3 s, RW 64) und Torpedo-Ablenker.<br>**B3-Erweiterung**: Produktion aus einer mobilen Einheit (Queue läuft auch in Bewegung, Ausstoß am Bug). |
| Tsetse | U21, U12, I5, K12, P14 | **I5**: Radar-Tarnung (unsichtbar für Radar, Unterhalt 600 E/s wie die Vorbild-Relation).<br>**K12**: Absturzschaden 5000 im Radius 8 beim Abschuss.<br>**U12**: Flugmodell und Luftfabrik-Pfad der schweren T3/T4-Luft (Bau durch T3-Engineers, Landung, Wendekreis). |
| Bärenklau | U21, K2, K4, C17, M13, I3, P14 | **C17**: Toggle Wurzeln/Lösen (10 s / 5 s); verwurzelt immobil, Beine als Anker gespreizt.<br>**M13**: Amphibisch: läuft über den Grund von Wasser (Vorbild-Relation), feuert nicht unter Wasser. |
| Myzel | U21, E17, K14 | **E17**: Endgame-Eco: fester Ertrag 60 M/s + 3000 E/s ohne Spot und ohne Unterhalt.<br>**K14**: Sporenbruch 3000 Schaden im Radius 20.<br>**G6-Aura**: Wurzelnetz: eigene Strukturen im Radius 30 WU regenerieren doppelt (Modifier über die generische regen-Spalte, keine eigene Feature-ID; Vorschlag unter E17). |
