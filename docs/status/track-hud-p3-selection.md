# TRACK-HUD · hud-p3-selection – Auswahl-Panel, Befehlskette, Fabrik-Queue

> Stand 2026-09-30 · Welle 1 (parallel zu hud-p2-top und hud-p4-card) · Vertrag: [`docs/plans/TRACK-HUD-contract.md`](../plans/TRACK-HUD-contract.md)
> Worktree: `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-hud` (Branch `track-hud`; der im Auftrag genannte Pfad `/Users/logge/Documents/Projects/faf-hud` existiert nicht, der Worktree liegt unter `flow-and-fire/.worktrees/`).

## Ergebnis

| Abnahmepunkt | Status | Nachweis |
|---|---|---|
| `tools/heavy pnpm exec vitest run packages/hud/test/selection` | ✅ | 5 Dateien, 63 Tests |
| Foundation- + Galerie-Tests (i18n-Parität, Scanner, Coverage) | ✅ | zusammen mit selection: 20 Dateien, 229 Tests grün |
| `tsc -b packages/hud apps/hud-gallery` | ✅ | ohne Fehler; Testdateien + Story zusätzlich gegen `tsconfig.tests.json` geprüft |
| eslint + depcruise (`packages/hud`, `apps/hud-gallery`) | ✅ | „no dependency violations found“ |
| Scanner-Test (keine hartkodierten UI-Strings) | ✅ | `test/foundation/i18n-scanner.test.ts` |
| Stories in Chromium ohne Layoutfehler | ✅ | `-g 'grp=selection '`: 38/38 (19 Stories + Pseudo-Pass) |
| Firefox/WebKit | ✅ | 76 bestanden, 38 übersprungen (Pseudo nur Chromium) |
| Screenshots gegen `hud.html?sel=army` / `sel=factory` verglichen | ✅ | siehe „Visuelle Prüfung“ |

## Komponenten (`packages/hud/src/hud/selection/`)

| Datei | Inhalt |
|---|---|
| `SelectionPanel.tsx` | `SelectionPanel` (Panel `data-panel="selection"`, `data-component="SelectionPanel"`), Kopf „Auswahl · N Einheiten · M Typen“ / „Auswahl · 1 Einheit“ / „Auswahl · Landwerk I“ / „Auswahl · 3 Fabriken“, rechts „Gruppe N“ (Taste 0 = Gruppe 10) bzw. Haus-Label, bei leerer Auswahl „leer“. Kopftexte sind computed Signals (Textbindung, kein Re-Render bei 4-Hz-HP). Rendert nur bei Wechsel von `selection.kind`. |
| `SelectionEmpty.tsx` | Leer: „Nichts ausgewählt“ + Kurzhilfe mit Key-Primitiven (H, `.`, Strg+A; Beschriftung nach `keyboardLayout`). |
| `UnitDetail.tsx` + `parts.tsx` | Einzeln: Porträt 104 px (großes Strategic Icon, CMD/T1–T3/EXP, 5 Vet-Rauten), Name + Rolle (`unitText`, beim Vogt „· Tod = Niederlage“), Balken HP (Zahlen, warn < 55 %, crit < 30 % schraffiert), Schild (nur mit `shield`), Vet (Mass „420 / 1.000 M“, Höchststufe), Abstich gegen 7.500 E (ab Schwelle „bereit · … E“ in Glut); Wertezeile DPS/RW/Tempo/Sicht, BP und Regen nur wenn > 0; rechts `OrderQueue`. Struktur hängt an `singleStructureKey`, alles andere ist gebunden. |
| `OrderQueue.tsx` | Befehlskette: laufender Befehl (Glutkante, 2-px-Fortschrittslinie per `scaleX(var(--v))`, Wert als Textbindung), gehängte nummeriert, ab 7 Befehlen 5 Zeilen + „+N weitere Befehle“, leer „Keine Befehle · untätig“. Zeilen sind `<button>`; ein delegierter Listener: Klick → `jumpToOrder(i)`, Rechtsklick → `removeOrder(i)` (Kontextmenü immer unterdrückt). Re-Render nur bei neuem `orderChainKey`. |
| `SelectionMulti.tsx` | `SelectionGroups` (Typ-Kacheln 68 × 76, eine feste Zeile, ≤ 24 bzw. Platzzahl, sonst „+N“), `SelectionUnits` (≤ 60, je Einheit genau ein `<button>`), `SelectionSummary` (Σ DPS, Σ Mass, Ø HP, Tempo der langsamsten, Tab-Hinweis), `SelectionMulti` (Körper). |
| `FactoryDetail.tsx` | Fabrik: Porträt, Name/Rolle, HP (gebunden), BP „20 + 15 = 35“ (Balken = Eigenanteil), Helfer „3 (Lehrling ×3, Assist)“, Nachbarschaft „−9 % E“ (Grünspan), Rally-Status. |
| `FactoryQueue.tsx` | Jetzt-Block (Icon, Name, „noch 3,1 s“, Balken aus `factory.progress` per transform, Prozent groß; pausiert: gedimmt + schraffiert, „pausiert“; Leerlauf mit Hinweis), Blöcke ≤ 10 (sonst 9 + „+N“), erster Block Glutrahmen, ↻ an jedem Block bei Wiederholen, Steuerung Wiederholen/Pause (`aria-pressed`)/Rally/Leeren (bei leerer Queue deaktiviert), Hilfezeile mit Key-Primitiven. Kopf „Fabrik-Queue“, bei Mehrfach-Fabrik rechts „3 Fabriken · Aufträge reihum“. `data-state` = running/repeat/paused/empty/multi. |
| `labels.ts`, `events.ts`, `capacity.ts` | Textbausteine (reine Funktionen), `pointerMods()` (Klick/Kontextmenü → `ClickMods`), Slot-Kapazität per `ResizeObserver`. |
| `selection.css` | Port der Mockup-Abschnitte „Auswahl-Panel“, „Typ-Kacheln“, „Fabrik-Queue“, „Einzeleinheiten“; Abweichungen im Dateikopf markiert. |
| `index.ts` | Barrel (importiert `selection.css`, exportiert Komponenten, `orderRows`, `factoryQueueState`, `selectionHeadTitle/End`, `ORDER_CHAIN_ICONS`, `orderChainLabel/Value` und die Demo-Daten). Generische Hilfsnamen (`Meter`, `Portrait`, `gridCapacity` …) bleiben intern, damit `export *` in `src/index.ts` nicht mit anderen Gruppen kollidiert. |

### Modifikator-Klicks (ui.md §7.3)

| Fläche | Klick | Shift | Strg/⌘ | Rechtsklick | Shift+Rechts |
|---|---|---|---|---|---|
| Typ-Kachel | `selectType` | `deselectType` | `selectDamagedOfType` | nichts (Menü unterdrückt) | – |
| Einzeleinheit | `selectUnit(h, mods)` | dito, `shift: true` | dito, `ctrl: true` | `selectUnit(h, {…, button: 2})` | dito |
| Queue-Block | `queueAdd(t, 1, false)` | `queueAdd(t, 5, false)` | `queueAdd(t, 1, true)` (Strg+Shift: 5) | `queueRemove(t, 1)` | `queueRemove(t, 5)` |
| Befehlskette | `jumpToOrder(i)` | – | – | `removeOrder(i)` | – |

macOS: Strg+Klick kommt als `contextmenu` mit `button 0` → wird als Strg+Linksklick gewertet (sonst würde „an den Anfang“ zu „−1“).

## Performance und DOM-Budget (ui.md §9)

- **Struktur vs. heiße Werte:** Mehrfachauswahl rendert nur bei neuem `selection.multi` (oder geänderter Slot-Kapazität). `multiStats` (4 Hz) schreibt ein `effect` direkt: `--v`/`--vet` (CSS-Variablen), `is-warn`/`is-crit`/`is-focus` (nur bei Zustandswechsel, keine redundanten Attribut-Schreibzugriffe), `textContent` der Beschädigt-Zahl; Summen sind Textbindungen. Fokus-Typ (Tab) ebenfalls ohne Re-Render. Einzelansicht/Fabrik: HP, Schild, Vet, Abstich, laufender Befehl, `factory.progress` (10 Hz) und `remainingS` sind Signal-Bindungen.
- **Tests:** Render-Zähler über `options.diffed` (0 Renders bei 8 × `multiStats`, 4 × Einzel-Update, 10 × Fabrikfortschritt, HP-Update der Fabrik), `MutationObserver`: nur Textknoten, `style`, `class`, `aria-current`.
- **Knoten:** Kachel = `<button>` + `<svg><use>` + Zahl + Beschädigt-Zahl = 5 (HP-Balken `::after`, Spur im `::before`-Hintergrund, Vet-Rauten `::after` der Beschädigt-Zahl per Maske + `clip-path`). Einzeleinheit = 1 (Icon `::before` mit `mask-image: var(--si-mask)` aus `icons-mask.gen.css`, HP-Strich `::after`, Spur als Hintergrund). **Grenzfall 60 Einheiten + 24 Typen: Panel ≤ 210 Knoten** (Test, gezählt wie `shoot.mjs`); Armee-Ansicht < 80.
- **Messwerte (lokal, Apple M5 Pro, kein Referenz-Laptop; Messung ≠ Gate, DECISIONS 5/16):** `aggregateMultiStats` über 500 Einheiten/24 Typen ≈ 7 µs je 4-Hz-Update (Node); 4-Hz-Update der Grenzfall-Ansicht inkl. Aggregation von 500 Samples und aller DOM-Schreibzugriffe ≈ 0,43 ms in happy-dom (Browser deutlich schneller). Die Browser-Messung mit Scheduler (p95 ≤ 1 ms) gehört zu hud-p5 (`bench`).

## Demo-Daten (`src/demo/selection.ts`, über das Gruppen-Barrel exportiert)

`applySelectionDemo(model, scenario)` mit `SELECTION_DEMO_SCENARIOS`: `none`, `commander` (Vogt, Befehlskette 5 Einträge, Abstich 2.840/7.500, Vet 1), `commanderLongChain` (9 Befehle), `engineerRunning`, `engineerIdle`, `tankDamaged` (Punze 81/300), `army` (19 Einheiten/5 Typen wie `hud.html?sel=army`), `armyFocus`, `edge` (60 Einheiten/24 Typen, seeded PRNG), `factory` (Landwerk I, BP 20 + 15 durch 3 assistierende Lehrlinge, Queue Punze ×5/Kelle ×2/Lehrling/Sieb, 64 %, noch 3,1 s), `factoryRepeat`, `factoryPaused`, `factoryEmpty`, `factoryLong` (12 Blöcke), `factoryMulti` (3 Fabriken). Dazu `tickSelectionDemo(model, step, samples?)` (deterministischer Takt nur der heißen Werte, für Live-Demo/Benchmark in p5) und die Einzelbausteine `demoCommanderDetail()`, `demoArmySelection()`, `demoEdgeSelection()`, `demoLandFactoryDetail()` … Kein `Math.random`.

## Model/Commands/i18n

- `model/selection.ts`: `singleStructureKey` ohne das Merkmal „Vet mit Mass-Angabe“ – der Vet-Text wechselt nur die Form, nicht die Struktur (sonst Re-Render beim Aufstieg). Sonst unverändert (Typen, `aggregateMultiStats`, `tileAction`, `nextFocusType`, `visibleCount` aus p0 genutzt).
- `model/factory.ts`, `commands/selection.ts`, `commands/factory.ts`: unverändert genutzt (`queueClick`, `factoryStructureKey`, `queueIsEmpty`).
- i18n: `selection.*.json` + `factory.*.json` um `ui.selection.groups/units/sum.title/detail` und `ui.factory.now/list/controls/detail` ergänzt (DE/EN, Parität per Test). Tastenwörter (Klick, Rechtsklick, Strg) aus `common`, Einheitennamen/Rollen aus `unitText`.

## Stories (`apps/hud-gallery/src/stories/selection.stories.tsx`)

Alle im Dock-Mittelfeld bei 1080p (84,75 rem = 1356 × 220 px, Viewport 1404 × 268). Soll-Zustände vollständig (Coverage-Test grün):
SelectionPanel `leer`, `einzeln`, `mehrfach`, `Fabrik`, `Kachel-Fokus` + Zusatz `einzeln (beschädigt)`, `Grenzfall 60 Einheiten / 24 Typen` (`nodeBudget: 210`), `mehrfach (1440, 1,25)`, `Fabrik (EN)`; OrderQueue `laufend`, `gehängt`, `leer` + `gehängt (+N)`; FactoryQueue `laufend`, `Wiederholen an`, `pausiert`, `leer`, `Mehrfach-Fabrik` + `mehr als 10 Blöcke`. Tag `xbrowser` für einzeln/mehrfach/Fabrik.

## Visuelle Prüfung

Screenshots `test-results/hud-gallery-selection/{chromium,firefox,webkit}/*.png` angesehen und mit den Mockup-Panels (`hud.html?sel=army|factory|vogt|none&clean=1`, per Playwright ausgeschnitten) verglichen: Aufbau, Maße, Farben und Zustände stimmen überein (Kacheln mit Glutrahmen am Fokus-Typ, HP-Balken, „2 <50 %“, Einzeleinheiten mit Masken-Icon und HP-Strich, Summenzeile mit Tab-Hinweis; Fabrik mit Porträt, BP-Zeile, Helfern, Nachbarschaft, Jetzt-Block, Blöcken, Steuerung). Nach der ersten Runde korrigiert: Vet-Rauten der Kacheln wurden bei vorhandener Beschädigt-Zahl aus der Kachel geschoben → jetzt absolut rechts positioniert (6-px-Raster, 5 Stufen); doppeltes Icon im laufenden Befehl ohne Zieltyp entfernt.

## Abweichungen und Entscheidungen

1. **Feste Slots statt „bis 60 sichtbar“:** Bei 1080p passt im 220-px-Dock unter einer Kachelreihe genau **eine** Reihe Einzeleinheiten (≈ 37 bei 1356 px; zwei Reihen bräuchten 78 px, verfügbar sind ≈ 66 px). Nach ui.md §4.4 („Kein Panel ändert seine Größe … feste Slots und ein Zähler +N“) messen `SelectionGroups`/`SelectionUnits` ihren Platz einmal per `ResizeObserver` (kein Layout-Lesen im Update-Pfad) und zeigen `Kapazität − 1` Elemente + „+N“. Kacheln: immer genau eine Reihe (1080p: 18 Plätze). Ohne Messung (happy-dom, erster Frame) gelten die Obergrenzen 24/60 – darauf prüft der Knotenbudget-Test. Der Grenzfall zeigt bei 1080p also 17 Kacheln + „+7“ und 36 Einheiten + „+24“.
2. **Vet-Rauten auf Kacheln** zeigen nur die erreichten Stufen (bis 5), keine hohlen Platzhalter wie das Mockup (3 Plätze) – mit einem Pseudo-Element ist nur eine Füllung möglich.
3. **Befehlsketten-Zeilen und Queue-Blöcke sind `<button>`** (Mockup: `div`), damit Klick/Rechtsklick/Tastatur funktionieren; laufender Befehl zusätzlich mit 2-px-Fortschrittslinie.
4. **Fabrik-Queue mit Kopfzeile** („Fabrik-Queue“, rechts Mehrfach-Hinweis) und Abständen 4 px statt 6 px, damit fünf Zeilen in 180 px passen; Hilfezeile ergänzt um „Strg+Klick an den Anfang“.
5. **Wertezeile:** BP und Regeneration nur bei Werten > 0 (Kampfeinheiten zeigen sonst „BP 0 · Regen 0/s“).
6. **Tab (Fokus-Typ wechseln)** wird nicht im Panel abgefangen; die Tastaturschichten gehören p4. Das Panel markiert den Fokus-Typ (`is-focus`, `aria-current`) und bietet `nextFocusType` (Model) + `focusType` (Command).
7. **Rechtsklick auf Typ-Kacheln** löst keinen Befehl aus (ui.md definiert keinen), unterdrückt aber das Browser-Menü.

## Offene Punkte / Übergaben

- hud-p5 (Wurzel/Scheduler): `SelectionPanel` in die Dock-Mittelspalte setzen; `tickSelectionDemo` für die Live-Demo/den Benchmark nutzen; Box-Select-Bündelung (ui.md §9.3) liegt beim Scheduler.
- hud-p4: Tab/Shift+Tab → `focusType(nextFocusType(...))` in der Tastatur-Auflösung.
