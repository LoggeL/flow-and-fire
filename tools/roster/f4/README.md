# Roster-Werkzeuge f4 (Aurith-Chor)

Erzeugen und prüfen `docs/design/factions/f4/roster.json` und `roster.md` (Schema `faf-roster/1`, wie Varkan).
Nur Python-Standardbibliothek; Pfade sind relativ zum Skript, Aufruf aus beliebigem Ordner.

- `ref.py` extrahiert die FA-Referenzwerte der Vorbild-Fraktion (Blueprints `XS*`, dazu `DSLK004`) aus spooky-db
  `app/data/index.json` (Datenstand 3810) nach `fa_ref.json`. Nur Zahlen-Relationen, dev-only.
  Aufruf: `python3 ref.py <pfad/zu/spooky_index.json>` im Ordner `tools/roster/f4/`.
  spooky-db fasst gleiche Doppelwaffen (links/rechts) zu einem Eintrag mit `WeaponNumber` zusammen; `ref.py` multipliziert die DPS damit
  und schreibt `weapons[].count` (Review R1, `roster.md` §20). Die Werkzeuge von Varkan, f2 und f3 haben diese Korrektur noch nicht.
- `gen.py` erzeugt `roster.json`. Alle Einheitenwerte stehen hier; der Generator erzwingt die Gates
  (±25 % hart, Einzelachsen/Produkt/Pulk ±15 %, Treffer-bis-Tod exakt), Kitbash-Budgets, Monopol-Lints und die Zählung (49 / 26 ● / 28 Visuals).
- `md.py` erzeugt `roster.md` aus `roster.json` und vergleicht mit `docs/design/roster.json` (Varkan, §17).
- `validate.py [-v] [roster.json]` prüft unabhängig: rechnet Δ DPS/Mass, Δ HP/Mass, Produkt, Pulk und die Treffer-Matrix
  direkt aus `fa_ref.json` neu (vertraut keinem `balance`-Feld), dazu Schema-Konsistenz, `count` in `fa_ref.json`,
  fraktionsübergreifend eindeutige Rufnamen (gegen alle vorhandenen `roster.json`) und gültige Kreuz-Silhouettenpaare. Exit-Code 1 bei Verstößen.

- **Experimentals (T4, Post-MVP):** `ref_t4.py <spooky_index.json>` schreibt `fa_ref_t4.json` (Vorbild `XSL0401`/`XSA0402`/`XSB2401`,
  Fremdreferenz `UEL0401`/`XAB1401`, ergänzt um FAF-`develop`-Werte). `exp.py` hält die fünf T4 und ihre Gates; `gen.py` schreibt sie in den
  eigenen Schlüssel `experimentals` (nicht in `units`, damit Zählung, MVP-Gates und `cross.py` unberührt bleiben), `md.py` in `roster.md` §21,
  `validate.py` prüft sie unabhängig. Design: `docs/design/factions/f4/experimentals.md`.

Reihenfolge: `python3 gen.py && python3 md.py && python3 validate.py`
