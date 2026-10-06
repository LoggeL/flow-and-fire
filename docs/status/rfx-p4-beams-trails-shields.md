# rfx-p4-beams-trails-shields – Beams, Projektil-Trails, Schild-Kugeln

Track TRACK-RENDERFX, Welle 1 (parallel zu rfx-p3 Partikel und rfx-p5 fx-lab-Shell). Drei eigenständige
FX-Passes nach der gemeinsamen Pass-Konvention (`encode(enc) → Draws`, `destroy()`, `readonly stats`),
jeweils **genau 1 Draw** pro Frame, Instanzdaten über `DynamicInstanceBuffer` (Positionen i32 raw Q20.12,
Farben/Größen f16), Frame-Block an `SLOT_FRAME` + `FxView` an `SLOT_FX_VIEW` aus `FxBindings`.
Kein `Math.random`, keine Allokationen pro Frame in `add`/`set`/`hit`/`update`/`encode`.

## Umgesetzt

| Datei | Inhalt |
|---|---|
| `src/trails/beams.ts` | `class BeamPass`, `BeamStyle`, Record-Layout `BEAM_*`, JS-Spiegel `beamProfile`, `timedBeamFade` |
| `src/trails/trails.ts` | `class TrailPass`, `TrailStyle`, Record-Layout `TRAIL_*`, JS-Spiegel der VS-Formel `trailEndpointsWu` |
| `src/trails/glsl.ts` | `FX_HALF_GLSL` (f16-Entpacken), `FX_NOISE_GLSL` (Integer-Hash, periodisches 1D-Value-Noise), `FX_RIBBON_GLSL` (Achsen-Billboard mit weichen Endkappen und Sub-Pixel-Verbreiterung bei konstanter Energie), `glslFloat` |
| `src/trails/pack.ts` | `packHalf` (schnelles f16 über float32-Bits, = `toHalf(Math.fround(v))`), `writeHalf4`, `clamp01`, `rawAt` |
| `src/trails/presets.ts` | `VARKAN_BEAM_STYLES` (buildStream, reclaimStream, laser, lightning, shieldArc), `VARKAN_TRAIL_STYLES` (tracer, cannon, artillery, missile, aa) – aus `VARKAN_GLOW` (faction.md §3.5/§4) |
| `src/shields/icosphere.ts` | `createIcosphere(n)` (10·4ⁿ+2 Vertices, 20·4ⁿ CCW-Dreiecke, u16), `ICOSPHERE_MAX_SUBDIVISIONS = 6` |
| `src/shields/shields.ts` | `class ShieldPass`, `ShieldState`, Record-Layout `SHIELD_*`, Ripple-Konstanten, `shieldRippleEnergy`, `shieldRadiusScale` |
| `test/trails/*.test.ts`, `test/shields/*.test.ts` | 23 Tests (FakeCanvas) |
| `test/trails/cpu-bench.ts` | CPU-Mikrobench (nicht Teil der Suite): `node --import tsx packages/render-fx/test/trails/cpu-bench.ts` |
| `smoke/cases/trails.ts`, `smoke/cases/shields.ts` | Browser-Smoke mit Pixelprüfungen und GPU-Timer-Segmenten |

Barrels `src/trails/index.ts` und `src/shields/index.ts` (von `src/index.ts` re-exportiert).

## Öffentliche API

### BeamPass (Laser, Blitze, Gießstrom-/Reclaim-Kern)

```ts
const beams = new BeamPass(dev, bindings, { capacity: 4096, timedCapacity: 1024 });
// pro Frame:
beams.update(nowS);                          // altert den Timed-Pool (Fade, Ablauf)
beams.begin();                               // Immediate-Mode: vergisst alle add()-Beams des Vorframes
beams.add(fromRaw, toRaw, style);            // false + stats.dropped++ bei voller Kapazität
beams.addTimed(fromRaw, toRaw, style, t0S, lifeS); // kurzer Schuss, blendet selbst aus (Flash-in 8 %, quadratischer Fade)
beams.encode(enc);                           // 1 instanzierter Draw (Triangle-Strip, 4 Vertices je Beam)
```

`BeamStyle = { widthWu, core: [r,g,b] HDR, glow: [r,g,b], alpha, scrollSpeed?, noise?: 0..1, taper?: [start, end] }`.
Geometrie: Achsen-Billboard (Breite ⟂ Achse und Sichtstrahl), um die halbe Breite über die Enden hinaus
verlängert → runde weiche Endkappen; Profil = schmaler Gauß-Kern (`BEAM_CORE_WIDTH`) + breiter Glow,
Rand exakt 0; `noise` = scrollendes 3-Oktaven-Rauschen (Helligkeitspulse) + seitliches Kern-Wabern,
Phase je Beam aus einer Goldener-Schnitt-Folge (deterministisch). Unter 0,8 px Halbbreite wird das Band
verbreitert und die Intensität im selben Verhältnis gesenkt (kein Flimmern ferner Beams). Additiv
(premultiplied, α = 0), depthTest an, depthWrite aus. Record 52 B.
Stats: `beams, timed, dropped (seit begin), droppedTotal, draws, uploadBytes`; `clearTimed()`.

### TrailPass (Tracer, Granaten, Artillerie, Raketen-Glühschweif)

```ts
const trails = new TrailPass(dev, bindings, { capacity: 8192 });
trails.begin();
trails.add(prevRaw, curRaw, style, lengthScale?);  // prev/cur = Sim-Positionen Vor-/aktueller Tick
trails.encode(enc);                                 // 1 Draw
```

`TrailStyle = { lengthWu, widthWu, head: [r,g,b,a] HDR, tail: [r,g,b,a], blend?: 0 additiv | 1 alpha }`.
VS: Kopf = `mix(prev, cur, u_camFrac.w)` (GPU-Interpolation mit dem Frame-α wie bei Units),
Schweif entlang `−normalize(cur − prev)` mit Verjüngung auf `TRAIL_TAIL_TAPER = 0.3`, heller Hot-Spot am
Kopf. Stehender Kopf (`|cur − prev|² ≤ TRAIL_MIN_DIR_SQ`) → Länge 0, Achse = Kamera-Rechts → runder
Punkt, **kein NaN** (JS-Spiegel `trailEndpointsWu` im Test). `lengthScale` kürzt den Schweif frischer
Projektile (z. B. geflogene Strecke / lengthWu). Record 48 B.

### ShieldPass (Schild-Kugeln)

```ts
const shields = new ShieldPass(dev, bindings, { capacity: 128, subdivisions: 3 }); // 642 V / 1 280 Dreiecke
shields.set(id, { centerRaw, radiusWu, color: [r,g,b], hpFrac, upFrac }); // anlegen/aktualisieren
shields.hit(id, pointRaw, nowS, strength = 1);   // → Ripple-Slot 0..3 (−1 bei unbekannter id)
shields.remove(id);                               // relative Reihenfolge der übrigen bleibt stabil
shields.update(nowS);                             // lässt abgelaufene Ripples verfallen, zählt aktive
shields.encode(enc);                              // 1 indizierter Instanz-Draw (u16), lädt nur bei Änderung hoch
```

Record 88 B: Zentrum i32×3, Radius f32, Farbe+hp f16×4, upFrac/Phase f16, 4 Ripple-Startzeiten f32
(gewrappte FX-Zeit), 4 Stärken f16, 4 Richtungen snorm16×4. **Ripple-Slots:** freie Slots zuerst, sonst
wird der am weitesten abgeklungene Ripple ersetzt (Energie `str·(1 − age/1,2 s)²`, bei Gleichstand der
älteste Treffer nach Sequenznummer) → 5. Treffer im selben Frame ersetzt den ersten, ein starker alter
Treffer kann einen schwachen neuen überleben. Stats: `shields, ripplesActive, draws, uploadBytes,
rejected, hits, hitsIgnored`; außerdem `count`, `has(id)`, `indexOf(id)`, `clear()`.

Shader: Fresnel `(1 − |N·V|)³`, prozedurale triplanare Waben (AA über `fwidth`), Ripple = Gauß-Ring bei
Winkelabstand θ(t) = 2,4 rad/s·(t − t0), Breite 0,16 rad + 0,14 rad/s, Abklingen 1,2 s, Treffer-Blitz am
Einschlagpunkt (exp(−7·age)), Ring hebt die Waben hervor und beult die Kugel leicht (±2 %) aus;
hpFrac < 0,5 → Richtung Rot, < 0,3 → Flackern (Hash je Schild und 1/22 s); upFrac → Radius
(35 % → 100 %, kubisch) und Deckkraft, beim Hochfahren leuchten die Waben auf. Vorder- und Rückseite in
**einem** Draw (cullMode none, `gl_FrontFacing`: Rückseite 40 %, nur Vorderseite mit etwas Deckung),
premultiplied, depthWrite aus. Mesh- und Indexpuffer haben `restore`-Callbacks, die Instanzdaten stellt
`DynamicInstanceBuffer` wieder her.

## Tests (23, alle grün)

- **Beams (8):** Record-Packing (Offsets, Stride 52, i32-Positionen, f16-Stil, Taper/Noise-Defaults), genau 1 Draw + 1 Upload, Immediate-Mode-Reset per `begin()` / leerer Frame = 0 Draws, Überlauf → `dropped` statt Exception, `addTimed`-Ablauf (Fade, Ablauf, Pool-voll), `timedBeamFade`, `beamProfile` (Maximum auf der Achse, monoton, 0 am Rand), Restore nach Context-Loss.
- **Trails (6):** Packing prev/cur/f16, 1 Draw/Reset/Überlauf, Restore, JS-Spiegel Kopf/Schweif, stehender Kopf ohne NaN, `packHalf` = `toHalf(Math.fround(v))` (Randfälle + deterministischer Sweep).
- **Shields (9):** Ikosphäre (Vertex-/Dreieckszahl für n = 0…4, Einheitslänge, CCW nach außen, alle Indizes genutzt, u16-Grenze: n = 6 passt, n = 7 wirft), `set`-Packing + 1 Draw, 20 Schilde → 1 Draw mit 20 Instanzen, Kapazität → `rejected`, stabile Reihenfolge bei set/remove (inkl. Ripple-Daten), `hit` (snorm-Richtung, gewrapptes t0 bei t > 4096 s, Stärke, 4 gleichzeitige Treffer → 4 Slots, Treffer im Zentrum → +y), Ripple-Ersetzung (5./6. Treffer im selben Frame, gestaffelt, Energie-Kriterium, abgelaufener Slot), Ablauf in `update` inkl. Re-Upload, Helper, Restore von Mesh/Indizes/Instanzen.

## Smoke (Chromium, Firefox, WebKit – alle grün, inkl. Context-Loss → Restore)

- `trails`: Boden, Messbeam quer zur Bildmitte, Gießstrom/Reclaim/Schild-Arc, getimte Laser/Blitze, 200 Trails (195 fliegend in 5 Stilen, 5 stehend). Prüft: Beam-Kernpixel am projizierten Ort (±2 px), FWHM ≈ `widthWu · Pixel/WU / Tiefe` über den JS-Profilspiegel, stehende Köpfe sichtbar, ≥ 80 % der Köpfe im Bild hell, je Pass genau 1 Draw.
- `shields`: 20 Schilde (r 6–14 WU) schräg von oben, Schild 7 mit 4 gleichzeitigen Treffern + 5. Treffer, periodische Treffer, ein Schild mit niedrigen HP, einer mit pulsierendem upFrac. Prüft: 1 Draw, 20 Schilde, aktive Ripples, Fresnel (Rand heller als Inneres an 3 unbeschossenen Schilden), Ripple verändert ≥ 3 % der Pixel gegenüber einem Snapshot vor dem Treffer, Offscreen-Füll-Szene zu ≥ 90 % bedeckt.
- Screenshots `test-results/render-fx-smoke/{trails,shields}-{chromium,firefox,webkit}.png` angesehen: alle drei Browser praktisch identisch; Waben, Fresnel-Rand, Ripple-Ringe mit Blitz, roter Low-HP-Schild, Endkappen, verjüngte Schweife mit Kopf-Hotspot sehen wie gewünscht aus (LDR ohne Tonemapping – HDR-Kerne clippen dort weiß, mit der Post-Kette von rfx-p2 entsteht Bloom).

## Messwerte (lokal gemessen, Apple M5 Pro, Chromium 153 / ANGLE Metal, 960×540, GpuSpanTimer, Median über 30 Frames je Segment)

| Szenario | GPU ms |
|---|---|
| 20 Schilde schräg, ca. 60 % des Bilds (Szene − Boden) | ≈ 0,19 |
| 20 große, überlappende Schilde, gesamtes Bild bedeckt (≈ 10 Schichten Overdraw), alle 80 Ripple-Slots aktiv (fill − fillBase) | ≈ 0,55–0,62 (vorher 1,92, s. u.) |
| 4 096 Beams (6–30 WU, Mischung aller Stile) offscreen | ≈ 0,44–0,57 |
| 8 192 Trails offscreen | ≈ 0,39–0,54 |
| Trail-Szene (Boden + 200 Trails + 8 Beams) | ≈ 0,17–0,25 |

CPU (Node, Fake-GL, nur JS-Packing inkl. `encode`): 4 096 Beams 0,22 ms, 8 192 Trails 0,32 ms,
20 Schilde (set + hit + update + encode) 0,004 ms. Firefox/WebKit ohne Timer-Query → keine GPU-Werte.

**Optimierung Schild-Fragment:** Die Ripple-Konstanten (Ringradius, 1/Breite, Amplituden für Ring und
Blitz, Richtungen als `flat mat4`) rechnet jetzt der Vertex-Shader; der Fragment-Shader wertet alle 4
Ripples vektorisiert aus (`fastAcos4`, ein `dot` je Term) und überspringt die Ripple-Mathematik für
Schilde ohne lebenden Ripple komplett (flat → kohärente Verzweigung); ein `fwidth` statt drei für die
Waben; das Flackern wird je Vertex berechnet. Ergebnis im Worst Case 1,92 → ≈ 0,6 ms bei identischer Optik.
Ziel MS13 „20 Schilde ≤ 1 ms“: bei 960×540 auch im Overdraw-Worst-Case erfüllt; bei 1080p skaliert der
Worst Case auf ≈ 2,3 ms, die realistische Szene auf ≈ 0,75 ms (Hochrechnung, nicht gemessen).

## Integrationsanleitung

**Pass-Reihenfolge (PLAN §3.7):** … Units → `ShieldPass.encode` → Partikel (rfx-p3) → `TrailPass.encode`
→ `BeamPass.encode` → Post. Alle im HDR-Szenen-Pass (RGBA16F von rfx-p2) mit dem Tiefenpuffer der
Opaken. `FxBindings` aus `FxFrameUniforms` (in render mit `{ frameUbo: renderer-Frame-UBO }`).

**MS5/MS7 – Projektile:** Pro Frame `trails.begin()`, dann für jeden `ProjectileRecord` des Frame-Streams
`trails.add(prevPos, curPos, styleFor(visual, army))` – `prevPos`/`curPos` direkt als i32×3 aus dem
Record (z. B. `Int32Array`-Sicht auf den Frame, keine Kopie nötig, `add` liest per Index). Die
Interpolation macht der VS mit `u_camFrac.w` (derselbe α wie für Units). `ProjectileFlags`/Lebensalter
können `lengthScale` steuern (frisch abgefeuert → kurzer Schweif). Raketenrauch als rfx-p3-Emitter am
interpolierten Kopf (`trailEndpointsWu` liefert dieselbe Position auf der CPU). Beams aus
`BeamRecord` (src/dst-Handle → Mündungs-/Zielposition über die interpolierten Unit-Transformationen)
mit `beams.add` jeden Frame; einmalige Schüsse (Laser, Blitz) aus Events mit `addTimed(…, t0 = Eventzeit
= tick·dt + subTick, life)`. Build/Reclaim-Kern: `VARKAN_BEAM_STYLES.buildStream`/`reclaimStream`,
Partikel (rfx-p3) laufen darauf.

**MS13 – Schilde:** Schildzustand aus den Frame-Records der Generator-Einheit (`UnitFlags.ShieldUp`,
Position, Radius/HP aus Blueprint bzw. künftigem Schild-Feld): je Frame `shields.set(handle, state)` für
sichtbare Schilde, `remove(handle)` wenn die Einheit verschwindet; `upFrac` clientseitig zwischen 0/1
animieren (Hochfahren ≈ 0,6 s, Kollaps ≈ 0,3 s). `ShieldHit`-Events (EventRecord: `pos` = Trefferpunkt,
`handle` = Schildträger, `aux` = Schaden) → `shields.hit(handle, pos, eventTimeS, strength)` mit
`strength ≈ clamp(Schaden / Referenzschaden, 0.3, 2)`. `update(nowS)` einmal pro Frame vor `encode`.
Die Uhr (`nowS`) muss dieselbe sein, die `FxFrameUniforms.update({ timeS })` bekommt.

**MS14 – Presets:** Stile sind reine Daten (`BeamStyle`/`TrailStyle`), pro Waffen-`visual` eine Tabelle;
Armeefarben über `glowTintForArmyColor` (rfx-p1) auf `core`/`glow` bzw. `head`/`tail` anwenden und das
Ergebnis einmal beim Laden cachen (keine Objekte pro Frame erzeugen).

## Abweichungen / Entscheidungen

- `BeamPass`: zusätzlich `timedCapacity` (Standard min(capacity, 1024)) und `clearTimed()`; Timed-Beams teilen sich die Draw-Kapazität mit den Immediate-Beams (Überlauf → `dropped`).
- `TrailPass.add` hat den optionalen 4. Parameter `lengthScale`, `TrailStyle.blend` (0 additiv, 1 alpha) erlaubt dunkle Rauchstreifen ohne zweiten Pass.
- `ShieldPass.set`/`hit` geben `boolean` bzw. den Ripple-Slot zurück (statt `void`), damit Überlauf/unbekannte ids sichtbar sind.
- Shared-Helfer (`FX_NOISE_GLSL`, `packHalf`, …) liegen in `src/trails/` (eigene owns) und werden von shields mitbenutzt.
- Smoke-Fälle laufen 150 Frames (statt 40), damit die GPU-Mediane stabil sind; die Schildtreffer liegen deshalb bei t = 2,1/2,2 s.

## Bekannte Grenzen

- GPU-Zeiten nur in Chromium messbar (Firefox/WebKit ohne `EXT_disjoint_timer_query_webgl2`).
- Schild-Overdraw ist inhärent (Vorder- + Rückseite, überlappende Kugeln); bei 4K und vielen großen überlappenden Schilden wäre ein Pfad ohne Rückseiten-Waben oder mit halber Auflösung die nächste Stufe.
- Blitz-Optik ist ein weich wabernder Strahl (1D-Noise), kein verzweigter Zickzack-Blitz; Verzweigungen wären mehrere kurze `addTimed`-Segmente.
- Beams/Trails sind nicht nach Tiefe sortiert (additiv → reihenfolgeunabhängig; nur `blend = 1`-Trails könnten sich minimal falsch überlagern).
