# TRACK-AI · tai-p1-arena-base – Arena-Basis (Loader, Flow-Eco, Turnier-Statistik, Worker-Pool)

Stand: 2026-09-29 · Welle 0 (parallel zu tai-p0-core) · Branch `track-ai`

## Umgesetzt

Neue Module in `tools/ai-arena/src` (bewusst ohne `@faf/ai`-Typen, nur `@faf/formats` und Node-Builtins):

| Ordner | Dateien | Inhalt |
|---|---|---|
| `data/` | `repo.ts`, `maps.ts`, `design.ts`, `index.ts` | Repo-Wurzel, Karten-Loader (`.rtsmap` → `ArenaMap`), rohe Loader für `roster.json` und `ai-openings.json` |
| `eco/` | `flow.ts`, `index.ts` | `FlowEconomy` (PLAN §3.4 Economy-Phase, ecosim.py `Sim`-Eco-Teil) für bis zu 16 Armies |
| `stats/` | `wilson.ts`, `percentile.ts`, `schedule.ts`, `pool.ts`, `pool-worker.ts`, `index.ts` | Wilson/Elo/Schwellen (ai.md §7.1), Perzentile, Paarungsplan und Seiten-Stichprobe (§7.1/§7.3), Worker-Pool |

`tools/ai-arena/src/index.ts` gehört tai-p0 bzw. tai-p2 und wurde nicht angefasst. Folgepakete importieren direkt aus `./data/index.ts`, `./eco/index.ts` und `./stats/index.ts` oder hängen die Re-Exporte in `src/index.ts` ein (tai-p2).

## APIs für Folgepakete

### `data/` (für tai-p2 Arena-Welt, tai-p6 Turnier)

- `repoRoot(): string` – nächstes Verzeichnis mit `pnpm-workspace.yaml` oberhalb des Moduls (gecacht); `repoPath(...segmente)`.
- `ARENA_MAPS = ['setons', 'hollow-ridge', 'tessera', 'braidwater']`, Typ `ArenaMapName`.
- `loadArenaMap(name): ArenaMap` (ungecacht) und `getArenaMap(name)` (gecacht je Prozess/Worker, Ergebnis read-only). Namen nur `[a-z0-9-]` (kein Pfad-Traversal).
- `ArenaMap { name (Datei-ID), displayName, sizeWu, dim (= sizeWu + 1), heights: Uint16Array (Index z·dim + x), heightScaleRaw, waterLevelRaw (Fx raw | null), waterLevelWu, starts: {army, x, z}[] (WU, nach Army sortiert), spots: {index, kind 'mass'|'hydro', x, z}[] (Dateireihenfolge: erst alle Mass-, dann alle Hydro-Spots, wie mapc schreibt), mapClass, heightAt(x, z), waterDepthAt(x, z) }`.
- `heightAt(map, x, z)` bzw. `heightAtGrid(heights, dim, heightScaleRaw, x, z)`: bilinear in WU (Höhe = raw · heightScaleRaw / 4096), außerhalb auf den Rand geklemmt; nur IEEE-exakte Operationen.
- `mapClassOf(name, sizeWu)`: `'setons'` für Setons, sonst nach Größe (≤ 256 → `size256`, ≤ 512 → `size512`, sonst `size1024`). tai-p0 hat in `@faf/ai` eine eigene `mapClassOf`; beide müssen für die vier Arena-Karten dasselbe liefern (hier getestet: Setons → `setons`, die 512er → `size512`).
- `arenaMapFromRtsMap(name, rtsMap)` für synthetische Test-Karten (tai-p2).
- `loadRosterJson(): RosterJson`, `loadOpeningsJson(): OpeningsJson` – roh, nur minimal geprüft (Schema-String, `units[].id/tech/categories`, eindeutige IDs; `roles` als Objekt, `openings[].id` eindeutig). `checkRosterJson`/`checkOpeningsJson` für eigene Quellen. Die Umwandlung in `AiBlueprintTable`/geparste Eröffnungen macht `@faf/ai` (`bpTableFromRoster`, `parseOpenings`).

### `eco/flow.ts` – `FlowEconomy`

Tick-Protokoll (Economy-Phase der Arena-Welt, Welle 1):

```text
eco.beginTick()
  eco.addIncome(army, massPerSec, energyPerSec)      // Mex, Kraftwerke, Vogt; Modifier (AIx, Adjacency) rechnet der Aufrufer ein
  eco.addUpkeep(army, energyPerSec)
  eco.request(army, consumerId, massPerTick, energyPerTick, buildPower?)   // Bedarf bei Ratio 1, je consumerId höchstens einmal pro Tick
eco.resolve()                                        // Einkommen des Ticks, Ratio je Army, Statistik
  r = eco.ratio(army)                                // auch massRatio/energyRatio (r_M, r_E)
  done' = advanceDone(done, rate · r)                // rate = buildRatePerTick(buildTime, BP)
  eco.chargeProgress(army, costMassMilli, costEnergyMilli, done, done')    // kumulative Abrechnung
  // oder eco.chargeGranted(consumerId) / eco.charge(army, mMilli, eMilli) für Verbraucher ohne Fortschritt
eco.endTick()                                        // Speicher klemmen, Overflow, unbezahlter Unterhalt
```

- Startspeicher und Kapazitäten setzt der Aufrufer: `setCapacity`, `addCapacity` (z. B. Speicher fertig/zerstört; wirkt beim Klemmen in `endTick`), `setStored`.
- Lesen: `snapshot(army)` → `{massIncome, energyIncome, energyUpkeep, massStored, energyStored, massCapacity, energyCapacity, massRatio, energyRatio, ratio, massDemand, energyDemand}` (Raten pro Sekunde, Vorräte in Einheiten) – passt feldweise auf `EcoState` aus `@faf/ai` für den Perception-Writer. Dazu `massStoredMilli` usw.
- Statistik je Army: `statsOf(army)` (Ticks, Energie-Stall-Ticks, Energie-Bedarfs-Ticks, Ausnahme-Ticks, Mass-Stall-Ticks, BP·s gesamt und durch Mass-Mangel ungenutzt, Einkommen, Unterhalt, unbezahlter Unterhalt, Verbrauch, Overflow Mass/Energie, Fehlbetrag) und `reportOf(army)` bzw. `ecoReport(stats)` → `{energyStallPct, massBpStallPct, overflowPct, avgMassIncome}` mit denselben Definitionen wie ecosim (`stallE`, `stallMbp`, `overflowM`).
- `exemptEnergyStallUntil(army, tick)`: Ticks bis einschließlich `tick` zählen nicht zum Energie-Stall (ai.md §7.1: 60 s nach Verlust eines Kraftwerks/Speichers); `energyStallPct` rechnet dann über die übrigen Ticks.
- Hilfen: `toMilli`, `fromMilli`, `advanceDone`, `cumulativeCharge`, `buildRatePerTick`, Konstanten `ECO_TICK_HZ = 10`, `ECO_DT = 0.1`, `MILLI`, `MICRO`, `ECO_MAX_ARMIES = 16`, `DONE_EPSILON = 1e-9`.

### `stats/` (für tai-p6 Turnier)

- `wilson(successes, n, z = 1.96) → {p, lo, hi}` (Remis = 0,5 Erfolg; `successes` darf Vielfaches von 0,5 sein), `wilsonOf({wins, draws, losses})`, `successesOf`, `passesGate(tally, gate)`.
- `eloDiff(p) = 400 · log10(p / (1 − p))`, p auf [0,001; 0,999] geklemmt (reine Berichtszahl; `Math.log10` nur hier, Allowlist des Determinismus-Guards).
- `successesNeeded(n, gate) → number | null` (kleinste Erfolgszahl mit unterer Wilson-Grenze ≥ Gate; Binärsuche, `null` wenn unerreichbar).
- `percentile(values, pct)` / `percentiles(values, pcts)`: Nearest-Rank. **pct in Prozent (0–100)**, Rang = ⌈pct · N / 100⌉ auf [1, N] geklemmt, Ergebnis ist immer ein Eingabewert (keine Interpolation); stabile Sortierung mit totalem Comparator, NaN wird abgelehnt. `mean(values)` summiert von links nach rechts.
- `pairingSchedule({seeds, maps, swap = true}) → Pairing[]` mit `{game, seed, map, mapIndex, swapped, armyA, armyB}`; Seed s spielt `maps[s mod k]`, je Seed erst ungetauscht (A = Army 0), direkt danach getauscht. `seedRange(from, to)`, `mapIndexOfSeed(seed, k)`.
- `sampleSide(seed) → 0 | 1` (Army mit der Parität des Seeds), `sampledContestant(pairing) → 'A' | 'B'` (welcher Teilnehmer im Spiegel-Turnier gezählt wird; über einen getauschten Plan genau einmal je Seed A und einmal B).
- `runPool(jobs, workerModuleUrl, {workers ≤ 4, workerData?, execArgv?, onResult?}) → Promise<{results, workersSpawned, workersExited}>`:
  - Worker-Modul ruft `serveJobs(handler)` aus `stats/pool-worker.ts` (Handler sync oder async, Kontext `{workerData, threadId}`).
  - `results[i]` gehört zu `jobs[i]`: `{ok: true, index, value}` oder `{ok: false, index, error}`; Handler-Exception/-Rejection und Worker-Absturz (Exit, ungefangener Fehler, OOM) treffen nur den betroffenen Job; ein abgestürzter Worker wird ersetzt, solange noch Jobs offen sind.
  - Worker ohne weitere Arbeit werden sofort beendet; `runPool` löst erst auf, wenn alle Worker beendet sind (`workersExited === workersSpawned`).
  - `workers` > 4 oder < 1 ⇒ `RangeError` (Speicherregel). Standard: min(4, Jobanzahl).
  - Kein Timeout je Job (Timer sind außerhalb von `bench/**` verboten); hängende Jobs muss das Turnier-Skript selbst begrenzen (z. B. Tick-Limit im Match).

## Entscheidungen und Abweichungen

1. **Kumulative Abrechnung in Milli-Einheiten-Ganzzahlen.** Vorräte, Bedarf und Abbuchungen sind Ganzzahlen in 1/1000 Einheit (in `Float64Array`, exakt bis 2^53). Ein Verbraucher bucht `floor(cost · doneNew) − floor(cost · doneOld)`; die Summe teleskopiert, sobald `done` exakt 1 erreicht (`advanceDone` rastet ab 1 − 1e-9 auf 1 ein, wie ecosim). Damit ist die Summe über einen Bau **ohne Schluss-Korrektur** exakt die Kosten (Property-Test über zufällige Kosten, BP, Bauzeiten und Einkommen). Die Float-Variante „consumed = cost·doneNew − cost·doneOld mit Schluss-Korrektur“ wurde verworfen, weil `a + (c − a)` in IEEE nicht in jedem Fall exakt `c` ergibt.
2. **Reserve von 1 Milli je aktivem Verbraucher.** `floor`-Differenzen können `cost · Δdone` um < 1 Milli übersteigen. Die Ratio rechnet deshalb gegen `verfügbar − Anzahl Verbraucher` (in Milli), so dass Abbuchungen den Vorrat nie übersteigen (`shortfall*Milli` bleibt 0, getestet). Wirkung: ≤ 0,01 Einheiten/s je Verbraucher, nur im Grenzfall.
3. **Einkommen/Unterhalt als Mikro-Einheiten-Raten mit Ganzzahl-Übertrag.** `addIncome` rundet auf 1e-6 Einheit/s; die Umrechnung in Milli pro Tick trägt den Rest als Ganzzahl weiter (keine Drift, keine Float-Summenreihenfolge). Beispiel: 0,3623 M/s über 1.000 Ticks ergibt exakt 36,23 M.
4. **Bedarf wird auf Milli aufgerundet**, danach nur noch ganzzahlig summiert ⇒ Ratio, Zuteilungen und Endvorräte hängen nicht von der Reihenfolge der `request`-Aufrufe ab (fast-check, 300 Fälle, bis 24 Verbraucher auf 4 Armies).
5. **Unterhalt vor Verbrauch.** Unterhalt wird aus Vorrat + Einkommen bezahlt; was nicht gedeckt ist, zählt als `upkeepUnpaidMilli` (kein negativer Vorrat). Verfügbare Energie für die Ratio = Vorrat + Einkommen − Unterhalt; ist sie ≤ 0, ist r = 0.
6. **Stall-Zählung** exakt bei `energyRatio < 1` (ecosim: `< 0,999`) und nur bei Energiebedarf > 0. Die ecosim-Quote `stallE / ticks` bleibt die Berichtsgröße; zusätzlich `energyDemandTicks` für eine Quote nur über Ticks mit Bedarf.
7. **Build-Power-Statistik** kommt aus dem optionalen `buildPower`-Argument von `request` (wie `bp_now` in ecosim); Mass-bedingt ungenutzte BP zählt, wenn `r_M ≤ r_E` und `r_M < 1`.
8. **Perzentil-Argument in Prozent** (statt Anteil 0–1), damit der Rang für ganzzahlige Perzentile exakt berechnet wird (`0,95 · 20` wäre in Float nicht garantiert 19).
9. **tsx im Worker** wird über `createRequire(import.meta.url).resolve('tsx')` als absolute URL an `--import` übergeben (Fallback: nacktes `'tsx'`). Damit funktioniert der Pool unabhängig vom Arbeitsverzeichnis; semantisch identisch zu `execArgv ['--import', 'tsx']`.
10. **Rückgabe von `runPool`** ist `{results, workersSpawned, workersExited}` statt eines nackten Arrays, damit Turnier-Skripte und Tests das saubere Beenden prüfen können.

## Tests

`tools/ai-arena/test/{data,eco,stats}` (70 Tests, gesamt < 0,5 s) plus Fixture `test/fixtures/pool-worker.ts`:

- `data/maps.test.ts`: alle 4 Karten laden (1024/512/512/512, `dim`, Höhenfeld, Wasserspiegel, Kartenklasse); Starts und Spots (Reihenfolge Mass → Hydro, Koordinaten nach mapc-Rundung) gleich `content/maps/src/<name>/markers.json`; Setons 8 Starts/108 Mass/8 Hydro; `heightAt` auf Gitterpunkten exakt, bilinear zwischen Punkten, Klemmung am Rand; alle Starts auf trockenem Land; Namensprüfung; Cache; Roster/Openings-Loader inkl. Fehlerfällen.
- `eco/flow.test.ts`: Mass-limitiert (r = (200 − 1)/1000), Energie-limitiert, Unterhalt treibt Energie ins Minus ⇒ r = 0 und unbezahlter Unterhalt, Unterhalt teilweise ⇒ 0 < r < 1, Stall-Ausnahmefenster, Overflow bei vollem Speicher (Mass und Energie), Kapazitätsänderung im Tick, Reihenfolge-Unabhängigkeit (fast-check), Kostensumme exakt (Einzelfall Glutkessel 75 M/750 E unter Mass-Stall und Property über 60 Fälle mit bis zu 5 parallelen Bauten), Einkommens-Übertrag exakt, Determinismus (3.000 Ticks, 3 Armies, zweimal identische Spur), Snapshot-Einheiten, Protokollfehler.
- `stats/stats.test.ts`: Wilson-Referenzwerte, Symmetrie (fast-check), Remis = 0,5; `successesNeeded` gegen ai.md §7.1 (n = 200: 55 % → 124, 60 → 134, 65 → 144, 70 → 153, 75 → 163, 80 → 172, 90 → 189) inkl. Gegenprobe mit s − 1; n = 400 senkt die nötige Quote um 1,5–2,25 Punkte (ai.md: „≈ 2 Punkte“); Elo (0 bei 50 %, Antisymmetrie, Klammer ±1.199,8); Perzentil nach Nearest-Rank (Lehrbuchbeispiel, p95 von 1…20 = 19, Reihenfolge-Unabhängigkeit); Paarungen Seeds 1–105 × 3 Karten × getauschte Armies = 210 Spiele, je Karte 70, je Seed direkt hintereinander ungetauscht/getauscht; Seiten-Stichprobe nach Parität, je Seed genau einmal A und einmal B.
- `stats/pool.test.ts`: 4 Worker, 20 Jobs, ein absichtlicher Crash (`process.exit(3)` im Worker), eine Exception, eine Rejection ⇒ genau diese drei Jobs `{ok: false}`, übrige Ergebnisse korrekt und nach Job-Index geordnet, ≥ 4 verschiedene Threads, `workersExited === workersSpawned`; Ersatz-Worker nach Crash (1 Worker, 2 Crashes ⇒ 3 Worker); nicht ladbares Worker-Modul ⇒ alle Jobs Fehler, alle Worker beendet; leere Jobliste; Worker-Limit.

ai.md-Test-IDs: keine direkt (Infrastruktur). Die Paketteile sind Voraussetzungen für `AI-TECH-01` (T2-Gate-Statistik), `AI-ENG-01` (H-Läufe mit Wilson-Grenze) und die Energie-Stall-Metrik aus §7.1 (MS10-Gate).

Selbsttest (über das Heavy-Gate):

- `tools/heavy pnpm exec vitest run tools/ai-arena/test/data tools/ai-arena/test/eco tools/ai-arena/test/stats` → 4 Dateien, 70 Tests grün, 0,47 s.
- `tools/heavy pnpm exec tsc -b tools/ai-arena` → grün (mit dem zu dem Zeitpunkt vorhandenen Stand von `packages/ai`).
- Testdateien zusätzlich mit strikter Test-Konfiguration typgeprüft; `eslint` über alle eigenen Pfade ohne Befund.

## Messwerte

- Kartenladen: alle vier Karten < 30 ms zusammen (Setons 1.025² Höhenwerte).
- Flow-Eco: 3.000 Ticks × 3 Armies mit je 1–4 Verbrauchern ≈ 9 ms (≈ 1 µs je Army-Tick).
- Worker-Pool: Start von 4 tsx-Workern plus 20 Jobs ≈ 0,1–0,3 s.

## Bekannte Grenzen

- Nur ein Prioritäts-Tier (wie ecosim und PLAN-MVP); Prioritäten/Pausen (E13, MS10) fehlen.
- Keine Adjacency, kein AIx: Modifier rechnet der Aufrufer in die Raten von `addIncome` ein.
- Mass-Speicher wird nicht getrennt nach Quelle geführt; Reclaim-Einnahmen gehen wie Einkommen über `addIncome` (oder `setStored`).
- Der Pool hat keine Job-Timeouts (Timer-Verbot außerhalb `bench/**`); ein hängender Job blockiert seinen Worker.
- `getArenaMap` teilt das Höhenfeld zwischen Aufrufern; Mutation wäre ein Fehler des Aufrufers (nicht erzwungen).
- `mapClassOf` existiert doppelt (hier neutral, in `@faf/ai` für die Eröffnungsauswahl); bei neuen Kartengrößen beide prüfen.
