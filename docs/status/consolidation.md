# Konsolidierung: MS3 und sechs Vorarbeits-Tracks

Stand 2026-09-30. Der aktive Workspace ist `/Users/logge/Documents/Projects/flow-and-fire`,
Branch `main`. MS3, KI, Audio, Editor, HUD, Render-FX und Replay werden aus diesem Root entwickelt
und ausgeführt. Die Track-Pläne bleiben als historische Aufgabenbeschreibungen erhalten.

## Ergebnis und Integrationsgrenzen

Das Spiel startet auf Setons mit 150 Blueprint-Panzern pro Armee. Navigation, Auswahl,
Kontrollgruppen, Befehlsqueue, Gruppenpfade, Hindernis-Repath und Strategic Zoom sind umgesetzt.
Die vollständige Spiel-Matrix ist mit 168 bestandenen Fällen, sechs begründeten Skips und
keinen Fehlern abgeschlossen. Die fokussierten MS3-Belege stehen in [P4](ms3-p4-client.md), [P5](ms3-p5-bench.md) und [P6](ms3-p6-e2e.md).

| Track | Vorliegendes Ergebnis | Aktueller Beleg |
|---|---|---|
| MS3 | Nav/Blueprints/Sim/Render/Client/Game und neue Browser-Specs | 165 fokussierte Client-/Game-Tests und die vollständige Spielmatrix bestanden: 168 Fälle, sechs Skips, keine Fehler/Flaky-Retries; globale Checks abgeschlossen |
| KI | acht Manager, Perception/Budgets/Host, eigene Arena, Szenarien und Turnier-CLI | [Track-Bericht](track-ai.md); 221 Tests und neun strikte Kalibrierungen bestanden; 210 Turnier- und 120 Difficulty-Spiele abgeschlossen, bestehende Think-/Scheduler-Gates bestanden |
| Audio | Blatt-Paket, Loader/Mixer/Voices/Spatial/Alerts, reale Audio-Demo | [307 Unit-Tests, 21 stumme Browserfälle, 18 Browser-Messfälle](track-audioeng.md) bestanden; striktes 0,5-ms-Gate bei 200 Schüssen/s in Node und allen drei Browsern bestanden |
| Editor | Marker, Formgriffe, Properties, History, Symmetrie, Validierung, PFLD und beide Exporte | [292 Unit-Tests, 48 funktionale und 3 Messspec-Tests](track-editor.md) bestanden; globale Statik und Unit-Matrix ebenfalls bestanden |
| HUD | Präsentationspaket, HUD-/Menükomponenten und 196 Gallery-Stories | [273 Unit-Tests und Browserprüfung](track-hud.md) bestanden; zwei strikte lokale Bench-Gates bestanden; globale Statik und Unit-Matrix ebenfalls bestanden |
| Render-FX | Core, 21 Effekte, Partikel, Beams/Trails, Schilde, Scorch, Light/Post und Lab-Szenen | [210 Unit-Tests, 18 Smokes, 28 Browserfälle, 2 Skips](track-renderfx.md) bestanden; 42 ausgewertete Messfälle ohne Render-/Draw-Fehler (40 ruhige Originalfälle + zwei unveränderte ruhige Wiederholungen); Galerie in drei Engines geprüft, GPU-Zeitziele verfehlt |
| Replay | Container/Konverter/Player/OPFS, Verify/Diff-CLI, neun aktuelle Golden-Replays und Seek-/Desync-Tests | [Track-Bericht](track-replay.md); 180 Cross-Engine-Replaydurchläufe bitidentisch; 24 Formatfälle und zwei zusätzliche Property-Fälle bestanden; beide 30-Minuten-Prozessbenchmarks, aktuelle MS3-Keyframes und Größen-/Golden-CLIs bestanden |

Diese Zahlen gehören zu den jeweiligen fokussierten Läufen und werden nicht zu einer globalen
Testsumme addiert. Ein grüner Tool-Track belegt seine eigenständige Oberfläche und Verträge.
MS4/MS6 verbinden HUD-Daten und Commands, MS5 Audio und Kampf-FX, MS6/MS9/MS10 die KI mit der
echten Sim, MS7/MS13/MS14 die Render-Passes und MS11 Replay-Aufzeichnung/-Wiedergabe sowie
Minimap mit dem Spiel. Die Konsolidierung erklärt diese späteren Meilensteine nicht für erfüllt.

## Ein Ordner und erhaltene Originale

Die sieben ursprünglichen Arbeitskopien wurden unter dem ignorierten `.worktrees/` gesammelt:
`flow-and-fire-ms3`, `faf-ai`, `faf-audioeng`, `faf-editor`, `faf-hud`, `faf-renderfx` und `faf-replay`.
Daneben bleibt `flow-and-fire-maps` als zusätzliches Kartenarchiv erhalten. Die Archive bewahren
ihre nicht committeten Dateien. Aktive Entwicklung erfolgt
im Root; pnpm erfasst nur `packages/*`, `apps/*` und `tools/*`. `.worktrees/` ist kein zweiter
Installations- oder Startpfad.

Die lokale Auditdatei `.git/consolidation/sources.json` hält Herkunft, Head und SHA-256 je
Quelldatei fest. `.git/consolidation/preservation-check.json` enthält sieben geprüfte Archive und
`mismatches: []` (532/1271/1307/1326/1391/1318/1243 Dateien). Diese Aussage belegt die Erhaltung
der archivierten Originale; der aktive Root enthält zusätzlich die notwendigen Anpassungen zur
Integration. Es wurde kein Commit erstellt und nichts gepusht.

`.git/consolidation/maps-preserved.json` bestätigt die vier Root-Karten gegen `HEAD`:

| Karte | Bytes | SHA-256 |
|---|---:|---|
| Braidwater | 1.120.112 | `3b1fcc5b8471ab23875e0c1871a2c98805f62d98721fb80dfb719f0e97d778ea` |
| Hollow Ridge | 593.420 | `fd3b31d78689817d3d9cd81dfb330b707ed969f5e8f28c1f0718fc8c5f6591ec` |
| Setons | 2.698.440 | `110bd0d6478721a24db9bb4150c0c98868cd742df10408f1cc3b30897ddd823c` |
| Tessera | 726.732 | `f80e2eef622c51e69820ae97ff5c4ca4afd366c61aca177935710a94725c2865` |

Die `.git/consolidation/`-Dateien sind lokale Abschlussbelege und werden nicht als Produktdateien
versioniert. Die Track-Berichte unter `docs/status/` erhalten die lesbare Zusammenfassung.

## Starten und gezielt prüfen

Installation: Node ≥ 24, pnpm 11.10.0, `pnpm install --frozen-lockfile`. Browser einmalig mit
`pnpm exec playwright install chromium firefox webkit` installieren. Alle Befehle laufen im Root.

| Track | Start | Funktionale Prüfung | Messung |
|---|---|---|---|
| MS3 | `pnpm dev` | `./tools/heavy pnpm test:e2e` | `./tools/heavy pnpm bench:ms3` |
| KI | `./tools/heavy pnpm ai:arena` (CLI-Smoke) | `./tools/heavy pnpm ai:scenarios` | `./tools/heavy pnpm bench:ai` |
| Audio | `pnpm audio:demo` | `./tools/heavy pnpm test:e2e:audio` | `./tools/heavy pnpm bench:audio` |
| Editor | `pnpm editor` | `./tools/heavy pnpm test:e2e:editor` | `./tools/heavy pnpm bench:editor` |
| HUD | `pnpm hud:gallery` | `./tools/heavy pnpm test:e2e:hud` | `./tools/heavy pnpm bench:hud` |
| FX | `pnpm fx:lab` | `./tools/heavy pnpm smoke:fx`, dann `./tools/heavy pnpm test:e2e:fx` | `./tools/heavy pnpm bench:fx -- --wait=300 --update-docs` |
| Replay | `./tools/heavy pnpm replay:verify -- --goldens` | `./tools/heavy pnpm test:xengine` | `./tools/heavy pnpm bench:replay -- --update-docs` |

Replay-Diff: `pnpm replay:diff -- <a.rtsreplay> <b.rtsreplay>`.
KI-Turnier: `./tools/heavy pnpm ai:tournament -- --suite ms9 --workers 4 --md docs/status/track-ai-tournament.md`;
Difficulty-Bericht: `./tools/heavy pnpm ai:tournament -- --suite diff --workers 4`.
Ein Paket gezielt testen: `./tools/heavy pnpm exec vitest run packages/audio`.

`./tools/heavy` begrenzt die gleichzeitig laufenden schweren Jobs und prüft freien Speicher.
Messläufe brauchen zusätzlich ein ruhiges CPU-/GPU-Fenster. Vitest verwendet höchstens vier
Worker, Playwright einen. Server nach Gebrauch mit Strg+C beenden. Tool-Browserläufe gehören
zusätzlich zur Spiel-E2E; `ci:local` umfasst diese Tool-Suites nicht automatisch.

## Abgeschlossene Schritte im Goal

Die verbleibenden Implementierungen und lokalen Prüfungen sind abgeschlossen. Performance-
Messungen liefen einzeln, funktionale Prüfungen über `tools/heavy`. Globale Statik wurde während
fremder H3-Rechenlast vorgezogen; die Replay- und Paketmessungen folgten danach ohne erkannte schwere Fremdlast.

1. KI abgeschlossen: korrigierte Manager, 210 Turnier- und 120 Difficulty-Spiele, neun strikte
   Kalibrierungen und Think-/Scheduler-Gates geprüft. Opening-Deltas und Arena-Grenzen sind dokumentiert.
2. FX abgeschlossen: 40 ruhige Originalfälle und zwei unveränderte ruhige Wiederholungen ergeben
   die vollständige 42-Fall-Auswertung. Drei neue Galerie-Bilder sind geprüft; GPU-Ziele und fehlende Timer ausgewiesen.
3. Replay abgeschlossen: zwei 30-Minuten-Partien in frischen Prozessen, unabhängige Seek-Baselines,
   aktueller MS3-Keyframe-Quicklauf und Größen-/Golden-CLIs bestanden. 27 kanonische Dateien bytegleich.
4. Gemeinsamer Paket-Benchmark einschließlich zwölf Browser-Worker-Fällen, Nav/SPK2/MS3-Quickläufe
   und Render-Smoke bestanden; aktueller SPK3-Beleg bestätigt. Typecheck, Lint/Paketgrenzen,
   2.921 Unit-/Property-Tests, Gesamtbuild und Assetcheck bestanden. Spielmatrix: 168 bestanden, sechs Skips.
5. Ergebnisse und bekannte Grenzen zusammengeführt. Sieben Originalarchive, ihre HEADs und
   8.388 Dateien erhalten; alle vier Karten bytegleich bestätigt. Abschlussbelege sind gesichert.

Audio-Browsertests verbinden den aktiven Mixer mit einem `MediaStreamAudioDestinationNode`.
Sie geben keinen Sound an die Lautsprecher aus. Manuelles Audio bleibt erst nach dem
entsprechenden Klick in der Demo aktiv.

## Globale Abschlussprüfung

Alle vorgesehenen lokalen Prüfungen sind beendet. Die folgende Tabelle enthält die beobachteten
Endergebnisse. Nach der korrigierten Standard-Ausgabe der KI-Bench-CLI wurden Typecheck und Lint
noch einmal vollständig geprüft; die vier vorherigen Reportdateien blieben bytegleich. Spiel- und
Paketverhalten war von dieser Pfadkorrektur nicht betroffen. Alle 121 Spiel-Anhänge sind lokal gesichert.

| Prüfung | Reproduktion | Ergebnis |
|---|---|---|
| Lockfile | `pnpm install --frozen-lockfile` | bestanden |
| Typecheck | `./tools/heavy pnpm typecheck` | bestanden |
| Lint und Paketgrenzen | `./tools/heavy pnpm lint` | bestanden |
| Gemeinsamer Benchmark | `./tools/heavy pnpm bench` | bestanden, einschließlich 12 Browser-Worker-Fälle |
| Unit-/Property-Matrix | `./tools/heavy pnpm test` | 2.921 Tests in 269 Dateien bestanden, keine Fehler/Skips |
| Alle Browser-Apps bauen | `./tools/heavy pnpm build` | bestanden |
| Assetmanifest/Hashes | `pnpm --filter @faf/assets-pipeline run check` | bestanden |
| Spiel in drei Engines, SAB/Transfer | `FAF_E2E_PORT=4283 ./tools/heavy pnpm exec playwright test --workers=1` (nach Build) | 168 bestanden, sechs begründete Skips, keine Fehler/Flaky-Retries |
| Nav/SPK2/MS3-Quickläufe | `bench:nav`, `bench:spk2`, `bench:ms3`, jeweils `-- --quick` über `tools/heavy` | funktional bestanden; kalte PathService-Zeiten teils über 5 ms |
| SPK3-Quicklauf | `./tools/heavy pnpm bench:spk3 -- --quick` | aktueller Quellstand, `problems: []` |
| Basis-Renderer in drei Engines | `./tools/heavy pnpm --filter @faf/render smoke` | bestanden; je 10.000 Höhenproben ohne Abweichung, Atlas und Context-Restore bestätigt |
| Replay-Prozesse/Keyframes/Goldens/Größe | Replay-Befehle gemäß Track-Bericht | alle acht Befehle bestanden, 27 kanonische Artefakte bytegleich |
| Hashketten, Replays, Browser-Request-Burst | `FAF_PERF_GATE=1 ./tools/heavy pnpm test:xengine` | funktional bestanden; explizites Zeitgate verfehlt, Exit 1 |
| Vier Karten gegen HEAD | SHA-256 / `.git/consolidation/maps-preserved.json` | abschließend alle vier Karten bytegleich bestätigt |
| Archivquellen | `.git/consolidation/preservation-check.json` | abschließend sieben Archive mit 8.388 Dateien ohne Abweichung bestätigt |

Der Cross-Engine-Lauf bestätigte 180 bestehende Hashketten- und 180 Replay-Durchläufe:
neun Szenarien × vier Engines × kalt, drei Warm-ups und warm. Alle Ergebnisse sind bitidentisch.
Die Bursts erfüllen funktional 200 Ready in 5/9 Ticks bei 200 Requests und genau einer Anfrage
für die 50er-Gruppe. Das strikte PathService-p95-Gate von 5 ms scheitert in allen acht Kaltläufen
(6..8,435 ms) sowie in Firefox bei 1.024 WU warm (5,32 ms). Der ausgeführte Befehl ist deshalb
kein grüner Performance-Abnahmelauf. Originaler Fehlbericht und ausdrücklich funktionale
Auswertung sind in [Replay P6](track-replay/p6.md) verlinkt. End-Tick-, Hashraster- und Predictor-Prüfungen sind ebenfalls abgeschlossen; die volle
Unit-/Property-Matrix bestätigt den aktuellen Stand.

Die sechs Spiel-Skips sind vier abgelehnte Headless-PointerLock-Fälle in Chromium/WebKit
(je SAB/Transfer) und zwei HMR-Fälle außerhalb der dafür verwendeten Chromium-Engine. Firefox
bestand Pointer-Confinement über beide Transporte. Die Tests wurden im Abschlusslauf nicht verändert.

Der lokale maschinenlesbare Prüfstand liegt in `.git/consolidation/final-checks.json`; der
Arbeitsstand der zehn Abschlussaufgaben in `.git/consolidation/work-packages.json`.

## Messung und offene Grenzen

Gemessen wird lokal auf Apple M5 Pro. Playwright-WebKit belegt die WebKit-Engine im Testsetup,
keinen nativen Safari-Lauf. Iris Xe/UHD 620, Referenz-Laptop, Spieler-Playtest und Veröffentlichung
sind nicht abgenommen. Zeitgrenzen sind gemäß DECISIONS 16 von der funktionalen Prüfung getrennt:
`FAF_PERF_GATE`, `FAF_LATENCY_GATE`, `FAF_AUDIO_PERF_GATE` sowie die im HUD-Bericht beschriebenen
strikten Gates müssen für eine strikte Zeitabnahme explizit aktiviert werden. Berichte führen fehlende GPU-Timer und die Auflösung
der Browser-Uhr auf.

Die gemeldeten FX-GPU-Zeiten bleiben über den Zielen: Schilde p95 2,847 bis 2,885 ms bei
1 ms Ziel, Lighting-CSM 2,527 bis 2,542 ms bei 2,5 ms Ziel. Chromium hält im Medium-Gefecht
etwa 60 FPS; Firefox/WebKit liefern keine GPU-Timerwerte. Die Ursache der GPU-Zeitüberschreitungen
ist nicht belegt. Kalte PathService-Zeiten überschreiten weiterhin 5 ms.

Im abschließenden Spiel-Latenzlauf sind Marker und Befehlsanwendung innerhalb eines Frames
beziehungsweise Ticks bestätigt. In allen sechs Engine-/Transportfällen verfehlt seq-Bestätigung
p95 mit 101,565 bis 111,740 ms das 100-ms-Ziel. Der erste bewegte Pixel in der Startansicht
liegt mit 235,3 bis 255 ms über 150 ms; in der Nahansicht sind 117,445 bis 143,260 ms gemessen.
`FAF_LATENCY_GATE` und `FAF_PERF_GATE` waren in dieser Spielmatrix deaktiviert. Ihr funktionales
Bestehen belegt deshalb keine strikte Zeitabnahme. Die vollständigen Messwerte stehen in [MS3 P6](ms3-p6-e2e.md).

Opening-Abweichungen der KI bleiben dokumentiert. Der lokale Arena-Welt-Tick-Vergleich beträgt
1,639 ms mit KI gegenüber 1,803 ms ohne KI (−9,11 %) und liegt außerhalb des ±2-%-Vergleichsziels.
Die Arena ersetzt den späteren echten Welt-Tick-Vergleich nicht. Die FX-Szenen und Audio-Demo verwenden eigene Ereignisse; ihre
Latenztests ersetzen keine Messung am vollständigen Event→Client→Spiel-Pfad. Lokale Keyframes,
OPFS und Hashprüfungen ersetzen die noch fehlende Replay-Spieloberfläche nicht.

## Nachtrag 2026-10-07: Worktree-Nachlauf integriert, Archive entfernt

Nach dem Erhaltungscheck (30.09., 01:29) wurde in den Archiven bis 06:40 weitergearbeitet; dieser
Nachlauf war nie im Root. Die uncommitteten Stände wurden auf ihren Branches gesichert und alle
sieben Branches per Merge-Commit eingebracht (3-Wege-Merge, Basis = Snapshot aus `sources.json`):

| Branch | Ergebnis |
|---|---|
| `track-editor` | übernommen: Overlay-Export `editor.json`, PFLD-Kopf mit `algoVersion`, Inset-bewusstes Einpassen, E2E-Specs, Berichte P5–P7 |
| `track-audioeng` | übernommen: EventCodec, vollständige Gefechts-Demo, Mixer mit Makeup-Kompensation und Clip, Benchmarks, Berichte |
| `track-renderfx` | übernommen: vollständige fx-lab-Szenen, `fine`/`pass`-GPU-Segmente, Ring-Eviction, Smokes, E2E-Specs, Berichte |
| `track-replay` | Inhalt bleibt Root: Replay ist dort weiterentwickelt (GAME v3, Upgrades, Match-Statistik, Browser-Host) |
| `track-hud` | Inhalt bleibt Root: Hauptmenü und Skirmish-Setup des Spiels bauen auf der Root-Fassung auf |
| `track-ai` | Inhalt bleibt Root: die Spiel-KI nutzt Bündnisse, autoritative Platzierung und sim.bin-Blueprints |
| `ms3` | Inhalt bleibt Root: MS3 ist im Root abgeschlossen und bis MS6.2 weitergeführt |

Die Begründungen stehen in den jeweiligen Merge-Commits; die nicht übernommenen Stände bleiben
über die Branch-Historie erreichbar. `.worktrees/` wurde danach gelöscht.
