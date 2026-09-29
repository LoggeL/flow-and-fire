# Projektstatus Flow & Fire (FAF)

Konvention: Jedes Arbeitspaket schreibt sein Fragment nach `docs/status/<Paket-ID>.md` (Umgesetztes, Verträge für
Folgepakete, Abweichungen, bekannte Grenzen). Am Meilensteinende konsolidiert das Abschlusspaket die Fragmente in
diese Datei; die Fragmente bleiben als Detailbelege liegen.

## Stand MS1 – Spikes & deterministisches Skelett

**Stand 2026-09-29 (nach Review-Nachbesserung): MS1 abgeschlossen; alle Abnahmekriterien erfüllt bis auf zwei
Latenzkriterien aus SPK6, die nur teilweise erfüllt sind** (Klick → erster bewegter Pixel in der Startansicht p95
216–283 ms statt ≤ 150 ms; seq-Bestätigung p95 99,6–108,6 ms statt ≤ 100 ms – Abweichung mit Begründung unter
„Abnahme“ und DECISIONS 11). Messwerte lokal auf Apple M5 Pro, kein Referenz-Laptop/GPU-Runner – DECISIONS 5. Feature-IDs MS1: **S1, S2, S3, S4, S5, S7, S8, P1, A5**; Grundbausteine
G11, G14, G20.

Spielbar mit `pnpm dev`: Der Browser zeigt die feste 512-WU-Testebene mit 1.000 eigenen (blau) und 24 fremden
(rot) Würfeln, instanziert und GPU-interpoliert; Rechtsklick bewegt die ausgewählten bzw. alle eigenen Würfel über
die binäre Command-Pipeline in den deterministischen Sim-Worker; P pausiert (Kamera und Befehle laufen weiter),
N steppt, ^ / ` / F1 öffnet die Dev-Konsole. Die Sim läuft bitgleich in Node, Chromium, Firefox und WebKit.

Arbeitspakete (Wellen 0–4): [P0-scaffold](status/P0-scaffold.md), [P1-heap-protocol](status/P1-heap-protocol.md),
[P2-render](status/P2-render.md), [P3-blueprints-sim](status/P3-blueprints-sim.md), [P4-client](status/P4-client.md),
[P5-sim-host](status/P5-sim-host.md), [P6-headless](status/P6-headless.md), [P7-game-e2e](status/P7-game-e2e.md).

### MS1 starten und prüfen

Voraussetzungen: Node ≥ 24, pnpm 11 (`corepack enable`), einmalig `pnpm install` und
`pnpm exec playwright install chromium firefox webkit`.

| Zweck | Befehl |
|---|---|
| Spiel im Browser (Dev) | `pnpm dev` → http://localhost:5173/ (COOP/COEP aktiv, SAB-Transport); Server mit Strg+C beenden |
| Produktionsbuild lokal | `pnpm build`, dann `pnpm --filter @faf/game run serve --port 4173 --coi` → http://localhost:4173/ (leitet auf `/b/<buildHash>/`) |
| Statische Prüfung | `pnpm typecheck` und `pnpm lint` |
| Unit-/Property-Tests | `pnpm test` (Vitest, max. 4 Worker) |
| Goldens / Cross-Engine | `pnpm --filter @faf/headless goldens`, `pnpm test:xengine` |
| Benchmarks | `pnpm bench` (Tabellen in P6 nur mit `pnpm bench -- --update-docs`) |
| E2E (3 Browser, mit/ohne COOP/COEP) | `pnpm test:e2e` (baut vorher; Latenz-ms-Gates zusätzlich mit `FAF_LATENCY_GATE=1`) |
| Alles nacheinander | `pnpm ci:local` |

Steuerung im Spiel: Linksklick/-ziehen wählt aus (Klick ins Leere leert die Auswahl, Strg/⌘+A wählt alle eigenen),
Rechtsklick bewegt, S tippen = Stop, WASD/Pfeile bzw. mittlere Maustaste = Kamera, Mausrad = Zoom zum Cursor,
P = Pause, N = Einzelschritt, ^ / ` / F1 = Dev-Konsole (`help`, `spawn`, `kill`, `pause`, `resume`, `step`, `speed`,
`hash`, `budget`, `export`, `transport`). URL-Parameter: `?cubes=`, `?enemy=`, `?seed=`, `?transport=sab|transfer`,
`?autostart=0`.

Legende Abnahme: ✅ erfüllt · ⚠️ teilweise erfüllt / Abweichung dokumentiert · ❌ nicht erfüllt (in MS1 keins).

### Paketübersicht

| Paket | Inhalt MS1 | Tests (Vitest) | Fragment |
|---|---|---|---|
| Root-Tooling | pnpm-11-Workspace, TS strict + Project References, ESLint 10 + `sim/determinism`, dependency-cruiser (§3.2), Vitest (≤ 4 Forks), Playwright (3 Browser, 1 Worker, Server 4183 COI / 4184 ohne, seit MS2 per `FAF_E2E_PORT` verschiebbar) | – | P0 |
| `tools/eslint-plugin-sim` | Regel `sim/determinism` (Math-Whitelist, Date/Timer/async/Map-State/`**`/Float32/16Array, crypto, parseFloat/`Number()`, DataView-Float-Zugriffe, Division ohne sofortiges Abschneiden …) + Konfigurationstest (Regel greift in allen Sim-Paketen) | 113 (103 RuleTester + 10 Config) | P0 |
| `@faf/fixed` | Fx Q20.12, FxSmall, Ang16 + LUTs (eingecheckt, Hash gepinnt), fxMul/fxDiv/isqrt mit Korrektur, rng32, xxHash32, SafeInt | 46 | P0 |
| `@faf/heap` | Arena = eine `WebAssembly.Memory` ohne Grow, Table-DSL (SoA), Dense, Slab, Raw-Regionen, Handles `index:20\|gen:12`, FIFO-Freelist, Layout-Hash, Regel-/Voll-Hash, Snapshot/Restore | 32 | P1 |
| `@faf/protocol` | Opcodes (append-only), Command-Batch-Codec, Payloads, Ctl/Host-Nachrichten, Frame-Layout (UnitRecord 48 B …), FrameWriter/Reader, FrameTransport SAB-Triple-Buffer + Transfer-Ping-Pong, simId | 40 | P1 |
| `@faf/rules` | 128-Bit-Kategorie-Masken, Kategorie-Ausdrücke (Bytecode), MotionLayer, `SIM_TICK_HZ` | 9 | P3 |
| `@faf/blueprints` | TypeBox-Schemas, defineUnit/definePatch, extends/Merge, Compiler → `sim.bin`/`view.json`/`bundle.json`, simHash/viewHash, Placeholder-Spec | 18 | P3 |
| `@faf/sim` | deterministische Würfel-Sim (Phasen 1/2/7/8/15/16), Units-Schema §3.5, 16 Armies + Allianzmatrix, Spatial-Grid (Counting-Sort, fein 4 WU/grob 32 WU), Separation, FrameWriter, `SIM_BUILD` | 28 | P3 |
| `@faf/sim-host` | Worker-Entry, Scheduler (MessageChannel-Selbstping, 0,25–3x, ≤ 3 Ticks/Slice, Sim-Lag), CommandSources, Command-Log-Recorder (OPFS + Memory), Keyframes/Seek, SimHost, HeadlessSim, Stats | 50 | P5 |
| `@faf/render` | WebGL2-RHI im WebGPU-Stil, Context-Loss-Registry, std140, RtsCamera (Int-Split), Instancing (UnitRecord = Instanzdaten, Ring mit 3 Regionen), GPU-Interpolation, Testebene, Overlays | 39 | P2 |
| `@faf/client` | SimLink, Kamera-Controller, Input/Actions (Fokusregel), Ebenen-Picking (CPU), Selektion, CommandBuilder (seq/Ack), FrameStream (adaptiver Render-Delay), Metriken (SPK6) , GameClient | 61 | P4 |
| `@faf/game` (`apps/game`) | Vite/Preact-App: Bootstrap, Worker-SimLink, HUD, Dev-Konsole, Budget-Overlay, Test-Hooks, Build unter `/b/<buildHash>/`, `serve.mjs` | 24 | P7 |
| `@faf/headless` (`tools/headless`) | ScenarioBuilder + 2 L2-Goldens, Cross-Engine-Harness (Node + 3 Browser-Worker, kalt/warm), Tick-Bench, SPK1, SPK5 | 11 | P6 |
| `deploy/` | `nginx.conf` (COOP/COEP/CORP, MIME, immutable `/b/<hash>/`, Root-Redirect) | Docker-`nginx -t` + Browserlauf | P7 |
| `test/e2e` | smoke, boot, move, pause (+ visibilitychange), console, transports, latency (SPK6), context-loss – je Chromium/Firefox/WebKit | 51 E2E | P7 |

Summe: 60 Testdateien, **471 Unit-/Property-Tests**, 51 E2E-Tests, 40 Cross-Engine-Hash-Ketten.

### Umsetzungsorte der Feature-IDs und Grundbausteine

| ID | Inhalt (MS1-Umfang) | Umsetzung | Beleg |
|---|---|---|---|
| **S1** | 1.000 instanzierte, GPU-interpolierte Einheiten | `packages/render/src/passes/units.ts` (ein Draw pro Visual, UnitRecord als Instanzdaten, `mix(prev, cur, alpha)` im VS, `noInterp`), `packages/client/src/frames.ts` (adaptiver Render-Delay ≈ ½ Tick), `apps/game/src/game.ts` | E2E `boot`, `move`; `packages/render/test/webgl2-device.test.ts`, `packages/client/test/frames.test.ts` |
| **S2** | Festkomma-Mathe, LUTs, RNG, Hash | `packages/fixed/src/*` | `packages/fixed/test/oracle.test.ts`, `angle.test.ts`, `xxhash32.test.ts` |
| **S3** | Commands per `seq`, binär, Anwendung in (army, seq)-Ordnung | `packages/protocol/src/{command,payloads,ops}.ts`, `packages/client/src/commands.ts`, `packages/sim/src` (CommandApply) | E2E `move`, `pause`; `packages/protocol/test/command.test.ts`, `packages/sim/test/commands.test.ts` |
| **S4** | Sim-Worker, Scheduler, Pause/Speed/Step, FrameTransport | `packages/sim-host/src/{worker,host,scheduler,clock}.ts`, `packages/protocol/src/transport/*`, `apps/game/src/worker-link.ts` | E2E `pause`, `console`, `transports`; `packages/sim-host/test/{scheduler,host,transport,worker}.test.ts` |
| **S5** | Datenmodell: Arena, Table-DSL, Handles, Spatial-Grid | `packages/heap/src/*`, `packages/sim/src` (Schema §3.5, Grids) | `packages/heap/test/*`, `packages/sim/test/spatial.test.ts` (Query == Brute-Force) |
| **S7** | Hash-Kette, Command-Log, Replay, Restore, Cross-Engine | `packages/heap/src/hash.ts`, `packages/sim-host/src/{recorder,log-format,sources,keyframes,core,headless}.ts`, `tools/headless/src/{scenario,goldens,jobs}.ts` | `pnpm test:xengine`, `packages/sim-host/test/l4-replay.test.ts`, `tools/headless/test/goldens.test.ts` |
| **S8** | Dev-Konsole, Cheats als Commands, Phasenbudget, Export | `apps/game/src/{console-commands,game}.ts`, `apps/game/src/ui/App.tsx`, `packages/sim-host/src/stats.ts` | E2E `console`; `apps/game/test/console-commands.test.ts` |
| **P1** | eigene WebGL2-Pipeline hinter RHI | `packages/render/src/{rhi,webgl2,passes,renderer.ts}` | `packages/render/test/*`, E2E `boot`, `context-loss`, `pnpm --filter @faf/render smoke` |
| **A5** | Pause: Tick steht, Kamera + Command-Annahme laufen | `packages/sim-host/src/{scheduler,host}.ts` (Pause, paused-Bit sofort), `packages/client/src/client.ts`, `apps/game/src/game.ts` (visibilitychange) | E2E `pause`; `packages/sim-host/test/host.test.ts`, `packages/client/test/client.test.ts` |
| **G11** | 16 Armies, Allianzmatrix | `packages/sim/src` (Tabellen `armies`, `alliance`, `setAlliance`, `isAllied`) | `packages/sim/test/world.test.ts` |
| **G14** | FrameTransport SAB/Transfer, UnitRecord/PartStream-Layout, GPU-Interpolation | `packages/protocol/src/{frame.ts,transport/*}`, `packages/render/src/instance-layout.ts`, `packages/client/src/frames.ts` | `packages/protocol/test/transport.test.ts`, `packages/sim-host/test/transport.test.ts`, E2E `transports`, `packages/render/test/instance-layout.test.ts` |
| **G20** | Monorepo, lokale CI (5→4 Engines), COOP/COEP-Hosting, `/b/<buildHash>/` | Root-Configs, `package.json`-Skripte (`ci:local`), `apps/game/{vite.config.ts,scripts/serve.mjs}`, `deploy/nginx.conf` | E2E `smoke`; `pnpm build`; Docker-Prüfung von nginx (P7) |

### Abnahme MS1 (PLAN §5.2 und Definition of Done)

Alle Werte lokal gemessen (Apple M5 Pro, Darwin 27, Node 24.18, Playwright 1.63 headless: Chromium 153 mit ANGLE/Metal,
Firefox 155, WebKit 26.6). „Bun“ ist durch WebKit (JavaScriptCore) ersetzt (DECISIONS). FPS-/GPU-Werte:
**lokal gemessen (Apple M5 Pro), kein GPU-Runner**.

| Kriterium (PLAN §5.2) | Status | Messwert | Beleg |
|---|---|---|---|
| Hash-Kette über 2.000 Ticks bitgleich in Node, ~~Bun~~ (→ WebKit/JSC), Chromium, Firefox, WebKit, JIT kalt und warm | ✅ **erfüllt** | 40 Ketten (2 Goldens × 4 Engines × kalt/warm/3 Aufwärmläufe) == Golden; `cubes-1000-move` kalt/warm: Node 732/853 ms, Chromium 707/646, Firefox 771/758, WebKit 491/453 | `pnpm test:xengine` (Bericht `tools/headless/results/xengine-<datum>.json`, lokal, git-ignoriert) |
| L1: BigInt-Orakel ohne Abweichung in 10⁶ Fällen (fxMul, fxDiv, isqrt) | ✅ **erfüllt** | je 10⁶ Fälle + Randfälle, 0 Abweichungen | `packages/fixed/test/oracle.test.ts` |
| L1: LUT-Hash festgeschrieben | ✅ **erfüllt** | `sin_quarter.bin` `0x5A60F785`, `atan.bin` `0x7BB4897C` | `packages/fixed/test/angle.test.ts` |
| `fxMulSmall` stimmt im Debug-Build mit `fxMul` überein | ✅ **erfüllt** | 10⁶ Fälle, Debug-Vergleich aktiv | `packages/fixed/test/oracle.test.ts` |
| L4: Log-Replay ergibt bei Tick 2.000 denselben Hash | ✅ **erfüllt** | 200 Hashes, 0 Abweichungen; End-Regel- und Voll-Hash gleich; Desync-Test findet Manipulation genau bei Tick 1.100 | `packages/sim-host/test/l4-replay.test.ts` |
| L4: Arena-Restore bei Tick 1.000 ergibt bei Tick 2.000 denselben Hash | ✅ **erfüllt** | Regel- und Voll-Hash gleich (frische Sim und abgewichene Original-Sim); Keyframe-Seek == Direktlauf | `packages/sim-host/test/l4-replay.test.ts`, `packages/sim/test/determinism.test.ts` |
| 1.000 fahrende Würfel: Sim p95 ≤ 2 ms im langsamsten Engine-Worker (inkl. Hash-Tick) | ✅ **erfüllt** | Tick-Bench max. p95 über mehrere Läufe **0,22–0,36 ms** (jeweils Node kalt; der höhere Wert unter Fremdlast, Load ≈ 5); Browser-Worker p95 Chromium 0,15–0,31, Firefox 0,20–0,22, WebKit 0,08 ms; Hash-Tick p95 ≤ 0,44 ms. Im Spiel (10-Hz-Takt, alle Würfel auf einen Punkt): p95 0,74–1,16 ms | `pnpm bench` (Bericht `tools/headless/results/bench-<datum>.json`, lokal); Tabellen in [P6](status/P6-headless.md) = Stand des letzten `pnpm bench -- --update-docs`; Spielwerte `test-results/latency-*.json` |
| 1.000 fahrende Würfel: ≥ 60 FPS (GPU-Runner) | ✅ **erfüllt, lokal gemessen (Apple M5 Pro), kein GPU-Runner** | Chromium 60,0 (vsync), Firefox 120,0, WebKit 57,3–58,1 (headless-rAF-Takt); GPU (Chromium Timer-Query) ≈ 0,3 ms | E2E `latency` (Lastphase 3 s, 1.000 fahrend) → `test-results/latency-*.json`; P2-Smoke |
| 1.000 fahrende Würfel: Main-JS ≤ 2 ms | ✅ **erfüllt** | p95 Chromium 0,17 / 0,20 ms, Firefox 0,26 ms (4174: ≤ 1,0 ms, 1-ms-Uhr), WebKit 0,18 ms (4174: ≤ 1,0 ms) | E2E `latency` (gegated ≤ 2 ms) |
| SAB- und Transfer-Transport liefern bytegleiche Frames | ✅ **erfüllt** | Node: 204 Frames eines Laufs bytegleich; Browser: Ticks 1..200 per `step` identisch in Chromium, Firefox, WebKit (Ketten-Fingerprint `4cb4c3aa` in **allen** Browsern gleich) | `packages/sim-host/test/transport.test.ts`, `packages/protocol/test/transport.test.ts`, E2E `transports` → `test-results/transport-hashes-*.json` |
| E2E läuft ohne COOP/COEP | ✅ **erfüllt** | jede Spec (außer dem SAB-Teil von `transports`) läuft zusätzlich gegen 4174 ohne COOP/COEP (Transfer); gilt nach dem MS2-Review auch für die MS2-Specs `camera`, `picking`, `flight` (Ports seit MS2: 4183/4184) | `pnpm test:e2e` (51/51; `smoke` prüft den Root-Status seit dem Review per Request statt über `goto()`, Firefox-stabil) |
| Pause: Tick steht, Kamera und Command-Annahme laufen weiter | ✅ **erfüllt** | Tick steht ≥ 1,1 s, Kamera verschiebt/zoomt, Move angenommen, nach Step (N) genau 1 Tick + Ack, nach Resume ≥ 45/50 Würfel am Ziel unterwegs; Tab verborgen ⇒ Pause | E2E `pause` |
| Latenz: Klickmarker ≤ 1 Frame | ✅ **erfüllt** | max. 1 rAF in allen 6 Kombinationen (je 106 Klicks, in Frames gezählt – gegated) | E2E `latency`, `move` |
| Latenz: Klick → erster bewegter Pixel ≤ 150 ms (p95) | ⚠️ **teilweise erfüllt – Abweichung** | **Startansicht (105 WU, Spielansicht): p95 216–283 ms – nicht erfüllt.** Nur die reine Pipeline (6 WU Kameraabstand, ≈ 0,007 WU/px) liegt bei p95 115–157 ms (5 von 6 Kombinationen ≤ 150 ms; WebKit/Transfer 157 ms bei rAF-Stalls bis 87 ms unter Fremdlast, frühere Läufe 117–133 ms). Ursache: Die Würfel beschleunigen aus dem Stand mit 3 WU/s² (0,03 WU im ersten Tick), der erste sichtbare Pixel in der Startansicht kommt 1–2 Ticks nach dem Befehl; Transport + Tick + Render-Delay allein liegen bei ≈ 100–120 ms. Behebung gehört zum Bewegungsgefühl (SPK2/MS3: Sofort-Drehung bzw. Anfahrverhalten), nicht zum Transport (DECISIONS 11) | E2E `latency` → `test-results/latency-*.json` (`criteria.firstMovedPixelStartViewLe150`); ms-Gate nur im Messlauf `FAF_LATENCY_GATE=1` |
| Latenz: `seq`-Bestätigung ≤ 100 ms | ⚠️ **teilweise erfüllt – Abweichung** | sim-seitig **erfüllt und gegated**: jeder `cmd` wird im nächsten Tick angewandt (`cmdApplyTicksMax = 1` in allen 6 Kombinationen). Am Client (Ack-Frame am rAF-Poll) p95 **99,6–108,6 ms** – über 100 ms in 4 von 6 Kombinationen. Ursache: 10-Hz-Takt – ein Befehl wartet im Mittel ½, im p95 ≈ 0,95 Tick auf den nächsten Tick, dazu Frame-Publikation und ≤ 1 Anzeige-Frame; ≤ 100 ms p95 wäre nur mit Tick-Vorziehen bei Befehlseingang möglich, das den festen Sim-Takt (Replay/MP-Vertrag) bricht (DECISIONS 11) | E2E `latency` (`criteria.ackP95Le100`, Host-Stats `cmdApplyTicksMax`), `packages/sim-host/test/host.test.ts` |
| Allokation warm < 1 MB über 10.000 Ticks | ✅ **erfüllt** (seit Review direkt gemessen) | **Allokation** (nicht mehr nur Retention): Heap-Wachstum ohne GC in 20 Blöcken à 500 Ticks nach je einem Voll-GC, GC-Ereignisse per `PerformanceObserver` (0 GCs in den Blöcken). Sim inkl. writeFrame + Hash **≈ 352 KiB**; Host-Pfad (Quellen, Recorder, Step, Keyframes, Probe, Frame, SAB, `stats`-Nachricht) **≈ 534 KiB** – vorher ≈ 5,8 MiB, behoben: `stats`-Nachricht wird wiederverwendet, Perzentile ohne `subarray`/Closure, SAB-Consumer cacht Slot-Views. Node-`performance.now()` allokiert selbst pro Aufruf (JS-Wrapper, ≈ 1 MiB/10.000 Ticks) und ist per Zähluhr ausgeklammert. Kanarienvogel-Test belegt, dass 256 B/Tick erkannt werden. Kalt ≈ 1,0 MiB (Toleranz 8 MiB); Client 0 GCs in 600 rAFs | `packages/{sim,sim-host}/test/alloc.test.ts` (+ `test/support/alloc.ts`), `packages/client/test/client.test.ts` |
| DoD: Playwright-Demo-Pfad | ✅ **erfüllt** | boot → move → pause → console → context-loss in 3 Browsern × 2 Servern | `pnpm test:e2e` |
| DoD: ≥ 2 L2-Goldens | ✅ **erfüllt** | `cubes-1000-move` (End-Regel `0x0f1bcb7c`, Voll `0xdf2c05a7`), `cubes-churn` (`0xc10b95e3` / `0xa3fefa9a`), je 200 Trail-Hashes, aufgenommen mit `simBuild` `faf-sim/ms1.2` | `tools/headless/goldens/*.json`, `pnpm --filter @faf/headless goldens` |
| DoD: L0–L4 grün auf allen Engines | ✅ **erfüllt** | L0 typecheck/lint/dep-cruiser grün; L1–L2, L4 in Node; L3 in Node + 3 Browsern | Abschluss-Verifikation unten |
| DoD: Allokationstest | ✅ **erfüllt** | siehe Zeile „Allokation“ | s. o. |
| DoD: E2E ohne COOP/COEP | ✅ **erfüllt** | Port 4174 | s. o. |

Zusätzliche Kriterien des Arbeitsplans (`docs/plans/MS1.json`):

| # | Kriterium | Status | Beleg |
|---|---|---|---|
| 1 | Monorepo, `install --frozen-lockfile`, `typecheck`, `lint` (inkl. `sim/determinism`-RuleTester + dep-cruiser) grün | ✅ erfüllt | Abschluss-Verifikation |
| 2 | L1 inkl. xxHash32-Referenzvektoren | ✅ erfüllt | `packages/fixed/test/xxhash32.test.ts` |
| 3 | L2-Goldens mit Prüfung und `--update` mit Diff | ✅ erfüllt | [P6](status/P6-headless.md) |
| 4 | L3 kalt/warm, Bun → WebKit | ✅ erfüllt | `pnpm test:xengine` |
| 5 | L4 inkl. Keyframe-Seek | ✅ erfüllt | `l4-replay.test.ts` |
| 6 | Sim-Budget, p50/p95/p99 je Phase dokumentiert | ✅ erfüllt | [P6](status/P6-headless.md) (Tabellen je Engine/Phase), [P5](status/P5-sim-host.md) |
| 7 | Allokation warm/kalt | ✅ erfüllt | s. o. |
| 8 | Transport bytegleich (Node + E2E), Demo-Pfad ohne COOP/COEP | ✅ erfüllt | s. o. |
| 9 | Spielbar mit `pnpm dev`, Rechtsklick über binäre Pipeline, E2E in 3 Browsern | ✅ erfüllt | Abschluss-Verifikation (Dev-Server-Check), E2E `move` |
| 10 | Pause mit Anwendung nach resume/step | ✅ erfüllt | E2E `pause` |
| 11 | Latenz je Browser und Transport | ⚠️ gemessen; Kriterien teilweise erfüllt (Abweichung, s. o.) | Tabelle SPK6 |
| 12 | Main-JS ≤ 2 ms p95 + FPS protokolliert | ✅ erfüllt | Tabelle SPK6 |
| 13 | Dev-Konsole spawn/kill/pause/resume/step/speed/hash/budget/export, Cheats als Commands | ✅ erfüllt | E2E `console` |
| 14 | Recorder ab Tick 0 (OPFS + Fallback, MARKs), Scheduler (Selbstping, 100 ms/speed, ≤ 3 Ticks/Slice, inputDelay 0) | ✅ erfüllt | E2E `boot` (OPFS in Chromium/Firefox, Memory-Fallback WebKit), `host.test.ts`, `scheduler.test.ts`, `recorder.test.ts` |
| 15 | Datenmodell (S5, G11) | ✅ erfüllt | `packages/heap/test/*`, `packages/sim/test/{spatial,world}.test.ts` |
| 16 | Blueprint-Compiler-Skelett, simId im Spiel | ✅ erfüllt | `packages/blueprints/test/compiler.test.ts`; HUD „simId `0xbc5abeaa`“ (E2E `boot`; `faf-sim/ms1.2`) |
| 17 | Build unter `dist/b/<buildHash>/` + Root-Redirect, COOP/COEP in Dev/serve, `deploy/nginx.conf` | ✅ erfüllt | E2E `smoke`, Dev-Server-Check, nginx in Docker |
| 18 | Spikes SPK1/SPK5/SPK6 gemessen und entschieden, SPK2/3/4/7 terminiert | ✅ erfüllt | Abschnitt „Spike-Ergebnisse“, DECISIONS-Nachtrag |
| 19 | STATUS vollständig | ✅ erfüllt | dieses Dokument |

### Abschluss-Verifikation (2026-09-29, nach Review-Nachbesserung, streng sequenziell)

| Befehl | Ergebnis |
|---|---|
| `pnpm typecheck` | grün (`tsc -b` 13 Projekte + Tests) |
| `pnpm lint` | grün (ESLint 0 Warnungen inkl. erweitertem `sim/determinism`, dep-cruiser: 0 Verstöße in 240 Modulen) |
| `pnpm test` | 60 Dateien, **471/471** grün |
| `pnpm --filter @faf/headless goldens` | beide Goldens (`faf-sim/ms1.2`) bitgleich |
| `pnpm test:xengine` | **40/40** Hash-Ketten == Goldens (Node, Chromium, Firefox, WebKit; kalt/warm) |
| `pnpm bench -- --update-docs` | alle Budgets erfüllt (fixed, sim, sim-host PASS; headless: MS1 0,355 ms, SPK1 1,25 ms, SPK5 0,44 ms – unter Fremdlast) |
| `pnpm test:e2e` | **51/51** grün (Chromium, Firefox, WebKit; 4173 + 4174), 5,2 min, bei Load ≈ 5 |
| `pnpm dev` + Playwright-Skript | `http://localhost:5173/`: COOP/COEP-Header, `crossOriginIsolated`, 1.024 Würfel, Rechtsklick ⇒ `cmdApplyTicksMax = 1`, keine Fehler; Server danach beendet |

### Spike-Ergebnisse

| Spike | Status | Ergebnis / Messwert (lokal, Apple M5 Pro) | Entscheidung |
|---|---|---|---|
| **SPK1 Sim-Durchsatz** | durchgeführt (`tools/headless/src/spk1`) | 1.000 Boden + 300 Luft, ≈ 3.860 Projektile (DDA im Ziel-Bezugssystem), Vision-Stamp, Targeting gestaffelt, Hash: p95 max. über mehrere Läufe **1,25–2,06 ms** (langsamste Engine je Lauf, Firefox/Chromium), Node 1,09–1,11, WebKit ≈ 1,0; End-Hash `0xe14862d1` in allen Engines gleich | Exit ≤ 25 ms erfüllt ⇒ **alles bleibt TypeScript**, Rust/WASM-Ausweg (DECISIONS 2) wird nicht gezogen |
| SPK2 Bewegungsgefühl | **nicht in MS1** | – | Wegwerf-Prototyp (Float/Canvas2D, Engstellen, Roll-off, Offset-Erhalt) muss vor MS3 stehen; Ergebnis (Steering-Parameter oder ORCA-lite) ist Eingang der Fx-Portierung in MS3. MS1 bewegt nur Würfel auf freier Ebene. |
| SPK3 Pathing realistisch | **nicht in MS1** | – | braucht Terrain/Klippen (MS2) und HPA\*; wird in MS3 zusammen mit `nav` durchgeführt (Exit: ≤ 5 ms/Tick p95 bei 200 Anfragen auf 1.024 WU). |
| SPK4 Render-Last | **nicht in MS1** | Vorleistung: 1.000 bzw. 10.000 Instanzen bei Render-JS p95 ≤ 0,16 ms, GPU ≈ 0,3–0,45 ms (Chromium, M5 Pro) | Messung auf Iris Xe/echtem Safari braucht den GPU-Runner (DECISIONS 5) und CSM/Splat/Props aus MS2; Termin MS2 mit Terrain-Pipeline. |
| **SPK5 Hash und Snapshot** | durchgeführt (`tools/headless/src/spk5`) | 20-MiB-Arena: xxh32 JS 1,7–12,1 ms, WASM (WAT) 1,56–1,70 ms; realer Live-Bereich (141.648 B, 1.000 Units) Hash-Tick p95 ≤ **0,39 ms** (Chromium kalt), warm 0,02–0,05 ms; Snapshot/Restore Sim-Arena 0,02–0,03 ms; Keyframe deflate-raw 1,45 MB → 36–40 KB (36–40:1) in 0,6–3 ms | Exit ≤ 2 ms erfüllt ⇒ **Live-Bereich-Hash in JS**, kein Rolling-Hash, kein WASM-Hash; Keyframes vorerst unkomprimiert im Speicher (Kompression mit Replay-Viewer MS11) |
| **SPK6 Latenz** | durchgeführt (E2E `latency`) | Marker ≤ 1 Frame; `cmd` → angewandt ≤ 1 Tick; Pipeline (6 WU): Klick → erster bewegter Pixel p95 **106–157 ms** (über die Läufe); **Startansicht p95 216–283 ms**; Ack am Client p95 89–109 ms; je Browser × Transport (Tabelle unten) | Exit (≤ 150 ms) **nur für die Pipeline erfüllt, in der Spielansicht nicht** (Abweichung, DECISIONS 11). Entscheidung trotzdem **`inputDelay = 0`, Render-Delay adaptiv ≈ ½ Tick, keine Client-Vorhersage** – Transport und Takt sind ausgereizt, der Rest ist Anfahrverhalten der Einheit (3 WU/s² aus dem Stand) und wird in SPK2/MS3 (Sofort-Drehung/Anfahrprofil) gelöst. |
| SPK7 KI-Loop | **nicht in MS1** | Vorleistung: `TickSource.pending(tick)`/`'pending'` im Scheduler (Retry 1 ms, `pendingWaits`) getestet | braucht die Scripted-Dummy-KI; wie geplant in MS6. |

#### SPK6 im Detail (E2E `latency`, Lauf nach Review 2026-09-29, unter Fremdlast Load ≈ 5)

Je Kombination 50 Klicks bei 6 WU („Pipeline“), 16 bei 10 WU und 40 in der Startansicht (105 WU). Gegated werden seit
dem Review nur maschinenunabhängige Invarianten (Marker ≤ 1 rAF, alle Klicks gemessen, `cmdApplyTicksMax = 1`,
Main-JS p95 ≤ 2 ms); die ms-Gates der Pipeline laufen nur im expliziten Messlauf `FAF_LATENCY_GATE=1` (mit
Wiederholung bei rAF-Stall). Alle Werte stehen in `test-results/latency-<browser>-<transport>.json` (`criteria`).

| Browser | Transport | Marker (max. rAF / p95) | seq-Ack p50 / p95 | erster bewegter Pixel 6 WU p50 / p95 | 10 WU p95 | Startansicht p50 / p95 (ms) | Main-JS p50 / p95 / p99 | FPS | rAF max (6 WU) |
|---|---|---|---|---|---|---|---|---|---|
| Chromium | SAB (4173) | 1 / 15,2 ms | 56,3 / 106,2 ms | 72,5 / **115,6** ms | 124,7 | 168,7 / **243,0** | 0,08 / 0,22 / 0,27 ms | 60,0 | 16,7 |
| Chromium | Transfer (4174) | 1 / 15,8 ms | 70,6 / 104,7 ms | 86,2 / **121,4** ms | 128,2 | 189,9 / **257,3** | 0,10 / 0,20 / 0,40 ms | 60,0 | 16,8 |
| Firefox | SAB (4173) | 1 / 10,4 ms | 57,3 / 99,6 ms | 74,5 / **114,7** ms | 107,0 | 166,5 / **216,2** | 0,04 / 0,14 / 0,30 ms | 119,8 | 16,0 |
| Firefox | Transfer (4174) | 1 / 9,0 ms | 58,0 / 100,0 ms | 75,0 / **116,0** ms | 124,0 | 191,0 / **243,0** | 0 / 0 / 1,0 ms (1-ms-Uhr) | 118,8 | 17,5 |
| WebKit | SAB (4173) | 1 / 30,4 ms | 65,5 / 108,6 ms | 101,1 / **150,0** ms | 143,4 | 212,3 / **273,1** | 0,06 / 0,14 / 0,20 ms | 52,0 | 99,2 |
| WebKit | Transfer (4174) | 1 / 42,0 ms | 56,0 / 103,0 ms | 94,0 / **157,0** ms | 153,0 | 207,0 / **283,0** | 0 / 1,0 / 1,0 ms (1-ms-Uhr) | 55,7 | 87,0 |

Früherer Lauf ohne Fremdlast (vor dem Review, gleiche Messkette): Pipeline p95 106–133 ms, Ack p95 89–108 ms,
Startansicht p95 220–272 ms. `cmdApplyTicksMax` war im Lauf nach dem Review in allen Kombinationen 1.
FPS = headless-rAF-Takt der jeweiligen Engine – **lokal gemessen, kein GPU-Runner**, nicht gegated.

**Sim im Spiel** (Host-Stats am Ende des Latenzlaufs, Fenster 256 Ticks inkl. Spawn und JIT-Aufwärmung, alle
Würfel auf einen Punkt): Tick p95 Chromium 0,80–0,82 ms, Firefox 1,16 ms (4173), WebKit 0,74 ms (4173); Hash-Tick
p95 0,58–1,44 ms (4174: 1-ms-Uhr). Gegenüber dem Tick-Bench (0,08–0,22 ms) wirken zwei Effekte: (1) Beim 10-Hz-Takt
schläft der Worker zwischen den Ticks – derselbe Tick kostet dann ≈ 2× (Hash ≈ 3–4×), in Node nachgemessen
(back-to-back p95 1,05 ms, 10 Hz p95 1,87 ms für „1.000 Würfel auf einen Punkt“); (2) die dichte Traube am Ziel
maximiert die Separation. Beide Werte liegen unter dem Budget von 2 ms, der Abstand ist im Spiel aber kleiner als im
Bench – Beobachtungspunkt für MS3 (Steering/Flow-Fields ersetzen die Würfel-Separation).

### Nachbesserung nach dem MS1-Review (2026-09-29)

| Befund | Umsetzung | Beleg |
|---|---|---|
| SPK6 als „erfüllt“ geführt, obwohl nur bei 6 WU gegated | Abnahme ehrlich: „teilweise erfüllt – Abweichung“ mit Startansicht-Werten und Begründung; Tick-Vorziehen bei `cmd` verworfen (bricht den festen Takt), Anfahrverhalten → SPK2/MS3 (DECISIONS 11) | Abschnitt „Abnahme“, SPK6-Tabelle |
| `smoke` in Firefox instabil (`goto()` → null durch Inline-Redirect) | Root-Status per `page.request.get`, Zielseite per `waitForResponse`, `goto(…, { waitUntil: 'commit' })` (auch in `openGame`) | `test/e2e/smoke.spec.ts`, `test/e2e/support/game.ts`; E2E 51/51 |
| Latenz-E2E kippt unter Last | Messung und Gate getrennt: immer nur Invarianten (Marker ≤ 1 rAF, `cmdApplyTicksMax = 1`, alle Klicks gemessen, Main-JS); ms-Gates nur mit `FAF_LATENCY_GATE=1`; Bericht mit `criteria` (DECISIONS 16) | `test/e2e/latency.spec.ts`; Host-Stats `cmdBatchesApplied`/`cmdApplyTicksMax` (`host.test.ts`) |
| `seq`-Umlauf 65535 → 1 im selben Tick falsch sortiert (2 Befunde) | Sortierschlüssel `(seq − lastAckSeq − 1) & 0xffff` je Armee (DECISIONS 15) | `packages/sim/src/stage.ts`, Test „u16 seq wrap-around“ in `packages/sim/test/commands.test.ts` |
| Letzter Regel-Hash im Regel-State | derived-Region `hashlog`; Goldens einmalig neu (DECISIONS 14) | `packages/sim/src/{schema,step,frame,world}.ts`, `world.test.ts` |
| `SIM_BUILD` nicht erzwungen | `SIM_BUILD` in `@faf/sim`, `simBuild` in jedem Golden (v2), Test + `--update`-Sperre ohne Bump; Bump auf `faf-sim/ms1.2` (DECISIONS 12) | `tools/headless/{src/goldens.ts,scripts/goldens.ts,test/goldens.test.ts}` |
| `sim/determinism` lückenhaft | + `crypto`, `Float16Array`, `parseFloat`/`Number.parseFloat`/`Number(…)`, `getFloat*`/`setFloat*` auf beliebigen Objekten, `/` und `/=` ohne sofortiges `Math.floor/trunc` bzw. Bit-Operator; 28 neue RuleTester-Fälle; Konfigurationstest per `ESLint.lintText` je Sim-Paket (inkl. aller Runtime-Deps von `@faf/sim`). Drei Fundstellen angepasst (`deg()`, `speedToPermille`, SPK1-Griddimensionen), `permilleToSpeed` (UI-Anzeige) begründet ausgenommen | `tools/eslint-plugin-sim/{src/rules/determinism.js,test/*.test.ts}` |
| Allokationstest maß nur Retention | direkte Messung (GC-freie Blöcke + `PerformanceObserver`) mit Kanarienvogel; dabei echte Allokation im Host-Pfad gefunden (≈ 5,8 MiB/10k Ticks) und behoben (`stats`-Nachricht wiederverwendet, Perzentile allokationsfrei, SAB-Consumer-Views gecacht) → ≈ 534 KiB | `packages/{sim,sim-host}/test/alloc.test.ts`, `packages/sim-host/src/{host,stats}.ts`, `packages/protocol/src/transport/sab.ts` |
| `bench` überschreibt Doku und macht den Baum schmutzig | Tabellen nur mit `--update-docs`; `results/*.json` git-ignoriert; STATUS mit Wertebereichen (DECISIONS 16). `packages/sim/bench/tick.ts` ignoriert durchgereichte Flags | `tools/headless/scripts/bench.ts`, `.gitignore` |
| `sim` durfte ganz `@faf/blueprints` importieren; `simbin.ts` ohne Determinismus-Lint | dep-cruiser: `sim` nur `@faf/blueprints/simbin`; `packages/blueprints/src/simbin.ts` in `SIM_SOURCES` | `.dependency-cruiser.cjs`, `eslint.config.js`, Config-Test |
| Tickrate dreifach definiert | `BASE_TICK_MS = 1000 / SIM_TICK_HZ` in `sim-host` und `client` (aus `@faf/rules`) | `packages/sim-host/src/scheduler.ts`, `packages/client/src/frames.ts` |
| Redundante Spalte `Units.gen` | gestrichen (DECISIONS 13) | `packages/sim/src/schema.ts` |
| UnitRecord-Offsets in `render` gespiegelt | aus `@faf/protocol` abgeleitet, Kreuztest nach `render` verschoben | `packages/render/src/instance-layout.ts`, `packages/render/test/instance-layout.test.ts` |

Keiner der Befunde wurde verworfen; aus dem Latenz-Befund wurde nur die Option „Scheduler bei `cmd` sofort ticken“
bewusst nicht umgesetzt (Begründung DECISIONS 11).

### Abweichungen vom Plan (konsolidiert aus den Fragmenten)

**Projektweit / Entscheidungen**
- Bun steht nicht zur Verfügung: Cross-Engine = Node (V8) + Playwright Chromium (V8), Firefox (SpiderMonkey),
  WebKit (JSC) (DECISIONS).
- Kein GPU-Runner: FPS/GPU nur lokal auf Apple M5 Pro, als solche markiert (DECISIONS 5).
- CI als lokales Skript `pnpm ci:local` (kein Remote-Repo).

**P0 – Gerüst, `fixed`** ([Details](status/P0-scaffold.md))
- `FxSmall` = |raw| ≤ 2¹⁵ − 1 (< 8 WU), weil `Math.imul(a, b) >> 12` nur für |a·b| < 2³¹ exakt ist.
- fxMul/fxDiv/fxAdd wrappen auf int32 (wie `as i32`) statt zu werfen; die Exaktheits-Invariante wird im Debug geprüft.
- LUT-Werte werden zwischen Nachbareinträgen linear (ganzzahlig) interpoliert (Fehler ≤ 1,5 raw / ≤ 2 Ang16).
- dependency-cruiser: `render` darf zusätzlich `fixed`, `sim-host` zusätzlich `ai` importieren.
- Zusätzliche Deps: `client` → preact/@preact/signals/`rules`, `sim-host` → `rules`, `apps/game` → `@babel/core`, `@types/node`.
- Firefox auf macOS braucht `CFFIXED_USER_HOME` (TCC-Sperre); Chromium headless mit `--use-angle=metal`.

**P1 – `heap`, `protocol`** ([Details](status/P1-heap-protocol.md))
- Kein separater Codegen-Schritt: Die Table-DSL erzeugt die SoA-Views beim `build()`, Typen per Mapped Types.
- Frame-Header: `tickTimeUs` (µs) und `speedPermille` statt ms/Float; zusätzliche Felder `ackSeq`, `hashTick`,
  `hash`, `debugOffset/debugBytes`; Frame-Magic bleibt `'IFRM'` (historisch), simId-Tag `"FAFSIMID"`, SAB-Magic `'FAFT'`.
- Transport-Statistik: SAB zählt überschriebene, Transfer ungesendete Frames als `dropped`.
- `PortLike`-Listener als `(ev: object) => void` (DOM/Node strukturell kompatibel).
- `DEFAULT_FRAME_CAPS`: Beams 2.048, Events 4.096, Debug 64 KiB; Überlauf wird gezählt, nicht geworfen.

**P2 – `render`** ([Details](status/P2-render.md))
- ~~`render` importiert `protocol` nicht~~ – seit dem Review übernimmt `render/src/instance-layout.ts` Stride, Offsets und
  `NoInterp` direkt aus `@faf/protocol` (erlaubt laut §3.2); Spiegel und Client-Kreuztest entfallen, der
  FrameWriter-Roundtrip liegt in `packages/render/test/instance-layout.test.ts`.
- `WEBGL_multi_draw` im UnitPass ungenutzt (keine Base-Instance) – ein Draw pro Visual über umgehängte Stream-Offsets.
- Merged-Part: `partId` im Vertexformat, PartStream wird in MS1 noch nicht gelesen.
- Testebene mit kleinem Vertex-Stream statt reinem `gl_VertexID` (Firefox-Warnung); Highlight-Stride 4 B (ANGLE/Metal).
- Demo-Build unter `packages/render/dist/demo`; Smoke-Server mit COOP/COEP nur für feinere Zeitmessung.

**P3 – `rules`, `blueprints`, `sim`** ([Details](status/P3-blueprints-sim.md))
- `writeFrame(world, viewer, writer, target, meta?)` (Zielpuffer + Host-Felder).
- Zusätzliches Blueprint-Feld `sim.motion.radius` (Würfel 0,3 WU statt Footprint-Radius 0,5).
- Merge-Patches als `definePatch`, Entfernen aus id-Arrays per `{id, $remove: true}`; Content importiert `define.ts` relativ.
- `content/generated` eingecheckt (`content/.gitignore` mit Ausnahme); die Spalte `Units.gen` aus §3.5 ist seit dem
  Review gestrichen – die Generation kommt nur aus der Table-DSL (`units.gen`, `handle()`), DECISIONS 13.
- Ein Grid-Paar für alle Layer (nur Land in MS1); Ankunfts-Contagion + Schlafzustand als MS1-Minimalform von §3.8.
- Pseudo-Phase `HashTick = 17` (in Output geschachtelt); Cheats ignorieren den Besitz; Envelope-Tick wird nicht geprüft
  (Host stempelt); `SIM_TICK_HZ` in `rules`; Exports `@faf/blueprints/{simbin,view,define}`; Allianzen nur beim Setup.

**P4 – `client`** ([Details](status/P4-client.md))
- tsconfig-Referenzen auf `rules`/`blueprints` entfernt (in MS1 ungenutzt).
- S = Stop (tippen < 180 ms) **und** Pan rückwärts (halten).
- Implizite Selektion „alle eigenen“ ohne Highlight; Klick ins Leere leert die Selektion (FA-Verhalten).
- Wegpunktlinie vom Gruppenschwerpunkt statt je Einheit, bis zur seq-Bestätigung.
- Render-Delay mit nur einem Frame (prev/cur) im Speicher; Uhr kann bei Snap zurückspringen.
- „Erster bewegter Pixel“ in CSS-Pixeln und nur für stillstehende Einheiten; Ack-Zeitpunkt = rAF-Poll-Zeitpunkt.

**P5 – `sim-host`** ([Details](status/P5-sim-host.md))
- Wake-up-Hybrid: Wartezeiten > 8 ms schlafen einmal grob auf einem Timer bis 4 ms vor der Frist, den Rest erledigt
  der MessageChannel-Selbstping (sonst 100 % CPU zwischen Ticks).
- Ein Frame pro Slice (bei 3 Ticks/Slice nur der letzte).
- Command-Log als Append-Stream `FAFL` (crashsicher) statt `.rtsreplay`-Chunks (kommt mit `formats` in MS11);
  Cheats tainten das Log (MARK cheat).
- Zusatzfelder in `ready`/`status`/`stats`, `startPaused` im `init`.
- Keyframes unkomprimiert (≤ 128 MiB, Ausdünnung); `restoreSnapshot` verzweigt die Zeitlinie; `SIM_BUILD` liegt
  seit dem Review in `@faf/sim` (`faf-sim/ms1.2`, von `sim-host` re-exportiert) und wird über die Goldens erzwungen
  (DECISIONS 12); `mapSimHash` der Testebene = Hash ihrer Beschreibung; `bench` endet mit Exit 1 bei Budgetriss.

**P6 – `tools/headless`** ([Details](status/P6-headless.md))
- Harness über `https://flow-and-fire.test` per `page.route` (sicherer Kontext ⇒ feine Uhren mit COOP/COEP).
- Erste Move-Gruppe in `cubes-1000-move` an Tick 2 (Handles existieren erst nach dem Spawn-Step).
- Harness-Quellen unter `src/harness/`; Specs über `tsconfig.harness.json` typgeprüft.
- SPK1-Lint programmatisch im Test (Root-Lint-Config nicht in den owns); SPK1-Messung ab Tick 41 (Ramp).
- WebKit-Worker-Uhr 1 ms ⇒ Wiederholungsmessung per Snapshot/Restore.

**P7 – `apps/game`, E2E, Deploy** ([Details](status/P7-game-e2e.md))
- `.claude/eslint.config.js` nimmt das Orchestrator-Skript `.claude/workflows/faf-milestone.js` vom Lint aus
  (ESLint 10 sucht die Config ab dem Dateiverzeichnis; Root-Config unverändert).
- Testkorrektur `packages/sim-host/test/scheduler.test.ts`: Echtzeit-Wake-up-Test wärmt den frischen
  `MessageChannel` einmal auf (Node liefert dessen erste Nachricht bis ≈ 40 ms verspätet; Produktivcode unverändert).
- Latenz-E2E trennt seit dem Review Messung und Gate: immer gegated nur Invarianten (Marker ≤ 1 rAF, Befehl ≤ 1 Tick
  bis zur Anwendung, alle Klicks gemessen, Main-JS); die ms-Gates (6 WU ≤ 150 ms, Ack ≤ 100 ms + 1 rAF) nur mit
  `FAF_LATENCY_GATE=1`. Die wörtlichen SPK6-Kriterien werden im Bericht ausgewertet und hier als Abweichung geführt.
- Ohne Cross-Origin-Isolation quantisieren Firefox/WebKit `performance.now()` auf 1 ms (Main-JS „1,0 ms“,
  Hash-Tick „0 ms“); die Konsolen-E2E verlangt deshalb nur `hashTickP95Us ≥ 0`.
- Playwright-WebKit bietet kein OPFS im Worker ⇒ Recorder im Memory-Fallback (mit Grund im Status).
- Zusätzlicher URL-Parameter `?enemy=` (Default 24); Test-Hooks unter `window.__faf` und `window['__flow-and-fire']`.
- Build-Hash `<commit>` bzw. `<commit>-d<8 hex>` bei schmutzigem Arbeitsbaum; `FAF_BUILD_HASH` (alt `IRONFLOW_BUILD_HASH`).
- Root-Redirect als generierte Seite (behält Query/Hash) statt HTTP-302; `serve.mjs` spiegelt die nginx-Caching-Regeln.
- Frame-Bytegleichheit per Fingerprint ohne `tickTimeUs`/Debug-Sektion (Wanduhrwerte).
- Context-Loss-E2E ignoriert nur Konsolenmeldungen zum absichtlichen Kontextverlust.

### Offene Punkte für spätere Meilensteine (bekannte Grenzen, Übergaben an MS2 ff.)

- **Latenz SPK6 (⚠️):** Anfahrverhalten/Sofort-Drehung in SPK2 (vor MS3) klären, danach Klick → erster sichtbarer
  Pixel in der Startansicht erneut messen; Ack-Latenz bleibt taktbedingt (DECISIONS 11).
- **Referenzhardware:** FPS/GPU-Messung und alle Budgets auf Referenz-Laptop bzw. GPU-Runner nachholen (DECISIONS 5,
  SPK4 in MS2).
- **Spikes offen:** SPK2 (vor MS3), SPK3 (MS3 mit `nav`), SPK4 (MS2 mit Terrain-Pipeline – in MS2 erledigt,
  DECISIONS 17), SPK7 (MS6).
- **Sim im Spiel:** p95 bis 1,16 ms (Extremfall Node 1,87 ms) bei „alle Würfel auf einen Punkt“ – Beobachtungspunkt
  für MS3 (Steering/Flow-Fields).

- Alle Budgets sind lokal (Apple M5 Pro) belegt, nicht auf dem Referenz-Laptop (4 P-Kerne, Iris Xe); der Abstand ist
  groß (Bench), im Spiel beim 10-Hz-Takt aber kleiner (s. „Sim im Spiel“).
- Testebene ohne Terrain/Pathing; Bewegung = direktes Steering + Separation. Heightmap-Picking, CDLOD, Kamera-Rotation
  und Kantenscrollen folgen in MS2, HPA\*/Formationen in MS3.
- Frame-Sektionen Eco/Watch/Intents/Fog/Footprint-Deltas/Shields und PartStream-Auswertung im Shader fehlen noch
  (Layout vorbereitet); `watch` wird nur gespeichert.
- Transfer-Transport allokiert pro Frame (Nachrichtenobjekt); allokationsfrei ist nur der SAB-Pfad.
- Latenz in der Spielansicht (erster sichtbarer Pixel p95 216–283 ms) ist ein Übergabepunkt an SPK2/MS3
  (Anfahrverhalten); die Client-Ack-Latenz bleibt taktbedingt bei p95 ≈ 100–110 ms (DECISIONS 11).
- Keyframes unkomprimiert; `.rtsreplay`-Format und Replay-Viewer in MS11.
- Kein Strategic Zoom/IconPass, keine Schatten/Post, keine UI außer HUD/Konsole (spätere Meilensteine).

## Stand MS2 – Terrain, Karte & Kamera

**Stand 2026-09-29 (nach Review-Nachbesserung): MS2 abgeschlossen; alle maschinenunabhängigen Abnahmekriterien
erfüllt und gegated. ⚠️ bleiben: echtes Safari nicht geprüft (Remote Automation nicht freigegeben), kein
GPU-/iGPU-Runner (DECISIONS 5), FPS/Ladezeiten/Restore nur lokal gemessen und nur mit `FAF_PERF_GATE=1` gegated,
Pointer Lock im headless Chromium/WebKit nicht verfügbar (Tests übersprungen).** Feature-IDs MS2: **M1, M2, M3, M4,
C1, C11, P2, P3, P10**; Grundbausteine G15, G16; Spike **SPK4** (DECISIONS 17).

Spielbar mit `pnpm dev` (→ http://localhost:5173/): die 512-WU-Karte *Hollow Ridge* (aus `content/maps/src` per
`mapgen` + `mapc` erzeugt) mit Heightmap-Terrain (CDLOD, Auto-Splat), Wasser mit Tiefenfarbe/Uferschaum, Mass- und
Hydro-Spots als Decals, 1.000 + 24 Würfel auf dem Terrain (y = Sim-Höhe), FA-Kamera (Zoom zum Cursor, Mittelklick-Grab,
Kanten/WASD/Pfeile, Strg+Mittelklick-Rotation, H = Start, Pos1 = Rotation zurück, Alt+Enter = Vollbild).
`?map=testplane` lädt die flache MS1-Ebene – seit dem Review als generierte Karte im selben Pfad (DECISIONS 18).
URL-Parameter zusätzlich zu MS1: `?map=`, `?preset=low|medium|high|ultra`, `?units=N` (Flugtest), `?assets=raw`.

Arbeitspakete (Wellen 0–2): [ms2-p0-formats](status/ms2-p0-formats.md), [ms2-p1-render](status/ms2-p1-render.md),
[ms2-p2-sim](status/ms2-p2-sim.md), [ms2-p3-client](status/ms2-p3-client.md), [ms2-p4-game](status/ms2-p4-game.md),
[ms2-p5-spk4](status/ms2-p5-spk4.md).

### MS2 starten und prüfen

Voraussetzungen wie MS1 (Node ≥ 24, pnpm 11, `pnpm install`, `pnpm exec playwright install chromium firefox webkit`).
Die generierten Artefakte (`content/maps/*.rtsmap`, `content/generated/assets/`) sind eingecheckt; nach Änderungen an
Kartenquellen oder Blueprints zuerst `pnpm maps`, dann `pnpm assets`.

| Zweck | Befehl |
|---|---|
| Spiel im Browser (Dev) | `pnpm dev` → http://localhost:5173/ (hollow-ridge, Preset Medium); Strg+C beendet den Server |
| Varianten | `?map=testplane` (flache MS1-Ebene), `?preset=low\|medium\|high\|ultra`, `?units=2000` (Flugtest), `?assets=raw` (ohne meshopt), `?transport=transfer` |
| Produktionsbuild lokal | `pnpm build`, dann `pnpm --filter @faf/game run serve --port 4173 --coi` |
| Karten erzeugen | `pnpm maps` (mapgen → Quellen, mapc → `.rtsmap`, deterministisch); einzelne Heightmap: `mapc` in `packages/formats/scripts/` (`.png`/`.pgm`/`.r16`) |
| Assets erzeugen / prüfen | `pnpm assets`; `pnpm --filter @faf/assets-pipeline run check` |
| Statik / Unit-Tests | `pnpm typecheck`, `pnpm lint`, `pnpm test` |
| Goldens / Cross-Engine / Bench | `pnpm --filter @faf/headless goldens`, `pnpm test:xengine`, `pnpm bench` |
| Render-Smoke (Sonde CPU == GPU) | `pnpm --filter @faf/render smoke` |
| E2E (3 Browser × SAB/Transfer) | `pnpm test:e2e` (Ports 4183/4184, `FAF_E2E_PORT`); ms-Grenzen zusätzlich mit `FAF_PERF_GATE=1` |
| SPK4-Benchmark | `pnpm bench:spk4` (voll, alle 3 Browser, `--update-docs`) bzw. `pnpm bench:spk4 -- --quick` |
| Echtes Safari (nach Freigabe „Remote Automation“) | `pnpm build && node --import tsx test/e2e/safari/safari-check.ts` |
| Alles nacheinander | `pnpm ci:local` |

Steuerung zusätzlich zu MS1: Mausrad = Zoom zum Cursor (6 WU bis ganze Karte, Neigung folgt dem Zoom), Mittelklick
ziehen = Karte greifen, Bildschirmrand/WASD/Pfeile = Pan, Strg+Mittelklick = Rotation, Pos1 = Rotation zurück,
H = eigener Start, Alt+Enter = Vollbild (mit Pointer-Confinement und virtuellem Cursor). Konsole neu: `map`,
`camera <x> <z> [dist]`, `preset <name>`.

### Umsetzungsorte der Feature-IDs MS2

| ID | Inhalt (MS2-Umfang) | Umsetzung | Beleg |
|---|---|---|---|
| **M1** | Heightmap-Terrain: R16UI-Höhen, CDLOD-Patches 32 WU (ein instanzierter Draw), Auto-Splat nach Höhe/Neigung, Sim-Höhe = `sampleHeightRaw` | `packages/rules/src/terrain.ts`, `packages/render/src/terrain/*`, `packages/render/src/passes/{terrain,probe}.ts`, `packages/sim/src/{terrain,movement}.ts`, `packages/client/src/map.ts` | `packages/rules/test/terrain.test.ts`, `packages/sim/test/terrain.test.ts`, E2E `terrain`, `render smoke` |
| **M2** | Wasser: Tiefenfarbe, Wellennormalen, Uferschaum, Himmelsreflexion; Tiefwasser blockiert Land, Furten passierbar | `packages/render/src/passes/water.ts`, `packages/sim/src/{terrain,movement}.ts` (`isDeepWaterForLand`, achsgetrenntes Gleiten) | `packages/sim/test/water.test.ts`, Golden `ridge-water-block`, E2E `terrain` |
| **M3** | Kartenformat `.rtsmap` (Chunk-Container, CRC-32, META/HGT/SPLT/PREV/PROP, unbekannte Chunks erhalten), `mapSimHash`, CLI-Import, Generator, Karte *Hollow Ridge* | `packages/formats/src/*`, `packages/formats/scripts/{mapc,mapgen,maps,png,heightmap-io}.ts`, `content/maps/` | `packages/formats/test/*`, E2E `map-roundtrip` |
| **M4** | Mass-/Hydro-Spots als Ring-Decals, in `mapSimHash` und Sim-Arena | `packages/render/src/terrain/decals.ts`, `packages/client/src/map.ts`, `packages/sim/src/terrain.ts` | `packages/render/test/decals-presets.test.ts`, E2E `terrain` (Ringe 16/16) |
| **C1** | FA-Kamera: Zoom zum Cursor, Mittelklick-Grab, Kanten/WASD, Rotation, Terrain-Folge, Mindestabstand 2 WU, auch in der Pause | `packages/client/src/camera-controller.ts`, `packages/client/src/terrain-picker.ts` (G15) | `packages/client/test/{camera-controller,terrain-picker}.test.ts`, E2E `camera`, `picking` |
| **C11** | Browser-Input: Hotkeys über `code`, Cursor-FSM, Kontextmenü/Autoscroll unterdrückt, Vollbild, Pointer-Confinement (G16) | `packages/client/src/{actions,input,cursor-fsm,fullscreen}.ts`, `apps/game/src/{game,main.tsx}` | `packages/client/test/input-ms2.test.ts`, E2E `camera` |
| **P2** | Unit-Culling (prev/cur), 3 Mesh-LODs, ein Draw pro (Visual, LOD), Merged-Part mit PartStream | `packages/render/src/{units,frustum.ts,passes/units.ts}`, `packages/client/src/visuals.ts` | `packages/render/test/*` (Culling, LOD, Draws), E2E `flight` |
| **P3** | Asset-Pipeline (glTF + meshopt + Fallback, Manifest SHA-256), Asset-Worker (Cache API, Integrität, Fortschritt), Ladebildschirm | `tools/assets-pipeline/src/*`, `packages/client/src/assets/*`, `packages/blueprints/src/asset-manifest.ts`, `apps/game/src/loading.ts` | `pnpm --filter @faf/assets-pipeline run check`, E2E `map-load` |
| **P10** | Context-Loss mit Terrain/Wasser/Decals/Texturen (RHI-Registry stellt alles wieder her) | `packages/render/src/webgl2/device.ts`, `packages/render/src/renderer.ts` | `packages/render/test/context-loss.test.ts`, E2E `context-loss` |
| **G15** | Heightmap-Raymarch-Picking (Chunk-Schranken, Marsch ≤ 0,5 WU, Bisektion) | `packages/client/src/terrain-picker.ts`, `packages/render` (`computeChunkBounds`) | `packages/client/test/terrain-picker.test.ts`, E2E `picking` |
| **G16** | Action-Mapping, Fokusregel, Fullscreen-Root | `packages/client/src/{actions,input,fullscreen}.ts` | `packages/client/test/input-ms2.test.ts` |
| **SPK4** | Render-Last-Benchmark (full/fallback/ms2) in 3 Browsern | `tools/render-bench/{src,scripts/spk4.ts}` | `pnpm bench:spk4`, DECISIONS 17, [ms2-p5](status/ms2-p5-spk4.md) |

**Messregel (DECISIONS 16):** Maschinenabhängige ms-Grenzen – Laden ≤ 8 s / ≤ 3 s, FPS, Main-JS, Restore ≤ 2 s –
werden in jedem E2E-Lauf **gemessen und berichtet** (`test-results/*.json`, git-ignoriert), aber **nur mit
`FAF_PERF_GATE=1 pnpm test:e2e` gegated**. Immer gegated sind die maschinenunabhängigen Kriterien (CPU == GPU,
Frame-y == CPU, Pick-Genauigkeit und Miss-Konsistenz, Draws ≤ 50, alle 3 LODs gezeichnet, Cache-Treffer/0 Netz-Bytes,
Roundtrip-Bytes, Hash-Gleichheit). Alle Werte lokal: Apple M5 Pro, Playwright headless (Chromium 153, Firefox 155,
WebKit 26.6) – **kein GPU-/iGPU-Runner, kein echtes Safari**.

### Abnahme MS2 (docs/plans/MS2.json „acceptance“, PLAN §5.2)

Messlauf: vollständiges `pnpm test:e2e` nach der Review-Nachbesserung (107 bestanden, 4 übersprungen, 10,0 min),
**unter Fremdlast** (paralleler MLX-GPU-Job des Nutzers, Load ≈ 5–6) – betrifft nur FPS/GPU-Werte (s. ⚠️).

| Kriterium | Status | Messwert | Nachweis |
|---|---|---|---|
| M3/Formate: Chunk-Container (4CC, Länge, CRC32), META/HGT/SPLT/PREV/PROP, Roundtrip CLI → Datei → Spiel → Datei bytegleich, mapSimHash in Node/Worker/Spiel gleich, unbekannte Chunks erhalten, CRC-/Längenfehler erkannt | ✅ erfüllt | SHA-256 `fd3b31d7…` (mapc == Datei == `exportMap` im Browser), mapSimHash `0x90ec94f0` in Node == Worker == Seite == HUD, simId `0xb3668e44` stabil über Reload; Testebene simId `0xafe386cc` / mapSimHash `0xecdb4513` (generierte Karte, Export bytegleich) – alle 3 Browser × 2 Server | `packages/formats/test/*`, E2E `map-roundtrip` → `test-results/map-roundtrip-*.json` |
| Hollow Ridge aus Quellen reproduzierbar; Starts, 16 Mass + 2 Hydro, Tiefwasser-Rinne, Furten | ✅ erfüllt | Frische-Test bytegleich; 2 Starts, 16/2 Spots | `packages/formats/test/*`, [ms2-p0](status/ms2-p0-formats.md) |
| M1: CDLOD (33×33-Patches, Chunk-Culling, 1 Draw), Auto-Texturierung; CPU == GPU in 10.000 Stichproben | ✅ erfüllt | 0 Abweichungen in allen 6 Browser/Server-Kombinationen und im `render smoke` (3 × 10.000); Terrain 1 Draw | E2E `terrain` → `test-results/terrain-*.json`, `pnpm --filter @faf/render smoke` |
| M1/Sim: Sim-y == `sampleHeightRaw` (Vitest + Szenario), Frame-y == CPU im Browser | ✅ erfüllt | 0 Abweichungen (cur/prev) in allen Kombinationen; seit dem Review zusätzlich auf einer 1.024-WU-Karte (Ränder/Ecken) | `packages/sim/test/terrain.test.ts`, Goldens `ridge-*`, E2E `terrain`, `flight` |
| M2: Wasser (Tiefenfarbe, Normalen, Uferschaum); Flachwasser passierbar, Tiefwasser blockiert Land | ✅ erfüllt | Wasserpixel (256, 256) Box 100 %; Golden `ridge-water-block` (keine Landeinheit im Tiefwasser, Furt-Gruppe am Ziel) | E2E `terrain`, `tools/headless/goldens/ridge-water-block.json` |
| M4: Spots als Decals sichtbar, in mapSimHash | ✅ erfüllt | Mass-Ring 16/16, Hydro-Ring 16/16 (Pixelprüfung) | E2E `terrain`, `render smoke` |
| Laden der 512-WU-Karte: kalt ≤ 8 s, Cache ≤ 3 s (keine Netz-Bytes) | ✅ erfüllt (lokal; ms-Grenzen nur mit `FAF_PERF_GATE=1` gegated, Cache-Treffer/0 Netz-Bytes immer) | kalt Wand **226–471 ms** (Nav → ready 164–310 ms), Cache Wand **131–191 ms**; 4/4 Cache-Treffer, 0 Netz-Bytes; frühere Läufe kalt 168–488 ms, Cache 95–224 ms | E2E `map-load` → `test-results/map-load-*.json` |
| P2 + Kameraflug: 2.000 Platzhalter, 10 s, Draws ≤ 50 (gegated), FPS ≥ 60 bzw. rAF-Takt, Main-JS p95; 1 Draw pro (Visual, LOD), 3 LODs, Frustum-Culling, Merged-Part/PartStream | ✅ erfüllt (Draws, LODs, Culling gegated); ⚠️ FPS unter Fremdlast, lokal | Draws max **4**; LOD-Instanzen max **[32, 192–223, 1.273–1.321]** (alle 3 LODs, seit dem Review gegated); gecullt bis > 1.000; FPS / rAF-Leerlauftakt: Chromium 60,0 / 60,0, Firefox 108–112 / 117–119 (0,93–0,94), WebKit 29,6–42,8 / 31,1–40,5 (0,95–1,06 – WebKits rAF lief unter der Fremdlast nur mit 31–40 Hz; Einzelwiederholung des Reviews unbelastet 57,9 FPS); Kriterium „≥ 60 FPS oder ≥ 0,95 × rAF-Leerlauftakt“ in allen 6 Läufen erfüllt; Main-JS p95 0,28–0,30 ms (ohne COOP/COEP 1-ms-Uhr: 1,0); GPU p95 (Chromium, Timer-Query, unter Fremdlast) 4,7–5,0 ms | E2E `flight` → `test-results/flight-<browser>-<transport>.json` (`criteria`) |
| G15 Picking: ≤ 1/16 WU in ≥ 10.000 Zufallsstrahlen und ≥ 200 Bildschirmpunkten je Browser; Zoom zum Cursor ≤ 1/16 WU | ✅ erfüllt | Vitest 10.000 Strahlen (hollow-ridge) + 2.000 Strahlen auf 1.024 WU (Chunk-Grenzen, Kartenrand); E2E 380 Vergleiche je Browser × Server, max \|Δxz\| 1,7·10⁻⁴ WU, max \|Δy\| 0,020 WU; Picker-Misses bei Referenz-Treffer **0**, Treffer bei Referenz-Miss **0** (seit dem Review gegated; „overview“: 4 Punkte, in denen beide verfehlen); 5/5 Rechtsklicks == Pick; Zoom-Anker 0 raw | `packages/client/test/terrain-picker.test.ts`, E2E `picking`, `camera` |
| C1 Kamera: Edge-Pan, WASD/Pfeile, Mittelklick-Grab, Zoom zum Cursor, Terrain-Folge, Rotation, KeyH, in der Pause | ✅ erfüllt | Grab-Fehler 0, Zoom-Anker 0, Edge-Pan 20,2–23,8 WU in 0,5 s; alles auch in der Pause | E2E `camera` (3 Browser × 2 Server), `packages/client/test/camera-controller.test.ts` |
| C11/G16: Hotkeys über `code` (DE/US), Kontextmenü/Autoscroll unterdrückt, Vollbild, Pointer-Confinement, Cursor-FSM, Fokus | ✅ erfüllt; ⚠️ Pointer Lock headless nur in Firefox | Vollbild (Alt+Enter) in allen 3 Engines; Pointer Lock + virtueller Cursor in Firefox; in Chromium/WebKit headless wird der Lock nicht gewährt ⇒ 4 Tests (2 Engines × 2 Server) mit Begründung übersprungen; Unit-Tests mit Fakes vollständig | E2E `camera`, `packages/client/test/input-ms2.test.ts` |
| P3: Asset-Pipeline deterministisch (meshopt + Fallback), Manifest sha256, Asset-Worker mit Cache API/Integrität/Fortschritt, Ladebildschirm | ✅ erfüllt | `check` grün (6 Dateien aktuell); zweimal gebaut bytegleich; Laden immer im Worker, Modelle meshopt-dekodiert | `pnpm --filter @faf/assets-pipeline run check`, E2E `map-load`, [ms2-p3](status/ms2-p3-client.md) |
| P10 Context-Loss mit Terrain/Wasser/Decals: Bild ≤ 2 s zurück, Sim tickt weiter, Regel-Hash gleich | ✅ erfüllt (Restore-ms nur mit `FAF_PERF_GATE=1` gegated) | Restore → erster Frame **13,7–25,3 ms**; 11–15 Ticks während des Verlusts; Regel-Hash Tick 60 `0x8f16dc4c` mit/ohne Verlust gleich in allen 3 Browsern; Registry-Test (fake-gl) | E2E `context-loss` → `test-results/context-loss-*.json`, `packages/render/test/context-loss.test.ts` |
| Presets low/medium/high/ultra, Render-Scale Medium 0,8, Splat-Layer, wirkt über `?preset=` | ✅ erfüllt | Backbuffer = CSS × DPR × 0,8 (gegated im Flug) | E2E `flight`, `terrain`; `packages/render/test/decals-presets.test.ts` |
| Determinismus: `SIM_BUILD faf-sim/ms2.0`; ≥ 4 Goldens; Cross-Engine kalt/warm; L4 Replay + Restore auf hollow-ridge; Log v2 mit mapSimHash; statische Karte nicht in Hash/Snapshot, aber in simId; Sim p95 ≤ 2 ms; Allokation < 1 MB; Lint deckt formats/rules ab | ✅ erfüllt | 4 Goldens bitgleich (`cubes-*` nach dem Review mit neuer Testebenen-Identität neu aufgenommen, Ketten unverändert); **80/80** Hash-Ketten (Node, Chromium, Firefox, WebKit; kalt/warm); L4 auf hollow-ridge und 1.024 WU; Snapshots tragen jetzt simId (Restore auf fremder Karte ⇒ `SnapshotError`); Sim-Tick p95 0,55–0,57 ms (Node, Host-Pfad, Testebene/hollow-ridge); Allokation mit Karte ≈ 164–350 KiB / 10.000 Ticks | `pnpm --filter @faf/headless goldens`, `pnpm test:xengine`, `packages/sim-host/test/{map,l4-replay,alloc}.test.ts`, `pnpm --filter @faf/sim-host bench` |
| SPK4 als Benchmark (full/fallback/ms2) in 3 Browsern, Entscheidung mit Messwerten | ✅ erfüllt (lokal); ⚠️ kein Iris Xe | s. DECISIONS 17 (Draws, Main-JS, GPU je Szenario) | `pnpm bench:spk4`, [ms2-p5](status/ms2-p5-spk4.md) |
| WebKit-Smoke und alle E2E-Specs in Chromium, Firefox, WebKit, mit und ohne COOP/COEP | ✅ erfüllt | 107/111 grün, 4 übersprungen (Pointer Lock); seit dem Review laufen auch `camera`, `picking` und `flight` gegen beide Server (SAB und Transfer, Flug mit 2.000 Einheiten auch mit dem Transfer-Transport) | `pnpm test:e2e` → `test-results/e2e.json` |
| Echtes Safari per safaridriver | ⚠️ nicht geprüft | `safaridriver` startet, Session abgelehnt: „Allow remote automation“ in Safari nicht freigegeben (Systemeinstellung bewusst nicht geändert) | `test-results/safari-check.json` (`status: unavailable`), Nachholen: `pnpm build && node --import tsx test/e2e/safari/safari-check.ts` |
| GPU-Runner in CI | ⚠️ nicht verfügbar | FPS/GPU nur lokal (M5 Pro) | DECISIONS 5 |
| DoD: frozen-lockfile, typecheck, lint (inkl. dep-cruiser), Vitest, Goldens, Cross-Engine, Bench, E2E, render smoke; spielbar mit `pnpm dev`; STATUS | ✅ erfüllt | s. Abschluss-Verifikation | dieser Abschnitt |

### Abschluss-Verifikation nach der Review-Nachbesserung (2026-09-29, streng sequenziell)

| Befehl | Ergebnis |
|---|---|
| `pnpm install --frozen-lockfile` | grün (Lockfile unverändert) |
| `pnpm typecheck` | grün |
| `pnpm lint` | grün (ESLint 0 Warnungen inkl. erweitertem `sim/determinism`; dep-cruiser 0 Verstöße, 337 Module) |
| `pnpm test` | 89 Dateien, **724/724** grün |
| `pnpm --filter @faf/assets-pipeline run check` | grün (6 Dateien aktuell) |
| `pnpm --filter @faf/headless goldens` | 4/4 bitgleich |
| `pnpm test:xengine` | **80/80** Hash-Ketten == Goldens |
| `pnpm --filter @faf/sim-host bench` (+ `-- --testplane`) | MS2-Budget PASS, Sim p95 0,568 / 0,550 ms |
| `pnpm --filter @faf/render smoke` | Chromium, Firefox, WebKit OK (Sonde 0/10.000, Ringe 16/16, Context-Loss ok) |
| `pnpm test:e2e` | **107 bestanden, 4 übersprungen** (Pointer Lock headless Chromium/WebKit), 10,0 min, unter Fremdlast |

Nicht wiederholt nach dem Review (Code unverändert): `pnpm bench:spk4` (Werte in DECISIONS 17), `pnpm dev`-Check
([ms2-p4](status/ms2-p4-game.md); `?map=testplane` jetzt über die E2E `terrain` abgedeckt).

### Nachbesserung nach dem MS2-Review (2026-09-29)

| Befund | Umsetzung | Beleg |
|---|---|---|
| STATUS ohne MS2-Abnahmetabelle | dieser Abschnitt (Kriterien, Messwerte, ⚠️, Messregel) | – |
| `camera`/`picking`/`flight` nur gegen COOP/COEP | laufen über `SERVERS` (4183 SAB und 4184 Transfer); Berichte je Transport (`*-<browser>-<transport>.json`); `COI_SERVERS` entfernt; MS1-Aussage „jede Spec auch ohne COOP/COEP“ gilt wieder | `test/e2e/{camera,picking,flight}.spec.ts` |
| Sonnen-Azimut in render gegenüber dem Format gespiegelt | `sunDirection` folgt der Formatsemantik (0° = +z, 90° = +x), Test über formats → ClientMap → render (DECISIONS 19) | `packages/render/src/renderer.ts`, `packages/client/test/map.test.ts`, `packages/render/test/terrain-renderer.test.ts` |
| Testebene als Sonderpfad in 22 Dateien | generierte Karte `createTestPlaneMap` überall; `GroundPass`, `GroundPicker`, `FlatTerrain`, `World.testPlane`/`MT_TEST_PLANE`, `simIdOf`, `map === null`-Zweige entfernt; Kartengröße überall Zweierpotenz 64..4096; Goldens `cubes-*` neu (nur Identität) (DECISIONS 18) | `packages/{formats,sim,sim-host,client,render}/src`, `apps/game/src`, `tools/headless/src` |
| Picking-E2E zählte Picker-Misses still | Misses getrennt (beide / nur Picker / nur Referenz), die zwei Inkonsistenz-Arten gegated | `test/e2e/picking.spec.ts` |
| LOD 0 im Flug nie gezeichnet | Flug beginnt 20 WU über einem Einheiten-Cluster; `every(n > 0)` gegated | `test/e2e/flight.spec.ts` |
| Fest verdrahtete 58-FPS-Schwelle, WebKit-Wert lastbedingt | rAF-Leerlauftakt je Engine vor dem Flug (2 s), Kriterium ≥ 60 FPS oder ≥ 0,95 × Leerlauftakt; kompletter E2E-Lauf neu (e2e.json vollständig) | `test/e2e/flight.spec.ts`, `test-results/flight-*.json` |
| Snapshot ohne Identität | Sitzungs-Snapshot mit Kopf (simId, layoutHash, Länge), `SnapshotError` bei fremder Karte (DECISIONS 20) | `packages/sim-host/src/core.ts`, `packages/sim-host/test/map.test.ts` |
| Determinismus-Lint mit Lücken | unäres `+` (außer auf Zahlliteralen), `JSON.parse` nur in `formats/src/rtsmap.ts` (`jsonParseAllow`), Aliase/berechneter Zugriff auf `globalThis`/`self`/`window`/`global`, Node-Module `perf_hooks`/`crypto`/`timers`/… verboten; 20 neue RuleTester-Fälle | `tools/eslint-plugin-sim/src/rules/determinism.js`, `…/test/determinism.test.ts`, `eslint.config.js` |
| 1.024 WU ungetestet | Sim (Ränder/Ecken, y == Höhe, Snapshot/Restore, Eckklemmung), Host (init-Bytes, simId, Replay, Restore), Client (Chunk-Grenzen == render, Picking an Chunk-Grenzen/Rand) | `packages/sim/test/terrain.test.ts`, `packages/sim-host/test/map.test.ts`, `packages/client/test/{map,terrain-picker}.test.ts` |
| Chunk-Schranken doppelt implementiert | `ClientMap` nutzt `render.computeChunkBounds`; `MAP_CHUNK_WU = TERRAIN_PATCH_WU` | `packages/client/src/map.ts` |
| Zwei UTF-8-Codecs | strikter Codec in `@faf/protocol` (`encodeUtf8`/`decodeUtf8`), formats re-exportiert, Log-Kopf nutzt ihn (DECISIONS 21) | `packages/protocol/src/utf8.ts` |
| Tote Globals-Globs des Headless-Harness | Globs korrigiert (`tools/headless/src/harness/page/**`, `…/worker-entry.ts`); Test: jeder Glob eines Globals-Blocks trifft ≥ 1 Datei | `eslint.config.js`, `tools/eslint-plugin-sim/test/config.test.ts` |

Keiner der Befunde wurde verworfen.

### Abweichungen MS2 (konsolidiert; Details in den Fragmenten)

- **E2E-Ports 4183/4184** statt 4173/4174 (fremder Server auf 4173), per `FAF_E2E_PORT` verschiebbar (Runde 1, s. u.).
- **Messung ≠ Gate:** Ladezeiten, FPS, Main-JS, Restore nur mit `FAF_PERF_GATE=1` gegated (DECISIONS 16).
- **FPS-Kriterium** als „≥ 60 FPS oder ≥ 0,95 × rAF-Leerlauftakt der headless Engine“ (gemessen, nicht angenommen).
- **Pointer Lock** in headless Chromium/WebKit nicht verfügbar ⇒ 4 E2E-Tests mit Begründung übersprungen; Firefox
  prüft Lock, virtuellen Cursor, Klemmung und Freigabe vollständig.
- **⚠️ Echtes Safari** nicht geprüft (Remote Automation nicht freigegeben, Systemeinstellung nicht angefasst).
- **⚠️ Kein GPU-/iGPU-Runner** (DECISIONS 5); GPU-Zeiten lokal und teils unter Fremdlast (obere Schranke).
- **Testebene** = generierte Karte (DECISIONS 18); Rendering ohne gesetzte Karte zeichnet keinen Boden mehr.
- **Licht-Konvention** = Formatsemantik (DECISIONS 19).
- Weitere Paket-Abweichungen: [ms2-p0](status/ms2-p0-formats.md), [ms2-p1](status/ms2-p1-render.md),
  [ms2-p2](status/ms2-p2-sim.md), [ms2-p3](status/ms2-p3-client.md), [ms2-p4](status/ms2-p4-game.md),
  [ms2-p5](status/ms2-p5-spk4.md).

### Offene Punkte nach MS2

- Echtes Safari und iGPU/Referenz-Laptop nachmessen (SPK4-GPU-Ziel ≤ 12 ms für Medium unbelegt, DECISIONS 17).
- FPS-Messung ohne Fremdlast wiederholen (`FAF_PERF_GATE=1 pnpm test:e2e`), WebKit lag unter Last bei 31–40 Hz rAF.
- Transfer-Transport allokiert weiterhin pro Frame (nur SAB allokationsfrei); gemessen jetzt auch im Flug mit
  2.000 Einheiten: Main-JS p95 ≤ 1,0 ms (1-ms-Uhr), Draws max 4 wie im SAB-Lauf, LOD-Verteilung gleichwertig.
- ~~Setons (1.024 WU) als nächste Standardkarte~~ – erledigt: Setons ist Standardkarte ([setons-map](status/setons-map.md),
  DECISIONS 22–24); Terrain-LOD (M11) folgt MS14. Optik-Review Runde 1 behoben (Wasser, Sand, Farben, Kachelmuster,
  Gebirge/Fels, Relief, Kartenrand, Spot-Lesbarkeit; DECISIONS 25–28, [setons-map](status/setons-map.md)); Medium nutzt
  seitdem 8 Splat-Layer und Triplanar. Wracks/Bäume und Felsbrocken als echte Props weiterhin erst ab MS8.
- **Preset-Werte aus SPK4** (Medium = Blob-Schatten + HDR/Bloom, CSM ab High) sind entschieden, aber noch nicht in
  `packages/render/src/presets.ts` eingetragen (dort noch `shadows: 'none'`, HDR/Bloom aus) – mit MS8/MS14. Terrain- und
  Unit-Pass brauchen dafür Schatten-Eingänge; Caster-Bündelung bzw. `WEBGL_multi_draw` gegen das Draw-Wachstum (MS14).
- **Nur eine Terrain-LOD-Stufe** (32-WU-Patches); echte CDLOD-Stufen/Morphing mit M11 in MS14.
- **Kein Pathing:** Einheiten fahren geradeaus, gleiten am Tiefwasser entlang und geben nach 20 Ticks ohne Fortschritt
  auf; die Furt finden sie nicht selbst (HPA\*/Flow-Fields in MS3, vorher SPK2/SPK3). Keine Neigungsgrenze, kein Tilt –
  Klippen sind befahrbar.
- Karten-Props (`core:rock_01/02`) werden weder simuliert noch gerendert (Blueprints ab MS8); KTX2-Splat (Codec 1)
  wird nur durchgereicht, Dekodierung ab MS9.
- `deploy/nginx.conf` mit den neuen MIME-Regeln (`.rtsmap`, `.glb`) nicht per `nginx -t` nachgeprüft (Image lokal
  nicht vorhanden).
- MS1-Logs (v1) sind lesbar, wegen `SIM_BUILD faf-sim/ms2.0` aber nicht mehr abspielbar (erwartet).
- Offene Spikes: SPK2 (vor MS3), SPK3 (MS3), SPK7 (MS6).

### Integrations-Verifikation Runde 1 (2026-09-29, vor dem Review)

Alle Prüfbefehle streng sequenziell gelaufen: `pnpm install --frozen-lockfile`, `typecheck`, `lint` (inkl.
dependency-cruiser), `test` (89 Dateien / 694 Tests), `assets-pipeline check`, `headless goldens` (4 Szenarien inkl.
`ridge-1000-move`/`ridge-water-block`), `test:xengine` (80 Hash-Ketten bitgleich), `bench` (MS2-Sim-Tick p95 ≤ 0,6 ms
auf hollow-ridge), `render smoke` (Chromium/Firefox/WebKit OK), `test:e2e` (91 bestanden, 2 übersprungen:
Pointer-Lock im Vollbild ist im headless Chromium/WebKit nicht verfügbar – absichtlicher `test.skip`),
`bench:spk4 -- --quick` (Exit 0).

**Abweichung E2E-Ports:** Die Playwright-Server liegen jetzt standardmäßig auf **4183** (COOP/COEP) und **4184**
(ohne), überschreibbar mit `FAF_E2E_PORT=<n>` (zweiter Server `n + 1`); zentral in `test/e2e/support/ports.ts`, von
`playwright.config.ts` und allen Specs genutzt (keine hartkodierten URLs mehr). Grund: 4173 ist der
Vite-Preview-Standardport und war auf der Entwicklungsmaschine durch einen fremden Server (`127.0.0.1:4173`) belegt;
unser Dual-Stack-Server hätte zwar gebunden, Browser hätten je nach IPv4/IPv6-Auflösung aber den fremden Server
erwischt. `serve.mjs` selbst behält Default 4173 für den manuellen Start.

**SPK4 quick** lief unter GPU-Fremdlast (paralleler MLX-Job des Nutzers, im Bericht als `CONTENDED` markiert):
Main-JS p95 0,22 ms (`ms2`) / 0,47 ms (`full`), Draws 25 / 90 innerhalb der Grenzen; GPU p95 17,9 / 158 ms über dem
12-ms-Budget – unter Fremdlast nicht aussagekräftig, Budgets werden laut DECISIONS 5 nur gemessen, nicht lokal gegated.
Unkontendierte Wiederholung (Vollmodus wartet auf Fremdlast) bzw. Referenzhardware bleibt offen.

### Integrations-Verifikation nach dem Review (2026-09-29)

Alle Prüfbefehle streng sequenziell erneut gelaufen, ohne dass Code-Fixes nötig waren: `install --frozen-lockfile`,
`typecheck`, `lint` (337 Module, keine Abhängigkeitsverstöße), `test` (89 Dateien / 724 Tests), `assets-pipeline
check`, `headless goldens` (4/4 gleich), `test:xengine` (80 Hash-Ketten bitgleich), `bench` (MS2-Sim-Tick p95
0,48 ms, Firefox kalt), `render smoke` (Chromium/Firefox/WebKit OK, 0/10.000 Probe-Abweichungen), `test:e2e`
(107 bestanden, 4 übersprungen: Pointer-Lock im Vollbild in headless Chromium/WebKit, je SAB und Transfer),
`bench:spk4 -- --quick` (Exit 0; Draws 25/90, Main-JS p95 0,23/0,45 ms; GPU p95 86/230 ms unter Fremdlast
durch parallelen MLX-Job, als `CONTENDED` markiert – laut DECISIONS 5 nicht gegated).

## Karte Setons (Standardkarte, 2026-09-29)

**Setons** ist seit 2026-09-29 die Standardkarte (`DEFAULT_MAP = 'setons'`): ein eigener, geskripteter Nachbau nach
dem Layout von *Seton's Clutch* (FA-Karte `SCMP_009`). Es sind **keine** Original-Dateien (`.scmap`, Texturen,
Vorschaubilder) im Repo; Grundlage ist die eigene Layout-Spezifikation `content/maps/src/setons.spec.md`
([B]eleg/[V]orschau/[S]chätzung markiert), daraus erzeugt der Generator `packages/formats/scripts/mapgen-setons.ts`
(in `pnpm maps` registriert) Heightmap, 8-Layer-Splat und `markers.json`; `mapc` baut `content/maps/setons.rtsmap`.
Details, Tabellen und beide Review-Runden: [setons-map](status/setons-map.md); Entscheidungen DECISIONS
„Erste Karte: Setons“ und 22–29. `?map=hollow-ridge` (MS2-Karte) und `?map=testplane` bleiben erreichbar; die
MS1/MS2-E2E-Specs sind per `openGame` auf hollow-ridge fixiert.

| Eckdaten | Wert |
|---|---|
| Größe | 1.024 × 1.024 WU (Heightmap 1.025², u16; Splat 2 × 256² RGBA8 = 8 Layer), exakt punktsymmetrisch (2 Teams à 4) |
| Datei | `setons.rtsmap` 2.698.440 B, SHA-256 `110bd0d6…823c`, **mapSimHash `0x52eccf92`** (Golden im Test) |
| Starts | 8 (je Team Rear/Mid/Rock/Beach); Spieler = Armee 0 auf **SW-Mid (354/678)**, Gegner = Armee 1 auf **NO-Mid (670/346)**, Mid gegen Mid über die Landbrücke; Kamera startet über der eigenen Basis |
| Spots | **108 Mass** (je Start 4 Start-Mex, Gelände-Mex je Team, 2 Inseln à 5), **8 Hydro**, 72 Fels-Props (`core:rock_01/02`) |
| Gelände | Wasser 56,1 % (Spec ≈ 57 %; 64²-Raster zu 96,7 % deckungsgleich mit der Referenzklassifikation), **eine** Landbrücke als einzige Landverbindung (engste Stelle 76,4 WU, flach), 2 erhöhte Inseln (Plateau ≈ 40 WU, Klippenring, nur per Luft/See), Eckgebirge bis ≈ 77 WU, Felsrippen am Rock-Spot, Felsgruppe an der Buchtspitze, Teiche, Strände nur an den Beach-Küsten |
| Tests | Kartenvertrag `packages/formats/test/setons.test.ts` (Symmetrie, Wasseranteil, Starts/Spots flach und trocken, Konnektivität nur über die Brücke, Brückenbreite, Inseln unerreichbar, Klippen, Sand, Randabstand), Frische (mapgen == Quellen, mapc bytegleich), Golden `setons-bridge-move`, E2E `test/e2e/setons.spec.ts` |

**Messwerte** (Apple M5 Pro, lokal, kein Referenz-Laptop – DECISIONS 5): Laden Navigation → ready 230–447 ms
(Chromium), 294–410 ms (Firefox), 282–620 ms (WebKit); `map-load` kalt 235–540 ms, aus dem Cache 160–216 ms.
Gesamtansicht (alle 1.024 Patches, ≈ 2,1 Mio. Dreiecke, Terrain 1 Draw, Draws ≤ 50) unbelastet **60 FPS**, GPU p50
5,9–6,3 ms (Medium) / 6,3–7,5 ms (High), Kameraflug 60 FPS, Main-JS p95 ≤ 0,5 ms; unter Fremdlast immer auf dem
verfügbaren rAF-Takt. Generator ≈ 0,6 s. `test:xengine` 100/100 Hash-Ketten bitgleich (inkl. `setons-bridge-move`).

**Abschluss-Verifikation (2026-09-29, sequenziell, über `tools/heavy`):** `pnpm typecheck` ✓, `pnpm lint` ✓
(339 Module, keine Abhängigkeitsverstöße), `pnpm test` ✓ (90 Dateien / 747 Tests, 4 Worker), `pnpm build` ✓,
`pnpm test:e2e` ✓ (113 bestanden, 4 übersprungen: Pointer-Lock im Vollbild headless; 12,0 min;
Firefox/WebKit mussten vorher per `pnpm exec playwright install firefox webkit` nachinstalliert werden – der erste Lauf
scheiterte nur am fehlenden Browser-Binary, Chromium 37 bestanden, 2 übersprungen). Setons-E2E dieses Laufs (Fremdlast möglich):
Laden Nav → ready Chromium 175/276 ms (SAB/Transfer), Firefox 238/225 ms, WebKit 182/511 ms; Gesamtansicht
Chromium 58 FPS (GPU p50 5,3 ms SAB), Firefox 120/87 FPS, WebKit 47/52 FPS (rAF-Leerlauf 37–46 Hz); Kameraflug
Chromium 60 FPS, Firefox 120/108, WebKit 52/58 FPS; Main-JS p95 ≤ 0,5 ms (≤ 1 ms mit 1-ms-Uhr); 2,7 MB Netz kalt.

**Abweichungen vom Original**

- Nachbau aus einer Draufsicht: **alle Höhen geschätzt** (FA-typisch), Tiefen nur relativ gemessen; Uferformen eigene
  Polygone mit Rauschen statt Original-Heightmap.
- Symmetrie: NO-Hälfte kanonisch, SW gespiegelt – die kleinen Asymmetrien des Originals (zwei SW-Mex ≈ 0,09 in z
  versetzt) sind **nicht** übernommen; Rand-Mex von x = 1.016 auf 1.012 bzw. 12 WU gezogen (Spots ≥ 12 WU vom Rand).
- Heller Schelf ist bewusst **nicht** begehbar (im Original offen).
- Reclaim nur als Fels-Props; **Wracks auf der Landbrücke, Bäume und Unterwasser-Wracks fehlen** (keine Prop-Blueprints
  vor MS8). Props werden noch weder simuliert noch gerendert.
- Mass-Zahl 108 aus dem Vorschaubild gezählt (keine Textquelle); 4 Start-Mex für alle Starts per Analogie zum Rear-Bauplan.
- Eigene Optik (Oliv-Wiese, prozedurale Albedo, eigene Wasserfarben), keine FA-Texturen.

**Offene Punkte**

- Kein Pathing (MS3): Einheiten fahren geradeaus; Mid ↔ Mid klappt direkt über die Brücke, andere Starts brauchen
  Wegpunkte um die Seen.
- Keine Terrain-LOD: die Gesamtansicht zeichnet alle 1.024 Patches; auf der iGPU geschätzt 25–30 ms → CDLOD-Stufen
  (M11) in MS14.
- Wracks/Bäume/Unterwasser-Wracks und sichtbare Fels-Props ab MS8; strategische Spot-Symbole (Overlay) ab MS8/MS14.
- Schelf-Begehbarkeit und Neigungsgrenze (Klippen aktuell befahrbar) mit MS3 entscheiden.
- Messungen auf iGPU/echtem Safari und unbelastete `FAF_PERF_GATE=1`-Wiederholung stehen aus.
