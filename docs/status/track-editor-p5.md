# TRACK-EDITOR · P5 – App-Controller: Werkzeuge, Eingabe, Datei-IO, Verdrahtung, Test-Hooks

Stand: 2026-09-30 · Worktree `flow-and-fire/.worktrees/faf-editor`, Branch `track-editor` · Welle 2

> Hinweis zum Pfad: Die Aufgabe nennt `/Users/logge/Documents/Projects/faf-editor`. Diesen Ordner gibt es nicht,
> der Worktree des Branches `track-editor` liegt unter `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-editor`.
> Dort wurde gearbeitet.

## Umfang

### Verdrahtung (`index.html`, `src/main.ts`)

- Layout `#app > #viewport > canvas#terrain` plus `#ui` darüber (`pointer-events: none`, die Panels von P6 schalten
  es für sich wieder ein). Der Canvas füllt das Fenster, `touch-action: none`, fokussierbar.
- Aufbau: `TerrainView`, `MarkerOverlay`, `TerrainPicker`, `EditorStore` mit `setValidator(createValidator())`,
  `EditorController`, `EditorSession` und `mountPanels(#ui, store, io)`.
- Ein `effect` liest `doc` (also jede Revision), `selection`, `hover`, `issues`, `symmetry` und den Draft des Controllers.
  Bei neuer Kartenquelle ruft er `view.setMap`, danach `overlay.update(viewMarkers)` und `view.requestRender()`.
- Unsichtbares Kartenlabel `data-testid="map-label"` (Live-Region) für `view.spec.ts`, Dokumenttitel mit `●` bei
  ungespeicherten Änderungen.
- Zeiger: Nur die linke Taste ohne Alt geht an die Werkzeuge (mit Pointer-Capture). Rechte/mittlere Taste,
  Alt+Links und das Rad bleiben beim `CameraRig`. `pointercancel`/Fenster-`blur` brechen eine laufende Geste ab.

### Werkzeug-FSM (`src/app/controller.ts`, `src/app/tools/**`)

DOM-frei. Picking, Hit-Test und Kamera kommen über `ToolEnv` (`pick`, `hitTest`, `project`, `groundAt`, `panBy`);
in der App sind das `TerrainPicker`, `hitTestMarkers`, `worldToClient` und der `CameraRig`, in den Tests Fakes.

| Werkzeug | Verhalten |
|---|---|
| `select` | Klick = Selektion per hitTest, Shift = additiv/abwählen, Klick ins Leere leert. Linksziehen auf Marker verschiebt die Selektion als **eine** Geste (`beginGesture`/`endGesture`, ein Undo-Schritt). Ziehen auf Vertex-Griff = `moveVertex`, auf Radius-Griff = `setFieldRadius`. Doppelklick auf eine Polygonkante fügt einen Punkt ein (nicht auf einem Punkt). Linksziehen ins Leere schwenkt die Kamera (gegriffener Bodenpunkt bleibt unter dem Cursor). Esc während eines Drags macht ihn rückgängig. |
| `start` / `mass` / `hydro` | Klick setzt am gepickten Punkt, Ziehen schwenkt die Kamera, Klick neben die Karte meldet „Außerhalb der Karte“. |
| `fieldCircle` | Drücken = Mittelpunkt, Ziehen = Radius (Draft sichtbar), Loslassen legt das Feld an, Radius min. 1 WU. Reiner Klick gibt einen Hinweis, Esc bricht ab. |
| `fieldPolygon` | Klicks setzen Punkte (Draft mit Gummiband zum Cursor). Doppelklick, Enter oder Klick auf den ersten Punkt schließt ab ≥ 3 Punkten. Esc verwirft, Backspace/Delete entfernt den letzten Punkt, Ziehen schwenkt. Ein abgelehntes Polygon (z. B. selbstschneidend) bleibt als Draft stehen. |
| `delete` | Klick löscht den Treffer. Auf einem Vertex-Griff (jedes Felds, nicht nur selektierter) nur den Punkt, mindestens 3 bleiben. Hover zeigt, was gelöscht würde. |

Hover geht nach `store.hover`, der Terrainpunkt unter der Maus in WU nach `controller.cursor` (= `io.cursor`).
Werkzeugwechsel und Kartenwechsel setzen das alte Werkzeug zurück (Draft weg, laufende Geste beendet).

### Tastatur (`src/app/keymap.ts`)

`KeyboardEvent.code`, layoutunabhängig. Ctrl/Cmd+Z Undo, Ctrl/Cmd+Shift+Z und Ctrl/Cmd+Y Redo, Delete/Backspace
Selektion löschen (im Polygon-Werkzeug: letzten Punkt), Digit1–Digit7 Werkzeuge in `ToolId`-Reihenfolge, KeyF
Einpassen, KeyG Raster, Escape Abbruch bzw. Selektion leeren, Enter Polygon abschließen, Ctrl/Cmd+S Speichern,
Ctrl/Cmd+O Öffnen (jeweils `preventDefault`). Bei Fokus in einem Eingabefeld gelten nur Ctrl/Cmd+S/O.
Während eines Drags werden Undo, Werkzeugwechsel und Speichern ignoriert. Ereignisse, die das Hilfe-Overlay von P6
schon behandelt hat (`defaultPrevented`), werden übersprungen.

### Datei-IO (`src/io/**`)

- `EditorSession` (DOM-frei, Browserteile injiziert): Jeder Ladeweg (gebündelt, Datei, Bytes) läuft über dieselbe
  Sequenz „Lade …“ → Bytes → `store.open` → erster gerenderter Frame → `ready`. Ein neuerer Ladevorgang verdrängt
  einen älteren. `FormatError`/HTTP-Fehler landen als deutsche Meldung in `store.status`; die vorherige Karte bleibt
  offen. Nichts bleibt unbehandelt (`LoadCancelled`, wenn der Nutzer die ungespeicherte Karte behält).
- Gebündelte Karten über `maps/index.json`, URL-Parameter `?map=<name>`, sonst die zuletzt geöffnete gebündelte
  Karte (localStorage, alle Zugriffe in try/catch), sonst `hollow-ridge`. Ungültiger `?map` fällt auf den
  Default zurück, mit Meldung.
- Öffnen: verstecktes `input[type=file][accept=.rtsmap]` (`data-testid="file-input"`), Drag&Drop aufs ganze Fenster
  (Rahmen „.rtsmap-Datei hier ablegen“). UI-Wege fragen vor dem Verwerfen ungespeicherter Änderungen.
- Speichern = Download `<fileName>.rtsmap` (Blob + `a[download]`) und `store.markSaved()`; `markers.json` als
  eigener Download. `beforeunload`-Warnung bei `dirty`.
- `sha256Hex` über WebCrypto, mit reiner JS-Implementierung als Fallback (http-LAN-Hosts ohne `crypto.subtle`).

### Test-Hooks (`src/app/hooks.ts`)

`window.__editor` exakt nach Vertrag: `ready`, `mapName`, `load`, `loadBytes`, `exportBytes`, `exportSha256`,
`counts` (starts/mass/hydro/fields/props/expandedProps), `issues`, `worldToClient`/`clientToWorld` (WU),
`undoDepth`, `redoDepth`, `mapSimHash` (unsigned), `renderStats`, `waitForRender`, `store`. `ready` wird erst nach
dem ersten gerenderten Frame der Karte true. `window.__editorView` (P1) läuft über dieselbe Session weiter
(`ready`, `mapName`, `error`, `loadMs`, `stats`, `load`, `frame`, `benchFrames`).

### Adapter (`src/app/view-markers.ts`)

`EditorStore` → `ViewMarkers` mit stabilen Array-Identitäten: Listen direkt aus dem unveränderlichen Dokument,
`expanded` nur neu bei geänderter Feldliste oder neuem Höhenfeld (nicht bei jedem Spot-Drag), `issues` behält das
alte Array bei inhaltsgleicher Liste. So bleibt `overlay.update` inkrementell.

## Dateien

`apps/marker-editor/index.html`, `src/main.ts`, `src/app/{controller,hooks,keymap,strings,view-markers}.ts`,
`src/app/tools/{types,common,select,place,field,index}.ts`, `src/io/{bundled,errors,files,session,sha256,storage,index}.ts`,
`test/app/{support.ts, controller,keymap,session,view-markers}.test.ts`, `docs/status/track-editor-p5.md`.
Außerhalb der eigenen Pfade wurde nichts geändert, nichts installiert.

## Tests

- `pnpm vitest run apps/marker-editor/test/app`: **4 Dateien, 47 Tests grün** (≈ 0,4 s).
  - controller (25): jedes Werkzeug mit Fake-Picker/-HitTest. Selektion (Shift additiv/abwählen, Klick auf
    Mehrfachselektion), Marker-, Feld-, Vertex- und Radius-Drag jeweils als ein Undo-Schritt (Undo bytegleich),
    Kanteneinfügen per Doppelklick, Pan beim Ziehen ins Leere, Esc bricht einen Drag ab, Hover/Cursor.
    Platzieren inkl. Live-Symmetrie (Zwilling im selben Schritt), Kreis (Draft, Mindestradius, Hinweis, Esc),
    Polygon (Doppelklick, Enter, Klick auf ersten Punkt, Backspace, Esc, selbstschneidend bleibt Draft, Pan ohne
    Punkt), Werkzeug-/Kartenwechsel verwirft Draft, Löschwerkzeug (Marker, Vertex, Feld; letzter Start und 3 Punkte
    bleiben).
  - keymap (8): alle Shortcuts (Ctrl und Cmd), Digit-Reihenfolge, Kamera-/Alt-/Repeat-Tasten bleiben frei,
    Eingabefelder, `isEditableTarget`, Controller-Aktionen am Store, Backspace im Polygon-Werkzeug, Sperren
    während eines Drags.
  - session (10): alle 4 Karten laden und bytegleich speichern, `markSaved`/Dateiname, markers.json-Download,
    defekte Datei (deutsche Meldung, alte Karte bleibt), HTTP 404, Datei/Bytes/falscher Dateityp, Nachfrage bei
    ungespeicherten Änderungen, überholte Ladevorgänge, SHA-256 gegen `node:crypto`.
  - view-markers (4): Identitätsstabilität, Neu-Expansion nur bei Feld-/Höhenänderung, `sameIssues`.
- `cd apps/marker-editor && npx tsc -p tsconfig.json --noEmit` grün (inkl. `src/ui` von P6);
  `tools/heavy npx tsc -p tsconfig.tests.json --noEmit` grün; `npx eslint --max-warnings 0` auf alle P5-Pfade grün.
- `tools/heavy pnpm vitest run apps/marker-editor`: 25 Dateien, 293 Tests grün.
- `tools/heavy pnpm --filter @faf/marker-editor build`: grün (main 30 kB, terrain-view 670 kB / 179 kB gzip).
- `FAF_E2E_PORT=4783 tools/heavy pnpm test:e2e:editor`: **18/18 grün** (view.spec, chromium/firefox/webkit, 15,6 s).
- **Ad-hoc-Playwright** (Port 4783, `vite preview`, Server danach beendet) in chromium, firefox und webkit, jeweils
  alle 39 Prüfungen grün: Digit-Werkzeugwahl, Start/Mass/Hydro setzen, Kreisfeld ziehen, Polygon per Klicks +
  Doppelklick, Polygon-Esc, Spot-Drag = 1 Undo-Schritt, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Feld anklicken, Vertex-Drag,
  Kanteneinfügen per Doppelklick, Radius-Drag, Pan ins Leere, Löschwerkzeug, Delete-Taste, Esc leert Selektion,
  KeyG/KeyF, Ctrl+S-Download == `exportBytes` und danach nicht mehr dirty, `exportSha256`, Ctrl+O mit Dateiauswahl,
  Drag&Drop, defekte Bytes (deutsche Meldung, alte Karte bleibt), Roundtrip aller 4 Karten per SHA-256 bytegleich
  mit den mapSimHash-Goldens (0x90ec94f0, 0x22cb60a8, 0xeeaec694, 0x52eccf92), letzte Karte aus localStorage,
  keine Konsolenfehler. Screenshots mit dem Read-Tool geprüft: Panels von P6 um die Karte, Marker, Draft, Felder mit
  Props und Griffen, Validierungsmarker, Statusleiste mit Cursor-WU.

## Messwerte (lokal gemessen, Apple M5 Pro, Chromium headless über Playwright, 1280×720, kein GPU-Runner)

| Messung | Wert |
|---|---|
| Laden bis erster Frame (`loadMs`): hollow-ridge / tessera / braidwater / setons | 107–117 / 81–87 / 79–87 / 107–114 ms |
| Spot-Drag auf Setons + 2 Felder, je `pointermove` (Store + Validator + Overlay-Update, ohne Render) | p50 0,5–0,6 ms · p95 0,8–1,0 ms |
| Drag im Feldbereich (Setons, 2 Kreisfelder r = 60 WU, 1.417 Props) | p50 0,9 ms · p95 1,9 ms |
| Frame (`benchFrames(60)`, Setons mit Overlay) | Ø 5,2–5,9 ms · p95 7,0–7,4 ms |

Der Validator läuft bei jedem Drag-Schritt synchron mit; bei ≤ 1 ms pro Schritt war das Aussetzen während einer
Geste (Vorschlag aus P2) nicht nötig.

## Abweichungen / Entscheidungen

1. **Worktree-Pfad** siehe oben.
2. **Polygon schließen** zusätzlich per Klick auf den ersten Punkt (wie in üblichen Editoren). Der zweite Klick
   eines Doppelklicks setzt keinen doppelten Punkt.
3. **Löschwerkzeug auf Vertex** trifft die Griffe aller Felder, nicht nur selektierter. Sonst müsste man vorher
   auswählen.
4. **Esc während eines Drags** macht die Geste rückgängig (ein `undo` nach `endGesture`), der Redo-Stack enthält den
   abgebrochenen Schritt. Das ist bewusst so (wie in Grafikeditoren wiederholbar).
5. **Enter** schließt das Polygon ab. Das ist zusätzlich zu den geforderten Shortcuts.
6. **Ziehen mit Platzier-Werkzeugen** schwenkt die Kamera, statt zu platzieren (gleiches Verhalten wie im Leeren beim
   Auswahlwerkzeug).
7. **`issues()`** liefert die vollständigen `EditorIssue`-Objekte (Obermenge von `{severity, code}`).
8. **Testkorrektur:** Der Session-Test prüfte markers.json auf den Schlüssel `spots`; das mapc-Format hat `mass`/`hydro`.
   Der Test prüft jetzt den gesetzten Mass-Spot.

## Offene Punkte für Folgepakete

- **P7 (E2E):** Das ad hoc geprüfte Szenario (siehe Tests) eignet sich als Vorlage für `test/e2e/editor.spec.ts`.
  Koordinaten über `__editor.worldToClient`. WebKit rastet mit DPR 2 auf ±0,5 WU (Snap 0,5 WU) ein, Toleranzen also
  ≤ 0,5 WU. Firefox braucht die Launch-Optionen aus `playwright.config.ts` (`CFFIXED_USER_HOME`).
  Drag&Drop lässt sich per `DataTransfer` + `DragEvent` auf `window` auslösen, Ctrl+O per `waitForEvent('filechooser')`.
- Die Layer-Sichtbarkeit des Overlays (`overlay.setVisible`) ist noch nicht an die UI angebunden; `PanelIo` sieht
  dafür nichts vor. Das kann ein späterer Vertragsausbau mit P6 ergänzen.
- Undo/Redo-Labels (History) werden nicht als Tooltip gezeigt (siehe P2, kein Signal im Store).
