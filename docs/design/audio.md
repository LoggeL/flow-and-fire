# Flow & Fire: Audio (SFX)

> **Stand 2026-09-29:** 101 Sounds (100 MVP + 1 post-MVP vorbereitet), 246 Varianten, 2,85 MB Opus/WebM. Alles prozedural synthetisiert mit `tools/sfx` (`@faf/sfx`), ohne Samples und ohne fremde Aufnahmen. Noch nicht im Spiel integriert (MS5).
> **Quellen:** PLAN §3.7 / Abnahme MS5 (Voice-Manager, 32 Stimmen, Limits und Cooldowns pro Kategorie, Alert-Queue), MS5 (P7), MS9 (P8), MS14 (60–100 SFX); `docs/design/faction.md` §8 (Audio-Charakter „Gießhalle und Funk"); `docs/design/roster.json` (Waffen-Refs, Einheitenklassen).
> **Einzelheiten:** Sound-für-Sound-Liste mit Status, Meilenstein und Zielwerten in [`content/audio/SOUNDLIST.md`](../../content/audio/SOUNDLIST.md); API und Bausteine in [`tools/sfx/README.md`](../../tools/sfx/README.md). Bei Widerspruch gilt der Code (`tools/sfx/src/categories.ts`).

## 1. Leitbild

Varkan klingt nach Gießerei bei Nachtschicht: gegossenes Eisen, Glut, Industrie. Tief, metallisch, nah und trocken mit wenig Hall. Es gibt Materialgeräusche statt Sci-Fi-Synth: Glockenhammer, Blasebalg, Zischen von Glut, fließendes Metall, Kolben und Ventile. Die Signatur ist ein einzelner Glockenschlag, gestimmt auf A (Flow-Grundton A2, Glocken A5/A3/A2).

Fraktionsneutrale Sounds (UI-Grundklick, Alerts, Materialeinschläge, Musik-Stinger, Ambience) sind bewusst schlichter und liegen in `common/`, damit spätere Fraktionen sie teilen oder überschreiben können.

## 2. Synthese-Werkzeug `tools/sfx`

Jeder Sound ist eine TypeScript-Datei, die ein Signal berechnet. Der Build macht daraus normierte Dateien.

- **DSP-Bausteine** (`tools/sfx/src`): PolyBLEP-Oszillatoren, 2-Operator-FM mit Feedback, Modalsynthese (Glocken-/Platten-Partiale), weißes/rosa/braunes Rauschen, Knistern, modulierbare RBJ-Biquads, Hüllkurven/Sweeps/LFO, Waveshaper, Bitcrush, Comb/Delay, Ringmod, Freeverb und generierte Impulsantworten mit FFT-Faltung, Layering, Pan/Breite, Varispeed. Darauf aufbauend Rezepte wie `crack`, `boom`, `thump`, `clang` (Glockenhammer), `sizzle` (Glut), `room`.
- **Fraktions-Kits:** gemeinsame Klangbausteine einer Fraktion liegen neben ihren Sounds (`content/audio/varkan/foundry_kit.ts`, `wpn_kit.ts`, `common/lib_blast.ts`).
- **Determinismus:** Zufall nur über `ctx.rng` (Seed aus id + Variantenindex). Gleiche Quelle ergibt bitgleiche WAVs; Opus wird mit `-fflags +bitexact` kodiert und ist mit derselben ffmpeg-Version bitgleich (gebaut mit ffmpeg 9.0.1 + libopus).
- **Pipeline** (`pnpm sfx`): Worker-Pool, inkrementeller Cache (Hash aus `tools/sfx/src`, Hilfsdateien und Sound-Datei). Je Variante: Kanal-Layout → DC-Filter → Tail-Trim bzw. Loop-Crossfade → Lautheits-Normierung (BS.1770-4) → Look-ahead-True-Peak-Limiter (−1 dBTP) → WAV 48 kHz/24 Bit → Opus/WebM → Opus dekodieren und nachmessen (Opus-True-Peak-Wächter rendert bei Überschreitung mit mehr Limiter-Reserve neu) → `manifest.json` / `manifest.js`.
- **Prüfung:** `pnpm sfx:analyze` misst einzelne Dateien (LUFS, True Peak, Schwerpunkt, Spektrogramm-PNG, ffmpeg-ebur128-Gegenprobe). `pnpm sfx:audit` prüft den ganzen Bestand und endet bei einem Verstoß mit Exit-Code 1 (Lautheit ±1,5 LU in WAV und Opus, True Peak ≤ −1 dBTP, Loop-Nähte, Varianten-Ähnlichkeit, Alert↔Waffe-Verwechslung, 3-MB-Budget, SOUNDLIST-Abdeckung). 22 Vitest-Tests decken Messverfahren (EBU-3341-Fälle), Filter, FFT, WAV, Determinismus und Build/Cache ab.

## 3. Konventionen

- **Datei = Sound:** `content/audio/<scope>/<name>.sfx.ts`, `export default defineSfx({ id: '<scope>:<name>', category, variants, loop?, render })`. Der Build prüft, dass id und Pfad passen.
- **Scopes:** `common/` (fraktionsneutral) und je Fraktion ein Ordner (`varkan/`, später weitere). Ausgabe gespiegelt nach `content/audio/dist/<scope>/<name>.v<i>.{wav,webm}`.
- **Namens-Präfixe = Kategorie:** `wpn_` Waffe, `prj_` Projektil, `imp_` Einschlag, `exp_` Explosion, `bld_`/`rcl_`/`fac_` Bau, `sig_` Glocke, `eco_` Wirtschaft, `mov_` Bewegung, `shd_` Schild, `int_` Intel, `ui_` UI, `ack_` Quittung, `alt_` Alert, `mus_` Musik, `amb_` Ambience. Loops enden auf `_loop`.
- **Override-Regel (Laufzeit):** Lookup zuerst `<fraktion>:<name>`, dann `common:<name>`. Aufrufer kennen nur den Namen.
- **Waffen-Mapping:** View-Daten ordnen jeder Waffen-Ref (`core:wpn_*`) eine Sound-id und optional `playbackRate`/Gain zu; so entstehen 7 Aliase ohne eigene Datei (SOUNDLIST §3.1).
- **Varianten:** Die Engine wählt zufällig, nie zweimal hintereinander dieselbe, plus ±3 % Tonhöhe.
- **Kanäle:** Räumliche Sounds mono (Panner), UI/Musik/Ambience stereo, Quittungen und Alerts mono zentriert.
- **Loops:** Jede Loop-Datei trägt vorne und hinten 40 ms (1 920 Samples) Wrap-around-Polster. Die Engine startet bei 0 und loopt **zwischen `loop.startSample` und `loop.endSample`** aus dem Manifest, nicht über die ganze Datei.

## 4. Kategorien und Lautheitsziele

Lautheit nach ITU-R BS.1770-4. One-Shots werden auf M-max (400 ms) normiert, Loops auf integrierte Lautheit. Die Werte sind relative Mix-Pegel der Dateien; Busse, Distanz und Zoom-Dämpfung wirken zusätzlich im Mixer.

| Kategorie | Bus | Ziel LUFS | Prio | Cooldown | max. Stimmen | Kanäle | Opus kbit/s | Sounds |
|---|---|---|---|---|---|---|---|---|
| `alert` | voice | −16 | 100 | 3 000 ms (je Alert eigenes Intervall) | 1 | mono, zentriert | 56 | 11 |
| `music` | music | −16 (I) | 95 | – | 1 | stereo | 80 | 3 |
| `signature` | sfx | −19 | 90 | ≥ 1 000 ms | 2 | mono | 56 | 4 |
| `ack` | voice | −21 | 85 | 150 ms | 2 | mono, zentriert | 56 | 7 |
| `ui` | ui | −27 | 80 | 30 ms | 4 | stereo | 64 | 9 |
| `explosion` | sfx | −17 | 70 | 80 ms | 6 | mono | 56 | 7 |
| `weapon` | sfx | −20 | 50 | 50 ms | 10 | mono | 56 | 20 |
| `shield` | sfx | −21 | 45 | 60 ms | 4 | mono | 56 | 3 |
| `impact` | sfx | −21 | 40 | 40 ms | 8 | mono | 56 | 10 |
| `projectile` | sfx | −24 (I) | 30 | – | 4 | mono | 56 | 3 |
| `build` | sfx | −24 | 30 | 100 ms | 3 | mono | 56 | 6 |
| `intel` | sfx | −26 | 25 | 500 ms | 2 | mono | 56 | 2 |
| `unit` | sfx | −26 | 20 | 60 ms | 8 | mono | 56 | 8 |
| `ambience` | ambience | −30 (I) | 10 | – | 2 | stereo | 48 | 3 |
| `eco` | sfx | −30 (I) | 5 | – | 4 | mono | 56 | 5 |

True Peak ≤ −1 dBTP in WAV und dekodiertem Opus. Gesamt 32 Stimmen; ist alles belegt, verdrängt höhere Priorität die leiseste Stimme niedrigerer Priorität. Frequenzbänder: Artillerie, Tod, Lotbruch tief; Direktfeuer mittel; AA, Pips, UI hoch.

## 5. Stand

- **Bestand:** 101 Sounds (34 `common`, 67 `varkan`), 246 Varianten, davon 17 Loop-Sounds. Verteilung nach Meilenstein (SOUNDLIST §5): MS5 17, MS6 8, MS9 41, MS14 34, post-MVP 1.
- **Größe:** 2,85 MB Opus/WebM (Budget 3 MB); die WAVs belegen lokal ≈ 60 MB.
- **Gesamtprüfung** (`pnpm sfx:audit`, SOUNDLIST §6): keine Verstöße. Lautheit WAV −0,06…+0,26 LU, Opus −0,32…+0,29 LU; True Peak max. −1,00 dBTP; alle 24 Loop-Varianten nahtlos auch im Opus; 273 Variantenpaare verschieden; 0 Verwechslungen Alert↔Waffe.
- **Nicht enthalten:** Sprachzeilen (Vogt, Werkstimme, Hüttenstimme; lokalisiert, eigene Pipeline nötig) und Musik-Tracks (im MVP nur Stinger).

## 6. Integrationsplan

Die vorgezogene Engine liegt jetzt in `packages/audio`, die isolierte Oberfläche in
`apps/audio-demo`. Aktuelle APIs, Busse (`voice` wird zu `alerts`), Loop-Sekunden, Dekodierung und
Abnahme stehen in [TRACK-AUDIOENG](../status/track-audioeng.md). Die folgende Liste beschreibt die
noch ausstehende Spielintegration; die dort ursprünglich vorgesehene Implementierung im Client
wird durch das eigenständige Audio-Paket ersetzt.

**MS5 (P7, Platzhalter-Set):** Web-Audio-Mixer in `packages/client`: Busse (sfx, ui, voice, music, ambience), Voice-Manager mit 32 Stimmen, Priorität, Stimmen-Limit und Cooldown je Kategorie aus dem Manifest, Panning und Dämpfung nach Zoom, Variantenwahl ohne Wiederholung ±3 % Tonhöhe, Loop zwischen `startSample`/`endSample`, ein Bau-Loop pro Armee (Rate/Dichte aus Build Power). Laden der Opus/WebM-Dateien über das Manifest; die Asset-Pipeline (`packages/assets-pipeline`, „Audio-Transcode, Manifest") übernimmt `content/audio/dist/**/*.webm` + `manifest.json` in den Build-Output. Waffen-Mapping `core:wpn_*` → Sound-id (+ Alias-Rate) in den View-Daten. Die 17 MS5-Sounds der SOUNDLIST. Abnahme: ≤ 32 Stimmen, ≤ 0,5 ms Main-JS, Ack-Sound ≤ 1 Frame nach dem Klick.

**MS6:** Fabrik, Abstich und Befehls-Sounds (8) anbinden.

**MS9 (P8, MVP-Kern):** Alert-Queue mit Sprung zum Ort und eigenem Wiederholintervall je Alert-Typ; Alert-Gong (`common:alt_gong`) vor jeder Ansage; Musik-Stinger; Flow-Grundton mit Energy-Stall-Kippen; Glockenfamilie `sig_bell_*`. Entscheidung offen: `varkan:exp_commander` enthält bis dahin seine eigene tiefe Glocke; ab MS9 soll `sig_bell_deep` diese Rolle übernehmen (Glocke dann aus dem Explosions-Sound entfernen). Pips vor Quittungen (Tech-Stufe = Anzahl, Rollenfamilie = Tonlage).

**MS14 (Voll-MVP):** restliche 34 Sounds (Schilde, Intel, T2/T3-Waffen, Ambience-Varianten, Luft), Hörtest im Spiel mit echter Last und ggf. Nachjustieren der Kategorie-Ziele in `categories.ts` (danach `pnpm sfx` + `pnpm sfx:audit`).

## 7. Build-Artefakte im Repo

**Entscheidung:** `content/audio/dist/**/*.webm`, `manifest.json` und `manifest.js` (zusammen ≈ 3,2 MB) werden **eingecheckt**; WAVs (≈ 60 MB) und `.cache.json` nicht (`.gitignore`).

- Begründung: Opus ist klein, und Spiel-Build, CI und Vorschau funktionieren so ohne ffmpeg und ohne den Synth-Lauf. WAVs sind Zwischenprodukte, jederzeit bitgleich reproduzierbar.
- Folge: Wer Sound-Quellen oder `tools/sfx/src` ändert, führt `pnpm sfx` und `pnpm sfx:audit` aus und committet die geänderten `.webm` + Manifest mit. Nach frischem Checkout rendert der erste `pnpm sfx` alles neu (der Cache verlangt die WAVs); mit derselben ffmpeg-Version entstehen dabei bytegleiche `.webm`.
- Wächst der Bestand deutlich über das 3-MB-Budget (weitere Fraktionen), wird die Entscheidung neu getroffen: dann Erzeugung im Build (`pnpm assets`) statt Einchecken.

## 8. Neue Sounds und Fraktionen ergänzen

**Neuer Sound:**
1. Eintrag in `content/audio/SOUNDLIST.md` (Kategorie-Abschnitt, Status leer, Meilenstein).
2. Datei `content/audio/<scope>/<name>.sfx.ts` mit `defineSfx` anlegen; Kategorie wählen, Varianten festlegen, bei Loops `loop: { lengthS, crossfadeS }`. Gemeinsame Bausteine aus dem Fraktions-Kit nutzen. `render` trifft nur Form und Balance, den Pegel setzt die Pipeline.
3. `pnpm sfx --only <name>` bauen, in `pnpm sfx:preview` (http://localhost:5190/tools/sfx/preview/) anhören, mit `pnpm sfx:analyze` messen.
4. `pnpm sfx:audit` muss ohne Verstoß durchlaufen; Status in der SOUNDLIST auf ✅, `.webm` + Manifest committen.

**Neue Fraktion:**
1. Audio-Charakter im Fraktions-Design festlegen (Leitbild, Materialien, Signatur-Klang, Tonart), analog faction.md §8.
2. Ordner `content/audio/<fraktion>/` mit eigenem Kit (`<fraktion>_kit.ts`) anlegen; Sounds mit id `<fraktion>:<name>`.
3. Mindestens die fraktionsspezifischen Präfixe abdecken (`wpn_`, `prj_`, `exp_`, `bld_`/`rcl_`/`fac_`, `sig_`, `eco_`, `mov_`, `ack_`, `shd_`, fraktionseigene `ui_`). Alles, was nicht existiert, fällt zur Laufzeit auf `common:<name>` zurück; `common/` nur ändern, wenn es für alle Fraktionen gilt.
4. SOUNDLIST um die Fraktion erweitern, Budget prüfen (`pnpm sfx:audit`) und ggf. §7 neu entscheiden.
