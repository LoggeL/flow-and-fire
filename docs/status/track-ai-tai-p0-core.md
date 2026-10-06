# TRACK-AI · tai-p0-core – @faf/ai Kern (Welle 0)

Stand: 2026-09-29 · Branch `track-ai` · Vorarbeits-Track (kein PLAN-Meilenstein, keine echte Sim).

## Umgesetzt

- **Paket-Scaffolds:** `packages/ai` (`@faf/ai`, Exports `.`, `./testing`, `./host` – `host/` legt tai-p6 an) und
  `tools/ai-arena` (`@faf/ai-arena`: `package.json`, `tsconfig.json`, `src/index.ts` mit `ARENA_SCHEMA = 'faf-ai-arena/1'`).
  Root-`tsconfig.json` nur um die zwei References erweitert, `pnpm install` einmal ausgeführt (Lockfile +53 Zeilen,
  nur Workspace-Links, keine neuen npm-Pakete). `packages/ai/src` kennt weder DOM noch Node (`lib ES2022`, `types []`).
  dep-cruiser-Regel `ai-deps` geprüft (unverändert, grün).
- **Verträge und Kern** in `packages/ai/src` im verbindlichen Layout: `types.ts`, `index.ts`, `brain.ts`,
  `blackboard.ts`, `taskboard.ts`, `budget.ts`, `rng.ts`, `det.ts`, `profile.ts`, `source.ts`, `threat.ts`,
  `openings.ts`, Ordner `data/`, `analysis/`, `perception/`, `commands/`, `testing/`.
- **Test-Fixtures** `packages/ai/test/support/fixtures.ts` (Node, nur Tests) und 94 Tests (Laufzeit ≈ 0,5 s).

## API-Übersicht für die Folgepakete

Alles über `import … from '@faf/ai'` (Testhilfen zusätzlich `@faf/ai/testing`). Koordinaten sind Float-WU.

### Verträge (`types.ts`)
| Name | Inhalt |
|---|---|
| `Vec2`, `Spot {index, kind, x, z}`, `MapClass`, `AiMapMeta` | Grundtypen |
| `AiBlueprint` | `index` (= Position in der nach `id` sortierten Tabelle = provisorische Sim-bp-ID), `id`, `name` (nur Debug), `tech`, `categories` (Maske), `categoryNames`, Kosten/Raten/Speicher, `hp`, `shieldHp`, `hpEff`, `speed`, `footprint [w, d]`, `isStructure`, `layer`, `vision`, `radar`, `dpsSurface`, `dpsAir`, `threatSurface`, `threatAir`, `rangeMax`, `rangeMin`, `splash`, `upgradesTo`/`upgradeFrom` (Index oder −1), `buildableBy` (kompiliert oder null), `msFirst` |
| `AiBlueprintTable` | `list`, `registry`, `byId(id)`, `canBuild(builder, target)`, `matches(bp, expr)`, `compile(src)` (gecacht) |
| `AiStatic` | `army`, `gameSeed`, `map`, `spots`, `passLowRes` (Uint8Array, 2-WU-Zellen, `passDim` = sizeWu/2), `passCellWu` = 2, `heightLowRes` (Float64Array, Zellmitte in WU), `components` (Int32Array, −1 = unpassierbar), `sectors: null`, `bps`, `starts`, `armyStart` (Länge 16, −1 = inaktiv), `activeArmies` |
| `EcoState` | `massIncome, energyIncome, energyUpkeep, massStored, energyStored, massCapacity, energyCapacity, massRatio, energyRatio, massDemand, energyDemand` |
| `OrderKind` | Idle 0, Move 1, AttackMove 2, Attack 3, Build 4, Assist 5, Guard 6, Repair 7, Reclaim 8, Upgrade 9, Patrol 10, Overcharge 11 |
| `OwnUnit` | `handle, bp, x, z, hpFrac, buildFrac, complete, order, orderTarget, orderBp, orderX, orderZ, queueLength, factoryBp, factoryProgress, factoryRepeat, upgradingTo, lastDamagedTick` (Ergänzung `orderBp`: bp eines Build/Upgrade-Auftrags; `orderTarget` bei Build = Handle der Baustelle, 0 vorher) |
| `KnownUnit` | `id, army, kind ('visible'\|'ghost'\|'blip'), bp (−1 = Blip), x, z, hpFrac (nur visible, sonst 1), lastSeenTick` |
| `PerceptionEvent` | `ownDamaged {tick, unit, attacker, attackerBp, amount}`, `ownDestroyed {tick, unit, bp}`, `ownCompleted {tick, unit, bp}`, `enemySighted {tick, id, army, bp}`, `enemyDestroyed {tick, id, army, bp}`, `commandRejected {tick, seq, reason, unit}`; `REJECT_REASONS` (`other, malformed, unknownOp, invalidUnit, notOwner, notBuildable, placement, noTarget, unitCap, noEnergy`) |
| `PerceptionView` | `tick, army, ownCount, knownEnemyCount, eco(), forEachOwn(filter, fn), forEachKnownEnemy(filter, fn), freeMassSpots(), freeHydroSpots(), canPlace(bp, x, z, rot), forEachEvent(fn)`. Callback-Objekte sind Flyweights: nicht speichern. Blips passen nur auf `filter = null`. `freeMassSpots/canPlace` kennen **nur bekannte Belegung** (R-08). |

### Daten und Karte
- `bpTableFromRoster(json, extraCategoryNames?)` – validierend aus `roster.json`; Waffen mit Notiz „Nicht in DPS/Mass
  gewertet“ (Abstich) zählen nicht; `land`-Layer → Boden-DPS, `air` → Luft-DPS; Registry enthält auch Namen aus
  `buildableBy` (Pseudo-Kategorie `UPGRADE`).
- `computePassLowRes(heightInput, {maxSlope, maxWaterDepthWu, cellWu})`, `computePassSamples`, `heightLowRes`,
  `labelComponents(pass, dim) → {labels, count}` – exakte Portierung von `ecosim.py analyze_map`.
- `createAiStatic({name, sizeWu, dim, heights, heightScaleRaw, waterLevelRaw, spots, starts, coords: 'fxRaw'|'wu', army, gameSeed, activeArmies?, bps, pass?, mapClass?})`
  – für die Arena (`buildArenaStatic`) gedacht; `staticForArmy(s, army, seed)` teilt die Raster.
- `analyzeMap(static, openingsDoc) → MapAnalysis`: `dOwn`/`dEnemy` (Float64Array je Zelle), `spots[]`
  (`SpotInfo {spot, index, kind, x, z, cell, dOwn, dEnemy, q, zone}`), `mexOrder`, `hydroOrder` (own + contested,
  nach d_own/Index), `ringSpots` (d_own ≤ 40), `pathToEnemy` (Zellen), `pathLengthWu`, `euclidToEnemy`, `rally`,
  `rallyToEnemyWu`, `staging` (q = 0,40 auf dem Pfad), `chokepoint {x, z, widthWu, q}`, `forward`/`side` (Achsen f/s),
  `slots` (rotierte baseTemplate-Slots in Weltkoordinaten), `detour`, `initOps`, `enemyArmy`, `ownStart`,
  `enemyStart`; Methoden `toWorld(f, s)`, `cellAt`, `dOwnAt`, `dEnemyAt`, `zoneAt`, `ecoRingSlot(k)` (Formel aus
  ecosim, Winkel über die LUTs von @faf/fixed), `factorySlot(n)` (fac4… im 13-WU-Raster hinter der Basis).
  Hilfen: `gridDijkstra`, `nearestPassableCell` (= ecosim `node()`), `cellCenter`.

### Eröffnungen (`openings.ts`)
- `parseOpenings(json) → OpeningsDoc` (streng: unbekanntes `do`, unbekannte Schlüssel, unbekannte Rollen/Selektoren,
  fehlende Felder ⇒ Fehler; `note` ist überall erlaubt). `OpeningsDoc.roleNames`, `baseTemplate.slotNames`,
  `Opening.factoryOrder` halten die Dokumentreihenfolge. `followUp.techT2.t2Engineers` hat Default 2.
- `expandSteps(steps)` (count → Einzelschritte), `referencedRoles(doc)`.
- `resolveRole(role, tech, table, roles)` (Rollen-Ausdruck ∧ `TECH<n>`, Upgrade-Stufen nur als Rückfall, genau ein
  Treffer, sonst Fehler) und `RoleTable` (`resolve`, `tryResolve`, `expr(role)`, `isRole(bp, role)`,
  `bestFor(role, minTech, builder)` = Loop-Semantik „höchste baubare Stufe“).
- `buildRangeOf(bp, doc, table)` (assumptions.buildRangeWu), `mapClassOf(name, sizeWu)`,
  `openingWeights(doc, mapClass, difficulty, {maxMs, allow})`, `selectOpening(doc, mapClass, difficulty, rng, {maxMs = 11, allow})`.

### Threat (`threat.ts`)
`threatOf(bp, hpFrac, layer)`, `ownAcuFactor(S_E)`, `enemyAcuFactor(estoreSeen, tick)` (×1,5 ab Glutspeicher gesehen
oder Tick 3.000), `blipThreatTable(table)` / `blipThreat(table, highestSeenTech)`, `ownUnitThreat`,
`enemyUnitThreat`, `sumThreatInRadius`, `localStrength(own, enemies, x, z, r, ctx) → {own, enemy, ratio}`,
`strengthRadius(table, bps)` (= größte Reichweite + 20 WU). `StrengthContext` enthält nur explizite, sichtbare Eingaben.

### Budget, RNG, Determinismus, Profile
- `OpBudget {take(n), left, used}` (take = alles oder nichts), `FixedBudget` (+ `charge(n)` für Pflichtarbeit),
  `OP_COST {unit 1, cell 1, node 1, command 10}`, `canPlaceCost(w, d) = 4 + ⌈w·d/4⌉`,
  `ThinkBudget(spec, scale)` mit `open(key)`/`close()` (Rest fällt an die Reserve desselben Thinks), `reserve`,
  `chargeIngest`, `opsByKey()`, `usedTotal`; `BudgetKey`.
- `Xorshift32 {nextU32, nextFloat, nextInt, chance}`, `aiBaseSeed(gameSeed, army)` = `rng32(gameSeed, 0, army, 0x41490000)`,
  `managerRng(gameSeed, army, saltOrName)`.
- `DECAY_LUT` (0,95^s, s = 0…600, per Multiplikation), `decayFactor(s)`, `compareNumbers`, `compareStrings`,
  `byKeyThenId`, `dist`, `distSq`, `toFxRaw` (Bereichsprüfung), `fromFxRaw`, `clamp`, `hashString`.
- `PROFILES` (easy/normal/hard, Werte ai.md §2.1/§2.3/§2.4/§6), `profileFor(difficulty, openingsDoc)` mischt
  `difficultyTiming` ein (`AiProfile.timing`), `horizonFor(profile, openingHorizon)`, `firstWaveFor(profile, first)`.
  Felder: `thinkEvery, microEvery, lead, reactionDelayTicks, oneHzEveryThink, budget, apm {cap, burst, p0Overdraft},
  errorRate, errorTopK, horizonS, attackRatio, retreatRatio, reentryRatio, reentryHpFrac, raids {count, fromS},
  counterMode, openingFilter, firstWave, threatVisibleOnly, micro, platoonGridMode, timing`.

### Perception (`perception/`)
- Snapshot-Layout v1 (`layout.ts`, little-endian): Kopf 120 B (Magic `AIPS`, Version, Army, Tick, Zähler, 11 × f64
  Eco), eigene Einheiten 80 B, bekannte Feinde 40 B, Events 32 B; Reihenfolge = Einfügereihenfolge des Erzeugers
  (Slot-Reihenfolge).
- `PerceptionWriter`: `begin(tick, army)`, `setEco`, `addOwn`, `addKnown`, `addEvent`, `finish()` (View in den
  wiederverwendbaren Puffer; `slice()` zum Behalten/Transfer). Keine Allokation je Einheit.
- `SnapshotPerception(static, bytes?)` implementiert `PerceptionView`; zusätzlich `reset(bytes)`, `ownAt(i, out?)`,
  `knownAt(i, out?)`, `knownStructures()`, `snapshot`. `MutableOwnUnit`/`MutableKnownUnit` als wiederverwendbare
  Scratch-Objekte für Erzeuger. `readSnapshotHeader(bytes)`.
- `canPlaceKnown(ctx, known, bp, x, z, rot)`, `placementContext(static)`, `freeSpotsKnown`, `spotOccupiedKnown`,
  `extractorFootprint`, `footprintOf` – provisorischer Ersatz für `rules.canPlace` (Regeln siehe unten).

### Commands (`commands/`)
- Provisorische Payloads (`AI_PAYLOAD_VERSION = 1`, nur vorhandene `Op`s): Position (Move/AttackMove/Patrol/SetRally
  = protocol-Move-Layout, y = 0), Build `{u16 bp, i32 x, i32 z, u8 rot}`, Target `{u32}` (Attack/Assist/Guard/Repair/
  Reclaim/Overcharge), FactoryQueue `{u16 bp, u16 count}`, FactoryRepeat `{u8 on, u8 n, u16[n]}`, Upgrade `{u16 bp}`,
  Stop leer. `encode*`/`decode*`, `decodeAiPayload(op, payload)` (diskriminierte Union), `isAiOp`. `CmdFlags.Queue`
  = anhängen (Shift), sonst ersetzen; FactoryRepeat `on = 0` löscht die Schleife.
- `CommandEmitter({army, apm, lead, firstSeq?})`: `beginThink(tick, lookup)`, `emit(req)`, `group(fn)` (alles oder
  nichts), Komfort `move/attackMove/patrol/setRally/build/attack/assist/guard/repair/reclaim/overcharge/factoryQueue/
  factoryRepeat/upgrade/stop(…, prio, {queue, source})`, `mark()/rollback(mark)`, `forget(handle)`,
  `flush(budget) → {commands, dropped}`; `Prio P0…P4`, `EncodedCommand = CommandEnvelope`, `encodeCommands(cmds)` =
  protocol `encodeBatch`. `DroppedCommand.reason`: `apm | dedup | budget | aborted`.

### Blackboard und Task-Board
- `Blackboard`: `tick, k, thinks, static, profile, blipTable, units (UnitsSection: all, byHandle, engineers,
  factories, army, structures, sites, commander), enemy (EnemyMemory), stimuli, taskBoard, reservations, eco (EcoPlan),
  threat (ThreatQuery), engineerTarget, productionRequests, huntRequests (RequestList), platoons (PlatoonInfo[]), tech,
  opening, defense, telemetry`; Hilfen `secondsSince`, `timeS`, `decaySince`. Eigentümer je Abschnitt stehen im
  Modulkopf von `blackboard.ts`.
- `EnemyMemory`: `contacts` (Map in Erstsichtungs-Reihenfolge), `current` (reagierbare Kontakte der aktuellen
  Perception), `structures`, `highestTechSeen`, `estoreSeen`, `landFactories`, `t2LandFactorySeen`,
  `categoryShare(pred)` / `categoryCount(pred)` / `forEachWindow` (180-s-Fenster, Threat-gewichtet, Blips =
  „unbekannt Boden“).
- `Stimuli`: `forEachVisible(since, now, fn)` (eigener Cursor je Manager), `forEachActive`, Aufbewahrung 600 Ticks.
- `Reservations`: Spots/Sites (`reserveSpot/releaseSpot(lockUntil)/lockSpot/isSpotAvailable/…`), Units
  (`claimUnit/releaseUnit/unitOwner`), Vogt-Steuerung `acuOwner`, `claimAcu`, `releaseAcu`, `handoverAcu`.
  **Übergaberegel:** genau ein Manager steuert den Vogt; anfangs `opening`, nach dem Handoff `engineer`; der
  PlatoonManager darf ihn jederzeit für lokale Abwehr, Rückzug, Burst-Rückzug oder Abstich übernehmen; solange er ihn
  hält, geben Bau-Manager ihm keine Aufträge (die Eröffnung pausiert, wird nicht verworfen); Freigabe nach 15 s ohne
  feindliche Kampfeinheit im Basisradius zurück an den Vorbesitzer.
- `EcoPlan` (`reservedE`, `decayOneSecond()` ×0,9, `sinks`, `sinkMass`, `energyEmptyInS`, `deficitE`, `emergency`),
  `ThreatQuery.threatAt(layer 'surface'|'air'|'antiair', x, z)` mit Standard `LocalThreatEstimate` (reagierbare
  Kontakte in 40 WU), `Telemetry` (`push`, `first`, `count`; Ereignisse `openingSelected, handoff, defenseMode,
  techStart, techDone, waveAttack {tick, x, z, enemyHalf, units, forced}, retreat, mexUpgradeStart,
  scoutSeenEnemyBase, aiTimeout`).
- `TaskBoard`: `add(spec, tick)` (mit `key`-Dedup), `get`, `byKey`, `ordered()` (Prio ↓, createdTick ↑, id ↑),
  `forEach`, `filter`, `assign`, `release(handle)`, `tasksOf`, `complete/fail/cancel`, `prune`; `Task` mit `id, kind,
  role, tech, bp, site (Selektor oder Vec2), target, prio, wanted, assigned, createdTick, source, state, key, spot,
  failures, siteHandle`; `TaskPrio` mit den Prioritäten aus ai.md §5.3.

### Brain und CommandSource
- `ManagerName`, `MANAGER_ORDER` (intel, opening, economy, tech, defense, factory, engineer, platoon, micro),
  `MANAGER_SLOT`, `MANAGER_BUDGET_KEY` (opening → reserve), `runsOnThink(name, k, profile)`.
- `Manager {name, budgetKey, think(ctx)}`, `ManagerFactory {name, create(init)}`, `defineManager(name, create, key?)`.
- `ManagerContext`: `tick, k, view, static, analysis, bb, budget, rng (eigener Strom), emitter, profile, openings,
  opening (gewählte Eröffnung), roles (RoleTable), shouldAbort(), step(work)`.
  **Commit-Semantik:** `step(() => { …Commands…; return () => commitState(); })` – bei Abbruch während des Schritts
  werden seine Commands verworfen und der Commit nicht ausgeführt; danach läuft kein weiterer Manager.
- `createBrain({managers})` → `AiBrain {init(static, profile, {openings, gameSeed?, openingId?, maxMs?}), think(view,
  {budgetScale?, shouldAbort?}) → ThinkResult, initialized, blackboard, analysis, opening, profile, static,
  managerNames}`. `ThinkResult {tick, commands, aborted, opsByManager (+ emitter), opsTotal (ohne Ingest), ingestOps,
  dropped}`. `openingId` erzwingt eine Eröffnung (Szenarien AI-OPEN-01/02).
- `ingestPerception`, `classifyBlueprints` (von `think` benutzt; exportiert für Tests).
- `AiCommandSource({brain, perceive, thinkEvery?, lead?, thinkOptions?, onThink?})` – synchron; denkt beim Aufruf
  `commandsFor(N)` mit N ≡ 0 (mod thinkEvery) über `perceive(N)` und liefert bei N + lead.
- `PendingAiSource({thinkEvery, lead, request})` – `commandsFor(t)` ruft `request(N)` genau einmal je Think-Tick,
  liefert `'pending'`, solange ein Think mit N + lead ≤ t fehlt; `deliver(N, cmds)`; `pendingCount`,
  `outstandingThinks`. Basis für `AsyncAiSource` (tai-p6).

### Testhilfen
- `@faf/ai/testing`: `flatStatic({bps, sizeWu, army, gameSeed, starts, activeArmies, spots, name, mapClass, blocked, height})`,
  `fakeAnalysis(static, doc, overrides)`, `FakeWorld` (`addOwn(bpId, x, z, opts)`, `own(h)`, `ownHandles`,
  `removeOwn(h, destroyed)`, `addEnemy(bpId | null, x, z, opts)`, `enemy(id)`, `removeEnemy(id, destroyed)`,
  `event(e)`, `setEco`, `advance`, `snapshot()`, `perceive()`, `applyOrders(cmds)` – spiegelt Aufträge in die
  Perception, ohne zu simulieren), `runThinks(brain, world, n, {apply, thinkOptions, before})`, `defineManager`.
- `packages/ai/test/support/fixtures.ts`: `repoRoot`, `loadRosterJson`, `loadOpeningsJson`, `loadRoster`,
  `loadOpenings`, `loadRoles`, `loadMap(name)`, `loadStatic(name, army, gameSeed, activeArmies = [0, 1])`,
  `loadAnalysis(name, army)`, `ARENA_MAP_NAMES`.

## Tests (packages/ai/test, 94 Tests, ≈ 0,5 s)

| Datei | Inhalt / ai.md-Test-IDs |
|---|---|
| `roster.test.ts` | Roster-Adapter, Threat-Tabelle §5.6 (±1), Vogt-Faktoren (R-07/AI-PERC-03-Unit-Teil), Blip-Median, R = 0,7 bei 7:10 und 0,64 bei 7:11 (AI-PLT-01-Grundlage) |
| `openings.test.ts` | strenger Parser, jedes (Rolle, Tech)-Paar eindeutig, `bestFor`, Baureichweiten, Auswahl §4.4 (vor MS12 Hard 44,9/23,1/32,1 bzw. 45,2/38,7/16,1 %, ab MS12 die §4.4-Tabelle, ±0,1 pp) |
| `analysis.test.ts` | Passierbarkeit (np.gradient-Semantik, Wasser), Komponenten, Dijkstra ohne Eckenschneiden, Kartenzahlen §3 |
| `budget-rng-profile.test.ts` | Kostenformeln, Split/Reserve/kein Übertrag/Skalierung, xorshift32-Referenzvektor, unabhängige Manager-Ströme, LUT, Profile |
| `commands.test.ts` | Payload-Roundtrips (fast-check), Emitter: Stempel N + lead, seq-Umlauf ohne 0, Prioritäten, Gruppen, Burst, P0-Überziehung, APM über 10 min in jedem 60-s-Fenster ≤ Cap (alle Stufen), Dedup, Budget, Rollback |
| `perception.test.ts` | Snapshot-Roundtrip + Byte-Determinismus, Filter, Fehlerfälle, `canPlaceKnown`, AI-PERC-02 (Unit-Teil) |
| `brain.test.ts` | Scheduling (Reihenfolge, gerade/ungerade k, Easy jeder Think), Eröffnungswahl, Ingest mit Reaktionsverzögerung, AI-DET-04 (Unit-Teil: Abbruch übernimmt nur abgeschlossene Schritte), Budget-Skalierung (AI-DET-02-Grundlage), AiCommandSource (thinkEvery 5/10, lead 3) und PendingAiSource (AI-DET-03-Unit-Teil) |
| `blackboard.test.ts` | Task-Board-Ordnung, Reservierungen, Vogt-Übergabe, Stimuli-Cursor, R_E-Verfall, EnemyMemory (180-s-Fenster, Glutspeicher/Landwerk/Tech ohne Fog-Wissen), Dedup über Thinks |
| `determinism-guard.test.ts` | scannt `packages/ai/src/**` und `tools/ai-arena/src/**` (Allowlist: Wall-Clock nur `packages/ai/src/host/clock.ts` und `tools/ai-arena/src/bench/**`, `Math.log10` nur `tools/ai-arena/src/stats/**`), Selbsttest des Scanners |

Selbsttest: `pnpm exec vitest run packages/ai` grün; `heavy pnpm exec tsc -b packages/ai tools/ai-arena` grün;
`heavy pnpm typecheck` grün; dep-cruiser grün (465 Module). `pnpm lint` (ESLint) meldet 89 Fehler ausschließlich in
`docs/design/ui-mockups/**` (Browser-Skripte aus dem Design-Merge `43d763e`, außerhalb der owns und nur lesbar) –
`packages/ai` und `tools/ai-arena` sind ESLint-sauber. Das muss auf dem Hauptzweig bereinigt werden (Ignore-Eintrag
oder Browser-Globals für `docs/design/ui-mockups`), sonst bleibt `pnpm lint` für alle Tracks rot.

## Messwerte

Kartenanalyse Army 0 (Node, M5 Pro; Zeiten einmalig gemessen, Init-ops gezählt):

| Karte | Mass own/cont./enemy/unreach. | Hydro own/cont./enemy | Pfad Start→Gegner | Luftlinie | Rally→Gegner | Ring d_own | Engstelle | Init-ops | Zeit |
|---|---|---|---|---|---|---|---|---|---|
| Setons (ai.md: 48/2/48/10, 463, 418) | 48/2/48/10 | 4/0/4 | 462,9 WU | 458,3 | 417,6 WU | 16,0 | 77 WU bei (503 \| 521) | 208.722 | ≈ 50 ms |
| Hollow Ridge (ai.md: 6/4/6/0, 570, 525) | 6/4/6/0 | 1/0/1 | 569,5 WU | 452,5 | 523,8 WU | 21,7–22,1 | 11 WU (Kamm-Durchlass) | 126.924 | ≈ 15 ms |
| Tessera | 12/10/12/0 | 1/2/1 | 418,6 WU | 418,6 | 373,4 WU | 16,0 | 158 WU | 131.554 | ≈ 20 ms |
| Braidwater | 17/2/17/0 | 2/1/2 | 429,7 WU | 380,0 | 384,5 WU | 16,0 | 18 WU | 108.120 | ≈ 20 ms |

Die Mex-Reihenfolge (Setons Rang 1–8, Hollow Ridge inkl. der umkämpften Spots) stimmt mit ai.md §3 überein; alle Zonen
sind exakt die Werte von `ecosim.py --maps`. Setons-Staging (q = 0,40) liegt bei (487 | 547).

## Abweichungen (mit Begründung)

1. **Stichel-Threat 37 statt 40:** `roster.json` (einzige Zahlenquelle) hat heute 30 M / 60 HP / 23,3 DPS, √(23,3 · 60)
   = 37; auch `ecosim.py --threat` liefert 37. ai.md §5.6 nennt noch 40 (älterer Roster-Stand, dort auch „70 HP“ in
   §5.4). Der Test prüft 37 ± 1; ai.md bleibt unverändert (Design-Dokument, nicht in den owns).
2. **Blip-Median** ist definiert als oberer Median der Boden-Threats von `LAND & MOBILE & DIRECTFIRE - SCOUT - SNIPER -
   COMMAND` der Stufe (T1 [37, 84] → 84 = Punze, T2 [208, 294] → 294 = Meißel, T3 693). Das reproduziert die Zahlen
   aus ai.md §5.5; ein „Median über alle Kampfeinheiten“ ergäbe 48 bzw. 216 und widerspräche dem Text.
3. **`resolveRole(role, tech, table, roles)`** hat einen vierten Parameter (die Rollen-Ausdrücke aus dem Dokument);
   bequemer ist `RoleTable`.
4. **Ingest-Pauschale:** Perception-Ingest zählt 1 op je Einheit/Event gegen eine eigene Pauschale außerhalb der
   Tabelle ai.md §2.3 und wird nie abgeschnitten (ein unvollständiges Blackboard verfälscht alle Manager).
   `ThinkResult.opsTotal` enthält ihn nicht, `ingestOps` weist ihn getrennt aus.
5. **Budget-Reserve:** Manager-Budgets sind streng (kein Überlauf in die Reserve), damit Cursor-Verhalten nur vom
   eigenen Allotment abhängt. Die Reserve (Grundwert + Reste der vorigen Manager desselben Thinks) speist OpeningRunner
   und Emitter. Der Emitter lässt P0 nie am Budget scheitern (wird trotzdem gezählt).
6. **APM:** Neben dem Eimer (Kapazität = Burst, Nachfüllen cap/60 je Sekunde anteilig je Think) gilt eine harte
   Obergrenze von `cap` Records in jedem gleitenden 60-s-Fenster – auch für P0. Ein reiner Eimer erlaubt Burst +
   cap Records pro Minute und hätte das Gate „APM ≤ Cap in jedem Fenster“ verletzt.
7. **Dedup** vergleicht mit dem Auftrag laut Perception (`order`, `orderX/Z`, `orderTarget`, `orderBp`,
   `queueLength = 0`); FactoryRepeat/SetRally (in der Perception nicht sichtbar) mit dem zuletzt gesendeten Payload
   je Einheit. Deshalb die Ergänzung `OwnUnit.orderBp`.
8. **Reaktionsverzögerung auch für Kontakte:** neue Feindkontakte (neue ID) erscheinen in `bb.enemy.current` erst nach
   `reactionDelayTicks` (sonst hätte die Verzögerung keine Wirkung auf Platoon/Threat, AI-PLT-01 „Reaktionsverzögerung +
   2 Thinks + lead“). Wieder auftauchende, bekannte IDs sind kein neuer Reiz.
9. **Micro-Manager** wird, falls vorhanden, bei `profile.micro` (Hard) im normalen Think-Takt als letzter Manager
   ausgeführt; der eigene 5-Hz-Mini-Think ist MS14.
10. **`canPlaceKnown`-Regeln (provisorisch bis `rules.canPlace`, MS4):** Footprint in der Karte; Extraktoren nur
    zentriert (±1 WU) auf einem freien Spot passender Art, ohne Geländeprüfung; andere Strukturen: alle 2-WU-Zellen
    passierbar, Höhenspanne ≤ 1 WU und kein Überlappen des Extraktor-Footprints irgendeines Spots (Spots bleiben frei);
    keine Überlappung (positive Fläche, Kantenkontakt = Adjacency erlaubt) mit eigenen Strukturen inkl. Baustellen oder
    bekannten feindlichen Strukturen (sichtbar/Ghost). Rotation bekannter Strukturen = 0.
11. **Staging-Punkt Setons** (487 | 547) statt „≈ (426 | 564)“ aus ai.md §5.5: umgesetzt ist die Definition aus §3
    Punkt 4 (Pfadpunkt bei q = 0,40); (426 | 564) ist der eigene Brückenkopf-Mex bei q = 0,30.
12. **Blips in `forEachKnownEnemy`** passen nur auf `filter = null` (kein Blueprint, keine Kategorie).

## Adapter-Grenze (heute → später)

| Heute (TRACK-AI) | Später |
|---|---|
| `createAiStatic` aus .rtsmap + `computePassLowRes`, `sectors: null` | nav `passLowRes`/Sektor-Graph (MS9) |
| `bpTableFromRoster(roster.json)` | `BlueprintViewTable` aus @faf/blueprints |
| `PerceptionWriter` (Arena füllt ihn) | FrameWriter-Profil der eigenen Army in der Sim (dieselben Bytes) |
| provisorische Payloads `AI_PAYLOAD_VERSION` | Payload-Codecs in @faf/protocol (Ops unverändert) |
| `canPlaceKnown` | `rules.canPlace` mit Belegung „nur bekannt“ (ai.md §11 Punkt 9) |
| `PerceptionEvent` im Snapshot | Event-Stream der Sim |
| `AiCommandSource` / `PendingAiSource` | AI-Worker bzw. Sim-Worker-Fallback in sim-host (tai-p6 baut `host/`) |

## Bekannte Grenzen

- Keine Manager (Welle 1: tai-p3/tai-p4), kein `createDefaultBrain` (tai-p5), kein Worker-Host (tai-p6).
- `LocalThreatEstimate` ist die MS9-Schätzung (40 WU um den Punkt); das Threat-Grid liefert der IntelManager.
- `EnemyMemory` vergisst Kontakte 180 s nach dem letzten Erscheinen in der Perception; Ghost-Strukturen bleiben, solange
  die Perception sie liefert.
- Task-Board-Aufräumen (`prune`) ist Sache des EngineerManagers.
- `FakeWorld.applyOrders` simuliert nichts (keine Bewegung, kein Bau) – für Verhalten über Zeit ist die Arena da.
