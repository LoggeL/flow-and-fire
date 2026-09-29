# P3-blueprints-sim – `@faf/rules`, `@faf/blueprints`, `@faf/sim`, Würfel-Content (MS1, Welle 2)

## Umgesetzt

### `@faf/rules` (Minimalumfang MS1) – Dep nur `@faf/fixed`, unter `sim/determinism`

- `src/categories.ts`: 128-Bit-Masken (`CATEGORY_WORDS = 4` × u32, flach in `Uint32Array` + Offset),
  `CategoryRegistry` (Namen nach UTF-16-Code-Units sortiert und dedupliziert → Bit = Index; Lookup per
  Binärsuche, kein `Map`; max. 128; Namen `^[A-Z][A-Z0-9_]*$`), `maskOf`/`namesOf`, `maskSetBit/maskHasBit/
  maskContainsAll/maskIntersects/maskEquals`, `compareCodeUnits` (locale-frei).
- `src/expr.ts`: Kategorie-Ausdrücke. Grammatik (Präzedenz niedrig → hoch, linksassoziativ):
  `expr := term ('|' term)*`, `term := unary (('&' | '-') unary)*` (`a - b` ≡ `a & !b`), `unary := '!' unary | primary`,
  `primary := NAME | '(' expr ')'`. `parseCategoryExpr` (Baum), `compileCategoryExpr(src, registry)` → Postfix-Bytecode
  in `Int32Array` (`Bit n`, `And`, `Or`, `Not`, `AndNot`) + Stacktiefe (≤ 32), `matchesMask(mask, compiled, off)`
  (fester Modul-Stack, keine Closures, allokationsfrei). Fehler als `CategoryExprError` mit 0-basierter Position
  (leerer Ausdruck, fehlender Operand, fehlende/überzählige Klammer, Kleinbuchstaben, unbekannte Zeichen,
  unbekannte Kategorie, Länge > 1.024, Tiefe > 32).
- `src/layer.ts`: `MotionLayer` (Land 0, Water 1, Seabed 2, Hover 3, Amphibious 4, Air 5 – append-only),
  `MOTION_LAYER_NAMES`, `MVP_MOTION_LAYERS = ['land','air']`, `motionLayerOf`, **`SIM_TICK_HZ = 10`** (geteilte
  Konstante für Compiler-Umrechnung und Sim).

### `@faf/blueprints` – Compiler-Skelett (PLAN §3.9, Schritte 1–7)

- `src/define.ts` (keine Laufzeit-Deps, von Content importiert): Typen `UnitBlueprint`, `DeepPatch<T>`,
  `UnitBlueprintInput` (konkret vollständig; mit `extends` bzw. `abstract: true` teilweise, `null` löscht),
  `defineUnit(data)`, `definePatch(target, patch)`, `isBlueprintDefinition`.
- `src/schema.ts` (TypeBox 0.34): `UnitSchema` (MS1-Teilmenge, überall `additionalProperties: false`),
  `AbstractUnitSchema` (gleiche Form, alles optional, rekursiv strikt), Teil-Schemas `MotionSchema`,
  `PlaceholderSchema` usw. Felder: `id` (`^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$`), `extends?`, `abstract?`,
  `categories` (1–64, eindeutig), `sim.health.max` (Integer ≥ 1), `sim.motion {layer (alle 6 Namen), speed WU/s,
  accel WU/s², turnRateDeg °/s, sizeClass 0–7, footprint [w,h] 1–64, maxSlope, radius?}`, `sim.intel.vision?`,
  `view {placeholder {hull 'box'|'cyl', size [x,y,z], color? [r,g,b] 0..1}, icon?, iconThreshold?, nameKey?, descKey?}`.
- `src/merge.ts`: `mergePatch(base, patch)` – Objekte rekursiv, `null` löscht, `undefined` lässt stehen, Arrays aus
  Objekten mit String-`id` werden per `id` gemergt (Update in place, neue ids angehängt, `{id, $remove: true}`
  entfernt), alle anderen Arrays/Primitive ersetzen; Eingaben werden nie verändert.
- `src/compiler.ts`: `compileBlueprints(defs: SourcedDefinition[], {includeTest?})` →
  1. Einsammeln (ungültige/doppelte ids) · 2. Merge-Patches in Definitionsreihenfolge · 3. `extends` (Eltern zuerst,
  `id/abstract/extends` des Elternteils werden nicht vererbt, Zyklen als `extends cycle: a -> b -> a`, unbekannte
  Basis, `test:`-Basis für Nicht-Test-BPs verboten) · 4. TypeBox-Validierung mit JSON-Pointer-Pfad
  (`/sim/motion/speed: Expected number`, `/sim/motion/sped: Unexpected property`) + Semantik (Layer muss im MVP
  aktiv sein) · 5. Kategorien → `CategoryRegistry` über alle ausgegebenen Einheiten → Masken · 6. Umrechnung ·
  7. IDs = Index in der sortierten String-ID-Liste (u16). Alle Fehler gesammelt als `BlueprintCompileError`
  (`diagnostics: {id, source, path, message}[]`, sortiert). Abstrakte BPs und (ohne `includeTest`) der Namespace
  `test:` werden nicht ausgegeben. Defaults: `radius = max(footprint)/2`, `nameKey = unit.<ns>.<name>.name`,
  `descKey = unit.<ns>.<name>.desc`.
- **Umrechnung (nur hier Float erlaubt):** `speed·4096/10` → Fx/Tick, `accel·4096/100` → Fx/Tick²,
  `turnRateDeg·65536/360/10` → Ang16/Tick (max. 32.768), Dezimal → `·4096` (radius, vision, maxSlope).
  **Rundungsregel:** round-half-up auf das Float64-Ergebnis (`Math.floor(x + 0.5)`); ein Wert > 0 wird nie zu 0
  (min. 1). Da `sim.bin` eingecheckt ist, hängt die Sim nie vom Float-Verhalten einer Engine ab.
  Beispiel `core:cube`: 3 WU/s → 1.229, 3 WU/s² → 123, 180 °/s → 3.277, radius 0,3 → 1.229.
- `src/simbin.ts` (**nur `@faf/fixed`**, eigener Export `@faf/blueprints/simbin` – die Sim lädt kein TypeBox):
  `encodeSimBin(units, categoryNames)`, `decodeSimBin(bytes)` → `SimBpTable` (flache Spalten `speed/accel/turnRate/
  maxHpCol/radiusCol/visionCol/maxSlopeCol/layerCol/sizeClassCol/footprintW|HCol/categoryMasks`, Accessoren
  `speedPerTick(bp): Fx`, `accelPerTick`, `turnRatePerTick: Ang16`, `maxHp`, `radius: Fx`, `vision`, `maxSlope`,
  `layer`, `sizeClass`, `footprintW/H`, `categories(bp, out)`, `categoryWord`, `categoryOffset`, `idOf`,
  `indexOf` (Binärsuche), `has`, `ids`, `categoryNames`, **`simHash`** = xxHash32(sim.bin)). Validierung von Magic,
  Version, Geometrie, Offsets, Längen, Sortierung und Wertebereichen.
- `src/view.ts` (eigener Export `@faf/blueprints/view`): `ViewBundle`/`ViewEntry`/`ViewPlaceholder`,
  `parseViewJson(text|json)` mit Pfad-Fehlern. Die Placeholder-Form ist identisch zu `render.PlaceholderSpec`
  (`{hull, size, color?}`) → direkt an `renderer.setVisuals` übergebbar; Visual-Index = Blueprint-Sim-ID.
- `src/canonical.ts`: `canonicalJson(v, indent?)` (Keys nach Code-Units sortiert, `undefined` entfällt, −0 → 0,
  NaN/∞ abgelehnt; Pretty-Form hält Primitive-Arrays einzeilig), `utf8`, `hex32`.
- CLI `scripts/compile.ts` (Skript `compile` via tsx; `--check` schreibt nichts, Exit 1 wenn veraltet) und
  `scripts/content.ts` (Loader: alle `content/blueprints/**/*.ts` nach Repo-Pfad sortiert importieren, Default-Export
  = Definition oder Array; `writeGenerated`, `staleGenerated`).

### Content

- `content/blueprints/core/units/base_cube.ts` – `core:base_cube` (abstrakt; LAND, MOBILE, TECH1, CUBE; 100 HP;
  land, 3 WU/s, 3 WU/s², 180 °/s, sizeClass 1, footprint 1×1, maxSlope 0,6, radius 0,3; vision 16; Box 0,5³).
- `content/blueprints/core/units/cube.ts` – `core:cube` extends base_cube (Farbe, Icon `land_cube`).
- `content/blueprints/test/units/fast_cube.ts` – `test:fast_cube` (8 WU/s, 360 °/s, 250 HP, Zylinder, Kategorie TESTONLY).
- `content/generated/{sim.bin, view.json, bundle.json, hashes.json}` (eingecheckt, siehe Abweichung 6):
  1 Einheit (`core:cube` = Sim-ID 0), 4 Kategorien (CUBE, LAND, MOBILE, TECH1),
  **simHash `0xD4135AF1`**, **viewHash `0xB5139443`**, sim.bin 132 B.

### `@faf/sim` – deterministische Würfel-Sim (S2, S3, S5, G11; PLAN §3.4/§3.5)

- **Arena** (Registrierungsreihenfolge = Layout = Hash-Reihenfolge): `world` (Header, 16 i32: tick, seed,
  lastHashTick, lastHash (u32), armyCount, mapSizeWu, spawnSerial), `armies` (Tabelle, 16 Zeilen: active, unitCount,
  unitCap, lastAckSeq), `alliance` (16×16 u8, Diagonale = 1), `units` (Tabelle, Cap 8.192, **vollständiges
  Spaltenschema aus §3.5** in exakt dieser Reihenfolge), `movers` (Dense, Cap 8.192: tx, tz, speed, state, flags;
  Back-Pointer `Units.mover`), derived: `grid.fine.{start,cursor,items,cellOf}` (4 WU) und
  `grid.coarse.{…}` (32 WU). Unbenutzte Referenzspalten = −1, `lastHitBy` = `HANDLE_NONE`, sonst 0.
  512-WU-Welt: Arena 1,44 MiB (23 Pages), Snapshot 1.452.760 B, **layoutHash `0xA15987BF`** (im Test gepinnt).
- **API** (`src/index.ts`):
  - `createWorld({simBin | bpTable, seed, armyCount, mapSizeWu? = 512, unitCapPerArmy? = 8192})`
    (mapSizeWu Vielfaches von 32 in [32, 4096]).
  - `step(world, cmds?, probe?)` mit `cmds: Uint8Array` (Batch) `| CommandBatchView` (bereits `reset()`)
    `| readonly CommandEnvelope[] | null`; `probe: PhaseProbe {begin(phase), end(phase)}`.
  - `ruleHash(w)`, `fullHash(w)`, `lastHash(w)`, `lastHashTick(w)`, `snapshot(w, target?)`, `restore(w, bytes)`,
    `w.tick`, `w.seed`, `w.armyCount`, `w.layoutHash`, `w.snapshotByteLength`, `w.bp` (SimBpTable).
  - `writeFrame(w, viewer, writer, target, meta?)` → gepackte Frame-Länge (siehe Abweichung 1).
  - Grid: `forEachInRadius(w, x, z, r, visitor)` (Visitor-Objekt, `visit(slot) → false` bricht ab),
    `queryRadius(w, x, z, r, out: Int32Array)` → Anzahl; r ≤ 16 WU → Fein-Grid, sonst Grob-Grid.
  - Lesend/Tests: `unitSlot`, `isUnitAlive`, `unitPosition(w, h, out)`, `unitInfo` (allokiert), `unitHandles(w, army?)`
    (allokiert), `unitCount`, `armyUnitCount`, `lastAckSeq`, `isAllied`; Setup: `setAlliance(w, a, b, allied)`.
  - Konstanten: `PhaseId` (alle 16 Phasen + `HashTick = 17`), `PHASE_NAMES`, `ACTIVE_PHASES`, `CAP_UNITS`,
    `HASH_INTERVAL_TICKS = 10`, `UnitState`, `UnitBits`, `MoverState`, `MoverBits`, Schema-Definitionen.
- **Phasen** (verbindliche Reihenfolge; `step` erhöht zuerst `tick`, dann):
  1. **CommandApply** – Staging in flache, wiederverwendete Puffer (`CommandStage`), Sortierung per
     allokationsfreiem, stabilem Merge-Sort nach `(army, seq, Ankunftsindex)` (total). Inaktive Army → verworfen;
     sonst `lastAckSeq[army] = seq` (auch für verworfene/unbekannte Ops). **Move**: Handle-Generation + Besitz +
     Mover geprüft, Ziel auf die Karte geklemmt, ersetzt die Order (Flag `Queue` = Ersetzen). **Stop**: idle, Ziel =
     eigene Position (bremst mit accel). **Cheat Spawn**: bp/Army/spread geprüft; Position je Einheit gleichverteilt in
     der Kreisscheibe (Winkel `rng32(seed, tick, spawnSerial, 'SPNA')`, Radius `spread·√u` via `isqrt`), Yaw per rng32,
     Abbruch bei Army-Cap oder voller Tabelle. **Cheat Kill**: markiert Dead (beliebige Army). Unbekannte Ops/
     falsche Payload-Länge → verworfen.
  2. **Orders** – Move-Ankunft: Distanz ≤ 0,25 WU ⇒ idle; Ankunfts-Contagion (s. u.).
  7. **Movement** – prev = cur (alle lebenden Units); NoInterp bleibt genau im Spawn-Tick stehen; Yaw per
     `angRotateTowards(yaw, atan2A(dz, dx), turnRate)`; Zieltempo `maxV·(90° − Fehler)/90°` (0 ab 90° Fehler: Drehen auf
     der Stelle), begrenzt durch Bremsweg `isqrt(2·accel·dist)`; Tempo-Rampe ±accel; Schritt `min(v, dist)` entlang
     `cosA/sinA(yaw)` (Konvention = render: vorwärts = (cos yaw, sin yaw) in x/z); Klemmen auf [0, mapSize].
     **Separation**: pro Mover in Dense-Reihenfolge ≤ 8 überlappende Nachbarn aus dem Fein-Grid (Suchbereich um
     `maxRadius + 2·maxSpeed` erweitert, weil das Grid einen Tick alt ist), Push = halbe Überlappung (Integer,
     `Math.trunc(d·push/dist)`; bei exakt gleicher Position Richtung per rng32), sofort angewendet (Gauss-Seidel).
  8. **SpatialRebuild** – Counting-Sort beider Grids (Zelle zeilenweise, innerhalb der Zelle aufsteigende Slots).
  15. **Cleanup** – tote Slots aufsteigend: Mover Swap-Remove + Back-Pointer, unitCount−1, `free` (gen++, FIFO).
  16. **Output** – bei `tick % 10 == 0` Regel-Hash (Probe-Phase `HashTick`) → Header `lastHashTick/lastHash`.
- **Frame** (`writeFrame`): Header tick, `ackSeq` = `lastAckSeq` des Viewers (keiner/Observer: `0xFFFFFFFF`),
  `hashTick/hash` aus dem Welt-Header; Host-Felder (seq, tickTimeUs, speedPermille, flags inkl. Paused) aus `meta`.
  Pro lebender Unit ein UnitRecord (Slot-Reihenfolge): prev/cur Pos, prev/cur Yaw, `visual = bp`, army,
  `hp` u8 (255 = voll, ≥ 1 solange lebend), `build` 255, bank, flags (`NoInterp` im Spawn-Tick, `Idle` wenn
  Order idle und Tempo 0, `Damaged` bei hp < max), handle, keine Parts. Kein Fog in MS1: jeder Viewer sieht alles.
- `bench/tick.ts` (Skript `bench`): grobe Node-Messung (s. u.).

## Tests (`pnpm vitest run packages/rules packages/blueprints packages/sim`: 8 Dateien, 53 Tests grün)

- rules (9): Registry-Ordnung/Dedupe/Fehler/128 Bits über 4 Wörter, Masken-Helfer, Ausdrucks-Semantik und Präzedenz,
  Bytecode, 11 Fehlerfälle mit Position, **fast-check gegen Referenz-Evaluator (2.000 Läufe)**, Auswertung
  allokationsfrei (10⁶ Auswertungen < 256 KB), Layer-Pins.
- blueprints (18): mergePatch (null, id-Arrays, `$remove`, keine Mutation), Umrechnung + Rundung, extends/Vererbung/
  null-Löschung über 3 Ebenen, Patches vor extends, Validierungsfehler mit JSON-Pfad, Semantik (Layer, unbekannte
  Basis, test:-Basis, Duplikat, ungültige ID), **Zyklen**, **stabile ID-Vergabe** (Reihenfolge der Definitionen egal,
  bytegleiches sim.bin), **simHash ändert sich bei Sim-Werten/Kategorien, nicht bei View-Werten (und umgekehrt)**,
  **test:-Namespace ausgeschlossen**, Kategorie-Masken, **sim.bin → decodeSimBin-Roundtrip** (+ Re-Encode bytegleich),
  kaputte sim.bin abgelehnt, Content-Kompilat, **`content/generated` aktuell**, view.json-Parser, kanonisches JSON.
- sim (26):
  - Determinismus: 2 Läufe × 2.000 Ticks mit 1.000 Würfeln (900 + 100, Moves an Tick 5/300/700/1.100/1.500, Kills +
    Respawn, Stop) → **identische Hash-Kette (200 Hashes)**, unabhängig von der Eingabeform (Batch vs. Envelopes vs.
    CommandBatchView); anderer Seed → andere Kette.
  - **Snapshot bei Tick 1.000 + Restore** (in frische Welt und in die abgewichene Original-Welt) ⇒ gleicher Regel- und
    Voll-Hash bei Tick 2.000, Kette lückenlos gleich.
  - Commands: Spawn (Streuung, Klemmen, ungültige bp/Army), **Move-Ankunft** (Toleranz, idle, Yaw), Wenderate pro
    Tick, **Stop**, **fremde Army darf nicht befehlen**, **veraltete Handles ignoriert / Kill ⇒ Slot-Reuse FIFO mit
    gen+1**, (army, seq)-Reihenfolge unabhängig von der Ankunft, Queue = Ersetzen, unbekannte Ops/kaputte Payloads
    verworfen aber quittiert, Unit-Cap pro Army und Tabellen-Cap 8.192, Klemmen an der Kartengrenze, Menge von 60
    Würfeln kommt am Ziel zur Ruhe (Contagion) ohne Überlappung (> 0,5 WU Abstand).
  - Armies: 16 Zeilen, FFA + self, symmetrische Allianzen, Optionsprüfung.
  - **Grid-Query == Brute-Force (fast-check, 150 Läufe, Fein- und Grob-Grid, mit Kills)**, Besuchsreihenfolge +
    Abbruch, Counting-Sort-Invarianten.
  - **Frame-Inhalt entspricht State** (alle Felder je Unit, NoInterp nur im Spawn-Tick, Idle, ackSeq, hashTick/hash,
    Host-Meta), hp-Skalierung, bytegleiche Frames für gleiche Welten.
  - Layout: §3.5-Spaltenliste, Regionsreihenfolge, gepinnter layoutHash, Default-Werte unbenutzter Spalten; Phasen-
    Probe (Reihenfolge, HashTick nur jeden 10. Tick).
  - **Allokation:** 10.000 warme Ticks mit 1.000 fahrenden Würfeln (975 in Bewegung) inkl. Move-Batches alle
    100 Ticks, `writeFrame` jeden Tick und Hash alle 10 Ticks: **≈ 75 KiB Heap-Zuwachs** (Grenze 1 MB).

## Messwerte (lokal gemessen, Apple M5 Pro, Node 24.18 – nicht Referenz-Laptop)

`pnpm --filter @faf/sim bench` (5.000 Ticks, 1.000 Würfel in 10 Gruppen, alle 100 Ticks neue Ziele):

| Phase | p50 | p95 | p99 |
|---|---|---|---|
| **step gesamt (inkl. Hash-Ticks)** | 0,43 ms | **0,52 ms** | 0,56 ms |
| CommandApply | 0,000 ms | 0,000 ms | 0,035 ms |
| Orders | 0,013 ms | 0,013 ms | 0,020 ms |
| Movement | 0,39 ms | 0,47 ms | 0,51 ms |
| SpatialRebuild | 0,023 ms | 0,029 ms | 0,033 ms |
| Cleanup | 0,001 ms | 0,002 ms | 0,002 ms |
| Output | 0,000 ms | 0,041 ms | 0,046 ms |
| HashTick (nur Hash-Ticks) | 0,040 ms | 0,049 ms | 0,19 ms |

`writeFrame` (1.000 Units) ≈ 0,06 ms. Einzelmessungen: ruleHash ≈ 45 µs, fullHash ≈ 112 µs, Snapshot ≈ 17 µs.
Ziel MS1 (p95 ≤ 2 ms inkl. Hash-Tick) in Node klar erfüllt; die Browser-Worker misst P6. Hinweis: Unter Vitest
läuft derselbe Code etwa doppelt so langsam (≈ 1,0 ms/Tick, Transform-/Harness-Overhead) – Budget-Aussagen nur aus
`bench`/headless nehmen. Die ursprüngliche Separation ohne Schlafzustand lag bei p95 0,82 ms.

## Verträge für Folgepakete

- **sim-host (P5):** `createWorld({simBin, seed, armyCount: 2})`; pro Tick `step(world, batchBytes | view | null,
  probe)` – Commands gelten unabhängig vom Envelope-Tick in genau diesem Step (Host stempelt vorher per
  `setBatchTick`). Frame: `writeFrame(world, viewer, writer, producer.begin(), {seq, tickTimeUs, speedPermille,
  flags})` → `producer.commit(len)`. Phasenzeiten über `PhaseProbe` (ids 1–16, `HashTick` 17 geschachtelt in Output).
  `world.bp.simHash` = bpSimHash für `computeSimId`; `world.layoutHash` für `ready`. Keyframes = `snapshot/restore`.
- **headless (P6):** Szenarien mit `step` + protocol-Batches; Hash-Trail = `lastHash(w)` wenn `lastHashTick(w) ===
  w.tick`; Voll-Hash `fullHash(w)`. Die Tests unter `packages/sim/test/support/scenario.ts` zeigen ein Referenzszenario.
- **game (P7) / client (P4):** `content/generated/view.json` per `parseViewJson` (`@faf/blueprints/view`) lesen;
  `visuals[i].placeholder` direkt als Render-Visual `i` (Visual = Blueprint-Sim-ID). Cheat-Spawn für Würfel:
  `bp = 0` (`core:cube`); IDs nie hart codieren, sondern `decodeSimBin(simBin).indexOf('core:cube')`.
  Spawn-Positionen/Ziele werden auf [0, 512 WU] geklemmt. `ackSeq` im Frame: `0xFFFFFFFF` = noch nichts bestätigt.
- Neue Blueprints: Datei unter `content/blueprints/<ns>/units/*.ts` mit `export default defineUnit({...})`,
  danach `pnpm --filter @faf/blueprints compile` (der Test „content/generated is up to date“ erzwingt das).

## sim.bin-Format (Version 1, little-endian, Abschnitte 4-Byte-aligned)

| Off | Header (32 B) | Off | |
|---|---|---|---|
| 0 | magic u32 `'IFBP'` (0x50424649) | 16 | unitsOffset u32 |
| 4 | version u16 (1) | 20 | categoryNamesOffset u32 |
| 6 | headerBytes u16 (32) | 24 | unitIdsOffset u32 |
| 8 | unitCount u16 | 28 | totalBytes u32 |
| 10 | unitRecordBytes u16 (64) | | |
| 12 | categoryCount u16 | | |
| 14 | categoryWords u16 (4) | | |

UnitRecord (64 B, Index = Sim-ID): 0 speedPerTick i32 (Fx) · 4 accelPerTick i32 (Fx) · 8 turnRatePerTick u16 (Ang16) ·
10 layer u8 · 11 sizeClass u8 · 12 maxHp i32 · 16 radius i32 (Fx) · 20 vision i32 (Fx) · 24 maxSlope i32 (Fx) ·
28 footprintW u8 · 29 footprintH u8 · 30 flags u16 (0) · 32 categories u32×4 · 48 reserviert (16 B, 0).
Danach Stringtabellen (Kategorienamen in Bit-Reihenfolge, dann Unit-IDs in Sim-ID-Reihenfolge): je Eintrag u8 Länge +
ASCII, jede Tabelle auf 4 B mit Nullen aufgefüllt. `simHash` = xxHash32(sim.bin, Seed 0). Die String-IDs gehören
bewusst zu sim.bin: Umbenennen/Umsortieren ändert die Sim-ID-Zuordnung und damit simId (Replay-Kompatibilität).

**view.json:** `{format: 'faf-view', version: 1, visuals: [{id, placeholder {hull, size, color?}, icon?, iconThreshold?,
nameKey, descKey}]}`, Datei kanonisch pretty-printed; `viewHash` = xxHash32 der kompakten kanonischen Form (UTF-8).
**bundle.json:** kanonisch, `{format: 'faf-bundle', version, simHash, viewHash, categories, units: [{simId, id, source,
blueprint (vollständig aufgelöst), simUnits (umgerechnete Werte, Masken hex)}]}`. **hashes.json:** simHash, viewHash,
Anzahl Units/Kategorien, Größe sim.bin.

## Abweichungen (mit Begründung)

1. **`writeFrame(world, viewer, writer, target, meta?)`** statt `(world, viewer, writer)`: `FrameWriter.beginFrame`
   braucht den Zielpuffer und die Host-Felder (seq, tickTimeUs, speed, paused-Flag) gleichzeitig mit den Sim-Feldern.
2. **Zusätzliches Blueprint-Feld `sim.motion.radius`** (optional, Default `max(footprint)/2`): Der Würfel ist 0,5 WU
   groß, ein aus dem 1×1-Footprint abgeleiteter Radius von 0,5 WU wäre zu grob für die Separation. `core:cube` nutzt 0,3.
3. **Merge-Patches** als `definePatch(target, patch)`; Entfernen aus id-Arrays per `{id, $remove: true}` (für `null`
   gibt es in einem Array-Element keinen Schlüssel).
4. **Content importiert `define.ts` relativ** (`../../../../packages/blueprints/src/define.ts`): `content/` ist kein
   Workspace-Paket und Root-Configs sind tabu; der Import ist laufzeitfrei (nur Helfer/Typen). Typgeprüft wird Content
   über die Blueprint-Tests (`tsconfig.tests.json`).
5. **Abstrakte BPs** werden mit einem rekursiv-optionalen, aber strikten Schema geprüft (unbekannte Felder fallen auch
   dort auf); `health.max` ist ganzzahlig (Units.hp ist i32).
6. **`content/.gitignore` mit `!/generated/`**: Die Root-`.gitignore` (P0) schließt `content/generated/` aus, die
   Aufgabe verlangt die Dateien eingecheckt; die Ausnahme liegt in meinem owns-Pfad (`git check-ignore` bestätigt).
7. **`Units.gen`-Spalte** spiegelt die Tabellen-Generation (`$gen`) beim Spawn, weil §3.5 `gen` als Spalte führt.
8. **Ein Grid-Paar für alle Layer** statt „pro Layer“: In MS1 gibt es nur Land-Einheiten; Luft-Grids kommen mit MS12,
   die Query-API bleibt gleich.
9. **Ankunfts-Contagion und Schlafzustand** (MS1-Minimalform von §3.8): Ein fahrender Würfel, der einen am selben Ziel
   angekommenen idle Würfel berührt, gilt als angekommen (≤ 64 WU vom Ziel) – sonst drängeln Mengen am Zielpunkt
   endlos. Ruhende idle Würfel ohne Überlappung überspringen ihre eigene Nachbarsuche (`MoverBits.Asleep`), bis ein
   Nachbar sie überlappt oder ein Move kommt (p95 0,82 → 0,52 ms). Beides ist State in `movers` und damit gehasht.
10. **Pseudo-Phase `HashTick = 17`** geschachtelt in Output, damit der Host den Hash-Tick (L6-Kennzahl) getrennt misst.
11. **Cheats ignorieren den Besitz** (Kill beliebiger Units, Spawn für jede aktive Army); normale Commands prüfen ihn.
12. **Envelope-Tick wird nicht geprüft:** `step` wendet alle übergebenen Commands an (inputDelay = 0; der Host
    entscheidet, was in welchen Step gehört, und zeichnet den Anwendungs-Tick auf).
13. **`SIM_TICK_HZ` liegt in `@faf/rules`** (vom Compiler und der Sim geteilt, Abhängigkeitsrichtung erlaubt).
14. **Zusätzliche Paket-Exports** `@faf/blueprints/simbin`, `/view`, `/define` (TypeBox-freie Einstiege für Sim,
    Client und Content). Keine neuen Dependencies, kein `pnpm install` nötig; `pnpm-lock.yaml` unverändert.
15. Allianzen werden in MS1 nur beim Setup per `setAlliance` gesetzt (noch kein Command dafür).

## Bekannte Grenzen

- Flache Testebene ohne Hindernisse/Pathing (y = 0); Bewegung = direktes Steering. Separation schiebt nur die jeweils
  aktuelle Unit (halbe Überlappung) – bei sehr dichten Mengen bleiben kleine Restüberlappungen einzelne Ticks bestehen.
- Radius-Queries sind exakt gegenüber den Positionen zum Rebuild-Zeitpunkt (Phase 8); Units, die sich danach bewegen,
  können in einer Zelle außerhalb des Suchbereichs registriert sein (die Separation erweitert ihren Suchbereich darum).
- Zeitmessung nur in Node; Browser-Worker (Chromium/Firefox/WebKit) und Cross-Engine-Hash-Kette folgen in P6.
  Kalt-Allokation (erste Ticks nach `createWorld`) ist nicht separat gemessen.
- Keine i18n-Key-Prüfung (es gibt noch kein `content/locales`), keine Balancing-Gates, nur Typ `unit`.
- Seq-Vergleich ist numerisch (u16 ohne Wrap-Behandlung innerhalb eines Ticks); die Ordnung bleibt total und
  deterministisch.
- `pnpm lint` meldet weiterhin nur `.claude/workflows/faf-milestone.js` (Orchestrator-Skript, nicht Projektcode);
  `eslint . --ignore-pattern '.claude/**'` und dependency-cruiser sind grün.
