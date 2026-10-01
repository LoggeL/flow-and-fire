# TRACK-AI Arena-Turnier

Messung 2026-09-30 auf finaler AI-Logik. Rohreport: `tools/ai-arena/results/ms9-2026-09-30.json`. Prozess Exit 0, Worker-Pool 4 gestartet/4 beendet.

Spiele: 210, Crashes: 0, Remis: 144.

| Gate | Messwert | Ergebnis |
|---|---:|---|
| T2 <= 720 s | 210/210, Wilson-Untergrenze 98.20 % | true |
| Welle <= 480 s | 210/210, Wilson-Untergrenze 98.20 % | true |
| Idle < 15 % | 14.25 % maximal | true |
| Energie-Stall (gepoolte tatsächliche Ticks) | 0.70 % | Bericht, kein MS9-Gate |

Gates: {"sampleSize":true,"t2":true,"wave":true,"idle":true,"crashes":true,"timeouts":true,"apm":true,"ops":true}

Eine Army pro Spiel wird nach Seed-Parität für T2, Welle und Gruppen ausgewählt. Idle, APM, Ops, Timeouts und Energie-Stall berücksichtigen beide Armies. Energie-Stall ist hier eine Berichtszahl; das <=5-%-MS10-Ziel ist kein MS9-Turnier-Gate. Ein niedriger gepoolter Wert beweist nicht, dass jede einzelne Army unter 5 % liegt. Crashes bleiben im Nenner. Ergebnisquoten zählen Remis zur Hälfte.

## Paarungen

| Paarung (Seite A) | Spiele | Siege | Remis | Ergebnisquote mit halben Remis | Wilson 95 % | Elo-Differenz |
|---|---:|---:|---:|---:|---|---:|
| normal-vs-normal | 210 | 33 | 144 | 50.00 % | 43.30 % bis 56.70 % | 0.0 |

## Karten

| Gruppe | Spiele | T2 ≤ 720 s | Wilson-Untergrenze | Welle ≤ 480 s | Wilson-Untergrenze | Idle maximal | E-Stall, Mittel der Spiele |
|---|---:|---:|---:|---:|---:|---:|---:|
| hollow-ridge | 70 | 70/70 | 94.80 % | 70/70 | 94.80 % | 2.43 % | 0.32 % |
| tessera | 70 | 70/70 | 94.80 % | 70/70 | 94.80 % | 7.59 % | 1.46 % |
| setons | 70 | 70/70 | 94.80 % | 70/70 | 94.80 % | 12.68 % | 0.47 % |

## Eröffnungen

| Gruppe | Spiele | T2 ≤ 720 s | Wilson-Untergrenze | Welle ≤ 480 s | Wilson-Untergrenze | Idle maximal | E-Stall, Mittel der Spiele |
|---|---:|---:|---:|---:|---:|---:|---:|
| eco_standard | 104 | 104/104 | 96.44 % | 104/104 | 96.44 % | 12.68 % | 0.34 % |
| land_rush | 58 | 58/58 | 93.79 % | 58/58 | 93.79 % | 7.59 % | 0.98 % |
| tech_greed | 48 | 48/48 | 92.59 % | 48/48 | 92.59 % | 6.71 % | 1.36 % |

## Ausreißer

- Seed 20, tessera, Seiten getauscht: false; Army 0: T2 565.2 s, E-Stall 0.00 %, Timeouts 0; Army 1: T2 562.1 s, E-Stall 13.99 %, Timeouts 0
- Seed 20, tessera, Seiten getauscht: true; Army 0: T2 565.2 s, E-Stall 0.00 %, Timeouts 0; Army 1: T2 562.1 s, E-Stall 13.99 %, Timeouts 0
- Seed 29, tessera, Seiten getauscht: false; Army 0: T2 471.9 s, E-Stall 2.22 %, Timeouts 0; Army 1: T2 439.0 s, E-Stall 12.24 %, Timeouts 0
- Seed 29, tessera, Seiten getauscht: true; Army 0: T2 471.9 s, E-Stall 2.22 %, Timeouts 0; Army 1: T2 439.0 s, E-Stall 12.24 %, Timeouts 0
- Seed 42, setons, Seiten getauscht: false; Army 0: T2 481.0 s, E-Stall 0.00 %, Timeouts 0; Army 1: T2 402.7 s, E-Stall 15.96 %, Timeouts 0
- Seed 42, setons, Seiten getauscht: true; Army 0: T2 481.0 s, E-Stall 0.00 %, Timeouts 0; Army 1: T2 402.7 s, E-Stall 15.96 %, Timeouts 0
- Seed 59, tessera, Seiten getauscht: false; Army 0: T2 472.1 s, E-Stall 0.00 %, Timeouts 0; Army 1: T2 438.5 s, E-Stall 15.65 %, Timeouts 0
- Seed 59, tessera, Seiten getauscht: true; Army 0: T2 472.1 s, E-Stall 0.00 %, Timeouts 0; Army 1: T2 438.5 s, E-Stall 15.65 %, Timeouts 0

Arena-Ergebnisse sind keine Abnahme der echten Sim. Die Difficulty-Suite liefert nur einen Bericht, die MS9-Gates gelten dort nicht als Abnahmekriterium. Vollständige Spiel-, Seed-, APM-, Ops- und Timeout-Daten stehen im zugehörigen JSON unter tools/ai-arena/results/.
