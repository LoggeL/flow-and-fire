# MS3 P5: Headless-Abnahme

Stand 2026-09-29, lokal Apple M5 Pro. 2 Läufe; ms-Gates nur mit FAF_PERF_GATE=1.

| Karte | 200 Ready (Ticks) | PathService p95 ms |
|---|---:|---:|
| 512 WU mit Basis-Footprints | 5 | 5.373 bis 5.435 |
| 1024 WU mit Basis-Footprints | 9 | 3.716 bis 5.239 |

| Engine | kalt p95 | warm p95 |
|---|---:|---:|
| node | 2.6331 | 1.896 |
| chromium | 2.44 | 1.515 |
| firefox | 2.52 | 2.48 |
| webkit | 1.2521 | 1.0016 |

| Karte | Anfahren max Ticks | Ankunft | blockierte Positionen |
|---|---:|---:|---:|
| Hollow Ridge | 1 | 200/200 | 0 |
| nav-bases-1024-73 | 1 | 197/200 | 0 |

- ridge-group-offset: bestanden, 3600 Ticks, 6 Assertions.
- ridge-shift-queue: bestanden, 1600 Ticks, 7 Assertions.
- choke-3wu: bestanden, 600 Ticks, 4 Assertions.
- obstacle-repath: bestanden, 300 Ticks, 25 Assertions.

Die Gruppenfahrt prüft 40 gemischte Panzer, genau eine Anfrage und Offsetfehler ≤ 1,5 WU. Der Repath-Sturm prüft 20 Footprints gegen einen unabhängigen Brute-Force-Korridorschnitt. Einzel- und Gruppenanfahrwerte werden getrennt erhoben. Der Tick-Benchmark enthält PathService/Movement/SpatialRebuild sowie Hash-Ticks; JSON enthält alle Phasen und Browser-Versionen.

Ergebnis: alle funktionalen Gates bestanden.

Berichte: 2026-09-29T20:04:47.171Z, 2026-09-29T20:15:53.739Z.
Befehle: `pnpm bench:ms3 -- --quick --update-docs`, `pnpm bench:spk3 -- --quick`, `pnpm bench:nav -- --quick`.

## SPK3: Simulation und Repath-Vergleich

Zwei gültige Läufe, lokal Apple M5 Pro, Node v24.18.0. Je Karte/Strategie 200 Einheiten, 600 Ticks (eine Sim-Minute), Basisbau mit 60 Footprints alle 10 Ticks. Zwei-Armeen-Szenario: 100 Einheiten je Armee mit gegensätzlichen Fahrtzielen. Budget bleibt 20.000 Expansionen/Tick.

| WU | Strategie | Szenario | zusätzliche Anfragen | Chunk-Trigger | Stuck-Unit-Ticks | Give-ups | PathService p95 ms |
|---|---|---|---:|---:|---:|---:|---:|
| 512 | corridor | base-building | 40 | 0 | 0 | 0 | 0.0025 bis 0.004 |
| 512 | corridor | two-armies | 0 | 0 | 0 | 0 | 0.0028 bis 0.0036 |
| 512 | chunk-entry | base-building | 85 | 85 | 0 | 0 | 0.0664 bis 0.0872 |
| 512 | chunk-entry | two-armies | 0 | 0 | 0 | 0 | 0.0028 bis 0.0041 |
| 1024 | corridor | base-building | 21 | 0 | 0 | 1 | 0.0034 bis 0.0057 |
| 1024 | corridor | two-armies | 3 | 0 | 0 | 0 | 0.0016 bis 0.004 |
| 1024 | chunk-entry | base-building | 31 | 27 | 0 | 0 | 0.0398 bis 0.0514 |
| 1024 | chunk-entry | two-armies | 3 | 0 | 0 | 0 | 0.0015 bis 0.0028 |

HPA* und der Korridor-Schnitt bleiben Standard. Die Alternative erhöht die Anfragen im Basisbau von 40 auf 85 (512 WU) bzw. von 21 auf 31 (1.024 WU). Die gemessene Chunk-Alternative invalidiert beim Eintritt in einen seit der Planung geänderten Chunk, unterdrückt die sofortigen Korridorflags und behält die native Lazy-Refinement-/Kollisionsprüfung. Sie ist nur im Benchmark auswählbar (`--strategy=chunk-entry`), kein Sim-Schalter. Die Stempelzeiten enthalten in beiden Varianten weiterhin die Korridor-Erkennung; sie belegen deshalb keinen CPU-Gewinn durch Entfernen des Indexes. Der 1.024-WU-Basisbau meldet einen Give-up beim Korridor-Modus, die separate funktionale 200-Unit-Abnahme hat keine Stalls über 30 Ticks und 197/200 Ankünfte. Das ist als beobachtete Grenze ausgewiesen.

Die zeitlichen Budgets sind advisory ohne FAF_PERF_GATE=1: PathService p95 überschreitet 5 ms in einzelnen lokalen Läufen (siehe Tabelle), insbesondere bei Fremdlast. Der Tick-Benchmark mit 1.000 fahrenden Units bleibt in allen vier Engines unter 8 ms. Immer gegated sind 200 Ready in höchstens 10 Ticks, exakt eine Anfrage für 50 Units, Anfahr-Ticks, Ankunftsquote, Stuck-Fenster, blockierte Positionen und die funktionalen Golden-Assertions. Alle diese Gates bestanden. Die folgende zusätzliche Burst-Matrix misst 200 Einzelanfragen separat in allen vier Engines. Das 5-ms-Gate ist dabei noch nicht qualifiziert.

SPK6-Simreferenz: erste Positionsänderung nach einem Befehl maximal ein Tick in beiden 200-Unit-Traversals. Die E2E-Latenz-Spec berichtet zusätzlich den ersten bewegten Pixel samt Ack in naher und Startansicht.

Berichte: tools/headless/results/spk3-1790712628138.json, tools/headless/results/spk3-1790712772470.json.

## MS3 P5: Browser-Burst

Lokal gemessen auf Apple M5 Pro, 2026-09-29T21:05:26.692Z. Jede Kartengröße läuft in einem frischen Node-Prozess beziehungsweise Browser-Worker: kalt, drei vollständige Warm-ups und warm. Die Karten sind deterministische `bases`-Karten mit Footprints, jeweils 200 Einzelanfragen und danach ein Gruppenauftrag für 50 Einheiten.

| Engine | WU | kalt p95 ms | warm p95 ms | Ready-Ticks kalt/warm | Gruppe kalt/warm |
|---|---:|---:|---:|---:|---:|
| node | 512 | 6.1344 | 2.9021 | 5/5 | 1/1 |
| node | 1024 | 7.7467 | 3.4682 | 9/9 | 1/1 |
| chromium | 512 | 6.2900 | 3.0250 | 5/5 | 1/1 |
| chromium | 1024 | 8.4350 | 3.6850 | 9/9 | 1/1 |
| firefox | 512 | 6.3400 | 4.8600 | 5/5 | 1/1 |
| firefox | 1024 | 7.6600 | 5.3200 | 9/9 | 1/1 |
| webkit | 512 | 6.0000 | 3.0000 | 5/5 | 1/1 |
| webkit | 1024 | 8.0000 | 3.0000 | 9/9 | 1/1 |

Versionen: Node v24.18.0, Chromium 153.0.8010.12, Firefox 155.0, WebKit 26.6. Der Bericht enthält native Browser-Versionen, User-Agent und gemessene Uhrauflösung.

Alle funktionalen Gates bestanden: 200 Units, 200 Ready in höchstens zehn Ticks, exakt 200 Einzelanfragen und eine Anfrage für 50 Units. Fehlende Ergebnisse sind Fehler. `FAF_PERF_GATE=1` prüft zusätzlich kalt und warm p95 ≤ 5 ms. Dieser Lauf endet mit Exit 1: alle acht kalten Werte und Firefox 1024 WU warm überschreiten 5 ms. Warm-ups werden funktional geprüft, ihre Zeiten bestimmen das Performance-Gate nicht.

Der gemeinsame Helper ist `tools/headless/src/ms3/request-burst.ts::requestBurst(size, simBin, clock)`. `Job {kind: 'requestBurst', size}` ruft ihn über `JobAssets.simBin` auf. `scripts/ms3.ts::requestBurst(size)` bleibt als Node-kompatibler Wrapper erhalten; der Browser importiert keine Node-Script-Module. Sowohl `test:xengine` als auch `bench:ms3` führen die gemeinsame Matrix aus.

Untersuchung anhand des aufgezeichneten Laufs: Die Expansionen sind zwischen allen Engines sowie kalt/warm exakt gleich verteilt. 512 WU hat fünf Samples mit durchschnittlich 19.672,2 Expansionen, 1024 WU neun Samples mit durchschnittlich 20.724. Der Perzentil-Helper verwendet nearest rank; bei fünf beziehungsweise neun Samples ist p95 hier der Maximalwert. Kalte Mediane liegen unter den Maxima, etwa Node 1024 WU 3,1660 ms gegenüber 7,7467 ms. Das passt zu zusätzlichem Start-/JIT-Aufwand, ist ohne Profil aber keine belegte Ursache. Firefox 1024 WU verfehlt die Grenze auch warm. Es wurde keine weitere Messung, künstliche Vorwärmung oder Budget-/Workload-Änderung vorgenommen.

Die 20.000 Expansionen sind eine Grenze zum Start des nächsten FIFO-Requests. `packages/nav/src/nav.ts::serviceTick` führt einen begonnenen Request vollständig aus, deshalb können die gemeldeten Gesamtexpansionen je Tick darüber liegen. Diese Beobachtung ändert keine Sim-Regel und keinen funktionalen Gate-Vertrag.

Exakter fehlgeschlagener Bericht: `tools/headless/results/xengine-2026-09-29-perf-first.json`. Die erfolgreiche funktionale Projektion dieses selben Laufs liegt in `xengine-2026-09-29-functional.json`; sie ist kein neuer Lauf ohne Performance-Gate. Das 5-ms-Performance-Ziel bleibt offen.

## Aktuelle Root-Abschlussmessungen vom 30.09.2026

Die folgenden Befehle liefen nacheinander im kanonischen Root auf Apple M5 Pro. Der Workspace-Benchmark wurde ohne `--update-docs` ausgeführt; die historischen MS2-Berichte und `docs/status/ms2-p2-sim.md` blieben bytegleich erhalten. Die Lastprüfung vor Beginn fand keine aktiven fremden Benchmarkprozesse; beim zusätzlichen H3-Readback nach SPK2 lief nur der Benutzer-Server mit 0,1 % CPU. Diese punktuellen Prüfungen sind kein durchgehender GPU-Lastnachweis.

| Befehl | Abschluss | Aktueller Beleg |
|---|---|---|
| `./tools/heavy pnpm bench` | Exit 0, zwölf Browser-Benchmarkfälle bestanden | `.git/consolidation/workspace-bench-final.log`, `tools/headless/results/bench-2026-09-30.json` |
| `./tools/heavy pnpm bench:nav -- --quick` | Exit 0, 200 Anfragen in 7/8 Ticks | `.git/consolidation/nav-quick-final.log`, `packages/nav/bench/results/spk3-2026-09-29-quick.json` |
| `./tools/heavy pnpm bench:spk2 -- --quick` | Exit 0, 12 Szenarienläufe, `SPK2_PARAMS` bestanden | `.git/consolidation/spk2-quick-final.log`, `tools/headless/results/spk2.json` |
| `./tools/heavy pnpm bench:ms3 -- --quick` | Exit 0, vier funktionale Goldens, zwei Fahrtszenarien, drei Browser-Tick- und sechs Browser-Burstfälle bestanden | `.git/consolidation/ms3-quick-final.log`, `tools/headless/results/ms3-1790725699711.json` |
| `./tools/heavy pnpm --filter @faf/render smoke` | Exit 0, drei Engines bestanden | `.git/consolidation/render-smoke-final.log`, `.git/consolidation/render-artifacts/render-smoke-final.json` |

Der volle Workspace-Headless-Lauf misst 1.000 fahrende Einheiten mit Pathing auf Hollow Ridge: maximales Sim-Tick-p95 2,44 ms (Firefox kalt, Ziel 8 ms), SPK1-Prototyp-p95 1,104 ms (Ziel 25 ms), Hash-Tick-p95 maximal 0,5762 ms (Ziel 2 ms). Dies sind aktuelle lokale MS3-Werte. Der JSON-Schlüssel `decisions.ms2TickRidge` bleibt aus dem bestehenden Berichtsschema erhalten; seine Last in diesem Lauf ist ausdrücklich MS3. Die früheren MS2-Zeittabellen wurden nicht ersetzt.

Im frischen MS3-Quick-Lauf bestanden ridge-group-offset (3.600 Ticks/6 Assertions), ridge-shift-queue (1.600/7), choke-3wu (600/4) und obstacle-repath (300/25). Beide 200er-Fahrtszenarien fahren nach einem Tick los: Hollow Ridge 200/200 Ankünfte, 1.024-WU-Basiskarte 197/200, jeweils null blockierte Positionen und null Stalls über 30 Ticks. Alle erfassten Bursts einschließlich dreier Warm-ups je Engine/Kartengröße bestätigen 200 Ready in höchstens zehn Ticks, genau 200 Einzelanfragen und eine Anfrage für die 50er-Gruppe.

| Engine | WU | kalt p95 ms | warm p95 ms | Ready-Ticks kalt/warm | Gruppe kalt/warm |
|---|---:|---:|---:|---:|---:|
| node | 512 | 5.8859 | 2.5769 | 5/5 | 1/1 |
| node | 1024 | 7.2010 | 2.8124 | 9/9 | 1/1 |
| chromium | 512 | 5.2000 | 2.4000 | 5/5 | 1/1 |
| chromium | 1024 | 6.6550 | 2.8850 | 9/9 | 1/1 |
| firefox | 512 | 5.6400 | 3.6200 | 5/5 | 1/1 |
| firefox | 1024 | 7.2400 | 3.8800 | 9/9 | 1/1 |
| webkit | 512 | 5.0000 | 2.0000 | 5/5 | 1/1 |
| webkit | 1024 | 6.0000 | 3.0000 | 9/9 | 1/1 |

Dieser Quick-Lauf aktiviert `FAF_PERF_GATE` nicht. Sieben der acht kalten Burst-p95-Werte liegen über 5 ms, WebKit/512 liegt genau auf 5 ms; warme Werte liegen bei 2,0..3,88 ms. Der frühere ausdrücklich gegatete 5-ms-Lauf bleibt ein fehlgeschlagener Performance-Nachweis. Das Exit 0 des aktuellen funktionalen Laufs hebt diesen Befund nicht auf. Auch der standalone Nav-Quick-Lauf meldet kalte p95 von 11,36/5,81 ms; seine warmen p95 liegen bei 2,57/2,78 ms. Workloads, Budgets und Gates wurden nicht angepasst.

Der Basis-Render-Smoke prüft echte GPU-/Pixelpfade in Chromium, Firefox und WebKit: je 0/10.000 CPU/GPU-Projektionsabweichungen, Icon-Atlas und Context-Restore bestanden, Z2 genau ein Icon-Draw und null Unit-Mesh-Draws, 2.000 Z2-Einheiten in sechs Gesamt-Draws. Screenshots werden im Runner unmittelbar im Speicher ausgewertet; er schreibt keine einzelnen PNG-Belege. Sein strukturiertes JSON wurde vor der späteren Spiel-Playwright-Ausgabe bytegleich gesichert; SHA-256 und ursprünglicher Pfad stehen in `.git/consolidation/render-smoke-final-receipt.json`.

Der Workspace-Aufruf führte auch den AI-Benchmark erneut aus. Die vier tatsächlichen JSON-Gates `normalThink`, `ops`, `timeouts` und `scheduler` sind grün; ein Welt-Tick-Vergleich ±2 % ist kein Gate dieses Berichts und dadurch nicht belegt. Das separate AI-Abschluss-JSON und -Log bleiben unverändert erhalten. Der Workspace-Rohbericht ist `tools/ai-arena/results/bench-2026-09-29-workspace-final.json`; sein ursprünglicher, vom Paket-CWD abhängiger Ausgabeort ist in `.git/consolidation/workspace-bench-provenance.json` vermerkt. Der Pfadfehler wird separat behoben.

Der aktuelle SPK3-Headless-Vergleich war bereits mit zwei passenden Quellständen belegt und wurde nicht erneut ausgeführt. Alle eigenen Benchmark-/Browserprozesse dieser Abschlusssequenz sind beendet.
