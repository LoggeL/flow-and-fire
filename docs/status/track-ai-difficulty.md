# TRACK-AI Arena-Turnier

Messung 2026-09-30 auf finaler AI-Logik. Rohreport: `tools/ai-arena/results/diff-2026-09-30.json`. Prozess Exit 0, Worker-Pool 4 gestartet/4 beendet.

Spiele: 120, Crashes: 0, Remis: 65.

| Gate | Messwert | Ergebnis |
|---|---:|---|
| T2 <= 720 s | 120/120, Wilson-Untergrenze 96.90 % | true |
| Welle <= 480 s | 120/120, Wilson-Untergrenze 96.90 % | true |
| Idle < 15 % | 12.12 % maximal | true |
| Energie-Stall (gepoolte tatsächliche Ticks) | 0.52 % | Bericht, kein MS9-Gate |

Gates: {"sampleSize":false,"t2":true,"wave":true,"idle":true,"crashes":true,"timeouts":true,"apm":true,"ops":true}

Eine Army pro Spiel wird nach Seed-Parität für T2, Welle und Gruppen ausgewählt. Idle, APM, Ops, Timeouts und Energie-Stall berücksichtigen beide Armies. Energie-Stall ist hier eine Berichtszahl; das <=5-%-MS10-Ziel ist kein MS9-Turnier-Gate. Ein niedriger gepoolter Wert beweist nicht, dass jede einzelne Army unter 5 % liegt. Crashes bleiben im Nenner. Ergebnisquoten zählen Remis zur Hälfte.

## Paarungen

| Paarung (Seite A) | Spiele | Siege | Remis | Ergebnisquote mit halben Remis | Wilson 95 % | Elo-Differenz |
|---|---:|---:|---:|---:|---|---:|
| normal-vs-easy | 60 | 23 | 34 | 66.67 % | 54.06 % bis 77.27 % | 120.4 |
| hard-vs-normal | 60 | 15 | 31 | 50.83 % | 38.52 % bis 63.05 % | 5.8 |

## Karten

| Gruppe | Spiele | T2 ≤ 720 s | Wilson-Untergrenze | Welle ≤ 480 s | Wilson-Untergrenze | Idle maximal | E-Stall, Mittel der Spiele |
|---|---:|---:|---:|---:|---:|---:|---:|
| hollow-ridge | 40 | 40/40 | 91.24 % | 40/40 | 91.24 % | 6.56 % | 0.00 % |
| tessera | 40 | 40/40 | 91.24 % | 40/40 | 91.24 % | 12.12 % | 0.80 % |
| setons | 40 | 40/40 | 91.24 % | 40/40 | 91.24 % | 11.58 % | 0.37 % |

## Eröffnungen

| Gruppe | Spiele | T2 ≤ 720 s | Wilson-Untergrenze | Welle ≤ 480 s | Wilson-Untergrenze | Idle maximal | E-Stall, Mittel der Spiele |
|---|---:|---:|---:|---:|---:|---:|---:|
| eco_standard | 83 | 83/83 | 95.58 % | 83/83 | 95.58 % | 12.12 % | 0.22 % |
| land_rush | 25 | 25/25 | 86.68 % | 25/25 | 86.68 % | 6.56 % | 0.44 % |
| tech_greed | 12 | 12/12 | 75.75 % | 12/12 | 75.75 % | 4.75 % | 1.44 % |

## Ausreißer

- Seed 14, tessera, Seiten getauscht: false; Army 0: T2 483.4 s, E-Stall 0.00 %, Timeouts 0; Army 1: T2 655.2 s, E-Stall 13.35 %, Timeouts 0
- Seed 1, hollow-ridge, Seiten getauscht: false; Army 0: T2 608.9 s, E-Stall 18.16 %, Timeouts 0; Army 1: T2 545.7 s, E-Stall 0.00 %, Timeouts 0
- Seed 7, hollow-ridge, Seiten getauscht: false; Army 0: T2 608.9 s, E-Stall 12.14 %, Timeouts 0; Army 1: T2 545.7 s, E-Stall 0.00 %, Timeouts 0
- Seed 20, tessera, Seiten getauscht: true; Army 0: T2 565.2 s, E-Stall 0.00 %, Timeouts 0; Army 1: T2 559.7 s, E-Stall 15.04 %, Timeouts 0

Arena-Ergebnisse sind keine Abnahme der echten Sim. Die Difficulty-Suite liefert nur einen Bericht, die MS9-Gates gelten dort nicht als Abnahmekriterium. Vollständige Spiel-, Seed-, APM-, Ops- und Timeout-Daten stehen im zugehörigen JSON unter tools/ai-arena/results/.
