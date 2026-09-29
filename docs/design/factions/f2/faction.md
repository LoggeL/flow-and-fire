# Fraktion f2: Das Skarn-Geflecht

> **Status:** Designkonzept für die zweite Fraktion (U19 „Zweite asymmetrische Fraktion“, vorgezogen als Datenentwurf). Grundlage ist Variante V1 „Skarn“. Einzelne Elemente stammen aus V2 „Klaue“ und V3 „Nachtweber“ (Herleitung in §10).
> **Umfang:** dieselben **50 Blueprint-Rollen** wie Varkan (gleiche funktionale IDs, gleiche Feature-IDs), davon 26 im MS9-Kern (●). Dazu kommen **reservierte Post-MVP-Rollen** (§7.5), die nicht mitgezählt werden. Waffen- und Projektil-BPs sind nicht mitgezählt.
> **Quelle der Zahlen:** `docs/design/factions/f2/roster.json` ist die einzige Quelle für Werte, ●/○-Status, Kitbash-Parts und Maßstäbe (Schema `faf-roster/1` wie Varkan). Die Rollentabelle in §7.4 und die Richtwerte in §9 und §11.1 sind nach dem Review an das Roster angeglichen (`roster.md` §19). Bei Widerspruch gilt `roster.json`.
> **Mechanik:** Asymmetrischer Schwarm- und Guerilla-Spieler mit FA-naher Mechanik. Balanciert wird mit der Varkan-Methodik, aber gegen die **Vorbild-Fraktion** als FA-Referenz: DPS/Mass und HP/Mass als hartes Gate ±25 %, Ziel ±15 % inklusive Produkt und Pulk-DPS/Mass, Treffer-bis-Tod exakt wie die Vorbild-Referenz (`roster.md` wie Varkan §14). Die Identität steckt in Optik, Namen und Klang **und** in den Zahlen-Relationen der Vorbild-Fraktion: billiger, schneller, zerbrechlicher. Sondermechaniken, die erst nach dem MVP kommen, sind mit ihrer Feature-ID markiert (§9.4). Die Kern-Balance funktioniert ohne sie.
> **Abgrenzung:** keine FA-Namen, keine FA-Lore, keine FA-Designs und keine FA-Assets. Die Vorbild-Fraktion wird in diesem Dokument nur über ihr Blueprint-Präfix (`UR*`, `XR*`, `DR*`, dev-only) referenziert, nie mit Namen. Mechanik-Begriffe der UI bleiben neutral: Mass, Energy, Build Power, Assist, Reclaim, T1–T3, Radar, Stealth, EMP.

---

## 1. Name

| | DE | EN |
|---|---|---|
| Fraktion (UI-Kurzname) | **Skarn** | **Skarn** |
| Vollname (Lore) | das Skarn-Geflecht | the Skarn Tangle |
| Adjektiv | skarnisch | Skarn (attributiv) |
| Welt | Kessa | Kessa |
| Spieleridentität | Rotte (Teamfarbe = Rottenzeichen) | Pack |
| Ordner-Slug / ID-Namespace | `f2` | `f2` |

- **Aussprache:** „SKARN“, eine Silbe, kurzes a, in DE und EN gleich. *Skarn* ist ein realer Geologie-Begriff für Kontaktgestein, das entsteht, wo Magma auf Kalk trifft. Dort wachsen Erz, roter Granat und schwarzer Pyroxen. Der Name ist damit in der Welt Kessa verankert (dünne Kruste, fließendes Metall darunter) und liefert die Farben der Fraktion gleich mit: Granatrot und Schwarz.
- **Rotten:** Jeder Spieler und jede KI ist eine Rotte. Namensvorschläge für `aiProfile` und die Match-Anzeige: *Rotte Kluft, Rotte Aschzahn, Rotte Druse, Rotte Sieben, Rotte Splitt, Rotte Nachtgang* (EN *Pack Rift, Pack Ashtooth, Pack Geode, Pack Seven, Pack Splinter, Pack Nightpass*). „Pack Shard“ ist verworfen, weil *Shard* ein FA-Einheitenname ist; der Validator greppt die Rottennamen mit.
- **Namespace:** Die IDs laufen unter `f2:` statt unter dem Lore-Namen. So bleiben sie lore-neutral und stabil, falls sich der Name nach der Markenrecherche noch ändert (§11.2).
- **Offen:** Markenrecherche zu „Skarn“ und „Skarn-Geflecht“ gegen bestehende Spiele und Marken (§11.2).

---

## 2. Lore

### 2.1 Kurz-Lore (≈ 150 Wörter, Text für Lobby und Handbuch)

> Bevor es die Charta gab, schickten die Häuser Menschen hinab: die Gießknechte der Ersten Absenkung. Im Bruchjahr riss die Kruste auf. Die Häuser zogen ihre Hütten in den Orbit zurück, schrieben „Kein Mensch betritt den Boden“ in die Charta und erklärten die Zurückgelassenen zu Schlacke.
>
> Die Knechte starben nicht. In den heißen Skarnzonen, wo Granat und schwarzes Erz wachsen, lernten sie, ihre Maschinen zu ziehen statt zu gießen, und banden sie mit Nervensträngen an sich. Heute nennen sie sich Skarn.
>
> Jede Rotte hängt an ihrem Rädelsführer. Durch ihn läuft das Geflecht, das jede ihrer Maschinen lenkt. Fällt er, reißt das Geflecht. Die Maschinen erstarren, und der Biss ist verloren.
>
> Die Charta haben die Skarn nie unterschrieben. Aber jede Ader, die ein Haus anzapft, brennt ihnen einen Stollen aus.

### 2.2 Weltregeln: Jede Regel begründet eine Mechanik, die schon im Plan steht

| Weltregel | Mechanik (Feature) | Umsetzung / Text |
|---|---|---|
| **Biss-Recht:** Ein Ort gehört der Rotte, deren Geflecht ihn hält. Das Geflecht läuft durch den Rädelsführer. | U1 / A4: Kommandant verloren = Spiel verloren | Niederlage-Text: „Geflecht gerissen. Biss verloren.“ / „Tangle snapped. Bite lost.“ |
| **Durchbruch:** Der Rädelsführer kommt nicht von oben, sondern bricht aus dem Stollennetz durch die Kruste. | Spielstart, P19 (Warp-in, später) | Platzhalter bis P19: Der Boden reißt sternförmig auf, Granatlicht dringt heraus, danach baut sich der Rädelsführer per Build-Dissolve von unten auf (≈ 3 s, nur View). Spielbar ist er ab Tick 0. Gegenbild zu Varkans Lotung von oben. |
| **Geflechtriss:** Der Herzknoten des Rädelsführers hält die gesamte Geflechtspannung und entlädt sich beim Tod. | U1: Death-Explosion | Knacken wie brechendes Glas, roter Blitzring, Druckwelle, Kamera-Shake. Der EMP-Anteil (Lähmung) ist K18 und damit Post-MVP (§9.4). |
| **Gezogene Maschinen:** Alles außer dem Rädelsführer ist in der Kruste gezogene Maschinerie aus Kristall und Chitin, unbemannt und ans Geflecht gebunden. | Fabriken, Engineers, Reclaim | Wracks zerfallen zu Kristallgrus, also Reclaim-Masse: „Was fällt, wächst wieder.“ |
| **Ausreifen:** Ein Nest kann feinere Brut ziehen, wenn es ausgereift ist. | U5: Fabrik-Upgrade T1→T2→T3 | Tooltip-Verb für das Upgrade: „Ausreifen“ / „Mature“ |
| **Nachwachsen:** Gezogener Kristall wächst langsam nach. | Regeneration über `health.regenPerSec` (Datenpfad wie beim Vogt, U1) | Strukturen und Rädelsführer regenerieren nach Vorbild-Relation (§9.3). Mobile Einheiten regenerieren nur über Veteranenstufen (U9). |
| **Ein Rädelsführer pro Rotte** | Kommandant ist einzigartig | SACU (U15, Post-MVP) wäre ein „Sekundant / Second“ aus einem „Tiefschacht / Deep Shaft“. |
| **Überschlag:** Der Rädelsführer jagt die gespeicherte Geflechtspannung durch seine Linse. | U8: Overcharge (optional) | Waffenname „Überschlag“ / „Flashover“ |
| **Fehde mit den Häusern, Streit unter Rotten** | Spiel gegen Varkan, Spiegel-Matches, KI-Gegner | Gegen ein Haus: „Die haben uns zu Schlacke erklärt.“ Rotte gegen Rotte: „Eine Kluft, eine Rotte.“ Die KI ist eine rivalisierende Rotte oder ein Haus. |

### 2.3 Verhältnis zu Varkan (Welt-Konsistenz)

- **Ergänzt, widerspricht nicht:** Die Charta-Regel „Kein Mensch betritt den Boden“ bekommt eine Vorgeschichte, nämlich die Erste Absenkung und das Bruchjahr. Varkans offizielle Lesart (Schutzregel) bleibt stehen. Die Skarn-Lesart ist Verrat. Beide Sichten gelten nebeneinander, und es gibt keine Bösewichte.
- **Gleicher Kern, andere Begründung:** Bei Varkan erlischt der Anspruch nach Charta-Recht, weil der Vogt nicht mehr am Ort ist. Bei den Skarn erstarrt die Armee physisch, weil das Geflecht reißt. Das Ergebnis ist in beiden Fällen dieselbe Siegbedingung (A4).
- **Spiegelbilder:** Varkan steuert aus dem Orbit, der Rädelsführer sitzt selbst in seiner Maschine. Er ist der einzige Mensch auf dem Schlachtfeld. Varkan kommt von oben (Lotung), die Skarn kommen von unten (Durchbruch). Varkan gießt, die Skarn ziehen.
- **Varkan-Bezug in `faction.md` (Varkan) §2.2:** Dort ist vorgesehen, dass U19 eine Fraktion *außerhalb* des Kompakts einführt. Das sind die Skarn. Varkans Datei bleibt unverändert. Beim Zusammenführen kann dort ein Querverweis ergänzt werden.

### 2.4 Ton

- **Ja:** trotzig, schnell, spöttisch. Wir-Gefühl der Rotte („Wir sind noch da“), Galgenhumor („Unkraut vergeht nicht“), Spott über die Charta („Charta? Nie unterschrieben.“), Stolz auf die Schimpfwörter der Häuser (§7.1).
- **Nein:** Körperhorror, Gore oder Fleisch-Maschinen-Ekel (die Bindung zeigt sich über Sehnen und Licht, nie über Fleisch), Religion und Erleuchtung, Heldenpathos, Rache-Schwüre. Die Skarn sind Rebellen und keine Bösewichte, die Häuser sind Gegner und keine Unterdrücker-Karikaturen.
- **Beschreibungstexte (`descKey`):** höchstens 2 Sätze. Satz 1 sagt, was die Einheit tut, Satz 2 bringt eine Zeile Rottenflavor.
- **Lore-Synonyme** wie „Biss“, „Geflecht“ oder „Grus“ stehen nur in Flavor-Texten, nie in Zahlenanzeigen.

### 2.5 Begriffe, die nicht verwendet werden

| Nicht verwenden (FA-Begriffsfeld) | Stattdessen (DE / EN) |
|---|---|
| Armored Command Unit, „Commander“ als Einheitenname | Rädelsführer / Ringleader |
| Quantum Gate, Quantum Warp, Warp-in | Durchbruch / Breach, Tiefschacht / Deep Shaft |
| Overcharge | Überschlag / Flashover |
| nuklearer ACU-Tod | Geflechtriss / Tangle Snap |
| Nanites, Nano-…, Loyalitäts- oder Umprogrammierungs-Lore der Vorbild-Fraktion, Befreiungsbewegungen mit Führerfigur aus FA | Geflecht / Tangle, Sehne / Sinew, Nachwachsen / Regrowth |
| „Nation“ als Fraktionsnamen-Suffix, FA-Fraktions- und Einheitennamen (Grep-Liste, §7.1) | Rotte / Pack, Skarn-Geflecht |
| Spinnen-Experimental-Bezeichnungen, „Spiderbot“ | kein Einheitenname mit „Spinne“; Arachniden nur als konkrete Arten (Tarantel, Zecke, Milbe) |
| „Rottenführer“ (historisch belasteter Dienstgrad) | nie verwenden; der Anführer heißt Rädelsführer |
| „Hydrocarbon Plant“ | Fumarole / Fumarole (ID `hydro` bleibt intern) |

Das Feld `faReference` in `roster.json` zitiert FA-Blueprint-IDs und generische Rollenstrings nur zu Entwicklungszwecken (`devOnly: true`). Der Blueprint-Build entfernt es per Lint. Es darf nie in `view.json` oder i18n landen.

---

## 3. Designsprache „Kluftwuchs“

### 3.1 Leitmotiv

**Gewachsen, nicht gegossen.** Jede Einheit ist ein flacher, facettierter Panzer aus glänzendem Schwarzchitin, der auf Knickbeinen hoch über dem Boden hängt. Obenauf liegen teamfarbene Rückenplatten, dunkelrote Sehnen verbinden die Gelenke. Waffen sind Granatlinsen, Dornen und Schwänze, also spitze Kristall- und Gliederformen. Es gibt keine Rundungen, keine Nieten und keine Rohre.

**Kontrast zu Varkan:** matt gegen glänzend, gedrungen gegen gespreizt, Kette gegen Bein, rund arbeitende Technik gegen spitze Werkzeuge. Aus der Spielkamera trennt schon der Umriss die Fraktionen, weil die gespreizten Beine eine größere, zackige Silhouette ergeben. **Kontrast zu f3/f4:** Die beiden anderen Fraktionen lehnen sich an geschwungen-elegante bzw. fremdartig-organische Vorbilder an. Skarn bleibt deshalb streng eckig und facettiert, ohne jede Kurve.

### 3.2 Formregeln

| Regel | Umsetzung |
|---|---|
| **Keil** | Alle Land-Rümpfe sind flache Sechseck-Prismen mit Bugspitze, deren Oberkanten scharf und nicht gefast sind. Die Höhe beträgt höchstens 0,35 × Rumpflänge (flacher als Varkans Wanne mit 0,45). Die Spitze zeigt die Fahrtrichtung. |
| **Flach = Körper, Spitz = Werkzeug** | Panzer, Platten und Sockel sind flache Facetten. Alles, was zielt, baut oder arbeitet (Linse, Dorn, Schwanz, Nadel, Fühler), ist spitz oder gegliedert. Dieser Kontrast trägt die Lesbarkeit, analog zu Varkans „Kante = Körper, Rund = Technik“. |
| **Hochbein** | Die Knie liegen über der Rumpfoberkante, die Füße spreizen auf das 1,4- bis 1,8-fache der Rumpfbreite. Die Beine sind nur Optik und tragen keine Rolle. **Beinzahl = Gewichtsklasse:** 2 Beine = leicht und schnell (Läufer, Späher), 4 Beine = Linie (alle übrigen T1/T2), 6 Beine = schwer (alle T3 und Rädelsführer). |
| **Signatur-Formen** | **Granatlinse** (gestreckte Doppelpyramide auf kurzem Hals, waagerecht) = Direktfeuer. **Schwanz** (drei gebogene Keilsegmente über dem Rücken, Spitze schräg nach vorn) = Artillerie. **Dornenkamm** (senkrechte Dornen) = Flugabwehr. **Spule mit Nadeln** = Bauen. **Herzdruse** = Rädelsführer. Jede Form gehört genau einer Rolle (§5). |
| **Richtung** | Die Linse zeigt die Zielrichtung, die Bugspitze die Fahrtrichtung. Luftfahrzeuge zeigen die Richtung über ihren Grundriss. |
| **Symmetrie ist die Norm** | Nur Engineers sind asymmetrisch (Nadeln verschieden lang). Der Rädelsführer ist bewusst **symmetrisch**: Linse mittig unter dem Kopf, zwei Bau-Nadeln als Taster links und rechts. Das FA-Schema „Waffenarm rechts, Bauarm links“ ist verboten. |
| **Keine Filigranteile** | Wie bei Varkan: Kein Teil ist schmaler als 12 % der Einheitenlänge, `iconThreshold` mobil 25 px. Mindestmaße bei 1,4 WU Rumpflänge: Dorn-Ø an der Basis ≥ 0,17 WU, Beinsegment ≥ 0,17 WU, Linse ≥ 0,25 WU dick, Fühler ≥ 0,17 WU. Beine sind die größte Gefahr für diese Regel. Ihre Dicke wird deshalb **nicht** mit der Einheit herunterskaliert, sondern auf ≥ 0,17 WU geklemmt. |
| **Gebäude** | Jedes Gebäude wächst aus einer facettierten **Kruste** (Sockel mit unregelmäßig gezackter Oberkante, Footprint = Grid). Das Rollen-Element sitzt obenauf: Druse, Nestmaul, Linse, Dornenkamm, Fühler, Netzring oder Schwanz. |
| **Placeholder = Final-Silhouette** | wie Varkan: Final-Assets ergänzen nur Facettendetails, Sehnen und Maserung. Der Umriss darf sich höchstens um 10 % ändern. |

### 3.3 Kitbash-Teilekatalog

Die Part-Keys sind englisch (Code), die DE-Namen stehen für Dokumentation und Tooltips. Jeder Part ist ein Low-Poly-Primitiv, das `view.placeholder` prozedural erzeugen kann. Geteilt mit Varkan sind nur `legs` und `wing`. Alles andere ist neu, aber aus denselben Grundkörpern gebaut (Prisma, Pyramide, Kegel, Zylinder).

| Part-Key | DE | Primitiv | Tris LOD0 | Verwendung |
|---|---|---|---|---|
| `carapace` | Panzer | flaches Sechseck-Prisma mit Bugspitze, scharfe Oberkanten | ≈ 24 | Rumpf aller Landeinheiten, Torso des Rädelsführers, Falltür der Falle, Wabe-Stapel |
| `legs` | Beine | prozedural (Render-Pfad, vorhanden), neuer Instanzparameter **Beinzahl 2/4/6**, Knie hoch | – | alle Landeinheiten und der Rädelsführer |
| `lens` | Granatlinse | gestreckte Doppelpyramide, 4-seitig | ≈ 8 | Direktfeuer (Einheiten, Falle, Rädelsführer, Hummel) |
| `neck` | Hals | kurzes Vierkantprisma | ≈ 12 | Linsenträger (Yaw), Schwanzansatz |
| `tail` | Schwanz | Kette aus 3 verjüngten Keilsegmenten, gebogen, als ein Mesh | ≈ 36 | Artillerie (mobil und statisch), Wolfsmilch |
| `pod` | Kapsel / Köcher | gestrecktes Sechseck-Prisma bzw. breite flache Box | ≈ 20 | Schwanzspitze der Artillerie, Raketen-Köcher, Bombenkapsel |
| `spike` | Dorn | 4-seitiger Kegel | ≈ 8 | Flugabwehr (senkrecht), Hecke, Igel |
| `spool` | Spule | 6-seitiger Zylinder mit zwei Randscheiben, liegend | ≈ 60 | **nur Flow-Einheiten:** Engineers, Rädelsführer-Rücken, Nest |
| `needle` | Nadel | gestrecktes 4-seitiges Prisma mit Spitze, 2 Glieder | ≈ 16 | Engineer-Bauarme, Taster des Rädelsführers |
| `antenna` | Fühler | Vierkantprisma, 2 Glieder, geknickt | ≈ 16 | Späher, Radar (Fühler), Motte |
| `druse` | Druse | Cluster aus 3 Sechskantprismen mit Spitzen | ≈ 54 | **nur Flow-Einheiten:** Egel, Druse (Pgen), Fumarole, Herzdruse |
| `webring` | Netzring | flacher Sechseck-Ring | ≈ 24 | Schild (Gespinst, Kokon), Egel-Kranz, Fumarole, Landenetz des Luftnests |
| `crust` | Kruste | Sechs- bzw. Achteck-Prisma mit gezackter Oberkante | ≈ 32 | Sockel aller Gebäude |
| `gate` | Nestmaul | V-Portal aus zwei schrägen Keilplatten | ≈ 24 | Fabriken |
| `wing` | Flügel | flaches Dreiecks- bzw. Trapezprisma (Varkan-Part) | ≈ 12 | Luft, jeweils paarweise (vorn und hinten) |
| `abdomen` | Hinterleib | gestrecktes Oktaeder, 6×3 | ≈ 36 | nur Bomber-Rumpf (Monopol; die Stechmücke hat einen schlanken `carapace`-Keil) |
| `buzzdisc` | Schwirrscheibe | flache Sechseckscheibe, opak, dunkel gestreift | ≈ 14 | Gunship-Antrieb (Rotor-Ersatz ohne Alpha) |

**Budget (Abnahmekriterium, wie Varkan):**
- Mobile Einheiten: 4–7 Parts, davon höchstens 2 animiert. Strukturen: 4–9 Parts. `legs` zählt als ein Part, unabhängig von der Beinzahl.
- Platzhalter-Mesh ≤ 350 Tris LOD0 (ohne Beine, die der Render-Pfad erzeugt).
- **Ein Visual pro Rolle = ein Superset-Mesh** mit Tech-Bitmaske pro Vertex (Varkan §3.3). Die Beinzahl ist ein Instanzparameter des Bein-Renderers und kein Part, das Superset bleibt also gleich groß. Ziel: **≤ 28 Visuals** für 50 Blueprints, damit Varkan + Skarn in einem Match ≤ 56 Visuals halten. Das Draw-Budget für zwei Fraktionen ist offen (§11.2 Nr. 4).
- **Bein-Budget:** Die Beine sind die teuerste Skarn-Eigenheit. Jenseits der LOD-Grenze (180 WU) frieren sie in Standpose ein, im Strategic Zoom entfallen sie. Ab 150 sichtbaren Skarn-Einheiten schaltet der Renderer von IK auf eine gebackene Laufzyklus-Animation um (offen, §11.2 Nr. 5).

### 3.4 Tech-Skalierung per Kitbash

| Tech | Maßstab mobil | Höhe Strukturen | Tech-Streifen | Zusatz |
|---|---|---|---|---|
| T1 | 1,0 | 1,0 | 1 | Grundform, 2 oder 4 Beine |
| T2 | 1,3 | 1,2 | 2 | zweite Linse bzw. breiterer Schwanz, Seitenplatten am Panzer (`carapace`, flach) |
| T3 | 1,7 (bei 1×1-Footprint max. 1,4) | 1,4 | 3 | **6 Beine**, Doppelaufbau (zweite Linse, zweiter Schwanz) oder überlanger Panzer |

- Maßstabsregeln für mobile Einheiten und Strukturen sind dieselben wie bei Varkan (§3.4 dort): Die Kruste füllt 100 % des Footprints, In-Place-Upgrades wachsen nur in der Höhe.
- T3 erkennt man an Maßstab, **6 Beinen**, Zusatz-Parts und 3 Streifen.
- **Tech-Streifen** (fraktionsübergreifend gleiche Regel): 1–3 Querstreifen im hinteren Drittel des Panzers als Maske, Breite 0,10 WU × Maßstab. Die Farbe ist **quarzweiß**, bei Engineers mit Quarz-Deck schwarz `#141418`. Rädelsführer und Hecke tragen keine Streifen. Die Zahl entspricht exakt den Tech-Kerben im Icon.

### 3.5 Granatglut als Spielinformation (nur View, kein Sim-Einfluss)

Die Skarn übernehmen Varkans **Glut-Monopol** als fraktionsübergreifende Regel: **Ein dauerhaft leuchtender großer Punkt bedeutet immer Ökonomie oder Bau.** Das Licht ist bei den Skarn granatrot statt glutorange.

| Klasse | Wer | Fläche | Bedeutung |
|---|---|---|---|
| **Nervennaht** | alle Einheiten | ≤ 2 %: Beingelenke, Sehnenansätze, Linsenkern (nur beim Schuss) | Zustand der Einheit |
| **Herzkern** | nur **Flow-Einheiten**: Rädelsführer, Engineers, Nester, Egel, Druse, Fumarole | 3–6 %: Spulenachse, Drusenspitzen, Nestmaul, Herzdruse | „Hier entsteht oder fließt Wirtschaft“ |

- **Linsen leuchten nicht dauerhaft.** Im Leerlauf ist die Granatlinse dunkles, glänzendes Glas (`lens` mit `mat:'sinew'`, hohe Spiegelung). Beim Schuss blitzt sie ≈ 0,3 s auf. Das gleicht Varkans Kelle, die nur beim Schuss glüht.
- `spool` und `druse` gibt es nur bei ECONOMIC, FACTORY und ENGINEER. Das ist derselbe Lint wie Varkans `stack`-Regel.

**Zustände über den View-Parameter `flowGlow` (derselbe Parameter wie bei Varkan):**
- Leerlauf: Nervennähte glimmen schwach, Herzkerne pulsieren langsam (≈ 0,5 Hz, „Herzschlag“).
- Feuern: Linse blitzt auf, bei Artillerie blitzt die Schwanzkapsel.
- Bauen: Spule dreht sich, Nadelspitzen und Nestmaul leuchten auf.
- **Energy-Stall (E3):** Herzkerne aller betroffenen Verbraucher fallen auf Dunkelrot und **flackern unregelmäßig** (Varkan erkaltet gleichmäßig). Der Stall bleibt so im Feld lesbar.
- Schaden < 50 % HP: Gelenke sprühen kleine Funkenbögen.
- Regeneration aktiv: ein feines Schimmern läuft über die Facetten (nur View, zeigt `regenPerSec` > 0).
- Wrack: grau, gesprungen, ohne Emissive (Wreck-Shader).

**Bau und Reclaim:**
- **Baustrahl = Fadenstrom:** 2–3 dünne parallele Granatfäden zwischen Nadelspitze und Ziel statt eines einzelnen Stroms. Ihre Dichte skaliert mit der fließenden Build Power nach Stall-Drosselung (E2/E3). Das ist dieselbe Datenquelle wie Varkans Gießstrom, nur ein anderes Partikel-Preset.
- **Bau-Dissolve = Kristallisieren:** Rohbauten wachsen als schwarze Facetten von unten nach oben, die Wachstumskante leuchtet granatrot (derselbe Build-Dissolve-Shader wie bei Varkan, andere Kantenfarbe und eine Facetten-Rauschmaske).
- **Reclaim:** Das Wrack zerfällt von oben zu Grus, der als Fadenstrom zum Engineer rinnt.
- **Budget:** kein Extra-Pass, nur HDR/Bloom der Presets.

### 3.6 Placeholder-Schema

Es gilt derselbe Erweiterungsvorschlag wie bei Varkan (`placeholder.parts[]`, `tech`). Zusätzlich braucht Skarn:
- **neue Primitive** im Blueprint-Compiler: `lens` (Doppelpyramide), `spike` (Kegel), `tail` (gebogene Segmentkette), `druse` (Prismencluster), `webring` (Sechseck-Ring), `spool`, `abdomen`, `crust`, `gate`, `buzzdisc`,
- **Leg-Parameter** `legs: { count: 2|4|6, span: number }` im View-Blueprint,
- **Material-Slots:** dieselben fünf `matId`-Slots wie Varkan, fraktionsweise umbenannt (Tabelle §4.1). Der Shaderpfad bleibt damit gleich.

Das alles liegt nur im View, betrifft also `viewHash` und nicht `simHash`. Die Umsetzung ist ein eigener Arbeitsschritt.

---

## 4. Farben & Teamfarben

### 4.1 Materialien

| Slot (`matId`) | Varkan | Skarn-Material | Farbe (linear, Richtwert) | Charakter | Anteil |
|---|---|---|---|---|---|
| 0 `body` | Gusseisen | Schwarzchitin | Schwarz mit Violettstich `#18171C`, Unterseiten `#0E0D11` | Roughness 0,3, glänzend, scharfe Glanzkanten, Flat Shading | 40–50 % |
| 1 `team` | Bannerplatte | Rückenplatte | Teamfarbe | Roughness 0,45, seidenglänzend | 25–40 % |
| 2 `sinew` (Varkan `copper`) | Kupfer | Sehne / Granatglas | Dunkelrot `#6E1A22`, Glanzkanten `#A8303C` | Metallic 0,2, Spiegelung hoch | 6–10 % |
| 3 `glow` | Glut | Granatglut (emissive) | Kern `#FFB0BE`, Falloff `#E0203F`, HDR 3–6 | pulsiert nach `flowGlow` | 2–6 % |
| 4 `quartz` (Varkan `ceramic`) | Keramik | Quarz | Milchweiß, kühl `#D6D3DC` | halbmatt | Tech-Streifen, Engineer-Deck, Nadeln des Rädelsführers |

- **Hell oben, dunkel unten** (fraktionsübergreifend): Oberseiten sind teamfarben oder quarzweiß, Unterseiten, Beine und Linsen sind dunkel. Dazu kommen die glänzenden Glanzkanten des Chitins, die die Einheit ohne Outline vom Terrain abheben. Das ist der Skarn-Ersatz für Varkans matten Hell-Dunkel-Kontrast.
- **Rot ohne Teamfarben-Konflikt:** Das Rot der Fraktion steckt in Sehnen (dunkel, Luma < 0,15) und Glut (klein, nur Flow). Die Rückenplatten sind immer Teamfarbe. So bleibt auch eine blaue Skarn-Rotte klar blau.
- **Quarz als Klassenkennung:** Quarzweiße Oberplatten tragen nur Engineers und die Taster-Nadeln des Rädelsführers (Varkan-Regel sinngemäß).
- **Masken-Layout:** identisch zu Varkan (`u8 matId` für Platzhalter, RGBA-Maske für Final-Art: R = Team, G = Glut, B = Sehne/Metallic, A = Staub/AO).
- **Staub-Gradient:** Die unteren 25 % der Beine verlaufen im Shader nach Krustengrau `#3A3634` (Gegenstück zu Varkans Ruß am Schlot).

### 4.2 Teamfarben-Flächen

| Klasse | Teamfarbe auf | Mindestanteil an der Draufsicht (Standardkamera 40–60°, **inklusive Beine**) |
|---|---|---|
| Mobile Land | Rückenplatte des Panzers (≥ 80 % der Panzeroberseite), Oberseite des Schwanzes | **≥ 30 %** |
| Luft | Oberseite des vorderen Flügelpaars und des Rückens | **≥ 45 %** |
| Rädelsführer | Kopfkamm, Rückenplatten um die Herzdruse | ≥ 35 % |
| Engineers | Spulen-Randscheiben und Panzer-Seitenband (Deck ist Quarz) | ≥ 25 % |
| Strukturen | Oberkante der Kruste, bei Nestern zusätzlich die Maulplatten | 20–30 % |
| Hecke | nur die Dornenspitzen-Kappen | ≈ 10 % (bewusst ruhig) |

- **Nie teamfarben:** Glut, Quarz, Linsen, Beine, Unterseiten.
- **Messung:** wie Varkan (Parts-Spec oder Masken-Pixelzählung im Render-Bench). Weil die gespreizten Beine die Draufsicht vergrößern, liegt die Rückenplatte bewusst bei ≥ 80 % der Panzeroberseite. Lint: mindestens ein `mat:'team'`-Part pro Blueprint.

### 4.3 Teampalette

**Dieselbe 8-Farben-Palette wie Varkan (§4.3 dort), fraktionsübergreifend.** Die Teamfarbe unterscheidet Spieler, nicht Fraktionen. Die Fraktion erkennt man an Form und Material.

- **Glut-Konflikt (Skarn-Variante):** Granatglut liegt bei ≈ 350°. Liegt eine Teamfarbe weniger als 25° davon entfernt, wechselt die Glut dieser Armee auf **Rosaquarz-Weiß** `#FFE0E8` mit weniger Sättigung. In der Standardpalette betrifft das **Rot** (≈ 4°) und **Pink** (≈ 327°). Die Sehnen bleiben dunkel und tragen keine Information.
- **Farbenblindheit:** Rolle und Tech liegen in Form, Glyphe und Strichzahl. Die Fraktion liegt in Glanz, Beinen und Umriss. Nichts hängt allein an der Farbe.

---

## 5. Silhouetten-Regeln

### 5.1 Die sechs Lesbarkeits-Gesetze (Varkan-Gesetze, fraktionsübergreifend)

1. **Draufsicht zuerst.** Jede Rolle ist als Schattenriss aus der Spielkamera bei 32 px und 48 px eindeutig, **inklusive Beinen**.
2. **Monopol-Merkmal.** Jede Rolle hat genau ein exklusives Formmerkmal (Tabelle 5.2).
3. **Rolle am Aufbau, Gewicht an der Beinzahl.** Die Rolle liest man immer am Rücken-Part (Linse, Schwanz, Dornen, Spule). Die Beinzahl zeigt nur die Gewichtsklasse: 2 = schnell und leicht, 4 = Linie, 6 = schwer / T3.
4. **Tech durch Skalierung, nicht durch neue Form** (§3.4). Die Beinzahl springt nur bei T3 auf 6, das Rollenmerkmal bleibt gleich.
5. **Winkel-Code (fraktionsübergreifend gleich):** waagerecht = direkt (Linse), schräg = indirekt (Schwanzspitze und Köcher bei 45–55°), senkrecht = gegen Luft (Dornen ≥ 75°), Ring = Schild oder Flow-Anschluss, hoch und dünn = Intel (Fühler). Wer Varkan lesen kann, kann Skarn lesen.
6. **Nichts unter 3 px** bei `iconThreshold` (mobil 25 px). Beinsegmente sind geklemmt (§3.2).

### 5.2 Rollen-Tabelle (MVP)

| Rolle | **Hero-Feature (Monopol)** | Pflicht | Verboten |
|---|---|---|---|
| **Direktfeuer Linie (Zecke, Ohrwurm)** | **Granatlinse** waagerecht auf kurzem Hals, ragt über die Bugspitze | Linse ≥ 50 % der Rumpflänge, 4 Beine; T2 mit zwei parallelen Linsen und Zangen-Platten am Bug | Schwanz, senkrechte Dornen |
| **Direktfeuer-Läufer (Floh, Milbe, Tarantel)** | Linse auf **2 Beinen** (T1/T2) bzw. Doppellinse auf 6 Beinen (T3) | Panzer kürzer als bei der Linie, Beine länger als der Panzer | Schwanz |
| **Präzisionsläufer (Langbein, T3)** | Linse **extrem lang** (≥ 1,2 × Rumpflänge), Panzer hoch über dem Boden (Knie ≥ 1,5 × Rumpflänge) | 6 überlange Beine | zweite Linse |
| **Artillerie (Nessel, Stechapfel; statisch Schierling, Bilsenkraut)** | **Schwanz** über dem Rücken, Spitze mit Kapsel zeigt schräg nach vorn (45–55°) | Rumpf ≥ 1,3× länger als breit, Kapsel-Ø ≥ 0,34 WU (≥ 2× Dorn-Ø) | Linse, waagerechte Elemente |
| **Raketenwerfer (Wolfsmilch, T2)** | Schwanz trägt statt der Kapsel einen **breiten Köcher** (0,5 × 0,25 × 1,1 WU) bei 50° | Köcher ≥ 2× so breit wie ein Dorn | Kapsel, Linse |
| **Flugabwehr (Klette, Ginster, Hagedorn; Schlehe, Igel)** | **Dornenkamm:** 3–5 senkrechte Dornen (≥ 75°) quer zur Laufrichtung | Dorn-Ø ≤ halbe Kapselbreite, ≥ 0,17 WU | Linse, Schwanz, Kapsel |
| **Engineer (Flicker, Stopfer, Weber)** | **Spule** quer auf dem Rücken (Glutkern in der Achse) + **Quarz-Deck** | Anzahl der Nadeln = Tech (1/2/3, verschieden lang), asymmetrisch; 4 Beine (T3: 6) | jede Waffenform |
| **Land-Späher (Schabe)** | kleinster Panzer + **zwei lange Fühler** schräg nach vorn oben | Fühler ≥ 1,0 × Rumpflänge, 2 Beine | Linse, Ring |
| **Mobiler Schild (Gespinst)** | **Netzring** waagerecht als höchster Punkt, auf zwei Fühler-Stützen | Ring-Ø ≥ 1,2 × Rumpfbreite | Linse, Schwanz |
| **Rädelsführer** | **Herzdruse** auf dem Rücken (stärkster Glutpunkt) über **6 Beinen**, größte Landeinheit bis T2 (Höhe ≥ 2,0 WU, Beinspanne ≥ 3,2 WU) | Linse mittig unter dem Kopf, zwei Quarz-Nadeln als Taster links und rechts, Spule im Rücken, teamfarbener Kopfkamm | Waffenarm rechts + Bauarm links, aufrechter Zweibeiner (das ist Varkans Vogt-Silhouette) |
| **Abfangjäger (Bremse)** | **zwei schmale, stark gepfeilte Flügelpaare** (X-Grundriss, spitz nach hinten) | lang > breit | Hinterleib, breite Flügel |
| **Bomber (Brummer)** | **dicker Hinterleib** (`abdomen`) + kurze, breite, gerade Flügel (T-Form von oben) | Hinterleib ≥ 1,4 × Flügeltiefe, ragt hinten sichtbar über | Pfeilung > 30° |
| **Gunship (Hummel)** | **keine Flügel**, `buzzdisc` über dem Rumpf + Linse unten | – | Flügel |
| **Jagdbomber (Stechmücke)** | gepfeiltes Flügelpaar mit **zwei Kapseln an den Flügelspitzen** | Spannweite +30 % gegenüber Bremse | Schwirrscheibe, Bauch-Hinterleib |
| **Luft-Späher (Motte)** | kleinster Flieger, zwei Fühler nach vorn | – | Waffen-Parts |
| **Mex (Egel)** | **Netzring** um den Spot + zentrale Druse (Glutkern) | niedrig, bleibt 2×2; T3 mit doppeltem Ring | Schwanz |
| **Pgen (Druse)** | Kristallcluster auf Kruste, **1–3 Drusen** (Zahl = Tech) | Drusenhöhe ≥ 1,5 × Krustenhöhe | Ring |
| **Hydro (Fumarole)** | offener Netzring mit **drei** Drusen darin und Dampfsäule | – | – |
| **Storage** | Mass (Wabe): **eckiger Stapel** aus Panzerplatten; Energy (Glimmzelle): **zwei flache Sechseckzellen** mit Deckelglimmen (Nervennaht, kein Herzkern) | flach | Druse, Spule |
| **Fabrik (Landnest, Luftnest)** | **Nestmaul** (V-Portal, offene Spitze = Ausgang); Land mit Rampe, Luft mit Landenetz (Netzring flach) | Nestmaul = Herzkern | – |
| **Punktverteidigung (Falle)** | **dieselbe Linse** wie die Zecke unter einer schrägen Falltür-Platte | – | – |
| **AA / SAM (Schlehe, Igel)** | Dornenkamm auf Kruste; Igel mit doppelt so vielen, dickeren Dornen im Halbkreis | – | Druse |
| **Artillerie T2/T3 statisch** | großer Schwanz auf Kruste (Schierling); Bilsenkraut auf 8×8 mit Kapsel Ø 3,0 WU und doppeltem Schwanz | – | Linse |
| **Radar (Fühler)** | **zwei hohe, geknickte Fühler** als V, 35° gespreizt | hoch und dünn | Ring |
| **Schildgenerator (Kokon)** | Netzring waagerecht auf Fühler-Dreibein | Ring-Ø ≥ 0,8 × Footprint-Kante | V-Fühler |
| **Mauer (Hecke)** | niedrige Kette aus Krustenblöcken mit kurzen Dornen, nur die Spitzen-Kappen teamfarben | Dornen ≤ 0,3 × Blockhöhe (keine AA-Lesart) | – |

**Pflicht-Paartest MS9 (nur ●-Blueprints):** Zecke↔Klette, Nessel↔Klette, Wolfsmilch↔Ginster, Ohrwurm↔Wolfsmilch, Floh↔Schabe (beide 2 Beine: Linse gegen Fühler), Flicker↔Schabe, Falle↔Schlehe, Egel↔Druse, Druse↔Glimmzelle, Wabe↔Glimmzelle, Schlehe↔Hecke.
**Pflicht-Paartest MS14:** Brummer↔Bremse, Bremse↔Stechmücke, Motte↔Brummer, Fühler↔Kokon, Schabe↔Gespinst, Bilsenkraut↔Druse III, Egel III↔Fumarole.
**Fraktions-Paartest (neu):** Punze↔Zecke, Kelle↔Nessel, Sieb↔Klette, Lehrling↔Flicker, Vogt↔Rädelsführer. Hier muss die **Rolle gleich** gelesen werden (Winkel-Code) und die **Fraktion verschieden** (Umriss mit Beinen, Glanz). Beides gilt bei 48 px für 5 von 5 Testern.

### 5.3 Abnahme

Es gelten Varkans Punkte 1–5 (§5.3 dort) sinngemäß: Silhouettenblatt, Graustufen-Aufsicht, Teamfarben-Anteil, Kitbash-Budget und Monopol-Lint. Die Lint-Regeln für Skarn:
- Nur `aa`/`sam` enthalten `spike` mit Pitch ≥ 75° (Hecke: Dornen ≤ 0,3 × Blockhöhe, gesondert erlaubt).
- Nur `arty`/`mml` enthalten `tail`.
- Nur `lens` mit Pitch ≤ 15° ergibt Direktfeuer.
- `spool`, `druse` und `mat:'glow'` gibt es nur bei ECONOMIC, FACTORY und ENGINEER.
- `abdomen` gibt es nur bei BOMBER ohne ANTIAIR (Brummer).
- Mindestens ein `mat:'team'`-Part pro Blueprint.

---

## 6. Strategic-Icon-Sprache: gemeinsame Grammatik

### 6.1 Grundsatz

**Skarn nutzt exakt die Icon-Grammatik von Varkan (`docs/design/faction.md` §6), ohne eigene Formen, Glyphen oder Farben.** Wie in FA sind Strategic Icons fraktionsübergreifend identisch. Nur die Teamfarbe unterscheidet die Spieler. Im Strategic Zoom soll man die **Rolle** des Gegners lesen, nicht seine Fraktion.

- **Grundform** = Domäne, in Teamfarbe gefüllt: Quadrat mit Fase (Land), Dreieck (Luft), Kreis (Engineer), Sechseck (Gebäude), Tropfen (Kommandant), Mini-Quadrat (Mauer).
- **Glyphe** = Rolle (19 Tokens, `iconGlyphs`).
- **Tech-Kerben** = 1–3 Kerben oben rechts außerhalb der Grundform.
- Größen, Zustände, Radar-Blips, Ghosts und „im Bau“ sind unverändert (§6.5 dort).
- **Icon folgt der Rolle (ID), nicht dem Fahrwerk.** Die Zecke läuft auf Beinen, ist aber die Linie der Armee (`lnd_t1_tank`), also gilt `land_direct_t1`. Die `bot`-Glyphe bleibt den Läufer-Rollen vorbehalten (`lnd_t*_bot`).
- Die Tropfenform des Kommandanten heißt im Code neutral `cmd_commander`. Dass sie bei Varkan „Lot-Tropfen“ heißt, ist Flavor. Für Skarn steht sie für die hängende Herzdruse.

### 6.2 Zuordnung

| Skarn-Rolle | Icon-ID | wie bei Varkan |
|---|---|---|
| Rädelsführer | `cmd_commander` | Vogt |
| Flicker / Stopfer / Weber | `eng_build_t1..t3` | Lehrling / Geselle / Meister |
| Schabe | `land_intel_t1` | Funke |
| Floh / Milbe / Tarantel | `land_bot_t1..t3` | Stichel / Zange / Fallhammer |
| Zecke / Ohrwurm | `land_direct_t1` / `land_direct_t2` | Punze / Meißel |
| Langbein | `land_sniper_t3` | Reißnadel |
| Nessel / Stechapfel | `land_arty_t1` / `land_arty_t3` | Kelle / Pfanne |
| Wolfsmilch | `land_mml_t2` | Rinne |
| Klette / Ginster / Hagedorn | `land_aa_t1..t3` | Sieb / Rüttelsieb / Trommelsieb |
| Gespinst | `land_shield_t2` | Schürze |
| Motte / Bremse / Brummer / Hummel / Stechmücke | `air_intel_t1` / `air_aa_t1` / `air_bomb_t1` / `air_direct_t2` / `air_fbomb_t2` | Lerche / Turmfalke / Dohle / Krähe / Elster |
| Gebäude | `struct_<glyph>_t<n>` wie Varkan, Hecke = `wall` | – |

### 6.3 Reservierte Tokens für Post-MVP-Rollen (Vorschlag, fraktionsübergreifend)

| Token | Glyphe | Rolle | braucht |
|---|---|---|---|
| `stealth` | Ring mit Schrägstrich ⊘ (Intel negiert, 5 DE stark) | Tarnfeld-Träger / Tarnfeld-Generator | I5 |
| `amph` | *keine eigene Glyphe*: amphibische Landeinheiten behalten ihr Land-Icon | amphibischer Kampfläufer | M13 |
| Marine-Grundform | Halbkreis (bei Varkan schon reserviert) | Schiffe, auch wenn sie an Land laufen | U17 |

Diese Tokens gelten für alle Fraktionen und werden erst mit dem jeweiligen Feature in den Atlas aufgenommen.

---

## 7. Namenssystem

### 7.1 Regeln

1. **Ungeziefer und Unkraut.** Die Häuser nannten die Zurückgelassenen Ungeziefer und Unkraut. Die Skarn haben die Schimpfwörter übernommen: Jede Einheit trägt den Namen eines Tiers oder einer Pflanze, die man nicht loswird. Das ist die Kernidee des Namenssystems und zugleich Lore.
2. **Mobile Einheiten tragen einen Rufnamen** aus dem Wortfeld ihrer Rolle: echte, übersetzte DE/EN-Wortpaare, je ein Wort, möglichst ≤ 9 Zeichen (Ausnahmen wie bei Varkans *Trommelsieb*).
3. **Jede Tech-Stufe einer Rolle bekommt einen neuen Namen aus demselben Wortfeld**, kein „Mk II“.
4. **Gebäude heißen nach ihrer Funktion im Rottenjargon und tragen eine römische Stufe** (Druse II). In-Place-Upgrades behalten so ihre Identität. Einzel-Gebäude ohne Upgrade-Kette (Fumarole, Wabe, Glimmzelle, Igel, Hecke, statische Artillerie) tragen keine Stufe.
5. **Anzeige wie Varkan:** Rufname und darunter die übersetzte Funktionsrolle, zum Beispiel **Zecke** · *Kampfläufer* / **Tick** · *Battle Walker*.
6. **Verboten:** FA-Einheitennamen, FA-Fraktionsbegriffe, Eigennamen aus FA-Lore, Varkan-Namen, bekannte Marken. Die **Grep-Liste** (357 Einheitennamen aus spooky-db 3810) wurde gegen alle Namen dieses Dokuments geprüft. Dabei wurden *Beetle*, *Thistle*, *Wasp* und *Hornet* als FA-Namen gefunden und ersetzt. Dazu kam der Teiltreffer *Thorn* (in einem FA-Namen enthalten), weshalb der AA-Turm *Schlehe / Sloe* heißt statt *Dorn / Thorn*. *Hawthorn* und *Thornapple* sind eigenständige Wörter und bleiben.

### 7.2 Wortfelder

| Rolle | Wortfeld | Namen |
|---|---|---|
| Rädelsführer | Rebellenrang | Rädelsführer / Ringleader |
| Engineers | Flickhandwerk (sie flicken, was die Häuser zerbrechen) | Flicker → Stopfer → Weber |
| Direktfeuer Land | kriechendes und beißendes Ungeziefer | Floh, Zecke, Ohrwurm, Milbe, Tarantel, Langbein |
| Aufklärung Land | Ungeziefer, das überall durchkommt | Schabe |
| Artillerie | giftige und brennende Unkräuter | Nessel, Wolfsmilch, Stechapfel, Schierling, Bilsenkraut |
| Flugabwehr | Dornen und Kletten | Klette, Ginster, Hagedorn, Schlehe, Igel |
| Luft | fliegendes Ungeziefer | Motte, Bremse, Brummer, Hummel, Stechmücke |
| Schild | Gespinste | Gespinst, Kokon |
| Wirtschaft und Basis | Rottenjargon für Unterschlupf und Beute | Egel, Druse, Fumarole, Wabe, Glimmzelle, Nest, Falle, Fühler, Hecke |

### 7.3 Unit-IDs und i18n

- **Schema identisch zu Varkan:** `<ns>:<domäne>_t<n>_<rolle>`, hier mit Namespace `f2:`. Domänen `cmd | lnd | air | str`, `nav` reserviert. Die Rollen-Tokens sind dieselben wie bei Varkan (§7.3 dort). Dieselbe Funktions-ID bedeutet in jeder Fraktion dieselbe Rolle und dieselbe Hotbuild-Taste.
- **Waffen:** `f2:wpn_<typ>_t<n>`, z. B. `f2:wpn_pulse_lens_t1`, `f2:wpn_emp_capsule_t1`, `f2:wpn_ringleader_flashover`, Death-Weapon `f2:wpn_tangle_snap`.
- **i18n-Keys:** `unit.f2.<id>.name`, `.role`, `.desc`. Umlaute stehen nur in DE-Strings (Rädelsführer, Stechmücke), IDs sind reines ASCII.

### 7.4 Roster-Plan (● = MS9-Kern, ○ = bis MS14)

Das ist der Plan für `roster.json`. Status ●/○ und Meilensteine sind 1:1 von Varkan übernommen, weil sie aus denselben Features folgen.

| | ID | DE | EN | Rolle DE / EN | Icon | Hotbuild |
|---|---|---|---|---|---|---|
| ● | `f2:cmd_commander` | Rädelsführer | Ringleader | Kommandant / Commander | `cmd_commander` | – |
| ● | `f2:lnd_t1_engineer` | Flicker | Patcher | Ingenieur / Engineer | `eng_build_t1` | Landnest: E |
| ● | `f2:lnd_t2_engineer` | Stopfer | Darner | Ingenieur / Engineer | `eng_build_t2` | Landnest: E |
| ○ | `f2:lnd_t3_engineer` | Weber | Weaver | Ingenieur / Engineer | `eng_build_t3` | Landnest: E |
| ● | `f2:lnd_t1_scout` | Schabe | Roach | Späher / Scout | `land_intel_t1` | Landnest: A |
| ● | `f2:lnd_t1_bot` | Floh | Flea | Leichter Sturmläufer / Light Assault Bot | `land_bot_t1` | Landnest: S |
| ● | `f2:lnd_t1_tank` | Zecke | Tick | Kampfläufer / Battle Walker | `land_direct_t1` | Landnest: Q |
| ● | `f2:lnd_t1_arty` | Nessel | Nettle | Mobile Artillerie / Mobile Artillery | `land_arty_t1` | Landnest: W |
| ● | `f2:lnd_t1_aa` | Klette | Bur | Mobile Flugabwehr / Mobile AA | `land_aa_t1` | Landnest: R |
| ● | `f2:lnd_t2_tank` | Ohrwurm | Earwig | Schwerer Kampfläufer / Heavy Battle Walker | `land_direct_t2` | Landnest: Q |
| ● | `f2:lnd_t2_mml` | Wolfsmilch | Spurge | Raketenwerfer / Missile Launcher | `land_mml_t2` | Landnest: W |
| ● | `f2:lnd_t2_aa` | Ginster | Gorse | Flak / Flak | `land_aa_t2` | Landnest: R |
| ○ | `f2:lnd_t2_shield` | Gespinst | Gossamer | Mobiler Schild / Mobile Shield | `land_shield_t2` | Landnest: D |
| ○ | `f2:lnd_t2_bot` | Milbe | Mite | Raketenläufer / Rocket Bot | `land_bot_t2` | Landnest: S |
| ○ | `f2:lnd_t3_bot` | Tarantel | Tarantula | Belagerungsläufer / Siege Bot | `land_bot_t3` | Landnest: S |
| ○ | `f2:lnd_t3_arty` | Stechapfel | Thornapple | Schwere Artillerie / Heavy Artillery | `land_arty_t3` | Landnest: W |
| ○ | `f2:lnd_t3_sniper` | Langbein | Longlegs | Präzisionsläufer / Sniper Bot | `land_sniper_t3` | Landnest: F |
| ○ | `f2:lnd_t3_aa` | Hagedorn | Hawthorn | Schwere Flugabwehr / Heavy AA | `land_aa_t3` | Landnest: R |
| ○ | `f2:air_t1_scout` | Motte | Moth | Aufklärer / Air Scout | `air_intel_t1` | Luftnest: A |
| ○ | `f2:air_t1_fighter` | Bremse | Gadfly | Abfangjäger / Interceptor | `air_aa_t1` | Luftnest: Q |
| ○ | `f2:air_t1_bomber` | Brummer | Bluebottle | Bomber / Bomber | `air_bomb_t1` | Luftnest: W |
| ○ | `f2:air_t2_gunship` | Hummel | Bumblebee | Kampfschweber / Gunship | `air_direct_t2` | Luftnest: E |
| ○ | `f2:air_t2_fbomber` | Stechmücke | Mosquito | Jagdbomber / Fighter-Bomber | `air_fbomb_t2` | Luftnest: R |
| ● | `f2:str_t1_mex` | Egel I | Leech I | Massebohrung / Mass Extractor | `struct_mass_t1` | Bau: Q |
| ● | `f2:str_t2_mex` | Egel II | Leech II | Massebohrung / Mass Extractor | `struct_mass_t2` | Bau: Q (Upgrade: Command Card) |
| ○ | `f2:str_t3_mex` | Egel III | Leech III | Massebohrung / Mass Extractor | `struct_mass_t3` | Bau: Q (Upgrade: Command Card) |
| ● | `f2:str_t1_pgen` | Druse I | Geode I | Kraftwerk / Power Generator | `struct_energy_t1` | Bau: W |
| ● | `f2:str_t2_pgen` | Druse II | Geode II | Kraftwerk / Power Generator | `struct_energy_t2` | Bau: W |
| ○ | `f2:str_t3_pgen` | Druse III | Geode III | Kraftwerk / Power Generator | `struct_energy_t3` | Bau: W |
| ● | `f2:str_t1_hydro` | Fumarole | Fumarole | Dampfkraftwerk / Geothermal Plant | `struct_hydro_t1` | Bau: E |
| ● | `f2:str_t1_mstore` | Wabe | Honeycomb | Massespeicher / Mass Storage | `struct_mstore_t1` | Bau: R |
| ● | `f2:str_t1_estore` | Glimmzelle | Glow Cell | Energiespeicher / Energy Storage | `struct_estore_t1` | Bau: T |
| ● | `f2:str_t1_fac_land` | Landnest I | Land Nest I | Landfabrik / Land Factory | `struct_fac_land_t1` | Bau: A |
| ● | `f2:str_t2_fac_land` | Landnest II | Land Nest II | Landfabrik / Land Factory | `struct_fac_land_t2` | Bau: Upgrade (Command Card) |
| ○ | `f2:str_t3_fac_land` | Landnest III | Land Nest III | Landfabrik / Land Factory | `struct_fac_land_t3` | Bau: Upgrade (Command Card) |
| ○ | `f2:str_t1_fac_air` | Luftnest I | Air Nest I | Luftfabrik / Air Factory | `struct_fac_air_t1` | Bau: S |
| ○ | `f2:str_t2_fac_air` | Luftnest II | Air Nest II | Luftfabrik / Air Factory | `struct_fac_air_t2` | Bau: Upgrade (Command Card) |
| ● | `f2:str_t1_pd` | Falle I | Snare I | Punktverteidigung / Point Defense | `struct_direct_t1` | Bau: Z |
| ● | `f2:str_t2_pd` | Falle II | Snare II | Punktverteidigung / Point Defense | `struct_direct_t2` | Bau: Z |
| ● | `f2:str_t1_aa` | Schlehe I | Sloe I | Flugabwehrturm / AA Tower | `struct_aa_t1` | Bau: X |
| ● | `f2:str_t2_aa` | Schlehe II | Sloe II | Flakturm / Flak Tower | `struct_aa_t2` | Bau: X |
| ● | `f2:str_t3_sam` | Igel | Hedgehog | Raketenabwehr / SAM Site | `struct_sam_t3` | Bau: X |
| ● | `f2:str_t1_wall` | Hecke | Hedge | Mauer / Wall | `wall` | Bau: C |
| ○ | `f2:str_t1_radar` | Fühler I | Feeler I | Radar / Radar | `struct_intel_t1` | Bau: D |
| ○ | `f2:str_t2_radar` | Fühler II | Feeler II | Radar / Radar | `struct_intel_t2` | Bau: Upgrade (Command Card) |
| ○ | `f2:str_t3_radar` | Fühler III | Feeler III | Radar / Radar | `struct_intel_t3` | Bau: Upgrade (Command Card) |
| ○ | `f2:str_t2_shield` | Kokon II | Cocoon II | Schildgenerator / Shield Generator | `struct_shield_t2` | Bau: F |
| ○ | `f2:str_t3_shield` | Kokon III | Cocoon III | Schildgenerator / Shield Generator | `struct_shield_t3` | Bau: Upgrade (Command Card) |
| ○ | `f2:str_t2_arty` | Schierling | Hemlock | Artilleriestellung / Artillery Emplacement | `struct_arty_t2` | Bau: V |
| ○ | `f2:str_t3_arty` | Bilsenkraut | Henbane | Schwere Artilleriestellung / Heavy Artillery Emplacement | `struct_arty_t3` | Bau: V |

**Zählung:** 23 mobile + 27 Struktur-Blueprints = **50**, davon **26 im MS9-Kern** (dieselben Rollen wie bei Varkan).
**Namenshinweise:** *Bur* ist die englische Klette, *Darner* der Stopfer (auch die Stopfnadel), *Gossamer* feines Spinnengewebe. *Longlegs* ist die englische Kurzform für den Weberknecht, *Bluebottle* die Schmeißfliege, für die im Deutschen umgangssprachlich *Brummer* steht.

### 7.5 Reservierte Post-MVP-Rollen (nicht gezählt)

| Reserve-ID | DE / EN | Rolle | braucht |
|---|---|---|---|
| `f2:lnd_t2_stealth` | Silberfisch / Silverfish | mobiler Tarnfeld-Träger | I5 |
| `f2:str_t2_stealth` | Nachtschatten / Nightshade | Tarnfeld-Generator | I5 |
| `f2:lnd_t2_amph` | Wasserläufer / Pondskater | amphibischer Kampfläufer | M13 |
| `f2:nav_t2_destroyer` | Bisamratte / Muskrat | Zerstörer, der an Land laufen kann | U17 + M13 |
| `f2:lnd_t3_armored` | Schildwanze / Shieldbug | schwer gepanzerter T3-Läufer | U10-Erweiterung (keine neue Mechanik, nur Budget) |

**Experimentals (T4, Post-MVP, „Plagen“):** Skolopender, Assel, Tsetse, Bärenklau (Game-Ender) und Myzel (Eco), IDs `f2:exp_*`. Design, Werte und Gates in `experimentals.md`, Daten in `roster.json` → `experimentals[]` (nicht gezählt).

---

## 8. Audio-Charakter „Stollenfunk und Schwirren“

**Leitbild:** ein Stollen voller Strom. Hoch, trocken, nervös. Glas und Chitin statt Eisen: Klicken, Zirpen, Knistern, Summen und kristallines Klirren. Im Mix ergänzen sich die Fraktionen, weil Varkan tief und metallisch klingt und Skarn hoch und gläsern. Die Frequenzbänder überlappen wenig.

### 8.1 Stimmen

- **Rädelsführer:** **echte, nahe Menschenstimme ohne Funkfilter.** Man hört Atem, Bewegung und manchmal ein Lachen. Sie ist das Gegenstück zu Varkans verrauschtem Uplink, denn der Rädelsführer sitzt selbst in der Maschine.
- **Alle anderen Einheiten:** das **Geflecht-Echo.** Die Einheiten haben keine eigene Stimme, sondern werfen Fragmente der Rädelsführer-Stimme zurück: granular zerhackt, hochgepitcht, mit Chitin-Klick-Transienten. **Vor jeder Quittung kommen Klicks: Ihre Zahl ist die Tech-Stufe, ihre Tonlage die Rollenfamilie.** Das ist dieselbe Regel wie Varkans Pips (fraktionsübergreifend), nur mit anderem Klangmaterial. Die Sätze werden lokalisiert, die Klicks sind sprachneutral.
- **Alerts (P8):** die **Tunnelwache**, eine junge Stimme aus dem Stollen. Knapp und sachlich, ohne Flavor-Wörter. Vor jeder Ansage kommt ein eigenes Dreifach-Zirpen, jeder Alert-Typ hat sein eigenes Wiederholintervall.

| Anlass | DE | EN |
|---|---|---|
| Rädelsführer Auswahl | „Was gibt's?“ | „What now?“ |
| Rädelsführer Bewegung | „Bin unterwegs.“ | „On my way.“ |
| Rädelsführer Angriff | „Beißen.“ | „Bite.“ |
| Engineer Bau | „Wird gezogen.“ | „Growing it.“ |
| Engineer fertig | „Hält.“ | „It'll hold.“ |
| Zecke Auswahl | *Klick* „Zecke.“ | *click* „Tick.“ |
| Nessel Angriff | *Klick (tief)* „Brennt gleich.“ | *click (low)* „Gonna sting.“ |
| Luft Auswahl | *Klick (schwirrend)* „Brummer summt.“ | *click (buzz)* „Bluebottle buzzing.“ |
| Alerts | „Kopf unter Feuer.“ · „Masse knapp.“ · „Energie knapp.“ · „Nest ausgereift.“ | „Head under fire.“ · „Mass low.“ · „Energy low.“ · „Nest matured.“ |

### 8.2 SFX-Palette

| Kategorie | Klang |
|---|---|
| **Signatur** | **singendes Granatglas** (wie ein angestrichenes Weinglas), sparsam: „Bau fertig“ als kurzer heller Ton, Ausreifen als aufsteigender Zweiklang, Geflechtriss als brechendes Glas mit abruptem Verstummen aller Einheiten-Loops. Eigene Kategorie im Voice-Manager, Cooldown ≥ 1 s. |
| **Flow-Grundton** | leises elektrisches Netzsummen (z. B. E3, mit Flügelschwirren moduliert) unter Nestern, Engineers und Drusen. **Beim Energy-Stall zerfällt es in unregelmäßiges Knistern** (Varkans Grundton kippt nach unten). Das Prinzip „Stall ist hörbar“ gilt fraktionsübergreifend. |
| **Direktfeuer (Linse)** | „Zssk“: heller Entladungs-Crack mit gläsernem Nachklingen. Höhere Tech klingt voller und länger, aber nicht lauter. |
| **Artillerie (Schwanz)** | Abschuss als peitschendes Schnalzen, im Flug ein Summen, Einschlag als Plopp mit elektrischem Knistern (EMP-Andeutung auch ohne K18) |
| **Raketen (Wolfsmilch, Igel, Hagedorn)** | spritzendes Zischen, wie Saft unter Druck |
| **Flugabwehr** | schnelles, trockenes Tackern (Dornen-Salven) in hoher Lage |
| **Antriebe** | leichte Läufer als schnelles Tick-Tick-Tick, die Linie als rhythmisches Klacken, 6-Beiner als tiefes, schweres Stapfen mit Gelenkknarzen. Flieger brummen und schwirren je nach Größe. |
| **Bau / Reclaim** | Kristallisieren (knisternd, wie gefrierendes Wasser), Tonhöhe steigt mit dem Fortschritt, am Ende der Signaturton. Reclaim als rieselnder Grus, rückwärts gefiltert. |
| **Befehle (UI)** | Auswahl: Doppelklick (Chitin). Bewegung: kurzes Schwirren mit fallender Tonhöhe. Angriff: scharfes Zirpen. Bauauftrag: Fadenzug (Zipp). |
| **Treffer / Tod** | Treffer: gläsernes Knacken. Tod: Splittern mit kurzem Funkenregen. Strukturtod: Einsturz einer Druse mit langem Klirren. |
| **Geflechtriss** | brechendes Glas, Unterdruck-Sog, elektrische Druckwelle, danach 2 s Ducking, in dem nur noch vereinzeltes Knistern zu hören ist |
| **Eco-Gebäude** | Drusen summen, Egel „saugen“ im Pulsrhythmus, leise, nur auf Z0 als Loop |

### 8.3 Mix-Regeln

- Es gelten Varkans Regeln (§8.3 dort): ein Bau-Loop pro Armee, Frequenzbänder pro Kategorie, Signaturtöne und Alerts vor Waffen, Eco-Loops ganz hinten.
- **Skarn-Bänder:** Direktfeuer und UI hoch, Artillerie mittel (nicht tief wie Varkan), nur Geflechtriss und 6-Beiner tief. So bleiben gemischte Gefechte trennbar.

---

## 9. Spielidentität & Asymmetrien

### 9.1 Leitbild

**Zuerst beißen, dann verschwinden.** Die Skarn gewinnen über Tempo, Masse an billigen Einheiten und Nadelstiche. Sie treffen härter, halten weniger aus, reparieren ihre Basis von selbst und halten Linien schlecht. Später kommen Tarnung, Lähmung und amphibische Umgehung dazu. Das ist die Spielweise der Vorbild-Fraktion, übertragen auf dieselben Rollen und dieselben Feature-IDs wie bei Varkan.

### 9.2 Referenzwahl und Balance-Methodik

- **Primärreferenz** ist die Einheit der Vorbild-Fraktion in derselben Rolle (FA-Präfix `URL/URA/URB`, FAF-Ergänzungen `DRL/DRA/DRLK/XRL`). **Gegenprobe** ist die FA-Referenz, gegen die Varkan balanciert ist (`UE*`), damit beide Fraktionen gegeneinander im FA-Verhältnis stehen. Fehlt der Vorbild-Fraktion eine Rolle, wird wie bei Varkan eine andere FA-Fraktion genommen:
  - Präzisionsläufer (T3-Sniper): Referenz wie Varkan (`XAL0305`).
  - Mobiler Schild: Die Vorbild-Fraktion hat keinen. Referenz ist Varkans Schildträger-Referenz (`UEL0307`), aber am **unteren Rand** des Bands: −15 % Schild-HP/Mass, dafür −10 % Kosten (§9.5).
- **Gates identisch zu Varkan:** hart ±25 % DPS/Mass und HP/Mass, Ziel ±15 % inklusive Produkt und Pulk-DPS/Mass, Treffer-bis-Tod-Pflichtpaare exakt wie die Vorbild-Referenz. Neu ist ein **Kreuz-Check gegen Varkan:** Die Pflichtpaare Zecke→Punze, Punze→Zecke, Nessel→Punze und Kelle→Zecke müssen dieselben Salvenzahlen liefern wie die FA-Paarungen der beiden Referenzfraktionen.
- **Datenquelle:** spooky-db 3810, dieselbe DPS-Formel. Die Werkzeuge liegen in `tools/roster/f2/` mit eigenem `fa_ref.json` der Vorbild-Fraktion.

### 9.3 Asymmetrien im MVP (ohne neue Mechanik)

Die Richtwerte sind die Relationen im Roster gegenüber Varkan (Stand nach Review, `roster.md` §14.1). Die Werte stehen in `roster.json`.

| Asymmetrie | Umsetzung | Feature | Richtwert (Vorbild vs. Varkan-Referenz) |
|---|---|---|---|
| **Glaskanone in der Linie** | Zecke: schnelle Pulslinse mit vielen kleinen Treffern, mehr DPS, weniger HP, schneller | U4, K1 | gegenüber der Punze HP/Mass −7 %, DPS/Mass +14 %, Tempo 3,7 statt 3,3 |
| **Zäher Raider** | Floh: weniger DPS, mehr HP als Stichel | U4 | HP/Mass +24 %, DPS/Mass −18 % |
| **Laserwaffen** | Pulslinsen als sehr schnelle lineare Projektile (Mündungsgeschwindigkeit 25–35 WU/s, bei T2+ bis 100). Kurze Salven mit hoher Kadenz. Kein Dauerstrahl im MVP. | K1, P5 | Zecke 8 Schaden alle 0,3 s statt Punze 28 alle 1,2 s |
| **Harte T1-Artillerie** | Nessel: großer Einzelschlag, Splash 2 statt 1,1, wenig HP. Im MVP ohne Lähmung (§9.4), dafür 5,8 statt 6,0 s Nachladezeit (§9.5 Nr. 1). | U4, K4 | Einzelschuss 2,3× Kelle, HP/Mass −33 % |
| **Starke, zerbrechliche T1-Flugabwehr** | Klette: Lenkpfeile, die auch Bodenziele treffen (schwache Zweitwaffe) | U4, K11, K3 | DPS/Mass Luft deutlich über Varkan, HP/Mass −16 % (Band gegen die Vorbild-Referenz, nicht gegen Varkan) |
| **Nachwachsende Basis** | Alle Wirtschafts- und Fabrikgebäude außer der Glimmzelle regenerieren (`health.regenPerSec`), dafür 10–32 % weniger HP als bei Varkan | U1-Datenpfad, S6; Sim über die generische `regen`-Spalte (PLAN §3.4, G6) | Egel/Druse I 2 HP/s, Nest I 9, II 20, III 40 HP/s |
| **Zäherer, zerbrechlicherer Kommandant** | Rädelsführer: weniger HP, fast doppelte Regeneration, Überschlag nach derselben Formel wie Varkans Abstich | U1, U8 | 10.000 statt 12.000 HP, 18 statt 10 HP/s |
| **Billige, schwache Schilde mit Stufen** | Kokon: günstiger, weniger Schild-HP, In-Place-Upgrade II→III wie Varkans Schirm | K10, B4-Pfad | Schild-HP/Mass am unteren Bandrand |
| **Beine statt Ketten** | Alle Landeinheiten laufen. Das ist nur View, der Bewegungslayer bleibt `land` wie bei Varkan. Kein Terrain-Vorteil im MVP. | M5, M7 | Tempo und Drehrate nach Vorbild-Referenz (Drehraten weitgehend gleich, z. B. 80° statt 90° bei der Linie) |
| **Veteranen-Regeneration** | Mobile Einheiten „wachsen nach“ erst mit Veteranenstufen | U9 (MVP-optional) | nach FAF-Vet-Tabelle |

### 9.4 Markierte Post-MVP-Asymmetrien

Keine dieser Eigenheiten ist für die Kern-Balance nötig. Jede ist mit der Feature-ID markiert, die sie braucht, und in `roster.json` wird sie als `special.postMvp: [{ feature, effect }]` geführt, ohne Sim-Wirkung.

| Eigenheit | Einheiten | braucht | Wirkung, sobald verfügbar |
|---|---|---|---|
| **EMP-Lähmung** | Nessel (Treffer lähmen kurz), Tarantel (Death-EMP), Rädelsführer (Geflechtriss lähmt im Radius) | **K18** | Nessel und Tarantel nach Vorbild-Relation; beim Rädelsführer eine Skarn-eigene Ergänzung ohne Vorbild-Wert |
| **Tarnung und Tarnfelder** | Schabe (Tarnung wie die Referenz), Silberfisch (mobiles Tarnfeld), Nachtschatten (Tarnfeld-Generator), Rädelsführer-Tarnung | **I5**, für den Rädelsführer zusätzlich **U14** | Radar-Unsichtbarkeit im Feld; Regeln für die Tarnung der Schabe legt I5 fest; der Rädelsführer bekommt Tarnung als Enhancement |
| **Amphibisch** | Rädelsführer, Engineers, Wasserläufer, Schildwanze | **M13** | laufen über den Grund von Wasser (in der Vorbild-Fraktion sind Kommandant, Engineers, der amphibische T2-Panzer und der gepanzerte T3-Läufer amphibisch, die übrigen T3-Läufer nicht) |
| **Marine, Zerstörer an Land** | Bisamratte | **U17 + M13** | Schiff mit einfahrbaren Beinen, wechselt zwischen Wasser- und Landlayer |
| **Raketenablenkung** | Tarantel (Ablenker gegen taktische Raketen) | **K16** | fängt TML-Geschosse im Nahbereich ab |
| **Dauerstrahl-Waffen** | spätere Experimentals, Rädelsführer-Enhancement | **K1-Erweiterung** (Beam-Waffentyp, keine eigene Feature-ID; Vorschlag: eigener Punkt unter K), beim Enhancement zusätzlich **U14** | Strahl mit Schaden pro Tick statt Projektil. Keine MVP-Rolle ist markiert: Die Referenzen von Tarantel und Langbein feuern Pulse bzw. Projektile. |
| **Tarnung für T3-Luft** | spätere T3-Flieger | **U12 + I5** | – |
| **Schildstufen über III hinaus** | Kokon IV/V | **B8** | weitere In-Place-Stufen wie bei der Vorbild-Fraktion |

### 9.5 Ersatzregeln: Kern-Balance ohne Post-MVP-Mechaniken

1. **Ein fehlender Mechanik-Wert wird nicht über das Band hinaus kompensiert.** Wo die Vorbild-Referenz einen Teil ihres Werts aus einer Post-MVP-Mechanik zieht (Lähmung der Nessel, Ablenker der Tarantel), darf der Generator innerhalb von ±15 % in Richtung Ausgleich gehen, bei der Nessel +3,5 % DPS/Mass. Das Band verlässt er nie, und die Kreuz-Relation zur Varkan-Rolle (ΔV) bleibt dabei innerhalb ±15 % (`roster.md` §19 R1).
2. **Rollen, die die Vorbild-Fraktion nicht hat, bleiben im MVP bestehen.** Das Gespinst (mobiler Schild) erfüllt U6 wie Varkans Schürze. Mit I5 kommt der Silberfisch als **zusätzliche** Rolle auf Hotbuild G dazu und ersetzt das Gespinst nicht, damit IDs und Balance stabil bleiben.
3. **Amphibische Einheiten sind im MVP reine Landeinheiten** (wie Varkans Engineers).
4. **Death-Weapon des Rädelsführers** im MVP: Schaden und Radius wie der Lotbruch (FA-Relation 1:1, beide Referenzen gleich). Die Lähmung kommt erst mit K18.

### 9.6 Hotbuild

**Dasselbe Raster wie Varkan** (`roster.md` §3 dort). Gleiche Taste = gleiche Rolle in jeder Fraktion, die Werk-Menüs heißen Landnest/Luftnest. Die reservierten Rollen belegen freie Tasten: Silberfisch auf **G** (Landnest, Reihe 2), Nachtschatten auf **G** (Bau-Menü, Reihe 2).

---

## 10. Variantenbewertung

Drei Varianten wurden entworfen. Skala 1–5 (5 = am besten).

- **V1 „Skarn“ (Kristall und Ungeziefer):** die zurückgelassenen Gießknechte der Ersten Absenkung, facettierte Chitin- und Granat-Läufer, Namen aus Ungeziefer und Unkraut, Rädelsführer mit Geflecht. *(beschrieben in §1–9)*
- **V2 „Klaue“ (die Klauenbünde):** entlaufene Varkan-Gussautomaten, die sich selbst umgebaut haben. Schrott-Ästhetik aus recycelten Wannen mit angeschweißten Klauenbeinen, Rost und Rot, Namen aus Messern und Haken, ein „Freigelassener“ als Kommandant.
- **V3 „Nachtweber“:** ein Spinnenkult, der Draht zu Netzen webt. Tarnung ist Kern-Identität, jede Stellung ist eine Falle. Schwarz und Violett, leiser, mystischer Ton, Namen aus Webstuhl und Garn.

| Kriterium | V1 „Skarn“ | V2 „Klaue“ | V3 „Nachtweber“ |
|---|---|---|---|
| **Lesbarkeit** | **5**: klarer Winkel-Code (Linse, Schwanz, Dornen), Beinzahl als Gewichtsklasse, Glut-Monopol übernommen | **4**: Varkan-Grammatik direkt übertragbar, aber Schrott-Details verrauschen die Silhouette | **3**: dünne Fäden und Netze liegen unter der 12-%-Regel, Fallen sind absichtlich schlecht lesbar |
| **Eigenständigkeit ggü. FA** | **4**: eigene Welt- und Materiallogik (Skarn-Geologie, Granat), eigenes Namenssystem. Rebellen mit Rot-Schwarz bleiben aber ein Genre-Topos. | **2**: „befreite Maschinen oder Menschen gegen ihre Schöpfer“ liegt zu nah an der Lore der Vorbild-Fraktion | **4**: eigener Kult-Ansatz, aber „Spinnen-Rebellen“ streift das Vorbild-Experimental |
| **Kitbash-Umsetzbarkeit** | **4**: 17 Primitive, fast alle trivial (Prisma, Pyramide, Kegel). Die Beine sind der teuerste Punkt. | **5**: nutzt Varkan-Parts weiter, kaum neue Primitive | **3**: Netze und Fäden brauchen Alpha oder dünne Geometrie, beides verletzt Budget oder Mindestmaß |
| **Stimmung / Coolness** | **5**: Verrat in der Vorgeschichte, „Unkraut vergeht nicht“, Mensch in der Maschine, singendes Glas als Klang-Signatur | **3**: Schrott-Rebellen sind vertraut und wirken neben Varkan wie ein Farbwechsel | **4**: atmosphärisch, aber der mystische Ton kollidiert mit dem trockenen Kessa-Ton |
| **Passung zur Vorbild-Spielweise** | **5**: billig/schnell, Laser, EMP-Kapsel, Tarnung, Amphibien, Regeneration und Läufer-Zerstörer ergeben sich alle aus Lore und Form | **4**: aggressiv und billig passt, Laser und Regeneration sind aber nicht motiviert | **3**: Tarnung passt perfekt, hängt aber an I5 (Post-MVP), die MVP-Identität wäre flach |
| **Kontrast zu Varkan und f3/f4** | **5**: glänzend/gespreizt/spitz gegen matt/gedrungen/rund; kurvenfrei gegen die geschwungenen f3/f4-Vorbilder | **2**: gleiches Material (Eisen), gleiche Wannen, optisch ein verrostetes Varkan | **4**: kontrastiert zu Varkan, rückt aber mit Mystik in Richtung f3/f4 |
| **Summe** | **28** | **20** | **21** |

### 10.1 Entscheidung

**Gewinner: V1 „Skarn“.** Die Variante hat die einzige Lore, die Varkans Welt nicht nur ergänzt, sondern erklärt (die Charta-Regel bekommt eine Vorgeschichte). Ihre Farben kommen aus der Geologie statt aus dem Vorbild, und jede Vorbild-Eigenheit ist aus Welt und Form begründet: Laser als Granatlinse, EMP als Geflechtspannung, Regeneration als Kristallwuchs, amphibische Läufer als Stollenbewohner. Die Schwäche von V1 ist das Bein-Budget (§3.3, §11.2).

### 10.2 Übernommen aus V2 „Klaue“

- Zangen-Platten am Bug des Ohrwurms (T2-Zusatz) als Rest der Klauen-Idee.
- Die Idee „die Einheiten sprechen nicht selbst“ wurde zum Geflecht-Echo (§8.1).

### 10.3 Übernommen aus V3 „Nachtweber“

- Netzring als Schildform (Gespinst, Kokon) und Faden-Baustrahl.
- Falle als Name und Form der Punktverteidigung (Falltür).
- Tarnung als markierte Post-MVP-Identität (Silberfisch, Nachtschatten), nicht als MVP-Kern.

### 10.4 Verworfen

- **V2:** recycelte Varkan-Wannen (zu wenig Kontrast), Maschinen-Befreiungs-Lore (zu nah an der Vorbild-Lore).
- **V3:** echte Netz- und Faden-Geometrie (unter Mindestmaß), Kult- und Mystik-Ton, Tarnung als Kernmechanik im MVP.
- **V1 intern:** Spinnen als Wortfeld (Nähe zum Vorbild-Experimental, deshalb nur konkrete Arten), „Dorn / Thorn“ für den AA-Turm (FA-Teiltreffer), Insekten-Namen mit FA-Treffer (*Beetle, Thistle, Wasp, Hornet*), Dauerleuchten der Linse (verletzt das Glut-Monopol).

---

## 11. Anhang: Beispiel-Einheiten und offene Punkte

### 11.1 Beispiel-Einheiten (Kurzprofil)

> Die Sim-Werte sind aus `roster.json` übernommen (Stand nach Review). Bei Widerspruch gilt `roster.json`.

**Zecke / Tick (`f2:lnd_t1_tank`)**
- **Silhouette:** flacher Keilpanzer 1,0 × 0,3 × 1,4 WU auf 4 Hochbeinen (Spanne ≈ 1,6 WU). Mittig sitzt auf kurzem Hals eine waagerechte Granatlinse (0,75 WU ≈ 54 % der Rumpflänge), die über die Bugspitze ragt. Die Rückenplatte ist teamfarben, Sehnen laufen an den Kniegelenken, dazu 1 Tech-Streifen quarzweiß.
- **Parts (5):** `legs` (4), `carapace` [team], `neck` (Yaw), `lens` [sinew] (Pitch), `carapace` klein (Heckplatte). Teamfarbe ≈ 34 % inklusive Beine.
- **Icon:** `land_direct_t1`. **Hotkey:** Q.
- **Sim-Werte:** Referenz `URL0107` (Gegenprobe `UEL0201`). Mass 56 wie Punze, HP 280, Tempo 3,7, Pulslinse 8 Schaden bei 0,3 s Nachladezeit, RW 18. DPS/Mass +14 %, HP/Mass −7 % gegenüber der Punze.
- **Tech-Familie:** Ohrwurm (T2): Maßstab 1,3, zwei parallele Linsen, Zangen-Platten am Bug, 2 Streifen, weiterhin 4 Beine.

**Nessel / Nettle (`f2:lnd_t1_arty`)**
- **Silhouette:** langer schmaler Keilpanzer 0,9 × 0,3 × 1,5 WU auf 4 Beinen. Über dem Rücken wölbt sich ein dreigliedriger Schwanz, dessen Spitze eine Sechseck-Kapsel (Ø 0,4 WU) schräg nach vorn hält (≈ 50°). Keine Linse, nichts Waagerechtes.
- **Parts (5):** `legs` (4), `carapace` [team], `neck` (Yaw, Schwanzansatz), `tail` [team] (Pitch), `pod` [sinew].
- **Icon:** `land_arty_t1`. **Hotkey:** W.
- **Sim-Werte:** Referenz `URL0103` (Gegenprobe `UEL0103`). Mass 36, HP 140, Kapsel mit 230 Schaden alle 5,8 s und Splash 2, RW 5–30, ballistisch. Die Lähmung ist markiert (K18) und im MVP nicht aktiv. Der Einschlag hinterlässt ≈ 3 s ein knisterndes Blitz-Decal (nur View).

**Flicker / Patcher (`f2:lnd_t1_engineer`)**
- **Silhouette:** kurzer, breiter Keilpanzer mit quarzweißem Deck und schwarzem Tech-Streifen auf 4 Beinen. Quer über dem Heck liegt eine Spule mit teamfarbenen Randscheiben, deren Achse als Herzkern glüht. Eine Quarz-Nadel läuft diagonal von der linken Spule nach vorn rechts, an ihrer Spitze sitzt der Faden-Emitter.
- **Parts (5):** `legs` (4), `carapace` [quartz], `spool` [team] (Achse [glow]), `needle` [quartz] (Yaw), Emitter [glow] (Pitch). Stopfer (T2) hat 2 Nadeln verschiedener Länge, Weber (T3) 3 Nadeln und 6 Beine bei Maßstab 1,4.
- **Icon:** `eng_build_t1`. **Hotkey:** E.
- **Sim-Werte:** Referenz `URL0105` (Gegenprobe `UEL0105`): Mass 52, Build Power 5, HP 147 (Lehrling 160). Keine Waffe. Amphibisch erst mit M13 (§9.4).

**Rädelsführer / Ringleader (`f2:cmd_commander`)**
- **Silhouette:** großer 6-Beiner (Höhe 2,1 WU, Beinspanne 3,4 WU). Der Torso ist ein Keilpanzer mit teamfarbenem Kopfkamm, auf dem Rücken ragt die Herzdruse als stärkster Glutpunkt auf. Unter dem Kopf sitzt mittig die Granatlinse, links und rechts zwei Quarz-Nadeln als Taster, im Rücken die Spule.
- **Parts (7):** `legs` (6), `carapace` (Torso, Yaw) [team], `druse` (Herzdruse) [glow], `lens` [sinew] (Pitch), `needle` [quartz], `needle` [quartz], `spool` [team].
- **Sim-Werte:** Referenz `URL0001` (Gegenprobe `UEL0001`). HP 10.000, Regeneration 18 HP/s, Hauptwaffe 100 Schaden pro 1 s, Überschlag nach Abstich-Formel. Geflechtriss mit Schaden wie Lotbruch.

### 11.2 Offene Punkte

1. **Markenrecherche** „Skarn“, „Skarn-Geflecht“, Rottennamen und alle Rufnamen. Der Grep gegen die FA-Namensliste (spooky-db 3810) ist erledigt (§7.1). Vor dem Einfrieren gegen den dann aktuellen FAF-Stand wiederholen.
2. **Roster:** erledigt. `roster.json`/`roster.md` werden mit `tools/roster/f2/` erzeugt und geprüft (Primärreferenzen der Vorbild-Fraktion, Gegenprobe Varkan, Kreuz-Check §9.2). Review-Entscheidungen stehen in `roster.md` §19.
3. **Regeneration für alle Strukturen:** PLAN §3.4 faltet `regen` generisch als effektive Spalte (Modifier G6, MS10), Skarn kommt mit U19 danach. Bei der Integration prüfen, dass `health.regenPerSec` für Strukturen in diese Spalte fließt (`roster.md` §18 Nr. 1). Keine neue Feature-ID.
4. **Draw-Budget für zwei Fraktionen:** Varkan + Skarn ≈ 56 Visuals in einem Match. Die DECISIONS-Messung (40 Visuals ⇒ 309 Draws) muss für 56 wiederholt werden, oder Visuals werden fraktionsübergreifend zusammengelegt (z. B. Wände, Storage).
5. **Bein-Budget:** Kosten des prozeduralen Leg-Renderers bei 200+ Skarn-Einheiten messen. Fallback ist ein gebackener Laufzyklus (§3.3).
6. **Neue Primitive und Leg-Parameter** im Blueprint-Compiler (§3.6), als eigener Arbeitsschritt zusammen mit Varkans `ladle`.
7. **Beam-Waffentyp** als eigener Feature-Punkt vorschlagen (§9.4), sobald eine Fraktion ihn für das MVP-Roster braucht. Heute braucht ihn keine.
8. ~~**Fraktionsübergreifende Regeln**~~ erledigt: gemeinsame Übersicht `docs/design/factions/README.md` (Icon-Grammatik, Palette, Asymmetrie-Matrix, Kreuz-Balance), N×N-Prüfer `tools/roster/cross.py`. Im Abgleich geändert: Bremse feuert 2 × 3 × 8 (Referenz hat zwei Waffen), Eco-Werte von Weber, Egel III, Druse III, Landnest II/III auf Varkan gesetzt, Rufnamen *Hort/Hoard* → **Wabe / Honeycomb** (zu nah an f4 „Horn“), *Stachel* → **Schlehe / Sloe** (zu nah an Varkan „Stichel“), EN *Trap* → **Snare** (zu nah an Varkan „Tap“).
