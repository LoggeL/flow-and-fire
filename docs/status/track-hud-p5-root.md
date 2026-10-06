# TRACK-HUD · hud-p5-root – Minimap, HudScheduler, Hud-Wurzel, TooltipLayer, Gesamtszenarien, Benchmark

> Stand 2026-09-30 · Worktree `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-hud` (der im Auftrag genannte Pfad `/Users/logge/Documents/Projects/faf-hud` existiert nicht; Branch `track-hud`) · Welle 2 (parallel zu hud-p6-menus) · Vertrag: [`docs/plans/TRACK-HUD-contract.md`](../plans/TRACK-HUD-contract.md) · Vorlage: `docs/design/ui.md` §4, §5.4, §5.12, §9, §12, Mockup `hud.html` + `assets/hud.{css,js}`

## Ergebnis

| Abnahmepunkt | Status | Nachweis |
|---|---|---|
| `tools/heavy pnpm exec vitest run packages/hud/test/root packages/hud/test/minimap packages/hud/test/scheduler` | ✅ | 8 Dateien, 79 Tests |
| Gesamtlauf `packages/hud` + `apps/hud-gallery` (Vitest, über das Gate) | ✅ | 52 Dateien, 701 Tests (inkl. i18n-Scanner, Galerie-Coverage) |
| `tsc -b packages/hud`, `tsc -p apps/hud-gallery`, `tsc -p tsconfig.tests.json` | ✅ | ohne Fehler (Tests/Bench/E2E eingeschlossen) |
| eslint + depcruise (`packages/hud`, `apps/hud-gallery`) | ✅ | „no dependency violations found“ (309 Module) |
| `FAF_HUD_E2E_PORT=4487 FAF_HUD_OUT_DIR=dist/root FAF_HUD_SHOT_DIR=test-results/hud-gallery-root tools/heavy pnpm test:e2e:hud` | ✅ | 234 Stories, 940 bestanden / 470 übersprungen (Pseudo-Pass nur Chromium, Screenshots Firefox/WebKit nur `xbrowser`), 6,3 min; alle Gesamtansichten ohne Layoutfehler bei 1920 × 1080, 2560 × 1440 und 1280 × 720 |
| `tools/heavy pnpm --filter @faf/hud bench` | ✅ | 2 Läufe, Werte unten |
| `… FAF_PERF_GATE=1 tools/heavy pnpm --filter @faf/hud-gallery run bench:browser` | ✅ | 2 Volläufe je Browser, alle Gates grün (Chromium p95 Script 0,46–0,50 ms, Script + Style/Layout 1,32–1,34 ms, 577 Knoten, 0 Panel-Shifts) |
| Gesamtansichten mit den Mockup-Screenshots verglichen | ✅ | `shoot.mjs` nach `/private/tmp/claude-501/faf-ui` (12 HUD-Ansichten, alle „Layout ok“), Befund unten |

## Gebaut

### Minimap (`src/hud/minimap/`, Barrel `index.ts`, CSS `minimap.css`)

| Datei | Inhalt |
|---|---|
| `Minimap.tsx` | Panel 216 × 220 @1,0 (`data-panel="minimap"`), Kopf „Karte“ mit drei Schaltern: Gelände/Taktisch (`setMinimapMode`, `is-on` bei Gelände wie im Mockup), Ressourcenpunkte (`toggleResources`, `aria-pressed`), Ganze Karte (`showWholeMap`). Vier Canvas-Ebenen im quadratischen Kartenfeld (Mockup streckte die Karte auf 206 × 186). `available = false` → Karten-Kennzahlen (Name, „512 × 512 WU“, Mex/Hydro frei/belegt, Hinweis auf Strategic Zoom, UI-E2); dort bleibt nur „Ganze Karte“. |
| `renderer.ts` | `MinimapRenderer` (imperativ): Terrain einmal in eine Offscreen-Canvas (`putImageData`), dann skaliert in die Terrain-Ebene; Fog-Bitmap (64 × 64) bei Fog-Änderung (2 Hz) neu und in die **eigene Fog-Ebene** skaliert; Dynamik-Ebene (Ressourcenrauten, Einheiten, Ghosts, Blips, Pings) 4 Hz; Overlay nur für den Kamera-Trapez, mehrere Kameraänderungen je Frame → eine Zeichnung (rAF). Teamfarben aus `--team-self/--team-enemy` usw. per `getComputedStyle`, einmal je Teamfarben-Modus (im nächsten Frame, nachdem `data-teams` gesetzt ist). Backing-Store = CSS-Größe × `devicePixelRatio`, gemessen per `ResizeObserver` (nie im Update-Pfad). `performance.measure('hud-minimap')` je Dynamik-Zeichnung plus `stats`. |
| `draw.ts` | Reine Zeichenfunktionen gegen `Ctx2D`/`PixelCtx2D` (Teilmenge von `CanvasRenderingContext2D`): `drawUnits` (eigene 4 px / Gebäude 6 px in Teamfarbe mit 1-px-Graphitrand, Feinde gefüllt, Ghosts hohl, Blips graue Ringe; Quadrate als **ein Pfad je Farbe** = 3 Fills unabhängig von der Anzahl, Ghosts/Blips als vorgerenderte Sprites), `drawSpots` (frei gefüllt, belegt hohl), `drawPings` (zwei Glutringe, verblassen über 8 s), `drawCameraLayer`, `drawFogLayer`, `buildTerrainPixels` (Gelände = Kopie, Taktisch = Wasser + drei Landbänder), `buildFogPixels` (nie gesehen dunkel, erkundet gedimmt, sichtbar klar), `minimapToWorld`/`worldToMinimap`, `readMinimapPalette`. Nie `getImageData`, nie Text. |

Interaktion: Linksklick/-ziehen → `setCamera(x, z)` in Weltkoordinaten (Pointer-Capture, Ziehen über den Rand klemmt auf die Karte), Rechtsklick → `minimapOrder(x, z, shift)`, Kontextmenü unterdrückt, Mausrad `preventDefault` + `stopPropagation` (kein Welt-Zoom über der Minimap). Das Rechteck der Karte wird im Pointer-Handler gemessen, nicht im Update-Pfad.

### Scheduler (`src/scheduler/`, `src/model/snapshot.ts`)

- **`HudSnapshot`**: plain data aller Sektionen (eco, match, alerts, selection, factory, card, orders, strip, minimap) wie aus den Frame-Sektionen Eco/Watch/Intents (PLAN §3.6), je Ereignis-Sektion ein `version`-Zähler. Nicht Teil des Snapshots sind rein lokale UI-Zustände (Flow-Details offen, Tooltip, Tech-Tab, Platzieren, Minimap-Modus/-Ressourcen): die schreibt das Spiel direkt beim Eingabeereignis. `captureSnapshot(model)` liest ein Modell in einen Snapshot (Szenarien, Tests), `SnapshotTarget` hält die Abhängigkeit strukturell (kein Import-Zyklus).
- **`HudScheduler(model, { now, requestFrame, measure, onFlush, rates })`**: `push(snapshot, simTick, simSpeed, paused)` behält nur den neuesten Snapshot, `flush()` läuft in **einem** rAF und **einem** `batch()`, `performance.mark/measure('hud-flush')` je Flush (Marken/Measures werden sofort geräumt, Observer bekommen sie trotzdem). Schreibt nur bei geändertem Wert: Zahlen per Wert, Daten strukturell (`sameData`), Wrapper um in-place gefüllte Typed Arrays (Minimap-Einheiten/Fog, Mehrfachauswahl-Werte, Alerts) per Referenz.
- **Raten** (`src/scheduler/rates.ts`, Wandzeit, ausgewertet nur bei neuem Tick, nie in Pause; Gate mit Periodenraster, 20 % Toleranz gegen Tick-Jitter, Neusynchronisierung nach Stillstand statt Nachholschub):

| Klasse | Rate | Signale |
|---|---|---|
| `eco` | 10 Hz | Speicher, Kapazität, Einkommen, Bedarf, bedient, Flow je Ressource; Fabrik-Fortschritt + Restzeit; Card-Fortschritt |
| `hot` | 4 Hz | Einzeleinheit (HP, Vet, Befehlskette, Abstich), Mehrfachauswahl-Werte, Fabrik-Detail (HP), Befehls-/Toggle-Zustände, Selbstzerstörungs-Countdown, Einkommen nach Quelle/Speicher nach Gebäude (Tooltip), Flow-Details-Verbraucher (nur wenn offen) |
| `map` | 4 Hz, **versetzt** zu `hot` | Minimap-Einheiten/Blips/Ghosts, Pings (ein fälliger `map`-Pass, der auf einen `hot`-Pass trifft, wartet genau einen Tick) |
| `fog` | 2 Hz, mit einem `map`-Pass | Minimap-Fog |
| `slow` | 1 Hz | Timer (und damit Alert-Alter), Einheiten, Cap, Punkte, Idle-Zähler, Gruppen-Zahlen |
| Ereignis | sofort (nächster Flush, auch in Pause) | Versionswechsel: Auswahlstruktur (+ ihre heißen Werte), Fabrik/Queue, Card-Eingaben + Queue-Badges, Befehle, Gruppen, Alerts, Karte/Terrain/Spots; immer: Pause/Tempo (aus `push`), Sim-Lag, Context-Loss, Replay, Kamera (bei Änderung); Flow-Details-Verbraucher sofort beim Öffnen |

Der erste Snapshot wird vollständig geschrieben, auch wenn er pausiert ankommt (Partie im Pausezustand geladen). Messung (Fake-Uhr, `test/scheduler`): ×1 und ×3 je Sekunde eco 10 ± 1, hot/map 4 ± 1, fog 2 ± 1, slow 1 ± 1; bei ×3 bleibt eco bei 10 Hz (300 Ticks → 100 eco-Pässe); ×0,5 verhungert `map` nicht; Pause → 0 Nicht-Ereignis-Schreibvorgänge; inhaltsgleiche Snapshots → 0 Signal-Benachrichtigungen.

### Hud-Wurzel (`src/hud/root/`, CSS `root.css`)

- **`Hud`**: Wurzel `div.hud-root[data-hud-root]` (`role="region"`, `aria-label` „Spiel-HUD“, z 20, `pointer-events: none`, Panels `auto` über `:where(.hud-root) > *` mit Spezifität 0, damit die Klick-Durchlässigkeit der Leiste erhalten bleibt, `contain: strict`). Inhalt nach ui.md §4.2: `ResourceBar` + `FlowDetails` oben links, `PauseBanner` oben Mitte, `MatchStatus` + `AlertFeed` (z 30) oben rechts, `Strip` (Filter über der Minimap | Gruppen fest bei x = 232 @1,0 | Befehlsleiste rechtsbündig), Dock `footer.dock` (Minimap 216 | Auswahl `minmax(0, 1fr)` | Command Card 324, Lücken klick-durchlässig), `TooltipLayer` (z 40). Optionen: `hotkeys` (Galerie), `scaleSetting` (`'auto'` → `model.scale` aus der eigenen Größe per `ResizeObserver`), `minimap` (Kontext-Fabriken/Renderer-Hook), `tooltipDelayMs`. Delegierte `data-tip`-Tooltips (ein Listener-Paar an der Wurzel): Hover setzt `resource:mass|energy`/`order:<id>`/`unit:<typ>` mit Rechteck-Anker (im Pointer-Handler gemessen), Fokus sofort, Verlassen schließt nur das eigene Ziel.
- **`computeUiScale(width, height)`** (`scale.ts`): round₀,₀₅((h/1080)^0,78), 0,8–1,5; unter 1280 × 720 oder bei scale · 1080 > h → 0,8. `resolveUiScale('auto' | manuell, w, h)`.
- **`computeHudLayout(w, h, scale)`** (`layout.ts`): Panel-Rechtecke aus den Tokens (Test gegen `tokens.css`), `placeTooltip` (Punkt/Rechteck, Kippen an Rändern, Klemmen an den Rand).
- **`TooltipLayer`**: **ein** wiederverwendeter Knoten (`div.tipbox`, `role="tooltip"`), 350 ms Verzögerung bei Hover, Tastaturfokus und Wechsel zwischen Zielen bei offenem Tooltip sofort, Verschwinden sofort. Anker `card` per CSS (rechtsbündig, 8 px über der Leiste über der Card, wie `hud.js showTip`), Anker Punkt/Rechteck per `transform`, Tooltip- und Wurzelgröße **einmal beim Öffnen** gemessen. Inhalt nach `target.kind`: `UnitTooltip`, `ResourceTooltip` (p2), `OrderTooltip` (p4); Aktualisierung ≤ 4 Hz (Ressourcen-Tooltip tastet mit 4 Hz ab, Einheit/Befehl hängen an 4-Hz-/Ereignis-Signalen). `data-panel="tooltip"` nur wenn sichtbar (Layoutprüfung wie `shoot.mjs`).

### Demo (`src/demo/minimap.ts`, `src/demo/scenarios.ts`, `src/demo/index.ts`)

- `demo/minimap.ts`: prozedurales Terrain (seeded Value-Noise, an der Diagonale gespiegelt wie eine faire 1v1-Karte, Wasser/Ufer/Tiefland/Hochland, Hillshade, 128 × 128, gecacht), 22 gespiegelte Mass-Spots + 2 Hydro (Basisnähe = belegt), `createMinimapDemo({ own, enemy })` mit Einheiten in Gruppen, Gebäuden an den Basen, langsamer Bewegung, Fog aus eigener Sicht (erkundet bleibt erkundet) und daraus abgeleitet Feinde als sichtbar/Blip bzw. Gebäude als sichtbar/Ghost, Pings, Kamera-Trapez (`cameraTrapezoid`).
- `demo/scenarios.ts`: `createHudScenario(id)` für `vogt`, `armee`, `fabrik-stall`, `fabrik`, `pause-cvd`, `dichtester-fall`, `kompakt` (Tempo ×2) und `perf-500` (500 eigene + 300 feindliche Einheiten = 800 Minimap-Punkte, Mehrfachauswahl 60 Einheiten/24 Typen, Flow-Details offen, 5 Alerts = 3 sichtbar + 2 ältere, Unit-Cap 1.000), zusammengesetzt aus den Presets von p2/p3/p4 auf einem Hilfsmodell und per `captureSnapshot` übernommen. `createSnapshotGenerator(scenario, seed)` erzeugt je Sim-Tick plausibel veränderte Snapshots (Eco-Jitter mit driftendem Bedarf, Stall bleibt Stall; HP in u8-Stufen wie `UnitRecord`, 5 % der Auswahl je Tick im Kampf; Befehls-/Fabrikfortschritt, fertige Einheiten → Queue-Ereignis + Badges; alle 15 s ein Alert mit Ping, Ablauf nach 60 s; Einheitenbewegung jeden Tick, Fog alle 5 Ticks, Kamera schwenkt langsam). `startHudDemo(model, scenario)` (Scheduler + 10-Hz-Timer, Pause = nur Ereignisse), `applyHudScenario`, `applyHudScenarioUi`.
- `demo/index.ts`: Barrel aller Demo-Module (core, top, selection, card, menus, minimap, scenarios).

### Galerie

- `stories/hud.stories.tsx`: Gesamtansichten mit Scheduler und laufendem Generator: 1080 `vogt` (xbrowser), `armee`, `fabrik-stall` (xbrowser), `pause-cvd`, `dichtester Fall`; 2560 × 1440 @1,25 `1440` (Vogt) und `1440 Fabrik`; @1,0 `1440-kompakt` (Armee, ×2); 1280 × 720 @0,8 (`computeUiScale`) `720` (Fabrik mit Stall + Tooltip) und `720 Armee` (xbrowser); dazu `hud--perf-500` (Tag `perf`).
- `stories/minimap.stories.tsx`: Gelände (xbrowser), Taktisch, Ressourcen an/aus, Ping, Fog-Stufen, Karten-Kennzahlen – interaktiv (Modus, Spots, Kamera per Klick/Ziehen).
- `src/perf/`: `params.ts` (Route-Alias `#/perf?units=500&ticks=600&speed=1` → `#/story/hud--perf-500?…&perf=1&shot=1`, per `history.replaceState` vor dem Router, weil `src/app` p1 gehört), `harness.ts` (`runHudPerf`), `PerfHud.tsx`, `stats.ts`. Ergebnis in `window.__HUD_PERF__`.
- `e2e/perf.spec.ts` + `playwright.config.ts`: mit `FAF_HUD_PERF=1` läuft **nur** `perf.spec.ts` (`testMatch`), sonst wird sie ignoriert (`testIgnore`); Timeout 300 s. Die Spec setzt per `page.route` COOP/COEP-Header (Cross-Origin-Isolation, sonst messen Firefox/WebKit nur in 1-ms-Schritten), schreibt `apps/hud-gallery/results/hud-perf-<browser>.json`. `bench:browser` in `apps/hud-gallery/package.json`, `bench` in `packages/hud/package.json`; `packages/hud/bench/.gitignore` hält `results/` aus Git.

## Benchmark

### Messaufbau

- **Node** (`packages/hud/bench/scheduler.bench.ts`, tsx, ohne DOM): perf-500, je Signal ein Effekt (wie gemountete Komponenten), 100 Aufwärm-Ticks + 3.000 Ticks, Zeit von `push` + `flush` je Tick; Läufe ×1, ×3, pausiert; dazu die Dynamik-Ebene der Minimap gegen einen zählenden Kontext (nur JS-Anteil). Tabelle + `bench/results/scheduler.json`.
- **Browser** (`#/perf`): volle `<Hud>` 1920 × 1080 mit perf-500, echter `HudScheduler` auf simulierter 10-Hz-Uhr, ein Tick je Animation Frame, 60 Aufwärm- + 600 Mess-Ticks. Je Flush: `flush` = `performance.measure('hud-flush')`; `script` = Flush + die von ihm ausgelösten Preact-Re-Renders (die Render-Queue wird im Flush-Hook synchron geleert); `script+layout` = zusätzlich ein am Flush-Ende erzwungenes `getBoundingClientRect` (nur im Messmodus); `minimap` = `performance.measure('hud-minimap')`; Long Animation Frames (Chromium, mit `styleAndLayoutStart` und Skriptanteil); Layout-Shifts (Chromium) mit Quellen, getrennt in Panel-Verschiebungen (`[data-panel]` bzw. Container davon – das harte Gate), Inhalts-Verschiebungen innerhalb fester Panels und Umordnung des Alert-Feeds; DOM-Knoten unter `[data-hud-root]` (`<svg>` = 2 wie `shoot.mjs`); Aufschlüsselung `script+layout` nach Ratenklassen je Flush.
- **Gates** (`perf.spec.ts`): immer Knoten ≤ 700 und 0 Panel-Shifts; nur mit `FAF_PERF_GATE=1` in Chromium p95 `script` ≤ 1,0 ms und p95 `script+layout` ≤ 1,5 ms; Minimap ≤ 0,5 ms nur berichtet.

### Messwerte (lokal gemessen, Apple M5 Pro, kein Referenz-Laptop; Messung ≠ Gate, DECISIONS 5/16)

**Node** (2 Läufe, 3.000 Ticks, perf-500; µs je Tick):

| Lauf | p50 | p95 | p99 | Schreibvorgänge/Tick | Pässe eco/hot/map/fog/slow/Ereignis |
|---|---|---|---|---|---|
| ×1 | 2,2 | 5,4–5,7 | 11,5–14,1 | 8,7 | 3.101/1.241/1.240/620/311/789 |
| ×3 | 1,2 | 2,8–3,7 | 5,4–9,8 | 3,2 | 1.034/414/414/207/104/789 |
| pausiert | 0,7 | 0,8 | 1,1 | 0,0 | 1/1/1/1/1/1 |
| Minimap-Dynamik (800 Punkte, nur JS) | 5,9–6,0 | 9,7–9,9 | 10,7–11,7 | – | 1.554 Kontextaufrufe je Zeichnung |

**Browser** (2 Volläufe je Browser, `FAF_PERF_GATE=1`, isoliert; ms je Flush, Bereich über beide Läufe):

| Browser | flush p50 / p95 | script p50 / p95 / p99 | script + Style/Layout p50 / p95 / p99 | Minimap p50 / p95 | Knoten | Layout-Shifts |
|---|---|---|---|---|---|---|
| Chromium | 0,23 / 0,42–0,43 | 0,24 / 0,46–0,50 / 0,71–0,80 | 0,46–0,47 / **1,32–1,34** / 1,81–1,94 | 0,12 / 0,19–0,20 | 577 | 0 Panel, 66 Inhalt, 4 Alert-Feed (Summe 0,0015) |
| Firefox | 0,30–0,32 / 1,30–1,34 | 0,34 / 1,40–1,44 / 1,88–2,00 | 1,08 / 1,86–2,06 / 2,48–2,84 | 0,80–0,82 / 1,12–1,14 | 577 | – (API fehlt) |
| WebKit¹ | Mittel 0,30–0,33 | Mittel 0,33–0,36 | Mittel 1,15–1,23 (p95 3) | Mittel 0,12–0,17 | 577 | – (API fehlt) |

¹ WebKit liefert `performance.now()` auch mit Cross-Origin-Isolation nur in 1-ms-Schritten; Perzentile sind dort 0/1/2/3, aussagekräftig ist nur der Mittelwert.

Chromium-Aufschlüsselung `script+layout` nach Flush-Art (letzter Diagnoselauf): nur eco p50 0,2 / p95 0,4; eco + hot (Mehrfachauswahl) 0,8–1,0 / 1,4–1,5; eco + map (+ fog) 0,3 / 0,5–0,7; eco + slow 0,3 / 0,6–0,9. Long Animation Frames (≥ 50 ms): 36–56 je Lauf, max. 88–121 ms, aber **ohne HUD-Skript** (Skriptanteil 0 ms) und mit Style/Layout ≤ 1,8 ms – die Frames warten vor dem Rendern (headless unter Last, Load 4–8 durch parallele Agenten), daher kein Gate.

Knoten der Gesamtansichten (Galerie-Layoutprüfung): vogt 489, armee 315, fabrik-stall 580, pause-cvd 320, dichtester Fall 579, 1440 489/495, 1440-kompakt 317, 720 580/315, perf-500 572–577 – alle unter 700.

### Optimierungen bis zum Ziel (Chromium, p95 script + Style/Layout)

| Stand | p95 | Hebel |
|---|---|---|
| erster Lauf | 3,0–3,4 ms | – (alle 60 HP-Werte jeden Tick neu, Verbraucher mit Jitter → Flow-Details renderten 4 Hz neu und schalteten „Engpass“ zufällig) |
| realistischer Generator | 1,4 ms | HP in u8-Stufen nur für Einheiten im Kampf, Verbraucher erhalten exakt Flow × Bedarf → keine Schreibvorgänge ohne Änderung |
| `map` versetzt zu `hot` | 1,3 ms | Canvas-Zeichnung und DOM-Arbeit der Auswahl nie im selben Frame; Fog nur mit `map`; Minimap zeichnet nicht mehr zusätzlich zum 1-Hz-Timer (421 → 240 Zeichnungen je 600 Ticks) |
| 5 % Kampfanteil, Fog-Ebene, Sprites | 1,1–1,34 ms | 5 % = ≈ 3 Treffer je Tick auf 60 Einheiten (schwere Schlacht); Fog auf eigener Ebene (2 Hz statt bei jeder 4-Hz-Zeichnung neu geblittet), Blips/Ghosts als Sprites (Firefox: 150 Bögen 0,34 ms → Stempel 0,08 ms) |

Verbleibender Hauptposten ist die Style-Neuberechnung der Mehrfachauswahl (p3): `--v` auf Kachel und Einzeleinheit wird von allen Nachkommen geerbt (inkl. `<use>`-Schattenbaum des Icons). Mikromessung (15 Kacheln, Chromium): `--v` auf der Kachel 0,24 ms, `opacity` auf der Kachel 0,10 ms, `--v` auf dem Icon-Blatt 0,085 ms. Hinweis an p3/p7 siehe unten.

## Layout (gemessen in der Galerie, Chromium)

| Ansicht | Skalierung | Ressourcen | Status / Alerts | Filter | Gruppen | Minimap | Auswahl | Card |
|---|---|---|---|---|---|---|---|---|
| 1920 × 1080 | 1,0 | 8/8, 2 × 312 × 60 | rechts 8, 40 hoch / ab y = 56 | x 8, 216 | **x 232**, 538 | x 8, y 852, 216 × 220 | x 228, 1.356 | x 1.588, 324 |
| 2560 × 1440 | 1,25 | 2 × 390 × 75 | 50 hoch | x 10, 270 | x 290, 668 | 270 × 275 | 1.855 breit | 405 |
| 2560 × 1440 kompakt | 1,0 | wie 1080 | | | x 232 | | 1.996 breit | |
| 1280 × 720 | 0,8 | 2 × 250 × 48 | 32 hoch | x 6,4, 173 | x 185,6, 434 | 173 × 176 | 829 breit | 259 |

Tooltip (Card-Anker) endet bei 1080p auf y = 800 (8 px über der Leiste), rechtsbündig mit der Card. Welt frei: 79 % der Höhe bei 1080p (1,0), 80 % bei 1440p (1,25), 84 % kompakt.

## Visuelle Prüfung

Verglichen mit `shoot.mjs`-Aufnahmen (`/private/tmp/claude-501/faf-ui/hud-*.png`): Anordnung, Größen und Zustände stimmen mit `hud-1080-vogt/armee/fabrik-stall/pause-cvd/fabrik-alles`, `hud-1440-*` und `hud-720-*` überein (Gruppen x = 232, Befehlsleiste rechtsbündig, Tooltip über der Card, Flow-Details unter der Leiste, Alerts unter dem Status). Unterschiede: Die Welt ist in der Galerie ein Platzhalter-Verlauf (keine Weltobjekte); die Minimap ist quadratisch statt gestreckt und zeigt mehr Einheiten (64 statt ≈ 30 eigene); Pings und Blips sind wie im Mockup klein (6/10-px-Ringe, 3-px-Blips); der Stall-Alert steht in `fabrik-stall` wie im Mockup oben; die Queue-Badges zählen die laufende Einheit mit (Punze 6 statt 5, siehe Abweichungen). Firefox/WebKit (`xbrowser`) rendern `hud--vogt`, `hud--fabrik-stall`, `hud--720-armee` und `minimap--gelaende` gleich.

## Abweichungen und Entscheidungen

1. **Fog auf eigener Canvas-Ebene** (vier statt drei sichtbare Ebenen): ui.md §9.2 („Fog/Einheiten auf eigene Ebenen“) statt „Fog in der Dynamik-Canvas“ aus dem Auftrag – spart das Neu-Blitten bei jeder 4-Hz-Zeichnung. Die Dynamik-Ebene enthält Spots, Einheiten, Ghosts, Blips und Pings.
2. **Zusätzliche Ratenklasse `map`** (4 Hz, versetzt zu `hot`): beide Klassen bleiben bei 4 Hz (Test ±1/s), landen aber nie im selben Flush; Fog folgt einem `map`-Pass. Der erste Flush schreibt alles.
3. **`computeUiScale` wörtlich nach §4.1**: Wegen des Exponenten 0,78 ist scale · 1080 für jede Höhe unter 1080 größer als die Höhe → dort immer 0,8 (z. B. 1920 × 1050 → 0,8, 1366 × 768 → 0,8). Das ist die dokumentierte Regel; eine Stufung 0,85/0,9 unter 1080p bräuchte eine ui.md-Änderung.
4. **Control Groups bei x = 232** (ui.md §4.2, R1): 4 px Einzug über der Auswahl-Spalte per `.hud-root .groups { margin-left: var(--sp-1) }` in `root.css` (die Strip-CSS von p4 setzte sie auf 228).
5. **Zwei CSS-Anpassungen in `root.css` für 1280 × 720 @0,8** (10-px-Untergrenze, R6): `.ff-tip__foot` nutzte `0,6875rem` (8,8 px) statt `--fs-micro`; das längste 10-Zeichen-Kurzlabel „Reparieren“ ist bei 0,8 1,7 px breiter als die 46-px-Zelle – bei `data-scale="0.8"` darf das Label die volle Zellbreite nutzen (−0,01 em Sperrung). Beides greift nur im HUD bzw. bei 0,8; die Komponenten-CSS von p0/p4 bleibt unverändert.
6. **Route `#/perf`** als Alias auf die Story `hud--perf-500` (Hash-Umschreibung aus `src/perf/params.ts`, beim Import der Story-Datei, vor dem Router), weil `src/app` (Router) p1 gehört. `perf=1` schaltet in den Messmodus, ohne `perf=1` läuft die Story wie die anderen.
7. **Layout-Shift-Gate auf Panels**: Die Layout-Instability-API meldet bei rechtsbündigen Werten mit wechselnder Zeichenzahl (Netto „+7,4“ → „+11,9“, Badge „Leer in 7 s“ → „10 s“, p2) Textknoten-/Element-Verschiebungen innerhalb fester Panels und beim Einfügen eines Alerts die Umordnung des Feeds (neueste oben, Ereignis). Gegatet wird „kein HUD-Panel verschiebt sich“ (ui.md §4.4); Inhalts- und Alert-Feed-Verschiebungen werden gezählt und mit Quellen berichtet (Summe 0,0015 über 60 s).
8. **Queue-Badges zählen die laufende Einheit mit** (`queueCountsOf`: Punze 1 in Produktion + 5 gehängt = 6), wie FA; das Mockup zeigte 5.
9. **Generator-Modell**: HP in u8-Stufen (Frame `UnitRecord.hp`), 5 % der Auswahl je Tick im Kampf (≈ 3 Treffer/Tick auf 60 Einheiten), Verbraucher erhalten exakt Flow × Bedarf. Der erste Entwurf (alle HP jeden Tick, Jitter auf Verbrauchern) erzeugte unrealistische Dauerschreibvorgänge.
10. **Snapshot-Umfang**: Lokale UI-Zustände (Flow-Details offen, Tooltip, Tab, Platzieren, Minimap-Modus/Ressourcen) sind nicht im Snapshot; Kamera optional (`minimap.camera`), sonst schreibt das Spiel `model.minimap.camera` direkt.
11. **Perf-Messung mit Cross-Origin-Isolation**: `perf.spec.ts` setzt COOP/COEP per `page.route` (Vite-Config gehört p1). Ohne Isolation klemmen Firefox und WebKit auf 1 ms; WebKit bleibt auch isoliert bei 1 ms.
12. **Tooltip-Anker „card“ rein per CSS** (`bottom` aus Dock + Leiste + 8 px) statt einer Messung von Card/Leiste wie in `hud.js`; Punkt/Rechteck-Anker werden einmal beim Öffnen gemessen.
13. `HudScaleSetting` (`'auto' | number`) ist eigenständig typisiert statt aus `model/menus/settings.ts` (p6) importiert, damit die Wurzel nicht an die Menü-Modelle gekoppelt ist.

## Bekannte Lücken / Übergaben

- **Firefox-Minimap ≈ 0,8–0,85 ms** je Dynamik-Zeichnung (Chromium 0,12, WebKit ≈ 0,15): Profil in Firefox je Zeichnung `fill` 0,38 ms (4 Pfade mit ≈ 1.000 Rechtecken), `drawImage` 0,42 ms (≈ 290 Sprite-Stempel à 1,4 µs), Pfadaufbau 0,12 ms. Budget 0,5 ms ist informativ (MS11); möglicher Hebel für MS11: Einheitenpunkte in einen eigenen Pixelpuffer schreiben und per `putImageData` hochladen (kein Lesen, bleibt regelkonform).
- **Hinweis an p3/p7 (Style-Kosten der Mehrfachauswahl)**: `--v`/`--vet` auf `.tile`/`.unit` werden an alle Nachkommen vererbt (Kachel-Icon mit `<use>`-Schattenbaum). Optionen: den Wert auf ein Blatt setzen oder `@property --v { syntax: '*'; inherits: false }` + `--v: inherit` an den verbrauchenden Pseudo-Elementen (`.tile::after`, `.unit::after`, `.qi.is-now::after`; Achtung `.ff-range::-webkit-slider-runnable-track`). Gemessen: Kachel-Update 0,24 → ≈ 0,09 ms je 15 Kacheln.
- **Hinweis an p2**: Rechtsbündige Werte mit variabler Zeichenzahl (Netto, Zustands-Badge) verschieben ihren Textknoten; mit Ziffernbreiten-Leerzeichen (U+2007) auf feste Länge gepolstert gäbe es keine Layout-Shift-Einträge mehr. Der Alert-Feed ordnet beim Einfügen um (Keys nach Alert-Id).
- Tastaturschicht der Wurzel nur über `hotkeys` (Galerie); das Spiel bindet `resolveGridKey`/`resolveStripKey` selbst (MS4/MS6). Leertaste/Shift+Leertaste, `P`, `−`/`+` liegen weiter beim Spiel.
- Hover über der **Welt** (Punkt-Anker) setzt das Spiel über `model.tooltip` (Picking), die HUD-Wurzel liefert nur Anzeige und Positionierung.
- Bei der Arbeit wurde einmal versehentlich ohne `FAF_HUD_OUT_DIR` gebaut; `vite build` leerte dabei `apps/hud-gallery/dist` (auch Unterordner anderer Pakete). Die Build-Ausgaben sind nicht eingecheckt und werden bei jedem Lauf neu erzeugt.
