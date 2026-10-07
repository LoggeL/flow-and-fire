# rfx-p5-lab-shell – fx-lab-Shell (TRACK-RENDERFX, Welle 1)

Stand: 2026-09-30. App `apps/fx-lab` (`@faf/fx-lab`). Die Shell bindet Welle-0-Module ein: core, effects
(FxRng, CameraShake), decals (ScorchDecals, SCORCH_GLSL), post (PostChain) und light (CascadedShadows,
Receiver-GLSL). Die FX-Systeme aus Welle 1 (Partikel, Beams/Trails, Schilde) sind **nicht** eingebunden. Das
übernimmt rfx-p6 über `createLabFx` in `src/scenes/index.ts`. `packages/render`, `tools/render-bench` und fremde
owns sind unverändert.

Hinweis zum Pfad: Der in der Aufgabe genannte Pfad `/Users/logge/Documents/Projects/faf-renderfx` existiert
nicht. Der Worktree des Branches `track-renderfx` liegt unter
`/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-renderfx`. Dort wurde gearbeitet.

## Umgesetzt

| Datei | Inhalt |
|---|---|
| `index.html`, `src/main.ts` | Vollbild-Canvas mit HUD-CSS. `main.ts` parst die URL und installiert `window.__fxlab`, **bevor** etwas scheitern kann. Fehler aus `error`/`unhandledrejection` landen in `__fxlab.error`. |
| `src/app/context.ts` | **Vertrag** (siehe unten), dazu additiv `LabTriggerableScene`/`isTriggerableScene`, `SCENE_NAMES`, `LAB_STEP_S = 1/60` und `LAB_WORLD_WU = 512`. |
| `src/app/params.ts` | `parseLabParams(search, available, warnings?)` und `labParamsToSearch(p)`. |
| `src/app/clock.ts` | `FixedStepClock`: 60-Hz-Akkumulator mit höchstens 4 Schritten pro Frame. Mit `freeze` holt er in 8er-Batches auf und hält dann. |
| `src/app/sim.ts` | `LabSimulation`: Kontext je Szene, Fixed-Step-Schleife, `labStateChecksum`, Szenenwechsel, `trigger()`. Läuft ohne GPU (Tests). |
| `src/app/app.ts` | `LabApp`: Device, Timer, PostChain, CSM, Pässe, Frame-Ablauf, Hooks, Context-Loss, HUD-Aktionen. |
| `src/app/hooks.ts` | `FxLabHooks`, `FxLabStats`, `FxLabSample`, `SampleRing` (2048 Frames, Structure of Arrays, keine Allokation pro Frame). |
| `src/app/ground.ts` | 512 × 512-WU-Boden mit 256 × 256 Quads aus `gl_VertexID` (keine Vertex-Puffer, 1 Draw). `labGroundHeight`/`labGroundGradient` in JS und `LAB_GROUND_GLSL` entstehen aus derselben Wellentabelle. Albedo prozedural aus Erde, trockenem Gras und dunklem Eisenboden mit Rost. Der FS nutzt `LIGHTING_GLSL`, `SHADOW_RECEIVE_GLSL` und `SCORCH_GLSL`; die Glut geht über `fxEmissive`. Statischer Caster mit 128² Quads. `ScorchTextures` lädt Daten- und Zellen-Textur hoch, wenn der Pool dirty ist, und hat einen Restore-Callback. |
| `src/app/props.ts` | 300 statische Props (220 Felsen in Clustern, 80 Eisensäulen), deterministisch (`PROP_SEED`), mit einer Lichtung von 36 WU in der Mitte. Instanziert, 1 Draw, statischer CSM-Caster. |
| `src/app/units.ts` | `LabUnitList` (Vertrag siehe unten) plus Formtabelle `LAB_UNIT_SHAPES` (drei Kästen je Art). |
| `src/app/unit-pass.ts` | Alle Einheitenarten in **einem** instanzierten Draw. Position und Yaw werden zwischen den Fixed-Steps interpoliert (`u_camFrac.w` = alpha). Teamfarbe kommt aus `DEFAULT_ARMY_COLORS`, die Glutnaht ist HDR-Emissive (`glow`), Farbe nach `glowTintForArmyColor`, also Weißglut für Rot und Orange. Wracks sind rostig und kalt. Der dynamische CSM-Caster nutzt reduzierte Geometrie (Rumpf und Aufbau, ohne Rohr). |
| `src/app/mesh.ts`, `src/app/glsl.ts` | Prozedurale Meshes; Licht, Sonne, Nebel, Noise und Shader-Header. |
| `src/app/camera-rig.ts` | Szenen-Kamerapreset plus Maus (links: Pan, rechts oder Shift: Drehen/Neigen, Rad: Zoom, Doppelklick: Reset), `flight`-Orbit als Funktion der Szenenzeit, Shake-Versatz. |
| `src/app/hud.ts` | DOM-Overlay (siehe Bedienung) und projizierte Szenen-Labels. |
| `src/app/null-fx.ts` | FX-lose `LabFx`: 0 Draws, Stats `{ particles: null, shields: null, beams: 0, trails: 0 }`. |
| `src/scenes/index.ts` | `LAB_SCENES` (nur `lighting`, der Rest ist `undefined`, das HUD zeigt diese Szenen deaktiviert) und `createLabFx` (FX-los). |
| `src/scenes/lighting.ts` | Szene `lighting` (siehe unten). |
| `scripts/shot.ts` | Screenshot-Werkzeug (siehe unten). |
| `test/app/*.test.ts` | 32 Tests (siehe unten). |

## Verträge (für rfx-p6/rfx-p7)

### `src/app/context.ts` (wörtlich wie vorgegeben)

`SceneName`, `LabParams`, `LabCameraPreset`, `LabUnitKind`, `LabUnitInit`, `LabFxStats`, `LabFx`,
`LabContext` und `LabScene` stehen genau in der Vorgabe-Form in `context.ts`. Semantik:

- `LabScene.update(ctx, t, dt)` und `LabFx.update(ctx, t, dt)` laufen **einmal pro Fixed-Step** (60 Hz).
  `t` ist die Szenenzeit **nach** dem Schritt, `dt = 1/60`. Reihenfolge je Schritt:
  1. `units.snapshot()` (prev := cur)
  2. `scene.update`
  3. `scorch.update(t)`
  4. `fx.update`
- `ctx.fx` wird **nach** dem Anlegen des Kontexts und **vor** `scene.init(ctx)` durch `createLabFx(ctx)` ersetzt.
  Szenen können in `init` also schon Effekte auslösen.
- FX-Zeit auf der GPU (`u_fxTime.x`) und `frame.update(timeS)` verwenden die **Szenenzeit** des gerenderten
  Frames: letzter Schritt plus Akkumulator, bei `freeze` der letzte Schritt. Die Wall-Clock kommt nicht vor.
- Jede Szene bekommt beim Start bzw. Wechsel einen frischen Kontext: `ScorchDecals` (Cap =
  `SCORCH_CAPS[preset]`, Karte 512 WU), `CameraShake` und `FxRng(params.seed)`. `ctx.units` wird geleert.
- Additiv: `LabTriggerableScene { trigger(ctx, t) }`. `__fxlab.triggerBigExplosion()` und der HUD-Knopf rufen
  `trigger` auf, wenn die laufende Szene `big` ist. rfx-p6 implementiert `trigger` in der Szene `big`.
- Die Szene muss in `dispose` ihre Units nicht zwingend entfernen; `switchScene` leert die Liste danach ohnehin.

### `LabUnitList` (`src/app/units.ts`)

- Kapazität 1024. Stabile Indizes mit LIFO-Freelist. `add(init)` gibt den Index zurück, bei voller Liste `−1`.
  Außerdem `set(i, patch)`, `remove(i)` (gibt `false` bei totem Index zurück), `get(i, out?)` und `has(i)`.
  Die Pfade `move(i, x, z, yaw)` und `setHpGlow(i, hp, glow)` sind allokationsfrei für heiße Schleifen, dazu
  kommen die Accessoren `xWu/zWu/yWu/yawOf/armyOf/kindOf`.
- Weitere Member: `count`, `highWater`, `version` (jede Änderung erhöht ihn), `snap(i)` für einen Teleport ohne
  Interpolation, `clear()`, `checksum()`.
- y folgt immer `labGroundHeight(x, z)`. `hp` liegt in 0..1, `glow` in 0..4. Standard ist `glow` 1, bei Wracks 0.
- Instanz-Record 36 B, kompakt in Index-Reihenfolge, `upload()` = genau ein `writeBuffer` über
  `DynamicInstanceBuffer`, nur wenn sich `version` geändert hat:

  | Offset | Typ | Inhalt |
  |---|---|---|
  | 0 | i32×3 | vorherige Position (raw Q20.12, 1 WU = 4096) |
  | 12 | i32×3 | aktuelle Position |
  | 24 | f32×2 | vorheriger Yaw (neben den aktuellen entfaltet), aktueller Yaw |
  | 32 | u8×4 | Art-ID (`LAB_UNIT_KINDS`), Armee, hp·255, glow·63,75 |

### Test-Hooks (`window.__fxlab`, `src/app/hooks.ts`)

```ts
interface FxLabHooks {
  ready: boolean;            // erster präsentierter Frame nach Szenen-Init; mit freeze erst nach Erreichen von T
  frame: number; scene: SceneName; preset: RenderPresetName; error: string | null; restoreCount: number;
  stats(): FxLabStats; samples(): readonly FxLabSample[]; resetSamples(): void;
  setScene(name: SceneName): void;     // wirft bei nicht registrierter Szene; ready wird false bis zum neuen ersten Frame
  loseContext(): boolean;              // debugLoseContext; false ohne WEBGL_lose_context oder wenn schon verloren
  restoreContext(): boolean;           // false, solange der Verlust noch nicht beobachtet wurde → pollen
  triggerBigExplosion(): void;         // Szene 'big' → trigger(); sonst No-op (Rückgabe false)
}
FxLabSample = { frame, t, frameMs, mainJsMs, fxJsMs, labJsMs, draws, gpuMs, gpuSeg: { shadow, opaque, shields,
                particles, beams, post } (number | null), particlesAlive }
FxLabStats  = { draws, drawsBySeg, fx: LabFxStats, scene, units, decals: { count, cap },
                csm: { enabled, staticRefreshes, staticDraws, dynamicDraws }, post: { hdr, bloom, levels, fxaa },
                shakeActive, gpuTimer, canvas: [w, h] }
```

- `samples()` liefert den Ring der letzten 2048 Frames, älteste zuerst. GPU-Werte kommen einige Frames später
  an und werden in den Sample ihres Frames nachgetragen; die neuesten ~5 Samples haben deshalb noch `null`.
  `gpuMs` ist die Summe der aufgelösten Segmente oder `null`.
- `mainJsMs` misst den gesamten rAF-Callback.
- `fxJsMs` umfasst `LabFx.update`, `scorch.update`, CSM (update, static, dynamic), das Hochladen der
  Scorch-Texturen und des UBO, `beginScene`, alle FX-Encodes und `post.resolve`.
- `labJsMs` ist die Summe der `scene.update`-Zeiten dieses Frames.
- `draws` und `drawsBySeg` stammen aus `dev.counters.drawCalls`, gemessen als Differenz um jedes Segment.
  Eine FX-Draw-Prüfung für rfx-p7: `shields + particles + beams`.
- Bei einem Fehler im Frame-Callback wird `error` gesetzt und die Schleife gestoppt. Einmal nach dem ersten
  Frame und einmal nach jedem Restore prüft `dev.checkErrors()` auf GL-Fehler; Treffer landen in `error`.

## Frame-Ablauf (`LabApp.renderFrame`)

1. Szenenlogik: `sim.advance(frameMs)` mit Fixed-Steps (siehe oben).
2. Kamera: Preset und Maus, dazu `flight` sowie `CameraShake.sample(t, target)` als Versatz auf das Ziel.
   Danach `FxFrameUniforms.update` mit Szenenzeit, Sonne und Licht der Lab-Umgebung, `alpha` = Akkumulator/Schritt.
   Anschließend `units.upload()`.
3. Segment `shadow`: `csm.update`, `renderStatic` (Boden und Props, nur dirty Kaskaden), `renderDynamic` (Units).
   Bei `csm=0` wird das übersprungen, der Receiver bindet dann `NullShadowReceiver`. Danach das Scorch-Upload.
4. Segment `opaque`: `post.beginScene(LAB_CLEAR)` sowie Bind-Groups für Frame und FxView, den Receiver und Scorch.
   Dann Boden, Props und Units.
5. Die Segmente `shields`, `particles` und `beams` rufen `ctx.fx.encodeShields/Particles/Beams(enc)` im selben
   Szenen-Pass auf. Bei `fx=0` wird das übersprungen, die Segmente laufen aber leer weiter.
6. Segment `post`: `post.resolve()` mit Bloom, ACES und FXAA in den Canvas.

Die Pass-Reihenfolge entspricht PLAN §3.7. `GpuSpanTimer` misst die 6 Segmente in dieser Reihenfolge
(`LAB_SEGMENTS == FX_SEGMENTS`, Test).

## URL-Parameter und Bedienung

| Param | Standard | Bedeutung |
|---|---|---|
| `scene` | `battle`, falls registriert, sonst `lighting` | Startszene. Unbekannte oder nicht registrierte Szenen fallen auf den Standard zurück (Warnung). |
| `preset` | `medium` | `low`, `medium`, `high`, `ultra`. Bestimmt Canvas-Skalierung (`renderScale`), Scorch-Cap und die Partikel-Caps (rfx-p6). |
| `hdr` `bloom` `csm` `fxaa` | 1 | Toggles. Sie **überschreiben** die Preset-Zieltabelle, d. h. auch `low` läuft mit HDR und Bloom, solange nicht `hdr=0`/`bloom=0` gesetzt ist. |
| `seed` | 1 | u32 für `FxRng` der Szene. |
| `freeze` | – | Bis T s deterministisch simulieren, dann denselben Zustand weiter rendern (0 … 600). |
| `bench` | 0 | 1: HUD und Maus aus. `preserveDrawingBuffer` ist nur mit `bench=1` ohne `freeze` aus. |
| `flight` | 0 | 1: langsamer Orbit (3°/s Heading, 18-WU-Kreis in 70 s). |
| `fx` | 1 | 0: transparente FX (Schilde, Partikel, Beams) aus. |

Ungültige Werte fallen auf den Standard zurück und erzeugen eine `console.warn`-Zeile.

Canvas: `backbufferSize(cssW, cssH, dpr, preset.renderScale, MAX_TEXTURE_SIZE)`, z. B. 1280×720 CSS bei Medium ergibt
1024×576.

HUD (nicht bei `bench=1`):
- Szenen-Knöpfe (nicht verfügbare ausgegraut), Preset-Auswahl (lädt die Seite mit neuem Preset neu), Toggles
  `hdr`/`bloom`/`csm`/`fxaa`/`fx`/`flight` (wirken sofort, `hdr` baut die opaken Pipelines für den Emissive-Pfad neu),
  „Big Explosion“ und „Context verlieren“ (Restore automatisch nach 0,7 s).
- Statistik 4× pro Sekunde: t, FPS, Frame-ms, JS main/fx/lab, Draws je Segment, GPU je Segment (oder „n/v“),
  Partikel alive/cap/Ring/dropped/culled, Schilde und Ripples, Beams und Trails, Units, Decals, Post- und CSM-Status,
  Shake, Canvas, Restores und die Szenen-Stats.
- Die URL wird bei Szenen- und Toggle-Wechseln per `history.replaceState` nachgeführt.

Starten: `pnpm fx:lab` (Vite-Dev-Server, Port 4685 oder der nächste freie; danach beenden!).

## Context-Loss

- Alle GPU-Objekte laufen über die Registry des Devices und behalten ihre Handles.
- Inhalte mit Restore-Callback:
  - Mesh-Puffer von Props und Units
  - Prop-Instanzen und Unit-Instanzen (`DynamicInstanceBuffer`, letzter Upload)
  - Scorch-Daten- und Zellen-Textur (aus den gepackten Arrays)
- Die restlichen Inhalte schreibt ohnehin jeder Frame: Frame-UBO, FxView und Scorch-UBO.
- `dev.onRestored`:
  - `timer.reset()`
  - `csm.invalidateStatic()` (der CSM-Cache wird dirty; die CSM-eigene Logik markiert ihn zusätzlich)
  - `restoreCount++`
  - GL-Fehlerprüfung im nächsten Frame
- Szene und Simulation laufen während des Verlusts weiter (Szenenzeit schreitet fort). Nach dem Restore rendert
  derselbe Zustand.
- Geprüft mit `shot --lose`:
  - `restoreCount == 1`, kein `error`
  - Bild nach dem Restore identisch zum Screenshot davor
  - in Chromium, Firefox und WebKit

## Szene `lighting`

- 40 fahrende Einheiten, 20 je Armee: ACU, 3 Engineers, 4 Artillerie, 5 Bots, 7 Panzer. Sie fahren auf
  gegenläufigen, leicht wabernden Kreisbahnen (Radius 16–66 WU) um die Mitte. Die Pose ist eine geschlossene
  Form von t, also unabhängig von der Framerate.
- 7 statische Teile: je Armee eine Struktur und ein Schildgenerator (Glut an der Mündung), dazu 3 Wracks in der Mitte.
- 30 Scorch-, Krater- und Scar-Decals (40 %, 35 %, 25 %) mit Glut von 3, 6 bzw. 2 s. Alle 0,5 s ersetzt ein frischer,
  glühender Decal den ältesten, damit immer etwa 9 Decals glühen.
- Sonne tief und schräg (`LAB_SUN` ≈ 33° Elevation) für lange Schatten. Keine Partikel.
- Kamera: Mitte, Distanz 128 WU, Pitch 50°, Heading −90°. Labels an Wracks und Strukturen.
- Stats: `units`, `moving`, `decals`, `glowingDecals`, `acus`.

## Screenshot-Werkzeug `scripts/shot.ts`

```
cd /Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-renderfx
/Users/logge/Documents/Projects/flow-and-fire/tools/heavy pnpm --filter @faf/fx-lab run shot -- \
  --scenes=lighting,battle --browsers=chromium,firefox,webkit --freeze=6 --preset=medium --size=1280x720
```

- Ablauf:
  - Vite-Build nach `apps/fx-lab/dist`.
  - Auslieferung per `page.route` unter `https://faf-fx-lab.test` mit COOP/COEP/CORP. Es wird kein Port geöffnet.
  - Browser nacheinander, Launch-Flags wie in der Root-`playwright.config.ts`.
  - Wartet auf `__fxlab.ready` (oder `error`), prüft `__fxlab.error`, pageerror und GL-/Shader-Konsolenmeldungen,
    außerdem ob der Canvas nicht einfarbig ist (Luma-Spanne ≥ 12 aus dem PNG, zlib).
  - Speichert `test-results/fx-lab-shots/<scene>[-t<T>][-<variant>]-<browser>.png` und gibt je Shot eine Stats-Zeile aus.
  - Exit 1 bei jedem Fehler. Browser werden immer geschlossen.
- `--freeze` gilt pro Szene. `--freeze=6,battle:12,big:1.6|4` erzeugt bei mehreren Zeiten `big-t1.6-…` und `big-t4-…`.
- Optionen:
  - `--params=hdr=0&fx=0`: zusätzliche URL-Parameter, der Dateiname bekommt dann z. B. `-hdr0-fx0`.
  - `--hud`: HUD sichtbar (Standard ist `bench=1`).
  - `--lose`: nach dem Shot Context-Loss und Restore, dazu `…-restored-<browser>.png`.
  - `--measure=<s>`: p50 von Frame, mainJs, fxJs, labJs und GPU je Segment über N s.
  - `--seed`, `--headed`, `--no-build`.

## Tests (`apps/fx-lab/test/app`, 32 Tests, ~0,4 s)

- `params.test.ts`:
  - Standardwerte; `battle` wird Standard, sobald es registriert ist.
  - Alle Parameter und Schreibweisen (1/true/on/yes …); ungültige Werte (Szene, Preset, Bool, Seed, Freeze)
    fallen auf den Standard zurück und erzeugen je eine Warnung.
  - Roundtrip über `labParamsToSearch`.
- `ground.test.ts`:
  - Die GLSL-Wellenliterale entsprechen `GROUND_WAVES` (`glslFloat` ist roundtrip-exakt).
  - Der generierte GLSL-Text wird nach JS übersetzt und ausgeführt: Höhe identisch in double für 5.000 Punkte,
    in float32 je Operation < 2e‑4 WU. Gradient in GLSL = JS = finite Differenz.
  - Boden > 0, Hang ≤ 12°.
- `units.test.ts`:
  - Kapazität 1024 und Stride 36; stabile Indizes und LIFO-Freelist; `−1` bei voller Liste; Validierung;
    get/set-Defaults und Clamping.
  - Packing Feld für Feld (kompakt, Yaw über ±π entfaltet, Info-Bytes); GPU-Packing byte-gleich zum
    DataView-Packing.
  - Upload nur bei Änderung (Fake-Device zählt `writeBuffer`); `version` und `checksum`.
- `samples.test.ts`:
  - Ring 2048, älteste zuerst über den Umlauf; Teilfüllung; Reset.
  - Späte GPU-Werte landen im richtigen Frame, Summe bzw. `null`, überschriebene Slots werden geleert.
- `sim.test.ts`:
  - Akkumulator (Schritte, alpha, max. 4 pro Frame, Clamping, Langzeit = Wall-Zeit ± 1 Schritt).
  - `freeze`: 8er-Batches unabhängig von der Framerate, danach Halten; T zwischen zwei Schritten rundet auf.
  - Szene `lighting` headless:
    - Aufbau 40/30/2 ACUs.
    - **Gleicher Seed und freeze ergeben dieselbe Zustandsprüfsumme bei beliebigem Frame-Takt**, ein anderer
      Seed eine andere.
    - Freilauf: Zustand nach N Schritten unabhängig vom Takt.
    - Decal-Rotation hält den Pool bei 30.
  - `switchScene` startet reproduzierbar bei t = 0; Registry und FX-lose `createLabFx` mit 0 Draws.

## Abnahme (2026-09-30)

- `pnpm exec tsc -p apps/fx-lab --noEmit` ✔ (vorher einmal `tools/heavy pnpm exec tsc -b packages/render-fx`,
  weil die `.d.ts` von render-fx veraltet waren – TS2305).
- `pnpm exec tsc -p tsconfig.tests.json --noEmit` ✔
- `pnpm exec vitest run apps/fx-lab/test/app` ✔ 32/32
- `tools/heavy pnpm exec eslint apps/fx-lab/src apps/fx-lab/test/app apps/fx-lab/scripts/shot.ts --max-warnings 0` ✔
  (`index.html` liegt außerhalb der ESLint-Konfiguration)
- `tools/heavy pnpm --filter @faf/fx-lab run build` ✔ (207 kB JS, 71 kB gzip)
- `tools/heavy pnpm --filter @faf/fx-lab run shot -- --scenes=lighting --browsers=chromium,firefox,webkit --lose` ✔
  in allen drei Browsern inklusive Context-Loss/Restore. Zusätzlich `--params=hdr=0` (Chromium und WebKit),
  `--params=csm=0 --hud`, `--preset=low|ultra` und 1920×1080 ✔.
- Es läuft kein Server oder Browser mehr.

Screenshots angesehen (`test-results/fx-lab-shots/`):
- `lighting-{chromium,firefox,webkit}.png`:
  - Praktisch identisch.
  - Lange, weiche PCF-Schatten von Säulen, Felsen, Strukturen und Einheiten in beiden Kaskaden; stabil, weil
    derselbe Frame nach Restore identisch ist.
  - Scorch als dunkler Ruß mit unregelmäßigem Rand, Krater mit hellem Rand.
  - Frische Decals glühen weiß-gelb mit Bloom-Hof; die Glutnähte der Einheiten und Strukturen blühen.
  - Teamfarben Blau und Rot, Wracks rostbraun.
- `lighting-restored-*.png`: wie vor dem Verlust.
- `lighting-hdr0-*.png`: LDR-Fallback korrekt. Die Glut ist gesättigtes Orange ohne Hof, die Szene ohne
  ACES-Kontrast etwas flacher.
- `lighting-csm0-chromium.png`: keine Schatten, HUD mit Statistik und Labels.

Tuning in diesem Lauf nach Sichtprüfung:
- Die Boden-Noise wirkte blockig (achsparallele Value-Noise). Abhilfe: rotierte Domains und weniger
  Korn-Kontrast (±8 % statt ±14 %).
- Die Eisenflächen waren zu dunkel und mit Scorch verwechselbar (0,19 → 0,27, weniger Fläche).
- Die Rostflecken wirkten wie Lava und sind abgeschwächt.
- LDR-Glut: `fxEmissive(fxScorchGlow(e), 1)` sorgt für Sättigung statt Clipping, Glut-Intensität 1,2 → 2,5.

## Messwerte (lokal gemessen, Apple M5 Pro)

Chromium 153 headless, ANGLE-Metal, Szene `lighting` mit freeze 6 (statischer CSM-Cache, nur die dynamischen
Caster pro Frame), p50 über ~170 Frames mit `shot --measure=3`. Parallel liefen andere Agenten, deshalb sind die
GPU-Werte grob. Timer-Segmente auf ANGLE-Metal enthalten Lücken (siehe rfx-p2). Die offizielle Messung macht
rfx-p7.

| Preset / Viewport | Canvas | Draws | mainJs | fxJs | GPU gesamt | shadow | opaque | post |
|---|---|---|---|---|---|---|---|---|
| medium, 1920×1080 | 1536×864 | 16 (2 + 3 + 11) | 0,09 ms | 0,05 ms | 3,4 ms | 0,27 | 1,30 | 0,93 |
| medium, `csm=0` | 1536×864 | 14 | 0,14 ms | 0,05 ms | 4,2 ms | – | 2,16 | 0,65 |
| low | 1267×713 | 16 | 0,17 ms | 0,09 ms | 3,7 ms | 0,25 | 1,66 | 0,65 |
| ultra | 1920×1080 | 16 | 0,13 ms | 0,07 ms | 6,8 ms | 0,61 | 2,98 | 1,51 |

Die Streuung zwischen den Läufen (z. B. `opaque` bei `csm=0` höher als mit CSM) zeigt die Fremdlast.
Firefox und WebKit haben headless keinen Timer-Query, die GPU-Werte sind dort `n/v`.

## Integrationshinweise

- Das fx-lab ist Demo und Messstand. Integriert werden später die render-fx-Module, nicht die Lab-Pässe.
- Das Muster aus `ground.ts` gilt als Vorlage für render's Terrain-FS in MS7/MS14:
  - Receiver-Header, `fxScorch(v_rel − u_camFrac)`, `fxEmissive(fxScorchGlow(sc.a), 1)` (HDR/LDR-sicher).
  - Bind-Groups für Frame und FxView, CSM bzw. Null-Receiver und Scorch.
  - `ScorchTextures` mit Restore-Callback und Upload nur bei dirty.
- Caster-Aufteilung wie in MS14 geplant: Boden und Props statisch (Cache), Units dynamisch mit reduzierter
  Geometrie.

## Abweichungen

- Additive Vertragserweiterungen: `LabTriggerableScene`, `SCENE_NAMES`, `LAB_STEP_S`, `LAB_WORLD_WU`.
  `FxLabHooks.triggerBigExplosion` gibt intern `boolean` zurück; der Vertragstyp ist `void`.
- `freeze` holt feste 8 Schritte pro Frame auf statt „so viele wie die Wall-Zeit erlaubt“. Damit sind auch die
  Spawn-Batches der Partikel von der Framerate unabhängig und die Screenshots reproduzierbar.
- Die Toggles `hdr`/`bloom`/`fxaa` haben laut Vorgabe den Standard 1 und überschreiben `postOptionsForPreset`.
  Die Zieltabelle („Low = LDR ohne Bloom“) greift im Lab nur mit expliziten URL-Parametern.
- Der Roll des Kamera-Shakes wird nicht angewandt, weil `RtsCamera` keine Rollachse hat; der Versatz wird angewandt.
- Die CSM-Größe ist 1024² bei `low`, sonst 2048², 2 Kaskaden. CSM läuft im Lab auf allen Presets, wenn `csm=1`.
- Zusätzlicher Toggle `flight` im HUD.

## Bekannte Grenzen

- Nur die Szene `lighting` ist registriert. `battle`, `shields`, `big`, `gallery` und die echte `LabFx` liefert
  rfx-p6. Bis dahin sind die FX-Segmente leer und der Standard-Startwert ist `lighting`.
- `particlesAlive` im Sample ruft pro Frame `fx.stats()` auf. rfx-p6 sollte `stats()` allokationsarm halten
  (wiederverwendetes Objekt).
- Die Kamera-Presets haben keine Kollision; ein Zoom unter den Boden ist durch `groundHeight − 2` nur grob begrenzt.
- Der Vite-Build leert `apps/fx-lab/dist` inklusive `dist/tsc` (Konfiguration von rfx-p0). Danach baut
  `tsc -b apps/fx-lab` einmal voll neu.
- GPU-Zeiten gibt es nur in Chromium.
