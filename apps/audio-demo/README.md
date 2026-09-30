# @faf/audio-demo

Demo and browser test bed of `@faf/audio` (TRACK-AUDIOENG). Two pages:

- **`index.html` — battle demo.** Two armies of 150 units fight on a 512 × 512 WU field; a
  deterministic generator (`src/demo/scenario.ts`) produces 200 shots/s (configurable) as sim
  event batches that drive the real `createAudioEngine`. Canvas2D top-down view with an RTS
  camera (the audio listener), DOM HUD with voices vs. limits, drop reasons, main-thread
  timings, mixer sliders (persisted), alert list with jump buttons.
- **`offline.html` — real Web Audio checks.** `window.__fafAudioOffline.run(name)` runs the
  cases `decode`, `pan`, `bus`, `limiter`, `loop`, `limits` against the browser's own
  (Offline)AudioContext (`?run=all` shows them on the page).

## Commands (from the repo root)

```sh
pnpm --filter @faf/audio-demo dev                      # http://localhost:5583
FAF_E2E_PORT=4583 tools/heavy pnpm --filter @faf/audio-demo build
FAF_E2E_PORT=4583 tools/heavy pnpm --filter @faf/audio-demo test:e2e       # builds, then vite preview
FAF_E2E_PORT=4583 tools/heavy pnpm --filter @faf/audio-demo bench:browser -- --update-docs
pnpm exec vitest run apps/audio-demo                   # scenario + helper unit tests
```

`test:e2e` starts `vite build && vite preview --port $FAF_E2E_PORT --strictPort` itself
(`FAF_AUDIO_SKIP_BUILD=1` reuses `dist/`); `FAF_AUDIO_PERF_GATE=1` turns the 0.5 ms main-JS
p95 annotation into a hard check. `bench:browser` options: `--quick`, `--runs=N`,
`--seconds=S`, `--rates=200,400`, `--browsers=chromium,firefox,webkit`, `--skip-build`.
Dev and preview send COOP/COEP headers (cross-origin isolated → µs timers for the measurement).

## Demo controls and URL parameters

WASD/arrows or drag: pan · wheel or +/−: zoom (height 20–400 WU) · Q/E: rotate · space: jump to
the latest alert (repeat to step back) · right click: move order with acknowledgement.

`?shots=200&seconds=&speed=1&seed=1&zoom=90&autostart=1` — without `autostart` the battle starts
with the click on the overlay "Klicken zum Aktivieren des Tons" (the unlocking user gesture).

## Test hook

`window.__fafAudioDemo` (`src/demo/hook.ts`): `ready`, `start({shots, speed, seed, seconds})`,
`stop()`, `resetStats()`, `running`, `stats()` → `{engine: AudioStats, scenario, generator,
engineCalls, engineCallsTickFrames, maxVoicesSeen, maxTailsSeen, maxByCategorySeen,
categoryLimits, voiceLimit, frames, runMs, camera, load, ack, crossOriginIsolated,
timerResolutionMs, contextState, sampleRate}`, `engine`, `setCamera(pose)`, `camera()`,
`alerts()`, `settings()`, `ack()`. Details (German) in `docs/status/audioeng-c2.md`.
