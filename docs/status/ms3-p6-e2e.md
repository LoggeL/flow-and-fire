# ms3-p6-e2e – E2E-Demo-Pfad MS3 (Chromium/Firefox/WebKit, mit/ohne COOP/COEP), SPK6-Nachmessung (MS3, Welle 3)

Stand 2026-09-30. Playwright-Demo-Pfad von MS3 (PLAN §5 „Definition of Done“) und Browser-Abnahme der MS3-Kriterien
(C3 Selektion, C7 Control Groups, G7 Shift-Queue/Stop, M5/M6/M7 + G8 HPA\*-Pathing mit Offset-Erhalt und Korridor-Repath,
C2 Strategic Zoom mit IconPass/Box-Select auf Icons, S6 Blueprint-HMR, G19 Selektionsringe) sowie SPK6-Nachmessung mit
dem SPK2-Anfahrprofil. Messwerte **lokal, Apple M5 Pro** (Darwin 27, Node 24.18, Playwright 1.63 headless: Chromium 153,
Firefox 155, WebKit 26.6) unter Fremdlast paralleler Workflows (Load-Average 6–15) – kein Referenz-Laptop, kein
GPU-Runner (DECISIONS 5).

Gearbeitet wurde im Worktree `flow-and-fire/.worktrees/flow-and-fire-ms3` (Branch `ms3`; der im Auftrag genannte Pfad
`Projects/flow-and-fire-ms3` existiert nicht). Geändert wurden nur die owns: `test/e2e/**`, `apps/game/**`,
`packages/client/**`, `packages/render/**`, `deploy/**` und dieses Fragment. Alle Läufe mit `FAF_E2E_PORT=4283`
(4283 COOP/COEP + SAB, 4284 ohne/Transfer, HMR-Dev-Server 4285), Playwright `workers: 1`, Browser nacheinander.

## Neue Specs

| Spec | Prüft (immer gegated, maschinenunabhängig) | Gemessen/berichtet (`test-results/*.json`) |
|---|---|---|
| `selection.spec.ts` | Panzerszene, Sim pausiert: Start ohne Auswahl; **Box (echter Linkszug)** == eigene Units, deren Icon-Quadrat bzw. projizierte Auswahlscheibe die Box schneidet (Erwartung aus `screenUnits()`, Grenzfälle < 0,75 px ausgenommen); **Selektionsringe** (Pixel: an ≥ 75 % der selektierten Mesh-Units ≥ 3/16 Ringpunkte neu blau gegenüber dem Frame ohne Auswahl), `feedback().rings` == selektierte Mesh-Units, **HP-Balken** (Overlay-Draw +1, grüne Balkenpixel über ≥ 75 % der Units); Esc leert (0 dynamische Decals); Klick = Unit unter dem Cursor, Shift+Klick fügt hinzu/entfernt, Klick ins Leere leert; Box + Shift+Box = Vereinigung; **Doppelklick** = alle eigenen Units desselben Typs mit Mittelpunkt im Bild | Box-Größen, Ring-/HP-Treffer je Unit |
| `control-groups.spec.ts` | echte Tastatur (`KeyboardEvent.code`): Strg+1 speichert, 1 ruft ab, Shift+Strg+1 fügt der Gruppe hinzu, Shift+1 addiert zur Auswahl, leere Gruppe ändert nichts, **Alt+2/Shift+Alt+2** (browser-sichere Alternative), Strg+Numpad3/Numpad3, **Doppeltap** zentriert die Kamera ≤ 2 WU vom Gruppenschwerpunkt, Einzeltap nicht; **tote Handles** (Konsole `kill`) fallen aus der Gruppe und dem Abruf | Kamera-/Schwerpunktabstand |
| `orders.spec.ts` | 8 Panzer, echte Rechtsklicks: Klick + 2× Shift+Klick ⇒ Watch: 3 Orders, 3 Move-Ziele nahe den Wegpunkten (< 8 WU), nur **1 Pfadanfrage** (gequeuete Gruppen fragen bei Beginn an), `feedback().watchedDrawn` 8, **Wegpunktlinien als Pixel** (≥ 80 % der Stützpunkte auf den gequeuten Segmenten jeder Unit heller grün als ohne Befehl); Sim tickweise: jede Unit erledigt die Wegpunkte **in Reihenfolge** 0,1,2, jeweils ≤ 8 WU am Wegpunkt; danach keine Linien; Klick ohne Shift **ersetzt** die Queue (1 Order); Shift ergänzt, **S (Stop) leert** (≤ 1 Stop-Order, dann 0; keine Linien/Discs) | Abschluss-Ticks und -Abstände je Unit |
| `pathing.spec.ts` | hollow-ridge, `?tanks=56`: Gruppe A = 44 gemischte Panzer (≥ 3 Blueprints, Klassen 1–3) formiert sich per Einzel-Moves im Raster des Goldens `ridge-group-offset` (8 × 3,2 WU, schwere nie nebeneinander), dann **Rechtsklick auf das SE-Plateau** ⇒ `requestsIssued` +1; Gruppe B (12) zweimal +1; **jeder Frame** (Sim tickweise, ~3.000 Ticks) ohne Unit auf blockierter Zelle/Tiefwasser/Footprint (`unitInfo.blockedCell`); `obstacle` über die **Dev-Konsole (UI)**: fern aller Routen ⇒ `repathsTriggered` +0, auf dem Korridor von A (Wegpunkt der Watch-Route, > 60 WU von B) ⇒ **genau +1**; Ankunft ≥ 95 % (idle, ≤ 15 WU vom Ziel), niemand im Hindernis; **Offset-Erhalt**: Endabweichung von Schwerpunkt + komprimiertem Offset (Regel aus PLAN §3.8/ms3-p2 in Float repliziert) ≤ 1,5 WU für ≥ 95 %, Maximum ≤ 3,5 WU, ≥ 90 % erreichbare Slots | Ticks bis Ankunft, Offset p50/p95/max, Kompressionsfaktor |
| `zoom.spec.ts` | `?spawn=tanks&units=400` + 16 Einzelpanzer: **Mausrad** (echte Wheel-Events) stufenlos bis Maximalabstand, Abstand streng steigend, Zoomstufe monoton, **Z2** erreicht; bei jedem Schritt mit sichtbaren Icons **IconPass = 1 Draw**; **lückenloser Übergang**: an jeder isolierten Unit-Position Pixelabweichung ≥ 60 gegen einen Referenzframe ohne Units (Hook `setUnitsHidden`) bei ≥ 95 %; Überblendband mit Mesh + Icon durchlaufen; Z2: Units-Draws 0, Icons 1, alle sichtbaren Units icon-only, alle Kartenecken im Bild, **Icons in Teamfarbe** an ≥ 95 % der isolierten Positionen (beide Armeen); **Box-Select auf Icons**: 220 echte Mausgesten (jede zweite auf eine Unit gezielt), **Trefferquote ≥ 99 %, falsch Gewählte ≤ 1 %**; 3-s-Zoomflug (Sim läuft): Z2 erreicht, IconPass in jedem Frame 1 Draw, 0 Unit-Draws in Z2 | FPS des Zoomflugs, rAF-Leerlauftakt, Draws je Pass, Render-/Main-JS; FPS ≥ min(60; 0,95 × Leerlauftakt) nur mit `FAF_PERF_GATE=1` |
| `hmr.spec.ts` | nur Chromium (Firefox/WebKit mit Begründung übersprungen): Vite-Dev-Server programmgesteuert auf **4285** (`FAF_E2E_PORT+2`, eigene Prozessgruppe) mit `FAF_BLUEPRINT_DIR` = OS-Temp-Kopie von `content/blueprints`; `speed` des T1-Panzers 3,0 → 4,5: **MARK devReload** im exportierten Command-Log (genau 1), Log tainted (Hook + HUD), **neue simHash im HUD** (== Worker), Höchsttempo danach **×1,5** (Gate > ×1,3); **Syntaxfehler** und **Schemafehler** (negatives Tempo) ⇒ Fehlermeldung (HUD `hud-hmr-error`, Klartext ohne ANSI), kein Reload (gleiches Dokument, gleiche simHash, kein weiterer MARK), Spiel tickt weiter; afterAll beendet den Server (SIGTERM/SIGKILL auf die Gruppe) und löscht die Kopie | Datei-mtime → angewendet (≤ 1 s nur mit `FAF_PERF_GATE=1`), Kompilierzeit |

## Angepasste Specs (MS3-Verhalten)

| Spec | Änderung |
|---|---|
| `boot` | MS1/MS2-Test auf `?spawn=cubes` (Kriterien unverändert: 1.000 + 24 Würfel); **neu**: Standardszene mit Platzhalter-Panzern (150 + 150, Mischung 63/25/25/25/12, keine Auswahl, alle auf dem Terrain, ≥ 5 Unit-Draws, HUD Z0) |
| `move` | `?spawn=cubes`; **Rechtsklick ohne Auswahl sendet nichts** (kein Befehl, kein Marker); **Strg+A** (echte Taste) wählt alle, dann Rechtsklick (Marker ≤ 1 rAF, Ack, alle 1.000 im Befehl); Ziel auf dem Startplateau (MS3-Pathing führt Ziele unterhalb der Klippe über eine Rampe, d. h. zuerst weg vom Ziel); ≥ 990 Würfel fahren los, Schwerpunkt nähert sich |
| `pause` | `?spawn=cubes`, Ziel auf dem Plateau (130, 100); Kriterium „≥ 45/50 fahren los + Schwerpunkt nähert sich“ statt „≥ 45/50 jeweils näher“ (Gruppenbefehl: Slots um das Ziel) |
| `terrain` | `?spawn=cubes`; Abfahrt vom Plateau über die Rampe (Pathing) statt die Klippe hinab: Höhenprüfung alle 10 Ticks, bis ≥ 20 Würfel unten sind (höchstens 250 Ticks) |
| `flight` | `?units=2000` spawnt jetzt wirklich 2.000 (Spiel-Fix, s. u.); statt „alle 3 LODs“ **≥ 2 Mesh-LODs** + IconPass = 1 Draw (ferne Units sind ab MS3 icon-only) |
| `latency` | Würfel-Messung unverändert auf `?spawn=cubes`; **neu: SPK6-Nachmessung auf der Panzerszene** (Gruppen à 5, Startansicht 45 WU und nah 8 WU; Invarianten immer, ms-Gates nur mit `FAF_LATENCY_GATE=1`) → `latency-tanks-<browser>-<transport>.json` |
| `context-loss` | `?spawn=cubes`; **neu**: Icon-Zoom (Z2) vor/nach Verlust + Restore bei pausierter Sim: IconPass 1 Draw, Teamfarben-Icons ≥ 95 %, Icon-Pixel gleich dem Frame vor dem Verlust (≥ 97 %) ⇒ Atlas-Textur wiederhergestellt |
| `camera` | `?spawn=cubes`; S ist ab MS3 Tippen = Stop / Halten = Kamera (ab 180 ms): S wird 700 ms gehalten (vorher 350 ms – unter Last blieb in Firefox kein Schwenk übrig) |
| `console`, `picking`, `transports`, `map-roundtrip` | `?spawn=cubes` (Szenen- und Hash-abhängige Kriterien unverändert) |
| `map-load` | Standardszene (≥ 300 Units); Atlas (`icons/atlas`, `icons/atlas-metrics`) kalt aus dem Netz |
| `smoke` | Asset-Kinds `iconatlas` (octet-stream) und `iconmetrics` (JSON) mit MIME-Prüfung; Atlas `.rgba` im Manifest |

Gemeinsame Hilfen: `test/e2e/support/ms3.ts` (Pause/Step, `screenUnits`, Box-Trefferregel als unabhängige Erwartung,
echte Box-Gesten, HUD-Rechtecke meiden, CSS-px-Screenshots, Teamfarbe, deterministischer RNG).

## Fehler, die die E2E aufgedeckt haben (behoben in den owns)

1. **Flugtest spawnte nur 1.951 statt 2.000 Einheiten** (`apps/game/src/content.ts`): die Spawn-Scheiben mieden nur
   Tiefwasser; seit MS3 lehnt die Sim Punkte auf nav-blockierten Zellen (Neigung/Klippen) ab. `discIsLand` prüft jetzt
   zusätzlich die Nav-Replik des Clients (`ClientMap.landBlockedAtRaw`); Unit-Tests ergänzt.
2. **Wegpunktlinien kaum sichtbar** (`packages/render/src/passes/overlay.ts`): die Kantenglättung
   `smoothstep(1 − 1,5·fwidth, 1)` fraß bei der Routenbreite des Clients (≈ 2–3 px) den ganzen Kern – im Z1-Überblick
   nur +20–45 Helligkeit, 0/48 Stützpunkte erkennbar. Jetzt Abdeckung mit 1-px-Rampe (`(1 − |side|)/fwidth`), 48/48.
3. **HMR-Syntaxfehler mit ANSI-Farbcodes im HUD** (`apps/game/scripts/blueprint-hmr.ts`): Transformfehler werden jetzt
   per `stripAnsi` als Klartext gesendet (Unit-Test).
4. **Produktionsserver ohne `.rgba`-MIME** (`apps/game/scripts/serve.mjs`, `deploy/nginx.conf`): explizit
   `application/octet-stream` (vorher nur über den Default).

## Test-Hooks / APIs (neu, für Folgepakete)

- `window.__faf.setUnitsHidden(on)` → Renderer bekommt keine Unit-Records (Referenzframes des nackten Terrains);
  Client: `GameClient.unitsHidden` (Sim, Auswahl, Feedback laufen weiter).
- `window.__faf.exportLogData()` → Command-Log als Zahlen (E2E parst MARKs mit `parseCommandLog`).
- `FlightReport` + `framesByZoomLevel [Z0, Z1, Z2]`, `iconPassNot1Frames` (Frames mit sichtbaren Icons, deren IconPass
  ≠ 1 Draw), `unitDrawsInZ2Max`.

## Ergebnis Abschlusslauf

(wird unten eingetragen)
