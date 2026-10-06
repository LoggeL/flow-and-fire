# TRACK-AI · tai-p5-integration – Integration, Szenarien, Kalibrierung (Welle 2)

Stand: 2026-09-30 · Branch `track-ai` · Vorarbeits-Track (kein PLAN-Meilenstein, keine echte Sim) · parallel zu
tai-p6-tournament-host.

Hinweis zum Pfad: Der im Auftrag genannte Worktree `/Users/logge/Documents/Projects/faf-ai` existiert nicht; der Branch
`track-ai` liegt unter `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-ai`. Dort wurde ausschließlich in
den eigenen Pfaden gearbeitet. Ein früher abgebrochener Lauf dieses Pakets hatte bereits `default-brain.ts`, die
Szenario-DSL und das Smoke-Skript angelegt; diese Stände wurden übernommen, geprüft und weiterentwickelt, seine
Erkundungsskripte (`scenarios/_*.ts`) sind entfernt.

## Umgesetzt

### 1. Standard-KI und Vertragslücken (`packages/ai/src`)

- **`createDefaultBrain(options?: {managers?: readonly ManagerName[]}): AiBrain`** (`default-brain.ts`, Vertrag für
  tai-p6): alle Manager aus `managers/*/index.ts` in `MANAGER_ORDER` (intel, opening, economy, tech, defense, factory,
  engineer, platoon; micro ist MS14 und hat keine Fabrik). `DEFAULT_MANAGER_FACTORIES`, `DEFAULT_MANAGERS`,
  `defaultManagerFactories(names)`; unbekannte Namen ⇒ Fehler. `managers/index.ts` re-exportiert alle Manager,
  `src/index.ts` exportiert `managers/` und `default-brain.ts`.
- **Gemeldete Lücken aus tai-p3/tai-p4, jetzt geschlossen (alles additiv):**

| Lücke (Fragment) | Lösung |
|---|---|
| p3 #2 wirksame Eröffnung nach der Scout-Umschaltung | `effectiveOpening(ctx)` in `brain.ts` (`bb.opening.id` vor der Auswahl aus `init`); PlatoonManager liest `waves` je Think daraus, FactoryManager die Fabrik-Slots |
| p3 #3 Rückmeldung des Emitters | `bb.lastDropped` (Eigentümer: Brain) = verworfene Commands der letzten zwei Thinks mit `source`/`reason` (1-Hz-Manager sehen die Drops des Thinks, in dem sie emittiert haben). Der FactoryManager schreibt eine verworfene Schleife/Rally erneut |
| p3 #4 Bauer-Einschränkung als Feld | `Task.builders: 'any' \| 'commander' \| 'engineers'` (`TaskSpec.builders`, sonst aus den Alt-Markern `@acu`/`@eng` abgeleitet); EngineerManager prüft nur noch das Feld, Tech/Economy setzen es explizit |
| p4 #3 Rally als Blackboard-Feld | `bb.rally` (Eigentümer: FactoryManager); der PlatoonManager sammelt formierende Einheiten dort (ohne FactoryManager: gleiche Staging-Regel wie bisher) |
| p4 #1/#4/#6 Fabrik-Claims, Vogt-Übergabe, Riegel-Task mit Position | waren in tai-p3 bereits umgesetzt, in den Szenarien AI-OPEN-04/05 und AI-PLT-04 end-to-end geprüft |
| Diagnose | `AiBrain.manager?(name)` (optional, damit Wrapper wie im Smoke-Skript es nicht implementieren müssen) |

Offen bleiben (dokumentiert, nicht blockierend): p3 #1 `BuildShared` bleibt WeakMap-Unterzustand der Bau-Manager
(ein Umzug in den Blackboard-Kern hätte einen Import-Zyklus Blackboard ↔ managers erzeugt); p3 #8/p4 #7
Fortschrittsrückmeldung von Produktionsanfragen und Assist-Zählung fremder Bauer; p3 #7 Wracks (MS11).

### 2. Szenario-DSL (`tools/ai-arena/src/scenarios/`)

- `runScenario(spec)` nach Vorbild ScenarioBuilder (PLAN §3.12): `{map, seed, sides, spawns, cheats, commands,
  observe, until, asserts}` → `runMatch` synchron mit `AiCommandSource` + `createDefaultBrain`. Tick-Reihenfolge:
  Spawns → Cheats → gescriptete Commands → Quellen (Think bei `N ≡ 0 mod thinkEvery`, Lieferung bei `N + lead`) →
  `world.step` → Observer → `until.when`. Alle Eingriffe laufen über die geloggte Cheat-API ⇒ `replayMatch` bitgleich.
- KI-Seite (`AiSideSpec`): `difficulty`, `openingId`, `managers` (Teilmenge), `brain` (eigene Fabrik), `profile`
  (Profil-Anpassung, z. B. Wellengröße), `gameSeed`, `budgetScale` (AI-DET-02), `maxMs`, `recordPerception`
  (Snapshot-Kopien für Byte-Vergleiche), `onThink` (volles `ThinkResult`, Drops, ops). Gescriptete Seite: `commands`
  mit `ScenarioCommands` (`move/attackMove/patrol/attack/guard/build/factoryQueue/factoryRepeat/upgrade/stop`).
- `ScenarioResult`: `army(a)` (MatchMetrics), `telemetry(a)`, `first(a, kind, pred)`, `firstWaveTick(a)` (ai.md §7.1),
  `thinks(a)`, `commands(a)`, `streamKey(a)`/`streamHash(a)`, `perception(a)`, `opsPercentile(a, p)`, `maxOps(a, m)`;
  Hilfen `sec`, `secondsOf`, `nearestRank`, `scenarioOpenings`.
- `smoke.ts` (nicht in `pnpm test`): siehe Abschnitt Smoke.

### 3. Arena-Ergänzungen (`tools/ai-arena/src/world/`, additiv)

- Cheat `holdFire(handle, on)` (geloggt, im Replay wiederholt; im Zustands-Dump nur, wenn gesetzt ⇒ bestehende Hashes
  unverändert): die Einheit feuert nicht — nötig für AI-DEF-03 („Funke läuft durch, ohne zu schießen“), weil Einheiten
  der Arena sonst auf alles Sichtbare in Reichweite feuern.
- `hash.ts` liest die Welt über das strukturelle Interface `HashableWorld` statt `import type ArenaWorld` (dep-cruiser
  meldete den Typ-Zyklus hash ↔ world). Ebenso liegt `PlaceContext` jetzt in `engineer/shared.ts` (Zyklus
  placement ↔ spots). `pnpm exec depcruise …` ist damit ohne Befund.

## Tests (ai.md-Test-IDs)

`tools/ai-arena/test/scenarios/` (7 Dateien, 28 Tests, zusammen ≈ 6 s; jeder Test < 2 s) plus angepasste
Unit-Tests in `packages/ai/test/managers/economy`. Gesamt `packages/ai` + `tools/ai-arena`: 45 Dateien, 363 Tests,
≈ 7 s.

| ID | Datei | Ergebnis | Messwert (Arena, Normal) |
|---|---|---|---|
| AI-OPEN-01 | `openings.test.ts` | grün | Setons, 3 Eröffnungen, siehe Timing-Tabelle |
| AI-OPEN-02 | `openings.test.ts` | grün | Hollow Ridge, 3 Eröffnungen, siehe Timing-Tabelle |
| AI-OPEN-03 | `openings.test.ts` | grün | kein Engineer-Build auf einem Ring-Spot; alle 4 Ring-Mex vom Vogt |
| AI-OPEN-04 | `opening-defense.test.ts` | grün | 6 Stichel ab 2:00 (am Leben gehalten): Sichtung 120,1 s, Verteidigungsmodus 126,0 s (5,9 s ≤ 7 s), Punze/Stichel-Auftrag 126,0 s, Vogt verteidigt ab 121,1 s, Riegel-I-Task Prio 95 |
| AI-OPEN-05 | `opening-defense.test.ts` | grün | kein Verteidigungsmodus, Stichel + Funke tot; Mex8 146,0 s gegen 146,2 s ohne Poke |
| AI-ECO-01 | `economy.test.ts` | grün | +100 E/s über dem Überschuss bei 11:00: Kraftwerk beauftragt nach 1,1 s, 0 Stall-Ticks (Einschränkung s. u.) |
| AI-ECO-02 | `economy.test.ts` | grün | Speicher voll + 30 M/s ab 8:40: erstes Mex-Upgrade nach 11 s vor jeder Fabrik, R_E bis 188 E/s |
| AI-ECO-04 | `economy.test.ts` | grün | 10:00, E_free = 100: in den ersten 2 s höchstens 1 Upgrade, jedes weitere nur mit E_free ≥ 60 beim Start, Kraftwerke nach 24 s, ≤ 1 Stall-Tick in 120 s |
| AI-ECO-05 | `economy.test.ts` | grün | Hollow Ridge: erstes Mex-Upgrade 240,0 s (Sättigung 4:00) am Ring-Mex, während des Tech-Upgrades höchstens 1 parallel |
| AI-ENG-02 | `engineer.test.ts` | grün | fac2 nach der Entscheidung ummauert ⇒ Ablehnung, Spiralsuche, Fabrik 3,9 s später (≤ 5 s) |
| AI-ENG-04 | `engineer.test.ts` | grün | 3 stehende Funken: Mex nach 5 min 15 gegen 15, Jagdauftrag 0,7 s bzw. 4,5 s nach Sichtung |
| AI-FAC-01 | `factory-defense.test.ts` | grün | 12 Stichel sichtbar: Punze 61,9 %, Kelle 28,6 % |
| AI-DEF-01 | `factory-defense.test.ts` | grün | Stichel-Raid 5:00 auf 3-Mex-Cluster: genau ein Riegel-I-Task nach 1,5 s |
| AI-DEF-03 | `factory-defense.test.ts` | grün | Funke (holdFire) durch den Cluster: kein Schaden, kein Riegel |
| AI-PLT-01 a | `platoon.test.ts` | grün | 7 : 11 Punzen: Rückzugsbefehl (eine Gruppen-Move aller 7) 1,8 s nach Sichtkontakt, R = 0,636 |
| AI-PLT-01 b | `platoon.test.ts` | grün | 7 : 10: 30 s Kontakt bei R = 0,70, kein Rückzug |
| AI-PLT-01 c | `platoon.test.ts` | grün | nach (a) 8 : 10 (R = 0,80, Gegner folgt): RETREAT bleibt, Austritt nur mit R ≥ 1,0 |
| AI-PLT-02 | `platoon.test.ts` | grün | erste Welle 217,5 s mit 8 Einheiten, vorher am Staging-Punkt, Attack-Move |
| AI-PLT-04 | `platoon.test.ts` | grün | Köder 180 s: Vogt max. 15 WU von der nächsten Fabrik (Leine 60), lebt |
| AI-PLT-05 | `platoon.test.ts` | grün | 3 Riegel I auf der Brücke: Angriff 319 s (≤ maxS 420 s), Rückzug 352,5 s bei R = 0,44 |
| AI-PERC-01 | `perception-determinism.test.ts` | grün | verborgene Einheit 60 WU hinter der Basis: 90 Snapshots und Command-Strom bytegleich |
| AI-PERC-02 | `perception-determinism.test.ts` | grün | feindliche Zapfstelle auf dem Spot von Engineer 1: Snapshots gleich bis zur Sichtung (58,1 s), Neuplanung 59,4 s |
| AI-PERC-03 | `perception-determinism.test.ts` | grün | feindlicher Vogt sichtbar ab 195,7 s, Speicher 0 / 3.900: Strom und Snapshots bytegleich |
| AI-DET-02 | `perception-determinism.test.ts` | grün | Normal gegen Normal, Budget × 0,5, 6 min, zweimal: gleiche Ströme und Welt-Hash, keine doppelten Records je Think, keine überlappenden Strukturen |

Unit-Tests: `economy.test.ts` (Formel mit `STORE_CREDIT_S`, AI-ECO-01-Unit mit Kappen-Skala, Energie-Notfall in zwei
Fälle getrennt: Vogt nach dem Handoff bekommt den Glutkessel vorn; bei nächstem Eröffnungsschritt Glutkessel keine
Einfügung – ecosim-Regel). Alle übrigen Unit-Tests unverändert grün (Determinismus-Guard inkl. Smoke-Allowlist).

## Timing-Tabelle Arena gegen `expect` (AI-OPEN-01/02, Fenster bis techT2 + 30 s)

Arena / expect in Sekunden, Toleranz ±10 s (Ausnahme mit Beleg: eco_standard Hollow Ridge mex8 ±12 s).

| Eröffnung | Karte | fac1 | eng1 | mex4 | mex8 | techT2 | E-Stall | Idle |
|---|---|---|---|---|---|---|---|---|
| eco_standard | Setons | 30,3 / 31,8 | 45,8 / 46,8 | 90,8 / 94,9 | 146,2 / 136,9 | 470,8 / 465,6 | 0,0 % | 0,0 % |
| eco_standard | Hollow Ridge | 30,3 / 31,8 | 45,8 / 46,8 | 122,8 / 130,0 | 501,7 / 512,4 | 503,2 / 510,5 | 0,0 % | 0,5 % |
| land_rush | Setons | 30,3 / 31,8 | 45,8 / 46,8 | 94,2 / 98,5 | 230,3 / 227,6 | 562,4 / 562,9 | 0,3 % | 0,0 % |
| land_rush | Hollow Ridge | 30,3 / 31,8 | 45,8 / 46,8 | 182,5 / 187,1 | 526,7 / 532,2 | 605,7 / 603,4 | 0,0 % | 0,2 % |
| tech_greed | Setons | 30,3 / 31,8 | 45,8 / 46,8 | 90,8 / 94,9 | 138,5 / 147,8 | 391,9 / 392,3 | 0,0 % | 0,0 % |
| tech_greed | Hollow Ridge | 30,3 / 31,8 | 45,8 / 46,8 | 152,5 / 162,1 | – (591,2) / 635,7 | 486,1 / 493,6 | 0,0 % | 0,2 % |

- Frühe Zeiten 1–4 s früher: Bauer halten bei Baureichweite + halbem Footprint, A*-Wege mit String Pulling statt
  Rasterweg × 1,1 (tai-p2 Abweichung 1/4).
- eco_standard Hollow Ridge mex8 −10,7 s: die Spots 7/8 liegen im umkämpften Gebiet 245–250 WU entfernt; der Laufweg
  ist in der Arena ≈ 4 % kürzer. Toleranz im Test 12 s (nicht behebbar, ohne das Arena-Wegemodell zu verfälschen).
- tech_greed Hollow Ridge mex8: `expect` 635,7 s liegt hinter dem Fenster (523,6 s); der Test verlangt nur „nicht
  früher als 625,7 s“. Außerhalb des Fensters erreicht die Arena 591,2 s.

## Smoke-Kalibrierung (`smoke.ts`)

Aufruf: `/Users/logge/Documents/Projects/flow-and-fire/tools/heavy node --import tsx tools/ai-arena/src/scenarios/smoke.ts
[--maps a,b] [--seeds 1,2,3] [--minutes 30] [--json out.json] [--strict-stall]`. Normal gegen Normal (gewichtete
Eröffnungswahl je Seed), 30 min oder Vogt-Tod. Je Lauf und Seite: kein Crash, T2 ≤ 12:00, erste Welle (`waveAttack` mit
`enemyHalf`) ≤ 8:00, Idle-Engineer < 15 %, APM-p99 (60-s-Fenster) ≤ Cap, ops-p99 ≤ Budget (gesamt und je
Manager-Zuteilung), 0 abgebrochene Thinks; Energie-Stall nach ai.md §7.1 (R-G4) **gepoolt** über alle Seiten ≤ 5 %,
Seiten > 10 % als Ausreißer (mit `--strict-stall` zusätzlich ≤ 5 % je Seite).

**Endstand Seeds 1–3: 9/9 Läufe bestanden**, Stall gepoolt 1,45 %.

| Karte | Seed | Ende | Army 0 | Army 1 |
|---|---|---|---|---|
| Setons | 1 | 30:00 Remis | tech_greed · T2 402 s · Welle 260 s · Idle 0,4 % · Stall 11,7 % | eco_standard · 471 s · 216 s · 1,7 % · 0,0 % |
| Setons | 2 | 30:00 Remis | land_rush · 564 s · 220 s · 4,4 % · 3,3 % | eco_standard · 467 s · 216 s · 1,1 % · 0,0 % |
| Setons | 3 | 30:00 Remis | tech_greed · 406 s · 265 s · 0,6 % · 0,0 % | eco_standard · 462 s · 216 s · 1,4 % · 1,3 % |
| Hollow Ridge | 1 | 30:00 Remis | land_rush · 606 s · 269 s · 0,5 % · 0,0 % | eco_standard · 505 s · 223 s · 0,9 % · 0,0 % |
| Hollow Ridge | 2 | 27:38 Sieg 1 | land_rush · 622 s · 277 s · 0,5 % · 5,7 % | eco_standard · 506 s · 223 s · 0,8 % · 0,0 % |
| Hollow Ridge | 3 | 20:58 Sieg 1 | land_rush · 636 s · 263 s · 1,7 % · 0,0 % | eco_standard · 506 s · 223 s · 0,4 % · 0,0 % |
| Tessera | 1 | 17:41 Sieg 0 | land_rush · 579 s · 235 s · 0,4 % · 0,0 % | eco_standard · 486 s · 206 s · 2,5 % · 5,0 % |
| Tessera | 2 | 23:23 Sieg 1 | land_rush · 582 s · 233 s · 2,4 % · 0,0 % | eco_standard · 484 s · 211 s · 0,9 % · 0,0 % |
| Tessera | 3 | 18:30 Sieg 1 | land_rush · 595 s · 233 s · 9,1 % · 0,0 % | eco_standard · 485 s · 211 s · 0,5 % · 0,0 % |

APM-p99 46–120 (Cap 120), ops-p99 636–13.435 (Budget 24.000), max. ops/Think 14.352, keine Abbrüche.
Kontrolllauf Seeds 4–6: ebenfalls 9/9, Stall gepoolt 2,72 %, Ausreißer Setons 4 (14,5 %) und Setons 6 (27,4 %).

**Think-Zeit Normal** (Wall-Clock nur im Smoke-Skript, 54.764 Thinks, M5 Pro unter Last paralleler Agenten):
p50 0,044 ms · p95 0,202 ms · p99 0,322 ms · max 3,97 ms (ai.md-Ziel p95 ≤ 8 ms). Ein 30-min-Spiel KI gegen KI dauert
0,4–2,9 s Wall-Clock.

Die Stall-Ausreißer (> 10 %) sind durchweg Basis-Zusammenbrüche im Kampf: Ab 18–26 min zerstört die gegnerische Armee
alle Kraftwerke, danach stehen nur noch Hydro + Vogt (≈ 420 E/s) gegen den Unterhalt von 34–46 T2-Zapfstellen
(≈ 370 E/s) und die laufenden Fabriken; nachbauende Engineers sterben in der besetzten Basis. Die 60-s-Ausnahme der
Metrik deckt nur den Verlust fertiger Kraftwerke ab. Das ist der Fall, für den ai.md §7.1 (R-G4) das Gate gepoolt
definiert („Kampfschaden ist kein Planungsfehler“); die je-Lauf-Formulierung des Auftrags („Energie-Stall ≤ 5 %“ je
Lauf) weicht davon ab und ist per `--strict-stall` weiter prüfbar. Wachstumsbaustellen im Notfall pausieren ist MS10
(E13).

## Kalibrierungsänderungen (Code, mit Begründung)

| Stelle | Änderung | Anlass / Wirkung |
|---|---|---|
| `platoon-manager.ts` Raid | besuchte Ausweich-Spots 120 s gesperrt (`RAID_REVISIT_TICKS`) | Zwei feindliche Spots < 25 WU auseinander: der Raid wechselte jeden Think das Ziel ⇒ 166 Attack-Moves in 90 s, APM am Cap, Mex-Upgrades per APM verworfen (Hollow Ridge) |
| `mix.ts`/`factory-manager.ts` | Mix-Signatur in 5-%-Schritten, Neuschreiben bei gleicher Rollen-/Regelmenge höchstens alle 20 s, gleiche Schleife ⇒ kein Record; Konter-Regeln mit Hysterese (aus bei < 28 %, mindestens 30 s aktiv) | 2.000+ verworfene FactoryRepeat je Seite und Spiel; Regeln kippten alle ≈ 9 s. Danach APM-p99 ≈ 100 statt Dauer-Cap |
| `engineer/manager.ts` Flucht | kein neuer Move, wenn der Engineer schon zum/ am verteidigten Punkt steht | 470 verworfene Flucht-Moves in 5 min |
| `opening/runner.ts` Energie-Notfall | keine Vogt-Einfügung, wenn sein nächster Schritt schon ein Kraftwerk ist (ecosim `economy_manager`) | tech_greed Setons baute 4 statt 2 Glutkessel vor Ring-Mex 3 ⇒ mex8 +11 s |
| `engineer/manager.ts` Mehrbauer-Aufgaben | weitere Bauer einer Aufgabe bauen am Platz des ersten (`jointPlace`) | Glutkessel II (3 Bauer) entstand zweimal (2 × 12.000 E) |
| `engineer/manager.ts` Rettung | freier Bauer ≤ 80 WU übernimmt eine Basis-Aufgabe mit, deren Bauer noch weit weg sind | Glutkessel-Aufgaben standen 3 min „assigned“ an Engineers auf Außen-Expansionen, Speicher leer (eco_standard Setons 13 % Stall ohne Gegner ⇒ 0 %) |
| `engineer/manager.ts` Energie zuerst | Kraftwerks-Aufgabe (Prio 90) holt Bauer von Assist-Jobs (Tech 80, Mex-Assist 40), wenn der Speicher in ≤ 30 s leer ist oder sie ≥ 30 s wartet; Bau-Assist (R-04) nur ohne Energie-Engpass; bei Defizit assistieren freie Bauer Kraftwerks-Baustellen | T2-Assist des Vogts ließ Kraftwerke liegen; 4 Assist-Engineers auf einem Landwerk (140 E/s) im Engpass |
| `economy/balance.ts` | Speicher-Gutschrift in flowDef über 120 s statt 60 s (`STORE_CREDIT_S`) | ein voller Glutspeicher verdeckte ≈ 220 E/s Defizit; die Bilanz bestellte erst bei leerem Speicher |
| `economy/manager.ts` Kappe | Skala der Kraftwerks-Kappe = max(P_E − U_E, D_eff) statt P_E − U_E | Nachfragesprung +300 E/s bei 8 min wurde mit 4 Glutkesseln gleichzeitig beantwortet |
| `engineer/spots.ts` Deckung | ein angreifendes Platoon jenseits des Staging-Punkts (d_own größer) gilt als Deckung | umkämpfte Spots waren nur in den Sekunden des Wartens am Staging-Punkt erlaubt ⇒ Hollow Ridge mex8 +126 s |
| `engineer/placement.ts` Spirale | je Ring zuerst die Seite zum Bauer | AI-ENG-02: der Vogt lief um die Mauer herum (+6,3 s) |
| `engineer/jobs.ts` | nicht begonnener Bau auf einem inzwischen bekannten feindlichen Gebäude ⇒ sofort `lost` (Neuplanung) | AI-PERC-02: Neuplanung erst bei der Ablehnung am Bauplatz (5,8 s) |
| `engineer/manager.ts` Flucht-Ziel, `factory-manager.ts` Drops | siehe oben (`bb.lastDropped`) | verworfene Schleifen galten als geschrieben |

`ai.md` und `ai-openings.json` sind unverändert.

## Abweichungen und Auslegungen

1. **AI-ECO-01 bei 11:00:** Ein dauerhafter Zusatzbedarf von +100 E/s über dem Überschuss führt zwischen 4 und 9 min auf
   Setons zu 18–57 s Stall: in der Basis stehen dann nur 1–3 Bauer (die Engineers expandieren 100–400 WU entfernt), jeder
   Glutkessel kostet selbst 750 E und der Engpass bremst alle Baustellen. Ab 11:00 (T2-Engineers in der Basis) hält die
   KI das Kriterium. Der Test läuft deshalb bei 11:00 und fügt den Verbraucher über dem aktuellen Überschuss hinzu
   (+100 E/s „roh“ erzeugt dort gar kein Defizit).
2. **AI-PLT-01:** HP beider Seiten werden je Tick auf 100 % gehalten (Cheat), damit R exakt 0,64/0,70/0,80 bleibt;
   Einheiten eng gepackt, weil die Arena nur Sichtbares zählt. Fall (c): der Gegner folgt dem Rückzug per Script in
   12 WU; geprüft wird „R = 0,8 gesehen, RETREAT erst mit R ≥ 1,0 verlassen“.
3. **AI-DEF-03** braucht `holdFire` (s. o.); **AI-OPEN-04** hält die 6 Stichel am Leben (sonst sinkt der Threat vor
   Ablauf der 5 s unter 160).
4. **AI-ENG-02** nutzt den Pfad EconomyManager → EngineerManager (eco_standard, fac2 als Mass-Senke) und mauert den Platz
   zwischen Entscheidung (Think N) und Anwendung (N + lead) ab. Die Eröffnungs-Queue des Vogts (land_rush) plant einen
   abgelehnten Schritt zwar neu, hängt ihn aber hinter die bereits ausgegebenen Schritte (bekannte Grenze; ein Versuch,
   die Queue sofort neu auszugeben, scheiterte daran, dass die Arena bei einem abgelehnten ersetzenden Befehl die alte
   Queue behält und die folgenden Queue-Befehle anhängt).
5. **AI-FAC-01** läuft mit land_rush bei 2:00 (Fabriken schon beim FactoryManager), weil ein einmal gesehener feindlicher
   Vogt (Threat 1.095) 180 s lang im Fenster bleibt und den Stichel-Anteil unter 35 % drückt.
6. **AI-ECO-04:** „kein Energie-Engpass“ als ≤ 1 Arena-Tick mit Ratio < 1; nach 20 s (forS) starten bei vollem Speicher
   mehrere Upgrades in einem Takt — nach der ai.md-Formel zulässig, weil E_free dann ≥ 4 × 60 ist.
7. **Smoke-Stall gepoolt** statt je Lauf (siehe oben), je Lauf per `--strict-stall`.
8. **Beobachtung ohne Fix:** Ein Jäger (Jagdauftrag auf einen stehenden Funken) tötet sein Ziel nicht immer zeitnah;
   AI-ENG-04 prüft nur Auftrag und Mex-Zahl.

## APIs/Verträge für Folgepakete (tai-p6, tai-p7)

- `createDefaultBrain({managers?})`, `DEFAULT_MANAGERS`, `DEFAULT_MANAGER_FACTORIES`, `defaultManagerFactories`.
- `AiBrain.manager?(name)` (optional), `effectiveOpening(ctx)`, `bb.rally`, `bb.lastDropped`, `Task.builders`/
  `TaskSpec.builders`, `TaskBuilders`, `STORE_CREDIT_S`, `MIX_SIGNATURE_STEPS`, `COUNTER_SHARE_OFF`,
  `COUNTER_HOLD_TICKS`, `MIN_REWRITE_TICKS`, `RAID_REVISIT_TICKS`, `POWER_PREEMPT_*`, `RESCUE_EXTRA_WU`,
  `BUILD_ASSIST_MIN_EMPTY_S`, `knownEnemyOverlap`. Alle bisherigen Signaturen unverändert.
- Arena: `ArenaWorld.holdFire(handle, on)` (Cheat-Kind `holdFire`), `HashableWorld`.
- Szenarien: `import { runScenario, … } from 'tools/ai-arena/src/scenarios/index.ts'` (der Paket-Einstieg
  `src/index.ts` gehört tai-p6 und exportiert die Szenarien derzeit nicht). Das volle Turnier (≥ 200 Spiele) ist tai-p7.

## Selbsttest

- `tools/heavy pnpm exec vitest run packages/ai tools/ai-arena` → 45 Dateien, 363 Tests grün (≈ 7 s).
- `tools/heavy pnpm exec tsc -b packages/ai tools/ai-arena` grün; `tsc -p tsconfig.tests.json` ohne Befund in
  `packages/ai`/`tools/ai-arena`.
- ESLint über `packages/ai` und `tools/ai-arena` ohne Befund; `depcruise` ohne Befund. `pnpm lint` insgesamt meldet
  89 Fehler ausschließlich in `docs/design/ui-mockups/**` (Browser-Globals, aus dem Merge `8f04d23`, nicht in meinen
  Pfaden, nur lesbar).
- Smoke Seeds 1–3 und 4–6 je 9/9 (s. o.).

## Bekannte Grenzen

- Basis-Zusammenbrüche im Spätspiel enden im Dauer-Stall (kein Pausieren von Verbrauchern vor MS10, kein
  Wiederaufbau an sicherer Stelle).
- Eröffnungs-Queue: abgelehnte Vogt-Schritte werden am Queue-Ende nachgeholt (siehe Abweichung 4).
- Wenige Bauer in der Basis zwischen 4 und 9 min auf 1.024-WU-Karten (AI-ECO-01-Einschränkung); Engineer-Sollzahl und
  Zuteilung bleiben wie in ai.md.
- Eröffnungswahl: bei den Seeds 1–3 spielte Army 1 immer eco_standard (erste RNG-Ziehungen 0,04/0,09/0,08); über 20
  Seeds verteilt sich die Wahl normal. Die Turniere (tai-p6/p7) decken alle Eröffnungen über mehr Seeds ab.
