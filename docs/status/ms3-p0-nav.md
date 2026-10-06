# ms3-p0-nav – Root-Tooling MS3, Paket `@faf/nav` (M5, M6), SPK3 auf Nav-Ebene

Stand 2026-09-29 (MS3, Welle 0). Feature-IDs: **M5** (Passierbarkeit, Clearance, Komponenten, lokale
Nachführung), **M6** (Fein-A\*, HPA\*, PathService, Korridor-Repath), Nav-Anteil von **SPK3**. Messwerte lokal auf
Apple M5 Pro (Node 24.18), **unter Fremdlast** (parallel laufende Workflows, Load-Average 7–15) – kein
Referenz-Laptop (DECISIONS 5). Dieses Fragment ist der **API-Vertrag für ms3-p2 (Sim-Integration) und ms3-p5
(Headless-Benchmarks)**.

Geändert wurden nur die owns: Root-Konfiguration, `tools/eslint-plugin-sim/test/config.test.ts`,
`packages/nav/**` (neu), `packages/sim/{package,tsconfig}.json`, `tools/headless/{package,tsconfig}.json`, dieses
Fragment. `packages/formats`, `content/maps` blieben unberührt (nur lesend).

## Umgesetzt

| Bereich | Inhalt | Ort |
|---|---|---|
| Paket `@faf/nav` | `exports` `.` → `src/index.ts`, `./testmap` → `bench/testmap.ts`; deps fixed/heap/rules; devDeps formats (hollow-ridge lesen), tsx, @types/node; `bench` = SPK3 | `packages/nav/package.json`, `tsconfig.json` (lib ES2022, types [], `rootDir .`, include `src` + `bench/testmap.ts`) |
| Root-Tooling | `tsconfig.json` (+ nav), `tsconfig.tests.json` (nav-Tests/Bench über die vorhandenen Globs), Skripte `bench:nav`, `bench:spk2`, `bench:spk3`, `bench:ms3`, `ci:local` erweitert; `.gitignore` (+ `packages/nav/bench/results/`, `tools/headless/results/`, `tools/headless/spk2/out/`); `pnpm install` einmal | Root |
| Lint | `sim/determinism` greift für `packages/nav/src/**` **und** `packages/nav/bench/testmap.ts` (Generator speist Goldens); Konfigurationstest deckt nav ab (src, Unterordner, testmap = Regel an; Tests/Bench = aus); dep-cruiser `nav-deps` (nur fixed/heap/rules) per Negativprobe geprüft | `eslint.config.js`, `tools/eslint-plugin-sim/test/config.test.ts` |
| Abhängigkeiten | `@faf/nav` in `packages/sim` (+ tsconfig-Referenz) und `tools/headless` (+ Referenz, Skripte `spk2`/`spk3`/`ms3`); sim-host braucht nav nicht | package.json/tsconfig |
| Regionen | `defineNavRegions(sizeWu)` / `addNavRegions(builder, defs)`: 13 Regionen (statisch, Regel, abgeleitet), alles Integer-Typed-Arrays in der Arena | `src/regions.ts`, `src/state.ts` |
| M5 statisch | Land-Passierbarkeit + Kostenstufe je 1-WU-Zelle aus Heightfield + Wasser | `src/static.ts` |
| M5 abgeleitet | Clearance (Chebyshev, Kappe 15), Komponenten je Klasse (kanonische Labels), lokale Nachführung bei Footprints bitgleich zur Vollberechnung | `src/clearance.ts`, `src/components.ts` |
| M6 Graph | 32×32-Sektoren, Portale je Kante/Klasse, Intra-Kanten, Sektor-Info (offen + einheitliche Kostenstufe) | `src/graph.ts` |
| M6 Suche | Fein-A\*/Dijkstra (begrenzbar, Heap auf Int32Array, Expansionszähler), Supercover-LOS, String-Pulling, HPA\* mit Lazy-Legs, Spiral-/Flood-Suche | `src/search.ts`, `src/los.ts`, `src/hpa.ts`, `src/spiral.ts` |
| PathService | Anfragen, FIFO, Budget, Zustände, Lazy Refinement, Korridor-Repath, Zähler | `src/nav.ts` |
| Standalone | `createStandaloneNav(map)` = eigene Arena mit denselben Regionen (Tests/Bench) | `src/standalone.ts` |
| Testkarten | `generateNavTestMap({ sizeWu, seed, kind })` 'bases' / 'choke' / 'open' | `bench/testmap.ts` (`@faf/nav/testmap`) |
| SPK3 | `pnpm bench:nav` (`-- --quick`): Precompute, 200 Anfragen, Basisbau-Repaths, Budget-Sweep; JSON nach `packages/nav/bench/results/` | `bench/spk3.ts` |

## API-Vertrag

```ts
import {
  defineNavRegions, addNavRegions, Nav, navClassOf, createStandaloneNav, navMemoryBytes,
  NAV_BUDGET_EXPANSIONS_PER_TICK, NAV_CLASSES, NAV_CAP_PATHS, NAV_MAX_FOOTPRINT, NAV_LAND_MAX_SLOPE_RAW,
  PATH_NONE, PATH_PENDING, PATH_READY, PATH_DIRECT, PATH_FAILED, PATH_CANCELLED,
  PATH_F_RETARGETED, PATH_F_REPATH, PATH_F_FALLBACK, PATH_F_START_MOVED,
  WP_OK, WP_NEED_REFINE, WP_END, WP_PENDING, WP_NONE,
  CTR_FAILED, CTR_RETARGETED, CTR_DIRECT, CTR_FALLBACK, CTR_STAMPS, CTR_REFINES, CTR_BLOCKS_EXHAUSTED,
  type NavMapInput, type NavRegions, type PathDebug,
} from '@faf/nav';
import { generateNavTestMap, type NavTestMap, type Rect } from '@faf/nav/testmap';
```

### Aufrufreihenfolge (Sim)

```ts
// createWorld
const navDefs = defineNavRegions(sizeWu);           // Zweierpotenz 64..4096
const navRegions = addNavRegions(builder, navDefs);  // oder einzeln b.addRegion(navDefs.terrain) … (Reihenfolge frei)
const arena = builder.build();
const nav = new Nav(navRegions);                    // bindet Views, vergrößert den Modul-Scratch (Setup)
nav.precomputeStatic({ sizeWu, dim, heights, heightScaleRaw, waterLevelRaw }); // statische Region, einmal je Karte
nav.rebuildDerived();                               // Clearance, Komponenten, Graph, Korridor-Index
// je Tick
nav.request(...) / nav.repath(...) / nav.cancel(p) / nav.release(p);   // Phase 2 Orders
nav.serviceTick(NAV_BUDGET_EXPANSIONS_PER_TICK);                      // Phase 3 PathService
nav.waypoint(p, out) / nav.advance(p) / nav.refineNext(p, budget);    // Phase 7 Movement
nav.stampFootprint(x0, z0, w, h, +1 | -1);                            // Cheat (MS3), Gebäude (ab MS4)
```

Nach `arena.restore(snapshot)` ist **nichts** neu zu berechnen: alle abgeleiteten Regionen liegen im dynamischen
Bereich und damit im Snapshot. `NavMapInput` = `rules.Heightfield` + `waterLevelRaw: number | null` (die Views der
Sim-Karte, `world.terrain` + `world.waterLevel`, passen direkt).

### Regionen (Namen `nav.*`, Registrierreihenfolge von `addNavRegions`)

| Region | Art | Inhalt |
|---|---|---|
| `nav.terrain` | **statisch** (nie gehasht, Identität über mapSimHash) | u8 je Zelle: 0 = blockiert, sonst 1 + Kostenstufe (0..3) |
| `nav.foot` | Regel | u8 Footprint-Refcount je Zelle (sättigt bei 0/255) |
| `nav.paths` | Regel (Table, CAP 4.096) | je Pfad: `state, cls, flags, entity, issueTick, sx/sz` (Start Fx), `tx/tz` (angefragtes Ziel Fx), `gx/gz` (wirksames Ziel Fx), `startCell/goalCell` (wirksam), `absHead/absTail/absPos/absLeft` (Kette der unverfeinerten Knotenzellen), `wpHead/wpTail/wpPos/wpLeft` (Kette der verfeinerten Wegpunkte), `refCell` (Beginn der nächsten Verfeinerung), `px/pz` (vorheriger Wegpunkt), `cost`, `legCost` |
| `nav.blocks` | Regel (Slab, 12.288 × 64 B) | PathBlocks: `[next, count, 14 Nutzwörter]` – verfeinerte Fx-Wegpunkte (7 Paare/Block) bzw. abstrakte Knotenzellen (14/Block); verbrauchte Blöcke werden sofort freigegeben (FIFO-Freiliste) |
| `nav.fifo` | Regel | Anfrage-Ring (Pfad-IDs), Kopf/Anzahl in `nav.ctr` |
| `nav.ctr` | Regel | 16 × i32: FIFO-Kopf/-Anzahl, `requestsIssued`, `requestsDone`, `repathsTriggered`, `expansionsLastTick`, `expansionsTotal` (lo/hi), failed, retargeted, direct, fallback, stamps, refines, blocksExhausted |
| `nav.clear` | abgeleitet | u8 Clearance je Zelle |
| `nav.comp` | abgeleitet | u16 Komponenten-Label je Zelle und Klasse (Klasse c bei Offset (c−1)·n) |
| `nav.compmeta` | abgeleitet | je Klasse 16.384 × i32: [0] = Anzahl Komponenten, [Label] = kleinste Zelle |
| `nav.secinfo` | abgeleitet | je (Sektor, Klasse): einheitliche Kostenstufe, wenn der Sektor für die Klasse voll passierbar ist, sonst −1 |
| `nav.nodes` | abgeleitet | je (Sektor, Klasse) 16 Knoten-Slots (Zelle oder −1), Slot = Kante·4 + k (N 0, O 1, S 2, W 3) |
| `nav.edges` | abgeleitet | je (Sektor, Klasse) 120 × u16 Intra-Kosten (oberes Dreieck, 0xFFFF = keine Kante) |
| `nav.back` | abgeleitet | Rückindex Sektor → Pfade: 128 × u32-Bitset je Sektor |

Regel-Hash: `nav.foot`, `nav.paths`, `nav.blocks`, `nav.fifo`, `nav.ctr`. Voll-Hash/Snapshot zusätzlich alle
abgeleiteten. Getestet: Flip in `nav.clear` ändert nur den Voll-Hash, Flip in `nav.terrain` keinen, ein Footprint den
Regel-Hash.

### Nav – Methoden

| Methode | Vertrag |
|---|---|
| `precomputeStatic(map)` / `rebuildDerived()` | s. o.; `rebuildDerived` baut auch den Korridor-Index aus den lebenden Pfaden |
| `isPassable(cls, x, z)`, `isPassableFx(cls, xRaw, zRaw)`, `clearanceAt`, `componentAt(cls, x, z)`, `terrainAt`, `footprintAt`, `cellOfFx`, `lineOfSight(cls, a, b)` | Abfragen (Zellen = WU, Zellindex `z·size + x`) |
| `nearestPassable(cls, x, z)` | nächste für `cls` passierbare Zelle (Spiralsuche) oder −1 – für Units auf frisch blockierten Zellen |
| `nearestReachable(cls, fx, fz, tx, tz)` | nächste Zelle der Komponente von (fx, fz) zu (tx, tz) oder −1 – für Gruppen-Slots |
| `stampFootprint(x0, z0, w, h, ±1)` | Rechteck in Zellen, an der Karte geklippt, w, h ≤ `NAV_MAX_FOOTPRINT` = 64 (sonst RangeError); Refcounts sättigen; Clearance/Komponenten/Graph lokal (bitgleich zu `rebuildDerived`); bei +1 Korridorregel ⇒ Rückgabe = Anzahl neu markierter Pfade |
| `request(entityIdx, issueTick, cls, sx, sz, tx, tz)` | Fx-Positionen; `cls` wird mit `navClassOf` normiert; Rückgabe Pfad-ID (= Slot 0..4.095) oder **−1, wenn die Tabelle voll ist**; Zustand `PATH_PENDING`; `requestsIssued++` |
| `serviceTick(budget)` | arbeitet den FIFO ab, solange `used < budget`; eine begonnene Anfrage läuft immer zu Ende (kein Suchzustand über Ticks); Rückgabe = verbrauchte Expansionen (= `expansionsLastTick`) |
| `pathState(p)`, `pathFlags(p)`, `pathClass(p)`, `pathGoal(p, out)`, `pathStartCell(p)`, `pathGoalCell(p)`, `pathCost(p)` | Zustand/Flags/Ziel (Retarget ⇒ Zellmitte)/Kosten |
| `waypoint(p, out)` | schreibt den aktuellen Wegpunkt (Fx) nach `out[0..1]`; Rückgabe `WP_OK` (1), `WP_NEED_REFINE` (0: verfeinerte Punkte aufgebraucht ⇒ `refineNext`), `WP_END` (−1), `WP_PENDING` (−2), `WP_NONE` (−3: Failed/Cancelled/frei) |
| `advance(p)` | verbraucht den aktuellen Wegpunkt (Einheit hat ihn erreicht); aktualisiert `px/pz` und den Korridor-Index |
| `refinedLeft(p)` | Zahl der noch verfeinerten Wegpunkte (proaktiv verfeinern, wenn ≤ 1) |
| `refineNext(p, budget)` | verfeinert das nächste Segment (nur `PATH_READY`, nur wenn `budget > 0`); das Segment läuft immer zu Ende (Suche auf höchstens 2 Sektoren = 2.048 Zellen begrenzt); Rückgabe = Expansionen (0 = nichts zu tun). Schlägt die Suche fehl, wird `PATH_F_REPATH` gesetzt (ohne Zähler) |
| `needsRepath(p)` / `repath(p, sx, sz, issueTick)` | Flag des Korridor-Repaths; `repath` stellt eine neue Anfrage (gleiches angefragtes Ziel, neuer Start, **`issueTick` als 4. Parameter**), löscht das Flag, `requestsIssued++` |
| `cancel(p)` / `release(p)` | `cancel`: aus dem FIFO nehmen, Ketten/Index frei, Zustand `PATH_CANCELLED`, Slot bleibt; `release`: zusätzlich Slot frei (FIFO-Wiederverwendung) |
| `remainingPoints(p, out, max)` | verbleibende Route als Fx-Paare (verfeinerte Wegpunkte, dann Mitten der unverfeinerten Knoten, zuletzt das Ziel) – für Watch-Sektion/Overlays, allokationsfrei |
| `pathDebug(p)` | Debug-Objekt (allokiert; nur Tests/Tools) |
| Zähler | `requestsIssued`, `requestsDone`, `repathsTriggered`, `expansionsLastTick`, `expansionsTotal` (SafeInt aus lo/hi), `pendingCount`, `counter(CTR_*)` |

Pfadzustände: `PATH_PENDING` → `PATH_READY` (HPA\*-Route, erstes Segment verfeinert) | `PATH_DIRECT` (Kurzweg, ein
Wegpunkt = Ziel) | `PATH_FAILED` (keine passierbare Startzelle erreichbar, Blöcke erschöpft). Flags:
`PATH_F_RETARGETED` (Ziel unerreichbar/blockiert ⇒ nächste Zelle der Startkomponente), `PATH_F_START_MOVED` (Start
nicht passierbar ⇒ nächste passierbare Zelle, ihre Mitte ist der erste Wegpunkt), `PATH_F_FALLBACK` (HPA\* ohne Route
⇒ Fein-A\* über die ganze Karte, voll verfeinert), `PATH_F_REPATH` (Korridor geschnitten).

### Konstanten

| Konstante | Wert | Bedeutung |
|---|---|---|
| `NAV_BUDGET_EXPANSIONS_PER_TICK` | **20.000** | Budget je Tick (SPK3, s. u.) |
| `NAV_CLASSES` | 3 | Größenklassen; **Klassenregel** `navClassOf(sizeClass)`: 0 → 1, 1..3 unverändert, > 3 → 3 |
| `NAV_LAND_MAX_SLOPE_RAW` | 3.072 (0,75 WU/WU ≈ 37°) | steilste befahrbare Zelle |
| `NAV_MAX_CLEARANCE` | 15 | Clearance-Kappe |
| `NAV_SECTOR_SIZE` | 32 | Sektor = Chunk |
| `NAV_CAP_PATHS` / `NAV_CAP_BLOCKS` | 4.096 / 12.288 | Pfad-Slots / PathBlocks |
| `NAV_MAX_FOOTPRINT` | 64 | größte Footprint-Kante |
| `NAV_PORTALS_PER_EDGE` | 4 | Portale je Sektorkante und Klasse |
| Kosten | orthogonal 10 + 2·(ka + kb), diagonal 14 + 3·(ka + kb) | k = Kostenstufe der beiden Zellen |

### Regeln der Algorithmen

- **Passierbarkeit (M5):** Zelle (x, z) = [x, x+1) × [z, z+1) mit den Eck-Samples (x, z)…(x+1, z+1). Blockiert, wenn
  Kartenrand (x oder z ∈ {0, size−1}), Tiefwasser in der Zellmitte (`rules.isDeepWaterForLand` bei (x+½, z+½)) oder
  Neigung (max − min der 4 Eckhöhen, Fx raw je WU) > `NAV_LAND_MAX_SLOPE_RAW`. Kostenstufe: Neigung ≤ ½·max → 0,
  ≤ ⅔·max → 1, ≤ ⅚·max → 2, sonst 3 (sanftes Gelände kostet nichts extra, steile Rampen bis +60 %).
- **Clearance:** Chebyshev-Abstand zur nächsten blockierten Zelle (Terrain oder Footprint), gekappt auf 15; zweiphasige
  Chamfer-Transformation (exakt für die Schachbrett-Metrik). Klasse s ist passierbar ⇔ Clearance ≥ s.
- **Bewegung:** 8 Nachbarn, **kein Eckenschneiden** (diagonal nur, wenn beide orthogonalen Nachbarn für die Klasse
  passierbar sind). Identisch in Fein-A\*, Komponenten, Sektor-Komponenten.
- **Komponenten:** je Klasse; Label k = Komponente mit der k-kleinsten kleinsten Zelle (kanonisch, unabhängig von der
  Historie). Mehr als 16.383 Komponenten ⇒ Überlauf-Label 0xFFFF („unbekannt“: nie als verbunden gewertet, Suche ohne
  Komponenten-Vorprüfung); eine Klasse im Überlauf wird bei jedem Stempel voll neu berechnet.
- **Portale:** je Sektorkante mit Nachbar und Klasse die maximalen Läufe, in denen beide Seiten passierbar sind; Portal
  in Laufmitte ((len−1)/2), Läufe > 16 Zellen bekommen zwei (bei len/4 und len−1−len/4). Mehr als 4 Kandidaten ⇒ die
  4 längsten Läufe (Gleichstand: kleinere Position), sortiert nach Position. Knoten auf beiden Seiten; Partner = Slot
  gegenüberliegende Kante·4 + k.
- **Intra-Kanten:** optimale Kosten zwischen allen Knotenpaaren eines (Sektor, Klasse) innerhalb des Sektors: voll
  passierbarer Sektor mit einer Kostenstufe ⇒ gewichtete Oktil-Distanz (exakt); gleiche passierbare Zellen und Knoten
  wie Klasse−1 ⇒ Kopie; sonst sektorlokale Komponenten + A\* je Paar in derselben lokalen Komponente.
- **HPA\*:** abstrakter A\* über Knoten-IDs (Sektor·16 + Slot) mit Heuristik Oktil-Distanz, Tie-Break f → h → ID.
  Start/Ziel werden temporär eingefügt: Start-Knoten des Startsektors (nur gleiche globale Komponente) mit der
  Oktil-Untergrenze als Schlüssel, die exakte Leg-Kosten (A\* im Sektor bzw. exakte Oktil-Distanz im offenen Sektor)
  werden erst beim Pop berechnet; Ziel-Legs beim Expandieren eines Zielsektor-Knotens; Start und Ziel im selben Sektor ⇒
  zusätzlich die direkte Kante. Untergrenzen halten die Suche exakt (bezogen auf den abstrakten Graphen).
- **Kurzweg (Direct):** Ziel im selben oder einem der 8 Nachbarsektoren **und** Supercover-LOS mit Clearance ≥ cls frei
  (oder Start = Ziel) ⇒ `PATH_DIRECT`, keine Suche (1 Expansion gezählt).
- **Lazy Refinement:** gespeichert werden alle Knotenzellen der Route + Zielzelle. Ein Segment reicht von `refCell` bis
  zur ersten Knotenzelle in einem anderen Sektor (bzw. bis zum Ziel); Fein-A\* begrenzt auf das Sektorpaar, dann
  String-Pulling (gierig: weitester Punkt mit Clearance-LOS; alle Supercover-Zellen jeder Strecke haben Clearance ≥ cls).
  `serviceTick` verfeinert das erste Segment sofort, weitere Segmente `refineNext`. Letzter Wegpunkt = exaktes Ziel (Fx).
- **Unerreichbar/blockiert:** Startzelle nicht passierbar ⇒ nächste passierbare Zelle (Spiralsuche). Zielzelle
  blockiert oder in anderer Komponente ⇒ nächste Zelle der Startkomponente: kleinste quadratische Distanz, Gleichstand
  in Spiralreihenfolge (Ringe; oben W→O, Osten N→S, unten O→W, Westen S→N). Komponenten ≤ 16.384 Zellen werden dafür
  geflutet (gleiches Ergebnis wie die Spirale, getestet), größere per Spirale um das Ziel. Geprüfte Zellen / 8 zählen
  als Expansionen.
- **FIFO:** sortiert nach (issueTick, entityIdx), bei Gleichstand Einfügereihenfolge (stabil).
- **Expansionen:** geschlossene Zellen der Fein-Suchen + expandierte abstrakte Knoten + Spiral-/Flood-Zellen / 8.

### Korridorregel (Repath, PLAN §3.8)

Jeder Pfad trägt im Rückindex `nav.back` die Sektoren seines verbleibenden Korridors: Bounding-Boxen der
verbleibenden verfeinerten Strecken (ab dem vorherigen Wegpunkt `px/pz`) sowie die Sektoren von `refCell` und aller
unverfeinerten Knotenzellen. `stampFootprint(…, +1)` prüft genau die Pfade mit Bit in einem Sektor, der das
Footprint-Rechteck erweitert um 3 schneidet oder dessen Graph neu gebaut wurde. Ein Pfad (Zustand Ready/Direct, noch
nicht markiert) wird markiert (`PATH_F_REPATH`, `repathsTriggered++`), wenn:

1. **verfeinerter Teil:** eine Supercover-Zelle der Polylinie vorheriger Wegpunkt → Wegpunkte (Zellen der Fx-Punkte)
   im Footprint erweitert um `cls` liegt (Chebyshev-Abstand ≤ cls zum Rechteck), oder
2. **unverfeinerter Teil**, für aufeinanderfolgende Zellen a → b der Kette `refCell, Knoten…, Ziel`:
   - **gleicher Sektor (Intra-Kante):** der Graph des Sektors wurde durch diesen Stempel neu gebaut und a oder b ist
     danach kein Knoten der Klasse mehr, oder die Intra-Kosten a → b fehlen oder sind **höher** als vorher;
   - **Nachbarsektoren (Portal):** einer der beiden Sektoren wurde neu gebaut und a/b sind danach keine
     Partnerknoten mehr (Slot-Paar Kante·4 + k / Gegenkante·4 + k);
   - **letzter Schritt zum Ziel (Ziel-Leg):** das Footprint-Rechteck erweitert um `cls` berührt den Zielsektor und die
     beste Route a → Ziel innerhalb des Zielsektors fehlt oder ist teurer als die gespeicherten `legCost`.

`stampFootprint(…, −1)` markiert nie (Entfernen macht Korridore nur billiger; verschobene Portale bleiben begehbar,
weil die Verfeinerung Zell-zu-Zell sucht). Der Test `repath.test.ts` wertet diese Regel unabhängig (geometrische
Supercover, eigener Dijkstra, Vergleich alter/neuer Graph-Regionen) für 200 Pfade und 20 Footprints aus: markierte
Menge und Zähler stimmen exakt.

### Testkarten (`@faf/nav/testmap`)

`generateNavTestMap({ sizeWu: 64..1024 (Zweierpotenz), seed, kind: 'bases' | 'choke' | 'open' })` →
`{ name, sizeWu, dim, heights (Uint16Array dim²), heightScaleRaw: 32, waterLevelRaw (Fx raw | null), starts: {army, x, z}[] (Fx raw wie formats.MapStart), baseFootprints: Rect[] ({x, z, w, h} in WU), choke?: {x, z, gapWu} }`.
Integer-only (rng32, isqrt, sinA), deterministisch, unter `sim/determinism`. Direkt `rules.Heightfield`- und
`NavMapInput`-kompatibel; RtsMap per `createRtsMap({ name, sizeWu, heights, heightScaleRaw, waterLevelRaw, starts })`
(getestet).

- **'bases'**: Land 24 WU + Rauschen; Plateaus (+6 WU, Klippen 3 WU) mit zwei Rampen zur Kartenmitte an jedem Start
  (256 WU: 2 Starts, 512: 4, 1.024: 8), Fluss bei z ≈ size/2 (mäandernd, tief 2 WU) mit Furten bei x = size/4, 3·size/4
  (1.024: + Mitte), Grat bei x = size/2 + size/16 bis ins Tiefwasser mit Lücken 3/8 WU (Nord) und 6/3 WU (Süd),
  size/64 Tafelberge; Basen als Footprint-Listen (10-WU-Raster um jeden Start mit freiem Kommandanten-Platz und freien
  Rampengassen: Fabrik 8×8, Kraftwerk-Cluster 4 × 2×2, Extraktor 2×2, Verteidigung 3×3). Nach dem Stempeln sind alle
  Starts für alle Klassen verbunden (Test).
- **'choke'**: flach, eine Klippenwand über die ganze Karte (Zellreihen size/2−1 und size/2, keine begehbare Krone)
  mit genau einer 3-WU-Lücke (Klasse 1–2 passiert, Klasse 3 nicht; Test); Starts nördlich/südlich der Wand.
- **'open'**: sanftes Gelände (±5 WU Rauschen), kein Wasser, eine Komponente je Klasse.

## Speicher

`navMemoryBytes(sizeWu)` (Nutzbytes; die Arena richtet jede Spalte zusätzlich auf 8 B aus):

| Region | 512 WU | 1.024 WU |
|---|---|---|
| `nav.terrain` (statisch) | 256 KiB | 1.024 KiB |
| `nav.foot` | 256 KiB | 1.024 KiB |
| `nav.paths` | 408 KiB | 408 KiB |
| `nav.blocks` | 828 KiB | 828 KiB |
| `nav.fifo` + `nav.ctr` | 16 KiB | 16 KiB |
| `nav.clear` | 256 KiB | 1.024 KiB |
| `nav.comp` | 1.536 KiB | 6.144 KiB |
| `nav.compmeta` | 192 KiB | 192 KiB |
| `nav.secinfo` + `nav.nodes` + `nav.edges` | 231 KiB | 924 KiB |
| `nav.back` | 128 KiB | 512 KiB |
| **gesamt** | **4,01 MiB** (statisch 0,25, Regel 1,47, abgeleitet 2,29) | **11,81 MiB** (statisch 1,0, Regel 2,22, abgeleitet 8,59) |

Ziel „Nav ≤ 12 MB bei 1.024 WU“: **11,81 MiB = 12,39 · 10⁶ B** – erfüllt in MiB, in dezimalen MB knapp darüber
(größter Posten: Komponenten-Labels 3 × u16 je Zelle = 6 MiB). Test: `navMemoryBytes(1024).total ≤ 12 MiB`.
Modul-Scratch (nicht Arena, nur innerhalb eines Aufrufs gültig, wächst nur bei `new Nav` für eine größere Karte):
33 B je Zelle (g, f, Stempel, Ziel-Stempel, Heap, Heap-Position, Elternrichtung, zwei Zelllisten) ≈ 33 MiB bei
1.024 WU bzw. 8,3 MiB bei 512 WU, plus < 1 MiB für abstrakte Suche und lokale Updates (im Sim-Worker zusätzlich zur
Arena).

## SPK3 – Nav-Messwerte

`pnpm bench:nav` (voll), 2026-09-29, **lokal Apple M5 Pro, Node v24.18.0, unter Fremdlast (Load 7,5)**. Karten
`generateNavTestMap({ kind: 'bases', seed: 1 })` mit gestempelten Basen; Budget `NAV_BUDGET_EXPANSIONS_PER_TICK` =
20.000. Anfragen: 200 Paare passierbarer Zellen (Klassen 1–3 im Wechsel, Manhattan-Abstand ≥ size/4), alle bei Tick 0;
8 Läufe (Lauf 1 = JIT kalt, getrennt ausgewiesen). Rohdaten: `packages/nav/bench/results/spk3-<datum>.json`.

| Karte | Precompute statisch | abgeleitet (Clearance, Komponenten, Graph) | Basen stempeln | Nav-Speicher |
|---|---|---|---|---|
| hollow-ridge (512) | 2,3–4,6 ms | 58–76 ms | – | 4,01 MiB |
| bases 512 | 4,0 ms | 92 ms | 102 Footprints, 22 ms (0,22 ms/Stempel) | 4,01 MiB |
| bases 1.024 | 10,0 ms | 220 ms | 381 Footprints, 274 ms (0,72 ms/Stempel) | 11,81 MiB |

| Karte | Ticks bis alle 200 fertig | ms/Tick p50 / **p95** / max (warm) | kalt p95 | Expansionen/Anfrage p50 / p95 / max | ms/Anfrage | HPA\*/Optimum p50 / p95 / max | Direct / Fallback / Retarget |
|---|---|---|---|---|---|---|---|
| 512 WU | 7 (alle Läufe) | 2,50 / **2,86** / 3,03 | 6,74 | 321 / 2.626 / 5.258 | 0,079 | 1,023 / 1,051 / 1,072 | 1 / 0 / 24 |
| 1.024 WU | 8 (alle Läufe) | 3,01 / **3,41** / 3,68 | 6,25 | 539 / 2.842 / 3.629 | 0,117 | 1,015 / 1,038 / 1,053 | 0 / 0 / 10 |

Budget-Sweep 1.024 WU (gleiche 200 Anfragen): 20.000 ⇒ 8 Ticks, p95 3,2 ms · 30.000 ⇒ 6 Ticks, 5,5 ms · 40.000 ⇒ 4 Ticks,
6,0 ms · 60.000 ⇒ 3 Ticks, 8,2 ms · 80.000 ⇒ 3 Ticks, 13,3 ms · 120.000 ⇒ 2 Ticks, 17,4 ms. Unter höherer Last (Load
15) lagen dieselben Werte bis ≈ 2× höher (p95 7,9 ms bei 20.000) – die ms-Werte sind nur berichtet (DECISIONS 16).
Ein zweiter, zufälliger Anfragensatz (Test `service.test.ts`, inkl. Ziele im Wasser/auf Tafelbergen) braucht bei
20.000 ebenfalls 8 Ticks (153.000 Expansionen gesamt).

Basisbau (200 aktive Pfade zwischen den Basen, alle 10 Ticks ein Footprint 3×3…8×8 im Umkreis von 40 WU einer Basis,
alle 5 Ticks verbraucht jeder Pfad einen Wegpunkt, markierte Pfade repathen sofort):

| Karte | Footprints | Repaths je Footprint Ø / p95 / max | Pfade mit ≥ 1 Repath | Stempeln ms p50 / max | Pathing ms/Tick max |
|---|---|---|---|---|---|
| 512 WU | 60 | 1,75 / 15 / 22 | 39 % | 0,64 / 3,3 | 2,6 |
| 1.024 WU | 60 | 1,02 / 5 / 9 | 26,5 % | 1,30 / 5,0 | 1,6 |

**Ergebnis / Empfehlung für ms3-p5 (DECISIONS-Nachtrag):** HPA\* als Standard ist belegt – 200 Einzelanfragen auf
1.024 WU in **8 Ticks** (Kriterium ≤ 10) bei **p95 3,4 ms/Tick** warm (Kriterium ≤ 5 ms; kalt 6,3 ms im allerersten
Lauf), HPA\*-Kosten im Mittel 1,5 % über dem Optimum. Budget-Konstante **20.000 Expansionen/Tick** (30.000 bringt
6 Ticks, reißt aber die 5 ms p95). Korridor-Schnitt-Repath beherrscht den Basisbau: im Mittel 1–2 Repaths je neuem
Gebäude, die Stempel selbst kosten ≈ 1 ms (max. 5 ms bei 1.024 WU) – kein Repath-Sturm, die Abbruchvariante
(Chunk-Eintritt + Lazy-Repair) ist nicht nötig. Die Sim-Messung (ms3-p5) muss Phase 3 im Worker bestätigen.

## Tests

`pnpm vitest run packages/nav tools/eslint-plugin-sim`: **9 Dateien, 174 Tests grün, ≈ 12 s** (4 Worker).

| Datei | Inhalt |
|---|---|
| `passability.test.ts` | hollow-ridge: `terrain == 0` ⇔ Rand ∨ Tiefwasser (`rules.isDeepWaterForLand`) ∨ Neigung > Schwelle – für jede Zelle; Rampen beider Plateaus und Tafelberge für Klasse 3 passierbar; Klippenringe auf allen Strahlen ohne Rampe blockiert, 8 WU die Klippe hinab kostet > 10× die Luftlinie (Umweg über die Rampe); See blockiert, beide Furten für Klasse 3 passierbar; Start-Plateaus und Tafelberg für alle Klassen in einer Komponente, Pfad existiert; Speicher ≤ 12 MiB |
| `astar.test.ts` | **Fein-A\* == Dijkstra in 10.368 Fällen** (6 generierte 64/128-WU-Karten mit zufälligen Footprints + 3 Ausschnitte von hollow-ridge, Klassen 1–3, blockierte Starts/Ziele, > 500 unerreichbare Fälle); rekonstruierte Pfade gültig (Nachbarschaft, Klasse, Rechteck, kein Eckenschneiden, Kostensumme); Dijkstra-Modus mit Zielen und ohne Ziele == Referenz |
| `hpa.test.ts` | **HPA\* ≤ 1,10 × Optimum in 99,7 % von 2.160 Fällen** (bases 512: 99,6 %, bases 1.024: 99,9 %, hollow-ridge: 99,4 %; gesamt p50 1,016, p95 1,043, p99 1,071, max 1,317), nie unter dem Optimum, kein Fall ohne Route (Fallback < 1 %) |
| `derived.test.ts` | Clearance und Komponenten (Labels, Anzahl, kleinste Zellen) == Brute Force; kanonische Labels (Tasche bekommt ihren Rang); **fast-check**: zufällige Stempel/Entstempel-Folgen ⇒ alle abgeleiteten Regionen bitgleich zu `rebuildDerived()` (128 WU nach jedem Schritt, 256 WU mit lebenden Pfaden inkl. Korridor-Index); 64×64-Footprints, Stapeln, Sättigung |
| `repath.test.ts` | **Korridor-Repath: 200 Pfade, 20 zufällige Footprints ⇒ markierte Menge == Brute-Force-Regel** (4.000 Pfadprüfungen, 530 Markierungen), Zähler exakt, Repath danach; Entstempeln markiert nie |
| `service.test.ts` | FIFO (issueTick, entityIdx, stabil); Budget (Anzahl bearbeiteter Anfragen und Rückgabe exakt aus den Einzelkosten); **Budget-Konstante: 200 Anfragen auf 1.024 WU in ≤ 10 Ticks**; 60 Pfade abgelaufen: jede Strecke zwischen Wegpunkten hat Clearance ≥ Klasse (geometrische Supercover), Ende = Ziel; Direct/Ready + Lazy Refinement; Retarget (See, Klippe) = Brute-Force-Nächste; Spirale == Brute Force; Flood == Spirale (400 Fälle); Start-Verschiebung, Failed; cancel/release/Slot-Wiederverwendung; **Determinismus: zwei Läufe ⇒ bytegleiche Arena**; **Allokation: warmer Zyklus mit 200 Anfragen ≈ 13 KiB (< 64 KiB)** |
| `testmap.test.ts` | Generator deterministisch/seed-abhängig; gültige RtsMaps; 'choke' genau eine 3-WU-Lücke (Klasse ≤ 2 durch, 3 nicht) auf 256/512/1.024; 'bases' alle Starts für alle Klassen verbunden (256/512/1.024); 'open' eine Komponente; Regionen: statisch nicht gehasht, abgeleitet nur Voll-Hash, Footprint im Regel-Hash; Snapshot/Restore ohne Rebuild |
| `tools/eslint-plugin-sim/test/config.test.ts` | nav/src (auch Unterordner) und `bench/testmap.ts` unter `sim/determinism`, nav-Tests/Bench nicht |

Selbsttest (2026-09-29):

| Befehl | Ergebnis |
|---|---|
| `pnpm install` | einmal, Lockfile +28 Zeilen (nur Workspace-Links) |
| `pnpm typecheck` | grün |
| `pnpm lint` | grün (eslint + dependency-cruiser, 362 Module) |
| `pnpm vitest run packages/nav tools/eslint-plugin-sim` | 9 Dateien, 174 Tests grün |
| `pnpm bench:nav -- --quick` | Exit 0 (Werte wie oben, 3 Läufe) |

## Abweichungen vom Plan (mit Begründung)

- **Kein IndexedDB-Cache (PLAN §3.8 „Cache in IndexedDB anhand des Map-Hash“):** Precompute gemessen – 58–76 ms auf
  hollow-ridge, 220 ms auf 1.024 WU (plus 10 ms statisch). Das rechtfertigt in MS3 keinen asynchronen Cache (die Sim ist
  synchron, der Cache müsste vor `createWorld` im Host geladen werden); neu bewerten, wenn Setons (1.024 WU) Standard
  wird.
- **`repath(p, sx, sz, issueTick)`** statt `repath(p, sx, sz)`: die FIFO-Ordnung braucht den Tick der neuen Anfrage;
  ohne Parameter müsste Nav einen eigenen Tick-Zustand führen.
- **Höchstens 4 Portale je Kante und Klasse** (feste Slots, damit der Graph in festen Arena-Blöcken liegt und Partner
  ohne Suche gefunden werden). Überzählige Läufe fallen weg (längste bleiben); HPA\* bleibt über den **Fein-A\*-Fallback
  über die ganze Karte** vollständig (`PATH_F_FALLBACK`, Zähler). In allen Messungen: 0 Fallbacks.
- **Speicherziel:** 11,81 MiB bei 1.024 WU (≤ 12 MiB, aber 12,39 · 10⁶ B). Dafür `NAV_CAP_BLOCKS` = 12.288 statt 4 je
  Pfad-Slot: reicht für ≈ 4.096 Pfade mit je 3 Blöcken (lange 1.024-WU-Routen brauchen 3–6); bei Erschöpfung wird der
  Pfad `PATH_FAILED` (Zähler `blocksExhausted`).
- **Zusätzliche abgeleitete Region `nav.secinfo`** (12 KiB bei 1.024 WU): Kostenstufe offener Sektoren – Start-/Ziel-Legs
  und Direktkanten dort ohne Suche (−12 % Laufzeit je Anfrage).
- **Start-Legs lazy, Intra-Kanten per A\* je Paar statt Dijkstra je Knoten** (nach Profiling schneller); die Ergebnisse
  sind identisch (exakte Kosten).
- **Nächste erreichbare Zelle bei großem Abstand:** kleine Startkomponenten (≤ 16.384 Zellen) werden geflutet statt einer
  Spirale um das ferne Ziel (die Spirale kostete bis zu 280.000 „Expansionen“ je Anfrage); Ergebnis identisch
  (Distanz, dann Spiralreihenfolge – getestet).
- **Blockierter Start:** statt `Failed` wird auf die nächste passierbare Zelle ausgewichen (`PATH_F_START_MOVED`,
  Zellmitte als erster Wegpunkt) – Einheiten auf frisch gestempelten Zellen kommen so heraus. `Failed` nur, wenn keine
  Zelle der Klasse existiert (oder PathBlocks erschöpft).
- **Pfad-ID = Slot-Index ohne Generation:** die Sim hält Pfade nur in eigenen Records (Mover/Formation) und gibt sie mit
  `release` frei; `release` einer freien ID wirft.
- **Footprint-Refcounts sättigen** (0 bzw. 255) statt zu werfen: ein doppeltes Entfernen per Cheat darf die Sim nicht
  anhalten. Ein Stempel ohne Blockadeänderung (Zellen schon blockiert) prüft trotzdem die Korridorregel (geometrisch).
- **`refineNext`-Budget** ist ein Schalter (> 0 ⇒ genau ein Segment, Kosten ≤ 2.048 Zellen, typisch 50–300
  Expansionen), kein Teilbudget – ein Segment wird nie über Ticks verteilt.
- **Test-Optimum im HPA\*-Test** per Dijkstra-Modus derselben Fein-Suche (ein Lauf je Quelle für alle Ziele) statt
  A\* je Fall – gleichwertig, weil Fein-A\* == Dijkstra in `astar.test.ts` belegt ist.

## Hinweise für Folgepakete

- **ms3-p2:** `tools/headless/tsconfig.harness-worker.json` (nicht in meinen owns) braucht
  `{ "path": "../../packages/nav" }`, sobald `packages/sim/src` `@faf/nav` importiert (sonst TS6307 im Harness-Build).
  Nav-Regionen im Schema = Layout-Hash-Änderung (gewollt). `serviceTick(NAV_BUDGET_EXPANSIONS_PER_TICK)` in Phase 3;
  `refineNext(p, 1)` in Phase 7, wenn `waypoint` `WP_NEED_REFINE` liefert oder proaktiv bei `refinedLeft(p) ≤ 1`; ein
  kleines eigenes Budget (z. B. höchstens N Segmente je Tick) ist Sache der Sim. `stampFootprint` liefert die Zahl der
  markierten Pfade; die Sim ruft für markierte Pfade `repath(p, x, z, tick)` (Zähler `requestsIssued` steigt, die
  Anfrage wird im nächsten `serviceTick` bearbeitet). Ein Gruppenbefehl = ein `request`.
- **ms3-p5:** `generateNavTestMap(...)` für 1.024-WU-/Choke-Karten; `createRtsMap` mit den Feldern oben. SPK3-Zahlen dieser
  Tabelle als Nav-Anteil; Kriterien „≤ 10 Ticks“ maschinenunabhängig, „p95 ≤ 5 ms“ nur mit `FAF_PERF_GATE=1`
  (der Nav-Bench gated so: Exit 1 bei > 10 Ticks immer, bei p95 > 5 ms nur mit `FAF_PERF_GATE=1`).
- `pnpm bench` (rekursiv) führt den Nav-Bench jetzt ebenfalls voll aus (≈ 10–15 s); `ci:local` zusätzlich `--quick`.

## Bekannte Grenzen

- Nur Layer `Land` (Hover/Marine post-MVP); Luft pfadet nicht.
- Kostenstufen nur aus der Neigung; Straßen/Untergrund-Kosten gibt es nicht.
- HPA\*-Ausreißer bis 1,32 × Optimum (hollow-ridge, kurze Wege um Klippenkanten) – Portal in Laufmitte ist HPA\*-typisch;
  das String-Pulling glättet den gefahrenen Weg zusätzlich (gemessen wird die Route über die Portale).
- Refinement-Fehlschläge (nur nach mehreren Stempeln ohne zwischenzeitlichen Repath denkbar) setzen `PATH_F_REPATH`
  ohne `repathsTriggered`.
- Große Komponentenänderungen (neue Tasche vor vielen Komponenten in Scanreihenfolge, Verschmelzen) kosten einen
  linearen Umbenennungs-Durchlauf je Klasse (≈ 1 ms bei 1.024 WU); die gemessenen Stempel liegen bei 1–5 ms.
- Die ms-Messwerte stammen aus einer stark ausgelasteten Maschine (parallel laufende Workflows) und schwanken bis ≈ 2×.
