# Modellreview: sieben mobile Varkan-Einheiten

Dieser Kandidat überarbeitet Commander, T1-Ingenieur, T1-Späher, T1- und T2-Panzer, T1-Artillerie und T3-Läufer einzeln. Sieben GPT-6.1-Sol-Artists haben jeweils ein Modell bearbeitet; drei weitere Sol-Agents haben Geometrieverträge, Bilder und Laufzeit geprüft. Gebäude und andere Fraktionen gehören zur nächsten Entscheidung nach diesem Review.

[Vergleichsgalerie öffnen](review.html). Je Einheit stehen Vorher und Nachher mit identischer Kamera, Farbe, Beleuchtung und Grundfläche nebeneinander. Die Bilder sind Renderings der tatsächlichen GLB-Exporte. Das 3D-Modell lässt sich zusätzlich im vorhandenen Viewer drehen und animieren.

Ausgangsbasis: `b135d4d26d1801e60c7066dbdfb3df059ac8235d`. Modellcode, generierte Spiel-Assets und sieben aktualisierte Bauporträts: `1bd5577e87b879668b7a32890188544f003f9cfa`. Die Laufzeitbelege stammen aus dem Produktionsbuild `1bd5577e87b8`.

## Geometrie

| Einheit | Vorher LOD 0 / 1 / 2 | Jetzt LOD 0 / 1 / 2 | LOD-0-Verhältnis |
|---|---|---|---|
| Commander · Vogt | 350 / 218 / 96 | 2790 / 622 / 156 | 7,97× |
| T1-Ingenieur · Lehrling | 202 / 138 / 72 | 1198 / 250 / 72 | 5,93× |
| T1-Späher · Funke | 198 / 180 / 104 | 1098 / 180 / 104 | 5,55× |
| T1-Panzer · Punze | 348 / 218 / 98 | 1494 / 234 / 98 | 4,29× |
| T2-Panzer · Meißel | 350 / 218 / 98 | 1594 / 342 / 94 | 4,55× |
| T1-Artillerie · Kelle | 312 / 204 / 102 | 1400 / 360 / 118 | 4,49× |
| T3-Läufer · Fallhammer | 344 / 196 / 102 | 1976 / 306 / 130 | 5,74× |

- Commander · Vogt: Geschichtete Brust- und Schulterpanzerung, Hüft-, Knie- und Knöchellager, Hydraulik, Kühlerbank und eine offene Kanonenmündung.
- T1-Ingenieur · Lehrling: Laufräder mit profilierten Ketten, Drucktank, Kühler, Stellzylinder, Schläuche und ein ausgearbeiteter Konstruktionsarm.
- T1-Späher · Funke: Zehn sichtbare Laufräder, Kettenbänder, geschichtete Bugpanzerung, Glassensoren, Kühlung und Streben am Sensormast.
- T1-Panzer · Punze: Einzelne Kettenglieder, Laufräder und Umlenkrollen, schräge Panzerung, Lüftung, Auspuff, Turmlager und Rohrhülsen.
- T2-Panzer · Meißel: Detailliertes Fahrwerk und Aufhängung, verstärkte Panzerung, Turmwangen, Kühlerlamellen, Optik und offene Zwillingsmündungen.
- T1-Artillerie · Kelle: Fahrwerk, Waffenwiege, Drehzapfen und Hydraulikzylinder, verstärkte Mündung, Verschluss und Ladeschale.
- T3-Läufer · Fallhammer: Hüft-, Knie- und Knöchellager, einzelne Zehen, Hydraulikstreben, Kühlrippen, Waffenlager und offene Mündungen.

Die höhere Geometriezahl beschreibt den Umfang der Modellierung, keine gemessene ästhetische Qualität. Zusätzliche Formen liegen auf den vorhandenen beweglichen Parts. Namen, Reihenfolge, Parent-Beziehungen, Pivots, Animationstypen, Maßstab, Footprints und Icon-Zuordnung bleiben identisch. Die Modelle haben eigene Budgets; die globalen Standardbudgets bleiben erhalten. Für Fernansichten werden Details reduziert.

[Nahaufnahmen aller sieben Einheiten aus dem Spiel](game/live-render-receipt.json) sind in der Galerie aufklappbar. Auch diese Szene nutzt den tatsächlichen Produktionsrenderer und sechs ausdrücklich tainted Spawn-Kommandos. Der Commander kommt aus dem normalen Spielstart. Der Receipt hält Kamera, akzeptierte Unit-Frames, Rig-Pose, LOD-Instanzen, GLB-Requests und den stummen Audio-Sink fest.

Die bestehende Metalltextur und Fraktionspalette werden weiterverwendet. Diese Runde fügt echte Geometrie hinzu. Die Hashes der übrigen 49 Varkan-Modelle sind unverändert.

## Lokales Review

Die laufende Vergleichsseite: <http://127.0.0.1:5355/review.html>. 3D-Viewer: <http://127.0.0.1:5356/#/model/varkan/cmd_commander>. Spielkandidat: <http://127.0.0.1:5295/?menu=1>.

Nach einem Neustart aus dem Repository in getrennten Terminals:

```sh
python3 -m http.server 5355 --bind 127.0.0.1 --directory docs/design/model-detail-subset-2026-10-02
```

```sh
pnpm models
pnpm --filter @faf/model-viewer dev --host 127.0.0.1 --port 5356 --strictPort
```

```sh
pnpm assets
pnpm --filter @faf/game build
pnpm --filter @faf/game serve --port 5295 --coi
```

Im 3D-Viewer: Maus zum Drehen, „Parts-Animation“ für bewegliche Teile, LOD 0 / 1 / 2 und Wireframe für die Geometrie. Im Spiel: H zum Commander und Mausrad für den Zoom.

## Prüfung

- Alle 220 Modelle bauen ohne Geometrie- oder Budgetfehler.
- 541 relevante Vitest-Fälle bestehen, einschließlich der 29 neuen Subset-Verträge, GLB-Pipeline und Rig-Pose-Prüfungen.
- Projektweiter Typecheck, Lint, Asset-Pipeline, Porträtgenerierung und Produktionsbuild bestehen.
- Sechs native Browserfälle bestehen: ursprünglicher Commander bewegt sich per normalem Move; schwere Türme und Panzerrohr folgen tatsächlichen Kampfdaten. Jeweils Chromium, Firefox und WebKit, Build `1bd5577e87b8`.
- Der normale Commander-Gang ist untainted. Die Kampfszene nutzt ausdrücklich tainted, echte Spawn-Kommandos, native Attack-/Move-Eingaben und tatsächliche Simulation. Sie belegt keine normale T3-Produktion.
- Alle automatisierten Spielseiten erhalten vor Navigation einen stummen Audio-Sink. In allen sechs Fällen: null Lautsprecherverbindungen, null blockierte Verbindungsversuche.

[Geometrie- und Prüfreceipt](review-receipt.json). [Chromium-Gangnachweis](runtime/chromium/native-original-ACU-gait-receipt.json), [Waffenbewegungsnachweis](runtime/chromium/actual-unit-rigs.json). Entsprechende JSON-Belege liegen auch für Firefox und WebKit unter `runtime/`. Geh- und Ruhebilder liegen unter `runtime/chromium/`.

Dies ist ein Kandidat für das visuelle Review, keine Abnahme der übrigen Modelle und keine neue Performancefreigabe für große Armeen. Der öffentliche Build auf `faf.logge.top` bleibt während dieses Reviews unverändert.
