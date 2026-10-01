# MS3-Keyframe-Messung

Lokal gemessen am 2026-09-30, Apple M5 Pro, Node v24.18.0, `SIM_BUILD=faf-sim/ms3.0`. Befehl: `./tools/heavy pnpm --filter @faf/headless bench:keyframes -- --quick`. Genau ein Quicklauf mit einem ungemessenen Warmup und fünf gemessenen Wiederholungen pro Codec und Operation. Kein Capture-/Restore-Timinggate; Exit 0 bestätigt die Hashprüfung aller Restores.

Die Testebene hält 1.000, hollow-ridge 947 und setons 2.000 Einheiten bei Tick 600. hollow-ridge fordert unverändert 1.000 Spawns an; die aktuelle Simulation hält davon 947. Die tatsächliche Last steht in der Tabelle. Die früheren MS2-Tabellen in p2 bleiben historische Messwerte.

Szenen nach 600 Ticks Bewegung, je Codec 5 gemessene Wiederholungen (Median = p50). capture = Session-Snapshot (memcpy) + Kompression, restore = Inflate + `restoreSnapshot`; „blockierend“ = Anteil, auf den der Tick wartet (nativ: nur memcpy). Nativ = `CompressionStream('deflate-raw')`.

| Szene | Einheiten | Snapshot | Codec | komprimiert | Rate | capture p50 / p95 | blockierend p50 | restore p50 / p95 | Restore-Hash |
|---|---|---|---|---|---|---|---|---|---|
| testplane-1000 | 1.000 | 7.235.512 B | fflate-1 (Standard) | 98.681 B | 1,36 % | 28,3 / 31,1 ms | 28,3 ms | 5,25 / 11,0 ms | gleich |
| testplane-1000 | 1.000 | 7.235.512 B | fflate-6 | 85.831 B | 1,19 % | 34,1 / 34,5 ms | 34,1 ms | 4,97 / 5,58 ms | gleich |
| testplane-1000 | 1.000 | 7.235.512 B | fflate-9 | 84.151 B | 1,16 % | 141,2 / 142,2 ms | 141,2 ms | 5,23 / 5,81 ms | gleich |
| testplane-1000 | 1.000 | 7.235.512 B | native | 97.792 B | 1,35 % | 10,5 / 11,0 ms | 0,183 ms | 6,05 / 6,18 ms | gleich |
| hollow-ridge-1000 | 947 | 7.235.512 B | fflate-1 (Standard) | 159.855 B | 2,21 % | 28,9 / 29,6 ms | 28,9 ms | 5,69 / 6,88 ms | gleich |
| hollow-ridge-1000 | 947 | 7.235.512 B | fflate-6 | 137.207 B | 1,90 % | 45,8 / 46,2 ms | 45,8 ms | 5,23 / 5,74 ms | gleich |
| hollow-ridge-1000 | 947 | 7.235.512 B | fflate-9 | 133.181 B | 1,84 % | 199,4 / 201,5 ms | 199,4 ms | 5,11 / 5,42 ms | gleich |
| hollow-ridge-1000 | 947 | 7.235.512 B | native | 149.257 B | 2,06 % | 15,6 / 16,0 ms | 0,166 ms | 6,62 / 7,92 ms | gleich |
| setons-2000 | 2.000 | 15.029.176 B | fflate-1 (Standard) | 309.420 B | 2,06 % | 60,3 / 61,2 ms | 60,3 ms | 13,6 / 14,8 ms | gleich |
| setons-2000 | 2.000 | 15.029.176 B | fflate-6 | 271.071 B | 1,80 % | 99,8 / 100,7 ms | 99,8 ms | 12,7 / 13,7 ms | gleich |
| setons-2000 | 2.000 | 15.029.176 B | fflate-9 | 259.715 B | 1,73 % | 389,6 / 392,0 ms | 389,6 ms | 12,0 / 13,8 ms | gleich |
| setons-2000 | 2.000 | 15.029.176 B | native | 294.657 B | 1,96 % | 33,2 / 33,5 ms | 0,294 ms | 12,9 / 15,3 ms | gleich |

memcpy allein (Session-Snapshot in wiederverwendeten Puffer):

| Szene | p50 | p95 |
|---|---|---|
| testplane-1000 | 0,130 ms | 0,160 ms |
| hollow-ridge-1000 | 0,096 ms | 0,097 ms |
| setons-2000 | 0,196 ms | 0,199 ms |

Hochrechnung Keyframe-Speicher (alle 600 Ticks, Budget 128,0 MiB, Ausdünnung wie im Store; Keyframe-Größe konstant = Szene bei Level 1):

| Szene | Partie | Keyframes aufgenommen / gehalten | Intervall | Ausdünnungen | Speicher komprimiert | unkomprimiert (gehalten / Ausdünnungen) |
|---|---|---|---|---|---|---|
| testplane-1000 | 30 min | 31 / 31 | 600 Ticks | 0 | 2,9 MiB | 110,4 MiB (16 KF, 1×) |
| testplane-1000 | 3 h | 181 / 181 | 600 Ticks | 0 | 17,0 MiB | 82,8 MiB (12 KF, 4×) |
| hollow-ridge-1000 | 30 min | 31 / 31 | 600 Ticks | 0 | 4,7 MiB | 110,4 MiB (16 KF, 1×) |
| hollow-ridge-1000 | 3 h | 181 / 181 | 600 Ticks | 0 | 27,6 MiB | 82,8 MiB (12 KF, 4×) |
| setons-2000 | 30 min | 31 / 31 | 600 Ticks | 0 | 9,1 MiB | 114,7 MiB (8 KF, 2×) |
| setons-2000 | 3 h | 181 / 181 | 600 Ticks | 0 | 53,4 MiB | 86,0 MiB (6 KF, 5×) |

Alle zwölf Szene-/Codec-Kombinationen reproduzierten Regel- und Voll-Hash. Native Deflate-Streams waren verfügbar, `errors=[]`. Die Speicherwerte für 30 Minuten und drei Stunden sind Hochrechnungen mit konstanter Keyframe-Größe je Szene; die tatsächlich gehaltenen 31 Keyframes der vollständigen Langpartie messen 6.428.425 B, siehe [p5-benchmark.md](p5-benchmark.md).

Während des exklusiven Messfensters liefen keine weiteren Test- oder Benchmarkprozesse. Normale System-/VM-Hintergrundlast blieb aktiv. Der vorher beobachtete H3-Optimierungslauf war vor Beginn beendet; der idle H3-Server wurde nicht verändert. Prozessvorprüfung: `.git/consolidation/replay-measurement-conditions.log`. Rohbericht: `tools/headless/results/keyframes-2026-09-30.json`; vollständige Ausgabe: `.git/consolidation/replay-keyframes-ms3-final.log`.
