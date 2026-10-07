# audioeng-c1 – AudioEngine-Fassade, Barrel, Integrationstests, Node-Benchmark „Gefecht-200“

> **Track:** TRACK-AUDIOENG, Welle 2 · **Stand:** 2026-09-30 · **Branch:** `track-audioeng` (Worktree `.worktrees/faf-audioeng`)
> **Pfade:** `packages/audio/src/engine/**`, `packages/audio/src/index.ts`, `packages/audio/package.json`, `packages/audio/test/engine/**`, `packages/audio/bench/**`, `packages/audio/README.md`

## 1. Umgesetzt

- **`src/engine/engine.ts`** – `createAudioEngine(opts)` verdrahtet alle Module der Wellen 0/1 zu einem Objekt (`FafAudioEngine extends AudioEngine`).
- **`src/engine/index.ts`** – öffentliche Exporte des Moduls (`@faf/audio/engine`).
- **`src/index.ts`** – Barrel: `types`, `ports` (nur Typen), `engine`, `catalog`, `loader`, `decode`, `unlock`, `mixer`, `settings`, `voices`, `spatial`, `alerts`, `router`, `events` (keine Namenskonflikte, keine Zyklen – depcruise grün).
- **`test/engine/`** – Integrationstests mit Fake-AudioContext und echtem Manifest (`engine.test.ts`, `battle.test.ts`, `alloc.test.ts`, Hilfen `rig.ts`).
- **`bench/`** – Szenario `scenario.ts` (von Tests und Benchmark geteilt), schlanker Fake-Kontext `lean-context.ts`, Runner `run.ts`; `package.json`-Skript `bench`.
- **`README.md`** (englisch): API, Einbindung, Asset-Auslieferung.

## 2. Öffentliche API (`@faf/audio/engine`, auch über `@faf/audio`)

```ts
createAudioEngine(opts: AudioEngineOptions): FafAudioEngine
type AudioEngineOptions = CreateAudioEngineOptions & EngineExtraOptions
interface EngineExtraOptions {            // alle optional, v. a. Tests/Benchmark/Demo
  visibilityDocument?: VisibilityDocument | null   // Default globalThis.document; null = kein Tab-Mute
  timer?: () => number                    // Stoppuhr für Main-JS (Default performance.now)
  random?: () => number                   // Varianten/Jitter (Default Math.random)
  decoder?: DecoderLike                   // statt createDecodeChain(ctx)
  onLoadProgress?, onLoadError?, loadConcurrency?, initialSettings?
}
interface FafAudioEngine extends AudioEngine {
  readonly ready: Promise<void>           // Manifest geparst, Kern gebaut; reject bei Manifest-Fehler
  readonly context: AudioContextLike
  readonly mixer: Mixer; readonly spatial: CameraSpatialModel
  readonly catalog / loader / voices / loops / alerts / router   // null bis ready
  readonly faction: string; readonly muted: boolean
  onStateChange(fn: (state, previous) => void): () => void
  alertHistory(): AlertRecord[]           // neueste zuerst (allokiert, nur UI)
}
createDefaultAudioContext()               // new AudioContext({latencyHint:'interactive', sampleRate:48000}), Fallback ohne sampleRate
timingStats(values, n, scratch?)          // Perzentile (nearest rank)
DEFAULT_FACTION = 'varkan'; MAIN_JS_RING_SIZE = 1024
ALERT_DUCK_SFX_DB = −6; ALERT_DUCK_BED_DB = −8; ALERT_DUCK_ATTACK_MS = 30; ALERT_DUCK_RELEASE_MS = 400
```

`AudioEngine`/`CreateAudioEngineOptions` sind unverändert aus `types.ts`; `load()` liefert den `SoundLoadReport` des Loaders (ein `LoadReport` plus `variantsFailed`, `suspicious`, `failures`).

## 3. Verdrahtung

| Baustein | Aufbau in der Engine |
|---|---|
| AudioContext | `opts.context` (Objekt oder Fabrik) oder `createDefaultAudioContext()`; geschlossen wird er in `dispose()` nur, wenn die Engine ihn selbst erzeugt hat (Default oder Fabrik). |
| Settings | `createSettingsController(settingsStore ?? localStorageSettingsStore(), initialSettings)`; `null` = ohne Persistenz. `bindSettingsToMixer` + `attachVisibilityMute(document)`. |
| Mixer, Spatial, Unlocker | ab dem Konstruktor vorhanden, damit `unlock()` synchron in der ersten Geste aufrufbar ist – auch während das Manifest noch lädt. `AutoplayUnlocker(ctx, unlockTarget ?? document)`. |
| Kern (braucht das Manifest) | `SoundCatalog` → `createDecodeChain(ctx)` → `SoundLoader` (hängt `catalog.requestLoad → ensure` ein, Lazy-Laden) → `VoiceManager` (spatial = `CameraSpatialModel`, `maxVoices ?? manifest.maxVoices`) → `LoopSet` → `AlertQueue` (rules = Event-Map `alerts`, `onAlertStart` → Ducking) → `EventRouter` (Event-Map via `parseEventSoundMap`, Default-Map aus `events/`). Synchron bei `opts.manifest`, sonst nach `loadManifest(manifestUrl ?? baseUrl + 'manifest.json')` (`ready`). |
| Ducking | `onAlertStart(d)`: sfx −6 dB, music/ambience −8 dB, Attack 30 ms, Hold = Alert-Dauer, Release 400 ms. |
| Zustands-Gate | Ein `GatedSink` vor dem Voice-Manager: Zustand ≠ `running` → Drop `'locked'` (gezählt über `voices.countDrop`), Mixer stumm → Drop `'muted'` (nur One-Shots). Drei Instanzen: Events/`play`/`playUi` und Alerts (gezählt), Loops (nicht gezählt – Retries im 100-ms-Takt würden die Statistik fluten). |
| Alerts im gesperrten Zustand | Router und `alerts.update` laufen weiter: Verlauf, `onAlert` und Sprung funktionieren, die Stimme wird als `'locked'` verworfen (kein Nachholen). |
| Keyed Loops | werden auch im gesperrten Zustand angenommen und starten sofort beim Übergang nach `running` (Loops sind Zustand, keine veralteten Ereignisse). Vor `ready` gesetzte Loops werden gepuffert. |
| Vor `ready` | `handleEvents`/`play`/`playUi` zählen `notLoaded`, `setListener`/`setSimSpeed`/`setLoop` werden übernommen. |
| Main-JS | `handleEvents` + `play` + `playUi` + `setListener` + `setLoop` + `update` werden je Frame summiert (Frame-Grenze = `update`), Ring `Float64Array(1024)`; Perzentile nur in `stats()`. Stoppuhr `opts.timer` → `performance.now` → `opts.clock`. |
| `stats()` | Voice-Statistik (allokationsfrei gefüllt, erst hier in Objekte umgewandelt), Router-Zähler (`events`, `eventsUnmapped`), `alertsQueued`, Katalog (`loadedSounds`, `decodedBytes`), Loader-Pfade, `baseLatency`/`outputLatency` × 1000. |
| `dispose()` | Loops hart stoppen, Voice-Manager/Loader/Dekoder freigeben, Queue leeren, Puffer freigeben, Abos lösen (Settings→Mixer, Visibility, Unlocker inkl. `onstatechange`), Mixer trennen, eigenen Kontext schließen; idempotent. |

**Konflikt Alert-Cooldown (b3 §6) gelöst:** Der Voice-Manager sieht den Katalog über eine `VoiceResolver`-Sicht, in der Alert-Sounds `cooldownMs = 0` haben. Das Wiederholintervall (inkl. Orts-Ausnahme) verwaltet allein die `AlertQueue`, die ohnehin genau eine Alert-Stimme garantiert. Test: die Orts-Ausnahme innerhalb von 15 s wird hörbar angesagt, `dropped.cooldown = 0`.

## 4. Verträge für Folgepakete

- **c2 (Demo/Browser):** `createAudioEngine({baseUrl, manifestUrl?, visualName: battleVisualName, onJumpTo})` → `await engine.ready` → `engine.load(...)`; pro Frame `setListener`, `handleEvents(batch)`, `update(now)`. Szenario und Treiber sind wiederverwendbar: `BattleScenario`, `BattleDriver`, `BATTLE_WEAPONS`, `battleVisualName`, `BATTLE_LISTENER`, `DEFAULT_BATTLE_ALERTS`, `mulberry32` aus `packages/audio/bench/scenario.ts` (reiner TS-Code ohne Node-APIs). HUD-Werte aus `engine.stats()`.
- **MS5 (Client):** `eventTypes` = Zuordnung der Protokoll-Typ-IDs → `SimEventKind`, `visualName` für Waffen-Visuals (`core:wpn_*`), `playUi` aus dem Command-Builder, `setLoop('build:<army>', …)` aus dem Eco-Abschnitt, `onJumpTo` → Kamera, Settings-UI über `engine.settings`. Der FrameReader kann direkt an `handleEvents` übergeben werden.
- **d1:** Die Grenze 0,5 ms wird im Node-Benchmark nur gemeldet; `FAF_AUDIO_PERF_GATE=1` macht sie zum Gate (Exit-Code 1, DECISIONS 16).

## 5. Tests (21 in 3 Dateien, Fake-AudioContext, echtes Manifest)

| Datei | Tests | Inhalt |
|---|---|---|
| `test/engine/engine.test.ts` | 15 | Barrel/Modul-Exporte; Unlock-Fluss (locked → Geste → running, Listener entfernt, Events/`play`/`playUi` vorher als `locked` verworfen und nicht nachgeholt); Autoplay blockiert bis zur Freigabe, Re-Lock `suspended` nach Interruption; `unlock()` startet vorher gesetzte Loops (Retries nicht als Drop gezählt); **Ack bei vollem Pool (32 Loops niedriger Priorität) startet synchron im Aufruf (`start(0)`) per Steal**, ebenso UI; Alert duckt sfx −6/music+ambience −8 dB, Verlauf + `jumpToLastAlert`; Orts-Ausnahme hörbar (kein Voice-Cooldown); Alerts im gesperrten Zustand still + Sprung; Settings → Bus-Gains als Rampe, persistiert, beim nächsten Start geladen; Mute verwirft One-Shots, Tab-Mute; Lazy-Laden bei `notLoaded` (Fake-Server + Fake-Decoder), `load({tags:['MS5']})` = 17 Sounds; `manifestUrl`-Pfad (Nutzung vor `ready`, gepufferte Loops) und Fehlerpfad; Latenzen in ms, Main-JS-Ring; `dispose` (keine Listener, `onstatechange` zurückgesetzt, eigener Kontext geschlossen, fremder offen, Loops gestoppt, idempotent) |
| `test/engine/battle.test.ts` | 5 | **Gefecht-200** über 10 s bei 60 fps/10 Hz (2000 weaponFire über 6 Waffen-Refs, 1500 Einschläge, 80 Tode, 1 commanderDeath, 3 Alerts mit Ort, 2 Bau-Loops), Prüfung **nach jedem Frame**: Stimmen ≤ 32, je Kategorie ≤ Manifest-Limit, Tails ≤ 8, klingende Fake-Quellen ≤ Stimmen + Tails (≤ 40); Limits greifen (Steals, `categoryLimit`/`cooldown`/`culled` > 0, Waffen- und Einschlags-Kategorie erreichen ihr Limit 10/8); Explosionen hörbar (nie `globalLimit`, > 40 gestartet, Lotbruch hörbar), alle 3 Alerts gesprochen und sfx geduckt; Ack jede Sekunde mitten im Gefecht synchron; Sprung + Zurückblättern; 600 Main-JS-Samples. **Gefecht-400 + 18 Einheiten/Eco/Projektil/Ambience-Loops**: globales Budget 32 erreicht (> 60 volle Frames) und gehalten, `globalLimit` > 0, Explosionen/Alerts nie wegen des Budgets verworfen, eco/ambience verlieren zuerst. Ducking-Wert −6 dB und Rückkehr auf 1; gesperrte Engine verwirft das ganze Gefecht, nach dem Unlock starten nur die Bau-Loops; Pan links bei Schuss links. |
| `test/engine/alloc.test.ts` | 1 | 3000 Frames Warm-up, dann **20 000 Frames** Gefecht-200 (≈ 137 000 Events, ≈ 32 000 Starts): Heap-Zuwachs **36 KB** (Grenze 1 MB, Fake-Knoten-Anteil abgezogen: Δ lebender Quellen × 2 KB). Begründung der Grenze im Dateikopf: lebende Fake-Knoten sind auf 40 Stimmen × 3 Knoten (< 100 KB) begrenzt und an beiden Messpunkten ähnlich; 50 B Leck je Frame ergäben bereits 1 MB. |

Beobachtung aus dem Szenario: Bei Gefecht-200 erreichen die Kategorie-Limits (weapon 10, impact 8, explosion 6, alert 1, build 2 Loops) zusammen höchstens **27** Stimmen – das globale Budget greift erst, wenn weitere Kategorien (Einheiten-/Eco-Loops) dazukommen (zweiter Szenario-Test).

## 6. Node-Benchmark „Gefecht-200“

`pnpm --filter @faf/audio bench` (Skript `node --expose-gc --import tsx bench/run.ts`), Optionen `--quick` (5 s statt 30 s), `--runs N` (Default 2), `--seconds S`, `--update-docs`. Die echte Engine läuft gegen `bench/lean-context.ts` (Parameter ohne Automations-Log, Knoten ohne Graph, Quellen-Ende per linearem Scan), gemessen wird je Frame nur die Zeit in `handleEvents` + `update` (Event-Erzeugung ausgenommen). JSON nach `packages/audio/bench/results/<ISO-Zeit>.json` (git-ignoriert).

<!-- bench:audio:start -->
Lokal gemessen (Apple M5 Pro, Node 24.18.0, 2026-09-30); 30 s simuliert je Lauf, 60 fps, 10-Hz-Ticks, 3 s Warm-up; schlanker Fake-Kontext (bench/lean-context.ts). Engine-JS = handleEvents + update je Frame in ms. Grenze p95 ≤ 0,5 ms wird nur gemeldet (DECISIONS 5/16).

| Schüsse/s | Lauf | Events/s | JS p50 | JS p95 | JS p99 | JS max | p95 Event-Frames | Stimmen peak | gestartet | Steals | Drops (je Grund) | Heap gehalten | alloziert |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 1 | 183 | 0,0003 | 0,0108 | 0,0360 | 0,4095 | 0,0365 | 27 | 2062 | 2048 | cd 1804 · cat 744 · cull 285 | 264 KB | 5475 KB |
| 100 | 2 | 183 | 0,0003 | 0,0060 | 0,0132 | 0,0439 | 0,0137 | 27 | 2073 | 2067 | cd 1829 · cat 724 · cull 274 | 96 KB | 4469 KB |
| 200 | 1 | 358 | 0,0003 | 0,0097 | 0,0195 | 0,2061 | 0,0205 | 27 | 2536 | 2532 | cd 4109 · cat 1359 · cull 344 | 31 KB | 5028 KB |
| 200 | 2 | 358 | 0,0002 | 0,0072 | 0,0091 | 0,0405 | 0,0095 | 27 | 2525 | 2522 | cd 4039 · cat 1407 · cull 349 | 17 KB | 3925 KB |
| 400 | 1 | 708 | 0,0002 | 0,0100 | 0,0141 | 0,0398 | 0,0154 | 27 | 2817 | 2814 | cd 7806 · cat 2142 · cull 302 | 42 KB | 5035 KB |
| 400 | 2 | 708 | 0,0002 | 0,0102 | 0,0210 | 0,0866 | 0,0216 | 27 | 2751 | 2748 | cd 7756 · cat 2178 · cull 329 | 20 KB | 6125 KB |

Drop-Kürzel: cd = cooldown, cat = categoryLimit, snd = soundLimit, glob = globalLimit, cull = culled (unhörbar), nl = notLoaded.
„Heap gehalten“ = nach gc() noch lebender Zuwachs (Leck-Indikator). „alloziert“ = während des Laufs allozierte Bytes inkl. Müll (bench/heap.ts, kein gc() vor dem zweiten Messwert) — enthält Szenario-Treiber und die Fake-Knoten je gestarteter Stimme; der Event-Pfad selbst ist allokationsfrei (test/router/alloc.test.ts, test/engine/alloc.test.ts).
<!-- bench:audio:end -->

Einordnung: Die Node-Werte enthalten die JS-Seite der Engine inkl. des Anlegens von drei (schlanken) Knoten-Objekten je gestarteter Stimme; im Browser kommen die nativen Kosten von `createBufferSource`/`createGain`/`createStereoPanner`/`start` hinzu – die Browser-Messung liefert c2.

## 7. Abweichungen vom Plan

1. **Kontext nicht lazy beim ersten Zugriff, sondern im Konstruktor** erzeugt (Default oder Fabrik): Mixer und Unlocker brauchen ihn sofort, damit die erste Nutzergeste den Kontext entsperren kann. Ein vor der Geste erzeugter `AudioContext` ist erlaubt (Zustand `suspended`, Chrome meldet höchstens eine Warnung).
2. **Zusätzliche Optionen** (`EngineExtraOptions`) und Diagnose-Member (`FafAudioEngine`: `ready`, Modul-Instanzen, `onStateChange`, `alertHistory`, `muted`, `faction`) – der Vertrag `AudioEngine` bleibt unverändert.
3. **Mute-Gate:** Bei stummem Mixer (Nutzer-Mute oder verborgener Tab) werden One-Shots als `'muted'` verworfen statt stumm abgespielt (spart Stimmen und Knoten); Loops laufen stumm weiter.
4. **Main-JS** zählt zusätzlich `setListener` und `setLoop` (ebenfalls Arbeit pro Frame).
5. **Alert-Cooldown** im Voice-Manager für Kategorie `alert` ausgeschaltet (`VoiceResolver`, §3) – Lösung des in b3 §6 dokumentierten Konflikts.
6. **Bench-Skript** mit `--expose-gc` (für das warme Heap-Delta), sonst wie vorgegeben; ohne das Flag wird das Delta als `n/a` gemeldet.
7. **`bench/scenario.ts`** ist zugleich Testhilfe (Tests importieren es) und von c2 nutzbar; der Treiber misst über `hooks.timer` nur die Engine-Aufrufe.

## 8. Bekannte Grenzen

- Der Fake-Kontext rendert kein Audio: Pegel, Pan in dB, Limiter-Peak und Loop-Naht belegt c2 im echten OfflineAudioContext.
- Die Node-Zeiten modellieren die nativen Web-Audio-Kosten nicht (§6); das 0,5-ms-Budget gilt verbindlich für die Browser-Messung.
- Bei Gefecht-200 bleibt das globale Budget ungenutzt (27 von 32), weil die Kategorie-Limits vorher greifen – gewollt laut Manifest-Policy; mehr Gleichzeitigkeit nur über höhere Kategorie-Limits.
- `alertHistory()` und `stats()` allokieren (nur für HUD/Diagnose gedacht, nicht pro Frame aufrufen – oder einmal je Sekunde).
- Mehrere Fraktionen gleichzeitig (Router löst mit **einer** Fraktion auf, b3 §6) sind nicht Teil dieses Pakets.

## 9. Selbsttest

| Befehl | Ergebnis |
|---|---|
| `pnpm exec vitest run packages/audio/test/engine` | ✅ 3 Dateien, 21 Tests |
| `pnpm exec vitest run packages/audio` | ✅ 30 Dateien, 305 Tests (≈ 2,6 s) |
| `pnpm exec tsc -b packages/audio` | ✅ |
| `tools/heavy pnpm exec tsc -p tsconfig.tests.json --noEmit` | ✅ |
| `pnpm exec eslint packages/audio/src/engine packages/audio/src/index.ts packages/audio/test/engine packages/audio/bench --max-warnings 0` | ✅ |
| `pnpm exec depcruise --config .dependency-cruiser.cjs packages/audio` | ✅ keine Verstöße |
| `tools/heavy pnpm --filter @faf/audio bench -- --update-docs` | ✅ (Tabelle oben) |
