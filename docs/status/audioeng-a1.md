# audioeng-a1 – Decode-Bausteine und Event→Sound-Daten

> **Track:** TRACK-AUDIOENG, Welle 0 · **Stand:** 2026-09-29 · **Pfade:** `packages/audio/src/decode/**`, `packages/audio/src/events/**`, `packages/audio/test/decode/**`, `packages/audio/test/events/**`

## 1. Umgesetzt

**Teil A – `src/decode/` (`@faf/audio/decode`)**, reine TS-Logik ohne Abhängigkeiten (Grundlage der Fallback-Dekodierung von audioeng-b2):

- `ebml.ts`: EBML-Leseprimitive (IDs 1–4 Byte, Größen 1–8 Byte inkl. „unknown size“, uint/int/float/string, VINT-Zahlen für Block-Header und EBML-Lacing), jede Leseoperation gegen ein explizites Ende geprüft. `WebmParseError` mit Byte-Offset.
- `webm.ts`: `demuxWebmOpus(data)` – eigener Parser für WebM/Matroska: Segment und Cluster mit unbekannter Größe (Cluster endet am nächsten Segment-Element), SeekHead/Cues/Tags/Chapters/Attachments/Void/CRC-32/unbekannte Elemente werden übersprungen, SimpleBlock und BlockGroup/Block, Lacing none/Xiph/fixed/EBML, DiscardPadding des letzten Blocks, OpusHead-Prüfung (Magic, Version, Kanalzahl, Mapping-Tabelle). Nur der erste Audio-Track mit `A_OPUS` zählt; Blöcke anderer Tracks werden ignoriert. Pakete sind `subarray`-Views ohne Kopie.
- `opus-packet.ts`: `opusFrameSamples`, `opusPacketFrames`, `opusPacketSamples` (TOC-Config → 2,5/5/10/20/40/60 ms, Code 0/1/2/3 inkl. Frame-Count-Byte; fehlerhafte Pakete und > 120 ms → 0 wie libopus), `expectedOutputSamples(track)`.
- `pcm.ts`: `PcmAssembler` (planar oder interleaved, Pre-Skip über Blockgrenzen, harter Schnitt bei `maxFrames`, Mono→Stereo-Duplizierung, bei exaktem Hint genau eine Allokation je Kanal) und `PcmAssembler.forTrack(track)`.

**Teil B – `src/events/` (`@faf/audio/events`)**, Event→Sound-Mapping als Daten (den Router baut audioeng-b3):

- `kinds.ts`: `SimEventKind` (21 Kinds), `SIM_EVENT_KINDS`, `isSimEventKind`, `DEFAULT_EVENT_TYPE_TABLE` (1..21, bijektiv) + Umkehrung `DEFAULT_EVENT_TYPES`, Flags `EVENT_FLAG_STRUCTURE`/`EVENT_FLAG_AIR`/`EVENT_FLAG_UNLOCATED`, `IMPACT_SURFACES`, `DEATH_SIZE_CLASSES`, `ALERT_KINDS` (11 alt_* mit Index = aux), `alertKindIndex`, `SIM_EVENT_KIND_INFO` (dokumentierte Semantik aller Felder je Kind, Tabelle in §4).
- `default-event-map.json` (Daten) + `sound-map.ts`: Schema, `parseEventSoundMap(json)` mit Pfad in jeder Fehlermeldung (`EventMapError`, z. B. `$.weapons.core:wpn_mg_t1.rate: 2.01 out of range 0.5..2`), normalisierte Form (alle Felder gesetzt), Lookups `weaponSound`, `impactFamilyOf`, `impactSound`, `deathSound`, `collapseAfterDeath`, `alertForIndex`, `referencedSounds`.
- `client-sounds.ts`: `CLIENT_SIDE_SOUNDS` (40 Sounds mit API `playUi`/`play`/`setLoop`, Auslöser, Meilenstein) und `DEFERRED_SOUNDS` (2 Sounds mit Begründung).
- `validate.ts`: `validateEventSoundMap(map, manifest, factions, {weaponRefs?})` → `EventMapIssue[]` (Sound je Fraktion nicht auflösbar, Loop als One-Shot, Nicht-Loop als Burst-Loop, Alert-Sound außerhalb der Alert-Queue bzw. Nicht-Alert als Alert, fehlende Alerts, unbekannte/nicht gemappte Waffen-Refs); `resolveSoundId(ids, name, faction)` (Lookup-Regel `':'` → exakt, sonst `<fraktion>:` → `common:`).
- `index.ts`: exportiert alles plus `DEFAULT_EVENT_MAP_JSON` (Rohdaten) und `DEFAULT_EVENT_SOUND_MAP` (geparst). JSON-Import mit `import … from './default-event-map.json' with { type: 'json' }` – funktioniert mit tsc 5.9 (`tsc -b packages/audio`) und Vitest/Vite ohne Anpassung.

## 2. Öffentliche API

```ts
// @faf/audio/decode
demuxWebmOpus(data: ArrayBuffer | Uint8Array): WebmOpusTrack
class WebmParseError extends Error { readonly offset: number }
interface WebmOpusTrack {
  trackNumber, channels, inputSampleRate, preSkip, outputGainQ8, channelMappingFamily,
  codecDelayNs, seekPreRollNs, opusHead: Uint8Array, packets: readonly Uint8Array[],
  timestampsUs: Float64Array, discardPaddingNs, durationNs: number | null, timecodeScaleNs, docType
}
opusPacketSamples(packet): number; opusPacketFrames(packet): number; opusFrameSamples(toc): number
expectedOutputSamples({packets, preSkip, discardPaddingNs}): number   // Σ − preSkip − round(pad·48k/1e9), ≥ 0
new PcmAssembler(channels, totalSamplesHint?, {skip?, maxFrames?})
  .push(planar: Float32Array[] | interleaved: Float32Array, frames, srcChannels?)
  .finish(minFrames = 0): Float32Array[]      // length, pendingSkip, trimmedFrames
PcmAssembler.forTrack(track)                  // skip = preSkip, maxFrames = hint = expectedOutputSamples

// @faf/audio/events
type SimEventKind; SIM_EVENT_KINDS; DEFAULT_EVENT_TYPE_TABLE; DEFAULT_EVENT_TYPES; SIM_EVENT_KIND_INFO
ALERT_KINDS; alertKindIndex(name); IMPACT_SURFACES; DEATH_SIZE_CLASSES; EVENT_FLAG_*
parseEventSoundMap(json: unknown): EventSoundMap        // throws EventMapError {path}
DEFAULT_EVENT_MAP_JSON; DEFAULT_EVENT_SOUND_MAP
weaponSound(map, ref); impactFamilyOf(map, ref); impactSound(map, family, surfaceAux)
deathSound(map, sizeAux, flags); collapseAfterDeath(map, sizeAux, flags); alertForIndex(map, aux)
referencedSounds(map): {path, sound, use: 'oneShot'|'loop'|'alert'}[]
CLIENT_SIDE_SOUNDS; DEFERRED_SOUNDS (die Namens-Helfer `clientSideSoundNames()`/`deferredSoundNames()` wurden im Review als toter Code entfernt)
validateEventSoundMap(map, manifest: ManifestLike, factions, {weaponRefs?}): EventMapIssue[]
resolveSoundId(ids: ReadonlySet<string>, name, faction): string | null
```

### Schema `EventSoundMap` (normalisiert)

| Feld | Inhalt |
|---|---|
| `version` | `1` |
| `kinds` | je `SimEventKind` eine `EventRule {route: 'sfx'\|'alert'\|'ignore', sound: string\|null, spatial (Default true), gainDb (0), rate (1), then: FollowUp\|null, alert: string\|null}`; fehlende Kinds → `ignore`, unbekannte → Fehler |
| `weapons` | Waffen-Ref `core:wpn_*` → `WeaponSound {sound, gainDb, rate, impact: Familie, burst: {loop, spin, holdMs, gainDb}\|null}` |
| `weaponDefault` | Sound für unbekannte Waffen-Refs oder `null` (= stumm, als unmapped zählen) |
| `impacts` | `{defaultFamily, families: {Familie: {ground, metal?, water?, shield?, structure?}}}`; fehlende Oberfläche → `ground`, `null` = stumm |
| `deaths` | `{small, medium, large, huge}` (aux 0..3) |
| `airDeath`, `structureCollapse`, `commanderDeath` | Absturz (Flag AIR), Einsturz nach Gebäude-Tod (Flag STRUCTURE, Größe ≥ `minSizeClass`, `delayMs`), Lotbruch |
| `alerts` | `alt_*` → `{sound, repeatMs: number\|null (null = Manifest-cooldownMs), radiusWu: number\|null (null = Queue-Default 48 WU)}` |

Grenzen: `gainDb` −24…+6, `rate` 0,5…2, `delayMs` 0…5000, `holdMs` 20…5000. Unbekannte Eigenschaften sind Fehler (fängt Tippfehler). In der JSON-Form darf jede Sound-Referenz ein bloßer Name sein. Sounds stehen als NAME ohne Scope; `'scope:name'` ist erlaubt und wird exakt aufgelöst.

## 3. Verträge für Folgepakete

**audioeng-b2 (Loader/Dekodierkette):**
- `demuxWebmOpus` liefert `opusHead` (WebCodecs-`description`), Pakete und `timestampsUs` (µs, für `EncodedAudioChunk.timestamp`). Lacing-Folgeframes erhalten Blockzeit + Dauer des Vorgängerpakets.
- **opus-decoder nachgemessen:** mit `new OpusDecoder({channels, preSkip: 0})` liefert `decodeFrames(packets)` genau Σ `opusPacketSamples` (55/55 MS5-Varianten); mit `PcmAssembler.forTrack(track)` ergibt das exakt `variants[i].samples`. Mit `preSkip: 312` schneidet der Decoder selbst – dann den Assembler mit `skip: 0` bauen, sonst wird doppelt getrimmt. WebCodecs muss analog nachgemessen werden (`forTrack` oder `new PcmAssembler(ch, expected, {skip: 0, maxFrames: expected})`).
- `WebmParseError` ist die einzige Ausnahme des Demuxers (belegt durch Fuzzing).

**audioeng-b3 (Router)** – Pflichtsemantik der Daten:
- Tabellen-Kinds: `weaponFire` (visual → `visualName` → `weapons[ref]`, sonst `weaponDefault`), `projectileImpact` (visual → Waffe → `impact`-Familie; aux = Oberfläche → `impactSound`), `unitDeath` (aux = Größenklasse, flags → `deathSound` + `collapseAfterDeath`), `commanderDeath` (`commanderDeath`), `alert` (aux → `alertForIndex`).
- `rule.then`: zweiter Sound nach `delayMs` am selben Ort (z. B. `bld_complete` → `sig_bell_small` nach 350 ms; so ist der MS5-Sound `sig_bell_small` angebunden).
- `rule.alert`: zusätzlich diesen Alert (mit Event-Position) in die Alert-Queue legen (`upgradeComplete`, `energyStall`).
- `rule.spatial = false` oder Event-Flag `EVENT_FLAG_UNLOCATED` (0x80) → ohne x/z abspielen.
- `weapons[ref].burst` (nur `core:wpn_gatling_t2`, MS14): keyed Loop je feuernder Einheit (`burst:<handle>`), solange weaponFire binnen `holdMs` nachkommt; `spin` Variante 0 zu Beginn, Variante 1 am Ende. Ein Router ohne Burst-Unterstützung spielt `sound` je Schuss (Fallback `wpn_mg_t1_fire`, Rate 0,85) – nie den Loop als One-Shot.
- Kein Sound der Map ist ein Loop, außer `burst.loop` (per `validateEventSoundMap` gegen das echte Manifest geprüft).

**MS5 (@faf/protocol, Sim, Client):**
- @faf/protocol hängt diese 21 Event-Typen an seine Typliste an (append-only) und der Client übergibt die Zuordnung Typ-ID → Kind als `CreateAudioEngineOptions.eventTypes`. Für MS5 nötig: `weaponFire`, `projectileImpact`, `unitDeath`, `commanderDeath`, `buildComplete`, `reclaimStart`; die übrigen mit ihrem Meilenstein (Tabelle §4).
- Semantik von `visual`/`aux`/`flags`/`pos`/`handle` wie in §4 (maschinenlesbar in `SIM_EVENT_KIND_INFO`).
- `visualName(visual)` muss für Waffen-Visuals die Waffen-Ref `core:wpn_*` aus roster.json/view-Daten liefern.
- Client-Sounds (`CLIENT_SIDE_SOUNDS`) kommen nicht aus Events: UI/Quittungen über `playUi` aus dem Command-Builder, Bau-/Reclaim-Loop je Armee über `setLoop` aus dem Eco-Abschnitt, Bewegung/Projektile/Eco/Ambience über `setLoop`/`play` aus Frame-Daten, Musik bei `gameOver`/Spielstart.

## 4. Event-Kinds (vorläufige Typ-IDs, Feldsemantik)

| Typ | Kind | Bedeutung | visual | aux | flags | Sound (Default-Map) | MS |
|---|---|---|---|---|---|---|---|
| 1 | `weaponFire` | Schuss/Salve (Mündung) | Waffen-Visual → `visualName` → `core:wpn_*` | – | – | `weapons[ref]` | MS5 |
| 2 | `projectileImpact` | Einschlag/Fehlschuss | Visual der abfeuernden Waffe → Einschlag-Familie | Oberfläche 0 ground, 1 metal, 2 water, 3 shield (stumm, `shieldHit` klingt), 4 structure | bit0 Gebäude | `impacts[Familie][Oberfläche]` | MS5 |
| 3 | `unitDeath` | Einheit/Gebäude zerstört (nicht Vogt) | Einheiten-Visual (info) | Größenklasse 0 klein, 1 mittel, 2 groß, 3 riesig | bit0 Gebäude (→ Einsturz), bit1 Luft (→ Absturz) | `exp_small/medium/large`, `exp_air_crash`, danach `exp_structure_collapse` | MS5 |
| 4 | `commanderDeath` | Lotbruch | Vogt-Visual (info) | – | – | `exp_commander` | MS5 |
| 5 | `wreckDestroyed` | Wrack durch Schaden zerstört | Wrack-Visual (info) | – | – | `exp_wreck` | MS14 |
| 6 | `buildStart` | Baustelle gesetzt | Visual des Bauobjekts (info) | – | – | `bld_start` | MS9 |
| 7 | `buildComplete` | Einheit/Gebäude fertig | Visual (info) | – | bit0 Gebäude | `bld_complete`, +350 ms `sig_bell_small` | MS5 |
| 8 | `upgradeComplete` | Werk freigesprochen | Visual (info) | – | – | `sig_bell_mid` + Alert `alt_factory_upgraded` | MS9 |
| 9 | `reclaimStart` | Reclaim beginnt | Visual des Objekts (info) | – | – | stumm (Armee-Loop `rcl_loop` vom Client) | MS5 |
| 10 | `reclaimComplete` | Reclaim-Ziel aufgebraucht | Visual (info) | – | – | `rcl_complete` | MS9 |
| 11 | `factoryRollOff` | Tor öffnet, Einheit rollt heraus (G10) | Werk-Visual (info) | – | – | `fac_rolloff` | MS6 |
| 12 | `unitRollOff` | Einheit freigegeben | Visual (info) | – | – | stumm (Bewegungs-Loops vom Client) | MS6 |
| 13 | `shieldHit` | Schild absorbiert Treffer | Schild-Visual (info) | absorbierter Schaden (info) | – | `shd_hit` | MS13 |
| 14 | `shieldCollapse` | Schild bricht | Schild-Visual (info) | – | – | `shd_collapse` | MS13 |
| 15 | `shieldRestore` | Schild baut sich auf | Schild-Visual (info) | – | – | `shd_up` | MS13 |
| 16 | `overchargeFire` | Abstich abgefeuert (statt weaponFire) | Abstich-Waffen-Visual | abgezogene Energie (info) | – | `wpn_reeve_tapshot_fire` | MS6 |
| 17 | `tapshot` | Abstich detoniert (statt projectileImpact) | Abstich-Waffen-Visual | Schaden (info) | – | `imp_missile` +3 dB, Rate 0,8 | MS6 |
| 18 | `radarContact` | neuer Radar-/Sichtkontakt (gedrosselt) | Kontakt-Visual, 0 = Blip | – | – | `int_contact_new` | MS9 |
| 19 | `massStall` | Masse-Stall beginnt | – | – | bit7 ohne Ort | Alert `alt_mass_stall` | MS9 |
| 20 | `energyStall` | Energie-Stall beginnt (E3) | – | – | bit7 ohne Ort | `eco_flow_stall` (zentriert) + Alert `alt_energy_stall` | MS9 |
| 21 | `alert` | allgemeiner Alert (P8) | – | Alert-Index 0..10 (`ALERT_KINDS`) | bit7 ohne Ort | `alerts[ALERT_KINDS[aux].name]` | MS9 |

`pos` ist immer die Welt-Position (Q20.12, ÷ `FX_ONE`), `handle` die betroffene Einheit (bzw. Armee-Index bei Stalls). Alert-Indizes: 0 `alt_gong`, 1 `alt_commander_danger`, 2 `alt_unit_attacked`, 3 `alt_base_attacked`, 4 `alt_mass_stall`, 5 `alt_energy_stall`, 6 `alt_build_complete`, 7 `alt_factory_upgraded`, 8 `alt_enemy_commander_spotted`, 9 `alt_enemy_air`, 10 `alt_storage_full`.

### Zuordnung der 101 Manifest-Sounds (Test `coverage.test.ts`)

- **Event-Map (59):** 20 Waffen-Sounds (27 Refs, 8 davon Aliase: Riegel I/II Rate 0,92, Funke Rate 1,2/−3 dB, Rost I, Hochrost, Rost II, Elster-Kanone Rate 0,9, Elster-Bombe), 10 Einschläge, 7 Explosionen, `bld_start`, `bld_complete`, `rcl_complete`, `fac_rolloff`, `sig_bell_small`, `sig_bell_mid`, `eco_flow_stall`, 3 Schild-Sounds, `int_contact_new`, 11 Alerts.
- **Client-API (40):** 9 `ui_*`, 7 `ack_*`, `bld_pour_loop`, `rcl_loop`, 7 `mov_*`, 3 `prj_*`, 4 `eco_*`-Loops, `int_radar_ping`, `sig_sounding`, 3 `mus_*`, 3 `amb_*`.
- **Später (2):** `sig_bell_deep` (MS9: Entscheidung audio.md §6, Glocke steckt bis dahin in `exp_commander`), `mov_hover_loop` (post-MVP, kein Hover im Roster).
- Alle 17 MS5-Sounds sind Event-Map oder Client-API mit Meilenstein MS5.

## 5. Abweichungen vom Plan

- **Schema verfeinert:** `impacts` ist `Familie × Oberfläche` statt `Record<surface, sound>` (Einschlagklang hängt von der Waffe ab: shell/bullet/slag/missile/flak/bomb/rail); `deaths` hat benannte Schlüssel `small/medium/large/huge` (Index = aux) plus `airDeath` und `structureCollapse`; zusätzlich `weaponDefault`, `EventRule.then` (Folgesound), `EventRule.alert` (Zusatz-Alert) und `WeaponSound.impact`/`burst`. Die geparste Form ist normalisiert (keine optionalen Felder).
- **Zwei zusätzliche Kinds:** `wreckDestroyed` (für `exp_wreck`) und `upgradeComplete` (für `sig_bell_mid`), sonst wären diese Sounds ohne Auslöser. Flag `EVENT_FLAG_UNLOCATED` (0x80) kennzeichnet Events ohne Ort, weil (0,0,0) ein gültiger Ort ist.
- **Oberfläche 4 `structure`** zusätzlich zu ground/metal/water/shield (für `imp_structure_metal`). Wasser hat keinen eigenen Einschlag-Sound: vorläufig Boden-Sound −6 dB, Rate 0,8.
- **Gatling (`core:wpn_gatling_t2`):** Burst-Loop-Daten statt Einzelschuss; Fallback-Einzelschuss `wpn_mg_t1_fire` (siehe §3).
- `src/events/**` importiert `types.ts` nicht; `validate.ts` nimmt ein strukturelles `ManifestLike` (von `AudioManifest` erfüllt, im Test mit dem echten Manifest belegt).
- **Real-Datei-Test:** `expectedOutputSamples` stimmt für alle 246 Varianten **exakt** mit `variants[i].samples` überein (keine Toleranz nötig). ffmpeg schreibt die Blockzeiten ms-gerundet (Schritte 20/21 ms) und `Info/Duration` aus den Paket-pts (bis 27 ms neben der getrimmten Länge) – der Test prüft dort ±1 ms bzw. ±30 ms.

## 6. Bekannte Grenzen

- Der Demuxer liest nur das erste Segment und nur einen Opus-Track; Verschlüsselung (ContentEncoding), Kanal-Mapping-Familie ≠ 0 wird nur formal geprüft (für > 2 Kanäle nicht getestet, im Bestand gibt es nur mono/stereo).
- Abgeschnittene Dateien werden abgelehnt (strikt), nicht teilweise gelesen.
- Numerische Event-Typen sind vorläufig; `SIM_EVENT_KIND_INFO`-Texte sind Code-Doku (englisch), die Tabelle oben ist die deutsche Fassung.

## 7. Tests und Selbsttest

62 Tests in 9 Dateien:

| Datei | Tests | Inhalt |
|---|---|---|
| `test/decode/webm-real.test.ts` | 3 | alle 246 Varianten: fehlerfrei, channels = Manifest, inputSampleRate 48 000, `expectedOutputSamples` = `samples` exakt, Views ohne Kopie, Zeitstempel/Duration plausibel |
| `test/decode/webm-synthetic.test.ts` | 15 | Test-Writer (`ebml-writer.ts`): OpusHead-Felder, Lacing Xiph/fixed/EBML, unknown-size Segment/Cluster, Void/CRC/SeekHead, BlockGroup mit DiscardPadding, TimecodeScale/negative Offsets, Track-Auswahl, falscher Codec/fehlender OpusHead/DocType → `WebmParseError` mit Offset |
| `test/decode/webm-fuzz.test.ts` | 3 | fast-check: 500 Kürzungen/Bitflips echter Dateien, 300 Header-Bitflips, 300 Müll-Eingaben → Ergebnis oder `WebmParseError`, je Fall < 50 ms |
| `test/decode/opus-packet.test.ts` | 5 | alle 32 TOC-Configs, Code 0–3, fehlerhafte Pakete, `expectedOutputSamples` |
| `test/decode/pcm.test.ts` | 8 | Pre-Skip über Blockgrenzen, Trimmen, interleaved/planar, Up-/Downmix, eine Allokation bei exaktem Hint, Wachstum, `forTrack`, Fehlbedienung |
| `test/events/coverage.test.ts` | 6 | Default-Map valide gegen echtes Manifest (varkan, alle Roster-Refs), 101 IDs genau einer Gruppe, 17 MS5-Sounds nicht deferred, 27 Waffen-Refs inkl. Aliase, Manifest-Tags `core:wpn_*` passen zur Map, keine Loops/Alerts falsch geroutet |
| `test/events/sound-map.test.ts` | 12 | Normalisierung, Kurzformen, Parser-Fehlerfälle mit Pfad, Grenzen gainDb/rate/delay, Tabellen-Validierung, Lookups |
| `test/events/kinds.test.ts` | 4 | Pflicht-Kinds, `DEFAULT_EVENT_TYPE_TABLE` bijektiv, Semantik je Kind dokumentiert, `ALERT_KINDS` = 11 Alert-Sounds |
| `test/events/validate.test.ts` | 6 | Lookup-Regel, unauflösbare Sounds je Fraktion, Loop/Alert-Missbrauch, unbekannte/fehlende Waffen-Refs |

Selbsttest (2026-09-29, lokal M5 Pro):

| Befehl | Ergebnis |
|---|---|
| `pnpm exec vitest run packages/audio/test/decode packages/audio/test/events` | ✅ 9 Dateien, 62 Tests, ≈ 0,3 s |
| `pnpm exec tsc -b packages/audio` | ✅ ohne Fehler |
| `tsc -p` (tsconfig.tests.json, eingeschränkt auf `test/decode/**` + `test/events/**`) | ✅ ohne Fehler |
| `pnpm exec eslint packages/audio/src/decode packages/audio/src/events packages/audio/test/decode packages/audio/test/events --max-warnings 0` | ✅ |

Messwerte: Demux aller 246 Dateien (2,85 MB) ≈ 31 ms in Node; Zusatz-Fuzz mit 50 000 Zufallsfällen: max. 1,2 ms je Fall, nur `WebmParseError`.
