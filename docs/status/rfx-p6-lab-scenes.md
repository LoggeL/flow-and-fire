# rfx-p6-lab-scenes – fx-lab-Szenen, LabFx-Verdrahtung, Effekt-Tuning (TRACK-RENDERFX, Welle 2)

Stand: 2026-09-30. Gearbeitet wurde im Worktree `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-renderfx`
(Branch `track-renderfx`). Der in der Aufgabe genannte Pfad `/Users/logge/Documents/Projects/faf-renderfx` existiert
nicht (wie bei rfx-p5). `packages/render` und `tools/render-bench` sind unverändert (`git diff` leer).

## Umgesetzt

| Datei | Inhalt |
|---|---|
| `apps/fx-lab/src/scenes/fx.ts` | `LabFxKit` (echte `LabFx`) mit Lab-Helfern, `createGpuFxParts`, `labShakeHook`, `labFxKit(ctx)`, `labEffectLibrary()` |
| `apps/fx-lab/src/scenes/fx-record.ts` | Aufzeichnende FX-Teile ohne GPU (`createRecordingFxParts`, `FxCallLog`, `OP`) für Tests und `createLabFx` ohne Device |
| `apps/fx-lab/src/scenes/index.ts` | `LAB_SCENES` (alle 5 Szenen registriert), `createLabFx(ctx)` |
| `apps/fx-lab/src/scenes/battle.ts` | Szene `battle` (2 × 200) |
| `apps/fx-lab/src/scenes/shields.ts` | Szene `shields` (20 Schilde) |
| `apps/fx-lab/src/scenes/big.ts` | Szene `big` (ACU-Explosion, `trigger()`) |
| `apps/fx-lab/src/scenes/gallery.ts` | Szene `gallery` (alle `VARKAN_EFFECTS`) |
| `apps/fx-lab/src/scenes/common.ts` | `CENTER`, `turnToward`, `RateMeter`, `LabLabel` |
| `apps/fx-lab/src/app/context.ts`, `params.ts`, `app.ts` | additiv: URL-Parameter `cam` (Kamera-Override), `applyCameraOverride` |
| `apps/fx-lab/src/app/unit-types.ts` | `LabUnitKind`/`LabUnitInit` (von `context.ts` re-exportiert; beseitigt den Import-Zyklus context ↔ units, den dependency-cruiser meldete) |
| `packages/render-fx/src/effects/varkan.ts`, `src/trails/presets.ts` | Effekt-Tuning nach Sichtprüfung (siehe unten) |
| `apps/fx-lab/test/scenes/*.test.ts` | 29 Tests (siehe unten), `support/harness.ts`, `support/fake-gl.ts` (Kopie aus render-fx) |
| `apps/fx-lab/test/app/params.test.ts` | Test für `cam` ergänzt |

## LabFx-Verdrahtung (`createLabFx`, `LabFxKit`)

- `createLabFx(ctx)` baut je Szenenkontext:
  - `ParticleSystem` (Ring 65.536, Cap `particleCapForPreset(ctx.preset)`, `onShake` → `ctx.shake.addFromEffect`)
  - `ShieldPass` (Kapazität 64, Unterteilung 3)
  - `TrailPass` (2.048) und `BeamPass` (1.024, davon 256 Timed)
  - Ohne GPU-Device (`ctx.dev === null`, Headless-Tests) nimmt es die aufzeichnenden Teile: 0 Draws, Stats gefüllt.
- `encodeShields` → ShieldPass, `encodeParticles` → ParticleSystem, `encodeBeams` → TrailPass + BeamPass (Reihenfolge
  PLAN §3.7). Bei `fx=0` überspringt die Shell die Encodes, zusätzlich geben die Kit-Encodes dann 0 zurück.
- `stats()` liefert immer dasselbe Objekt (in place aktualisiert): `particles` (alive, cap, capacity, spawnedFrame,
  dropped[3], culled, uploadBytes), `shields` (count, ripplesActive), `beams` (gezeichnete Beams), `trails`.
- Zeitmodell: Jeder Helfer bekommt die Szenenzeit `t` des laufenden Fixed-Steps. Der erste Aufruf pro Schritt führt
  `ParticleSystem.update(t)`, `BeamPass.update(t)` und `ShieldPass.update(t)` aus (`kit.step(t)`, idempotent). Bursts
  bekommen so immer t0 = t, unabhängig davon, wie viele Schritte ein Frame rechnet (`freeze` → reproduzierbar).
  `LabFx.update` (nach `scene.update`) bewegt Projektile, verschiebt angehängte Emitter und baut Beams/Trails
  des Schritts neu auf (Immediate-Mode).

### Lab-Helfer (Effektwahl immer über `VARKAN_EVENT_FX`)

| Helfer | Wirkung |
|---|---|
| `fireWeapon(t, unit, weapon, x, y, z, targetKind?, targetId?, damage?)` | Mündungsfeuer (`weapon.*`) an der Rohrspitze (`muzzleOf`, aus `LAB_UNIT_SHAPES`), dann `spawnProjectile` |
| `spawnProjectile(t, weapon, army, from…, to…, targetKind, targetId, damage)` | Projektil mit prev/cur je Fixed-Step, geschlossene Bahnen: Tracer/Kanone gerade (leichter Abfall), Artillerie-Parabel (Scheitel 0,32·d + 5), Rakete mit Bogen, Seitenschwenk und `missile_smoke_trail`-Emitter. Einheitenziele werden verfolgt. Trail je Schritt mit `lengthScale` = geflogene Strecke / Trail-Länge |
| `impact(t, kind, x, y, z, n…)` | Einschlag (`impact.*`), `ground_large` mit Scorch (`VARKAN_SCORCH.impact_large`) |
| Landung | Einheit lebt → `impact_metal` (Normale = Gegenrichtung); Schild oben → `ShieldPass.hit` + `impact_shield`; sonst Boden (`groundImpactForWeapon`). Danach `onImpact(t, targetKind, id, damage, hit, x, z, army)` an die Szene |
| `killUnit(t, i, cls?)` | Explosion nach Größenklasse (`death.*`, Standard aus der Art), Scorch/Krater (`VARKAN_SCORCH`), Wrack am selben Index mit `wreck_smolder` für `WRECK_SMOLDER_S` = 24 s. Struktur und ACU werden entfernt |
| `addWreck`, `removeWreck`, `setDamaged(t, i, on)` | vorab vorhandene Wracks, Recycling, `smoke_damage`-Emitter, der der Einheit folgt |
| `buildStream(t, eng, x, y, z)`, `reclaimStream(t, eng, wreck)`, `setStreamTarget`, `stopStream` | Gießstrom bzw. Reclaim-Strom: `build_stream`/`reclaim_stream`-Emitter (Stream-Bewegung) plus BeamPass-Kern (`VARKAN_BEAM_STYLES`, Weißglut-Variante für rote/orange Armeen) |
| `setShield`, `removeShield`, `shieldHit`, `shieldUp` | ShieldPass-Zustand und Treffer |
| `spawnEffect`, `createEffectEmitter`, `moveEffectEmitter`, `timedBeam` | Low-Level für die Galerie |

**Lab-Maßstab:** Die Box-Einheiten des Labs sind etwa 3–4 × so groß wie die Referenz, für die die Varkan-Effekte
gebaut sind (T1 ≈ 1 WU). Deshalb spawnt das Kit Ereignis-Effekte mit `scale = LAB_FX_SCALE` = 2,5, die
ACU-Explosion mit 1,6 und Ströme mit 1,5. Die Proportionen Einheit/Effekt entsprechen damit dem Spiel. In der
Integration (MS5/MS7) gilt Scale 1.

## Szenen

Alle Szenen sind deterministisch aus `params.seed` (`ctx.rng`) und laufen im 60-Hz-Fixed-Step. Die Szenen-Stats
erscheinen in `__fxlab.stats().scene`.

### `battle` (MS7 „2×200 mit Partikeln ≥ 60 FPS, der Cap greift“)

- Je Armee 100 Panzer (Kanone), 63 Bots (jeder 4. mit Raketen, sonst Tracer), 28 Artillerie, 8 Engineers und 1 ACU.
  Blau steht im Westen, Rot im Osten; die Armeen rücken auf 20 Spuren gegeneinander vor. Jede Einheit hält bei
  55–95 % ihrer Reichweite an, dadurch ist die Front gestaffelt statt einer Linie.
- Zielwahl: nächster Gegner, alle 0,5 s gestaffelt neu. Treffer mit Trefferquote, Fehlschüsse streuen auf den Boden.
  Artillerie feuert auf Flächen mit Splash (4 WU).
- Einheiten mit hp < 0,5 rauchen. Tote Einheiten explodieren, lassen ein Wrack und Scorch zurück und werden sofort
  64–80 WU hinter der Mitte neu gespawnt. Es leben also dauerhaft 400 Einheiten; der ACU regeneriert und stirbt nicht.
- Der Start liegt schon im eingeschwungenen Zustand: 100 Wracks (teils noch schwelend) und 45 % angeschlagene
  Veteranen.
- Engineers: je Armee gießen 3 eine Struktur (15 s, `build_stream` + Beam-Kern). Sie steht danach 5 s, zerbirst
  (`explosion_large` + Krater) und wird nach 3 s neu gegossen. 5 Engineers recyceln Wracks auf der eigenen Seite
  (`reclaim_stream`, 4,5 s je Wrack). Nicht beanspruchte Wracks versinken nach 30 s, höchstens 180 bleiben.
- Kamera: halbnah schräg (Ziel Mitte, 118 WU, Neigung 38°, Heading −55°).
- Stats: `units` (400), `wrecks`, `damaged`, `inRange`, `deaths`, `deathsPerS`, `effectsPerS`, `projectiles`,
  `streams`, `built`, `buildProgress`, `reclaimed`.

### `shields` (MS13 „20 Schilde ≤ 1 ms GPU“)

- 20 Schildgeneratoren im 5 × 4-Raster (44 × 42 WU), Radien 6–20 WU, Farbe Team-Blau.
- Zwei Batterien mit je 12 Artillerien stehen 158–172 WU westlich und östlich. Nachladen 2,6 s ± 15 %.
- 88 % der Granaten treffen die Kugel auf der dem Schützen zugewandten Seite (`ShieldPass.hit` + `impact_shield`).
  12 % landen zwischen den Schilden (`impact_ground_large` + Scorch).
- Treffer senken hp um 0,05, bei 0,03/s Regeneration. hp < 0,5 färbt rot, < 0,3 flackert (ShieldPass).
- Schild 7 kollabiert zyklisch alle 10 s:
  - 0–6,5 s: hp 1 → 0, dabei 30 % Fokusfeuer
  - 6,5–6,85 s: Kollaps (upFrac → 0) mit Funken und Blitz
  - bis 8,2 s aus
  - 8,2–9,7 s: Neuaufbau
- Kamera von schräg oben (235 WU, 52°).
- Stats: `shields`, `hits`, `hitsPerS`, `groundHits`, `collapses`, `collapsed`, `projectiles`.

### `big` (MS5 „ACU-Explosion mit Kamera-Shake“, X4)

- ACU in der Mitte, 36 Einheiten auf drei Ringen (r = 13/24/35 WU) und 3 Strukturen (r = 42 WU).
- Erstmals bei t = 1 s, dann alle 8 s: `killUnit(ACU, 'acu')`. Das löst `acu_explosion` + `acu_aftermath`, den
  dauerhaften Krater (22 WU; der alte wird entfernt) und den Shake über `onShake` aus.
- Die Stoßfront (38 WU/s) tötet die Ringe nach Distanz (`explosion_small`/`medium`, Wracks, Scorch), die Strukturen
  mit `explosion_large` + Krater. Nach 6,5 s wird das Feld neu aufgebaut.
- `trigger()` (HUD-Knopf, `__fxlab.triggerBigExplosion()`) löst sofort aus und setzt den Zeitplan neu.
- Kamera mit Abstand (150 WU, 26°).
- Stats: `explosions`, `deaths`, `wrecks`, `sinceBoom`, `shakeSources`, `nextBoom`. Der Shake erscheint in
  `stats().shakeActive`.

### `gallery`

- Raster 5 × 4 (26 × 26 WU) mit 19 Effekten, ACU-Kachel (`acu_explosion + acu_aftermath`) dahinter. Die vordere
  Reihe zeigt die fünf Trail-Stile als Projektilschleifen sowie Timed-Beams (laser, lightning).
- Labels über `LabScene.labels()` (nur mit HUD sichtbar).
- Bursts werden periodisch ausgelöst. Die Phase ist so gewählt, dass bei t = 3 s (`GALLERY_SHOW_T`) jeder Effekt in
  einem typischen Alter steht (Mündungsblitz 0,05 s, Einschlag 0,1–0,35 s, Explosionen 0,35–0,8 s, ACU 1,6 s).
- Dauer-Effekte laufen ständig:
  - `smoke_damage` über einem beschädigten Panzer
  - `wreck_smolder` über einem Wrack
  - `missile_smoke_trail` auf einem kreisenden Emitter
  - `build_stream` Engineer → Struktur
  - `reclaim_stream` Wrack → Engineer
- Für Nahaufnahmen den Kamera-Override nutzen, z. B. `cam=78,38,-90,256,272`.

### Kamera-Override `cam` (additiv)

`?cam=<Distanz>,<Neigung°>,<Heading°>[,<x>,<z>]` ersetzt Distanz und Winkel (optional das Ziel) des Szenen-Presets
(`LabParams.cam?`, `applyCameraOverride`). Ungültige Werte führen zu einer Warnung und dem Szenen-Preset. Mit
`shot --params=cam=…` entstehen Nahaufnahmen (Dateiname z. B. `gallery-cam783890256272-chromium.png`).

## Effekt-Tuning (Sichtprüfung, vorher → nachher)

Die ersten Aufnahmen in Chromium zeigten diese Mängel:

- battle:
  - Kamera längs der Front
  - zwei starre Linien
  - Effekte winzig gegenüber den Lab-Einheiten
  - Rauch kaum sichtbar
- big bei 1,6 s: flache weiße Scheibe mit leuchtendem Boden-Ring („Glaskuppel“)
- big bei 4 s: Rauch als harte schwarze Kugeln
- gallery: die meisten Kacheln wirkten leer
- Gießstrom: weißer Laser statt Glutstrom
- Raketen- und Artillerie-Trails: weiß überstrahlt

Ursachen: Mehrere additive Schichten (ACU-Funken, Bodenfeuer, Staubring mit Intensität 1,6) summierten sich zu Weiß,
dazu kamen HDR-Kerne ≥ 4,5 und der Lab-Maßstab.

Änderungen in `packages/render-fx/src/effects/varkan.ts`:

- `fireballColor`:
  - wird schneller orange (Kern 0,1 → Falloff 0,3 → Dunkelrot 0,65)
  - Spitzen: small/medium 5 → 3,5, large 5,5 → 4, ACU 6 → 2,6
  - der ACU-Feuerball blendet früh auf Alpha (0,1 → 1)
- Blitze:
  - `explosion_small`/`medium` 6 → 4,5
  - ACU-Blitz 14/10 → 6/4,5, Größe 34 → 26 WU
- ACU-Stoßwelle: additiv HDR 7/3,5 → Hitzesaum 2,4, danach Staubfront (DUST), Blend 0 → 1.
- ACU-Funken: 260–300 @ 6 → 200–240 @ 2,4. Nachglut 5 → 3,5.
- `acu_aftermath`:
  - Staubring 1,6 → 0,8
  - Bodenfeuer CORE 4 → FALLOFF 1,8 bei α 0,55
- Explosionsrauch (`fireSmokeColor`):
  - dunklere Mitte (#342E2A), Ende in Eisenrauch
  - α small 0,7 → 0,55, medium 0,75 → 0,6, large 0,8 → 0,65
  - größer: small bis 3,4, medium bis 5, large bis 8 WU
- `smoke_damage`: Rate 9 → 12, Lebensdauer 2,2–3,4 s, bis 2,6 WU, dunkler. Budget 27 → 44.
- `wreck_smolder`: Rate 4 → 7, 3,5–5,5 s, bis 3,2 WU, weicher grau (α 0,38 → 0,22). Budget 22 → 41.
- Staub (Boden-Ringe, Einschlagsäule): Intensität 1,1–1,3 → 0,9–1.
- `build_stream`: pour 4,5/4/3 → 3/2,6/2,2, droplets 5/3 → 3,5/2,2.

Änderungen in `packages/render-fx/src/trails/presets.ts`:

- `buildStream`-Kern 4,5 → 2,6, Glow 1,6 → 1,2
- `reclaimStream` (2,6/1,1/0,45) → (2,0/0,85/0,35)
- Artillerie-Trail-Kopf 4 → 2,8, Raketen-Kopf 6 → 3,5

Die Budgets aus rfx-p1 bleiben eingehalten (Test). `acu_explosion` hat jetzt Budget 882 (vorher 942).

Szenenseitige Korrekturen:

- Diagonale, nähere Gefechtskamera
- gestaffelte Haltedistanzen
- Start im eingeschwungenen Zustand
- Lab-Maßstab 2,5
- Galerie enger und mit Show-Zeiten

**Ergebnis:**

- battle: dichter, chaotischer Frontbereich mit Mündungsblitzen, Tracer-Streaks, Funken als Streaks, weichem
  grauem Rauch über Wracks und angeschlagenen Einheiten, Trümmern und Scorch unter der Front
- big bei 1,6 s: orange Feuerball mit hellem Kern, radiale Funken-Streaks, Trümmer, flacher Staub-Stoßring am
  Boden (keine Kuppel mehr)
- big bei 4 s: brauner Pilz mit Glutfunken, schwelende Wracks, glühende Strukturkrater
- Gießstrom: orange-gelber, durchgehender Strom
- Schilde: Fresnel, Waben, Ripple-Blitz beim Treffer, roter Low-HP-Schild
- LDR (`hdr=0`): lesbar, Feuer gesättigt orange ohne Hof
- Chromium, Firefox und WebKit liefern pixelgleiche Bilder (identische Stats).
- Keine NaN-Pixel, kein Z-Fighting, keine GL-Fehler.

## Screenshots (`test-results/fx-lab-shots/`, 1280 × 720, Medium, alle angesehen)

- `battle`, `shields`, `big-t1.6`, `big-t4`, `gallery` und `lighting`, jeweils `-{chromium,firefox,webkit}.png`
  (`--freeze=6,battle:12,shields:6,big:1.6|4,gallery:3`)
- LDR-Fallback: `battle-hdr0`, `big-hdr0` und `shields-hdr0`, jeweils `-{chromium,webkit}.png`
- Context-Loss: `battle-restored`, `shields-restored` und `gallery-restored`, jeweils `-{chromium,firefox,webkit}.png`
  (`--lose`, identisch zum Bild davor)
- Nahaufnahmen:
  - `gallery-cam783890256{220,246,272,298}-chromium.png`
  - `gallery-cam703890256300-chromium.png`
  - `big-t1.6-cam903090256256-chromium.png` und `big-t4-cam903090256256-chromium.png`

## Tests

`pnpm exec vitest run apps/fx-lab/test/scenes` hat 29 Tests, alle grün.

- `scenes.test.ts` (15):
  - Registry, Headless-`createLabFx` mit 0 Draws.
  - Für jede FX-Szene 20 s Fixed-Step: gleicher Seed ergibt gleiche Aufruf-Log-Prüfsumme und gleichen
    Zustands-Checksum, ein anderer Seed eine andere Prüfsumme. `freeze` ist unabhängig vom Frame-Takt.
  - battle: 400 ± 10 Einheiten über 20 s, > 50 Effekte/s, Tode, Wracks, Rauch, Bau, Reclaim, alle Waffen- und
    Einschlagsklassen, Trails, Beam-Kerne und Emitter.
  - shields: 20 Schilde, > 5 Treffer/s, ≥ 2 Kollapse, Bodentreffer.
  - big: ACU-Explosion bei t = 1/9/17 s, 3 × `explosion_large` je Zyklus, Shake aktiv, `trigger()` sofort und
    danach neuer Zeitplan.
  - gallery: jeder Varkan-Effekt wird gespielt.
- `fx.test.ts` (11):
  - Step-Idempotenz, Muzzle- und Todesklassen-Tabelle, Stats-Objekt-Identität.
  - Artillerie-Ablauf: prev = vorheriges cur, 1 Trail je Schritt, Scheitel, Flugzeit, Einschlag + Scorch, onImpact.
  - Rakete: Emitter folgt und wird entfernt.
  - Homing, toter Zieler fällt auf den Boden.
  - `killUnit`: Wrack, Scorch, Schwelen 24 s; ACU mit Krater und Shake; Struktur.
  - Ströme: 1 Beam je Strom und Schritt, Stopp, Engineer weg → Stopp.
  - Schild-Treffer und kollabierter Schild.
- `load.test.ts` (3): echte `ParticleSystem`/`ShieldPass` usw. auf Fake-WebGL2 mit Szenenkamera.
  - battle Medium: Mittel ≥ 8.000 lebende Partikel, nichts verworfen.
  - battle Low: Cap greift (`dropped[2] > 0`, max ≤ 8.192, P0 nie verworfen).
  - shields: 20 Schilde in einem Pass.
  - big Low: Prio 0 nie verworfen.

Gesamtlauf `tools/heavy pnpm exec vitest run packages/render-fx apps/fx-lab`: 31 Dateien, 279 Tests grün.

## Messwerte (lokal gemessen, Apple M5 Pro)

- Partikellast (CPU-Buchführung des echten `ParticleSystem`, identisch zum Browser; Fake-GL, Kamera wie im Lab,
  1280 × 720):
  - battle Medium, Mittel 6–24 s: 8.948 lebende Partikel, Spitze 10.338, dropped 0/0/0
  - battle Low: sättigt bei ≈ 6.150 (P2-Grenze 0,75 · 8.192), `dropped[2] > 0`
- Screenshot-Stats (Chromium, Firefox und WebKit identisch):

  | Szene | lebende Partikel | Draws |
  |---|---|---|
  | battle t = 12 | 8.316 | 19 (Partikel 1, Beams/Trails 2) |
  | shields t = 6 | 185 | 19 (Schilde 1) |
  | big t = 1,6 | 1.168 | 17 |
  | big t = 4 | 1.462 | 17 |
  | gallery t = 3 | 1.598 | 19 |

- CPU-Zeit je Fixed-Step:
  - Headless (Szene + Kit + echtes ParticleSystem auf Fake-GL): ≈ 0,1 ms bei battle, 0,01 ms bei shields/big/gallery
  - Browser (Chromium, eingefrorener Zustand): `mainJs` p50 0,08–0,11 ms, `fxJs` 0,05–0,06 ms
- GPU-Zeiten aus `shot --measure` waren während dieses Laufs **nicht verwertbar**: Zwei andere Agenten hielten
  parallel beide Heavy-Slots. Die Timer-Segmente lagen bei 14–35 ms, obwohl der Frame-p50 bei 16,66 ms (60 FPS)
  lag. Die offiziellen GPU-Messungen macht rfx-p7.

## Hinweise für rfx-p7 (Bench/E2E)

- Alle Szenen sind registriert, Standard-Startszene ist `battle`.
- Die FX-Draw-Prüfung aus rfx-p5 gilt weiter: `drawsBySeg.shields + particles + beams`. `beams` enthält Trails
  und Beams, also bis zu 2 Draws. Partikel haben 1 Draw, 2 beim Ring-Umlauf.
- Die Partikellast von battle Medium liegt ab Szenenstart über 8.000 (eingeschwungener Start).
- Für „der Cap greift“ `preset=low` nutzen: `stats().fx.particles.dropped[2] > 0`.
- Shake prüfen mit `scene=big`, `freeze=1.6` → `stats().shakeActive === true`, oder mit `triggerBigExplosion()`.
- Szenen-Stats-Schlüssel: siehe Abschnitt Szenen.

## Integrationshinweise (MS5/MS7/MS13)

- `LabFxKit` ist die Vorlage für den Event-Konsumenten im Client:
  - Waffe, Einschlag, Tod, Bau/Reclaim und Schaden laufen über `VARKAN_EVENT_FX`.
  - Projektile als prev/cur-Records mit `TrailPass.add(prev, cur, style, lengthScale)`.
  - Raketenrauch als Emitter am Projektilkopf.
  - Wrack-Schwelen und Schadensrauch als Emitter je Entity.
  - Ströme als Emitter + `BeamPass.add` je Frame.
  - Seeds deterministisch aus (Szenen-Seed, Zähler); im Spiel aus (Entity, Tick).
- Die Lab-Skalierung (`LAB_FX_SCALE`) nicht übernehmen: Im Spiel gilt Scale 1 zur echten Einheitengröße.
- Das Tuning betrifft nur Daten (`varkan.ts`, `presets.ts`), die API ist unverändert.

## Abweichungen

- Additive Vertragserweiterungen in der Shell: `LabParams.cam?` mit `LabCameraOverride` und `applyCameraOverride`.
  Die Unit-Typen liegen jetzt in `unit-types.ts`; `context.ts` re-exportiert sie, die Namen bleiben gleich.
- `LabFxKit.update(ctx, t, dt)` ignoriert `dt`: Die Fixed-Step-Zeit reicht.
- Die Szene `big` nutzt 36 Einheiten auf drei Ringen und Strukturen bei r = 42 WU. So liegen die drei
  `explosion_large` außerhalb des Feuerballs.
- In battle stirbt der ACU nicht (Regeneration, Schadensfaktor 0,08). Der ACU-Tod gehört in die Szene `big`, damit
  das Gefecht nicht alle paar Sekunden schüttelt.

## Bekannte Grenzen

- GPU-Zeiten sind nicht sauber gemessen (Fremdlast), das macht rfx-p7.
- big bei 1,6 s: Kern und die Blitze der sterbenden Ring-Einheiten bleiben sehr hell (Bloom). Das ist gewollt
  kräftig, aber nahe an der Sättigung.
- Rauch wird nicht sortiert (Entscheidung rfx-p3). Überlappende Rauchsäulen können selten falsch herum liegen.
- Einheiten haben keine Kollision, Props werden durchfahren.
- `explosion_medium` erscheint in battle selten, weil Artillerie weit hinten steht. Alle Klassen zeigen die
  Szenen `big` und `gallery`.
- Die Galerie-Übersicht (150 WU) zeigt kleine Effekte nur wenige Pixel groß. Für die Abnahme `cam` nutzen.
  Labels gibt es nur mit HUD, das bei `--hud` die linke obere Ecke verdeckt.
- Der Scorch-Pool (256 bei Medium) ist in battle voll; die ältesten Decals werden ersetzt (so vorgesehen).
