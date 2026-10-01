# Track REPLAY: Vorarbeit für MS11/N1 und S10

Stand 2026-09-30. Der integrierte MS3-Arbeitsstand enthält einen portablen Replay-Container, komprimierte Keyframes, FAFL-Export, Headless-Wiedergabe und Diagnosewerkzeuge. Die neun Golden-Replays wurden für `faf-sim/ms3.0` regeneriert. Der Browser-Viewer bleibt Teil von MS11.

| Bereich | Dateien und Detailnachweis |
|---|---|
| Setup und Größenmodell | `packages/formats/src/deflate.ts`, `tools/headless/src/replay/synthetic.ts`; [p0](track-replay/p0.md) |
| Container | `packages/formats/src/rtsreplay/`; [p1](track-replay/p1.md) |
| Keyframes und Sub-Hashes | `packages/sim-host/src/replay/{keyframes-compressed,native-deflate,sub-hashes}.ts`; [p2](track-replay/p2.md) |
| Aufnahmen, Langpartie und Zustandsdiagnose | `tools/headless/src/replay/{scenario-log,long-game,dump,state-diff,divergence}.ts`; [p3](track-replay/p3.md) |
| Export und Player | `packages/sim-host/src/replay/{convert,source,player,opfs-export}.ts`; [p4](track-replay/p4.md) |
| CLI und Performance | `tools/headless/scripts/{replay-verify,desync-diff,bench-replay,replay-bench-worker}.ts`; [p5](track-replay/p5.md) |
| Goldens und Cross-Engine | `test/golden-replays/`, `tools/headless/src/replay/xengine-job.ts`; [p6](track-replay/p6.md) |
| Konsolidierung | [p7](track-replay/p7.md) |

Formatversion 1 verwendet Magic `RTSR`. Jeder Chunk hat 4CC, little-endian u32 Länge, Vierbyte-Padding und CRC-32; bekannte Chunks beginnen mit u16 Chunkversion 1. HEAD enthält Build-, Protokoll-, Sim-, Blueprint-, Karten- und Layoutidentität sowie Hashintervalle und Flags. GAME enthält Seed, Kartengröße, Armeen, AIx und Allianzbits. CMDS speichert unabhängig dekodierbare 600-Tick-Blöcke. HASH trägt Regel-Hashes und benannte Sub-Hashes, MARK die Ablauf-/Taint-Ereignisse und META kanonisches JSON für Dauer, Spieler, Ergebnis und Stats. Das genaue Bytelayout steht in [p1](track-replay/p1.md).

HEAD und GAME stehen zuerst, danach folgen lückenlose Commandblöcke, HASH, MARK und optional META. Unbekannte Chunks nach HEAD/GAME bleiben bytegleich erhalten. Reader, Writer und Builder prüfen Versionen, Reihenfolge, Pflichtchunks, CRCs, Reservierungen, Batches, Taint-Konsistenz und Timeline. Ein META-Endtick darf keine spätere Command-, Hash-, Sub-Hash- oder Mark-Evidenz abschneiden. Ohne META ermitteln Quelle und Player das Ende aus sämtlicher Aufnahmeevidenz; leere Endblöcke verdecken keine früheren Commands.

Die CMDS-Kodierung nutzt einen adaptiven Range-Coder und kanonischen fflate-Deflate Level 6. Wenn Deflate die Symbole vergrößert, speichert codec 0 diese direkt. Native codec-1-Streams aus zlib und CompressionStream sind lesbar. Das ist eine begründete Abweichung von der zuerst geplanten einfachen Varint-Kodierung: Sie erfüllte das unveränderte Größenmodell nicht. APM, Selektionsgrößen und Fx-Positionspräzision wurden für das Gate nicht abgesenkt.

`convertCommandLog` erhält Commands, Markreihenfolge und Regel-Hashes aus FAFL v1/v2. Für kompatible v2-Sitzungen simuliert es Sub-Hashes für die 13 aktuellen Regelregionen nach und prüft jeden aufgenommenen Regel-Hash. Legacy- oder fremde Aufnahmen bleiben exportierbar, erhalten Warnungen und keine unzuverlässigen Sub-Hashes; der Player lehnt inkompatible Builds vor Tick 1 mit `ReplayCompatError` und `/b/<buildHash>/` ab. Crash-Präfixe reichen bis zum letzten gültigen Eintrag und tragen Truncated. Cheat, DevReload und Restore setzen Tainted. OPFS verwendet denselben Exportpfad. GAME-Allianzen werden vor Nachsimulation und Tick-0-Snapshot gesetzt.

`ReplayPlayer` bietet `step`, `runUntil`, `seek`, `playToEnd`, Regel-/Voll-Hash und Verifikationszahlen. Die Prüfung umfasst alle gespeicherten Rasterpunkte, auch Tick 0 und Raster außerhalb der live verwendeten zehn Ticks. Sub-Hash-Abweichungen nennen Regionen; erneute Seeks zählen bereits geprüfte Ticks nicht doppelt. Die Quelle hält höchstens zwei dekodierte Commandblöcke.

Keyframes halten komprimierte Session-Snapshots alle 600 Ticks, fflate Level 1, mit 128 MiB Kompressatbudget. Bei Überschreitung wird das Raster adaptiv ausgedünnt; wenigstens zwei Keyframes bleiben erhalten. Scratch-/Native-Poolpuffer zählen nicht zum Budget. Rückwärts-Seek stellt den neuesten vorhandenen Keyframe bis zum Ziel wieder her, sonst Tick 0, und simuliert bis zum Ziel nach. Spätere Keyframes bleiben nach einem Rücksprung verfügbar. Jeder Benchmark-Seek prüft Regel- und Voll-Hash gegen einen Direktlauf ohne Keyframes. Die Kompressionszeiten in p0/p2/p3 sind historische MS2-Messwerte. Die separate aktuelle [MS3-Keyframe-Messung](track-replay/p2-ms3-benchmark.md) bestand für fflate-Level 1/6/9 und native Deflate-Streams in allen drei Szenen mit gleichem Regel- und Voll-Hash beim Restore. Level 1 erreichte Capture-p50 28,3 bis 60,3 ms und Restore-p50 5,25 bis 13,6 ms; nativ lag der blockierende Snapshotanteil bei 0,166 bis 0,294 ms. Der Quicklauf verwendet fünf Messwiederholungen nach Warmup, kein Capture-Zeitgate. Die tatsächliche hollow-ridge-Szene hält 947 der unverändert angeforderten 1.000 Einheiten.

Der unveränderte synthetische 30-Minuten-Strom enthält 2 × 120 APM, 7.200 Envelopes und 13 Sub-Hash-Regionen. Lokal gemessen auf Apple M5 Pro: CMDS 80.444 B, gesamte Datei 97.680 B. Damit bestehen CMDS ≤ 100.000 B und Gesamt ≤ 250.000 B. Das zusätzliche 200-APM-Modell hat kein Gate. Die sim-valide Langpartie verwendet echte Move/Stop-Befehle auf hollow-ridge, mit dokumentierten Cheat-Commands für Nachschub/Verluste außerhalb der APM-Zählung.

Der Prozessbenchmark schreibt Replay und ursprüngliche End-Regel-/Voll-Hashes vor der Messung. Kalt startet in einem frischen Node-Prozess ohne vorherige Simulation; warm startet separat und spielt die Partie zunächst vollständig ungemessen. Öffnen, Wiedergabe, Hashprüfung und Keyframe-Aufbau werden gemessen. Import, Prozessstart und Datei-IO liegen außerhalb; Betriebssystemcaches werden nicht geleert. Zwei vollständige 30-Minuten-Läufe bestanden jeweils die unveränderten Gates ≥ 20x Wiedergabe und Rückwärts-Seek-p95 ≤ 2000 ms: kalt 300,0 bis 303,4x, warm 306,9 bis 309,7x, Seek-p95 183,0 bis 189,4 ms und Maximum 199,1 ms. Je Wiedergabe wurden 1.800 Regel- und 180 Sub-Hash-Zeilen geprüft, je Lauf 50 Seek-Ziele gegen unabhängige Regel-/Voll-Hash-Baselines. Die sim-valide Partie hatte exakt 120 APM je Armee, 86.380 B gesamt und 65.424 B CMDS; 31 gehaltene Keyframes beanspruchten 6.428.425 B. Zwei 10-Minuten-Vorläufe bestanden ebenfalls. Alle Prozesse endeten mit Exit 0. Gemessen wurde nach Ende der globalen Tests und des vorher beobachteten fremden H3-Optimierungslaufs im exklusiven Zeitfenster; Userprozesse blieben unverändert. Methodik und vollständige Messwerte stehen in [p5](track-replay/p5.md) und [p5-benchmark](track-replay/p5-benchmark.md).

```sh
pnpm --filter @faf/headless replay-verify -- --goldens
pnpm --filter @faf/headless replay-verify -- match.rtsreplay --until 1000 --json
pnpm --filter @faf/headless replay-verify -- match.faflog --map content/maps/hollow-ridge.rtsmap
pnpm --filter @faf/headless desync-diff -- a.rtsreplay b.rtsreplay
pnpm --filter @faf/headless desync-diff -- --dump a.rtsreplay --tick 1100 --out a.rtsdump
pnpm --filter @faf/headless desync-diff -- a.rtsdump b.rtsdump
./tools/heavy pnpm --filter @faf/headless replay-size
./tools/heavy pnpm --filter @faf/headless bench:replay -- --quick
./tools/heavy pnpm --filter @faf/headless bench:replay -- --update-docs
```

`replay-verify` liefert Exit 0 bei Übereinstimmung, 1 bei Hashabweichung und 2 bei Format-, Kompatibilitäts- oder Eingabefehler. Die deutsche Tabelle beziehungsweise `--json` nennt Ticks, geprüfte Regel-/Sub-Hash-Zeilen, Ergebnis und Tempo. Eine HASH-Mutation meldet ihren exakten Tick, erwartet/ist und verfügbare Regionen. `desync-diff` liefert 0 bei identischen Zuständen, 1 bei reproduzierter Divergenz, 2 bei ungültiger/inkompatibler Eingabe und 3 bei nur im Aufnahmetrail vorhandener Abweichung. Zwei frische Sitzungen werden an jedem Tick verglichen, um kurzzeitige Divergenzen zu finden. Am ersten Unterschied werden Region, Spalte, Entity/Slot und Werte aus Voll-Dumps genannt. Ein geändertes Move-Ziel bei Tick 1100 wurde genau dort mit Unit-/Mover-/Order-Einträgen erkannt; eine `units.hp`-Mutation an Slot 5 bei Tick 77 wurde genau dort erklärt. Relative CLI-Pfade beziehen sich auf das Aufrufverzeichnis.

Nach einem Sim-Regelbump wird die Identität angehoben, dann werden in dieser Reihenfolge Goldens, Logs und Replays regeneriert. Ohne `--update` prüfen die Befehle deren Frische. Die Golden-Metadaten tragen den Szenarionamen, damit generierte Karten reproduzierbar aufgelöst werden.

```sh
./tools/heavy pnpm --filter @faf/headless goldens -- --update
./tools/heavy pnpm --filter @faf/headless golden-logs -- --update
./tools/heavy pnpm --filter @faf/headless replay-goldens -- --update
```

Cross-Engine, lokal gemessen auf Apple M5 Pro: 180 bestehende Hash-Chain-Läufe und 180 Replay-Läufe in Node, Chromium, Firefox und WebKit waren bitgleich, einschließlich Rückwärts-Seek und erneutem Lauf bis zum Ende. Die 54 Browser-Hash-/Replay-Specs bestanden. Der Gesamtbefehl mit `FAF_PERF_GATE=1` endete wegen des separaten MS3-PathService-5-ms-Gates mit Exit 1: alle acht kalten Burst-Fälle und Firefox 1024 WU warm lagen darüber. Die funktionale Projektion desselben Messberichts bestand; es wurde kein zweiter Lauf ohne Performance-Gate behauptet. Versionen, Laufzeiten und Originalbericht stehen in [p6](track-replay/p6.md).

| Abnahme aus TRACK-REPLAY.json | Stand | Beleg |
|---|---|---|
| Container, Versionierung, unbekannte Chunks, Kompressionskompatibilität | ✅ | 24 Formatfälle, einschließlich Zukunftsversionen und nativer CMDS-Streams, bestanden in 2,75 s |
| Mindestens 1.000 bytegleiche Roundtrips, Golden-Rewrite | ✅ | 2 × 1.000 gültige Stream-Properties, vielfältige CMDS-Predictoren/seq-Wrap, vier META-Fälle und neun Golden-Rewrite-Szenarien |
| Mindestens 10.000 Fuzz-Eingaben, begrenzte Blocklängen, FormatError | ✅ | 10.000 beliebige und 10.000 CRC-korrekte Junk-Container sowie Längen-/Zähler-/Expansionfehler bestanden |
| 30-Minuten-Größengate und Langpartiegröße | ✅ | `replay-size` Exit 0: synthetisch 97.680/80.444 B Gesamt/CMDS; sim-valide Langpartie 86.380/65.424 B, beide Modelle unverändert 120 APM je Armee |
| Komprimierte Keyframes, Budget, Hashgleichheit; Kompressionsmessung | ✅ | Keyframe-/Player-/Seektests bestanden; aktueller MS3-Quicklauf, alle zwölf Szene-/Codec-Restores bitgleich; [Messung](track-replay/p2-ms3-benchmark.md) |
| 30-Minuten-Playback ≥ 20x und Seek-p95 ≤ 2 s | ✅ | zwei vollständige isolierte Läufe, 300,0 bis 309,7x, Seek-p95 höchstens 189,4 ms; [Messung](track-replay/p5-benchmark.md) |
| FAFL v1/v2, OPFS, Crash-Präfixe, Taint und Sub-Hashes | ✅ | sieben Player-, zwei OPFS- und eine Allianzprüfung |
| Exakte Hashabweichung/Region und Identitätsfehler vor Tick 1 | ✅ | Player-/Desync- sowie Tick-0-/7-Tick-Rasterprüfungen bestanden |
| CLI-Exitcodes, Command-/Perturbation-Divergenz, Dumps | ✅ | zwei CLI- und vier Desync-Prüfungen |
| Alle aktuellen Goldens und Replay-Frische | ✅ | vier Golden-CLIs Exit 0 für neun Szenarien; SHA-256-Readback bestätigt alle 27 Golden-JSON-/FAFL-/RTSR-Dateien bytegleich |
| Cross-Engine und Rückwärts-Seek | ✅ | 360 bitgleiche Läufe; [p6](track-replay/p6.md) |
| Grenzen, globale Statik und alle Tests | ⚠️ | install/frozen-lockfile, Typecheck, Lint/Paketgrenzen, Build, Assetcheck und 2.921 Tests in 269 Dateien bestanden; ursprüngliche isolierte Git-Grenzen in gemeinsamer Integration nicht ausführbar |
| Deutsche Referenz, Abweichungen, Regenerierung und MS11/S10-Punkte | ✅ | Referenz, aktuelle Messberichte, dokumentierte Abweichungen und STATUS-Verweis vorhanden |

Die ursprünglichen isolierten Git-Grenzen sind im gemeinsamen Konsolidierungsarbeitsstand nicht als Replay-Gate ausführbar: Sim, Nav, Renderer, Client und Game enthalten gleichzeitig autorisierte Änderungen anderer Tracks. Das ist eine dokumentierte Integrationsabweichung. Die globale Statik einschließlich Dependency-Cruiser und Gesamttests bestand im Hauptlauf: Typecheck, Lint/Paketgrenzen, Gesamtbuild, Assetcheck und 2.921 Tests in 269 Dateien. Details und Abschlussnachweise stehen im Konsolidierungsbericht. Die generierten Hashketten wurden wegen des MS3-Bumps aktualisiert, statt die frühere MS2-Identität fälschlich als unverändert zu bezeichnen.

Offen für MS11: Replay-Browser/Viewer, automatische historische `/b/<buildHash>/`-Route, mindestens 5x Browser-Wiedergabe, echter OPFS-Tab-Kill bei Minute 10 mit mindestens 9:50 geretteter Aufnahme, Release-Hashkadenz 50, aiTimeout-Marks aus der KI-Pipeline und Live-Sub-Hash-Aufnahme. Fake-OPFS-Tests sind kein Tab-Kill-E2E. S10 kann Container, Identitätsprüfung und Snapshotcodec wiederverwenden; eine Save/Load-Benutzerfunktion ist nicht Teil dieses Tracks.
