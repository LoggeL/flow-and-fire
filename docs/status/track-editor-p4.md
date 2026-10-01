# TRACK-EDITOR · P4 – Marker-Overlay (three.js) und Terrain-Picking

Stand: 2026-09-29 · Worktree `faf-editor`, Branch `track-editor` · App `apps/marker-editor` (Tool-Code)

## Umfang

### `src/overlay/` – MarkerOverlay

- `types.ts`: `MarkerRef`, `SymmetryMode`, `EditorIssue`, `Validator` und `ViewMarkers` exakt wie vorgegeben
  (strukturell identisch zu P2/P3, ohne Import von `src/model` oder `src/validate`), dazu `DraftField`,
  `OverlayLayer`, Helfer `sameRef`/`refIn`/`fieldSelected` sowie `OverlayView`: die Teilmenge von
  `TerrainView`, die Overlay und Picker nutzen (`scene`, `camera`, `canvas.getBoundingClientRect`, `map`,
  `renderer?.getPixelRatio`, `heightWuAt`, `requestRender`, `onBeforeRender`). `TerrainView` erfüllt sie
  strukturell, `new MarkerOverlay(view)` mit einer `TerrainView` funktioniert also wie gefordert.
- `overlay.ts`: `class MarkerOverlay { constructor(view); update(m); setVisible(layer, v); dispose() }`,
  außerdem `isVisible`, `stats()`, `buildCounts()` und `partGroup()` für Tests und Diagnose.
  - **Starts**: Säule, halbtransparente Scheibe, Ring in Armeefarbe (Palette = `DEFAULT_ARMY_COLORS` des Spiels,
    kopiert) und eine Nummern-Plakette (CanvasTexture-Sprite). Angezeigt wird `army + 1`, also 1-basiert wie
    `ARMY_1` in FA.
  - **Spots**: Mass als grüner Ring, Hydro als cyanfarbene Raute, beide mit dunklem Rand (DECISIONS 28).
  - **Felder**: Umriss über `THREE.ShapeUtils` trianguliert, gleichmäßig unterteilt (Kante ≥ 2 WU,
    insgesamt ≤ ~240k Dreiecke), Vertexhöhen über `view.heightWuAt` plus 0,08 WU Anhebung und
    `polygonOffset`. Alle Felder landen in **einem** Mesh mit RGBA-Vertexfarben, Farbe nach `kind`. Der Umriss
    ist ein `LineSegments2` mit 2 px Breite, auf 1 WU lange Stücke gerastert.
  - **Props**: Die expandierten Props sind **ein** `THREE.Points`, nach Feld-`kind` gefärbt. Der eigene
    Shader liefert Weltgröße 1,1 WU, mindestens 2,5 Geräte-px. Die Anzahl ist auf `MAP_MAX_PROPS` = 65.536
    begrenzt. Explizite PROP-Einträge sind ein zweites `Points` mit kleinen grauen Punkten.
  - **Selektion/Hover**: Ringe um Starts und Spots (Selektion gelb, Hover hellblau). Selektierte oder gehoverte
    Felder bekommen einen dicken Umriss (3,5 px). Selektierte Felder zeigen Vertex-Griffe (Polygon) bzw. einen
    Radius-Griff bei `(x + r, z)` (Kreis). Ein selektierter oder gehoverter Griff ist eingefärbt.
  - **Issues**: Rot, gelb oder blau, jeweils als Bodenring plus Plakette (Dreieck mit „!“ bzw. Kreis mit „i“).
    Die Position ist `x/z` oder, falls leer, die des ersten Refs (`issuePosition`, exportiert). Issues ohne
    jede Position bekommen keinen Marker.
  - **Symmetrie**: Gestrichelte, drapierte Achse (magenta). `mirrorX` = Achse x = S/2, `mirrorZ` = z = S/2,
    `diagonal` = x = z, `antiDiagonal` = x + z = S, jeweils passend zu den P2-Definitionen. Bei `point` ein
    Kreuz mit Ring im Zentrum.
  - **Draft**: Weiß gestrichelt, mit Punkt-Griffen. Bei Kreisen sind die Punkte Mittelpunkt und Randpunkt,
    bei Polygonen wird ab 3 Punkten geschlossen.
  - **Mindestgröße**: Pro Frame (`onBeforeRender`) gilt `scale = max(1, minPx · WU/px / radiusWu)`, gemessen
    am Abstand Kamera→Marker. Die Mindestradien sind Start 14 px, Mass 7 px, Hydro 9 px, Griff 6 px, Issue
    11 px. Die Strichlänge gestrichelter Linien wird ebenfalls in px gehalten (12/8 px), die Linienbreite
    über `LineMaterial.resolution`.
  - **Inkrementell**: `update()` vergleicht jedes Array von `ViewMarkers` per Identität und baut nur betroffene
    Teile neu (`starts`, `spots`, `fields`, `expanded`, `props`, `issues`, `symmetry`, `draft`, `highlight`).
    Abhängigkeiten: `fields` betrifft `expanded` (Farbe), `issues` (Ref-Position) und `highlight`.
    `starts`/`spots` betreffen `issues` und `highlight`. `selection`/`hover` betreffen nur `highlight`.
    Wechselt `view.map` (neue Höhen) oder `sizeWu`, wird alles neu drapiert. Bei unveränderten Arrays wird
    nichts gebaut und kein Render angefordert.
- `geometry.ts` (rein, testbar): Umrisse, Triangulierung, Unterteilung, Drapieren von Dreiecken und
  Polylinien, Symmetrie-Achsen. `style.ts`: Farben, Größen, `wuPerPixel`, `minPixelScale` (auch vom Picker
  benutzt, damit Trefferradius und Zeichnung übereinstimmen). `labels.ts`: Canvas-Texturen; ohne Canvas
  (Node) wird eine einfarbige Sprite-Fläche gezeichnet.
- `demo.ts` + `apps/marker-editor/overlay-demo.html`: Demo-Seite per dynamischem Import, `main.ts` bleibt
  unverändert. Parameter `?map=<name>` (Standard setons) und `?sym=<mode>` (Standard point). Hat die Karte
  keine Felder, kommen drei Demo-Felder dazu (Hain, Felsband, Wrackfeld). Dazu je ein Issue pro Schwere und ein
  Draft-Polygon. Hover und Klick laufen über `hitTestMarkers`, die Statuszeile zeigt den gepickten Punkt.
  Für Playwright gibt es den Hook `window.__overlayDemo`.

### `src/pick/` – Picking und Hit-Test

- `TerrainPicker.pick(clientX, clientY) → {x, z} | null` in Fx raw (`Math.round(wu · 4096)`); `pickWu` liefert
  zusätzlich die Höhe, ohne Rundung.
  - Der Strahl geht durchs Pixel (Kamera-Unproject) und wird auf die Kartenbox `[0,S] × [hMin,hMax] × [0,S]`
    geclippt; die Höhengrenzen werden je Karte einmal bestimmt.
  - Marsch über `view.heightWuAt`, also dieselbe bilineare Höhe, die auch die Sim nutzt. Der Schritt ist
    höchstens 0,5 WU horizontal. Er wird zusätzlich über eine Lipschitz-Schranke verkürzt (steilster
    Nachbarschritt der Karte), damit streifende Strahlen nicht durch Grate tunneln. Der kleinste Schritt ist
    1/256 WU, das entspricht der x/z-Auflösung von `sampleHeightRaw`.
  - Im Bracket folgt ein Nachmarsch mit 1/32 WU, dann Bisektion bis ≤ 1/4096 WU (gefordert: ≤ 1/64 WU).
  - `null` gibt es außerhalb der Karte, ohne Karte, bei leerem Canvas und wenn der Strahl seitlich unter der
    Oberfläche in die Box eintritt.
- `worldToClient(view, xRaw, zRaw)` projiziert den Terrainpunkt mit `heightWuAt`. `null` gibt es hinter der
  Kamera und außerhalb des Canvas. Zusätzlich exportiert: `projectWu(view, x, y, z)`.
- `hitTestMarkers(view, m, clientX, clientY, radiusPx = 12)`: Priorität fieldVertex/fieldRadius (nur
  selektierte Felder, auch wenn nur ein Griff selektiert ist) > start > spot > field (Punkt in Fläche über
  `propFieldContains` am gepickten Terrainpunkt). Innerhalb einer Klasse gewinnt der nächste Marker. Getroffen
  ist, was innerhalb von `max(radiusPx, gezeichneter Radius)` liegt, sodass große Start-Ringe in der Nahansicht
  überall greifen. Bei Feldern gewinnt das kleinste enthaltende Feld (das spezifischste), bei Gleichstand der
  höhere Index. Zusätzlich exportiert: `fieldAnchor(shape)` (Kreismitte bzw. BBox-Mitte), gedacht für das
  Verschieben ganzer Felder in P5.

## Dateien

- neu: `apps/marker-editor/src/overlay/{types,style,geometry,labels,overlay,demo,index}.ts`,
  `apps/marker-editor/src/pick/{picker,index}.ts`, `apps/marker-editor/overlay-demo.html`,
  `apps/marker-editor/test/overlay/{geometry,overlay}.test.ts`,
  `apps/marker-editor/test/pick/{picker,hittest}.test.ts`, `apps/marker-editor/test/pick/support.ts`
  (WebGL-freier `FakeView` mit Kamerapose wie `CameraRig.apply`, synthetische Karten, PRNG)
- Keine Änderungen außerhalb der eigenen Pfade. `src/view`, `main.ts`, `package.json` und formats sind
  unverändert, es wurde nichts installiert.

## Tests

41 Tests in 4 Dateien, Node, ohne WebGL:

- `pnpm vitest run apps/marker-editor/test/overlay apps/marker-editor/test/pick` → 41/41 grün
- `cd apps/marker-editor && npx tsc -p tsconfig.json --noEmit` → ok; `tsconfig.tests.json` (über `tools/heavy`) → ok
- `tools/heavy pnpm lint` (eslint + depcruise) → ok, keine Dependency-Verstöße
- `tools/heavy npx vite build` (in einen Scratch-Ordner) → ok, `overlay-demo.html` wird mitgebaut

Inhalt:

- **Picking-Genauigkeit**: je 1.000 sichtbare Stichproben auf den synthetischen Karten flach, Rampe und
  Klippe (20-WU-Klippe plus dünner 8-WU-Grat), aus 5 Kamerawinkeln (Pitch 25°–80°, verschiedene Yaws und
  Distanzen). Die Referenz ist ein Oberflächenpunkt, der projiziert und zurückgepickt wird. Verdeckte Punkte
  erkennt ein unabhängiger dichter Marsch mit 1/256 WU. Zusätzlich gibt es einen analytischen
  Strahl/Ebene-Vergleich (flach, ≤ 1/256 WU), einen Test gegen Tunneln an streifenden Graten, `null`-Fälle,
  Kartenwechsel und Fx-raw-Integer.
- **worldToClient∘pick**: Identität auf flach und Rampe < 0,1 px. Ein erneutes Picken ergibt auf allen Karten
  ≤ 1/16 WU.
- **hitTest**: Prioritäten (Griff > Start > Spot > Feld), Griffe nur bei selektierten Feldern, Radius-Griff,
  verschachtelte Felder, Pixelradius (11 px Treffer, 13 px kein Treffer; mit `radiusPx` 20), gezeichneter
  Radius > Pickradius, nächster Marker einer Klasse.
- **Overlay**: Triangulierung (Quadrat, konkaves L, Stern, Splitter; Fläche = Polygonfläche ±1 %, auch nach
  Unterteilung), Kreise ±1 % zu πr², Drapieren, Polylinien-Unterteilung, Symmetrie-Achsen. Weiter geprüft:
  Objekt- und Instanzzahlen, genau ein `Points` für die expandierten Props, Deckelung auf 65.536,
  Fill-Fläche = Summe der Feldflächen ±1 %, `update()` ohne Neubau bei unveränderten Arrays, gezielte
  Neubauten je geändertem Array und kompletter Neubau bei Kartenwechsel. Außerdem Selektion, Hover und
  Griffe, Mindestgröße in px (Übersicht) und 1:1-Größe (Nahansicht), Symmetrie, Draft, `setVisible`,
  `dispose` und `issuePosition`.

## Messwerte

Lokal gemessen auf Apple M5 Pro, Node bzw. Chromium headless über Playwright. Das ist kein
CI-/iGPU-Referenzwert.

| Messung | Wert |
| --- | --- |
| Picking-Fehler flach (max/Mittel, 1.000 Stichproben) | 0,00017 / 0,00009 WU |
| Picking-Fehler Rampe | 0,0081 / 0,0006 WU |
| Picking-Fehler Klippe (312 verdeckte Punkte übersprungen) | 0,028 / 0,00015 WU |
| Grenze MS2 | ≤ 0,0625 WU (1/16) |
| worldToClient∘pick flach / Rampe | 0,004 / 0,053 px |
| worldToClient∘pick Klippe | 0,94 px (s. Abweichungen), erneutes Picken 0,0000 WU |
| `pick()` auf Setons, Gesamtansicht | 6–8 µs pro Aufruf (Node) |
| `update()` komplett, Setons + 2 große Felder (54.690 Props, 204.183 Fill-Dreiecke, 116 Spots) | 34,5 ms |
| `update()` nur Selektion | 0,4 ms |
| Skalierung pro Frame | 0,07 ms |
| Demo im Browser, Setons | 8 Starts, 116 Spots, 3 Felder, 810 expandierte + 72 explizite Props, 60.445 Fill-Dreiecke, keine Konsolenfehler |

Die Werte der Rampe und der Klippe kommen von der 1/256-WU-Quantisierung in `sampleHeightRaw` (Höhe als
Treppe) und von Graten, die flacher als 0,02 WU gestreift werden.

**Screenshots** (Playwright ad hoc, Port 4783, Vite-Dev-Server danach beendet), mit dem Read-Tool geprüft:

- Setons-Gesamtansicht mit Punktsymmetrie: Alle 8 Starts sind mit Nummer lesbar, die 116 Mass-/Hydro-Spots
  bleiben als Ring bzw. Raute unterscheidbar.
- Setons-Nahansicht: Start in 1:1-Größe, Polygon mit Griffen, Props und Fläche über Wasser.
- Hollow Ridge mit Anti-Diagonale: Achse korrekt, Hain in Nahansicht mit grünen Baum-Props, Umriss an
  der Klippe drapiert.

## Abweichungen und Entscheidungen

- **Konstruktor-Typ**: `MarkerOverlay` und `TerrainPicker` nehmen `OverlayView` statt `TerrainView`. Das ist
  ein strukturell kompatibler Obertyp, so laufen die Tests ohne WebGL. Aufrufer übergeben weiter die
  `TerrainView`.
- **Alle Overlay-Materialien liegen im Transparent-Pass**, auch deckende. three.js zeichnet opake Objekte vor
  transparenten, deshalb hätten Wasser und Feldflächen trotz `renderOrder` die Marker verdeckt. Das hat der
  erste Screenshot gezeigt.
- **Marker, Umrisse, Griffe und Achsen zeichnen ohne Tiefentest** und sind damit auch hinter Hügeln sichtbar.
  Das ist Editor-Verhalten wie im FA-Editor. Feldflächen und Props sind tiefengetestet.
- **Picker-Feinheiten**: Die Bisektion geht bis 1/4096 WU statt 1/64 WU, der kleinste Schritt ist 1/256 WU.
  Die Picking-Tests zählen einen Punkt erst ab 0,02 WU Eindringtiefe als verdeckt. Grate, die flacher
  gestreift werden, sind Subpixel-Splitter, die der Picker übergehen darf.
- **Identität auf Klippen**: Die Pixel-Identität von worldToClient∘pick wird auf der 20:1-Klippenfläche nicht
  in px geprüft, sondern über erneutes Picken in WU. `sampleHeightRaw` ist dort eine Treppe mit 0,08 WU
  Stufen, der Pixelversatz kommt aus der Höhe und nicht aus dem Picker.
- **Nummern-Plakette** zeigt `army + 1`.

## Offene Punkte für Folgepakete (P5 App/Controller, E2E)

- Anbindung in P5: Aus dem EditorStore (P2) ein `ViewMarkers` bauen. Arrays nur bei Änderung neu erzeugen,
  sonst verliert `update()` die Inkrementalität. `expanded` sollte memoisiert über `expandPropFields`
  entstehen, nur wenn sich `fields` oder die Karte ändern. `issues` kommen aus den P3-Validatoren.
- Drag-Logik in P5: Für pointermove `TerrainPicker.pick` verwenden, Griff und Start über `hitTestMarkers`,
  ganze Felder über `fieldAnchor` plus Delta.
- Die Sichtbarkeitsschalter (`setVisible`) in der UI anbieten. Symmetrieachse und Draft hängen nicht an
  einem Layer.
- Eine E2E-Spezifikation für das Overlay (Screenshots, Hover, Klick) gehört in `test/e2e/`. Das liegt nicht
  in P4-Besitz, der Demo-Hook `window.__overlayDemo` ist aber vorhanden.
- Performance-Idee: Große Felder mit sehr feiner Unterteilung (Budget 240k Dreiecke) könnten später als
  Terrain-Decal (Shader) statt als drapiertes Mesh gezeichnet werden. Aktuell ist das nicht nötig
  (34 ms Vollaufbau im Extremfall).
