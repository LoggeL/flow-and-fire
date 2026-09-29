# Fraktion: Der Aurith-Chor

> **Status:** Designkonzept für U22 („Fraktionen 3 & 4“), Fraktion 4. Stilistische Anlehnung an die vierte FA-Fraktion (fremdartig, ornamental, wenige große Einheiten, Hybrid-Rollen), rechtlich und inhaltlich eigenständig. Gewählt aus drei Varianten (Herleitung in §10).
> **Umfang:** 49 Blueprints (22 mobil, 27 Gebäude), davon **26 im MS9-Kern (●)**, Rest bis MS14 (○). Ein Blueprint weniger als Varkan, weil Späher und leichter Sturmläufer in einer Hybrid-Einheit zusammenfallen (§9.2). Waffen- und Projektil-BPs sind nicht mitgezählt.
> **Quelle der Zahlen:** `docs/design/factions/f4/roster.json` (Schema `faf-roster/1`) ist die einzige Quelle für Werte, ●/○-Status und Kitbash-Parts; lesbar in `docs/design/factions/f4/roster.md`, erzeugt und geprüft mit `tools/roster/f4/` (`gen.py`, `md.py`, `validate.py`). Die Zahlen in §7.4, §9 und §11.1 sind an das Roster angeglichen (Abgleich: `roster.md` §18). Bei Widerspruch gilt `roster.json`.
> **Mechanik:** Gleiche Balancing-Methodik wie Varkan (`docs/design/roster.md` §1, §14): DPS/Mass und HP/Mass je ±25 % zur FA-Referenz, Produkt ±15 %, Pulk-DPS/Mass der Artillerie ±15 %, Treffer-bis-Tod-Matrix exakt. **Referenz ist hier die Vorbild-Fraktion** (FA-Blueprints `XS*`/`DSLK004`, spooky-db 3810, extrahiert in `tools/roster/f4/fa_ref.json`). Die Asymmetrie entsteht dadurch, dass die Vorbild-Relationen übernommen werden, nicht durch Sonderregeln außerhalb des MVP. Asymmetrien, die Post-MVP-Mechanik brauchen, sind mit Feature-ID markiert (§9.4) und rein additiv.
> **Abgrenzung:** keine FA-Namen, keine FA-Lore, keine FA-Designs, keine FA-Assets, kein Nachbau des Klangmusters der FA-Einheitennamen (§2.4). Mechanik-Begriffe der UI bleiben neutral: Mass, Energy, Build Power, Assist, Reclaim, T1–T3.

---

## 1. Name

| | DE | EN |
|---|---|---|
| Fraktion (UI-Kurzname) | **Aurith** | **Aurith** |
| Vollname (Lore) | der Aurith-Chor | the Aurith Choir |
| Adjektiv | aurithisch | Aurith (attributiv) |
| Welt | Kessa | Kessa |
| Spieleridentität | Chor (Teamfarbe = Tonart) | Choir |

- **Aussprache:** „AU-rith“, Betonung auf der ersten Silbe, weiches „th“ wie in EN *thin* (DE darf „AU-rit“ sprechen). Kein reales Wort, keine Umlaute. „Aur-“ ruft Gold und Bernstein auf, „-ith“ klingt nach Stein und Kristall.
- **Chöre:** Jeder Spieler und jede KI ist ein Chor, benannt nach dem Intervall, in dem er singt. Namensvorschläge für `aiProfile` und die Match-Anzeige: *Chor der Quinte, Chor der Terz, Chor der Septime, Chor der Quarte, Chor der Oktave, Chor des Tritonus* (EN *Choir of the Fifth, … of the Tritone*). Der Tritonus ist der Chor, mit dem niemand zusammenklingt, also der natürliche KI-Rivale.
- **Kontrast zu Varkan:** Varkan ist ein Bund menschlicher Häuser im Orbit; die Aurith sind nicht-menschlich und gehören zu Kessa selbst. Die Häuser nennen sie in eigenen Texten „Fremdchor“ (EN *the Choir*).
- **Offen:** Markenrecherche „Aurith“ und aller Rufnamen (§11.2).

---

## 2. Lore

### 2.1 Kurz-Lore (≈ 140 Wörter, Text für Lobby und Handbuch)

> Unter Kessas dünner Kruste fließt nicht nur Metall. In der Schmelze schwingt etwas, das älter ist als jede Hütte im Orbit: die Aurith, Muster aus Klang, die sich in Bernsteinglas einen Körper geben. Wo eine Ader die Oberfläche berührt, an den Klangstellen, dringt ihr Gesang nach oben.
>
> Jeder Chor singt in eigener Tonart, und zwei Tonarten können an einer Stelle nicht zugleich klingen. Darum steigt ein Kantor auf: Er singt sich aus der Schmelze empor und stimmt den Ort auf seinen Grundton. Alles Weitere singt er vor Ort in Form.
>
> Bricht der Kantor, verstummt der Grundton. Die Tonart zerfällt, und alles, was der Chor gesungen hat, wird zu stummem Bernstein.
>
> Die Häuser nennen das Krieg. Die Aurith nennen es Stimmen. Seit die Zapfstellen der Häuser in ihre Adern schlagen, stimmen sie lauter.

### 2.2 Weltregeln: Jede Regel begründet eine Mechanik, die schon im Plan steht

| Weltregel | Mechanik (Feature) | Umsetzung / Text |
|---|---|---|
| **Grundton:** Ein Ort gehört dem Chor, dessen Kantor dort singt. | U1: ACU verloren = Spiel verloren, A4 | Niederlage-Text: „Grundton verstummt. Tonart zerfallen.“ / „Keynote silenced. Key dissolved.“ |
| **Aufklang:** Der Kantor steigt aus einer Klangstelle aus der Schmelze auf. | Spielstart, P19 (Warp-in, später) | Platzhalter bis P19: Eine Bernsteinsäule wächst aus dem Boden und zerspringt, darin steht der Kantor (≈ 3 s, nur View). Spielbar ist er ab Tick 0. Gegenstück zur Varkan-Lotung: dort fällt der Kommandant von oben, hier steigt er von unten. |
| **Zerspringen:** Der Kantor hält den ganzen Grundton; bricht er, entlädt sich der Ton als Phasenwelle. | U1: Death-Explosion | hoher Glasklang, blauweißer Blitz, kugelförmige Druckwelle, Kamera-Shake |
| **Gesungene Form:** Alles außer dem Kantor ist vor Ort gesungenes Bernsteinglas. | Fabriken, Engineers, Reclaim | Wracks sind stummer Bernstein, also Reclaim-Masse: „Was verstummt, kann wieder klingen.“ |
| **Einstimmen:** Eine Halle kann feinere Formen singen, sobald sie höher eingestimmt ist. | U5: Fabrik-Upgrade T1→T2→T3 | Tooltip-Verb für das Upgrade: „Einstimmen“ / „Attune“ |
| **Ein Kantor pro Tonart** | ACU ist einzigartig | SACU (U15, Post-MVP) wäre ein „Unterkantor / Succentor“. |
| **Aufschrei:** Der Kantor legt seinen gespeicherten Ton in einen einzigen Stoß. | U8: Overcharge (optional) | Waffenname „Aufschrei“ / „Outcry“ |
| **Klangstellen** sind die Orte, an denen Adern die Oberfläche berühren. | E5 Mex auf Mass-Spots, M4 | Die Aurith und die Häuser wollen dieselben Spots: die einen als Stimme, die anderen als Erz. Das begründet Kämpfe zwischen den Fraktionen (U22). |
| **Chöre untereinander:** Zwei Tonarten an einer Klangstelle reiben sich, bis eine verstummt. | Spiegel-Matches, KI-Gegner | Die KI ist ein rivalisierender Chor, bevorzugt der Tritonus. |

**Passung zu Varkan:** Die Charta des Kompakts kennt nur Präsenz. Ein Kantor auf einer Ader zählt für sie genauso wie ein Vogt, und fällt er, erlischt der Anspruch. Varkan und Aurith teilen also denselben Kern „Kommandant fällt = Anspruch erlischt“, begründen ihn aber verschieden (Vertrag gegen Klang). Weil kein Mensch den Boden betritt, haben die Häuser die Aurith erst bemerkt, als ihre Zapfstellen tief genug bohrten. Das erklärt, warum sich die Fraktionen erst jetzt begegnen.

### 2.3 Ton

- **Ja:** fremd, ruhig, bildhaft. Die Aurith sprechen in Musik- und Naturbildern und benennen Ursache und Wirkung als Klang („Die Stelle ist verstimmt.“). Flavor-Texte sind als *Übertragung* markiert und dürfen kleine Übersetzungsbrüche tragen (`[Übertragung unsicher]`), aber nur in Flavor-Texten, nie in Zahlen, Tooltips oder Alerts.
- **Nein:** Heiligenpathos, Prophezeiung, Kreuzzug, Erlösung, „Reinigung“ oder Vernichtung der Menschheit, Hass. Die Aurith sind weder böse noch fromm. Stimmen ist für sie ein natürlicher Vorgang wie Erosion.
- **Beschreibungstexte (`descKey`):** höchstens 2 Sätze. Satz 1 sagt nüchtern, was die Einheit tut, Satz 2 ist eine übertragene Zeile.
- **Lore-Synonyme** wie „Ton“, „Bernstein“ oder „Klangstelle“ stehen nur in Flavor-Texten, nie in Zahlenanzeigen.

### 2.4 Begriffe, die nicht verwendet werden

| Nicht verwenden (FA-Begriffsfeld) | Stattdessen (DE / EN) |
|---|---|
| Name der Vorbild-Fraktion, Namen der anderen FA-Fraktionen, ihrer Religionen, Heimatwelten und Anführer | Aurith, Chor / Choir, Tonart / Key |
| Armored Command Unit, „Commander“ als Einheitenname | Kantor / Cantor |
| Quantum Gate, Quantum Rift, Warp-in, Dimensionsriss | Aufklang / Rising, Klangstelle / Sounding Spot |
| Overcharge | Aufschrei / Outcry |
| nuklearer ACU-Tod | Zerspringen / Shatter |
| FA-Waffennamen und ihre Wortstämme (Grep-Liste aus spooky-db, §7.1), auch als Übersetzung des Konzepts einer FA-Einheit | Klangbegriffe: Gabelton, Stoßton, Streuklang, Schwebung, Entladung, Entladungsbogen (§7.3) |
| Einheitennamen im Klangmuster der Vorbild-Fraktion (Kunstwörter mit Bindestrich-Silben und gedoppelten Vokalen) | echte DE/EN-Wortpaare aus Musik und Klang (§7) |
| Motive der Vorbild-Lore: Invasion aus einer anderen Dimension, Ausrottung, Aufstieg, Prophet | Ureinwohner Kessas, Konkurrenz um Klangstellen, Stimmen als Naturvorgang |
| „Hydrocarbon Plant“ | Äolsharfe / Aeolian Harp (ID `hydro` bleibt intern) |

Das Feld `faReference` in `roster.json` zitiert FA-Rollenstrings und Blueprint-IDs nur zu Entwicklungszwecken (`devOnly: true`). Der Blueprint-Build entfernt es per Lint; es darf nie in `view.json` oder i18n landen.

---

## 3. Designsprache „Gesungenes Glas“

### 3.1 Leitmotiv

**Gestimmt, nicht gebaut.** Jede Einheit ist ein geschwungener Körper aus Bernsteinglas-Schalen über einem dunklen Pechglas-Kern. Obenauf trägt sie einen langen, geschwungenen Kamm in Teamfarbe. Phasenblaue Glyphenbänder laufen wie Notenlinien über die Schalen. Alles, was zielt oder feuert, ist dagegen gerade und schmal: Gabelzinken, Pfeifen, Trichterachsen. Die Proportionen sind nicht-menschlich: hoher Schwerpunkt, kein Kopf, Dreizahl statt Zweizahl.

**Kontrast zu Varkan auf einen Blick:** Varkan ist niedrig, breit, kantig, dunkel mit oranger Glut. Aurith ist hoch, schlank, gerundet, hell-amber mit blauem Leuchten. Beide Fraktionen folgen denselben Lesbarkeitsgesetzen (§5.1), damit ein Spieler nur eine Formensprache für Rollen lernen muss.

### 3.2 Formregeln

| Regel | Umsetzung |
|---|---|
| **Kiel statt Wanne** | Alle Land-Fahrzeuge **gleiten** auf einem Kiel (gestreckte, unten abgeflachte Linse), 0,2–0,3 WU über dem Boden, mit dunklem Schwebespalt. Keine Ketten, keine Räder. Das ist reine Optik: In der Sim sind Gleiter normale `LAND`-Einheiten. Echtes Schweben über Wasser ist Post-MVP (M13, §9.4). |
| **Dreibein statt Zweibein** | Läufer (Sturmläufer, Präzisionsläufer, Kantor) gehen auf **drei** Beinen mit rückwärts geknickten Gelenken. Die Beine bleiben prozedural (Render-Pfad `legs`), brauchen aber den Parameter `count: 3` (§3.6). |
| **Kurve = Körper, Gerade = Waffe** | Umkehrung der Varkan-Regel: Rumpf, Schalen und Kämme sind geschwungen, alles, was zielt oder feuert, ist gerade. Dieser Kontrast trägt die Lesbarkeit. |
| **Höhe** | Mobile Einheiten sind höher als breit: Höhe ≥ 0,6 × Rumpflänge (Varkan ≤ 0,45). Der Kamm trägt den Großteil der Höhe und ist teamfarben. So bleibt die Draufsicht schlank, und die Seitenansicht ist sofort als „fremd“ lesbar. |
| **Signatur-Formen** | **Gabel** (zwei parallele gerade Zinken) = Direktfeuer. **Trichter** (Horn, offen, schräg) = Artillerie. **Pfeifen** (senkrecht, gestufte Länge wie ein Orgelprospekt) = Flugabwehr. **Spindel** (schräg) = Raketenwerfer. **Sichel** = Bauen. **Krone** (drei Kristalle) = Kantor. Jede Form gehört genau einer Rolle (§5.2), Hybride tragen zwei (§5.3). |
| **Richtung** | Die Gabel zeigt die Zielrichtung, die Kielspitze die Fahrtrichtung, der Kamm läuft immer nach hinten aus. Luftfahrzeuge zeigen die Richtung über ihren Grundriss. |
| **Symmetrie** | Mobile Einheiten sind längs spiegelsymmetrisch. Nur Engineers und der Kantor sind asymmetrisch (Sichel). Gebäude sind **dreizählig radialsymmetrisch** (Dreipass-Sockel), die Fabrik-Öffnung ist die einzige Ausnahme. |
| **Keine Filigranteile** | Wie Varkan: Kein Teil ist schmaler als 12 % der Einheitenlänge (`iconThreshold` mobil 25 px, nichts unter 3 px). Bei der Triller-Basis (1,4 WU) heißt das: Gabelzinke Ø ≥ 0,17 WU, Pfeife Ø ≥ 0,17 WU, Trichteröffnung ≥ 0,5 WU, Kamm ≥ 0,17 WU dick. Glyphenbänder sind Textur und Emissive-Maske, nie Geometrie. |
| **Gebäude** | Jedes Gebäude steht auf einem **Dreipass-Sockel** (drei überlappende flache Linsen), der den Footprint an der Kante zu 100 % füllt. Das Rollen-Element sitzt oben: Kristalle, Reif, Gabel, Pfeifen, Muschel oder Trichter. |
| **Placeholder = Final-Silhouette** | Final-Assets ergänzen nur Details wie Facetten, Glyphen und Schalenränder. Der Umriss darf sich höchstens um 10 % ändern. |

### 3.3 Kitbash-Teilekatalog

Part-Keys englisch (Code), DE-Namen für Dokumentation und Tooltips. Jeder Part ist ein Low-Poly-Primitiv, das `view.placeholder` prozedural erzeugen kann. Die Parts `legs`, `ring` und `mast` sind mit dem Varkan-Katalog identisch und werden geteilt.

| Part-Key | DE | Primitiv | Tris LOD0 | Verwendung |
|---|---|---|---|---|
| `keel` | Kiel | Ellipsoid 8×4, unten abgeflacht, vorn spitzer | ≈ 48 | Rumpf aller Gleiter, Torso des Kantors |
| `lens` | Linse | flaches Ellipsoid 8×3 | ≈ 36 | Sockel (3 Stück = Dreipass), Bomber-Rumpf, Energiespeicher, Gondeln |
| `legs` | Beine | prozedural, `count: 3` (Schema-Erweiterung) | – | Läufer, Kantor |
| `fork` | Gabel | zwei parallele 6-seitige Prismen mit Steg | ≈ 40 | Direktfeuer (Einheiten, Gabel-Stellung, Kantor-Brust, Gunship) |
| `horn` | Trichter | offener Kegelstumpf, Öffnung : Hals ≈ 2,5 : 1 | ≈ 32 | Artillerie (mobil und statisch) |
| `pipe` | Pfeife | 6-seitiger Zylinder mit schräg gefastem Kopf | ≈ 20 | nur Flugabwehr (2–4 Stück, gestufte Länge) |
| `spindle` | Spindel | gestreckter Doppelkegel, 6-seitig | ≈ 24 | Raketenwerfer (schräg), Raketen-Flugabwehr (senkrecht, dicker) |
| `crystal` | Kristall | 6-seitiges Prisma mit Pyramidenspitze | ≈ 24 | **nur Flow-Einheiten** (ECONOMIC, FACTORY, ENGINEER inkl. Kantor): Krone, Resonator, Stimmstock, Hallen, Sichelspitze |
| `sickle` | Sichel | Torus-Segment 180°, 8×3 | ≈ 36 | nur Bauen: Engineer-Bauarm, Bau-Sichel des Kantors |
| `ring` | Reif | flacher Torus 8×3 | ≈ 48 | Schild (waagerecht), Stimmstock-Kranz, Äolsharfe, Landereif der Himmelshalle, Gunship-Antrieb (senkrecht) |
| `fin` | Kamm | gebogenes, flaches Prisma (extrudierter Bogen) | ≈ 16 | Teamfarben-Träger aller Einheiten, Flügel, Pfeifenplatte, Rampe, Grat |
| `mast` | Mast | dünner Zylinder | ≈ 24 | Intel, Schild |
| `shell` | Muschel | halbe Linse, innen offen | ≈ 36 | Radar-Schale, Hallen-Apsis (halb offene Kuppel), Bomber-Fächer |

**Budget (Abnahmekriterium, identisch zu Varkan):**
- Mobile Einheiten: 4–7 Parts, davon höchstens 2 animiert (Yaw/Pitch im `PartStream`, Limit 8 Parts pro Unit). Strukturen: 4–9 Parts.
- Platzhalter-Mesh ≤ 350 Tris LOD0.
- **Ein Visual pro Rolle = ein Superset-Mesh** mit Tech-Bitmaske pro Vertex (Varkan `faction.md` §3.3). Superset ≤ 8 Parts mobil, ≤ 9 Strukturen, ≤ 350 Tris. Ziel: **≤ 28 Visuals** (Liste in `roster.md` §16, erreicht: 28), damit alle vier Fraktionen im Spiegel-Match zusammen im CSM-Draw-Budget bleiben (je Match sind nur zwei Fraktionen aktiv).

### 3.4 Tech-Skalierung per Kitbash

| Tech | Maßstab mobil | Höhe Strukturen | Tonpunkte | Zusatz |
|---|---|---|---|---|
| T1 | 1,0 | 1,0 | 1 | Grundform |
| T2 | 1,3 | 1,2 | 2 | längere Gabelzinken oder zweite Pfeifenreihe, Kamm um 30 % länger |
| T3 | 1,7 (bei 1×1-Footprint max. 1,4) | 1,4 | 3 | Doppelkamm (zwei parallele Kämme) oder überlanger Kiel; **kein** Kristall (Resonanz-Monopol §3.5) |

- Maßstabsregeln für mobile Einheiten und Strukturen wie Varkan (`faction.md` §3.4): Sockel füllt 100 % des Footprints, In-Place-Upgrades wachsen nur in der Höhe, Werte je Blueprint in `kitbash.scale`.
- **Tonpunkte** ersetzen die Varkan-Tech-Streifen: 1–3 runde Punkte in einer Reihe auf dem hinteren Kamm, Ø 0,12 WU × Maßstab, Abstand 0,08 WU × Maßstab (bei 48 px Silhouette ≈ 3,5 px pro Punkt). Umsetzung als Maske, nicht als Geometrie. Farbe Perlglas; bei Engineers, deren Rücken selbst Perlglas ist, Pechglas. Kantor und Grat tragen keine Punkte. Die Zahl entspricht exakt den Tech-Kerben im Icon (§6).

### 3.5 Leuchten als Spielinformation (nur View, kein Sim-Einfluss)

Zwei Leucht-Klassen mit **derselben Bedeutung wie bei Varkan**, damit ein großer leuchtender Punkt fraktionsübergreifend „Wirtschaft oder Bau“ heißt:

| Klasse | Wer | Fläche | Bedeutung |
|---|---|---|---|
| **Glyphenband** | alle Einheiten | ≤ 3 % der Oberfläche, schmale phasenblaue Linien auf den Schalen | Zustand der Einheit (Varkan: Glutnaht) |
| **Resonanzkern** | nur **Flow-Einheiten**: Kantor, Engineers, Hallen, Stimmstock, Resonator, Äolsharfe | 3–6 %, `crystal`-Parts, blauweißer Kern mit Amber-Rand | „Hier entsteht oder fließt Wirtschaft“ (Varkan: Glutkern) |

Kampfeinheiten tragen nie einen Kristall. Lint wie bei Varkan: `crystal` und `mat:'glow'` in Kristallgröße nur bei ECONOMIC, FACTORY, ENGINEER.

**Zustände über den View-Parameter `flowGlow`:**
- **Leerlauf:** Glyphen laufen langsam wie Notenlinien vom Bug zum Kamm (UV-Scroll, ein Shader-Parameter).
- **Feuern:** Die Glyphen laufen zur Mündung zusammen, Gabel und Trichter leuchten nur beim Schuss (≈ 0,5 s). Bei Waffen mit langer Nachladezeit (Heuler, Horn, Posaune) läuft die Sammelbewegung während der letzten 1,5 s vor dem Schuss. So ist ein schwerer Schuss **vorher sichtbar**, eine Signatur der Fraktion (nur View).
- **Bauen:** Sichel und Kristalle leuchten auf.
- **Energy-Stall (E3):** Die Resonanzkerne verlieren das Blau und werden trübes Braun, die Glyphen stehen still. Der Flow-Zustand ist ohne HUD im Feld lesbar.
- **Schaden < 50 % HP:** Die Glyphen stottern.
- **Wrack:** stummer Bernstein, milchig-trüb, ohne Emissive (Wreck-Shader).

**Bau und Reclaim:**
- **Baustrahl = Klangfaden:** Der Nano-Strahl ist eine wandernde Sinuswelle in Phasenblau, keine Linie und kein Strom. Die Frequenz skaliert mit der tatsächlich fließenden Build Power nach Stall-Drosselung (E2/E3). Das unterscheidet ihn auf einen Blick vom Varkan-Gießstrom.
- **Bau-Dissolve = Kristallisation:** Der Rohbau erscheint als transluzente blaue Form, die **von außen nach innen** zu Bernstein erstarrt (derselbe Build-Dissolve-Shader, radiale statt vertikale Maske).
- **Reclaim:** Das Wrack springt in Splitter, die als Klangfaden zum Engineer gezogen werden.
- **Budget:** kein Extra-Pass, nur HDR/Bloom der Presets. Auf Low (LDR, ohne Bloom) wird das Leuchten über vollgesättigte Farbe erkennbar.

### 3.6 Placeholder-Schema-Erweiterung (Vorschlag, nicht Teil dieses Dokuments)

Baut auf dem Varkan-Vorschlag auf (`faction.md` §3.6) und ergänzt nur:
- neue `PartKey`s: `keel`, `lens`, `fork`, `horn`, `pipe`, `spindle`, `crystal`, `sickle`, `fin`, `shell`;
- `legs` mit optionalem `count: 2 | 3` (Default 2);
- Material-Slots bleiben **fünf mit derselben Semantik** (0 Körper, 1 Team, 2 Akzent, 3 Emissive, 4 Klassenmarker). Welche Farbe ein Slot hat, liefert eine Material-Tabelle pro Fraktion (§4.1). Platzhalter und Final-Art aller Fraktionen laufen damit durch einen Shaderpfad.

Nur View, betrifft `viewHash`, nicht `simHash`. Umsetzung als eigener Arbeitsschritt im Blueprint-Compiler.

---

## 4. Farben & Teamfarben

### 4.1 Materialien

| Slot (`matId`) | Material | Farbe (linear, Richtwert) | Charakter | Anteil |
|---|---|---|---|---|
| 0 `body` | Pechglas (Kern, Kiel-Unterseite, Beine) | `#1F1B22`, Unterseiten `#141117` | Roughness 0,5, leicht glänzend, kühl-violetter Stich | 20–30 % |
| 1 `team` | Kamm und Glyphenfelder | Teamfarbe | Roughness 0,55, matt | 25–40 % |
| 2 `amber` | Bernsteinglas-Schalen | Grund `#C8912E`, Tiefe `#8A5A18`, Kante `#E8C070` | Roughness 0,3, Fresnel-Kante, Fake-Subsurface über Kantenaufhellung (kein Extra-Pass) | 25–35 % |
| 3 `glow` | Phasenleuchten (emissive) | Kern `#BFF2FF`, Falloff `#3FA9FF`, HDR 3–6 | läuft nach `flowGlow` | 2–6 % |
| 4 `pearl` | Perlglas | kühles Eisweiß `#D5DCE2` (seit dem fraktionsübergreifenden Abgleich; vorher `#E6E0D2`, zu nah am warmen Perlmutt der Sael `#E4DED2`), leicht irisierend (Farbverschiebung nach Blickwinkel) | halbmatt | Tonpunkte, Engineer-Rücken, Sichel |

- **Hell oben, dunkel unten:** Schalen (Amber) und Kamm (Team) liegen oben, Kiel-Unterseite und Beine sind Pechglas. Die Einheit hebt sich ohne Outline vom Terrain ab.
- **Perlglas als Klassenkennung:** Perlglas-Rücken tragen nur Engineers, die Sichel nur Engineers und der Kantor. Sonst erscheint Perlglas nur als Tonpunkt (Varkan: Keramik).
- **Masken-Layout:** Platzhalter bekommen `u8 matId` pro Vertex. Finale Assets (MS14) nutzen dieselbe RGBA-Maske wie Varkan: R = Team, G = Emissive, B = Akzent (hier Amber-Transluzenz statt Metallic), A = AO.
- **Glyphen-Gradient:** Die Glyphenbänder sind eine Kachel-Textur (8 Glyphen, eigene Formen, keine Schrift), die per UV-Scroll läuft. Eine Textur für die ganze Fraktion.

### 4.2 Teamfarben-Flächen

| Klasse | Teamfarbe auf | Mindestanteil an der Draufsicht (Standardkamera 40–60°) |
|---|---|---|
| Mobile Land | Rückenkamm über die ganze Länge und Glyphenfeld auf der Oberschale | **≥ 30 %** |
| Luft | gesamte Oberseite von Flügel bzw. Fächer | **≥ 45 %** |
| Kantor | Hinterkopf-Kamm, Torso-Oberschale, ein Band um die Krone (nicht auf den Kristallen) | ≥ 35 % |
| Engineers | Kiel-Seitenband und Kamm (Rücken Perlglas, Sichel Perlglas) | ≥ 25 % |
| Strukturen | Rand des Dreipass-Sockels, bei Hallen zusätzlich die Apsis-Außenseite | 20–30 % |
| Grat (Mauer) | nur die Firstkante | ≈ 10 % |

- **Nie teamfarben:** Glyphen, Kristalle, Perlglas, Gabeln, Pfeifen, Trichter-Innenseiten, Unterseiten.
- **Messung** wie Varkan: aus der Parts-Spec (Draufsichtfläche mit `mat:'team'`) oder per Masken-Pixelzählung. Vorab-Lint: jeder Blueprint mindestens ein `mat:'team'`-Part.

### 4.3 Teampalette (gemeinsam für alle Fraktionen)

Die 8 Teamfarben sind fraktionsübergreifend identisch (A3, Varkan `faction.md` §4.3), wie in FA: **Farbe = Team, nie Fraktion.** Die Fraktion erkennt man an Formen und Materialien.

**Farbton-Konflikte und Umschaltung (wie die Varkan-Weißglut):**

| Konflikt | Betroffene Teamfarben (Farbtonabstand) | Umschaltung für diese Armee |
|---|---|---|
| Teamfarbe < 25° vom Amber (≈ 39°) | Orange `#E07A1F` (10°), Oliv `#8A8F2E` (24°) | Schalen wechseln auf **Rauchquarz** `#8A8174` (entsättigt). Die Fraktion bleibt über Form, Glyphen und Glanz erkennbar. |
| Teamfarbe < 25° vom Phasenblau (≈ 207°) | Blau `#2F6FD0` (9°), Cyan `#27A6B5` (21°) | Glyphen und Kristalle wechseln auf **Weißphase** `#EAF7FF` mit wenig Sättigung. |

- Rot, Grün, Violett und Pink sind konfliktfrei.
- **Farbenblindheit:** Rolle und Tech liegen immer in Form, Glyphe und Kerbenzahl, nie nur in der Farbe.

---

## 5. Silhouetten-Regeln

### 5.1 Die sechs Lesbarkeits-Gesetze (fraktionsübergreifend, identisch zu Varkan)

1. **Draufsicht zuerst.** Jede Rolle ist als schwarzer Schattenriss aus der Spielkamera (≈ 50°) bei 32 px und 48 px eindeutig.
2. **Monopol-Merkmal.** Jede Rolle hat genau ein exklusives Formmerkmal (Tabelle 5.2). *Aurith-Zusatz:* Hybride tragen zwei Monopol-Merkmale nach §5.3, jedes Merkmal behält seine Bedeutung.
3. **Rolle am Aufbau, Tempo am Fahrwerk.** Gleiter-Kiel = Linie und Tempo, Dreibein = schwerer Läufer (bei Aurith sind die Läufer langsam und zäh, anders als die Varkan-Raider-Bots; das Fahrwerk sagt „schwer“, das Icon sagt die Rolle).
4. **Tech durch Skalierung, nicht durch neue Form** (§3.4).
5. **Winkel-Code:** waagerecht = direkt (Gabel), schräg = indirekt (Trichter 45–55°, Spindel 50°), senkrecht = gegen Luft (Pfeifen ≥ 75°), Mast + Muschel-Schale = Intel, Mast + **waagerechter** Reif = Schild, Reif ohne Mast = Flow-Anschluss (Stimmstock, Äolsharfe, Landereif), **senkrechte** Reifen nur als Luft-Antrieb (Gunship). Eine Form bedeutet mobil und stationär dasselbe (präzisiert im Review, `roster.md` §20 R6).
6. **Nichts unter 3 px** bei `iconThreshold` (mobil 25 px).

### 5.2 Rollen-Tabelle (MVP)

| Rolle | **Hero-Feature (Monopol)** | Pflicht | Verboten |
|---|---|---|---|
| **Direktfeuer Gleiter (Triller, Heuler)** | **Gabel** mit **waagerechten** Zinken auf dem Kiel | Zinken ≥ 60 % der Kiellänge, ragen über die Kielspitze | Zinken steiler als 15° im Leerlauf, Kristall |
| **Sturmläufer (Brüller)** | **Gabel** auf **Dreibein**, Gabel breit (Zinkenabstand ≥ 0,5 × Rumpfbreite) | Kamm nach hinten ≥ 1,0 × Rumpflänge | Trichter, Pfeifen |
| **Präzisionsläufer (Diskant)** | Gabel mit **extrem langen** Zinken (≥ 1,2 × Rumpflänge) auf schlankem Dreibein | eng stehende Zinken | breiter Kamm |
| **Artillerie** | **offener Trichter**, 45–55° geneigt | Öffnung ≥ 0,5 WU, Kamm als Gegengewicht nach hinten | Gabel, Pfeifen |
| **Raketenwerfer (Posaune)** | **eine dicke Spindel**, 50° geneigt, auf Schwenkfuß | Spindel-Ø ≥ 2 × Pfeifen-Ø | Trichter, Pfeifen |
| **Flugabwehr** | **2–4 senkrechte Pfeifen** (≥ 75°) mit **gestufter Länge** (Orgelprospekt) quer zur Fahrtrichtung, auf teamfarbener Kamm-Platte | Pfeifen höchstens halb so dick wie die Spindel | Trichter, Gabel als Hauptmerkmal |
| **Engineer** | **Perlglas-Sichel** diagonal über dem Kiel, Kristall an der Sichelspitze, Perlglas-Rücken | asymmetrisch; Zahl der Sicheln = Tech (1/2/3, verschieden groß) | jede Waffenform |
| **Kampfspäher (Pfiff)** | kleinster Kiel + hoher dünner **Mast** + **kurze Gabel** (Hybrid §5.3) | Mast ≥ 1,0 × Kiellänge | Reif, Kamm höher als der Mast |
| **Mobiler Schild (Stille, T3)** | **Mast mit waagerechtem Reif** als höchstem Punkt | Reif-Ø ≥ 1,2 × Rumpfbreite | Gabel, Trichter |
| **Kantor** | **Krone aus drei Kristallen** auf einem hohen Spindel-Torso auf **Dreibein**, höchste Landeinheit bis T2 (Höhe ≥ 2,8 WU) | **Gabel mittig vor der Brust** (kein Arm), **Perlglas-Sichel als Halbkreis hinter der Krone** | Arme, Waffenarm + Bauarm (FA-ACU-Schema), Kopf |
| **Abfangjäger** | **schmales Pfeilblatt** (zwei Kämme zu einem spitzen V) | lang > breit | Fächer, Gondeln |
| **Bomber** | **breiter Fächer** (Muschel von oben) + Bauch-Linse | breit ≥ lang | Pfeilung, Gabel |
| **Gunship** | **keine Flügel**, **zwei senkrechte Reifen** seitlich + Gabel unten | – | Flügel, Fächer |
| **Jagdbomber** | Pfeilblatt mit **zwei Linsen-Gondeln an den Spitzen** | Spannweite +30 % gegenüber Abfangjäger | Reifen |
| **Luft-Späher** | kleinster Flieger, ein einzelner senkrechter Kamm | – | Waffen-Parts |
| **Stimmstock (Mex)** | **Reif** um den Spot + ein zentraler Kristall | niedrig, T3 mit doppeltem Reif | – |
| **Resonator (Pgen)** | Dreipass-Sockel mit **1–3 stehenden Kristallen** (Zahl = Tech) | Kristallhöhe ≥ 1,5 × Sockel-Ø | Pfeifen |
| **Äolsharfe (Hydro)** | Reif mit **drei gebogenen Kämmen** (Harfenbogen) um einen Kristall | – | senkrechte Pfeifen |
| **Speicher** | Mass **eckig**: flaches Sechseckprisma; Energy **rund**: zwei gestapelte flache Linsen | flach | Kristall-Spitzen |
| **Halle (Fabrik)** | **Apsis**: halb offene Muschel, offene Seite = Ausgang; Grundhalle mit Kamm-Rampe, Himmelshalle mit Landereif | Kristall über dem Scheitel = Resonanzkern | – |
| **Gabel-Stellung (PD)** | **dieselbe Gabel** wie der Gleiter auf dem Sockel; T2 mit Linse zwischen den Zinken (Strahl) | – | – |
| **Pfeifenwerk / Hochorgel (AA/SAM)** | Pfeifen auf teamfarbener Kamm-Platte; SAM mit **senkrechten Spindeln** statt Pfeifen, doppelt so viele | – | Kristall |
| **Statische Artillerie** | großer Trichter auf Dreibein-Lafette; Großhorn mit überlangem Trichter | Kamm als Gegengewicht | Gabel |
| **Radar (Widerhall)** | **35° gekippte Muschel-Schale** auf Mast | hoch und dünn | Reif |
| **Schild (Dämpfer)** | Mast mit **waagerechtem Reif** | Reif-Ø ≥ 0,8 × Footprint-Kante | Muschel |
| **Grat (Mauer)** | niedrige Kette flacher Kämme, nur die Firstkante teamfarben | – | – |

### 5.3 Hybrid-Regel (Aurith-spezifisch)

Hybrid-Einheiten sind die Signatur der Fraktion (§9). Damit sie lesbar bleiben:
- Eine Hybrid-Einheit trägt die Monopol-Merkmale **beider** Rollen, jedes mit seiner festen Bedeutung.
- Das Merkmal der **Primärrolle** ist mindestens 1,5× so groß (Länge bzw. Ø) wie das der Sekundärrolle.
- Das **Icon** zeigt immer die gefährlichere Rolle (Regel „Gefahr vor Funktion“, §6.2).
- Hybride im MVP: **Pfiff** (Mast + kurze Gabel, Primär Direktfeuer), **Grollen** (Gabel + kleiner Trichter, Primär Direktfeuer), **Zimbel** (Pfeifen + kurze Gabel, Primär Flugabwehr), **Diskant** (lange Gabel, zwei Feuermodi, eine Form).

### 5.4 Abnahme

Wie Varkan (`faction.md` §5.3): Silhouettenblatt bei 32/48 px mit ≥ 90 % Trefferquote, Graustufen-Aufsicht bei 60 WU, Teamfarben-Anteil automatisch, Kitbash-Budget, Monopol-Lint. **Pflicht-Paartest MS9 (Vorschlag):** Pfiff↔Chorist, Pfiff↔Triller, Triller↔Pfeife, Horn↔Posaune, Posaune↔Pfeife, Heuler↔Brüller, Brüller↔Kantor, Gabel I↔Pfeifenwerk I, Stimmstock↔Resonator, Resonator↔Lichtkammer, Bernsteinkammer↔Lichtkammer. **Fraktionsübergreifend (neu):** Triller↔Punze, Horn↔Kelle, Pfeife↔Sieb sowie Triller↔T1-Panzer von f2 und f3, Horn↔T1-Artillerie von f3 müssen im Schattenriss **dieselbe Rolle** ergeben (Winkel-Code) und im Graustufenbild **verschiedene Fraktionen** (Höhe, Kurve gegen Kante). Maschinenlesbar später in `roster.json` → `silhouettePairs`.

---

## 6. Strategic-Icon-Sprache (MSDF)

### 6.1 Gemeinsame Grammatik

Die Icon-Grammatik ist **fraktionsübergreifend identisch** und in Varkan `faction.md` §6 festgelegt: Grundform = Domäne (Land Quadrat mit Fase, Luft Dreieck, Engineer Kreis, Gebäude Sechseck, Kommandant Tropfen, Mauer Mini-Quadrat), Glyphe = Rolle (19 Tokens), 1–3 Tech-Kerben oben rechts außerhalb, Farbe = Team. Raster, Mindeststrichstärke, Größenfaktoren, Radar-Blips, Ghosts und Zustände gelten unverändert. **Die Aurith fügen keine Grundform und keine Glyphe hinzu**, sie benutzen denselben MSDF-Atlas. Ein Spieler liest die Icons eines Aurith-Gegners genauso wie die eines Varkan-Gegners.

- Der Kommandanten-Tropfen `cmd_commander` gilt auch für den Kantor, obwohl der Tropfen bei Varkan aus dem Lot abgeleitet ist. Die Grundform bedeutet „Kommandant“, nicht „Lot“.
- Die Zahl der Tech-Kerben entspricht den Tonpunkten am Modell (§3.4).

### 6.2 Zuordnung der Aurith-Einheiten

| Einheit | Icon-ID | Anmerkung |
|---|---|---|
| Kantor | `cmd_commander` | 1,6×, ohne Kerben |
| Chorist / Solist / Vorsänger | `eng_build_t1..t3` | – |
| Pfiff (Kampfspäher) | `land_bot_t1` | **Gefahr vor Funktion:** Der Pfiff hat die DPS/Mass eines Raiders. Ein Intel-Ring würde Gegner in die Irre führen. Seine Radarfunktion zeigt die Info-Leiste (C9). |
| Triller / Heuler | `land_direct_t1` / `land_direct_t2` | – |
| Brüller | `land_bot_t2` | Glyphe `bot` = Direktfeuer-Läufer |
| Grollen | `land_direct_t3` | Hybrid, Primär Direktfeuer |
| Horn / Heerhorn | `land_arty_t1` / `land_arty_t3` | – |
| Posaune | `land_mml_t2` | – |
| Pfeife / Bordun | `land_aa_t1` / `land_aa_t2` | – |
| Zimbel | `land_aa_t3` | Hybrid, Primär Flugabwehr |
| Diskant | `land_sniper_t3` | beide Feuermodi, ein Icon |
| Stille | `land_shield_t3` | Schild-Glyphe mit drei Kerben |
| Grille, Zikade, Maikäfer, Schwebfliege, Schwärmer | `air_intel_t1`, `air_aa_t1`, `air_bomb_t1`, `air_direct_t2`, `air_fbomb_t2` | – |
| Gebäude | wie Varkan §6.6 (`struct_mass_t1` …) | Gabel-Stellung = `struct_direct_t*`, Pfeifenwerk = `struct_aa_t*`, Hochorgel = `struct_sam_t3` |

---

## 7. Namenssystem

### 7.1 Regeln

1. **Mobile Einheiten tragen einen Rufnamen** aus dem Wortfeld ihrer Rolle. Wie bei Varkan sind es echte DE/EN-Wortpaare, je ein Wort, möglichst ≤ 9 Zeichen. Das Oberthema ist **Musik und Klang**: Die Aurith benennen alles nach dem, wie es klingt.
2. **Jede Tech-Stufe einer Rolle bekommt einen neuen Namen aus demselben Wortfeld**, kein „Mk II“.
3. **Gebäude heißen nach ihrer Funktion und tragen eine römische Stufe** (Resonator II).
4. **Anzeige:** Rufname und darunter die übersetzte Funktionsrolle, z. B. **Triller** · *Kampfgleiter* / **Trill** · *Battle Glider*. Funktionsrollen sind dieselben wie bei Varkan, außer wo die Bauform sie ändert (Gleiter statt Panzer).
5. **Verboten:** FA-Einheitennamen, FA-Fraktionsbegriffe, FA-Waffennamen, Eigennamen aus FA-Lore, das Klangmuster der Vorbild-Namen (§2.4) und Namen, die einem bekannten Produkt gleichen. **Grep erledigt** gegen alle Einheitennamen, Beschreibungen und Waffennamen aus spooky-db 3810: Treffer bei *Thunder* (verworfen, jetzt Grollen/Rumble) und *Dragon Fly* (verworfen, jetzt Schwebfliege/Hoverfly). Alle übrigen Namen sind treffer­frei.
6. **Keine Überschneidung mit Varkan:** Kein Aurith-Name nutzt ein Varkan-Wortfeld (Schmiedewerkzeug, Gießgerät, Siebe, Schornsteinvögel, Gildenränge).

### 7.2 Wortfelder

| Rolle | Wortfeld | Namen |
|---|---|---|
| Kantor | Chorämter | Kantor / Cantor |
| Engineers | Chorränge | Chorist → Solist → Vorsänger |
| Direktfeuer Land | Rufe und Stimmlaute | Pfiff, Triller, Heuler, Brüller, Grollen, Diskant |
| Artillerie | Blechbläser | Horn, Posaune, Heerhorn, Fanfare, Großhorn |
| Flugabwehr | Orgel | Pfeife, Bordun, Zimbel, Pfeifenwerk, Hochorgel |
| Luft | singende und summende Insekten (Bernstein-Motiv: Insekten im Bernstein) | Grille, Zikade, Maikäfer, Schwebfliege, Schwärmer |
| Intel | Nachklang (akustisch, nicht „Horchen“ wie Varkan) | Widerhall |
| Schild | Stille und Dämpfung | Stille, Dämpfer |
| Wirtschaft | Instrumentenbau und Klangkörper | Stimmstock, Resonator, Äolsharfe, Bernsteinkammer, Lichtkammer |
| Fabriken | Räume | Grundhalle, Himmelshalle |
| Mauer | Landform | Grat |

### 7.3 Unit-IDs und i18n

- **Schema:** identisch zu Varkan, `<ns>:<domäne>_t<n>_<rolle>`. **Namespace `f4`** (lore-neutral, entspricht dem Ordner-Slug): `f4:lnd_t1_tank`. Varkan bleibt bei `core:`; ob alle Fraktionen auf `f1…f4` vereinheitlicht werden, ist offen (§11.2).
- **Rollen-Token:** dieselben wie Varkan. Neu belegt, aber im Schema schon vorgesehen: `lnd_t3_tank` (Grollen) und `lnd_t3_shield` (Stille). **Nicht belegt:** `lnd_t1_bot` und `lnd_t2_shield` (Rollen gehen in Pfiff bzw. Stille auf, §9.2).
- **Waffen:** `f4:wpn_<typ>_t<n>`, z. B. `f4:wpn_fork_t1` (Gabelton), `f4:wpn_horn_t1` (Streuklang), `f4:wpn_spindle_t2` (Stoßton-Rakete), `f4:wpn_beam_t2` (Schwebung, Strahl der Gabel II), `f4:wpn_discharge_t3` (Entladung der Zimbel), `f4:wpn_cantor_outcry` (Aufschrei), `f4:wpn_cantor_shatter` (Zerspringen).
- **i18n-Keys:** `unit.f4.<id>.name`, `.role`, `.desc`. Umlaute nur in DE-Strings, IDs reines ASCII.

### 7.4 Roster (● = MS9-Kern, ○ = bis MS14) — abgeleitet aus `roster.json`

| | ID | DE | EN | Rolle DE / EN | Icon | Hotbuild |
|---|---|---|---|---|---|---|
| ● | `f4:cmd_commander` | Kantor | Cantor | Kommandant / Commander | `cmd_commander` | – |
| ● | `f4:lnd_t1_engineer` | Chorist | Chorister | Ingenieur / Engineer | `eng_build_t1` | Grundhalle: E |
| ● | `f4:lnd_t2_engineer` | Solist | Soloist | Ingenieur / Engineer | `eng_build_t2` | Grundhalle: E |
| ○ | `f4:lnd_t3_engineer` | Vorsänger | Precentor | Ingenieur / Engineer | `eng_build_t3` | Grundhalle: E |
| ● | `f4:lnd_t1_scout` | Pfiff | Whistle | Kampfspäher / Combat Scout | `land_bot_t1` | Grundhalle: A und S |
| ● | `f4:lnd_t1_tank` | Triller | Trill | Kampfgleiter / Battle Glider | `land_direct_t1` | Grundhalle: Q |
| ● | `f4:lnd_t1_arty` | Horn | Horn | Mobile Artillerie / Mobile Artillery | `land_arty_t1` | Grundhalle: W |
| ● | `f4:lnd_t1_aa` | Pfeife | Pipe | Mobile Flugabwehr / Mobile AA | `land_aa_t1` | Grundhalle: R |
| ● | `f4:lnd_t2_tank` | Heuler | Howler | Stoßgleiter / Strike Glider | `land_direct_t2` | Grundhalle: Q |
| ● | `f4:lnd_t2_bot` | Brüller | Roarer | Sturmläufer / Assault Walker | `land_bot_t2` | Grundhalle: S |
| ● | `f4:lnd_t2_mml` | Posaune | Trombone | Raketenwerfer / Missile Launcher | `land_mml_t2` | Grundhalle: W |
| ● | `f4:lnd_t2_aa` | Bordun | Bourdon | Flak / Flak | `land_aa_t2` | Grundhalle: R |
| ○ | `f4:lnd_t3_tank` | Grollen | Rumble | Belagerungsgleiter / Siege Glider | `land_direct_t3` | Grundhalle: Q |
| ○ | `f4:lnd_t3_arty` | Heerhorn | Warhorn | Schwere Artillerie / Heavy Artillery | `land_arty_t3` | Grundhalle: W |
| ○ | `f4:lnd_t3_sniper` | Diskant | Descant | Präzisionsläufer / Sniper Walker | `land_sniper_t3` | Grundhalle: F |
| ○ | `f4:lnd_t3_aa` | Zimbel | Cymbal | Entladungsgleiter / Discharge Glider (AA) | `land_aa_t3` | Grundhalle: R |
| ○ | `f4:lnd_t3_shield` | Stille | Hush | Großschild / Heavy Mobile Shield | `land_shield_t3` | Grundhalle: D |
| ○ | `f4:air_t1_scout` | Grille | Cricket | Aufklärer / Air Scout | `air_intel_t1` | Himmelshalle: A |
| ○ | `f4:air_t1_fighter` | Zikade | Cicada | Abfangjäger / Interceptor | `air_aa_t1` | Himmelshalle: Q |
| ○ | `f4:air_t1_bomber` | Maikäfer | Cockchafer | Bomber / Bomber | `air_bomb_t1` | Himmelshalle: W |
| ○ | `f4:air_t2_gunship` | Schwebfliege | Hoverfly | Kampfschweber / Gunship | `air_direct_t2` | Himmelshalle: E |
| ○ | `f4:air_t2_fbomber` | Schwärmer | Hawkmoth | Jagdbomber / Fighter-Bomber | `air_fbomb_t2` | Himmelshalle: R |
| ● | `f4:str_t1_mex` | Stimmstock I | Soundpost I | Massebohrung / Mass Extractor | `struct_mass_t1` | Bau: Q |
| ● | `f4:str_t2_mex` | Stimmstock II | Soundpost II | Massebohrung / Mass Extractor | `struct_mass_t2` | Bau: Q (Upgrade) |
| ○ | `f4:str_t3_mex` | Stimmstock III | Soundpost III | Massebohrung / Mass Extractor | `struct_mass_t3` | Bau: Q (Upgrade) |
| ● | `f4:str_t1_pgen` | Resonator I | Resonator I | Kraftwerk / Power Generator | `struct_energy_t1` | Bau: W |
| ● | `f4:str_t2_pgen` | Resonator II | Resonator II | Kraftwerk / Power Generator | `struct_energy_t2` | Bau: W |
| ○ | `f4:str_t3_pgen` | Resonator III | Resonator III | Kraftwerk / Power Generator | `struct_energy_t3` | Bau: W |
| ● | `f4:str_t1_hydro` | Äolsharfe | Aeolian Harp | Dampfkraftwerk / Geothermal Plant | `struct_hydro_t1` | Bau: E |
| ● | `f4:str_t1_mstore` | Bernsteinkammer | Amber Vault | Massespeicher / Mass Storage | `struct_mstore_t1` | Bau: R |
| ● | `f4:str_t1_estore` | Lichtkammer | Light Vault | Energiespeicher / Energy Storage | `struct_estore_t1` | Bau: T |
| ● | `f4:str_t1_fac_land` | Grundhalle I | Ground Hall I | Landfabrik / Land Factory | `struct_fac_land_t1` | Bau: A |
| ● | `f4:str_t2_fac_land` | Grundhalle II | Ground Hall II | Landfabrik / Land Factory | `struct_fac_land_t2` | Upgrade |
| ○ | `f4:str_t3_fac_land` | Grundhalle III | Ground Hall III | Landfabrik / Land Factory | `struct_fac_land_t3` | Upgrade |
| ○ | `f4:str_t1_fac_air` | Himmelshalle I | Sky Hall I | Luftfabrik / Air Factory | `struct_fac_air_t1` | Bau: S |
| ○ | `f4:str_t2_fac_air` | Himmelshalle II | Sky Hall II | Luftfabrik / Air Factory | `struct_fac_air_t2` | Upgrade |
| ● | `f4:str_t1_pd` | Gabel I | Fork I | Punktverteidigung / Point Defense | `struct_direct_t1` | Bau: Z |
| ● | `f4:str_t2_pd` | Gabel II | Fork II | Strahlverteidigung / Beam Defense | `struct_direct_t2` | Bau: Z |
| ● | `f4:str_t1_aa` | Pfeifenwerk I | Pipework I | Flugabwehrturm / AA Tower | `struct_aa_t1` | Bau: X |
| ● | `f4:str_t2_aa` | Pfeifenwerk II | Pipework II | Flakturm / Flak Tower | `struct_aa_t2` | Bau: X |
| ● | `f4:str_t3_sam` | Hochorgel | Grand Organ | Raketenabwehr / SAM Site | `struct_sam_t3` | Bau: X |
| ● | `f4:str_t1_wall` | Grat | Ridge | Mauer / Wall | `wall` | Bau: C |
| ○ | `f4:str_t1_radar` | Widerhall I | Reverb I | Radar / Radar | `struct_intel_t1` | Bau: D |
| ○ | `f4:str_t2_radar` | Widerhall II | Reverb II | Radar / Radar | `struct_intel_t2` | Upgrade |
| ○ | `f4:str_t3_radar` | Widerhall III | Reverb III | Radar / Radar | `struct_intel_t3` | Upgrade |
| ○ | `f4:str_t2_shield` | Dämpfer II | Damper II | Schildgenerator / Shield Generator | `struct_shield_t2` | Bau: F |
| ○ | `f4:str_t3_shield` | Dämpfer III | Damper III | Schildgenerator / Shield Generator | `struct_shield_t3` | Upgrade |
| ○ | `f4:str_t2_arty` | Fanfare | Fanfare | Artilleriestellung / Artillery Emplacement | `struct_arty_t2` | Bau: V |
| ○ | `f4:str_t3_arty` | Großhorn | Great Horn | Schwere Artilleriestellung / Heavy Artillery Emplacement | `struct_arty_t3` | Bau: V |

**Zählung:** 22 mobile + 27 Struktur-Blueprints = **49** (Band 45–55). **26 im MS9-Kern** (Band 25–30): 11 mobile (Kantor, Chorist, Solist, Pfiff, Triller, Horn, Pfeife, Heuler, Brüller, Posaune, Bordun) und dieselben 15 Strukturen wie Varkan. Der Brüller ist Kern statt Nachzügler, weil „wenige, große Einheiten“ ab T2 die Fraktion trägt; dafür entfällt der separate T1-Bot.
**Hotbuild:** dieselbe Rollen-Belegung wie Varkan (`roster.md` §3). Der Pfiff liegt auf A **und** S, weil er beide T1-Rollen abdeckt. D (Support) belegt erst ab T3 die Stille.
**Reserve-Namen:** *Unterkantor / Succentor* (SACU, U15), *Kadenz / Cadence* (T3-Luft, U12). *Hymne / Hymn* ist als T4-Sturmläufer eingelöst; alle Experimentals (Hymne, Ensemble, Heupferd, Tuba, Klangschale) stehen in [`experimentals.md`](experimentals.md) und `roster.json` → `experimentals` (Post-MVP).

---

## 8. Audio-Charakter „Glas und Tiefenchor“

**Leitbild:** eine Kathedrale aus Glas unter der Erde, ohne Kirche. Weit, hell und hallig oben, mit tiefem Chor-Bordun darunter. Materialgeräusche: angestrichenes Glas, Klangschale, Orgelpfeife, Blechbläser, Insektenzirpen. Kein Metall, keine Explosionen im Varkan-Sinn, dafür Druck, Brechen und Nachklingen. Das ist der klangliche Gegenpol zu Varkans „Gießhalle und Funk“ (tief, trocken, metallisch).

### 8.1 Stimmen

- **Kantor:** keine menschliche Stimme. Ein **dreistimmiger Akkord**, der Silben formt, dazu die lokalisierte Übertragung als Untertitel im Einheiten-Feedback. Der Akkord ist über alle Zeilen gleich (Grundton des Chors), nur Rhythmus und Silben wechseln.
- **Alle anderen Einheiten:** **gesungene Quittung** statt Werkstimme. Die Varkan-Pips-Grammatik gilt fraktionsübergreifend: **Zahl der Töne = Tech-Stufe, Tonlage = Rollenfamilie** (Direkt mittel, Artillerie tief, AA hoch, Engineers aufsteigender Zweiklang, Luft gleitend). Bei den Aurith sind es gesungene Töne statt Pips, gefolgt vom Rufnamen als gesungenes Wort. Höchstens 0,8 s.
- **Alerts (P8):** die **Chorstimme**, eine ruhige, leicht hallende Sprechstimme, die klar und ohne Flavor-Wörter spricht. Alerts müssen in allen Fraktionen gleich schnell verständlich sein. Vor jeder Ansage ein eigener Zweiklang (Quinte aufwärts), jeder Alert-Typ mit eigenem Wiederholintervall.

| Anlass | DE | EN |
|---|---|---|
| Kantor Auswahl | *Akkord* „Ich klinge.“ | *chord* „I sound.“ |
| Kantor Bewegung | „Ich wandere.“ | „Moving on.“ |
| Kantor Angriff | „Das verstummt.“ | „That will fall silent.“ |
| Engineer Bau | „Singe Form.“ | „Singing form.“ |
| Engineer fertig | „Es klingt.“ | „It rings true.“ |
| Triller Auswahl | *ein Ton* „Triller.“ | *one note* „Trill.“ |
| Horn Angriff | *ein Ton (tief)* „Horn holt Luft.“ | *one note (low)* „Horn draws breath.“ |
| Luft Auswahl | *gleitender Ton* „Zikade zirpt.“ | *glide* „Cicada singing.“ |
| Alerts | „Kantor unter Feuer.“ · „Masse knapp.“ · „Energie knapp.“ · „Halle eingestimmt.“ | „Cantor under fire.“ · „Mass low.“ · „Energy low.“ · „Hall attuned.“ |

### 8.2 SFX-Palette

| Kategorie | Klang |
|---|---|
| **Signatur** | **angestrichenes Glas** (Glasrand mit Bogen), sparsam: „Bau fertig“ kurz und hoch, Einstimmen mittel, Zerspringen als voller Akkord, der bricht. Eigene Kategorie im Voice-Manager, Cooldown ≥ 1 s. |
| **Flow-Grundton** | leiser Chor-Bordun unter Hallen, Engineers und Resonatoren. **Beim Energy-Stall verstimmt er sich hörbar (Schwebung)** und stottert. Gleiche Funktion wie Varkans Summton. |
| **Direktfeuer** | „Gabelton“: Anschlag einer Stimmgabel mit kurzem Phasen-Zisch. Höhere Tech klingt tiefer und länger, nicht lauter. |
| **Heuler (schwerer Einzelschuss)** | aufsteigendes Heulen während der Aufladung (1,5 s), dann ein tiefer Schlag. Das Heulen ist die hörbare Vorwarnung zur sichtbaren Glyphen-Sammlung (§3.5). |
| **Artillerie** | Abschuss als tiefer Hornstoß, im Flug ein fallender Ton, Einschlag als Glasbruch mit Hall |
| **Raketen (Posaune, Hochorgel)** | Glissando aufwärts, Einschlag als Posaunenstoß mit Verzerrung |
| **Strahl (Gabel II)** | stehender Sinuston mit Schwebung, der beim Treffer tiefer wird |
| **Flugabwehr** | schnelles, hohes Orgel-Staccato |
| **Antriebe** | Gleiter summen tonal (Tonhöhe ~ Tempo), Läufer setzen mit Glas-Klirren und tiefem Tritt auf, Flieger zirpen und brummen je nach Insekt |
| **Bau / Reclaim** | Klangfaden als steigender Ton, am Ende Erstarren (Knistern von Eis) und der kurze Glasklang. Reclaim ist dasselbe rückwärts: Splittern und fallender Ton. |
| **Befehle (UI)** | Auswahl: kurzer Glas-Tick. Bewegung: fallende kleine Terz. Angriff: trockener Holzbläser-Stoß. Bauauftrag: Klangschale. |
| **Treffer / Tod** | Treffer: dumpfes Glas-Klonk. Tod: Glasbruch mit Nachklingen. Strukturtod: großes Zerspringen, danach Rieseln. |
| **Zerspringen (Kantor)** | Akkord steigt, bricht in hohe Splitter, Druckwelle, danach 2 s Stille-Ducking mit einem einzelnen nachklingenden Ton |
| **Eco-Gebäude** | langsames Pulsieren des Bordun (Resonator) und tiefe, gezupfte Saite (Stimmstock), leise, nur auf Z0 als Loop |

### 8.3 Mix-Regeln für den Voice-Manager (32 Stimmen)

Identisch zu Varkan (`faction.md` §8.3): Frequenzbänder pro Kategorie (Artillerie, Tod und Zerspringen tief, Direktfeuer mittel, AA, gesungene Quittungen und UI hoch), **ein Bau-Loop pro Armee**, Signatur und Alerts vor Waffen, Eco-Loops zuletzt. **Zusatz:** Weil Glas lange nachklingt, werden Hallfahnen von Waffen auf 0,6 s gekappt, sobald mehr als 16 Stimmen aktiv sind, damit Gefechte nicht verschwimmen.

---

## 9. Spielidentität & Asymmetrien

### 9.1 Leitidee

**Wenige, große, vielseitige Einheiten.** Ein Aurith-Spieler hat weniger Einheiten auf dem Feld, jede kostet mehr und hält mehr aus, mehrere Einheiten decken zwei Rollen ab. Er gewinnt über Timing (schwere Einzelschüsse, sichtbar geladen), Konzentration und Qualität statt über Masse. Varkan ist der symmetrische Allrounder, die Aurith sind der Gegenentwurf: gleiche Kurven für DPS/Mass und HP/Mass (Balancing-Gate), aber anders verteilt auf weniger, schwerere Körper.

**Balancing-Grundsatz:** Jede Einheit wird gegen **die Einheit der Vorbild-Fraktion in derselben Rolle** gemessen (±25 % je Achse, Produkt ±15 %, Treffer-bis-Tod exakt). Damit übernimmt das Roster automatisch die Vorbild-Relationen (teure Artillerie, schwerer T2-Läufer, starke Schilde) und bleibt trotzdem im selben Gesamt-Kurvenband, weil die FA-Fraktionen untereinander balanciert sind. Wo die Vorbild-Fraktion keine Einheit hat, wird wie bei Varkan eine andere FA-Fraktion als Referenz genommen und im Roster vermerkt.

### 9.2 Asymmetrien im MVP (nur MVP-Mechanik)

Relationen „Vorbild ÷ Varkan-Referenz“ aus spooky-db 3810 (`tools/roster/f4/fa_ref.json` gegen `tools/roster/fa_ref.json`). BP-IDs sind dev-only.

| # | Asymmetrie | Einheit(en) | Relation zur Varkan-Referenz | Benötigte Features |
|---|---|---|---|---|
| A1 | **Kampfspäher statt Späher + LAB:** ein billiger, bewaffneter Späher mit Radar 40 übernimmt Aufklärung und Raiden. Kein separater T1-Bot. | Pfiff (`XSL0101`) | Mass 20 statt 12 (Späher) bzw. 32 (LAB), DPS/Mass 4× Späher, −9 % zum LAB, HP 36 | U4 (deckt Scout + LAB), I3 |
| A2 | **T1-Artillerie „Streuklang“:** weniger Schaden pro Treffer, größerer Splash, teurer und fragiler. Stark gegen Pulks und Engineers, schwach gegen Gleiter. | Horn (`XSL0103`) | Schaden 44 statt 100, Splash 1,6 statt 1,1, Mass 54 statt 36, HP/Mass −43 %, RW 30 (Mindest-RW 8) | K2, K4 |
| A3 | **T2 zweigeteilt:** schneller Stoßgleiter mit einem schweren Schuss (Alpha-Schaden) und ein schwerer Sturmläufer als Linienanker. | Heuler (`XSL0203`), Brüller (`XSL0202`) | Heuler: 210 Schaden pro Schuss (Varkan-Meißel 2×35), Tempo 4,0 statt 2,9. Brüller: Mass 360, HP 2.550, DPS 123, RW 26 | U6, K9 |
| A4 | **Raketenwerfer mit einem schweren Geschoss:** eine Lenkrakete statt 2er-Salve, größere Reichweite. | Posaune (`XSL0111`) | 400 Schaden alle 6 s, RW 64 statt 60, DPS/Mass +11 % | K11 |
| A5 | **Kein mobiler T2-Schild, dafür ein großer T3-Schild.** Die Schild-Support-Rolle aus U6 kommt eine Stufe später, dann mit 10.000 Schild-HP. Varkans Schürze ist ebenfalls erst MS13 (○), der Meilenstein verschiebt sich also nicht. | Stille (`XSL0307`) | Mass 720, Schild 9.600, HP+Schild/Mass −9 % zur Varkan-Schürze | K10, U6/U10 |
| A6 | **T3-Hybride:** Belagerungsgleiter mit Direkt- **und** Indirektwaffe; Präzisionsläufer mit zwei Feuermodi (schnell/RW 55 oder schwer/RW 65); Flugabwehr-Gleiter, der auch Bodenziele trifft. | Grollen (`XSL0303`), Diskant (`XSL0305`), Zimbel (`DSLK004`) | Grollen DPS/Mass +64 % zum Varkan-Fallhammer bei −11 % HP/Mass (ohne Torpedo, beide Direktwaffen der Referenz, `roster.md` §20 R1/R5), Diskant DPS/Mass −3 % bei +19 % HP/Mass (schneller Modus; schwerer Modus 1.900 Schaden, RW 65), Zimbel trifft Luft (233 DPS) und Boden (52,5 DPS) | U10, K3, K9, C17 (Modus-Toggle) |
| A7 | **Strahl-Punktverteidigung T2:** Dauerstrahl mit großer Reichweite statt Kanone. | Gabel II (`XSB2301`) | RW 50, DPS/Mass +16 % | B5, K1 (Strahl als Hitscan-Waffe mit Pulsen, siehe §11.2 Nr. 5) |
| A8 | **Stärkere, teurere Schildgeneratoren.** | Dämpfer II/III (`XSB4202`, `XSB4301`) | HP+Schild/Mass +20 % / +7 %, Mass 700 statt 600 | K10 |
| A9 | **Fragile Engineers:** Chöre bauen mit derselben Build Power, verlieren Engineers aber schneller an Raider. | Chorist/Solist/Vorsänger (`XSL0105/0208/0309`) | HP/Mass −20 % / −14 % / −17 % | U2 |
| A10 | **Luft schwer statt schnell:** Bomber mit großem Splash und weniger DPS, teurer und zäher Gunship, Jagdbomber mit schwerer Einzelbombe. | Maikäfer (`XSA0103`), Schwebfliege (`XSA0203`), Schwärmer (`XSA0202`) | Maikäfer Splash 4, DPS/Mass −29 %; Schwebfliege Mass 500 statt 200, HP 1.850, 120 DPS (Produkt −12 % zur Krähe); Schwärmer Bombe 1.200, Luftwaffe 144 DPS | U11 |
| A11 | **Kantor:** 11.500 HP (−4 % zum Vogt), Hauptwaffe, Aufschrei-Formel und Tod wie die FA-Relation. Die Asymmetrie des Kommandanten liegt in seinen Upgrades (Post-MVP, §9.4). | Kantor (`XSL0001`) | Hauptwaffe 100/1 s, RW 22 identisch | U1, U8 |

**Treffer-Breakpoints, die sich gegenüber Varkan bewusst ändern** (werden im Roster exakt gegen die Vorbild-Fraktion geprüft): Kantor → Pfiff 1 Treffer, Kantor → Triller 3, Kantor → Chorist 2, Horn → Chorist 3 (Varkan: Kelle → Lehrling 2), Horn → Triller 7 (Varkan: Kelle → Punze 3), Heuler → Triller 2 (Varkan: Meißel → Punze 5 Salven). Die Aurith-Artillerie bricht also keine Linie, sondern räumt Engineers und Pulks; der Heuler dagegen tötet T1-Gleiter in zwei Schüssen.

### 9.3 Spielgefühl im Match (Zielbild für die KI und das Balancing)

- **Opening:** Pfiffe statt Scout + LAB. Sie klären auf (Radar 40) und stören Engineers, sind aber die schwächeren Raider (Produkt −23 % zum Varkan-Stichel; Pfiff → Lehrling 11,7 s). Ohne Tarnung (I5, Post-MVP) fehlt ihnen die Vorbild-Kompensation. Umgekehrt sind Aurith-Engineers raid-anfällig (Stichel → Chorist 5,4 s). Die Antwort ist der Triller: Er tötet einen Stichel in 2 Schüssen (1,3 s). Aurith eröffnen deshalb mit Trillern als Eskorte, nicht mit Raids (`roster.md` §20 R3).
- **T1-Mitte:** Triller halten die Linie etwas über Varkan-Niveau (−1 % HP/Mass, +13 % DPS/Mass), Hörner schützen gegen Pulks, sind aber leichte Beute für Raider.
- **T2:** Der Übergang ist der stärkste Moment der Fraktion. Wenige Brüller tragen die Front, Heuler flankieren und töten schnell, Posaunen knacken Stellungen aus RW 65.
- **T3:** Hybride sparen Einheiten-Slots (U7 Unit-Cap): Grollen ersetzt T3-Bot plus Begleit-Artillerie und ist der stärkste T3-Körper pro Mass (langsam, RW 22/28, Konter: Heerhorn und Diskant auf Abstand, Bomber), Zimbel schützt vor Luft und hilft am Boden, Stille deckt mit einem Blueprint einen ganzen Pulk.
- **Schwäche:** Masse. Viele billige Einheiten überfordern die wenigen Aurith-Schüsse (lange Nachladezeiten, Overkill). Engineers und Hörner sind fragil, das Opening ist raid-anfällig, Luft ist teuer (Gunship 500 Mass).

### 9.4 Asymmetrien, die Post-MVP-Mechanik brauchen (markiert)

Alle Einträge sind **rein additiv**. Die Kernwerte in `roster.json` werden ohne sie gemessen und balanciert. Fehlt das Feature, bleibt die Einheit spielbar wie beschrieben.

| Feature-ID | Asymmetrie (Vorbild-Verhalten) | Einheit | MVP-Verhalten ohne Feature |
|---|---|---|---|
| **I5** Stealth, Cloak & Jamming | Tarnung im Stand: unsichtbar für Radar und Sicht, solange sie steht (Energy-Unterhalt 1/s) | Pfiff | kein Tarnen; Unterhalt entfällt |
| **I5** | Tarnfeld-Generator (T2-Gebäude, Vorbild `XSB4203`) | – (Reserve, nicht im Roster) | entfällt |
| **M13** Wasser-Bewegungslayer (Hover) | Echtes Schweben über Wasser | Heuler, Stille | normale `LAND`-Einheit; der Gleiter-Look bleibt reine Optik |
| **M13** (Amphibisch) | Grollen und alle Engineers fahren unter Wasser | Grollen, Chorist, Solist, Vorsänger | nur Land (wie Varkan-Engineers) |
| **U18** U-Boote & Torpedos | Torpedowerfer als Drittwaffe | Grollen | entfällt, DPS/Mass ohne Torpedo gemessen |
| **U14** ACU-Enhancements | Regenerations-Aura für Einheiten in der Nähe, Schadensstabilisierung, Feuerrate, Teleport, Raketen-Kopf | Kantor | Grundregeneration wie Vogt (10 HP/s) |
| **K16** TML & TMD | Taktische Rakete als Kantor-Upgrade | Kantor | entfällt |
| **U15** SACU | Unterkantor | – | entfällt |
| **P19** ACU-Warp-in-Sequenz | Aufklang: Bernsteinsäule steigt auf und zerspringt | Kantor | 3-s-View-Platzhalter (§2.2) |
| **K10 über MVP hinaus** | keiner: Die Aurith nutzen nur Bubble-Schilde (Stille, Dämpfer) und keine Personal Shields | – | – |
| **U16/U21, E17, K17** Experimentals | Hymne (Sturmläufer), Ensemble (wandernde Halle), Heupferd (Bomber), Tuba (Strategiewerfer), Klangschale (Resonanzgenerator); Details [`experimentals.md`](experimentals.md) | – (T4) | nicht baubar |
| **U12** T3-Luft | Reserve *Kadenz* | – | – |

---

## 10. Variantenbewertung

### 10.1 Die drei Varianten

- **V1 „Aurith“ (Chor der Tiefe):** Ureinwohner Kessas, Klangmuster in der Metallschmelze, die sich in Bernsteinglas verkörpern. Musik als durchgehendes Thema: Stimmgabel = Direktfeuer, Trichter = Artillerie, Orgelpfeifen = Flugabwehr, Sichel = Bauen. Kommandant = Kantor, Spieler = Chöre nach Intervallen.
- **V2 „Veyl“ (Phasenzwilling):** Wesen aus einem phasenversetzten Zwilling Kessas, die an dünnen Stellen der Kruste herüberbluten. Thema Licht und Optik: Linsen, Prismen, Spektren. Einheiten nach Lichterscheinungen benannt (Schimmer, Irrlicht, Brennpunkt), Kommandant = „Brennpunkt“.
- **V3 „Sethra-Saat“ (Bernsteingärten):** eine uralte, nicht-menschliche Saat-Intelligenz, die in Kessas Kruste vergraben lag und von den Zapfstellen geweckt wurde. Thema Wachstum: Einheiten wachsen wie Korallen und Kristalldrusen, Namen aus Botanik und Geologie (Dorn, Druse, Spore). Kommandant = „Keim“.

### 10.2 Bewertung

Skala 1–5 (5 = am besten).

| Kriterium | V1 „Aurith“ | V2 „Veyl“ | V3 „Sethra“ |
|---|---|---|---|
| **Lesbarkeit** | **5**: Instrumente liefern Formen, die den Winkel-Code von selbst erfüllen (waagerechte Gabel, schräger Trichter, senkrechte Pfeifen). Jede Rolle hat ein eindeutiges, kitbash-taugliches Merkmal. | **3**: Linsen und Prismen sehen von oben ähnlich aus. Rollen müssten über Farbe und Leuchten unterschieden werden, was der Teamfarben-Regel widerspricht. | **3**: Gewachsene Formen sind organisch-unruhig, Silhouetten verschwimmen bei 32 px. Drusen und Dornen tragen keine Rollen-Richtung. |
| **Eigenständigkeit ggü. FA** | **5**: Ureinwohner statt Invasoren aus einer anderen Dimension, Musik statt Religion, echte DE/EN-Wortpaare statt fremdsprachiger Kunstwörter. | **2**: Die Phasenwelt, die in die reale Welt blutet, liegt nah an der Vorbild-Lore. Licht und Strahlen überschneiden sich mit der Designsprache der hell-eleganten FA-Fraktion (Vorbild von f3). | **4**: eigene Idee. Das Motiv „alte Intelligenz, die von Menschen geweckt wird“ ist in Spielen aber verbreitet. |
| **Umsetzbarkeit als Kitbash** | **4**: 13 Parts, davon 10 neue Primitive, alle Drehkörper oder Extrusionen. Braucht `legs count:3`. | **4**: Linsen und Prismen sind einfache Primitive, dafür werden Transluzenz und Brechung erwartet, die das Platzhalter-Budget sprengen. | **2**: Verzweigtes Wachstum braucht viele kleine Parts oder eigene Meshes, beides verletzt ≤ 7 Parts und das Filigran-Verbot. |
| **Stimmung / Coolness** | **5**: starkes Audio (Glas, Orgel, Chor), Bernstein mit Insekten als Luftwaffe, Kantor und Chöre, sichtbar geladene Schüsse | **4**: elegant und fremd, aber kühl. Die Audio-Identität (Licht) ist schwer hörbar zu machen. | **4**: unheimlich und fremd, gute Bilder. Kippt aber leicht ins Biologisch-Schwarmhafte. |
| **Passung zur Vorbild-Spielweise** | **5**: Instrumente erklären ungewöhnliche Waffen (Wellen, Strahlen, Entladung), Chor erklärt wenige große Stimmen, Mehrklang erklärt Hybride. | **4**: Phasenwaffen passen, Hybride müssen eigens begründet werden. | **2**: Wachstum legt ein anderes Eco-Modell nahe (Creep, Selbstheilung), das außerhalb des MVP liegt; eher Schwarm als „wenige Große“. |
| **Kontrast zu Varkan und f2/f3** | **5**: hoch/rund/amber-blau gegen niedrig/kantig/graphit-orange; akustisch hell-hallig gegen tief-trocken. Grenzt sich von f2 (Schwarm, Tarnung, Rot-Schwarz) und f3 (Perlmutt-Gold-Jade, Schweben, Orden) ab; erster Abgleich im Review (`roster.md` §20 R9/R10, offen §19 Nr. 7). | **3**: kontrastiert Varkan gut, liegt aber nah an f3 (Licht, Eleganz, Schweben). | **3**: kontrastiert Varkan, überschneidet sich aber mit dem Schwarm-Motiv von f2. |
| **Summe** | **29** | **20** | **18** |

### 10.3 Entscheidung

**Gewinner: V1 „Aurith“.** Die Musik-Metapher leistet dreierlei: Sie erzeugt Formen, die die gemeinsamen Lesbarkeitsgesetze von selbst erfüllen, sie begründet die Vorbild-Spielweise (ungewöhnliche Waffen, wenige große Einheiten, Hybride als Mehrklang), und sie verankert die Fraktion eigenständig in Kessa: Die Aurith kämpfen um dieselben Adern wie die Häuser, nur aus einem anderen Grund.

### 10.4 Übernommen aus V2 und V3

- **V2:** blaues Phasenleuchten als Emissive-Farbe, Linse als Primitiv, Strahlwaffe der Gabel II.
- **V3:** Bernstein als Körpermaterial, das Motiv „von den Zapfstellen geweckt“ als Grund für den Kontakt mit Varkan, Insekten im Bernstein als Luftwaffe, Wracks als „stummer Bernstein“.

### 10.5 Verworfen

- **V1:** Italienische Musikbegriffe als Einheitennamen (Staccato, Tremolo): Lehnwörter, die gegen Regel 7.1.1 verstoßen. Harfe mit Saiten als Engineer: Saiten unterschreiten die Mindeststärke.
- **V2:** Brechung und Transluzenz als Pflicht-Shader, Phasenwelt-Lore.
- **V3:** Wachstums-Eco, verzweigte Silhouetten, Namen aus Botanik.

---

## 11. Anhang: Beispiel-Einheiten und offene Punkte

### 11.1 Beispiel-Einheiten (Kurzprofil, vorläufig)

> Werte aus `roster.json` (Stand 2026-09-29). Sie weichen wie bei Varkan um einige Prozent von der FA-Referenz der Vorbild-Fraktion ab und halten alle Breakpoints (`roster.md` §14, §18).

**Triller / Trill (`f4:lnd_t1_tank`)**
- **Silhouette:** schlanker Kiel 0,9 × 0,5 × 1,4 WU, 0,25 WU über dem Boden. Mittig sitzt ein kurzer Drehsockel mit waagerechter Gabel (zwei Zinken je Ø 0,17 WU, Länge 0,9 WU ≈ 65 % der Kiellänge, Abstand 0,3 WU), die über die Kielspitze hinausragt. Hinten ein teamfarbener Kamm, 0,8 WU hoch, mit einem Tonpunkt.
- **Parts (5):** `keel` [amber], `lens` (Schwebespalt) [body], `fork` (Yaw) [body], `fin` (Kamm) [team], `fin` (Glyphenfeld auf der Oberschale) [team]. Teamfarbe ≈ 35 %.
- **Icon:** `land_direct_t1`. **Hotkey:** Q.
- **Sim:** Mass 54, HP 285, Tempo 3,5, `f4:wpn_fork_t1` mit 33 Schaden alle 1,3 s, RW 18 ⇒ ≈ 25,4 DPS. DPS/Mass ≈ 0,470 (FA +3,1 %), HP/Mass ≈ 5,28 (FA +1,8 %).
- **Tech-Familie:** Heuler (T2): Maßstab 1,3, längere Gabelzinken mit Linse dazwischen (Ladekammer), zwei Tonpunkte, ein schwerer Schuss (210 Schaden alle 3,5 s).

**Horn / Horn (`f4:lnd_t1_arty`)**
- **Silhouette:** Kiel mit einem großen, offenen Trichter (Öffnung Ø 0,6 WU), 50° nach vorn oben geneigt, auf einem Schwenkfuß. Der Kamm läuft als Gegengewicht weit nach hinten. Keine Gabel.
- **Parts (5):** `keel` [amber], `lens` [body], `ring` (Schwenkfuß, Yaw) [body], `horn` (Pitch) [team außen], `fin` (Kamm) [team].
- **Icon:** `land_arty_t1`. **Hotkey:** W.
- **Sim:** Mass 54, HP 180, Tempo 2,7, `f4:wpn_horn_t1` „Streuklang“: 44 Schaden, Splash 1,6, alle 2,8 s, ballistisch, RW 8–30 ⇒ ≈ 15,7 DPS (Pulk-DPS/Mass FA +7,8 %). Einschläge hinterlassen ≈ 3 s einen blauen Klangring am Boden (nur View).

**Chorist / Chorister (`f4:lnd_t1_engineer`)**
- **Silhouette:** kurzer, breiter Kiel mit Perlglas-Rücken und einem dunklen Tonpunkt. Eine Perlglas-Sichel spannt sich diagonal vom linken Heck nach vorn rechts, an ihrer Spitze sitzt ein Kristall (Resonanzkern). Teamfarbenes Kiel-Seitenband und kleiner Kamm.
- **Parts (5):** `keel` [pearl], `lens` [body], `fin` (Kamm, Seitenband) [team], `sickle` (Yaw) [pearl], `crystal` (Emitter, Pitch) [glow]. Solist: 2 Sicheln, Vorsänger: 3 Sicheln bei Maßstab 1,4.
- **Icon:** `eng_build_t1`. **Hotkey:** E.
- **Sim:** Mass 52, Build Power 5, HP 128 (HP/Mass −20 % zum Varkan-Lehrling, bewusst, §9.2 A9), keine Waffe.

**Kantor / Cantor (`f4:cmd_commander`)**
- **Silhouette:** Dreibein mit rückwärts geknickten Gelenken, darauf ein hoher Spindel-Torso (Höhe gesamt ≥ 2,8 WU). Oben die Krone aus drei Kristallen (stärkster Leuchtpunkt), dahinter die Perlglas-Sichel als Halbkreis. Eine breite Gabel sitzt mittig vor der Brust. Keine Arme, kein Kopf.
- **Parts (7):** `legs` (count 3), `keel` (Torso, Yaw) [amber], `fin` (Hinterkamm) [team], `crystal` (Krone) [glow], `sickle` (Bau-Halbkreis) [pearl], `fork` (Brust, Pitch) [body], `lens` (Brustschale) [team].
- **Sim:** HP 11.500, Mass 2.000, BP 10, Hauptwaffe 100/1 s RW 22, Aufschrei nach Varkan-Formel (FA-identisch), Zerspringen mit FA-Relation 1:1.

### 11.2 Offene Punkte

1. Markenrecherche „Aurith“, Chor-Namen und alle Rufnamen. Der Grep gegen FA-Einheiten-, Beschreibungs- und Waffennamen (spooky-db 3810) ist erledigt (§7.1); vor dem Einfrieren gegen den aktuellen FAF-Stand wiederholen.
2. ~~`roster.json`/`roster.md` für f4 erzeugen~~ erledigt (2026-09-29): 49 Blueprints, 26 ●, alle Gates grün (`tools/roster/f4/validate.py`). Offene Roster-Punkte in `roster.md` §19.
3. **Namespace-Frage:** `f4:` gegen `core:`. Klären, ob alle Fraktionen einheitlich `f1…f4` oder Lore-Kürzel bekommen, bevor Blueprints entstehen.
4. **Referenzlücken:** Die Vorbild-Fraktion hat weder T2-Mobilschild noch einen reinen T1-LAB. Beides ist durch A1/A5 aufgelöst. Für die T3-Flugabwehr dient `DSLK004` (FAF-Einheit, nicht Original-FA).
5. **Strahlwaffe (Gabel II):** K1 kennt nur Projektile. Vorschlag: Strahl als Folge schneller, sehr schneller Projektile oder als Hitscan-Puls alle 0,1 s mit gleichem DPS. Muss vor MS8 im Waffenmodell entschieden werden, sonst bekommt Gabel II vorübergehend eine Projektilwaffe mit denselben Werten.
6. **Zwei Feuermodi (Diskant):** braucht einen Waffen-Toggle in C17 („Modus“ neben Schild/Stealth/Auto-Overcharge).
7. Schema-Erweiterung (§3.6): neue PartKeys, `legs.count`, Material-Tabelle pro Fraktion.
8. **Draw-Budget:** Vier Fraktionen × ≈ 28 Visuals. Im 1v1 sind höchstens zwei Fraktionen aktiv (≤ 56 Visuals); das übersteigt die 40-Visual-Annahme aus DECISIONS Punkt 17 und muss im Render-Bench geprüft werden.
9. Chorstimme und gesungene Quittungen: Synthese (Vocoder-Chor) oder Aufnahme, Entscheidung zu P7/P8 gemeinsam mit Varkan.
10. **Abgleich mit f2/f3:** erledigt (Review 2026-09-29, `roster.md` §20, und fraktionsübergreifender Abgleich, `../README.md`): Namenskollisionen *Hummel* (f2) und *Muschel* (f3) behoben (jetzt Maikäfer, Widerhall), Formbedeutungen (Trichter/Horn = Artillerie, Sichel = Bauen, senkrecht = Flugabwehr) fraktionsübergreifend gleich, Kreuz-Silhouettenpaare ergänzt, Perlglas auf kühles Eisweiß `#D5DCE2` gesetzt (§4.1), Stimmstock III auf Varkan-Eco (4.500 / 31.000).
11. Kantor-Wrack: Zerspringen ohne Wrack oder mit „Bernsteinstumpf“ als Reclaim, gemeinsam mit Varkan (dessen offener Punkt Nr. 3) entscheiden.
12. **Review 2026-09-29:** 13 Punkte (`roster.md` §20). Wichtigste Korrektur: `ref.py` wertet `WeaponNumber` aus; Grollen, Schwebfliege und Schwärmer hatten eine halbierte Referenz-Waffe. Dieselbe Lücke in den Werkzeugen von Varkan, f2 und f3 ist im fraktionsübergreifenden Abgleich behoben (`../README.md` §5.4).
