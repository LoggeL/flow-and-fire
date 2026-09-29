# ms2-p2-sim-map – Karte in der Arena, Höhe aus Heightmap, Tiefwasser, Map im init, mapSimHash in simId/Log, Goldens/Cross-Engine/Bench auf hollow-ridge

Stand 2026-09-29 (MS2, Welle 1). Feature-IDs (Sim-Anteil): **M1** (Einheiten stehen auf dem Terrain), **M2**
(Flachwasser passierbar, Tiefwasser blockiert Landeinheiten), **M3** (Karte im Worker, mapSimHash in simId/Log),
**M4** (Spots in der Arena abfragbar). Messwerte lokal auf Apple M5 Pro (Node 24.18, Playwright Chromium/Firefox/WebKit
headless) – kein Referenz-Laptop (DECISIONS 5).

Geändert wurden nur die owns: `packages/{sim,sim-host,protocol}/**`, `tools/headless/**`, dieses Fragment.
`packages/formats`, `packages/rules` blieben unverändert (die p0-APIs reichten). `apps/game` kompiliert unverändert
(alle neuen Felder optional bzw. nur lesend).

## Umgesetzt

| Bereich | Inhalt | Ort |
|---|---|---|
| Statische Kartenregionen | `map.terrain` (16 × i32: sizeWu, dim, heightScaleRaw, Wasser-Flag, waterLevelRaw, Anzahl Starts/Spots, Testebene-Flag), `map.heights` (dim² u16), `map.starts` (16 × army/x/z), `map.spots` (n × kind/x/z) – `area: 'static'`: hinter dem dynamischen Bereich, **nicht** im Regel-/Voll-Hash, **nicht** im Snapshot | `packages/sim/src/schema.ts`, `world.ts` |
| Karte in `createWorld` | `CreateWorldOptions.map?: MapSimData` (aus `formats.mapSimData()`), Validierung (dim, Länge, Skala, Wasser, Starts/Spots), Kartengröße aus der Karte; ohne `map` die flache MS1-Testebene (Höhen 0, kein Wasser, `mapSizeWu`) – beide über dieselben Regionen | `packages/sim/src/world.ts` |
| Terrain-Abfragen | `terrainHeight`, `waterDepth`, `isBlockedFor(layer)`, `surfaceY`, `placeUnit` (Landregel), Kartenabfragen `mapStartCount/mapStart/mapStartOfArmy/mapSpotCount/mapSpot/mapSpotCountOf`, `spawnRejectedCount`, `testPlaneMapSimHash` | `packages/sim/src/terrain.ts` |
| Movement (Phase 7) | jede Positionsänderung (Integration **und** Separation) läuft über `placeUnit`: y = `rules.sampleHeightRaw` an der neuen Position; Landeinheiten auf Karten mit Wasser: Kandidat tief ⇒ nur x ⇒ nur z ⇒ stehen (achsgetrenntes Gleiten), vollständig blockiert ⇒ Tempo 0; `vx/vz` = tatsächlich gefahrene Verschiebung; Flag `WaterBlocked` | `packages/sim/src/movement.ts` |
| Stuck-Regel (Phase 2) | fahrende Einheit, die sich bewegen will (Tempo > 0 oder vom Tiefwasser abgeschnitten) und 20 solche Ticks lang ihrer Bestdistanz nicht um ≥ 1/16 WU näher kommt ⇒ Order endet wie Stop (Ziel = eigene Position, Idle). Drehen auf der Stelle zählt nicht. Neue Spalten `Movers.best/stuck` | `packages/sim/src/movement.ts`, `constants.ts` |
| Spawn | `spawnUnit` setzt y (und py) auf die Terrainhöhe; Cheat-Spawn verwirft Punkte, die für den Layer blockiert sind (Land im Tiefwasser), zählt sie in Weltkopf-Wort 7 (`WH_SPAWN_REJECTED`, Regel-State) und verbraucht die RNG-Ziehung trotzdem | `packages/sim/src/{units,commands}.ts` |
| `SIM_BUILD` | `faf-sim/ms1.2` → **`faf-sim/ms2.0`** (History-Kommentar) | `packages/sim/src/constants.ts` |
| Protocol | `InitMessage.map?: ArrayBuffer` (.rtsmap-Bytes, transferiert; fehlt = Testebene); `parseInitMessage` prüft Typ (nur `ArrayBuffer`, kein SAB/View/String/null) und Größe 16 B … 256 MiB (`INIT_MAP_MIN_BYTES`, `INIT_MAP_MAX_BYTES`) | `packages/protocol/src/ctl.ts` |
| Sim-Host | `SimCoreOptions.map?: RtsMap \| Uint8Array` (Bytes ⇒ `readRtsMap`, Objekt ⇒ `validateRtsMap`), `SimCore.map/mapSimHash/mapName`; `simId = computeSimId(SIM_BUILD, bpSimHash, mapSimHash, mods)` (`simIdFor`; Testebene: `testPlaneMapSimHash`); Host-`init` liest `init.map` im Worker, kaputte Karte ⇒ `error`-Nachricht `FormatError: <code> …`, Host bleibt uninitialisiert; `HostReadyMsg` + `mapName`, `mapSizeWu` (`mapSimHash` jetzt echt) | `packages/sim-host/src/{core,host,identity}.ts` |
| Command-Log v2 | Kopf-Version 2 mit `u32 mapSimHash` @32 (buildHash ab 36); Reader akzeptiert v1 (= Testebene, `mapSimHash = testPlaneMapSimHash(mapSizeWu)`), `ParsedCommandLog.version`; `replayLog(log, {map?})` verweigert fehlende oder falsche Karte (`CommandLogError`) vor dem ersten Tick; `HeadlessSim.replay` reicht die eigene Karte durch | `packages/sim-host/src/{log-format,headless}.ts` |
| Keyframes/Restore | unverändert `memcpy` des dynamischen Bereichs – die statische Region bleibt unberührt (Tests) | `packages/heap` (unverändert), Tests |
| Headless | `ScenarioBuilder.map({sizeWu} \| {path} \| {rtsMap})`, `RunOptions.maps` (Bytes/RtsMap je Pfad), `invariant(every, name, fn)` (einmal gemeldet, erste Verletzung); Ergebnis + Golden v3 mit `map`, `mapSimHash`; 2 neue Goldens; Tick-Bench mit Karte; Harness-Worker lädt die Karte als Vite-Asset; Bench-Tabellen in dieses Fragment | `tools/headless/**` |
| sim-host-Bench | `pnpm --filter @faf/sim-host bench` läuft standardmäßig auf hollow-ridge (`--testplane` = MS1) | `packages/sim-host/bench/tick.ts` |

## Verträge / APIs für Folgepakete

```ts
// @faf/sim
createWorld({ bpTable | simBin, seed, armyCount, map?: MapSimData, mapSizeWu?, unitCapPerArmy? })
world.terrain: Heightfield            // Views in die statische Region (rules.sampleHeightRaw)
world.hasWater / world.waterLevel / world.testPlane / world.mapSizeWu
terrainHeight(w, x, z); waterDepth(w, x, z); isBlockedFor(w, layer, x, z); surfaceY(w, layer, ground)
placeUnit(w, slot, x0, z0, nx, nz): Placement  // Full | XOnly | ZOnly | Blocked; setzt x/z/y
mapStartCount(w); mapStart(w, i, out); mapStartOfArmy(w, army, out)   // out: {tag = army, x, z}
mapSpotCount(w); mapSpot(w, i, out); mapSpotCountOf(w, SpotKind.Mass | SpotKind.Hydro)  // tag = SpotKind
spawnRejectedCount(w); testPlaneMapSimHash(sizeWu)
SIM_BUILD = 'faf-sim/ms2.0'; STUCK_TICKS = 20; STUCK_PROGRESS_RAW = 256 (1/16 WU)

// @faf/protocol
InitMessage.map?: ArrayBuffer   // .rtsmap; post mit [init.simBin, init.map] transferieren

// @faf/sim-host
new SimCore/HeadlessSim({ …, map?: RtsMap | Uint8Array })  // .map, .mapSimHash, .mapName
HostReadyMsg { …, mapSimHash, mapName /* META-Name, z. B. 'Hollow Ridge', sonst 'testplane' */, mapSizeWu }
simIdFor(bpSimHash, mapSimHash); simIdOf(bpSimHash, mapSizeWu) /* Testebene */; testPlaneMapSimHash
replayLog(log, { bpTable | simBin, map?, untilTick?, keyframes? })
LOG_VERSION = 2, LOG_FIXED_HEADER_BYTES = 36, LOG_V1_FIXED_HEADER_BYTES = 32, LogHeader.mapSimHash

// @faf/headless
new ScenarioBuilder(name).map({ path: 'content/maps/hollow-ridge.rtsmap' }).invariant(1, name, fn)
runScenario(sc, { simBin, maps: { [path]: bytes } })   // Node: scripts/lib.ts loadMaps()
```

- **Karte im Spiel (ms2-p4):** `init.map` = Kopie der geladenen `.rtsmap`-Bytes (transferiert). Der Worker parst selbst
  (≈ 2 ms) und meldet `ready.mapSimHash`; bei Fehlern kommt statt `ready` ein `error` mit `FormatError: bad-crc …`.
  Cheat-Spawns ins Tiefwasser werden verworfen – Spawnpunkte der Sitzung daher auf Land legen (Starts sind trocken).
- **Frame-y:** `UnitRecord.curPos.y`/`prevPos.y` sind ab MS2 die Terrainhöhe (Fx raw, bitgleich zu
  `rules.sampleHeightRaw` bzw. `ClientMap.heightAtRaw`); `prev` wie bisher der Wert des Vortick.
- **Identitäten (Stand `faf-sim/ms2.0`, `content/generated/sim.bin` bpSimHash `0xd4135af1`):**

| Sitzung | mapSimHash | simId | Layout-Hash |
|---|---|---|---|
| Testebene 512 WU | `0x2f59dccf` | `0xca103f02` | `0x9c64c907` |
| hollow-ridge | `0x90ec94f0` | `0xb3668e44` | `0xb5633f05` |

Layout-Hash-Änderung: Testebene `0xcc8737d2` (ms1.2) → `0x9c64c907` (neue Spalten `Movers.best/stuck`, vier statische
Regionen; gepinnt in `packages/sim/test/world.test.ts`). Der Layout-Hash hängt ab MS2 auch von der Karte ab (Größe von
`map.heights`/`map.spots`). Arena: 2,03 MB gesamt, davon dynamisch 1,48 MB (Snapshot, unverändert groß mit und ohne
Karte), statisch 0,53 MB.

## Goldens (L2, `faf-sim/ms2.0`, Format v3 mit `map` und `mapSimHash`)

| Golden | Karte | Einheiten / Commands | End-Regel-Hash | End-Voll-Hash |
|---|---|---|---|---|
| `cubes-1000-move` (neu aufgenommen) | Testebene | 1.000 / 15 | `0xe08228f8` | `0x55c2c656` |
| `cubes-churn` (neu aufgenommen) | Testebene | 460 / 53 | `0x43683eb5` | `0x62bd26dd` |
| `ridge-1000-move` (neu) | hollow-ridge | 1.000 / 14 | `0xcfd6e981` | `0x63fdd6c3` |
| `ridge-water-block` (neu) | hollow-ridge | 70 / 10 | `0x162719df` | `0x7228e7df` |

- `ridge-1000-move`: 700 Würfel vom NW-, 300 vom SE-Plateau (24,1 WU); Viertel fahren Ost-/Südrampe hinab, auf die
  NW-Mesa, ins Hydro-Tiefland; Army 1 auf die SE-Mesa und zurück aufs Plateau. Asserts: Viertel 0 ≥ 90 % am
  Rampenfuß, mittleres y < 19 WU (vorher > 22), Army 1 zu ≥ 80 % wieder > 20 WU, alle 1.000 leben, alle in der Karte.
- `ridge-water-block`: Gruppe A (40, Army 0) von (230, 170) nach (282, 342) quer über den See: bleibt am NW-Ufer
  (x+z ≈ 461), ist bei Tick 300 komplett Idle (Stuck-Regel), später erneut über die Rinne beordert ⇒ wieder Idle
  auf der NW-Seite. Gruppe B (30, Army 1) von (320, 120) über die Furt (356, 156) nach (392, 192): alle ≤ 10 WU am Ziel
  und Idle (Tick 600), zurück (Tick 1.290) und wieder hinüber (Tick 2.000). 10 Cheat-Spawns in See/Rinne verworfen.
- **Invarianten beider Karten-Goldens:** nach **jedem** Tick keine Landeinheit tiefer als 0,5 WU im Wasser; alle
  10 Ticks `y == surfaceY(sampleHeightRaw(x, z))` für jede Einheit.
- `goldens --update` lässt eine geänderte Kette nur mit neuem `SIM_BUILD` zu – oder wenn sich allein die Karte
  (`mapSimHash`, bei gleichem `simHash`) geändert hat, weil diese die simId ohnehin ändert.

## Tests

| Datei | Inhalt |
|---|---|
| `packages/sim/test/terrain.test.ts` (neu) | Karte in statischen Regionen (Area, Lage hinter `dynamicEnd`, nicht in Regel-/Voll-Hash-Listen), Snapshot-Größe unabhängig von der Karte; statische Bytes manipuliert ⇒ Regel- und Voll-Hash unverändert; Snapshot/Restore (auch in frische Welt) lässt die statische Region bytegleich; Starts/Spots abfragbar (16 Mass, 2 Hydro, alle trocken); `terrainHeight/waterDepth/isBlockedFor` == rules in 5.000 Punkten; Validierung; **1.000 Würfel auf hollow-ridge 600 Ticks: nie im Tiefwasser (jeder Tick), y == sampleHeightRaw alle 10 Ticks (60.000 Prüfungen), > 700 Würfel ändern y um > 2 WU, py == y des Vortick** |
| `packages/sim/test/water.test.ts` (neu) | Kanal-Testkarte: frontal an die Rinne ⇒ stoppt bei x ≤ 29,5 WU, Idle nach ≥ 20 Ticks (Ziel = Position), neue Order funktioniert; schräg ⇒ **Gleiten** entlang z (> 5 WU); Furt 0,25 WU und Streifen mit exakt 0,5 WU passierbar; **Spawn-Ablehnung** (zählen, Teilscheibe über dem Ufer); Separation drückt nie ins Tiefwasser; ganze Gruppe endet Idle am eigenen Ufer; trockene Hangkarte: y == sampleHeightRaw jeden Tick |
| `packages/sim/test/determinism.test.ts` | + hollow-ridge: Batch- und Envelope-Eingabe ⇒ gleiche 200er-Kette, Karte ändert die Kette, 50 See-Spawns verworfen; **Snapshot bei Tick 1.000 + Restore ⇒ gleicher Regel-/Voll-Hash bei 2.000** |
| `packages/sim/test/alloc.test.ts` | + **Allokation warm mit Karte**: 10.000 Ticks, 1.000 Würfel über Hänge und gegen den Fluss inkl. Frame + Hash: 164–350 KiB, 0 GCs |
| `packages/sim/test/world.test.ts` | Regionenliste inkl. `map.*`, statische Regionen nicht im Voll-Hash, neuer Layout-Hash gepinnt |
| `packages/protocol/test/ctl.test.ts` | `init.map`: ArrayBuffer ok (auch nach structuredClone), View/String/null/SAB/zu klein ⇒ abgelehnt |
| `packages/sim-host/test/map.test.ts` (neu) | Host-init mit Karte ⇒ `ready` (mapName, mapSizeWu, mapSimHash `0x90ec94f0`, simId), Log-Kopf mit mapSimHash, Frame-y == Terrain, See-Spawns verworfen; Testebene behält ihre Identität; **kaputte Karte (CRC, Magic, Kürzung) ⇒ `error` mit Grund, Host uninitialisiert**; nicht-ArrayBuffer ⇒ `error`; **simId unterscheidet Karten** (1 Höhensample ≠, Name/Vorschau egal, Bytes == Objekt); **L4 auf hollow-ridge**: Replay mit Karte == Kette/End-Hashes (Bytes und Objekt), fehlende/falsche Karte verweigert (auch Karte für Testebenen-Log), Restore Tick 1.000 ⇒ gleiche Hashes bei 2.000, Keyframe-Seek == Direktlauf, statische Region unberührt |
| `packages/sim-host/test/recorder.test.ts` | Log-Kopf v2 (Byte-Layout gepinnt, mapSimHash @32), **v1-Datei (MS1) lesbar ⇒ Testebenen-mapSimHash**, Version 0/3 abgelehnt |
| `packages/sim-host/test/alloc.test.ts` | Host-Tick-Pfad parametrisiert: Testebene und **hollow-ridge** (je 10.000 warme Ticks < 1 MB) |
| `packages/sim-host/test/{transport,host,worker,l4-replay,…}.test.ts` | unverändert grün (Transport-Bytegleichheit SAB/Transfer) |
| `tools/headless/test/goldens.test.ts` | 4 Goldens bitgleich, ≥ 2 je Testebene/hollow-ridge, Update-Regel inkl. Kartenänderung, v3-Parser |
| `tools/headless/test/scenario-map.test.ts` (neu) | Datei-Karte muss übergeben werden, Bytes == RtsMap, Pfadvalidierung, Inline-Karte + Testebene melden mapSimHash, Invarianten melden erste Verletzung einmal, Tick-Bench auf hollow-ridge |

Selbsttest (2026-09-29, streng sequenziell):

| Befehl | Ergebnis |
|---|---|
| `pnpm vitest run packages/sim packages/sim-host packages/protocol packages/formats packages/rules tools/headless` | **37 Dateien, 228 Tests grün** |
| `pnpm --filter @faf/headless goldens` | 4/4 bitgleich (`faf-sim/ms2.0`) |
| `pnpm test:xengine` | **80/80 Hash-Ketten == Goldens** (4 Szenarien × Node/Chromium/Firefox/WebKit × kalt/warm/3 Aufwärmläufe) |
| `pnpm bench -- --update-docs` | Exit 0; MS2-Tick p95 max. **0,54 ms** (Firefox warm) auf hollow-ridge, MS1-Testebene 0,33 ms, SPK1 1,66 ms, SPK5-Hash-Tick 0,45 ms; sim-host-Bench (Node, hollow-ridge) p95 0,58 ms – Tabellen unten |
| `pnpm typecheck` / `pnpm lint` | für alle Projekte dieses Pakets grün; rot nur durch die parallel laufende Arbeit von ms2-p3-client (`tools/assets-pipeline/src/{gltf,build}.ts`, dep-cruiser-Befund in `packages/client/src/fullscreen.ts`) – nicht in meinen owns |

## Messwerte

Cross-Engine (2.000 Ticks, kalt/warm): `ridge-1000-move` Chromium/Firefox/WebKit ≈ 0,8/0,8/0,5 s, `ridge-water-block`
≈ 0,04–0,08 s; Node-Referenz ≈ 0,8 s. Allokation: Sim + Frame + Hash mit Karte ≈ 164 KiB / 10.000 warme Ticks, Host-Pfad
mit Karte ≈ 725 KiB (Testebene ≈ 535 KiB; Streuung je Lauf), 0 GCs in den Messblöcken. `sim-host`-Bench (Node, 3.000
Ticks, 1.000 Würfel auf hollow-ridge): Sim-Step p50 0,52 / p95 0,68 ms (Testebene 0,45 / 0,52 ms), Movement p95
0,61 ms.

<!-- bench:begin -->
Letzter Lauf: 2026-09-29, `pnpm --filter @faf/headless bench`. **Lokal gemessen (Apple M5 Pro), nicht Referenz-Laptop.**
Node v24.18.0; Browser: Playwright-Builds (headless) von Chromium, Firefox, WebKit, Module-Worker, crossOriginIsolated.
JIT kalt = erster Lauf im frischen Worker bzw. Node-Prozess, warm = Lauf nach 3 Aufwärmläufen im selben Worker.
Reps > 1: Engine-Uhr zu grob (WebKit 1 ms) → jeder Tick wird per Arena-Snapshot/Restore mehrfach ausgeführt und gemittelt (Restore-Kosten abgezogen).

| Kriterium | Budget | gemessen (max. über Engines, kalt/warm) | Ergebnis |
|---|---|---|---|
| MS2 Sim-Tick p95, 1.000 fahrende Würfel auf hollow-ridge, inkl. Hash-Tick | ≤ 2 ms | 0,540 ms (firefox warm) | erfüllt |
| MS1 Sim-Tick p95 (Testebene, Referenz) | ≤ 2 ms | 0,330 ms (node kalt) | erfüllt |
| SPK1 Big-Battle-Prototyp p95 | ≤ 25 ms | 1,66 ms (node warm) | erfüllt → TS |
| SPK5 Hash-Tick (Live-Bereich, 1.000 Units) p95 | ≤ 2 ms | 0,445 ms | erfüllt → JS-Hash |

### Tick-Bench MS2 auf hollow-ridge (1.000 fahrende Würfel, 1000 gemessene Ticks)

Sim-Tick gesamt (`step` inkl. CommandApply und Hash-Tick) sowie Hash-Tick allein (nur Hash-Ticks, jeder 10.).

| Engine | JIT | Reps | Uhr | p50 | p95 | p99 | max | Hash-Tick p95 | fahrend am Ende |
|---|---|---|---|---|---|---|---|---|---|
| node | kalt | 1 | 0,0001 ms | 0,331 | **0,472** | 0,508 | 1,11 | 0,182 | 998/1000 |
| node | warm | 1 | 0,0001 ms | 0,334 | **0,505** | 0,630 | 1,76 | 0,053 | 998/1000 |
| chromium | kalt | 1 | 0,0050 ms | 0,275 | **0,445** | 0,575 | 1,07 | 0,445 | 998/1000 |
| chromium | warm | 1 | 0,0050 ms | 0,265 | **0,410** | 0,445 | 0,540 | 0,030 | 998/1000 |
| firefox | kalt | 1 | 0,0200 ms | 0,340 | **0,520** | 0,700 | 1,04 | 0,120 | 998/1000 |
| firefox | warm | 1 | 0,0200 ms | 0,320 | **0,540** | 0,680 | 0,920 | 0,080 | 998/1000 |
| webkit | kalt | 20 | 1,0000 ms | 0,132 | **0,182** | 0,232 | 0,382 | 0,050 | 998/1000 |
| webkit | warm | 20 | 1,0000 ms | 0,134 | **0,184** | 0,234 | 0,284 | 0,050 | 998/1000 |

p95 je Phase (ms):

| Engine | JIT | CommandApply | Orders | Movement | SpatialRebuild | Cleanup | Output | HashTick |
|---|---|---|---|---|---|---|---|---|
| node | kalt | 0,003 | 0,021 | 0,424 | 0,029 | 0,002 | 0,042 | 0,182 |
| node | warm | 0,002 | 0,018 | 0,447 | 0,029 | 0,002 | 0,044 | 0,053 |
| chromium | kalt | 0,005 | 0,015 | 0,390 | 0,030 | 0,005 | 0,025 | 0,445 |
| chromium | warm | 0,005 | 0,010 | 0,370 | 0,030 | 0,005 | 0,020 | 0,030 |
| firefox | kalt | 0,020 | 0,020 | 0,480 | 0,020 | 0,000 | 0,060 | 0,120 |
| firefox | warm | 0,020 | 0,020 | 0,500 | 0,020 | 0,000 | 0,060 | 0,080 |
| webkit | kalt | 0,000 | 0,050 | 0,200 | 0,050 | 0,000 | 0,000 | 0,050 |
| webkit | warm | 0,000 | 0,050 | 0,200 | 0,050 | 0,000 | 0,000 | 0,050 |

**Ziel:** p95 ≤ 2 ms im langsamsten Engine-Worker inkl. Hash-Tick → gemessen max. p95 = **0,540 ms** (firefox warm) ⇒ **erfüllt**.

### Tick-Bench MS1-Referenz (Testebene) (1.000 fahrende Würfel, 1000 gemessene Ticks)

Sim-Tick gesamt (`step` inkl. CommandApply und Hash-Tick) sowie Hash-Tick allein (nur Hash-Ticks, jeder 10.).

| Engine | JIT | Reps | Uhr | p50 | p95 | p99 | max | Hash-Tick p95 | fahrend am Ende |
|---|---|---|---|---|---|---|---|---|---|
| node | kalt | 1 | 0,0001 ms | 0,202 | **0,330** | 0,487 | 0,955 | 0,205 | 1000/1000 |
| node | warm | 1 | 0,0001 ms | 0,206 | **0,317** | 0,443 | 0,634 | 0,075 | 1000/1000 |
| chromium | kalt | 1 | 0,0050 ms | 0,135 | **0,165** | 0,540 | 0,940 | 0,420 | 1000/1000 |
| chromium | warm | 1 | 0,0050 ms | 0,135 | **0,165** | 0,200 | 0,270 | 0,025 | 1000/1000 |
| firefox | kalt | 1 | 0,0200 ms | 0,160 | **0,260** | 0,360 | 0,740 | 0,100 | 1000/1000 |
| firefox | warm | 1 | 0,0200 ms | 0,160 | **0,240** | 0,340 | 0,520 | 0,080 | 1000/1000 |
| webkit | kalt | 20 | 1,0000 ms | 0,083 | **0,083** | 0,133 | 0,233 | 0,050 | 1000/1000 |
| webkit | warm | 20 | 1,0000 ms | 0,084 | **0,084** | 0,084 | 0,184 | 0,050 | 1000/1000 |

p95 je Phase (ms):

| Engine | JIT | CommandApply | Orders | Movement | SpatialRebuild | Cleanup | Output | HashTick |
|---|---|---|---|---|---|---|---|---|
| node | kalt | 0,006 | 0,023 | 0,234 | 0,033 | 0,002 | 0,048 | 0,205 |
| node | warm | 0,003 | 0,026 | 0,241 | 0,036 | 0,002 | 0,045 | 0,075 |
| chromium | kalt | 0,005 | 0,015 | 0,120 | 0,030 | 0,005 | 0,015 | 0,420 |
| chromium | warm | 0,005 | 0,015 | 0,125 | 0,035 | 0,005 | 0,015 | 0,025 |
| firefox | kalt | 0,020 | 0,020 | 0,180 | 0,020 | 0,000 | 0,060 | 0,100 |
| firefox | warm | 0,020 | 0,020 | 0,200 | 0,020 | 0,000 | 0,060 | 0,080 |
| webkit | kalt | 0,000 | 0,050 | 0,100 | 0,050 | 0,000 | 0,000 | 0,050 |
| webkit | warm | 0,000 | 0,050 | 0,100 | 0,050 | 0,000 | 0,000 | 0,050 |

**Ziel:** p95 ≤ 2 ms im langsamsten Engine-Worker inkl. Hash-Tick → gemessen max. p95 = **0,330 ms** (node kalt) ⇒ **erfüllt**.

### SPK1 Sim-Durchsatz (1.000 Bodeneinheiten, 300 Flugzeuge, ≈ 4.000 Projektile; 300 Ticks nach 40 Ramp-Ticks)

| Engine | JIT | Reps | p50 | p95 | p99 | max | Projektile Ø (min) | Treffer/Kills gesamt |
|---|---|---|---|---|---|---|---|---|
| node | kalt | 1 | 1,02 | **1,42** | 1,73 | 2,16 | 3863 (3792) | 41523/437 |
| node | warm | 1 | 1,14 | **1,66** | 1,94 | 2,47 | 3863 (3792) | 41523/437 |
| chromium | kalt | 1 | 0,920 | **1,40** | 1,63 | 2,69 | 3863 (3792) | 41523/437 |
| chromium | warm | 1 | 0,935 | **1,08** | 1,20 | 1,45 | 3863 (3792) | 41523/437 |
| firefox | kalt | 1 | 1,02 | **1,16** | 1,32 | 1,66 | 3863 (3792) | 41523/437 |
| firefox | warm | 1 | 1,04 | **1,18** | 1,28 | 1,38 | 3863 (3792) | 41523/437 |
| webkit | kalt | 4 | 0,496 | **0,746** | 0,996 | 1,25 | 3863 (3792) | 41523/437 |
| webkit | warm | 4 | 0,496 | **0,746** | 0,746 | 0,746 | 3863 (3792) | 41523/437 |

p95 je Teilsystem (ms):

| Engine | JIT | Movement | Air | Spatial | Vision | Targeting | Weapons | Projectiles | Cleanup | Hash |
|---|---|---|---|---|---|---|---|---|---|---|
| node | kalt | 0,226 | 0,026 | 0,119 | 0,052 | 0,740 | 0,071 | 0,266 | 0,013 | 0,238 |
| node | warm | 0,286 | 0,031 | 0,146 | 0,067 | 0,887 | 0,081 | 0,310 | 0,015 | 0,131 |
| chromium | kalt | 0,165 | 0,015 | 0,105 | 0,035 | 0,525 | 0,050 | 0,195 | 0,010 | 0,600 |
| chromium | warm | 0,165 | 0,010 | 0,110 | 0,035 | 0,565 | 0,050 | 0,190 | 0,005 | 0,045 |
| firefox | kalt | 0,240 | 0,020 | 0,080 | 0,080 | 0,500 | 0,040 | 0,220 | 0,020 | 0,120 |
| firefox | warm | 0,240 | 0,020 | 0,080 | 0,080 | 0,500 | 0,040 | 0,220 | 0,020 | 0,140 |
| webkit | kalt | 0,250 | 0,250 | 0,250 | 0,250 | 0,500 | 0,250 | 0,500 | 0,000 | 0,250 |
| webkit | warm | 0,250 | 0,000 | 0,250 | 0,250 | 0,500 | 0,250 | 0,500 | 0,000 | 0,250 |

**Exit SPK1 (§4):** p95 ≤ 25 ms in der langsamsten Engine inkl. Hash-Tick → gemessen max. p95 = **1,66 ms** (node warm) ⇒ **erfüllt – alles bleibt TypeScript** (Rust/WASM-Ausweg aus DECISIONS Punkt 2 wird nicht gezogen).
End-Hash des SPK1-Laufs in allen Engines/Modi: 0xe14862d1 (identisch).

### SPK5 Hash & Snapshot (Arena 20 MiB `WebAssembly.Memory`, warm)

| Engine | JS==WASM (20 MiB / Live / 400 Zufallsbereiche) | xxh32 JS 20 MiB | xxh32 WASM 20 MiB | Live-Bytes | Sim-Regel-Hash p95 (Hash-Tick) | kalt p95 | JS Live p95 | WASM Live p95 |
|---|---|---|---|---|---|---|---|---|
| node | ja / ja / ja | 13,6 ms (1,55 GB/s) | 1,65 ms (12,73 GB/s) | 144648 | **0,191 ms** | 0,257 ms | 0,072 ms | 0,012 ms |
| chromium | ja / ja / ja | 1,76 ms (11,92 GB/s) | 1,64 ms (12,83 GB/s) | 144648 | **0,015 ms** | 0,285 ms | 0,015 ms | 0,015 ms |
| firefox | ja / ja / ja | 3,06 ms (6,85 GB/s) | 1,64 ms (12,79 GB/s) | 144648 | **0,050 ms** | 0,060 ms | 0,020 ms | 0,020 ms |
| webkit | ja / ja / ja | 1,60 ms (13,11 GB/s) | 1,60 ms (13,11 GB/s) | 144648 | **0,020 ms** | 0,020 ms | 0,020 ms | 0,020 ms |

| Engine | Snapshot 20 MiB p50 (Arena → Puffer) | Restore 20 MiB p50 (Puffer → Arena) | Sim-Snapshot (Bytes) p95 | Sim-Restore p95 | Keyframe deflate-raw (Bytes → Bytes, Ratio) | deflate p50 | inflate p50 | 20 MiB Zufall deflate p50 (Ratio) |
|---|---|---|---|---|---|---|---|---|
| node | 0,338 ms | 0,336 ms | 0,024 ms (1477352) | 0,020 ms | 1477352 → 43879 (33,7:1) | 2,73 ms | 1,33 ms | 277,8 ms (1,01:1) |
| chromium | 0,405 ms | 0,360 ms | 0,025 ms (1477352) | 0,020 ms | 1477352 → 43879 (33,7:1) | 2,32 ms | 0,405 ms | 233,8 ms (1,01:1) |
| firefox | 0,340 ms | 0,320 ms | 0,020 ms (1477352) | 0,020 ms | 1477352 → 42067 (35,1:1) | 0,700 ms | 0,500 ms | 205,4 ms (1,01:1) |
| webkit | 0,350 ms | 0,350 ms | 0,020 ms (1477352) | 0,020 ms | 1477352 → 39560 (37,3:1) | 3,00 ms | 0,000 ms | 250,0 ms (1,01:1) |

**Exit SPK5 (§4):** Hash-Tick ≤ 2 ms in der langsamsten Engine → gemessen max. p95 = **0,445 ms** (SPK5-Live-Hash: 0,285 ms, chromium kalt; Tick-Bench-Hash-Tick: 0,445 ms, chromium kalt) ⇒ **erfüllt – Live-Bereich-Hash bleibt in JS** (kein Rolling-Hash, kein WASM nötig).

<!-- bench:end -->

## Abweichungen mit Begründung

- **Stuck-Regel allgemein statt nur bei Wasserkontakt:** Der Auftrag nennt „20 Ticks ohne Fortschritt ⇒ Idle“ im
  Tiefwasser-Kontext. Zählt man nur Ticks, in denen das Wasser die eigene Bewegung abschneidet, bleiben die Einheiten
  *hinter* der ersten Reihe einer Gruppe ewig „fahrend“ (sie berühren das Wasser nie, kommen wegen der Separation aber
  nicht voran) – Gruppe A würde nie Idle. Deshalb zählt jeder Tick, in dem die Einheit sich bewegen will (Tempo > 0 oder
  vom Wasser abgeschnitten), ohne ihrer Bestdistanz um ≥ 1/16 WU näherzukommen (PLAN §3.8 „Stuck (< ε über 20 Ticks)“).
  Drehen auf der Stelle (Tempo 0) zählt nicht. Nebenwirkung auch auf der Testebene: eingekeilte Würfel am Rand einer
  Traube geben nach 2 s auf (spart Separation-Kosten). **MS2-Minimalform** – MS3 (M5: Passierbarkeit, HPA*, Repath)
  ersetzt „aufgeben“ durch Umweg/Repath.
- **Passierbarkeit nur als Punktprüfung:** Tiefwasser wird am Kandidatenpunkt geprüft (keine Grids, keine Clearance,
  keine Neigungsgrenze – Klippen sind in MS2 befahrbar). Bei 0,3 WU/Tick Maximaltempo kann keine Einheit eine
  Tiefwasserzone „überspringen“ (schmalste Rinne ≫ 0,3 WU).
- **Layer-Regel:** Nur `Land` wird blockiert. `surfaceY` legt Hover/Water auf die Wasseroberfläche, alle anderen auf den
  Grund (Luft ohne Flughöhe bis MS12); in MS2 existieren nur Land-Blueprints.
- **`testPlaneMapSimHash` liegt jetzt in `@faf/sim`** (sim-host re-exportiert): `tools/headless` braucht es für Goldens
  und hängt nicht von `sim-host` ab (kein `pnpm add`). Wert unverändert.
- **Spawn-Zähler im Regel-State** (`WH_SPAWN_REJECTED`): deterministisch und damit im Hash – so belegt die Golden-Kette
  auch die Ablehnung.
- **`parseInitMessage` prüft nur Typ und Größe** der Kartenbytes; Magic/CRC/Werte prüft `readRtsMap` im Worker, damit
  die `error`-Nachricht den konkreten Grund (`bad-crc`, `bad-magic`, `truncated` …) nennt.
- **Golden-Format v3** (+ `map`, `mapSimHash`); v2-Dateien werden von `--update` als „neu“ ersetzt. `goldens --update`
  akzeptiert eine reine Kartenänderung ohne SIM_BUILD-Bump (simId ändert sich über mapSimHash).
- **Harness-Karte per `new URL(…, import.meta.url)`** statt `?url`-Import: wie `sim.bin`, ohne Vite-Typdeklarationen im
  Worker-Projekt; Vite emittiert die Datei als gehashtes Asset nach `dist-harness`.
- **Bench-Tabellen** landen seit MS2 in diesem Fragment (`STATUS_DOC`); die MS1-Tabellen in `P6-headless.md` bleiben als
  MS1-Stand stehen. `bench` endet jetzt mit Exit 1, wenn das MS2-Tick-Budget (hollow-ridge) reißt.
- **`sim-host`-Bench** läuft standardmäßig auf hollow-ridge (MS2-Budget), `--testplane` für MS1. Sie schreibt wie in MS1
  `packages/sim-host/bench/results/node-<datum>.json`.

## Bekannte Grenzen

- Kein Pathing: Einheiten fahren geradeaus, gleiten am Ufer und geben auf – sie finden die Furt nicht selbst (MS3).
- Props aus der Karte werden gespeichert (mapSimHash), aber nicht in die Arena übernommen (MS8).
- Keine Neigung/Tilt in der Sim (Units.bank bleibt 0), keine Neigungsbremse (PLAN §3.8 „Neigung bremst“ – MS3).
- `Placement` prüft Map-Kanten nur über die Klemmung auf [0, sizeWu]; Randhöhe = geklemmtes Sample (Formel).
- Log v1 bleibt lesbar, lässt sich mit `faf-sim/ms2.0` aber nicht mehr bitgleich abspielen (anderer SIM_BUILD ⇒ andere
  simId ⇒ `replayLog` verweigert) – wie vorgesehen.
