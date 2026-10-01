# rfx-p7: Benchmark, E2E und Track-Dokumentation

Stand 30.09.2026. Die vollständige Three-Engine-Matrix und die ergänzende HUD-freie Galerieprüfung sind ausgeführt. Funktionale Gates bestanden; Fremdlast-Beobachtungen und verfehlte GPU-Ziele werden getrennt ausgewiesen.

## Umgesetzt

`scripts/bench.ts` baut per Vite und liefert Dateien über isolierte `page.route`-Origin mit COOP/COEP/CORP aus, ohne Server-Port. Je Seite 1920×1080 CSS-Pixel, `bench=1`, `flight=1`, Seed 77. Vollständige Szenarien: battle, battlelow, shields, big, lightingcsm, lightingnocsm, battleldr. Standard: drei Engines nacheinander, zwei Durchläufe, zwei Sekunden Warm-up und acht Sekunden Messung. Quick: Chromium, battle/shields/big, ein Durchlauf, eine Sekunde Warm-up und drei Sekunden Messung.

Der Runner schreibt CPU-/GPU-Quantile, FX-/Gesamt-Draws, Partikelmenge, Cap/Dropped, Browser-Versionen und Lastindikatoren in JSON. Browser-Launch-/Seitenfehler bleiben im Bericht erhalten. Draw-Gates gelten für jeden erfassten Frame, nicht nur für den Endzustand. GPU-Gesamtzeit wird nur aus vollständig aufgelösten Segmenten berechnet. `--update-docs` aktualisiert CPU-/GPU-Quantile, Segment-p95 und Budgettabellen im Markerblock des Track-Dokuments. Fehlende Marker sind ein Fehler. Zeitwerte lösen keine Leistungs-Exit-Gates aus.

`playwright.config.ts`: eigener Port 4683 oder FAF_E2E_PORT, ein Worker, keine Wiederholungen, kein Reuse fremder Server. Die zehn Tests pro Engine prüfen alle fünf Szenen, Low-Cap, LDR/FX-off, automatischen Fallback ohne Float-Targets, echten Context-Restore und sofort sichtbare Explosion. Der Float-Extension-Maskentest wird ausschließlich auf Chromium ausgeführt; die anderen neun Tests laufen in allen Engines.

## Nachweise

| Aufruf | Ergebnis am 29.09.2026 |
| --- | --- |
| `./tools/heavy pnpm exec vitest run packages/render-fx apps/fx-lab --maxWorkers=4` | 210/210 Tests, 24 Dateien |
| `./tools/heavy pnpm exec eslint packages/render-fx apps/fx-lab --max-warnings 0` | Exit 0 |
| `./tools/heavy pnpm exec tsc -p apps/fx-lab --noEmit` | Exit 0 |
| `./tools/heavy pnpm exec tsc -p packages/render-fx/smoke --noEmit` | Exit 0 |
| `./tools/heavy pnpm test:e2e:fx` | Abschließender Build erfolgreich, 28 bestanden, 2 begründete Chromium-only-Skips, 31,7 s |
| `./tools/heavy pnpm smoke:fx -- --browsers=chromium,firefox,webkit` | Abschließend alle 18 Fälle bestanden, jeweils einschließlich Context-Restore |
| `./tools/heavy pnpm smoke:fx -- --cases=light --browsers=chromium,firefox,webkit` | Beide Kaskaden, Schattenkontrast, statischer Cache und Restore bestanden |
| `./tools/heavy pnpm smoke:fx -- --cases=particles --browsers=chromium,firefox,webkit` | GPU-Position ±2 Pixel und Restore bestanden |
| `./tools/heavy pnpm --filter @faf/fx-lab run shot` | Build und 21 geprüfte Szenenbilder ohne gemeldete GL-/Page-Fehler |

Der erste vollständige Smoke-Lauf bestand Core/Post/Shields/Trails, scheiterte aber an der Light-Testgeometrie: Alle Bodenproben lagen in Kaskade 1. Die Fixture verwendet nun explizit lambda=0,25, damit nahe und ferne Proben verschiedene Kaskaden prüfen. Produktions-CSM und die Kontrast-/Cache-Gates wurden nicht abgeschwächt. Der neue particles-Fall schließt den fehlenden echten GPU-Positionsnachweis des importierten P3-Standes.

Die letzte TypeScript-Fixture-Korrektur verwendet vollständige `parseLabParams`-Defaults und einen korrekt typisierten Extension-Mask. Der Haupttask prüft den Root-Tests-Typecheck erneut. Frozen install, der vollständige Smoke und die E2E-Wiederholung sind bestanden. Globale Typecheck/Lint/Tests gehören zur gemeinsamen Konsolidierung.

## Abschließende Messung und Galerieprüfung

`./tools/heavy pnpm bench:fx -- --wait=300 --update-docs` endete mit Exit 0: 42/42 Fälle, 14 je Engine, null Fehler, Gesamt-Draws max. 20 und FX-Draws max. 4. Der Bericht enthält den tatsächlichen Partikelmittelwert zusätzlich zu p50; Medium-Gefecht 12.275,4..12.278,2 im Mittel, Chromium 60,002 FPS. Die unveränderte vollständige Quittung liegt in `.git/consolidation/fx-bench-single-foreign-load-final.log`; Rohbericht `apps/fx-lab/results/fx-2026-09-29-single-foreign-load.json`.

Vor WebKit/battlelow/Lauf 1 erkannte der Runner den H3-Server bei 1,3 % CPU; die anderen 83 Fallgrenzen und die initiale Grenze waren leer. Daher wird dieser vollständige Lauf nicht als vollständig ruhig bezeichnet. Die vorhandenen CLI-Filter erlaubten die unveränderte Wiederholung ausschließlich der beiden WebKit-Low-Läufe: `./tools/heavy pnpm bench:fx -- --no-build --browsers=webkit --scenarios=battlelow --runs=2 --wait=300`. Die Wiederholung endete mit Exit 0, erkannte jedoch einen echten H3/MLX-pytest-Prozess bei 42,1/47,6 % CPU an zwei Grenzen. Separates Log `.git/consolidation/fx-bench-webkit-battlelow-retest.log`, Rohbericht `fx-2026-09-29-webkit-battlelow-retest.json`. Sie wurde nicht als ruhiger Ersatz in den vollständigen Bericht übernommen. Nachdem der zusätzliche H3/MLX-Testprozess beendet war, bestand eine zweite unveränderte Wiederholung mit leerer initialer Grenze und allen vier Fallgrenzen. Rohbericht `fx-2026-09-29-webkit-battlelow-retest-2.json`, Log `.git/consolidation/fx-bench-webkit-battlelow-retest-2.log`. Die explizit abgeleitete Datei `fx-2026-09-29-final-composed.json` enthält genau 40 unveränderte ruhige Originalfälle plus diese zwei ruhigen Ersatzfälle, mit beiden Rohquellen und Retestdatum in `provenance`. Dies ist keine zweite vollständige 42-Fall-Ausführung. Keine Benutzerprozesse wurden verändert; leere Lastmarker sind kein Beweis vollständig ruhiger GPU.

Chromium-Schild-GPU-p95 beträgt 2,8475..2,8851 ms (Ziel ≤ 1 ms), Lighting-CSM-p95 2,5270..2,5422 ms (Ziel ≤ 2,5 ms). Beide Ziele sind verfehlt, ohne belegte Ursache; Firefox/WebKit melden keine GPU-Timerwerte. Die Exit-Gates und Arbeitslast wurden nicht verändert.

`./tools/heavy pnpm --filter @faf/fx-lab run shot -- --no-build --scenes=gallery --freeze=2.766 --clean` endete mit Exit 0. Alle drei dauerhaften Galerie-PNGs ([Chromium](track-renderfx/gallery-2.766-chromium.png), [Firefox](track-renderfx/gallery-2.766-firefox.png), [WebKit](track-renderfx/gallery-2.766-webkit.png)) sind visuell geprüft: 21 freie Labels, kein überlagerndes HUD, gleiche Effektanordnung, keine sichtbaren Shader-Artefakte. Die Grenzen der Gesamtansicht stehen in P6. Log: `.git/consolidation/fx-gallery-clean-final.log`. Alle eigenen Prozesse sind beendet.

Dauerhafter lokaler Smoke-Bericht: `.git/consolidation/fx-artifacts/render-fx-smoke.json`, sechs Fälle × drei Engines, bytegleich zum ursprünglichen `test-results/render-fx-smoke.json`. Galerie-PNGs in `docs/status/track-renderfx/` sind bytegleiche Kopien aus `test-results/fx-shots/`; Originalpfade und SHA-256 stehen in `.git/consolidation/fx-final-receipt.json`. E2E-Artefakte: `test-results/fx-lab-e2e/`, Szenenbilder in den testbezogenen Unterordnern. Shot-Bilder: `test-results/fx-shots/`. Bench-Berichte: `apps/fx-lab/results/fx-YYYY-MM-DD[-quick].json`, Bench-Bilder: `test-results/fx-bench/<scenario>-<engine>-<run>.png`. Schema und Integrationsanleitung: [track-renderfx.md](track-renderfx.md).

Die vollständige Matrix enthält 420 s reine Warm-up-/Messzeit plus Build/Browser/Seiten/Screenshots. Werte sind lokal gemessen, Apple M5 Pro, kein Iris Xe. Medium-FPS und Partikelmittel sind berichtet; Shield-/CSM-GPU-Ziele verfehlt. Die finale Tabelle verwendet 40 ruhige Originalfälle und zwei ruhige unveränderte WebKit-Low-Wiederholungen; belastete Original-/Retestbelege bleiben getrennt erhalten. Fehlende GPU-Timer sind n/v. Root ergänzt außerdem DECISIONS und STATUS; diese Dateien gehören der Haupttask-Integration.
