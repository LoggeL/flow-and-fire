# audioeng-d1 – Abschluss TRACK-AUDIOENG: Gesamtprüfung, Integrationsfehler, Messwerte, Doku (Welle 3)

> **Stand:** 2026-09-30 · Branch `track-audioeng` (Worktree `flow-and-fire/.worktrees/faf-audioeng`)
> **Pfade:** `packages/audio/**`, `apps/audio-demo/**`, `docs/status/track-audioeng.md`, `docs/status/audioeng-*.md`, `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/design/audio.md`

## 1. Umgesetzt

- **Integrationsfehler Limiter behoben** (Befund c2 §6.1, `limiter` rot in Chromium/WebKit, Peak 1,173): `src/mixer/mixer.ts` hängt an den Kompressor einen festen Gain `makeup` = −`LIMITER_MAKEUP_DB` (1,71 dB, Spec-Formel `compressorMakeupDb(threshold, ratio)`, jetzt in `@faf/audio/mixer` exportiert) und einen WaveShaper `clip` (2-Punkt-Identitätskurve, hartes Klemmen auf ±1, `oversample 'none'`). Neue Option `MixerOptions.safetyClip` (Standard true; false nur für Messungen), `MixerGraph.makeup`/`.clip`. Kontexte ohne `createWaveShaper` bekommen keinen Clip (Strukturtyp `WaveShaperNodeLike` lokal im Mixer, `ports.ts` unverändert). Browser: Peak 0,963 (Chromium/WebKit), 0,729 (Firefox), **auch ohne Clip ≤ 1,0**.
- **Fake-AudioContext:** `FakeWaveShaperNode` + `createWaveShaper()` (Knotenart `shaper`, Kurve als Kopie, < 2 Punkte → `InvalidStateError`).
- **Lücken der Abnahme geschlossen:**
  - Browser-E2E **„ack under a full voice pool starts synchronously in the click handler“** (`apps/audio-demo/test/e2e/demo.spec.ts`): 32/32 Stimmen mit leisen Loops niedriger Priorität belegt, echter Klick auf „Klick-Quittung“; per Init-Skript protokollierte `AudioBufferSourceNode.start()`-Aufrufe belegen 2 Starts im Handler mit `when = 0 ≤ currentTime`, Steals +2, Stimmen ≤ 32, Handler < 16,7 ms (gemessen 0,16–0,34 ms).
  - Offline-Fall `loop` zusätzlich im **44,1-kHz-Kontext** mit nativ resampelten Puffern (Loop-Punkte in Sekunden): Naht 1,03–1,04 × Median, Korrelation Durchlauf 2/3 = 1,0, Lag-Fehler 0 in allen drei Browsern.
  - Offline-Fall `limiter`: Kriterium „Peak ≤ 1,0“ jetzt für den kompletten Mixer **und** ohne Clip; Diagnose `peakUncompensated` (nackter Kompressor) statt der alten Kompensations-Varianten.
- **Benchmarks** schreiben ihre Tabellen zusätzlich in `docs/status/track-audioeng.md` (jede Datei der Liste mit Markern; `bench/run.ts`, `scripts/bench-browser.ts`).
- **Doku:** `docs/status/track-audioeng.md` (Gesamtdokument), `docs/STATUS.md` (Abschnitt „Vorarbeits-Track TRACK-AUDIOENG“), `docs/DECISIONS.md` 30–37, `docs/design/audio.md` §6 (Hinweis), `packages/audio/README.md` (Mixer-Graph), Nachtrag in `audioeng-c2.md` §6.1.

## 2. Öffentliche API (Änderungen)

```ts
// @faf/audio/mixer (zusätzlich)
compressorMakeupDb(thresholdDb, ratio): number      // Spec-Makeup eines DynamicsCompressor (hartes Knie)
LIMITER_MAKEUP_DB                                   // ≈ 1,71
interface WaveShaperNodeLike extends AudioNodeLike { curve: Float32Array | null; oversample: string }
MixerOptions.safetyClip?: boolean                    // Standard true
MixerGraph.makeup: GainNodeLike; MixerGraph.clip: WaveShaperNodeLike | null
```

Graph: `… → mute → limiter → makeup → clip → destination` (vorher `limiter → destination`).

## 3. Abweichungen

- `apps/audio-demo/src/offline/cases.ts` re-exportiert `compressorMakeupDb` aus `@faf/audio/mixer` (Test `helpers.test.ts` bleibt gültig).
- Der Plan-Pfad `/Users/logge/Documents/Projects/faf-audioeng` existiert nicht; alle verify_commands liefen im Worktree `flow-and-fire/.worktrees/faf-audioeng`.
- Keine Root-Konfiguration geändert, kein `pnpm add`.

## 4. Bekannte Grenzen

Siehe `docs/status/track-audioeng.md` §10. Der schlanke Bench-Kontext (`bench/lean-context.ts`) hat kein `createWaveShaper` – der Mixer läuft dort ohne Clip (Hot Path unberührt).

## 5. Tests

- Vitest `packages/audio` + `apps/audio-demo`: 32 Dateien, 333 Tests (neu: 2 Mixer-Tests für Makeup/Clip; Graph-Pfade in `mixer.test.ts` und `voice-manager.test.ts` angepasst).
- Playwright: 9 Tests × 3 Engines = 27 (neu: Ack bei vollem Pool; erweitert: `loop` mit 44,1 kHz, `limiter` ohne Clip).

## 6. Selbsttest

Siehe `docs/status/track-audioeng.md` §12 (alle Befehle grün).
