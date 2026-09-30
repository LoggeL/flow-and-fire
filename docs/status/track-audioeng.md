# TRACK-AUDIOENG – Audio-Engine `@faf/audio` (Vorarbeits-Track)

> **Stand:** 2026-09-30 · **Branch:** `track-audioeng` · **Worktree:** `/Users/logge/Documents/Projects/flow-and-fire/.worktrees/faf-audioeng`
> **Plan:** `docs/plans/TRACK-AUDIOENG.json` (Pakete a0 … d1, Abnahme, verify_commands) · **Fragmente:** `docs/status/audioeng-{a0,a1,b1,b2,b3,c1,c2,d1}.md`
> **Kein Meilenstein aus PLAN §5.2**, sondern Vorarbeit für P7 in MS5 (Abnahme Audio: ≤ 32 Stimmen, ≤ 0,5 ms Main-JS, Ack ≤ 1 Frame). Integration in MS5 siehe §11.

Hinweis Pfad: Die `verify_commands` im Plan nennen `/Users/logge/Documents/Projects/faf-audioeng`; dieser Pfad existiert nicht. Der Worktree liegt unter `flow-and-fire/.worktrees/faf-audioeng` (`git worktree list`); alle Befehle wurden dort ausgeführt.

## 1. Überblick

`@faf/audio` ist eine eigenständige Web-Audio-Engine nach PLAN §3.7 und `docs/design/audio.md`:

- **Mixer** mit Bussen master/sfx/ui/alerts/music/ambience, wahrnehmungsgerechter Lautstärkekurve (v²), Rampen statt Sprüngen, Mute-Quellen (Nutzer, verborgener Tab, System), Ducking bei Alerts und Master-Limiter mit Makeup-Kompensation und hartem Sicherheits-Clip.
- **Voice-Manager** mit 32 logischen Stimmen, Limits je Sound/Kategorie aus dem Manifest, Priorität, Voice-Stealing mit 8-ms-Fade und begrenztem Tail-Budget, Cooldown je Sound, Varianten-Rotation ohne direkte Wiederholung mit ±3 % Tonhöhe, Loops mit Loop-Punkten aus `content/audio/dist/manifest.json`, keyed Loops (`setLoop`).
- **Lookup** `<fraktion>:<name>` → `common:<name>` (plus exakte fq-ids), dichte Indizes im Hot Path.
- **Räumliches Modell**: Pan nach Kamera-Rechtsvektor, Dämpfung nach Abstand zur Bildmitte und Kamerahöhe je Kategorie-Profil, Culling vor der Stimmenvergabe.
- **Alert-Queue** mit Priorität, Wiederholintervall je Alert, Orts-Ausnahme, Verfall, einer Alert-Stimme und Verlauf mit Sprung-zum-Ort (wiederholt = zurückblättern).
- **Event→Sound-Mapping als validierte JSON-Daten**; der Router nimmt jede `AudioEventSource` (strukturell = Event-Accessoren des FrameReader aus PLAN §3.6, Event 32 B) ohne Import von `@faf/protocol`.
- **Lade-/Dekodier-Pipeline**: Manifest-Validierung, priorisiertes paralleles Laden (≤ 6), Lazy-Nachladen, Kette `decodeAudioData` → WebCodecs → WASM (`opus-decoder`, eigener Chunk).
- **Autoplay-Unlock** (erste Geste → `running`, Re-Lock nach Suspend) und **Settings** (Lautstärken, Mute, Mute bei verborgenem Tab; localStorage).
- **Demo** `apps/audio-demo` (Gefecht mit 200 Schüssen/s, HUD, Kamera) plus Browser-Tests mit echtem (Offline)AudioContext in Chromium, Firefox und WebKit.

`@faf/audio` ist ein **Blatt-Paket** (keine Workspace-Abhängigkeiten, einzige npm-Abhängigkeit `opus-decoder`), reiner Präsentationscode: kein Import von Sim-Paketen, keine Rückwirkung auf Sim-State oder Hashes (dependency-cruiser-Regeln `audio-is-leaf`, `audio-npm-deps`, `presentation-never-imports-sim`, `sim-never-imports-presentation`).

## 2. Paketstruktur und öffentliche API

| Modul (`@faf/audio/<modul>`) | Zeilen | Inhalt | Fragment |
|---|---|---|---|
| `types.ts`, `ports.ts` (Wurzel `@faf/audio`) | – | Verträge: Kategorien, Busse, Manifest-Typen, `PlayRequest`, `VoiceHandle`, `SoundSink`, `ListenerState`, `SpatialModel`, `AudioEventSource`/`ArrayEventSource`, `AlertRequest`/`AlertRecord`, `AudioSettings`, `AudioEngine`, `CreateAudioEngineOptions`; Web-Audio-Ports `*Like` | a0 |
| `decode` | 895 | EBML/WebM-Demuxer, Opus-Paketlängen, `PcmAssembler` (Pre-Skip, DiscardPadding) | a1 |
| `events` | 1036 | `SimEventKind` (21), vorläufige Typtabelle, `default-event-map.json`, Parser/Validierung, Client-Sounds, Lookup-Regel | a1 |
| `mixer` | 319 | `Mixer`, Kurve, Ducking, Mute-Quellen, Limiter + Makeup + Clip | b1, d1 |
| `settings` | 254 | Controller, localStorage-/Memory-Store, Bindung an Mixer, Tab-Mute | b1 |
| `voices` | 1032 | `VoiceManager` (SoundSink), `LoopSet`, Statistik | b1 |
| `catalog` | 610 | `parseManifest`, `SoundCatalog` (SoundResolver, Pufferspeicher, URLs) | b2 |
| `loader` | 1153 | `createDecodeChain`, `SoundLoader`, `loadManifest` | b2 |
| `unlock` | 209 | `AutoplayUnlocker` | b2 |
| `spatial` | 223 | `CameraSpatialModel`, `SPATIAL_PROFILES` | b3 |
| `alerts` | 367 | `AlertQueue` | b3 |
| `router` | 663 | `EventRouter` (subTick-Staffelung, Aggregation, allokationsfrei) | b3 |
| `engine` | 768 | `createAudioEngine` → `FafAudioEngine` (Fassade), `timingStats` | c1 |

Insgesamt 8 477 Zeilen in `packages/audio/src`, Barrel `@faf/audio` exportiert alles; Apps importieren bevorzugt `@faf/audio/<modul>` (`package.json` `exports: {'.': './src/index.ts', './*': './src/*/index.ts'}`).

**Fassade (`AudioEngine` aus `types.ts`, erweitert zu `FafAudioEngine`):**

```ts
const audio = createAudioEngine({ baseUrl: '/audio/', faction: 'varkan', visualName, eventTypes, onJumpTo, onAlert });
await audio.ready;                          // Manifest geparst, Kern gebaut
void audio.load({ tags: ['MS5'] });         // Rest lazy
// je Frame:
audio.setListener(listener);                // nur bei Kamerabewegung nötig
audio.handleEvents(frameReader);            // ein Batch je Sim-Frame
audio.update(performance.now());
// Eingabe/HUD:
audio.playUi('ack_pip_direct');             // synchron gestartet
audio.setLoop('build:0', { sound: 'bld_pour_loop', x, z, gain, rate });  // null = Stopp mit Fade
audio.alert({ kind: 'alt_base_attacked', x, z });  audio.jumpToLastAlert();
audio.settings.set({ sfx: 0.6 });           // persistiert ('faf.audio.v1')
audio.stats();                              // Stimmen je Kategorie, Steals, Drops je Grund, Main-JS p50/p95/p99, Dekodierpfade, Latenzen
```

Vollständige Signaturen je Modul: Fragmente a0 (Verträge), a1, b1, b2, b3, c1 (§2 jeweils) und `packages/audio/README.md`.

## 3. Architektur

### 3.1 Audio-Graph

```
Stimme:   AudioBufferSource ──▶ Gain (Regel-Gain × räumlicher Gain) ──▶ StereoPanner ──┐
                                                                                        ▼
Bus:      input(sfx|ui|alerts|music|ambience) ──▶ user(bus) ──▶ duck(bus) ──┐
                                                                            ▼
Master:   user(master) ──▶ mute ──▶ Limiter (DynamicsCompressor) ──▶ makeup (−1,71 dB) ──▶ clip (WaveShaper ±1) ──▶ destination
```

- Manifest-Bus `voice` → Bus `alerts` (Quittungen + Alerts), `sfx`/`ui`/`music`/`ambience` unverändert (`MANIFEST_BUS_TO_BUS`).
- Regler v² (0,5 → −12 dB), Änderungen als `setTargetAtTime` (τ 15 ms); Mute-Quellen `user`/`hidden`/`system` (ODER-verknüpft).
- Ducking bei Alert-Start: sfx −6 dB, music/ambience −8 dB, Attack 30 ms, Hold = Alert-Dauer, Release 400 ms; überlappend gewinnt die tiefste Absenkung.
- **Limiter:** −3 dB, Knie 0, Ratio 20, 3/120 ms. Der Web-Audio-Kompressor addiert laut Spec automatisch einen Makeup-Gain `(1/fullRangeGain)^0,6` (+1,71 dB); der Knoten `makeup` nimmt ihn zurück, der WaveShaper `clip` (2-Punkt-Identitätskurve) ist die letzte Sicherung. Gemessen mit 32 lauten Stimmen im echten OfflineAudioContext (ungebremst Peak 7,74): Chromium/WebKit **0,963**, Firefox **0,729** – schon ohne Clip ≤ 1,0 (ohne Makeup-Kompensation wären es 1,173 in Chromium/WebKit, Befund aus c2, in d1 behoben).

### 3.2 Voice-Regeln (Voice-Manager, `src/voices/voice-manager.ts`)

Reihenfolge je `play()`; der erste zutreffende Grund verwirft (Drop-Grund in der Statistik):

1. Auflösen (`unknownSound`), 2. geladen? sonst Lazy-Anforderung (`notLoaded`), 3. Cooldown je Sound (`cooldown`; für Kategorie `alert` aus – das Intervall verwaltet die Alert-Queue), 4. Variante zufällig ohne direkte Wiederholung, 5. Räumlich + Culling **vor** der Stimmenvergabe (`culled`, auch Gain < −48 dB), 6. Limits mit Priorität `p = Sound-Priorität + priorityBoost`:
   - Sound- und Kategorie-Limit: Opfer = leiseste Stimme desselben Sounds bzw. derselben Kategorie mit Priorität ≤ p (Loops nur bei streng höherer Priorität), gestohlen nur, wenn der neue Sound mindestens so laut ist (`soundLimit`/`categoryLimit`).
   - Global (32): Opfer = leiseste Stimme mit **streng niedrigerer** Priorität, Gleichstand → älteste (`globalLimit`). Höhere Priorität wird nie von niedrigerer verdrängt.
   - Lautheit einer laufenden Stimme = effektiver Gain × Restanteil.
7. **Stealing/Tail-Regel:** Die gestohlene Stimme gibt ihren Platz sofort frei und blendet vom aktuell spielenden Gain in **8 ms** linear aus (`handle.stop()` Standard 40 ms). Tails zählen nicht zu den 32 Plätzen, sind aber auf **8** begrenzt; ist das Budget voll, wird der älteste Tail hart geschnitten. Damit klingen höchstens 40 Quellen gleichzeitig.
8. Start: `source → gain → panner → busInput`; Rate × (1 ± 0,03), ohne Jitter bei Loops/Musik/Alerts; ui/ack immer `start(0)` synchron im Aufruf (auch bei vollem Pool, Steal über Priorität 80/85).
9. Loops: `loopStart/loopEnd` = `loop.startS/endS` in **Sekunden** (korrekt für resampelte Puffer, belegt bei 44,1 kHz im Browser).

### 3.3 Dekodierkette (`src/loader/decode-chain.ts`)

1. **native** `decodeAudioData(Kopie)`; Länge gegen Manifest (Fenster ±2 Opus-Frames, Abweichung = `suspicious`, akzeptiert). Einmalige Fähigkeitsprobe je Kontext mit der kleinsten Datei; ist native nicht verfügbar, wird es übersprungen.
2. **webcodecs** `AudioDecoder` (Opus, OpusHead als `description`) über den eigenen WebM-Demuxer, PCM-Montage mit automatischer Pre-Skip-Erkennung (`webcodecsTrim`), sample-exakt.
3. **wasm** `import('opus-decoder')` (eigener Chunk `opus-decoder-*.js`, 88 KB, WASM eingebettet), `preSkip: 0` + eigener Trim, sample-exakt.
4. Scheitert alles: `DecodeError` mit Versuchskette; nur dieser Sound bleibt stumm (andere Varianten/Sounds unberührt).

### 3.4 Unlock und Zustände

`AutoplayUnlocker`: Engine startet `locked`; `pointerdown`/`keydown`/`touchend` (capture, passive) → `resume()` + 1-Sample-Stille (iOS) → `running`, danach Listener entfernt. `suspended`/`interrupted` → Zustand `suspended`, Listener wieder scharf. In `locked`/`suspended` werden Gefechts-Events und One-Shots verworfen (Drop `locked`, nie nachgeholt); Alerts füllen weiter den Verlauf, keyed Loops starten beim Übergang nach `running`.

### 3.5 Frame-Ablauf

`handleEvents(src)` → `EventRouter.handle` (Typ → Kind über `Int16Array`, Sound-Indizes vorab aufgelöst, `when = ctxTime + (Δtick + subTick/256) · 0,1 s / simSpeed`, Aggregation gleicher Sounds je Achtel-Tick-Zelle mit +10·log10(n) dB, max. +6 dB) → Gate (Zustand, Mute) → `VoiceManager.play`. `update(now)` → Alert-Queue, LoopSet-Retries, Aufräumen verlorener `onended`, Main-JS-Ring (1024 Frames). Hot Path allokationsfrei (typisierte Arrays, wiederverwendete Requests, vorab gebaute Handler; einzige Allokationen = die drei Web-Audio-Knoten + ein Handle je gestarteter Stimme). Gemessen wird **Allokation inkl. Müll** (`bench/heap.ts`: `v8.GCProfiler` summiert die während der Schleife freigegebenen Bytes, kein `gc()` vor dem zweiten Messwert), nicht nur der gehaltene Heap. Dafür bleiben die numerischen Felder der wiederverwendeten Requests dauerhaft Doubles (Position/Ort über `PlayRequest.spatial`/`AlertRequest.located` statt `undefined`), Doubles laufen im Router über Felder statt über Parameter nicht inlinierter Aufrufe, und `nowMs` je Play wird auf ganze ms gerundet (Smi).

## 4. Event→Sound-Daten

Quelle: `packages/audio/src/events/default-event-map.json` (Schema und Parser `sound-map.ts`, Validierung gegen das echte Manifest in `validate.ts`, Test `test/events/coverage.test.ts`). Vorläufige Typ-IDs aus `DEFAULT_EVENT_TYPE_TABLE` (`src/events/kinds.ts`); MS5 legt die endgültigen IDs in `@faf/protocol` fest und übergibt die Zuordnung als `eventTypes`.

**Die Spalten `aux`/`flags` sind die VORLÄUFIGE Audio-Kodierung (Demo, Tests), kein Vertrag für Sim oder render-fx.** Die verbindliche Kodierung legt `@faf/protocol` in MS5 append-only fest; der Client übersetzt sie über einen `EventCodec` (`src/events/codec.ts`, Engine-Option `eventCodec`): `impactSurface(aux, flags)` → Audio-Oberfläche (−1 = stumm), `alertIndex(aux)`, `unlocatedMask`, und `visualDeathProfile(visual)` → `{sizeClass, air, structure}` aus den View-Daten. Die **Todes-Größenklasse ist Präsentationsdaten** und kommt aus `visual` (= Blueprint-Sim-ID), nicht aus `aux` – so bricht eine klangliche Umstufung weder `sim.bin`/`bpSimHash` noch Replays (PLAN §3.1). `aux`/`flags` bei `unitDeath` gelten nur als Rückfall ohne Profil.

| Typ | Kind | visual | aux | flags | Sound (Default-Map) | MS |
|---|---|---|---|---|---|---|
| 1 | `weaponFire` | Waffen-Visual → `visualName` → `core:wpn_*` | – | 0x80 ohne Ort | `weapons[ref]` (27 Refs, 7 Aliase mit Rate/Gain) | MS5 |
| 2 | `projectileImpact` | Visual der Waffe → Einschlag-Familie | Oberfläche über `impactSurface` (vorläufig: 0 ground, 1 metal, 2 water, 3 shield (stumm), 4 structure) | 0x01 Gebäude | `impacts[Familie][Oberfläche]` | MS5 |
| 3 | `unitDeath` | Einheit = Blueprint-Sim-ID → `visualDeathProfile` (Größe, Luft, Gebäude) | nur Rückfall: Größe 0–3 | nur Rückfall: 0x01 Gebäude, 0x02 Luft | `exp_small/medium/large`, `exp_air_crash`, + `exp_structure_collapse` | MS5 |
| 4 | `commanderDeath` | Vogt (Info) | – | – | `exp_commander` (kartenweit, zentriert) | MS5 |
| 5 | `wreckDestroyed` | Wrack (Info) | – | – | `exp_wreck` | MS14 |
| 6 | `buildStart` | Bauobjekt (Info) | – | – | `bld_start` | MS9 |
| 7 | `buildComplete` | Visual (Info) | – | 0x01 Gebäude | `bld_complete`, +350 ms `sig_bell_small` | MS5 |
| 8 | `upgradeComplete` | Werk (Info) | – | – | `sig_bell_mid` + Alert `alt_factory_upgraded` | MS9 |
| 9 | `reclaimStart` | Objekt (Info) | – | – | stumm (Armee-Loop `rcl_loop` per `setLoop`) | MS5 |
| 10 | `reclaimComplete` | Objekt (Info) | – | – | `rcl_complete` | MS9 |
| 11 | `factoryRollOff` | Werk (Info) | – | – | `fac_rolloff` | MS6 |
| 12 | `unitRollOff` | Einheit (Info) | – | – | stumm | MS6 |
| 13 | `shieldHit` | Schild (Info) | Schaden (Info) | – | `shd_hit` | MS13 |
| 14 | `shieldCollapse` | Schild (Info) | – | – | `shd_collapse` | MS13 |
| 15 | `shieldRestore` | Schild (Info) | – | – | `shd_up` | MS13 |
| 16 | `overchargeFire` | Abstich-Waffe | Energie (Info) | – | `wpn_reeve_tapshot_fire` | MS6 |
| 17 | `tapshot` | Abstich-Waffe | Schaden (Info) | – | `imp_missile` +3 dB, Rate 0,8 | MS6 |
| 18 | `radarContact` | Kontakt, 0 = Blip | – | – | `int_contact_new` | MS9 |
| 19 | `massStall` | – | – | 0x80 | Alert `alt_mass_stall` | MS9 |
| 20 | `energyStall` | – | – | 0x80 | `eco_flow_stall` + Alert `alt_energy_stall` | MS9 |
| 21 | `alert` | – | Alert-Index 0–10 | 0x80 | `ALERT_KINDS[aux]` (11 `alt_*`) | MS9 |

`pos` = Weltposition Q20.12 (÷ 4096 → WU), `handle` = Einheit (bzw. Armee bei Stalls). Zuordnung aller **101 Manifest-IDs**: 59 Event-Map, 40 Client-API (`playUi`/`play`/`setLoop`: 9 `ui_*`, 7 `ack_*`, Bau-/Reclaim-Loop, 7 `mov_*`, 3 `prj_*`, 4 `eco_*`-Loops, `int_radar_ping`, `sig_sounding`, 3 `mus_*`, 3 `amb_*`), 2 später begründet (`sig_bell_deep` MS9, `mov_hover_loop` post-MVP). Alle 17 MS5-Sounds sind abspielbar (Event-Map oder Client-API).

## 5. Messwerte (lokal gemessen, Apple M5 Pro, 48 GB, macOS/darwin 27.0.0 – kein Referenz-Laptop, DECISIONS 5)

Das 0,5-ms-Budget wird **gemeldet, nicht gegated**; hartes Gate nur mit `FAF_AUDIO_PERF_GATE=1` (DECISIONS 16, 36).

### 5.1 Node-Benchmark „Gefecht-200“ (`pnpm --filter @faf/audio bench`)

Echte Engine gegen schlanken Fake-Kontext (`bench/lean-context.ts`, ohne native Web-Audio-Kosten), 30 s simuliert je Lauf, 2 Läufe je Rate. Tabelle wird von `--update-docs` geschrieben:

<!-- bench:audio:start -->
Lokal gemessen (Apple M5 Pro, Node 24.18.0, 2026-09-30); 30 s simuliert je Lauf, 60 fps, 10-Hz-Ticks, 3 s Warm-up; schlanker Fake-Kontext (bench/lean-context.ts). Engine-JS = handleEvents + update je Frame in ms. Grenze p95 ≤ 0,5 ms wird nur gemeldet (DECISIONS 5/16).

| Schüsse/s | Lauf | Events/s | JS p50 | JS p95 | JS p99 | JS max | p95 Event-Frames | Stimmen peak | gestartet | Steals | Drops (je Grund) | Heap gehalten | alloziert |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 1 | 183 | 0,0003 | 0,0108 | 0,0360 | 0,4095 | 0,0365 | 27 | 2062 | 2048 | cd 1804 · cat 744 · cull 285 | 264 KB | 5475 KB |
| 100 | 2 | 183 | 0,0003 | 0,0060 | 0,0132 | 0,0439 | 0,0137 | 27 | 2073 | 2067 | cd 1829 · cat 724 · cull 274 | 96 KB | 4469 KB |
| 200 | 1 | 358 | 0,0003 | 0,0097 | 0,0195 | 0,2061 | 0,0205 | 27 | 2536 | 2532 | cd 4109 · cat 1359 · cull 344 | 31 KB | 5028 KB |
| 200 | 2 | 358 | 0,0002 | 0,0072 | 0,0091 | 0,0405 | 0,0095 | 27 | 2525 | 2522 | cd 4039 · cat 1407 · cull 349 | 17 KB | 3925 KB |
| 400 | 1 | 708 | 0,0002 | 0,0100 | 0,0141 | 0,0398 | 0,0154 | 27 | 2817 | 2814 | cd 7806 · cat 2142 · cull 302 | 42 KB | 5035 KB |
| 400 | 2 | 708 | 0,0002 | 0,0102 | 0,0210 | 0,0866 | 0,0216 | 27 | 2751 | 2748 | cd 7756 · cat 2178 · cull 329 | 20 KB | 6125 KB |

Drop-Kürzel: cd = cooldown, cat = categoryLimit, snd = soundLimit, glob = globalLimit, cull = culled (unhörbar), nl = notLoaded.
„Heap gehalten“ = nach gc() noch lebender Zuwachs (Leck-Indikator). „alloziert“ = während des Laufs allozierte Bytes inkl. Müll (bench/heap.ts, kein gc() vor dem zweiten Messwert) — enthält Szenario-Treiber und die Fake-Knoten je gestarteter Stimme; der Event-Pfad selbst ist allokationsfrei (test/router/alloc.test.ts, test/engine/alloc.test.ts).
<!-- bench:audio:end -->

Wertebereich über die Läufe (2026-09-30, Läufe aus c1 und d1): Gefecht-200 Engine-JS p95 **0,0066–0,0078 ms**, p95 der Frames mit Event-Batch 0,0078–0,014 ms; Gefecht-400 p95 0,0095–0,0099 ms. Heap-Zuwachs warm ≤ 263 KB über 30 s.

### 5.2 Browser (`pnpm --filter @faf/audio-demo bench:browser`)

Demo-Gefecht, Kamera auf der Front (Höhe 90 WU), je Browser und Rate 3 × 20 s nach 2 s Warm-up, Median der Läufe; COOP/COEP aktiv (Timer 5 µs Chromium, 20 µs Firefox/WebKit). Tabelle wird von `--update-docs` geschrieben:

<!-- bench:audio-browser:start -->
Gemessen 2026-09-30 01:46 UTC auf Apple M5 Pro, 48 GB, darwin 27.0.0; je Browser und Rate 3 × 20 s nach 2 s Warm-up (Kamera auf der Front, Höhe 90 WU), Median der Läufe. Main-JS = `engine.stats().mainJs` (Engine-eigene Messung je Frame: handleEvents + play/playUi + setLoop + setListener + update, letzte 1024 Frames); „Aufrufe“ = Messung der Demo um alle Engine-Aufrufe über den ganzen Lauf, „Tick-Frames“ = nur Frames mit Sim-Tick (Event-Batch, ≈ jeder 6. Frame bei 60 fps). Budget 0,5 ms p95 wird nur berichtet (DECISIONS 16).

| Browser | Schüsse/s | Main-JS p50 | p95 (Spanne) | p99 | max | Aufrufe p95 | Tick-Frames p95 / p99 | Generator p95 | Stimmen max | gespielt/s | gestohlen/s | verworfen/s | Frames | Dekodierpfad | Laden | Timer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| chromium 153.0.8010.12 | 200 | 0,005 | **0,190** (0,190–0,240) | 0,270 | 9,550 | 0,200 | 0,290 / 0,510 | 0,065 | 25/32 | 61 | 59 | 256 | 1200 | native 200 | 103 ms | 0,005 ms (COI) |
| chromium 153.0.8010.12 | 400 | 0,005 | **0,225** (0,215–0,250) | 0,340 | 25,630 | 0,245 | 0,355 / 1,465 | 0,130 | 26/32 | 66 | 65 | 368 | 1197 | native 200 | 105 ms | 0,005 ms (COI) |
| firefox 155.0 | 200 | 0,000 | **0,180** (0,160–0,260) | 0,280 | 1,800 | 0,200 | 0,360 / 0,500 | 0,120 | 25/32 | 61 | 59 | 256 | 1200 | native 200 | 374 ms | 0,020 ms (COI) |
| firefox 155.0 | 400 | 0,000 | **0,180** (0,180–0,200) | 0,280 | 0,540 | 0,200 | 0,300 / 0,460 | 0,120 | 26/32 | 65 | 65 | 370 | 1200 | native 200 | 330 ms | 0,020 ms (COI) |
| webkit 26.6 | 200 | 0,000 | **0,140** (0,140–0,180) | 0,180 | 0,340 | 0,140 | 0,200 / 0,260 | 0,080 | 25/32 | 61 | 59 | 255 | 1200 | native 200 | 316 ms | 0,020 ms (COI) |
| webkit 26.6 | 400 | 0,000 | **0,160** (0,160–0,160) | 0,220 | 5,960 | 0,180 | 0,240 / 0,300 | 0,120 | 26/32 | 65 | 65 | 368 | 1200 | native 200 | 308 ms | 0,020 ms (COI) |

Drops je Grund (Median je Sekunde):

| Browser | Schüsse/s | cooldown | categoryLimit | soundLimit | globalLimit | culled | notLoaded | unknownSound | locked | muted |
|---|---|---|---|---|---|---|---|---|---|---|
| chromium | 200 | 112 | 51 | 0 | 0 | 93 | 0 | 0 | 0 | 0 |
| chromium | 400 | 182 | 84 | 0 | 0 | 95 | 0 | 0 | 0 | 0 |
| firefox | 200 | 114 | 51 | 0 | 0 | 93 | 0 | 0 | 0 | 0 |
| firefox | 400 | 182 | 85 | 0 | 0 | 95 | 0 | 0 | 0 | 0 |
| webkit | 200 | 112 | 49 | 0 | 0 | 94 | 0 | 0 | 0 | 0 |
| webkit | 400 | 185 | 84 | 0 | 0 | 94 | 0 | 0 | 0 | 0 |
<!-- bench:audio-browser:end -->

Wertebereich Main-JS p95 über die Läufe (je 3 Läufe aus c2, 01:32 UTC, und d1, 01:46 UTC; Gefecht-200 / Gefecht-400):

| Browser | p95 Gefecht-200 | p95 Gefecht-400 | p99 (Median) | Budget 0,5 ms |
|---|---|---|---|---|
| Chromium 153 | 0,155–0,275 ms | 0,175–0,250 ms | 0,235–0,340 ms | eingehalten |
| Firefox 155 | 0,140–0,260 ms | 0,160–0,200 ms | 0,240–0,340 ms | eingehalten |
| WebKit 26.6 | 0,140–0,180 ms | 0,160–0,220 ms | 0,180–0,280 ms | eingehalten |

Einzelne Ausreißer-Frames (max. bis 25,6 ms in Chromium bei 400/s, 9,5 ms bei 200/s, 6 ms in WebKit) treten sporadisch in einzelnen Läufen auf (GC/Headless-Planung) und fallen nicht in p99; das Budget gilt für p95.

### 5.3 E2E-Lauf d1 (10 s Gefecht-200, `test:e2e`)

| | Chromium 153 | Firefox 155 | WebKit 26.6 |
|---|---|---|---|
| `engine.mainJs` p50 / p95 / p99 | 0,005 / 0,245 / 0,405 ms | 0,020 / 0,220 / 0,380 ms | 0,020 / 0,200 / 0,440 ms |
| Stimmen max (Tails) | 25/32 (8) | 25/32 (8) | 25/32 (8) |
| gespielt / gestohlen / verworfen | 617 / 569 / 2497 | 611 / 561 / 2505 | 615 / 566 / 2507 |
| Laden 77 Sounds / 200 Varianten (45,2 MiB) | 128 ms | 383 ms | 396 ms |
| base / outputLatency | 5,3 / 16,0 ms | 0 / 7,4 ms | 2,7 / 1,0 ms |
| Ack bei vollem Pool (32/32): Starts im Klick-Handler | 2 × `start(0)`, Handler 0,34 ms | 2 × `start(0)`, 0,16 ms | 2 × `start(0)`, 0,24 ms |

Die Geräte-Ausgabelatenz (`baseLatency` + `outputLatency`) kommt zur Ack-Zeit hinzu (headless: Null-/Standardgerät, nur Richtwerte); die Demo zeigt beide Werte im HUD.

## 6. Dekodierpfad je Browser

| | Chromium 153 | Firefox 155 | WebKit 26.6 | Node 24 (Tests) |
|---|---|---|---|---|
| Standardkette | **native** 21/21 (Offline-Fall), 200/200 (Demo) | **native** 21/21, 200/200 | **native** 21/21, 200/200 | native abgelehnt (kein Opus) → kein WebCodecs → **wasm** |
| Länge vs. Manifest (native) | exakt | 1 Sample kürzer (im Fenster ±1920) | exakt | – |
| erzwungen webcodecs / wasm | 21 / 21 sample-exakt, `webcodecsTrim = decoder` | 21 / 21, `decoder` | 21 / 21, `decoder` | wasm: alle 246 Varianten exakt |
| Korrelation zwischen Pfaden | 1,0 | 1,0 | 1,0 | – |
| native Dekodierzeit (21 Dateien) | ≈ 42–48 ms | ≈ 78–97 ms | ≈ 74–79 ms | wasm ≈ 2,2 ms/Datei |
| 44,1-kHz-Kontext (Loop-Fall) | native, Puffer 44 100 Hz | native, 44 100 Hz | native, 44 100 Hz | Fake: Loop-Punkte in Sekunden |

`webcodecsTrim = decoder`: Der `AudioDecoder` wendet den OpusHead-Pre-Skip in allen drei Engines selbst an; die Kette erkennt das automatisch.

## 7. Speicherbilanz dekodierter Sounds (48 kHz, Float32)

| Satz | Sounds / Varianten | Bytes |
|---|---|---|
| gesamter Bestand | 101 / 246 | 82 650 668 B (78,8 MiB) = Σ samples × Kanäle × 4 (Test `decode-real.test.ts`) |
| MS5-Satz (`tags: ['MS5']`) | 17 / 55 | 10 214 768 B (9,74 MiB) |
| Demo-Gefecht (MS5 + Gefechts-Kategorien + Wind) | 77 / 200 | 45,2 MiB |

Nach Kategorie (gesamt): ambience 22,1 MiB (3 × 20-s-Stereo-Loops), weapon 10,0, explosion 8,7, music 8,1, unit 5,1, impact 5,0, build 4,3, signature 3,8, eco 3,3, alert 3,0, shield 1,6, projectile 1,5, ui 1,4, intel 0,6, ack 0,4 MiB. Empfehlung MS5: `load({tags: ['MS5']})`, Rest lazy; ambience/music erst bei Bedarf. Ein 44,1-kHz-Kontext skaliert den nativen Pfad um 44,1/48.

## 8. Abnahme (docs/plans/TRACK-AUDIOENG.json „acceptance“)

| # | Kriterium | Status | Beleg |
|---|---|---|---|
| 1 | Blatt-Paket, nur `opus-decoder` (dynamischer Import, eigener Chunk), depcruise-Regeln, Tabu-Pfade unverändert | ✅ | `.dependency-cruiser.cjs` (`audio-is-leaf`, `audio-npm-deps`, `presentation-never-imports-sim`, `sim-never-imports-presentation`); `pnpm lint` grün (511 Module); Build-Chunk `dist/assets/opus-decoder-*.js`; `git status --porcelain -- packages/sim packages/nav packages/render packages/client packages/protocol apps/game` leer. Nach Review: Root-`exclude` schließt nur noch repo-eigene `.d.ts` aus (`^(packages|apps|tools)/.*\.d\.ts$`), damit sieht depcruise typisierte npm-Pakete; Negativtest: temporärer `import fc from 'fast-check'` in `packages/audio/src` → `error audio-npm-deps`, `opus-decoder` erscheint jetzt im Graph |
| 2 | Mixer: 6 Busse, voice → alerts, Kurve monoton, Rampen, Persistenz, Mute + Tab-Mute, Ducking; Limiter Peak ≤ 1,0 bei 32 lauten Stimmen im echten OfflineAudioContext | ✅ | `test/mixer/mixer.test.ts` (14), `test/settings/settings.test.ts` (11), `test/engine/engine.test.ts` (Ducking, Settings, Tab-Mute); E2E `offline.spec.ts › limiter`: Peak 0,963 (Chromium/WebKit) / 0,729 (Firefox), ohne Clip gleich (d1: Makeup-Kompensation + Clip) |
| 3 | Voice-Manager: ≤ 32, Kategorie-/Sound-Limits (Property 10 000, Engine-Szenario, Browser), Priorität/Stealing, Cooldown, Varianten ±3 %, Steal-Fade ≤ 12 ms, Tail-Budget | ✅ | `test/voices/limits.property.test.ts` (10 × 1 000), `voice-manager.test.ts` (33), `test/engine/battle.test.ts` (Gefecht-200/400 je Frame geprüft); E2E `limits` (24 Stimmen, weapon 10/10, impact 8/8, explosion 6/6), Demo-Gefecht (max 25/32, keine Kategorie über Limit), E2E „ack under a full voice pool“ (32/32 im Browser); Steal-Fade 8 ms, Tails ≤ 8 |
| 4 | Loops zwischen `loop.startS/endS` (auch resampelt), Naht ohne Sprung im echten OfflineAudioContext, keyed Loops mit Fade | ✅ | E2E `loop`: Naht 1,38 × Median (48 kHz) bzw. 1,03–1,04 × (44,1 kHz, Puffer 44 100 Hz), Korrelation Durchlauf 2/3 = 1,0 in allen drei Browsern; `voice-manager.test.ts` (Loop-Punkte bei 44,1 kHz), `loop-set.test.ts` (5) |
| 5 | Lookup fraktion → common inkl. fq-ids; 101 IDs zugeordnet; 17 MS5-Sounds abspielbar; 27 Waffen-Refs inkl. 7 Aliase | ✅ | `test/catalog/catalog.test.ts`, `test/events/validate.test.ts`, `test/events/coverage.test.ts` (6); `test/loader/decode-real.test.ts` (alle 55 MS5-Varianten dekodiert); `engine.test.ts` (`load({tags:['MS5']})` = 17) |
| 6 | Event-Map als validierte JSON-Daten; `AudioEventSource` ≡ FrameReader-Accessoren (Typtest); subTick-Staffelung, Aggregation; Router-Hot-Path allokationsfrei (< 1 MB über 100 000 Events) | ✅ | `default-event-map.json` + `sound-map.test.ts` (14 inkl. `withWeaponSounds`); `test/contracts.test.ts` (Typtest gegen den **echten** `FrameReader` aus `@faf/protocol` als devDependency + Laufzeittest `FrameWriter.writeEvent` → `FrameReader` → `EventRouter`); `event-router.test.ts` (23 inkl. `EventCodec`); **Allokation inkl. Müll** (ohne `gc()` vor dem zweiten Messwert, `bench/heap.ts`): `test/router/alloc.test.ts` ≈ 80–95 KB über 100 000 Events (43 000 Plays, 0 GC), `test/engine/alloc.test.ts` Event-Pfad durch die ganze Engine ≈ 380–470 KB über 100 000 Events (alle Plays vom Voice-Manager verworfen); Leck-Test Gefecht 20 000 Frames: gehalten ≈ 30 KB. Vor dem Review-Fix: Router 2,7 MB (≈ 27 B/Event, geboxte Doubles), damals als „−12 KB“ ausgewiesen, weil nur der gehaltene Heap gemessen wurde |
| 7 | Räumlich: Pan nach Rechtsvektor (gedreht), Dämpfung Distanz + Zoom je Profil, Culling vor Stimmenvergabe, nicht räumliche Kategorien; Browser: links ≥ 6 dB | ✅ | `camera-spatial-model.test.ts` (9, inkl. 5 000 Property-Läufe); E2E `pan`: +9,76 / −9,76 / 0 / gedreht −9,76 dB in allen drei Browsern |
| 8 | Alert-Queue: Priorität, Intervall je Alert, Orts-Ausnahme, Verfall, eine Stimme, Verlauf + Sprung (zurückblättern); Demo bewegt Kamera | ✅ | `alert-queue.test.ts` (15), `engine.test.ts` (Orts-Ausnahme hörbar, kein Voice-Cooldown); E2E Demo: Leertaste → Kamera auf (287, 255) in allen drei Browsern |
| 9 | Pipeline: Validierung, ≤ 6 parallel, Lazy, Kette native → webcodecs → wasm; Längen = Manifest (Node/WASM alle MS5-Varianten; Browser ≥ 12 Dateien mit Pfad); Fehler isoliert | ✅ | `manifest.test.ts` (12), `loader.test.ts` (16), `decode-chain.test.ts` (17), `decode-real.test.ts` (2); E2E `decode`: 21 Dateien je Browser, native + erzwungen webcodecs/wasm exakt (§6) |
| 10 | Unlock: locked → Geste → running, Listener entfernt, Re-Lock, gesperrte Kampf-Events verworfen; Fake + Browser-Overlay | ✅ | `unlock.test.ts` (9), `engine.test.ts` (Unlock-Fluss, nicht nachgeholt, Re-Lock); E2E (nach Review hart geprüft): `expect(state).toBe('locked')` vor jedem Overlay-Klick (kein stilles Überspringen), 1 s Gefecht vor dem Klick → `dropped.locked > 0`, `played = 0`, nach dem Klick keine Nachholung (`played` bleibt 0), danach `dropped.locked = 0` |
| 11 | Ack/UI synchron (start ≤ currentTime) auch bei vollem Pool; Ack ≤ 1 Frame; Ausgabelatenz angezeigt/dokumentiert | ✅ | `engine.test.ts` (32 Loops, `start(0)` per Steal); **E2E (d1) „ack under a full voice pool“**: 32/32 belegt, echter Klick → 2 Starts mit `when = 0 ≤ currentTime` im Handler, Handler 0,16–0,34 ms, Steals +2; Latenzen im HUD und §5.3 |
| 12 | Demo: Gefecht-200 + Einschläge/Explosionen/Alerts/Bau-Loops, Kamera, HUD (Stimmen je Kategorie, Drops/Steals, Main-JS); E2E grün in 3 Engines (Port 4583, workers 1), Limits greifen, keine Konsolenfehler | ✅ | E2E 27/27 grün (d1); manuelle Prüfung per Playwright-Screenshot (Chromium, HUD vollständig: Engine, Gefecht, Stimmen je Kategorie, Zähler, Main-JS, Mixer, Alerts; 0 Konsolenfehler/-warnungen; Server beendet) |
| 13 | Main-JS p95 ≤ 0,5 ms bei Gefecht-200 in Chromium/Firefox/WebKit + Node, lokal gemessen, Wertebereich ≥ 2 Läufe | ✅ (lokal gemessen) | §5.1 (Node p95 0,0066–0,0078 ms), §5.2 (Browser p95-Spannen über 3 Läufe), §5.3; Gate nur mit `FAF_AUDIO_PERF_GATE=1` |
| 14 | Vitest mit Fake-AudioContext für alle Module + Browser-Test mit OfflineAudioContext in 3 Engines; typecheck, lint, test gesamt grün | ✅ | Browser-Tests laufen jetzt im Standard-CI: Root-`pnpm test:e2e` (und damit `ci:local`) ruft nach dem Root-Playwright-Lauf `pnpm test:e2e:audio` (= `FAF_AUDIO_SKIP_BUILD=1 pnpm --filter @faf/audio-demo test:e2e`, sequenziell, workers 1, Port `FAF_E2E_PORT`/4583); nach Review 33 Testdateien / 340 Tests (vorher 32 / 333) (`packages/audio` + `apps/audio-demo`); `pnpm typecheck` ✅, `pnpm lint` ✅, `pnpm test` gesamt ✅ (129 Dateien, 1 278 Tests nach d1-Fix); Offline-Fälle in 3 Engines |
| 15 | Doku: dieses Dokument, STATUS-Abschnitt, DECISIONS-Einträge, Verweis in audio.md §6, Plan-JSON | ✅ | `docs/status/track-audioeng.md`, `docs/STATUS.md` („Vorarbeits-Track TRACK-AUDIOENG“), `docs/DECISIONS.md` 30–39, `docs/design/audio.md` §6, `docs/plans/TRACK-AUDIOENG.json` |

## 9. Abweichungen vom Plan (konsolidiert; Details in den Fragmenten)

1. **Eigenes Paket `@faf/audio`** statt Audio-Teil von `packages/client` (PLAN §2 nennt Audio unter client) – DECISIONS 30.
2. **Bus `voice` → `alerts`**; Kurve v² statt dB-linear; Mute-Quellen statt eines Flags (b1) – DECISIONS 31.
3. **Loop-Punkte in Sekunden** (`startS/endS`) statt Samples – DECISIONS 32.
4. **Dekodier-Fallbackkette** native → WebCodecs → WASM (`opus-decoder`, dynamischer Import); `parseManifest` verlangt `sampleRate 48000` (b2) – DECISIONS 33.
5. **Stealing/Tails:** Steal-Fade 8 ms, Tail-Budget 8, ältester Tail wird hart geschnitten; Culling auch für nicht räumliche Anfragen < −48 dB – DECISIONS 34.
6. **Alert-Cooldown** nur in der Queue (Orts-Ausnahme), im Voice-Manager für Kategorie `alert` aus (c1) – DECISIONS 35.
7. **Perf-Gate** nur mit `FAF_AUDIO_PERF_GATE=1` – DECISIONS 36.
8. **Limiter** mit Makeup-Kompensation (−1,71 dB) und WaveShaper-Clip (d1), sonst 1,17 Peak in Chromium/WebKit – DECISIONS 37.
9. Event-Map-Schema verfeinert (Familie × Oberfläche, benannte Größenklassen, `then`, Zusatz-Alert, Burst-Daten), zwei zusätzliche Kinds `wreckDestroyed`, `upgradeComplete`, Flag `0x80` ohne Ort (a1).
10. `commanderDeath` spielt standardmäßig ohne Position (kartenweit), weil das SpatialModel nur Kategorien kennt (b3).
11. AudioContext wird im Konstruktor der Engine erzeugt (nicht lazy), damit die erste Geste ihn sofort entsperren kann (c1).
12. Mute-Gate: One-Shots bei stummem Mixer als `muted` verworfen, Loops laufen stumm weiter (c1).
13. Root-Konfiguration additiv angepasst (a0): tsconfig-References, tsconfig.tests-Include, ESLint-Globals, depcruise-Regeln, `.gitignore`, Lockfile; ESLint ignoriert `docs/design/ui-mockups/**` (sonst von `main` her rot).
14. Pfad der `verify_commands` (`/Users/logge/Documents/Projects/faf-audioeng`) existiert nicht; ausgeführt im tatsächlichen Worktree (Kopf).
15. **Waffe → Sound als Default-JSON im Audio-Paket** statt in den View-Daten (audio.md §6) – DECISIONS 38. Ergänzung nach Review: Engine-Option `weaponSounds` (bzw. `withWeaponSounds(map, json)`) legt Waffeneinträge **über** die Map (neue Refs, Ersatz), statt die ganze Map zu ersetzen.
16. **Feldkodierung injizierbar** (`EventCodec`, DECISIONS 39): `aux`/`flags`-Enums in `kinds.ts` sind nur noch vorläufige Defaults; Todesklasse aus `visual` über View-Daten.
17. **Kontrakt-Erweiterung** `PlayRequest.spatial` / `AlertRequest.located` (false = ohne Position trotz numerischer x/z) für allokationsfreie gepoolte Requests; der Voice-Manager wählt die Variante erst nach dem Culling (gecullte Anfragen ziehen keine Zufallszahl).
18. `@faf/protocol` ist **devDependency** von `@faf/audio` (nur Tests; `src/` bleibt Blatt, depcruise `audio-is-leaf` prüft nur `src/`).

**Integrationsrisiko TRACK-RENDERFX:** `packages/render-fx/src/effects/varkan.ts` verwendet für dieselben Events andere Klassen (Tod small/medium/large/structure/acu, Einschlag ground/ground_large/unit/shield/water) als die vorläufige Audio-Kodierung (aux-Größe small…huge + Flags STRUCTURE/AIR, Oberflächen ground/metal/water/shield/structure). Die Sim kann nur **eine** Kodierung senden. Entscheidung: Die Kodierung gehört in `@faf/protocol` (MS5, append-only), beide Präsentations-Tracks übersetzen per Codec/Mapping; Audio ist darauf vorbereitet (`EventCodec`, Tests mit einer render-fx-artigen Fremdkodierung in `event-router.test.ts`). Todes-/Größenklassen sollten in MS5 überhaupt nicht über `aux` laufen, sondern aus den View-Daten je `visual` kommen.

## 10. Bekannte Grenzen

- Die Node-Werte enthalten keine nativen Web-Audio-Kosten; verbindlich sind die Browser-Messungen. Headless-Browser geben auf ein Null-/Standardgerät aus – `baseLatency`/`outputLatency` sind Richtwerte, keine Gerätelatenz eines Spielers.
- Im Demo-Gefecht erreicht die Engine höchstens 25/32 Stimmen (Kategorie-Limits weapon 10, impact 8, explosion 6 plus Culling außerhalb der Hörweite); das globale Budget wird in `battle.test.ts` (Gefecht-400 + Loops), im Offline-Fall `limiter` und im Ack-E2E ausgereizt.
- Firefox dekodiert nativ 1 Sample kürzer als das Manifest (hörbar irrelevant, Fenster ±1920).
- WASM-Dekodierung läuft auf dem Main-Thread (≈ 2 ms je Datei); nur relevant, wenn ein Browser weder Opus/WebM nativ noch WebCodecs kann (heute keiner der drei).
- Dekodierte Puffer werden nicht automatisch entladen (kein LRU); Router löst mit **einer** Fraktion auf (Zuschauer-Fraktion); Event-Records tragen keinen Armee-/Fraktionsbezug. Für eine zweite Fraktion (post-MVP) muss die Fraktion je Event aus `visual` kommen (Callback `visualFaction`, Slot-/Tabellen-Caches je Fraktion) – DECISIONS 38.
- Burst-Loop der Gatling (`burst:<handle>`, MS14) ist als Daten vorhanden, der Router spielt bis dahin den Einzelschuss-Fallback.
- Die Demo-Szenario-Allokation (Generator, nicht Engine) liegt bei ≈ 0,6 MB über 10 000 Ticks (≈ 0,07 B/Event); nach dem Review-Fix (Prng-Feld initialisiert, keine Double-Argumente in den Schuss-Helfern) statt vorher ≈ 270 MB.
- `stats()`/`alertHistory()` allokieren (nur HUD, nicht pro Frame).

## 11. Integration in MS5

1. **Paket einbinden:** `apps/game` (bzw. `packages/client`) erhält `"@faf/audio": "workspace:*"`; depcruise `client-deps` erlaubt `audio` bereits. Engine einmal beim Spielstart: `createAudioEngine({ baseUrl, faction: <Zuschauer-Fraktion>, eventTypes, eventCodec, visualName, weaponSounds, onJumpTo, onAlert })`, danach `await engine.ready` und `engine.load({ tags: ['MS5'] })` (Rest lazy).
2. **FrameReader als `AudioEventSource`:** Der `FrameReader` aus `packages/protocol/src/frame.ts` erfüllt `AudioEventSource` strukturell (`eventCount`, `eventType/Visual/Tick/SubTick/Flags/Pos/Aux/Handle`, Typtest in `test/contracts.test.ts`). Im Frame-Consumer je neuem Sim-Frame `engine.handleEvents(frameReader)` aufrufen – **einmal je Frame mit Events**, nicht je gerendertem Bild; `engine.update(performance.now())` einmal je Animation-Frame.
3. **Event-Typen in `@faf/protocol` anhängen (append-only):** mindestens die MS5-Kinds `weaponFire`, `projectileImpact`, `unitDeath`, `commanderDeath`, `buildComplete`, `reclaimStart`; die übrigen mit ihrem Meilenstein (Tabelle §4, Semantik maschinenlesbar in `SIM_EVENT_KIND_INFO`, `src/events/kinds.ts`). Die Zuordnung Typ-ID → Kind-Name als `eventTypes` übergeben (sonst gilt die vorläufige `DEFAULT_EVENT_TYPE_TABLE` 1…21). Felder: `pos` Q20.12. **Kodierung von `aux`/`flags` (Einschlag-Oberfläche, Alert-Index, Ohne-Ort-Bit) ebenfalls in `@faf/protocol` festlegen – gemeinsam mit TRACK-RENDERFX, nicht nach der vorläufigen Audio-Tabelle §4** – und per `eventCodec` übersetzen (`impactSurface`, `alertIndex`, `unlocatedMask`). `unitDeath`: die Sim muss **keine** Größenklasse senden; `eventCodec.visualDeathProfile(visual)` liefert `{sizeClass, air, structure}` aus den View-Daten (Präsentation, nicht `sim.bin`).
4. **`visualName` aus `view.json`:** `content/generated/view.json` (`visuals[]`, Index = Visual-ID, Feld `id`) muss für Waffen-Visuals die Waffen-Ref `core:wpn_*` aus `roster.json` liefern (z. B. `visualName = (v) => view.visuals[v]?.id`). Unbekannte Refs zählen als `eventsUnmapped` (im HUD/Stats sichtbar); die Map deckt alle 27 Roster-Waffen ab. Neue Waffen als Daten: Einträge `{ref: {sound, impact, gainDb?, rate?}}` aus der View-Daten-Pipeline als `weaponSounds` übergeben (werden über die Default-Map gelegt).
5. **Asset-Auslieferung:** `content/audio/dist/manifest.json` + `<scope>/<name>.v<i>.webm` unter einer `baseUrl` ausliefern. Für Vite: das Plugin `fafAudioAssets({ distDir })` aus `apps/audio-demo/audio-assets.ts` übernehmen (Dev-/Preview-Middleware mit Whitelist + `emitFile` im Build) oder die Kopie in `packages/assets-pipeline` („Audio-Transcode, Manifest“) aufnehmen. Kein Inhalts-Hash in den Dateinamen → `Cache-Control: no-cache` oder versionierte `baseUrl`. WAVs nie ausliefern.
6. **Unlock am ersten Klick:** Standard-`unlockTarget` ist `document` (pointerdown/keydown/touchend) – reicht im Spiel; zusätzlich `engine.unlock()` im Klick-Handler des Start-/Lobby-Knopfs. Vor dem Unlock werden Kampf-Events verworfen (gewollt).
7. **Ack aus dem Command-Builder:** unmittelbar im Eingabe-Handler, der den Befehl erzeugt, `engine.playUi('ui_cmd_move')` bzw. `playUi('ack_<rolle>')` aufrufen (synchron, `start(0)`, auch bei vollem Pool) – nicht erst nach Bestätigung durch die Sim. Damit liegt der Ack ≤ 1 Frame nach dem Klick (gemessen 0,16–0,34 ms im Handler).
8. **Kamera → `setListener`:** bei jeder Kamerabewegung `ListenerState` aus der RTS-Kamera füllen: `focusX/focusZ` (Bodenpunkt der Bildmitte), `height`, `viewHalfWidth` (halbe sichtbare Bodenbreite), `rightX/rightZ` (normierter Rechtsvektor auf dem Boden). Ein wiederverwendetes Objekt genügt (die Engine kopiert). `onJumpTo(x, z)` → Kamera-Flug; Hotkey (z. B. Leertaste) → `engine.jumpToLastAlert()`.
9. **Loops aus dem Client:** Bau-/Reclaim-Loop je Armee per `engine.setLoop('build:<army>', {sound: 'bld_pour_loop', x, z, gain, rate})` aus dem Eco-Abschnitt (Rate/Dichte aus Build Power), `null` stoppt mit Fade; `setSimSpeed(speed)` bei Tempowechsel.
10. **Settings-UI (P9):** `engine.settings` (`get/set/subscribe`) an Regler master/sfx/ui/alerts/music/ambience (0–1), „stumm“ und „stumm bei verborgenem Tab“ binden; Werte werden automatisch als Rampe angewendet und in `localStorage` (`faf.audio.v1`) gespeichert. Vorlage: `apps/audio-demo/src/demo/hud.ts`.
11. **Abnahme MS5 prüfen:** `engine.stats()` liefert `voices`/`peakVoices`, `voicesByCategory`, `mainJs` p95 und Latenzen; ein E2E im Spiel kann die Demo-Prüfungen (`apps/audio-demo/test/e2e/demo.spec.ts`) übernehmen.

## 12. Befehle und Selbsttest (d1, 2026-09-30, lokal M5 Pro)

| Befehl (Worktree-Wurzel, schwere über `tools/heavy`) | Ergebnis |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ Already up to date |
| `pnpm typecheck` | ✅ |
| `pnpm lint` | ✅ ESLint + depcruise (511 Module, keine Verstöße) |
| `pnpm exec vitest run packages/audio apps/audio-demo` | ✅ 32 Dateien, 333 Tests |
| `pnpm test` | ✅ 129 Dateien, 1 278 Tests (keine Regression) |
| `pnpm --filter @faf/audio bench -- --update-docs` | ✅ §5.1 |
| `pnpm --filter @faf/audio-demo build` | ✅ 2 Seiten, `audio/manifest.json` + 246 `.webm`, Chunk `opus-decoder-*.js` |
| `FAF_E2E_PORT=4583 pnpm --filter @faf/audio-demo test:e2e` | ✅ 27/27 (9 Tests × Chromium/Firefox/WebKit) |
| `FAF_E2E_PORT=4583 pnpm --filter @faf/audio-demo bench:browser -- --update-docs` | ✅ §5.2 |
| `git status --porcelain -- packages/sim packages/nav packages/render packages/client packages/protocol apps/game` | ✅ leer |

Review-Nacharbeit (2026-09-30): `pnpm typecheck` ✅; ESLint `packages/audio apps/audio-demo` ✅; `depcruise packages apps tools` ✅ (523 Module) + Negativtest (fast-check-Import → `audio-npm-deps`); `vitest run packages/audio apps/audio-demo` ✅ 33 Dateien / 340 Tests; `FAF_E2E_PORT=4583 pnpm --filter @faf/audio-demo test:e2e` ✅ 27/27 (Unlock-Annotation: 193–221 `locked`-Drops vor dem Klick in allen drei Engines); `pnpm --filter @faf/audio bench -- --update-docs` ✅ §5.1 (neue Spalten „Heap gehalten“/„alloziert“).
