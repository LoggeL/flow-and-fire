# rfx-p2-light-post – Licht & Post (TRACK-RENDERFX, Welle 0)

Stand: 2026-09-29. Paket `@faf/render-fx`, Module `src/post` und `src/light`. Grundlage ist der SPK4-Prototyp
(`tools/render-bench/src/proto/post.ts`, `shadows.ts`, `shadow-glsl.ts`, DECISIONS 17), umgebaut zu einer
wiederverwendbaren API ohne Kopplung an Terrain, Props oder Units. `packages/render` und `tools/render-bench`
sind unverändert.

## Umgesetzt

- **`PostChain`** (`src/post/post-chain.ts`): Die Szene rendert in ein HDR-RGBA16F-Target mit DEPTH24. Ohne
  `EXT_color_buffer_float` oder mit `hdr: false` fällt die Kette auf ein LDR-RGBA8-Target zurück, der Tonemapper
  wird dann umgangen. Danach folgen Dual-Kawase-Bloom (1–6 Stufen, die erste mit Soft-Threshold und Knee),
  der Composite (Szene + Bloom·Intensität, Exposure, ACES nach Narkowicz im linearen Raum, Luma nach Alpha)
  und FXAA in den Canvas. Ohne FXAA schreibt der Composite direkt in den Canvas, mit Alpha 1.
  Jeder Schritt ist ein Fullscreen-Draw: Bloom 5 + FXAA ergibt 5 down + 4 up + Composite + FXAA = **11 Draws**.
  Die Kette erzeugt nur die Ressourcen, die die Optionen brauchen: ohne Bloom keine Down/Up-Pipelines und
  -Targets, ohne FXAA kein LDR-Target und keine FXAA-Pipeline. Alle Schritt-Uniforms liegen in **einem** UBO
  mit ausgerichteten Offsets.
- **`CascadedShadows`** (`src/light/cascaded-shadows.ts`, Mathematik in `cascades.ts`): CSM mit 1 oder 2 Kaskaden.
  Es gibt zwei depth24-2D-Array-Texturen (static/dynamic) mit Compare `lequal` und Hardware-PCF. Der
  Kaskaden-Fit verwendet View-Tiefen-Scheiben mit praktischem Split (λ = 0,55), eine Bounding-Sphere,
  Texel-Snapping und eine gecachte Lichtbox mit Headroom. Die statische Ebene wird nur für dirty Kaskaden neu
  gezeichnet, die dynamische jeden Frame. Caster arbeiten ganzzahlig relativ zu einem Anker, Receiver
  kamerarelativ. Beides ist auf der ganzen Karte präzise.
- **GLSL**: `SHADOW_CASTER_GLSL` (`fxShadowCasterPos`), `SHADOW_RECEIVE_GLSL` (`fxShadow`: 4 Taps × 2×2-HW-PCF,
  min über beide Ebenen, Kaskaden-Überblendung, Normal-Offset je Kaskade, Distanz-Fade, außerhalb → 1),
  `LIGHTING_GLSL`/`LIGHTING_GLSL_LDR` (`fxLight`, `fxEmissive`), `ACES_GLSL` (`fxAces`).
- **Preset-Zieltabellen** für MS14: `postOptionsForPreset`, `shadowOptionsForPreset`.
- **`NullShadowReceiver`**: Bindings für Receiver-Shader, wenn kein CSM aktiv ist (Low/Medium). Der Block steht
  auf „aus“, `fxShadow` liefert dann 1.
- Context-Loss: Alle Targets, UBOs und Bind-Groups liegen in der Registry des Devices und kommen mit denselben
  Handles zurück. `PostChain` markiert per `dev.onRestored` nur ihre Schritt-Uniforms als dirty und lädt sie
  im nächsten `resolve()` hoch. Eine Neu-Initialisierung gibt es nicht. `CascadedShadows` markiert nach dem
  Restore den statischen Cache aller Kaskaden als dirty. Die Caster-UBOs haben einen `restore`-Callback, weil
  sie nur bei einem Refit geschrieben werden.

## Öffentliche API

### Post (`src/post`)

```ts
interface PostOptions { hdr; bloom; bloomLevels /*1..6, Std. 5*/; fxaa; exposure; bloomIntensity; bloomThreshold; bloomKnee }
const DEFAULT_POST_OPTIONS  // exposure 1.1, bloomIntensity 0.55, bloomThreshold 0.9, bloomKnee 0.45 (SPK4-Werte)
class PostChain {
  constructor(dev: GpuDevice, opts: PostOptions)       // allokiert sofort in drawingBufferSize()
  readonly hdrActive / sceneColor: TexH / sceneDepth: TexH / sceneFormat / width / height   (Getter)
  resize(w, h)                                         // nur bei echter Größenänderung neu allozieren
  scenePass(clear): PassDesc                           // gecacht (keine Allokation pro Frame)
  beginScene(clear): PassEncoder                       // Offscreen-Pass, löscht Farbe + Tiefe
  sceneLoadPass(): PassDesc                            // weiter in die Szene rendern ohne Clear
  resolve(mark?: (phase: 'bloom'|'composite'|'fxaa') => void): number   // Draws; mark z. B. für GPU-Segmente
  setOptions(partial)                                  // Parameter → nur UBO; hdr/bloom/Stufen/fxaa → Rebuild
  setOutputViewport(rect | null)                       // Ziel-Rechteck im Canvas (Split-Screen, Vorschau)
  targetInfo(): PostTargetInfo[]                       // Label, Größe, Format je Target (Tests/Speicheranzeige)
  readonly stats { draws, hdr, bloomLevels, fxaa, allocations, restores }
  destroy()
}
ACES_GLSL, acesFilm(x), compositeHdr(v, exposure)     // JS-Referenzen
kawaseOffsets(level) → { down, up, downWeightSum, upWeightSum }   // Taps in Vollauflösungs-Pixeln
KAWASE_DOWN_TAPS / KAWASE_UP_TAPS, bloomLevelSize(w, h, level)    // Shader werden aus denselben Tabellen erzeugt
FULLSCREEN_VS / FULLSCREEN_STREAM / FULLSCREEN_TRIANGLE, POST_LAYOUT
```

### Licht (`src/light`)

```ts
class CascadedShadows {
  constructor(dev, { size = 2048, cascades: 1|2 = 2, lambda = 0.55, headroom = 1.4, maxDistanceWu = 600,
                     strength = 0.72, worldMin = [0,-64,0], worldMax = [4096,512,4096] })
  update(camera: RtsCamera, sunDir): { staticDirty: readonly boolean[] }   // Array wird wiederverwendet
  renderStatic(draw: ShadowCasterFn): number     // nur dirty Kaskaden; während Context-Loss: 0, bleibt dirty
  renderDynamic(draw: ShadowCasterFn): number    // jeden Frame, eigene Depth-Ebene, wird immer gelöscht
  receiverBindings(): { buffers, textures }      // gecachtes Objekt zum Einmischen in Receiver-Bind-Groups
  casterView(c, 'static'|'dynamic'): ShadowCasterView   // z. B. für CPU-Culling vor dem Zeichnen
  invalidateStatic(); setWorldBounds(min, max); strength (Feld)
  readonly stats { staticRefreshes, staticCascadeRefreshes, refits, staticDraws, dynamicDraws, restores }
  readonly fitter: CascadeFitter; staticTex; dynamicTex
}
type ShadowCasterFn = (enc: PassEncoder, cascade: number, caster: ShadowCasterView) => number;
interface ShadowCasterView { cascade; layer; bindGroup; bindGroupEntry; casterSlot; anchorRaw: Int32Array;
                             frustum /* ankerrelative WU */; lightViewProj: Float32Array; texelWu }
SHADOW_CASTER_GLSL      // Block FxShadowCaster @ SLOT_PASS (2): vec4 fxShadowCasterPos(ivec3 posRaw, vec3 localOffsetWu)
SHADOW_CASTER_PIPELINE  // depth-only, colorWrite false, depthBias { constant 2, slopeScale 2.5 } (Prototyp)
SHADOW_CASTER_UNIFORM_BLOCKS, SHADOW_DEPTH_FS, SHADOW_CASTER_LAYOUT
SHADOW_RECEIVE_GLSL     // float fxShadow(vec3 relPos, vec3 normal); braucht FRAME_BLOCK_GLSL davor
SHADOW_RECV_LAYOUT / SHADOW_RECV_BLOCK_GLSL   // Block FxShadowRecv @ SLOT_FX_SHADOW (7)
SHADOW_RECV_UNIFORM_BLOCKS, SHADOW_RECV_SAMPLERS   // u_fxShadowStatic @ Unit 10, u_fxShadowDynamic @ Unit 11
LIGHTING_GLSL, LIGHTING_GLSL_LDR, lightingGlsl(hdr) // vec3 fxLight(albedo, normal, shadow); vec3 fxEmissive(glow, intensity)
fxLightRef, fxEmissiveRef                           // JS-Referenzen
CascadeFitter, cascadeSplits, shadowNear, shadowEnd, MAX_CASCADES
NullShadowReceiver, shadowOptionsForPreset, SHADOW_PRESET_TABLE
```

Konventionen:
- `relPos` in `fxShadow` ist kamerarelativ in WU mit Ursprung `u_camPosInt`, also genau der Raum, den `u_viewProj`
  erwartet (`vec3(ivec3(posRaw) - u_camPosInt.xyz) / 4096.0`). `fxRelPos` aus core zieht zusätzlich
  `u_camFrac` ab. Der Unterschied ist < 1/4096 WU und für Schatten bedeutungslos. Beide Varianten sind zulässig.
- `sunDir` zeigt **zur** Sonne, wie `u_sunDir` in render. Ändert sich die Richtung, werden alle Kaskaden neu
  gefittet. Dieselbe Richtung mit anderer Länge löst keinen Refit aus.
- `stats.staticRefreshes` zählt `renderStatic`-Aufrufe, die mindestens eine Kaskade neu gezeichnet haben.
  Bei ruhender Kamera bleibt der Wert nach dem ersten Frame bei 1, mit 2 Kaskaden ist
  `staticCascadeRefreshes` dann 2.
- Szenenfarben sind **display-referred**, wie in render (Terrain/Units rechnen `albedo * (hemi + sun·ndl)`
  ohne Linearisierung). Der Composite linearisiert mit Gamma 2,2, wendet Exposure und ACES an und kodiert
  zurück. Der Bloom-Threshold wirkt auf display-referred Szenenwerte: 0,9 heißt, nur Werte nahe und über
  Weiß leuchten.
- `fxEmissive(glow, intensity)` wird zur beleuchteten Farbe **addiert**. Mit HDR entstehen Werte > 1, die der
  Bloom sichtbar macht. In der LDR-Variante wird die Farbe auf ihren hellsten Kanal normiert statt je Kanal
  geclippt. Die Glut bleibt so vollgesättigt (faction.md §3.5: „auf Low über vollgesättigte Farbe“). Die
  Variante wählt man mit `lightingGlsl(post.hdrActive)`.

## Preset-Zieltabelle (Zielbelegung für MS14)

`RENDER_PRESETS` in render haben noch `hdr/bloom: false`, `shadows: 'none'` und `msaa: 4` ab High. Die folgende
Tabelle ist die Zielbelegung nach DECISIONS 17 und steht als Code in `POST_PRESET_TABLE`/`SHADOW_PRESET_TABLE`.

| Preset | Szene | Bloom | FXAA | MSAA | Schatten | Kaskaden |
|---|---|---|---|---|---|---|
| Low | LDR RGBA8 | aus | an | – | keine (`NullShadowReceiver`) | – |
| Medium | HDR RGBA16F | 5 Stufen | an | – | Blob (kein CSM, `NullShadowReceiver`) | – |
| High | HDR RGBA16F | 5 Stufen | an | – (statt 4) | CSM 2048², statischer Cache | 2 |
| Ultra | HDR RGBA16F | 5 Stufen | an | – (statt 4) | CSM 2048², statischer Cache | 2 |

Parameter auf allen Stufen: Exposure 1,1, Bloom-Intensität 0,55, Threshold 0,9, Knee 0,45 (SPK4-Werte),
Schattenstärke 0,72.

## Integrationsanleitung

**MS14 – PostChain/CSM in render's Renderer** (`packages/render/src/renderer.ts`):
1. Der Renderer besitzt `post = new PostChain(dev, postOptionsForPreset(preset))`. Bei einem Preset-Wechsel
   ruft er `post.setOptions(postOptionsForPreset(p))` auf, in `Renderer.resize()` zusätzlich
   `post.resize(backbufferW, backbufferH)`.
2. Nur High/Ultra erzeugen `csm = new CascadedShadows(dev, { ...shadowOptionsForPreset(p).csm,
   worldMin: [0, minHeightWu - 1, 0], worldMax: [sizeWu, maxHeightWu + 6, sizeWu] })`, die Höhen kommen aus den
   Chunk-Bounds des Terrains. Low/Medium erzeugen einen `NullShadowReceiver`.
3. Frame-Ablauf:
   - `csm.update(camera, sunDir)` direkt nach dem Frame-UBO, mit derselben Sonnenrichtung wie `u_sunDir`.
   - `csm.renderStatic(drawTerrainAndProps)`.
   - `csm.renderDynamic(drawUnits)`.
   - `enc = post.beginScene(clear)` statt des Canvas-Passes. Terrain, Water, Units und Overlays laufen
     unverändert in diesen Encoder, danach die FX-Passes in der Reihenfolge nach PLAN §3.7.
   - `post.resolve()` als letzter Schritt. Die Draws zählen in `RenderStats` als eigener Posten `post`.
4. `Renderer.stats` bekommt `post.stats` und `csm.stats`. Zum GPU-Messen einzelner Phasen gibt es
   `resolve(mark)`; auf ANGLE-Metal kosten zusätzliche Timer-Segmente messbar Zeit (siehe Messwerte).
5. Vor dem Umstieg dieses Pfads müssen Water/Refraction prüfen, ob sie die Szenen-Tiefe lesen wollen.
   `post.sceneDepth` ist dafür ein normales DEPTH24-Target, es hat aber keinen Compare-Modus.

**MS14 – Receiver-GLSL in Terrain-/Unit-/Prop-FS:**
- FS: `${FRAME_BLOCK_GLSL}${SHADOW_RECEIVE_GLSL}${lightingGlsl(hdr)}`. Die bisherige Formel
  `albedo * (hemi + u_sunColor.rgb * ndl)` wird zu `fxLight(albedo, n, fxShadow(relPos, n))`, das Ergebnis ist
  identisch bei `shadow = 1`. `relPos` ist die kamerarelative Position, die der VS ohnehin berechnet; dafür
  kommt ein zusätzliches `out vec3`.
- `PipelineDesc`: `uniformBlocks: [...eigene, ...SHADOW_RECV_UNIFORM_BLOCKS]`,
  `samplers: [...eigene, ...SHADOW_RECV_SAMPLERS]`. Bind-Group: `buffers: [...eigene,
  ...csmOrNull.receiverBindings().buffers]`, `textures: [...eigene, ...receiverBindings().textures]`.
- Die Slots sind frei (render nutzt UBO 0–3 und Units 0–7, FX-Schatten liegt auf 7 bzw. 10/11). Die Handles
  von `receiverBindings()` ändern sich nie, auch nicht nach einem Context-Restore. Die Bind-Group muss also nur
  bei einem Wechsel zwischen CSM und `NullShadowReceiver` (Preset-Wechsel) neu gebaut werden.
- Units empfangen im Prototyp noch keine Schatten. Mit `fxShadow` im Unit-FS ist das jetzt ohne Mehraufwand
  möglich. Self-Shadowing verhindern Normal-Offset und Depth-Bias.

**MS14 – Caster-Bündelung (DECISIONS 17):**
- Terrain-Caster: der VS des Prototyps (`TERRAIN_CASTER_VS`) mit `SHADOW_CASTER_GLSL`. Statt `u_lightViewProj *
  vec4(rel, 1)` steht dort `fxShadowCasterPos(ivec3(xz.x, h, xz.y), vec3(0.0))`. Chunks werden mit
  `view.frustum` und `view.anchorRaw` gecullt (`PatchCuller.cull(frustum, anchor)`), aber nur bei einem Refit,
  also wenn `staticDirty[c]` gilt.
- Prop-Caster: instanziert, LOD 1, ein Draw pro (Mesh, LOD), nur im statischen Layer.
- Unit-Caster: **nur LOD 2 im Schatten ⇒ 1 Draw pro Visual und Kaskade**, oder `multiDrawIndexedInstanced`,
  wo verfügbar (Chromium/WebKit ja, Firefox nein). Culling pro Kaskade gegen `view.frustum` (Kugel über
  prev/cur, ankerrelativ) nur bei neuem Unit-Frame oder Refit, wie `ShadowUnitCuller` im Prototyp.
- Pipelines: `{ ...SHADOW_CASTER_PIPELINE, vertex, streams, uniformBlocks: [...SHADOW_CASTER_UNIFORM_BLOCKS,
  ...] }`. Im Callback nach `setPipeline` immer `enc.setBindGroup(view.bindGroup)` setzen, zusätzlich zu den
  eigenen Gruppen.

**MS5/MS7/MS13 (Glut, Bau, Schilde):** Emissive-Anteile (Glutnähte, Gießstrom, Scorch-Glut) nutzen `fxEmissive`
oder schreiben HDR-Werte > 1 direkt. Der Bloom macht sie ohne Extra-Pass sichtbar. Additive FX-Passes
(Partikel, Beams) landen in `post.sceneColor` (RGBA16F). Blending in RGBA16F braucht kein `EXT_float_blend`,
das gilt nur für 32-Bit-Float.

## Abweichungen vom Plan (mit Begründung)

1. **MSAA („MSAA ab High“) entfällt, FXAA läuft auf allen Stufen.** Das RHI hat keine Multisample-Renderbuffer
   (`TexDesc` kennt keine Samples, `PassDesc` kein Resolve). MSAA würde eine RHI-Erweiterung in render
   brauchen, und render darf in diesem Track nicht geändert werden. Wenn MS14 MSAA will: `RenderbufferDesc`
   mit `samples` plus Resolve-Pass (`blitFramebuffer`) im RHI, danach FXAA auf High/Ultra abschalten.
2. **Zusätzliche API** über die Vorgabe hinaus: `setOutputViewport`, `resolve(mark)`, `sceneLoadPass`,
   `targetInfo`, `casterView`, `setWorldBounds`, `NullShadowReceiver`, `LIGHTING_GLSL_LDR`/`lightingGlsl`,
   Stats-Felder `allocations`/`restores`/`staticCascadeRefreshes`/`refits`. `sceneColor`/`sceneDepth`/`hdrActive`
   sind Getter, weil sich die Handles bei `resize`/`setOptions` ändern. Von außen sind sie readonly.
3. **Headroom-Semantik**: Der Prototyp nutzte Radius ×1,15 und Box ×1,25, der Schrumpf-Test lag bei 0,55.
   Hier gilt ein Parameter `headroom` (Standard 1,4) mit Box-Halbkante = Kugelradius × headroom. Die Box wird
   neu gefittet, wenn die Kugel sie verlässt oder unter 1/headroom² der Box schrumpft. Die Ortho-Box ist
   zusätzlich exakt auf das gesnappte Zentrum gelegt; der Anker ist ganzzahlig gerundet und liegt deshalb
   bis zu 1 raw daneben.
4. **Tiefenbereich** aus konfigurierbaren Welt-Bounds (`worldMin/worldMax`) statt Kartengröße und Höhen.
   Standard ist die größte Karte (4096² WU, Höhen −64…512).
5. **`sunDir` als Parameter von `update()`** statt im Konstruktor, damit ein Tageszeit- oder Karten-Licht ohne
   Neuaufbau möglich ist. Eine Richtungsänderung refittet alle Kaskaden.

## Tests

- `test/post/post-chain.test.ts` (16 Tests):
  - `acesFilm`-Referenzwerte: 0 → 0, 0,18 → 0,2669, 1 → 0,8038, monoton, < 1 bis ≈ 7, Clamp auf 1.
  - `compositeHdr`, `kawaseOffsets` (Gewichte, Skalierung pro Stufe, Grenzen, Shader aus denselben Tabellen),
    Mip-Größen ungerader Auflösungen, Preset-Tabelle.
  - Ressourcen und Pipelines je Option (12 Targets und 4 Programme bei Bloom 5 + FXAA; 2 Targets und 1 Programm
    ohne Bloom und FXAA; Bloom 1 ohne Up-Pipeline).
  - LDR-Fallback bei fehlendem `EXT_color_buffer_float` bzw. `hdr: false`.
  - Draw-Zählung (11 / 1 / 2 / 3 / 13), `resize` ohne Neu-Allokation bei gleicher Größe, `scenePass`-Cache,
    `setOptions` (UBO-Inhalt, strukturell vs. Parameter).
  - Context-Loss/Restore: gleiche Handles, keine eigene Neu-Allokation, UBO einmal neu hochgeladen,
    Attachments zeigen auf die neue Generation.
  - `destroy`, Phasen-Callback, Output-Viewport.
- `test/light/cascades.test.ts` (10 Tests):
  - Splits (λ = 0/1/0,55, eine Kaskade, monoton bei 4), Splits folgen Zoom und `maxDistanceWu`.
  - Texel-Snapping: Box-Zentrum auf dem Texelraster, Box-Zentrum = Clip-Mitte.
  - Kleine Schwenks im Headroom lösen keinen Refit aus, ein großer Sprung refittet.
  - Zoom-Schrumpfen und Sonnenwechsel refitten; nur die Länge der Richtung zu ändern refittet nicht.
  - Receiver- und Caster-Matrix ergeben dieselbe Schatten-UV; Punkte liegen im Caster-Frustum;
    Tiefenbereich deckt die Welt-Bounds.
  - std140-Layouts = GLSL-Blöcke (geparst), Beleuchtungs-/Emissive-Referenzen, Schatten-Preset-Tabelle.
- `test/light/cascaded-shadows.test.ts` (10 Tests):
  - Textur-Formate, Compare `lequal`, Receiver-Bindings (Slot 7, Units 10/11).
  - **300 Frames ruhende Kamera → staticRefreshes 1**; dynamische Passes jeden Frame mit eigenem Clear.
  - Caster-Views, Schwenk/Sprung, `invalidateStatic`.
  - **Restore → dirty**; während des Verlusts wird nichts gerendert und nichts verworfen.
  - Receiver-UBO-Inhalt, eine Kaskade, `NullShadowReceiver`.
- Smoke (`pnpm --filter @faf/render-fx run smoke -- --cases=post,light --browsers=chromium,firefox,webkit`),
  in allen drei Browsern grün, inklusive Context-Loss/Restore mit erneutem Check:
  - `post`: Links läuft die Medium-Zielbelegung (HDR + Bloom 5 + FXAA, mit `?hdr=0` im Seiten-URL der
    LDR-Fallback), rechts Low (LDR, kein Bloom). Geprüft wird: Der Bloom-Halo fällt radial ab (6/12/20/40/80 px)
    und liegt bei 20 px > Hintergrund + 6. LDR/Low zeigt keinen Halo. FXAA erzeugt Zwischenwerte an den Kanten
    eines gedrehten Quadrats (Screenshot-Nachzählung: je 268 Pixel). 15 Draws.
  - `light`: 512-WU-Boden mit drei Quadern, zwei statisch (einer nah in Kaskade 0, einer fern in Kaskade 1)
    und einer dynamisch mit Glutband. Geprüft wird: Der Boden am analytisch berechneten Schattenpunkt jedes
    Quaders ist < 0,75 × der beleuchtete Nachbar, die Sonden decken beide Kaskaden ab.
    `staticRefreshes == 1 + restores`, dynamische Draws = 2.
  - Screenshots `test-results/render-fx-smoke/{post,light}-{chromium,firefox,webkit}.png` sind angesehen und
    in allen drei Browsern praktisch identisch. Sichtbar sind der runde Halo um den hellen Punkt, das orange
    glühende Band mit Bloom-Saum (links) bzw. gesättigt gelb-orange ohne Halo (rechts), weiche PCF-Schatten
    am Quaderfuß beider Kaskaden und das glühende Band am dynamischen Quader.

## Messwerte (lokal gemessen, Apple M5 Pro)

Playwright Chromium 153 headless, ANGLE-Metal, 960×540, Timer-Query (GpuSpanTimer aus core), p50 über
30 Frames, drei Läufe. **Grobe Werte**: Parallel liefen weitere Agenten, ein Ausreißer-Lauf (Last) wurde
verworfen. Die offizielle Messung macht rfx-p7 in fx-lab.

| Segment (Smoke-Fall) | GPU p50 |
|---|---|
| CSM `light`, ruhende Kamera: 2 dynamische Passes 2048² (Clear + 1 Draw) | 0,13–0,19 ms |
| Szene `light` (Boden + 3 Quader, Receiver-FS mit 4-Tap-PCF × 2 Ebenen) | 0,6–0,7 ms |
| PostChain `light` (HDR, Bloom 5, ACES, FXAA; 11 Passes, 960×540) | 3,2–3,3 ms |
| 2 PostChains `post` (480×540 je Hälfte, Medium + Low, 13 Passes) | 2,8–4,0 ms |
| JS `frame()` inkl. `csm.update` | 0,10–0,18 ms |

- Die statische Ebene wird nur im ersten Frame gezeichnet und steckt deshalb nicht im p50. Das
  Budget-Kriterium „CSM mit 2 Kaskaden ≤ 2,5 ms“ ist im ruhenden Fall weit unterschritten. Der Refit-Frame mit
  echten Terrain/Prop-Castern muss in fx-lab bzw. MS14 gemessen werden.
- Das letzte Segment endet mit dem Canvas-Pass. Auf ANGLE-Metal enthalten Timer-Segmente offenbar
  Command-Buffer-Lücken: Aufgeteilt in bloom/composite/fxaa maß jede Phase allein 2,2–2,8 ms, obwohl ein
  einzelner Fullscreen-Pass bei 960×540 weit darunter liegen muss. Die Post-Werte sind daher eine Obergrenze.
  Plausibler ist der SPK4-Wert von 1,3–2,3 ms bei 1536×864 (DECISIONS 17), der mit einem einzigen Segment
  gemessen wurde.

## Bekannte Grenzen

- GPU-Zeiten nur in Chromium (Firefox/WebKit ohne Timer-Query). Keine Messung auf iGPU oder echtem Safari (wie
  DECISIONS 17).
- Ein Richtungslicht (Forward). Punktlichter sind nicht vorgesehen (PLAN §3.7).
- Keine Karis-Mittelung im ersten Downsample. Stattdessen werden Eingangswerte > 64 geklemmt; das verhindert
  f16-Überläufe und NaN, einzelne sehr helle Pixel können aber leicht flackern.
- FXAA liest Luma aus dem Alpha des LDR-Targets. Wer den Composite überspringt, muss Luma selbst schreiben.
- Ein Sonnenrichtungswechsel refittet alle Kaskaden. Ein Tageszeitlauf würde deshalb jeden Frame die
  statische Ebene neu zeichnen (dann Richtung quantisieren).
- Kaskaden-Überblendung bei 12 % der Split-Tiefe mit doppeltem Sampling in diesem Band. Debug-Darstellung
  der Kaskaden gibt es noch keine.
