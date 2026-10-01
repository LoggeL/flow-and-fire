# Replay-Messung

Lokal gemessen am 2026-09-30, Apple M5 Pro, Node v24.18.0. 30 Minuten Spielzeit, 120 APM pro Armee. Aufnahme und Konvertierung vor der Messung; Replay und Original-End-Hashes als Dateien. Kalt: frischer Node-Prozess ohne vorherige Simulation. Warm: separater Node-Prozess nach einem vollständigen ungemessenen Durchlauf. Die Zeit umfasst Öffnen, Wiedergabe, Regel-/Sub-Hash-Prüfung und Keyframe-Aufbau; Prozessstart und Datei-IO liegen außerhalb. Betriebssystem-Dateicaches werden nicht geleert. Alle Seek-Ziele stimmen im Regel- und Voll-Hash mit dem Direktlauf ohne Keyframes überein.

| Lauf | Gesamt B | CMDS B | kalt / warm x Echtzeit | Seek Median ms | p95 ms | max ms | Keyframes B |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 86380 | 65424 | 300.0 / 309.7 | 159.8 | 189.4 | 199.1 | 6428425 |
| 2 | 86380 | 65424 | 303.4 / 306.9 | 155.7 | 183.0 | 189.6 | 6428425 |

Gates: jede Wiedergabe mindestens 20x, Seek-p95 höchstens 2000 ms. Ergebnis: bestanden. JSON mit Prozess-IDs, Original-End-Hashes und jedem Seek-Hash: tools/headless/results/replay-bench-2026-09-30.json.

Je Lauf wurden alle 1.800 Regel- und 180 Sub-Hash-Zeilen geprüft. Alle 50 Rückwärts-Seek-Ziele (20 feste Zufallsziele und 30 Keyframe-Ticks minus 1) stimmen mit einem Direktlauf ohne Keyframes im Regel- und Voll-Hash überein. Endtick 18.000; End-Regel-Hash 2.400.793.435, End-Voll-Hash 3.608.459.888. Die beiden Aufnahmen hatten je 7.200 Spielerbefehle (3.600 je Armee, genau 120 APM), 639 dokumentierte Cheat-Envelopes und 374 lebende Einheiten am Ende. Die gehaltenen 31 Keyframes messen 6.428.425 B; das unkomprimierte Äquivalent beträgt 224.300.872 B.

Prozesse: Parent 22370, kalt/warm in Lauf 1 22393/22418 und in Lauf 2 22529/22575. Beide frischen Kinder pro Lauf sind voneinander und vom Aufnahmeprozess verschieden. Alle Prozesse endeten mit Exit 0. Zwei vorherige 10-Minuten-Läufe bestanden ebenfalls: kalt 292,6 bis 296,6x, warm 303,0 bis 306,0x, Seek-p95 172,3 bis 186,9 ms; Quick-Rohbericht `tools/headless/results/replay-bench-2026-09-30-quick.json`.

Messbedingungen: Nach Abschluss der globalen Tests liefen die Replay-Befehle exklusiv und sequenziell über `./tools/heavy`. Der vorher beobachtete H3-Optimierungslauf PID 18324 war beendet; der idle H3-Server und normale System-/VM-Hintergrundlast blieben aktiv. Im erfassten laufenden Full-Snapshot war der Replay-Prozess die einzige schwere Rechenlast; kein fremder Test-/Benchmarkprozess wurde beobachtet. Die Vorprüfung steht in `.git/consolidation/replay-measurement-conditions.log`; Ausgaben in `.git/consolidation/replay-bench-quick-final.log` und `.git/consolidation/replay-bench-full-final.log`. Die Grenzwerte und Workloads wurden für die Messung nicht verändert.
