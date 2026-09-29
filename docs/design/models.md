# Einheiten-Modelle: Kitbash-Kit, Konventionen, Stand

**Stand 2026-09-29, Branch `models2`: alle vier Fraktionen vollständig (214 Modelle, davon 15 T4).** Die Modelle sind reine Content-Daten mit Werkzeugen. Ins Spiel
(`packages/render`, `packages/sim`, `packages/client`) ist noch nichts integriert, das passiert in den
Meilensteinen (siehe Abschnitt 4). Detailbeleg: [`docs/status/MODELS-foundation.md`](../status/MODELS-foundation.md).
Anleitung für Autoren: [`content/models/README.md`](../../content/models/README.md).

## 1. Kit

| Teil | Ort | Zweck |
|---|---|---|
| Kitbash-DSL | `packages/modelkit` (`@faf/modelkit`) | 14 Primitive + 18 Formen für Skarn/Sael/Aurith (Streben, Dornen, Klauen, Doppelpyramiden, Chitin-Platten, Sweeps entlang Kurven, Ellipsoide/Linsen/Scheiben/Torus-Bögen/Kuppelschalen, Kristalle/Kristallgruppen, Glyphenbänder, Gliederketten mit Gelenk-Pivots), Fraktionspaletten mit Teamkonflikt-Tausch, weiche Normalen pro Part/Shape/Glättungsgruppe, Hover-Konvention, T4-Budget, Komposition (`group`, `mirrorX`, `array`, `radial`, `stripes`), Parts mit Pivot/Parent/Anim, Materialslots, Flat Shading, Auto-LODs, Budgets, Footprint- und Teamflächen-Check, GLB-Export (byte-deterministisch) |
| Modelle | `content/models/<fraktion>/<unit>.ts`, `_faction.ts` | ein Modell pro Blueprint, Auto-Discovery, Roster-Vorgaben (Name, Klasse, Footprint, Maßstab, Icon) aus `roster.json` |
| Build | `pnpm models` (`--check` = nur prüfen) | `content/models/dist/<fraktion>.<unit>.glb` + `.json` + `manifest.json`, Icon-SVGs nach `content/icons/svg/` |
| Icons | `content/icons/` (`grammar.ts`, `build.ts`) | Strategic Icons nach der Icon-Grammatik der Fraktion: 7 Grundformen, 19 Glyphen, Tech-Kerben 1–3, Varianten selected/blip/ghost |
| Viewer | `apps/model-viewer`, `pnpm models:viewer` | Galerie, Einzelansicht (Teamfarben, Grau/Silhouette, Parts-Animation, Drahtgitter, Distanz-Slider mit LOD- und Icon-Wechsel), Größenvergleich (Filter `u=`, `sel=t4`, `layout=line`), Icon-Übersicht |
| Screenshots | `tools/model-shots`, `tools/heavy pnpm models:shots` | Kontaktabzug, Silhouettenblatt (32/48 px), Größenvergleich (`compare.png`, `compare-t4.png`), Einzelbilder nach `/private/tmp/claude-501/faf-models/<fraktion>/`, Fraktionsvergleich `vergleich-fraktionen.png` (Kommandant, T1-Panzer, T3, T4 je Fraktion) |
| Tests | `packages/modelkit/test` | Primitive (geschlossen, orientiert, Volumen), LOD-Regeln, Parts, Masken, GLB-Inhalt, Determinismus; **Vertragstest**: jedes Content-Modell baut fehlerfrei, im Budget, deterministisch |

## 2. Konventionen (Vertrag für Render und Pipeline)

- **Raum:** 1 = 1 WU. Ursprung in der Footprint-Mitte am Boden. glTF-Achsen: +Y oben, **+Z vorne**. Der Renderer hat
  Yaw 0 = +X und dreht die GLBs beim Laden um −90° um Y.
- **Maßstab:** Modelle werden in T1-Basisgröße geschrieben, der Roster-Maßstab (`kitbash.scale`) wird beim Export
  eingebacken. Das GLB ist also in Spielgröße.
- **GLB-Layout:** Knoten `lod0`, `lod1`, `lod2`, je ein Primitive mit `POSITION`, `NORMAL` (Flat Shading),
  `COLOR_0` (linear), `_PARTID` (u8), `_MASK` (u8 normalisiert, RGBA = Team, Glut, Metallic, AO), Indizes u16.
  `extras.faf` der Szene: id, Fraktion, Parts, LOD-Distanzen, Icon.
- **Parts (PLAN §3.7):** Part 0 = `hull`, dazu höchstens 8 animierte Parts, die dem PartStream-Limit entsprechen. Jeder Part
  hat `pivot` (Modellraum), `parent` und `anim` (`yaw`, `pitch`, `yawpitch`, `spin`, `legs`, `none`). Der
  Vertex-Shader transformiert pro `_PARTID` mit den Winkeln aus dem PartStream, also ein Draw pro (visual, LOD).
- **Materialslots:** `base`, `dark`, `metal`, `team`, `glow`, `glass`, `accent`, mit Fraktions-Aliasen (Varkan:
  `iron`, `soot`, `copper`, `ceramic`). Die Teamfarbe kommt im Shader aus `_MASK.r`, die Glut (Emissive) aus `_MASK.g`.
- **LODs:** LOD1 und LOD2 entstehen automatisch: Kleinteile fallen weg (8 % bzw. 16 % der größten Ausdehnung),
  Segmente werden reduziert, Fasen und Profile vereinfacht. Steuerbar über `keep`, `minLod` und `maxLod`.
  Umschaltdistanzen: Standard 60 / 180 WU (`view.lod`). Unter `iconThreshold` (25 px) ersetzt das Strategic Icon das Mesh.
- **Budgets (Tris L0/L1/L2):** Einheiten und Gebäude 350 / 220 / 110, Mauer 64 / 40 / 24. Wird ein Budget
  überschritten, bricht `pnpm models` mit Fehler ab.
- **Prüfungen beim Build:** Fehler bei ungültiger Geometrie, mehr als 8 animierten Parts, unbekanntem Material oder falschem Dateinamen.
  Warnungen bei Footprint (mobil ≤ 200 % der Kante, Strukturen 70–105 %), fehlender Teamfarbe, Abweichung vom Roster
  und wenn ein LOD mehr Tris hat als der vorige.
- **Neue Fraktion:** `content/models/<slug>/_faction.ts` (Palette, Aliase, Roster-Pfad, Standard
  `docs/design/factions/<slug>/roster.json`) und die Modelldateien anlegen. Registry und Tests brauchen keine Änderung.

## 3. Stand je Fraktion

Alle vier Fraktionen sind vollständig modelliert: **214 Modelle**, davon 15 T4 (Experimentals, Post-MVP, aus
`experimentals[]` der Roster). `pnpm models` meldet 0 Warnungen, alle Modelle liegen im Budget, der Vertragstest ist grün.

| Fraktion | Modelle | davon T4 | Roster | Tris L0 Kern (min / Ø / max) | L1 Ø | L2 Ø | Tris L0 T4 (min / Ø / max, Budget) | GLB | Status |
|---|---|---|---|---|---|---|---|---|---|
| Varkan (`varkan/`, Roster `docs/design/roster.json`) | **50** (23 mobil, 27 Strukturen) | – | 50 / 50 | 52 / 276 / 348 | 172 | 84 | – (Roster ohne T4) | 2,7 MB | vollständig, visuell geprüft, bytegleich abgesichert |
| Skarn (`skarn/`, Roster `factions/f2`) | **55** (27 mobil, 28 Strukturen) | 5 | 50 / 50 + 5 / 5 | 64 / 231 / 346 | 166 | 88 | 714 / 862 / 1.058 (1.200 / 700 / 350) | 3,6 MB | vollständig, visuell geprüft (Review Skarn) |
| Sael (`sael/`, Roster `factions/f3`) | **55** (26 mobil, 29 Strukturen) | 5 | 50 / 50 + 5 / 5 | 58 / 297 / 350 | 158 | 79 | 940 / 1.270 / 1.484 (1.500 / 800 / 320) | 2,3 MB | vollständig, visuell geprüft (Review Sael) |
| Aurith (`aurith/`, Roster `factions/f4`) | **54** (25 mobil, 29 Strukturen) | 5 | 49 / 49 + 5 / 5 | 60 / 288 / 349 | 143 | 88 | 1.050 / 1.249 / 1.468 (1.500 / 800 / 320) | 2,9 MB | vollständig, visuell geprüft (Review Aurith) |

**T4 je Fraktion:**

| Fraktion | T4 (Rolle) |
|---|---|
| Skarn | Skolopender (Land-Angriff, Dauerstrahl, 14 Beine), Assel (schwerer Brutläufer, baut Einheiten), Tsetse (Kampfschweber, Luft), Bärenklau (mobile Game-Ender-Artillerie), Myzel (Eco) |
| Sael | Karkinos (Sturmläufer, Scherenschild), Ammonit (schwebende Festung mit Fabrik), Pelikan (Schwebeträger, Luft), Kreuzsee (Fernartillerie, Game-Ender), Perle (Eco) |
| Aurith | Hymne (Sturmläufer, Dreibein 9 WU), Ensemble (wandernde Halle: mobile Fabrik mit Schild und Artillerie), Heupferd (Bomber mit Flugabwehr, Luft), Tuba (Strategiewerfer, Game-Ender), Klangschale (Eco) |

Fraktionsvergleich (Kommandant, T1-Panzer, T3-Einheit und Land-T4 in einer Reihe): `tools/heavy pnpm models:shots`
→ `/private/tmp/claude-501/faf-models/vergleich-fraktionen.png`. Die vier Stile sind darin klar getrennt: Varkan
niedrig, kastig und dunkel mit Ketten; Skarn schwarzes Chitin auf Knickbeinen; Sael helle Perlmutt-Schalen auf
Schwebetellern; Aurith hoch, rund und bernsteinfarben mit Dreibein und blauem Kamm.

**Bekannte Schwächen (Skarn):**

- Kleine Gebäude (Egel, Druse, Wabe, Glimmzelle) sind aus der Spielkamera fast nur Krustenumrisse; man liest sie über Glut und Aufbau (wie bei Varkan).
- Langbein liegt mit 30 % Teamanteil genau an der Grenze. Der Doppelschwanz des Bärenklau liest sich als ein dicker Schwanz,
  die Assel-Beine sind etwas länger als in `f2/experimentals.md` beschrieben.
- Die Milbe (T2-Bot) wurde gegen den Floh über größere Flankenschilde abgesetzt; der Unterschied bleibt vor allem Größe und Schilde.

**Bekannte Schwächen (Sael):**

- Die Horn-Artillerie (Dünung, Brecher, Woge) zielt fast auf die 50°-Kamera und wirkt in der Silhouette klumpig; in Farbe ist die Mündung lesbar.
- Zisterne und Schrein unterscheiden sich nur in Farbe und Innenform (Höhenregel lässt keinen Umrissunterschied zu).
- Laterne II trifft das Budget genau (350 Tris). Läufer haben mehr als 2 animierte Parts (Beine), wie bei Varkan.

**Bekannte Schwächen (Aurith):**

- Teamanteil der Türme (Gabel I/II, Pfeifenwerk I/II, Großhorn, Hochorgel) liegt bei 31–36 % statt 20–30 %.
- Der Resonanzkern der Resonatoren macht 12–19 % der Fläche statt 3–6 % (Folge der Vorgabe Kristallhöhe ≥ 1,5 × Sockel).
- Engineers T1–T3: zweite und dritte Sichel sind klein, die Stufe liest man vor allem am Maßstab.
- Horn und Heerhorn lesen sich eher als dunkle facettierte Mündung als als Glockenrand; ein Randring sprengt beim Heerhorn (346/350) das Budget.

**Fraktionsübergreifend offen:**

- Varkan hat im Roster keine T4; im Fraktionsvergleich fehlt dort die vierte Einheit.
- Die T4-Budgets sind uneinheitlich: Skarn 1.200 / 700 / 350 (eigene Vorgabe in `f2/experimentals.md`), Sael und Aurith
  `T4_BUDGET` 1.500 / 800 / 320.
- Für T4 fehlen im Spiel noch: Beinzahlen 8/14 im Bein-Renderer, sizeClass 3 in der Wegfindung, Strahl-Waffentyp, Produktion
  aus mobilen Einheiten (Feature-ID fehlt in `features.json`), Icon-Token für strategische Raketen (Tuba: `struct_mml_t4`).

**Varkan nach Klasse (Tris L0 min/Ø/max, Teamanteil der Draufsicht):**

| Klasse | Anzahl | L0 | L1 max | L2 max | Team-Draufsicht | max. Parts |
|---|---|---|---|---|---|---|
| Land | 14 | 198 / 311 / 344 | 218 | 110 | 32,7–60,1 % | 5 |
| Luft | 5 | 200 / 275 / 340 | 220 | 88 | 44,7–58,9 % | 4 |
| Ingenieure | 3 | 194 / 260 / 326 | 206 | 108 | 31,3–38,7 % | 3 |
| Vogt | 1 | 348 | 218 | 96 | 54,4 % | 6 |
| Strukturen | 26 | 164 / 266 / 346 | 220 | 108 | 20,1–53,9 % | 3 |
| Mauer | 1 | 52 | 32 | 24 | 11,9 % | 1 |

Zusammen sind es 13.822 Tris in LOD0 und etwa 2,6 MB GLB (unkomprimiert, ohne meshopt). Alle Pflicht-Silhouettenpaare aus
faction.md §5.2 (9 für MS9, 7 für MS14) sind bei 32 und 48 px unterscheidbar.

**Bekannte Schwächen (Varkan):**

- **Glut unter der Vorgabe von 3–6 % der Oberfläche:** knapp darunter liegen Lehrling (1,8 %), Glutkessel I (2,3 %),
  Luftwerk I (2,4 %), Landwerk I (2,75 %) sowie Zapfstelle II und III (etwa 2,85 %). Optisch ist der Glutkern überall klar erkennbar.
- **Kelle und Pfanne:** Die Mindestwandstärke von 0,17 WU macht die Kelle etwas klotzig. In der Schrägansicht verschwindet der Schwenkarm
  unter der Kelle.
- **Hochofen:** erfüllt die Maße (Kelle Ø 3,0 WU, Steilrohr 7 WU), wirkt auf dem 8×8-Sockel aber klein, weil der Sockel
  größtenteils leer bleibt.
- **Glutspeicher:** Die Trommeln sind gestapelt, der Durchmesser liegt bei etwa 0,7 statt 0,8 × Kante. Gegen den Erzspeicher bleibt er unterscheidbar.
- **Animierte Parts:** faction.md erlaubt mobilen Einheiten höchstens 2. Das überschreiten Bots und Vogt (Beine, Turm, Rohr),
  Krähe (Rotor, Glocke, Rohr) und Dohle (2 Propeller). Das technische Limit von 8 halten alle ein. Die Regel muss entweder gelockert
  oder bei der Render-Integration über zusammengelegte Parts erfüllt werden.
- **Noch nicht umgesetzt:** Superset-Visuals mit Tech-Bitmaske (faction.md §3.3). Bisher gibt es ein Modell pro Blueprint.
  Tech-Streifen sind Decal-Geometrie, keine Maske. `_MASK.a` ist AO aus der Normalen, kein Ruß-Gradient. Icons liegen nur als
  SVG vor, der MSDF-Atlas fehlt noch.
- **Werkzeug:** Der Größenvergleich (`compare.png`) ist bei 8×8-Gebäuden neben kleinen Einheiten kaum lesbar; für T4 gibt es
  deshalb `compare-t4.png` und den Filter `u=` im Viewer.

## 4. Integrationsplan

### 4.1 Weg ins Spiel (einmalig, im ersten Meilenstein, der echte Meshes zeigt)

1. **Asset-Pipeline** (`tools/assets-pipeline`, `pnpm assets`): `content/models/dist/manifest.json` einlesen und jedes
   GLB als Asset vom Typ `model` registrieren, mit der logischen id **`units/<fraktion>/<unit>`**, z. B.
   `units/varkan/lnd_t1_tank`. Die id passt zu `ASSET_ID_PATTERN`. Bei der meshopt-Kompression müssen die Custom-Attribute
   `_PARTID` und `_MASK` sowie die drei LOD-Knoten erhalten bleiben. Das GLB ohne Kompression bleibt als `fallback` erhalten.
2. **Blueprints** (`content/blueprints/core/units/*.ts`): `view.mesh` zeigt auf diese id, die übrigen View-Felder
   kommen aus dem Metadaten-JSON (`lodDistances`, `icon`, `iconThreshold`). Den Platzhalter behält das Blueprint als Fallback:

   ```ts
   view: {
     mesh: 'units/varkan/lnd_t1_tank',
     lod: [60, 180],
     icon: 'land_direct_t1',
     iconThreshold: 25,
     placeholder: { hull: 'box', size: [1.0, 0.4, 1.4] },
   }
   ```

   Die Verknüpfung liegt nur im View, betrifft also `viewHash` und lässt `simHash` unverändert. Ein Test in `content/blueprints` sollte
   prüfen, dass jedes `view.mesh` im Modell-Manifest existiert und dass Parts und Anim zu den Waffen- und Motion-Daten passen.
3. **Render** (`packages/render`): GLB-Loader für `lod0` bis `lod2`, `_PARTID` in den PartStream-Pfad, `_MASK` in den
   bestehenden Maskenshader (R Team, G Glut, B Metallic, A AO), Yaw-Korrektur −90°. Die Pivots aus `extras.faf.parts`
   landen in einer Part-Tabelle pro Visual.
4. **Icons:** `content/icons/svg/` → MSDF-Atlas in der Asset-Pipeline → IconPass.

### 4.2 Welcher Meilenstein nutzt welche Modelle (Vorschlag, folgt PLAN §5)

| Meilenstein | Modelle (Varkan) | Zweck |
|---|---|---|
| MS3 Bewegung, Selektion, Strategic Zoom | Punze (Referenz), ggf. Stichel und Funke; Icons | Pipeline-Durchstich: GLB → Asset → `view.mesh`, LOD-Wechsel, Mesh → Icon-Crossfade |
| MS4 Eco-Kern | Vogt, Lehrling, Zapfstelle I, Glutkessel I | ACU baut Mex und Pgen; Bau-Dissolve (Gießen) auf echten Meshes |
| MS5 Kampf-Kern | Punze, Stichel, Funke, Vogt | Waffen-Parts (Turm yaw, Rohr pitch), Bot-Beine, Wracks |
| MS6 Mini-FA | Landwerk I, Kelle, Sieb, Erzspeicher, Glutspeicher | Fabrik-Loop, T1-Armee komplett |
| MS8 Tech-Aufstieg, Verteidigung | Geselle, Meißel, Rinne, Rüttelsieb, Zapfstelle II, Glutkessel II, Landwerk II, Riegel I/II, Rost I/II, Mauer | T2-Upgrades, Verteidigung |
| MS9 Erstes Skirmish | alle 26 ●-Modelle, dazu Hochrost und Dampfquelle | Abnahme U3 „lesbare Silhouetten“ mit dem Silhouettenblatt aus `models:shots` |
| MS10 Eco-Tiefe, Radar | Horcher I–III, Dampfquelle (Adjacency) | Radar, Radar-Blips |
| MS12 Luftkrieg | Luftwerk I/II, Lerche, Turmfalke, Dohle, Krähe, Elster | Bank-Rotation, Rotoren/Propeller (`spin`) |
| MS13 Schilde, T3, Artillerie | Schürze, Schirm II/III, Zange, Fallhammer, Reißnadel, Pfanne, Trommelsieb, Meister, Landwerk III, Zapfstelle III, Glutkessel III, Tiegel, Hochofen | Schilde, T3 und Artilleriestellungen |
| MS14 Voll-MVP | alle 50, 0 Platzhalter | Grafik-Politur: Superset-Visuals mit Tech-Bitmaske, Ruß-Gradient, Textur und Normal Map statt Geometrie-Details |

Im Spiel gelten die GLBs in `content/models/dist/` als Build-Artefakt (git-ignoriert). Die Asset-Pipeline sollte `pnpm models`
deshalb als Vorstufe aufrufen oder `@faf/modelkit` direkt verwenden.
