# Roster-Werkzeuge

Python-Skripte, mit denen `docs/design/roster.json` und `roster.md` erzeugt und geprüft werden
(Fraktion Varkan-Kompakt). `fa_ref.json` enthält die FA-Referenzwerte (spooky-db 3810) nur als Zahlen-Relationen,
seit dem Experimentals-Stand auch die T4-Referenzen (`UAL0401`, `XSL0401`, `URL0402`, `UEL0401`, `XRL0403`, `URA0401`,
`UAA0310`, `XSA0402`, `UEB2401`, `URL0401`, `XAB2307`, `XAB1401`; Paragon-Skriptwerte aus FAF `develop` in `econ`).

- `gen.py` erzeugt `roster.json` (50 MVP-Einträge + 6 Experimentals, `tech: 4`, `postMvp: true`), `md.py` erzeugt `roster.md`
  (Experimentals in §19), `validate.py` prüft ±25 %-Grenzen, T4-Ziel ±15 %, T3-Äquivalent-Relation und Bauzeiten.
- Pfade sind relativ zum Repo aufgelöst; Aufruf von überall: `python3 tools/roster/gen.py && python3 tools/roster/md.py && python3 tools/roster/validate.py`.
- `md_head.py`, `md_body.py`, `md_tail.py` und `patch_units.py` sind Zwischenstände der ersten Roster-Runde (nicht mehr nötig).
- Design der Experimentals: `docs/design/experimentals.md`.
- `validate.py [roster.json]` akzeptiert optional einen anderen Roster-Pfad.

## Fraktionsübergreifend

- `f2/`, `f3/`, `f4/`: Werkzeuge der Fraktionen Skarn, Sael und Aurith (je eigene `fa_ref.json` der Vorbild-Fraktion, siehe dortige README).
- `cross.py`: N × N-Prüfer aller Roster (Eco-Gleichstand, Kreuz-Treffer-bis-Tod, Gruppengefecht, T1-Rush, Phasen-Matrix mit Dominanz-
  und Identitäts-Gate, Icon-Grammatik, Namenskollisionen und FA-Namens-Grep). `python3 tools/roster/cross.py [--md]`, Exit-Code 1 bei Verstoß.
  Ergebnisse und Begründungen: `docs/design/factions/README.md`.
- `fa_names.json` (dev-only): alle Einheiten- und Waffennamen aus spooky-db 3810 für den Namens-Grep (von `cross.py` und `f3/validate.py` genutzt).
- `fa_ref.json` zählt seit dem Abgleich Doppelwaffen (spooky `WeaponNumber`) mit: `DEA0202` 2 × 75 Luft, `URA0102` 2 × 3 × 8 (Feld `count`).
