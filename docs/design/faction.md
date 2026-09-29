# Fraktion: Das Varkan-Kompakt

> **Status:** finales Designkonzept für U3 („Eine spielbare Fraktion (eigenes Design)“). Grundlage ist Konzept 3 „Varkan“, ergänzt um die Lesbarkeitsregeln aus Konzept 2 „Kalder“ und die Glut-, Budget- und Mix-Regeln aus Konzept 1 „Sinter“ (Herleitung in §9).
> **Umfang:** MS9 = 26 Blueprints (Kern, ●), MS14 = 50 Blueprints (●+○). Waffen- und Projektil-BPs sind nicht mitgezählt. Post-MVP kommen 6 Experimentals (T4) dazu: [`experimentals.md`](experimentals.md), `roster.md` §19.
> **Quelle der Zahlen:** `docs/design/roster.json` ist die einzige Quelle für Werte, ●/○-Status, Kitbash-Parts und Maßstäbe; `roster.md` ist daraus generiert, §7.4 und §10.1 hier sind Auszüge. Bei Widerspruch gilt `roster.json`.
> **Mechanik:** Die Fraktion ist ein symmetrischer Allrounder mit FA-naher Mechanik. Das Balancing hält DPS/Mass und HP/Mass innerhalb von ±25 % der FA-Relation (PLAN U3); das Roster zielt strenger auf ±15 % inklusive Produkt und Pulk-DPS/Mass und hält die FA-Treffer-Breakpoints exakt (`roster.md` §14). Die Identität steckt in Optik, Namen, Icons und Klang, nicht in Sonderregeln.
> **Abgrenzung:** keine FA-Namen, keine FA-Lore, keine FA-Designs und keine FA-Assets (DECISIONS, Punkt „Name“). Mechanik-Begriffe der UI bleiben neutral: Mass, Energy, Build Power, Assist, Reclaim, T1–T3.
> **Weitere Fraktionen:** Skarn (f2), Sael (f3) und Aurith (f4) teilen Welt, Icon-Grammatik, Teampalette und Eco mit Varkan; Übersicht, Kreuz-Balance und Asymmetrie-Matrix in `docs/design/factions/README.md`. Im fraktionsübergreifenden Abgleich wurden Stichel (30 Mass / 60 HP), Zapfstelle I (400 HP), Turmfalke (295 HP) und die Elster-Luftkanonen (2 × 70) auf die FA-Relation gesetzt (dort §5.4).

---

## 1. Name

| | DE | EN |
|---|---|---|
| Fraktion (UI-Kurzname) | **Varkan** | **Varkan** |
| Vollname (Lore) | das Varkan-Kompakt | the Varkan Compact |
| Adjektiv | varkanisch | Varkan (attributiv) |
| Welt | Kessa | Kessa |
| Spieleridentität | Haus (Teamfarbe = Bannerfarbe) | House |

- **Aussprache:** „VAR-kan“, Betonung auf der ersten Silbe, in DE und EN gleich. Der Name hat keine Umlaute, ist kein reales Wort und erinnert an Esse und Vulkan. So passt er zu „Flow & Fire“.
- **Häuser:** Jeder Spieler und jede KI ist ein Haus. Namensvorschläge für `aiProfile` und die Match-Anzeige: *Haus Ambrecht, Haus Dorne, Haus Morrant, Haus Tessel, Haus Grauwerk, Haus Leith* (EN *House …*).
- **Offen:** Die Markenrecherche zu „Varkan“ und „Kessa“ gegen bestehende Spiele und Marken steht noch aus (§10.2).

---

## 2. Lore

### 2.1 Kurz-Lore (≈ 135 Wörter, Text für Lobby und Handbuch)

> Kessa ist eine junge Welt mit dünner Kruste, darunter fließt Metall. Das Varkan-Kompakt, ein Bund von Schmelzhäusern, hat sie gemeinsam erschlossen und sich eine einzige Regel gegeben, die Charta: Kein Mensch betritt den Boden, und jede Ader gehört dem Haus, dessen Vogt auf ihr steht.
>
> Die Häuser kreisen in ihren Hütten im Orbit. Um einen Anspruch zu erheben, senken sie ihren Vogt per Lotung hinab: Ein Strahl setzt ein glühendes Lot in den Boden, aus dem sich der Vogt selbst gießt, gelenkt von einem Menschen oben in der Hütte. Alles Weitere gießt der Vogt vor Ort.
>
> Fällt er, bricht das Lot. Der Anspruch erlischt, und die Charta erklärt alles, was das Haus dort gegossen hat, zu Schlacke.
>
> Niemand kämpft aus Hass. Man kämpft, weil die Charta keinen anderen Weg kennt und weil Erz nicht wartet.

### 2.2 Weltregeln: Jede Regel begründet eine Mechanik, die schon im Plan steht

| Weltregel | Mechanik (Feature) | Umsetzung / Text |
|---|---|---|
| **Präsenzpflicht:** Ein Anspruch gilt nur, solange der Vogt am Ort steht. | U1: ACU verloren = Spiel verloren | Niederlage-Text: „Lot gebrochen. Anspruch erloschen.“ / „Plumb broken. Claim void.“ |
| **Lotung:** Ein Orbitalstrahl setzt ein Lot, aus dem sich der Vogt gießt. | Spielstart, P19 (Warp-in, später) | Platzhalter bis P19: Ein glühender Kegel fällt, danach baut sich der Vogt per Build-Dissolve von unten auf (≈ 3 s, nur View). Spielbar ist er ab Tick 0. |
| **Lotbruch:** Der Saatkern hält die Uplink-Energie und entlädt sich beim Tod. | U1: Death-Explosion | tiefer Glockenschlag, Weißblitz, Druckring, Kamera-Shake |
| **Unbemannte Gussautomaten:** Alles außer dem Vogt ist vor Ort gegossene Maschinerie. | Fabriken, Engineers, Reclaim | Wracks sind Rohguss, also Reclaim-Masse: „Schlacke ist auch Erz.“ |
| **Freisprechung:** Die Charta erlaubt feineren Guss erst, wenn eine Werkhalle freigesprochen ist. | U5: Fabrik-Upgrade T1→T2→T3 | Tooltip-Verb für das Upgrade: „Freisprechen“ / „Qualify“ |
| **Ein Vogt pro Anspruch** | ACU ist einzigartig | SACU (U15, Post-MVP) wäre ein „Beivogt / Deputy“ aus einem „Lotwerk / Sounding Works“. |
| **Abstich:** Der Vogt sticht seinen Glutkern kurz an. | U8: Overcharge (optional) | Waffenname „Abstich“ / „Tap Shot“ |
| **Häuser desselben Bundes** | Spiegel-Matches, KI-Gegner | Die KI ist ein rivalisierendes Haus. U19 kann später eine Fraktion *außerhalb* des Kompakts einführen. |

### 2.3 Ton

- **Ja:** knapp, handwerklich, trocken. Arbeiterstolz („sauberer Guss“), leiser Galgenhumor („Schlacke ist auch Erz“), Vertragsdenken („Die Charta sagt …“).
- **Nein:** Heldenpathos, Religion oder Erleuchtung, Cyborg-Horror, Föderations-Militärjargon, Weltrettung. Es gibt keine Bösewichte, die Gegenseite ist nur ein anderes Haus.
- **Beschreibungstexte (`descKey`):** höchstens 2 Sätze. Satz 1 sagt, was die Einheit tut, Satz 2 bringt eine Zeile Gildenflavor.
- **Lore-Synonyme** wie „Erz“ oder „Glut“ stehen nur in Flavor-Texten, nie in Zahlenanzeigen.

### 2.4 Begriffe, die nicht verwendet werden

| Nicht verwenden (FA-Begriffsfeld) | Stattdessen (DE / EN) |
|---|---|
| Armored Command Unit, „Commander“ als Einheitenname | Vogt / Reeve |
| Quantum Gate, Quantum Warp, Warp-in | Lotung / Sounding, Lotwerk / Sounding Works |
| Overcharge | Abstich / Tap Shot |
| nuklearer ACU-Tod | Lotbruch / Plumb Break |
| Infinite War, FA-Fraktions- und Einheitennamen | Fehde / Feud, Charta / Charter |
| „Hydrocarbon Plant“ | Dampfkraftwerk / Geothermal Plant (ID `hydro` bleibt intern) |

Das Feld `faReference` in `roster.json` zitiert FA-Rollenstrings nur zu Entwicklungszwecken (`devOnly: true`). Der Blueprint-Build entfernt es per Lint; es darf nie in `view.json` oder i18n landen.

---

## 3. Designsprache „Gießerei“

### 3.1 Leitmotiv

**Gegossen, nicht geschweißt.** Jede Einheit ist ein gedrungener Gusskörper aus dunklem Eisen. Obenauf liegen lackierte Bannerplatten (Teamfarbe), Kupferleitungen zeigen den Flow, und Glutnähte zeigen das Feuer. Die Formen sind schwer und tief und haben weder Stacheln noch organische Kurven.

### 3.2 Formregeln

| Regel | Umsetzung |
|---|---|
| **Wanne** | Alle Land-Rümpfe sind niedrige, breite Wannen mit 45°-Fasen an den oberen Kanten. Rechte Winkel gibt es nur an Gebäudesockeln. Die Höhe beträgt höchstens 0,45 × Rumpflänge. |
| **Kante = Körper, Rund = Technik** | Rumpf und Sockel sind kantig. Alles, was dreht, zielt oder arbeitet (Glocke, Kelle, Kessel, Schlot, Ring), ist rund. Dieser Kontrast trägt die Lesbarkeit. |
| **Signatur-Formen** | **Glocke** (Halbkugel + Zylinderschürze) = Direktfeuer. **Kelle** (offene Schale) = Artillerie. **Lot** (umgekehrter Kegel + Kugel) = Vogt. Jede dieser Formen gehört genau einer Rolle (§5). |
| **Richtung** | Das Rohr zeigt die Zielrichtung, die gefaste Bugkante der Wanne die Fahrtrichtung. Luftfahrzeuge zeigen die Richtung über ihren Grundriss. |
| **Symmetrie ist die Norm** | Nur Engineers und der Vogt sind asymmetrisch (Kranarm). |
| **Keine Filigranteile** | Kein Teil ist schmaler als 12 % der Einheitenlänge. `iconThreshold` für mobile Einheiten ist 25 px Bildschirmlänge, damit fällt nichts unter 3 px (12 % × 25 px). Konkrete Mindestmaße bei der Punze-Basis (1,4 WU): AA-Rohr Ø ≥ 0,17 WU, Raketenkasten- und Kellenbreite ≥ 0,34 WU (AA-Rohr höchstens halb so dick), Kranarm ≥ 0,17 WU. Details kommen ab MS14 über Textur und Normal Map, nie über Geometrie. |
| **Gebäude** | Jedes Gebäude steht auf einem gefasten Gusssockel (Footprint = Grid). Das Rollen-Element sitzt oben: Pumpenkopf, Kessel mit Schlot, Glocke, Rost, Mast mit Ring oder Kelle. |
| **Placeholder = Final-Silhouette** | Final-Assets ergänzen nur Details wie Fasen, Bolzen und Panel-Linien. Der Umriss darf sich höchstens um 10 % ändern (aus K2). |

### 3.3 Kitbash-Teilekatalog

Die Part-Keys sind englisch (Code), die DE-Namen stehen für Dokumentation und Tooltips. Jeder Part ist ein Low-Poly-Primitiv, das `view.placeholder` prozedural erzeugen kann.

| Part-Key | DE | Primitiv | Tris LOD0 | Verwendung |
|---|---|---|---|---|
| `hull` | Wanne | Box, oben 45° gefast | ≈ 28 | Rumpf aller Landfahrzeuge, Torso des Vogts, Gegengewicht, Raketenkasten der Rinne |
| `tracks` | Kette | 2 schmale Boxen seitlich | ≈ 24 | Kettenfahrwerk |
| `legs` | Beine | prozedural (Render-Pfad, vorhanden) | – | Bots, Vogt |
| `bell` | Glocke | Halbkugel 8×3 + Zylinderschürze | ≈ 56 | Direktfeuer-Turm (Einheiten, Riegel, Schulter des Vogts) |
| `barrel` | Rohr | Zylinder, 6 Seiten | ≈ 24 | Kanone, Flakrohre, Steilrohr des Hochofens |
| `ladle` | Kelle | flacher Zylinder, oben offen (Schale) | ≈ 48 | Artillerie-Turm (Kelle, Pfanne, Tiegel, Hochofen) |
| `plumb` | Lot | umgekehrter Kegel + Kugel | ≈ 40 | Kopf des Vogts, Lotungskapsel |
| `boom` | Ausleger | schmale Box, 2 Glieder | ≈ 24 | Engineer-Kranarm, Rückenkran des Vogts, Kellen-Schwenkarm, Lafette |
| `boiler` | Kessel | Zylinder / Kapsel, liegend oder stehend | ≈ 48 | Pgen, Rumpf der Rinne, Bombenbehälter, Gondeln der Elster, stehende Trommeln des Glutspeichers |
| `stack` | Schlot | stehender Zylinder, emissive Krone | ≈ 24 | **nur Flow-Einheiten** (ECONOMIC, FACTORY, ENGINEER inkl. Vogt): Pgen, Hydro, Pumpenkopf, Fabrik, Rücken des Vogts |
| `grate` | Rost | flache Box, Schlitzmaske | ≈ 12 | AA-Turm, Sieb-Oberseite |
| `mast` | Mast | dünner Zylinder | ≈ 24 | Radar, Schild, Späher |
| `ring` | Ring | flacher Torus 8×3 | ≈ 48 | Schild-Emitter, Mex-Kranz, Hydro, Landescheibe (nie Radar) |
| `wing` | Flügel / Platte | flaches Dreiecks- bzw. Trapezprisma | ≈ 12 | Luft; rechteckige Radarplatte |
| `ductfan` | Ringdüse | flacher Torus mit Scheibe | ≈ 56 | Gunship-Antrieb |

**Budget (Abnahmekriterium):**
- Mobile Einheiten: 4–7 Parts, davon höchstens 2 animiert (Yaw/Pitch im `PartStream`, Limit 8 Parts pro Unit laut PLAN). Strukturen: 4–9 Parts.
- Platzhalter-Mesh ≤ 350 Tris LOD0.
- **Ein Visual pro Rolle = ein Superset-Mesh:** Das Visual vereinigt die Parts aller Tech-Stufen der Rolle (nach Part und Material). Jeder Vertex trägt eine Tech-Bitmaske (T1/T2/T3), der Vertex-Shader kollabiert Parts, die für die Tech der Instanz nicht gelten (Skalierung 0). Größe und Höhe kommen aus der Instanz-Matrix (§3.4). Es bleibt ein Draw pro (Visual, LOD), ohne PartStream-Slots für ausgeblendete Parts. Superset ≤ 8 Parts mobil (PartStream-Limit), ≤ 9 bei Strukturen, ≤ 350 Tris. Das ergibt **28 Visuals** für 50 Blueprints (Liste in `roster.md` §16) und hält das CSM-Draw-Budget (DECISIONS Punkt 17: 40 Visuals ⇒ 309 Draws).

### 3.4 Tech-Skalierung per Kitbash

| Tech | Maßstab mobil | Höhe Strukturen | Tech-Streifen | Zusatz |
|---|---|---|---|---|
| T1 | 1,0 | 1,0 | 1 | Grundform |
| T2 | 1,3 | 1,2 | 2 | zweites Rohr oder breitere Glocke, seitliche Schürzenplatten (`hull`, flach) |
| T3 | 1,7 (bei 1×1-Footprint max. 1,4) | 1,4 | 3 | Doppelaufbau (zweite Glocke, zweiter Arm) oder überlange Wanne; **kein** Heckschlot (Glut-Monopol §3.5) |

- **Mobil:** uniformer Maßstab laut Tabelle. Mobile T3 auf 1×1 (Meister, Reißnadel, Trommelsieb) bleiben bei 1,4, damit sie ihre Pathing-Zelle nicht grob überragen.
- **Strukturen:** Der Sockel füllt immer 100 % des Footprints. Horizontal gilt xz = Footprint-Kante / Footprint-Kante der niedrigsten Stufe des Visuals, vertikal y = xz × Höhenfaktor relativ zur Basisstufe. In-Place-Upgrades (Zapfstelle, Werke, Horcher, Schirm) wachsen also nur in der Höhe; Neubauten mit größerem Footprint (Glutkessel II 6×6 = 3,0, Glutkessel III 8×8 = 4,0, Riegel II/Rost II/Hochrost 2×2 = 2,0, Hochofen 8×8 = 4,0) füllen mindestens 70 % der Footprint-Kante. Die Werte stehen je Blueprint in `kitbash.scale`.
- T3 erkennt man an Maßstab bzw. Höhe, Zusatz-Parts und 3 Streifen, nicht an einem Schlot.

**Tech-Streifen** sind 1–3 Querstreifen auf dem hinteren Deck, umgesetzt als Maske und nicht als Geometrie. Maß: Breite 0,10 WU × Maßstab, Abstand 0,10 WU, im hinteren Drittel des Decks (bei 48 px Silhouette ≈ 3,4 px pro Streifen). Sie sind keramikweiß; bei Engineers, deren Deck selbst Keramik ist, graphit `#1E1C1B`. Vogt und Mauer tragen keine Streifen. Die Zahl entspricht exakt den Tech-Kerben im Icon (§6.4). Das ersetzt die dünnen `band`-Ringe aus K3, die die Mindestgröße verletzt hätten.

### 3.5 Glut als Spielinformation (nur View, kein Sim-Einfluss)

Es gibt zwei Glut-Klassen. Das verbindet die Glutnähte aus K3 mit dem Glut-Monopol aus K2:

| Klasse | Wer | Fläche | Bedeutung |
|---|---|---|---|
| **Glutnaht** | alle Einheiten | ≤ 2 % der Oberfläche: schmale Schlitze an Heck, Lüftung, Mündung | Zustand der Einheit |
| **Glutkern** | nur **Flow-Einheiten**: Vogt, Engineers, Fabriken, Mex, Pgen, Hydro | 3–6 %: Emitter, Schlotkrone, Werkhallentor, Pumpenkopf | „Hier entsteht oder fließt Wirtschaft“ |

Kampfeinheiten tragen nie einen Glutkern. Ein großer leuchtender Punkt auf dem Feld bedeutet also immer Ökonomie oder Bau. Weil der `stack` eine emissive Krone hat, gilt das auch für ihn: Schlote gibt es nur bei ECONOMIC, FACTORY und ENGINEER (Lint im Roster-Generator und später im Blueprint-Compiler).

**Zustände über den View-Parameter `flowGlow`:**
- Leerlauf: Nähte glimmen schwach.
- Feuern: kurzer Puls an Mündung und Heck. Die Kelle glüht nur beim Schuss auf (≈ 0,5 s).
- Bauen: Ausleger-Emitter und Werkhallentor glühen auf.
- **Energy-Stall (E3):** Glutkerne aller betroffenen Verbraucher erkalten sichtbar auf Dunkelrot. So ist der Flow-Zustand ohne HUD im Feld lesbar (aus K1).
- Schaden < 50 % HP: Nähte flackern.
- Wrack: kalt, ohne Emissive, Rostton (Wreck-Shader).

**Bau und Reclaim:**
- **Baustrahl = Gießstrom:** Der Nano-Strahl von Vogt, Engineers und Fabriken ist ein durchgehender, fließender Partikelstrom in Glutfarbe, keine gepunktete Linie. Seine Dichte skaliert mit der tatsächlich fließenden Build Power nach Stall-Drosselung (E2/E3).
- **Bau-Dissolve = Gießen:** Rohbauten füllen sich glühend von unten nach oben. Die Glutkante zeigt `buildDone` (vorhandener Build-Dissolve-Shader mit Glutrand).
- **Reclaim:** Das Wrack schmilzt von oben in einen Glutstrom zum Engineer ein, spiegelbildlich zum Bauen.
- **Budget:** kein Extra-Pass, nur HDR/Bloom der Presets. Auf Low (LDR, ohne Bloom) wird die Glut über vollgesättigte Farbe erkennbar.

### 3.6 Placeholder-Schema-Erweiterung (Vorschlag, nicht Teil dieses Dokuments)

Das heutige `PlaceholderSchema` (`packages/blueprints/src/schema.ts`) kennt nur `hull: 'box' | 'cyl'`, `size` und `color`. Für MS9 wird eine rückwärtskompatible Erweiterung vorgeschlagen:

```ts
placeholder: {
  hull: 'box', size: [1.0, 0.4, 1.4],          // bleibt als Fallback gültig
  parts?: [{ part: PartKey, at: [x,y,z], size: [x,y,z], rot?: [yaw,pitch,roll],
             mat: 'body'|'team'|'copper'|'glow'|'ceramic', parent?: string, anim?: 'yaw'|'pitch'|'tilt' }],
  tech?: 1 | 2 | 3,                            // Zahl der Tech-Streifen
}
```

Das Feld liegt nur im View, betrifft also `viewHash` und nicht `simHash`. Die Umsetzung braucht eine Änderung im Blueprint-Compiler und ist ein eigener Arbeitsschritt.

---

## 4. Farben & Teamfarben

### 4.1 Materialien

| Slot (`matId`) | Material | Farbe (linear, Richtwert) | Charakter | Anteil |
|---|---|---|---|---|
| 0 `body` | Gusseisen | Graphit `#2E2B29`, Unterseiten `#1E1C1B` | Roughness 0,85, matt, Flat Shading | 40–50 % |
| 1 `team` | lackierte Bannerplatte | Teamfarbe | Roughness 0,6, matt | 25–40 % |
| 2 `copper` | Kupfer | `#B06A3B`, Grünspan-Kanten `#4F8C7A` | Metallic 0,8 | 8–12 % |
| 3 `glow` | Glut (emissive) | Kern `#FFD9A0`, Falloff `#FF8A2A`, HDR 3–6 | pulsiert nach `flowGlow` | 2–6 % |
| 4 `ceramic` | Keramik-Hitzeschild | Knochenweiß `#CFC6B4` | halbmatt | Tech-Streifen, Engineer-Deckplatte, Bauarm |

- **Hell oben, dunkel unten:** Oberseiten sind teamfarben oder keramikweiß, Unterseiten, Fahrwerk und Rohre sind dunkel. So hebt sich die Einheit ohne Outline vom Terrain ab (aus K2).
- **Keramik als Klassenkennung:** Keramikweiße Oberplatten tragen nur Engineers und der Bauarm des Vogts. Sonst erscheint Keramik nur als Tech-Streifen.
- **Masken-Layout:** Platzhalter bekommen `u8 matId` pro Vertex. Der Shader setzt Slot 1 auf die Teamfarbe und Slot 3 auf Emissive. Finale Assets (MS14) nutzen eine RGBA-Maske mit R = Team, G = Glut, B = Kupfer/Metallic, A = Ruß/AO. Platzhalter und Final-Art laufen damit durch denselben Shaderpfad.
- **Ruß-Gradient:** Die oberen 20 % jedes `stack` verlaufen im Shader nach Schwarz, per Höhe über dem Part und ohne Textur.

### 4.2 Teamfarben-Flächen

| Klasse | Teamfarbe auf | Mindestanteil an der Draufsicht (Standardkamera 40–60°) |
|---|---|---|
| Mobile Land | Wannen-Deckplatte hinter der Bugfase, Glockenschürze bzw. Kellen-Außenseite | **≥ 30 %** |
| Luft | gesamte Flügeloberseite | **≥ 45 %** |
| Vogt | Schulterplatten, Torso-Deckplatte, ein Brustband | ≥ 35 % |
| Engineers | Wannen-Seitenband und Kessel-Bauchband (der Kessel ist Team-Part, das Deck Keramik, der Kranarm Kupfer) | ≥ 25 % |
| Strukturen | Randband des Dachs, bei Fabriken zusätzlich das Dachzentrum | 20–30 % |
| Mauern | nur die schmale Oberkante | ≈ 10 % (bewusst ruhig) |

- **Nie teamfarben:** Glutnähte, Keramik, Rohre, Unterseiten. Seitenflächen sind nur beim Vogt (Brustband) und bei Engineers (Seitenband) teamfarben.
- **Messung:** Der Anteil wird automatisch geprüft, entweder aus der Parts-Spec (Draufsichtfläche mit `mat:'team'`) oder im Render-Bench per Masken-Pixelzählung. Vorab-Lint: Jeder Blueprint hat mindestens einen Part mit `mat:'team'` (bei AA-Stellungen der `grate`, beim Funken die Wanne).

### 4.3 Teampalette (8 Farben)

| Rot | Blau | Grün | Violett | Cyan | Orange | Pink | Oliv |
|---|---|---|---|---|---|---|---|
| `#C8372D` | `#2F6FD0` | `#3E9A4A` | `#7A4CC2` | `#27A6B5` | `#E07A1F` | `#D0569A` | `#8A8F2E` |

- **Verboten** sind Blassgelb (Kollision mit Glut), Weiß (Kollision mit Keramik), Schwarz und Grau (Kollision mit Graphit).
- **Glut-Konflikt:** Liegt der Farbton einer Teamfarbe weniger als 25° von der Glut (≈ 27°) entfernt, wechselt die Glut dieser Armee im Shader auf **Weißglut** `#FFE9C0` mit weniger Sättigung. Das betrifft in der Standardpalette Orange und Rot. Die Palette bleibt dadurch in A3 frei wählbar (aus K1).
- **Farbenblindheit:** Rolle und Tech liegen immer in Form, Glyphe und Strichzahl, nie nur in der Farbe. Die Teamfarbe unterscheidet nur die Häuser. Farbenblind-Paletten folgen mit P16.

---

## 5. Silhouetten-Regeln

### 5.1 Die sechs Lesbarkeits-Gesetze

1. **Draufsicht zuerst.** Jede Rolle ist als schwarzer Schattenriss aus der Spielkamera (≈ 50° Neigung) bei 32 px und 48 px eindeutig.
2. **Monopol-Merkmal.** Jede Rolle hat genau **ein** exklusives Formmerkmal (Hero-Feature). Keine andere Rolle darf es tragen (Tabelle 5.2).
3. **Rolle am Aufbau, Tempo am Fahrwerk.** Die Rolle liest man immer am Turm-Part. Kette oder Beine zeigen nur Tempo und Gelände: Bots sind schnell und haben wenig HP, Kettenfahrzeuge halten die Linie.
4. **Tech durch Skalierung, nicht durch neue Form** (§3.4). Die Rollen-Silhouette bleibt über alle Tech-Stufen gleich.
5. **Winkel-Code:** waagerecht = direkt, schräg = indirekt (Raketenkasten 50°), senkrecht = gegen Luft (≥ 75°, also ≥ 25° steiler als jede indirekte Waffe), Ring = Flow-Anschluss oder Schild, Mast = Intel (Radar mit Platte, nie mit Ring). Eine Form bedeutet mobil und stationär dasselbe.
6. **Nichts unter 3 px** bei `iconThreshold` (mobil 25 px, §3.2).

### 5.2 Rollen-Tabelle (MVP)

| Rolle | **Hero-Feature (Monopol)** | Pflicht | Verboten |
|---|---|---|---|
| **Direktfeuer (Panzer, Bot)** | **Glocke** mit **waagerechtem** Rohr | Rohr ≥ 60 % der Rumpflänge, ragt über den Bug hinaus | Rohr steiler als 15° im Leerlauf |
| **Sniper-Bot (T3)** | Glocke mit **extrem langem** waagerechtem Rohr (≥ 1,2 × Rumpflänge) | schlanke Beine | zweites Rohr |
| **Artillerie** | **offene Kelle** auf Schwenkarm (T1, T3, statisch T2/T3) bzw. **ein breiter Raketenkasten** 0,5 × 0,25 × 1,1 WU bei 50° (T2-Raketen, Rinne) | Gegengewicht am Heck, Rumpf ≥ 1,3× länger als breit; Raketenkasten ≥ 2× so breit wie ein AA-Rohr | Glocke, waagerechtes Rohr, dünne Rohrbündel |
| **Flugabwehr** | **2–4 dünne, senkrechte Rohre** (≥ 75°) als Kamm quer zur Fahrtrichtung, oder `grate`-Platte | Rohre höchstens halb so dick wie Kellenrohr/Raketenkasten, Ø ≥ 0,17 WU | einzelnes dickes Rohr, Kelle, Glocke |
| **Engineer** | **Kranarm** (`boom`, Kupfer) diagonal über dem Deck + **Keramik-Deckplatte**, Glutkern an der Armspitze | asymmetrisch; Anzahl der Arme = Tech (1/2/3, verschieden lang); Kessel mit teamfarbenem Bauchband | jede Waffenform, Turm mittig |
| **Land-Späher** | kleinster Rumpf + hoher dünner `mast` | Mast ≥ 1,0 × Rumpflänge, ohne Kopfteil | Turm, Ring, alles Breite |
| **Mobiler Schild** | `mast` mit **waagerechtem `ring`** als höchstem Punkt | Ring Ø ≥ 1,2 × Rumpfbreite | Rohr, Glocke |
| **Vogt** | **Lot-Kopf** auf Bot-Beinen, größte Landeinheit bis T2 (Höhe ≥ 2,4 WU, Schulterbreite ≥ 2,0 WU), **Schlot im Rücken** (stärkster Glutpunkt) | Glocke mit Rohr auf der **rechten Schulter**, Keramik-**Rückenkran** über die linke Schulter | Waffenarm rechts + Bauarm links (FA-ACU-Schema) |
| **Abfangjäger** | **schmales, stark gepfeiltes Delta** | lang > breit, 2 Glutdüsen hinten | breite Flügel, Kessel |
| **Bomber** | **gerader Breitflügel** + Bauch-`boiler` (T-Form von oben) | breit ≥ lang; Kessellänge ≥ 1,4 × Flügeltiefe, ragt vorn und hinten sichtbar über | Pfeilung > 30° |
| **Gunship** | **keine Flügel**, `ductfan` + Glocke unten (Scheibenform) | – | Flügel |
| **Jagdbomber (T2)** | Delta mit **zwei Kessel-Gondeln an den Flügelspitzen** | Spannweite +30 % gegenüber Abfangjäger | Ringdüse, Bauch-Kessel (von oben unsichtbar) |
| **Luft-Späher** | kleinster Flieger, einzelnes Seitenleitwerk | – | Waffen-Parts |
| **Mex** | `ring` um den Spot + zentraler Pumpenkopf (Glutkern) | niedrig, bleibt auf 2×2; T3 mit doppeltem Kranz | Heckschlot |
| **Pgen** | liegender `boiler` mit 1–3 `stack` (Zahl = Tech) | Glutkronen, Schlothöhe ≥ 1,5 × Kessel-Ø | – |
| **Hydro** | `ring` mit drei stehenden `stack` darin | – | – |
| **Storage** | niedrige Stapel: Mass **eckig** (`hull`), Energy **zwei stehende, flache Trommeln** (Ø 0,8 × Kante, Höhe ≤ 0,3 × Kante) | flach | Schlot, liegender Kessel |
| **Fabrik** | **U-Portal** (offene Seite = Ausgang); Land mit Rampe, Luft mit Landescheibe | Werkhallentor = Glutkern | – |
| **Punktverteidigung** | **dieselbe Glocke** wie der Panzer auf einem Sockel | – | – |
| **AA / SAM** | senkrechte Rohre auf teamfarbenem `grate` auf dem Sockel; SAM mit doppelt so vielen, dickeren Rohren | – | Schlot |
| **Artillerie T2/T3 (statisch)** | große Kelle auf Lafette (Tiegel); Hochofen = Tiegel-Silhouette auf 8×8 mit Kelle Ø 3,0 WU und Steilrohr 7 × 0,6 WU aus der Kelle | Gegengewicht | Glocke, Schlot |
| **Radar** | **rechteckige, 35° gekippte Platte** (`wing`-Prisma 1,6 × 0,8 × 0,1 WU) auf `mast` | hoch und dünn | Ring |
| **Schildgenerator** | `mast` mit **waagerechtem `ring`** | Ring Ø ≥ 0,8 × Footprint-Kante | Platte |
| **Mauer** | niedrige Quaderkette, nur die Oberkante teamfarben | – | – |

**Pflicht-Paartest MS9 (nur ●-Blueprints):** Punze↔Sieb, Kelle↔Sieb, Rinne↔Rüttelsieb, Meißel↔Rinne, Lehrling↔Funke, Riegel↔Rost, Zapfstelle↔Glutkessel, Glutkessel↔Glutspeicher, Erzspeicher↔Glutspeicher.
**Pflicht-Paartest MS14:** Dohle↔Turmfalke, Turmfalke↔Elster, Lerche↔Dohle, Horcher↔Schirm, Funke↔Schürze, Hochofen↔Glutkessel III, Zapfstelle III↔Dampfquelle. (Maschinenlesbar: `roster.json` → `silhouettePairs`.)

### 5.3 Abnahme (Vorschlag für den MS9-Punkt „lesbare Silhouetten“)

1. **Silhouettenblatt:** Alle ●-Blueprints als schwarze Schattenrisse aus der Spielkamera bei 32 px und 48 px, dazu das Profil bei 180 WU (LOD-Grenze). 5 Tester, Rollen-Trefferquote ≥ 90 %. Die MS9-Paare aus §5.2 müssen 5 von 5 Testern unterscheiden.
2. **Graustufen-Aufsicht bei 60 WU:** Die Rolle ist ohne Teamfarbe und ohne Icon benennbar.
3. **Teamfarben-Anteil** nach §4.2, automatisch gemessen.
4. **Kitbash-Budget** nach §3.3, inklusive Superset pro Visual.
5. **Monopol-Lint (später im Blueprint-Compiler):** Nur `aa`/`sam` enthalten senkrechte `barrel` (≥ 75°). Nur `arty`/`mml` enthalten `ladle` oder schräge Starter (`barrel`/`hull`) mit Pitch über 30° und unter 75°. Nur `bell` + waagerechtes `barrel` ergibt Direktfeuer. `stack` und `mat:'glow'` nur bei ECONOMIC, FACTORY, ENGINEER (§3.5). Mindestens ein `mat:'team'`-Part pro Blueprint (§4.2). (Aus K2, erweitert nach Review.)

---

## 6. Strategic-Icon-Sprache (MSDF)

### 6.1 Aufbau

Ein Icon hat drei Schichten und wird im IconPass als **ein Draw** aus einem MSDF-Atlas zusammengesetzt. Der Atlas hält Formen, Glyphen und Striche getrennt (7 Grundformen, 19 Glyphen, 3 Kerben-Varianten).

1. **Grundform** = Domäne, in Teamfarbe gefüllt, mit 2 px Graphit-Kontur (`#101010`, 80 % Deckkraft).
2. **Glyphe** = Rolle, keramikweiß mit 1 px dunklem Halo, höchstens 60 % der Fläche. Bei sehr hellen Teamfarben (Luma > 0,7) kippt die Glyphe auf dunkel (Kontrast ≥ 4,5 : 1, pro Palettenfarbe vorberechnet).
3. **Tech-Kerben** = Stufe, 1–3 kurze senkrechte Kerben **oben rechts außerhalb** der Grundform.

**Raster:** 32 × 32 Designeinheiten (DE), Mindeststrichstärke **5 DE** (bei 20 px Basis ist 1 DE = 0,625 px, 5 DE ≈ 3,1 px), Glyphe im zentralen 16 × 16-Feld, keine spitzen Winkel unter 35° (sonst fransen die MSDF-Kanten aus). Atlas-Zelle 64 px.

### 6.2 Grundformen (Domäne)

| Domäne | Form | Gedanke |
|---|---|---|
| Land mobil | **Quadrat mit Fase ≤ 4 DE** (≤ 12,5 % der Kante, klar eckig) | entspricht der gefasten Wanne |
| Luft | **Dreieck, Spitze oben**, dreht nicht mit der Flugrichtung | Flugrichtung |
| Engineer (alle Tech, Land) | **Kreis Ø 28 DE** | eigene Bauklasse, in Box-Selects sofort erkennbar; bei 20 px vom Quadrat unterscheidbar |
| Gebäude | **Sechseck**, Spitze oben | Gusssockel |
| Vogt | **Lot-Tropfen** (Spitze unten), 1,6× | einzigartig, ohne Tech-Kerben |
| Mauer | Mini-Quadrat, 50 % Größe, ohne Glyphe | vermeidet Rauschen |
| Marine (Post-MVP) | reserviert: Halbkreis/Wanne | – |

### 6.3 Glyphen (Rolle)

| Token | Glyphe | Rolle | verwendet bei |
|---|---|---|---|
| `direct` | Punkt ● | Direktfeuer | Panzer, Riegel, Gunship |
| `bot` | Punkt + 2 kurze Beinstriche (5 DE stark) | Direktfeuer-Läufer | Stichel, Zange, Fallhammer (`land_bot_t1..t3`) |
| `sniper` | Punkt mit Querstrich —●— | Präzision | Reißnadel |
| `arty` | Bogen ⌒ | Artillerie | mobile und statische Artillerie |
| `mml` | Doppel-Bogen ⌒⌒ | Raketenartillerie | Rinne |
| `aa` | Chevron ^ | Flugabwehr | Sieb, Rost, Abfangjäger |
| `sam` | Doppel-Chevron ^^ | Raketen-Flugabwehr | Hochrost |
| `bomb` | Chevron v | Luft-gegen-Boden | Bomber |
| `fbomb` | Sanduhr: ^ über v, je 6 DE hoch, 2 DE Abstand | Jagdbomber | Elster |
| `build` | Plus + | Bauen | Engineers (Vogt nutzt seine eigene Grundform ohne Glyphe) |
| `intel` | Ring ○ | Aufklärung / Radar | Funke, Lerche, Horcher |
| `shield` | Kuppel ∩ | Schild | Schürze, Schirm |
| `mass` | Raute ◆ | Mass erzeugen | Zapfstelle |
| `energy` | Flamme (Tropfen aufwärts) | Energy erzeugen | Glutkessel |
| `hydro` | Flamme mit Welle darunter | Energy aus Spot | Dampfquelle |
| `mstore` | Raute **hohl** | Mass lagern | Erzspeicher |
| `estore` | Flamme **hohl** | Energy lagern | Glutspeicher |
| `fac_land` | Mini-Kachel | Landfabrik | Landwerk (Rahmen dessen, was gebaut wird) |
| `fac_air` | Mini-Dreieck | Luftfabrik | Luftwerk |

**19 Tokens** (maschinenlesbar: `roster.json` → `iconGlyphs`); Vogt und Mauer haben keine Glyphe. **Systematik:** Raute = Mass, Flamme = Energy, **gefüllt = erzeugen, hohl = lagern** (Prinzip aus K2). Das Fabrik-Glyph ist die Grundform der Domäne, die die Fabrik baut. Die Beinstriche von `bot` trennen Raider-Bots im Strategic Zoom von der Panzerlinie.

### 6.4 Tech-Kerben

- 1, 2 oder 3 kurze senkrechte Kerben (**5 × 9 DE**, Abstand 3 DE) oben rechts **außerhalb** der Grundform. Dadurch sind sie nicht mit der AA-Glyphe verwechselbar.
- Auch T1 bekommt eine Kerbe. Die Zahl entspricht den Tech-Streifen am Modell (§3.4).
- Keine Kerben bei Vogt und Mauer. Experimentals (Post-MVP, `_t4`) bekommen statt der Kerben eine keramikweiße eckige Klammer „[ ]“ links und rechts der Grundform (4 DE Strich, Graphit-Halo), Faktor 1,5; am Modell entspricht ihr die Keramik-Klammer statt der Tech-Streifen. Details: [`experimentals.md`](experimentals.md) §3.5–3.6.

### 6.5 Größe und Zustände

| Klasse | Faktor (Basis 20 px × UI-Skalierung) |
|---|---|
| T1 / T2 / T3 mobil | 1,0 / 1,15 / 1,3 |
| Gebäude | 1,1 (T3-Artillerie 1,3) |
| Späher (Funke, Lerche) | 1,0 (Glyphe und Kerben müssen ≥ 3 px bleiben) |
| Mauer | 0,6 (ohne Glyphe und Kerben) |
| Vogt | 1,6 |
| Experimentals (T4, Post-MVP) | 1,5 (Klammer statt Kerben) |

- **Auswahl:** weißer Außenring, 2 px, ohne Formänderung.
- **Radar-Blip (I3):** nur drei Konturen in Neutralgrau, ohne Füllung, Glyphe und Kerben, einheitlich Faktor 1,0: **Achteck** für alles Mobile am Boden (auch Engineers und Vogt), **Dreieck** für Luft, **Sechseck** für Gebäude. So verrät der Blip weder Rolle noch Tech noch den Vogt-Standort (MS10-Abnahme „Blip-Records verraten nie den Blueprint“).
- **Ghost (I2):** Sechseck mit 45–50 % Alpha, entsättigt, gestrichelte Kontur per MSDF-Distanz im Shader (kein eigener Atlas-Eintrag), Glyphe sichtbar.
- **Im Bau:** Die Grundform ist nur Kontur und füllt sich von unten mit dem Baufortschritt.
- **Beschädigt < 30 % HP (optional):** Die Kontur pulsiert rot.
- **Farbenblindheit:** Die ganze Information steckt in Form, Glyphe und Kerben.

### 6.6 Icon-IDs

Schema `<form>_<glyph>_t<n>`, kompatibel zum `icon`-Feld aus PLAN §3.9 (`land_direct_t1`). Formen: `land`, `air`, `eng`, `struct`, `cmd`, `wall`.
Beispiele: `land_direct_t1`, `land_bot_t1`, `land_arty_t1`, `land_mml_t2`, `land_aa_t1`, `land_sniper_t3`, `eng_build_t2`, `air_aa_t1`, `air_bomb_t1`, `air_direct_t2`, `struct_mass_t2`, `struct_mstore_t1`, `struct_fac_land_t3`, `struct_sam_t3`, `cmd_commander`, `wall`.

---

## 7. Namenssystem

### 7.1 Regeln

1. **Mobile Einheiten tragen einen Rufnamen** aus dem Wortfeld ihrer Rolle. Die Namen sind echte, übersetzte Wortpaare in DE und EN (keine Lehnwörter), je ein Wort, möglichst ≤ 9 Zeichen.
2. **Jede Tech-Stufe einer Rolle bekommt einen neuen Namen aus demselben Wortfeld**, kein „Mk II“. Das Wortfeld verrät die Rolle, der Name die Stufe.
3. **Gebäude heißen nach ihrer Funktion und tragen eine römische Stufe** (Glutkessel II). In-Place-Upgrades (B4, B8) behalten so ihre Identität.
4. **Anzeige:** Die UI zeigt den Rufnamen und darunter die übersetzte Funktionsrolle, zum Beispiel **Punze** · *Kampfpanzer* / **Punch** · *Battle Tank*. Tooltips und Baumenü zeigen immer beides.
5. **Verboten:** FA-Einheitennamen, FA-Fraktionsbegriffe und Eigennamen aus FA-Lore sowie Namen, die einem bekannten Produkt oder Warenzeichen gleichen. Vor dem Einfrieren wird eine **Grep-Liste** der FA-Namen gegen alle `name`-Strings geprüft (Beispiel: „Swift“ wurde bereits verworfen).

### 7.2 Wortfelder

| Rolle | Wortfeld | Namen |
|---|---|---|
| Vogt | Amtstitel | Vogt / Reeve |
| Engineers | Gildenstufen | Lehrling → Geselle → Meister |
| Direktfeuer Land | Schmiedewerkzeug | Punze, Stichel, Meißel, Zange, Fallhammer, Reißnadel |
| Artillerie | Gießgerät | Kelle, Rinne, Pfanne, Tiegel, Hochofen |
| Flugabwehr | Siebe und Roste | Sieb, Rüttelsieb, Trommelsieb, Rost, Hochrost |
| Luft | Schornsteinvögel | Lerche, Turmfalke, Dohle, Krähe, Elster |
| Aufklärung / Intel | Funken, Horchen | Funke, Horcher |
| Schild | Schutzkleidung der Gießer | Schürze, Schirm |
| Experimentals (T4, Post-MVP) | größtes Gerät des Rollen-Wortfelds | Stampfe, Kokille, Kolkrabe, Konverter, Mantel; Gebäude-Funktionsname Tiefenstich ([`experimentals.md`](experimentals.md) §3.7) |

### 7.3 Unit-IDs und i18n

- **Schema:** `core:<domäne>_t<n>_<rolle>`, Domänen `cmd | lnd | air | str` (`nav` reserviert für Post-MVP). Die IDs sind rein funktional und lore-neutral, damit Mods und eine zweite Fraktion dieselbe Systematik nutzen können. Der Vogt als Einzelstück hat keine Tech-Stufe: `core:cmd_commander`.
- **Rollen-Token (mobil):** `engineer`, `scout`, `bot`, `tank`, `arty`, `mml`, `aa`, `shield`, `sniper`, `fighter`, `bomber`, `fbomber`, `gunship`.
- **Rollen-Token (Struktur):** `mex`, `pgen`, `hydro`, `mstore`, `estore`, `fac_land`, `fac_air`, `pd`, `aa`, `sam`, `arty`, `wall`, `radar`, `shield`.
- **Waffen:** `core:wpn_<typ>_t<n>`, z. B. `core:wpn_cannon_t1`, `core:wpn_slag_mortar_t1`, `core:wpn_reeve_tapshot`.
- **i18n-Keys** wie in PLAN §3.9: `unit.core.<id>.name` (Rufname), `.role` (Funktionsrolle, neu) und `.desc` (2 Sätze). Umlaute stehen nur in DE-Strings, IDs sind reines ASCII.

### 7.4 Roster (● = MS9-Kern, ○ = bis MS14)

Auszug aus `roster.json` (einzige Quelle; Werte, Kitbash und Balance in `roster.md`).

| | ID | DE | EN | Rolle DE / EN | Icon | Hotbuild |
|---|---|---|---|---|---|---|
| ● | `core:cmd_commander` | Vogt | Reeve | Kommandant / Commander | `cmd_commander` | – |
| ● | `core:lnd_t1_engineer` | Lehrling | Prentice | Ingenieur / Engineer | `eng_build_t1` | Landwerk: E |
| ● | `core:lnd_t2_engineer` | Geselle | Journeyman | Ingenieur / Engineer | `eng_build_t2` | Landwerk: E |
| ○ | `core:lnd_t3_engineer` | Meister | Master | Ingenieur / Engineer | `eng_build_t3` | Landwerk: E |
| ● | `core:lnd_t1_scout` | Funke | Spark | Späher / Scout | `land_intel_t1` | Landwerk: A |
| ● | `core:lnd_t1_bot` | Stichel | Graver | Leichter Sturmläufer / Light Assault Bot | `land_bot_t1` | Landwerk: S |
| ● | `core:lnd_t1_tank` | Punze | Punch | Kampfpanzer / Battle Tank | `land_direct_t1` | Landwerk: Q |
| ● | `core:lnd_t1_arty` | Kelle | Ladle | Mobile Artillerie / Mobile Artillery | `land_arty_t1` | Landwerk: W |
| ● | `core:lnd_t1_aa` | Sieb | Sieve | Mobile Flugabwehr / Mobile AA | `land_aa_t1` | Landwerk: R |
| ● | `core:lnd_t2_tank` | Meißel | Chisel | Schwerer Panzer / Heavy Tank | `land_direct_t2` | Landwerk: Q |
| ● | `core:lnd_t2_mml` | Rinne | Runner | Raketenwerfer / Missile Launcher | `land_mml_t2` | Landwerk: W |
| ● | `core:lnd_t2_aa` | Rüttelsieb | Riddle | Flak / Flak | `land_aa_t2` | Landwerk: R |
| ○ | `core:lnd_t2_shield` | Schürze | Apron | Mobiler Schild / Mobile Shield | `land_shield_t2` | Landwerk: D |
| ○ | `core:lnd_t2_bot` | Zange | Tongs | Sturmläufer / Assault Bot | `land_bot_t2` | Landwerk: S |
| ○ | `core:lnd_t3_bot` | Fallhammer | Drophammer | Belagerungsläufer / Siege Bot | `land_bot_t3` | Landwerk: S |
| ○ | `core:lnd_t3_arty` | Pfanne | Pour Pan | Schwere Artillerie / Heavy Artillery | `land_arty_t3` | Landwerk: W |
| ○ | `core:lnd_t3_sniper` | Reißnadel | Scriber | Präzisionsläufer / Sniper Bot | `land_sniper_t3` | Landwerk: F |
| ○ | `core:lnd_t3_aa` | Trommelsieb | Trommel | Schwere Flugabwehr / Heavy AA | `land_aa_t3` | Landwerk: R |
| ○ | `core:air_t1_scout` | Lerche | Lark | Aufklärer / Air Scout | `air_intel_t1` | Luftwerk: A |
| ○ | `core:air_t1_fighter` | Turmfalke | Kestrel | Abfangjäger / Interceptor | `air_aa_t1` | Luftwerk: Q |
| ○ | `core:air_t1_bomber` | Dohle | Jackdaw | Bomber / Bomber | `air_bomb_t1` | Luftwerk: W |
| ○ | `core:air_t2_gunship` | Krähe | Crow | Kampfschweber / Gunship | `air_direct_t2` | Luftwerk: E |
| ○ | `core:air_t2_fbomber` | Elster | Magpie | Jagdbomber / Fighter-Bomber | `air_fbomb_t2` | Luftwerk: R |
| ● | `core:str_t1_mex` | Zapfstelle I | Tap I | Massebohrung / Mass Extractor | `struct_mass_t1` | Bau: Q |
| ● | `core:str_t2_mex` | Zapfstelle II | Tap II | Massebohrung / Mass Extractor | `struct_mass_t2` | Bau: Q (Upgrade: Command Card) |
| ○ | `core:str_t3_mex` | Zapfstelle III | Tap III | Massebohrung / Mass Extractor | `struct_mass_t3` | Bau: Q (Upgrade: Command Card) |
| ● | `core:str_t1_pgen` | Glutkessel I | Ember Boiler I | Kraftwerk / Power Generator | `struct_energy_t1` | Bau: W |
| ● | `core:str_t2_pgen` | Glutkessel II | Ember Boiler II | Kraftwerk / Power Generator | `struct_energy_t2` | Bau: W |
| ○ | `core:str_t3_pgen` | Glutkessel III | Ember Boiler III | Kraftwerk / Power Generator | `struct_energy_t3` | Bau: W |
| ● | `core:str_t1_hydro` | Dampfquelle | Vent Cap | Dampfkraftwerk / Geothermal Plant | `struct_hydro_t1` | Bau: E |
| ● | `core:str_t1_mstore` | Erzspeicher | Ore Silo | Massespeicher / Mass Storage | `struct_mstore_t1` | Bau: R |
| ● | `core:str_t1_estore` | Glutspeicher | Heat Bank | Energiespeicher / Energy Storage | `struct_estore_t1` | Bau: T |
| ● | `core:str_t1_fac_land` | Landwerk I | Land Works I | Landfabrik / Land Factory | `struct_fac_land_t1` | Bau: A |
| ● | `core:str_t2_fac_land` | Landwerk II | Land Works II | Landfabrik / Land Factory | `struct_fac_land_t2` | Bau: Upgrade (Command Card) |
| ○ | `core:str_t3_fac_land` | Landwerk III | Land Works III | Landfabrik / Land Factory | `struct_fac_land_t3` | Bau: Upgrade (Command Card) |
| ○ | `core:str_t1_fac_air` | Luftwerk I | Air Works I | Luftfabrik / Air Factory | `struct_fac_air_t1` | Bau: S |
| ○ | `core:str_t2_fac_air` | Luftwerk II | Air Works II | Luftfabrik / Air Factory | `struct_fac_air_t2` | Bau: Upgrade (Command Card) |
| ● | `core:str_t1_pd` | Riegel I | Bolt I | Punktverteidigung / Point Defense | `struct_direct_t1` | Bau: Z |
| ● | `core:str_t2_pd` | Riegel II | Bolt II | Punktverteidigung / Point Defense | `struct_direct_t2` | Bau: Z |
| ● | `core:str_t1_aa` | Rost I | Grate I | Flugabwehrturm / AA Tower | `struct_aa_t1` | Bau: X |
| ● | `core:str_t2_aa` | Rost II | Grate II | Flakturm / Flak Tower | `struct_aa_t2` | Bau: X |
| ● | `core:str_t3_sam` | Hochrost | High Grate | Raketenabwehr / SAM Site | `struct_sam_t3` | Bau: X |
| ● | `core:str_t1_wall` | Mauer | Wall | Mauer / Wall | `wall` | Bau: C |
| ○ | `core:str_t1_radar` | Horcher I | Listener I | Radar / Radar | `struct_intel_t1` | Bau: D |
| ○ | `core:str_t2_radar` | Horcher II | Listener II | Radar / Radar | `struct_intel_t2` | Bau: Upgrade (Command Card) |
| ○ | `core:str_t3_radar` | Horcher III | Listener III | Radar / Radar | `struct_intel_t3` | Bau: Upgrade (Command Card) |
| ○ | `core:str_t2_shield` | Schirm II | Canopy II | Schildgenerator / Shield Generator | `struct_shield_t2` | Bau: F |
| ○ | `core:str_t3_shield` | Schirm III | Canopy III | Schildgenerator / Shield Generator | `struct_shield_t3` | Bau: Upgrade (Command Card) |
| ○ | `core:str_t2_arty` | Tiegel | Crucible | Artilleriestellung / Artillery Emplacement | `struct_arty_t2` | Bau: V |
| ○ | `core:str_t3_arty` | Hochofen | Blast Furnace | Schwere Artilleriestellung / Heavy Artillery Emplacement | `struct_arty_t3` | Bau: V |

**Zählung (Gebäudestufen einzeln):** 23 mobile + 27 Struktur-Blueprints = **50** (Band 45–55). Davon sind **26 im MS9-Kern** (Band 25–30): 11 mobile (Vogt, Lehrling, Geselle, Funke, Stichel, Punze, Kelle, Sieb, Meißel, Rinne, Rüttelsieb) und 15 Strukturen (Zapfstelle I, Zapfstelle II, Glutkessel I, Glutkessel II, Dampfquelle, Erzspeicher, Glutspeicher, Landwerk I, Landwerk II, Riegel I, Riegel II, Rost I, Rost II, Hochrost, Mauer).
**Bewusst nicht enthalten:** TML/SMD (Post-MVP laut features.json), Transporter (U13), Torpedobomber (Marine), Stealth-Support (der Stealth-Teil von U6 entfällt, weil I5 „Später“ ist; U6 gilt mit der Schürze als erfüllt), ein T3-Panzer (Reserve-Name *Amboss / Anvil*).
**Namenshinweise:** Tiegel und Hochofen tragen Artillerie-Namen, sind aber Gebäude, weil sie die „großen Gießgeräte“ sind. *Riddle* und *Trommel* sind die englischen Fachwörter für Grobsieb bzw. Trommelsieb.

---

## 8. Audio-Charakter „Gießhalle und Funk“

**Leitbild:** Gießerei bei Nachtschicht. Tief, metallisch, nah und trocken mit wenig Hall. Materialgeräusche statt Sci-Fi-Synth: Glocke, Blasebalg, Zischen von Glut, fließendes Metall.

### 8.1 Stimmen

- **Vogt:** die **menschliche Stimme des Operators** über den Uplink. Warm, ruhig, leicht verrauscht (Bandpass 300–3.400 Hz, dezentes Knistern). Sie ist die einzige menschliche Stimme auf dem Feld.
- **Alle anderen Einheiten:** **Werkstimme**, ein knappes Maschinen-Sprachmodul mit metallischer Resonanz (Comb-Filter), höchstens 2–3 Wörter und ≤ 0,8 s. **Vor jeder Quittung kommen Pips: Ihre Zahl ist die Tech-Stufe, ihre Tonlage die Rollenfamilie** (Direkt mittel, Artillerie tief, AA hoch, Engineers aufsteigender Zweiklang, Luft gleitend). Pips und Rufname sind sprachneutral, der Satz wird lokalisiert (aus K2).
- **Alerts (P8):** **Hüttenstimme**, die Disponentin der Hütte im Orbit. Klar und sachlich, ohne Flavor-Wörter. Vor jeder Ansage steht ein eigener Zweiton-Gong, und jeder Alert-Typ hat sein eigenes Wiederholintervall.

| Anlass | DE | EN |
|---|---|---|
| Vogt Auswahl | „Vogt hört.“ | „Reeve listening.“ |
| Vogt Bewegung | „Setze über.“ | „Moving across.“ |
| Vogt Angriff | „Das wird Schlacke.“ | „That'll be slag.“ |
| Engineer Bau | „Wird gegossen.“ | „Pouring.“ |
| Engineer fertig | „Sauberer Guss.“ | „Clean cast.“ |
| Punze Auswahl | *pip* „Punze.“ | *pip* „Punch.“ |
| Kelle Angriff | *pip (tief)* „Kelle voll.“ | *pip (low)* „Ladle's full.“ |
| Luft Auswahl | *pip (gleitend)* „Dohle im Zug.“ | *pip (glide)* „Jackdaw aloft.“ |
| Alerts | „Vogt unter Feuer.“ · „Masse knapp.“ · „Energie knapp.“ · „Werk freigesprochen.“ | „Reeve under fire.“ · „Mass low.“ · „Energy low.“ · „Works qualified.“ |

### 8.2 SFX-Palette

| Kategorie | Klang |
|---|---|
| **Signatur** | **einzelner Glockenschlag**, sparsam: „Bau fertig“ leise und hoch, Freisprechung mittel, Lotbruch tief mit 3× Nachhall. Eigene Kategorie im Voice-Manager, Cooldown ≥ 1 s. |
| **Flow-Grundton** | leiser tonaler Summton (z. B. A2) unter Fabriken, Engineers und Kraftwerken. **Beim Energy-Stall kippt er eine kleine Sekunde nach unten und stottert.** So ist der Stall hörbar, ohne dass man auf das HUD schaut (aus K2). |
| **Direktfeuer** | „Glockenhammer“: kurzer metallischer Schlag über dumpfem Knall. Höhere Tech klingt tiefer und hallt länger nach, wird aber nicht lauter. |
| **Artillerie** | Abschuss „Schwapp + Wumm“ (Flüssigkeit plus Mörser), hörbares Pfeifen im Flug, Einschlag als Knirschen und Zischen der Schlacke |
| **Raketen (Rinne, SAM)** | Fauchen mit Knistern der Glut-Treibladung |
| **Flugabwehr** | schnelles, trockenes Rasseln (Ratsche, Sieb) in hoher Lage |
| **Antriebe** | Ketten klirren schwer, Bots zischen hydraulisch mit hohlem Guss-Tritt, Flieger fauchen wie ein Blasebalg, Gunships wummern mit der Ringdüse |
| **Bau / Reclaim** | Gießgeräusch, Tonhöhe steigt mit dem Fortschritt. Am Ende folgen Abkühl-Knacken und der leise Glockenschlag. Reclaim ist dasselbe rückwärts (Einschmelzen, Blubbern). |
| **Befehle (UI)** | Auswahl: Relais-Klack + kurzer Blasebalg-Hauch. Bewegung: Ventil-Zisch mit fallender Tonhöhe. Angriff: trockener Hammerschlag. Bauauftrag: Kellen-Klirren. |
| **Treffer / Tod** | Treffer: gedämpfter Metall-Klong. Tod: Gusseisen bricht, dazu Dampfzischen. Strukturtod: Kesselbersten mit langem Zisch-Ausklang. |
| **Lotbruch** | tiefer Glockenschlag, Unterdruck-Sog, Druckwelle, danach 2 s Stille-Ducking mit nachglühendem Knistern |
| **Eco-Gebäude** | rhythmischer Blasebalg (Pgen) und Pumpentakt (Mex), leise, nur auf Z0 als Loop |

### 8.3 Mix-Regeln für den Voice-Manager (32 Stimmen)

- **Frequenzbänder pro Kategorie:** Artillerie, Tod und Lotbruch tief, Direktfeuer mittel, AA, Pips und UI hoch.
- **Ein Bau-Loop pro Armee:** Seine Dichte bildet die Summe der fließenden Build Power ab, statt eines Loops pro Engineer. Das spart Stimmen (aus K1).
- Glockenschläge und Alerts haben Vorrang vor Waffen, Eco-Loops haben die niedrigste Priorität.

---

## 9. Bewertung der Konzepte

Skala 1–5 (5 = am besten).

| Kriterium | K1 „Sinter“ (Industrie & Flow) | K2 „Kalder“ (Lesbarkeit zuerst) | K3 „Varkan“ (Charakter & Welt) |
|---|---|---|---|
| **Lesbarkeit** | **4**: klare Silhouetten-Verbote, Schlote = Tech-Striche, 48-px-Test. Die Tech-Schlote sind von oben aber schwach sichtbar. | **5**: ein Monopol-Merkmal pro Rolle, Draufsicht zuerst, Tech-Streifen = Icon-Striche, Glut-Monopol, Compiler-Lint | **4**: Hero-Feature pro Rolle, eigene Engineer-Iconform. Die dünnen Tech-Bänder liegen unter der Mindestgröße, und die Artillerie hat zwei Formvarianten. |
| **Eigenständigkeit (keine FA-Nähe)** | **4**: eigener Stil. Lateinische Katalognamen (Malleus, Caldera, Vortex) sind in Spielen aber verbreitet und damit kollisionsanfällig. | **4**: Kunstwort-Rufnamen sind sehr kollisionsarm. Das graue Normbau-Design ist dafür generisch und wenig markant. | **5**: eigene Welt, eigene Begriffe für alle FA-Mechaniken (Lotung, Abstich, Lotbruch), eine explizite Abgrenzungstabelle und echte DE/EN-Wortpaare |
| **Umsetzbarkeit als Kitbash** | **5**: 9 Parts, Tris-Budget, ≤ 6 Parts, ≤ 2 animiert, Rücksicht auf das PartStream-Limit | **5**: Normteile, Placeholder = Final-Silhouette, Schema-Vorschlag mit Masken | **3**: 15 Parts inklusive neuer Primitive (Kelle, Glocke-Halbkugel), dünne Bänder, bis 7 Parts, kein Tris-Budget |
| **Stimmung / Coolness** | **4**: Hüttenwerk mit Glutkern, Glut als Stall-Anzeige, starkes Audio | **2**: sachlich und nüchtern, Schiefer-Grau. Die Lesbarkeitsdoktrin als Lore ist clever, aber kühl. | **5**: Vogt, Lotung, Charta und Häuser. Starker Ton, Galgenhumor, Glocke als Signatur, Kelle als unverwechselbare Artillerie |
| **Passung zu SupCom-Gameplay** | **4**: Build-Power-Fluss und Stall als Glut sichtbar, Reclaim-Optik | **4**: Stall hörbar, strenge Rollenlogik, sonst neutral | **5**: Jede Weltregel begründet eine vorhandene Mechanik (ACU-Tod = Niederlage, Overcharge, Fabrik-Upgrade, Spiegel-Matches, Reclaim) |
| **Summe** | **21** | **20** | **22** |

### 9.1 Entscheidung

**Gewinner: K3 „Varkan“.** Es hat die stärkste Identität und die beste Verzahnung von Welt und FA-Mechanik. Die Rollennamen aus echten Wortfeldern (Schmiedewerkzeug, Gießgerät, Siebe, Vögel) sind selbst eine Lesbarkeitshilfe. Seine Schwächen (Kitbash-Aufwand, Tech-Bänder, weiche Lesbarkeitsregeln) sind genau die Stärken von K1 und K2 und wurden gezielt ersetzt.

### 9.2 Übernommen aus K2 „Kalder“

- Monopol-Merkmal pro Rolle, Draufsicht-zuerst-Gesetze und Winkel-Code (§5.1).
- Glut-Monopol für Flow-Einheiten, als Zwei-Klassen-Regel Glutnaht/Glutkern (§3.5).
- Tech-Streifen als Deck-Maske statt dünner Bänder, Zählung identisch zu den Icon-Kerben (§3.4).
- „Hell oben, dunkel unten“, Mindestanteile der Teamfarbe pro Klasse, automatische Messung (§4).
- Systematik „gefüllt = erzeugen, hohl = lagern“, im Bau füllt sich die Grundform (§6).
- Monopol-Lint im Compiler, Placeholder = Final-Silhouette (±10 %).
- Pips vor der Quittung (Zahl = Tech, Tonlage = Rolle) und der Flow-Grundton mit hörbarem Stall (§8).

### 9.3 Übernommen aus K1 „Sinter“

- Kitbash-Budget: Tris LOD0, ≤ 2 animierte Parts, PartStream-Limit (§3.3).
- Glut als Flow-Zustand (`flowGlow`), Erkalten beim Stall, Baustrahl als Glutstrom, Bau-Dissolve und Reclaim als Schmelzen (§3.5).
- Weißglut-Umschaltung für Teamfarben nahe am Glut-Farbton (§4.3).
- `matId`-Slots für Platzhalter und RGBA-Maskenlayout für Final-Assets, Ruß-Gradient (§4.1).
- MSDF-Raster mit Mindeststrichstärke und Winkelgrenze, Kerben außerhalb der Grundform, gestrichelter Ghost per Distanzfeld (§6).
- Ein Bau-Loop pro Armee, Frequenzbänder pro Kategorie, UI-Befehlsgeräusche (§8.3).
- Grep-Prüfung der Namen vor dem Einfrieren (§7.1).

### 9.4 Verworfen

- **K1:** lateinische Katalognamen, weil DE/EN-Wortpaare lesbarer sind und weniger kollidieren; Trapez als Land-Iconform.
- **K2:** Schiefer-Grau als Grundfarbe (zu kühl für „Flow & Fire“), Kunstwort-Rufnamen, Transporter im MVP (U13 ist nicht MVP).
- **K3:** `band`-Tech-Ringe (unter der Mindestgröße), Glühen des Kelleninneren im Leerlauf (verletzt das Glut-Monopol), T3-Panzer Amboss (Budget, bleibt Reserve-Name), `core:cmd_reeve` als ID (IDs bleiben funktional: `core:cmd_commander`).

---

## 10. Anhang: Beispiel-Einheiten und offene Punkte

### 10.1 Beispiel-Einheiten (Kurzprofil)

> Auszug aus `roster.json` (Startwerte für das Balancing-Gate MS8/MS9, gegen spooky-db 3810 geprüft). Bei Abweichungen gilt `roster.json`.

**Punze / Punch (`core:lnd_t1_tank`)**
- **Silhouette:** gedrungene Wanne 1,0 × 0,4 × 1,4 WU auf Ketten. Mittig sitzt eine Glocke, deren waagerechtes Rohr (0,9 WU ≈ 65 % der Rumpflänge) über den Bug hinausragt. Ein Kupferrohr läuft links vom Heck zur Glocke, eine Glutnaht quer über das Heck, dazu 1 Tech-Streifen.
- **Parts (5):** `hull`, `tracks`, `bell` (Yaw), `barrel` (Pitch), Kupfer-`barrel` statisch. Teamfarbe ≈ 35 %.
- **Icon:** `land_direct_t1`. **Hotkey:** Q.
- **Sim:** HP 300, Mass 56, Energy 280, BuildTime 300, Speed 3,3, `core:wpn_cannon_t1` mit 28 Schaden alle 1,2 s, RW 18 ⇒ DPS 23,3. DPS/Mass 0,417 (FA 0,429, −2,8 %), HP/Mass 5,36 (±0 %). Breakpoints wie FA: 3 Vogt-Treffer, 6 Riegel-I-Treffer, 5 Meißel-Salven.
- **Tech-Familie:** Meißel (T2): 2 Streifen, breitere Glocke, zwei parallele Rohre, Seitenschürzen.

**Kelle / Ladle (`core:lnd_t1_arty`)**
- **Silhouette:** lange, schmale Wanne 0,9 × 0,35 × 1,5 WU mit Gegengewicht-Block am Heck. Vorn sitzt auf einem kurzen Schwenkarm eine offene Kelle (Ø 0,6 WU, Wandstärke ≥ 0,17 WU), die beim Schuss nach vorn oben kippt und kurz aufglüht (Rückstellung ≈ 1 s). Keine Glocke, kein waagerechtes Rohr.
- **Parts (5):** `hull`, `tracks`, `boom` (Yaw), `ladle` (Pitch), `hull` klein (Gegengewicht). Braucht den neuen Primitiv-Typ `ladle` (Ersatz ohne ihn: flacher `cyl` mit dunkler Deckfläche).
- **Icon:** `land_arty_t1`. **Hotkey:** W.
- **Sim:** HP 210, Mass 36, Energy 180, BuildTime 200, Speed 2,7. `core:wpn_slag_mortar_t1`: 100 Schaden, Splash 1,1 WU, alle 9,0 s, ballistisch, Reichweite 6–30 WU ⇒ DPS 11,1. DPS/Mass 0,309 (−7,8 %), Pulk-DPS/Mass +4,9 %, HP/Mass 5,83 (+2,4 %). Einschläge hinterlassen ≈ 5 s ein glühendes Schlacken-Decal, nur View und ohne DoT.

**Lehrling / Prentice (`core:lnd_t1_engineer`)**
- **Silhouette:** kurze, breite Wanne ohne Turm, mit keramikweißer Deckplatte und graphitfarbenem Tech-Streifen. Ein Kupfer-Kranarm läuft diagonal vom linken Heck nach vorn rechts, an seiner Spitze sitzt ein Glutkern-Emitter. Liegender `boiler` als Materialtank mit teamfarbenem Bauchband.
- **Parts (5):** `hull` (Keramik), `tracks`, `boiler` (Team), `boom` (Kupfer, Yaw), Emitter (Glut, Pitch). Geselle (T2) hat 2 Arme verschiedener Länge, Meister (T3) 3 Arme bei Maßstab 1,4.
- **Icon:** `eng_build_t1`. **Hotkey:** E.
- **Sim:** Mass 52, Energy 260, BuildTime 260, Build Power 5, HP 160 (HP/Mass +6,7 %), keine Waffe. Kategorien `LAND MOBILE ENGINEER TECH1 RECLAIM REPAIR`.

### 10.2 Offene Punkte

1. Markenrecherche „Varkan“, „Kessa“, Häusernamen und alle Rufnamen. Der Grep gegen die FA-Namensliste ist erledigt (357 Einheitennamen aus spooky-db 3810, kein Treffer; nur das generische Teilwort „Master“ in „Burst Master“), vor dem Einfrieren gegen den dann aktuellen FAF-Stand wiederholen.
2. FA-Referenzwerte sind gegen spooky-db 3810 geprüft; vor MS9 einmal gegen den aktuellen FAF-Stand nachziehen (`roster.md` §18).
3. Vogt-Wrack: Lotbruch ohne Wrack oder mit „Lotstumpf“ als Reclaim. Das hat Gameplay-Wirkung.
4. Radar-Blip mit drei Einheitsformen (§6.5) mit I3 in MS10 im Spiel bestätigen.
5. Werkstimme per TTS mit Nachbearbeitung oder mit Sprechern aufnehmen (Entscheidung zu P7/P8).
6. Schema-Erweiterung `placeholder.parts[]`/`tech` (§3.6), Tech-Bitmaske der Superset-Visuals (§3.3) und der neue Primitiv-Typ `ladle` als eigener Arbeitsschritt im Blueprint-Compiler.
7. `iconThreshold` mobil 25 px (§3.2) weicht vom Beispiel `iconThreshold:14` in PLAN §3.9 ab und muss bei der Blueprint-Übernahme nachgezogen werden.
