# Orden von Sael: Experimentals (T4, Post-MVP)

> **Status:** Designentwurf für die T4-Stufe der Fraktion f3 (Orden von Sael). Alles hier ist **Post-MVP** (features.json U16 „Erstes Land-Experimental“, U21 „Volles Experimental-Roster & Game-Ender“, E17 „Endgame-Eco“) und hat vor den genannten Features keine Sim-Wirkung.
> **Quelle der Zahlen:** `roster.json` → `experimentals[]` (erzeugt von `tools/roster/f3/gen.py`, Daten und Gates in `tools/roster/f3/exp.py`). Die Tabellen hier sind daraus abgeschrieben, die erzeugte Übersicht steht in `roster.md` §22. Bei Widerspruch gilt `roster.json`.
> **Referenz:** die T4-Einheiten der Vorbild-Fraktion aus spooky-db 3810 (`tools/roster/f3/fa_ref_t4.json`, dev-only), geprüft gegen FAForever/fa `develop` (abgerufen 2026-09-29). Wie im Kern-Roster wird die Vorbild-Fraktion nur über Blueprint-IDs genannt, nie mit Namen. Übernommen werden **Rollen und Zahlen-Relationen**, nicht Namen, Formen oder Lore (faction.md §2.4, §2.5).
> **Prüfung:** `python3 tools/roster/f3/validate.py` rechnet die T4-Gates unabhängig nach (Balance, Pulk, Sael-Identität, Brücke, Budget, Monopol-Lints, Icon, Namen gegen FA und gegen alle anderen Roster). `python3 tools/roster/cross.py` bleibt grün und prüft die T4-Namen über `reservedPostMvp[]` mit.

---

## 1. Überblick

Der Orden nennt seine Experimentals **Großschalen** (EN *Great Shells*, nur Flavor, nie in Zahlenanzeigen). Eine Großschale wird über viele Schichten von mehreren Kapiteln gemeinsam geschichtet; kein Kapitel schichtet sie allein. Lore-Satz für das Handbuch: *„Was lange geschichtet wird, hält länger, als die Flut steigt.“*

| ID | DE / EN | Rolle DE / EN | Vorbild-Rolle (BP, dev-only) | Mass | HP (Rumpf + Schild) | DPS Boden · Luft | Tempo | T4-Tab | Icon |
|---|---|---|---|---|---|---|---|---|---|
| `f3:exp_lnd_assault` | **Karkinos** / Karkinos | Riesen-Sturmläufer / Colossal Assault Walker | `UAL0401` amphibischer Riesen-Sturmläufer | 27.500 | 102.000 (76.000 + 26.000) | 2.640 · – | 2,4 | Q | `land_direct_t4` |
| `f3:exp_lnd_fortress` | **Ammonit** / Ammonite | Schwebende Festung / Hover Fortress | `UAS0401` tauchendes Schlachtschiff mit Fabrik | 24.000 | 62.000 (44.000 + 18.000) | 800 · – | 2,5 | E | `land_sniper_t4` |
| `f3:exp_air_carrier` | **Pelikan** / Pelican | Schwebeträger / Hover Carrier | `UAA0310` fliegender Träger mit Senkstrahl und Blasen-Schild | 45.000 | 70.000 (36.000 + 34.000) | 3.300 · 2.843 | 8 | R | `air_direct_t4` |
| `f3:exp_str_arty` | **Kreuzsee** / Cross Sea | Fernartillerie / Strategic Artillery (**Game-Ender**) | `XAB2307` Schnellfeuer-Fernartillerie | 202.500 | 8.100 | 426 · – | – | W | `struct_arty_t4` |
| `f3:exp_str_eco` | **Perle** / Pearl | Ressourcenperle / Resource Pearl (**Eco**) | `XAB1401` Ressourcen-Generator | 250.200 | 4.500 | – | – | T | `struct_mass_t4` |

**Mix:** 2 × Land (Sturmläufer, schwebende Festung mit Fabrik), 1 × Luft (Träger), 1 × Game-Ender, 1 × Eco. Damit sind **alle fünf T4-Rollen der Vorbild-Fraktion** abgedeckt; die See-Rolle des Vorbilds wird, passend zum Sael-Schweben, zur Land-und-Wasser-Festung.

**Spielidentität:** „Wenige, die halten, schlagen viele, die fallen“ (faction.md §9.1) gilt auch in T4. Die Großschalen kosten **dasselbe** wie ihre Vorbild-Referenz (die Sael-Eco ist identisch, §9.5), tragen aber die Sael-Asymmetrien in die letzte Stufe:

- **Schilde (A3/A5):** Alle drei mobilen Großschalen tragen einen Schild, der mindestens 25 % ihrer Balance-HP stellt (Karkinos 25 %, Ammonit 29 %, Pelikan 49 %). Vor K10 wird er wie beim Triton zur HP addiert.
- **Reichweite und Einzelschuss (A1/A4):** Jede mobile Hauptwaffe reicht mindestens so weit wie die des Vorbilds (Karkinos 42 statt 40, Ammonit 158 statt 150). Wo das Vorbild einen Dauerstrahl hat, feuert Sael **große Einzelstöße mit gleichem DPS**; das spart die Strahlwaffe (K1-Erweiterung) und bleibt Sael-typisch (Overkill gegen Schwärme).
- **Zerbrechliche Strukturen (A6):** Kreuzsee und Perle haben 10 % weniger HP pro Mass als das Vorbild. Überfälle auf die Großschalen-Baustellen lohnen sich gegen Sael mehr.
- **Schweben (M13):** Der Ammonit ist die Antwort auf Wasserkarten: Er ersetzt das Tauchen des Vorbilds durch Schweben und trägt eine Schweberarmee über Wasser in die Flanke.

---

## 2. Gemeinsame T4-Regeln

### 2.1 Namen

- **Wortfeld wie im Kern** (faction.md §7.2), aber **die großen, alten Gestalten des Meeres**: Läufer = Krebse (*Karkinos*, der Riesenkrebs der griechischen Sage, griechisch „Krebs“), Schweber = Schalentiere, die ihre Schale tragen und gleiten (*Ammonit*), Luft = Seevögel (*Pelikan*, der Kehlsack ist der Hangar), Artillerie = Wellen und Fluten (*Kreuzsee*, der gefährliche Seegang aus zwei Richtungen), Wirtschaft = die Perle selbst. *Perle / Pearl* war in faction.md §7.4 seit dem Kern-Roster für ein Experimental reserviert; sie ist jetzt das Eco-Experimental (Lore: Kessa als „Perle im Werden“, §2.1).
- **Ton (§2.4):** *Karkinos* ist eine Sagengestalt wie *Triton*, keine Religion. Keine Kreuzzugs-, Heils- oder Lichtbegriffe.
- **Keine Tech-Nummer, keine römische Stufe.** Anzeige wie im Kern: Rufname und darunter die Funktionsrolle, z. B. **Ammonit** · *Schwebende Festung* / **Ammonite** · *Hover Fortress*.
- **Grep und Abstand:** Alle zehn Rufnamen sind gegen die 357 FA-Einheiten- und 218 FA-Waffennamen (`tools/roster/fa_names.json`, auch Einzelwörter) und gegen alle Rufnamen von Varkan, Skarn und Aurith (Kern, Reserve, T4; Levenshtein-Abstand ≥ 2) geprüft (`validate.py`, `cross.py`). **Verworfen:** *Seespinne / Spider Crab*, *Königskrabbe / King Crab* und jede andere EN-Krabbe (FA-Wort „Crab“, wie schon beim Knallkrebs), *Riesenhummer* (zu nah am Skarn-*Hummel*, Review L2), *Riesenassel* (Skarn-T4 *Assel*, außerdem Skarn-Wortfeld), *Pfeilschwanz / Horseshoe Crab* (Crab), *Kaventsmann / Rogue Wave* (FA-Wörter „Rogue“, „Wave“), *Tsunami* und *Leviathan* (FA-Namen), *Nautilus* (bleibt für den T3-Schwebepanzer reserviert).
- **Waffen-IDs:** `f3:wpn_<einheit>_<waffe>` (z. B. `f3:wpn_karkinos_lance`, `f3:wpn_crosssea_horn`), Todeswaffen mit eigenem Namen (Schalenbruch, Spiralbruch, Absturz, Hornbruch, Perlsprung der Perle).
- **i18n:** `unit.f3.exp_lnd_assault.name` usw., wie im Kern.

### 2.2 IDs und Einordnung

- **Schema:** `f3:exp_<domäne>_<rolle>` mit den Domänen `lnd | air | str` wie Skarn (`f2:exp_*`). Rollen-Tokens `assault`, `fortress`, `carrier`, `arty`, `eco`.
- **Nicht im Kern-Roster:** `roster.json` → `experimentals[]`, **nicht** `units[]` und nicht `counts.total`. Kern-Gates (50 Rollen wie Varkan, 28 Visuals, 19 Glyphen) und `cross.py` bleiben unverändert. `counts.experimentals = 5`. Die Rufnamen stehen zusätzlich als Kurzeinträge in `reservedPostMvp[]` (`detail: "experimentals"`), weil `cross.py` für den N × N-Namensabgleich nur `units` und `reservedPostMvp` liest.
- **Felder:** wie ein Kern-Eintrag (`economy`, `health`, `shield`, `weapons`, `motion`, `special.postMvp` mit `{feature, what, fallback}`, `kitbash`, `balance`), zusätzlich `tier: "T4"`, `tech: 4`, `postMvp: true`, `needs[]`, `iconMarker`, `health.hull`, `kitbash.monopoly`, `kitbash.trisBudget`, `motion.dimensionsWU`, `motion.bridge`.
- **Bau:** `buildableBy: ENGINEER & TECH3` (Kustos und Prior mit Weihe-Stufe wie im Vorbild). Bauzeit in FA-Semantik: Karkinos 51.500 / 32 BP ≈ 27 min für einen Kustos allein, mit zehn assistierenden Kustoden ≈ 2,7 min.

### 2.3 Form: Schichtung im Großformat

Alle Formregeln aus faction.md §3 und §5 gelten weiter: Schale mit flacher Unterseite, **rund = Körper, spitz = Waffe**, Winkel-Code (Lanze waagerecht = direkt, Horn schräg = indirekt, Stachel senkrecht = Luft, Ring = Schild/Flow), Goldkern nur bei Flow-Einheiten, Schwebeteller nur bei Schwebern, Beine nur bei Läufern. Die Monopol-Lints aus §5.3 Nr. 6 prüft der Generator auch für T4. Neu:

| Regel | Umsetzung |
|---|---|
| **Monopol-Merkmal pro Großschale** | **Scherenschild** (Karkinos), **liegende Spiralschale** (Ammonit), **Kehlsack-Schwinge** (Pelikan), **Hornkranz** (Kreuzsee), **offene Muschel mit Riesenperle** (Perle). Keine andere Einheit der Fraktion trägt sie. |
| **Rolle bleibt am Kern-Part lesbar** | Karkinos hat Perle + waagerechte Lanze (Direktfeuer) auf breitem Rückenschild mit Beinen (Läufer), Ammonit Perle + Überlänge-Lanze wie der Konus (Präzision) auf Schwebeteller, Pelikan die breite Ovalschwinge mit Bauch-Gondel des Tölpels (Luft gegen Boden), Kreuzsee Hörner (Artillerie), Perle eine umschlossene Perle mit Goldkern und Ring (Wirtschaft). Wer den Kauri lesen kann, liest den Ammonit. |
| **Eine Perle** | Auch T4 tragen höchstens eine `orb`. Der Karkinos zeigt seine Scherenlanzen deshalb aus Scherenschalen, nicht aus Nebenperlen. Der Pelikan hat **keine** Lanze: Die Lanze bleibt waagerecht (Lint), der Senkstoß kommt aus dem Kehlsack. |
| **Flow-Ausnahmen** | Kapiteltor (Ammonit), Hangartor (Pelikan) und Riesenperle (Perle) tragen einen Goldkern, weil die Einheiten `FACTORY` bzw. `ECONOMIC` sind. Kreuzsee hat trotz Energie pro Schuss **keinen** Goldkern (Kampfeinheit); ihre Hornmündung leuchtet vor dem Schuss jadefarben (Telegraph wie §3.5). |
| **Läufer ≥ 8 Beine, breiter als lang** | Der Karkinos steht auf 10 spitzen Beinen (5 Paare; Einsiedler 4 Paare). Sein Rückenschild ist 6,4 × 5,2 WU, also wie bei allen Sael-Läufern breiter als lang. |
| **Tech-Marker: Klammerbögen** | Statt Tech-Streifen tragen Großschalen **zwei Tiefjade-Winkel** am hinteren Schalenrand (Breite 0,10 WU × Maßstab wie ein Streifen). Das Modell spiegelt die eckige Klammer des Icons (§2.5), wie Streifen die Kerben spiegeln. |
| **Schwebeteller** | Der Ammonit sitzt auf dem größten Schwebeteller der Armee (Schattensaum 10 %), Schwebehöhe 0,6 WU (T3: 0,35). |
| **Teamfarbe** | Wie im Kern (§4.2): Schweber/Läufer ≥ 30 %, Luft ≥ 45 %, Strukturen 20–30 % der Draufsicht. Karkinos: Rückenschild und Scherenschalen; Ammonit: alle drei Windungen; Pelikan: beide Schwingenhälften und der Kehlsack; Kreuzsee und Perle: Kissen-Sockel. |
| **Kein Filigran** | Die 12-%-Regel gilt relativ zur Einheitenlänge; bei 5–14 WU also Lanzen-Ø ≥ 0,6 WU an der Wurzel. |

### 2.4 Kitbash- und Tri-Budget

| Größe | Kern (faction.md §3.3) | **Großschale (T4)** |
|---|---|---|
| Tris LOD0 / LOD1 / LOD2 | 350 / 220 / 110 | **1.500 / 800 / 320** (Entwurfsgrenze der Kitbash-Schätzung; das Modell-Kit prüft gegen `T4_BUDGET` 1.600 / 800 / 320, greift bei `tech: 4`) |
| LOD-Distanzen | 60 / 180 WU | **120 / 360 WU** (`T4_LOD_DISTANCES`) |
| Part-Einträge | ≤ 7 mobil, ≤ 9 Strukturen | **≤ 10** (Vervielfachung über `count`, Beine = 1 Eintrag) |
| animierte Parts | ≤ 2 | **≤ 3** (PartStream-Limit 8 bleibt frei) |
| Visuals | 28 pro Fraktion | **+1 pro Großschale** (kein Superset mit Kern-Visuals) |

**Tris-Schätzung:** T4-Tabelle in `exp.py` mit doppelter Segmentzahl der runden Primitive gegenüber dem Kern-Katalog, weil T4 3–6-mal so groß sind: `shell` 120, `hoverpad` 64, `legs` 30 je Bein, `orb` 160, `lance` 24, `horn` 64, `ring` 144, `arch` 72, `mast` 48, `wing` 32. Die Platzhalter liegen bei **520–1.036 Tris** L0; der Rest bis 1.500 ist für Final-Art (Schichtlinien, Goldkanten, Windungsnähte).

| Großschale | Parts (Einträge) | animiert | Tris L0 (Schätzung) | Visual |
|---|---|---|---|---|
| Karkinos | legs × 10, shell (Rückenschild, team), shell (Bauchschale, jade), shell × 2 (Scherenschalen, team), orb (team, yaw), lance × 2 (Tiefenlanze, pitch), lance × 2 (Scherenlanzen) — 7 | 2 | 1.036 | `v_exp_karkinos` |
| Ammonit | hoverpad, shell × 3 (Windungen, team), shell (Bauchschale, jade), orb (team, yaw), lance (Gezeitenlanze, pitch), ring (Schildring, yaw), arch (Kapiteltor, glow) — 7 | 3 | 944 | `v_exp_ammonite` |
| Pelikan | wing × 2 (Ovalschwinge, team), shell (Rückenkuppel), shell (Kehlsack, team), ring (Schildring, yaw), arch (Hangartor, glow) — 5 | 1 | 520 | `v_exp_pelican` |
| Kreuzsee | shell (Kissen, team), shell (Gegenschale), mast (Lafette, yaw), horn × 3 (Hornkranz, pitch), shell (Kammerschale, jade) — 5 | 2 | 600 | `v_exp_crosssea` |
| Perle | shell (Kissen, team), shell (untere Schale), shell (obere Schale, pitch), orb (Riesenperle, glow), ring (Goldring, gold, spin) — 5 | 2 | 664 | `v_exp_pearl` |

Die Modelle liegen als `content/models/sael/exp_*.ts` vor (Primitive `ellipsoid`/`cone`/`torus`, faction.md §3.6; 940–1.484 Tris LOD0). Der Modellkit wendet `T4_BUDGET` (1.600 / 800 / 320) über `tech: 4` an.

### 2.5 Strategic Icons (gemeinsame Grammatik)

- **Grundform nach Domäne, Glyphe nach Rolle wie im Kern**, keine neue Form und keine neue Glyphe. Die 19 Tokens (`iconGlyphs`) bleiben unverändert.
- **Statt Tech-Kerben eine eckige Klammer um die Grundform** (Varkan faction.md §6.4, dort für Experimentals vorgesehen). Größenfaktor **1,5** (T3 mobil 1,3, Kommandant 1,6). Schema `<domäne>_<glyphe>_t4` wie Skarn und Aurith.

| Großschale | Icon-ID | Lesart im Strategic Zoom |
|---|---|---|
| Karkinos | `land_direct_t4` | [■●] Land-Quadrat mit Punkt in Klammer. Die T4-Rolle „Sturm“ trägt fraktionsübergreifend `direct` bzw. `bot` (Skarn `direct`, Aurith `bot`); Sael folgt Skarn, weil beim Karkinos die Front-DPS und nicht der Überfall die Gefahr ist. |
| Ammonit | `land_sniper_t4` | [■—●—] Land-Quadrat mit Präzisions-Glyphe: RW 158, 8.000 pro Schuss. „Gefahr vor Funktion“ (f4 faction.md §6.2): Die Fabrik zeigt Info-Leiste und Rally-Punkt. |
| Pelikan | `air_direct_t4` | [▲●] Luft-Dreieck mit Punkt (Gunship-Glyphe wie Albatros): schwebt über dem Ziel. Flugabwehr und Hangar zeigt die Info-Leiste. |
| Kreuzsee | `struct_arty_t4` | [⬡⌒] Sechseck mit Bogen in Klammer (Artilleriestellung wie Brandung/Sintflut). |
| Perle | `struct_mass_t4` | [⬡◆] Sechseck mit Raute in Klammer. Die Perle liefert Mass und Energy; die Raute steht für die knappe Ressource (wie Skarn und Aurith). |

- **Radar-Blip (I3):** unverändert. Großschalen erscheinen als gewöhnliches Achteck, Dreieck oder Sechseck; erst Sicht verrät sie.
- **Personal-Schilde** zeigen sich wie beim Triton als zweiter Balken, der Blasen-Schild des Pelikans als Schildblase (C3, K10).

### 2.6 Balance-Methodik

- **Primärreferenz** ist das T4 der Vorbild-Fraktion in derselben Rolle, Datenstand spooky 3810 wie das Kern-Roster. Gates wie im Kern: **Boden-DPS/Mass, HP(+Schild)/Mass und Produkt je ±15 %** (hartes Band ±25 %), zusätzlich **Luft-DPS/Mass ±15 %** (Pelikan) und **Pulk-DPS/Mass ±15 %** (Kreuzsee). Boden-DPS = Summe aller Waffen gegen Land, Luft-DPS = Summe aller Waffen gegen Luft; die FA-Seite summiert entsprechend nach Waffenkategorie (ohne Todes-, Anti-Marine- und Torpedo-Abwehrwaffen).
- **Korrektur an spooky 3810** (`FA_T4_OVERRIDES` in `exp.py`, gleich in `validate.py`): Die Referenz-Fernartillerie verschießt eine Granate, die sich in **6 Splitter à 220** teilt (develop `AIFFragmentationSensorShell01`, `Fragments = 6`); spooky zählt nur einen Splitter (71 statt 426 DPS). Das Luft-Tempo des Trägers (8) kommt wie bei der MVP-Luft aus develop (`Air.MaxAirspeed`).
- **Sael-Identitäts-Gate:** Hauptwaffen-Reichweite ≥ Vorbild, Schild-Anteil mobiler T4 ≥ 25 %, Strukturen HP/Mass < Vorbild (A6). Alle fünf bestehen.
- **Fehlende Post-MVP-Mechaniken** werden nicht über das Band hinaus kompensiert (faction.md §9.3): Die Anti-Marine-Waffen der Referenzen (Wasserbomben) zählen nicht, weil sie nur mit U17/U18 Ziele haben; sie sind beim Ammonit als U18-Eigenheit markiert.
- **Kein Kreuz-Gate gegen Varkan:** Varkan hat noch keine T4. `balance.crossInfo` hält die T4 der Varkan-Vorbild-Fraktion als Info fest (`UEL0401` mobile Fabrik, `UES0401` Träger, `UEB2401` Fernartillerie). Sobald Varkan-T4 existieren, kommt ein Kreuz-Treffer-Check wie `roster.md` §14 dazu.

| Großschale | Referenz | ΔDPS/Mass Boden | ΔDPS/Mass Luft | ΔHP/Mass | ΔProdukt | Pulk | Sael-Identität |
|---|---|---|---|---|---|---|---|
| Karkinos | `UAL0401` | +5,6 % | – | +2,0 % | +7,7 % | – | RW 42 ≥ 40 · Schild 25 % |
| Ammonit | `UAS0401` | ±0 % | – | +3,3 % | +3,3 % | – | RW 158 ≥ 150 · Schild 29 % |
| Pelikan | `UAA0310` | −0,9 % | ±0 % | ±0 % | −0,9 % | – | RW 30 = 30 · Schild 49 % |
| Kreuzsee | `XAB2307` | ±0 % | – | −10,0 % | −10,0 % | ±0 % | zerbrechlicher (A6) |
| Perle | `XAB1401` | – | – | −10,0 % | – | – | zerbrechlicher (A6) |

**develop-Stand:** Nach 3810 hat FAF den Träger um 5 % verbilligt (42.750 Mass, Schild-Regen 240/s) und die Schiffskanone der Festungs-Referenz verstärkt (10.000 / 11 s, Mass 25.000). Das Roster bleibt wie alle Kern-Einheiten auf 3810; beide Deltas stehen in `conventions.faT4DevelopCheck` und werden gemeinsam mit dem Kern vor dem Einbau nachgezogen.

### 2.7 Größe, sizeClass und Setons-Brücke

- **Setons-Brücke:** Die engste Stelle der Landbrücke ist 72–80 WU breit (`packages/formats/scripts/mapgen-setons.ts`, Brückenhals). Gemeinsames Gate mit Skarn und Aurith: **72 WU mit mindestens 6 T4 nebeneinander**, also Außenmaß (größtes von Breite, Beinspanne, kurzer Footprint-Kante) ≤ 12 WU. Keine Großschale verstopft die Brücke allein.
- **sizeClass = ceil(Außenmaß ÷ 2)** wie Aurith (Clearance-Radius, PLAN Navigation/Grids: Anfrage der Größenklasse s verlangt Clearance ≥ s). Beide Land-Großschalen haben sizeClass 5; Passierbarkeit und Steering (M5/M7) brauchen dafür einen eigenen Clearance-Layer (§9).

| Großschale | Footprint | L × B × H (WU) | Beinspanne | sizeClass | nebeneinander auf 72 WU |
|---|---|---|---|---|---|
| Karkinos | 4 × 4 | 5,2 × 6,4 × 5,0 | 8,4 | 5 | 8 |
| Ammonit | 8 × 8 | 11,0 × 9,0 × 4,6 | – | 5 | 8 |
| Pelikan | 16 × 16 (Landefläche, Auswahl, Wrack) | 14,0 × 20,0 × 4,0 | – | 0 (Luft) | – (fliegt) |
| Kreuzsee | 10 × 10 | 10 × 10 × 9,0 | – | – (Gebäude) | – |
| Perle | 8 × 8 | 8 × 8 × 6,5 | – | – (Gebäude) | – |

Der Ammonit braucht die Brücke mit M13 nicht: Er schwebt über das Wasser daneben.

### 2.8 Hotbuild (fraktionsübergreifend)

Kustos und Prior bekommen im Bau-Menü einen **T4-Tab** (C8), gleiche Taste = gleiche T4-Rolle in jeder Fraktion (Vorschlag Skarn): **Q** Land-Sturm (Karkinos), **W** Artillerie/Game-Ender (Kreuzsee), **E** Land-Schwer mit Fabrik (Ammonit), **R** Luft (Pelikan), **T** Eco (Perle). In `roster.json` → `hotbuildGrid["Bau (T4-Tab, Post-MVP)"]`.

### 2.9 Audio

Es gelten Sael-Klang und -Regeln (faction.md §8): weit, hallig, Klangschale statt Chor. Vor jeder Quittung kommen **vier Klangschalen-Töne** (Tech-Regel: Zahl der Töne = Stufe, T4 = 4), Tonlage nach Rollenfamilie. Die Schalenstimme der Großschalen ist tiefer und langsamer als im Kern, bleibt aber bei höchstens drei Wörtern.

| Anlass | DE | EN |
|---|---|---|
| Karkinos Auswahl | *vier Töne (mittel)* „Die Schale schreitet.“ | *four tones (mid)* „The shell strides.“ |
| Ammonit Auswahl | *vier Töne (mittel)* „Windung hält.“ | *four tones (mid)* „The coil holds.“ |
| Pelikan Auswahl | *vier Töne (gleitend)* „Über der Flut.“ | *four tones (glide)* „Above the flood.“ |
| Kreuzsee Feuer | *vier Töne (tief)* „Die See kreuzt.“ | *four tones (low)* „The sea crosses.“ |
| Perle fertig | Klangschale, lang ausklingend, Pfortenstimme: „Die Perle ist gewachsen.“ | „The pearl has grown.“ |
| Alert (P8, eigene Seite) | „Großschale geschichtet.“ | „Great shell layered.“ |
| Alert (Gegner, fraktionsneutral) | „Experimental gesichtet.“ | „Experimental sighted.“ |

SFX: Karkinos-Schritt als trockenes, schweres Klicken mit langem Hall; Ammonit-Druckbrummen eine Oktave unter dem Triton; Pelikan-Senkstoß als tiefer Glasschlag mit Gischt; Kreuzsee-Abschuss als Wellenschlag, im Flug ein Sirren, Splittereinschläge als prasselnde Metalltropfen im Kreuzmuster; Perlsprung der Perle wie der Prior-Perlsprung, aber eine Quinte tiefer und doppelt so lang (P14).

---

## 3. Karkinos / Karkinos (`f3:exp_lnd_assault`)

**Rolle:** Riesen-Sturmläufer / Colossal Assault Walker. Vorbild-Rolle: amphibischer Riesen-Sturmläufer mit Frontstrahl (`UAL0401`, dev-only). Kandidat für **U16** (erstes Land-Experimental des Ordens).

**Flavor (`descKey`):** „Schreitet durch jede Linie und hält, was sie trifft. Wo der Karkinos steht, schließt sich die Schale.“

| Wert | Karkinos | Vorbild (3810) |
|---|---|---|
| Kosten | 27.500 Mass · 343.750 Energy · BT 51.500 | gleich |
| HP | 76.000 Rumpf + 26.000 Personal-Schild = **102.000** (Regen 10/s) | 99.999 (Regen 10/s) |
| Schild (K10) | 26.000, Regen 90/s ab 3 s, Neuaufbau 60 s, 150 E/s | – |
| Waffen | **Tiefenlanze** 1.200 alle 0,5 s = 2.400 DPS, RW 2–42, Splash 0,5 · **Scherenlanzen** 2 × 60 alle 0,5 s = 240 DPS, RW 30 | Dauerstrahl 2.500 DPS, RW 40 · zwei Greifklauen, RW 30 |
| Tempo | 2,4 (Wende 40°/s) | 2,4 |
| Sicht | 50 | 50 |
| Todeswaffe | Schalenbruch 8.000 im Radius 7 | 8.000 im Radius 7 |
| Footprint | 4 × 4, sizeClass 5, Beinspanne 8,4 WU | – |

**Besonderheiten:**
- **Einzelstoß statt Strahl:** gleicher DPS in großen Stößen (−4 %), RW +5 %. Tötet einen Triton in 3, einen Einsiedler in 4 Stößen; gegen T1-Schwärme verfällt Schaden (gewollter Overkill, Konter: Masse und Luft).
- **Scherenlanzen statt Greifklauen:** Das Vorbild greift Einheiten und zerdrückt sie. Sael greift nicht, sondern sticht mit zwei kurzen Lanzen aus den Scherenschalen auf nahe Ziele (eigenes Anti-Raider-Werkzeug, +240 DPS, im Band).
- **Keine Flugabwehr:** wie das Vorbild verwundbar aus der Luft. Begleitung durch Diadem, Hochlilie oder Pelikan nötig.
- **Amphibisch (M13):** schreitet über den Grund von Wasser, feuert dort nicht.
- **Wrack:** 90 % Mass (K5), das größte Reclaim-Feld des Ordens.

**Post-MVP:** U16, K10 (Personal-Schild; Fallback HP + Schild = 102.000), M13, K5, P14.

**Kitbash:** Flach gewölbter, teamfarbener Rückenschild mit Goldrand (6,4 × 5,2 WU, breiter als lang) auf 10 spitzen Beinen (5 Paare, Knie über dem Schildrand). Vorn zwei geschlossene Scherenschalen (teamfarben, innen Perlmutt) auf kurzen Armen, aus jeder ragt eine kurze Lanze. Auf dem Schildscheitel die teamfarbene Perle (Ø 1,5 WU) mit zwei parallelen Lanzen (3,6 WU, 1,2 WU über den Schildrand). Unterseite Tiefjade-Bauchschale, zwei Tiefjade-Klammerbögen am hinteren Schildrand. Ab K10 liegt die Schildhülle als flaches Ellipsoid über dem Rückenschild. **Monopol:** Scherenschild. **Silhouetten-Pflichtpaar:** Karkinos ↔ Einsiedler (gleiche Familie, klar größer, Scheren statt gewundener Schale).

---

## 4. Ammonit / Ammonite (`f3:exp_lnd_fortress`)

**Rolle:** Schwebende Festung / Hover Fortress. Vorbild-Rolle: tauchendes Schlachtschiff mit Fabrik (`UAS0401`, dev-only), bei Sael als Schweber auf Land und Wasser.

**Flavor:** „Trägt ein Kapitel über die Tiefe und schichtet am anderen Ufer weiter. Die Windung hält, was die Welle bringt.“

| Wert | Ammonit | Vorbild (3810) |
|---|---|---|
| Kosten | 24.000 Mass · 380.000 Energy · BT 38.400 | gleich |
| HP | 44.000 Rumpf + 18.000 Personal-Schild = **62.000** | 60.000 |
| Schild (K10) | 18.000, Regen 60/s ab 3 s, Neuaufbau 60 s, 100 E/s | – |
| Waffe | **Gezeitenlanze** 8.000 alle 10 s = 800 DPS, RW 10–158, Splash 5, langsames Geschoss (mv 35), Streuung 0,2 | Schiffskanone 8.000 / 10 s, RW 150 (dazu Wasserbomben gegen Marine) |
| Fabrik | Build Power 225, Landkapitel-Liste T1–T3 (nur Schweber und Engineers) | Build Power 225 (Marine) |
| Tempo | 2,5, Schwebehöhe 0,6 WU | 2,5 (taucht) |
| Intel | Sicht 60, Radar 150 | Sicht 100, Radar 148, Sonar |
| Todeswaffe | Spiralbruch 6.000 im Radius 8 | – |
| Footprint | 8 × 8, sizeClass 5 | – |

**Besonderheiten:**
- **Präzision auf Überlänge:** Ein Stoß tötet jede T3-Landeinheit (Einsiedler 4.700, Woge 950) und nimmt einem Perlmutt II fast drei Viertel seines Schildes. Gegen Schwärme und bewegte Ziele schwach (Flugzeit, 10 s Nachladen).
- **Schwimmendes Kapitel:** baut Schweber und Engineers unterwegs (B3-Erweiterung), Ausstoß durch das Kapiteltor am Heck. Mit M13 die einzige Sael-Großschale, die eine Armee über Wasser in die Flanke trägt.
- **Schweben statt Tauchen:** Das Vorbild ist unter Wasser nur mit Torpedos angreifbar. Der Ammonit ist immer sichtbar und angreifbar; dafür trägt er den Personal-Schild.
- **Keine Flugabwehr** (wie das Vorbild): Luftdeckung durch Pelikan oder Diadem.

**Post-MVP:** U21, M13 (schwebt über Wasser), K10, B3-Erweiterung (mobile Produktion, gemeinsam mit Skarn-Assel und Aurith-Ensemble), I3, U18 (Tiefenstachel gegen Marine, nur mit U17/U18), P14.

**Kitbash:** Dunkler Schwebeteller (Schattensaum 10 %), darauf drei liegende Schalenwindungen (Ø 9 → 5 → 2,5 WU), die sich zur Mündung hin öffnen (teamfarbene Emaille, Goldkanten an den Windungsnähten). In der Mündung die Perle (Ø 1,8 WU) mit der Gezeitenlanze (13,5 WU, ragt 4 WU über den Bug, ≥ 1,2 × Rumpflänge wie beim Konus). Über der innersten Windung ein waagerechter Schildring, am Heck ein niedriges, goldenes Kapiteltor mit Goldkern. **Monopol:** liegende Spiralschale. **Silhouetten-Pflichtpaare:** Ammonit ↔ Konus (gleiche Präzisions-Lanze, Spirale statt schmaler Schale), Ammonit ↔ Karkinos (Schwebeteller gegen Beine).

---

## 5. Pelikan / Pelican (`f3:exp_air_carrier`)

**Rolle:** Schwebeträger / Hover Carrier. Vorbild-Rolle: fliegender Träger mit Senkstrahl, Blasen-Schild und Fabrik (`UAA0310`, dev-only).

**Flavor:** „Schwebt über der Basis, die fallen soll, und lässt nichts darunter stehen. Im Kehlsack trägt er seine Brut.“

| Wert | Pelikan | Vorbild (3810) |
|---|---|---|
| Kosten | 45.000 Mass · 1.530.000 Energy · BT 50.625 | gleich |
| HP | 36.000 Rumpf (Regen 15/s) + 34.000 Blasen-Schild = **70.000** | 40.000 + 30.000 Schild |
| Schild (K10) | Blase Radius 22, 34.000, Regen 180/s ab 2 s, Neuaufbau 120 s, 500 E/s | Radius 26, 30.000, Regen 180/s |
| Waffen | **Senkstoß** 1.650 alle 0,5 s = 3.300 DPS, RW 30, Splash 4, nur Ziele unter sich · **Himmelsstachel** 4 × 300 / 1,3 s = 923 DPS, RW 120 (Luft) · **Sprengstachel** 4 × 240 / 0,5 s = 1.920 DPS, RW 44, Splash 3 (Luft) | Senkstrahl 3.330 DPS, RW 30 · Luftabwehr 923 + 1.920 DPS |
| Fabrik und Hangar | Build Power 180, Luftkapitel-Liste T1–T2; Kehlsack-Hangar für 40 Flieger T1–T2 | Build Power 180, Hangar |
| Tempo | 8 (Luft), Wende 20°/s | 8 (develop) |
| Intel | Sicht 70, Radar 200 | Sicht 70, Radar 200, Sonar |
| Todeswaffe | Absturz 7.000 im Radius 15 (K12) | 7.000 im Radius 15 |
| Footprint | 16 × 16 (Landefläche), sizeClass 0 | 20 × 20 |

**Besonderheiten:**
- **Senkstoß statt Senkstrahl:** gleicher DPS in großen Stößen (−1 %). Ein Brunnen III (6.600 HP) fällt in 4 Stößen (2 s), ein Landkapitel III (13.000) in 8 Stößen (4 s), eine Sintflut (8.000) in 5.
- **Kleiner, stärker Schild (A5):** +13 % Schild-HP bei −15 % Radius. Schützt den Pelikan und einen engen Kreis darunter; Jäger, die unter den Schildrand fliegen, treffen den Rumpf direkt.
- **Starke Flugabwehr wie das Vorbild:** 2.843 Luft-DPS. Konter sind Hochlilien-Stellungen (Einzelschuss 600), Konus-Stöße und Jäger in großer Zahl gegen den Rumpf.
- **Keine Lanze, keine Perle:** Luftfahrzeuge zeigen Rolle und Richtung über den Grundriss (faction.md §5.2); die Waffe ist der Kehlsack.

**Post-MVP:** U21, U12 (Flugmodell der schweren Luft, Schweben über dem Ziel), K10 (Blasen-Schild; Fallback: HP + Schild als HP, kein Schutz für andere), B3-Erweiterung, U13 (Hangar), U20 (Reparatur und Treibstoff im Hangar), K12 (Absturzschaden), I3, P14.

**Kitbash:** Zwei teamfarbene Ovalschwingen-Hälften mit Goldkante (Spannweite 20 WU, Tiefe 9 WU, keine Pfeilung), mittig eine hochgewölbte Rückenkuppel aus Perlmutt, um sie ein waagerechter Schildring (Ø 7 WU, dreht langsam). Darunter hängt der teamfarbene Kehlsack (9 WU lang, ragt vorn 1 WU über die Schwinge), an seinem Heck das goldene Hangartor mit Goldkern. Vor jedem Senkstoß leuchtet die Kehlsack-Unterseite 0,5 s jadefarben auf (Lichtnaht, kein Goldkern). **Monopol:** Kehlsack-Schwinge. **Silhouetten-Pflichtpaar:** Pelikan ↔ Tölpel (gleiche Familie „Ovalschwinge + Bauch-Gondel“; Pelikan mit Kuppel, Ring und 5-facher Spannweite).

---

## 6. Kreuzsee / Cross Sea (`f3:exp_str_arty`) · Game-Ender

**Rolle:** Fernartillerie / Strategic Artillery. Vorbild-Rolle: Schnellfeuer-Fernartillerie mit Splittergranaten (`XAB2307`, dev-only), Gegenprobe der Varkan-Vorbild-Fraktion `UEB2401` (schwere Einzelschuss-Fernartillerie, Info).

**Flavor:** „Wo zwei Seen sich kreuzen, hält kein Schiff. Die Kreuzsee bringt den Seegang in jede Basis der Karte.“

| Wert | Kreuzsee | Vorbild (3810 + develop) |
|---|---|---|
| Kosten | 202.500 Mass · 5.400.000 Energy · BT 100.000 | gleich |
| HP | **8.100** | 9.000 |
| Waffe | **Kreuzseegranate**: 6 Splitter à 220 alle 3,1 s = 425,8 DPS, RW 150–1.500, Splash 2 je Splitter, Streukreis 7 WU, mv 150, Streuung 0,20 | 6 × 220 / 3,1 s, RW 150–4.000, Streuung 0,25 |
| Energie | 15.000 pro Schuss (Dauerfeuer ≈ 4.840 E/s ≈ 2 Laternen III) | 15.000 pro Schuss |
| Sicht | 28 | 28 |
| Todeswaffe | Hornbruch 4.000 im Radius 10 | – |
| Footprint | 10 × 10 | 7 × 7 (Rand 10 × 10) |

**Besonderheiten:**
- **Kartenweit auf allen Karten bis 1.024 WU:** RW 1.500 deckt die Setons-Diagonale (1.448 WU). Das Vorbild hat RW 4.000 für 20–81-km-Karten; das eigene T4-Reichweiten-Gate ersetzt das Kern-Gate der Sintflut (≤ 40 % der kleinsten Kartendiagonale), weil ein Game-Ender die Karte abdecken muss.
- **Dauerlast statt Burst:** 1.320 Schaden pro Granate brechen Schilde durch Dauerfeuer. Ein Perlmutt III (18.000, Regen 150/s) fällt bei Dauerfeuer in ≈ 65 s, ein Perlmutt II (11.200, Regen 138/s) in ≈ 39 s. Gegen die Einzelschuss-Referenz der Varkan-Vorbild-Fraktion (16.000 alle 8 s) ist die Kreuzsee flächiger und schildfreundlicher, aber schwächer gegen einzelne harte Ziele.
- **Präzision (A4):** Streuung 0,20 statt 0,25; die Splitter fallen auf zwei gekreuzte Bögen (Name, Telegraph auf der Minimap).
- **Stall = Feuerpause (E3):** 15.000 E pro Schuss. Wer die Energie des Gegners trifft, bringt die Kreuzsee zum Schweigen.
- **Zerbrechlich (A6):** 8.100 HP für 202.500 Mass. Pelikan-Senkstoß: 5 Stöße; Karkinos: 7 Stöße.

**Post-MVP:** U21, K13, K2, K4, K1-Erweiterung (Splittergeschoss; Fallback: Salve aus 6 Einzelgranaten mit Streukreis 7 WU über die vorhandene K1-Streuung, gleiche Pulk-Rechnung), E3 (Energie pro Schuss), I3 (Zielaufklärung), K14, P14.

**Kitbash:** Teamfarbener Kissen-Sockel über den ganzen 10 × 10-Footprint, darauf eine niedrige Lafette (dreht), die den Hornkranz trägt: drei Hörner (je 6 WU, Mündung Ø 2,4 WU, Goldkante an der Mündung) um eine gemeinsame Achse unter 50°, die sich nach jedem Schuss um 120° weiterdreht. Hinten eine hohe Gegenschale (8 WU), unter der Lafette die Tiefjade-Kammerschale. Die jeweils feuernde Mündung leuchtet 0,5 s vorher jadefarben. Keine Perle, keine Lanze, keine Laterne. **Monopol:** Hornkranz. **Silhouetten-Pflichtpaar:** Kreuzsee ↔ Sintflut (ein großes Horn gegen drei als Trommel).

---

## 7. Perle / Pearl (`f3:exp_str_eco`) · Eco

**Rolle:** Ressourcenperle / Resource Pearl. Vorbild-Rolle: Ressourcen-Generator mit Bedarfsdeckung (`XAB1401`, dev-only).

**Flavor:** „Die Perle gibt, was das Kapitel verlangt, nicht mehr. Wer sie sprengt, sprengt alles um sie.“

| Wert | Perle | Vorbild (3810 + develop-Skript) |
|---|---|---|
| Kosten | 250.200 Mass · 7.506.000 Energy · BT 325.000 | gleich |
| HP | **4.500** | 5.000 |
| Ertrag | Grundertrag 20 M/s + 1.000 E/s; deckt jeden Mehrbedarf des Kapitels bis 10.000 M/s bzw. 1.000.000 E/s | gleiches Modell (Skript) |
| Speicher | Energy 100.000 | 100.000 |
| Sicht | 14 | 14 |
| Todeswaffe | **Perlsprung** 35.000 im Radius 25 | 35.000 im Radius 25 |
| Footprint | 8 × 8 | 7 × 7 |

**Besonderheiten:**
- **Bedarfsdeckung statt fester Ertrag:** Der Grundertrag ersetzt nur ≈ 7.300 Mass an Brunnen-Ketten und Laternen III (2,9 % der Kosten). Der Wert liegt im gedeckten Mehrbedarf: Bei ≈ 417 M/s Mehrbedarf amortisiert sich die Perle in 10 Minuten. Lore und Mechanik passen zusammen: „Der Orden nimmt nur, was er halten kann“ (faction.md §2.2, Maß).
- **Zerbrechlich (A6):** 4.500 HP. Drei Pelikan-Senkstöße, ein Ammonit-Stoß, vier Kreuzsee-Granaten.
- **Perlsprung:** Wie der Prior-Perlsprung, aber mit 35.000 Schaden im Radius 25 vernichtet er jede eigene Basis ringsum. Nie neben Kapitel oder Laternen setzen.
- **Energy-Stall:** Der Goldkern der Riesenperle verblasst zu Perlgrau (faction.md §3.5), obwohl die Perle selbst Energie liefert: Sie zeigt den Stall des Kapitels an.

**Post-MVP:** U21, E17 (Endgame-Eco: Grundertrag plus Bedarfsdeckung), E4 (Speicher), K14 (Todeswaffe), P14.

**Kitbash:** Teamfarbener Kissen-Sockel (8 × 8), darauf die untere Muschelschale (Perlmutt innen, Schalenrinde außen), die obere Schale 40° aufgeklappt (öffnet sich beim Bau schichtweise, nur View). Dazwischen schwebt die Riesenperle (Ø 3,2 WU) mit Goldkern, **umschlossen** von beiden Schalen (Flow-Ausnahme faction.md §5.3 Nr. 6). Über ihr kreist ein flacher Goldring. **Monopol:** offene Muschel mit Riesenperle. **Silhouetten-Pflichtpaar:** Perle ↔ Brunnen III (Ring und Kelch gegen Muschel und Perle).

---

## 8. Silhouetten-Pflichtpaare (T4)

In `roster.json` → `silhouettePairs.t4`, Abnahme wie §5.3 (5 Tester, 5 von 5, Graustufen-Aufsicht bei 60 WU):

| Paar | Unterscheidung |
|---|---|
| Karkinos ↔ Einsiedler | Scherenschalen und 10 Beine gegen gewundene Schale und 8 Beine; Maßstab 3× |
| Ammonit ↔ Konus | Spiralschale auf großem Teller gegen schmale, lange Schale; beide mit Überlänge-Lanze (gleiche Rolle Präzision) |
| Karkinos ↔ Ammonit | Beine gegen Schwebeteller (Gangart-Regel §5.1 Nr. 3) |
| Pelikan ↔ Tölpel | Kuppel mit Schildring und Hangartor gegen schlichte Ovalschwinge |
| Kreuzsee ↔ Sintflut | Hornkranz (3 Hörner) gegen ein großes Horn |
| Perle ↔ Brunnen III | offene Muschel mit Riesenperle gegen Ring und Kelch |

---

## 9. Benötigte Post-MVP-Features (Zusammenfassung)

| Feature | Karkinos | Ammonit | Pelikan | Kreuzsee | Perle |
|---|---|---|---|---|---|
| **U16** Erstes Land-Experimental | ● | | | | |
| **U21** Volles Experimental-Roster & Game-Ender | | ● | ● | ● | ● |
| **K10** Schilde (Personal/Blase) | ● | ● | ● | | |
| **M13** Wasser-Layer (Amphibisch/Hover) | ● | ● | | | |
| **B3-Erweiterung** mobile Produktion (neue ID nötig, gemeinsam mit Skarn und Aurith) | | ● | ● | | |
| **U12** schwere Luft, **U13** Hangar, **U20** Air Staging, **K12** Absturz | | | ● | | |
| **K13**, **K2**, **K4**, **E3** (Energie pro Schuss) | | | | ● | |
| **K1-Erweiterung** Splittergeschoss (neue ID oder Teil der Strahl-Entscheidung in K1) | | | | ● | |
| **E17** Endgame-Eco, **E4** Speicher | | | | | ● |
| **K5** großes Wrack, **K14** Todeswaffen, **P14** Großereignis | K5, P14 | P14 | P14 | K14, P14 | K14, P14 |
| **I3** Radar | | ● | ● | ● | |
| **U18** Tiefenstachel gegen Marine (nur mit U17) | | ○ | | | |

● = braucht die Einheit, ○ = nur Zusatz-Eigenheit. **Keine Großschale braucht eine Strahlwaffe:** Beide Strahl-Vorbilder (Sturmläufer, Träger) werden als Einzelstöße mit gleichem DPS umgesetzt. Die Asymmetrien des Kerns (faction.md §9.3) bleiben unberührt.

---

## 10. Offene Punkte

1. **develop nachziehen** (gemeinsam mit dem Kern vor dem Einbau): Pelikan-Kosten −5 % (42.750 Mass) und Schild-Regen 240/s, Ammonit auf 10.000 / 11 s bei 25.000 Mass (`conventions.faT4DevelopCheck`).
2. **Feature-ID für mobile Produktion** (`B3-Erweiterung`, Ammonit, Pelikan, Skarn-Assel, Aurith-Ensemble) in `features.json` anlegen.
3. **sizeClass 5 und T4-Clearance-Layer** in Nav (M5/M7) mit Skarn und Aurith abstimmen: Aurith rechnet `ceil(Außenmaß ÷ 2)` wie hier, Skarn setzt pauschal 3.
4. **Reichweiten-Gate für Game-Ender:** RW 1.500 reicht für alle Karten bis 1.024 WU. Für große Karten (M14) muss der Deckel mit den Game-Endern der anderen Fraktionen gemeinsam festgelegt werden (Skarn: 4.000).
5. **Kreuz-Checks gegen Varkan-T4**, sobald Varkan Experimentals hat (Treffer bis Tod T4 gegen T4 und T4 gegen Perlmutt/Schirm).
6. **Fraktionsübersicht** (`../README.md` §7) um die T4-Spalte ergänzen, sobald alle vier Fraktionen ihre T4 festgelegt haben (gemeinsamer Durchgang, weil die Datei fraktionsübergreifend ist).
7. **Tester-Abnahme** der Silhouetten-Paare (§8) mit dem Sael-Modellsatz; erst dann wird der Tech-Marker (Klammerbögen) eingefroren.
