# P5-sim-host – `@faf/sim-host`: Worker, Scheduler, CommandSources, Command-Log (OPFS), Keyframes, Headless (MS1, Welle 3)

Feature-IDs: **S4** (Scheduler, Pause/Speed/Step, Sim-Lag), **S7** (Command-Log-Recorder, Replay, Hash-Kette),
**A5** (Pause: Tick steht, Command-Annahme läuft weiter), Teile **G14** (FrameTransport im Host, SAB/Transfer bytegleich).

Abhängigkeiten von `src/`: `@faf/sim`, `@faf/protocol`, `@faf/fixed`, `@faf/blueprints/simbin` (nur Typ). Kein
`pnpm install` nötig (tsx war bereits devDependency), `pnpm-lock.yaml` unverändert. Der Host gehört nicht zum
Sim-State: `performance.now`, `MessageChannel`, `setTimeout`, `Date`, `Math.random` (OPFS-Dateiname) kommen nur hier
vor und fließen nie in die Sim.

## Umgesetzt

| Datei | Inhalt |
|---|---|
| `src/clock.ts` | `Clock` (`now()`, Standard `performanceClock`), `Wakeup` (`schedule/cancel/dispose`), `MessageChannelWakeup`: MessageChannel-Selbstping; lange Wartezeiten (> 8 ms) schlafen einmal grob auf **einem** Timer bis 4 ms vor der Frist, der präzise Rest läuft über Selbstpings (siehe Abweichung 1). |
| `src/scheduler.ts` | `Scheduler(target, {clock, wakeup, maxTicksPerSlice=3, maxBacklogTicks=3, pendingRetryMs=1, speedPermille, paused})`. Akkumulator, Takt 100 ms / speed (250–3000 ‰, geklemmt), ≤ 3 Ticks pro Slice, Sim-Lag wie FA (Rückstand > 3 Ticks wird verworfen ⇒ `lostTicks`, `ticksBehind` 0–3), `pause/resume/step(n)/setSpeedPermille/wake`, `'pending'` ⇒ Retry nach 1 ms (`waitingForSource`, `pendingWaits`). Pausenzeit wird nicht akkumuliert (kein Burst nach Resume). Wirft ein Tick, pausiert der Scheduler und meldet `failed`. |
| `src/sources.ts` | `TickSource extends protocol.CommandSource` (+ allokationsfrei `pending(tick)`, `batchFor(tick)`), `BatchBuilder` (verkettet Envelopes mehrerer Batches, u16-Grenze), `LocalSource` (sammelt `cmd`-Batches, Doppelpuffer, alles bis zum nächsten Tick gilt in genau diesem Tick), `ReplaySource` (aus geparstem Log; Cursor, Rücksprung per Binärsuche, `expectedHash(tick)`). |
| `src/log-format.ts` | Log-Format (unten), `parseCommandLog`, `parseLogHeader`, `encodeLogHeader`, `MarkKind`, `LogEntryKind`, `isTaintMark`, `CommandLogError`. |
| `src/recorder.ts` | `CommandLogRecorder(header, {initialCapacity, flushEveryEntries})`: `commands(tick, batch)` (Op.Cheat im Batch ⇒ zusätzlich MARK cheat), `mark`, `hash`, `export(endTick)` (Kopie + END, Live-Log läuft weiter), `truncateAfter(tick)`, `attachSink/detachSink/flush/close`, `storage` (`memory`/`opfs`), `sinkError`. Anhängen ohne Allokation (außer Puffer-Verdopplung). |
| `src/opfs.ts` | `OpfsLogSink` (Sync-Access-Handle, `write(…, {at})` mit wiederverwendetem Options-Objekt), `opfsRoot()` (`navigator.storage.getDirectory`, sonst null), `openOpfsLogSink(root, {simId, keep=5})` (Ordner `faf-logs/`, Datei `log-<UTC-Zeitstempel ms>-<simId>-<zufall>.faflog`, löscht die ältesten bis auf 5, gesperrte Dateien anderer Tabs bleiben), `listLogFiles`, `readLogFile` (Crash-Recovery). Strukturelle Typen ⇒ testbar mit Fake. |
| `src/keyframes.ts` | `KeyframeStore(snapshotBytes, {intervalTicks=600, maxBytes=128 MiB})`: Arena-Snapshots (memcpy in wiederverwendete Puffer), `maybeCapture/capture/latestAtOrBefore/restoreInto/discardAfter`; voll ⇒ jeden zweiten Keyframe verwerfen (erster bleibt), Intervall verdoppeln (adaptiv, PLAN §3.11). |
| `src/stats.ts` | `PhaseStats(window=256)` (Ringpuffer je Metrik, Perzentile per Sortierung in Scratch-Puffer), `TimingProbe` (sim-`PhaseProbe` mit Host-Uhr; misst zusätzlich den ganzen Step = CommandApply-Begin bis Output-Ende), Metriken 0 = Step, 1–16 Phasen, 17 HashTick, 18 Frame, 19 Host. |
| `src/identity.ts` | `SIM_BUILD = 'faf-sim/ms1.1'`, `MOD_LIST = []`, `testPlaneMapSimHash(size)` = xxHash32(`faf-map:testplane:v1:size=<n>`), `simIdOf(bpSimHash, size)`. |
| `src/core.ts` | `SimCore`: gemeinsame Tick-Pipeline von Worker und Headless: Quellen (bei `'pending'` kein Tick) → Merge → `setBatchTick(t)` → Recorder → `sim.step` (Probe) → Hash-Eintrag + Trail → Keyframe. `restoreSnapshot` (Zeitlinie verzweigt: Trail/Log/Keyframes danach verworfen, MARK restore), `seek(tick)` (Keyframe + Nachsimulieren mit dem eigenen Log; danach Replay-Modus mit Hash-Verifikation bis zum Ende der aufgezeichneten Zeitlinie, dann wieder live), `mismatches`, `onHash`. |
| `src/host.ts` | `SimHost` (engine-neutral, auch Node) – siehe API. |
| `src/worker.ts` | Worker-Entry (`@faf/sim-host/worker`): `startSimWorker(scope, options)` bindet einen `SimHost` an den Worker-Scope (oder einen beliebigen Port); startet sich selbst nur, wenn das Modul in einem `DedicatedWorkerGlobalScope` läuft. Uncaught Errors/Rejections ⇒ `error`. |
| `src/headless.ts` | `HeadlessSim` (Node/Tests ohne Worker und Uhr): `submit(batch | envelopes)`, `step(n)`, `runUntil`, `hashTrail()`, `hashChain()`, `ruleHash/fullHash`, `snapshot/restore`, `seek`, `exportLog`, `replay(log)`; `replayLog(log, {simBin|bpTable, untilTick?})` ⇒ `{trail, mismatches, compared, ruleHash, fullHash, sim}` (prüft simId und layoutHash). |
| `bench/tick.ts` | Skript `bench` (`node --expose-gc --import tsx bench/tick.ts [--ticks N --warmup M]`). |

### API für apps/game (P7) und Tools

```ts
// Worker (Main-Thread-Seite baut P7):
const worker = new Worker(new URL('@faf/sim-host/worker', import.meta.url), { type: 'module' });
worker.postMessage({ t: 'init', simBin, seed, armyCount: 2, playerArmy: 0,
  transport: crossOriginIsolated ? 'sab' : 'transfer', frameSab /* nur sab */,
  frameCapacity: frameCapacityBytes(DEFAULT_FRAME_CAPS), buildHash, startPaused /* optional, ?autostart=0 */ },
  [simBin]);
// Transfer-Transport: FrameConsumer auf dem Worker-Objekt (createTransferConsumer(worker, cap)).
// danach: {t:'cmd', batch} (transferiert), ctl-Nachrichten; Antworten ready/status/stats/log/error.

// Node / Tests / Tools:
const host = new SimHost({ post, port?, clock?, wakeup?, opfs?: null, keyframes?, statsWindow?, autoStart?: false });
host.init(init); host.submit(batch); host.ctl({ t: 'pause' }); host.runTicks(n); host.core.hashTrail();
const sim = new HeadlessSim({ simBin | bpTable, seed, armyCount: 2 }); sim.submit(envs); sim.step(2000);
replayLog(sim.exportLog(), { bpTable }).mismatches;   // [] ⇔ Replay bitgleich
```

**Host-Verhalten:**

- `init` ⇒ `ready` (`simId` = `computeSimId(SIM_BUILD, sim.bin-simHash, mapSimHash der Testebene, [])`, `layoutHash`,
  `transport`, zusätzlich `simBuild`, `bpSimHash`, `mapSimHash`, `seed`, `tick`), sofort ein Frame für Tick 0,
  `status`, Scheduler-Start (außer `startPaused: true`), OPFS-Öffnen asynchron (danach erneut `status`).
- `cmd` ⇒ `LocalSource`; gilt im nächsten Tick, der läuft – **auch während der Pause** (dann im nächsten `step`
  bzw. nach `resume`). Der Anwendungs-Tick wird in die Envelopes gestempelt und so aufgezeichnet.
- Pro Slice **ein** Frame (bei 3 Ticks/Slice nur der letzte): Viewer aus `ctl.viewer` (Start = `playerArmy`),
  `seq` = Host-Frame-Zähler, `tickTimeUs` = gemessene Step-Dauer, `speedPermille`, paused-Bit.
  `ctl.debug` Bit 0 (`DebugFlags.PhaseTimes`) hängt die Debug-Sektion an: `u16 kind=1 | u16 count=20 |
  u32[20]` µs des letzten Ticks je Metrik (0 Step, 1–16 Phasen, 17 HashTick, 18 Frame, 19 Host).
- `pause` ⇒ MARK, Log-Flush, **letzter Zustand sofort mit paused-Bit neu publiziert**; `resume` ebenso ohne Bit;
  `speed`/`viewer`/`debug` publizieren während der Pause sofort neu. Beim Transfer-Transport wird ein wegen leerem
  Puffer-Pool verworfener Pause-Frame erneut gesendet, sobald ein Puffer zurückkommt.
- `step` nur in der Pause (sonst ignoriert), läuft mit ≤ 3 Ticks pro Slice ohne Wartezeit.
- `stats` alle 10 Ticks: `tickP50Us/tickP95Us/hashTickP95Us/phases[{id,name,p50Us,p95Us}]` (aktive Phasen,
  HashTick, Frame, Host) + `tick`, `tickP99Us`, `hashTickP50Us`, `frameP95Us`, `samples`; Fenster 256 Ticks.
- `status` bei Zustandswechsel (Pause, Resume, Speed, Ende einer Step-Folge, Wechsel von `ticksBehind`/Warten,
  Recorder-Speicherort, devReload): `tick, paused, speed, ticksBehind` + `recorder` (`opfs`|`memory`),
  `recorderNote` (z. B. „OPFS unavailable: memory only“), `tainted`, `lostTicks`, `waiting`, `framesDropped`,
  `logBytes`.
- `exportLog` ⇒ `{t:'log', bytes}` (ArrayBuffer transferiert; Log mit END-Eintrag). `watch` speichert ≤ 64 Handles
  (`host.watched`), `devReload` ⇒ MARK (Taint).
- Fehler (ungültige Nachricht, kaputter Batch, `cmd` vor `init`, doppeltes `init`, zu kleine `frameCapacity`,
  Exception im Tick) ⇒ `{t:'error', message}`; der Host bleibt benutzbar, bei Tick-Exception pausiert er.
  `frameReturn`-Nachrichten des Transports werden ignoriert.

## Command-Log-Format (Version 1, little-endian)

Header (`headerBytes` = 32 + buildHash-Länge, auf 4 B aufgefüllt):

| Off | Feld | Off | Feld |
|---|---|---|---|
| 0 | magic u32 `'FAFL'` (0x4C464146) | 20 | bpSimHash u32 |
| 4 | version u16 (1) | 24 | mapSizeWu u16 |
| 6 | headerBytes u16 | 26 | armyCount u8 |
| 8 | simId u32 | 27 | playerArmy i8 |
| 12 | layoutHash u32 | 28 | hashInterval u16 (10) |
| 16 | seed u32 | 30 | buildHash-Länge u16, ab 32 UTF-8 |

Einträge (16-B-Kopf + Daten, auf 4 B aufgefüllt, tick-geordnet):
`u8 kind | u8 sub | u16 aux | u32 tick | u32 dataLength | u32 check`, `check` = xxHash32(Daten, Seed =
`tick ^ (kind<<24 | sub<<16 | aux)`).

| kind | Inhalt |
|---|---|
| 1 CMDS | Command-Batch wie angewendet (Envelope-Ticks = Anwendungs-Tick); ein Eintrag pro Tick (alle Quellen gemergt) |
| 2 MARK | `sub` = 1 pause, 2 resume, 3 speed (Wert ‰), 4 cheat, 5 devReload, 6 step (Wert n), 7 restore; Daten u32 Wert. **Taint:** cheat, devReload, restore |
| 3 HASH | u32 Regel-Hash des Ticks (alle 10 Ticks) |
| 4 END | keine Daten; letzter simulierter Tick (nur im Export) |

Der Parser schneidet einen zerrissenen/korrupten Schwanz (unvollständiger Eintrag, falscher `check`, unbekannte Art,
Tick rückwärts) ab (`truncated = true`) – alles davor bleibt abspielbar (Crash-Fall im OPFS). `lastTick` = END-Tick,
sonst größter Eintrags-Tick. Das `.rtsreplay`-Chunk-Format (PLAN §3.11: HEAD/GAME/CMDS à 600 Ticks deflate/…) entsteht
in MS11 im Paket `formats` aus diesem Log.

**Persistenz:** Im Worker legt der Host `faf-logs/log-….faflog` im OPFS an (`createSyncAccessHandle`), schreibt den
bis dahin im Speicher aufgezeichneten Anfang und hängt danach jeden Eintrag sofort an (Flush alle 64 Einträge und bei
Pause/Export/Dispose). Es bleiben die letzten 5 Logs. Ohne OPFS (Node, verweigerter Speicher, Schreibfehler) läuft der
Log nur im Speicher weiter; `status.recorder = 'memory'` mit Begründung in `recorderNote`.

## Tests (`pnpm vitest run packages/sim-host`: 7 Dateien, 50 Tests grün, ≈ 12 s)

| Datei | Inhalt |
|---|---|
| `scheduler.test.ts` | Fake-Uhr: Takt bei 0,25/1/3x (25/100/300 Ticks in 10 s, nie > 1 Tick/Slice im Soll), erster Tick nach einer Periode, **max. 3 Ticks/Slice** nach 1-s-Freeze (6 statt 10 Ticks, 4 verworfen), **Sim-Lag** (150 ms/Tick ⇒ ≈ 1 Tick/150 ms, `ticksBehind` 1–3, danach Erholung auf 10 Hz), **Pause** (keine Wake-ups, Tick steht), `step(7)` = 3+3+1 in der Pause, Resume ohne Burst, Speed-Wechsel/Klemmung, **`'pending'`-Quelle** (Warten, Fortsetzen), Exception ⇒ Pause + Fehler; echte Uhr: MessageChannel-Wakeup nie zu früh (Verspätung < 25 ms als großzügige Grenze für belastete Maschinen), Scheduler 3x in Echtzeit (12–16 Ticks in 520 ms). |
| `recorder.test.ts` | Roundtrip Header (UTF-8-buildHash)/CMDS/MARK/HASH/END, Taint-Regeln, Tick-Ordnung, zerrissener und korrupter Schwanz, `truncateAfter`, Anhängen ohne Puffer-Wechsel; **OPFS-Fake**: Anfang beim Attach, Anhängen blockweise, Crash-Lesen ohne END, Truncate, **nur die letzten 5 Logs** (gesperrte Datei bleibt), Dateinamen chronologisch, Schreibfehler ⇒ Memory-Fallback; LocalSource (Merge aller Batches vor einem Tick, View bleibt gültig, kaputter Batch abgelehnt), BatchBuilder-Wachstum, ReplaySource (Ticks, Rücksprung, erwartete Hashes). |
| `l4-replay.test.ts` | **L4 Log-Replay:** 2.000 Ticks, 1.000 Würfel (900 + 100), Commands an 11 verschiedenen Ticks (Moves von Teilgruppen, Stop, Kill + Respawn, Befehl an fremde Einheiten) ⇒ `replayLog` liefert **identische Hash-Kette (200 Hashes, 0 Abweichungen)** und gleiche End-Regel-/Voll-Hashes; Neu-Aufnahme des Replays bytegleich (CMDS + HASH); explizite `ReplaySource` mit sim.bin-Bytes; **Desync-Erkennung** (manipuliertes Move-Ziel bei Tick 1.100 ⇒ erste Abweichung genau bei 1.100); fremde simId abgelehnt. **L4 Arena-Restore:** Snapshot bei Tick 1.000 in frische Sim ⇒ **gleicher Regel- und Voll-Hash bei 2.000**, Kette 1.010–2.000 gleich, MARK restore; Restore in die abgewichene Original-Sim (Zeitlinien-Zweig) ⇒ gleiche Hashes und Log. **Keyframe-Seek:** Keyframes 0/600/1.200/1.800, `seek` auf 1.000/300/1.900/600/1.500/100 ⇒ Voll-/Regel-Hash == Direktlauf, danach Nachsimulieren bis 2.000 == Direktlauf, dann live weiter; Keyframe-Ausdünnung hält das Byte-Budget, jeder behaltene Keyframe stellt den richtigen Zustand her. |
| `host.test.ts` | SimHost mit Fake-Uhr/SAB: ready/simId/Tick-0-Frame/status, 10 Hz + stats alle 10 Ticks, **Pause (A5)**: paused-Bit sofort, Tick steht 3 s, Move während der Pause angenommen (queued), `step 1` ⇒ genau ein Tick, Command dort angewendet (ackSeq, Envelope-Tick 11 im Log), Resume ⇒ Würfel fahren, MARKs pause/step/resume; Step im Lauf ignoriert, Speed 3x/0,25x (Rate, Header, MARK); `startPaused`; viewer/debug (PhaseTimes-Sektion)/watch; exportLog ⇒ Replay == Host-Trail; Fehler als Nachrichten; OPFS-Persistenz (Datei == Log) bzw. Memory-Fallback mit Begründung; Transfer: verworfener Pause-Frame wird nachgeliefert. |
| `transport.test.ts` | **SAB- und Transfer-Transport** (Node-`MessageChannel`) liefern für denselben Lauf (200 Ticks, 1.000 Würfel, Pause/Viewer/Resume dazwischen) **204 bytegleiche Frames**, 0 verworfene Frames. |
| `worker.test.ts` | `startSimWorker` an einem Node-MessagePort (echte Uhr, Selbstping, Transfer): init ⇒ ready, speed 3, cmd ⇒ 10 Würfel im Frame mit ackSeq, pause ⇒ status, exportLog ⇒ Log mit CMDS + MARKs, ungültige Nachricht ⇒ error. |
| `alloc.test.ts` | **Allokation** des kompletten Host-Tick-Pfads (Quellen, Recorder, Step inkl. Hash, Keyframes, Probe, Frame, SAB) mit 1.000 fahrenden Würfeln und neuen Zielen alle 100 Ticks. |

## Messwerte (lokal gemessen, Apple M5 Pro, Node 24.18 – nicht Referenz-Laptop)

`pnpm --filter @faf/sim-host bench` (10.000 Ticks nach 1.000 Aufwärm-Ticks, 1.000 Würfel, alle 20 Ticks neues Ziel
für eine von 10 Gruppen ⇒ Ø 950 fahrend; gemessen über den echten Host-Pfad inkl. Recorder und SAB-Frame;
JSON: `packages/sim-host/bench/results/node-2026-09-28.json`):

| Metrik | p50 | p95 | p99 | max |
|---|---|---|---|---|
| **Sim-Step gesamt (inkl. Hash-Tick)** | 0,461 ms | **0,503 ms** | 0,523 ms | 1,055 ms |
| CommandApply | 0,000 ms | 0,002 ms | 0,005 ms | 0,029 ms |
| Orders | 0,013 ms | 0,013 ms | 0,015 ms | 0,038 ms |
| Movement | 0,421 ms | 0,449 ms | 0,464 ms | 1,017 ms |
| SpatialRebuild | 0,024 ms | 0,029 ms | 0,035 ms | 0,055 ms |
| Cleanup | 0,001 ms | 0,002 ms | 0,002 ms | 0,025 ms |
| Output | 0,000 ms | 0,040 ms | 0,045 ms | 0,467 ms |
| HashTick (nur Hash-Ticks, 1.000 Proben) | 0,040 ms | 0,047 ms | 0,057 ms | 0,096 ms |
| Frame (writeFrame + SAB-Commit) | 0,057 ms | 0,062 ms | 0,067 ms | 0,111 ms |
| Host-Overhead (Quellen, Recorder, Keyframes) | 0,000 ms | 0,002 ms | 0,007 ms | 0,282 ms |

Tabelle = Lauf auf ruhiger Maschine. Zwei Wiederholungen, während parallel P6 Browser-Benchmarks lief (Load ≈ 3),
ergaben Step-p95 1,19 ms bzw. 0,99 ms (p99 2,39/1,13 ms, HashTick p95 0,12 ms); die eingecheckte JSON-Datei
stammt aus dem letzten dieser belasteten Läufe (wird bei jedem Lauf pro Datum überschrieben).

**Ziel MS1 „Sim p95 ≤ 2 ms inkl. Hash-Tick“ in Node: erfüllt (0,50 ms ruhig, ≤ 1,19 ms unter Last).** Die Browser-Worker (langsamste Engine)
misst P6/P7. Wandzeit 0,67 ms pro Tick inkl. Messung, Frame und Konsument.

**Allokation** (`alloc.test.ts`, unter Vitest): warm **≈ 148 KiB Heap-Zuwachs über 10.000 Ticks** (Grenze 1 MB);
kalt (Host-Erzeugung + erste 1.000 Ticks) ≈ 1,0 MiB, Toleranz 8 MiB. ArrayBuffer-Zuwachs ≈ 23,6 MiB = 17 Keyframes à
1,42 MiB (Nutzdaten, außerhalb des JS-Heaps). Log nach 12.000 Ticks: 532 KB (überwiegend Move-Batches mit je 100 Handles alle 100 Ticks).

## Verträge für Folgepakete

- **P7 (apps/game):** Worker wie oben; SimLink: `sendCommands(batch)` ⇒ `{t:'cmd', batch}` mit Transfer,
  `sendCtl(msg)` ⇒ `postMessage(msg)`; `onHostMessage` bekommt auch die Zusatzfelder (`HostReadyMsg`,
  `HostStatusMsg`, `HostStatsMsg` aus `@faf/sim-host` – nur Typen importieren, Client importiert sim-host nicht).
  `?autostart=0` ⇒ `startPaused: true` im init. Budget-Overlay aus `stats.phases`. Export-Download aus `log.bytes`.
  Frame-Hashes für den SAB/Transfer-Vergleich im Browser müssen `tickTimeUs` (Header-Offset 16) und die
  Debug-Sektion ausklammern (echte Uhr ⇒ nicht deterministisch); mit `startPaused` und `step` sind alle anderen
  Bytes identisch (hier in Node belegt).
- **Replay-Verifikation / Tools:** `replayLog(bytes, {simBin})` bzw. `HeadlessSim`; bei Abweichung liefert
  `mismatches[0].tick` den ersten abweichenden Hash-Tick.
- **KI (MS6):** eigene `TickSource` mit `pending(tick)`; `SimCoreOptions.sources` bzw. Scheduler-`wake()`.

## Abweichungen (mit Begründung)

1. **Wake-up-Hybrid:** Default ist der MessageChannel-Selbstping (präzise, keine 4-ms-Klemmung). Wartezeiten > 8 ms
   schlafen zuvor einmal grob auf *einem* `setTimeout` bis 4 ms vor der Frist – sonst würde der Worker zwischen zwei
   Ticks (100 ms) einen Kern zu 100 % auslasten. Das ist kein Timer-Polling; `coarseSleepAboveMs: Infinity` schaltet
   auf reinen Selbstping.
2. **Ein Frame pro Slice** statt pro Tick: Bei Aufholen (≤ 3 Ticks) sieht der Client ohnehin nur den neuesten Frame
   (Triple-Buffer); spart Frame-Arbeit und schont den Transfer-Pool.
3. **Log-Format als Append-Stream** (`FAFL`, Einträge mit Prüfwert) statt direkt `.rtsreplay`-Chunks: crashsicheres
   Anhängen pro Block ohne Umschreiben; ein Eintrag pro Tick (keine 600-Tick-Blöcke/Kompression – das macht der
   Replay-Export in MS11). Hash nur Regel-Hash alle 10 Ticks, keine Sub-Hashes alle 100 Ticks.
4. **Cheat-Commands tainten** das Log (MARK cheat); in MS1 ist damit jedes Spiel mit Spawn-Cheat „tainted“ – die
   Replay-Prüfung selbst ist davon unberührt.
5. **Zusatzfelder in `ready`/`status`/`stats`** und **`startPaused` im init** (strukturell, protocol bleibt
   unverändert): Recorder-Zustand, Lag, Identität, `?autostart=0` ohne Race zwischen init und pause.
6. **Keyframes unkomprimiert** (PLAN: „komprimiert“): `CompressionStream` ist asynchron; bei 1,4 MiB pro Keyframe und
   128-MiB-Grenze reicht das für ≥ 90 Keyframes (1,5 h Spielzeit), danach Ausdünnung. Kompression folgt mit dem
   Replay-Viewer (MS11).
7. **`restoreSnapshot` verzweigt die Zeitlinie** (Trail/Log/Keyframes nach dem Tick verworfen, ältere Keyframes
   ebenfalls, MARK restore): Ein fremder Snapshot hat keine gültige Vorgeschichte; `seek` dagegen bleibt in der
   aufgezeichneten Zeitlinie und prüft beim Nachsimulieren die Hashes.
8. **`SIM_BUILD` als Konstante** in `identity.ts` (`faf-sim/ms1.1`); `mapSimHash` der Testebene = Hash ihrer
   kanonischen Beschreibung (es gibt noch keine statischen Kartendaten).
9. `bench`-Skript beendet sich mit Exit-Code 1, wenn das MS1-Budget (p95 ≤ 2 ms) gerissen wird.

## Bekannte Grenzen

- Worker-Entry ist in Node über einen `MessagePort` getestet; der echte Browser-Worker (Vite-Bundle, OPFS in
  Chromium/Firefox/WebKit) wird erst in P7 per E2E geprüft. OPFS ist in Node nur per Fake getestet.
- `watch` wird nur gespeichert – die Watch-Sektion im Frame gibt es im protocol-Layout noch nicht.
- Der Transfer-Pfad allokiert pro Frame (P1-Grenze); der Allokationstest nutzt den SAB-Pfad.
- Stats-Nachrichten allokieren (alle 10 Ticks ein kleines Objekt); das Messen selbst ist allokationsfrei.
- Kein `visibilitychange`-Handling im Worker (Main-Thread-Sache, P7 sendet pause/resume).
- `pnpm lint` meldet weiterhin nur Fremdfehler (`.claude/workflows/faf-milestone.js` – Orchestrator-Skript – und
  zum Zeitpunkt des Laufs `tools/headless/scripts/_try.ts` aus dem parallel arbeitenden P6); `eslint packages/sim-host`
  und dependency-cruiser für sim-host sind grün.

Selbsttest: `pnpm vitest run packages/sim-host` (50/50 grün), `pnpm --filter @faf/sim-host bench` (PASS),
`pnpm typecheck` grün, `eslint --max-warnings 0 packages/sim-host` grün, dependency-cruiser ohne Verstöße.
