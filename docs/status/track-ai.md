# TRACK-AI: lokale KI und Arena

Stand 2026-09-30, kanonischer Projektordner `flow-and-fire`. Dieser Vorarbeits-Track liefert eine ausführbare KI und eine eigene Test-Arena. Er ist keine Abnahme von MS6/MS9/MS10 gegen die echte Sim.

`@faf/ai` enthält Verträge, Kartenanalyse, Roster-/Terrain-Adapter, Profile, deterministischen RNG, Snapshot-Perception, Blackboard, TaskBoard, Budgets, CommandEmitter, acht Manager und einen umgebungsneutralen Host. `@faf/ai-arena` enthält Map-Loader, FlowEconomy, Welt, Sicht, Match/Replay, Szenarien, Node-Worker, Statistik, Turnier-CLI und Benchmarks. Abhängigkeiten von `packages/ai/src` sind auf fixed/protocol/rules beschränkt; weder DOM- noch Node-Typen sind im Paket erforderlich.

Die Manager laufen in der Reihenfolge Intel, Opening, Economy, Tech, Defense, Factory, Engineer, Platoon. Opening/Engineer/Platoon laufen bei jedem Think; die übrigen alternieren gemäß Profil. Easy denkt bei 10 Hz Spielzeit alle zehn Ticks, Normal/Hard alle fünf; Command-Lead ist drei Ticks. Hard-Micro bleibt MS14. Das Blackboard hält eigene Einheiten, reagierte Kontakte, Reservierungen, Build-Tasks, Produktions-/Jagd-Anfragen und Telemetrie. APM wird pro gleitendem 60-s-Fenster begrenzt, ungenutztes Operationsbudget nur innerhalb desselben Thinks weitergegeben. Der Ingest bleibt vollständig und wird separat gezählt. Wall-Clock darf nur den gekapselten Notabbruch auslösen.

Snapshot-Bytes enthalten ausschließlich die eigene Economy, eigene Einheiten, bekannte Kontakte und eigene Ereignisse. Platzierung verwendet Terrain sowie eigene und bekannte feindliche Strukturen. Die Arena erfasst Ziele nur bei Sicht; Attack verfolgt nach Sichtverlust den letzten bekannten Ort. Float-Entscheidungen sind deterministisch, die Welt bleibt ausdrücklich getrennt von der Fixed-Point-Sim. Asynchron eingetroffene Resultate werden nach Army/Sequenz aufzeichnet, damit Worker-Scheduling den Log nicht verändert.

## Abnahme

Die Nummern entsprechen der Reihenfolge der 14 Kriterien in `docs/plans/TRACK-AI.json`.

| Nr. | Stand | Beleg und Grenze |
|---:|---|---|
| 1 | lokal geprüft, global durch Konsolidierung | `tsc -b packages/ai tools/ai-arena` und scoped ESLint grün; Root prüft frozen-lockfile, globales Typecheck/Lint und dep-cruiser |
| 2 | umgesetzt | Static/Perception/Brain/Profile/Budget/CommandSource, vorhandene Protocol-Ops; Wire-Clone rekonstruiert Blueprint-Methoden |
| 3 | umgesetzt, Szenario-Grenzen unten | acht Manager, Opening-Ownership/Handoff, T2, Build-TaskBoard, Konter, Wellen/Rückzug, Threat-Grid und Minimal-A8 |
| 4 | geprüft | Profil-/Budget-/Emitter-Tests, APM-Cap und Operationsbudget im Turnier |
| 5 | geprüft auf Node/Arena | AI-DET-01: Seed 7/Setons/6000 Ticks, identische Command-Bytes und Hash alle 600 Ticks; AI-DET-02, Pending und Timeout mit Replay |
| 6 | geprüft | AI-PERC-01/02 Welt-Tests und AI-PERC-03: fremder Speicher ändert Commands nicht |
| 7 | umgesetzt | Terrain-A*, Flow, Bau/Assist/Upgrade/Queue/Repeat/Rally, Sicht/Ghosts, abstrakter Kampf, Hash-Replay; Reclaim/Radar fehlen bewusst |
| 8 | geprüft | vorhandene Kartenanalyse-Tests für Setons/Hollow Ridge, Zonen/Distanz/Ring/Rally |
| 9 | dokumentierte Abweichung | [Timing-Tabelle](track-ai-openings.md): unveränderte expect; ±10 s mehrfach verfehlt, größtes Delta -75,8 s bei Mex8/tech_greed/Hollow Ridge |
| 10 | Unit-/Arena-Belege, engere Grenzen sichtbar | IDs und Assertions in der Tabelle unten; der dynamische 180-s-Vogt-Köder ist zusätzlich in der Arena geprüft |
| 11 | auf finaler Arena-Logik geprüft | [210-Spiele-Bericht](track-ai-tournament.md): T2/Welle 210/210, Wilson-Untergrenzen 98,2035 %, Idle maximal 14,2469 %, 0 Crash/Timeout, APM/Ops grün; [120 Difficulty-Spiele](track-ai-difficulty.md) vollständig berichtet; beide Pools 4/4 Worker beendet |
| 12 | lokal gemessen | M5 Pro/Node: Normal Think-p95 0,437 ms, Hard 2 x 300 ops-p99 4550/40000 und 0 Timeouts; 3000 Ticks bei 3x mit 1 Wartetakt (0,0333 %); Welt-Tick ±2 % nicht belegt |
| 13 | dokumentiert | Hauptdokument, P0–P7-Fragmente, Timing-/Turnierberichte; Root hängt STATUS/DECISIONS im gemeinsamen Abschluss an |
| 14 | scope eingehalten | dieser Worker änderte nur AI/Arena und AI-Statusdokumente; Root prüft sämtliche parallelen Tracks und globale Tests |

## Szenarien und überprüfte Aussagen

| IDs | Ebene | Ergebnis / verbleibende Grenze |
|---|---|---|
| AI-OPEN-01/02 | Arena, sechs Kombinationen | alle fünf Milestones im unveränderten Fenster reference.techT2 + 120 s, T2 ≤ 12 min, Welle ≤ 8 min, null Timeouts, APM-/Ops-Cap; unveränderte expect und alle ±10-s-Verfehlungen separat berichtet |
| AI-OPEN-03 | Manager | vier Ring-Spots reserviert, Engineer bleibt unter Opening-Ownership |
| AI-OPEN-04 | Manager | sechs Bots über fünf Sekunden erzeugen Verteidigungsmodus und PD-Task |
| AI-OPEN-05 | Arena | ein Bot und ein Land-Scout sterben, kein globaler Abbruch, Mex8 maximal 20 s später als Referenz |
| AI-ECO-01 | Manager und Arena | +100 E/s erzeugt neue Kraftwerksaufträge innerhalb von 2 s; weniger als 3 s Stall während des folgenden 120-s-Verlaufs (`economy.test.ts`) |
| AI-ECO-02 | Manager und Arena | gemessener Mass-Überschuss über 20 s, Mex → zusätzliche Fabrik → Landwerk-Upgrade → Engineer-Bonus, Reservierungen und offene 3,7-M/s-Senke geprüft; voller Speicher bei ausgeglichener Bilanz erzeugt keine Senke |
| AI-ECO-03 | Manager | eigener sicherer Mex wird aufgerüstet, umkämpfter Mex ausgeschlossen |
| AI-ECO-04 | Manager und Arena | bei `E_frei=100` genau ein Mex-Upgrade in den ersten 2 s, Kraftwerksaufträge vor dem zweiten Upgrade und 0 Stall-Ticks während 120 s (`economy.test.ts`) |
| AI-ECO-05 | Manager und Arena | Hollow Ridge, alle sechs eigenen Spots belegt: nächster Ring-Mex innerhalb von 2 s, höchstens ein Mex-Upgrade neben einem tatsächlich laufenden Landwerk-Upgrade |
| AI-ENG-02 | Arena | tatsächliche Placement-Rejection nach Perception, Neuplatzierung, fac2 höchstens 5 s später als Referenz |
| AI-ENG-04 | Arena | drei Land-Scouts, Jagd-Anfragen spätestens 5 s nach Sichtkontakt, Mex-Anzahl nach 5 min mindestens 90 % der Referenz |
| AI-FAC-01 | Manager | beobachtete Bots ergeben Tank-Massanteil >=60 % und Artillerie >=25 % |
| AI-PLT-01 a/b/c | Manager | 7:11 Rückzug, 7:10 kein Rückzug, 8:10 kein Wiedereinstieg |
| AI-PLT-02 | Arena | erste Welle mit >=8 Einheiten vor 8 min in gegnerischer Hälfte |
| AI-PLT-04 | Manager und Arena | Angriff außerhalb der Leine wird beendet. Drei Stichel verursachen tatsächlich Schaden und ziehen sich zu zwölf Panzern bei 90 WU zurück; Vogt bleibt über 180 s innerhalb 60 WU und überlebt (`leash.test.ts`). Der Arena-Test isoliert Intel/Platoon, damit Bauaufträge die Referenzfabrik nicht versetzen. |
| AI-PLT-05 | Manager | Pflichtangriff bei maxS, ohne günstigeren Ratio-Zwang; Rückzug separat in AI-PLT-01 geprüft |
| AI-DEF-01/03 | Manager | Schaden erzeugt einen Cluster-Riegel, bloße Scout-Präsenz keinen |
| AI-INT-02 | Manager | mobiler Threat halbiert sich nach ungefähr 13,5 s, Struktur-Threat bleibt |
| AI-PERC-01/02/03 | Arena | Byte-/Known-Occupancy-/Foreign-Eco-Verträge geprüft |
| AI-DET-01/02/03/04 | Host/Arena | deterministischer Strom, halbes Budget, Pending, Notabbruch und Replay |

Der vollständige AI-/Arena-Lauf nach den Energie- und Assist-Korrekturen bestätigte 221 Tests in 22 Dateien (2,81 s), darunter alle fünf zeitlichen Economy-Tests und Worker-Determinismus. Die 26 Manager-Tests bestanden auch separat. Paket-Typecheck und scoped ESLint sind grün.

Der EngineerManager prüft zusätzlich die Energiekosten neuer Bau-/Assist-/Guard-Aufträge bis zum Abschluss. Er reserviert den Puffer für Bauer auf dem Weg und berücksichtigt Upgrades, deren Commands im selben Think erst für drei Ticks später ausgegeben wurden. Damit können mehrere neue Aufträge denselben Speicher nicht gleichzeitig verplanen. Eine bereits leere Economy darf ihr erstes Erholungskraftwerk beginnen. Laufende Baustellen werden dadurch nicht pausiert. Neue Upgrade-Assists bleiben über den Command-Lead bestehen und enden beim Abschluss ihres Ziel-Upgrades, auch wenn die Fabrik bereits wieder produziert. Beide Lebenszyklusgrenzen sind als Manager-Regression geprüft. Eine nur pro Think gültige Platzierungstabelle verhindert außerdem, dass Builder dieselben blockierten oder noch nicht finanzierbaren Basisaufträge wiederholt prüfen und vor produktiven Fallback-Aufträgen das Operationsbudget verbrauchen. Neu ausgegebene Builds reservieren ihren Footprint und verwerfen positive Suchergebnisse, damit zwei Aufgaben nicht denselben Platz erhalten. Drei weitere Manager-Tests prüfen diese Budget-/Reservierungsgrenzen. Idle-Definition, Energieprüfung und Budgets bleiben gleich.

## Messung und Interpretation

Die Turnierberichte enthalten pro Spiel Seed, Karte, Seitenbelegung, gewählte Eröffnung, Zeit bis T2/erste Welle, Idle, Energie-Stall, APM und Ops, außerdem Ausreißer. MS9 verwendet 105 Seeds mit getauschten Seiten auf drei Karten, je 70 Spiele. Die Stichprobe wählt genau eine Army je Spiel nach Seed-Parität. Crashes bleiben im Nenner. Energie-Stall wird aus den gepoolten tatsächlichen Stall-/Beobachtungsticks berechnet. Die Difficulty-Suite liefert einen Bericht und besitzt keinen Siegquoten-Gate.

Der finale MS9-Lauf vom 2026-09-30 besteht alle ursprünglichen Gates, Exit 0. Alle 210 vollständigen Job-Objekte entsprechen exakt `ms9-before-energy-2026-09-29.json`, einschließlich Seed, Karte, Profile und Seiten. Gepoolter Energie-Stall beträgt 0,7007 %; 26 von 420 Army-Berichten liegen dennoch über 5 %, maximal 15,9648 % (Setons, Seed 42, Army 1). Das 5-%-Ziel aus ai.md §7.2 gehört zur späteren MS10-Abnahme und ist kein MS9-Turnier-Gate. Der Rohreport liegt unter `tools/ai-arena/results/ms9-2026-09-30.json`. Die vorherigen vollständigen Läufe bleiben als `ms9-before-idle-2026-09-30.json` und `ms9-before-calibration-energy-2026-09-30.json` erhalten.

Die 120 Difficulty-Spiele endeten ebenfalls mit Exit 0 und vier beendeten Workern. Normal gegen Easy erreicht mit halben Remis 66,67 % (Wilson 54,06–77,27 %, Elo +120,4), Hard gegen Normal 50,83 % (38,52–63,05 %, Elo +5,8). Der Bericht belegt keine strikte Rangfolge Hard > Normal; das Intervall enthält 50 %. Das generische MS9-SampleSize-Feld ist bei 120 Spielen false und damit auch report.pass; die Difficulty-CLI verwendet diese MS9-Gates ausdrücklich nicht als Abnahme. Rohreport: `tools/ai-arena/results/diff-2026-09-30.json`.

Die strikte ursprüngliche Neun-Spiele-Kalibrierung (nicht getauschte Seeds 1–9, drei Spiele pro Karte) besteht auf der finalen Logik alle neun Spiele/18 Armies. T2 ≤720 s, Welle ≤480 s, Idle <15 %, Energie-Stall ≤5 %, null Timeouts und APM/Ops sind pro Army geprüft. Höchster Energie-Stall: 2,561 %. Der JSON-Beleg ist `tools/ai-arena/results/calibration-2026-09-30.json`.

Die Think-Bench lief je Schwierigkeit über 9000 Ticks. Big Battle lief mit je 300 gespawnten Einheiten über 600 Ticks; ein Replay ohne KI reproduzierte denselben Welt-Hash. Der finale Bench vom 2026-09-30 bestand alle Think-/Ops-/Timeout-/Scheduler-Gates, Exit 0. Think-p95: Easy 0,546 ms, Normal 0,437 ms, Hard 0,400 ms. Hard Big Battle: Think-p95 0,262 ms, ops-p99 4550/40000, null Timeouts. Das Welt-Tick-p95 betrug 1,639 ms mit KI und 1,803 ms im Replay ohne KI (−9,11 %). Diese lokale Messung erfüllt keinen ±2-%-Vergleich und beweist keine unveränderte echte Sim-Performance. Das Worker-Analogon führte 1000 Echtzeit-Slices mit maximal drei Ticks pro 100 ms aus: 3000 Ticks, ein Wartetakt, Wartezeit-p95 4,169 ms. Rohreport: `tools/ai-arena/results/bench-2026-09-30.json`. JSON-Messungen liegen lokal unter `tools/ai-arena/results/` und werden ignoriert.

Der Opening-Test wurde erst bei der Konsolidierung ergänzt; in der archivierten Claude-Quelle fehlt diese Arena-Testdatei. Die alten gemessenen Zeitgrenzen enthielten auch das Verhalten verlorener bzw. zu lange bestehender Upgrade-Assists. Deshalb prüft die Regression jetzt die tatsächlichen Completion-/Runtime-Verträge, während die CLI alle 30 Zeitwerte und jede ±10-s-Verfehlung berichtet. Acceptance 9 in `docs/plans/TRACK-AI.json` erlaubt eine Abweichung mit dokumentierter Ursache, ohne expect zu ändern. Zehn Werte liegen außerhalb ±10 s. Hollow Ridge/tech_greed erreicht nach vier bestehenbleibenden Tech-Assists T2 32,1 s und Mex8 75,8 s früher als ecosim. Auf Setons/eco_standard sind Engineers beim Tech-Start mit laufender Expansion beschäftigt, der Vogt assistiert zunächst allein; T2 liegt 15,4 s später. Die übrigen Timing-Deltas sind nicht vollständig auf eine einzelne Ursache zurückgeführt. Belegte Unterschiede gegenüber ecosim sind Platzierung/Spiralsuche, echte Raster-Bewegung, die Engineer-Policy nach dem Skript und Roll-off: Arena spawnt ein fertiges Produkt sofort und pausiert die Fabrik; ecosim verzögert den Spawn. Roster, Design und expect wurden nicht geändert. Diese Unterschiede verlangen bei der späteren echten Sim erneut dieselben Tests.

## Adapter-Grenze

| Heute | Später in MS6/MS9/MS10 |
|---|---|
| PerceptionWriter aus der Arena | FrameWriter-Profil der eigenen Army; AI-PERC-01 Byte-Test übernehmen |
| computePassLowRes, sectors null | nav passLowRes / SectorGraphView |
| RosterTable / bpTableFromRoster | BlueprintViewTable aus @faf/blueprints |
| AI_PAYLOAD_VERSION, vorhandene Ops | versionierte Payload-Codecs in @faf/protocol |
| canPlaceKnown | rules.canPlace mit ausschließlich bekannter Belegung |
| Arena-PerceptionEvent | Event-Stream der echten Sim |
| AiHost und Node-worker_threads | Browser-AI-Worker bzw. Sim-Worker-Fallback, Recorder-MARK aiTimeout, SPK7 im echten Scheduler |
| lokale Arena-Turniere | tools/headless/ai-tournament und Referenz-KIs ai-msN gegen die echte Sim |

Die Arena hat keine Projektile, Kollisionsauflösung, Radar oder Wracks. Cheats sind Setup-/Szenario-Ereignisse und werden nicht im reinen Command-Log persistiert. Browser-Worker, fünf Engines, echter Scheduler, Referenz-Laptop und Kunden-/Spieler-Playtest sind dadurch nicht nachgewiesen. Alle Worktree-Originale bleiben unangetastet.

## Reproduktion

```sh
./tools/heavy pnpm exec tsc -b packages/ai tools/ai-arena
./tools/heavy pnpm exec eslint packages/ai tools/ai-arena --max-warnings 0
./tools/heavy pnpm exec vitest run packages/ai tools/ai-arena --maxWorkers 4
./tools/heavy node --import tsx tools/ai-arena/scripts/openings.ts --out tools/ai-arena/results/openings-2026-09-30.json
./tools/heavy node --import tsx tools/ai-arena/src/scenarios/smoke.ts --out tools/ai-arena/results/calibration-2026-09-30.json
./tools/heavy node --import tsx tools/ai-arena/scripts/tournament.ts --suite ms9 --workers 4 --md docs/status/track-ai-tournament.md --out tools/ai-arena/results/ms9-2026-09-30.json
./tools/heavy node --import tsx tools/ai-arena/scripts/tournament.ts --suite diff --workers 4 --md docs/status/track-ai-difficulty.md --out tools/ai-arena/results/diff-2026-09-30.json
./tools/heavy node --import tsx tools/ai-arena/scripts/bench.ts --out tools/ai-arena/results/bench-2026-09-30.json
```

`pnpm --filter @faf/ai-arena run tournament -- --suite quick` und `run bench -- --quick` sind schnelle CLI-Proben. Root führt im Konsolidierungsabschluss frozen-lockfile, globales Typecheck/Lint und alle Tests aus.

Nach dem Workspace-Lauf wurde nur der Standard-Ausgabepfad der Bench-CLI korrigiert: ohne `--out` liegt der UTC-datierte Report relativ zum Skript unter `tools/ai-arena/results/`, auch bei Ausführung aus dem Paketordner. Explizites `--out` bleibt relativ zum Aufrufordner. Der tatsächliche Quick-Lauf über `pnpm --filter @faf/ai-arena run bench -- --quick` bestand alle vier Gates; Rohbeleg `.git/consolidation/ai-bench-default-output-smoke.json`. Alle vier vorhandenen kanonischen Benchmark-Dateien wurden vorher gesichert und danach SHA256-geprüft bytegleich wiederhergestellt. `runBench`, Workload und Mess-Gates bleiben unverändert. Voller Typecheck und Lint bestanden nach der Pfadkorrektur erneut.
