# Flow & Fire: SFX-Liste (MVP)

> **Status:** Soll-Liste aller MVP-Sounds, Stand 2026-09-29. Vorhanden (✅) sind 4 Sounds, darunter der Referenz-Sound `varkan:wpn_cannon_t1_fire`.
> **Quellen:** PLAN §3.7 (Audio: Voice-Manager mit 32 Stimmen, Limits pro Kategorie, Cooldown pro Sound, Alert-Queue), MS5 (P7: ca. 15 Platzhalter-SFX), MS9 (P8: Alerts), MS14 (60–100 SFX), `docs/design/faction.md` §8 (Audio-Charakter „Gießhalle und Funk") und `docs/design/roster.json` (Waffen-Refs, Einheitenklassen).
> **Werkzeug:** `tools/sfx` (`@faf/sfx`). Alle Sounds werden prozedural synthetisiert, es gibt keine Samples und keine fremden Aufnahmen. Die Zielwerte der Kategorien stehen maschinenlesbar in `tools/sfx/src/categories.ts` und landen in `content/audio/dist/manifest.json`. Bei Widerspruch gilt der Code.

---

## 1. Konventionen

- **Datei = Sound:** `content/audio/<scope>/<name>.sfx.ts` mit `export default defineSfx({ id: '<scope>:<name>', … })`. Die id muss zum Pfad passen, das prüft der Build.
- **Scopes:**
  - `common/` enthält fraktionsneutrale Sounds: UI, Alerts, Einschläge auf Material, Musik, Ambience.
  - `varkan/` enthält den Klang der Fraktion Varkan: Waffen, Antriebe, Bau, Quittungen, Glocke.
  - Weitere Fraktionen bekommen eigene Ordner, etwa `content/audio/<fraktion>/`.
- **Override:** Die Laufzeit (MS5-Integration) sucht zuerst `<fraktion>:<name>` und fällt dann auf `common:<name>` zurück. Eine Fraktion kann also z. B. `ui_select` oder `imp_shell_metal` überschreiben, ohne dass sich Aufrufer ändern.
- **Waffen-Mapping:** Der Blueprint-Compiler bzw. die View-Daten ordnen jeder Waffen-Ref (`core:wpn_*`) eine Sound-id und optional einen `playbackRate` zu. Das erlaubt Aliase wie Riegel I = Punze-Schuss mit Rate 0,92, siehe §3.1.
- **Varianten:** `variants: n` erzeugt n deterministische Zufallsvarianten, der Seed kommt aus id und Index. Die Engine wählt zufällig, aber nie zweimal hintereinander dieselbe, und variiert zusätzlich die Tonhöhe um ±3 %.
- **Kanäle:** Räumliche Sounds sind mono und laufen über den Panner. UI, Musik und Ambience sind stereo. Quittungen und Alerts sind mono, spielen aber nicht räumlich, sondern zentriert.
- **Lautheit:** Gemessen wird nach ITU-R BS.1770-4 mit K-Gewichtung. Die Messart hängt vom Sound-Typ ab:
  - **One-Shots** werden über die maximale Momentary Loudness normiert (M-max, 400-ms-Fenster, kürzere Sounds auffüllt wie am Messgerät).
  - **Loops** werden über die gegatete integrierte Lautheit normiert (I).
  - Die True-Peak-Grenze liegt bei −1 dBTP (4× Oversampling). Wird sie überschritten, begrenzt ein Look-ahead-True-Peak-Limiter. Greift er mit mehr als 6 dB, gibt der Build eine Warnung aus.
  - Die Zielwerte sind **relative Mix-Pegel der Dateien**. Busse, Distanz und Zoom-Dämpfung wirken im Mixer zusätzlich.
- **Loops:** Der Build blendet das Ende per Equal-Power-Crossfade in den Anfang. Loop-Punkte sind die ganze Datei; das Manifest führt sie in Samples und Sekunden (`loop.startSample/endSample`), weil der Opus-Decoder Padding anhängen kann.
- **Formate:** Jeder Sound wird als WAV (48 kHz, 24 Bit) und als Opus/WebM (64 kbit/s mono, 96 kbit/s stereo) geschrieben, zusammen mit `manifest.json`.

## 2. Kategorien und Zielwerte

| Kategorie | Bus | Ziel LUFS (Messart) | Prio | Cooldown/Sound | max. Stimmen | Kanäle | max. Dauer | Band |
|---|---|---|---|---|---|---|---|---|
| `alert` Alert-Signalton | voice | −16 (M-max) | **100** | 3 000 ms (je Alert eigenes Intervall) | 1 | mono, zentriert | 3 s | hoch |
| `music` Musik-Stinger | music | −16 (I) | 95 | – | 1 | stereo | 15 s | voll |
| `signature` Glockenschlag | sfx | −19 (M-max) | 90 | **≥ 1 000 ms** | 2 | mono | 7 s | mittel |
| `ack` Quittung (Pips) | voice | −21 (M-max) | 85 | 150 ms | 2 | mono, zentriert | 0,8 s | hoch |
| `ui` UI / Befehle | ui | −27 (M-max) | 80 | 30 ms | 4 | stereo | 0,8 s | hoch |
| `explosion` Explosion / Tod | sfx | −17 (M-max) | 70 | 80 ms | 6 | mono | 5 s | tief |
| `weapon` Waffen-Abschuss | sfx | −20 (M-max) | 50 | 50 ms | 10 | mono | 2,5 s | mittel |
| `shield` Schilde | sfx | −21 (M-max) | 45 | 60 ms | 4 | mono | 3 s | mittel |
| `impact` Einschlag / Treffer | sfx | −21 (M-max) | 40 | 40 ms | 8 | mono | 2 s | mittel |
| `projectile` Projektil im Flug | sfx | −24 (I, Loop) | 30 | – | 4 | mono | 4 s | mittel |
| `build` Bau / Reclaim / Fabrik | sfx | −24 (I bei Loops, sonst M-max) | 30 | 100 ms | 3 | mono | 4 s | mittel |
| `intel` Intel / Radar | sfx | −26 (M-max) | 25 | 500 ms | 2 | mono | 2 s | hoch |
| `unit` Bewegung / Antrieb | sfx | −26 (I bei Loops, sonst M-max) | 20 | 60 ms | 8 | mono | 4 s | tief |
| `ambience` Ambience | ambience | −30 (I, Loop) | 10 | – | 2 | stereo | 30 s | voll |
| `eco` Wirtschaft / Flow-Grundton | sfx | −30 (I, Loop) | **5** | – | 4 | mono | 6 s | tief |

- **Priorität:** Die Reihenfolge folgt faction.md §8.3: Glockenschläge und Alerts gehen vor Waffen, Eco-Loops kommen zuletzt. Sind alle 32 Stimmen belegt, verdrängt ein Sound mit höherer Priorität die leiseste Stimme niedrigerer Priorität.
- **Frequenzbänder:** Artillerie, Tod und Lotbruch liegen tief, Direktfeuer mittel, AA, Pips und UI hoch. Der Referenz-Sound hält das Tiefband mit einem Hochpass bei 90 Hz frei; sein Schwerpunkt liegt bei etwa 0,8–0,9 kHz.
- **Ein Bau-Loop pro Armee:** Dichte und Tonhöhe bilden die Summe der fließenden Build Power ab (faction.md §8.3).

## 3. Liste

Legende:
- **Status:** ✅ vorhanden, leer = offen.
- **MS:** Meilenstein, in dem der Sound gebraucht wird. MS5 ist das P7-Set, MS6 kommt mit Fabrik und Abstich, MS9 mit P8 und dem MVP-Kern, MS14 mit dem Voll-MVP.
- **max. s:** Obergrenze einer Variante. „Loop x" bedeutet x Sekunden Loop-Länge.

### 3.1 Waffen (`weapon`): je Waffentyp aus roster.json

Klangregeln aus faction.md §8.2:
- Direktfeuer ist ein „Glockenhammer": höhere Tech klingt tiefer und hallt länger, wird aber nicht lauter.
- Artillerie ist „Schwapp + Wumm".
- Raketen fauchen mit Knistern.
- Flugabwehr ist ein trockenes Rasseln in hoher Lage.

| Status | ID | Klang | Waffen-Refs (Einheit) | Var. | max. s | MS |
|---|---|---|---|---|---|---|
| ✅ | `varkan:wpn_cannon_t1_fire` | **Referenz.** Glockenhammer f0 ≈ 520 Hz, kurzer Nachklang, dumpfer Knall, Glut-Zischen | `core:wpn_cannon_t1` (Punze); Alias `core:wpn_bolt_cannon_t1` (Riegel I, Rate 0,92) | 4 | 1,5 | MS5 |
| | `varkan:wpn_reeve_cannon_fire` | Glockenhammer mittel, dazu Uplink-Knistern | `core:wpn_reeve_cannon` (Vogt) | 4 | 1,5 | MS5 |
| | `varkan:wpn_mg_t1_fire` | Schnellfeuer-MG: kurzer, trockener Metallschlag, ohne Glocke | `core:wpn_mg_t1` (Stichel); Alias `core:wpn_spark_mg_t1` (Funke, Rate 1,2, −3 dB) | 6 | 0,4 | MS5 |
| | `varkan:wpn_slag_mortar_t1_fire` | Schlackenmörser: Schwapp (Flüssigkeit) + Wumm (Mörser) | `core:wpn_slag_mortar_t1` (Kelle) | 4 | 1,8 | MS5 |
| | `varkan:wpn_aa_repeater_t1_fire` | Zwillings-Flak: trockenes Rasseln, hoch | `core:wpn_aa_repeater_t1` (Sieb); Alias `core:wpn_grate_aa_t1` (Rost I) | 4 | 0,5 | MS9 |
| | `varkan:wpn_cannon_t2_fire` | Doppel-Glocke: 2 Schläge im Abstand von 35 ms, f0 ≈ 420 Hz, längerer Nachklang | `core:wpn_cannon_t2` (Meißel); Alias `core:wpn_bolt_cannon_t2` (Riegel II, Rate 0,92) | 4 | 1,8 | MS9 |
| | `varkan:wpn_missile_fire` | Glutrakete: Fauchen mit Knistern der Treibladung | `core:wpn_runner_missile_t2` (Rinne, 2er-Salve); Alias `core:wpn_high_grate_sam_t3` (Hochrost) | 4 | 1,2 | MS9 |
| | `varkan:wpn_flak_t2_fire` | Splitterflak: Rasseln + dumpfer Ausstoß | `core:wpn_flak_t2` (Rüttelsieb); Alias `core:wpn_grate_flak_t2` (Rost II) | 4 | 0,8 | MS9 |
| | `varkan:wpn_reeve_tapshot_fire` | Abstich: Glutkern-Zischen, tiefer Glockenschlag, Entladungsknall | `core:wpn_reeve_tapshot` (Vogt) | 2 | 2,5 | MS6 |
| | `varkan:wpn_crucible_shell_t2_fire` | Tiegelgranate: schwerer Schwapp + tiefer Mörserknall, Hall | `core:wpn_crucible_shell_t2` (Tiegel) | 3 | 2,5 | MS14 |
| | `varkan:wpn_gatling_t2_loop` | Glut-Gatling als Feuerstoß-Loop | `core:wpn_gatling_t2` (Zange) | 1 | Loop 1,0 | MS14 |
| | `varkan:wpn_gatling_t2_spin` | Gatling-Anlauf und -Auslauf, dazu Heißlauf-Zischen | `core:wpn_gatling_t2` (Zange) | 2 | 1,0 | MS14 |
| | `varkan:wpn_cannon_t3_fire` | Schwere Doppel-Glocke, f0 ≈ 330 Hz, langer Nachklang | `core:wpn_cannon_t3` (Fallhammer) | 4 | 2,0 | MS14 |
| | `varkan:wpn_scriber_rail_t3_fire` | Langrohr: scharfer Knall, singender Metallton (Rohr-Resonanz über Comb-Filter) | `core:wpn_scriber_rail_t3` (Reißnadel) | 3 | 2,0 | MS14 |
| | `varkan:wpn_pour_shell_t3_fire` | Gießgranate: tiefes Schwapp + Wumm, Kellen-Klirren | `core:wpn_pour_shell_t3` (Pfanne) | 3 | 2,5 | MS14 |
| | `varkan:wpn_furnace_shell_t3_fire` | Hochofengranate: sehr tiefer Knall, Hochofen-Fauchen | `core:wpn_furnace_shell_t3` (Hochofen) | 2 | 2,5 | MS14 |
| | `varkan:wpn_aa_drum_t3_fire` | Trommel-Flak: schnelles Rasseln + Trommel-Rotor | `core:wpn_aa_drum_t3` (Trommelsieb) | 3 | 0,8 | MS14 |
| | `varkan:wpn_air_gun_fire` | Luftkanone: kurz und trocken, leicht metallisch | `core:wpn_kestrel_gun_t1` (Turmfalke); Alias `core:wpn_magpie_gun_t2` (Elster, Rate 0,9) | 4 | 0,4 | MS14 |
| | `varkan:wpn_crow_gun_t2_fire` | Bauch-Glocke: kleiner Glockenhammer, gedämpft | `core:wpn_crow_gun_t2` (Krähe) | 4 | 0,6 | MS14 |
| | `varkan:wpn_bomb_release` | Bombenklappe klackt, dazu Abwurf-Schwapp | `core:wpn_slag_bomb_t1` (Dohle, 4er-Reihe); Alias `core:wpn_magpie_bomb_t2` (Elster) | 3 | 1,2 | MS14 |

Alle 27 Waffen-Refs aus roster.json sind abgedeckt: 20 Sound-ids, davon 7 Refs als Alias.

### 3.2 Projektile im Flug (`projectile`)

Die Engine rechnet den Doppler über `playbackRate`.

| Status | ID | Klang | Verwendet von | Var. | max. s | MS |
|---|---|---|---|---|---|---|
| | `varkan:prj_shell_whistle_loop` | Pfeifen im Flug, gut hörbar (faction.md §8.2) | Kelle, Pfanne, Tiegel, Hochofen | 2 | Loop 1,5 | MS9 |
| | `varkan:prj_missile_loop` | Raketen-Fauchen mit Knistern | Rinne, Hochrost | 2 | Loop 1,0 | MS9 |
| | `common:prj_bomb_fall` | Fallpfeifen einer Bombe, fallend | Dohle, Elster | 2 | 1,5 | MS14 |

### 3.3 Einschläge (`impact`)

| Status | ID | Klang | Auslöser | Var. | max. s | MS |
|---|---|---|---|---|---|---|
| | `common:imp_shell_metal` | gedämpfter Metall-Klong | Kanonentreffer auf Einheit | 4 | 0,8 | MS5 |
| | `common:imp_shell_ground` | Erdwurf, Knall mit Kies | Kanonen-Fehlschuss | 4 | 0,8 | MS5 |
| | `varkan:imp_slag_splash` | Knirschen + Zischen der Schlacke | Artillerie-Einschlag (Kelle, Pfanne, Tiegel, Hochofen) | 4 | 1,5 | MS9 |
| | `common:imp_bullet_metal` | helles Ping mit Splittern | MG/Gatling/Luftkanone trifft Einheit | 6 | 0,3 | MS9 |
| | `common:imp_bullet_ground` | Staub-Puff | MG-Fehlschuss | 4 | 0,3 | MS9 |
| | `common:imp_structure_metal` | tiefer, hallender Klong | Treffer auf Gebäude | 4 | 1,0 | MS9 |
| | `common:imp_missile` | Detonation + Glut-Zischen | Raketen-Einschlag | 3 | 1,0 | MS9 |
| | `common:imp_flak_burst` | Detonation in der Luft mit Splitterregen | Flak/SAM-Näherungszünder | 4 | 0,8 | MS9 |
| | `common:imp_bomb` | schwerer Erdwurf | Bomben | 3 | 1,5 | MS14 |
| | `common:imp_rail` | scharfer Metallriss | Reißnadel-Treffer | 2 | 1,0 | MS14 |

### 3.4 Explosionen / Tod (`explosion`)

Tod ist „Gusseisen bricht, dazu Dampfzischen". Strukturen bersten wie Kessel und zischen lange aus.

| Status | ID | Klang | Auslöser | Var. | max. s | MS |
|---|---|---|---|---|---|---|
| | `varkan:exp_small` | Gusseisen bricht, kurzes Dampfzischen | **klein:** T1 mobil, Mauer, kleine Gebäude (Zapfstelle, Horcher, Speicher) | 4 | 1,5 | MS5 |
| | `varkan:exp_commander` | **Lotbruch:** tiefer Glockenschlag (bis MS9 im Sound selbst, danach `sig_bell_deep`), Unterdruck-Sog, Druckwelle, dann 2 s Stille-Ducking mit nachglühendem Knistern | **Kommandant** (Vogt) | 1 | 5,0 | MS5 |
| | `varkan:exp_medium` | Bersten mit Trümmerregen | **mittel:** T2 mobil, T1/T2-Verteidigung, Werke I | 3 | 2,5 | MS9 |
| | `varkan:exp_large` | Kesselbersten, langer Zisch-Ausklang | **groß:** T3 mobil, Glutkessel, Werke II/III, Hochofen | 3 | 4,0 | MS9 |
| | `varkan:exp_air_crash` | Absturzpfeifen + Aufschlag | Flugzeug abgeschossen | 3 | 2,5 | MS14 |

### 3.5 Bau, Reclaim, Fabrik (`build`)

| Status | ID | Klang | Auslöser | Var. | max. s | MS |
|---|---|---|---|---|---|---|
| | `varkan:bld_pour_loop` | Nano-/Baustrahl als Gießgeräusch; Tonhöhe steigt mit dem Fortschritt (Rate), Dichte über die Build Power; **ein Loop pro Armee** | Bauen, Assist, Reparieren | 2 | Loop 3,0 | MS5 |
| | `varkan:rcl_loop` | Reclaim = Bau rückwärts: Einschmelzen, Blubbern | Reclaim | 2 | Loop 3,0 | MS5 |
| | `varkan:bld_complete` | Bau fertig: Abkühl-Knacken, danach `sig_bell_small` | Einheit/Gebäude fertig | 3 | 1,0 | MS9 |
| | `varkan:bld_start` | Kellen-Klirren und Gussbeginn | Baustelle gesetzt | 3 | 0,6 | MS9 |
| | `varkan:rcl_complete` | Schlacke-Plopp + Masse-Tick | Wrack aufgebraucht | 3 | 0,6 | MS9 |
| | `varkan:fac_rolloff` | Tor-Hydraulik, Rumpeln, Anfahren | Fabrik-Roll-off (G10) | 3 | 2,0 | MS6 |

### 3.6 Signatur-Glocke (`signature`)

Die Glocke ist sparsam eingesetzt und hat einen eigenen Voice-Manager-Slot mit Cooldown ≥ 1 s (faction.md §8.2).

| Status | ID | Klang | Auslöser | Var. | max. s | MS |
|---|---|---|---|---|---|---|
| | `varkan:sig_bell_small` | einzelner Schlag, leise und hoch | Bau fertig | 2 | 3,0 | MS5 |
| | `varkan:sig_bell_deep` | tiefer Schlag mit 3× Nachhall | Lotbruch (Teil von `exp_commander`) | 1 | 7,0 | MS9 |
| | `varkan:sig_bell_mid` | mittlerer Schlag | Freisprechung (Fabrik-Upgrade fertig) | 1 | 5,0 | MS9 |
| | `varkan:sig_sounding` | Lotung: glühender Kegel fällt, der Vogt gießt sich (≈ 3 s) | Spielstart (Platzhalter bis P19) | 1 | 5,0 | MS14 |

### 3.7 Wirtschaft und Flow-Grundton (`eco`)

| Status | ID | Klang | Auslöser | Var. | max. s | MS |
|---|---|---|---|---|---|---|
| | `varkan:eco_flow_hum_loop` | leiser tonaler Summton auf A2 (110 Hz) mit Obertönen | unter Fabriken, Engineers, Kraftwerken | 1 | Loop 4,0 | MS9 |
| | `varkan:eco_flow_stall` | Grundton kippt eine knappe Sekunde nach unten und stottert | Energy-Stall (E3), hörbar ohne HUD | 2 | 1,5 | MS9 |
| | `varkan:eco_pgen_loop` | rhythmischer Blasebalg, leise, nur auf Z0 | Glutkessel | 1 | Loop 4,0 | MS14 |
| | `varkan:eco_mex_loop` | Pumpentakt, leise, nur auf Z0 | Zapfstelle | 1 | Loop 3,0 | MS14 |
| | `varkan:eco_hydro_loop` | Dampfzischen mit Blubbern, nur auf Z0 | Dampfquelle | 1 | Loop 4,0 | MS14 |

### 3.8 Bewegung und Antrieb (`unit`)

| Status | ID | Klang | Verwendet von | Var. | max. s | MS |
|---|---|---|---|---|---|---|
| ✅ | `varkan:mov_tracks_loop` | Ketten leicht: Guss-Glieder klirren (~9 Hz) über Antriebsbrummen | Punze, Kelle, Sieb, Funke | 2 | Loop 2,0 | MS5 |
| | `varkan:mov_bot_heavy_step` | schwerer Guss-Tritt + Hydraulik | Vogt, Fallhammer | 6 | 0,6 | MS5 |
| | `varkan:mov_tracks_heavy_loop` | Ketten schwer: tiefer, langsamer, mehr Schleifen | Meißel, Rinne, Rüttelsieb, Pfanne, Trommelsieb | 2 | Loop 2,5 | MS9 |
| | `varkan:mov_bot_step` | Bot-Schritt: hydraulisches Zischen + hohler Guss-Tritt | Stichel, Zange, Reißnadel, Engineers | 8 | 0,4 | MS9 |
| | `varkan:mov_air_jet_loop` | Flieger fauchen wie ein Blasebalg | Lerche, Turmfalke, Dohle, Elster | 2 | Loop 2,0 | MS14 |
| | `varkan:mov_air_flyby` | Vorbeiflug mit Doppler | Flieger nahe der Kamera | 3 | 2,0 | MS14 |
| | `varkan:mov_gunship_loop` | Ringdüse wummert | Krähe | 1 | Loop 2,0 | MS14 |
| | `varkan:mov_hover_loop` | Hover: Luftpolster-Rauschen + Gebläse | *vorbereitet: kein Hover-Fahrzeug im MVP-Roster (Marine/Hover post-MVP, weitere Fraktionen)* | 1 | Loop 2,0 | post-MVP |

### 3.9 Schilde (`shield`)

Schilde gibt es nur in MVP-optional: Schürze, Schirm II/III.

| Status | ID | Klang | Auslöser | Var. | max. s | MS |
|---|---|---|---|---|---|---|
| | `varkan:shd_hit` | glasiges Summen mit Ripple (FM, kurze Hüllkurve) | Treffer auf Schild (ShieldHit) | 4 | 0,8 | MS14 |
| | `varkan:shd_collapse` | absteigendes Zerspringen + Entladung | Schild bricht zusammen | 2 | 2,0 | MS14 |
| | `varkan:shd_up` | ansteigendes Summen, Kessel-Druck | Schild baut sich (wieder) auf | 2 | 1,5 | MS14 |

### 3.10 Intel (`intel`)

| Status | ID | Klang | Auslöser | Var. | max. s | MS |
|---|---|---|---|---|---|---|
| | `common:int_contact_new` | kurzer Blip | neuer Radar-/Sichtkontakt (gedrosselt) | 2 | 0,4 | MS9 |
| | `common:int_radar_ping` | leiser Sonar-Ping mit Nachhall | Horcher-Sweep (nur Z0/Z1, selten) | 2 | 1,5 | MS14 |

### 3.11 UI und Befehle (`ui`)

Klang der Befehle nach faction.md §8.2. Die Befehlstöne liegen in `varkan/`, damit andere Fraktionen sie überschreiben können.

| Status | ID | Klang | Auslöser | Var. | max. s | MS |
|---|---|---|---|---|---|---|
| ✅ | `common:ui_click` | kurzer heller Relais-Klick | Buttons, Menüs, Build-Palette | 3 | 0,1 | MS5 |
| | `varkan:ui_select` | Relais-Klack + kurzer Blasebalg-Hauch | Auswahl von Einheiten | 3 | 0,3 | MS5 |
| | `varkan:ui_cmd_move` | Ventil-Zisch mit fallender Tonhöhe | Bewegungsbefehl | 3 | 0,4 | MS5 |
| | `varkan:ui_cmd_attack` | trockener Hammerschlag | Angriffsbefehl | 3 | 0,3 | MS6 |
| | `varkan:ui_cmd_build` | Kellen-Klirren | Bau platziert | 3 | 0,4 | MS6 |
| | `varkan:ui_cmd_generic` | kurzer Ventil-Klick | Assist, Guard, Patrol, Reclaim-Befehl | 3 | 0,3 | MS6 |
| | `common:ui_error` | tiefer Doppel-Buzz | ungültig: Platzierung, Ressourcen, Ziel | 2 | 0,4 | MS6 |
| | `common:ui_queue_add` | kurzer steigender Tick | Einheit in die Queue | 3 | 0,2 | MS6 |
| | `common:ui_queue_remove` | kurzer fallender Tick | aus der Queue entfernt | 2 | 0,2 | MS6 |

### 3.12 Quittungen und Pips (`ack`)

Vor jeder Quittung stehen Pips (faction.md §8.1):
- **Die Zahl der Pips ist die Tech-Stufe.** Die Engine spielt den Pip N-mal im Abstand von 70 ms, deshalb braucht es eine Datei pro Familie und nicht eine pro Tech-Stufe.
- **Die Tonlage zeigt die Rollenfamilie.**
- Die Sprachzeilen der Werkstimme sind kein Teil dieser SFX-Liste (siehe §4).

| Status | ID | Klang | Einheitenklasse (roster.json) | Var. | max. s | MS |
|---|---|---|---|---|---|---|
| | `varkan:ack_pip_direct` | Pip mittel (≈ 1,3 kHz), metallische Comb-Resonanz | Direktfeuer: Funke, Stichel, Punze, Meißel, Zange, Fallhammer, Reißnadel; Schürze | 1 | 0,15 | MS5 |
| | `varkan:ack_command` | warmer Zweiklang + Uplink-Knistern (Bandpass 300–3 400 Hz) | Vogt | 2 | 0,6 | MS9 |
| | `varkan:ack_pip_arty` | Pip tief (≈ 500 Hz) | Artillerie: Kelle, Rinne, Pfanne | 1 | 0,15 | MS9 |
| | `varkan:ack_pip_aa` | Pip hoch (≈ 2,6 kHz) | Flugabwehr: Sieb, Rüttelsieb, Trommelsieb | 1 | 0,15 | MS9 |
| | `varkan:ack_pip_eng` | aufsteigender Zweiklang | Engineers: Lehrling, Geselle, Meister | 1 | 0,25 | MS9 |
| | `varkan:ack_structure` | dumpfer Guss-Klang | Gebäude ausgewählt (Werke, Eco, Verteidigung) | 2 | 0,4 | MS9 |
| | `varkan:ack_pip_air` | gleitender Pip | Luft: Lerche, Turmfalke, Dohle, Krähe, Elster | 1 | 0,2 | MS14 |

### 3.13 Alerts (`alert`): synthetische Signaltöne (P8)

Jeder Alert beginnt mit dem gemeinsamen **Zweiton-Gong** (fallende Quarte, helles Glockenspektrum), danach folgt ein eigenes Muster. Die Sprachzeile der Hüttenstimme kommt später dazu (§4). Das Intervall ist der Cooldown pro Alert-Typ; die Alert-Queue spielt höchstens einen zugleich und springt mit der Leertaste zum Ort.

| Status | ID | Muster nach dem Gong | Anlass | Intervall | max. s | MS |
|---|---|---|---|---|---|---|
| | `common:alt_gong` | nur der Gong | Präfix vor Sprachzeilen | – | 1,2 | MS9 |
| ✅ | `common:alt_commander_danger` | 3 schnelle Warn-Pulse (A5) | Vogt in Gefahr / unter Feuer | 8 s | 1,6 | MS9 |
| | `common:alt_unit_attacked` | 1 tiefer Puls | Einheit angegriffen | 10 s | 1,5 | MS9 |
| | `common:alt_base_attacked` | 2 tiefe Pulse | Basis/Gebäude angegriffen | 15 s | 2,0 | MS9 |
| | `common:alt_mass_stall` | fallendes Glissando, Holz-Timbre | Masse knapp (Stall) | 20 s | 2,0 | MS9 |
| | `common:alt_energy_stall` | fallendes Glissando, Summton-Timbre, stotternd | Energie knapp (Stall) | 20 s | 2,0 | MS9 |
| | `common:alt_build_complete` | steigende Terz | Bau fertig (Queue/Gebäude) | 5 s | 1,5 | MS9 |
| | `common:alt_factory_upgraded` | steigende Quinte + kleine Glocke | Werk freigesprochen | 5 s | 2,0 | MS9 |
| | `common:alt_enemy_commander_spotted` | Gong + tiefer Doppelton, langsam | Feind-Vogt gesichtet | 30 s | 2,5 | MS9 |
| | `common:alt_enemy_air` | schnelles hohes Trillern | feindliche Luft gesichtet | 30 s | 1,5 | MS14 |
| | `common:alt_storage_full` | kurzer Überlauf-Ton | Speicher voll (Masse wird verschwendet) | 30 s | 1,5 | MS14 |

### 3.14 Musik-Stinger (`music`)

| Status | ID | Klang | Anlass | Var. | max. s | MS |
|---|---|---|---|---|---|---|
| | `common:mus_victory` | Blechbläser-ähnliche FM-Kadenz + Glocke, Dur, 6–8 s | Sieg | 1 | 10 | MS9 |
| | `common:mus_defeat` | tiefe Glocke, Moll-Cluster, verhallend („Lot gebrochen") | Niederlage | 1 | 10 | MS9 |
| | `common:mus_match_start` | kurzer Aufgang, Amboss-Schlag | Spielstart | 1 | 6 | MS14 |

### 3.15 Ambience (`ambience`)

| Status | ID | Klang | Anlass | Var. | max. s | MS |
|---|---|---|---|---|---|---|
| | `common:amb_wind_loop` | Hochland-Wind, breit, langsam moduliert | Karten-Grundbett | 1 | Loop 20 | MS9 |
| | `common:amb_magma_loop` | fernes Grollen, Magma-Blubbern (Kessa) | Karten mit Lava-/Vulkan-Props | 1 | Loop 20 | MS14 |
| | `common:amb_water_loop` | Uferbrandung, leise | Karten mit Wasser (Kamera nahe am Ufer) | 1 | Loop 20 | MS14 |

## 4. Nicht in dieser Liste

- **Sprachzeilen** der Operator-Stimme des Vogts, der Werkstimme und der Hüttenstimme (faction.md §8.1). Sie sind lokalisiert (DE/EN) und brauchen eine eigene Pipeline: TTS oder Aufnahme plus Bandpass, Comb-Filter und Knistern aus `@faf/sfx`. Die Pips und Gongs davor stehen oben.
- **Musik-Tracks** (Menü, Gefecht). Im MVP sind nur Stinger vorgesehen.

## 5. Zählung

| Meilenstein | Sounds | Summe |
|---|---|---|
| MS5 (P7, Platzhalter-Set „ca. 15") | 17 | 17 |
| MS6 (Fabrik, Abstich, Befehle) | 8 | 25 |
| MS9 (MVP-Kern, P8-Alerts, Stinger) | 41 | 66 |
| MS14 (Voll-MVP) | 32 | **98** |
| post-MVP (vorbereitet) | 1 | 99 |

Die 98 MVP-Sounds liegen im Rahmen von PLAN MS14 (60–100 SFX). Hinzu kommen 7 Waffen-Aliase über `playbackRate` und die Pip-Wiederholung für Tech 2 und 3, die keine eigenen Dateien brauchen.
