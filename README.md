# Flow & Fire (FAF)

Browser-RTS nach dem mechanischen Vorbild von Supreme Commander: Forged Alliance – mit eigener Fraktion,
eigenen Namen und eigenen Assets. Deterministische Q20.12-Fixed-Point-Simulation (10 Hz) in einem Web Worker,
eigene WebGL2-Pipeline, Preact-UI. Plan: [`docs/PLAN.md`](docs/PLAN.md), Entscheidungen:
[`docs/DECISIONS.md`](docs/DECISIONS.md), Stand: [`docs/STATUS.md`](docs/STATUS.md).

**Stand:** Meilensteine MS1 (deterministisches Skelett) und MS2 (Terrain, Karte & Kamera) sind abgeschlossen. Im
Browser läuft als Standardkarte *Setons* (1.024 WU, 8 Starts, eigener Nachbau nach dem Layout von *Seton's Clutch*;
eigenes `.rtsmap`-Format, aus Quellen per Generator + CLI erzeugt; die MS2-Karte *Hollow Ridge* per `?map=hollow-ridge`)
mit Heightmap-Terrain, Wasser, Mass-/Hydro-Spots und FA-typischer Kamera; 1.000 + 24 Würfel fahren auf der Terrainhöhe
der deterministischen Sim (Tiefwasser blockiert, Furten passierbar). Hash-Ketten sind bitgleich in Node, Chromium,
Firefox und WebKit. Details, Abnahme und Messwerte: [`docs/STATUS.md`](docs/STATUS.md).

## Schnellstart

```sh
pnpm install
pnpm dev            # http://localhost:5173/ – Spiel im Browser; mit Strg+C beenden
```

Steuerung: Linksklick/-ziehen wählt aus (Strg/⌘+A = alle eigenen), **Rechtsklick bewegt**, S tippen = Stop,
**Mausrad = Zoom zum Cursor**, Mittelklick ziehen = Karte greifen, WASD/Pfeile/Bildschirmrand = Pan,
Strg+Mittelklick = Rotation (Pos1 = zurück), H = eigener Start (auf Setons SW-Mid, Gegner NO-Mid gegenüber der
Landbrücke), Alt+Enter = Vollbild, **P = Pause**,
N = Einzelschritt, **^ / ` / F1 = Dev-Konsole** (`help`, `spawn`, `kill`, `pause`, `resume`, `step`, `speed`, `hash`,
`budget`, `export`, `map`, `camera`, `preset`).
URL-Parameter: `?map=setons|tessera|braidwater|hollow-ridge|testplane` (Standard `setons`; `tessera` und
`braidwater` = 1v1-Skirmish-Karten mit 512 WU, siehe STATUS „1v1-Karten“; `hollow-ridge` = 512-WU-Karte aus MS2,
`testplane` = flache MS1-Ebene), `?preset=low|medium|high|ultra`, `?units=<n>` (Flugtest über das Land der ganzen
Karte), `?assets=raw`, `?cubes=<n>` (eigene Würfel am eigenen Start), `?enemy=<n>` (Gegner-Würfel), `?seed=<u32>`,
`?transport=sab|transfer`, `?autostart=0`. Ohne Pathing (MS3) fahren Einheiten geradeaus: auf Setons führt Mid ↔ Mid
direkt über die Landbrücke, andere Ziele brauchen Wegpunkte um die Seen.

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
| `pnpm maps` | Karten aus `content/maps/src` erzeugen (mapgen inkl. Setons-Generator `mapgen-setons.ts` + mapc → `content/maps/*.rtsmap`, deterministisch) |
| `pnpm assets` | Asset-Pipeline (glTF/meshopt, Karte, `sim.bin`, Manifest) → `content/generated/assets/`; nach `pnpm maps` oder Blueprint-Änderungen ausführen |
| `pnpm bench:spk4` | SPK4-Render-Benchmark in Chromium, Firefox, WebKit (`-- --quick` = nur Chromium, 3 s) |
| `pnpm --filter @faf/render smoke` | Render-Smoke in 3 Browsern (GPU-Höhensonde == CPU, Decals, Context-Loss) |
| `pnpm sfx` / `pnpm sfx:audit` / `pnpm sfx:preview` | prozedurale SFX bauen (`content/audio/**/*.sfx.ts` → `content/audio/dist`), prüfen, anhören – siehe „Sounds anhören“ |
| `pnpm ci:local` | typecheck → lint → test → test:xengine → test:e2e → bench → assets check → bench:spk4 --quick (sequenziell, lokales CI) |

Einzelnes Paket testen: `pnpm vitest run packages/fixed`. Einzelnes Paket-Skript: `pnpm --filter @faf/fixed gen:luts`.

`apps/game` einzeln: `pnpm --filter @faf/game run serve --port 4173 --coi` liefert `dist/` statisch aus
(`--coi` = COOP `same-origin` + COEP `require-corp` + CORP `same-origin`); `/` leitet auf `/b/<buildHash>/` weiter,
`/build.json` enthält `{ "buildHash": … }`. Der Build-Hash kommt aus `FAF_BUILD_HASH` (alter Name
`IRONFLOW_BUILD_HASH` wird weiter gelesen) oder `git rev-parse --short=12 HEAD`, bei schmutzigem Arbeitsbaum mit
Zusatz `-d<hash>` (Fallback `dev`). `deploy/nginx.conf` ist die Hosting-Konfiguration (COOP/COEP/CORP, Caching).

## Sounds anhören

Alle Sounds sind prozedural synthetisiert (`tools/sfx`, keine Samples). Die Opus/WebM-Dateien und das Manifest
liegen eingecheckt in `content/audio/dist/`, anhören geht also sofort:

```sh
pnpm sfx:preview    # http://localhost:5190/tools/sfx/preview/ – Suche, Kategorie-Filter, Wellenform, Loops, Opus/WAV
```

Für WAVs, nach Änderungen an `content/audio/**/*.sfx.ts` oder `tools/sfx/src` und für neue Sounds (ffmpeg mit libopus nötig):

```sh
pnpm sfx            # rendert inkrementell; erster Lauf nach Checkout baut alles (auch die WAVs)
pnpm sfx:audit      # Lautheit, True Peak, Loop-Nähte, Varianten, 3-MB-Budget, SOUNDLIST – Exit 1 bei Verstoß
pnpm sfx:analyze content/audio/dist/varkan/wpn_cannon_t1_fire.v0.wav   # Einzelmessung + Spektrogramm
```

Liste aller Sounds: [`content/audio/SOUNDLIST.md`](content/audio/SOUNDLIST.md), Konzept und Integrationsplan:
[`docs/design/audio.md`](docs/design/audio.md), Werkzeug: [`tools/sfx/README.md`](tools/sfx/README.md).

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

## Design-Dokumente

Konzepte und Vorgaben unter [`docs/design/`](docs/design/) (Plan und Meilensteine: [`docs/PLAN.md`](docs/PLAN.md),
Feature-IDs: [`docs/features.json`](docs/features.json)):

| Datei | Inhalt |
|---|---|
| [`faction.md`](docs/design/faction.md) | Fraktion Varkan: Stil, Farben, Namen, Rollen, Hotbuild, Icons, Klang |
| [`roster.md`](docs/design/roster.md) + [`roster.json`](docs/design/roster.json) | alle 50 MVP-Einheiten mit Werten; `roster.json` ist die einzige Zahlenquelle (Werkzeug `tools/roster`) |
| [`models.md`](docs/design/models.md) | Kitbash-Modellkit, Konventionen, Stand |
| [`audio.md`](docs/design/audio.md) | Sounds, Alerts, Mischung, Integrationsplan |
| [`ui.md`](docs/design/ui.md) | UI/HUD-Designsystem „Gießhalle": Tokens, Layout, Komponenten, Tasten, Barrierefreiheit, Performance |
| [`ui-mockups/`](docs/design/ui-mockups/index.html) | statische, klickbare HTML-Mockups (HUD und Menüs) zu `ui.md` |
| [`ai.md`](docs/design/ai.md) + [`ai-openings.json`](docs/design/ai-openings.json) | Skirmish-KI: Manager, Eröffnungen, Schwierigkeitsgrade, Turnier-Gates; Eco-Nachrechnung mit [`tools/ai-sim`](tools/ai-sim/README.md) |

**Mockups öffnen:** `docs/design/ui-mockups/index.html` direkt im Browser öffnen (funktioniert über `file://`,
kein Server nötig), z. B. `open docs/design/ui-mockups/index.html`. Die Übersicht verlinkt alle Zustände; das HUD
nimmt URL-Parameter wie `hud.html?sel=factory&stall=1&flow=1` (Liste in `ui.md` §12). Screenshots mit Layout-Prüfung:
`PLAYWRIGHT_FROM=<…>/playwright/index.js node docs/design/ui-mockups/tools/shoot.mjs <ausgabeordner>`.
KI-Zahlen prüfen: `python3 tools/ai-sim/ecosim.py --check`.

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
