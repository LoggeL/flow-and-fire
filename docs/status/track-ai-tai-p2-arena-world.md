# TRACK-AI · tai-p2-arena-world – Headless-Test-Sim „Arena“ (Welle 1)

Stand: 2026-09-30 · Branch `track-ai` · parallel zu tai-p3/tai-p4 · Vorarbeits-Track (keine echte Sim).

Hinweis: Der im Auftrag genannte Pfad `/Users/logge/Documents/Projects/faf-ai` existiert nicht; der Worktree des
Branches `track-ai` liegt unter `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-ai`. Dort wurde gearbeitet.

## Umgesetzt

Neue Module in `tools/ai-arena/src` (nur eigene owns-Pfade; `packages/ai` unverändert):

| Ordner | Dateien | Inhalt |
|---|---|---|
| `world/` | `world.ts`, `unit.ts`, `path.ts`, `grid.ts`, `handles.ts`, `hash.ts`, `index.ts` | `ArenaWorld` (Tick-Phasen, Commands, Orders, Bewegung, Eco, Fabriken, Upgrades, Kampf, Sicht, Ghosts, Events, Cheat-API), A*-Pfade mit Cache, 16-WU-Umkreisraster je Army, Handles `index:20\|gen:12` mit FIFO-Freelist, kanonischer Zustands-Dump + xxHash32 |
| `perception/` | `perceive.ts`, `index.ts` | `writePerception`, `buildArenaStatic`, `ArenaPerceiver`, `arenaEcoState` |
| `match/` | `run.ts`, `metrics.ts`, `index.ts` | `runMatch`, `runMatchAsync`, `replayMatch`, `matchLogOf`, `MetricsCollector`/`MatchMetrics` |
| `data/` | `assumptions.ts` (neu) | `getArenaAssumptions()` (aus `ai-openings.json → assumptions`), `getArenaBps()` (roster.json → `bpTableFromRoster`), `getArenaRoles()`, `buildRangeFor`, `FALLBACK_ASSUMPTIONS` |
| `index.ts` | – | exportiert data/eco/stats (tai-p1) sowie world/perception/match; `ARENA_SCHEMA` bleibt |

### Tick-Phasen von `ArenaWorld.step(cmds)` (feste Reihenfolge, 1 Tick = 0,1 s)

1. **CommandApply:** Commands des Ticks nach `(army, seq)` (Tie-Break Ankunftsindex). Prüfung: Army aktiv, AI-Op
   (`isAiOp`, sonst `unknownOp` – auch `Op.Cheat`), Payload über `decodeAiPayload` (sonst `malformed`), Handle-Generation
   (`invalidUnit`), Besitz (`notOwner`), `AiBlueprintTable.canBuild` (`notBuildable`), Platzierung (`placement`),
   Ziel (`noTarget`), Energie für Abstich (`noEnergy`). Ungültige Einheiten einer Gruppe werden übersprungen; abgelehnt
   wird nur, wenn keine Einheit den Befehl annimmt. `CmdFlags.Queue` hängt an, sonst ersetzt der Befehl.
2. **Roll-off:** Einheiten, die vor `rollOffS` (2 s = 20 Ticks) fertig wurden, verlassen die Fabrik (Rand + 1 WU Richtung
   Rally) und bekommen `Move` zum Rally.
3. **Strukturen:** Fabriken nehmen das nächste Item (erst Queue, dann Repeat-Schleife) und setzen ihre eigene BP ein;
   Upgrades laufen mit der BP der Struktur (Zapfstelle 10, Landwerk 20).
4. **Einheiten:** Orders und Bewegung in Slot-Reihenfolge (Move, AttackMove, Attack, Build, Assist, Guard, Repair,
   Patrol, Overcharge); Bauer tragen ihre BP auf das Arbeitsziel ein.
5. **Economy:** `FlowEconomy` (tai-p1): Einkommen/Unterhalt/Speicher aller fertigen Einheiten aus dem Roster
   (Vogt 1 M/s, 20 E/s, 650/3.900), Glutkranz +25 % je angrenzendem fertigem Glutspeicher (nur T1-Glutkessel),
   Verbraucher = Baustellen, Fabrik-Items, Upgrades, Reparaturen, Test-Verbraucher; Fortschritt je Tick
   `BP × Ratio / buildTime / 10`, Kosten kumulativ (`chargeProgress`, exakt die Blueprint-Kosten).
6. **Kampf:** Raster neu aufbauen; Zielwahl gestaffelt (`(tick + slot) % 3 = 0`), nächster *sichtbarer* Feind mit
   passendem Layer (Boden-DPS gegen Boden/Strukturen, Luft-DPS gegen Luft) in Waffenreichweite (AttackMove/Patrol/
   Guard: +10 WU, die Einheit rückt dann nach), Mindestreichweite beachtet; Schaden `DPS × 0,1` je Tick, gleichzeitig
   angewandt; Tod entfernt die Einheit (keine Wracks); Vogt-Tod ⇒ Army besiegt (alle Einheiten zerstört), Match-Ende.
7. **Sicht** (alle 2 Ticks): Sichtbarkeit je Army (Sichtradius aus `intel.vision`, Fallback Strukturen 12 WU / mobil
   16 WU), `enemySighted` beim Auftauchen, Ghost-Gedächtnis für feindliche Strukturen.
8. **Metriken/Cleanup:** Idle-Engineer-Zähler, Beobachter (`onTickEnd`), freie Slots zurück in die FIFO-Freelist.

### Orders (Semantik)

| Order | Verhalten |
|---|---|
| Move / AttackMove / Patrol | A*-Pfad (Land) bzw. Gerade (Luft), Ankunft ≤ 0,5 WU. AttackMove/Patrol halten für Ziele in Reichweite und rücken zu Zielen bis Reichweite + 10 WU vor; Patrol pendelt zwischen Startpunkt und Ziel. |
| Attack | läuft in Reichweite (× 0,9), erzwingt das Ziel; endet mit dem Tod des Ziels oder wenn eine mobile Einheit aus der Sicht verschwindet. |
| Build | Platzprüfung beim Command mit dem **Wissen der Army** (Gelände, Mauern, eigene Strukturen, sichtbare/Ghost-Strukturen), Hinlaufen bis `Baureichweite + halber Footprint`, dann Prüfung gegen die **WAHRE** Belegung (sonst `commandRejected {seq, 'placement'}`), Baustelle anlegen; eine eigene unfertige Baustelle gleicher Art an derselben Stelle wird mitgebaut. Baustellen bleiben nach dem Tod des Bauers stehen (fortsetzbar per Assist/Build). |
| Assist | BP auf die Arbeit des Ziels: Baustelle, Fabrik-Item, Upgrade, bei Engineers deren Baustelle/Reparatur (bis 2 Ebenen). Auf Strukturen außer Fabriken endet der Auftrag mit der Arbeit; auf Fabriken und mobilen Zielen bleibt er bestehen. |
| Guard | folgt dauerhaft und assistiert (Bauer) bzw. kämpft (Kampfeinheiten, Folgeabstand 8 WU). |
| Repair | `maxHp × BP / buildTime / 10` HP je Tick × Ratio, Kosten `Preis × BP / buildTime / 10` je Tick (anteilig); auf Baustellen = Weiterbauen. |
| Reclaim | keine Wracks ⇒ immer `commandRejected 'noTarget'`. |
| Upgrade | in-place nach `upgradesTo`; Zapfstelle produziert weiter (mit der alten Stufe), Fabriken pausieren die Produktion (Fortschritt bleibt). |
| FactoryQueue / FactoryRepeat | Queue (mit Queue-Flag anhängen, sonst ausstehende Items ersetzen, laufendes Item bleibt); Repeat ersetzt bzw. löscht die Schleife. Nächstes Item startet sofort nach Fertigstellung (wie ecosim), Spawn nach Roll-off. |
| SetRally | Fabriken; Move/AttackMove/Patrol an eine Fabrik setzen ebenfalls den Rally. |
| Stop | mobile Einheiten: Orders leer; Strukturen: Queue, Schleife, laufendes Item und Upgrade verworfen. |
| Overcharge | nur Vogt, nur ab 7.500 E Vorrat (sonst `noEnergy`), vereinfacht nach roster-Notiz: Schaden gegen Mobile = clamp(max. HP mobiler Nicht-Vogt-Feinde in 2,7 WU, 1.250, min(15.000, 0,9 · Vorrat / 6)), gegen Strukturen 800, gegen Vogt 400, Splash 2,5 WU auf mobile Feinde, Energie −6 × Schaden, Nachladen 3,3 s. |

### Ereignisse je Army

`ownDamaged {unit, attacker, attackerBp, amount}` (Angreifer nur, wenn für das Opfer sichtbar, sonst 0/−1; höchstens
ein Ereignis je Einheit und 5 Ticks, Beträge dazwischen summiert), `ownDestroyed`, `ownCompleted` (Bau, Upgrade und
produzierte Einheit nach dem Roll-off), `enemySighted`, `enemyDestroyed` (nur gesehene Zerstörung),
`commandRejected {seq, reason, unit}`. Die Warteschlange wird von `writePerception` geleert (Deckel 65.536).

## APIs und Verträge für Folgepakete (tai-p5, tai-p6)

Alles über `@faf/ai-arena` (Paket-Einstieg `src/index.ts`).

### Welt

- `ArenaWorld.create({map: ArenaMap | name, seed, armies: [{army, startIndex}], bps?, assumptions?})` – `startIndex`
  ist der Index in `ArenaMap.starts` (nach Marker-Army sortiert; Setons 0 = SW-Mid, 1 = NO-Mid). `bps` Standard
  `getArenaBps()`, `assumptions` Standard `getArenaAssumptions()`.
- `step(cmds)`, `tick` (= Zahl der abgeschlossenen Schritte; der nächste Schritt wendet die Commands dieses Ticks an),
  `over`, `winner` (−1 Remis), `endReason`, `endByTickLimit()`.
- Abfragen: `unit(handle)`, `units()`, `unitsOf(army)`, `commander(army)`, `startOf(army)`, `bpIndex(id)`, `info(bp)`,
  `ecoOf(army)`, `income[army]` (`{mass, energy, upkeep}` der letzten Eco-Phase), `counters[army]`, `events[army]`,
  `ghosts[army]`, `sees(army, unit)`, `pointSeenBy(army, x, z)`, `canPlace` (Wahrheit), `canPlaceKnownBy(army, …)`,
  `workOf(unit)`, `paths` (`PathFinder`), `baseStatic`, `hash()`, `observers` (`WorldObserver`), `commandLog`, `cheatLog`.
- **Cheat-/Szenario-API** (nur Code, nie über Commands; jeder Aufruf landet mit Tick im `cheatLog` und wird von
  `replayMatch` vor dem Schritt dieses Ticks wiederholt): `spawn(army, bpId, x, z, {complete?})` → Handle,
  `kill(handle)`, `setStorage(army, mass, energy)`, `setHp(handle, frac)`, `addDemand(army, M/s, E/s)` → id
  (Ersatz für `test:stall_consumer`, AI-ECO-01) / `removeDemand(id)`, `addIncome(army, M/s, E/s)` → id (AI-ECO-02) /
  `removeIncome(id)`, `blockCells(x0, z0, x1, z1)` (WU-Rechteck, Mauer-Ersatz für AI-ENG-02: sperrt Platzierung und
  Landpfade, das `AiStatic` der KI bleibt unverändert), `applyCheat(record)`.
- `worldHash(world)` / `dumpWorld(world)`: xxHash32 (@faf/fixed) über Tick, Seed, Eco-Vorräte/Kapazitäten, alle Einheiten
  in Slot-Reihenfolge (Position, HP, Bau, Orders, Fabrik, Upgrade, Roll-off, Rally, Ziel, Sichtmaske), Ghosts, Cheat-
  Flüsse, Mauern. Ereignis-Warteschlangen gehören nicht zum Zustand (Lesen der Perception verbraucht sie).

### Perception

- `writePerception(world, army, tick, writer: PerceptionWriter): Uint8Array` – `tick` muss `world.tick` sein. Inhalt:
  eigene Einheiten (Slot-Reihenfolge, alle `OwnUnit`-Felder: Build ⇒ `orderTarget` = Baustelle bzw. 0, `orderBp`;
  Strukturen im Upgrade ⇒ `order = Upgrade`, `orderBp`/`upgradingTo`; Fabriken ⇒ `factoryBp`, `factoryProgress`,
  `factoryRepeat`, `queueLength` = Summe der ausstehenden Queue-Items), bekannte Feinde (erst sichtbare in
  Slot-Reihenfolge, dann Ghosts nicht sichtbarer Strukturen in Einfügereihenfolge; keine Blips), eigene Ereignisse seit
  dem letzten Aufruf, eigene Eco (`FlowEconomy.snapshot`).
- `buildArenaStatic(world, army, gameSeed = world.seed): AiStatic` – dieselben Raster wie die Welt
  (`computePassLowRes` mit den `assumptions.passability`), alle Starts der Karte, `armyStart`/`activeArmies` aus dem
  Match-Setup (gecacht je Welt).
- `ArenaPerceiver(world, army)` mit `perceive(tick): PerceptionView` (Kopie der Bytes) und `bytes(tick)`.

### Match

- `runMatch({world | setup | map + seed [+ bps, armies], sides: [{army, source}], maxTicks, onTick?, perceptionFor?, roles?}): MatchResult`
  – `source` ist eine `CommandSource` oder eine Fabrik `(ctx: MatchSourceContext) => CommandSource` mit
  `ctx = {world, army, static, perceive(tick)}` (für `AiCommandSource({brain, perceive: ctx.perceive})`).
  Schleife je Tick: `onTick(world, t)` → Commands aller Quellen für `t` (`'pending'` ⇒ Fehler) → `world.step`.
  Ende bei Vogt-Tod oder `maxTicks` (Remis). Envelopes einer Quelle müssen die eigene Army tragen.
- `runMatchAsync(opts & {yieldFn?, maxWaitsPerTick?})` – wartet bei `'pending'` (Standard: MessageChannel-Runde durch
  die Event-Loop, kein Timer), zählt `pendingWaits`, `ticksWaited`, `maxWaitsPerTick`.
- `MatchResult = {world, metrics: MatchMetrics, log: MatchLog, hash}`; `MatchLog = {setup, cheats, commands:
  {tick, env}[], endTick, endReason}` (alle angewandten Envelopes mit Anwendungstick, auch abgelehnte).
- `replayMatch(setup, log, roles?) → {world, metrics, hash}` – gleicher Welt-Hash wie das Original.
- `MatchMetrics = {armies: ArmyMatchMetrics[], winner, endTick, endReason}`; je Army: `t2Tick`, `fac1Tick`,
  `eng1Tick`, `eng4Tick`, `mex4Tick`, `mex8Tick` (Ticks nach dem Schritt, Sekunden = Tick / 10), `massInc`/`mexAt` bei
  180/300/480/720 s, `engineerAliveTicks`, `engineerIdleTicks`, `idleEngineerPct`, `energyStallPct` (+ Rohwerte
  `energyStallTicks`, `energyCountedTicks` zum Poolen), `overflowPct`, `massBpStallPct`, `firstCombatUnitTick`
  (ecosim `firstCombat`), `firstDamageTick`, `producedByRole` (Rollen aus `ai-openings.json`, erste passende Rolle,
  Rest `other`), `unitsProduced`, `unitsLost`, `commandsPerWindow` (60-s-Fenster), `apmMax`, `commandsRejected`,
  `defeated`, `defeatTick`.

## Tests (`tools/ai-arena/test/{world,perception,match}`, 45 Tests, zusammen mit tai-p1 115 Tests ≈ 3–4 s)

| Datei | Inhalt (ai.md-Test-IDs) |
|---|---|
| `world/build.test.ts` | Vogt baut Landwerk I auf Setons-Slot fac1 (30,3 s; ecosim 31,8 s ± 2 s), Kosten exakt 240 M / 2.100 E; Assist mit gleicher BP halbiert die Bauzeit (± 1 Tick); Baustelle überlebt den Bauer und wird per Assist fertig; Kostensumme exakt unter Mass-Stall; `commandRejected 'placement'` bei Mauer (Ersatz AI-ENG-02) und späte Ablehnung beim Baubeginn; Upgrade Zapfstelle I → II (90 s, Mass läuft weiter) und Landwerk I → II (Produktion pausiert); Fabrik-Queue + Repeat + Roll-off 2 s + Rally (Engineer 13 s + 2 s); Flow-Stall ohne Energie (Ratio ≈ 2/7); Ablehnungsgründe `malformed`, `notOwner`, `notBuildable`, `noTarget` (Reclaim), `unknownOp` (Cheat-Op), `invalidUnit`; Shift-Queue; Abstich ab 7.500 E; Handles (FIFO, Generation, nie 0) |
| `world/path-combat.test.ts` | Pfad Start Army 0 → Army 1 über die Setons-Landbrücke 458,3 WU (Soll 463 ± 5 %), Hollow Ridge über den Kamm (546,6 WU, Soll 570 ± 5 %) inkl. Cache; Vogt läuft mit `motion.speed`; Insel-Bau ⇒ `commandRejected 'other'`, Move auf eine Klippe endet am nächsten passierbaren Feld; kein Eckenschneiden; A* deterministisch; 10 Punzen schlagen 7 Punzen (Ereignisse `ownDestroyed`, `enemyDestroyed`, `ownDamaged` mit Angreifer); Vogt-Tod ⇒ besiegt + Match-Ende; 60-s-Stall-Ausnahme nach Kraftwerksverlust; Sicht, `enemySighted`, Ghost bleibt nach Wegziehen, ungesehene Zerstörung ⇒ Ghost bis zur erneuten Sicht, gesehene ⇒ sofort weg + `enemyDestroyed`; kein Radar |
| `world/orders.test.ts` | Repair (30 s für 50 % Landwerk, Kosten anteilig), Guard an Fabrik (idle bei leerer Fabrik, BP-Beitrag), Stop, Patrol, Luft geradeaus, Test-Verbraucher `addDemand` (AI-ECO-01-Ersatz) und `addIncome` inkl. Cheat-Log |
| `perception/perception.test.ts` | Inhalt der Perception (Orders, Baustelle, Fabrik, Upgrade, Events verbraucht); **AI-PERC-01** (Feind 45 WU neben der Basis im Fog ⇒ Bytes identisch, 12 Vergleiche); **AI-PERC-03-Teil** (feindlicher Energiespeicher 0 / 3.900 ⇒ Bytes identisch, Vogt sichtbar); **AI-PERC-02-Teil** (verdeckte feindliche Zapfstelle auf eigenem Spot ⇒ `freeMassSpots`/`canPlace` gleich; Engineer läuft hin, sieht sie, Bau abgelehnt, Spot belegt; nach Wegziehen Ghost); `buildArenaStatic` mit `armyStart` aus dem Setup |
| `match/match.test.ts` | gescriptete Eröffnung beider Seiten: fac1 303, eng1 = fac1 + 150 Ticks (ecosim: + 15 s), mex4, Samples, Rollen, APM; **Determinismus**: zwei Läufe gleicher Hash, `replayMatch` == Original (inkl. Cheat mitten im Spiel), gekürztes Log ⇒ anderer Hash; Vogt-Tod beendet das Match (Replay ebenfalls); **AI-DET-03-Arena-Teil**: `runMatchAsync` mit `PendingAiSource` (Antwort zwei Makrotasks zu spät) ⇒ wartet an allen 400 Ticks, nichts verworfen, identischer Hash und identische Metriken wie synchron; `'pending'` im synchronen Lauf ⇒ Fehler |
| `match/metrics.test.ts` | `t2Tick` (Upgrade 115 s), Idle-Regel (< 2 s zählt nicht, ≥ 2 s ganze Strecke) |
| `match/ai-source.test.ts` | Ende-zu-Ende: `createBrain` mit Fixture-Manager hinter `AiCommandSource` – Perception-Bytes → Brain → Emitter-Envelopes → Arena → fac1 303, 2 Lehrlinge, 0 Ablehnungen, Replay bitgleich |
| `match/perf.test.ts` | Leistung (siehe Messwerte), Replay des 30-min-Laufs bitgleich |

Selbsttest: `tools/heavy pnpm exec vitest run tools/ai-arena` → 12 Dateien, 115 Tests grün (≈ 4 s);
`tools/heavy pnpm exec tsc -b tools/ai-arena` grün; Testdateien mit `tsconfig.tests.json` typgeprüft; ESLint über
`tools/ai-arena` ohne Befund; Determinismus-Guard (`packages/ai/test/determinism-guard.test.ts`) grün.

## Messwerte (Node, M5 Pro, unter Last paralleler Agenten)

| Messung | Wert |
|---|---|
| 2 × 300 kämpfende Einheiten (je 150 Punzen, 100 Stichel, 50 Kellen, Attack-Move aufeinander), 3.000 Ticks | 0,17–0,27 s gesamt (0,06–0,09 ms/Tick); Anmarsch + Gefecht bis zur Vernichtung einer Seite (588 Ticks) 0,25–0,34 ms/Tick, schlechtester Tick 2,4–3,2 ms |
| 30-min-Match ohne KI (18.000 Ticks, je 4 Fabriken in Dauerschleife, Angriffe alle 2 min, bis 644 lebende Einheiten) | 0,85–1,6 s (Ziel < 10 s) |
| Hochgerechnet: 30 min Dauergefecht mit 600 Einheiten | ≈ 4,5–6 s |
| Welt anlegen | Setons ≈ 28 ms beim ersten Mal (Passierbarkeit), danach gecacht je Karte (< 1 ms); Hollow Ridge/Tessera/Braidwater ≈ 6–8 ms |
| A* Start → Gegner-Start | Setons 0 Expansionen (Gerade frei, 458,3 WU); Hollow Ridge 13.358 Expansionen, 3,2 ms, 546,6 WU (8 Wegpunkte); Braidwater 4.387 Expansionen, 400,1 WU; Tessera Gerade 418,6 WU |

Optimierung während der Arbeit: ein Umkreisraster je Army (statt eines gemeinsamen) senkte den 30-min-Lauf von 3,8 s
auf 1,1 s (dichte eigene Pulks verlangsamen Abfragen nach Feinden nicht mehr).

## Abweichungen (mit Begründung)

1. **fac1 = 30,3 s statt 31,8 s (ecosim):** Die Arena lässt Bauer bis `Baureichweite + halber Footprint` laufen (Auftrag);
   fac1 liegt 12 WU vor dem Vogt, also in Reichweite 10 + 4 WU – kein Laufweg. ecosim rechnet 12 × 1,1 − 10 = 3,2 WU
   Laufweg (1,9 s). Allgemein laufen Bauer in der Arena echte A*-Wege statt Luftlinie × 1,1 und stoppen um den halben
   Footprint früher; frühe Engineer-Wege sind dadurch einige Sekunden kürzer. Für AI-OPEN-01/02 (± 10 s, tai-p5) ist das
   die erwartete Hauptquelle von Abweichungen gegen `expect`.
2. **Platzierungsprüfung zweistufig:** Beim Eintreffen des Build-Commands prüft die Arena nur das Wissen der Army
   (Gelände, Mauern, eigene, sichtbare und Ghost-Strukturen); die **wahre** Belegung wird beim Baubeginn geprüft
   (Ablehnung mit der `seq` des Commands). Eine sofortige Wahrheitsprüfung hätte über `commandRejected` verdeckte feindliche
   Strukturen verraten (R-08) und AI-PERC-02 („Engineer läuft hin, sieht sie“) unmöglich gemacht. Mauern (`blockCells`)
   gelten als Gelände und werden sofort abgelehnt.
3. **Keine Kollisionen/Steering, Strukturen blockieren keine Wege**, nur `blockCells`-Mauern und Gelände. Einheiten
   stapeln sich.
4. **Pfade:** A* auf dem 2-WU-Raster (Oktil-Heuristik, Tie-Break Zellindex) mit gieriger Glättung (String Pulling) ⇒
   Wege kürzer als der Raster-Dijkstra der Kartenanalyse (Hollow Ridge 546,6 statt 569,5 WU, −4 %). Unerreichbare Ziele
   (andere Komponente) ⇒ Order endet; bei Build `commandRejected 'other'` (es gibt keinen Grund „unreachable“ in
   `REJECT_REASONS`). Blockierte Zielzellen werden auf die nächste passierbare Zelle (bis 32 Ringe) verschoben.
5. **Kampf vereinfacht:** kein Projektil, kein Zielen/Drehen, konstanter DPS; Splash = derselbe Tick-Schaden an bis zu
   4 weitere mobile Bodenfeinde im Splash-Radius; Einheiten feuern nur auf Ziele, die ihre Army sieht (Kellen/Rinnen
   brauchen fremde Sicht für ihre volle Reichweite); Vogt-Tod zerstört alle Einheiten der Army (kein Lotbruch-Schaden).
6. **Sicht:** Fallback für Blueprints ohne `intel.vision` (Zapfstelle I, Glutkessel I, Speicher, Dampfquelle, Mauer):
   Strukturen 12 WU, mobile 16 WU. Kein Radar (MS9-Kern): `intel.radar` wird ignoriert, keine Blips.
7. **Baustellen-HP:** Start mit 10 % der Max-HP, der Rest wächst mit dem Fortschritt.
8. **Upgrades:** Fabriken pausieren die Produktion (Fortschritt bleibt, ecosim verwirft das laufende Item);
   Strukturen ohne eigene BP würden mit BP 10 aufrüsten (im MVP-Roster nicht vorhanden).
9. **Stop an Fabriken** verwirft das laufende Item samt bezahltem Fortschritt; `FactoryQueue` ohne Queue-Flag ersetzt nur
   die ausstehenden Items.
10. **Idle-Engineer:** Orderlose Strecken zählen ab 2 s vollständig (rückwirkend), kürzere gar nicht; Guard/Assist auf
    ein Ziel ohne Arbeit zählt immer; Laufen zum Rally nach dem Spawn zählt als beschäftigt. Quote = Σ idle / Σ
    Lebenszeit (ai.md §7.1), nicht der Mittelwert der Einzelquoten wie in ecosim.
11. **Energie-Stall** wie tai-p1/ecosim: Stall-Ticks / nicht ausgenommene Ticks; zusätzlich Rohwerte zum Poolen. Die
    60-s-Ausnahme startet beim Verlust eines *fertigen* Kraftwerks oder Speichers (auch Dampfquelle).
12. **Metrik-Ticks** zählen „nach dem Schritt“ (Ereignis im Schritt k ⇒ Tick k + 1); ecosim protokolliert mit der
    Startzeit des Schritts (0,1 s früher).
13. **`seed`** der Welt geht in den Hash ein; die Arena selbst braucht keinen Zufall.

## Für tai-p5 gemeldet (Lücken in `packages/ai`, in der Arena gelöst)

- `createAiStatic` kennt keine freie Zuordnung Army → Start; `buildArenaStatic` überschreibt `armyStart`/
  `activeArmies` des erzeugten `AiStatic` mit dem Match-Setup (Vorschlag: optionales `armyStart` im Input).
- `REJECT_REASONS` hat keinen Grund für „kein Weg“; die Arena meldet `other`.
- `canPlaceKnown` behandelt bekannte Strukturen mit Rotation 0; die Arena ebenso (alle Struktur-Footprints im Roster
  sind quadratisch).
- Vertrag der Platzierungsprüfung (Punkt 2 der Abweichungen) sollte in PLAN/rules für MS9 übernommen werden, sonst
  entsteht der Fog-Leak im Command-Pfad.
- `ownCompleted` kommt auch für abgeschlossene Upgrades (mit neuem `bp`) und für produzierte Einheiten nach dem Roll-off;
  `ownDamaged` ist je Einheit auf ein Ereignis je 5 Ticks gedrosselt (Beträge summiert).

## Adapter-Grenze (heute → später)

| Arena (TRACK-AI) | MS6/MS9 |
|---|---|
| `ArenaWorld` (vereinfachte Sim, Floats) | echte Sim (`packages/sim`, Fx, 15 Phasen) |
| `writePerception` | FrameWriter-Profil der eigenen Army (gleiches Snapshot-Layout v1) |
| `buildArenaStatic` (aus .rtsmap + `computePassLowRes`) | `AiStatic` aus nav (`passLowRes`, Sektoren) und @faf/blueprints |
| `decodeAiPayload` (provisorische Layouts) | Payload-Codecs in @faf/protocol |
| `canPlaceKnownBy` / `canPlace` (Wahrheit) | `rules.canPlace` mit Belegung „nur bekannt“ beim Command, Wahrheit beim Baubeginn |
| `runMatch`/`runMatchAsync`/`replayMatch`, `MatchLog` | sim-host Scheduler (`'pending'` ⇒ SP-Sim-Lag), Replay-Chunks CMDS/MARK, `tools/headless` |
| Cheat-API | Dev-Konsole/ScenarioBuilder (`Op.Cheat` nur für Szenarien) |

## Bekannte Grenzen

- Keine Kollisionen, Formationen, Flow Fields, Transporter, Marine; Luft fliegt geradeaus ohne Wendekreis.
- Keine Wracks/Reclaim, keine Schilde als eigene Mechanik (Schild-HP zählt nur in `hpEff`), kein Radar, keine
  Adjacency außer dem Glutkranz, kein AIx, keine Prioritäten/Pausen (ein Eco-Tier wie tai-p1).
- Abstich stark vereinfacht; kein Auto-Abstich.
- Fabriken spawnen an einer festen Seite (Richtung Rally, sonst +z); liegt der Spawnpunkt auf einer Klippe, läuft die
  Einheit erst zur nächsten passierbaren Zelle.
- Der Pfad-Cache speichert Zellfolgen je (Start-, Zielzelle) – viele Einheiten mit verschiedenen Startzellen lösen
  eigene A*-Suchen aus (auf Setons meist freie Gerade, daher unkritisch).
- Ereignisse, die niemand liest, werden ab 65.536 je Army gekürzt (älteste zuerst).
