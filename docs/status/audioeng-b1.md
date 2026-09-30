# audioeng-b1 – Mixer, Settings, Voice-Manager (TRACK-AUDIOENG, Welle 1)

> **Stand:** 2026-09-29 · Branch `track-audioeng` (Worktree `faf-audioeng`) · **Pfade:** `packages/audio/src/{mixer,settings,voices}/**`, `packages/audio/test/{mixer,settings,voices}/**`

## 1. Umgesetzt

- **`src/mixer/`** (`@faf/audio/mixer`): `Mixer` mit Bus-Graph, wahrnehmungsgerechter Lautstärkekurve, Mute-Quellen, Ducking und Sicherheits-Limiter; `curve.ts` mit `sliderToGain` u. a.
- **`src/settings/`** (`@faf/audio/settings`): `createSettingsController` (Klemmen, feldweise Bereinigung, Versionierung `{v:1,…}`), `localStorageSettingsStore` (jeder Zugriff abgesichert), `memorySettingsStore`, `bindSettingsToMixer`, `attachVisibilityMute`.
- **`src/voices/`** (`@faf/audio/voices`): `VoiceManager implements SoundSink` (32 Stimmen, Sound-/Kategorie-/Global-Limits, Priorität, Stealing mit Fade und Tail-Budget, Cooldown je Sound, Varianten-Rotation, ±3 % Rate, Loops mit Loop-Punkten in Sekunden, Generationen-Handles, allokationsfreie Statistik), `LoopSet` (keyed Loops mit Neustart verlorener Stimmen), `VoiceStats`/`createVoiceStats`.
- Die Implementierungen von b2 (Katalog) und b3 (Spatial) werden nicht benutzt: Tests laufen gegen eigene Fakes `test/voices/fakes.ts` (`FakeResolver` über ein echtes oder synthetisches Manifest mit `fakeBuffersFor`, `FakeSpatial`, `makeRig`, `seededRandom`).

## 2. Öffentliche API

```ts
// @faf/audio/mixer
new Mixer(ctx: BaseAudioContextLike, opts?: { volumes?: Partial<Record<BusId, number>>, muted?: boolean, destination?: AudioNodeLike })
  .busInput(bus: ChannelBus): AudioNodeLike
  .setVolume(bus: BusId, slider01: number, immediate = false)   // Rampe τ 15 ms; immediate nur für den Anfangszustand
  .volume(bus): number
  .setMuted(muted: boolean, source: MuteSource = 'user', immediate = false)   // MuteSource = 'user' | 'hidden' | 'system'
  .muted: boolean; .isMutedBy(source): boolean
  .duck(buses: readonly ChannelBus[], db: number, attackMs, holdMs, releaseMs)
  .duckLevel(bus): number            // aktives Duck-Ziel (1 = kein Ducking)
  .limiterReductionDb: number        // Metering des Limiters (≤ 0)
  .graph: MixerGraph                 // { input, user, duck, mute, limiter } – Diagnose/Tests
  .dispose()
CHANNEL_BUSES, LIMITER_SETTINGS, RAMP_TAU_S (0.015)
sliderToGain(v), gainToSlider(g), dbToGain(db), gainToDb(g), clamp01(v)

// @faf/audio/settings
createSettingsController(store: SettingsStore | null, initial?: Partial<AudioSettings>): SettingsController
localStorageSettingsStore(key = 'faf.audio.v1', storage?: StorageLike | null): SettingsStore
memorySettingsStore(initial?): SettingsStore & { value, saves }
bindSettingsToMixer(controller, mixer): () => void          // Unbind
applySettingsToMixer(settings, mixer, immediate?)
attachVisibilityMute(doc: VisibilityDocument, controller, mixer): () => void   // Detach
sanitizeSettings(raw, base?), toStored(s), SETTINGS_VERSION (1), SETTINGS_STORAGE_KEY, VOLUME_KEYS, FLAG_KEYS

// @faf/audio/voices
new VoiceManager({ ctx, mixer: { busInput }, resolver: SoundResolver, spatial?: SpatialModel | null, faction,
                   maxVoices = 32, clockMs?: () => number, random = Math.random, tailBudget = 8,
                   stealFadeMs = 8, cullGain = 10^(−48/20), rateJitter = 0.03 })
  .play(req: PlayRequest, nowMs): VoiceHandle | null     // SoundSink
  .lastDrop: DropReason | null                           // Grund des letzten play(); null nach Erfolg
  .update(nowMs?)                                        // pro Frame: verlorene onended-Ereignisse aufräumen
  .refreshSpatial()                                      // nach Listener-Änderung: laufende räumliche Stimmen neu bewerten
  .setSpatialModel(model | null)
  .stopAll(fadeMs = 40), .dispose()
  .countDrop(reason)                                     // Drops, die die Engine entscheidet ('locked', 'muted')
  .snapshotStats(out: VoiceStats), .resetStats()
  .voiceCount, .tails, .categoryVoices(ci), .soundVoices(i), .poolSize
new LoopSet(sink: SoundSink, { retryMs = 100, stopFadeMs = 40 })
  .set(key, req | null, nowMs): VoiceHandle | null
  .update(nowMs), .clear(fadeMs?), .handle(key), .has(key), .size
createVoiceStats(), dropReasonIndex(reason)
DEFAULT_STOP_FADE_MS (40), VOICE_RAMP_TAU_S (0.015), DEFAULT_CULL_GAIN
```

## 3. Mixer

**Graph je Kanal-Bus** (sfx, ui, alerts, music, ambience):
`input(bus)` (Einheitsverstärkung, Anschlusspunkt der Stimmen) → `user(bus)` (Regler) → `duck(bus)` → `user(master)` → `mute` → Limiter (`DynamicsCompressor` −3 dB, Knee 0, Ratio 20, Attack 3 ms, Release 120 ms) → `destination`. 17 Knoten (16 Gain + 1 Kompressor). Der Pfad ist per `graphPathToDestination` im Test belegt.

**Kurve `sliderToGain(v) = v²`** (geklemmt 0..1, NaN → 0), monoton, 0 → 0, 1 → 1. Begründung: Nach Stevens wächst die empfundene Lautheit etwa mit (Schalldruck)^0,6; ein in der Lautheit linear wirkender Regler braucht daher gain ≈ v^1,67, v² liegt dicht daran und gibt am leisen Ende etwas mehr Feinauflösung. Anders als eine dB-lineare 50-dB-Kurve erreicht v² exakt 0 ohne Sonderfall/Sprung und lässt die untere Reglerhälfte nutzbar (bei 50 dB dB-linear läge die Mitte schon bei −25 dB, zusammen mit den −20…−30 LUFS der Dateien und der Distanzdämpfung praktisch unhörbar).

| Regler | 1 | 0,75 | 0,5 | 0,25 | 0,1 | 0,05 | 0 |
|---|---|---|---|---|---|---|---|
| dB | 0 | −5,0 | −12,0 | −24,1 | −40 | −52 | −∞ |

**Rampen:** Jede Änderung nach dem Aufbau läuft über `cancelScheduledValues(now)` + `setTargetAtTime(ziel, now, 0,015)`; auf diesen Parametern liegen nur Target-Ereignisse, das Abbrechen künftiger Ereignisse erzeugt daher nie einen Sprung. Nur der Anfangszustand (Konstruktor, `bindSettingsToMixer` beim Binden) wird direkt gesetzt, weil dann noch nichts spielt.

**Mute-Quellen:** `setMuted(b, source)` mit `'user'` (Einstellung), `'hidden'` (Tab verborgen), `'system'` (frei für die Engine). Stumm, solange irgendeine Quelle stummschaltet; nur der Übergang stumm ↔ hörbar erzeugt eine Rampe. So hebt „Tab wieder sichtbar“ ein Nutzer-Mute nicht auf.

**Ducking:** `duck(buses, db, attackMs, holdMs, releaseMs)`: Ziel `10^(min(db,0)/20)`, Attack als `setTargetAtTime` mit τ = attack/3 (≈ 95 % nach attackMs), Halten bis `now + attack + hold`, Release mit τ = release/3 zurück auf 1. Überlappung je Bus: solange ein Ducking aktiv ist (vor Release-Beginn), gilt `min(aktuell, neu)` (tiefster Wert gewinnt) und Release-Beginn = `max(alt, neu)` (Hold verlängert sich); künftige Release-Ereignisse werden dabei ersetzt. Positive dB-Werte boosten nie.

## 4. Settings

- Start: Defaults ← `initial` (bereinigt) ← gespeicherte Werte (feldweise, der gespeicherte Nutzerwunsch gewinnt; `localStorageSettingsStore` speichert immer das vollständige Objekt).
- Bereinigung (`sanitizeSettings`): endliche Zahlen → auf 0..1 geklemmt; NaN/±∞/falscher Typ/fehlend → bisheriger bzw. Default-Wert; Flags nur als echte Booleans; unbekannte Schlüssel ignoriert. `v ≠ 1` → das ganze Objekt verworfen (Defaults); fehlendes `v` wird akzeptiert (einfache In-Memory-Stores).
- `set(patch)`: bereinigt, bei echter Änderung neuer eingefrorener Snapshot → `store.save` (Fehler geschluckt) → Abonnenten. `get()` liefert den eingefrorenen Snapshot (Identitätsvergleich möglich).
- `localStorageSettingsStore`: jeder Zugriff in `try/catch` – auch der Zugriff auf `globalThis.localStorage` selbst (SecurityError bei blockierten Site-Daten), `getItem`/`setItem` (Private Mode, Quota), kaputtes JSON → `load()` = null.
- `attachVisibilityMute(doc, controller, mixer)`: Mute-Quelle `'hidden'`, wenn `visibilityState === 'hidden'` und `muteWhenHidden`; reagiert auch auf das Umschalten der Einstellung während der Tab verborgen ist; Rampe τ 15 ms (sanft). Detach entfernt Listener und Abo und hebt `'hidden'` auf (idempotent). `VisibilityDocument` ist strukturell; `Document` passt (statisch im Test belegt).

## 5. Voice-Manager – Regeln exakt

Ablauf von `play(req, nowMs)`; der erste zutreffende Grund beendet mit `null`:

1. **Auflösen:** Zahl → `resolver.byIndex` (nur ganzzahlig in 0..size−1), String → `resolver.resolve(name, req.faction ?? faction)`; sonst `unknownSound`.
2. **Geladen?** `!resolver.isLoaded(i)` → `resolver.requestLoad(i)`, `notLoaded`.
3. **Cooldown je Sound:** `nowMs − lastStartMs[i] < cooldownMs` → `cooldown` (Float64Array, nur erfolgreiche Starts setzen die Zeit; ein Drop verlängert nichts).
4. **Variante:** zufällig, bei ≥ 2 Varianten nie die vorige (gleichverteilt über die übrigen); nicht dekodierte Varianten werden übersprungen; keine Variante → `requestLoad` + `notLoaded`.
5. **Räumlich/Culling (vor jeder Stimmenvergabe):** Nur wenn `sound.spatial`, ein Modell gesetzt ist und `x` **und** `z` gesetzt sind: `spatialize(categoryIndex, x, z, out)`; `false` → `culled`. Effektive Lautstärke `eff = req.gain × spatial.gain`; `eff < cullGain` (−48 dB) oder 0 → `culled` (gilt auch für nicht räumliche Anfragen mit Gain ≈ 0). Nicht räumlich: Pan 0.
6. **Limits** mit Priorität `p = sound.priority + (priorityBoost ?? 0)`, Lautheit einer laufenden Stimme `L = effGain × Restanteil` (Restanteil = (Ende − jetzt)/Länge, geklemmt 0..1; Loops und noch nicht gestartete Stimmen: 1):
   - **Sound-Limit** (`soundVoices ≥ sound.maxVoices`): Kandidaten = Stimmen desselben Sounds mit `prio ≤ p` und (kein Loop oder `prio < p`); Opfer = kleinstes L, bei Gleichstand die älteste. Gestohlen wird nur, wenn `eff ≥ L(Opfer)`, sonst `soundLimit`.
   - **Kategorie-Limit** (`categoryVoices ≥ categoryMaxVoices`): wie oben innerhalb der Kategorie, sonst `categoryLimit`.
   - **Global** (alle `maxVoices` belegt): Opfer = kleinstes L unter allen Stimmen mit `prio < p` (streng), Gleichstand → älteste; keine Lautheitsbedingung; sonst `globalLimit`.
   - Folgen: Höhere Priorität wird nie von niedrigerer verdrängt; laufende Loops nur von streng höherer Priorität (auch innerhalb von Sound/Kategorie); ein Steal auf Sound-/Kategorie-Ebene macht die folgenden Prüfungen automatisch frei (Invarianten).
7. **Steal/Stop → Tail:** Die Stimme gibt ihren logischen Platz sofort frei (Handle `alive = false`) und blendet linear von ihrem **aktuell spielenden** Gain-Wert (`param.value`, auch mitten in einer Rampe) auf 0 aus: gestohlen in `stealFadeMs` (8 ms), `handle.stop(fadeMs)` mit Default 40 ms; `source.stop(t + fade)`. Tails zählen nicht zu den 32 Plätzen, sind aber auf `tailBudget` (8) begrenzt: ist das Budget voll, wird der **älteste** Tail hart geschnitten (er ist am weitesten ausgeblendet) und sein Platz genutzt. `fadeMs ≤ 0` schneidet sofort (kein Tail).
8. **Start:** `source → Gain(eff) → StereoPanner(pan) → mixer.busInput(sound.bus)`; `playbackRate = req.rate × (1 ± 0,03·zufällig)` – ohne Jitter für Loops, Musik und Alerts; `start(when)` mit `when = max(req.when ?? 0, 0)` (NaN/∞ → 0); **ui/ack immer `start(0)`** synchron im selben Aufruf, auch bei vollem Pool (Steal über ihre Priorität 80/85).
9. **Loops** (`req.loop ?? sound.loop !== null`): `loop = true`, `loopStart/loopEnd = loop.startS/endS` in **Sekunden** (korrekt auch für auf 44,1 kHz resampelte Puffer; `loopEnd` auf die Pufferlänge begrenzt), Start bei Offset 0. `req.loop = true` bei einem One-Shot loopt den ganzen Puffer.
10. **Handles:** `VoiceHandle` = (Slot-Record, Generation, id); jede Freigabe erhöht die Generation, `alive` und alle Operationen prüfen sie – ein altes Handle ist nach Ende/Steal/Wiederbelegung ein No-op. `setGain(g, rampMs?)` (Default τ 15 ms, `rampMs = 0` sofort, sonst τ = rampMs/3), `setRate(r)` (Rampe, Jitter bleibt, geschätztes Ende wird umgerechnet), `setPosition(x, z)` (neu räumlich, Gain und Pan per `setTargetAtTime`; unhörbar → Gain 0, Stimme bleibt).
11. **Verspätetes `onended`:** Jeder Record (32 Slots, 8 Tails) hat einen einmal im Konstruktor erzeugten Handler. Verlässt eine Quelle ihren Record (Steal/Stop → Tail, harter Schnitt, Aufräumen), wird ihr `onended` umgehängt bzw. auf `null` gesetzt – ein später eintreffendes Ereignis landet daher beim richtigen Besitzer. Zusätzlich verwirft der Handler Ereignisse, deren `target` (im Browser die Quelle) nicht die aktuelle Quelle des Records ist. Test: ein vor dem Steal abgegriffener Slot-Handler, spät mit `target = alte Quelle` aufgerufen, gibt die neue Stimme nicht frei.
12. **Aufräumen:** `update()` gibt Stimmen/Tails frei, deren `onended` 0,5 s nach dem berechneten Ende nicht kam (z. B. geschlossener Kontext); dabei wird `onended` gelöst.

**Statistik** ohne Allokation: `voices`, `peakVoices`, `tails`, `byCategory` (Int32Array in `SOUND_CATEGORIES`-Reihenfolge), `played`, `stolen` (nur Steals, keine Stops), `dropped` (Int32Array in `DROP_REASONS`-Reihenfolge), `lastDrop` (zuletzt aufgetretener Drop-Grund, bleibt stehen). `snapshotStats(out)` füllt ein Objekt des Aufrufers (`createVoiceStats()` einmal anlegen).

**Allokation:** Vorab angelegt sind 32 Slot- und 8 Tail-Records mit ihren Handlern, `Float64Array lastStartMs`, `Int32Array` Zähler je Sound/Kategorie/Drop-Grund, `Int16Array` letzte Variante, ein `SpatialResult`. Ein verworfener Request allokiert nichts. Ein gestarteter allokiert seine drei Web-Audio-Knoten und genau ein kleines Handle-Objekt (der Vertrag verlangt eine eigene Identität je Stimme, die nach dem Ende als No-op gültig bleibt) – keine Closures.

## 6. LoopSet

`set(key, req, nowMs)`: neuer Key → Eintrag (eigenes, wiederverwendetes `PlayRequest`, `loop` Default true) und Start; gleicher Sound → nur geänderte Werte als Rampen (`setGain`, `setRate`, `setPosition`; Änderungen < 1e−4 werden nicht gesendet); anderer Sound/Fraktion → alte Stimme mit Fade stoppen, neue starten; `null` → Stopp mit Fade (40 ms) und Eintrag entfernen. Verlorene Stimmen (gestohlen, `culled`, `notLoaded`, Limit) werden beim nächsten `set()` oder `update(nowMs)` neu gestartet, höchstens alle `retryMs` (100 ms), damit ein dauerhaft blockierter Loop die Drop-Statistik nicht pro Frame füllt. Einträge in dichtem Array + Map Key → Index; `set` für bekannte Keys und `update` allokieren nichts. Ein aus dem Hörbereich bewegter laufender Loop bleibt mit Gain 0 bestehen (kleinste Lautheit → wird als Erstes gestohlen) und startet danach über den Retry wieder, sobald er hörbar ist.

## 7. Verträge für Folgepakete (c1/c2)

- Engine pro Frame: `voices.update(now)` und `loops.update(now)`; nach `setListener` → `voices.refreshSpatial()` (32 Stimmen, keine Allokation).
- Alert-Ducking: `mixer.duck(['sfx', 'music', 'ambience'], −6 … −8, 30, dauerMs, 400)` aus `onAlertStart(durationS)`.
- Settings: `createSettingsController(opts.settingsStore ?? localStorageSettingsStore(), …)`, `bindSettingsToMixer(controller, mixer)`, `attachVisibilityMute(document, controller, mixer)`; Engine-eigene Stummschaltung über `mixer.setMuted(b, 'system')`.
- Drops im Zustand locked/suspended über `voices.countDrop('locked')`, damit alle Drops in einer Statistik stehen.
- `AudioStats.voicesByCategory` aus `stats.byCategory[i]` mit `SOUND_CATEGORIES[i]`, `dropped` aus `stats.dropped[i]` mit `DROP_REASONS[i]` (nur in `stats()` in Objekte umwandeln).
- `mixer.busInput(bus)` ist der Anschlusspunkt für eigene Knoten (z. B. Tests mit echtem OfflineAudioContext in c2).

## 8. Abweichungen vom Plan

1. Kurve **v²** statt dB-linear (Plan ließ beides zu; Begründung §3).
2. `busInput(bus)` ist ein eigener Einheits-Gain-Knoten vor dem Regler (wie im Plan-Pfad), 5 Knoten mehr.
3. `setMuted(b, source = 'user', immediate?)` mit Mute-Quellen statt eines einzelnen Flags (nötig, damit Tab-Mute und Nutzer-Mute sich nicht gegenseitig aufheben); `setVolume(bus, v, immediate?)` und `duckLevel`, `limiterReductionDb`, `graph` als Zusätze.
4. Tail-Budget voll → der **älteste Tail** wird hart geschnitten, nicht das neue Opfer (leiser, da schon weitgehend ausgeblendet). `handle.stop()` nutzt dieselbe Tail-Mechanik wie Steals.
5. Schutz vor verspätetem `onended` ohne Closure je Stimme: vorab erzeugte Handler je Record + Umhängen + `target`-Prüfung; der Generationszähler sitzt in den Handles (§5 Punkt 10/11).
6. Culling unter −48 dB gilt auch für nicht räumliche Anfragen (Gain ≈ 0 ist unhörbar und soll keine Stimme belegen).
7. `clockMs` ist eine Funktion `() => number` (Default `performance.now`), genutzt von `update()` ohne Argument.
8. `lastDrop` am `SoundSink` = Ergebnis des letzten `play()` (null nach Erfolg); in `VoiceStats.lastDrop` bleibt der zuletzt aufgetretene Grund stehen.
9. Zusätze: `refreshSpatial`, `setSpatialModel`, `countDrop`, `stopAll`, `dispose`, `poolSize`, `categoryVoices`, `soundVoices`, `rateJitter`-Option, `memorySettingsStore`, `sanitizeSettings`, `applySettingsToMixer`.

## 9. Bekannte Grenzen

- Der Fake rendert kein Audio: Limiter-Pegel (Peak ≤ 1,0 bei 32 lauten Stimmen), Pan in dB und die Loop-Naht weist erst c2 im echten OfflineAudioContext nach; hier sind Graph, Parameter und Automationskurven belegt.
- Der `target`-Schutz gegen verspätete Ereignisse wirkt nur mit echten Events (Browser); im Fake gibt es konstruktionsbedingt keine verspäteten Ereignisse (Handler werden umgehängt, bevor ein Ereignis feuern kann).
- Das Ende einer Stimme wird aus Pufferdauer/Rate geschätzt (Restanteil für Stealing, Aufräumen in `update`); spätere Rate-Automationen außerhalb von `setRate` kennt der Manager nicht.
- UI/Ack erhalten den ±3 %-Jitter (Plan nimmt nur Loops/Musik/Alerts aus); ein Cooldown kann auch UI/Ack verwerfen (Manifest: ui 30 ms, ack 150 ms).
- Aus dem Hörbereich bewegte Loops belegen bis zum nächsten Steal einen Platz mit Gain 0 (§6).

## 10. Tests und Messwerte

63 Tests in 6 Dateien (Vitest, Fake-AudioContext):

| Datei | Tests | Inhalt |
|---|---|---|
| `test/mixer/mixer.test.ts` | 12 | Kurve (0 → 0, 1 → 1, Klemmen/NaN, Monotonie per fast-check 2 000 Paare + streng auf 0,001-Raster, Referenzpunkte, Inverse), Graph-Pfad je Bus inkl. Limiter, Limiter-Parameter, Anfangszustand ohne Automation, Rampen statt Sprünge (τ, Weiterlaufen aus Zwischenwert), Mute-Quellen, Ducking (Attack/Hold/Release, Überlappung: tiefster Wert + verlängerter Hold, Neustart nach Release, kein Boost), dispose |
| `test/settings/settings.test.ts` | 11 | Defaults/initial, Klemmen + ungültige Werte, eingefrorene Snapshots + Abos, Persistenz-Roundtrip (localStorage-Format `{v:1}`), kaputtes JSON / fremde Version / Array / feldweise kaputte Werte → Defaults, werfender Storage / werfender `localStorage`-Getter / werfender Store, globales `localStorage`, Memory-Store, Bindung an Mixer (sofort, dann Rampen, Unbind), Visibility-Mute (sanft, Nutzer-Mute bleibt, Umschalten während verborgen, Detach, Start verborgen), `Document` passt statisch |
| `test/voices/voice-manager.test.ts` | 33 | Routing je Kategorie per Graph-Pfad, Lookup, unknown/notLoaded + requestLoad, nur geladene Varianten, UI/Ack synchron bei vollem Pool (32 × 10-s-Waffen) auch mit künftigem `when`, `when`-Planung, Cooldown 49/50 ms + Unabhängigkeit, Varianten (600 Starts: nie Wiederholung, alle erreicht), Rate-Band ±3 % (genutzt, ohne Jitter bei Loop/Musik/Alert/Ambience), Loop-Punkte in Sekunden bei 44,1 kHz, `req.loop`, Loop-Stop-Fade 40 ms, Stop während Gain-Rampe ohne Sprung, `stop(0)`, Alert verdrängt Waffe / Waffe nie Alert oder Ack, leiseste niedrigere Stimme, Restanteil, Gleichstand → älteste, Sound- und Kategorie-Stealing mit Lautheitsbedingung, Loops nur durch höhere Priorität, Boost-Schutz, Steal-Fade 8 ms, Tail-Budget, verspätetes `onended` nach Slot-Reuse + No-op-Handles, Culling vor Stimmenvergabe, Gain × Spatial + Pan, setPosition/setGain/setRate-Rampen, refreshSpatial, Statistik, update-Aufräumen, stopAll/dispose |
| `test/voices/limits.property.test.ts` | 1 | fast-check, 10 Läufe × 1 000 zufällige Requests (unverzerrt über alle 101 echten Sounds, Gain, Position, Boost, Loop, Stops, Zeitfortschritt): nach jedem Schritt unabhängige Zählung über lebende Handles = `voiceCount` ≤ 32, je Kategorie/Sound ≤ Manifest-Limit, Tails ≤ 8, `fake.liveSources === voices + tails` (≤ 40); Pool erreicht 32, Steals und Drops > 0 |
| `test/voices/loop-set.test.ts` | 5 | Start/Update (keine redundanten Rampen)/Stop mit Fade, Neustart nach Steal mit Retry-Intervall, Sound-Wechsel, mehrere Keys + clear, notLoaded/culled → späterer Start |
| `test/voices/alloc.test.ts` | 1 | 10 000 Aufrufe Warm-up, dann 50 000 `play()` mit Zeitfortschritt, Stops und Steals: `poolSize` konstant (40), Heap-Zuwachs < 2 MB |

**Messwerte (lokal, Apple M5 Pro, Node 24, Fake-Kontext):**
- Heap-Zuwachs nach 50 000 `play()` (≈ 37 000 Starts, ≈ 1 800 Steals): **29 KB** (Grenze 2 MB: am Messpunkt dürfen höchstens 32 Stimmen + 8 Tails mit je drei Fake-Knoten leben, < 100 KB, plus V8-Rauschen; ein Leck von 40 B je Aufruf ergäbe bereits 2 MB).
- `play()` verworfen (Cooldown): ≈ 20–75 ns; gemischte Last inkl. Anlegen der Fake-Knoten und Steals: ≈ 0,3–0,4 µs je Aufruf (Skript-Messung, 3 Durchgänge, nicht eingecheckt).
- Property-Test ≈ 2 s, übrige Dateien < 0,1 s.

## 11. Selbsttest

| Befehl | Ergebnis |
|---|---|
| `pnpm exec vitest run packages/audio/test/mixer packages/audio/test/settings packages/audio/test/voices` | 6 Dateien, 63/63 grün (≈ 2,3 s) |
| `pnpm exec tsc -b packages/audio` | grün |
| `tools/heavy pnpm exec tsc -p tsconfig.tests.json --noEmit` | grün (exit 0) |
| `pnpm exec eslint packages/audio/src/{mixer,settings,voices} packages/audio/test/{mixer,settings,voices} --max-warnings 0` | grün |
