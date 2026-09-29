# P2-render – WebGL2-RHI, Instancing, GPU-Interpolation, Testebene, Overlays, Context-Loss (MS1, Welle 1)

Feature-IDs: **S1** (Instancing ≥ 1.000 Würfel, GPU-Interpolation), **P1** (eigene WebGL2-Pipeline hinter RHI),
Vorgriff **P10** (Context-Loss-Registry), G14 (UnitRecord = Instanzdaten).

Fortsetzung eines abgebrochenen Laufs: Der vorhandene Teil-Code (RHI-Typen, WebGL2-Backend, Registry,
std140, Kamera, Instanz-Layout, Placeholder-Meshes, Unit-/Ground-/Overlay-Pass) wurde geprüft und übernommen;
der Typfehler in `instance-layout.ts` (`Uint32Array<ArrayBufferLike>`-Feld für SAB-/ArrayBuffer-Quellen) ist
behoben. Neu: `renderer.ts`, `index.ts`, alle Tests, Demo, Smoke-Skript, Vertex-Stream der Testebene.

## Umgesetzt

| Datei | Inhalt |
|---|---|
| `src/rhi/types.ts` | `GpuDevice` im WebGPU-Stil (§3.7): `createBuffer/writeBuffer` (WebGPU-Semantik: `srcOffset/size` in Elementen), `createTexture/writeTexture`, `createPipeline` (Streams mit `stepMode vertex|instance`, `stride`, Attribute `u8/i8/u16/i16/u32/i32/f32 × 1–4` als `int` (uint/sint), `norm` (unorm/snorm) oder `float`), `createBindGroup` (UBO-Slots, Textur-Units), `beginPass(PassDesc) → PassEncoder {setPipeline, setBindGroup, setVertexStreams, setIndexBuffer, drawIndexedInstanced, drawInstanced, multiDrawIndexedInstanced?, end}`, `beginFrame/endFrame/gpuTimeMs`, `isLost/onLost/onRestored`, `checkErrors`. Handles sind gebrandete Zahlen, keine WebGL-Typen im Interface. |
| `src/webgl2/device.ts` | Backend: VAO-Cache pro Pipeline + gebundener Buffer-Menge (nur geänderte Stream-Offsets werden per `vertexAttrib[I]Pointer` umgehängt – Ring-Regionen/Visual-Buckets erzeugen keine neuen VAOs), State-Cache (Programm, VAO, Depth/Cull/Blend/FrontFace, UBO-Ranges, Texturen, Viewport), `vertexAttribIPointer` für Integer-Attribute, `vertexAttribDivisor(loc, 1)` für Instanz-Streams, std140-UBOs über `bindBufferRange`, Shader-Compile-/Link-Fehler mit Info-Log und nummeriertem Quelltext, Stream-Validierung (Stride 1–255, Ausrichtung, Überlappung, Location-Duplikate), Index-Buffer werden zuerst an `ELEMENT_ARRAY_BUFFER` gebunden (WebGL-Buffer-Typregel), optional `EXT_disjoint_timer_query_webgl2` (Query-Pool, Disjoint-Prüfung) und `WEBGL_multi_draw`, `debugLoseContext/debugRestoreContext` über `WEBGL_lose_context`. |
| `src/webgl2/registry.ts` | `ContextLossRegistry`: jede Ressource mit Deskriptor registriert (`realize/release/restore`). `webglcontextlost` → `preventDefault()`, alle Backend-Objekte vergessen, `lost = true`, alle Aufrufe sind No-ops. `webglcontextrestored` → State-Caches zurücksetzen, Caps/Extensions neu abfragen, **erst alle** Ressourcen in Registrierungsreihenfolge neu anlegen, **dann** Upload-Callbacks (`BufferDesc.restore`/`TexDesc.restore`) ausführen, danach `onRestored`-Listener. |
| `src/std140.ts` | `std140Layout(fields)` (Skalare 4, vec2 8, vec3/vec4 16, Arrays Stride 16 und 16-ausgerichtet, mat3 = 3 × 16 B, mat4 64 B, Blockgröße auf 16) und `Std140Writer` (mat4/mat3/vec2–4/ivec4/uvec4/float/int/uint, Arrays für float/int/uint/vec4/ivec4/mat4; allokationsfrei). |
| `src/camera.ts` | `RtsCamera` (gl-matrix): Fokuspunkt in Q20.12-Rohwerten, Augposition aufgeteilt in `camPosInt` (Int32Array, exakter Ganzzahlteil) + `camFrac` (WU-Rest < 1/4096); View/Proj kamera-relativ (Ursprung = `camPosInt`), dynamische Near-Plane aus der Kamerahöhe, Far aus Neigung/FOV; `project(xRaw, yRaw, zRaw, out)` (CSS-Pixel, gleiche Reihenfolge wie der Shader: erst Integer-Differenz, dann Skalierung), `screenToRay(x, y, out?) → {origin (WU, float64), dir}`, `intersectGround(ray, heightWU, out)`; `pan/zoom/rotate`, Versionszähler, Neuberechnung nur bei Änderung. |
| `src/instance-layout.ts` | `UNIT_INSTANCE_STRIDE = 48`, `UNIT_INSTANCE_OFF_*` (0 prevPos, 12 curPos, 24 prevYaw, 26 curYaw, 28 visual, 30 army, 31 hp, 32 build, 33 bank, 34 flags, 36 handle, 40 partBase, 44 partCount, 45 reserved), `UNIT_FLAG_NO_INTERP = 1 << 10`; `UnitRecordWriter` (Tests/Demo); `VisualBuckets` (stabiler Counting-Sort nach `visual` in einen Staging-Puffer, 32-Bit-Wortkopie bei ausgerichteter Quelle, Byte-Pfad sonst, Highlight-Bytes mitsortiert, Visuals ≥ Tabellengröße werden gezählt und verworfen, wächst nur bei Bedarf). |
| `src/mesh/placeholder.ts` | `createPlaceholderMesh({hull: 'box'|'cyl', size, color?})` → Positionen/Normalen/`partIds`/Indizes/Bounds; Box 24 V/36 I, Zylinder 16 Segmente = 66 V/192 I; Ursprung Mitte Grundfläche, vorne = +x (Ang16 0), CCW von außen. |
| `src/passes/shared.ts` | UBO-Blöcke `Frame` (viewProj, camPosInt, camFrac + alpha, camMod = camPosInt mod 32 WU + Zeit, Sonne, Hemisphere, Fog, Viewport) und `Palette` (16 Army-Farben, 256 Visual-Grundfarben mit Gewicht) als GLSL + std140-Layout nebeneinander. |
| `src/passes/units.ts` | `UnitPass`: alle Visual-Meshes in einem VBO/IBO (Vertex 20 B: pos f32×3, Normale snorm8×4, partId u8), **ein Draw pro Visual** über Stream-Offsets in einen **Instanz-Ring mit 3 Regionen** (UnitRecords unverändert, 48 B) plus zweiter Instanz-Stream Highlight (u8, Stride 4). VS: `relPrev/relCur = vec3(ivec3(pos) − camPosInt) / 4096.0`, `mix(prev, cur, alpha)`, Yaw auf dem kürzesten 16-Bit-Bogen, `noInterp` ⇒ cur. Albedo = mix(Army-Farbe, Visual-Farbe, Gewicht), Lambert-Sonne + Hemisphere, Selektions-Rim mit Puls, Distanz-Fog. Neu sortiert/hochgeladen wird nur bei neuer `units.version`/`highlightVersion` oder nach Restore. |
| `src/passes/ground.ts` | Feste Testebene y = 0 (Standard 512 × 512 WU, Ursprung/Größe/Höhe/Farben konfigurierbar), Ecken als Integer-Rohwerte (kamera-relativ exakt), prozedurales Gitter 1/8/32 WU im FS (fwidth-AA, Ausblendung bei Dichte), Kartenrand. Gitterkoordinate = `rel + camMod`, bleibt auch bei 2²⁶ Rohwert klein. |
| `src/passes/overlay.ts` | Klickmarker (expandierender Ring + Punkt, Startzeit, Dauer, Farbe, Radius) und Wegpunktlinien (Segmente als Bänder mit laufenden Strichen), je **ein instanzierter Draw**, 3-Regionen-Ringe, abgelaufene Marker werden übersprungen. |
| `src/renderer.ts` | `createRenderer(canvas, {renderScale?, pixelRatio?, ground?, armyColors?, clearColor?, device?})` → `{device, stats, resize(), setVisuals(table), setArmyColors(), configureGround(), render(view), dispose()}`. Feste Passes Ground → Units → Overlay. `ResizeObserver` markiert Größenänderungen, `render()` passt Canvas und Kamera-Viewport an. |
| `src/index.ts` | Öffentliche API (alles Obige). |

### API für Folgepakete (client, game)

```ts
const r = createRenderer(canvas, { renderScale: 1 });
r.setVisuals([{ spec: { hull: 'box', size: [1, 1, 1] }, color: 0x808080, baseWeight: 0.3 }, …]); // Index = visual
r.render({
  camera,                                   // RtsCamera (client steuert pan/zoom/rotate)
  units: { bytes, count, version: seq },    // UnitRecord-Bytes des Frames (48 B), unverändert
  highlight, highlightVersion,              // u8 je Record in Frame-Reihenfolge (optional)
  alpha,                                    // 0..1 prev → cur
  overlays: { markers, lines },             // Rohwerte Q20.12, Marker mit startMs
  timeMs: performance.now(),
});
r.stats // { drawCalls, instances, uploadBytes, cpuMs, gpuMs?, visualsDrawn, droppedUnits, frames, lost }
```

- `VisualTable` ist ein Array (Map-frei), Lücken (`undefined`/`null`) werden als kleiner grauer Fallback-Würfel gezeichnet.
  Ohne `color` (und ohne `spec.color`) = reine Teamfarbe; mit Farbe Standardgewicht 0,3.
- `units.version` gleich ⇒ kein Re-Sort/Upload (nur Frame-UBO). `version` weglassen ⇒ Upload jeden Frame.
  Wer den Inhalt von `bytes` in-place ändert, muss die Version erhöhen. Gleiches gilt für `highlightVersion`
  (weglassen ⇒ Upload jeden Frame, solange `highlight` gesetzt ist).
- Picking (client): `camera.screenToRay(x, y, ray)` + `intersectGround(ray, 0, out)`; Box-Select: `camera.project(...)`.
- `FIXED_PASS_DRAWS = 3` (Ground, Linien, Marker) → Draw-Calls ≤ aktive Visuals + 3.
- Konstanten-Gleichheit mit `@faf/protocol` prüft der client-Test (render importiert protocol nicht).

## Tests (`pnpm vitest run packages/render`, Node ohne GPU) – 6 Dateien, 37 Tests grün

| Datei | Inhalt |
|---|---|
| `test/std140.test.ts` | Ausrichtungsregeln (vec3-Tail, Arrays Stride 16, mat3/mat4, Blockgröße), Fehlerfälle, Writer-Offsets für alle Typen, Frame-/Palette-Layout passt zum GLSL. |
| `test/camera.test.ts` | Projektion des Fokuspunkts in die Bildmitte, Achsenrichtungen, Punkt hinter der Kamera; exakter Int-Split bis ±2²⁶ Rohwert; gleiche Bildschirmposition bei Verschiebung um 2²⁶ (< 1e-6 px); `screenToRay` trifft y = 0 am Fokuspunkt und invertiert `project` (< 1e-4 WU, auch bei 2²⁶); dynamische Near-Plane; Caching/Clamping; Pan-Richtung. |
| `test/placeholder.test.ts` | Box 24/36, Zylinder 66/192, Bounds, normierte Normalen, partId 0, CCW-Winding nach außen; `mergeMeshes` (Interleaving, vorversetzte Indizes). |
| `test/instance-layout.test.ts` | Offsets = PLAN §3.6, `UnitRecordWriter` Byte-genau (LE, i8 bank, u32 handle), `advance`; Bucket-Sort stabil, Zählung/Starts, Drop unbekannter Visuals, Highlight-Mitnahme, ausgerichtete und unausgerichtete Quelle, keine Neuallokation im Dauerbetrieb. |
| `test/webgl2-device.test.ts` | Aufzeichnender Fake-WebGL2-Kontext (`test/support/fake-gl.ts`, Proxy): Integer-Attribute per `vertexAttribIPointer` mit Stride 48 und Offsets 0/12/24/28 (+ Ring-Basis), Divisor 1 für Instanz-Streams und 0 für Mesh-Stream, Highlight-Stream Stride 4, partId als Integer, Normale snorm; ein Draw pro Visual mit korrektem Bucket-Offset; unveränderte Version ⇒ nur Frame-UBO-Upload, keine VAO-Neuanlage, redundante `useProgram` gefiltert; Overlays je ein Draw; Shader-Fehler mit Log + nummeriertem Quelltext; Stream-Validierung; `WEBGL_multi_draw` + Timer-Query; Resize (CSS × DPR × renderScale). |
| `test/context-loss.test.ts` | Registry: `preventDefault`, Release bei Loss, Realize aller (auch während Loss registrierter) Ressourcen vor allen Upload-Callbacks, Listener, Dispose entfernt Event-Listener; Device: No-ops während Loss, Neuanlage in neuer Kontext-Generation, Restore-Callbacks schreiben Inhalte, State-Cache zurückgesetzt; Renderer: überspringt Frames während Loss, lädt danach den Instanz-Ring trotz gleicher Version neu. |

## Browser-Smoke (`pnpm --filter @faf/render smoke`)

`scripts/smoke.ts` (tsx): Typecheck der Demo (`demo/tsconfig.json`), `vite build` nach `packages/render/dist/demo`
(dist-Muster, von Git/ESLint/dep-cruiser/Vitest ignoriert), kurzlebiger `node:http`-Server auf freiem Port (mit
COOP/COEP, damit Firefox/WebKit `performance.now()` feiner als 1 ms auflösen), dann **nacheinander** Chromium,
Firefox, WebKit headless über die Playwright-Library (Launch-Flags wie Root-Config inkl. Firefox-
`CFFIXED_USER_HOME`). Geprüft: keine Konsolen-/Page-/GL-Fehler (auch WebGL-Warnungen), Draw-Calls ≤ Visuals + 3,
alle Instanzen gezeichnet, Screenshot dekodiert (eigener PNG-Decoder) → ≥ 24 Farben, keine Farbe > 90 %, beide
Army-Farben sichtbar; danach Context-Loss per `WEBGL_lose_context` → Restore → Bild wieder da, keine GL-Fehler.
Browser und Server werden in `finally` geschlossen. Ergebnis zusätzlich in `test-results/render-smoke.json`.
Optionen: `--browsers=…`, `--n=…`, `--no-build`, `--headed`.

Demo (`demo/index.html`, `demo/main.ts`; manuell `pnpm --filter @faf/render demo`, danach beenden): 1.000 Einheiten
(3 Visuals: Würfel, Zylinder, flacher Quader) auf Kreisbahnen, zwei Armies (blau/rot), synthetischer 10-Hz-Tick,
GPU-Interpolation mit alpha, alle 5 s „Respawns“ mit `noInterp`, jede 10. Einheit hervorgehoben, Rechtsklick =
Klickmarker + Wegpunktlinien (Ebenen-Picking über `screenToRay`), automatische Marker, Patrouillen-Linien,
WASD/Q/E/R/F/Mausrad, HUD mit FPS/Draws/Render-JS/GPU.

### Messwerte (lokal gemessen, Apple M5 Pro, headless, 1280 × 720, 1.000 Einheiten, kein GPU-Runner – DECISIONS 5)

| Browser | Renderer | Draws | Render-JS mean / p50 / p95 / max (ms) | Frame-JS p95 (ms) | FPS | GPU (ms) | multi_draw / Timer | Context-Loss |
|---|---|---|---|---|---|---|---|---|
| Chromium 153 | ANGLE Metal, Apple M5 Pro | 6 (3 Visuals + 3) | 0,073 / 0,070 / 0,090 / 0,335 | 0,135 | 60 (vsync) | 0,32 | ja / ja | ok |
| Firefox 155 | „Apple M1, or similar“ | 6 | 0,099 / 0,080 / 0,160 / 0,920 | 0,220 | 120 | n/a | nein / nein | ok |
| WebKit 26.6 | Apple GPU | 6 | 0,087 / 0,080 / 0,120 / 0,180 | 0,200 | 60 | n/a | ja / nein | ok |

- Render-JS = `renderer.render()` inkl. Bucket-Sort + Upload in Tick-Frames; Frame-JS = gesamter rAF-Callback der
  Demo inkl. synthetischem Tick. Budget ≤ 2 ms pro Frame: **Faktor > 9 Reserve** (p95).
- Timer-Auflösung mit COOP/COEP: Chromium 5 µs, Firefox/WebKit 20 µs.
- Zusatzmessung Chromium mit 10.000 Einheiten: Render-JS p95 0,155 ms, GPU 0,45 ms, 60 FPS.
- Hinweis: In einem ersten Lauf (kalter Browser-Cache) lag Chromium headless kurzzeitig bei 44 FPS mit
  GPU ≈ 9,9 ms; in allen Folgeläufen stabil 60 FPS / 0,3 ms. FPS-Werte gelten nur für diese Maschine.

## Abweichungen (mit Begründung)

1. **Kein Import von `@faf/protocol`** (Vorgabe, P1 parallel): Layout als eigene Konstanten gespiegelt. Die
   `references`-Kante `render → protocol` in `packages/render/tsconfig.json` wurde entfernt, damit `tsc -b` für
   render nicht von halbfertigem protocol-Code abhängt; die `package.json`-Abhängigkeit bleibt (Lockfile gehört P1).
   Wer später aus render protocol importiert, ergänzt die Referenz wieder.
2. **multiDraw im UnitPass nicht genutzt:** `WEBGL_multi_draw` kennt keine Base-Instance; jedes Visual braucht
   aber einen eigenen Instanzbereich. Der UnitPass hängt daher pro Visual die Stream-Offsets im gecachten VAO um
   (ein Draw pro Visual, wie §3.7 verlangt). Die RHI bietet `multiDrawIndexedInstanced` trotzdem an (getestet);
   sinnvoll erst mit `WEBGL_draw_instanced_base_vertex_base_instance` bzw. im WebGPU-Backend.
3. **Merged-Part:** Das Vertexformat trägt `partId` (u8), der VS wertet in MS1 nur Part 0 aus; der PartStream
   (`partBase/partCount`, 8 B pro Part) wird **noch nicht** gelesen – Teile ≠ 0 bekommen nur eine leicht dunklere
   Albedo und dieselbe Hull-Transformation.
4. **Testebene mit Vertex-Stream statt reinem `gl_VertexID`:** Firefox warnt sonst („Drawing without vertex attrib
   0 array enabled … expensive emulation“). Die Ecken kommen als `u8×2`-Integer-Stream (24 B).
5. **Demo-Ausgabe** in `packages/render/dist/demo` statt `packages/render/demo-dist` (dist-Muster: von Git, ESLint,
   dep-cruiser und Vitest bereits ignoriert, kein Aufräumen nötig). Die Demo wird vom Smoke-Skript typgeprüft
   (`demo/tsconfig.json`), da Root-`typecheck` den Ordner `demo/` nicht erfasst.
6. **Smoke-Server mit COOP/COEP:** nur für feinere Zeitmessung in Firefox/WebKit; der Renderer selbst braucht
   keine Cross-Origin-Isolation (E2E ohne COOP/COEP deckt P7 mit dem Spiel ab).
7. **Vertex-Stride Highlight = 4 B** (statt 1 B): ANGLE/Metal verlangt 4-Byte-ausgerichtete Strides.

## Bekannte Grenzen

- Kein Frustum-Culling/LOD in MS1 (alle Records werden gezeichnet); der Bucket-Sort läuft nur bei neuem Frame.
- Kein Strategic Zoom/IconPass, keine Schatten, kein HDR/Post (spätere Meilensteine).
- GPU-Zeit nur in Chromium (Timer-Query); Firefox/WebKit liefern `gpuMs = undefined`.
- Visual-Tabelle ≤ 256 Einträge (Palette-UBO), Army-Palette 16 Farben.
- Kamera-Mathe ist Float64 (Präsentation, nicht Teil des Determinismus-Vertrags); Picking-Ergebnisse muss der
  client vor dem Senden auf Integer-Rohwerte runden.
- `pnpm lint` schlägt im aktuellen Arbeitsbaum an `.claude/workflows/faf-milestone.js` fehl (Workflow-Skript
  außerhalb des Repos-Codes, nicht in den owns dieses Pakets); `eslint` ohne `.claude/**`, `depcruise` und
  `pnpm typecheck` sind grün.
