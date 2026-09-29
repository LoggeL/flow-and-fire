# Roster-Werkzeuge f3 (Orden von Sael)

- `fa_extract.py` erzeugt `fa_ref.json` aus FAForever/spooky-db `app/data/index.json` (Version 3810).
  Enthalten sind die FA-Referenzen der Vorbild-Fraktion pro MVP-Rolle plus die Varkan-Referenz derselben Rolle als Gegenprobe (`_meta.roleMap`).
  DPS nach spooky-db `app/js/dps.js` (NotNukeDpsCalculator), identisch zu `tools/roster/gen.py`.
  Aufruf im Ordner `tools/roster/f3/`: `python3 fa_extract.py <pfad/zu/index.json>`.
- `gen.py` erzeugt `docs/design/factions/f3/roster.json` (Schema `faf-roster/1` wie Varkan). Rollen-Metadaten (●/○, MS, Icon,
  Hotbuild-Slot, Footprint, Visual) werden aus `docs/design/roster.json` geerbt und erzwungen. Korrekturen an spooky-Werten
  (`FA_OVERRIDES`, gegen FAF `develop` geprüft) und alle Gates (±25 / ±15 % inkl. Produkt und Pulk, Treffer-bis-Tod exakt,
  Kreuz-Breakpoints gegen Varkan, Kitbash-Budget und Monopol-Lints) stehen im Skript; bei Verstoß bricht es ab.
- `validate.py` rechnet alles unabhängig aus den Rohfeldern nach (Exit 1 bei Verstoß), inkl. FA-Begriffe in Anzeigefeldern.
- `md.py` erzeugt `docs/design/factions/f3/roster.md` aus `roster.json`.
- `rush.py` (Review 2026-09-29): Modell „T1-Rush gegen den Kommandanten“ (Mindestzahl ohne/mit Sonderschuss), von `gen.py` als
  `checks.rush` geschrieben und gegated, von `validate.py` nachgerechnet. `python3 tools/roster/f3/rush.py` druckt die Tabelle.
- `../fa_names.json` (dev-only, seit dem fraktionsübergreifenden Abgleich gemeinsam für alle Fraktionen): alle 357 Einheiten- und 218 Waffennamen aus spooky-db 3810 für den Volltext-Namens-Grep in `validate.py`.
  `validate.py` prüft außerdem Abstand ≥ 2 Buchstaben zu den Rufnamen aller anderen Roster und `firingRandomness` bei ballistischer Artillerie.
- Aufruf aus beliebigem Ordner: `python3 tools/roster/f3/gen.py && python3 tools/roster/f3/validate.py && python3 tools/roster/f3/md.py`.
- `fa_ref.json` und `faReference` sind dev-only: FA-Namen landen nie in Anzeigefeldern, `view.json` oder i18n.
- Design: `docs/design/factions/f3/faction.md`.
- `exp.py` (T4, Post-MVP): Daten und Gates der fünf Experimentals (Karkinos, Ammonit, Pelikan, Kreuzsee, Perle), von `gen.py` eingebunden
  (`experimentals[]`, gespiegelt in `reservedPostMvp[]` für den Namensabgleich in `cross.py`), von `validate.py` unabhängig nachgerechnet,
  von `md.py` als `roster.md` §22 ausgegeben. `python3 exp.py` druckt die Gates; `python3 exp.py --extract <index.json>` schreibt
  `fa_ref_t4.json` (Vorbild-T4 und Varkan-Gegenproben aus spooky-db 3810, dev-only; Korrekturen `FA_T4_OVERRIDES`, develop-Stand `FA_T4_DEVELOP`).
  Design: `docs/design/factions/f3/experimentals.md`.
