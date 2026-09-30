# audioeng-b3 – Räumliches Modell, Alert-Queue, Event-Router

> **Track:** TRACK-AUDIOENG, Welle 1 · **Stand:** 2026-09-29 · **Pfade:** `packages/audio/src/{spatial,alerts,router}/**`, `packages/audio/test/{spatial,alerts,router}/**`

## 1. Umgesetzt

- **`src/spatial/`** (`@faf/audio/spatial`): `CameraSpatialModel implements SpatialModel` mit Kategorie-Profilen `SPATIAL_PROFILES`. Pan entlang des Kamera-Rechtsvektors, Dämpfung nach Abstand zur Bildmitte (in Bildhalbbreiten) und nach Kamerahöhe, Culling jenseits eines Radius je Kategorie. `spatialize` allokiert nichts (Out-Parameter, alles je Listener in `setListener` vorberechnet).
- **`src/alerts/`** (`@faf/audio/alerts`): `AlertQueue` mit Priorität, Wiederholintervall je Alert, Orts-Ausnahme, Verfall, genau einer Alert-Stimme, Verlauf (Ring) und `jumpToLast()` mit Zurückblättern.
- **`src/router/`** (`@faf/audio/router`): `EventRouter` bildet Sim-Events über die Event-Map (a1) auf Sounds und Alerts ab, mit subTick-Staffelung, Aggregation je Zeitzelle und allokationsfreiem Hot Path.
- Test-Fakes `test/router/fakes.ts`: `ManifestResolver` (SoundResolver über ein Manifest, Lookup-Regel wie Vertrag), `RecordingSink`, `FakeHandle`, `RecordingAlerts`. Die Alert-Tests nutzen sie mit.

## 2. Öffentliche API

```ts
// @faf/audio/spatial
new CameraSpatialModel(profiles = SPATIAL_PROFILES)
  .setListener(l: ListenerState)      // säubert: Halbbreite > 0, Rechtsvektor normiert, NaN → 0
  .spatialize(categoryIndex, x, z, out: SpatialResult): boolean   // false = unhörbar (gain 0)
  .zoomDb(categoryIndex): number      // aktuelle Zoom-Dämpfung (HUD)
  .listener                           // gesäuberter Listener
interface SpatialProfile { spatial, zoomRefHeight, zoomDbPerDoubling, zoomFloorDb, offscreenRolloff, cutoffRadius, maxPan }
SPATIAL_PROFILES; zoomAttenuationDb(profile, height); validateSpatialProfile(name, p); profilesByIndex(p)
DEFAULT_LISTENER; MIN_VIEW_HALF_WIDTH

// @faf/audio/alerts
new AlertQueue({ resolver, faction, clockMs, onJumpTo?, onAlert?, onAlertStart?(durationS),
  rules? /* EventSoundMap.alerts */, maxQueue = 4, maxAgeMs = 6000, minSpacingMs = 1500,
  historySize = 8, defaultRadiusWu = 48, jumpBackWindowMs = 3000, endMarginMs = 100 })
  .push(req: AlertRequest): boolean
  .update(nowMs, sink: SoundSink): void
  .jumpToLast(): boolean
  .historyList(): AlertRecord[]       // neueste zuerst (allokiert, nur UI)
  .size / .busy / .stats {queued, suppressed, unknown, overflow, expired, announced, voiced}
  .clear() / .resetStats()
DEFAULT_ALERT_RADIUS_WU = 48

// @faf/audio/router
new EventRouter({ map, eventTypes = DEFAULT_EVENT_TYPE_TABLE, resolver, faction, visualName?,
  alerts: AlertSink /* {push(req): boolean}, z. B. AlertQueue */, spatial?, commanderDeathGlobal = true })
  .handle(src: AudioEventSource, sink: SoundSink, ctxTime: number, nowMs: number): void
  .setSimSpeed(speed) / .simTickDurationS
  .stats {events, eventsUnmapped, eventsIgnored, aggregated, plays, dropped, alertsPushed, alertsSuppressed}
  .resetStats()
CELLS_PER_TICK = 8; AGGREGATE_MAX_COUNT = 4; MAX_TICK_SPREAD = 3; BASE_TICK_S = 0.1
```

## 3. Räumliches Modell

Formeln (Positionen in WU, `r = |p − focus| / viewHalfWidth`):

- **Pan** = clamp(dot(p − focus, right) / viewHalfWidth, −1, 1) × maxPan. Reine Tiefenversätze (entlang der Blickrichtung) bleiben mittig; gedrehte Kameras wirken über den Rechtsvektor.
- **Distanz:** r ≤ 1 (im Bild) → 0 dB; darüber `1 / (1 + k·(r − 1))²`; r > cutoffRadius → unhörbar (`false`, der Voice-Manager verwirft vor der Stimmenvergabe).
- **Zoom:** Höhe h ≤ zoomRefHeight → 0 dB; darüber `zoomDbPerDoubling · log2(h / ref)`, nach unten begrenzt auf zoomFloorDb.
- Nicht räumliche Kategorien (ui, ack, alert, music, ambience) → gain 1, pan 0 unabhängig von Ort und Zoom.

Bezugsgrößen aus `packages/client` (nur gelesen): Mindestabstand der Kamera ≈ 6 WU, übliche Spielhöhe 40–80 WU (Halbbreite ≈ 15–35 WU), Strategic Zoom bis ≈ 1400 WU auf einer 1024-WU-Karte; Einheiten sind 1–3 WU groß.

| Kategorie | räumlich | zoomRefHeight | dB je Verdopplung | Boden | Rolloff k | Cutoff (Halbbreiten) | maxPan | Begründung |
|---|---|---|---|---|---|---|---|---|
| weapon | ja | 60 | −6 | −30 dB | 1,5 | 2,5 | 0,8 | häufigste Quelle; im Strategic Zoom nur noch leises Knistern (bei 480 WU −18 dB, ab ≈ 1900 WU −30 dB) |
| impact | ja | 60 | −6 | −30 dB | 1,5 | 2,5 | 0,8 | wie Waffen, gleiche Dichte |
| projectile | ja | 50 | −7 | −36 dB | 2 | 2 | 0,8 | Flug-Loops, rein lokale Detailgeräusche |
| unit | ja | 50 | −7 | −36 dB | 2 | 2 | 0,8 | Bewegungs-Loops, nur in der Nähe sinnvoll |
| build | ja | 50 | −6 | −30 dB | 2 | 2 | 0,8 | Bau-Knistern lokal; der Armee-Bau-Loop ist Client-Sache |
| eco | ja | 50 | −6 | −30 dB | 2 | 2 | 0,8 | Generator-/Mex-Loops lokal |
| shield | ja | 60 | −5 | −24 dB | 1,5 | 2,5 | 0,8 | etwas tragender als Einschläge (Zusammenbruch ist Information) |
| intel | ja | 80 | −3 | −18 dB | 1 | 3 | 0,8 | Kontakt-Pings sind Information, sollen im Zoom hörbar bleiben |
| explosion | ja | 80 | −3 | −12 dB | 0,8 | 4 | 0,8 | große Ereignisse bleiben im Strategic Zoom hörbar, tragen weiter aus dem Bild |
| signature | ja | 120 | −1,5 | −6 dB | 0,5 | 6 | 0,8 | Glocken (Fertig/Upgrade) kaum gedämpft |
| ui, ack, alert, music, ambience | nein | – | – | – | – | ∞ | 0 | zentriert, volle Lautstärke |

maxPan 0,8 statt 1: ein ganz links liegender Sound bleibt auf beiden Ohren wahrnehmbar (Kopfhörer-Ermüdung), der ≥ 6-dB-Unterschied L/R der Browser-Abnahme (c2) bleibt erfüllt (Equal-Power-Pan ±0,8 → ≈ 16 dB).

**Vogt-Explosion:** `exp_commander` hat die Kategorie `explosion`; das SpatialModel kennt nur die Kategorie. Damit der Lotbruch „kaum gedämpft“ ist, spielt der Router `commanderDeath` standardmäßig **ohne Position** (zentriert, keine Distanz-/Zoom-Dämpfung, kartenweit wie in FA). `commanderDeathGlobal: false` schaltet auf die normale räumliche Behandlung um.

## 4. Alert-Regeln

- **Sound:** `rules[kind].sound` (Event-Map `alerts`), sonst `kind` selbst; Lookup über den Resolver mit `req.faction ?? faction`. Unbekannt → `false` (`stats.unknown`).
- **Priorität** = Sound-Priorität aus dem Manifest (alerts 96–100); höhere zuerst, Gleichstand FIFO.
- **Wiederholintervall** je Alert-Kind: `rules[kind].repeatMs`, sonst `cooldownMs` des Sounds (Manifest, z. B. base_attacked 15 000, unit_attacked 10 000, enemy_air 30 000 ms). Zeitbasis ist der Push (Annahme in die Queue).
- **Orts-Ausnahme:** innerhalb des Intervalls wird derselbe Alert trotzdem angenommen, wenn (a) er eine Position hat, (b) seit der letzten Annahme ≥ `minSpacingMs` (1500 ms) vergangen sind und (c) er weiter als `radiusWu` (Event-Map, sonst 48 WU) von **allen** noch im Intervall liegenden Positionen dieses Alerts (bis zu 4) entfernt ist. Ein ortloser Eintrag im Intervall blockiert die Ausnahme.
- **Queue:** höchstens `maxQueue` (4) wartende Einträge; ist sie voll, verdrängt ein Alert mit höherer Priorität den niedrigsten (bei Gleichstand den ältesten), sonst `false` (`overflow`). Wartende Einträge älter als `maxAgeMs` (6 s) verfallen unangesagt (`expired`).
- **Eine Stimme:** `update(nowMs, sink)` startet den nächsten Alert erst, wenn der vorige `VoiceHandle` nicht mehr `alive` ist oder seine Nenndauer (`durationS` + 100 ms) vorbei ist. Alerts spielen ohne Position, gain 1, rate 1, `loop: false`.
- **Callbacks:** `onAlertStart(durationS)` nur bei gestarteter Stimme (Engine duckt sfx/music); `onAlert(record)` bei jeder Ansage, auch wenn der Sink die Stimme verwirft (gesperrte Engine, stumm, nicht geladen) – der Verlauf füllt sich also auch im Zustand `locked`, sofern die Engine `update` weiter aufruft.
- **Verlauf/Sprung:** Ring mit `historySize` (8) `AlertRecord`s. `jumpToLast()` ruft `onJumpTo(x, z)` des jüngsten Alerts mit Position; weitere Aufrufe binnen 3 s blättern zu älteren Alerts mit Position zurück und beginnen nach dem ältesten wieder beim jüngsten. `false`, wenn kein Alert mit Position im Verlauf ist.

## 5. Router-Vertrag

**Typ → Kind:** `Int16Array(65536)` aus `eventTypes` (Standard: vorläufige `DEFAULT_EVENT_TYPE_TABLE`, a1). Unbekannter Typ → `eventsUnmapped`. Ungültige Tabellen (kein u16, unbekannter Kind-Name) werfen im Konstruktor `RangeError`.

**Felder je Kind** (Semantik aus a1 `SIM_EVENT_KIND_INFO`):

| Kind | Sound | visual | aux | flags |
|---|---|---|---|---|
| weaponFire | `weapons[ref]` (Sound, gainDb, rate), sonst `weaponDefault` (Default-Map: null → unmapped) | Waffen-Visual → `visualName(visual)` = `core:wpn_*`, einmal je Visual-ID gecacht | – | UNLOCATED |
| projectileImpact | `impacts[Familie der Waffe][Oberfläche]`; unbekannte Waffe → `defaultFamily`; fehlende/unbekannte Oberfläche → ground; `null` (Schild) → stumm (`eventsIgnored`) | Visual der abfeuernden Waffe | Oberfläche 0 ground, 1 metal, 2 water, 3 shield, 4 structure | UNLOCATED |
| unitDeath | `deaths[Größe]`, mit AIR `airDeath`; mit STRUCTURE (ohne AIR) und Größe ≥ minSizeClass zusätzlich `structureCollapse` nach `delayMs` am selben Ort | – | Größenklasse 0–3 (größer → 3) | STRUCTURE, AIR, UNLOCATED |
| commanderDeath | `commanderDeath`, standardmäßig ohne Position (s. §3) | – | – | – |
| Regel-Kinds (route `sfx`) | `rule.sound`, plus `rule.then` nach `delayMs`, plus `rule.alert` in die Alert-Queue (mit Event-Position) | – | – | UNLOCATED |
| route `alert` | `rule.sound` als Alert-Name → `alerts.push` | – | – | UNLOCATED → ohne Position |
| alert | `ALERT_KINDS[aux]` → `alerts.push`; unbekannter Index → unmapped | – | Alert-Index 0–10 | UNLOCATED → ohne Position |
| route `ignore` | nichts (`eventsIgnored`) | | | |

- Regel-`gainDb`/`rate` der Tabellen-Kinds werden mit den Tabellenwerten multipliziert. `rule.spatial = false` oder Flag UNLOCATED → Play ohne x/z.
- Position: roh Q20.12 → WU (`/ FX_ONE`), x = `eventPos(i, 0)`, z = `eventPos(i, 2)`.
- Sounds werden **einmal** aufgelöst (Kinds, Familien × Oberflächen, Größen, Waffen-Slots) und als dichte Indizes gespielt (`PlayRequest.sound` = Zahl). Ein im Katalog fehlender Sound zählt als unmapped.
- **Zeitpunkt:** `when = ctxTime + (Δtick + subTick/256) · tickDurationS`, `tickDurationS = 0,1 / simSpeed` (`setSimSpeed`), Δtick = Tick − Tick des ersten Events im Batch, geklemmt auf 0…3. An `sink.play` geht `nowMs + Versatz·1000`, damit Sound-Cooldowns im Voice-Manager geplante Startzeiten vergleichen (sonst verwürfe der Cooldown alle Schüsse eines Ticks bis auf den ersten).
- **Aggregation** (nur innerhalb eines `handle`-Aufrufs): Zelle = floor(Versatz / tickDuration · 8), d. h. 8 Zellen je Tick (subTick ≫ 5). Alle Plays desselben Sounds in derselben Zelle werden zu einem Play: frühester Zeitpunkt der Zelle, Ort/Gain/Rate des lautesten Kandidaten (Regel-Gain × räumlicher Gain, wenn `spatial` übergeben ist; sonst Regel-Gain, bei Gleichstand der erste), Gain-Zuschlag +10·log10(min(n, 4)) dB (Faktor √min(n,4), max. +6 dB). Mit `spatial` zählen nur hörbare Kandidaten zu n. Folgesounds (then/Einsturz) aggregieren genauso in ihrer eigenen (verzögerten) Zelle.
- **Hot Path:** Typ-Tabelle, Visual-Slot-Cache (`Int16Array(65536)`), Staging-Tabellen als typisierte Arrays (wachsen nur bei größeren Batches), Open-Addressing-Hash mit Generationsstempel (kein Leeren je Aufruf), ein wiederverwendetes `PlayRequest` und `AlertRequest`.

## 6. Verträge für Folgepakete (c1/c2/d1)

- **Engine-Verdrahtung (c1):** `new AlertQueue({resolver: catalog, faction, clockMs: clock, rules: eventMap.alerts, onJumpTo, onAlert, onAlertStart: (d) => mixer.duck(...)})`; `new EventRouter({map: eventMap, eventTypes, resolver: catalog, faction, visualName, alerts: queue, spatial: cameraSpatial})`; `handleEvents(src)` → `router.handle(src, voiceManager, ctx.currentTime, clock())`; `update(now)` → `queue.update(now, voiceManager)` (auch im Zustand locked aufrufen, damit der Verlauf gefüllt wird); `jumpToLastAlert()` → `queue.jumpToLast()`; `setListener` → `spatial.setListener`; `setSimSpeed` → `router.setSimSpeed`. `stats.events/eventsUnmapped` aus `router.stats`, `alertsQueued` aus `queue.stats.queued`.
- **Konflikt Alert-Cooldown ↔ Voice-Manager (für c1/d1 zu lösen):** Der `VoiceManager` (b1) verwirft jeden Play desselben Sounds innerhalb dessen `cooldownMs` (`'cooldown'`). Bei Alerts ist `cooldownMs` das Wiederholintervall (z. B. 15 s), das die Queue bereits selbst verwaltet – die Orts-Ausnahme würde deshalb angesagt (Verlauf, `onAlert`, Sprung funktionieren), aber vom Voice-Manager stumm verworfen. Lösung in c1/d1: Der Voice-Manager überspringt den Sound-Cooldown für Kategorie `alert` (die Queue garantiert ohnehin genau eine Alert-Stimme), oder die Engine reicht der Queue einen Sink durch, der den Cooldown nicht prüft. Die Queue selbst ist dagegen robust (verworfene Stimme blockiert nichts).
- **Burst-Waffen (Gatling, MS14):** Der Router spielt je Schuss den Fallback `weapons[ref].sound` (Default-Map: `wpn_mg_t1_fire`, Rate 0,85), nie den Loop. Der keyed Burst-Loop (`burst:<handle>`, LoopSet aus b1) wird mit MS14 in der Engine ergänzt.
- **Fraktion:** Der Router löst alle Sounds mit **einer** Fraktion auf (Zuschauer-Fraktion). Es gibt im MVP nur Varkan; bei mehreren Fraktionen braucht der Router die Fraktion des Verursachers (z. B. über ein Armee→Fraktion-Mapping per `handle`) – dann Caches je Fraktion.

## 7. Abweichungen vom Plan

- **Zusätzliche Optionen:** `AlertQueue.rules` (Alert-Regeln der Event-Map für repeatMs/radiusWu – der Plan nennt beide als Quelle, aber keinen Übergabeweg), `defaultRadiusWu`, `jumpBackWindowMs`, `endMarginMs`; `EventRouter.spatial` (für „lautester/nächster Ort“ der Aggregation) und `commanderDeathGlobal`; `EventRouter.alerts` ist als strukturelles `AlertSink {push}` typisiert (AlertQueue erfüllt es).
- **Zusätzliche Zähler** `eventsIgnored`, `plays`, `dropped`, `alertsPushed`, `alertsSuppressed` (Router) und die Queue-Statistik.
- **commanderDeath ohne Position** (Begründung §3) statt eigener Zoom-Behandlung, weil das `SpatialModel`-Interface nur die Kategorie kennt.
- **`nowMs + Versatz`** an `sink.play` (§5), damit subTick-gestaffelte Schüsse nicht am Sound-Cooldown scheitern.
- `jumpToLast()` blättert nach dem ältesten Eintrag zyklisch zum jüngsten zurück (Plan offen).

## 8. Bekannte Grenzen

- Aggregation wirkt nur innerhalb eines `handle`-Aufrufs; zwei Frames mit Events desselben Ticks werden nicht zusammengeführt (Sim liefert Events eines Ticks in einem Frame).
- Ein durch Überlauf verdrängter oder verfallener Alert zählt trotzdem für sein Wiederholintervall (bewusst einfach; in der Praxis selten, da 4 Plätze und Alerts nur wenige pro Minute).
- Die Distanz nutzt nur die Bildhalbbreite; bei stark geneigter Kamera ist das sichtbare Bild in Tiefenrichtung größer/kleiner als seitlich.
- Der Router setzt `PlayRequest.loop = undefined`; die Event-Map enthält per Validierung (a1) keine Loops.

## 9. Tests und Messwerte

45 Tests in 3 Dateien:

| Datei | Tests | Inhalt |
|---|---|---|
| `test/spatial/camera-spatial-model.test.ts` | 9 | Pan links/Mitte/rechts, Tiefe mittig, Klemmen; gedrehte Kamera (90°, 180°, 45°, nicht normierter Rechtsvektor); Distanz 0 dB im Bild und monoton fallend, Formel bei r = 2; Culling je Kategorie-Cutoff und NaN; Zoom-Dämpfung je Profil (weapon −18 dB bei 480 WU < explosion < signature, Böden −30/−12/−6 dB); nicht räumliche Kategorien unverändert; entartete Listener gesäubert, ungültige Profile → RangeError; Property-Test (fast-check, 5000 Läufe): gain ∈ [0, 1], |pan| ≤ maxPan, unhörbar ⇒ gain 0; 1 Mio. `spatialize` ohne Heap-Zuwachs |
| `test/alerts/alert-queue.test.ts` | 15 | Priorität + FIFO + eine Stimme; nächster Alert nach Nenndauer trotz `alive`; onAlertStart/onAlert; stumme Ansage bei verworfener Stimme (locked) inkl. Sprung; unbekannter Alert; Intervall aus Manifest (base_attacked 15 s, unit_attacked 10 s, unabhängig); repeatMs-Override; Orts-Ausnahme (Spacing, Radius 64 aus der Map, Nähe zu allen jüngsten Orten, ohne Position keine Ausnahme); Default-Radius 48; Verfall; Überlauf/Verdrängung; jumpToLast ohne Verlauf/ohne Position, Zurückblättern binnen 3 s, Umlauf, Neustart nach 3 s, Ring; Leerlauf-`update` ohne Allokation |
| `test/router/event-router.test.ts` | 21 | echte Default-Map + echtes Manifest: weaponFire mit WU-Position; Alias `core:wpn_spark_mg_t1` → `wpn_mg_t1_fire` Rate 1,2 / −3 dB; `visualName` einmal je Visual, unbekannte Refs unmapped; Gatling-Fallback; Einschläge je Familie × Oberfläche inkl. Wasser (−6 dB, 0,8), Schild stumm, unbekannte Oberfläche, Fraktions-Fallback common; Tode je Größe/Luft/Einsturz nach 600 ms; commanderDeath global/positioniert; then-Folgesound (+350 ms), Zusatz-Alert, energyStall nicht räumlich, UNLOCATED, ignore; Alert-Kind per aux inkl. unbekanntem Index; Ende-zu-Ende mit echter AlertQueue + Sprung; unbekannte Typen, eigene Typtabelle, Fehler im Konstruktor; Override varkan vor common (synthetisches Manifest) und fremde Fraktion; subTick/Tick → when und geplante nowMs; simSpeed; Aggregation (Zellen, +6-dB-Deckel, frühester Zeitpunkt, lautester Kandidat, räumlich nächster Ort, Culling zählt nicht); keine Aggregation über Aufrufe, Tabellenwachstum bei 2000 Events; dropped; keine Resolver-Aufrufe je Event; Allokationstest |

Messwerte (lokal, M5 Pro, Node 24, Fake-Sink ohne Aufzeichnung):

- **Allokation:** 100 000 Events (500 Batches à 200 Events, alle MS5-Kinds + Alerts + räumliche Auswahl) nach 200 Batches Warmup: Heap-Zuwachs −12 KB (Grenze 1 MB). `spatialize` 1 Mio. Aufrufe und `AlertQueue.update` im Leerlauf 200 000 Aufrufe: jeweils < 256 KB.
- **Laufzeit `handle`** (Mikrobench im Scratchpad, 20 000 Wiederholungen nach Warmup): 36 Events je Batch (≈ Gefecht-200 je 10-Hz-Tick: 200 Schüsse + 150 Einschläge + 8 Tode pro Sekunde) p50 0,0010 ms / p99 0,0012 ms; 72 Events p50 0,0020 ms. Der Router ist damit ein vernachlässigbarer Teil des 0,5-ms-Budgets; die Kosten liegen beim Voice-Manager und den Web-Audio-Knoten.

## 10. Selbsttest

| Befehl | Ergebnis |
|---|---|
| `pnpm exec vitest run packages/audio/test/spatial packages/audio/test/alerts packages/audio/test/router` | ✅ 3 Dateien, 45 Tests, ≈ 0,2 s |
| `pnpm exec tsc -b packages/audio` | ✅ ohne Fehler |
| `tsc -p` (tsconfig.tests.json, eingeschränkt auf `test/{spatial,alerts,router}/**`) | ✅ ohne Fehler |
| `pnpm exec eslint packages/audio/src/{spatial,alerts,router} packages/audio/test/{spatial,alerts,router} --max-warnings 0` | ✅ |
