# rfx-p7-bench-e2e-docs – FX-Benchmark, Screenshot-E2E, Track-Doku, Abschlussverifikation

Track TRACK-RENDERFX, Welle 2 (parallel zu rfx-p6). Stand: 2026-09-30. Gearbeitet im Worktree
`/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-renderfx` (der im Plan genannte Pfad
`/Users/logge/Documents/Projects/faf-renderfx` existiert nicht). Geändert wurden nur die eigenen Pfade;
`apps/fx-lab/src`, `packages/render-fx`, `packages/render` und `tools/render-bench` sind von diesem Paket unberührt.

## Umgesetzt

| Datei | Inhalt |
|---|---|
| `apps/fx-lab/scripts/bench.ts` | FX-Benchmark `pnpm bench:fx` (Ablauf und Flags siehe unten) |
| `apps/fx-lab/scripts/bench/scenarios.ts` | 7 Szenarien, Draw-Budget (`FX_DRAW_LIMIT` 6, `TOTAL_DRAW_LIMIT` 40), `BENCH_VIEWPORT` 1920 × 1080 |
| `apps/fx-lab/scripts/bench/report.ts` | `evaluateRun` (Rohdaten → p50/p95/p99, GPU-Segmente, Draw-Budget, Partikel-Deltas, Fehler), deutsche Markdown-Tabellen, Wertebereiche über Volläufe, Marker-Block `<!-- fx:results:begin/end -->` |
| `apps/fx-lab/scripts/bench/stats.ts` | Nearest-Rank-Perzentile, Summaries, Taktauflösung, Zahlenformat mit Dezimalkomma |
| `apps/fx-lab/scripts/bench/browsers.ts` | Launch-Optionen wie Root-Config, `serveDist` (virtuelle COI-Origin per `page.route`), `PageErrorLog`/`classifyConsole` (GL-Fehler vs. WebGL-Hinweise, erwartete Context-Loss-Meldungen) |
| `apps/fx-lab/scripts/bench/load.ts` | Fremdlast: Prozessliste (aktive GPU-Jobs ≥ 2 % CPU, fremde Playwright-/Vitest-Läufe) und GPU-Auslastung aus `ioreg` (IOAccelerator „Device Utilization %“ ≥ 25 % ohne eigene Last), `waitQuiet` |
| `apps/fx-lab/scripts/bench/png.ts` | PNG-Decoder (8 Bit RGB/RGBA, alle Filter) und Pixelstatistik: Luma-Spanne, Mittel, helle/schwarze/Feuer-Pixel je Region, mittlere Abweichung zweier Bilder |
| `apps/fx-lab/playwright.config.ts` | E2E-Konfiguration (Port `FAF_E2E_PORT ?? 4683`, siehe unten) |
| `apps/fx-lab/test/e2e/support/{port,lab}.ts` | Port, `openLab`, `expectHealthy`, `canvasShot`, `waitFrames`, Regionen |
| `apps/fx-lab/test/e2e/*.spec.ts` | `scenes`, `cap`, `fallback`, `context-loss`, `latency` |
| `apps/fx-lab/test/e2e/bench-report.test.ts` | 19 Vitest-Unit-Tests der Bench-Helfer (läuft in `pnpm test` mit) |
| `docs/status/track-renderfx.md` | Track-Doku mit Architektur, API, Effektliste, Szenen, Messwerten, E2E, Abnahme-Checkliste, Integrationsanleitung MS5/MS7/MS13/MS14 |
| `docs/DECISIONS.md` | Nachtrag „TRACK-RENDERFX“, Punkte 30–38 |
| `docs/STATUS.md` | Abschnitt „Track RENDERFX (Vorarbeit)“ am Dateiende |

## Benchmark `pnpm bench:fx`

```
cd /Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-renderfx
/Users/logge/Documents/Projects/flow-and-fire/tools/heavy pnpm bench:fx [-- --quick] [--update-docs]
  --browsers=chromium,firefox,webkit  --scenarios=battle,shields,…  --seconds=8  --warmup=2  --seed=1
  --wait=240 (s Fremdlast abwarten, 0 = aus)  --attempts=3  --no-build  --headed
  --docs-only (keine Messung: Marker-Block aus den Berichten in results/ neu schreiben)
```

- Szenarien: `battle` (Medium, Flug), `battle-low` (Cap 8.192), `battle-ldr` (`hdr=0`), `shields`, `big` (Explosion
  alle 4 s per `triggerBigExplosion()`), `lighting-csm` gegen `lighting-nocsm`. `--quick`: nur Chromium, 1 + 3 s,
  battle/shields/big.
- Je Szenario frische Seite, Warm-up, `resetSamples()`, Messung; In-Page-Abfrage alle 100 ms für die maximalen Draws
  je Segment (auch FX-Summe), Partikel, Schilde/Ripples, Beams/Trails, Shake. Ergebnis je Szenario: Frames/FPS,
  Frame-/Main-JS-/FX-JS-/Lab-JS-Perzentile (WebKit: Ø, weil `performance.now` in 1-ms-Schritten), Draws p50/max,
  GPU gesamt und je Segment (nur vollständig aufgelöste Frames, die neuesten 8 ausgelassen; ohne Timer-Query `null`
  → „n/v“), Partikel alive p50/max/Cap, dropped je Priorität im Messfenster, CSM-Neuaufbauten, Post-Zustand, Canvas.
- Exit 1 nur bei Fehlern: Seiten-/GL-Konsolenfehler, `__fxlab.error`, nicht registrierte Szene, keine Frames,
  FX-Draws > 6 oder Gesamt-Draws > 40. ms-Werte gaten nie (DECISIONS 16/38).
- Bericht `apps/fx-lab/results/fx-<Datum>[-quick].json` (git-ignoriert): Maschine, Browser-Versionen, Optionen,
  Last (loadavg, Fremdprozesse), alle Ergebnisse. Screenshots `test-results/fx-bench/<browser>-<szenario>.png`.

## Playwright-E2E `pnpm test:e2e:fx`

`FAF_E2E_PORT=4683 tools/heavy pnpm test:e2e:fx` baut das fx-lab und startet `vite preview --host 127.0.0.1
--port 4683 --strictPort`. Konfiguration und Prüfungen der fünf Specs: `docs/status/track-renderfx.md` §6.
`testMatch` ist `*.spec.ts`, damit die Vitest-Datei `bench-report.test.ts` im selben Ordner nicht von Playwright
geladen wird (und umgekehrt: die Root-Vitest-Config nimmt nur `*.test.ts`).

## Ergebnisse (lokal gemessen, Apple M5 Pro)

- **E2E** (`FAF_E2E_PORT=4683 tools/heavy pnpm test:e2e:fx`): 30/30 grün in Chromium 153, Firefox 155 und WebKit 26.6
  (57 s). cap: alive 6.185 / 8.192, dropped 0/0/10.138; context-loss: Bild vorher = nachher (Δ 0,00/255);
  latency: `particlesAlive` 0 → 910 genau einen Frame nach `triggerBigExplosion()`; gallery: 21 Effekte.
  Alle Screenshots angesehen und bewertet (track-renderfx.md §6).
- **Benchmark**: 3 Volläufe (3 Browser × 7 Szenarien) und 2 Chromium-Teilläufe (FX gegen fx=0), alle unter Fremdlast
  (MLX-GPU-Jobs anderer Projekte, bis 99 % GPU-Auslastung, dazu E2E/Vitest anderer Agenten). Belastbar:
  Draws max 19 (FX 3) in battle/shields, 17 (FX 1) in big, 16/14 in lighting mit/ohne CSM – Budget in allen Läufen
  eingehalten; Partikel battle Medium p50 6.800–7.650 (Cap 16.384, nichts verworfen), battle Low sättigt bei
  6.144 (= 0,75 · Cap), P2 verworfen, P0/P1 nie; Main-JS p95 Chromium 0,13–0,52 ms in ruhigeren Läufen,
  Firefox 0,24–0,80 ms, WebKit Ø 0,07–0,67 ms; 55–60 FPS (Frame-p50 16,7 ms) in ruhigeren Läufen, alle Browser.
  CSM-Kosten (Differenz lighting-csm − nocsm) ≈ 0,5–1,0 ms (≤ 2,5 ms ✅). GPU-Segmentwerte sind auf ANGLE-Metal durch
  einen Sockel von ≈ 2 ms je nicht leerem Segment verfälscht; „20 Schilde ≤ 1 ms“ ist im fx-lab deshalb nicht
  belastbar gemessen (⚠️, Smoke-Wert rfx-p4: 0,19–0,62 ms bei 960 × 540). Tabellen: track-renderfx.md §5.
- **Abschlussverifikation** (track-renderfx.md §12): `pnpm install --frozen-lockfile`, `typecheck`, `lint`,
  `test` (1.225 Tests), `smoke:fx` (3 Browser), fx-lab-Build, E2E, `bench:fx -- --quick`, render-Diff leer – alles grün.
- **Eigene Tests**: `pnpm exec vitest run apps/fx-lab/test/e2e` 19/19, `pnpm exec tsc -p tsconfig.tests.json --noEmit`
  grün, ESLint auf die eigenen Pfade grün.

## Offene Punkte

Siehe track-renderfx.md §11: belastbare GPU-Messung der Schilde (Vorschlag: ein zusammengefasstes FX-Timer-Segment
per URL-Parameter in `apps/fx-lab/src/app/app.ts`, gehört nicht zu rfx-p7) und Nachmessung ohne Fremdlast. In
`apps/fx-lab/src` und `packages/render-fx` wurden keine Fehler gefunden.


## Abweichungen

- Worktree-Pfad (s. o.).
- `webServer` mit `--host 127.0.0.1` (sonst bindet Vite auf macOS evtl. nur `::1`); Viewport und DPR 1 in jedem
  Projekt ausdrücklich gesetzt, weil „Desktop Safari“ DPR 2 mitbringt.
- `fallback.spec` versteckt `EXT_color_buffer_float` in **allen drei** Browsern (Vorgabe: Chromium) – dieselbe
  Prüfung, mehr Abdeckung.
- `context-loss.spec` vergleicht zusätzlich das eingefrorene Bild vor und nach dem Restore (mittlere Abweichung
  < 3/255); das belegt, dass Ring, LUT, Scorch-Texturen, Schild-Mesh, Post-Targets und CSM-Cache tatsächlich
  wiederhergestellt sind.
- Fremdlast-Erkennung erweitert (GPU-Auslastung per `ioreg`, aktive statt bloß vorhandene GPU-Prozesse), weil ein
  ruhender Modell-Server sonst jede Messung als belastet markiert und unbekannte ML-Skripte die GPU belegen.
- Zusätzliche Flags `--docs-only`, `--seed`, `--seconds`, `--warmup`.
- Prio-0-Überschuss für `cap.spec`: 256 (2 Kommandanten × 112, aufgerundet), aus `VARKAN_EFFECTS` nachgerechnet.

## Bekannte Grenzen

- GPU-Zeiten nur in Chromium; Firefox (auch mit `webgl.enable-privileged-extensions`) und WebKit exponieren headless
  keine Timer-Query.
- Die FX-Draw-Prüfung im Benchmark sieht je Frame nur die Gesamt-Draws; die Segmentaufteilung wird mit ≈ 10 Hz
  abgefragt (Maximum über die Abfragen). Die E2E prüfen sie im eingefrorenen Frame exakt.
- Die GPU-Auslastung wird vor jedem Szenario gemessen, nicht während (dann rendert der Benchmark selbst).
