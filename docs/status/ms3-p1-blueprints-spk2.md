# ms3-p1-blueprints-spk2 – Blueprint-Compiler komplett (S6), Kategorien (G5), Platzhalter-Panzer, SPK2 (MS3, Welle 0)

Stand 2026-09-29. Feature-IDs: **S6** (datengetriebene Blueprints, alle Typen), **G5** (Kategorien im Einsatz), Spike
**SPK2** (Bewegungsgefühl, PLAN §4). Entscheidungen: `docs/DECISIONS.md` Punkte **MS3-22** (SPK2) und **MS3-23**
(sim.bin v2, view.json v2, iconThreshold, Größenklassen-Regel, Tech-Baum).

## Umgesetzt

| Teil | Inhalt | Dateien |
|---|---|---|
| Typen | `unit` (erweitert), `weapon`, `projectile`, `prop`, `effect` (nur View), `faction`, `aiProfile`; je TypeBox-Schema (strikt), abstrakte Variante (deep-partial, strikt), `define*`-Helfer, `extends` nur innerhalb eines Typs, Merge-Patches für alle Typen, Namespace-IDs global eindeutig | `packages/blueprints/src/{define,schema}.ts` |
| Semantik | Referenzen existieren und haben den richtigen Typ (nicht abstrakt, kein `test:` aus Spiel-Content), MVP-Layer (Bewegung und Ziel-Layer), Größenklassen-Regel, fahrende Units brauchen accel/turnRate, Kategorie-Ausdrücke mit Position, zyklusfreier Tech-Baum mit Zykluspfad, i18n-Keys in de **und** en, Behavior-/Toggle-Registry (leer), Balancing-Gate-Framework (T3-Artillerie ≤ 40 % der kleinsten Kartendiagonale), strikter Spiel-Content (registriertes Icon, genau eine TECHn-Kategorie). Alle Fehler gesammelt mit JSON-Pointer | `packages/blueprints/src/compiler.ts` |
| Ausgabe | **sim.bin v2** (Waffen, Projektile, Mounts, Prioritäten, Kategorie-Bytecode, Props, Fraktionen), **view.json v2** (Icons, Tech, Kategorien, Auswahlradius, Turm, Effekte), bundle.json v2, hashes.json | `src/simbin.ts`, `src/view.ts` |
| HMR-Vertrag | `compileBlueprintModules(modules, locales, opts)` ohne Dateisystem; die CLI nutzt denselben Weg | `src/compiler.ts`, `scripts/{compile,content}.ts` |
| Locales | typisierte flache Tabellen `content/locales/{de,en}.json` (Schema `LocaleTableSchema`, `validateLocaleTable`) | `src/locales.ts`, `content/locales/*` |
| G5 | `registryFromBitOrder`, `maskFromNames`, `CategoryFilter`, `evaluateCategoryExpr`, `categoryExprMatchesNames`, `matchesMaskCode` (Pool-Bytecode), `validateCategoryCode` | `packages/rules/src/{filter,expr}.ts` |
| Content | Fraktion `core:faction_core`, T1-Landfabrik, 5 Platzhalter-Panzer mit Rumpf + Turm, 6 Waffen, 5 Projektile, 6 Effekte, 3 Props, KI-Profil; `core:cube` unverändert (Sim-ID 0) | `content/blueprints/core/**` |
| SPK2 | Float64-Prototyp, 6 Szenarien, Metriken, Sweep, Spuren + Canvas2D-Viewer, `SPK2_PARAMS` | `tools/headless/src/spk2/*`, `scripts/spk2.ts`, `spk2/viewer.html` |

## Schema-Übersicht (Blueprint-Felder)

Alle Typen: `id` (`ns:name`), `extends?` (gleicher Typ), `abstract?`. `null` in einem Patch/Kind löscht einen geerbten
Wert; in einer Wurzel-Definition bedeutet `null` „nicht gesetzt“ (z. B. `deathWeapon: null`).

| Typ | Felder (Einheiten) |
|---|---|
| `unit` | `categories[]`; `sim.health.max`; `sim.motion {layer, speed WU/s, accel WU/s², turnRateDeg °/s, sizeClass 0–7, footprint [w,h], maxSlope, radius? WU, mass? (int ≥ 1), turnInPlace?, brake? WU/s²}`; `sim.intel.vision?`; `sim.economy? {mass, energy, buildTime (int), buildableBy? (Kategorie-Ausdruck)}`; `sim.weapons?[] {id, ref, part hull\|turret, arcDeg, yawRateDeg, layers[], priorities[] (Ausdrücke)}`; `sim.hitbox? [x,y,z]` (Default 2·radius je Achse); `sim.wreck? {massFraction, hpFraction}`; `sim.deathWeapon?`; `sim.veterancy? default\|none`; `sim.upgradesTo?`; `sim.behaviors?[]`; `sim.toggles?[]`; `view {placeholder {hull, size, color?, turret? {hull, size, offset}}, mesh?, lod?, icon?, iconThreshold?, selectionRadius?, hotkeySlot? (A–Z/0–9), fx? {slot: effect}, nameKey?, descKey?}` |
| `weapon` | `sim {range WU, minRange?, damage (int), damageRadius?, reloadSec, muzzleVelocity WU/s, projectile, salvo (int), salvoIntervalSec?}`, `view? {fx? {muzzle, impact, …}}` |
| `projectile` | `sim {kind linear\|ballistic\|homing, speed WU/s, gravity? WU/s² (nur ballistic, dort > 0), lifetimeSec, turnRateDeg? (nur homing, dort Pflicht)}`, `view? {shape?, size?, color?, trailFx?}` |
| `prop` | `sim {reclaim {mass, energy (int), timeSec}, blocksShots, footprint [w,h] (0 = blockiert nicht), health?}`, `view {placeholder, mesh?, lod?}` |
| `effect` | `view {kind flash\|burst\|trail\|decal, color, size WU, durationSec, count?}` (nie in sim.bin) |
| `faction` | `units[]`, `startUnit` (∈ units), `color`, `nameKey?` (Default `faction.<ns>.<name>.name`) |
| `aiProfile` | `build[] / attack[] {id, categories (Ausdruck), weight 0–100}`, `nameKey?` (Default `ai.<ns>.<name>.name`); nur Schema + Validierung, nicht in sim.bin |

Umrechnung (nur im Compiler, round-half-up): pro Sekunde → pro Tick, ° → Ang16, Dezimal → Fx; Sekunden → Ticks
(`secondsToTicks`, > 0 bleibt ≥ 1); `halfArc = arcDeg · 65536 / 720` (360° ⇒ 32768 = rundum).

## sim.bin v2 (little-endian, Abschnitte 4-B-aligned)

Kopf 48 B: 0 magic `'IFBP'` · 4 version u16 = **2** · 6 headerBytes u16 = 48 · 8 unitCount · 10 unitRecordBytes (64) ·
12 categoryCount · 14 categoryWords (4) · 16 unitsOffset · 20 categoryNamesOffset · 24 unitIdsOffset · 28 totalBytes ·
**32 sectionDirOffset u32 · 36 sectionCount u16** · 38–47 reserviert. Danach das Sektionsverzeichnis (16 B je Eintrag:
tag 4CC, offset, byteLength, count u16, stride u16), die Unit-Records, die Stringtabellen (Kategorien, Unit-IDs) und die
Sektionen.

UnitRecord (64 B, Index = Sim-ID): **v1-Felder unverändert** (0 speed, 4 accel, 8 turnRate, 10 layer, 11 sizeClass,
12 maxHp, 16 radius, 20 vision, 24 maxSlope, 28/29 footprint, 32 Kategorie-Maske u32×4) plus 30 `flags` (Bit 0
turnInPlace), 48 `mass` u16, 50 `upgradesTo` u16, 52 `brakePerTick` i32 (Fx/Tick²), 56 `buildableBy` u16 (Ausdruck),
58 `deathWeapon` u16, 60 `firstMount` u16, 62 `mountCount` u8, 63 `veterancy` u8 (0 none, 1 default); 0xFFFF = keine.

| Sektion | Record | Inhalt |
|---|---|---|
| `UEXT` | 32 B je Unit | massCost, energyCost, buildTime (int), wreckMass/wreckHp (Fx-Anteil, 4096 = 1), hitbox x/y/z (Fx) |
| `WPNR` / `WPNI` | 32 B | range, minRange, damageRadius (Fx), damage, reloadTicks u16, salvo u16, muzzleVelocity (Fx/Tick), projectile u16, salvoIntervalTicks u16 / IDs |
| `PRJR` / `PRJI` | 16 B | kind u8 (0 linear, 1 ballistic, 2 homing), turnRate u16 (Ang16/Tick), speed (Fx/Tick), gravity (Fx/Tick²), lifetimeTicks / IDs |
| `MNTR` | 16 B | unit, weapon, halfArc (Ang16), yawRate (Ang16/Tick), layerMask (Bit = MotionLayer), part (0 hull, 1 turret), priorityFirst, priorityCount; je Unit zusammenhängend |
| `PRIO` | u16-Liste | Ausdrucks-Indizes der Zielprioritäten (erste Übereinstimmung gewinnt) |
| `CEXT` / `CEXC` / `CEXS` | 8 B / i32-Pool / Texte | Ausdrucks-Tabelle (codeOffset, codeLength, maxDepth), Bytecode-Pool (@faf/rules `ExprOp`), Quelltexte (u16-Länge); Index = Position des Quelltexts in Code-Unit-Ordnung |
| `PRPR` / `PRPI` | 24 B | maxHp (0 = unzerstörbar), reclaimMass, reclaimEnergy, reclaimTicks, footprint w/h, flags (Bit 0 blocksShots) / IDs |
| `FACR` / `FACU` / `FACI` | 8 B / u16-Liste / Texte | startUnit, unitCount, unitFirst / Unit-Sim-IDs / IDs |

**v1-Kompatibilität:** `decodeSimBin` liest v1 (MS1/MS2) weiter und setzt die v2-Defaults (Masse aus der Größenklasse,
`turnInPlace` für Land, `brake = accel`, Hitbox = Kollisionsdurchmesser, keine Referenzen), `table.version === 1`
(Test mit dem MS2-sim.bin, simHash 0xD4135AF1). Jede andere Version: `RangeError('sim.bin: unsupported version N (this
build reads 1..2)')`. Unbekannte Sektions-Tags werden übersprungen.

## `SimBpTable` (Vertrag für ms3-p2, quellkompatibel)

Unverändert: `count`, `simHash`, `ids`, `categoryNames`, alle v1-Spalten und -Accessoren (`speedPerTick`, `accelPerTick`,
`turnRatePerTick`, `maxHp`, `radius`, `vision`, `maxSlope`, `layer`, `sizeClass`, `footprintW/H`, `categories`,
`categoryWord`, `categoryOffset`, `idOf`, `indexOf`, `has`). Neu:

- `version`; Spalten `massCol` (u16), `turnInPlaceCol` (u8), `brakeCol` (i32 Fx/Tick²), `upgradesToCol`,
  `buildableByCol`, `deathWeaponCol` (i32, −1 = keine), `veterancyCol`, `firstMountCol`, `mountCountCol`,
  `massCostCol`, `energyCostCol`, `buildTimeCol`, `wreckMassCol`, `wreckHpCol`, `hitboxCol` (3 je Unit).
- Accessoren `mass(bp)`, `turnInPlace(bp)`, **`brakePerTick(bp): Fx`**, `upgradesTo`, `buildableByExpr`, `deathWeapon`,
  `veterancy`, `firstMount`, `mountCount`, `massCost`, `energyCost`, `buildTime`, `wreckMassFraction`,
  `wreckHpFraction`, `hitbox(bp, axis)`.
- Waffen `weaponCount`, `weaponIds`, `weaponIndexOf`, `weaponRange/MinRange/DamageRadius: Fx`, `weaponDamage`,
  `weaponReloadTicks`, `weaponSalvo`, `weaponSalvoIntervalTicks`, `weaponMuzzleVelocityPerTick`, `weaponProjectile`;
  Projektile `projectileCount/Ids/IndexOf`, `projectileKind`, `projectileSpeedPerTick`, `projectileGravityPerTick2`,
  `projectileLifetimeTicks`, `projectileTurnRatePerTick`; Mounts `mountTotal`, `mountUnit/Weapon/Part`,
  `mountHalfArc/YawRatePerTick: Ang16`, `mountLayerMask`, `mountPriorityFirst/Count`, `priority(i)`.
- Kategorie-Ausdrücke `exprCount`, `exprSources`, `exprCode`, `exprIndexOf(src)`, `matchesExpr(expr, mask, off)`,
  `unitMatchesExpr(bp, expr)`, `canBuild(builder, bp)` – alle allokationsfrei.
- Props `propCount/Ids/IndexOf` + Spalten, Fraktionen `factionCount/Ids/IndexOf`, `factionStartUnit`,
  `factionUnitFirstCol/CountCol`, `factionUnitList`.

## view.json v2 (`@faf/blueprints/view`, Vertrag für ms3-p3/p4)

`{format: 'faf-view', version: 2, visuals: ViewEntry[], effects: ViewEffect[]}`; `ViewEntry` = `{id, placeholder
{hull, size, color?, turret? {hull, size, offset}}, mesh?, lod?, icon?, iconThreshold, tech (0–3), categories (Namen,
Bit-Reihenfolge), selectionRadius (WU), sizeClass, hotkeySlot?, fx? {slot: effectId}, nameKey, descKey}`. `ICON_IDS`
(sortiert): `air_generic, commander, cube, land_antiair, land_direct, land_engineer, land_indirect, land_scout,
structure_generic`; `isIconId`, `DEFAULT_ICON_THRESHOLD = 14`, `defaultSelectionRadius(radius, footprint)` =
1,2 × max(radius, max(footprint)/2) auf 1/100 WU. `parseViewJson` liest v1 und v2 und gibt immer die v2-Form zurück
(v1: iconThreshold aus der Datei oder 14, tech 0, categories [], selectionRadius aus der Platzhaltergröße, sizeClass 1,
effects []); `bundle.version` bleibt die gelesene Version. iconThreshold-Semantik: DECISIONS MS3-23.

## `compileBlueprintModules` (Vertrag für ms3-p4, Vite-HMR)

```ts
compileBlueprintModules(
  modules: { source: string; exports: unknown }[],   // source = Repo-Pfad; exports = Modul-Namespace ({default}) oder Default-Export
  locales: { de: unknown; en: unknown },               // geparste content/locales/*.json
  opts?: { includeTest?, strict? (Default: an), minMapDiagonalWu?, gates?, behaviors?, toggles? },
): { ok: true, simBin, viewJson, bundleJson, hashesJson, hashes: {simHash, viewHash}, diagnostics: [], result }
 | { ok: false, diagnostics: {id, source, path, message}[] }
```

Kein Dateisystemzugriff, wirft nicht bei Content-Fehlern (Module ohne gültigen Default-Export, kaputte Locale-Tabellen und
Compilerfehler kommen als Diagnosen, sortiert nach id/path/message). Module werden nach `source` sortiert; gleiche
Eingabe ⇒ bytegleiche Ausgabe (Test). `formatDiagnostics(d)` liefert die Textform für HUD/Konsole. Die CLI
(`pnpm --filter @faf/blueprints compile [--check]`) lädt über `scripts/content.ts` (`loadModules`, `loadLocales`) und
ruft dieselbe Funktion. Frische-Test: `content/generated` muss dem Kompilat der Quellen entsprechen.

## G5 in `@faf/rules`

`registryFromBitOrder(names)` (Registry aus der sim.bin-Kategorieliste, prüft die Sortierung), `maskFromNames(names, bits,
out?, off?, ignoreUnknown?)` (Maske aus view.json-Kategorien), `CategoryFilter(src, bits)` mit `matches(mask, off)`
(allokationsfrei) und `matchesNames(names)` (UI-Filter, Doppelklick-Auswahl, KI-Abfragen), `evaluateCategoryExpr(tree,
names)`, `categoryExprMatchesNames(src, names)`, `matchesMaskCode(mask, off, code, start, len)` (Pool-Bytecode aus
sim.bin; `matchesMask` delegiert dorthin), `validateCategoryCode(code, start, len, categoryCount)`. Bestehende APIs
unverändert (nav/sim lesen rules weiter wie bisher).

## Content (`content/blueprints/core`, Locales de/en)

| Sim-ID | Blueprint | Rolle | Klasse / Radius / Masse | Tempo, accel, Wende | Waffe(n) | Icon |
|---|---|---|---|---|---|---|
| 0 | `core:cube` | MS1-Testwürfel (unverändert, nur Icon `land_cube` → `cube`) | 1 / 0,3 / 2 | 3, 3, 180 | – | cube |
| 1 | `core:fac_land_t1` | T1-Landfabrik (Struktur, Fraktionsstart bis MS5) | 3 / 2,5 / 8 | 0 | – | structure_generic |
| 2 | `core:lnd_t1_arty` | „Hagel“, mobile Artillerie | 1 / 0,45 / 2 | 2,2, 1,8, 70 | `wpn_arty_t1` (ballistisch, 30 WU) | land_indirect |
| 3 | `core:lnd_t1_scout` | „Flitzer“, Späher | 1 / 0,35 / 1 | 5, 5, 180 | `wpn_mg_t1` (14 WU) | land_scout |
| 4 | `core:lnd_t1_tank` | „Keiler“, leichter Panzer (Werte PLAN §3.9) | 1 / 0,45 / 2 | 3, 2,5, 90 | `wpn_cannon_t1` (18 WU) | land_direct |
| 5 | `core:lnd_t2_tank` | „Wisent“, mittlerer Panzer | 2 / 0,75 / 4 | 2,8, 2,2, 75 | `wpn_cannon_t2` (22 WU) | land_direct |
| 6 | `core:lnd_t3_heavy` | „Bollwerk“, schwerer Sturmpanzer | 3 / 1,2 / 24 | 1,9, 1,2, 45 | `wpn_cannon_t3` + `wpn_mg_t1` (Rumpf, 90°), Todeswaffe | land_direct |

Die T1-Einheiten sind `buildableBy: 'FACTORY & LAND & TECH1'` (Fabrik = Wurzel des Tech-Baums); T2/T3 tragen Kosten,
aber noch kein `buildableBy` (T2/T3-Fabriken mit Upgrade-Kette kommen mit MS6/MS8). Alle Panzer haben Rumpf + Turm,
Wrack 0,9/0,5, Default-Veteranenprofil. Dazu 5 Projektile, 6 Effekte, 3 Props (Felsen klein/groß, Kiefer), das
KI-Profil `core:ai_default` und Locale-Einträge (Einheiten, Fraktion „Kernverbund“/„Core Union“, KI). Kompilat:
**7 Units, simHash `0x49678DEF`**, sim.bin 2.292 B; `pnpm assets` und `pnpm --filter @faf/assets-pipeline run check` grün.

## SPK2 – Bewegungsgefühl (PLAN §4, DECISIONS MS3-22)

Prototyp (Float64, 10 Hz, bewusst Wegwerf-Code in `tools/headless/src/spk2/`): `grid.ts` (1-WU-Hindernisgitter,
Chebyshev-Clearance wie @faf/nav, Abstandsfeld, oktiler Grid-A\* ohne Eckenschneiden + gieriges String-Pulling,
Supercover-LOS), `sim.ts` (Steering nach §3.8, s. u.), `scenarios.ts` (6 Szenarien, Unit-Typen = Content-Werte, Test
gleicht mit bundle.json ab), `run.ts` (Metriken, Score, Sweep, Spur), `params.ts` (**`SPK2_PARAMS`**, Kommentar je Wert).
CLI `pnpm bench:spk2 [-- --quick] [--update-docs] [--trace <szenario>] [--seeds 1,2]` → `tools/headless/results/spk2.json`
(git-ignoriert, Maschine/Load-Average/Parameter/Metriken/Sweep), Spuren nach `tools/headless/spk2/out/`, Viewer
`tools/headless/spk2/viewer.html` (per file:// öffnen, Datei wählen, abspielen/scrubben). Exit ≠ 0, wenn SPK2_PARAMS ein
Szenario-Kriterium reißt (maschinenunabhängig). `--quick` ≈ 20 s (lokal), voll ≈ 45 s.

Ablauf je Tick: Grid-Rebuild → Pfadfolge (Wegpunkt, alle 5 Ticks LOS-Vorausschau) + Separation (≤ 8 Nachbarn) +
Abstandsfeld-Gradient → Ketten-Kinematik (Wenderate, Anfahren unter 70°, darüber Drehen mit 10 % Kriechtempo,
Start-Kick, Bremskurve zum Slot) → Kollisionsauflösung (2 Iterationen, Anteil nach Masse × Priorität fahrend 4 : 1) →
Hindernis-Push-out → Idle-Nudge → Ankunft/Contagion/Slot-Rückkehr → Stuck (Repath, dann Ausweich-Wegpunkt).
Szenarien: (1) 200 gemischte Units (Klassen 1–3) über eine 256-WU-Karte mit Grat (2 Pässe), See und Felsen als Gruppe;
(2) 100 T1 durch eine 3-WU-Lücke; (3) Fabrik-Roll-off: alle 12 Ticks eine Unit am Tor, wenn frei, Fahrt zum gemeinsamen
Rally-Punkt; (4) 100 Units aus der Fläche auf einen Punkt; (5) 80 Units (Klassen 1–3) durch Mauerlücken 2/4/6 WU;
(6) 60 Units in 3 Reihen, 100 WU, Offset-Erhalt. Metriken: Deadlock (kein Fortschritt aller fahrenden Units > 5 s), Zeit
bis alle durch/angekommen, Anteil ohne Stuck > 3 s (Fortschritt auf dem Restpfad), max./mittlere Überlappung und
Restüberlappung nach dem Stillstand, Richtungs-Jitter (mittleres |Δyaw| und Umkehrungen je Unit-Minute), Anfahr-Ticks
(sichtbar = Drehung ≥ 2° oder Weg ≥ 0,05 WU; Translation ≥ 0,05 WU), Offset-Fehler (p95/max gegen die komprimierten
Offsets relativ zum End-Schwerpunkt), Repaths/Ausweichen/Nudges/Contagion/Slot-Rückkehr/Pfadanfragen.

### Messwerte (lokal, Apple M5 Pro)

<!-- spk2:begin -->
Lokal gemessen, Apple M5 Pro (Apple M5 Pro), Node v24.18.0; Seeds 1, 2 (Wertebereiche über die Läufe); Float64-Prototyp, 10 Hz.

| Szenario | Deadlock | Zeit bis alle durch/angekommen | ohne Stuck > 3 s | Überlappung max / mittel | Richtungs-Jitter (°/Tick, Umkehr/min) | Anfahr-Ticks sichtbar / Translation (max) | Offset-Fehler p95 | Repaths / Ausweichen |
|---|---|---|---|---|---|---|---|---|
| 1 200 Units über die Karte (Gruppe, Offset-Erhalt) | nein | 146,7–152,7 s | 98,5–100,0 % | 0,37–0,70 / 0,014–0,028 WU | 0,36–0,37 / 7,0–7,4 | 1 / 3 | 0,90–0,92 WU | 0–22 / 0–2 |
| 2 Engstelle 3 WU, 100 Units | nein | 22,4–22,7 s | 94,0–97,0 % | 0,67–0,81 / 0,058–0,075 WU | 1,14–1,24 / 21,1–23,6 | 2 / 2 | 0,35–0,98 WU | 15–18 / 0–1 |
| 3 Roll-off an der Fabrik (40 Units) | nein | 47,4 s | 100,0 % | 0,17 / 0,012 WU | 0,16 / 2,5 | 2 / 2 | – | 0 / 0 |
| 4 Klumpen bei Attack-Move (100 Units auf einen Punkt) | nein | 32,5–35,2 s | 100,0 % | 0,51–0,70 / 0,029–0,033 WU | 0,94–1,04 / 7,2–10,3 | 2 / 4 | – | 3–4 / 0 |
| 5 Mauerlücken 2/4/6 WU (80 Units, Klassen 1–3) | nein | 82,5–82,7 s | 100,0 % | 0,42–0,52 / 0,016–0,024 WU | 0,95–0,96 / 14,3–14,3 | 1 / 3 | 1,35–1,93 WU | 0 / 0 |
| 6 Offset-Erhalt (60 Units, 3 Reihen) | nein | 38,6 s | 100,0 % | 0,04–0,05 / 0,008–0,011 WU | 0,05–0,05 / 0,3–0,5 | 2 / 2 | 0,81–0,91 WU | 0 / 0 |

Parameter-Sweep (one-at-a-time um SPK2_PARAMS, 2 Seed(s); Score = Summe über alle Szenarien, kleiner ist besser, Fehlschlag +1.000):

| Parameter | gewählt | Werte (Score, alle 6 bestanden?) |
|---|---|---|
| `separationStrength` | 0.5 | 0.25: 422 · 0.5: 441 · 1: 453 |
| `maxNeighbors` | 8 | 4: 440 · 6: 441 · 8: 441 |
| `arrivalRadius` | 0.35 | 0.25: 443 · 0.35: 441 · 0.5: 441 |
| `offsetMinGap` | 0.15 | 0: 441 · 0.15: 441 · 0.3: 439 |
| `returnDistance` | 1 | 0.5: 438 · 1: 441 · 2: 448 |
| `contagionDistance` | 4 | 2: 462 · 4: 441 · 8: 432 |
| `idleNudge` | true | false: 1451 ✗ · true: 441 |
| `stuckEpsilon` | 0.15 | 0.1: 440 · 0.15: 441 · 0.3: 448 |
| `movingPriority` | 4 | 1: 442 · 2: 440 · 4: 441 · 8: 438 |
| `offsetRadiusPerSqrtN` | 1.1 | 0.8: 440 · 1.1: 441 · 1.4: 442 |
| `startAngleDeg` | 70 | 50: 443 · 70: 441 · 90: 2725 ✗ |
| `brakeFactor` | 2 | 1: 439 · 2: 441 · 3: 435 |
<!-- spk2:end -->

Einzelne Nachbarwerte im Sweep (Separation 0,25, Contagion 8 WU, Bremsen 3 × accel) liegen im Score um < 5 % besser,
aber nur über 2 Seeds und ohne Einfluss auf ein Kriterium; gewählt bleibt der über 8 Seeds geprüfte Satz.
Robustheit (Seeds 1–8, derselbe Parametersatz): alle 6 Szenarien 8/8 bestanden; 200 Units 98–100 % ohne Stuck > 3 s;
Engstelle 22,2–24,7 s; Offset-Szenario p95 0,31–1,24 WU. Offset-Fehler in (1) und (5) sind größer (Gruppe wird durch
Pässe/Lücken umsortiert; kein Kriterium).

### Parameter für die Fx-Portierung (ms3-p2)

| Parameter | Wert | Fx/Ang16 (round-half-up) |
|---|---|---|
| Bremsen (`brakeFactor`) | 2 × accel | Blueprint-Default `DEFAULT_BRAKE_FACTOR = 2` → `SimBpTable.brakePerTick` |
| Anfahrwinkel / Tempo bei 70° / Kriechtempo darüber | 70° / 0,4 / 0,1 | Ang16 12.743 / 1.638 / 410 |
| Start-Kick | 3 Ticks × 2 accel | – |
| Separation Stärke / Reichweite / Nachbarn | 0,5 / 1,5 × (ri + rj) / 8 | 2.048 / 6.144 / – |
| Clearance-Gradient ab radius + / Stärke | 0,5 WU / 1,5 | 2.048 / 6.144 |
| Ankunftsradius | 0,35 WU | 1.434 |
| Contagion: Slot-Abstand / Berührungsspalt / Stillstand | 4 WU / 0,3 WU / 10 Ticks | 16.384 / 1.229 / – |
| Slot-Rückkehr: Abweichung / Wartezeit | 1,0 WU / 10 Ticks | 4.096 / – |
| Kollision: Iterationen / Priorität fahrend | 2 / 4 | – |
| Idle-Nudge: Tempo / Dauer | 0,5 × vmax / 6 Ticks | 2.048 / – |
| Stuck: Fenster / ε / Ausweichweite | 20 Ticks / 0,15 WU / 2,5 WU | – / 614 / 10.240 |
| Wegpunkt-Radius / LOS-Vorausschau | 1,0 WU / alle 5 Ticks | 4.096 / – |
| Offset-Kompression R(n) = a + b·√n / Mindestspalt | a = 2, b = 1,1 / 0,15 WU | 8.192, 4.506 / 614 |
| Default-Masse je Klasse 0–3 | 1, 2, 4, 8 | `DEFAULT_MASS_BY_SIZE_CLASS` (sim.bin `mass`) |

## Tests

`pnpm vitest run packages/blueprints packages/rules tools/headless/test/spk2.test.ts` (alle grün):

- `blueprints/test/types.test.ts` (13): je Typ gültig + ungültig mit JSON-Pointer, strikte Schemas (unbekannte Felder),
  abstrakt/extends/Patch für Nicht-Unit-Typen, extends über Typgrenzen, IDs über alle Typen eindeutig.
- `semantics.test.ts` (17): unbekannte Referenz, falscher Referenztyp, abstrakte/test:-Referenzen, Fraktionsstart,
  Selbst-Upgrade, Ziel-Layer, Größenklassen-Regel, accel/turnRate, **ungültiger Ausdruck mit Position** (auch KI-Profil),
  Bytecode-Deduplizierung, **Tech-Baum-Zyklus mit Pfad**, erreichbare FA-Zyklen erlaubt, Upgrade-Zyklen, Selbst-Bauer,
  **fehlender i18n-Key (de und en getrennt)**, **unbekanntes Behavior/Toggle**, **Gate-Verletzung** (+ Option,
  eigene Gates), strikter Content (Icon, TECH).
- `simbin.test.ts` (7): **v2-Roundtrip aller Tabellen und Umrechnungen**, Kopf-/Verzeichnis-Layout, Determinismus,
  Wertebereiche im Encoder, kaputte Sektionen/Referenzen im Decoder, **v1 lesbar** (MS2-Datei, Defaults), unbekannte
  Version mit Meldung.
- `modules.test.ts` (6): `compileBlueprintModules` (Namespace/Default-Export, Reihenfolge egal ⇒ bytegleich, Diagnosen
  statt Exceptions), **view.json v2 und v1**, Content (core:cube = Sim-ID 0, Panzer mit Turm, Tech-Baum, Fraktion,
  Frische aller Dateien), Locale-Schlüssel de = en.
- `compiler.test.ts` (18, angepasst) und `view-assets.test.ts` (5, gepinnter simHash jetzt `0x49678DEF`).
- `rules/test/filter.test.ts` (6): Bit-Reihenfolge, `maskFromNames`, `CategoryFilter`, Baum-Auswertung == Bytecode
  (fast-check, 1.000 Läufe), Pool-Bytecode, `validateCategoryCode`.
- `tools/headless/test/spk2.test.ts` (11): alle 6 Szenarien (Seed 1) ohne Deadlock mit Kriterien, Anfahren (sichtbar
  ≤ 2 Ticks, Translation ≤ 10 Ticks), keine Restüberlappung, Engstelle ≤ 60 s, 200 Units ≥ 95 %, **eine Pfadanfrage je
  Gruppenbefehl**, Determinismus je Seed, Spur-Format, Grid/A\*/LOS, Abgleich `SPK2_PARAMS` ↔ Blueprint-Defaults und
  Unit-Typen ↔ bundle.json.

## Abweichungen vom Plan (mit Begründung)

1. **Content: nur eine Fabrik, T2/T3-Panzer ohne `buildableBy`.** Mit T2/T3-Fabriken hätte die Spieltabelle 9 Units;
   `packages/sim/test/commands.test.ts` nutzt Sim-ID 7 als „unbekannten Blueprint“ (fremdes Paket). Mit 7 Units bleibt
   der Test grün; die Fabrik-Upgrade-Kette kommt mit MS6/MS8 (dann muss der Sim-Test `w.bp.count` statt 7 nutzen).
2. **`core:cube`: Icon `land_cube` → `cube`** (Registry-ID; reine View-Änderung). Sim-Werte, Sim-ID 0 und base_cube
   sind unverändert (Test).
3. **Tech-Baum-Semantik** als Erreichbarkeit statt „keinerlei Zyklen“ (FA hat legitime Zyklen Ingenieur ↔ Fabrik),
   geschlossene Zyklen werden mit Pfad gemeldet (DECISIONS MS3-23).
4. **Hitbox-Default** = Kollisionsdurchmesser je Achse, nicht die Platzhaltergröße – sonst würde eine View-Änderung den
   simHash verschieben.
5. **Kategorien in view.json v2** ⇒ eine Kategorieänderung ändert auch den viewHash (bisheriger Test angepasst).
6. **Motion-Schema:** `accel`/`turnRateDeg` dürfen 0 sein (Strukturen), eine fahrende Unit (`speed > 0`) braucht beide > 0
   (Semantikprüfung).
7. **KI-Profile und Effekte** stehen nicht in sim.bin (KI läuft außerhalb der Sim über `CommandSource`; Effekte sind
   Präsentation) – KI-Profile in bundle.json, Effekte in view.json.
8. **i18n/Icon/TECH-Pflicht** gilt im strikten Modus (CLI/HMR, Default bei übergebenen Locales); `compileBlueprints` ohne
   Locales (Sim-Tests, Fixtures) prüft sie nicht, `test:`-Blueprints sind immer ausgenommen.
9. **SPK2-Anfahrprofil:** oberhalb des Anfahrwinkels rollen Ketten mit 10 % Tempo während der Drehung (statt Tempo 0),
   damit „alle fahren < 1 s los“ auch als Positionsänderung gilt (DECISIONS MS3-22).
10. **Nicht-Unit-IDs** sind eigene Tabellen mit eigenem Index (sortierte String-IDs je Typ); nur Units haben u16-Sim-IDs
    im Frame.

## Auswirkungen auf andere Pakete / bekannte Grenzen

- **Rot bis Welle 1/2 (erwartet, nicht umgangen):** `tools/headless/test/goldens.test.ts` (4 L2-Goldens, simHash
  `0xD4135AF1` → `0x49678DEF`, simId neu) und damit `pnpm test:xengine` – nimmt ms3-p2 mit `SIM_BUILD`-Bump neu auf.
  `packages/client/test/assets.test.ts` (2 Tests) erwartet noch genau `['core:cube']` bzw. `commanderVisuals == [0]` –
  ms3-p4 muss auf „`ids[0] === 'core:cube'`, sieben Units, keine COMMAND-Kategorie“ umstellen.
- Die Sim nutzt in MS3 noch keine der neuen Spalten; `brakePerTick`, `mass`, `turnInPlace` sind für ms3-p2 bereit.
  Waffen/Projektile werden erst ab MS5 simuliert, Props ab MS8, Fraktionsstart ab MS9.
- `content/generated/assets` wurde mit `pnpm assets` neu erzeugt (neue sim.bin/view.json-Hashes; Pipeline-Code
  unverändert). ms3-p3 erweitert die Pipeline später um den Icon-Atlas.
- SPK2 ist ein Float-Prototyp: Laufzeiten sind nur informativ (≈ 0,5 s für 200 Units × 1.500 Ticks), die
  Fx-Portierung misst ms3-p2/p5. Der Prototyp verwendet für Einzel-Rückfahrten (Slot-Rückkehr ohne LOS) eigene
  Pfadanfragen; der Gruppenbefehl selbst erzeugt genau eine.
