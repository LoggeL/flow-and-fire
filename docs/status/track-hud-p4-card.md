# TRACK-HUD · hud-p4-card – Command Card, Befehlsleiste, Tastatur-Schichten, Filter/Idle/Gruppen

> Stand 2026-09-30 · Welle 1 (parallel zu hud-p2-top und hud-p3-selection) · Vertrag: [`docs/plans/TRACK-HUD-contract.md`](../plans/TRACK-HUD-contract.md)
> Worktree: `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-hud` (Branch `track-hud`). Der im Auftrag genannte Pfad `/Users/logge/Documents/Projects/faf-hud` existiert nicht; der Worktree `track-hud` liegt unter `flow-and-fire/.worktrees/`.

## Ergebnis

| Abnahmepunkt | Status | Nachweis |
|---|---|---|
| `tools/heavy pnpm exec vitest run packages/hud/test/card` | ✅ | 7 Dateien, 162 Tests |
| `tsc -b packages/hud` + `tsc -b apps/hud-gallery` | ✅ | fehlerfrei |
| `tools/heavy tsc -p tsconfig.tests.json --noEmit` | ✅ | fehlerfrei (auch die Testdateien dieses Pakets) |
| eslint (eigene Dateien) + depcruise `packages/hud apps/hud-gallery` | ✅ | „no dependency violations found (242 modules)“ |
| Scanner-Test (`test/foundation/i18n-scanner.test.ts`), i18n-Paritätstest | ✅ | 2 bzw. 68 Tests grün |
| Galerie-Build `FAF_HUD_OUT_DIR=dist/card` | ✅ | 180 Stories im Manifest, 0 Registry-Fehler |
| Playwright Chromium `-g 'grp=card '` (Port 4486) inkl. Pseudo-Locale | ✅ | **112 bestanden** (56 Stories + 56 Pseudo-Durchläufe), 17 s |
| Screenshots gegen `hud.html?sel=vogt|factory|army` verglichen | ✅ | siehe „Visuelle Prüfung“ |

## Gebaut

### `src/hud/card/` (Barrel `index.ts`, CSS `card.css`)

| Datei | Inhalt |
|---|---|
| `CommandCard.tsx` | Panel 324 × 220 px (`data-panel="card"`), Kopf je Seite („Bau · Vogt“, „Produktion · Landwerk I“, „Gebäude · Zapfstelle I“, „Befehle · N Einheiten“, „Command Card“), bei Befehlen rechts „Feuermodus: …“. Raster 5 × 3 ausschließlich aus `resolveCardPage` (über `cardSpec`). `role="grid"` mit drei `role="row"` (`display: contents`), eine Tab-Stelle (roving tabindex), Pfeile/Pos1/Ende bewegen den Fokus, `stopPropagation` verhindert Kameraschwenk. **Ein** delegierter Listener je Panel für Klick, Rechtsklick (`button 2`), Hover und Fokus (ui.md §9.2). Klick → `cardActivate(slot, mods)`; auf der Befehlsseite `activateOrder(id, mods)`; gesperrte, leere und Cap-deaktivierte Zellen senden nichts, eine laufende Selbstzerstörung ist per Klick abbrechbar. |
| `CardCell.tsx` | Präsentationskomponente je Zelle: Taste oben links (`keyLabel` nach Layout, DE unten Y X C V B), Strategic Icon bzw. Linien-Icon, Kurzname (`data-fit`), Tech-Striche, Queue-Badge (ersetzt die Striche, „99+“), Schloss links, Fortschrittsstrich (`--p` per Effekt, 10 Hz ohne Re-Render), Toggle-Raute, Zyklus-Punkte, Countdown-Sekunden als Signal-Text. Zustände Standard/Hover/Gedrückt/Aktiv/Fokus/Queue-Badge/Fortschritt/Tech-Striche/Gesperrt/Deaktiviert/Leer/Gefahr/Countdown; `aria-label` immer mit Taste und ggf. Sperr-/Deaktivierungsgrund. |
| `cells.ts` | Reine Ableitung `cellViews(spec, inputs)` → 15 `CellView` (Spec aus p1 + Queue, Platzieren, Unit-Cap, Befehlszustände, Countdown), `tierStripes`, `cellActionable`. |
| `TechTabs.tsx` | T1…Tmax des Menüs (Luftwerk nur T1/T2), höchste direkt baubare Stufe vorgewählt, höhere gesperrt (Schloss, Titel „Tech-Stufe 2 gesperrt – ab T2: Geselle (T2-Engineer)“ bzw. „… Landwerk freisprechen“), Klick → `setTab`. |
| `OrderBar.tsx`, `OrderButton.tsx` | Befehlsleiste rechtsbündig, Gruppen [Q W E R T] [A S D F G] [Y X C ·], Hinweis „Befehle Alt+“ (WASD-Schema: Alt ⇧ +). Sichtbar bei Bau-, Produktions- und Gebäudeseite, sonst leerer Container (`data-visible="false"`). Feste Plätze auch deaktiviert. Zustände Standard/Hover/Scharf/An/Gemischt/Zyklus (Punkte)/Deaktiviert (Grund im `aria-label`)/Fokus/Gefahr/Countdown, Zähl-Badge (Boden angreifen). Order-Zustände kommen mit 4 Hz: Bar und Card lesen einen berechneten Fingerabdruck (`orderStatesKey`) und rendern nur bei sichtbarer Änderung neu (Test: 0 DOM-Mutationen bei inhaltsgleichem Neuschreiben). |
| `OrderTooltip.tsx` | Auf `TooltipFrame`: Icon, Name, Tastenkappe (Rasterseite: Taste, sonst Alt+Taste, Selbstzerstörung Strg+Entf bzw. macOS zusätzlich Strg+⌫), Verhalten, Zustand (scharf, Modus „Feuer frei → Nur erwidern“, An/Aus/Gemischt, Countdown, fähige Einheiten), Grund bei deaktiviert, Beschreibung, bei Stop auf Bauseiten der Hinweis „Stop über Alt+S“ (R5), Fuß „Feature … · ab MS…“. |
| `gridKeys.ts` | Reine Funktionen `resolveGridKey(input, ctx)` und `shouldPreventDefault(input, ctx, action)` nach ui.md §7.2 (Details unten), `keyInputFromEvent`, `isTextTarget`, `isSelfDestructKey`. |
| `useCardHotkeys.ts` | Optionaler Hook (Galerie): bindet keydown/keyup an `resolveGridKey` + `resolveStripKey` und die HudCommands (`handleHotkey`, `gridKeyContext`, `dispatchGridAction`, `dispatchStripAction` einzeln exportiert). |
| `labels.ts` | Texte: `cardHeadText`, `lockText`, `orderKeysText`, `orderKeyCap`, `orderShort`, `cellText` (Pseudo nur Akzente, s. u.), `isMacPlatform`, `selfDestructKeys`. |
| `tooltipTarget.ts` | Hover/Fokus setzt `model.tooltip.target` (Einheit mit Bau-BP und Modus build/factory, Sperre, Deaktivierungsgrund – bzw. Befehl) mit Anker „card“; Löschen nur des eigenen Ziels; kein Neusetzen beim Wandern über Kindelemente. |
| `spec.ts` | (aus p1 übernommen) `cardSpec`, `resolveCardSpec`, `isTabLocked`, `orderBarVisible`. |

### Tastatur-Schichten (`resolveGridKey`)

Reihenfolge: (1) Textfeld → alles durch, (2) Modal → durch, (3) Befehlsmodus: Esc → `cancel` (im Leerlauf gehört Esc der globalen Schicht), (6, vorgezogen weil keine Rastertaste) Strg/⌘+Entf, auf macOS zusätzlich Strg+⌫ → `selfDestruct` (ohne Auswahl nicht), (7a) Pfeile → `camera`, Strg/⌘+Buchstabe → nie Raster, (7b) WASD-Schema: W/A/S/D → `camera` vor dem Raster, (4) Alt+Rastertaste → Befehlsraster (WASD-Schema auf Bauseiten: Alt = Zelle, Alt+⇧ = Befehl), (5) Rastertaste → Seite: Bau/Produktion/Gebäude → `card`, Befehlsseite → `order`; leere Zellen → `passthrough('emptyCell')`. B und Alt+B lösen nie die Selbstzerstörung aus, V ist frei, S bei Bauern ist Luftwerk, Stop über Alt+S. Gesperrte, Cap-deaktivierte und deaktivierte Ziele werden „geschluckt“ (`passthrough` mit Grund, aber `preventDefault`). `shouldPreventDefault`: jede Alt+Rastertaste (auch ohne Ziel), `keyup` von Alt, jede verarbeitete Taste; nie in Textfeldern.

`resolveStripKey` (`src/hud/strip/stripKeys.ts`): F2/F3/F4/F6 (⇧ = Auswahl filtern), `.`/⇧`.`/`,`, 1–0 abrufen (⇧ ergänzen), Alt+Zahl speichern, ⇧+Alt+Zahl hinzufügen; Strg+Zahl bleibt beim Browser.

### `src/hud/strip/` (Barrel `index.ts`, CSS `strip.css`)

- `SelectionFilter` (`data-panel="filters"`): vier 34-px-Knöpfe F2/F3/F4/F6 → `filter(kind, shift)`, Idle-Knopf rechts in derselben Zeile (wie Mockup).
- `IdleButton`: Glut-Badge nur > 0 („99+“), Klick → `selectIdleEngineer(false)`, ⇧ → `true`, Rechtsklick → `selectIdleFactory()`; Beschriftung nennt beide Zähler.
- `ControlGroups` (`data-panel="groups"`): 10 Plätze 52 × 34 mit Taste, Icon, Anzahl; leer/belegt/aktiv; Klick → `recallGroup(i, mods)`, Rechtsklick → `saveGroup(i, false)`, ⇧+Rechtsklick → `saveGroup(i, true)`.
- `Strip`: Leiste über dem Dock (Filter | Gruppen fest linksbündig | Befehlsleiste), für die Gesamtansicht in p5.

### Model, Commands, i18n, Demo

- `model/card.ts`: neu `buildPower` (BP inkl. Assist für den Flow-Bedarf im Tooltip, `null` = eigene BP des Kopf-Bauers) und `CELL_FLASH_MS = 140`.
- `model/orders.ts`: neu `ORDER_TEXT` (Name/Kurzlabel/Beschreibung je Befehl), `FIRE_STATE_TEXT`, `ABILITY_TEXT`, `abilityOfToggle`, `orderUsesAlt`, `orderStatesKey`, `SELF_DESTRUCT_SECONDS`. Die bestehende `ORDER_DEFS`-Tabelle (p0) ist gegen ui.md §5.8 getestet (Slot, Icon, Verhalten, Feature-ID, Kurzlabel).
- Commands: keine neuen Befehle nötig (`cardActivate`, `setTab`, `cancelMode`, `activateOrder`, `filter`, `selectIdleEngineer`, `selectIdleFactory`, `recallGroup`, `saveGroup`).
- i18n (DE/EN vollständig): `card` +10 Schlüssel (Tab-Titel, Sperr-/Deaktivierungs-Labels, „Upgrade läuft“, Bedienhinweise), `orders` +6 (Alt+⇧, Stop-Hinweis, Tooltip-Zeilen), `strip` +5 (Idle-/Gruppen-Labels).
- `src/demo/card.ts`: 13 Szenarien (`CARD_DEMOS`: leer, Vogt T1, T2-/T3-Engineer, gemischte Bauer, Landwerk I mit Badges 5/2/1/1 + 64 %, Luftwerk, Zapfstelle, Horcher mit Radar an, Armee mit scharfem Angriff und Badge 3, Unit-Cap, Platzieren W, Selbstzerstörung 3 s), `DEMO_GROUPS` (1–4 belegt), `applyCardDemo`, `applyStripDemo` (Gruppe 2 aktiv, Idle 0/3) und `createCardDemoCommands` (Galerie: schreibt das Modell wie das Spiel – Tab, Platzieren, Queue ±1/±5, scharf/Toggle/Zyklus, Countdown, Abbruch, Gruppen, 140-ms-Blitz). Export bis Welle 2 über das Card-Barrel.

### Galerie `apps/hud-gallery/src/stories/card.stories.tsx`

56 Stories, alle Soll-Zustände aus `required-states.ts` (CommandCard 8, CardCell 12, OrderBar 2, OrderButton 10, OrderTooltip 2, SelectionFilter 2, IdleButton 4, ControlGroups 4) plus Zusatzvarianten: „T3 auf Tab T1“, gemischte Bauer, Luftwerk, Gebäude Fähigkeit, Unit-Cap, Platzieren, Selbstzerstörung, **„Tastatur DE vs EN“** (zwei Cards nebeneinander, Y/Z-Beschriftung), OrderBar „Fabrik“ und drei Vollbild-Dock-Ansichten (`command-card--dock-vogt|dock-fabrik|dock-armee`) zum Vergleich mit dem Mockup. Interaktive Stories nutzen `createCardDemoCommands` + `useCardHotkeys` (Tasten, Klicks, Rechtsklicks wirken sichtbar, das Befehlsprotokoll zeichnet auf).

## Tests (`packages/hud/test/card`)

| Datei | Inhalt |
|---|---|
| `command-card.test.tsx` (19) | Vogt/Landwerk I/Luftwerk I/Zapfstelle/Horcher/Befehle/leer gegen ui.md §5.6 (Kopf, Slots, Kurznamen, Tastenbeschriftung DE/EN, Striche, Schlösser mit Sperrtext, Badges, Upgrade, Fortschritt 10 Hz ohne Re-Render); Tab-Wechsel beim Meister ändert nur Stufen (gleiche Slots, gleiche Rolle laut `hotbuild.slot`), gesperrte Tabs senden nichts; Klick/⇧/Strg/⌘/Rechtsklick/⇧+Rechtsklick → `cardActivate`-Argumente; gesperrt/leer/Cap senden nichts, Upgrade trotz Cap; Befehlsseite → `activateOrder`; Countdown-Sekunden + Abbruch; Platzieren aktiv, Blitz; Tooltip-Ziele (BP 10 bzw. 35, Modus, Befehl, Tastaturfokus); `role=grid`/rows/gridcells, eine Tab-Stelle, Pfeil-/Pos1/Ende-Navigation. |
| `grid-keys.test.ts` (80) | **55 Fälle** der `resolveGridKey`-Matrix (Schichten §7.2, Modifikatoren §7.3, R3/R4/R5, KeyZ auf DE, KeyY kein Raster, Alt+S bei Bauern, B/Alt+B nie Selbstzerstörung, Strg+Entf/⌘+Entf/Strg+⌫ nur macOS, WASD-Schema inkl. Alt/Alt+⇧, Textfeld, Modal, Esc je Modus, Wiederholung, keyup), Querschnitt „B nie Selbstzerstörung“ über alle Seiten × Modifikatoren, `shouldPreventDefault`, 13 Fälle `resolveStripKey`. |
| `order-bar.test.tsx` (18) | Sichtbarkeit je Seite, Reihenfolge/Gruppen/feste Plätze, Tasten und `aria-label`, Zustände aus der Demo, Klick/Rechtsklick/deaktiviert, Countdown, Hover → Tooltip-Ziel, 0 Mutationen bei 4-Hz-Neuschreiben; OrderButton-Zustände; OrderTooltip (Taste je Seite, Grund, R5-Hinweis, macOS-Kombination, Zustandstexte). |
| `strip.test.tsx` (9) | Filter F2/F3/F4/F6 + ⇧, Idle-Badge nur > 0 und „99+“, Idle-Klicks inkl. Rechtsklick, Gruppen leer/belegt/aktiv, Klick/⇧-Klick/Rechtsklick/⇧+Rechtsklick, Strip-Aufbau. |
| `orders-model.test.ts` (26) | `ORDER_DEFS` gegen die Tabelle ui.md §5.8, Kurzlabels ≤ 10 Zeichen in DE/EN/Pseudo, Gruppen der Leiste, Köpfe, Sperrtexte, Tastenhinweise, `cellViews`. |
| `hotkeys.test.tsx` (7) | `handleHotkey` gegen Modell + Commands (Raster, Alt+S, Alt+B verhindert, Esc im Platzieren, Strg+Entf, Strip-Tasten, Textfeld, Esc-Menü, Alt-keyup), `useCardHotkeys` bindet/entbindet, Demo-Seiten, Demo-Commands. |
| `perf.test.tsx` (3) | Update-Pfade (s. Messwerte). |

## Messwerte (lokal, Apple M5 Pro; Messung ≠ Gate, DECISIONS 5/16)

- 10-Hz-Fortschritt: genau **ein** `style`-Schreibzugriff je Update auf dem laufenden Zellstrich, kein Re-Render (Test). happy-dom: Median 0,01 ms je Update.
- 4-Hz-Befehlszustände mit gleichem Inhalt: 0 DOM-Mutationen (Test).
- Auswahlwechsel (Card + Befehlsleiste + Gruppen neu, Ereignis): happy-dom Median ≈ 0,9 ms (happy-dom ist deutlich langsamer als ein Browser-DOM; Browser-Messung im Demo-Pfad folgt mit p5 `perf.spec.ts`).
- 1-Hz-Gruppenzahl: nur die geänderte Gruppe wird im DOM berührt (Test).
- Knoten (Layoutprüfung Chromium): Card Bau 124, Produktion 103, Befehle 86; Dock-Ansicht Card + Strip 250 / 229 / 147.
- E2E Chromium `grp=card`: 112 Tests in 17 s.

## Visuelle Prüfung

Mockup `hud.html?sel=vogt|factory|army&clean=1` (1920 × 1080) und die Dock-Stories nebeneinander verglichen (Leiste und Card): Positionen, Größen, Farben, Badges, Striche, Schlösser, Befehlsleiste, Gruppen und Idle-Badge stimmen überein. Unterschiede sind gewollt: Plex Sans Condensed statt Avenir (Kurznamen „Dampfqu.“, „Erzsp.“, „Glutsp.“ aus p1), Schloss-Symbol an allen gesperrten Tabs (Mockup nur beim Landwerk), scharfer Angriff in der Armee-Demo. Nach der Sichtprüfung korrigiert: Idle-Badge wurde durch `contain: paint` der Filterzeile abgeschnitten (jetzt `contain: layout style`), Tech-Striche nicht direkt baubarer Stufen waren zu dunkel (jetzt wie Mockup, direkt baubare zusätzlich heller), Hover der Gefahr-Knöpfe im Demo-Zustand, Tastenkappe im Befehls-Tooltip zeigt nur die Taste.

## Abweichungen und Entscheidungen

1. **Befehlsleiste auch auf der Gebäudeseite** sichtbar (p1-Entscheidung übernommen): Selbstzerstörung und Stop liegen bei Gebäuden dort; im Raster stehen nur B Upgrade, G Fähigkeit, D Pause.
2. **Tech-Striche mit vier Zuständen:** hell = gezeigte Stufe, Mockup-Grau = Stufe der Rolle, die die aktuellen Bauer nicht direkt bauen, heller Graustrich (`i.in`, Ergänzung) = ebenfalls direkt baubar, Lücke = Stufe existiert nicht. Striche erst ab zwei Stufen (Mockup-Regel `tiersFor`).
3. **Pseudo-Locale für Zell-Kurzlabels** (Befehle, Upgrade, Pause, Fähigkeit): nur Akzente, keine Verlängerung/Klammern – dieselbe Regel wie p1 für `unitText(…, 'short')`, weil ≤ 10 Zeichen in jeder Sprache Vertrag der 58-px-Zelle ist.
4. **Kopf der Befehlsseite:** Titel `flex: none`, der Feuermodus rechts weicht mit Ellipse (in Pseudo sonst Überlauf); der Titel bleibt `data-fit`.
5. **Fortschrittsstrich** nur auf der Produktionsseite für Zellen mit Queue > 0; Upgrade-Fortschritt, wenn das Spiel `queueCounts[<Zieltyp>]` setzt. Wert über `card.progress` (10 Hz).
6. **Unit-Cap** deaktiviert Einheiten-Zellen auf Bau- und Produktionsseite (Gebäude zählen zum Cap), nicht das Upgrade.
7. **Tooltips:** Card und Leiste setzen nur `model.tooltip.target` (Anker „card“); die Tooltip-Schicht (p2/p5) rendert. `OrderTooltip` ist exportiert und für Ziele `kind: 'order'` gedacht; Gebäude-Fähigkeit/Pause zeigen den Befehls-Tooltip.
8. **Untätige Fabrik** per Rechtsklick auf den Idle-Knopf (Taste „,“): Ein zweiter Knopf passt nicht in die 216-px-Zeile über der Minimap (4 × 34 + 48 px + Abstände).
9. **Kamera:** `resolveGridKey` liefert `camera`-Aktionen, `useCardHotkeys` löst aber nichts aus (kein HudCommand für Kameraschwenk; die Spielkamera behandelt Pfeile/WASD selbst).
10. **Gebäudeseite:** Klick/Taste auf B/G/D → `cardActivate('KeyB'|'KeyG'|'KeyD')` (einheitlich für alle Card-Seiten); das Spiel ordnet Upgrade/Fähigkeit/Pause zu.
11. **Geschluckte Tasten:** gesperrte, Cap- oder befehlsdeaktivierte Ziele fallen nicht durch (nur leere Zellen, §7.2), bekommen aber `preventDefault`; Tastenwiederholung löst keine Rasteraktion aus.
12. **Alt auf Zellen:** `cardActivate` erhält immer `alt: false` (Alt hat auf Zellen keine Bedeutung, im WASD-Schema ist es nur Teil der Kombination); bei Alt+⇧ im WASD-Schema erhält der Befehl `shift: false`.
13. **Barrel-Kollision:** `unitName`/`unitShort` aus `labels.ts` werden nicht exportiert (p2 exportiert bereits `unitName`); Tooltip-Helfer heißt `sameTooltipTarget`.
14. **Gesperrte Tabs** zeigen auf allen Seiten das Schloss (Mockup nur beim Landwerk).

## Bekannte Lücken / Hinweise

- Firefox/WebKit wurden für `grp=card` nicht gestartet (Abnahme verlangt Chromium); keine Story trägt `xbrowser`.
- Browser-Messung „≤ 1 ms bei 500 Einheiten“ gehört zur Gesamtansicht (p5 `perf.spec.ts`); hier nur happy-dom-Messung und strukturelle Garantien.
- Strg+Zahl mit Tastatursperre im Vollbild und die Alt+Zahl-E2E-Matrix je Browser/OS bleiben beim Spiel (MS4/MS6).
- Der 140-ms-Blitz und der Countdown-Takt kommen vom Spiel (`flashSlot`, `selfDestructCountdown`); die Demo-Commands setzen den Countdown statisch auf 5 s.
