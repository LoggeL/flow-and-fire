# Aurith-Chor: Experimentals (T4, Post-MVP)

> **Status:** Designkonzept für U16 („Erstes Land-Experimental“) und U21 („Volles Experimental-Roster & Game-Ender“), dazu E17 (Endgame-Eco). Stand 2026-09-29. Nichts davon ist MVP: Die Einheiten sind erst baubar, wenn die in §8 genannten Features existieren.
> **Quelle der Zahlen:** `roster.json` → Schlüssel `experimentals` (5 Einträge, `tier: T4`, `postMvp: true`), erzeugt mit `tools/roster/f4/gen.py` aus `tools/roster/f4/exp.py` und geprüft mit `tools/roster/f4/validate.py`. Lesbare Tabelle in `roster.md` §21. Bei Widerspruch gilt `roster.json`.
> **Abgrenzung:** Die Rollen lehnen sich an die T4-Rollen der Vorbild-Fraktion an (Sturmläufer, Bomber, Strategiewerfer). Namen, Formen, Waffen und Mechanik-Details sind eigenständig. FA-Einheiten werden nur über ihre Blueprint-ID genannt (dev-only, `faReference`). Die MVP-Zählung (49 Blueprints, 26 ●, 28 Visuals) bleibt unverändert.

---

## 1. Überblick

| ID | Name DE / EN | Rolle | Domäne | Vorbild-Rolle (BP, dev-only) | Hotbuild (T4-Tab) | Icon |
|---|---|---|---|---|---|---|
| `f4:exp_assault` | **Hymne** / Hymn | Experimenteller Sturmläufer | Land | Sturmläufer `XSL0401` | Q | `land_bot_t4` |
| `f4:exp_mobile_fac` | **Ensemble** / Ensemble | Wandernde Halle (mobile Fabrik mit Schild und Artillerie) | Land | mobile Fabrik `UEL0401` (Fremdreferenz) | W | `land_arty_t4` |
| `f4:exp_air_bomber` | **Heupferd** / Katydid | Experimenteller Bomber (mit starker Flugabwehr) | Luft | Bomber `XSA0402` | R | `air_bomb_t4` |
| `f4:exp_strat_missile` | **Tuba** / Tuba | Experimenteller Strategiewerfer (Game-Ender) | Struktur | Strategiewerfer `XSB2401` | V | `struct_mml_t4` |
| `f4:exp_resource` | **Klangschale** / Singing Bowl | Experimenteller Resonanzgenerator (Eco) | Struktur | Ressourcengenerator `XAB1401` (Fremdreferenz) | T | `struct_mass_t4` |

**Mischung:** 2 × Land, 1 × Luft, 1 × Game-Ender, 1 × Eco. Die Vorbild-Fraktion hat genau drei T4 (Land, Luft, Strategiewerfer). Für die mobile Fabrik und das Eco-Experimental nimmt das Roster wie im MVP eine andere FA-Fraktion als Referenz (`faction.md` §9.1) und markiert das im Feld `faReference.kind`.

**Warum diese fünf:** Sie tragen die Spielidentität der Fraktion („wenige, große, vielseitige Einheiten“, `faction.md` §9.1) bis ins T4-Spiel:
- **Hymne** ist der Mehrklang im Großen: Strahl, Doppelgabel, Trichter und Pfeifen in einem Körper, jeder schwere Schuss sichtbar geladen.
- **Ensemble** verbindet die Weltregel „Gesungene Form“ (alles wird vor Ort gesungen) mit der Schild-Stärke der Fraktion: eine Halle, die mitläuft.
- **Heupferd** setzt „Luft schwer statt schnell“ (A10) fort: langsamer, schwerere Bombe, eigene Flugabwehr.
- **Tuba** ist der Game-Ender mit Aurith-Signatur: Der Einschlag ist 3 s vorher am Ziel sichtbar.
- **Klangschale** ist das Eco-Experimental mit einer eigenen Schwäche: Es muss sich erst einschwingen.

---

## 2. FA-Relationen (Recherche)

Werte der Referenz-Blueprints aus FAForever/spooky-db `app/data/index.json` (Datenstand 3810, derselbe wie das MVP-Roster), DPS nach `app/js/dps.js` mit `WeaponNumber`. Felder, die spooky-db nicht führt, stammen aus FAForever/fa `develop` (`*_unit.bp`, `*_proj.bp`, abgerufen 2026-09-29) und dem FAF-Änderungsverlauf. Extraktion: `tools/roster/f4/ref_t4.py` → `fa_ref_t4.json` (dev-only, nur Zahlen).

| BP (dev-only) | Mass | Energy | buildTime | HP (+Schild) | Tempo | Boden-DPS | Luft-DPS | RW | Besonderheit (Relation) |
|---|---|---|---|---|---|---|---|---|---|
| `XSL0401` | 26.500 | 330.000 | 46.875 | 67.000, Regen 20 | 2,5 | 3.794 | 188 | 47 | vier Waffen (Strahl 6.000/5 s, Schnellfeuer 610 × 3,3/s, Splash-Kanone 1.850/3,3 s, Flak); Tod 7.000/6, danach ein bewegliches Energiewesen (100 HP, 30 s, 1.000 × 3,3/s, RW 20, trifft Freund und Feind); amphibisch; Footprint 3 × 3, Höhe 7,5 |
| `XSA0402` | 48.000 | 1.920.000 | 67.500 | 52.000, Regen 25 | 18 | 786 (Bombe 11.000 / 14 s, Radius 19) | 1.800 (4 × 450/s, RW 64) | 90 | Absturz 8.000/10; Spannweite 13 WU |
| `XSB2401` | 187.650 | 10.008.000 | 250.000 | 12.000 | – | – | – | Karte | Rakete 600 M / 6.000 E, buildTime 129.600 bei Build Power 2.160 = 60 s, Lager 1, Start leer; Innenring 1.000.001 / 45, Außenring 7.500 / 60; Tod 20.000/15 + 5.000/20; Footprint 5 × 5 |
| `UEL0401` | 28.000 | 350.000 | 47.500 | 12.500 + 20.000 | 1,75 | 4.000 (Artillerie 3.000, RW 100; Nahwaffe 1.000, RW 45) | 114 | 100 | Build Power 135, baut T1–T3-Land in Bewegung; Schild Radius 25, Regen 100/s; 600 E/s Unterhalt; amphibisch |
| `XAB1401` | 250.200 | 7.506.000 | 325.000 | 5.000 | – | – | – | – | Ertrag folgt dem Verbrauch, in FAF höchstens 4.000 M/s und 400.000 E/s (vorher 10.000 / 1.000.000); Lager 10.000 M / 100.000 E; Tod 35.000/25; Footprint 7 × 7 |

**Übernommene Relationen:** T4-Land kostet ≈ 5 × die eigene Grundhalle III (Mass), der Bomber ≈ 1,8 × ein Land-T4, der Game-Ender ≈ 7 × ein Land-T4, das Eco-T4 ≈ 9,4 ×. Die Aurith-Werte liegen je Achse innerhalb ±15 % dieser Relationen (§7).

---

## 3. Gemeinsame T4-Regeln der Fraktion

### 3.1 Bau und Wirtschaft

- **Großgesang:** T4 werden wie im Vorbild vor Ort von Engineers gebaut, nicht in einer Halle: Baubar für den Vorsänger (`ENGINEER & TECH3`) und den Kantor erst mit T3-Upgrade (U14). Lore: Viele Vorsänger halten denselben Ton, bis die Form steht. Der Rohbau zeigt die Kristallisation von außen nach innen (`faction.md` §3.5), bei T4 mit zusätzlichem Klangfaden-Geflecht zwischen allen assistierenden Engineers (nur View).
- **Bauzeit** (FA-Semantik, Sekunden = buildTime ÷ Build Power): Hymne 46.875 ÷ (10 Vorsänger × 32) ≈ 146 s, Heupferd ≈ 211 s, Tuba ≈ 781 s, Klangschale ≈ 1.016 s. Das entspricht dem Vorbild 1:1, weil buildTime (bis auf die Tuba) identisch ist.
- **Hotbuild:** eigener Tab „Bau (T4-Tab)“ wie bei f2. Gleiche Taste = gleiche Rolle, soweit die Fraktionen dieselbe Rolle haben: Q Sturmläufer, W Artillerie (Ensemble, Icon Artillerie), R Luft, T Eco; V Strategiewerfer (wie V = Artilleriestellung im Bau-Menü). E bleibt bei Aurith frei (f2: Brutläufer).

### 3.2 Form und Kitbash

- **Formsprache bleibt:** Kurve = Körper, Gerade = Waffe; Kiel = Gleiter, Dreibein = Läufer; Winkel-Code unverändert (waagerecht = direkt, schräg 45–60° = indirekt, senkrecht ≥ 75° = Flugabwehr). Resonanz-Monopol: Kristalle und Glühkern nur bei Flow-Einheiten (hier Ensemble als FACTORY, Klangschale als ECONOMIC). Keine Perlglas-Sichel an T4.
- **Hybrid-Regel für T4:** T4 dürfen bis zu drei Rollenmerkmale tragen. Jedes Merkmal behält seine Bedeutung, das jeweils nächstwichtige ist höchstens 1 ÷ 1,5 so groß (Länge bzw. Ø) wie das vorige (Erweiterung von `faction.md` §5.3).
- **Tech-Markierung:** keine Tonpunkte. T4 erkennt man an der Größe (Footprint ≥ 4 × 4, Höhe ≥ 5 WU, Hymne ≈ 9 WU) und im Icon an der Klammer.
- **Ein Visual je T4** (kein Superset, keine Tech-Bitmaske): 5 zusätzliche Visuals, die in einem Match nur selten gleichzeitig sichtbar sind; der Render-Bench (`../README.md` §9 Nr. 3) zählt sie getrennt.
- **Budget (Abnahmekriterium):** ≤ 10 Kitbash-Parts, davon ≤ 4 animiert (PartStream-Limit 8 bleibt frei). Tris L0/L1/L2 **1.500 / 800 / 320** (`@faf/modelkit` `T4_BUDGET`), LOD-Distanzen 120/360 WU. Die Schätzung im Roster ist die Summe der Primitive (`faction.md` §3.3) × Segmentfaktor 3, weil ein T4 bis 15 % des Bildschirms füllt und runde Primitive mit dreifacher Segmentzahl braucht.
- **Teamfarbe:** wie die Klasse (Land ≥ 30 %, Luft ≥ 45 %, Strukturen 20–30 % der Draufsicht).

### 3.3 Icons (gemeinsame Grammatik)

Grundform = Domäne, Glyphe = Rolle, **Stufe T4 = eckige Klammer um die Grundform statt Tech-Kerben** (Varkan `faction.md` §6.4), Größenfaktor 1,5. Icon-ID-Schema `<domäne>_<glyphe>_t4` wie bei f2. Aurith fügt keine Glyphe hinzu; alle fünf nutzen Tokens aus `iconGlyphs`.

| Einheit | Icon | Begründung |
|---|---|---|
| Hymne | `land_bot_t4` | Direktfeuer-Läufer wie der Brüller (`land_bot_t2`); die Flak zeigt die Info-Leiste |
| Ensemble | `land_arty_t4` | **Gefahr vor Funktion** (`faction.md` §6.2): 2.800 DPS Artillerie sind die Bedrohung; Fabrik und Schild zeigen Info-Leiste, Schildblase und Warteschlange |
| Heupferd | `air_bomb_t4` | Primärrolle Bomber; die Flugabwehr (1.600 DPS) steht in der Info-Leiste |
| Tuba | `struct_mml_t4` | Die Grammatik hat keinen Token für strategische Raketen; bis K17 steht der Doppel-Bogen (Raketenartillerie). **Vorschlag:** K17 reserviert fraktionsübergreifend einen Token `nuke`, dann `struct_nuke_t4` |
| Klangschale | `struct_mass_t4` | erzeugt Mass und Energy; die Raute steht für die knappe Ressource |

### 3.4 Setons-Brücke und Größenklasse

Die engste Stelle der Setons-Landbrücke ist ≈ 74 WU breit (`content/maps/src/setons.spec.md`); das gemeinsame Gate (wie f2) ist 72 WU mit **mindestens 6 T4 nebeneinander**, also ein Außenmaß ≤ 12 WU. Die Größenklasse folgt dem Nav-Modell (Anfrage der Größenklasse s verlangt Clearance ≥ s, PLAN Navigation/Grids): `sizeClass = ceil(Außenmaß ÷ 2)`, Schema 0–7.

| Einheit | Footprint | Außenmaß | sizeClass | nebeneinander auf 72 WU |
|---|---|---|---|---|
| Hymne | 4 × 4 | 6 WU (Dreibein-Spannweite) | 3 | 12 |
| Ensemble | 6 × 6 | 6 WU (Kiel 7 × 5, Trichter-Überstand) | 3 | 12 |
| Heupferd | 6 × 6 (Luft, sizeClass 0) | 12 WU Spannweite | 0 | – (Luft) |
| Tuba / Klangschale | 6 × 6 / 8 × 8 | Struktur | – | – |

---

## 4. Die Einheiten

### 4.1 Hymne / Hymn (`f4:exp_assault`) · Experimenteller Sturmläufer

- **Rolle:** Linienbrecher der späten Phase. Weniger, schwerere und sichtbar geladene Schüsse als das Vorbild, dafür zäher.
- **Kosten:** 26.500 Mass, 330.000 Energy, buildTime 46.875 (Vorbild identisch).
- **HP:** 72.000, Regeneration 20 HP/s (Vorbild 67.000: Δ HP/Mass **+7,5 %**).
- **Waffen** (alle RW 46; Boden-DPS 3.438, Δ DPS/Mass **−9,4 %**, Produkt **−2,6 %**):
  - `wpn_hymn_beam` **Große Schwebung**: Strahl zwischen den Brustzinken, 10 Pulse × 500 alle 5,0 s = 1.000 DPS, Splash 3, Mindest-RW 4. Hitscan-Puls nach der Strahl-Konvention des Rosters (K1-Erweiterung).
  - `wpn_hymn_fork` **Doppelgabelton**: beide Brustzinken, 2 × 560 alle 0,6 s = 1.867 DPS, linear.
  - `wpn_hymn_horn` **Stoßklang**: Schultertrichter, 2.000 alle 3,5 s = 571 DPS, Splash 6, ballistisch flach.
  - `wpn_hymn_pipes` **Pfeifenkranz**: Flugabwehr, 6 × 30 alle 1,0 s = 180 DPS, Splash 3 (Δ Luft-DPS/Mass −4 %).
  - Strahl und Stoßklang zeigen die Sammelbewegung der Glyphen 1,5 s vor dem Schuss (`faction.md` §3.5).
- **Tempo:** 2,4 WU/s (Vorbild 2,5), Drehrate 60 °/s, Sicht 50.
- **Footprint / Größe:** 4 × 4, sizeClass 3, Höhe ≈ 9 WU.
- **Tod – „Nachhall“:** Aufprall 6.000 / Radius 6, danach 20 s ein **stehendes Resonanzfeld** (Radius 14): alle 0,5 s ein Entladungsbogen mit 500 Schaden auf ein zufälliges Ziel im Feld, Freund und Feind (1.000 DPS). Eigenständige Lösung statt des beweglichen Energiewesens des Vorbilds: kein eigener Blueprint, keine steuerlose Einheit, dafür ein Ort, den beide Seiten 20 s meiden müssen. Braucht die DoT-Erweiterung von K14.
- **Post-MVP-Features:** U16, K14 (DoT-Feld), K1-Erweiterung (Strahl), M13 (amphibisch wie das Vorbild; ohne M13 nur Land), P14 (Glassturm beim Zerspringen), A16 (KI).
- **Konter:** Heerhorn (RW 88) und Großhorn (RW 200) auf Abstand, Heupferd-Bomben, Schilde gegen den Stoßklang. Keine Überreichweite: RW 46 liegt unter jeder T3-Artillerie.
- **Kitbash (9 Parts, 2 animiert, ≈ 864 Tris):** `legs` (count 3, rückwärts geknickt, Spannweite 6 WU) [body], `keel` Spindel-Torso [amber], `fork` Brustgabel ⟳ yawpitch [body], `lens` Strahllinse zwischen den Zinken [body], `horn` Schultertrichter ⟳ pitch [team außen], 2 × `pipe` (je drei gestufte senkrechte Pfeifen links und rechts auf dem Rücken), 2 × `fin` Doppelkamm [team]. Beschreibung: Riesiges Dreibein, Höhe ≈ 9 WU (3,2 × Kantor). Die waagerechte Brustgabel (Zinken 4,2 WU) ragt 1,5 WU vor die Brust, der Trichter ist höchstens 1 ÷ 1,5 so lang wie die Gabel, die Pfeifen sind höchstens halb so dick wie die Gabelzinken. Kein Kristall, keine Krone, kein Kopf, keine Arme.
- **Silhouetten-Pflichtpaare:** Hymne ↔ Kantor (beide Dreibein: Krone und Sichel gegen Doppelkamm und Pfeifen, dreifache Höhe), Hymne ↔ Brüller (Gabel auf Dreibein in zwei Größen).
- **Beschreibung (`descKey`):** „Experimenteller Sturmläufer mit Strahl, Doppelgabel, Schultertrichter und Flugabwehr. *Wenn viele Chöre einen Ton halten, geht er auf drei Beinen.*“
- **Audio:** Schritt als tiefer Paukenschlag mit Glasklirren; die Große Schwebung als anschwellender Chor-Cluster, der im Schuss in eine reine Quinte kippt; Nachhall als 20 s stehender, verstimmter Akkord.

### 4.2 Ensemble / Ensemble (`f4:exp_mobile_fac`) · Wandernde Halle

- **Rolle:** Mobile Fabrik mit großer Schildglocke und Artillerie. Die Weltregel „Gesungene Form“ als Einheit: Wo das Ensemble steht, ist die Halle. Gegenüber der Fremdreferenz Richtung Schild und Halle verschoben, weil starke Schilde eine Vorbild-Stärke der Fraktion sind (A5, A8).
- **Kosten:** 28.000 Mass, 350.000 Energy, buildTime 47.500 (Referenz identisch). Unterhalt 600 E/s für den Schild.
- **HP:** 11.000 + Schild 24.000 (Radius 26, Regeneration 130/s nach 3 s, Wiederaufbau 60 s). HP+Schild/Mass **+7,7 %** zur Referenz. Stärkster mobiler Schild der Fraktion (Stille: 9.600).
- **Waffen** (Boden-DPS 3.800, Δ DPS/Mass **−5,0 %**, Produkt **+2,3 %**):
  - `wpn_ensemble_horn` **Chorstoß**: zwei Trichter im Wechsel, 2 × 1.400 alle 1,0 s = 2.800 DPS, RW 10–90, Splash 1,5, ballistisch. Pulk-DPS/Mass **−6,7 %** zur Referenz.
  - `wpn_ensemble_fork` **Gabelkranz**: Nahabwehr, 2 × 150 alle 0,3 s = 1.000 DPS, RW 40.
  - `wpn_ensemble_pipes` **Pfeifenbank**: Flugabwehr, 3 × 40 alle 1,0 s = 120 DPS, RW 40.
- **Bauen:** Build Power 135, singt alle T1–T3-Landeinheiten der Grundhalle-Liste auch während der Fahrt; Ausgang durch die Apsis am Heck, Rally relativ zur Einheit.
- **Tempo:** 1,7 WU/s (Referenz 1,75), Drehrate 30 °/s, Sicht 32. Langsamste Einheit der Fraktion.
- **Footprint / Größe:** 6 × 6, sizeClass 3, Höhe ≈ 5 WU.
- **Tod:** 4.000 / Radius 7 (Relation 1:1).
- **Post-MVP-Features:** U21, **B12 (neu, Vorschlag): Mobile Fabrik** (Bauen während der Fahrt, Ausgang und Rally relativ zur Einheit, Queue auf einer mobilen Einheit; nicht in `features.json`), K10 (mobiler Blasen-Schild, im MVP-optional vorhanden, hier größer), M13 (Hover über Wasser; ohne M13 nur Land).
- **Konter:** Tuba und Heupferd gegen den Schild, schnelle Umgehung (Tempo 1,7), Artillerie mit RW > 90 (Großhorn).
- **Kitbash (10 Parts, 3 animiert, ≈ 960 Tris):** `keel` Riesenkiel 7 × 5 WU [amber], `shell` Apsis am Heck, offene Seite nach hinten [team], `crystal` Resonanzkern über dem Apsis-Scheitel [glow], 2 × `horn` Trichter vorn links/rechts, 50° ⟳ yawpitch [team], `fork` Gabelkranz ⟳ yaw [body], `mast` + `ring` waagerechte Glocke Ø 5 WU als höchster Punkt [body], `pipe` Pfeifenbank [body], `fin` Kamm über die ganze Länge [team]. Lesereihenfolge von oben: Reif (Schild) → Trichter (Artillerie) → Apsis (Halle).
- **Silhouetten-Pflichtpaare:** Ensemble ↔ Grundhalle III (Apsis auf Kiel gegen Apsis auf Dreipass-Sockel), Ensemble ↔ Stille (Mast mit waagerechtem Reif in zwei Größen).
- **Beschreibung:** „Wandernde Halle: singt Landeinheiten während der Fahrt und schützt sie unter einer großen Glocke. *Wo das Ensemble ist, ist die Halle.*“
- **Audio:** tiefer, mehrstimmiger Bordun, der mit dem Tempo tonal steigt; beim Ausstoß einer Einheit der kurze Glasklang „Bau fertig“; Chorstoß als doppelter Hornstoß im Wechsel links/rechts.

### 4.3 Heupferd / Katydid (`f4:exp_air_bomber`) · Experimenteller Bomber

- **Rolle:** Strategischer Bomber mit eigener Flugabwehr (Hybrid Fächer + Pfeifen, Fächer primär). Fortsetzung von A10 „Luft schwer statt schnell“.
- **Kosten:** 48.000 Mass, 1.920.000 Energy, buildTime 67.500 (Vorbild identisch).
- **HP:** 50.000, Regeneration 25 HP/s (Δ HP/Mass **−3,8 %**).
- **Waffen:**
  - `wpn_katydid_bomb` **Dröhnbombe**: 12.000 Schaden, Radius 17, ein Abwurf alle 14 s = 857 DPS (Bomber-Konvention), Δ DPS/Mass **+9,1 %**, Produkt **+4,9 %**. Vorbild: 11.000, Radius 19. Die schwerere, engere Bombe tötet jede T3-Landeinheit und jede Struktur bis 12.000 HP mit einem Abwurf. Beim Abwurf 1 s tiefer Brummton am Boden (Vorwarnung, nur View/Audio).
  - `wpn_katydid_pipes` **Zirpkranz**: vier Pfeifengruppen, 4 × 400 alle 1,0 s = 1.600 DPS gegen Luft, RW 64 (Δ Luft-DPS/Mass **−11,1 %**).
- **Tempo:** 16 WU/s (Vorbild 18), Wendigkeit gering, Sicht 70.
- **Footprint / Größe:** Luft, sizeClass 0, Footprint 6 × 6 (Auswahl, Wrack), Spannweite 12 WU.
- **Tod:** Absturz 8.000 / Radius 10 (K12, Relation 1:1).
- **Post-MVP-Features:** U21, U12 (T3-Luft als Voraussetzung und für die Flughöhe; ohne U12 normale Flughöhe), P14.
- **Konter:** Hochorgel-Netze, Abfangjäger in Masse (der Zirpkranz ist stark, aber auf 64 WU begrenzt), Dämpfer-Schilde gegen die Bombe.
- **Kitbash (8 Parts, 2 animiert, ≈ 684 Tris):** `shell` Fächer oben [team], `shell` Deckflügel darunter [amber], `lens` Bauch-Bombenkammer [body], `keel` Mittelkiel [amber], 2 × `pipe` Pfeifengruppen ⟳ yaw [body], 2 × `fin` Flügelrippen [team]. Breit ≥ lang (12 × 8 WU), keine Pfeilung, keine Gabel, keine Reifen; Teamfarbe ≥ 45 % der Draufsicht.
- **Silhouetten-Pflichtpaare:** Heupferd ↔ Maikäfer (Fächer in zwei Größen, dazu Pfeifen), Heupferd ↔ Schwärmer (Fächer gegen Pfeilblatt mit Gondeln).
- **Beschreibung:** „Experimenteller Bomber mit einer schweren Dröhnbombe und starker Flugabwehr. *Sein Zirpen hört man, bevor man ihn sieht.*“
- **Audio:** tiefes Schwirren mit Zirp-Rhythmus (Heuschrecken-Stridulation, stark verlangsamt), Pfeifen als hohes Orgel-Staccato, Bombeneinschlag als Glasbruch mit tiefem Nachdröhnen.

### 4.4 Tuba / Tuba (`f4:exp_strat_missile`) · Experimenteller Strategiewerfer (Game-Ender)

- **Rolle:** Game-Ender. Eine strategische Rakete pro Minute auf jedes Ziel der Karte.
- **Kosten:** 185.000 Mass (Vorbild 187.650, **−1,4 %**), 10.000.000 Energy, buildTime 250.000.
- **HP:** 12.500 (Δ HP/Mass **+5,7 %**).
- **Waffe `wpn_tuba_final` „Schlussakkord“:** Innenring 1.000.000 Schaden, Radius 42 (alles verstummt, auch Kommandanten), Außenring 7.500, Radius 58 (Vorbild 45 / 60). Reichweite: ganze Karte. Die Rakete singt sich selbst: 600 Mass, 6.000 Energy, buildTime 129.600 bei Build Power 2.160 = **60 s**, Lager 1, Start leer; Raketen-HP 60.000 (abfangbar durch Raketenabwehr, K17).
- **Aurith-Signatur:** 3 s vor dem Einschlag erscheint am Ziel ein phasenblauer Glyphenring, für alle Spieler sichtbar (sichtbar geladener Schuss, `faction.md` §3.5). Als Ausgleich ist der Innenring 7 % kleiner als im Vorbild.
- **Footprint:** 6 × 6 (Dreipass-Sockel), Struktur.
- **Tod:** 20.000 / 15 + 5.000 / 20 (Relation 1:1).
- **Post-MVP-Features:** K17 (Nukes & SMD), U21, P14 (Stille-Welle: Druckring, Farbentzug, 2 s Audio-Ducking), A21 (KI).
- **Konter:** Raketenabwehr (K17), Angriff auf die Tuba selbst (12.500 HP, keine Waffe), Aufteilen der Armee nach dem Warnring.
- **Kitbash (8 Parts, 2 animiert, ≈ 732 Tris):** 3 × `lens` Dreipass-Sockel [team], `ring` Drehkranz ⟳ yaw [body], `horn` Riesentrichter (Öffnung Ø 3,6 WU, Länge 5 WU, **55°**) ⟳ pitch [team außen], `spindle` Raketenspitze (Ø 1,2 WU) [body], 2 × `fin` Gegengewicht-Kämme (einer teamfarben). Solange eine Rakete geladen ist, ragt die Spindel aus der Trichteröffnung (Zustand ohne HUD lesbar, nur View). 55° = schräg = indirekt; nie ≥ 75°, das wäre Flugabwehr. Kein Kristall.
- **Silhouetten-Pflichtpaare:** Tuba ↔ Großhorn (beide Trichter: Drehkranz, 55° und Spindel gegen Dreibein-Lafette, flach und überlang), Tuba ↔ Hochorgel (schräge dicke Spindel gegen senkrechte Spindeln).
- **Beschreibung:** „Strategiewerfer: eine Rakete pro Minute, die jede Stellung zum Verstummen bringt. *Der tiefste Ton ist der letzte.*“
- **Audio:** Start als sehr tiefer, langer Tubastoß, der in ein Glissando nach oben übergeht; Warnring als leises, steigendes Summen am Ziel; Einschlag als Stille-Welle: kurzer Glasbruch, dann 2 s fast Stille mit einem nachklingenden Ton.

### 4.5 Klangschale / Singing Bowl (`f4:exp_resource`) · Experimenteller Resonanzgenerator

- **Rolle:** Endgame-Eco. Deckt den Verbrauch der Armee fast vollständig.
- **Kosten:** 250.200 Mass, 7.506.000 Energy, buildTime 325.000 (Fremdreferenz identisch).
- **HP:** 5.500 (Δ HP/Mass **+10 %**), keine Waffe.
- **Ertrag:** folgt dem Verbrauch der Armee bis höchstens **4.000 M/s und 400.000 E/s** (FAF-Relation). **Aurith-Asymmetrie „Einschwingen“:** Nach Fertigstellung steigt die Obergrenze in 90 s linear von 0 auf den Höchstwert (Referenz: sofort). Lager 10.000 M / 100.000 E. Amortisation bei 1.000 M/s Verbrauch ≈ 250 s + 45 s Einschwingen.
- **Footprint:** 8 × 8 (Dreipass; Referenz 7 × 7, Aurith-Strukturen sind breiter).
- **Tod:** 35.000 / Radius 24, ein Ring (Referenz 35.000 / 25).
- **Post-MVP-Features:** E17 (Endgame-Eco mit Verbrauchs-Kopplung und Einschwing-Rampe), U21, P14.
- **Konter:** Heupferd (eine Bombe nimmt ≈ 2,2 × die HP), Tuba, Hymne-Vorstoß. Die Klangschale ist die zerbrechlichste Struktur pro Mass.
- **Kitbash (9 Parts, 1 animiert, ≈ 864 Tris):** 3 × `lens` Dreipass [team], `lens` Schalenboden [amber], `ring` Schalenrand Ø 6,5 WU, waagerecht, ohne Mast [amber], 3 × `crystal` stehende Kristalle (Höhe 5 WU, drei = höchste Stufe der Resonator-Grammatik) [glow], `crystal` Klöppel ⟳ spin (kreist auf dem Rand, beim Einschwingen schneller) [glow]. Reif ohne Mast = Flow-Anschluss; kein Mast, keine Muschel, keine Pfeifen.
- **Silhouetten-Pflichtpaare:** Klangschale ↔ Resonator III (drei Kristalle: mit Schale gegen ohne), Klangschale ↔ Stimmstock III (Reif um die Mitte in zwei Größen).
- **Beschreibung:** „Experimenteller Resonanzgenerator: liefert nach dem Einschwingen fast unbegrenzt Mass und Energy. *Die Schale klingt, solange jemand zuhört.*“
- **Audio:** angestrichener Schalenrand als Dauerton, dessen Tonhöhe beim Einschwingen steigt; Klöppel als leise, periodische Obertöne; Zerspringen als voller Akkord, der bricht.

---

## 5. Kitbash- und Tri-Budget im Überblick

| Einheit | Parts (Budget 10) | animiert (Budget 4) | Tris-Schätzung L0 (Budget 1.500) | Budget L1 / L2 | Visual |
|---|---|---|---|---|---|
| Hymne | 9 | 2 (`fork`, `horn`; Beine prozedural) | ≈ 864 | 800 / 320 | `v_exp_assault` |
| Ensemble | 10 | 3 (2 × `horn`, `fork`) | ≈ 960 | 800 / 320 | `v_exp_mobile_fac` |
| Heupferd | 8 | 2 (2 × `pipe`) | ≈ 684 | 800 / 320 | `v_exp_air_bomber` |
| Tuba | 8 | 2 (`ring`, `horn`) | ≈ 732 | 800 / 320 | `v_exp_strat_missile` |
| Klangschale | 9 | 1 (`crystal` Klöppel) | ≈ 864 | 800 / 320 | `v_exp_resource` |

Die Modelle entstehen als `content/models/f4/exp_*.ts` erst mit dem Aurith-Modellsatz; der Modellkit wendet `T4_BUDGET` über `tech: 4` an.

---

## 6. Spielidentität im T4-Spiel

- **Weniger, aber lauter:** Aurith-T4 kosten wie die Vorbild-T4, schießen aber seltener und schwerer (Hymne, Tuba, Heupferd). Das Timing-Spiel der Fraktion (sichtbar geladene Schüsse) setzt sich fort: Die Große Schwebung, der Stoßklang und der Tuba-Warnring sind für den Gegner lesbar, dafür treffen sie härter oder die Einheit hält mehr aus.
- **Schild und Halle als Rückgrat:** Das Ensemble ist die Aurith-Antwort auf Masse: Es produziert an der Front nach und hält die Linie unter 24.000 Schild-HP.
- **Schwäche:** Tempo (Hymne 2,4, Ensemble 1,7, Heupferd 16), keine Überreichweite am Boden (RW 46/90) und die Einschwing-Rampe der Klangschale. Ein Gegner, der früh ein T4 wirft oder die Klangschale in den 90 s Einschwingen bombt, bestraft das Aurith-Timing.
- **KI-Zielbild (A16):** Hymne mit Ensemble als Nachschub und Schild, Heupferd gegen gegnerische Eco-T4, Tuba erst bei Mass-Überschuss.

---

## 7. Balance-Nachweis

Methode wie im MVP-Roster (`roster.md` §1, §14), Referenz `fa_ref_t4.json`. Gates vom Generator erzwungen und von `validate.py` unabhängig nachgerechnet: Δ DPS/Mass (Boden), Δ HP/Mass (HP + Schild), Produkt und Pulk-DPS/Mass je ±15 %, Δ Luft-DPS/Mass ±25 %, Δ Mass ±15 %.

| Einheit | Referenz | Δ Mass | Δ DPS/Mass | Δ HP/Mass | Δ Produkt | Δ Luft-DPS/Mass | Δ Pulk |
|---|---|---|---|---|---|---|---|
| Hymne | `XSL0401` | ±0 % | −9,4 % | +7,5 % | −2,6 % | −4,0 % | – |
| Ensemble | `UEL0401` | ±0 % | −5,0 % | +7,7 % | +2,3 % | +5,0 % | −6,7 % |
| Heupferd | `XSA0402` | ±0 % | +9,1 % | −3,8 % | +4,9 % | −11,1 % | – |
| Tuba | `XSB2401` | −1,4 % | – | +5,7 % | – | – | – |
| Klangschale | `XAB1401` | ±0 % | – | +10,0 % | – | – | – |

Nicht in Zahlen gefasst, aber festgelegt: Tuba-Innenring −7 % gegen 3 s Vorwarnung; Klangschale 90 s Einschwingen gegen +10 % HP; Hymne-Todesfeld 20 s statt 30 s und ortsfest.

Die T4 stehen nicht in `units`, deshalb laufen sie nicht durch die Kreuz-Balance von `cross.py` (Eco-Gleichstand, T1-Duelle, Phasen-Matrix). Eine Kreuz-Prüfung T4 gegen T4 lohnt sich, sobald alle vier Fraktionen ihre Experimentals haben (§9 Nr. 3).

---

## 8. Benötigte Post-MVP-Features

| Feature | Hymne | Ensemble | Heupferd | Tuba | Klangschale | Ohne das Feature |
|---|---|---|---|---|---|---|
| **U16** Erstes Land-Experimental | ● | | | | | nicht baubar |
| **U21** Volles Experimental-Roster & Game-Ender | | ● | ● | ● | ● | nicht baubar |
| **E17** Endgame-Eco | | | | | ● | nicht baubar |
| **K17** Nukes & SMD | | | | ● | | nicht baubar |
| **U12** Luftwaffe T3 | | | ● | | | normale Flughöhe |
| **B12 (neu, Vorschlag)** Mobile Fabrik | | ● | | | | keine Produktion |
| **K10** Schilde (mobil, groß) | | ● | | | | HP ohne Schild |
| **K14-Erweiterung** Todeswaffe mit DoT-Feld | ● | | | | | nur Aufprall 6.000/6 |
| **K1-Erweiterung** Strahlwaffe | ● | | | | | Hitscan-Puls mit gleichem DPS (Roster-Konvention) |
| **M13** Wasser-Layer | ● (amphibisch) | ● (Hover) | | | | nur Land |
| **P14** Großereignis-Effekte | ● | | ● | ● | ● | Standard-Tod-Effekt |
| **A16 / A21** KI T4 / strategische Waffen | ● | | | ● | | KI baut sie nicht |

Maschinenlesbar in `experimentals[].needs` und `experimentals[].special.postMvp`.

---

## 9. Namen und offene Punkte

**Namen:** Wortfelder wie im MVP (`faction.md` §7.2): Chorwerk (*Hymne*, die Reserve aus §7.4 wird eingelöst), Ensemble für die wandernde Halle, singende Insekten für die Luft (*Heupferd*: stridulierende Laubheuschrecke), Blechbläser für Raketen und Artillerie (*Tuba*), Klangkörper für Wirtschaft (*Klangschale*). `validate.py` prüft alle zehn Rufnamen gegen alle Roster (inkl. reservierter Rollen und der T4 anderer Fraktionen, Levenshtein-Abstand ≥ 2) und jedes Wort gegen die 357 FA-Einheiten- und 218 FA-Waffennamen: keine Treffer. Verworfen: *Libelle* (FA-Namensnähe, schon im MVP gestrichen), *Hornisse* (FA-Treffer), *Finale* (italienisches Lehnwort, `faction.md` §10.5), *Kantorei* (zu nah an „Kantor“).

**Offene Punkte**
1. **B12 Mobile Fabrik** ist keine Feature-ID in `features.json`; vor U21 aufnehmen (Abhängigkeiten U5, C5, K10).
2. **Icon-Token `nuke`:** mit K17 fraktionsübergreifend entscheiden (§3.3); bis dahin `struct_mml_t4`.
3. **Kreuz-Balance T4:** `cross.py` kennt keine Experimentals. Sobald alle vier Fraktionen T4 haben, eine T4-Paarung (Land gegen Land, Bomber gegen Flugabwehr-Netz, Game-Ender-Kosten) ergänzen.
4. **Markenrecherche** der fünf Rufnamen (Teil von `faction.md` §11.2 Nr. 1).
5. **Hymne-Nachhall:** Das DoT-Feld trifft Freund und Feind. Im KI-Test prüfen, ob das eigene Ensemble dadurch zu oft Schaden nimmt; Hebel ist der Radius (14).
6. **Klangschale:** E17 muss die Verbrauchs-Kopplung deterministisch festlegen (Ertrag im Tick t = Verbrauch aus Tick t − 1, gedeckelt durch die Rampe).

---

## 10. Werkzeuge

| Datei | Zweck |
|---|---|
| `tools/roster/f4/ref_t4.py` | extrahiert die fünf Referenz-Blueprints aus spooky-db 3810 (plus FAF-`develop`-Ergänzungen) nach `fa_ref_t4.json` |
| `tools/roster/f4/exp.py` | T4-Daten, Ableitungen und harte Gates; von `gen.py` importiert |
| `tools/roster/f4/gen.py` / `md.py` | schreiben `roster.json` (Schlüssel `experimentals`, `counts.experimentals`, `silhouettePairs.t4`, `conventions.experimentals/t4Budget/t4Bridge`) und `roster.md` §21 |
| `tools/roster/f4/validate.py` | prüft die T4 unabhängig (Gates, Icon-Grammatik, Setons-Brücke, Budget, Namen) |
| `tools/roster/cross.py` | unverändert; sieht nur `units` und bleibt grün |

Reihenfolge: `python3 gen.py && python3 md.py && python3 validate.py` im Ordner `tools/roster/f4/`, danach `python3 tools/roster/cross.py`.
