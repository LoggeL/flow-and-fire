# TRACK-HUD · hud-p2-top – Obere HUD-Zone

> Stand 2026-09-30 · Worktree `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-hud` (der im Auftrag genannte Pfad `/Users/logge/Documents/Projects/faf-hud` existiert nicht; Branch `track-hud`) · Welle 1 (parallel zu hud-p3-selection und hud-p4-card) · Vertrag: [`docs/plans/TRACK-HUD-contract.md`](../plans/TRACK-HUD-contract.md) · Vorlage: `docs/design/ui.md` §5.1–§5.3, §5.11, §5.12, Mockup `hud.html` + `assets/hud.{css,js}`

## Ergebnis

| Abnahmepunkt | Status | Nachweis |
|---|---|---|
| Tests `packages/hud/test/top` (über `tools/heavy`) | ✅ | 6 Dateien, 69 Tests; zusammen mit `test/foundation` (inkl. i18n-Scanner) und `apps/hud-gallery/test` 21 Dateien, 235 Tests grün |
| `tsc -b packages/hud apps/hud-gallery` | ✅ | ohne Fehler; Testdateien zusätzlich gegen `tsconfig.tests.json` geprüft |
| eslint + depcruise (`packages/hud`, `apps/hud-gallery`) | ✅ | eslint ohne Befund, „no dependency violations found“ |
| Galerie-Tests `apps/hud-gallery/test` (Coverage, Registry) | ✅ | 5 Dateien, 23 Tests – alle Soll-Zustände der sechs Komponenten vorhanden |
| Galerie-Build `dist/top` + Playwright Chromium `-g 'grp=top '` (Port 4484) | ✅ | 74 bestanden (37 Stories + 37 Pseudo-Pässe), keine Layoutfehler, 11 s |
| Screenshots angesehen, mit Mockup verglichen | ✅ | `test-results/hud-gallery-top/chromium/*.png` gegen `hud.html?sel=factory&stall=1&flow=1` (Befund unten) |

## Komponenten (`packages/hud/src/hud/top/`, Barrel `index.ts`, CSS `top.css`)

| Datei | Komponenten | Kern |
|---|---|---|
| `ResourceBar.tsx` | `ResourceBar`, `ResourceMeter`, `FlowDetails` | Meter als `<button class="res res--mass ff-panel">` (312 × 60 @1,0), Klick → `toggleFlowDetails()`; `aria-expanded`/`aria-controls` auf die Flow-Details (`#ff-flow-details`). Zustände als Klassen `is-overflow`/`is-stall-soon`/`is-stall` (+ `is-open`) und `data-status`; Symbol + Text im Badge (Stall: Achteck + „Stall · Flow 72 %“, Überlauf: Dreieck + „Voll · verfällt“, Stall droht: Dreieck + „Leer in 7 s“, Netto pulsiert gelb, `title` am Netto). Netto = Einkommen − Bedarf (im Stall der Fehlbetrag), Verbrauch = bedienter Verbrauch. Speicherbalken = `Bar` (scaleX, im Stall `is-crit` = rot + Schraffur, im Überlauf `is-warn`). FlowDetails (628 px): je Ressource die 5 größten Verbraucher (`topConsumers`, stabil sortiert), „erhält / Bedarf“, Engpass-Markierung (Dreieck + Warnfarbe + `title`), pausierte Zeile durchgestrichen/gedimmt, Pause-Knopf (`pauseConsumer(id, !paused)`, `aria-pressed`) nur bei `eco.interactive`, sonst Hinweis „nur Anzeige (Pausieren ab E13)“; Kopf „kein Engpass“ bzw. Krit-Badge „alle Verbraucher 72 %“; Fuß mit Pausiert-Zähler, Stall-Priorität, „Klick Leiste öffnet/schließt“. |
| `MatchStatus.tsx` | `MatchStatus` | Timer `mm:ss`/`h:mm:ss`, Tempo `×1,0` mit −/+-Knöpfen (`changeSpeed(∓1)`, Glut bei ≠ 1), Einheiten `64 / 500` (ab 90 % `is-near` + Dreieck, am Cap `is-reached` + Achteck), Punkte nur bei `match.replay`, Menüknopf → `openGameMenu()` („Menü (Esc)“). |
| `PauseBanner.tsx` | `PauseBanner` | Priorität Pause > Hintergrund-Pause > Context-Loss > Sim-Lag > Tempo (`bannerKind`); „P fortsetzen“ ist ein Knopf (`togglePause()`), Taste nach Tastaturlayout; Sim-Lag/Context-Loss als schmale Banner mit Stufensymbol; `role="status"`. |
| `AlertFeed.tsx` | `AlertFeed`, `Alert` | max. 3 sichtbar, neueste oben, „N ältere · ⇧␣ durchblättern“ als Knopf (`cycleAlerts()`); je Alert `LevelSymbol`, Titel (Subjekt bei Erfolgsmeldungen im Titel, `×N`), Metazeile (Subjekt · Ort · Alter), Knopf „Ort“ bzw. „Flow“ (Stall) → `jumpToAlert(id)`; die Leertaste steht auf dem neuesten Alert **mit** Sprungziel; „Speicher voll“ hat keinen Knopf. Kritische blitzen beim Erscheinen zweimal (`is-new`, CSS-Animation, aus bei `reducedMotion = 'on'`, `data-motion="reduce"` und `prefers-reduced-motion`). `aria-live` assertive, solange ein kritischer sichtbar ist, sonst polite. |
| `UnitTooltip.tsx` | `UnitTooltip` | Props = `UnitTooltipTarget` ohne `kind` (`typeId`, `builderBp`, `slot`, `mode` build/factory/info, `locked`, `disabledReason`). Kopf (StrategicIcon, Name, Rolle · „Ziel: Land + Luft“, Taste nach Layout), Kosten + Flow-Bedarf bei BP (gelb, sobald Bedarf > Netto einer Ressource), Werte-Raster 3 × 2, Sperr-/Deaktiviert-Zeile, Beschreibung, Grünspan-Kasten (nur mit Adjacency), Fuß je Modus. |
| `ResourceTooltip.tsx` | `ResourceTooltip` | Einkommen, Verbrauch, Netto, Speicher, Flow, Prognose („leer/voll in N s“, „voll“, „leer“, „stabil“), Zustandszeile Stall/Überlauf/Stall droht mit Symbol, Einkommen nach Quelle, Speicher nach Gebäude, Fuß „Klick öffnet die Flow-Details“. |
| `tooltipStats.ts` | `unitTooltipStats()` | Raster-Logik aus `FF.unitTip` (Mockup): HP · DPS bzw. Produktion · Reichweite bzw. Speicher/Build Power · Tempo bzw. Unterhalt/Sicht · Bauzeit bei BP (ohne Bauer: Regeneration) · Tech. |
| `sample.ts` | `useSampled()` | 4-Hz-Abtastung für Tooltip-Inhalte ohne Signal-Abo (Re-Render nur bei geändertem Anzeigeschlüssel). |
| `labels.ts` | Textbausteine | Verbraucherzeilen („Landwerk I · Punze“, „Lehrling ×2 · Zapfstelle I“, „Zapfstelle I → II“, „Horcher I (Unterhalt)“), Priorität, Quellen, Regionen, Alter, Alert-Titel/-Metazeile. |

**Binding (ui.md §9.1/§9.2):** Alle 10-Hz-Werte der Meter (Speicher, Kapazität, Netto, Einkommen, Verbrauch, Flow, Badge-Text, Klassen, `aria-label`, `title`, `--v` des Balkens) sind `computed`-Signale direkt im JSX (Textknoten bzw. Attribut-Updater von `@preact/signals`), geschrieben nur bei geändertem String. Nur der kleine Zustands-Slot am Ende der Flow-Zeile rendert bei Statuswechsel neu. Timer, Tempo, Einheiten, Alert-Alter und `is-stale` binden ebenso (1 Hz, kein Re-Render). Strukturänderungen (Alerts, Banner, Verbraucherliste bei 4 Hz, Cap-Stufe, Punkte) rendern die betroffene Komponente neu. Tooltips tasten mit 4 Hz ab.

**Tooltip-Anbindung für p5:** Die Meter tragen `data-tip="resource:mass|energy"`, damit der `TooltipLayer` per delegiertem Listener den `ResourceTooltip` öffnen kann; `ResourceTooltip`/`UnitTooltip` rendern je genau einen Wurzelknoten (`.tip-res`/`.tip-unit`, 320 px) ohne Positionierung.

## Model und Commands (eigene Sektionen)

- `model/eco.ts` (von p0 angelegt, hier genutzt/erweitert): `netLevel`, `storageFill`, `wholeSecondsToEmpty/Full`, `consumerRequest/Served`, `isBottleneck`, `topConsumers` (≤ 5, stabil), `pausedCount`, `overallFlow`, `writeResource`, `FlowConsumer.count` (zusammengefasste Zeilen), `FLOW_DETAILS_MAX_ROWS`, `NET_ZERO_EPS`.
- `model/status.ts`: `isSpeedChanged`, `BannerKind`, `bannerKind()` (Priorität s. o.; Sim-Lag nur, wenn effektiv < angefordert).
- `model/alerts.ts`: `mergeAlert` (rein; gleicher Typ, |Δt| zur letzten Wiederholung ≤ Intervall → `count + 1`, neuester Ort/Subjekt, nach oben), `pushAlert`, `pruneAlerts`/`tickAlerts` (≥ 60 s → Verlauf, `historyCount`), `isAlertStale` (≥ 20 s), `isAlertFlashing` (krit. < 2 s), `visibleAlerts`, `olderAlertCount`, `alertLevel`, `alertJumpTarget`, `alertLiveMode`, `mapRegion`, `AlertRegion`, `ALERT_SUBJECT_IN_TITLE`, **`resolveAlertJump(items, id)`** (für die Spielseite: Kamera auf `location` bzw. Flow-Details öffnen) und **`newestJumpAlertId(items)`** (Ziel der Leertaste).
- `model/tooltip.ts`: `resourceForecast()`, `flowDemandExceedsNet()`; `UnitTooltipTarget` mit `mode`, `locked`, `disabledReason`.
- Commands unverändert gegenüber p0 (`toggleFlowDetails`, `pauseConsumer`, `openGameMenu`, `changeSpeed`, `togglePause`, `jumpToAlert`, `cycleAlerts`); jede Fläche ist im Test mit `createRecordingCommands()` geprüft.

## i18n (Namespaces eco, status, alerts, tooltip; DE Quelle, EN vollständig)

Wortlaut nach ui.md/Mockup („Flow-Verteilung“, „erhält / Bedarf“, „Stall · Flow 72 %“, „Voll · verfällt“, „Sim hinkt nach · ×0,8 effektiv“, „Grafik wird wiederhergestellt · Sim läuft weiter“, „N ältere · ⇧␣ durchblättern“ …). Gegenüber dem Vorstand entfernt: `ui.eco.meter.toggle`, `ui.tooltip.commander`, `ui.tooltip.foot.center`, `ui.tooltip.layer.structure` (ungenutzt); neu: `ui.tooltip.foot.selectType`, `ui.tooltip.key.doubleClick`, `ui.tooltip.reason.upgrading` (übersetzter Beispielgrund für deaktivierte Zellen). Unit-Namen/Rollen/Beschreibungen/Adjacency kommen ausschließlich über `unitText()`.

## Demo (`src/demo/top.ts`, exportiert über `hud/top/index.ts`)

`RESOURCE_DEMO`/`applyResourcePreset`/`applyEcoPreset` (normal, overflow, stallSoon, stallMass, stallEnergy, stall; Werte wie Mockup), `DEMO_CONSUMERS`/`demoConsumers`/`applyFlowDetailsPreset` (closed, open = nur lesend, paused = interaktiv + Upgrade pausiert, bottleneck = Energy-Stall 72 %), `applyMatchPreset` (normal, speed, capNear, capReached, replay, long), `applyBannerPreset` (none, pause, background, speed, lag, contextLoss), `DEMO_ALERT_EVENTS` (alle 10 Typen), `applyAlertEvents`/`applyAlertPreset` (Einzeltypen, stale, merged, mixed = 5 Alerts, all), `DEMO_TOOLTIPS` (Glutkessel I mit Nachbarschaft, Punze im Landwerk, Vogt, Schirm II gesperrt, Zapfstelle I deaktiviert), `createEcoDemoTicker(model, seed)` (deterministischer 10-Hz-Treiber mit `createDemoRng`, für Messung/Demo-Pfad).

## Stories (`apps/hud-gallery/src/stories/top.stories.tsx`, 37)

ResourceMeter: Normal, Überlauf, Stall droht, Stall (+ „Stall (nur Energy)“, + fullscreen „Oberzone komplett“ zum Mockup-Vergleich) · FlowDetails: geschlossen, offen, Zeile pausiert, Engpass · MatchStatus: normal, Tempo ≠ 1, Cap nah, Cap erreicht (+ Replay mit Punkten, lange Partie) · PauseBanner: Pause, Hintergrund-Pause, Tempo, Sim-Lag, Context-Loss · Alert: kritisch (neu blitzt), Warnung, Info, Erfolg, veraltet, zusammengefasst (+ Feed gemischt, Energie knapp, alle Typen) · Tooltip: Einheit, Gebäude, Ressource, mit Nachbarschaft, ohne Nachbarschaft (+ gesperrt, deaktiviert). Tag `xbrowser` für Überlauf, Stall und kritischen Alert.

## Tests (`packages/hud/test/top`, happy-dom)

| Datei | Inhalt |
|---|---|
| `model.test.ts` (17) | `resourceStatus`-Grenzfälle (Flow knapp unter 1, voll bei Netto 0, genau 10 s vs. 9,99 s, Kapazität 0), Anzeigehilfen, Top-Verbraucher/Engpass, Prognose, Flow-Warnung, Cap/Banner-Priorität, Alert-Logik (Zusammenfassen innerhalb/außerhalb des Intervalls inkl. Kette, veraltet/entfernt/Verlauf, max. 3 + Zähler, Stufen/Sprungziele/Live-Modus/Blitzfenster, `resolveAlertJump`, `newestJumpAlertId`, Regionen) |
| `resource-bar.test.tsx` (14) | alle Meter-Zustände mit Klassen, Texten, `aria-*`, `--v`; EN; Klick → `toggleFlowDetails`; Statuswechsel; **Hot-Update**: Render-Zähler über `options.diffed` bleibt bei 2, Speicher-Textknoten identisch, nur `characterData` + `aria-label`/`style`, unveränderter String schreibt nichts, 50 Ticks ohne Re-Render; FlowDetails geschlossen/offen/pausiert/Engpass/EN, `pauseConsumer(id, paused)` |
| `status.test.tsx` (11) | MatchStatus-Zustände, Replay-Punkte, `h:mm:ss`, `changeSpeed(−1/+1)`, `openGameMenu`, EN, Timer/Einheiten ohne Re-Render; PauseBanner alle fünf Arten, `togglePause`, EN |
| `alerts.test.tsx` (10) | kritisch (Blitz, assertive, Leertaste, `jumpToAlert`), Bewegung reduzieren, Warnung/Info/Erfolg, zusammengefasst ×3, veraltet ab 20 s ohne neuen Knoten, Entfernen nach 60 s → „1 ältere“, gemischter Feed + `cycleAlerts`, Stall → Flow-Details, Speicher voll ohne Knopf, alle 10 Typen, EN |
| `tooltip.test.tsx` (11) | Glutkessel (Kosten, Flow-Bedarf gelb, Raster, Nachbarschaft, Fuß), Punze (Fabrik-Fuß, kein Gelb), Warnung folgt dem Eco, Vogt (Info), gesperrt/deaktiviert, Unterhalt + EN, Raster-Sonderfälle; ResourceTooltip Werte/Quellen/Speicher/Zustände, 4-Hz-Abtastung mit Fake-Timern, EN |
| `demo.test.tsx` (6) | Presets erreichen die Zielzustände, Ticker deterministisch, Tooltip-IDs im Roster, lokale Messung |

## Messwerte (lokal, Apple M5 Pro; Messung ≠ Gate, DECISIONS 5/16)

- Ganze Oberzone (ResourceBar mit offenen Flow-Details im Engpass, MatchStatus, AlertFeed mit 5 Alerts) in happy-dom, 300 Ticks mit `createEcoDemoTicker` (10 Hz) + jedem 10. Tick Timer/Einheiten: **Mittel 0,035 ms, Max 0,92 ms** je Tick inkl. Signal-Flush (happy-dom, kein Layout/Style; die Browser-Messung mit 500 Einheiten macht p5 über `perf.spec.ts`).
- Knoten: Oberzone komplett (Stall, Flow-Details offen, Status, 3 Alerts + Zähler) liegt klar unter dem Budget 700 (Layoutprüfung (d) grün).
- Galerie-Build `dist/top` (alle zu diesem Zeitpunkt vorhandenen Stories aller Gruppen, 180): JS 363 kB (gzip 86 kB), CSS 127 kB (gzip 16 kB).

## Visuelle Prüfung

Verglichen: `resource-meter--oberzone` (1920 × 1080) mit dem Mockup `hud.html?sel=factory&stall=1&flow=1` (per Playwright aufgenommen), dazu alle Einzel-Stories. Übereinstimmend: Maße/Position der Meter, Flow-Details und Status, Stall-Rahmen, Rot-Verlauf, Badge-Platzierung, Alert-Karten. Korrigiert nach der ersten Sichtung: (1) `.res > span { display: block }` überschrieb die Flex-Zeile – „+28,0−28,0“ klebte zusammen und die Glyphe war nicht zentriert → `.res > .res__flow { display: flex }`, `.res > .res__glyph { display: grid }`; (2) Pause-Banner brach „P fortsetzen“ in eine zweite Zeile → `.banner__sub { white-space: nowrap }` (Banner wächst mittig); (3) Galerie „alle Typen“ zeigte den Vogt-Alert als veraltet. Bewusste Unterschiede zum Mockup: siehe Abweichungen.

## Abweichungen und Entscheidungen

1. **Meter als `<button>`** statt `div[tabindex]` (Tastatur/Screenreader, ui.md §8.5); CSS-Reset in `top.css`. Mockup-Klasse `is-full` heißt `is-overflow`, dazu neu `is-stall-soon`/`is-open`.
2. **„Stall droht“ mit Badge** („Leer in 7 s“ + Dreieck) statt nur pulsierender Zahl – „nie nur Farbe“ (§8.1); Netto pulsiert zusätzlich, mit Bewegung-reduzieren statisch doppelt unterstrichen.
3. **Überlauf-Badge mit Dreieck**, Stall-/Engpass-Badges mit Achteck (Mockup ohne Symbol).
4. **Engpass-Markierung** je Zeile (Dreieck + Warnfarbe + `title` „Engpass: … erhält x von y“); im Stall sind damit alle laufenden Zeilen markiert (sie werden alle gedrosselt). Zeilen sind nach Bedarf sortiert (stabil nach id), nicht in Mockup-Reihenfolge; pausierte Zeilen bleiben sichtbar.
5. **Tempo-Knöpfe −/+** im Status (Auftrag; Mockup nur Anzeige). Cap-Stufen tauschen zusätzlich das Symbol (Dreieck/Achteck).
6. **Hintergrund-Pause** zeigt Titel „PAUSE“ + „Pausiert – Tab war verborgen · P fortsetzen“ (Mockup zeichnet sie nicht). Sim-Lag gilt nur, wenn das effektive Tempo unter dem angeforderten liegt.
7. **Alert-Sprungknopf**: Stall-Alerts heißen „Flow“ (Flammensymbol) statt „Ort“; „Speicher voll“ hat kein Sprungziel und keinen Knopf; die Leertaste steht auf dem neuesten Alert mit Ziel (`newestJumpAlertId`). Die HUD ruft nur `jumpToAlert(id)`; die Spielseite löst das Ziel mit `resolveAlertJump()` auf (Flow-Details **öffnen**, nicht umschalten).
8. **Tooltip-Raster**: Produktion ersetzt DPS nur bei unbewaffneten Produzenten (der Vogt zeigt DPS statt „+1/s Mass“); ohne Bauer (Info-Modus) zeigt Zelle 5 die Regeneration statt der Bauzeit, Tech des Vogts „–“. Info-Fuß „Klick auswählen · Doppelklick alle dieses Typs“ (neu, ui.md nennt nur Bau/Fabrik).
9. **Tooltip-Wurzelknoten** `.tip-unit`/`.tip-res` um den `TooltipFrame` (trägt `data-component`/`data-testid` der Inhaltskomponente, weil `TooltipFrame` von p0 kein Durchreichen weiterer Attribute kennt).
10. **Flow-Anzeige je Ressource**: `flow` bleibt der bediente Anteil der eigenen Ressource (Mass-Stall-Preset lässt Energy auf 100 %), wie im p0-Modell; `overallFlow()` (Minimum) steuert den Kopf der Flow-Details.

## Bekannte Lücken / Übergaben

- Positionierung, 350-ms-Verzögerung und Delegation der Tooltips (`data-tip`) sowie Leertaste/Shift+Leertaste und `P`/`−`/`+` als Tasten liegen beim TooltipLayer bzw. der Tastaturschicht (p5/MS4); die HUD-Seite liefert Inhalte, Knöpfe und die reinen Helfer (`resolveAlertJump`, `newestJumpAlertId`).
- Alert-Ping auf der Minimap, Gong und Sprachzeile sind nicht Teil dieses Pakets (Minimap p5, Audio MS9).
- Firefox/WebKit wurden für diese Gruppe nicht separat gestartet (Abnahme: Chromium); die Stories mit Tag `xbrowser` laufen im Gesamtlauf `test:e2e:hud` mit.
