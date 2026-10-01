# rfx-p4: Beams, Trails und Schilde

`BeamPass` und `TrailPass` verwenden instanzierte Quads und geben je einen Draw zurück. Beam-Styles liefern Kern/Glut/Breite/Noise; zeitlich begrenzte Beams blenden aus. Trails bekommen prev/cur-Rohpositionen und interpolieren den Kopf auf der GPU. `ShieldPass` verwendet ein instanziertes Icosphere-Mesh, Fresnel und vier Treffer-Ripples je Schild. Neue Treffer ersetzen den Slot mit geringster Restenergie, bei Gleichstand den ältesten.

Alle Ressourcen verwenden das RHI mit Restore. Beams/Trails/Schilde teilen Frame-UBO 0 und FxView-UBO 6. Der transparente Pass testet Tiefe, schreibt sie nicht und verwendet premultiplied blending. Varkan-Styles stehen in `trails/presets.ts`; Shape-/Style- und Pack-Konstanten sind über das Paket exportiert.

Die Unit-Tests prüfen Packen, Interpolation, Kapazitäten, Fade, Ripple-Ersetzung, Draws und Restore. Die Browser-Smokes `trails` und `shields` prüfen Pixelpositionen/Profile sowie Restore in Chromium/Firefox/WebKit. Die Lab-Szene `shields` hält 20 Schilde mit zehn Treffern pro Sekunde; Schild 0 kollabiert und baut sich neu auf. Die GPU-Zielzeit ≤1 ms wird erst mit der ruhigen Messung bewertet.

MS5/MS7 brauchen Projectile-prev/cur und Styles. MS13 braucht Shield-ID/Position/Radius/Farbe/HP/Aufbau sowie Treffer-ID/-Position/-Zeit/-Stärke. Konkrete Integration: [track-renderfx.md](track-renderfx.md).
