# TRACK-AI · tai-p4-army-managers – Armee-/Lage-Manager (Welle 1)

Stand: 2026-09-30 · Branch `track-ai` (Worktree `.worktrees/faf-ai`) · Vorarbeits-Track, keine echte Sim.

Hinweis zum Pfad: Der im Auftrag genannte Worktree `/Users/logge/Documents/Projects/faf-ai` existiert nicht; der
Branch `track-ai` liegt als Git-Worktree unter `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-ai`.
Dort wurde ausschließlich in den eigenen Pfaden gearbeitet.

## Umgesetzt

Vier Manager in `packages/ai/src/managers/{factory,intel,platoon,defense}/`, jeder mit einer `ManagerFactory` aus
`index.ts` (`factoryManager`, `intelManager`, `platoonManager`, `defenseManager`; mit Optionen
`createFactoryManager`, `createIntelManager`, `createPlatoonManager`). P0-Verträge und `packages/ai/src/index.ts`
sind unverändert; die Manager sind noch nicht aus `@faf/ai` re-exportiert (das macht tai-p5 mit
`managers/index.ts`). Keine Unit-IDs oder Anzeigenamen im Code: alles über Rollen (`ai-openings.json → roles`) und
Kategorie-Ausdrücke; die gemeinsame Klassifikation liegt in `managers/intel/unit-classes.ts` (`UnitClasses`,
`unitClassesFor(roles)`), Namensabbildung:

| ai.md-Name | Rolle@Tech | ai.md-Name | Rolle@Tech |
|---|---|---|---|
| Punze | `tank@1` | Meißel | `tank@2` |
| Stichel | `bot@1` | Rinne | `arty@2` |
| Kelle | `arty@1` | Rüttelsieb | `aa@2` |
| Sieb | `aa@1` | Riegel I | `pd@1` |
| Funke | `scout@1` | Zapfstelle / Glutkessel / Landwerk | `mex` / `pgen` / `fac_land` |

### FactoryManager (`managers/factory`, ai.md §5.4)
- **Ablauf je Lauf:** Survey (Ist = lebende Armee nach Mass je Blueprint + laufende Produktion + eigene
  Queue-Aufträge; per Handle-Cursor fortsetzbar) → Konter-Tabelle → je Fabrik (Handle-Cursor): Engineers bis
  `bb.engineerTarget` (je Fabrik höchstens ein Engineer gleichzeitig), dann `bb.productionRequests` nach Prio
  (ganze Anfrage auf eine Fabrik, danach entfernt), dann Grund-Mix als Repeat-Schleife, Rally, Späher.
- **Grund-Mix** (`mix.ts`): T1 Punze 45 · Kelle 20 · Stichel 20 · Sieb 0/15/30; T2 Meißel 45 · Rinne 20 · Punze 15
  (nur bei P_M < 20) · Rüttelsieb 0/15/30 · Stichel 10. Einträge, die die Fabrik nicht bauen kann, fallen heraus,
  dann wird normiert. Phase = Tech der Fabrik (T3 nutzt vorerst den T2-Mix; T3 ist MS13).
- **Schleife:** 5 Aufträge (6 ab fünf Rollen), gierig nach größtem Defizit `Soll − S/ΣS` mit S = Ist-Anteile auf
  die Masse einer Schleife skaliert + bisherige Picks; Gleichstand nach Tabellenreihenfolge; Fehlerrate
  (Easy 15 %/Top 3, Normal 5 %/Top 2) aus dem eigenen RNG-Strom (`ctx.rng`). Neu geschrieben nur bei
  Mix-Wechsel (Signatur aus Blueprints und Anteilen auf 0,1 %); der Emitter-Dedup verwirft identische Schleifen
  zusätzlich (auch gegenüber der Schleife der Eröffnung).
- **Konter-Tabelle** (`COUNTER_RULES`, alle neun Zeilen aus §5.4): ein Durchlauf über das 180-s-Fenster
  (`bb.enemy.forEachWindow`, Threat-gewichtet), Regel ab 35 % (Luft: ≥ 5 Flugzeuge oder ≥ 20 %), `COMMAND vorn` =
  sichtbarer feindlicher Vogt ≤ 150 WU von eigenen Einheiten; additiv je Gruppe (tank = Haupt-Panzer der Phase),
  Klemmen auf 0, Normieren. Easy aus, Normal ab dem nächsten Mix-Lauf (Regeln dieses Laufs gelten im nächsten),
  Hard sofort + Vorhersage „feindliches Landwerk II gesehen ⇒ Meißel +10“.
- **Späher:** ein lebender Land-Späher, Ersatz nach Verlust, höchstens einer je 180 s (auch ein von der Eröffnung
  produzierter Funke zählt über seinen `firstSeenTick`).
- **Rally:** `analysis.rally`; wandert zum Staging-Punkt, solange ein Platoon dort (state `staging`, ≤ 30 WU)
  mit R ≥ 1,0 steht (`stagingHeld()` in `platoon/scene.ts`, gemeinsam mit dem PlatoonManager); zurück nach 10 s
  ohne. SetRally mit P4.
- **Fabrik-Übernahme (Handoff §4.3):** Eine Landfabrik gehört der Eröffnung, solange `bb.opening.active`, nicht
  `defenseMode`, vor 5:00, nicht in `bb.opening.handedOffFactories` und entweder `unitOwner = 'opening'` oder auf
  einem Fabrik-Slot der Eröffnung (±6 WU um `analysis.slots[opening.factoryOrder]`). Alle anderen Fabriken —
  auch Zusatz-Fabriken — steuert der FactoryManager (`claimUnit(h, 'factory')`). Produktionsanfragen bedient
  jede Fabrik, die kein anderer Manager hält (auch Eröffnungs-Fabriken: lokale Abwehr zieht Punze/Stichel vor).
- **Luftwerk (Air-Lite ist MS12):** nur bedient – Turmfalken nach Luftkontakt, sonst 2 Dohlen + 1 Turmfalke,
  Lerche alle 4 min.

### IntelManager (`managers/intel`, ai.md §5.6)
- **Threat-Grid** (`ThreatGrid`, Float64Array im KI-Zustand, nie im Hash): 16-WU-Zellen (Setons 64 × 64,
  512 WU 32 × 32), Ebenen T_surface/T_air/T_antiair (live + Gedächtnis), Struktur-Ebenen T_surface/T_antiair/
  V_struct, `lastSeen`. „Leeren“ der Live-Ebene kostet nichts (Generationsstempel je Zelle); zwei Puffer, Abfragen
  lesen den zuletzt veröffentlichten Durchlauf.
- **Durchlauf:** (1) Strukturen ereignisartig (neu bekannte Strukturen/Ghosts einmal eintragen, aus dem
  Feindgedächtnis verschwundene austragen; Wert V_struct = Zielwert §5.5); (2) mobile Feinde in Handle-Reihenfolge,
  voll bis zur Reichweite, halb bis +8 WU, eigene Zelle immer voll, feindlicher Vogt mit Faktor R-07; Blips mit
  dem Median-Threat der höchsten gesehenen Tech auf 5 × 5 Zellen; (3) eigene Sicht: `lastSeen`, gesehenes Leeres
  löscht das Gedächtnis; (4) Veröffentlichen, beim ersten Mal `bb.threat = grid`.
- **Gedächtnis lazy:** `max(Live, Mem · DECAY_LUT[⌊Δt/1 s⌋])`; Mem wird beim Eintragen auf den Live-Wert gesetzt.
  Strukturen verfallen nicht.
- **Cursor:** Jeder Abschnitt ist ein `ctx.step`, dessen Schreibzugriffe erst im Commit angewandt werden; reicht
  das Budget nicht, wird mit dem nächsten Handle im nächsten Intel-Lauf fortgesetzt (Grid ≤ 2 s alt).
- **Easy** (`threatVisibleOnly`): kein Gedächtnis, keine Blips, keine Ghosts; sichtbare Strukturen zählen live.
- **Scouting:** Land-Späher gehören der Intel (`claimUnit(h, 'intel')`). Route als eine Shift-Queue (P1):
  Gegner-Start (solange nie gesehen) → 4 feindliche Expansions-Spots (> 40 WU vom Gegner-Start) mit ältestem
  `lastSeen`, nächster-Nachbar-Reihenfolge → umkämpfter Spot mit ältestem `lastSeen` (sonst Engstelle/Mitte).
  Neue Route alle 180 s oder nach ≥ 2 s Leerlauf. Telemetrie `scoutSeenEnemyBase` beim ersten eigenen Blick auf
  die Startzelle des Gegners.
- **Grid-Modus des Platoons** vorbereitet: `ThreatGrid.sumWindow(layer, x, z, 1)` (3 × 3); aktiv nur mit
  `profile.platoonGridMode` (Standard aus).

### PlatoonManager (`managers/platoon`, ai.md §5.5)
- **Lagebild** (`Scene`): eigene Einheiten mit Threat und reagierbare Feindkontakte in 32-WU-Buckets; R_lokal über
  `threat.ts` (Vogt-Faktoren R-07, Blips = Median). Easy: nur sichtbare Feinde. Vergleiche mit Toleranz 1e-9
  (`RATIO_EPS`), damit 7 : 10 Punzen genau R = 0,7 bleibt.
- **Wellen:** FORMING (Rally) → STAGING bei Einheiten ≥ Schwelle (erste: `profile.firstWave ?? waves.first +
  bb.opening.waveExtra`, dann + grow) oder erste Welle ab `maxS − 60 s`; STAGING → ATTACK nach Ankunft
  (≤ 25 WU) bei R_ziel ≥ attackRatio in 2 Thinks (Scharfschützen-Regel: sofort bei R ≥ 1; Riegel-Regel: nur mit
  ≥ 25 % Artillerie); Pflichtangriff der ersten Welle bei `t ≥ maxS` auf das Ziel mit dem höchsten R_ziel in der
  gegnerischen Hälfte (auch ohne Ankunft); ATTACK → RETREAT bei R_lokal < 0,7 in 2 Thinks (P0-Gruppenbefehl zum
  nächsten verteidigten Punkt hinter dem Platoon: Fabrik, Riegel oder formierendes/wartendes Platoon); RETREAT →
  STAGING bei R ≥ 1,0 und HP ≥ 60 % oder nach Verstärkung; MERGE unter 50 % der Ausgangsgröße. Ziel zerstört ⇒
  nächstes Ziel mit R_ziel ≥ 1,0, sonst STAGING.
- **Zielwahl** (`targets.ts`): Kandidaten = bekannte Strukturen, sichtbare Engineers und Vogt, Fallback
  Gegner-Start; score = Wert / (1 + T_surface auf dem Pfad) / (1 + d/200); Vogt nur bei R_ziel ≥ 2.
- **Raids** (Normal 1 ab 6:00, Hard 2 ab 4:00): 3–5 T1-Stichel/Punzen (Stichel zuerst) gegen Außen-Mex mit
  T_surface = 0 (Fallback: freie feindliche Mass-Spots ohne Threat; mit Artillerie-Regel die nächste sichtbare
  feindliche Artillerie); Rückzug schon bei R < 1,0.
- **Jagd** (`bb.huntRequests`): nächste Kampfeinheit eines formierenden/wartenden Platoons greift an (P1,
  `Attack` bei Sicht, sonst Attack-Move); Anfrage fällt weg bei Tod des Ziels oder 60 s ohne Sicht.
- **Vogt** (`commander.ts`): Burst-Prüfung (HP / Σ DPS in Reichweite + 10 WU, Bomber/Kanonenboote mit 5 s Anflug,
  < 20 s ⇒ P0-Rückzug), Rückzug bei HP < 50 % oder R_lokal < 0,5 hinter die nächste Fabrik (P0), lokale Abwehr in
  der Leine (60 WU um die nächste Fabrik, Hard 120 WU bei R ≥ 2 ohne gesichtete Bomber) bei R_lokal inkl. Vogt
  ≥ 1,0 (P1; einzelner Funke nur ≤ 25 WU von der Baustelle), Rückruf, sobald das Ziel die Leine verlässt oder der
  Vogt außerhalb steht; Abstich (P0, höchstens alle 5 s) bei S_E ≥ 7.500 und ≥ 3 mobilen Feinden im 2,5-WU-Splash
  oder einem T2+-Panzer in Reichweite, stets innerhalb der Leine. Übernahme per `claimAcu('platoon')`, Freigabe nach
  15 s ohne feindliche Kampfeinheit im Basisbereich (60 WU um den Start oder in der Leine einer Fabrik).
- Telemetrie `waveAttack {tick, x, z, enemyHalf, units, forced}` bei jedem Übergang nach ATTACK, `retreat`.
- Micro (Hard, 5 Hz) ist MS14 und nicht Teil dieses Pakets.

### DefenseManager (`managers/defense`, ai.md §5.7 Minimal-A8)
- Cluster = ≥ 2 fertige eigene Zapfstellen, Single-Linkage 30 WU; Schlüssel `s<kleinster Spot-Index>`.
- Auslöser nur `ownDamaged` (Stimulus mit Reaktionsverzögerung, eigener Cursor) an einer Struktur ≤ 30 WU von
  einem Cluster-Mex durch eine feindliche Bodeneinheit; bloße Anwesenheit zählt nicht.
- Reaktion: genau ein Task `{kind 'build', role 'pd', tech 1, bp Riegel I, site = Schwerpunkt + 6 WU zur Bedrohung,
  prio 95, wanted 1, source 'defense', key 'defense:<cluster>'}`; `bb.defense.clusterDefense` und
  `bb.defense.spend` (Kosten bei Auftrag). Kein zweiter, solange ein eigener Riegel (fertig oder Baustelle) oder
  ein lebender `pd`-Task mit fester Position ≤ 30 WU vom Schwerpunkt existiert.
- Nicht vor 3:00 (außer `bb.opening.defenseMode`), Verteidigung ≤ 15 % der Mass-Ausgaben der letzten 3 min
  (außer Verteidigungsmodus), nie in `contested`/`enemy` ohne eigenes Platoon mit R ≥ 1 in 60 WU.

## Blackboard-Nutzung

| Abschnitt | liest | schreibt |
|---|---|---|
| `units`, `enemy`, `stimuli` | alle vier | – |
| `threat` | Platoon (Pfad-Threat, Raid-Ziele), Engineer/Economy (tai-p3) | Intel (ersetzt `LocalThreatEstimate` nach dem ersten Durchlauf) |
| `engineerTarget` | Factory | (tai-p3) |
| `productionRequests` | Factory (erfüllt und entfernt) | (tai-p3 legt an) |
| `huntRequests` | Platoon (setzt `hunter`, `x/z`; entfernt) | (tai-p3 legt an) |
| `platoons` | Factory (Rally), Defense (Deckung), tai-p3 (verteidigte Punkte) | Platoon (jeder Think neu) |
| `opening` (`active`, `defenseMode`, `handedOffFactories`, `waveExtra`) | Factory, Platoon, Defense | – |
| `taskBoard` | Defense (Duplikatprüfung) | Defense (`pd`-Tasks) |
| `defense` | Defense | Defense |
| `reservations` | alle | `claimUnit`: 'factory' (Fabriken), 'intel' (Späher), 'platoon' (Kampfeinheiten, Jäger); `claimAcu/releaseAcu('platoon')` |
| `telemetry` | – | `scoutSeenEnemyBase`, `waveAttack`, `retreat` |

## Parameter (Konstanten im Code, Herkunft ai.md bzw. dokumentierte Ergänzung)

Konter-Schwelle 0,35 / Luft 5 bzw. 0,20; Befehlsfront 150 WU; Sieb/Rüttelsieb 15 % nach Luftkontakt, 30 % mit
Luftschlag-Regel; T2-Füller bis P_M 20; Späher alle 180 s; Rally-Rückkehr 10 s; Drift-Prüfung 60 s / 15 pp;
Grid 16 WU, Rand 8 WU, Blip 5 × 5 Zellen; Scout-Route 180 s, Leerlauf 2 s, 4 Spots; Ankunft 25 WU; MERGE < 50 %;
Raid 3–5, Außen-Mex > 60 WU; Jagd 60 s ohne Sicht; Leine 60/120 WU; Burst 20 s (+10 WU, Anflug 5 s);
Vogt-Rückzug HP 50 % / R 0,5; Abstich 7.500 E, 2,5 WU, 3 Einheiten, Abklingzeit 5 s; Freigabe 15 s;
Cluster 30 WU; Riegel-Versatz 6 WU; Verteidigung ab 3:00, 15 % über 180 s, Deckung 60 WU.

## Tests (packages/ai/test/managers/{factory,intel,platoon,defense}, 42 Tests, ≈ 1,3 s)

| Datei | Inhalt / ai.md-Test-IDs |
|---|---|
| `factory/factory.test.ts` (11) | Mix-Tabellen und Normierung, Konter-Regeln additiv/Klemmen/Luft-Boden/Hard-Vorhersage, Schleife nach Defizit (stationär, Ist verschiebt, Fehler-RNG deterministisch); **AI-FAC-01** (Normal: Punze 61,9 %, Kelle 28,6 % einen Mix-Lauf später; genau zwei FactoryRepeat); Hard sofort, **Easy ignoriert die Konter-Tabelle**; **Mix-Defizit und Repeat nur bei Wechsel** (20 Thinks ⇒ eine Schleife, Luftkontakt ⇒ genau zwei Neuschreibungen); **Engineers vor dem Mix bis zur Sollzahl** + Produktionsanfrage; Späher-Ersatz ≤ 1 je 180 s; Eröffnungs-Fabrik bis Handoff; Rally zum Staging-Punkt; Determinismus + Cursor (Budget ×0,03) |
| `intel/intel.test.ts` (8) | Grid-Geometrie 64²/32², Veröffentlichen; **AI-INT-02** (Halbierung zwischen 13 s = 0,513 und 14 s = 0,488, Ghost-Riegel unverändert); gesehenes Leeres löscht, `enemyDestroyed` entfernt Ghost; **Grid-Kosten** (300 + 300 auf 1.024 WU ≤ 7.000 ops, ein Durchlauf); **Cursor bei Easy-Budget** (4.000 ops, ≤ 2 s alt, gleiche Live-Ebene); Blips/Easy; Scout-Route + Telemetrie; Determinismus |
| `platoon/platoon.test.ts` (14) | **AI-PLT-01** (a) 7:11 ⇒ P0-Rückzug im 3. Think nach Kontakt (1,0 s + lead), (b) 7:10 ⇒ kein Rückzug, (c) 8:10 ⇒ kein Wiedereinstieg, danach R ≥ 1 ⇒ STAGING; **AI-PLT-02-Unit-Teil** (Sammeln, Staging, Attack-Move auf die Zapfstelle); Wellen-Schwellen (Easy 12); **AI-PLT-05** (Pflichtangriff genau bei 7:00 gegen 3 Riegel I, danach Rückzug nach 2 Thinks); Staging-Merge + `bb.platoons`; **AI-PLT-04** (200 s Köder 90 WU vor der Basis: kein Vogt-Befehl außerhalb 60 WU, Rückruf beim Verlassen, Freigabe nach 15 s); Leinen-Rückruf und Burst-Rückzug; **AI-PERC-03-Teil** (3:00 ohne Glutspeicher R = 0,92, mit Ghost-Glutspeicher bzw. ab 5:00 Rückzug; identische Ströme); Jagd; Raid; Determinismus; halbiertes Budget zweimal gleich ohne Doppelaufträge (AI-DET-02-Unit-Teil) |
| `platoon/army-together.test.ts` (3) | alle vier Manager auf Setons (Easy/Normal/Hard, 120 Thinks): ops je Manager ≤ Zuteilung in jedem Think, Grid aktiv, Determinismus |
| `defense/defense.test.ts` (6) | **AI-DEF-01** (Stichel-Raid 5:00 auf 3-Mex-Cluster ⇒ genau ein Riegel-Task Prio 95, 6 WU zur Bedrohung); **AI-DEF-03** (durchlaufender Funke ⇒ kein Riegel); vor 3:00 nur im Verteidigungsmodus, Luftangreifer/Einzel-Mex zählen nicht; unsichtbarer Angreifer zählt, vorhandener Riegel sperrt; 15-%-Budget und Deckungsregel; Determinismus |

`packages/ai/test/managers/platoon/harness.ts` ist die gemeinsame Testhilfe (Brain mit ausgewählten Managern auf
einer flachen 512-WU-Karte, Instanz-Zugriff, Decoder, Strom-Schlüssel).

Selbsttest: `pnpm exec vitest run packages/ai/test/managers/<ordner>` für factory (11), intel (8), platoon (17),
defense (6) grün; `heavy pnpm exec tsc -b packages/ai` grün; ESLint über die eigenen Ordner sauber;
Determinismus-Guard (`packages/ai/test/determinism-guard.test.ts`) grün; Testdateien typgeprüft mit den Optionen
von `tsconfig.tests.json`.

## Messwerte (Node, M5 Pro)

| Messung | Wert |
|---|---|
| Grid-Durchlauf 300 Feinde (70 % Punze, 20 % Meißel, 10 % Rinne) + 300 eigene Punzen, 1.024 WU | 6.280 ops (ai.md-Schätzung ≈ 6.900) |
| Normal/Hard | ein Durchlauf je Intel-Lauf (max. 6.280 ≤ 7.000/12.000) |
| Easy (4.000 ops) | Durchlauf über ≈ 1,8 Läufe verteilt, max. 3.958 ops je Lauf, Grid ≤ 2 s alt |
| Intel-Think (grobe Wall-Clock im Test, nur Orientierung) | ≈ 0,35–0,7 ms |
| Setons-Szenario, 4 Manager, max. ops je Think (Easy / Normal / Hard) | Intel 559 / 834 / 834 · Platoon 296 / 301 / 665 · Factory 136 · Defense 58 |

## Abweichungen und Auslegungen (mit Begründung)

1. **Zapfstellen-Wert** „100 (+ Tech × 100)“ als 100 + Tech × 100 gelesen (T1 = 200). **Riegel „−50 (+100 …)“** als
   Wert 100 bei ≥ 25 % Artillerie (Masse) gelesen. Nicht in ai.md: Dampfquelle 40, Luftwerk 80, andere
   Strukturen 20, Mauern 0, Gegner-Start als Fallback-Ziel mit Wert 100 (nur ohne bekannte Struktur ≤ 60 WU), damit
   eine Welle ohne Aufklärung ein Ziel hat.
2. **T_surface auf dem Pfad** = Maximum der Stichproben alle 16 WU auf der Luftlinie (eine Einheit deckt viele
   Zellen; eine Summe würde lange Wege überbewerten). Nur die 8 besten Kandidaten nach Wert/(1 + d/200) werden
   abgetastet.
3. **Blips** schreiben den vollen Median-Threat in alle 5 × 5 Zellen um ihre Zelle („über 2 Zellen verschmiert“ als
   Chebyshev-Abstand 2, konservativ).
4. **Easy „Threat nur aus sichtbaren Einheiten“**: kein Gedächtnis, keine Blips, keine Ghosts – im Grid und in der
   Platoon-Stärke.
5. **STAGING-Rückzug** (R < 0,7 für 2 Thinks auch beim Warten am Staging-Punkt) und **Staging-Merge** (eine zweite
   Welle geht im wartenden Platoon auf) sind Ergänzungen; ai.md nennt den Rückzug nur für ATTACK.
6. **Drift-Prüfung** der Fabrik-Schleife (alle 60 s neu gebaut, geschrieben nur bei > 15 pp Abweichung der lebenden
   Armee und anderer Zusammensetzung): Sonst bliebe eine beim Mix-Wechsel aus schiefem Ist gebaute Schleife beliebig
   lange schief. APM-Kosten ≤ 1 Record je Fabrik und Minute.
7. **Sieb-Anteile**: 15 % nach Luftkontakt, 30 % mit Luftschlag-Regel (ai.md: „15–30 %“ bzw. „25–35 %“; T2 „0–25 %“
   wird ebenso auf 15/30 gesetzt, damit die Konter-Regel greift).
8. **Engineers**: höchstens ein Engineer je Fabrik gleichzeitig in Produktion/Queue (sonst stünden alle Fabriken
   hinter Engineer-Aufträgen); Tech = höchste baubare Stufe (`bestFor('eng', 1, fabrik)`).
9. **Abstich** immer innerhalb der Leine (R-09); „Hard offensiv“ ergibt sich aus der 120-WU-Leine bei R ≥ 2.
10. **DefenseManager:** Angreifer ohne Sicht (`attackerBp −1`) zählt als Bodeneinheit (Zapfstellen haben Sicht 0 und
    sehen ihren Angreifer nie; vor MS12 gibt es keine feindliche Luft). Die 15-%-Regel prüft die Ausgaben vor dem
    neuen Auftrag (der erste Riegel ist damit immer erlaubt); Ausgaben = `massDemand × massRatio` je Lauf.
11. **Normal „nach dem nächsten Mix-Takt“** als Verzögerung um einen Mix-Lauf (1 s) umgesetzt.
12. **R-Vergleiche** mit Toleranz 1e-9 (7 : 10 Punzen ergibt numerisch 0,7 ± 1 ulp).
13. **Scene-Budget:** Der PlatoonManager braucht je Think ein vollständiges Lagebild (1 op je eigener Einheit,
    Kontakt und Fenstereintrag); passt es nicht ins Budget, setzt er den Think aus (keine halben Befehle). Bei den
    Budgets aus ai.md tritt das erst ab ≈ 2.500 (Easy) bzw. 9.000 (Hard) Objekten auf.

## Gemeldete Vertragslücken / Hinweise für tai-p5

1. **Fabrik-Handoff:** Die Eröffnung (tai-p3) sollte ihre Fabriken mit `reservations.claimUnit(h, 'opening')`
   markieren und beim Handoff in `bb.opening.handedOffFactories` eintragen; `bb.opening.active` muss während der
   Eröffnung `true` sein. Ohne Claim greift die Slot-Heuristik (±6 WU um die Fabrik-Slots der Eröffnung).
2. **Queue-Semantik (Arena/Sim):** angenommen wird „`FactoryQueue` mit Shift läuft vor der Repeat-Schleife weiter,
   `queueLength` zählt nur noch nicht begonnene Queue-Aufträge (ohne Schleife)“. Weicht die Arena ab, stimmen die
   Ist-/Engineer-Zählung und das Vorziehen von Anfragen nicht.
3. **Rally als Blackboard-Feld:** Der aktuelle Sammelpunkt wird heute über `stagingHeld()` in Factory und Platoon
   gleich berechnet (Factory mit 10-s-Hysterese). Ein Feld `bb.rally` (Eigentümer Factory) wäre sauberer.
4. **Vogt-Übergabe:** Build-Manager müssen `reservations.acuOwner === 'platoon'` respektieren und nach der Freigabe
   ihre Queue neu ausgeben (`releaseAcu` gibt an den Vorbesitzer zurück).
5. **Späher gehören der Intel** (`unitOwner = 'intel'`); die Scout-Umschaltung der Eröffnung (tai-p3) kann
   `telemetry.first('scoutSeenEnemyBase')` als Zeitpunkt der ersten Sichtung nutzen.
6. **Riegel-Duplikate:** Der Verteidigungsmodus der Eröffnung sollte seinen Riegel-Task mit `role 'pd'` und fester
   Position (`site: Vec2`) anlegen, sonst erkennt der DefenseManager ihn nicht als Cluster-Riegel (Selektor-Strings
   wie `ring` haben keine Position).
7. **Produktionsanfragen** werden als Ganzes auf eine Fabrik gelegt und sofort aus `bb.productionRequests`
   entfernt; `count` wird dabei auf 0 gesetzt. Wer den Fortschritt verfolgen will, braucht eine Rückmeldung
   (heute nicht im Vertrag).
8. **Export:** `managers/index.ts` + Re-Export in `src/index.ts` und die Aufnahme in `createDefaultBrain` stehen aus
   (tai-p5). Die Instanzen haben Diagnose-Felder (`FactoryManager.lastMix/counterApplied`, `IntelManager.grid/
   passes/lastPassOps`, `PlatoonManager.platoons/commander.action`, `DefenseManager.created`).
9. **Scene-Kosten** enthalten das 180-s-Fenster (Konter-Anteile für Scharfschützen/Riegel/Artillerie); bei sehr
   großen Fenstern auf Easy könnte der PlatoonManager aussetzen (siehe Abweichung 13) – im Turnier beobachten.

## Adapter-Grenze

Unverändert gegenüber tai-p0: Die Manager lesen nur Blackboard/PerceptionView und schreiben nur über den
CommandEmitter. Mit der echten Sim (MS6/MS9) ändern sich nur die Quellen (Perception, Blueprint-View,
Payload-Codecs), nicht die Manager. Der Grid-Modus des Platoons (MS11) ist per `profile.platoonGridMode`
vorbereitet.

## Bekannte Grenzen

- Kein Micro (MS14), kein Air-Lite über das Bedienen eines vorhandenen Luftwerks hinaus (MS12), kein T3-Mix (MS13),
  keine volle A8 (Rost, Schirm, Tiegel; MS11).
- Bewegungsbefehle ohne Formation (C13) und ohne Pfadkosten; Rückzugspunkte nach Luftlinie und `d_own`.
- Verhalten über Zeit (Laufwege, Kämpfe, Wellen-Timing, Gates T2 ≤ 12 min / erste Welle ≤ 8 min) ist nur in der Arena
  prüfbar (tai-p5); die Unit-Tests nutzen FakeWorld ohne Bewegung.
