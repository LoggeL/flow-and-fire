# Flow & Fire (FAF)

Browser-RTS nach dem mechanischen Vorbild von Supreme Commander: Forged Alliance – mit eigener Fraktion,
eigenen Namen und eigenen Assets. Deterministische Q20.12-Fixed-Point-Simulation (10 Hz) in einem Web Worker,
eigene WebGL2-Pipeline, Preact-UI. Plan: [`docs/PLAN.md`](docs/PLAN.md), Entscheidungen:
[`docs/DECISIONS.md`](docs/DECISIONS.md), Stand: [`docs/STATUS.md`](docs/STATUS.md).

**Stand:** Meilensteine MS1 (deterministisches Skelett) und MS2 (Terrain, Karte & Kamera) sind abgeschlossen. Im
Browser läuft die 512-WU-Karte *Hollow Ridge* (eigenes `.rtsmap`-Format, aus Quellen per CLI erzeugt) mit
Heightmap-Terrain, Wasser, Mass-/Hydro-Spots und FA-typischer Kamera; 1.000 + 24 Würfel fahren auf der Terrainhöhe
der deterministischen Sim (Tiefwasser blockiert, Furten passierbar). Hash-Ketten sind bitgleich in Node, Chromium,
Firefox und WebKit. Details, Abnahme und Messwerte: [`docs/STATUS.md`](docs/STATUS.md).

## Schnellstart

```sh
pnpm install
pnpm dev            # http://localhost:5173/ – Spiel im Browser; mit Strg+C beenden
```

Steuerung: Linksklick/-ziehen wählt aus (Strg/⌘+A = alle eigenen), **Rechtsklick bewegt**, S tippen = Stop,
**Mausrad = Zoom zum Cursor**, Mittelklick ziehen = Karte greifen, WASD/Pfeile/Bildschirmrand = Pan,
Strg+Mittelklick = Rotation (Pos1 = zurück), H = eigener Start, Alt+Enter = Vollbild, **P = Pause**,
N = Einzelschritt, **^ / ` / F1 = Dev-Konsole** (`help`, `spawn`, `kill`, `pause`, `resume`, `step`, `speed`, `hash`,
`budget`, `export`, `map`, `camera`, `preset`).
URL-Parameter: `?map=hollow-ridge|testplane`, `?preset=low|medium|high|ultra`, `?units=<n>` (Flugtest),
`?assets=raw`, `?cubes=<n>`, `?enemy=<n>`, `?seed=<u32>`, `?transport=sab|transfer`, `?autostart=0`.

Testen: `pnpm typecheck && pnpm lint && pnpm test`; Cross-Engine `pnpm test:xengine`; Browser-E2E `pnpm test:e2e`;
alles nacheinander `pnpm ci:local`.

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
| `pnpm test:e2e` | `pnpm build` + Playwright (chromium, firefox, webkit; 1 Worker) gegen Port 4183 (COOP/COEP) und 4184 (ohne), verschiebbar mit `FAF_E2E_PORT`; ms-Grenzen nur mit `FAF_PERF_GATE=1` gegated |
| `pnpm test:xengine` | `test:xengine`-Skripte aller Pakete (Cross-Engine-Hash-Ketten) |
| `pnpm bench` | `bench`-Skripte aller Pakete (L6); Ergebnisse lokal und git-ignoriert (`bench-results/`, `tools/headless/results/`, `packages/sim-host/bench/results/`); `pnpm bench -- --update-docs` aktualisiert die Tabellen in `docs/status/ms2-p2-sim.md` |
| `pnpm maps` | Karten aus `content/maps/src` erzeugen (mapgen + mapc → `content/maps/*.rtsmap`, deterministisch) |
| `pnpm assets` | Asset-Pipeline (glTF/meshopt, Karte, `sim.bin`, Manifest) → `content/generated/assets/`; nach `pnpm maps` oder Blueprint-Änderungen ausführen |
| `pnpm bench:spk4` | SPK4-Render-Benchmark in Chromium, Firefox, WebKit (`-- --quick` = nur Chromium, 3 s) |
| `pnpm --filter @faf/render smoke` | Render-Smoke in 3 Browsern (GPU-Höhensonde == CPU, Decals, Context-Loss) |
| `pnpm ci:local` | typecheck → lint → test → test:xengine → test:e2e → bench → assets check → bench:spk4 --quick (sequenziell, lokales CI) |

Einzelnes Paket testen: `pnpm vitest run packages/fixed`. Einzelnes Paket-Skript: `pnpm --filter @faf/fixed gen:luts`.

`apps/game` einzeln: `pnpm --filter @faf/game run serve --port 4173 --coi` liefert `dist/` statisch aus
(`--coi` = COOP `same-origin` + COEP `require-corp` + CORP `same-origin`); `/` leitet auf `/b/<buildHash>/` weiter,
`/build.json` enthält `{ "buildHash": … }`. Der Build-Hash kommt aus `FAF_BUILD_HASH` (alter Name
`IRONFLOW_BUILD_HASH` wird weiter gelesen) oder `git rev-parse --short=12 HEAD`, bei schmutzigem Arbeitsbaum mit
Zusatz `-d<hash>` (Fallback `dev`). `deploy/nginx.conf` ist die Hosting-Konfiguration (COOP/COEP/CORP, Caching).

## Modelle ansehen

Die Einheiten-Modelle (Kitbash-DSL `@faf/modelkit`, Quellen in `content/models/<fraktion>/`) sind noch nicht ins
Spiel integriert. Ansehen kann man sie im Model-Viewer:

```sh
pnpm models          # GLBs + Metadaten → content/models/dist/, Icon-SVGs → content/icons/svg/
pnpm models:viewer   # Vite-Server, http://localhost:5210/ (oder nächster freier Port); mit Strg+C beenden
```

Routen: `#/` Galerie, `#/f/<fraktion>` Galerie einer Fraktion, `#/model/<fraktion>/<unit>` Einzelansicht mit
Teamfarben, Silhouette, Parts-Animation, Drahtgitter und Distanz-Slider (LOD/Icon), `#/compare` Größenvergleich,
`#/icons` Strategic Icons. Statischer Build: `pnpm --filter @faf/model-viewer build`. Kontaktabzüge und
Silhouettenblätter erzeugt `tools/heavy pnpm models:shots` (nach `/private/tmp/claude-501/faf-models/<fraktion>/`).
Kit, Konventionen, Stand und Integrationsplan stehen in [`docs/design/models.md`](docs/design/models.md), die Anleitung für
Autoren in [`content/models/README.md`](content/models/README.md).

## Paketstruktur

```
packages/
  fixed/       Q20.12 (Fx/FxSmall), Ang16 + LUT-Trig, isqrt, fxDiv mit Korrektur, rng32, xxHash32, SafeInt
  heap/        Arena (WebAssembly.Memory), Table-DSL, Handles, Slabs, Hash, Snapshot
  protocol/    Command-Codec, Frame-/Event-Layouts, Opcodes (append-only); src/transport/ = Browser-Transport
  formats/     Chunk-Container (CRC-32), .rtsmap, mapSimHash; scripts/ = mapc (CLI-Import), mapgen, maps
  rules/       gemeinsame Regeln (Terrainhöhe, Wassertiefe, Kategorien, Formeln) für Sim, Client, KI
  blueprints/  TypeBox-Schemas, define*(), Compiler → sim.bin / view.json / bundle.json + Hashes
  sim/         World, Systeme, Hash, FrameWriter (rein deterministisch)
  sim-host/    Worker-Entry (`@faf/sim-host/worker`), Scheduler, CommandSources, Command-Log, Headless-Entry
  render/      WebGL2-RHI, CDLOD-Terrain, Wasser, Decals, Unit-Culling/LOD/Merged-Part, Presets, Context-Loss
  client/      Input/Actions, FA-Kamera, Heightmap-Picking, ClientMap, Asset-Worker, Selection, Command-Builder
  modelkit/    Kitbash-DSL für Einheiten-Modelle (Primitive, Parts, Materialslots, Auto-LODs, GLB-Export), nur Content-Tooling
apps/
  game/        Vite-App (Spiel, Dev-Konsole), scripts/serve.mjs (statischer Server für E2E/Hosting-Test)
  model-viewer/ Model-Viewer (three.js, nur Tool): Galerie, Einzelansicht, Größenvergleich, Icons
tools/
  eslint-plugin-sim/  eigene ESLint-Regel `sim/determinism`
  headless/           Node-Runner, Browser-Harness (Playwright-Worker), Benchmarks, Replay-Verify
  assets-pipeline/    deterministische Asset-Pipeline (glTF + meshopt + Fallback, Manifest SHA-256)
  render-bench/       SPK4-Benchmark (Render-Last full/fallback/ms2)
  model-shots/        Playwright-Kontaktabzüge, Silhouettenblätter und Einzelbilder der Modelle
content/              Blueprints, Karten (`maps/src` → `maps/*.rtsmap`), Modelle (`models/<fraktion>/`), Icons (`icons/`), generierte Artefakte (`generated/`)
test/e2e/             Playwright-Specs (Root-`playwright.config.ts`)
docs/                 Plan, Entscheidungen, Status (`docs/STATUS.md`, Fragmente in `docs/status/`)
```

Erlaubte Abhängigkeiten (dependency-cruiser, PLAN §3.2): `fixed` ist Blatt; `heap`/`protocol`/`rules` → `fixed`;
`formats` → `fixed`, `protocol`; `blueprints` → `fixed`, `rules`; `sim` → `fixed`, `heap`, `protocol`, `rules`,
`blueprints`, `formats` (+ später `nav`);
`sim-host` → `sim`, `formats` und deren Abhängigkeiten (+ `ai`); `render` → `protocol`, `fixed`, `gl-matrix`;
`render-bench` importiert nie `sim`;
`client` → `render`, `protocol`, `rules`, `formats`, `blueprints`, `fixed`; nur `apps/*` importieren `client`;
`render`/`client`/`ai` importieren nie `sim`/`sim-host`; keine Zyklen; keine relativen Imports in fremde Pakete.

## Konventionen

- **Bibliotheks-Pakete haben kein `build`-Skript.** Ihre `exports` zeigen direkt auf `./src/*.ts`; Vite, Vitest und
  tsx konsumieren die Quellen. Nur `apps/game` baut. `tsc -b` erzeugt ausschließlich Deklarationen unter `dist/tsc`.
- **Tests** liegen in `<paket>/test/**/*.test.ts` und laufen nur über die Root-Vitest-Config. Hilfsdateien unter
  `test/support/`. Benchmarks unter `<paket>/bench/`, Offline-Skripte unter `<paket>/scripts/`.
- **Imports** innerhalb eines Pakets relativ **mit `.ts`-Endung** (`import { fx } from './fx.ts'`), paketübergreifend
  nur über den Paketnamen (`@faf/fixed`). Typ-Importe mit `import type` (`verbatimModuleSyntax`).
- **Determinismus** (PLAN §3.1/§3.12): In `packages/{fixed,heap,rules,formats,sim,nav}/src` und `packages/protocol/src`
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
