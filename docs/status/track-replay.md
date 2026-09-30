# Track REPLAY – `.rtsreplay`, Keyframes, Seek, Verifikation (Vorarbeit MS11/N1 und S10)

Vorarbeits-Track parallel zu MS3 (Branch `track-replay`, Worktree
`/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-replay`). Kein Meilenstein aus PLAN §5.2, sondern die
Replay-Grundbausteine für **N1/MS11** („Replay-Container, Keyframes, Replay-Browser“) und die Container-/Keyframe-Technik
für **S10** (Save/Load). Gesamtplan mit Schnittstellen: [`docs/plans/TRACK-REPLAY.json`](../plans/TRACK-REPLAY.json).
Details je Paket in den Fragmenten unter [`docs/status/track-replay/`](track-replay/) (p0–p6), diese Datei fasst sie
zusammen. Alle Messwerte **lokal gemessen, Apple M5 Pro, Node 24.18** (48 GB, parallel Fremdlast anderer Agenten;
DECISIONS 5/16: Messung, kein CI-Gate, sofern nicht als Vitest gegated).

**Stand 2026-09-30: alle Abnahmepunkte erfüllt** (Tabelle unten), alle Prüfbefehle grün, Grenzen eingehalten.

## Paketübersicht

| Paket | Welle | Inhalt | Dateien | Fragment |
|---|---|---|---|---|
| p0 | 0 | fflate 0.8.3 (gepinnt), `deflateRaw`/`inflateRaw`, synthetischer 30-min-1v1-Command-Strom, Scripts, tsconfig-/ESLint-Setup | `packages/formats/src/deflate.ts`, `tools/headless/src/replay/synthetic.ts`, Tests `deflate.test.ts`, `replay-synthetic.test.ts` | [p0](track-replay/p0.md) |
| p1 | 1 | `.rtsreplay` Reader/Writer/Builder, CMDS-Range-Coder, Größen-Gate | `packages/formats/src/rtsreplay/{types,bytes,chunks,cmds,rangecoder,meta,replay,index}.ts`, `tools/headless/scripts/replay-size.ts`, Tests `rtsreplay.test.ts`, `rtsreplay-fuzz.test.ts`, `replay-size.test.ts` | [p1](track-replay/p1.md) |
| p2 | 1 | `CompressedKeyframeStore` (sync fflate + nativ async), Sub-Hashes je Regel-Region, `bench:keyframes` | `packages/sim-host/src/replay/{keyframes-compressed,native-deflate,sub-hashes}.ts`, `tools/headless/src/replay/keyframe-bench.ts`, `scripts/bench-keyframes.ts`, Tests `replay-keyframes.test.ts`, `replay-sub-hashes.test.ts` | [p2](track-replay/p2.md) |
| p3 | 1 | Golden-Command-Logs, sim-valide Langpartie, Voll-Dump `.rtsdump`, Dump-Diff, Divergenzsuche, Szenario-Hooks | `tools/headless/src/replay/{scenario-log,long-game,dump,state-diff,divergence}.ts`, `src/scenario.ts` (Hooks), `scripts/golden-logs.ts`, `test/golden-replays/logs/*.faflog`, 4 Testdateien | [p3](track-replay/p3.md) |
| p4 | 2 | Replay-Bibliothek in sim-host: Konverter FAFL → `.rtsreplay`, `RtsReplaySource`, `ReplayPlayer` (Seek, Verifikation), `ReplayCompatError`, OPFS-Export | `packages/sim-host/src/replay/{setup,convert,source,player,opfs-export,index}.ts`, Tests `replay-{convert,player,seek,opfs}.test.ts` | [p4](track-replay/p4.md) |
| p5 | 3 | CLI `replay-verify`, `desync-diff` (inkl. Dump-Modus), `bench:replay` | `tools/headless/src/replay/{verify,desync,replay-bench}.ts`, `scripts/{replay-verify,desync-diff,bench-replay,replay-cli-lib}.ts`, Tests `replay-cli.test.ts`, `replay-desync.test.ts` | [p5](track-replay/p5.md) |
| p6 | 3 | Golden-Replays, Replay-Job im Cross-Engine-Harness | `tools/headless/src/replay/xengine-job.ts`, `scripts/replay-goldens.ts`, `test/golden-replays/*.rtsreplay` + `README.md`, Änderungen an `src/jobs.ts`, `src/series.ts`, `src/harness/worker-entry.ts`, `scripts/{lib,run-series,xengine}.ts`, `browser/{harness,xengine.spec}.ts`, Test `replay-goldens.test.ts` | [p6](track-replay/p6.md) |
| p7 | 4 | Integration, Gesamtverifikation, diese Doku, STATUS-Abschnitt | `docs/status/track-replay.md`, `docs/STATUS.md` | – |

Außerhalb der Track-Ordner geändert (p0): `eslint.config.js` (`jsonParseAllow` + `rtsreplay/meta.ts`, Ignore
`docs/design/ui-mockups/**`), Root-`package.json` (`replay:verify`, `replay:diff`), `packages/formats/package.json`
(fflate), `packages/formats/src/{errors,index}.ts` (Fehlercodes `bad-compression`, `too-large`,
`unsupported-version`; Exporte), `tools/headless/{package.json,tsconfig.json,tsconfig.harness-worker.json}`,
`pnpm-lock.yaml`; in `packages/sim-host` nur `export * from './replay/index.ts'` in `src/index.ts`.

Umfang: ≈ 9.500 Zeilen Quellcode (formats/sim-host/headless), 18 Testdateien mit **186 Tests** (alle grün).

## Format `.rtsreplay` (PLAN §3.11)

Container = bestehendes Chunk-Format aus `@faf/formats` (`container.ts`): 16-B-Dateikopf `RTSR` | containerVersion 1
| **formatVersion 1** | chunkCount | reserved, dann je Chunk 4CC | u32 Länge | Daten | Null-Padding auf 4 | CRC-32.
Alles little-endian, jeder bekannte Chunk beginnt mit **u16 chunkVersion** – je Chunk eine eigene Konstante
(`HEAD_CHUNK_VERSION`, `GAME_…`, `CMDS_…`, `HASH_…`, `MARK_…`, `META_CHUNK_VERSION`, derzeit alle 1),
Strings = u16-Länge + striktes UTF-8.

Reihenfolge: `HEAD`, `GAME`, `CMDS` × n, `HASH`, `MARK`, optional `META`.

| Chunk | Inhalt (Bytelayout vollständig in [p1](track-replay/p1.md#formatbeschreibung)) |
|---|---|
| `HEAD` | formatVersion, protocolVersion (= `COMMAND_BATCH_VERSION`), hashInterval, subHashInterval, sourceLogVersion (0 = direkt, 1/2 = aus FAFL v1/v2), simId, bpSimHash, mapSimHash, layoutHash, flags (`Tainted 1`, `Complete 2`, `Truncated 4`), simBuild, buildHash – **dieses Präfix ist für alle HEAD-Versionen eingefroren**, neuere Versionen hängen Felder nur hinter buildHash an |
| `GAME` | seed, mapSizeWu, playerArmy (−1 = Beobachter), Allianzmatrix 32 B (Bit a·16+b), mapName, je Armee index/kind (Mensch/KI/Beobachter)/team/aixPermille/name/aiProfile/faction |
| `CMDS` | ein Chunk je **600-Tick-Block** (lückenlos, leere Blöcke erlaubt), 16-B-Blockkopf (codec 0 stored / 1 deflate-raw, firstTick, entryCount ≤ 600, rawLength ≤ 16 MiB), jeder Block allein dekodierbar |
| `HASH` | Regel-Hash alle 10 Ticks (lückenlos ab firstTick), Sub-Hashes je Regel-Region alle 100 Ticks mit Regionsnamen (aktuell `world, armies, alliance, units, movers`) |
| `MARK` | tick/kind/value; `ReplayMarkKind` Pause 1, Resume 2, Speed 3, Cheat 4, DevReload 5, Step 6, Restore 7 (= sim-host `MarkKind`, per Test festgenagelt), AiTimeout 8; unbekannte kinds werden erhalten |
| `META` | kanonisches JSON: durationTicks, endTick, players, result {winner, reason}, stats (nur Ganzzahlen), extra (String→String); weitere Top-Level-Schlüssel neuerer Builds werden als kanonischer JSON-Text in `ReplayMeta.extensions` gehalten und zurückgeschrieben. `endTick` ist **beschreibend**: der Leser lehnt ein `endTick` vor dem aufgezeichneten Inhalt ab (`bad-value` in `META`), das Wiedergabeende leitet sich aus dem Inhalt ab (siehe Seek) |

- **CMDS-Blockkodierung:** adaptiver binärer Range-Coder (LZMA-Stil, rein ganzzahlig) über Tickdelta, seq-Delta,
  Armee/Flags/Op-Kontexte, Listen-Wörterbuch (MRU 32), bekannte Handles als Rang-Delta, Slot+Generation, Positions-Deltas
  je Positionsklasse, Byte-Bäume je (Op, Byteposition). Envelope-Ticks werden nicht gespeichert (= Eintrags-Tick).
  Ergebnis: 11,2 B/Command im synthetischen FA-Mix (Faktor 5,1 gegenüber dem Protokoll). Jede Änderung der Regeln →
  neue `CMDS_CHUNK_VERSION`; jeder `CmdsBlockRef` trägt seine `version`, `decodeCmdsRaw`/`decodeCmdsBlock` verzweigen
  danach (V1-Dekoder eingefroren), ältere Blöcke dekodieren also weiter mit ihren Regeln, eine Version ohne Dekoder ist
  `unsupported-version`. (Abweichung vom Plan, siehe unten.)
- **Kompression:** Der Writer versucht je Block `deflateRaw` (fflate, Level 6, `mem` 4 fest → rein ganzzahliger Encoder,
  kanonische, engine-unabhängige Bytes) und nimmt codec 1 nur, wenn kleiner (bei Range-Coder-Daten praktisch nie).
  **fflate ist kanonisch**; nativ komprimierte Blöcke (`CompressionStream('deflate-raw')`, node:zlib) sind lesbar und
  werden von `rewriteRtsReplay` byte-exakt erhalten. Inflate allokiert genau `rawLength + 1` und wächst nie
  (Deflate-Bombe kostet nur CPU, danach `FormatError('bad-compression')`).
- **Versionierung (strikter Leser):** formatVersion > 1, chunkVersion eines bekannten Chunks > seine Konstante oder
  protocolVersion ≠ `COMMAND_BATCH_VERSION` (älter **oder** neuer) → `FormatError('unsupported-version')`;
  fehlende/doppelte/vertauschte Pflicht-Chunks, Konsistenzverstöße (bekannte Taint-Mark ⇒ Tainted-Flag; das Flag ohne
  bekannte Taint-Mark ist erlaubt = Taint-Arten neuerer Builds; Intervalle HEAD == HASH; META.endTick nicht vor dem
  letzten Hash-/Sub-Hash-/Mark-Tick bzw. Start des letzten CMDS-Blocks, mit `verifyBlocks` exakt vor dem letzten
  Command) → `FormatError`.
- **Toleranter Kopf-Leser `readRtsReplayHead(bytes)`:** liest für **jede** Container-/Format-/Chunk-/Protokollversion
  nur die eingefrorenen Teile (16-B-Dateikopf, Chunk-Framing, HEAD als erster Chunk mit CRC, HEAD-Präfix bis buildHash,
  u16 chunkVersion jedes bekannten Chunks) → `ReplayHeadInfo`; `replayFormatIncompatibility(info)` sagt, ob der strikte
  Leser dieses Builds die Datei parsen kann (`'format'`/`'protocol'`). Damit prüfen Player, `replay-verify` und der
  spätere Replay-Browser zuerst die Build-Kompatibilität (Weiterleitung) und parsen erst danach.
- **Unbekannte Chunks:** dürfen überall nach `GAME` stehen, werden übersprungen, in `unknown`/`chunks` gehalten und von
  `rewriteRtsReplay` byte-exakt an ihrer Stelle zurückgeschrieben.
- **API (`@faf/formats`):** `writeRtsReplay`, `readRtsReplay(bytes, {verifyBlocks?})`, `decodeCmdsBlock` (lazy,
  ≈ 0,8 ms je Block), `readAllCommands`, `blockIndexForTick` (−1 = kein Block), `rewriteRtsReplay`, `RtsReplayBuilder`
  (inkrementell, setzt Tainted bei Taint-Marks, behält ein übergebenes Flag), `replaySizeReport`, zusätzlich
  `rtsReplayToInput`, `readRtsReplayHead`, `replayFormatIncompatibility`, `replayContentEndTick`, `lastCommandTick`.
  Kanonisch:
  `write(toInput(read(b))) == b` für jede Writer-Datei, `rewrite(read(b)) == b` für **jede** lesbare Datei.

## Keyframes (`CompressedKeyframeStore`, sim-host)

- Keyframe = Session-Snapshot (`SimCore.snapshot`, 16-B-Identitätskopf + dynamische Arena) per memcpy in einen
  wiederverwendeten Scratch-Puffer, dann raw DEFLATE; gehalten wird nur das Kompressat. Intervall 600 Ticks (60 s).
- **Budget 128 MiB komprimiert**, Ausdünnung wie `KeyframeStore`: jeder zweite Keyframe außer dem ersten fällt weg,
  Intervall verdoppelt sich, die ganze Partie bleibt abgedeckt (mindestens 2 Keyframes, Tick 0 bleibt immer).
- Standard-Level **1** (Keyframes sind nur im Speicher, kanonisch nicht nötig): 29–44 % schneller als Level 6 bei
  ±1 % Größe. Nativer Pfad (`captureAsync`, `CompressionStream`): Tick blockiert nur für das memcpy.
- Restore: Inflate + `restoreSnapshot` (prüft Session-Identität, fremde Session → `SnapshotError` ohne Schreiben).
  Captures vor bestehenden Keyframes werden sortiert eingefügt (feste Replay-Zeitlinie).

Messwerte `bench:keyframes` (Szenen nach 600 Ticks Bewegung; Wertebereich über 2 volle Läufe aus p2 + `--quick`-Lauf
aus p7, lokal gemessen, Apple M5 Pro, Node 24.18):

| Szene | Snapshot | fflate-1 (Standard) | Rate | capture p50 | nativ capture p50 / blockierend | restore p50 |
|---|---:|---:|---:|---:|---:|---:|
| Testebene, 1.000 Würfel | 1.477.368 B | 42.043 B | 2,85 % | 6,3–7,4 ms | 2,5–2,8 ms / 0,09–0,12 ms | 1,2–2,1 ms |
| hollow-ridge, 1.000 | 1.477.368 B | 40.203 B | 2,72 % | 6,3–6,9 ms | 2,4–2,5 ms / 0,05–0,06 ms | 1,1–1,5 ms |
| setons, 2.000 | 1.876.728 B | 86.645 B | 4,62 % | 8,4–9,0 ms | 3,7–4,0 ms / 0,07–0,13 ms | 1,9–2,9 ms |

Level 6 kostet 9,1–16,0 ms, Level 9 59–144 ms bei ≤ 0,8 % Ersparnis; nativ 9–13 % größer. Jede Wiederherstellung ergab
Regel- und Voll-Hash des Aufnahmezustands. Hochrechnung: 30 min = 31 Keyframes, 1,2–2,6 MiB; 3 h = 181 Keyframes,
6,9–15,0 MiB, **keine Ausdünnung** (unkomprimiert wären es nach 2 Ausdünnungen 65–82 MiB mit 4-min-Raster). Die
Langpartie (≈ 370 Einheiten) hält nach 30 min 31 Keyframes mit 698.314 B komprimiert (45,8 MB roh).

## Seek-Algorithmus (`ReplayPlayer.seek`)

0. **Wiedergabeende** (`replayPlaybackEnd`, sim-host): aus dem **Inhalt** abgeleitet = größter Tick aus letztem Command,
   Regel-Hash, Sub-Hash-Zeile und Mark (`replayContentEndTick`). `META.endTick` verlängert das nur um die Leerlauf-Ticks
   nach dem letzten Regel-Hash (≤ hashInterval − 1); ein weiter entferntes `META.endTick` (z. B. 2³² − 1) wird ignoriert
   (Warnung im Player), statt Milliarden leerer Ticks zu simulieren. Jeder aufgezeichnete Hash liegt damit im
   abgespielten Bereich.
1. Ziel muss Ganzzahl in `[0, endTick]` sein (sonst `RangeError`).
2. `ki` = Keyframe mit größtem Tick ≤ Ziel. Liegt das Ziel hinter dem aktuellen Tick oder `tick(ki)` nach dem aktuellen
   Tick, wird `ki` wiederhergestellt (Inflate + `restoreSnapshot`); sonst wird vom aktuellen Stand weitergerechnet.
3. Nachsimulieren bis zum Ziel mit den aufgezeichneten Commands (`RtsReplaySource`: wahlfreier Blockzugriff, lazy
   dekodiert, LRU mit 2 Blöcken).
4. Nach jedem Tick `maybeCapture` → Keyframes alle 600 Ticks werden auch beim Nachsimulieren eingesammelt (sortiert
   eingefügt, Budget/Ausdünnung wie oben).
5. Hash-/Sub-Hash-Prüfung läuft immer mit; jeder Tick zählt einmal (Hochwassermarke), eine Abweichung nur beim
   Nachsimulieren würde trotzdem gemeldet.

Vor Tick 1 wendet der Player die GAME-Allianzmatrix an und nimmt erst dann den Tick-0-Keyframe auf. Belegt durch
`replay-seek.test.ts` (fast-check: 30 zufällige Seek-Folgen == Direktlauf-Voll-Hash, auch mit Ausdünnung) und den
Rückwärts-Seek in allen vier Engines (`test:xengine`).

**Kompatibilität:** Für Datei-Bytes prüfen `ReplayPlayer.open`/`verifyReplay`/`verifyReplayFile` zuerst den
toleranten Kopf (`checkReplayCompat` = `readRtsReplayHead` + `replayBuildIncompatibility`: `sim-build`, `format`,
`protocol`), danach den strikten Parse und vor dem ersten Tick `map`, `sim-id`, `layout`, `alliances`. Alle Fälle werfen
`ReplayCompatError {reason, buildHash, simBuild, redirect}` mit Hinweis `/b/<buildHash>/` – auch nach einem Bump von
`COMMAND_BATCH_VERSION` oder einer Chunk-Version bleiben alte Replays also weiterleitbar statt zu `FormatError` zu
werden. `FormatError` bleibt nur für tatsächlich kaputte Dateien dieses Builds (bzw. wenn nicht einmal der HEAD lesbar
ist). Für Listen ohne Exception: `replayBuildIncompatibility(readRtsReplayHead(bytes))`.

**Komposition (Vorbereitung MS11):** Der Player arbeitet auf einem `SimCore`. `ReplayPlayer.open` legt eine eigene
`HeadlessSim` an; `ReplayPlayer.attach(core, source)` hängt sich an einen bestehenden Core (Tick 0, ohne Recorder,
`RtsReplaySource` als Command-Quelle), z. B. den des Sim-Workers. Die Hash-Prüfung ist ein eigener `ReplayVerifier`
(Regel-Hash-Listener + `afterTick`), angemeldet über `addHashListener` – Recorder, Verifier, Cross-Engine-Trail und
Debug-Tools teilen sich damit den einzigen `core.onHash`-Slot (Fan-out, ohne `core.ts` anzufassen). Wer Ticks außerhalb
des Players ausführt (SimHost/Scheduler), ruft danach `player.observeTick()` (Sub-Hashes, Keyframes).

## Konverter (FAFL-Command-Log → `.rtsreplay`)

`convertCommandLog(log, {map?, simBin?, bpTable?, subHashes?, game?, meta?, level?})` aus `@faf/sim-host`:

- **FAFL v2** (MS2-Recorder): HEAD aus dem Log-Kopf; `simBuild` = SIM_BUILD, wenn die simId reproduzierbar ist, sonst
  ein früherer Build aus `KNOWN_SIM_BUILDS` (nur anhängen), sonst `'unknown'`. Commands, Regel-Hashes und Marks 1:1;
  **Sub-Hashes per Nachsimulation** (alle 100 Ticks, nur bis zum ersten Mismatch). `verified` = nachsimuliert und alle
  Log-Hashes gleich.
- **FAFL v1** (MS1) bzw. fremder Build/fremde Karte/anderes Layout: Konvertierung ohne Nachsimulation (Warnung,
  `verified = false`, keine Sub-Hashes).
- **Crash-Logs** (OPFS, Tab-Kill, zerrissenes Ende, kaputter Batch mit gültiger Prüfsumme): gültiges Replay bis zum
  letzten gültigen Tick, `Truncated`, nicht `Complete`; fehlende Cheat-Mark nach zerrissenem Ende wird ergänzt.
  Cheat/DevReload/Restore setzen `Tainted`. Getestet mit 50 zufälligen Schnittstellen (fast-check) und einem
  Tab-Kill nach 1.005 Ticks in der Fake-OPFS (Replay bis Tick 1.001, Voll-Hash == Live-Spiel).
- OPFS-Helfer: `listRecordedLogs(root)`, `exportRecordedLogAsReplay(root, name, opts)`, `replayFileNameForLog`.
- Rückweg `replayToCommandLog`/`replayAsParsedLog`: für die Golden-Logs bytegleich zum Quell-Log.

## CLI-Referenz

Alle Aufrufe `pnpm --filter @faf/headless <script> -- …` (Root-Aliase `pnpm replay:verify`, `pnpm replay:diff`);
relative Pfade gelten ab dem Aufrufverzeichnis.

### `replay-verify`

```
replay-verify -- <dateien…> [--goldens] [--map <pfad.rtsmap>] [--until <tick>] [--json]
```

Liest `.rtsreplay` oder FAFL (wird vorher konvertiert), findet die Karte per mapSimHash unter allen
`content/maps/*.rtsmap`, spielt headless mit Regel-Hash- (alle 10 Ticks) und Sub-Hash-Prüfung (alle 100 Ticks).

| Exit | Bedeutung |
|---|---|
| 0 | alle Dateien bitgleich abgespielt **und** jeder aufgezeichnete Regel-Hash/jede Sub-Hash-Zeile bis zum Wiedergabeende verglichen |
| 1 | Abweichung: erste mit Tick, erwartet/ist, Tabelle(n) = abweichende Sub-Hash-Regionen – oder **unvollständig geprüft** (weniger Hashes/Sub-Hash-Zeilen verglichen als aufgezeichnet, z. B. Hashes neben dem Sim-Raster oder Sub-Hash-Prüfung wegen anderer Regionen aus) |
| 2 | inkompatibel (`ReplayCompatError` inkl. `format`/`protocol`, mit `/b/<buildHash>/`), Formatfehler (Code, Chunk, Offset; z. B. gekürztes `META.endTick`), unlesbar, Aufruffehler |

Beispiel (p7-Lauf, `heavy pnpm --filter @faf/headless replay-verify -- --goldens`):

```
replay-verify – 5 Datei(en), Build faf-sim/ms2.0, Node v24.18.0

Datei                                            | Ticks | Hashes geprüft | Sub-Hashes | Ergebnis  | Tempo x Echtzeit
-------------------------------------------------|-------|----------------|------------|-----------|-----------------
test/golden-replays/cubes-1000-move.rtsreplay    | 2.000 |        200/200 |      20/20 | bitgleich |             225x
test/golden-replays/cubes-churn.rtsreplay        | 2.000 |        200/200 |      20/20 | bitgleich |             872x
test/golden-replays/ridge-1000-move.rtsreplay    | 2.000 |        200/200 |      20/20 | bitgleich |             231x
test/golden-replays/ridge-water-block.rtsreplay  | 2.000 |        200/200 |      20/20 | bitgleich |           2.585x
test/golden-replays/setons-bridge-move.rtsreplay | 2.000 |        200/200 |      20/20 | bitgleich |             597x
…
Ergebnis: alle Dateien bitgleich abgespielt (Exit 0).
```

Abweichung (HASH-Eintrag bei 1.100 gekippt, aus p5):

```
ridge-badhash.rtsreplay: erste Abweichung bei Tick 1.100 (Regel-Hash): erwartet 0xc0fbbed8, ist 0xc0fbbed9; Tabelle(n): keine Sub-Hash-Region weicht ab (nur der aufgezeichnete Hash); 1 Abweichung(en) insgesamt
garbage.rtsreplay: Formatfehler truncated (Offset 0): truncated at byte 0: file has 9 bytes, header needs 16
Ergebnis: inkompatible/fehlerhafte Eingabe (Exit 2).
```

### `desync-diff`

```
desync-diff -- <a> <b> [--limit <n>] [--dumps <verzeichnis>] [--perturb-b <tick>:<region>.<spalte>[<index>]=<wert>] [--map …] [--json]
desync-diff -- --dump <replay> --tick <t> --out <datei.rtsdump> [--label <text>]
desync-diff -- <a.rtsdump> <b.rtsdump> [--limit <n>] [--json]
```

Ablauf für zwei Aufnahmen derselben Partie: Identität prüfen → Aufnahmen ohne Simulation vergleichen (Regel-Hash-Trail,
Sub-Hash-Zeilen, CMDS-Ströme) → frühester möglicher Abweichungstick → A bis zum letzten Keyframe davor, Keyframe in B
wiederherstellen → Gleichschritt mit Regel-Hash nach **jedem** Tick → am ersten abweichenden Tick Voll-Dumps beider
Seiten und Diff nach Region | Spalte | Entity/Index | A | B. Der Dump-Modus erzeugt `.rtsdump` (Container `RTSD`:
HEAD, kanonischer Layout-Text, dynamische Arena deflate-raw) für den Engine-/Build-Vergleich.

| Exit | Bedeutung |
|---|---|
| 0 | keine Abweichung (bei identischen Aufnahmen ohne Nachsimulation) |
| 1 | Abweichung der Nachsimulationen gefunden und erklärt (Tick exakt, Tabelle/Spalte/Entity) – auch wenn sich die Aufnahmen schon früher unterscheiden (dann zusätzlicher Hinweis, `recordingFirst`) |
| 2 | inkompatibel (andere Partie/Session), Formatfehler, Aufruffehler |
| 3 | nur die Aufnahmen weichen ab, beide Nachsimulationen in dieser Engine stimmen überein (Engine-/Build-Desync → `--dump` in beiden Engines) – nur ohne Divergenz der Nachsimulation |

Beispiel (Perturbation `--perturb-b 700:units.hp[5]=1`, aus p5):

```
Erste Abweichung der Nachsimulation bei Tick 700: Regel-Hash A 0xd5e20452 ≠ B 0x6b36d505

Zustandsvergleich A (ridge.rtsreplay, Tick 700) ↔ B (ridge.rtsreplay, Tick 700)
1 abweichende Werte in 1 Region(en): units
Region | Spalte   | Entity/Index | A   | B
-------|----------|--------------|-----|--
units  | hp (i32) | slot 5 (5:0) | 100 | 1

Ergebnis: Abweichung gefunden und erklärt (Tick 700, zuerst units.hp slot 5 (5:0)).
(Exit 1, 294 ms)
```

Manipuliertes Move-Ziel ab Tick 1.100 (Langpartie 2 min): erste Abweichung exakt am ersten unterschiedlichen
Command-Tick 1.103, Diff nennt `units.x slot 5 (5:0)` usw.; gekippter HASH-Eintrag → Exit 3 mit Anleitung zum
Engine-Dump. Weitere Beispielausgaben in [p5](track-replay/p5.md#cli-referenz).

### Weitere Scripts

| Script | Zweck |
|---|---|
| `golden-logs [-- --update]` | Golden-Command-Logs frisch erzeugen und bytegleich prüfen |
| `replay-goldens [-- --update]` | Golden-Replays frisch konvertieren, bytegleich + Trail/End-Hashes/Wiedergabe prüfen |
| `replay-size [-- --json] [--long]` | Größenbericht synthetisches 30-min-1v1 (120 und 200 APM), optional Langpartie; Exit 1 bei verfehltem Gate |
| `bench:keyframes [-- --quick] [--update-docs]` | Keyframe-Kompression je Codec/Level (SPK5-Folgemessung) |
| `bench:replay [-- --quick] [--update-docs] [--json]` | Langpartie: Größe, Wiedergabe kalt/erster Lauf/warm, Rückwärts-Seek; Exit 1 bei Seek-p95 > 2 s, < 20x oder Hash-Abweichung |

## Golden-Replays und Regenerierung nach SIM_BUILD-Bump

Für alle fünf L2-Goldens liegen im Repo: `test/golden-replays/logs/<szenario>.faflog` (FAFL v2, 68.948 B gesamt) und
`test/golden-replays/<szenario>.rtsreplay` (11.688 B gesamt: 1.912–3.312 B je Datei, 200 Regel-Hashes, 20 × 5
Sub-Hashes, `Complete` + `Tainted` durch Cheat-Spawns). Hash-Trail und End-Regel-/Voll-Hash == Golden-JSON, SIM_BUILD
`faf-sim/ms2.0`, buildHash `golden`. Details: [`test/golden-replays/README.md`](../../test/golden-replays/README.md).

**Wichtig für den Merge mit MS3** (SIM_BUILD-Bump): Test, Scripts und `test:xengine` schlagen danach mit Hinweis auf
die Regenerierungskette fehl (gewollt). In dieser Reihenfolge neu erzeugen und gemeinsam einchecken:

```sh
pnpm --filter @faf/headless goldens -- --update        # Golden-JSON (Hash-Ketten)
pnpm --filter @faf/headless golden-logs -- --update    # test/golden-replays/logs/*.faflog
pnpm --filter @faf/headless replay-goldens -- --update # test/golden-replays/*.rtsreplay
```

Zusätzlich beim Merge beachten: `KNOWN_SIM_BUILDS` (`packages/sim-host/src/replay/setup.ts`, aktuell `ms1.1`,
`ms1.2`, `ms2.0`) um den neuen SIM_BUILD ergänzen (nur anhängen; damit dessen Logs später als bekannter Build erkannt
werden) – `replay-convert.test.ts` erzwingt „SIM_BUILD ist letzter Eintrag“ und schlägt sonst an; kommen Regel-Regionen
hinzu, schlägt
`replay-synthetic.test.ts` an → `SYNTHETIC_RULE_REGION_NAMES` nachziehen (HASH wächst mit, gewollt). Auch eine neue
fflate-Version ändert CMDS-Bytes (Frische-Prüfung schlägt an, Wiedergabe bleibt korrekt → neu erzeugen).

## Messwerte (lokal gemessen, Apple M5 Pro, Node 24.18)

### Größen-Gate (30 min 1v1)

Synthetischer Command-Strom (`generateSynthetic1v1`, 2 × 120 APM, realistischer Op-/Selektions-Mix, Modell in
[p0](track-replay/p0.md#synthetischer-command-strom-toolsheadlesssrcreplaysyntheticts); deterministisch, daher in
allen Läufen bytegleich):

| Replay | Commands | CMDS | HASH | MARK | gesamt | Gate |
|---|---:|---:|---:|---:|---:|---|
| synthetisch 2 × 120 APM | 7.200 | **80.416 B** (11,2 B/Cmd) | 10.872 B | 104 B | **91.924 B** | CMDS ≤ 100.000 ✓, gesamt ≤ 250.000 ✓ |
| synthetisch 2 × 200 APM (Bericht) | 12.000 | 123.576 B | 10.872 B | 104 B | 135.088 B | nur gesamt relevant ✓ |
| sim-valide Langpartie hollow-ridge (mit Sub-Hashes) | 7.839 | 65.424 B (8,4 B/Cmd) | 10.872 B | 3.872 B | **80.624 B** | ✓ |

(CMDS hier inkl. Chunk-Kopf/CRC; `bench:replay` weist die gespeicherten Nutzdaten aus: 79.526 B bzw. 64.519 B.)
Protokoll-Batches unkodiert: 407.777 B; zum Vergleich blockweise deflate-raw der Protokoll-Batches ≈ 177–180 KB.

### Wiedergabe und Rückwärts-Seek (`bench:replay`, Langpartie 30 min, ≈ 370 Einheiten)

Wertebereich über 3 volle Läufe (2 aus p5, 1 aus p7) inkl. Hash- und Sub-Hash-Prüfung und Keyframe-Aufnahme:

| Messung | Wertebereich | Ziel |
|---|---:|---:|
| Wiedergabe kalt (frischer Node-Prozess) | 957–1.114x Echtzeit (≈ 9.600–11.100 Ticks/s) | ≥ 20x |
| Wiedergabe erster Lauf im Prozess | 839–993x | ≥ 20x |
| Wiedergabe warm (Median) | 747–1.142x | ≥ 20x |
| Rückwärts-Seek 20 Ziele: Median / p95 / max | 29–32 / 50–58 / 55–88 ms | p95 ≤ 2.000 ms |
| Worst Case (Keyframe + 599 Ticks) | 55–63 ms | ≤ 2.000 ms |
| Konvertierung FAFL → Replay (verifiziert, Sub-Hashes) | 1,5–2,7 s | – |

Alle Seeks exakt (Voll-Hash == Direktlauf). `--quick` (10 min, p7): 978–1.019x, Seek p95 51,5 ms.

**Browser (Indiz, kein Viewer):** Aus den `test:xengine`-Jobzeiten (Golden-Szenarien mit 1.000 Würfeln, Worker ohne
Rendering, inkl. Hash-Prüfung und Keyframes) ergeben sich ≈ 250–330x Echtzeit im ersten Durchlauf (Chromium ≈ 310x,
Firefox ≈ 250x, WebKit ≈ 330x, warm, p7-Lauf). Die MS11-Vorgabe „≥ 5x im Browser“ gilt für den Viewer mit Rendering und
ist damit noch nicht gemessen (offener Punkt).

### Cross-Engine (`pnpm test:xengine`, p7-Lauf 2026-09-30)

**100 Hash-Ketten + 100 Replay-Läufe bitgleich** (5 Golden-Replays × Node/Chromium/Firefox/WebKit × kalt/warm/3
Aufwärmläufe), inkl. Rückwärts-Seek auf Tick 1.000 (Voll-Hash am End-Tick nach Seek + Nachsimulation == erster
Durchlauf); Playwright 30 Tests grün in 1,5 min. Seit der Review-Nachbesserung vergleicht `checkReplayJobResult` in allen
Engines zusätzlich den Voll-Hash **direkt nach dem Seek** (Tick 1.000) mit dem Voll-Hash des Direktlaufs an diesem Tick
(`seekMidFullHash == directMidFullHash`); der p7-Lauf oben prüfte nur End-Hash und Regel-Hashes.
Jobzeiten warm (2.000 Ticks + Seek + 1.000 Ticks): 108–1.466 ms je nach Szenario/Engine, siehe [p6](track-replay/p6.md#3-cross-engine-pnpm-testxengine).

## Abnahme (gegen `acceptance` in `docs/plans/TRACK-REPLAY.json`)

| # | Kriterium | Status | Beleg |
|---|---|---|---|
| 1 | Container nach §3.11 (HEAD/GAME/CMDS 600-Tick-Blöcke deflate-raw, HASH 10/100, MARK, META), Reader/Writer/Builder, Versionierung, unbekannte Chunks | ✅ (CMDS-Blockkodierung per Range-Coder statt Varint, s. Abweichungen) | `pnpm exec vitest run packages/formats/test/rtsreplay.test.ts` |
| 2 | Roundtrip bytegleich (≥ 1.000 fast-check-Fälle + alle Golden-Replays), Batches inkl. Tick-Stempel bytegleich | ✅ 1.000 Fälle; Golden-Replays `rewrite` bytegleich | `rtsreplay.test.ts`, `tools/headless/test/replay-goldens.test.ts` |
| 3 | Fuzz ≥ 10.000 Mutationen → nur `FormatError` oder gültig + bytegleich, keine Allokation > 16 MiB | ✅ 16.843 Fälle (+ einmalig 210.000 CMDS-Mutationen) | `packages/formats/test/rtsreplay-fuzz.test.ts`, `deflate.test.ts` |
| 4 | Größen-Gate 30 min 1v1: CMDS ≤ 100 KB, gesamt ≤ 250 KB (synthetisch, gegated) + Langpartie gemessen | ✅ 80.416 B / 91.924 B; Langpartie 80.624 B | `tools/headless/test/replay-size.test.ts`, `heavy pnpm --filter @faf/headless replay-size -- --long` |
| 5 | Komprimierte Keyframes alle 600 Ticks, adaptives Budget bis 128 MiB, Restore + Nachsimulieren == Direktlauf, `bench:keyframes` dokumentiert | ✅ | `packages/sim-host/test/replay-keyframes.test.ts`, `heavy pnpm --filter @faf/headless bench:keyframes -- --quick` |
| 6 | Seek beliebig == Direktlauf; Rückwärts-Seek p95 ≤ 2 s, headless ≥ 20x (lokal gemessen) | ✅ p95 50–58 ms, 747–1.142x | `packages/sim-host/test/replay-seek.test.ts`, `heavy pnpm --filter @faf/headless bench:replay` |
| 7 | Konverter FAFL v1/v2 verlustfrei, Sub-Hashes per Nachsimulation, Crash-Logs → Truncated, Taint, verifizieren sich | ✅ | `packages/sim-host/test/replay-convert.test.ts`, `replay-opfs.test.ts` |
| 8 | Hash-Prüfung meldet erste Abweichung mit Tick + Tabelle; Inkompatibilität vor Tick 1 mit `ReplayCompatError` inkl. buildHash | ✅ | `packages/sim-host/test/replay-player.test.ts` |
| 9 | CLI `replay-verify` (Exit 0/1/2), `desync-diff` (erster Tick exakt, Tabelle/Spalte/Entity, Dump-Modus), mit Tests | ✅ (desync-diff zusätzlich Exit 3) | `tools/headless/test/replay-cli.test.ts`, `replay-desync.test.ts`, `replay-divergence.test.ts`, `replay-dump.test.ts` |
| 10 | Golden-Replays + Golden-Logs für alle 5 L2-Goldens, Trail/End-Hashes == Golden, Frische grün, bestehende Goldens bitgleich | ✅ | `heavy pnpm --filter @faf/headless goldens`, `… golden-logs`, `… replay-goldens`, `… replay-verify -- --goldens` |
| 11 | Cross-Engine: Golden-Replays in Node, Chromium, Firefox, WebKit (kalt/warm) bitgleich inkl. Rückwärts-Seek; Hash-Ketten bitgleich | ✅ 100 + 100 Läufe (4 Engines, projektweit „5→4“, STATUS G20) | `heavy pnpm test:xengine` |
| 12 | Grenzen: keine Änderung an sim/nav/render/client/game; sim-host nur `src/replay/**`, `test/replay-*` + Export-Zeile; Lint/dep-cruiser/typecheck/Vitest grün | ✅ | `git status --porcelain -- packages/sim packages/nav packages/render packages/client apps/game` (leer), `git diff --name-only HEAD -- packages/sim-host` (nur `src/index.ts`), `heavy pnpm typecheck`, `heavy pnpm lint`, `heavy pnpm test` |
| 13 | Doku: diese Datei + Kurzabschnitt in `docs/STATUS.md` | ✅ | – |

### Gesamtverifikation p7 (2026-09-30, über `tools/heavy`)

| Befehl | Ergebnis |
|---|---|
| `pnpm install --frozen-lockfile` | ✓ „Already up to date“ |
| `pnpm typecheck` | ✓ (`tsc -b` + `tsc -p tsconfig.tests.json`) |
| `pnpm lint` | ✓ ESLint `--max-warnings 0`, dep-cruiser 462 Module / 1.752 Abhängigkeiten ohne Verstoß |
| `pnpm test` | ✓ 115 Dateien, **1.131 Tests** (87,6 s); davon Track: 18 Dateien, 186 Tests |
| `goldens` / `golden-logs` / `replay-goldens` | ✓ alle 5 „matches golden“ / „up to date“ / „up to date“ (0 Divergenzen) |
| `replay-verify -- --goldens` | ✓ Exit 0, 5/5 bitgleich |
| `replay-size` (`--long`) | ✓ Gate ok |
| `bench:keyframes -- --quick` | ✓ alle Restore-Hashes gleich |
| `bench:replay` und `bench:replay -- --quick` | ✓ Gate ok (lokal gemessen) |
| `test:xengine` | ✓ 100 Hash-Ketten + 100 Replay-Läufe, Playwright 30/30 |
| Grenzen (Tabu-Pakete, sim-host) | ✓ leer bzw. nur `packages/sim-host/src/index.ts` |

Keine Browser-/Vite-Prozesse zurückgelassen.

### Nachbesserungen (p7)

Keine Code-Korrekturen nötig: Alle Prüfbefehle waren beim ersten Lauf grün. Einziger Fehlstart war ein eigener
Aufruffehler bei der Parallelisierung (Argumente `-- --goldens` als ein Wort übergeben → `replay-verify` meldete
korrekt „unbekannte Option“, Exit 2); der korrekte Aufruf lief grün. Parallelisiert wurden nur unabhängige Prüfungen
über das Gate (höchstens 2 gleichzeitig: typecheck ∥ lint, goldens ∥ golden-logs, replay-goldens ∥ replay-verify);
Benchmarks liefen allein.

### Review-Nachbesserungen (2026-09-30)

Alle Befunde hoch/mittel und die niedrigen umgesetzt (Details unter „Abweichungen“ Punkt 11 und in den Abschnitten
Format/Seek/CLI): META.endTick gegen Inhalt geprüft + Wiedergabeende aus dem Inhalt, `replay-verify` Exit 1 bei
unvollständiger Prüfung, toleranter Kopf-Leser + Kompatibilitätsgründe `format`/`protocol` vor dem strikten Parse,
Chunk-Versionen je Chunk + Versions-Dispatch im CMDS-Dekoder, komponierbarer Player (`attach`, `ReplayVerifier`,
`addHashListener`), Mid-Voll-Hash nach Rückwärts-Seek in allen Engines, `desync-diff` meldet bei echter Divergenz immer
Exit 1, Tainted-Flag nur einseitig erzwungen, unbekannte META-Schlüssel erhalten, Test für `KNOWN_SIM_BUILDS`.
Prüfläufe (über `tools/heavy`): `pnpm typecheck` ✓, ESLint auf allen Track-Verzeichnissen ✓, Vitest formats + sim-host +
headless 39 Dateien / 365 Tests ✓, `pnpm test:xengine` 100 Hash-Ketten + 100 Replay-Läufe ✓ (jetzt inkl.
Mid-Voll-Hash-Vergleich), `replay-verify -- --goldens` Exit 0. Golden-Replays unverändert bytegleich (alle
Chunk-Versionen weiter 1).

## Abweichungen vom Plan

1. **Worktree-Pfad:** Der Auftrag nennt `/Users/logge/Documents/Projects/faf-replay`; der Worktree liegt unter
   `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-replay` (`git worktree list`). Alle Pakete haben dort
   gearbeitet; die `verify_commands` in `TRACK-REPLAY.json` gelten sinngemäß für diesen Pfad.
2. **CMDS-Rohkodierung per adaptivem Range-Coder** statt des Varint-Stroms aus dem Plan (p1): Varint + deflate verfehlt
   das Gate mit dem festen Größenmodell deutlich (≈ 134–146 KB); das Modell durfte nicht abgesenkt werden. Blockkopf,
   600-Tick-Blöcke und deflate-raw (codec 1, auch nativ lesbar) bleiben; deflate greift nur, wenn es kleiner ist.
3. **Keyframe-Standard-Level 1** statt 6 (p2): gleiche Größe, 29–44 % schneller; CMDS bleibt bei Level 6.
4. **Restore ohne Scratch-Puffer** (p2): `inflateRaw` hat keinen Ausgabeparameter → ein Puffer je Restore (selten, nicht
   auf dem Tick-Pfad, p50 1,1–3,0 ms).
5. **Zusätze an Schnittstellen** (additiv, keine Umbenennung): u. a. `rtsReplayToInput`, `CmdsBlockRef.chunkOffset`,
   `ReplayDivergence.kind` (`'rule'`/`'sub'` – Sub-Hash-only-Divergenzen werden gemeldet), `ReplayPlayer.result()`,
   Zähler, `verifyReplayFile`-Zusatzfelder, `runReplayVerifyJob(…, clock?)`; Liste in den Fragmenten.
6. **`desync-diff` Exit 3** (nur Aufnahmen weichen ab, Nachsimulationen gleich = Engine-/Build-Desync) zusätzlich zu 0/1/2.
7. **`simBuild` fremder Logs** wird über `KNOWN_SIM_BUILDS` aus der simId rekonstruiert (FAFL speichert SIM_BUILD nicht).
8. **Golden-Logs ohne Allianzen**: `ScenarioBuilder.ally` ist im FAFL-Log nicht abbildbar → `ScenarioLogError`
   (kein bestehendes Szenario nutzt Allianzen).
9. **Cross-Engine mit 4 statt 5 Engines** (Node, Chromium, Firefox, WebKit; Bun → WebKit/JSC wie projektweit seit MS1).
10. **ESLint-Ignore `docs/design/ui-mockups/**`** (p0): `pnpm lint` war durch statische Design-Mockups schon vor dem Track
    rot; keine Regel für Code gelockert.
11. **Review-Nachbesserungen (autonom entschieden):**
    - `META.endTick` ist beschreibend: Leser/Writer lehnen ein Ende vor dem Inhalt ab, der Player nimmt das
      Inhaltsende (+ höchstens hashInterval − 1 Leerlauf-Ticks aus META). Eine obere Schranke im **Leser** gibt es
      bewusst nicht: der Konverter schreibt bei gebrochenem Hash-Raster legitim ein späteres Ende.
    - Kompatibilitätsgründe `format`/`protocol` neu; ältere `protocolVersion` ist `unsupported-version` statt
      `bad-value` (strikter Leser) bzw. Weiterleitung (Player/CLI).
    - `ReplayPlayer.sim` ist jetzt `HeadlessSim | null` (null bei `attach`), die Arbeit läuft über `player.core`;
      `ReplayVerifyResult` hat zusätzlich `recordedUpTo`, `subRecordedUpTo`, `fullyCompared`.
    - `core.onHash` bleibt in `core.ts` unverändert (Track-Regel); der Fan-out `addHashListener` ist Übergangslösung bis
      MS11.

## Offene Punkte

### Für MS11 (N1, Replay im Spiel)

- **Konsolidierung der Doppelimplementierungen (Review):** Keyframe-Ausdünnung, Seek-Logik und Hash-Vergleich gibt es
  derzeit dreifach (`SimCore.seek` + unkomprimierter `KeyframeStore` + `ReplaySource`(FAFL)/`replayLog` im Live-Pfad,
  `ReplayPlayer` + `CompressedKeyframeStore` + `RtsReplaySource`/`verifyReplay` im Track). MS11 soll
  (1) den `KeyframeStore` in `SimCore` durch den `CompressedKeyframeStore` ersetzen (PLAN §3.11 schreibt komprimierte
  Keyframes vor), (2) `SimCore.seek` und `replayLog` auf die Player-Logik (`ReplayPlayer.attach`/`ReplayVerifier`)
  zurückführen und die doppelten Implementierungen entfernen, (3) `core.onHash` in `SimCore` zu einer echten
  Listener-Liste machen und `replay/hash-listeners.ts` streichen, (4) im Worker-Protokoll ein `ctl 'seek'` plus
  Replay-Init (Replay-Bytes → `checkReplayCompat` → `RtsReplaySource` → Core mit `record: false` →
  `ReplayPlayer.attach`) ergänzen und im Scheduler/`SimHost.runTick` nach jedem Replay-Tick `player.observeTick()`
  aufrufen.
- **Replay-Browser:** Metadaten und Kompatibilität ohne vollen Parse über `readRtsReplayHead` +
  `replayBuildIncompatibility` (liefert auch für alte/neuere Format-, Chunk- und Protokollversionen buildHash und
  simBuild für die Weiterleitung).
- **Replay-Browser/Viewer in `apps/game`**: Liste aus OPFS (`listRecordedLogs` liefert nur Namen – Metadaten aus dem
  Kopf lesen), Export als Download, Wiedergabe über `ReplayPlayer`/`RtsReplaySource` im Sim-Worker, Perspektive per
  `ctl.viewer`, Seek-Leiste.
- **`/b/<buildHash>/`-Weiterleitung**: `ReplayCompatError.redirect` nennt den Pfad; Hosting alter Builds und die
  Weiterleitung fehlen noch. Bis dahin werden Golden-Replays bei jedem SIM_BUILD-Bump ersetzt statt archiviert.
- **Wiedergabe ≥ 5x im Browser** mit Rendering messen (headless-Worker-Indiz ≈ 250–330x liegt vor).
- **Tab-Kill-E2E** (Minute 10 → Replay bis ≥ 9:50): Bibliotheksseite in `replay-opfs.test.ts` mit Fake-OPFS belegt,
  echter Browser-Test fehlt. Der Recorder schreibt kein END in die OPFS-Datei → jeder OPFS-Export ist derzeit
  `Truncated`; MS11 soll END + Ergebnis beim Spielende persistieren.
- **Hash-Kadenz 50 im Release** (DECISIONS 14): Format und Player sind intervallneutral (`hashInterval` im HEAD), die
  Golden-Replays nutzen 10; mit der Release-Kadenz Goldens/Größen neu messen (Regel-Hashes 1.800 → 360 je 30 min,
  HASH-Chunk ≈ 10,9 → 5,1 KB).
- **aiTimeout-Marks** (`ReplayMarkKind.AiTimeout` = 8) aus der KI-Pipeline schreiben (Format/Leser fertig).
- **Recorder schreibt Sub-Hashes live** (statt Nachsimulation im Konverter) bzw. direkt `.rtsreplay` über
  `RtsReplayBuilder`.
- Cross-Engine-`desync-diff` im Browser (Dump im Worker erzeugen/herunterladen) – Bibliothek ist worker-tauglich,
  Oberfläche fehlt; Abweichungen nur in abgeleiteten Regionen findet nur der Voll-Dump-Vergleich.
- Langpartie ersetzt Produktion/Kampf durch Cheats (getaintet); ab MS4–MS6 auf echte Ops umstellen und Größe neu messen.
- Keyframe-Messung mit MS3+-State (Waffen, Projektile, Eco) wiederholen; der native Pfad ist nur in Node gemessen.

### Für S10 (Save/Load)

- Container (`@faf/formats`-Chunkformat mit Versionierung, unbekannten Chunks, kanonischem META) und Keyframe-Codec
  (`CompressedKeyframeStore`/`deflateRaw` + `restoreSnapshot` mit Session-Identitätsprüfung) sind direkt wiederverwendbar:
  ein Savegame = HEAD/GAME wie im Replay + ein komprimierter Session-Snapshot + optional der CMDS-Verlauf.
- Seek hält die Zeitlinie fest; „ab hier live weiterspielen“ (Zeitlinie verzweigen, `discardAfter`) ist S10-Arbeit.
