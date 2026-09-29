# P1-heap-protocol – `@faf/heap` und `@faf/protocol` (MS1, Welle 1)

Fortsetzung eines abgebrochenen Laufs: `packages/heap` war vollständig vorhanden und wurde geprüft und übernommen,
`packages/protocol` hatte Ops/Commands/Payloads/Ctl/Frame/simId ohne Einstieg, ohne Transport und ohne Tests.
Ergänzt wurden `src/transport/**`, der Paket-Einstieg, Ctl-Parser für `init`/`cmd` sowie alle Protokoll-Tests.

## Umgesetzt

### `@faf/heap` (PLAN §2 „Sim-Speicher“, §3.5) – Dep nur `@faf/fixed`

- **Arena** (`src/arena.ts`): `ArenaBuilder` mit `addTable`, `addDense`, `addSlab`, `addRegion`; jede Region mit
  `area: 'dynamic' | 'static'` und `derived` (nur dynamisch). `build()` platziert deterministisch:
  `[dynamische Regionen in Registrierungsreihenfolge][statische Regionen][Padding auf 64-KiB-Page]`, jeder Teil
  (Header, Freelist, Spalte, …) 8-Byte-aligned. Genau **eine** `WebAssembly.Memory` mit `initial == maximum`
  (kein Grow; `lib: ES2022` kennt `WebAssembly` nicht → strukturelles Interface in `src/wasm.ts`).
  API: `memory`, `bytes`, `pages`, `byteLength`, `dynamicStart/dynamicEnd`, `staticStart/staticEnd`,
  `layoutHash`, `layoutText`, `regions` (Layout-Beschreibung für desync-diff), `snapshotByteLength`,
  `snapshot(target?)` (mit `target` allokationsfrei), `restore(src)`, `resetDynamic()`, `region(name)`.
- **Layout-Hash:** xxHash32 (Seed 0) über den kanonischen, zeilenbasierten ASCII-Text
  `faf-arena v1 bytes=… dyn=a..b` + je Region `kind name area derived cap off len` + je Teil `name type off len`.
- **Table-DSL** (`src/table.ts`): `defineTable(name, cap, schema, options?)`, Spaltentypen
  `u8|i8|u16|i16|u32|i32|f64s`; `t.col.x` ist per Mapped Type das passende TypedArray, `f64s` ist eine
  `SafeIntColumn` (einzige Float64Array-Stelle: `src/safeint.ts`; `set/add` normalisieren −0 und prüfen im
  Debug `Number.isSafeInteger`). Header (32 B, Int32): highWater, liveCount, freeHead, freeTail, freeCount
  (+3 reserviert), danach u32-Freelist-Ring (cap Einträge), `$gen` (u16, 12 Bit genutzt), `$alive` (u8), Spalten.
  `alloc()` (FIFO-Wiederverwendung, sonst highWater++, −1 wenn voll, nullt die Zeile, Generation bleibt),
  `free(idx)` (gen = (gen+1) & 0xFFF, wirft bei Doppel-Free), `handle(idx)`, `resolve(handle)` (−1 bei
  HANDLE_NONE, veralteter Generation oder totem Slot), `isLive(idx)`, `highWater`, `liveCount`, `freeCount`.
- **Handles** (`src/handle.ts`): `packHandle/unpackIndex/unpackGen/nextGen`, `HANDLE_NONE = 0xFFFFFFFF`.
  Tabellen-Cap ≤ 0xFFFFF, damit Index 0xFFFFF nie gültig ist.
- **Dense** (`src/dense.ts`): `defineDense(name, cap, schema)` mit Back-Pointer-Spalte `owner` (i32),
  `add(owner) → row | −1`, `removeAt(row) → verschobener owner | −1` (Swap-Remove, letzte Zeile wird genullt),
  `count`.
- **Slab** (`src/slab.ts`): `defineSlab(name, recordBytes, cap)` (recordBytes Vielfaches von 4), gleicher
  Header + FIFO-Ring wie Tabellen, `$alive`, Views `u8/u16/i32/u32` über den Record-Bereich,
  `byteOffset(rec)`/`wordOffset(rec)`.
- **Roh-Regionen** (`src/raw.ts`): `defineRegion(name, bytes, options?)` für Grids (statisch: Heightmap/Nav;
  dynamisch + `derived`: Spatial-Grids), Views `u8/i8/u16/i16/u32/i32`.
- **Hash** (`src/hash.ts`): `ruleHash(arena, hasher, seed=0)` streamt (XxHash32 aus `fixed`, allokationsfrei)
  über alle dynamischen, nicht-derived Regionen in Registrierungsreihenfolge: Header, *lebende* Freelist-Einträge
  (Ring ab head, count Einträge, wrap-aware), gen/alive/Spalten der Slots `[0, highWater)`, Dense `[0, count)`
  (Header, owner, Spalten), Slab-Records `[0, highWater)`, Roh-Regionen vollständig. `fullHash` zusätzlich über
  derived-Regionen. `regionHash(region, arena, hasher)` für desync-diff.

### `@faf/protocol` (PLAN §3.1, §3.6) – Dep nur `@faf/fixed`

- `src/ops.ts`: `Op` (Move=1 … GroupMove=23, Cheat=250), `CheatSub` {Spawn:1, Kill:2}, `CmdFlags` {Queue:1},
  `isOp`, `opName`. Append-only, Test pinnt alle Werte.
- `src/command.ts`: `CommandEnvelope`, `CommandSource`, `CommandBatchEncoder` (wiederverwendbarer, wachsender
  Puffer; `add`, `addRaw` mit Payload-Teilbereich, `view()`, `toArrayBuffer()`), `decodeBatch`, `encodeBatch`,
  `validateBatch` (allokationsfrei, −1 bei Fehlern/Trailing Bytes/Version), `CommandBatchView` (allokationsfreier
  Cursor: `reset(bytes)`, `next()`, `tick/army/seq/op/flags/unitCount/unitAt(i)/payloadOffset/payloadLength`,
  `dataView`), `setBatchTick(bytes, tick)` (Host stempelt den Anwendungs-Tick in place), `batchCount`.
- `src/payloads.ts`: Move (12 B), CheatSpawn (18 B), CheatKill (1 B) je `encode*/decode*`, `write*` und
  allokationsfreie `read*`/`read*Into(dv, off, out)`.
- `src/ctl.ts`: `CtlMessage` (pause/resume/speed/step/viewer/watch/debug/devReload/exportLog), `CmdMessage`,
  `InitMessage`, `HostMessage` (ready/status/stats/log/error), `speedToPermille`/`permilleToSpeed`,
  Validierung untrusted Daten: `parseCtlMessage`, `parseInitMessage`, `parseCmdMessage`, `parseMainToHostMessage`.
- `src/frame.ts`: Header-/Record-Konstanten, `UnitFlags`, `FrameSection`, `DEFAULT_FRAME_CAPS`,
  `frameCapacityBytes(caps)`, `FrameWriter` (allokationsfrei; Sektionen dürfen beliebig verschachtelt geschrieben
  werden, `endFrame()` packt per `copyWithin` und nullt das Padding), `FrameReader` (Zero-Copy, validiert
  Magic/Version/Sektionsgrenzen).
- `src/transport/` (DOM-frei, nicht unter `sim/determinism`):
  - `types.ts`: `PortLike` (strukturell; Browser-`Worker`/`MessagePort` und Node-`MessagePort` passen ohne Cast –
    per `tsc` geprüft), `FrameProducer {begin, commit, produced, dropped, close}`,
    `FrameConsumer {poll, seq, received, close}`, Nachrichten `FrameMsg`/`FrameReturnMsg`, `messageData(ev)`.
  - `sab.ts`: `createSabFrameBuffer(capacity)`, `SabFrameProducer`/`SabFrameConsumer` (+ `createSab*`),
    `sabFrameBufferBytes`, `sabFrameCapacity`, `canUseSab(scope)`.
  - `transfer.ts`: `TransferFrameProducer` (Pool ≥ 3 ArrayBuffers, leerer Pool → Frame in privaten
    Scratch-Puffer, nicht gesendet, `dropped++`), `TransferFrameConsumer` (Copy-on-Arrival in lokalen
    Doppelpuffer, Rücksendung des Puffers sofort), `isFrameMsg`, `isFrameReturnMsg`.
  - `factory.ts`: `createFrameProducer/createFrameConsumer({kind, capacity, sab?, port?, poolSize?})`.
- `src/simid.ts`: `computeSimId(simBuild, bpSimHash, mapSimHash, modList)`, `simIdBytes(...)`.

## Binärformate

**Command-Batch** (LE, Version 1): `u8 version | u16 count` + je Envelope
`u32 tick | u8 army | u16 seq | u8 op | u8 flags | u16 unitCount | u32[unitCount] units | u16 payloadLen | payload`
(13 B fix + 4·Units + Payload). Main schickt Tick 0, der Host stempelt per `setBatchTick`.

**Payloads:** Move `i32 x | i32 y | i32 z` (Fx raw). CheatSpawn
`u8 sub=1 | u16 bp | u8 army | u16 count | i32 x | i32 z | i32 spread`. CheatKill `u8 sub=2` (Ziele = units).

**Frame** (LE, Version 1, Header 96 B, Sektionen 4-B-aligned, gepackt in der Reihenfolge
Units | Parts | Projectiles | Beams | Events | Debug):

| Off | Feld | Off | Feld |
|---|---|---|---|
| 0 | magic u32 `'IFRM'` (0x4D524649) | 28 | hashTick u32 |
| 4 | ver u16 | 32 | hash u32 |
| 6 | headerBytes u16 | 36 | counts u32×5 (units, parts, projectiles, beams, events) |
| 8 | seq u32 | 56 | offsets u32×5 (gleiche Reihenfolge) |
| 12 | tick u32 | 76 | fogRect u16×4 (x0, y0, x1, y1) |
| 16 | tickTimeUs u32 | 84 | footprintDeltaCount u32 |
| 20 | speedPermille u16 | 88 | debugOffset u32 |
| 22 | viewer i8, 23 flags u8 (bit0 paused) | 92 | debugBytes u32 |
| 24 | ackSeq u32 | | |

- **UnitRecord 48 B:** 0 prevPos i32×3 | 12 curPos i32×3 | 24 prevYaw u16 | 26 curYaw u16 | 28 visual u16 |
  30 army u8 | 31 hp u8 | 32 build u8 | 33 bank i8 | 34 flags u16 | 36 handle u32 | 40 partBase u32 |
  44 partCount u8 | 45 reserved[3] (genullt). Export: `UNIT_RECORD_BYTES`, `UNIT_OFF_*`
  (P2-render spiegelt als `UNIT_INSTANCE_*` – Werte stimmen aktuell überein; der Gleichheitstest gehört zu P4).
- **UnitFlags:** Building 1<<0, Wreck 1<<1, Ghost 1<<2, Blip 1<<3, Vet 2 Bit ab Bit 4 (`VetShift`/`VetMask`),
  ShieldUp 1<<6, Stalled 1<<7, Damaged 1<<8, Idle 1<<9, NoInterp 1<<10.
- **PartRecord 8 B:** prevYaw u16 | curYaw u16 | prevPitch i16 | curPitch i16.
- **ProjectileRecord 28 B:** prevPos i32×3 | curPos i32×3 | visual u16 | army u8 | flags u8.
- **BeamRecord 12 B:** srcHandle u32 | dstHandle u32 | visual u16 | srcPart u8 | flags u8.
- **EventRecord 32 B:** type u16 | visual u16 | tick u32 | subTick u8 | flags u8 | reserved u16 | pos i32×3 |
  aux u32 | handle u32.
- **Kapazität:** `frameCapacityBytes(DEFAULT_FRAME_CAPS)` = 1.597.536 B (8.192 Units, 65.536 Parts,
  16.384 Projektile, 2.048 Beams, 4.096 Events, 64 KiB Debug). Übertragen wird nur die gepackte Länge
  (1.000 Units ohne Parts ≈ 48 KB).

**SAB-Triple-Buffer:** 64 B Int32-Kontrollwörter (0 magic `'FAFT'`, 1 version, 2 capacity, 3 middle
(Index | DIRTY=4), 4 published, 5 overwritten, 6–8 Slot-Länge, 9–11 Slot-seq) + 3 Slots à capacity (8-aligned).
Klassisches lock-freies Triple-Buffering: `commit` tauscht back↔middle (+DIRTY), `poll` tauscht front↔middle,
je ein `Atomics.exchange`. Startrollen back=0, middle=1, front=2; genau ein Producer und ein Consumer pro SAB.

**Transfer-Ping-Pong:** `{t:'frame', seq, byteLength, buffer}` (Worker→Main, buffer transferiert),
`{t:'frameReturn', buffer}` (Main→Worker). Fremde Nachrichten auf demselben Port werden ignoriert.

**simId:** xxHash32 (Seed 0) über `"FAFSIMID" | u32 len + UTF-8 simBuild | u32 bpSimHash | u32 mapSimHash |
u32 modCount | je Mod u32 len + UTF-8 id` (Mod-Reihenfolge signifikant).

## Tests & Messwerte (Node 24.18, Apple M5 Pro)

`pnpm vitest run packages/heap packages/protocol`: 14 Dateien, 72 Tests grün (≈ 0,8 s).

- heap (32): Layout deterministisch + Layout-Hash gepinnt, Alignment/Offsets/Überlappung, exakte Teilgrößen,
  View-Typen, Memory wächst nie (`buffer.byteLength` konstant, `grow` wirft), FIFO-alloc/free inkl. Ring-Wrap,
  Gen-Wrap nach 4.096 Frees, veraltete Handles, Doppel-Free, SafeInt −0/2⁵³−1, Dense-Swap-Remove
  (auch randomisiert), Slab FIFO, Snapshot/Restore bitgleich, ruleHash ignoriert Bytes jenseits highWater/count
  sowie derived/static, fullHash sieht derived, Freelist-Reihenfolge im Hash, fast-check gegen Referenzmodell,
  Allokationstest (200.000 Zyklen inkl. Hash/Snapshot/Restore < 256 KB Heap-Wachstum).
- protocol (40): Op-Pins; Batch-Byte-Layout; fast-check-Roundtrips (Batch, Move, CheatSpawn);
  `CommandBatchView == decodeBatch`; Truncation/Trailing/Version erkannt; `setBatchTick`; Batch an Offset;
  View allokationsfrei; Ctl-Parser (gültig/ungültig, structuredClone); Frame-Konstanten gepinnt
  (UnitRecord 48 B, alle Offsets), Frame-Roundtrip, verschachteltes Schreiben (fast-check), gleiche Inhalte →
  gleiche Bytes trotz „schmutzigem“ Zielpuffer, Überlauf → `dropped`, korrupte Frames abgelehnt,
  FrameWriter allokationsfrei; **SAB- und Transfer-Transport liefern für dieselbe 60-Frame-Folge bytegleiche
  Frames** (Node-`MessageChannel` + `SharedArrayBuffer`), Triple-Buffer ohne Tearing unter 300 zufälligen
  Interleavings (inkl. stückweisem Schreiben und Stabilität des zuletzt gelieferten Views), **echter
  Zwei-Thread-Test** (Producer im `worker_threads`-Worker, 20.000 Frames, 0 zerrissene Frames,
  `received + dropped == produced`), Transfer-Pool leer → Skip statt Allokation, SAB-Pfad allokationsfrei,
  PortLike-Kompatibilität (tsc), simId gepinnt (`computeSimId('ms1-dev', 0x12345678, 0x9abcdef0, ['core','balance'])`
  = 3416417874) und eingabesensitiv, UTF-8 == `TextEncoder`.

Micro-Messung (Arena mit Units-Tabelle aus PLAN §3.5, cap 8.192, 1.000 live; Dense 8.192; Order-Slab
32 B × 32.768; 1 MiB derived-Grid; 513²-Heightmap statisch; Arena 3,8 MiB, Snapshot 3,3 MiB):
ruleHash ≈ 43 µs, fullHash ≈ 352 µs, snapshot ≈ 63 µs, restore ≈ 59 µs (Node, tsx).

Selbsttest: `tsc -b` (Solution) grün; `tsc -p tsconfig.tests.json` für heap/protocol fehlerfrei (verbleibende
Fehler nur in `packages/render/test`, P2 in Arbeit); `eslint --max-warnings 0 packages/heap packages/protocol`
grün; dependency-cruiser für heap/protocol ohne Verstöße. `pnpm lint` meldet derzeit nur Fehler in
`.claude/workflows/faf-milestone.js` (Workflow-Skript des Orchestrators, nicht Projektcode).

## Verträge für Folgepakete

- Sim: Tabellen/Dense/Slabs per `ArenaBuilder` registrieren, dann `build()`; Views nach dem Build in Locals
  cachen. Views bleiben über `restore()` gültig (gleicher Buffer, kein Grow).
- Dense-Aufrufer müssen nach `removeAt` den Back-Pointer des zurückgegebenen owners auf `row` setzen.
- Freigegebene Slots werden nicht genullt (erst bei `alloc`); der Hash deckt tote Slots < highWater ab, das ist
  deterministisch.
- Sim-Host: `cmd`-Batches mit `CommandBatchView.reset()` validieren (wirft `RangeError`), `setBatchTick()` vor
  dem Anwenden/Aufzeichnen; Frames per `FrameWriter` in `producer.begin()` schreiben und `commit(len)`.
- Client: `consumer.poll()` pro rAF; der View bleibt bis zum nächsten `poll()` unverändert. Bei `transfer`
  muss der Main-Thread den Consumer am Worker-Port registrieren (er filtert `t:'frame'` selbst) bzw.
  `consumer.arrive(msg)` aufrufen, falls er Nachrichten selbst verteilt.
- SAB: Main legt den Puffer mit `createSabFrameBuffer(frameCapacityBytes(caps))` an und schickt ihn in
  `InitMessage.frameSab`; `canUseSab()` entscheidet (verlangt `crossOriginIsolated`).

## Abweichungen (mit Begründung)

1. **Kein separater Codegen-Schritt:** Die Table-DSL erzeugt Views/Accessoren beim Binden (`build()`); die
   Typisierung (`t.col.x: Int32Array`) kommt aus Mapped Types. Gleiches Ergebnis ohne Build-Schritt und ohne
   generierte Dateien.
2. **Header-Wort `tickTimeUs`** (µs statt ms wie in PLAN §3.6 skizziert) und **`speedPermille`** statt
   Float-Speed – ganzzahlig, präziser.
3. **Frame-Magic bleibt `'IFRM'`** wie in der Aufgabe vorgegeben (historischer Projektname); der
   simId-Tag heißt dagegen `"FAFSIMID"` und der SAB-Magic `'FAFT'` (noch keine persistierten Daten).
4. **Zusätzliche Header-Felder** `ackSeq`, `hashTick`, `hash`, `debugOffset/debugBytes` (seq-Bestätigung,
   Hash-Anzeige in der Dev-Konsole, Debug-Sektion).
5. **Transport-Statistik:** SAB zählt überschriebene, nie abgeholte Frames als `dropped`; Transfer zählt
   Frames ohne freien Pool-Puffer als `dropped`.
6. **`PortLike.addEventListener`-Listener** ist als `(ev: object) => void` typisiert (Daten per
   `messageData(ev)`), weil DOM- und Node-Signaturen sonst nicht strukturell zuweisbar sind; `postMessage`
   verlangt die Transfer-Liste (wird immer übergeben).
7. **Frame-Kapazität:** `DEFAULT_FRAME_CAPS` setzt Beams 2.048, Events 4.096, Debug 64 KiB (PLAN nennt nur
   Units/Projektile); Überlauf wird gezählt (`FrameWriter.dropped`), nicht geworfen.

## Grenzen

- Der Transfer-Pfad allokiert pro Frame unvermeidlich (Nachrichtenobjekt, structured clone, neue
  ArrayBuffer-Hülle nach Rücktransfer, `new Uint8Array` im Producer); allokationsfrei ist nur der SAB-Pfad.
- Der SAB-Triple-Buffer unterstützt genau einen Producer und einen Consumer; ein neu erzeugter Consumer auf
  einem bereits benutzten SAB (z. B. nach HMR) braucht einen frischen Puffer.
- Part-, Projektil-, Beam- und Event-Inhalte sind nur als Layout/Writer/Reader vorhanden; befüllt werden sie in
  späteren Meilensteinen. Sektionen Eco/Watch/Intents/Fog/Footprint-Deltas/Shields folgen ebenfalls später
  (Header trägt bereits fogRect/footprintDeltaCount).
- Die Messwerte oben stammen aus Node; Hash-Tick im langsamsten Browser-Worker misst SPK5/P4.
