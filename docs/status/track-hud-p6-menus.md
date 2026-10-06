# TRACK-HUD · hud-p6-menus – Hauptmenü, Gefecht einrichten, Ladebildschirm, Esc-Menü, Einstellungen, Auswertung

Stand: 2026-09-30 · Branch `track-hud` · Worktree `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-hud`
(die Aufgabe nennt `/Users/logge/Documents/Projects/faf-hud` – dort liegt kein Worktree; `git worktree list` zeigt den
Track-Worktree unter `flow-and-fire/.worktrees/faf-hud`, gearbeitet wurde ausschließlich dort).

## Ergebnis

- Sechs Menüseiten als echte Preact-Komponenten, nur an `HudModel.menus` (Signals) und `HudCommands` gebunden, Markup und
  Klassen nach `docs/design/ui-mockups/{menu,skirmish,loading,settings,score}.html` (+ `assets/menus.css`):
  `MainMenu`, `SkirmishSetup`, `LoadingScreen`, `GameMenu` (Esc, G12), `Settings` (5 Tabs), `ScoreScreen`.
- Typisiertes Model `src/model/menus/*.ts` mit reinen Funktionen (Validierung, Presets, Ladephasen, Skalen),
  `MenuCommands` (23 Befehle) und `createMenuController()` als Referenz-Implementierung der reinen Zustandsbefehle
  (Tabs, Einstellungen, Lobby, Sprache, Esc-Menü) – die Galerie nutzt ihn, das Spiel übernimmt ihn in MS4/MS9.
- i18n-Namespaces `menu`, `skirmish`, `loading`, `gamemenu`, `settings`, `score` vollständig DE/EN (EN per Typ gegen DE
  geprüft), Sprachwechsel live.
- Demo-Daten `src/demo/menus.ts` (deterministisch, seeded PRNG) über das Barrel `menus/main` exportiert.
- 36 Stories in `apps/hud-gallery/src/stories/menus.stories.tsx` (alle Pflichtzustände aus `required-states.ts` +
  1440er-Varianten), Playwright chromium inkl. Pseudo-Locale grün, Screenshots mit den Mockups verglichen.
- 7 Testdateien, 105 Tests in `packages/hud/test/menus` grün; `tsc -b packages/hud apps/hud-gallery`,
  `tsc -p tsconfig.tests.json`, eslint, depcruise (inkl. `no-circular`) und i18n-Scanner grün.

## Gebaut

### `menus.css` und Seitenrahmen
`src/styles/menus.css` portiert `ui-mockups/assets/menus.css` 1:1 (Seitenrahmen `.menu-page/.menu-root/.menu-top/.menu-foot`,
Karten mit 14-px-Fase `.card-m`, vertikale Navigation `.mainnav/.navbtn`, Formularzeilen `.srow`, Kontextkarte `.aside-card`,
Lobby `.lobby/.slot/.opts`, Laden `.load/.phases/.bigbar`, Auswertung `.verdict/.stbl/.chart`) plus Ergänzungen für Zustände,
die die Mockups nicht zeichnen (Farbwähler, Validierungsfehler, Prüfstatus, Tastatur-Ansicht WASD, Farbsimulation).
Komponenten-CSS in `src/menus/{gamemenu,settings,skirmish,score}/*.css`. `styles/index.css` (p0) ist unverändert, die Barrels
importieren `menus.css` selbst. Hintergrund jeder Seite: gedimmtes, prozedurales Terrain (`MenuBackground`, Canvas2D,
einmal beim Mount gezeichnet).

### Komponenten (`src/menus/<name>/`, je Barrel `index.ts`)
- **MainMenu** (`main/`): Wortmarke „Flow & Fire“ (i18n, Titel-Typo, `role=heading`), Tagline, vertikale Navigation
  Gefecht · Replays (gesperrt „ab MS11“, freischaltbar über `main.replaysAvailable`) · Einstellungen · Einweisung (gesperrt,
  Post-MVP) · Mitwirkende, Roving-Tabindex mit ↑/↓/Pos1/Ende (überspringt Gesperrte), Fokus startet auf „Gefecht“,
  Enter/Klick → `navigate(screen)`. Emblem (eigenes SVG: Lot im Gussring mit Glutnaht), Karte „Letzte Partie“
  (Urteil, Gegner/KI-Stufe, Karte, Dauer, „vor 2 Std.“, Replay-Größe; Ansehen → `watchReplay`, Revanche → `rematch`;
  Leerzustand). Fuß: Build, simId, Renderer, Worker-Transport, Preset. DE/EN oben rechts → `setLocale`, Vollbild →
  `toggleFullscreen`.
- **SkirmishSetup** (`skirmish/`): drei Spalten. Links Kartenliste (Setons 1.024 WU, Hollow Ridge 512, Tessera 768,
  Braidwater gesperrt „in Arbeit (M8)“) mit prozeduralen Mini-Vorschauen (Listbox, ↑/↓), Kartenbeschreibung,
  KI-Profilkarte (Reaktion/Micro/Schummeln/Erwartung je Stufe). Mitte große Vorschau (Canvas2D-Terrain + Ressourcen-Rauten)
  mit nummerierten Start-Knöpfen; Klick tauscht/verschiebt den Start des Spielers → `updateSkirmish({slots})`. Rechts
  Häuser (Slot, Name, Fraktion Varkan, Farbwähler als Radio-Raster mit „vergeben“-Markierung, Team; KI-Slot mit Stufe
  Leicht/Normal/Schwer, AIx-Schalter und Regler ×1,0–×2,0 in 0,1) und Regeln (Siegbedingung mit Erklärzeile, Unit-Cap,
  Anfangstempo, Nebel, Teamfarben-Modus mit Zweifarb-Vorschau). Seed-Feld mit Validierung + Würfel (`rerollSeed`).
  Fuß: Prüfstatus (prüft/ok mit simId/Fehler), Liste der Validierungsprobleme (`role=alert`, betroffene Slots rot
  markiert), Zurück (auch Esc) und „Gefecht starten“ (Glut, Enter außerhalb von Feldern) → `startSkirmish(config)` mit der
  vollständigen Konfiguration; bei Problemen oder nicht bestandener Prüfung `aria-disabled` und kein Befehl.
- **LoadingScreen** (`loading/`): Kartenname groß, Beschreibung, Regeln (Siegbedingung, Unit-Cap, Seed), beide Häuser
  mit Bereitschafts-Badge (bereit/lädt/KI-Worker startet/wartet/Fehler), Vorschau mit Starts; fünf Phasen Manifest ·
  Assets · Karte → Sim · Sim-Worker · KI-Worker mit eigenem Balken (`scaleX(var(--v))`, `role=progressbar`), aktuelle Datei
  mit Quelle (Cache/Netz), Prozent, Bytes (`fmtBytes`), Cache-/Netz-Zähler, Gesamtbalken, rotierende Hinweiszeile, Build.
  Fehler: Badge „Laden fehlgeschlagen“ + Ursache, Gesamtbalken kritisch, „Erneut“ (Fokus) → `retryLoading`, „Ins Menü“ →
  `backToMenu`. `phasesFromGameState()` bildet `LoadState` aus `apps/game/src/loading.ts` (nur gelesen, strukturell
  nachgebildet, kein Import) plus Worker-Bereitschaft auf die fünf Phasen ab.
- **GameMenu** (`gamemenu/`): Modal mittig (`z-index: var(--z-modal)` = 50), `role=dialog` + `aria-modal`, Fortsetzen ·
  Einstellungen · Tastenübersicht · Aufgeben · Ins Hauptmenü; Fokusfalle (Tab/Shift+Tab), Fokus auf „Fortsetzen“,
  Esc → `resume`; Aufgeben öffnet eine Bestätigung (`role=alertdialog`, Fokus auf dem sicheren „Weiterspielen“, Esc zurück)
  → `surrender`. Hinweis „Simulation pausiert“ (Einzelspieler) bzw. „läuft weiter“. Fokus kehrt beim Schließen zurück.
- **Settings** (`settings/`): vertikale Tabs (automatische Aktivierung mit ↑/↓/Pos1/Ende → `setSettingsTab`), Zeilen mit
  Label + Erklärung links und p0-Primitiv rechts, geänderte Werte mit Glutpunkt + Screenreader-Zusatz „geändert“,
  Kontextkarte je Tab. Grafik: Autodetect-Kasten (GPU, 3-s-Benchmark-FPS, API/Extensions, „Neu messen“ →
  `runGraphicsBenchmark`), Preset Niedrig/Mittel/Hoch/Ultra (+ „Eigen“ nur als Ergebnis), Render-Skalierung 50–100 %,
  Schatten, Splat-Layer, Partikel-Cap, Bloom, Kantenglättung, Bildrate, Kamera-Wackeln; Karte „Geschätzte Last“ (GPU,
  Main-JS, Draws, Partikel gegen die Budgets aus PLAN §3.4). Audio: sechs Busse, Warn-Ansagen, hörbarer Stall, Ton im
  Hintergrund; Karte Klangprobe (`playSoundSample`). Tasten: Schema Raster/WASD (mit Alt+Shift-Hinweis), Tastatur-Ansicht
  (Raster-, Kamera-, Systemtasten; F-Reihe Esc/F1–F6, Tab, Entf, „,“/„.“; Beschriftung über `keyLabel`, DE zeigt Y auf
  KeyZ; Rasterbeschriftungen aus Roster und Befehlsraster), Tabelle der Sonderkombinationen, Umbelegen „ab C20“ gesperrt;
  Karte Rasterbelegung. Barrierefreiheit: Teamfarben-Modus mit Palettenvorschau, Icons und Farbsimulation
  (Normal/Deutan/Protan/Tritan, Machado 2009), Zustands-Muster, Icon-Kontur, UI-Skalierung Auto/0,8–1,5, Bewegung
  reduzieren, Alert-Blitzen, Alerts als Text (gesperrt an). Spiel & Sprache: Sprache (live), Randschwenk, Tooltips,
  Pause im Hintergrund, Replays automatisch speichern. Jede Änderung → `setSetting(key, value)` mit typisiertem Wert;
  „Standard wiederherstellen“ → `resetSettings`, „Fertig“/Esc → `closeSettings`.
- **ScoreScreen** (`score/`): Urteil groß („Sieg“ / „Lot gebrochen“ + Lore-Zeile), Meta (Spielzeit, Punkte, Effizienz,
  Replay-Größe), Tabs Übersicht/Wirtschaft/Armee/Einheiten (`setScoreTab`). Kennzahltabelle beider Häuser (besserer Wert
  Glut **und** fett, bei „weniger ist besser“ umgedreht, Screenreader-Zusatz „besser“), beste Einheiten (Strategic Icons),
  Ereignisleiste, zwei Verlaufsgraphen je Tab (`ScoreChart`: SVG, **eine** y-Achse für beide Serien, Teamfarben je Modus,
  zweite Serie gestrichelt, Endpunkte + Direktbeschriftung mit Kollisionsvermeidung, Legende, Fadenkreuz-Tooltip bei
  Zeigerbewegung und per ←/→/Pos1/Ende). Einheiten-Tab: Tabelle gebaut/verloren/Abschüsse je Haus. Fuß: Replay speichern
  (danach „gespeichert“), Replay ansehen, Revanche, Hauptmenü. Minimalform (A4): nur Urteil, Spielzeit, Knöpfe.

### Model, Commands, i18n, Demo
- `model/menus/`: `main.ts` (Navigation, Sperren, `nextEnabled`, `agoParts`), `skirmish.ts` (Karten, Slots, Regeln,
  `validateSkirmish`, `canStartSkirmish`, `swapStart`, `slotsForMap`, `patchSkirmish`, `parseSeed`, `clampAix`,
  `compassOf`), `teams.ts` (Haus-/Eigen-Feind-/CVD-Paletten, `teamColorCss`, Farbsimulation), `loading.ts` (Phasen,
  Gewichte, `overallProgress`, `currentPhase`, `phasesFromGameState`), `gamemenu.ts`, `settings.ts` (`SettingsValues`
  mit 31 Schlüsseln, `SETTING_SPECS`, `DEFAULT_SETTINGS`, `GRAPHICS_PRESETS`, `isValidSetting`, `coerceSetting`,
  `applySetting`, `detectPreset`, `resetSettingsValues`, `canResetSettings`, `sanitizeSettings`, `changedSettings`,
  `estimateLoad`), `score.ts` (Zeilen, Serien, Ereignisse, `betterSide`, `sortUnitRows`, `seriesSampleCount`),
  `controller.ts` (`createMenuController`).
- `commands/menus.ts`: `MenuCommands` + `MENU_COMMAND_NAMES` (navigate, setLocale, toggleFullscreen, startSkirmish,
  updateSkirmish, rerollSeed, retryLoading, backToMenu, setSetting, resetSettings, setSettingsTab, openSettings,
  closeSettings, runGraphicsBenchmark, playSoundSample, setScoreTab, saveReplay, watchReplay, rematch, resume,
  askSurrender, surrender, quitToMenu).
- `demo/menus.ts`: Karten, Häuser Ambrecht (Du, Blau, Start 1) gegen Dorne (KI Normal, AIx ×1,3, Rot, Start 5), Presets
  `standard/hardAix/invalid/cvd/checking`, Ladephasen `running/aiWorker/error/ready`, Sieg nach 23:41 mit 30-s-Serien
  (49 Stützstellen, vier Serien), Niederlage (gespiegelt), Minimalform, Settings-Defaults und geänderte Werte.

### Galerie
`menus.stories.tsx`: MainMenu (Standard DE, EN, letzte Partie leer, 1440), SkirmishSetup (Standard, KI Schwer + AIx,
Validierungsfehler, Farbenblind – je 1920×1080 und 2560×1440 bei Skalierung 1,25), LoadingScreen (laufend Phase 2,
KI-Worker, Fehler), GameMenu (offen, Aufgeben-Bestätigung), Settings (fünf Tabs, geändert, Farbenblind-Vorschau, Tasten EN
mit WASD, Tasten 1440), ScoreScreen (vier Tabs, Niederlage, Minimalform, alle vier Tabs zusätzlich bei 2560×1440).
Tag `xbrowser`: MainMenu/Standard, SkirmishSetup/Standard, Settings/Grafik, ScoreScreen/Übersicht. Die Stories sind
interaktiv: Befehle landen im Befehlslog und die reinen Zustandsbefehle wirken über `createMenuController` aufs Model.

## Tests (`packages/hud/test/menus`, happy-dom + rein)

| Datei | Tests | Inhalt |
|---|---|---|
| `main-menu.test.tsx` | 11 | Navigation/Sperren, `nextEnabled`, Fokusstart, ↑/↓/Pos1/Ende, Klick → `navigate`, Gesperrte ohne Befehl, Replays-Freischaltung, Letzte Partie (Replay/Revanche/leer/ohne Replay), Sprachwechsel live (Controller), Pluralformen |
| `game-menu.test.tsx` | 8 | geschlossen = nichts, `aria-modal`/Titel/Reihenfolge, Fokusfalle beidseitig, alle Aktionen mit Argumenten, Esc → `resume` + Fokusrückgabe, Aufgeben-Bestätigung (alertdialog, Fokus, Esc zurück, `surrender`), Controller |
| `loading.test.tsx` | 10 | Phasen/Gewichte, `overallProgress`, `currentPhase`, `phasesFromGameState` (alle Spielphasen, ohne KI, drei Fehlerlagen), Hinweisrotation, Render laufend/KI-Worker/Fehler/bereit, Befehle, EN |
| `skirmish.test.tsx` | 17 | Validierung aller Fehlercodes mit Slots, `swapStart`, Kartenwechsel, Seed/AIx/km/Kompass; Render, `startSkirmish` mit vollständiger Konfiguration (Klick + Enter, nicht aus Feldern), Sperre bei Fehlern/Prüfung, Start-Tausch per Klick, Kartenwahl + ↓, KI-Stufe/AIx-Schalter/Regler, Farbwähler (Radio, Esc), Team, alle Regeln typisiert, Seed, Esc/Zurück, cvd + EN |
| `settings.test.tsx` | 29 | Defaults/Specs/Presets (DECISIONS 17/25), Validierung + Coercion, `applySetting` (Preset ↔ Eigen), Reset behält Sprache, `canResetSettings`, `sanitizeSettings`, `changedSettings`, Lastschätzung, Teamfarben + Farbsimulation, Zeilenlayout (jeder Schlüssel genau einmal), Optionslabels, Tabs (↑/↓/Pos1/Ende), **je Tab jedes Steuerelement → `setSetting(key, value)` mit gültigem, typisiertem Wert**, Zahlen bleiben Zahlen, dirty-Glutpunkt + Reset, Controller-Sync (Teamfarben/Bewegung/Sprache live), Esc/Fertig, Autodetect, Audio-Proben, Tastatur-Ansicht DE und EN/WASD, Palettenvorschau, Spiel-Karte |
| `score.test.tsx` | 22 | `betterSide`, Stützstellen 23:41/30 s, Sortierung, Tab-Inhalte; `niceScale`, `timeTicks`, **eine y-Achse** (`chartGeometry`), `linePath`, `separateLabels`, `indexAtX`, Ereignistexte; Graph: durchgezogen/gestrichelt, eine Tick-Reihe, Endbeschriftung, Legende, Fadenkreuz-Wert per Zeiger und Tastatur; Screen: Urteil/Meta, besserer Wert (Klasse `win` = Glut + fett) inkl. umgedrehter Zeilen, Tabs, Fuß-Befehle, Niederlage, Minimalform, Teamfarben je Modus |
| `controller-demo.test.ts` | 8 | Demo-Karten/Presets/Determinismus/Serienlänge, Controller (Sprache, Settings-Sync, ungültige Werte, Reset, Lobby, Tabs, Esc-Menü, Replay) |

Selbsttest: `tools/heavy pnpm exec vitest run packages/hud/test/menus apps/hud-gallery/test` → 12 Dateien, 128 Tests grün
(davon 105 in `test/menus`); zusätzlich laufen `test/foundation/{i18n,i18n-scanner,model,commands}` grün.

## Messwerte (lokal, Apple M5 Pro; Messung ≠ Gate, DECISIONS 5/16)

- **DOM-Knoten je Story** (Layout-Check, Scope `story-root`, Budget 700 aus ui.md §9.2 – Standardbudget, nicht angehoben):
  Hauptmenü 63–71, Gefecht einrichten 180–187, Ladebildschirm 68–74, Esc-Menü 88–99 (inkl. Hintergrund), Einstellungen
  86–323 (Maximum: Tasten mit Tastatur-Ansicht), Auswertung 23 (Minimalform) – 171.
- **Playwright chromium, Gruppe `menus`:** 72 Tests (36 Stories + 36 Pseudo-Locale-Durchläufe) grün, ≈ 45 s Gesamtlauf,
  0,34–1,17 s je Story (Laden, Fonts, Screenshot, Layout-Check).
- **Vitest `test/menus`:** 105 Tests in ≈ 1,5 s je Datei (happy-dom, `maxWorkers` 1–4).
- Die Menüs liegen außerhalb des HUD-Hotpaths (kein 4–10-Hz-Binding); Canvas-Zeichnungen (Terrain, Vorschau) laufen nur
  bei Mount bzw. Karten-/Spot-Wechsel, der Graph misst seine Größe per ResizeObserver, nie im Update-Pfad.

## Visuelle Prüfung

Mockups (`menu/skirmish/loading/settings/score.html`) per Playwright bei 1920×1080 abfotografiert und mit den
Story-Screenshots (`test-results/hud-gallery-menus/chromium/*.png`) verglichen: Layout, Spalten, Fasen, Typografie,
Farben und Zustände stimmen überein. Unterschiede sind gewollt: Kartenliste mit vier statt drei Einträgen (Tessera,
Braidwater statt „Schlackenfeld“), Medium mit Blob-Schatten und 8 Layern (s. Abweichung 1), Graphen mit anderen
Fake-Kurven und 23:41 statt 24:18, KI-Profil-Texte aus der KI-Doku, die y-Achse wählt 4 oder 5 Intervalle (Armeewert
0–5.000 statt 0–8.000). Pseudo-Locale: keine abgeschnittenen `data-fit`-Beschriftungen.

## Abweichungen und Entscheidungen

1. **Medium-Preset mit 8 Splat-Layern** (Aufgabe nennt „4 Layer“): DECISIONS 25 hat DECISIONS 17 für Medium auf
   8 Layer geändert; Low bleibt bei 4. Blob-Schatten auf Medium, CSM 2 ab Hoch wie DECISIONS 17.
2. **Knotenbudget:** Die Menü-Stories nutzen das Standardbudget 700 (ein früherer Stand hatte 1.600 gesetzt; gemessen
   sind höchstens 323 Knoten, daher zurückgenommen).
3. **„Eigen“** ist kein wählbares Preset, sondern das Ergebnis eigener Grafikänderungen (wird dann ausgewählt angezeigt).
4. **Standard wiederherstellen behält die Sprache** (sonst sperrt ein Reset Leser der anderen Sprache aus); der Knopf ist
   deaktiviert, wenn sich außer der Sprache nichts ändern würde (`canResetSettings`).
5. **Score-Tabs mit manueller Aktivierung** (Pfeile bewegen den Fokus, Enter/Klick wählt; Primitive `Tabs` aus p0),
   Settings-Tabs mit automatischer Aktivierung (↑/↓ wählt sofort) wie in ui.md §7.7 für vertikale Listen.
6. **Start-Tausch** gilt für den (ersten) menschlichen Slot; ein belegter Start tauscht beide Häuser, ein freier
   verschiebt nur den Spieler. Kartenwechsel repariert ungültige Starts auf die Standard-Paarung (erste/gegenüberliegende).
7. **Gleiche Farbe** ist nur im Modus Hausfarben ein Fehler (Eigen/Feind und CVD färben unabhängig von der Hausfarbe).
8. **`createMenuController`** (nicht im Aufgabentext) implementiert die reinen Zustandsbefehle gegen das Model; Galerie
   und Tests benutzen ihn, das Spiel kann ihn übernehmen. Er typisiert nur die benötigten Sektionen strukturell
   (`MenuControllerSections`), damit `model/index.ts` ↔ `model/menus` keinen Zyklus bildet (depcruise `no-circular`).
9. **Barrel `menus/main`** exportiert zusätzlich die gemeinsamen Menü-Helfer (`shared/`: Emblem, MapCanvas, Terrain,
   Fokus-Helfer, Label-Funktionen) und alle Menü-Demo-Daten („über die Menü-Barrels exportiert“).
10. **Esc-Menü in der Galerie** liegt über dem fertigen Ladebildschirm als Platzhalter für die pausierte Partie (ein
    echtes HUD-Szenario gehört p5; so bleiben die Stories unabhängig).
11. **KeyboardView** nutzt die Kurzlabels aus `hud/card/labels.ts` (p4) und die Roster-Daten, damit die Tastatur-Ansicht nie
    von der Command Card abweicht.
12. **Lastschätzung** ist eine Hochrechnung aus SPK4 (Annahme Iris Xe ≈ 4–5 × M5 Pro, DECISIONS 17), keine Messung – so
    auch im UI beschriftet.

## Bekannte Lücken / Hinweise

- Replays-, Einweisungs- und Mitwirkenden-Seiten sind nicht Teil dieses Pakets; das Hauptmenü sendet nur `navigate`.
- Persistenz (localStorage), Vollbild, Audio-Proben und Benchmark führt das Spiel aus (MS4/MS6/MS9); die Menüs senden
  nur Befehle. `sanitizeSettings` ist für das Einlesen gespeicherter Werte vorbereitet.
- Canvas-Zeichnungen (Terrain, Ressourcen) sind nur per Screenshot geprüft; happy-dom hat keinen 2D-Kontext.
- Firefox/WebKit wurden für die Menü-Gruppe in diesem Lauf nicht gestartet (Abnahme verlangt chromium); die
  `xbrowser`-Stories laufen im Gesamtlauf von p7 mit.
- `fmtBytes` (p0) schreibt „KB“; das Mockup zeigt „118 KB“, DE-SI wäre „kB“ – nicht geändert (fremder Eigentümer).
