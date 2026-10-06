# rfx-p3-particles – Zustandsloses GPU-Partikelsystem

Track TRACK-RENDERFX, Welle 1. Paket `packages/render-fx/src/particles` (Barrel `src/particles/index.ts`, über
`@faf/render-fx` exportiert). Grundlage: PLAN §3.7 „zustandsloser Spawn-Ring (64k, Cap nach Preset), f(t−t0) im VS,
Kurven-LUT, defineEffect-Daten, Prioritäten“, Effektdaten/Referenz aus rfx-p1 (`src/effects`).

## Umgesetzt

| Datei | Inhalt |
|---|---|
| `src/particles/system.ts` | `ParticleSystem` (Ring, Upload, Fenster, Alive-Histogramm, Caps/Prioritäten, Sichtbarkeits-Culling, Dauer-Emitter, Draw), `particleCapForPreset`, Konstanten, allokationsfreie Hash-Helfer `hashLo16`/`hashHi24` |
| `src/particles/record.ts` | Record-Layout (32 B), `PARTICLE_STREAM_LAYOUT`, `writeRecord`/`readRecord`/`recordViews`, `encodeVecHalf`, `halfBitsAt` (bitgleich zu `toHalf`, ohne Double-Boxing) |
| `src/particles/shaders.ts` | `PARTICLE_VS` (geschlossene Form, Hash in uint-Arithmetik, LUT), `PARTICLE_FS` (prozedurale Formen), `PARTICLE_HASH_GLSL`, `GROUND_LIFT_WU`, `STREAK_SECONDS` |
| `src/particles/vs-mirror.ts` | JS-Spiegel des Vertex-Shaders (`mirrorParticle`, `mirrorCorner`, `mirrorLut`) mit f32-Rundung wie auf der GPU |
| `smoke/cases/particles.ts` | Smoke-Fall (Stress-Messung 65.536 Partikel + visuelle Szene mit Pixel-Parität) inkl. Look-Dev-Ansicht |
| `test/particles/*.test.ts` | 35 Tests (s. u.), `alloc-probe.ts` (Kind-Prozess für die Allokationsmessung) |

## Öffentliche API

```ts
class ParticleSystem {
  constructor(dev: GpuDevice, bindings: FxBindings, lib: EffectLibrary,
              opts: { capacity?: number /* Ring, Standard 65536, ≤ 2^20 */; cap: number /* ≤ capacity */;
                      onShake?: (effect: EffectDefCompiled, posRaw: Int32Array | readonly number[], tS: number) => void });
  readonly capacity: number; readonly lib: EffectLibrary;
  setCap(n: number): void;                     // sofort wirksam; Partikel über dem neuen Cap leben aus
  spawn(effectIdx, posRaw, o?: { dir?; scale?; seed?; tint? /* 0xRRGGBB */; targetRaw? }): number;   // geschriebene Partikel
  createEmitter(effectIdx, posRaw, o?): number;  // Handle, −1 wenn alle 1024 belegt; wirft bei nicht-continuous Effekt
  moveEmitter(h, posRaw, targetRaw?): void;      // ohne targetRaw bleibt das absolute Ziel stehen
  setEmitterRate(h, scale): void;                // 0 = Pause
  destroyEmitter(h): void; hasEmitter(h): boolean;  // veraltete Handles werden ignoriert (Generationszähler)
  update(nowS: number, camera: RtsCamera): void; // einmal pro Frame, vor encode()
  encode(enc: PassEncoder): number;              // 0/1/2 Draws
  readonly stats: ParticleStats;                 // immer dasselbe Objekt, in place aktualisiert
  readonly timeS: number; readonly records: RecordViews; readonly windowRange; expiryOf(slot); // Diagnose/Tests
  clear(): void; destroy(): void;
}
interface ParticleStats { alive; cap; capacity; spawnedFrame; requested: [p0,p1,p2]; dropped: [p0,p1,p2]; culled;
  uploadBytesFrame; emitters; overwritten; window; draws }   // letzte drei = Erweiterung
particleCapForPreset(p: RenderPresetName | RenderPreset): number   // low 8192, medium 16384, high 32768, ultra 65536
```

Konstanten: `PARTICLE_RING_CAPACITY = 65536`, `MAX_PARTICLE_EMITTERS = 1024`, `EXPIRY_BUCKET_S = 1/64`,
`PRIO2_CAP_FRACTION = 0.75`, `CULL_RADIUS_PX = 1.5`, `THIN_RADIUS_PX = 8`, `MAX_EMIT_DT_S = 0.25`,
`UNIT_FX_PARTICLE_LAYERS = 15`, `PARTICLE_RECORD_STRIDE = 32`.

### Frame-Protokoll

1. `spawn()`/`createEmitter()` jederzeit (z. B. beim Abarbeiten des Event-Streams). Vor `update()` gespawnte Records
   sind „pending“ und bekommen in `update()` die Frame-Zeit als t0.
2. `update(nowS, camera)`: `nowS` = dieselbe Uhr, die `FxFrameUniforms.update` als `timeS` bekommt (FX-Zeit im Shader
   = `nowS mod 4096`). Die Kamera muss aktuell sein (`FxFrameUniforms.update` ruft `camera.update()`); sie wird nur
   für das Culling gelesen. Läuft die Uhr rückwärts (Szenenwechsel/Replay-Seek), wird der Ring geleert.
3. `spawn()` zwischen `update()` und `encode()` bekommt sofort die aktuelle Zeit.
4. `encode(enc)` lädt noch nicht hochgeladene Records hoch und zeichnet – **ein spawn() vor encode() desselben Frames
   ist in diesem Frame sichtbar** (MS5 „VFX ≤ 1 Frame“, Test „frame protocol“).

## Record-Layout (Ring, Instanz-Vertexbuffer, 32 B je Partikel)

| Byte | Typ | Shader-Input | Inhalt |
|---|---|---|---|
| 0–11 | i32×3 | `ivec3 a_origin` | Emitter-Ursprung, raw Q20.12 |
| 12–15 | f32 | `float a_t0` | Spawnzeit, FX-Sekunden mod 4096 |
| 16–23 | u16×4 | `uvec4 a_vec` | f16-Bitmuster: ballistisch = Emissionsachse (Einheitsvektor), stream = Ziel − Ursprung in WU; w = Effekt-Scale |
| 24–25 | u16 | `uvec2 a_layerSeed.x` | globaler Layer-Index |
| 26–27 | u16 | `uvec2 a_layerSeed.y` | Partikel-Seed |
| 28–31 | u8×4 | `vec4 a_tint` (norm) | Spawn-Tint R, G, B, 255 |

Das RHI kennt kein Half-Vertexformat → die f16-Werte reisen als u16-Bits und werden im VS mit `unpackHalf2x16`
dekodiert. Records werden nach dem Spawn nie wieder angefasst; es gibt kein Per-Partikel-Update auf der CPU.

## GPU-Seite

- **Ein Draw** (`drawInstanced(4, n)`, triangle-strip aus `gl_VertexID`) über das Live-Fenster `[tail, head)` des Rings;
  zwei Draws, wenn das Fenster über das Ringende läuft (zweiter Draw mit Stream-Offset 0 – WebGL2 hat keine
  Base-Instance). Tote und noch verzögerte Partikel im Fenster → degeneriertes Quad außerhalb des Clip-Volumens.
- **VS** = exakt die Formel aus rfx-p1 (`evalParticle`/`particleRandoms`, Hash `fxHash32` in uint-Arithmetik): Lebensdauer,
  Delay, Kegelrichtung (Duff-ONB), Speed, Drag/Gravity geschlossen, Stream-Pfad mit Welle und Durchhang, Größe/Farbe/
  Blend/Stretch aus der **Kurven-LUT** (RGBA16F, 64 × 2·Layer, linear, Unit `UNIT_FX_CURVE_LUT` = 12), Layer-Konstanten
  aus der **Layer-Tabelle** (RGBA32F-Datentextur 8 × Layer, `texelFetch`, Unit `UNIT_FX_PARTICLE_LAYERS` = 15).
  Positionen kamera-relativ (`fxRelPos(a_origin) + offset`). Orientierungen: billboard (u_fxRight/u_fxUp, Rotation),
  velocity (Streak entlang der Bildschirmgeschwindigkeit, Länge = size + stretch·|v⊥|·0,05 s, Kopf am Partikel),
  ground (flach auf XZ, +0,05 WU gegen Z-Fighting, für Schockwellen/Bodenfeuer).
- **FS** prozedural (keine Texturen): glow (fbm-zerfranster Feuerball, emissiver Anteil kühlt am Rand nach Dunkelrot),
  spark (Streak mit hellem Kopf), smoke (fbm-Puff mit Pseudo-Volumenlicht aus Sonnenrichtung: helle Oberseite,
  dunkler Bauch), ring (Stoßfront: scharfe, zerfranste Außenkante, kurzer Nachlauf nach innen), debris (harte,
  einseitig beleuchtete Brocken), flash (Kern + Vierstrahl-Stern), stream (überlappende Tropfen → durchgehender Strom).
- Ausgabe **premultiplied** `(rgb·α, α·blend)` → additive (blend 0) und Alpha-Partikel (blend 1) in EINEM Draw mit
  blend `'premultiplied'`, depthTest an, depthWrite aus.
- **Bewusst ohne Sortierung** (additive Anteile sind reihenfolgeunabhängig; Rauch überlagert sich in Spawn-Reihenfolge –
  bei RTS-Kameradistanz nicht störend, kostet keinen CPU-Sort pro Frame) und **ohne Soft-Particles** (die Szenentiefe
  ist im selben Pass Render-Target; als Textur ginge sie nur mit einer Tiefenkopie pro Frame – bei Bedarf in MS14
  zusammen mit der PostChain nachrüstbar).
- **Context-Loss**: Ring-Puffer `restore` lädt den gesamten CPU-Spiegel hoch (Partikel fliegen nach dem Restore weiter,
  weil Records unveränderlich sind), LUT und Layer-Tabelle haben eigene `restore`-Callbacks.

## Cap- und Prioritäten-Politik

- Alive-Zählung ohne Scan: Ablaufzeit je Slot (Float64Array, absolute Sekunden) + Histogramm in 1/64-s-Buckets (8192
  Buckets = 128 s); ein Partikel zählt bis zum Ende seines Ablauf-Buckets. `alive` = Histogramm + pending Records
  (Test: == Brute-Force über den Ring).
- Fenster: `tail` rückt über abgelaufene Slots vor (in Ring-Reihenfolge); ein langlebiger Partikel am Ende hält das
  Fenster offen, tote Partikel dahinter kosten nur VS-Arbeit.
- **Priorität 0** wird nie verworfen (Kernlayer des ACU). Ist der Ring voll, überschreibt sie den ältesten Slot
  (`stats.overwritten`). **alive kann den Cap um die Prio-0-Partikel überschreiten** (dokumentierter Überschuss:
  höchstens die in ihrer Lebensdauer gespawnten Prio-0-Partikel; Varkan: 1 Blitz + ≤ 110 Feuerball + 1 Ring je ACU).
- **Priorität 1** bis `alive < cap`, **Priorität 2** nur bis `alive < 0,75·cap`; Überschuss zählt `dropped[p]`.
- **Sichtbarkeit** (nur Priorität 2, je Burst/Emitter mit Kugel `boundsWu·scale`): außerhalb des Frustums → verworfen;
  Bildschirmradius < 1,5 px → verworfen; < 8 px → proportional ausgedünnt; Zähler `culled`. Priorität 0/1 wird nie
  gecullt (Explosionen außerhalb des Bildes bleiben korrekt, wenn die Kamera hinschwenkt).
- Zähler `requested`/`dropped` kumulativ je Priorität.

## Dauer-Emitter

Max. 1024, Handle = Index | Generation<<10 (Freelist, veraltete Handles werden ignoriert). Je Layer ein Akkumulator
`rate·rateScale·dt`; die Partikel eines Frames bekommen gleichmäßig verteilte, fraktionale t0 innerhalb des Frames
(kein Pulsieren; Test: 100/s → 100 ± 1 in 1 s, t0-Abstand 10 ms). dt wird auf 0,25 s begrenzt (kein Schwall nach
Hängern). Burst-Layer eines continuous-Effekts werden bei `createEmitter` einmal gespawnt. Emitter-Vektoren (f16) werden
nur bei create/move neu kodiert.

## Allokationsfreiheit

`update()`, `encode()`, Emitter und `spawn()` allokieren im warmen Zustand nicht: Doubles überqueren keine
Funktionsgrenzen (Float64Array-Scratch), Hash-/Half-Helfer liefern kleine Ganzzahlen (`hashLo16`, `hashHi24`,
`halfBitsAt`, bitgleich zu `fxHash32`/`toHalf`, getestet), eigene Frustum-Ebenen statt render's `Frustum`
(`setFromViewProj` boxt über `Math.hypot`), `camera.update()` wird nicht aufgerufen. Messung im Kind-Prozess
(`node --expose-gc`, 80 Emitter, 20.000 Warm-up-Frames, bestes von 3 × 3.000 Frames): ≈ 22 B/Frame ohne und
≈ 57 B/Frame mit zwei `spawn()` pro Frame (Rauschen der Heap-Buchhaltung; vorher 1,2–2 KB/Frame). Test-Schwelle
128 B/Frame – ein geboxter Double je Partikel oder Emitter läge bei > 1 KB/Frame.

## Tests (`pnpm exec vitest run packages/render-fx/test/particles`) – 35 grün

- `system.test.ts` (21): Preset-Caps; Upload nur neuer Records (1 writeBuffer, `uploadBytesFrame = n·32`); Ring-Umlauf
  (2 writeBuffer an Slot 200 und 0, 2 Draws mit Stream-Offsets 200·32 und 0); leeres/zusammenhängendes Fenster (0/1
  Draw); > capacity in einem Frame → 1 Voll-Upload + overwritten; Record-Layout; Fenster-tail == Brute-Force;
  alive == Brute-Force (400 Frames, Zufallslast, Emitter); Cap-Regeln (P2 bei 0,75·cap, P1 bei cap, P0 immer);
  Überlast (P0 nie verworfen, P2 zuerst); setCap; Off-Screen-Culling; Ausdünnen bei großer Distanz; Emitter-Rate
  100 ± 1, gleichmäßige t0, Pause/Rate×2/dt-Klemme; moveEmitter (mit/ohne Ziel); Handles/Freelist/1024-Grenze;
  Latenz spawn→encode; onShake; rückwärts laufende Uhr; Restore (Ring-Spiegel + LUT + Layer-Tabelle); destroy.
- `mirror.test.ts` (9): Layout/Offsets/GLSL-Konstanten; **GLSL-Parität: VS-Spiegel == evalParticle für 10.000
  Zufallsfälle (alle Varkan-Layer, Streams, Tint), Position < 1e-3 WU**, Größe/Farbe/Blend/Rotation/Geschwindigkeit;
  FX-Zeit-Wrap; `mirrorLut == sampleBaked`; Quad-Ecken billboard/ground/velocity.
- `alloc.test.ts` (5): Allokationsmessung update+encode und mit spawn (Kind-Prozess); Stats-Objekt-Identität;
  `hashLo16/hashHi24 == fxHash32`; `halfBitsAt == toHalf` (Grenzfälle + 200.000 Werte).

## Smoke `smoke/cases/particles.ts` (Chromium, Firefox, WebKit grün, inkl. Context-Loss → Restore)

`tools/heavy pnpm --filter @faf/render-fx run smoke -- --cases=particles --browsers=chromium,firefox,webkit`

Alles rendert durch eine `PostChain` mit Medium-Zielwerten (HDR + Bloom + ACES + FXAA) wie in fx-lab.
1. Stress-Phase (150 Frames): zweites System, Ring 65.536, Cap 65.536, 2.000 Spawns/Frame (20 Bursts à 100,
   4 Formen), Ergebnis in `window.__rfxParticleBench`. Check: Spitze ≈ Cap, P1-Drops > 0, Umlauf-Frames mit 2 Draws.
2. Visuelle Phase (100 Frames): acu_explosion + acu_aftermath, explosion_large, explosion_medium, impact_metal,
   muzzle_cannon, smoke_damage-Emitter, build_stream-Emitter und zwei Marker. Checks: statischer Marker-Schwerpunkt =
   `project()` ±2 px; **bewegter Marker (Drag + Gravity) = Projektion von `mirrorParticle` ±2 px (GPU/CPU-Parität)**;
   ACU: ≥ 400 helle und ≥ 300 feuerfarbene Pixel; Gießstrom: ≥ 4/5 Pfadpunkte glühen; 1–2 Draws. Nach dem Restore
   dieselben Checks (Partikel fliegen weiter).
3. Look-Dev (nicht im Harness): `index.html?case=particles&pview=<id,…>&page=<s>&pdist=<WU>&pspacing=<WU>` zeigt
   beliebige Effekte zu einem Alter – damit wurden alle Varkan-Effekte zu mehreren Zeitpunkten angesehen.

Screenshots `test-results/render-fx-smoke/particles-{chromium,firefox,webkit}.png` angesehen: in allen drei Browsern
identisch; Feuerball mit orangem Rand und Funken-Streaks, Stoßfront-Ring am Boden, Rauchpuffs mit heller Oberseite,
durchgehender Gießstrom, Marker an der erwarteten Stelle.

### Shader-Verbesserungen nach Sichtprüfung

- glow: vorher glatte Scheiben, gestapelt → flacher weißer Kreis; jetzt fbm-zerfranste Silhouette und rot abkühlender
  emissiver Rand → Feuerball statt Kreis.
- smoke: vorher bei mittelhellem Boden unsichtbar (Rauchfarbe ≈ Bodenhelligkeit); jetzt Pseudo-Volumenlicht aus
  `u_sunDir` (v_light im Quad-Raum) → lesbare Puffs auf hellem wie dunklem Grund.
- ring: vorher Gauß-Donut + Füllung; jetzt Stoßfront mit scharfer Außenkante und kurzem Nachlauf.

### Tuning-Bedarf für rfx-p6 (Effektdaten sind eingefroren)

- `acu_explosion.shockwave`: HDR 7 → 3,5 auf 70–100 WU Durchmesser ist viel zu hell; der Bloom füllt das Ringinnere zu
  einer leuchtenden „Glaskuppel“. Empfehlung: Intensität ≈ 1,5–2,5, eher Staub-/Hitzeflimmer-Farbe, ggf. `blend` 0,3–0,5.
- `acu_explosion.flash` (HDR 14, bis 34 WU) und Feuerbälle (`fireballColor(6)`) sättigen unter ACES zu Weiß; der orange
  Rand kommt erst ab ≈ 1 s. Kern-Intensität 3–4 würde mehr Farbe zeigen.
- Rauch (`IRON_SMOKE`/`fireSmokeColor`) hat fast dieselbe Helligkeit wie typisches Terrain; etwas dunkler (Ruß) oder
  größer/dichter (explosion_large-Rauch 2–6,5 WU wirkt bei 70–150 WU Kameradistanz klein).
- `smoke_damage`/`wreck_smolder` (0,4–1,8 WU) sind bei Schlachtzoom nur wenige Pixel groß.
- `build_stream.pour` (HDR 4,5) hat einen weißen Kern; Strom ist durchgehend und fließend (Anforderung erfüllt).

## Messwerte (lokal gemessen, Apple M5 Pro, Chromium 153 / ANGLE Metal, Canvas 960×540)

Stress-Phase des Smoke-Falls, 90 Messframes nach 60 Warm-up-Frames, 3 Läufe:

| Größe | Wert |
|---|---|
| lebende Partikel | Ø 65.204, Spitze 65.375 (Cap 65.536), Fenster 65.536 (voller Ring, 2 Draws je Frame) |
| gespawnt / hochgeladen je Frame | 1.990 Partikel / 63,7 KB (2 writeBuffer) |
| GPU Partikel-Pass (GpuSpanTimer, p50) | **1,93–1,94 ms** (HDR RGBA16F, Überzeichnung durch 0,5–2,5-WU-Partikel über die halbe Szene) |
| CPU `update()+encode()` p50 / p95 | **0,03–0,045 ms / 0,045–0,10 ms** |
| CPU 20 × `spawn()` (2.000 Partikel) p50 / p95 | 0,085–0,16 ms / 0,13–0,38 ms |
| visuelle Szene (≈ 1.500 Partikel) GPU p50 | 0,25 ms Partikel, 0,58 ms Post |

Firefox/WebKit headless ohne Timer-Query (GPU n/v); JS-Zeiten dort in derselben Größenordnung.

## Integrationsanleitung

- **MS5 (einfache Event-Sprites → ParticleSystem)**: Der Client hält ein `ParticleSystem` mit `compileEffectLibrary(
  VARKAN_EFFECTS)`; Frame-Events (Waffe, Einschlag, Tod, Bau/Reclaim, Schaden) werden über `VARKAN_EVENT_FX` auf
  Effekt-IDs abgebildet (`lib.indexOf` einmal vorab auflösen) und mit `spawn(idx, posRaw, { dir, seed, tint })`
  ausgelöst; `seed` aus Entity-ID/Tick (deterministische Optik bei Replays). Dauerzustände (Bau-/Reclaim-Strom,
  Schadensrauch, Wrack, Raketenrauch) → `createEmitter`/`moveEmitter`/`setEmitterRate`/`destroyEmitter` je Entity.
  Teamfarben: `glowTintForArmyColor(rgb).tint` als `tint`. ACU-Tod: `onShake` → `CameraShake.addFromEffect` an der
  Client-Kamera. Latenz ≤ 1 Frame: Events vor `encode()` spawnen.
- **MS7 (Pass-Reihenfolge in render)**: `update(nowS, camera)` nach `FxFrameUniforms.update` (bzw. nach dem
  Frame-Block-Update von render, `FxFrameUniforms` mit `{ frameUbo }`), `encode(enc)` im Szenen-Pass nach Units/Water
  und Shields, vor Beams/Trails (PLAN §3.7). Bindings: Frame-Block an Slot 0, FxView an Slot 6, LUT an Unit 12,
  Layer-Tabelle an Unit 15 (neu – in der Slot-Tabelle von render reservieren). `nowS` = dieselbe Uhr wie die FX-Zeit
  (interpolierte Client-Zeit).
- **Presets/Caps (MS7/MS14)**: `new ParticleSystem(dev, bindings, lib, { cap: particleCapForPreset(preset) })`,
  Ring immer 65.536 (2 MB), Preset-Wechsel zur Laufzeit per `setCap`. Low 8.192 → im Gefecht greift der Cap (P2 zuerst).
- **Stats für HUD/Bench**: `stats.alive/cap/dropped/culled/uploadBytesFrame/draws` (fx-lab `LabFxStats.particles`,
  `uploadBytes` = `uploadBytesFrame`).

## Abweichungen

- Zusätzliche Textur-Unit **15** (`UNIT_FX_PARTICLE_LAYERS`) für die Layer-Tabelle als RGBA32F-Datentextur (UBO wäre
  bei 256 Layern × 128 B = 32 KB über dem garantierten 16-KB-UBO-Limit). Die Slot-Tabelle in `core/slots.ts` gehört
  rfx-p0 und wurde nicht geändert; die Konstante steht in `particles/system.ts`.
- Ablaufzeiten als Float64Array (statt Float32Array) und Histogramm mit 1/64-s-Buckets (statt 0,1 s) – genauer und
  gleich billig.
- `update()` ruft `camera.update()` nicht selbst (Allokation in render's Kamera); Vertrag: Kamera ist aktuell.
- `spawn()` hat keinen eigenen Speed-Multiplikator (API laut Aufgabe); `scale` skaliert Größe, Speed, emitRadius und
  Stream-Welle wie in `evalParticle`.
- `stats` enthält zusätzlich `overwritten`, `window`, `draws`; zusätzliche Methoden `hasEmitter`, `timeS`, `records`,
  `windowRange`, `expiryOf` (Diagnose/Tests).
- Seeds im Ring sind u16 (wie in rfx-p1 dokumentiert); Burst-Seed-Basen 24 Bit.

## Bekannte Grenzen

- Keine Sortierung, keine Soft-Particles (s. o.); Rauch vor Rauch kann in seltenen Fällen „falsch herum“ überlagern.
- Tote Partikel innerhalb des Fensters kosten VS-Arbeit (degeneriert); bei stark gemischten Lebensdauern (lange
  Rauchpartikel am Fensterende) zeichnet der Draw bis zu `capacity` Instanzen. Gemessen unkritisch (65.536 Instanzen
  ≈ 1,9 ms inkl. Fragmentarbeit).
- Pixel-Culling nutzt die CSS-Viewportgröße der Kamera (Schwellen in CSS-Pixeln).
- GPU-Zeiten nur in Chromium (Timer-Query headless nur dort).
