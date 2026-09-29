# @faf/sfx: prozedurale SFX-Synthese

Deterministische, selbst synthetisierte Sounds für Flow & Fire. Es gibt keine Samples und keine fremden Aufnahmen. Welche Sounds es gibt und welche Zielwerte sie haben, steht in [`content/audio/SOUNDLIST.md`](../../content/audio/SOUNDLIST.md).

```sh
pnpm sfx                  # alle content/audio/**/*.sfx.ts → content/audio/dist (inkrementell, Worker-Pool)
pnpm sfx --only cannon    # nur passende ids neu rendern (Regex)
pnpm sfx --force --spectro --strict   # alles neu, Spektrogramme, Warnungen = Fehler
pnpm sfx:analyze [pfade…] [--xcheck]  # Messung + PNG nach /private/tmp/claude-501/faf-sfx/
pnpm sfx:audit [--verbose]  # Gesamtprüfung dist: LUFS/TP (WAV + Opus), Loop-Nähte, Varianten, Alert↔Waffe, 3-MB-Budget, SOUNDLIST
pnpm sfx:preview          # http://localhost:5190/tools/sfx/preview/
```

## Einen Sound anlegen

`content/audio/<scope>/<name>.sfx.ts`, die id muss `<scope>:<name>` sein:

```ts
import { crack, clang, defineSfx, mixMono, room } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:wpn_example_fire',
  category: 'weapon',            // Kategorie-Defaults: Ziel-LUFS, Prio, Cooldown, Stimmen, Kanäle
  variants: 4,                   // deterministische Varianten (Seed aus id + Index)
  // loop: { lengthS: 2, crossfadeS: 0.3 },   // für Loops
  render({ rng }) {              // nur ctx.rng für Zufall verwenden
    const p = rng.jitter(0.03);
    return room(mixMono([
      { sig: crack({ rng: rng.fork('crack'), freq: 1900 * p }) },
      { sig: clang({ f0: 480 * p, rng: rng.fork('bell'), decayScale: 0.2 }), db: -2 },
    ]), { t60: 0.4, wet: 0.15 });
  },
});
```

Die Pipeline übernimmt danach alles Weitere:
- Kanal-Layout
- DC-Filter
- Tail-Trim mit Fade bzw. Loop-Crossfade
- Lautheits-Normierung (One-Shots: M-max, Loops: integriert, BS.1770)
- True-Peak-Grenze −1 dBTP mit Limiter
- Analyse und Warnungen

`render` muss deshalb nur Form und Balance treffen, nicht den absoluten Pegel.

## Bausteine (`src/`)

| Modul | Inhalt |
|---|---|
| `signal` | Typen (Mono/Stereo/Param), `mix`/`mixMono` (Layering mit Offset und dB), `pan`, `width`, `fade`, `varispeed`, `fit`, `concat` |
| `env` | `envelope` (Multi-Segment, lin/exp/Potenz/hold), `adsr`, `decay` (T60), `sweep` (Pitch-/Filter-Sweeps), `lfo`, `semis`, `midiHz` |
| `osc` | `osc` (Sinus/Säge/Rechteck/Puls/Dreieck, PolyBLEP), `fm` (2-Operator-FM mit Feedback), `modal` (Modalsynthese), `BELL_PARTIALS`, `PLATE_PARTIALS` |
| `noise` | `noise` (weiß/rosa/braun), `crackle` (Knistern, Glut, Kies) |
| `filter` | `filter` (RBJ-Biquads, modulierbar, kaskadierbar), `lowpass`/`highpass`/`bandpass`/`peakEq`, `onePole`, `dcBlock` |
| `fx` | `shape` (tanh/soft/hard/fold/asym), `bitcrush`, `comb`, `delay`, `ringMod`, `limiter` (Look-ahead, True Peak) |
| `reverb` | `reverb` (Freeverb-Topologie), `makeIR` (generierte Impulsantwort) + `convolve` (FFT-Faltung) |
| `recipes` | `crack`, `boom`, `thump`, `clang` (Glockenhammer), `sizzle` (Glut), `room`, `tick` |
| `analysis` | `loudness` (BS.1770-4: K-Gewichtung, Gating, M-max), `truePeak`, `spectralCentroid`, `analyze` |
| `render` / `pipeline` | Varianten-Rendering, Loop, Normierung; Worker-Pool, WAV/Opus, Cache, Manifest |

Determinismus: Gleiche Quelle ergibt bitgleiche WAVs. Opus wird mit `-fflags +bitexact` kodiert und ist mit derselben ffmpeg-Version bitgleich. Der Cache-Schlüssel ist der Hash aus `tools/sfx/src`, den Hilfsdateien in `content/audio` und der Sound-Datei.

Eingecheckt sind nur `content/audio/dist/**/*.webm`, `manifest.json` und `manifest.js` (≈ 3 MB); WAVs und `.cache.json` erzeugt `pnpm sfx` lokal. Nach Änderungen an Sounds oder `src/` also `pnpm sfx && pnpm sfx:audit` ausführen und die geänderten `.webm` + Manifest mitcommitten. Begründung und Integrationsplan: [`docs/design/audio.md`](../../docs/design/audio.md).
