# audioeng-a0 – Scaffold, Verträge, Fake-AudioContext, Demo-Gerüst (TRACK-AUDIOENG, Welle 0)

Stand 2026-09-29, Branch `track-audioeng` (Worktree `faf-audioeng`).

## Umgesetzt

- **Paket `packages/audio` (`@faf/audio`)**: `package.json` (private, ESM, `exports {'.': './src/index.ts', './*': './src/*/index.ts'}`, einzige Abhängigkeit `opus-decoder ^0.7.12`, keine Workspace-Deps, kein bench-Skript), `tsconfig.json` analog `packages/render` (ohne references, `include src/**/*.ts|json`).
- **Verträge** `src/types.ts` und `src/ports.ts` exakt nach Plan (Details unten), `src/index.ts` als vorläufiges Barrel (`export *` aus types, `export type *` aus ports).
- **Test-Infrastruktur** `test/support/` (Fake-Web-Audio, Manifest-Helfer, `index.ts` re-exportiert beides) mit eigenen Tests.
- **Demo-Gerüst** `apps/audio-demo` (`@faf/audio-demo`): Vite-Multi-Page (index + offline), Asset-Plugin `fafAudioAssets`, minimaler echter Bootstrap.
- **Root-Konfiguration** additiv (siehe unten), `pnpm-lock.yaml` aktualisiert.

## Öffentliche API (Verträge für alle Folgepakete)

### `src/types.ts`

| Name | Inhalt |
|---|---|
| `SoundCategory`, `SOUND_CATEGORIES`, `categoryIndex(c)` | 15 Kategorien in fester Reihenfolge (absteigende Manifest-Priorität, Test belegt): alert, music, signature, ack, ui, explosion, weapon, shield, impact, projectile, build, intel, unit, ambience, eco. Index 0..14 für `Int32Array`-Zähler. |
| `isSoundCategory(s)`, `isManifestBus(s)` | Typwächter für untrusted Strings (Manifest-Parser b2). *Zusatz.* |
| `ManifestBus`, `BusId`, `ChannelBus`, `BUS_IDS`, `MANIFEST_BUS_TO_BUS` | `voice → alerts` (Quittungen + Alerts auf dem Alerts-Bus). |
| `ManifestCategory`, `ManifestLoop`, `ManifestVariant`, `ManifestSound`, `AudioManifest` | Spiegel von `content/audio/dist/manifest.json` (version 1). Weitere Messfelder (`lufsIntegrated`, `opusTruePeakDb`, `loudnessMode`, `warnings` …) optional typisiert. |
| `ResolvedSound`, `SoundResolver` | Lookup-Regel: Name mit ':' → exakte id; sonst `<fraktion>:<name>`, dann `common:<name>`. `byIndex` wirft RangeError außerhalb. |
| `DropReason`, `DROP_REASONS` | 9 Gründe in fester Reihenfolge. |
| `PlayRequest`, `VoiceHandle`, `SoundSink` | wie Plan. |
| `ListenerState`, `SpatialResult`, `SpatialModel` | wie Plan (Out-Parameter). |
| `FX_ONE`, `AudioSimEvent`, `AudioEventSource`, `ArrayEventSource`, `createAudioSimEvent()` | Event-Spiegel von PLAN §3.6 (32 B). `ArrayEventSource(capacity = 256)`: `events` (wiederverwendete Records), `count`, `clear()`, `push(type, visual, tick, subTick, flags, x, y, z, aux, handle)` → Index, `pushEvent(e)`; Lesen allokationsfrei, Schreiben allokiert nur beim Wachsen; Index außerhalb 0..count−1 → RangeError. `eventPos(i, c)`: c 0 = x, 1 = y, sonst z. |
| `AlertRequest`, `AlertRecord`, `JumpToCallback` | wie Plan. |
| `AudioSettings`, `DEFAULT_AUDIO_SETTINGS` (eingefroren), `SettingsStore`, `SettingsController` | Defaults master 0,8 · sfx 0,8 · ui 0,7 · alerts 0,9 · music 0,6 · ambience 0,5 · muted false · muteWhenHidden true. |
| `EngineState`, `DecodePath`, `DECODE_PATHS`, `LoadFilter`, `LoadReport`, `TimingStats`, `AudioStats`, `AudioEngine`, `CreateAudioEngineOptions` | wie Plan; `DECODE_PATHS` = ['native','webcodecs','wasm'] *Zusatz*. |

**Hinweis `exactOptionalPropertyTypes`:** Optionale Felder von `PlayRequest`, `AlertRequest`, `LoadFilter` und `CreateAudioEngineOptions` sind als `x?: T | undefined` typisiert. So kann ein gepooltes Request-Objekt im Hot Path wiederverwendet und ein Feld per `req.x = undefined` zurückgesetzt werden (ohne `delete`/neue Objekte). Semantik unverändert: `undefined` = nicht gesetzt.

### `src/ports.ts`

`AudioParamLike`, `AudioNodeLike`, `GainNodeLike`, `StereoPannerNodeLike`, `DynamicsCompressorNodeLike` (+ `readonly reduction: number` für Limiter-Metering, *Zusatz*), `AudioBufferLike`, `AudioBufferSourceNodeLike` (`loopStart/loopEnd` in **Sekunden**), `BaseAudioContextLike`, `AudioContextLike` (`baseLatency?`, `outputLatency?`), `OfflineAudioContextLike`. Methoden in Kurzschreibweise (bivariant), Rückgaben, die nie genutzt werden, `unknown`. Statisch belegt (in `test/contracts.test.ts`, geprüft von `tsc -p tsconfig.tests.json`): lib.dom `AudioContext`, `OfflineAudioContext`, `BaseAudioContext`, `AudioBuffer`, `GainNode`, `StereoPannerNode`, `DynamicsCompressorNode`, `AudioBufferSourceNode` → jeweilige Like-Typen; `FakeAudioContext`/`FakeOfflineAudioContext` → Like-Typen; ein Objekttyp mit den FrameReader-Event-Accessoren (Signaturen wörtlich aus `packages/protocol/src/frame.ts`, nicht importiert) → `AudioEventSource`. Ohne Casts/any.

Importe: innerhalb des Pakets relativ (`../types.ts`), aus Apps `@faf/audio` bzw. `@faf/audio/<modul>`.

## Test-Support (`packages/audio/test/support/`)

Import: `import { FakeAudioContext, loadRealManifest, … } from '../support/index.ts'` (bzw. die Einzeldateien).

### `fake-audio-context.ts`

- **`FakeAudioContext(opts?)`** implements `AudioContextLike`. Optionen: `sampleRate` (48000), `logAutomation` (true; Benches: false), `detachOnDecode` (true), `autoplay: 'allowed' | 'blocked'` ('allowed'), `baseLatency` (0,005 s), `outputLatency` (0,02 s).
  - Zustand: Start `'suspended'`; `resume()` → `'running'` **im nächsten Microtask** (wie Browser), `suspend()`, `close()` → `'closed'` (beendet aktive Quellen ohne `onended`), danach `resume()/close()` → reject `InvalidStateError`. `onstatechange` feuert bei jedem Wechsel; `stateLog` (alle Zustände), `resumeCalls/suspendCalls/closeCalls`.
  - Autoplay: bei `autoplay: 'blocked'` bleibt `resume()` hängen, bis `grantAutoplay()` (simulierte Geste). `simulateStateChange('suspended' | 'interrupted' | 'running')` für OS-Unterbrechungen/iOS.
- **Uhren:** `advance(ms)` bewegt `nowMs` (Wanduhr, als Engine-`clock` nutzbar: `clock: () => ctx.nowMs`) immer, `currentTime` nur im Zustand `'running'` (wie ein echter suspendierter Kontext). `advanceTo(seconds)`. Endende Quellen feuern `onended` in End-Reihenfolge, `currentTime` steht dabei exakt auf der Endzeit; Handler dürfen im selben `advance` neue Quellen starten. `onended` feuert nie synchron in `start()`.
- **`FakeAudioParam`**: `value` (Getter = `valueAt(currentTime)`, Setter = setValueAtTime(v, now)), `setValueAtTime`, `linearRampToValueAtTime`, `setTargetAtTime` (tc 0 = Sprung), `cancelScheduledValues` (entfernt Events mit `time ≥ cancelTime`). `valueAt(t)` nach Spec: Rampe startet am Ende des Vorgänger-Events; nach laufendem `setTarget` am Zeitpunkt des Rampen-Aufrufs (`scheduledAt`). Ergebnis auf `[minValue, maxValue]` geklemmt (Pan ±1, Kompressor-Bereiche). `events` (Schedule), `calls` (Log `{method, value, time, timeConstant, at}`), `count(method)`. Fehler wie Browser: negative Zeiten → RangeError, nicht-endliche Werte → TypeError. Ab 64 Events wird Vergangenes zu einem `set` verdichtet (Werte ab jetzt unverändert, `valueAt` weit in der Vergangenheit dann nicht mehr exakt).
- **Knoten:** `FakeGainNode` (`gain` 1), `FakeStereoPannerNode` (`pan` 0, [−1, 1]), `FakeDynamicsCompressorNode` (Spec-Defaults −24/30/12/0,003/0,25, `reduction` setzbar), `FakeAudioBufferSourceNode`. Alle: `outputs`, `inputs`, `label` (frei, für Diagnose), `kind`, `describe()`. `connect` idempotent, fremder Kontext → `InvalidAccessError`, in eine Quelle → `IndexSizeError`; `disconnect()` trennt alle Ausgänge.
- **`FakeAudioBufferSourceNode`**: `buffer`, `loop`, `loopStart/loopEnd`, `playbackRate`, `onended`; `start(when, offset, duration)` (zweites `start` → `InvalidStateError`), `stop(when)` (vor `start` → `InvalidStateError`, nach Ende No-op, Zeit in der Vergangenheit = jetzt). Ende = min(stop, natürliches Ende); natürliches Ende = `startAt + (duration − offset) / playbackRate(startAt)`; Loop oder ohne Puffer: nur per `stop`. Diagnose: `startWhen`, `startOffset`, `startDuration`, `startAt`, `stopWhen`, `started`, `playing`, `ended`, `endedAt`, `endTime`.
- **`FakeAudioBuffer(ch, len, sr)`**: Validierung wie Browser (`NotSupportedError`), Kanaldaten **lazy** (erst bei `getChannelData`/`copyToChannel` allokiert, `isMaterialized(c)`), `copyToChannel` mit Offset und Kürzen.
- **Zähler/Graph am Kontext:** `liveSources` (gestartet, nicht beendet), `peakLiveSources`, `startedSources`, `endedSources`, `createdNodes`, `createdByKind {gain, panner, compressor, source}`, `connectCalls`, `disconnectCalls`, `decodeCalls`, `activeSources()`, `graphPathToDestination(node)` (BFS über `outputs`, Knotenliste oder null), `describePath(node)` (z. B. `'source > gain > panner > gain:sfx > gain:master > compressor > destination'`).
- **`decodeAudioData(bytes)`**: löst den ArrayBuffer ab wie Browser (`detachOnDecode`), abgelöster Puffer → reject `TypeError`. Standard: reject `DOMException` `'EncodingError'` (Browser ohne Opus/WebM). `setDecoder((data, ctx) => AudioBufferLike | Promise<…>)` für eigene Antworten, `setDecoder(null)` zurück.
- **`FakeOfflineAudioContext(ch, length, sr, opts?)`** implements `OfflineAudioContextLike`: `startRendering()` → `'running'`, Uhr bis `length/sr` (Quellen enden, `onended` feuert), `'closed'`, liefert stillen `FakeAudioBuffer`; zweiter Aufruf → `InvalidStateError`. Der Fake rendert **kein Audio** (Pegel-/Pan-/Limiter-Nachweise laufen im Browser, c2).

### `manifest.ts`

- `REPO_ROOT`, `AUDIO_DIST_DIR` (content/audio/dist).
- `loadRealManifest()` → `AudioManifest` (einmal je Testdatei geparst, flache Formprüfung `assertManifestShape`; volle Validierung macht der Parser in `src/catalog`, b2).
- `realManifestBytes()`, `realWebmBytes(relPath)` → frischer, exakt großer `ArrayBuffer` je Aufruf; `relPath` wie `variant.opus` (Whitelist, keine WAVs, kein Path-Traversal).
- `makeManifest({ sounds: SoundSpec[], categories?, sampleRate?, maxVoices? })`: synthetisches, gültiges Manifest; Kategorie-Policies aus dem echten Manifest (überschreibbar). `SoundSpec {id '<scope>:<name>', category? (Default aus Präfix, `categoryFromName`), variants? (1), durationS? (0,5), loop? (true = 40-ms-Polster wie @faf/sfx, oder explizite Punkte), priority?, cooldownMs?, maxVoices?, spatial?, channels?, tags?}`. Doppelte/ungültige ids werfen. Damit u. a. Override-Paare `varkan:x` + `common:x`.
- `fakeBuffersFor(manifest, ctx, { fill? })` → `Map<soundId, AudioBufferLike[]>` je Variante über `ctx.createBuffer`, Länge auf die Kontextrate umgerechnet (z. B. 44,1 kHz), lazy (ohne `fill` praktisch kein Speicher).
- `LOOP_PAD_SAMPLES = 1920`, `categoryFromName(name)` (Präfix-Konvention; Test: stimmt für alle 101 echten Sounds).

## opus-decoder (für audioeng-b2)

In Node importierbar (`node -e "import('opus-decoder')…"` im Paketordner): Exporte **`OpusDecoder`**, **`OpusDecoderWebWorker`** (Typen zusätzlich `DecodeError`, `OpusDecodedAudio`).

- `new OpusDecoder({ channels?, preSkip?, sampleRate?, forceStereo?, streamCount?, coupledStreamCount?, channelMappingTable? })`, danach `await decoder.ready` (WASM-Instanziierung in Node ≈ 5 ms).
- `decodeFrame(packet: Uint8Array)` / `decodeFrames(packets: Uint8Array[])` → `{ channelData: Float32Array[] (planar), samplesDecoded, sampleRate, errors: DecodeError[] }`; `reset(): Promise<void>`, `free()`.
- **Achtung Defaults:** `channels` Default **2** (für Mono explizit `channels: 1` setzen), `sampleRate` Default 48000 (nur 8/12/16/24/48 kHz), `preSkip` Default 0.
- **preSkip wird intern getrimmt:** gemessen mit einem leeren CELT-Paket (0xF8, 20 ms): `preSkip: 0` → 960 Samples, `preSkip: 312` → 648 Samples. Empfehlung: Decoder mit `preSkip: 0` betreiben und im PcmAssembler trimmen (einheitlich mit WebCodecs), oder den internen Trim nicht doppelt anwenden.

## Demo-Gerüst `apps/audio-demo`

- `package.json` (Skripte dev/build/preview/test:e2e/bench:browser, `@faf/audio: workspace:*`, devDeps vite/@playwright/test/@types/node/tsx wie Root), `tsconfig.json` (DOM, `vite/client`, reference `../../packages/audio`).
- `vite.config.ts`: `base './'`, Multi-Page `index.html` + `offline.html` (`build.rolldownOptions.input`, Vite 8), `server.port 5583` strict, `preview.port = FAF_E2E_PORT ?? 4583` strict.
- `audio-assets.ts`: `fafAudioAssets({ distDir, urlPrefix? = '/audio/' })` — dev **und** preview per Middleware, nur `manifest.json` und `<scope>/<name>.v<n>.webm` (`AUDIO_ASSET_RE`), aufgelöster Pfad muss in `distDir` liegen, `%`-kodierte Pfade abgelehnt, nur GET/HEAD, Content-Type `application/json; charset=utf-8` bzw. `audio/webm`, `Content-Length`, `Cache-Control: no-cache`; alles andere unter `/audio/` → 404. Build: `emitFile` aller Whitelist-Dateien nach `audio/` (fehlt manifest.json → Build-Fehler). Hilfsexporte `resolveAudioAsset`, `listAudioAssets` für MS5/Tests.
- `src/main.ts`: lädt `audio/manifest.json` relativ zu `document.baseURI`, Tabelle je Kategorie (Bus, Prio, Stimmen, Sounds, Varianten), Knopf spielt `common:ui_click` nativ dekodiert. `src/offline.ts`: dekodiert die erste Datei mit echtem `OfflineAudioContext` und legt das Ergebnis unter `window.__fafAudioOfflineBootstrap` ab. **c2 ersetzt beide.**

Gemessen (Rauchtest per Playwright gegen `vite` dev, danach Server beendet): Chromium, Firefox und WebKit dekodieren `common/alt_base_attacked.v0.webm` **nativ** per `decodeAudioData`, Länge jeweils exakt 60 230 Samples = Manifest; Seite zeigt „101 Sounds, 246 Varianten, 17 Loops“, keine Konsolenfehler. Preview-Middleware: manifest 200 JSON, .webm 200 `audio/webm`, `.wav`/`..`/`%2F`/Verzeichnis/unbekannt → 404.

## Root-Änderungen (alle additiv)

| Datei | Änderung |
|---|---|
| `pnpm-lock.yaml` | Importer `packages/audio` (opus-decoder 0.7.12 + `@wasm-audio-decoders/common`, `@eshaz/web-worker`, `simple-yenc`) und `apps/audio-demo`. |
| `tsconfig.json` | references `packages/audio`, `apps/audio-demo`. |
| `tsconfig.tests.json` | include `apps/*/playwright.config.ts`. |
| `eslint.config.js` | Browser-Globals für `packages/audio/src/**/*.ts`; Node-Globals für `apps/*/playwright.config.ts`, `apps/*/audio-assets.ts`; **ignores `docs/design/ui-mockups/**`** (siehe Abweichungen). |
| `.dependency-cruiser.cjs` | `audio-is-leaf` (keine Workspace-Deps), `audio-npm-deps` (npm nur opus-decoder), `client-deps` + `audio`, `presentation-never-imports-sim` um `audio` erweitert, `sim-never-imports-presentation` um `audio` erweitert. |
| `.gitignore` | `apps/*/results/*.json`. |

## Abweichungen vom Plan

1. Optionale Request-/Options-Felder als `T | undefined` (Begründung oben; kompatibel zur Plan-Semantik).
2. Zusätze in types.ts: `isSoundCategory`, `isManifestBus`, `DECODE_PATHS`, `createAudioSimEvent`, `ArrayEventSource.push/pushEvent/clear/events`; in ports.ts `DynamicsCompressorNodeLike.reduction`.
3. `eslint.config.js` ignoriert `docs/design/ui-mockups/**`: Der Stand von `main` (Merge „design“, Commit 8f04d23) brachte 89 Lint-Fehler in statischen Mockup-Skripten (Browser-Globals in `.js`/`.mjs` unter docs). Ohne diese Ausnahme ist `pnpm lint` unabhängig von diesem Track rot; die Mockups sind Doku, kein Projektcode.

## Bekannte Grenzen

- Der Fake rendert kein Audio und wertet `playbackRate` nur zum Startzeitpunkt aus (spätere Rate-Änderungen verschieben das Fake-Ende nicht); Loop-Punkte werden gespeichert, aber nicht „abgespielt“.
- dependency-cruiser sieht npm-Pakete mit `types`-Export (opus-decoder, vite) nicht, weil die Root-Option `exclude: '\.d\.ts$'` die aufgelösten Typdateien verwirft (gilt genauso für `render-npm-deps`); Pakete ohne Typ-Export werden von `audio-npm-deps` erkannt (geprüft mit einer temporären Probe-Datei, `typescript` → Fehler `audio-npm-deps`), nicht deklarierte Pakete fängt `not-to-unresolvable`, Workspace-Importe `audio-is-leaf` (geprüft).
- Während dieses Laufs meldete `pnpm lint` noch 2 Fehler in `packages/audio/src/decode/webm.ts` (paralleles Paket audioeng-a1, in Arbeit) — nicht in diesem Paket.

## Tests

45 Tests in 3 Dateien: `test/support/fake-audio-context.test.ts` (29: Param-Automation gegen Handrechnung inkl. setTarget/Rampe danach/cancel/Klemmen/Fehler/Verdichtung, onended-Timing inkl. playbackRate/Offset/44,1 kHz/duration, Loop bis stop, suspendierte Uhr, Doppelstart, Kettenstarts in onended, Zustandsmaschine inkl. Autoplay-Sperre/Interruption/close, Graph-Pfad, Puffer, decodeAudioData, Offline-Rendering), `test/support/manifest.test.ts` (5), `test/contracts.test.ts` (11: echtes Manifest gegen Busse/Kategorien/Priorität/Loops, `ArrayEventSource`, Barrel, statische Kompatibilität).

## Selbsttest

| Befehl | Ergebnis |
|---|---|
| `pnpm install --frozen-lockfile` | ok („Already up to date“) |
| `pnpm exec tsc -b packages/audio apps/audio-demo` | grün |
| `pnpm exec vitest run packages/audio/test/support packages/audio/test/contracts.test.ts` | 45/45 grün (≈ 0,1 s) |
| `pnpm exec eslint <eigene Pfade> --max-warnings 0` | grün |
| `tools/heavy pnpm typecheck` | grün (`tsc -b` + `tsc -p tsconfig.tests.json`) |
| `tools/heavy pnpm lint` | depcruise ohne Verstöße (433 Module); ESLint nur noch 2 Fehler in a1-Datei `src/decode/webm.ts` (in Arbeit) |
| `tools/heavy pnpm --filter @faf/audio-demo build` | ok: `dist/audio/manifest.json` + 246 `.webm`, 0 `.wav`, 2 HTML-Seiten |
