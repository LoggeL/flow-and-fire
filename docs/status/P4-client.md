# P4-client – `@faf/client`: SimLink, Kamera, Input, Picking, Selektion, Commands, Frame-Consumer, Metriken (MS1, Welle 2)

Feature-IDs: **S1** (Interpolation der 1.000 Würfel auf Client-Seite), **S3** (Commands per `seq`), **A5** (Pause:
Kamera und Command-Annahme laufen weiter), **G14** (Frame-Consumer, UnitRecord direkt als Instanzdaten),
Vorbereitung **SPK6** (Messkette Klick → erster bewegter Pixel). Vorgriff auf C1 (Selektion, Abnahme erst MS3).

Abhängigkeiten von `src/`: nur `@faf/protocol`, `@faf/render`, `@faf/fixed` (Typen) und indirekt `gl-matrix` über render.
Kein Import von `sim`/`sim-host` (dependency-cruiser grün).

## Umgesetzt

| Datei | Inhalt |
|---|---|
| `src/sim-link.ts` | `SimLink { sendCommands(batch: ArrayBuffer); sendCtl(msg: CtlMessage); frames: FrameConsumer; onHostMessage(cb) → unsubscribe }`. Die Worker-Implementierung baut apps/game (P7). |
| `src/picking.ts` | `GroundPicker`: `camera.screenToRay` ∩ Ebene y = 0 (render `intersectGround`) → `x`/`z` als gerundete Q20.12-Rohwerte (Int32), auf die Karte geklemmt (`clamped`), zusätzlich ungeklemmter Treffer `wuX/wuZ`. Strahl oberhalb des Horizonts ⇒ `false`. Helfer `mapBoundsWU()` (Standard 512 × 512 WU ab 0,0), `wuToRaw`, `clampRaw`. Kein GPU-Readback. |
| `src/camera-controller.ts` | `CameraController` auf `RtsCamera`: Tastatur-Pan (`update(dtMs, axisX, axisY)`, Tempo = 1,1 × Zoomdistanz pro s, Diagonale normiert, dt auf 100 ms gekappt), Mittelmaus-Drag (`panPixels`, Boden folgt dem Cursor), Mausrad-Zoom zum Cursor (`zoomAt`, Faktor 1,15 je Raste, der Bodenpunkt unter dem Cursor bleibt stehen), Klemmung des Fokuspunkts auf die Karte, `centerOnMap`, `focusRaw`, `state()` (Plain Object in WU). Unabhängig von Sim und Pause. |
| `src/input.ts` | `InputController(surface, keyTarget, {onAction, onDragBox, focusProbe})`: Actions `pan`, `zoom`, `boxSelect` (Linksdrag ab 4 px, Rechteck normiert), `clickSelect` (Linksklick ohne Drag), `selectAll` (Strg/Cmd+A), `moveCommand` (Rechtsklick, mit `event.timeStamp`, Shift = Queue), `stop` (S antippen), `togglePause` (P/Pause), `toggleConsole` (^ / ` / F1, `event.code === 'Backquote'` deckt die deutsche ^-Taste ab), `stepOnce` (N). WASD/Pfeiltasten als gehaltene Pan-Achsen (`panAxisX/Y(now)`, allokationsfrei). Kontextmenü und Mittelklick-Autoscroll auf dem Canvas unterdrückt, Pointer-Capture beim Drag, `blur` löst alle Tasten. **Fokusregel:** Ist ein Texteingabefeld fokussiert (input außer button/checkbox/radio/range/…, textarea, select, contenteditable – per `focusProbe` oder `event.target`), entstehen keine Spiel-Actions und gehaltene Pan-Tasten werden gelöst; nur `toggleConsole` geht durch (Konsole lässt sich aus ihrer eigenen Eingabezeile schließen, das Zeichen wird per `preventDefault` nicht getippt). |
| `src/selection.ts` | `Selection`: Modus `allOwn` (Standard: alle eigenen Einheiten, ohne Highlight) oder `explicit`. `boxSelect`/`clickSelect` über die **interpolierten, per CPU projizierten** Positionen (gleiche Formel wie der Shader inkl. `noInterp`), Klickradius 14 px, Shift = additiv, Klick ins Leere = leere Selektion, `selectAll` zurück zu `allOwn`. Ausgabe pro Frame: `handles`/`indices` (Frame-Reihenfolge, `count`), `highlight` (u8 je UnitRecord) + `highlightVersion`. Verschwundene Einheiten werden beim nächsten Frame aus der Selektion entfernt. Nicht selektierbar: fremde Armies, Wrack/Ghost/Blip. Helfer `isOwnUnit`, `interpolatedPos`. |
| `src/commands.ts` | `CommandBuilder(sink, army)` über `CommandBatchEncoder`: `move(units, x, y, z, queue)`, `stop(units)`, `spawn(bp, count, army, x, z, spread)` (Cheat/Spawn), `kill(units)` (Cheat/Kill). Ein Batch pro Command (Tick 0, `toArrayBuffer()` ⇒ transferierbar). `seq` u16 ab 1 fortlaufend, beim Umlauf wird 0 übersprungen. Buchführung offener seqs (Ring, 256), `acknowledge(ackSeq, now)` bestätigt alle seq ≤ ackSeq (u16-Serienarithmetik, `seqAcked`), Listener `onAck(seq, op, latencyMs, ackMs)`. |
| `src/frames.ts` | `FrameStream(consumer)`: `poll(now)` einmal pro rAF (Copy-on-Arrival macht bereits der Transport – **keine zweite Kopie**), `FrameReader` auf dem View, Kopf-Felder (tick, paused, speed, ackSeq), Ankunftszeiten, übersprungene Ticks, `units()` (gecachter View auf die UnitRecord-Sektion), `alpha(now)` mit adaptivem Render-Delay (siehe unten). Korrupter Frame ⇒ verworfen, `hasFrame = false`. |
| `src/metrics.ts` | `RingStats` (Ring, p50/p95/p99, `summary()`), `ClientMetrics`: Messkette SPK6, Main-JS pro rAF, rAF-Intervall/FPS, `snapshot()` als Plain Object (structuredClone-fähig) inkl. Live-Werten des Frame-Streams. |
| `src/client.ts` | `GameClient({canvas, renderer, link, visuals, playerArmy, keyTarget?, camera?, bounds?, callbacks?, raf?, now?, focusProbe?, frameStream?})`. Pro rAF: Tastatur-Pan → `poll` (ack, Selektion/Highlight, Wegpunktlinien) → `alpha` → `renderer.render` (UnitRecords direkt aus den Frame-Bytes, `units.version` = Frame-Zähler, Highlight, Overlays) → Metriken. Rechtsklick: Picking, Move-Command, **Klickmarker sofort** (im nächsten rAF gezeichnet), Wegpunktlinie vom angezeigten Gruppenschwerpunkt zum Ziel **bis zur seq-Bestätigung**. Pause: Tick steht, Kamera/Selektion/Command-Senden laufen weiter, alpha = 1. |
| `src/index.ts` | Öffentliche API (alles Obige). |

### API für apps/game (P7)

```ts
const client = new GameClient({
  canvas,                         // HTMLCanvasElement (Maus-Input, CSS-Größe)
  renderer,                       // createRenderer(canvas) aus @faf/render (RendererLike genügt)
  link,                           // Worker-SimLink (sendCommands/sendCtl/frames/onHostMessage)
  visuals,                        // VisualTable aus view.json (Index = UnitRecord.visual) → renderer.setVisuals
  playerArmy: 0,
  callbacks: { onToggleConsole, onDragBox, onSelectionChange, onHostMessage, onFrame, onAction },
});
client.start();                   // rAF-Schleife; dispose() beendet sie und löst alle Listener
client.tick / client.paused / client.speed / client.lastFrame (FrameReader | null) / client.selection
client.sendCtl(msg); client.togglePause(); client.step(n) /* nur in Pause */; client.setSpeed(x)
client.spawn(bp, count, army, xRaw, zRaw, spreadRaw); client.kill(handles?)   // Dev-Konsole (Cheats als Commands)
client.moveTo(xRaw, zRaw, handles?)   // programmatischer Move mit Marker/Linie/Messung (E2E sendMove)
client.ownHandles(); client.unitScreenPos(handle); client.cameraState(); client.metrics.snapshot()
```

- Pausenzustand ist autoritativ der Frame-Header (`paused`-Bit). `togglePause` merkt sich den angeforderten
  Zustand, bis ein Frame ihn bestätigt (max. 1 s), damit Doppeldrücke korrekt abwechseln.
- `step()`/Taste N werden nur gesendet, wenn pausiert (bzw. Pause angefordert) ist.
- `stop()` hält die rAF-Schleife an, ohne Listener zu lösen; `dispose()` räumt vollständig auf (Renderer und Link
  gehören dem Aufrufer).

### Vertrag an Host/Sim (P3/P5)

- `FrameHeader.ackSeq` = höchste angewendete seq der Viewer- bzw. Spieler-Army; Vergleich im Client nur über die
  unteren 16 Bit mit Serienarithmetik. seq 0 wird nie vergeben.
- Beim Pausieren sollte der Host sofort einen Frame mit gesetztem `paused`-Bit schreiben (sonst läuft die
  Anzeige-Uhr bis alpha = 1 aus und bleibt dort – optisch identisch, nur ohne Pausenanzeige).
- `speedPermille` im Header bestimmt die Tick-Dauer der Interpolation (100 ms / speed).

## Adaptiver Render-Delay (frames.ts)

Jeder Frame n trägt prev = P(tₙ − 1) und cur = P(tₙ). Angezeigt wird über eine kontinuierliche Uhr `play`
(in Ticks): alpha = clamp(play − (tₙ − 1), 0, 1). Die Uhr läuft mit der Wandzeit (T = 100 ms / speed aus dem
Header) und wird weich (Zeitkonstante 200 ms) auf

  target(now) = tₙ + (now − Ankunftₙ)/T − ½ − delay/T

gesteuert, mit delay = 0,5 · T + Jitter, Jitter = p90(|Intervall − T|) der letzten 32 Ankunftsintervalle (je
Tick normiert, auf 0,5 T gekappt). Bei delay = 0,5 T steht die Anzeige bei Ankunft einen Tick hinter cur und
erreicht cur, wenn der nächste Frame fällig ist – mittlerer Abstand zum neuesten Frame ≈ ½ Tick (Planziel).
Fehler > 1,5 Ticks (Hintergrund-Tab, Pause-Ende, Diskontinuität) ⇒ Uhr springt (`snaps`). Pause ⇒ alpha = 1
eingefroren. `noInterp` erledigt der Shader. Gemessen mit dem FakeSimLink (60-Hz-rAF, 10 s): 1x speed mittlerer
Abstand 0,59 Tick, 0 % Stillstände, 0 Snaps; 3x speed 0,75 Tick (Ankunft auf 2-rAF-Raster), 0 % Stillstände.

## Messkette SPK6 (metrics.ts) – Definitionen

| Kennzahl | Definition |
|---|---|
| Klick-Zeitstempel | `event.timeStamp` des `pointerdown` (gleicher Zeitursprung wie `performance.now()`), sonst `performance.now()` |
| Klickmarker | Zeit bis zum Ende des **ersten gerenderten rAF nach dem Klick** (`clickToMarkerMs`) und Anzahl der rAFs (`clickToMarkerFrames`, Gate ≤ 1). Der Marker wird im Event-Handler angelegt, also immer im nächsten rAF gezeichnet. |
| seq-Bestätigung | Zeit bis zum `poll()` des ersten Frames mit `ackSeq ≥ seq` (`clickToAckMs`). Ankunft = Poll-Zeitpunkt, d. h. auf das rAF-Raster quantisiert. |
| Erster bewegter Pixel | Erster rAF, in dem die interpolierte Position einer befohlenen Einheit – mit der Kamera dieses rAF projiziert – um ≥ 1 CSS-Pixel von ihrer (ebenso projizierten) Position zum Klickzeitpunkt abweicht (`clickToMoveMs`). Beide Punkte werden mit der aktuellen Kamera projiziert ⇒ Kamerabewegung verfälscht die Messung nicht. Stichprobe: bis zu 8 befohlene Einheiten, die zum Klickzeitpunkt stillstehen (prev = cur); stehen alle schon in Bewegung, zählt der Klick in `movingAtClick` und nicht in die Verteilung. Timeout 5 s (`timeouts`). |
| Main-JS | Dauer des gesamten rAF-Callbacks (`performance.now()` Anfang → Ende, inkl. `renderer.render`) (`mainJsMs`) |
| FPS | 1000 / mittleres rAF-Intervall der letzten 1.024 rAFs (`fps`, `rafIntervalMs`) |

Alle Verteilungen: Ring der letzten 1.024 Werte, `{count, mean, min, max, p50, p95, p99}`. `snapshot().frame`
liefert zusätzlich tick, paused, speed, frames, skippedTicks, invalidFrames, renderDelayMs, jitterMs, alpha,
clockSnaps, units, pendingCommands, lastSeq, ackSeq. `metrics.reset()` leert alles (E2E-Phasen).

## Tests (`pnpm vitest run packages/client`, Node, Fake-Renderer/-Link/-Events) – 10 Dateien, 63 Tests grün

| Datei | Inhalt |
|---|---|
| `test/support/fake-sim-link.ts` | `FakeSimLink`: Würfelwelt, wendet Batches im nächsten Tick an (Move, Stop, Cheat Spawn/Kill), schreibt echte Frames per protocol-`FrameWriter` (ackSeq, paused-Bit, speed, prev/cur, `noInterp` bei Spawn, Idle-Flag), respektiert Pause/Step/Speed; Copy-on-Arrival-Consumer. |
| `test/support/fakes.ts` | Event-Targets mit Dispatch, Fake-Canvas, synthetische Pointer-/Wheel-/Key-Events, allokationsfreier manueller rAF, aufzeichnender Renderer, manuelle Uhr. |
| `constants.test.ts` | render `UNIT_INSTANCE_*` == protocol `UNIT_OFF_*` (alle 14 Offsets, Stride 48), `UNIT_FLAG_NO_INTERP` == `UnitFlags.NoInterp`; FrameWriter-Record == render-`UnitRecordWriter`-Bytes. |
| `picking.test.ts` | Strahl ∩ Ebene exakt (Treffer liegt auf Strahl und Ebene), project → pick ≤ 1/16 WU in 3 Kameralagen, Klemmung an den Kartenrand, Horizont-Fehlschlag, Helfer. |
| `camera-controller.test.ts` | Pan-Richtung/-Tempo ∝ Distanz, dt-Kappung, Diagonale, Klemmung, Drag-Pan, Zoom zum Cursor (Bodenpunkt bleibt auf 1e-6 WU), Zoomgrenzen. |
| `input.test.ts` | Alle Actions inkl. Koordinaten relativ zum Canvas, Drag-Schwelle/-Feedback, Kontextmenü unterdrückt, Wheel-Normierung, Strg/Cmd+A, P/Pause/N, ^/`/F1, S tippen vs. halten, **Fokusregel** (inkl. Lösen gehaltener Tasten, Event-Target), `dispose`. |
| `commands.test.ts` | Bytes per `decodeBatch`-Roundtrip (Move inkl. Queue-Flag, Stop, Cheat Spawn/Kill), Validierung, seq-Umlauf (0 übersprungen), `seqAcked` mit Umlauf, Ack-Buchführung inkl. Latenz/Listener/Überlauf. |
| `frames.test.ts` | Gleichmäßige Ankünfte: monoton, Stillstände < 10 %, mittlerer Abstand ≈ delay; Pause ⇒ alpha = 1 eingefroren, Step in Pause, Resume; Speed 2x/0,5x ⇒ T 50/200 ms; Jitter-Puffer 30 ms bei 70/130-ms-Intervallen, Kappung 0,5 T; übersprungene Ticks; gecachter Units-View; korrupte Frames. |
| `selection.test.ts` | Standard alle eigenen (ohne Highlight), Box-Select == Brute-Force-Projektion, Box-Select auf interpolierten Positionen, Klick-Select (Radius, Shift, leer, fremde Army), Pruning getöteter Einheiten, Helfer. |
| `metrics.test.ts` | RingStats-Perzentile; synthetische Zeitachse: Marker 1 Frame/12 ms, Ack 55 ms, erster bewegter Pixel 79 ms; kameraunabhängig; bereits fahrende Einheiten ausgeschlossen; Timeout; Snapshot structuredClone-/JSON-fähig. |
| `client.test.ts` | Integration mit FakeSimLink (1.000 + 20 Würfel): Rendern direkt aus den Frame-Bytes; Rechtsklick ⇒ Marker im nächsten rAF, Linie bis Ack, Einheiten fahren, Metriken; **Pause** (Tick steht 1,5 s, Kamera fährt per Taste, Command wird angenommen und nach Step angewendet, Resume); N nur in Pause; Box-Select-Highlight, S-Stop, Strg+A; Zoom/Drag in Pause; Dev-Konsolen-API (Spawn/Kill); E2E-Helfer; Fokusregel; `dispose`; **Allokation**. |
| `types.test.ts` | Compile-Zeit: render-`Renderer` → `RendererLike`, `HTMLCanvasElement` → `ClientCanvas`, `Window`/`Document` → `InputEventTarget` ohne Casts. |

### Messwerte (Node 24, Apple M5 Pro, FakeSimLink, Fake-Renderer)

- **Allokation im Normalpfad:** nach JIT-Aufwärmen 600 rAFs (10 s, 100 Frames à 1.020 Records, laufende Messung)
  ohne einen einzigen GC; ≈ 142 B pro rAF inklusive Fake-Sim und Test-Harness – das sind nur noch V8-interne
  HeapNumber-Boxen von Double-Rückgabewerten, keine Objekte/Arrays. Test-Gate: < 256 B/rAF, 0 GCs, < 64 KB
  bleibendes Wachstum.
- **Client-JS pro rAF (ohne WebGL-Renderer):** Mittel 0,7 µs, p95 2,2 µs, max 87 µs bei 1.020 Einheiten
  (Frame-Ankunft inkl. Selektions-/Highlight-Neuaufbau). Die Main-JS-Budgets im Browser (≤ 2 ms) dominiert damit
  `renderer.render` (P2: p95 ≈ 0,1 ms).
- Latenz/FPS im Browser misst P7 über `metrics.snapshot()` (E2E, SPK6).

Selbsttest: `pnpm vitest run packages/client` (63/63 grün), `pnpm typecheck` grün, `eslint --max-warnings 0`
für `packages/client` grün, dependency-cruiser ohne Verstöße. `pnpm lint` meldet weiterhin nur die bekannten
Fehler in `.claude/workflows/faf-milestone.js` (Orchestrator-Skript, nicht Projektcode; `eslint . --ignore-pattern
'.claude/**'` ist grün).

## Abweichungen (mit Begründung)

1. **`tsconfig`-Referenzen auf `rules`/`blueprints` entfernt:** Der Client importiert in MS1 nur protocol, render
   und fixed; so hängt `tsc -b` für den Client nicht von P3s parallel entstehendem Code ab. Die
   `package.json`-Abhängigkeiten bleiben (Lockfile gehört P3). Wer später rules/blueprints im Client nutzt, ergänzt
   die Referenzen wieder.
2. **S = Stop *und* Pan-Taste (WASD):** Beides verlangt die Aufgabe. Auflösung Tippen vs. Halten: Loslassen innerhalb
   180 ms ⇒ `stop`, länger gehalten ⇒ Pan rückwärts ohne Stop (Pan beginnt erst nach 180 ms). Stop feuert deshalb beim
   Loslassen, nicht beim Drücken.
3. **Implizite Selektion ohne Highlight:** Im Standardmodus „alle eigenen“ würde sonst jeder der 1.000 Würfel
   dauerhaft leuchten; `selection.highlightImplicit = true` schaltet es ein.
4. **Klick ins Leere leert die Selektion** (FA-Verhalten); danach wirken Rechtsklicks erst wieder nach Auswahl oder
   Strg+A.
5. **Wegpunktlinie** als eine Linie vom angezeigten Gruppenschwerpunkt (zum Klickzeitpunkt) zum Ziel statt je
   Einheit (1.000 Linien wären unlesbar); sie verschwindet mit der seq-Bestätigung.
6. **Render-Delay** mit nur einem Frame (prev/cur) im Speicher: Der Jitter-Puffer verschiebt die Anzeige-Uhr, alte
   Frames werden nicht vorgehalten (das würde eine zweite Kopie erfordern, die die Aufgabe ausschließt). Kommt ein
   Frame früher als die Uhr, springt die Anzeige um diesen Bruchteil vor statt zurück; im eingeschwungenen Zustand
   läuft die Anzeige nie rückwärts (Test). Nur ein Uhr-Snap (> 1,5 Ticks Fehler) kann zurückspringen.
7. **„Erster bewegter Pixel“ in CSS-Pixeln** (nicht Device-Pixeln) und nur für stillstehende Einheiten (siehe
   Messkette) – die E2E-Messung braucht also Klicks auf ruhende Gruppen (z. B. nach Ankunft oder Stop).
8. **Ack-Zeitpunkt = Poll-Zeitpunkt** (rAF-Raster): Der Transport liefert keine Ankunftszeit; der Fehler ist ≤ 1
   rAF und wirkt konservativ.

## Bekannte Grenzen

- Nur Ebenen-Picking (y = 0) – Heightmap-Raymarch folgt mit dem Terrain (MS2). Einheiten-Picking für Angriffsziele
  folgt mit C1/C4.
- Keine Kamerarotation per Eingabe (render-Kamera kann es, MS2), keine Kanten-Pan am Bildschirmrand.
- Maus-Chords (z. B. Rechtsklick während eines Linksdrags) werden nicht ausgewertet.
- Keine Preact-UI, Minimap, Audio, Settings, i18n (spätere Meilensteine); HUD/Konsole baut apps/game.
- Die `FrameStream`-Uhr kennt nur die Header-Geschwindigkeit; wenn die Sim hinterherhinkt (Sim-Lag), wird das über
  den Jitter-Puffer (≤ 0,5 Tick) und Clamping aufgefangen, nicht über eine gemessene Tick-Rate.
