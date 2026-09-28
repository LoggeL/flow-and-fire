# Flow & Fire (FAF)

Browser-RTS nach dem mechanischen Vorbild von Supreme Commander: Forged Alliance – mit eigener Fraktion,
eigenen Namen und eigenen Assets. Deterministische Q20.12-Fixed-Point-Simulation (10 Hz) in einem Web Worker,
eigene WebGL2-Pipeline, Preact-UI. Plan: [`docs/PLAN.md`](docs/PLAN.md), Entscheidungen:
[`docs/DECISIONS.md`](docs/DECISIONS.md), Stand: [`docs/STATUS.md`](docs/STATUS.md).

## Voraussetzungen

- Node ≥ 24, pnpm 11.10 (`corepack enable` oder globale Installation)
- Playwright-Browser: `pnpm exec playwright install chromium firefox webkit`
- Bun ist **nicht** nötig: Cross-Engine-Determinismus = Node (V8) + Playwright-Worker in Chromium, Firefox, WebKit

## Befehle (Root)

| Befehl | Wirkung |
|---|---|
| `pnpm install` | Workspace installieren |
| `pnpm dev` | Spiel im Vite-Dev-Server (`apps/game`, http://localhost:5173, immer mit COOP/COEP) |
| `pnpm build` | alle Pakete mit `build`-Skript bauen (nur `apps/game`) → `apps/game/dist/b/<buildHash>/` |
| `pnpm typecheck` | `tsc -b` (Project References) + Typcheck aller Tests/Benches/Skripte (`tsconfig.tests.json`) |
| `pnpm lint` | ESLint (inkl. `sim/determinism`) mit `--max-warnings 0` + dependency-cruiser |
| `pnpm test` | Vitest (Root-Config, forks, max. 4 Worker, `--expose-gc`) |
| `pnpm test:e2e` | `pnpm build` + Playwright (chromium, firefox, webkit; 1 Worker) gegen Port 4173 (COOP/COEP) und 4174 (ohne) |
| `pnpm test:xengine` | `test:xengine`-Skripte aller Pakete (Cross-Engine-Hash-Ketten) |
| `pnpm bench` | `bench`-Skripte aller Pakete (L6), Ergebnisse unter `bench-results/` |
| `pnpm ci:local` | typecheck → lint → test → test:xengine → test:e2e → bench (sequenziell, lokales CI) |

Einzelnes Paket testen: `pnpm vitest run packages/fixed`. Einzelnes Paket-Skript: `pnpm --filter @faf/fixed gen:luts`.

`apps/game` einzeln: `pnpm --filter @faf/game run serve --port 4173 --coi` liefert `dist/` statisch aus
(`--coi` = COOP `same-origin` + COEP `require-corp` + CORP `same-origin`); `/` leitet auf `/b/<buildHash>/` weiter,
`/build.json` enthält `{ "buildHash": … }`. Der Build-Hash kommt aus `IRONFLOW_BUILD_HASH` oder
`git rev-parse --short=12 HEAD` (Fallback `dev`).

## Paketstruktur

```
packages/
  fixed/       Q20.12 (Fx/FxSmall), Ang16 + LUT-Trig, isqrt, fxDiv mit Korrektur, rng32, xxHash32, SafeInt
  heap/        Arena (WebAssembly.Memory), Table-DSL/Codegen, Handles, Slabs
  protocol/    Command-Codec, Frame-/Event-Layouts, Opcodes (append-only); src/transport/ = Browser-Transport
  rules/       gemeinsame Regeln (canPlace, Footprints, Formeln) für Sim, Client, KI
  blueprints/  TypeBox-Schemas, define*(), Compiler → sim.bin / view.json / bundle.json + Hashes
  sim/         World, Systeme, Hash, FrameWriter (rein deterministisch)
  sim-host/    Worker-Entry (`@faf/sim-host/worker`), Scheduler, CommandSources, Command-Log, Headless-Entry
  render/      WebGL2-RHI, Passes, Instancing, Interpolation
  client/      Input, Kamera, Picking, Selection, Command-Builder, Frame-Consumer, UI-Bausteine
apps/
  game/        Vite-App (Spiel, Dev-Konsole), scripts/serve.mjs (statischer Server für E2E/Hosting-Test)
tools/
  eslint-plugin-sim/  eigene ESLint-Regel `sim/determinism`
  headless/           Node-Runner, Browser-Harness (Playwright-Worker), Benchmarks, Replay-Verify
test/e2e/             Playwright-Specs (Root-`playwright.config.ts`)
docs/                 Plan, Entscheidungen, Status (`docs/STATUS.md`, Fragmente in `docs/status/`)
```

Erlaubte Abhängigkeiten (dependency-cruiser, PLAN §3.2): `fixed` ist Blatt; `heap`/`protocol`/`rules` → `fixed`;
`blueprints` → `fixed`, `rules`; `sim` → `fixed`, `heap`, `protocol`, `rules`, `blueprints` (+ später `nav`, `formats`);
`sim-host` → `sim` und dessen Abhängigkeiten (+ `ai`); `render` → `protocol`, `fixed`, `gl-matrix`;
`client` → `render`, `protocol`, `rules`, `formats`, `blueprints`, `fixed`; nur `apps/*` importieren `client`;
`render`/`client`/`ai` importieren nie `sim`/`sim-host`; keine Zyklen; keine relativen Imports in fremde Pakete.

## Konventionen

- **Bibliotheks-Pakete haben kein `build`-Skript.** Ihre `exports` zeigen direkt auf `./src/*.ts`; Vite, Vitest und
  tsx konsumieren die Quellen. Nur `apps/game` baut. `tsc -b` erzeugt ausschließlich Deklarationen unter `dist/tsc`.
- **Tests** liegen in `<paket>/test/**/*.test.ts` und laufen nur über die Root-Vitest-Config. Hilfsdateien unter
  `test/support/`. Benchmarks unter `<paket>/bench/`, Offline-Skripte unter `<paket>/scripts/`.
- **Imports** innerhalb eines Pakets relativ **mit `.ts`-Endung** (`import { fx } from './fx.ts'`), paketübergreifend
  nur über den Paketnamen (`@faf/fixed`). Typ-Importe mit `import type` (`verbatimModuleSyntax`).
- **Determinismus** (PLAN §3.1/§3.12): In `packages/{fixed,heap,rules,sim,nav}/src` und `packages/protocol/src`
  (außer `src/transport/`) erzwingt `sim/determinism`: kein `Math.*` außer `imul/floor/trunc/min/max/abs/sign/clz32`,
  kein `Math.random`/`Date`/`performance`/Timer/`async`/`await`/`for…in`/`**`, keine `Map`/`Set`/`Weak*`-Werte,
  `sort()` nur mit Comparator, kein `Float32Array`, `Float64Array` nur in `packages/heap/src/safeint.ts`,
  Nicht-Ganzzahl-Literale nur als direktes Argument von `fx()`/`fxSmall()`/`deg()`, nichts Locale-abhängiges,
  keine Importe aus `render`/`client`/`ai`/`sim-host`. Zusätzlich haben die Sim-Pakete `lib: ["ES2022"]` und
  `types: []` – DOM/Node-Globals sind dort Compile-Fehler.
- **Sprache:** Code, Kommentare, Identifier englisch; Dokumentation unter `docs/` deutsch.
- **Status:** Jedes Arbeitspaket schreibt `docs/status/<Paket-ID>.md`; die Konsolidierung in `docs/STATUS.md`
  erfolgt am Meilensteinende.
- **Speicher (Mac ohne Swap):** Vitest max. 4 Worker, Playwright 1 Worker, keine Dev-Server im Hintergrund liegen lassen.
