# TRACK-AI · tai-p3-build-managers – Bau-/Eco-Manager (Welle 1)

Stand: 2026-09-30 · Branch `track-ai` · Vorarbeits-Track (kein PLAN-Meilenstein, keine echte Sim).
Arbeitsverzeichnis: Git-Worktree `flow-and-fire/.worktrees/faf-ai` (der im Auftrag genannte Pfad
`/Users/logge/Documents/Projects/faf-ai` existiert nicht; der Worktree des Branches `track-ai` liegt dort).

## Umgesetzt

Vier Manager in `packages/ai/src/managers/{opening,engineer,economy,tech}/`, je mit `ManagerFactory` aus `index.ts`
(`openingManager`, `engineerManager`, `economyManager`, `techManager`). P0-Verträge und `src/index.ts` unverändert.

| Datei | Inhalt |
|---|---|
| `engineer/shared.ts` | `BuildShared` (gemeinsamer Unterzustand der vier Manager, per `WeakMap` am Blackboard), Rollen-Konstanten `ROLE` (Leitplanke 2), Task-Marker `@acu`/`@eng`, ai.md-Konstanten, Blueprint-Klassen (`BpFlags`), Struktur-Index je Think, Spot-Threat-Cache |
| `engineer/placement.ts` | Selektoren §4.2 → Platz: `slot:<name>` (facN im 13-WU-Raster weiter), `slot:eco` (Ring r = 12/18/24 WU, dann an Fabriken), `near:<slot>`, `kranz`, `ring`, `mex:next`, `hydro:next`, `spot:<i>`, feste Position (Wiederaufnahme); `canPlace` → Spiralsuche (24 Kandidaten, r ≤ 12 WU, 2-WU-Raster, `canPlaceCost` je Kandidat) → nächster Vorlagenplatz; geplante Plätze (`planned`), abgelehnte Footprints, Reservierungen |
| `engineer/spots.ts` | Spot-Score §5.1 (Weg × Umweg + 0,5 · d_own + Threat-Aufschlag ab T_eng + 400 umkämpft ohne Deckung; Sperre > 150 ohne Deckung; umkämpft erst ab 6:00/T2 und mit Platoon am Staging-Punkt), Deckung, freie Spots zählen |
| `engineer/jobs.ts` | Auftragsstatus aus der Perception (`pending/running/stalled/done/lost`, Bestätigungsfenster lead + 2 Thinks) |
| `engineer/manager.ts` | EngineerManager §5.3 |
| `opening/plan.ts`, `opening/runner.ts` | OpeningRunner §4.1–§4.4 |
| `economy/balance.ts`, `economy/manager.ts` | EconomyManager §5.1 (Formeln als reine Funktionen) |
| `tech/manager.ts` | TechManager §5.2 (T1 → T2) |

### OpeningRunner (`opening`, Reserve-Budget, jeder Think)
- **Vogt:** Beim Erzeugen werden so viele Ring-Spots reserviert, wie die Vogt-Queue `ring`-Schritte hat (Eigentümer
  `opening:acu`, AI-OPEN-03). Alle Schritte mit festem Platz gehen als **eine** Gruppe von Build-Records (P2,
  erster ersetzend, Rest mit Shift) hinaus; `mex:next`/`hydro:next` werden nachgereicht, sobald der Vogt am letzten
  ausgegebenen Schritt arbeitet. Fortschritt: aktueller Auftrag des Vogts ⇒ vorherige Schritte abgeschlossen
  (Struktur fertig) oder fehlgeschlagen (keine Struktur ⇒ Neuplanung, abgelehnter Footprint gemerkt, 3 Fehlschläge ⇒
  Schritt verworfen). Handoff an den EngineerManager (`handoverAcu('opening','engineer')`), wenn alle Schritte erledigt.
- **Vogt-Übergaberegel:** Hält der PlatoonManager den Vogt (`acuOwner = 'platoon'`), pausiert die Queue; nach der
  Rückgabe wird der unerledigte Rest an derselben Stelle neu ausgegeben (Test).
- **Energie-Notfall:** die vom EconomyManager markierte Kraftwerks-Aufgabe (`acuFrontTask`) wird als Schritt vorn
  eingefügt und die Queue ersetzend neu ausgegeben.
- **Fabriken:** Sobald eine Fabrik am Slot steht: `claimUnit(h,'opening')`, eine P3-Gruppe aus SetRally
  (`analysis.rally`), `FactoryQueue` je `produce` (mit count; Engineers in der Tech der Fabrik) und `FactoryRepeat`
  der `loop` (`RoleTable.bestFor`: höchste baubare Stufe). Produktion wird über neu erscheinende Einheiten nahe der
  Fabrik verfolgt; Handoff (`handedOffFactories`, Freigabe des Claims), sobald die Queue leer ist und die Schleife
  läuft, spätestens 5:00. Bei ausbleibender Bestätigung (APM) wird die Einrichtung wiederholt.
- **Engineers:** Pläne in Spawn-Reihenfolge (firstSeenTick, Handle), `claimUnit(h,'opening')`; ein Schritt nach dem
  anderen mit `stepDelayS`; `fallback` (kein Hydro ⇒ 4 × Glutkessel I); Schritt ohne Platz entfällt (wie ecosim);
  leere Liste ⇒ Handoff (`handedOffEngineers`, Telemetrie). Tod mit Feindkontakt ⇒ Spot 30 s gesperrt.
- **Lokale Abwehr:** Kampfeinheit/Vogt im 60-WU-Basisradius oder Schaden am Vogt ⇒ `bb.opening.localDefense`; je
  Episode eine Punze (sonst Stichel) vorgezogen: auf einer Eröffnungs-Fabrik sofort (Queue ersetzt: Einheit +
  verbleibende Produce-Aufträge), die `productionRequest` wird angelegt und im selben Think erfüllt/entfernt; ohne
  Eröffnungs-Fabrik bleibt sie für den FactoryManager liegen. Einzelne Späher ⇒ `huntRequest`. Wiederaufnahme 15 s
  nach dem letzten Kontakt.
- **Verteidigungsmodus** (vor 5:00): Boden-Threat in der eigenen Zone ≥ max(160, 0,5 × eigener mobiler Boden-Threat
  ohne Vogt) über 5 s (Reiz mit Reaktionsverzögerung), ≥ 2 Strukturen in 30 s verloren oder Vogt-HP < 80 % ⇒
  `defenseMode`, Telemetrie `defenseMode {reason}`, `productionRequests` 2 × Punze + 2 × Stichel (Prio 95), Riegel-I-Task
  (Prio 95, `site: Vec2`, 6 WU vom bedrohten Ring-Mex zur Bedrohung), alles übergeben, Rest verworfen.
- **Scout-Umschaltung** `tech_greed` → `eco_standard` bei erster Sichtung der Gegnerbasis (Kontakt ≤ 60 WU um den
  Gegner-Start oder `scoutSeenEnemyBase`) bis 4:00 mit ≥ 2 Landwerken oder ≥ 6 Kampfeinheiten.
- **difficultyTiming:** `stepDelayS` (Easy: Einzelschritte mit Pause), `skipChance` (bei der Erzeugung mit dem
  eigenen RNG in Dokumentreihenfolge gewürfelt), `engineerCapFactor` (EngineerManager), `techDelayS` (Tech/Economy),
  `waveExtra` → `bb.opening.waveExtra`.

### EngineerManager (`engineer`, jeder Think)
- Bauer = fertige Engineers ohne fremden Claim + Vogt ab `acuOwner = 'engineer'` (nur Basis-Aufgaben ≤ 60 WU,
  Ring-Mex, `@acu`-Assists; nie `hydro:next`).
- Zuteilung in Board-Reihenfolge; Basis-Aufgaben (Selektoren `slot:/near:/kranz/ring`, Positionen ≤ 80 WU) nur an
  Bauer ≤ 80 WU, ab 20 s Alter an jeden; Kosten = Weg/Tempo + Restzeit (Bauer mit ≤ 10 s Restbau bekommen die
  Aufgabe per Shift hinten angehängt); Tech per `canBuild`; wer eine Expansion außerhalb der Basis beendet, bekommt
  zuerst die nächste `mex:next`-Aufgabe (Score ab seiner Position).
- Platzierung siehe oben; `commandRejected` ⇒ im nächsten Think Spiralsuche ohne Überlappung mit dem abgelehnten
  Footprint (AI-ENG-02); ausbleibender Auftrag ⇒ Fehlschlag; 3 Fehlschläge ⇒ Platz 60 s gesperrt.
- Sicherheit: T_surface ≥ 20 ohne Deckung (eigener Kampf-Threat in 40 WU ≥ Feind-Threat) oder Schaden ⇒ Move (P1)
  zum nächsten verteidigten Punkt (Fabrik, Riegel, Platoon), Aufgabe zurück aufs Board, Spot/Platz 30 s gesperrt.
  Späher in 40 WU eines Engineers ⇒ `huntRequest` (ein Eintrag je Ziel, Position aktualisiert).
- Idle (R-G3): freie Bauer ohne Board-Aufgabe ⇒ Bau-Assist (Prio 12; Baustelle ≥ 150 Mass ≤ 80 WU, S_M/C_M ≥ 0,3, ≤ 4
  Bauer; nicht der Vogt) bzw. Guard an der nächsten arbeitenden Fabrik (Prio 10); alle 10 s neu bewertet, ohne Befehl,
  wenn das Ziel gleich bleibt. Reparatur-Aufgaben Prio 30 (< 70 % HP, kein Feind in 30 WU).
- `bb.engineerTarget = min(max(1, ⌊cap(t) × engineerCapFactor⌋), base + ⌈freie Spots (own + contested) /
  perFreeSpots⌉) + engineerBonus`. Räumt das Task-Board auf (`prune`).

### EconomyManager (`economy`, 1 Hz)
Energie-Bilanz mit `horizonFor(profile, energy.horizonS)` (Easy 10, Normal Eröffnung, Hard 60), R_E-Verfall,
Glutkessel II (3 Bauer) bei T2-Engineer und deficit ≥ 150, sonst n = ⌈deficit/20⌉ − laufende (≤ maxInflight +
⌊(P_E − U_E)/100⌋), Platz `kranz` solange frei, sonst `slot:eco` (Ring, dann an Fabriken); Dampfquelle zuerst bei
Engineer ≤ 120 WU (zählt als 5 Glutkessel); Glutspeicher ab `estore.atS` (Prio 70); Notfall (leer in ≤ 10 s) ⇒
älteste unvergebene Glutkessel-Aufgabe (≥ 5 s alt) Prio 100 vorn beim Vogt. Mex-Upgrades nach Zeitplan (minS +
techDelayS oder Sättigung, P_M-Schwelle, maxParallel, während Tech nur bei Sättigung und dann 1) und als Mass-Senke
(Tabellenreihenfolge, ≤ 4 Maßnahmen/s, Abzug beschlossener Fabrik-Senken R-03, „Energie zuerst“ mit E_free);
Lebensdauer/Amortisation aus dem Roster (232 s ⇒ Schwelle 278 s; umkämpft = 0); Assist-Aufgabe Prio 40 (`@eng`).
Expansion: `mex:next`-Aufgaben Prio 50 = min(freie Spots, freie Engineers + 1), eine `hydro:next`-Aufgabe Prio 45.

### TechManager (`tech`, 1 Hz)
Auslöser §5.2 (minS + techDelayS, P_M ≥ min(minMassIncome, 0,8 × max. T1-Einkommen der eigenen Zone), Überschuss ≥
minEnergySurplus oder S_E ≥ 2.000) ⇒ Upgrade des Landwerks mit kleinstem Abstand zum Start (P2), `bb.tech`,
Telemetrie `techStart/techDone`, Assist-Aufgaben Prio 80 (`tech:assist` für `assistEngineers` Engineers, `tech:acu`
für den Vogt nur ohne feindliche Kampfeinheit im Basisradius), Wiederholung bei ausbleibender Bestätigung, danach
`productionRequest` für `t2Engineers` Gesellen. T2 → T3 ist MS13.

## APIs und Verträge für Folgepakete (tai-p5)

- Factories: `import { openingManager } from './managers/opening/index.ts'` usw.; Reihenfolge/Takt über
  `MANAGER_ORDER`/`runsOnThink` (opening jeder Think, economy/tech gerade k, engineer jeder Think).
- Reservierungs-Eigentümer: `opening:acu` (Vogt-Plätze, Ring-Vorreservierung mit holder 0), `opening` (Plan-Engineers,
  Claims von Fabriken/Engineers), `engineer` (EngineerManager). Andere Manager dürfen Spots nur über
  `isSpotAvailable` prüfen.
- Task-Board: Build-Aufgaben tragen ihre Rolle (`site` = Selektor, `spot` bei festen Spots); Assist-Aufgaben mit
  `role '@acu'` (nur Vogt) bzw. `'@eng'` (nur Engineers). Sobald eine Baustelle steht, setzt der EngineerManager
  `task.site` auf die Position und `task.siteHandle` (Wiederaufnahme durch einen anderen Bauer).
- `peekBuildShared(bb)` liefert den gemeinsamen Unterzustand (Diagnose/Tests).

### Blackboard-Nutzung

| Abschnitt | liest | schreibt |
|---|---|---|
| `units`, `enemy`, `stimuli` | alle vier | – |
| `taskBoard` | alle vier | Economy/Tech/Opening legen an; Engineer weist zu, schließt ab, `prune` |
| `reservations` | alle vier | Spots/Plätze (Opening, Engineer), Unit-Claims `opening`, `handoverAcu` |
| `eco` | Economy | Economy (`reservedE`, `sinks`, `deficitE`, `energyEmptyInS`, `emergency`) |
| `threat` | Engineer, Economy, Opening | – |
| `engineerTarget` | – | Engineer |
| `productionRequests` | – | Opening (Abwehr), Tech (T2-Engineers) |
| `huntRequests` | – | Engineer, Opening (anlegen, Position nachführen) |
| `platoons` | Engineer (Deckung, Staging) | – |
| `tech` | Economy, Engineer (Spots) | Tech |
| `opening` | alle | Opening (`id` = wirksame Eröffnung, `active`, `defenseMode*`, `localDefense`, `handedOff*`, `waveExtra`) |
| `telemetry` | Opening (`scoutSeenEnemyBase`) | `handoff`, `defenseMode`, `openingSelected` (Umschaltung), `mexUpgradeStart`, `techStart`, `techDone` |

### Gemeldete Vertragslücken

1. **Gemeinsamer Unterzustand** (`BuildShared`, WeakMap je Blackboard): wirksame Eröffnung nach der
   Scout-Umschaltung, `engineerBonus` (Mass-Senke → Engineer-Sollzahl), `acuFrontTask` (Notfall → Vogt-Queue),
   `openingPendingPowerE`/`openingPendingEstore` (Eröffnungs-Schritte als laufende Kraftwerke), `planned` (entschiedene,
   noch unsichtbare Plätze – nötig, damit zwei Manager nicht denselben Platz wählen), `slotActual`, abgelehnte
   Footprints. Vorschlag: als Blackboard-Abschnitt `build` aufnehmen.
2. **Wirksame Eröffnung:** `bb.opening.id` enthält nach der Umschaltung `eco_standard`; `ctx.opening` bleibt die
   Auswahl aus `init`. Platoon/Factory sollten `followUp`/`waves` über `openings.find(o => o.id === bb.opening.id)`
   lesen.
3. **Rückmeldung des Emitters:** Manager erfahren weder APM-/Budget-Drops noch die `seq` eines Records;
   `commandRejected` lässt sich deshalb nur über `unit` zuordnen. Heute wird alles über die Perception bestätigt
   (Fenster lead + 2 Thinks). Vorschlag: `emit` liefert eine Request-ID, `flush` meldet `seq`/Drops je ID.
4. **Bauer-Einschränkung als Feld:** Die Marker `@acu`/`@eng` in `Task.role` sollten ein eigenes Feld werden
   (`builders: 'any' | 'commander' | 'engineers'`).
5. **Fremde Upgrade-Befehle:** Tech- und Mass-Senken-Upgrades gehen direkt an Fabriken des FactoryManagers bzw. der
   Eröffnung; eine ersetzende `FactoryQueue` während eines Upgrades darf das Upgrade in der Sim nicht abbrechen.
6. **Build auf eigener Baustelle** = Weiterbau (FA-Semantik) wird angenommen (Wiederaufnahme, Arena tai-p2).
7. **Wracks** fehlen in der Perception ⇒ Reclaim-Aufgaben (Prio 20) nicht umgesetzt (MS11, C12).
8. **Assist-Zählung:** `OwnRecord` zeigt nicht, wer eine Baustelle unterstützt; die Höchstzahl 4 beim Bau-Assist
   zählt nur Aufträge des EngineerManagers.

## Tests (packages/ai/test/managers/{opening,engineer,economy,tech}, 43 Tests, ≈ 1,2 s)

| Datei | Inhalt / ai.md-Test-IDs |
|---|---|
| `opening/opening.test.ts` (13) | `eco_standard`-Vogt-Queue als **eine** Shift-Queue mit Rollen/Plätzen (Setons und Hollow Ridge: fac1-Slot, 2 × Glutkessel angrenzend, 4 Ring-Mex = Ring-Spots in d_own-Reihenfolge, eco-Ring); **AI-OPEN-03** (Ring-Reservierung beim Start, Engineer 1 wählt keinen Ring-Spot); Fortschritt/Handoff des Vogts; Pause bei Vogt-Übernahme durch den PlatoonManager und Neuausgabe; Easy (Einzelschritte, `skipChance`, deterministisch); Fabrik-Gruppe (Rally, Produce mit count, Repeat höchste Tech), Handoff bei laufender Schleife und spätestens 5:00; **AI-OPEN-04** (6 Stichel ab 2:00 ⇒ Verteidigungsmodus bei t0 + 5 s + ≤ 2 s, Anfragen Punze/Stichel, Riegel-Task Prio 95 6 WU vom Ring-Mex); **AI-OPEN-05** (Stichel am Vogt + Funke ⇒ nur lokale Abwehr, Punze vorgezogen, Jagdauftrag, Wiederaufnahme nach 15 s); Abbruch über Strukturverluste und Vogt-HP; Scout-Umschaltung (nicht nach 4:00); Engineer-Handoff |
| `engineer/engineer.test.ts` (11) | **AI-ENG-02** (Ablehnung ⇒ Spiralsuche im nächsten Think, kein Überlappen, ≤ 12 WU); Fehlschläge ⇒ 60-s-Sperre und anderer Platz; **AI-ENG-04** (drei stehende Funken ⇒ keine Flucht, drei Jagdaufträge, Bau läuft); Flucht bei 3 Sticheln (P1-Move, Aufgabe zurück, Spot 30 s gesperrt); Basis-Regel 80 WU/20 s, Vogt-Regeln; **Idle-Regel** (Guard an arbeitender Fabrik; Bau-Assist ≤ 4 bei S_M/C_M ≥ 0,3); Vorrang vor Idle-Jobs; Anhängen hinter Restbau ≤ 10 s; Reparatur; Engineer-Sollzahl; **AI-DET-02-Unit-Teil** (Budget ×0,5 und ×0,04: dieselben Aufträge später, keine Duplikate, zwei Läufe identisch) |
| `engineer/flow.test.ts` (4) + `flow-play.ts` | alle vier Manager 10 min auf einer Spiel-Attrappe (`eco_standard`/`tech_greed` Setons, `land_rush` Hollow Ridge): Handoffs, Expansion, keine überlappenden Strukturen, Budgets je Manager und gesamt, T2 gestartet; Determinismus |
| `economy/economy.test.ts` (10) | Formeln (Bilanz, E_free, Anzahl, Amortisation 232 s, Lebensdauer); **AI-ECO-01** (+100 E/s ⇒ 2 Kraftwerke ≤ 2 Economy-Takte); Glutkessel II / Dampfquelle zuerst; Energie-Notfall ⇒ Glutkessel vorn in der Vogt-Queue; Glutspeicher; **AI-ECO-02** (Senken in Tabellenreihenfolge: Mex-Upgrade, 2 Landwerke, danach 3 Engineers; R_E gebucht; R-03); **AI-ECO-03** (nur Hinterland-Mex); **AI-ECO-04** (E_free = 100 ⇒ ein Upgrade, Kraftwerke vor dem nächsten); **AI-ECO-05** (Hollow Ridge gesättigt 4:00 während Tech ⇒ Ring-Mex-Upgrade ≤ 2 s, höchstens eines, Assist Prio 40); Expansionsaufgaben |
| `tech/tech.test.ts` (5) | Auslösung 6:30 (nächstes Landwerk, T2-Stufe, Telemetrie, Assist `@eng`/`@acu`); keine Auslösung ohne Einkommen/Energie/Zeit, S_E ≥ 2.000 als Ersatz; Abschluss (techDone, Level 2, Assists geschlossen, T2-Engineers angefragt); Engineers + Vogt assistieren (mit EngineerManager); Vogt-Assist nur ohne Feind im Basisradius |

Selbsttest: `pnpm exec vitest run packages/ai/test/managers/<ordner>` je Ordner grün; `heavy pnpm exec vitest run
packages/ai` 179/179 grün (inkl. Nachbarpaket und Determinismus-Guard); `heavy pnpm exec tsc -b packages/ai` und
`heavy pnpm exec tsc -p tsconfig.tests.json` ohne Fehler in `packages/ai`; ESLint auf den eigenen Pfaden sauber.

## Messwerte (Spiel-Attrappe, 1.440 Thinks = 12 min, Normal, M5 Pro)

| Lauf | max. ops/Think opening / economy / tech / engineer / emitter | Records | Vogt-Handoff | techStart |
|---|---|---|---|---|
| Setons `eco_standard` | 163 / 342 / 1 / 815 / 100 | 119 (9,9/min) | 0:40 | 6:30 |
| Setons `tech_greed` | 163 / 348 / 1 / 1.164 / 140 | 155 (12,9/min) | 0:56 | 5:30 |
| Hollow Ridge `eco_standard` | 66 / 72 / 1 / 65 / 100 | 51 | 0:40 | 6:30 |
| Hollow Ridge `land_rush` | 97 / 77 / 2 / 64 / 130 | 54 | 0:52 | 8:00 |

Budgets Normal: Engineer 5.000, Economy 2.000, Tech 500, Reserve 1.500 – überall < 25 %. Die Attrappe baut jeden
Auftrag in 4 s; die Zeiten sind daher keine Eröffnungs-Timings (AI-OPEN-01/02 misst tai-p5 in der Arena).

## Abweichungen (mit Begründung)

1. **Normal-`stepDelayS` 0,5 s** entfällt innerhalb der Vogt-Shift-Queue (eine Queue kann keine Pausen enthalten);
   ecosim addiert sie je Schritt ⇒ Normal bis ≈ 5 s früher. Easy (4 s ≥ ein Think) gibt Schritte einzeln aus.
2. **`slot:rally`** = `analysis.rally` (45 WU auf dem Pfad, §3 Punkt 4) statt der Luftlinien-Vorlage f = 45.
3. **`near:`/`kranz`** in Weltachsen (Footprints sind achsparallel, eine gedrehte Anlage würde überlappen), im
   Uhrzeigersinn ab der Seite, die +f am nächsten liegt; Positionen auf das 2-WU-Raster eingerastet.
4. **Spiralsuche:** 6 Ringe r = 2…12 WU, abwechselnd Achsen und Diagonalen, 24 Kandidaten; nur um den ersten
   blockierten Vorlagenkandidaten. Gesperrte Plätze (3 Fehlschläge) sind „blockiert“ (Spirale erlaubt), fremd
   reservierte „belegt“.
5. **Laufende Kraftwerke** in Glutkessel-Äquivalenten (E/s ÷ 20; Dampfquelle = 5); gezählt werden Baustellen,
   Board-Aufgaben ab Prio 90 und Eröffnungsschritte in den nächsten zwei Schritten je Bauer. Die Expansions-Dampfquelle
   (Prio 45) zählt nicht (sie wird evtl. nie erreicht).
6. **Notfall** nimmt nur Glutkessel-Aufgaben der Bilanz (ecosim `role == pgen`, ≥ 5 s unvergeben), keine Dampfquelle.
7. **Umkämpfte Spots** zusätzlich nur mit Platoon am Staging-Punkt (§5.1), ecosim ignoriert die Deckung.
8. **Engineer-Flucht mit P1** (Rückzugsbefehl wie Platoon-Befehle), nicht P2.
9. **Idle-Jobs** (Prio 12/10) sind interne Aufträge des EngineerManagers, keine Board-Aufgaben (sonst Board-Flut).
10. **Lokale Abwehr** pausiert nur den Vogt (über die Übergaberegel); Plan-Engineers bauen weiter. Vorgezogen wird je
    Episode eine Einheit.
11. **Verteidigungsmodus-Anfragen:** je 2 Punzen und 2 Stichel (Anzahl in ai.md offen).
12. **Scout-Umschaltung** ersetzt die offenen Vogt-Schritte ab demselben Index, die Pläne noch nicht zugeteilter
    Engineers und die Schleife der Eröffnungs-Fabriken; `openingSelected` wird mit `eco_standard` erneut gemeldet.
13. **Mass-Senke:** abgezogen werden nur beschlossene Fabrik-Aufgaben (R-03 wie ecosim); Engineer-Bonus ≤ 6.
14. **Mex-Upgrade** nur T1 → T2 (T2 → T3 = MS13); Tech bucht kein eigenes R_E (§11 Punkt 11).
15. **Ausbleibende Aufträge** (nach lead + 2 Thinks nicht in der Perception) gelten als Fehlschlag bzw. werden
    wiederholt (Fabrik-Einrichtung, Upgrades, Assists).
16. **Ring-Schritt ohne freien Ring-Spot** fällt (wie ecosim) auf den besten eigenen Spot zurück; der Vogt nimmt als
    Bauer des EngineerManagers nur Ring-Spots.

## Bekannte Grenzen

- Nur mit FakeWorld und einer Spiel-Attrappe geprüft; Eröffnungs-Timings (AI-OPEN-01/02), Idle-Quote und
  Stall-Anteil misst erst tai-p5 in der Arena.
- `LocalThreatEstimate`/Threat-Grid-Abfragen kosten je 1 op (Zellen-Semantik); die Schätzung selbst iteriert Kontakte.
- Spot-Score nutzt Luftlinie × Umweg (wie ecosim), keine Pfadlänge.
- Reclaim (Prio 20) fehlt bis zur Wrack-Perception (MS11).
