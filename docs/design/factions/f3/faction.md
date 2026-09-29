# Fraktion f3: Der Orden von Sael

> **Status:** Designkonzept für die dritte Fraktion (U22 „Fraktionen 3 & 4“, vorgezogen als reine Daten und Dokumente). Grundlage ist Variante C „Sael“, ergänzt um Klang- und Präzisionsideen aus den Varianten A und B (Herleitung in §10).
> **Vorbild:** stilistisch an die elegante, schwebende, schildstarke Fraktion aus Supreme Commander: Forged Alliance angelehnt. Übernommen werden nur Designsprache (glatte Kurven, Schalen, Orbs und Ringe, hell mit Grün und Gold), Gameplay-Identität (Reichweite und Präzision, starke Schilde, wenige teure und starke Einheiten, Schweben) und Rollenverteilung. **Keine** Namen, Begriffe, Lore, Designs oder Assets aus FA (§2.4).
> **Umfang:** dieselben 50 MVP-Blueprints wie das Varkan-Kompakt (`docs/design/faction.md` §7.4), gleiche Rollen-Tokens, gleicher ●/○-Status: MS9 = 26 Blueprints (●), MS14 = 50 (●+○). Waffen- und Projektil-BPs sind nicht mitgezählt.
> **Quelle der Zahlen:** `docs/design/factions/f3/roster.json` (generiert von `tools/roster/f3/gen.py`, geprüft von `tools/roster/f3/validate.py`, lesbar als `roster.md`) ist die einzige Quelle für Werte, ●/○-Status, Kitbash-Parts und Maßstäbe. Die Zahlen in §9 und §11.1 sind Entwurfs-Startwerte; bei Widerspruch gilt `roster.json`. FA-Referenzen der Vorbild-Fraktion liegen in `tools/roster/f3/fa_ref.json` (erzeugt von `tools/roster/f3/fa_extract.py` aus spooky-db 3810, nur Relationen, dev-only).
> **Mechanik:** Die Fraktion nutzt dieselbe Engine-Mechanik wie Varkan. Ihre Asymmetrie steckt in **Zahlenrelationen** (Reichweite, Kosten pro Einheit, Schildwerte, Einzelschuss-Schaden), die der Vorbild-Fraktion folgen, und in Optik, Namen und Klang. Mechaniken, die erst nach dem MVP kommen, sind in §9 mit ihrer Feature-ID markiert. Die Kern-Balance funktioniert ohne sie.
> **Balancing:** Methodik wie Varkan (`docs/design/roster.md` §1): DPS/Mass und HP/Mass je ±25 % zur FA-Relation der **Vorbild-Fraktion** (hartes Gate PLAN U3), Ziel ±15 % inklusive Produkt und Pulk-DPS/Mass, Treffer-bis-Tod-Tabelle exakt nach FA. Neu hinzu kommen **Kreuz-Breakpoints** gegen Varkan (§9.4).
> **Review 2026-09-29:** Balance (T1-Rush, Eco-Kurve, Konter), Lesbarkeit, Eigenständigkeit und Vollständigkeit geprüft; Entscheidungen in `roster.md` §21. Geändert: fünf Rufnamen (Knallkrebs, Languste, Konus, Seelilie/Hochlilie, EN Fountain), Streuungsfeld `firingRandomness`, Rush-Gate `checks.rush`, Engineer-Regel §5.2, Matchup-Bild §9.5.

---

## 1. Name

| | DE | EN |
|---|---|---|
| Fraktion (UI-Kurzname) | **Sael** | **Sael** |
| Vollname (Lore) | der Orden von Sael | the Order of Sael |
| Adjektiv | saelisch | Sael (attributiv) |
| Welt | Kessa (Einsatzort), Mond Sael (Heimat) | Kessa, moon Sael |
| Spieleridentität | Kapitel (Teamfarbe = Emaillefarbe des Kapitels) | Chapter |

- **Aussprache:** „SA-el“, zwei Silben, Betonung auf der ersten, in DE und EN gleich. Kein reales Wort. Im Deutschen klingt „Seele“ an, das passt zum Orden. Weiche Laute (S, L, Vokale) stehen bewusst gegen das harte V-R-K von „Varkan“.
- **Kapitel:** Jeder Spieler und jede KI ist ein Kapitel des Ordens. Namensvorschläge für `aiProfile` und die Match-Anzeige: *Kapitel Ondis, Kapitel Merel, Kapitel Aveth, Kapitel Soline, Kapitel Iveric, Kapitel Tamsel* (EN *Chapter …*).
- **Slug:** Der Ordner bleibt `factions/f3/`, der ID-Namespace ist `f3:` (§7.3).
- **Offen:** Markenrecherche zu „Sael“ und den Kapitelnamen (§11.2).

---

## 2. Lore

### 2.1 Kurz-Lore (≈ 150 Wörter, Text für Lobby und Handbuch)

> Über Kessa hängt ein bleicher Mond, Sael. Dort lebt seit Generationen ein Orden, der Kessa nicht als Erzlager sieht, sondern als Perle im Werden: Die dünne Kruste ist ihre erste Schicht, und das Metall darunter wächst noch. Wer zu hastig ansticht, sprengt die Schale.
>
> Als die Häuser des Varkan-Kompakts ihre Adern öffneten, legte der Orden das Gelübde der Obhut ab: Wo das Kompakt gießt, soll auch einer des Ordens stehen. Kein Fuß betritt die werdende Perle. Der Orden senkt eine Saatperle an einem Lichtfaden hinab, und aus ihr schichtet sich der Prior, gelenkt von einer Schwester oder einem Bruder im Mondkloster.
>
> Fällt der Prior, springt die Saatperle. Die Obhut erlischt, und was der Orden dort geschichtet hat, gibt er der Tiefe zurück.
>
> Der Orden hasst niemanden. Er nimmt nur, was er halten kann.

### 2.2 Weltregeln: Jede Regel begründet eine Mechanik, die schon im Plan steht

| Weltregel | Mechanik (Feature) | Umsetzung / Text |
|---|---|---|
| **Obhut:** Die Obhut über ein Gebiet gilt nur, solange der Prior am Ort steht. | U1: ACU verloren = Spiel verloren, A4 | Niederlage-Text: „Perle gesprungen. Obhut erloschen.“ / „Pearl cracked. Custody void.“ |
| **Einsenkung:** Ein Lichtfaden aus dem Mondkloster senkt die Saatperle, aus der sich der Prior schichtet. | Spielstart, P19 (Warp-in, später) | Platzhalter bis P19: Ein heller Faden fällt, eine Perle setzt auf, danach schichtet sich der Prior per Build-Dissolve in Bändern von unten auf (≈ 3 s, nur View). Spielbar ist er ab Tick 0. |
| **Perlsprung:** Die Saatperle hält die Uplink-Energie und springt beim Tod. | U1: Death-Explosion | tiefer Klangschalen-Schlag, weißgoldener Blitz, Druckring, Splitterregen aus Perlmutt |
| **Geschichtete Automaten:** Alles außer dem Prior wird vor Ort Schicht um Schicht aufgebaut. | Fabriken, Engineers, Reclaim | Wracks sind erstarrte Schichten und damit Reclaim-Masse: „Was geschichtet ist, lässt sich zurücknehmen.“ |
| **Weihe:** Feinere Schichtung ist erst erlaubt, wenn ein Kapitelhaus geweiht ist. | U5: Fabrik-Upgrade T1→T2→T3 | Tooltip-Verb für das Upgrade: „Weihen“ / „Consecrate“ |
| **Ein Prior pro Obhut** | ACU ist einzigartig | SACU (U15, Post-MVP) wäre ein „Subprior / Subprior“ aus einem „Lichtschrein / Light Shrine“. |
| **Glanzstoß:** Der Prior entlädt die Saatperle gebündelt durch seine Lanze. | U8: Overcharge (optional) | Waffenname „Glanzstoß“ / „Lustre Strike“ |
| **Achtung vor der Kruste:** Maschinen schweben, wo es geht. Wo Wucht mehr zählt als Achtung, schreiten Läufer auf spitzen Beinen. | Schweben als Optik (MVP), Hover-Layer später (§9.3) | erklärt, warum fast alles schwebt und nur die Läufer Beine haben |
| **Maß:** Der Orden nimmt nur, was er halten kann. | Balance-Identität: wenige, teure, starke Einheiten (§9) | Flavor in Tooltips, zum Beispiel beim Triton: „Einer, der hält, statt dreier, die fallen.“ |
| **Gleiche Probe, andere Begründung:** Charta (Varkan) und Gelübde (Sael) verlangen beide Anwesenheit am Ort. | Kreuz-Fraktions-Matches (U19/U22), gleiche Siegbedingung | Das Kompakt erkennt eine Obhut als Anspruch an, solange ein Prior steht, weil das die einzige Probe ist, der beide Seiten trauen. |

### 2.3 Verhältnis zum Varkan-Kompakt

- **Gemeinsamer Kern:** Beide Seiten schicken keinen Menschen auf den Boden, beide lenken eine einzelne Figur aus dem Orbit (Varkan aus den Hütten, Sael vom Mond), und bei beiden erlischt der Anspruch mit ihrem Fall. So bleibt die Siegbedingung in Spiegel- und Kreuz-Matches dieselbe.
- **Eigener Grund zu kämpfen:** Die Häuser kämpfen, weil Erz nicht wartet. Der Orden kämpft, weil unbewachte Adern die Kruste sprengen. Keiner der beiden ist böse: Die Häuser halten den Orden für Horter, der Orden hält die Häuser für hastig.
- **Spitznamen (nur Flavor, nie UI):** Die Häuser sagen „die Langsamen“ oder „die Mondleute“, der Orden sagt „die Gießer“.
- **Spiegel-Matches Sael gegen Sael:** Kapitel streiten über die Auslegung des Gelübdes, also darüber, wie viel eine Obhut nehmen darf. Die KI ist ein Kapitel mit strengerer oder lockererer Lesart.

### 2.4 Ton

- **Ja:** ruhig, gemessen, bildhaft-maritim (Schicht, Gezeit, Schale, Tiefe), geduldig. Leise Ironie der Geduld („Die Flut kommt ohnehin.“). Die Sprache ist feierlich, aber knapp.
- **Nein:** Kreuzzug, Bekehrung, „Reinigung“ von Andersgläubigen (bewusst weg vom Vorbild), Heilsversprechen, Engel, Erleuchtung, Fanatismus, Außerirdische. Keine Zitate aus realen Religionen, keine Gebetstexte. Ordensbegriffe (Prior, Novize, Kapitel, Weihe) sind allgemeines Klostervokabular ohne bestimmtes Bekenntnis.
- **Beschreibungstexte (`descKey`):** höchstens 2 Sätze. Satz 1 sagt, was die Einheit tut, Satz 2 bringt eine Zeile Ordensflavor.
- **Lore-Synonyme** wie „Tiefe“ (Metall unter der Kruste), „Schicht“ oder „Glanz“ stehen nur in Flavor-Texten, nie in Zahlenanzeigen.

### 2.5 Begriffe, die nicht verwendet werden

| Nicht verwenden (FA-Begriffsfeld) | Stattdessen (DE / EN) |
|---|---|
| Armored Command Unit, „Commander“ als Einheitenname | Prior / Prior |
| Quantum Gate, Quantum Warp, Warp-in | Einsenkung / Descent, Lichtfaden / Lightline |
| Overcharge | Glanzstoß / Lustre Strike |
| nuklearer ACU-Tod | Perlsprung / Pearl Crack |
| Fraktions- und Lorebegriffe der Vorbild-Fraktion und der übrigen FA-Fraktionen (Aeon, Illuminate, „The Way“, Princess, Crusade, Cybran, UEF, Seraphim, Symbiont) | Orden von Sael, Gelübde der Obhut, Kapitel, Mondkloster |
| FA-Einheitennamen, vor allem die Grep-Treffer auf naheliegende Wortfeld-Kandidaten: *Tide, Echo, Flood, Mole, Cormorant, Will O Wisp, Shimmer, Mirage, Crab* | Namen aus den Wortfeldern §7.2 (Review: auch *Crab* wegen „Crab Egg“ → Knallkrebs / Pistol Shrimp) (Warte statt Echo, Deich statt Mole, Albatros statt Kormoran, Glimmer statt Irrlicht, Brandung statt Flut) |
| „Sacrifice“ (Engineer opfert sich in einen Bau) | Hingabe / Devotion (nur als Post-MVP-Idee, §9.3) |
| „Hydrocarbon Plant“ | Quellbogen / Spring Arch (ID `hydro` bleibt intern) |

`Schweber / Hover` ist ein allgemeiner RTS-Bewegungsbegriff und bleibt in der UI erlaubt. Das Feld `faReference` in `roster.json` zitiert FA-Rollenstrings nur zu Entwicklungszwecken (`devOnly: true`), wie bei Varkan.

---

## 3. Designsprache „Schichtung“

### 3.1 Leitmotiv

**Geschichtet, nicht gegossen.** Jede Einheit ist eine glatte Schale aus Perlmutt, die eine Handbreit über dem Boden schwebt. Obenauf liegt eine Emaille-Einlage in Teamfarbe, Goldkanten zeigen die Hand des Ordens, und die Waffen sind das einzig Spitze an ihr: Lanze, Horn, Stachel. Unten ist die Schale dunkel wie die Außenseite einer Muschel, oben hell wie ihr Inneres. Wo Varkan schwer und tief ist, ist Sael leicht, hoch und ruhig.

### 3.2 Formregeln

| Regel | Umsetzung |
|---|---|
| **Schale** | Alle Rümpfe sind glatte Halb-Ellipsoide mit flacher Unterseite, von oben leicht tropfenförmig (Bug schmaler als Heck). Die Höhe beträgt höchstens 0,40 × Rumpflänge. Es gibt keine Fasen und keine rechten Winkel, auch nicht an Gebäudesockeln (Sockel = „Kissen“ mit gerundeten Ecken). |
| **Rund = Körper, Spitz = Waffe** | Spiegelbild der Varkan-Regel: Rumpf, Kopf und Sockel sind rund. Alles, was schießt, ist spitz oder konisch (Lanze, Horn, Stachel). Dieser Kontrast trägt die Lesbarkeit, auch zwischen den Fraktionen. |
| **Signatur-Formen** | **Perle + waagerechte Lanze** = Direktfeuer. **Horn** (Kegelstumpf mit weiter Mündung, schräg) = Artillerie. **Stachelkranz** (dünne senkrechte Stacheln) = Flugabwehr. **Sichel** (goldener Bogenarm) = Bauen. **Ring** = Schild und Flow. **Laterne** (stehende Linse) = Energie. Jede Form gehört genau einer Rolle (§5). |
| **Schweben** | Alle Schweber sitzen auf einem **Schwebeteller** (flacher, dunkler Diskus), der den Schalenumriss um 8–12 % überragt. Dieser **Schattensaum** macht Schweben lesbar und gibt hellen Einheiten auf hellem Terrain eine dunkle Kontur. Schwebehöhe (nur View) T1 0,25 / T2 0,30 / T3 0,35 WU über Grund, mit einem langsamen Auf und Ab von ±0,03 WU (Periode 3 s, Phase pro Entity aus der ID). |
| **Läufer** | Nur die drei Läufer (Knallkrebs, Languste, Einsiedler) haben Beine. Ihre Schale ist **breiter als lang** (Krebs-Rückenschild), die Schweber-Schalen sind **länger als breit**. |
| **Richtung** | Die Lanze zeigt die Zielrichtung, die schmale Tropfenspitze der Schale die Fahrtrichtung. Luftfahrzeuge zeigen die Richtung über ihren Grundriss. |
| **Symmetrie ist die Norm** | Nur Engineers und der Prior sind asymmetrisch (Sichel). |
| **Keine Filigranteile** | Kein Teil ist schmaler als 12 % der Einheitenlänge (Regel und `iconThreshold` 25 px wie Varkan). Konkrete Mindestmaße bei der Kauri-Basis (1,4 WU): Lanzen-Ø an der Wurzel ≥ 0,17 WU, Stachel-Ø ≥ 0,17 WU, Horn-Mündung ≥ 0,34 WU (Stachel höchstens halb so dick), Sichel-Querschnitt ≥ 0,17 WU. Details ab MS14 nur über Textur und Normal Map. |
| **Gebäude** | Jedes Gebäude steht auf einem flachen Kissen-Sockel (Footprint = Grid, 100 % gefüllt). Das Rollen-Element **schwebt 0,2–0,4 WU über dem Sockel** (nur View): Kelch, Laterne, Perle mit Lanze, Stachelkranz, Mast mit Ring, Horn. |
| **Placeholder = Final-Silhouette** | Final-Assets ergänzen nur Details (Schichtlinien, Goldkanten, Perlmutt-Maserung). Der Umriss darf sich höchstens um 10 % ändern (wie Varkan). |

### 3.3 Kitbash-Teilekatalog

Die Part-Keys sind englisch (Code), die DE-Namen stehen für Dokumentation und Tooltips. **Alle Sael-Parts lassen sich aus drei neuen prozeduralen Primitiven erzeugen** (skaliertes `ellipsoid`, `cone` mit Radius oben/unten, `torus` mit Bogenwinkel) plus dem vorhandenen `cyl`. Das hält die Compiler-Änderung klein (§3.6).

| Part-Key | DE | Primitiv | Tris LOD0 | Verwendung |
|---|---|---|---|---|
| `shell` | Schale | Halb-Ellipsoid 10×4, Unterseite flach | ≈ 60 | Rumpf aller Schweber, Rückenschild der Läufer, Gebäudedach, Gunship-Kuppel, Bomber- und Jagdbomber-Gondeln |
| `hoverpad` | Schwebeteller | flaches Ellipsoid 8×2 (Diskus), dunkel | ≈ 32 | Fahrwerk aller Schweber (ersetzt `tracks`) |
| `legs` | Beine | prozedural (Render-Pfad, vorhanden) | – | Läufer. Spitz zulaufende Beine; Beinpaare 3 (Knallkrebs, Languste) bzw. 4 (Einsiedler), falls der Render-Pfad das hergibt, sonst Standard |
| `orb` | Perle | Kugel 8×6 | ≈ 80 | Direktfeuer-Turm, Kopf des Priors; in Flow-Gebäuden nur **umschlossen** (im Ring, im Kelch) |
| `lance` | Lanze | spitzer Kegel, 6 Seiten | ≈ 12 | Direktfeuer-Waffe, immer waagerecht |
| `horn` | Horn | Kegelstumpf 8 Seiten, weite Mündung | ≈ 32 | Artillerie und Raketen (schräg 50°) |
| `spine` | Stachel | dünner Kegel, 5 Seiten | ≈ 10 | Flugabwehr (≥ 75°) |
| `sickle` | Sichel | Torus-Bogen 120°, 8×3, abgeflacht | ≈ 48 | Bauarm der Engineers, Halo-Sichel des Priors |
| `ring` | Ring | flacher Torus 12×3 | ≈ 72 | Schild-Emitter, Brunnen-Kranz, Quellbogen (nie Radar) |
| `arch` | Bogen | Torus-Bogen 180°, stehend, 8×3 | ≈ 36 | Kapitel-Tor, Quellbogen |
| `mast` | Mast | dünner Zylinder | ≈ 24 | Späher-Nadel, Schild, Radar |
| `fan` | Fächer | Halbkreisscheibe, flach | ≈ 16 | Radarplatte (35°) |
| `lantern` | Laterne | stehendes Ellipsoid 8×5 (Linse), Rippen per Maske | ≈ 64 | **nur Flow-Einheiten:** Energie (Laterne, Schrein), Kelch-Kern des Brunnens |
| `wing` | Schwinge | flaches Sichel- bzw. Ovalprisma | ≈ 16 | Luft |

**Budget (Abnahmekriterium, identisch zu Varkan):**
- Mobile Einheiten: 4–7 Parts, davon höchstens 2 animiert (Yaw/Pitch im `PartStream`, Limit 8). Strukturen: 4–9 Parts.
- Platzhalter-Mesh ≤ 350 Tris LOD0. Kugeln und Tori sind teurer als Boxen; deshalb trägt eine Einheit höchstens eine `orb` und einen `ring` oder eine `sickle` (Beispiel Kauri: `shell` 60 + `hoverpad` 32 + `orb` 80 + `lance` 12 + Gold-`lance` als Schaft 12 ≈ 196 Tris).
- **Ein Visual pro Rolle = ein Superset-Mesh** mit Tech-Bitmaske pro Vertex, wie Varkan §3.3. Ziel: dieselben **28 Visuals** für 50 Blueprints.
- **Draw-Budget bei gemischten Matches:** In einem Kreuz-Match Varkan gegen Sael sind 2 × 28 = 56 Visuals im Umlauf. Der DECISIONS-Test (40 Visuals ⇒ 309 CSM-Draws) deckt das nicht ab. Das muss vor U22 im Render-Bench geprüft werden (§11.2).

### 3.4 Tech-Skalierung per Kitbash

| Tech | Maßstab mobil | Höhe Strukturen | Schwebehöhe | Tech-Streifen | Zusatz |
|---|---|---|---|---|---|
| T1 | 1,0 | 1,0 | 0,25 WU | 1 | Grundform |
| T2 | 1,3 | 1,2 | 0,30 WU | 2 | zweite, parallele Lanze oder größere Perle; seitliche Schalenflügel (`shell`, flach) |
| T3 | 1,7 (bei 1×1-Footprint max. 1,4) | 1,4 | 0,35 WU | 3 | Doppelaufbau (zweite Perle, zweite Sichel) oder überlange Schale |

- **Mobil und Strukturen:** Maßstabsregeln exakt wie Varkan §3.4 (Sockel füllt 100 % des Footprints, In-Place-Upgrades wachsen nur in der Höhe, Neubauten mit größerem Footprint füllen ≥ 70 % der Kante). Die Werte stehen je Blueprint in `kitbash.scale`.
- **Tech-Streifen** sind 1–3 Querstreifen im hinteren Drittel der Schale, als Maske und nicht als Geometrie (Breite 0,10 WU × Maßstab, Abstand 0,10 WU). Sie sind **Tiefjade** `#1E4A40`, also dunkel auf hellem Perlmutt. Bei Engineers, deren Deck golden ist, bleiben sie Tiefjade. Prior und Deich tragen keine Streifen. Die Zahl entspricht exakt den Tech-Kerben im Icon.

### 3.5 Licht als Spielinformation (nur View, kein Sim-Einfluss)

Es gibt zwei Lichtklassen, gleich aufgebaut wie Glutnaht und Glutkern bei Varkan:

| Klasse | Wer | Fläche | Farbe | Bedeutung |
|---|---|---|---|---|
| **Lichtnaht** | alle Einheiten | ≤ 2 % der Oberfläche: Schichtfugen am Heck, an der Lanzenwurzel, am Tellerrand | Jade `#7FE3C0`, HDR 1–2 | Zustand der Einheit |
| **Goldkern** | nur **Flow-Einheiten**: Prior, Engineers, Kapitel, Brunnen, Laternen, Quellbogen | 3–6 %: Sichelspitzen, Laternenlinse, Kapiteltor, Kelch | Kern `#FFF3CF`, Falloff `#F2C45A`, HDR 3–6 | „Hier entsteht oder fließt Wirtschaft“ |

Kampfeinheiten tragen nie einen Goldkern. Ein großer goldener Lichtpunkt bedeutet also immer Ökonomie oder Bau, genau wie ein Glutkern bei Varkan. Der Part `lantern` ist deshalb flow-exklusiv (Lint).

**Schwebelicht:** Unter jedem Schweber liegt ein weiches, jadefarbenes Licht-Decal auf dem Boden (Ø ≈ 1,3 × Tellerdurchmesser, Alpha 0,35). Es ist ein instanziertes Quad pro Einheit, ein Draw pro Armee, und steht auf dem Low-Preset aus. Das Modell selbst bekommt dafür kein Emissive, sodass die Lichtregel oben unberührt bleibt.

**Zustände über den View-Parameter `flowGlow`:**
- Leerlauf: Lichtnähte „atmen“ langsam (Periode 4 s). Varkan glimmt, Sael atmet.
- Feuern: kurzer Blitz an der Lanzenspitze. Das Horn leuchtet an der Mündung **0,5 s vor** dem Schuss auf (nur View, die Feuerzeit ändert sich nicht).
- Bauen: Sichelspitzen und Kapiteltor leuchten auf.
- **Energy-Stall (E3):** Goldkerne aller betroffenen Verbraucher verblassen zu entsättigtem Perlgrau und flackern. So ist der Flow-Zustand ohne HUD lesbar.
- Schaden < 50 % HP: Über die Schale laufen Risse (Maske), aus denen Jadelicht dringt.
- Wrack: matt und grau, ohne Irisieren und ohne Licht (Wreck-Shader).

**Bau und Reclaim:**
- **Baustrahl = Lichtfaden:** ein dünner, durchgehender goldener Faden, auf dem kleine Perlen zum Bau wandern. Die Perlendichte skaliert mit der tatsächlich fließenden Build Power nach Stall-Drosselung (E2/E3).
- **Bau-Dissolve = Schichtung:** Rohbauten wachsen in waagerechten Bändern von unten nach oben, jedes Band mit einer Goldkante. Das ist der vorhandene Build-Dissolve-Shader mit einem zusätzlichen Quantisierungsparameter (Bandhöhe).
- **Reclaim:** Das Wrack blättert von oben in Perlmutt-Schuppen ab, die als Strom zum Engineer ziehen.
- **Budget:** kein Extra-Pass, nur HDR/Bloom der Presets. Auf Low (LDR, ohne Bloom) wird das Licht über vollgesättigte Farbe erkennbar.

### 3.6 Placeholder-Schema-Erweiterung (Delta zu Varkan §3.6)

Die Varkan-Erweiterung (`placeholder.parts[]`, `tech`) bleibt unverändert. Sael braucht nur drei zusätzliche Primitiv-Typen, alle rückwärtskompatibel:

```ts
prim: 'box' | 'cyl' | 'ellipsoid' | 'cone' | 'torus'
// ellipsoid: size = Halbachsen, half?: true (flache Unterseite)
// cone:      rTop, rBottom (0 = Spitze), length
// torus:     rMajor, rMinor, arc?: Grad (Default 360; Sichel 120, Bogen 180)
mat: 'body'|'team'|'gold'|'glow'|'jade'   // Sael-Slots, gleiche matId-Positionen wie Varkan
```

Das Feld liegt nur im View, betrifft also `viewHash` und nicht `simHash`. Die Umsetzung ist derselbe eigene Arbeitsschritt im Blueprint-Compiler wie bei Varkan (`ladle`).

---

## 4. Farben & Teamfarben

### 4.1 Materialien

Die Slot-Positionen (`matId` 0–4) sind dieselben wie bei Varkan, damit beide Fraktionen durch denselben Shaderpfad laufen. Nur die Bedeutung der Slots 2 und 4 ist fraktionsspezifisch.

| Slot (`matId`) | Material | Farbe (linear, Richtwert) | Charakter | Anteil |
|---|---|---|---|---|
| 0 `body` | Perlmutt | oben `#E4DED2`, nach unten gewandte Flächen `#26302C` („Schalenrinde“) | Roughness 0,35, leichtes Irisieren (Fresnel-Farbverschiebung ±8° Hue zu Grün und Rosé, ein Shader-Parameter, auf Low aus) | 40–50 % |
| 1 `team` | Emaille-Einlage | Teamfarbe | Roughness 0,4, leicht glänzend | 25–40 % |
| 2 `gold` | Gold | `#C8A24A` | Metallic 0,9, Roughness 0,3 | Kampfeinheiten ≤ 8 % (Kanten, Lanzenschaft); Engineers und Prior bis 20 % |
| 3 `glow` | Licht (emissive) | Goldkern `#FFF3CF` → `#F2C45A`, HDR 3–6; Lichtnaht-Maske Jade `#7FE3C0`, HDR 1–2 | „atmet“ nach `flowGlow` | 2–6 % |
| 4 `jade` | Tiefjade-Lack | `#1E4A40` | halbmatt | Tech-Streifen, Unterseite der Schwebeteller |

- **Hell oben, dunkel unten:** Der `body`-Shader mischt Perlmutt und Schalenrinde nach der Normalen (nach unten gewandt ⇒ dunkel), ohne Textur und ohne eigenen Slot. Dazu kommen der dunkle Schwebeteller und sein Schattensaum. So hebt sich die Einheit auch auf hellem Terrain ab.
- **Gold als Klassenkennung:** Große goldene Oberflächen (Deckplatte, Sichel) tragen nur Engineers und der Prior. Sonst erscheint Gold nur als schmale Kante oder als Lanzenschaft. Das ist die Entsprechung zur Keramik-Deckplatte der Varkan-Engineers.
- **Masken-Layout Final-Assets (MS14):** RGBA mit R = Team, G = Licht, B = Gold/Metallic, A = Schichtlinien/AO. Das ist dasselbe Layout wie bei Varkan; nur Kanal A wird anders gelesen (Schichtlinien statt Ruß).
- **Kein Ruß-Gradient.** Stattdessen blendet der Shader in den obersten 15 % jeder `shell` leicht ins Helle (Perlglanz), per Höhe über dem Part.

### 4.2 Teamfarben-Flächen

Die Mindestanteile sind **identisch zu Varkan**, damit Häuser und Kapitel im gemischten Match gleich gut unterscheidbar sind.

| Klasse | Teamfarbe auf | Mindestanteil an der Draufsicht (Standardkamera 40–60°) |
|---|---|---|
| Mobile Land (Schweber) | Emaille-Einlage auf dem Schalenscheitel (Oval, das die hintere Schale bis auf einen 15-%-Perlmuttrand füllt), dazu die Perle | **≥ 30 %** |
| Mobile Land (Läufer) | gesamter Rückenschild bis auf den Goldrand | **≥ 30 %** |
| Luft | Schwingenoberseite bis auf die Goldkante | **≥ 45 %** |
| Prior | Kegelrock-Oberseite in drei Bahnen, Brustschale | ≥ 35 % |
| Engineers | Schalenrand-Band und Unterseite der Sichel (das Deck ist Gold) | ≥ 25 % |
| Strukturen | Kissen-Sockelrand und Dachschale | 20–30 % |
| Deich | nur der gerundete Kamm | ≈ 10 % (bewusst ruhig) |

- **Nie teamfarben:** Lichtnähte, Gold, Waffen-Spitzen (Lanze, Horn-Mündung, Stachel), Schwebeteller.
- **Messung und Vorab-Lint** wie Varkan §4.2: automatisch aus der Parts-Spec (`mat:'team'`) oder per Masken-Pixelzählung; mindestens ein Team-Part pro Blueprint (bei AA-Stellungen der Sockel, bei Glimmer die Schale).

### 4.3 Teampalette

Die Palette ist **fraktionsübergreifend dieselbe** (Varkan §4.3, 8 Farben), damit in A3 jede Fraktion jede Farbe wählen kann. Auch die Verbote gelten weiter: kein Blassgelb, Weiß, Schwarz oder Grau. Für Sael kommt hinzu, dass Weiß ohnehin mit dem Perlmutt kollidieren würde.

**Licht-Konflikte (Shader-Umschaltung pro Armee):**
- **Goldkern** (Hue ≈ 44°): Liegt eine Teamfarbe weniger als 25° entfernt, wechselt der Goldkern dieser Armee auf **Weißlicht** `#F6F3FF`. Betroffen sind Orange (≈ 27°) und Oliv (≈ 63°).
- **Jade** (Lichtnaht und Schwebelicht, Hue ≈ 160°): Bei einem Abstand unter 35° wechselt die Jade auf **Silberlicht** `#DCE6EE`. Betroffen sind Grün (≈ 127°) und Cyan (≈ 186°).
- **Gold als Material** ist kein Licht und bleibt. Bei Orange und Oliv trennen Metallic-Glanz gegen matte Emaille und der Luma-Abstand. Das wird im Silhouettenblatt geprüft (§5.3).
- **Farbenblindheit:** Rolle und Tech liegen immer in Form, Glyphe und Strichzahl. Die Teamfarbe unterscheidet nur die Kapitel.

---

## 5. Silhouetten-Regeln

### 5.1 Die sieben Lesbarkeits-Gesetze

1. **Draufsicht zuerst.** Jede Rolle ist als schwarzer Schattenriss aus der Spielkamera (≈ 50°) bei 32 px und 48 px eindeutig.
2. **Monopol-Merkmal.** Jede Rolle hat genau **ein** exklusives Formmerkmal (Tabelle 5.2).
3. **Rolle am Aufbau, Gangart am Fahrwerk.** Die Rolle liest man immer am Aufbau. Das Fahrwerk zeigt die Gangart: **Schwebeteller = hält Abstand** (Reichweite, Linie), **Beine = geht heran** (Sturm, Überfall). Das ist die Sael-Entsprechung zu Varkans „Bots schnell, Ketten halten die Linie“.
4. **Tech durch Skalierung, nicht durch neue Form** (§3.4).
5. **Winkel-Code (fraktionsübergreifend gleich wie Varkan):** waagerecht = direkt, schräg = indirekt (Horn 50°), senkrecht = gegen Luft (Stachel ≥ 75°), Ring = Flow-Anschluss oder Schild, Mast = Intel (Radar mit Platte, nie mit Ring). Wer eine Fraktion lesen kann, liest damit auch die andere.
6. **Nichts unter 3 px** bei `iconThreshold` (mobil 25 px).
7. **Schwebeteller sichtbar.** Der Schattensaum (8–12 % über den Schalenumriss hinaus) ist Pflicht bei allen Schwebern und verboten bei Läufern und Gebäuden.

### 5.2 Rollen-Tabelle (MVP)

| Rolle | **Hero-Feature (Monopol)** | Pflicht | Verboten |
|---|---|---|---|
| **Direktfeuer Schweber (Kauri, Triton)** | **Perle** mit **waagerechter Lanze** | Lanze ≥ 60 % der Rumpflänge, ragt über die Tropfenspitze hinaus | Lanze steiler als 15° im Leerlauf, Horn |
| **Läufer (Knallkrebs, Languste, Einsiedler)** | Perle mit Lanze auf **breitem Rückenschild** (breiter als lang) und Beinen | Einsiedler zusätzlich mit einer **gewundenen Schale** auf dem Rücken (Schild-Emitter, T3 ab K10) | Schwebeteller |
| **Präzisionsschweber (Konus, T3)** | Perle mit **extrem langer** Lanze (≥ 1,4 × Rumpflänge) | schmale, lange Schale | zweite Lanze |
| **Artillerie** | **Horn** (weite Mündung, 50°) mittig auf der Schale; T2-Raketen (Brecher) = **Horn-Paar** nebeneinander | Horn-Mündung ≥ 2 × Stachel-Ø; Heck-Gegenschale | Perle, waagerechte Lanze, dünne Stacheln |
| **Flugabwehr** | **Stachelkranz:** 3–5 dünne senkrechte Stacheln (≥ 75°) als Bogen quer zur Fahrtrichtung | Stachel höchstens halb so dick wie eine Horn-Mündung, Ø ≥ 0,17 WU | Horn, Perle, einzelner dicker Stachel |
| **Engineer** | **goldene Sichel** vom linken Heck über das Deck nach vorn rechts + **goldene Deckplatte**, Goldkern an der Sichelspitze | asymmetrisch; Anzahl der Sicheln = Tech (1/2/3, verschieden groß); Schalenrand-Band in Teamfarbe; an der Sichelspitze ein kleiner, **umschlossener** Glow-Emitter (`orb`, Ø ≤ 0,5 × Kauri-Perle) | jede Waffenform, Perle mit Lanze, freie (nicht umschlossene) oder teamfarbene Perle |
| **Land-Späher (Glimmer)** | kleinste Schale + hohe dünne **Nadel** (`mast`) | Nadel ≥ 1,0 × Rumpflänge, ohne Kopfteil | Perle, Ring, Horn |
| **Mobiler Schild (Muschel)** | `mast` mit **waagerechtem Ring** als höchstem Punkt, darunter zwei aufgeklappte Schalenhälften | Ring Ø ≥ 1,2 × Rumpfbreite | Lanze, Perle |
| **Prior** | **schwebender Kegelrock** (breit unten, ohne Beine) mit der größten Perle als Kopf, **Halo-Sichel** hinter dem Kopf (stärkster Goldkern), **Lanze mittig vor der Brust** | größte Landeinheit bis T2 (Höhe ≥ 2,4 WU, Rockbreite ≥ 2,0 WU) | Waffenarm rechts + Bauarm links (FA-ACU-Schema), Beine |
| **Abfangjäger (Sturmvogel)** | **schmale Pfeilsichel:** lange Rumpfspindel, Schwingenspitzen nach hinten gebogen | lang > breit, 2 Lichtnähte hinten | breite Schwinge, Gondeln |
| **Bomber (Tölpel)** | **breite Ovalschwinge** + Bauch-Gondel (`shell`) | breit ≥ lang; Gondel ≥ 1,4 × Schwingentiefe, ragt vorn und hinten sichtbar über | Pfeilung > 30° |
| **Gunship (Albatros)** | **keine Schwingen:** Kuppel (`shell` hochgewölbt) mit hängender Perle und Lanze darunter | Lanzenspitze ragt von oben sichtbar vor die Kuppel | Schwingen |
| **Jagdbomber (Raubmöwe, T2)** | Pfeilsichel mit **zwei Gondeln an den Schwingenspitzen** | Spannweite +30 % gegenüber Sturmvogel | Kuppel, Bauch-Gondel |
| **Luft-Späher (Seeschwalbe)** | kleinster Flieger mit **gegabeltem Heck** | – | Waffen-Parts |
| **Brunnen (Mex)** | `ring` um den Spot + schwebender **Kelch** (kleine Schale auf Stiel) mit Goldkern | niedrig, bleibt auf 2×2; T3 mit doppeltem Ring | Laterne |
| **Laterne (Pgen)** | 1–3 stehende **Laternen** (Zahl = Tech) über einer flachen Schale | Laternenhöhe ≥ 1,5 × Schalen-Ø | – |
| **Quellbogen (Hydro)** | `ring` mit **drei Bögen** (`arch`), die sich über dem Spot treffen, Goldkern im Scheitel | – | Laterne |
| **Storage** | Mass: **Zisterne**, flaches offenes Oval-Becken (`shell` umgedreht). Energy: **Schrein**, zwei liegende Laternen in flacher Schale (Höhe ≤ 0,3 × Kante) | flach | stehende Laterne, Ring |
| **Kapitel (Fabrik)** | **Halbschale** (Kuppelhalle), zur Ausgangsseite offen, mit goldenem Tor-Bogen (Goldkern); Land mit Rampe, Luft mit Landescheibe | – | – |
| **Riff (PD)** | **dieselbe Perle mit Lanze** wie der Kauri, auf dem Sockel schwebend | – | – |
| **Seelilie / Hochlilie (AA / SAM)** | Stachelkranz auf teamfarbenem Sockel; Hochlilie mit doppelt so vielen, dickeren Stacheln | – | Laterne |
| **Brandung / Sintflut (Artillerie statisch)** | großes Horn auf Lafette; Sintflut = Horn Ø 3,0 WU, 7 WU lang, auf 8×8 mit Gegenschale | Gegenschale | Perle, Laterne |
| **Warte (Radar)** | **Fächer** (Halbkreisplatte 1,6 × 0,8 WU, 35° gekippt) auf `mast` | hoch und dünn | Ring |
| **Perlmutt (Schildgenerator)** | `mast` mit **waagerechtem Ring** | Ring Ø ≥ 0,8 × Footprint-Kante | Fächer |
| **Deich (Mauer)** | niedrige, gerundete Wulstkette, nur der Kamm teamfarben | – | – |

**Pflicht-Paartest MS9 (nur ●):** Kauri↔Seeigel, Dünung↔Seeigel, Brecher↔Seestern, Triton↔Brecher, Knallkrebs↔Kauri (Beine gegen Schwebeteller), Novize↔Glimmer, Riff↔Seelilie, Brunnen↔Laterne, Laterne↔Schrein, Zisterne↔Schrein.
**Pflicht-Paartest MS14:** Tölpel↔Sturmvogel, Sturmvogel↔Raubmöwe, Seeschwalbe↔Tölpel, Warte↔Perlmutt, Glimmer↔Muschel, Konus↔Triton, Sintflut↔Laterne III, Brunnen III↔Quellbogen.
**Kreuz-Fraktions-Paartest (neu):** Kauri↔Punze, Seeigel↔Sieb, Dünung↔Kelle, Novize↔Lehrling, Riff↔Riegel. Beide Seiten eines Paares haben dieselbe Rolle; der Test prüft, dass die **Rolle** trotz anderer Fraktion erkannt wird (Winkel-Code).

### 5.3 Abnahme

1. **Silhouettenblatt** wie Varkan §5.3 (5 Tester, Rollen-Trefferquote ≥ 90 %, MS9-Paare 5 von 5).
2. **Gemischtes Silhouettenblatt Varkan + Sael:** Rollen-Trefferquote ≥ 90 % über beide Fraktionen, ohne Fraktionsangabe.
3. **Graustufen-Aufsicht bei 60 WU**, auf dunklem **und** hellem Terrain (Schattensaum-Prüfung).
4. **Teamfarben-Anteil** nach §4.2, automatisch gemessen.
5. **Kitbash-Budget** nach §3.3, inklusive Superset pro Visual.
6. **Monopol-Lint (Blueprint-Compiler):** Nur `aa`/`sam` enthalten `spine`. Nur `arty`/`mml` enthalten `horn`. `lance` erscheint nur waagerecht (Pitch < 15°) und nur mit einer `orb` im selben Blueprint. `orb` ohne `lance` gibt es nur in Flow-Kategorien, und dort umschlossen. `lantern`, `sickle` und `mat:'glow'` erscheinen nur bei ECONOMIC, FACTORY und ENGINEER (Prior zählt als ENGINEER). `hoverpad` ist verboten bei Läufern und Gebäuden. Mindestens ein `mat:'team'`-Part pro Blueprint.

---

## 6. Strategic-Icon-Sprache (gemeinsame Grammatik)

**Normativ ist Varkan `faction.md` §6.** Wie in FA sind Strategic Icons fraktionsübergreifend gleich, nur die Füllfarbe ist die Teamfarbe. Sael fügt dem MSDF-Atlas **keine** Grundform, Glyphe und Kerben-Variante hinzu.

- **Grundform = Domäne:** Land mobil = Quadrat mit Fase, Luft = Dreieck, Engineer = Kreis, Gebäude = Sechseck, Commander = Tropfen (Spitze unten, 1,6×), Mauer = Mini-Quadrat.
- **Glyphe = Rolle:** 19 Tokens wie Varkan (`direct`, `bot`, `sniper`, `arty`, `mml`, `aa`, `sam`, `bomb`, `fbomb`, `build`, `intel`, `shield`, `mass`, `energy`, `hydro`, `mstore`, `estore`, `fac_land`, `fac_air`).
- **Tech-Kerben:** 1–3 oben rechts außerhalb der Grundform; ihre Zahl entspricht den Tech-Streifen am Modell (§3.4).
- **Schweben ändert kein Icon.** Schweber sind Land-mobil (Quadrat), wie in FA. Die Gangart liest man am Modell, nicht am Icon.
- **Läufer** nutzen die Glyphe `bot` (Beinstriche). Im Strategic Zoom sind die Sael-Läufer damit genauso von der Schweberlinie getrennt wie die Varkan-Bots von der Panzerlinie.
- **Präzisionsschweber Konus:** `land_sniper_t3`, obwohl er schwebt. Die Glyphe codiert die Rolle, nicht das Fahrwerk.
- **Commander-Tropfen:** Bei Varkan heißt er „Lot-Tropfen“, bei Sael „Perlentropfen“. Es ist dieselbe Form, nur der Flavor-Name im Handbuch ist ein anderer.
- **Radar-Blip, Ghost, Im-Bau- und Auswahl-Zustände** wie Varkan §6.5. Der Blip verrät auch die Fraktion nicht: Blip-Formen sind fraktionsneutral.
- **Personal-Schilde** (Triton, Einsiedler, ab K10) zeigen sich nicht im Icon, sondern als zweiter Balken über dem Lebensbalken (C3), wie beim mobilen Schild.
- **Icon-IDs:** identisches Schema `<form>_<glyph>_t<n>`. Ein Sael-Blueprint trägt dieselbe Icon-ID wie der Varkan-Blueprint derselben Rolle (§7.4).

---

## 7. Namenssystem

### 7.1 Regeln

Die Regeln 1–5 aus Varkan §7.1 gelten unverändert: Rufname aus dem Wortfeld der Rolle, echte DE/EN-Wortpaare, ein neuer Name pro Tech-Stufe, Gebäude mit Funktionsname und römischer Stufe, UI zeigt Rufname und Funktionsrolle, Grep gegen FA-Namen vor dem Einfrieren. Sael-spezifisch kommt hinzu:

6. **Ein Bildfeld für die ganze Fraktion: Meer und Kloster.** Kampfeinheiten tragen Namen von Meerestieren, Wellen und Seevögeln (Kessas Metall ist für den Orden „das Meer unter der Kruste“). Wirtschaft, Engineers und Gebäude tragen Kloster- und Lichtnamen. Das Bildfeld verrät die Fraktion, das Wortfeld die Rolle.
7. **Das Fahrwerk steckt im Wortfeld:** Schweber heißen nach Schnecken und Muscheln (tragen ihre Schale, gleiten), Läufer nach Krebsen (schreiten). So hilft der Name bei Regel 3 aus §5.1.
8. **Keine Verwechslung mit anderen Fraktionen:** Rufnamen (DE und EN, ohne Stufenziffer) müssen sich von jedem Rufnamen aller anderen Roster um mindestens zwei Buchstaben unterscheiden; `tools/roster/f3/validate.py` prüft das gegen alle vorhandenen `roster.json`. Verworfen deshalb: „Stachel“ als AA-Turm (Varkan-Bot „Stichel“) und im Review „Hummer“ (f2 „Hummel“), „Kegel“ (f2 „Egel“), „Dorn“ (f4 „Horn“), EN „Well“ (Varkan EN „Wall“).

### 7.2 Wortfelder

| Rolle | Wortfeld | Namen |
|---|---|---|
| Prior | Ordenstitel | Prior / Prior |
| Engineers | Ordensstufen | Novize → Akolyth → Kustos |
| Direktfeuer Schweber | Schnecken und Muscheln | Kauri, Triton (Tritonshorn), Konus (Kegelschnecke, lat. *Conus*) |
| Direktfeuer Läufer | Krebse | Knallkrebs, Languste, Einsiedler (Einsiedlerkrebs) |
| Artillerie | Wellen und Fluten | Dünung, Brecher, Woge, Brandung, Sintflut |
| Flugabwehr | Stachelhäuter (Stacheln zeigen nach oben) | Seeigel, Seestern, Diadem (Diademseeigel), Seelilie, Hochlilie (Seelilien sind festsitzende Stachelhäuter: passt zum Turm) |
| Luft | Seevögel | Seeschwalbe, Sturmvogel, Tölpel, Albatros, Raubmöwe |
| Aufklärung / Intel | Schimmer und Ausguck | Glimmer, Warte (Seewarte) |
| Schild | Schalen | Muschel, Perlmutt |
| Wirtschaft | Kloster und Licht | Brunnen, Laterne, Quellbogen, Zisterne, Schrein, Kapitel |
| Verteidigung | Küste | Riff, Deich |

### 7.3 Unit-IDs und i18n

- **Schema:** `f3:<domäne>_t<n>_<rolle>` mit denselben Domänen (`cmd | lnd | air | str`) und **denselben Rollen-Tokens** wie Varkan (§7.3 dort). Der Namespace ist der lore-neutrale Ordner-Slug. Bekommt die Fraktion später einen Paketnamen, ändert sich nur der Namespace. Beispiele: `f3:cmd_commander`, `f3:lnd_t1_tank`, `f3:str_t2_shield`.
- **Waffen:** `f3:wpn_<typ>_t<n>`, zum Beispiel `f3:wpn_lance_t1`, `f3:wpn_horn_t1`, `f3:wpn_spine_t1`, `f3:wpn_prior_lustre`.
- **i18n-Keys:** `unit.f3.<id>.name`, `.role`, `.desc`. Umlaute nur in DE-Strings, IDs reines ASCII.
- **Hotbuild:** exakt dieselben Slots wie Varkan (§7.4), damit Muskelgedächtnis zwischen den Fraktionen trägt. Nur die Menünamen unterscheiden sich (Landkapitel, Luftkapitel, Bau).

### 7.4 Roster (● = MS9-Kern, ○ = bis MS14)

Vorläufig; `roster.json` wird die einzige Quelle. ●/○-Status und Meilensteine sind identisch zu Varkan.

| | ID | DE | EN | Rolle DE / EN | Icon | Hotbuild |
|---|---|---|---|---|---|---|
| ● | `f3:cmd_commander` | Prior | Prior | Kommandant / Commander | `cmd_commander` | – |
| ● | `f3:lnd_t1_engineer` | Novize | Novice | Ingenieur / Engineer | `eng_build_t1` | Landkapitel: E |
| ● | `f3:lnd_t2_engineer` | Akolyth | Acolyte | Ingenieur / Engineer | `eng_build_t2` | Landkapitel: E |
| ○ | `f3:lnd_t3_engineer` | Kustos | Custodian | Ingenieur / Engineer | `eng_build_t3` | Landkapitel: E |
| ● | `f3:lnd_t1_scout` | Glimmer | Glimmer | Späher / Scout | `land_intel_t1` | Landkapitel: A |
| ● | `f3:lnd_t1_bot` | Knallkrebs | Pistol Shrimp | Leichter Sturmläufer / Light Assault Walker | `land_bot_t1` | Landkapitel: S |
| ● | `f3:lnd_t1_tank` | Kauri | Cowrie | Leichter Schwebepanzer / Light Hover Tank | `land_direct_t1` | Landkapitel: Q |
| ● | `f3:lnd_t1_arty` | Dünung | Swell | Mobile Artillerie / Mobile Artillery | `land_arty_t1` | Landkapitel: W |
| ● | `f3:lnd_t1_aa` | Seeigel | Urchin | Mobile Flugabwehr / Mobile AA | `land_aa_t1` | Landkapitel: R |
| ● | `f3:lnd_t2_tank` | Triton | Triton | Schwerer Schildpanzer / Heavy Shield Tank | `land_direct_t2` | Landkapitel: Q |
| ● | `f3:lnd_t2_mml` | Brecher | Breaker | Raketenwerfer / Missile Launcher | `land_mml_t2` | Landkapitel: W |
| ● | `f3:lnd_t2_aa` | Seestern | Starfish | Flak / Flak | `land_aa_t2` | Landkapitel: R |
| ○ | `f3:lnd_t2_shield` | Muschel | Clam | Mobiler Schild / Mobile Shield | `land_shield_t2` | Landkapitel: D |
| ○ | `f3:lnd_t2_bot` | Languste | Langouste | Sturmläufer / Assault Walker | `land_bot_t2` | Landkapitel: S |
| ○ | `f3:lnd_t3_bot` | Einsiedler | Hermit | Belagerungsläufer / Siege Walker | `land_bot_t3` | Landkapitel: S |
| ○ | `f3:lnd_t3_arty` | Woge | Billow | Schwere Artillerie / Heavy Artillery | `land_arty_t3` | Landkapitel: W |
| ○ | `f3:lnd_t3_sniper` | Konus | Conus | Präzisionsschweber / Sniper Hover | `land_sniper_t3` | Landkapitel: F |
| ○ | `f3:lnd_t3_aa` | Diadem | Diadem | Schwere Flugabwehr / Heavy AA | `land_aa_t3` | Landkapitel: R |
| ○ | `f3:air_t1_scout` | Seeschwalbe | Tern | Aufklärer / Air Scout | `air_intel_t1` | Luftkapitel: A |
| ○ | `f3:air_t1_fighter` | Sturmvogel | Petrel | Abfangjäger / Interceptor | `air_aa_t1` | Luftkapitel: Q |
| ○ | `f3:air_t1_bomber` | Tölpel | Gannet | Bomber / Bomber | `air_bomb_t1` | Luftkapitel: W |
| ○ | `f3:air_t2_gunship` | Albatros | Albatross | Kampfschweber / Gunship | `air_direct_t2` | Luftkapitel: E |
| ○ | `f3:air_t2_fbomber` | Raubmöwe | Skua | Jagdbomber / Fighter-Bomber | `air_fbomb_t2` | Luftkapitel: R |
| ● | `f3:str_t1_mex` | Brunnen I | Fountain I | Massebohrung / Mass Extractor | `struct_mass_t1` | Bau: Q |
| ● | `f3:str_t2_mex` | Brunnen II | Fountain II | Massebohrung / Mass Extractor | `struct_mass_t2` | Bau: Q (Upgrade: Command Card) |
| ○ | `f3:str_t3_mex` | Brunnen III | Fountain III | Massebohrung / Mass Extractor | `struct_mass_t3` | Bau: Q (Upgrade: Command Card) |
| ● | `f3:str_t1_pgen` | Laterne I | Lantern I | Kraftwerk / Power Generator | `struct_energy_t1` | Bau: W |
| ● | `f3:str_t2_pgen` | Laterne II | Lantern II | Kraftwerk / Power Generator | `struct_energy_t2` | Bau: W |
| ○ | `f3:str_t3_pgen` | Laterne III | Lantern III | Kraftwerk / Power Generator | `struct_energy_t3` | Bau: W |
| ● | `f3:str_t1_hydro` | Quellbogen | Spring Arch | Dampfkraftwerk / Geothermal Plant | `struct_hydro_t1` | Bau: E |
| ● | `f3:str_t1_mstore` | Zisterne | Cistern | Massespeicher / Mass Storage | `struct_mstore_t1` | Bau: R |
| ● | `f3:str_t1_estore` | Schrein | Shrine | Energiespeicher / Energy Storage | `struct_estore_t1` | Bau: T |
| ● | `f3:str_t1_fac_land` | Landkapitel I | Land Chapter I | Landfabrik / Land Factory | `struct_fac_land_t1` | Bau: A |
| ● | `f3:str_t2_fac_land` | Landkapitel II | Land Chapter II | Landfabrik / Land Factory | `struct_fac_land_t2` | Bau: Upgrade (Command Card) |
| ○ | `f3:str_t3_fac_land` | Landkapitel III | Land Chapter III | Landfabrik / Land Factory | `struct_fac_land_t3` | Bau: Upgrade (Command Card) |
| ○ | `f3:str_t1_fac_air` | Luftkapitel I | Air Chapter I | Luftfabrik / Air Factory | `struct_fac_air_t1` | Bau: S |
| ○ | `f3:str_t2_fac_air` | Luftkapitel II | Air Chapter II | Luftfabrik / Air Factory | `struct_fac_air_t2` | Bau: Upgrade (Command Card) |
| ● | `f3:str_t1_pd` | Riff I | Reef I | Punktverteidigung / Point Defense | `struct_direct_t1` | Bau: Z |
| ● | `f3:str_t2_pd` | Riff II | Reef II | Punktverteidigung / Point Defense | `struct_direct_t2` | Bau: Z |
| ● | `f3:str_t1_aa` | Seelilie I | Sea Lily I | Flugabwehrturm / AA Tower | `struct_aa_t1` | Bau: X |
| ● | `f3:str_t2_aa` | Seelilie II | Sea Lily II | Flakturm / Flak Tower | `struct_aa_t2` | Bau: X |
| ● | `f3:str_t3_sam` | Hochlilie | High Lily | Raketenabwehr / SAM Site | `struct_sam_t3` | Bau: X |
| ● | `f3:str_t1_wall` | Deich | Dike | Mauer / Wall | `wall` | Bau: C |
| ○ | `f3:str_t1_radar` | Warte I | Lookout I | Radar / Radar | `struct_intel_t1` | Bau: D |
| ○ | `f3:str_t2_radar` | Warte II | Lookout II | Radar / Radar | `struct_intel_t2` | Bau: Upgrade (Command Card) |
| ○ | `f3:str_t3_radar` | Warte III | Lookout III | Radar / Radar | `struct_intel_t3` | Bau: Upgrade (Command Card) |
| ○ | `f3:str_t2_shield` | Perlmutt II | Nacre II | Schildgenerator / Shield Generator | `struct_shield_t2` | Bau: F |
| ○ | `f3:str_t3_shield` | Perlmutt III | Nacre III | Schildgenerator / Shield Generator | `struct_shield_t3` | Bau: Upgrade (Command Card) |
| ○ | `f3:str_t2_arty` | Brandung | Surf | Artilleriestellung / Artillery Emplacement | `struct_arty_t2` | Bau: V |
| ○ | `f3:str_t3_arty` | Sintflut | Deluge | Schwere Artilleriestellung / Heavy Artillery Emplacement | `struct_arty_t3` | Bau: V |

**Zählung:** 23 mobile + 27 Struktur-Blueprints = **50**, davon **26 im MS9-Kern**, dieselben Rollen wie bei Varkan.
**Grep-Stand (Review 2026-09-29):** Jedes Wort aller Rufnamen (DE und EN) wird bei jedem Prüferlauf gegen 357 Einheiten- und 218 Waffennamen aus spooky-db 3810 geprüft (`tools/roster/fa_names.json`, dev-only); erlaubt sind nur generische Wörter (Air, Land, High, Sea). Der Volltext-Grep fand „Crab“ (FA „Crab Egg“), deshalb heißt der T1-Läufer jetzt Knallkrebs / Pistol Shrimp. Zusätzlich prüft der Prüfer Abstand ≥ 2 Buchstaben zu allen Rufnamen der anderen Roster (Regel 8).
**Reservenamen:** *Nautilus* (T3-Schwebepanzer, gleich reserviert wie Varkans *Amboss*). *Perle / Pearl* ist seit dem T4-Entwurf das Eco-Experimental; alle Experimentals (Karkinos, Ammonit, Pelikan, Kreuzsee, Perle) stehen in `experimentals.md` und `roster.json` → `experimentals[]` (Post-MVP, U16/U21).

---

## 8. Audio-Charakter „Mondkloster und Brandung“

**Leitbild:** ein Kloster am Meer bei Nacht. Weit, luftig und hallig, mit langem Ausklang. Das ist der bewusste Gegenpol zu Varkans trockener, naher Gießhalle, sodass beide Fraktionen im gemischten Match schon am Klang getrennt sind. Materialgeräusche statt Sci-Fi-Synth: Klangschale, Glasharfe, Wasser, Wind, splitterndes Porzellan. **Kein Chorgesang.** Der Chor liegt zu nah am Vorbild und an einer möglichen vierten Fraktion.

### 8.1 Stimmen

- **Prior:** die **menschliche Stimme der Schwester oder des Bruders im Mondkloster**. Ruhig und leise, mit einem hauchfeinen Echo nach 120 ms (Mond-Laufzeit als Klangidee, nicht physikalisch). Sie ist die einzige menschliche Stimme auf dem Feld.
- **Alle anderen Einheiten:** **Schalenstimme**, gehaucht und hallig, höchstens 2–3 Wörter und ≤ 0,8 s. **Vor jeder Quittung kommen Klangschalen-Töne: Ihre Zahl ist die Tech-Stufe, ihre Tonlage die Rollenfamilie.** Diese Regel ist fraktionsübergreifend gleich zu Varkans Pips (Direkt mittel, Artillerie tief, AA hoch, Engineers aufsteigender Zweiklang, Luft gleitend), nur das Instrument ist ein anderes.
- **Alerts (P8):** **Pfortenstimme**, die Pförtnerin des Mondklosters. Klar und sachlich, ohne Flavor-Wörter. Vor jeder Ansage steht ein Dreiklang aus Glas; Wiederholintervalle wie Varkan.

| Anlass | DE | EN |
|---|---|---|
| Prior Auswahl | „Prior wacht.“ | „Prior keeps watch.“ |
| Prior Bewegung | „Gleite hinüber.“ | „Drifting across.“ |
| Prior Angriff | „Zurück in die Tiefe.“ | „Back to the deep.“ |
| Engineer Bau | „Wird geschichtet.“ | „Layering.“ |
| Engineer fertig | „Eine Schicht mehr.“ | „One layer more.“ |
| Kauri Auswahl | *Ton* „Kauri.“ | *tone* „Cowrie.“ |
| Dünung Angriff | *Ton (tief)* „Die Dünung steigt.“ | *tone (low)* „The swell rises.“ |
| Luft Auswahl | *Ton (gleitend)* „Tölpel am Himmel.“ | *tone (glide)* „Gannet aloft.“ |
| Alerts | „Prior unter Feuer.“ · „Masse knapp.“ · „Energie knapp.“ · „Kapitel geweiht.“ | „Prior under fire.“ · „Mass low.“ · „Energy low.“ · „Chapter consecrated.“ |

### 8.2 SFX-Palette

| Kategorie | Klang |
|---|---|
| **Signatur** | **angeschlagene Klangschale** mit langem Ausklang, sparsam: „Bau fertig“ leise und hoch, Weihe mittel, Perlsprung tief mit Schwebung. Eigene Kategorie im Voice-Manager, Cooldown ≥ 1 s. |
| **Flow-Grundton** | leiser Glasharfen-Liegeton (Quinte über D3) unter Kapiteln, Engineers und Laternen. **Beim Energy-Stall verstimmt er sich und schwebt hörbar** (zwei Töne, die gegeneinander flattern). So ist der Stall hörbar, ohne dass man aufs HUD schaut. |
| **Direktfeuer** | „Glasschlag“: heller, kristalliner Knall mit kurzem Schimmer-Nachklang. Höhere Tech klingt voller und länger, wird aber nicht lauter. |
| **Artillerie** | Abschuss als tiefer Wellenschlag mit ansteigendem Rauschen, im Flug ein Sirren, Einschlag als Gischt aus prasselnden Metalltropfen |
| **Raketen (Brecher, Hochlilie)** | luftiges Zischen mit einem hellen Glockenton beim Start |
| **Flugabwehr** | schnelles Klirren von Glasperlen in hoher Lage |
| **Antriebe** | Schweber: weiches Druckbrummen und Windhauch. Läufer: trockenes, hohes Klicken spitzer Beine. Flieger gleiten mit einem Rauschen, Gunships pulsieren tief. |
| **Bau / Reclaim** | Schichtklang: leises, ansteigendes Glitzern mit Wasserrieseln, am Ende der leise Klangschalen-Ton. Reclaim ist dasselbe rückwärts (Abblättern, sinkendes Rieseln). |
| **Befehle (UI)** | Auswahl: Glas-Tick + Atemhauch. Bewegung: fallender Windton. Angriff: kurzer Glasschlag. Bauauftrag: zwei helle Tropfen. |
| **Treffer / Tod** | Treffer: gedämpftes Porzellan-Klicken. Tod: Schale zerspringt wie Porzellan, danach rieseln Splitter. Strukturtod: große Schale birst, langer Glas-Nachhall. |
| **Perlsprung** | tiefer Klangschalen-Schlag, Glasbersten, Druckwelle wie auflaufende Brandung, danach 2 s Stille-Ducking mit nachklingendem Rieseln |
| **Eco-Gebäude** | langsames Atmen (Laterne), Tropfenrhythmus (Brunnen), leise, nur auf Z0 als Loop |

### 8.3 Mix-Regeln für den Voice-Manager (32 Stimmen)

- **Frequenzbänder** wie Varkan, aber Sael liegt insgesamt eine Terz höher und luftiger. Im gemischten Match überlagern sich die Fraktionen so weniger.
- **Ein Bau-Loop pro Armee**, Dichte = Summe der fließenden Build Power (wie Varkan).
- **Hall-Budget:** Der lange Ausklang ist gerendert (im Sample), nicht per Echtzeit-Reverb pro Stimme, damit das Stimmenbudget hält.
- Klangschalen und Alerts haben Vorrang vor Waffen, Eco-Loops haben die niedrigste Priorität.

---

## 9. Spielidentität & Asymmetrien

### 9.1 Kurzprofil

**„Wenige, die halten, schlagen viele, die fallen.“** Sael spielt auf Abstand und Präzision. Die T1-Linie schießt weiter, hält aber weniger aus. Ab T2 baut der Orden wenige teure Spitzeneinheiten mit Schilden, die große Einzelschläge austeilen. Die Basis ist zerbrechlicher, dafür schützen Schildgeneratoren pro Mass deutlich mehr. Schwächen: Überfälle auf kurze Distanz, Masse gegen Klasse bei T1 und Flächenschaden gegen teure Einzelstücke.

### 9.2 Kern-Asymmetrien (im MVP umsetzbar, nur Zahlen)

Alle Relationen folgen der Vorbild-Fraktion (Referenzen in `tools/roster/f3/fa_ref.json`, spooky-db 3810). Die Prozentwerte vergleichen die FA-Vorbild-Einheit mit der FA-Referenz der Varkan-Rolle. Das Roster hält dann ±15 % zur **Vorbild**-Relation. Diese Asymmetrien brauchen keine neue Mechanik.

| # | Asymmetrie | FA-Relation Vorbild ↔ Varkan-Referenz | Umsetzung im Roster | Features |
|---|---|---|---|---|
| A1 | **Reichweite statt Panzerung (T1)** | T1-Panzer: Reichweite 26 zu 18 (+44 %), HP/Mass −46 %, DPS/Mass +8 %, Tempo −12 % | Kauri schießt weiter als die Punze und muss sie auf Abstand halten. Stirbt schnell, wenn sie herankommt. | U4, K1/K2 |
| A2 | **Robuster Überfall-Läufer** | T1-Läufer: Mass +40 %, HP/Mass +37 %, DPS/Mass −17 % | Knallkrebs ist teurer und zäher als Varkans Stichel, schlägt aber pro Mass schwächer zu. Ein Läufer als Konter gegen Schweber-Artillerie. | U4 |
| A3 | **Wenige teure Schwere** | T2-Panzer: Mass +82 %, DPS/Mass +23 %, HP+Schild/Mass +1 %, 360 Schaden pro Schuss. T3-Läufer: Mass +75 %, DPS/Mass +22 % | Triton und Einsiedler kosten fast das Doppelte ihrer Varkan-Gegenstücke. Der Triton tötet eine Punze mit **einem** Schuss. | U6, U10 |
| A4 | **Einzelschuss-Präzision** | T2-Raketen 600 statt 300 Schaden bei halber Kadenz; T2-PD 600 Schaden, Splash 2, alle 4 s statt Schnellfeuer; T2-Artilleriestellung DPS/Mass +31 % | Große Einzeltreffer mit längerer Nachladezeit. Treffer-bis-Tod-Matrix ist exakt nach Vorbild (§9.4), Overkill auf kleine Ziele ist gewollt. | K1, K2, K4, K13 |
| A5 | **Starke, kleine Schilde** | T2-Schildgenerator: Schild/Mass +51 %, Radius −23 %. Mobiler Schild: Schild/Mass +14 %, Tempo +14 % | Perlmutt II schützt pro Mass mehr, aber eine kleinere Fläche. Die Muschel folgt der Schweberlinie schneller. | K10 (MS13, MVP-optional) |
| A6 | **Zerbrechliche Basis** | Fabriken HP/Mass −20 %, Pgen −12 %, Mex −8 %, Storage bis −19 %, Engineers HP −20 % | Überfälle auf die Basis lohnen sich gegen Sael mehr. Das gleicht A5 aus. | B1, E5, E6 |
| A7 | **Schnelle T2-Sturmeinheit** | T2-Sturm (Vorbild: schneller Schwebepanzer): Tempo 4,3 zu 2,9 (+48 %), HP/Mass +71 %, DPS/Mass −20 % zur Varkan-Referenz (ursprünglich +43 %: spooky zählte bei der Referenz nur eine von zwei Waffen, `roster.md` §1.1) | Die Languste ist schnell und zäh, aber als Läufer mit kurzer Reichweite. Sie spielt den Überfall-Part, den bei Varkan die Zange hat. | U6 |
| A8 | **Billige Aufklärung** | Land-Späher Mass −33 %, Reichweite 33 zu 26 | Glimmer ist billig und sieht weit. | I1 |

**Keine Stealth-Identität:** Das Vorbild setzt kaum auf Tarnung, Sael deshalb auch nicht. I5 wird nicht gebraucht.

### 9.3 Asymmetrien mit Post-MVP-Mechanik (markiert)

Diese Punkte gehören zur Identität, sind aber **nicht** Teil der Kern-Balance. Jeder hat einen MVP-Fallback.

| Asymmetrie | Benötigt | MVP-Fallback (bis das Feature da ist) |
|---|---|---|
| **Schweben über Wasser:** Schweber (Kauri, Triton, Dünung, Brecher, Seeigel, Seestern, Muschel, Konus, Diadem, Woge, Glimmer, Engineers, Prior) überqueren Wasser. | **M13** (Wasser-Bewegungslayer) + Bewegungslayer `Hover` (PLAN, Enum schon vorgesehen) | Schweber laufen im Layer `Land`. Das Schweben ist reine Optik (Schwebehöhe, Schattensaum, Schwebelicht). Tiefes Wasser bleibt unpassierbar wie für Varkan. |
| **Bauen auf Wasser** (schwebende Engineers) | M13, U17 (Marine) | kein Bau auf Wasser |
| **Amphibischer bzw. schwebender Prior** (das Vorbild-ACU ist amphibisch) | M13 | Prior im Layer `Land` |
| **Personal-Schild** von Triton (T2) und Einsiedler (T3) | **K10** (MS13, MVP-optional; deckt Personal-Schilde ab). Da der Triton MS8-Kern ist, braucht er einen Fallback. | **Vor K10:** Schild-HP werden zur HP addiert (`health.max` = HP + Schild, `hpBasis: "HP+Schild"` wie Varkans Schild-Referenzen). **Ab K10:** Aufteilung in HP und regenerierenden Schild. Die Balance-Zahl (HP+Schild)/Mass bleibt gleich. |
| **Bomber mit Lähmwirkung** (Vorbild-Bomber hat EMP) | **K18** (EMP/Stun) | reiner Splash-Schaden ohne Lähmung |
| **Zeitdämpfer des Priors** (Lähm-Aura als Vorbild-Enhancement) | **U14** + **K18** | entfällt |
| **Teleport des Priors** (Vorbild-Enhancement) | **U14** | entfällt |
| **Hingabe / Devotion:** Ein Engineer löst sich in einen Bau auf und gibt ihm seine Masse. | **neue Feature-ID nötig** (B-Kategorie, nicht in `features.json`) | entfällt |
| **Schildbrecher** (Einheit mit Schaden nur gegen Schilde) | K10 + neuer Schadenstyp (neue ID) | kein Blueprint im MVP |
| **Schweber als Marine-Konter** (auf Wasser gegen Schiffe) | M13, U17, U18 | entfällt |

### 9.4 Kreuz-Breakpoints gegen Varkan

Die FA-Treffer-Breakpoints gelten nicht nur innerhalb der Fraktion (`checks.hitsToKill`), sondern auch **zwischen** Sael und Varkan. Regel: Salven bis zum Tod eines Sael-Blueprints durch eine Varkan-Waffe = Salven, die die FA-Referenz der Varkan-Rolle gegen die FA-Vorbild-Einheit braucht, und umgekehrt. Pflichtpaare für `roster.json` → `checks.crossHitsToKill` (umgesetzt: 39 Pflichtpaare exakt, 12 Info-Paare, `roster.md` §14):

| Angreifer → Ziel | FA-Relation (Salven) | Folgerung |
|---|---|---|
| Punze (28) → Kauri | 7 (24 Schaden gegen 155 HP) | Kauri-HP 169–196 |
| Kauri (40) → Punze (300) | 8 | Kauri-Schaden 38–42 |
| Vogt (100) → Kauri | 2 | trivial |
| Prior (100) → Punze (300) | 3 | Prior-Schaden 100 |
| Triton (360) → Punze (300) | 1 | Triton-Schaden ≥ 300 |
| Triton (360) → Meißel (1600) | 5 (FA: 360 gegen 1500 HP) | Triton-Schaden 320–399 |
| Riegel I → Kauri, Riff I → Punze | wie FA-PD T1 gegen die jeweilige Vorbild-Einheit | im Roster-Generator zu prüfen |

### 9.5 Erwartete Matchups (Zielbild für das Balancing in MS8/MS9)

- **T1, Varkan gegen Sael:** Varkan muss die Distanz schließen (Stichel-Überfall, Punzen im Pulk). Sael gewinnt, wenn Kauris mit Abstand und in Bewegung schießen können. **Die Dünung gewinnt das Artillerie-Duell gegen die Kelle klar** (2 Treffer in 2 s gegen 2 Treffer in 9 s, auch pro Mass im Pulk vorn), wie im Vorbild; Varkan kontert sie nicht mit Kelle, sondern mit Stichel-Überfällen (Tempo 4,3 gegen 2,7, Mindest-RW 5) und Punzen-Vorstößen (6 Treffer). Ihre Stärke gegen bewegte Ziele hängt an Streuung und Flugzeit (`firingRandomness`, K1/K2, Abnahme MS7).
- **T1-Rush auf den Kommandanten** (`roster.md` §14, `checks.rush`): Den Prior töten 18 Punzen (19 gegen Glanzstoß), den Vogt 22 Kauri (23 gegen Abstich); Sael gegen Sael 21 / 22. Jede Paarung entspricht exakt der FA-Paarung. In Mass ist der Prior gut 10 % billiger zu überrennen (Vorbild-Relation); dafür überreichen Kauri (RW 26) beide Kommandanten (RW 22) und können sie kiten, Punzen (RW 18) nicht.
- **Eco-Kurve:** Wirtschaftsgebäude, Kapitel, Engineers und Prior kosten dasselbe wie bei Varkan und produzieren dasselbe; das Opening ist bis zur ersten Kampfeinheit identisch. Seit dem fraktionsübergreifenden Abgleich gibt es keine Abweichung mehr (Brunnen III und Luftkapitel II auf Varkan-Werte, `../README.md` §5.1). Sael zahlt seine Asymmetrie nur mit HP (A6).
- **T2:** Wenige Tritone unter Perlmutt-Schilden gegen die Meißel-Masse mit Rinnen. Varkan kontert über Flächenschaden auf die teuren Einzelstücke und Überfälle auf die zerbrechliche Basis (A6).
- **Luft:** Werte folgen dem Vorbild, bleiben aber ohne K18 (Lähmung) symmetrischer als in FA.

---

## 10. Variantenbewertung

Vor der Auswahl wurden drei Varianten mit verschiedenen Namen und Kernideen entworfen. Skala 1–5 (5 = am besten).

- **Variante A „Aurin“ (Resonanzorden):** Ein Chor formt Metall durch Klang. Die Waffen sind Resonanzstrahlen, die Namen stammen aus der Musik (Kantor, Choral, Kadenz). Rundformen sind Klangkörper, und Ringe tauchen überall auf.
- **Variante B „Ostral“ (Linsenorden):** Ein Orden der Optik bündelt das Licht der Sonne mit Linsen und Prismen. Die Waffen sind Lichtbündel, die Namen stammen aus der Optik (Prisma, Brennglas, Blende). Die Formen sind facettiert und glasig.
- **Variante C „Sael“ (Mondorden, Perlmutt):** Ein Orden auf Kessas Mond sieht die Welt als werdende Perle. Er schichtet statt zu gießen und schwebt aus Achtung vor der Kruste. Die Formen sind Schalen, Perlen und Hörner; die Namen kommen aus Meer und Kloster (§7.2).

| Kriterium | A „Aurin“ | B „Ostral“ | C „Sael“ |
|---|---|---|---|
| **Lesbarkeit** | **3**: Ringe als Klangkörper überall kollidieren mit dem Winkel-Code (Ring = Schild/Flow). Musikbegriffe verraten keine Rolle. | **4**: Prismen und Linsen sind klar, aber facettierte Formen rauschen bei 32 px. | **5**: ein Monopol pro Rolle (Perle+Lanze, Horn, Stachelkranz, Sichel), Wortfelder, die die Rolle **und** das Fahrwerk verraten, Schattensaum als Schweber-Merkmal |
| **Eigenständigkeit ggü. FA** | **2**: Klangwaffen und Chorgesang liegen sehr nah an den Waffen des Vorbilds und an einer geistlich-fremden vierten FA-Fraktion. | **2**: „Licht“ als Leitbegriff steht dem Vorbild zu nah, dessen Lore und Namen stark um Licht kreisen. | **5**: Meer, Perlmutt und Mond kommen in FA nicht vor. Obhut statt Kreuzzug ist ein bewusster Gegenentwurf zur Vorbild-Lore. |
| **Kitbash-Umsetzbarkeit** | **4**: Tori und Kugeln, aber viele Ringe pro Einheit sprengen das Tris-Budget. | **3**: Glas und Transparenz brauchen einen eigenen Materialpfad, Strahlwaffen teure VFX. | **4**: drei neue Primitive (`ellipsoid`, `cone`, `torus`-Bogen) decken alles ab. Kugeln und Tori kosten mehr Tris, deshalb höchstens eine Perle und ein Ring pro Einheit. |
| **Stimmung / Coolness** | **4**: stark im Audio, optisch abstrakt | **4**: elegant und kühl | **5**: bleicher Mond, Saatperle am Lichtfaden, „Perle gesprungen“, Klangschale als Signatur |
| **Passung zur Vorbild-Spielweise** | **4**: Schilde und Präzision passen, Schweben ist nicht begründet. | **4**: Reichweite und Präzision passen perfekt, Schweben nicht. | **5**: Schweben ist Lore („Achtung vor der Kruste“), Schalen begründen starke Schilde, „Maß“ begründet wenige teure Einheiten, Gezeiten begründen Artillerie mit Reichweite. |
| **Kontrast zu Varkan und den anderen Fraktionen** | **3**: Gegenpol zu Varkan, droht aber mit einer spirituell-fremden vierten Fraktion zu verschwimmen. | **4**: klarer Kontrast zu Varkan | **5**: hell gegen dunkel, rund gegen kantig, weit und hallig gegen nah und trocken. Menschlich und klösterlich statt fremd, also auch klar von einer fremdartigen vierten Fraktion getrennt. |
| **Summe** | **20** | **21** | **29** |

### 10.1 Entscheidung

**Gewinner: C „Sael“.** Sael ist am deutlichsten eigenständig und begründet jede Asymmetrie des Vorbilds aus der eigenen Welt (Schweben, Schilde, wenige teure Einheiten, Reichweite). Das Meeresbildfeld macht die Namen zu einer Lesbarkeitshilfe. Die Schwäche (Tris-Kosten runder Primitive) ist über das Budget „eine Perle, ein Ring“ gelöst.

### 10.2 Übernommen aus A „Aurin“

- Klang als Signatur, aber als **Klangschale statt Chor** (§8.2).
- Verstimmter Flow-Grundton beim Stall (Schwebung statt Stottern).
- Die Idee „Hall als Fraktionsmerkmal“ gegen Varkans trockenen Klang (§8.3).

### 10.3 Übernommen aus B „Ostral“

- Präzision als Einzelschuss-Identität (A4) und der kurze Lichtblitz an der Waffenspitze.
- Leuchten der Hornmündung vor dem Schuss als Telegraph (nur View).
- Radar als gekippte Platte, hier als Fächer.

### 10.4 Verworfen

- **A:** Musikbegriffe als Namen, Resonanzstrahlen, Chorgesang (zu nah am Vorbild).
- **B:** „Licht“ als Leitbegriff, facettierte Glasformen, Dauerstrahl-Waffen (VFX-Kosten, Nähe zum Vorbild).
- **C (eigene Vorentwürfe):** „Irrlicht“, „Echo“, „Flut“, „Mole“, „Kormoran“ als Namen (Grep-Treffer in FA), „Stachel“ als AA-Turm (zu nah an Varkans „Stichel“), „Reliquiar“ und „Taufbecken“ (zu konfessionell), Schwebe-Glühen am Modell selbst (verletzt die Lichtregel; ersetzt durch das Schwebelicht-Decal).
- **Review 2026-09-29:** „Krabbe / Crab“ (FA-Einheit „Crab Egg“), „Hummer“ (f2 „Hummel“), „Kegel“ (f2 „Egel“), „Dorn / Thorn“ (f4 „Horn“, f2 „Hawthorn“), EN „Well“ (Varkan EN „Wall“). Ersetzt durch Knallkrebs / Pistol Shrimp, Languste / Langouste, Konus / Conus, Seelilie / Sea Lily, Hochlilie / High Lily, Fountain.

---

## 11. Anhang: Beispiel-Einheiten und offene Punkte

### 11.1 Beispiel-Einheiten (Kurzprofil)

> Startwerte, bis `roster.json` existiert. Referenzen aus `tools/roster/f3/fa_ref.json` (spooky-db 3810). Δ bezieht sich auf die FA-Vorbild-Einheit.

**Kauri / Cowrie (`f3:lnd_t1_tank`)**
- **Silhouette:** tropfenförmige Schale 1,0 × 0,35 × 1,4 WU auf einem Schwebeteller (Schattensaum 10 %), Schwebehöhe 0,25 WU. Mittig schwebt eine teamfarbene Perle (Ø 0,45 WU), aus der eine waagerechte Lanze (0,95 WU, ≈ 68 % der Rumpflänge) über die Tropfenspitze ragt. Goldener Lanzenschaft, Lichtnaht quer am Heck, 1 Tech-Streifen in Tiefjade.
- **Parts (5):** `shell` (Team-Einlage), `hoverpad`, `orb` (Team, Yaw), `lance` (Pitch), `lance` Gold (Schaft, statisch). ≈ 196 Tris. Teamfarbe ≈ 38 %.
- **Icon:** `land_direct_t1`. **Hotkey:** Q.
- **Sim:** HP 170, Mass 54, Energy 270, BuildTime 290, Speed 3,0, `f3:wpn_lance_t1` mit 40 Schaden alle 1,6 s, RW 26 ⇒ DPS 25,0. DPS/Mass 0,463 (±0 %), HP/Mass 3,15 (+9,7 %), Produkt +9,7 %. Kreuz-Breakpoints: 7 Punze-Treffer, 8 eigene Treffer auf die Punze, 2 Vogt-Treffer.
- **Tech-Familie:** Triton (T2): 2 Streifen, größere Perle, zwei parallele Lanzen, Schalenflügel.

**Triton / Triton (`f3:lnd_t2_tank`)**
- **Silhouette:** lange Schale 1,3-fach skaliert, zwei parallele Lanzen aus einer großen Perle, seitliche Schalenflügel, 2 Tech-Streifen. Ab K10 liegt eine dünne Schildhülle (Shader) um die Einheit.
- **Sim:** Mass 360, Energy 1800, BuildTime 1600, Speed 2,7. HP 1300 + Schild 1450 (vor K10: HP 2750; nur 2.731–2.800 hält 40 Meißel-Salven). `f3:wpn_lance_t2` 360 Schaden alle 3,0 s, RW 20 ⇒ DPS 120. DPS/Mass 0,333 (±0 %), (HP+Schild)/Mass 7,64 (±0 %). Breakpoints: 1 Schuss gegen eine Punze, 5 gegen einen Meißel.

**Novize / Novice (`f3:lnd_t1_engineer`)**
- **Silhouette:** kurze, breite Schale ohne Waffe auf einem Schwebeteller, goldene Deckplatte, Tiefjade-Streifen. Eine goldene Sichel läuft vom linken Heck über das Deck nach vorn rechts, an ihrer Spitze sitzt ein Goldkern. Das Schalenrand-Band ist teamfarben.
- **Parts (4):** `shell` (Gold-Deck, Team-Band), `hoverpad`, `sickle` (Gold, Yaw), Emitter (`orb` klein, Glow, umschlossen von der Sichelspitze). Akolyth (T2) hat 2 Sicheln verschiedener Größe, Kustos (T3) 3 Sicheln bei Maßstab 1,4.
- **Sim:** Mass 52, Energy 260, BuildTime 260, Build Power 5, HP 125 (HP/Mass +4,2 % zum Vorbild), Speed 1,9, keine Waffe. Kategorien `LAND MOBILE ENGINEER TECH1 RECLAIM REPAIR`.

**Prior / Prior (`f3:cmd_commander`)**
- **Silhouette:** schwebender Kegelrock (Höhe 2,6 WU, Rockbreite 2,1 WU) mit drei teamfarbenen Bahnen, darüber eine Brustschale und die größte Perle als Kopf. Hinter dem Kopf steht die goldene Halo-Sichel (stärkster Goldkern der Armee), die Lanze liegt mittig waagerecht vor der Brust.
- **Parts (6):** `shell` (Rock, Team), `shell` (Brust), `orb` (Kopf, Yaw), `lance` (Pitch), `sickle` (Gold, Glow), `hoverpad`.
- **Sim:** HP 11000 (Vorbild-Relation, 8 % unter dem Vogt), Mass 2000, Speed 1,7, `f3:wpn_prior_lance` 100 Schaden alle 1,0 s, RW 22. Glanzstoß (U8) mit denselben Konstanten wie Varkans Abstich. Perlsprung wie der Lotbruch (U1).

### 11.2 Offene Punkte

1. **Markenrecherche** zu „Sael“, den Kapitelnamen und den Rufnamen (*Triton* und *Kauri* sind als Produktnamen verbreitet). Der FA-Grep läuft jetzt als Volltext bei jedem Prüferlauf (§7.4) und wird vor dem Einfrieren mit dem dann aktuellen FAF-Stand neu erzeugt.
2. ~~**Unplausible spooky-Werte prüfen**~~ erledigt (`roster.md` §1.1): T1-Artillerie in FAF `develop` bestätigt (200 / 2,0 s, als Stellungsbrecher übernommen, K1-Streuung Pflicht); Abfangjäger war ein spooky-Fehler (zwei Waffen, 48 statt 24 DPS); Bomber 40 DPS ist echt.
3. **Draw-Budget bei Kreuz-Matches:** 56 statt 28 Visuals. Render-Bench mit zwei Fraktionen vor U22 (§3.3).
4. **Hover-Layer:** Schweben ist im MVP nur Optik. Ob Schweber später Hänge anders nehmen als Land-Einheiten, wird mit M13 entschieden.
5. **Personal-Schild-Fallback** des Tritons (HP + Schild zusammengelegt bis MS13) mit dem Balance-Gate MS8/MS9 bestätigen.
6. **Schema-Erweiterung** um die Primitive `ellipsoid`, `cone` und `torus` (Bogen) sowie der Quantisierungsparameter für den Schicht-Dissolve (§3.5, §3.6), als eigener Arbeitsschritt zusammen mit Varkans `ladle`.
7. **Beinpaar-Zahl** der Läufer (3 bzw. 4 Paare) hängt vom prozeduralen `legs`-Pfad ab. Fallback sind Standardbeine; Lesbarkeit trägt dann der breite Rückenschild.
8. **Kreuz-Breakpoints** (§9.4): `checks.crossHitsToKill` ist umgesetzt und wird von `tools/roster/f3/validate.py` gegen Varkans `roster.json` geprüft. Der gemeinsame N×N-Prüfer für alle Fraktionen ist `tools/roster/cross.py` (Kreuz-Treffer, Gruppengefecht, Rush inkl. `rush.py`, Eco, Icons, Namen; `docs/design/factions/README.md` §5).
9. ~~**Namens-Durchgang aller vier Fraktionen**~~ erledigt (`../README.md` §4.3): „Horn“ bleibt bei f4 Einheitenname und bei Sael Part- und Waffenmerkmal derselben Rolle (Artillerie); das ist eine gewollte fraktionsübergreifende Formbedeutung, kein Rufnamen-Konflikt. `cross.py` prüft alle Rufnamen N×N (Abstand ≥ 2). Im Abgleich geändert: Raubmöwe feuert 2 × 75 (Referenz hat zwei Luftkanonen), Brunnen III und Luftkapitel II auf Varkan-Eco.
10. **Streuung in K1:** `weapons[].firingRandomness` trägt FA-Werte; K1 muss die Umrechnung festlegen, das MS7-Abnahmeszenario der Dünung entscheidet über den Fallback 3,0 s (`roster.md` §20.2).
