# TRACK-AI · tai-p7-gates-docs – Skripte, Verifikation, Gates, Kalibrierung, Doku (Welle 3)

Stand: 2026-09-30 · Branch `track-ai` · Hauptdokument: [`track-ai.md`](track-ai.md)

Der im Auftrag genannte Worktree `/Users/logge/Documents/Projects/faf-ai` existiert nicht. Gearbeitet wurde in
`/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-ai`, nur in den owns-Pfaden.

## Umgesetzt

1. **Skripte** in `tools/ai-arena/package.json`:
   - `tournament` und `bench` (`node --import tsx scripts/….ts`),
   - `scenarios` (`vitest run --config ../../vitest.config.ts --root ../.. tools/ai-arena/test/scenarios`, also die
     Root-Config mit maxWorkers 4),
   - `smoke` (`src/scenarios/smoke.ts`),
   - `gates` (Turnier `ms9 --workers 4` und danach `bench`; Exit ≠ 0 bei jedem Verstoß).

   Neue Dependencies gibt es nicht, `pnpm install --frozen-lockfile` ist grün.
2. **Notabbruch-Uhr wählbar** (`tools/ai-arena/src/bench/clock.ts`, der erlaubte Uhren-Ort der Arena):
   - `HostClockKind = 'wall' | 'thread'`, `threadCpuClock` auf Basis von `process.threadCpuUsage`, `hostClock(kind)`,
     `threadCpuAvailable()`.
   - Durchgereicht über `AiSideOptions.clockKind` (sync) und `NodeAiWorkerOptions.clock` (per `workerData` an
     `worker-entry.ts` → `runAiWorker(…, {clock})`).
   - Im Turnier: `MatchJob.clock`/`GameRecord.clock` (Standard `thread`), `PlanOverrides.clock`,
     `planSuite(def, host, games, clock)`, CLI `--clock thread|wall`, Berichtsfeld `clock` und im Markdown
     „Notabbruch-Uhr“.
3. **Determinismus-Guard** erkennt jetzt auch `threadCpuUsage`/`cpuUsage` außerhalb der Uhren-Allowlist.
4. **Host-Tests mit `createDefaultBrain`** (`test/host/determinism.test.ts`, jetzt 10 Tests):
   - AI-DET-03 deterministisch: 2 Warterunden Verzögerung, genau 2 Warte-Polls je Think, gleicher Strom, Replay
     bitgleich.
   - AI-DET-03 echt: Worker-Thread blockiert 70 ms je 20. Think.
   - AI-DET-04 synchron mit ManualClock: Der Stall trifft den ersten Command-erzeugenden Schritt des echten
     PlatoonManagers ab 4:00.
     - Genau dessen `emitted` Commands landen als `aborted` in `dropped`, der Commit läuft nicht.
     - Der nächste Think läuft normal.
     - Bis zum Stall ist der Strom gleich dem ungestörten Spiel, das Replay ist bitgleich.
   - AI-DET-04 im Worker mit der echten 200-ms-Grenze.
   - Neue Fixtures in `test/host/fixtures/brains.ts`: `createLateDefaultBrain`,
     `createDefaultBrainWithPlatoonStall`, `createDefaultStallBrain`, `platoonStalls`, `spinCpuMs`,
     `createBusyStallBrain`.
5. **Stabilisierung der Host-Tests:**
   - AI-DET-01/03 laufen mit `timeoutMs: 60_000`. Ein Abbruch darf den Strom laut ai.md §2.3 ändern; der bestehende
     Test „70 ms blockieren“ war auf der belasteten Maschine rot (Stream-Hash im 2. Fenster), weil ein Einfrieren den
     Think über 200 ms schob.
   - AI-DET-04 behält die echte Grenze.
6. **Neuer Test** `test/host/clock.test.ts` (3 Tests): Die Thread-CPU-Uhr ignoriert Schlafen und zählt Rechnen. Sync-
   und Worker-Host brechen auf der Thread-Uhr bei 250 ms Rechnen ab, bei 250 ms Schlafen nicht; Replay bitgleich.
7. `tools/ai-arena/src/index.ts` exportiert jetzt auch `scenarios/` (offener Punkt aus tai-p6).
8. **Doku:**
   - `docs/status/track-ai.md` (Hauptdokument),
   - Abschnitt „Vorarbeits-Track TRACK-AI“ in `docs/STATUS.md` (angehängt),
   - Nachtrag mit 18 Entscheidungen in `docs/DECISIONS.md` (angehängt, nichts Bestehendes geändert).

## Tests (ai.md-IDs)

| Datei | Tests | IDs |
|---|---|---|
| `tools/ai-arena/test/host/determinism.test.ts` | 10 (+4) | AI-DET-01 (Fixture + Default), AI-DET-03 (je 2 × Fixture/Default), AI-DET-04 (je 2 × Fixture/Default) |
| `tools/ai-arena/test/host/clock.test.ts` | 3 (neu) | AI-DET-04 auf der Thread-CPU-Uhr |
| `tools/ai-arena/test/tournament/suites.test.ts` | 7 (erweitert) | `--clock`, Standard `thread` |
| `packages/ai/test/determinism-guard.test.ts` | 2 (erweitert) | ai.md §2.5 |

Gesamt `packages/ai` + `tools/ai-arena`: 46 Dateien, 370 Tests, 9,7 s. `pnpm test`: 143 Dateien, 1.315 Tests grün.

## Messwerte

Details stehen in `track-ai.md` §6.

- **Turnier `ms9`**: bestanden.
  - T2 207/210, Wilson [95,9 %; 99,5 %]; Welle 210/210 [98,2 %; 100 %].
  - Idle max 8,4 %, 0 Crashes, 0 aiTimeout.
  - APM-p99 120 von 120, ops-p99 14.764 von 24.000.
- **Turnier `diff`** (Bericht): Normal gegen Easy 62,5 % (+89 Elo), Hard gegen Normal 55,0 % (+35 Elo).
- **Bench**: Normal-Think p95 0,133 ms; Big Battle ops-p99 6.017, Δ Tick-p95 +1,4 %; SPK7 0 von 3.000 Ticks mit
  Warten.
- **Maschinen-Probe** (4 Threads, 120 s): Alle 15 s friert der ganze Prozess 2,99–3,08 s ein, bei 0,2–0,4 ms CPU.

## Kalibrierung

Brain und Arena brauchten keine Änderung: Alle Gates bestehen mit dem Stand von tai-p5. Der erste `ms9`-Lauf
(Wall-Clock) scheiterte nur am aiTimeout-Gate mit 12 Marken. Die Analyse der Ausreißerliste und Telemetrie ergab:
- Think-Maxima 340,4 ms in drei Workern gleichzeitig, 1.316,6 ms dreimal, 2,9–3,1 s,
- ops normal,
- beim Nachspiel der betroffenen Seeds 21/36/56/70 (8 Spiele, `--clock wall --workers 0`) 0 aiTimeout, Think-Maximum 5,0 ms.

Das spricht für Maschinen-Stillstände, nicht für KI-Arbeit, daher die Thread-CPU-Uhr. Keine Seed-Auswahl, keine
Gate-Absenkung, `ai.md`/`ai-openings.json` unverändert. Die Spielergebnisse beider Uhren sind identisch.

## Abweichungen

1. **Thread-CPU-Uhr im Turnier** (siehe oben, DECISIONS TRACK-AI Nr. 14). Browser und echte Sim behalten die
   Wall-Clock.
2. **`pnpm lint` auf dem Branch rot** (89 Fehler, nur `docs/design/ui-mockups/**`, Root-Konfiguration nicht in den
   owns). Mit dem Ignore-Eintrag von `main` ist der Lauf grün. Nach dem Merge verschwindet der Befund.
3. Das Skript `scenarios` setzt `--root ../..`, weil `pnpm --filter` im Paketordner startet und die Root-Config
   Pfade relativ zum Repo-Root erwartet.

## Bekannte Grenzen

- Die Wall-Clock-Variante des Turniers (`--clock wall`) bleibt auf dieser Maschine anfällig für Einfrierungen.
- Das effektive Tempo des SPK7-Analogons liegt bei 2,56x statt 3x (Einfrierungen; kein Warten auf `'pending'`).
- Alle weiteren Grenzen: `track-ai.md` §10.
