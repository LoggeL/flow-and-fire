# ms2-p1-render – RHI-Erweiterungen, CDLOD-Terrain, Wasser, Unit-Culling/LOD/Merged-Part, Presets, Context-Loss (MS2, Welle 0)

Feature-IDs (Render-Anteil): **M1** (Heightmap-Terrain, CDLOD eine Stufe, Auto-Splat), **M2** (Wasserebene),
**M4** (Spot-Decals im Terrain-FS), **P2** (Instanz-Culling, 3 LODs, Merged-Part), **P10** (Context-Loss mit allen
neuen Ressourcen), Preset-Infrastruktur (PLAN §3.7), GPU-Höhensonde für „Höhen auf CPU und GPU identisch“.
Geändert wurde ausschließlich `packages/render/**` (plus dieses Fragment); keine Dependencies, keine Root-Config.
`packages/client` und `apps/game` kompilieren und laufen unverändert (GroundPass bleibt Fallback ohne Terrain).

## Umgesetzt

| Datei | Inhalt |
|---|---|
| `src/rhi/types.ts` | Texturformate `rgba8, r8, rg8, r16ui, r32ui, r32i, rgba16ui, rgba32ui, rgba32i, r32f, rgba16f, rgba32f, depth24, depth32f`; `TexDesc.dimension '2d' \| '2d-array'` + `layers`, `mipLevels`, `compare` (Shadow-Sampler); `writeTexture(h, rect, src, layer?, mip?)`, `generateMipmaps(h)`, synchrones `readTexture(h, rect, out, layer?)` (nur Tests/Debug); `PassDesc.colorAttachments[]/depthAttachment` (Offscreen, MRT, Array-Layer, Mip) mit Viewport = Attachment-Größe; `PipelineDesc.depthBias` (Polygon-Offset) und `colorWrite: false` (Depth-only); `DeviceCaps` um `colorBufferFloat, floatBlend, textureFloatLinear, maxArrayTextureLayers, maxColorAttachments, maxDrawBuffers, maxSamples, maxVertexTextureUnits, maxTextureUnits`; Hilfen `textureChannels/textureKind`. |
| `src/webgl2/device.ts`, `gl-const.ts` | Backend dazu: `texStorage2D/3D`, Mip-Filter, Compare-Mode, `texSubImage3D` je Layer, `rgba16f` nimmt Half- (u16) oder f32-Daten; Framebuffer-Cache je Attachment-Menge (kein Alloc bei Treffer), `drawBuffers`/`readBuffer`, Vollständigkeitsprüfung mit Klartext, typgerechte Clears (`clearBufferfv/iv/uiv`), Float-Targets nur mit `EXT_color_buffer_float` (sonst klarer Fehler), Readback mit den von WebGL2 garantierten Kombinationen (`RGBA_INTEGER/INT|UNSIGNED_INT`, `RGBA/UNSIGNED_BYTE|FLOAT`) und Kanalverdichtung; `destroyTexture` löscht abhängige FBOs; FBO-Cache und State-Caches (Color-Mask, Polygon-Offset, gebundenes FBO, Textur-Target je Unit) werden bei Verlust/Restore verworfen. |
| `src/terrain/heightfield.ts` | `TerrainDesc {sizeWu, dim, heights, heightScaleRaw, waterLevelRaw, splat?, light?}` (strukturell = `formats.mapSimData()`/`rules.Heightfield`, ohne Import), `validateTerrain`, **`sampleTerrainHeightRaw`** (JS-Spiegel der Formel, reine Ganzzahl), `computeChunkBounds` (exakte Min/Max-Höhe je 32×32-WU-Chunk). |
| `src/terrain/glsl.ts` | **`TERRAIN_HEIGHT_GLSL`**: `uniform usampler2D u_heightmap` + Block `TerrainHeight {ivec4 (sizeWu, dim, heightScaleRaw, 0)}`, `uint terrainHeightRawU(ivec2)` / `int terrainHeightRaw(ivec2)` (texelFetch + manuelle Bilinearfilterung, bitgleich zur Sim), `terrainSampleRaw`, `terrainNormal` (Zentraldifferenzen). **`TERRAIN_SPLAT_GLSL`**: `terrainAutoWeights` (Ufer/Sand, Gras, Fels ab Neigung, Hochlage) und `terrainAlbedo(...)` (Auto-Splat + 0/4/8 gemalte Layer, FA-artig nacheinander überblendet; Sampler als Parameter). `generateTerrainAlbedo()` erzeugt 8 kachelbare Layer (128², RGBA8) zur Laufzeit. Konstanten `SLOT_TERRAIN_HEIGHT = 3`, `UNIT_HEIGHTMAP = 0`, `TERRAIN_HEIGHT_LAYOUT`. |
| `src/terrain/patches.ts` | `PatchCuller`: Quadtree über eine Min/Max-Pyramide der Chunks (einmal pro `setTerrain`), vollständig sichtbare Knoten ohne weitere Tests; `cullChunksBruteForce` als Referenz. |
| `src/terrain/decals.ts` | `DecalBinner`: Decals (Ring/Scheibe, Farbe, Alpha, Breite) → RGBA32I-Datentextur (2 Texel/Decal, 64/Zeile), R32UI-Chunk-Index `(start << 6) \| count`, R32UI-Liste (1.024/Zeile) in Eingabereihenfolge; max. **4.096** Decals und **32 je Chunk**, Überläufe werden gezählt (`droppedDecals`, `chunkOverflow`). |
| `src/frustum.ts` | `Frustum` (Gribb/Hartmann aus der kamerarelativen ViewProj, normierte Ebenen), `testAabb` (OUTSIDE/INTERSECTS/INSIDE), `sphereVisible`. |
| `src/passes/terrain.ts` | `TerrainHeightResources` (R16UI-Heightmap dim×dim + `TerrainHeight`-UBO + Bind-Group, von Terrain, Wasser, Sonde geteilt). `TerrainPass`: Patch 33×33 Vertices (u8-Lokalkoordinaten, CCW von oben), **ein instanzierter Draw** über alle sichtbaren Chunks (Instanz = Chunk-Index u16×2, 3-Regionen-Ring), Sichtliste nur bei Kamerawechsel; VS: `rel = ivec3(x, h, z) − camPosInt`, Höhe per `terrainHeightRaw` (Vertices auf ganzen WU ⇒ exakt), Normale per Zentraldifferenzen, Decal-Chunk-Eintrag `flat`; FS: Auto-Splat + Splatmap (Preset begrenzt 4/8), Sonne + Hemisphere, Unterwasser-Abdunklung, Decal-SDF-Schleife (AA über Pixel-Footprint), Distanz-Fog. |
| `src/passes/water.ts` | `WaterPass`: ein Quad auf Wasserhöhe über der Karte (+2 WU Rand gegen die Randfuge), FS: Tiefe = `waterLevel − terrainHeightRaw` (dieselbe GLSL-Funktion), Farbe/Alpha nach Tiefe (flach türkis/transparent → tief dunkel/deckend), scrollende analytische Wellen-Normalen (ganzzahlige Wellenvektoren je 32 WU ⇒ exakt auf `world mod 32 WU`, 2/4/6 Wellen nach `waterQuality`), Uferschaum < 0,3 WU, Fresnel-Himmelsreflexion, Sonnenglanz; trockene Fragmente verworfen. Tiefentest an, kein Depth-Write, Alpha-Blending. |
| `src/passes/probe.ts` | `HeightProbe`: N Punkte als `POINTS` (je 1 Pixel) in ein **R32I**-Target 256×64, VS rechnet `terrainHeightRaw`, FS schreibt `int`, Readback; Batches à 16.384 Punkte. |
| `src/units/culling.ts` | `InstanceCuller`: je Record Kugeltest mit der umhüllenden Kugel von prev **und** cur (Mittelpunkt, `r + |cur − prev|/2`), LOD nach Abstand Auge→cur gegen `lodDistancesWU × lodBias` (3 Stufen), Bucket-Schlüssel `visual·3 + lod`, Culled/Dropped markiert; allokationsfrei. |
| `src/passes/units.ts` | `UnitPass` (P2): Culling + LOD nur bei neuer Frame-Version, Highlight-Version, Kamerawechsel oder LOD-Bias-Änderung; Counting-Sort nach (Visual, LOD) (`VisualBuckets.sortByKeys`), **ein Draw pro nicht leerem (Visual, LOD)**; alle LOD-Meshes in einem VBO/IBO (identische Meshes einmal). **Merged-Part**: Instanz-Attribut `parts = (partBase, partCount)`, PartStream als RGBA16UI-Datentextur (1.024 Parts/Zeile, wächst in Zweierpotenzen), Pivot/Parent-Tabelle je (Visual, Part) als RGBA32F; VS dreht Part k um seinen Pivot (Pitch um die Seitenachse, dann Yaw) mit interpoliertem Winkel und folgt der Parent-Kette bis zum Rumpf; `partCount = 0` bzw. `k > partCount` ⇒ starr. `setVisualMeshes([{lods, lodDistancesWU?}])`, `setMeshes` (MS1-API) bleibt. |
| `src/mesh/placeholder.ts` | `createPlaceholderMesh(spec, lod)` / `createPlaceholderLods(spec)` (Zylinder 16/8/4 Segmente = 192/96/48 Indizes; Box LOD 0 = LOD 1 (geteilt), LOD 2 = 8 Vertices), `combineParts` (Merged-Part-Mesh mit `partPivots`/`partParents`), `meshBoundingRadius` (Kugel um den Ursprung für jede Part-Drehung). `MeshData` optional um `partPivots`, `partParents` erweitert, `indices` darf `Uint32Array` sein. |
| `src/presets.ts` | `RenderPresetName`, `RENDER_PRESETS` (low/medium/high/ultra: `renderScale` 0,66/0,8/1/1, `splatLayers` 4/4/8/8, `lodBias` 0,6/0,8/1/1,25, `waterQuality` low/medium/high/high, `shadows 'none'`, `shadowCascades 0`, `hdr/bloom false`, `msaa` 0/0/4/4, `triplanar`, `caps {particles, props, decals, unitInstances}`), `backbufferSize(cssW, cssH, dpr, renderScale, maxSize?)`, `parsePresetName`, `resolvePreset`. |
| `src/renderer.ts` | Fassade: Passes **Terrain \| Ground → Units → Water → Overlay**; `RendererOptions.terrain?`, `preset?`, `manageCanvasSize?`; `setTerrain(desc \| null)` (inkl. Licht aus `desc.light` in den Frame-Block), `setTerrainDecals(decals)`, `probeTerrainHeights(xz, out)`, `setPreset(name \| preset)`; `VisualEntry.meshes?` (1–3 LODs) und `lodDistancesWU?`; `RenderView.parts?`; `RenderStats` um `drawsByPass {terrain, water, units, overlay}`, `unitInstances`, `culledInstances`, `lodInstances`, `terrainPatches`, `decals`, `decalChunkOverflow`, `decalsDropped`, `preset`. `FIXED_PASS_DRAWS = 4` (Terrain/Ground, Wasser, Linien, Marker). `sunDirection(azimuthDeg, elevationDeg)`. |
| `demo/terrain-gen.ts`, `demo/main.ts` | Prozedurale 512-WU-Testkarte (Hügel, Grat mit steilen Flanken, Plateau, mäandernder Fluss unter Wasser mit zwei Furten 0,3 WU tief, See), 16 Mass- (Ring grün) und 2 Hydro-Spots (Ring cyan), **2.000 Einheiten** auf dem Terrain (Würfel, Turm, Merged-Part-Panzer mit PartStream: Turm dreht, Rohr nickt; je 3 LODs), Kameraflug (`T`), Test-Support `probePoints`/`referenceHeights`, API `window.__renderDemo` (`probe`, `setPose`, `setFlight`, `project`, `heightAt`, Stats, Context-Loss). |
| `scripts/smoke.ts` | Browser-Smoke (Chromium → Firefox → WebKit nacheinander, eigener Server auf freiem Port): GPU-Sonde == JS-Referenz in **10.000** Punkten, Draws ≤ 50 und ≤ (Visual, LOD)-Buckets + `FIXED_PASS_DRAWS` (auch in jedem Frame eines 3-s-Kameraflugs), genau ein Terrain- und ein Wasser-Draw, Bild nicht einfarbig + Army-Farben, Tiefwasser-Pixel wasserfarben, Mass-Ring als grünes Decal sichtbar, Context-Loss → Terrain/Wasser/Sonde wieder da, keine GL-/Konsolenfehler. Bericht `test-results/render-smoke.json`. |

## Verträge / APIs für Folgepakete

```ts
// Terrain (client: ClientMap.toTerrainDesc(), spotDecals())
renderer.setTerrain({ sizeWu, dim, heights, heightScaleRaw, waterLevelRaw /* | null */,
  splat?: { layers: 4 | 8, resolution, planes: Uint8Array[] },          // SPLT raw RGBA8
  light?: { azimuthDeg, elevationDeg, sun: [r, g, b], ambient: [r, g, b] } // 0..255, wie formats META
});
renderer.setTerrainDecals([{ kind: 'ring' | 'disc', x, z /* raw */, radiusWU, widthWU?, color: 0xRRGGBB, alpha? }]);
renderer.probeTerrainHeights(xzRaw: Int32Array /* [x0, z0, …] */, out: Int32Array); // wirft ohne Terrain / bei Verlust
renderer.setPreset('medium');  // oder ein RenderPreset-Objekt
renderer.render({ camera, units, parts?: { bytes, count, version }, highlight, alpha, overlays, timeMs });
```

- **Höhenformel**: `TERRAIN_HEIGHT_GLSL` und `sampleTerrainHeightRaw` sind bitgleich zu `rules.sampleHeightRaw`
  (gleiche Formel, per Sichtprüfung von `packages/rules/src/terrain.ts` bestätigt); Vitest gegen BigInt-Referenz,
  Browser-Sonde in allen 3 Engines 0 Abweichungen.
- **Spot-Decals** (M4, Vorschlag für ClientMap): Mass = Ring r 1,6 WU, Breite 0,35, `0x40ff50`, α 0,95;
  Hydro = Ring r 2,6 WU, Breite 0,45, `0x20e0ff`, α 0,95 (so in der Demo). Decals bleiben über `setTerrain` erhalten.
- **Merged-Part-Konvention** (für Asset-Pipeline/Sim): Vertex-`partId` 0 = Rumpf; Part k ≥ 1 liest PartStream-Eintrag
  `partBase + k − 1` (nur falls `k ≤ partCount`); Winkel relativ zum Parent: Pitch um die Seitenachse (+x-Nase hoch,
  i16 Ang16), dann Yaw um +y (u16 Ang16); Pivot/Parent aus `MeshData.partPivots/partParents` von LOD 0
  (`parent < k`). Max. 16 Part-IDs je Mesh (`MAX_MESH_PARTS`), PartStream ≤ 8 Parts je Einheit.
- **LOD**: `VisualEntry.lodDistancesWU` (Default `[60, 180]`, = Blueprint `view.lod`) × Preset-`lodBias`;
  `VisualEntry.meshes` (1–3 LODs) ersetzt den Platzhalter aus `spec`.
- **Presets**: Standard ohne Angabe = Werte von `high`, Render-Scale 1 (MS1-Verhalten). Mit `preset`/`setPreset`
  nutzt `resize()` die Preset-Render-Scale (über `backbufferSize`); wer selbst sized: `manageCanvasSize: false` +
  `backbufferSize(...)`. `?preset=` im Spiel verdrahtet ms2-p4.
- **render-bench (SPK4)**: RHI vollständig für CSM (Tiefentexturen/2D-Array-Layer als Depth-Attachment, Compare-Mode,
  `depthBias`, `colorWrite: false`), HDR (`rgba16f`-Target, `caps.colorBufferFloat`), Bloom (Offscreen-Targets mit Mips,
  Viewport), Props (instanzierte Streams wie bisher). Wiederverwendbar exportiert: `TERRAIN_HEIGHT_GLSL`,
  `TERRAIN_SPLAT_GLSL`, `TERRAIN_HEIGHT_LAYOUT`, `SLOT_*`, `UNIT_HEIGHTMAP`, `FRAME_BLOCK_GLSL`/`FRAME_LAYOUT`,
  `TerrainHeightResources`, `TerrainPass`, `UnitPass` (Passes zeichnen in jeden `PassEncoder`, also auch in ein
  Offscreen-Target; die Fassade selbst rendert nur in den Canvas).
- `RenderStats.drawsByPass.terrain` zählt ohne Terrain den GroundPass.

## Tests

`pnpm vitest run packages/render` – 11 Dateien, **72 Tests** grün (vorher 39). Neu:

| Datei | Inhalt |
|---|---|
| `test/terrain-height.test.ts` | JS-Spiegel == BigInt-Referenz in 200.000 Punkten (4 Größen/Skalen, Extremwerte 0/65535, Klemmung außerhalb), exakt an Samples, < 2³¹; GLSL-String enthält die Konstanten (`256u`, `>> 4`/`>> 12`, `- 16`, `0xffffu`, `>> 16u`) und keine Float-Mathe im Höhenpfad; Chunk-Bounds enthalten alle interpolierten Höhen; Validierung; Albedo-Layer deterministisch. |
| `test/culling.test.ts` | Frustum-Klassifikation; **Patch-Culling (Quadtree) == Brute-Force** für 500 Zufallskameras (512/1.024 WU); Nah-/Übersichtsfall; Instanz-Culling über **prev und cur**, Radius je Visual, **LOD-Schwellen** inkl. Bias, Dropped-Visuals. |
| `test/decals-presets.test.ts` | Decal-Binning (4 Chunks an Ecke, Off-Map, Packing), **Überlauf > 32 je Chunk** (erste 32 in Eingabereihenfolge), **> 4.096 Decals**, Neu-Binning; Preset-Tabelle, `backbufferSize`, `parsePresetName`. |
| `test/terrain-renderer.test.ts` | Heightmap als R16UI (Daten == heights), **ein** Terrain-Draw mit Instanzzahl = sichtbare Patches, Reihenfolge Terrain → Units → Wasser → Overlay, `drawsByPass`; Sichtliste nur bei Kamerawechsel; kein Wasser ⇒ kein Wasser-Draw, `setTerrain(null)` ⇒ Ground; Decal-Upload + Überlauf; **Sonde** (POINTS → R32I → `readPixels RGBA_INTEGER/INT`, 2 Batches, FBO einmal) mit readPixels-Emulation aus dem Fake-GL-Zustand; **Context-Loss**: alle 10 Texturen/Buffer/Programme neu, Heightmap/Decals/Albedo-Array aus CPU-Kopien, nächster `render()` mit gleicher Draw-Zahl, **Sonde liefert dieselben Werte**; Presets (Render-Scale-Resize, `manageCanvasSize: false`). |
| `test/rhi-units.test.ts` | Caps + Float-Targets nur mit `EXT_color_buffer_float`, Offscreen-Pass (Attachments, `drawBuffers`, Viewport, Clears), Compare-Mode, FBO-Cache/Löschung; 2D-Array (`texStorage3D`, `texSubImage3D` je Layer, Mipmaps, Layer-Attachment, Depth-only `drawBuffers([NONE])`); `readTexture` (Format/Typ, Kanalverdichtung, Fehler); Polygon-Offset/Color-Mask; Platzhalter-LODs 16/8/4; `combineParts`/Radius; **ein Draw pro (Visual, LOD)**, Culled-Zählung, Parts-Attribut (u32×2 @ 40), PartStream-Textur (RGBA16UI, nur bei neuer Version), LOD-Bias-Wechsel ⇒ Neu-Culling. |
| `test/support/fake-gl.ts` | erweitert: Framebuffer-Objekte, Zustandsverfolgung (Texturen inkl. Uploads/Parameter, Buffer-Inhalte, Attachments, letzter Draw), Hook `onReadPixels` zur Emulation. |

Selbsttest (2026-09-29): `pnpm typecheck` grün, `pnpm lint` grün (ESLint 0 Warnungen, dep-cruiser 0 Verstöße,
278 Module), `pnpm vitest run packages/render packages/client apps/game` 25 Dateien / **157 Tests** grün,
`pnpm --filter @faf/render smoke` **3/3 OK**. Zusätzlich: Spiel gebaut und auf eigenem Port (4391, danach beendet)
gestartet – MS1-Ansicht unverändert (1.025 Instanzen, 2 Draws, keine Konsolenfehler).

## Messwerte (lokal, Apple M5 Pro, Playwright headless – kein Iris-Xe-/GPU-Runner, DECISIONS 5)

Smoke-Szene: 512-WU-Terrain mit Wasser und 18 Spot-Decals, 2.000 Einheiten (3 Visuals × 3 LODs, 342 Panzer mit
PartStream), Viewport 1280×720, DPR 1, Preset high. Übersicht = Kamera 150 WU, 52°.

| Browser | Sonde 10.000 Pkt. | Draws (Terrain/Units/Wasser/Overlay) | Patches | Units sichtbar/gecullt | Render-JS p50/p95 statisch | Render-JS p95 Flug | Draws max. Flug | GPU (Timer-Query) |
|---|---|---|---|---|---|---|---|---|
| Chromium 153 (ANGLE/Metal) | **0 Abw.** (4–25 ms) | 10 (1/6/1/2) | 65 | 307 / 1.693 | 0,10–0,20 / 0,21–0,53 ms | 0,25–0,53 ms | 13 | p50 0,66–0,88 ms, Flug p95 2,7–5,1 ms |
| Firefox 155 | **0 Abw.** | 10 (1/6/1/2) | 65 | 308 / 1.692 | 0,10–0,16 / 0,26–0,44 ms | 0,26–0,58 ms | 12–13 | n/a (kein Timer-Query) |
| WebKit 26.6 | **0 Abw.** | 10 (1/6/1/2) | 65 | 308 / 1.692 | 0,10–0,16 / 0,26–0,48 ms | 0,40–0,46 ms | 13 | n/a (kein Timer-Query) |

Wertebereiche über 2–3 Läufe je Browser (DECISIONS 16). Zuordnung der GPU-Zeit (Chromium, Übersicht, ohne Fremd-GPU-Last):
Terrain ≈ 0,4 ms, Wasser ≈ 0,1 ms, Einheiten/Decals ≈ 0,05 ms, Ground-Fallback allein ≈ 0,2 ms. **Achtung:**
Während eines Laufs lief parallel ein fremder MLX-GPU-Job (h3mlx); dabei stiegen die Timer-Query-Werte auf 6–14 ms
p50 (Terrain) – die Timer-Query misst unter GPU-Konkurrenz Wartezeit mit. Die Tabelle nennt nur Läufe ohne diesen Job.
Überall 60 FPS (Chromium/WebKit-rAF-Takt; Firefox headless 105–120 FPS). Budget MS2 (≤ 50 Draws bei 2.000 Units +
Terrain + Wasser) mit max. 13 Draws deutlich erfüllt.

## Abweichungen vom Auftrag / Plan (mit Begründung)

- **`FIXED_PASS_DRAWS` 3 → 4**: Wasser ist ein eigener fester Pass; Ground und Terrain teilen sich den Terrain-Platz.
  Keine Nutzer außerhalb von render (Game/E2E prüfen keine Obergrenze).
- **Wasserrand 2 WU statt „großzügig“**: Außerhalb der Karte liefert die Formel die geklemmten Randhöhen, ein breiter
  Rand würde Randflüsse als Band ins Leere verlängern (im Screenshot sichtbar gewesen). 2 WU schließen nur die Fuge.
- **Probe-Target R32I, Readback über `RGBA_INTEGER`**: WebGL2 garantiert für Integer-Targets nur RGBA-Readback;
  `readTexture` verdichtet auf einen Kanal (Scratch-Puffer, nur Debug/Tests).
- **Part-Winkel relativ zum Parent** mit Pivot/Parent-Tabelle je Visual (aus LOD 0): nötig, damit ein Rohr der
  Turmdrehung folgt; PLAN §3.7 legt nur „VS transformiert pro Part mit den Winkeln aus dem PartStream“ fest.
- **Instanz-Culling mit umhüllender Kugel** von prev und cur statt zweier Einzeltests: deckt jede Interpolationsstellung
  ab (Einheit liegt auf der Strecke prev→cur), ist konservativ und so billig wie ein Test.
- **Terrain-Patch = Chunk (32 WU)** und Decal-Binning pro Patch: Der Decal-Chunk-Eintrag kommt `flat` aus dem VS
  (eine Textur-Abfrage je Vertex statt je Fragment).
- **Demo-`api.debugRenderer`** legt den Renderer für Profiling offen (nur Demo, nicht im Spiel).
- **Preset-Default**: ohne `preset`-Option Werte von `high` und Render-Scale 1, damit MS1-Aufrufer unverändert bleiben.

## Bekannte Grenzen

- CDLOD nur eine Stufe (PLAN: Stufen/Geomorphing ab MS14); bei Gesamtkartenansicht 256 Patches × 2.048 Dreiecke.
- Triplanar-Mapping, Schatten (CSM/Blob), HDR/Bloom sind in den Presets als Felder vorhanden, aber in MS2 nicht
  umgesetzt (`shadows: 'none'`, `hdr: false`); die RHI dafür ist fertig, die Passes baut SPK4/MS8/MS14.
- MSAA im Preset (`msaa`) wird noch nicht angewandt (Canvas-`antialias` wie MS1); multisampled Renderbuffer/Resolve
  sind nicht in der RHI (für SPK4 nicht nötig).
- Keine Fog-of-War-Textur (MS5), kein Strategic Zoom/IconPass (MS3), keine Normal-Textur-Neigung der Einheiten
  (Einheiten stehen senkrecht auf dem Terrain; Tilt folgt mit Bewegung/MS3).
- `readTexture`/`probeTerrainHeights` stallen die GPU – nur für Tests/Debug.
- GPU-Zeiten nur in Chromium (Firefox/WebKit ohne `EXT_disjoint_timer_query_webgl2`); keine Messung auf Iris Xe
  oder echtem Safari (DECISIONS 5).
- Demo-Karte ist prozedural (formats entsteht parallel); hollow-ridge-Anbindung, `?preset=` und E2E folgen in
  ms2-p3/p4.
