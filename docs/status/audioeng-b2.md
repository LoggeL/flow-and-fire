# audioeng-b2 – Katalog, Lade-/Dekodier-Pipeline, Autoplay-Unlock

> **Track:** TRACK-AUDIOENG, Welle 1 · **Stand:** 2026-09-29 · **Branch:** `track-audioeng` (Worktree `faf-audioeng`)
> **Pfade:** `packages/audio/src/{catalog,loader,unlock}/**`, `packages/audio/test/{catalog,loader,unlock}/**`

## 1. Umgesetzt

- **`src/catalog/`** (`@faf/audio/catalog`)
  - `parseManifest(json)` – strikte Laufzeitvalidierung von `content/audio/dist/manifest.json` (version 1). Jede Verletzung wirft `ManifestError` mit JSON-Pfad (`$.sounds[3].variants[0].samples: expected an integer, got 10.5`). Ergebnis ist eine frische, tief eingefrorene Kopie.
  - `SoundCatalog implements SoundResolver` – dichte Indizes, vorab gebaute `ResolvedSound`-Objekte (Kategorie-Policy + Sound-Overrides, Bus über `MANIFEST_BUS_TO_BUS`), Lookup nach Vertrag über Tabellen je Fraktion, Asset-URLs, Pufferspeicher je (Sound, Variante), Lade-Hook.
- **`src/loader/`** (`@faf/audio/loader`)
  - `createDecodeChain(ctx, opts?)` – Kette native `decodeAudioData` → WebCodecs `AudioDecoder` → WASM (`opus-decoder`, dynamischer Import), einmalige Fähigkeitsprobe je Kontext, `forcePath`, `DecodeError` mit Ursachenkette, Statistik je Pfad.
  - `SoundLoader` – priorisiertes, paralleles Laden (≤ 6), Deduplizierung, 1 Retry, `AbortSignal`, Fehlerisolation je Variante, Speicherbilanz, Lazy-Nachladen über `catalog.requestLoad` → `ensure`.
  - `loadManifest(url, fetch)`.
- **`src/unlock/`** (`@faf/audio/unlock`) – `AutoplayUnlocker(ctx, target, opts?)`: Gesten-Listener (pointerdown/keydown/touchend, capture + passive), `resume()` + 1-Sample-Stille (iOS), Entfernen der Listener bei `running`, Wieder-Scharfschalten nach `suspended`/`interrupted`, `onChange`, `unlock()`, `dispose()`.
- Je Ordner eine `index.ts` mit den öffentlichen Exporten. `types.ts`/`ports.ts` unverändert; zusätzliche Typen sind lokal in den Modulen definiert (siehe §2).

## 2. Öffentliche API

```ts
// @faf/audio/catalog
parseManifest(json: unknown): AudioManifest                 // wirft ManifestError {path}
class ManifestError extends Error { readonly path: string }
MANIFEST_SAMPLE_RATE = 48000; MAX_LOOP_PADDING_S = 0.1; MAX_VOICE_LIMIT = 256; COMMON_SCOPE = 'common'
class SoundCatalog implements SoundResolver {
  constructor(manifest: AudioManifest); static fromJson(json: unknown): SoundCatalog
  readonly manifest; readonly size; readonly scopes: readonly string[]
  resolve(nameOrId, faction): ResolvedSound | null
  resolveIndex(nameOrId, faction): number            // −1 = unbekannt; Hot Path, allokationsfrei
  indexOf(id): number; byIndex(i): ResolvedSound; manifestSound(i): ManifestSound; hasScope(s)
  urlFor(index, variant, baseUrl): string            // baseUrl mit/ohne '/', '' = relativ
  buffer(i, v): AudioBufferLike | null; setBuffer(i, v, buf | null)
  isLoaded(i) /* ≥ 1 Variante */; isFullyLoaded(i); loadedVariantCount(i)
  readonly loadedSounds; readonly decodedBytes      // Σ length × channels × 4
  clearBuffers(); setLoadHook(fn | null); requestLoad(i)
}
bufferBytes(b); joinUrl(base, rel); type LoadHook = (index: number) => void

// @faf/audio/loader
createDecodeChain(ctx: BaseAudioContextLike, opts?: DecodeChainOptions): DecodeChain
interface DecodeChainOptions { forcePath?: DecodePath; webCodecs?: WebCodecsApi | null; loadWasm?: () => Promise<WasmOpusModuleLike>; clock?: () => number }
interface DecodeChain {
  decode(bytes: ArrayBuffer, expect: {samples, channels}): Promise<{buffer, path: DecodePath, suspicious: boolean}>
  readonly nativeSupport: 'unknown' | 'yes' | 'no'
  readonly stats: { byPath, msByPath, suspicious, nativeRejects, failed, webcodecsTrim: 'unknown'|'decoder'|'chain' }
  dispose(): void
}
class DecodeError extends Error { readonly attempts: {path, error}[] }   // cause = letzter Fehler
nativeLengthWindow(expectedSamples, contextRate): {expected, tolerance}; NATIVE_TOLERANCE_FRAMES = 1920
class SoundLoader {
  constructor({catalog, decode, fetch?, baseUrl, concurrency = 6, retryDelayMs = 250, onProgress?, onError?, attach = true})
  load(filter?: LoadFilter, {signal?}?): Promise<SoundLoadReport>      // LoadReport + variantsFailed, suspicious, failures[]
  ensure(index): Promise<boolean>; select(filter?): number[]; state(i): 'idle'|'loading'|'loaded'|'failed'
  readonly active; readonly peakActive; readonly decodedBytes; readonly paths
  abortAll(); dispose()
}
loadManifest(url, fetch = globalThis.fetch): Promise<AudioManifest>
FIRST_CATEGORIES = ['alert', 'ack', 'ui']
// Strukturtypen (lokal, nicht in ports.ts): FetchLike, FetchResponseLike, DecoderLike, WebCodecsApi,
// AudioDecoderLike, AudioDataLike, OpusDecoderConfigLike, WasmOpusModuleLike, WasmOpusDecoderLike,
// LoadProgress, LoadFailure, LoadOptions, SoundLoadState. Statisch belegt: lib.dom-`fetch` und die
// WebCodecs-Konstruktoren sind zuweisbar (Test `platform type compatibility`).

// @faf/audio/unlock
class AutoplayUnlocker {
  constructor(ctx: AudioContextLike, target: EventTarget | null, opts?: {events?, rearm = true, silentSample = true, resumeTimeoutMs = 1000})
  readonly state: EngineState; readonly listening: boolean; gestureAttempts: number
  onChange(fn: (state, previous) => void): () => void
  unlock(): Promise<boolean>; dispose(): void
}
UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend']
```

### Manifest-Regeln (`parseManifest`)

| Feld | Regel |
|---|---|
| `version` | muss `1` sein |
| `sampleRate` | muss `48000` sein (Opus dekodiert immer mit 48 kHz; `samples`/Loop-Punkte beziehen sich darauf) |
| `maxVoices` | Ganzzahl 1…256 |
| `categories` | alle 15 Kategorien Pflicht, unbekannte Schlüssel → Fehler; `bus` bekannt, `channels` 1/2, `maxVoices` 1…256, `priority` 0…1000, `cooldownMs` 0…600 000 |
| `sounds[].id` | `'<scope>:<name>'` (klein, Ziffern, `_`), eindeutig; `scope`/`name` müssen zur id passen |
| `category`, `bus` | bekannte Kategorie bzw. Manifest-Bus, sonst Fehler |
| `bus`, `channels`, `spatial`, `priority`, `cooldownMs`, `maxVoices` | fehlen sie am Sound, gilt die Kategorie-Policy (Merge); vorhandene Werte werden geprüft |
| `variants[]` | nicht leer, `index` = Position, `opus` relativer `.webm`-Pfad (kein `..`, kein `/`-Anfang, keine URL, kein `//`), `samples` Ganzzahl ≥ 1 |
| `loop` | Pflichtfeld (`null` bei One-Shots); `startSample < endSample`, `startS < endS`, Sekunden = Samples/48000 (±1 Sample), `endS ≤ durationS + 0,1 s` (40-ms-Polster + Reserve), `endSample ≤ samples` jeder Variante |
| unbekannte Zusatzfelder | ignoriert; optionale Messfelder werden typgeprüft übernommen |

### Lookup

`resolveIndex(nameOrId, faction)`: (1) Tabelle der Fraktion (`name → index`, gebaut beim ersten Aufruf je Fraktion aus `common:*`, überschrieben mit `<fraktion>:*`), (2) sonst exakte fq-id. Namen enthalten nie `':'`, daher ist die Reihenfolge äquivalent zur Vertragsregel. Die zuletzt benutzte Fraktion wird gemerkt (kein Map-Zugriff), unbekannte Fraktionen teilen sich die reine `common`-Tabelle (beliebige Strings lassen den Cache nicht wachsen). Belegt: 200 000 Lookups nach Warmup < 0,5 MB Heap-Zuwachs.

## 3. Dekodierkette

1. **native:** `ctx.decodeAudioData(bytes.slice(0))` (Kopie, das Original bleibt für den Fallback). Erwartete Länge `round(samples × rate/48000)`, Toleranz `ceil(2 × 960 × rate/48000)`; Abweichung (oder andere Kanalzahl) → `suspicious` (gezählt, akzeptiert). Leerer Puffer zählt als Ablehnung.
2. **webcodecs:** nur wenn `AudioDecoder`/`EncodedAudioChunk` existieren und `isConfigSupported({codec: 'opus', sampleRate: 48000, numberOfChannels, description: OpusHead})` (gecacht je Kanalzahl). Pakete aus `demuxWebmOpus` als `EncodedAudioChunk` (`type 'key'`, `timestamp` µs, `duration`), `AudioData.copyTo(planeIndex, format 'f32-planar')` in wiederverwendete Scratch-Puffer → `PcmAssembler` → `ctx.createBuffer(ch, len, 48000)` + `copyToChannel`. **Pre-Skip:** Ob ein Browser-Decoder den OpusHead-Pre-Skip selbst anwendet, ist nicht einheitlich und in Node nicht messbar. Die Kette sammelt deshalb ungetrimmt und entscheidet nach `flush()` anhand der Rohlänge (≈ Σ Paket-Samples → selbst trimmen; ≈ Σ − preSkip → Decoder hat getrimmt); das Ergebnis steht in `stats.webcodecsTrim` (für den Browser-Test c2). Ende immer exakt auf `expectedOutputSamples` (DiscardPadding).
3. **wasm:** `await import('opus-decoder')` (eigener Chunk, WASM ist inline im JS eingebettet – kein separates `.wasm`-Asset), ein Decoder je Kanalzahl, wiederverwendet (`reset()` vor jeder Datei, Nutzung je Decoder serialisiert). Decoder mit `preSkip: 0`, getrimmt wird im `PcmAssembler.forTrack` (nachgemessen: exakt `variants[i].samples` für alle 246 Varianten). `outputGainQ8 ≠ 0` wird angewendet (im Bestand überall 0). Paketfehler (`errors`) → Fehlschlag. Mapping-Familie ≠ 0 bzw. > 2 Kanäle → Fehler.
4. **alles scheitert:** `DecodeError` mit `attempts` in Reihenfolge; ein vom Demuxer abgelehnter Container zählt als Software-Fehlschlag.

**Fähigkeitsprobe:** Der erste Aufruf ohne bekannten Status ist die Probe; parallele Aufrufe warten auf sie (belegt: 4 gleichzeitige Dekodierungen → 1 `decodeAudioData`). Ergebnis `yes` bei nativem Erfolg, `no` nur wenn danach ein Software-Pfad dieselbe Datei dekodiert (sonst bleibt `unknown` – die Datei war kaputt). Bei `no` wird native übersprungen. Bei `yes` fällt eine einzelne abgelehnte Datei trotzdem auf die Software-Pfade zurück. Der Loader legt bei unbekanntem Status die kleinste Datei (samples × Kanäle) als erste Aufgabe an.

## 4. Loader

- **Reihenfolge:** zuerst Variante 0 aller Sounds (jeder Sound wird so früh wie möglich spielbar), innerhalb: alert/ack/ui vor allem anderen, dann absteigende Kategorie-Priorität (music 95, signature 90, explosion 70, weapon 50 …), dann Index; danach die übrigen Varianten in derselben Ordnung. Lazy-Anfragen (`ensure`) laufen vor Bulk-Arbeit, auch wenn der Sound schon in einem laufenden `load()` wartet (einmaliges Umsortieren, danach O(1)).
- **Parallelität:** ≤ `concurrency` (6) Varianten gleichzeitig in Fetch + Dekodierung.
- **Deduplizierung:** laufende/geladene Sounds zählen als `skipped`; der Aufruf wartet trotzdem auf laufende. Ein fehlgeschlagener Sound wird von `ensure` nicht erneut angefragt (kein Dauer-Refetch aus dem Hot Path), nur von einem expliziten `load()`.
- **Retry:** genau 1 Wiederholung nach `retryDelayMs` bei Netzwerkfehler (fetch/arrayBuffer rejected) oder HTTP 408/429/5xx; 404 & Co. sofort Fehlschlag.
- **Fehlerisolation:** je Variante; ein Sound mit ≥ 1 guten Variante gilt als geladen (`variantsFailed` zählt den Rest), ohne gute Variante bleibt er stumm (`failed`, Zustand `failed`). Der Loader loggt nicht selbst (`onError`).
- **Abbruch:** `load(filter, {signal})` – wartende Aufgaben dieses Aufrufs werden verworfen, laufende Fetches bekommen das Signal, fertige Dekodierungen nach dem Abbruch werden nicht gespeichert; `load` wird mit dem Abbruchgrund abgelehnt; nichts bleibt im Zustand `loading`. `abortAll()`/`dispose()` für alles.
- **Speicherbilanz:** `decodedBytes = Σ buffer.length × numberOfChannels × 4` (Report, Loader gesamt und Katalog).

## 5. Messwerte (lokal gemessen, Apple M5 Pro, Node 24.18, 3 Läufe)

| Messung | Wert |
|---|---|
| `parseManifest` (101 Sounds) | 1,0–1,3 ms |
| erster WASM-Aufruf (dynamischer Import + Instanziierung + 1 Datei) | 13,8–19,1 ms |
| WASM-Dekodierung aller 246 Varianten (344,4 s Audio), reine Dekodierzeit | 527–565 ms (≈ 2,2 ms/Datei, ≈ 630× Echtzeit) |
| Loader MS5 (17 Sounds, 55 Varianten, Fake-fetch mit echten Bytes, WASM) | 62–83 ms Wandzeit |
| Loader restliche 84 Sounds (191 Varianten) | 308–429 ms Wandzeit |
| native / WebCodecs in Node | nicht messbar (kein Opus-`decodeAudioData`, kein `AudioDecoder`); Browserwerte liefert c2 |

**Speicherbilanz (dekodiert, 48 kHz Float32):** alle 101 Sounds / 246 Varianten = **82 650 668 B (78,8 MiB)**, gleich Σ `samples × channels × 4` (Test). MS5-Satz (17 Sounds, 55 Varianten) = **10 214 768 B (9,74 MiB)**. Nach Kategorie: ambience 22,1 MiB (3 × 20-s-Stereo-Loops), weapon 10,0, explosion 8,7, music 8,1, unit 5,1, impact 5,0, build 4,3, signature 3,8, eco 3,3, alert 3,0, shield 1,6, projectile 1,5, ui 1,4, intel 0,6, ack 0,4 MiB. Bei einem 44,1-kHz-Kontext skaliert der native Pfad um 44,1/48; Software-Pfade liefern immer 48-kHz-Puffer. Empfehlung für MS5: `load({tags: ['MS5']})` (bzw. nach Meilenstein/Fraktion filtern) und den Rest lazy nachladen – ambience/music erst bei Bedarf.

## 6. Verträge für Folgepakete

**audioeng-c1 (Engine):**
```ts
const catalog = new SoundCatalog(opts.manifest ?? await loadManifest(opts.manifestUrl ?? `${baseUrl}manifest.json`, fetch));
const decode = createDecodeChain(ctx);
const loader = new SoundLoader({ catalog, decode, fetch, baseUrl });   // registriert catalog.requestLoad → ensure
const unlocker = new AutoplayUnlocker(ctx, opts.unlockTarget === undefined ? globalThis.document ?? null : opts.unlockTarget);
unlocker.onChange((s) => …);  // engine.state = unlocker.state
engine.unlock = () => unlocker.unlock();
engine.load = (f) => loader.load(f);           // SoundLoadReport ist ein LoadReport
stats: loadedSounds = catalog.loadedSounds, decodedBytes = catalog.decodedBytes, decodePaths = loader.paths
dispose: loader.dispose(); decode.dispose(); unlocker.dispose(); catalog.clearBuffers()
```
- Der Unlocker **übernimmt `ctx.onstatechange`** (ein vorher gesetzter Handler wird verkettet und bei `dispose` zurückgesetzt). Andere Module beobachten den Zustand nur über `unlocker.onChange`.
- `EngineState`: `'locked'` = lief noch nie, wartet auf Geste; `'suspended'` = lief schon, jetzt suspended/interrupted, Listener wieder scharf; beide Zustände verwerfen Gefechtssounds.
- Hot Path der Voice-Manager/Router: `catalog.resolveIndex(name, faction)` (−1 = unbekannt) + `catalog.byIndex(i)`; `catalog.buffer(i, v)` gibt `null` für nicht geladene oder ungültige Varianten; `catalog.requestLoad(i)` ist bei laufendem/geladenem/fehlgeschlagenem Sound allokationsfrei.

**audioeng-c2 (Browser-Tests):** `createDecodeChain(offlineCtx)` bzw. `{forcePath: 'native' | 'webcodecs' | 'wasm'}`; Längen-Toleranz für native: `nativeLengthWindow(samples, ctx.sampleRate)` (±2 × 960 Samples × Ratenverhältnis); webcodecs/wasm sind sample-exakt (`buffer.length === samples` bei 48 kHz). `chain.stats.webcodecsTrim` im Testbericht annotieren (misst, ob der Browser-Decoder den Pre-Skip selbst anwendet).

### Asset-Auslieferung (Vertrag für MS5/apps/game)

- `baseUrl` + `variant.opus` → `<baseUrl><scope>/<name>.v<i>.webm`; Manifest unter `<baseUrl>manifest.json` (Standard der Engine). `baseUrl` darf mit oder ohne `/` enden, absolut oder relativ (auch CDN mit CORS).
- Server: `GET` liefert die kompletten Bytes (keine Range-Anfragen nötig), `Content-Type: audio/webm` bzw. `application/json`. 404 → Sound bleibt stumm; 408/429/5xx/Netzwerkfehler → 1 Wiederholung.
- Dateinamen tragen keinen Inhalts-Hash: entweder `Cache-Control: no-cache` (wie das Demo-Plugin `fafAudioAssets`) oder eine versionierte `baseUrl` (z. B. `/audio/<manifest-sha>/`) mit langem Caching.
- Der WASM-Fallback braucht kein eigenes Asset: `opus-decoder` bettet das WASM im JS ein; der Bundler legt es wegen des dynamischen Imports in einen eigenen Chunk (nur bei Bedarf geladen).
- WAVs werden nie ausgeliefert (Parser akzeptiert nur `.webm` in `opus`).

## 7. Abweichungen vom Plan

1. `parseManifest` verlangt `sampleRate === 48000` (statt beliebiger Rate), weil alle Längen/Loop-Punkte in 48-kHz-Samples angegeben sind und Opus immer mit 48 kHz dekodiert.
2. Fehlende Policy-Felder am Sound (bus/channels/spatial/priority/cooldownMs/maxVoices) werden aus der Kategorie ergänzt (Merge beim Parsen); vorhandene werden streng geprüft. Loop-Obergrenze `endS ≤ durationS + 0,1 s` (Polster 40 ms + Reserve) plus `endSample ≤ samples` jeder Variante.
3. `load()` hat einen zweiten Parameter `{signal}`; Ergebnis `SoundLoadReport` = `LoadReport` + `variantsFailed`, `suspicious`, `failures`. Zusätzlich `select`, `state`, `abortAll`, `dispose`, `onError`, `retryDelayMs`, `attach`.
4. Ladereihenfolge zweiphasig (erst Variante 0 aller Sounds, dann Restvarianten), jeweils nach der geforderten Priorität.
5. `DecodeResult.suspicious` gilt auch für Software-Pfade (dort jede Abweichung). WebCodecs-Pre-Skip wird automatisch erkannt statt fest angenommen (in Node nicht nachmessbar, s. §3).
6. Unlocker: Option `rearm` (Standard true), `silentSample`, `resumeTimeoutMs` (für `unlock()` außerhalb einer Geste, wo `resume()` sonst ewig hängt), Übernahme von `onstatechange` mit Verkettung.
7. Fehlgeschlagene Sounds werden über `ensure`/`requestLoad` nicht erneut geladen (Schutz vor Refetch-Schleifen aus dem Hot Path), nur über `load()`.

## 8. Bekannte Grenzen

- Native- und WebCodecs-Pfad sind in Node nur gegen Fakes getestet (WebCodecs-Fake nutzt intern den echten opus-decoder, beide Trim-Varianten und interleaved `AudioData`); echte Browser-Belege liefert c2.
- Die WASM-Dekodierung läuft auf dem Main-Thread (≈ 2 ms je Datei, 0,5 s für den ganzen Bestand); nur relevant, wenn ein Browser weder Opus/WebM nativ noch WebCodecs kann. `OpusDecoderWebWorker` wäre die Ausweichlösung.
- Kanal-Mapping-Familie ≠ 0 (> 2 Kanäle) wird im WASM-Pfad abgelehnt (Bestand nur mono/stereo).
- Dekodierte Puffer werden nie automatisch entladen (kein LRU); `catalog.clearBuffers()` bzw. `setBuffer(i, v, null)` explizit.

## 9. Tests (69 in 6 Dateien)

| Datei | Tests | Inhalt |
|---|---|---|
| `test/catalog/manifest.test.ts` | 12 | echtes Manifest (101/246/17 Loops/15 Kategorien, Felder unverändert, tief eingefroren), synthetisches Manifest, Policy-Merge; `ManifestError`-Pfade: Root/Version, sampleRate/maxVoices, unbekannte/fehlende Kategorie, unbekannter Bus, ids (Format, scope-Mismatch, Duplikat), Varianten (leer, Index-Lücke, Pfad-Traversal/absolut/URL/WAV/`//`, samples), Loops (Reihenfolge, Samples↔Sekunden, `> durationS + Polster`, außerhalb der Variante, fehlend), Typfehler optionaler Felder |
| `test/catalog/catalog.test.ts` | 13 | dichte Indizes, Policies je Kategorie + Bus-Mapping, Alert-cooldownMs (alt_base_attacked 15 000 / Prio 99, alt_enemy_air 30 000, alt_unit_attacked 10 000, alt_gong 0), Lookup echt + synthetisch (varkan:x schlägt common:x, unbekannte Fraktion → common, fq-id exakt, `nope:x` → null), Allokationsfreiheit, URLs, Pufferspeicher/Bytes, RangeError, requestLoad-Hook, `fromJson` |
| `test/loader/decode-chain.test.ts` | 17 | native ok/verdächtig/44,1 kHz/Kanäle, Reject → WASM + Probe merkt `no`, Probe einmal bei 4 parallelen Aufrufen, native bleibt `yes` nach Einzelfehler, leerer Puffer, `DecodeError`-Kette (Müll-Bytes, WASM-Chunk-Fehler, Import-Retry), `forcePath` ×3, ungültige Erwartung, WebCodecs-Fake (Decoder trimmt / trimmt nicht: sample-exakt und identisch zum WASM-Pfad, alle `AudioData` geschlossen; interleaved; unsupported/Decoderfehler → WASM), statische Typkompatibilität lib.dom |
| `test/loader/decode-real.test.ts` | 2 | **alle 55 Varianten der 17 MS5-Sounds echt über die Kette** (native Reject → kein WebCodecs → WASM): Länge = Manifest exakt, Kanäle, 48 kHz, RMS > 1e-4, Peak ≤ 1,0, 1 Probe; alle 246 Varianten: Speicherbilanz 82 650 668 B |
| `test/loader/loader.test.ts` | 16 | Concurrency ≤ 6 (und erreicht), Reihenfolge (Phasen, Tier, Priorität), Probe mit kleinster Datei, Filter, Dedupe, Retry (Netzwerk/503/404), Fehlerisolation (404, Müll-Bytes → `DecodeError`), `decodedBytes` + Fortschritt, Abbruch, vorab abgebrochenes Signal, `ensure`/`requestLoad` lazy, Lazy überholt Bulk, `attach: false`, echte Bytes + echte Kette (MS5), `loadManifest` |
| `test/unlock/unlock.test.ts` | 9 | locked ohne `resume` vor Geste, capture/passive, Geste → resume + Stille-Quelle, Listener bleiben bis `running`, danach entfernt; alle 3 Gesten; Re-Lock nach interrupted/suspended; `rearm: false`; `unlock()` (ok/Timeout/closed); schon laufender Kontext; Verkettung/Wiederherstellung von `onstatechange`, `dispose`; synchron werfendes `resume` |

Hilfsdatei `test/loader/fake-webcodecs.ts` (WebCodecs-Fake auf Basis von opus-decoder).

## 10. Selbsttest (2026-09-29, lokal M5 Pro)

| Befehl | Ergebnis |
|---|---|
| `pnpm exec vitest run packages/audio/test/catalog packages/audio/test/loader packages/audio/test/unlock` | ✅ 6 Dateien, 69 Tests, ≈ 2,6 s (WASM-Dekodiertests ≈ 0,5 s) |
| `pnpm exec tsc -b packages/audio` | ✅ |
| `tools/heavy pnpm exec tsc -p tsconfig.tests.json` | ✅ |
| `pnpm exec eslint packages/audio/src/{catalog,loader,unlock} packages/audio/test/{catalog,loader,unlock} --max-warnings 0` | ✅ |
| `pnpm exec depcruise --config .dependency-cruiser.cjs packages/audio` | ✅ keine Verstöße (77 Module) |
