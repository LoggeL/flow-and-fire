# P6-headless – `tools/headless`: Szenarien, L2-Goldens, Cross-Engine-Harness, Benchmarks, SPK1/SPK5 (MS1, Welle 3)

Fortsetzung eines abgebrochenen Laufs: `tools/headless` enthielt nur Skelette (`export {}`) und zwei leere
Harness-Einstiege unter `harness/`. Diese wurden entfernt; alles liegt jetzt unter `src/` (siehe Abweichungen).

## Umgesetzt

### L2-Szenarien und Goldens (S7, PLAN §3.12)

- `src/scenario.ts`: **`ScenarioBuilder {map, seed, spawns, commands@tick, asserts}`** – fluente API
  (`map({sizeWu})`, `seed`, `armies`, `ally`, `ticks`, `spawn(...)` in Tick 1, `at(tick, ctx => cmds)`,
  `assert(tick, name, ctx => true | Fehlertext)`, `build()`). `runScenario(scenario, {simBin | bpTable})` läuft auf
  `sim.createWorld/step` mit echten **protocol-Batches** (`CommandBatchEncoder`; Move, Stop, Cheat Spawn/Kill; seq pro
  ausgebender Army automatisch, Envelope-Tick = Anwendungs-Tick) und liefert **Hash-Trail** (Regel-Hash alle 10 Ticks,
  `lastHash` bei `lastHashTick == tick`), **End-Regel- und End-Voll-Hash**, Assert-Ergebnisse, Unit-/Command-Zahl.
  Befehls-Callbacks lesen nur den Weltzustand (Handles in Slot-Reihenfolge, `unitInfo`) und ein pro Lauf frisches
  `vars`-Objekt ⇒ jede Engine erzeugt byte-identische Befehle.
- `src/scenarios.ts` – zwei Goldens (je 2.000 Ticks, 512-WU-Ebene, 2 Armies):
  - **`cubes-1000-move`**: 700 + 300 Würfel per Cheat Spawn (Tick 1), Move-Befehle für Teilgruppen an Tick
    **2**/300/700/1.100/1.500 (Viertel-, Halb-, Drittel-, Fünftelgruppen, Queue-Flag). Asserts: Spawn-Zahlen, Gruppe 0
    hat sich bei Tick 290 am Ziel gesammelt (≥ 90 % in 24 WU), am Ende 1.000 lebend und alle in der Karte.
  - **`cubes-churn`**: je 200 Würfel pro Army; Kill jeder 4. Einheit (Tick 50) → Respawn (Tick 60) **nutzt genau die
    freien Slots FIFO mit gen+1**; Army 0 befiehlt Einheiten von Army 1 (Tick 100) → **abgewiesen, aber quittiert**
    (`lastAckSeq`); Stop (Tick 150/1.200) → Einheiten stehen; Army 1 komplett gekillt (Tick 1.000) und mit 260
    neu gespawnt (highWater wächst); rollierender Churn (alle 200 Ticks Kill jeder 5. Einheit beider Armies, Respawn
    einen Tick später an anderer Stelle, neue Ziele). 8 Asserts.
- `src/goldens.ts`: Format `faf-golden` v1 (`scenario, ticks, seed, simHash, layoutHash, hashIntervalTicks,
  finalUnitCount, commandCount, finalRuleHash, finalFullHash, trail[200]` als Hex), `compareChains` → erster
  abweichender Tick. Goldens: `tools/headless/goldens/cubes-1000-move.json`, `cubes-churn.json`.
- Skript **`goldens`** (`pnpm --filter @faf/headless goldens`) prüft; `goldens -- --update` schreibt neu und meldet
  den ersten abweichenden Tick gegenüber dem alten Golden. Exit ≠ 0 bei Abweichung oder fehlgeschlagenem Assert.

| Golden | Trail | End-Regel-Hash | End-Voll-Hash | simHash | layoutHash |
|---|---|---|---|---|---|
| cubes-1000-move | 200 × Regel-Hash | `0x20ff4ad9` | `0xd90c05bd` | `0xd4135af1` | `0xa15987bf` |
| cubes-churn | 200 × Regel-Hash | `0x92027d77` | `0x3c551981` | `0xd4135af1` | `0xa15987bf` |

### Cross-Engine-Harness (L3) und Jobs

- `src/jobs.ts`: **ein** Einstieg `runJob(job, mode, assets, env)` für Node und Browser-Worker ⇒ identischer Code in allen
  Engines. Jobs: `hashChain(scenario)`, `tickBench`, `spk1`, `spk5`; Ergebnisse als JSON. `src/series.ts`:
  **kalt** = erster Lauf im frischen Worker/Prozess, **warm** = Lauf nach 3 Aufwärmläufen im selben Worker (die
  Hash-Ketten der Aufwärmläufe werden mitgeprüft).
- `src/harness/worker-entry.ts` (Module-Worker; lädt `sim.bin` und `xxh32.wasm` per `new URL(…, import.meta.url)`),
  `src/harness/page/{index.html, main.ts}` (`window.fafHarness.series(job, engine)`: frischer Worker pro Serie,
  danach `terminate`). Build per **`build:harness`** (`vite build -c vite.harness.config.ts`) nach
  `tools/headless/dist-harness/` (git-ignoriert).
- `playwright.xengine.config.ts`: Projekte chromium/firefox/webkit, `workers: 1`, Launch-Einstellungen wie Root-Config
  (inkl. Firefox-`CFFIXED_USER_HOME`), **kein webServer**. Specs `browser/xengine.spec.ts` und `browser/bench.spec.ts`
  liefern `dist-harness` per `page.route('https://flow-and-fire.test/**')` mit COOP/COEP/CORP aus
  (⇒ `crossOriginIsolated`), starten den Worker und schreiben Rohdaten nach `results/*.tmp.json` (git-ignoriert).
- Skript **`test:xengine`** (`scripts/xengine.ts`): Harness bauen → Node-Referenz (frischer Prozess je Szenario) →
  Playwright (3 Engines nacheinander) → Vergleich jeder Kette (kalt, warm, 3 Aufwärmläufe) mit dem Golden; Exit ≠ 0
  mit erstem abweichenden Tick; Bericht `tools/headless/results/xengine-<datum>.json`.

**Ergebnis L3 (lokal gemessen, Apple M5 Pro, nicht Referenz-Laptop):** 40 Hash-Ketten (2 Szenarien × 4 Engines ×
kalt/warm/3 Aufwärmläufe) über je 2.000 Ticks **bitgleich** zu den Goldens – Node 24.18 (V8), Chromium (V8),
Firefox (SpiderMonkey), WebKit (JavaScriptCore). Laufzeit je Kette `cubes-1000-move` (ms):

| Engine | kalt | warm |
|---|---|---|
| node | 1.037 | 924 |
| chromium | 729 | 648 |
| firefox | 924 | 832 |
| webkit | 584 | 490 |

(Letzter Lauf `test:xengine`, Bericht `tools/headless/results/xengine-2026-09-28.json`; Node-Kaltlauf inkl.
tsx-Transform beim ersten Import. Gesamtlaufzeit des Skripts inkl. Build ≈ 25 s.)

### Tick-Benchmark (L6), SPK1, SPK5

- `src/tickbench.ts`: 1.000 Würfel (Cheat Spawn, Streuung 120 WU), 20 Gruppen à 50, **jeder Tick bekommt eine Gruppe
  ein neues Ziel** (rng32) ⇒ alle fahren dauerhaft. p50/p95/p99 für `step` gesamt, jede aktive Phase und den
  Hash-Tick (Probe-Phase `HashTick`).
- `src/measure.ts`: Zeitmessung pro Tick; bei grober Engine-Uhr (**WebKit-Worker: 1 ms**, auch mit
  crossOriginIsolated) wird jeder Tick per **Arena-Snapshot/Restore mehrfach** ausgeführt und gemittelt
  (Restore-Kosten separat gemessen und abgezogen; Ziel-Auflösung Tick-Bench 0,05 ms, SPK1 0,25 ms). Der simulierte
  Verlauf bleibt identisch (letzte Wiederholung = einfacher Step).
- **SPK1** (`src/spk1/`, Prototyp auf `fixed` + `heap`, eine Arena, deterministisch, **lint-geprüft mit
  `sim/determinism`** im Test): 1.000 Bodeneinheiten (Light/Heavy/AA) mit Steering + **Separation über das 4-WU-Grid**
  (Gauss-Seidel, ≤ 8 Nachbarn), **gestaffeltes Targeting** (Waffenzeile mod 3, bei Zielverlust sofort neu;
  Kategorie-Prioritäten, Distanz, Sichtprüfung, Luft zuerst für AA; Scan im 16-WU-Grobgrid), Waffen mit Vorhalt und
  rng32-Streuung, **≈ 4.000 Projektile** (Live-Budget 4.000) mit **Swept-Segment-DDA** (Amanatides–Woo mit
  ganzzahligen Kreuzvergleichen) im **4-WU-Fein-Grid** (Footprint-Mehrfacheintrag) und Treffertest **im Bezugssystem
  des Ziels** (p0 − Ziel_prev → p1 − Ziel_cur, Kapsel-Test in 1/256 WU), Schaden/Tod/Respawn mit Slot-Reuse,
  **Vision-Stamp per Row-Span-Delta bei Zellwechsel** (u16-Refcount-Grid, 2 Teams, Radius 5/8 Zellen),
  **300 Flugzeuge kinematisch** (Mindesttempo, Wenderate, Kreisen am Wegpunkt), **Regel-Hash alle 10 Ticks** über die
  Arena (Grids/Vision als derived). Messung je Teilsystem + gesamt.
- **SPK5** (`src/spk5/`): Arena 20 MiB `WebAssembly.Memory`; **xxHash32 handgeschrieben in WAT**
  (`src/spk5/xxh32.wat`, importiert dieselbe Memory, Skript **`build:wasm`** → `xxh32.wasm` per wabt, eingecheckt);
  Gleichheit JS == WASM (20 MiB, Live-Bereich, 400 Zufallsbereiche mit unausgerichteten Offsets); Durchsatz 20 MiB;
  **realistischer Live-Bereich** = echter `sim.ruleHash` mit 1.000 Units (gezählte Live-Bytes) plus JS/WASM one-shot
  über gleich viele Bytes; `memcpy`-Snapshot/Restore (20 MiB und Sim-Arena); Keyframe-Kompression
  `CompressionStream('deflate-raw')` der Sim-Arena (Zeit, Ratio, Roundtrip per `DecompressionStream`) und 20 MiB
  Zufallsdaten (Worst Case).
- Skript **`bench`** (`scripts/bench.ts`): Tick-Bench + SPK1 + SPK5 in Node (frischer Prozess je Job) und den drei
  Browser-Workern (nacheinander), kalt/warm; Bericht `results/bench-<datum>.json`, Tabellen unten (automatisch
  zwischen den Markern ersetzt). Budgets reißen ⇒ Exit 0, aber Entscheidung wird dokumentiert; Exit ≠ 0 nur bei
  fehlenden Ergebnissen, JS≠WASM oder abweichenden SPK1-Hashes zwischen Engines.

## Messwerte

<!-- bench:begin -->
Letzter Lauf: 2026-09-28, `pnpm --filter @faf/headless bench`. **Lokal gemessen (Apple M5 Pro), nicht Referenz-Laptop.**
Node v24.18.0; Browser: Playwright-Builds (headless) von Chromium, Firefox, WebKit, Module-Worker, crossOriginIsolated.
JIT kalt = erster Lauf im frischen Worker bzw. Node-Prozess, warm = Lauf nach 3 Aufwärmläufen im selben Worker.
Reps > 1: Engine-Uhr zu grob (WebKit 1 ms) → jeder Tick wird per Arena-Snapshot/Restore mehrfach ausgeführt und gemittelt (Restore-Kosten abgezogen).

| Kriterium | Budget | gemessen (max. über Engines, kalt/warm) | Ergebnis |
|---|---|---|---|
| MS1 Sim-Tick p95, 1.000 fahrende Würfel, inkl. Hash-Tick | ≤ 2 ms | 0,216 ms (node kalt) | erfüllt |
| SPK1 Big-Battle-Prototyp p95 | ≤ 25 ms | 1,12 ms (firefox kalt) | erfüllt → TS |
| SPK5 Hash-Tick (Live-Bereich, 1.000 Units) p95 | ≤ 2 ms | 0,395 ms | erfüllt → JS-Hash |

### Tick-Bench MS1 (1.000 fahrende Würfel, 1000 gemessene Ticks)

Sim-Tick gesamt (`step` inkl. CommandApply und Hash-Tick) sowie Hash-Tick allein (nur Hash-Ticks, jeder 10.).

| Engine | JIT | Reps | Uhr | p50 | p95 | p99 | max | Hash-Tick p95 | fahrend am Ende |
|---|---|---|---|---|---|---|---|---|---|
| node | kalt | 1 | 0,0001 ms | 0,170 | **0,216** | 0,348 | 6,47 | 0,176 | 1000/1000 |
| node | warm | 1 | 0,0001 ms | 0,169 | **0,208** | 0,222 | 0,233 | 0,043 | 1000/1000 |
| chromium | kalt | 1 | 0,0050 ms | 0,120 | **0,145** | 0,490 | 0,885 | 0,395 | 1000/1000 |
| chromium | warm | 1 | 0,0050 ms | 0,115 | **0,135** | 0,145 | 0,170 | 0,015 | 1000/1000 |
| firefox | kalt | 1 | 0,0200 ms | 0,140 | **0,180** | 0,220 | 0,520 | 0,080 | 1000/1000 |
| firefox | warm | 1 | 0,0200 ms | 0,140 | **0,180** | 0,200 | 0,220 | 0,060 | 1000/1000 |
| webkit | kalt | 20 | 1,0000 ms | 0,032 | **0,082** | 0,132 | 0,232 | 0,050 | 1000/1000 |
| webkit | warm | 20 | 1,0000 ms | 0,034 | **0,084** | 0,084 | 0,084 | 0,050 | 1000/1000 |

p95 je Phase (ms):

| Engine | JIT | CommandApply | Orders | Movement | SpatialRebuild | Cleanup | Output | HashTick |
|---|---|---|---|---|---|---|---|---|
| node | kalt | 0,003 | 0,014 | 0,153 | 0,029 | 0,002 | 0,040 | 0,176 |
| node | warm | 0,001 | 0,013 | 0,149 | 0,029 | 0,002 | 0,040 | 0,043 |
| chromium | kalt | 0,005 | 0,010 | 0,110 | 0,030 | 0,005 | 0,015 | 0,395 |
| chromium | warm | 0,005 | 0,010 | 0,105 | 0,030 | 0,005 | 0,015 | 0,015 |
| firefox | kalt | 0,020 | 0,020 | 0,140 | 0,020 | 0,000 | 0,040 | 0,080 |
| firefox | warm | 0,000 | 0,020 | 0,140 | 0,020 | 0,000 | 0,040 | 0,060 |
| webkit | kalt | 0,000 | 0,000 | 0,100 | 0,050 | 0,000 | 0,000 | 0,050 |
| webkit | warm | 0,000 | 0,000 | 0,100 | 0,050 | 0,000 | 0,000 | 0,050 |

**Ziel MS1:** p95 ≤ 2 ms im langsamsten Engine-Worker inkl. Hash-Tick → gemessen max. p95 = **0,216 ms** (node kalt) ⇒ **erfüllt**.

### SPK1 Sim-Durchsatz (1.000 Bodeneinheiten, 300 Flugzeuge, ≈ 4.000 Projektile; 300 Ticks nach 40 Ramp-Ticks)

| Engine | JIT | Reps | p50 | p95 | p99 | max | Projektile Ø (min) | Treffer/Kills gesamt |
|---|---|---|---|---|---|---|---|---|
| node | kalt | 1 | 0,927 | **1,04** | 1,20 | 1,54 | 3863 (3792) | 41523/437 |
| node | warm | 1 | 0,918 | **0,997** | 1,04 | 1,05 | 3863 (3792) | 41523/437 |
| chromium | kalt | 1 | 0,885 | **1,01** | 1,50 | 1,53 | 3863 (3792) | 41523/437 |
| chromium | warm | 1 | 0,875 | **0,940** | 0,970 | 1,02 | 3863 (3792) | 41523/437 |
| firefox | kalt | 1 | 1,00 | **1,12** | 1,22 | 1,60 | 3863 (3792) | 41523/437 |
| firefox | warm | 1 | 1,00 | **1,08** | 1,14 | 1,16 | 3863 (3792) | 41523/437 |
| webkit | kalt | 4 | 0,496 | **0,746** | 0,996 | 1,25 | 3863 (3792) | 41523/437 |
| webkit | warm | 4 | 0,496 | **0,746** | 0,746 | 0,746 | 3863 (3792) | 41523/437 |

p95 je Teilsystem (ms):

| Engine | JIT | Movement | Air | Spatial | Vision | Targeting | Weapons | Projectiles | Cleanup | Hash |
|---|---|---|---|---|---|---|---|---|---|---|
| node | kalt | 0,161 | 0,015 | 0,086 | 0,034 | 0,508 | 0,049 | 0,190 | 0,006 | 0,220 |
| node | warm | 0,155 | 0,011 | 0,088 | 0,032 | 0,501 | 0,046 | 0,174 | 0,005 | 0,051 |
| chromium | kalt | 0,145 | 0,015 | 0,090 | 0,030 | 0,495 | 0,045 | 0,175 | 0,010 | 0,565 |
| chromium | warm | 0,145 | 0,010 | 0,085 | 0,030 | 0,480 | 0,045 | 0,170 | 0,005 | 0,030 |
| firefox | kalt | 0,220 | 0,020 | 0,080 | 0,080 | 0,480 | 0,020 | 0,220 | 0,020 | 0,080 |
| firefox | warm | 0,220 | 0,020 | 0,080 | 0,080 | 0,480 | 0,020 | 0,200 | 0,020 | 0,080 |
| webkit | kalt | 0,250 | 0,000 | 0,250 | 0,250 | 0,500 | 0,250 | 0,500 | 0,000 | 0,500 |
| webkit | warm | 0,250 | 0,000 | 0,250 | 0,250 | 0,500 | 0,250 | 0,500 | 0,000 | 0,000 |

**Exit SPK1 (§4):** p95 ≤ 25 ms in der langsamsten Engine inkl. Hash-Tick → gemessen max. p95 = **1,12 ms** (firefox kalt) ⇒ **erfüllt – alles bleibt TypeScript** (Rust/WASM-Ausweg aus DECISIONS Punkt 2 wird nicht gezogen).
End-Hash des SPK1-Laufs in allen Engines/Modi: 0xe14862d1 (identisch).

### SPK5 Hash & Snapshot (Arena 20 MiB `WebAssembly.Memory`, warm)

| Engine | JS==WASM (20 MiB / Live / 400 Zufallsbereiche) | xxh32 JS 20 MiB | xxh32 WASM 20 MiB | Live-Bytes | Sim-Regel-Hash p95 (Hash-Tick) | kalt p95 | JS Live p95 | WASM Live p95 |
|---|---|---|---|---|---|---|---|---|
| node | ja / ja / ja | 12,1 ms (1,73 GB/s) | 1,56 ms (13,40 GB/s) | 141648 | **0,042 ms** | 0,169 ms | 0,065 ms | 0,010 ms |
| chromium | ja / ja / ja | 1,70 ms (12,34 GB/s) | 1,58 ms (13,27 GB/s) | 141648 | **0,020 ms** | 0,300 ms | 0,015 ms | 0,015 ms |
| firefox | ja / ja / ja | 2,90 ms (7,23 GB/s) | 1,64 ms (12,79 GB/s) | 141648 | **0,050 ms** | 0,060 ms | 0,020 ms | 0,020 ms |
| webkit | ja / ja / ja | 1,85 ms (11,34 GB/s) | 1,70 ms (12,34 GB/s) | 141648 | **0,020 ms** | 0,020 ms | 0,020 ms | 0,020 ms |

| Engine | Snapshot 20 MiB p50 (Arena → Puffer) | Restore 20 MiB p50 (Puffer → Arena) | Sim-Snapshot (Bytes) p95 | Sim-Restore p95 | Keyframe deflate-raw (Bytes → Bytes, Ratio) | deflate p50 | inflate p50 | 20 MiB Zufall deflate p50 (Ratio) |
|---|---|---|---|---|---|---|---|---|
| node | 0,292 ms | 0,285 ms | 0,018 ms (1452760) | 0,017 ms | 1452760 → 40232 (36,1:1) | 2,20 ms | 1,01 ms | 236,5 ms (1,01:1) |
| chromium | 0,325 ms | 0,305 ms | 0,020 ms (1452760) | 0,020 ms | 1452760 → 40232 (36,1:1) | 2,06 ms | 0,440 ms | 220,0 ms (1,01:1) |
| firefox | 0,560 ms | 0,580 ms | 0,020 ms (1452760) | 0,020 ms | 1452760 → 38527 (37,7:1) | 0,600 ms | 0,400 ms | 189,5 ms (1,01:1) |
| webkit | 0,900 ms | 0,350 ms | 0,030 ms (1452760) | 0,030 ms | 1452760 → 35857 (40,5:1) | 3,00 ms | 1,00 ms | 294,0 ms (1,01:1) |

**Exit SPK5 (§4):** Hash-Tick ≤ 2 ms in der langsamsten Engine → gemessen max. p95 = **0,395 ms** (SPK5-Live-Hash: 0,300 ms, chromium kalt; Tick-Bench-Hash-Tick: 0,395 ms, chromium kalt) ⇒ **erfüllt – Live-Bereich-Hash bleibt in JS** (kein Rolling-Hash, kein WASM nötig).

<!-- bench:end -->

Beobachtungen zu den Messwerten (lokal, Apple M5 Pro):

- Alle drei Budgets werden mit großem Abstand eingehalten (MS1-Tick < 0,3 ms bei 2 ms Budget, SPK1 ≈ 1–1,6 ms bei
  25 ms, Hash-Tick < 0,5 ms bei 2 ms). Der Abstand deckt den langsameren Referenz-Laptop plausibel ab, belegt ihn aber
  nicht (DECISIONS 5).
- **SPK1-Entscheidung: alles bleibt TypeScript.** Größter Posten ist das Targeting (≈ 50 % des Ticks), gefolgt von
  Projektilen und Movement. **SPK5-Entscheidung: Live-Bereich-Hash in JS** (kein Rolling-Hash, kein WASM-Hash);
  WASM-xxh32 ist bei 20 MiB bis zu 8× schneller (Node), für den realen Live-Bereich (≈ 140 KB) aber irrelevant.
- JS-xxh32 über 20 MiB in Node: kalt ≈ 5,5 ms, nach den gemischten (unausgerichteten) Kreuzprüfungen der
  Aufwärmläufe ≈ 12 ms (V8 deoptimiert den ausgerichteten Schnellpfad); Chromium/WebKit zeigen das nicht.
- Kalt-Ausreißer: Der erste Hash-Tick im frischen Chromium-Worker liegt bei ≈ 0,3–0,5 ms (JIT), warm bei ≈ 0,03 ms.
- Der User-Agent des Chromium-Projekts ist der emulierte „Desktop Chrome“-String von Playwright (Windows); die Engine
  läuft auf macOS.

## Tests (`pnpm vitest run tools/headless`)

- `test/goldens.test.ts`: beide Szenarien in Node – alle Asserts grün, 200 Trail-Hashes + End-Hashes == Golden,
  simHash/layoutHash == Golden, Kette bewegt sich; `compareChains` meldet den ersten abweichenden Tick.
- `test/spk1.test.ts`: zwei Läufe ⇒ gleiche Hash-Kette (anderer Seed ⇒ andere); Last (1.000 Boden, 300 Luft,
  > 3.600 Projektile, Treffer, Kills); **Row-Span-Delta == vollständiges Neu-Stempeln**; Snapshot/Restore mitten im
  Lauf ⇒ bytegleicher Zustand; **ESLint `sim/determinism` auf `world.ts`/`systems.ts` ohne Befund**.
- `test/spk5.test.ts`: Referenzvektoren (`XXH32("") = 0x02CC5D05`, `XXH32("abc") = 0x32D153FF`), **WASM == JS** für
  alle Längen 0–96 an Offsets 0–7 mit 4 Seeds, 900 Zufallsbereiche, 1 MiB komplett.

## Verträge für Folgepakete

- Neues L2-Golden: Szenario in `src/scenarios.ts` (Name in `SCENARIOS`) → `pnpm --filter @faf/headless goldens --
  --update` → Golden-Datei einchecken; `test:xengine` prüft es automatisch in allen Engines.
- Sim-Änderungen, die Hashes ändern (Layout, Phasen, Konstanten, sim.bin), brechen beide Goldens: bewusst mit
  `--update` erneuern (Ausgabe nennt den ersten abweichenden Tick) und in STATUS erwähnen.
- Harness-Jobs erweitern: Variante in `Job` (`src/jobs.ts`) + Zweig in `runJob`; Worker/Seite bleiben unverändert.
- P7 (Abschluss): Abnahmezeilen „Hash-Kette bitgleich …“, „Sim p95 ≤ 2 ms …“, „≥ 2 L2-Goldens“ und die
  Spike-Tabelle (SPK1, SPK5) aus diesem Fragment bzw. `results/xengine-*.json`/`bench-*.json` übernehmen.

## Abweichungen (mit Begründung)

1. **`https://flow-and-fire.test`** statt `http://…` für `page.route`: `crossOriginIsolated` verlangt einen sicheren
   Kontext. Unter `http` klemmen die Browser `performance.now()` im Worker auf 0,1 ms (Chromium) bzw. 1 ms (Firefox,
   WebKit) – Phasenzeiten wären nicht messbar. Mit `https` + COOP/COEP: Chromium 5 µs, Firefox 20 µs, WebKit weiterhin
   1 ms (daher die Wiederholungsmessung). Es gibt keinen Netzverkehr, alle Anfragen werden aus `dist-harness` erfüllt.
2. **Erste Move-Gruppe an Tick 2** statt 1 (`cubes-1000-move`): Handles existieren erst nach dem Spawn-Step in Tick 1;
   Ticks 300/700/1.100/1.500 wie gefordert.
3. **Harness-Quellen unter `src/harness/`** (statt der Gerüst-Ordner `harness/page`, `harness/worker`): Die Root-Solution
   referenziert weiterhin `tools/headless/tsconfig.harness.json` (Seite + Playwright-Specs + Config, DOM + Node-Typen)
   und `tsconfig.harness-worker.json` (gesamtes `src/` außer der Seite mit `lib: WebWorker`, `types: []` ⇒ Node-APIs im
   geteilten Code sind ein Compile-Fehler); `tsconfig.json` prüft `src/` außer Harness mit Node-Typen. Specs und
   `playwright.xengine.config.ts` liegen nicht in `tsconfig.tests.json` (Root, nicht in meinen owns) und werden deshalb
   über `tsconfig.harness.json` typgeprüft.
4. **Bun entfällt** (DECISIONS): JSC wird über Playwright-WebKit abgedeckt.
5. **SPK1 läuft nicht unter der Root-Lint-Regel** (`eslint.config.js` gehört nicht zu meinen owns); stattdessen prüft
   `test/spk1.test.ts` die Sim-Dateien des Prototyps programmatisch mit `@faf/eslint-plugin-sim`.
6. **SPK1-Messung ab Tick 41**: 40 ungemessene Ramp-Ticks füllen den Projektilpool auf die Big-Battle-Last; kalt/warm
   bezieht sich auf den Worker (der kalte Lauf enthält die JIT-Aufwärmung der Ramp-Ticks nicht in der Statistik, wohl
   aber die der ersten gemessenen Ticks).
7. **Wiederholungsmessung** (Snapshot/Restore, s. o.) in WebKit verändert das JIT-/Cache-Verhalten leicht (gleicher
   Tick mehrfach); „kalt“ ist dort daher nur eingeschränkt kalt. Node/Chromium/Firefox messen jeden Tick einzeln.
8. **Keine Abhängigkeitsänderung**: `wat2wasm` kommt aus dem vorhandenen `wabt`, ESLint/typescript-eslint/Plugin aus
   den Root-Dev-Dependencies; `pnpm-lock.yaml` unverändert.

## Bekannte Grenzen

- Alle Werte lokal auf Apple M5 Pro (headless Playwright-Builds) gemessen, **nicht auf dem Referenz-Laptop**
  (4 P-Kerne, Iris Xe); die Budgets gelten dort, der Abstand hier ist aber groß.
- SPK1 ist ein Wegwerf-Prototyp: flache Ebene ohne Pathing/Terrain-DDA/Schilde/Wracks, eine Waffe pro Einheit,
  Projektile linear (kein ballistisch/homing), Luft ohne Waffen. Er belegt die Durchsatzfrage (TS vs. Rust/WASM),
  nicht das spätere Gameplay.
- WebKit-Phasenzeiten beruhen auf der Wiederholungsmessung (1-ms-Uhr); Einzelausreißer (GC) werden dort gemittelt.
- Node-Kaltläufe enthalten den tsx-Transform der ersten Imports.
