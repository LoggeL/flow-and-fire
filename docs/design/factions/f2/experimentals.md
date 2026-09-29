# Skarn-Geflecht: Experimentals (T4, Post-MVP)

> **Status:** Designentwurf für die T4-Stufe der Fraktion f2 (Skarn). Alles hier ist **Post-MVP** (features.json U16 „Erstes Land-Experimental“, U21 „Volles Experimental-Roster & Game-Ender“) und hat vor den genannten Features keine Sim-Wirkung.
> **Quelle der Zahlen:** `roster.json` → `experimentals[]` (erzeugt von `tools/roster/f2/gen.py`, Daten und Gates in `tools/roster/f2/exp.py`). Die Tabellen hier sind daraus abgeschrieben, die erzeugte Übersicht steht in `roster.md` §20. Bei Widerspruch gilt `roster.json`.
> **Referenz:** die T4-Einheiten der Vorbild-Fraktion aus spooky-db 3810 (`tools/roster/f2/fa_ref_t4.json`, dev-only). Wie im Kern-Roster wird die Vorbild-Fraktion nur über ihr Blueprint-Präfix (`UR*`, `XR*`) genannt, nie mit Namen. Übernommen werden **Rollen und Zahlen-Relationen**, nicht Namen, Formen oder Lore.
> **Prüfung:** `python3 tools/roster/f2/validate.py [index.json]` rechnet die T4-Gates unabhängig nach (Balance, Identität, Brücke, Budget, Icon, Namen gegen FA und gegen alle anderen Roster). `python3 tools/roster/cross.py` bleibt grün.

---

## 1. Überblick

Die Skarn nennen ihre Experimentals **Plagen** (EN *Plagues*, nur Flavor, nie in Zahlenanzeigen). Eine Plage ist eine Großbrut, die ein Tiefnest über Wochen zieht und die mehrere Rotten gemeinsam füttern. Lore-Satz für das Handbuch: *„Ein Haus baut eine Waffe. Eine Rotte zieht eine Plage.“*

| ID | DE / EN | Rolle | Vorbild-Rolle (dev-only) | Mass | HP | DPS | Tempo | Features (Auswahl) |
|---|---|---|---|---|---|---|---|---|
| `f2:exp_lnd_assault` | **Skolopender** / Scolopendra | Experimenteller Sturmläufer | `URL0402` schneller Strahl-Läufer mit Tarnfeld | 19.500 | 42.000 | 4.409 | 2,7 | U16, K1-Erw., I5, M13 |
| `f2:exp_lnd_siege` | **Assel** / Woodlouse | Experimenteller Brutläufer | `XRL0403` amphibischer Megaläufer, baut Einheiten | 36.000 | 104.000 | 2.430 | 2,2 | U21, B3-Erw., M13, U18 |
| `f2:exp_air_gunship` | **Tsetse** / Tsetse | Experimenteller Kampfschweber | `URA0401` schweres Gunship mit Radar-Tarnung | 27.500 | 70.000 | 2.538 | 10 | U21, U12, I5, K12 |
| `f2:exp_lnd_arty` | **Bärenklau** / Hogweed | Experimentelle Schnellfeuer-Artillerie (**Game-Ender**) | `URL0401` mobile Schnellfeuer-Superartillerie | 210.000 | 8.500 | 1.500 | 1,6 | U21, K2, K4, C17, M13 |
| `f2:exp_str_eco` | **Myzel** / Mycelium | Experimenteller Geflechtknoten (**Eco**) | keine (Vorbild hat kein Eco-T4; Fremdreferenz `XAB1401` nur als Obergrenze) | 36.000 | 5.000 | – | – | U21, E17, K14 |

**Mix:** 2 × Land (Angriff, schwer/Fabrik), 1 × Luft, 1 × Game-Ender, 1 × Eco. Damit sind alle vier T4-Rollen der Vorbild-Fraktion abgedeckt; die Eco-Plage ist eine Skarn-eigene Ergänzung.

**Spielidentität:** Wie im Kern gilt „zuerst beißen, dann verschwinden“. Die Skarn-Plagen sind **billiger, schneller und zerbrechlicher** als ihre Vorbild-Referenz (Identitäts-Gate, §2.6), und drei von fünf tragen eine Tarn- oder Umgehungsmechanik (I5, M13). Der Skolopender ist das billigste Land-Experimental und damit der natürliche Kandidat für **U16** (erstes Land-Experimental).

---

## 2. Gemeinsame T4-Regeln

### 2.1 Namen

- **Wortfeld wie im Kern** (faction.md §7): Ungeziefer und Unkraut, aber **die großen, gefürchteten Arten**. Direktfeuer = beißendes und kriechendes Ungeziefer (Skolopender, Assel), Luft = fliegendes Ungeziefer (Tsetse), Artillerie = brennendes Unkraut (Bärenklau, phototoxisch und invasiv), Wirtschaft = das Geflecht selbst (Myzel).
- **Keine Tech-Nummer, keine römische Stufe.** Anzeige wie im Kern: Rufname und darunter die Funktionsrolle, z. B. **Assel** · *Experimenteller Brutläufer* / **Woodlouse** · *Experimental Brood Walker*.
- **Grep:** Alle zehn Rufnamen sind gegen die 357 FA-Einheitennamen und 218 FA-Waffennamen (`tools/roster/fa_names.json`, auch Einzelwörter) und gegen alle Rufnamen von Varkan, Skarn, Sael und Aurith (Levenshtein-Abstand ≥ 2) geprüft (`validate.py`). Verworfen: jede Spinnen-Bezeichnung (Nähe zum Vorbild-Experimental, faction.md §2.5), *Hornisse/Hornet* (FA-Name), *Tollkirsche/Belladonna* (zu nah an der Reserverolle *Nachtschatten/Nightshade*, gleiche Pflanzenfamilie), *Kakerlake* (gleiche Art wie *Schabe*). *Heuschrecke/Locust* (Arbeitsname) wegen der semantischen Nähe zu Aurith *Heupferd* (f4-T4) durch **Tsetse** ersetzt.
- **Waffen-IDs:** `f2:wpn_<einheit>_<waffe>` (z. B. `f2:wpn_scolopendra_beam`, `f2:wpn_hogweed_umbel`), Todeswaffen mit eigenem Namen (Segmentbruch, Brutbersten, Doldenkollaps, Sporenbruch).
- **i18n:** `unit.f2.exp_lnd_assault.name` usw., wie im Kern.

### 2.2 IDs und Einordnung

- **Schema:** `f2:exp_<domäne>_<rolle>` mit den Domänen `lnd | air | str`. Die Rollen-Tokens (`assault`, `siege`, `gunship`, `arty`, `eco`) sind lore-neutral und als fraktionsübergreifender Vorschlag gedacht: gleiche T4-Rolle = gleiche ID-Endung = gleiche Hotbuild-Taste.
- **Nicht im Kern-Roster:** Die T4 stehen in `roster.json` unter `experimentals[]`, **nicht** in `units[]` und nicht in `counts.total`. So bleiben die Kern-Gates (50 Rollen, gleiche Rollen-IDs wie Varkan) und `cross.py` unverändert. `counts.experimentals = 5`.
- **Felder:** wie ein Kern-Eintrag (`economy`, `health`, `weapons`, `motion`, `special.postMvp`, `kitbash`, `balance`), zusätzlich `tier: "T4"`, `postMvp: true`, `needs[]` (alle Feature-IDs, die die Einheit zum Spielen braucht), `iconMarker`, `kitbash.monopoly`, `kitbash.trisBudget`, `motion.dimensionsWU`, `motion.bridge`.
- **Bau:** `buildableBy: ENGINEER & TECH3` (T3-Engineers, wie das Vorbild). Bauzeit in FA-Semantik: Skolopender 27.000 / 32 BP ≈ 14 min für einen Weber allein; mit Assist entsprechend kürzer.

### 2.3 Form: Kluftwuchs im Großformat

Alle Formregeln aus faction.md §3 gelten weiter: Keil-Panzer, „flach = Körper, spitz = Werkzeug“, Winkel-Code (Linse waagerecht = direkt, Schwanz schräg = indirekt, Dornen senkrecht = Luft, Ring = Flow), Glut-Monopol (Spule, Druse und `mat:'glow'` nur bei ECONOMIC/FACTORY/ENGINEER), keine Rundungen. Neu für T4:

| Regel | Umsetzung |
|---|---|
| **Beinzahl ≥ 8 = Plage** | Die Beinzahl-Gewichtsklasse (2 / 4 / 6) bekommt eine vierte Stufe. Land-Experimentals haben **mindestens 8 Beine**: Bärenklau 8, Skolopender 14 (7 Paare, lang gespreizt), Assel 14 (kurz, fast unter der Kuppel verborgen). Beine bleiben reine Optik; der Bein-Renderer braucht nur neue Werte für seinen Instanzparameter `count` (8/14). |
| **Monopol-Merkmal pro Plage** | Jede Plage hat ein Merkmal, das keine andere Einheit der Fraktion trägt: **Segmentkette** (Skolopender), **Plattenkuppel** (Assel), **Vierfach-Schwirrscheibe** (Tsetse), **Dolde** (Bärenklau), **Ringgeflecht** (Myzel). |
| **Rolle bleibt am Rücken-Part lesbar** | Die Plagen nutzen dieselben Rollen-Parts wie der Kern, nur größer und vervielfacht: Linse = Direktfeuer, Schwanz mit Kapseln = Artillerie, Dornenkamm = Flugabwehr, Nestmaul = Fabrik, Druse und Netzring = Wirtschaft. Wer die Zecke lesen kann, liest den Skolopender. |
| **Tech-Marker: Klammer-Winkel** | Statt Tech-Streifen tragen Plagen **zwei quarzweiße Klammer-Winkel** an den vorderen Panzerecken (Breite 0,10 WU × Maßstab wie ein Streifen). Das Modell spiegelt damit die eckige Klammer des Icons (§2.5), genau wie Streifen die Kerben spiegeln. |
| **Teamfarbe** | Wie im Kern: mobil Land ≥ 30 %, Luft ≥ 45 %, Strukturen 20–30 % der Draufsicht inklusive Beine. Bei 14 Beinen trägt der Rücken fast vollständig Teamfarbe (Skolopender: alle Rückenplatten; Assel: alle sieben Querplatten). |
| **Kein Filigran** | Die 12-%-Regel gilt relativ zur Einheitenlänge, bei 9–11 WU Länge also ≥ 1,1 WU. Ausnahmen wie im Kern nur für geklemmte Beine (≥ 0,17 WU × Maßstab, bei Plagen ≥ 0,6 WU). |

### 2.4 Kitbash- und Tri-Budget (Vorschlag)

| Größe | Kern (faction.md §3.3) | **Plage (T4)** |
|---|---|---|
| Tris LOD0 / LOD1 / LOD2 (ohne Beine) | 350 / 220 / 110 | **1.200 / 700 / 350** |
| Part-Einträge (`legs` = 1, Vervielfachung über `count`) | ≤ 7 mobil, ≤ 9 Strukturen | **≤ 12** |
| animierte Parts | ≤ 2 | **≤ 3** |
| Visuals | 28 pro Fraktion | **+1 pro Plage** (kein Superset mit Kern-Visuals; 5 Visuals, höchstens 1–2 Plagen pro Match gleichzeitig sichtbar) |

Die Platzhalter-Schätzungen (Summe der Primitive × `count`) liegen bei **304–518 Tris**, also weit unter dem Budget. Die Luft bis 1.200 ist für Final-Art reserviert (Facettendetails, Sehnen, Glieder-Übergänge). **Offen:** `@faf/modelkit` kennt heute nur die Budgetklassen „Einheit/Gebäude“ (350) und „Mauer“; für Plagen braucht es eine Klasse `exp` (§8).

### 2.5 Strategic Icons (gemeinsame Grammatik)

- **Grundform nach Domäne und Glyphe nach Rolle wie im Kern**, keine neue Form und keine neue Glyphe. Die 19 Tokens (`iconGlyphs`) bleiben unverändert.
- **Statt Tech-Kerben eine eckige Klammer um die Grundform** (Varkan faction.md §6.4, dort für Experimentals vorgesehen). Größenfaktor **1,5** (T3 mobil 1,3, Kommandant 1,6).
- **Icon-IDs:** `<domäne>_<glyphe>_t4`, geprüft gegen `iconGlyphs`:

| Plage | Icon-ID | Lesart im Strategic Zoom |
|---|---|---|
| Skolopender | `land_direct_t4` | [■●] Land-Quadrat mit Punkt in Klammer |
| Assel | `land_direct_t4` | wie Skolopender: Icon folgt der Gefahr, nicht der Fabrik-Funktion („Gefahr vor Funktion“, f4 faction.md §6.2). Die Brut ist am Rally-Punkt sichtbar. |
| Tsetse | `air_direct_t4` | [▲●] Luft-Dreieck mit Punkt (Gunship-Glyphe) in Klammer |
| Bärenklau | `land_arty_t4` | [■⌒] Land-Quadrat mit Bogen in Klammer |
| Myzel | `struct_mass_t4` | [⬡◆] Sechseck mit Raute in Klammer (Mass ist der knappe Ertrag; Energy steht im Tooltip) |

- **Radar-Blip (I3):** unverändert, Plagen erscheinen als gewöhnliches Achteck bzw. Dreieck. Erst Sicht verrät die Plage.

### 2.6 Balance-Methodik

- **Primärreferenz** ist das T4 der Vorbild-Fraktion in derselben Rolle. Gates wie im Kern: **DPS/Mass, HP/Mass und Produkt je ±15 %** (hartes Band ±25 %), bei Artillerie zusätzlich **Pulk-DPS/Mass ±15 %**. DPS = Summe aller Waffen außer Todeswaffe, wie spooky-db.
- **Identitäts-Gate „billiger, schneller, zerbrechlicher“:** Mass ≤ Referenz, Tempo ≥ Referenz, HP/Mass ≤ Referenz. Alle vier Kampf-Plagen bestehen.
- **Fehlende Post-MVP-Mechaniken** werden wie im Kern (faction.md §9.5 Nr. 1) nicht über das Band hinaus kompensiert. Wo die Referenz einen Teil ihrer DPS aus einem Post-MVP-Waffentyp zieht (Torpedos, U18), zählt die Referenz-Summe trotzdem voll; die Skarn-Plage liegt damit gegen Landziele leicht über der Relation (Assel +8,3 %), bleibt aber im Band.
- **Eco ohne Vorbild:** Amortisation gegen die eigene Egel-Kette I→III (Mass-Äquivalent der Energie über Druse III), Gate **1,5–3,0 ×**. Unter 1,5 würde das Myzel das Spot-Netz verdrängen, über 3,0 lohnt es nie.
- **Kein Kreuz-Gate gegen Varkan:** Varkan hat noch keine T4. `balance.crossInfo` hält die FA-Relation der Varkan-Vorbild-Fraktion (`UEL0401`, `UEB2401`) nur als Info fest. Sobald Varkan-T4 existieren, kommt ein Kreuz-Check wie §14.4 im Kern dazu.

| Plage | Referenz | ΔDPS/Mass | ΔHP/Mass | ΔProdukt | Pulk | Identität (Mass · Tempo · HP/Mass) |
|---|---|---|---|---|---|---|
| Skolopender | `URL0402` | −0,8 % | −4,3 % | −5,0 % | – | ✓ · ✓ (2,7 ≥ 2,5) · ✓ |
| Assel | `XRL0403` | −4,4 % | −1,5 % | −5,8 % | – | ✓ · ✓ (2,2 ≥ 2,0) · ✓ |
| Tsetse | `URA0401` | +0,4 % | −1,6 % | −1,2 % | – | ✓ · ✓ (10 ≥ 9) · ✓ |
| Bärenklau | `URL0401` | −1,8 % | −1,1 % | −2,8 % | −1,8 % | ✓ · ✓ (1,6 ≥ 1,5) · ✓ |
| Myzel | (Eco) | – | – | – | – | Amortisation 536 s = **1,75 ×** Egel-Kette (306 s) |

### 2.7 Größe, sizeClass und Setons-Brücke

- **sizeClass 3** (neu) für alle Land-Plagen; Passierbarkeit und Steering (M5/M7) brauchen dafür einen eigenen Clearance-Layer. Die Tsetse fliegt (sizeClass 0 wie alle Luft), das Myzel ist ein Gebäude (Footprint 10 × 10 auf dem Bau-Grid).
- **Setons-Brücke** (engste Stelle ≈ 74 WU, `content/maps/src/setons.spec.md`): Gate **≥ 72 WU**. Regel: Außenmaß (größtes von Breite, Beinspanne, kurzer Footprint-Kante) ≤ 12 WU, damit **mindestens 6 Einheiten nebeneinander** passen und eine Plage die Brücke nie allein verstopft.

| Plage | Footprint | L × B × H (WU) | Beinspanne | nebeneinander auf 72 WU |
|---|---|---|---|---|
| Skolopender | 4 × 10 | 11 × 3,2 × 2,2 | 5,6 | 12 |
| Assel | 8 × 8 | 9,5 × 7 × 4,4 | 10,5 | 6 |
| Bärenklau | 6 × 8 | 8,5 × 5,5 × 10,5 | 9,0 | 8 |
| Tsetse | 6 × 6 (Landefläche) | 10 × 11 × 2,4 | – | Luft |
| Myzel | 10 × 10 | 10 × 10 × 6 | – | Gebäude |

### 2.8 Hotbuild (Vorschlag, fraktionsübergreifend)

T3-Engineers bekommen im Bau-Menü einen **T4-Tab** (C8). Gleiche Taste = gleiche T4-Rolle in jeder Fraktion: **Q** Land-Angriff (Skolopender), **W** Artillerie/Game-Ender (Bärenklau), **E** Land-Schwer (Assel), **R** Luft (Tsetse), **T** Eco (Myzel). In `roster.json` → `hotbuildGrid["Bau (T4-Tab, Post-MVP)"]`.

### 2.9 Audio

Es gelten die Skarn-Bänder (faction.md §8.3): hoch und gläsern, nur 6-Beiner und Geflechtriss tief. Plagen sind die zweite tiefe Ausnahme. Vor jeder Quittung kommen **vier Klicks** (Tech-Regel des Geflecht-Echos, T4 = 4), gefolgt von einem kurzen Chor aus mehreren Rädelsführer-Fragmenten („mehrere Rotten füttern eine Plage“). Tunnelwache-Alert beim Fertigstellen: „Plage ist gewachsen.“ / „Plague has grown.“ Gegner-Alert (P8, fraktionsneutral): „Experimental gesichtet.“

---

## 3. Skolopender / Scolopendra (`f2:exp_lnd_assault`)

**Rolle:** Experimenteller Sturmläufer · *Experimental Assault Walker*. Vorbild-Rolle `URL0402`: das billigste und schnellste Land-Experimental, extrem hohe Nahkampf-DPS über einen Strahl, getarnt, amphibisch.

**Beschreibung (`descKey`):** DE: „Frisst sich mit einem Granatstrahl durch jede Linie und ist schneller als alles, was ihm folgen kann. Man sieht ihn erst, wenn er schon zwischen den Nestern ist.“ EN: „Burns through any line with a garnet beam and outruns anything that could follow it. You only see it once it is already among the nests.“

| Wert | Skolopender | Vorbild `URL0402` (Relation) |
|---|---|---|
| Kosten | 19.500 M · 250.000 E · BT 27.000 | 20.000 M · 260.000 E · BT 27.500 |
| HP / Regeneration | 42.000 / 10 HP/s | 45.000 / 10 |
| Tempo / Drehrate | 2,7 WU/s / 30 °/s | 2,5 / 25 |
| Sicht | 32 | 32 |
| Footprint / sizeClass / Beine | 4 × 10 / 3 / 14 | – |

| Waffe | Schaden × Salve / Nachladen | DPS | RW (min) | Ziel |
|---|---|---|---|---|
| **Granatstrahl** (Dauerstrahl; MVP-Fallback Pulslinse) | 390 × 1 / 0,1 s | 3.900 | 30 (4), Splash 0,5 | Land |
| Kieferlinsen (2 × Puls) | 150 × 2 / 0,7 s | 429 | 60 | Land |
| Dornenkamm Heck (Lenkpfeile) | 40 × 4 / 2,0 s | 80 | 60 | Luft |
| Todeswaffe **Segmentbruch** | 4.000 im Radius 6 | – | – | – |

**Besonderheiten und Post-MVP-Features:**
- **K1-Erweiterung (Beam-Waffentyp):** Der Granatstrahl ist ein echter Dauerstrahl mit Schaden pro Tick. Bis dahin feuert er als Hitscan-Puls mit identischem DPS (faction.md §9.4). Die Linse leuchtet nur während des Strahls (Glut-Monopol bleibt gewahrt).
- **I5:** Tarnfeld Radius 12 WU um sich und Begleiter, Unterhalt 400 E/s (Vorbild-Relation).
- **M13 + U18:** amphibisch, unter Wasser ein Giftstachel (Torpedo 50 / 4 s, RW 45). Die fehlenden 50 DPS sind 1,1 % der Referenz-Summe.
- **P14:** Segmentbruch als Großereignis, die Kette reißt Glied für Glied von hinten nach vorn.
- **Konter:** Masse an Direktfeuer außerhalb von 30 WU (Kieferlinsen allein sind schwach), Luft (nur 80 AA-DPS), Stellungen mit Reichweite. Der Skolopender verliert jeden Stellungskrieg.

**Kitbash (8 Part-Einträge, 2 animiert, ≈ 432 Tris L0 ohne Beine; Budget 1.200 / 700 / 350):**

| Part | Material | `count` | Anim | Rolle |
|---|---|---|---|---|
| `legs` | – | 14 | Render-Pfad | 7 Beinpaare, Knie über dem Rücken, Spanne 5,6 WU |
| `carapace` Kopfsegment | team | 1 | yaw | Turm, trägt Strahl- und Kieferlinsen |
| `carapace` Rumpfsegmente | team | 6 | Phase (nur View) | Segmentkette, schwingt phasenversetzt zum Beinzyklus |
| `carapace` Seitenplatten | body | 6 | – | dunkle, glänzende Flanken |
| `lens` Strahllinse | sinew | 1 | pitch | überlang (4,2 WU), ragt 1,5 WU über den Kopf |
| `lens` Kieferlinsen | sinew | 2 | – | an den Giftklauen, waagerecht |
| `carapace` Giftklauen | sinew | 2 | – | Zangen-Keile vorn (Erbe der Ohrwurm-Zangen) |
| `spike` Dornenkamm | body | 6 | – | senkrecht auf den letzten zwei Gliedern (AA) |

**Silhouette:** sieben flache Keilglieder hintereinander (Länge ≥ 3,4 × Breite), die Strahllinse als längste Waagerechte des ganzen Rosters. **Verboten:** Schwanz (Artillerie-Monopol), runder Körper, Beine länger als 0,6 × Rumpflänge (sonst Spinnen-Umriss).

---

## 4. Assel / Woodlouse (`f2:exp_lnd_siege`)

**Rolle:** Experimenteller Brutläufer · *Experimental Brood Walker*. Vorbild-Rolle `XRL0403`: der zäheste Körper der Fraktion, amphibisch, baut Einheiten, schwere Doppelkanonen.

**Beschreibung (`descKey`):** DE: „Trägt ein ausgereiftes Nest unter dem Panzer und brütet an der Front T1- bis T3-Läufer aus. Die Häuser haben sie aus jedem Keller gejagt; sie kam jedes Mal wieder.“ EN: „Carries a matured nest beneath its plates and hatches T1 to T3 walkers right at the front. The Houses drove it out of every cellar; it always came back.“

Lore-Anker: Asseln sind Krebstiere, die an Land leben, und tragen ihre Brut in einem Beutel unter dem Körper. Beides ist hier Mechanik: amphibisch (M13) und mobiles Nest.

| Wert | Assel | Vorbild `XRL0403` (Relation) |
|---|---|---|
| Kosten | 36.000 M · 420.000 E · BT 58.000 | 37.500 M · 437.500 E · BT 60.625 |
| HP / Regeneration | 104.000 / 1 HP/s | 110.000 / 0,5 |
| Build Power | 45 | 45 |
| Tempo / Drehrate | 2,2 WU/s / 45 °/s | 2,0 / 45 |
| Sicht | 32 | 32 |
| Footprint / sizeClass / Beine | 8 × 8 / 3 / 14 | – |

| Waffe | Schaden × Salve / Nachladen | DPS | RW (min) | Ziel |
|---|---|---|---|---|
| **Zwillingslinsen** (2 Türme × 2 Linsen) | 720 × 4 / 1,2 s | 2.400 | 60 (4), Splash 2 | Land |
| Flakdornen | 18 × 1 / 0,6 s | 30 | 40, Splash 2 | Luft |
| Todeswaffe **Brutbersten** | 8.000 im Radius 9 | – | – | – |

**Besonderheiten und Post-MVP-Features:**
- **Brutbeutel (B3-Erweiterung):** baut die Landnest-Liste T1–T3 der Skarn (ohne Engineers) mit Build Power 45. Queue, Repeat und Rally wie ein Nest; die Queue läuft auch in Bewegung, Ausstoß am Bug. Braucht Produktion aus einer mobilen Einheit (heute nur Fabriken).
- **M13 + U18:** amphibisch, brütet auch unter Wasser; Tiefenstachel (Torpedo 20 × 4 / 1,3 s, RW 64) und Torpedo-Ablenker.
- **Balance-Hinweis:** Ohne Torpedo fehlen 11,6 % der Referenz-Summe; gegen Landziele liegt die Assel damit +8,3 % über der Vorbild-Relation. Im Band, keine Kompensation.
- **Konter:** Luft (30 AA-DPS sind symbolisch), Artillerie auf die Brut-Rally, Reichweite > 60.

**Kitbash (8 Part-Einträge, 2 animiert, ≈ 364 Tris L0 ohne Beine):**

| Part | Material | `count` | Anim | Rolle |
|---|---|---|---|---|
| `legs` | – | 14 | Render-Pfad | kurze Hochbeine, Knie knapp über dem Kuppelrand, Spanne 10,5 WU |
| `carapace` Querplatten | team | 7 | – | überlappende Kuppel (Breite ≥ 0,7 × Länge) |
| `carapace` Bauchschale | body | 1 | – | dunkle Unterseite |
| `neck` Linsenträger | body | 2 | yaw | links und rechts vorn |
| `lens` Zwillingslinsen | sinew | 4 | pitch | je 2 waagerecht pro Träger |
| `gate` Brutmaul | glow | 1 | – | V-Portal am Bug (Herzkern, FACTORY erlaubt Glut) |
| `spool` Brutspule | team | 1 | – | liegend hinter dem Maul (Flow-Einheit) |
| `spike` Flakdornen | body | 4 | – | kurz und senkrecht auf der dritten Platte |

**Silhouette:** flacher Oval-Dom aus sieben Platten, vorn das glühende Maul. **Verboten:** Fühler (Intel-Lesart), Schwanz, lange Beine (Verwechslung mit dem Skolopender).

---

## 5. Tsetse / Tsetse (`f2:exp_air_gunship`)

**Rolle:** Experimenteller Kampfschweber · *Experimental Gunship*. Vorbild-Rolle `URA0401`: schweres, gepanzertes Gunship mit starker Boden-DPS, brauchbarer Luftabwehr, hoher Regeneration und Radar-Tarnung.

**Beschreibung (`descKey`):** DE: „Sticht aus großer Höhe in Basen und Kolonnen und ist wieder fort, bevor die Flugabwehr sie findet. Wen sie gestochen hat, der schläft lange.“ EN: „Stings bases and columns from high above and is gone before the air defence finds it. Whoever it stings sleeps for a long time.“

Lore-Anker: Die Tsetse ist die Stechfliege, die ganze Landstriche unbewohnbar macht. Genau das wünschen die Skarn den Häusern.

| Wert | Tsetse | Vorbild `URA0401` (Relation) |
|---|---|---|
| Kosten | 27.500 M · 780.000 E · BT 46.000 | 29.000 M · 812.000 E · BT 48.000 |
| HP / Regeneration | 70.000 / 70 HP/s | 75.000 / 75 |
| Tempo | 10 WU/s | 9 |
| Sicht | 46 | 46 |
| Landefläche / Layer | 6 × 6 / Luft | – |

| Waffe | Schaden × Salve / Nachladen | DPS | RW | Ziel |
|---|---|---|---|---|
| **Bauchlinsen** (4 × Puls) | 300 × 4 / 0,7 s | 1.714 | 30, Splash 3 | Land |
| Stachelköcher (2 × 3 Raketen) | 200 × 6 / 2,0 s | 600 | 30 | Land |
| Dornenkamm (Lenkpfeile) | 140 × 4 / 2,5 s | 224 | 60 | Luft |
| Todeswaffe **Absturz** | 5.000 im Radius 8 | – | – | – |

**Besonderheiten und Post-MVP-Features:**
- **U12:** Flugmodell, Bau und Landung der schweren T3/T4-Luft (Wendekreis, Landefläche). Gebaut wird sie wie alle Plagen von T3-Engineers, nicht im Luftnest.
- **I5:** Radar-Tarnung, Unterhalt 600 E/s (Vorbild-Relation).
- **K12:** Absturzschaden beim Abschuss.
- **Konter:** konzentrierte Flugabwehr (Igel, Hagedorn), Abfangjäger in Masse; die Tsetse hält viel aus, trifft aber Luft nur mit 224 DPS.

**Kitbash (7 Part-Einträge, 2 animiert, ≈ 304 Tris L0):**

| Part | Material | `count` | Anim | Rolle |
|---|---|---|---|---|
| `carapace` Rumpfglieder | team | 3 | – | langer Gliederrumpf (10 WU) |
| `neck` Ausleger | team | 4 | – | X-Ausleger, tragen die Scheiben (Teamfläche Luft ≥ 45 %) |
| `buzzdisc` Schwirrscheiben | body | 4 | spin | opak, gestreift, kein Alpha |
| `lens` Bauchlinsen | sinew | 4 | pitch | zwei Paare unter dem Rumpf |
| `pod` Stachelköcher | sinew | 2 | – | seitlich am mittleren Glied |
| `spike` Dornenkamm | body | 4 | – | senkrecht auf dem mittleren Glied |
| `carapace` Kopfschild | sinew | 1 | – | dunkle Front, zeigt die Flugrichtung |

**Silhouette:** vier Scheiben im X um einen langen Rumpf. **Verboten:** Flügel (Gunship-Regel des Kerns), Hinterleib (Bomber-Monopol). Paartest gegen die Hummel (eine Scheibe, kurzer Rumpf) und gegen den Brummer (Flügel und Hinterleib).

---

## 6. Bärenklau / Hogweed (`f2:exp_lnd_arty`) · Game-Ender

**Rolle:** Experimentelle Schnellfeuer-Artillerie · *Experimental Rapid-Fire Artillery*. Vorbild-Rolle `URL0401`: mobile Superartillerie, die eine Salve aus 20 schweren Granaten über die ganze Karte legt, extrem teuer und extrem zerbrechlich.

**Beschreibung (`descKey`):** DE: „Wurzelt sich ein und streut alle zwanzig Sekunden eine brennende Dolde über die Karte. Wer sie berührt, trägt die Narben lange.“ EN: „Roots itself and scatters a burning umbel across the map every twenty seconds. Whoever touches it carries the scars for a long time.“

| Wert | Bärenklau | Vorbild `URL0401` (Relation) |
|---|---|---|
| Kosten | 210.000 M · 3.800.000 E · BT 230.000 | 220.000 M · 4.000.000 E · BT 240.000 |
| HP / Regeneration | 8.500 / 0 | 9.000 / 0 |
| Tempo / Drehrate | 1,6 WU/s / 80 °/s | 1,5 / 80 |
| Sicht | 26 | 26 |
| Footprint / sizeClass / Beine | 6 × 8 / 3 / 8 | – |

| Waffe | Schaden × Salve / Nachladen | DPS | RW (min) | Splash |
|---|---|---|---|---|
| **Doldensalve** (20 Kapseln, 0,25 s Abstand, ballistisch, v = 160) | 1.500 × 20 / 20 s | 1.500 | 4.000 (150) | 12 |
| Todeswaffe **Doldenkollaps** | 3.000 im Radius 8 | – | – | – |

Pulk-DPS/Mass (Splash 12 gegen 12): −1,8 % zur Referenz.

**Besonderheiten und Post-MVP-Features:**
- **Wurzeln (C17, Skarn-eigen):** Der Bärenklau feuert nur **verwurzelt**. Wurzeln dauert 10 s, Lösen 5 s; verwurzelt ist er immobil, die Beine und zwei Ankersporne stehen gespreizt im Boden. Das ist bewusstes Gegenspiel auf kleinen Karten: Auf Setons (1.024 WU) ist die Reichweite kartenweit, also muss die Stellung angreifbar sein. Die Dolde glüht 3 s vor jeder Salve (nur View, für beide Seiten sichtbar).
- **K2 + K4:** Ballistik mit Streuung und Flächenschaden; **I3:** Ziele außerhalb der Sicht nur über Radar/Aufklärung.
- **M13:** amphibisch wie das Vorbild (läuft über den Grund, feuert nicht unter Wasser).
- **Reichweite:** 4.000 WU wie die Vorbild-Relation. Auf allen MVP-Karten kartenweit, erst auf großen Karten (M14) eine echte Grenze.
- **Konter:** 8.500 HP. Jeder Durchbruch zur Stellung, Bomber, Skolopender oder Assel beenden ihn; ein Kokon III darüber verlängert das Leben nur kurz.

**Kitbash (6 Part-Einträge, 3 animiert, ≈ 396 Tris L0 ohne Beine):**

| Part | Material | `count` | Anim | Rolle |
|---|---|---|---|---|
| `legs` | – | 8 | Render-Pfad | gespreizt, beim Wurzeln abgesenkt |
| `carapace` Rumpf | team | 1 | – | breiter Keil |
| `carapace` Ankersporne | body | 2 | deploy | klappen beim Wurzeln hinten in den Boden |
| `neck` Schwanzansatz | body | 1 | yaw | dreht den Schwanz |
| `tail` Doppelschwanz | team | 2 | pitch | zwei Gliederketten übereinander bis 10,5 WU Höhe |
| `pod` Dolde | sinew | 12 | – | radial auf einem flachen Schirm, Ø 4 WU, 50° nach vorn |

**Silhouette:** der höchste Umriss des Rosters, eine Dolde über einem niedrigen Körper. **Verboten:** Linse, alles Waagerechte. Paartest gegen Stechapfel (eine Kapsel, 6 Beine) und Bilsenkraut (auf Kruste, statisch).

---

## 7. Myzel / Mycelium (`f2:exp_str_eco`) · Eco

**Rolle:** Experimenteller Geflechtknoten · *Experimental Tangle Node*. Die Vorbild-Fraktion hat kein Eco-Experimental. Das Myzel ist eine **Skarn-eigene Ergänzung** für die Endgame-Wirtschaft (E17). Die Fremdreferenz `XAB1401` (andere FA-Fraktion) dient nur als Obergrenze für Kosten und Sprengkraft; das Myzel ist bewusst viel kleiner (14 % ihrer Mass) und hat einen festen Ertrag statt eines unbegrenzten.

**Beschreibung (`descKey`):** DE: „Das Geflecht selbst, aus der Kruste gezogen: liefert Masse und Energie ohne Bohrloch. Man kann es verbrennen, aber es wächst nach.“ EN: „The Tangle itself, drawn up from the crust: yields mass and energy without a drill site. You can burn it, but it grows back.“

| Wert | Myzel |
|---|---|
| Kosten | 36.000 M · 900.000 E · BT 90.000 |
| HP / Regeneration | 5.000 / 25 HP/s |
| Ertrag | **60 M/s + 3.000 E/s**, kein Unterhalt, kein Spot nötig |
| Footprint | 10 × 10 (Gebäude) |
| Todeswaffe **Sporenbruch** | 3.000 im Radius 20 (K14) |

**Amortisation:** Energy wird über die Druse III in Mass umgerechnet (3.200 M für 2.500 E/s = 1,28 M je E/s). Das Myzel kostet netto 36.000 − 3.000 × 1,28 = 32.160 M für 60 M/s, also **536 s**. Die Egel-Kette I→III (5.436 M, Unterhalt 54 E/s) liefert 18 M/s in **306 s**. Verhältnis **1,75 ×** (Gate 1,5–3,0): Das Myzel lohnt sich, wenn alle Spots vergeben sind, verdrängt aber nie das Egel-Netz.

**Besonderheiten und Post-MVP-Features:**
- **E17:** Endgame-Eco mit festem Ertrag.
- **K14:** Sporenbruch beim Tod. Nicht neben die eigenen Nester setzen.
- **Wurzelnetz (Aura über die generische `regen`-Spalte, G6-Pfad, keine eigene Feature-ID; Vorschlag unter E17):** Eigene Strukturen im Radius 30 WU regenerieren doppelt. Das ist die Plagen-Form von „Nachwachsen“ (faction.md §9.3).
- **Konter:** 5.000 HP. Ein einziger Bärenklau-Treffer (1.500 × Splash) oder eine Bomberwelle genügt; das Myzel muss geschützt werden.

**Kitbash (4 Part-Einträge, 0 animiert, ≈ 518 Tris L0):**

| Part | Material | `count` | Rolle |
|---|---|---|---|
| `crust` Kruste | team (Oberkante) | 1 | achteckig über den ganzen 10 × 10-Footprint |
| `webring` Ringgeflecht | glow | 3 | konzentrisch, flach, pulsiert im Herzschlag (Herzkern, ECONOMIC erlaubt Glut) |
| `druse` Drusen | glow | 5 | eine hohe in der Mitte, vier im inneren Ring |
| `carapace` Wurzelplatten | sinew | 6 | sternförmig über den Rand hinaus (im Footprint) |

**Silhouette:** niedrig und breit, drei Ringe. Paartest gegen Druse III (Kristallcluster ohne Ring) und Egel III (doppelter Ring um einen Spot, 2 × 2).

---

## 8. Silhouetten-Pflichtpaare (T4)

Bei 48 px, 5 von 5 Testern, inklusive Beine:
- **Skolopender ↔ Assel** (beide 14 Beine: Kette gegen Kuppel)
- **Skolopender ↔ Langbein** (Strahllinse gegen Präzisionslinse; Länge des Körpers)
- **Bärenklau ↔ Stechapfel**, **Bärenklau ↔ Bilsenkraut** (Dolde gegen Einzelkapsel)
- **Tsetse ↔ Hummel** (vier Scheiben gegen eine)
- **Myzel ↔ Druse III**, **Myzel ↔ Egel III**
- **Assel ↔ Landnest III** (Maul am mobilen Körper gegen Maul auf Kruste)
- **Fraktions-Paartest:** jede Skarn-Plage gegen die T4 derselben Rolle der anderen Fraktionen, sobald diese existieren (Rolle gleich lesen, Fraktion verschieden).

---

## 9. Offene Punkte

1. **Budgetklasse `exp` in `@faf/modelkit`** (1.200 / 700 / 350 Tris, ≤ 12 Parts, ≤ 3 animiert). Heute prüft der Vertragstest nur 350; die Plagen-Modelle können erst danach gebaut werden. Kein Eingriff in dieser Runde.
2. **Bein-Renderer:** neue `count`-Werte 8 und 14 und ein Phasenversatz für die Segmentkette des Skolopenders (nur View, `packages/render` ist nicht Teil dieser Runde).
3. **sizeClass 3:** Clearance-Layer im Passierbarkeits-Grid (M5) und im Steering (M7). Die Brückenregel (≥ 6 nebeneinander auf 72 WU) ist die Abnahme dafür.
4. **Beam-Waffentyp (K1-Erweiterung):** Der Skolopender ist die erste Skarn-Einheit, die ihn braucht (faction.md §11.2 Nr. 7). Bis dahin Hitscan-Puls mit gleichem DPS.
5. **Mobile Produktion (B3-Erweiterung)** für die Assel; ohne sie bleibt die Assel eine reine Kampfeinheit mit gleicher Balance.
6. **Kreuz-Gate gegen Varkan** nachziehen, sobald Varkan T4 hat; ebenso die fraktionsübergreifende Abstimmung der Rollen-IDs `exp_*` und der T4-Hotbuild-Tasten. `cross.py` liest `experimentals[]` noch nicht; die Namens- und Icon-Prüfung der T4 läuft bis dahin in `f2/validate.py` (prüft auch die `experimentals[]` anderer Roster, sobald vorhanden).
7. **FAF-Stand nachziehen:** Referenzwerte sind spooky-db 3810 wie im Kern. Vor dem Balancing der Plagen gegen den dann aktuellen FAF-Stand prüfen.
8. **Markenrecherche** für die neuen Rufnamen und den Flavor-Begriff „Plage“.
