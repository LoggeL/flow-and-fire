# rfx-p1-effects-decals – Effekt-Datenmodell, Varkan-Bibliothek, Kamera-Shake, Scorch-Decals

Track TRACK-RENDERFX, Welle 0. Reines TypeScript ohne GPU-Aufrufe; einzige interne Abhängigkeit ist
`../core/slots.ts`. Kein `Math.random`; alle Zufallswerte stammen aus `fxHash32`/`FxRng`.

## Umgesetzt

| Datei | Inhalt |
|---|---|
| `src/effects/random.ts` | `fxFmix32`, `fxHash32(a, b?, c?)`, `hashToUnit`, `orthonormalBasis` (Duff et al.), `class FxRng` (next/float01/range/int/unitVector/cone/reseed) |
| `src/effects/curves.ts` | `Curve`, `ColorCurve`, `hexColor`, `colorKey`, `sampleCurve`, `sampleColorCurve`, `bakeCurve`, `bakeColorCurve`, `sampleBaked`, `LUT_WIDTH = 64`, `MAX_HDR_INTENSITY = 16` |
| `src/effects/define.ts` | Typen `EffectLayerDef`/`EffectDef`/`EffectShakeDef`, `defineEffect` mit Laufzeitvalidierung (Fehlertext `defineEffect(<id>) layer '<name>': …`), `effectBudget` |
| `src/effects/compile.ts` | `compileEffectLibrary` → `EffectLibrary` (Layer-Tabelle, LUT, Index, Hash), Feld-Offsets `L_*`, `LAYER_STRIDE = 32`, `SHAPE_ID`/`ORIENT_ID`/`MOTION_ID` |
| `src/effects/reference.ts` | CPU-Referenz `evalParticle`, `particleRandoms`, `createParticleState` |
| `src/effects/shake.ts` | `class CameraShake` (16 Quellen, allokationsfrei), `shakeNoise` |
| `src/effects/varkan.ts` | `VARKAN_EFFECTS` (21 Effekte, 77 Layer), `VARKAN_EVENT_FX`, `VARKAN_GLOW`, `glowTintForArmyColor`, `hueSat` |
| `src/decals/scorch.ts` | `class ScorchDecals`, `SCORCH_CAPS`, `SCORCH_GLSL`, `SCORCH_BLOCK_GLSL`, `SCORCH_LAYOUT`, `SCORCH_SAMPLERS`, `SCORCH_UNIFORM_BLOCKS`, `scorchShadeReference`, `VARKAN_SCORCH` |

Barrels: `src/effects/index.ts` und `src/decals/index.ts` (werden von `src/index.ts` re-exportiert).

## Datenmodell (Erweiterungen gegenüber der Aufgabenbeschreibung)

- `blend` ist eine `Curve` (Konstante oder Keys), damit Rauch „feurig-additiv → Alpha“ überblenden kann; der LUT-Kanal war dafür ohnehin vorgesehen.
- Neu `spreadInner` (Grad, Standard 0): Richtungen liegen zwischen innerem und äußerem Kegel → flache Radialringe (Staubring, Wasserkrone).
- Stream-Layer: `streamWave` (Amplitude WU) und `streamWaves` (Wellen entlang des Pfads).
- `lifetime` ≤ 30 s, `delay` ≤ 10 s → Alter ≤ 40 s, damit liegt jede Partikel sicher unter dem 60-s-Vertrag; eine eigene Summenprüfung ist dadurch unnötig.
- `rate` ist nur in `continuous`-Effekten erlaubt; ein continuous-Effekt braucht mindestens einen Layer mit `rate > 0`.
- `EffectDefCompiled` (Typname, auf den rfx-p3 in `onShake` verweist) enthält `id, index, def, firstLayer, layerCount, continuous, boundsWu, shake, maxBurst, budget, minPriority, maxAgeS`. `lib.layerInfo[i]` liefert auf der CPU `countMin/countMax/rate/priority/motion/lifeMax/delayMax` je Layer.

### Layer-Tabelle (`lib.layers`, 32 Floats = 8 RGBA32F-Texel je Layer)

| Offset | Konstante | Inhalt |
|---|---|---|
| 0/1 | `L_LIFE_MIN/MAX` | Lebensdauer s |
| 2/3 | `L_SPEED_MIN/MAX` | Startgeschwindigkeit WU/s |
| 4 | `L_COS_SPREAD` | cos(äußerer Halbwinkel) |
| 5 | `L_GRAVITY` | WU/s² (y) |
| 6 | `L_DRAG` | 1/s |
| 7 | `L_EMIT_RADIUS` | WU |
| 8/9 | `L_DELAY_MIN/MAX` | s |
| 10/11 | `L_SPIN_MIN/MAX` | rad/s |
| 12 | `L_SIZE_JITTER` | 0..1 |
| 13 | `L_STRETCH` | Streak-Faktor |
| 14/15/16 | `L_SHAPE`/`L_ORIENT`/`L_MOTION` | IDs: glow 0, spark 1, smoke 2, ring 3, debris 4, flash 5, stream 6 · billboard 0, velocity 1, ground 2 · ballistic 0, stream 1 |
| 17 | `L_PRIORITY` | 0/1/2 |
| 18 | `L_TINT` | 0 none, 1 spawn |
| 19 | `L_LUT_ROW` | 2·Layer (Farbzeile; Größenzeile = +1) |
| 20/21 | `L_STREAM_WAVE/WAVES` | Stream-Welle |
| 22/23 | `L_COUNT_MIN/MAX` | Burstgröße |
| 24 | `L_RATE` | Partikel/s |
| 25 | `L_EFFECT` | Effektindex |
| 26 | `L_SIZE_MAX` | größter Wert der Größenkurve (Bounds) |
| 27 | `L_SPREAD_RAD` | äußerer Halbwinkel rad |
| 28 | `L_COS_SPREAD_INNER` | cos(innerer Halbwinkel), 1 wenn 0° |
| 29–31 | – | reserviert (0) |

### Kurven-LUT (`lib.lut`)

RGBA-Float, Breite 64, Höhe 2·nLayers (Varkan: 64 × 154). Zeile 2i = Farbe (lineares HDR-rgb, Alpha), Zeile 2i+1 = (Größe WU, blend, stretch, 0). Stützstellen bei t_i = i/63. GPU-Abtastung mit linearer Filterung bei `u = (a·63 + 0.5)/64`, `v = (row + 0.5)/height` – das entspricht exakt `sampleBaked` auf der CPU. Werte ≤ 16 passen in RGBA16F.

## Exakte Partikelformel (für den Vertex-Shader von rfx-p3)

Hash (u32-Arithmetik, GLSL-Spiegel steht im Kopf von `random.ts`):

```
fmix(h): h ^= h>>16; h *= 0x85EBCA6B; h ^= h>>13; h *= 0xC2B2AE35; h ^= h>>16
fxHash32(a,b,c) = fmix( fmix( fmix(a + 0x9E3779B9) ^ (b + 0x7F4A7C15) ) ^ (c + 0x94D049BB) )   (alles mod 2^32)
```

Zufallswerte je Partikel (`seed` = Partikel-Seed, im Ring u16; `layer` = globaler Layerindex):

```
h_k = fxHash32(seed, layer, k),  k = 0..4
lo(h) = (h & 0xFFFF) / 65536     hi(h) = (h >> 16) / 65536
uLife = lo(h0)  uSpeed = hi(h0)
uCos  = lo(h1)  uPhi   = hi(h1)
uSpin = lo(h2)  uAngle = hi(h2)
uSize = lo(h3)  uRad   = hi(h3)
uDelay= lo(h4)  uPhase = hi(h4)
```

Abgeleitete Größen (Spawn: `origin`, Achse `axis` (Einheitsvektor, Standard +y), `speedMul` (Standard 1), `scale` (Standard 1), optional `target`, `tint`):

```
life  = mix(lifeMin, lifeMax, uLife)          delay = mix(delayMin, delayMax, uDelay)
t     = age − delay;  lebendig ⇔ 0 ≤ t < life;  a = t / life
cosθ  = cosInner − uCos·(cosInner − cosSpread);  sinθ = sqrt(max(0, 1 − cos²θ));  φ = 2π·uPhi
ONB(n): s = n.z ≥ 0 ? 1 : −1; q = −1/(s + n.z); b = n.x·n.y·q
        b1 = (1 + s·n.x²·q, s·b, −s·n.x);  b2 = (b, s + n.y²·q, −n.y)
(b1, b2) = ONB(axis);  d = b1·sinθ·cosφ + b2·sinθ·sinφ + axis·cosθ
speed = mix(speedMin, speedMax, uSpeed)·speedMul·scale;  v0 = d·speed
p0    = origin + d·emitRadius·scale·uRad
ballistic (g = (0, gravity, 0), k = drag):
  k ≤ 1e−6: p = p0 + v0·t + ½·g·t²                           v = v0 + g·t
  sonst:    p = p0 + g·t/k + (v0 − g/k)·(1 − e^(−k·t))/k      v = g/k + (v0 − g/k)·e^(−k·t)
stream (D = target − origin; axisS = D/|D|, bei |D| ≤ 1e−6 axis):
  (c1, c2) = ONB(axisS);  ψ = 2π·uPhi;  n = c1·cosψ + c2·sinψ
  lat = emitRadius·scale·uRad·(1 − a) + streamWave·scale·sin(π·a)·sin(2π·(streamWaves·a + uPhase))
  p   = origin + D·a + n·lat + (0, ½·gravity·t·(t − life), 0)     (speed/spread ungenutzt)
size     = lutSize(a)·scale·(1 + sizeJitter·(2·uSize − 1))
color    = lutColor(a); bei tint 'spawn': rgb ·= (R,G,B)/255 aus tint 0xRRGGBB (Standard 0xFFFFFF)
blend    = lutBlend(a); stretch = lutStretch(a)
rotation = 2π·uAngle + mix(spinMin, spinMax, uSpin)·t
```

Hinweise für den Shader: Im Stream-Modus zeigt `gravity < 0` einen nach oben gewölbten Bogen („Gießstrahl“). Bei `orient 'velocity'` wird die Quad-Länge laut Datenmodell `size + stretch·|v|·0,05 s` – die Screen-Space-Umsetzung legt rfx-p3 fest. Die Parität testet rfx-p3 gegen `evalParticle` (Toleranz 1e‑3 WU).

## Varkan-Effektbibliothek und Budgets

Budget = Summe der größten Bursts + für Dauer-Emitter `ceil(rate·lifetime.max)` (gleichzeitig lebende Partikel einer Instanz). Grenzen laut Test: acu_explosion (+ aftermath) ≤ 2.500, explosion_small ≤ 60, explosion_medium ≤ 150, explosion_large ≤ 400, Mündungsfeuer ≤ 30, Einschläge klein ≤ 30.

| Effekt | Layer | Layer (Priorität) | Burst | Dauer | Budget | continuous | boundsWu | Shake |
|---|---|---|---|---|---|---|---|---|
| `varkan:muzzle_small` | 3 | flash(P1), streaks(P2), puff(P2) | 7 | 0 | 7 | – | 2 | – |
| `varkan:muzzle_cannon` | 4 | flash(P1), tongue(P1), sparks(P2), smoke(P2) | 14 | 0 | 14 | – | 4 | – |
| `varkan:muzzle_artillery` | 4 | flash(P1), blast(P1), ring_smoke(P2), sparks(P2) | 21 | 0 | 21 | – | 6 | – |
| `varkan:muzzle_missile` | 3 | flash(P1), backblast(P2), crackle(P2) | 18 | 0 | 18 | – | 5 | – |
| `varkan:impact_ground_small` | 4 | flash(P1), dirt(P2), dust(P2), sparks(P2) | 16 | 0 | 16 | – | 4 | – |
| `varkan:impact_ground_large` | 6 | flash(P1), fire(P1), dirt(P2), column(P2), ground_ring(P2), sparks(P2) | 44 | 0 | 44 | – | 9 | – |
| `varkan:impact_metal` | 3 | flash(P1), sparks(P1), smoke(P2) | 18 | 0 | 18 | – | 3 | – |
| `varkan:impact_shield` | 3 | flash(P1), ring(P1), sparks(P2) | 12 | 0 | 12 | – | 4 | – |
| `varkan:impact_water` | 3 | crown(P2), column(P1), ring(P2) | 18 | 0 | 18 | – | 5 | – |
| `varkan:explosion_small` | 5 | flash(P1), fireball(P1), smoke(P2), sparks(P2), debris(P2) | 37 | 0 | 37 | – | 6 | – |
| `varkan:explosion_medium` | 7 | flash(P1), fireball(P1), secondary(P2), smoke(P2), sparks(P2), debris(P2), ground_ring(P2) | 76 | 0 | 76 | – | 10 | – |
| `varkan:explosion_large` | 8 | flash(P1), fireball(P1), secondary(P2), smoke(P2), sparks(P2), debris(P2), embers(P2), ground_ring(P2) | 175 | 0 | 175 | – | 18 | – |
| `varkan:acu_explosion` | 8 | flash(P0), fireball(P0), shockwave(P0), stem(P1), cap(P1), sparks(P2), debris(P2), embers(P2) | 942 | 0 | 942 | – | 70 | 2,4 WU / 2,4 s / r 160 |
| `varkan:acu_aftermath` | 3 | dust_ring(P1), ground_fire(P1), ground_smoke(P2) | 152 | 0 | 152 | – | 40 | – |
| `varkan:smoke_damage` | 2 | smoke(P2), embers(P2) | 0 | 27 | 27 | ja | 6 | – |
| `varkan:smoke_puff` | 1 | smoke(P2) | 9 | 0 | 9 | – | 6 | – |
| `varkan:sparks_burst` | 2 | sparks(P2), flash(P2) | 31 | 0 | 31 | – | 4 | – |
| `varkan:wreck_smolder` | 2 | smoke(P2), embers(P2) | 0 | 22 | 22 | ja | 6 | – |
| `varkan:missile_smoke_trail` | 2 | smoke(P2), crackle(P2) | 0 | 60 | 60 | ja | 3 | – |
| `varkan:build_stream` | 2 | pour(P1), droplets(P2) | 0 | 78 | 78 | ja | 12 | – |
| `varkan:reclaim_stream` | 2 | melt(P1), slag(P2) | 0 | 73 | 73 | ja | 12 | – |

Gesamt: 21 Effekte, 77 Layer (≤ 256), LUT 64 × 154, `lib.hash = 0xabd21ca6`.

Stil (faction.md §3.5/§4): Glutkern `#FFD9A0`, Falloff `#FF8A2A`, Weißglut `#FFE9C0`, HDR 4–7 für Blitze, 3–6 für Glut; Rauch aus dunklem Eisen/Ruß (`#3A342F`, `#1E1B19`), Erde `#3B3128`, Staub `#6B5E4E`. Kampf-Effekte glühen nur kurz (≤ 0,2 s Blitz, Funken ≤ 1 s) – dauerhaft leuchten nur `build_stream`/`reclaim_stream` (Glutkern-Monopol der Ökonomie). Der Kommandanten-Tod (`Lotbruch`) ist auf zwei Effekte verteilt, weil ein Effekt höchstens 8 Layer hat: `acu_explosion` (Weißblitz, Feuerball, Boden-Schockwellenring `orient 'ground'`, Pilz-Stamm und -Kappe mit Auftrieb, Trümmerfunken, Trümmer, Nachglut; Shake) und `acu_aftermath` (radialer Staubring über `spreadInner`, brennender Boden, bodennaher Rauch). `VARKAN_EVENT_FX.death.acu` enthält beide.

### VARKAN_EVENT_FX

- `weapon`: direct_small/aa → muzzle_small, cannon → muzzle_cannon, artillery → muzzle_artillery, missile → muzzle_missile
- `impact`: ground → impact_ground_small, ground_large → impact_ground_large, unit → impact_metal, shield → impact_shield, water → impact_water; `groundImpactForWeapon` (artillery/missile → ground_large, sonst ground)
- `death`: small → explosion_small, medium → explosion_medium, large → explosion_large, structure → explosion_large + smoke_puff, acu → acu_explosion + acu_aftermath
- `build` → build_stream, `reclaim` → reclaim_stream, `damaged` → smoke_damage, `wreck` → wreck_smolder, `missileTrail` → missile_smoke_trail

### Glut-Tint (faction.md §4.3)

`glowTintForArmyColor(rgb)` → `{ whiteHot, core, falloff, tint }`. Weißglut, wenn der Farbton der Teamfarbe < 25° von 27° entfernt ist (Sättigung ≥ 0,25). In der Standardpalette trifft das genau Rot und Orange (Test). `tint` ist ein 0xRRGGBB-Multiplikator für Layer mit `tint: 'spawn'` (0xFFFFFF = Bernstein; Weißglut = normiertes Verhältnis Weißglut/Kern ≈ 0xD4E4FF, also weniger gesättigt). Da der Ring-Tint nur rgba8 speichert, kann der Tint nicht aufhellen, nur entsättigen – bewusst so gewählt.

## CameraShake

`add(pos, amplitudeWu, durationS, radiusWu, frequencyHz, tS)`, `addFromEffect(effect, pos, tS, scale?)` (nimmt `EffectDef` oder `EffectDefCompiled`), `sample(tS, camTargetWu)` → wiederverwendetes `{ dx, dy, dz, rollRad, active }`, `activeCount`, `clear()`.
Stärke = `amplitude·(1 − age/duration)²·max(0, 1 − dist/radius)²`, Rauschen = Value-Noise auf fxHash-Gitter (`shakeNoise(seed + Kanal, age·freq)`, Roll mit halber Frequenz, 0,012 rad/WU, max. 0,06 rad). Bei 16 aktiven Quellen ersetzt eine neue die schwächste (nur wenn sie stärker ist). `sample()` ist allokationsfrei: das Rauschen ist inline gerechnet, weil V8 zurückgegebene Doubles aus nicht-inlinten Aufrufen boxt. Messung: 500.000 Aufrufe → 8 KB Heap-Zuwachs in reinem Node (lokal gemessen, Apple M5 Pro). Der Test läuft in einem Kind-Prozess (`test/effects/support/shake-alloc.ts`), weil der Vitest-Harness in heißen Schleifen selbst allokiert.

## Scorch-/Krater-Decals

### Pool

`new ScorchDecals({ cap, mapSizeWu })` (cap 1..4096, mapSizeWu Vielfaches von 32), `SCORCH_CAPS = { low: 128, medium: 256, high: 512, ultra: 1024 }`.
`add({ xWu, zWu, radiusWu ≤ 40, kind: 'scorch'|'crater'|'scar', rotation?, seed, tS, lifetimeS?, emberS?, strength? })` → Handle (`remove(handle)` ignoriert veraltete Handles). Standardwerte: scorch 120 s/Glut 2,5 s, crater 240 s/5 s, scar 90 s/1,5 s; `lifetimeS: 0` = dauerhaft (bis zur Verdrängung). Bei vollem Pool wird der älteste Decal ersetzt (`stats.replaced`).
`update(tS)`: entfernt Abgelaufene (`stats.expired`), setzt abgelaufene Glut auf 0 (damit die FX-Zeit nach 4.096 s die Glut nicht wieder zündet) und setzt dann `dirty`. Das Ausblenden (letzte 40 % der Lebensdauer) rechnet der Shader.
`pack()`: schreibt `data`/`cells` neu und löscht `dirty`. `writeBlock(tS, emberIntensity = 4, strength = 1)` liefert den 32-Byte-UBO-Inhalt. `shadeAt(xWu, zWu, tS)` ist der CPU-Spiegel des ganzen Felds (liest die gepackten Arrays).

### GPU-Layout

- Datentextur `dataTexture = { width: 128, height: ceil(cap/64), format: 'rgba32i' }`, 2 Texel je Decal: `(xRaw, zRaw, radiusRaw, rot12 | kind<<12 | seed17<<14)` und `(tBornMs mod 4.096.000, lifetimeMs, emberMs, strength·1000)`. Das gepackte Wort ist immer ≥ 0, weil der Seed nur 17 Bit hat; damit spielt die int→uint-Konvertierung im Shader keine Rolle.
- Zellen-Textur `cellsTexture = { width: 1024, height: …, format: 'r32ui' }`: Einträge [0, chunks²) = Chunk-Index `(listStart << 6) | count` (32 × 32-WU-Chunks, count ≤ 32, listStart absolut), danach die Listen (Kapazität `min(cap·16, chunks²·32)`). Index und Liste teilen sich **eine** Textur, also sind nur die Units 13/14 belegt und es gibt keine dritte Unit. Überzählige (Decal, Chunk)-Paare zählt `stats.chunkOverflow`.
- `SCORCH_SAMPLERS = [{ name: 'u_fxScorchData', unit: 13 }, { name: 'u_fxScorchCells', unit: 14 }]`, `SCORCH_UNIFORM_BLOCKS = [{ name: 'FxScorch', slot: 8 }]`, `SCORCH_LAYOUT` (size 32; `grid` ivec4 @0: chunks, Zellenbreite, Decal-Anzahl, Decals je Zeile; `time` vec4 @16: FX-Zeit mod 4096, Glut-HDR, globale Stärke).

### GLSL-Einbindung (fx-lab-Boden rfx-p5, später render-Terrain-FS)

```glsl
#version 300 es
precision highp float; precision highp int;
${FRAME_BLOCK_GLSL}        // aus @faf/render (u_camPosInt, u_camFrac) – VOR dem Snippet
${SCORCH_GLSL}             // enthält SCORCH_BLOCK_GLSL + Sampler
...
vec3 relPos = v_rel;       // kamera-relativ in WU: vec3(ivec3(posRaw) - u_camPosInt.xyz)/4096.0 - u_camFrac.xyz
vec4 sc = fxScorch(relPos);
vec3 albedo = baseAlbedo * sc.rgb;          // Ruß dunkel, Kraterrand ≈ 1,15, Kraterboden ≈ 0,3
vec3 color = lit(albedo) + fxScorchGlow(sc.a); // HDR-Glut (Falloff → Kern), Bloom macht sie sichtbar
```

Ablauf pro Frame: `scorch.update(t)`; wenn `scorch.dirty` → `pack()` und `dev.writeTexture(dataTex, {x:0,y:0,width,height}, scorch.data)` bzw. `cells` (beide Texturen mit `restore`-Callback, der dieselben Arrays hochlädt); dann jeden Frame `dev.writeBuffer(ubo, 0, new Uint8Array(scorch.writeBlock(t, hdr ? 4 : 1)))`. Samplers/Blocks über `SCORCH_SAMPLERS`/`SCORCH_UNIFORM_BLOCKS` in die Pipeline eintragen. Nearest-Filterung, keine Mipmaps. Für render's Terrain (Integration): Chunk-Größe 32 WU entspricht `TERRAIN_PATCH_WU`. Zusammenlegen mit render's `DecalBinner` (G19, MS3) ist Integrationsaufgabe. Die Formen unterscheiden sich (SDF-Ringe vs. prozeduraler Ruß), die Binning-Logik ist dieselbe.

`VARKAN_SCORCH` liefert Vorgaben je Ereignis: impact_large scorch 1,6 WU, small scorch 1,8, medium scorch 2,8, large crater 4,5, structure crater 6,5, acu crater 22 (dauerhaft, Glut 10 s).

## Tests (`packages/render-fx/test/effects`, `test/decals`) – 82 Tests grün

- random: Hash-Determinismus/Formel/u32-Wrap/Verteilung, FxRng-Replay, Mittelwert, Isotropie, Kegelgrenzen, ONB-Orthonormalität
- curves: Sampling/Clamping, LUT-Stützstellen exakt (Key auf t = 21/63), Interpolation = `sampleBaked`, Hex-Parsing, Validierungsfehler
- define-compile: 22 Validierungsfälle (Lifetime, Priorität, Kurvenordnung, Farbe > 16, Count, Spread/SpreadInner, Rate ohne continuous, Shake …), Budgets, Tabellenfelder/Stride/LUT-Zeilen/Index/`indexOf` wirft, Hash stabil/inhaltssensitiv, > 256 Layer wirft
- reference: `particleRandoms` gegen Formel; `evalParticle` k = 0 und k > 0 gegen RK4-Integration (je 50 Zufallsfälle, 1e‑5), Delay/Lebensende, LUT/Jitter/Scale, Stream erreicht das Ziel bei a → 1, Spawn-Tint, Stream-Geschwindigkeit = finite Differenz, spreadInner-Ring
- shake: Abklingen, Distanz-Falloff/außerhalb 0, Determinismus, Formelgleichheit mit `shakeNoise`, Cap 16/Ersetzen, Objekt-Wiederverwendung + Allokationsmessung (Kind-Prozess, < 200 KB für 500k Aufrufe)
- varkan: ≥ 18 Effekte, IDs eindeutig, ≤ 256 Layer, Budgets, ACU-Anforderungen (Shake-Radius ≥ 120, P0-Kern, Boden-Ring, Pilz, Nachglut), Stream-Dichte, alle Layer endlich, jede `VARKAN_EVENT_FX`-ID existiert, Weißglut-Regel (Palette → genau Rot/Orange)
- decals: Texturgrößen, Cap ersetzt ältesten, Ablauf/Glut-Löschung/Zeitumlauf, Eingabevalidierung, Packing-Roundtrip (130 Decals, alle Felder), Chunk-Binning == Brute-Force für 1.000 Zufallsdecals inkl. Überlaufzähler, `shadeAt` == `scorchShadeReference` durch Packing/Binning, Krater (Boden/Rand/außerhalb), Scorch (Mitte/Rand/Fade/permanent/Stärke), Scar-Elongation, Block/Layout/Sampler-Vertrag

Befehle: `pnpm exec vitest run packages/render-fx/test/effects packages/render-fx/test/decals`, `pnpm exec tsc -p packages/render-fx --noEmit` (grün), eslint auf die eigenen Pfade (grün).

## Zusätzliche Verifikation (lokal gemessen, Apple M5 Pro)

- **GPU-Parität SCORCH_GLSL:** Mit einem Wegwerf-Skript (Scratchpad, kein Repo-Code) wurden 90 Zufallsdecals (alle Arten, Rotation, Glut, Fade, permanent) in ein RGBA32F-Target gerendert und pixelweise (192² Pixel) mit `ScorchDecals.shadeAt` verglichen. Chromium, Firefox und WebKit (headless): kompiliert ohne Fehler, glError 0, max. Δmult 5,8e‑5, max. Δember 2,7e‑4, kein Pixel über 0,01.
- Sichtprüfung einer Scorch-Vorschau: Ruß dunkel mit unregelmäßigem Rand, heller Kraterrand, Glut bei frischen Decals, nach Glutende nur Ruß/Krater.
- CPU-Seitenansicht der Hauptexplosionen/Ströme über `evalParticle`: Feuerball → Rauch → Pilz beim ACU, Funken und Trümmer ballistisch, Ströme folgen dem Pfad. Daraufhin wurde der ACU-Feuerball vergrößert (Speed 6–16, Größe bis 11 WU).

## Abweichungen

- `acu_explosion` hat 8 Layer (Maximum). Staubring, brennender Boden und bodennaher Rauch stehen im zusätzlichen Effekt `acu_aftermath`, der über `VARKAN_EVENT_FX.death.acu` gemeinsam ausgelöst wird. Beide zusammen haben ein Budget von 1.094 (≤ 2.500).
- Zusätzlicher Effekt `impact_water` (Ereignis `water?` aus der Aufgabe) → 21 Effekte.
- `blend` als Kurve, `spreadInner`, `streamWave(s)` sind additive Erweiterungen des Datenmodells (siehe oben).
- `SCORCH_LAYOUT` ist ein eigenes, strukturgleiches Objekt zu render's `Std140Layout` (`size`, `fields`, `offsetOf`), weil `src/decals` außer `core/slots.ts` nichts importieren sollte.

## Bekannte Grenzen / Hinweise für Folgepakete

- Effektdaten sind nur per CPU-Referenz/Seitenansicht geprüft. Das echte Aussehen (Feuerball-Shader, Rauchrauschen, Streaks) zeigt sich erst mit rfx-p3. Tuning macht rfx-p6 in `varkan.ts` (Streaks der Ströme hängen von der `stretch`-Umsetzung in rfx-p3 ab, siehe Dichte-Test).
- Scorch-Formen sind prozedural mit 3 Sinus-Harmonischen am Rand. Bei sehr großen Kratern (ACU 22 WU) sieht man leichte Ecken; mehr Detail wäre ein Rauschterm im Inneren (Tuning).
- Die ACU-Glut (`VARKAN_SCORCH.acu`, Glut 10 s) ist in HDR sehr hell. Bei Bedarf in rfx-p6 über `strength` oder die `emberIntensity` von `writeBlock` dämpfen.
- `ScorchDecals.add` sucht bei vollem Pool den ältesten Decal linear (≤ 1.024 Slots), `pack()` baut alles neu – für Decal-Raten im Gefecht (einige pro Sekunde) unkritisch.
