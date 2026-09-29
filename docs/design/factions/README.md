# Die vier Mächte von Kessa: fraktionsübergreifende Übersicht

> **Status:** Designübersicht für U19 („Zweite asymmetrische Fraktion“) und U22 („Fraktionen 3 & 4“), Stand des fraktionsübergreifenden Abgleichs 2026-09-29. Reine Design- und Datendokumente, kein Code.
> **Quellen der Zahlen:** die vier `roster.json` (Schema `faf-roster/1`): Varkan `docs/design/roster.json`, Skarn `f2/roster.json`, Sael `f3/roster.json`, Aurith `f4/roster.json`. Alle Tabellen in §5 und §6 sind Ausgaben von `tools/roster/cross.py` (N × N-Prüfer, §10). Bei Widerspruch gilt das jeweilige `roster.json`.
> **Abgrenzung:** Jede Fraktion ist stilistisch an eine FA-Fraktion angelehnt (Designsprache, Gameplay-Identität, Rollenverteilung), verwendet aber keine FA-Namen, keine FA-Lore, keine FA-Designs und keine FA-Assets. Vorbilder werden in den Design-Dokumenten nur über ihr Blueprint-Präfix referenziert (dev-only): `UE*` (Varkan), `UR*`/`DR*`/`XR*` (Skarn), `UA*`/`XA*` (Sael), `XS*`/`DS*` (Aurith).

---

## 1. Die Welt Kessa

Kessa ist eine junge Welt mit dünner Kruste, darunter fließt Metall. Alle vier Mächte wollen dieselben Orte: die Stellen, an denen Adern die Oberfläche berühren (Mass-Spots). Allen vier ist derselbe Kern gemeinsam, der die Siegbedingung trägt (U1, A4): **Ein Anspruch gilt nur, solange die eine Führungsfigur am Ort steht. Fällt sie, erlischt der Anspruch.** Jede Macht begründet das anders.

### 1.1 Zeitleiste (Kanon für alle vier Dokumente)

| # | Ereignis | betrifft | Quelle |
|---|---|---|---|
| 1 | Das Varkan-Kompakt, ein Bund von Schmelzhäusern, erschließt Kessa aus dem Orbit. | Varkan | `../faction.md` §2.1 |
| 2 | **Erste Absenkung:** Die Häuser schicken Menschen als Gießknechte auf den Boden. | Varkan, Skarn | `f2/faction.md` §2.1 |
| 3 | **Bruchjahr:** Die Kruste reißt auf. Die Häuser ziehen sich in den Orbit zurück, schreiben „Kein Mensch betritt den Boden“ in die Charta und erklären die Zurückgelassenen zu Schlacke. | alle | `f2/faction.md` §2.3 |
| 4 | Die Zurückgelassenen überleben in den Skarnzonen, lernen Maschinen zu ziehen und binden sie ans Geflecht: die **Skarn**. | Skarn | `f2/faction.md` §2.1 |
| 5 | Als die Häuser ihre Adern öffnen, legt der Orden auf dem Mond Sael das **Gelübde der Obhut** ab: Wo das Kompakt gießt, soll auch einer des Ordens stehen. | Sael | `f3/faction.md` §2.1 |
| 6 | Die Zapfstellen der Häuser bohren tief genug, um die **Aurith** zu wecken, Klangmuster in der Schmelze. Seitdem „stimmen sie lauter“. | Aurith | `f4/faction.md` §2.1 |

**Konsistenzregel:** Die Häuser haben die Aurith erst mit Schritt 6 *bemerkt* (`f4/faction.md` §2.2). Die Skarn leben seit Schritt 4 in den Stollen und kennen den Gesang schon länger; sie nennen ihn nur „das Summen“ und halten ihn für ein Geräusch der Kruste. Der Orden liest ihn als Wachsen der Perle (§3). Damit widerspricht keine Fraktions-Lore einer anderen.

---

## 2. Die vier Mächte

| | **Varkan** (Kern, `core`) | **Skarn** (`f2`) | **Sael** (`f3`) | **Aurith** (`f4`) |
|---|---|---|---|---|
| Vollname DE / EN | das Varkan-Kompakt / the Varkan Compact | das Skarn-Geflecht / the Skarn Tangle | der Orden von Sael / the Order of Sael | der Aurith-Chor / the Aurith Choir |
| Stilistisches Vorbild (dev-only) | industrielle, symmetrische Allrounder-Fraktion (`UE*`) | schnelle, zerbrechliche Guerilla- und Tarnfraktion (`UR*`) | elegante, schwebende, schildstarke Fraktion (`UA*`) | fremdartige, ornamentale Fraktion mit wenigen großen Hybrid-Einheiten (`XS*`) |
| Wer sie sind | Bund menschlicher Schmelzhäuser im Orbit | zurückgelassene Menschen und ihre gezogenen Maschinen, im Boden | Mönchsorden vom Mond Sael | nicht-menschliche Klangmuster aus der Schmelze |
| Spieleridentität | Haus | Rotte | Kapitel | Chor |
| Kommandant | Vogt / Reeve | Rädelsführer / Ringleader (einziger Mensch auf dem Feld) | Prior / Prior | Kantor / Cantor |
| Ankunft (P19) | **Lotung** von oben (Orbitalstrahl) | **Durchbruch** von unten (Stollennetz) | **Einsenkung** am Lichtfaden vom Mond | **Aufklang** aus der Schmelze |
| Tod (U1) | Lotbruch | Geflechtriss | Perlsprung | Zerspringen |
| Sonderschuss (U8) | Abstich / Tap Shot | Überschlag / Flashover | Glanzstoß / Lustre Strike | Aufschrei / Outcry |
| Fabrik-Upgrade (U5) | Freisprechen / Qualify | Ausreifen / Mature | Weihen / Consecrate | Einstimmen / Attune |
| Niederlagetext | „Lot gebrochen. Anspruch erloschen.“ | „Geflecht gerissen. Biss verloren.“ | „Perle gesprungen. Obhut erloschen.“ | „Grundton verstummt. Tonart zerfallen.“ |
| Warum der Fall entscheidet | Vertragsrecht (Charta) | physisch: das Geflecht reißt, die Maschinen erstarren | Gelübde: Obhut gilt nur bei Anwesenheit | Klang: ohne Grundton zerfällt die Tonart |
| Grund zu kämpfen | „Erz wartet nicht.“ | Die Häuser haben sie zu Schlacke erklärt; jede Ader, die ein Haus anzapft, brennt ihnen einen Stollen aus. | Unbewachte Adern sprengen die werdende Perle. | Zwei Tonarten können an einer Klangstelle nicht zugleich klingen. |
| Ton | knapp, handwerklich, Galgenhumor | trotzig, schnell, spöttisch | ruhig, gemessen, maritim | fremd, ruhig, „Übertragung“ |
| Dokumente | `../faction.md`, `../roster.md` | `f2/faction.md`, `f2/roster.md` | `f3/faction.md`, `f3/roster.md` | `f4/faction.md`, `f4/roster.md` |

**Keine Bösewichte.** Jede Fraktion hat einen nachvollziehbaren Grund, keine will vernichten. Das gilt auch für die Texte der KI-Gegner.

---

## 3. Beziehungen

Zeile = wie die Fraktion die Spalte sieht (nur Flavor-Texte, nie UI).

| sieht → | Varkan | Skarn | Sael | Aurith |
|---|---|---|---|---|
| **Varkan** | rivalisierende Häuser desselben Bundes, Streit nach Charta | „Ungeziefer“, „Unkraut“, offiziell Schlacke | „die Langsamen“, „Mondleute“; eine Obhut zählt als Anspruch, solange ein Prior steht | „Fremdchor“; ein Kantor auf einer Ader zählt für die Charta wie ein Vogt |
| **Skarn** | Verräter: „Die haben uns zu Schlacke erklärt.“ | „Eine Kluft, eine Rotte.“ Streit um Stollen | Mondleute, die nie unten waren | „das Summen“; alte Nachbarn in der Tiefe, weder Feind noch Freund |
| **Sael** | „die Gießer“, hastig, aber nicht böse | die Zurückgelassenen; Schuld der Häuser, nicht des Ordens | Kapitel streiten über die Auslegung des Gelübdes | der Gesang ist das Wachsen der Perle; wer ihn stört, sprengt die Schale |
| **Aurith** | „die Bohrenden“; ihre Zapfstellen verstimmen die Klangstellen | eine „leise Stimme“, die schon lange mitsummt | „die Hörenden“, die als Einzige zuhören | Chöre anderer Tonart; der Tritonus klingt mit niemandem |

**Spiegel-Matches** sind in allen Dokumenten begründet: Häuser gegen Häuser (Charta), Rotte gegen Rotte (Stollen), Kapitel gegen Kapitel (Auslegung), Chor gegen Chor (Tonart).

---

## 4. Gemeinsame Regeln

### 4.1 Strategic Icons: eine Grammatik für alle

Normativ ist Varkan `../faction.md` §6. **Wie in FA sind Icons fraktionsübergreifend identisch; Farbe = Team, nie Fraktion.** Keine Fraktion fügt dem MSDF-Atlas eine Grundform oder Glyphe hinzu; alle vier `roster.json` führen dieselbe Liste `iconGlyphs` (19 Tokens, von `cross.py` geprüft).

- **Grundform = Domäne:** Quadrat mit Fase (Land), Dreieck (Luft), Kreis (Engineer), Sechseck (Gebäude), Tropfen (Kommandant, 1,6×), Mini-Quadrat (Mauer).
- **Glyphe = Rolle**, **1–3 Tech-Kerben** oben rechts außerhalb. Radar-Blips, Ghosts und Zustände sind fraktionsneutral; ein Blip verrät auch die Fraktion nicht.
- **Icon folgt der Rolle, nicht dem Fahrwerk:** Die Zecke läuft, ist aber Linie (`land_direct_t1`); Schweber (Sael) und Gleiter (Aurith) bleiben Land-Quadrate; Personal-Schilde zeigen sich als zweiter Balken, nicht im Icon.
- **Gleiche Rolle = gleiche Icon-ID.** Einzige begründete Abweichung: der Aurith-Kampfspäher Pfiff (`lnd_t1_scout`) trägt `land_bot_t1` statt `land_intel_t1`, weil er die DPS eines Raiders hat („Gefahr vor Funktion“, `f4/faction.md` §6.2). Aurith-Sonderrollen nutzen vorhandene Glyphen: Grollen `land_direct_t3`, Stille `land_shield_t3`.
- **Reservierte Tokens (Post-MVP, alle Fraktionen):** `stealth` ⊘ (I5), Marine-Grundform Halbkreis (U17); amphibische Einheiten behalten ihr Land-Icon (`f2/faction.md` §6.3).

### 4.2 Formbedeutungen, die in allen vier Fraktionen gleich sind

| Bedeutung | Varkan | Skarn | Sael | Aurith |
|---|---|---|---|---|
| waagerecht = Direktfeuer | Glocke mit Rohr | Granatlinse | Perle mit Lanze | Gabel (zwei Zinken) |
| schräg = indirekt | Kelle, Raketenkasten 50° | Schwanz mit Kapsel | Horn | Trichter, Spindel |
| senkrecht (≥ 75°) = Flugabwehr | Rohrkamm, Rost | Dornenkamm | Stachelkranz | Pfeifen (Orgelprospekt) |
| Ring = Schild / Flow | Ring | Kokon-Ring | Ring | Reif |
| Mast = Intel | Mast mit Platte | Fühler | Mast | Mast |
| Bauen | Kupfer-Kranarm, Keramik-Deck | Quarz-Nadel, Spule | Gold-Sichel | Perlglas-Sichel |
| Tech | 1–3 Keramik-Streifen | 1–3 Quarz-Streifen | 1–3 Jade-Streifen | 1–3 Tonpunkte |

Die Zahl der Tech-Markierungen am Modell ist gleich der Zahl der Icon-Kerben. Kitbash-Regeln (wenige Primitive, ein Modell pro Rolle über alle Tech-Stufen, Tech durch Skalierung, Teamfarbe ≥ 30 % Draufsicht mobil, ≥ 45 % Luft) gelten für alle vier; jede Fraktion hat 28 Visuals.

### 4.3 Farbpaletten nebeneinander

| Slot (`matId`) | Varkan „Gießerei“ | Skarn „Kluftwuchs“ | Sael „Schichtung“ | Aurith „Gesungenes Glas“ |
|---|---|---|---|---|
| 0 `body` (Hauptmaterial) | Gusseisen, matt `#2E2B29` | Schwarzchitin, glänzend `#18171C` | Perlmutt, hell `#E4DED2` / Schalenrinde `#26302C` | Pechglas `#1F1B22` |
| 1 `team` | Bannerplatte | Rückenplatte | Emaille-Einlage | Kamm und Glyphenfelder |
| 2 Akzent | Kupfer `#B06A3B` | Sehne `#6E1A22` | Gold `#C8A24A` (≤ 8 % Kanten) | Bernsteinglas `#C8912E` (25–35 %) |
| 3 `glow` (Flow, nur View) | Glut `#FFD9A0` → `#FF8A2A` | Granatglut `#FFB0BE` → `#E0203F` | Goldlicht `#FFF3CF` → `#F2C45A`, Jade-Naht `#7FE3C0` | Phasenblau `#BFF2FF` → `#3FA9FF` |
| 4 Klassenmarker | Keramik `#CFC6B4` | Quarz `#D6D3DC` | Tiefjade `#1E4A40` | Perlglas `#D5DCE2` |
| Gesamteindruck | dunkel, matt, orange Glut | schwarz glänzend, rot | hell, perlweiß, gold/jade | amber auf dunkel, blau |

**Fraktion erkennt man am dominanten Material und an der Leuchtfarbe, das Team an der Teamfarbe.** Die Teampalette ist für alle gleich (8 Farben, `../faction.md` §4.3). Jede Fraktion schaltet ihre Leuchtfarbe um, wenn eine Teamfarbe zu nah liegt:

| Teamfarbe | Varkan | Skarn | Sael | Aurith |
|---|---|---|---|---|
| Rot `#C8372D` | Weißglut | Rosaquarz-Weiß | – | – |
| Orange `#E07A1F` | Weißglut | – | Goldkern → Weißlicht | Schalen → Rauchquarz |
| Oliv `#8A8F2E` | – | – | Goldkern → Weißlicht | Schalen → Rauchquarz |
| Grün `#3E9A4A` | – | – | Jade → Silberlicht | – |
| Cyan `#27A6B5` | – | – | Jade → Silberlicht | Phase → Weißphase |
| Blau `#2F6FD0` | – | – | – | Phase → Weißphase |
| Pink `#D0569A` | – | Rosaquarz-Weiß | – | – |
| Violett `#7A4CC2` | – | – | – | – |

**Im Abgleich geändert:** Aurith-Perlglas von `#E6E0D2` auf kühles Eisweiß `#D5DCE2`, weil es fast gleich dem warmen Sael-Perlmutt war. Amber (≈ 37°) und Sael-Gold (≈ 43°) bleiben, weil Aurith Amber flächig und Sael Gold nur als Kante nutzt.

### 4.4 Silhouetten zwischen den Fraktionen

| | Varkan | Skarn | Sael | Aurith |
|---|---|---|---|---|
| Fahrwerk | Kette (Bots auf Beinen) | alles auf Knickbeinen (4–6) | Schweben auf dunklem Teller, 3 Läufer | Gleiten auf Kiel, Läufer auf 3 Beinen |
| Proportion | niedrig, breit (Höhe ≤ 0,45 × Länge) | flach, gespreizt | flach, tropfenförmig (≤ 0,40) | hoch, schlank (≥ 0,6), Kamm |
| Formsprache | Kante = Körper, Rund = Technik | streng eckig, facettiert | Rund = Körper, Spitz = Waffe | Kurve = Körper, Gerade = Waffe |

Sael und Aurith schweben beide optisch. Sie trennen sich über Höhe (flache Schale gegen hohen Kamm) und Helligkeit (hell oben gegen amber auf dunkel). Das prüfen die Kreuz-Silhouettenpaare in `f4/roster.json` (`silhouettePairs.crossFaction`) im Graustufen-Test (MS9).

### 4.5 Namen

- **Regeln für alle:** echte DE/EN-Wortpaare, keine FA-Einheiten-, Waffen- oder Fraktionsnamen, kein Rufname näher als zwei Buchstaben an einem Rufnamen einer anderen Fraktion (ohne Stufenziffer), auch nicht an reservierten Post-MVP-Rollen. `cross.py` prüft alle 312 Rufnamen N × N und jedes Wort gegen 357 FA-Einheiten- und 218 FA-Waffennamen (`tools/roster/fa_names.json`, spooky-db 3810). Allgemeine Wörter wie *Sky* oder *Master* sind erlaubt, solange der Rufname selbst kein FA-Name ist.
- **Wortfelder:** Varkan Schmiedewerkzeug und Schornsteinvögel, Skarn Ungeziefer und Unkraut, Sael Meer und Muscheln, Aurith Musik und singende Insekten.
- **Im Abgleich umbenannt (Skarn):** *Hort / Hoard* → **Wabe / Honeycomb** (zu nah an Aurith „Horn“), *Stachel / Spine* → **Schlehe / Sloe** (zu nah an Varkan „Stichel“), EN *Trap* → **Snare** (zu nah an Varkan „Tap“). Bereits vorher in den Reviews: Sael Knallkrebs, Languste, Konus, Seelilie, Fountain; Aurith Maikäfer, Widerhall.
- **„Horn“ bleibt:** Bei Aurith ist es der Rufname der T1-Artillerie, bei Sael die Form der Artillerie. Beides meint dieselbe Rolle; das ist eine gewollte fraktionsübergreifende Formbedeutung.

**Roster nebeneinander (gleiche Rolle = gleiche Zeile):**

| Rolle | Varkan | Skarn | Sael | Aurith |
|---|---|---|---|---|
| Kommandant | Vogt | Rädelsführer | Prior | Kantor |
| Engineer T1/T2/T3 | Lehrling / Geselle / Meister | Flicker / Stopfer / Weber | Novize / Akolyth / Kustos | Chorist / Solist / Vorsänger |
| Land-Späher | Funke | Schabe | Glimmer | Pfiff (Kampfspäher, auch Raider) |
| T1-Raider (Bot) | Stichel | Floh | Knallkrebs | – (Pfiff) |
| T1-Panzer | Punze | Zecke | Kauri | Triller |
| T1-Artillerie | Kelle | Nessel | Dünung | Horn |
| T1-Flak | Sieb | Klette | Seeigel | Pfeife |
| T2-Panzer | Meißel | Ohrwurm | Triton | Heuler |
| T2-Raketen | Rinne | Wolfsmilch | Brecher | Posaune |
| T2-Flak | Rüttelsieb | Ginster | Seestern | Bordun |
| Mobiler Schild | Schürze (T2) | Gespinst (T2) | Muschel (T2) | Stille (T3) |
| T2-Sturmläufer | Zange | Milbe | Languste | Brüller |
| T3-Sturm | Fallhammer | Tarantel | Einsiedler | Grollen (Hybrid-Gleiter) |
| T3-Artillerie | Pfanne | Stechapfel | Woge | Heerhorn |
| T3-Präzision | Reißnadel | Langbein | Konus | Diskant |
| T3-Flak | Trommelsieb | Hagedorn | Diadem | Zimbel |
| Luft: Späher / Jäger / Bomber | Lerche / Turmfalke / Dohle | Motte / Bremse / Brummer | Seeschwalbe / Sturmvogel / Tölpel | Grille / Zikade / Maikäfer |
| Luft: Gunship / Jagdbomber | Krähe / Elster | Hummel / Stechmücke | Albatros / Raubmöwe | Schwebfliege / Schwärmer |
| Mex / Pgen / Hydro | Zapfstelle / Glutkessel / Dampfquelle | Egel / Druse / Fumarole | Brunnen / Laterne / Quellbogen | Stimmstock / Resonator / Äolsharfe |
| Mass- / Energy-Speicher | Erzspeicher / Glutspeicher | Wabe / Glimmzelle | Zisterne / Schrein | Bernsteinkammer / Lichtkammer |
| Land- / Luftfabrik | Landwerk / Luftwerk | Landnest / Luftnest | Landkapitel / Luftkapitel | Grundhalle / Himmelshalle |
| PD / AA / SAM | Riegel / Rost / Hochrost | Falle / Schlehe / Igel | Riff / Seelilie / Hochlilie | Gabel / Pfeifenwerk / Hochorgel |
| Mauer / Radar / Schild | Mauer / Horcher / Schirm | Hecke / Fühler / Kokon | Deich / Warte / Perlmutt | Grat / Widerhall / Dämpfer |
| Artillerie T2 / T3 | Tiegel / Hochofen | Schierling / Bilsenkraut | Brandung / Sintflut | Fanfare / Großhorn |

**Hotbuild:** dasselbe Raster für alle (`../roster.md` §3). Gleiche Taste = gleiche Rolle; nur die Menü-Namen wechseln.

---

## 5. Kreuz-Balance

Methodik wie in allen vier Rostern: Jede Einheit liegt ±15 % (hart ±25 %) zur FA-Referenz ihrer **Vorbild-Fraktion**; weil die FA-Fraktionen untereinander balanciert sind, stehen die Fraktionen dann auch zueinander im FA-Verhältnis. `cross.py` prüft das direkt, Paar für Paar. FA-Seite: dieselbe Paarung der Referenz-Blueprints (spooky-db 3810, `WeaponNumber` korrigiert).

### 5.1 Eco: identisch

Kommandant (+1 M/s, +20 E/s, 650 M / 3.900 E, BP 10), Engineers T1–T3, Mex T1–T3, Pgen T1–T3, Hydro, beide Speicher und alle Fabrikstufen haben in allen vier Fraktionen **dieselben Kosten, Bauzeiten, Build Power und Erträge** (18 Rollen × 9 Felder, 0 Abweichungen). In FA ist die Wirtschaft fraktionsgleich, deshalb gibt es keinen Grund für Unterschiede. Die Fraktionen zahlen ihre Asymmetrie nur über HP (z. B. zerbrechliche Sael-Basis, nachwachsende, dafür dünnere Skarn-Basis), nicht über Tempo.

**Im Abgleich angeglichen** (alles Rundungsreste von 0,4–2,2 %): Skarn Weber, Egel III, Druse III, Landnest II/III; Sael Brunnen III (die frühere „+100 Mass“-Abweichung hatte kein FA-Vorbild) und Luftkapitel II; Aurith Stimmstock III.

### 5.2 T1-Kernduelle: Treffer bis zum Tod

Salven bis zum Tod, Angreifer → Ziel. **Fett** = weicht von der FA-Paarung ab (FA in Klammern). Raider bei Aurith = Pfiff.

| Duell (Angreifer → Ziel) | V → S | V → O | V → A | S → V | S → O | S → A | O → V | O → S | O → A | A → V | A → S | A → O |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Panzer → Panzer | **10** (12) | 7 | **11** (12) | 38 | **22** (20) | **36** (35) | 8 | 7 | **8** (7) | 10 | 9 | **6** (5) |
| Raider → Raider | **14** (13) | 17 | **6** (5) | 3 | 6 | 2 | 3 | 4 | 2 | 15 | **24** (23) | 29 |
| Panzer → Raider | 4 | 5 | 2 | 8 | 15 | 5 | 2 | 3 | 1 | 2 | 3 | 4 |
| Raider → Panzer | **40** (39) | **25** (23) | **41** (40) | 15 | **9** (8) | 14 | 12 | **11** (10) | 11 | 75 | **70** (68) | **43** (39) |
| Raider → Engineer | 21 | 18 | **19** (18) | 8 | 6 | **7** (6) | 6 | 6 | 5 | **40** (38) | 37 | **32** (30) |
| Artillerie → Panzer | 3 | 2 | 3 | 2 | 1 | 2 | 2 | 2 | 2 | 7 | **7** (6) | 4 |
| Artillerie → Engineer | 2 | 2 | 2 | 1 | 1 | 1 | 1 | 1 | 1 | 4 | 4 | 3 |
| Panzer → Artillerie | **5** (6) | **6** (7) | **7** (8) | **27** (26) | **20** (19) | **23** (22) | 6 | 4 | 5 | 7 | 5 | 5 |
| Flak → Bomber | 8 | 8 | **8** (9) | **15** (14) | **14** (13) | 14 | **10** (9) | 9 | **10** (9) | 17 | **15** (16) | 16 |
| Jäger → Bomber | 4 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 4 | 5 |
| Jäger → Jäger | 6 | 6 | 6 | 7 | 6 | 7 | 7 | 6 | 7 | 6 | 6 | 6 |
| Bomber → Mex | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| Bomber → Engineer | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| PD → Panzer | 6 | 4 | 6 | 6 | 4 | 6 | 6 | 6 | 6 | 6 | 6 | 4 |
| Kommandant → Panzer | 3 | 2 | 3 | 3 | 2 | 3 | 3 | 3 | 3 | 3 | 3 | 2 |
| T2-Panzer → T2-Panzer | **29** (28) | 40 | 20 | **32** (30) | 55 | **28** (27) | 5 | 6 | 4 | 8 | 10 | 14 |

V = Varkan, S = Skarn, O = Orden von Sael, A = Aurith.

**Ergebnis:** 156 von 192 Kreuzpaaren treffen die FA-Paarung exakt. Von den 36 abweichenden liegen 28 um genau eine Salve daneben, sieben um zwei und eine um vier (Pfiff → Kauri 43 statt 39, TTK +11 %). Alle Tötungszeiten liegen innerhalb ±25 % der FA-Paarung. Die meisten Abweichungen haben zwei Ursachen, die bewusst bleiben:

1. **Varkans Punze (28 statt 24 Schaden)** und **Lehrling (160 statt 150 HP)**: Varkans Signatur. Punze → Panzer braucht dadurch gegen Skarn und Aurith 1–2 Salven weniger, bei gleicher Tötungszeit (±9 %).
2. **HP-Anker der anderen Fraktionen gegen genau diese Punze** (Kauri 170, Triller 285): Sie halten die Pflicht-Breakpoints gegen Varkan exakt und verschieben dafür ein Paar untereinander um eine Salve. Beides zu erfüllen ist bei Punze 28 mathematisch nicht möglich (`f3/roster.md` §21 B6).

Dauerstrahlen und Doppelwaffen sind kein Sonderfall mehr (§5.4).

### 5.3 Gruppengefecht gleicher Masse und Rush

**Stärkeverhältnis A ↔ B** im Lanchester-Quadratgesetz (DPS/Mass × HP/Mass, > 1 = A gewinnt), FA-Paarung in Klammern:

| Paarung | Varkan ↔ Skarn | Varkan ↔ Sael | Varkan ↔ Aurith | Skarn ↔ Sael | Skarn ↔ Aurith | Sael ↔ Aurith |
|---|---|---|---|---|---|---|
| Panzer ↔ Panzer | 0,94 (1,00) | 1,53 (1,73) | 0,90 (0,97) | 1,63 (1,73) | 0,96 (0,97) | 0,59 (0,56) |
| Raider ↔ Raider | 0,96 (1,01) | 0,88 (0,88) | 1,30 (1,33) | 0,92 (0,88) | 1,36 (1,32) | 1,48 (1,51) |
| Panzer ↔ Raider | 1,37 (1,49) | 1,26 (1,30) | 1,86 (1,97) | 1,34 (1,30) | 1,98 (1,97) | 1,21 (1,14) |
| T2-Panzer ↔ T2-Panzer | 1,10 (1,09) | 0,85 (0,81) | 1,24 (1,22) | 0,77 (0,74) | 1,13 (1,11) | 1,47 (1,51) |
| Jäger ↔ Jäger | 1,10 (1,10) | 1,08 (1,08) | 0,96 (1,00) | 0,98 (0,98) | 0,88 (0,91) | 0,89 (0,92) |

Alle 30 Paarungen liegen innerhalb ±11 % der FA-Relation (Gate ±30 %). Die größte Abweichung ist Punze ↔ Kauri (1,53 statt 1,73): Die Kauri steht etwas besser da als ihr Vorbild, weil ihre HP für den Punze-Breakpoint angehoben sind. Die Kauri-Reichweite (26 gegen 18) ist dabei noch nicht eingerechnet; sie ist Saels Ausgleich für die schwache Linie.

**T1-Rush gegen den Kommandanten** (Modell `f3/rush.py`, mit der Regeneration des jeweiligen Kommandanten; Einheiten · Mass; FA in Klammern, wenn abweichend):

| Angreifer | → Vogt | → Rädelsführer | → Prior | → Kantor |
|---|---|---|---|---|
| Punze (Varkan) | 19 · 1.064 | 18 · 1.008 (FA 17) | 18 · 1.008 | 19 · 1.064 (FA 18) |
| Zecke (Skarn) | 18 · 1.008 | 17 · 952 | 17 · 952 | 18 · 1.008 |
| Kauri (Sael) | 22 · 1.188 | 21 · 1.134 | 21 · 1.134 | 22 · 1.188 |
| Triller (Aurith) | 18 · 972 (FA 19) | 17 · 918 | 17 · 918 (FA 18) | 18 · 972 |
| Stichel (Varkan) | 33 · 990 | 31 · 930 | 32 · 960 | 33 · 990 |
| Floh (Skarn) | 34 · 1.190 | 32 · 1.120 | 33 · 1.155 | 34 · 1.190 |
| Knallkrebs (Sael) | 21 · 882 | 20 · 840 | 21 · 882 | 21 · 882 |
| Pfiff (Aurith) | 44 · 880 | 41 · 820 | 42 · 840 | 43 · 860 |

28 von 32 Paarungen entsprechen exakt FA, die übrigen vier liegen eine Einheit daneben (Punze-Schaden bzw. Triller-HP, s. o.). Rädelsführer und Prior sind wie ihre Vorbilder etwa 5 % billiger zu überrennen als Vogt und Kantor (eine T1-Einheit weniger). `cross.py` ist ab jetzt das maßgebliche Rush-Modell; die Tabellen in den einzelnen `roster.md` können wegen leicht anderer Modellannahmen um ±1 abweichen.

### 5.4 Korrekturen im fraktionsübergreifenden Abgleich

| # | Befund | Korrektur | Dateien |
|---|---|---|---|
| X1 | **Doppelwaffen:** spooky-db fasst zwei gleiche Waffen zu einem Eintrag mit `WeaponNumber` 2 zusammen. Die Aurith-Review hatte das bei sich behoben; bei Varkan, Skarn und Sael waren `DEA0202` (T2-Jagdbomber, zwei Luftkanonen à 75) und `URA0102`/`UAA0102` (T1-Abfangjäger, zwei Werfer à 3 × 8) noch halbiert. Gegen FAF `develop` geprüft (LeftBeam/RightBeam bzw. AutoCannon/AutoCannon2). Die Skarn-Bremse hatte dadurch nur 24 statt 48 DPS (Luftkampf verloren), Elster und Raubmöwe nur die Hälfte ihrer Luftwaffe. | `fa_ref.json` (Varkan, f2, f3) zählen doppelt; **Elster** Luftkanonen 2 × 70, **Bremse** 2 × 3 × 8, **Raubmöwe** 2 × 75; Sael-`FA_OVERRIDES` und Validator nachgezogen. | `tools/roster/fa_ref.json`, `gen.py`; `f2/fa_ref.json`, `f2/gen.py`; `f3/fa_ref.json`, `f3/gen.py`, `f3/validate.py`; Texte in `f4/md.py`, `f4/faction.md` |
| X2 | **Eco-Rundungsreste** (0,4–2,2 %) bei acht Gebäuden bzw. Engineers | auf Varkan-Werte gesetzt (§5.1) | `f2/gen.py`, `f3/gen.py`, `f4/gen.py`, `f3/faction.md` §9.5 |
| X3 | **Bomber → Mex:** Die Varkan-Zapfstelle I hatte 420 statt 400 HP. Der Sael-Bomber (200 Schaden) brauchte dadurch 3 statt 2 Anflüge, ein klassischer FA-Breakpoint. | Zapfstelle I 400 HP (FA-Relation) | `tools/roster/gen.py` |
| X4 | **Varkan-Stichel** (32 Mass, 70 HP statt 30 / 60) verschob vier Kreuz-Breakpoints (Triller → Stichel 3 statt 2, Zecke → Stichel 9 statt 8, Floh → Stichel 4 statt 3, Pfiff → Stichel 18 statt 15). | Stichel 30 Mass / 120 E / 120 BT / 60 HP, exakt FA; alle Varkan-Pflichtpaare bleiben. Gruppengefecht Raider ↔ Raider danach ±5 % zur FA-Relation. | `tools/roster/gen.py`, Texte in `f2/md.py`, `f4/md.py`, `f4/faction.md` |
| X5 | **T1-Luftkampf:** HP ±5 % an vier Jägern und einem Bomber verschoben acht Luft-Breakpoints (sechs Jäger → Jäger, zwei Jäger → Bomber). | Turmfalke 295, Bremse 280, Brummer 200, Sturmvogel 285 HP, Zikade 17 Schaden, alle exakt FA. Jäger ↔ Jäger danach ±4 %. | `tools/roster/gen.py`, `f2/gen.py`, `f3/gen.py`, `f4/gen.py`, `f3/md.py` |
| X6 | **Namenskollisionen** Skarn ↔ Varkan/Aurith | Wabe, Schlehe, Snare (§4.5) | `f2/gen.py`, `f2/md.py`, `f2/faction.md` |
| X7 | **Farbnähe** Aurith-Perlglas ↔ Sael-Perlmutt | Perlglas `#D5DCE2` (§4.3) | `f4/faction.md` §4.1, `f4/md.py` |
| X8 | Varkan-`validate.py` zeigte auf einen alten Worktree-Pfad | Pfad relativ zum Skript | `tools/roster/validate.py` |

Nach allen Korrekturen bestehen alle vier Einzel-Validatoren und `cross.py` ohne Verstoß.

---

## 6. Asymmetrie-Matrix

### 6.1 Stärke je Phase und Rollenklasse

Rollen-Mittel (geometrisch) von DPS/Mass × HP/Mass gegenüber derselben Varkan-Rolle, in Klammern dieselbe Relation der FA-Referenzen. Varkan ist die Nulllinie. Das Maß ist grob: Reichweite, Tempo, Splash, Regeneration und Post-MVP-Mechaniken fehlen darin. Es zeigt, **wo** eine Fraktion ihre Stärke hat, nicht, wer gewinnt.

| Fraktion | Klasse | Early (T1) | Mid (T2) | Late (T3) |
|---|---|---|---|---|
| Skarn | Linie/Raider | +6 % (±0 %) | −30 % (−29 %) | +49 % (+33 %) |
| Skarn | Artillerie | +138 % (+117 %) | −5 % (−14 %) | −11 % (−10 %) |
| Skarn | Flugabwehr | +15 % (+16 %) | −7 % (−10 %) | −24 % (−26 %) |
| Skarn | Luft-Boden | −23 % (−20 %) | −53 % (−55 %) | – |
| Skarn | Verteidigung | −8 % (±0 %) | −15 % (−8 %) | −30 % (−34 %) |
| Skarn | Schild | – | +13 % (+35 %) | −12 % (+3 %) |
| **Skarn** | **Σ** | **+14 % (+13 %)** | **−20 % (−18 %)** | **−12 % (−12 %)** |
| Sael | Linie/Raider | −14 % (−19 %) | +26 % (+30 %) | +11 % (+3 %) |
| Sael | Artillerie | +586 % (+507 %) | ±0 % (−9 %) | −2 % (−5 %) |
| Sael | Flugabwehr | −9 % (−8 %) | −8 % (−11 %) | −7 % (−7 %) |
| Sael | Luft-Boden | −45 % (−46 %) | −11 % (−14 %) | – |
| Sael | Verteidigung | −11 % (±0 %) | −18 % (−14 %) | −16 % (−16 %) |
| Sael | Schild | – | +30 % (+31 %) | +39 % (+44 %) |
| **Sael** | **Σ** | **+8 % (+7 %)** | **+2 % (+1 %)** | **+1 % (±0 %)** |
| Aurith | Linie/Raider | +11 % (+3 %) | +28 % (+28 %) | +47 % (+46 %) |
| Aurith | Artillerie | −46 % (−51 %) | +17 % (+9 %) | +45 % (+42 %) |
| Aurith | Flugabwehr | +3 % (+1 %) | −13 % (−12 %) | −6 % (−4 %) |
| Aurith | Luft-Boden | −32 % (−30 %) | −30 % (−34 %) | – |
| Aurith | Verteidigung | −6 % (±0 %) | −11 % (−4 %) | −16 % (−15 %) |
| Aurith | Schild | – | +20 % (+24 %) | −1 % (+7 %) |
| **Aurith** | **Σ** | **−12 % (−14 %)** | **−4 % (−3 %)** | **+11 % (+13 %)** |

Die Sael-T1-Artillerie (+586 %) ist ein Stellungsbrecher mit 200 Schaden pro Schuss; gegen bewegte Einheiten begrenzen sie Flugzeit und Streuung (`firingRandomness`, K1), was dieses Maß nicht sieht.

**Gates in `cross.py`:** Keine Fraktion liegt in allen drei Phasen mehr als 10 % vor oder hinter Varkan (Dominanz). Jede Klasse liegt höchstens ±25 % neben der FA-Relation (Identität bleibt erhalten). Beides ist erfüllt.

### 6.2 Identität in Worten

| | **Early (T1)** | **Mid (T2)** | **Late (T3)** | Stärken | Schwächen |
|---|---|---|---|---|---|
| **Varkan** | solide Punze-Linie, Kelle mit größerem Splash | Meißel + Rinne, Schürze | Fallhammer, Pfanne, zähe Stellungen | Allrounder, zähe Basis (+8–11 % HP/Mass bei Stellungen), keine Lücke | keine Spitze; muss über Eco und Timing gewinnen |
| **Skarn** | **stärkste Phase:** harte Nessel (2,3× Kelle-Schuss), Klette trifft Luft und Boden, schnelle Glaskanone Zecke (Tempo 3,7) | Delle: schwacher T2-Sturmläufer und T2-Luft (wie Vorbild); starke, billige Kokon-Schilde | Tarantel als stärkster T3-Läufer (+49 %) | Tempo, Early-Druck, nachwachsende Basis, stärkste T1-Flugabwehr | hält Linien schlecht, dünne Stellungen, T2-Luft schwach |
| **Sael** | Kauri schießt weiter (RW 26), hält aber wenig aus; Dünung bricht Stellungen | Triton tötet eine Punze mit einem Schuss; stärkste Schilde | wenige, teure Spitzen; Schilde +39 % | Reichweite, Präzision, Schilde, Einzelschuss | zerbrechliche Basis (−11 bis −31 %), Overkill gegen Schwärme, schwacher T1-Bomber |
| **Aurith** | **schwächste Phase:** kein T1-Bot (Pfiff ist Späher und Raider), teure, fragile Hörner, raid-anfällige Engineers | Brüller trägt die Front (+102 %), Heuler tötet T1-Panzer in 2 Schüssen | **stärkste Phase:** Grollen (Hybrid, +47 %), Diskant mit zwei Feuermodi | Qualität, Hybride sparen Unit-Cap, schwere Einzelschüsse | Masse und Raids früh, teure Luft |

**Fazit:** Jede Fraktion hat eine eigene Phase, in der sie Druck machen muss (Skarn früh, Aurith spät, Sael mit Schildern und Reichweite im Mittelfeld, Varkan überall solide), und keine dominiert. Die größte Delle ist Skarn in T2 (−20 %, FA-Relation −18 %). In FA gleicht die Vorbild-Fraktion das mit Tarnung, Lähmung und Amphibik aus, die im MVP fehlen (§7). Deshalb ist Skarn-Mid der wichtigste Prüfpunkt für MS12/MS13: Verliert Skarn im KI-Spiegeltest gegen Varkan die T2-Phase deutlich (Mass-Verlustquote > 1,3 bei gleicher Eco), greift Skarn-Regel `f2/faction.md` §9.5 Nr. 1 für Milbe und Hummel (bis +15 % innerhalb des Bands).

---

## 7. Asymmetrien, die Post-MVP-Features brauchen

Alle Einträge sind additiv: Die Kern-Balance (§5, §6) ist ohne sie gemessen, und jede Einheit ist ohne sie spielbar. Maschinenlesbar in `special.postMvp` bzw. `reservedPostMvp` der Roster.

| Feature | Varkan | Skarn | Sael | Aurith |
|---|---|---|---|---|
| **I5** Stealth, Cloak & Jamming | – | Schabe tarnt sich, Rädelsführer-Tarnung (mit U14); reserviert: Silberfisch (mobiles Tarnfeld), Nachtschatten (Tarnfeld-Generator) | – (keine Tarn-Identität) | Pfiff tarnt sich im Stand |
| **K18** EMP/Stun | – | Nessel-Treffer lähmen, Tarantel-Death-EMP, Geflechtriss lähmt (Skarn-eigene Ergänzung) | Tölpel-Bombe lähmt | – |
| **M13** Wasser-Layer (Hover, Amphibisch) | – (Engineers bleiben Land) | amphibisch: Rädelsführer, Engineers; reserviert: Wasserläufer, Schildwanze | schweben über Wasser: 11 Schweber (Kampf, Späher, Schild), Engineers, Prior | Heuler und Stille schweben; Grollen und Engineers amphibisch |
| **K10** Schilde (Personal, über das MVP hinaus) | – | – | Personal-Schild Triton, Einsiedler (MVP-Fallback: HP + Schild addiert) | – (nur Blasen-Schilde) |
| **B8** Generisches In-Place-Upgrade | – | Kokon IV/V | – | – |
| **U14** ACU-Enhancements | – | Rädelsführer (Tarnung, Strahl) | Prior (Teleport, Lähm-Aura mit K18) | Kantor (Regen-Aura, Feuerrate, Teleport) |
| **K16** TML & TMD | – | Tarantel-Raketenablenker | – | Kantor-Rakete |
| **U17** Marine | – | reserviert: Bisamratte (mit M13) | Bauen auf Wasser (mit M13) | – |
| **U18** U-Boote & Torpedos | – | – | – | Grollen-Torpedo |
| **I4** Sonar & Omni | – | – | – | Widerhall III (Omni) |
| **C17** Fähigkeits-Toggles (MVP-optional) | Auto-Abstich | Auto-Überschlag | Auto-Glanzstoß | Auto-Aufschrei, **Diskant-Feuermodus** (neuer Toggle „Modus“) |
| **K1-Erweiterung** Strahlwaffe (noch ohne eigene ID) | – | nur spätere Experimentals | – | Gabel II (MVP-Fallback: Hitscan-Puls bzw. Projektil mit gleichem DPS) |
| **Neue ID nötig** | – | – | Hingabe (Engineer opfert sich in einen Bau), Schildbrecher-Schadenstyp | – |

**Am stärksten betroffen** ist Skarn (I5, K18, M13 tragen die halbe Vorbild-Identität), danach Sael (M13 für das Schweben, K10 für Personal-Schilde). Aurith braucht vor allem C17 und die Strahl-Entscheidung in K1. Varkan braucht nichts.

---

## 8. Empfohlene Implementierungsreihenfolge nach dem MVP

Das MVP liefert Varkan allein (MS14). Danach:

| Schritt | Inhalt | Voraussetzungen | Begründung |
|---|---|---|---|
| 1 | **Gemeinsame Grundlagen:** Material-Tabelle pro Fraktion im Shader, neue Primitive (Skarn Beinparameter, Sael `ellipsoid`/`cone`/`torus`, Aurith `legs.count: 3`), generische `regen`-Spalte (G6) für Strukturen, Render-Bench mit 56 Visuals (zwei Fraktionen im 1v1) | MS10 (G6), MS14 | Alle drei Fraktionen brauchen das; ohne Bench kein zweites Visual-Set im Match. |
| 2 | **U19: Skarn** als zweite Fraktion, zuerst die 26 ●-Blueprints, dann die übrigen 24 | Schritt 1, K10 (Kokon) | U19 verlangt ein Gegenstück zu Varkan; Skarn ist das. Alle MVP-Rollen laufen mit MVP-Mechanik, das Roster ist fertig balanciert. |
| 3 | **I5 + K18** (Tarnung, Lähmung) | Schritt 2 | Gibt Skarn die fehlende Vorbild-Identität zurück (Mid-Delle, §6.2) und bringt Aurith die Pfiff-Tarnung. Danach Skarn-Reserverollen Silberfisch und Nachtschatten. |
| 4 | **M13** (Wasser-Layer: Hover und Amphibisch) | Schritt 2 | Voraussetzung für Sael-Schweben, Skarn-Amphibik und Aurith-Gleiter; zahlt sich mit U17 doppelt aus. |
| 5 | **U22a: Sael** | Schritte 1 und 4 (Schweben kann bis dahin reine Optik bleiben), K10 | Nächste Mechanik-Nähe zu Varkan; der Personal-Schild-Fallback ist schon balanciert. |
| 6 | **U22b: Aurith** | Schritte 1 und 5, C17 (Modus-Toggle), Entscheidung Strahlwaffe in K1 | Braucht die meisten Sonderwege (Hybride, 49 statt 50 Blueprints, zwei Feuermodi). |
| 7 | U14 (Enhancements), K16, U17, U18, I4 | je nach Plan | Kommandanten-Asymmetrien und die restlichen Markierungen aus §7. |

Für jeden Schritt gilt: vor dem Einbau alle Einzel-Validatoren und `cross.py` laufen lassen; neue FAF-Datenstände zuerst in die `fa_ref.json` aller Fraktionen übernehmen.

---

## 9. Offene Punkte

1. **Markenrecherche** für alle vier Fraktionsnamen, Kommandanten und Rufnamen (FA-Grep ist erledigt, vor dem Einfrieren gegen den aktuellen FAF-Stand wiederholen).
2. **Namespace:** `core:` (Varkan) gegen `f2:`–`f4:`. Vor den ersten Blueprints einheitlich entscheiden (`f4/faction.md` §11.2 Nr. 3).
3. **Draw-Budget:** 28 Visuals pro Fraktion, im 1v1 bis zu 56 aktiv (DECISIONS 17 rechnet mit 40). Render-Bench vor Schritt 2.
4. **Skarn-Mid** (§6.2) im KI-Spiegeltest MS12/MS13 prüfen.
5. **Punze 28 Schaden / 1,2 s** (FA-Referenz 24 / 1,0 s) bleibt eine Hauptursache der restlichen Kreuz-Abweichungen (§5.2), direkt oder über die HP-Anker der anderen Fraktionen. Wenn MS9 zeigt, dass die Varkan-Signatur nicht gebraucht wird, zuerst die Punze auf FA setzen, dann Kauri- und Triller-HP neu verankern und `cross.py` erneut laufen lassen.
6. **Kantor-Wrack und Vogt-Wrack** gemeinsam entscheiden (`../faction.md` §10.2 Nr. 3, `f4/faction.md` §11.2 Nr. 11).
7. **Streuung (K1):** Sael trägt `firingRandomness` für ballistische Artillerie; K1 muss die Umrechnung für alle Fraktionen festlegen, danach ergänzen Varkan, Skarn und Aurith dasselbe Feld.

---

## 10. Werkzeuge

| Skript | Zweck |
|---|---|
| `tools/roster/gen.py`, `md.py`, `validate.py` | Varkan (im Ordner `tools/roster/` ausführen) |
| `tools/roster/f2/`, `f3/`, `f4/` | je `gen.py`, `md.py`, `validate.py`, eigene `fa_ref.json` der Vorbild-Fraktion |
| `tools/roster/cross.py` | N × N-Prüfer aller Fraktionen: Eco-Gleichstand, Kreuz-Treffer-bis-Tod, Gruppengefecht, Rush, Phasen-Matrix mit Dominanz- und Identitäts-Gate, Icons, Namen. `--md` gibt die Tabellen dieses Dokuments aus. Exit-Code 1 bei Verstoß. |
| `tools/roster/fa_names.json` | alle FA-Einheiten- und Waffennamen (spooky-db 3810, dev-only) für den Namens-Grep, gemeinsam für alle Fraktionen |

Reihenfolge nach einer Änderung: `python3 tools/roster/validate.py` (Varkan-Werte ändern sich nur über `gen.py` im Ordner `tools/roster/`), dann `gen.py && md.py && validate.py` für f2, f3, f4 (sie lesen das Varkan-Roster für ihre Kreuz-Checks), zuletzt `python3 tools/roster/cross.py`.
