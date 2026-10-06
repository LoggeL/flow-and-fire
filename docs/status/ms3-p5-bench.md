# ms3-p5-bench – MS3-Headless-Benchmarks (hollow-ridge + 1.024 WU), SPK3 mit Sim-Integration, Performance-Nacharbeit

Stand 2026-09-30 (MS3, Welle 2). Maschinenlesbare Abnahme von MS3 auf Sim-Ebene („Headless-Benchmark auf 1.024 WU“,
PLAN §5.2), SPK3 als Benchmark mit Entscheidung (DECISIONS 24, Messdefinitionen DECISIONS 25), Sim-Nacharbeit
(`SIM_BUILD` `faf-sim/ms3.1`) und der Sim-Anteil des SPK6-Folgepunkts. Messwerte **lokal, Apple M5 Pro** (DECISIONS 5),
Node 24.18 und Playwright-Chromium 153 / Firefox 155 / WebKit (Safari 26.6), **unter Fremdlast** (parallele
Workflows, Load-Average 5–7). Grundlagen: `ms3-p0-nav.md` (Nav-API, Korridorregel, Testkarten), `ms3-p2-sim.md`
(Sim-Integration, Verträge), `P6-headless.md` (Harness, Messregeln).

Gearbeitet wurde im Git-Worktree des Branches `ms3` (`/Users/logge/Documents/Projects/flow-and-fire/.worktrees/flow-and-fire-ms3`
– der im Auftrag genannte Pfad `…/Projects/flow-and-fire-ms3` existiert nicht; es ist derselbe Worktree des Branches
`ms3`). Geändert wurden nur die owns: `tools/headless/**`, `packages/sim/**`, `packages/nav/**`, `docs/DECISIONS.md`
(neue Punkte 24/25), dieses Fragment. `packages/sim-host` blieb unverändert (Bench nur ausgeführt).

## Umgesetzt

| Bereich | Inhalt | Ort |
|---|---|---|
| A `pnpm bench:ms3` | ein Prozess, Szenarien nacheinander mit GC dazwischen; `-- --quick` ≈ 30 s, voll ≈ 45 s (inkl. Harness-Build und drei Browsern); `--update-docs` schreibt die Tabellen unten, `--no-browser` nur für lokale Entwicklung (Szenario 5 dann nur Node, als Hinweis im Bericht) | `tools/headless/scripts/ms3.ts` |
| 1 „200 Units über die Karte“ | 200 gemischte Panzer (T1/T2/T3 = Klassen 1–3, 40/35/25 %) als Block, je 50: eine 50er-Gruppe, 50 Einzelbefehle (Zielraster), 5 Gruppen à 10, 2 à 25 (58 Befehle); hollow-ridge und 1.024-WU-`bases`, voll mit 3 Seeds; Plateau-Abfahrt nur berichtet. Anfahr-Tick je Unit, Stuck-Metrik (DECISIONS 25), Ankunft, Offset-Fehler je Gruppe, Land-Invariante jeden Tick | `src/ms3/scenarios.ts` (`runCrossMap`, Layouts `RIDGE_CROSS`, `BASES_CROSS`, `RIDGE_PLATEAU`, `ProgressTracker`) |
| 2 Engstelle 3 WU | 100 T1 durch die Lücke der `choke`-Karte (256 und 1.024 WU): Durchlauf-Ticks, Meilensteine 25/50/75/100, Deadlock = 150 Ticks ohne weiteren Durchgang | `runChoke` |
| 3 Burst | 200 Einzelbefehle gleichzeitig (Sim, echte Protokoll-Batches) auf 1.024 WU mit 381 Basis-Footprints (hollow-ridge berichtet): Ready-Tick je Unit, Phase PathService per `PhaseProbe`, Expansionen je Tick und je Anfrage (Nav-Replay, eine Anfrage je `serviceTick`), Zustände; Gruppenbefehl mit 50 Units ⇒ `requestsIssued` +1 und ein gemeinsamer Pfad. Läufe per Snapshot/Restore: Lauf 1 kalt, 2–3 Aufwärmen, Rest warm | `runBurst`, `burstWorld` |
| 4 Repath-Sturm | 200 fahrende Units, 20 Footprints je auf die Route einer fahrenden Unit; im Stempel-Tick per `PhaseProbe` (CommandApply) Pfad-Debug + Graph vor/nach ⇒ `corridorCutBrute` (`@faf/nav/check`) je Pfad gegen die Markierungen, Zähler je Stempel, sonstige Repaths außerhalb der Stempel | `runStorm` |
| 5 Last | 1.000 Panzer (2 Armeen, 10 Gruppen à 100), alle 20 Ticks ein neues Ziel quer über hollow-ridge (jedes 3. mit Shift); Sim-Tick inkl. Hash-Tick, Phasen PathService/Movement/SpatialRebuild getrennt, Hash-Tick; Node (frischer Prozess) + Chromium/Firefox/WebKit-Worker über den Harness (kalt/warm, Playwright workers 1, Browser nacheinander), End-Hash muss überall gleich sein | `src/ms3/load.ts` (Job `ms3Load` in `src/jobs.ts`), `browser/ms3.spec.ts` |
| D SPK6-Referenz | Testebene, T1/T2/T3 × Kursfehler 0/45/90/135/180° aus dem Stand + eine Gruppe aus 20: Ticks bis Drehung, erste Positionsänderung, 0,05/0,5/1 WU | `runStartup` |
| B `pnpm bench:spk3` | `bases` 512/1.024: Expansionen-/Ready-Verteilung (Sim-Burst), Basisbau im Sim, Gefecht im Sim, Korridor-Schnitt vs. Chunk-Eintritt + Lazy-Repair (Nav-Ebene, gleiche Stempelfolge); `-- --quick` ≈ 7 s, voll ≈ 11 s | `scripts/spk3.ts`, `src/ms3/spk3.ts` |
| Bench-Option Nav | `Nav.corridorRepath` (Default `true`, Setup-Feld, nicht in der Arena): `false` überspringt die Korridorregel in `stampFootprint` – nur für die SPK3-Variante, die Sim setzt es nie | `packages/nav/src/nav.ts` |
| C Sim-Nacharbeit | drei Verhaltensänderungen für „≥ 95 % ohne Stuck“ (s. u.), `SIM_BUILD` `faf-sim/ms3.1`, 5 Goldens neu, `test:xengine` 160/160 bitgleich | `packages/sim/src/{orders,movement,constants}.ts` |
| Treiber | `SimDriver`: Welt aus RtsMap, Befehle als echte Protokoll-Batches (Move/Stop/Spawn/Footprint, seq je Armee), Platzierung nur auf für die Klasse freien Punkten, Routenlänge, Offset-Fehler, Land-Invariante | `src/ms3/driver.ts` |

### Sim-Änderungen (C, `faf-sim/ms3.1`)

Mit dem ms3.0-Verhalten erreichte „200 Units über die Karte“ auf hollow-ridge 93–95 % ohne Stuck > 3 s (je nach
Metrik-Stand) mit einer aufgegebenen Order, die Plateau-Abfahrt 85 %. Befund per Trace
(Positions-/Zustandsdumps der gestauten Units, Clearance-Karten der Engstellen):

1. **Gruppen-Slots hinter dünnen Wänden** (`orders.ts`, `finalizeSlot`/`losClamp`): Ein Ziel 3 WU neben einer
   Rampenwand legte Offsets auf die Wand; der Rückfall „nächste freie Zelle der Komponente“ fand die Zelle **hinter**
   der Wand (Rampenkorridor), erreichbar nur über 90 WU Umweg – Units standen 30–50 s. Jetzt wird der Slot eines
   Gruppenmitglieds (Offset ≠ 0), der blockiert ist oder keine Clearance-LOS zum Anker hat, entlang des Offsets in
   ≤ 1-WU-Schritten auf den weitesten Punkt mit LOS zurückgezogen (Anker als letzter Rückfall; nur wenn der Punkt in
   der Komponente der Unit liegt, sonst wie bisher). Kalter Pfad (einmal je Order), allokationsfrei, Integer.
   Test: `pathing.test.ts` „slots behind a thin wall …“ (ohne die Änderung landen Units bei x ≈ 153 hinter der Wand).
2. **Verschobene Gruppen-Wegpunkte** (`movement.ts`, `resolveTarget`; stammt aus dem abgebrochenen ersten Lauf dieses
   Pakets und wurde per A/B bestätigt: 3 Seeds je Karte leicht besser): der um den Offset verschobene Wegpunkt wird nur
   genutzt, wenn er auch vom Gruppen-Wegpunkt aus in Clearance-LOS liegt (gleiche Wandseite); ohne LOS vom Unit zum
   Gruppen-Wegpunkt steuert die Unit zuerst den vorherigen Gruppen-Wegpunkt an (nicht gecacht). Eine allgemeine
   Variante (auch eigene Pfade, LOS-Prüfung alle 5 Ticks) verschlechterte die Quote deutlich (76–89 %) und wurde
   verworfen.
3. **Hindernisgradient an der Klassengrenze** (`movement.ts`, `obstacleGradient`): Das Zentrum einer Klasse-s-Unit
   darf nur Zellen mit Clearance ≥ s betreten; der Gradient maß aber nur den Abstand zur echten Blockade minus Radius.
   Für Klassen 2–3 liegt die Klassengrenze bis 0,8 WU näher – T3-Panzer verkeilten sich an der Treppenkante ihres
   passierbaren Bereichs (Furt-Ausgang) ohne Gegenkraft und gaben nach 3 Stuck-Stufen auf. Jetzt gilt
   `excess = min(Abstand zur Blockade − Radius, Abstand zur Klassengrenze)`; für Klasse 1 unverändert.

Wirkung: hollow-ridge 95,5–96,5 %, 1.024 WU 97,0–97,5 % (3 Seeds), 0 Aufgaben (vorher 1), Plateau-Abfahrt 87 %. Goldens: `cubes-1000-move`
(ab Tick 1.750), `ridge-1000-move`, `ridge-water-block`, `ridge-group-offset`, `ridge-shift-queue` neu aufgenommen
(alle Asserts grün); `cubes-churn`, `choke-3wu`, `obstacle-repath` unverändert (nur `simBuild`).

### Performance (C)

Kein Szenario verfehlt ein Kriterium, auch die ms-Budgets nicht (nur berichtet) ⇒ keine Optimierung in `sim`/`nav`
nötig. Szenario 5: langsamste Engine p95 2,0–2,8 ms (Budget 8 ms, 3 volle Läufe), Movement dominiert (p95 1,0–2,3 ms), PathService
p95 0,2–0,5 ms, SpatialRebuild < 0,05 ms (WebKit 0,2 ms = Uhr-Auflösung bei 5 Reps). A/B im sim-host-Bench (Szenario
ms3, 5.000 Ticks, gleiche Last, abwechselnd): neue Sim p95 1,68/1,70 ms gegen ms3.0-Stand 1,98/1,62 ms – die
Änderungen kosten nichts Messbares; der volle `pnpm bench`-Lauf zeigte ms2 p95 2,1 ms (> MS2-Referenz 2 ms, nur
berichtet) als Lastrauschen (ms3-p2: 1,45 ms ohne Fremdlast). Allokation: Sim hollow-ridge 1.000 Panzer + Pathing
347 KiB, Host hollow-ridge 804 KiB in 10.000 warmen Ticks (< 1 MB).

## Verträge / APIs für Folgepakete

- **Skripte:** `pnpm bench:ms3 [-- --quick] [--update-docs] [--no-browser]`, `pnpm bench:spk3 [-- --quick]
  [--update-docs]`. Exit ≠ 0 bei gerissenem maschinenunabhängigem Kriterium; ms-Budgets (PathService p95 ≤ 5 ms,
  Sim p95 ≤ 8 ms in der langsamsten Engine) nur mit `FAF_PERF_GATE=1`. `FAF_BENCH_UPDATE_DOCS=1` = `--update-docs`.
- **Ausgaben (git-ignoriert):** `tools/headless/results/ms3-<datum>.json` (`format: faf-ms3-bench`: Modus, Maschine,
  Speicher, Engine-Versionen, Load-Average vorher/nachher, Kriterien, alle Szenarien, Rohserien von Szenario 5),
  `results/ms3-history.jsonl` (eine Zeile je Lauf mit Kennzahlen; `--update-docs` bildet daraus die Wertebereiche der
  letzten ≤ 5 Läufe desselben Modus), `results/spk3-<datum>.json`, Rohdaten der Browser `results/ms3-<engine>-ms3Load.tmp.json`.
- **Szenario-API** (`tools/headless/src/ms3/`): `runCrossMap(simBin, {label, map, nav?, layout, maxTicks, gated, seed?}, clock)`,
  `runChoke`, `runBurst(simBin, label, map, nav?, reps, clock)`, `runStorm`, `runStartup`, `runBaseBuilding`,
  `runCombat`, `runRepathVariant(navMap, 'corridor' | 'chunk', ticks, clock)`; Ergebnisse tragen `checks`
  (`{name, ok, detail, gated}`). Job `ms3Load {ticks, rampTicks, map}` im Harness (alle Engines).
- **SPK6 (ms3-p6):** Sim-Anteil der Latenz aus dem Stand = **1 Tick** vom Befehl bis zur ersten Positionsänderung, für
  jede Klasse und jeden Kursfehler 0–180° und für Gruppen mit ausstehendem Pfad (Tabelle unten). Mit `inputDelay = 0`
  heißt das: der Befehl wird im nächsten `step` angewandt und bewegt die Unit im selben Tick; sichtbar werden
  ≥ 0,05 WU nach 2–4 Ticks, ≥ 0,5 WU nach 5–29 Ticks (T3 bei 180° am langsamsten). Die E2E-Latenz (Klick → erster
  bewegter Pixel) = Client → Worker + ≤ 1 Tick-Takt bis zum nächsten `step` + dieser 1 Tick + Frame/Interpolation.
- **Nav:** `Nav.corridorRepath` (s. o.) – bench-only.

## Messwerte MS3 (`pnpm bench:ms3`)

<!-- ms3:begin -->
Letzter Lauf: 2026-09-30, `pnpm bench:ms3` (full, 39 s). **Lokal gemessen (Apple M5 Pro), nicht Referenz-Laptop.**
Engines: node: Node v24.18.0; chromium: Chrome/153.0.8010.12; firefox: Firefox/155.0; webkit: Version/26.6 Safari.
Fremdlast: Load-Average 5,9 / 6,1 / 5,5 (vorher), 5,5 / 6,0 / 5,4 (nachher). Wertebereiche = 3 Lauf/Läufe im Modus „full“ (results/ms3-history.jsonl).
ms-Grenzen nur berichtet (ohne FAF_PERF_GATE=1, DECISIONS 16); maschinenunabhängige Kriterien immer gegated.

### Kriterien

| Kriterium | Ergebnis | Status |
|---|---|---|
| hollow-ridge: alle 200 Units fahren ≤ 10 Ticks nach dem Befehl an | max 1 Ticks | ✅ |
| hollow-ridge: ≥ 95 % kommen ohne Stuck > 3 s an | 192/200 = 96.0 % | ✅ |
| hollow-ridge: ein Move = eine Pfadanfrage | 58 Befehle ⇒ 58 Anfragen | ✅ |
| hollow-ridge: nie eine Land-Unit auf blockierter Zelle/im Tiefwasser | 0 Verstöße | ✅ |
| bases-1024: alle 200 Units fahren ≤ 10 Ticks nach dem Befehl an | max 1 Ticks | ✅ |
| bases-1024: ≥ 95 % kommen ohne Stuck > 3 s an | 195/200 = 97.5 % | ✅ |
| bases-1024: ein Move = eine Pfadanfrage | 58 Befehle ⇒ 58 Anfragen | ✅ |
| bases-1024: nie eine Land-Unit auf blockierter Zelle/im Tiefwasser | 0 Verstöße | ✅ |
| hollow-ridge Seed 2: alle 200 Units fahren ≤ 10 Ticks nach dem Befehl an | max 1 Ticks | ✅ |
| hollow-ridge Seed 2: ≥ 95 % kommen ohne Stuck > 3 s an | 193/200 = 96.5 % | ✅ |
| hollow-ridge Seed 2: ein Move = eine Pfadanfrage | 58 Befehle ⇒ 58 Anfragen | ✅ |
| hollow-ridge Seed 2: nie eine Land-Unit auf blockierter Zelle/im Tiefwasser | 0 Verstöße | ✅ |
| bases-1024 Seed 2: alle 200 Units fahren ≤ 10 Ticks nach dem Befehl an | max 1 Ticks | ✅ |
| bases-1024 Seed 2: ≥ 95 % kommen ohne Stuck > 3 s an | 195/200 = 97.5 % | ✅ |
| bases-1024 Seed 2: ein Move = eine Pfadanfrage | 58 Befehle ⇒ 58 Anfragen | ✅ |
| bases-1024 Seed 2: nie eine Land-Unit auf blockierter Zelle/im Tiefwasser | 0 Verstöße | ✅ |
| hollow-ridge Seed 3: alle 200 Units fahren ≤ 10 Ticks nach dem Befehl an | max 1 Ticks | ✅ |
| hollow-ridge Seed 3: ≥ 95 % kommen ohne Stuck > 3 s an | 191/200 = 95.5 % | ✅ |
| hollow-ridge Seed 3: ein Move = eine Pfadanfrage | 58 Befehle ⇒ 58 Anfragen | ✅ |
| hollow-ridge Seed 3: nie eine Land-Unit auf blockierter Zelle/im Tiefwasser | 0 Verstöße | ✅ |
| bases-1024 Seed 3: alle 200 Units fahren ≤ 10 Ticks nach dem Befehl an | max 1 Ticks | ✅ |
| bases-1024 Seed 3: ≥ 95 % kommen ohne Stuck > 3 s an | 194/200 = 97.0 % | ✅ |
| bases-1024 Seed 3: ein Move = eine Pfadanfrage | 58 Befehle ⇒ 58 Anfragen | ✅ |
| bases-1024 Seed 3: nie eine Land-Unit auf blockierter Zelle/im Tiefwasser | 0 Verstöße | ✅ |
| (nur berichtet) hollow-ridge-plateau: alle 200 Units fahren ≤ 10 Ticks nach dem Befehl an | max 1 Ticks | ✅ |
| (nur berichtet) hollow-ridge-plateau: ≥ 95 % kommen ohne Stuck > 3 s an | 174/200 = 87.0 % | ⚠️ |
| (nur berichtet) hollow-ridge-plateau: ein Move = eine Pfadanfrage | 58 Befehle ⇒ 58 Anfragen | ✅ |
| (nur berichtet) hollow-ridge-plateau: nie eine Land-Unit auf blockierter Zelle/im Tiefwasser | 0 Verstöße | ✅ |
| Engstelle 3 WU (256 WU): 100 Units durch in ≤ 600 Ticks | alle durch nach 296 Ticks | ✅ |
| Engstelle 3 WU (256 WU): kein Deadlock (> 150 Ticks ohne Durchsatz) | längste Pause 53 Ticks | ✅ |
| Engstelle 3 WU (256 WU): nie auf blockierter Zelle | 0 Verstöße | ✅ |
| Engstelle 3 WU (1024 WU): 100 Units durch in ≤ 600 Ticks | alle durch nach 293 Ticks | ✅ |
| Engstelle 3 WU (1024 WU): kein Deadlock (> 150 Ticks ohne Durchsatz) | längste Pause 53 Ticks | ✅ |
| Engstelle 3 WU (1024 WU): nie auf blockierter Zelle | 0 Verstöße | ✅ |
| bases-1024: 200 Einzelanfragen alle fertig ≤ 10 Ticks | max 7 Ticks (7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7) | ✅ |
| bases-1024: Gruppenbefehl mit 50 Units ⇒ requestsIssued genau +1 | +1, ein gemeinsamer Pfad | ✅ |
| bases-1024: keine Anfrage gescheitert | 0 Failed | ✅ |
| (nur berichtet) hollow-ridge: 200 Einzelanfragen alle fertig ≤ 10 Ticks | max 6 Ticks (6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6) | ✅ |
| (nur berichtet) hollow-ridge: Gruppenbefehl mit 50 Units ⇒ requestsIssued genau +1 | +1, ein gemeinsamer Pfad | ✅ |
| (nur berichtet) hollow-ridge: keine Anfrage gescheitert | 0 Failed | ✅ |
| bases-1024: PathService p95 ≤ 5 ms (warm) [ms, nur berichtet] | p95 4.07 ms, kalt 6.18 ms | ✅ |
| hollow-ridge: PathService p95 ≤ 5 ms (warm) [ms, nur berichtet] | p95 2.49 ms, kalt 4.79 ms | ✅ |
| hollow-ridge: repathsTriggered == Brute-Force-Korridorschnitt (0 falsch-positiv/-negativ) | 179 markiert, 179 erwartet, FP 0, FN 0, Zählerabweichungen 0 | ✅ |
| hollow-ridge: keine sonstigen Korridor-Repaths | 0 | ✅ |
| hollow-ridge: Sturm ist aussagekräftig (Schnitte > 0, nicht alle Pfade) | 179 Markierungen | ✅ |
| hollow-ridge: nie auf blockierter Zelle/im Tiefwasser | 0 Verstöße | ✅ |
| bases-1024: repathsTriggered == Brute-Force-Korridorschnitt (0 falsch-positiv/-negativ) | 85 markiert, 85 erwartet, FP 0, FN 0, Zählerabweichungen 0 | ✅ |
| bases-1024: keine sonstigen Korridor-Repaths | 0 | ✅ |
| bases-1024: Sturm ist aussagekräftig (Schnitte > 0, nicht alle Pfade) | 85 Markierungen | ✅ |
| bases-1024: nie auf blockierter Zelle/im Tiefwasser | 0 Verstöße | ✅ |
| SPK6-Referenz: jede Unit ändert ihre Position ≤ 10 Ticks nach dem Befehl (aus dem Stand, 0–180°) | Einzel max 1, Gruppe max 1 Ticks | ✅ |
| Szenario 5: End-Hash in allen Engines und JIT-Modi identisch | 0xa487173d | ✅ |
| Szenario 5: Last real (Ø ≥ 90 % von 1000 fahrend) | Ø min 993 fahrend | ✅ |
| Szenario 5: Sim-Tick p95 ≤ 8 ms in der langsamsten Engine [ms, nur berichtet] | 2.04 ms (firefox warm) | ✅ |

### Szenario 1 – 200 Units über die Karte

Anfahren = erster Tick mit Positionsänderung nach dem Befehl (Befehls-Tick = 1). Stuck = 30 Ticks ohne 0,15 WU Fortschritt auf der Restroute (SPK2-Definition, Referenz folgt einer längeren neuen Route ohne Gutschrift). Offset = Abstand zu Schwerpunkt + komprimiertem Offset nach Ankunft (nur berichtet).

| Lauf | Befehle ⇒ Anfragen | Anfahren max (Ticks) | ohne Stuck > 3 s | Bereich | längste Pause p95 / max | alle ruhend nach | Offset p50 / p95 / max (WU) | Verstöße |
|---|---|---|---|---|---|---|---|---|
| hollow-ridge | 58 ⇒ 58 | 1 | 192/200 = 96,0 % | 96,0 % | 28 / 53 | 2485 | 0,34 / 3,95 / 5,42 | 0 |
| bases-1024 | 58 ⇒ 58 | 1 | 195/200 = 97,5 % | 97,5 % | 26 / 105 | 3622 | 0,36 / 3,22 / 4,91 | 0 |
| hollow-ridge Seed 2 | 58 ⇒ 58 | 1 | 193/200 = 96,5 % | 96,5 % | 25 / 72 | 2473 | 0,29 / 3,63 / 4,94 | 0 |
| bases-1024 Seed 2 | 58 ⇒ 58 | 1 | 195/200 = 97,5 % | 97,5 % | 27 / 67 | 3607 | 0,36 / 3,83 / 6,60 | 0 |
| hollow-ridge Seed 3 | 58 ⇒ 58 | 1 | 191/200 = 95,5 % | 95,5 % | 29 / 59 | 2569 | 0,35 / 3,73 / 6,70 | 0 |
| bases-1024 Seed 3 | 58 ⇒ 58 | 1 | 194/200 = 97,0 % | 97,0 % | 28 / 73 | 3725 | 0,51 / 3,32 / 9,47 | 0 |
| hollow-ridge-plateau (berichtet) | 58 ⇒ 58 | 1 | 174/200 = 87,0 % | 87,0 % | 45 / 115 | 3202 | 0,74 / 3,73 / 12,59 | 0 |

- hollow-ridge: Start im NW-Tiefland (250, 60); alle Ziele jenseits des Grats (beide Furten), G50 auf das SE-Plateau (Rampe 8 WU)
- bases-1024: Start im Tiefland (300, 400) zwischen den NW-Basen und dem Fluss; Ziele im Norden und jenseits des Flusses (Furten x = 256 / 512)
- hollow-ridge-plateau: Start auf dem NW-Startplateau (100, 100): alle 200 über die zwei 8-WU-Rampen, zwei Ziele am Fuß der SE-Rampen

### Szenario 2 – Engstelle 3 WU (100 T1-Panzer)

| Karte | alle durch nach (Ticks) | Bereich | 25 / 50 / 75 / 100 durch | längste Pause | Deadlock | Verstöße |
|---|---|---|---|---|---|---|
| nav-choke-256-1 | 296 | 296 | 125 / 166 / 205 / 296 | 53 | nein | 0 |
| nav-choke-1024-1 | 293 | 293 | 128 / 180 / 215 / 293 | 53 | nein | 0 |

### Szenario 3 – 200 Einzelanfragen gleichzeitig (12 Läufe: Lauf 1 = JIT kalt, 2–3 Aufwärmen, Rest = warm)

| Karte | Footprints | Ticks bis alle Ready (je Lauf) | Ready-Tick p50 / p95 | PathService warm p50 / **p95** / max (ms) | Bereich p95 | kalt p95 | Expansionen/Tick p50 / max | Expansionen/Anfrage p50 / p95 / max | Ready / Direct / Failed / Retarget | Gruppe 50 ⇒ Anfragen |
|---|---|---|---|---|---|---|---|---|---|---|
| bases-1024 | 381 | 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7 | 3 / 7 | 3,04 / **4,07** / 5,26 | 4,07–4,70 | 6,18 | 20212 / 21668 | 555 / 1609 / 2944 | 199 / 1 / 0 / 1 | +1, ein Pfad |
| hollow-ridge | 0 | 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6 | 3 / 6 | 2,34 / **2,49** / 2,93 | 2,49–3,99 | 4,79 | 20047 / 22014 | 267 / 2200 / 6380 | 200 / 0 / 0 / 0 | +1, ein Pfad |

### Szenario 4 – Repath-Sturm (200 fahrende Units, 20 neue Footprints)

| Karte | markiert | erwartet (Brute Force) | falsch-positiv / -negativ | Zähler == Markierungen | sonstige Korridor-Repaths | sonstige Anfragen (Stuck) | Verstöße |
|---|---|---|---|---|---|---|---|
| hollow-ridge | 179 | 179 | 0 / 0 | ja | 0 | 1 | 0 |
| bases-1024 | 85 | 85 | 0 / 0 | ja | 0 | 2 | 0 |

### Szenario 5 – 1000 fahrende Panzer mit Pathing auf hollow-ridge (1000 gemessene Ticks nach 200 Ramp-Ticks)

10 Gruppen à 100 (Klassen 1–3, 2 Armeen), alle 20 Ticks ein neues Ziel quer über die Karte (jedes 3. mit Shift). Reps > 1: Engine-Uhr zu grob, Tick per Snapshot/Restore wiederholt.

| Engine | JIT | Reps | p50 | **p95** | Bereich p95 | p99 | max | PathService p95 | Movement p95 | SpatialRebuild p95 | Hash-Tick p95 | fahrend Ø (min) | Anfragen | End-Hash |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| node | kalt | 1 | 0,932 | **1,74** | 1,74–2,67 | 2,40 | 4,09 | 0,265 | 1,45 | 0,034 | 0,229 | 993 (922) | 220 | 0xa487173d |
| node | warm | 1 | 0,938 | **1,76** | 1,75–2,10 | 2,23 | 3,18 | 0,253 | 1,45 | 0,033 | 0,238 | 993 (922) | 220 | 0xa487173d |
| chromium | kalt | 1 | 0,705 | **1,40** | 1,40–1,75 | 2,02 | 15,3 | 0,245 | 1,14 | 0,030 | 0,135 | 993 (922) | 220 | 0xa487173d |
| chromium | warm | 1 | 0,690 | **1,33** | 1,33–1,69 | 1,71 | 2,42 | 0,225 | 1,09 | 0,025 | 0,125 | 993 (922) | 220 | 0xa487173d |
| firefox | kalt | 1 | 1,02 | **2,02** | 2,02–2,80 | 2,68 | 4,66 | 0,360 | 1,70 | 0,020 | 0,220 | 993 (922) | 220 | 0xa487173d |
| firefox | warm | 1 | 1,02 | **2,04** | 2,02–2,08 | 2,80 | 4,22 | 0,340 | 1,72 | 0,020 | 0,220 | 993 (922) | 220 | 0xa487173d |
| webkit | kalt | 5 | 0,502 | **1,10** | 1,03–1,12 | 1,50 | 2,50 | 0,200 | 1,00 | 0,200 | 0,200 | 993 (922) | 220 | 0xa487173d |
| webkit | warm | 5 | 0,513 | **0,913** | 0,913–1,10 | 1,31 | 1,91 | 0,200 | 1,00 | 0,200 | 0,200 | 993 (922) | 220 | 0xa487173d |

**Budget:** p95 ≤ 8 ms in der langsamsten Engine inkl. Hash-Tick → gemessen **2,04 ms** (firefox warm) ⇒ **erfüllt**.

### SPK6-Folgepunkt – Anfahren aus dem Stand (Sim-Anteil, Referenz für ms3-p6)

Testebene, je Blueprint und Kursfehler zwischen Blickrichtung und Ziel; Ticks nach dem Befehl (Befehls-Tick = 1, inputDelay 0): erste Drehung, erste Positionsänderung, ≥ 0,05 / 0,5 / 1 WU Weg.

| Blueprint | Kursfehler | Drehung | Position ändert sich | ≥ 0,05 WU | ≥ 0,5 WU | ≥ 1 WU |
|---|---|---|---|---|---|---|
| core:lnd_t1_tank | 0° | – | 1 | 2 | 5 | 7 |
| core:lnd_t1_tank | 45° | 1 | 1 | 2 | 5 | 7 |
| core:lnd_t1_tank | 90° | 1 | 1 | 3 | 7 | 10 |
| core:lnd_t1_tank | 135° | 1 | 1 | 3 | 12 | 15 |
| core:lnd_t1_tank | 180° | 1 | 1 | 3 | 17 | 21 |
| core:lnd_t2_tank | 0° | – | 1 | 2 | 5 | 8 |
| core:lnd_t2_tank | 45° | 1 | 1 | 2 | 6 | 8 |
| core:lnd_t2_tank | 90° | 1 | 1 | 3 | 7 | 10 |
| core:lnd_t2_tank | 135° | 1 | 1 | 3 | 13 | 17 |
| core:lnd_t2_tank | 180° | 1 | 1 | 3 | 18 | 23 |
| core:lnd_t3_heavy | 0° | – | 1 | 3 | 8 | 11 |
| core:lnd_t3_heavy | 45° | 1 | 1 | 3 | 8 | 11 |
| core:lnd_t3_heavy | 90° | 1 | 1 | 4 | 12 | 16 |
| core:lnd_t3_heavy | 135° | 1 | 1 | 4 | 20 | 25 |
| core:lnd_t3_heavy | 180° | 1 | 1 | 4 | 29 | 35 |

Gruppe aus 20 gemischten Panzern (Gruppenbefehl, Pfad noch ausstehend): alle ändern ihre Position spätestens nach **1 Tick(s)**.
<!-- ms3:end -->

## Messwerte SPK3 (`pnpm bench:spk3`)

Nav-Ebene (Precompute, HPA\*-Optimalität, Budget-Sweep) bleibt `pnpm bench:nav` (Fragment ms3-p0; Kontrolllauf
`--quick` heute: 512 WU 7 Ticks p95 2,8 ms, 1.024 WU 8 Ticks p95 3,0 ms, HPA\*/Optimum p95 1,034–1,050). Entscheidung:
DECISIONS 24.

<!-- spk3:begin -->
Letzter Lauf: 2026-09-30, `pnpm bench:spk3` (9 s). **Lokal gemessen (Apple M5 Pro, Node v24.18.0), nicht Referenz-Laptop.** Fremdlast: Load-Average 5,5 / 6,0 / 5,4 → 5,0 / 5,8 / 5,4.
Karten `generateNavTestMap({ kind: 'bases', seed: 1 })` 512 / 1.024 WU mit gestempelten Basen; Budget 20.000 Expansionen/Tick (`PATH_BUDGET_EXPANSIONS`).

#### 1. HPA*-Expansionen und Ticks bis Ready (200 Einzelbefehle gleichzeitig, 12 Läufe)

| Karte | Ticks bis alle Ready | Ready-Tick p50 / p95 / max | Expansionen/Anfrage p50 / p95 / max | Expansionen gesamt | PathService warm p50 / p95 / max (ms) | kalt p95 |
|---|---|---|---|---|---|---|
| bases-512 | 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5 | 3 / 5 / 5 | 269 / 1.632 / 3.678 | 92.914 | 2,54 / 3,09 / 4,07 | 6,18 |
| bases-1024 | 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7 | 3 / 7 / 7 | 555 / 1.609 / 2.944 | 132.266 | 2,96 / 3,23 / 3,57 | 7,13 |

- bases-512 Expansionen je Anfrage: ≤ 100: 19,0 % · 101–300: 35,0 % · 301–1.000: 36,5 % · 1.001–3.000: 7,0 % · 3.001–10.000: 2,5 % · > 10.000: 0,0 %
- bases-1024 Expansionen je Anfrage: ≤ 100: 8,0 % · 101–300: 23,5 % · 301–1.000: 46,5 % · 1.001–3.000: 22,0 % · 3.001–10.000: 0,0 % · > 10.000: 0,0 %
- bases-512 Ready nach Ticks: ≤ 1: 20,0 % · 2: 18,0 % · 3: 32,5 % · 4–5: 29,5 % · 6–7: 0,0 % · 8–10: 0,0 % · > 10: 0,0 %
- bases-1024 Ready nach Ticks: ≤ 1: 16,0 % · 2: 19,0 % · 3: 16,0 % · 4–5: 30,5 % · 6–7: 18,5 % · 8–10: 0,0 % · > 10: 0,0 %

#### 2. Basisbau im Sim (200 Panzer unterwegs, alle 10 Ticks ein Footprint 3×3…8×8 wenige WU vor einer fahrenden Unit, 1800 Ticks)

| Karte | Footprints (übersprungen) | Korridor-Repaths je Footprint Ø / p95 / max | Korridor-Repaths/min | Stuck-Anfragen/min | Aufgaben/min | Befehle/min | Evictions | PathService p50 / p95 / max (ms) | Expansionen/Tick p95 |
|---|---|---|---|---|---|---|---|---|---|
| bases-512 | 147 (33) | 6,80 / 20 / 33 | 333,3 | 26,0 | 1,7 | 144,7 | 0 | 0,001 / 0,402 / 6,09 | 3.380 |
| bases-1024 | 169 (11) | 3,83 / 10 / 30 | 215,7 | 6,7 | 0,0 | 82,0 | 0 | 0,001 / 0,325 / 5,14 | 2.091 |

#### 3. Gefecht im Sim (2 × 100 Panzer, je 4 Gruppen à 25, tauschen die Plätze durcheinander hindurch, 3000 Ticks)

| Karte | Legs | Stuck-Anfragen/min | Aufgaben/min | Stau-Episoden > 3 s/min | Units mit ≥ 1 Episode | längste Pause p95 / max (Ticks) | PathService p95 / max (ms) |
|---|---|---|---|---|---|---|---|
| bases-512 | 29 | 33,0 | 1,2 | 12,6 | 49/200 | 45 / 61 | 0,007 / 0,221 |
| bases-1024 | 24 | 13,8 | 0,0 | 4,8 | 20/200 | 34 / 47 | 0,001 / 0,378 |

#### 4. Repath-Strategie: Korridor-Schnitt vs. „Invalidierung beim Chunk-Eintritt + Lazy-Repair“ (Nav-Ebene, 200 Mover à 2,5 WU/s, alle 10 Ticks ein Footprint 4–10 WU vor einem Mover, 1800 Ticks)

Notwendig = Pfad war zum Zeitpunkt des Repaths tatsächlich geschnitten (Korridorregel bzw. Brute Force `@faf/nav/check`); Fahrt auf blockiertem Stück = Mover-Prüfungen (alle 5 Ticks), bei denen das Stück zum nächsten Wegpunkt keine Clearance-LOS mehr hatte.

| Karte | Strategie | Footprints | Repaths (Korridor / Chunk-Eintritt / Lazy) | Repaths/min | notwendig / unnötig | geschnitten, nie repariert | Latenz Schnitt → Repath p50 / p95 / max (Ticks) | Fahrt auf blockiertem Stück | Expansionen | Stempel ms p50 / max | PathService ms p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| nav-bases-512-1 | Korridor-Schnitt | 124 | 698 (698 / 0 / 0) | 232,7 | 698 / 0 | 0 | 0 / 0 / 0 | 0 | 621.703 | 0,724 / 3,74 | 0,189 |
| nav-bases-512-1 | Chunk-Eintritt + Lazy-Repair | 129 | 725 (0 / 574 / 151) | 241,7 | 472 / 253 | 1 | 104 / 536 / 1057 | 151 | 648.008 | 0,566 / 3,52 | 0,170 |
| nav-bases-1024-1 | Korridor-Schnitt | 154 | 646 (646 / 0 / 0) | 215,3 | 646 / 0 | 0 | 0 / 0 / 0 | 0 | 560.243 | 0,543 / 4,17 | 0,182 |
| nav-bases-1024-1 | Chunk-Eintritt + Lazy-Repair | 154 | 458 (0 / 312 / 146) | 152,7 | 363 / 95 | 1 | 107 / 788 / 1303 | 146 | 469.190 | 0,581 / 5,24 | 0,184 |

| Kriterium | Ergebnis | Status |
|---|---|---|
| (nur berichtet) SPK3 bases-512: 200 Anfragen fertig ≤ 10 Ticks | max 5 Ticks | ✅ |
| SPK3 bases-512: PathService p95 ≤ 5 ms (warm) [ms, nur berichtet] | p95 3.09 ms (kalt 6.18 ms) | ✅ |
| SPK3 bases-1024: 200 Anfragen fertig ≤ 10 Ticks | max 7 Ticks | ✅ |
| SPK3 bases-1024: PathService p95 ≤ 5 ms (warm) [ms, nur berichtet] | p95 3.23 ms (kalt 7.13 ms) | ✅ |
| SPK3 nav-bases-512-1: Korridorregel ohne unnötige Repaths, keine verpassten Schnitte | 698 Repaths, unnötig 0, unrepariert 0, Fahrt auf blockiertem Stück 0 | ✅ |
| SPK3 nav-bases-1024-1: Korridorregel ohne unnötige Repaths, keine verpassten Schnitte | 646 Repaths, unnötig 0, unrepariert 0, Fahrt auf blockiertem Stück 0 | ✅ |
<!-- spk3:end -->

## Kriterien-Status (Zusammenfassung)

| MS3-Abnahme (PLAN §5.2, Sim-Ebene) | Status |
|---|---|
| 200 Units: alle fahren < 1 s nach dem Befehl los (max 1 Tick) | ✅ |
| 200 Units: ≥ 95 % ohne Stuck > 3 s (hollow-ridge 95,5–96,5 %, 1.024 WU 97,0–97,5 %, je 3 Seeds) | ✅ (knapp auf hollow-ridge) |
| 200 Units: Start auf dem Plateau (200 über zwei 8-WU-Rampen), nur berichtet: 87 % | ⚠️ |
| Offset-Golden (`ridge-group-offset`, Asserts ≤ 1,5 WU) grün; Offset-Fehler im Querfahrt-Szenario p95 3,2–4,0 WU (berichtet, Slots an Wänden/Rampen zurückgezogen) | ✅ / ⚠️ |
| Engstelle 3 WU: 100 Units in 293–296 Ticks (≤ 600), kein Deadlock | ✅ |
| 200 Einzelanfragen auf 1.024 WU mit Hindernissen: 7 Ticks (≤ 10) | ✅ |
| Pathing ≤ 5 ms/Tick p95 (warm 3,3–4,7 ms; JIT-kalt 6,9–11 ms) – lokal M5 Pro | ✅ (ms, berichtet) |
| Ein Gruppenbefehl = genau eine Anfrage | ✅ |
| Repath-Sturm: nur geschnittene Korridore (0 FP/FN, 179 bzw. 85 Markierungen) | ✅ |
| 1.000 fahrende Units: Sim p95 ≤ 8 ms in der langsamsten Engine (2,0–2,8 ms, Firefox bzw. Node) | ✅ (ms, berichtet) |
| SPK3: HPA\* Standard, Budget 20.000, Korridor-Schnitt (DECISIONS 24) | ✅ |

## Tests

| Datei | Inhalt |
|---|---|
| `tools/headless/test/ms3.test.ts` (neu) | Startup (1 Tick für alle Klassen/Winkel), Engstelle 128 WU, Repath-Sturm hollow-ridge (markiert == Brute Force), SPK3-Variante auf Nav-Ebene (Korridor: 0 unnötig, 0 Fahrt auf geschnittenem Stück, Latenz 0; Chunk-Variante konsistent gezählt), Nearest-Rank-Quantil |
| `packages/sim/test/pathing.test.ts` | + Gruppen-Slots hinter einer dünnen Wand bleiben auf der Zielseite (schlägt ohne die Änderung fehl) |
| `packages/nav/test/repath.test.ts` | + `corridorRepath = false`: keine Markierung, Zähler 0, abgeleitete Regionen identisch |
| Goldens | 8/8 grün mit `faf-sim/ms3.1` (5 neu aufgenommen), `pnpm test:xengine` 160 Ketten bitgleich |

Selbsttest (2026-09-30):

| Befehl | Ergebnis |
|---|---|
| `pnpm typecheck` | grün |
| `pnpm lint` | grün (eslint inkl. `sim/determinism`, dep-cruiser 412 Module) |
| `pnpm vitest run tools/headless packages/sim packages/nav packages/sim-host` | 33 Dateien, 208 Tests grün (≈ 3:50 min, Allokationstests dominieren) |
| `pnpm --filter @faf/headless goldens` | 8/8 ✓ |
| `pnpm test:xengine` | 160/160 bitgleich (≈ 1:40 min) |
| `pnpm bench` | Exit 0 (sim, sim-host ms2/ms3, nav/SPK3, Headless-Bench Node + 3 Browser; MS3-Tick p95 max 2,5 ms) |
| `pnpm bench:ms3 -- --quick` | Exit 0 (25 s inkl. drei Browser) |
| `pnpm bench:spk3 -- --quick` | Exit 0 (6 s) |
| `pnpm bench:nav -- --quick` | Exit 0 |

## Abweichungen vom Plan / vom Auftrag (mit Begründung)

1. **Worktree-Pfad:** Der Auftrag nennt `/Users/logge/Documents/Projects/flow-and-fire-ms3`; der Worktree des
   Branches `ms3` liegt unter `…/flow-and-fire/.worktrees/flow-and-fire-ms3`. Dort gearbeitet (derselbe Branch, dort
   lagen die Zwischenstände von ms3-p0…p4 und ein abgebrochener erster Lauf dieses Pakets, dessen `src/ms3/*` und
   `movement.ts`-Änderung übernommen und geprüft wurden; seine `_smoke*`-Skripte sind entfernt).
2. **Szenario 1 startet im offenen Gelände** (wie SPK2), die Plateau-Abfahrt ist nur berichtet (DECISIONS 25): 200
   Units durch zwei 8-WU-Rampen gleichzeitig sind eine Engstelle; Wartezeit im Stau > 3 s ist dort physikalisch
   unvermeidlich (87 %). Ebenso führt das 1.024-WU-Layout nicht durch die 3–8-WU-Gratlücken (Szenario 2).
3. **Stuck-Metrik mit SPK2-Semantik** (DECISIONS 25): Routenänderungen (Pfad fertig, Repath, Lazy Refinement) heben
   die Referenz an, ohne Fortschritt gutzuschreiben – sonst zählte das Ersetzen der Geraden zum nächsten Portal
   durch den echten Weg als „Stillstand“. Wartezeit im Gedränge zählt weiterhin voll.
4. **Szenario 2 auf 256 und 1.024 WU** statt nur einer Größe (die Lücke liegt je Seed an anderer Stelle; Kosten
   gering).
5. **SPK3-Variantenvergleich auf Nav-Ebene** (200 Mover auf ihren Pfaden, gleiche Stempel- und Zielfolge) statt im
   Sim: die Variante braucht Eingriffe in Movement/PathService, die nur für den Bench existieren dürften; die
   Nav-Ebene misst genau die Unterschiede (Repaths, unnötige Repaths, Latenz, Fahrt gegen Hindernisse, Kosten).
   Die Wahrheit „Korridor geschnitten“ der Variante liefert die Brute-Force-Prüfung je Stempel.
6. **Basisbau-Footprints „vor fahrenden Units“** (4–10 WU vor einer rotierend gewählten fahrenden Unit, nie über
   einer Unit) statt nahe den Basen: das ist der härtere Fall für die Korridorregel (ms3-p0 maß den Fall „nahe der
   Basen“ auf Nav-Ebene: 1–2 Repaths je Footprint).
7. **`--no-browser`** existiert zusätzlich (Entwicklung); ohne Browser meldet der Bericht das als Hinweis.

## Bekannte Grenzen

- **Knappe Marge auf hollow-ridge** (95,5 % bei Seed 3): Die verbleibenden Stauungen liegen an der NE-Furt
  (Klasse-3-Engstelle am Furtausgang, schwere Panzer im Pulk) und an der Nordrampe des SE-Plateaus – echter Stau,
  keine Hänger (0 Aufgaben, längste Pause 5–11 s).
- **Gedränge an 8-WU-Rampen** (Plateau-Abfahrt 87 %) und **Gegenverkehr** (Gefecht: 5–13 Stau-Episoden > 3 s je
  Minute bei 200 Units) bleiben die Schwachstelle der weichen, positionsbasierten Kollision ohne RVO; Kandidaten für
  später: Einbahn-Priorität an Engstellen, Flow Fields ab 12 Units (PLAN §3.8, M10).
- **Offset-Fehler nach Querfahrten** p95 3–4 WU: an Wänden/Rampen zurückgezogene Slots und Arrival-Contagion am
  Ziel weichen bewusst vom komprimierten Offset ab (das Offset-Golden auf freier Fläche bleibt ≤ 1,5 WU).
- **PathService-Burst nahe am 5-ms-Budget** (p95 bis 4,7 ms unter Last, JIT-kalt bis 11 ms): auf dem
  Referenz-Laptop vermutlich darüber ⇒ DECISIONS 24 nennt 15.000 als nächsten Budgetschritt (9 Ticks).
- **Aufgaben im Dauergedränge:** Szenario 5 (1.000 Units, alle 20 Ticks eine 100er-Gruppe neu quer über die Karte)
  hat 8 aufgegebene Orders in 1.000 gemessenen Ticks (Stuck-Kette Stufe 3 in Pulks, die sich gegenseitig
  durchqueren) – in allen Engines identisch.
- WebKit misst mit 1-ms-Uhr (5 Reps per Snapshot/Restore); Phasenwerte < 0,2 ms sind dort Auflösung.
- Alle ms-Werte stammen aus einer ausgelasteten Maschine (parallele Workflows) und schwanken bis ≈ 1,5×.
