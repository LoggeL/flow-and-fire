# ai-sim – Flow-Eco-Simulation der KI-Eröffnungen

Reine Eco-Rechnung (ohne Kampf) für `docs/design/ai-openings.json`; Design in `docs/design/ai.md` (§4.5, §10).
Kein Teil des Spiels und kein pnpm-Paket, nur ein Prüfskript für die Design-Zahlen.

- **Eingaben:** `docs/design/roster.json` (Kosten, Bauzeiten, Build Power, Einkommen, Speicher, Tempo),
  `docs/design/ai-openings.json` (Eröffnungen, Rollen, Annahmen), `content/maps/src/<karte>/{markers.json,heightmap.png}`.
- **Modell:** 10-Hz-Ticks; Flow-Verbrauch mit einer Stall-Ratio `min(Mass-Anteil, Energy-Anteil)` wie PLAN §3.4;
  Bauzeit = buildTime / Build Power; Laufwege über Pfad-Distanzen auf der Heightmap (Dijkstra, 2-WU-Raster,
  Neigung ≤ 0,6, Wassertiefe ≤ 0,5 WU) bzw. Luftlinie × Umweg-Faktor; nach der Eröffnung vereinfachte Manager
  (Energie-Bilanz, Mass-Senken mit „Energie zuerst“, Sättigungsregel, Tech-/Mex-Upgrades, Engineer-Task-Board
  mit Bau-Assist, Wellen mit Pflichtangriff) nach ai.md §5; Review-Stand ai.md §12.
- **Annahmen** stehen in `ai-openings.json → assumptions` (voller Startspeicher, Baureichweiten, Roll-off 2 s).

```sh
python3 tools/ai-sim/ecosim.py                        # Tabelle: alle Eröffnungen × Karten (Normal)
python3 tools/ai-sim/ecosim.py --difficulty easy      # dito mit Easy-Handicaps (difficultyTiming)
python3 tools/ai-sim/ecosim.py --timeline eco_standard --map setons   # Ereignisliste, Energie-Engpass-Fenster, Kennzahlen
python3 tools/ai-sim/ecosim.py --maps                 # Kartenanalyse: Zonen, Spots nach Pfad-Distanz
python3 tools/ai-sim/ecosim.py --threat               # Threat-Werte je Blueprint (ai.md §5.6)
python3 tools/ai-sim/ecosim.py --write-expect         # expect-Blöcke in ai-openings.json neu schreiben
python3 tools/ai-sim/ecosim.py --check                # expect vs. Simulation + MS9/MS10-Gates, Exit 1 bei Verstoß
```

Abhängigkeiten: Python ≥ 3.10, numpy, scipy, Pillow. Laufzeit < 5 s. Deterministisch (fester Seed für die
Easy-Fehlerrate). Ein Engpass-Fenster, das bis 12:00 anhält, ist ein Regelfehler, kein Rauschen. `--check` nach jeder Änderung an Roster-Kosten, Eröffnungen oder Karten laufen lassen; bei
gewollten Änderungen `--write-expect` und die Tabellen in ai.md §4.5 nachziehen.
