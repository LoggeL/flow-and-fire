# ms3-p4-client-game – Selektion (C3), Control Groups (C7), Shift-Queue + Wegpunktlinien, Strategic-Zoom-/Icon-/Decal-Anbindung (C2/G19), Blueprint-HMR, Panzer-Standardszene (MS3, Welle 2)

Stand 2026-09-30. Feature-IDs (Client-/Spiel-Anteil): **C3** (Einheitenauswahl & Lebensbalken), **C7** (Control Groups),
**C2** (Strategic Zoom bis zur Gesamtkarte, Icons), **G7** client-seitig (Shift-Verkettung, Wegpunktlinien, Stop),
**G19** (Selection-Ringe/Zielmarker als dynamische Terrain-Decals), **S6** client-seitig (Blueprint-HMR, view.json v2).
Verträge: `docs/status/ms3-p2-sim.md` (Frame v2/Watch, Pfadzähler, CheatSub.Footprint, devReload),
`docs/status/ms3-p3-render.md` (IconPass, `setIconAtlas`, `VisualEntry.icon/tech/iconThreshold/selectionRadius`,
`setDynamicDecals`, HP-Balken, `iconScreenRect`/`iconFade`), `docs/status/ms3-p1-blueprints-spk2.md` (view.json v2,
`compileBlueprintModules`, Locales). Messwerte **lokal, Apple M5 Pro** (Node 24.18, Playwright-Chromium headless mit
Metal-ANGLE) – kein Referenz-Laptop (DECISIONS 5).

Geändert wurden nur die owns: `packages/client/**`, `apps/game/**` und dieses Fragment. Gearbeitet wurde im Worktree
`flow-and-fire/.worktrees/flow-and-fire-ms3` (Branch `ms3`; der im Auftrag genannte Pfad `Projects/flow-and-fire-ms3`
existiert nicht).

## Umgesetzt

| Bereich | Inhalt | Ort |
|---|---|---|
| A C3 Selektion | FA-Verhalten statt `allOwn`: Start ohne Auswahl, Rechtsklick ohne Auswahl tut nichts (kein Befehl, kein Marker). Box (Linksziehen) wählt eigene Units, Shift+Box fügt hinzu; Klick = Treffer (Icon-Quadrat bzw. projizierte Scheibe, mindestens 14 px), nächster Mittelpunkt gewinnt, Klick ins Leere leert; Shift+Klick toggelt; Doppelklick (≤ 400 ms, ≤ 6 px) = alle eigenen Units desselben Visuals, deren Mittelpunkt im Bild liegt (Shift addiert); Strg/⌘+A alle eigenen; Esc leert. **Trefferregel = Renderer:** `ScreenProjection` berechnet je Unit die interpolierte Position, `unitIconFade` (gleiche Schwelle/Auswahlradius aus view.json, gleiche Zoom-Kraft `strategicZoom(camera.distance, map.sizeWu)`) – Deckung ≥ 0,5 ⇒ Icon-Modus (Rechteck exakt `iconScreenRect`, Größe = Renderer-Icongröße), sonst Mesh-Modus (projizierter Auswahlradius). Auswahl als sortierte Handle-Menge (Typed Array), Handle→Record-Index je Frame (`HandleIndex`, offene Adressierung, Generationsstempel); Frame-Rebuild allokationsfrei, tote Handles fallen heraus | `packages/client/src/selection.ts`, `handle-index.ts` |
| A Ringe/HP | Selection-Ringe als **dynamische Decals** (Radius = `view.selectionRadius`, Teamfarbe der eigenen Armee aus der Render-Palette), nur für Units, die als Mesh gezeichnet werden (Icons zeigen die Auswahl mit ihrem hellen Rand – spart Decal-Slots je Chunk); HP-Balken über den Renderer-Modus `auto` (selektiert **oder** beschädigt, Highlight-Bytes = Auswahl) | `order-feedback.ts`, `client.ts` |
| B C7 Control Groups | `ControlGroups` (10 Gruppen, Typed Arrays): Speichern **Strg+Ziffer** (preventDefault) **und Alt+Ziffer** (browser-sicherer Default), nie ⌘; Hinzufügen Shift+Strg/Alt+Ziffer; Abrufen Ziffer (leere Gruppe ändert nichts); Shift+Ziffer addiert zur Auswahl; Doppeltap < 350 ms zentriert die Kamera auf den Schwerpunkt (angezeigte Positionen); tote/fremde Handles fallen bei jedem neuen Frame heraus (allokationsfrei). Bindings über `KeyboardEvent.code` (`Digit0–9`, `Numpad0–9`) in `actions.ts` (`groupStore/groupAdd/groupRecall/groupRecallAdd`, Gruppennummer aus dem Code). Im Vollbild `navigator.keyboard.lock()` (Chromium), beim Verlassen `unlock()` | `control-groups.ts`, `actions.ts`, `input.ts`, `client.ts` |
| C Befehle | Rechtsklick = **ein** Move-Command für die ganze Auswahl (Gruppenbefehl in der Sim), Shift+Rechtsklick = `CmdFlags.Queue`, S = Stop. Sofort-Feedback: Klickmarker (Overlay) + **optimistische Wegpunktlinie** (vom angezeigten Schwerpunkt; bei Shift vom vorherigen Befehlsziel) + Ziel-Disc bis zur seq-Bestätigung; danach Linien aus der **Watch-Sektion**: `ctl.watch` = erste 64 selektierten Handles (Frame-Reihenfolge), gesendet nur bei Änderung der Liste; Route Unit → Pfad-Wegpunkte → gequeuete Ziele, als Overlay-Segmente terrainfolgend unterteilt (≤ 4 WU je Stück, ≤ 24 Stücke je Segment, ≤ 16.384 Segmente), Breite ∝ Kameraabstand (≈ 2,5 px); Ziel-Discs je Order-Ziel (Move grün, gequeuet hellgrün, Stop rot). **Nicht beobachtete Selektierte (> 64)** und Units im Icon-Modus: eine Disc je eigenem Befehlsziel (`CommandTargets`: Ziele je Handle, Move ohne Queue ersetzt, Stop vergisst), sichtbar solange eine dieser Units selektiert und nicht `Idle` ist | `order-feedback.ts`, `client.ts`, `commands.ts` |
| D C2 Zoom/Visuals | Stufenloser Zoom bis zur Gesamtkarte war vorhanden (`maxDistanceForMap`); neu: ab 60 % des Maximalabstands zieht Herauszoomen den Fokus zur Kartenmitte (bei Maximum zentriert ⇒ immer die ganze Karte im Bild). Icon-Atlas (`icons/atlas` RGBA8 + `icons/atlas-metrics`) über AssetManager/Asset-Worker aus dem Manifest, `renderer.setIconAtlas` (fehlt er, prozedurale Ersatzform + Konsolenwarnung). `visualTableFromView` setzt `icon`, `tech`, `iconThreshold`, `selectionRadius` und den **Turm** (`placeholder.turret`); `VisualGeometry` liefert dieselben Zahlen für Treffertests (Defaults wie der Renderer). HUD zeigt Zoomstufe (Z0–Z2) und Abstand | `camera-controller.ts`, `visuals.ts`, `apps/game/src/loading.ts`, `game.ts`, `ui/App.tsx` |
| E HMR | Vite-Plugin (nur Dev-Server) beobachtet `content/blueprints` + `content/locales` (per `FAF_BLUEPRINT_DIR`/`FAF_LOCALES_DIR` überschreibbar), unterdrückt Vites eigenes HMR für diese Dateien, invalidiert die Module im SSR-Modulgraph, lädt Compiler + Content per `server.ssrLoadModule`, kompiliert mit `compileBlueprintModules` und sendet das Custom-Event `faf:blueprints` (sim.bin base64 + view.json, simHash/viewHash, Zeitstempel). Seite: `ctl.devReload {simBin}` an den Sim-Worker; sobald `status.devReloads` hochzählt, wird view.json angewendet (VisualTable/Icons/Radien neu, `bp`-Tabelle der Konsole neu), HUD zeigt „tainted“, neue simHash und die HMR-Zeit. Kompilier-/Ladefehler ⇒ Diagnosen in HUD (rot), Dev-Konsole und Browser-Konsole, **kein Reload**; Ablehnung durch den Worker (inkompatible IDs) ⇒ Fehler, alte Visuals bleiben. Warm-up beim Serverstart. Content-Kopien außerhalb des Repos: die relativen `define.ts`-Importe werden auf die Repo-Datei aufgelöst | `apps/game/scripts/blueprint-hmr.ts`, `vite.config.ts`, `src/hmr.ts`, `main.tsx`, `game.ts` |
| F Standardszene | hollow-ridge mit **Platzhalter-Panzern**: je Armee 150 (Default) als Mischung `core:lnd_t1_tank 5 : lnd_t1_arty 2 : lnd_t1_scout 2 : lnd_t2_tank 2 : lnd_t3_heavy 1` (Largest Remainder: 63/25/25/25/12), je Typ ein Cheat-Spawn in einer gemeinsamen Scheibe um die Startposition (Radius aus den Kollisionsradien, ≈ 15 WU); Kamera startet mit 45 WU Abstand (Panzer als Meshes). `?spawn=tanks|cubes|none`, `?tanks=`, `?paths=1`; `?cubes=`/`?units=` ohne `spawn` behalten die MS2-Würfelszene | `apps/game/src/params.ts`, `content.ts`, `game.ts` |
| F Konsole | `obstacle <x> <z> <w> <h> [remove]` (CheatSub.Footprint, 1–64 Zellen), `paths [on|off]` (Pfadstatistik aus Frame-Header + Host-Stats, Overlay), `select <bp>` (alle eigenen eines Blueprints), `watch` (Watch-Daten der Auswahl). Pfad-Overlay: Wegpunkt-Punkte, Routenfarbe nach Watch-Flags (stuck rot, Pfad ausstehend gelb, Ersatzziel orange) | `console-commands.ts`, `order-feedback.ts` |
| G Hooks | `window.__faf` erweitert (Vertrag unten) | `apps/game/src/hooks.ts` |
| H Tests | Client-/Game-Tests auf das neue Verhalten umgestellt, neue Tests (s. u.) | `packages/client/test/**`, `apps/game/test/**` |

## Steuerung (Standardbelegung, nur `KeyboardEvent.code`)

| Eingabe | Aktion |
|---|---|
| Linksklick / Linksziehen | Klick-/Box-Auswahl (ersetzt); Klick ins Leere leert |
| Shift+Linksklick / Shift+Linksziehen | Unit toggeln / Box hinzufügen |
| Doppelklick (Shift: hinzufügen) | alle eigenen Units desselben Typs im Bild |
| Strg/⌘+A · Esc | alle eigenen auswählen · Auswahl leeren |
| Rechtsklick · Shift+Rechtsklick | Move (Gruppe) · Move anhängen (Queue) |
| S (tippen) | Stop der Auswahl (halten = Kamera zurück) |
| Strg+Ziffer oder Alt+Ziffer | Gruppe speichern (Strg: preventDefault; ⌘ nie) |
| Shift+Strg+Ziffer oder Shift+Alt+Ziffer | Auswahl zur Gruppe hinzufügen |
| Ziffer · Shift+Ziffer · Ziffer 2× (< 350 ms) | Gruppe abrufen · zur Auswahl addieren · Kamera auf Gruppe |
| Mausrad | Zoom zum Cursor, ganz heraus = Gesamtkarte (Z2, nur Icons) |
| unverändert (MS2) | WASD/Pfeile/Rand/Mitte Kamera, Strg+Mitte drehen, Pos1, H, P, N, ^/F1, Alt+Enter |

## URL-Parameter (neu/geändert)

| Parameter | Bedeutung |
|---|---|
| `?spawn=tanks` (Default) \| `cubes` \| `none` | Startarmeen: Panzermischung / MS2-Würfel (1.000 + 24) / nichts |
| `?tanks=<n>` | Panzer je Armee (Default 150, 0–4.096) |
| `?cubes=` / `?units=` ohne `spawn` | ⇒ Würfelszene wie MS2 (Kompatibilität bestehender Specs); `?units=` spawnt Flugtest-Würfel wie bisher |
| `?paths=1` | Pfad-Overlay von Beginn an |

## Test-Hooks (`window.__faf`, Vertrag für ms3-p6)

Bestehende Hooks unverändert, außer: `select(handles | null, additive?)` – `null` wählt jetzt explizit alle eigenen
(wie Strg+A), `[]` leert; `sendMove(handles | null, x, z, queue?)` – `null` = Auswahl, `queue` = Shift;
`renderStats().drawsByPass` enthält `icons`, dazu `zoomLevel`, `iconForce`, `iconCount`, `fadedUnits`,
`iconOnlyUnits`, `dynamicDecals`, `decalChunkOverflow`; `flight().drawsByPassMax.icons`.

| Hook | Rückgabe |
|---|---|
| `selection()` / `clearSelection()` / `selectBlueprint(bp)` | selektierte Handles (Frame-Reihenfolge) / leeren / alle eigenen eines Blueprints (Sim-ID oder `lnd_t1_tank`) |
| `controlGroups()` / `controlGroup(op, n)` | Mitglieder der Gruppen 0–9 / `store`\|`add`\|`recall`\|`recallAdd` wie die Tasten (Doppeltap-Logik inkl.) |
| `screenUnits()` | je Unit des aktuellen Frames: `handle, army, visual, x, y` (projiziert, interpoliert; null hinter der Kamera), `onScreen`, `fade` (Render-Crossfade), `icon` (Treffer über Icon), `iconRect [x0,y0,x1,y1]` (= `iconScreenRect`), `radiusPx`, `selected` |
| `zoom()` | `distance, maxDistance, level, iconForce, z1, z2` (Client = Renderer-Formel), `renderLevel` (letzter Frame) |
| `watch()` / `watchedHandles()` | Watch-Sektion (WU: `targets[{type,x,z}]`, `points`, `orderCount`, `flags{stuck,retargeted,pathPending,group}`) / zuletzt per `ctl.watch` gesendete Handles |
| `pathStats()` | `tick, pending, requestsIssued, repathsTriggered, expansionsLastTick, stuckGiveUps` (Frame-Header) + `host` (`stats.path`) |
| `feedback()` / `setPathOverlay(on)` | `segments, discs, rings, watchedDrawn, optimistic, pathOverlay` des letzten Aufbaus / Overlay |
| `unitInfo(h)` | `x,y,z` (WU, cur), `idle`, `selected`, `watched`, `orders` (aus Watch, sonst null), `cell`, `blockedCell` + `blockedReason` (`static` = Nav-Regel-Replik: Rand/Neigung > 3.072 raw/WU/Tiefwasser; `footprint` = per Konsole gesetztes Hindernis) |
| `waitTick(n, timeoutMs?)` | Promise mit dem Tick, sobald ein Frame mit Tick ≥ n da ist |
| `hmr` | `{count, applied, failed, pending, last, history[]}`; Record: `id, ok, files, changedAt` (mtime, Epoch-ms), `compiledAt, compileMs, receivedAt, appliedAt, totalMs` (= appliedAt − changedAt), `simHash, tainted, error` |
| `simHash` / `tainted` | Blueprint-simHash der laufenden Sim (Host-Status) / Command-Log tainted |

HUD-Testids neu: `hud-zoom` (`data-level`), `hud-simhash`, `hud-tainted` (`data-tainted`), `hud-hmr`, `hud-hmr-error`,
`hud-overlay`.

## Client-API (für Folgepakete)

```ts
client.select(handles, additive?) / selectAll() / clearSelection() / selectVisual(visual, additive?)
client.controlGroup(op, group, nowMs?) / centerOnGroup(g) / controlGroups   // C7
client.moveTo(xRaw, zRaw, handles?, clickMs?, queue?) / stopSelected() / footprint(x, z, w, h, ±1)
client.setVisuals(table)            // HMR: Renderer + Treffer-Geometrie + Metrik-Radien
client.zoom                         // StrategicZoom der aktuellen Kamera auf der Karte
client.feedback                     // OrderFeedback: lines, decals, targets, pathOverlay, rings
client.selection.project(camera, alpha)   // ScreenProjection (sx, sy, icon, fade, radiusPx, visible)
client.watchedHandles()
landCellBlocked(hf, waterLevelRaw, x, z) / ClientMap.landBlockedAtRaw(x, z)   // Nav-M5-Replik (ohne Clearance/Footprints)
GameClientOptions: iconSizePx?, keyboardLock?   · Callbacks: onSelectionChange(count), onControlGroup(op, g, size, centered)
```

## HMR-Ablauf und Messung

Datei gespeichert → Watcher (chokidar/fsevents) → 25 ms Entprellung (höchstens 100 ms nach dem ersten Ereignis) →
Invalidierung + `ssrLoadModule` + `compileBlueprintModules` → `faf:blueprints` → `ctl.devReload` → Host tauscht die
Blueprint-Tabelle, markiert den Log tainted, neue simId → `status` → Seite wendet view.json an und stempelt `appliedAt`.

## Messwerte (lokal, Apple M5 Pro)

| Messung | Ergebnis |
|---|---|
| Box-Select auf Icons, Gesamtkarte (Z2), 1.000 Units, 240 Zufallsboxen (Unit-Test) | 229/240 Boxen nicht leer, **Treffer 6.265/6.265 (100 %), falsch 0/6.265 (0 %)** – Kriterium ≥ 99 % / ≤ 1 % (maschinenunabhängig, gegated) |
| Box-Select im Browser (Sichttest, Z2, 150 eigene Panzer, Box um alle Icons) | 150/150 ausgewählt, 150/150 im Icon-Modus |
| HMR Datei-mtime → angewendet (Browser, Dev-Server, Panzer-Szene, 5 Runden) | **181–323 ms** (1. Runde 323 ms), Kompilierung 43–97 ms; Plugin allein (Vitest, ohne Warm-up) mtime → Event 171 ms. Ziel ≤ 1 s (nur mit `FAF_PERF_GATE=1` gegated) |
| Main-JS je rAF, 150 Panzer je Armee, alle 150 selektiert, Gruppenbefehl + Shift-Ziel fahrend, 64 Watch-Routen, 8 s | p50 **0,17–0,23 ms**, p95 **0,34–0,38 ms**, 60 FPS, Render-CPU 0,06–0,08 ms, 15 Draws (Units 10, Icons 1, Overlay 2) |
| dito mit 500 Panzern je Armee (1.000 Units), 500 selektiert | p50 0,27 ms, p95 0,58 ms, 60 FPS |
| Allokation rAF-Pfad (Vitest, 1.000 fahrende Würfel, alle selektiert, 1.000 Ringe + 64 Routen/Discs je rAF, 600 rAFs nach 3.000 Warm-up) | **0 GCs**, < 256 B/rAF (gegated) |
| Frame-Rebuild der Auswahl (1.000 selektiert, 2.000 Frames) | < 64 B/Frame (gegated) |
| Gesamtkarten-Zoom im Browser | Z2 bei 711 WU (hollow-ridge), 5 Draws (Units 0, Icons 1), 300 Icons, alle vier Kartenecken im Bild |

Sim p95 im Browser (Host-Stats, Panzer-Szene): 0,9–3,4 ms – nur berichtet (Fremdlast durch parallele Workflows).

## Tests (Vitest)

`pnpm vitest run packages/client apps/game`: **23 Dateien, 188 Tests grün** (client 15 Dateien, game 8).

| Datei | Inhalt |
|---|---|
| `packages/client/test/selection.test.ts` (neu geschrieben) | Start leer, Strg+A nur eigene, fremde Handles fallen weg; Mesh-Modus Box = projizierte Scheibe (unabhängige Erwartung), Shift addiert; Box auf interpolierten Positionen; **Gesamtkarte: 1.000 Units, 240 Zufallsboxen, Erwartung über `iconScreenRect` + `unitIconFade`, ≥ 99 % / ≤ 1 %**; Überblendband: Modus = Renderer-Regel je Unit (Fade identisch zu `unitIconFade`); Klick (nächster, Shift toggelt, leer leert, Feinde nie, `pick` mit Feinden); Klick nur im Icon-Quadrat; Doppelklick = gleicher Typ im Bild (+ `selectVisual`); Pruning; Allokation Rebuild |
| `packages/client/test/client-ms3.test.ts` (neu) | Control Groups: Code-Parsing, store/add/Dedupe/Doppeltap/Prune; **Hotkeys über die echte Eingabe** (Strg/Alt speichern + preventDefault, ⌘ ungebunden, Abrufen, Shift addieren, Shift+Alt zur Gruppe, Doppeltap zentriert, Numpad); tote Handles; Doppelklick über Zeigerereignisse; **Shift-Queue: Flags, optimistische Linie vom vorherigen Ziel, Watch mit 2 Zielen, Discs, Stop leert**; > 64 Selektierte: 64 Watch-Discs + 1 Befehls-Disc, Abwählen leert alles; CommandTargets; Footprint-Cheat bis in die Fake-Sim; Keyboard-Lock im Vollbild; `setVisuals`; **Herauszoomen von einer Ecke endet zentriert in Z2 mit allen Kartenecken im Bild** |
| `packages/client/test/client.test.ts` (angepasst) | Rechtsklick ohne Auswahl ⇒ nichts; mit Auswahl: Marker im nächsten rAF, `ctl.watch` mit den ersten 64, optimistische Linie bis zum Ack, dann Watch-Routen; Ringe nur für Mesh-Units; Pause/Step; Esc; **Allokationstest jetzt mit 1.000 Ringen + 64 Routen** |
| `input.test.ts`, `input-ms2.test.ts`, `client-map.test.ts`, `camera-controller.test.ts`, `map.test.ts`, `assets.test.ts` | Esc/Ziffern/Doppelklick-Aktionen; Route folgt dem Terrain; Anker-Test klammert den Überblicks-Drift aus; **Nav-Replik gegen die Nav-Konstante (Quelltext) + hollow-ridge**; Asset-Test an 7 Blueprints angepasst + view.json v2 → VisualTable (Icon, Tech, Schwelle, Radius, Turm) |
| `apps/game/test/hmr.test.ts` (neu) | HmrTracker (Pending bis `devReloads`, Zeit, Kompilierfehler, Worker-Ablehnung, überholte Updates); **Plugin gegen eine temporäre Content-Kopie mit echtem Vite-Server**: Änderung ⇒ sim.bin/view.json mit neuer simHash, kaputte Referenz ⇒ Diagnose, Syntaxfehler ⇒ Diagnose, Rückbau ⇒ Original-simHash, Locale-Änderung ⇒ Event |
| `apps/game/test/{params,console-commands,content,loading}.test.ts` | `spawn/tanks/paths` + Legacy-Regeln; `obstacle/paths/select/watch`; Panzerplan (Mischung, Scheibe ≥ 95 % passierbar laut Nav-Replik); Atlas in den Session-Assets + Parser |

Selbsttest (2026-09-30): `pnpm typecheck` grün, `pnpm lint` grün (ESLint + depcruise, 404 Module),
`pnpm vitest run packages/client apps/game` grün (188), `pnpm build` grün; Sichttest per Playwright-Skript (Scratch,
Dev-Server `--port 5273 --strictPort`, danach beendet): Szene lädt (150 + 150 Panzer, 0 ausgewählt), Box-Select (107),
Rechtsklick + Shift-Rechtsklick (Watch: 2 Orders, Routen + Discs), Strg+1/Esc/1, Zoom auf Gesamtkarte (Z2, Icons),
Box-Select auf Icons (150/150), HMR-Runden (s. o.), keine Seitenfehler.

## E2E-Specs mit Bezug auf `allOwn`/Würfel (gehören ms3-p6)

| Spec | Abhängigkeit | Umstellung |
|---|---|---|
| `move.spec.ts` | Rechtsklick bewegt „alle eigenen Würfel“ ohne Auswahl; `openGame(…, '', 1000)`, `after.n === 1000` | `?spawn=cubes` (oder `?cubes=1000`) **und** vor dem Rechtsklick `select(null)` bzw. Strg+A |
| `boot.spec.ts` | Default = 1.000 eigene Würfel (`own === 1000`) | `?spawn=cubes` setzen oder auf Panzer umstellen (`own` = 150 minus abgelehnte Spawnpunkte, Mischung prüfen) |
| `console.spec.ts` | 1.000 Würfel, `ownHandles().length === 1050/1040`; `select(null)` als „zurück zu allen“ | `?spawn=cubes`; `select(null)` wählt jetzt explizit alle (gleiche Wirkung für `kill`) |
| `pause.spec.ts`, `latency.spec.ts` | `openGame(…, '', 1000)`, Würfelgruppen (Latenzmessung auf ruhenden Würfeln) | `?spawn=cubes`; latency wählt bereits explizit (`select(hs)`), Rechtsklick funktioniert damit |
| `picking.spec.ts` | `select(null)` vor Rechtsklicks | funktioniert weiter (explizit alle); Default-Szene hat nur 300 Units – `openGame(…, 1024)` wartet sonst ewig ⇒ `?spawn=cubes` oder `minUnits` senken |
| `camera.spec.ts`, `map-roundtrip.spec.ts`, `terrain.spec.ts`, `context-loss.spec.ts` | `openGame(…, '', 1024)` = Units ≥ 1.024 (1.000 + 24 Würfel) | `?spawn=cubes` oder `minUnits` auf die Panzerszene (≈ 300) setzen; camera.spec: Rechtsklick ohne Auswahl sendet jetzt keinen Befehl (nur Kontextmenü-Test – unkritisch) |
| `transports.spec.ts`, `context-loss.spec.ts` (Replay-Teil) | `autostart=0`, `sendMove(ownHandles…)` auf Würfel der Startarmee | `?spawn=cubes` (Hash-Ketten sind szenenabhängig) |
| `flight.spec.ts` | `?units=2000` | unverändert (Legacy-Regel ⇒ Würfelszene) |

Neue MS3-Prüfungen für p6 (Vorschlag): Box-Select auf Icons in Z2 über `screenUnits().iconRect` gegen `selection()`;
Control Groups per Tastatur (Alt+Ziffer in allen Browsern); Shift-Queue über `watch()`; HMR mit
`FAF_BLUEPRINT_DIR`-Kopie (Dateiänderung ⇒ `hmr.last.totalMs`, `tainted`, neue `simHash`); `obstacle` + `pathStats().repathsTriggered`.
Für den Produktions-Server (`scripts/serve.mjs`, `deploy/nginx.conf`, p6): Dateiendung `.rgba` (Icon-Atlas) als
`application/octet-stream` ausliefern (Vite-Dev-Server erledigt das).

## Abweichungen vom Auftrag/Plan (mit Begründung)

1. **Selection-Ringe nur für Units im Mesh-Modus.** Units, die als Icon gezeichnet werden (Crossfade ≥ 0,5, Z2), markieren
   die Auswahl über den hellen Icon-Rand des IconPass. Grund: das gemeinsame Decal-Budget des Renderers (32 je Chunk)
   läuft bei dichten Gruppen sonst sofort über (gemessen: 150 Ringe + Discs ⇒ 144 Überläufe), und Ringe unter Icons sind
   unsichtbar. Aus demselben Grund bekommen Units im Icon-Modus keine Ziel-Disc je Slot, sondern eine Disc je Befehlsziel.
2. **Zielmarker nicht beobachteter Units** (> 64) sind eine Näherung aus den eigenen Befehlen (Disc sichtbar, solange eine
   der Units des Befehls selektiert und nicht `Idle` ist); gequeuete Ziele bleiben bis zum Stillstand sichtbar, auch wenn
   sie schon erreicht sind. Exakte Daten liefert nur die Watch-Sektion (≤ 64, Protokollgrenze).
3. **Überblicks-Drift beim Herauszoomen** (ab 60 % des Maximalabstands): der Zoom-zum-Cursor-Anker gilt dort nicht mehr,
   damit die Gesamtkartenansicht immer zentriert ist (FA-ähnlich). Der MS2-Ankertest klammert diesen Bereich aus.
4. **Nav-Regel im Client repliziert** (`landCellBlocked`, Konstante 3.072 = `NAV_LAND_MAX_SLOPE_RAW`, Test liest die
   Nav-Quelle): Client-Pakete dürfen `@faf/nav` nicht importieren (depcruise). Ohne Clearance je Größenklasse und ohne
   Footprints anderer Quellen; Konsolen-Hindernisse werden clientseitig gemerkt.
5. **HMR wendet view.json erst nach der Worker-Bestätigung an** (nicht vorher): bei inkompatiblen IDs (Worker lehnt ab)
   passen Visuals und Sim sonst nicht mehr zusammen. Der Messpunkt „angewendet“ ist damit Worker-Status + View.
6. **Compiler im Plugin über `ssrLoadModule`** statt direktem Import in der Vite-Config: Content und `define.ts` laufen
   so durch denselben Modulgraph (gleiche Instanzen), und die Config bleibt frei von TypeBox/Workspace-TS-Importen.
7. **`select(null)`-Hook** bedeutet „alle eigenen explizit“ (vorher: zurück in den impliziten Modus, den es nicht mehr gibt).
8. **Start-Kamera der Panzerszene 45 WU** (Würfelszene weiter 105 WU): bei 105 WU wären die Panzer (Auswahlradius
   0,5–1,4 WU) unter der Icon-Schwelle von 14 px und nur als Icons sichtbar.
9. **Fake-Sim der Client-Tests** (Test-Support) kann jetzt Queue, Watch-Sektion, Visual je Unit und Footprint-Cheats;
   `Math.hypot` dort durch `sqrt` ersetzt (Varargs-Aufruf boxt und verfälschte den Allokationstest).

## Bekannte Grenzen

- **Decal-Budget je Chunk (Renderer, 32):** dichte Klumpen selektierter Units im Mesh-Modus (> ≈ 30 je 32×32-WU-Chunk)
  verlieren einen Teil ihrer Ringe (`renderStats().decalChunkOverflow`). Ringe haben Vorrang vor Discs (Reihenfolge).
  Anhebung des Limits wäre Sache des Render-Pakets.
- Routen sind gerade Segmente zwischen Wegpunkten, terrainfolgend nur über die Unterteilung (≤ 4 WU); an Klippenkanten
  kann ein Stück kurz ins Gelände tauchen.
- Doppelklick-Erkennung selbst implementiert (400 ms / 6 px, `pointerup`-Zeitstempel), nicht die System-Einstellung.
- `navigator.keyboard.lock` gibt es nur in Chromium; in Firefox/Safari greift Strg+Ziffer teils der Browser ab – dort
  Alt+Ziffer verwenden (Default gebunden).
- HMR: Änderungen, die bestehende Blueprint-IDs umsortieren/entfernen, lehnt der Worker ab (Vertrag ms3-p2) – dann
  Seite neu laden. `server.ssrLoadModule` ist in Vite 8 noch vorhanden, gilt aber als Legacy-API.
- HUD aktualisiert „tainted“ im 200-ms-Takt (Hook `tainted` sofort).
- Die E2E-Specs sind noch nicht umgestellt (ms3-p6, Tabelle oben); mit der neuen Default-Szene warten Specs mit
  `openGame(…, 1000/1024)` bis zum Timeout.
