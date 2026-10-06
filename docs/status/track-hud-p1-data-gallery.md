# TRACK-HUD · hud-p1-data-gallery – Roster-/Icon-Daten, Card-Logik, Galerie und Screenshot-Harness

> Stand 2026-09-29 · Welle 0 (parallel zu hud-p0-foundation) · Vertrag: [`docs/plans/TRACK-HUD-contract.md`](../plans/TRACK-HUD-contract.md)

## Ergebnis

| Abnahmepunkt | Status | Nachweis |
|---|---|---|
| `pnpm --filter @faf/hud run gen --check` | ✅ | „4 files up to date“; zusätzlich Test `test/data/gen.test.ts` (idempotent, LF, keine Zeitstempel, `--`-Argument) |
| Tests `packages/hud/test/data` + `apps/hud-gallery/test` | ✅ | 9 Dateien, 81 Tests (über `tools/heavy pnpm exec vitest run packages/hud/test/data apps/hud-gallery/test`) |
| `tsc -b apps/hud-gallery` | ✅ | über `tools/heavy`, inkl. Referenz `packages/hud`; Test-/E2E-/Skriptdateien zusätzlich gegen `tsconfig.tests.json` geprüft |
| eslint + depcruise (`packages/hud`, `apps/hud-gallery`) | ✅ | „no dependency violations found“ |
| `tools/heavy pnpm test:e2e:hud` in chromium/firefox/webkit | ✅ | 68 Stories (primitives + data): **276 bestanden, 138 übersprungen** (Pseudo-Pass und Harness-Selbsttest laufen nur in Chromium), 1,2 min |
| Screenshots angesehen | ✅ | `test-results/hud-gallery/{chromium,firefox,webkit}/*.png` (Icons normal/Ghost/Maske/Teams, Buttons); Befund und Korrekturen unten |
| Preview-Server beendet | ✅ | Playwright-`webServer` beendet sich selbst; kein `vite preview` übrig |

## Teil A – Daten (`packages/hud/scripts`, `packages/hud/src/data`)

### Generator `scripts/gen-data.ts`

Aufruf: `pnpm --filter @faf/hud run gen` (schreibt) bzw. `… run gen --check` (vergleicht, Exit 1 bei Abweichung, ein durchgereichtes `--` wird ignoriert, unbekannte Argumente → Exit 2).

| Quelle | Ausgabe |
|---|---|
| `docs/design/roster.json` + `scripts/unit-texts.json` | `src/data/roster.gen.ts` – `ROSTER: readonly UnitRecord[]`, alle 56 Einheiten in roster.json-Reihenfolge, Experimentals mit `postMvp: true` (MVP = 50) |
| `roster.json` → `buildableBy` | `src/data/build-table.gen.ts` – `BUILD_TABLE`: für jeden Bauer (ENGINEER/FACTORY/COMMAND) die direkt baubaren Typen. Die Kategorieausdrücke wertet das Skript mit `CategoryRegistry`/`compileCategoryExpr`/`matchesMask` aus `@faf/rules` aus; `UPGRADE` ist eine Pseudo-Kategorie ohne Träger, Upgrade-Stufen erscheinen daher nie. `src/data` importiert `@faf/rules` nicht. |
| `content/icons/svg/{icons,states}` (ohne `.selected`) | `src/data/icons.gen.ts` – `ICON_IDS` (59 inkl. 3 Radar-Blips), `GHOST_ICON_IDS` (30 Gebäude), `ICON_SYMBOLS` (`<symbol id="si-<icon>">` bzw. `si-<icon>--ghost`, `<title>` entfernt, Teamfarbe bleibt `var(--team, #2F6FD0)`) |
| dieselben Icons | `src/data/icons-mask.gen.css` – je Grund-Icon `.si-mask-<icon> { --si-mask: url("data:…") }` plus Hilfsklasse `.si-mask` (mask-image aus `--si-mask`, Hintergrund = Teamfarbe) und `.ff-sicon.is-ghost-fallback` |

Determinismus: Einheiten in roster.json-Reihenfolge, Icons nach UTF-16-Codeunits sortiert, LF, abschließender Zeilenumbruch, keine Zeitstempel. Der Generator bricht ab bei fehlenden Texten, Kurznamen > 10 Zeichen, fehlender EN-Adjacency, unbekannten Icons, Slots oder Upgrade-Referenzen und bei `id`-Attributen innerhalb der Icons (Kollision im Sprite).

Abgeleitete Felder je Einheit: `hotbuild {menu, slot, viaUpgrade}` (Slottexte wie „Q (Upgrade: Command Card)“ → `Q`; reine Upgrade-Stufen erben den Slot ihrer Upgrade-Kette, z. B. Landwerk III → `A`), Waffen-Zusammenfassung (DPS-Summe **ohne** Abstich/Overcharge, max./min. Reichweite, Ziel-Layer), Ökonomie mit 0-Defaults, Schild, Tempo (Gebäude 0), Sicht/Radar, `upgradesTo/upgradeFrom`, normalisierte Toggles (`auto_tapshot`, `radar`, `shield`).

**Maskenvariante (ui.md §9.2, Ein-Knoten-Buttons):** In der Data-URL wird das Icon als SVG-`<mask>` gezeichnet – Teamfläche, Konturen, Tech-Kerben (`<rect>`) und T4-Klammern (eckige Linienenden) deckend, die keramikweiße Glyphe ausgespart. Ein einzelnes Element mit Hintergrundfarbe zeigt so Form, Rolle und Stufe. Weil Einzeleinheiten ihren HP-Strich als `::after` tragen (ui.md §9.2), setzt die Klasse nur die Variable `--si-mask`; ein Pseudo-Element nutzt `mask-image: var(--si-mask)`, oder das Element selbst bekommt zusätzlich `.si-mask`. In Chromium, Firefox und WebKit geprüft (Story `strategic-icon--mask`, Tag `xbrowser`).

### Unit-Texte `scripts/unit-texts.json`

Für alle 56 Einheiten (nicht nur die 50 MVP-Einheiten): `short {de,en}` (≤ 10 Zeichen, ohne römische Stufe), `desc {de,en}` (≤ 2 Sätze: Satz 1 Funktion, Satz 2 Gildenton nach faction.md §2.3), `adjacency.en` für die 17 Einheiten mit Nachbarschaftseffekt. Entscheidungen bei zu langen deutschen Namen: **Dampfqu.** (Dampfquelle), **Erzsp.** (Erzspeicher), **Glutsp.** (Glutspeicher), **Tiefenst.** (Tiefenstich, Post-MVP), **Trommel** (Trommelsieb, wie EN); EN **Boiler** (Ember Boiler), **Furnace** (Blast Furnace). Der volle Name steht immer im Tooltip.

### Laufzeit-API (`src/data/index.ts`, über `@faf/hud` exportiert)

| Funktion | Zweck |
|---|---|
| `unitText(id, 'name'|'role'|'short'|'desc'|'adjacency', locale)` | Texte je Locale; `adjacency` = `''` ohne Effekt. Pseudo: DE-Text durch `pseudo()` aus p0; **`short` nur mit Akzenten, ohne Verlängerung/Klammern**, weil 10 Zeichen in jeder Sprache Vertrag der 58-px-Zelle sind. |
| `unitTextKey(id, field)` | P12-Key `unit.core.<id>.<field>` (IDs mit oder ohne `core:`) |
| `getUnit` / `findUnit` / `normalizeTypeId` / `ROSTER` / `MVP_UNITS` | Lookups |
| `unitStats(id)` | HP, Regeneration, Schild, DPS, Reichweite (min/max), Ziel-Layer, Tempo, Sicht, Radar, BP, Kosten, Bauzeit, Speicher, Produktion, Unterhalt (Gebäude aus `economy`, mobile Schilde aus `shield`) |
| `buildTimeS(id, bp)` | `buildTime / bp` (∞ bei bp ≤ 0) |
| `flowDemand(id, bp)` | `{ massPerS, energyPerS }` = Kosten / (buildTime / bp); Beispiel Glutkessel I beim Vogt (BP 10): 6 M/s · 60 E/s |
| `upgradeTarget(id)` | `special.upgradesTo` |
| `StrategicIcon` | `<svg class="ff-si ff-sicon" data-component="StrategicIcon"><use href="#si-…"/></svg>`; Props `typeId` oder `icon`, `state` normal/ghost, `team` self/enemy/neutral (Klassen aus p0-`base.css`), `color` (setzt `--team`), `label` (sonst `aria-hidden`) |
| `IconSprite` / `ensureIconSprite()` | fügt den Sprite (`#ff-si-sprite`, 0 × 0, nicht `display:none`) genau einmal ein |
| `iconOf`, `iconSymbolId`, `hasGhostIcon`, `iconMaskClass`, `ICON_SPRITE` | Hilfen |

### Card-Logik `src/data/card-logic.ts` (ui.md §5.6)

`resolveCardPage(selectedTypeIds, tab?) → { page, menu, headTypeId, maxTab, defaultTab, tab, cells[15] }`, Zellen in `SLOT_CODES`-Reihenfolge (QWERT/ASDFG/ZXCVB, `KeyZ` = Roster-Slot „Z“).

- **Seitenwahl:** leer → `empty`; mindestens ein Bauer → `build` (Vogt/Engineers, Menü „Bau“) bzw. `production` (Landwerk/Luftwerk) des **höchstrangigen Bauers**; nur Gebäude → `structure`; sonst (Kampfeinheiten, auch gemischt mit Gebäuden) → `orders` mit 15 leeren Zellen, die p4 mit Befehlen füllt.
- **Rang:** höchste direkt baubare Stufe → mobile Bauer vor Fabriken (Engineers assistieren Fabriken, nicht umgekehrt) → Vogt vor Engineers → roster.json-Reihenfolge. Gebaut wird aus der Vereinigung aller ausgewählten Bauer desselben Menüs.
- **Tabs:** `maxTab` = Tabs des Menüs (Bau 3, Landwerk 3, Luftwerk 2), `defaultTab` = höchste direkt baubare Stufe der aktuellen Bauer, `tab` wird auf 1…maxTab geklemmt (null/undefined → `defaultTab`). Eine Taste zeigt die höchste Stufe ≤ Tab, sonst eine niedrigere; liegt die niedrigste baubare Stufe über dem Tab (z. B. V Tiegel auf T1), zeigt sie diese – Positionen ändern sich nie, nur Stufen. Tabs über `defaultTab` sind für p4 „gesperrt“ und zeigen dasselbe Raster.
- **Zelle:** `tiers` = Stufen, die die **aktuellen** Bauer direkt bauen; zusätzlich `roleTiers` = Stufen, die irgendein Bauer desselben Menüs direkt baut (= Tabelle „Tech-Stufen je Taste“, Grundlage der Tech-Striche: fehlende Stufe = Lücke). Test reproduziert die Tabelle exakt (Bau mit Meister, Landwerk III, Luftwerk II) und prüft, dass `roleTiers` für Vogt, Lehrling, Geselle und Meister identisch ist.
- **Sperre:** Rolle vorhanden, aber für die aktuellen Bauer nicht direkt baubar → Zelle zeigt die niedrigste Stufe der Rolle mit `locked { reason: 'needBuilderTech' | 'needFactoryUpgrade', tier }` (Vogt: F Schirm II und V Tiegel → `needBuilderTech`, Stufe 2; Landwerk I: D Schürze Stufe 2, F Reißnadel Stufe 3).
- **Upgrade:** nie im Bau-Raster. Fabrikseite: B = `kind 'upgrade'` mit Ziel aus `upgradesTo` (letzte Stufe: leer). Gebäudeseite: B Upgrade (falls `upgradesTo`), G Fähigkeit (falls Toggles), D Pause (falls Upgrade, Toggle oder Energieunterhalt – E13).
- **`str_t2_mex`:** laut `buildableBy` für Geselle/Meister direkt baubar (FA-Verhalten, ui.md §5.6) – die Logik folgt `buildableBy`, nicht dem Slot-Text.
- **Hotbuild-Zyklus** `nextHotbuildTier(slot, currentTier, builders) → { tier, typeId } | null`: nur über die Stufen derselben Rolle, höchste zuerst, dann abwärts, dann wieder die höchste; nie ein anderer Typ.
- Weitere Exporte: `buildableBy`, `canBuild`, `builderMenu`, `isBuilderType`, `headBuilder`, `menuMaxTab`, `rosterSlot`, `slotCodeOf`.
- Post-MVP: G „Großguss“ im Bau-Menü bleibt leer; Experimentals stehen in `ROSTER`/`BUILD_TABLE`, aber nicht in der Card-Logik.

## Teil B – Galerie `apps/hud-gallery`

### Aufbau

| Datei | Inhalt |
|---|---|
| `src/story.ts` | `Story`, `StoryContext`, `defineStories` exakt nach Vertrag; dazu `StoryMeta`, `DEFAULT_VIEWPORTS` (fullscreen 1920 × 1080, component 960 × 640), `DEFAULT_NODE_BUDGET` 700, `STORY_TAGS` |
| `src/registry.ts` | `import.meta.glob('./stories/*.stories.tsx', { eager: true })`; prüft kebab-case-IDs, Pflichtfelder, Tags, eindeutige IDs; merkt je Story den Dateistamm (`source`); Fehler landen in `REGISTRY_ERRORS` (Übersicht, `__HUD_GALLERY__.errors`, Coverage-Test, E2E) statt die Galerie zu sprengen |
| `src/required-states.ts` | Soll-Matrix aller 38 Komponenten des Tracks mit Gruppe (= Story-Datei) und Zuständen; `computeCoverage`, `coverageProblems` |
| `src/app/*` | Hash-Router, Übersicht, Story-Seite, Matrix, Befehlsprotokoll, Fehlergrenze, `window.__HUD_GALLERY__` |
| `src/stories/data.stories.tsx` | StrategicIcon: alle 59 Icons normal, Ghost, Maske (Ein-Knoten), drei Teamfarben-Modi (per `setup` → `model.teams`), Skalierung 1,25 |
| `e2e/*` | `gallery.spec.ts`, `harness.spec.ts`, `support/{env,layout-check}.ts` |
| `test/*` | Coverage, Registry, Routen, Layout-Check-Helfer, App-Smoke-Test (happy-dom) |

**Routen:** `#/` Übersicht (je Komponente alle Soll-Zustände als Links, fehlende durchgestrichen, Zusatzvarianten kursiv, Registry-/Coverage-Warnungen oben) · `#/story/<id>?locale=de|en|pseudo&scale=<n>&teams=house|relation|cvd&motion=reduce&shot=1` · `#/matrix/<Komponente>` (alle Stories einer Komponente als verkleinerte iframes in Soll-Reihenfolge).

**Story-Seite:** frisches `createHudModel()` + `createRecordingCommands()` im `HudProvider`; Query → `setLocale`, `model.scale/teams/reducedMotion` (Story-`scale` als Vorgabe), danach `setup(ctx)` (darf überschreiben), `bindUiSettings(document.documentElement, model)`. Feste Box (`data-story-root`, `contain: layout paint`, damit fixe HUD-Ebenen relativ zur Box liegen); fullscreen mit Platzhalter-Welt, component mit Schachbrett und 24 px Rand. Ohne `shot=1`: Kopfleiste mit Umschaltern (Locale, Teams, Skalierung, Bewegung, Matrix, Shot) und Befehlsprotokoll; mit `shot=1` nur die Box bei 0,0.

**`window.__HUD_GALLERY__`** = `{ ready, route, stories: StoryMeta[], errors: string[], commandLog() }`. `ready` wird nach `document.fonts.ready` + zwei Frames gesetzt und bei jedem Routenwechsel zurückgesetzt. Fehler: Registry, Render (Fehlergrenze), `setup`/Cleanup, unbehandelte Fehler/Rejections.

### Soll-Matrix (Auszug der Festlegungen)

Die Zustandsnamen stehen in `src/required-states.ts` (Welle 1/2 richten ihre Stories danach aus). Festlegungen über ui.md §6 hinaus:
- **Tooltip** (p2): Einheit, Gebäude, Ressource, mit/ohne Nachbarschaft. „Befehl“ ist eine eigene Komponente **OrderTooltip** (p4: Befehl, deaktiviert mit Grund), damit jede Komponente genau einer Story-Datei gehört.
- **SelectionFilter** (Standard, Hover) und **IdleButton** (Standard, Hover, Idle-Zähler 0, Idle-Zähler N) getrennt.
- **CommandCard**: Bau, Produktion, Gebäude, Befehle, leer, Tab T1/T2/T3. **MatchStatus**: „Cap nah“ und „Cap erreicht“ getrennt.
- **Minimap** zusätzlich „Karten-Kennzahlen“ (UI-E2). **Hud**: vogt, armee, fabrik-stall, pause-cvd, dichtester Fall, 1440, 1440-kompakt, 720.
- **Menüs** (p6): MainMenu (Standard, EN, letzte Partie leer), SkirmishSetup (Standard, KI Schwer + AIx, Validierungsfehler, Farbenblind, 1440), Settings (Grafik, Audio, Tasten, Barrierefreiheit, Spiel & Sprache, geändert, Farbenblind-Vorschau, Tasten EN), LoadingScreen (laufend, KI-Worker, Fehler), ScoreScreen (Übersicht, Wirtschaft, Armee, Einheiten, Niederlage, Minimalform, 1440), GameMenu (offen, Aufgeben-Bestätigung).
- **StrategicIcon** (p1): normal, ghost, Maske (Ein-Knoten), Hausfarben, Eigen/Feind, Farbenblind.
- Nicht in diesem Track: ReplayBar, DevConsole/BudgetOverlay, Cursor.

`test/coverage.test.ts`: jede Komponente mit mindestens einer Story muss alle Soll-Zustände haben (Zusatzzustände erlaubt). `FAF_HUD_REQUIRE_ALL=1` (hud-p7) verlangt zusätzlich Stories für alle Komponenten und meldet Stories unbekannter Komponenten. Stand jetzt: 13 von 38 Komponenten mit Stories, alle vollständig.

### Harness-Bedienung

```bash
# Build (schreibt dist/stories.json) + alle drei Browser
/Users/logge/Documents/Projects/flow-and-fire/tools/heavy pnpm test:e2e:hud

# Parallelbetrieb (eigener Port, eigenes Build- und Screenshot-Verzeichnis), nur eine Story-Datei in Chromium
FAF_HUD_E2E_PORT=4484 FAF_HUD_OUT_DIR=dist/top FAF_HUD_SHOT_DIR=test-results/hud-gallery-top \
  /Users/logge/Documents/Projects/flow-and-fire/tools/heavy pnpm --filter @faf/hud-gallery run build
FAF_HUD_E2E_PORT=4484 FAF_HUD_OUT_DIR=dist/top FAF_HUD_SHOT_DIR=test-results/hud-gallery-top \
  /Users/logge/Documents/Projects/flow-and-fire/tools/heavy pnpm --filter @faf/hud-gallery exec playwright test -c playwright.config.ts --project=chromium -g 'grp=top '

# Entwicklung (Vite-Dev-Server, nach Gebrauch beenden)
pnpm --filter @faf/hud-gallery dev   # http://127.0.0.1:5173/#/
```

- **Story-Liste zur Sammelzeit:** Playwright braucht die Tests beim Laden der Spec. Das Vite-Plugin `faf-hud-story-manifest` wertet deshalb nach jedem `vite build` die Registry einmal in Node aus (`runnerImport`) und schreibt `<outDir>/stories.json` (`{ stories, errors }`). Die Spec liest diese Datei; ohne Build bricht sie mit Hinweis ab. Neue Stories brauchen keine Spec-Änderung. Story-Module dürfen beim Import kein DOM anfassen (CSS-Importe sind dort durch ein leeres Modul ersetzt).
- **Testtitel** `grp=<Dateistamm> <id>` (Pseudo-Pass: `… <id> pseudo`, Registry-Prüfung `grp=registry …`, Harness `grp=harness …`); `-g 'grp=top '` (mit Leerzeichen) trifft genau `top.stories.tsx`.
- **Chromium:** Viewport = Story-Viewport, `shot=1&locale=de`, warten auf `ready`, `document.fonts.ready`, Screenshot `SHOT_DIR/chromium/<id>.png`, Layoutprüfung (a)–(e). **Pseudo-Pass** (`locale=pseudo`, nur (b)) für alle fullscreen-Stories und alle Stories ohne Tag `no-pseudo`. **Firefox/WebKit:** jede Story fehlerfrei gerendert; Screenshots nur mit Tag `xbrowser`.
- **Layoutprüfung** (`e2e/support/layout-check.ts`, Portierung von `shoot.mjs`): (a) sichtbare `[data-panel]` überlappen nicht (> 1 px in beiden Achsen) und liegen in der Story-Box (±0,5 px); (b) `[data-fit]` nicht abgeschnitten (`scroll > client + 1`); (c) sichtbarer Text ≥ 11 px × Skalierung, bei Skalierung < 0,95 Untergrenze 10 px, 0,5 px Toleranz wie `shoot.mjs`, Screenreader-Text (≤ 1 × 1 px) ausgenommen; (d) Knoten unter `[data-hud-root]` (fehlt es: unter der Story-Box) ≤ `nodeBudget` (Standard 700) – jedes `<svg>` zählt wie in `shoot.mjs` als `<svg><use>` = 2 Knoten, sein Inhalt nicht; (e) keine `console.error`/`pageerror` und leere `__HUD_GALLERY__.errors`. Messen im Browser, Bewerten in Node (reine Funktionen, unit-getestet). `e2e/harness.spec.ts` injiziert bekannte Fehler (Überlappung, Panel außerhalb, abgeschnittenes `data-fit`, 8-px-Text, Knotenbudget) und erwartet, dass jede Prüfung anschlägt.
- **Artefakte:** `SHOT_DIR/{chromium,firefox,webkit}/<id>.png`, `SHOT_DIR/artifacts/` (Traces bei Fehlern), `SHOT_DIR/results.json`; alles unter `test-results/` (nicht eingecheckt). `perf.spec.ts` (p5) wird nur mit `FAF_HUD_PERF=1` gesammelt.

## Messwerte (lokal, Apple M5 Pro, kein Referenz-Laptop; Messung ≠ Gate, DECISIONS 5/16)

- Galerie-Build: JS 202 kB (gzip 42 kB), CSS 99 kB (gzip 10 kB, davon Masken-CSS 61 kB roh), Fonts als woff2/woff.
- E2E alle drei Browser, 68 Stories: 1,2 min (276 bestanden, 138 übersprungen). Chromium allein: 20 s für 135 Tests; eine Story ≈ 110–190 ms (einzelne Ausreißer bis 3–5 s nur unter Fremdlast).
- Knoten der Icon-Übersichten: 59 Zellen × (Zelle + Paar + 1–2 Icons à 2 + Name) ≈ 300–420, Budget der Datenstories bewusst 1.200 (keine HUD-Ansicht).

## Visuelle Prüfung

Geprüft: `strategic-icon--{normal,ghost,mask,teams-cvd}` in allen drei Browsern, `button--hover`, Übersicht/Story-Seite/Matrix mit Galerie-Chrome. Angepasst: Icons in der Übersicht von 1,75 auf 2,25 rem vergrößert (Glyphen und Kerben sonst kaum lesbar); Masken zeigen Kerben und T4-Klammern jetzt gefüllt statt als Umriss; Galerie-Texte in Stories über `--fs-micro`/`--fs-cap`, damit die Schriftprüfung bei Skalierung 1,25 greift. Ghost: Gebäude nutzen das eigene Ghost-Symbol, mobile Einheiten (ohne Ghost in `content/icons`) werden gedimmt/entsättigt.

## Abweichungen und Entscheidungen

1. **`CardCellSpec` erweitert** um `roleTiers` (Tech-Striche nach ui.md §5.6 unabhängig vom konkreten Bauer); `tiers` bleibt wie beauftragt „für die aktuellen Bauer“. `CardPageSpec` enthält zusätzlich den geklemmten `tab`; `nextHotbuildTier` liefert `{ tier, typeId }` statt nur der Stufe.
2. **Masken-CSS als Variable:** `.si-mask-<icon>` setzt `--si-mask` statt direkt `mask-image`, weil eine Maske auf dem Button auch dessen `::after`-HP-Strich maskieren würde; `.si-mask` wendet sie direkt an. Eingebunden per Seiteneffekt-Import in `src/data/index.ts` (die Datei `styles/index.css` gehört p0).
3. **Tooltip/OrderTooltip, SelectionFilter/IdleButton** in der Soll-Matrix getrennt (siehe oben), damit jede Komponente genau einer Story-Datei gehört.
4. **Gebäudeseite:** D „Pause“ nur bei Upgrade, Toggle oder Energieunterhalt (Mauer, Riegel, Glutkessel haben leere Seiten); die Selbstzerstörung bleibt auf der Befehlsleiste (Entf, ui.md §5.8).
5. **Deutsche Adjacency-Texte** werden beim Generieren um „FA-Relation“ bereinigt (faction.md §2.4); die EN-Übersetzungen lassen den Verweis ebenfalls weg.
6. **Pseudo-Locale für `short`**: nur Akzente, keine Verlängerung (siehe Laufzeit-API).
7. **Story-Manifest über Vite `runnerImport`:** Vite 8 scheitert dort am CSS-Plugin (`cssModulesCache` nicht initialisiert); CSS-Importe werden im Manifest-Lauf deshalb auf ein leeres virtuelles Modul umgelenkt.
8. **`@testing-library/preact`** ist nur Dependency von `@faf/hud`; der App-Smoke-Test der Galerie nutzt `preact/test-utils` (keine neue Dependency).
9. Firefox-Profil-Workaround (`CFFIXED_USER_HOME`) liegt unter `apps/hud-gallery/node_modules/.cache/faf-firefox-home`.

## Hinweise für Welle 1/2

- Stories: `export default defineStories([...])` in `src/stories/<gruppe>.stories.tsx`, Zustandsnamen exakt aus `required-states.ts`; fehlt ein Zustand, schlägt `test/coverage.test.ts` fehl, sobald die Komponente eine Story hat.
- HUD-Panels mit `data-panel`, nicht abschneidbare Beschriftungen mit `data-fit`, Wurzel der Gesamtansicht mit `data-hud-root`; Texte über `--fs-*`-Tokens (Schriftprüfung skaliert mit).
- Card (p4): Raster ausschließlich aus `resolveCardPage`; Striche aus `roleTiers`, hell = `shownTier`, gedimmt = in `roleTiers`, aber nicht in `tiers`; Sperrtext aus `locked.reason/tier`; Kurzname `unitText(id, 'short', locale)` mit `data-fit`.
- Selection (p3): Einzeleinheiten als Ein-Knoten-Button mit `::before { mask-image: var(--si-mask) }` + Klasse `iconMaskClass(icon)`.

## Offene Punkte

- Kurznamen „Dampfqu.“, „Erzsp.“, „Glutsp.“ sind Abkürzungen; bei der Lokalisierung (P12, MS4) ggf. mit der Schriftbreite der 58-px-Zelle neu prüfen.
- `FAF_HUD_REQUIRE_ALL=1` ist bis hud-p7 aus (25 Komponenten ohne Stories).
