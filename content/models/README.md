# Einheiten-Modelle (Kitbash-DSL `@faf/modelkit`)

Ein Modell pro Datei: `content/models/<fraktion>/<unit>.ts` mit `export default defineModel({...})`. Der Dateiname
ist der Unit-Teil der Blueprint-ID (`lnd_t1_tank.ts` ↔ `core:lnd_t1_tank`). Dateien mit `_` am Anfang sind keine
Modelle (`_faction.ts` = Fraktions-Konfiguration). **Referenz für alle Autoren:** [`varkan/lnd_t1_tank.ts`](varkan/lnd_t1_tank.ts) (Punze).

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

LOD0 ≤ 350 ist die Roster-Obergrenze (faction.md §3.3). Budgetüberschreitung, ungültige Geometrie, mehr als
8 animierte Parts, unbekanntes Material oder falscher Dateiname sind **Fehler** (`pnpm models` bricht ab).
**Warnungen:** Footprint-Check (mobil ≤ 200 % der Footprint-Kante, Strukturen 70–105 %), fehlende Teamfarbe,
Abweichung vom Roster, Part ohne Dreiecke, LOD mit mehr Tris als der vorige.

## Export

GLB (glTF 2.0, byte-deterministisch): Knoten `lod0…lod2`, je ein Primitive mit `POSITION`, `NORMAL` (Flat
Shading), `COLOR_0`, `_PARTID` (u8), `_MASK` (u8 normalisiert VEC4), Indizes u16. Szene-`extras.faf`: id,
Fraktion, Parts (Name, Parent, Pivot, Anim), LOD-Distanzen, Icon. Metadaten-JSON: Bounds, Footprint-Check,
Tris/Vertices je LOD und je Part, Materialflächen, Team-Anteil, Budget, Warnungen, SHA-256.

## Neues Modell in 5 Schritten

1. Roster-Eintrag lesen (`kitbash.description`, `parts`, Maßstab) und Silhouetten-Regeln der Rolle (faction.md §5).
2. `lnd_t1_tank.ts` kopieren, Datei nach der Unit-ID benennen, Parts/Shapes anpassen.
3. `pnpm models` – Tris und Hinweise in der Tabelle prüfen.
4. `pnpm models:viewer` – Teamfarben, Silhouette, Distanz/Icon, Größenvergleich ansehen.
5. `pnpm vitest run packages/modelkit` (Vertragstest) und `tools/heavy pnpm models:shots --faction <slug>`.

Neue Fraktion: Ordner `content/models/<slug>/` mit `_faction.ts` (Palette, Aliase, Roster-Pfad; Standard
`docs/design/factions/<slug>/roster.json`). Ohne `_faction.ts` gilt eine neutrale Palette.
