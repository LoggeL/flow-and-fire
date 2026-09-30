# audioeng-c2 – Demo `apps/audio-demo`, Browser-Tests mit echtem (Offline)AudioContext, Browser-Messung

> **Track:** TRACK-AUDIOENG, Welle 2 · **Stand:** 2026-09-30 · **Branch:** `track-audioeng` (Worktree `.worktrees/faf-audioeng`)
> **Pfade:** `apps/audio-demo/{index.html, offline.html, src/**, vite.config.ts, playwright.config.ts, test/**, scripts/**, README.md}`, dieses Fragment

## 1. Umgesetzt

- **Teil A – Demo (`index.html`, `src/demo/**`, Vanilla-TS + Canvas2D):**
  - `scenario.ts` – deterministischer Gefechts-Generator `GefechtScenario` (eigener PRNG mulberry32, keine Trigonometrie → gleicher Event-Strom in jeder JS-Engine): 2 Armeen × 150 Einheiten (leichte Bots, Funken-Bots, Panzer, Riegel-Panzer, Mörser, schwere Panzer, Kanonenboote, 7 Verteidigungsbauten, 1 Vogt) auf 512 × 512 WU, zwei wandernde Fronten, Nachschub aus der Basis (Konvoi-Tempo), Teiche (Wasser-Einschläge). Pro Sim-Tick (10 Hz) ein wiederverwendetes `ArrayEventSource`-Batch mit `DEFAULT_EVENT_TYPES`: `weaponFire` (exakt `shotsPerSecond`, Bruchteil-Budget, zufälliger subTick), `projectileImpact` nach Flugzeit mit Oberfläche (ground / metal bei Treffer / water / structure), `unitDeath` (aux = Größenklasse, Flags STRUCTURE/AIR), `commanderDeath` (≈ alle 2–3 min), `buildComplete` (wiederaufgebaute Bauten), `alert` mit Ort (base_attacked, commander_danger, enemy_commander_spotted). Bau-Loop `bld_pour_loop` je Armee über `engine.setLoop` (Gain/Rate folgen der Baurate, 5 s Pause je 45 s → Stopp mit Fade und Neustart). Waffen-Mix aus echten Refs: `core:wpn_mg_t1`, `wpn_spark_mg_t1`, `wpn_cannon_t1`, `wpn_bolt_cannon_t1`, `wpn_slag_mortar_t1`, `wpn_cannon_t2`, `wpn_kestrel_gun_t1`, `wpn_reeve_cannon`; `visualName(visual)` = Tabelle `WEAPONS[visual − 1].ref`. Hot Path ohne Allokation (typisierte Arrays, Lane-Zählsortierung für die Zielwahl, Projektil-Pool mit Swap-Remove).
  - `camera.ts` – RTS-Kamera (Fokus, Höhe 20–400 WU, Gier), `viewHalfWidth = Höhe · tan 30°`, Rechtsvektor (cos, sin), wiederverwendetes `ListenerState`, Flug zum Alert-Ort (450 ms, smoothstep).
  - `renderer.ts` – Canvas2D-Draufsicht (Feld, Raster, Teiche, Basen, Einheiten je Rolle, Projektil-Tracer, Mündungsblitze, Einschläge, Explosionen, Vogt-Druckwelle, Alert-Ping, Bewegungsmarker, Kompass mit gedrehter +x-Achse). Effekte aus denselben Event-Batches (Ring, keine Allokation je Event).
  - `hud.ts` – DOM-HUD (4 Hz): Engine-/Kontextzustand, Ladefortschritt, dekodierte Sounds + MiB, Dekodierpfade, base/outputLatency, Timer-Auflösung; Gefechtssteuerung (Start/Stopp, Schüsse/s, Tempo 0,25–3×, Seed); Stimmen gesamt/32 + Balken je Kategorie gegen Limit (mit Spitzenmarke); played/stolen/Events/Drops je Grund pro Sekunde und gesamt; Main-JS-Tabelle (Engine `mainJs`, Demo-Messung um alle Engine-Aufrufe, Szenario-Generator); Bus-Slider master/sfx/ui/alerts/music/ambience + „stumm“ + „stumm bei verborgenem Tab“ (persistiert über den Settings-Controller der Engine, localStorage); Alert-Liste mit „Springen“.
  - `main.ts` – verdrahtet `createAudioEngine` (`baseUrl` = `audio/`, `visualName`, `onJumpTo` → Kamera, `onAlert`, `onLoadProgress`), lädt in drei Aufrufen (`tags: ['MS5']`, Gefechts-Kategorien alert/ui/ack/weapon/impact/explosion/signature/build, `common:amb_wind_loop`), Frame-Schleife (Kamera → fällige Sim-Ticks: `scenario.step` → `engine.handleEvents` → `engine.update` → Rendern), Ambience-Loop während des Gefechts, Unlock-Overlay „Klicken zum Aktivieren des Tons“ (Klick = Nutzergeste → `engine.unlock()`), Tastatur (WASD/Pfeile, Q/E, +/−, Leertaste = `jumpToLastAlert`), Ziehen = Pan, Mausrad = Zoom, Rechtsklick = Bewegungsbefehl mit `playUi('ui_cmd_move')` + `playUi('ack_pip_direct')`, Knopf „Klick-Quittung“. Test-Hook (§3).
  - `params.ts` – URL-Parameter `?shots=200&seconds=&speed=&seed=&zoom=&autostart=1` (geklemmt, Fehleingaben → Default).
- **Teil B – Browser-Fälle (`offline.html`, `src/offline/**`)**: `window.__fafAudioOffline.run(name)` mit `decode`, `pan`, `bus`, `limiter`, `loop`, `limits` (nur Module aus Welle 1: catalog, loader, mixer, voices, spatial). Jeder Fall wertet seine Kriterien im Browser aus und liefert Messwerte + `failures[]`. `?run=all` zeigt die Ergebnisse auf der Seite. `analysis.ts`: RMS, Peak, Energie, dB-Verhältnis, Median, Korrelation (mit Lag-Suche), Nahtprüfung.
- **Teil C – Playwright** (`playwright.config.ts`, `test/e2e/offline.spec.ts`, `test/e2e/demo.spec.ts`): Projekte chromium/firefox/webkit wie die Root-Config (inkl. `CFFIXED_USER_HOME`-Workaround für Firefox), `workers: 1`, `fullyParallel: false`; webServer = `pnpm exec vite build --logLevel warn && pnpm exec vite preview --port <FAF_E2E_PORT|4583> --strictPort --host 127.0.0.1` im App-Ordner (`FAF_AUDIO_SKIP_BUILD=1` überspringt den Build), `reuseExistingServer: false`. Autoplay wird nicht per Flag umgangen: der Test klickt das Overlay.
- **Teil D – `scripts/bench-browser.ts`**: baut, startet `vite preview` (eigene Prozessgruppe, wird auch bei Fehler/SIGINT/SIGTERM beendet), misst je Browser und Rate (200, 400 Schüsse/s) 3 × 20 s nach 2 s Warm-up, schreibt `apps/audio-demo/results/<ISO-Zeit>.json` (git-ignoriert) und mit `--update-docs` die Tabelle unten. Optionen `--quick`, `--runs`, `--seconds`, `--warmup`, `--rates`, `--browsers`, `--skip-build`.
- **Vite-Konfiguration:** COOP/COEP-Header für dev und preview (cross-origin isolated): Chromium liefert `performance.now()` sonst nur in 100-µs-, Firefox/WebKit in 1-ms-Schritten – für eine 0,5-ms-Messung unbrauchbar. Mit Isolation: Chromium 5 µs, Firefox/WebKit 20 µs.
- Das alte Gerüst `src/main.ts`/`src/offline.ts` (a0) ist ersetzt.

## 2. Befehle

| Zweck | Befehl (Repo-Wurzel) |
|---|---|
| Dev-Server | `pnpm --filter @faf/audio-demo dev` → http://localhost:5583 |
| Build | `tools/heavy pnpm --filter @faf/audio-demo build` |
| E2E (baut selbst) | `FAF_E2E_PORT=4583 tools/heavy pnpm --filter @faf/audio-demo test:e2e` (`FAF_AUDIO_PERF_GATE=1` = harte 0,5-ms-Prüfung) |
| Browser-Messung | `FAF_E2E_PORT=4583 tools/heavy pnpm --filter @faf/audio-demo bench:browser -- --update-docs` |
| Unit-Tests | `pnpm exec vitest run apps/audio-demo` |

## 3. Verträge

### Test-Hook `window.__fafAudioDemo` (`src/demo/hook.ts`, Typ `DemoHook`)

| Member | Bedeutung |
|---|---|
| `ready: Promise<void>` | Manifest geparst und Gefechts-Sounds geladen (drei `load()`-Aufrufe); verwirft bei Ladefehler |
| `start(opts?)` | `{shots?, speed?, seed?, seconds?}` – neues Szenario (Seed), setzt Engine-Statistik, Zeitringe und Spitzenwerte zurück, setzt Sim-Tempo, startet Ambience-Loop |
| `stop()` | hält an, stoppt Bau- und Ambience-Loops |
| `resetStats()` | wie `start` ohne Neustart des Gefechts (nach Warm-up) |
| `running` | läuft das Gefecht |
| `stats(): DemoStats` | `engine` (`AudioStats`), `scenario` (`ScenarioStats` + `running, shotsPerSecond, speed, seed`), `generator` (TimingStats je Frame mit Sim-Tick), `engineCalls` (Demo-Messung um alle Engine-Aufrufe je Frame, ganzer Lauf), `engineCallsTickFrames` (nur Frames mit Tick), `maxVoicesSeen`, `maxTailsSeen`, `maxByCategorySeen`, `categoryLimits`, `voiceLimit`, `frames`, `runMs`, `camera`, `load` (`phase, done, total, failed, ms, paths, error`), `ack` (`count, started, lastLatencyMs`), `crossOriginIsolated`, `timerResolutionMs`, `contextState`, `sampleRate` |
| `engine` | die `FafAudioEngine` (Fassade von c1) |
| `setCamera(pose)` / `camera()` | `{x, z, height, yaw}` setzen / lesen (+ `viewHalfWidth`) |
| `alerts()` | `engine.alertHistory()` (neueste zuerst) |
| `settings()` | `engine.settings.get()` |
| `ack()` | Klick-Quittung wie der HUD-Knopf; true = Stimme gestartet |

`maxVoicesSeen`/`maxByCategorySeen` werden nach **jedem** `handleEvents` und nach jedem `update` aus dem Voice-Manager gelesen (`voiceCount`, `categoryVoices(i)`), also am Maximum des Frames.

### Offline-API `window.__fafAudioOffline` (`src/offline/cases.ts`)

`ready`, `cases`, `run(name): Promise<OfflineResult>`; jedes Ergebnis hat `name, failures[], ms, userAgent` und fallspezifische Messwerte (`DecodeCaseResult`, `PanCaseResult`, `BusCaseResult`, `LimiterCaseResult`, `LoopCaseResult`, `LimitsCaseResult`).

| Fall | Aufbau | Kriterium |
|---|---|---|
| decode | 21 echte Dateien (alle 15 Kategorien, mono + stereo, 3 Loops, alle MS5-Waffen) über `createDecodeChain(new OfflineAudioContext(2, 48000, 48000))`; zusätzlich `forcePath: 'wasm'` und (wenn `AudioDecoder` existiert) `'webcodecs'` | Länge = Manifest ± `nativeLengthWindow` (native) bzw. exakt (Software), Kanäle, RMS > 1e-4, Peak ≤ 1; erzwungene Pfade exakt = Manifest, gegenüber dem Standardpfad Länge gleich (native Seite: im nativen Fenster) und Korrelation > 0,99 |
| pan | VoiceManager + Mixer + CameraSpatialModel, `wpn_cannon_t1_fire` 24 WU links/rechts/mittig vom Fokus, zusätzlich Kamera 90° gedreht | L − R ≥ 6 dB links, ≤ −6 dB rechts, Mitte < 1 dB, gedreht rechts ≤ −6 dB |
| bus | ui_click + Kanone, sfx-Regler 0 (Anfang) bzw. zur Laufzeit 0 | sfx-Fenster RMS < 1e-5, ui-Fenster RMS > 1e-3, Kontrolle sfx 1 hörbar |
| limiter | 32 gleichzeitige Stimmen (Waffe 10, Einschlag 8, Explosion 6, Einheit 8) gain 1 im Fokus | Peak ≤ 1,0; Kontrolle ohne Mixer > 1,0. Diagnose: Makeup-Gain, Peak mit Kompensation, Peak mit Kompensation + Clip |
| loop | `bld_pour_loop` > 2 Durchläufe, Loop-Punkte aus Manifest-Sekunden | Naht (Sample-Sprung an beiden Umläufen) ≤ 3 × Median der Differenzen in ±5 ms; Durchlauf 2 und 3 korrelieren > 0,99 |
| limits | 200 Schüsse in 1 s (4 MS5-Waffen), ~75 % mit Einschlag, jede 25. mit Explosion | nie > 32 Stimmen, keine Kategorie/kein Sound über Limit, drops > 0 |

### Für MS5 (Client-Integration)

- Die Demo zeigt die Verdrahtung, die MS5 übernimmt: ein Batch je Sim-Tick an `handleEvents`, `update()` einmal je Frame, `setListener` nur bei Kamerabewegung, `playUi` synchron im Eingabe-Handler (Ack ≤ 1 Frame: die Stimme startet im selben Event-Handler, im Test `ack.started ≥ 1`).
- Zuordnung Visual → Waffen-Ref wie `visualName` in `scenario.ts` (nur Waffen-Visuals; Einheiten-Visuals ab 100 sind Info).

## 4. Ergebnisse je Browser (E2E, lokal Apple M5 Pro, Playwright 1.63: Chromium 153, Firefox 155, WebKit 26.6)

`FAF_E2E_PORT=4583 tools/heavy pnpm --filter @faf/audio-demo test:e2e`: **22 von 24 grün**; rot ist nur `limiter` in Chromium und WebKit (siehe §6.1, Mixer). *Nachtrag d1: nach der Mixer-Korrektur 27/27 grün (inkl. neuem Ack-Test).*

| Prüfung | Chromium | Firefox | WebKit |
|---|---|---|---|
| Unlock | vor dem Klick `locked`, nach Overlay-Klick `running` | ebenso | ebenso |
| Dekodierpfad (Standardkette) | native 21/21 | native 21/21 | native 21/21 |
| erzwungen webcodecs / wasm | 21 / 21, `webcodecsTrim = decoder` (AudioDecoder wendet Pre-Skip selbst an) | 21 / 21, `decoder` | 21 / 21, `decoder` |
| Länge vs. Manifest | exakt | **native 1 Sample kürzer** (z. B. 5175 statt 5176), im nativen Fenster ±1920; webcodecs/wasm exakt | exakt |
| Korrelation Pfade | 1,0 | 1,0 | 1,0 |
| native Dekodierzeit 21 Dateien | ≈ 42 ms | ≈ 78–88 ms | ≈ 74–77 ms |
| pan L/R (links, rechts, Mitte, gedreht) | +9,76 / −9,76 / 0 / −9,76 dB | gleich | gleich |
| bus | sfx 0 → Stille, ui hörbar | ✓ | ✓ |
| limiter Peak (ungebremst 7,74) | **1,173** ✗ | 0,887 ✓ | **1,173** ✗ |
| … mit Makeup-Kompensation (−1,71 dB) | 0,963 | 0,729 | 0,963 |
| loop Naht / Korrelation | 1,38 × Median / 1,0 | gleich | gleich |
| limits (200 in 1 s) | max 24 Stimmen, weapon 10/10, impact 8/8, explosion 6/6, 295 drops, 35 steals | gleich | gleich |
| Demo 10 s Gefecht-200: Stimmen max | 25/32, Tails 8 | 25/32 | 25/32 |
| gespielt / gestohlen / verworfen | 620 / 568 / 2467 | 612 / 560 / 2504 | 614 / 562 / 2506 |
| Main-JS `engine.mainJs` p50 / p95 / p99 | 0,005 / 0,19 / 0,26 ms | 0,02 / 0,22 / 0,30 ms | 0,00 / 0,16 / 0,32 ms |
| Generator p95 | 0,15 ms | 0,14 ms | 0,20 ms |
| Laden (77 Sounds, 200 Varianten, 45,2 MiB) | ≈ 100 ms | ≈ 310–375 ms | ≈ 290–300 ms |
| base / outputLatency | 5,3 / 16 ms | 0 / 7,4 ms | 2,7 / 1,0 ms |
| Alert-Sprung (Leertaste) | Kamera auf (287, 255) | ✓ | ✓ |
| Settings nach Reload | sfx 0,35, music 0,2, stumm; stumm → drop `muted` | ✓ | ✓ |
| Konsolenfehler | keine | keine | keine |

Drops im Gefecht (Chromium, 10 s): cooldown 1155, categoryLimit 437, culled 875 (außerhalb des Hörradius der Kamera), keine global-/soundLimit-, notLoaded- oder locked-Drops.

## 5. Browser-Messung (`bench:browser`)

<!-- bench:audio-browser:start -->
Gemessen 2026-09-30 01:46 UTC auf Apple M5 Pro, 48 GB, darwin 27.0.0; je Browser und Rate 3 × 20 s nach 2 s Warm-up (Kamera auf der Front, Höhe 90 WU), Median der Läufe. Main-JS = `engine.stats().mainJs` (Engine-eigene Messung je Frame: handleEvents + play/playUi + setLoop + setListener + update, letzte 1024 Frames); „Aufrufe“ = Messung der Demo um alle Engine-Aufrufe über den ganzen Lauf, „Tick-Frames“ = nur Frames mit Sim-Tick (Event-Batch, ≈ jeder 6. Frame bei 60 fps). Budget 0,5 ms p95 wird nur berichtet (DECISIONS 16).

| Browser | Schüsse/s | Main-JS p50 | p95 (Spanne) | p99 | max | Aufrufe p95 | Tick-Frames p95 / p99 | Generator p95 | Stimmen max | gespielt/s | gestohlen/s | verworfen/s | Frames | Dekodierpfad | Laden | Timer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| chromium 153.0.8010.12 | 200 | 0,005 | **0,190** (0,190–0,240) | 0,270 | 9,550 | 0,200 | 0,290 / 0,510 | 0,065 | 25/32 | 61 | 59 | 256 | 1200 | native 200 | 103 ms | 0,005 ms (COI) |
| chromium 153.0.8010.12 | 400 | 0,005 | **0,225** (0,215–0,250) | 0,340 | 25,630 | 0,245 | 0,355 / 1,465 | 0,130 | 26/32 | 66 | 65 | 368 | 1197 | native 200 | 105 ms | 0,005 ms (COI) |
| firefox 155.0 | 200 | 0,000 | **0,180** (0,160–0,260) | 0,280 | 1,800 | 0,200 | 0,360 / 0,500 | 0,120 | 25/32 | 61 | 59 | 256 | 1200 | native 200 | 374 ms | 0,020 ms (COI) |
| firefox 155.0 | 400 | 0,000 | **0,180** (0,180–0,200) | 0,280 | 0,540 | 0,200 | 0,300 / 0,460 | 0,120 | 26/32 | 65 | 65 | 370 | 1200 | native 200 | 330 ms | 0,020 ms (COI) |
| webkit 26.6 | 200 | 0,000 | **0,140** (0,140–0,180) | 0,180 | 0,340 | 0,140 | 0,200 / 0,260 | 0,080 | 25/32 | 61 | 59 | 255 | 1200 | native 200 | 316 ms | 0,020 ms (COI) |
| webkit 26.6 | 400 | 0,000 | **0,160** (0,160–0,160) | 0,220 | 5,960 | 0,180 | 0,240 / 0,300 | 0,120 | 26/32 | 65 | 65 | 368 | 1200 | native 200 | 308 ms | 0,020 ms (COI) |

Drops je Grund (Median je Sekunde):

| Browser | Schüsse/s | cooldown | categoryLimit | soundLimit | globalLimit | culled | notLoaded | unknownSound | locked | muted |
|---|---|---|---|---|---|---|---|---|---|---|
| chromium | 200 | 112 | 51 | 0 | 0 | 93 | 0 | 0 | 0 | 0 |
| chromium | 400 | 182 | 84 | 0 | 0 | 95 | 0 | 0 | 0 | 0 |
| firefox | 200 | 114 | 51 | 0 | 0 | 93 | 0 | 0 | 0 | 0 |
| firefox | 400 | 182 | 85 | 0 | 0 | 95 | 0 | 0 | 0 | 0 |
| webkit | 200 | 112 | 49 | 0 | 0 | 94 | 0 | 0 | 0 | 0 |
| webkit | 400 | 185 | 84 | 0 | 0 | 94 | 0 | 0 | 0 | 0 |
<!-- bench:audio-browser:end -->

## 6. Abweichungen vom Plan / Befunde

1. **(In d1 behoben: Mixer mit Makeup-Kompensation + WaveShaper-Clip, Peak jetzt 0,963 / 0,729 / 0,963; siehe `audioeng-d1.md`, DECISIONS 37.)** **Limiter überschreitet 1,0 in Chromium und WebKit (Befund für den Mixer, `packages/audio/src/mixer`, nicht in meinen Pfaden).** Der `DynamicsCompressorNode` wendet laut Web-Audio-Spec automatisch einen Makeup-Gain `(1 / fullRangeGain)^0,6` an; bei den Limiter-Einstellungen (−3 dB, Ratio 20, Knie 0) sind das **+1,71 dB**. Mit 32 lauten Stimmen (ungebremst Peak 7,7) ergibt das in Chromium/WebKit Peak **1,173**, Firefox (eigene Implementierung) 0,887. Belegte Abhilfe (im Fall `limiter` als Diagnose gemessen, über die vorhandene Mixer-Option `destination`): ein Gain von −1,71 dB nach dem Kompressor → Peak 0,963 in allen drei Browsern; zusätzlich ein harter Sicherheits-Clip (WaveShaper mit 2-Punkt-Identitätskurve, klemmt auf ±1) garantiert ≤ 1,0. Empfehlung für den Mixer: `limiter → Gain(10^(−makeup/20)) → WaveShaper-Clip → destination` (makeup aus `LIMITER_SETTINGS` wie `compressorMakeupDb` in `src/offline/cases.ts`); danach wird `offline.spec.ts › limiter` ohne Änderung grün. Der Test bleibt bewusst streng (Abnahmekriterium).
2. **Firefox `decodeAudioData` liefert 1 Sample weniger** als Manifest/Software-Pfade. Der Vergleich „Längen gleich“ akzeptiert deshalb auf der nativen Seite das b2-Fenster (±2 Opus-Frames); die erzwungenen Pfade müssen weiterhin exakt die Manifest-Länge liefern (alle drei Browser: exakt). Korrelation bleibt 1,0.
3. **WebKit dekodiert nativ** (nicht über WebCodecs/WASM); WebCodecs und WASM sind dort trotzdem als erzwungene Pfade geprüft (exakte Längen).
4. **Autostart-Default:** ohne `autostart=1` startet das Gefecht mit dem Unlock-Klick (Nutzerführung); der Test-Hook startet explizit.
5. **Main-JS-Messung doppelt:** `engine.stats().mainJs` umfasst nur die letzten 1024 Frames (Ringpuffer der Engine); die Demo misst zusätzlich um alle Engine-Aufrufe über den ganzen Lauf (`engineCalls`) und getrennt die Frames mit Sim-Tick (`engineCallsTickFrames`), weil bei 60 fps nur jeder 6. Frame ein Event-Batch trägt und p95 über alle Frames sonst den Tick-Frames nur teilweise entspricht.
6. **Zusätze:** `resetStats()` im Hook, Diagnosefelder im Limiter-Fall, `?run=` auf `offline.html`, COOP/COEP-Header in `vite.config.ts`.

## 7. Bekannte Grenzen

- Die Stimmen-Spitze im Demo-Gefecht liegt bei 25/32, weil der Großteil außerhalb der Kamera-Hörweite verworfen wird (`culled`) und die Kategorie-Limits (weapon 10, impact 8, explosion 6) greifen; das globale Limit wird im Fall `limits` und in den Engine-Tests (c1) ausgereizt.
- Headless-Browser geben Audio auf das Standardgerät bzw. ein Null-Gerät aus; `baseLatency`/`outputLatency` sind daher nur Richtwerte.
- `performance.now()`-Auflösung auch mit Isolation 5 µs (Chromium) bzw. 20 µs (Firefox/WebKit); p50 von Frames ohne Tick liegt darunter und erscheint als 0.
- Der Szenario-Generator ist Demo-Code (Physik stark vereinfacht: Treffer per Wahrscheinlichkeit, kein Pathing).

## 8. Tests

- **Vitest** (`pnpm exec vitest run apps/audio-demo`): 26 Tests in 2 Dateien – `test/scenario.test.ts` (13: PRNG, Armeegröße, Rate 50/200/400 ± 5 % gesamt und je Sekunde, Bruchteil-Raten, Determinismus je Seed (FNV-Hash über alle Felder + Loop-Aufrufe) und Seed-Unterschied, Feldsemantik je Kind inkl. Oberflächen/Größen/Flags/Alerts, Waffen-Refs in der Default-Map, echter `EventRouter` + echtes Manifest ohne unmapped Events, Bau-Loops mit Pause/Wiederanlauf, Allokation < 1 MB über 10 000 Ticks bei 400/s, ungültige Raten), `test/helpers.test.ts` (13: URL-Parameter, Kamera/Listener/Rechtsvektor/Pan/Flug, TimingRing, Signal-Analyse, Makeup-Formel).
- **Playwright** (`test:e2e`): 8 Tests × 3 Browser = 24 (6 Offline-Fälle, Demo-Gefecht, Settings-Reload).

## 9. Selbsttest

| Befehl | Ergebnis |
|---|---|
| `pnpm exec vitest run apps/audio-demo` | ✅ 2 Dateien, 26 Tests, ≈ 2,5 s |
| `pnpm exec tsc -b apps/audio-demo` | ✅ |
| `tools/heavy pnpm exec tsc -p tsconfig.tests.json` | ✅ |
| `pnpm exec eslint apps/audio-demo --max-warnings 0` | ✅ |
| `tools/heavy pnpm --filter @faf/audio-demo build` | ✅ (Teil von test:e2e/bench) |
| `FAF_E2E_PORT=4583 tools/heavy pnpm --filter @faf/audio-demo test:e2e` | 22/24 ✅, `limiter` rot in Chromium + WebKit (§6.1) |
| `FAF_E2E_PORT=4583 tools/heavy pnpm --filter @faf/audio-demo bench:browser -- --update-docs` | ✅ läuft durch (≈ 9 min), Tabelle §5; Main-JS p95 0,16–0,23 ms in allen Browsern bei 200 und 400 Schüssen/s (Budget 0,5 ms eingehalten), Server danach beendet |
