# Track RENDERFX

Stand 30.09.2026, konsolidiert in `/Users/logge/Documents/Projects/flow-and-fire`. Der Track liefert das eigenständige Paket `@faf/render-fx` und das FX-Lab. Die Übernahme in den Spiel-Renderer bleibt die Aufgabe von MS5/MS7/MS13/MS14. Änderungen des parallelen MS3-Tracks an `packages/render` sind Teil der gemeinsamen Konsolidierung und kein Render-FX-Ergebnis.

## Architektur und Frame-Ablauf

`packages/render-fx/src/index.ts` exportiert Core, Effects, Decals, Particles, Trails, Shields, Light und Post. Das Paket nutzt die öffentliche API von `@faf/render`, `@faf/fixed`, `@faf/protocol` sowie `gl-matrix`. Das Lab importiert keine Simulation und führt seine eigene deterministische Szenenlogik in 60-Hz-Schritten aus.

Die Lab-Shell in `apps/fx-lab/src/app/app.ts` verbindet `LabSimulation`, Kamera, Uniforms, Ground/Props/Units und FX. Ein Frame führt Szenenlogik und FX-Update aus, aktualisiert die Kamera mit Shake, schreibt Frame/FxView, rendert statische und dynamische Schatten, dann Opaque, Shields, Particles, Beams/Trails und Post. Transparente FX lesen die Tiefe, schreiben sie nicht und verwenden premultiplied blending. Partikel brauchen einen Draw, bei Ring-Umlauf zwei. Beams und Trails brauchen je einen Draw, alle Schilde zusammen einen.

GPU-Ressourcen entstehen über das RHI und dessen Restore-Registry. Spawn-Ring, Tabellen/LUT, statische Meshes, Scorch-Texturen und Post-Targets werden wiederhergestellt. CSM invalidiert den statischen Cache nach Restore. Die FX-Zeit läuft in Sekunden modulo 4096; Positionen an den GPU-APIs sind Q20.12-Rohwerte (4096 raw pro WU), Shader rechnen zuerst die Integer-Differenz zur Kamera.

| Bindung | Basis-Renderer | Render-FX |
| --- | --- | --- |
| UBO | 0 Frame, 1 Palette, 2 Pass, 3 TerrainHeight; 4/5 reserviert | 6 FxView, 7 Shadow, 8 Scorch |
| Texturen | 0 bis 7; 8/9 reserviert | 10 statische Schatten, 11 dynamische Schatten, 12 Kurven-LUT, 13 Scorch-Daten, 14 Scorch-Zellen |

Die Partikel-Layertabelle nutzt zusätzlich Textur-Unit 15 (`UNIT_FX_PARTICLE_LAYERS`). Post läuft in eigenen Fullscreen-Passes mit Units 0/1.

## Öffentliche APIs

| Modul und Datei unter `packages/render-fx/src` | API und Vertrag |
| --- | --- |
| `core/frame.ts`, `core/view.ts` | `FxFrameUniforms.update(camera, input)`, `bindings`, `destroy()`. Frame-Block entspricht dem aktuellen MS3-Layout einschließlich mapSize/Strategic/Icon/HP-Bar-Feldern. Bei `{frameUbo, writeFrame:false}` schreibt FX nur FxView. `FX_VIEW_LAYOUT` enthält Right/Up/Forward/Time. |
| `core/instance-buffer.ts`, `core/half.ts` | `DynamicInstanceBuffer` mit vorallokierten Typed Views, `upload(count)` und Restore; IEEE-binary16 `toHalf`/`fromHalf`. |
| `core/gpu-timer.ts` | `hideTimerQueryFromDevice` vor Device-Erzeugung, `GpuSpanTimer` mit nicht verschachtelten Segmenten, asynchronem Polling und Disjoint-Verwerfung. |
| `effects/define.ts`, `compile.ts`, `reference.ts` | `defineEffect`, `effectBudget`, `compileEffectLibrary`, Kurven-LUT und `evalParticle`. `FxRng`/`fxHash32` geben reproduzierbare Variation. |
| `effects/varkan.ts`, `shake.ts` | `VARKAN_EFFECTS`, `VARKAN_EVENT_FX`, `CameraShake.addFromEffect`/`sample`; Shake bezieht sich auf die Client-Kamera, nicht auf Sim-Zustand. |
| `particles/system.ts` | `ParticleSystem(dev, bindings, library, {cap,...})`, `spawn(effect, originRaw, options)`, Emitter create/move/rate/destroy, `update(time,camera)`, `encode`, `stats`, `destroy`. Ring 65.536 × 32 Byte; nur neue Records werden hochgeladen. |
| `trails/beams.ts`, `trails/trails.ts` | `BeamPass.begin/add/addTimed/update/encode`; `TrailPass.begin/add(prevRaw,curRaw,style)/encode`; `VARKAN_BEAM_STYLES`, `VARKAN_TRAIL_STYLES`. Trail-Kopf interpoliert über Frame-alpha. |
| `shields/shields.ts` | `ShieldPass.set(id,{centerRaw,radiusWu,color,hpFrac,upFrac})`, `hit(id,pointRaw,time,strength)`, `update`, `encode`, `remove`, `clear`. Vier Ripple-Slots je Schild. |
| `decals/scorch.ts` | `ScorchDecals.add/update`, CPU-Pool mit Binning, `ScorchTextures`, `SCORCH_GLSL`. Caps Low/Medium/High/Ultra: 128/256/512/1024. |
| `light/cascaded-shadows.ts`, `shadow-glsl.ts` | `CascadedShadows.update/renderStatic/renderDynamic`, `receiverBindings`, `invalidateStatic`, `destroy`; `SHADOW_CASTER_GLSL` und `SHADOW_RECEIVE_GLSL`; `NullShadowReceiver`. Zwei Kaskaden, statischer Cache, dynamische Caster je Frame. |
| `post/post-chain.ts`, `presets.ts` | `PostChain.resize/setOptions/beginScene/resolve/destroy`, `hdrActive`, `stats`; RGBA16F, Dual-Kawase, ACES und FXAA. Fehlendes `EXT_color_buffer_float` führt zu RGBA8/LDR. |

Preset-Caps für Partikel: 8192/16384/32768/65536. Prio 2 wird ab 75 % des Caps verworfen, Prio 1 am Cap, Prio 0 wird weiter angenommen. Der mögliche Überschuss ist die noch lebende Prio-0-Menge und bleibt durch den physischen Ring begrenzt. Das Lab-Gefecht erzeugt keine ACU-Tode; im Low-Test bleibt die sichtbare Menge daher innerhalb von 8192. Prio-0-Überlast ist zusätzlich im Unit-Test geprüft.

Schatten-Zieltabelle für spätere Integration: Low keine, Medium Blob, High/Ultra zwei CSM-Kaskaden bei 2048². Das Lab erlaubt CSM unabhängig davon als Diagnose-Schalter; es implementiert keinen separaten Blob-Pass. Lab-HDR/Bloom/FXAA-Schalter überschreiben Preset-Defaults bewusst.

## Effektbibliothek

Alle IDs haben das Präfix `varkan:`. Budgets stammen aus `effectBudget` der aktuellen Definitionen: Burst-Maximum oder maximale gleichzeitig lebende Menge eines einzelnen kontinuierlichen Emitters bei Rate-Multiplikator 1. Szenen können diesen Multiplikator erhöhen.

| Effekt | Burst | Dauer-Emitter |
| --- | ---: | ---: |
| muzzle_small | 7 | 0 |
| muzzle_cannon | 14 | 0 |
| muzzle_artillery | 21 | 0 |
| muzzle_missile | 18 | 0 |
| impact_ground_small | 16 | 0 |
| impact_ground_large | 44 | 0 |
| impact_metal | 18 | 0 |
| impact_shield | 12 | 0 |
| impact_water | 18 | 0 |
| explosion_small | 37 | 0 |
| explosion_medium | 76 | 0 |
| explosion_large | 175 | 0 |
| acu_explosion | 942 | 0 |
| acu_aftermath | 152 | 0 |
| smoke_damage | 0 | 27 |
| smoke_puff | 9 | 0 |
| sparks_burst | 31 | 0 |
| wreck_smolder | 0 | 22 |
| missile_smoke_trail | 0 | 60 |
| build_stream | 0 | 78 |
| reclaim_stream | 0 | 73 |

## Lab und visuelle Prüfung

`pnpm fx:lab` startet Vite; `pnpm test:e2e:fx` baut und nutzt den eigenen Preview-Port 4683. Fremde Server werden nicht übernommen oder beendet. Parameter: `scene`, `preset`, `hdr`, `bloom`, `csm`, `fxaa`, `seed`, `freeze`, `bench`, `flight`, `fx`. `freeze=T` simuliert alle festen Schritte bis T und hält anschließend denselben Zeitpunkt. `bench=1` blendet das HUD aus.

`window.__fxlab` bietet `ready`, `error`, `stats()`, `samples()`, `resetSamples()`, `setScene()`, `loseContext()`, `restoreContext()` und `triggerBigExplosion()`. Die 2048-Sample-Ringstruktur enthält Frame/Main/FX/Lab-Zeit, Draws, FX-Draws, Partikelmenge und GPU-Segmente. GPU-Gesamtzeit ist erst bei vollständig aufgelösten Segmenten verfügbar, sonst null.

Die eingefrorenen Bilder liegen unter `test-results/fx-shots/<szene>-<zeit>-<engine>.png`, Engines `chromium`, `firefox`, `webkit`: battle 12, shields 6, big 1.6 und 4, gallery 2.8 und 3, lighting 3. Die Galerie zeigt bei 2.8 s kurzlebige Bursts und bei 3 s spätere Feuer-/Rauchschichten. Die Kamera umfasst alle 21 Label-Positionen. Kritische Bildbeurteilung und aktuelle Prüfergebnisse stehen in [rfx-p6-lab-scenes.md](rfx-p6-lab-scenes.md).

Die abschließenden HUD-freien Galerieaufnahmen bei 2,766 s sind dauerhaft gesichert: [Chromium](track-renderfx/gallery-2.766-chromium.png), [Firefox](track-renderfx/gallery-2.766-firefox.png), [WebKit](track-renderfx/gallery-2.766-webkit.png). Die Dateien sind bytegleiche Kopien der ursprünglichen `test-results/fx-shots/gallery-2.766-<engine>.png`; SHA-256 und Originalpfade stehen in `.git/consolidation/fx-final-receipt.json`. Der strukturierte 18-Fall-Smoke-Nachweis ist unverändert unter `.git/consolidation/fx-artifacts/render-fx-smoke.json` gesichert. Die historischen `test-results/`-Ausgaben können bei weiteren Playwright-Läufen ersetzt werden.

## Messungen

Der vollständige Lauf vom 30.09.2026 bestand alle 42 Fälle mit Exit 0, ohne Page-/GL-/Shader-Fehler. Pro Engine wurden sieben Szenen zweimal mit 2 s Warm-up und 8 s Erfassung gemessen. Gesamt-Draws blieben bei höchstens 20 (Grenze 40), FX-Draws bei höchstens 4 (Grenze 6). Das Medium-Gefecht hielt in allen drei Engines 12.275,4 bis 12.278,2 Partikel im tatsächlichen Mittel (Ziel mindestens 8.000); Chromium erreichte 60,002 FPS bei Frame-p95 16,67 ms.

Der Lauf ist nicht vollständig als ruhig qualifiziert: Vor WebKit/battlelow/Lauf 1 wurde der laufende H3-Server bei 1,3 % CPU erkannt; die übrigen 83 Fall-Messgrenzen und die initiale Grenze meldeten keine Fremdlast. Der vollständige unveränderte Rohbericht liegt in `apps/fx-lab/results/fx-2026-09-29-single-foreign-load.json`, das Log in `.git/consolidation/fx-bench-single-foreign-load-final.log`. Die beiden unveränderten WebKit-Low-Läufe wurden gesondert wiederholt. Auch diese Wiederholung bestand funktional, erkannte jedoch einen echten H3/MLX-pytest-Prozess an zwei Grenzen; sie liefert deshalb keinen ruhigen Ersatz. Separater Rohbericht: `fx-2026-09-29-webkit-battlelow-retest.json`, Log: `.git/consolidation/fx-bench-webkit-battlelow-retest.log`. Nach Ende des zusätzlichen H3/MLX-Tests bestand eine zweite unveränderte WebKit-Low-Wiederholung mit leerer initialer und allen vier Fall-Messgrenzen. Rohbericht `fx-2026-09-29-webkit-battlelow-retest-2.json`, Log `.git/consolidation/fx-bench-webkit-battlelow-retest-2.log`. Die abgeleitete Auswertung `fx-2026-09-29-final-composed.json` ersetzt genau beide WebKit-Low-Fälle durch diese zwei ruhigen Wiederholungen und behält die übrigen 40 Fälle unverändert. Ihre Metadaten verknüpfen die beiden exakten Rohquellen und schließen die belastete erste Wiederholung aus. Dies sind 40 + 2 Messfenster, keine zweite vollständige 42-Fall-Ausführung. Leere Lastmarker beweisen keine vollständig ruhige GPU.

Die verfügbaren Chromium-GPU-Werte verfehlen die Ziele: 20 Schilde p95 2,8475 bis 2,8851 ms statt höchstens 1 ms; isolierte Lighting-CSM p95 2,5270 bis 2,5422 ms statt höchstens 2,5 ms. Im Medium-Gefecht beträgt Shadow-p95 3,4503 bis 3,5540 ms. Die Ursache dieser Überschreitungen ist nicht belegt. Firefox und WebKit liefern keine GPU-Timerwerte. Zeitwerte werden gemäß DECISIONS 16 berichtet; der Exit 0 belegt die funktionalen Gates und keine erfüllte GPU-Zeitgrenze.

<!-- fx:results:begin -->
Lokal gemessen, Apple M5 Pro, kein Iris Xe. Abgeleitete 42-Fall-Auswertung aus 40 ruhigen Fällen des vollständigen Laufs vom 2026-09-29T23:11:10.534Z und zwei unveränderten WebKit/battlelow-Wiederholungen vom 2026-09-29T23:23:02.756Z. Dies ist keine zweite vollständige Ausführung. Je Fall 2 s Warm-up und 8 s Erfassung, 1920×1080 CSS-Pixel (Preset-Skalierung im JSON). Initiale und Fall-Messgrenzen der verwendeten Fälle ohne erkannte Fremdlast. Exakte Rohquellen und Zusammensetzung: `apps/fx-lab/results/fx-2026-09-29-final-composed.json`.

Zeiten: p50 / p95 / p99 in ms. Fehlende GPU-Timer: n/v.

| Engine | Szene | Lauf | Frame | Main-JS | FX-JS | Lab-JS | GPU gesamt |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| chromium | battle | 1 | 16.66 / 16.67 / 16.67 | 1.00 / 1.23 / 1.41 | 0.58 / 0.74 / 0.84 | 0.25 / 0.33 / 0.36 | 13.03 / 16.13 / 21.07 |
| chromium | battle | 2 | 16.66 / 16.67 / 16.67 | 0.97 / 1.24 / 1.36 | 0.55 / 0.75 / 0.83 | 0.24 / 0.32 / 0.37 | 13.04 / 16.26 / 20.45 |
| chromium | battlelow | 1 | 16.66 / 16.67 / 16.67 | 0.92 / 1.14 / 1.19 | 0.52 / 0.67 / 0.72 | 0.25 / 0.32 / 0.36 | 8.28 / 10.01 / 10.42 |
| chromium | battlelow | 2 | 16.66 / 16.67 / 16.67 | 0.90 / 1.14 / 1.24 | 0.51 / 0.68 / 0.78 | 0.25 / 0.32 / 0.37 | 8.32 / 10.13 / 10.88 |
| chromium | shields | 1 | 16.66 / 16.67 / 16.67 | 0.40 / 0.60 / 0.74 | 0.20 / 0.37 / 0.44 | 0.04 / 0.14 / 0.18 | 11.61 / 14.75 / 15.31 |
| chromium | shields | 2 | 16.66 / 16.67 / 16.67 | 0.38 / 0.57 / 0.68 | 0.19 / 0.36 / 0.41 | 0.03 / 0.14 / 0.17 | 11.57 / 14.73 / 15.62 |
| chromium | big | 1 | 16.66 / 16.67 / 16.67 | 0.30 / 0.42 / 0.52 | 0.16 / 0.22 / 0.31 | 0.00 / 0.01 / 0.01 | 8.90 / 12.39 / 13.72 |
| chromium | big | 2 | 16.66 / 16.67 / 16.67 | 0.28 / 0.42 / 0.48 | 0.15 / 0.23 / 0.31 | 0.00 / 0.01 / 0.01 | 8.96 / 12.67 / 14.03 |
| chromium | lightingcsm | 1 | 16.66 / 16.67 / 16.67 | 0.29 / 0.43 / 0.53 | 0.14 / 0.21 / 0.28 | 0.02 / 0.03 / 0.09 | 5.09 / 7.24 / 9.53 |
| chromium | lightingcsm | 2 | 16.66 / 16.67 / 16.67 | 0.28 / 0.41 / 0.47 | 0.14 / 0.20 / 0.23 | 0.02 / 0.03 / 0.08 | 4.78 / 7.39 / 8.12 |
| chromium | lightingnocsm | 1 | 16.66 / 16.67 / 16.67 | 0.25 / 0.38 / 0.43 | 0.10 / 0.15 / 0.18 | 0.02 / 0.03 / 0.08 | 4.16 / 4.48 / 4.73 |
| chromium | lightingnocsm | 2 | 16.66 / 16.67 / 16.67 | 0.25 / 0.38 / 0.42 | 0.09 / 0.15 / 0.18 | 0.02 / 0.03 / 0.09 | 4.16 / 4.45 / 4.75 |
| chromium | battleldr | 1 | 16.66 / 16.67 / 16.67 | 0.92 / 1.23 / 1.32 | 0.52 / 0.74 / 0.83 | 0.24 / 0.31 / 0.38 | 12.95 / 16.35 / 20.74 |
| chromium | battleldr | 2 | 16.66 / 16.67 / 16.67 | 0.93 / 1.22 / 1.31 | 0.53 / 0.73 / 0.81 | 0.24 / 0.32 / 0.36 | 12.95 / 16.67 / 21.02 |
| firefox | battle | 1 | 16.66 / 16.80 / 17.36 | 0.82 / 1.76 / 2.06 | 0.46 / 1.02 / 1.22 | 0.20 / 0.60 / 0.80 | n/v |
| firefox | battle | 2 | 16.66 / 16.78 / 17.40 | 0.94 / 1.70 / 2.00 | 0.54 / 1.00 / 1.14 | 0.22 / 0.58 / 0.76 | n/v |
| firefox | battlelow | 1 | 16.66 / 16.68 / 17.28 | 0.92 / 1.42 / 1.76 | 0.52 / 0.86 / 1.02 | 0.22 / 0.40 / 0.58 | n/v |
| firefox | battlelow | 2 | 16.66 / 16.96 / 17.40 | 1.00 / 1.44 / 1.76 | 0.58 / 0.82 / 1.10 | 0.22 / 0.48 / 0.60 | n/v |
| firefox | shields | 1 | 16.66 / 16.92 / 17.46 | 0.46 / 0.82 / 1.00 | 0.26 / 0.52 / 0.68 | 0.04 / 0.16 / 0.26 | n/v |
| firefox | shields | 2 | 16.66 / 16.76 / 17.36 | 0.42 / 0.76 / 0.92 | 0.24 / 0.48 / 0.64 | 0.02 / 0.16 / 0.26 | n/v |
| firefox | big | 1 | 16.66 / 16.68 / 17.12 | 0.40 / 0.56 / 0.70 | 0.22 / 0.34 / 0.52 | 0.00 / 0.02 / 0.02 | n/v |
| firefox | big | 2 | 16.66 / 16.68 / 17.18 | 0.34 / 0.54 / 0.72 | 0.20 / 0.32 / 0.48 | 0.00 / 0.02 / 0.02 | n/v |
| firefox | lightingcsm | 1 | 16.66 / 16.68 / 17.30 | 0.30 / 0.52 / 0.62 | 0.16 / 0.30 / 0.40 | 0.02 / 0.04 / 0.08 | n/v |
| firefox | lightingcsm | 2 | 16.66 / 16.96 / 17.44 | 0.34 / 0.52 / 0.64 | 0.18 / 0.30 / 0.36 | 0.02 / 0.04 / 0.10 | n/v |
| firefox | lightingnocsm | 1 | 16.66 / 16.68 / 17.26 | 0.32 / 0.46 / 0.56 | 0.12 / 0.22 / 0.28 | 0.02 / 0.04 / 0.08 | n/v |
| firefox | lightingnocsm | 2 | 16.66 / 16.70 / 17.30 | 0.30 / 0.42 / 0.54 | 0.12 / 0.18 / 0.24 | 0.02 / 0.04 / 0.06 | n/v |
| firefox | battleldr | 1 | 16.66 / 16.68 / 17.06 | 1.00 / 1.84 / 2.18 | 0.58 / 1.06 / 1.22 | 0.24 / 0.62 / 0.82 | n/v |
| firefox | battleldr | 2 | 16.66 / 16.74 / 17.28 | 1.06 / 1.82 / 2.14 | 0.62 / 1.02 / 1.20 | 0.24 / 0.64 / 0.74 | n/v |
| webkit | battle | 1 | 17.00 / 18.00 / 19.00 | 1.00 / 1.00 / 1.00 | 0.00 / 1.00 / 1.00 | 0.00 / 1.00 / 1.00 | n/v |
| webkit | battle | 2 | 17.00 / 19.00 / 19.00 | 1.00 / 1.00 / 2.00 | 0.00 / 1.00 / 1.00 | 0.00 / 1.00 / 1.00 | n/v |
| webkit | battlelow | 1 | 17.00 / 18.00 / 19.00 | 1.00 / 1.00 / 2.00 | 1.00 / 1.00 / 1.00 | 0.00 / 1.00 / 1.00 | n/v |
| webkit | battlelow | 2 | 17.00 / 18.00 / 19.00 | 1.00 / 1.00 / 2.00 | 0.00 / 1.00 / 1.00 | 0.00 / 1.00 / 1.00 | n/v |
| webkit | shields | 1 | 17.00 / 19.00 / 20.00 | 0.00 / 1.00 / 1.00 | 0.00 / 1.00 / 1.00 | 0.00 / 0.00 / 1.00 | n/v |
| webkit | shields | 2 | 17.00 / 18.00 / 19.00 | 0.00 / 1.00 / 1.00 | 0.00 / 1.00 / 1.00 | 0.00 / 1.00 / 1.00 | n/v |
| webkit | big | 1 | 17.00 / 18.00 / 19.00 | 0.00 / 1.00 / 1.00 | 0.00 / 1.00 / 1.00 | 0.00 / 0.00 / 1.00 | n/v |
| webkit | big | 2 | 17.00 / 18.00 / 19.00 | 0.00 / 1.00 / 1.00 | 0.00 / 1.00 / 1.00 | 0.00 / 0.00 / 0.00 | n/v |
| webkit | lightingcsm | 1 | 17.00 / 18.00 / 19.00 | 0.00 / 1.00 / 1.00 | 0.00 / 1.00 / 1.00 | 0.00 / 0.00 / 0.00 | n/v |
| webkit | lightingcsm | 2 | 17.00 / 19.00 / 20.00 | 0.00 / 1.00 / 1.00 | 0.00 / 1.00 / 1.00 | 0.00 / 0.00 / 1.00 | n/v |
| webkit | lightingnocsm | 1 | 17.00 / 19.00 / 19.00 | 0.00 / 1.00 / 1.00 | 0.00 / 1.00 / 1.00 | 0.00 / 0.00 / 0.00 | n/v |
| webkit | lightingnocsm | 2 | 17.00 / 18.00 / 20.00 | 0.00 / 1.00 / 1.00 | 0.00 / 1.00 / 1.00 | 0.00 / 0.00 / 1.00 | n/v |
| webkit | battleldr | 1 | 17.00 / 19.00 / 20.00 | 1.00 / 1.00 / 2.00 | 1.00 / 1.00 / 1.00 | 0.00 / 1.00 / 1.00 | n/v |
| webkit | battleldr | 2 | 17.00 / 19.00 / 19.00 | 1.00 / 1.00 / 2.00 | 1.00 / 1.00 / 1.00 | 0.00 / 1.00 / 1.00 | n/v |

GPU-Segmente, p95 in ms.

| Engine | Szene | Lauf | Shadow | Opaque | Shields | Particles | Beams | Post |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| chromium | battle | 1 | 3.450 | 5.556 | 0.000 | 3.045 | 3.517 | 3.470 |
| chromium | battle | 2 | 3.554 | 5.667 | 0.000 | 3.052 | 3.509 | 3.471 |
| chromium | battlelow | 1 | 2.107 | 2.419 | 0.000 | 1.840 | 2.264 | 2.276 |
| chromium | battlelow | 2 | 2.177 | 2.658 | 0.000 | 1.839 | 2.265 | 2.269 |
| chromium | shields | 1 | 2.860 | 4.442 | 2.847 | 2.129 | 2.641 | 2.863 |
| chromium | shields | 2 | 2.910 | 4.448 | 2.885 | 2.127 | 2.647 | 2.863 |
| chromium | big | 1 | 3.689 | 5.089 | 0.000 | 3.100 | 0.000 | 3.722 |
| chromium | big | 2 | 3.827 | 5.332 | 0.000 | 3.111 | 0.000 | 3.718 |
| chromium | lightingcsm | 1 | 2.527 | 4.059 | 0.000 | 0.000 | 0.000 | 2.394 |
| chromium | lightingcsm | 2 | 2.542 | 4.121 | 0.000 | 0.000 | 0.000 | 2.387 |
| chromium | lightingnocsm | 1 | 0.000 | 3.736 | 0.000 | 0.000 | 0.000 | 2.303 |
| chromium | lightingnocsm | 2 | 0.000 | 3.688 | 0.000 | 0.000 | 0.000 | 2.304 |
| chromium | battleldr | 1 | 3.533 | 5.521 | 0.000 | 3.059 | 3.518 | 3.394 |
| chromium | battleldr | 2 | 3.586 | 5.558 | 0.000 | 3.049 | 3.523 | 3.394 |
| firefox | battle | 1 | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | battle | 2 | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | battlelow | 1 | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | battlelow | 2 | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | shields | 1 | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | shields | 2 | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | big | 1 | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | big | 2 | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | lightingcsm | 1 | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | lightingcsm | 2 | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | lightingnocsm | 1 | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | lightingnocsm | 2 | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | battleldr | 1 | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | battleldr | 2 | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | battle | 1 | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | battle | 2 | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | battlelow | 1 | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | battlelow | 2 | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | shields | 1 | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | shields | 2 | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | big | 1 | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | big | 2 | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | lightingcsm | 1 | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | lightingcsm | 2 | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | lightingnocsm | 1 | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | lightingnocsm | 2 | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | battleldr | 1 | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | battleldr | 2 | n/v | n/v | n/v | n/v | n/v | n/v |

| Engine | Szene | Lauf | Draws p50/max | FX-Draws p50/max | Partikel Mittel/p50 | Cap | Dropped Prio 0/1/2 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| chromium | battle | 1 | 20 / 20 | 4 / 4 | 12278.2 / 12292 | 16384 | 0 / 0 / 164816 |
| chromium | battle | 2 | 20 / 20 | 4 / 4 | 12277.7 / 12290 | 16384 | 0 / 0 / 164266 |
| chromium | battlelow | 1 | 19 / 20 | 3 / 4 | 6154.0 / 6160 | 8192 | 0 / 0 / 207815 |
| chromium | battlelow | 2 | 19 / 20 | 3 / 4 | 6154.1 / 6160 | 8192 | 0 / 0 / 207827 |
| chromium | shields | 1 | 19 / 19 | 3 / 3 | 643.7 / 655 | 16384 | 0 / 0 / 0 |
| chromium | shields | 2 | 19 / 19 | 3 / 3 | 643.7 / 655 | 16384 | 0 / 0 / 0 |
| chromium | big | 1 | 17 / 17 | 1 / 1 | 997.9 / 872 | 16384 | 0 / 0 / 0 |
| chromium | big | 2 | 17 / 17 | 1 / 1 | 997.9 / 872 | 16384 | 0 / 0 / 0 |
| chromium | lightingcsm | 1 | 16 / 16 | 0 / 0 | 0.0 / 0 | 16384 | 0 / 0 / 0 |
| chromium | lightingcsm | 2 | 16 / 16 | 0 / 0 | 0.0 / 0 | 16384 | 0 / 0 / 0 |
| chromium | lightingnocsm | 1 | 14 / 14 | 0 / 0 | 0.0 / 0 | 16384 | 0 / 0 / 0 |
| chromium | lightingnocsm | 2 | 14 / 14 | 0 / 0 | 0.0 / 0 | 16384 | 0 / 0 / 0 |
| chromium | battleldr | 1 | 20 / 20 | 4 / 4 | 12278.1 / 12292 | 16384 | 0 / 0 / 164337 |
| chromium | battleldr | 2 | 20 / 20 | 4 / 4 | 12277.9 / 12292 | 16384 | 0 / 0 / 164337 |
| firefox | battle | 1 | 20 / 20 | 4 / 4 | 12276.2 / 12289 | 16384 | 0 / 0 / 166393 |
| firefox | battle | 2 | 20 / 20 | 4 / 4 | 12275.4 / 12288 | 16384 | 0 / 0 / 164139 |
| firefox | battlelow | 1 | 19 / 20 | 3 / 4 | 6153.9 / 6161 | 8192 | 0 / 0 / 208037 |
| firefox | battlelow | 2 | 19 / 20 | 3 / 4 | 6154.5 / 6161 | 8192 | 0 / 0 / 209164 |
| firefox | shields | 1 | 19 / 19 | 3 / 3 | 639.9 / 652 | 16384 | 0 / 0 / 0 |
| firefox | shields | 2 | 19 / 19 | 3 / 3 | 639.9 / 652 | 16384 | 0 / 0 / 0 |
| firefox | big | 1 | 17 / 17 | 1 / 1 | 996.6 / 866 | 16384 | 0 / 0 / 0 |
| firefox | big | 2 | 17 / 17 | 1 / 1 | 995.9 / 872 | 16384 | 0 / 0 / 0 |
| firefox | lightingcsm | 1 | 16 / 16 | 0 / 0 | 0.0 / 0 | 16384 | 0 / 0 / 0 |
| firefox | lightingcsm | 2 | 16 / 16 | 0 / 0 | 0.0 / 0 | 16384 | 0 / 0 / 0 |
| firefox | lightingnocsm | 1 | 14 / 14 | 0 / 0 | 0.0 / 0 | 16384 | 0 / 0 / 0 |
| firefox | lightingnocsm | 2 | 14 / 14 | 0 / 0 | 0.0 / 0 | 16384 | 0 / 0 / 0 |
| firefox | battleldr | 1 | 20 / 20 | 4 / 4 | 12277.8 / 12290 | 16384 | 0 / 0 / 164914 |
| firefox | battleldr | 2 | 20 / 20 | 4 / 4 | 12275.9 / 12288 | 16384 | 0 / 0 / 164174 |
| webkit | battle | 1 | 20 / 20 | 4 / 4 | 12278.1 / 12292 | 16384 | 0 / 0 / 164337 |
| webkit | battle | 2 | 20 / 20 | 4 / 4 | 12278.1 / 12292 | 16384 | 0 / 0 / 164337 |
| webkit | battlelow | 1 | 19 / 20 | 3 / 4 | 6153.0 / 6155 | 8192 | 0 / 0 / 208026 |
| webkit | battlelow | 2 | 19 / 20 | 3 / 4 | 6154.0 / 6161 | 8192 | 0 / 0 / 208029 |
| webkit | shields | 1 | 19 / 19 | 3 / 3 | 644.1 / 655 | 16384 | 0 / 0 / 0 |
| webkit | shields | 2 | 19 / 19 | 3 / 3 | 643.2 / 655 | 16384 | 0 / 0 / 0 |
| webkit | big | 1 | 17 / 17 | 1 / 1 | 996.0 / 866 | 16384 | 0 / 0 / 0 |
| webkit | big | 2 | 17 / 17 | 1 / 1 | 995.7 / 866 | 16384 | 0 / 0 / 0 |
| webkit | lightingcsm | 1 | 16 / 16 | 0 / 0 | 0.0 / 0 | 16384 | 0 / 0 / 0 |
| webkit | lightingcsm | 2 | 16 / 16 | 0 / 0 | 0.0 / 0 | 16384 | 0 / 0 / 0 |
| webkit | lightingnocsm | 1 | 14 / 14 | 0 / 0 | 0.0 / 0 | 16384 | 0 / 0 / 0 |
| webkit | lightingnocsm | 2 | 14 / 14 | 0 / 0 | 0.0 / 0 | 16384 | 0 / 0 / 0 |
| webkit | battleldr | 1 | 20 / 20 | 4 / 4 | 12278.1 / 12292 | 16384 | 0 / 0 / 164224 |
| webkit | battleldr | 2 | 20 / 20 | 4 / 4 | 12278.1 / 12292 | 16384 | 0 / 0 / 164337 |
<!-- fx:results:end -->

Vollständiger Aufruf nach Ende aller anderen GPU-/Bench-Jobs:

```sh
./tools/heavy pnpm bench:fx -- --wait=300 --update-docs
```

Quick-Smoke des Runners, getrennt von der vollständigen Leistungsbewertung:

```sh
./tools/heavy pnpm bench:fx -- --quick
```

Bericht `apps/fx-lab/results/fx-YYYY-MM-DD.json`, Quick mit `-quick`. Wurzelfelder: `date`, `quick`, `warmup`, `seconds`, `repeats`, `machine`, `foreignLoad`, `browsers`. Pro Browser: `engine`, `version`, `errors`, `scenarios`. Pro Lauf: `scenario`, `run`, `frames`, `stats`, Mittelwert und Quantile `{mean,p50,p95,p99,max}` für `frameMs`, `fps`, `mainJsMs`, `fxJsMs`, `labJsMs`, `draws`, `fxDraws`, `particlesAlive`, `gpuMs`; `gpuSegments` mit shadow/opaque/shields/particles/beams/post; `loadBefore`, `loadAfter`, `errors`. Fehlende GPU-Timer ergeben null. Partikel-Cap und Dropped-Zähler stehen in `stats.fx.particles`. Durchläufe bleiben einzeln erhalten; daraus ergeben sich die Wertebereiche.

`--update-docs` ersetzt ausschließlich den Markerblock durch CPU-/GPU-Quantile, Segment-p95 und Draw-/Partikel-Tabellen. Erkannte Fremdlast wird im Bericht und in der Tabelle markiert. Der Runner wartet mit `--wait` auf erkannte CPU-intensive Test/Build/MLX/Bench-Prozesse; er beweist keine vollständig ruhige GPU. Der Haupttask plant deshalb eine eigene Messphase. Exit 1 bei GL-/Shader-/Page-/Hook-Fehlern, fehlenden Samples, FX-Draws > 6 oder Gesamt-Draws > 40; Zeitwerte sind Messungen gemäß DECISIONS 16.

## Integration in MS5

Den visuellen Event-Stream an `effects/varkan.ts::VARKAN_EVENT_FX` anbinden: weapon-Klasse für Mündungsfeuer, impact-Klasse für Treffer und death-Klasse für Explosion. `compileEffectLibrary` einmal erzeugen, `ParticleSystem.spawn` mit Event-Position in raw, reproduzierbarem Seed und Richtung aufrufen. Kontinuierliche Effekte benötigen stabile Owner-ID, Emitter-Handle, Position/Target und Start/Stop. Vorbild: `apps/fx-lab/src/scenes/fx.ts`.

ACU-death muss die Klasse `acu` liefern; `onShake` an `CameraShake.addFromEffect` anbinden. `CameraShake.sample` additiv auf die Client-Kamera anwenden und den Grundzustand der Kamera erhalten. Projektile benötigen prev/cur-Rohposition, Projektilklasse und eventuell den Emitter-Handle für Rauch. `TrailPass.add` bekommt beide Positionen; Frame-alpha liefert die Interpolation. Die Latenz-Abnahme gehört an den realen Event→Client→Renderer-Pfad; der Lab-Test belegt die unmittelbare Auslösung zum nächsten präsentierten Frame.

## Integration in MS7

`FxFrameUniforms` mit dem Frame-UBO des Spiel-Renderers verbinden und ausschließlich FxView selbst schreiben. Nach Units/Water Shields, Particles und Beams/Trails im Scene-Target encodieren; anschließend Post. Caps aus `RENDER_PRESETS` verwenden, Zahlen zu Dropped/Uploads/Draws in die Render-Statistik übernehmen. Keine Partikel-Objektliste pro Frame aufbauen: neue Event-Records werden in den festen Ring geschrieben.

Scorch entsteht aus ground-impact/death mit x/z, Radius, Rotation, Seed, tS, lifetimeS, emberS und Kind scorch/crater. `ScorchTextures` und `SCORCH_GLSL` wie in `apps/fx-lab/src/app/ground.ts` an den Terrain-FS anbinden. Das eigene Binning muss vor der Spielintegration mit MS3/G19 `packages/render/src/terrain/decals.ts` zusammengeführt werden; Slots und Texture-Units nicht doppelt belegen. Im Lab ist das Scorch-Rendering bereits aktiv, im Spiel noch nicht durch diesen Track verdrahtet.

## Integration in MS13

Shield-Frame-Records brauchen stabile ID, centerRaw, radiusWu, color, hpFrac und upFrac. Je Render-Update `ShieldPass.set` aufrufen und entfernte IDs mit `remove` abräumen. ShieldHit-Events brauchen dieselbe ID, pointRaw, Event-Zeit und Stärke. `hit` legt bis zu vier aktive Ripples ab; weitere Treffer ersetzen den Slot mit geringster Restenergie, bei gleicher Energie den ältesten. Die Render-Reihenfolge setzt Schilde vor Partikel. Das 20-Schild-Budget wird mit dem isolierten shields-Segment gemessen.

## Integration in MS14

`PostChain.beginScene` liefert das HDR/LDR-Scene-Target für alle Opaque-/FX-Passes; `resolve` führt Bloom, Tonemapping und FXAA aus. Resize und geänderte HDR-Optionen müssen auch die Receiver-Pipelines auf die neue Lichtvariante umstellen, Vorbild `app.ts::applyHdr`. MSAA wird im Scene-Target durch FXAA ersetzt.

`CascadedShadows` vor dem Scene-Pass aktualisieren. Statische Terrain/Props-Caster über `renderStatic`, dynamische Units über `renderDynamic` zeichnen. Caster für jede Kaskade bündeln/cullen; `ShadowCasterView` liefert Matrix, Anchor und Frustum. Receiver übernehmen `SHADOW_RECEIVE_GLSL` plus `receiverBindings` in Terrain/Units/Props, analog `app/ground.ts`, `props.ts`, `unit-pass.ts`. Kamerabewegung und Caster-Bounds bestimmen Cache-Invalidierung, Context-Restore invalidiert ihn immer. `SHADOW_PRESET_TABLE` liefert die Zieltabelle; eine spätere Autodetect-Auswahl braucht echte GPU-Messwerte und darf diese lokalen Lab-Werte nicht als fremde Hardwareleistung ausgeben.

## Abnahme gegen TRACK-RENDERFX

| Anforderung | Stand und Beleg |
| --- | --- |
| Paketgrenzen, keine Sim-Abhängigkeit | Quellstruktur umgesetzt; globale dependency-cruiser-Prüfung im Haupttask. Die ursprüngliche unveränderte-render-Git-Bedingung gilt für den Einzeltrack, nicht für die gemeinsame MS3-Konsolidierung. |
| Install/Typecheck/Lint/Unit gesamt | Scoped Prüfungen siehe P7; globale Prüfungen und frozen install im Haupttask. |
| 65.536-Ring, Spawn-Uploads, GLSL-Parität | Unit-Tests einschließlich 10.000 Referenzfällen; GPU-Position ±2 px und Restore im neuen particles-Smoke. |
| Caps/Prioritäten | Low-Cap-E2E in allen drei Browsern und Overload-Unit-Tests. |
| ≥ 18 Varkan-Effekte | 21 Definitionen und Budgettests, Galerie mit Labels. |
| Beams/Trails/Shields | Ein Draw je Pass, Interpolation/Ripple-Tests und Browser-Smokes; Chromium-Schild-GPU-p95 2,8475..2,8851 ms verfehlt das 1-ms-Ziel. |
| Scorch/Krater/Binning | Unit-Tests und sichtbare Lab-Decals; Spiel-Terrain-Integration separat. |
| HDR/Bloom/ACES/FXAA, CSM | LDR/Fallback-E2E, CSM-Cache und beide Kaskaden im light-Smoke; Chromium-Lighting-CSM-p95 2,5270..2,5422 ms verfehlt das 2,5-ms-Ziel. |
| Context-Loss | Alle Module im Smoke und Battle im E2E; verfügbar und bestanden in allen drei Engines. |
| Lab/Draws/Latenz/FPS | Fünf Szenen, Draw-Gates und ≤1-Frame-E2E; Chromium-Medium 60,002 FPS; Medium-Partikelmittel 12.275,4..12.278,2. Alle 42 Fälle halten Draw-Gates ein. |
| Benchmark/JSON/Tabellen | Quick und vollständige 42-Fall-Matrix bestanden; finale Tabellen aus 40 ruhigen Originalfällen plus zwei ruhigen unveränderten Wiederholungen, mit expliziter Provenienz. Belastete Rohberichte erhalten. |
| E2E/Visual | Drei Engines geprüft; P6/P7 dokumentieren Ausführung und Bildbewertung. |
| Dokumentation | Architektur/APIs/Integration/Fragmente vorhanden; DECISIONS/STATUS werden vom Haupttask ergänzt. |

## Bekannte Grenzen

Keine Soft-Particles und keine transparente Tiefensortierung. Der Prio-0-Überschuss kann den Preset-Cap überschreiten, der physische Ring bleibt endlich. GPU-Timing ist im beobachteten Headless-Setup nur Chromium verfügbar; Firefox/WebKit liefern n/v. Die 1920×1080-Bench-Seite wird je Preset intern skaliert, `stats.canvas` dokumentiert die tatsächlichen Target-Pixel. Einige Lab-Szenenhelfer erzeugen kleine WU-Arrays und Projektile/Wracks bei Events; der Allokationsnachweis des GPU-Kerns ersetzt keinen Allokationsnachweis der gesamten Lab-Shell. Die Choreografie zeigt Build/Reclaim-Ströme als visuelle Events ohne Sim-Baufortschritt.

Die übertragenen P0/P1/P2-Fragmente beschreiben den damaligen isolierten Track-Stand. Aktuelle Prüfergebnisse und das MS3-Frame-Layout stehen hier und im neuen P7-Fragment.
