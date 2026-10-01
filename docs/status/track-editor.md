# TRACK-EDITOR: Marker-Editor und Prop-Felder

Stand: 29.09.2026. M12 ist als Werkzeug vorgezogen. Die Implementierung liegt im gemeinsamen Repository-Root `flow-and-fire`; die ehemaligen Track-Worktrees werden nicht mehr zum Ausführen benötigt.

## Bedienung und Architektur

`pnpm editor` startet die Vite-App. Die Kartenwahl, `?map=setons`, "Öffnen" und Drag & Drop laden `.rtsmap`. "Speichern" lädt die binäre Karte herunter, `markers.json` liefert den Input für `mapc`. Die mitgelieferten Karten werden beim Speichern ohne Bearbeitung bytegleich wiedergegeben.

Die Werkzeuge 1 bis 7 wählen, setzen Starts, setzen Mass-/Hydro-Spots, zeichnen Kreise/Polygone und löschen. Kreise entstehen durch Ziehen vom Mittelpunkt zum Rand; Polygone durch Klicks und Enter/Doppelklick zum Abschluss. Ausgewählte Felder haben Vertex-/Radius-Griffe. Doppelklick auf eine Polygonkante fügt einen Punkt ein; Delete auf einen selektierten Punkt entfernt ihn. Eigenschaften übernehmen gültige Werte mit Enter oder beim Verlassen des Feldes. Ungültige Eingaben bleiben markiert, ohne den Store zu ändern.

Ctrl/Cmd+Z macht rückgängig, Shift+Z bzw. Ctrl+Y wiederholt. Die History hält 500 Einträge; eine Mausgeste ist ein Schritt. F passt die ganze Karte ein, G schaltet das 32-WU-Raster, ? öffnet die Hilfe. Kamera: rechte/mittlere Maustaste, Alt+Linkszug, Rad, WASD/Pfeile sowie Q/E. Das Layout reserviert die Kartenansicht zwischen den Seitenpanels und hält Hilfe/Eigenschaften scrollbar.

`EditorDocument` bewahrt den ursprünglichen Container samt unbekannter Chunks; `History` verarbeitet invertierbare Operationen. `EditorStore` enthält Signals, Auswahl, Expansion und Validierung. `EditorSession` bündelt Loader, Dirty-Abfragen und Downloads. `TerrainView`, `CameraRig`, `MarkerOverlay` und `TerrainPicker` bilden die Tool-Ansicht. three.js ist im Editor bewusst eigenständig, damit laufende Änderungen am Spiel-Renderer keine Editor-Abhängigkeit erzeugen. Workspace-Imports der App sind auf formats/fixed/rules/protocol begrenzt. Client und sim-host werden ausschließlich für Loader-Tests verwendet.

Koordinaten bleiben im Modell, Format und in Validierungsreferenzen ganzzahlig in Fx raw (Q20.12, 4096 raw = 1 WU). Umrechnung in WU findet nur an UI-/three.js-Grenzen statt. Das Format und die Expansion verwenden integer-only-Arithmetik.

## PFLD-Format und Determinismus

Der optionale Chunk `PFLD` folgt `PROP` und steht vor `PREV`. Ohne Chunk bleibt `propFields` absent; ein leerer vorhandener Chunk ergibt `[]`. Bestehende META-Daten und die vier Kartendateien bleiben unverändert. Alle Integer sind Little Endian, Strings UTF-8 mit Nullpadding auf 4 Byte.

| Abschnitt | Layout |
|---|---|
| Kopf | u32 Feldanzahl |
| Je Feld | u16 Namenslänge, Name, Padding; u8 Art (tree/rock/wreck), u8 Form (circle/polygon), u16 Flags (bit0 dryOnly) |
| Parameter | u32 Seed; u16 Dichte, Neigung, Skalierung min/max; u32 Reclaim-Masse/-Energie (Milli) |
| Einträge | u16 Eintragsanzahl, u16 Punktanzahl; je Eintrag u16 ID-Länge, ID, Padding, u16 Gewicht, u16 reserved=0 |
| Form | Kreis: i32 x/z/r; Polygon: je Punkt i32 x/z |

Grenzen: 256 Felder, 64 Polygonpunkte, 16 Einträge, Dichte 1..4096, Namen bis 64 UTF-8-Bytes, Gewichte 1..65535. Polygone sind einfach; Kreisradius mindestens 1 WU. Einzelprops und Expansion zusammen dürfen 65.536 Props nicht überschreiten. Eine zusätzliche Grenze von 2²¹ Kandidatenzellen über alle Felder begrenzt extrem große Suchflächen.

Algo-Version 1 setzt ein an 0 ausgerichtetes globales Raster mit `cellRaw = isqrt(floor(2^34 / density))`. Zellen laufen zeilenweise z, dann x. `rng32(seed, cz, cx, stream)` bestimmt den Punkt innerhalb der Zelle, gewichtete Blueprint-Auswahl, Yaw und Skalierung. Punkte außerhalb von Form/Karte, unter Wasser bei dryOnly oder über der Neigungsgrenze werden verworfen. Neigung stammt aus Zentraldifferenzen am nächsten Höhensample, mit einseitiger Randdifferenz und Integer-Wurzel. Die Ausgabe ist reproduzierbar; der Expansionstest fixiert 380 Props mit xxHash32 `0x1cedb935`.

Für den Sim-Hash wird nur bei nichtleeren Feldern `PFLD`, die Algo-Version und das Feldlayout ohne Namen angehängt. Feldnamen ändern den Hash nicht; Sim-Parameter, Form, Einträge und Reihenfolge tun es. Die vier Legacy-Goldens bleiben `90ec94f0`, `22cb60a8`, `eeaec694`, `52eccf92`. Gespiegelte Felder erzeugen eine statistisch passende Verteilung; ihr globales Zellraster spiegelt einzelne Props nicht punktgenau.

## Symmetrie und Validierung

Symmetriemodi sind Punkt, Achse X/Z, Diagonale und Gegendiagonale. "Symmetrisieren" ersetzt die verworfene Hälfte durch das exakte raw-Spiegelbild der gewählten Hälfte, als einen History-Schritt. Live-Symmetrie spiegelt Änderungen und ihre Zwillinge. Setons/Tessera bleiben bei passender Symmetrisierung bytegleich; diese Invariante ist im Modell getestet.

| Regel | Schwelle |
|---|---|
| Rand | Start mindestens 16 WU, Spot mindestens 12 WU |
| Wasser | Höhe ≤ Wasserspiegel ist ein Fehler |
| Spot-Flachheit | Fehler bei > 0,5 WU Höhendifferenz im 1,5-WU-Radius; Warnung bei > 410 raw im 3-WU-Radius; Abtastschritt 0,25 WU |
| Abstände | Spots < 2 WU Fehler, < 4 WU Warnung; Spot/Start < 4 WU Fehler; Starts < 48 WU Fehler, < 96 WU Warnung |
| Startbauplatz | Weniger als 50 % passierbar im 8-WU-Radius: Warnung |
| Erreichbarkeit | 4-Nachbarschaft über Land, Neigung ≤ 0,6 und kein Tiefwasser; nächster passierbarer Punkt bis 4 WU; isolierter Start Fehler, isolierter Spot Warnung |
| Felder | Ungültige Expansion Fehler; leeres Feld Warnung; Prop-Obergrenze Fehler; Props < 2 WU am Spot / < 8 WU am Start Warnung |
| Symmetrie | Info mit erkanntem Modus oder fehlenden Gegenstücken; Toleranz 1 WU |

Die Terrainanalyse wird je Höhenfeld gecacht, Feldexpansion je Feldobjekt. Alle vier mitgelieferten Karten liefern 0 errors. Hollow Ridge hat zwei Flachheitswarnungen, Setons zehn Warnungen für Insel-Spots, Tessera/Braidwater keine Warnungen. Die Liste ist klickbar und fokussiert/selektiert die betroffenen Marker.

## Abnahme und Nachweise

Die abschließende Browserprüfung läuft mit `FAF_E2E_PORT=4883`, workers=1; der bereits benutzte Benutzer-Port 4783 bleibt erhalten. Der Standardbefehl bleibt `pnpm test:e2e:editor`, Port überschreibbar per Umgebung.

| Plan-Abnahme | Nachweis / Stand |
|---|---|
| App baut, lädt, zeigt Terrain/Wasser/Licht/Raster | ✅ Paket-Build; View-E2E aller Karten |
| Bestehende Karten bytegleich | ✅ Node-Modelltests und Browser-Downloads mit Bytevergleich/SHA in drei Engines |
| Editierter Export über ClientMap/resolveMap bytegleich, Hash gleich | ✅ `roundtrip-game.test.ts`; `edit.spec.ts` mit echtem Download und beiden Spiel-Loadern |
| Additiver PFLD-Codec/Hash/Legacy-Goldens | ✅ Formats-Tests; P0-Spezifikation und Property-Tests |
| Integer-Expansion, Golden, Dichte/Form | ✅ `propfields.test.ts`; determinism-Lint über globale Integration |
| Bearbeiten inklusive Formgriffe/Properties | ✅ echte Klicks/Drags, Polygonpunkt einfügen/löschen, Kreis bewegen/Radius ziehen, Werte im Download geprüft |
| Symmetrie und unveränderte symmetrische Karten | ✅ Modelltests aller Modi; Browser Punkt + Live-X |
| Undo/Redo jeder Operation | ✅ History-/Store-Tests und 450 Property-Läufe; Browser komplett bis Original-SHA zurück und wieder vor |
| Validierung jeder Regel und klickbare Liste | ✅ 56 Validierungstests; Browser Wasser/Hang/Rand mit Auswahl und Undo |
| Export `.rtsmap` / `markers.json` | ✅ Download + Spiel-Loader; heruntergeladenes JSON über mapc mit identischen Markern/Feldern |
| Drei Browser und geprüfte Screenshots | ✅ 48 funktionale + 3 Messspec-Tests grün; 42 Screenshots visuell geprüft, siehe P7 |
| Benchmarks lokal, kein Gate | Aktualisierte Messwerte im folgenden Abschnitt |
| App-Abhängigkeiten / Eigentumsgrenzen | ✅ keine Editor-Imports von sim/nav/render/client; globale Abhängigkeitsprüfung beim Konsolidieren |
| Repo-weite Prüfungen | Root-Integrationsprüfung, da die anderen sechs Tracks gleichzeitig integriert werden |
| Dokumentation | ✅ dieser Bericht, Fragmente P0..P7 und vier repräsentative Bilder |

292 Editor-Tests in 25 Dateien bestanden: `./tools/heavy pnpm vitest run apps/marker-editor --maxWorkers=4`. App-Typprüfung und ESLint der App/Browsertests bestanden. Paket-Build bestand. Die globale Prüfung der anderen Tracks und Konfiguration gehört zur konsolidierten Root-Abnahme und wird dort protokolliert.

## Messwerte

Lokal auf Apple M5 Pro, Node v24.18.0, zwei vollständig nacheinander ausgeführte Benchmarks je Paket im vom Root reservierten ruhigen Fenster. Jeder Node-Benchmark hat 25 Läufe plus Warm-up. Browser: zwei Ladevorgänge und je 60 Kameraframes pro Engine. Kein Gate und kein iGPU-/GPU-Runner.

| Node-Messung | p50 über beide Läufe | p95 über beide Läufe |
|---|---:|---:|
| Hollow Ridge Terrainanalyse / gecachte Validierung | 3,48..3,84 / 0,08 ms | 4,43..5,36 / 0,09..0,10 ms |
| Tessera Analyse / Validierung | 3,47..3,65 / 0,08 ms | 4,24..5,17 / 0,09..0,15 ms |
| Braidwater Analyse / Validierung | 3,28..5,08 / 0,09 ms | 4,03..6,08 / 0,11..0,12 ms |
| Setons Analyse / Validierung | 12,57..13,24 / 0,31..0,36 ms | 14,69..15,43 / 0,37..0,72 ms |
| Setons + 16 Felder, Felder gecacht | 0,76..0,93 ms | 1,14..1,56 ms |
| Setons + 16 Felder, ein Feld geändert | 1,06..1,11 ms | 1,53..1,93 ms |
| Expansion 29.978 Props | 8,55..8,65 ms | 9,76..10,58 ms |
| Expansion 64.674 Props | 18,06..18,39 ms | 21,46..23,35 ms |
| PFLD 256 Felder encode / decode | 0,152..0,181 / 0,115..0,118 ms | Rohwerte in Ergebnis-JSON |
| Setons read + write, bytegleich | 12,16..12,85 ms | 13,39..14,89 ms |

| Browser | Setons Laden | Frame p50 / p95 | Änderung mit Store, Validierung und Overlay p50 / p95 |
|---|---:|---:|---:|
| Chromium | 103..134,5 ms | 2,6 / 2,7..3,3 ms | 0,7..0,8 / 1,4..2,0 ms |
| Firefox | 144..233 ms | 2 / 3..5 ms | 1 / 4..5 ms |
| WebKit | 105..150 ms | 2 / 2..3 ms | 1 / 2 ms |

Browser-Framezeit misst die Renderarbeit auf dem CPU-Pfad; sie enthält keine vollständige GPU-Synchronisation. Die gesonderten P1-Berichte verwenden ReadPixels für synchronisierte Frames. Die Browser-Änderungsmessung umfasst Store/History/Overlay und ist daher breiter als der reine Node-Validator. Timerauflösung in Firefox/WebKit erklärt ganzzahlige Werte.

Alle aktuellen Rohwerte sind dauerhaft unter [track-editor/](track-editor/) gespeichert: zwei `validate-*.json`, zwei `propfields-*.json`, `perf-{chromium,firefox,webkit}.json` und [Abnahme samt Screenshot-Prüfliste](track-editor/abnahme.json).

Vier geprüfte Beispiele, jeweils maximal 400.000 Bytes: [Setons](track-editor/setons.png), [Bearbeitung mit beiden Feldformen, Props und Achse](track-editor/bearbeitung.png), [Validierung](track-editor/validierung.png), [Hilfe](track-editor/hilfe.png).

## Abweichungen und Übergabe

Die alte Anweisung "git diff 2fc956c über sim/nav/render/client/apps/game muss leer sein" beschreibt die isolierte Track-Abnahme. Im konsolidierten Root ändern andere autorisierte Tracks diese Bereiche. Editor-Arbeit bleibt auf `apps/marker-editor` und eigene Statusdokumente begrenzt; keine Kartendatei wird geändert.

`markers.json` repräsentiert Mass-Spots vor Hydro-Spots. Bei interleavter Reihenfolge bewahrt `.rtsmap` die Reihenfolge, der mapc-JSON-Roundtrip prüft die entsprechend gruppierten Marker. SPLT/PREV und unbekannte Chunks sind keine JSON-Markerattribute; binärer Export erhält sie vollständig.

MS8 muss `expandPropFields` im Sim-Worker einmal beim Laden an die Props-Tabelle anschließen und Reclaim-/Blueprintdaten verwenden. Spiel-Prop-Blueprints `core:tree_*`/`core:rock_*` sowie echtes Spiel-Rendering sind Folgearbeit. Die Editor-Punkte/Umrisse sind bereits vollständig sichtbar. Editor-E2E kann bei der Root-Integration in `ci:local` aufgenommen werden; diese globale Konfiguration wird nicht vom Editor-Worker geändert.

Anhänge: [P0 Format](track-editor-p0.md), [P1 Terrain](track-editor-p1.md), [P2 Modell](track-editor-p2.md), [P3 Validierung](track-editor-p3.md), [P4 Overlay/Picker](track-editor-p4.md), [P5 App](track-editor-p5.md), [P6 UI](track-editor-p6.md), [P7 Abnahme](track-editor-p7.md).
