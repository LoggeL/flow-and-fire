# Vorarbeits-Track HUD

Stand: 2026-09-29, kanonisches Projekt `flow-and-fire`, Branch `main`. Der Track stellt das Präsentationspaket `@faf/hud` und eine isolierte Galerie bereit. Die Daten sind lokale Demos; dieser Bericht bestätigt keine Anbindung an die laufende Spielsimulation und keinen erreichten PLAN-Meilenstein.

## Paket und Verträge

```text
packages/hud/src/
  model/      Signals und reine Ableitungen je HUD-/Menüsektion
  commands/   typisierte Commands, Noop- und Recording-Adapter
  data/       generiertes Roster, Icons, Bautabellen und Card-Logik
  hud/        top, selection, card, strip, minimap, root
  menus/      main, skirmish, loading, gamemenu, settings, score
  scheduler/  gebündelte Veröffentlichung von HudSnapshot
  demo/       deterministische Daten und lokaler Command-Adapter
  i18n/       typisierte DE-/EN-Namespaces und Pseudo-Locale
  ui/         Primitive, Format-/Signal-Bindungen, physische Tasten
apps/hud-gallery/
  src/stories/    196 registrierte Stories für 38 Komponenten
  e2e/           Layout-, Fehler- und Interaktionsprüfungen
  bench/         Browsermessung mit eigenem Preview-Lifecycle
```

`HudModel` enthält Economy, Matchstatus, Alerts, Tooltip, Auswahl, FactoryQueue, Card, Orders, Strip, Minimap und die sechs Menüsektionen. `HudCommands` ist die einzige Verbindung für Aktionen. Der Paketquellcode importiert kein Workspace-Paket. Die Galerie nutzt Recording-Commands und einen lokalen Demo-Adapter, damit z. B. Sprach-, Settings-, Queue- und Minimapaktionen sichtbar werden.

`HudSnapshot` ist ein Datenvertrag ohne Sim-Import. Der Scheduler bündelt mehrere Pushes in einen Frame. Ereignisversionen steuern Strukturänderungen; Eco und Fortschritt laufen mit 100 ms, HP/Queuewerte/Minimap mit 250 ms, Fog mit 500 ms und Timer/Zähler mit 1000 ms. Die Wanduhr begrenzt diese Raten auch bei ×3. Pause lässt Ereignisse durch. Skalare Gleichheit vermeidet überflüssige Writes. Wiederverwendete Typed Arrays brauchen einen neuen Wrapper, um neue Daten zu veröffentlichen.

DE ist die Quelle der übersetzten Keys. EN ist typisiert, Key- und Platzhalter-Parität werden getestet. UI-Texte und Unit-Texte sind getrennt; Unit-Texte entsprechen `unit.core.<id>.<field>`. Die Pseudo-Locale verlängert normale Texte. Roster-Kurznamen verwenden Akzente ohne Verlängerung, eine dokumentierte Platzbeschränkung aus p1.

Eine Story hat eine eindeutige ID, Komponente, Sollzustand, Viewport, Skalierung, Tags, Setup und Renderfunktion. Die strenge Abdeckung ist Standard; nur `FAF_HUD_REQUIRE_ALL=0` deaktiviert die Forderung nach allen Komponenten. Die Galerie erzeugt beim Build `dist/stories.json`. Der Browser-Harness wartet auf Fonts und zwei Frames und prüft Panelrechtecke, markierte Beschriftungen, Schriftgrößen, DOM-Budget und Laufzeitfehler.

## Komponenten und Übergaben

| Gruppe | Komponenten und Zustände | Feature-/Integrationsbezug |
|---|---|---|
| Top | ResourceBar/Meter mit Normal, Überlauf, drohendem/anteiligem Stall; FlowDetails offen/zu/pausiert; MatchStatus, Pause/Tempo/Lag/Context-Loss | C10, E1-E4, G12; MS4 und E13 MS10 |
| Auswahl | leer, einzelne Einheit, Mehrfachauswahl, Kachelfokus, Fabrik; OrderQueue und FactoryQueue | C9, B2/B3, U8/U9, K10; MS6/MS11/MS13 |
| Card/Strip | Bau, Produktion, Gebäude, Befehle, T1-T3, Locks, Queue/Progress; OrderBar, Filter, Idle, Gruppen | C8, B1, C14/C15, U5/B4/U10; MS4/MS6/MS8/MS13 |
| Alerts/Tooltips | zehn Alerttypen, Zusammenfassung/Alter, Unit-/Resource-/Order-Tooltip und Nachbarschaft | P8, C9, E11; MS9/MS10/MS14 |
| Minimap | Gelände, taktisch, Ressourcen an/aus, Fog, Ping, Kennzahlenersatz | C16, I1-I3; MS11 |
| Menüs | Hauptmenü, Einrichtung, fünf Ladephasen, Esc-Modal, fünf Settings-Tabs, vier Score-Tabs/Minimalform | A3, G12, P9/P12/P16, A13; MS9/MS14 |
| Primitive | Button, Tabs, Segmented, Switch, Check, Range, Select, Input, Bar, Badge, Key, Vet | gemeinsame Tokens und Accessibility |

Der vollständige Zustandskatalog steht in `apps/hud-gallery/src/required-states.ts`, das Feature-Mapping in `docs/design/ui.md` §11. ReplayBar, DevConsole, BudgetOverlay und Weltcursor gehören nicht zu diesem Track.

## Bedienung

```sh
pnpm --filter @faf/hud run gen --check
./tools/heavy pnpm exec vitest run packages/hud apps/hud-gallery/test --maxWorkers=4
./tools/heavy pnpm exec tsc -b packages/hud apps/hud-gallery
pnpm exec eslint packages/hud apps/hud-gallery
pnpm exec depcruise packages/hud/src apps/hud-gallery/src
./tools/heavy pnpm test:e2e:hud
./tools/heavy pnpm --filter @faf/hud run bench
FAF_PERF_GATE=1 ./tools/heavy pnpm --filter @faf/hud-gallery run bench:browser
pnpm --filter @faf/hud-gallery dev
```

Galerie: `http://127.0.0.1:5173/#/`, einzelne Stories `#/story/hud--0`, Matrix `#/matrix`. Parameter: `locale=de|en|pseudo`, `teams=house|relation|cvd`, `scale=1.25`, `motion=reduce`, `shot=1`. E2E nutzt Port 4483 oder `FAF_HUD_E2E_PORT`. Preview-/Devserver nach Gebrauch beenden. Die Browsermessung startet ihren Preview selbst und beendet Server und Browser in `finally`.

## Abnahme

Die nachfolgende Tabelle bildet die 15 Kriterien aus `docs/plans/TRACK-HUD.json` ab. Globale Repo-Prüfungen gehören zur laufenden Konsolidierung des Elternauftrags.

| Kriterium | Status | Nachweis |
|---|---|---|
| Paketgrenzen und Runtime-Deps | ✅ | Scoped dependency-cruiser ohne Verletzung; Runtime nur Preact, Signals und Fonts |
| Alle HUD-/Menü-Komponenten | ✅ | öffentliche Barrels, vollständige Galerie, reale Preact-Renderer |
| Strenge Galerie und drei Browser | ✅ | 196 Stories in Chromium, Firefox und WebKit ohne Laufzeitfehler; strenge Coverage grün |
| Layout/Font/Pseudo bei allen Größen | ✅ | vollständige Chromiumrunde einschließlich Pseudo-Locale; 720/1080/1440 und korrigierte Menüs erneut geprüft |
| Visuelle Prüfung | ✅ | 196 Chromiumbilder und je 35 Crossbrowserbilder betrachtet; 23 frisch erzeugte Mockup-Referenzen verglichen |
| Roster, Techraster, Locks, Generator | ✅ | vorhandene Daten-/Card-Logiktests; Generatorprüfung |
| Ressourcen und Flowzustände | ✅ | Galerie, pure Modellfunktionen und Command-Test |
| Alerts, 20/60 s, Aggregation | ✅ | Alert-Lifecycle-Test, zehn Definitionen, Storyzustände |
| Command-Übergabe und Modifikatoren | ✅ | Menü-/Queue-/Kachel-/Hotkeytests mit Recording-Commands |
| Tastaturmatrix und Accessibility | ✅ | 35 Grid-Matrixfälle, Fokus-/Modaltests, natives Keyboard-Verhalten |
| i18n und Live-Sprache | ✅ | Key-/Placeholder-/Scannertests, typisierte EN-Tabellen, Browserinteraktion |
| Tokens, Teamfarben, reduzierte Bewegung | ✅ | Tokens-Test, CVD-Stories, Motion-Bindung |
| Scheduler-Raten, Pause, Writes | ✅ | Fake-Wanduhr und Wrapperveröffentlichung getestet |
| Browser-Performance und Budgets | ✅ | zwei Volläufe bestehen FAF_PERF_GATE=1; 641 DOM-Knoten, keine Layout-Shifts |
| Typecheck/Lint/Tests/Doku | ⚠️ | scoped TSC/Lint/Depcruise/Generator und 273 Tests grün; Repo-weite Abnahme im Elternauftrag |

Die vollständige Browserrunde hat alle 196 Stories in drei Browsern und alle Chromium-Pseudozustände geprüft: 794 Tests grün, 394 browserbedingt übersprungen. Drei zusätzliche Minimap-Interaktionsfälle scheiterten an der Testannahme von 200 CSS-Pixeln; der Viewport inklusive Panelkopf liefert 186 Pixel. Die korrigierte Prüfung verlangt eine sichtbare Canvasfläche und belegt den Moduswechsel über Pixelwerte. Danach wurden sämtliche geänderten Menüs und alle Interaktionen erneut in drei Browsern geprüft: 121 grün, 56 browserbedingt übersprungen, kein Fehler. Nach der letzten Textkorrektur sind alle 27 Vitest-Dateien mit 273 Tests grün und der Gallery-Build erzeugt 196 Stories ohne Registryfehler. Protokolle liegen in `.git/consolidation/hud-e2e-final.log`, `hud-e2e-final-retest.log`, `hud-tests-final.log` und `hud-build-final.log`.

## Lokale Messwerte

Lokal gemessen (Apple M5 Pro), kein Referenz-Laptop. Die beiden akzeptierten Läufe liefen ohne parallele schwere Jobs. Die vorangegangene Diagnosemessung mit Startup-Layout-Shift ist kein Abnahmelauf. Pro Browserlauf wurden 600 Frames aufgenommen; die ersten 60 Frames wärmen den Wechsel auf `perf-500` auf. Timing, LoAF und Layout-Shifts verwenden denselben Warmup-Schnitt. Der Fall enthält 500 eigene Einheiten auf der Minimap, 60 ausgewählte Einheiten aus 24 Typen, offene Flow-Details und drei Alerts. Script umfasst Scheduler, synchrone Canvas-Effekte und die beiden Microtask-Stufen der Signals-/Preact-DOM-Aktualisierung; anschließend erzwingt ein Rechteck-Read Style/Layout.

| Browser | Script p50 / p95 (ms) | Script + Style/Layout p95 (ms) | Minimap p95 (ms) | DOM | Layout-Shifts | LoAF |
|---|---:|---:|---:|---:|---:|---|
| Chromium | 0,00 / 0,30 | 1,00 bis 1,10 | 0,20 | 641 | 0 | 0 |
| Firefox | 0,00 / 1,00 | 1,00 | 1,00 | 641 | 0 | API nicht unterstützt |
| WebKit | 0,00 / 1,00 | 3,00 | 0,00 bis 1,00 | 641 | 0 | API nicht unterstützt |

Firefox-/WebKit-Timer quantisieren hier auf Millisekunden; 0,00 bedeutet unter der messbaren Auflösung. Chromium besteht p95 Script ≤ 1,0 ms und Script + Style/Layout ≤ 1,5 ms. Das Minimap-Ziel ≤ 0,5 ms wird mit Chromium erreicht; die grobe Auflösung der beiden anderen Browser bestätigt dieses Ziel nicht. WebKit liegt beim Layout über dem Chromium-Ziel, wird gemäß Track-Vertrag gemessen und berichtet. DOM ≤ 700 und keine Layout-Shifts werden für alle Browser gegated.

Der Node-Benchmark misst den Scheduler ohne DOM: je 10.000 Samples nach 2.000 Warmup-Ticks, p50 0,001041 ms, p95 0,001750 bis 0,002041 ms, Maximum 0,097666 bis 0,177917 ms, 13.233 Signal-Writes. Diese Zahlen ersetzen keine Browsermessung. Rohdaten: `.git/consolidation/hud-bench-node-final-{1,2}.log` und `hud-bench-browser-final-{1,2}.json`.

## Visuelle Prüfung und Abweichungen

Die 196 Chromiumbilder und je 35 Firefox-/WebKitbilder wurden als beschriftete Kontaktbögen betrachtet und mit 23 frisch erzeugten Referenzbildern aus `shoot.mjs` verglichen. Tokens, Fasen, Zustandsunterschiede, Teamfarben, Bedienflächen und die Gesamtansichten wurden geprüft. Zusätzlich wurden betroffene HUD-Ansichten als Vollbild betrachtet. Behoben: Dock-Panels wuchsen über den festen Viewport hinaus; Pseudo-Labels und akzentuierte Glyphen waren bei 1,25-Skalierung abgeschnitten; isolierte Minimapstories hatten eine Canvasfläche ohne Höhe; eine Span-Regel setzte die Ressourcenraten auf Blocklayout.

Die Galerie hat eine neutrale Demo-Welt statt echter 3D-Szenen. Porträts nutzen strategische Icons. Kartenvorschauen sind prozedurale SVG-Skizzen. Menüs behalten die Tokens, Klassen und Hauptaufteilung der Vorlagen; dekorative Hintergründe und umfangreiche Scorestatistiken bleiben Daten-/Integrationsaufgaben. Lange Typ-/Einheitslisten scrollen innerhalb des Docks. Settings-Autodetect ist eine ausdrücklich gekennzeichnete Demo-Empfehlung; es wurde keine GPU-Empfehlungslogik qualifiziert.

Die Anordnung der Ladeansicht, die Score-Spaltenbreite und die Wortmarke wurden beim Vergleich an die Vorlagen angepasst. Die Demo-Embleme und Karten enthalten keine fotorealistischen Gelände-/3D-Details der Mockups. Die zusätzliche Galerie-Hüllfläche dient nur dem isolierten Komponentenvergleich.

Nicht bestätigt: pixelgenaue Gleichheit dekorativer Inhalte, Screenreader-Sprachausgabe mit nativer Assistenzsoftware und End-to-End-Anbindung an echte Simdaten. Automatische Layoutfreiheit und Scriptfreiheit sind eigene Nachweise.

## MS4/MS6/MS9/MS11/MS14

`@faf/hud` als eigenes Paket behalten: Die Grenze zwischen Simdaten und Präsentation ist explizit, die Galerie benötigt keine Spielruntime, und die Paketregel verhindert Rückimporte. Das ist eine begründete Abweichung vom in ui.md §10 beschriebenen Ort `packages/client/src/ui`.

MS4 füllt `HudSnapshot` aus den Frame-Sektionen und bindet Commands an die bestehende Eingabe-/Simroute. Die Locale-Dateien können bei P12 nach `content/locales` verschoben werden; die Keys bleiben stabil. `DEFAULT_ACTION_MAP` muss dieselbe Rasterauflösung und Priorität wie `resolveGridKey` verwenden. Fonts aus `@fontsource` sind im integrierten Assetfluss unter `/b/<hash>/fonts/` auszuliefern. MS6 übernimmt Produktions-/Auswahldaten, MS9 Menüs/Alerts, MS11 Minimap/Replays und MS14 vollständige Settings/Score-/KI-Daten. Demo-Commands gehören nicht in den Simadapter.

Fragmente: [p0](track-hud-p0-foundation.md), [p1](track-hud-p1-data-gallery.md), [p2](track-hud-p2-top.md), [p3](track-hud-p3-selection.md), [p4](track-hud-p4-card.md), [p5](track-hud-p5-root.md), [p6](track-hud-p6-menus.md).
