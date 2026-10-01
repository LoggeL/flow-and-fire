# rfx-p6: Lab-Szenen und visuelle Prüfung

Stand 30.09.2026 im gemeinsamen Ordner `flow-and-fire`. `createLabFx` verbindet ParticleSystem, BeamPass, TrailPass und ShieldPass. Waffenereignisse erzeugen Mündungsfeuer und Projektile, Raketen tragen einen Rauch-Emitter, Einschläge erzeugen Effekte und Scorch, Tode erzeugen Explosion, Wrack und Schwelen. Build/Reclaim kombinieren Emitter und Beam-Kern. `fx=0` deaktiviert transparente FX-Draws. Alle fünf Szenen sind registriert.

| Szene | Verhalten |
| --- | --- |
| battle | Zwei Armeen mit je 200 Soldaten, verschiedene Waffen, Damage-Smoke, Build/Reclaim-Ströme, periodische Tode und Nachspawn. Der deterministische Test hält 400 Soldaten und prüft mehr als 50 Waffen-/Todesereignisse pro Sekunde. |
| shields | 20 Schilde mit Radien 6 bis 20 WU und zehn Treffern pro Sekunde; Schild 0 verliert HP, kollabiert und baut sich im 12-Sekunden-Zyklus neu auf. |
| big | ACU-Explosion erstmals nach einer Sekunde, dann alle acht Sekunden; umgebende kleine/mittlere Explosionen, drei große Explosionen, Wracks, Krater und CameraShake. Sofort-Trigger über Hook/HUD. |
| gallery | Alle 21 Definitionen mit Labels, periodische Bursts und kontinuierliche Emitter. Die Kamera wurde erweitert, damit auch die fünfte Reihe mit reclaim_stream im Bild liegt. |
| lighting | Opaque-Licht, statische/dynamische Schatten, emissive Units und Scorch/Krater. |

Die Szenentests vergleichen nach 20 Sekunden bei gleichem Seed Event-Prüfsumme und Unit-Zustand; ein anderer Seed verändert das Ergebnis. Die realen FX-Helfertests prüfen Projektil/Trail/Impact-Ablauf, ACU-Wrack/Crater/Shake und `fx=0`.

## Bilder und Bewertung

21 aktuelle Screenshots wurden mit dem Shot-Runner auf Chromium/Firefox/WebKit erzeugt; alle sieben Zeiten je Engine wurden visuell geprüft. Dateimuster: `test-results/fx-shots/<name>-<zeit>-<engine>.png`.

| Bild pro Engine | Beobachtung |
| --- | --- |
| battle-12 | Beide Armeen, helle Tracer/Mündungsfeuer, dunkle weiche Rauchwolken und Bau-Ströme lesbar. Hohe FX-Dichte und lokale Glut, Gelände bleibt erkennbar. |
| shields-6 | Transparente Hüllen mit Fresnel-Rand/Hex-Struktur und lokalen Ripples. 20 Schilde sichtbar, keine schwarzen oder unbestimmten Flächen. |
| big-1.6 | Heller Feuerkern, Glut/Funken und große bodennahe Schockwelle; die Blitzmitte clippt bewusst in Weiß. Die Umgebung bleibt erkennbar. |
| big-4 | Feuer-/Rauchrest, dunkler Krater und Ring aus Wracks; keine persistent weiße Vollbildfläche. |
| gallery-2.8 | Kurzlebige Bursts sowie kontinuierliche Streams; nach Kamerakorrektur ist reclaim_stream in der fünften Reihe im Bild. |
| gallery-3 | Spätere Feuer-/Rauchschichten, alle 21 Label-Positionen auf dem Canvas. Sehr kurze Mündungsblitze sind zu diesem Zeitpunkt bereits abgeklungen. |
| lighting-3 | Schatten, emissive Strukturen, Ruß/Kraterrand und frische Glut lesbar. |

Chromium, Firefox und WebKit zeigen dieselbe Geometrie/Effektanordnung ohne sichtbare NaN-Pixel, Z-Fighting oder Shader-Artefakte. Browser-UI/HUD unterscheiden sich geringfügig. Das HUD überlagert die oberen linken Galerie-Felder; diese Gesamtansicht ist eine Diagnoseaufnahme, keine uneingeschränkte Einzelabnahme jedes Materials. Der Shot-Runner wartet nach `ready` 300 ms, damit sein HUD den gehaltenen Zeitpunkt zeigt, und prüft nun Page-/GL-/Shader-Konsolenfehler. `--scenes`, `--browsers` und `--freeze` werden tatsächlich ausgewertet.

Am 30.09.2026 wurden zusätzlich drei HUD-freie Galerieaufnahmen bei 2,766 s erzeugt und einzeln visuell geprüft: [Chromium](track-renderfx/gallery-2.766-chromium.png), [Firefox](track-renderfx/gallery-2.766-firefox.png) und [WebKit](track-renderfx/gallery-2.766-webkit.png). Der Shot-Lauf endete mit Exit 0 ohne gemeldete Page-/GL-/Shader-Fehler. Alle 21 Labels einschließlich reclaim_stream liegen frei im Bild; Effektpositionen, Terrain und sichtbare Explosion-/Stream-Anordnung stimmen in den drei Engines überein. Keine sichtbaren NaN-Flächen oder Shader-Artefakte. Die sehr kurzen Mündungsblitze bleiben in dieser gehaltenen Gesamtansicht klein beziehungsweise schwach; diese Bilder belegen keine Detailprüfung jedes einzelnen Materials.

Die Bilder `test-results/fx-shots/review-<engine>.png` sind Kontaktbögen des ersten Kamera-Standes; sie ersetzen nicht die neueren Galerie-Einzelbilder. Die LDR- und fehlende-Float-Extension-Pfade wurden zusätzlich im E2E anhand echter Pixel geprüft.

## Funktionale Prüfung

Am 29.09.2026: 210 Unit-Tests in 24 Dateien grün; scoped Typecheck für Lab und Smoke sowie scoped ESLint grün. Der abschließende Drei-Engine-E2E nach der Galerie-Kamerakorrektur bestand 28 Fälle in 31,7 s; zwei ausdrücklich Chromium-spezifische Extension-Masking-Tests wurden in Firefox/WebKit ausgelassen. Echtes Context-Loss/Restore und ≤1-Frame-Soforttrigger bestanden in allen drei Browsern.

Der abschließende vollständige Smoke bestand 18/18 Fälle (Core, Light, Particles, Post, Shields, Trails in drei Engines), alle einschließlich Restore. Light prüft beide Kaskaden; Particles prüft die sichtbare GPU-Position mit ±2 Pixeln. Der unveränderte gemeinsame Bericht ist unter `.git/consolidation/fx-artifacts/render-fx-smoke.json` gesichert; ursprünglicher Ausgabeort `test-results/render-fx-smoke.json`. Die Galerie-PNGs wurden aus `test-results/fx-shots/gallery-2.766-<engine>.png` bytegleich in `docs/status/track-renderfx/` gesichert. SHA-256 und Originalpfade stehen in `.git/consolidation/fx-final-receipt.json`.

## Grenzen

Die Lab-Choreografie ist visuell und verwendet keine Sim-Baufortschrittsdaten. Einige Szenenhelfer allokieren kleine WU-Arrays bei Schritten/Events; der GPU-Kern verwendet vorallokierte Records. Die neueren HUD-freien Galerieaufnahmen beseitigen die Überdeckung. Die 42-Fall-Matrix erfüllt funktionale und Draw-Gates; Chromium-Medium hält 60,002 FPS und die drei Engines 12.275,4..12.278,2 Partikel im Mittel. GPU-Schild-/CSM-Ziele werden verfehlt. Eine WebKit-Low-Messgrenze und die erste Wiederholung erkannten H3/MLX-Last. Die zweite unveränderte Wiederholung hatte leere Lastmarker; die finale Tabelle kombiniert ausdrücklich 40 ruhige Originalfälle mit diesen zwei ruhigen Fällen. Einzelwerte und Rohberichte stehen im Track-Bericht. Kein eigener Server/Browser/Command läuft nach diesem Handoff weiter.
