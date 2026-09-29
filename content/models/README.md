# Einheiten-Modelle (Kitbash-DSL `@faf/modelkit`)

Ein Modell pro Datei: `content/models/<fraktion>/<unit>.ts` mit `export default defineModel({...})`. Der Dateiname
ist der Unit-Teil der Blueprint-ID (`lnd_t1_tank.ts` ↔ `core:lnd_t1_tank`). Dateien mit `_` am Anfang sind keine
Modelle (`_faction.ts` = Fraktions-Konfiguration). **Referenz für alle Autoren:** [`varkan/lnd_t1_tank.ts`](varkan/lnd_t1_tank.ts) (Punze).
**Referenzen der neuen Fraktionen** (je der Kommandant, zeigt die Formen und Regeln der Fraktion):
[`skarn/cmd_commander.ts`](skarn/cmd_commander.ts) (Rädelsführer), [`sael/cmd_commander.ts`](sael/cmd_commander.ts) (Prior),
[`aurith/cmd_commander.ts`](aurith/cmd_commander.ts) (Kantor). Ordner = Slug (`skarn`, `sael`, `aurith`), IDs = Roster-Präfix
(`f2:`, `f3:`, `f4:`), Roster unter `docs/design/factions/f2|f3|f4/roster.json` (in `_faction.ts` eingetragen).

| Befehl | Zweck |
|---|---|
| `pnpm models` | baut alle Modelle → `content/models/dist/<fraktion>.<unit>.glb` + `.json` + `manifest.json`, schreibt die Icon-SVGs (`content/icons/svg`); Exit 1 bei Fehlern (`--check` = nur prüfen) |
| `pnpm models:viewer` | Model-Viewer (Vite, Port 5210 oder nächster freier): Galerie, Einzelansicht, Größenvergleich, Silhouetten, Icons |
| `tools/heavy pnpm models:shots` | Kontaktabzug, Silhouetten, Größenvergleich und Einzelbilder je Fraktion nach `/private/tmp/claude-501/faf-models/<fraktion>/` (`--faction`, `--no-singles`, `--smoke`) |
| `pnpm vitest run packages/modelkit` | DSL-Tests + Vertragstest: **jedes** Content-Modell baut fehlerfrei, im Budget, byte-deterministisch |

## Konventionen

- **Einheit:** 1 = 1 WU (≈ 19,5 m). **Ursprung** = Mitte des Footprints auf dem Boden (y = 0).
- **Achsen (glTF):** +Y oben, **+Z vorne (Bug/Mündung)**, rechtshändig ⇒ +X ist die *linke* Seite der Einheit.
  Der Spiel-Renderer hat Yaw 0 = +X; er dreht die GLBs bei der Integration um −90° um Y.
- **Maßstab:** Modelle werden in Basisgröße (T1) gebaut; der Roster-Maßstab (`kitbash.scale`, T2 1,3 …) wird beim
  Export eingebacken. Maße aus `roster.json` (`kitbash.description`) und `faction.md` übernehmen.
- **Roster-Vorgaben** werden automatisch gezogen (Name, Rolle, Klasse aus der Icon-Form, Tech, Footprint, Maßstab,
  Icon, Tris-Schätzung). Im Modell nur angeben, wenn bewusst abweichend (erzeugt eine Warnung).
- **Rotationen** in Grad, `rot: [x, y, z]`, angewendet X → Y → Z. Pitch „Nase hoch“ = negative X-Rotation.

## Parts (Animationsgruppen, PLAN §3.7)

Jeder Vertex trägt `_PARTID`. Part 0 ist immer `hull` (bewegt sich nur mit der Einheit); **bis zu 8 weitere Parts**
(PartStream-Limit) drehen um ihren `pivot` (Modellraum, WU) und folgen ihrer `parent`-Kette. Statische
Kitbash-Teile gehören alle zu `hull` – ein Part ist nur nötig, wenn sich etwas bewegt.

```ts
parts: [
  { name: 'hull', shapes: [...] },
  { name: 'turret', pivot: [0, 0.45, 0], anim: 'yaw', shapes: [...] },                    // PartStream 1
  { name: 'barrel', parent: 'turret', pivot: [0, 0.64, 0.24], anim: 'pitch', shapes: [...] }, // PartStream 2
]
```

Namen: `hull`, `turret`, `barrel`, `barrel_l`/`barrel_r`, `legs_l`/`legs_r`, `rotor`, `arm`, `boom`, `dish`,
`ring`, `ladle`, `fan` … (klein, `[a-z][a-z0-9_]*`). `anim`: `yaw`, `pitch`, `yawpitch`, `spin`, `legs`, `none`
(Metadaten für Render/Sim). Shapes eines Parts stehen im Modellraum, nicht relativ zum Pivot.

## Primitive

Alle zentriert auf ihre Bounding-Box (`at` = Mittelpunkt), außer `extrude` und `loftShape` (Profilkoordinaten
bleiben). Runde Primitive haben `axis: 'x' | 'y' | 'z'` (Standard `y`; Rohre: `axis: 'z'`).

| Funktion | Parameter | Hinweis |
|---|---|---|
| `box` | `size: [x, y, z]` | 12 Tris |
| `beveledBox` | `size`, `bevel: n \| {top, bottom, side, topFront, topBack, bottomFront, bottomBack}` | 45°-Fasen; Wanne/Sockel |
| `wedge` | `size`, `front?` (Höhe vorn) | Rampe: hinten hoch, vorn flach |
| `prism` | `sides`, `radius`, `height` | n-Eck, keine LOD-Reduktion |
| `cylinder` | `radius`, `height`, `segments=8`, `caps: true\|false\|'top'\|'bottom'` | verdeckte Deckel weglassen spart Tris |
| `frustum` / `cone` | `radius`, `radiusTop` / Spitze bei +Achse | |
| `sphere` | `radius`, `segments=8`, `rings`, `hemi` | `hemi` = Kuppel mit flachem Boden (Glocke) |
| `icosphere` | `radius`, `detail=1` | |
| `capsule` | `radius`, `length` (gesamt) | |
| `torus` | `radius`, `tube`, `segments=12`, `sides=4` | Ringe, Kränze |
| `tube` | `outer`, `inner`, `height`, `floor?` | Rohr/Kragen; mit `floor` offene Schale (Kelle) |
| `extrude` | `profile: [u, v][]`, `depth`, `axis='x'` | Profil beliebig (auch konkav): `x` → [z, y] Seitenansicht, `y` → [x, z] Draufsicht, `z` → [x, y] |
| `loftShape` | `rings: {y, pts}[]` | fortgeschritten: gestapelte Querschnitte |
| `quad` | `size: [x, z]` | einseitige Decal-Fläche nach +Y (Glutschlitze), ≥ 0,004 WU über der Fläche |

### Formen für Skarn, Sael, Aurith (`forms.ts`, `curves.ts`)

Punkt-zu-Punkt-Formen (`strut`, `spike`, `claw`, `sweep`, `limb`, `glyphStrip`) liegen auf den angegebenen Koordinaten,
`torusArc` sitzt im Ringmittelpunkt, alle übrigen sind wie die Primitive auf ihre Bounding-Box zentriert.

| Funktion | Parameter | Hinweis |
|---|---|---|
| `strut` | `from`, `to`, `radius`, `radiusEnd?`, `sides=4`, `caps` | verjüngter n-Kant zwischen zwei Punkten (Beinglied, Nadel, schräge Stütze); 3/4 Seiten bleiben in allen LODs |
| `spike` | `from` (Basis), `to` (Spitze), `radius`, `sides=4` | Dorn, Stachel, Nadelspitze, Spitzfuß |
| `claw` | `from`, `to`, `bend` (Versatz des Kontrollpunkts), `radius`, `segments=3` | gebogener, spitz zulaufender Dorn (Klaue, Stachel, Schwanzspitze) |
| `bipyramid` | `radius`, `length`, `front=0.5`, `sides=4`, `axis='z'` | Doppelpyramide: Skarn-Granatlinse, Splitter, Aurith-Spindel (`sides: 6`) |
| `plate` | `size: [x, z]`, `thickness`, `arch`, `archZ`, `segments=[4,2]`, `point` | gewölbte, facettierte Platte mit Dicke (Chitin-Rückenplatte; `point` spitzt vorn zu) |
| `sweep` | `path`, `radius` (Zahl, je Punkt, `[rx, ry]` oval), `sides=8`, `profile?`, `samples?`, `caps`, `open` | Profil entlang einer Kurve: organische Rümpfe (ovale Schnitte entlang z), Röhren, Schwänze, Spindeln. `samples` = glatte Catmull-Rom-Kurve (LOD 60/40 %); `open: true` + Bogenprofil = einseitige Fläche (Rockbahn) |
| `ellipsoid` | `radii`, `segments=10`, `rings`, `half`, `drop` | Halb-Ellipsoid mit flacher Unterseite (Sael-Schale, Aurith-Kiel), `drop` = Tropfenform (Bug schmaler) |
| `lens` | `radius`, `thickness`, `length?` | flache Linse (Aurith-Sockel, Gondeln; Sael-Laterne mit `axis: 'z'`) |
| `disc` | `radius`, `height`, `bevel`, `segments=12` | Scheibe mit gerundetem Rand: Schwebeteller, Schwirrscheibe (`segments: 6`) |
| `torusArc` | `radius`, `tube`, `arc=120`, `startDeg`, `taper`, `flatten`, `sides=4` | Torus-Bogen: Sichel (`taper: 0` = Spitze), Halo, Bogen, Harfe; Winkel von +X nach +Z, Standard mittig vorn |
| `domeShell` | `radius`, `thickness`, `arc=90` | hohle Kugelkappe: Muschel, Apsis, Zisterne (umgedreht), Radarschale |
| `crystal` | `radius`, `height`, `tip`, `bottomTip`, `taper`, `sides=6` | Prisma mit Pyramidenspitze (Resonanzkristall, Druse, Splitter) |
| `crystalCluster` | `count=3`, `radius`, `height`, `spread`, `lean`, `seed` | deterministische Kristallgruppe, steht auf y = 0 der Gruppe (Krone, Druse, Resonator) |
| `glyphStrip` | `path`, `normal`, `width=0.06`, `pattern`, `widths`, `lift` | Strichfolge aus Decals entlang einer Flächenlinie: Glyphenbänder, Licht- und Nervennähte (`glow2`) |
| `limb` | `joints` (Hüfte → Knie → … → Fuß), `radius` (je Gelenk), `sides=4`, `hipCap`, `jointCaps` | statische Gliederkette; `radius` 0 am letzten Gelenk = Spitzfuß |
| `legJoints` | `hip`, `foot`, `{kneeAt, kneeUp, kneeBack}` | Hüfte/Knie/Fuß; `kneeUp` = Spinnenknie (Skarn), `kneeBack` = rückwärts geknickt (Aurith) |
| `legPairs` | `hips` (linke Seite), `footOut`, `splay`, Knie-Optionen, `radius` | gespiegelte Beinsätze → `{left, right, joints, pivotL, pivotR}` für die Parts `legs_l`/`legs_r` |
| `limbParts` | `name`, `parent`, `joints`, `radius`, `anim='pitch'` | animierte Gliederkette: ein Part je Glied (`name_0`, `name_1`, …), Pivot am Gelenk, Parent = voriges Glied (T4-Läufer, Kranarme) |

Kurven-Helfer: `bezier`, `catmullRom`, `arcPoints`, `pathFrames` (rotationsminimierende Rahmen; bei waagerechten Pfaden
ist die Profil-v-Achse oben).

**Weiche Normalen:** `smooth: true` (Knickwinkel 80°) oder eine Gradzahl am Part oder an einer Shape (Shape gewinnt,
Gruppen vererben). Innerhalb einer Shape werden Normalen gemittelt, Kanten über dem Knickwinkel bleiben hart (Deckel,
Unterseiten). `smoothGroup: 'name'` glättet mehrere Shapes eines Parts gemeinsam über ihre Nähte (Teamflächen bündig in
einer Schale). Varkan und Skarn bleiben Flat Shading (Standard).

**Komposition:** `group([...], place)`, `mirrorX(shapes)` (Original + Spiegelbild an x = 0), `flipX(shapes)`
(nur Spiegelbild), `array(shape, {count, step, center})`, `radial(shape, {count, axis, startDeg, stepDeg})`,
`stripes({count, width, at})` (Tech-Streifen 0,10 WU, Abstand 0,10 WU, Material `accent`).

**Platzierung/Flags (alle Shapes und Gruppen):** `at`, `rot`, `scale` (Zahl oder Vektor), `mat`, `keep`
(nie automatisch entfernen), `maxLod` (nur bis zu diesem LOD), `minLod` (erst ab diesem LOD, z. B. vereinfachter
Ersatzblock in LOD2), `tag` (Kitbash-Teil aus faction.md §3.3 für Lints/Statistik). Gruppen vererben `mat` und
die LOD-Flags an Kinder ohne eigene Angabe.

## Materialien

Generische Slots → `COLOR_0` (linear) + `_MASK` (RGBA u8: R Teamfarbe, G Glut/Emissive, B Metallic, A AO/Ruß,
aus der Flächennormalen gebacken). Die Fraktion benennt die Slots in `_faction.ts` (`aliases`).

| Slot | Maske | Varkan (`#sRGB`) | Alias |
|---|---|---|---|
| `base` | – | Gusseisen `#2E2B29` | `body`, `iron` |
| `dark` | – | Unterseiten/Fahrwerk/Rohre `#1E1C1B` | `soot` |
| `metal` | B 0,8 | Kupfer `#B06A3B` | `copper` |
| `team` | R 1 | `#FFFFFF` × Teamfarbe im Shader | |
| `glow` | G 1 | Glut `#FF9A3C` (Weißglut `#FFE9C0` bei Rot/Orange) | |
| `glass` | B 0,2 | `#3B4A4F` | |
| `accent` | – | Keramik `#CFC6B4` (Tech-Streifen, Engineer-Deck) | `ceramic` |

Faction-Regeln (Varkan, faction.md §4): Teamfarbe ≥ 30 % der Draufsicht (mobil Land), Glutnaht ≤ 2 % der
Oberfläche bei Kampfeinheiten, Glutkern/`stack` nur bei Flow-Einheiten, Kupfer ≈ 8–12 %. Der Viewer zeigt
Materialflächen und den Team-Anteil der Draufsicht (orthografisch mit Verdeckung) je Modell.

### Paletten der Fraktionen

Die Paletten liegen im Kit (`packages/modelkit/src/palettes.ts`: `VARKAN_PALETTE`, `SKARN_PALETTE`, `SAEL_PALETTE`,
`AURITH_PALETTE`, `PALETTES`, `paletteByName`); `_faction.ts` setzt die Standardpalette der Fraktion. **Pro Modell
wählbar:** `defineModel({ palette: 'sael', … })` (Name) oder `palette: definePalette({...})` (eigene). Zu den sieben
Kern-Slots kommen zwei optionale Slots, die nur Paletten haben, die sie brauchen: `accent2` (zweiter Akzent) und
`glow2` (zweites, schwächeres Licht, Glut-Stärke 0,6). Farben aus den faction.md §4.1.

| Slot | Skarn „Kluftwuchs“ | Sael „Schichtung“ | Aurith „Gesungenes Glas“ |
|---|---|---|---|
| `base` | Schwarzchitin `#18171C` (glänzend) · `chitin`, `body` | Perlmutt `#E4DED2` · `nacre`, `body` | Pechglas `#1F1B22` · `pitch`, `body` |
| `dark` | Unterseiten `#0E0D11` · `underside` | Schalenrinde `#26302C` · `rind` | Unterseiten `#141117` |
| `metal` | Sehne `#6E1A22` · `sinew` | Gold `#C8A24A` · `gold` | Bernsteinglas `#C8912E` · `amber` |
| `team` | Rückenplatte | Emaille-Einlage · `enamel` | Kamm, Oberschale |
| `glow` | Granatglut `#FF5A74` (Herzkern) | Goldkern `#F6CF6A` · `light` | Resonanzkern `#8AD8FF` · `phase` |
| `glass` | Granatglas `#3A0F18` · `garnet`, `lens` | Laternenglas `#A9C7BE` | Bernstein-Tiefe `#8A5A18` · `amberdeep` |
| `accent` | Quarz `#D6D3DC` · `quartz` | Tiefjade `#1E4A40` · `jade` | Perlglas `#D5DCE2` · `pearl` |
| `accent2` | Krustengrau `#3A3634` · `crust` | Perlglanz `#F5F1E8` · `lustre` | Bernstein-Kante `#E8C070` · `amberedge` |
| `glow2` | Nervennaht `#E0203F` · `nerve` | Jade-Lichtnaht `#7FE3C0` · `seam` | Glyphenband `#3FA9FF` · `glyph` |
| Teamkonflikt (`teamAlt`) | Rot/Pink: Glut → `#FFE0E8` | Orange/Oliv: Goldkern → `#F6F3FF`; Grün/Cyan: Jade → `#DCE6EE` | Blau/Cyan: Licht → `#EAF7FF`; Orange/Oliv: Bernstein → Rauchquarz `#8A8174` |

`teamAlt` ist reine View-Information: das GLB trägt die Standardfarbe, Manifest und Viewer tauschen je Armee (Varkan:
Rot/Orange → Weißglut). Der Viewer nimmt die Leuchtfarbe jetzt aus der Vertexfarbe der Glut-Slots, also je Fraktion.

### Stilregeln je Fraktion (Kurzfassung, Details in `docs/design/factions/f2|f3|f4/faction.md` §3–§5)

**Skarn (Kluftwuchs)**
1. Streng eckig, keine Kurven, Flat Shading: Rümpfe als `sweep` mit eckigem Sechskant-Profil (Firstkante) oder
   `plate`/`extrude`, Höhe ≤ 0,35 × Rumpflänge, Bugspitze vorn.
2. Alles auf Knickbeinen (`legPairs`, `kneeUp`: Knie über der Rumpfoberkante, Füße auf 1,4–1,8 × Rumpfbreite
   gespreizt); Beinzahl = Gewicht (2 leicht, 4 Linie, 6 T3/Kommandant); Beinglied-Kantenbreite ≥ 0,17 WU (4-Kant
   Radius ≥ 0,12).
3. Flach = Körper, Spitz = Werkzeug: Granatlinse (`bipyramid`, `garnet`) waagerecht = Direktfeuer, Dornen (`spike`)
   senkrecht = AA, Schwanz (`claw`/`sweep`) schräg = Artillerie, Quarz-Nadeln (`limb`) = Bauen.
4. Teamfarbe auf Rückenplatten (≥ 80 % der Panzeroberseite); Glut (`glow`) nur Flow-Einheiten (Druse
   `crystalCluster`, Spulenachse), sonst höchstens Nervennähte (`nerve`) ≤ 2 %.

**Sael (Schichtung)**
1. Rund = Körper, Spitz = Waffe: Schalen aus `ellipsoid` (`half`, `drop`), keine Fasen, keine rechten Winkel; alle
   Körper-Parts `smooth: true`, Nähte zwischen Team- und Perlmuttflächen per `smoothGroup`.
2. Schweber stehen auf einem dunklen Schwebeteller (`disc`), der die Schale um 8–12 % überragt; das Modell wird auf
   y = 0 gebaut, die Schwebehöhe kommt aus dem Roster (`hover`, siehe unten).
3. Hell oben, dunkel unten: Perlmutt oben, Schalenrinde/Tiefjade unten; Teamfarbe als Emaille-Einlage bündig in der
   Schale (≥ 30 % Draufsicht, Prior ≥ 35 %).
4. Gold nur als Kante/Lanzenschaft (≤ 8 %, Engineers/Prior bis 20 %); Goldkern (`glow`) nur Flow-Einheiten
   (Sichel `torusArc`, Laterne), Jade-Lichtnaht (`seam`, `glyphStrip`) ≤ 2 %.
5. Waffen spitz: Lanze (`cone`, waagerecht) = direkt, Horn (`frustum`) 50° = indirekt, Stachel (`spike`) ≥ 75° = AA.

**Aurith (Gesungenes Glas)**
1. Kurve = Körper (Kiel `ellipsoid half drop`, Spindel `sweep` mit ovalen Schnitten, `smooth`), Gerade = Waffe
   (Gabelzinken als gerade `cylinder`, Pfeifen, Trichter) – Waffen flat.
2. Hoch und schlank (Höhe ≥ 0,6 × Rumpflänge), Kamm (`extrude`-Bogen, Teamfarbe, ≥ 0,17 WU dick) läuft immer nach
   hinten aus; Gleiter schweben mit `hover: GLIDE_HEIGHT` (0,25 WU), Läufer auf drei rückwärts geknickten Beinen
   (`legJoints` mit `kneeBack`).
3. Bernstein (`amber` + `amberedge`) 25–35 % der Fläche, Pechglas für Kern/Unterseiten/Beine, Perlglas nur Engineers,
   Kantor-Sichel und Tonpunkte.
4. Leuchten: Glyphenbänder (`glyphStrip`, `glyph`) ≤ 3 % auf allen Einheiten; Kristalle (`crystal`,
   `crystalCluster`, `glow`) nur Flow-Einheiten (Resonanz-Monopol).
5. Gebäude dreizählig (Dreipass aus drei `lens`), mobile Einheiten längs spiegelsymmetrisch (nur Sichel asymmetrisch).

### Schweben: Hover-Offset-Konvention

Schwebe- und Gleiteinheiten werden **auf dem Boden stehend** gebaut (Unterkante Teller/Kiel auf y = 0). `hover` (WU,
Spielmaß) hebt beim Build Geometrie und Pivots **nach** dem Roster-Maßstab an, das GLB schwebt also schon auf
View-Höhe, und alle Werkzeuge zeigen den Spalt. Quelle: `defineModel({ hover })`, sonst Roster
`motion.hoverHeightView` (Sael, `gait: 'hover'`); Konstanten `HOVER_HEIGHT` (T1 0,25 / T2 0,30 / T3 0,35 / T4 0,45),
`GLIDE_HEIGHT` 0,25 (Aurith), `HOVER_BOB` ±0,03 WU, `HOVER_PERIOD_S` 3 s. Metadaten und Szene-`extras.faf` tragen
`hover` (nur bei Schwebern); der Renderer addiert nur das Wippen und legt Schatten/Schwebelicht auf y = 0. Warnung,
wenn ein Schwebemodell unter seine Schwebehöhe reicht.

## LODs und Budgets

LOD0 = Modell wie definiert. **Automatisch** für LOD1/LOD2: Shapes kleiner als 8 % / 16 % der größten
Modellausdehnung entfallen (außer `keep`), Segmentzahlen runder Primitive ≈ 60 % / 40 % (gerade, min. 4),
`extrude`-Profile verlieren kleine Ecken, `beveledBox` verliert in LOD2 Seitenfasen und Fasen unter 16 %.
Umschaltdistanzen (PLAN §3.9 `view.lod`) Standard 60 / 180 WU; das Strategic Icon ersetzt das Mesh unter
`iconThreshold` = 25 px Bildschirmlänge (faction.md §3.2).

| Klasse | LOD0 | LOD1 | LOD2 |
|---|---|---|---|
| land, air, eng, cmd, struct, naval | 350 | 220 | 110 |
| wall | 64 | 40 | 24 |
| **T4** (`tech: 4`, jede Klasse; `T4_BUDGET`) | 1.500 | 800 | 320 |

T4 (Experimentals) nutzen außerdem die LOD-Distanzen `T4_LOD_DISTANCES` 120 / 360 WU. Fraktionen überschreiben das
T4-Budget mit `budgets: { t4: … }` in `_faction.ts` (Skarn: 1.200 / 700 / 350 laut `f2/experimentals.md` §2.4).
Große Beinsätze in LOD0/LOD1/LOD2 staffeln: 4-Kant mit Deckeln (`maxLod: 0`), 3-Kant ohne Kniedeckel
(`jointCaps: false`, `minLod: 1`), in LOD2 notfalls gerade Hüfte-Fuß-Striche (Beispiele in den drei Kommandanten).

LOD0 ≤ 350 ist die Roster-Obergrenze (faction.md §3.3). Budgetüberschreitung, ungültige Geometrie, mehr als
8 animierte Parts, unbekanntes Material oder falscher Dateiname sind **Fehler** (`pnpm models` bricht ab).
**Warnungen:** Footprint-Check (mobil ≤ 200 % der Footprint-Kante, Strukturen 70–105 %), fehlende Teamfarbe,
Abweichung vom Roster, Part ohne Dreiecke, LOD mit mehr Tris als der vorige.

## Export

GLB (glTF 2.0, byte-deterministisch): Knoten `lod0…lod2`, je ein Primitive mit `POSITION`, `NORMAL` (Flat
Shading, weich bei `smooth`), `COLOR_0`, `_PARTID` (u8), `_MASK` (u8 normalisiert VEC4), Indizes u16. Szene-`extras.faf`: id,
Fraktion, Parts (Name, Parent, Pivot, Anim), LOD-Distanzen, Icon. Metadaten-JSON: Bounds, Footprint-Check,
Tris/Vertices je LOD und je Part, Materialflächen, Team-Anteil, Budget, Warnungen, SHA-256.

## Neues Modell in 5 Schritten

1. Roster-Eintrag lesen (`kitbash.description`, `parts`, Maßstab) und Silhouetten-Regeln der Rolle (faction.md §5).
2. `lnd_t1_tank.ts` kopieren, Datei nach der Unit-ID benennen, Parts/Shapes anpassen.
3. `pnpm models` – Tris und Hinweise in der Tabelle prüfen.
4. `pnpm models:viewer` – Teamfarben, Silhouette, Distanz/Icon, Größenvergleich ansehen.
5. `pnpm vitest run packages/modelkit` (Vertragstest) und `tools/heavy pnpm models:shots --faction <slug>`.

Neue Fraktion: Ordner `content/models/<slug>/` mit `_faction.ts` (Palette, Aliase, Roster-Pfad; Standard
`docs/design/factions/<slug>/roster.json`). Ohne `_faction.ts` gilt eine neutrale Palette. Für Skarn, Sael und Aurith
existieren `_faction.ts` und je ein Referenz-Kommandant; weitere Modelle: Kommandant der Fraktion als Vorlage kopieren.

**Rückwärtskompatibilität:** Der Vertragstest prüft, dass alle 50 Varkan-GLBs und Metadaten-JSONs bytegleich zum
Stand vor der Kit-Erweiterung bleiben (`packages/modelkit/test/fixtures/varkan.sha256.json`, neu erzeugen nur bei
gewollten Varkan-Änderungen: `npx tsx packages/modelkit/scripts/varkan-hashes.ts --write`).
