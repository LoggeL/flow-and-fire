# ms3-p2-sim – Sim-Seite von MS3: Nav-Integration, Order-Queue, Kinematik/Steering, Gruppen, Watch, devReload

Stand 2026-09-29 (MS3, Welle 1). Feature-IDs: **G7** (Order-Queue Move/Stop mit Shift, Stuck-/Unreachable-Handling),
**G8** (Kinematik), **M7** (Steering/Kollision), Sim-Integration von **M5/M6** (Passierbarkeit je Größenklasse,
PathService, Korridor-Repath), Gruppen-Move mit **Offset-Erhalt** (PLAN §3.8), Watch-Sektion (§3.6), `ctl.devReload`
mit sim.bin (HMR-Grundlage). Grundlagen: API-Vertrag `docs/status/ms3-p0-nav.md`, SPK2-Parameter (DECISIONS 22,
`tools/headless/src/spk2/params.ts`), sim.bin v2 (`docs/status/ms3-p1-blueprints-spk2.md`). Messwerte **lokal, Apple
M5 Pro, Node 24.18**, teils unter Fremdlast (parallele Workflows) – kein Referenz-Laptop (DECISIONS 5).

Geändert wurden nur die owns: `packages/sim/**`, `packages/sim-host/**`, `packages/protocol/**`, `packages/nav/**`
(additive API), `tools/headless/**`, dieses Fragment. `SIM_BUILD` = **`faf-sim/ms3.0`**; alle Goldens neu aufgenommen.

## Umgesetzt

| Bereich | Inhalt | Ort |
|---|---|---|
| A Arena/World | Nav-Regionen (`addNavRegions`) im Schema; `createWorld` → `nav.precomputeStatic` (statischer Bereich aus der Karte) + `rebuildDerived`; neue Regionen `orders` (Slab), `formations` (Table), `paths.owner` (Pfad → Besitzer); Snapshot/Voll-Hash inkl. abgeleiteter Nav-Regionen, Regel-Hash inkl. Footprints, Pfaden, Queues, Gruppen. Land-Units betreten nur Nav-Zellen mit Clearance ≥ Klasse **und** keine Punkte im Tiefwasser (achsgetrenntes Gleiten bleibt); Cheat-Spawn lehnt für die Klasse blockierte Punkte ab (Zähler wie MS2) | `src/world.ts`, `src/schema.ts`, `src/terrain.ts`, `src/commands.ts` |
| B G7 Queue | `OrderPool` (32-B-Records: type/flags, Ziel Fx, Gruppe, eigener Pfad, next, gepackter Offset, Tick), Liste `Units.orderHead/orderTail`, Cap 32 je Unit + Pool-Cap 32.768 (Überlauf verworfen, `WH_ORDERS_DROPPED`); Move ohne `CmdFlags.Queue` ersetzt (Pfade/Gruppen frei), mit Queue hängt an; Stop leert und bremst (mit Queue: Haltepunkt). Orders-Phase mit `OrderBehavior {begin, tick, complete}` für Move/Stop, nächste Order beginnt im selben Tick. Stuck-Kette: 1. Repath (eigener Pfad), 2. Ausweichpunkt 2,5 WU seitlich (Seite mit mehr Clearance) bzw. nächster erreichbarer Punkt, 3. Aufgabe (`WH_STUCK_GIVEUPS`). Unerreichbares Ziel ⇒ Nav-Retarget/Spiralsuche, Order läuft zum Ersatzziel | `src/orders.ts` |
| C Gruppen | Move mit ≥ 2 eigenen Units = Gruppenbefehl: **genau eine** Pfadanfrage (Start: Unit nächst am Schwerpunkt, Klasse = größte der Gruppe), Gruppen-Record in `Formations` (Anker, Anzahl, Pfad, Referenzzähler, Cursor). Offset = Position − Schwerpunkt, gleichmäßig komprimiert auf R(n) = 2 + 1,1·√n WU, nie enger als ri + rj + 0,15 WU (Ausnahme s. Abweichungen); Slot = Anker + Offset, blockiert/anderskomponentig ⇒ nächster erreichbarer Punkt. Folgen: Gruppen-Wegpunkt + Offset, wenn für die Klasse passierbar und in Clearance-LOS, sonst der Wegpunkt; im Nahbereich/bei freier LOS direkt zum Slot. Einzel-Move = Gruppe aus 1 (eine Anfrage), Kurzweg = Nav-Direct (keine Suche). Gequeuete Moves: eigener Gruppen-Record je Eintrag, Anfrage bei Beginn der Order | `src/commands.ts`, `src/orders.ts`, `src/movement.ts` |
| D PathService | Phase 3: Korridor-Repaths (Gruppenpfad ab vorherigem Wegpunkt, eigene Pfade ab Unit-Position), `nav.serviceTick(PATH_BUDGET_EXPANSIONS = 20.000)`, fertige Gruppen erhalten den wirksamen Anker. Lazy Refinement in Phase 7 (höchstens `REFINE_SEGMENTS_PER_TICK = 32` Segmente je Tick). Units ohne fertigen Pfad fahren sofort in Richtung Slot | `src/pathservice.ts`, `src/movement.ts` |
| E G8/M7 | SPK2-Parameter auf Fx/Ang16 (Tabelle unten): Beschleunigung/Bremsen (Blueprint), Start-Kick, Wenderate, Anfahren unter 70° (Tempo linear 100 % → 40 %), darüber Drehen auf der Stelle mit 10 % Kriechtempo, Bremskurve zum Slot, Neigung bremst (Nav-Kostenstufe), Separation (≤ 8 nächste Nachbarn), Gradient weg von blockierten Zellen (Clearance-Feld), positionsbasierte Kollision nach Masse × Priorität (fahrend 4×; Units ohne Tempo unverschiebbar), Idle-Nudge, Arrival-Contagion je Anker, Slot-Rückkehr, Schlafzustand | `src/movement.ts` |
| F Hindernisse | `CheatSub.Footprint = 3` (i32 cellX, i32 cellZ, u16 w, u16 h, i8 delta) mit Encoder/Decoder/Readern; Anwendung ⇒ `nav.stampFootprint` ⇒ Korridorregel markiert Pfade ⇒ Repath in Phase 3 (`repathsTriggered`); Units auf frisch blockierten Zellen ⇒ Mitte der nächsten passierbaren Zelle (`WH_UNITS_EVICTED`); ungültige Stempel gezählt (`WH_FOOTPRINT_REJECTED`) | `packages/protocol/src/{ops,payloads}.ts`, `src/commands.ts` |
| G Frame v2 | Header 128 B (Watch-Offset/-Anzahl, Pfadstatistik), Watch-Sektion (≤ 64 Records à 332 B) zwischen Events und Debug; `FrameWriter.setPathStats/beginWatch/addWatchTarget/addWatchPoint`, `FrameReader` mit Gettern (v1-Frames weiter lesbar); `UnitRecord.flags.Idle` = keine Orders, Stillstand, kein Nudge | `packages/protocol/src/frame.ts`, `src/frame.ts` |
| H sim-host | `ctl.watch` → Watch-Sektion; `ctl.devReload {simBin?}`: dekodieren, Kompatibilität prüfen, Blueprint-Tabelle tauschen (`replaceBlueprints`), MARK devReload (Log tainted), neue simId, Antwort `status` (bzw. `error` mit Grund); Nav-Precompute-Zeit in `ready`/`status`; Pfadzähler in `stats`; Bench-Szenario MS3 | `src/{core,host}.ts`, `bench/tick.ts` |
| I Goldens | `SIM_BUILD` `faf-sim/ms3.0`, 4 bestehende Goldens neu (Asserts an MS3 angepasst), 4 neue: `ridge-group-offset`, `ridge-shift-queue`, `choke-3wu`, `obstacle-repath`; generierte Karten als RtsMap (`src/maps.ts`), Harness um nav ergänzt; **`pnpm test:xengine`: 160 Hash-Ketten (8 Szenarien × Node/Chromium/Firefox/WebKit × kalt/warm/3 Warm-ups) bitgleich** | `tools/headless/**` |

## Verträge für Folgepakete (ms3-p4 Client, ms3-p5 Bench, ms3-p6 E2E)

### Frame v2 (`@faf/protocol`, `FRAME_VERSION = 2`, `FRAME_HEADER_BYTES = 128`)

Header wie v1 (0–95) plus: `96 watchOffset u32`, `100 watchCount u32`, `104 pathPending u32`, `108 requestsIssued u32`,
`112 repathsTriggered u32`, `116 expansionsLastTick u32`, `120 stuckGiveUps u32`, `124 reserviert`. Reihenfolge der
Sektionen: `header | units | parts | projectiles | beams | events | watch | debug` (Debug bleibt letzte Sektion, der
Host hängt PhaseTimes weiter dahinter an). `FrameReader.reset` akzeptiert Header ≥ 96 B (`FRAME_HEADER_BYTES_V1`); in
v1-Frames lesen sich Watch und Statistik als 0. `DEFAULT_FRAME_CAPS.watch = 64` (`FrameCaps.watch` optional,
fehlend = 0); `frameCapacityBytes` wächst um 64 × 332 B.

WatchRecord (`WATCH_RECORD_BYTES = 332`): `0 handle u32 | 4 orderCount u16 | 6 flags u8 | 8 targetCount u8 |
9 pointCount u8 | 12 targets[16] {type u8, pad 3, x i32, z i32} | 204 points[16] {x i32, z i32}`.

| Feld | Inhalt |
|---|---|
| `orderCount` | Einträge der Queue (inkl. aktiver Order), kann > 16 sein |
| `targets[k]` | `WatchOrderType.Move` (1) / `Stop` (2); aktive Move-Order: der Slot der Unit (`unitInfo.targetX/Z`), gequeuete Moves: Anker + Offset der Unit, Stop: Haltepunkt |
| `points[k]` | verbleibende Route zur aktiven Order: ggf. Ausweichpunkt, dann Wegpunkte des (Gruppen-)Pfads ab dem eigenen Index (verfeinerte, dann Portal-/Knotenmitten; Gruppenpfad um den eigenen Offset verschoben, letzter Punkt = Slot); leer auf dem Final Leg (Ziel = `targets[0]`) oder bei ausstehendem Pfad |
| `flags` (`WatchFlags`) | `Stuck` 1 (Stuck-Kette aktiv / ≥ 10 Ticks ohne Fortschritt), `Retargeted` 2 (Ziel unerreichbar ⇒ Ersatzziel), `PathPending` 4, `Group` 8 (folgt einem Gruppenpfad) |

Watch-Einträge nur für Units, die der Viewer im Detail sehen darf (Beobachter −1, eigene oder verbündete Armee);
ungültige Handles fallen weg. Reihenfolge = Reihenfolge von `ctl.watch`.

### Pfad- und Order-Zähler

| Zähler | Frame-Header | `HostStatsMsg.path` | Sim (`pathStats(w)`) |
|---|---|---|---|
| pending (FIFO) | `pathPending` | `pending` | `pending` |
| requestsIssued (Gruppen-/Einzelanfragen, Stuck- und Korridor-Repaths) | ja | ja | ja |
| repathsTriggered (Korridorregel, beim Stempeln) | ja | ja | ja |
| expansionsLastTick | ja | ja | ja |
| stuckGiveUps | ja | ja | ja |
| ordersDropped / groupsDropped / requestsFailed / footprintsRejected / unitsEvicted, livePaths/Groups/Orders | – | – | ja |

Ein Gruppenbefehl erhöht `requestsIssued` im selben Tick um genau 1 (Orders-Phase), gequeuete Gruppen erst beim
Beginn ihrer Order; Stuck-Repaths (1. und 2. Stufe) und Korridor-Repaths zählen zusätzlich.

### CheatSub.Footprint (Dev-Konsole `obstacle`)

`Op.Cheat` mit Payload `u8 3 | i32 cellX | i32 cellZ | u16 w | u16 h | i8 delta` (14 B, `encodeCheatFootprint`,
`CHEAT_FOOTPRINT_PAYLOAD_BYTES`). Zellen = WU, Rechteck `[x, x+w) × [z, z+h)`, an der Karte geklippt; gültig:
1 ≤ w, h ≤ 64, delta ±1, Rechteck schneidet die Karte (sonst verworfen und gezählt). Wirkt im selben Tick
(CommandApply); markierte Pfade repathen in Phase 3 desselben Ticks. Refcounts sättigen (doppeltes Entfernen harmlos).

### ctl.devReload und Host-Status

- `{ t: 'devReload', simBin?: ArrayBuffer }` (transferierbar; 32 B … 64 MiB, sonst verwirft `parseCtlMessage`).
  Ohne `simBin`: nur MARK (MS2-Verhalten). Mit `simBin`: `SimCore.devReload` → `decodeSimBin` → Kompatibilität
  (`blueprintReloadProblem`: gleiche IDs in gleicher Reihenfolge, neue nur angehängt) → `replaceBlueprints` (nur
  Konfiguration, Arena unverändert; Units behalten ihren Layer) → MARK devReload (tainted) → neue simId
  (`simIdFor(neue simHash, mapSimHash)`, auch im Snapshot-Kopf) → `status`.
- Ablehnung: `error` mit `RangeError: devReload rejected: sim id 0 is 'core:aaa' …` bzw. `… may only be appended`,
  Dekodierfehler als `error` mit der Meldung des Decoders; nichts wird geändert, Log bleibt untainted.
- `HostStatusMsg` neu: `simHash`, `simId`, `devReloads`, `devReloadMs` (Host-Zeit ctl → status), `navPrecomputeMs`;
  `HostReadyMsg` neu: `navStaticMs`, `navDerivedMs`; `HostStatsMsg.path` (s. o.).

### Sim-API (für Tools, Hooks, Bench)

- `pathStats(w)`, `unitOrders(w, h)` (Queue als `{type, x, z, formation}`), `queueLength`, `unitInfo` erweitert
  (`orders`, `moverState`, `moverFlags`, `path`, `wp`, `formation`, `steerX/Z`, `nudge`; `moving` = Move-Order oder
  Slot-Rückkehr), `unitClass(w, slot)`, `packOffset/offsetX/offsetZ`, `isBlockedFor(w, layer, x, z, cls)`,
  `navCellOf`, `clearanceAtFx`, `w.nav` (voller `@faf/nav`-Zugriff), `w.navClear/navTerrain/navShift`.
- `replaceBlueprints(w, table)`, `blueprintReloadProblem(cur, next)`, `CreateWorldOptions.initProbe` +
  `WorldInitStage {NavStatic, NavDerived}`.
- Konstanten in `@faf/sim` (`constants.ts`), Weltkopf-Zähler `WH_STUCK_GIVEUPS … WH_UNITS_EVICTED` (Wörter 8–13).

### Szenario-Hilfen (`@faf/headless`)

- `ScenarioCommand` neu: `{kind: 'footprint', army, x, z, w, h, delta?}`, `stop` mit `queue?`.
- `navTestRtsMap(kind, sizeWu, seed)` / `chokeMap()` (`src/maps.ts`): @faf/nav-Testkarten als RtsMap (in-memory,
  ohne Dateisystem, für Harness/Bench), `navTestRtsMap('bases', 1024, seed)` für die 1.024-WU-Benchmarks von ms3-p5.
- Invarianten `noLandOnBlockedCell`, `noLandInDeepWater`, `yOnTerrain` exportiert.
- `@faf/nav/check` (`packages/nav/bench/corridor-check.ts`): unabhängige Brute-Force-Auswertung der Korridorregel
  (`copyNavGraph`, `corridorCutBrute`, `clipFootprint`) – genutzt vom Nav-Test und vom Golden `obstacle-repath`.
- `@faf/nav` additiv: `pointAt(p, k, out)` (wahlfreier Zugriff für geteilte Pfade, `WP_LAST` = letzter Punkt),
  `remainingPoints(p, out, max, skip)`, `pathPrev(p, out)`.
- Toleranzen für E2E (ms3-p6): Offset-Abweichung je Unit gegenüber Schwerpunkt + komprimiertem Offset ≤ **1,5 WU**
  (Golden, s. Messwerte; Einzelne Ausreißer bis ≈ 3,5 WU in seltenen Seeds, s. Grenzen), Ankunft im
  Ankunftsradius 0,35 WU, Anfahren ≤ 10 Ticks (gemessen: 1 Tick).

## Parameter (SPK2 → Fx, einmalig umgerechnet, `packages/sim/src/constants.ts`)

| Parameter (SPK2) | Wert | Fx / Ang16 | Konstante |
|---|---|---|---|
| Anfahrwinkel | 70° | 12.743 | `MOVE_START_ANGLE` |
| Tempo bei 70° / Kriechtempo darüber | 0,4 / 0,1 × vmax | 1.638 / 410 | `MOVE_TURN_SLOWDOWN_MIN` / `MOVE_PIVOT_CREEP` |
| Start-Kick | 3 Ticks × 2 accel | – | `MOVE_LAUNCH_TICKS` / `MOVE_LAUNCH_BOOST` |
| Bremsen | Blueprint `brakePerTick` (Default 2 × accel) | Fx/Tick² | sim.bin |
| Separation Stärke / Reichweite / Nachbarn | 0,5 / 1,5 × (ri + rj) / 8 | 2.048 (`>> 1`) / 6.144 / – | `SEPARATION_*`, `MAX_SEPARATION_NEIGHBORS` |
| Clearance-Gradient ab radius + / Stärke | 0,5 WU / 1,5 | 2.048 / 6.144 | `CLEARANCE_MARGIN` / `CLEARANCE_STRENGTH` |
| Ankunftsradius | 0,35 WU | 1.434 | `ARRIVAL_RADIUS` |
| Contagion Slot-Abstand / Spalt / Stillstand | 4 WU / 0,3 WU / 10 Ticks | 16.384 / 1.229 / – | `CONTAGION_*` |
| Slot-Rückkehr Abweichung / Wartezeit | 1,0 WU / 10 Ticks | 4.096 / – | `RETURN_DISTANCE` / `RETURN_DELAY_TICKS` |
| Kollision Iterationen / Priorität fahrend | 2 / 4 | – | `COLLISION_ITERATIONS` / `MOVING_PRIORITY` |
| Idle-Nudge Tempo / Dauer | 0,5 × vmax / 6 Ticks | 2.048 / – | `NUDGE_SPEED` / `NUDGE_TICKS` |
| Stuck Fenster / ε / Ausweichweite | 20 Ticks / 0,15 WU / 2,5 WU | – / 614 / 10.240 | `STUCK_*`, `SIDESTEP_DISTANCE` |
| Wegpunkt-Radius / LOS-Vorausschau | 1,0 WU / alle 5 Ticks (versetzt nach Slot) | 4.096 / – | `WAYPOINT_RADIUS` / `LOOKAHEAD_TICKS` |
| Offset-Kompression R(n) = a + b·√n / Mindestspalt | 2 + 1,1·√n WU / 0,15 WU | 8.192 + 4.506·√n / 614 | `OFFSET_*` |
| Masse | Blueprint `mass` (Default 1/2/4/8 je Klasse) | u16 | sim.bin |
| Neigung (neu, nicht SPK2) | Tempo 100/90/80/70 % je Nav-Kostenstufe 0–3 | ‰ | `SLOPE_SPEED_PERMILLE` |
| PathService / Lazy Refinement | 20.000 Expansionen / 32 Segmente je Tick | – | `PATH_BUDGET_EXPANSIONS` / `REFINE_SEGMENTS_PER_TICK` |
| Queue / Pool / Gruppen | 32 je Unit / 32.768 Records / 4.096 Gruppen | – | `MAX_ORDERS_PER_UNIT` / `CAP_ORDERS` / `CAP_FORMATIONS` |
| Offsets gespeichert | 1/16 WU, i16 je Achse (±2.047 WU) | 256 | `OFFSET_QUANT_SHIFT` |

Interne Schwellen in `movement.ts`: Final-Leg-Abkürzung bei freier LOS ≤ 32 WU zum Slot, Slot „belegt“ bei
Überlappung > 0,05 WU, geteilte Slots im Umkreis 6 WU, Slot-Rückkehr höchstens 24 Fehlversuche (je 5 Ticks).

## Messwerte (lokal, Apple M5 Pro, Node 24.18; teils Fremdlast)

| Messung | Ergebnis |
|---|---|
| Nav-Precompute beim Laden (hollow-ridge, Host-Uhr) | 70–101 ms (statisch + abgeleitet; Arena 512 WU: 8,0 MB, Snapshot 7,2 MB; 1.024 WU: 18,2 / 15,0 MB) |
| `pnpm --filter @faf/sim-host bench` Szenario **ms3** (1.000 Panzer Klassen 1–3, 2 Armeen, Gruppenbefehle quer über hollow-ridge, alle 20 Ticks ein neuer, jeder 3. gequeuet; ⌀ 984 fahrend, 6.052 Pfadanfragen in 10.000 Ticks) | Sim-Tick p50 1,15 / **p95 1,57** / p99 1,83 / max 2,6 ms (Budget 8 ms); **PathService** p50 0,00 / p95 0,28 / max 1,1 ms; **Movement** p50 1,05 / p95 1,28 / max 1,7 ms; Hash-Tick p95 ≈ 0,2 ms (vor der Optimierung, s. u.: p95 2,1–2,9 ms, max 16–19 ms) |
| sim-host bench Szenario **ms2** (1.000 Würfel, NW-Seite, jetzt mit Pathing) | p95 1,45 ms (MS2-Budget 2 ms eingehalten) |
| `pnpm bench` Headless-Tick-Bench hollow-ridge (1.000 dicht gespawnte Würfel, **jeden Tick** ein Gruppenbefehl à 50) | nach der Optimierung Node p50 1,44 / p95 1,90 ms; im `pnpm bench`-Lauf davor (ohne Optimierung) p95 Node 7,2 / Chromium 6,4–6,7 / Firefox 8,6–8,8 / WebKit 4,3–4,7 ms – nur berichtet (DECISIONS 16) |
| Profiling-Befund (`node --cpu-prof`, Tick-Bench) | Kollision (Kandidatenabfrage mit dem Radius der Fabrik 2,5 WU + Tempo-Reserve), Separation und die Flutsuche für blockierte Gruppen-Slots dominierten; behoben durch mobilen Maximalradius + Drift 0,25 WU in der frisch gebauten Kollisionsabfrage (Strukturen suchen ihre Kontakte selbst) und eine begrenzte Spiralsuche (64 Ringe) für Slots ⇒ Movement p95 7,2 → 1,6 ms, Hash-Ketten unverändert |
| Allokation warm, 10.000 Ticks (nach 4.000 Warm-up-Ticks) | Sim Testebene 1.000 Würfel 261–386 KiB; **Sim hollow-ridge 1.000 Panzer mit Pfadanfragen (4.000–8.000 Anfragen) + Watch 64: 463–704 KiB**; Host-Pfad Testebene 413–423 KiB, hollow-ridge 758–811 KiB; jeweils 0 GCs in den Messblöcken |
| `ridge-group-offset` (40 Panzer Klassen 1–3, NW → SE über die Furt) | alle angekommen nach ≈ 3.100 Ticks, 1 Anfrage für die Gruppe; Offset-Abweichung p50 0,32–0,52 / p95 0,90–1,02 / max 0,92–1,11 WU über 8 von 9 Seeds (Golden-Seed 1,03) |
| `choke-3wu` (100 T1, 3-WU-Lücke) | alle durch nach 210 Ticks (128 WU) bzw. 272 Ticks (256 WU) – Kriterium ≤ 600 |
| 100 Units auf einen Punkt (Einzelbefehle) | alle ruhend nach ≈ 170 Ticks, Restüberlappung max 0,002–0,018 WU (Kriterium ≤ 0,1) |
| Anfahren | jede Unit ändert ihre Position im 1. Tick nach dem Befehl (200 Units, auch bei ausstehendem Pfad) |
| devReload ctl → status (Host, synchron) | 0,36 ms (Test) |
| `pnpm test:xengine` | 160 Ketten bitgleich, ≈ 2 min |

## Tests (Vitest)

| Datei | Inhalt |
|---|---|
| `packages/sim/test/orders.test.ts` (neu) | replace/append/Reihenfolge der Queue, Stop leert/Haltepunkt, Cap je Unit + Zähler, **Pool-Überlauf** (1.048 Units × 32), ein Gruppen-Record je Befehl (Referenzen, gequeuete Gruppe fragt später an) |
| `packages/sim/test/pathing.test.ts` (neu) | Gruppenbefehl ⇒ requestsIssued +1 (Klasse 3), Einzel ⇒ +1, **Kurzweg ⇒ Direct, 1 Expansion**; **alle 200 Units fahren < 10 Ticks** an; unerreichbares Ziel ⇒ Ersatzziel (Retargeted); **Footprint repath nur den geschnittenen Pfad**, Umfahren, Entfernen repath nie; Eviction + ungültige Stempel; Hindernis ohne Nav (Struktur) wird umsteuert; **Stuck-Kette 1–3** (Einheit von Strukturen eingeschlossen); **100 Units auf einen Punkt: Überlappung ≤ 0,1 WU**; Offset-Erhalt ≤ 1,5 WU; **Restore mitten in Pfaden/Queues ⇒ gleicher End-Voll-Hash** |
| `packages/sim/test/frame.test.ts` | + Watch-Sektion (Ziele, Route, Flags, Sichtbarkeit), Pfadstatistik im Header, Idle-Flag |
| `packages/sim/test/alloc.test.ts` | + hollow-ridge 1.000 Panzer mit Pfadanfragen, Queue, Watch |
| `packages/sim/test/{commands,water,terrain,world,determinism}.test.ts` | an MS3 angepasst (Queue statt Ersetzen, Retarget an Kartenrand, Furt statt Ufer-Stop, Layout-Hash `0xc37d216e`, Region-Liste) |
| `packages/protocol/test/*` | Footprint-Roundtrip + Reader + feste Bytes, Frame v2 (Watch/Statistik/v1-Lesen/Grenzen), devReload-Validierung |
| `packages/nav/test/pointat.test.ts` (neu), `repath.test.ts` | pointAt == sequentielle Wegpunkte, WP_LAST/NEED_REFINE, remainingPoints mit skip; Brute Force aus `@faf/nav/check` |
| `packages/sim-host/test/ms3.test.ts` (neu) | ctl.watch → Watch-Sektion, Pfadzähler in Frame/stats; **devReload: kompatibel (tainted, neue simId/simHash, schneller danach, neue Blueprints spawnbar, Snapshot-Kopf), inkompatibel (Einfügen, Entfernen, Müll) ⇒ error, nichts geändert; Zeit ctl → status** |
| `packages/sim-host/test/{host,map,alloc,l4-replay}.test.ts` | Phasenliste inkl. PathService, 1.024-WU-Karte mit passierbarem Gelände, Timeouts |
| `tools/headless/test/goldens.test.ts` | 8 Goldens (Asserts + Kette), Trail-Länge = Ticks/10 |

Selbsttest (2026-09-29): `pnpm typecheck` grün, `pnpm lint` grün (eslint inkl. `sim/determinism`, dep-cruiser 391
Module), `pnpm vitest run packages/sim packages/sim-host packages/protocol packages/nav tools/headless` grün,
`pnpm --filter @faf/headless goldens` grün (8/8), `pnpm test:xengine` grün (160/160, nach der letzten Änderung erneut),
`pnpm bench` Exit 0 (sim, sim-host ms2/ms3, nav/SPK3, Headless-Bench Node + 3 Browser; ms-Grenzen nur berichtet),
`pnpm --filter @faf/sim-host bench` nach der Optimierung erneut (Werte oben). Vitest: 41 Dateien, 247 Tests grün.

## Abweichungen vom Plan (mit Begründung)

1. **GroupMove (23) bleibt reserviert:** Jeder `Move` mit ≥ 2 eigenen Units ist ein Gruppenbefehl; der Client braucht
   keinen zweiten Opcode. Der reservierte Opcode wird verworfen und quittiert.
2. **Einzel-Move = Gruppe aus einer Unit:** ein Codepfad (Formations-Record mit n = 1, Offset 0); Zähler und Semantik
   („eine Einzelanfrage“) bleiben gleich.
3. **Anfrage gequeueter Gruppen beim Beginn der Order** (erste Unit, die sie beginnt), Start = vorheriger Slot der
   Lead-Unit (Schwerpunkt-nächste). Spät beginnende Mitglieder steigen am Cursor der Gruppe ein.
4. **Geteilter Gruppenpfad:** Jede Unit führt einen absoluten Wegpunktindex; der Nav-Cursor (`nav.advance`) folgt dem
   langsamsten Mitglied, das dem Pfad noch folgt. Dafür `pointAt`/`WP_LAST`/`pathPrev`/`remainingPoints(skip)` additiv
   in `@faf/nav`. Korridor-Repath des Gruppenpfads ab dessen vorherigem Wegpunkt, Mitglieder starten mit der neuen
   Generation neu (LOS-Vorausschau überspringt Überholtes).
5. **Offset-Mindestspalt nur für Paare, die nicht ohnehin Nachbarn sind** (Abstand ≥ 2 · (ri + rj + 0,15 WU)): In
   dichten oder zufällig gespawnten Gruppen berührt sich immer irgendein Paar, die SPK2-Regel hätte jede Kompression
   verhindert (Golden `cubes-1000-move`: 47/175 statt 168/175 Units im Zielkreis). Mit Rasteraufstellung (SPK2-Fall)
   greift die Regel unverändert.
6. **Offsets auf 1/16 WU quantisiert** (i16 je Achse in `Units.groupOffset` und im Order-Record); Schwerpunkt und
   Lead-Auswahl in ganzzahligen 1/16- bzw. 1/4-WU-Schritten (kalter Befehlspfad ohne geboxte Zahlen).
7. **Contagion:** Wie SPK2 wird der Stopppunkt zum Slot, wenn der Slot dauerhaft belegt ist (Slot-Konflikt) oder die
   Order ein Einzelbefehl mit gemeinsamem Ziel ist (Klumpen). Ein Gruppenmitglied mit eigenem Offset-Slot, das nur vom
   Gedränge aufgehalten wird, behält seinen Slot und kehrt später zurück (Offset-Golden sonst bis 4 WU daneben).
8. **Slot-Rückkehr robuster als im Prototyp:** geteilte Slots (gleiches Ziel mehrerer Units) werden aufgegeben statt
   angefahren (sonst Dauergerangel im Klumpen); eine selbst verdrängte Unit (> 2 × Ankunftsradius von ihrem Slot)
   blockiert eine Rückkehr nicht; bis zu 24 Versuche statt Aufgabe nach dem ersten.
9. **Stuck-Kette endet nur bei echtem Fortschritt** (verbrauchter Wegpunkt oder neuer Bestwert der Slot-Distanz um
   1 WU), nicht bei jeder Annäherung an den aktuellen Steuerpunkt (SPK2): sonst Endlosschleife Repath ↔ Ausweichen
   ohne Aufgabe. Drehen auf der Stelle (Kursfehler > 70°) zählt nicht als stuck.
10. **Units ohne Tempo (Strukturen per Cheat-Spawn) sind in Kollisionen unverschiebbar** und bekommen keinen
    Idle-Nudge; Gebäude werden ab MS4 Footprints.
11. **Neigung bremst über die Nav-Kostenstufe** (Tempo 100/90/80/70 %), SPK2 hatte kein Gelände.
12. **Hindernisgradient aus dem Clearance-Feld** (Chebyshev, Zellraster) mit der SPK2-Gewichtung über den Abstand zur
    blockierten Seite; kein eigenes Abstandsfeld in der Arena.
13. **Kollision:** Paare einmal je Durchlauf (vom kleineren Slot bzw. vom wachen Partner; Strukturen immer selbst),
    sofort über `placeUnit` angewandt (wie SPK2), höchstens 8 Überlappungen je Unit und Durchlauf; das Fein-Grid wird
    dafür in Phase 7 einmal zusätzlich aufgebaut (abgeleiteter Zustand). `World.maxRadius` = größter Radius eines
    **mobilen** Blueprints. Blockierte Gruppen-Slots: begrenzte Spiralsuche (64 Ringe) in der Komponente der Unit,
    sonst der Anker (statt unbegrenzter Flut-/Spiralsuche).
14. **Frame v2:** Pfadstatistik als feste Header-Felder statt in der Debug-Sektion (immer vorhanden, 20 B), zusätzlich
    in `stats`. u32-Headerfelder werden per `setInt32(v | 0)` geschrieben (gleiche Bytes, keine geboxten Doubles).
15. **Allokationstests mit 4.000 Warm-up-Ticks** (statt 1.000): Die kalten Befehlspfade (Gruppen-Offsets,
    Order-Records, Anfragen) laufen nur alle 100 Ticks und bleiben sonst im Interpreter, der Zahlen boxt; gemessen wird
    die Sim, nicht das V8-Tiering (mit 1.000 Ticks Warm-up ≈ 1,1–1,9 MiB, mit 8.000 ≈ 0,2 MiB).
16. **Test- und Bench-Karten angepasst:** `channelMap` mit flachen Ufern (vorher Klippen = unpassierbar), `slopeMap` und
    die 1.024-WU-Testkarten unter der Neigungsgrenze, Spawn-Kreise ohne Klippenzellen (`tickbench`: (100, 100) r 20).
17. **Headless-Bench:** Tick-Budget jetzt MS3 (1.000 fahrende Units mit Pathing ≤ 8 ms), ms-Grenzen nur mit
    `FAF_PERF_GATE=1` gegated (DECISIONS 16); Invarianten (Hash-Gleichheit, Last) weiter immer.
18. **Legacy-Goldens mit MS3-Asserts:** `ridge-water-block` prüft jetzt, dass Gruppe A über eine Furt geführt wird und
    ankommt (statt am Ufer stehenzubleiben); `ridge-1000-move` toleriert abgelehnte Klippen-Spawnpunkte (≤ 30) und prüft
    den Aufstieg der 300er-Gruppe bei Tick 1.490 statt 1.090 (Rampen-Gedränge).

## Bekannte Grenzen

- **Offset-Ausreißer:** In seltenen Seeds bleibt eine einzelne Unit bis ≈ 3,5 WU neben ihrem Slot (Rückkehr nach
  24 Fehlversuchen aufgegeben, typisch T3 im Gedränge der letzten Ankömmlinge); p95 bleibt < 1,1 WU. Das Golden nutzt
  einen festen Seed (max 1,03 WU).
- **Units in sehr engen Röhren** (Breite ≈ Klassenbreite) können sich überlappend aneinander vorbeischieben, weil die
  Kollisionsauflösung quer zur Röhre blockiert ist (weiche, positionsbasierte Kollision ohne RVO).
- **Kollision/Separation** dominieren die Tick-Zeit in dichten Klumpen (≈ 1 ms je 1.000 Units); Strukturen per
  Cheat-Spawn (Radius > mobiler Maximalradius) bleiben wach und suchen ihre Kontakte selbst.
- **Stuck-Repaths im Gedränge** erzeugen viele (billige) Anfragen (Bench ms3: ≈ 6.000 Anfragen in 10.000 Ticks bei
  1.000 Units, meist Direct/kurz).
- Nur Layer Land pfadet; Luft/Hover/Marine folgen später. Strukturen per Cheat-Spawn haben noch einen Mover.
- Die ms-Werte schwanken unter Fremdlast deutlich (parallele Workflows); nur maschinenunabhängige Kriterien gaten.
