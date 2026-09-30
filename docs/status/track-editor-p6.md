# TRACK-EDITOR · P6 – Panels/UI (Preact + @preact/signals)

Stand: 2026-09-30 · Worktree `flow-and-fire/.worktrees/faf-editor`, Branch `track-editor` · App `apps/marker-editor` (Tool-Code)

## Umfang

Vertrag erfüllt: `src/ui/types.ts` (`PanelIo`) und `src/ui/index.ts`
(`mountPanels(root, store, io): () => void`, Rückgabe = unmount; importiert `styles.css`). P5 (`src/main.ts`)
bindet die Panels bereits so ein. `#ui` liegt mit `pointer-events: none` über dem Canvas. Die Panels schalten
`pointer-events` für sich selbst wieder ein und lassen die Kartenmitte frei.

### Komponenten (`src/ui/components/`)

- **TopBar**: Öffnen, Kartenauswahl aus `io.listBundled()` (Lade- und Fehlerzustand, die aktuelle Karte ist
  vorausgewählt), Speichern, markers.json, Undo/Redo mit Tiefe als Badge, Dateiname mit Dirty-Stern,
  Einpassen (`io.fitView`) und Hilfe.
- **ToolPalette**: die 7 Werkzeuge in `ToolId`-Reihenfolge mit Hotkey-Anzeige 1–7. Das aktive Werkzeug ist
  hervorgehoben (`me-active`, `aria-pressed`), darunter steht ein Hinweistext zum aktiven Werkzeug. Die
  Tasten selbst verarbeitet der Controller (P5).
- **SymmetryPanel**: Modus (keine, Punkt, Achse X, Achse Z, Diagonale, Gegendiagonale), zu behaltende
  Hälfte a/b mit sprechender Beschriftung je Modus, „Symmetrisieren“ (`store.symmetrize`, ein Undo-Schritt),
  Live-Symmetrie, Raster (`io.gridVisible`) und zusätzlich eine Einrast-Auswahl (`store.snapRaw`: aus, 0,25,
  0,5, 1, 2 oder 4 WU).
- **PropertiesPanel**:
  - Start: Armee (Select 1–16, belegte Armeen sind markiert, dann wird getauscht) sowie x/z in WU.
  - Spot: Art und x/z.
  - Feld: x/z und Radius beim Kreis bzw. „Polygon mit n Punkten“. Ist genau ein Eckpunkt gewählt, gibt es
    dessen x/z.
  - Feldattribute: Name, Art (Baum/Fels/Wrack), Blueprints als `id:gewicht, …`, Dichte je 1024 WU², Seed
    (dezimal oder `0x…`) mit „Neu würfeln“, Skalierung min/max in %, max. Neigung in ‰ (0 = beliebig),
    „nur trocken“ und Reclaim Masse/Energie je Prop (Anzeige mit 3 Nachkommastellen, gespeichert als Milli).
  - Feldstatistik: Anzahl expandierter Props und Summe Reclaim-Masse/-Energie (`store.expandedProps()`,
    je Revision gecacht).
  - Mehrfachauswahl: Zusammenfassung nach Typen, bei Feldern mit Props-Anzahl und Reclaim-Summe.
- **ValidationPanel**: Zähler je Schwere (ein Klick blendet die Schwere aus oder ein) und die Liste, sortiert
  nach Schwere und innerhalb stabil. Jede Zeile zeigt die Position in WU oder „kartenweit“.
  - Ein Klick auf eine Zeile ruft `store.select(refs)` und `io.focus(x, z)` auf. Hat der Befund keine
    Position, wird die Position des ersten Markers genommen.
  - Zeilen, deren Marker in der Auswahl sind, werden hervorgehoben. Höchstens 300 Zeilen, der Rest wird
    gezählt.
- **StatusBar**: Cursor in WU, Kartengröße, Starts/Mass/Hydro/Felder/Props (expandiert + explizit),
  Auswahlgröße, `store.status` und der Dirty-Indikator.
- **HelpOverlay**: öffnet mit `?` oder dem Hilfe-Button. Es schließt mit `?`, Esc, „Schließen“ oder einem
  Klick auf den Hintergrund. Inhalt: alle Tastenkürzel (entspricht der Keymap von P5), die Werkzeuge und die
  Mausbedienung.
  - Esc wird bei offener Hilfe verbraucht (Capture-Listener, `stopImmediatePropagation` und
    `preventDefault`), damit der Controller nicht zusätzlich die Auswahl aufhebt.
  - In Textfeldern wird `?` ignoriert, auf Checkboxen und Buttons nicht (dieselbe Regel wie
    `app/keymap.ts`).
- **inputs.tsx / ValueInput**: validiert live. Ungültige Eingaben werden rot (`me-invalid`,
  `aria-invalid`), die Fehlermeldung steht darunter und im Tooltip, und der Wert wird nicht übernommen.
  - Commit bei Enter oder `change` als genau EIN Store-Kommando. Enter mit anschließendem `change` committet
    nicht doppelt, und ein unveränderter Wert erzeugt keinen Undo-Schritt.
  - Esc verwirft die Eingabe.
  - Verschieben läuft über `beginGesture` + `moveSelectionBy` + `endGesture`, Eckpunkte über `moveVertex`,
    der Radius über `setFieldRadius`, Feldattribute über `updateField`, die Armee über `setStartArmy`.
  - Geklickte Buttons, Selects und Checkboxen geben den Fokus ab, damit die Tastenkürzel weiter wirken.

### Hilfsmodule

- `src/ui/format.ts`: reine Parser und Formatierer, die nie werfen (`ParseResult` mit deutschem
  Fehlertext).
  - WU ↔ Fx raw (Komma oder Punkt, optional „WU“, Bereich [0, maxRaw]), Milli (skaliert und exakt über die
    Ziffern, u32), Prozent ↔ Promille (1 Nachkommastelle).
  - Ganzzahlbereiche, auch Hex-Seeds, und ID-Gewichts-Listen: `,`/`;`/Zeilenumbruch, 1–16 Einträge,
    eindeutige IDs nach `PROP_ID_RE`, ≤ 128 Bytes, Gewicht 1–65535, ohne Gewicht = 1.
  - Feldname (1–64 UTF-8-Bytes, keine Steuerzeichen) und `nextSeed` (deterministisch:
    `rng32(seed, revision, fieldIndex, salt)`, nie gleich dem alten Seed).
- `src/ui/selection.ts`: `panelFocus` (was das Panel für eine Auswahl zeigt), `summarizeSelection`,
  `fieldStats` und `refsIntersect`.
- `src/ui/strings.ts`: alle deutschen Texte an einer Stelle. `src/ui/styles.css`: dunkles Tool-Design mit
  `me-`-Präfix und Farbtokens.
  - Layout: Topbar 44 px, Statusbar 28 px, links 208 px (Werkzeuge, Symmetrie), rechts 324 px
    (Eigenschaften, Validierung). Ab 1600 px Breite sind es 224 bzw. 372 px.
  - Das Eigenschaften-Panel hat Vorrang, die Validierung behält mindestens 132 px. Bei ≤ 820 px Höhe sind
    die Zeilen dichter.
- `ui-preview.html` + `src/ui/preview.ts`: eigene Vorschau-Seite (echter `TerrainView`, `MarkerOverlay`,
  `EditorStore` auf hollow-ridge, Fake-`PanelIo`).
  - Demo-Zustände über `?demo=field|start|multi|issues|help|none`, Hook `window.__uiPreview`.
  - `vite.config.ts` nimmt die Seite automatisch in den Build auf.

### data-testid

Alle vorgegebenen IDs sind vorhanden, der Komponententest prüft das:

- Werkzeuge: `tool-select|start|mass|hydro|field-circle|field-polygon|delete`.
- Topbar: `btn-open`, `select-map`, `btn-save`, `btn-export-markers`, `btn-undo`, `btn-redo`.
- Symmetrie: `select-symmetry`, `select-keep-half`, `btn-symmetrize`, `chk-live-symmetry`, `chk-grid`.
- Eigenschaften: `panel-properties`, `start-army`, `marker-x`, `marker-z`.
- Feld: `field-name|kind|ids|density|seed`, `btn-field-reseed`,
  `field-scale-min|scale-max|max-slope|dry-only|reclaim-mass|reclaim-energy|count`.
- Validierung und Status: `panel-validation`, `issue-row` (mit `data-code` und `data-severity`),
  `status-bar`, `status-dirty` (mit `data-dirty`).

Zusätzliche IDs für P7:

- Topbar und Hilfe: `top-bar`, `file-name`, `btn-fit`, `btn-help`, `btn-help-close`, `help-overlay`.
- Panels: `panels`, `panel-tools`, `tool-hint`, `panel-symmetry`, `select-snap`.
- Eigenschaften: `field-radius`, `spot-kind`, `field-reclaim-total`, `selection-summary`.
- Validierung: `issue-count-error|warning|info` (mit `data-count`).
- Statusbar: `status-cursor`, `status-size`, `status-counts`, `status-selection`, `status-message`.

## Dateien

`apps/marker-editor/src/ui/{types,index,format,selection,strings,preview}.ts`, `src/ui/styles.css`,
`src/ui/components/{App,TopBar,ToolPalette,SymmetryPanel,PropertiesPanel,ValidationPanel,StatusBar,HelpOverlay,inputs}.tsx`,
`apps/marker-editor/ui-preview.html`, `apps/marker-editor/test/ui/{format,selection,panels}.test.ts`.

## Tests

39 Tests in 3 Dateien, grün (`pnpm vitest run apps/marker-editor/test/ui`, 0,6–0,7 s):

- `format.test.ts` (18): WU/Milli/Prozent/Seed/ID-Listen/Feldname inklusive Fehlerfälle (leer, keine Zahl,
  zu viele Nachkommastellen, Bereich, Gewicht 0, doppelte ID, ungültige ID, Byte-Längen) und `nextSeed`.
- `selection.test.ts` (7): `panelFocus`, Zusammenfassung, `fieldStats`, `refsIntersect`.
- `panels.test.ts` (14, `// @vitest-environment happy-dom`, echter `EditorStore` + Validator auf
  hollow-ridge, `mountPanels`):
  - alle Test-IDs, Kartenauswahl und IO-Buttons, Werkzeugwechsel und Hervorhebung.
  - x/z-Commit als je ein Undo-Schritt; ungültige Eingaben bleiben rot und werden nicht übernommen; Esc.
  - Armeewechsel.
  - alle Feldattribute mit exakten Werten, dazu 10 ungültige Eingaben ohne Änderung und ohne Undo-Schritt.
  - Props-Anzahl und Reclaim-Summe, Neu würfeln, Radius/Zentrum, Polygon-Eckpunkt.
  - Mehrfachauswahl.
  - Befundzeile: Auswahl + Fokus, Sortierung und Undo.
  - Symmetrie, Live-Symmetrie, Raster und Einrasten.
  - Statusbar und Dirty-Anzeige.
  - Hilfe per `?`, Esc und Buttons; `?` im Textfeld wird ignoriert, auf einer Checkbox nicht; sauberes
    Unmount.

Weitere Prüfungen:

- `npx tsc -p apps/marker-editor/tsconfig.json --noEmit`: 0 Fehler. Die Testdateien sind mit den Optionen
  von `tsconfig.tests.json` fehlerfrei.
- `tools/heavy pnpm lint` (eslint `--max-warnings 0` + depcruise): sauber.

## Visuelle Prüfung (lokal, Apple M5 Pro, Chromium headless, ANGLE/Metal)

- Ad-hoc-Skript: Vite-Dev-Server mit der App-Konfiguration und Playwright/Chromium. Danach ist der Server
  beendet.
- Geprüfte Zustände: echte App (`index.html`/P5-`main.ts`) bei 1280×720 und 1920×1080, jeweils mit Start,
  mit Kreisfeld und einem Randfehler sowie mit der Hilfe. Dazu `ui-preview.html?demo=multi` bei 1280×720.
- Automatische Layoutprüfung (Rechtecke von Topbar, Statusbar und allen Panels): keine Überlappung, nichts
  außerhalb des Fensters, kein Überlauf der Topbar, keine Konsolenfehler.
- Freie Kartenbreite zwischen den Spalten: 732 px bei 1280×720 und 1308 px bei 1920×1080.
- Nach Sichtprüfung korrigiert:
  - Das Label „Max. Neigung“ war abgeschnitten, der Hinweis „0 = beliebig“ steht jetzt im Tooltip.
  - Bei 720 px Höhe wird das Eigenschaften-Panel jetzt bevorzugt, die Zeilen sind dichter. Beim Kreisfeld
    wird nur noch die Summenzeile gescrollt.
  - Die Hilfe ist ausgeglichen zweispaltig (Tastatur | Werkzeuge + Maus) und passt bei 1280×720 ohne
    Scrollen.

## Abweichungen

- Der Worktree liegt unter `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-editor`. Den Pfad
  `/Users/logge/Documents/Projects/faf-editor` aus der Aufgabe gibt es nicht (mehr).
- **Port 4783 war belegt** durch einen verwaisten `vite --port 4783 --strictPort` (PID 97626, lief seit
  etwa 7 h, cwd = `apps/marker-editor`, stammt aus einem früheren Lauf). Nicht von diesem Paket gestartet,
  daher nicht beendet. Die visuelle Prüfung lief deshalb auf Port 4793.
  **P7 bzw. der Orchestrator muss den Prozess beenden**, sonst scheitert der Playwright-webServer mit
  `strictPort` auf 4783.
- `PROP_ID_RE` ist in `format.ts` gespiegelt, weil `@faf/formats` die Regex nicht exportiert (formats nur
  additiv und nicht Teil dieses Pakets). Die endgültige Prüfung bleibt `validatePropFields` im Store.
- Positionseingaben laufen durch das Einrasten des Stores (`snapRaw`, Standard 0,5 WU). Beispiel: 100,3 wird
  bei 0,5 WU Raster zu 100,5. Wer exakte Werte will, stellt „Einrasten: aus“ ein. Außerhalb der Karte wird
  die Eingabe abgelehnt (rot), nicht geklemmt.
- Wertebereiche richten sich nach den Formatgrenzen:
  - Dichte 1–4096
  - Skalierung 0,1–6553,5 % (min ≤ max wird geprüft)
  - Neigung 0–65535 ‰
  - Reclaim 0–4 294 967,295 je Prop
  - Radius ≥ 1 WU

## Offene Punkte für Folgepakete

- P7 (E2E): die Test-IDs oben verwenden. Ein Commit braucht `fill` + `Enter` oder einen Blur. Ungültige
  Eingaben erkennt man an `.me-invalid` / `aria-invalid="true"`. Die Hilfe ist `help-overlay`.
- Bei sehr vielen Befunden (> 300) zeigt die Liste nur die ersten 300 nach Schwere. Eine Gruppierung nach
  `code` wäre eine mögliche Erweiterung.
- Die Screenshots der visuellen Prüfung liegen nur im Scratchpad dieses Laufs und sind nicht eingecheckt.
  P7 erzeugt die offiziellen E2E-Screenshots.
