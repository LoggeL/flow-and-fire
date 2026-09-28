# P0-scaffold – Monorepo-Gerüst, Tooling, `packages/fixed` (MS1, Welle 0)

## Umgesetzt

### Workspace
- pnpm 11.10 Workspace (`packages/*`, `apps/*`, `tools/*`), Node ≥ 24, `"type": "module"` überall.
  Build-Skripte: nur `esbuild` erlaubt (`allowBuilds` in `pnpm-workspace.yaml`, pnpm-11-Syntax).
  pnpm 11 hat automatisch `minimumReleaseAgeExclude`-Einträge für typescript-eslint 8.71 ergänzt (frisches Release).
- Root-Devtools: typescript 5.9.3, vite 8.3.1, vitest 5.0.2, @playwright/test 1.63.0, eslint 10.11.0,
  @eslint/js 10, typescript-eslint 8.71, globals 17, dependency-cruiser 18.4, fast-check 4.10, tsx 4.23,
  wabt 1.0.39, @types/node 24.
- Paket-Skelette mit `package.json` (Workspace-Deps `workspace:*`, `exports` direkt auf `./src/*.ts`),
  `tsconfig.json` und `src/index.ts` (`export {};`): heap, protocol, rules, blueprints (+ @sinclair/typebox),
  sim, sim-host (`.` und `./worker` → `./src/worker.ts`), render (+ gl-matrix), client, tools/headless.
- Root-Skripte exakt wie vorgegeben: `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `test:xengine`,
  `bench`, `ci:local`.

### TypeScript
- `tsconfig.base.json`: strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `noImplicitReturns`, `verbatimModuleSyntax`, `isolatedModules`, ES2022/ESNext/Bundler,
  `composite` + `emitDeclarationOnly` (Ausgabe `dist/tsc`), `allowImportingTsExtensions`, JSX für Preact.
- lib-Zuordnung: fixed/heap/protocol/rules/blueprints/sim `["ES2022"]`, `types: []`; sim-host
  `["ES2022","WebWorker"]`; render/client/game DOM; tools/headless drei Projekte:
  `tsconfig.json` (Node, `src/`), `tsconfig.harness.json` (DOM, `harness/page/`),
  `tsconfig.harness-worker.json` (WebWorker, `harness/worker/`).
- Root `tsconfig.json` ist die Solution (alle 13 Projekte). `tsconfig.tests.json` prüft Tests, Benches, Skripte,
  `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts` (lib ES2022 + DOM, types node + vite/client).
- Geprüft: `setTimeout`, `console`, `document` in `packages/sim/src` sind Typfehler (TS2304/TS2584).

### Lint / Grenzen
- `eslint.config.js` (flat, `defineConfig`, nicht type-aware): @eslint/js + typescript-eslint recommended,
  Globals je Umgebung (Browser/Worker/Node), Ignores wie vorgegeben.
- `tools/eslint-plugin-sim` (plain ESM-JS, `@faf/eslint-plugin-sim`, Typen via `.d.ts`): Regel
  `sim/determinism` mit Optionen `sqrtAllow` / `float64Allow`; aktiv als `error` für
  `packages/{fixed,heap,rules,sim,nav}/src/**/*.ts` und `packages/protocol/src/**/*.ts` außer `src/transport/**`.
  Scope-basiert (Schatten-Variablen wie ein lokales `Date` werden nicht gemeldet, reine Typ-Referenzen wie
  `x: Map<…>` auch nicht). Zusätzlich erkannt: `globalThis.Date`, `self.setTimeout`, `Math`-Aliasing,
  computed `Math[x]`, `for await`, `import()` verbotener Pakete, `export … from`.
- Tests: `tools/eslint-plugin-sim/test/determinism.test.ts` (RuleTester, 55 invalid, 20 valid).
- `.dependency-cruiser.cjs`: alle Regeln aus PLAN §3.2 (nur `src/` ist gebunden; Tests/Benches frei),
  `no-circular`, `not-to-unresolvable` (Vite-`?query`-, `virtual:`- und `node:`-Importe ausgenommen),
  `no-deep-imports-into-packages`, `render-npm-deps` (nur gl-matrix). Regeln greifen auf aufgelöste Pfade **und**
  auf nicht aufgelöste `@faf/*`-Namen (nicht deklarierte Abhängigkeit). Absichtliche Verletzungen
  (fixed→heap, render→sim/preact, sim→client, sim-host→client, client→sim-host, Zyklus, Deep-Import)
  wurden alle gemeldet (16 Fehler) und wieder entfernt.

### Vitest / Playwright
- `vitest.config.ts`: include `{packages,apps,tools}/*/test/**/*.test.ts`, node, `pool: 'forks'`, `maxWorkers: 4`,
  `execArgv: ['--expose-gc']` (Vitest 5: Top-Level-Option; `globalThis.gc` in Tests verifiziert), testTimeout 30 s.
- `playwright.config.ts` (final): `test/e2e`, 1 Worker, retries 0, Reporter list + JSON (`test-results/e2e.json`),
  Projekte chromium/firefox/webkit, baseURL `http://localhost:4173`, zwei WebServer (4173 `--coi`, 4174 ohne),
  `reuseExistingServer: false`, Ready-Check über `/build.json`.
- WebGL2 headless auf diesem Mac (M5 Pro, Darwin 27) – ausprobiert:
  | Browser | Konfiguration | Renderer |
  |---|---|---|
  | Chromium 153 (headless shell) | ohne Flags | SwiftShader (Software, langsam) |
  | Chromium 153 | `--use-angle=metal --enable-unsafe-swiftshader --ignore-gpu-blocklist` (**gewählt**) | ANGLE Metal, Apple M5 Pro |
  | Firefox 155 | `CFFIXED_USER_HOME` gesetzt (s. u.) | „Apple M1, or similar“ (Hardware, maskiert) |
  | WebKit 26.6 | Standard | Apple GPU |
- **Firefox-Workaround:** Firefox startete nicht („Could not find profile folder.“), weil macOS den Zugriff auf
  `~/Library/Application Support/Firefox` verweigert („Operation not permitted“). Die Config setzt für Firefox
  auf macOS `CFFIXED_USER_HOME=node_modules/.cache/faf-firefox-home`. **Folgepakete, die Firefox direkt über
  die Playwright-API starten (z. B. Cross-Engine-Harness in tools/headless), müssen denselben `env`-Eintrag setzen.**

### apps/game-Gerüst
- `vite.config.ts`: Dev-Server immer mit COOP/COEP/CORP; Build mit `base: /b/<buildHash>/`,
  `outDir: dist/b/<buildHash>`, Worker-Format `es`, Sourcemaps; Plugin schreibt `dist/index.html`
  (Redirect auf `/b/<hash>/`, Query/Hash bleiben erhalten) und `dist/build.json` `{ buildHash }`.
  `__IRONFLOW_BUILD_HASH__` ist per `define` im Client verfügbar (`src/env.d.ts`).
- `scripts/serve.mjs`: reines `node:http`, `--port N`, `--coi`, optional `--host`/`--root`, MIME für
  `.js .mjs .wasm .bin .json .html .css` (+ map, Bilder, Fonts, glTF, KTX2, Audio), `/` → `dist/index.html`,
  Verzeichnis → `index.html`, Pfad-Traversal-Schutz, `Cache-Control: no-cache`, nur GET/HEAD.
- `index.html` + `src/main.ts`: Vollbild-Canvas per WebGL2 eingefärbt, Text „Flow & Fire – MS1-Gerüst“,
  `data-webgl2` / `data-coi` / `data-build` am `<html>`, Container `#ui-root` für das Preact-Overlay.

### packages/fixed (PLAN §3.3)
- `types.ts`: Brands `Fx`, `FxSmall` (Untertyp von `Fx`), `Ang16`, `Milli`, `SafeInt`, `Tick`, `Handle`, `ArmyId`;
  Cast-Helfer `asFx/asAng16/asMilli/asTick/asHandle/asArmyId`, Handle-Packing `makeHandle/handleIndex/handleGen`
  (`index:20 | gen:12`), `MAX_ARMIES = 16`.
- `constants.ts`: `FX_SHIFT = 12`, `FX_ONE = 4096`, Grenzen, `ANG_*`.
- `debug.ts`: `setFixedDebug(on)` / `isFixedDebug()`.
- `fx.ts`: `fx()`/`fxSmall()` (Literal-Helfer, round-half-up wie `Math.round`, ohne `Math.round`), `toFxSmall`,
  `fxFromInt`, `fxFloorToInt`/`fxCeilToInt`/`fxRoundToInt`, `fxFrac`, `fxAdd/Sub/Neg/Abs/Min/Max/Clamp`,
  `fxMulInt`, `fxMul`, `fxMulSmall` (Debug-Vergleich), `floorDivExact`, `fxDiv`, `fxDivInt`,
  `fxLen2D/fxLen3D/fxDist/fxDist2`, `fxLerp`.
- `isqrt.ts`: `isqrt` (einziger `Math.sqrt`), `fxSqrt`.
- `angle.ts`: `deg()`, `angAdd/angSub/angDiff/angRotateTowards`, `sinA/cosA` (Viertelwelle 4.096 Einträge +
  lineare Integer-Interpolation), `atan2A` (Oktanten-Reduktion + 1.024 Einträge + Interpolation), `angToDir`.
- `luts/sin_quarter.bin`, `luts/atan.bin` (u16 LE, eingecheckt), `src/luts.generated.ts` (Integer-Literal-Arrays +
  Hash-Konstanten), Generator `scripts/gen-luts.ts` (`pnpm --filter @faf/fixed gen:luts`).
- `rng.ts`: `rng32(seed, tick, entityIdx, salt)` (4 × murmur3-fmix32), `rngRange` (exaktes Multiply-High mit
  16-Bit-Split, n ≤ 2³²), `rngFxUnit`, `rngChanceMilli`.
- `xxhash32.ts`: `xxHash32(bytes, off, len, seed)`, `XxHash32` (reset/update/digest, allokationsfrei),
  Uint32-Schnellpfad bei 4-Byte-Alignment auf Little-Endian-Hosts, Uint32-View pro `ArrayBuffer` gecacht.
- `safeint.ts`: `toSafeInt` (`v + 0`, Debug: `Number.isSafeInteger`), `safeAdd`, `safeSub`.
- Bench `bench/fixed.bench.ts` (`pnpm bench`), schreibt `bench-results/fixed.json`.

## Tests & Messwerte (Node 24.18, Apple M5 Pro)

| Test | Ergebnis |
|---|---|
| BigInt-Orakel fxMul / fxDiv / isqrt / fxMulSmall, je 10⁶ Fälle + Randfälle | 0 Abweichungen (≈ 0,15 s je Suite) |
| LUT-Hash | `sin_quarter.bin` = `0x5A60F785`, `atan.bin` = `0x7BB4897C` (festgeschrieben) |
| `luts.generated.ts` == `.bin`, Generator reproduziert `.bin` | grün |
| sin/cos gegen `Math.sin/cos` (alle 65.536 Winkel) | max. Fehler 1,22 raw (Schranke im Test 1,5) |
| atan2A gegen `Math.atan2` | max. Fehler 1,61 Ang16 (Schranke im Test 2) |
| rng32 Goldenwerte, χ² (16 Buckets), Avalanche ≈ 16 Bit | grün |
| xxHash32: Sanity-Vektoren (leer/seed 0 = `0x02CC5D05`, …), String-Vektoren, BigInt-Referenz (3.000 Fälle, un-/aligned), Streaming == One-shot (2.000 zufällige Splits), Heap-Wachstum < 256 KB über 20.000 Streams | grün |
| SafeInt −0 → +0, Debug-Prüfungen | grün |
| `sim/determinism` RuleTester | 75 Fälle grün |
| Playwright-Smoke (4173 COI / 4174 ohne) × chromium/firefox/webkit | 6/6 grün (≈ 4 s) |
| `pnpm dev` + curl | 200, COOP `same-origin`, COEP `require-corp`, CORP `same-origin`; Titel „Flow & Fire“ |

Micro-Bench (ns/op, Median): fxMul 2,3 · fxMulSmall 3,5 · fxDiv 5,8 · isqrt 3,5 · sinA 3,6 · atan2A 5,9 ·
rng32 11,5. xxHash32 über 20 MB: ≈ 5,7 ms (≈ 3,4 GB/s) – **SPK5-Basiswert Node**; der Hash-Tick über
Live-Bereiche (≪ 20 MB) muss in den Browser-Workern gemessen werden.

## Verträge & Konventionen für Folgepakete

- **Keine Änderungen an Root-Konfiguration** (package.json, tsconfigs, eslint/vitest/playwright/dep-cruiser-Config).
  Alle benötigten Dependencies sind deklariert. Eigene `scripts` (`test:xengine`, `bench`, `build:harness` …)
  dürfen im **eigenen** Paket-`package.json` ergänzt werden; `test:xengine` und `bench` werden von den
  Root-Skripten automatisch eingesammelt.
- **Bibliotheks-Pakete haben kein `build`-Skript** (nur `apps/game`). Wer eins anlegt, landet in `pnpm build`
  und damit in `test:e2e`.
- Tests: `<paket>/test/**/*.test.ts`, Hilfen in `test/support/`, Benches in `bench/`, Skripte in `scripts/`.
  Nur über die Root-Config ausführen (`pnpm vitest run packages/<name>`).
- Imports: relativ mit `.ts`-Endung, paketübergreifend nur per Paketname. Der Paket-Einstieg ist
  `src/index.ts` (Skelett `export {};` ersetzen). Neue Quelldateien liegen unter `src/` (rootDir).
- `@faf/sim-host/worker` zeigt auf `packages/sim-host/src/worker.ts` – diese Datei legt das sim-host-Paket an.
- tools/headless: `src/` (Node, `types: ["node"]`), `harness/page/` (DOM), `harness/worker/` (WebWorker);
  Einstiege `src/index.ts`, `harness/page/main.ts`, `harness/worker/main.ts` sind Skelette. Harness-Build-Ausgabe
  nach `tools/headless/dist-harness/` (ignoriert von Lint/Git/Vitest).
- `@faf/fixed`-API-Semantik (bitgleich zu einer späteren i64-Portierung):
  - `fxMul(a, b) = floor(a·b / 4096)` → int32-Wrap (`| 0`); Invariante |a·b| ≤ 2⁵³ − 1 (z. B. |a|, |b| ≤ 2²⁶),
    im Debug geprüft.
  - `fxDiv(a, b) = floor(a·4096 / b)` für alle Vorzeichen, int32-Wrap, `b = 0` wirft `RangeError`.
  - `FxSmall`: |raw| ≤ 32.767; `fxMulSmall` ist dann exakt == `fxMul`.
  - `fxAdd/fxSub/...` wrappen auf int32 und erzeugen nie −0.
  - Winkel: 0 = +x, positiv Richtung +y; `cosA(atan2A(y, x)) ≈ x/|v|`. `atan2A` nimmt rohe Integer (|x|, |y| ≤ 2³¹).
  - `rng32` ist zustandslos; Salt-Konstanten pro Verwendungszweck (Streuung, Blip-Jitter …) im jeweiligen Paket festlegen.
  - Hash-Konvention: `xxHash32(u8, off, len, seed)`; für die Arena `XxHash32` wiederverwenden (keine Allokation).
  - Debug-Schalter `setFixedDebug(true)` in Tests/Dev; im Release aus.
- Firefox über die Playwright-API auf macOS: `env: { ...process.env, CFFIXED_USER_HOME: <dir> }` setzen (s. o.).

## Abweichungen (mit Begründung)

1. **FxSmall-Bereich:** PLAN nennt „FxSmall < 2¹⁵ WU“. `Math.imul(a, b) >> 12` ist nur für |a·b| < 2³¹ exakt,
   daher gilt |raw| ≤ 2¹⁵ − 1 (< 8 WU) – typische Nutzung: Einheitsvektoren (sin/cos ≤ 4.096), Geschwindigkeiten pro Tick.
2. **Überlauf-Semantik:** fxMul/fxDiv/fxAdd liefern int32 per Two's-Complement-Wrap (wie `as i32`), statt zu werfen;
   nur die Exaktheits-Invariante von fxMul wird im Debug geprüft.
3. **LUT-Auflösung:** Neben der Tabellen-Lookup-Vorgabe wird zwischen Nachbareinträgen linear (rein ganzzahlig)
   interpoliert; das hält den Fehler bei ≤ 1,5 raw bzw. ≤ 2 Ang16 bei voller 16-Bit-Winkelauflösung.
4. **dependency-cruiser:** `render` darf zusätzlich `fixed` importieren (Fx-Konstanten für ivec3/4096-Umrechnung,
   `fixed` ist ein reines Blatt); `sim-host` darf zusätzlich `ai` importieren (PLAN §3.10: AiHost-Fallback im
   Sim-Worker bei ≤ 2 Kernen); `nav`, `formats`, `ai` sind bereits mit ihren PLAN-Regeln hinterlegt.
5. **Zusätzliche Deps:** `client` hat zusätzlich `preact`, `@preact/signals` und `@faf/rules` (PLAN §3.2: UI
   in client, client → rules), `sim-host` zusätzlich `@faf/rules`, `apps/game` zusätzlich `@babel/core`
   (Peer von `@preact/preset-vite`) und `@types/node` (vite.config.ts).
6. **Firefox auf macOS:** `CFFIXED_USER_HOME`-Workaround (TCC-Sperre für `Application Support`), sonst kein Start.
7. **Chromium:** `--use-angle=metal` statt SwiftShader, damit Headless-Messungen die echte GPU nutzen.
8. Bun entfällt (nicht installiert), Cross-Engine = Node + 3 Playwright-Browser (DECISIONS).
9. **Skelett-Einstiege in tools/headless** (`src/index.ts`, `harness/page/main.ts`, `harness/worker/main.ts`,
   je `export {};`) liegen formal außerhalb der owns-Liste, sind aber nötig, weil `tsc -b` Projekte ohne
   Eingabedateien ablehnt (TS18003) und die Root-Solution sie referenzieren muss. Das headless-Paket ersetzt sie.

## Bekannte Grenzen

- `pnpm test:xengine` und `pnpm bench` sammeln bisher nur `fixed` (bench) ein; Cross-Engine-Hash-Ketten folgen
  mit sim/sim-host/headless.
- Der Smoke-Test prüft WebGL2 und COOP/COEP, rendert aber noch nichts Spielrelevantes.
- ESLint ist bewusst nicht type-aware (Speicher); `sim/determinism` erkennt z. B. `Math` hinter einem
  Funktionsparameter oder Floats aus Divisionen nicht – Divisionen (`/`) sind erlaubt und müssen mit
  `Math.floor`/`floorDivExact` abgeschlossen werden (Review-Pflicht, durch Hash-Tests abgesichert).
- `serve.mjs` lauscht ohne `--host` dual-stack auf allen Interfaces. Auf diesem Mac lief während der Tests ein
  fremder Prozess (`python3 -m http.server 4173 --bind 127.0.0.1`, Projekt LMF) auf 127.0.0.1:4173; die Browser
  erreichten über `localhost` (::1) trotzdem den FAF-Server (Smoke prüft `crossOriginIsolated` und
  `/build.json`). Kollidiert ein fremder Dienst auch auf ::1, schlägt der WebServer-Start fehl.
- `apps/game/dist/tsc` (Deklarationen aus `tsc -b`) liegt neben dem Build und wird von `serve.mjs` mit ausgeliefert
  (harmlos, nur `.d.ts`).
