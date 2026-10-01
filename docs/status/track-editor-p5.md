# TRACK-EDITOR P5: App, Werkzeuge und Dateiablauf

Stand: 29.09.2026, konsolidierter Repository-Root `flow-and-fire`.

`src/main.ts` verbindet `EditorStore`, `TerrainView`, Overlay, Picker, Controller, Panels und `EditorSession`.
Die App lädt die mitgelieferten Karten über `?map=`, Kartenwahl oder den zuletzt gespeicherten Namen. Datei-Dialog und Drag & Drop laden dieselbe Session. Ungespeicherte Änderungen lösen eine Verwerfungsabfrage aus.

Werkzeuge setzen Starts, Mass-/Hydro-Spots und Kreis-/Polygonfelder. Auswahl unterstützt Verschieben, Mehrfachauswahl, Vertex-Griffe, Radius-Griffe, Doppelklick zum Einfügen von Polygonpunkten und Löschen. Ein Drag erzeugt genau einen History-Eintrag. Die Kurzbefehle stammen aus `src/app/keymap.ts`; Escape verwirft die laufende Geste. Die Kamera nutzt rechte/mittlere Maustaste, Alt+Ziehen, Rad, WASD/Pfeile und Q/E.

Dateien liegen unter `src/app/**`, `src/io/**` und `src/main.ts`; reine Tests unter `test/app/**`. `window.__editor` liefert Readback für Bytes, Hash, Markerzahlen, Issues, Projektion, Undo/Redo-Tiefen und Renderstatistik. Der Store wird nur im Messspec direkt verändert; die Browser-Bearbeitungsprüfung benutzt die sichtbaren Werkzeuge und echte Pointer-Ereignisse.

Die integrierten Tests belegen ursprüngliche Kartenbytes, Save-Downloads, deutsche Ladefehler, Dirty-Zustand, JSON-Export, Keyboard-Routing und Controller-Gesten. Der vollständige Nachweis der Browserabläufe und Testbefehle steht im [konsolidierten Bericht](track-editor.md).

P5 ist integriert. Die Übergabe an MS8 betrifft die spätere Simulation und das Spiel-Rendering der Props, siehe Bericht. Im Editor gibt es keine offen gebliebene App-Verkabelung.
