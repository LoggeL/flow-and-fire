# Finaler Umsetzungsplan MVP: Browser-RTS nach FA-Vorbild

**Namenskonvention:** Meilensteine heißen **MS1–MS14**, Risiko-Spikes **SPK1–SPK7** und Grundbausteine **G1–G20**. Feature-IDs bleiben wie in der Featureliste. M1–M12 bezeichnet also immer Karten-Features, nie Meilensteine.

---

## 1. Überblick

Gebaut wird ein Singleplayer-RTS im Browser. Mechanisch folgt es Supreme Commander: Forged Alliance mit Flow-Ökonomie, echten Projektilen, Strategic Zoom, Assist und Shift-Queues, hat aber eine eigene Fraktion und eigene Assets. Der MVP umfasst alle **112 Features** mit Tier „MVP-Kern“ (62) und „MVP-optional“ (50) aus der Featureliste. Genannt waren „ca. 108“, die Datei ergibt exakt 112. Nicht enthalten sind Multiplayer-Netcode, Save/Load, Mods, Marine, T3-Luft, Experimentals, Nukes, Stealth und WebGPU, die Verträge dafür stehen aber ab Tag 1. Technisch läuft eine deterministische Q20.12-Fixed-Point-Sim mit 10 Hz in einem Web Worker auf einer einzigen `WebAssembly.Memory`-Arena, gezeichnet wird sie von einer eigenen WebGL2-Pipeline hinter einer schlanken RHI, und die KI ist ein tick-synchroner Command-Produzent in einem eigenen Worker. Die ersten 7 Wochen gehören den Risiko-Spikes, danach folgen 14 spielbar endende Meilensteine: Der MVP-Kern ist nach **MS9** vollständig zugeordnet, der Voll-MVP nach **MS14**, und der Gesamtaufwand liegt bei **ca. 169–225 Personenwochen** (1 Senior mit KI-Assistenz, ≈ 3,7–4,9 Personenjahre), davon 114–148 PW bis zum ersten Skirmish gegen die KI.

---

## 2. Tech-Stack

| Bereich | Wahl | Begründung |
|---|---|---|
| Sprache | **TypeScript 5.x strict** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) mit Branded Types `Fx`, `FxSmall`, `Ang16`, `Milli`, `SafeInt`, `Tick`, `Handle`, `ArmyId`. **Rust→WASM** nur als Ausweg für Hotpaths, falls SPK1 scheitert. | Typsicherheit und hohe Iterationsgeschwindigkeit mit KI-Assistenz. Ein falsches `*` auf `Fx` ist ein Typfehler. Der WASM-Ausweg arbeitet ohne Kopie auf derselben Arena. |
| Sim-Zahlen | **Q20.12 in Int32**, Zwischenwerte exakt in Float64; `Ang16` über Binärwinkel und LUTs; zustandsloser Counter-Hash-RNG | Wertebereich 81 km, Produkte ≤ 2⁴⁸ exakt. Durch Korrektur-Division und `isqrt` bitgleich zu einer späteren i64-Portierung. Q16.16 läuft über, ein Float64-Subset wäre nicht portabel. |
| Sim-Speicher | **eine nicht geteilte `WebAssembly.Memory`** mit fester Größe, Table-DSL mit Codegen (SoA), Handles `index:20\|gen:12`, Freelist FIFO | Snapshot, Keyframe und Restore sind jeweils ein `memcpy`. Der WASM-Ausweg braucht keine Kopie. |
| Threads und Transport | Main-, Sim-, AI- und Asset-Worker. `FrameTransport` mit **SAB-Triple-Buffer** (wenn `crossOriginIsolated`) oder **Transfer-Ping-Pong**, gleiches Layout | Der Sim-Tick blockiert nie das Rendering. Der Build läuft auch ohne COOP/COEP (Embeds, Dev). |
| Monorepo und Build | **pnpm workspaces**, TS Project References, **Vite** (Module-Worker, HMR, Library-Build), **dependency-cruiser**. Sim-Pakete mit `lib: ["ES2022"]` ohne DOM | Sim-Reinheit wird zum Compile-Fehler, Paketgrenzen werden erzwungen. |
| Rendering | **eigene WebGL2-Pipeline** hinter einer RHI im WebGPU-Stil, GLSL ES 3.00, std140-UBOs, gl-matrix. three.js nur in Tools | Integer-Instancing, CDLOD, Icons in einem Draw und zustandslose Partikel sind ohnehin Spezial-Shader. Ein WebGPU-Backend lässt sich später nachrüsten. |
| UI | **Preact + @preact/signals** als DOM-Overlay, Minimap in **Canvas2D**, Tweakpane und stats-gl nur für Debug | Leichtgewichtig, feingranulares Binding mit 4–10 Hz, übersteht Context-Loss. |
| Daten und Schema | **TypeBox**. Blueprints als TS-Datenobjekte, kompiliert zu `sim.bin`, `view.json` und kanonischem `bundle.json` | Typen beim Schreiben, echtes JSON-Schema, stabile Basis für spätere Mods. |
| Assets | **glTF 2.0 + meshopt**, **KTX2/Basis** (UASTC für Normals, ETC1S für Albedo), gltf-transform, Cache über vite-plugin-pwa | Kleine Downloads, GPU-komprimiert, unkomprimierter Fallback. |
| Tests | **Vitest**, **fast-check**, **Playwright** (Chromium, Firefox, WebKit), headless in **Node + Bun**, **self-hosted GPU-Runner** (Windows/Iris Xe, macOS/Safari) | Determinismus ohne GPU, Rendering auf echter Hardware. |
| Lint | ESLint (flat) mit eigenem Regelset **`sim/determinism`** | Verbotene APIs sind Build-Fehler. |
| Kompression | `CompressionStream('deflate-raw')`, fflate als Fallback | Native API, keine Abhängigkeit. |
| Audio | eigener **Web-Audio-Mixer** (Busse, 32 Stimmen, Limits pro Kategorie) | Die RTS-spezifische Priorisierung fehlt in Libraries. |
| i18n | typisierte Tabellen `content/locales/{de,en}.json`, der Compiler prüft die Keys | Ein fehlender Key bricht den Build ab. |
| Hosting | statisch (Dokploy/nginx), COOP `same-origin` + COEP `require-corp` (`credentialless` wird geprüft). **Jeder Build liegt vollständig unter `/b/<buildHash>/`** | SAB-Transport und dauerhaft abspielbare Replays (ganzer Client versioniert). |

---

## 3. Architektur

### 3.1 Verträge (ab Tag 1, später nicht nachrüstbar)

| Vertrag | Festlegung | Ermöglicht später |
|---|---|---|
| Sim-Reinheit | Der Zustand ändert sich nur über `step(commands)`. Keine Wall-Clock, kein `Math.random`/`Math.sin`. Aller State inklusive Caches liegt in der Arena. | Replays, Lockstep (N3), Save/Load (S10), Server-Validierung |
| Command-Format | binär, versioniert, Opcodes nur anhängen. Identisch für Worker, Replay und Netz | Replay-Strom = Netzstrom |
| `CommandSource` | `commandsFor(tick) → cmds \| 'pending'` | Tick-synchrone KI heute, `NetworkSource` später |
| Sim-Identität | `simId = hash(simBuild ‖ bpSimHash ‖ mapSimHash ‖ modList)` | Lobby-Check, Replay-Kompatibilität |
| Build-Versionierung | Client und Sim zusammen unter `/b/<buildHash>/`, alte Builds bleiben erhalten | Alte Replays laufen mit ihrem eigenen Client |
| Armies | 16 Armies, Allianzmatrix, Vision pro *tatsächlich vorhandenem* Team. Der MVP nutzt 2 Slots | Teams (A17), Observer (N2) |
| Bewegungs-Layer | Enum `Land, Water, Seabed, Hover, Amphibious, Air`. Im MVP aktiv: `Land`, `Air` | Marine und Hover ohne Formatbruch |
| Weltmaßstab | 1 WU = 1 FA-Ogrid ≈ 19,5 m. Formate tragen 4.096 WU (81 km), getestet wird bis 1.024 WU (20 km), gespielt auf 256–512 WU. Grids in 32×32-Chunks | Große Karten, Streaming |
| Blueprint-Identität | Namespace-IDs (`core:…`), 128-Bit-Kategorie-Masken, `sim` und `view` getrennt gehasht, Behaviors per Registry-Key | Mods, zweite Fraktion als reine Daten |
| Präsentation | VFX, Sound und Alerts nur aus dem Event-Stream, nicht im Hash | Effekte ändern, ohne Replays zu brechen |
| Container | Chunk-Format `4CC, len, data, CRC`, unbekannte Chunks werden übersprungen | Karten-, Replay- und Save-Erweiterungen |

### 3.2 Repo-Baum

```
/packages
  fixed/       Fx Q20.12, FxSmall, Ang16, LUTs (offline generiert, als Binär eingecheckt), fxDiv/isqrt mit Korrektur, rng32, xxHash32
  heap/        Arena (WebAssembly.Memory), Table-DSL + Codegen (SoA-Views, alloc/free FIFO, Layout-Hash, highWater), Slabs, Dense-Components
  protocol/    Command-Codec, Frame-/Event-/PartStream-/Perception-Layouts, Opcodes (append-only)
  formats/     Chunk-Container, .rtsmap Reader/Writer, .rtsreplay Reader/Writer, CLI-Map-Import
  rules/       canPlace, Footprint-Rasterung, Kategorie-Ausdrücke, Kosten-/Repair-Formeln (von Sim, Client und KI geteilt)
  blueprints/  TypeBox-Schemas, define*(), extends/Merge, Compiler → sim.bin/view.json/bundle.json + Hashes, Placeholder-Specs
  nav/         Passability/Clearance, Komponenten, Sektor/Portal-Graph, A*, HPA*, Flow Fields, Steering, Air-Kinematik, DDA
  sim/         World, Systeme (Phasen 3.4), OrderBehaviors, Eco, Combat, Intel, Modifier, Stats, Hash, FrameWriter
  sim-host/    Worker-Entry, Scheduler, CommandSources (Local/Replay/AI), Transports, Replay-Recorder (OPFS), Keyframes, Headless-Entry
  ai/          AiBrain (Manager, Platoons, Threat-Map), AiHost (Worker + synchron headless), Profile
  render/      RHI + webgl2-Backend, Passes, Instancing (Merged-Part), CDLOD, Terrain-Decals, Partikel, Icons (MSDF), Placeholder-Meshes, Presets, Context-Loss-Registry
  client/      Input/Action-Mapping, Kamera, Picking, Selection, Command-Builder, UI (Preact), Minimap, Audio, Settings, i18n, Frame-Consumer
/apps
  game/            Menü, Skirmish, Replay-Viewer, Dev-Konsole
  marker-editor/   M12 (render/TerrainView + formats; three.js erlaubt)
/tools
  headless/        Szenarien, Goldens, Replay-Verify, desync-diff, bench, ai-tournament (Elo), scenario-export
  assets-pipeline/ glTF-LODs, KTX2, MSDF-Atlas, Audio-Transcode, Manifest
/content  blueprints/core/{units,weapons,projectiles,props,effects,ai-profiles,test}/  maps/  locales/  art-src/ (LFS)
/test     determinism/  golden-replays/  e2e/
```

**Abhängigkeitsregeln** (erzwungen per dependency-cruiser):
- `fixed ← heap ← sim`
- `fixed ← protocol ← formats`
- `fixed ← rules ← blueprints`
- `sim → {fixed, heap, nav, protocol, formats, rules, blueprints-Typen}`
- `sim-host → sim`
- `ai → {protocol, rules, nav (lesend), blueprints (view/stats)}`
- `render → protocol`
- `client → {render, protocol, rules, formats, blueprints}`
- Weder `client` noch `render` noch `ai` importieren `sim`. Nichts importiert `client`.

### 3.3 Zahlen und RNG

```ts
fxMul(a: Fx, b: Fx): Fx                 // Math.floor(a*b/4096), |a*b| ≤ 2^48 (Invariante: |Fx| ≤ 2^26 raw)
fxMulSmall(a: FxSmall, b: FxSmall): Fx  // Math.imul(a,b)>>12; FxSmall < 2^15 WU statisch; Debug: == fxMul
fxDiv(a: Fx, b: Fx): Fx                 // floor(a*4096/b) + Integer-Korrektur bis q*b ≤ a*4096 < (q+1)*b
isqrt(n: SafeInt): number               // floor(sqrt(n)) + Korrektur bis r² ≤ n < (r+1)²
rng32(seed, tick, entityIdx, salt): u32 // Squirrel/Murmur-Finalizer via Math.imul, kein Zustand
```

- `sin`/`cos` laufen über eine Viertelwellen-LUT mit 4.096 Einträgen, `atan2` über Oktanten-Reduktion plus LUT mit 1.024 Einträgen. Der Hash der LUTs steht im Test.
- Der `SafeInt`-Setter normalisiert (`v + 0`, damit kein −0 entsteht) und prüft im Debug-Build `Number.isInteger`.
- Blueprint-Werte werden im Compiler genau einmal umgerechnet (pro Sekunde → pro Tick, Grad → Ang16, Dezimalwert → Fx).

### 3.4 Tick-Loop und Sim-Tick-Phasen

**Scheduler** (`sim-host`, gehört nicht zum State):
- `MessageChannel`-Selbstping mit Akkumulator, Solltakt `100 ms / speed` (A6: 0,25–3x), höchstens 3 Ticks pro Slice.
- Hinkt die Sim hinterher, verlangsamt sie sich (wie FA-Sim-Lag).
- Pause und Speed sind Control-Nachrichten und landen im Replay als `MARK`.
- `visibilitychange` pausiert im SP (S9).
- Im SP gilt **`inputDelay = 0`**: Ein Command wird im nächsten `step` angewendet, aufgezeichnet wird der tatsächliche Anwendungs-Tick.

**Budgets** (p95, gemessen im **langsamsten Engine-Worker** inklusive Hash-Tick; Referenz-Laptop mit 4 P-Kernen, Iris Xe/Vega 7, 1080p):

| Last | Sim-Tick | Main-JS/Frame | GPU @ Medium |
|---|---|---|---|
| typisch (400 Units, 1.000 Projektile) | ≤ 10 ms | ≤ 4 ms | ≤ 10 ms |
| Big Battle (1.000 mobil + 500 Gebäude, 4.000 Projektile, 20k Props) | ≤ 25 ms | ≤ 5 ms | ≤ 12 ms |

Kapazitäten: 8.192 Units, 16.384 Projektile, 4.096 Wracks, 65.536 Props. Im Hot Path wird nichts alloziert (warm < 1 MB über 10.000 Ticks als harte Grenze, kalt nur mit Toleranz).

**Phasen** (verbindliche Reihenfolge):
- Iteriert wird in Slot- bzw. Dense-Reihenfolge.
- Sortiert wird nur mit totalem Comparator oder per Counting-/Radix-Sort.
- Konflikte (etwa mehrere Reclaimer an einem Wrack) werden zweiphasig gelöst: erst Anfragen sammeln, dann verteilen.

| # | Phase | Aufgabe | Features / G |
|---|---|---|---|
| 1 | CommandApply | Commands des Ticks nach `(army, seq)` anwenden. Prüfen: Handle-Generation, Besitz, Baubarkeit, `rules.canPlace`, Unit-Cap. Danach Orders einreihen, Formation- und Offset-Records anlegen | S3, C4–C7, C12–C13, C17–C18, K6, B3, E13, U7, S8 |
| 2 | Orders | `OrderBehavior{begin,tick,complete}`: Move, AttackMove, Attack, AttackGround, Patrol (Engineer-Automatik, gestaffelt 1/5), Guard/Assist, Build, Repair, Reclaim, Upgrade, Overcharge, Stop. Path-Requests stellen, **Eco-Bedarf melden**, Return Fire. Idle-Einheiten schlafen | G7, G3, G4, B2, B4, B6, E7, E12, U8 |
| 3 | PathService | FIFO nach `(issueTick, entityIdx)`, Budget in Expansionen, HPA\*-Verfeinerung, Flow Fields fortsetzen | M6, M10 |
| 4 | Economy | Einkommen × Modifier, Priority-Tiers, Stall-Ratio pro Tier, Overflow, Stall-Flags mit Hysterese | E1–E6, E9–E11, E13, A11 |
| 5 | Construction/Factory/Reclaim/Repair/Upgrade | BP × Ratio mit kumulativer Abrechnung, Spawn am Ende der Phase, Roll-off → Rally | E2, E5, E7, E8, E12, B3, B4, U5, G10 |
| 6 | Shields/Toggles | Regeneration, Kollaps und Wiederaufbau, Unterhalt, `stallsOff` | K10, C17 |
| 7 | Movement | Boden: Pfad, Flow, Formation-Slot oder Offset → Steering → Integration → Kollision → Höhe und Neigung. Luft: kinematisch. Falling-Entities | M7, C13, U11, G8 |
| 8 | SpatialRebuild | Counting-Sort: Fein-Grid (4 WU) und Grob-Grid (32 WU) pro Layer. Statische Grids nur bei Events | S5 |
| 9 | Intel | Vision- und Radar-Refcount per **Row-Span-Delta-Stamp** bei Zellwechsel. Luft-Vision auf 4-WU-Grid. Explored-Bits, Ghosts, Blip-Jitter (alle 2 Ticks) | I1–I3 |
| 10 | Targeting | gestaffelt (Waffenzeile mod 3), bei Zielverlust sofort neu. Layer-Maske, Kategorie-Prioritäten, Allianz, Sicht/Radar | K3, K6, C6 |
| 11 | Weapons | Turret-Drehrate, Arcs, Reload/Salven, Vorhalt, Streuung (`rng32`), OC-Energie, Projektil-Spawn + Events | K1, K2, K9, K11, K13, U8, G9 |
| 12 | Projectiles | Integration (linear, ballistisch, homing). **Swept-Segment im Bezugssystem des Ziels** (Relativbewegung) per DDA im Fein-Grid, Yaw-Box als Narrowphase. **Terrain-DDA über die Heightmap-Zellen** des Segments, Wracks, Schilde. **Näherungszünder** für Flak/SAM | K1, K7, K10–K12 |
| 13 | Damage | Queue in Einfügereihenfolge: Schild → HP, Splash, Friendly Fire, Kill- und Vet-Credit | G1, K4, K8, K10, U9 |
| 14 | Death | Wrack, Death-Weapons in T+1, ACU-Explosion, Absturzschaden, Footprint frei → Nav-Update, Adjacency neu | G2, K5, K12, K14, U1 |
| 15 | Cleanup/Rules | Slots frei (gen++, FIFO), Siegbedingungen, Stats-Samples alle 10 s | A4, A12, A13, G12 |
| 16 | Output | Regel-Hash (s. 3.5), `writeFrame(viewer)`, Events, Perception an die KI an festen Ticks | S4, S7, N1 |

**Economy-Kern:**
- Verbraucher melden ihren Bedarf in Phase 2.
- Pro Tier gilt `ratio = floor(rest·65536 / demandTier)`. Jeder Verbraucher erhält `min(ratioMass, ratioEnergy)`, das Ergebnis hängt nicht von der Reihenfolge ab.
- Abrechnung: `verbraucht = floor(cost·done/total)`, die Summe ergibt exakt `cost`.
- Repair kostet anteilig an den Baukosten.

**Modifier (G6):** Die Tabelle `Modifiers` wird ereignisbasiert in effektive Spalten gefaltet (`effBP`, `effMaxHp`, `prodMult`, `regen`), sortiert nach `(source, order)`.

### 3.5 Datenmodell

- **Arena:** `WebAssembly.Memory` ohne Grow, Größe aus Caps × Kartengröße (≈ 17 MB bei 10 km, ≈ 30 MB bei 20 km).
  - Bereich *dynamisch*: State und abgeleiteter State.
  - Bereich *statisch*: Heightmap, Nav-Precomputes. Nicht gehasht, geht aber über `mapSimHash` in `simId` ein.
- **Tabellen** entstehen per Codegen aus der Table-DSL:

```ts
export const Units = defineTable('units', CAP_UNITS, {
  bp:'u16', army:'u8', layer:'u8', state:'u8', flags:'u32', gen:'u16',
  x:'i32', y:'i32', z:'i32', px:'i32', py:'i32', pz:'i32', yaw:'u16', pyaw:'u16', bank:'i8',
  vx:'i32', vz:'i32', hp:'i32', buildDone:'f64s', vetMass:'f64s', vet:'u8', lastHitBy:'u32',
  orderHead:'i32', orderTail:'i32', weaponFirst:'u16', weaponCount:'u8', formation:'i32', groupOffset:'i32',
  mover:'i32', air:'i32', builder:'i32', factory:'i32', shield:'i32', intel:'i32', eco:'i32', // -1 = keine
});
```

| Tabelle | Art | Inhalt |
|---|---|---|
| `Units` | Slots | Units und Strukturen |
| `Movers`, `AirMovers`, `Builders`, `Factories`, `Shields`, `IntelEmitters`, `EcoProducers`, `EcoConsumers` | dicht, Back-Pointer, Swap-Remove | Systeme iterieren nur über die dichten Arrays |
| `Weapons` | eine Zeile pro Mount | Cooldown, Yaw/Pitch, Ziel, Salve |
| `Projectiles` | dichter Pool | Position, Geschwindigkeit, Gravitation, Homing-Ziel, Waffen-BP, Instigator, TTL, Fuse-Radius |
| `Wrecks`, `Props` | Slots / statisch | Restwert, HP, `blocksShots`; bei Props ändert sich nur `remaining/alive` |
| `OrderPool`, `FactoryQueue`, `PathBlocks`, `FlowFields` | Slabs | Order-Records à 32 B, Waypoints, Richtungsbytes |
| `BuildIntents`, `Formations`, `Modifiers` | Slots | geteilte Bau-Ghosts, Anker/Slots, Stat-Modifier |
| `Armies` | 16 Zeilen | Eco (`SafeInt`), AIx, Unit-Count, Allianzen, Stats-Ring |
| `IntelMemory` | pro Team | Ghost-Buildings |
| Grids | 32er-Chunks | Höhe u16, Normals, Passability/Clearance, Footprints, Vision/Radar-Refcount (nur echte Teams), Explored-Bits, Spatial-Grids, Chunk→Pfad-Rückindex |

**Hashing:**
- **Regel-Hash** (Replay- und Desync-Prüfung): xxHash32 nur über *Live-Bereiche* (bis `highWater`) von State-Tabellen, Slabs, Armies und IntelMemory, alle 10 Ticks (Release: 50).
- **Abgeleiteter State** (Spatial-Grids, Vision-Refcounts, Clearance-Deltas, Pfad- und Flow-Caches) fließt nur in den **Voll-Hash** ein. Den nutzen `desync-diff` und der L4-Restore-Test.
- Der Hash-Tick ist eine eigene L6-Kennzahl. Überschreitet er laut SPK5 2 ms, wird der Hash als **Rolling-Hash** berechnet (pro Tick ein Zehntel der Tabellen, deterministisch) oder läuft in WASM.

### 3.6 Worker-Protokoll

```
Main (Render/Input/UI/Audio) ──cmd/ctl (MessagePort)──▶ Sim-Worker ◀──cmd── AI-Worker (CommandSource, tick-synchron)
Main ◀── Frames + Events (FrameTransport: SAB-Triple-Buffer | Transfer-Ping-Pong) ── Sim-Worker ──Perception@Tick N──▶ AI-Worker
Asset-Worker ──Transfer──▶ Main
```

**Kanäle:**
- `cmd`: binärer Batch ohne Tick. Der Host legt ihn auf den nächsten `step`.
- `ctl`: `pause`, `resume`, `speed`, `step`, `viewer`, `watch` (≤ 64 Einheiten), `debug`, `devReload` (markiert das Replay als tainted).
- `perception`: Sim → KI.
- selten: `query`, `gameOver`, `hashReport`, `error`.

**Commands:**

```ts
const enum Op { Move=1, AttackMove, Attack, AttackGround, Patrol, Guard, Assist, Build, Repair, Reclaim, Upgrade,
  FactoryQueue, FactoryRepeat, SetRally, FireState, TogglePause, SetPriority, ToggleAbility, Overcharge,
  SelfDestruct, Stop, FormationMove, GroupMove, /* 200+ Meta (MP) */ Cheat = 250 }
interface CommandEnvelope { tick: Tick; army: ArmyId; seq: u16; op: Op; flags: u8; units: Handle[]; payload: Uint8Array }
interface CommandSource { commandsFor(tick: Tick): readonly CommandEnvelope[] | 'pending' }
```

**Frame** (versioniert, Layout nur erweiterbar, aus Sicht des Viewers gefiltert):

```
FrameHeader { magic, ver, seq, tick, tickTimeMs, speed, viewer, counts{…}, offsets{…}, fogRect, footprintDeltaCount }
UnitRecord 48 B: prevPos ivec3 | curPos ivec3 | prevYaw u16 | curYaw u16 | visual u16 | army u8 | hp u8 | build u8
                 | bank i8 | flags u16 | handle u32 | partBase u32 | partCount u8 | reserved[3]
                 flags: building, wreck, ghost, blip, vet(2), shieldUp, stalled, damaged, idle, noInterp …
PartStream:      pro Part {prevYaw u16, curYaw u16, prevPitch i16, curPitch i16} = 8 B, bis 8 Parts pro Unit
ProjectileRecord 28 B: prevPos ivec3 | curPos ivec3 | visual u16 | army u8 | flags u8
BeamRecord 12 B | Event 32 B {type, tick, subTick, visual, pos, dir/aux, handle}
Sektionen: Eco | Watch (Queues, Details) | Intents | Fog (Dirty-Rect R8) | Footprint-Deltas (RLE) | Shields | Debug
```

**Regeln für Frames:**
- Die Sim filtert eigene, sichtbare, Ghost- und Blip-Einträge. Blips erscheinen mit gejitterter Position und ohne Blueprint.
- Projektile und Events werden nur in Sicht übertragen, der Client kann also nicht schummeln.
- Budget ≤ 250 KB pro Tick. Der Client kopiert beim Eintreffen in lokale Puffer (Copy-on-Arrival).
- **Interpolation:** Der Render-Delay ist adaptiv mit Ziel ca. 0,5 Tick und Jitter-Puffer. `noInterp` wird gesetzt bei Spawn, Roll-off und neuem Handle im Slot; dann gilt prev = cur.
- **Latenz:** Klickmarker, Wegpunktlinie, Ack-Sound und Bau-Ghost kommen sofort aus dem Client, die Sim bestätigt per `seq`. Ziel: Klick → erster bewegter Pixel ≤ 150 ms.
- **Client-Replikate:** statische Heightmap und Nav-Grids plus ein per Delta synchronisiertes Footprint-Grid. Ghost-Verdikt und Range-Ring-Projektion laufen über dieselben `rules` wie in der Sim.

### 3.7 Rendering

```ts
interface GpuDevice {
  createBuffer(d: BufferDesc): BufH;  writeBuffer(h: BufH, off: number, src: ArrayBufferView): void;
  createTexture(d: TexDesc): TexH;    writeTexture(h: TexH, r: Rect, src: ArrayBufferView): void;
  createPipeline(d: PipelineDesc): PipeH;               // inkl. Integer-Attribute
  beginPass(d: PassDesc): PassEncoder;                  // setPipeline, setBindGroup, setVertexStreams, drawIndexedInstanced, multiDraw?
}
```

**Pipeline:**
- Feste Passes: Shadow → Terrain (inklusive Decals) → Props → Units/Wracks → Water → Shields → Particles → Icons → Overlay → Post.
- Eine Ressourcen-Registry baut nach `webglcontextrestored` alles neu auf (P10), die Sim läuft währenddessen weiter.

| Teil | Entscheidung |
|---|---|
| Units | **Merged-Part-Mesh:** Jeder Vertex trägt eine `partId`, der VS transformiert pro Part mit den Winkeln aus dem `PartStream`. Das ergibt **einen Draw pro (visual, LOD)**, mit `WEBGL_multi_draw`, wenn verfügbar. Im VS gilt `rel = ivec3(pos) − camPosInt`, danach `vec3(rel)/4096.0` (exakt auf 81 km). Außerdem Interpolation, Tilt aus der Normal-Textur, Bank für Luft, prozedurale Bot-Beine, Teamfarbe per Maske, Build-Dissolve und Wreck-Shader. Budget ca. 250 Draws. |
| CPU pro Frame | Nur bei neuem Tick oder Kamerabewegung: Chunk-Frustum plus Kugeltest, LOD, Mesh/Icon, Bucket-Sort in den Staging-Puffer, Instanz-Ring mit 3 Regionen. |
| Platzhalter | `view.placeholder` erzeugt prozedurale Low-Poly-Parts. Gameplay wartet nie auf Art. |
| Strategic Zoom | Mesh → Icon per Alpha-Crossfade. **IconPass ist ein einziger Draw** (MSDF-Atlas, Tech-Striche, Blip/Ghost). Ab Z1 keine Schatten und Props, ab Z2 nur Icons. Near-Plane dynamisch aus der Kamerahöhe. |
| Terrain | **CDLOD:** Patch mit 33×33 Vertices, instanziert, mit Geomorphing (Stufen ab MS14, vorher eine Stufe). R16UI + `texelFetch` + manuelle Bilinear-Filterung, identisch zur Sim. Auto-Splat plus Splatmap mit 8 Layern (Medium: 4). Triplanar ab High. |
| Decals | **Im Terrain-Fragment-Shader** über eine Decal-Liste pro Chunk: Scorch, Selection-Ringe, Range-Ringe (SDF), Placement-Footprint, Rally- und Wegpunkte. Nur Bau-Ghosts sind echte Meshes. Das verhindert Schweben und Z-Fighting mit CDLOD. |
| Fog | R8-Textur mit 2-WU-Auflösung, prev/cur mit Alpha überblendet, gesampelt in Terrain, Units, Props und Decals |
| Wasser | Ebene mit Farbe und Alpha nach Tiefe, scrollende Normals, Uferschaum |
| Partikel | zustandsloser Spawn-Ring (64k, Cap nach Preset), `f(t−t0)` im VS, Kurven-LUT, `defineEffect`-Daten, Prioritäten. ACU-Explosion mit Kamera-Shake |
| Beams, Schilde | instanzierte Quads; Kugel-Instanzen mit Fresnel und 4 Ripples aus `ShieldHit` |
| Licht und Post | Forward-Rendering, ein direktionales Licht plus Hemisphere. **CSM:** Terrain und Props statisch gecacht, pro Frame nur Units mit reduziertem LOD. HDR RGBA16F (sonst LDR), Dual-Kawase-Bloom, ACES, FXAA, MSAA ab High |
| Presets | Low bis Ultra mit Caps, Render-Scale (Medium 0,8), Splat-Layern und Kaskaden. Infrastruktur ab MS2, UI und Autodetect (`WEBGL_debug_renderer_info` + 3-s-Benchmark) in MS14 |
| Minimap | Canvas2D, 4 Hz |
| Picking | auf der CPU aus den Frame-Daten, Terrain per Heightmap-Raymarch, kein GPU-Readback |
| Audio | Voice-Manager mit 32 Stimmen, Limits pro Kategorie, Cooldown pro Sound, Panning und Dämpfung nach Zoom, Alert-Queue mit Sprung zum Ort |

### 3.8 Pathfinding und Bewegung

| Teil | Entscheidung |
|---|---|
| Grids | Zellen à 1 WU pro Layer: `passable/cost` (Neigung) und Clearance (u8). Anfrage der Größenklasse s verlangt `clearance ≥ s`. Precompute beim Laden, Cache in IndexedDB anhand des Map-Hash |
| Konnektivität | Komponenten pro (Layer, Clearance), lokal nachgeführt. Unerreichbare Ziele → Spiralsuche nach dem nächsten erreichbaren Punkt |
| Hierarchie | 32×32-Sektoren mit Portalen. **HPA\* ist ab MS3 Standard** (abstrakter A\* über Portale, Lazy Refinement mit Fein-A\*). Fein-A\*: oktil, Integer-Kosten, Heap auf `Int32Array`, Tie-Break f → h → Zellindex, String-Pulling mit Clearance-LOS |
| Kurzwege | Liegt das Ziel im selben oder im Nachbarsektor und ist die Supercover-LOS frei, genügt direktes Steering ohne A\* |
| Repath | **Nur wenn ein neuer Footprint den verbleibenden Pfadkorridor schneidet** (Zellen plus Clearance), gefunden über den Rückindex Chunk → Pfade. Ziel-Verfolgung: Repath erst, wenn sich das Ziel mehr als X WU vom Pfadende entfernt hat, bei freier LOS direktes Steering |
| Gruppen | **Ein Gruppenbefehl = eine Anfrage.** Standard ist der **Offset-Erhalt**: Die relative Anordnung zum Schwerpunkt bleibt erhalten (komprimiert auf einen Maximalradius), Slots werden deterministisch in der Sim vergeben. Ab 12 Einheiten ohne Formation: **Flow Field** (Dijkstra im Portal-Korridor, budgetiert, LRU mit 16 Feldern in der Arena) |
| Formationen (C13) | Drag-Linie `(from, to, facing)`. Der Anker folgt Pfad oder Flow, das Tempo richtet sich nach der langsamsten Einheit. Slot-Zuweisung: Rolle → Projektion → Index. Ist ein Slot blockiert, fällt die Einheit auf einen individuellen Pfad zurück |
| Steering | Pfad, Flow oder Slot + Separation (≤ 8 Nachbarn) + Clearance-Gradient. Beschleunigungs- und Wendelimits (Ketten drehen auf der Stelle), Neigung bremst. Positionsbasierte Kollisionsauflösung nach Masse und Priorität, Arrival-Contagion, Idle-Nudge, Stuck (< ε über 20 Ticks) → Repath oder Ausweichen. Kein RVO/ORCA (Parameter aus SPK2) |
| Luft | kinematisch ohne Pathing: Mindesttempo, Wenderate, Bank, Flughöhe mit Lookahead. Interceptors verfolgen mit Lead, Gunships im Orbit, Bomber mit Anflug-, Abwurf- und Wende-FSM über K2. Weiche Separation im Air-Grid, Absturz als Falling-Entity |

### 3.9 Blueprints und Kartenformat

```ts
export default defineUnit({
  id: 'core:lnd_t1_tank', extends: 'core:base_land_t1',
  categories: ['LAND','MOBILE','DIRECTFIRE','TECH1'],
  sim: { health:{max:300}, economy:{mass:56, energy:280, buildTime:280, buildableBy:'FACTORY & LAND & TECH1'},
         motion:{layer:'land', speed:3.0, accel:2.5, turnRateDeg:90, sizeClass:1, footprint:[1,1], maxSlope:0.6},
         hitbox:[0.6,0.4,0.8], intel:{vision:20},
         weapons:[{ref:'core:wpn_cannon_t1', part:'turret', arcDeg:360, yawRateDeg:120, layers:['land'],
                   priorities:['MOBILE & LAND','STRUCTURE & DEFENSE','ALLUNITS']}],
         wreck:{massFraction:0.9, hpFraction:0.5}, deathWeapon:null, veterancy:'default',
         upgradesTo:null, behaviors:[], toggles:[] },
  view: { mesh:'units/tank_t1', lod:[60,180], placeholder:{hull:'box', turret:'cyl', size:[1,0.4,1.4]},
          icon:'land_direct_t1', iconThreshold:14, hotkeySlot:'Q', fx:{…}, sounds:{…},
          nameKey:'unit.core.lnd_t1_tank.name', descKey:'unit.core.lnd_t1_tank.desc' },
});
```

- **Typen:** `unit`, `weapon`, `projectile`, `prop`, `effect` (nur view), `faction`, `aiProfile`. Im Namespace `test:` gibt es Test-Blueprints (etwa `test:stall_consumer`), die nie im Spiel-Bundle landen.
- **Compiler:**
  1. Merge-Patches
  2. `extends` (Arrays per `id`, `null` löscht)
  3. TypeBox-Validierung plus Semantik: Referenzen, Layer, zyklusfreier Tech-Baum, i18n-Keys, Behavior- und Toggle-Registry, **Balancing-Gates** (z. B. Reichweite der T3-Artillerie ≤ 40 % der kleinsten Kartendiagonale)
  4. Kategorie-Ausdrücke → Masken
  5. Einheiten umrechnen
  6. IDs nach sortierter String-ID vergeben
  7. Ausgabe: `sim.bin`, `view.json`, `simHash`, `viewHash`, `bundle.json`
- Nur `simHash` geht in `simId` ein. Hot-Reload läuft über Vite-HMR → `ctl.devReload` → das Replay wird tainted.
- **Fraktion:** ca. 45–55 Blueprints, ein Modell pro Rolle, Tech-Varianten per Kitbash, Balancing nach FA-Relationen (DPS/Mass, HP/Mass).
- **`.rtsmap`:**
  - `META`: Größe, Höhenskala, Wasserspiegel, Starts, Mass- und Hydro-Spots, Licht, Strata
  - `HGT`: u16, (2ⁿ+1)²
  - `SPLT`: KTX2
  - `PROP`
  - `PREV`
  - `mapSimHash` umfasst die Sim-Felder aus META, HGT und PROP.
- **Werkzeuge:** Bis MS8 gibt es einen CLI-Import „Heightmap + JSON-Marker → .rtsmap“. Ab MS8 kommt der Marker-Editor (M12) für Spots, Starts und Prop-Felder.

### 3.10 KI

**Grenze:**
- Jeder KI-Spieler ist ein `CommandSource` im AI-Worker. Er liest nur `PerceptionView`, schreibt nur Commands, und die Commands landen im Replay.
- KI-Code darf Floats und eigenen RNG nutzen. KI-Patches brechen keine Replays.

**Tick-synchron:**
- Die KI denkt an festen Ticks `N ≡ 0 (mod thinkEvery)`: normal 5 (2 Hz), Micro ab Hard 2 (5 Hz).
- Sie sieht `Perception(N)` und liefert Commands für `N + lead` (lead = 3).
- Bis dahin antwortet die Quelle `'pending'`, und die Sim wartet. Im SP wirkt das wie FA-Sim-Lag, es werden keine Commands verworfen.
- Das **Budget zählt Operationen**, im Browser genauso wie headless. Die Wall-Clock dient nur als Notabbruch (`MARK aiTimeout`).
- Folge: Browser-KI und Headless-KI sind identisch, Turniere messen also dieselbe KI.
- Fallback bei ≤ 2 Kernen: `AiHost` läuft im Sim-Worker.

```ts
interface AiStatic { map: MapMeta; spots: Spot[]; passLowRes: Uint8Array; sectors: SectorGraphView; bps: BlueprintViewTable }
interface PerceptionView { tick: Tick; army: ArmyId; eco(): EcoState;
  forEachOwn(cat: CategoryMask, fn: (u: OwnUnit) => void): void;
  forEachKnownEnemy(cat: CategoryMask, fn: (u: KnownUnit) => void): void;   // sichtbar, Blips, Ghosts
  freeMassSpots(): readonly Spot[]; canPlace(bp: BpId, x: Fx, z: Fx, rot: u8): boolean }
interface AiBrain { init(s: AiStatic, p: AiProfile): void; think(v: PerceptionView, budget: OpBudget): EncodedCommand[] }
```

**Nicht cheatend per Konstruktion (A10):** Die Perception ist ein Profil des `FrameWriter` für die eigene Army.

| Manager | Takt | Aufgabe | Features / MS |
|---|---|---|---|
| OpeningScript | – | Eröffnung als Daten | A1 · MS9 (Vorläufer: Scripted Dummy-KI in MS6) |
| EconomyManager | 1 Hz | Mex-Expansion (Distanz × Threat), Energie-Ratio, Storage- und Adjacency-Templates, Mex-Upgrade per Amortisation, Stall-Prognose über 30 s | A1 MS9, A9 MS10 |
| TechManager | 1 Hz | T1 → T2 (MS9) → T3-Lite (MS13), generische Upgrades | A1, X4 |
| EngineerManager | 2 Hz | Task-Board, Base-Templates, Neuplanung abgelehnter Platzierungen | A1 |
| FactoryManager | 1 Hz | Konter-Tabelle über Kategorien, Air-Lite (MS12) | A1, A2 |
| PlatoonManager | 2 Hz | sammeln → angreifen → Rückzug bei lokalem Verhältnis < 0,7. MS9 mit **lokaler Stärke-Schätzung** (Kategorie-Summe im Radius), ab MS11 mit Threat-Grid | A2 |
| IntelManager | 1 Hz | Threat-/Influence-Grid (16 WU), Scout-Routen | A7 · MS11 |
| DefenseManager | 1 Hz | MS9 minimal (feste PD pro Mex-Cluster bei Angriff), MS11 voll (PD, AA, Schild, Artillerie an Threat-Spitzen) | A8 |
| Micro (ab Hard) | 5 Hz | Kiting, Focus Fire, Rückzug beschädigter Einheiten | A10 · MS14 |

- **Profile** beziehen sich auf Kategorien und Rollen, nie auf Unit-IDs.
- **Schwierigkeit:** Reaktionsverzögerung, APM-Cap, Micro, Planungstiefe, Fehlerrate.
- **AIx** ist ein Army-Modifier in der Sim.

### 3.11 Replays

- **Aufbau** `.rtsreplay` (Magic `RTSR`):

  | Chunk | Inhalt |
  |---|---|
  | `HEAD` | Versionen, `buildHash`, `simId` |
  | `GAME` | Setup, Seed, Armies, AIx |
  | `CMDS` | Blöcke à 600 Ticks, `deflate-raw` |
  | `HASH` | Hash alle 10 Ticks, Sub-Hashes alle 100 Ticks |
  | `MARK` | Pause, Speed, Taint, Cheat, aiTimeout |
  | `META` | Namen, Dauer, Ergebnis, Stats-Kurzfassung |

- **Größe** für 30 min 1v1: `CMDS` ≤ 100 KB, gesamt ≤ 250 KB.
- **Aufnahme:** Der Command-Log läuft ab MS1 fortlaufend im **OPFS** mit (übersteht einen Crash). Es bleiben die letzten N Spiele erhalten, Export als Download.
- **Wiedergabe:** über `ReplaySource`. Stimmt `buildHash` nicht, wird auf `/b/<buildHash>/` weitergeleitet, dort liegen Client und Sim des damaligen Builds.
- **Perspektive** per `ctl.viewer` (Army oder „alle“), kein Live-Observer.
- Die **Hash-Prüfung** läuft mit und warnt bei Abweichung mit Tick und Tabelle.
- **Seek:** Heap-Keyframes (Arena-`memcpy`, komprimiert) alle 60 s Spielzeit, adaptiv bis 128 MB. Rückwärts heißt: Keyframe wiederherstellen und nachsimulieren.

### 3.12 Tests und Determinismus

**Lint `sim/determinism`** (für `fixed`, `heap`, `nav`, `rules`, `sim`):
- Von `Math.*` sind nur `imul`, `floor`, `trunc`, `min`, `max`, `abs`, `sign` und `clz32` erlaubt, `sqrt` nur in `isqrt`.
- Verboten: `Math.random`, `Date`, `performance`, Timer, `async`, `for…in`, `**`, `Map`/`Set`/`Weak*` als State, `sort()` ohne Comparator, `Float32Array`.
- Float-Literale nur über `fx()`/`deg()`, `Float64Array` nur über `SafeInt`.
- Keine Importe aus `render`, `client` oder `ai`.

| Ebene | Inhalt | Wann |
|---|---|---|
| L0 Statik | TS strict, Branded Types, Lint, dep-cruiser, Lint gegen hartkodierte UI-Strings | Commit |
| L1 Unit/Property | Fx-Operationen gegen **BigInt-Orakel** (10⁶ Fälle), LUT-Hash, Fein-A\* gegen Dijkstra, HPA\*-Optimalitätsabstand, Eco-Summe = Kosten, Codec-Roundtrips | Commit |
| L2 Szenarien | `ScenarioBuilder {map, seed, spawns, commands@tick, asserts}`, Hash-Trail gegen Goldens, Update nur mit `--update` plus Diff | Commit |
| L3 Cross-Engine | **PR:** Node (V8) + Bun (JSC), 2.000 Ticks. **Nightly und vor jeder Meilenstein-Abnahme:** Node, Bun, Chromium, Firefox, WebKit, JIT kalt und warm, dazu KI-gegen-KI-Replays | PR / nightly |
| L4 Replay/Restore | Record → Replay ergibt gleichen Hash. Arena-Restore mitten im Spiel ergibt gleichen End-Voll-Hash | Commit |
| L5 Fuzz | ungültige und zufällige Commands; Invarianten: HP ≤ max, Positionen in der Karte, Pools konsistent, Eco ≥ 0 | nightly ab MS6 |
| L6 Performance | p50/p95/p99 **pro Phase** und **Hash-Tick**, im langsamsten Engine-Worker. +10 % → CI rot. Allokationstest warm hart, kalt mit Toleranz | PR |
| L7 E2E | Menü → Skirmish → Sieg → Score → Replay. Context-Loss. **Lauf ohne COOP/COEP.** Smoke, Frame-Zeit und Context-Loss auf dem **GPU-Runner** (Iris Xe/Windows und echtes Safari/macOS) | PR / nightly |
| KI-Qualität | Turniere mit **≥ 200 Spielen pro Gate** (headless, 20× parallel). Gate ist die **untere Grenze des 95-%-Konfidenzintervalls** bzw. Elo mit KI. Dazu Stall-Anteil, Idle-Engineer-Zeit, Nutzung von Luft und T3 | nightly |

**Werkzeuge:**
- `desync-diff`: erster abweichender Tick, dann per Voll-Dump Tabelle, Spalte und Entity.
- Dev-Konsole: Cheats als Commands, Overlays (Pfade, Flow, Sektoren, Clearance, Vision, Phasenbudget, Threat) und „Export scenario“ als `.scenario.ts`.

---

## 4. Frühe Spikes (Woche 1–7 von MS1, zeitlich begrenzt)

| Spike | Woche | Inhalt | Exit-Kriterium → Entscheidung | Abbruch |
|---|---|---|---|---|
| **SPK1 Sim-Durchsatz** | 1–4 | minimale SoA-Sim in TS: 1.000 Units mit Movement und Separation, gestaffeltes Targeting, 4.000 Projektile mit DDA, Vision-Stamp, 300 Flugzeuge, Hash. Gemessen in Node sowie in Firefox- und Safari-Workern, kalt und warm | p95 ≤ 25 ms in der **langsamsten** Engine inklusive Hash-Tick → alles bleibt TS | Verfehlt → Movement, Projectiles und Targeting ab MS1 in Rust/WASM auf derselben Arena (siehe §7, Entscheidung 2) |
| **SPK2 Bewegungsgefühl** | 1–6 | Wegwerf-Prototyp mit Float und Canvas2D: 200 Units über die Karte, Engstelle mit 3 WU, Roll-off an der Fabrik, Klumpen bei Attack-Move, Mauerlücke, Offset-Erhalt | alle Szenarien ohne Deadlock, Parameter festgelegt → Portierung auf Fx in MS3 | Nach 6 W nicht erreicht → Steering-Ansatz wechseln (ORCA-lite prüfen) **vor** MS3, Budget +2 W |
| **SPK3 Pathing realistisch** | 3–6 | Karten mit 512 und 1.024 WU, Klippen, FA-typische Basen. Verteilung der Expansionen, Repath-Rate im Basisbau und im Gefecht | HPA\* ist Standard, Repath-Strategie (Korridor-Schnitt) belegt: Pathing ≤ 5 ms/Tick p95 bei 200 Anfragen auf 1.024 WU | Repath-Sturm nicht beherrschbar → Pfad-Invalidierung nur beim Chunk-Eintritt plus Lazy-Repair |
| **SPK4 Render-Last** | 2–7 | 2.000 mehrteilige Units mit 3 LODs, 30.000 Props, CSM mit 2 Kaskaden, Splatmap mit 8 Layern, HDR und Bloom auf Iris Xe in Chrome, Firefox und echtem Safari | ≤ 250 Draws, Main-JS ≤ 5 ms, GPU ≤ 12 ms auf Medium bei Render-Scale 0,8 → Merged-Part und Presets fixiert | Verfehlt → Medium ohne CSM (Blob-Schatten), Splatmap auf 4 Layer, Props mit Impostor-Ring |
| **SPK5 Hash und Snapshot** | 2 | Arena mit 20 MB: xxHash32 in JS gegen WASM pro Engine, `memcpy`, Keyframe-Kompression | Hash-Tick ≤ 2 ms in der langsamsten Engine → Live-Bereich-Hash in JS | > 2 ms → Rolling-Hash oder WASM-xxh3 |
| **SPK6 Latenz** | 3 | Messkette „Klick → erster bewegter Pixel“ über beide Transports | ≤ 150 ms p95 → `inputDelay = 0`, Render-Delay adaptiv 0,5 Tick | > 150 ms → Client-Vorhersage nur für die erste Bewegung (visuell, nicht autoritativ) |
| **SPK7 KI-Loop** | in MS6 | tick-synchroner `CommandSource` mit `'pending'` am Beispiel der Scripted Dummy-KI, Wartehäufigkeit bei 3x | Die Sim wartet in < 1 % der Ticks bei 3x auf dem Referenz-Laptop → Architektur fix für MS9 | ≥ 1 % → `lead` erhöhen oder Perception per Diff, sonst KI-Takt reduzieren |

**Regel:** Kein Gameplay-System wird festgeschrieben, bevor SPK1 und SPK2 grün sind. SPK1–SPK6 zusammen dauern höchstens 7 W, teilweise parallel zur Skelett-Arbeit.

---

## 5. Meilensteine

**Durchgehende Regeln:**
- Determinismus-Vertrag und Command-Pipeline gelten ab dem ersten Commit, der Command-Log-Recorder läuft ab MS1.
- Jedes Sim-System bringt einen L6-Benchmark mit.
- **Definition of Done pro Meilenstein:**
  - Playwright-Demo-Pfad
  - ≥ 2 L2-Goldens
  - L0–L4 grün auf allen 5 Engines
  - Allokationstest
  - E2E ohne COOP/COEP
  - ab MS2 zusätzlich Context-Loss-Test und Messung auf dem GPU-Runner
- **FPS-Angaben** beziehen sich auf den Referenz-Laptop bzw. den GPU-Runner auf „Medium“.

### 5.1 Überblick

| MS | Titel | IDs | Kern/Opt | Wochen | kumuliert | Spielbar am Ende |
|---|---|---|---|---|---|---|
| MS1 | Spikes & deterministisches Skelett | 9 | 7/2 | 11–14 | 11–14 | 1.000 Würfel per Command, Hash auf 5 Engines gleich |
| MS2 | Terrain, Karte & Kamera | 9 | 8/1 | 8–11 | 19–25 | Karte mit Wasser und Spots anfliegen |
| MS3 | Bewegung, Selektion & Strategic Zoom | 7 | 7/0 | 16–21 | 35–46 | Einheiten auswählen, per HPA\* bewegen, Zoom bis zu den Icons |
| MS4 | Eco-Kern & Basisbau | 10 | 9/1 | 11–14 | 46–60 | ACU baut Mex und Pgens mit Flow und Stall |
| MS5 | Kampf-Kern, ACU & Reclaim | 9 | 8/1 | 14–18 | 60–78 | Gefechte im Fog, Wracks, ACU-Tod beendet das Match, Sound |
| MS6 | Mini-FA: Queue, Fabrik, Assist, OC | 9 | 6/3 | 11–14 | 71–92 | **vollständiger FA-Opening-Loop** gegen eine Script-KI |
| MS7 | Gefecht in Tiefe | 8 | 4/4 | 13–17 | 84–109 | finale Kampfphysik, T1-Armee, Big Battle |
| MS8 | Tech-Aufstieg, Verteidigung & Props | 11 | 7/4 | 14–18 | 98–127 | T1→T2, Verteidigung, Props, Marker-Editor |
| MS9 | Erstes Skirmish (**MVP-Kern komplett**) | 9 | 6/3 | 16–21 | 114–148 | Menü → 1v1 gegen die KI → Sieg oder Niederlage |
| MS10 | Eco-Tiefe, Radar & KI-Eco | 9 | 0/9 | 11–15 | 125–163 | Hydro, Adjacency, Radar, Prioritäten |
| MS11 | Kommandos, Übersicht & Replays | 8 | 0/8 | 10–14 | 135–177 | Patrol, Minimap, Veteranen, Replays |
| MS12 | Luftkrieg | 2 | 0/2 | 9–12 | 144–189 | Luftwaffe, AA, Abstürze, Luft-KI |
| MS13 | Schilde, T3, Artillerie & Massenbewegung | 5 | 0/5 | 12–16 | 156–205 | Schilde, T3, Formationen, Flow Fields |
| MS14 | Voll-MVP / Release-Kandidat | 7 | 0/7 | 13–20 | 169–225 | Schwierigkeitsgrade, Modi, Score, Grafik-Politur |
| | **Summe** | **112** | **62/50** | **169–225** | | |

### 5.2 Meilensteine im Detail

#### MS1 – Spikes & deterministisches Skelett (11–14 W)

**Ziel:** SPK1–SPK6 treffen die Risiko-Entscheidungen. Danach bewegt eine deterministische Sim im Worker per Command 1.000 Platzhalter, und der Renderer interpoliert sie.

**IDs:** S1, S2, S3, S4, S5, S7, S8, P1, A5

**Grundbausteine:**
- G11 (Armies, Allianzmatrix), G14 (FrameTransport, `UnitRecord`/`PartStream`, GPU-Interpolation), G20 (Monorepo, CI mit 5 Engines, COOP/COEP-Hosting, `/b/<buildHash>/`)
- `fixed`, `heap` (Arena = `WebAssembly.Memory`), `protocol`
- Scheduler, Headless-Runner, Command-Log-Recorder, Dev-Konsole (Spawn, Pause, Step, Phasenbudget)
- **Blueprint-Compiler-Skelett** (Schema, `simHash`/`viewHash`, Placeholder-Spec)
- **feste Testebene mit Ebenen-Picking und minimalem Instancing**

**Abnahme:**
- Hash-Kette über 2.000 Ticks bitgleich in Node, Bun, Chromium, Firefox und WebKit, JIT kalt und warm.
- L1: BigInt-Orakel ohne Abweichung in 10⁶ Fällen, LUT-Hash festgeschrieben. `fxMulSmall` stimmt im Debug-Build mit `fxMul` überein.
- L4: Log-Replay und Arena-Restore bei Tick 1.000 ergeben bei Tick 2.000 denselben Hash.
- 1.000 fahrende Würfel:
  - Sim p95 ≤ 2 ms im langsamsten Engine-Worker (inklusive Hash-Tick)
  - ≥ 60 FPS auf dem GPU-Runner
  - Main-JS ≤ 2 ms
- SAB- und Transfer-Transport liefern bytegleiche Frames, E2E läuft ohne COOP/COEP.
- Pause: Tick steht, Kamera und Command-Annahme laufen weiter.
- Latenz:
  - Klickmarker ≤ 1 Frame
  - Klick → erster bewegter Pixel ≤ 150 ms (p95)
  - `seq`-Bestätigung ≤ 100 ms
- Allokation warm < 1 MB über 10.000 Ticks.

**Risiko:** R1/R2 und ausufernde Grundlagenarbeit. **Gegenmaßnahme:** Zeitbox 14 W, Spikes mit hartem Abbruch.

#### MS2 – Terrain, Karte & Kamera (8–11 W)

**Ziel:** Eine Karte im eigenen Format lädt mit Heightmap, Wasser und Spots, die Kamera bewegt sich FA-typisch darüber.

**IDs:** M1, M2, M3, M4, C1, C11, P2, P3, P10

**Grundbausteine:**
- G15 (Screen↔World per Heightmap-Raymarch), G16 (Action-Mapping, Cursor-FSM, Fokusregeln DOM↔Canvas)
- Chunk-Container, **CLI-Import „Heightmap + JSON-Marker → .rtsmap“** (statt Marker-Editor)
- Asset-Worker. P3-Basis: glTF/meshopt, Manifest, Ladebildschirm, unkomprimierter Fallback. KTX2 und LOD-Generierung folgen in MS9.
- Ressourcen-Registry (P10)
- **Preset-Infrastruktur** (Caps, Render-Scale)
- CDLOD-Instancing mit einer Stufe und Chunk-Culling
- GPU-Runner in CI

**Abnahme:**
- 512-WU-Karte:
  - Laden ≤ 3 s aus dem Cache, ≤ 8 s kalt
  - Kameraflug mit 2.000 Platzhaltern ≥ 60 FPS bei ≤ 50 Draws (Iris Xe)
- Picking ≤ 1/16 WU daneben. Höhen auf CPU und GPU in 10.000 Stichproben identisch.
- Roundtrip CLI → Datei → Spiel → Datei bytegleich, `mapSimHash` stabil, unbekannte Chunks werden übersprungen.
- Context-Loss: Bild nach ≤ 2 s zurück, die Sim tickt weiter, Hash unverändert.
- Hotkeys über `KeyboardEvent.code` (DE/US), Kontextmenü unterdrückt, Pointer-Confinement im Fullscreen.
- WebKit-Smoke und echtes Safari grün.

**Risiko:** R6/R7 (iGPU, KTX2, Safari). **Gegenmaßnahme:** GPU-Runner und Textur-Fallback.

#### MS3 – Bewegung, Selektion & Strategic Zoom (16–21 W)

**Ziel:** Einheiten aus Blueprints lassen sich auswählen, gruppieren und ohne Stau per HPA\* bewegen. Der Strategic Zoom blendet stufenlos bis zur Gesamtkarte in Icons über.

**IDs:** S6, M5, M6, M7, C3, C7, C2

**Grundbausteine:**
- G5 (Kategorien), G7 (Order-Queue Move/Stop mit **Shift-Verkettung**, Stuck- und Unreachable-Handling), G8 (Kinematik), G19 (Decals im Terrain-FS)
- Compiler komplett mit HMR
- Clearance, Komponenten, Sektor/Portal-Graph, **HPA\***, Korridor-Repath, **Offset-Erhalt beim Gruppen-Move**
- MSDF-Atlas
- **Headless-Benchmark auf 1.024 WU**

**Abnahme:**
- 200 Units über die Karte:
  - alle fahren < 1 s nach dem Befehl los
  - ≥ 95 % kommen ohne Stuck > 3 s an
  - Offset-Golden (Anordnung bleibt erhalten)
- Engstelle mit 3 WU: 100 Units in ≤ 60 s ohne Deadlock.
- Fein-A\* kostet genau so viel wie Dijkstra (10.000 Fälle). HPA\* liegt ≤ 10 % über dem Optimum in ≥ 95 % der Fälle.
- **200 Einzelanfragen** auf einer 1.024-WU-Karte mit Hindernissen sind in ≤ 10 Ticks fertig, Pathing ≤ 5 ms/Tick p95. Ein Gruppenbefehl erzeugt genau eine Anfrage.
- Repath-Sturm-Test: 20 neue Footprints lösen nur für Pfade mit geschnittenem Korridor einen Repath aus.
- 1.000 fahrende Units: Sim p95 ≤ 8 ms.
- Strategic Zoom:
  - IconPass = 1 Draw
  - Übergang ≥ 60 FPS
  - Box-Select auf Icons trifft in ≥ 99 %
- HMR wirkt nach ≤ 1 s, der Log ist dann tainted.

**Risiko:** R3. **Gegenmaßnahme:** Parameter aus SPK2, Goldens ab Tag 1, wöchentliche Feel-Sessions.

#### MS4 – Eco-Kern & Basisbau (11–14 W)

**Ziel:** Ein ACU ohne Waffe baut Mex und Pgens auf einer Flow-Ökonomie mit anteiligem Stall. Command Card, Ressourcenleiste und UI laufen zweisprachig.

**IDs:** E1, E2, E3, E4, E5, E6, B1, C8, C10, P12

**Grundbausteine:**
- G3 (Bau-State-Machine), G17 (Preact-HUD, Binding mit 4–10 Hz)
- Economy-Phase mit Tiers, kumulativer Abrechnung und Hysterese
- `rules.canPlace` gemeinsam für Sim, Client und KI
- Footprint-Deltas an das Client-Replikat
- **`test:stall_consumer`** (Verbraucher mit `stallsOff`)
- **Hotbuild-Raster** (QWER/ASDF/ZXCV nach Slot, ohne Rebinding)
- i18n-Tabellen DE/EN plus Lint

**Abnahme:**
- Verbrauch = Kosten exakt (Property-Test, 10.000 Bauten mit zufälligem Stall).
- Bei 50 % Einkommen laufen alle Baustellen mit 50 % ± 1/65.536.
- Der `stallsOff`-Testverbraucher schaltet in ≤ 1 Tick ab, höchstens 1 Umschaltung pro 3 s.
- Ghost-Verdikt im Client stimmt in 100 % von 10.000 Platzierungen mit der Sim überein.
- Repath ≤ 2 Ticks, nur bei geschnittenem Korridor.
- HUD ≤ 1 ms Main-JS.
- Ein fehlender i18n-Key bricht den Build, keine hartkodierten Strings.

**Risiko:** Rundung und Stall-Verteilung, Umfang des UI-Frameworks. **Gegenmaßnahme:** Property-Tests, das HUD bindet nur an Frame-Sektionen.

#### MS5 – Kampf-Kern, ACU & Reclaim (14–18 W)

**Ziel:**
- Der ACU erhält Waffe und nukleare Death-Explosion.
- Per Konsole gespawnte T1-Einheiten kämpfen im Fog mit echten Projektilen und Splash.
- Wracks lassen sich reclaimen, und der ACU-Tod beendet das Match.
- Das Spiel hat erstmals Sound.

**IDs:** K1, K3, K4, K5, I1, U1, A4, E7, P7

**Grundbausteine:**
- G1 (Damage-Pipeline), G2 (Lifecycle, Kill-Credit), G9 (Waffen-Kern), G12 (einfacher Match-Lifecycle), G13 (Event-Stream), G18 (Merged-Part, Türme richten sich zunächst sofort aus)
- Relativ-Sweep und Terrain-DDA-Basis, Frame-Filterung aus Viewer-Sicht, Fog prev/cur, Row-Span-Vision
- ACU-Explosion mit Kamera-Shake (X4)
- P7: Voice-Manager, ca. 15 Platzhalter-SFX
- einfache Event-Sprites (die GPU-Partikel folgen in MS7)

**Abnahme:**
- Typische Last ≤ 10 ms p95 im langsamsten Worker.
- Dodge: stehendes Ziel ≥ 90 % Treffer, seitlich ausweichendes Ziel ≤ 50 %. Ein Ziel mit 5 WU/Tick wird nicht durchtunnelt (Golden).
- Byte-Test: keine gegnerischen Records außerhalb der Sicht.
- Der ACU-Tod beendet das Spiel in ≤ 1 Tick, Explosionsschaden als Golden.
- Reclaim-Ertrag entspricht exakt dem Blueprint-Anteil.
- Audio:
  - ≤ 32 Stimmen
  - ≤ 0,5 ms Main-JS
  - Ack-Sound ≤ 1 Frame nach dem Klick
- VFX ≤ 1 Frame neben der Render-Zeit.

**Risiko:** R2. **Gegenmaßnahme:** Staffelung, Phasen-Benchmarks.

#### MS6 – Mini-FA: Queue, Fabrik, Assist & Overcharge (11–14 W)

**Ziel:** Der vollständige FA-Opening-Loop steht:
- ACU-Opening per Shift-Queue mit geteilten Bau-Ghosts
- Landfabrik mit Queue, Repeat und Rally
- T1-Engineers, Assist und Factory-Guard
- Overcharge gegen Rushes, fortsetzbare Baustellen
- Gegner ist eine Scripted Dummy-KI.

**IDs:** B2, C4, C5, B3, B6, U8, C9, C14, U2

**Grundbausteine:**
- G4 (Repair), G10 (Roll-off)
- `BuildIntents`
- **Scripted Dummy-KI als `CommandSource`** (Träger von SPK7)
- L5-Fuzz ab hier nightly

**Abnahme:**
- Fabrik: +1, Shift +5, Repeat. 50 Units laufen ohne Blockade vom Band (Golden).
- 20 Ghosts in der Queue, Übernahme per Assist, der Ghost verschwindet bei Baubeginn.
- Factory-Guard addiert BP dauerhaft (Golden). Assist halbiert die Bauzeit, 50 % ± 1 Tick (Golden).
- OC-Kosten und -Schaden folgen der Formel über die gespeicherte Energie (Golden).
- Eine Baustelle ist nach dem Engineer-Tod per Assist oder Repair fortsetzbar (Golden).
- Kontext-Rechtsklick ist in der Testmatrix zu 100 % korrekt.
- L5: 10⁶ Commands ohne Queue-Korruption.
- SPK7-Exit erreicht.
- Feel-Test mit 3 Testern: Das Opening mit ≥ 8 gequeueten Orders läuft ohne Bedienfehler.

**Risiko:** Kombinatorik der Orders (G7). **Gegenmaßnahme:** Fuzz, Szenario-Export für jeden Bug.

#### MS7 – Gefecht in Tiefe (13–17 W)

**Ziel:** Die Kampfphysik ist final, bevor irgendetwas gebalanced wird: Ballistik, Bodenangriff und Feuermodi, Blocking durch Terrain und Wracks, Friendly Fire, Turrets mit Drehrate und Arcs, Ghost-Buildings, die vollständige T1-Armee und GPU-Partikel.

**IDs:** K2, K6, K7, K8, K9, I2, U4, P5

**Grundbausteine:**
- Partikel-Ring
- Scorch-Decals im Terrain-FS

**Abnahme:**
- Big Battle ≤ 25 ms p95 im langsamsten Worker inklusive Hash-Tick.
- 2×200 mit Partikeln ≥ 60 FPS, der Cap greift.
- Artillerie: Streukreismittelpunkt ≤ 1 WU neben dem Ziel.
- K7: Hügel und Wrack blockieren Schüsse (Goldens).
- K8: Splash trifft eigene Einheiten (Golden).
- K9: Turret mit 90°/s trifft ein Ziel im Rücken frühestens nach 2 s (Golden).
- Attack-Ground und Hold Fire funktionieren.
- Ghosts bleiben bis zur erneuten Sichtung erhalten (Byte-Test).
- „200 vs. 200“ bitgleich auf 5 Engines.

**Risiko:** R2. **Gegenmaßnahme:** Spätestens hier fällt die Entscheidung über den WASM-Ausweg für Hotpaths.

#### MS8 – Tech-Aufstieg, Verteidigung & Props (14–18 W)

**Ziel:**
- T1→T2 per In-Place-Upgrade, T2-Armee inklusive MML
- PD, AA, SAM und Mauern
- Range-Ringe, Attack-Move, Bau- und Reclaim-Effekte
- Map-Props mit Reclaim und Marker-Editor für die echten Karten

**IDs:** U5, U6, B4, B5, U7, C6, C15, P6, K11, E8, M12

**Grundbausteine:**
- X4/B8: generisches `upgradesTo`
- statisches Prop-Grid, instanzierte Props mit Distanz-Fade
- M12 als zweite Vite-App **inklusive Prop-Feldern**

**Abnahme:**
- Der Mex produziert während des Upgrades lückenlos weiter, Assist beschleunigt linear.
- Mauerlücke ohne Deadlock.
- Unit-Cap 500 lehnt Befehle mit UI-Hinweis ab.
- K11: Ein wendiges Ziel senkt die Trefferquote um ≥ 30 %.
- 50 Range-Ringe < 0,3 ms GPU. 20 Baustellen mit Dissolve und Nano-Beams ≤ 1 ms GPU.
- 30.000 Props ≥ 60 FPS, der Benchmark „30k-Prop-Reclaim“ bleibt bei ≤ 10 ms Sim.
- M12-Roundtrip inklusive Props bytegleich.
- Attack-Move als Golden.

**Risiko:** Content-Wachstum, Prop-Performance. **Gegenmaßnahme:** Kitbash, Prop-Grid statisch.

#### MS9 – Erstes Skirmish: MVP-Kern komplett (16–21 W)

**Ziel:** Vom Menü aus spielt man ein 1v1 auf 3 Karten gegen eine nicht cheatende KI bis zum ACU-Tod. Der Content ist lesbar und gebalanced, dazu kommen Alerts, Splatmap und Grundlicht.

**IDs:** A1, A2, A3, M8, P4, U3, S9, P8, M9

**Grundbausteine:**
- G12 vollständig (Menü, Aufgeben, zurück ins Menü)
- AI-Worker mit tick-synchroner `PerceptionView`
- Manager Opening, Economy, Tech (bis T2), Engineer, Factory, Platoon (mit lokaler Stärke-Schätzung)
- **Minimal-A8** (feste PD pro Mex-Cluster bei Angriff)
- P3 abgeschlossen (KTX2, LOD-Generierung)
- **P11-Vorgriff:** Grundlicht plus ACES

**Abnahme:**
- Die KI erreicht T2 in ≤ 12 min in ≥ 90 % der Spiele (≥ 200 headless, 3 Karten). Erste Welle ≤ 8 min.
- Rückzug bei geschätztem Verhältnis < 0,7 (Szenario).
- KI gegen KI über 30 min:
  - kein Crash
  - **Command-Log-Replay** bitgleich auf 5 Engines
  - Idle-Engineer-Zeit < 15 %
- Browser-KI und Headless-KI erzeugen für denselben Seed denselben Command-Strom.
- Die Perception enthält nichts außerhalb der Sicht (Byte-Test), das Sim-Budget bleibt durch die KI unverändert.
- Endphase mit 2×300 Einheiten: ≥ 60 FPS, Sim p95 ≤ 15 ms.
- Content:
  - ca. 25–30 Blueprints mit **lesbaren Silhouetten und finalen Strategic Icons**
  - Namen auf DE und EN
  - DPS/Mass und HP/Mass innerhalb von ±25 % der FA-Relation
- Hintergrund-Tab pausiert ≤ 1 Tick nach `visibilitychange`. Alerts ≤ 1 s nach dem Ereignis.
- Splatmap: High mit 8 Layern ≤ 1,5 ms, Medium mit 4 Layern.
- Playtest mit 5 Testern: Median der Matchdauer ≥ 12 min, kein reproduzierbarer Exploit (Raids eingeschlossen).

**Risiko:** R4. **Gegenmaßnahme:** Kategorie-Profile, Turniere mit Konfidenzintervallen, Engine-Freeze in den letzten 3 W.

#### MS10 – Eco-Tiefe, Radar & KI-Eco (11–15 W)

**IDs:** E9, E10, E11, E12, E13, I3, C17, K14, A9

**Grundbausteine:**
- G6 (Modifier)
- Radar T1→T2 über `upgradesTo`, Blip-Jitter
- Toggles für Radar und Auto-OC
- K14 als Daten plus Kettenreaktions-Golden (die Mechanik existiert seit MS5)

**Abnahme:**
- Adjacency: exakt nach Blueprint (Golden), unabhängig von der Bau-Reihenfolge (Property-Test).
- Radar:
  - Blips jittern innerhalb des Blueprint-Radius
  - Blip-Records verraten nie den Blueprint (Byte-Test)
  - Stall schaltet Radar ab, Wiedereinschalten mit Hysterese
- Auto-OC feuert nie bei zu wenig Energie.
- Pgen-Kettenreaktion bitgleich auf 5 Engines.
- Pausierte Baustellen verbrauchen nichts, Prioritäten verteilen korrekt.
- KI:
  - Stall-Anteil ≤ 5 %
  - Mex-Upgrades nach Amortisation
  - Siegquote gegen die MS9-KI: untere KI-Grenze ≥ 60 % (≥ 200 Spiele)

**Risiko:** KI-Eco-Planung, Balancing-Kaskaden. **Gegenmaßnahme:** Templates, Turnier-Gates.

#### MS11 – Kommandos, Übersicht & Replays (10–14 W)

**IDs:** C12, C16, C18, U9, A6, N1, A7, A8

**Grundbausteine:**
- Replay-Container, Keyframes, Replay-Browser
- Threat-Grid, IntelManager, DefenseManager voll

**Abnahme:**
- Replay:
  - 30 min 1v1: `CMDS` ≤ 100 KB, gesamt ≤ 250 KB
  - bitgleich auf 5 Engines
  - Rückwärts-Seek ≤ 2 s
  - Wiedergabe ≥ 5x im Browser, ≥ 20x headless
- Tab-Kill bei Minute 10 → Replay bis mindestens 9:50 vorhanden.
- Das Golden-Replay aus MS9 läuft über `/b/<buildHash>/`.
- Bei 3x und typischer Last kein Tick-Rückstand.
- Patrol-Engineer reclaimt 10 Wracks ohne weiteren Befehl.
- Minimap: 4 Hz, ≤ 0,5 ms Main-JS.
- Veteranen-Golden, Self-Destruct.
- KI:
  - Scout erreicht die Gegnerbasis in ≤ 4 min
  - PD/AA entstehen ≤ 60 s nach einem Raid
  - Siegquote gegen die MS10-KI: untere Grenze ≥ 55 %

**Risiko:** Replay-Kompatibilität. **Gegenmaßnahme:** versionierte Builds, Opcodes nur anhängen, Golden-Replays in CI.

#### MS12 – Luftkrieg (9–12 W)

**IDs:** U11, K12

**Grundbausteine:**
- Luftfabrik T1→T2, `AirMovers`, Air-Grid, Falling-Entities
- **Näherungszünder** für Flak und SAM, Luft-Vision auf 4-WU-Grid
- **Air-Lite-KI**, Luft-Sounds
- kein Torpedobomber

**Abnahme:**
- 300 Flugzeuge + 500 Bodeneinheiten: ≤ 15 ms p95 im langsamsten Worker, ≥ 60 FPS.
- „Luftangriff gegen Flak“ bitgleich auf 5 Engines.
- Bomber treffen eine stehende Struktur in ≥ 80 % der Anflüge.
- Absturz verursacht Bodenschaden (Golden).
- **Rest-Abnahme U4, U6 und B5:** Mobile AA, Flak und AA-Türme wirken nachweislich.
- KI:
  - AA-Quote ≥ 20 % innerhalb von ≤ 90 s bei ≥ 5 Feindflugzeugen
  - Bomber-Snipe (10 Bomber): Der ACU überlebt in ≥ 70 % (≥ 200 Läufe)

**Risiko:** Flugmodell und Luft-KI unterschätzt. **Gegenmaßnahme:** kinematisches Modell, Snipe-Gate.

#### MS13 – Schilde, T3, Artillerie & Massenbewegung (12–16 W)

**IDs:** K10, U10, K13, C13, M10

**Grundbausteine:**
- **T3-Lite-KI**, Schild-Shader
- Daten-Nachlieferung:
  - mobiler Schild (Rest U6)
  - T3-Engineer (Rest U2)
  - T3-Mex (Rest B4)
  - T3-Pgen
  - T3-Radar (Rest I3)
  - Schild-Toggle (Rest C17)
- Balancing-Gate für die Artillerie-Reichweite

**Abnahme:**
- „Energy-Stall stoppt Schild“, Kollaps und Wiederaufbau nach Blueprint-Zeit (Goldens).
- 20 Schilde ≤ 1 ms GPU.
- Die Reichweite der T3-Artillerie liegt über 40 % der Kartendiagonale → Build schlägt fehl.
- C13:
  - 50 gemischte Einheiten kommen mit ≤ 5 s Spreizung an
  - Tempo = langsamste Einheit
  - Slot-Golden
- M10:
  - 500 Einheiten = 1 Anfrage
  - Pathing ≤ 5 ms/Tick
  - Flow Field auf 1.024² im Budget
  - „200 Einheiten über die Karte“ nicht schlechter als in MS3
- Alle Bewegungs-Goldens sind grün.
- KI erreicht T3 in ≥ 80 % der Spiele in ≤ 25 min und setzt T3-Artillerie ein.

**Risiko:** R3/R8. **Gegenmaßnahme:** Flow Fields erst ab 12 Einheiten und ohne Formation, Tabellen-Export.

#### MS14 – Voll-MVP / Release-Kandidat (13–20 W)

**IDs:** A10, A11, A12, A13, P9, P11, M11

**Zusätzlich:**
- finales Balancing von 45–55 Blueprints, echte Assets, 60–100 SFX
- CDLOD mit allen Stufen und Geomorphing
- CSM mit statischem Cache, Bloom, HDR
- **eine 1.024-WU-Karte als spielbare Zusatzkarte**
- Perf-Lab

**Abnahme:**
- Turniere mit ≥ 200 Spielen pro Paarung, untere KI-Grenze:
  - Hard schlägt Normal ≥ 65 %, Normal schlägt Easy ≥ 65 %
  - AIx 1,5 schlägt Hard ≥ 75 %
- Supremacy und Annihilation als Goldens.
- Score-Screen stimmt exakt mit den Sim-Stats überein.
- Autodetect wählt auf dem Referenz-Laptop „Medium“.
- Big Battle: ≥ 60 FPS Medium auf Iris Xe, ≥ 30 FPS Low auf UHD 620.
- CSM mit 2 Kaskaden ≤ 2,5 ms.
- 20-km-Karte ≥ 60 FPS ohne Popping, Sim ≤ 25 ms.
- Gesamtabnahme:
  - alle Gates aus MS1–MS13 grün
  - ≥ 200 nächtliche KI-Spiele ohne Desync
  - L7 grün in Chromium, Firefox, WebKit und echtem Safari
  - 0 Platzhalter

**Risiko:** R8/R6. **Gegenmaßnahme:** ein Modell pro Rolle, Presets, Render-Scale. Die obere Spanne ist Puffer.

### 5.3 Teilabnahmen (ID ist im Haupt-Meilenstein gezählt, der Rest ist ausdrücklich terminiert)

| ID | Tier | Haupt-MS (abgenommen) | Rest | Rest-MS |
|---|---|---|---|---|
| U2 | Kern | MS6 (T1), MS8 (T2 als Daten) | T3-Engineer | MS13 |
| U4 | Kern | MS7 | Wirkung der mobilen AA gegen Luft | MS12 |
| U6 | Kern | MS8 (inkl. MML über K11) | Wirkung der Flak / mobiler Schild | MS12 / MS13 |
| B5 | Kern | MS8 (PD, Mauern, SAM) | Wirkung der AA-Türme gegen Luft | MS12 |
| B4 | Kern | MS8 (Mex T1→T2, generisch) | Mex T3 | MS13 |
| P3 | Kern | MS2 (Loader, Manifest, Ladebildschirm) | KTX2, LOD-Generierung | MS9 |
| U3 | Kern | MS9 (25–30 BP, Silhouetten, Icons) | 45–55 BP, 0 Platzhalter | MS14 |
| E3 | Kern | MS4 (mit Test-Verbraucher) | echte Verbraucher Radar / Schild | MS10 / MS13 |
| I3 | Opt | MS10 (T1→T2) | T3-Radar | MS13 |
| C17 | Opt | MS10 (Radar, Auto-OC) | Schild-Toggle | MS13 |

Der **MVP-Kern ist nach MS9 vollständig zugeordnet und spielbar**. Funktional ist er erst nach MS13 zu 100 % abgenommen, weil U2, U4, U6, B4 und B5 Reste in MS12 und MS13 haben.

**Vorgriffe ohne ID-Wechsel:**
- Preset-Infrastruktur in MS2 (P9 in MS14)
- Grundlicht und ACES in MS9 (P11 in MS14)
- Minimal-A8 in MS9 (A8 in MS11)
- Mechanik der Death-Weapons in MS5 (K14 in MS10)
- Scripted Dummy-KI in MS6 (A1 in MS9)

### 5.4 Kritischer Pfad (aus `depends_on` generiert, Gewichte S=1, M=2, L=4)

```
S1 → S2 → K1 → K5 → E7 → C4 → C5 → B3 → U5 → A1 → A2        (Kern, Gewicht 30; MS1 → MS5 → MS6 → MS8 → MS9)
                                            └→ A7 → A8        (gesamt, Gewicht 34; → MS11)
Parallelstränge: M1 → M5 → M6 → A1 (MS2 → MS3 → MS9) · P1/P3 → P2 → C2/P5 · E1 → E2 → {E7, B2, U1}
```

Mit einer zweiten Person lassen sich MS10 ∥ MS11 und MS12 ∥ MS13 größtenteils parallelisieren. Assets und SFX laufen ab MS7 ohnehin parallel.

---

## 6. ID-Abdeckung

Per Skript gegen `/private/tmp/claude-501/-Users-logge-Documents-Projects/a09a8125-e912-48de-9c10-97d65bb48e68/tasks/wo77m6so5.output` (`.result.categories[].features[]`) verifiziert. Skript: `/private/tmp/claude-501/-Users-logge-Documents-Projects/a09a8125-e912-48de-9c10-97d65bb48e68/scratchpad/final_chk.py`.

**Tier-Verteilung in der Datei:** 62 MVP-Kern, 50 MVP-optional, 43 Post-MVP, 21 Später/Nice-to-have (176 gesamt).

**Prüfergebnis:**

| Prüfung | Ergebnis |
|---|---|
| MVP-IDs im Plan | **112/112** |
| fehlend | 0 |
| doppelt | 0 |
| Nicht-MVP-IDs im Plan | 0 |
| explizite `depends_on`-Kanten zwischen MVP-Features | 169 |
| Verletzungen (Abhängigkeit in einem späteren MS) | **0** |
| MVP-Features mit Abhängigkeit außerhalb des MVP | 0 |
| letzte Kern-ID | MS9 |

**Audit-Korrekturkanten:**
- Erfüllt: U11 → B3/U5 (MS12 ≥ MS6/MS8), K13 → I3 (MS13 ≥ MS10), A1 → I1 (MS9 ≥ MS5), C6 → M6 (MS8 ≥ MS3).
- Über Teilabnahmen gelöst (§5.3): U6 → K10 und B5 → U11.
- Gestrichen: U6 → I5 (Stealth-Support, V1).

**Grundbausteine G1–G20** sind je genau einmal zugeordnet:

| MS | Bausteine |
|---|---|
| MS1 | G11, G14, G20 |
| MS2 | G15, G16 |
| MS3 | G5, G7, G8, G19 |
| MS4 | G3, G17 |
| MS5 | G1, G2, G9, G12, G13, G18 |
| MS6 | G4, G10 |
| MS10 | G6 |

**X4-Nachträge:** B8 (generisches Upgrade) in MS8, ACU-Explosion in MS5, Air-Lite in MS12, T3-Lite in MS13. Keiner davon wird als eigene ID gezählt.

**Zuordnung:**

| MS | IDs | Kern/Opt |
|---|---|---|
| MS1 | S1 S2 S3 S4 S5 S7 S8 P1 A5 | 7/2 |
| MS2 | M1 M2 M3 M4 C1 C11 P2 P3 P10 | 8/1 |
| MS3 | S6 M5 M6 M7 C3 C7 C2 | 7/0 |
| MS4 | E1 E2 E3 E4 E5 E6 B1 C8 C10 P12 | 9/1 |
| MS5 | K1 K3 K4 K5 I1 U1 A4 E7 P7 | 8/1 |
| MS6 | B2 C4 C5 B3 B6 U8 C9 C14 U2 | 6/3 |
| MS7 | K2 K6 K7 K8 K9 I2 U4 P5 | 4/4 |
| MS8 | U5 U6 B4 B5 U7 C6 C15 P6 K11 E8 M12 | 7/4 |
| MS9 | A1 A2 A3 M8 P4 U3 S9 P8 M9 | 6/3 |
| MS10 | E9 E10 E11 E12 E13 I3 C17 K14 A9 | 0/9 |
| MS11 | C12 C16 C18 U9 A6 N1 A7 A8 | 0/8 |
| MS12 | U11 K12 | 0/2 |
| MS13 | K10 U10 K13 C13 M10 | 0/5 |
| MS14 | A10 A11 A12 A13 P9 P11 M11 | 0/7 |
| **Summe** | **112** | **62/50** |

---

## 7. Offene Entscheidungen für den Nutzer

| # | Entscheidung | Optionen | Empfehlung |
|---|---|---|---|
| 1 | **Reihenfolge: früher FA-Loop oder früheres KI-Skirmish** | (a) neue Reihenfolge: Eco ab W 46–60, Mini-FA-Loop ab W 71–92, KI-Skirmish nach W 114–148, Balancing nur einmal auf finaler Kampfphysik. (b) alte Reihenfolge: KI-Skirmish nach W 94–127, dafür K7/K8/K9/OC/Props später mit doppeltem Balancing und doppelten Goldens | **(a).** Das Spielgefühl wird früh geprüft, und nach dem Skirmish muss nichts neu gebalanced werden. |
| 2 | **Rust/WASM als Ausweg**, falls SPK1 das Tick-Budget verfehlt | (a) vorab zustimmen: Hotpaths (Movement, Projectiles, Targeting) in Rust auf derselben Arena, ca. +3–6 PW. (b) reines TS, dafür Caps und Big-Battle-Ziel senken | **(a) vorab zustimmen**, damit SPK1 ohne Wartezeit entscheiden kann. Durch Q20.12 ist das bitgleich portierbar. |
| 3 | **Mauern ohne Drag-Build** (B7 ist Post-MVP) | (a) Minimal-Drag-Linie nur für Strukturen mit `wall`-Flag in MS8, ca. 0,5–1 PW. (b) Mauern aus dem MVP-Content streichen (B5 bleibt mit PD und AA erfüllt) | **(a).** Einzeln geklickte Mauern sind praktisch unbrauchbar, die Linie ist billig. |
| 4 | **Area-Reclaim (E14, Post-MVP, Komplexität S)** ins MVP ziehen | (a) zusammen mit E8 in MS8, ca. 1 PW. (b) Post-MVP | **(a).** Bei bis zu 30k Props ist Einzelklick-Reclaim ein Klickmarathon, und das ist der billigste QoL-Gewinn im FAF-Sinn. |
| 5 | **Hardware für GPU-CI und Perf-Lab** | (a) self-hosted Runner: Mini-PC mit Iris Xe, ein Gerät mit UHD 620 und ein Mac für Safari. (b) nur SwiftShader und headless (Render-Kriterien wären dann nicht prüfbar) | **(a), ab MS2.** Ohne echte Hardware sind alle FPS- und GPU-Gates Fiktion. |

---

## 8. Umgang mit den Review-Punkten

**Review Reihenfolge und Abhängigkeiten**

| Punkt | Umsetzung |
|---|---|
| H1 K7/K8 früher | **übernommen** (MS7, vor dem Balancing) |
| H2 K9 früher | **übernommen** (MS7) |
| H3 K11 früher | **übernommen** (MS8, zusammen mit U6 und B5) |
| H4 Teilabnahmen | **übernommen** (§5.3). U2 steht ausdrücklich als Kern-ID mit Rest in MS13. M12 kommt erst in MS8, dort mit Prop-Feldern |
| H5 Namenskollision | **übernommen** (MS1–MS14, SPK1–SPK7) |
| M-1 Blueprint-Compiler früher | **übernommen** (Compiler-Skelett in MS1, komplett in MS3) |
| M-2 i18n früher | **übernommen** (P12 in MS4 mit G17) |
| M-3 `stallsOff` nicht prüfbar | **übernommen** (`test:stall_consumer`) |
| M-4 frühes Match | **übernommen** (A4/G12 in MS5, Scripted Dummy-KI in MS6) |
| M-5 Audio früher | **übernommen** (P7 in MS5, P8 in MS9) |
| M-6 Art erst nach Look-Features | **übernommen** (M9 und Grundlicht/ACES in MS9, CSM und Bloom in MS14) |
| M-7 20-km-Benchmark früher | **übernommen** (headless in MS3) |
| M-8 Presets früher | **übernommen** (Infrastruktur in MS2) |
| M-9 Radar T3 vor T3-Tech | **übernommen** (T3-Radar in MS13) |
| M-10 Rückzug ohne Threat-Map | **übernommen** (lokale Stärke-Schätzung in MS9) |
| N-1 bis N-7 | **alle übernommen**: S9 in MS9, Footprint-Frage durch B1 in MS4 erledigt, B6 in MS6, K14 als Daten, Command-Log-Replay als MS9-Kriterium, kritischer Pfad per Skript generiert, Ebenen-Picking in MS1 |

**Review technisches Risiko**

| Punkt | Umsetzung |
|---|---|
| 1 Tick-Budget spät geprüft | **übernommen** (SPK1, Budgets für die langsamste Engine, Arena = `WebAssembly.Memory`) |
| 2 Hash sprengt p95 | **übernommen** (Live-Bereiche, abgeleiteter State nur im Voll-Hash, Refcount nur für echte Teams, SPK5, Hash-Tick als KPI) |
| 3 Draw Calls | **übernommen** (Merged-Part, `PartStream` mit bis zu 8 Parts, `multi_draw`, statischer CSM-Cache, SPK4) |
| 4 KI hängt von der Wall-Clock ab | **übernommen** (tick-synchroner `CommandSource`, Operationsbudget, 5 Hz ab Hard, SPK7). Einzige Abweichung: Bei `'pending'` verlangsamt sich die Sim wie bei FA-Sim-Lag, statt nach einem Timeout ohne KI-Commands weiterzulaufen, so bleiben Browser- und Headless-KI gleich |
| 5 Pathing im Maßstab | **übernommen** (HPA\* ab MS3, Korridor-Repath, Kurzwege ohne A\*, Abnahme als Einzelanfragen) |
| 6 Input-Latenz | **übernommen** (`inputDelay = 0`, adaptiver Render-Delay, SPK6) |
| 7 Projektil-Tunneling | **übernommen** (Relativ-Sweep, Näherungszünder, Terrain-DDA) |
| 8 Replay-Versionierung | **übernommen** (ganzer Build unter `/b/<buildHash>/`) |
| 9 iGPU-Budget | **übernommen** (Medium mit Render-Scale 0,8 und 4 Splat-Layern) |
| 10 CI ohne echte GPU | **übernommen** (GPU-Runner, siehe §7, Entscheidung 5) |
| 11 `fxMulSmall` läuft still über | **übernommen** (`FxSmall`, Debug-Vergleich) |
| 12 zu dünne KI-Statistik | **übernommen** (≥ 200 Spiele, Konfidenzintervall bzw. Elo) |
| 13 Vision-Stamping teuer | **übernommen** (Row-Span-Delta, Luft-Vision auf 4-WU-Grid) |
| 14 kalte JIT-Stufen allozieren | **übernommen** (Allokationstest warm/kalt getrennt) |
| 15 NaN/−0 im Hash | **übernommen** (`SafeInt` normalisiert) |
| 16 Replay-Ziel unrealistisch | **übernommen** (≤ 250 KB gesamt) |
| 17 Interpolations-Artefakte | **übernommen** (`noInterp`) |
| 18 Decals schweben | **übernommen** (Decals im Terrain-FS) |
| 19 COEP bricht Embeds | **übernommen** (`credentialless` wird geprüft) |
| CI-Kosten der 5 Engines | **teilweise übernommen**: PR läuft auf V8 und JSC, alle 5 Engines nightly **und als Pflicht-Gate jeder Meilenstein-Abnahme** |

**Review Spielgefühl**

| Punkt | Umsetzung |
|---|---|
| 1 Vertical Slice | **übernommen in angepasster Form**: Eco in MS4, Kampf in MS5, Mini-FA in MS6, Marker-Editor und volle P3 nach hinten. Das Ziel „W 55–70“ ist wegen harter Kanten (C4 → E7 → K5 → K1) und der Spikes nicht ganz erreichbar, realistisch sind W 71–92 für den vollständigen Loop |
| 2 Kampf vor Wirtschaft | **übernommen** (Eco jetzt vor dem Kampf, Big-Battle-Gate erst in MS7) |
| 3 C5 früher | **übernommen** (MS6 mit B3, Shift für Moves in MS3) |
| 4 Sound früher | **übernommen** (P7 in MS5) |
| 5–7 K7/K8/K9 früher | **übernommen** (MS7) |
| 8 OC früher | **übernommen** (MS6) |
| 9 Props früher | **übernommen** (MS8) |
| 10 Range-Ringe früher | **übernommen** (C15 in MS8, zusammen mit PD und AA) |
| 11 Klumpen beim Gruppen-Move | **übernommen** (Offset-Erhalt in MS3) |
| 12 Mauern ohne Drag | **→ offene Entscheidung 3** |
| 13 KI ohne Verteidigung | **übernommen** (Minimal-A8 in MS9) |
| 14 Art-Gate zu streng | **übernommen** (Silhouetten und Icons in MS9, 0 Platzhalter erst in MS14) |
| 15 Attack-Ground früher | **übernommen** (K6 in MS7) |
| 16 Hotbuild | **übernommen als festes Raster ohne Rebinding** (C8, MS4). C20 bleibt Post-MVP |
| 17 Patrol | **bleibt in MS11** |
| Post-MVP-Liste | **als Priorisierung notiert**, nicht im Plan. E14 → offene Entscheidung 4. Die 20-km-Karte wird **nicht** in MS10 spielbar (braucht M11 aus MS14), sondern als Zusatzkarte in MS14 |

**Verworfen:**
- Nur ein Punkt ganz: die Annahme, 5 Engines pro PR seien nötig. Sie bleiben Nightly- und Meilenstein-Gate.
- Nur in Teilen: das Ziel „W 55–70“ für den ersten FA-Loop, siehe oben.