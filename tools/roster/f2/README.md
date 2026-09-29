# Roster-Werkzeuge f2 (Skarn-Geflecht)

Erzeugen und prüfen `docs/design/factions/f2/roster.json` und `roster.md` (Schema `faf-roster/1` wie Varkan).
Alle Skripte im Ordner `tools/roster/f2/` ausführen.

- `fa_extract.py <index.json>`: extrahiert die FA-Referenzwerte der Vorbild-Fraktion (Blueprints `UR*`, FAF-Ergänzungen `DR*`),
  dazu Varkans Referenzen als Gegenprobe, aus spooky-db `app/data/index.json` (Datenstand 3810) nach `fa_ref.json`.
  Nur Zahlen-Relationen, dev-only. Download: `curl -sSLo index.json https://raw.githubusercontent.com/FAForever/spooky-db/master/app/data/index.json`
- `gen.py`: schreibt `roster.json`. Erzwingt ±25 % hart und ±15 % (Einzelachsen, Produkt, Pulk), die Treffer-bis-Tod-Matrix exakt wie die
  Vorbild-FA, die Kreuz-Pflichtpaare gegen Varkan (`docs/design/roster.json`), die Kitbash-Budgets und die Lints aus faction.md §5.3.
- `md.py`: schreibt `roster.md` aus `roster.json`.
- `validate.py [index.json]`: unabhängiger Validator, rechnet alle Gates aus den Rohwerten neu. Mit `index.json` zusätzlich Grep der
  Anzeigenamen und der Lore-Namen aus faction.md §1/§2.5 (Rotten, Waffen- und Spielbegriffe) gegen alle FA-Einheitennamen. Exit-Code 1 bei Verstoß.

Review-Entscheidungen (Balance, Lesbarkeit, Eigenständigkeit, Vollständigkeit): `roster.md` §19.

Reihenfolge: `python3 gen.py && python3 md.py && python3 validate.py index.json`
