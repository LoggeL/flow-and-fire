# TRACK-EDITOR P7: Integrierte Abnahme

Stand: 29.09.2026. Alle Editor-Befehle liefen im konsolidierten Root. Kein Editor-Prozess blieb nach der Abnahme zurück. Der Benutzer-Server auf Port 4783 wurde erhalten; Prüfungen nutzten 4883.

## Änderungen

Neue Browser-Specs `edit.spec.ts`, `roundtrip.spec.ts`, `validation.spec.ts` und `perf.spec.ts`; Pointer-/Property-Helfer in `test/e2e/support/editor.ts`. Die Browserprüfungen nutzen echte Mausklicks, Drags und UI-Eingaben. Sie setzen Starts/Spots, verschieben und löschen Spots, zeichnen fünfpunktige Polygone und Kreise, fügen/löschen Polygonpunkte, verschieben Kreise und ziehen Radiusgriffe. Feldwerte werden im Download nachgelesen. Punkt-Symmetrisierung und Live-X, vollständiges Keyboard-Undo bis Original-SHA und Redo sowie Save/JSON-Download sind integriert.

Der heruntergeladene Export wird über `readRtsMap`, `ClientMap.fromBytes` und `resolveMap` bytegleich wieder geschrieben; Sim-Hash und Expansion stimmen mit dem Editor überein. Das heruntergeladene JSON wird mit dem echten mapc-Compiler eingelesen und liefert dieselben Starts, gruppierten Spots und Prop-Felder.

Viewports im finalen UI reservieren Raum zwischen den Panels; `TerrainView.fitCamera()` zeigt die Karte einschließlich Rand. Damit wurden bei der visuellen Prüfung entdeckte verdeckte Kartenränder behoben. Keine Änderung an packages/formats war erforderlich.

## Prüfungen

| Befehl | Ergebnis |
|---|---|
| `./tools/heavy pnpm vitest run apps/marker-editor --maxWorkers=4` | 25 Dateien, 292 Tests grün |
| `pnpm exec tsc -p apps/marker-editor/tsconfig.json --noEmit` | grün |
| `pnpm exec eslint apps/marker-editor/test/e2e apps/marker-editor/src --max-warnings=0` | grün |
| `./tools/heavy pnpm --filter @faf/marker-editor build` | grün |
| `FAF_E2E_PORT=4883 ./tools/heavy pnpm exec playwright test -c apps/marker-editor/playwright.config.ts --grep-invert 'measurement'` | 48/48 grün, Chromium/Firefox/WebKit, 46 s, workers=1 |
| `FAF_E2E_PORT=4883 ./tools/heavy pnpm exec playwright test -c apps/marker-editor/playwright.config.ts apps/marker-editor/test/e2e/perf.spec.ts` | 3/3 grün, zwei Messläufe je Engine |
| `./tools/heavy pnpm --filter @faf/marker-editor bench` | zwei finale, nacheinander ausgeführte Läufe grün |
| `./tools/heavy pnpm --filter @faf/formats bench` | zwei finale, nacheinander ausgeführte Läufe grün |

Alle Browserprüfungen hatten keine unerwarteten console-/pageerrors. Die vier ursprünglichen Dateien wurden je Engine über den sichtbaren Save-Download bytegleich geprüft. Datei-Dialog und Drag & Drop wurden zusätzlich tatsächlich benutzt. Wasser-/Hang-/Randfehler erschienen in der klickbaren Liste, selektierten ihren Spot und verschwanden nach Undo.

Die integrierte Tests-Typprüfung meldete zunächst ausschließlich Fehler in anderen laufenden Tracks (Audio/FX/AI); der Root übernimmt deren Korrektur und abschließende globale Typecheck/Lint/Tests. Diese getrennte Zuständigkeit ist im konsolidierten Bericht ausgewiesen.

## Sichtprüfung und Messdaten

42 finale PNGs wurden in sechs Kontaktbögen visuell geprüft, zusätzlich Karten-/Bearbeitungs-/Validierungs-/Hilfebilder in voller Größe. Kein leeres Canvas, Terrain und Marker erkennbar, Feldumrisse/Props/Achse sichtbar, lesbare Panels ohne Überlappung. Die Hilfe ist bei 1280×720 innerhalb des Dialogs scrollbar und bei 1920×1080 vollständig sichtbar. Vier repräsentative PNGs liegen in `docs/status/track-editor/`, jeweils unter 400.000 Bytes. [abnahme.json](track-editor/abnahme.json) enthält alle 42 Dateinamen und SHA-256.

Die Messungen erfolgten lokal auf Apple M5 Pro im reservierten ruhigen Fenster, ohne parallele Benchmarks. Finale Rohwerte und Wertebereiche aus mindestens zwei Läufen stehen im [konsolidierten Bericht](track-editor.md). Zwei versehentlich überlappte Vorläufe wurden verworfen; dokumentiert sind ausschließlich die danach vollständig seriell ausgeführten Node-Messungen.

## Abschluss und Übergabe

P0 bis P7 sind im Root integriert. `docs/status/track-editor.md` beschreibt Bedienung, Format, Hash, Expansion, Schwellen, Symmetrie, Undo/Redo, Abnahme und Messwerte; P5/P6-Fragmente wurden ergänzt. Root ergänzt STATUS/DECISIONS und führt repo-weite Prüfungen sowie Karten-Hashkontrolle aus.

MS8 bleibt ein echter Folgemeilenstein: expandierte Props an die Sim-Tabelle anschließen, Spiel-Blueprints und Render-Props ergänzen. Diese Spielanbindung ist keine offene Editor-Bearbeitung. `.rtsmap` bewahrt alle Bytes einschließlich unbekannter Chunks, `markers.json` gruppiert Mass vor Hydro und benötigt separate Heightmap/Splat/Preview-Inputs.
