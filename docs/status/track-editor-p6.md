# TRACK-EDITOR P6: Deutsche Bedienoberfläche

Stand: 29.09.2026, konsolidierter Repository-Root `flow-and-fire`.

Die Oberfläche unter `src/ui/**` enthält Werkzeugleiste, Karten-/Dateileiste, Symmetriepanel, Eigenschaften, klickbare Validierung, Statusleiste und Hilfe. Deutsche Texte liegen zentral in `strings.ts`. Eingaben zeigen Fehler und übernehmen gültige Werte mit Enter oder beim Verlassen als einen Undo-Schritt. Koordinaten werden nur an der UI-Grenze in WU umgerechnet; im Store bleiben sie Fx raw.

Das Eigenschaftenpanel bearbeitet Armee, Position, Feldname, Art, gewichtete Blueprint-IDs, Dichte, Seed, Skalierung, Neigung, Trockenfilter, Reclaim und Radius. Ein selektierter Polygonpunkt zeigt seine Position. Mehrfachauswahl zeigt eine Zusammenfassung. Validierungszeilen selektieren die Referenzen und fokussieren den Ort; Fehler-/Warnungs-/Infofilter sind getrennt schaltbar.

`test/ui/**` enthält 38 Tests: Parser/Formatter (18), Auswahlhelfer (7) und echte Komponenten mit happy-dom (13). Die Tests liefen gemeinsam mit allen Editor-Tests grün. Browserprüfungen decken Feld-Property-Commits, ein Undo pro Drag, sichtbare Issues, Einfügen/Löschen von Eckpunkten, Export und Hilfe in 1280×720 sowie 1920×1080 ab.

Bei der visuellen Prüfung fiel eine unter Seitenpanels verdeckte Gesamtansicht auf. Das finale Layout reserviert daher den mittleren Bereich für `#viewport`; `TerrainView.fitCamera()` lässt mehr Rand. Karten, Marker, Feldumrisse und Symmetrieachse bleiben sichtbar. Die Hilfe scrollt bei 720 Pixel Höhe innerhalb des Dialogs.

Die visuellen Nachweise und der genaue Browser-Teststand stehen im [konsolidierten Bericht](track-editor.md). Alle im P6-Vertrag geforderten Test-IDs sind vorhanden. Es bleibt keine UI-Vorschau als Ersatz für die integrierte App.
