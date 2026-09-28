# Projektstatus Flow & Fire (FAF)

Konvention: Jedes Arbeitspaket schreibt sein Fragment nach `docs/status/<Paket-ID>.md`
(Umgesetztes, Verträge für Folgepakete, Abweichungen, bekannte Grenzen). Am Meilensteinende konsolidiert
das Abschlusspaket (P7) die Fragmente in diese Datei und füllt die Abnahme-Tabelle mit Messwerten und Belegen.

## Stand MS1 – Spikes & deterministisches Skelett

Stand: Welle 0 abgeschlossen (P0-scaffold). Monorepo-Gerüst, Tooling und `packages/fixed` stehen; alle übrigen
Pakete sind Skelette (`export {};`) und werden in den folgenden Wellen gefüllt.

Feature-IDs MS1: S1, S2, S3, S4, S5, S7, S8, P1, A5.

### Paketübersicht

| Paket | Inhalt MS1 | Stand | Fragment |
|---|---|---|---|
| Root-Tooling | pnpm-Workspace, TS strict + Project References, ESLint + `sim/determinism`, dependency-cruiser, Vitest, Playwright (3 Browser) | fertig | [P0-scaffold](status/P0-scaffold.md) |
| `@faf/fixed` | Fx Q20.12, FxSmall, Ang16 + LUTs, isqrt, fxDiv, rng32, xxHash32, SafeInt | fertig | [P0-scaffold](status/P0-scaffold.md) |
| `@faf/heap` | Arena, Table-DSL, Handles | Skelett | – |
| `@faf/protocol` | Command-Codec, Frame-Layout, Transports | Skelett | – |
| `@faf/rules` | (MS1 minimal) | Skelett | – |
| `@faf/blueprints` | Compiler-Skelett, `simHash`/`viewHash`, Placeholder-Spec | Skelett | – |
| `@faf/sim` | Würfel-Movement, Hash | Skelett | – |
| `@faf/sim-host` | Worker, Scheduler, Command-Log, Headless | Skelett | – |
| `@faf/render` | WebGL2-RHI, Instancing, Interpolation, Ebenen-Picking | Skelett | – |
| `@faf/client` | Input, Kamera, Picking, Frame-Consumer | Skelett | – |
| `@faf/game` | Vite-App, Dev-Konsole | Gerüst (WebGL2-Canvas, Build unter `/b/<hash>/`, `serve.mjs`) | [P0-scaffold](status/P0-scaffold.md) |
| `@faf/headless` | Node-Runner, Browser-Harness, SPK1/SPK5/SPK6 | Skelett | – |

### Abnahme MS1 (PLAN §5.2)

| Kriterium | Status | Messwert | Beleg |
|---|---|---|---|
| Hash-Kette über 2.000 Ticks bitgleich in Node, Chromium, Firefox, WebKit (Bun entfällt, siehe DECISIONS), JIT kalt und warm | offen | – | – |
| L1: BigInt-Orakel ohne Abweichung in 10⁶ Fällen (fxMul, fxDiv, isqrt, fxMulSmall) | offen (Vorleistung P0 grün) | 4 × 10⁶ Fälle, 0 Abweichungen (Node) | `packages/fixed/test/oracle.test.ts` |
| L1: LUT-Hash festgeschrieben | offen (Vorleistung P0 grün) | sin_quarter.bin `0x5A60F785`, atan.bin `0x7BB4897C` | `packages/fixed/test/angle.test.ts` |
| `fxMulSmall` stimmt im Debug-Build mit `fxMul` überein | offen (Vorleistung P0 grün) | 10⁶ Fälle, Debug-Vergleich aktiv | `packages/fixed/test/oracle.test.ts` |
| L4: Log-Replay ergibt bei Tick 2.000 denselben Hash | offen | – | – |
| L4: Arena-Restore bei Tick 1.000 ergibt bei Tick 2.000 denselben Hash | offen | – | – |
| 1.000 fahrende Würfel: Sim p95 ≤ 2 ms im langsamsten Engine-Worker (inkl. Hash-Tick) | offen | – | – |
| 1.000 fahrende Würfel: ≥ 60 FPS (lokal gemessen, kein GPU-Runner, siehe DECISIONS 5) | offen | – | – |
| 1.000 fahrende Würfel: Main-JS ≤ 2 ms | offen | – | – |
| SAB- und Transfer-Transport liefern bytegleiche Frames | offen | – | – |
| E2E läuft ohne COOP/COEP | offen (Smoke grün) | Smoke 4174 in 3 Browsern grün | `test/e2e/smoke.spec.ts` |
| Pause: Tick steht, Kamera und Command-Annahme laufen weiter | offen | – | – |
| Latenz: Klickmarker ≤ 1 Frame | offen | – | – |
| Latenz: Klick → erster bewegter Pixel ≤ 150 ms (p95) | offen | – | – |
| Latenz: `seq`-Bestätigung ≤ 100 ms | offen | – | – |
| Allokation warm < 1 MB über 10.000 Ticks | offen | – | – |
| DoD: Playwright-Demo-Pfad | offen | – | – |
| DoD: ≥ 2 L2-Goldens | offen | – | – |
| DoD: L0–L4 grün auf allen Engines | offen (L0 grün) | typecheck, lint, dep-cruiser grün | `pnpm typecheck`, `pnpm lint` |

### Spike-Ergebnisse

| Spike | Status | Ergebnis / Messwert | Entscheidung |
|---|---|---|---|
| SPK1 Sim-Durchsatz | offen | – | – |
| SPK2 Bewegungsgefühl | nicht in MS1-Umfang dieses Laufs | – | – |
| SPK3 Pathing | nicht in MS1-Umfang dieses Laufs | – | – |
| SPK4 Render-Last | nicht in MS1-Umfang dieses Laufs | – | – |
| SPK5 Hash und Snapshot | offen (JS-Basiswert Node) | xxHash32 über 20 MB: ≈ 5,7 ms in Node (≈ 3,4 GB/s, M5 Pro); Browser-Worker offen | – |
| SPK6 Latenz | offen | – | – |

### Abweichungen

Siehe Fragmente unter `docs/status/`. Wesentlich aus Welle 0:

- Bun steht nicht zur Verfügung; Cross-Engine = Node + Playwright-Worker (Chromium, Firefox, WebKit) (DECISIONS).
- `FxSmall` ist als |raw| ≤ 2¹⁵ − 1 (< 8 WU) definiert, weil `Math.imul(a, b) >> 12` nur für |a·b| < 2³¹ exakt ist.
- `render` darf neben `protocol` auch `fixed` importieren; `sim-host` darf zusätzlich `ai` importieren (KI-Fallback im Sim-Worker).
