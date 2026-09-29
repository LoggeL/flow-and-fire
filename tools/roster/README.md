# Roster-Werkzeuge

Python-Skripte, mit denen `docs/design/roster.json` und `roster.md` erzeugt und geprüft wurden
(Fraktion Varkan-Kompakt). `fa_ref.json` enthält die FA-Referenzwerte (spooky-db 3810) nur als Zahlen-Relationen.

- `gen.py` erzeugt `roster.json`, `md.py` (+ `md_*.py`) erzeugt `roster.md`, `validate.py` prüft ±25 %-Grenzen.
- Ausführen im Ordner `tools/roster/`; Ausgabepfade ggf. in den Skripten anpassen.
