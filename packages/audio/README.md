# @faf/audio

Web Audio engine of Flow & Fire (PLAN §3.7, `docs/design/audio.md`): mixer with buses, a
32-voice manager with per-category limits, priority, stealing and per-sound cooldowns, variant
rotation, keyed loops with manifest loop points, camera-based panning/attenuation, an alert queue
with jump-to-location, data-driven sim-event → sound routing and an Opus/WebM loading pipeline.

Presentation code only: it never imports sim packages and nothing here may feed back into sim
state or hashes. Leaf package (no workspace dependencies; the only npm dependency `opus-decoder`
is loaded by dynamic import as a fallback decoder).

## Quick start

```ts
import { createAudioEngine } from '@faf/audio/engine';

const audio = createAudioEngine({
  baseUrl: '/audio/',                 // manifest.json + <scope>/<name>.v<i>.webm live here
  faction: 'varkan',
  visualName: (visual) => weaponRefOf(visual), // visual id → 'core:wpn_*' (view data)
  onJumpTo: (x, z) => camera.focus(x, z),
  eventTypes: PROTOCOL_EVENT_KINDS,   // numeric event type → SimEventKind (default: provisional table)
});
await audio.ready;                    // manifest fetched (or pass `manifest` to skip the fetch)
void audio.load({ tags: ['MS5'] });   // preload; everything else is loaded lazily on first use

// every animation frame
audio.setListener(cameraGroundState); // focus, height, viewHalfWidth, right vector (WU)
audio.handleEvents(frameReader);      // any AudioEventSource, e.g. the protocol FrameReader
audio.update(performance.now());

// input / HUD
audio.playUi('ack_pip_direct');       // started synchronously inside the call
audio.setLoop('build:army0', { sound: 'bld_pour_loop', x, z, gain }); // null stops it
audio.alert({ kind: 'alt_base_attacked', x, z });
audio.jumpToLastAlert();              // repeated calls step back through the history
audio.settings.set({ sfx: 0.6 });     // persisted in localStorage ('faf.audio.v1')
```

The engine starts in state `'locked'` and unlocks on the first `pointerdown`/`keydown`/`touchend`
on `document` (or call `audio.unlock()` from your own gesture handler). While locked or
suspended, sim events and one-shots are dropped (reason `'locked'`) and never replayed; alerts are
still recorded (history, `onAlert`, jump-to) and keyed loops start as soon as the context runs.

## API

| Member | Purpose |
|---|---|
| `createAudioEngine(opts)` | `CreateAudioEngineOptions` (types.ts) plus test/demo extras (`visibilityDocument`, `timer`, `random`, `decoder`, `onLoadProgress`, `onLoadError`, `loadConcurrency`, `initialSettings`). Returns `FafAudioEngine`. |
| `state`, `onStateChange(fn)` | `'locked' \| 'running' \| 'suspended' \| 'closed'` |
| `ready` | resolves when the manifest is parsed and all modules exist |
| `unlock()`, `load(filter?)` | resume from a gesture; fetch + decode (`LoadReport`) |
| `setListener(l)`, `setSimSpeed(s)` | camera state for panning/attenuation; tick duration for subTick scheduling |
| `handleEvents(src)`, `play(req)`, `playUi(name)`, `setLoop(key, req \| null)` | sound triggers |
| `alert(req)`, `jumpToLastAlert()`, `alertHistory()` | alert queue |
| `update(nowMs?)` | once per animation frame (alerts, loops, voice clean-up, timing ring) |
| `stats()`, `resetStats()` | voices (total, per category, peak), steals, drops per reason, events, main-thread JS p50/p95/p99, decode paths, latencies |
| `dispose()` | stops everything, removes listeners, closes the context if the engine created it |
| `context`, `mixer`, `spatial`, `catalog`, `loader`, `voices`, `loops`, `alerts`, `router` | module instances (HUD, diagnostics) |

All modules are also usable on their own through `@faf/audio/<module>`: `catalog`, `loader`,
`decode`, `unlock`, `mixer`, `settings`, `voices`, `spatial`, `alerts`, `router`, `events`,
`engine`. The root `@faf/audio` re-exports everything.

## Mixer graph

```
voice: source → gain → stereo panner ─┐
                                      ▼
input(bus) → user(bus) → duck(bus) → user(master) → mute → limiter → makeup → clip → destination
```

Buses `sfx`, `ui`, `alerts` (manifest bus `voice`), `music`, `ambience`; `master` is the sum. The
limiter is a DynamicsCompressor (−3 dB, knee 0, ratio 20, 3/120 ms); `makeup` removes the
compressor's automatic makeup gain (+1.71 dB per the Web Audio spec) and `clip` is a WaveShaper
hard clip at ±1 as the last safety stage. 32 loud voices peak at 0.96 (Chromium/WebKit) / 0.73
(Firefox) in a real OfflineAudioContext, before the clip.

## Asset delivery

- Source of truth: `content/audio/dist/manifest.json` and `content/audio/dist/<scope>/<name>.v<i>.webm`
  (Opus in WebM, 48 kHz, checked in; WAVs are never shipped).
- Serve both under one base URL (`baseUrl`, with or without trailing `/`, relative or absolute,
  CORS for other origins). `GET` must return the complete bytes; `Content-Type: audio/webm` resp.
  `application/json`. 404 mutes the affected sound; 408/429/5xx/network errors are retried once.
- File names carry no content hash: serve with `Cache-Control: no-cache` or version the base URL
  (e.g. `/audio/<manifest-sha>/`) and cache long.
- Decoding: native `decodeAudioData` → WebCodecs `AudioDecoder` → WASM (`opus-decoder`, own
  chunk, only loaded when needed). The Vite plugin `fafAudioAssets` in `apps/audio-demo` shows
  the dev/preview middleware and the build copy.

## Development

```sh
pnpm exec vitest run packages/audio            # unit + integration tests (fake AudioContext)
pnpm exec tsc -b packages/audio                # typecheck
pnpm --filter @faf/audio bench [-- --quick]    # Node benchmark 'Gefecht-200' (100/200/400 shots/s)
pnpm --filter @faf/audio bench -- --update-docs  # writes the table into docs/status/audioeng-c1.md + track-audioeng.md
```

Browser tests with a real (Offline)AudioContext and the battle demo live in `apps/audio-demo`.
