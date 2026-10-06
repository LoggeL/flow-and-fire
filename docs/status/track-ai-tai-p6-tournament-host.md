# TRACK-AI · tai-p6-tournament-host – AiHost/Worker-Protokoll, Node-Worker-Adapter, Turnier-Runner, Benchmarks

Stand: 2026-09-30 · Welle 2 (parallel zu tai-p5-integration) · Branch `track-ai`

Der Worktree liegt tatsächlich unter `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-ai`. Der im Auftrag genannte Pfad `/Users/logge/Documents/Projects/faf-ai` existiert nicht. Gearbeitet wurde nur in den owns-Pfaden dieses Pakets.

## Umgesetzt

| Ort | Dateien | Inhalt |
|---|---|---|
| `packages/ai/src/host/` | `clock.ts`, `ai-host.ts`, `protocol.ts`, `worker.ts`, `async-source.ts`, `index.ts` | Umgebungsneutraler KI-Host (weder DOM noch Node), Export `@faf/ai/host` |
| `tools/ai-arena/src/host-node/` | `brain-spec.ts`, `node-port.ts`, `node-worker.ts`, `worker-entry.ts`, `sides.ts`, `trail.ts`, `index.ts` | Node-`worker_threads`-Adapter, Brain-Spezifier, KI-Seiten mit Host-Schalter `sync`/`worker`, Hash-Trails |
| `tools/ai-arena/src/tournament/` | `types.ts`, `suites.ts`, `run-game.ts`, `worker.ts`, `run.ts`, `aggregate.ts`, `report.ts`, `cli.ts`, `index.ts` | Turnier-Runner: Pläne, ein Spiel je Job, Pool-Ausführung, Aggregation mit Wilson/Elo, Gates, Bericht, CLI |
| `tools/ai-arena/src/bench/` | `clock.ts`, `common.ts`, `think-time.ts`, `big-battle.ts`, `spk7.ts`, `run.ts`, `index.ts` | Benchmarks (Wall-Clock nur hier) |
| `tools/ai-arena/src/stats/` | `summary.ts` (neu), `index.ts` | `summarize` (n, Mittel, p50/p95/p99, max per Nearest Rank), `medianOrNull`, `shareAtMost` |
| `tools/ai-arena/scripts/` | `tournament.ts`, `bench.ts` | Einstiegsskripte |
| `tools/ai-arena/results/.gitignore` | – | ignoriert `*.json` und `*.md` (Berichte bleiben lokal) |
| `tools/ai-arena/src/index.ts` | – | exportiert zusätzlich `host-node`, `tournament` und `bench`; die bisherigen Exporte bleiben |

## Host-Protokoll und Adapter-Grenze (MS9)

### Bausteine in `@faf/ai/host`

- **`clock.ts`** ist die einzige Wall-Clock-Stelle des KI-Pakets. `AiClock { now() }`, `systemClock` nutzt `globalThis.performance?.now` und steht ohne `performance` auf 0 (dann gibt es nie einen Abbruch). `ManualClock` dient Tests. `AI_TIMEOUT_MS = { browser: 40, headless: 200 }`.
- **`AiHost`** (synchron) bekommt `{brain, static, profile, openings, gameSeed?, openingId?, maxMs?, env?, timeoutMs?, clock?, budgetScale?, onTimeout?}`.
  - `think(view)` bzw. `thinkBytes(bytes)` ruft `brain.think` mit `shouldAbort = now − start > Grenze` auf.
  - Das Ergebnis ist `HostThinkResult` = `ThinkResult` + `elapsedMs` + die Telemetrie seit dem letzten Think.
  - Bei `aborted` entsteht die Marke `AiTimeoutMark {kind: 'aiTimeout', tick, elapsedMs}`. Sie landet in `host.marks`, wird über `onTimeout` gemeldet (Vorlage für `MARK aiTimeout` im Recorder) und zusätzlich als Telemetrie `{kind: 'aiTimeout', tick}` geschrieben.
- **`SyncAiSource`** ist die synchrone `CommandSource` über einem `AiHost` für Headless, Arena und den Sim-Worker-Fallback. Sie denkt bei `N ≡ 0 (mod thinkEvery)` und liefert bei `N + lead`, nie `'pending'`. Für denselben Tick ist sie idempotent.
- **Worker-Protokoll `faf-ai-worker/1`** (`protocol.ts`):
  - Sim → Worker `init {protocol, static: AiStaticWire, profileName, gameSeed, openings (rohes ai-openings.json), brainSpec, openingId?, maxMs?, env?, timeoutMs?, budgetScale?}`. `AiStaticWire` ist `AiStatic` ohne Funktionen: Die Blueprint-Tabelle wird durch ihre Quelle ersetzt, heute `{kind: 'roster', roster}`, und im Worker per `bpTableFromRoster` identisch neu gebaut. `toAiStaticWire`/`fromAiStaticWire` wandeln hin und zurück.
  - Worker → Sim `ready {opening, managers, timeoutMs}`.
  - Sim → Worker `perceive {tick, bytes}`. `bytes` ist der Perception-Snapshot im PerceptionWriter-Layout und wird übertragen (transfer).
  - Worker → Sim `result {tick, batch (protocol encodeBatch, übertragen), aborted, ops, ingestOps, opsByManager, dropped, ms, telemetry}`.
  - Worker → Sim `error {tick, message}`. Sim → Worker `shutdown`.
  - Jede `perceive`-Nachricht bekommt genau ein `result`, in Reihenfolge. `parseAiToWorkerMessage`/`parseAiFromWorkerMessage` validieren.
- **`runAiWorker(port: MessagePortLike, brainFactory, {clock?})`** bedient das Protokoll auf einem beliebigen Port. Nachrichten laufen strikt in Ankunftsreihenfolge (Promise-Kette); `perceive` wartet auf das asynchrone Laden der Brain-Factory. Nach einem Fehler beantwortet der Worker jede weitere Anfrage mit `error`. `MessagePortLike {postMessage(m, transfer?), onMessage(h)}`; `eventTargetPort()` passt DOM-Ports an (Worker, MessagePort, `self`), ohne DOM-Typen.
- **`AsyncAiSource`** ist die simseitige `CommandSource` auf Basis von `PendingAiSource`.
  - Sie schickt `init` sofort. Bei Think-Tick N ruft sie `perceiveBytes(N)` auf und schickt `perceive`.
  - Bis das `result` für N eingetroffen ist, antwortet `commandsFor(t ≥ N + lead)` mit `'pending'`. Die Batches werden per `decodeBatch` dekodiert, Marken und Telemetrie gesammelt (`marks`, `telemetry`, `onResult`, `onTimeout`).
  - Für den aktuellen Tick ist sie idempotent: Wartet die Sim wegen einer ANDEREN Quelle, gehen keine Commands verloren.
  - Ein Worker-`error` oder eine kaputte Nachricht wirft beim nächsten `commandsFor`, statt ewig zu warten.

### Anschluss in MS9 (Browser)

- **AI-Worker:** Das Worker-Bundle ruft `runAiWorker(eventTargetPort(self), () => createDefaultBrain())` auf. Der Brain-Spezifier ist dort ein fester Name, weil es im Browser keinen dynamischen Modul-Import gibt.
- **Sim-Worker:** Je KI-Army baut er eine `AsyncAiSource` mit `port = eventTargetPort(MessagePort zum AI-Worker)`. `perceiveBytes` liefert das FrameWriter-Profil der eigenen Army; die Kopie wird übertragen. `onTimeout` schreibt `MARK aiTimeout`. Die Sim wartet bei `'pending'` (SP-Sim-Lag).
- **Fallback bei ≤ 2 Kernen:** Der Sim-Worker nutzt `AiHost` + `SyncAiSource` im eigenen Thread, mit identischem Command-Strom.
- **Noch zu ersetzen:** `BpTableSource {kind: 'roster'}` wird zum kompilierten Blueprint-Bundle (`BlueprintViewTable`). `AiStaticWire.sectors` ist heute `null` (Sektor-Graph ab MS9 aus nav). `systemClock` bleibt, `env: 'browser'` setzt 40 ms.

### Node-Adapter (`tools/ai-arena/src/host-node`)

- **Brain-Spezifier** `'modul#export'`, Standard `'@faf/ai#createDefaultBrain'`. Nackte Namen werden aus `@faf/ai-arena` aufgelöst, `file:`-URLs direkt, Pfade relativ zum cwd. `loadBrainFactory(spec)` cacht je Thread; jeder Aufruf der Factory liefert ein frisches Brain. `normalizeBrainSpec` macht aus Pfaden `file:`-URLs, damit Worker mit anderem cwd dasselbe Modul laden.
- **`NodeAiWorker`** startet `worker-entry.ts` über tsx (`tsxExecArgv()` aus `stats/pool.ts`) und stellt `port: MessagePortLike` bereit. Absturz oder unerwartetes Ende des Threads kommen als Protokoll-`error` an. `terminate()` ist idempotent.
- **`createAiSide(world, {army, profile, host: 'sync'|'worker', brainSpec?, brainFactory?, openingId?, maxMs?, env?, timeoutMs?, budgetScale?, clock?, gameSeed?})`** liefert `AiSide`:
  - `source`, `stats` (`SideStats`: ops, ingestOps, ms und Ticks je Think, ops je Manager, Abbrüche), `marks`, `telemetry`, `openingId()` und `close()`.
  - Beide Hosts bekommen dieselben Perception-Bytes (`ArenaPerceiver`) und dieselben Init-Daten.
  - Der Worker-Host verlangt `world.bps === getArenaBps()`, weil er die Tabelle aus roster.json neu baut. Matches mit Worker-Host laufen über `runMatchAsync`.
- **`commandTrail(log, endTick, 600)`** bildet xxHash32 je 600-Tick-Fenster über den angewandten Command-Strom inklusive Anwendungstick. `WorldHashTrail` nimmt den Welt-Hash vor jedem 600. Tick auf.

## Turnier-Runner

### CLI

```text
tools/heavy node --import tsx tools/ai-arena/scripts/tournament.ts [--suite ms9|diff|quick] [--games N]
     [--workers 0..4] [--maps a,b,c] [--seeds 1-105|1,5,9] [--host sync|worker] [--brain modul#export]
     [--minutes M | --max-ticks T] [--out datei.json|verzeichnis] [--md datei.md] [--no-json] [--quiet]
```

- Ein führendes `--` wird ignoriert (`pnpm run tournament -- …`). Auch `--key=wert` ist erlaubt.
- Exit-Code: 0 = alle blockierenden Gates grün, 1 = Gate-Verstoß, 2 = Aufruffehler, 3 = interner Fehler.
- Der Fortschritt läuft je Spiel über stderr (`--quiet`: nur Crashes). Der Markdown-Bericht geht auf stdout oder mit `--md` in eine Datei. Der JSON-Bericht landet in `tools/ai-arena/results/<suite>-<JJJJ-MM-TT-HHMM>.json`; das Datum trägt die Uhrzeit, damit mehrere Läufe am Tag nichts überschreiben.
- `--workers 0` führt die Spiele im Prozess nacheinander aus (Debugging).

### Suites (`suites.ts`)

| Suite | Paarungen | Seeds × Tausch × Karten | Spiele | Spielzeit | Gate-Modus |
|---|---|---|---|---|---|
| `ms9` | Normal-Spiegel | 1–105 × 2, Setons/Hollow Ridge/Tessera (je 70) | 210 | 30 min | `wilson` |
| `diff` | Normal gegen Easy, Hard gegen Normal | je 1–30 × 2 | 120 | 30 min | `report` |
| `quick` | Normal-Spiegel | 1–6 × 2 | 12 | 13 min | `point` |

- Seed s spielt `maps[s mod 3]`. Jeder Seed läuft zweimal direkt hintereinander.
- Im Spiegel ist die Stichprobe die Army mit der Parität des Seeds (ai.md §7.1), sonst die Army von Teilnehmer A (Prüfling: Normal bzw. Hard).
- Überschreibungen: `--maps`, `--seeds`, `--brain`, `--host`, `--minutes`/`--max-ticks`, `--games` (die ersten N Spiele des Plans).

### Datenmodell

- **`MatchJob`** (strukturiert klonbar): `{game, suite, pairing, mirror, seed, map, swapped, armyA, starts: [Start von Army 0, Start von Army 1], maxTicks, host, sampledArmy, sides: [{army, contestant 'A'|'B', label, profile, brain}] × 2}`.
- **`GameRecord`** enthält die Job-Felder und `{crash (null|Fehlertext), winner (−1 Remis), endTick, endReason, commands, sides: SideRecord[]}`.
- **`SideRecord`** enthält:
  - Eröffnung, besiegt, `t2Tick`, `firstWaveTick` (erster `waveAttack` mit `enemyHalf`, Think-Tick), Einheiten und Pflichtangriff der ersten Welle, Wellen, Rückzüge, `fac1Tick`, `mex8Tick`,
  - Idle-Engineer in % samt Rohzählern, Energie-Stall in % samt Rohzählern, Overflow, Mass-BP-Stall,
  - `apmWindows` (Command-Records je 60-s-Fenster), `apmMax`, `apmCap`,
  - Thinks, ops p50/p99/max, Budget, `opsByManager [{name, thinks, p99, max, budget}]`,
  - `aiTimeouts` und `timeoutTicks`, Think-ms p50/p95/max (nur Diagnose), produzierte und verlorene Einheiten, abgelehnte Commands.
- **`runGameJob(job)`** wirft nie; Fehler werden zum Crash-Record. **`runTournament(jobs, {workers, onGame})`** nutzt `runPool` (Worker-Modul `tournament/worker.ts`) und liefert einen Record je Job in Spielreihenfolge. Ein abgestürzter Pool-Worker wird zum Crash-Record des betroffenen Spiels.

### Aggregation und Gates (`aggregate.ts`)

- **Je Paarung:**
  - Siege, Remis und Niederlagen von A über die beendeten Spiele, Siegquote `(S + 0,5 R)/n` mit Wilson-95-%-Intervall und Elo `400 · log10(p/(1−p))` (nur Berichtszahl), zusätzlich je Karte,
  - Stichproben-Raten T2 ≤ 720 s und erste Welle ≤ 480 s (Anteil, Wilson-Intervall, Median und p90 in s, fehlende Ereignisse),
  - Energie-Stall gepoolt über die Stichproben-Seiten (Σ Stall-Ticks / Σ gezählte Ticks) und p90 der Spielwerte, Idle-Engineer über jede Seite jedes Spiels (Maximum, Mittel, Verstöße ≥ 15 %),
  - Aufschlüsselung je Karte und je Eröffnung der Stichproben-Seite: Siegquote, T2, Welle, Stall, Idle.
- **Je Profil:** Thinks, größtes p99 der ops je Seite, ops-Maximum, Budget, ops-p99 je Manager gegen die Zuteilung, aiTimeouts, APM-p99 über alle 60-s-Fenster aller Seiten mit Maximum und Cap, Think-ms.
- **Gates:**
  - In jedem Modus blockierend: `crash` = 0, `aiTimeout` = 0, `apm:<profil>` (p99 ≤ Cap), `ops:<profil>` (p99 ≤ Gesamtbudget).
  - Je Paarung `t2:<id>` und `wave:<id>`: im Modus `wilson` untere Grenze ≥ 0,90, im Modus `point` Punktschätzung ≥ 0,90, im Modus `report` nicht blockierend (Bewertung nach Wilson).
  - `idle:<id>` (jede Seite < 15 %) blockiert außer im Modus `report`.
  - `stall:<id>` (gepoolt ≤ 5 %, MS10-Ziel) ist immer nur Bericht.
- **Ausreißer:** Crash, T2 > 12:00 (oder kein T2, obwohl das Spiel länger als 12 min lief), Stall > 10 %, Idle ≥ 15 % und aiTimeout, je mit Spiel, Seed, Karte, Tausch, Army und Nachspiel-Argumenten (`--suite … --seeds s --maps m`).

### Berichtsformat

- **JSON** (`TOURNAMENT_SCHEMA = 'faf-ai-arena/tournament/1'`):
  - Kopf: `{schema, note (Arena-Hinweis), suite, description, gateMode, maps, maxTicks, host, brains, meta {generatedAt, wallSeconds, workers, command}}`,
  - Auswertung: `games, crashes, crashList, pairings[], budgets[], gates[], outliers[], passed`,
  - `records[]` mit allen `GameRecord`s (ms9 ≈ 1,1 MB).
- **Markdown:** Gate-Tabelle, Paarungen, Siegquote je Karte, Stichprobe je Karte und je Eröffnung, Budget/APM/Think-Zeit je Profil, ops je Manager, Ausreißer (höchstens 50, der Rest steht im JSON).

## Benchmarks

```text
tools/heavy node --import tsx tools/ai-arena/scripts/bench.ts [--quick] [--brain modul#export] [--out datei|verzeichnis] [--no-json]
```

Der Standardlauf dauert 104 s, `--quick` 21 s. Das JSON geht nach `results/bench[-quick]-<datum>.json`, die Tabellen auf stdout. Exit 1 bei einem Verstoß gegen ein blockierendes Gate.

- **(a) Think-Zeit je Schwierigkeit:** KI gegen KI desselben Profils, synchrone Hosts, Setons 1v1, 15 min (quick 5 min). Gemessen werden p50/p95/p99/max ms je Think über beide Seiten, ops je Think und je Manager gegen die Zuteilung sowie Abbrüche. Gates: ops-p99 ≤ Budget, 0 Abbrüche, Replay bitgleich. Normal p95 ≤ 8 ms ist nur Bericht (Ziel auf dem Referenz-Laptop).
- **(b) Big Battle 2 × 300** (AI-BUD-01-Analogon): Per Cheat werden je Seite 150 Panzer, 100 Bots und 50 Artillerie gespawnt, 30 WU vor der Kartenmitte gegenüber; Hard, 1.200 Ticks (quick 300). Gates: ops-p99 ≤ 40.000, 0 Abbrüche, Replay bitgleich. Der Arena-Tick-p95 „mit KI“ (nur `world.step`, die KI denkt im selben Thread dazwischen) wird mit dem Replay derselben Trajektorie ohne KI verglichen, nur als Bericht.
- **(c) SPK7-Analogon:** Beide KIs laufen im Node-Worker (`AsyncAiSource`), der Scheduler im Hauptthread arbeitet in Echtzeit bei 3x: 33,3 ms je Tick, Akkumulator auf 3 Ticks geklemmt, höchstens 3 Ticks je Slice, Wiederholung eines `'pending'`-Ticks in der nächsten Event-Loop-Runde. Der Lauf umfasst 3.000 Ticks (quick 600) und startet erst nach `ready` beider Worker (Ladephase). Gate: Anteil der Ticks mit Warten < 1 %. Berichtet werden Wartezeit p50/p95/max, effektives Tempo, Step- und Worker-Think-Zeiten.
- **(d) Durchsatz:** Ticks/s mit KI (Think + Perception + Step) und Ticks/s der Arena allein (Replay), aus (a).

## Tests (`tools/ai-arena/test/{host,tournament,bench,stats}`)

| Datei | Inhalt | ai.md-ID |
|---|---|---|
| `host/protocol.test.ts` | AiStatic-Wire-Roundtrip über `structuredClone`, Nachrichtenvalidierung, Notabbruch 40/200 ms mit ManualClock (Marke + Telemetrie), In-Process-Worker über MessageChannel = synchroner Host, `'pending'` bis zum Ergebnis, Worker-Fehler wird geworfen, `'pending'`-Semantik mit Fake-Port (Ergebnisse nach Tick zugeordnet, nicht angeforderter Think ist Fehler) | AI-DET-03 (Unit) |
| `host/determinism.test.ts` | Setons, Seed 7, KI gegen KI 10 min: synchron = Node-Worker (Command-Hash je 600 Ticks, Welt-Hash-Trail, End-Hash), mit Fixture-Brain **und** `createDefaultBrain` | AI-DET-01-Analogon |
| | Späte Antwort (a) deterministisch: jedes `result` 2 Warte-Runden zu spät ⇒ genau 2 Wartevorgänge je Think, Strom = synchron, Replay bitgleich; (b) echter Worker-Thread blockiert 70 ms je 20. Think (2 Ticks bei 3x) | AI-DET-03 |
| | Notabbruch mitten in einem Platoon-Schritt: synchron mit injizierter Uhr (250 ms > 200 ms ⇒ Abbruch, 150 ms ⇒ kein Abbruch, Schritt nie übernommen, nächster Think normal) und Worker mit echter 200-ms-Grenze; Replay bitgleich | AI-DET-04 |
| `tournament/aggregate.test.ts` | Wilson-Schwelle n = 200 (189 besteht, 188 nicht), Punkt-/Wilson-/Bericht-Modus, Stichprobe nach Seed-Parität, Crash und fehlendes Ereignis zählen als Misserfolg, Crash/aiTimeout/APM-p99/ops-p99 blockieren immer, Idle in jedem Spiel, Stall gepoolt, Siegquote/Elo je Paarung und Karte, Aufschlüsselung je Karte und Eröffnung, Ausreißerliste, JSON- und Markdown-Bericht mit `passed` | §7.1/§7.2 |
| `tournament/suites.test.ts` | Pläne 210/120/12, 70 bzw. 20 Spiele je Karte, Start- bzw. Army-Tausch, Stichproben-Army, Überschreibungen, Pool-Größe (≤ 4, Worker-Host ≤ 2), CLI inklusive führendem `--` und Fehlerfällen | §7.3 |
| `tournament/mini.test.ts` | Mini-Turnier mit 4 Spielen à 3 min über den Pool (Fixture-Brain), gleiches Ergebnis wie im Prozess, nicht ladbares Brain wird Crash-Record, Skript-Exit-Code 1 bei Gate-Verstoß und 2 bei Aufruffehler | – |
| `bench/bench.test.ts` | Mini-Läufe von (a), (b) und (c) mit Fixture-Brain, Gates und Rendering, Mix-Verteilung, Quick-Konfiguration | AI-BUD-01 (Struktur) |
| `stats/summary.test.ts`, `stats/stats.test.ts`, `stats/pool.test.ts` | Zusammenfassungen, Wilson/Elo/Perzentil/Plan und Pool (tai-p1) | – |

Die Tests nutzen das gescriptete Fixture-Brain `test/host/fixtures/brains.ts` (`createBrain` mit eigenen Managern: Fabrik, Mex/Kraftwerke, Fabrik-Schleife, Attack-Move ab 6 Einheiten; dazu Varianten `createLateBrain` und `createStallBrain`). AI-DET-01 läuft zusätzlich mit `createDefaultBrain`. Laufzeit aller vier Ordner: ca. 10 s.

## Messwerte (Apple M5 Pro, Node 24.18, Arena statt echter Sim, `createDefaultBrain` Stand 30.09.2026 04:30)

Die Werte hängen vom Brain ab, das tai-p5 parallel kalibriert. tai-p7 wiederholt die Läufe.

**Turnier `ms9`** (210 Spiele, 4 Worker, 105 s): **bestanden**.

| Messgröße | Wert |
|---|---|
| T2 ≤ 12:00 | 206/210 = 98,1 %, Wilson [95,2 %; 99,3 %] |
| Erste Welle ≤ 8:00 | 210/210, Wilson-Untergrenze 98,2 % |
| Idle-Engineer | max 9,7 %, Mittel 1,2 % |
| Energie-Stall gepoolt | 2,90 % (p90 je Spiel 11,5 %) |
| aiTimeout / Crashes | 0 / 0 |
| APM-p99 | 120 (Cap 120) |
| ops-p99 je Seite | max 14.907 von 24.000 |
| Think-Zeit | p95 max 0,66 ms |
| Ergebnis (A–Remis–B) | 43–109–58, Elo −25 (Spiegel, Remis = Zeitlimit) |
| je Eröffnung | eco_standard T2-Median 8:02, land_rush 9:44 (4 Ausreißer auf Hollow Ridge), tech_greed 6:43 |

**Turnier `diff`** (120 Spiele, 55 s, Bericht):

| Paarung | Siegquote A [Wilson] | Elo A−B |
|---|---|---|
| Normal gegen Easy | 65,0 % [52,4 %; 75,8 %] | +108 |
| Hard gegen Normal | 58,3 % [45,7 %; 69,9 %] | +58 |

APM-p99: Easy 40 (Cap 40), Hard 178 (Cap 300). ops-p99 Easy 9.345 von 12.000. Keine Timeouts.

**Turnier `quick`** (12 Spiele, 3 s): bestanden. T2 11/12, Welle 12/12.

**Benchmarks** (Standardlauf, 104 s): alle Gates grün.

| Teil | Messwerte |
|---|---|
| (a) Think-Zeit Easy | p50/p95/p99 0,110/0,268/0,612 ms, ops-p99 3.030 |
| (a) Think-Zeit Normal | 0,083/0,167/0,339 ms, ops-p99 2.726 |
| (a) Think-Zeit Hard | 0,063/0,143/0,329 ms, ops-p99 2.078 |
| (d) Durchsatz | mit KI ≈ 12.000–14.000 Ticks/s, Arena allein ≈ 24.000–26.000 Ticks/s |
| (b) Big Battle 2 × 300 | ops-p99 6.017 von 40.000 (max 7.370), 0 Abbrüche, Think p99 0,63 ms; Arena-Tick p95 0,418 ms mit gegen 0,376 ms ohne KI (+11 %, siehe Grenzen) |
| (c) SPK7-Analogon | 0 von 3.000 Ticks mit Warten (0,00 %), effektiv 3,00x, Worker-Think p99 1,6 ms, Ladezeit 101 ms |

## Entscheidungen und Abweichungen

1. **Tausch im Spiegel:** In Spiegel-Paarungen tauscht das zweite Spiel eines Seeds die **Startmarker** der Armies (`starts = [1, 0]`), nicht die Teilnehmer. Zwei identische, deterministische Teilnehmer zu tauschen spielt exakt dasselbe Spiel noch einmal; die zwei Stichproben eines Seeds wären dann identisch und die Wilson-Grenze zu optimistisch, also genau der Fehler, den ai.md §7.1 ausschließen will. Die Stichprobe bleibt die Army mit der Parität des Seeds. Außerhalb des Spiegels spielt A im zweiten Spiel Army 1 an Start 1.
2. **Crash oder fehlendes Ereignis zählt als Misserfolg** in den Raten-Gates: n = alle Spiele der Paarung. Das ist konservativ, auch wenn ein Spiel vor 12 min durch einen Vogt-Tod endet.
3. **ops-Gate:** geprüft wird das größte p99 je Seite gegen das Gesamtbudget. Liegt jede Seite mit p99 unter dem Budget, liegt auch das gepoolte p99 darunter. Das Gate ist also mindestens so streng wie „ops-p99 ≤ Budget“, ohne 1,4 Mio. Einzelwerte zu übertragen. ops je Manager werden nur berichtet: Reserve-Entnahmen werden dem entnehmenden Manager zugerechnet, eine Überschreitung der Zuteilung ist also kein Budgetbruch.
4. **Idle-Gate** gilt für jede Seite jedes Spiels („in jedem Spiel“), nicht nur für die Stichprobe.
5. **Gate-Modi:** `quick` bewertet die Punktschätzung, weil bei n = 12 die Wilson-Untergrenze 0,90 nicht erreichbar ist. `diff` ist Bericht für T2, Welle und Idle; Crash, aiTimeout, APM und ops blockieren nach ai.md §7.2 auch dort.
6. **Pool-Größe:** Standard sind 4 Threads. Mit `--host worker` startet jedes Spiel zwei zusätzliche KI-Threads, deshalb laufen dann höchstens 2 Spiele parallel (6 Threads).
7. **AI-DET-03 zweifach:** Die deterministische Variante hält jedes Ergebnis zwei Warte-Runden zurück; die Echtzeit-Variante lässt einen echten Thread 70 ms blockieren, das sind 2 Ticks bei 3x.
8. **Big-Battle-Vergleich mit und ohne KI** ist nur Bericht. Im Arena-Prozess denkt die KI im selben Thread zwischen den Steps (Cache-Effekte, Sub-Millisekunden-Rauschen); das Gate „±2 %“ aus AI-BUD-01 gilt für die echte Sim mit KI im eigenen Worker.
9. **Dateiname der Berichte** mit Uhrzeit (`<suite>-JJJJ-MM-TT-HHMM.json`). `results/.gitignore` ignoriert zusätzlich `*.md`.
10. **Wall-Clock:** Datum und Laufzeit ermitteln nur die Skripte (`scripts/**`, außerhalb des Determinismus-Guards) und `bench/**`. `tournament/**` liest keine Uhr.

## Offene Punkte für Folgepakete (tai-p7)

- `tools/ai-arena/package.json` liegt nicht in meinen owns. Die Skripte `"tournament": "node --import tsx scripts/tournament.ts"` und `"bench": "node --import tsx scripts/bench.ts"` fehlen dort noch, damit `pnpm --filter @faf/ai-arena run tournament -- …` und das Root-`pnpm bench` sie finden. Die Skripte ignorieren ein führendes `--`.
- `tools/ai-arena/src/index.ts` exportiert `scenarios/` (tai-p5) bewusst nicht, weil es parallel entsteht. tai-p7 kann den Export ergänzen.
- Zum Zeitpunkt meiner Läufe meldete dep-cruiser zwei Zyklen außerhalb meiner Pfade: `world/hash.ts ↔ world/world.ts` sowie `managers/engineer/placement.ts ↔ spots.ts`. `tsc -b` meldete Fehler nur in den tai-p5-Probedateien `src/scenarios/_probe*.ts` und `_dem.ts`.

## Bekannte Grenzen

- Alle Werte stammen aus der Arena (Headless-Test-Sim) und sind als solche markiert. Die echten Gates misst MS9 mit der Sim und `tools/headless` auf dem Referenz-Laptop.
- Die Think-Zeiten gelten für den M5 Pro unter Node, das SPK7-Analogon für Node-`worker_threads` statt Browser-Worker. Die Browser-Messung (AI-DET-01 im Chromium-Worker, SPK7 im Browser) bleibt MS6/MS9.
- In 30-min-Spielen der Arena enden viele Spiegel-Spiele remis (109/210). Die Siegquote im Spiegel ist deshalb wenig trennscharf, die Gates messen Timings.
- Das Zeitlimit der Turniere ist 30 min (TRACK-AI-Vorgabe); ai.md §7.3 nennt 45 min für MS14-Turniere, einstellbar über `--minutes 45`.
