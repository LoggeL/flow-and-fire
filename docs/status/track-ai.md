# TRACK-AI – Skirmish-KI als Vorarbeits-Track (Hauptdokument)

Stand: 2026-09-30 · Branch `track-ai` (Worktree `.worktrees/faf-ai`) · Plan `docs/plans/TRACK-AI.json` ·
Paket-Fragmente `docs/status/track-ai-tai-p0-core.md` … `track-ai-tai-p7-gates-docs.md`

## 1. Zweck und Scope

TRACK-AI ist **kein PLAN-Meilenstein**, sondern ein paralleler Vorarbeits-Track zu MS3 und den übrigen Tracks. Er
baut die Skirmish-KI nach PLAN §3.10 und `docs/design/ai.md` so weit, dass MS6 (Scripted Dummy-KI, SPK7), MS9 (A1/A2)
und MS10 (Economy-Scaling) nur noch die echte Sim anschließen müssen.

- **Gebaut:** das Paket `@faf/ai` (Verträge, Perception-Snapshot, Budget, Profile, Manager-Architektur, Host/Worker)
  und das Werkzeugpaket `@faf/ai-arena` (vereinfachte Headless-Test-Sim, Szenarien, Turniere, Benchmarks).
- **Nicht gebaut:** keine echte Sim. `packages/{sim,nav,render,client,sim-host,protocol,fixed,heap,rules,formats,
  blueprints}`, `apps/**`, `content/**`, `docs/design/**`, `tools/ai-sim/**` und `tools/headless/**` sind unverändert.
  Die Root-Konfiguration wurde um zwei tsconfig-References erweitert, dazu `eslint.config.js` um zwei Punkte
  (Abweichung 13): den Ignore-Eintrag `docs/design/ui-mockups/**` (wortgleich aus `main`) und den Block der
  KI-Determinismus-Regeln (`AI_SOURCES`). `ai.md` und `ai-openings.json` sind unverändert.
- **Alle Messwerte stammen aus der Arena** und gelten als Vorab-Gates. Die Abnahme mit der echten Sim ist Sache von MS9
  (`tools/headless`, Referenz-Laptop, Browser-Worker).

## 2. Paketübersicht

### `@faf/ai` (`packages/ai`, 66 Module, ≈ 15.700 Zeilen; Abhängigkeiten nur fixed, protocol, rules)

`lib ES2022`, `types []`: kein DOM, kein Node. Exporte `@faf/ai`, `@faf/ai/testing` und `@faf/ai/host`.

| Bereich | Module | Inhalt |
|---|---|---|
| Verträge | `types.ts`, `index.ts` | `AiStatic` (inkl. `starts`/`armyStart`), `PerceptionView`, `OwnUnit`, `KnownUnit`, `PerceptionEvent`, `EcoState`, `AiBlueprint(Table)` |
| Daten und Karte | `data/` (roster-adapter, passability, static), `analysis/` (grid, map-analysis) | `bpTableFromRoster`, `computePassLowRes`, `createAiStatic`, `analyzeMap` (Zonen, Mex-Reihenfolge, Ring, Pfad, Rally, Staging, Engstelle, Slots) |
| Eröffnungen | `openings.ts` | strenger Parser für `faf-ai-openings/1`, Rollen → Blueprint, Auswahl nach Kartenklasse/Schwierigkeit |
| Kern | `budget.ts`, `rng.ts`, `det.ts`, `profile.ts`, `threat.ts`, `taskboard.ts`, `blackboard.ts`, `brain.ts`, `source.ts` | `ThinkBudget`/`OpBudget`, xorshift32 je Manager, Profile Easy/Normal/Hard, Threat, Task-Board, Blackboard, Brain mit Manager-Fahrplan; `DueCommandSource` (gemeinsame Basis aller KI-Quellen: idempotent je Tick, Byte-Form `pending`/`batchFor`), `AiCommandSource` (nacktes Brain, Unit-Tests), `PendingAiSource` |
| Perception | `perception/` (layout, writer, snapshot, place) | Snapshot-Layout v2 (nur Ganzzahlen), `PerceptionWriter` (Roh-API + quantisierende Float-API), `SnapshotPerception`, `canPlaceKnown` |
| Commands | `commands/` (payloads, emitter) | provisorische Payloads (`AI_PAYLOAD_VERSION = 1`), `CommandEmitter` mit Prioritäten, APM, Dedup, Rollback |
| Manager | `managers/{opening,economy,tech,engineer,factory,platoon,intel,defense}` | siehe §3.2 |
| Standard-KI | `default-brain.ts` | `createDefaultBrain({managers?})` |
| Host | `host/` (clock, ai-host, protocol, worker, async-source) | `AiHost` mit Notabbruch, `SyncAiSource`, Worker-Protokoll `faf-ai-worker/1`, `runAiWorker`, `AsyncAiSource` (hält die Batch-Bytes des Workers) |
| Testhilfen | `testing/` | `flatStatic`, `fakeAnalysis`, `FakeWorld`, `runThinks` |

**Tests:** `packages/ai/test`, 20 Dateien, 186 Tests.

### `@faf/ai-arena` (`tools/ai-arena`, ≈ 8.700 Zeilen; Abhängigkeiten ai, fixed, formats, protocol, rules)

| Bereich | Module | Inhalt |
|---|---|---|
| Daten | `data/` | Karten aus `content/maps` (Setons, Hollow Ridge, Tessera, Braidwater) samt Spots/Starts aus `markers.json`, Roster, Openings, Modellannahmen |
| Eco | `eco/flow.ts` | Flow-Eco nach PLAN §3.4 (eine Stall-Ratio, Overflow, Kostensumme exakt in Milli-Ganzzahlen) |
| Welt | `world/` | Bauen, Assist, Upgrade, Fabrik-Queue/Repeat/Roll-off/Rally, A* auf dem 2-WU-Raster, abstrakter Kampf, Sicht/Ghosts, Cheat-API, Welt-Hash |
| Perception | `perception/` | `ArenaPerceiver` füllt den `PerceptionWriter` der eigenen Army, `buildArenaStatic` |
| Match | `match/` | `runMatch`/`runMatchAsync`/`replayMatch`, Metriken (T2, Welle, Idle, Stall, APM) |
| Statistik | `stats/` | Wilson, Elo, Perzentile, Paarungsplan, Worker-Pool (≤ 4 Threads) |
| Host | `host-node/` | Node-`worker_threads`-Adapter, Brain-Spezifier, KI-Seiten `sync`/`worker`, Hash-Trails |
| Turniere | `tournament/` | Suites `ms9`/`diff`/`quick`, Pool-Lauf, Aggregation mit Gates, JSON- und Markdown-Bericht, CLI |
| Benchmarks | `bench/` | Think-Zeit, Big Battle 2 × 300, SPK7-Analogon, Durchsatz; Uhren (einziger Wall-Clock-Ort der Arena) |
| Szenarien | `scenarios/` | Szenario-DSL (`runScenario`, KI-Seiten über `AiHost` + `SyncAiSource` wie Turniere und Browser), Smoke-Kalibrierung `smoke.ts` |
| Skripte | `scripts/tournament.ts`, `scripts/bench.ts` | Einstiegspunkte, Berichte nach `tools/ai-arena/results/` (ignoriert) |

**Tests:** `tools/ai-arena/test`, 27 Dateien, 191 Tests.

**`package.json`-Skripte** (`pnpm --filter @faf/ai-arena run …`, immer über `tools/heavy`):

| Skript | Befehl | Zweck |
|---|---|---|
| `tournament` | `node --import tsx scripts/tournament.ts` | `-- --suite ms9\|diff\|quick --workers 4 [--clock thread\|wall] …` |
| `bench` | `node --import tsx scripts/bench.ts` | Standardlauf ≈ 2 min (121 s) (auch im Root-`pnpm bench`), `--quick` ≈ 20 s |
| `scenarios` | `vitest run` über die Root-Config für `tools/ai-arena/test/scenarios` | ai.md-§9-Szenarien |
| `smoke` | `node --import tsx src/scenarios/smoke.ts` | Kalibrierungsläufe (tai-p5) |
| `gates` | Turnier `ms9` (4 Worker) und danach `bench` | Exit ≠ 0 bei jedem Gate-Verstoß |

## 3. Architektur

### 3.1 Manager und Takte (ai.md §2.2)

Ein Think `k = N / thinkEvery` läuft an Tick `N ≡ 0 (mod thinkEvery)` (Easy 10, Normal/Hard 5) und liefert Commands für
`N + lead` (3). Reihenfolge: Perception-Ingest → Intel (1 Hz, `k` ungerade) → Opening → Economy (1 Hz, gerade) → Tech
(1 Hz, gerade) → Defense (1 Hz, ungerade) → Factory (1 Hz, gerade) → Engineer (2 Hz) → Platoon (2 Hz) → Emitter. Bei Easy
läuft jeder Manager in jedem Think. Micro (Hard, 5 Hz) ist MS14 und fehlt.

### 3.2 Manager

- **OpeningRunner:** führt `ai-openings.json` aus (`eco_standard`, `land_rush`, `tech_greed`; `air_opener` wird erkannt
  und ist bis MS12 gesperrt). Dazu gehören Standort-Selektoren und Ring-Reservierung. Die Vogt-Eröffnung geht als eine
  Shift-Queue raus. Es gibt Handoffs an Engineer- und Factory-Manager, lokale Abwehr (Poke-Toleranz), den
  Verteidigungsmodus (Threat ≥ 160 über 5 s) und die Scout-Umschaltung.
- **EconomyManager:** Energie-Bilanz mit Vorgriff, Mass-Senken in Tabellenreihenfolge mit `R_E`-Buchung, „Energie
  zuerst“, Sättigung, Expansion, Mex-Upgrades.
- **TechManager:** T1 → T2 mit Assist.
- **EngineerManager:** Task-Board, Spiralsuche bei abgelehnter Platzierung, Idle-Regel, Flucht, Rettung und
  Kraftwerks-Vorrang.
- **FactoryManager:** Mix mit Konter-Tabelle (Hysterese), Repeat-Schleifen, die nur bei einem Wechsel neu geschrieben
  werden, Engineers bis zur Sollzahl, Rally.
- **PlatoonManager:** Sammeln → Staging → Angriff. Pflichtangriff bei `waves.maxS`, Rückzug bei R < 0,7 (2 Thinks),
  Wiedereinstieg erst bei R ≥ 1,0. Dazu Raid-, Jagd- und Vogt-Leine. R_lokal gibt es genau einmal:
  `PlatoonScene.strengthAt` summiert `sumThreatInRadius` (threat.ts) über die Bucket-Kandidaten.
- **IntelManager:** 16-WU-Threat-Grid mit Lazy-Verfall (0,95^s aus LUT) und Cursor über Thinks, Scout-Route.
- **DefenseManager (Minimal-A8):** ein Riegel je angegriffenem Mex-Cluster, kein Riegel bei Pokes.

### 3.3 Blackboard

Das Blackboard ist der einzige geteilte Zustand. Es hält Einheitenlisten, Feindgedächtnis (180-s-Fenster, Ghosts),
Reize mit Reaktionsverzögerung, Task-Board, Reservierungen (Spots, Plätze, Einheiten, Vogt-Übergabe), `EcoPlan`,
Threat-Abfrage, Platoons, Tech, Eröffnung, `rally`, `lastDropped` und Telemetrie. Jeder Abschnitt hat genau einen
schreibenden Eigentümer (Modulkopf `blackboard.ts`).

### 3.4 Operationsbudget, APM, Notabbruch

- **Budget** zählt Operationen, keine Millisekunden. Die Budgets je Manager stehen in ai.md §2.3.
  - Manager-Budgets sind streng, Reste fallen an die Reserve desselben Thinks (Opening, Emitter). Es gibt keinen
    Übertrag zwischen Thinks.
  - Ist das Budget leer, setzen Manager per Cursor im nächsten Lauf fort.
  - Perception-Ingest zählt gegen eine eigene Pauschale außerhalb der Tabelle.
- **APM:** Der Emitter nutzt einen Eimer (Burst 10/20/40) und zusätzlich eine harte Grenze von `cap` Records je
  gleitendem 60-s-Fenster (40/120/300), auch für P0. Er arbeitet mit Prioritäten P0–P4 und Dedup gegen den Auftrag
  laut Perception.
- **Notabbruch:** `AiHost` bricht einen Think über der Grenze ab (Browser 40 ms, headless 200 ms), setzt `aborted`
  und die Marke `aiTimeout`. Zustand und Commands übernimmt nur, wer einen abgeschlossenen `ctx.step` hat. Die Uhr
  liest nur `host/clock.ts`. In Arena-Turnieren ist die Uhr Thread-CPU-Zeit (§6, Abweichung 7).

### 3.5 Profile (ai.md §2.1, §2.3, §2.4, §6)

| | Easy | Normal | Hard |
|---|---|---|---|
| `thinkEvery` / `lead` / Reaktion | 10 / 3 / 20 Ticks | 5 / 3 / 5 Ticks | 5 / 3 / 0 |
| Budget gesamt | 12.000 | 24.000 | 40.000 |
| APM-Cap / Burst | 40 / 10 | 120 / 20 | 300 / 40 |
| Fehlerrate | 15 % (Top 3, Mex-Ausfall, keine Konter) | 5 % (Top 2) | 0 % |
| `attackRatio` / Rückzug | 1,5 / 0,7 | 1,2 / 0,7 | 1,0 / 0,7 |
| Erste Welle | 12 Einheiten | aus der Eröffnung | aus der Eröffnung |

### 3.6 Determinismus (ai.md §2.5)

- In `packages/ai/src` und `tools/ai-arena/src` sind nur IEEE-exakte Operationen erlaubt.
- Jeder Manager hat einen eigenen RNG-Strom. Sortierung nur mit totalem Comparator, Map/Set nur in
  Einfügereihenfolge, kein `for…in`.
- Uhren gibt es nur in `host/clock.ts` und `tools/ai-arena/src/bench/**` (dort auch die Thread-CPU-Uhr).
  `Math.log10` ist nur für die Elo-Berichtszahl in `stats/**` erlaubt.
- Geprüft wird das doppelt: als ESLint-Regeln im Commit-Lint (`eslint.config.js`, Block `AI_SOURCES`:
  `no-restricted-syntax` für Math außerhalb der IEEE-exakten Liste, berechneten/optionalen/aliasierten Math-Zugriff,
  `**`, `for…in`, `sort`/`toSorted` ohne Comparator; `no-restricted-properties` für `localeCompare`,
  `getRandomValues`, `randomUUID`, Uhren; `no-restricted-globals` für `Date`, `performance`, Timer, `Intl`, `crypto`)
  und zusätzlich durch den Guard-Test `packages/ai/test/determinism-guard.test.ts` (dieselben Muster, auch über
  Zeilenumbrüche). `localeCompare`/`Intl` sortieren im Browser je nach Locale anders als headless.
- Gleicher Seed ⇒ gleicher Command-Strom. Synchroner Host = Worker-Host (AI-DET-01). `replayMatch` spielt jedes
  Arena-Spiel bitgleich nach.

### 3.7 Perception-Snapshot

Snapshot-Layout v2, little-endian, Magic `AIPS`, **nur Ganzzahlen** nach den Konventionen der Frame-Records
(protocol `frame.ts`), damit die Sim es ohne Floats schreiben kann (Lint-Regel `sim/determinism`):

| Teil | Größe | Kodierung |
|---|---|---|
| Kopf | 80 B | Army, Tick, Zähler, 11 × i32 Eco in Tausendsteln |
| eigene Einheit | je 48 B | Positionen i32 Fx raw (1 WU = 4096), HP/Bau/Fabrikfortschritt u16 Q15 (1,0 = 32768) |
| bekannter Feind (sichtbar, Ghost, Blip) | je 24 B | Position i32 Fx raw, HP u16 Q15 (nur sichtbar) |
| Ereignis | je 24 B | Schadensbetrag i32 in Tausendsteln |

- Die Reihenfolge ist die Slot-Reihenfolge des Erzeugers.
- Der Erzeuger ist `PerceptionWriter`: Die Roh-API (`setEcoRaw`, `addOwnRaw`, `addKnownRaw`, `addEventRaw`) nimmt die
  Ganzzahlen (Weg der Sim ab MS9). Die Float-API (`setEco`, `addOwn`, …) quantisiert einmal (Positionen gerundet,
  Anteile abgerundet, sodass < 1 unter 1 bleibt) und ist der Weg der Float-Erzeuger (`ArenaPerceiver`, `FakeWorld`).
  Beide ergeben für gleiche Rohwerte dieselben Bytes (Test in `perception.test.ts`).
- Der Leser `SnapshotPerception` ist der einzige Ort, an dem aus den Ganzzahlen Floats werden.
- Gegenüber v1 (f64) änderten sich die Arena-Messwerte nur in der Nachkommastelle (§6.2).
- `freeMassSpots()` und `canPlace` kennen nur bekannte Belegung (ai.md §11 Punkt 9). Über den Gegner liegen nur
  Position, Typ und HP-Anteil vor, nie Speicher, Einkommen oder Queues.

## 4. Adapter-Grenze zu MS6/MS9/MS10 (heute → später)

| Baustein | Heute (TRACK-AI) | Später | MS | Übernahme |
|---|---|---|---|---|
| Perception-Layout | `perception/layout.ts` (v2, nur Ganzzahlen) in `@faf/ai` | `@faf/protocol` (`perception.ts` neben `frame.ts`, PLAN §3.2): sim darf `@faf/ai` nicht importieren (`.dependency-cruiser.cjs` `sim-deps`) | MS9 (protocol-Änderung, eigener Schritt) | Datei samt Konstanten unverändert nach protocol verschieben, `@faf/ai` importiert sie von dort; Eco-Einheit (Tausendstel) gegen die SafeInt-Eco aus MS4 prüfen, bei Abweichung Layout v3 mit Reader-Anpassung in `SnapshotPerception` |
| Perception-Erzeuger | `PerceptionWriter` (Roh- und Float-API), gefüllt von `ArenaPerceiver` über die Float-API | FrameWriter-Profil der eigenen Army in der Sim schreibt über die Roh-API (Fx raw, Q15, Tausendstel; keine Floats, kein `setFloat64`) | MS9 | Byte-Test AI-PERC-01 (verborgene Einheit ändert die Bytes nicht) sowie AI-PERC-02/03 gegen die echte Sim übernehmen |
| `AiStatic.passLowRes` | `computePassLowRes` aus der Heightmap (ecosim-Portierung) | nav `passLowRes` | MS9 | Kartenzahlen aus ai.md §3 (Test `analysis.test.ts`) gegen nav prüfen |
| `AiStatic.sectors` | `null` | `SectorGraphView` aus nav | MS9 | Kartenanalyse/Pfade auf den Sektorgraph umstellen, Knoten-ops zählen (ai.md §2.3) |
| `AiStatic.bps` | `bpTableFromRoster(roster.json)`; im Worker `BpTableSource {kind: 'roster'}` | `BlueprintViewTable` aus `@faf/blueprints` (kompiliertes Bundle) | MS9 | `AiBlueprintTable`-Interface bleibt, `toAiStaticWire`/`fromAiStaticWire` bekommen eine neue Quelle |
| Command-Payloads | provisorisch, `AI_PAYLOAD_VERSION = 1`, nur vorhandene Ops | Payload-Codecs in `@faf/protocol` | MS9 | Ops unverändert. `commands/payloads.ts` wird durch protocol-Codecs ersetzt, Roundtrip-Tests bleiben |
| Platzierung | `canPlaceKnown` (provisorische Regeln); Arena: Wissen beim Command, Wahrheit beim Baubeginn | `rules.canPlace` mit Belegung „nur bekannt“ (ai.md §11 Punkt 9) | MS9 (Regeln MS4) | AI-PERC-02 und AI-ENG-02 als Szenarien der echten Sim |
| Ereignisse | `PerceptionEvent` im Snapshot (von der Arena erzeugt) | Event-Stream der Sim (`ownDamaged`, `ownDestroyed`, `ownCompleted`, `enemySighted`, `enemyDestroyed`, `commandRejected`) | MS9 | Grund „kein Weg“ fehlt in `REJECT_REASONS` (heute `other`) |
| Host | `AiHost` + `SyncAiSource`; `runAiWorker` in Node-`worker_threads` (`NodeAiWorker`). `SyncAiSource` und `AsyncAiSource` erfüllen strukturell `TickSource` von sim-host (`pending(t)` verbraucht nichts, `batchFor(t)` liefert einen Command-Batch), ohne sim-host zu importieren; `AsyncAiSource` reicht die Batch-Bytes des Workers unverändert durch | AI-Worker im Browser (`runAiWorker(eventTargetPort(self), createDefaultBrain)`), Sim-Worker registriert `AsyncAiSource` direkt als `TickSource`; Fallback bei ≤ 2 Kernen: `SyncAiSource` im Sim-Worker (Envelopes → `encodeBatch` einmal je fälligem Tick) | MS9 | AI-DET-01 im Chromium-Worker gegen Node-synchron; Mischfall KI + lokale Quelle im Scheduler |
| `aiTimeout` | `AiTimeoutMark` in `host.marks` / `onTimeout` | `MARK aiTimeout` im Command-Log-Recorder (Replay-Chunk MARK) | MS9 | AI-DET-04 mit Recorder |
| `'pending'` / SPK7 | `PendingAiSource`/`AsyncAiSource`; SPK7-Analogon im Bench-Scheduler | echter Scheduler in sim-host (SP-Sim-Lag), Scripted Dummy-KI | MS6 | AI-DET-03 und SPK7-Exit im echten Scheduler |
| Turniere | `tools/ai-arena` gegen die Arena, `createDefaultBrain` | `tools/headless/ai-tournament` gegen die echte Sim; Referenz-KIs als Git-Tags `ai-msN` (ai.md §11 Punkt 4) | MS9/MS10 | Suites, Aggregation, Wilson/Elo und Berichtsformat übernehmen (`tournament/` hängt nur an Match-Ergebnissen) |
| Eco-Scaling | Grundstufe (MS9-Umfang) | A9: Prioritäten/Pausen (E13), Speicher/Adjacency, Mex-Upgrade-Qualität | MS10 | Stall-Gate ≤ 5 % gepoolt, `ms10-vs-ms9` |

## 5. Abnahme (Kriterien aus `docs/plans/TRACK-AI.json`)

| # | Kriterium (gekürzt) | Status | Messwert | Beleg |
|---|---|---|---|---|
| 1 | Pakete im Workspace; install/typecheck/lint grün; ai-deps; ohne DOM/Node | ⚠️ | install ✅, typecheck ✅, ESLint und dep-cruiser für alle TRACK-AI-Pfade ✅; `pnpm lint` insgesamt rot nur durch `docs/design/ui-mockups/**` (Branch-Basis ohne den Ignore-Eintrag von main) | §8, Fragment tai-p7 |
| 2 | Schnittstellen PLAN §3.10 / ai.md §11 Punkte 8 und 9, protocol unverändert | ✅ | `AiStatic` mit `starts`/`armyStart`, `PerceptionView` „nur bekannt“, `AiBrain`, `OpBudget`, `AiProfile`, `AiCommandSource`/`AsyncAiSource`/`PendingAiSource` | tai-p0, tai-p6 |
| 3 | Manager-Architektur vollständig in Reihenfolge/Takt | ✅ | 8 Manager in `MANAGER_ORDER` | `brain.test.ts`, `managers/**` |
| 4 | Profile Easy/Normal/Hard; ops statt Wall-Clock; APM ≤ Cap je 60-s-Fenster; ops-p99 ≤ Budget | ✅ | APM-p99 40/120/186 (Caps 40/120/300); ops-p99 9.155/14.764/8.723 (Budgets 12.000/24.000/40.000) | `commands.test.ts`, Turniere |
| 5 | Determinismus AI-DET-01…04, Guard | ✅ | sync = Worker (fixture + `createDefaultBrain`); DET-03/04 zusätzlich mit `createDefaultBrain` | `test/host/determinism.test.ts` (10 Tests) |
| 6 | Nicht cheatend AI-PERC-01…03 | ✅ | Bytes und Command-Strom gleich | `perception.test.ts`, `perception-determinism.test.ts` |
| 7 | Arena: Flow-Eco, Bauen, Pfade, Kampf, Sicht, 4 Karten, `replayMatch` | ✅ | Kostensumme exakt, Replay bitgleich | `test/{eco,world,match,perception}` |
| 8 | Kartenanalyse ai.md §3 | ✅ | Setons 48/2/48/10, 462,9 WU, Rally 417,6 WU; Hollow Ridge 6/4/6/0, 569,5 WU, Rally 523,8 WU; Ring 16,0 / 21,7–22,1 WU | `analysis.test.ts` |
| 9 | Eröffnungs-Timings ±10 s (AI-OPEN-01/02) | ✅ (1 Ausnahme begründet) | siehe §6.2; eco_standard/Hollow Ridge mex8 −10,7 s | `openings.test.ts` |
| 10 | Verhaltensszenarien ai.md §9 | ✅ | 28 Szenario-Tests | `test/scenarios/**`, tai-p5 |
| 11 | Turnier-Gates ms9 (210 Spiele) + Bericht diff | ✅ | T2 Wilson-Untergrenze 95,9 %, Welle 98,2 %, Idle max 8,4 %, 0 Crashes, 0 aiTimeout | §6.1 |
| 12 | Benchmarks Think-Zeit, Big Battle, SPK7 | ✅ | siehe §6.3 | `scripts/bench.ts` |
| 13 | Doku, Fragmente, STATUS/DECISIONS | ✅ | dieses Dokument, 8 Fragmente, Nachträge angehängt | – |
| 14 | Scope, Root-Konfiguration, `pnpm test` grün | ✅ | Scope-Prüfung leer, `git diff tsconfig.json` = 2 References | §8 |

## 6. Messwerte (Apple M5 Pro, Node 24.18, Arena statt echter Sim)

### 6.1 Turniere

**`ms9`**: Normal-Spiegel, Seeds 1–105 × getauschte Startmarker, Setons/Hollow Ridge/Tessera je 70 Spiele, 30 min.
Ergebnis: **bestanden**, 210 Spiele in 124–147 s mit 4 Workern, Notabbruch-Uhr Thread-CPU (drei Läufe, identische Spielergebnisse).

| Gate | Wert | Schwelle |
|---|---|---|
| T2 ≤ 12:00 | 207/210 = 98,6 %, Wilson [95,9 %; 99,5 %] | Untergrenze ≥ 90 % ✅ |
| Erste Welle ≤ 8:00 | 210/210 = 100 %, Wilson [98,2 %; 100 %] | Untergrenze ≥ 90 % ✅ |
| Idle-Engineer (jede Seite jedes Spiels) | max 8,4 %, Mittel 1,2 %, 0 Verstöße | < 15 % ✅ |
| Crashes (bis 30 min) | 0 | 0 ✅ |
| aiTimeout | 0 | 0 ✅ |
| APM-p99 Normal | 120 (11.502 Fenster) | ≤ 120 ✅ |
| ops-p99 Normal | 14.764 (größtes p99 einer Seite, max 16.276) | ≤ 24.000 ✅ |
| Energie-Stall gepoolt (Bericht, MS10-Ziel) | 2,23 % (p90 je Spiel 10,1 %) | ≤ 5 % |
| Think-Zeit (Thread-CPU) | p50 0,09 ms, p95 max 3,0 ms, max 9,6 ms | Diagnose |

| Karte | Siegquote A (A–Remis–B) | Elo A−B | T2 ≤ 12:00 (Stichprobe) | T2-Median | Welle-Median | Stall | Idle max |
|---|---|---|---|---|---|---|---|
| Setons | 50,0 % (11–48–11) | 0 | 70/70 [94,8 %; 100 %] | 7:50 | 3:35 | 2,80 % | 4,2 % |
| Hollow Ridge | 43,6 % (9–43–18) | −45 | 67/70 [88,1 %; 98,5 %] | 8:25 | 3:43 | 0,96 % | 7,2 % |
| Tessera | 45,7 % (21–22–27) | −30 | 70/70 [94,8 %; 100 %] | 8:04 | 3:51 | 3,00 % | 8,4 % |
| gesamt | 46,4 % [39,8 %; 53,2 %] (41–113–56) | −25 | 207/210 | – | – | 2,23 % | 8,4 % |

| Eröffnung (Stichprobe) | n | Siegquote [Wilson] | T2 ≤ 12:00 | T2-Median | Welle-Median | Stall |
|---|---|---|---|---|---|---|
| eco_standard | 104 | 58,7 % [49,0 %; 67,6 %] | 104/104 | 8:04 | 3:37 | 1,30 % |
| land_rush | 58 | 36,2 % [25,1 %; 49,1 %] | 55/58 | 9:47 | 3:53 | 2,84 % |
| tech_greed | 48 | 38,5 % [26,1 %; 52,7 %] | 48/48 | 6:47 | 4:30 | 3,59 % |

- Die drei T2-Ausreißer sind land_rush auf Hollow Ridge. Dort liegt der T2-Median schon ohne Gegner bei 10:06
  (`expect` 603 s). Unter Druck rutscht er über 12:00.
- Remis bedeutet: Zeitlimit 30 min erreicht. Im Spiegel ist die Siegquote deshalb wenig trennscharf; die Gates messen
  Timings.

**Wall-Clock-Vergleich** (gleicher Stand, `--clock wall`, Lauf 05:13): identische Spielergebnisse, aber **12
aiTimeout-Marken**.
- Die Think-Maxima lagen bei 340,4 ms (drei Spiele in drei Workern gleichzeitig), 1.316,6 ms (drei Spiele
  gleichzeitig) und 2,9–3,1 s. ops je Think waren dabei normal (≤ 16.276).
- Eine Probe mit 4 Threads über 120 s zeigte: alle 15 s friert der ganze Prozess für 2,99–3,08 s ein, alle Threads
  gleichzeitig, mit 0,2–0,4 ms CPU in dieser Zeit.
- Ursache ist also die Maschine, nicht die KI. Deshalb läuft die Notabbruch-Uhr im Turnier auf Thread-CPU-Zeit
  (Abweichung 7).

**`diff`** (Bericht, je 60 Spiele, Seeds 1–30 × Tausch, 30 min): bestanden, 0 Crashes, 0 aiTimeout.

| Paarung | A–Remis–B | Siegquote A [Wilson] | Elo A−B | APM-p99 (Cap) | ops-p99 (Budget) |
|---|---|---|---|---|---|
| Normal gegen Easy | 20–35–5 | 62,5 % [49,8 %; 73,6 %] | +89 | Easy 40 (40) | Easy 9.155 (12.000) |
| Hard gegen Normal | 17–32–11 | 55,0 % [42,5 %; 66,9 %] | +35 | Hard 186 (300) | Hard 8.723 (40.000) |

Das MS14-Gate (≥ 65 % Untergrenze) ist damit nicht erreicht. Es ist hier nur Bericht, denn Micro und Hard-Vorhersage
kommen erst in MS14.

### 6.2 Eröffnungs-Timings (AI-OPEN-01/02, Normal, ohne Gegner-Militär)

Angaben in s, Arena / `expect`, Fenster bis `techT2 + 30 s`.

| Eröffnung | Karte | fac1 | eng1 | mex4 | mex8 | techT2 | Stall | Idle |
|---|---|---|---|---|---|---|---|---|
| eco_standard | Setons | 30,3 / 31,8 | 45,8 / 46,8 | 90,8 / 94,9 | 146,2 / 136,9 | 470,8 / 465,6 | 0,0 % | 0,0 % |
| land_rush | Setons | 30,3 / 31,8 | 45,8 / 46,8 | 94,2 / 98,5 | 230,3 / 227,6 | 562,4 / 562,9 | 0,3 % | 0,0 % |
| tech_greed | Setons | 30,3 / 31,8 | 45,8 / 46,8 | 90,8 / 94,9 | 138,5 / 147,8 | 391,9 / 392,3 | 0,0 % | 0,0 % |
| eco_standard | Hollow Ridge | 30,3 / 31,8 | 45,8 / 46,8 | 122,8 / 130,0 | 501,7 / 512,4 | 503,2 / 510,5 | 0,0 % | 0,5 % |
| land_rush | Hollow Ridge | 30,3 / 31,8 | 45,8 / 46,8 | 182,5 / 187,1 | 526,7 / 532,2 | 605,7 / 603,4 | 0,0 % | 0,2 % |
| tech_greed | Hollow Ridge | 30,3 / 31,8 | 45,8 / 46,8 | 152,5 / 162,1 | – (591,2 nach dem Fenster) / 635,7 | 486,1 / 493,6 | 0,0 % | 0,2 % |

- Alle Werte liegen innerhalb ±10 s. Einzige Ausnahme ist eco_standard/Hollow Ridge mex8 mit −10,7 s (Toleranz 12 s):
  Die Arena läuft A*-Wege mit String Pulling, die ≈ 4 % kürzer sind als ecosims Rasterweg × 1,1, zu den umkämpften
  Spots in 245–250 WU Entfernung.
- Die frühen Zeiten liegen 1–4 s früher, weil Bauer bei Baureichweite + halbem Footprint anhalten.
- `expect` ist unverändert.

### 6.3 Benchmarks (`scripts/bench.ts`, Standardlauf 121 s, Wall-Clock-Messung): alle Gates grün

| Teil | Messwerte | Gate |
|---|---|---|
| (a) Think-Zeit Easy (Setons 1v1, 15 min, 1.800 Thinks) | p50/p95/p99/max 0,109/0,211/0,348/3,68 ms; ops-p99 3.289 (12.000) | ops ✅, 0 Abbrüche ✅, Replay ✅ |
| (a) Think-Zeit Normal (3.600 Thinks) | **p95 0,133 ms** (p50 0,069, p99 0,202, max 0,525); ops-p99 2.727 (24.000) | p95 ≤ 8 ms ✅ (lokal) |
| (a) Think-Zeit Hard (3.600 Thinks) | 0,062/0,112/0,165/0,356 ms; ops-p99 2.239 (40.000) | ✅ |
| (d) Durchsatz | mit KI 12.600–15.100 Ticks/s, Arena allein 21.600–29.300 Ticks/s | Bericht |
| (b) Big Battle 2 × 300 (Hard, 1.200 Ticks; AI-BUD-01-Analogon) | ops-p99 6.017 (max 7.370) von 40.000; Think p99 0,245 ms; Arena-Tick p95 0,354 ms mit / 0,350 ms ohne KI (+1,4 %) | ops ✅, 0 Abbrüche ✅, Replay ✅, ±2 % (Bericht) ✅ |
| (c) SPK7-Analogon (beide KIs im Node-Worker, 3x, 3.000 Ticks) | **0 von 3.000 Ticks mit Warten (0,00 %)**, Worker-Think p99 1,06 ms, Ladezeit 110 ms, effektives Tempo 2,56x | < 1 % ✅ |

Das effektive Tempo von 2,56x statt 3,00x kommt von den Prozess-Einfrierungen der Maschine (§6.1). Main-Thread und
Worker stehen dabei gemeinsam, der Akkumulator ist auf 3 Ticks geklemmt, es entsteht also kein Warten auf `'pending'`.

## 7. Tests (Summen)

| Paket | Dateien | Tests | Laufzeit |
|---|---|---|---|
| `packages/ai/test` | 19 | 180 | – |
| `tools/ai-arena/test` | 27 | 190 | – |
| zusammen (`vitest run packages/ai tools/ai-arena`) | 46 | 370 | 9,7 s |
| davon Szenarien (`run scenarios`) | 7 | 28 | 3 s |
| gesamtes Repo (`pnpm test`) | 143 | 1.315 | 46 s |

Die ai.md-Test-IDs und ihr Ort:

| Test-IDs | Ort |
|---|---|
| AI-DET-01/03/04 | `test/host/determinism.test.ts` (Fixture-Brain und `createDefaultBrain`) |
| AI-DET-02, AI-PERC-01…03 | `test/scenarios/perception-determinism.test.ts`; Unit-Teile in `packages/ai/test` |
| AI-OPEN-01…05, AI-ECO-01/02/04/05, AI-ENG-02/04, AI-FAC-01, AI-DEF-01/03, AI-PLT-01 a/b/c, 02, 04, 05 | `test/scenarios/*.test.ts` |
| AI-ECO-03 (MS10-Vorgriff), AI-INT-02 | Unit-Tests in `packages/ai/test/managers` |
| AI-BUD-01 (Struktur) | `test/bench/bench.test.ts`; der volle Lauf ist `scripts/bench.ts` |
| AI-TECH-01, AI-ENG-01 | Turnier `ms9` |

## 8. Abweichungen (Arena ≠ Sim und weitere)

1. **Arena statt echter Sim:**
   - keine Projektile, kein Zielen/Drehen, konstanter DPS, Splash an bis zu 4 Feinde,
   - keine Kollisionen/Steering/Formationen, Strukturen blockieren keine Wege,
   - kein Radar und keine Blips, keine Wracks/Reclaim, keine Schilde als Mechanik, keine Adjacency außer dem Glutkranz,
   - ein Eco-Tier ohne Prioritäten/Pausen, Floats statt Fx,
   - Baustellen starten mit 10 % HP, Vogt-Tod zerstört die Army.

   Timings und Gates sind deshalb Vorab-Werte.
2. **Node-`worker_threads` statt Browser-Worker:** AI-DET-01 und das SPK7-Analogon laufen mit Node-Threads. Chromium,
   Firefox und WebKit folgen in MS9.
3. **M5 Pro statt Referenz-Laptop:** Think-Zeiten und Durchsatz sind lokale Werte. Das ai.md-Ziel „Normal p95 ≤ 8 ms“
   gilt auf dem Referenz-Laptop.
4. **Tessera als dritte 512-WU-Karte** der MS9-Turniere (ai.md §7.3 und §11 Punkt 5 lassen sie offen).
5. **`tools/ai-arena` statt `tools/headless/ai-tournament`:** dep-cruiser verbietet `ai → formats`, die Arena braucht
   formats für die Karten, und parallele Tracks ändern `tools/headless`.
6. **Ingest-Pauschale:** Der Perception-Ingest zählt außerhalb der Budget-Tabelle von ai.md §2.3 und wird nie
   abgeschnitten. `opsTotal` enthält ihn nicht, `ingestOps` weist ihn aus.
7. **Notabbruch-Uhr im Turnier:** Thread-CPU-Zeit (`process.threadCpuUsage`) statt Wall-Clock (Messung §6.1).
   - Grenze (200 ms) und Gate (0 aiTimeout) bleiben unverändert.
   - `--clock wall` bleibt verfügbar.
   - Die Benchmarks messen Think-Zeiten weiter mit der Wall-Clock.
   - Die Host-Tests AI-DET-01/03 schalten den Notabbruch ab (60 s), weil ein Abbruch den Strom laut ai.md §2.3 ändern
     darf und die Maschine sonst Tests kippt. AI-DET-04 prüft den Abbruch mit der echten 200-ms-Grenze und
     zusätzlich auf der Thread-CPU-Uhr (`test/host/clock.test.ts`).
8. **Turnierlänge 30 min** statt 45 min (ai.md §7.1, MS14), einstellbar mit `--minutes 45`.
9. **Energie-Stall** wird gepoolt als Bericht geführt (ai.md §7.1, R-G4). Basis-Zusammenbrüche im Spätspiel erzeugen
   Ausreißer über 10 % je Spiel (Pausieren von Verbrauchern kommt mit MS10/E13).
10. **`AiBrain.think` liefert `ThinkResult`** statt `EncodedCommand[]` (PLAN §3.10), Budget über `budgetScale`.
11. Weitere fachliche Auslegungen stehen je Paket in den Fragmenten: Stichel-Threat 37 statt 40, Staging-Punkt nach
    der Definition in §3, Tausch der Startmarker im Spiegel, Crash als Misserfolg, Dedup, Commit-Semantik.

## 9. Abschlusslauf und Reproduktion

**Abschlusslauf 2026-09-30:** streng sequenziell in einem Slot von `tools/heavy`, Stand dieses Dokuments.

| Schritt | Ergebnis | Dauer |
|---|---|---|
| `pnpm install --frozen-lockfile` | ✅ | < 1 s |
| `pnpm typecheck` | ✅ | inkrementell |
| `pnpm lint` (nach Übernahme des Ignore-Eintrags von main, s. u.) | ✅ eslint + dep-cruiser, 585 Module ohne Verstoß | 6 s |
| `pnpm exec vitest run packages/ai tools/ai-arena` | ✅ 46 Dateien / 370 Tests | 10 s |
| `pnpm test` | ✅ 143 Dateien / 1.315 Tests | 46 s |
| `pnpm --filter @faf/ai-arena run scenarios` | ✅ 7 / 28 | 3 s |
| `… run tournament -- --suite ms9 --workers 4` | ✅ bestanden (Werte §6.1) | 124 s |
| `… run tournament -- --suite diff --workers 4` | ✅ Bericht (Werte §6.1) | 79 s |
| `… run bench` | ✅ bestanden (Werte §6.3) | 121 s |
| Scope-Prüfung (`git status --porcelain` der fremden Pfade) | ✅ leer; `git diff tsconfig.json` = 2 References | – |

Zu `pnpm lint`: Der Branch `track-ai` basiert auf `2fc956c`. Dort fehlte der Ignore-Eintrag für
`docs/design/ui-mockups/**` (89 `no-undef`-Fehler in 5 statischen Mockup-Dateien), den `main` inzwischen hat
(`eslint.config.js`, Merge `b8f858b`). Die Integrationsrunde (Verify 1) hat genau diesen Hunk wortgleich aus `main`
übernommen, damit `pnpm lint` im Branch grün ist; beim Merge mit `main` entsteht dadurch kein Konflikt.

**Befehle** (aus dem Worktree-Root, schwere Läufe immer über das Gate):

```text
H=/Users/logge/Documents/Projects/flow-and-fire/tools/heavy
$H pnpm exec vitest run packages/ai tools/ai-arena          # alle KI-Tests (≈ 10 s)
$H pnpm --filter @faf/ai-arena run scenarios                  # ai.md-§9-Szenarien
$H pnpm --filter @faf/ai-arena run tournament -- --suite ms9 --workers 4      # MS9-Vorab-Gate, 210 Spiele
$H pnpm --filter @faf/ai-arena run tournament -- --suite diff --workers 4     # Bericht Easy/Normal/Hard
$H pnpm --filter @faf/ai-arena run tournament -- --suite ms9 --seeds 21 --maps setons --workers 0   # ein Spiel nachspielen
$H pnpm --filter @faf/ai-arena run tournament -- --suite ms9 --clock wall     # Notabbruch auf Wall-Clock
$H pnpm --filter @faf/ai-arena run bench [-- --quick]
$H pnpm --filter @faf/ai-arena run gates                      # ms9 + bench, Exit ≠ 0 bei Verstoß
$H pnpm --filter @faf/ai-arena run smoke -- --seeds 1,2,3     # Kalibrierung (tai-p5)
```

Berichte landen in `tools/ai-arena/results/<suite|bench>-<JJJJ-MM-TT-HHMM>.json` (git-ignoriert). Das Turnier schreibt
den Markdown-Bericht auf stdout oder mit `--md` in eine Datei.

## 10. Bekannte Grenzen und nächste Schritte

- Die Arena ist ein Modell: Die echten MS9-Gates misst `tools/headless` gegen die Sim auf dem Referenz-Laptop,
  AI-DET-01 zusätzlich im Chromium-Worker.
- **Schwierigkeitsabstand** (Bericht): Normal gegen Easy 62,5 %, Hard gegen Normal 55 %. Die MS14-Gates (≥ 65 %
  Untergrenze) brauchen Micro, Hard-Vorhersage und 45-min-Spiele.
- Viele Remis im Spiegel (113/210): Die Siegquote trennt wenig.
- Offen aus den Paketen:
  - `BuildShared` bleibt WeakMap-Unterzustand,
  - keine Fortschrittsrückmeldung von Produktionsanfragen,
  - abgelehnte Vogt-Schritte werden am Ende der Queue nachgeholt,
  - keine Wracks (MS11),
  - Basis-Zusammenbrüche enden im Dauer-Stall (MS10/E13).
- Die Budget-Zuteilungen von Engineer (5.000) und Intel (7.000) werden in großen Lagen voll ausgeschöpft (p99 je
  Manager = Zuteilung). Die Cursor-Fortsetzung greift wie vorgesehen; ai.md §2.3 bleibt die Referenz.
