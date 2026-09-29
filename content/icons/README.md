# Strategic Icons (gemeinsame Grammatik aller Fraktionen)

Quelle ist [`grammar.ts`](grammar.ts) (reines TS, liefert SVG-Strings; Regeln aus `docs/design/faction.md` §6).
`pnpm models` schreibt daraus die SVGs nach `svg/` und den Index `icons.json`; der Model-Viewer zeigt die Übersicht
unter `#/icons` (Teamfarbe umschaltbar, Echtgröße 20 px × Faktor).

- **Grundform = Domäne** (Teamfarbe, Graphit-Kontur): `land` Quadrat mit Fase, `air` Dreieck, `eng` Kreis,
  `struct` Sechseck, `cmd` Lot-Tropfen (1,6×, ohne Glyphe/Kerben), `wall` Mini-Quadrat, `naval` reserviert.
- **Glyphe = Rolle** (Keramikweiß mit dunklem Halo, zentrales 16 × 16-Feld, Striche ≥ 4–5 DE): 19 Tokens
  (`direct`, `bot`, `sniper`, `arty`, `mml`, `aa`, `sam`, `bomb`, `fbomb`, `build`, `intel`, `shield`, `mass`,
  `energy`, `hydro`, `mstore`, `estore`, `fac_land`, `fac_air`) – gefüllt = erzeugen, hohl = lagern.
- **Tech-Kerben** 1–3 (5 × 9 DE) oben rechts außerhalb der Form. **Experimentals (T4, `_t4`):** keramikweiße eckige Klammer links und rechts um die Form statt Kerben, Faktor 1,5 (`docs/design/experimentals.md` §5).
- **Zustände:** `selected` (weißer Außenring), `blip` (neutral grau, nur Achteck/Dreieck/Sechseck – verrät weder
  Rolle noch Tech), `ghost` (Sechseck 48 %, entsättigt, gestrichelt, Glyphe sichtbar).
- **IDs:** `<form>_<glyph>_t<n>` (z. B. `land_direct_t1`, `struct_fac_land_t3`, T4 `land_bot_t4`), `cmd_commander`, `wall`.
- Teamfarbe im SVG als `var(--team, #2F6FD0)` – inline eingebettet per CSS umfärbbar.

Dateien: `svg/forms/`, `svg/glyphs/`, `svg/notches/`, `svg/states/blip_*.svg`, `svg/icons/<id>.svg`
(+ `.selected.svg`, Gebäude + `.ghost.svg`). Der MSDF-Atlas für den IconPass entsteht später in der
Asset-Pipeline aus derselben Grammatik.
