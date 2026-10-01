# Audio-Demo und Browser-Abnahme

Stand 2026-09-29. Die kanonische Arbeitskopie ist `flow-and-fire`; historische Worktree-Pfade aus dem Plan gelten nicht mehr.

Die Demo unter `apps/audio-demo` verwendet die echte Klangbank, `createAudioEngine`, Canvas2D und ein deterministisches Gefecht mit 200 Schüssen/s. Zwei Fronten mit je 150 Einheiten stehen auf einem Feld von 512 × 512 WU. Mündungsblitze, nach Flugzeit eintreffende Geschosse und Explosionen werden angezeigt. Bau-Loops laufen an beiden Fronten. Drei ortsbezogene Alarme und ein Kommandantentod testen die Prioritäten. Die Kamera lässt sich verschieben, zoomen und drehen. Einstellungen werden durch die Engine in localStorage gespeichert.

Der HUD zeigt Stimmen und Kategorie-Limits, played/stolen/tails und alle Drop-Gründe als Rate und Summe, Engine- und Generator-Perzentile, Dekodierpfade, Ladefortschritt, dekodierten Speicher und Geräte-Latenz. Ein echter Overlay-Klick entsperrt Audio. Quittungen laufen synchron über `playUi`, der Rechtsklick spielt die Bewegungsquittung. Die Alarmhistorie besitzt Sprungknöpfe; die Leertaste springt über `jumpToLastAlert`.

## Test-Hook

`window.__fafAudioDemo` enthält `ready: Promise<void>` (Manifest und vollständige Klangbank geladen), `start({shots?, seconds?, speed?, seed?})`, `stop()`, `engine`, `setCamera({focusX?, focusZ?, height?, rightX?, rightZ?, angle?})` und `stats()`.

`stats()` liefert `engine: AudioStats`, Szenariozähler mit Generator-Perzentilen, `maxVoicesSeen`, `maxByCategorySeen`, `categoryLimits`, Kamera und `running`. Maximazähler werden bei `start` zurückgesetzt. Parameter in der URL: `shots`, `seconds`, `speed`, `seed`, `zoom`, `autostart=1`. Autostart entsperrt Audio nicht. Die Simulation darf schon während der Sperre laufen; die Engine verwirft diese Ereignisse.

`window.__fafAudioOffline.ready` lädt das Manifest. `run(name)` liefert Messwerte und `failures`; zulässige Namen sind `decode`, `pan`, `bus`, `limiter`, `loop`, `limits`. Die Fälle verwenden echte OfflineAudioContexts und die Module catalog/loader/mixer/voices/spatial. Decode umfasst 24 echte Dateien aus allen 15 Kategorien, Mono/Stereo, vier Loops und MS5-Waffen. Native-, erzwungene WASM- und verfügbare WebCodecs-Pfade werden auf Länge und Korrelation geprüft.

Die automatisierten Echtzeit-Tests und Benchmarks leiten den unveränderten Audio-Graph in eine MediaStream-Ausgabe ohne Lautsprecherverbindung. Stimmen, Mixer, Prioritäten und Unlock bleiben aktiv; die Engine wird nicht logisch stummgeschaltet. OfflineAudioContext prüft weiterhin die tatsächlich gerenderten PCM-Puffer. Die manuell gestartete Demo verwendet ihre normale Ausgabe.

## Befehle

```sh
pnpm exec vitest run apps/audio-demo --maxWorkers=4
./tools/heavy pnpm exec tsc -b packages/audio apps/audio-demo
./tools/heavy pnpm --filter @faf/audio-demo build
FAF_E2E_PORT=4583 ./tools/heavy pnpm --filter @faf/audio-demo test:e2e
FAF_E2E_PORT=4583 ./tools/heavy pnpm --filter @faf/audio-demo bench:browser -- --update-docs
```

Playwright nutzt einen Worker, Chromium/Firefox/WebKit und Port 4583. Es startet und beendet seinen eigenen Preview-Server. Der Benchmark baut selbst, misst je Browser drei Läufe von 20 s bei 200 und 400 Schüssen/s und beendet die eigene Prozessgruppe auch nach Fehlern. Ergebnisse liegen git-ignoriert in `apps/audio-demo/results`. Der harte 0,5-ms-Grenzwert gilt nur bei `FAF_AUDIO_PERF_GATE=1`.

## Browser-Ergebnisse

Die abschließende stumme funktionale Abnahme bestand 21 von 21 Fällen in Chromium, Firefox und WebKit (44,2 s). Audio und Demo bestehen zusammen 307 Unit-Tests in 29 Dateien. Preview und Dev-Server setzen COOP/COEP für verfügbare feinere Timerauflösung; die Benchmarkdaten enthalten die tatsächlich beobachtete Auflösung je Browser.

Messwerte werden lokal auf dem Apple M5 Pro ermittelt; sie sind kein Referenz-Laptop-Nachweis.

Der vollständige stumme Messlauf mit `FAF_AUDIO_PERF_GATE=1` bestand alle 18 Fälle
(drei Wiederholungen je Engine bei 200 und 400 Schüssen/s). Bei 200 Schüssen/s lag
Main-JS-p95 zwischen 0,18 und 0,33 ms, unter dem 0,5-ms-Gate. Die höchste beobachtete
Stimmenzahl war 27; sämtliche Kategorie-Limits und die vollständige Arbeitslast wurden geprüft.
Der Rohbericht ist `apps/audio-demo/results/1790718101769.json`. Nullwerte im p50 bedeuten
eine Dauer unter der gemessenen Timerauflösung.

<!-- bench:audio-browser:start -->
| Browser | Schüsse/s | p50 ms (Bereich) | p95 ms (Bereich) | p99 ms (Bereich) | Stimmen | Timer ms | Dekodierpfad |
|---|---|---|---|---|---|---|---|
| chromium | 200 | 0.0050 bis 0.0050 | 0.2650 bis 0.3300 | 0.4600 bis 0.5250 | 27 | 0.0050 | {"native":246,"webcodecs":0,"wasm":0} |
| chromium | 400 | 0.0050 bis 0.0050 | 0.2800 bis 0.3150 | 0.4500 bis 0.5300 | 27 | 0.0050 | {"native":246,"webcodecs":0,"wasm":0} |
| firefox | 200 | 0.0000 bis 0.0000 | 0.1800 bis 0.1800 | 0.2600 bis 0.3400 | 27 | 0.0200 | {"native":246,"webcodecs":0,"wasm":0} |
| firefox | 400 | 0.0000 bis 0.0000 | 0.2000 bis 0.2000 | 0.3000 bis 0.3800 | 27 | 0.0200 | {"native":246,"webcodecs":0,"wasm":0} |
| webkit | 200 | 0.0000 bis 0.0000 | 0.2000 bis 0.2000 | 0.2600 bis 0.3200 | 27 | 0.0200 | {"native":246,"webcodecs":0,"wasm":0} |
| webkit | 400 | 0.0000 bis 0.0000 | 0.2200 bis 0.2600 | 0.3000 bis 0.4600 | 27 | 0.0200 | {"native":246,"webcodecs":0,"wasm":0} |
<!-- bench:audio-browser:end -->

## Laufzeitkorrekturen

Die erste echte Abnahme fand zwei Fehler: Peak 1,17267 mit 32 Stimmen in Chromium/WebKit und um einen Endframe kürzere native Firefox-Puffer. Der Mixer erhielt −6 dB Headroom und einen Identitäts-WaveShaper mit fester ±1-Grenze. Die Dekodierkette normalisiert ausschließlich ±1 terminalen PCM-Frame, ohne zeitliche Verschiebung. Größere Drift bleibt im Test sichtbar. Mixer-Lebensdauer und Normalisierung werden zusätzlich mit Unit-Tests geprüft.

## Grenzen und Folgeintegration

Das Gefecht erzeugt ausschließlich Präsentationsereignisse und keinen Spielzustand. Gezeichnete Einheiten und Nachschubbewegung dienen der Audio-Ansicht. Die reale MS5-Verbindung zu FrameReader, Command-Builder, Kamera und P9 bleibt ein späterer Integrationsschritt. Geräte-Latenz ist nur verfügbar, wenn der Browser die entsprechenden AudioContext-Felder liefert. Node misst JS mit FakeAudioContext; die Browser prüfen die reale Audiopipeline.
