# TRACK-RENDERFX – Render-Features als Vorarbeit (`@faf/render-fx` + `apps/fx-lab`)

Paralleler Vorarbeits-Track, **kein Meilenstein** aus PLAN §5.2. Branch `track-renderfx`, Worktree
`/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-renderfx`. (Der im Plan genannte Pfad
`/Users/logge/Documents/Projects/faf-renderfx` existiert nicht; alle Pakete haben im Worktree unter `.worktrees`
gearbeitet.) Ziel: die Render-Features aus PLAN §3.7, die später in MS5, MS7, MS13 und MS14 gebraucht werden,
jetzt schon als eigenständiges, getestetes Paket bauen. `packages/render` und `tools/render-bench` bleiben
unverändert, weil MS3 render parallel ändert (DECISIONS 30).

Stand: 2026-09-30. Die Einzelheiten stehen in den Fragmenten `docs/status/rfx-p0-scaffold-core.md` …
`rfx-p7-bench-e2e-docs.md`. Dieses Dokument fasst sie zusammen und enthält Messwerte, Abnahme und die
Integrationsanleitung.

## 1. Überblick und Architektur

### 1.1 Pakete und Grenzen

| Paket | Inhalt | darf importieren |
|---|---|---|
| `packages/render-fx` (`@faf/render-fx`) | core, effects, decals, particles, trails, shields, light, post | `@faf/render` (nur öffentliche API aus `src/index.ts`), `@faf/fixed`, `@faf/protocol`, `gl-matrix` |
| `apps/fx-lab` (`@faf/fx-lab`) | Vite-Demo mit Szenen, Test-Hooks, Screenshot-, Benchmark- und E2E-Werkzeugen | `@faf/render`, `@faf/render-fx`, `@faf/fixed`, `@faf/protocol` |

- dependency-cruiser erzwingt die Richtung: `render-fx-deps`, `render-fx-npm-deps`, `render-never-imports-render-fx`,
  `fx-lab-deps`, und `presentation-never-imports-sim` gilt auch für render-fx und das fx-lab.
- render-fx ist Präsentationscode. Der Sim-Determinismus-Lint gilt nicht, trotzdem gibt es kein `Math.random`:
  sichtbare Variation kommt aus `FxRng`/`fxHash32`, damit Screenshots reproduzierbar sind. Heiße Pfade allokieren
  nicht (vorallokierte Typed Arrays).
- Weltpositionen sind überall Q20.12-Rohwerte (1 WU = 4096 raw). Im Shader wird kamerarelativ gerechnet wie in
  render: `vec3(ivec3(posRaw) − u_camPosInt.xyz) / 4096.0 − u_camFrac.xyz` (`fxRelPos`).
- Jede GPU-Ressource läuft über das RHI (`GpuDevice`). Die Context-Loss-Registry des Devices baut die Objekte mit
  denselben Handles neu auf. Inhalte, die nicht jeden Frame neu geschrieben werden, haben `restore`-Callbacks.

### 1.2 Slot-Tabelle (verbindlich, `src/core/slots.ts`, DECISIONS 31)

| Art | render (belegt) | frei für render/MS3 | render-fx |
|---|---|---|---|
| UBO-Slots | 0 Frame, 1 Palette, 2 Pass (jeder Pass nutzt `SLOT_PASS` für seinen eigenen Block), 3 TerrainHeight | 4, 5 | 6 `SLOT_FX_VIEW`, 7 `SLOT_FX_SHADOW`, 8 `SLOT_FX_SCORCH` |
| Textur-Units | 0–7 | 8, 9 | 10 `UNIT_FX_SHADOW_STATIC`, 11 `UNIT_FX_SHADOW_DYNAMIC`, 12 `UNIT_FX_CURVE_LUT`, 13 `UNIT_FX_SCORCH_DATA`, 14 `UNIT_FX_SCORCH_CELLS`, 15 `UNIT_FX_PARTICLE_LAYERS` (in `particles/system.ts`) |

- `FX_TIME_WRAP_S = 4096`: FX-Zeit im Shader = Sekunden mod 4096, Alter = `mod(now − t0 + 4096, 4096)`,
  Lebensdauern ≤ 60 s (DECISIONS 33).
- Post-Passes sind eigenständige Fullscreen-Passes mit eigenen Units 0/1.
- Alle Werte liegen unter den WebGL2-Mindestgrenzen (24 UBO-Bindings, 16 Units je Stufe). Ein Test prüft die
  Kollisionsfreiheit gegen render's exportierte Konstanten.

### 1.3 Gemeinsame Verträge

- **Frame-Uniforms:** Alle 3D-FX-Passes binden render's `FRAME_BLOCK_GLSL`/`FRAME_LAYOUT` an Slot 0 und den
  FX-View-Block an Slot 6:
  `layout(std140) uniform FxView { vec4 u_fxRight; vec4 u_fxUp; vec4 u_fxFwd; vec4 u_fxTime; };`
  xyz sind die Kamera-Achsen in Weltkoordinaten. `u_fxTime` = (FX-Zeit mod 4096, dt, Pixel pro WU in Distanz 1 =
  0,5·viewportH/tan(fovY/2), Kameradistanz WU).
- **`FxBindings = { frame: BufH; fxView: BufH }`** geht in jeden Pass-Konstruktor. `FxFrameUniforms` schreibt beide
  Blöcke (den Frame-Block byte-identisch zu `createRenderer().render()`), mit `{ frameUbo }` nur den FxView-Block
  (Integrationsmodus: render liefert den Frame-Puffer).
- **Pass-Konvention:** `encode(enc: PassEncoder): number` (Draws), `destroy()`, `readonly stats`. Transparente
  FX-Passes: depthTest an, depthWrite aus, blend `'premultiplied'` (additiv = Alpha 0).

### 1.4 Pass-Reihenfolge und Frame-Ablauf

PLAN §3.7: Shadow → Terrain (inkl. Decals/Scorch) → Props → Units/Wracks → Water → **Shields → Particles →
Beams/Trails** → Icons → Overlay → **Post**. Im fx-lab (`LabApp.renderFrame`, `apps/fx-lab/src/app/app.ts`), in dieser
Reihenfolge auch als GPU-Segmente (`FX_SEGMENTS` = `LAB_SEGMENTS`):

1. **Szenenlogik** in festen 60-Hz-Schritten: `units.snapshot()` → `scene.update` → `scorch.update(t)` →
   `LabFx.update` (Spawns, Emitter, Beams, Trails, Schild-Treffer).
2. **Kamera und Uniforms:** Preset, Maus bzw. `flight`, `CameraShake.sample` als Versatz;
   `FxFrameUniforms.update(camera, { timeS: Szenenzeit, dtS, alpha, Licht, viewport })`, `units.upload()`.
3. **`shadow`:** `csm.update(camera, sunDir)`, `renderStatic` (Boden + Props, nur dirty Kaskaden), `renderDynamic`
   (Units, reduzierte Geometrie), Scorch-Texturen hochladen, falls dirty.
4. **`opaque`:** `post.beginScene(clear)` (HDR RGBA16F oder LDR RGBA8 + DEPTH24), Bind-Groups Frame/FxView,
   Schatten-Receiver (CSM oder `NullShadowReceiver`), Scorch; Boden (mit `SCORCH_GLSL`), Props, Units.
5. **`shields` → `particles` → `beams`** (Beams und Trails) im selben Szenen-Pass.
6. **`post`:** `post.resolve()` – Bloom down/up, Composite (Exposure, ACES), FXAA in den Canvas.

Die FX-Zeit auf der GPU ist die Szenenzeit des gerenderten Frames (letzter Schritt + Akkumulator), nie die
Wall-Clock. `freeze=T` reproduziert deshalb dasselbe Bild in allen Browsern.

## 2. API-Referenz (Kurzfassung je Modul)

Vollständige Signaturen, Record-Layouts und Tests stehen in den Fragmenten; hier nur das, was die Integration braucht.

### 2.1 `core` (rfx-p0)

- `SLOT_*`, `UNIT_*`, `FX_TIME_WRAP_S`; `FX_VIEW_BLOCK_GLSL`/`FX_VIEW_LAYOUT` (64 B); `FX_COMMON_GLSL` (`fxRelPos`,
  `fxAge`, `fxBillboard`); `FxBindings`, `fxSharedBufferBindings(b)` → Einträge für Slot 0 und 6.
- `FxFrameUniforms(dev, { frameUbo?, writeFrame? })`: `update(camera, FxFrameInput)`, `bindings`, `fxTime`,
  `pixelsPerWuAt1`, `destroy()`. `FxFrameInput = { timeS, dtS, alpha?, sunDir?, sunColor?, skyColor?, groundColor?,
  fog?, fogStart?, viewport }`.
- `hideTimerQueryFromDevice(gl)` (vor `createWebGL2Device`), `GpuSpanTimer(gl, ext, segments)`: `beginFrame`,
  `begin(i)`/`beginNamed`, `endFrame`, `poll(sink)`, `reset()` bei Context-Loss.
- `DynamicInstanceBuffer(dev, { stride, capacity })` (ein `writeBuffer` je Upload, Restore aus Staging),
  `toHalf`/`fromHalf`, `wuToRaw`/`rawToWu`, `FX_SEGMENTS`.

### 2.2 `effects` (rfx-p1, getunt in rfx-p6)

- `defineEffect(def)` mit Laufzeitvalidierung. Layer: `shape` (glow, spark, smoke, ring, debris, flash, stream),
  `orient` (billboard, velocity, ground), `motion` (ballistic, stream), `count`/`rate`, `lifetime` ≤ 30 s,
  `delay` ≤ 10 s, `speed`, `spread`/`spreadInner`, `emitRadius`, `gravity`, `drag`, `size`-Kurve, `color`-Kurve
  (HDR ≤ 16), `blend`-Kurve (0 additiv … 1 alpha), `stretch`, `spin`, `priority` 0/1/2, `tint: 'spawn'`.
- `compileEffectLibrary(defs)` → `EffectLibrary` (Layer-Tabelle 32 Floats je Layer, Kurven-LUT 64 × 2·Layer,
  `indexOf(id)`, `hash`). CPU-Referenz `evalParticle`/`particleRandoms` = Formel des Vertex-Shaders.
- `VARKAN_EFFECTS` (Effektliste in §3), `VARKAN_EVENT_FX` (Ereignis → Effekt-IDs), `VARKAN_GLOW`,
  `glowTintForArmyColor(rgb)` (Weißglut für Rot/Orange, faction.md §4.3).
- `CameraShake`: `addFromEffect(effect, pos, tS, scale?)`, `sample(tS, camTarget)` → wiederverwendetes
  `{ dx, dy, dz, rollRad, active }`, 16 Quellen, allokationsfrei.
- `FxRng`, `fxHash32` – deterministische Variation für alle Pakete.

### 2.3 `decals` (rfx-p1)

- `ScorchDecals({ cap, mapSizeWu })`, `SCORCH_CAPS` (Low 128, Medium 256, High 512, Ultra 1.024), `add({ xWu, zWu,
  radiusWu, kind: 'scorch'|'crater'|'scar', seed, tS, lifetimeS?, emberS?, strength? })`, `update(tS)`, `pack()`,
  `writeBlock(tS, emberIntensity, strength)`, `shadeAt` (CPU-Spiegel).
- Chunk-Binning in 32-WU-Chunks (== Brute-Force, Test), Datentextur `rgba32i` (Unit 13) + Zellen-Textur `r32ui`
  (Unit 14), UBO `FxScorch` (Slot 8).
- `SCORCH_GLSL`: `vec4 fxScorch(vec3 relPos)` (rgb = Albedo-Faktor, a = Glut), `fxScorchGlow(a)`;
  `SCORCH_SAMPLERS`, `SCORCH_UNIFORM_BLOCKS`, `VARKAN_SCORCH` (Größen je Ereignis).

### 2.4 `particles` (rfx-p3)

- `ParticleSystem(dev, bindings, lib, { capacity = 65536, cap, onShake? })`: `spawn(effectIdx, posRaw, { dir, scale,
  seed, tint, targetRaw })`, `createEmitter`/`moveEmitter`/`setEmitterRate`/`destroyEmitter` (≤ 1.024 Dauer-Emitter),
  `setCap`, `update(nowS, camera)`, `encode(enc)` (1 Draw, 2 bei Ring-Umlauf), `stats` (alive, cap, capacity,
  spawnedFrame, requested/dropped je Priorität, culled, uploadBytesFrame, emitters, overwritten, window, draws).
- `particleCapForPreset(p)` = `RENDER_PRESETS[p].caps.particles`.
- Zustandsloser Ring: Record 32 B (Ursprung i32×3, t0, Vektor f16×4, Layer/Seed, Tint). Bewegung, Größe und Farbe
  als geschlossene Form f(t − t0) im Vertex-Shader aus Layer-Tabelle (Unit 15) und Kurven-LUT (RGBA16F, Unit 12).
  Die CPU lädt pro Frame nur neue Records hoch. Ein `spawn()` vor `encode()` ist im selben Frame sichtbar.
- Prioritäten und Caps: DECISIONS 34.

### 2.5 `trails` (rfx-p4)

- `BeamPass(dev, bindings, { capacity = 4096, timedCapacity })`: `begin()` (Immediate-Mode), `add(fromRaw, toRaw,
  style)`, `addTimed(…, t0S, lifeS)`, `update(nowS)`, `encode` (1 Draw). `BeamStyle = { widthWu, core, glow, alpha,
  scrollSpeed?, noise?, taper? }`.
- `TrailPass(dev, bindings, { capacity = 8192 })`: `begin()`, `add(prevRaw, curRaw, style, lengthScale?)`,
  `encode` (1 Draw). Kopf im VS = `mix(prev, cur, u_camFrac.w)`, stehender Kopf ohne NaN.
- `VARKAN_BEAM_STYLES` (buildStream, reclaimStream, laser, lightning, shieldArc), `VARKAN_TRAIL_STYLES` (tracer,
  cannon, artillery, missile, aa).

### 2.6 `shields` (rfx-p4)

- `ShieldPass(dev, bindings, { capacity = 128, subdivisions = 3 })`: `set(id, { centerRaw, radiusWu, color, hpFrac,
  upFrac })`, `hit(id, pointRaw, nowS, strength)` → Ripple-Slot, `remove`, `update(nowS)`, `encode` (1 indizierter
  Instanz-Draw). Fresnel `(1 − |N·V|)³`, prozedurale Waben, 4 Ripple-Slots je Schild (5. Treffer ersetzt den am
  weitesten abgeklungenen), Low-HP-Färbung/Flackern, Hochfahren über `upFrac`.

### 2.7 `light` (rfx-p2)

- `CascadedShadows(dev, { size = 2048, cascades = 2, lambda, headroom, maxDistanceWu, strength, worldMin, worldMax })`:
  `update(camera, sunDir)`, `renderStatic(draw)` (nur dirty Kaskaden, statischer Cache), `renderDynamic(draw)` (jeden
  Frame), `receiverBindings()`, `invalidateStatic()`, `stats` (staticRefreshes, dynamicDraws …).
- GLSL: `SHADOW_CASTER_GLSL` (`fxShadowCasterPos`), `SHADOW_RECEIVE_GLSL` (`fxShadow(relPos, n)`), `LIGHTING_GLSL`/
  `lightingGlsl(hdr)` (`fxLight`, `fxEmissive`), `SHADOW_RECV_SAMPLERS`/`…_UNIFORM_BLOCKS`, `NullShadowReceiver`.
- `shadowOptionsForPreset`/`SHADOW_PRESET_TABLE` (Zielbelegung MS14: CSM ab High).

### 2.8 `post` (rfx-p2)

- `PostChain(dev, PostOptions)`: `beginScene(clear)`, `sceneLoadPass()`, `resolve(mark?)` → Draws, `resize(w, h)`,
  `setOptions(partial)`, `hdrActive`, `sceneColor`/`sceneDepth`, `stats`. HDR RGBA16F, ohne
  `EXT_color_buffer_float` oder mit `hdr: false` automatisch LDR RGBA8; Dual-Kawase-Bloom (1–6 Stufen), ACES
  (Narkowicz), FXAA. Bloom 5 + FXAA = 11 Fullscreen-Draws.
- `postOptionsForPreset`/`POST_PRESET_TABLE` (Low LDR ohne Bloom; Medium bis Ultra HDR + Bloom 5 + FXAA).

### 2.9 fx-lab (rfx-p5, rfx-p6)

- Verträge in `apps/fx-lab/src/app/context.ts` (`LabScene`, `LabFx`, `LabContext`, `LabParams`) und Test-Hooks
  `window.__fxlab` (`src/app/hooks.ts`): `ready`, `frame`, `scene`, `preset`, `error`, `restoreCount`, `stats()`,
  `samples()` (Ring der letzten 2.048 Frames mit frameMs, mainJsMs, fxJsMs, labJsMs, draws, gpuMs, gpuSeg.*,
  particlesAlive), `resetSamples()`, `setScene`, `loseContext`/`restoreContext`, `triggerBigExplosion`.
- URL-Parameter: `scene`, `preset`, `hdr`, `bloom`, `csm`, `fxaa`, `seed`, `freeze`, `bench`, `flight`, `fx`.
- Werkzeuge:

| Befehl | Zweck |
|---|---|
| `pnpm fx:lab` | Dev-Server (Port 4685 oder nächster freier; danach beenden) |
| `tools/heavy pnpm --filter @faf/fx-lab run shot -- --scenes=… --browsers=…` | Screenshots nach `test-results/fx-lab-shots/` |
| `tools/heavy pnpm smoke:fx -- --browsers=chromium,firefox,webkit` | Smoke-Fälle aller render-fx-Module inkl. Context-Loss |
| `tools/heavy pnpm bench:fx [-- --quick] [--update-docs]` | FX-Benchmark (§4) |
| `FAF_E2E_PORT=4683 tools/heavy pnpm test:e2e:fx` | Playwright-Screenshot-E2E (§5) |

## 3. Effektliste mit Budgets (Varkan, Stand nach dem Tuning in rfx-p6)

Budget = Summe der größten Bursts + für Dauer-Emitter `ceil(rate · lifetime.max)` (gleichzeitig lebende Partikel
einer Instanz). Grenzen laut Test (`packages/render-fx/test/effects/varkan.test.ts`): Kommandant (explosion +
aftermath) ≤ 2.500, explosion_small ≤ 60, explosion_medium ≤ 150, explosion_large ≤ 400, Mündungsfeuer ≤ 30,
kleine Einschläge ≤ 30. Die Tabelle ist aus dem Code erzeugt (`compileEffectLibrary(VARKAN_EFFECTS)`, `effectBudget`).

| Effekt | Layer (Priorität) | Burst | Dauer | Budget | continuous | Bounds WU | Shake |
|---|---|---|---|---|---|---|---|
| `varkan:muzzle_small` | flash(P1), streaks(P2), puff(P2) | 7 | 0 | 7 | – | 2 | – |
| `varkan:muzzle_cannon` | flash(P1), tongue(P1), sparks(P2), smoke(P2) | 14 | 0 | 14 | – | 4 | – |
| `varkan:muzzle_artillery` | flash(P1), blast(P1), ring_smoke(P2), sparks(P2) | 21 | 0 | 21 | – | 6 | – |
| `varkan:muzzle_missile` | flash(P1), backblast(P2), crackle(P2) | 18 | 0 | 18 | – | 5 | – |
| `varkan:impact_ground_small` | flash(P1), dirt(P2), dust(P2), sparks(P2) | 16 | 0 | 16 | – | 4 | – |
| `varkan:impact_ground_large` | flash(P1), fire(P1), dirt(P2), column(P2), ground_ring(P2), sparks(P2) | 44 | 0 | 44 | – | 9 | – |
| `varkan:impact_metal` | flash(P1), sparks(P1), smoke(P2) | 18 | 0 | 18 | – | 3 | – |
| `varkan:impact_shield` | flash(P1), ring(P1), sparks(P2) | 12 | 0 | 12 | – | 4 | – |
| `varkan:impact_water` | crown(P2), column(P1), ring(P2) | 18 | 0 | 18 | – | 5 | – |
| `varkan:explosion_small` | flash(P1), fireball(P1), smoke(P2), sparks(P2), debris(P2) | 37 | 0 | 37 | – | 6 | – |
| `varkan:explosion_medium` | flash(P1), fireball(P1), secondary(P2), smoke(P2), sparks(P2), debris(P2), ground_ring(P2) | 76 | 0 | 76 | – | 10 | – |
| `varkan:explosion_large` | flash(P1), fireball(P1), secondary(P2), smoke(P2), sparks(P2), debris(P2), embers(P2), ground_ring(P2) | 175 | 0 | 175 | – | 18 | – |
| `varkan:acu_explosion` | flash(P0), fireball(P0), shockwave(P0), stem(P1), cap(P1), sparks(P2), debris(P2), embers(P2) | 882 | 0 | 882 | – | 70 | 2,4 WU / 2,4 s / r 160 |
| `varkan:acu_aftermath` | dust_ring(P1), ground_fire(P1), ground_smoke(P2) | 152 | 0 | 152 | – | 40 | – |
| `varkan:smoke_damage` | smoke(P2), embers(P2) | 0 | 44 | 44 | ja | 6 | – |
| `varkan:smoke_puff` | smoke(P2) | 9 | 0 | 9 | – | 6 | – |
| `varkan:sparks_burst` | sparks(P2), flash(P2) | 31 | 0 | 31 | – | 4 | – |
| `varkan:wreck_smolder` | smoke(P2), embers(P2) | 0 | 41 | 41 | ja | 6 | – |
| `varkan:missile_smoke_trail` | smoke(P2), crackle(P2) | 0 | 60 | 60 | ja | 3 | – |
| `varkan:build_stream` | pour(P1), droplets(P2) | 0 | 78 | 78 | ja | 12 | – |
| `varkan:reclaim_stream` | melt(P1), slag(P2) | 0 | 73 | 73 | ja | 12 | – |

Gesamt: 21 Effekte, 77 Layer, LUT 64 × 154, lib.hash = 0xf61a4c08

- ≥ 18 geforderte Effekte: Mündungsfeuer ×4, Einschläge Boden (klein/groß)/Metall/Schild (+ Wasser), Explosionen
  klein/mittel/groß, Kommandanten-Explosion (Blitz, Feuerball, Boden-Schockwelle, Pilz-Stamm/-Kappe, Funken,
  Trümmer, Nachglut + `acu_aftermath` mit Staubring, Bodenfeuer, Bodenrauch; Kamera-Shake 2,4 WU / 2,4 s / 160 WU),
  Rauch (`smoke_damage`, `smoke_puff`), Funken, Wrack-Schwelen, Raketen-Rauch, Bau-Gießstrom, Reclaim-Strom.
- Priorität 0 hat nur der Kern der Kommandanten-Explosion: 1 Blitz + 90–110 Feuerball + 1 Ring = **≤ 112 Partikel je
  Kommandant** (dokumentierter Überschuss über den Cap, DECISIONS 34).
- `VARKAN_EVENT_FX`: `weapon` (direct_small/aa → muzzle_small, cannon, artillery, missile), `impact` (ground,
  ground_large, unit → impact_metal, shield, water; `groundImpactForWeapon`), `death` (small, medium, large, structure
  → explosion_large + smoke_puff, acu → acu_explosion + acu_aftermath), `build`, `reclaim`, `damaged`, `wreck`,
  `missileTrail`.
- Beam-/Trail-Stile (`VARKAN_BEAM_STYLES`, `VARKAN_TRAIL_STYLES`) und Scorch-Vorgaben (`VARKAN_SCORCH`: Einschlag
  groß 1,6 WU, Tod klein/mittel 1,8/2,8 WU Ruß, groß 4,5 WU Krater, Struktur 6,5 WU, Kommandant 22 WU dauerhaft)
  gehören zur Bibliothek.
- Im fx-lab spawnt das Kit Effekte mit `LAB_FX_SCALE` = 2,5 (Kommandant 1,6, Ströme 1,5), weil die Box-Einheiten
  des Labs 3–4 × größer sind als die Referenzgröße. Im Spiel gilt Scale 1.

## 4. fx-lab-Szenen (rfx-p6)

| Szene | Inhalt | Kamera | wichtige Stats |
|---|---|---|---|
| `battle` | 2 × 200 Einheiten (je 100 Panzer, 63 Bots, 28 Artillerie, 8 Engineers, 1 ACU), dauerhaftes Gefecht mit Mündungsfeuer, Tracern, Artillerie-Parabeln, Raketen mit Rauch, Einschlägen, Toden mit Explosion/Wrack/Scorch, Nachspawn hinter der Front, Gießstrom-Bau und Reclaim; Start im eingeschwungenen Zustand (100 Wracks) | 118 WU, 38°, Heading −55° | `units` 400, `wrecks`, `damaged`, `deathsPerS`, `effectsPerS`, `projectiles`, `streams` |
| `shields` | 20 Schilde (5 × 4, r 6–20 WU) unter Beschuss von 2 × 12 Artillerien, 88 % Schildtreffer (Ripple + `impact_shield`), Schild 7 kollabiert alle 10 s und baut sich neu auf | 235 WU, 52° | `shields` 20, `hits`, `hitsPerS`, `collapses` |
| `big` | Kommandant in der Mitte stirbt bei t = 1 s und dann alle 8 s (`acu_explosion` + `acu_aftermath`, Krater, Shake), die Stoßfront tötet 36 Einheiten auf drei Ringen und 3 Strukturen; `trigger()` löst sofort aus | 150 WU, 26° | `explosions`, `sinceBoom`, `shakeSources` |
| `gallery` | alle 21 Varkan-Effekte: 19 Kacheln (5 × 4) + Kommandanten-Kachel, Trail-Stile als Projektilschleifen, Timed-Beams (Laser, Blitz); Burst-Phasen so gewählt, dass bei t = 3 s jeder Effekt in einem typischen Alter steht | Übersicht 150 WU, Nahaufnahmen per `cam=` | `effects` 21, `bursts`, `streams` |
| `lighting` | 40 fahrende Einheiten, Strukturen, Wracks, 30 Scorch-/Krater-Decals mit Glut, tiefe Sonne für lange CSM-Schatten, keine Partikel | 128 WU, 50° | `units`, `decals`, `glowingDecals` |

Alle Szenen sind deterministisch aus `seed` und laufen im 60-Hz-Fixed-Step. Zusätzlicher URL-Parameter aus rfx-p6:
`cam=<Distanz>,<Neigung>,<Heading>[,<x>,<z>]` (Kamera-Override für Nahaufnahmen).

## 5. Messwerte (FX-Benchmark, lokal gemessen, Apple M5 Pro, kein Iris Xe)

Befehl: `tools/heavy pnpm bench:fx [-- --quick] [--update-docs]` (`apps/fx-lab/scripts/bench.ts`, Helfer unter
`scripts/bench/`). Ablauf: Vite-Build, Auslieferung per `page.route` unter der virtuellen Origin
`https://faf-fx-lab-bench.test` (COOP/COEP/CORP, feine Timer, kein Port), Chromium → Firefox → WebKit nacheinander,
Viewport 1920 × 1080 bei DPR 1 (Medium: Backbuffer 1536 × 864), `bench=1`, `seed=1`. Je Szenario eine frische Seite,
2 s Warm-up, `resetSamples()`, 8 s Messung; eine In-Page-Abfrage (≈ 10 Hz) hält die maximalen Draws je Segment
und den FX-Zustand fest. Ausgewertet werden p50/p95/p99 aus `__fxlab.samples()`. GPU-Zeiten gibt es nur mit
`EXT_disjoint_timer_query_webgl2` (sonst „n/v“), und nur Frames, deren sechs Segmente aufgelöst sind. Bericht:
`apps/fx-lab/results/fx-<Datum>[-quick].json` (git-ignoriert), Screenshots `test-results/fx-bench/`. Fremdlast
wird erkannt – aktive GPU-Jobs (≥ 2 % CPU), fremde Playwright-/Vitest-Läufe und eine GPU-Auslastung ≥ 25 % laut
`ioreg` (IOAccelerator), solange der Benchmark selbst nichts rendert –, abgewartet (`--wait`, Standard 240 s), das
Szenario bei Fremdlast wiederholt (`--attempts`, Standard 3) und im Bericht markiert. `--docs-only` schreibt den
Marker-Block ohne Messung aus den vorhandenen Berichten neu.
Exit-Code 1 nur bei Fehlern und Draw-Budget-Überschreitung (DECISIONS 38).

### 5.1 Einordnung (lokal gemessen, Apple M5 Pro, Playwright headless, kein Iris Xe)

**Alle Messläufe am 2026-09-30 liefen unter Fremdlast.** Parallel liefen MLX-GPU-Jobs aus anderen Projekten des
Nutzers (zeitweise 95–99 % GPU-Auslastung ohne Benchmark laut `ioreg`) sowie Playwright- und Vitest-Läufe anderer
Agenten. Drei Volläufe (3 Browser, 04:38, 05:13 und 05:37 Uhr Ortszeit) und zwei Chromium-Teilläufe (05:47 und 05:56 Uhr,
FX gegen fx=0) wurden gemessen; der zweite Vollauf lag unter voller GPU-Last (GPU p50 > 100 ms), der dritte und die Teilläufe in einer
ruhigeren Phase. Die Tabellen unten markieren das (⚠️). Belastbar sind:

| Größe | Ergebnis | Bewertung |
|---|---|---|
| Draws je Frame (hardwareunabhängig) | battle 18–19 (FX 3: Partikel 1, Trails 1, Beams 1), shields 19 (FX 3: Schilde 1 + Partikel 1 + Trails 1), big 17 (FX 1), lighting 16 (CSM) bzw. 14 | ✅ Budget FX ≤ 6, gesamt ≤ 40 in allen Läufen, allen Browsern |
| Partikel-Cap | battle Medium: alive p50 6.800–7.650, max ≈ 9.000 von 16.384, nichts verworfen; battle Low: alive sättigt bei 6.144 (= 0,75 · 8.192, Prio-2-Grenze), dropped P2 5.900–10.400 je 8-s-Fenster, P0/P1 0 | ✅ Cap greift, Prioritäten wie spezifiziert |
| Main-JS / FX-JS (Chromium) | ruhige Läufe: Main-JS p95 0,13–0,52 ms, FX-JS p95 0,05–0,28 ms; battle Main-JS p50 ≈ 0,26 ms | ✅ weit unter jedem Budget (Main-JS ≤ 5 ms aus SPK4) |
| Main-JS (Firefox / WebKit) | Firefox p95 0,24–0,80 ms; WebKit Ø 0,07–0,67 ms (1-ms-Takt) | ✅ |
| FPS | ruhigere Läufe: 55–60 FPS in allen Szenen und Browsern, Frame-p50 16,7 ms (vsync) | ✅ battle Medium in Chromium p50 = 60 FPS; Mittel 55,7–60 unter Fremdlast |
| CSM-Kosten | `lighting-csm` gegen `lighting-nocsm` (ruhigere Läufe): GPU p50 5,2–5,9 gegen 4,4–5,1 ms → ≈ 0,5–1,0 ms; Schatten-Segment 0,34–0,98 ms | ✅ ≤ 2,5 ms (Obergrenze, unter Fremdlast) |
| 20 Schilde | `shields` gegen `shields-nofx`: GPU p50 11,7 gegen 5,1–5,2 ms. Die Differenz (≈ 6,5 ms) enthält Schilde, ≈ 200 Partikel und die Trails **und** das Timer-Artefakt von ANGLE-Metal (s. u.) | ⚠️ im fx-lab nicht belastbar messbar; Smoke rfx-p4: 0,19 ms realistisch, 0,55–0,62 ms Overdraw-Worst-Case bei 960 × 540 |

**Timer-Artefakt ANGLE-Metal:** Jedes nicht leere GPU-Segment innerhalb des Szenen-Passes misst ≈ 1,8–2,4 ms,
unabhängig vom Inhalt (Schilde 2,35, Partikel 1,8 bei 200 Partikeln, Trails 2,4, Post 2,4 ms im selben Frame); leere
Segmente messen 0. Die Timer-Query-Grenzen fallen offenbar auf Metal-Command-Buffer-/Encoder-Grenzen (schon in
rfx-p2 beobachtet: „Timer-Segmente enthalten Command-Buffer-Lücken“). Segmentwerte sind deshalb Obergrenzen, und
Differenzen „mit/ohne FX“ enthalten je FX-Segment einen solchen Sockel. Für die MS13-Abnahme „20 Schilde ≤ 1 ms“
braucht es eine Messung mit einem einzigen Segment um alle FX-Passes (Vorschlag unter „Offene Punkte“) auf einer
ruhigen Maschine. Firefox und WebKit haben headless keine Timer-Query (GPU „n/v“).

Nachmessen, sobald die GPU frei ist:
`tools/heavy pnpm bench:fx -- --update-docs` (wartet je Szenario bis 240 s auf Ruhe) bzw. gezielt
`tools/heavy pnpm bench:fx -- --browsers=chromium --scenarios=shields,shields-nofx,lighting-csm,lighting-nocsm`.


<!-- fx:results:begin -->
_Automatisch erzeugt von `pnpm bench:fx -- --update-docs` – lokal gemessen, Apple M5 Pro, kein Iris Xe (DECISIONS 5)._

Szenarien:

- `battle`: 2×200-Gefecht, Medium (HDR, Bloom, FXAA, CSM), Kameraflug (`scene=battle&preset=medium&flight=1`)
- `battle-nofx`: wie battle, aber ohne transparente FX (fx=0) → GPU-Differenz = Kosten von Partikeln, Beams und Trails (`scene=battle&preset=medium&flight=1&fx=0`)
- `battle-low`: Gefecht mit Preset Low (Partikel-Cap 8.192 greift) (`scene=battle&preset=low&flight=1`)
- `battle-ldr`: Gefecht, Medium mit LDR-Fallback (hdr=0) (`scene=battle&preset=medium&hdr=0&flight=1`)
- `shields`: 20 Schilde unter Beschuss (Ziel: Schild-Segment ≤ 1 ms GPU) (`scene=shields&preset=medium`)
- `shields-nofx`: wie shields, aber ohne transparente FX (fx=0) → GPU-Differenz = Kosten der 20 Schilde (+ Partikel/Trails) (`scene=shields&preset=medium&fx=0`)
- `big`: Kommandanten-Explosion mit Schockwelle und Kamera-Shake, alle 4 s neu ausgelöst (`scene=big&preset=medium`)
- `lighting-csm`: Licht-Szene mit CSM (2 Kaskaden, statischer Cache), Kameraflug (`scene=lighting&preset=medium&csm=1&flight=1`)
- `lighting-nocsm`: Licht-Szene ohne CSM (Vergleich → CSM-Kosten) (`scene=lighting&preset=medium&csm=0&flight=1`)

Wertebereiche über 5 Volllauf/Volläufe (2026-09-30 … 2026-09-30); GPU-Werte aus Läufen ohne erkannte Fremdlast; ⚠️ = es gibt nur Läufe mit Fremdlast (Obergrenze, nicht belastbar):

| Browser | Szenario | Läufe (ohne Fremdlast) | FPS | Main-JS p95 (WebKit Ø) | FX-JS p95 (WebKit Ø) | Draws max (FX) | GPU p50 | GPU p95 | shields p50 | particles p50 | shadow p50 | post p50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| chromium | battle | 5 (0) | 23,8–60,0 | 0,34–1,62 ms | 0,16–0,58 ms | 19 (3) | ⚠️ 14,01–168,69 ms | ⚠️ 25,82–1173,49 ms | ⚠️ 0,00 ms | ⚠️ 3,37–38,81 ms | ⚠️ 0,34–24,02 ms | ⚠️ 3,17–19,39 ms |
| chromium | battle-low | 3 (0) | 26,1–60,0 | 0,31–0,75 ms | 0,14–0,30 ms | 19 (3) | ⚠️ 11,91–154,41 ms | ⚠️ 20,48–862,40 ms | ⚠️ 0,00 ms | ⚠️ 1,71–36,21 ms | ⚠️ 0,19–27,39 ms | ⚠️ 2,46–21,33 ms |
| chromium | battle-ldr | 3 (0) | 27,4–55,7 | 0,34–0,63 ms | 0,16–0,25 ms | 19 (3) | ⚠️ 13,35–189,45 ms | ⚠️ 25,30–772,25 ms | ⚠️ 0,00 ms | ⚠️ 3,32–45,75 ms | ⚠️ 0,34–27,97 ms | ⚠️ 3,08–21,99 ms |
| chromium | shields | 5 (0) | 34,1–60,0 | 0,17–0,77 ms | 0,10–0,42 ms | 19 (3) | ⚠️ 11,62–127,43 ms | ⚠️ 14,63–756,89 ms | ⚠️ 2,35–27,09 ms | ⚠️ 1,72–4,41 ms | ⚠️ 0,47–12,31 ms | ⚠️ 2,34–9,02 ms |
| chromium | big | 3 (0) | 25,5–59,9 | 0,16–0,33 ms | 0,07–0,16 ms | 17 (1) | ⚠️ 10,26–127,94 ms | ⚠️ 19,59–384,18 ms | ⚠️ 0,00 ms | ⚠️ 2,84–18,36 ms | ⚠️ 0,33–32,26 ms | ⚠️ 2,99–29,81 ms |
| chromium | lighting-csm | 5 (0) | 38,4–60,0 | 0,26–0,56 ms | 0,12–0,28 ms | 16 (0) | ⚠️ 5,19–62,14 ms | ⚠️ 9,13–268,94 ms | ⚠️ 0,00 ms | ⚠️ 0,00 ms | ⚠️ 0,37–17,03 ms | ⚠️ 2,40–14,76 ms |
| chromium | lighting-nocsm | 5 (0) | 41,5–60,0 | 0,13–0,66 ms | 0,05–0,26 ms | 14 (0) | ⚠️ 4,44–47,88 ms | ⚠️ 5,73–139,00 ms | ⚠️ 0,00 ms | ⚠️ 0,00 ms | ⚠️ 0,00 ms | ⚠️ 0,69–18,44 ms |
| firefox | battle | 3 (0) | 29,2–55,0 | 0,60–0,80 ms | 0,26–0,34 ms | 19 (3) | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | battle-low | 3 (0) | 42,1–60,0 | 0,58–0,74 ms | 0,24–0,28 ms | 19 (3) | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | battle-ldr | 3 (0) | 56,5–60,0 | 0,50–0,54 ms | 0,22–0,24 ms | 19 (3) | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | shields | 3 (2) | 56,8–60,0 | 0,30–1,26 ms | 0,20–0,66 ms | 19 (3) | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | big | 3 (3) | 42,5–60,0 | 0,32–0,66 ms | 0,16–0,34 ms | 17 (1) | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | lighting-csm | 3 (0) | 24,2–60,0 | 0,34–0,56 ms | 0,18–0,32 ms | 16 (0) | n/v | n/v | n/v | n/v | n/v | n/v |
| firefox | lighting-nocsm | 3 (0) | 46,9–60,0 | 0,24–0,40 ms | 0,10–0,16 ms | 14 (0) | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | battle | 3 (2) | 21,9–60,0 | 0,38–0,67 ms | 0,12–0,31 ms | 19 (3) | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | battle-low | 3 (2) | 24,6–60,0 | 0,23–0,59 ms | 0,09–0,25 ms | 19 (3) | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | battle-ldr | 3 (1) | 21,3–60,0 | 0,29–0,59 ms | 0,12–0,26 ms | 19 (3) | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | shields | 3 (1) | 28,3–57,0 | 0,19–0,36 ms | 0,07–0,19 ms | 19 (3) | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | big | 3 (0) | 21,0–60,0 | 0,16–0,26 ms | 0,08–0,14 ms | 17 (1) | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | lighting-csm | 3 (2) | 27,0–60,0 | 0,15–0,27 ms | 0,06–0,17 ms | 16 (0) | n/v | n/v | n/v | n/v | n/v | n/v |
| webkit | lighting-nocsm | 3 (1) | 30,4–60,0 | 0,07–0,21 ms | 0,05–0,07 ms | 14 (0) | n/v | n/v | n/v | n/v | n/v | n/v |
| chromium | battle-nofx | 2 (0) | 55,7–57,4 | 0,38–0,52 ms | 0,15–0,22 ms | 16 (0) | ⚠️ 3,37–6,40 ms | ⚠️ 10,22–10,30 ms | ⚠️ 0,00 ms | ⚠️ 0,00 ms | ⚠️ 0,37–0,49 ms | ⚠️ 0,73–2,84 ms |
| chromium | shields-nofx | 2 (0) | 59,9–60,0 | 0,17–0,19 ms | 0,10–0,13 ms | 16 (0) | ⚠️ 5,14–5,23 ms | ⚠️ 8,30–8,38 ms | ⚠️ 0,00 ms | ⚠️ 0,00 ms | ⚠️ 0,73–0,94 ms | ⚠️ 2,31–2,40 ms |

Letzter Lauf im Detail:

Lauf 2026-09-30 03:37 UTC (voll), lokal gemessen (Apple M5 Pro, Playwright headless), kein Iris Xe/echtes Safari; Viewport 1920×1080 @1x, 2 s Warm-up + 8 s Messung je Szenario, Seed 1.
Last: loadavg vorher 10,1/5,5/4,7, nachher 3,9/4,1/4,4; parallel: 23 Prozess(e) (playwright · 3.2 % · /Users/lo, ms-playwright · 16.5 % · /User, ms-playwright · 9.9 % · /Users +19).

| Browser | Szenario | Frames / FPS | Frame p50 / p95 / p99 | Main-JS p50 / p95 / p99 | FX-JS p50 / p95 / p99 | Lab-JS p50 | Draws p50 / max (FX max) | GPU gesamt p50 / p95 | Partikel alive p50 / max | dropped P0 / P1 / P2 | Fremdlast | Draw-Budget |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| chromium 153.0.8010.12 | battle | 411 / 55,7 | 16,7 / 16,7 / 16,7 ms | 0,23 / 0,73 / 0,88 ms | 0,09 / 0,28 / 0,37 ms | 0,09 ms | 18 / 19 (3) | 14,01 / 25,82 ms | 7.514 / 8.286 (Cap 16.384) | 0 / 0 / 0 | ⚠️ vitest, playwright test | ✅ |
| chromium 153.0.8010.12 | battle-low | 410 / 57,7 | 16,7 / 16,7 / 16,7 ms | 0,22 / 0,31 / 0,41 ms | 0,09 / 0,14 / 0,23 ms | 0,08 ms | 18 / 19 (3) | 14,87 / 20,48 ms | 6.142 / 6.219 (Cap 8.192) | 0 / 0 / 7.531 | ⚠️ playwright test | ✅ |
| chromium 153.0.8010.12 | battle-ldr | 415 / 55,7 | 16,7 / 16,7 / 16,7 ms | 0,22 / 0,34 / 0,47 ms | 0,09 / 0,16 / 0,22 ms | 0,08 ms | 18 / 19 (3) | 13,35 / 25,30 ms | 7.524 / 8.286 (Cap 16.384) | 0 / 0 / 0 | ⚠️ playwright test | ✅ |
| chromium 153.0.8010.12 | shields | 480 / 60,0 | 16,7 / 16,7 / 16,7 ms | 0,13 / 0,17 / 0,21 ms | 0,06 / 0,10 / 0,13 ms | 0,01 ms | 19 / 19 (3) | 11,62 / 14,63 ms | 204 / 482 (Cap 16.384) | 0 / 0 / 0 | ⚠️ playwright test | ✅ |
| chromium 153.0.8010.12 | big | 479 / 59,9 | 16,7 / 16,7 / 16,7 ms | 0,11 / 0,16 / 0,20 ms | 0,05 / 0,07 / 0,09 ms | 0,02 ms | 17 / 17 (1) | 10,42 / 19,59 ms | 2.366 / 3.444 (Cap 16.384) | 0 / 0 / 0 | ⚠️ playwright test | ✅ |
| chromium 153.0.8010.12 | lighting-csm | 457 / 58,2 | 16,7 / 16,7 / 16,7 ms | 0,04 / 0,48 / 0,60 ms | 0,02 / 0,24 / 0,30 ms | 0,00 ms | 16 / 16 (0) | 5,19 / 10,35 ms | 0 / 0 (Cap 16.384) | 0 / 0 / 0 | ⚠️ h3mlx | ✅ |
| chromium 153.0.8010.12 | lighting-nocsm | 480 / 60,0 | 16,7 / 16,7 / 16,7 ms | 0,07 / 0,13 / 0,29 ms | 0,03 / 0,05 / 0,10 ms | 0,00 ms | 14 / 14 (0) | 5,09 / 8,91 ms | 0 / 0 (Cap 16.384) | 0 / 0 / 0 | ⚠️ playwright test | ✅ |
| firefox 155.0 | battle | 406 / 55,0 | 16,7 / 16,9 / 17,5 ms | 0,30 / 0,60 / 0,78 ms | 0,12 / 0,26 / 0,36 ms | 0,12 ms | 18 / 19 (3) | n/v | 7.497 / 8.233 (Cap 16.384) | 0 / 0 / 0 | ⚠️ playwright test | ✅ |
| firefox 155.0 | battle-low | 365 / 54,6 | 16,7 / 16,7 / 17,4 ms | 0,32 / 0,58 / 0,74 ms | 0,12 / 0,24 / 0,34 ms | 0,12 ms | 18 / 19 (3) | n/v | 6.138 / 6.219 (Cap 8.192) | 0 / 0 / 6.261 | ⚠️ playwright test | ✅ |
| firefox 155.0 | battle-ldr | 295 / 56,5 | 16,7 / 16,8 / 17,6 ms | 0,24 / 0,50 / 0,78 ms | 0,10 / 0,22 / 0,34 ms | 0,10 ms | 18 / 19 (3) | n/v | 6.790 / 7.962 (Cap 16.384) | 0 / 0 / 0 | ⚠️ vitest | ✅ |
| firefox 155.0 | shields | 455 / 56,8 | 16,7 / 32,9 / 33,3 ms | 0,22 / 1,26 / 1,84 ms | 0,14 / 0,66 / 1,02 ms | 0,02 ms | 19 / 19 (3) | n/v | 207 / 468 (Cap 16.384) | 0 / 0 / 0 | keine | ✅ |
| firefox 155.0 | big | 459 / 57,8 | 16,7 / 16,7 / 17,3 ms | 0,12 / 0,32 / 0,44 ms | 0,06 / 0,16 / 0,22 ms | 0,02 ms | 17 / 17 (1) | n/v | 2.413 / 3.450 (Cap 16.384) | 0 / 0 / 0 | keine | ✅ |
| firefox 155.0 | lighting-csm | 192 / 24,2 | 16,7 / 66,7 / 100,0 ms | 0,18 / 0,36 / 0,58 ms | 0,10 / 0,20 / 0,34 ms | 0,02 ms | 16 / 16 (0) | n/v | 0 / 0 (Cap 16.384) | 0 / 0 / 0 | ⚠️ playwright test, GPU-Auslastung 84 % | ✅ |
| firefox 155.0 | lighting-nocsm | 422 / 57,0 | 16,7 / 16,7 / 17,1 ms | 0,14 / 0,24 / 0,38 ms | 0,06 / 0,10 / 0,14 ms | 0,00 ms | 14 / 14 (0) | n/v | 0 / 0 (Cap 16.384) | 0 / 0 / 0 | ⚠️ playwright test, h3mlx | ✅ |
| webkit 26.6 | battle | 423 / 57,7 | 17,0 / 18,0 / 18,0 ms | Ø 0,38 ms | Ø 0,22 ms | Ø 0,08 ms | 18 / 19 (3) | n/v | 7.525 / 8.521 (Cap 16.384) | 0 / 0 / 0 | keine | ✅ |
| webkit 26.6 | battle-low | 365 / 54,5 | 17,0 / 18,0 / 19,0 ms | Ø 0,35 ms | Ø 0,19 ms | Ø 0,12 ms | 18 / 19 (3) | n/v | 6.137 / 6.219 (Cap 8.192) | 0 / 0 / 6.163 | keine | ✅ |
| webkit 26.6 | battle-ldr | 419 / 57,7 | 17,0 / 18,0 / 19,0 ms | Ø 0,35 ms | Ø 0,12 ms | Ø 0,19 ms | 18 / 19 (3) | n/v | 7.525 / 8.286 (Cap 16.384) | 0 / 0 / 0 | ⚠️ playwright test | ✅ |
| webkit 26.6 | shields | 299 / 56,9 | 17,0 / 18,0 / 19,0 ms | Ø 0,19 ms | Ø 0,07 ms | Ø 0,05 ms | 19 / 19 (3) | n/v | 172 / 379 (Cap 16.384) | 0 / 0 / 0 | ⚠️ playwright test, h3mlx | ✅ |
| webkit 26.6 | big | 480 / 60,0 | 17,0 / 18,0 / 19,0 ms | Ø 0,26 ms | Ø 0,14 ms | Ø 0,03 ms | 17 / 17 (1) | n/v | 2.353 / 3.445 (Cap 16.384) | 0 / 0 / 0 | ⚠️ playwright test | ✅ |
| webkit 26.6 | lighting-csm | 480 / 60,0 | 17,0 / 18,0 / 18,0 ms | Ø 0,27 ms | Ø 0,17 ms | Ø 0,02 ms | 16 / 16 (0) | n/v | 0 / 0 (Cap 16.384) | 0 / 0 / 0 | ⚠️ h3mlx, playwright test | ✅ |
| webkit 26.6 | lighting-nocsm | 482 / 60,0 | 17,0 / 18,0 / 18,0 ms | Ø 0,17 ms | Ø 0,05 ms | Ø 0,02 ms | 14 / 14 (0) | n/v | 0 / 0 (Cap 16.384) | 0 / 0 / 0 | ⚠️ playwright test | ✅ |

GPU-Zeit je Segment (EXT_disjoint_timer_query_webgl2, p50 / p95 in ms; nur wo verfügbar, sonst n/v):

| Browser | Szenario | shadow | opaque | shields | particles | beams | post | gesamt |
|---|---|---|---|---|---|---|---|---|
| chromium | battle | 0,34 / 6,66 | 2,23 / 6,98 | 0,00 / 0,00 | 3,37 / 6,72 | 3,25 / 6,96 | 3,17 / 6,83 | 14,01 / 25,82 |
| chromium | battle-low | 0,19 / 5,25 | 2,13 / 6,01 | 0,00 / 0,00 | 3,58 / 4,66 | 3,69 / 4,73 | 3,73 / 4,68 | 14,87 / 20,48 |
| chromium | battle-ldr | 0,34 / 5,80 | 2,19 / 7,05 | 0,00 / 0,00 | 3,32 / 6,74 | 3,28 / 6,95 | 3,08 / 6,92 | 13,35 / 25,30 |
| chromium | shields | 0,98 / 3,17 | 2,25 / 5,06 | 2,35 / 3,30 | 1,84 / 2,05 | 2,39 / 2,64 | 2,43 / 2,64 | 11,62 / 14,63 |
| chromium | big | 0,33 / 6,20 | 1,65 / 7,45 | 0,00 / 0,00 | 3,11 / 6,29 | 0,00 / 0,00 | 3,16 / 6,73 | 10,42 / 19,59 |
| chromium | lighting-csm | 0,37 / 3,03 | 2,34 / 4,83 | 0,00 / 0,00 | 0,00 / 0,00 | 0,00 / 0,00 | 2,40 / 2,90 | 5,19 / 10,35 |
| chromium | lighting-nocsm | 0,00 / 0,01 | 2,44 / 4,85 | 0,00 / 0,00 | 0,00 / 0,00 | 0,00 / 0,00 | 2,23 / 4,36 | 5,09 / 8,91 |

Draws je Segment (Maximum), FX-Zustand und Post (letzter Frame):

| Browser | Szenario | shadow | opaque | shields | particles | beams | post | Units | Schilde / Ripples max | Beams / Trails max | Decals | Post | CSM (stat. Neuaufbauten) | Canvas |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| chromium | battle | 2 | 3 | 0 | 1 | 2 | 11 | 519 | 0 / 0 | 7 / 66 | 206/256 | HDR + Bloom 5 + FXAA | an (0) | 1536×864 |
| chromium | battle-low | 2 | 3 | 0 | 1 | 2 | 11 | 520 | 0 / 0 | 7 / 62 | 128/128 | HDR + Bloom 5 + FXAA | an (0) | 1267×713 |
| chromium | battle-ldr | 2 | 3 | 0 | 1 | 2 | 11 | 517 | 0 / 0 | 7 / 66 | 206/256 | LDR + Bloom 5 + FXAA | an (0) | 1536×864 |
| chromium | shields | 2 | 3 | 1 | 1 | 1 | 11 | 44 | 20 / 12 | 0 / 41 | 18/256 | HDR + Bloom 5 + FXAA | an (0) | 1536×864 |
| chromium | big | 2 | 3 | 0 | 1 | 0 | 11 | 36 | 0 / 0 | 0 / 0 | 118/256 | HDR + Bloom 5 + FXAA | an (0) | 1536×864 |
| chromium | lighting-csm | 2 | 3 | 0 | 0 | 0 | 11 | 47 | 0 / 0 | 0 / 0 | 30/256 | HDR + Bloom 5 + FXAA | an (0) | 1536×864 |
| chromium | lighting-nocsm | 0 | 3 | 0 | 0 | 0 | 11 | 47 | 0 / 0 | 0 / 0 | 30/256 | HDR + Bloom 5 + FXAA | aus | 1536×864 |
| firefox | battle | 2 | 3 | 0 | 1 | 2 | 11 | 520 | 0 / 0 | 7 / 62 | 204/256 | HDR + Bloom 5 + FXAA | an (0) | 1536×864 |
| firefox | battle-low | 2 | 3 | 0 | 1 | 2 | 11 | 517 | 0 / 0 | 7 / 62 | 128/128 | HDR + Bloom 5 + FXAA | an (0) | 1267×713 |
| firefox | battle-ldr | 2 | 3 | 0 | 1 | 2 | 11 | 514 | 0 / 0 | 6 / 61 | 176/256 | LDR + Bloom 5 + FXAA | an (0) | 1536×864 |
| firefox | shields | 2 | 3 | 1 | 1 | 1 | 11 | 44 | 20 / 13 | 0 / 43 | 18/256 | HDR + Bloom 5 + FXAA | an (0) | 1536×864 |
| firefox | big | 2 | 3 | 0 | 1 | 0 | 11 | 36 | 0 / 0 | 0 / 0 | 118/256 | HDR + Bloom 5 + FXAA | an (0) | 1536×864 |
| firefox | lighting-csm | 2 | 3 | 0 | 0 | 0 | 11 | 47 | 0 / 0 | 0 / 0 | 30/256 | HDR + Bloom 5 + FXAA | an (0) | 1536×864 |
| firefox | lighting-nocsm | 0 | 3 | 0 | 0 | 0 | 11 | 47 | 0 / 0 | 0 / 0 | 30/256 | HDR + Bloom 5 + FXAA | aus | 1536×864 |
| webkit | battle | 2 | 3 | 0 | 1 | 2 | 11 | 519 | 0 / 0 | 7 / 66 | 214/256 | HDR + Bloom 5 + FXAA | an (0) | 1536×864 |
| webkit | battle-low | 2 | 3 | 0 | 1 | 2 | 11 | 517 | 0 / 0 | 7 / 62 | 128/128 | HDR + Bloom 5 + FXAA | an (0) | 1267×713 |
| webkit | battle-ldr | 2 | 3 | 0 | 1 | 2 | 11 | 517 | 0 / 0 | 7 / 64 | 206/256 | LDR + Bloom 5 + FXAA | an (0) | 1536×864 |
| webkit | shields | 2 | 3 | 1 | 1 | 1 | 11 | 44 | 20 / 11 | 0 / 42 | 6/256 | HDR + Bloom 5 + FXAA | an (0) | 1536×864 |
| webkit | big | 2 | 3 | 0 | 1 | 0 | 11 | 36 | 0 / 0 | 0 / 0 | 118/256 | HDR + Bloom 5 + FXAA | an (0) | 1536×864 |
| webkit | lighting-csm | 2 | 3 | 0 | 0 | 0 | 11 | 47 | 0 / 0 | 0 / 0 | 30/256 | HDR + Bloom 5 + FXAA | an (0) | 1536×864 |
| webkit | lighting-nocsm | 0 | 3 | 0 | 0 | 0 | 11 | 47 | 0 / 0 | 0 / 0 | 30/256 | HDR + Bloom 5 + FXAA | aus | 1536×864 |

GPU/Treiber: chromium: ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version) (Timer-Query ja, COI ja); firefox: Apple M1, or similar (Timer-Query nein, COI ja); webkit: Apple GPU (Timer-Query nein, COI ja).
Draw-Budget: FX-Draws (shields + particles + beams) ≤ 6 und Gesamt ≤ 40 je Frame (Überschreitung = Bench-Fehler); ms-Werte sind Messung, kein Gate (DECISIONS 16). WebKit taktet `performance.now` in 1-ms-Schritten → dort Mittelwerte (Ø).

Browser-Hinweise (WebGL-Warnungen, keine Fehler):

- firefox/battle: [JavaScript Warning: "WEBGL_debug_renderer_info is deprecated in Firefox and will be removed. Please use RENDERER." {file: "debugger eval code line 311 > eval" line: 1}]
- firefox/battle: [JavaScript Warning: "WebGL context was lost." {file: "debugger eval code line 311 > eval" line: 1}]
- firefox/battle: [JavaScript Warning: "WebGL warning: drawArraysInstanced: Drawing without vertex attrib 0 array enabled forces the browser to do expensive emulation work when running on desktop OpenGL platforms, for example on Mac. It is preferable to always draw with vertex attrib 0 array enabled, by using bindAtt
- firefox/battle: [JavaScript Warning: "WebGL warning: drawArraysInstanced: Depth texture comparison requests (e.g. `LINEAR`) Filtering, but behavior is implementation-defined, and so on some systems will sometimes behave as `NEAREST`. (warns once)"]
- firefox/battle-low: [JavaScript Warning: "WEBGL_debug_renderer_info is deprecated in Firefox and will be removed. Please use RENDERER." {file: "debugger eval code line 311 > eval" line: 1}]
- firefox/battle-low: [JavaScript Warning: "WebGL context was lost." {file: "debugger eval code line 311 > eval" line: 1}]
- firefox/battle-low: [JavaScript Warning: "WebGL warning: drawArraysInstanced: Drawing without vertex attrib 0 array enabled forces the browser to do expensive emulation work when running on desktop OpenGL platforms, for example on Mac. It is preferable to always draw with vertex attrib 0 array enabled, by using bindAtt
- firefox/battle-low: [JavaScript Warning: "WebGL warning: drawArraysInstanced: Depth texture comparison requests (e.g. `LINEAR`) Filtering, but behavior is implementation-defined, and so on some systems will sometimes behave as `NEAREST`. (warns once)"]
- firefox/battle-ldr: [JavaScript Warning: "WEBGL_debug_renderer_info is deprecated in Firefox and will be removed. Please use RENDERER." {file: "debugger eval code line 311 > eval" line: 1}]
- firefox/battle-ldr: [JavaScript Warning: "WebGL context was lost." {file: "debugger eval code line 311 > eval" line: 1}]
<!-- fx:results:end -->

## 6. Playwright-E2E und Screenshots

`FAF_E2E_PORT=4683 tools/heavy pnpm test:e2e:fx` = `pnpm --filter @faf/fx-lab run build && playwright test -c
apps/fx-lab/playwright.config.ts`. Konfiguration: `testDir` `apps/fx-lab/test/e2e`, `testMatch` `*.spec.ts`
(die Vitest-Tests der Bench-Helfer im selben Ordner heißen `*.test.ts`), `outputDir` `test-results/fx-lab-e2e`,
1 Worker, `fullyParallel: false`, `retries: 0`, Projekte chromium/firefox/webkit mit den Launch-Optionen der
Root-Config (ANGLE/Metal, Firefox `CFFIXED_USER_HOME`), Viewport 1280 × 720 bei DPR 1 (auch für „Desktop Safari“),
Web-Server `pnpm --filter @faf/fx-lab exec vite preview --host 127.0.0.1 --port <PORT> --strictPort` mit
`PORT = FAF_E2E_PORT ?? 4683`, `reuseExistingServer: false`. PNG-Auswertung in Node (`scripts/bench/png.ts`, zlib).

| Spec | Prüfungen |
|---|---|
| `scenes.spec.ts` | je Szene mit `freeze` (lighting 6, battle 12, shields 6, big 1,3, gallery 3): ready, keine Seiten-/GL-Konsolenfehler, `__fxlab.error` null, Szene aktiv, Canvas nicht einfarbig (Luma-Spanne ≥ 12), Screenshot `shots/<szene>-<browser>.png`; lighting: CSM an, Decals, HDR; battle: alive > 3.000, FX-Draws ≤ 6, Gesamt ≤ 40, ≥ 380 Einheiten, HDR; shields: 20 Schilde, ripplesActive > 0, 1 Schild-Draw; big: `shakeActive`, > 200 Partikel, > 3 % sehr helle Pixel (Luma ≥ 235) in den mittleren 40 %, Mitte heller als das Bild; gallery: `scene.effects == VARKAN_EFFECTS.length` (21), Partikel > 0 |
| `cap.spec.ts` | battle `preset=low`, `freeze=10`: cap 8.192, `dropped[2] > 0`, `dropped[0] == 0`, alive ≤ cap + 256 (Prio-0-Überschuss: 2 Kommandanten × 112, aufgerundet), alive > cap/2 |
| `fallback.spec.ts` | `hdr=0`: `stats.post.hdr` false, Partikel > 0, Bild nicht schwarz (mittlere Luma > 20, < 50 % schwarze Pixel); ohne `EXT_color_buffer_float` (per `addInitScript` aus `getExtension`/`getSupportedExtensions` entfernt, in allen drei Browsern): automatisch LDR, Bloom läuft weiter, Bild korrekt |
| `context-loss.spec.ts` | battle `freeze=8`: Screenshot → `loseContext()` → `restoreContext()` (pollen) → `restoreCount == 1`, Frames laufen weiter, Partikel > 0, keine Fehler, Bild nicht schwarz und **gleich dem Bild vor dem Verlust** (mittlere Kanal-Abweichung < 3/255; gemessen 0,00 in allen drei Browsern) – verlorene Ring-/LUT-/Scorch-/Schild-/Post-/CSM-Inhalte wären sichtbar; übersprungen, wenn `WEBGL_lose_context` fehlt (kam nicht vor) |
| `latency.spec.ts` | MS5 „VFX ≤ 1 Frame“: big ohne freeze, nach einem rAF `triggerBigExplosion()`, beim nächsten rAF genau 1 Frame weiter und `particlesAlive` im Sample dieses Frames um ≥ 50 gestiegen (gemessen 0 → 910 in Chromium) |

**Ergebnis (2026-09-30, Abschlusslauf):** 30/30 bestanden (10 Tests in 5 Specs × Chromium, Firefox, WebKit), 0 übersprungen, 57 s. Messwerte aus den Annotationen, in allen drei Browsern identisch:
cap: alive 6.185 / Cap 8.192, dropped 0/0/10.138, culled 501; context-loss: mittlere Abweichung 0,00/255;
latency: `particlesAlive` 0 → 910 im nächsten Frame (genau 1 Frame nach dem Auslösen); big: 5,5 % sehr helle und
8,2 % feuerfarbene Pixel in der Bildmitte; gallery: `effects` 21.

**Screenshots angesehen** (`test-results/fx-lab-e2e/shots/`, 1280 × 720, und `test-results/fx-bench/`, 1920 × 1080):

- `battle-*`: dichtes, diagonales Gefecht, Blau gegen Rot; Mündungsblitze, Tracer-Streaks, Einschlagfunken, graue
  Rauchsäulen über Wracks und angeschlagenen Einheiten, Scorch unter der Front; Chromium/Firefox/WebKit gleich.
- `shields-*`: 20 Kugeln mit Wabenmuster und Fresnel-Rand, ein Ripple-Blitz rechts unten, der kollabierende Schild 7
  orange-rot (Low-HP); Artillerie-Tracer von beiden Seiten.
- `big-*` (t = 1,3 s): weißer Feuerball mit Bloom in der Mitte, flacher cremeweißer Stoßring am Boden, Strukturen mit
  Glutnähten, lange Schatten. Bench-Aufnahme (`webkit-big`, später im Zyklus): Pilz aus dunklem Rauch, Feuerbälle der
  Strukturen mit Krater-Glut, Trümmer und Funken – gut lesbar.
- `gallery-*`: Kommandanten-Explosion hinten, Kachelreihen mit Explosionen, Einschlägen, Funken und Mündungsfeuer,
  vorne Gießstrom und Reclaim-Strom als orange Ströme. Aus der Übersicht sind kleine Effekte nur wenige Pixel groß
  (Nahaufnahmen per `cam=` in rfx-p6).
- `lighting-*`: weiche CSM-Schatten, Scorch/Krater mit Glut, Teamfarben.
- `fallback-hdr0-*`/`fallback-nofloat-*`: LDR ohne Tonemapping und Hof, Feuer gesättigt orange, Szene etwas flacher,
  sonst vollständig; kein Schwarzbild.
- `context-before-*`/`context-restored-*`: pixelgleich (Δ 0,00).
- Kein Browser zeigt Artefakte (NaN-Pixel, Z-Fighting, fehlende Passes).


## 7. Abnahme-Checkliste (gegen `docs/plans/TRACK-RENDERFX.json`, acceptance)

| # | Kriterium | Status | Beleg |
|---|---|---|---|
| 1 | Paketgrenzen laut dependency-cruiser, render importiert render-fx nicht, fx-lab ohne sim/sim-host/client, `git diff … -- packages/render tools/render-bench` leer | ✅ | `pnpm lint`: „no dependency violations found (544 modules, 2006 dependencies)“; `git diff --exit-code $(git merge-base HEAD main) -- packages/render tools/render-bench` → 0 |
| 2 | install/typecheck/lint/test grün; Unit-Tests für core, effects, decals, post, light, particles, trails, shields, lab-app, Szenen | ✅ | §12: `pnpm test` 128 Dateien / 1.225 Tests grün; Testordner `packages/render-fx/test/{core,effects,decals,post,light,particles,trails,shields}`, `apps/fx-lab/test/{app,scenes,e2e}` |
| 3 | GPU-Partikel: Ring 65.536, f(t−t0) im VS, LUT RGBA16F, nur neue Records hochladen, 1 Draw (2 bei Umlauf), GLSL-Spiegel == CPU-Referenz (10.000 Fälle), GPU-Position ±2 px | ✅ | rfx-p3 Tests (`system.test.ts`, `mirror.test.ts`), Smoke `particles` in 3 Browsern inkl. Restore (§12) |
| 4 | Prioritäten/Caps je Preset, P2 zuerst, P0 nie; battle Low: dropped[2] > 0, dropped[0] = 0, alive ≤ Cap + Überschuss | ✅ | Unit-Tests rfx-p3; `cap.spec` 3 Browser (alive 6.185 / 8.192, dropped 0/0/10.138); Bench `battle-low` |
| 5 | ≥ 18 Varkan-Effekte inkl. ACU mit Shake, VARKAN_EVENT_FX, Budgets (Test), Galerie in 3 Browsern sichtbar und geprüft | ✅ | 21 Effekte (§3), `varkan.test.ts`; `scenes.spec` gallery (`effects` 21) + Screenshots `gallery-{chromium,firefox,webkit}.png` (§6) |
| 6 | Beams/Trails instanziert (je 1 Draw, Kopf aus prev/cur), Schilde Fresnel + 4 Ripples in 1 Draw; 20 Schilde ≤ 1 ms GPU in Chromium | ⚠️ | Draw-Teil ✅ (rfx-p4-Tests, `scenes.spec` shields: 1 Draw, 20 Schilde, Ripples). GPU-Teil nur aus dem Smoke (0,19 ms realistisch, 0,55–0,62 ms Worst Case bei 960 × 540); im fx-lab durch Fremdlast und ANGLE-Metal-Timer-Sockel nicht belastbar (§5.1) |
| 7 | Scorch-/Krater-Decals: Pool mit Cap, Ausblenden, Chunk-Binning == Brute-Force, im fx-lab-Boden sichtbar, Integrationsanleitung | ✅ | rfx-p1-Tests (`decals`), Screenshots lighting/battle, §8.2 |
| 8 | HDR + Bloom + ACES + FXAA, LDR-Fallback ohne Fehler (Unit + E2E), CSM 2 Kaskaden mit statischem Cache (0 Neuaufbauten bei ruhender Kamera), dynamische Caster je Frame, CSM ≤ 2,5 ms | ✅ | rfx-p2-Tests; `fallback.spec` (hdr=0 und ohne EXT_color_buffer_float, 3 Browser); CSM-Differenz ≈ 0,5–1,0 ms (§5.1, Obergrenze unter Fremdlast) |
| 9 | Context-Loss: alle FX-Ressourcen laufen wieder, Partikel sichtbar, keine GL-Fehler (Smoke aller Module + E2E in 3 Browsern) | ✅ | Smoke core/light/particles/post/shields/trails „context loss passed“ ×3 Browser; `context-loss.spec` Bild vorher = nachher (Δ 0,00) |
| 10 | fx-lab mit battle/shields/big/gallery/lighting; battle Chromium Medium ≥ 60 FPS (vsync); FX-Draws ≤ 6, gesamt ≤ 40 (Bench-Fehler sonst); Effekt ≤ 1 Frame nach Auslösung | ✅ | Szenen §4; Bench battle Chromium Frame-p50 16,7 ms (60 FPS), Mittel 55,7–60 unter Fremdlast; Draws max 19 (FX 3); `latency.spec` 3 Browser |
| 11 | `pnpm bench:fx` (3 Browser nacheinander, Draws, GPU gesamt/Segment wo verfügbar, JS p50/p95/p99, Partikel), JSON-Bericht, `--update-docs`, Exit nur bei Fehlern, „lokal gemessen“ | ✅ | §5, `apps/fx-lab/results/fx-*.json`, Marker-Block oben; Unit-Tests `bench-report.test.ts` |
| 12 | Playwright-E2E auf Port 4683, workers 1, grün in 3 Browsern, Screenshots geprüft und bewertet | ✅ | §6 (30/30) |
| 13 | Doku: track-renderfx.md mit Architektur, API, Messwerten, Abnahme, Integrationsanleitung MS5/7/13/14; Fragmente rfx-p*; DECISIONS-Nachtrag; STATUS-Verweis | ✅ | dieses Dokument; `docs/status/rfx-p0…p7-*.md`; DECISIONS 30–38; STATUS „Track RENDERFX (Vorarbeit)“ |

## 8. Integrationsanleitung

Grundsatz: Integriert werden die render-fx-Module, nicht die Lab-Pässe. Das fx-lab ist Vorlage für die Verdrahtung
(`apps/fx-lab/src/app/app.ts` für den Frame-Ablauf, `apps/fx-lab/src/scenes/fx.ts` für die LabFx-Verdrahtung mit
Ereignis-Helfern, `apps/fx-lab/src/app/ground.ts` für Scorch + Schatten im Boden-FS). Gemeinsame Vorarbeit für alle
Schritte, einmal in `packages/render/src/renderer.ts`:

1. **Abhängigkeitsrichtung bleibt:** render importiert render-fx nie (DECISIONS 30). Deshalb zwei Wege:
   - **MS5/MS7/MS13 – Hook statt Import:** render bekommt einen kleinen, render-fx-freien Erweiterungspunkt, z. B.
     `RendererOptions.fx?: RenderFxHooks` mit `update(view, camera): void` (nach dem Frame-UBO) und
     `encodeTransparent(enc: PassEncoder): number` (nach Units/Water, vor Overlay), dazu einen Getter
     `Renderer.frameUniformBuffer: BufH`. Die FX-Objekte (ParticleSystem, Trail-/Beam-/ShieldPass) leben im Client
     (`packages/client/src/fx.ts`, neu), der die Hooks implementiert. `Renderer.device` ist schon öffentlich.
   - **MS14 – Licht/Post wandern nach render:** Receiver-GLSL, CSM und PostChain greifen in Terrain-, Unit- und
     Prop-Shader ein; render müsste sie importieren. Daher `src/light` und `src/post` bei MS14 nach
     `packages/render/src/{light,post}` verschieben (reiner Move, API gleich) und in render-fx re-exportieren.
     Dasselbe gilt für `SCORCH_GLSL`/`ScorchDecals` bei der Zusammenführung mit render's Decal-Binning (MS7, §8.2).
2. `const fxFrame = new FxFrameUniforms(dev, { frameUbo: renderer.frameUniformBuffer })` im Client – schreibt nur den FxView-Block
   (Slot 6); `fxFrame.update(camera, { timeS: clientTimeS, dtS, alpha, viewport: [bw, bh] })` im Hook
   `update(view, camera)`, also nach dem Frame-UBO-Update in `Renderer.render()` (`view.timeMs / 1000` als Uhr;
   dieselbe Uhr für alle FX).
3. Die Bind-Groups der FX-Passes entstehen aus `fxFrame.bindings`; die Slot-Tabelle (§1.2) ist mit render's
   Belegung abgestimmt. Neue render-Slots aus MS3 (UBO 4/5, Units 8/9) kollidieren nicht.

### 8.1 MS5 – Event-Stream → Partikel, Kommandanten-Explosion, Projektil-Trails

PLAN MS5 sieht „einfache Event-Sprites“ vor; mit render-fx gibt es direkt die GPU-Partikel (die in MS7 geplant
waren). Dateien: `packages/client/src/client.ts` (`GameClient.frame`, `onNewFrame`), neu `packages/client/src/fx.ts`
(Client-FX-Controller, implementiert `RenderFxHooks`), `packages/render/src/renderer.ts` (Hook, s. o.).

- **Aufbau:** `lib = compileEffectLibrary(VARKAN_EFFECTS)`; `particles = new ParticleSystem(dev, fxFrame.bindings,
  lib, { cap: particleCapForPreset(preset), onShake: (e, pos, t) => shake.addFromEffect(e, rawToWuVec(pos), t) })`;
  `trails = new TrailPass(dev, bindings)`; `beams = new BeamPass(dev, bindings)`; `shake = new CameraShake()`.
  Effekt-Indizes einmal vorab auflösen (`lib.indexOf(VARKAN_EVENT_FX.weapon.cannon)` usw.), keine Strings im Frame.
- **Event-Stream (G13):** In `onNewFrame` jeden `EventRecord` des neuen Frames einmal abarbeiten (Frame-Sektion
  Events, 32 B: `type`, `visual`, `tick`, `subTick`, `pos` i32×3, `aux`, `handle`):
  - Waffe abgefeuert → `particles.spawn(muzzleIdx[visual], pos, { dir: aus aux bzw. Unit-Yaw, seed: handle ^ tick })`.
  - Einschlag → `VARKAN_EVENT_FX.impact.{ground|ground_large|unit|shield|water}` (Boden-Variante über
    `groundImpactForWeapon`), großer Einschlag zusätzlich `scorch.add(VARKAN_SCORCH.impact_large …)`.
  - Tod → `VARKAN_EVENT_FX.death.{small|medium|large|structure|acu}` nach Größenklasse aus der Visual-Tabelle;
    ACU → `acu_explosion` + `acu_aftermath` (Prio 0, Shake über `onShake`) und Krater `VARKAN_SCORCH.acu`.
  - Die benötigten Event-Felder: Größenklasse (aus `visual` über die Client-Visual-Tabelle), Wasser/Land am
    Einschlagpunkt (Client-Heightmap + Wasserhöhe), Trefferart Einheit/Boden/Schild (`type`), Armee für `tint`
    (`glowTintForArmyColor(armyColor).tint`).
  - `seed` immer aus Entity-Handle/Tick ableiten → identische Optik bei Replays.
- **Latenz ≤ 1 Frame:** Events vor `particles.encode()` desselben rAF spawnen (Test „frame protocol“ in rfx-p3,
  E2E `latency.spec.ts` im fx-lab). Die Spawn-Zeit ist die Client-Uhr des Frames, nicht die Tick-Zeit;
  für Events mit `subTick` ggf. `t0 = tickTimeS + subTick/256·tickS` über `spawn()` nach `update()`.
- **Kamera-Shake:** `shake.sample(nowS, cameraTargetWu)` in `GameClient.frame` vor `renderer.render`, Versatz auf das
  Kamera-Ziel (`CameraController`), `rollRad` erst, wenn `RtsCamera` eine Rollachse bekommt.
- **Projektile:** je Frame `trails.begin()`, dann für jeden `ProjectileRecord` (28 B: prevPos, curPos, visual, army,
  flags) `trails.add(prevRaw, curRaw, VARKAN_TRAIL_STYLES[styleOf(visual)])` direkt aus der Frame-Sicht (Int32Array,
  keine Kopie). Die Interpolation macht der VS mit `u_camFrac.w` (= `RenderView.alpha`). Raketen bekommen
  zusätzlich einen `missile_smoke_trail`-Emitter, der mit `moveEmitter` am interpolierten Kopf läuft
  (`trailEndpointsWu` ist der CPU-Spiegel) und beim Einschlag-Event endet.
- **Dauerzustände** je Entity-Handle (Map Handle → Emitter-Handle im Client, nicht im Frame): `UnitFlags.damaged` →
  `smoke_damage`, Wrack → `wreck_smolder`, Bauen/Reclaim → `build_stream`/`reclaim_stream` + `BeamPass.add` mit
  `VARKAN_BEAM_STYLES.buildStream`/`reclaimStream` (Quelle/Ziel aus den interpolierten Unit-Positionen). Emitter
  bei Handle-Wechsel (`noInterp`) bzw. Verschwinden zerstören.
- **Frame-Felder, die MS5 dafür braucht:** EventRecord-Typen Waffe/Einschlag/Tod/ShieldHit (G13) mit `pos` und
  `visual`; Größenklasse und Trail-Stil je `visual` in der Visual-Tabelle des Clients; `UnitFlags.damaged`/`wreck`/
  `building` sind vorhanden. BeamRecords (src/dst-Handle) für Bau/Reclaim ab MS6.

### 8.2 MS7 – Partikel-Ring, Beams/Trails und Scorch im Renderer

Dateien: `packages/render/src/renderer.ts` (Pass-Hook), `packages/render/src/passes/terrain.ts` +
`packages/render/src/terrain/glsl.ts` (Terrain-FS), `packages/render/src/terrain/decals.ts` (Decal-Binning G19),
`packages/render/src/presets.ts` (Caps).

- **Pass-Reihenfolge:** nach `units.draw` und `waterPass.draw` im selben Szenen-Pass: `shields.encode` (MS13) →
  `particles.encode` → `trails.encode` → `beams.encode`, danach Icons/Overlay (MS3). `particles.update(nowS, camera)`
  nach `cam.update()`/`fxFrame.update` und vor dem Encode. `RenderStats.drawsByPass` um `particles`, `trails`,
  `beams` erweitern (Budget im fx-lab: FX-Draws ≤ 6).
- **Caps:** `particleCapForPreset(preset)` = `RENDER_PRESETS[p].caps.particles`; Preset-Wechsel zur Laufzeit per
  `particles.setCap`. Der Ring bleibt 65.536 Records (2 MB). Abnahme MS7 „2×200 mit Partikeln ≥ 60 FPS, der Cap
  greift“ ist im fx-lab vorgeprüft (Szene `battle`, `battle-low`, §4/§5).
- **Scorch-Decals im Terrain-FS:** Header `${FRAME_BLOCK_GLSL}${SCORCH_GLSL}` im Terrain-FS (nach dem Muster in
  `apps/fx-lab/src/app/ground.ts`): `vec4 sc = fxScorch(v_rel − u_camFrac.xyz); albedo *= sc.rgb;
  color += fxEmissive(fxScorchGlow(sc.a), 1.0)` (HDR/LDR-sicher). Pipeline: `samplers += SCORCH_SAMPLERS`,
  `uniformBlocks += SCORCH_UNIFORM_BLOCKS`; Bind-Group mit Daten-/Zellen-Textur (Units 13/14, Nearest, keine Mips,
  `restore`-Callback) und dem `FxScorch`-UBO (Slot 8). Upload nur, wenn `scorch.dirty` (`pack()` +
  `writeTexture`), der UBO jeden Frame (`writeBlock(t, hdr ? 4 : 1)`). Cap aus `SCORCH_CAPS[preset]`.
- **Abstimmung mit render's Decal-Binning (MS3/G19):** render bint Selection-/Range-Ringe und Marker bereits in
  32-WU-Chunks (`terrain/decals.ts`, `DecalBinner`). Beide Binner nutzen dieselbe Chunk-Größe
  (`TERRAIN_PATCH_WU`); bis zur Zusammenführung bleiben sie getrennt (DECISIONS 36). Zusammenführung = ein
  gemeinsamer Zellen-Index mit Typ-Bit (Ring/SDF vs. Scorch), eine Liste je Chunk ≤ 32 Einträge; dann entfallen
  Unit 14 und Slot 8 zugunsten render's Decal-Slots. Scorch-Formen (`fxScorch`) bleiben unverändert.
- **Units/Slots:** Terrain-FS belegt zusätzlich Units 13/14 und UBO 8; mit CSM (MS14) zusätzlich Units 10/11 und
  UBO 7. Alles unter den WebGL2-Minima.

### 8.3 MS13 – Schilde

Dateien: `packages/client/src/fx.ts` (Controller), Renderer-Hook (s. o.).

- `shields = new ShieldPass(dev, bindings, { capacity: 128 })`. Aus den Frame-Records: Einheiten mit
  `UnitFlags.shieldUp` (bzw. der Frame-Sektion `Shields`, PLAN §3.6) → `shields.set(handle, { centerRaw: curPos
  + Schild-Offset, radiusWu, color: Teamfarbe, hpFrac, upFrac })`; Einheit verschwindet oder Schild kollabiert →
  `remove(handle)` bzw. `upFrac` clientseitig 1 → 0 in ≈ 0,3 s, Hochfahren 0 → 1 in ≈ 0,6 s.
- `ShieldHit`-Events (EventRecord: `pos` = Trefferpunkt, `handle` = Schildträger, `aux` = Schaden) →
  `shields.hit(handle, pos, eventTimeS, clamp(Schaden / Referenzschaden, 0.3, 2))` plus Partikel `impact_shield`.
- `shields.update(nowS)` einmal pro Frame, `encode` vor den Partikeln. Budget „20 Schilde ≤ 1 ms GPU“: siehe §4
  (Szene `shields`, Segment `shields`).
- Benötigte Frame-Felder: Schild-Radius und -HP (Blueprint bzw. Shields-Sektion), `shieldUp`-Flag,
  ShieldHit-Event mit Trägerhandle.

### 8.4 MS14 – PostChain, CSM, Presets, Autodetect

Dateien: `packages/render/src/renderer.ts`, `packages/render/src/passes/{terrain,units,water}.ts` (Receiver-GLSL),
`packages/render/src/presets.ts`, Props-Pass aus MS8.

- **PostChain:** `post = new PostChain(dev, postOptionsForPreset(preset))`; in `Renderer.render()` statt
  `dev.beginPass(this.passDesc)` → `enc = post.beginScene(clear)`; alle Szenen- und FX-Passes laufen in diesen
  Encoder; danach `post.resolve()` als letzter Schritt (Draws als Posten `post`). `Renderer.resize()` →
  `post.resize(bw, bh)`, Preset-Wechsel → `post.setOptions(postOptionsForPreset(p))`.
- **CSM:** nur High/Ultra `csm = new CascadedShadows(dev, { ...shadowOptionsForPreset(p).csm, worldMin, worldMax })`
  (Höhen aus den Chunk-Bounds), sonst `NullShadowReceiver`. Frame: `csm.update(camera, sunDir)` nach dem
  Frame-UBO, `csm.renderStatic(drawTerrainAndProps)` (Cache, nur dirty Kaskaden), `csm.renderDynamic(drawUnits)`.
- **Receiver-GLSL** in Terrain-, Unit- und Prop-FS: `${FRAME_BLOCK_GLSL}${SHADOW_RECEIVE_GLSL}${lightingGlsl(hdr)}`;
  `albedo * (hemi + sun·ndl)` → `fxLight(albedo, n, fxShadow(relPos, n))`, Emissives über `fxEmissive`.
  Pipelines: `uniformBlocks += SHADOW_RECV_UNIFORM_BLOCKS`, `samplers += SHADOW_RECV_SAMPLERS`, Bind-Group mit
  `receiverBindings()` (Handles bleiben über Context-Loss stabil).
- **Caster-Bündelung (DECISIONS 17):** Terrain-Caster mit `SHADOW_CASTER_GLSL` (`fxShadowCasterPos`), Chunks gegen
  `view.frustum`/`view.anchorRaw` nur bei Refit gecullt; Props instanziert, LOD 1, nur statisch; Units nur LOD 2 im
  Schatten (1 Draw je Visual und Kaskade, `multiDraw` wo vorhanden).
- **Preset-Zieltabelle** (`POST_PRESET_TABLE`, `SHADOW_PRESET_TABLE`): Low LDR ohne Bloom, FXAA, keine Schatten;
  Medium HDR + Bloom 5 + FXAA, Blob-Schatten; High/Ultra zusätzlich CSM 2048², 2 Kaskaden. MSAA entfällt
  (DECISIONS 35). `RENDER_PRESETS` in render haben noch `hdr/bloom: false` – beim Umstieg die Zieltabelle
  übernehmen.
- **Autodetect:** `WEBGL_debug_renderer_info` + 3-s-Benchmark (PLAN §3.7). Das Mess-Muster steht in
  `apps/fx-lab/scripts/bench.ts` (Samples, p50/p95, GPU-Segmente per `GpuSpanTimer`); im Spiel reicht ein Lauf der
  Szene mit `GpuSpanTimer` über die Segmente shadow/opaque/fx/post und der Vergleich mit einer Budget-Tabelle je
  Preset. CSM-Budget „2 Kaskaden ≤ 2,5 ms“: siehe §4 (`lighting-csm` gegen `lighting-nocsm`).

## 9. Abweichungen (Track gesamt)

- **Worktree-Pfad:** `/Users/logge/Documents/Projects/faf-renderfx` existiert nicht; gearbeitet wurde in
  `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-renderfx` (alle Pakete).
- **Zusätzliche Textur-Unit 15** für die Partikel-Layer-Tabelle (RGBA32F-Datentextur; als UBO wären 256 Layer ×
  128 B = 32 KB über dem garantierten 16-KB-Limit). Konstante in `particles/system.ts`, nicht in `slots.ts`.
- **MSAA entfällt**, FXAA auf allen Stufen (DECISIONS 35). `RENDER_PRESETS` haben weiter `hdr/bloom: false`; die
  Zieltabelle für MS14 steht in `POST_PRESET_TABLE`/`SHADOW_PRESET_TABLE`.
- **fx-lab-Toggles** `hdr`/`bloom`/`fxaa`/`csm` haben den Standard 1 und überschreiben die Preset-Zieltabelle (auch
  Low läuft im Lab mit HDR, solange nicht `hdr=0`). Deshalb misst `battle-low` den Partikel-Cap, nicht die
  Low-Post-Belegung.
- **Additive Erweiterungen** der Verträge: `FxFrameInput` mit optionalen Lichtfeldern und `fogStart`,
  `FxFrameOptions.frameUbo`, `SmokeContext.timer`, `ParticleStats.overwritten/window/draws`, `BeamPass.timedCapacity`,
  `TrailPass.add(…, lengthScale)`, `TrailStyle.blend`, `LabTriggerableScene`, `LabParams.cam`, u. a. (Details in den
  Fragmenten). Kein Vertrag wurde gebrochen.
- **Effekt-Datenmodell** erweitert: `blend` als Kurve, `spreadInner`, `streamWave(s)`; `acu_explosion` hat 8 Layer
  (Maximum), deshalb der Zusatzeffekt `acu_aftermath`; zusätzlich `impact_water` (21 statt 18 Effekte).
- **Kamera-Shake ohne Roll:** `RtsCamera` hat keine Rollachse; angewandt wird nur der Versatz.
- **`bench:fx`-Szenario `big`** löst die Explosion alle 4 s per `triggerBigExplosion()` neu aus, damit jedes
  Messfenster frische Kommandanten-Explosionen enthält.
- **Fremdlast-Erkennung** (gegenüber spk4 verfeinert): GPU-Jobs zählen nur ab 2 % CPU (ein ruhender
  Modell-Server nicht), Testläufer (Playwright/Vitest anderer Agenten) immer.

## 10. Bekannte Grenzen

- GPU-Zeiten nur in Chromium (Firefox/WebKit headless ohne Timer-Query). Kein Iris Xe, kein echtes Safari
  (DECISIONS 5). Auf ANGLE-Metal enthalten Timer-Segmente Command-Buffer-Lücken; Segmentwerte sind Obergrenzen.
- Partikel ohne Sortierung und ohne Soft-Particles (DECISIONS 32); überlappender Rauch kann selten falsch herum
  liegen. Tote Partikel im Live-Fenster kosten Vertex-Arbeit.
- Scorch-Formen prozedural; sehr große Krater (Kommandant 22 WU) zeigen leichte Ecken. Der Scorch-Pool ist in
  battle voll, die ältesten Decals werden ersetzt (so vorgesehen).
- Blitz-Beams sind ein weich wabernder Strahl, kein verzweigter Zickzack.
- Schild-Overdraw (Vorder- + Rückseite, Überlappung) skaliert mit der Auflösung; bei 4K und vielen großen
  Schilden wäre ein Pfad mit halber Auflösung die nächste Stufe.
- fx-lab: Einheiten ohne Kollision, Box-Geometrie, Lab-Maßstab 2,5 für Effekte.
- In der Szene `big` bleibt die Stoßfront kurz nach der Explosion (t ≈ 1,3 s) ein heller, cremeweißer Ring
  (Hitzesaum) – gewollt kräftig, aber nahe an der Sättigung.
- Die Timer-Query-Messung kostet selbst Zeit (6 Segmente je Frame); `mainJsMs` enthält das Polling.

## 11. Offene Punkte (für den Review-Schritt)

1. **Belastbare GPU-Messung „20 Schilde ≤ 1 ms“ fehlt im fx-lab.** Ursache 1: Fremdlast (MLX-GPU-Jobs) während
   aller Läufe. Ursache 2: Auf ANGLE-Metal misst jedes nicht leere Segment im Szenen-Pass einen Sockel von
   ≈ 2 ms. Vorschlag (Änderung in `apps/fx-lab/src/app/app.ts`, gehört nicht zu rfx-p7): URL-Parameter
   `gpuseg=fx`, der Schilde/Partikel/Beams als **ein** Segment misst, dazu `fx=shields` (nur Schilde), damit
   `bench:fx` die Schild-Kosten als Differenz eines einzigen Segments bestimmen kann. Danach auf ruhiger Maschine
   nachmessen (`bench:fx -- --browsers=chromium --scenarios=shields,shields-nofx`).
2. **Nachmessung aller GPU-Werte ohne Fremdlast** (Befehl in §5.1); die jetzigen Tabellen sind ⚠️-markiert.
3. In `big` ist die Stoßfront kurz nach der Explosion (t ≈ 1,3 s) ein sehr heller, cremeweißer Ring (rfx-p6 hat die
   „Glaskuppel“ bereits entschärft); optisches Feintuning, kein Fehler.
4. Keine Fehler in `apps/fx-lab/src` oder `packages/render-fx` gefunden: E2E, Smoke und alle Unit-Tests sind grün.

## 12. Abschluss-Verifikation (2026-09-30, streng nacheinander über `tools/heavy`)

Worktree `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-renderfx`, Stand nach rfx-p6.

| Befehl | Ergebnis |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ „Already up to date“ |
| `tools/heavy pnpm typecheck` | ✅ (`tsc -b && tsc -p tsconfig.tests.json`) |
| `tools/heavy pnpm lint` | ✅ ESLint `--max-warnings 0`, dependency-cruiser „no dependency violations found (544 modules, 2006 dependencies cruised)“ |
| `tools/heavy pnpm test` | ✅ 128 Testdateien, 1.225 Tests, 45 s |
| `tools/heavy pnpm smoke:fx -- --browsers=chromium,firefox,webkit` | ✅ 6 Fälle × 3 Browser, jeweils „context loss passed“ |
| `tools/heavy pnpm --filter @faf/fx-lab run build` | ✅ 301 kB JS (102 kB gzip) |
| `FAF_E2E_PORT=4683 tools/heavy pnpm test:e2e:fx` | ✅ 30/30 bestanden, 57 s |
| `tools/heavy pnpm bench:fx -- --quick` | ✅ Exit 0 (battle/shields/big, Draws 17–19, FX ≤ 3; unter Fremdlast) |
| `git diff --stat $(git merge-base HEAD main) -- packages/render tools/render-bench` | ✅ leer (`--exit-code` 0) |

Nach der Verifikation wurden nur noch Benchmark-Helfer (Fremdlast-Anzeige, `--docs-only`, fx=0-Vergleichsszenarien)
und Doku geändert; danach erneut grün: `pnpm exec tsc -p tsconfig.tests.json --noEmit`,
`pnpm exec vitest run apps/fx-lab/test/e2e` (19 Tests), ein erneuter `bench:fx -- --quick`, ESLint auf die eigenen Pfade.
