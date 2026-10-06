# TRACK-HUD – Vorarbeits-Track HUD und Menüs (`@faf/hud`)

> Stand 2026-09-30 · Branch `track-hud` · Worktree `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-hud`
> (der in Plan und Aufträgen genannte Pfad `/Users/logge/Documents/Projects/faf-hud` existiert nicht; `git worktree list`
> zeigt den Track-Worktree unter `flow-and-fire/.worktrees/`, gearbeitet wurde ausschließlich dort) ·
> Plan: [`docs/plans/TRACK-HUD.json`](../plans/TRACK-HUD.json) · Vertrag: [`docs/plans/TRACK-HUD-contract.md`](../plans/TRACK-HUD-contract.md) ·
> Vorlage: [`docs/design/ui.md`](../design/ui.md) + [`docs/design/ui-mockups/`](../design/ui-mockups/)

Fragmente der Arbeitspakete (bleiben erhalten, Details dort):
[p0 Fundament](track-hud-p0-foundation.md) ·
[p1 Daten + Galerie](track-hud-p1-data-gallery.md) ·
[p2 Oberzone](track-hud-p2-top.md) ·
[p3 Auswahl](track-hud-p3-selection.md) ·
[p4 Command Card](track-hud-p4-card.md) ·
[p5 Wurzel/Minimap/Scheduler/Benchmark](track-hud-p5-root.md) ·
[p6 Menüs](track-hud-p6-menus.md) · p7 Integration und Abnahme = dieses Dokument.

## 1. Zweck und Abgrenzung

TRACK-HUD ist **kein Meilenstein aus PLAN §5.2**, sondern Vorarbeit parallel zu MS3: alle HUD- und Menü-Komponenten
aus ui.md §5/§6 als echte, getestete Preact-Komponenten in einem eigenen Paket, angebunden ausschließlich über ein
typisiertes View-Model (`HudModel`, Signals je Sektion) und Command-Callbacks (`HudCommands`), betrieben mit
deterministischen Demo-/Fake-Daten. Es gibt **keine** Verbindung zu `sim`, `client`, `render`, `protocol` oder
`apps/game` (dependency-cruiser `hud-deps`/`hud-npm-deps`/`hud-gallery-deps`).

Integration ins Spiel passiert später:

| Meilenstein | Was aus `@faf/hud` übernommen wird |
|---|---|
| MS4 | Ressourcenleiste (C10, E1–E4), Command Card Bau-Seite T1 (C8, B1), Tooltips minimal, i18n (P12), Tastatur-Schichten, `HudScheduler` an den Frame-Sektionen |
| MS6 | Auswahl-Panel voll (C9), Fabrik-Queue (B3/B2), Befehlsleiste, Selection-Filter/Idle (C14), Control Groups (C7) |
| MS9 | Alerts (P8), Hauptmenü/Gefecht einrichten/Esc-Menü (A3, M8, G12), Teamfarben-Modi (P16-Teil, UI-E5), Ladebildschirm (P3) |
| MS11 | Minimap (C16, I1, I2), Sim-Tempo (A6), Selbstzerstörung/Patrouille, Vet, Replays |
| MS14 | Einstellungen komplett (P9), Score-Screen (A13), KI-Stufen/AIx (A10, A11), Context-Loss-Banner (P10) |

Nicht in diesem Track: ReplayBar (§5.16), DevConsole/BudgetOverlay (§5.13), Cursor-FSM (§7.1), Welt-Overlays (§5.14).

## 2. Paketübersicht

```
packages/hud/                         @faf/hud  (Exports: "." → src/index.ts, "./styles.css" → src/styles/index.css)
  scripts/gen-data.ts                 Generator roster.json + content/icons → src/data/*.gen.* (gen, gen --check)
  scripts/unit-texts.json             Kurznamen/Beschreibungen/Adjacency DE/EN (56 Einheiten)
  bench/scheduler.bench.ts            Node-Benchmark HudScheduler + Minimap-Dynamik (perf-500)
  src/
    model/<sektion>.ts                eco, status, alerts, tooltip, selection, factory, card, orders, strip, minimap, snapshot
    model/menus/*.ts                  main, skirmish, teams, loading, gamemenu, settings, score, controller
    model/index.ts                    HudModel, createHudModel(), HudProvider, useHud(), useCommands()
    commands/<sektion>.ts, index.ts   HudCommands (57 Befehle), createNoopCommands(), createRecordingCommands(), Mods
    i18n/                             t, tn, tDynamic, locale, setLocale, pseudo; locales/<ns>.{de,en}.json (18 Namespaces, 961 Schlüssel)
    format/                           Zahlen/Zeit/Prozent/Bytes DE/EN
    ui/                               Primitive (Button, Tabs, Segmented, Switch, Check, Range, Select, Input, Bar, Badge,
                                      Key, Vet, Panel, LineIcon, LevelSymbol, ResourceGlyph, TooltipFrame, Num), keys.ts,
                                      uiSettings.ts, frame.ts (rAF-/Uhr-Fallback, p7)
    styles/                           tokens.css (1:1 Mockup), base.css (Port ff.css), fonts.css, menus.css, index.css
    data/                             roster.gen.ts, build-table.gen.ts, icons.gen.ts, icons-mask.gen.css, roster.ts
                                      (unitText, unitName, unitStats …), card-logic.ts, StrategicIcon.tsx
    hud/top/                          ResourceBar/ResourceMeter/FlowDetails, MatchStatus, PauseBanner, AlertFeed/Alert,
                                      UnitTooltip, ResourceTooltip
    hud/selection/                    SelectionPanel, UnitDetail, OrderQueue, SelectionMulti, FactoryDetail, FactoryQueue
    hud/card/                         CommandCard, CardCell, TechTabs, OrderBar, OrderButton, OrderTooltip, gridKeys (resolveGridKey)
    hud/strip/                        SelectionFilter, IdleButton, ControlGroups, Strip, stripKeys (resolveStripKey)
    hud/minimap/                      Minimap (Canvas2D, 4 Ebenen), MinimapRenderer, draw.ts
    hud/root/                         Hud (Wurzel/Dock), TooltipLayer, computeUiScale, computeHudLayout
    menus/{main,skirmish,loading,gamemenu,settings,score,shared}/
    scheduler/                        HudScheduler, Raten, Gleichheit
    demo/                             core (seeded PRNG), top, selection, card, menus, minimap, scenarios; index.ts = einziger Exportweg
  test/<gruppe>/                      foundation, data, top, selection, card, minimap, root, scheduler, menus (+ support)
apps/hud-gallery/                     @faf/hud-gallery (Vite + Preact), importiert nur @faf/hud
  src/story.ts, registry.ts, required-states.ts, app/, perf/, stories/<gruppe>.stories.tsx (234 Stories)
  e2e/gallery.spec.ts, harness.spec.ts, perf.spec.ts, support/{env,layout-check}.ts
  test/ coverage, registry, route, layout-check, app
```

Root-Änderungen stammen ausschließlich aus p0 (Projekt-Referenzen in `tsconfig.json`/`tsconfig.tests.json`, JSX in
`vitest.config.ts`, ESLint-Globals und Mockup-Ignore, dependency-cruiser-Regeln, Skripte `test:e2e:hud`/`bench:hud`,
`.gitignore` für Messergebnisse, `pnpm-lock.yaml`); Details im [p0-Fragment](track-hud-p0-foundation.md#root-änderungen-minimal-nur-ergänzt).

## 3. Verträge

### 3.1 HudModel (Signals je Sektion)

`createHudModel({ units? })` liefert ein Aggregat aus globalen Signalen (`locale` = das i18n-Signal, `teams`
house|relation|cvd, `scale`, `reducedMotion` system|on|off, `keyboardLayout` de|en|fr, **`units` = `UnitCatalog`**) und
den Sektionen:

| Sektion | Inhalt (Auszug) | Eigentümer |
|---|---|---|
| `eco` | je Ressource stored/capacity/income/demand/served/flow + abgeleitet net/status; consumers, detailsOpen, interactive, stallPriority | p2 |
| `match` | timeS, speed, pause (none/user/background), simLag, contextLost, units/unitCap, replay, scores | p2 |
| `alerts` | items (zusammengefasst, Alter), historyCount, nowS | p2 |
| `tooltip` | target (unit/resource/order) + Anker | p2 |
| `selection` | kind (none/single/multi/factory), single/multi-Daten, multiStats (Typed Arrays, 4 Hz), Fokus-Typ | p3 |
| `factory` | detail, queue, progress (10 Hz), remainingS | p3 |
| `card` | selectedTypes, unitCount, tab, queueCounts, progress, capReached, placing, buildPower | p4 |
| `orders` | states je Befehl (enabled/armed/on/mixed/mode), selfDestructCountdown | p4 |
| `strip` | groups[10], activeGroup, idleEngineers, idleFactories | p4 |
| `minimap` | available, mapName/-größe, terrain, spots, units (SoA), fog, pings, camera, mode, showResources | p5 |
| `menus` | main, skirmish, loading, gamemenu, settings, score | p6 |

Reine Ableitungen liegen neben den Typen (z. B. `resourceStatus`, `bannerKind`, `mergeAlert`, `aggregateMultiStats`,
`resolveCardPage`, `validateSkirmish`, `changedSettings`).

**Einheitendaten (Review-Nachbesserung, DECISIONS HUD-4):** Kosten, BuildTime, BuildPower, DPS/Reichweite, Kategorien,
Tech, Icon, Hotbuild-Slot, buildableBy (`buildTable`) und alle Einheitentexte (Name/Rolle/Kurzname/Beschreibung/
Adjacency) kommen ausschließlich aus `model.units` (`UnitCatalog`, `src/data/catalog.ts`: `createUnitCatalog({ units,
buildTable }, label)`, `find`/`indexOf`, `EMPTY_UNIT_CATALOG`). Alle Funktionen in `src/data/roster.ts` und
`src/data/card-logic.ts` nehmen den Katalog als ersten Parameter; abgeleitete Tabellen (Card-Varianten, baubare Mengen,
Pseudo-Texte) sind **pro Katalog-Objekt** memoisiert (WeakMap), es gibt keine Modul-Tabellen mehr. Komponenten lesen
den Katalog über `useUnitCatalog()` bzw. `model.units.value` (Katalogwechsel = Ereignis, Card-Seite rechnet neu).
Unbekannte Typ-IDs werfen nirgends (Name = ID, Werte „–“, `unitStats`/`flowDemand` → `null`, Auswahl nur aus
unbekannten IDs → Befehlsseite); `getUnit` wirft nur noch für Tests/Demo-Daten. Das Generat aus `roster.json` +
`scripts/unit-texts.json` ist nur noch der Demo-Katalog `demoUnitCatalog()` (`src/demo/catalog.ts`) für Galerie,
Tests und Benchmarks. Zusätzlich fängt `PanelBoundary` (`src/ui/PanelBoundary.tsx`) Renderfehler je Panel und im
Tooltip ab (Panel verschwindet, `console.error`, Tooltip versucht es beim nächsten Ziel erneut).

### 3.2 HudCommands

`HudCommands` = Schnittmenge der Sektions-Interfaces Eco · Match · Alert · Selection · Factory · Card · Order · Strip ·
Minimap · Menu (57 Befehle). Jede Sektion führt eine Laufzeit-Namensliste (`<SEKTION>_COMMAND_NAMES`, per `satisfies`
gegen das Interface geprüft); `COMMAND_NAMES` ist zur Compile-Zeit vollständig (`CommandNamesComplete`).
`createNoopCommands()` (Provider-Standard) und `createRecordingCommands(impl?)` (Tests, Galerie-Protokoll, optional
delegierend). Modifikatoren: `Mods`, `ClickMods` (`button 0|2`), `modsFromEvent()` (⌘ = Strg). Komponenten ändern nie
selbst Zustand (ui.md §7.6) – Ausnahme sind rein lokale UI-Zustände, die die Galerie über
`createCardDemoCommands`/`createMenuController` spiegelt.

p7-Zusammenführung: keine Sektion meldete Befehle außerhalb der Listen; alle Erweiterungen (Menü-Befehle p6,
Minimap-Befehle p5) stehen in `commands/index.ts`. Doppelte Hilfsfunktionen zusammengelegt: `unitName` (dreifach in
top/selection/card) → `data/roster.ts`; rAF-/Uhr-Fallback (Scheduler + Minimap-Renderer) → `ui/frame.ts`;
Demo-Terrain der Minimap nutzt den Generator von `menus/shared/terrain.ts` (vorher doppelte Rausch-/Farbrampe);
`UiScaleSetting` der Wurzel heißt jetzt `HudScaleSetting` (Namensgleichheit mit dem engeren Settings-Typ aufgelöst).
Demo-Daten werden nur noch über `src/demo/index.ts` exportiert (vorher zusätzlich über vier Gruppen-Barrels).

### 3.3 Snapshot und Scheduler-Raten

`HudSnapshot` bildet die Frame-Sektionen Eco/Watch/Intents (PLAN §3.6) als plain data mit Versionszählern je
Ereignis-Sektion ab; `HudScheduler.push(snapshot, simTick, simSpeed, paused)` hält nur den neuesten Snapshot und
schreibt in **einem** rAF und **einem** `batch()` – nur geänderte Werte:

| Klasse | Rate | Beispiele |
|---|---|---|
| eco | 10 Hz | Speicher/Einkommen/Bedarf/Flow, Fabrik- und Card-Fortschritt |
| hot | 4 Hz | HP/Vet/Befehlskette, Mehrfachauswahl-Werte, Befehls-/Toggle-Zustände, Flow-Details-Verbraucher |
| map | 4 Hz, versetzt zu hot | Minimap-Einheiten, Pings |
| fog | 2 Hz (mit map) | Minimap-Fog |
| slow | 1 Hz | Timer, Einheiten/Cap, Punkte, Idle-Zähler, Gruppen-Zahlen |
| Ereignis | nächster Flush, auch in Pause | Auswahl-, Queue-, Card-, Befehls-, Gruppen-, Alert-, Kartenwechsel; Pause/Tempo |

Wandzeit-gesteuert (bei ×3 bleibt eco bei 10 Hz), in Pause nur Ereignisse; per Fake-Uhr-Tests belegt
(`test/scheduler`).

### 3.4 i18n (P12-kompatibel)

Schlüssel sind volle Pfade `ui.<ns>.<…>` in `src/i18n/locales/<ns>.de.json` (Quelle) und `.en.json`; `MsgKey` ist die
Vereinigung der DE-Schlüssel, EN ist als `Record<keyof DE, string>` typisiert → fehlender EN-Schlüssel = tsc-Fehler =
Build-Bruch (PLAN MS4). Tests prüfen Schlüssel-/Platzhalter-Parität, Plural-Paare (`.one`/`.other` + `tn`), leere
Werte und JSON-Format; ein Scanner (TypeScript-Compiler-API) findet hartkodierte UI-Strings in `src/**/*.tsx`.
Einheitentexte kommen nie aus den Tabellen, sondern über `unitText(catalog, id, field, locale)` aus dem
`UnitCatalog` mit dem P12-Schema `unit.core.<id>.<field>` (`unitTextKey`). Der Scanner meldet auch Buchstaben-Literale
in JSX-Kind-Ausdrücken (`{'Text'}`, `{c ? 'Ja' : 'Nein'}`, `{ok && 'Text'}`, `` {`Stufe ${n}`} ``). Pseudo-Locale (+30 %, Akzente, Klammern) für die Layoutprüfung; Kurzlabels
(≤ 10 Zeichen, 58-px-Zelle) bekommen in Pseudo nur Akzente. Sprachwechsel wirkt live (Signal).

### 3.5 Story-Vertrag

`apps/hud-gallery/src/story.ts`: `Story { id, component, state, title, layout, viewport?, scale?, tags?, nodeBudget?,
setup?, render }`, Registrierung per `import.meta.glob`. Route
`#/story/<id>?locale=de|en|pseudo&scale=<n>&teams=house|relation|cvd&motion=reduce&shot=1`, Matrix `#/matrix/<Komponente>`,
Messmodus `#/perf?units=500&ticks=600&speed=1`. `required-states.ts` ist die Soll-Matrix (38 Komponenten, ui.md §6);
`test/coverage.test.ts` ist seit p7 **standardmäßig streng** (jede Komponente der Matrix braucht alle Zustände, jede
Story-Komponente muss in der Matrix stehen; `FAF_HUD_REQUIRE_ALL=0` lockert nur für lokale Arbeit).

## 4. Komponenten, Zustände, Feature-IDs

Stories: 234 (primitives 61, card 56, top 37, menus 36, selection 19, hud 11, data 7, minimap 7), davon 23 mit Tag
`xbrowser`. Alle Soll-Zustände abgedeckt (Coverage streng grün).

| Komponente | Soll-Zustände (ui.md §6) | Feature-IDs (ui.md §11) |
|---|---|---|
| Button, Tab, Segmented, Switch, Check, Range, Select, Input | Standard, Hover, Fokus, Ausgewählt/Gedrückt, Deaktiviert | – (Primitive) |
| Bar · Badge · Key · Vet | Wert/Warnung/Kritisch · Töne neutral/ok/info/warn/crit/ember | – |
| StrategicIcon | normal, ghost, Maske (Ein-Knoten), Hausfarben, Eigen/Feind, Farbenblind | C2, U3 |
| ResourceMeter / FlowDetails | Normal, Überlauf, Stall droht, Stall · geschlossen, offen, Zeile pausiert, Engpass | C10, E1–E4, E13 |
| MatchStatus | normal, Tempo ≠ 1, Cap nah, Cap erreicht (+ Replay-Punkte) | A5, S1, A6, U7, A19 |
| PauseBanner | Pause, Hintergrund-Pause, Tempo, Sim-Lag, Context-Loss | A5, S9, A6, P10 |
| Alert (AlertFeed) | kritisch (neu blitzt), Warnung, Info, Erfolg, veraltet, zusammengefasst | P8 |
| Tooltip (Unit/Resource) · OrderTooltip | Einheit, Gebäude, Ressource, mit/ohne Nachbarschaft · Befehl, deaktiviert mit Grund | C9, E11 |
| SelectionPanel / OrderQueue | leer, einzeln, mehrfach, Fabrik, Kachel-Fokus · laufend, gehängt, leer | C9, C3, U9 |
| FactoryQueue | laufend, Wiederholen an, pausiert, leer, Mehrfach-Fabrik | B3, B2 |
| CommandCard / CardCell / TechTabs | Bau, Produktion, Gebäude, Befehle, leer, Tab T1–T3 · 12 Zellzustände | C8, B1, U5, B4, U10 |
| OrderBar / OrderButton | sichtbar, ausgeblendet · Standard, Hover, Scharf, An, Gemischt, Zyklus, Deaktiviert, Fokus, Gefahr, Countdown | C4, C5, S3, K6, C6, C12, C13, C17, C18, G4 |
| SelectionFilter / IdleButton | Standard, Hover · Standard, Hover, Idle-Zähler 0, Idle-Zähler N | C14 |
| ControlGroups | leer, belegt, aktiv, Rechtsklick speichert | C7 |
| Minimap | Gelände, Taktisch, Ressourcen an/aus, Ping, Fog-Stufen, Karten-Kennzahlen | C16, I1, I2, I3 (UI-E2) |
| Hud (Gesamtansicht) | vogt, armee, fabrik-stall, pause-cvd, dichtester Fall, 1440, 1440-kompakt, 720 (+ perf-500) | – |
| MainMenu | Standard, EN, letzte Partie leer | A3 |
| SkirmishSetup | Standard, KI Schwer + AIx, Validierungsfehler, Farbenblind, 1440 | A3, M8, A10, A11, A12, P16 |
| Settings | Grafik, Audio, Tasten, Barrierefreiheit, Spiel & Sprache, geändert, Farbenblind-Vorschau, Tasten EN | P9, P12, P16 |
| LoadingScreen | laufend, KI-Worker, Fehler | P3 |
| ScoreScreen | Übersicht, Wirtschaft, Armee, Einheiten, Niederlage, Minimalform, 1440 | A13, A4, N1 |
| GameMenu | offen, Aufgeben-Bestätigung | G12 |

## 5. Bedienung

```bash
cd /Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-hud
H=/Users/logge/Documents/Projects/flow-and-fire/tools/heavy

pnpm --filter @faf/hud run gen            # Roster-/Icon-Daten neu erzeugen
pnpm --filter @faf/hud run gen --check    # prüfen, ob generierte Daten aktuell sind
$H pnpm exec vitest run packages/hud apps/hud-gallery   # Tests des Tracks (Coverage streng)
$H pnpm test:e2e:hud                      # vite build + Playwright chromium/firefox/webkit (Port FAF_HUD_E2E_PORT, Std. 4483)
$H pnpm bench:hud                         # Node-Benchmark + Browser-Benchmark (FAF_PERF_GATE=1 für das Chromium-Gate)
pnpm --filter @faf/hud-gallery dev        # Galerie http://127.0.0.1:5173/#/ (nach Gebrauch beenden)
```

Galerie-URLs: `#/` Übersicht mit Soll-Matrix · `#/story/hud--fabrik-stall` · `#/story/<id>?locale=pseudo` ·
`#/story/<id>?teams=cvd&motion=reduce` · `#/matrix/CommandCard` · `#/perf?units=500&ticks=600`.
Screenshots: `test-results/hud-gallery/{chromium,firefox,webkit}/<id>.png` (nicht eingecheckt); Parallelbetrieb mit
`FAF_HUD_OUT_DIR`/`FAF_HUD_SHOT_DIR`/`FAF_HUD_E2E_PORT` (p1-Fragment).

## 6. Abnahme (acceptance aus `docs/plans/TRACK-HUD.json`)

Schlussprüfung sequenziell über `tools/heavy` im Worktree (Ergebnisse unten „Schlussprüfung“).

| # | Kriterium (Kurzform) | Status | Nachweis |
|---|---|---|---|
| 1 | Paket `@faf/hud` mit Preact + Signals, keine Workspace-Importe, Galerie nur `@faf/hud`, Kernpakete unverändert | ✅ | depcruise `hud-deps`/`hud-npm-deps`/`hud-gallery-deps` grün (`pnpm lint`); `git status`/`git diff 2fc956c` leer für sim/nav/render/client/protocol/fixed/heap/formats/rules/blueprints/sim-host/apps/game/test/e2e |
| 2 | alle HUD- und Menü-Komponenten als echte Preact-Komponenten inkl. Primitive | ✅ | §4; `src/hud/*`, `src/menus/*`, `src/ui/*`; 234 Stories |
| 3 | Galerie zeigt jeden Soll-Zustand (Coverage streng), Playwright Chromium fehlerfrei + Screenshots, Firefox/WebKit ohne Script-Fehler, Port per `FAF_HUD_E2E_PORT` | ✅ | `apps/hud-gallery/test/coverage.test.ts` (streng als Standard); `FAF_HUD_E2E_PORT=4483 pnpm test:e2e:hud`: 940 bestanden, 470 planmäßig übersprungen (Pseudo-Pass/Harness nur Chromium, Firefox/WebKit-Screenshots nur `xbrowser`), zwei Läufe 5,2 / 6,3 min |
| 4 | Layoutprüfung grün in 1920×1080 @1,0, 2560×1440 @1,25 + kompakt, 1280×720 @0,8; keine abgeschnittenen Beschriftungen (auch Pseudo); Schrift ≥ 11 px × Skalierung (≥ 10 px bei 0,8) | ✅ | `e2e/support/layout-check.ts` (a)–(e) in allen Chromium-Stories + Pseudo-Pass; `harness.spec.ts` belegt, dass jede Prüfung anschlägt; `hud--1440*`, `hud--720*` grün |
| 5 | visuelle Prüfung gegen die Mockups dokumentiert | ✅ | §8 (alle Screenshots angesehen, 6 Korrekturen, Restabweichungen begründet) |
| 6 | Command Card folgt roster.json (Tabelle §5.6 exakt, Vogt-Sperren, Tabs nur Stufen, Hotbuild-Zyklus, Upgrade als B, `gen --check`) | ✅ | `test/data/card-logic.test.ts`, `test/card/command-card.test.tsx`; `pnpm --filter @faf/hud run gen --check` |
| 7 | Ressourcenleiste Normal/Überlauf/Stall droht/Stall nicht nur über Farbe; Flow-Details lesend bzw. mit Pause | ✅ | `test/top/resource-bar.test.tsx` (Klasse + Symbol + Text + Schraffur, `pauseConsumer`), Stories `resource-meter--*`, `flow-details--*` |
| 8 | Alerts: 10 Typen, Zusammenfassen, veraltet 20 s, Entfernen 60 s, max. 3 + Zähler, „Zum Ort“ → `jumpToAlert`, aria-live | ✅ | `test/top/alerts.test.tsx`, `test/top/model.test.ts`, `test/foundation/model.test.ts` (Tabelle gegen ui.md §5.11) |
| 9 | nur HudModel + HudCommands; jede interaktive Fläche ruft den richtigen Command mit Modifikatoren | ✅ | `createRecordingCommands` in allen DOM-Tests (u. a. `selection/factory.test.tsx` Queue ±1/±5/Anfang, `selection/multi.test.tsx` Kacheln, `card/strip.test.tsx` Gruppen Rechtsklick/⇧+Rechtsklick) |
| 10 | Tastatur: `resolveGridKey` nach §7.2 (≥ 30 Fälle), Command Card `role=grid` + Pfeile, `aria-label` mit Taste, Menüs per Tastatur | ✅ | `test/card/grid-keys.test.ts` (55 Matrix-Fälle + 13 Strip-Fälle), `command-card.test.tsx`, `menus/*.test.tsx` (Roving-Tabindex, Fokusfalle, Esc) |
| 11 | i18n DE/EN typisiert, Parität, Scanner, Live-Wechsel, `unitText` mit `unit.core.<id>.<field>` | ✅ | `test/foundation/i18n.test.ts`, `i18n-scanner.test.ts`, `provider.test.tsx`, `test/data/roster.test.ts`; `tsc` bricht bei fehlendem EN-Schlüssel |
| 12 | Tokens identisch mit Mockup, nur Tokens, Teamfarben-Modi + reduzierte Bewegung schaltbar | ✅ | `test/foundation/styles.test.ts` (tokens.css 1:1, ff.css-Port), Stories `?teams=` / `motion=reduce`, `applyUiSettings` |
| 13 | HudScheduler feste Raten, ×3 bleibt 10 Hz, Pause nur Ereignisse, keine Schreibvorgänge ohne Änderung | ✅ | `test/scheduler/scheduler.test.ts` (Fake-Uhr), Node-Benchmark (Pässe je Klasse, 0 Schreibvorgänge pausiert) |
| 14 | perf-500: Chromium p95 Script ≤ 1,0 ms, Script + Style/Layout ≤ 1,5 ms (Gate), ≤ 700 Knoten, keine Layout-Shifts; Firefox/WebKit/Minimap berichtet; Bereiche aus ≥ 2 Läufen | ✅ | §7: Chromium p95 Script 0,33–0,34 ms, Script + Style/Layout 0,91–0,93 ms, 577 Knoten, 0 Panel-Shifts (2 Läufe, `FAF_PERF_GATE=1`) |
| 15 | Typecheck, Lint, alle Vitest-Suites (repo-weit), Node-Benchmark grün; Doku + STATUS | ✅ | Schlussprüfung unten; dieses Dokument; Abschnitt „Vorarbeits-Track HUD (track-hud)“ in `docs/STATUS.md` |

**Schlussprüfung** (2026-09-30, `verify_commands` aus `TRACK-HUD.json`, sequenziell, im tatsächlichen Worktree):

| Befehl | Ergebnis |
|---|---|
| `pnpm install --frozen-lockfile` | „Already up to date“ |
| `pnpm --filter @faf/hud run gen --check` | „4 files up to date“ |
| `tools/heavy pnpm typecheck` (`tsc -b` + `tsc -p tsconfig.tests.json`) | ohne Fehler |
| `tools/heavy pnpm lint` (ESLint + dependency-cruiser) | grün, „no dependency violations found (707 modules)“ |
| `FAF_HUD_REQUIRE_ALL=1 tools/heavy pnpm test` (repo-weit) | 149 Dateien, 1.647 Tests grün (davon Track: 52 Dateien, 702 Tests) |
| `tools/heavy pnpm --filter @faf/hud run bench` | 2 Läufe grün (§7) |
| `FAF_HUD_E2E_PORT=4483 tools/heavy pnpm test:e2e:hud` | 2 Läufe: je 940 bestanden, 470 planmäßig übersprungen |
| `FAF_HUD_E2E_PORT=4483 FAF_PERF_GATE=1 tools/heavy pnpm --filter @faf/hud-gallery run bench:browser` | 2 Läufe, je 3 bestanden, Gates grün (§7) |
| unveränderte Pfade (`git status`/`git diff 2fc956c HEAD` für sim/nav/render/client/protocol/fixed/heap/formats/rules/blueprints/sim-host/apps/game/test/e2e) | leer |
| weitere Änderungen außerhalb der Track-Pfade | nur die p0-Root-Konfigurationen, `docs/STATUS.md`, `docs/DECISIONS.md` (angehängt) |
| laufende Server/Browser | keine (Playwright-`webServer` beendet sich selbst; kein Vite-Server des Tracks aktiv) |

## 7. Messwerte

**Lokal gemessen (Apple M5 Pro), kein Referenz-Laptop** – Messung ≠ Gate (DECISIONS 5/16); Bereiche aus je zwei
Volläufen, nacheinander über `tools/heavy`, nicht parallel zu eigenen schweren Jobs. **Fremdlast:** andere Agenten
belegten das zweite Gate-Slot, Load-Average 3,7–5,1 während der Messungen.

**Node** (`pnpm --filter @faf/hud bench`, perf-500, 100 Aufwärm- + 3.000 Ticks, ms je Tick `push` + `flush`):

| Lauf | p50 | p95 | p99 | Schreibvorgänge/Tick | Pässe eco/hot/map/fog/slow/Ereignis |
|---|---|---|---|---|---|
| ×1 | 0,0021–0,0022 | 0,0053 | 0,0118–0,0120 | 8,7 | 3.101/1.241/1.240/620/311/789 |
| ×3 | 0,0012 | 0,0030 | 0,0060–0,0068 | 3,2 | 1.034/414/414/207/104/789 |
| pausiert | 0,0007 | 0,0008 | 0,0010–0,0011 | 0,0 | 1/1/1/1/1/1 |
| Minimap-Dynamik (800 Punkte, nur JS) | 0,0058–0,0059 | 0,0098–0,0100 | 0,0119–0,0125 | – | 1.554 Kontextaufrufe je Zeichnung |

**Browser** (`FAF_PERF_GATE=1 pnpm --filter @faf/hud-gallery run bench:browser`, volle `<Hud>` 1920 × 1080, perf-500:
500 eigene + 300 feindliche Einheiten, Mehrfachauswahl 60/24, Flow-Details offen, 5 Alerts, Minimap; 60 + 600 Ticks,
Cross-Origin-isoliert; ms je HUD-Flush):

| Browser | Script p50 / p95 | Script + Style/Layout p50 / p95 | Minimap p50 / p95 | Knoten | LoAF | Layout-Shifts |
|---|---|---|---|---|---|---|
| Chromium (Gate) | 0,17–0,18 / **0,33–0,34** | 0,31–0,32 / **0,91–0,93** | 0,13 / 0,16–0,17 | 577 | 1–2 je Lauf, max. 293–296 ms, Skriptanteil 0 ms, Style/Layout ≤ 0,46 ms | 0 Panel, 66 Inhalt, 4 Alert-Feed |
| Firefox | 0,26–0,30 / 1,36–1,58 | 0,94–1,08 / 1,56–4,66¹ | 0,84–0,90 / 1,12–6,28¹ | 577 | API fehlt | API fehlt |
| WebKit² | Mittel 0,19–0,28 | Mittel 0,86–0,92 (p95 2) | Mittel 0,13–0,14 | 577 | API fehlt | API fehlt |

¹ Firefox-Lauf 1 mit Ausreißern unter Fremdlast (p99 Script 10,7 ms, Minimap p95 6,3 ms); Lauf 2 ohne (p99 Script
1,5 ms, Minimap p95 1,1 ms). ² WebKit liefert `performance.now()` auch isoliert nur in 1-ms-Schritten, aussagekräftig
ist der Mittelwert. Die LoAF-Einträge warten vor dem Rendern (headless unter Last) und enthalten kein HUD-Skript.

Chromium-Aufschlüsselung Script + Style/Layout nach Flush-Art (Lauf 1): nur eco p95 0,20 ms; eco + hot
(Mehrfachauswahl) 1,01 ms; eco + map (+ fog) 0,32–0,42 ms; mit Ereignis + slow 0,52 ms. Gegenüber p5 (p95
Script + Style/Layout 1,32–1,34 ms bei Load 4–8) liegt der Wert jetzt bei 0,91–0,93 ms; die p7-Änderungen berühren den
Update-Pfad nicht (nur Layout-CSS), der Unterschied ist überwiegend Last.

Knoten der Gesamtansichten: alle ≤ 700 (Layoutprüfung (d) in beiden p7-Läufen grün; Einzelwerte aus p5: 315–580,
perf-500 577); Mockup-Referenz (`shoot.mjs`) 188–531.

Galerie-Build: JS 556 kB (gzip 145 kB), CSS 155 kB (gzip 21 kB), 24 Schriftdateien (woff2 + woff).

## 8. Visuelle Prüfung (p7)

**Umfang:** zwei volle E2E-Läufe (vor und nach den Korrekturen), jeweils alle 234 Chromium-Screenshots (1920 × 1080,
2560 × 1440, 1280 × 720, Komponenten 960 × 640) sowie alle `xbrowser`-Screenshots in Firefox und WebKit (17 im ersten,
23 im zweiten Lauf) mit dem Read-Werkzeug angesehen – die großen Ansichten einzeln, die Komponenten-Stories als
zugeschnittene Kontaktbögen. Referenz: `shoot.mjs` nach `/private/tmp/claude-501/faf-ui` (23 Ansichten, alle
12 HUD-Ansichten „Layout ok“, HUD-DOM 188–531). Direkt nebeneinander verglichen: `hud-1080-vogt/armee/fabrik-stall/
pause-cvd/fabrik-alles`, `hud-720-fabrik`, `menu-1080`, `skirmish-1080`, `settings-1080-grafik/tasten`, `loading-1080`.

**Checkliste je Bild:** Tokens/Farben (nur Token-Farben, Teamfarben-Modi), Fasen (Panel-/Zell-/Karten-Fasen), Glut-Regel
(≤ 3 Glutflächen; die Gesamtansichten zeigen dieselben Glutflächen wie das Mockup), tabellarische Ziffern (`.num` mit
`tabular-nums` in allen Zahlenspalten), keine abgeschnittenen Texte, Zustände ohne Farbe unterscheidbar (Symbol + Text +
Klasse/Schraffur), Skalierung 1440/720, cvd-Modus.

**Befund und Korrekturen in p7:**

1. *Flow-Details:* Verbraucher-Namen wurden abgeschnitten („Lehrling ×2 · Zapfst…“) – IBM Plex Sans Condensed läuft
   ≈ 15 % breiter als die im Mockup (über `file://` ohne Webfont) greifende Ersatzschrift Avenir Next Condensed.
   Zahlenspalten 3,25/3,5 → 2,75/3 rem, Spaltenabstand 8 → 6 px: Namen jetzt vollständig bei 1080p und 720p.
2. *Alerts:* lange Titel/Metazeilen („Werk freigesprochen: Landwerk II“, 720p-Meta „… alle Baustellen gedrosselt“)
   wurden mit Ellipse gekürzt → umbrechen jetzt auf höchstens zwei Zeilen (Karte wächst nur in der Höhe).
3. *Card-Zellen:* Kurzname mit `line-height: 1` schnitt Unterlängen ab („Lehrling“), der 3-px-Queue-Fortschrittsstrich
   lag über dem Text → höhere Zeilenbox an gleicher Glyphenposition, Name über dem Strich.
4. *Context-Loss-/Sim-Lag-Banner:* `left: 50 %` halbierte die Schrumpfbreite, der Text brach bei schmalen Ansichten
   um („… Sim läuft / weiter“) → Banner `width: max-content`, einzeilig.
5. *Dichtester Fall:* Szenario auf das Mockup `fabrik-alles` angehoben (pausierter Upgrade-Verbraucher mit „1 pausiert“,
   Wiederholen an, 5 Alerts → 3 sichtbar + „4 ältere“).
6. Weitere `xbrowser`-Tags (Command Card Produktion/Befehle, Flow-Details Engpass, Pause-Banner, Ladebildschirm,
   Esc-Menü), damit Card, Flow und Menü-Modal auch in Firefox/WebKit fotografiert werden.

**Begründete Restabweichungen:** Schrift ist Plex statt der Mockup-Ersatzschrift (Texte ≈ 15 % breiter, Kurznamen
„Dampfqu./Erzsp./Glutsp.“); die Galerie-Welt ist ein Platzhalter-Verlauf ohne Weltobjekte (Ringe, Wegpunkte,
Welt-Icons sind Renderer-Sache); Minimap quadratisch statt auf 206 × 186 gestreckt und mit prozeduralem Demo-Terrain;
die Hover-Hervorhebung der Card-Zelle unter dem offenen Tooltip fehlt in statischen Screenshots (kein Zeiger);
Tempo-Knöpfe −/+ im Status, Symbole an Überlauf/Stall-Badges, gesperrte Tabs überall mit Schloss, Replays im
Hauptmenü als gesperrt gezeichnet (ab MS11), Queue-Badge zählt die laufende Einheit mit (6 statt 5); der Firefox-
Range-Knopf ist quadratisch (wie im Mockup, `::-moz-range-thumb` lässt keine Raute zu). Alle Einzelheiten und
Begründungen in den Fragmenten p2–p6.

## 9. Abweichungen (konsolidiert)

Einzelbegründungen in den Fragmenten; hier die Punkte mit Wirkung über den Track hinaus.

1. **Eigenes Paket `@faf/hud` statt `packages/client/src/ui` + `apps/game/src/ui` (ui.md §10).** Begründung: parallele
   Arbeit ohne Berührung von client/game (MS3 läuft), harte Import-Grenze per dependency-cruiser, eigene Tests/Galerie/
   Benchmarks. Empfehlung für MS4: so belassen (siehe §10) – DECISIONS HUD-1.
2. **Locale-Tabellen in `packages/hud/src/i18n/locales/<ns>.{de,en}.json`** statt `content/locales/{de,en}.json`
   (PLAN §2); Schlüssel `ui.<ns>.…` statt `ui.hud.…`/`ui.order.…` aus ui.md §10. Umzug in MS4 (P12) – DECISIONS HUD-2.
3. **Schriften über `@fontsource`** (Plex Sans Condensed 400/500/600/700, Plex Mono 400/600, Latin + Latin-Ext),
   eigene `@font-face` mit `font-display: block` statt der @fontsource-CSS (die `swap` setzt) – DECISIONS HUD-3.
4. **`HudModel` erweitert** um `keyboardLayout` (UI-E6); `reducedMotion` dreiwertig wie die Einstellung.
5. **Scheduler:** zusätzliche Ratenklasse `map` (4 Hz versetzt zu `hot`), Fog als eigene Canvas-Ebene (4 statt 3
   Ebenen) – ui.md §9.2 „eigene Ebenen“; Snapshot ohne rein lokale UI-Zustände (Flow-Details offen, Tooltip, Tab,
   Platzieren, Minimap-Modus).
6. **`computeUiScale` wörtlich nach ui.md §4.1:** unter 1080 px Höhe immer 0,8 (Folge des Exponenten 0,78); eine feinere
   Stufung bräuchte eine ui.md-Änderung.
7. **Soll-Matrix über ui.md §6 hinaus präzisiert:** Tooltip/OrderTooltip und SelectionFilter/IdleButton getrennt,
   MatchStatus „Cap nah“/„Cap erreicht“ getrennt, Minimap „Karten-Kennzahlen“ (UI-E2), Hud-Gesamtansichten.
8. **Bedienung:** Ressourcen-Meter und Befehlsketten-/Queue-Einträge sind `<button>` (Tastatur/Screenreader);
   „Stall droht“/Überlauf mit Symbol-Badge (nie nur Farbe, §8.1); Alerts „Speicher voll“ ohne Sprungknopf, Stall-
   Alerts springen zu den Flow-Details; untätige Fabrik per Rechtsklick auf den Idle-Knopf; Befehlsleiste auch auf der
   Gebäudeseite; Selbstzerstörung nur Strg+Entf (macOS zusätzlich Strg+⌫), B/Alt+B nie.
9. **Layout-Shift-Gate auf Panels** (ui.md §4.4): Textverschiebungen innerhalb fester Panels und die Umordnung des
   Alert-Feeds werden berichtet, nicht gegatet.
10. **p7-Anpassungen an Komponenten-CSS** (Flow-Spalten, Alert-Umbruch, Zellname, Banner-Breite; §8) und
    Zusammenlegungen (§3.2). Die Abdeckungsprüfung ist jetzt standardmäßig streng.
11. **Pfad in den Aufträgen:** `/Users/logge/Documents/Projects/faf-hud` existiert nicht; alle Befehle (auch die
    `verify_commands` aus `TRACK-HUD.json`, die den Pfad wörtlich enthalten) liefen im tatsächlichen Worktree
    `flow-and-fire/.worktrees/faf-hud`. `TRACK-HUD.json` wurde nicht umgeschrieben.
12. **Lint-Ausnahme `docs/design/ui-mockups/**`** (p0): klassische Browser-Skripte der Mockups, vorher 89 `no-undef`
    auch auf `main` – Merge-Hinweis für andere Tracks.

## 10. Übergaben an MS4/MS6/MS9/MS11/MS14

**Empfehlung Paketort (Abweichung von ui.md §10):** `@faf/hud` als eigenes Paket behalten. `packages/client` bindet
es ein (`HudProvider` + `<Hud>` in der Spielseite, Menüs in `apps/game/src/ui/App.tsx`), füllt `HudSnapshot` aus den
Frame-Sektionen und implementiert `HudCommands` gegen `CommandBuilder`/Kamera-/Auswahl-API. Vorteile: die Grenze
„Präsentation importiert nie sim“ bleibt maschinell geprüft (`presentation-never-imports-sim` gilt schon für `hud`),
Galerie/Tests/Benchmarks bleiben lauffähig ohne Spiel, der Client wächst nicht um ≈ 300 Module.

| Meilenstein | Übergabe |
|---|---|
| MS4 | Locale-Dateien nach `content/locales/` verschieben (P12; Generator/Import-Pfad in `src/i18n/tables.ts` anpassen, Typprüfung DE→EN beibehalten, Build-Bruch bei fehlendem Schlüssel). `HudSnapshot` in `packages/client` aus den Frame-Sektionen Eco/Watch/Intents befüllen und `HudScheduler.push` je Sim-Tick aufrufen. `DEFAULT_ACTION_MAP` (`packages/client/src/actions.ts`) an `resolveGridKey`/`resolveStripKey` anpassen (Raster-Schema UI-E1: WASD/S nicht mehr Kamera/Stop, Alt+Raster = Befehle, KeyZ als „Y“ auf DE). Fonts im Spiel unter `/b/<hash>/fonts/` ausliefern (woff2 aus `@fontsource`, `font-display: block`, Preload vor dem ersten HUD-Frame). Ressourcenleiste lesend, Command Card Bau-Seite T1, Platzieren-Status (`card.placing`), Tooltips. |
| MS6 | Auswahl-Panel + Box-Select-Bündelung (§9.3) im Client, Fabrik-Queue-Befehle (`queueAdd/Remove`, Repeat, Rally), Befehlsleiste, Filter/Idle, Gruppen; `useCardHotkeys` durch die Spiel-Tastaturschicht ersetzen (die reinen Funktionen bleiben). |
| MS9 | Alerts aus dem Sim-Ereignisstrom (`pushAlert`, `resolveAlertJump` für die Kamera), Menüs/Lobby/Esc-Menü mit `createMenuController` als Startpunkt, Persistenz der Einstellungen (`sanitizeSettings`), Teamfarben-Modi im Renderer spiegeln. |
| MS11 | Minimap an echte Karte/Fog/Einheiten (`MinimapSnapshot`), Firefox-Zeichenzeit (s. Offene Punkte), Sim-Tempo, Selbstzerstörung/Patrouille, Vet, Replays (Score „Replay speichern“). |
| MS14 | Einstellungen komplett (Autodetect-Benchmark, Audio-Proben), Score-Screen aus Sim-Stats, KI-Stufen/AIx, Context-Loss-Banner. |

## 11. Offene Punkte

- **Firefox-Minimap ≈ 0,8 ms** je Dynamik-Zeichnung (Ziel 0,5 ms nur berichtet): Hebel für MS11 Einheitenpunkte in einen
  eigenen Pixelpuffer + `putImageData` (p5).
- **Style-Kosten der Mehrfachauswahl** (Hauptposten im Chromium-p95 Script + Style/Layout): `--v`/`--vet` vererben sich
  in den `<use>`-Schattenbaum; `@property --v { inherits: false }` oder Wert auf ein Blatt legen spart gemessen
  ≈ 60 % je Kachel-Update (p5). Nicht umgesetzt, weil das Gate grün ist und die Änderung alle Balken-Primitive berührt.
- **Rechtsbündige Werte mit wechselnder Stellenzahl** erzeugen Layout-Shift-Einträge innerhalb fester Panels
  (U+2007-Polsterung wäre die Lösung, p5).
- **Kurznamen „Dampfqu.“, „Erzsp.“, „Glutsp.“** bei P12 mit echter Zellbreite neu prüfen; `fmtBytes` schreibt „KB“
  statt SI-„kB“.
- **Kein Referenz-Laptop:** alle Messwerte lokal (Apple M5 Pro); die Iris-Xe-Messung gehört zu MS4/MS9.
- Replays-/Einweisungs-/Mitwirkende-Seiten, DevConsole, ReplayBar und Cursor gehören nicht zum Track.
