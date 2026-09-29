# Skirmish-KI: Verhalten der Varkan-KI

> **Status:** Design-Vorgabe für `packages/ai` (PLAN §3.10), Stand 2026-09-29, kritisches Review eingearbeitet (Entscheidungen in §12). Umgesetzt wird ab MS6 (Scripted Dummy-KI, SPK7) und MS9 (A1/A2), erweitert in MS10–MS14 (A7–A11).
> **Quellen:** PLAN §3.4 (Economy-Kern), §3.8 (Gruppenbefehle, Formationen), §3.10 (KI-Grenze, Manager, Takte), §3.12 (Turniere), §5 (MS6, MS9–MS14); `docs/features.json` (A1–A13); `docs/design/roster.json` (einzige Zahlenquelle für Einheiten); `docs/design/faction.md` (Rollen, Hotbuild, Icons); `content/maps/src/setons.spec.md` und `markers.json` (Setons, Hollow Ridge).
> **Maschinenlesbar:** Eröffnungen in [`ai-openings.json`](ai-openings.json) (Schema `faf-ai-openings/1`, §4.1). Alle Timings in §4.5 stammen aus [`tools/ai-sim/ecosim.py`](../../tools/ai-sim/README.md) (Flow-Eco-Simulation auf den echten Heightmaps); `--check` hält JSON und Simulation synchron.
> **Geltung:** Fraktion Varkan. Karten: **Setons 1v1** (Army 0 SW-Mid gegen Army 1 NO-Mid, 2 der 8 Starts, 1.024 WU) und **512-WU-1v1** (Referenz Hollow Ridge). Die Regeln sind kartengenerisch; kartenspezifisch sind nur die Analysedaten aus §3.
> **Nicht im MVP:** Marine, Transporter, Experimentals, TML/Nukes, Engineer-Capture, gezieltes Reclaim-Management (A15/A16/A21 sind Post-MVP).

---

## 1. Leitplanken

1. **Nicht cheatend per Konstruktion (A10).** Die KI liest nur `PerceptionView` (Profil des FrameWriters für die eigene Army: Sichtbares, Radar-Blips, Ghosts) und `AiStatic` (Karte, Spots, Pässe, Blueprint-View, Startpositionen aus dem Skirmish-Setup). Sie schreibt nur Commands; diese landen im Replay. AIx (A11) ist der einzige Vorteil und ein Sim-Modifier, kein Wissensvorteil. Auch die Hilfsabfragen der Perception (`freeMassSpots()`, `canPlace`) kennen nur Gelände, eigene und **bekannte** feindliche Objekte (§5.3), und über den Gegner nutzt die KI nur, was ein Spieler auf dem Bildschirm sähe: Position, Typ, HP-Anteil, nie Speicher, Einkommen oder Queues (§5.5).
2. **Profile auf Kategorien und Rollen, nie auf Unit-IDs.** Jede Entscheidung nennt eine Rolle (`tank`, `mex`, …), die `ai-openings.json → roles` per Kategorie-Ausdruck (Grammatik wie `packages/rules/src/expr.ts`) plus Tech-Stufe auf genau einen Blueprint auflöst. Eine zweite Fraktion braucht nur neue Blueprints, keine KI-Änderung.
3. **Spielt wie ein FA-Spieler, nicht wie ein Skript.** Flow-Eco statt Vorkasse: Die KI plant mit Raten (M/s, E/s), hält Mass nahe 0 und Energie positiv, nutzt Assist, Shift-Queues, Repeat-Schleifen und Upgrades in-place.
4. **Deterministisch und budgetiert.** Gleicher Seed + gleiche Perception-Folge ⇒ gleicher Command-Strom, im Browser wie headless. Budgets zählen Operationen, nicht Millisekunden (§2.3).
5. **Messbar.** Jedes Verhalten hat eine Metrik und ein Testszenario (§7, §9). Neue Regeln kommen nur mit Szenario.

---

## 2. Laufzeitmodell

### 2.1 Takt und Latenz

| Größe | Easy | Normal | Hard | Herkunft |
|---|---|---|---|---|
| `thinkEvery` (Ticks) | 10 (1 Hz) | 5 (2 Hz) | 5 (2 Hz) | PLAN §3.10 |
| Micro-Takt | – | – | 2 Ticks (5 Hz), nur Platoons im Gefecht | PLAN §3.10 |
| `lead` (Ticks) | 3 | 3 | 3 | PLAN §3.10 |
| zusätzliche Reaktionsverzögerung | 20 Ticks | 5 Ticks | 0 | §6 |

- Die KI denkt an Tick `N ≡ 0 (mod thinkEvery)`, sieht `Perception(N)` und liefert Commands für `N + lead`. Bis dahin meldet ihre `CommandSource` `'pending'`, die Sim wartet (SP-Sim-Lag, nichts wird verworfen).
- Die **Reaktionsverzögerung** gilt nur für *neue* Reize (erster Sichtkontakt, erster Schaden, neuer Blip): Das Ereignis wird im Blackboard erst `reactionDelay` Ticks später sichtbar. Laufende Pläne sind davon unberührt. So bleibt der Command-Strom deterministisch und Easy wirkt „träge“, ohne seltener zu denken als nötig.

### 2.2 Manager-Fahrplan

Ein Think `k = N / thinkEvery` führt die Manager in fester Reihenfolge aus. 1-Hz-Manager laufen abwechselnd, damit die Last pro Think gleichmäßig bleibt.

| Reihenfolge | Manager | Takt | Think-Slot (Normal/Hard) | Easy |
|---|---|---|---|---|
| 1 | Perception-Ingest (Blackboard: eigene Einheiten, Feindkontakte, Ereignisse) | jeder Think | jeder | jeder |
| 2 | IntelManager (Threat-Grid, Scout-Routen) | 1 Hz | `k` ungerade | jeder |
| 3 | OpeningScript (bis Handoff) | jeder Think | jeder | jeder |
| 4 | EconomyManager | 1 Hz | `k` gerade | jeder |
| 5 | TechManager | 1 Hz | `k` gerade | jeder |
| 6 | DefenseManager | 1 Hz | `k` ungerade | jeder |
| 7 | FactoryManager | 1 Hz | `k` gerade | jeder |
| 8 | EngineerManager (Task-Board) | 2 Hz | jeder | jeder |
| 9 | PlatoonManager | 2 Hz | jeder | jeder |
| 10 | Command-Emitter (APM-Budget, Prioritäten, Dedup) | jeder Think | jeder | jeder |
| – | Micro (nur Hard) | 5 Hz | eigener Mini-Think bei `N ≡ 0 (mod 2)` | – |

Das Blackboard ist der einzige geteilte Zustand zwischen den Managern: Task-Board (§5.3), Reservierungen (Spots, Bauplätze, Einheiten), Eco-Bilanz, Threat-Grid, Platoon-Liste. Manager schreiben nur ihre eigenen Abschnitte.

### 2.3 Operationsbudget

**Eine Operation (op)** ist: eine besuchte Einheit in `forEachOwn`/`forEachKnownEnemy`, eine gelesene oder geschriebene Grid-Zelle (1 op für alle Ebenen der Zelle), eine Knotenexpansion im Sektor-Graph (A\*/Dijkstra), ein `canPlace`-Aufruf (zählt 4 ops + 1 je 4 Footprint-Zellen), ein kodierter Command (10 ops). Jede Schleife in `packages/ai` fragt `budget.take(n)` ab; ist das Budget eines Managers leer, speichert er seinen Cursor (Einheiten-Index, Grid-Zeile, Task) und setzt beim nächsten Lauf dort fort. Da nur Operationen zählen, ist das Ergebnis im Browser und headless identisch.

| Budget je Think | Easy | Normal | Hard |
|---|---|---|---|
| Gesamt | 12.000 | 24.000 | 40.000 (+ 8.000 je Micro-Think) |
| IntelManager | 4.000 | 7.000 | 12.000 |
| PlatoonManager | 2.500 | 5.000 | 9.000 |
| EngineerManager (inkl. Platzierung) | 2.500 | 5.000 | 8.000 |
| EconomyManager | 1.000 | 2.000 | 3.000 |
| DefenseManager | 800 | 2.000 | 3.500 |
| FactoryManager | 500 | 1.000 | 1.500 |
| TechManager | 200 | 500 | 500 |
| Reserve (Opening, Emitter, Überlauf) | 500 | 1.500 | 2.500 |

- Nicht verbrauchtes Budget eines Managers fällt an die Reserve desselben Thinks; Übertrag auf den nächsten Think gibt es nicht (sonst hinge das Verhalten vom Verlauf der Lastspitzen ab).
- **Größenordnung (im Review korrigiert, §12 R-10):** Setons hat im Threat-Grid 64 × 64 = 4.096 Zellen (16 WU), Hollow Ridge 32 × 32. Bei 300 eigenen und 300 feindlichen Einheiten kostet ein Intel-Takt: 300 Feind-Besuche + Eintrag in Ø 12 Zellen (Punze 26 WU ⇒ 3 × 3, Rinne 68 WU ⇒ ≈ 57, Tiegel 118 WU ⇒ ≈ 170 Zellen) ≈ 3.900 ops, dazu das Sicht-Update aus 300 eigenen Einheiten (Ø 9 Zellen) ≈ 3.000 ops, zusammen ≈ 6.900 ops. Das passt knapp in Normal (7.000), aber nur, weil der Verfall **lazy** läuft (§5.6). Ein Verfall-Durchlauf über alle 4.096 Zellen je Takt (die frühere Annahme) hätte ≈ 11.000 ops gekostet. Bei größeren Lagen und auf Easy (4.000) setzt der IntelManager per Cursor im nächsten Takt fort. Das Grid ist dann bis zu 2 s alt, bleibt aber deterministisch.
- **Notabbruch:** Überschreitet ein Think die Wall-Clock-Grenze (Browser 40 ms, headless 200 ms), bricht der Worker ab, sendet nur die bereits entschiedenen Commands und schreibt `MARK aiTimeout` (PLAN §3.10). Gate: 0 Timeouts in Turnieren (§7.2). Das Budget ist so bemessen, dass ein Normal-Think auf dem Referenz-Laptop p95 ≤ 8 ms braucht.
- **Folge eines Notabbruchs:** Nur hier hängt das Verhalten von der Wall-Clock ab. Browser- und Headless-Command-Strom können danach auseinanderlaufen. Das Spiel selbst bleibt gültig, weil die Commands im Replay stehen. Damit ein Abbruch keine halben Pläne hinterlässt, übernimmt jeder Manager seinen Zustand erst am Ende eines abgeschlossenen Arbeitsschritts (Cursor-Commit, Test `AI-DET-04`).

### 2.4 Command-Budget (APM)

| | Easy | Normal | Hard |
|---|---|---|---|
| APM-Cap (Command-Records pro Minute) | 40 | 120 | 300 |
| Eimer-Kapazität (Burst) | 10 | 20 | 40 |

- Gezählt wird jeder Command-Record (ein Gruppenbefehl = 1, eine Shift-Queue mit k Aufträgen = k). Das Nachfüllen erfolgt pro Think anteilig.
- **Prioritätsklassen** im Emitter: P0 Notfall (Vogt-Rückzug, Platoon-Rückzug, Abstich) darf den Eimer um 5 überziehen · P1 Platoon-Befehle · P2 Bau- und Engineer-Aufträge · P3 Fabrik-Queues · P4 Kosmetik (Rally-Korrekturen). Was nicht passt, bleibt im Blackboard und wird im nächsten Think erneut bewertet.
- **Sparsamkeit:** Fabriken laufen mit Repeat-Schleifen (B3) und werden nur bei Mix-Wechsel umgestellt; die Vogt-Eröffnung geht als eine Shift-Queue raus; ein Platoon bekommt einen Gruppenbefehl (PLAN §3.8: ein Gruppenbefehl = eine Pfadanfrage). Dedup: Ein Command, der den bestehenden Auftrag einer Einheit nicht ändert, wird verworfen.

### 2.5 Determinismus der KI

Die KI darf Floats und eigenen RNG nutzen (PLAN §3.10), muss aber für denselben Seed im Browser und headless denselben Command-Strom liefern (MS9-Gate). Regeln für `packages/ai`:

- Nur IEEE-exakte Operationen (`+ − × ÷`, `Math.sqrt`, `Math.floor/ceil/round/min/max/abs`); **keine** `Math.sin/cos/exp/pow/log/hypot/atan2` (implementierungsabhängige Genauigkeit). Winkel über die LUTs aus `@faf/fixed` oder über Vektoren.
- RNG: eigener zustandsbehafteter xorshift32, Seed = `rng32(gameSeed, 0, army, 0x41490000)`; eine RNG-Instanz pro Manager, damit Budget-Abbrüche die Folge anderer Manager nicht verschieben.
- Sortierungen nur mit totalem Comparator (Tie-Break auf Einheiten-Handle bzw. Spot-Index). Iteration über `Map`/`Set` nur in Einfügereihenfolge, nie über Objekt-Schlüssel mit Zahlen-Semantik.
- Keine Wall-Clock-Abhängigkeit außer dem Notabbruch (§2.3).
- Float-Summen (Threat, Stärke) immer in fester Iterationsreihenfolge (Handle-Reihenfolge der Perception); Potenzen wie `0,95^s` nur aus LUTs, die einmal per Multiplikation erzeugt werden.
- Test: §9, `AI-DET-01`, `AI-DET-02` und `AI-DET-04`.

---

## 3. Kartenanalyse beim Start (`init`)

Beim `init(AiStatic, AiProfile)` berechnet die KI einmalig (Budget: eigener Init-Rahmen, ≤ 2 Mio. ops, im Ladebildschirm):

0. **Startpositionen** kommen aus dem Skirmish-Setup (A3). Wer wo startet, sieht auch der menschliche Spieler in der Lobby und im Ladebildschirm; das ist Setup-Wissen und kein Fog-Wissen. `AiStatic` braucht dafür `starts[]` und `armyStart[army]` (Schnittstellen-Ergänzung, §11). Zufallsspawns (A18, Post-MVP) liefern nur die Kandidatenliste. Dann rechnet die KI `d_enemy` gegen den nächsten unbesetzten Kandidaten, schickt den Funken der Reihe nach über die Kandidaten und rechnet die Zonen nach der ersten Sichtung neu.
1. **Passierbarkeit** aus `passLowRes` (2 WU; Land: Neigung ≤ 0,6, Wassertiefe ≤ 0,5 WU) und **Komponenten**. Spots außerhalb der Komponente des eigenen Starts sind `unreachable` (ohne Transporter bleiben sie im MVP unberührt).
2. **Pfad-Distanzfelder** `d_own` und `d_enemy` (Dijkstra über das 2-WU-Raster bzw. den Sektor-Graph) vom eigenen und vom (im 1v1 bekannten) gegnerischen Start.
3. **Zonen** je Spot über den Anteil `q = d_own / (d_own + d_enemy)`: `own` (q < 0,40), `contested` (0,40–0,60), `enemy` (> 0,60).
4. **Sammelpunkt (Rally):** Punkt auf dem kürzesten Pfad zum Gegner in 45 WU Pfad-Distanz. **Staging-Punkt:** Pfadpunkt bei q = 0,40 (Rand der eigenen Zone), dort sammeln sich Wellen vor dem Angriff.
5. **Engstellen:** entlang des Pfad-Korridors die Stelle mit minimaler passierbarer Breite (Sektor-Portale); Kandidat für Verteidigung und Artillerie (§5.7).
6. **Basis-Vorlage** (`ai-openings.json → baseTemplate`) wird in das Start-Koordinatensystem gedreht: `f` zeigt zum Gegner, `s` rechtwinklig. Jede Stelle prüft die Engine mit `rules.canPlace`; Ablehnungen plant der EngineerManager um (§5.3).

**Ergebnis für die MVP-Karten** (`python3 tools/ai-sim/ecosim.py --maps`, Army 0):

| | Setons (Army 0 SW-Mid ↔ Army 1 NO-Mid) | Hollow Ridge (512 WU) |
|---|---|---|
| Start → Gegner (Luftlinie / Pfad) | 458 / 463 WU | 453 / 570 WU (Umweg über den Kamm) |
| Rally → Gegner-Start (Pfad) | 418 WU | 525 WU |
| Mass-Spots `own` / `contested` / `enemy` / `unreachable` | 48 / 2 / 48 / 10 | 6 / 4 / 6 / 0 |
| Hydro `own` | 4 | 1 |
| max. T1-Einkommen der eigenen Zone | 97 M/s (1 + 48 × 2) | 13 M/s (1 + 6 × 2) |
| unerreichbar | 2 × 5 Insel-Mex (Klippenring, nur per Transporter) | – |
| umkämpft | Brückenzentrum (494 \| 534) q = 0,44 und (530 \| 490) q = 0,56 | (328 \| 128), (128 \| 328), (184 \| 384), (384 \| 184) |
| Engstelle | Landbrücke, engste Stelle ≈ 74 WU bei (0,49 \| 0,50) | Kamm-Durchlässe (aus Sektor-Portalen) |

**Mex-Reihenfolge nach Pfad-Distanz** (Army 0; Army 1 punktsymmetrisch):

| Rang | Setons: Spot (d_own WU) | Hollow Ridge: Spot (d_own WU) |
|---|---|---|
| 1–4 | Ring (338 \| 678), (354 \| 662), (370 \| 678), (354 \| 694) – je 16 | Ring (116 \| 100), (100 \| 116), (78 \| 106), (106 \| 78) – je 22 |
| 5 | (354 \| 728) – 50 | Hydro (200 \| 150) – 143 |
| 6 | (348 \| 626) – 54 | (112 \| 244) – 164 |
| 7 | (304 \| 692) – 56 | (128 \| 256) – 179 |
| 8 | (388 \| 632) – 60 | umkämpft (328 \| 128) – 245 |
| 9 | Hydro (302 \| 739) – 82 | umkämpft (128 \| 328) – 250 |
| 10–12 | (370 \| 562) – 123, (340 \| 796) – 124, (426 \| 564) – 144 | – |
| 13–18 | Beach-Gruppe (366 \| 841) … (366 \| 873) – 167–199, Beach-Hydro (333 \| 851) – 181 | – |
| danach | Rock-Gruppe (158 \| 646) … ab 209, Air-Gruppe (228 \| 898) … bis 381 | – |

Die tatsächliche Wahl pro Engineer nutzt den Score aus §5.1 (Weg vom Engineer plus halbe Basis-Distanz), deshalb weicht die Reihenfolge je Engineer leicht ab (Zuteilung in §4.5).

---

## 4. Eröffnungen (OpeningScript, A1)

### 4.1 Schema `faf-ai-openings/1`

| Pfad | Typ | Bedeutung |
|---|---|---|
| `schema`, `faction`, `language`, `sourceOfTruth` | string | Kennung, Fraktion, Sprache der Texte, Hinweis auf die Zahlenquelle |
| `assumptions` | object | Modellannahmen, die noch nicht im Roster stehen: `startStorage`, `warpInS`, `buildRangeWu` (je Kategorie-Ausdruck), `rollOffS`, `passability`, `straightLineDetour`, `platoonSpeedFactor` |
| `roles` | {rolle: Kategorie-Ausdruck} | Rolle → Blueprint: Ausdruck ∧ `TECH<n>`, Upgrade-Stufen nur wenn sonst nichts passt; muss genau einen Treffer liefern (Compiler-Check) |
| `sites` | {selector: Text} | Dokumentation der Standort-Selektoren (§4.2) |
| `baseTemplate.slots` | {name: {f, s, footprint}} | Bauplätze relativ zum Start (f zum Gegner, s rechtwinklig, WU) |
| `difficultyTiming` | {easy\|normal\|hard: {stepDelayS, skipChance, techDelayS, engineerCapFactor, waveExtra}} | Eröffnungs-Handicaps je Schwierigkeit (§6) |
| `openings[]` | array | die Eröffnungen |
| `openings[].id`, `name{de,en}`, `fromMs`, `intent` | | Kennung, Anzeigename, erster Meilenstein, Absicht |
| `openings[].weights.maps` | {Kartenklasse: Gewicht} | `setons`, `size512` (weitere Klassen: `size256`, `size1024`, `water`) |
| `openings[].weights.difficulty` | {easy, normal, hard} | Auswahlgewicht je Schwierigkeit (0 = nie) |
| `openings[].acu` | Schritt[] | Queue des Vogts |
| `openings[].factories` | {slot: Schritt[]} | Queue je Fabrik, benannt nach dem Bauplatz (`fac1`, `fac2`, `fac_air`) |
| `openings[].engineers` | Schritt[][] | Plan je Engineer in Spawn-Reihenfolge (Engineer 1, 2, …); spätere Engineers führt der EngineerManager |
| `openings[].followUp` | object | Startparameter der Manager nach dem Handoff: `engineers` (Sollzahl), `estore`, `energy`, `extraFactory`, `techT2`, `mexUpgrade`, `waves` |
| `openings[].expect` | {karte: Kennzahlen} | Soll-Werte aus `ecosim.py --write-expect` (Normal): Zeiten in s `fac1`, `eng1`, `eng4`, `mex4`, `mex8`, `firstCombat`, `airFac`, `firstBomber`, `wave1Depart`, `wave1Arrive`, `techStart`, `techT2`; Anteile in % `stallE`, `engIdle`; `massInc` (M/s) und `mexAt` (Anzahl) nach 180/300/480/720 s. `--check` erlaubt ±5 s, ±1 %-Punkt, ±0,6 M/s, ±1 Stück |

**Schritte:**

| `do` | Felder | Wirkung |
|---|---|---|
| `build` | `role`, `tech`, `at`, `count?`, `fallback?` | Bauauftrag; `count` expandiert zu n Einzelaufträgen, deren Standort erst beim Start des Auftrags gewählt wird. `fallback` ersetzt den Schritt, wenn die Rolle oder der Standort nicht verfügbar ist (z. B. kein Hydro erreichbar → 4 Glutkessel) |
| `produce` | `role`, `tech`, `count?` | Fabrik-Auftrag (einmalig) |
| `loop` | `items[{role, tech}]` | Repeat-Schleife der Fabrik; `tech` ist die Mindeststufe, die Fabrik baut die höchste verfügbare Stufe der Rolle |
| `rally` | `at` | Sammelpunkt der Fabrik |
| `assist` | `target` | Guard/Assist (z. B. `fac1`, `upgrade:fac1`) |

**`followUp`-Felder:** `engineers {base, perFreeSpots, cap[[t, n]]}` → Sollzahl = min(cap(t) × `engineerCapFactor`, base + ⌈freie Spots / perFreeSpots⌉); `estore {atS}`; `energy {horizonS, reserveE, maxInflight}`; `extraFactory {role, slots, massStoreFrac, forS, minS}`; `techT2 {minS, minMassIncome, minEnergySurplus, assistEngineers, acuAssist, t2Engineers?}`; `mexUpgrade {minS, minMassIncome, saturatedS, maxParallel, assistEngineers, order}` (`saturatedS`: frühester Start bei voller eigener Zone, §5.1); `waves {first, grow, maxS, airFirst?}` (`maxS` ≤ 450 s, damit der Pflichtangriff das 8-min-Gate mit Reserve trifft; `--check` prüft das).

### 4.2 Standort-Selektoren und Reservierung

| Selektor | Auflösung |
|---|---|
| `slot:<name>` | fester Platz aus `baseTemplate`; weitere Fabrikplätze `fac4…` erzeugt die KI hinter der Basis im 13-WU-Raster |
| `near:<slot>` | Platz, dessen Footprint an `<slot>` grenzt (Adjacency), im Uhrzeigersinn ab `+f` |
| `slot:eco` | Kraftwerks-Ring zwischen den Ring-Mex (r = 12 WU, 4 Plätze je Umlauf, dann r + 6) – kurze Wege für den Vogt |
| `kranz` | freie Seite am Glutspeicher (bis 4 Glutkessel I mit +25 % Adjacency) |
| `ring` | Mass-Spot mit `d_own ≤ 40 WU` |
| `mex:next` / `hydro:next` | freie, erreichbare Spots der eigenen Zone (umkämpfte erst ab 6:00 oder T2), minimaler Score nach §5.1 |

- **Reservierung beim Start:** Das OpeningScript reserviert sofort so viele Ring-Spots, wie die Vogt-Queue `ring`-Schritte hat. Engineers wählen daher von Anfang an die Außen-Spots, und der Vogt läuft nicht ins Leere.
- **Spot-Reservierung** gilt ab Auftragsvergabe und endet mit Fertigstellung, Tod des Bauers oder Abbruch (Spot kehrt mit 30 s Sperre zurück, wenn dort Feindkontakt war).

### 4.3 Ausführung, Handoff, Abbruch

- Das OpeningScript gibt die Vogt-Queue als eine Shift-Queue aus (nur Standorte, die schon feststehen; `mex:next` wird beim Erreichen des Schritts nachgereicht) und jede Fabrik-Queue als Queue + Repeat-Schleife.
- **Handoff:** Ein Bauer geht an den EngineerManager, sobald seine Liste leer ist; die Fabrik an den FactoryManager, sobald ihre `loop` läuft und die erste Mix-Anpassung ansteht (spätestens 5:00). Der EconomyManager läuft von Anfang an mit, bestellt während der Eröffnung aber nur über das Task-Board (Engineers) und greift in die Vogt-Queue nur im **Energie-Notfall** ein (Speicher läuft in ≤ 10 s leer).
- **Lokale Abwehr (Eröffnung pausiert, wird nicht verworfen):** Ein feindliches Kampfobjekt im Basisradius (60 WU) oder Schaden am Vogt. Der Vogt bekämpft es innerhalb seiner Leine (§5.5), wenn R_lokal inklusive Vogt ≥ 1,0, und die nächste Fabrik-Schleife zieht eine Punze bzw. einen Stichel vor. Nach 15 s ohne Kontakt läuft die Eröffnung an derselben Stelle weiter. Einen einzelnen Funken jagt die nächste Kampfeinheit, der Vogt nur, wenn er in 25 WU um seine Baustelle steht.
- **Abbruch → Verteidigungsmodus (Eröffnung verworfen):** vor 5:00 feindlicher Boden-Threat in der eigenen Zone ≥ max(160, 0,5 × eigener mobiler Boden-Threat ohne Vogt) über 5 s (160 ≈ 4 Stichel oder 2 Punzen), oder ≥ 2 eigene Strukturen in 30 s verloren, oder Vogt-HP < 80 %. Dann: Fabriken auf Punze/Stichel, Vogt verteidigt in Reichweite der Fabrik, erste Riegel I am bedrohten Ring-Mex (DefenseManager), Rest der Eröffnung wird verworfen. (Review R-05: Vorher reichten ein einzelner Stichel mit Threat 40 oder ein Kratzer am Vogt, um die ganze Eröffnung zu verwerfen. Das war ein billiger Exploit.)
- **Umschalten nach Scout:** Sieht der Funke bei seiner ersten Sichtung der Gegnerbasis (Setons ≈ 2:46, Hollow Ridge ≈ 3:10, spätestens 4:00) ≥ 2 feindliche Landwerke oder ≥ 6 feindliche Kampfeinheiten, wechselt eine laufende `tech_greed` ab dem aktuellen Schritt auf den Plan von `eco_standard` (mehr Einheiten, Tech +120 s). Die frühere Frist „bis 3:00“ war auf Hollow Ridge nicht erreichbar, weil der Funke erst um 3:10 ankommt.

### 4.4 Die Eröffnungen

**Auswahl:** Gewicht = `weights.maps[Kartenklasse] × weights.difficulty[Stufe]`, gezogen mit dem KI-RNG (§2.5). Ergebnis (normiert):

| Eröffnung | ab | Setons Easy / Normal / Hard | 512 WU Easy / Normal / Hard |
|---|---|---|---|
| `eco_standard` Standard-Eco | MS9 | 100 % / 50,0 % / 39,8 % | 100 % / 52,9 % / 41,9 % |
| `land_rush` Land-Rush | MS9 | – / 16,7 % / 20,5 % | – / 29,4 % / 35,9 % |
| `tech_greed` Tech/Eco-Greed | MS9 | – / 33,3 % / 28,4 % | – / 17,6 % / 15,0 % |
| `air_opener` Luft-Eröffnung | MS12 | – / – / 11,4 % | – / – / 7,2 % |

(Vor MS12 fällt `air_opener` weg und Hard wird neu normiert: Setons 44,9 / 23,1 / 32,1 %, 512 WU 45,2 / 38,7 / 16,1 %.)

**`eco_standard` – Standard-Eco.** Sichere Allround-Eröffnung, gut gegen alles außer extremem Rush.

| Wer | Schritte |
|---|---|
| Vogt | Landwerk I @fac1 → 2× Glutkessel I an fac1 → 2× Zapfstelle I (Ring) → Glutkessel I (eco) → 2× Zapfstelle I (Ring) → 2× Glutkessel I (eco) → Handoff |
| fac1 | Rally → 2× Lehrling → Funke → 2× Lehrling → Schleife Punze, Punze, Kelle, Punze, Stichel |
| Engineer 1 / 2 / 4 | je 3× Zapfstelle I `mex:next` |
| Engineer 3 | Dampfquelle `hydro:next` (sonst 4× Glutkessel I) → 1× Zapfstelle I |
| danach | Engineers bis min(4→6→8→10 nach 0/4/7/10 min, 2 + ⌈freie Spots/3⌉); Glutspeicher ab 4:00; Zusatz-Fabriken ab 3:00 bei Mass-Überschuss; T2 ab 6:30 bei ≥ 14 M/s; Mex-Upgrades ab 7:30, bei voller eigener Zone ab 4:00; erste Welle 8 Einheiten, dann +4, Pflichtangriff 7:00 |

**`land_rush` – Land-Rush.** Zweites Landwerk ≈ 2:50 (Setons) bzw. 3:15 (512 WU), früher Druck über die Brücke; Tech spät.

| Wer | Schritte |
|---|---|
| Vogt | Landwerk I @fac1 → 2× Glutkessel I an fac1 → 2× Zapfstelle I (Ring) → Glutkessel I (eco) → Landwerk I @fac2 → 2× Glutkessel I an fac2 → 2× Zapfstelle I (Ring) → 2× Glutkessel I (eco) |
| fac1 | Rally → 2× Lehrling → Schleife Stichel, Punze, Stichel, Punze |
| fac2 | Rally → 1× Lehrling → Schleife Punze, Stichel, Punze, Kelle |
| Engineer 1 | 2× Zapfstelle I → 1× Glutkessel I |
| Engineer 2 | 3× Zapfstelle I |
| Engineer 3 | 2× Glutkessel I → 2× Zapfstelle I |
| danach | Engineers bis 3→5→7; T2 ab 8:00 (im Review von 9:00 vorgezogen, sonst nur 1:23 Reserve zum 12-min-Gate auf 512 WU); Mex-Upgrades ab 10:00, bei voller eigener Zone ab 6:00; erste Welle 6, dann +3, Pflichtangriff 5:00 |

**`tech_greed` – Tech/Eco-Greed.** Maximale Expansion, Glutkranz, frühes Landwerk II mit Vollassist. Schwach gegen frühen Rush (Scout-Umschaltung §4.3).

| Wer | Schritte |
|---|---|
| Vogt | Landwerk I @fac1 → 2× Glutkessel I an fac1 → 2× Zapfstelle I (Ring) → 2× Glutkessel I (eco) → 2× Zapfstelle I (Ring) → Glutspeicher → 4× Glutkessel I (Kranz, +25 %) |
| fac1 | Rally → 3× Lehrling → Funke → 3× Lehrling → Schleife Punze, Kelle, Punze |
| Engineer 1, 2, 4 | je 4× Zapfstelle I |
| Engineer 3 | Dampfquelle (sonst 4× Glutkessel I) → 2× Zapfstelle I |
| Engineer 5, 6 | je 3× Zapfstelle I |
| danach | Engineers bis 6→8→11→12; T2 ab 5:30 bei ≥ 13 M/s mit 4 Engineers + Vogt; bis 2 Mex-Upgrades parallel ab 6:00, bei voller eigener Zone ab 3:30; Zusatz-Fabriken ab 4:00; erste Welle 10, dann +5, Pflichtangriff 7:30 |

Im Review wurden die zwei Glutkessel (eco) vor die Ring-Mex 3 und 4 gezogen. Sechs Engineers bauen gleichzeitig Zapfstellen (je 30 E/s), und mit der alten Reihenfolge lag Setons von 2:24 bis 2:42 im Energie-Engpass. Jetzt ist er 0 %.

**`air_opener` – Luft-Eröffnung (ab MS12).** Landwerk für Engineers und Grundschutz, Luftwerk als zweite Fabrik; energie-lastig.

| Wer | Schritte |
|---|---|
| Vogt | Landwerk I @fac1 → 2× Glutkessel I an fac1 → 2× Zapfstelle I (Ring) → 2× Glutkessel I (eco) → Luftwerk I @fac_air → 3× Glutkessel I an fac_air → 2× Zapfstelle I (Ring) → 2× Glutkessel I an fac_air |
| fac1 | Rally → 3× Lehrling → Schleife Punze, Punze, Kelle |
| fac_air | Lerche → Schleife Dohle, Dohle, Turmfalke |
| Engineer 1 / 3 | je 3× Zapfstelle I |
| Engineer 2 | Dampfquelle (sonst 4× Glutkessel I) → 1× Zapfstelle I |
| danach | T2 ab 7:30; Mex-Upgrades ab 8:30, bei voller eigener Zone ab 5:00; Dohlen jagen Engineers und Außen-Mex (§5.4 Air-Lite); Pflichtangriff der Landwelle 7:30 |

### 4.5 Timings aus der Eco-Simulation

Rechnung: `tools/ai-sim/ecosim.py` (Normal, ohne Gegnerdruck, 12 min). Modell siehe §10. Zeiten m:ss; „Welle ab/an“ = Angriffsbefehl / Ankunft am Gegner-Start (Tempo der langsamsten Einheit × 0,85); „M/s“ = Mass-Einkommen nach 3/5/8/12 min; „E-Stall“ = Anteil der Ticks mit Energie-Ratio < 1; „M-BP-Stall“ = durch Mass-Mangel ungenutzte Build Power; „Overfl.“ = verfallene Mass in % des Einkommens; „Eng. idle“ = Engineer-Zeit ohne Auftrag oder am Guard einer Fabrik ohne Auftrag (Definition §5.3). Stand nach dem Review (§12): Zahlen mit Sättigungsregel, „Energie zuerst“, Bau-Assist und korrigierter Fabrik-Queue.

| Eröffnung | Karte | Fabrik | Eng1 | Eng4 | Mex4 | Mex8 | 1. Kampf | Welle1 ab/an | T2 Start/fertig | M/s 3/5/8/12 | Mex 5/12 min | E-Stall | M-BP-Stall | Overfl. | Eng. idle |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| eco_standard | Setons | 0:32 | 0:47 | 1:29 | 1:35 | 2:17 | 1:44 | 3:12 / 6:14 | 6:30 / 7:46 | 19/29/61/131 | 14/49 | 1,1 % | 0,0 % | 7,5 % | 0,0 % |
| eco_standard | Hollow Ridge | 0:32 | 0:47 | 1:29 | 2:10 | 8:32 | 1:44 | 3:00 / 6:49 | 6:30 / 8:30 | 13/13/21/41 | 6/10 | 0,0 % | 16,0 % | 0,0 % | 0,1 % |
| land_rush | Setons | 0:32 | 0:47 | 3:06 | 1:38 | 3:48 | 1:19 | 2:40 / 5:09 | 8:00 / 9:23 | 13/23/35/89 | 11/38 | 0,0 % | 2,5 % | 4,5 % | 0,0 % |
| land_rush | Hollow Ridge | 0:32 | 0:47 | 3:39 | 3:07 | 8:52 | 1:19 | 3:20 / 6:27 | 8:00 / 10:03 | 7/13/13/27 | 6/9 | 0,0 % | 37,5 % | 0,0 % | 0,1 % |
| tech_greed | Setons | 0:32 | 0:47 | 1:29 | 1:35 | 2:28 | 2:10 | 4:12 / 7:14 | 5:30 / 6:32 | 19/43/59/129 | 21/44 | 0,0 % | 0,8 % | 13,1 % | 0,0 % |
| tech_greed | Hollow Ridge | 0:32 | 0:47 | 1:29 | 2:42 | 10:36 | 2:49 | 5:10 / 8:59 | 5:30 / 8:14 | 13/13/21/45 | 6/10 | 0,0 % | 48,4 % | 0,0 % | 0,2 % |
| air_opener | Setons | 0:32 | 0:47 | 4:22 | 1:48 | 4:17 | 1:28 | 3:25 / 6:27 | 7:30 / 8:39 | 11/23/39/109 | 11/44 | 0,4 % | 1,7 % | 9,6 % | 0,0 % |
| air_opener | Hollow Ridge | 0:32 | 0:47 | 4:40 | 3:07 | 8:48 | 1:28 | 4:21 / 8:09 | 7:30 / 9:43 | 7/13/17/33 | 6/10 | 0,0 % | 34,5 % | 0,0 % | 0,1 % |

Luft (`air_opener`): Luftwerk fertig 2:48 (Setons) / 3:08 (Hollow Ridge), erste Dohle 3:37 / 4:09.

**Easy** (`--difficulty easy`, nur `eco_standard` wird gewählt): Setons Mex8 2:26, erste Welle (12) 3:42 / 6:44, T2 9:00 / 10:17, 11 Mex nach 5 min, 47 nach 12 min; Hollow Ridge T2 9:00 / 10:39. Easy verliert seine Eco vor allem über Denkpausen und den späteren Tech, nicht über weniger Spots. **Hard** entspricht in der Eco Normal (Unterschiede in §6 liegen in Reaktion, Micro, Planung).

**Was steht wann – Beispiel `eco_standard` auf Setons** (Fertigstellungen):
0:32 Landwerk I · 0:44 Glutkessel I · 0:47 Lehrling 1 · 0:57 Glutkessel I · 1:00 Lehrling 2 · 1:03 Funke · 1:13 Zapfstelle (Ring 1) · 1:16 Lehrling 3 · 1:28 Zapfstelle (Ring 2) · 1:29 Lehrling 4 · 1:47 Glutkessel I · 1:53/2:08 Zapfstelle (Ring 3/4) · 2:22–2:57 drei Glutkessel I · 3:12 erste Welle (8) · 4:00 Landwerk I (fac2) · 4:29 Glutspeicher · 5:26/6:30/6:33 drei weitere Landwerke I · 6:30 Start Landwerk II (Vogt + 3 Engineers assistieren) · 7:46 Landwerk II fertig. (Vor dem Review stand hier „0:50 Funke“: Das Skript hatte `count` in Fabrik-Queues ignoriert, der Funke kam dadurch vor Lehrling 2.)

**Mex-Zuteilung `eco_standard` Setons** (Baubeginn):

| Bauer | Aufträge |
|---|---|
| Vogt | Ring (338 \| 678) 0:58, (354 \| 662) 1:13, (370 \| 678) 1:48, (354 \| 694) 1:54 |
| Lehrling 1 | (348 \| 626) 0:47, (304 \| 692) 1:22, (366 \| 841) 2:17 |
| Lehrling 2 | (388 \| 632) 1:00, (370 \| 562) 1:35, (426 \| 564) 2:27 |
| Lehrling 3 | Hydro (302 \| 739) 1:16, danach (306 \| 850) 3:27 |
| Lehrling 4 | (354 \| 728) 1:29, (340 \| 796) 2:12, (350 \| 857) 3:01 |

Auf Hollow Ridge nimmt der Vogt die vier Ring-Mex (0:58–1:43), Lehrling 1 und 2 laufen 164 bzw. 179 WU zu (112 \| 244) und (128 \| 256), Lehrling 3 baut die Dampfquelle (200 \| 150). Ab 2:41 ist die eigene Zone voll. Seit dem Review beginnt die KI dann um 4:00 mit dem ersten Mex-Upgrade am Ring (Sättigungsregel §5.1). Vorher lag das Einkommen von 2:40 bis 8:45 flach bei 13 M/s. Die vier umkämpften Spots nimmt die KI ab 6:00 bzw. mit T2 unter Platoon-Deckung.

**Bewertung gegen die Gates:** Alle Eröffnungen erreichen T2 ≤ 12:00 (MS9 fordert ≥ 90 % der Spiele; Reserve 1:57–5:28 für Gegnerdruck) und starten die erste Welle ≤ 8:00 (spätestens 5:10; ohne volle Welle greift der Pflichtangriff bei `waves.maxS` ≤ 7:30). Der Energie-Stall bleibt ≤ 1,1 % (MS10-Gate ≤ 5 %). Auf 512-WU-Karten ist die Build Power absichtlich größer als das Einkommen (M-BP-Stall 16–48 %): Mass geht nie verloren, Engineers assistieren; die Engineer-Sollzahl sinkt dort über `perFreeSpots` automatisch. Auf Setons verfallen ohne Gegner 4–13 % der Mass (Overflow), weil 40+ Spots schneller Einkommen bringen, als Fabriken an der Basis entstehen. Das bleibt als Bericht-Kennzahl stehen (§11).

### 4.6 Grenzen des Modells

- Kein Gegner, kein Kampf, keine Verluste: Einkommen und Mex-Zahlen nach 8–12 min sind **Obergrenzen**. Im Turnier liegen sie typischerweise deutlich darunter; die Gates in §7 messen das echte Spiel.
- Laufwege: Pfad-Distanz ab Start, zwischen Baustellen Luftlinie × 1,1 (Umweg-Median der Karten); keine Staus, kein Roll-off-Stau, Baureichweite Vogt 10 WU / Lehrling 6 WU (Annahme, §11).
- Adjacency nur für den Glutkranz (+25 %); Fabrik-Adjacency (≤ 2 %) und Speicher-Adjacency fehlen.
- Voller Startspeicher (650 M / 3.900 E), kein Warp-in. Ändert MS4 das, verschieben sich alle frühen Zeiten; `--check` schlägt dann an.
- Umkämpfte Spots nimmt das Skript ab 6:00 ohne Platoon-Deckung; im Spiel gibt es sie nur unter Deckung (§5.1). Die 512-WU-Werte ab 6:00 sind deshalb optimistisch.
- Das Ergebnis reagiert empfindlich auf Kleinigkeiten (Reihenfolge von Board-Aufträgen, eine Sekunde Laufweg). `--timeline` gibt deshalb die Energie-Engpass-Fenster mit aus: Ein Engpass in einem kurzen Fenster ist harmlos, einer, der bis zum Ende läuft, ein Regelfehler.

---

## 5. Manager

Bezeichnungen: `P_M`, `P_E` Einkommen (M/s, E/s), `U_E` Unterhalt (E/s), `S_M`, `S_E` Speicherstand, `C_M`, `C_E` Speichergröße, `D_E` voller Energiebedarf aller laufenden Baustellen (E/s bei Ratio 1), `r_M` aktuelle Mass-Ratio.

### 5.1 EconomyManager (1 Hz; A1 MS9, A9 MS10)

**Energie-Bilanz** (jede Sekunde):

```text
D_eff    = D_E · r_M                       # Energiebedarf, wie ihn die Mass-Lage tatsächlich zulässt
flowDef  = 1,1 · (D_eff + R_E) − (P_E − U_E) − max(0, S_E − reserveE) / 60
storeDef = (reserveE − (S_E + (P_E − U_E − D_eff − R_E) · horizonS)) / horizonS
deficit  = max(flowDef, storeDef)          # E/s
wenn deficit > 0:
    wenn T2-Engineer vorhanden und deficit ≥ 150: 1× Glutkessel II (500 E/s), sofern keiner im Bau
    sonst: n = ceil(deficit / 20) − laufendeKraftwerke, höchstens maxInflight + floor((P_E − U_E) / 100)
           → n× Glutkessel I aufs Task-Board (Prio 90), Platz: Kranz → eco-Ring → an Fabriken
R_E zerfällt je Sekunde um 10 %
```

- `R_E` ist die **Energie-Reservierung** beschlossener Mass-Senken (unten), damit Kraftwerke vor dem Verbraucher entstehen.
- `horizonS`: Normal der Wert der Eröffnung (25–40 s, PLAN „Stall-Prognose über 30 s“), Easy 10 s, Hard 60 s (Planungstiefe §6). `reserveE`, `maxInflight` je Eröffnung.
- **Dampfquellen** (100 E/s für 160 M) haben Vorrang vor Glutkesseln, sobald ein Engineer in ≤ 120 WU steht; die Eröffnungen schicken Engineer 3 direkt hin.
- **Glutkranz:** ein Glutspeicher (Pflicht für den Abstich, der ≥ 7.500 E Vorrat braucht) bis `estore.atS`, danach die nächsten 4 Glutkessel I an seine Seiten (+25 % je Kessel).
- **Notfall:** läuft `S_E` in ≤ 10 s leer, kommt das älteste unvergebene Kraftwerk vorn in die Vogt-Queue; ab MS10 (E13) pausiert die KI zusätzlich Wachstumsbaustellen (Mex-/Fabrik-Upgrades), nie Kraftwerke oder Verteidigung, und schaltet Radar ab (C17).

**Mass-Senken** (jede Sekunde): Steht `S_M / C_M ≥ massStoreFrac` (0,5–0,6) ununterbrochen `forS` (20–30 s) lang, verteilt die KI den gemessenen Überschuss `ΔM = Ø(P_M − Verbrauch)` der letzten `forS` Sekunden, bis er gedeckt ist (höchstens 4 Maßnahmen je Sekunde). Beschlossene, aber noch nicht begonnene Senken (Fabrik-Aufträge auf dem Board, je 3,7 M/s) zieht sie vorher ab, sonst bestellt sie im nächsten Takt dieselbe Lücke noch einmal (Review R-03):

| Reihenfolge | Maßnahme | Bedingung | Senke (M/s) | Energie-Reservierung (E/s) |
|---|---|---|---|---|
| 1 | Mex-Upgrade T1→T2 (nächster Mex zur Basis zuerst) | t ≥ `mexUpgrade.minS`, T2 erreicht oder Sättigung (s. u.); laufend < 1 + ⌊P_M / 15⌋; `E_frei` ≥ 60 | 10 (900 M / 90 s) | 60 |
| 2 | Zusatz-Landwerk (Plätze `extraFactory.slots`, dann Raster) | Fabriken < 1 + ⌊P_M / 6⌋ | 3,7 (Punze-Schleife) | 19 |
| 3 | weiteres Landwerk I → II | T2 erreicht | 12,2 (1.400 M / 115 s) | 96 |
| 4 | +1 Engineer (höchstens +6 über der Sollzahl) | – | 3 | 25 |

Reicht das nicht, verfällt Mass (Kennzahl „Overflow“); mehr Engineers würden nur APM kosten.

**Energie zuerst (Review R-02):** Senken, die sofort Energie ziehen (Mex- und Fabrik-Upgrades), starten nur, wenn

```text
E_frei = (P_E − U_E − D_eff) + max(0, S_E − reserveE) / 90 − R_E  ≥  Energie-Reservierung der Maßnahme
```

Sonst bucht die KI nur die Reservierung (die Energie-Bilanz bestellt daraufhin Kraftwerke), bricht die Verteilung für diesen Takt ab und prüft im nächsten erneut. Der Speicher zählt auf 90 s verteilt, weil ein Mex-Upgrade 90 s läuft. Vorher startete die Rechnung auf Setons um 10:50 fünf Mex-Upgrades gleichzeitig (300 E/s), der 10.000-E-Speicher war nach 40 s leer, und der Energie-Engpass hielt bis Spielende an (4 % statt 1 %). Das ist der klassische FA-Fehler „erst upgraden, dann Kraftwerke“.

**Bau-Assist bei Überschuss (Review R-04):** Freie Engineers ohne Board-Aufgabe assistieren bei `S_M / C_M ≥ 0,3` zuerst laufende große Baustellen (≥ 150 Mass, ≤ 80 WU von der Basis, höchstens 4 Bauer je Baustelle), bevor sie eine Fabrik bewachen (Task-Board Prio 12, §5.3). Das beschleunigt genau die Senken, die gerade Mass binden sollen.

**Mex-Expansion:** Sollzahl Engineers = min(`cap(t)` × `engineerCapFactor`, `base` + ⌈freie Spots der eigenen und umkämpften Zone / `perFreeSpots`⌉) + Bonus aus der Mass-Senke. Spot-Score für einen Engineer:

```text
score(spot) = d(eng, spot) + 0,5 · d_own(spot) + 200 · min(1, T_surface(zelle) / 100) + 400 · [zone = contested ∧ keine Deckung]
Spots mit T_surface(zelle) > 150 ohne eigene Deckung sind gesperrt; kleinster Score gewinnt, Gleichstand → Spot-Index
```

`T_surface` ist der Boden-Threat der Zelle (§5.6; vor MS11 lokale Schätzung aus sichtbaren Feinden in 40 WU). Umkämpfte Spots (Setons: Brückenzentrum) gibt es erst ab 6:00 oder T2 und nur, wenn ein Platoon den Staging-Punkt hält.

**Sättigung (Review R-01):** Ist kein freier Spot der Zone `own` mehr übrig und t ≥ `mexUpgrade.saturatedS` (3:30–6:00 je Eröffnung), beginnen Mex-Upgrades unabhängig von `minS` und auch während des Tech-Upgrades, dann aber höchstens eines parallel. So spielen FA-Spieler 10-km-Karten: Die wenigen Spots werden ab etwa 4 min aufgerüstet, statt mit flachem Einkommen auf T2 zu warten. Wirkung auf Hollow Ridge (`eco_standard`): Einkommen nach 12 min 25 → 41 M/s, T2 8:44 → 8:30. Die Regel greift nur auf Karten, deren eigene Zone früh voll ist; auf Setons (48 eigene Spots) ändert sie nichts.

**Mex-Upgrades (A9, B4):** Amortisation T1→T2 = 900 M / 4 M/s = 225 s (inkl. 7 E/s Mehrbedarf ≈ 232 s), T2→T3 = 4.500 M / 12 M/s = 375 s (≈ 389 s). Die KI rüstet nur auf, wenn die erwartete Lebensdauer die Amortisation übersteigt:

```text
lebensdauer(mex) = 900 s        wenn zone = own und T_surface(zelle) = 0 in den letzten 120 s
                 = 300 s        wenn zone = own und Kontakt in den letzten 120 s
                 = 0            wenn zone = contested
upgrade, wenn lebensdauer > amortisation · 1,2  und  E_frei ≥ 60          # „Energie zuerst“, s. o.
Reihenfolge: kleinstes d_own zuerst; parallel: maxParallel (Eröffnung) bzw. Mass-Senken-Regel, während des Tech-Upgrades 1 (nur bei Sättigung)
Assist: mexUpgrade.assistEngineers (1) aus der Basis
```

**Speicher-Adjacency (ab MS10, E10/E11):** vier Erzspeicher um einen T2-Mex, sobald `P_M ≥ 30` (200 M für +0,75 M/s ⇒ 267 s Amortisation); um T3-Mex immer (89 s). Zapfstellen neben Fabriken (−7,5 % Mass-Verbrauch) ergeben sich aus der Basis-Vorlage (fac2 grenzt an einen Ring-Mex).

### 5.2 TechManager (1 Hz; A1, T3-Lite MS13)

| Schritt | Auslöser | Aktion |
|---|---|---|
| T1 → T2 | t ≥ `techT2.minS` (+ `techDelayS`), `P_M ≥ min(minMassIncome, 0,8 · max. T1-Einkommen der eigenen Zone)`, Energie-Überschuss ≥ `minEnergySurplus` oder `S_E ≥ 2.000` | Landwerk mit dem kleinsten Abstand zur Basis rüstet auf (1.400 M, 11.000 E, 115 s mit BP 20); `assistEngineers` Engineers + Vogt (falls `acuAssist` und kein Feind im Basisradius) assistieren; Mex-Upgrades warten bis zum Abschluss, außer bei Sättigung (§5.1, dann höchstens 1) |
| nach T2 | Landwerk II fertig | zuerst `t2Engineers` (2) Gesellen, dann T2-Mix (§5.4); Glutkessel II über die Energie-Bilanz; weitere Landwerke per Mass-Senke; Riegel II/Rost II über den DefenseManager |
| Luft T2 (MS12) | Luftanteil im Mix > 0 und Landwerk II steht | Luftwerk I → II (920 M, 17.500 E) |
| T2 → T3 (MS13) | T2 seit ≥ 300 s, `P_M ≥ 60` (≈ 6 T2-Mex), `P_E − U_E ≥ 1.500` | Landwerk II → III (5.200 M, 47.000 E, 300 s mit BP 40; mit 4 Gesellen + Vogt ≈ 130 s); danach 2 Meister, Zapfstelle III am Ring, Glutkessel III, T3-Mix |
| T3-Artillerie (MS13) | T3 erreicht und Stellungskrieg (lokales Verhältnis an der Front 0,8–1,2 über 180 s) | Pfannen in jeden Angriffs-Platoon (≥ 15 %); Hochofen nur bei `P_M ≥ 150` und Ziel in Reichweite 200 WU |

Die simulierten T2-Zeiten (§4.5) liegen bei 6:32–10:03 (Easy bis 10:39); das MS9-Gate (≤ 12 min in ≥ 90 %) lässt damit Reserve für Gegnerdruck.

### 5.3 EngineerManager (2 Hz)

**Task-Board:** Manager legen Aufgaben ab, der EngineerManager verteilt sie an freie Bauer. Eine Aufgabe trägt Rolle, Tech, Standort-Selektor, Priorität, Sollbesetzung und Alter.

| Prio | Aufgabe | Quelle | Sollbesetzung |
|---|---|---|---|
| 100 | Kraftwerk bei Energie-Notfall | Economy | 1 (Vogt vorn in der Queue) |
| 95 | Verteidigung an bedrohtem Cluster | Defense | 1–2 |
| 90 | Kraftwerk (Bilanz) | Economy | 1; Glutkessel II: 3 |
| 80 | Tech-Upgrade-Assist | Tech | `techT2.assistEngineers` + Vogt |
| 70 | Glutspeicher / Glutkranz | Economy | 1 |
| 60 | Zusatz-Fabrik | Economy | 1 |
| 50 | Mex-Expansion (Score §5.1) | Economy | 1 je Spot |
| 45 | Dampfquelle | Economy | 1 |
| 40 | Mex-Upgrade-Assist | Economy | `mexUpgrade.assistEngineers` |
| 30 | Reparatur eigener Gebäude < 70 % HP ohne Feind in 30 WU | Engineer | 1 |
| 20 | Reclaim: Wracks ≥ 50 Mass in ≤ 40 WU vom Bauer (ab MS11 per Patrol, C12) | Engineer | – |
| 12 | Bau-Assist bei Mass-Überschuss: große Baustelle (≥ 150 Mass) in ≤ 80 WU, `S_M / C_M ≥ 0,3` (§5.1) | Economy | bis 4 Bauer je Baustelle |
| 10 | Fabrik-Guard (Assist, alle 10 s neu bewerten) | Default | beliebig |

- **Zuteilung:** Aufgaben an der Basis gehen nur an Bauer in ≤ 80 WU; ist eine Aufgabe ≥ 20 s alt, an den nächsten freien Bauer beliebiger Entfernung. Kosten = Laufzeit + Restzeit des aktuellen Auftrags; T2/T3-Aufgaben nur an Bauer passender Tech (`buildableBy`). Ein Engineer, der eine Expansion abschließt, bekommt zuerst die nächste Expansion in seiner Nähe (Score), damit Engineers draußen bleiben.
- **Platzierung:** Kandidat aus Selektor → `canPlace`. Bei Ablehnung Spiralsuche um den Kandidaten (Radius ≤ 12 WU, 2-WU-Schritte, höchstens 24 Kandidaten zu je 4 + Footprint-Zellen/4 ops, also ≈ 120 ops für ein Kraftwerk und ≈ 480 ops für eine Fabrik), danach nächster Vorlagenplatz.
- **Kein Fog-Wissen beim Platzieren (Review R-08):** `canPlace` und `freeMassSpots()` der PerceptionView prüfen Gelände, eigene Objekte und **bekannte** feindliche Strukturen (sichtbar oder Ghost), nie die Belegung der Sim. Sonst verriete ein abgelehnter Platz eine feindliche Zapfstelle im Fog. Ein verdeckt besetzter Spot fällt erst auf, wenn der Engineer ihn sieht; dann wird er Ghost, und die KI plant um wie ein Spieler (Test `AI-PERC-02`). Drei Fehlschläge an einem Platz sperren ihn 60 s. Lehnt die Sim den Command ab (Konflikt mit einem Bau, der nach der Perception entstand), plant die KI im nächsten Think neu (Test `AI-ENG-02`).
- **Sicherheit:** Steht ein Engineer in einer Zelle mit `T_surface ≥ T_eng = 20` ohne eigene Deckung oder nimmt er Schaden, bricht er ab und läuft zum nächsten verteidigten Punkt (Fabrik, Riegel, Platoon); die Aufgabe kehrt aufs Board, der Spot ist 30 s gesperrt. Werte unter `T_eng` zählen auch im Spot-Score als 0. Ein einzelner Funke (Threat 8) löst also keine Flucht aus, sondern einen Jagdauftrag (P1) an die nächste Kampfeinheit. (Review R-06: Mit der alten Schwelle `> 0` hätte ein stehender 12-Mass-Scout pro Cluster die ganze Expansion gesperrt.)
- **Idle-Definition (Review R-G3):** Ein Engineer ist idle, wenn er ≥ 2 s keinen Auftrag hat **oder** sein Guard-/Assist-Ziel nichts baut (Fabrik ohne Auftrag, pausierte Baustelle). Guard an einer arbeitenden Fabrik zählt als beschäftigt, auch wenn sie mass-gedrosselt ist. Mit der alten Definition („Guard zählt immer“) wäre das Gate < 15 % durch Dauer-Guard trivial erfüllt. Freie Engineers ohne Aufgabe gehen an Prio 12 (Bau-Assist) bzw. Prio 10 (Guard an der nächsten Fabrik), damit Build Power nie ungenutzt bleibt.

### 5.4 FactoryManager (1 Hz; A1, A2, Air-Lite MS12)

**Grund-Mix je Phase** (Anteile am Mass-Wert der Produktion; Engineers laufen vorher über die Sollzahl):

| Phase | Mix |
|---|---|
| T1 | Punze 45 % · Kelle 20 % · Stichel 20 % · Sieb 0 % (15–30 % nach Luftkontakt) · Funke: 1 lebender Späher, ersetzt nach Verlust, höchstens 1 je 3 min |
| T2 | Meißel 45 % · Rinne 20 % · Punze 15 % (billiger Füller bei `P_M < 20`) · Rüttelsieb 0–25 % · Stichel 10 % (Raids) |
| T3 (MS13) | Fallhammer 35 % · Meißel 20 % · Pfanne 15 % · Reißnadel 10 % · Trommelsieb 0–20 % · Schürze 1 je 10 Einheiten |
| Luftwerk (MS12) | Lerche 1 je 4 min · Turmfalke nach Luftüberlegenheit · Dohle/Krähe für Raids · Elster (T2) gegen Engineers und Vogt-Snipe (nur Hard) |

**Auswahl je Auftrag:** Die Fabrik baut die Rolle mit dem größten Defizit `Soll-Anteil − Ist-Anteil` (Ist = lebende Armee + Queue, gewichtet nach Mass); Gleichstand nach der Reihenfolge der Tabelle. Umgesetzt als Repeat-Schleife aus 4–6 Aufträgen, neu geschrieben nur bei Mix-Wechsel (APM).

**Konter-Tabelle:** Grundlage ist der Threat-gewichtete Anteil feindlicher Kategorien, die in den letzten 180 s gesehen wurden (sichtbar oder als Ghost; Blips zählen als „unbekannt Boden“). Eine Regel greift, sobald ihr Anteil ≥ 35 % beträgt (Luft: ≥ 5 Flugzeuge oder ≥ 20 % Luft-Threat); mehrere Regeln addieren sich, danach wird der Mix normiert.

| Feindlicher Schwerpunkt (Kategorie-Ausdruck) | Anpassung | Begründung (Roster-Werte) |
|---|---|---|
| `LAND & MOBILE & BOT - SNIPER` (Stichel-Masse) | Punze +20 %, Kelle +10 %, Stichel −10 % | Stichel 70 HP: eine Kelle-Salve (Splash) oder 1 Vogt-Schuss töten; Punze 300 HP hält 4× länger |
| `LAND & MOBILE & TANK` | Kelle/Rinne +15 %, Punze/Meißel +5 % | Kelle 30 WU > Punze 18 WU; Rinne 60 WU |
| `LAND & MOBILE & INDIRECTFIRE` | Stichel +20 % (Tempo 4,3), Raid-Platoon auf die Artillerie | Kelle 210 HP, Tempo 2,7, Mindestreichweite |
| `STRUCTURE & DEFENSE & DIRECTFIRE` (Riegel an der Front) | Kelle/Rinne/Pfanne +25 %, Angriff nur mit Artillerie-Anteil ≥ 25 % | Riegel I 26 WU < Kelle 30 WU; Riegel II 48 WU < Rinne 60 WU |
| `AIR & (BOMBER \| GUNSHIP)` | Sieb/Rüttelsieb auf 25–35 %, DefenseManager: Rost an Basis und Mex-Clustern; Luftwerk: Turmfalken | MS12-Gate AA-Quote ≥ 20 % in ≤ 90 s |
| `AIR & ANTIAIR` (nur Jäger) | Land unverändert; eigene Luft: Turmfalken +30 %, Bomber pausieren | Jäger bedrohen nur Luft |
| `SHIELD` (Schürze, Schirm) | Direktfeuer +15 % (Meißel/Fallhammer), Artillerie −10 % | Schilde fangen Artillerie-Salven |
| `SNIPER` (Reißnadel) | Stichel/Punze +15 %, Angriff sofort bei R ≥ 1 | Reißnadel 560 HP, Tempo 2,4 |
| `COMMAND` vorn (feindlicher Vogt ≤ 150 WU von eigenen Einheiten) | Punze/Meißel +15 %, Platoon-Ziel Vogt nur bei R ≥ 2 (§5.5) | Vogt 12.000 HP, Abstich gegen Pulks |

Easy ignoriert die Tabelle, Normal wendet sie nach dem nächsten Mix-Takt an, Hard sofort und mit Vorhersage (feindliches Landwerk II gesichtet ⇒ Meißel-Anteil vorab +10 %).

**Rally:** Sammelpunkt nach §3 (45 WU auf dem Pfad). Ab dem ersten Platoon auf dem Staging-Punkt wandert der Rally dorthin, wenn die eigene Armee dort ≥ 1,0-fach überlegen ist.

**Air-Lite (MS12, A21-Vorgriff ohne Transporte):** Luftüberlegenheit anstreben, wenn `T_air(feind) > 0`: Turmfalken bis `T_antiair(eigen) ≥ 1,2 · T_air(feind)`. Bomber-Raids (3–6 Dohlen) auf Engineers, Mex und Kraftwerke mit dem höchsten `Wert / (1 + T_antiair(ziel))`; Abbruch, wenn auf der Route `T_antiair > 50`. Krähen (T2) gegen Boden-Pulks ohne Flugabwehr. Lerche: Scout-Schleife über die gegnerische Hälfte alle 4 min.

### 5.5 PlatoonManager (2 Hz; A2)

**Zustände:**

```text
FORMING  (am Rally)   → Stärke ≥ Wellen-Schwelle oder t ≥ waves.maxS − 60 s   → STAGING
STAGING  (Staging-Pkt) → R_ziel ≥ attackRatio für 2 Thinks                     → ATTACK
                       → erste Welle und t ≥ waves.maxS (Pflichtangriff):
                         Ziel mit dem höchsten R_ziel in der gegnerischen Hälfte → ATTACK
ATTACK   (Attack-Move) → R_lokal < 0,7 für 2 Thinks (1 s)                       → RETREAT
                       → Ziel zerstört                                           → nächstes Ziel oder STAGING
RETREAT  (zum nächsten verteidigten Punkt, eigener Pfad, P0-Priorität)
                       → R_lokal ≥ 1,0 und HP-Anteil ≥ 60 % (oder Verstärkung verschmolzen) → STAGING
MERGE    Platoons < 50 % Ausgangsgröße gehen in das nächste Platoon am Rally/Staging auf
```

- **Wellen:** erste Welle = `waves.first` Einheiten (Easy +4), jede weitere `+grow`. `maxS` (≤ 7:30) erzwingt den ersten Angriff spätestens zu diesem Zeitpunkt, auch wenn kein Ziel `attackRatio` erreicht. Sonst würde das MS9-Gate „erste Welle ≤ 8 min“ im Spiegel-Turnier regelmäßig reißen, weil zwei gleich starke KIs selten R ≥ 1,2 sehen. Die Rückzugsregel gilt auch im Pflichtangriff (Review R-G1, Test `AI-PLT-05`). Die alten Werte `maxS` = 540 s bei `tech_greed` und `air_opener` lagen hinter dem Gate.
- **Stärke-Schätzung** (MS9, vor dem Threat-Grid): `threat(u) = √(DPS_layer(u) · HP_eff(u))` aus der Blueprint-View, skaliert mit dem sichtbaren HP-Anteil. Der eigene Vogt zählt ×1,5, solange `S_E ≥ 7.500` (Abstich möglich). Der **feindliche** Vogt zählt ×1,5, sobald ein feindlicher Glutspeicher gesehen wurde (auch als Ghost) oder t ≥ 5:00. Den feindlichen Speicherstand kennt die KI nicht (Review R-07, Test `AI-PERC-03`). Blips zählen mit dem Median-Threat der **höchsten beim Gegner gesehenen** Tech-Stufe, sonst T1 (T1: 84 = Punze, T2: 294 = Meißel); die tatsächliche Tech-Stufe des Gegners ist Fog-Wissen. Werte je Blueprint in §5.6.

```text
R_lokal = Σ threat(eigene Einheiten in r) / max(1, Σ threat(feindliche Einheiten und Strukturen in r))
r = größte Waffenreichweite im Platoon + 20 WU        (MS11+: Summe der Threat-Grid-Zellen im 3×3-Fenster)
```

Die Summe der Wurzeln ist linear in der Anzahl gleicher Einheiten: 7 gegen 10 Punzen ergibt genau R = 0,7 (kein Rückzug, weil die Regel < 0,7 verlangt), 7 gegen 11 ergibt 0,64. R ist die Wurzel des Lanchester-Stärkeverhältnisses: R = 0,7 heißt Kampfkraft 0,49 : 1. Die PLAN-Schwelle 0,7 ist also eher spät, die Hysterese bis 1,0 verhindert aber das Pendeln. `attackRatio`: Easy 1,5, Normal 1,2, Hard 1,0 (bessere Schätzung, Micro gleicht aus). Rückzug bei **R < 0,7** für alle Stufen (PLAN), Wiedereinstieg erst bei R ≥ 1,0 (Hysterese gegen Pendeln).

- **Zielwahl:** `score = Wert / (1 + T_surface auf dem Pfad) / (1 + d / 200)`; Werte: Zapfstelle 100 (+ Tech × 100), Engineer 60, Glutkessel 40, Landwerk 80, Riegel −50 (+100, wenn Artillerie-Anteil ≥ 25 %), feindlicher Vogt 300 nur bei R ≥ 2. Ab MS11 (A7) bevorzugt der Score schwach verteidigte Ziele aus dem Threat-Grid.
- **Raid-Platoons:** 3–5 Stichel/Punze (Normal 1 ab 6:00, Hard 2 ab 4:00) gegen Außen-Mex mit `T_surface = 0`; Rückzug schon bei R < 1,0.
- **Bewegung:** Gruppenbefehl mit Offset-Erhalt (eine Pfadanfrage), Attack-Move ins Zielgebiet; ab MS13 Formation (C13) für gemischte Platoons mit Artillerie hinten; Tempo = langsamste Einheit.
- **Setons:** Staging-Punkt ist der eigene Brückenkopf (≈ (426 \| 564) für Army 0). Ein Platoon, das dort steht, deckt die Expansion auf das Brückenzentrum.

**Vogt:**
- bleibt im Basisradius (60 WU) und baut; verteidigt, wenn R_lokal inklusive Vogt ≥ 1,0; zieht sich bei HP < 50 % oder R_lokal < 0,5 hinter die nächste Fabrik zurück.
- **Leine (Review R-09):** Der Vogt verfolgt keine Ziele außerhalb von 60 WU um die nächste eigene Fabrik (Hard mit R_lokal ≥ 2: 120 WU) und setzt den Abstich nur innerhalb der Leine ein. Wer ihn mit ein paar Sticheln aus der Basis lockt, um ihn vor einer wartenden Armee zu snipen (FA-Klassiker), erreicht damit nichts.
- **Burst-Prüfung:** Ist die erwartete Zeit bis zum Tod `HP / Σ DPS (feindliche Einheiten in Reichweite + 10 WU, Bomber mit Anflug)` < 20 s, zieht sich der Vogt sofort zurück, unabhängig von R_lokal. Das deckt Boden- und Luft-Snipes mit derselben Regel ab.
- **Abstich (U8):** Normal nur zur Verteidigung (≥ 3 mobile Feinde im Splash 2,5 WU oder ein Meißel), Hard zusätzlich offensiv; ab MS10 Auto-Abstich-Toggle (C17), wenn `S_E ≥ 7.500` stabil ist.
- Hard darf den Vogt nach vorn nehmen, wenn R_lokal ≥ 2,0 und kein feindlicher Bomber/Krähe gesichtet wurde (Snipe-Schutz, MS12-Gate).

### 5.6 IntelManager (1 Hz; A7 MS11)

**Threat-Grid:** Zellen à 16 WU (Setons 64 × 64, 512 WU 32 × 32), je Zelle fünf Werte (Float32 im AI-Worker, nicht im Hash):

| Ebene | Inhalt |
|---|---|
| `T_surface` | Threat feindlicher Einheiten/Strukturen gegen Boden |
| `T_air` | Threat feindlicher Flugzeuge (für AA-Bedarf) |
| `T_antiair` | Threat feindlicher Flugabwehr (für Bomber-Routen) |
| `V_struct` | Wert feindlicher Strukturen (Ziele) |
| `lastSeen` | Tick der letzten eigenen Sicht |

- **Eintragen:** Pro Intel-Takt schreibt jede bekannte feindliche Einheit ihren Threat in die **Live-Ebene** aller Zellen bis `Reichweite + 8 WU` (voll innerhalb der Reichweite, halb im Rand). Die Live-Ebene wird vor dem Eintragen geleert und in fester Handle-Reihenfolge summiert. Blips zählen mit dem Median-Threat der höchsten gesehenen Tech-Stufe (§5.5), über 2 Zellen verschmiert (Radar-Jitter). Ghost-Strukturen stehen in einer eigenen Struktur-Ebene, die sich nur bei Ereignissen ändert (neu gesehen, Zerstörung gesehen).
- **Gedächtnis und Verfall (lazy, Review R-10):** Mobiler Threat einer Zelle ist `max(Live, Mem · 0,95^(t − t_mem))`. `Mem` und `t_mem` werden nur in Zellen mit Live > 0 oder in eigener Sicht neu gesetzt; gesehenes Leeres löscht das Gedächtnis. Der Faktor kommt aus einer LUT (0,95^s für s = 0…600, einmal per Multiplikation erzeugt), nicht aus `Math.pow` (§2.5). Halbwertszeit ≈ 13,5 s; Strukturen verfallen nicht. Früher stand hier ein Verfall „× 0,95 je Sekunde“ über alle Zellen und ein Eintrag ohne Leeren. Das hätte jeden Takt 4.096 Zellen gekostet und stehende Einheiten jede Sekunde erneut aufaddiert.
- **Scouting:** Der erste Funke läuft direkt zum Gegner-Start (Setons 463 WU / 4,5 WU/s ≈ 103 s nach Spawn bei 1:03, also ≈ 2:46; Hollow Ridge 570 WU ≈ 127 s, also ≈ 3:10), dann über die feindlichen Expansions-Spots mit dem ältesten `lastSeen`, zurück über die umkämpfte Zone. Neue Scout-Route alle 180 s. MS11-Gate: Gegnerbasis gesehen ≤ 4 min.
- **Werte je Blueprint** (`ecosim.py --threat`, √(DPS · HP)):

| Einheit | Mass | Threat Boden | Threat Luft | je 100 Mass |
|---|---|---|---|---|
| Vogt | (2.000) | 1.095 (×1,5 mit Abstich) | 0 | – |
| Funke | 12 | 8 | 0 | 67 |
| Stichel | 32 | 40 | 0 | 126 |
| Kelle | 36 | 48 | 0 | 134 |
| Punze | 56 | 84 | 0 | 149 |
| Sieb | 55 | 0 | 93 | 169 |
| Meißel | 200 | 294 | 0 | 147 |
| Rinne | 180 | 216 | 0 | 120 |
| Zange | 190 | 208 | 0 | 110 |
| Rüttelsieb | 160 | 0 | 383 | 240 |
| Fallhammer | 500 | 693 | 0 | 139 |
| Pfanne | 800 | 265 | 0 | 33 |
| Reißnadel | 720 | 283 | 0 | 39 |
| Trommelsieb | 600 | 0 | 648 | 108 |
| Riegel I / II | 240 / 520 | 474 / 548 | 0 | 198 / 105 |
| Rost I / II / Hochrost | 150 / 400 / 800 | 0 | 234 / 684 / 1.309 | 156 / 171 / 164 |
| Dohle / Krähe / Elster | 90 / 200 / 340 | 125 / 201 / 407 | 0 / 0 / 284 | 139 / 101 / 120 |
| Turmfalke | 50 | 0 | 118 | 237 |

Artillerie (Pfanne, Tiegel, Hochofen) und Reißnadel haben geringen Threat pro Mass, wirken aber über Reichweite; sie werden im Grid mit ihrer vollen Reichweite eingetragen und im Platoon-Score gesondert behandelt (Riegel-Konter).

### 5.7 DefenseManager (1 Hz; A8 minimal MS9, voll MS11)

**MS9 (Minimal-A8):** Wird ein eigener Mex-Cluster (≥ 2 Zapfstellen in 30 WU) angegriffen, setzt die KI **einen** Riegel I an den Cluster-Schwerpunkt, versetzt 6 WU zur Bedrohung. Höchstens ein Riegel je Cluster, nicht vor 3:00 (außer im Verteidigungsmodus §4.3). „Angegriffen“ heißt: Eine feindliche Bodeneinheit hat einer Struktur des Clusters Schaden zugefügt. Bloße Anwesenheit, etwa ein durchlaufender Funke, zählt nicht (Review R-06, Test `AI-DEF-03`). Ein Riegel (240 M) gegen einen Stichel (32 M) ist bewusst teuer; die Obergrenze von einem Riegel je Cluster und das 15-%-Budget begrenzen, wie oft ein Gegner das mit Einzel-Pokes auslösen kann.

**MS11 (voll):**

| Auslöser | Reaktion | Frist |
|---|---|---|
| Raid: Schaden an Struktur außerhalb des Basisradius oder ≥ 3 feindliche Kampfeinheiten (ohne Scouts) in der eigenen Zone | Riegel I (T2: Riegel II) am Cluster, nächster Engineer (Prio 95); Platoon in der Nähe wird umgelenkt, wenn R ≥ 1 | Baubeginn ≤ 60 s nach erstem Schaden (Gate) |
| Luftkontakt: feindlicher `T_air` in eigener Zone | 2× Rost I an der Basis, 1× je Mex-Cluster mit ≥ 3 Mex; T2: Rost II; T3: Hochrost ab ≥ 10 feindlichen Flugzeugen | Baubeginn ≤ 60 s |
| Bomber-Snipe-Gefahr: ≥ 5 feindliche Bomber/Krähen gesehen | 2 Sieb/Rüttelsieb als Vogt-Eskorte, Vogt bleibt im Rost-Schutz | ≤ 30 s |
| Feindliche Artillerie (`INDIRECTFIRE`) bedroht die Basis (MS13) | Schirm II über dem Fabrik-Cluster | – |
| Stellungskrieg an einer Engstelle (R 0,8–1,2 über 180 s, T2+) | Tiegel hinter der Engstelle (Setons: eigener Brückenkopf, 110 WU Reichweite deckt das Brückenzentrum) | – |

Budget: Verteidigung höchstens 15 % der Mass-Ausgaben über 3 min (Ausnahme: Verteidigungsmodus). Riegel entstehen nie im umkämpften Gebiet ohne Platoon-Deckung.

### 5.8 Micro (nur Hard, 5 Hz; A10 MS14)

| Technik | Regel |
|---|---|
| Kiting | Einheiten mit Reichweitenvorteil ≥ 4 WU (Kelle 30 vs. Punze 18, Rinne 60, Reißnadel 58) weichen 4 WU zurück, wenn der nächste Feind näher als eigene Reichweite − 2 WU ist, und feuern dann weiter |
| Focus Fire | Ziele nach `Wert / Zeit-bis-Tod`; Einheiten werden zugeteilt, bis der erwartete Schaden 110 % der Ziel-HP erreicht (Overkill vermeiden); Neuverteilung bei Zieltod |
| Einzel-Rückzug | Einheiten ≥ 150 Mass mit < 30 % HP verlassen das Gefecht zum nächsten Engineer (Reparatur) |
| Abstich | Vogt feuert auf Pulks (≥ 3 mobile Feinde im Splash) oder T2-Panzer, sobald `S_E ≥ 7.500` |
| Engineer-Flucht | Engineers weichen Stichel-Raids in Richtung nächster Riegel aus, bevor sie getroffen werden |

---

## 6. Schwierigkeitsgrade und AIx (A10, A11)

| Parameter | Easy | Normal | Hard |
|---|---|---|---|
| Denktakt | 1 Hz | 2 Hz | 2 Hz + Micro 5 Hz |
| Reaktionsverzögerung (neue Reize) | 2,0 s | 0,5 s | 0 s |
| APM-Cap / Burst | 40 / 10 | 120 / 20 | 300 / 40 |
| Op-Budget je Think | 12.000 | 24.000 | 40.000 + 8.000 Micro |
| Micro | keins | Platoon-Rückzug, Engineer-Flucht | alles aus §5.8 |
| Fehlerrate | 15 %: Mix-Wahl zufällig unter den Top 3, 10 % der Eröffnungs-Mex entfallen, Konter-Tabelle aus | 5 %: Mix-Wahl unter den Top 2 | 0 % |
| Planungstiefe | Energie-Horizont 10 s, Threat nur aus sichtbaren Einheiten, keine Raids | 30 s, Konter-Tabelle, Threat-Grid (ab MS11), 1 Raid-Platoon | 60 s, Konter mit Vorhersage, 2 Raid-Platoons, Bomber-Snipe (MS12) |
| Eröffnungen | nur `eco_standard`, Denkpause 4 s je Schritt, Engineers × 0,6, Tech +150 s | alle MS9-Eröffnungen | alle inkl. `air_opener` |
| Erste Welle | 12 Einheiten | 6–10 (Eröffnung) | 6–10 (Eröffnung) |
| Angriffsschwelle `attackRatio` | 1,5 | 1,2 | 1,0 |
| Rückzugsschwelle | 0,7 | 0,7 | 0,7 (+ Einzel-Rückzug) |

Alle drei Stufen sehen dieselbe Perception (kein Cheat). Messbar trennen sie sich über die Turnier-Gates in §7.

**AIx (A11):** Lobby-Option je KI-Slot, 1,0–2,0 in 0,1-Schritten (Vorgabe aus: 1,0). Umsetzung als Army-Modifier `source = aix` (G6) auf `prodMult` (Mass- und Energie-Einkommen aller Quellen inklusive Reclaim) und `effBP` (Build Power) mit Faktor AIx. Der Modifier liegt in der Sim, steht im Replay-Chunk `GAME` und geht in den Regel-Hash ein. Das Gehirn einer AIx-KI ist das Hard-Profil; seine Eco-Planung liest die effektiven Raten aus `eco()` und plant damit automatisch mehr Fabriken. Gate MS14: AIx 1,5 schlägt Hard mit unterer Grenze ≥ 75 %.

---

## 7. Qualitätsmetriken und Turnier-Gates

### 7.1 Metriken (headless erhoben, `tools/headless/ai-tournament`)

| Metrik | Definition |
|---|---|
| Siegquote, untere Grenze | `p̂ = (Siege + 0,5 · Remis) / n`; untere Grenze des 95-%-Wilson-Intervalls (z = 1,96). Remis = Zeitlimit 45 min erreicht |
| Elo-Differenz | `400 · log10(p̂ / (1 − p̂))` (Bericht, kein Gate) |
| T2-Zeit | Tick, an dem die erste eigene Fabrik mit `TECH2` fertig ist |
| T3-Zeit (MS13) | dito `TECH3` |
| Erste Welle | Tick des ersten Übergangs eines Platoons nach ATTACK mit Ziel in der gegnerischen Hälfte (Pflichtangriff bei `waves.maxS` eingeschlossen, §5.5) |
| Idle-Engineer-Zeit | Σ Engineer-Zeit ohne Auftrag ≥ 2 s oder am Guard/Assist eines Ziels, das nichts baut / Σ Engineer-Lebenszeit (Definition §5.3) |
| Energie-Stall-Anteil | Anteil der Ticks mit Energie-Ratio < 1 bei vorhandenem Bedarf (Economy-Phase, PLAN §3.4), ohne die 60 s nach Verlust eines eigenen Kraftwerks oder Speichers (Kampfschaden ist kein Planungsfehler). Gate: gepoolt über alle Prüflings-Seiten ≤ 5 %; p90 je Spiel wird berichtet (Ausreißer > 10 %) |
| Mass-Nutzung (Bericht) | verfallene Mass / Einkommen; durch Mass-Mangel ungenutzte Build Power |
| Mex-Upgrade-Qualität | Anteil der Upgrades, deren Mex vor Ablauf der Amortisation stirbt (Ziel ≤ 20 %) |
| Scout-Zeit | erster Tick mit eigener Sicht auf die Startzelle des Gegners |
| Raid-Reaktion | Zeit vom ersten Schaden eines Raids (§5.7) bis zum Baubeginn eines Riegels/Rosts in 40 WU |
| AA-Quote | Anteil `ANTIAIR` an den produzierten mobilen Einheiten in den 90 s nach Sichtung von ≥ 5 feindlichen Flugzeugen |
| Snipe-Überleben | Vogt lebt 120 s nach Start des Szenarios „10 Dohlen auf Vogt“ |
| Budget | p99 der ops je Think ≤ Budget; Anzahl `MARK aiTimeout`; Think-Zeit p95 im Worker |
| APM | Command-Records pro Minute (p99 über 60-s-Fenster) ≤ Cap |

**Schwellen bei n = 200** (untere Wilson-Grenze ≥ Gate ⇒ nötige Zahl Erfolge, Quote): 55 % → 124 (62,0 %) · 60 % → 134 (67,0 %) · 65 % → 144 (72,0 %) · 70 % → 153 (76,5 %) · 75 % → 163 (81,5 %) · 80 % → 172 (86,0 %) · 90 % → 189 (94,5 %). Wer knapp scheitert, verdoppelt auf n = 400 (Schwellen sinken um ≈ 2 Punkte), statt Seeds zu wählen.

**Stichprobe:** Je Spiel zählt eine Seite des Prüflings. In Spiegel-Turnieren (etwa MS9 gegen MS9 für das T2-Gate) ist das die Army mit der Parität des Seeds, sonst wären die zwei Werte eines Spiels korreliert und die Wilson-Grenze zu optimistisch. n = 200 Spiele heißt also n = 200 Stichproben.

### 7.2 Gates je Meilenstein

| MS | Gate (aus PLAN §5) | Messung |
|---|---|---|
| MS6 | SPK7: Scripted Dummy-KI als `CommandSource`, Sim wartet bei `'pending'`, Command-Log bitgleich | `AI-DET-03`, Eröffnung `eco_standard` als Skript ohne Manager |
| MS9 | T2 ≤ 12 min in ≥ 90 % (≥ 200 Spiele, 3 Karten); erste Welle ≤ 8 min in ≥ 90 %; Rückzug bei R < 0,7 (Szenario); KI gegen KI 30 min ohne Crash, Command-Log-Replay bitgleich auf 5 Engines, Idle-Engineer < 15 % (Mittel je Spiel, in jedem Spiel); Browser- = Headless-Command-Strom; Perception-Byte-Test; Sim-Budget unverändert; Playtest „kein reproduzierbarer Exploit (Raids eingeschlossen)“ | Turnier `ms9` + `AI-PLT-01/05`, `AI-DET-01/02/04`, `AI-PERC-01…03`, `AI-BUD-01`; Exploit-Satz `AI-OPEN-05`, `AI-ENG-04`, `AI-DEF-03`, `AI-PLT-04` vor dem Playtest grün |
| MS10 | Energie-Stall ≤ 5 % (gepoolt, Definition §7.1); Mex-Upgrades nach Amortisation; gegen MS9-KI untere Grenze ≥ 60 % | Turnier `ms10-vs-ms9`, `AI-ECO-03/04` |
| MS11 | Scout ≤ 4 min; PD/AA ≤ 60 s nach Raid; gegen MS10-KI ≥ 55 % | `AI-INT-01`, `AI-DEF-02`, Turnier `ms11-vs-ms10` |
| MS12 | AA-Quote ≥ 20 % in ≤ 90 s bei ≥ 5 Feindflugzeugen; Bomber-Snipe: Vogt überlebt ≥ 70 % (≥ 200 Läufe) | `AI-AIR-01`, `AI-AIR-02` |
| MS13 | T3 ≤ 25 min in ≥ 80 %; T3-Artillerie im Einsatz (Pfanne in einem Angriff oder Hochofen gebaut) | Turnier `ms13`, `AI-TECH-03` |
| MS14 | Hard > Normal ≥ 65 %, Normal > Easy ≥ 65 %, AIx 1,5 > Hard ≥ 75 %; ≥ 200 nächtliche KI-Spiele ohne Desync; alle vorigen Gates grün | Turniere `diff-*`, `aix` |

Zusätzlich in jedem Turnier (ohne eigene PLAN-Zeile, aber blockierend): 0 × `aiTimeout`, APM ≤ Cap, Budget-p99 ≤ Budget.

### 7.3 Turnier-Protokoll

- **Karten:** MS9 „3 Karten“ = Setons (Army 0/1, Mid gegen Mid), Hollow Ridge, eine dritte 512-WU-Karte (Kartenset M8); je Karte gleich viele Spiele.
- **Paarung:** Seeds 1…100, jeder Seed zweimal mit getauschten Armies (Startvorteil hebt sich auf) ⇒ 200 Spiele je Paarung; Eröffnungswahl über den Seed, damit alle Eröffnungen vorkommen (Bericht je Eröffnung).
- **Referenz-KIs:** Jede Meilenstein-KI wird als Git-Tag `ai-msN` eingefroren und vom Turnier-Runner als eigenes Bundle gegen dieselbe Protokoll-Version gebaut; ändert sich die Perception-Schnittstelle, braucht die Referenz einen Adapter (offener Punkt §11).
- **Lauf:** headless, 20 Prozesse parallel, maximale Sim-Geschwindigkeit, Zeitlimit 45 min Spielzeit; jedes Spiel speichert sein Replay (Stichprobe 5 % durch `replay-verify` auf 5 Engines).
- **Bericht:** Siegquote mit Wilson-Grenze, Elo, Metriken aus §7.1 je Karte und Eröffnung, Liste der Spiele mit Ausreißern (T2 > 12 min, Stall > 10 %, Timeout).

---

## 8. Zuordnung zu Feature-IDs und Meilensteinen

| Baustein | Feature-IDs | Meilenstein | Abnahme |
|---|---|---|---|
| Scripted Dummy-KI (`eco_standard` als starres Skript, kein Manager) | Vorläufer A1, SPK7 | MS6 | SPK7-Exit, Opening-Loop-Golden |
| AI-Worker, `PerceptionView`, Budget, Determinismus (§2) | A1, A10 (Grenze) | MS9 | `AI-DET-*`, `AI-PERC-01`, `AI-BUD-01` |
| OpeningScript + `ai-openings.json` (§4) | A1 | MS9 | `AI-OPEN-01…04` |
| EconomyManager Grundstufe (Energie-Bilanz, Expansion, Mass-Senken, Energie zuerst, Sättigung) | A1 | MS9 | T2-/Wellen-Gate, `AI-ECO-01/02/04/05` |
| TechManager bis T2 | A1, U5 | MS9 | T2 ≤ 12 min |
| EngineerManager, Task-Board, Platzierung | A1, B1, B2 | MS9 | Idle < 15 %, `AI-ENG-01/02` |
| FactoryManager mit Konter-Tabelle | A1, A2, B3 | MS9 | `AI-FAC-01` |
| PlatoonManager mit lokaler Stärke-Schätzung | A2 | MS9 | Rückzug < 0,7 (`AI-PLT-01`), erste Welle ≤ 8 min |
| Minimal-A8 (ein Riegel je angegriffenem Cluster) | A8 (Vorgriff) | MS9 | `AI-DEF-01`, `AI-DEF-03` |
| Exploit-Schutz (Poke-Toleranz, Scout-Jagd, Vogt-Leine, Burst-Rückzug) | A1, A2, A4 | MS9 | `AI-OPEN-05`, `AI-ENG-04`, `AI-PLT-04`, Playtest MS9 |
| Economy-Scaling: Mex-Upgrades, Speicher/Adjacency, Prioritäten/Pausen, Radar-Toggle | A9, E10–E13, C17 | MS10 | Stall ≤ 5 %, `AI-ECO-03`, ≥ 60 % gegen MS9 |
| Threat-Grid, Scouting, Zielwahl nach Schwäche | A7 | MS11 | Scout ≤ 4 min, `AI-INT-01/02` |
| DefenseManager voll | A8 | MS11 | PD/AA ≤ 60 s, `AI-DEF-02` |
| Patrol-Engineers für Reclaim/Repair | C12 (KI-Nutzung) | MS11 | `AI-ENG-03` |
| Air-Lite (Luftwerk, Bomber-Raids, AA-Reaktion, Snipe-Schutz), `air_opener` | U11, K12 (KI-Nutzung), A21-Vorgriff ohne Transporte | MS12 | `AI-AIR-01/02` |
| T3-Lite, T3-Artillerie, Schilde, Formationen | U10, K13, K10, C13 (KI-Nutzung) | MS13 | T3 ≤ 25 min, `AI-TECH-03` |
| Schwierigkeitsgrade, Micro (Hard) | A10 | MS14 | Turniere `diff-*`, `AI-MIC-01/02` |
| AIx | A11 | MS14 | Turnier `aix`, `AI-AIX-01` |
| Score/Stats für Turnierberichte | A13 (Sim-Stats) | MS14 | Score = Sim-Stats |

---

## 9. Testszenarien

Szenarien liegen als `test/ai/<id>.scenario.ts` (ScenarioBuilder, PLAN §3.12) und laufen headless mit synchronem `AiHost`. **L2** = Golden (Command-Strom-Hash + Sim-Hash-Trail, Update nur mit `--update`), **H** = headless-Monte-Carlo (n Läufe mit Seeds, Quote mit Wilson-Grenze), **U** = Unit-Test in `packages/ai`.

| ID | Verhalten | Aufbau | Erwartung | Art | MS |
|---|---|---|---|---|---|
| AI-DET-01 | Browser = Headless | Seed 7, Setons, KI gegen KI 10 min, einmal im AI-Worker (Chromium), einmal synchron (Node) | identischer Command-Strom (Hash je 600 Ticks) | L2/L7 | MS9 |
| AI-DET-02 | Budget-Abbruch deterministisch | Normal-KI mit künstlich halbiertem Budget, 2 Läufe | identischer Command-Strom; Cursor-Fortsetzung ohne Doppelaufträge | L2 | MS9 |
| AI-DET-03 | `'pending'`-Pfad | Dummy-KI antwortet absichtlich 2 Ticks zu spät | Sim wartet, kein Command verworfen, Replay bitgleich | L2 | MS6 |
| AI-DET-04 | Notabbruch | künstliche Wall-Clock-Verzögerung mitten im PlatoonManager eines Thinks | `MARK aiTimeout`; nur abgeschlossene Manager-Schritte wirken (keine halbe Platoon-Zuteilung); Replay spielt bitgleich ab | L2 | MS9 |
| AI-PERC-01 | nicht cheatend | Feind-Einheit im Fog neben der KI-Basis | Perception-Bytes enthalten sie nicht; Byte-Vergleich mit/ohne verborgene Einheit gleich | U/L2 | MS9 |
| AI-PERC-02 | Platzierung ohne Fog-Wissen | feindliche Zapfstelle im Fog auf einem eigenen Expansions-Spot | `freeMassSpots()` und `canPlace` liefern mit und ohne sie dasselbe; der Engineer läuft hin, sieht sie, der Spot wird Ghost, Neuplanung im nächsten Think | U/L2 | MS9 |
| AI-PERC-03 | keine fremde Eco | sichtbarer feindlicher Vogt, einmal mit leerem, einmal mit vollem Energiespeicher, kein Glutspeicher gesehen, t = 3:00 | identischer Command-Strom (Threat-Schätzung und Platoon-Entscheidung hängen nicht vom feindlichen Speicher ab) | L2 | MS9 |
| AI-BUD-01 | Budget/Timeout | Big Battle 2 × 300 Einheiten, Hard | ops-p99 ≤ Budget, 0 `aiTimeout`, Sim-p95 ohne KI = mit KI (±2 %) | H | MS9 |
| AI-OPEN-01 | Eröffnungs-Timings Setons | Setons Army 0, kein Gegner, je Eröffnung | Fabrik/Eng1/Mex4/Mex8/T2 innerhalb ±10 s von `expect.setons` (Sim-Abweichungen gegenüber ecosim: Pfad, Roll-off) | L2 | MS9 |
| AI-OPEN-02 | Eröffnungs-Timings 512 WU | dito Hollow Ridge | innerhalb ±10 s von `expect.hollow-ridge` | L2 | MS9 |
| AI-OPEN-03 | Ring-Reservierung | `eco_standard`, Engineer 1 spawnt | Engineer 1 wählt keinen Ring-Spot; Vogt baut alle 4 Ring-Mex | L2 | MS9 |
| AI-OPEN-04 | Abbruch Verteidigungsmodus | 6 feindliche Stichel (Threat 240 ≥ 160) stehen ab 2:00 in der eigenen Zone | ≤ 2 s nach Ablauf der 5-s-Frist (Reaktionsverzögerung 0,5 s + 1 Think + lead): Fabrik auf Punze/Stichel, Vogt verteidigt, Riegel I am Ring beauftragt | L2 | MS9 |
| AI-OPEN-05 | Poke ohne Abbruch | ein Stichel beschießt bei 1:30 den Vogt, ein Funke läuft durch die Basis | Eröffnung wird nicht verworfen (nur lokale Abwehr); beide Eindringlinge sterben; Mex8 ≤ 20 s später als ohne Poke | L2 | MS9 |
| AI-ECO-01 | Energie-Bilanz | Test-Verbraucher (`test:stall_consumer`) mit +100 E/s Bedarf eingeschaltet | Kraftwerke ≤ 2 Economy-Takte (2 s) beauftragt; Energie-Stall < 3 s | L2 | MS9 |
| AI-ECO-02 | Mass-Senke | Mass-Speicher voll über 20 s (Cheat: +30 M/s) | Mex-Upgrade/Fabrik/Engineer in Reihenfolge der Tabelle §5.1, Energie-Reservierung gebucht | L2 | MS9 |
| AI-ECO-03 | Mex-Upgrade nach Amortisation | Mex in umkämpfter Zone und Mex im Hinterland, beide upgradefähig | nur der Hinterland-Mex wird aufgerüstet | L2 | MS10 |
| AI-ECO-04 | Energie zuerst | Setons, t = 10:00, fünf Mex-Upgrades nach Mass-Lage möglich, `E_frei` = 100 E/s | höchstens ein Upgrade startet, Kraftwerke sind beauftragt, bevor das nächste startet; kein Energie-Engpass in den folgenden 120 s | L2 | MS9 |
| AI-ECO-05 | Sättigung | Hollow Ridge, alle 6 eigenen Spots belegt, t = 4:00, Tech-Upgrade läuft | Mex-Upgrade am nächsten Ring-Mex startet ≤ 2 s später, höchstens eines parallel zum Tech-Upgrade | L2 | MS9 |
| AI-ENG-01 | Idle-Engineers | KI gegen KI 30 min, 50 Seeds | Idle-Engineer-Zeit < 15 % in jedem Lauf | H | MS9 |
| AI-ENG-02 | Neuplanung abgelehnter Platzierung | Bauplatz fac2 per Mauer blockiert, nachdem die Perception ihn frei zeigte | Sim lehnt ab; nächster Think plant per Spiralsuche neu; Fabrik steht ≤ 5 s später als ohne Blockade | L2 | MS9 |
| AI-ENG-03 | Patrol-Reclaim | 10 Wracks in der eigenen Zone | ein Patrol-Engineer reclaimt alle ohne weiteren Befehl | L2 | MS11 |
| AI-ENG-04 | Scout-Denial | je ein feindlicher Funke steht still an 3 Expansions-Clustern | Engineers bauen weiter (Threat < `T_eng`), Jagdauftrag an eine Kampfeinheit ≤ 5 s, Mex-Zahl nach 5 min ≥ 90 % des Werts ohne Funken | L2 | MS9 |
| AI-FAC-01 | Konter-Tabelle | 12 sichtbare feindliche Stichel | nächster Mix: Punze ≥ 60 %, Kelle ≥ 25 % (Normal) | L2 | MS9 |
| AI-FAC-02 | AA-Reaktion Mix | 5 feindliche Dohlen sichtbar | Sieb-Anteil ≥ 25 % in der nächsten Schleife | L2 | MS12 |
| AI-PLT-01 | Rückzug bei R < 0,7 | (a) 7 gegen 11 Punzen (R = 0,64); (b) 7 gegen 10 Punzen (R = 0,70, Grenzfall); (c) nach dem Rückzug aus (a) 8 gegen 10 (R = 0,8) | (a) Rückzugsbefehl ≤ 2 s nach Sichtkontakt (Reaktionsverzögerung + 2 Thinks + lead); (b) kein Rückzug; (c) kein Wiedereinstieg, solange R < 1,0 | L2 | MS9 |
| AI-PLT-02 | Welle und Staging | `eco_standard`, kein Gegner-Militär | erste Welle ≤ 8:00 mit ≥ 8 Einheiten, sammelt am Staging-Punkt, Attack-Move zum wertvollsten Ziel | L2 | MS9 |
| AI-PLT-03 | Raid-Ziel | ungeschützter Außen-Mex vs. Mex mit Riegel | Raid-Platoon wählt den ungeschützten | L2 | MS11 |
| AI-PLT-04 | Vogt-Köder | 3 Stichel beschießen den Vogt und ziehen sich zurück, 12 Punzen warten 90 WU vor der Basis | Vogt verlässt die Leine (60 WU um die nächste Fabrik) nie und lebt nach 180 s | L2 | MS9 |
| AI-PLT-05 | Pflichtangriff | Gegner hält den Brückenkopf mit 3 Riegel I, R_ziel bleibt < 1,2 | erste Welle geht spätestens bei `waves.maxS` in ATTACK (Ziel mit dem höchsten R_ziel), Rückzug bei R < 0,7 | L2 | MS9 |
| AI-INT-01 | Scout-Zeit | Setons und Hollow Ridge, je 50 Seeds | Gegnerbasis gesehen ≤ 4:00 in 100 % | H | MS11 |
| AI-INT-02 | Threat-Verfall | Feind-Pulk sichtbar, dann im Fog | `T_surface` halbiert sich nach 13–14 s, Ghost-Strukturen bleiben | U | MS11 |
| AI-DEF-01 | Minimal-A8 | Stichel-Raid auf einen 3-Mex-Cluster bei 5:00 | genau ein Riegel I am Cluster beauftragt | L2 | MS9 |
| AI-DEF-03 | Poke-Riegel | Funke läuft durch einen 3-Mex-Cluster, ohne zu schießen | kein Riegel beauftragt | L2 | MS9 |
| AI-DEF-02 | PD/AA ≤ 60 s | Raid (Boden) und separater Luftkontakt | Riegel bzw. Rost: Baubeginn ≤ 60 s nach erstem Schaden/Kontakt | L2 + H | MS11 |
| AI-AIR-01 | AA-Quote | 5 feindliche Flugzeuge erscheinen bei 8:00 | AA-Anteil der Produktion ≥ 20 % in ≤ 90 s, 200 Läufe | H | MS12 |
| AI-AIR-02 | Bomber-Snipe | 10 Dohlen greifen den Vogt an (Normal) | Vogt überlebt ≥ 70 % (untere Grenze), 200 Läufe | H | MS12 |
| AI-TECH-01 | T2-Gate | Turnier `ms9`, 3 Karten | T2 ≤ 12 min in ≥ 90 % (untere Grenze) | H | MS9 |
| AI-TECH-03 | T3 + T3-Artillerie | Turnier `ms13` | T3 ≤ 25 min in ≥ 80 %, Pfanne oder Hochofen im Einsatz | H | MS13 |
| AI-MIC-01 | Kiting (Hard) | 6 Kelle gegen 4 Punzen auf offener Fläche | Kellen halten ≥ 20 WU Abstand in ≥ 80 % der Ticks, gewinnen | L2 | MS14 |
| AI-MIC-02 | Focus Fire (Hard) | 10 Punzen gegen 10 Punzen, Normal vs. Hard | Hard gewinnt ≥ 65 % (200 Läufe) | H | MS14 |
| AI-AIX-01 | AIx-Modifier | AIx 1,5, 60 s Eco | Einkommen und Baufortschritt exakt × 1,5 (Sim-Golden), Replay enthält AIx | L2 | MS14 |

Jeder Fehler aus Turnieren wird über „Export scenario“ (Dev-Konsole) als weiteres Szenario festgehalten.

---

## 10. Werkzeug `tools/ai-sim`

`ecosim.py` rechnet die Eröffnungen samt vereinfachter Manager nach (kein pnpm-Paket, Python + numpy/scipy/Pillow, < 5 s):

- **Eco:** 10-Hz-Ticks; alle Baustellen, Fabrik-Aufträge und Upgrades melden Bedarf `Kosten · BP / buildTime`; eine Ratio `min(Mass-Anteil, Energy-Anteil)` für alle (ein Tier, PLAN §3.4); Speichergrenzen mit Overflow; Einkommen und Unterhalt aus dem Roster; Glutkranz-Adjacency.
- **Wege:** Dijkstra auf dem 2-WU-Raster der echten Heightmap von beiden Starts (liefert Zonen, Unerreichbarkeit, Spot-Reihenfolge, Rally-Distanz); zwischen Baustellen Luftlinie × Umweg-Median (1,1).
- **Manager-Light:** Energie-Bilanz und Notfall-Vorgriff, Mass-Senken (mit Abzug beschlossener Senken und „Energie zuerst“), Sättigungsregel, Tech- und Mex-Upgrade-Auslöser, Task-Board mit Basis-Radius und Alter, Assist-Sollbesetzung, Bau-Assist bei Überschuss, T2-Engineers, Wellen mit Pflichtangriff bei `maxS`. Idle zählt wie in §5.3 auch Guard an einer Fabrik ohne Auftrag.
- **Befehle:** `--maps`, `--threat`, `--timeline <id> --map <karte>`, `--difficulty`, `--write-expect`, `--check` (siehe README). `--check` prüft zusätzlich die MS9-Gates (T2 ≤ 12:00, erste Welle ≤ 8:00, `waves.maxS` ≤ 450 s) und das MS10-Gate (Energie-Stall ≤ 5 %) für jede Eröffnung und Karte. `--timeline` gibt am Ende die Energie-Engpass-Fenster aus.

Die Formeln des Skripts sind die Referenz für die Umsetzung in `packages/ai`; weichen Engine und Skript bei `AI-OPEN-01/02` um mehr als 10 s ab, wird entweder das Modell (Annahmen) oder die Engine korrigiert, nie stillschweigend der Erwartungswert.

---

## 11. Annahmen und offene Punkte

1. **Baureichweiten** (Vogt 10 WU, Lehrling 6, Geselle 7, Meister 8), **Roll-off** (2 s) und **Warp-in** (0 s) stehen noch nicht in `roster.json`; beim Blueprint-Schema (MS4/MS6) als Felder aufnehmen und `assumptions` ersetzen.
2. **Startspeicher** „voll“ (650 M / 3.900 E) ist angenommen; MS4 legt es fest.
3. **Engineer-Neigungsgrenze:** Die Kartenanalyse nutzt 0,6 (PLAN-Beispiel Panzer). Weicht die Engineer-`maxSlope` ab, ändern sich Zonen nicht, aber Wege auf Hollow Ridge.
4. **Referenz-KIs für Turniere** (`ai-msN`) brauchen eine stabile Perception-Schnittstelle oder Adapter; vor MS10 festlegen, ob `PerceptionView` versioniert wird.
5. **Dritte MS9-Karte:** Das Kartenset M8 nennt 3 Karten; die dritte (512 WU) fehlt noch. Die Eröffnungen sind über `weights.maps.size512` bereits darauf eingestellt.
6. **Inseln auf Setons** bleiben ohne Transporter (U13, Post-MVP) für die KI tabu; kommt U13, gehen sie als `reachableBy: air-transport` in die Kartenanalyse.
7. **Konter-Tabelle und Threat-Werte** sind Startwerte; sie werden in MS9/MS10 mit den Turnieren nachgeschärft (Konter-Wirksamkeit je Regel als Turnier-Bericht).
8. **`AiStatic` um Startpositionen ergänzen:** PLAN §3.10 listet `map, spots, passLowRes, sectors, bps`. Die KI braucht zusätzlich `starts[]` und `armyStart[army]` aus dem Skirmish-Setup (§3, Punkt 0). Bei Zufallsspawns (A18) nur die Kandidatenliste.
9. **`PerceptionView.freeMassSpots()` / `canPlace`:** Die Semantik „nur bekannte Belegung“ (§5.3) muss in der Schnittstelle stehen und mit `AI-PERC-02` abgesichert werden, bevor MS9 beginnt; sonst entsteht der Fog-Leak im Engine-Code, nicht in der KI.
10. **Overflow auf Setons** (4–13 % ohne Gegner, `tech_greed` 4–6 min ≈ 2.300 M): Die Fabriken an der Basis entstehen langsamer, als 40+ Spots Einkommen bringen. Kandidaten für MS10: Fabrik-Bauaufträge mit Sollbesetzung 2–3, Erzspeicher als Puffer ab 30 M/s. Entscheidung nach den ersten Turnieren, weil Gegnerdruck das Einkommen ohnehin stark senkt.
11. **Energie-Reservierung für das Tech-Upgrade:** Das Landwerk II zieht mit Vollassist ≈ 215 E/s (11.000 E in ≈ 51 s). Es läuft bisher nur über die Auslösebedingung (Überschuss ≥ 60 E/s oder `S_E ≥ 2.000`) und die Energie-Bilanz; die Rechnung zeigt dort keinen Engpass. Taucht er in Turnieren auf, bucht der TechManager `R_E` wie die Mass-Senken.

---

## 12. Review-Entscheidungen

Kritisches Review vom 2026-09-29: Build-Order-Timings nachgerechnet (Flow-Eco, Build Power, Engpässe), mit FAF-1v1-Konventionen verglichen, Nicht-Cheaten, Determinismus und Operationsbudget geprüft, Exploits gesucht und die Gates auf Testbarkeit geprüft. Alle Änderungen sind oben eingearbeitet. `ecosim.py --check` ist grün, `expect` ist neu geschrieben.

### 12.1 Nachrechnung und Vergleich mit FA

- **Handrechnung der ersten Minute** (stimmt mit dem Skript überein): Landwerk I = 1,9 s Laufweg + 300 / 10 BP = 31,9 s (Skript 31,8 s); Verbrauch 8 M/s und 70 E/s, gedeckt aus dem Startspeicher (nach der Fabrik 442 M / 2.440 E). Lehrling 1 = 31,8 + 260 / 20 + 2 s Roll-off = 46,8 s. Lehrling 4 = 88,8 s. Glutkessel I am Vogt 12,5 s, Zapfstelle I 6 s.
- **Amortisationen** nachgerechnet: T1→T2 (900 + 7 E/s × 3,75 M je E/s) / 4 M/s = 232 s; T2→T3 389 s. Threat-Werte (Vogt 1.095, Punze 84, Meißel 294, Riegel I 474), Eröffnungsgewichte (normierte Anteile in §4.4) und Budget-Summen (12.000 / 24.000 / 40.000) stimmen.
- **FAF-Konventionen** (eigene Werte, nur die Struktur verglichen): Vogt-Queue „Fabrik → 2 Kraftwerke → Ring-Mex → Kraftwerke“, 3–4 Lehrlinge mit frühem Scout, Hydro durch Engineer 3 und T2 um 6:30–9:30 entsprechen gängigen FAF-1v1-Eröffnungen. Abweichungen: (a) Auf 10-km-Karten rüsten FAF-Spieler Mex ab etwa 4 min auf, statt mit flachem Einkommen auf T2 zu warten. Das ist mit R-01 korrigiert. (b) In `eco_standard` steht das zweite Landwerk erst um 4:00, bei FAF meist um 2:30–3:30. Das bleibt so: Auf Setons (20 km) bringt Expansion mehr, und `land_rush` deckt die frühe Variante ab. (c) FAF-AIx sieht die ganze Karte. Hier ist AIx bewusst nur Eco und Build Power (A10 bleibt gewahrt).
- **Grenze der Stärke-Schätzung:** R = Σ√(DPS·HP) ist die Wurzel des Lanchester-Verhältnisses, R < 0,7 bedeutet also etwa die halbe Kampfkraft. Die Schwelle kommt aus dem PLAN und bleibt, die Hysterese bis 1,0 ebenfalls (§5.5).

### 12.2 Entscheidungen

| ID | Befund | Entscheidung | Wirkung / Beleg | Stelle |
|---|---|---|---|---|
| R-01 | Hollow Ridge: ab 2:41 kein freier Spot, Einkommen bis 8:45 flach bei 13 M/s. Die Mass-Senke griff nie, weil Guard-Engineers die Mass verbrauchen und der Speicher nie volllief | Sättigungsregel: Mex-Upgrades ab `saturatedS`, auch während des Tech-Upgrades (dann höchstens 1) | 12-min-Einkommen Hollow Ridge: `eco_standard` 25 → 41, `tech_greed` 33 → 45, `air_opener` 25 → 33 M/s; T2 bleibt ≤ 10:03 | §5.1, §5.2, JSON `mexUpgrade.saturatedS` |
| R-02 | Setons `eco_standard`: Um 10:50 starteten fünf Mex-Upgrades gleichzeitig (300 E/s), der Speicher war um 11:34 leer, der Engpass hielt bis Spielende (3,4–4,0 % statt 0,5 %) | „Energie zuerst“: Sofort-Verbraucher starten nur bei `E_frei` ≥ Bedarf, Speicher auf 90 s verteilt; sonst Reservierung, Kraftwerke zuerst | E-Stall `eco_standard` Setons 1,1 %, alle anderen ≤ 0,4 % | §5.1, `AI-ECO-04` |
| R-03 | Beschlossene Fabriken auf dem Board zählten beim nächsten Senken-Takt nicht mit. `tech_greed` Setons beschloss 9 Fabriken in 30 s | Board-Senken vor der Verteilung abziehen | weniger Doppelbestellungen; Overflow bleibt Bericht-Kennzahl (§11 Punkt 10) | §5.1 |
| R-04 | Freie Engineers bewachten Fabriken, während Senken-Baustellen mit einem Bauer liefen | Task-Board Prio 12: Bau-Assist bei `S_M / C_M ≥ 0,3` | Senken entstehen schneller | §5.1, §5.3 |
| R-05 | Exploit: Ein Stichel (Threat 40 = alte Schwelle) oder ein Kratzer am Vogt verwarf die ganze Eröffnung | Zwei Stufen: lokale Abwehr (Pause, 15 s) und Verteidigungsmodus erst bei Threat ≥ max(160, 0,5 × eigene Armee) über 5 s, 2 Strukturverluste oder Vogt-HP < 80 % | Poke kostet die KI ≤ 20 s statt der Eröffnung | §4.3, `AI-OPEN-04/05` |
| R-06 | Exploit: Engineer-Flucht schon bei `T_surface > 0`. Ein stehender Funke (12 M) hätte je Cluster die Expansion gesperrt; Minimal-A8 baute bei bloßer Anwesenheit einen Riegel (240 M) | Fluchtschwelle `T_eng = 20` bzw. Schaden, Scout-Jagd als P1-Auftrag; Minimal-A8 nur nach Schaden | Scout-Denial und Poke-Riegel wirkungslos | §5.3, §5.7, `AI-ENG-04`, `AI-DEF-03` |
| R-07 | Cheat: Der feindliche Vogt zählte ×1,5 bei `S_E ≥ 7.500`, also nach dem feindlichen Speicherstand; Blips nach der „Tech-Stufe des Gegners“ | Feindlicher Vogt ×1,5 nach gesehenem Glutspeicher oder ab 5:00; Blips nach der höchsten gesehenen Tech-Stufe | Schätzung nur aus sichtbarem Wissen | §1, §5.5, `AI-PERC-03` |
| R-08 | Fog-Leak: `freeMassSpots()` und `canPlace` der PerceptionView waren nicht definiert. Mit Sim-Belegung verraten sie feindliche Zapfstellen im Fog | Nur Gelände, eigene und bekannte feindliche Objekte; Entdeckung über Sicht → Ghost → Neuplanung | Byte- und Verhaltenstest | §5.3, §11 Punkt 9, `AI-PERC-02` |
| R-09 | Exploit: Der Vogt „verteidigt bei R ≥ 1“ ohne Leine und ließ sich mit Ködern aus der Basis ziehen (Snipe) | Leine 60 WU um die nächste Fabrik (Hard 120 WU), Abstich nur innerhalb; Burst-Rückzug bei Zeit bis zum Tod < 20 s | Köder- und Bomber-Snipe über eine Regel | §5.5, `AI-PLT-04`, `AI-AIR-02` |
| R-10 | Threat-Grid: Die Kostenangabe (≈ 6.000 ops) übersah den Verfall über 4.096 Zellen (≈ 11.000 ops). Ohne Leeren der Live-Werte hätten sich stehende Einheiten jede Sekunde aufaddiert | Live-Ebene je Takt neu, Gedächtnis mit Lazy-Verfall über LUT, Kosten neu gerechnet (≈ 6.900 ops bei 300 + 300 Einheiten, darüber Cursor) | passt ins Normal-Budget, deterministisch | §2.3, §2.5, §5.6 |
| R-11 | Die Herkunft des Gegner-Starts war offen (`AiStatic` enthält ihn laut PLAN nicht) | Startpositionen als Setup-Wissen (A3) in `AiStatic`; Zufallsspawns (A18) nur als Kandidatenliste | Nicht-Cheaten auch bei Zufallsspawns | §3, §11 Punkt 8 |
| R-12 | Scout-Umschaltung „bis 3:00“: Auf Hollow Ridge kommt der Funke erst um 3:10 an | Auslöser ist die erste Sichtung der Gegnerbasis, spätestens 4:00; zusätzlich ≥ 6 Kampfeinheiten | Regel auf beiden Karten erreichbar | §4.3 |
| R-13 | `tech_greed` Setons: Energie-Engpass 2:24–2:42, weil 6 Engineers gleichzeitig Zapfstellen bauen (je 30 E/s) | Vogt baut die 2 Glutkessel (eco) vor Ring-Mex 3 und 4 | E-Stall 2,8 → 0,0 %, T2 7:01 → 6:32 | §4.4, JSON |
| R-14 | `land_rush` auf 512 WU: Mit Sättigung T2 erst 10:37, also nur 1:23 Reserve zum 12-min-Gate | `techT2.minS` 540 → 480 s | T2 9:23 (Setons) / 10:03 (Hollow Ridge) | §4.4, JSON |
| R-S1 | Skript-Fehler: `count` in Fabrik-Queues wurde ignoriert (Funke kam vor Lehrling 2, `tech_greed` baute statt 3 Lehrlingen einen vor dem Funken) | `produce` mit `count` in Einzelaufträge zerlegt | Funke 0:50 → 1:03, Scout-Ankunft Setons 2:46 | `ecosim.py`, §4.5, §5.6 |
| R-G1 | Gate „erste Welle ≤ 8 min“ hing an `R_ziel ≥ attackRatio`. Zwei gleich starke KIs erreichen das im Spiegel-Turnier selten. `maxS` = 540 s (`tech_greed`, `air_opener`) lag zudem hinter dem Gate | Pflichtangriff bei `maxS`, `maxS` ≤ 450 s (von `--check` geprüft) | Gate ist konstruktiv erfüllbar | §5.5, §7.1, `AI-PLT-05` |
| R-G2 | `AI-PLT-01` „7 gegen 10 Punzen (R = 0,7 − ε)“ ergibt genau 0,7, also nach der Regel < 0,7 keinen Rückzug | Drei Fälle: 7:11 Rückzug, 7:10 kein Rückzug (Grenzfall), 8:10 kein Wiedereinstieg | Test ist eindeutig | §9 |
| R-G3 | Die Idle-Definition „Guard zählt als beschäftigt“ machte das Gate < 15 % trivial | Guard an einem Ziel ohne Arbeit zählt als idle, auch im Skript | Gate misst echte Untätigkeit | §5.3, §7.1, `ecosim.py` |
| R-G4 | Das Energie-Stall-Gate hatte keine Aggregation und bestrafte Kampfschaden | Gepoolt ≤ 5 %, p90 je Spiel als Bericht, 60 s nach Verlust eines Kraftwerks oder Speichers ausgenommen | messbar und fair | §7.1, §7.2 |
| R-G5 | Wilson-Schwellen standen ungeordnet und nur als Quoten da. Im Spiegel-Turnier sind die zwei Seiten eines Spiels korreliert | Schwellen als Erfolgszahl und Quote; eine Stichprobe je Spiel (Army nach Seed-Parität) | Konfidenzaussage korrekt | §7.1 |
| R-G6 | Latenzen in Tests (≤ 1 s) waren mit Reaktionsverzögerung 0,5 s + 2 Thinks + lead 0,3 s nicht erreichbar | Fristen auf ≤ 2 s bzw. „≤ 2 Economy-Takte“ | Tests sind erfüllbar | §9 |
| R-D1 | Der Notabbruch (Wall-Clock) bricht die Browser-/Headless-Gleichheit, und halbe Manager-Zustände waren möglich | Cursor-Commit je Arbeitsschritt, Folge dokumentiert, Test | Replay bleibt gültig | §2.3, `AI-DET-04` |
| R-D2 | Die Kosten der Spiralsuche (≈ 200 ops) waren für Fabrik-Footprints zu niedrig | 120–480 ops je Suche | Budget realistisch | §5.3 |

### 12.3 Geprüft, ohne Änderung

- Kategorie-Rollen lösen für alle Tech-Stufen eindeutig auf (Skript bricht sonst ab).
- APM-Caps (40 / 120 / 300) liegen im Bereich menschlicher FAF-Spieler; die Vogt-Eröffnung als eine Shift-Queue (≤ 10 Records) passt in den Easy-Burst von 10.
- Die Reihenfolge der Manager, die Think-Slots und die Regel „kein Budget-Übertrag zwischen Thinks“ sind deterministisch.
- `AIx` als Sim-Modifier (`prodMult`, `effBP`) steht im Replay und im Regel-Hash; ein Wissensvorteil ist ausgeschlossen.
- Die Bomber-Snipe-Rechnung stimmt: 10 Dohlen × 68 DPS ≈ 680 DPS, der Vogt (12.000 HP) lebt ≈ 18 s im Dauerfeuer. Die Burst-Regel (R-09) löst damit sofort aus, Rost und Sieb-Eskorte (§5.7) müssen den Rest leisten; das MS12-Gate misst es.
