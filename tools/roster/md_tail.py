# ---------------------------------------------------------------- 17 Review-Entscheidungen
A('---')
A('')
A('## 17. Review-Entscheidungen')
A('')
A('Zwei Reviews vom 2026-09-29: **Balance** (Breakpoints, Splash, Methodik) und **Lesbarkeit/Vollständigkeit** (Features, Silhouetten, Icons, Namen). ✓ = übernommen, ◐ = teilweise bzw. abgewandelt, ✗ = verworfen.')
A('')
A('### 17.1 Balance-Review')
A('')
A('| Nr | Punkt | | Entscheidung und Begründung |')
A('|---|---|---|---|')
BAL = [
 ('1', 'Punze HP 330 reißt Breakpoints', '✓', 'Punze HP 300, Tempo 3,3, BT 300; Riegel I 50 / 0,3 s. Breakpoints wieder FA (3 Vogt-Treffer, 6 Riegel-I-Treffer, 5 Meißel-Salven), Rush-Simulation nachgerechnet: 19 / 22 Panzer wie FA.'),
 ('2', 'Vogt HP 11.000', '✓', 'HP 12.000 (±0 %).'),
 ('3', 'Meißel 2×32 tötet keinen Stichel', '✓', '2×35 / 1,3 s: Stichel 1 Salve, Punze 5 Salven.'),
 ('4', 'Hochofen ohne Burst', '✓', '5.500 / 15 s, Splash 6, 48.000 M, 900.000 E, BT 76.700, HP 10.000; Schirm III fällt nach 5 Schüssen (60 s). Streichen verworfen: K13 (T2/T3-Artillerie) ist MVP, das Reichweiten-Gate bleibt offener Punkt §18.'),
 ('5', 'Schilde ohne Regenerations-Verzögerung', '✓', '`regenStartS` 3 / 3 / 1 für Schürze, Schirm II, Schirm III; Generator-Lint.'),
 ('6', 'Kelle Splash 1,5 + 110 Schaden', '◐', 'Mass 36, Energy 180, BT 200 übernommen. Statt 90 / 8,0 s / Splash 1,2 gilt **100 / 9,0 s / Splash 1,1**: 90 Schaden hätte den Breakpoint Kelle → Punze auf 4 statt 3 Treffer verschoben, und Splash 1,2 läge mit Pulk +20 % über dem neuen ±15-%-Gate. Ergebnis: Einzelziel −7,8 %, Pulk +4,9 %, Produkt −5,5 %.'),
 ('7', 'Pfanne und Tiegel: Splash-Inflation', '◐', 'Pfanne 700 / 10 s übernommen, **Splash 4,4 statt 4,5** (4,5 ergibt Pulk +15,2 % und reißt das Gate; 4,4 ergibt +10,7 %). Tiegel 2.100 / Splash 3 übernommen, **Nachladezeit 21 statt 22 s**: Mit `regenStartS` 3 regeneriert Schirm II bei 22 s 2.090 HP pro Zyklus, ein Tiegel käme netto nur 10 HP pro Schuss voran (FA 130); bei 21 s sind es 120. DPS/Mass +5,7 %, Produkt +11,6 %. Ein Schuss tötet Zapfstelle II und Riegel I, Glutkessel II braucht zwei.'),
 ('8', 'Rinne 2×280 gegen Riegel II', '✓', '2×300 / 10 s: 4 Salven wie FA. Zusätzlich **Splash 1,5 → 1,0**: Das neue Pulk-Gate zeigte +78 %.'),
 ('9', 'Eco-Tabelle falsch', '✓', '§15 rechnet mit der Mehrproduktion (225 s bzw. 375 s) und zeigt den Energy-Mehrbedarf separat (≈ 232 s bzw. ≈ 389 s).'),
 ('10', '`buildPower` bei Upgrade-Gebäuden', '✓', 'Zapfstelle I 10, Zapfstelle II 15, Horcher I 13, Horcher II 20, Schirm II 20; Generator-Lint. Upgrade-Dauern in §15.'),
 ('11', 'Luft gegen Flugabwehr', '✓', 'Turmfalke 2×25 / 1,0 s (Produkt −5,1 %), Krähe 16 / 0,3 s (Produkt ±0), Rost I 2×20 / 0,6 s (Lerche 1 Salve), Hochrost 6×200 / 3,5 s (Krähe und Elster 1 Salve).'),
 ('12', 'Abstich-Formel unvollständig', '✓', 'FAF-Formel in der Waffennotiz des Vogts (Schaden = E/6, Drain = 6 × Schaden, clamp auf max. HP im Umkreis 2,7 WU, 1.250 … 15.000).'),
 ('13', 'Zange RW 26 = Riegel I', '✓', 'RW 30, HP 650 (Produkt +6,9 %).'),
 ('14', 'Horcher III 1.000 E/s', '◐', 'Unterhalt 400 E/s übernommen. Streichen verworfen: PLAN §5.3 verlangt das T3-Radar als Rest von I3 in MS13.'),
 ('15', 'Glutspeicher-Adjacency zu eng', '✓', 'Bufft alle Energieproduzenten: +25 % (SIZE4), +8,3 % (SIZE12: Glutkessel II, Dampfquelle), +6,25 % (SIZE16: Glutkessel III); Werte aus `AdjacencyBuffs.lua` bestätigt.'),
 ('D', 'Gate erweitern', '✓', 'Produkt-Gate ±15 %, Treffer-bis-Tod-Matrix (20 Paare, alle exakt FA), Pulk-DPS/Mass ±15 % für `ARTILLERY`, alles im Generator erzwungen; globale Verschiebung als Entscheidung in §14. Durch die neuen Gates zusätzlich geändert: **Sieb HP 300 → 310** (Vogt-Breakpoint 4 statt 3 Treffer wie FA) und **Riegel I HP 1.400 → 1.350** (Produkt +16,9 % → +12,7 %).'),
]
for r in BAL: A('| ' + ' | '.join(r) + ' |')
A('')
A('### 17.2 Lesbarkeits- und Vollständigkeits-Review')
A('')
A('| Nr | Punkt | | Entscheidung und Begründung |')
A('|---|---|---|---|')
LES = [
 ('A1', 'SAM für B5 erst ab MS13 baubar', '✓', 'Hochrost ist ● (Kern 26); `msNote`: in MS8 per Konsole/Test-Szenario gespawnt, baubar ab MS13.'),
 ('A2', 'U6-Stealth nicht dokumentiert', '✓', '§2.1 und `faction.md` §7.4: U6-Stealth entfällt (I5 = Später).'),
 ('A3', 'faction.md und roster.md widersprechen sich', '✓', '`faction.md` Kopfzeile, §7.4 und §10.1 angeglichen; `roster.json` ist die einzige Quelle (`sourceOfTruth`).'),
 ('A4', 'Visual-Zahl unklar', '◐', 'Superset-Mesh pro Rolle übernommen, aber mit **Tech-Bitmaske pro Vertex** statt Skalierung einzelner Parts pro Instanz (braucht keine PartStream-Slots). Generator prüft Superset ≤ 8 Parts mobil / ≤ 9 Strukturen und ≤ 350 Tris: 28 Visuals (Hochofen teilt jetzt `v_arty_struct`), größte: `v_fac_land` 9, `v_bot`/`v_tank`/`v_aa` 8. DECISIONS 17 (40 Visuals ⇒ 309 Draws) bleibt gültig.'),
 ('B1', 'Glut-Monopol durch `stack` verletzt', '✓', 'Stacks aus Fallhammer, Pfanne, Reißnadel, Hochrost, Horcher III, Schirm III und Hochofen entfernt, dazu der Heckschlot der Zapfstelle III; „Schlot am Heck“ aus `faction.md` §3.4 gestrichen. Lint: `stack`/`glow` nur bei ECONOMIC, FACTORY, ENGINEER.'),
 ('B2', 'Pflicht-Teamfarbe fehlt', '✓', 'Engineers: Kessel `team` (Bauchband), Kranarm `copper`; Funke: Wanne `team`; Rost I/II und Hochrost: `grate` `team`. Lint: ≥ 1 Team-Part pro Blueprint.'),
 ('B3', 'Mauer mit Tech-Streifen', '✓', '`techStripes` 0 (auch Vogt).'),
 ('B4', 'Engineer-Streifen unsichtbar', '✓', 'Graphit auf Keramik (`techStripeMat`); Streifenmaß 0,10 WU × Maßstab, Abstand 0,10 WU, hinteres Drittel.'),
 ('B5', 'Tech-Maßstab gegen Footprint', '◐', 'Upgrade-Strukturen: Sockel füllt den Footprint, nur die Höhe wächst (1,2 / 1,4). Neubauten mit Footprint-Sprung: xz = Footprint-Verhältnis (Glutkessel II 3,0, III 4,0, Riegel II 2,0, Hochofen 4,0). Mobil: Deckel 1,4 bei 1×1 übernommen (Meister, Reißnadel, Trommelsieb). **Verworfen:** die Regel „Modelllänge ≤ 1,25 × Footprint-Kante“ – schon die Punze (1,4 WU auf 1×1) verletzt sie; der Footprint ist eine Pathing-Zelle, auch FA-Modelle überragen ihn. Werte in `kitbash.scale`.'),
 ('B6', 'Mindestgröße gegen iconThreshold', '◐', 'Variante „iconThreshold mobil ≥ 25 px“ übernommen (12 % von 25 px = 3 px). Die konkreten Maße sind an die 12-%-Regel angepasst statt 0,12 WU (das wären bei 25 px nur 2,1 px): AA-Rohr Ø ≥ 0,17 WU, Raketenkasten-/Kellenrohr-Breite ≥ 0,34 WU, Kranarm ≥ 0,17 WU (Basis Punze 1,4 WU). PLAN §3.9 nennt im Beispiel `iconThreshold:14` – Anpassung ist offener Punkt §18.'),
 ('C1', 'Rinne ↔ Rüttelsieb', '✓', 'Rinne mit einem Raketenkasten 0,5 × 0,25 × 1,1 WU bei 50°, AA-Rohre ≥ 75° (Differenz ≥ 25°); Paar in der MS9-Pflichtliste.'),
 ('C2', 'Hochofen ↔ Glutkessel III', '✓', 'Hochofen = Tiegel-Silhouette (Sockel, Lafette, Kelle Ø 3,0, Steilrohr 7 × 0,6 WU, Gegengewicht, 5 Parts, kein Schlot). Artillerie hat damit zwei Signaturen: Kelle und Raketenkasten.'),
 ('C3', 'Glutspeicher ↔ Glutkessel I', '✓', 'Glutspeicher = zwei stehende, flache Trommeln; Glutkessel = liegender Kessel mit Schlot ≥ 1,5 × Kessel-Ø.'),
 ('C4', 'Zapfstelle III ↔ Dampfquelle', '✓', 'Gelöst durch B1 (kein Heckschlot) und B5 (Zapfstelle bleibt 2×2).'),
 ('C5', 'Horcher ↔ Schirm, Funke ↔ Schürze', '✓', 'Radar trägt eine rechteckige Platte (`wing`-Prisma 1,6 × 0,8 × 0,1 WU, 35°) statt eines Rings – kein neues Primitiv nötig. Schild-Ring Ø ≥ 0,8 × Footprint-Kante, Schürzen-Ring Ø ≥ 1,2 × Rumpfbreite, Funken-Mast ≥ 1,0 × Rumpflänge.'),
 ('C6', 'Turmfalke ↔ Elster, Lerche ↔ Dohle', '✓', 'Elster mit zwei Kessel-Gondeln an den Flügelspitzen, Spannweite +30 %; Dohlen-Kessel ≥ 1,4 × Flügeltiefe. „Krähe ↔ Elster“ ersetzt durch „Turmfalke ↔ Elster“.'),
 ('C7', 'Pflichtpaare nur ●', '✓', '`silhouettePairs.ms9` (9 Paare, vom Generator auf ● geprüft) und `silhouettePairs.ms14` (7 Paare), §16.'),
 ('C8', 'Vogt-Größe', '✓', 'Höhe ≥ 2,4 WU, Schulterbreite ≥ 2,0 WU.'),
 ('D1', 'Radar-Blip verrät Vogt', '✓', 'Blips nur Achteck (Land inkl. Engineer und Vogt), Dreieck (Luft), Sechseck (Gebäude), einheitlich 1,0×.'),
 ('D2', 'Achteck ↔ Kreis', '✓', 'Land = Quadrat mit Fase ≤ 4 DE, Engineer = Kreis Ø 28 DE.'),
 ('D3', 'Kerben unter 3 px', '◐', 'Mindeststrich 5 DE, Kerben 5 × 9 DE übernommen; Späher-Faktor **1,0 statt 0,8** (bei 0,8 hätten 5-DE-Striche nur 2,5 px). Mauer bleibt 0,6, sie hat weder Glyphe noch Kerben.'),
 ('D4', 'LAB und Panzer mit gleichem Icon', '✓', 'Glyphe `bot` (Punkt + 2 Beinstriche), `land_bot_t1..t3` für Stichel, Zange, Fallhammer.'),
 ('D5', 'Glyphen-Zahl', '✓', '19 Tokens (`iconGlyphs`), Tabelle mit IDs in `faction.md` §6.3; Jagdbomber als Sanduhr (^ über v, je 6 DE, 2 DE Abstand).'),
 ('D6', 'Hotbuild-Prinzip gebrochen', '◐', 'Reißnadel auf **F statt D** (D ist Schürze, sonst teilten sich wieder zwei Rollen eine Taste). S = Bots (Stichel → Zange → Fallhammer), Q = Panzer (Punze → Meißel). Bau-Menü: Glutspeicher auf **T statt F**; Schirm bleibt F, Tiegel/Hochofen V. Grund: 13 Rollen passen nicht auf 12 Tasten; der Vorschlag hätte die Artilleriestellungen verdrängt.'),
 ('E1', 'Grep gegen FA-Namen', '✓', 'Durchgeführt gegen alle 357 Einheitennamen aus spooky-db 3810: kein Treffer. Einzige Teilwort-Übereinstimmung „Master“ (in „Burst Master“) ist ein generisches Wort und bleibt. Markenrecherche bleibt offen (§18).'),
 ('E2', '„Hydrocarbon Plant“', '✓', 'Rolle jetzt „Dampfkraftwerk / Geothermal Plant“; ID `hydro` bleibt intern.'),
 ('E3', '`faReference.role` zitiert FA-Strings', '✓', '`faReference.devOnly: true`; Lint entfernt das Feld beim Blueprint-Build.'),
 ('E4', 'Vogt-Layout = FA-ACU-Schema', '✓', 'Glocke auf der rechten Schulter, Keramik-Rückenkran über die linke Schulter; Lot-Kopf bleibt Hauptmerkmal.'),
 ('E5', 'Rollenbezeichnungen', '✓', 'Rost I „Flugabwehrturm“, Krähe „Kampfschweber“.'),
]
for r in LES: A('| ' + ' | '.join(r) + ' |')
A('')

# ---------------------------------------------------------------- 18 Offene Punkte
A('---')
A('')
A('## 18. Offene Punkte')
A('')
A('1. **FA-Datenstand:** spooky-db „3810“ ist nicht der aktuelle FAF-Patch. Vor MS9 alle 50 Referenzen gegen den dann aktuellen `FAForever/fa`-Stand prüfen (Skript: Referenz-IDs aus `roster.json` → DPS-Formel → Δ, Produkt, Pulk und Treffer-Matrix neu rechnen).')
A('2. **Kartenpool und Hochofen:** Enthält der MVP-Pool eine 256-WU-Karte, schlägt das Reichweiten-Gate (200 > 145) fehl. Entweder Pool ≥ 354 WU oder Hochofen per Karten-Restriktion sperren. Mit 48.000 Mass ist er auf kleinen Karten ohnehin ein Spätspiel-Ziel.')
A('3. **Abstich als Integer-Tabelle:** Die FAF-Formel steht fest (Waffennotiz des Vogts). Für den Determinismus wird sie in MS6 als ganzzahlige Umrechnung E ↔ Schaden festgelegt (MS6-Golden).')
A('4. **Vogt-Wrack** (`faction.md` §10.2) bleibt offen, `wreck` ist beim Vogt noch nicht gesetzt.')
A('5. **Luft-Drehraten:** FA gibt `Air.TurnSpeed` in eigener Einheit an. Die `turnRateDeg`-Werte der Luft sind Entwurfswerte für das kinematische Modell und werden in MS12 getunt.')
A('6. **Beschleunigung (`accel`)** ist ein Entwurfswert pro Klasse (Panzer 2,2–2,5, Bots 2,6–4,0, Artillerie 1,8–2,2); FA liefert dafür keine direkt übertragbare Zahl. Tuning mit SPK2/MS3.')
A('7. **Schema:** `roster.json` enthält Felder, die `UnitSchema` heute nicht kennt (Waffen, Ökonomie, Schilde inkl. `regenStartS`, Toggles, Adjacency, `kitbash.parts`/`scale`/`techStripeMat`, Tech-Bitmaske der Visuals). Die Übernahme folgt dem Schema-Ausbau in MS4–MS8.')
A('8. **iconThreshold:** PLAN §3.9 zeigt im Blueprint-Beispiel `iconThreshold:14`. Für die Mindestgröße gilt jetzt 25 px (mobil, bezogen auf die Bildschirmlänge der Einheit); das muss bei der Blueprint-Übernahme bzw. in DECISIONS nachgezogen werden.')
A('9. **Pulk-Gate für Bomber und Flak:** Das Pulk-Gate gilt nur für `ARTILLERY`. Bomben (Dohle, Elster) und Flak (Rüttelsieb, Rost II) werden in MS12 mit demselben Modell nachgerechnet.')
A('10. **Superset-Zählung:** Die Visual-Vereinigung zählt nach (Part, Material). Sitzen gleiche Parts auf verschiedenen Positionen (Punze-Rohr mittig, Meißel-Rohre parallel), zählen sie beim Mesh-Bau doppelt; die Grenzen (8 / 9 Parts) dann erneut prüfen und notfalls das Visual teilen.')
A('11. **Namen:** Markenrecherche zu allen Rufnamen, „Varkan“ und „Kessa“ steht aus; der FA-Namens-Grep ist erledigt (§17.2 E1).')
A('')
open('roster.md', 'w').write('\n'.join(L) + '\n')
print(len(L))
