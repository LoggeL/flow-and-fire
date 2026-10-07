# TRACK-EDITOR · P7 – E2E, visuelle Abnahme, Integration, Doku

Stand: 2026-09-30 · Worktree `flow-and-fire/.worktrees/faf-editor`, Branch `track-editor` · Welle 3
(der Pfad `/Users/logge/Documents/Projects/faf-editor` aus der Aufgabe existiert nicht).

Konsolidierter Bericht: [track-editor.md](track-editor.md).

## Umfang

### E2E-Specs (`apps/marker-editor/test/e2e/`)

- `support/actions.ts` (neu): echte Mauseingaben an Terrainpunkten über `__editor.worldToClient` (`clickWorld`,
  `dragWorld`, `zoomAt`, `centerOn` per Rechts-Drag), Werkzeugwahl, Panel-Commit (`fill` + Enter, prüft
  `aria-invalid`), Download-Abfang, SHA-256/Bytevergleich in Node.
- `roundtrip.spec.ts`: Start auf Setons, dann alle 4 Karten über `select-map`; je Karte `exportSha256` und
  Download-SHA-256 == `content/maps/<name>.rtsmap`, Dateiname, mapSimHash-Golden, Undo-Tiefe 0, `markers.json`-Download
  mit gleicher Markeranzahl, 0 errors, Gesamtansicht-Screenshot (Pixelstatistik), keine Konsolenfehler.
- `edit.spec.ts` (hollow-ridge): Start/Mass/Hydro per Werkzeug setzen, Mass-Spot ziehen (1 Undo-Schritt), Hydro mit
  dem Löschwerkzeug entfernen, Polygon mit 5 Punkten + Enter, Kreis per Drag; im PropertiesPanel Name, Art, IDs mit
  Gewichten, Dichte, Seed (hex bzw. dezimal), Skalierung, max. Neigung, dryOnly, Reclaim Masse/Energie – Werte exakt
  im Dokument; Punkt-Symmetrisieren (1 Schritt, `isSymmetric(doc,'point')` in Node, 4 Felder, 4 Starts);
  Live-Symmetrie Achse X beim Setzen und Ziehen (Zwilling exakt `S−x`); Screenshots Übersicht + Nahansicht;
  26 × `Strg+Z` bis Tiefe 0 = Original-SHA und nicht dirty, vollständiges Redo (`Strg+Umschalt+Z`/`Strg+Y`) =
  bearbeiteter SHA; Speichern → Download == `exportBytes`. In Node: `readRtsMap`, `ClientMap.fromBytes`
  (`@faf/client`), `resolveMap` (`@faf/sim-host`) → `writeRtsMap` bytegleich, Client-Starts/-Spots gleich,
  `mapSimHash` Node == Hook, `expandPropFields`-Anzahl == `counts().expandedProps`, `propFields[0|1]` == Eingaben.
  Zweiter Test: Hilfe-Overlay per `?`, Esc, Button (Screenshot).
- `validation.spec.ts`: Mass-Spots ins Wasser (256/256), an den Hang (254/206), an den Rand (6/200) → Befund des
  eigenen Spots mit `spot-in-water` / `spot-not-flat` / `spot-edge` (error) und sichtbare `issue-row`, Zähler stimmt;
  Klick auf die Zeile selektiert den Spot (Zeile `me-active`); 3 × Undo → 0 errors, Zeilen weg. Zweiter Test: die
  4 Karten zeigen 0 errors (Panel-Zähler, Hook, keine Fehlerzeile).
- `perf.spec.ts`: Messung ohne Gate (Setons-Ladezeit × 3, Kameraflug 60 Frames mit gehaltenem `D` + Radzoom,
  `benchFrames(60)`, Befehl + Validierung je Änderung × 25) → `test-results/marker-editor/perf-<browser>.json`.

### Korrekturen nach der visuellen Abnahme (apps/marker-editor)

- **Karte teilweise unter dem Eigenschaften-Panel** (Setons, hollow-ridge in der Gesamtansicht): `TerrainView`
  bekommt `setViewInsets()` / `viewInsets` (Typ `ViewInsets`, exportiert über `src/view/index.ts`). Das
  Projektionszentrum wandert per `camera.setViewOffset` (gleicher Maßstab) in die Mitte der freien Fläche, `fitCamera`
  rechnet mit der freien Breite/Höhe (jede Seite behält ≥ 30 %). `main.ts` misst Spalten, Topbar und Statusleiste
  (ResizeObserver + `resize`). Picking, `worldToClient`, Pan/Zoom bleiben exakt, weil sie die Kameramatrizen nutzen.
- **Symmetrie-Auswahlen abgeschnitten** („Achse X (…“): `Row` hat eine Option `wide` (Label über dem Control), die
  zwei Auswahlen im Symmetrie-Panel nutzen sie und tragen den vollen Text als `title`.
- **Reclaim-Summe brach um** („… E“ in neuer Zeile): Statistikzeilen mit Label in natürlicher Breite, Wert einzeilig.
- Polygon im E2E auf trockenes Land gelegt (vorher im Fluss, dryOnly ergab kaum Props im Screenshot).

### Integration

- `tools/eslint-plugin-sim/test/config.test.ts` schlug repo-weit fehl: Der P1-Glob `apps/*/test/**/*.tsx` in
  `eslint.config.js` traf keine Datei. Lösung im eigenen Bereich: echte TSX-Fixture
  `test/ui/inputs-fixture.tsx` (mit `/** @jsxImportSource preact */`, weil Vitest für Testdateien keine
  App-tsconfig findet) und `test/ui/inputs.test.ts` (5 Tests: Row/wide-Row, InfoRow, ValueInput-Commit einmalig bei
  Enter + change, ungültige Eingaben nie übernommen, Esc, neuer Modellwert verwirft den Entwurf).
- Port 4783 war frei (der in P6 gemeldete verwaiste Vite-Prozess lief nicht mehr).
- Screenshots für die Doku mit PIL auf 256 Farben quantisiert (≤ 175 KB): `docs/status/track-editor/{setons-uebersicht,
  bearbeitung-felder-symmetrie,validierung,hilfe}.png`.
- `docs/STATUS.md`: additiver Abschnitt; `docs/DECISIONS.md`: Nachtrag TE-1 … TE-6.

## Dateien

neu: `apps/marker-editor/test/e2e/{roundtrip,edit,validation,perf}.spec.ts`, `test/e2e/support/actions.ts`,
`test/ui/inputs-fixture.tsx`, `test/ui/inputs.test.ts`, `docs/status/track-editor.md`, `docs/status/track-editor-p7.md`,
`docs/status/track-editor/*.png` (4) · geändert: `apps/marker-editor/src/view/{terrain-view,index}.ts`, `src/main.ts`,
`src/ui/components/{inputs,SymmetryPanel}.tsx`, `src/ui/styles.css`, `docs/STATUS.md`, `docs/DECISIONS.md`.
`packages/formats` unverändert gegenüber P0.

## Tests und Verifikation (alle verify_commands des Plans)

| Befehl | Ergebnis |
|---|---|
| `pnpm install --frozen-lockfile` | ok |
| `git diff --exit-code 2fc956c -- packages/sim packages/nav packages/render packages/client apps/game content/maps` | leer |
| `tools/heavy pnpm typecheck` | grün |
| `tools/heavy pnpm lint` | grün (depcruise 0 Verstöße, 528 Module) |
| `tools/heavy pnpm vitest run packages/formats apps/marker-editor` | 37 Dateien, 409 Tests grün |
| `tools/heavy pnpm test` | 125 Dateien, 1.270 Tests grün |
| `tools/heavy pnpm maps && git diff --exit-code -- content/maps` | unverändert |
| `tools/heavy pnpm --filter @faf/marker-editor build` | grün |
| `FAF_E2E_PORT=4783 tools/heavy pnpm test:e2e:editor` | 36/36 grün (chromium, firefox, webkit; 44,8 s und 46,1 s) |
| `tools/heavy pnpm --filter @faf/formats bench` / `… @faf/marker-editor bench` | ok (Werte im Bericht) |

Visuell geprüft (Read-Tool): `map-*` aller 4 Karten (chromium, Stichproben firefox), `edit-*` und `edit-zoom-*`
(chromium, firefox, webkit), `validation-*`, `validation-focus-*`, `help-*`. Terrain erkennbar, Marker/Plaketten
lesbar, Felder mit Props, Griffe und Symmetrieachse sichtbar, Panels ohne Überlappung, kein leerer Canvas.

## Messwerte (lokal, Apple M5 Pro, Playwright headless 1280×720, kein GPU-Runner; 2 Läufe)

Setons laden p50: chromium 66,5–71,1 ms, firefox 107–109 ms, webkit 94 ms · Kameraflug CPU-Render p50 1–2,6 ms,
Frame-Intervall p50 16–17 ms (60 Hz) · `benchFrames(60)` Ø 4,6–5,8 ms · Befehl + Validierung p50 0,6–2 ms.
Tabellen im Bericht.

## Offene Punkte

- `ci:local` beim Merge um `pnpm test:e2e:editor` ergänzen (Root-`package.json`, bewusst nicht im Track).
- 570 Draw Calls auf Setons (ein Sprite je Marker-Plakette) – bei größeren Karten batchen.
- Die View-Insets werden nur beim Einpassen/Fokussieren voll genutzt; eine laufende freie Kamera verschiebt sich bei
  Panel-Größenänderungen nur um den Offset (gewollt, kein Sprung).
