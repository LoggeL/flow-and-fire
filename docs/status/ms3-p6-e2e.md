# MS3 P6: Browser-Abnahme

Stand 2026-09-30 (Europe/Berlin). Lokal Apple M5 Pro, Playwright headless. Der vollständige Lauf begann am 2026-09-29 um 23:52:36 UTC und endete nach 886,183 s mit Exit 0: 174 Fälle, 168 bestanden, sechs begründete Skips, null Fehler und null Flaky-Fälle. Ein Worker, Chromium → Firefox → WebKit, gegen 4283 (COOP/COEP/SAB) und 4284 (Transfer). HMR verwendet nur Chromium auf einem temporären Vite-Server auf 4285.

Befehl: `FAF_E2E_PORT=4283 ./tools/heavy pnpm exec playwright test --workers=1`, nach dem vollständigen aktuellen Build. Weder Runtime-Source noch Tests wurden während dieses Laufs verändert. Es gab keine fokussierten Wiederholungen. Vollständiger Report, Log, alle 121 Attachments und die sechs separaten Latenzdateien sind vor weiteren Prüfungen unter `.git/consolidation/game-browser-final/` gesichert; Originalreport `test-results/e2e.json`, Prozesslog `.git/consolidation/checks-final-game-browser.log`. `matrix.json` enthält jeden Testtitel, Engine, Status und Skip-Grund; `attachments.json` ordnet alle Rohdateien zu.

## Matrix

S = SAB/4283, T = Transfer/4284, G = gemeinsamer Test bzw. HMR/4285. Die Zahlen zählen sämtliche Fälle der jeweiligen Spec.

| Spec | Chromium | Firefox | WebKit |
|---|---|---|---|
| boot.spec.ts | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden |
| braidwater.spec.ts | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden |
| camera.spec.ts | S: 3 bestanden, 1 Skip; T: 3 bestanden, 1 Skip | S: 4 bestanden; T: 4 bestanden | S: 3 bestanden, 1 Skip; T: 3 bestanden, 1 Skip |
| console.spec.ts | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden |
| context-loss.spec.ts | S: 1 bestanden; T: 1 bestanden; G: 1 bestanden | S: 1 bestanden; T: 1 bestanden; G: 1 bestanden | S: 1 bestanden; T: 1 bestanden; G: 1 bestanden |
| control-groups.spec.ts | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden |
| flight.spec.ts | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden |
| hmr.spec.ts | G: 1 bestanden | G: 0 bestanden, 1 Skip | G: 0 bestanden, 1 Skip |
| latency.spec.ts | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden |
| map-load.spec.ts | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden |
| map-roundtrip.spec.ts | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden |
| move.spec.ts | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden |
| orders.spec.ts | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden |
| pathing.spec.ts | S: 2 bestanden; T: 2 bestanden | S: 2 bestanden; T: 2 bestanden | S: 2 bestanden; T: 2 bestanden |
| pause.spec.ts | S: 2 bestanden; T: 2 bestanden | S: 2 bestanden; T: 2 bestanden | S: 2 bestanden; T: 2 bestanden |
| picking.spec.ts | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden |
| selection.spec.ts | S: 2 bestanden; T: 2 bestanden | S: 2 bestanden; T: 2 bestanden | S: 2 bestanden; T: 2 bestanden |
| setons.spec.ts | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden |
| smoke.spec.ts | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden |
| terrain.spec.ts | S: 1 bestanden; T: 1 bestanden; G: 1 bestanden | S: 1 bestanden; T: 1 bestanden; G: 1 bestanden | S: 1 bestanden; T: 1 bestanden; G: 1 bestanden |
| tessera.spec.ts | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden |
| transports.spec.ts | G: 1 bestanden | G: 1 bestanden | G: 1 bestanden |
| zoom.spec.ts | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden | S: 1 bestanden; T: 1 bestanden |

Chromium: 56 bestanden/2 Skips; Firefox: 57/1; WebKit: 55/3. Die vier Pointer-Confinement-Skips in Chromium/WebKit betreffen beide Transporte: `Pointer Lock wird im headless ... nicht gewährt (requests 1, errors 2)`. Die entsprechenden Firefox-Fälle bestehen. Die zwei HMR-Skips in Firefox/WebKit sind die ursprüngliche Chromium-only-Dev-Abnahme. Diese Skips wurden nicht neu eingeführt.

## Messwerte

Je Zoom-Fall: 200 echte Mausboxen, 29.213 erwartete und ausgewählte Handles, 29.213 Treffer, null Fehlwahlen, Recall 100 % und Fehlwahlquote 0 %. Alle sechs funktionalen ≥99-%-/≤1-%-Gates bestehen. Ein Icon-Draw und null Unit-Mesh-Draws in Z2 sowie Ring-/HP-/Icon-Pixel und Context-Restore sind in der Matrix geprüft.

| Engine / Transport | Zoom-FPS | rAF-Leerlauf-FPS | Main-JS p95 ms |
|---|---:|---:|---:|
| chromium / SAB | 60.051 | 60.006 | 0.205 |
| chromium / Transfer | 60.061 | 59.880 | 0.200 |
| firefox / SAB | 60.010 | 60.024 | 0.620 |
| firefox / Transfer | 60.113 | 60.024 | 1.000 |
| webkit / SAB | 59.092 | 60.168 | 0.220 |
| webkit / Transfer | 59.488 | 58.824 | 1.000 |

Die Zoom-FPS liegen in allen sechs Fällen über der bestehenden Grenze `min(60, 0,95 × rAF-Leerlauftakt)`. `FAF_PERF_GATE` war nicht aktiviert; dies ist eine lokale Messung und keine native Safari-/iGPU-Abnahme. Die Rohwerte stehen in den sechs `*-MS3-zoom.json`-Attachments.

| Engine / Transport | Ack p95 ms | erster bewegter Pixel, nah p95 ms | erster bewegter Pixel, Startansicht p95 ms | Last Main-JS p95 ms |
|---|---:|---:|---:|---:|
| chromium / sab | 101.565 | 117.445 | 239.405 | 0.335 |
| chromium / transfer | 107.100 | 125.900 | 235.300 | 0.400 |
| firefox / sab | 111.740 | 133.800 | 252.220 | 0.980 |
| firefox / transfer | 102.000 | 133.000 | 243.000 | 1.000 |
| webkit / sab | 110.060 | 143.260 | 246.360 | 0.320 |
| webkit / transfer | 110.000 | 134.000 | 255.000 | 1.000 |

SPK6: Marker maximal ein Frame und Command-Anwendung maximal ein Tick, in allen sechs Fällen. Alle nominalen 100-ms-Ack-Berichtsfelder sind false (101,565–111,740 ms); die dokumentierte Ack-Grenze inklusive eines rAF liegt bei 116,64–117 ms. Die Pipeline-Nahansicht liegt unter 150 ms, die Startansicht darüber (235,300–255,000 ms). `FAF_LATENCY_GATE` war nicht aktiviert. Die bestanden funktionalen Tests sind kein Beleg für ≤150 ms in der Startansicht oder ≤100 ms Ack. Die sechs `latency-<engine>-<transport>.json` enthalten Phasen, Einzelversuche, Last/FPS und unveränderte Kriterien.

Chromium-HMR: 235 ms Dateiänderung → Anwendung, genau ein Reload, gemessene Wegstrecke pro Sekunde 2,997701 → 8,998005 WU. Neuer simHash 3263732778, tainted-Log und HUD sowie Syntaxfehler ohne weiteren Reload und weiterlaufende Sim bestehen. Alle 18 kanonischen Blueprint-/Locale-Eingabedateien sind nach dem Test bytegleich zu den erhaltenen MS3-Eingaben (`hmr-input-readback.json`). HMR schrieb ausschließlich in temporäre Kopien; Scratch-Verzeichnis und Vite-Server sind entfernt.

## Grenzen und Abschluss

Der Browser-Pathing-Hook prüft statisches Terrain/Clearance aus ClientMap, keine replizierten Footprints. Die Pathing-Abnahme beobachtet jeden veröffentlichten Frame in 20-Tick-Batches, nicht jeden internen Tick. Die strengere Never-Blocked-Invariante wird in den Headless-Szenarien/Goldens geprüft. Gemischte Gruppe: 40/40 Ankunft, genau eine Anfrage und Slot-Abweichung ≤1,5 WU; das geschnittene Watch-Korridorhindernis löst exakt den betroffenen Repath aus. Kein Test-/Workload-/Gate-Wechsel.

Vorheriger globaler Unit-/Property-Lauf: 2921/2921 Tests in 269 Dateien, Exit 0 (271,29 s). Nach der isolierten CLI-Ausgabepfadkorrektur bestanden voller Typecheck und Lint (1184 Module, 4333 Abhängigkeiten), ohne Änderung von `runBench` oder Spielcode. Der tatsächliche AI-Bench-Quick-Lauf aus dem Paketordner bestätigt den kanonischen Standardpfad; alle vier vorherigen Benchmark-Berichte wurden SHA256-geprüft bytegleich wiederhergestellt.

Nach HMR besteht der erneute Asset-Check: elf Dateien aktuell, Exit 0 (`.git/consolidation/checks-final-assets.log`). Auf 4283/4284/4285 verbleiben keine Listener; `cleanup.json` enthält die Kontrolle. Alle eigenen Testprozesse sind beendet. User-Server, Karten, Goldens und Archive wurden nicht geändert. Native Safari, iGPU und die ausdrücklich aktivierten Zeit-/FPS-Gates bleiben separate Abnahmen.
