# Roster-Werkzeuge

Python-Skripte, mit denen `docs/design/roster.json` und `roster.md` erzeugt und geprüft wurden
(Fraktion Varkan-Kompakt). `fa_ref.json` enthält die FA-Referenzwerte (spooky-db 3810) nur als Zahlen-Relationen.

- `gen.py` erzeugt `roster.json`, `md.py` (+ `md_*.py`) erzeugt `roster.md`, `validate.py` prüft ±25 %-Grenzen.
- Ausführen im Ordner `tools/roster/`; Ausgabepfade ggf. in den Skripten anpassen.
- `validate.py [roster.json]` findet `docs/design/roster.json` relativ zum Skript (vorher fester Pfad auf einen alten Worktree).

## Fraktionsübergreifend

- `f2/`, `f3/`, `f4/`: Werkzeuge der Fraktionen Skarn, Sael und Aurith (je eigene `fa_ref.json` der Vorbild-Fraktion, siehe dortige README).
- `cross.py`: N × N-Prüfer aller Roster (Eco-Gleichstand, Kreuz-Treffer-bis-Tod, Gruppengefecht, T1-Rush, Phasen-Matrix mit Dominanz-
  und Identitäts-Gate, Icon-Grammatik, Namenskollisionen und FA-Namens-Grep). `python3 tools/roster/cross.py [--md]`, Exit-Code 1 bei Verstoß.
  Ergebnisse und Begründungen: `docs/design/factions/README.md`.
- `fa_names.json` (dev-only): alle Einheiten- und Waffennamen aus spooky-db 3810 für den Namens-Grep (von `cross.py` und `f3/validate.py` genutzt).
- `fa_ref.json` zählt seit dem Abgleich Doppelwaffen (spooky `WeaponNumber`) mit: `DEA0202` 2 × 75 Luft, `URA0102` 2 × 3 × 8 (Feld `count`).
