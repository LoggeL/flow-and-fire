# TRACK-HUD · p0 Fundament (hud-p0-foundation)

Stand: 2026-09-29 · Branch `track-hud` · Worktree `/Users/logge/Documents/Projects/faf-hud`

## Ergebnis

- **Paket `@faf/hud`** (`packages/hud`) mit Preact 10 + `@preact/signals` 2, Quell-Export `.` → `src/index.ts`, `./styles.css` → `src/styles/index.css`. `src/` importiert kein Workspace-Paket und von npm nur preact, `@preact/signals`, `@fontsource/*` (dep-cruiser `hud-deps`, `hud-npm-deps`; Gegenprobe mit absichtlicher Verletzung schlägt an).
- **Galerie-Paket `@faf/hud-gallery`** (`apps/hud-gallery`): `package.json`, `tsconfig.json`, `src/stories/primitives.stories.tsx` (Rest der Galerie: p1).
- **Einmal `pnpm install`** im Repo-Root (Welle 0), ohne Auflösungsprobleme (minimumReleaseAge griff nicht, happy-dom statt jsdom).
- Selbsttest: `tsc -b packages/hud` und `tsc -b apps/hud-gallery` grün, 10 Testdateien in `packages/hud/test/foundation` mit 143 Tests grün, `eslint` + `depcruise` auf `packages/hud apps/hud-gallery` grün, Scanner-Test aktiv.

## Installierte Versionen

| Paket | Version | wo |
|---|---|---|
| preact | 10.29.8 | hud, hud-gallery |
| @preact/signals | 2.11.2 | hud, hud-gallery |
| @fontsource/ibm-plex-sans-condensed | 5.3.0 | hud |
| @fontsource/ibm-plex-mono | 5.3.0 | hud |
| @testing-library/preact | 3.2.4 (zieht @testing-library/dom 8.20.1) | hud (dev) |
| happy-dom | 20.14.5 | hud (dev) |
| tsx 4.23.15, typescript ~5.9.3, @types/node ^24.19.0, @faf/rules workspace | Root-Versionen | hud (dev) |
| vite 8.3.1, @preact/preset-vite 2.10.6, @babel/core 7.29.7, @playwright/test 1.63.0 | wie apps/game | hud-gallery (dev) |

## Verträge (Kurzfassung)

- **Model** (`src/model/<sektion>.ts`): je Sektion Typen, Signals, `create<Sektion>Section()` mit Defaults und reine Ableitungen.
  - `eco`: `ResourceSignals` (stored, capacity, income, demand, served, flow, incomeBySource, storageByBuilding + abgeleitet `net`, `status`), `EcoSection` (consumers, detailsOpen, interactive, stallPriority), `net()`, `resourceStatus()` (Stall = flow < 1; Überlauf = voll und Netto > 0; droht = Netto < 0 und leer in < 10 s), `secondsToEmpty/Full()`.
  - `status` (`MatchSection`, `capLevel()` gelb ab 90 %), `alerts` (`ALERT_DEFS`: 10 Typen mit Stufe, Intervall, Sprungziel, Sound; `ALERT_STALE_S` 20, `ALERT_EXPIRE_S` 60, `ALERT_MAX_VISIBLE` 3), `tooltip`, `selection` (+ `hpLevel()` 55 %/30 %, `MultiStats` als Typed Arrays), `factory`, `card`, `orders` (+ `ORDER_GRID`: feste Plätze, Selbstzerstörung ohne Rastertaste, R4), `strip`, `minimap` (SoA-Einheiten), `snapshot` (nur Frame-Identität, p5 ergänzt), `menus/{main,skirmish,loading,gamemenu,settings,score}` (inkl. `DEFAULT_SETTINGS`, `changedSettings()`).
  - `model/index.ts`: `HudModel` (locale = das globale i18n-Signal, teams, scale, reducedMotion, **keyboardLayout** (Ergänzung, UI-E6), alle Sektionen, `menus`), `createHudModel()`, `HudProvider`, `useHud()`, `useCommands()` (Fehler außerhalb des Providers).
- **Commands** (`src/commands/<sektion>.ts`): Interfaces je Sektion plus Laufzeit-Namensliste `<SEKTION>_COMMAND_NAMES` (per `satisfies` gegen das Interface geprüft); `HudCommands` = Schnittmenge aller, `COMMAND_NAMES` mit Vollständigkeitsprüfung zur Compile-Zeit (`CommandNamesComplete`). `createNoopCommands()`, `createRecordingCommands(impl?)` (protokolliert und delegiert optional, z. B. für Stories). Modifikatoren: `Mods`, `ClickMods` (`button 0|2`), `modsFromEvent()` (⌘ = Strg), `clickModsFromEvent()`. **Erweitert ein Eigentümer ein Interface, muss er den Namen in die Liste seiner Sektion aufnehmen** – sonst tsc-Fehler.
- **i18n** (`src/i18n`): Tabellen `locales/<ns>.de.json`/`.en.json` für 18 Namespaces; `common` gefüllt (53 Schlüssel: Zurück, Schließen, Ja/Nein, An/Aus, Einheiten-Plural, Stufen, Tastenbezeichner …), alle anderen `{}`. `MsgKey` = Vereinigung der DE-Schlüssel, EN als `Record<keyof DE, string>` typisiert (fehlender EN-Schlüssel = tsc-Fehler). `t(key, params?)`, `tn(base, n, params?)` (`.one`/`.other`), `tDynamic()` für zur Laufzeit gebildete Schlüssel, `locale`-Signal, `setLocale()`, `pseudo()` (Akzente, +30 % sichtbare Länge, Klammern, Platzhalter bleiben). Zahlparameter werden locale-gerecht formatiert.
  - **Regel (neu, im Test erzwungen):** Schlüssel eines Namespace beginnen mit `ui.<ns>.` (z. B. `ui.eco.flow`, `ui.orders.move`), damit sich Eigentümer nicht überschneiden; JSON 2 Leerzeichen eingerückt, LF, Zeilenende.
- **Format** (`src/format`): `fmtInt`, `fmtDec`, `fmtNum`, `fmtSigned` (U+2212, `+`, `±` bei 0), `fmtPct` (DE mit geschütztem Leerzeichen „72 %“), `fmtRate`, `fmtTime` (`mm:ss`, ab 60 min `h:mm:ss`), `fmtBytes` (SI: „38,2 MB“); Intl-Formatter je Locale/Optionen gecacht; Standard-Locale aus dem Signal (reaktiv in Komponenten).
- **Styles** (`src/styles`): `tokens.css` 1:1 aus den Mockups (Test vergleicht alle Regeln/Variablen/Werte), `base.css` = Portierung von `ff.css` (Test: jede `ff-*`-Klasse und jede Deklaration vorhanden) plus Ergänzungen (s. u.), `fonts.css` (Plex Sans Condensed 400/500/600/700, Mono 400/600, Latin + Latin-Ext, `font-display: block`; per Vite-Build geprüft: 24 Font-Dateien werden aufgelöst), `index.css`. `applyUiSettings(root, {scale, teams, reducedMotion})`, `bindUiSettings(root, model)`, `autoScale(h)` in `src/ui/uiSettings.ts`.
- **Primitive** (`src/ui`, alle mit `data-component` + `data-testid`, optionale Props akzeptieren `undefined`): Button, Tabs/Tab (Pfeiltasten), Segmented (Radiogruppe), Switch, Check (inkl. gemischt), Range (`--v`), Select, Input, Bar (Signal → `--v` + warn/crit-Klassen ohne Re-Render), Badge, Key (Beschriftung nach Layout), Vet, Panel/PanelHead (`data-panel`, `data-fit`), LineIcon (SVG-Sprite `<symbol id="gi-…">`, einmalig ins `body` eingefügt, `<svg><use>`), LevelSymbol, ResourceGlyph, TooltipFrame, Num (formatierter String als computed Signal → Textbindung, schreibt nur bei geändertem String, kein Re-Render). Statische Demo-Zustände über `demoState` (`is-hover`, `is-pressed`, `is-focus`).
- **Tasten** (`src/ui/keys.ts`): `SlotCode`, `GRID_ROWS`, `SLOT_CODES`, `slotPosition()`, `keyLabel(code, layout)` für `de`/`en`/`fr` (DE: KeyZ → Y, KeyY → Z; Sondertasten Entf/Strg/Pos1 …), `detectLayout(nav?)` (Layout-Map, sonst `navigator.language`).
- **Demo** (`src/demo/core.ts`): `mulberry32`, `createDemoRng`, `DEMO_SEED`, `range`, `int`, `pick`, `shuffle`, `chance` (erste Werte im Test festgenagelt). `demo/index.ts` exportiert nur `core`; Gruppen exportieren ihre Demo-Daten bis Welle 2 über ihr eigenes Barrel.
- **Barrels**: `src/index.ts` re-exportiert model, commands, i18n, format, ui, data (p1), `hud/{top,selection,card,strip,minimap,root}`, `menus/{main,skirmish,loading,gamemenu,settings,score}`, scheduler, demo; die Gruppen-Barrels sind leere Module.
- **Test-Support** (`test/support/index.tsx`): `renderWithHud(ui, {model?, commands?, locale?})` (liefert `model`, `commands`, `log`, `clearLog`), automatisches `cleanup` + Locale-Reset + echte Timer nach jedem Test, `flushSignals(update?)` (Batch + `act`), `fakeClock(startMs)` (Timer, `Date`, `performance`, rAF), `lastCall()`, Re-Export von `fireEvent`, `screen`, `within`, `act`.

## Tests (packages/hud/test/foundation)

`i18n.test.ts` (Schlüssel-Parität je Namespace in beide Richtungen, Präfix, Platzhalter-Parität, keine leeren Werte, Plural-Paare, JSON-Format, t/tn/tDynamic, Pseudo +30 %), `i18n-scanner.test.ts` (TypeScript-Compiler-API; Selbsttest mit Fixture + Lauf über alle `src/**/*.tsx`), `format.test.ts`, `keys.test.ts`, `model.test.ts` (Eco-Regeln, Alert-Tabelle gegen ui.md §5.11, Befehlsraster, Defaults), `commands.test.ts`, `demo.test.ts`, `styles.test.ts` (Tokens 1:1, ff.css-Portierung, Fonts), `primitives.test.tsx` (Klassen/aria/Zustände/Events aller Primitive, Signal-Bindung ohne Re-Render, MutationObserver-Zählung bei Num), `provider.test.tsx` (Provider, Locale-Wechsel, Support-Helfer, UI-Settings).

## Root-Änderungen (minimal, nur ergänzt)

```diff
# tsconfig.json
+    { "path": "packages/hud" },
+    { "path": "apps/hud-gallery" },
# tsconfig.tests.json (include)
+    "packages/*/test/**/*.tsx",
+    "apps/*/test/**/*.tsx",
+    "apps/*/e2e/**/*.ts",
+    "apps/*/playwright.config.ts",
# vitest.config.ts
+  // JSX in *.test.tsx (packages/hud) uses the Preact automatic runtime, like tsconfig.base.json.
+  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
-    include: ['{packages,apps,tools}/*/test/**/*.test.ts'],
+    include: ['{packages,apps,tools}/*/test/**/*.test.{ts,tsx}'],
# eslint.config.js
+      'docs/design/ui-mockups/**',                   (ignores, s. Abweichung 10)
+      'packages/hud/src/**/*.{ts,tsx}',            (Browser-Globals)
+      '**/test/**/*.tsx',                            (Node-Globals)
+      'apps/hud-gallery/e2e/**/*.ts',
+      'apps/hud-gallery/*.config.ts',
+      'packages/hud/scripts/**/*.ts',
+      'packages/hud/bench/**/*.ts',
# .dependency-cruiser.cjs
+    onlyWorkspaceDeps('hud-deps', 'hud', []),
+    { name: 'hud-npm-deps', … from '^packages/hud/src/' → npm nur preact, @preact/signals(-core), @fontsource/* },
+    { name: 'hud-gallery-deps', … from '^apps/hud-gallery/src/' → Workspace nur @faf/hud },
-      from: { path: '^packages/(render|client|ai)/' },     (presentation-never-imports-sim)
+      from: { path: '^packages/(render|client|ai|hud)/' },
# package.json (nur Skripte)
+    "test:e2e:hud": "pnpm --filter @faf/hud-gallery run test:e2e",
+    "bench:hud": "pnpm --filter @faf/hud run bench && pnpm --filter @faf/hud-gallery run bench:browser"
# .gitignore
+apps/hud-gallery/results/*.json
```

`pnpm-lock.yaml`: +745/−2 Zeilen (neue Importer `packages/hud`, `apps/hud-gallery`, happy-dom, testing-library, fontsource). `packages/*/bench/**/*.ts` stand schon in `tsconfig.tests.json`.

## Abweichungen und Entscheidungen

1. **Vitest-JSX:** Die Root-`tsconfig.json` hat `files: []`, daher sah Vite/oxc die Preact-JSX-Einstellung nicht und erzeugte `react/jsx-dev-runtime`-Importe (per Smoke-Test festgestellt). Lösung: `oxc.jsx` in `vitest.config.ts`.
2. **fonts.css** deklariert die `@font-face`-Regeln selbst (Pfade `../../node_modules/@fontsource/…/files/*.woff2`), statt die @fontsource-CSS zu importieren, weil diese `font-display: swap` setzt und ui.md §3.2/§9.2 `block` verlangt. Subsets Latin + Latin-Ext (Latin enthält U+2212 und ↑↓).
3. **HudModel.keyboardLayout** zusätzlich zum Vertrag (Beschriftung der Rastertasten je Modell, UI-E6). `HudModel.locale` ist bewusst das globale i18n-Signal, damit `t()` reaktiv bleibt; `reducedMotion` ist `'system' | 'on' | 'off'` wie in den Einstellungen (ui.md §8.4).
4. **i18n-Präfix `ui.<ns>.`** als Test-Regel (Vertrag nennt nur „volle Pfade“); verhindert Schlüssel-Kollisionen zwischen Eigentümern. ui.md §10 nennt Beispiele wie `ui.hud.eco.flow`/`ui.order.patrol` – im Track heißen sie `ui.eco.flow`/`ui.orders.patrol`.
5. **base.css-Ergänzungen** gegenüber `ff.css` (als „added“ markiert): Zustände, die ui.md §6 verlangt, die Mockups aber nicht zeichnen (Hover/Fokus/Deaktiviert für Segmented, Switch, Check, Range, Input, Select; `is-pressed`; Danger-Hover), Warn/Krit für alle Balkenarten (Mockup nur HP), Key-/Vet-Töne (ok/info/warn/crit/ember), Panel-Fasen s/l, Tooltip-Farben ohne Inline-Styles, `data-motion` (reduce/full) und `data-teams="house"`.
6. **Bewegung reduzieren:** `data-motion="reduce"` setzt Dauern auf 0 und schaltet Animation/Transition ab; `data-motion="full"` stellt sie auch gegen `prefers-reduced-motion` wieder her; ohne Attribut folgt die UI dem System.
7. **Scanner-Ausnahme:** Kommentar `i18n-ignore: <grund>` auf derselben oder der vorherigen Zeile (in JSX als `{/* i18n-ignore: … */}`); ein leerer Grund zählt nicht. Geprüfte Attribute: aria-label, aria-description, aria-roledescription, aria-valuetext, title, placeholder, alt.
8. **`bench:hud` ist absichtlich unvollständig**, bis p5 in Welle 2 die Skripte `bench` (@faf/hud) und `bench:browser` (@faf/hud-gallery) anlegt.
9. Story-IDs der Primitive: `<komponente>--<zustand>` mit ASCII-Slugs (`button--gedrueckt`, `tab--ausgewaehlt`, `badge--crit`); Zustandsnamen exakt wie in `required-states.ts`.
10. **Lint-Ausnahme für die Mockups:** `pnpm lint` scheiterte bereits auf dem Branch-Stand (auch `main`) mit 89 `no-undef`-Fehlern in `docs/design/ui-mockups/{assets,tools}/*.js` (klassische Browser-Skripte über `file://`, kein Projektcode). `eslint.config.js` ignoriert `docs/design/ui-mockups/**` jetzt; danach ist `pnpm lint` grün. Andere Tracks haben dieselbe Lücke (Merge-Hinweis für den Integrator).

## Abschlussprüfung (Repo-weit, über das Gate, nach Fertigstellung von p1)

| Befehl | Ergebnis |
|---|---|
| `tools/heavy pnpm typecheck` (`tsc -b` + `tsc -p tsconfig.tests.json`) | grün, keine Fehler (auch nicht aus p1-Dateien) |
| `tools/heavy pnpm lint` (eslint ganzes Repo + depcruise) | grün nach Abweichung 10; vorher 89 Fehler ausschließlich in `docs/design/ui-mockups` (nicht aus p0/p1) |
| `tools/heavy pnpm exec vitest run packages/hud apps/hud-gallery` | 19 Testdateien, 224 Tests grün (davon p0: 10 Dateien, 143 Tests) |
| `tsc -b packages/hud apps/hud-gallery` | grün |
| eslint + depcruise auf `packages/hud apps/hud-gallery` | grün (162 Module) |

Keine Fehler aus p1-Dateien zu melden. E2E (`test:e2e:hud`) ist Abnahme von p1 und wurde hier nicht erneut gestartet.
